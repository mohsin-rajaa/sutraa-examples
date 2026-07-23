# 🕵️ Verify Agent

A claim-verification agent built **only** on [**@sutraa/sdk**](https://www.npmjs.com/package/@sutraa/sdk) — no LangChain, no `deepagents`, no agent framework at all. `reasoning`, `search`, and `moderate` are used directly as the agent's tools.

**Live demo → [verify-agent-six.vercel.app](https://verify-agent-six.vercel.app)**

## Overview

Give it a claim; it returns a verdict (`true` / `false` / `partially-true` / `unverifiable`) with a confidence score, an explanation, and cited sources — plus a moderation flag if the claim itself trips content-safety checks.

Unlike [`deep-research-agent`](../deep-research-agent), this is **not** an open-ended agent loop. It's a fixed, 3-step pipeline:

```
decompose claim → 2 sub-questions
       ↓
gather evidence (search.answer, run in parallel) + moderate.check (in parallel)
       ↓
synthesize verdict (reasoning, grounded only in the gathered evidence)
```

Bounding the pipeline by construction — rather than letting a model decide when to stop — sidesteps most of what made `deep-research-agent` hard: no recursion limit tuning, no wall-clock/hard-stop guard, no framework dependency, no packaging issues. The whole agent is one ~90-line file with a single dependency.

## Project structure

```
verify-agent/
├── package.json     # one dependency: @sutraa/sdk
├── api/
│   └── verify.js      # the whole pipeline
└── public/
    └── index.html      # claim input + verdict card + evidence trail
```

## Implementation

```js
import { configure, reasoning, search, moderate } from "@sutraa/sdk";
configure({ apiKey: process.env.SUTRAA_API_KEY, maxRetries: 0 });

// 1. decompose
const { questions } = await think(`Claim: "${claim}"\nList up to 2 searchable sub-questions...`);

// 2. gather evidence + moderate, in parallel
const [evidence, mod] = await Promise.all([
  Promise.all(questions.map((q) => search.answer({ query: q }))),
  moderate.check({ input: claim }),
]);

// 3. synthesize, grounded only in the evidence text
const verdict = await think(`Claim: "${claim}"\nEvidence:\n${evidenceText}\nRespond with ONLY this JSON: {...}`);
```

`search.answer` does most of the heavy lifting here — it returns an already-synthesized, cited answer per sub-question, so the pipeline doesn't need to fetch raw search results and get a model to summarize them itself (which is both an extra round-trip and an extra place for things to go wrong).

## `reasoning.generate` as a JSON-only function

Every `think()` call asks for **one JSON object and nothing else**, and reads it defensively:

```js
async function think(prompt) {
  const res = await reasoning.generate({ input: prompt });
  return extractJson(res?.output || res?.reasoning || "");
}
```

The `res.output || res.reasoning` fallback matters: for a "decide/produce structured output" task (as opposed to "answer a question in prose"), the model sometimes puts its JSON into `.reasoning` (its thinking trace) and leaves `.output` empty. Reading both, with `.output` preferred, covers both cases. Unlike `deep-research-agent`'s adapter, there's no "must finish now" branch to get wrong here — each `think()` call has exactly one unambiguous job, which avoids the meta-commentary/stalling behavior that showed up when a model was mid-loop and told to stop calling tools.

## Setup & deployment

```sh
npm install
vercel env add SUTRAA_API_KEY production
vercel deploy --prod
```

No key needed to run — `verify.js` only calls `configure()` if `SUTRAA_API_KEY` is set, so it falls back to the keyless free tier automatically. Free-tier limits apply per the usual constraints (this pipeline makes 4 upstream calls per request — 2 reasoning, 1 search fan-out of 2, 1 moderate — so it will hit rate limits faster than a single-call example).

## API

`POST /api/verify` — `{ claim: string }` →

```json
{
  "claim": "...",
  "questions": ["...", "..."],
  "evidence": [{ "question": "...", "answer": "...", "sources": ["..."] }],
  "verdict": "true",
  "confidence": 95,
  "explanation": "...",
  "sources": ["..."],
  "moderation": { "flagged": false, "categories": [] }
}
```

## What was skipped

- **No re-query loop.** If the first evidence pass is thin, the agent doesn't search again — it verdicts on what it has (and the prompt allows `"unverifiable"` as an honest answer). Add a bounded retry (e.g. one more `search.answer` round if `confidence < 50`) if that matters for your use case.
- **No per-call timeout.** The SDK has no `AbortSignal`/timeout option, and this pipeline doesn't add its own — each request currently takes ~60-70s (two sequential `reasoning` calls bracketing a parallel `search.answer` fan-out, and `search.answer`'s own citation synthesis is the main cost). If you need a hard ceiling, wrap the handler in the same `Promise.race`-against-a-timer pattern `deep-research-agent` uses.
