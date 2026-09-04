import { get } from "@vercel/blob";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

export const config = { runtime: "edge" };

/**
 * Streams a job's result file (video/srt/reference photo) through our own
 * admin auth, instead of exposing raw private Blob URLs to the browser.
 * NOTE: fine for now (test-sized outputs); a real multi-MB/GB video will
 * need presigned download URLs instead of proxying through a function —
 * flagged as a follow-up, not solved here.
 */
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
  const path = searchParams.get("path");
  // Only ever allow reading inside jobs/ — this is a shared bucket, not a
  // general-purpose file proxy.
  if (!path || !/^jobs\/[a-zA-Z0-9_.\/-]+$/.test(path) || path.includes("..")) {
    return new Response(JSON.stringify({ error: "Invalid path" }), { status: 400 });
  }

  const result = await get(path, { access: "private" });
  if (!result) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  return new Response(result.stream, {
    status: 200,
    headers: { "Content-Type": result.blob.contentType || "application/octet-stream" },
  });
}
