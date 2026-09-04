/**
 * Cloudflare Pages middleware — gates every /admin/* request behind a valid
 * session cookie before it reaches the static HTML (or a function under
 * functions/admin/*). Placing this file at functions/admin/_middleware.js
 * scopes it to that path prefix automatically (Pages convention), same as
 * the old Vercel middleware.js's `matcher: ["/admin/:path*"]`.
 */
import { isAdmin } from "../_lib/auth.js";

const PUBLIC_ADMIN_PATHS = new Set(["/admin/login.html", "/admin/login"]);

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (PUBLIC_ADMIN_PATHS.has(url.pathname)) {
    return next(); // let the login page through unauthenticated
  }

  if (!(await isAdmin(request, context.env))) {
    const loginUrl = new URL("/admin/login.html", request.url);
    loginUrl.searchParams.set("next", url.pathname);
    return Response.redirect(loginUrl, 302);
  }

  return next(); // authenticated — fall through to the requested file/function
}
