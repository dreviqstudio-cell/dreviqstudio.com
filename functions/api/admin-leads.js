import { b2Get, b2GetJson, b2List } from "../_lib/b2.js";
import { isAdmin } from "../_lib/auth.js";
import { json } from "../_lib/http.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!(await isAdmin(request, env))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (sessionId) {
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(sessionId)) {
      return json({ error: "Invalid sessionId" }, 400);
    }
    const result = await b2Get(env, `leads/${sessionId}.json`);
    if (!result) return json({ error: "Conversation not found" }, 404);
    return new Response(await result.text(), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const keys = await b2List(env, "leads/", { limit: 200 });
  const leadFiles = keys.filter((k) => k.endsWith(".json"));

  const summaries = await Promise.all(
    leadFiles.map(async (k) => {
      const transcript = await b2GetJson(env, k);
      if (!transcript) return null;
      const lastUserMsg = [...transcript.messages].reverse().find((m) => m.role === "user");
      return {
        sessionId: transcript.sessionId,
        createdAt: transcript.createdAt,
        updatedAt: transcript.updatedAt,
        messageCount: transcript.messages.length,
        preview: lastUserMsg ? lastUserMsg.content.slice(0, 140) : "",
      };
    })
  );

  const leads = summaries.filter(Boolean).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return json({ leads });
}
