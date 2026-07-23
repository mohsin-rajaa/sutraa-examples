# 🧠 Reasoning Explorer

A step-by-step reasoning viewer built on [**@sutraa/sdk**](https://www.npmjs.com/package/@sutraa/sdk)'s `reasoning.generate()`, configured for the **pro tier** via an API key.

**Live demo → [reasoning-explorer.vercel.app](https://reasoning-explorer.vercel.app)**

## Overview

This example covers two things:

- **`reasoning.generate({ input })`** — returns both `.output` (the final answer) and `.reasoning` (the model's step-by-step working), rendered as separate panels in the UI.
- **Pro-tier configuration** — using `SutraaClient({ apiKey })`, the pattern the SDK documents for authenticated usage, with the key handled as a server-only secret throughout.

## Project structure

```
reasoning-explorer/
├── package.json          # one dependency: @sutraa/sdk
├── api/
│   └── reason.js            # serverless POST handler
└── public/
    └── index.html            # prompt input + answer/trace panels
```

## Implementation

```js
import { SutraaClient } from "@sutraa/sdk";

const sutraa = new SutraaClient({ apiKey: process.env.SUTRAA_API_KEY });
const res = await sutraa.reasoning.generate({ input: "..." });

res.output;    // final answer
res.reasoning; // step-by-step trace
```

If `SUTRAA_API_KEY` is unset, `SutraaClient()` falls back to the keyless free tier automatically — useful for local development without provisioning a key, though at free-tier limits rather than pro.

## Secret handling

The API key is never present in the repository, in client-side code, or in any response body:

- Stored as a Vercel environment variable scoped to the Production environment, marked **Sensitive** (not retrievable via `vercel env ls` once set).
- Read only inside the serverless function, via `process.env.SUTRAA_API_KEY`.
- To provision your own copy of this example, set your own key rather than reusing one from another deployment:

```sh
vercel env add SUTRAA_API_KEY production
vercel deploy --prod
```

For local development:

```sh
vercel env pull .env.local   # .env.local is gitignored — never commit it
npx vercel dev
```

## Response handling

`reasoning.generate`'s response fields aren't pinned to an exact schema in the public documentation, so the API route reads `res.output` / `res.reasoning` with fallbacks (`res.text`, `res.trace`, `res.thinking`) to stay resilient to minor shape changes.
