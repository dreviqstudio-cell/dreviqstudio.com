import { get } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

// Node.js runtime (not edge) — see admin-submit-job.js for why.
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

  const id = req.query.id;
  if (!id || Array.isArray(id) || !/^job_[a-z0-9]+$/i.test(id)) {
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
  const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");

  res.setHeader("Content-Type", "application/json");
  res.status(200).send(text);
}
