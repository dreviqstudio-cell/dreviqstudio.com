import { put, get } from "@vercel/blob";
import { handleUpload } from "@vercel/blob/client";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

// Combines admin-submit-job.js + admin-job-status.js + admin-job-file.js
// — see api/admin-auth.js for why (12-function Hobby plan cap).
// Node.js runtime (@vercel/blob needs Node builtins) with classic
// (req, res) handler — matches this project's convention.

const JOB_ID_RE = /^job_[a-z0-9]+$/i;

function makeJobId() {
  return `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Any file that might exceed ~4MB (stitch clips at 5-10MB+ each, and even
// a merely-large reference photo) blows past Vercel's ~4.5MB serverless
// request body cap if sent through this function as base64-in-JSON — so
// those upload directly browser-to-Blob instead. This route only issues
// short-lived client tokens (handleUploadUrl target for
// @vercel/blob/client's upload()); the actual file bytes never pass
// through this function.
async function handleBlobUploadToken(req, res) {
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // Client picks the pathname; constrain it to jobs/<jobId>/(stitch_*
        // or face.*) so an admin session can only write into a job folder
        // it named, not arbitrary paths in the shared Blob store.
        const isStitchClip = /^jobs\/job_[a-z0-9]+\/stitch_clip_\d+\.[a-z0-9]+$/i.test(pathname);
        const isFacePhoto = /^jobs\/job_[a-z0-9]+\/face\.[a-z0-9]+$/i.test(pathname);
        if (!isStitchClip && !isFacePhoto) {
          throw new Error("Invalid upload pathname");
        }
        return {
          allowedContentTypes: isFacePhoto
            ? ["image/png", "image/jpeg", "image/webp"]
            : ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"],
          maximumSizeInBytes: isFacePhoto ? 25 * 1024 * 1024 : 300 * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
    });
    res.status(200).json(jsonResponse);
  } catch (err) {
    res.status(400).json({ error: err.message || "Upload token request failed" });
  }
}

async function handleStitchSubmit(req, res) {
  const body = req.body || {};
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
    res.status(422).json({ error: "Validation failed", details: errors });
    return;
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

  await put(`jobs/${id}.json`, JSON.stringify(job, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });

  res.status(200).json({ ok: true, job });
}

async function handleSubmit(req, res) {
  const body = req.body || {};
  if (body.contentType === "stitch") return handleStitchSubmit(req, res);

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
  // masterFacePathname is uploaded client-side (direct-to-Blob, see the
  // blob-token route) BEFORE this call, using the same id — so it must
  // already live under this job's own folder, same guard as stitchClips.
  const id = clientId || makeJobId();
  if (uploadedFacePathname !== undefined && uploadedFacePathname !== null) {
    if (typeof uploadedFacePathname !== "string" || !uploadedFacePathname.startsWith(`jobs/${id}/`)) {
      errors.push("masterFacePathname doesn't belong to this job");
    }
  }
  if (errors.length) {
    res.status(422).json({ error: "Validation failed", details: errors });
    return;
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

  await put(`jobs/${id}.json`, JSON.stringify(job, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });

  res.status(200).json({ ok: true, job });
}

async function handleStatus(req, res, id) {
  if (!/^job_[a-z0-9]+$/i.test(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const result = await get(`jobs/${id}.json`, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);
  res.setHeader("Content-Type", "application/json");
  res.status(200).send(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8"));
}

async function handleFile(req, res, path) {
  if (!/^jobs\/[a-zA-Z0-9_.\/-]+$/.test(path) || path.includes("..")) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  const result = await get(path, { access: "private" });
  if (!result || result.statusCode !== 200) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);
  res.setHeader("Content-Type", result.blob.contentType || "application/octet-stream");
  res.status(200).send(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

export default async function handler(req, res) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (!secret || !(await verifySessionToken(token, secret))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method === "POST") {
    if (req.query.action === "blob-token") return handleBlobUploadToken(req, res);
    return handleSubmit(req, res);
  }

  if (req.method === "GET") {
    const id = req.query.id;
    const path = req.query.path;
    if (id && !Array.isArray(id)) return handleStatus(req, res, id);
    if (path && !Array.isArray(path)) return handleFile(req, res, path);
    res.status(400).json({ error: "Provide ?id= or ?path=" });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
