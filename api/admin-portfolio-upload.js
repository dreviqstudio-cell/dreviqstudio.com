import { put } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

const MAX_FILE_BYTES = 40 * 1024 * 1024; // 40MB — generous for a short web clip/image

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const [, mime, b64] = match;
  const ext = mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
  return { mime, ext, bytes: base64ToBytes(b64) };
}

/**
 * Admin-only: uploads a portfolio item (image or video, optional poster
 * for video, optional "raw" before-image to pair with the main media for
 * the homepage pipeline showcase). Node.js runtime — @vercel/blob needs
 * Node builtins.
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
  const { title, category, description, mediaType, mediaDataUrl, posterDataUrl, rawDataUrl, featuredHome } = body;

  const errors = [];
  if (!title || typeof title !== "string") errors.push("title is required");
  if (!category || typeof category !== "string") errors.push("category is required");
  if (!["video", "image"].includes(mediaType)) errors.push("mediaType must be video or image");
  if (!mediaDataUrl || typeof mediaDataUrl !== "string") errors.push("mediaDataUrl is required");
  if (errors.length) {
    res.status(422).json({ error: "Validation failed", details: errors });
    return;
  }

  const media = parseDataUrl(mediaDataUrl);
  if (!media) {
    res.status(422).json({ error: "mediaDataUrl is not a valid data URL" });
    return;
  }
  if (media.bytes.length > MAX_FILE_BYTES) {
    res.status(413).json({ error: `Media file too large (max ${MAX_FILE_BYTES / 1024 / 1024}MB)` });
    return;
  }

  const id = `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const mediaUpload = await put(`portfolio/${id}/media.${media.ext}`, media.bytes, {
    access: "private",
    addRandomSuffix: false,
    contentType: media.mime,
  });

  let posterPathname = null;
  if (mediaType === "video" && typeof posterDataUrl === "string" && posterDataUrl.startsWith("data:")) {
    const poster = parseDataUrl(posterDataUrl);
    if (poster) {
      const uploaded = await put(`portfolio/${id}/poster.${poster.ext}`, poster.bytes, {
        access: "private",
        addRandomSuffix: false,
        contentType: poster.mime,
      });
      posterPathname = uploaded.pathname;
    }
  }

  let rawPathname = null;
  if (typeof rawDataUrl === "string" && rawDataUrl.startsWith("data:")) {
    const raw = parseDataUrl(rawDataUrl);
    if (raw) {
      const uploaded = await put(`portfolio/${id}/raw.${raw.ext}`, raw.bytes, {
        access: "private",
        addRandomSuffix: false,
        contentType: raw.mime,
      });
      rawPathname = uploaded.pathname;
    }
  }

  const item = {
    id,
    title,
    category,
    description: description || "",
    mediaType,
    mediaPathname: mediaUpload.pathname,
    posterPathname,
    rawPathname,
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
