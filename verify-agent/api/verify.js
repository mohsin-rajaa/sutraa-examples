// Claim verification agent — built only on @sutraa/sdk's public capabilities,
// no agent framework. Uses agent.run() (@sutraa/sdk >=0.7.0) so the model
// decides when to search and when it has enough evidence to verdict, instead
// of a hand-rolled decompose -> gather -> synthesize pipeline.
import { configure, agent, text, search, moderate } from "@sutraa/sdk";

if (process.env.SUTRAA_API_KEY) {
  configure({ apiKey: process.env.SUTRAA_API_KEY, maxRetries: 0 });
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** Pull the first balanced JSON object out of a possibly-chatty reply. */
function extractJson(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const SYSTEM = [
  "You are a claim-verification agent.",
  "Call web_search at most twice to gather cited evidence relevant to the claim — do not search more than needed.",
  "Then give your final answer as a short verdict write-up: state plainly whether the claim is true, false,",
  "partially true, or unverifiable, a rough confidence percentage, a 2-4 sentence explanation grounded only in",
  "the evidence gathered, and the source URLs you relied on.",
].join(" ");

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["true", "false", "partially-true", "unverifiable"] },
    confidence: { type: "number" },
    explanation: { type: "string" },
    sources: { type: "array", items: { type: "string" } },
  },
  required: ["verdict", "explanation"],
};

const webSearch = {
  description: "Search the web for a cited, synthesized answer to a sub-question about the claim.",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  run: async ({ query }) => {
    const { answer, sources } = await search.answer({ query });
    return { answer, sources: (sources ?? []).map((s) => s.url) };
  },
};

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const claim = typeof body?.claim === "string" ? body.claim.trim() : "";
  if (!claim) return json({ error: "claim is required" }, 400);

  try {
    const [result, modResult] = await Promise.all([
      // No timeoutMs here: search.answer's own citation synthesis can take
      // 20-40s per call, so a tight internal budget aborts runs that would
      // otherwise finish fine. Vercel's maxDuration (below) is the backstop —
      // same tradeoff the original hand-rolled pipeline made.
      agent.run({ input: `Claim to verify: "${claim}"`, system: SYSTEM, tools: { web_search: webSearch }, maxSteps: 2 }),
      moderate.check({ input: claim }).catch((err) => {
        console.error("moderate.check failed:", err?.code ?? err?.message ?? err);
        return null;
      }),
    ]);

    const evidence = result.steps
      .filter((s) => s.tool === "web_search")
      .map((s) => ({
        question: s.args?.query ?? "",
        answer: s.result?.answer ?? null,
        sources: s.result?.sources ?? [],
      }));

    // A second, single-shot structured call (same fast "agent" model) turns the
    // agent's prose verdict into the JSON shape the frontend renders — more
    // reliable than asking the tool-calling loop's free-text finish step to
    // emit valid JSON itself, especially on the forced-finish path (no schema).
    const extracted = await text.generate({
      input: `Extract the verdict as JSON from this analysis:\n\n${result.output}`,
      task: "agent",
      schema: VERDICT_SCHEMA,
    });
    const verdict = extracted.json ?? extractJson(extracted.output) ?? {};
    const evidenceSources = [...new Set(evidence.flatMap((e) => e.sources))];

    return json({
      claim,
      questions: evidence.map((e) => e.question),
      evidence,
      verdict: verdict.verdict ?? "unverifiable",
      confidence: typeof verdict.confidence === "number" ? verdict.confidence : null,
      explanation: verdict.explanation ?? result.output ?? "Could not synthesize a verdict from the evidence gathered.",
      sources: Array.isArray(verdict.sources) && verdict.sources.length ? verdict.sources : evidenceSources,
      moderation: modResult ? { flagged: modResult.flagged, categories: modResult.categories } : null,
    });
  } catch (err) {
    return json({ error: err?.message ?? "Verification failed", code: err?.code }, err?.status ?? 500);
  }
}

export const maxDuration = 60;
