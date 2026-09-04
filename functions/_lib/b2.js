/**
 * Backblaze B2 client for Cloudflare Pages Functions — replaces @vercel/blob.
 *
 * B2 exposes an S3-compatible API, so this signs requests with SigV4 via
 * aws4fetch (a tiny, dependency-free signer built for the Workers/fetch
 * runtime — @aws-sdk/client-s3 pulls in Node builtins that don't belong
 * here). Every function takes `env` first so callers pass the Pages
 * Functions `context.env` binding straight through (no process.env in
 * this runtime).
 *
 * Required env vars (set in the Cloudflare Pages project settings):
 *   B2_KEY_ID            application key ID
 *   B2_APPLICATION_KEY   application key secret
 *   B2_BUCKET            bucket name, e.g. "dreviq-jobs"
 *   B2_ENDPOINT          full https endpoint, e.g.
 *                        "https://s3.us-west-004.backblazeb2.com"
 *   B2_REGION            the region segment of the endpoint, e.g. "us-west-004"
 *
 * Object model mirrors what the old @vercel/blob-based routes needed:
 * get/put/del/head/list on "pathname" keys (e.g. "jobs/job_abc/status.json"),
 * plus a presigned-PUT helper for direct browser-to-B2 uploads (replaces
 * @vercel/blob/client's handleUpload()/upload()).
 */

import { AwsClient } from "aws4fetch";

function client(env) {
  return new AwsClient({
    accessKeyId: env.B2_KEY_ID,
    secretAccessKey: env.B2_APPLICATION_KEY,
    service: "s3",
    region: env.B2_REGION,
  });
}

function keyUrl(env, pathname) {
  const encodedPath = pathname
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${env.B2_ENDPOINT.replace(/\/+$/, "")}/${env.B2_BUCKET}/${encodedPath}`;
}

/** GET an object. Returns the raw Response on success (caller reads
 *  .text()/.arrayBuffer()/.headers as needed), or null if it doesn't exist. */
export async function b2Get(env, pathname) {
  const res = await client(env).fetch(keyUrl(env, pathname));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`B2 GET ${pathname} failed: ${res.status} ${await res.text().catch(() => "")}`);
  return res;
}

/** Convenience: GET + parse JSON. Returns null if missing or invalid. */
export async function b2GetJson(env, pathname) {
  const res = await b2Get(env, pathname);
  if (!res) return null;
  try {
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

/** PUT an object. `body` can be a string, ArrayBuffer, Blob, or ReadableStream. */
export async function b2Put(env, pathname, body, { contentType } = {}) {
  const headers = {};
  if (contentType) headers["Content-Type"] = contentType;
  const res = await client(env).fetch(keyUrl(env, pathname), { method: "PUT", body, headers });
  if (!res.ok) throw new Error(`B2 PUT ${pathname} failed: ${res.status} ${await res.text().catch(() => "")}`);
  return true;
}

/** Convenience: PUT a JSON-serializable value. */
export async function b2PutJson(env, pathname, value) {
  return b2Put(env, pathname, JSON.stringify(value, null, 2), { contentType: "application/json" });
}

/** DELETE an object (or several). Missing objects are not an error. */
export async function b2Delete(env, pathnames) {
  const list = Array.isArray(pathnames) ? pathnames : [pathnames];
  await Promise.all(
    list.map(async (pathname) => {
      const res = await client(env).fetch(keyUrl(env, pathname), { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        throw new Error(`B2 DELETE ${pathname} failed: ${res.status}`);
      }
    })
  );
  return true;
}

/** HEAD — true if the object exists. */
export async function b2Head(env, pathname) {
  const res = await client(env).fetch(keyUrl(env, pathname), { method: "HEAD" });
  return res.ok;
}

/** List object keys under a prefix (S3 ListObjectsV2). */
export async function b2List(env, prefix, { limit = 1000 } = {}) {
  const url = new URL(`${env.B2_ENDPOINT.replace(/\/+$/, "")}/${env.B2_BUCKET}`);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("prefix", prefix);
  url.searchParams.set("max-keys", String(limit));
  const res = await client(env).fetch(url.toString());
  if (!res.ok) throw new Error(`B2 LIST ${prefix} failed: ${res.status} ${await res.text().catch(() => "")}`);
  const xml = await res.text();
  return [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) =>
    m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  );
}

/**
 * Presigned PUT URL for direct browser-to-B2 uploads (replaces
 * @vercel/blob/client's token-issuing flow). The browser then does:
 *   fetch(presignedUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
 * `contentType` here must match what the browser sends, since it's part
 * of the signature (SignedHeaders includes content-type).
 */
export async function b2PresignPut(env, pathname, { contentType, expiresIn = 900 } = {}) {
  const url = new URL(keyUrl(env, pathname));
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  const headers = contentType ? { "Content-Type": contentType } : {};
  const signedRequest = await client(env).sign(url, {
    method: "PUT",
    headers,
    aws: { signQuery: true },
  });
  return signedRequest.url;
}
