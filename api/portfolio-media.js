import { get } from "@vercel/blob";

/**
 * PUBLIC (no auth) — serves portfolio media (images/video) to site
 * visitors. The underlying Blob store is private; this endpoint is the
 * public-facing door to it, restricted to the portfolio/ prefix only.
 * Node.js runtime — @vercel/blob needs Node builtins (see admin routes).
 *
 * NOTE: buffers the whole file in memory before responding — fine for
 * reasonably-sized web images/short clips, but a large video will need a
 * proper streaming/presigned-URL approach instead. Flagged, not solved.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const path = req.query.path;
  if (!path || Array.isArray(path) || !/^portfolio\/[a-zA-Z0-9_.\/-]+$/.test(path) || path.includes("..")) {
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
}
