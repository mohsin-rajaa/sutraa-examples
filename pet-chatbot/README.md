# 🐶 Pet Chatbot — Biscuit

A conversational chatbot built on [**@sutraa/sdk**](https://www.npmjs.com/package/@sutraa/sdk), demonstrating persona-driven chat with persistent, server-side conversation memory. Meet **Biscuit**, a golden-retriever puppy who stays in character and remembers what you've told him.

**Live demo → [sutraa-pet-chatbot.vercel.app](https://sutraa-pet-chatbot.vercel.app)**

## Overview

This example covers two capabilities together:

- **`text.generate`** — generates each reply, seeded with a persona on the first turn of a conversation.
- **`sessions`** — server-side conversation memory. A session is created once per visitor and its id is reused on every subsequent call, so the model has access to prior turns without the client needing to resend history.

It also demonstrates the SDK's **keyless free tier**: no signup, no API key, no client-side configuration — install, import, call.

## Project structure

```
pet-chatbot/
├── package.json          # one dependency: @sutraa/sdk
├── api/
│   └── chat.js            # serverless POST handler
└── public/
    └── index.html          # chat UI (vanilla JS, no build step)
```

## Implementation

`api/chat.js` is a Vercel serverless function that:

1. On a new conversation, calls `sessions.create()` and sends the persona alongside the user's first message.
2. On every later message, passes the existing `sessionId` to `text.generate`, so context accumulates automatically.
3. Returns `{ reply, sessionId }` as JSON.

```js
import { text, sessions } from "@sutraa/sdk";

const chat = await sessions.create();
const res = await text.generate({ input, sessionId: chat.id });
res.output; // the reply
```

The client stores `sessionId` in `localStorage` and sends it with every request, so a conversation persists across page reloads for that browser.

## Setup & deployment

```sh
npm install
npx vercel deploy --prod
```

No environment variables are required. The SDK registers an anonymous device identity on first use and applies free-tier limits per device/network — see [Rate limits and quotas](#rate-limits-and-quotas) below. To raise those limits, provide an API key:

```ts
import { configure } from "@sutraa/sdk";
configure({ apiKey: process.env.SUTRAA_API_KEY });
```

Run locally with:

```sh
npx vercel dev
```

## Rate limits and quotas

The free tier enforces both a per-request rate limit and a rolling token quota. Both surface as typed errors — `SutraaRateLimitError` / `code: "rate_limited"` and `code: "quota_exceeded"` — each carrying a `requestId` for support reference. Handle them explicitly rather than treating every failure the same way, e.g. show a friendly "try again shortly" message on `rate_limited`, and prompt for an API key upgrade on `quota_exceeded`.

## Response shape

`text.generate` returns an object; this example reads the reply as `res.output`, with fallbacks to `res.text` / `res.content` for resilience against minor response-shape changes.
