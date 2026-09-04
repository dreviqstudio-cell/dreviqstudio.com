import { b2PutJson } from "../_lib/b2.js";
import { json, readJsonBody } from "../_lib/http.js";

/**
 * PUBLIC (no auth) — receives the contact.html Discovery Call intake form.
 */
export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const body = (await readJsonBody(request)) || {};
  const { brand, category, assets, timeline, platform, email, whatsapp } = body;

  const errors = [];
  if (!brand || typeof brand !== "string" || !brand.trim()) errors.push("brand is required");
  if (!email || typeof email !== "string" || !email.includes("@")) errors.push("a valid email is required");
  if (!Array.isArray(assets)) errors.push("assets must be an array");
  if (errors.length) {
    return json({ error: "Validation failed", details: errors }, 422);
  }

  const id = `inq_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const inquiry = {
    id,
    brand: brand.trim(),
    category: category || "",
    assets,
    timeline: timeline || "",
    platform: platform || "",
    email: email.trim(),
    whatsapp: whatsapp || "",
    status: "new",
    createdAt: new Date().toISOString(),
  };

  await b2PutJson(env, `inquiries/${id}.json`, inquiry);

  return json({ ok: true });
}
