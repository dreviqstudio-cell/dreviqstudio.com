import { put, get } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

// Combines admin-submit-job.js + admin-job-status.js + admin-job-file.js
// — see api/admin-auth.js for why (12-function Hobby plan cap).
// Node.js runtime (@vercel/blob needs Node builtins) with classic
// (req, res) handler — matches this project's convention.

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function handleSubmit(req, res) {
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

  if (req.method === "POST") return handleSubmit(req, res);

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
