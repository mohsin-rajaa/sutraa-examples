// Deep research agent — deepagents (LangChain) driven by @sutraa/sdk.
//
// - Pro tenant  → SutraaClient with the API key (headroom for a multi-step loop)
// - Free tenant → keyless SutraaClient; agentic loops hit free-tier limits fast,
//   so we catch that and degrade gracefully (partial trace + upgrade note).
//
// The agent's one tool is Sutraa web search (0.5.0's `search` capability); its
// "brain" is Sutraa reasoning/text via the ChatSutraa adapter.
import { createDeepAgent } from "deepagents";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { SutraaClient } from "@sutraa/sdk";
import { ChatSutraa } from "../lib/chatSutraa.mjs";

const TENANTS = {
  pro: { name: "Pro workspace", plan: "pro" },
  free: { name: "Free workspace", plan: "free" },
};

const SYSTEM_PROMPT = [
  "You are a web research assistant.",
  "Use the web_search tool to gather current information — at most TWICE — then finish.",
  "In your final answer, write a concise 120–180 word brief and cite the source URLs inline.",
  "Do not create todo lists or use file tools.",
].join(" ");

// The real budget guard is wall-clock time (below), not the LangGraph
// recursion limit — deepagents' middleware stack (filesystem, subagents,
// summarization, patch-tool-calls) adds internal node transitions beyond the
// visible tool-call count, so recursionLimit just needs to be generous enough
// not to cut off a normal small loop; it's a backstop against true runaway
// loops, not the primary time control.
const WALL_CLOCK_MS = 40_000; // soft stop between agent steps
const HARD_STOP_MS = 50_000; // absolute cap so the handler always returns before Vercel's 60s
const RECURSION_LIMIT = 25;
const MAX_TOOL_CALLS = 2;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function makeSearchTool(client) {
  return tool(
    async ({ query }) => {
      const { results } = await client.search.web({ query, numResults: 4 });
      if (!results?.length) return "No results found.";
      return results
        .map((r, i) => {
          const snippet = (r.highlights?.[0] ?? r.summary ?? "").slice(0, 280);
          return `[${i + 1}] ${r.title ?? "(untitled)"}\n${r.url}\n${snippet}`;
        })
        .join("\n\n");
    },
    {
      name: "web_search",
      description: "Search the web for current information. Returns titled results with URLs and snippets.",
      schema: z.object({ query: z.string().describe("The search query") }),
    },
  );
}

/** Turn the agent's message history into a compact, UI-friendly step trace. */
function toTrace(messages = []) {
  const steps = [];
  let answer = "";
  for (const m of messages) {
    const type = m._getType?.() ?? m.type;
    if (type === "ai") {
      if (m.tool_calls?.length) {
        for (const tc of m.tool_calls) steps.push({ kind: "tool_call", name: tc.name, args: tc.args });
      } else if (m.content) {
        const text = typeof m.content === "string" ? m.content : String(m.content);
        answer = text;
        steps.push({ kind: "answer", content: text });
      }
    } else if (type === "tool") {
      const text = typeof m.content === "string" ? m.content : String(m.content);
      steps.push({ kind: "tool_result", name: m.name ?? "tool", content: text.slice(0, 900) });
    }
  }
  return { steps, answer };
}

function isLimitError(err) {
  const code = err?.code ?? err?.cause?.code ?? "";
  const msg = `${err?.message ?? ""} ${err?.cause?.message ?? ""}`.toLowerCase();
  return /rate_limited|quota_exceeded/.test(code) || /rate limit|quota|too many|429/.test(msg);
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const tenantId = typeof body?.tenantId === "string" ? body.tenantId : "";
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const tenant = TENANTS[tenantId];
  if (!tenant) return json({ error: `Unknown tenant "${tenantId}"` }, 400);
  if (!question) return json({ error: "question is required" }, 400);

  // maxRetries: 0 — the SDK retries 429/5xx internally with exponential
  // backoff by default, which can turn one slow upstream call into a much
  // longer wait. In this time-boxed agent loop, a fast failure (caught below
  // and reported as a note) is more useful than a hidden multi-attempt retry
  // that can eat the whole request budget on its own.
  const client =
    tenant.plan === "pro" && process.env.SUTRAA_API_KEY
      ? new SutraaClient({ apiKey: process.env.SUTRAA_API_KEY, maxRetries: 0 })
      : new SutraaClient({ keyless: true, maxRetries: 0 });

  // reasoning.generate, not text.generate: isolated testing (api/diag.mjs,
  // not shipped) showed text.generate consistently hanging to Sutraa's ~60s
  // gateway ceiling for this key/environment, while reasoning.generate
  // returns in ~1-3s for the same prompts. reasoning is also a better fit
  // thematically — it's what actually powers each planning/tool-call step.
  const model = new ChatSutraa({
    client,
    useReasoning: true,
    exposeTools: ["web_search"],
    maxToolCalls: MAX_TOOL_CALLS,
  });
  const agent = createDeepAgent({ model, tools: [makeSearchTool(client)], systemPrompt: SYSTEM_PROMPT });

  const deadline = Date.now() + WALL_CLOCK_MS;
  let lastState;
  let timedOut = false;
  let limitHit = false;
  let fatal;
  let finished = false;

  // Drive the agent, updating lastState after every step so we can return
  // partial progress if we have to bail out.
  const run = (async () => {
    try {
      const stream = await agent.stream(
        { messages: [{ role: "user", content: question }] },
        { recursionLimit: RECURSION_LIMIT, streamMode: "values" },
      );
      for await (const state of stream) {
        lastState = state;
        if (Date.now() > deadline) {
          timedOut = true;
          break;
        }
      }
    } catch (err) {
      if (isLimitError(err)) limitHit = true;
      else fatal = err;
    } finally {
      finished = true;
    }
  })();

  // Absolute guard: never let the handler run to Vercel's hard 60s kill.
  const guard = new Promise((resolve) => setTimeout(resolve, HARD_STOP_MS));
  await Promise.race([run, guard]);
  if (!finished) timedOut = true;

  if (fatal) {
    return json(
      { tenantId, plan: tenant.plan, error: fatal?.message ?? "Agent run failed", code: fatal?.code },
      500,
    );
  }

  const { steps, answer } = toTrace(lastState?.messages);

  let note;
  if (limitHit) {
    note =
      tenant.plan === "free"
        ? "Free tier hit its rate/quota limit mid-run. Agentic workloads make many model calls — use the pro tier for them."
        : "Hit a rate/quota limit mid-run; showing partial progress.";
  } else if (timedOut) {
    note = "Stopped at the time budget; showing progress so far.";
  }

  return json({
    tenantId,
    tenantName: tenant.name,
    plan: tenant.plan,
    question,
    steps,
    answer,
    note,
  });
}

export const maxDuration = 60;
