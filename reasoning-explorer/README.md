# 🧠 Reasoning Explorer

A step-by-step reasoning trace viewer built on [**@sutraa/sdk**](https://www.npmjs.com/package/@sutraa/sdk)'s `reasoning.generate()` — runs on the **pro tier** via an API key, unlike the other two examples in this repo which are keyless.

**Live demo → [reasoning-explorer.vercel.app](https://reasoning-explorer.vercel.app)**

## What it demonstrates

- **`reasoning.generate({ input })`** — returns both `.output` (the final answer) and `.reasoning` (the model's step-by-step thinking), shown side by side in the UI.
- **Pro tier via API key** — configured with `SutraaClient({ apiKey })`, per the public README's multi-tenant pattern, instead of the keyless free-tier flow used elsewhere in this repo.
- **Secrets kept out of the repo entirely.** The API key lives only as an encrypted Vercel environment variable (`SUTRAA_API_KEY`, marked *Sensitive* — not even readable back via the CLI). It is never committed, never in client-side code, and never printed by the API route.

## Structure

```
reasoning-explorer/
├── package.json          # one dependency: @sutraa/sdk
├── api/
│   └── reason.js          # serverless POST handler → reasoning.generate
└── public/
    └── index.html          # prompt box + answer/trace panels
```

## How it works

```js
import { SutraaClient } from "@sutraa/sdk";

const sutraa = new SutraaClient({ apiKey: process.env.SUTRAA_API_KEY });
const res = await sutraa.reasoning.generate({ input: "..." });

res.output;    // final answer
res.reasoning; // the step-by-step trace
```

## Run locally / deploy your own copy

This example **requires an API key** — it will run keyless too (the client falls back to the free tier if `SUTRAA_API_KEY` is unset), but then you lose the higher limits that are the point of this example.

```sh
npm install
vercel env add SUTRAA_API_KEY production   # paste your own key when prompted — never commit it
vercel deploy --prod
```

Locally:

```sh
vercel env pull .env.local   # .env.local is gitignored
npx vercel dev
```

## Notes from testing

- With a pro key, a reasoning call that involves real multi-step math (a classic "chickens and cows" head/legs puzzle) came back in ~6s with a correct answer and a clean, legible trace — noticeably snappier than the free tier and with no rate limiting, which matches what you'd expect a paid tier to buy you.
- Same defensive-parsing pattern as the other examples: response field names aren't pinned down in the public docs, so the API route reads `res.output`/`res.reasoning` with fallbacks.
