import { list, get } from "@vercel/blob";

// Combines portfolio-items.js (list) + portfolio-media.js (stream one
// file) — see api/admin-auth.js for why (12-function Hobby plan cap).
// PUBLIC (no auth) — both were already public.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const path = req.query.path;

  if (path) {
    if (Array.isArray(path) || !/^portfolio\/[a-zA-Z0-9_.\/-]+$/.test(path) || path.includes("..")) {
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
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(buffer);
    return;
  }

  const { blobs } = await list({ prefix: "portfolio/", limit: 200 });
  const itemFiles = blobs.filter((b) => b.pathname.match(/^portfolio\/[^/]+\.json$/));

  const items = (
    await Promise.all(
      itemFiles.map(async (b) => {
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

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.setHeader("Cache-Control", "public, max-age=60");
  res.status(200).json({ items });
}
