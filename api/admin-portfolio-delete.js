import { del, head } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

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

  const { id } = req.body || {};
  if (!id || typeof id !== "string" || !/^p_[a-z0-9]+$/i.test(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  // Delete every blob under portfolio/<id> (media, poster, raw, metadata).
  // head() first on each known candidate path rather than list() — cheaper
  // and simpler for the handful of files one item can have.
  const candidates = [];
  for (const ext of ["jpg", "jpeg", "png", "webp", "gif", "mp4", "mov", "webm"]) {
    candidates.push(`portfolio/${id}/media.${ext}`, `portfolio/${id}/poster.${ext}`, `portfolio/${id}/raw.${ext}`);
  }
  candidates.push(`portfolio/${id}.json`);

  const toDelete = [];
  await Promise.all(
    candidates.map(async (pathname) => {
      try {
        await head(pathname, {});
        toDelete.push(pathname);
      } catch {
        /* doesn't exist — fine, most candidates won't */
      }
    })
  );

  if (toDelete.length) {
    await del(toDelete);
  }

  res.status(200).json({ ok: true, deleted: toDelete });
}
