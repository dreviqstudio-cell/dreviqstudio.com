import { get, list, put, del } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

const VALID_STATUSES = ["pending", "approved", "rejected"];

export default async function handler(req, res) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (!secret || !(await verifySessionToken(token, secret))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method === "GET") {
    const { blobs } = await list({ prefix: "reviews/", limit: 200 });
    const files = blobs.filter((b) => b.pathname.endsWith(".json"));
    const reviews = (
      await Promise.all(
        files.map(async (b) => {
          try {
            const result = await get(b.pathname, { access: "private", useCache: false });
            if (!result || result.statusCode !== 200) return null;
            const chunks = [];
            for await (const chunk of result.stream) chunks.push(chunk);
            return JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8"));
          } catch {
            return null;
          }
        })
      )
    ).filter(Boolean);
    reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.status(200).json({ reviews });
    return;
  }

  if (req.method === "POST") {
    const { id, action } = req.body || {};
    if (!id || typeof id !== "string" || !/^rev_[a-z0-9]+$/i.test(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    if (action === "delete") {
      await del(`reviews/${id}.json`);
      res.status(200).json({ ok: true });
      return;
    }

    if (!VALID_STATUSES.includes(action)) {
      res.status(400).json({ error: `action must be one of: delete, ${VALID_STATUSES.join(", ")}` });
      return;
    }

    const result = await get(`reviews/${id}.json`, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(chunk);
    const review = JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8"));
    review.status = action;
    review.updatedAt = new Date().toISOString();
    await put(`reviews/${id}.json`, JSON.stringify(review, null, 2), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    res.status(200).json({ ok: true, review });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
