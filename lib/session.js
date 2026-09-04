/**
 * Shared session-token helpers. Written to run identically under:
 *  - Vercel Node.js serverless functions (api/*.js)
 *  - Vercel Edge Middleware (middleware.js)
 * using only Web Crypto (crypto.subtle), which both runtimes provide, so
 * there's one implementation instead of two that have to stay in sync.
 *
 * Token format: base64url(payloadJson) + "." + base64url(hmacSha256(payloadJson))
 * Payload: { exp: <unix ms> }
 *
 * Kept small and dependency-free on purpose — this gates a small internal
 * admin panel for one team, not a multi-tenant auth system.
 */

export const COOKIE_NAME = "dreviq_admin_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function base64UrlEncodeBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeString(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeToString(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "===".slice((b64.length + 3) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

async function hmacSign(payloadStr, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadStr));
  return base64UrlEncodeBuffer(sigBuf);
}

export async function createSessionToken(secret, ttlMs = SESSION_TTL_MS) {
  const payloadStr = JSON.stringify({ exp: Date.now() + ttlMs });
  const payloadB64 = base64UrlEncodeString(payloadStr);
  const sig = await hmacSign(payloadStr, secret);
  return `${payloadB64}.${sig}`;
}

export async function verifySessionToken(token, secret) {
  if (!token || !token.includes(".")) return false;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return false;
  let payloadStr;
  try {
    payloadStr = base64UrlDecodeToString(payloadB64);
  } catch {
    return false;
  }
  const expectedSig = await hmacSign(payloadStr, secret);
  if (expectedSig.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    diff |= expectedSig.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (diff !== 0) return false;
  try {
    const payload = JSON.parse(payloadStr);
    return typeof payload.exp === "number" && Date.now() < payload.exp;
  } catch {
    return false;
  }
}

export function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
