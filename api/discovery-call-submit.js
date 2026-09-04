import { put } from "@vercel/blob";

/**
 * PUBLIC (no auth) — receives the contact.html Discovery Call intake
 * form. Previously this form was 100% fake: it showed a "Discovery Brief
 * Received" success message with no backend at all, so submissions went
 * nowhere and nobody at the studio ever saw them. This is the real fix.
 * Node.js runtime — @vercel/blob needs Node builtins.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body || {};
  const { brand, category, assets, timeline, platform, email, whatsapp } = body;

  const errors = [];
  if (!brand || typeof brand !== "string" || !brand.trim()) errors.push("brand is required");
  if (!email || typeof email !== "string" || !email.includes("@")) errors.push("a valid email is required");
  if (!Array.isArray(assets)) errors.push("assets must be an array");
  if (errors.length) {
    res.status(422).json({ error: "Validation failed", details: errors });
    return;
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

  await put(`inquiries/${id}.json`, JSON.stringify(inquiry, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });

  res.status(200).json({ ok: true });
}
