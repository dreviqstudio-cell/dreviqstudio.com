import { COOKIE_NAME, SESSION_TTL_MS, createSessionToken } from "../_lib/session.js";
import { json, readJsonBody } from "../_lib/http.js";

// Combines login + logout into one function, routed by ?action= — same
// grouping the old Vercel routes used (kept as-is, no longer required by
// a function-count cap on Cloudflare Pages, but no reason to re-split it).

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleLogin(request, env) {
  const adminPassword = env.ADMIN_PASSWORD;
  const sessionSecret = env.ADMIN_SESSION_SECRET;
  if (!adminPassword || !sessionSecret) {
    return json({ error: "Server not configured" }, 500);
  }

  const body = await readJsonBody(request);
  if (!body) return json({ error: "Invalid request" }, 400);

  const password = typeof body.password === "string" ? body.password : "";
  if (!password || !timingSafeEqualStr(password, adminPassword)) {
    return json({ error: "Invalid credentials" }, 401);
  }

  const token = await createSessionToken(sessionSecret);
  const isLocal = new URL(request.url).hostname === "localhost";
  const cookie = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ...(isLocal ? [] : ["Secure"]),
  ].join("; ");

  return json({ ok: true }, 200, { "Set-Cookie": cookie });
}

function handleLogout() {
  const cookie = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"].join("; ");
  return json({ ok: true }, 200, { "Set-Cookie": cookie });
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  if (action === "logout") return handleLogout();
  return handleLogin(request, env);
}
