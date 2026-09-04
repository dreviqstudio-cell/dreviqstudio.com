import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

export const config = { runtime: "edge" };

/**
 * STUB. Records/validates a production brief but does NOT trigger real
 * generation yet — the content engine (LangGraph pipeline, Replicate
 * calls, Whisper/ffmpeg) is a multi-minute local Python process, which
 * can't run inside a serverless function (execution time limits) or the
 * Edge runtime (no Python, no ffmpeg binary). Wiring this up for real
 * needs a proper async job architecture: this endpoint enqueues a job,
 * a separate always-on worker (or a queue + Vercel Fluid Compute /
 * external server) actually runs the pipeline, and the dashboard polls
 * or gets notified for status. Not built yet — see dreviq_agent/README.md
 * for the pipeline this will eventually call.
 *
 * For now this only checks auth + validates input shape, so the frontend
 * has something real to build against once the worker exists.
 */
export default async function handler(request) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = parseCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (!secret || !(await verifySessionToken(token, secret))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { clientName, prompt, aspectRatio, sceneCount } = body || {};
  const errors = [];
  if (!clientName || typeof clientName !== "string") errors.push("clientName is required");
  if (!prompt || typeof prompt !== "string") errors.push("prompt is required");
  if (!["16:9", "9:16"].includes(aspectRatio)) errors.push("aspectRatio must be 16:9 or 9:16");
  const scenes = Number(sceneCount);
  if (!Number.isInteger(scenes) || scenes < 1 || scenes > 10) errors.push("sceneCount must be an integer 1-10");

  if (errors.length) {
    return new Response(JSON.stringify({ error: "Validation failed", details: errors }), { status: 422 });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      status: "received_not_queued",
      note:
        "Brief validated and logged. Real generation isn't wired up yet — this endpoint doesn't call the content engine. See dreviq_agent/README.md.",
      brief: { clientName, prompt, aspectRatio, sceneCount: scenes },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
