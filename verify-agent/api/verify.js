// Claim verification agent — built only on @sutraa/sdk's public capabilities,
// no agent framework. Uses agent.run() (@sutraa/sdk >=0.7.0) so the model
// decides when to search and when it has enough evidence to verdict, instead
// of a hand-rolled decompose -> gather -> synthesize pipeline.
import { configure, agent, search, moderate } from "@sutraa/sdk";

if (process.env.SUTRAA_API_KEY) {
  configure({ apiKey: process.env.SUTRAA_API_KEY, maxRetries: 0 });
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** Pull the first balanced JSON object out of the agent's final answer. */
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
  "Then finish. Your final answer must be ONLY this JSON, nothing else:",
  '{"verdict": "true"|"false"|"partially-true"|"unverifiable", "confidence": 0-100, ' +
    '"explanation": "2-4 sentences, no meta-commentary", "sources": ["url1", "url2"]}',
  'Base the verdict strictly on the evidence gathered; answer "unverifiable" honestly if it\'s thin.',
].join(" ");

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
      agent.run(
        { input: `Claim to verify: "${claim}"`, system: SYSTEM, tools: { web_search: webSearch }, maxSteps: 2 },
        { timeoutMs: 45_000 },
      ),
      moderate.check({ input: claim }).catch(() => null),
    ]);

    const evidence = result.steps
      .filter((s) => s.tool === "web_search")
      .map((s) => ({
        question: s.args?.query ?? "",
        answer: s.result?.answer ?? null,
        sources: s.result?.sources ?? [],
      }));
    const verdict = extractJson(result.output) ?? {};

    return json({
      claim,
      questions: evidence.map((e) => e.question),
      evidence,
      verdict: verdict.verdict ?? "unverifiable",
      confidence: typeof verdict.confidence === "number" ? verdict.confidence : null,
      explanation: verdict.explanation ?? "Could not synthesize a verdict from the evidence gathered.",
      sources: Array.isArray(verdict.sources) ? verdict.sources : [],
      moderation: modResult ? { flagged: modResult.flagged, categories: modResult.categories } : null,
    });
  } catch (err) {
    return json({ error: err?.message ?? "Verification failed", code: err?.code }, err?.status ?? 500);
  }
}

export const maxDuration = 60;
