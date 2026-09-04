import { list, get } from "@vercel/blob";

/**
 * PUBLIC (no auth) — returns published portfolio items for the public
 * site (portfolio.html and index.html's pipeline showcase) to render.
 * Node.js runtime — @vercel/blob needs Node builtins.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
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
