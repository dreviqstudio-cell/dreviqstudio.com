import { get } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

export const config = { runtime: "edge" };

export default async function handler(request) {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = parseCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (!secret || !(await verifySessionToken(token, secret))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id || !/^job_[a-z0-9]+$/i.test(id)) {
    return new Response(JSON.stringify({ error: "Invalid job id" }), { status: 400 });
  }

  const result = await get(`jobs/${id}.json`, { access: "private", useCache: false });
  if (!result) {
    return new Response(JSON.stringify({ error: "Job not found" }), { status: 404 });
  }

  const text = await new Response(result.stream).text();
  return new Response(text, { status: 200, headers: { "Content-Type": "application/json" } });
}
