# 🔎 Deep Research Agent

A [`deepagents`](https://www.npmjs.com/package/deepagents) (LangChain) research agent whose model **and** tool are both [**@sutraa/sdk**](https://www.npmjs.com/package/@sutraa/sdk) — the dedicated `agent` task (`text.generate({ task: "agent" })`) as the brain, `search.web` as its only tool. Multi-tenant like [`multi-tenant-saas`](../multi-tenant-saas): one tenant on the **pro** tier, one **keyless free**.

**Live demo → [deep-research-agent-puce.vercel.app](https://deep-research-agent-puce.vercel.app)**

## Overview

This is the most involved example in the repo — it combines four things:

- **A third-party agent framework** (`deepagents`) driving multi-step tool use, instead of a single direct SDK call.
- **A custom LangChain chat model** (`lib/chatSutraa.mjs`) that adapts `@sutraa/sdk` to LangChain's tool-calling interface.
- **Sutraa's `search` capability** (0.5.0+) as the agent's only tool — real web search with cited results.
- **Time-boxing for serverless**: an agentic loop makes several sequential model calls, which has to fit inside Vercel's 60-second function limit.

## Project structure

```
deep-research-agent/
├── package.json
├── vercel.json               # function config: maxDuration, includeFiles (see below)
├── scripts/
│   └── fix-vendored-esm.mjs  # postinstall — see "A packaging gotcha" below
├── lib/
│   └── chatSutraa.mjs        # LangChain-compatible model backed by @sutraa/sdk
├── api/
│   └── research.mjs          # serverless POST handler
└── public/
    └── index.html            # tenant picker + question box + step trace
```

## Why a custom model is needed

`deepagents` (like any LangChain tool-calling agent) needs a model that can emit structured tool calls. Sutraa's capabilities return plain text, not a tool-call object — so `ChatSutraa` bridges the gap:

1. It renders the conversation history and an allowed-tool catalog into a single prompt, and passes a JSON **`schema`** for the decision envelope — either `{"tool": "<name>", "args": {...}}` or `{"tool": "finish", "args": {"answer": "..."}}` — to Sutraa's dedicated `agent` task (**@sutraa/sdk ≥ 0.7.2**, `stepfun-ai/step-3.7-flash` server-side, chosen so this example doesn't have to pick a model). The gateway constrains the model to that shape, repairs code fences / stray prose, and recovers the decision from the reasoning trace when `.output` is empty, so `ChatSutraa` just reads the parsed `res.json`.
2. It parses that decision back into a LangChain `AIMessage` carrying either `tool_calls` or final `content` — the shape `deepagents` expects.

> **Not using a framework?** The SDK ships a built-in tool-calling loop — `sutraa.agent.run({ input, tools, maxSteps })` — that does all of the above (decide → call → observe → repeat) for you, returning `{ output, steps, usage }`. `ChatSutraa` exists specifically to plug Sutraa into LangChain/`deepagents`; for a standalone agent, reach for `agent.run` instead.
3. Only a small, explicit set of tools is exposed (here, just `web_search`) — everything else `deepagents` binds by default (`write_todos`, filesystem, subagents) is hidden, keeping the loop short and predictable.

```js
export class ChatSutraa extends BaseChatModel {
  bindTools(tools, kwargs) {
    // LangChain 1.x removed Runnable.bind(); withConfig carries tools
    // through to _generate's options instead.
    return this.withConfig({ tools, ...kwargs });
  }
  async _generate(messages, options) { /* build prompt → call Sutraa → parse JSON → AIMessage */ }
}
```

### Belt-and-braces for messy model replies

The `agent` task's model returns clean schema-constrained JSON on `.output` directly, but `ChatSutraa` keeps two fallbacks that mattered when this example ran on a reasoning-tuned model (and still guard against an off-label `task` override):

- **Reading `.reasoning` if `.output` is empty.** Some models put a "decide the next action" answer into their thinking trace instead of the reply body. `ChatSutraa` reads `res.output || res.reasoning`.
- **A plain-prose retry if the forced-finish turn doesn't yield a clean answer.** The adapter detects this (no usable `.answer` on a forced-finish turn) and retries once with a plain-prose-only prompt, then strips any leftover "We need to…" / "Let's…" lead-in as a last-resort cleanup.

## Time-boxing an agent loop on serverless

An agentic loop makes several sequential model calls — that's the whole point of an agent — but Vercel's function limit is 60 seconds. Three layers handle this:

```js
const WALL_CLOCK_MS = 40_000; // soft stop, checked between agent steps
const HARD_STOP_MS  = 50_000; // absolute cap: Promise.race against the whole run
const RECURSION_LIMIT = 25;   // backstop against runaway loops, not the primary control
const MAX_TOOL_CALLS  = 2;    // the model is told to search at most twice, then finish
```

The recursion limit is *not* the main control — `deepagents`' middleware stack (filesystem, subagents, summarization, patch-tool-calls) adds internal graph transitions beyond the visible tool-call count, so it just needs to be generous enough not to cut off a normal small loop. Wall-clock time is what actually bounds the request; if the deadline passes, the handler returns whatever partial trace it has with a `note` explaining why, rather than crashing.

```js
const run = driveTheAgent();                                  // background promise
const guard = new Promise((r) => setTimeout(r, HARD_STOP_MS)); // absolute ceiling
await Promise.race([run, guard]);                              // never exceed Vercel's cap
```

Also set `maxRetries: 0` on the `SutraaClient` used here — the SDK retries 429/5xx internally with exponential backoff by default, which can turn one slow upstream call into a much longer wait. In a time-boxed loop, a fast failure you can react to beats a hidden multi-attempt retry that silently eats the whole budget.

## Multi-tenant: pro vs. free

Same pattern as [`multi-tenant-saas`](../multi-tenant-saas), with the free tenant degrading gracefully instead of failing hard:

```js
const client = tenant.plan === "pro"
  ? new SutraaClient({ apiKey: process.env.SUTRAA_API_KEY, maxRetries: 0 })
  : new SutraaClient({ keyless: true, maxRetries: 0 });
```

Agentic workloads make many model calls in quick succession, so the free tier's rate/quota limits are hit almost immediately — that's expected, not a bug. The handler catches `rate_limited`/`quota_exceeded` and returns a clean note (*"Agentic workloads make many model calls — use the pro tier for them"*) with whatever partial trace exists, rather than a raw error. It's an honest demonstration of what the free tier is and isn't for: fine for a single call, not built for a multi-step agent loop.

## A packaging gotcha: ESM in a serverless function

`api/research.mjs` and `lib/chatSutraa.mjs` are `.mjs`, not `.js` — Vercel's Node runtime otherwise treats functions as CommonJS, and `@langchain/langgraph-sdk` (a `deepagents` dependency) is ESM-only.

That alone isn't enough, though: `@langchain/langgraph-sdk` also vendors a rolldown-bundled copy of its own dependencies (`p-queue`, `p-retry`, `eventemitter3`, …) under `dist/node_modules/`, **without a `package.json`**. Node can't tell those `.js` files are ES modules and crashes with `SyntaxError: Cannot use import statement outside a module`. A `postinstall` script (`scripts/fix-vendored-esm.mjs`) walks that vendored tree and drops a `{ "type": "module" }` marker into every directory that has ESM `.js` files but no `package.json`. `vercel.json` also explicitly `includeFiles`s that tree, since Vercel's dependency tracer doesn't always pick up files a package references only through vendored relative imports.

If you hit `Cannot use import statement outside a module` deploying a LangChain/LangGraph project to Vercel, this is very likely why — check whether the offending file is a vendored dependency without its own `package.json`, not your own code.

## Setup & deployment

```sh
npm install
vercel env add SUTRAA_API_KEY production   # your own key, for the pro tenant
vercel deploy --prod
```

Run locally with `npx vercel dev` after `vercel env pull .env.local`.

## API

`POST /api/research` — `{ tenantId: "pro" | "free", question: string }` →

```json
{
  "tenantId": "pro",
  "plan": "pro",
  "steps": [
    { "kind": "tool_call", "name": "web_search", "args": { "query": "..." } },
    { "kind": "tool_result", "name": "web_search", "content": "[1] ..." },
    { "kind": "answer", "content": "..." }
  ],
  "answer": "...",
  "note": null
}
```

`note` is set when the run degraded (time budget reached, or a rate/quota limit was hit) — the frontend surfaces it as an inline banner alongside whatever partial trace was captured.
