/** Small Response-building helpers, shared across functions/api/*.js. */

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export function bytes(buf, { contentType = "application/octet-stream", status = 200, cacheControl } = {}) {
  const headers = { "Content-Type": contentType };
  if (cacheControl) headers["Cache-Control"] = cacheControl;
  return new Response(buf, { status, headers });
}

export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
