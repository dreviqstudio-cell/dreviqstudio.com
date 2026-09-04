import { put, head, del } from "@vercel/blob";
import { handleUpload } from "@vercel/blob/client";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

// Combines admin-portfolio-upload-token.js + admin-portfolio-finalize.js +
// admin-portfolio-delete.js — see api/admin-auth.js for why (12-function
// Hobby plan cap). Routed by ?action= so we don't have to sniff the
// request body's shape (the client-upload token step's body shape is
// controlled by @vercel/blob itself, not something we designed).

async function requireAdmin(req, res) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (!secret || !(await verifySessionToken(token, secret))) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

async function handleToken(req, res) {
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("portfolio/")) {
          throw new Error("Uploads are only allowed under portfolio/");
        }
        return {
          allowedContentTypes: ["image/*", "video/*"],
          maximumSizeInBytes: 200 * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
    });
    res.status(200).json(jsonResponse);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

async function handleFinalize(req, res) {
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

async function handleDelete(req, res) {
  const { id } = req.body || {};
  if (!id || typeof id !== "string" || !/^p_[a-z0-9]+$/i.test(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

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
        /* doesn't exist */
      }
    })
  );

  if (toDelete.length) await del(toDelete);
  res.status(200).json({ ok: true, deleted: toDelete });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const action = req.query.action;

  // Token generation is authorized inline via onBeforeGenerateToken-style
  // checks isn't enough on its own — require the admin session up front
  // for every action here, including token issuance.
  if (!(await requireAdmin(req, res))) return;

  if (action === "token") return handleToken(req, res);
  if (action === "finalize") return handleFinalize(req, res);
  if (action === "delete") return handleDelete(req, res);

  res.status(400).json({ error: "Unknown or missing ?action=" });
}
