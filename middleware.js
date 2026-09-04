import { COOKIE_NAME, verifySessionToken, parseCookie } from "./lib/session.js";

export const config = {
  matcher: ["/admin/:path*"],
};

const PUBLIC_ADMIN_PATHS = new Set(["/admin/login.html", "/admin/login"]);

export default async function middleware(request) {
  const url = new URL(request.url);

  if (PUBLIC_ADMIN_PATHS.has(url.pathname)) {
    return; // let the login page through unauthenticated
  }

  const token = parseCookie(request.headers.get("cookie"), COOKIE_NAME);
  const secret = process.env.ADMIN_SESSION_SECRET;
  const valid = secret && (await verifySessionToken(token, secret));

  if (!valid) {
    const loginUrl = new URL("/admin/login.html", request.url);
    loginUrl.searchParams.set("next", url.pathname);
    return Response.redirect(loginUrl, 302);
  }

  // authenticated — fall through to the requested static file
}
