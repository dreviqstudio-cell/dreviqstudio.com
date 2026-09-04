import { b2PresignPut, b2Head, b2Delete, b2PutJson } from "../_lib/b2.js";
import { isAdmin } from "../_lib/auth.js";
import { json, readJsonBody } from "../_lib/http.js";

// Combines upload-token + finalize + delete — same grouping the old Vercel
// routes used, routed by ?action=.
//
// Upload flow changed with the B2 migration: instead of a Vercel client
// upload token, this issues a short-lived presigned PUT URL. The browser
// then does `fetch(presignedUrl, { method: "PUT", headers: {"Content-Type":
// file.type}, body: file })` directly against B2 — no file bytes ever pass
// through this function. See admin/portfolio.html for the caller.

async function handleToken(request, env) {
  const body = (await readJsonBody(request)) || {};
  const { pathname, contentType } = body;
  if (!pathname || typeof pathname !== "string" || !pathname.startsWith("portfolio/")) {
    return json({ error: "Uploads are only allowed under portfolio/" }, 400);
  }
  if (!contentType || typeof contentType !== "string" || !/^(image|video)\//.test(contentType)) {
    return json({ error: "contentType must be image/* or video/*" }, 400);
  }
  const url = await b2PresignPut(env, pathname, { contentType, expiresIn: 900 });
  return json({ url, pathname });
}

async function handleFinalize(request, env) {
  const body = (await readJsonBody(request)) || {};
  const { id, title, category, description, mediaType, mediaPathname, posterPathname, rawPathname, featuredHome } = body;

  const errors = [];
  if (!id || typeof id !== "string" || !/^p_[a-z0-9]+$/i.test(id)) errors.push("invalid id");
  if (!title || typeof title !== "string") errors.push("title is required");
  if (!category || typeof category !== "string") errors.push("category is required");
  if (!["video", "image"].includes(mediaType)) errors.push("mediaType must be video or image");
  if (!mediaPathname || !mediaPathname.startsWith(`portfolio/${id}/`)) errors.push("invalid mediaPathname");
  if (errors.length) {
    return json({ error: "Validation failed", details: errors }, 422);
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

  await b2PutJson(env, `portfolio/${id}.json`, item);

  return json({ ok: true, item });
}

async function handleDelete(request, env) {
  const body = (await readJsonBody(request)) || {};
  const { id } = body;
  if (!id || typeof id !== "string" || !/^p_[a-z0-9]+$/i.test(id)) {
    return json({ error: "Invalid id" }, 400);
  }

  const candidates = [];
  for (const ext of ["jpg", "jpeg", "png", "webp", "gif", "mp4", "mov", "webm"]) {
    candidates.push(`portfolio/${id}/media.${ext}`, `portfolio/${id}/poster.${ext}`, `portfolio/${id}/raw.${ext}`);
  }
  candidates.push(`portfolio/${id}.json`);

  const toDelete = [];
  await Promise.all(
    candidates.map(async (pathname) => {
      if (await b2Head(env, pathname)) toDelete.push(pathname);
    })
  );

  if (toDelete.length) await b2Delete(env, toDelete);
  return json({ ok: true, deleted: toDelete });
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Require the admin session up front for every action here, including
  // token issuance — a presign endpoint with no auth is an open write to
  // the bucket.
  if (!(await isAdmin(request, env))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const action = new URL(request.url).searchParams.get("action");
  if (action === "token") return handleToken(request, env);
  if (action === "finalize") return handleFinalize(request, env);
  if (action === "delete") return handleDelete(request, env);

  return json({ error: "Unknown or missing ?action=" }, 400);
}
