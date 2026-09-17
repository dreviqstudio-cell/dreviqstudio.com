import { b2PutJson, b2Get, b2PresignPut } from "../_lib/b2.js";
import { isAdmin } from "../_lib/auth.js";
import { json, readJsonBody, bytes } from "../_lib/http.js";

// Shilpi engine's own submit-job + job-status + job-file + blob-token,
// deliberately separate from admin-production.js/api/admin-production —
// different B2 prefix (shilpi-jobs/ vs jobs/), different worker pipeline
// (Sarvam + HeyGen, not Replicate/Kling), different job shape. See
// admin/shilpi.html for the caller.

const JOB_ID_RE = /^shilpi_[a-z0-9]+$/i;

function makeJobId() {
  return `shilpi_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function handleBlobUploadToken(request, env) {
  const body = (await readJsonBody(request)) || {};
  const { pathname, contentType } = body;

  // Client picks the pathname; constrain it to shilpi-jobs/<jobId>/(broll_*
  // or music.*), same reasoning as admin-production's blob-token guard —
  // an admin session can only write into a job folder it named.
  const isBroll = typeof pathname === "string" && /^shilpi-jobs\/shilpi_[a-z0-9]+\/broll_\d+\.[a-z0-9]+$/i.test(pathname);
  const isMusic = typeof pathname === "string" && /^shilpi-jobs\/shilpi_[a-z0-9]+\/music\.[a-z0-9]+$/i.test(pathname);
  if (!isBroll && !isMusic) {
    return json({ error: "Invalid upload pathname" }, 400);
  }

  const allowedContentTypes = isMusic
    ? ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"]
    : ["image/png", "image/jpeg", "image/webp"];
  if (!allowedContentTypes.includes(contentType)) {
    return json({ error: `contentType must be one of: ${allowedContentTypes.join(", ")}` }, 400);
  }

  const url = await b2PresignPut(env, pathname, { contentType, expiresIn: 1800 });
  return json({ url, pathname });
}

async function handleSubmit(request, env) {
  const body = (await readJsonBody(request)) || {};
  const {
    id: clientId,
    clientName,
    script,
    brollPathnames,
    musicPathname,
    captionsEnabled,
  } = body;

  const errors = [];
  if (clientId && !JOB_ID_RE.test(clientId)) errors.push("id, if provided, must look like a shilpi job id");
  if (!clientName || typeof clientName !== "string") errors.push("clientName is required");
  if (!script || typeof script !== "string" || !script.trim()) errors.push("script is required (the Odia narration text)");

  const id = clientId || makeJobId();

  let cleanBroll = [];
  if (brollPathnames !== undefined && brollPathnames !== null) {
    if (!Array.isArray(brollPathnames)) {
      errors.push("brollPathnames must be an array");
    } else {
      cleanBroll = brollPathnames.filter((p) => typeof p === "string");
      cleanBroll.forEach((p, i) => {
        if (!p.startsWith(`shilpi-jobs/${id}/`)) errors.push(`brollPathnames[${i}] doesn't belong to this job`);
      });
    }
  }

  let cleanMusic = null;
  if (musicPathname !== undefined && musicPathname !== null) {
    if (typeof musicPathname !== "string" || !musicPathname.startsWith(`shilpi-jobs/${id}/`)) {
      errors.push("musicPathname doesn't belong to this job");
    } else {
      cleanMusic = musicPathname;
    }
  }

  if (errors.length) {
    return json({ error: "Validation failed", details: errors }, 422);
  }

  const now = new Date().toISOString();
  const job = {
    id,
    status: "queued",
    clientName,
    script: script.trim(),
    brollPathnames: cleanBroll,
    musicPathname: cleanMusic,
    captionsEnabled: captionsEnabled !== false,
    createdAt: now,
    updatedAt: now,
    resultVideoPathname: null,
    error: null,
  };

  await b2PutJson(env, `shilpi-jobs/${id}.json`, job);

  return json({ ok: true, job });
}

async function handleStatus(env, id) {
  if (!JOB_ID_RE.test(id)) {
    return json({ error: "Invalid job id" }, 400);
  }
  const result = await b2Get(env, `shilpi-jobs/${id}.json`);
  if (!result) return json({ error: "Job not found" }, 404);
  return new Response(await result.text(), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function handleFile(env, path) {
  if (!/^shilpi-jobs\/[a-zA-Z0-9_.\/-]+$/.test(path) || path.includes("..")) {
    return json({ error: "Invalid path" }, 400);
  }
  const result = await b2Get(env, path);
  if (!result) return json({ error: "Not found" }, 404);
  const buf = await result.arrayBuffer();
  return bytes(buf, { contentType: result.headers.get("content-type") || "application/octet-stream" });
}

export async function onRequest({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);

  if (request.method === "POST") {
    if (url.searchParams.get("action") === "blob-token") return handleBlobUploadToken(request, env);
    return handleSubmit(request, env);
  }

  if (request.method === "GET") {
    const id = url.searchParams.get("id");
    const path = url.searchParams.get("path");
    if (id) return handleStatus(env, id);
    if (path) return handleFile(env, path);
    return json({ error: "Provide ?id= or ?path=" }, 400);
  }

  return json({ error: "Method not allowed" }, 405);
}
