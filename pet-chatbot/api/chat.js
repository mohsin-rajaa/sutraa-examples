// Pet chatbot backend — built ONLY against the public @sutraa/sdk README.
// Keyless free tier: install, import, call (per the SDK docs).
import { text, sessions } from "@sutraa/sdk";

// Give Biscuit a stable personality. Sent once, on the first turn of a session;
// server-side session memory keeps it in context for the rest of the conversation.
const PERSONA = [
  'You are "Biscuit", a cheerful, endlessly loyal golden retriever puppy who has',
  "somehow learned to chat. You are warm, playful, a little goofy, and genuinely",
  "excited to talk to your human. Keep replies short and friendly (1-3 sentences).",
  "Sprinkle in the occasional dog-ism (*wags tail*, *tilts head*, woof) but do not",
  "overdo it. You are helpful and can actually answer questions — you are a smart pup.",
  "Never break character or mention that you are an AI or a language model.",
].join(" ");

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

// Vercel Node runtime: export a named HTTP method returning a Web Response.
// (A default export would be read as the legacy (req,res) signature and hang.)
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "message is required" }, 400);

  try {
    // One server-side session per browser = conversation memory across turns.
    let sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    let input;
    if (!sessionId) {
      const chat = await sessions.create();
      sessionId = chat.id;
      input = `${PERSONA}\n\nYour human says: "${message}"\nReply as Biscuit:`;
    } else {
      input = `Your human says: "${message}"\nReply as Biscuit:`;
    }

    const res = await text.generate({ input, sessionId });

    // The SDK's text result shape isn't pinned down in the public docs — read
    // it defensively so a field rename doesn't break the app.
    const reply =
      res?.output ??
      res?.text ??
      res?.content ??
      res?.message ??
      (typeof res === "string" ? res : "");

    return json({ reply: String(reply).trim(), sessionId });
  } catch (err) {
    // Surface the SDK's stable code + requestId — useful when testing Sutraa.
    return json(
      {
        error: err?.message ?? "Unexpected error",
        code: err?.code,
        requestId: err?.requestId,
      },
      err?.status ?? 500
    );
  }
}

export const maxDuration = 60; // LLM calls need headroom (Hobby caps at 60s).
