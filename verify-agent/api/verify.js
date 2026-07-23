// Claim verification agent — built only on @sutraa/sdk's public capabilities,
// no agent framework. A bounded 3-step pipeline, not an open-ended loop:
// decompose the claim -> gather cited evidence -> synthesize a verdict.
import { configure, reasoning, search, moderate } from "@sutraa/sdk";

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

/** reasoning.generate, parsed as JSON. The decision sometimes lands in
 * `.reasoning` instead of `.output` — check both. */
async function think(prompt) {
  const res = await reasoning.generate({ input: prompt });
  return extractJson(res?.output || res?.reasoning || "");
}

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
    const decompose = await think(
      `Claim to verify: "${claim}"\n\n` +
        "List up to 2 focused, web-searchable sub-questions that would help verify this claim. " +
        'Respond with ONLY this JSON: {"questions": ["...", "..."]}',
    );
    const questions = Array.isArray(decompose?.questions) && decompose.questions.length
      ? decompose.questions.slice(0, 2)
      : [claim];

    const [evidence, modResult] = await Promise.all([
      Promise.all(
        questions.map(async (q) => {
          try {
            const { answer, sources } = await search.answer({ query: q });
            return { question: q, answer, sources: (sources ?? []).map((s) => s.url) };
          } catch (err) {
            return { question: q, answer: null, sources: [], error: err?.message };
          }
        }),
      ),
      moderate.check({ input: claim }).catch(() => null),
    ]);

    const evidenceText = evidence
      .map((e) =>
        e.answer
          ? `Q: ${e.question}\nA: ${e.answer}\nSources: ${e.sources.join(", ") || "none"}`
          : `Q: ${e.question}\n(no evidence found)`,
      )
      .join("\n\n");

    const verdict = await think(
      `Claim: "${claim}"\n\nEvidence gathered:\n${evidenceText}\n\n` +
        "Based ONLY on this evidence, verify the claim. Respond with ONLY this JSON: " +
        '{"verdict": "true"|"false"|"partially-true"|"unverifiable", "confidence": 0-100, ' +
        '"explanation": "2-4 sentences, no meta-commentary", "sources": ["url1", "url2"]}',
    );

    return json({
      claim,
      questions,
      evidence,
      verdict: verdict?.verdict ?? "unverifiable",
      confidence: typeof verdict?.confidence === "number" ? verdict.confidence : null,
      explanation: verdict?.explanation ?? "Could not synthesize a verdict from the evidence gathered.",
      sources: Array.isArray(verdict?.sources) ? verdict.sources : [],
      moderation: modResult ? { flagged: modResult.flagged, categories: modResult.categories } : null,
    });
  } catch (err) {
    return json({ error: err?.message ?? "Verification failed", code: err?.code }, err?.status ?? 500);
  }
}

export const maxDuration = 60;
