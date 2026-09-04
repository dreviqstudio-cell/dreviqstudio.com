import { b2GetJson, b2List, b2PutJson } from "../_lib/b2.js";
import { isAdmin } from "../_lib/auth.js";
import { json, readJsonBody } from "../_lib/http.js";

const VALID_STATUSES = ["new", "contacted", "closed"];

export async function onRequest({ request, env }) {
  if (!(await isAdmin(request, env))) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (request.method === "GET") {
    const keys = await b2List(env, "inquiries/", { limit: 200 });
    const files = keys.filter((k) => k.endsWith(".json"));
    const inquiries = (await Promise.all(files.map((k) => b2GetJson(env, k)))).filter(Boolean);
    inquiries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return json({ inquiries });
  }

  if (request.method === "POST") {
    const body = (await readJsonBody(request)) || {};
    const { id, status } = body;
    if (!id || typeof id !== "string" || !/^inq_[a-z0-9]+$/i.test(id)) {
      return json({ error: "Invalid id" }, 400);
    }
    if (!VALID_STATUSES.includes(status)) {
      return json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, 400);
    }
    const inquiry = await b2GetJson(env, `inquiries/${id}.json`);
    if (!inquiry) return json({ error: "Inquiry not found" }, 404);
    inquiry.status = status;
    inquiry.updatedAt = new Date().toISOString();
    await b2PutJson(env, `inquiries/${id}.json`, inquiry);
    return json({ ok: true, inquiry });
  }

  return json({ error: "Method not allowed" }, 405);
}
