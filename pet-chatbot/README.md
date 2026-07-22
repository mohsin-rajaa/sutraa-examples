# 🐶 Pet Chatbot — Biscuit

A tiny pet chatbot built on [**@sutraa/sdk**](https://www.npmjs.com/package/@sutraa/sdk). Meet **Biscuit**, a cheerful golden-retriever puppy who chats in character and *remembers* your conversation.

**Live demo → [sutraa-pet-chatbot.vercel.app](https://sutraa-pet-chatbot.vercel.app)**

## What it demonstrates

- **Keyless free tier** — no API key, no signup. `npm install @sutraa/sdk`, import, call.
- **`text.generate`** for the replies, with a persona baked into the first turn.
- **`sessions`** for server-side conversation memory — each browser gets its own session id (kept in `localStorage`) and Biscuit remembers earlier turns across separate serverless invocations.
- **Zero-config Vercel deploy** — a static frontend plus a single serverless function, no framework.

## Structure

```
pet-chatbot/
├── package.json          # one dependency: @sutraa/sdk
├── api/
│   └── chat.js           # serverless POST handler → Sutraa
└── public/
    └── index.html        # self-contained chat UI (vanilla JS)
```

## How it works

`api/chat.js` is a Vercel serverless function that:

1. On the first message, creates a session (`sessions.create()`) and sends Biscuit's persona.
2. On later messages, passes the same `sessionId` to `text.generate({ input, sessionId })` so context carries over.
3. Returns `{ reply, sessionId }` as JSON.

```js
import { text, sessions } from "@sutraa/sdk";

const chat = await sessions.create();
const res = await text.generate({ input, sessionId: chat.id });
res.output; // Biscuit's reply
```

The frontend (`public/index.html`) is dependency-free: it stores the `sessionId` in `localStorage` and POSTs each message to `/api/chat`.

## Run locally

```sh
npm install
# then serve with any Vercel-compatible dev tool, e.g.:
npx vercel dev
```

Or just deploy it:

```sh
npx vercel deploy --prod
```

No environment variables required — the SDK registers an anonymous device identity on first use (free-tier limits apply per device/network). For higher limits, set `SUTRAA_API_KEY` or call `configure({ apiKey })`.

## Notes

- Built entirely against the **public** `@sutraa/sdk` README.
- The `text.generate` result is read defensively (`res.output ?? res.text ?? …`) since the exact field isn't pinned in the public docs — in practice it's `.output`.
- `maxDuration` is set to 60s in the function; LLM calls take ~10s.
