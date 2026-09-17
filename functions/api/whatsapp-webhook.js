import { b2PutJson } from "../_lib/b2.js";
import { sendWhatsAppText, isAllowedSender, verifyMetaSignature } from "../_lib/whatsapp.js";

// Lets the user (and only the user — see isAllowedSender) trigger a Shilpi
// reel by WhatsApp message while away from a computer, without touching
// anything on admin/shilpi.html. A WhatsApp job is just another way to
// write into the same shilpi-jobs/ B2 prefix that page writes into — the
// worker doesn't know or care which path created a job.
//
// Deliberately text-only for v1: no product-photo b-roll via WhatsApp
// (that still needs the website, where multi-file upload is easy). This
// avoids needing a whole stateful multi-message "conversation" just to
// collect a batch of photos before queuing — one message in, one job
// queued, nothing to get stuck half-finished.
//
// Command format (first line is the client name; add a leading "Client:"
// or not, both work):
//   Rani Sarees
//   <the full Odia script, one or more lines>

function makeJobId() {
  return `shilpi_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function parseCommand(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  let clientName = lines[0];
  let scriptLines = lines.slice(1);
  const clientPrefixMatch = clientName.match(/^client\s*:\s*(.+)$/i);
  if (clientPrefixMatch) clientName = clientPrefixMatch[1].trim();

  const script = scriptLines.join("\n").trim();
  if (!clientName || !script) return null;
  return { clientName, script };
}

async function handleVerify(request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge || "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// Every reply is best-effort: this handler must return 2xx once it has
// done its actual job (queuing, or correctly deciding not to), otherwise
// Meta retries the whole webhook delivery and a paid job could get queued
// twice for one message.
async function safeSend(env, to, body) {
  try {
    await sendWhatsAppText(env, to, body);
  } catch (err) {
    console.error(`WhatsApp send to ${to} failed:`, err);
  }
}

async function handleIncoming(request, env) {
  const rawBody = await request.text();
  const signatureOk = await verifyMetaSignature(env, rawBody, request.headers.get("X-Hub-Signature-256"));
  if (!signatureOk) {
    // Don't leak *why* — just refuse. A forged payload can't get further
    // than this regardless of what "from" number it claims.
    return new Response("Forbidden", { status: 403 });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("OK", { status: 200 }); // malformed, nothing to do — still 200 so Meta doesn't retry forever
  }

  const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) {
    return new Response("OK", { status: 200 }); // e.g. a delivery-status callback, not a new message
  }

  const from = message.from;
  if (!isAllowedSender(env, from)) {
    return new Response("OK", { status: 200 }); // silently ignore strangers — don't confirm a bot is listening
  }

  if (message.type !== "text") {
    await safeSend(
      env,
      from,
      "Only text commands work here right now. Send: client name on the first line, then the Odia script on the next — product photos still need admin/shilpi.html on the website."
    );
    return new Response("OK", { status: 200 });
  }

  const parsed = parseCommand(message.text.body || "");
  if (!parsed) {
    await safeSend(
      env,
      from,
      "Couldn't read that. Format:\n<client name>\n<the Odia script>\n\n(two lines minimum — first line is the client, everything after is what Shilpi says)"
    );
    return new Response("OK", { status: 200 });
  }

  const id = makeJobId();
  const now = new Date().toISOString();
  const job = {
    id,
    status: "queued",
    clientName: parsed.clientName,
    script: parsed.script,
    brollPathnames: [],
    musicPathname: null,
    captionsEnabled: true,
    createdAt: now,
    updatedAt: now,
    resultVideoPathname: null,
    error: null,
    source: "whatsapp",
    notifyWhatsapp: from,
  };
  await b2PutJson(env, `shilpi-jobs/${id}.json`, job);

  await safeSend(
    env,
    from,
    `Queued for ${parsed.clientName} (${id}). I'll message you here when it's ready — usually a few minutes.`
  );

  return new Response("OK", { status: 200 });
}

export async function onRequest({ request, env }) {
  // No isAdmin() check on purpose — this is Meta's server calling us, not
  // an admin browser session. Security here is the signature check + the
  // sender allowlist inside handleIncoming, not a login cookie.
  if (request.method === "GET") return handleVerify(request, env);
  if (request.method === "POST") return handleIncoming(request, env);
  return new Response("Method not allowed", { status: 405 });
}
