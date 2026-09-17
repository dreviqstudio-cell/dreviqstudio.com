/**
 * WhatsApp Cloud API (Meta) — sending messages and verifying inbound
 * webhook signatures. Official API, not a self-hosted/unofficial library —
 * see the Shilpi-via-WhatsApp discussion: an unofficial library risks a
 * ban on whatever real number runs it, which isn't worth it for this.
 *
 * Required env vars (set in Cloudflare Pages project settings):
 *   WHATSAPP_ACCESS_TOKEN     system-user or temporary access token
 *   WHATSAPP_PHONE_NUMBER_ID  the "from" number's phone_number_id
 *   WHATSAPP_APP_SECRET       Meta app secret, for verifying that inbound
 *                             webhook POSTs genuinely came from Meta
 *   WHATSAPP_VERIFY_TOKEN     arbitrary string you also paste into Meta's
 *                             webhook setup screen, for the GET handshake
 *   WHATSAPP_ALLOWED_NUMBERS  comma-separated E.164 numbers (no "+", e.g.
 *                             "919876543210") allowed to trigger jobs —
 *                             everyone else's messages are ignored
 */

const GRAPH_API_VERSION = "v20.0";

export async function sendWhatsAppText(env, toNumber, body) {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toNumber,
        type: "text",
        text: { body },
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`WhatsApp send failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

/** True if `to` is in the comma-separated WHATSAPP_ALLOWED_NUMBERS list —
 * the only guard against a stranger who finds the webhook URL creating
 * jobs (paid API calls) on your account. */
export function isAllowedSender(env, fromNumber) {
  const allowed = (env.WHATSAPP_ALLOWED_NUMBERS || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return allowed.includes(fromNumber);
}

/** Verifies X-Hub-Signature-256 against the RAW request body (must be the
 * exact bytes Meta sent, before any JSON.parse) using the app secret.
 * Without this, anyone who discovers the webhook URL could POST a forged
 * payload claiming `from` is your own number, bypassing isAllowedSender
 * entirely — the sender-number check alone only guards data INSIDE a
 * request we haven't yet proven came from Meta. */
export async function verifyMetaSignature(env, rawBodyText, signatureHeader) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expectedHex = signatureHeader.slice("sha256=".length);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.WHATSAPP_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBodyText));
  const actualHex = [...new Uint8Array(signatureBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");

  // Constant-time-ish comparison — lengths already match (both hex SHA-256).
  if (actualHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHex.length; i++) diff |= actualHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}
