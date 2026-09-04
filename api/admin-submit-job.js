import { put } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

export const config = { runtime: "edge" };

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
export default async function handler(request) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = parseCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (!secret || !(await verifySessionToken(token, secret))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { clientName, prompt, aspectRatio, sceneCount, masterFaceDataUrl } = body || {};
  const errors = [];
  if (!clientName || typeof clientName !== "string") errors.push("clientName is required");
  if (!prompt || typeof prompt !== "string") errors.push("prompt is required");
  if (!["16:9", "9:16"].includes(aspectRatio)) errors.push("aspectRatio must be 16:9 or 9:16");
  const scenes = Number(sceneCount);
  if (!Number.isInteger(scenes) || scenes < 1 || scenes > 10) errors.push("sceneCount must be an integer 1-10");

  if (errors.length) {
    return new Response(JSON.stringify({ error: "Validation failed", details: errors }), { status: 422 });
  }

  const id = `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let masterFacePathname = null;

  if (typeof masterFaceDataUrl === "string" && masterFaceDataUrl.startsWith("data:")) {
    const match = masterFaceDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: "masterFaceDataUrl is not a valid data URL" }), { status: 422 });
    }
    const [, mime, b64] = match;
    const ext = mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
    const bytes = base64ToBytes(b64);
    if (bytes.length > 8 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "Reference photo too large (max 8MB)" }), { status: 413 });
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

  return new Response(JSON.stringify({ ok: true, job }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
