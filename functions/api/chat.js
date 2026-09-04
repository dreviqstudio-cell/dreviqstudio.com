import Anthropic from "@anthropic-ai/sdk";
import { b2GetJson, b2PutJson } from "../_lib/b2.js";
import { SHILPI_SYSTEM_PROMPT } from "../_lib/shilpi-knowledge.js";
import { json, readJsonBody } from "../_lib/http.js";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 40; // keep both the model's context and the stored doc size sane

function isValidSessionId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

async function saveTranscript(env, sessionId, transcript) {
  transcript.updatedAt = new Date().toISOString();
  await b2PutJson(env, `leads/${sessionId}.json`, transcript);
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: "Shilpi isn't connected yet — ANTHROPIC_API_KEY not configured." }, 503);
  }

  const body = (await readJsonBody(request)) || {};
  const { sessionId, message } = body;
  if (!isValidSessionId(sessionId)) {
    return json({ error: "Invalid or missing sessionId" }, 400);
  }
  if (typeof message !== "string" || !message.trim()) {
    return json({ error: "message is required" }, 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` }, 413);
  }

  let transcript = await b2GetJson(env, `leads/${sessionId}.json`);
  if (!transcript) {
    transcript = { sessionId, messages: [], createdAt: new Date().toISOString() };
  }

  transcript.messages.push({ role: "user", content: message.trim() });
  // Cap history so context/doc size can't grow unbounded on a long-lived session.
  if (transcript.messages.length > MAX_HISTORY_MESSAGES) {
    transcript.messages = transcript.messages.slice(-MAX_HISTORY_MESSAGES);
  }

  const model = env.SHILPI_MODEL || "claude-sonnet-5";
  const client = new Anthropic({ apiKey });
  let replyText;
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SHILPI_SYSTEM_PROMPT,
      messages: transcript.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    replyText =
      response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim() || "Sorry, I didn't quite catch that — could you try again?";
  } catch {
    return json({ error: "Shilpi couldn't respond right now — please try again shortly." }, 502);
  }

  transcript.messages.push({ role: "assistant", content: replyText });
  await saveTranscript(env, sessionId, transcript);

  return json({ reply: replyText });
}
