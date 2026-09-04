import { get, list } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

// Combines admin-list-leads.js + admin-lead-detail.js — see
// api/admin-auth.js for why (12-function Hobby plan cap).
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

  if (sessionId) {
    if (Array.isArray(sessionId) || !/^[a-zA-Z0-9_-]{8,64}$/.test(sessionId)) {
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
    return;
  }

  const { blobs } = await list({ prefix: "leads/", limit: 200 });
  const leadFiles = blobs.filter((b) => b.pathname.endsWith(".json"));

  const summaries = await Promise.all(
    leadFiles.map(async (b) => {
      try {
        const result = await get(b.pathname, { access: "private", useCache: false });
        if (!result || result.statusCode !== 200) return null;
        const chunks = [];
        for await (const chunk of result.stream) chunks.push(chunk);
        const transcript = JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8"));
        const lastUserMsg = [...transcript.messages].reverse().find((m) => m.role === "user");
        return {
          sessionId: transcript.sessionId,
          createdAt: transcript.createdAt,
          updatedAt: transcript.updatedAt,
          messageCount: transcript.messages.length,
          preview: lastUserMsg ? lastUserMsg.content.slice(0, 140) : "",
        };
      } catch {
        return null;
      }
    })
  );

  const leads = summaries.filter(Boolean).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.status(200).json({ leads });
}
