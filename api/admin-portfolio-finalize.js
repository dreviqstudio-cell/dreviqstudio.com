import { put } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

/**
 * Records a portfolio item's metadata AFTER the browser has already
 * uploaded its file(s) directly to Blob storage (see
 * admin-portfolio-upload-token.js). This request is small (just text
 * fields + pathnames), well under the 4.5MB function body limit that the
 * old base64-file-in-JSON approach used to hit.
 */
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

  const body = req.body || {};
  const { id, title, category, description, mediaType, mediaPathname, posterPathname, rawPathname, featuredHome } = body;

  const errors = [];
  if (!id || typeof id !== "string" || !/^p_[a-z0-9]+$/i.test(id)) errors.push("invalid id");
  if (!title || typeof title !== "string") errors.push("title is required");
  if (!category || typeof category !== "string") errors.push("category is required");
  if (!["video", "image"].includes(mediaType)) errors.push("mediaType must be video or image");
  if (!mediaPathname || !mediaPathname.startsWith(`portfolio/${id}/`)) errors.push("invalid mediaPathname");
  if (errors.length) {
    res.status(422).json({ error: "Validation failed", details: errors });
    return;
  }

  const item = {
    id,
    title,
    category,
    description: description || "",
    mediaType,
    mediaPathname,
    posterPathname: posterPathname || null,
    rawPathname: rawPathname || null,
    featuredHome: Boolean(featuredHome),
    createdAt: new Date().toISOString(),
  };

  await put(`portfolio/${id}.json`, JSON.stringify(item, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });

  res.status(200).json({ ok: true, item });
}
