import { b2Get, b2GetJson, b2List } from "../_lib/b2.js";
import { json, bytes } from "../_lib/http.js";

// Combines the item-list and single-media-file routes — mirrors the old
// grouping. PUBLIC (no auth) — both were already public.
export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const path = url.searchParams.get("path");

  if (path) {
    if (!/^portfolio\/[a-zA-Z0-9_.\/-]+$/.test(path) || path.includes("..")) {
      return json({ error: "Invalid path" }, 400);
    }
    const result = await b2Get(env, path);
    if (!result) return json({ error: "Not found" }, 404);
    const buf = await result.arrayBuffer();
    return bytes(buf, {
      contentType: result.headers.get("content-type") || "application/octet-stream",
      cacheControl: "public, max-age=3600",
    });
  }

  const keys = await b2List(env, "portfolio/", { limit: 200 });
  const itemKeys = keys.filter((k) => /^portfolio\/[^/]+\.json$/.test(k));

  const items = (await Promise.all(itemKeys.map((k) => b2GetJson(env, k)))).filter(Boolean);
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return json({ items }, 200, { "Cache-Control": "public, max-age=60" });
}
