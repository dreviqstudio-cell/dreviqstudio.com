import { list, get, put } from "@vercel/blob";

/**
 * PUBLIC — GET returns only approved reviews (for the public reviews.html
 * page); POST submits a new one. New submissions default to "pending" and
 * are NOT publicly visible until an admin approves them via
 * admin/reviews.html — a public review form with no login is an open
 * spam/abuse vector otherwise, so moderation-before-publish is the
 * deliberate default here, not an oversight.
 */
export default async function handler(req, res) {
  if (req.method === "GET") {
    const { blobs } = await list({ prefix: "reviews/", limit: 200 });
    const files = blobs.filter((b) => b.pathname.endsWith(".json"));
    const reviews = (
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
    ).filter((r) => r && r.status === "approved");

    reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json({
      reviews: reviews.map((r) => ({
        name: r.name,
        brand: r.brand,
        service: r.service,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
      })),
    });
    return;
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const { name, brand, service, rating, comment, email } = body;

    const errors = [];
    if (!name || typeof name !== "string" || !name.trim()) errors.push("name is required");
    if (!comment || typeof comment !== "string" || !comment.trim()) errors.push("comment is required");
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) errors.push("rating must be 1-5");
    if (comment && comment.length > 2000) errors.push("comment is too long (max 2000 chars)");
    if (errors.length) {
      res.status(422).json({ error: "Validation failed", details: errors });
      return;
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

    await put(`reviews/${id}.json`, JSON.stringify(review, null, 2), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });

    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
