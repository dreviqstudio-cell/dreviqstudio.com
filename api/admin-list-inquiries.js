import { list, get } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

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

  const { blobs } = await list({ prefix: "inquiries/", limit: 200 });
  const files = blobs.filter((b) => b.pathname.endsWith(".json"));

  const inquiries = (
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

  inquiries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.status(200).json({ inquiries });
}
