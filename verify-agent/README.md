# 🕵️ Verify Agent

A claim-verification agent built **only** on [**@sutraa/sdk**](https://www.npmjs.com/package/@sutraa/sdk) — no LangChain, no `deepagents`, no agent framework at all. The SDK's own `agent.run()` tool-calling loop (≥0.7.0) drives it; `search` is its only tool, `moderate` runs alongside as a safety check.

**Live demo → [verify-agent-six.vercel.app](https://verify-agent-six.vercel.app)**

## Overview

Give it a claim; it returns a verdict (`true` / `false` / `partially-true` / `unverifiable`) with a confidence score, an explanation, and cited sources — plus a moderation flag if the claim itself trips content-safety checks.

Unlike [`deep-research-agent`](../deep-research-agent) (which brings its own tool-calling adapter for LangChain), this example doesn't hand-roll any agent logic at all:

```
agent.run({ input: claim, tools: { web_search }, maxSteps: 2 })
       ↓ (the model decides how many searches it needs, up to 2)
       ↓ moderate.check(claim) runs in parallel
final answer = verdict JSON, parsed from result.output
```

`agent.run` already is the bounded decide → call → observe loop; `maxSteps: 2` caps it at two searches before it's forced to answer. No recursion limit tuning, no wall-clock/hard-stop guard, no framework dependency, no packaging issues. The whole agent is one ~85-line file with a single dependency.

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
import { configure, agent, text, search, moderate } from "@sutraa/sdk";
configure({ apiKey: process.env.SUTRAA_API_KEY, maxRetries: 0 });

const webSearch = {
  description: "Search the web for a cited, synthesized answer to a sub-question about the claim.",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  run: async ({ query }) => {
    const { answer, sources } = await search.answer({ query });
    return { answer, sources: (sources ?? []).map((s) => s.url) };
  },
};

const [result, mod] = await Promise.all([
  agent.run({ input: `Claim to verify: "${claim}"`, system: SYSTEM, tools: { web_search: webSearch }, maxSteps: 2 }),
  moderate.check({ input: claim }),
]);

// result.output is a prose verdict write-up (SYSTEM asks for one) — extract it
// into the JSON shape the frontend renders with one fast structured call.
const extracted = await text.generate({
  input: `Extract the verdict as JSON from this analysis:\n\n${result.output}`,
  task: "agent",
  schema: VERDICT_SCHEMA,
});
const verdict = extracted.json ?? extractJson(extracted.output);
```

`search.answer` does most of the heavy lifting for each tool call — it returns an already-synthesized, cited answer per sub-question, so `web_search`'s handler doesn't need to fetch raw results and get a model to summarize them itself. `agent.run` owns the decide → search → observe loop entirely: the model chooses its own queries (up to `maxSteps: 2`), and `result.steps` gives back every `web_search` call and result for the evidence trail, exactly like the old hand-rolled pipeline did.

## The final answer is still just text — extract it, don't ask the loop to emit JSON

`agent.run`'s `result.output` is the model's final answer as **plain text**; there's no schema on the *finish* step, only on each tool-call decision (and not at all on a forced finish, which this example hits often since it only allows 2 tool rounds). Asking the model to make that free-text answer *itself* be raw JSON turned out unreliable in practice — nested "your prose reply must secretly be a JSON string" instructions are exactly the kind of thing forced/schema-less turns ignore.

The reliable fix: let `agent.run` produce a normal prose verdict, then make one **separate, single-shot structured call** — `text.generate({ schema })`, same fast `agent` model — to extract `{ verdict, confidence, explanation, sources }` from that prose. A schema-constrained call is reliable from a cold start (no forced/unforced distinction to fall into); a schema-constrained *field inside* a free-text agent answer is not. This is the one place this example still needs an explicit JSON-extraction step — everything about the tool-call loop itself (envelope, reasoning-trace fallback, forced-finish handling) stays inside `agent.run`.

## Setup & deployment

```sh
npm install
vercel env add SUTRAA_API_KEY production
vercel deploy --prod
```

No key needed to run — `verify.js` only calls `configure()` if `SUTRAA_API_KEY` is set, so it falls back to the keyless free tier automatically. Free-tier limits apply per the usual constraints (this run makes up to 4 upstream calls — up to 2 tool-decision rounds each backed by a model call, up to 2 `search.answer` calls, 1 `moderate.check` — so it will hit rate limits faster than a single-call example).

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

- **No re-query loop beyond `maxSteps: 2`.** The model can already choose to search once, twice, or not at all — but once it's forced to finish at 2 rounds, it verdicts on what it has (and the prompt allows `"unverifiable"` as an honest answer) rather than retrying with a different query. Raise `maxSteps` if that matters for your use case.
- **No `timeoutMs` on the `agent.run` call, deliberately.** `search.answer`'s own citation synthesis can take 20-40s per call, so a tight internal budget aborted runs that would otherwise finish fine (verified live: a real 2-search claim needs close to 60s end to end). Vercel's `maxDuration` is the actual backstop, same tradeoff the original hand-rolled pipeline made — the SDK's `{ timeoutMs, signal }` controls are still there and worth using once you've measured your own tools' latency; they just don't fit *this* example's already-slow tool well without a Pro plan's longer `maxDuration`.
