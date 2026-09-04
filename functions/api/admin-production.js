import { b2PutJson, b2Get, b2PresignPut } from "../_lib/b2.js";
import { isAdmin } from "../_lib/auth.js";
import { json, readJsonBody, bytes } from "../_lib/http.js";

// Combines submit-job + job-status + job-file + blob-upload-token — same
// grouping the old Vercel routes used.
//
// Upload flow changed with the B2 migration: instead of a Vercel client
// upload token, ?action=blob-token issues a short-lived presigned PUT URL
// per file. The browser does `fetch(presignedUrl, { method: "PUT",
// headers: {"Content-Type": file.type}, body: file })` directly against
// B2 for anything that might exceed a request-body size limit (stitch
// clips, reference photos) — the bytes never pass through this function.
// See admin/dashboard.html for the caller.

const JOB_ID_RE = /^job_[a-z0-9]+$/i;

function makeJobId() {
  return `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function handleBlobUploadToken(request, env) {
  const body = (await readJsonBody(request)) || {};
  const { pathname, contentType } = body;

  // Client picks the pathname; constrain it to jobs/<jobId>/(stitch_* or
  // face.*) so an admin session can only write into a job folder it named,
  // not arbitrary paths in the shared bucket.
  const isStitchClip = typeof pathname === "string" && /^jobs\/job_[a-z0-9]+\/stitch_clip_\d+\.[a-z0-9]+$/i.test(pathname);
  const isFacePhoto = typeof pathname === "string" && /^jobs\/job_[a-z0-9]+\/face\.[a-z0-9]+$/i.test(pathname);
  if (!isStitchClip && !isFacePhoto) {
    return json({ error: "Invalid upload pathname" }, 400);
  }

  const allowedContentTypes = isFacePhoto
    ? ["image/png", "image/jpeg", "image/webp"]
    : ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"];
  if (!allowedContentTypes.includes(contentType)) {
    return json({ error: `contentType must be one of: ${allowedContentTypes.join(", ")}` }, 400);
  }

  const url = await b2PresignPut(env, pathname, { contentType, expiresIn: 1800 });
  return json({ url, pathname });
}

async function handleStitchSubmit(request, env, body) {
  const { id, clientName, stitchClips, voice } = body;
  const errors = [];
  if (!id || !JOB_ID_RE.test(id)) errors.push("id is required and must look like a job id (from the upload step)");
  if (!clientName || typeof clientName !== "string") errors.push("clientName is required");
  if (!Array.isArray(stitchClips) || stitchClips.length === 0) errors.push("stitchClips must be a non-empty array");
  else {
    stitchClips.forEach((clip, i) => {
      if (!clip || typeof clip.pathname !== "string" || !clip.pathname.startsWith(`jobs/${id}/`)) {
        errors.push(`stitchClips[${i}].pathname is missing or doesn't belong to this job`);
      }
      if (!clip || typeof clip.narration !== "string" || !clip.narration.trim()) {
        errors.push(`stitchClips[${i}].narration is required (every clip needs a line of narration)`);
      }
    });
  }
  if (errors.length) {
    return json({ error: "Validation failed", details: errors }, 422);
  }

  const now = new Date().toISOString();
  const job = {
    id,
    status: "queued",
    clientName,
    contentType: "stitch",
    stitchClips: stitchClips.map((c) => ({ pathname: c.pathname, narration: c.narration.trim() })),
    voice: typeof voice === "string" && voice ? voice : null,
    createdAt: now,
    updatedAt: now,
    resultVideoPathname: null,
    resultSrtPathname: null,
    resultImagesZipPathname: null,
    error: null,
  };

  await b2PutJson(env, `jobs/${id}.json`, job);

  return json({ ok: true, job });
}

async function handleSubmit(request, env) {
  const body = (await readJsonBody(request)) || {};
  if (body.contentType === "stitch") return handleStitchSubmit(request, env, body);

  const { id: clientId, clientName, prompt, contentType, aspectRatio, sceneCount, masterFacePathname: uploadedFacePathname } = body;
  const errors = [];
  if (clientId && !JOB_ID_RE.test(clientId)) errors.push("id, if provided, must look like a job id");
  if (!clientName || typeof clientName !== "string") errors.push("clientName is required");
  if (!prompt || typeof prompt !== "string") errors.push("prompt is required");
  const resolvedContentType = contentType || "video";
  if (!["video", "photo"].includes(resolvedContentType)) errors.push("contentType must be video or photo");
  // 1:1 only makes sense for the photo path — the video model (Kling) is
  // only verified against 16:9/9:16, don't let a paid video job request it.
  const allowedAspectRatios = resolvedContentType === "photo" ? ["16:9", "9:16", "1:1"] : ["16:9", "9:16"];
  if (!allowedAspectRatios.includes(aspectRatio)) errors.push(`aspectRatio must be one of ${allowedAspectRatios.join(", ")}`);
  const scenes = Number(sceneCount);
  if (!Number.isInteger(scenes) || scenes < 1 || scenes > 10) errors.push("sceneCount must be an integer 1-10");
  // masterFacePathname is uploaded client-side (direct-to-B2, see the
  // blob-token action) BEFORE this call, using the same id — so it must
  // already live under this job's own folder, same guard as stitchClips.
  const id = clientId || makeJobId();
  if (uploadedFacePathname !== undefined && uploadedFacePathname !== null) {
    if (typeof uploadedFacePathname !== "string" || !uploadedFacePathname.startsWith(`jobs/${id}/`)) {
      errors.push("masterFacePathname doesn't belong to this job");
    }
  }
  if (errors.length) {
    return json({ error: "Validation failed", details: errors }, 422);
  }

  const masterFacePathname = uploadedFacePathname || null;
  const now = new Date().toISOString();
  const job = {
    id,
    status: "queued",
    clientName,
    prompt,
    contentType: resolvedContentType,
    aspectRatio,
    sceneCount: scenes,
    masterFacePathname,
    createdAt: now,
    updatedAt: now,
    resultVideoPathname: null,
    resultSrtPathname: null,
    resultImagesZipPathname: null,
    error: null,
  };

  await b2PutJson(env, `jobs/${id}.json`, job);

  return json({ ok: true, job });
}

async function handleStatus(env, id) {
  if (!/^job_[a-z0-9]+$/i.test(id)) {
    return json({ error: "Invalid job id" }, 400);
  }
  const result = await b2Get(env, `jobs/${id}.json`);
  if (!result) return json({ error: "Job not found" }, 404);
  return new Response(await result.text(), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function handleFile(env, path) {
  if (!/^jobs\/[a-zA-Z0-9_.\/-]+$/.test(path) || path.includes("..")) {
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
