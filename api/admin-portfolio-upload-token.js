import { handleUpload } from "@vercel/blob/client";
import { COOKIE_NAME, verifySessionToken, parseCookie } from "../lib/session.js";

/**
 * Issues client-upload tokens so the browser can send files DIRECTLY to
 * Blob storage, bypassing Vercel's 4.5MB serverless function request body
 * limit entirely (the earlier base64-in-JSON approach hit this hard for
 * any real video file — "Request Entity Too Large").
 *
 * `request: req` works here because @vercel/blob's handleUpload accepts a
 * Node IncomingMessage directly (confirmed against the installed
 * package's own type defs, not assumed) — matches this project's classic
 * (req, res) Node runtime convention.
 *
 * No onUploadCompleted here deliberately: that webhook needs a publicly
 * reachable URL (breaks under local `vercel dev`, per Vercel's own docs),
 * so the actual "create the portfolio item record" step happens via the
 * client's own direct call to admin-portfolio-finalize.js after upload()
 * resolves — simpler, and testable locally.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (!secret || !(await verifySessionToken(token, secret))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("portfolio/")) {
          throw new Error("Uploads are only allowed under portfolio/");
        }
        return {
          allowedContentTypes: ["image/*", "video/*"],
          maximumSizeInBytes: 200 * 1024 * 1024, // 200MB — generous for a web video
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
    });
    res.status(200).json(jsonResponse);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}
