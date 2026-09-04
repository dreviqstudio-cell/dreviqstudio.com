import { COOKIE_NAME, verifySessionToken, parseCookie } from "./session.js";

/** Returns true if the request carries a valid admin session cookie. */
export async function isAdmin(request, env) {
  const secret = env.ADMIN_SESSION_SECRET;
  const token = parseCookie(request.headers.get("cookie"), COOKIE_NAME);
  return Boolean(secret) && (await verifySessionToken(token, secret));
}
