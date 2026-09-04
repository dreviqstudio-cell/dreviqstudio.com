import { get, put } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

const VALID_STATUSES = ["new", "contacted", "closed"];

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

  const { id, status } = req.body || {};
  if (!id || typeof id !== "string" || !/^inq_[a-z0-9]+$/i.test(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    return;
  }

  const result = await get(`inquiries/${id}.json`, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) {
    res.status(404).json({ error: "Inquiry not found" });
    return;
  }
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);
  const inquiry = JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8"));

  inquiry.status = status;
  inquiry.updatedAt = new Date().toISOString();

  await put(`inquiries/${id}.json`, JSON.stringify(inquiry, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });

  res.status(200).json({ ok: true, inquiry });
}
