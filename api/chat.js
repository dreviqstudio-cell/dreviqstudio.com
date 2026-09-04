import Anthropic from "@anthropic-ai/sdk";
import { get, put } from "@vercel/blob";
import { SHILPI_SYSTEM_PROMPT } from "../lib/shilpi-knowledge.js";

// Node.js runtime (not edge) — same reason as the admin job routes:
// @vercel/blob needs Node builtins unavailable in the Edge sandbox.

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 40; // keep both the model's context and Blob doc size sane
const MODEL = process.env.SHILPI_MODEL || "claude-sonnet-5";

function isValidSessionId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

async function loadTranscript(sessionId) {
  try {
    const result = await get(`leads/${sessionId}.json`, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8"));
  } catch {
    return null; // not found or transient error — start fresh
  }
}

async function saveTranscript(sessionId, transcript) {
  transcript.updatedAt = new Date().toISOString();
  await put(`leads/${sessionId}.json`, JSON.stringify(transcript, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Shilpi isn't connected yet — ANTHROPIC_API_KEY not configured." });
    return;
  }

  const { sessionId, message } = req.body || {};
  if (!isValidSessionId(sessionId)) {
    res.status(400).json({ error: "Invalid or missing sessionId" });
    return;
  }
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    res.status(413).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
    return;
  }

  let transcript = await loadTranscript(sessionId);
  if (!transcript) {
    transcript = { sessionId, messages: [], createdAt: new Date().toISOString() };
  }

  transcript.messages.push({ role: "user", content: message.trim() });
  // Cap history so context/doc size can't grow unbounded on a long-lived session.
  if (transcript.messages.length > MAX_HISTORY_MESSAGES) {
    transcript.messages = transcript.messages.slice(-MAX_HISTORY_MESSAGES);
  }

  const client = new Anthropic({ apiKey });
  let replyText;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SHILPI_SYSTEM_PROMPT,
      messages: transcript.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    replyText = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim() || "Sorry, I didn't quite catch that — could you try again?";
  } catch (err) {
    res.status(502).json({ error: "Shilpi couldn't respond right now — please try again shortly." });
    return;
  }

  transcript.messages.push({ role: "assistant", content: replyText });
  await saveTranscript(sessionId, transcript);

  res.status(200).json({ reply: replyText });
}
