# Sutraa Runner — an OpenAI-compatible API, zero config

An OpenAI-compatible API deployed with [**@sutraa/sdk**](https://www.npmjs.com/package/@sutraa/sdk)'s `serve()`. The entire backend is one line:

```js
import { serve } from "@sutraa/sdk";
export default serve();
```

**Live demo → [sutraa-openai-runner.vercel.app](https://sutraa-openai-runner.vercel.app)**

## Overview

This example shows the whole point of `serve()`: point any OpenAI-compatible client — Claude Code, Cline, Open WebUI, the `openai` SDK, anything — at a Sutraa-backed URL by setting `OPENAI_BASE_URL`, and it just works. No OpenAI, Anthropic, or Gemini account, ever; Sutraa's free tier answers every request out of the box.

`serve()` exposes:

- `GET /v1/models`
- `POST /v1/chat/completions` (+ streaming)
- `POST /v1/responses` (+ streaming)
- `POST /v1/embeddings`

The static page also runs a small streaming chat UI directly against `/v1/chat/completions`, so you can see it answer live in the browser.

## Project structure

```
openai-runner/
├── package.json     # one dependency: @sutraa/sdk
├── vercel.json       # one rewrite: /v1/* -> the api function
├── api/
│   └── index.js       # export default serve();
└── public/
    └── index.html      # setup snippet + a live streaming chat demo
```

## Why `vercel.json` exists

`serve()` is one function handling every `/v1/*` path internally, but Vercel's zero-config routing maps a file under `api/` to exactly one URL (`api/index.js` → `/api`). The single rewrite rule sends every `/v1/*` request to that function while leaving the client-visible URL untouched, so `curl $URL/v1/chat/completions` works exactly as an OpenAI-compatible client expects.

## Setup & deployment

```sh
npm install
npx vercel deploy --prod
```

No environment variables are required — the free tier just works. Run locally with:

```sh
npm run dev
# [sutraa] Runner listening on http://localhost:8787
```

`serve()` auto-detects it isn't running on a serverless platform and self-starts a local HTTP server — same code, same `export default serve()`, no separate dev script needed. To unlock pro quota instead of the free tier, forward a real Sutraa key as the client's `OPENAI_API_KEY` (`Authorization: Bearer sutraa_sk_...`), or set a deployment-wide default with `serve({ apiKey: process.env.SUTRAA_API_KEY })`.

## Try it

```sh
curl $URL/v1/models

curl $URL/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say hi in five words"}]}'
```

Or point a real client at it:

```sh
export OPENAI_BASE_URL="$URL/v1"
export OPENAI_API_KEY="anything"   # unused — the free tier just works
```

See the [`@sutraa/sdk` README](https://www.npmjs.com/package/@sutraa/sdk#openai-compatible-api-runner) for the full Runner reference, including `requireApiKey` to lock a deployment to paid keys only.
