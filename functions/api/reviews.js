import { b2GetJson, b2List, b2PutJson } from "../_lib/b2.js";
import { json, readJsonBody } from "../_lib/http.js";

/**
 * PUBLIC — GET returns only approved reviews (for the public reviews.html
 * page); POST submits a new one. New submissions default to "pending" and
 * are NOT publicly visible until an admin approves them via
 * admin/reviews.html — a public review form with no login is an open
 * spam/abuse vector otherwise, so moderation-before-publish is the
 * deliberate default here, not an oversight.
 */
export async function onRequest({ request, env }) {
  if (request.method === "GET") {
    const keys = await b2List(env, "reviews/", { limit: 200 });
    const files = keys.filter((k) => k.endsWith(".json"));
    const reviews = (await Promise.all(files.map((k) => b2GetJson(env, k))))
      .filter((r) => r && r.status === "approved");

    reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return json(
      {
        reviews: reviews.map((r) => ({
          name: r.name,
          brand: r.brand,
          service: r.service,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt,
        })),
      },
      200,
      { "Cache-Control": "public, max-age=60" }
    );
  }

  if (request.method === "POST") {
    const body = (await readJsonBody(request)) || {};
    const { name, brand, service, rating, comment, email } = body;

    const errors = [];
    if (!name || typeof name !== "string" || !name.trim()) errors.push("name is required");
    if (!comment || typeof comment !== "string" || !comment.trim()) errors.push("comment is required");
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) errors.push("rating must be 1-5");
    if (comment && comment.length > 2000) errors.push("comment is too long (max 2000 chars)");
    if (errors.length) {
      return json({ error: "Validation failed", details: errors }, 422);
    }

    const id = `rev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const review = {
      id,
      name: name.trim().slice(0, 100),
      brand: (brand || "").trim().slice(0, 100),
      service: (service || "").trim().slice(0, 100),
      rating: ratingNum,
      comment: comment.trim().slice(0, 2000),
      email: (email || "").trim().slice(0, 200), // admin-only, never returned by GET
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    await b2PutJson(env, `reviews/${id}.json`, review);

    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}
