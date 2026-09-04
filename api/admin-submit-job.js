import { put } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

// Node.js runtime (default for this file) — NOT edge. @vercel/blob depends
// on `undici`, which needs Node builtins (node:stream, node:net, node:tls,
// ...) unavailable in the Edge sandbox; deploying this as an edge function
// fails at build time with "referencing unsupported modules". Node's
// classic (req, res) handler signature is used here deliberately — this
// Vercel setup's Node runtime does NOT dispatch api/*.js with the Fetch
// Request/Response signature used in login/logout (those stay on edge,
// which doesn't need @vercel/blob).

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Creates a real job record in Vercel Blob (jobs/<id>.json, status "queued").
 * A separate always-on worker (Render background worker, see
 * dreviq_agent/worker.py) polls Blob for queued jobs, runs the actual
 * content-engine pipeline, and writes the result back. This endpoint does
 * NOT run the pipeline itself — Vercel functions can't run a multi-minute
 * Python/Whisper/ffmpeg process.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (!secret || !(await verifySessionToken(token, secret))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body || {};
  const { clientName, prompt, aspectRatio, sceneCount, masterFaceDataUrl } = body;
  const errors = [];
  if (!clientName || typeof clientName !== "string") errors.push("clientName is required");
  if (!prompt || typeof prompt !== "string") errors.push("prompt is required");
  if (!["16:9", "9:16"].includes(aspectRatio)) errors.push("aspectRatio must be 16:9 or 9:16");
  const scenes = Number(sceneCount);
  if (!Number.isInteger(scenes) || scenes < 1 || scenes > 10) errors.push("sceneCount must be an integer 1-10");

  if (errors.length) {
    res.status(422).json({ error: "Validation failed", details: errors });
    return;
  }

  const id = `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let masterFacePathname = null;

  if (typeof masterFaceDataUrl === "string" && masterFaceDataUrl.startsWith("data:")) {
    const match = masterFaceDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      res.status(422).json({ error: "masterFaceDataUrl is not a valid data URL" });
      return;
    }
    const [, mime, b64] = match;
    const ext = mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
    const bytes = base64ToBytes(b64);
    if (bytes.length > 8 * 1024 * 1024) {
      res.status(413).json({ error: "Reference photo too large (max 8MB)" });
      return;
    }
    const uploaded = await put(`jobs/${id}/face.${ext}`, bytes, {
      access: "private",
      addRandomSuffix: false,
      contentType: mime,
    });
    masterFacePathname = uploaded.pathname;
  }

  const now = new Date().toISOString();
  const job = {
    id,
    status: "queued",
    clientName,
    prompt,
    aspectRatio,
    sceneCount: scenes,
    masterFacePathname,
    createdAt: now,
    updatedAt: now,
    resultVideoPathname: null,
    resultSrtPathname: null,
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
