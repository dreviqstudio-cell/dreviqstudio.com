import { get } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

// Node.js runtime (not edge) — same reason as the other Blob-using routes.
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

  const sessionId = req.query.sessionId;
  if (!sessionId || Array.isArray(sessionId) || !/^[a-zA-Z0-9_-]{8,64}$/.test(sessionId)) {
    res.status(400).json({ error: "Invalid sessionId" });
    return;
  }

  const result = await get(`leads/${sessionId}.json`, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);
  res.setHeader("Content-Type", "application/json");
  res.status(200).send(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8"));
}
