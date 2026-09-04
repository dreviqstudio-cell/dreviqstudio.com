import { get } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

/**
 * Streams a job's result file (video/srt/reference photo) through our own
 * admin auth, instead of exposing raw private Blob URLs to the browser.
 * Node.js runtime (not edge) — see admin-submit-job.js for why.
 * NOTE: buffers the whole file in memory before sending; fine for
 * test-sized outputs, a real multi-MB/GB video will need presigned
 * download URLs instead — flagged as a follow-up, not solved here.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (!secret || !(await verifySessionToken(token, secret))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const path = req.query.path;
  // Only ever allow reading inside jobs/ — this is a shared bucket, not a
  // general-purpose file proxy.
  if (!path || Array.isArray(path) || !/^jobs\/[a-zA-Z0-9_.\/-]+$/.test(path) || path.includes("..")) {
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
  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));

  res.setHeader("Content-Type", result.blob.contentType || "application/octet-stream");
  res.status(200).send(buffer);
}
