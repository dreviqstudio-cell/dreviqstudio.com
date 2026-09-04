import { COOKIE_NAME, SESSION_TTL_MS, createSessionToken } from "../lib/session.js";

export const config = { runtime: "edge" };

// Combines the old admin-login.js + admin-logout.js into one function —
// Vercel's Hobby plan caps a deployment at 12 Serverless Functions, and
// this project outgrew that as features were added. See api/README-
// consolidation note in the PR that introduced this file.

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleLogin(request) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  if (!adminPassword || !sessionSecret) {
    return new Response(JSON.stringify({ error: "Server not configured" }), { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!password || !timingSafeEqualStr(password, adminPassword)) {
    return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });
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

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
  });
}

function handleLogout() {
  const cookie = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"].join("; ");
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
  });
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  if (action === "logout") return handleLogout();
  return handleLogin(request);
}
