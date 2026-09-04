import { b2GetJson, b2List, b2PutJson, b2Delete } from "../_lib/b2.js";
import { isAdmin } from "../_lib/auth.js";
import { json, readJsonBody } from "../_lib/http.js";

const VALID_STATUSES = ["pending", "approved", "rejected"];

export async function onRequest({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (request.method === "GET") {
    const keys = await b2List(env, "reviews/", { limit: 200 });
    const files = keys.filter((k) => k.endsWith(".json"));
    const reviews = (await Promise.all(files.map((k) => b2GetJson(env, k)))).filter(Boolean);
    reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return json({ reviews });
  }

  if (request.method === "POST") {
    const body = (await readJsonBody(request)) || {};
    const { id, action } = body;
    if (!id || typeof id !== "string" || !/^rev_[a-z0-9]+$/i.test(id)) {
      return json({ error: "Invalid id" }, 400);
    }

    if (action === "delete") {
      await b2Delete(env, `reviews/${id}.json`);
      return json({ ok: true });
    }

    if (!VALID_STATUSES.includes(action)) {
      return json({ error: `action must be one of: delete, ${VALID_STATUSES.join(", ")}` }, 400);
    }

    const review = await b2GetJson(env, `reviews/${id}.json`);
    if (!review) return json({ error: "Review not found" }, 404);
    review.status = action;
    review.updatedAt = new Date().toISOString();
    await b2PutJson(env, `reviews/${id}.json`, review);
    return json({ ok: true, review });
  }

  return json({ error: "Method not allowed" }, 405);
}
