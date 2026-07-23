// Reasoning trace viewer — built against the public @sutraa/sdk README's
// pro-tier pattern:
//   const pro = new SutraaClient({ apiKey });
//   await pro.reasoning.generate({ input });
//
// The API key is NEVER hardcoded here — it's read from the SUTRAA_API_KEY
// environment variable (set as an encrypted Vercel project env var), exactly
// as the README documents: `configure({ apiKey })` or `SUTRAA_API_KEY` in env.
import { SutraaClient } from "@sutraa/sdk";

const apiKey = process.env.SUTRAA_API_KEY;
const sutraa = new SutraaClient(apiKey ? { apiKey } : undefined);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const input = typeof body?.input === "string" ? body.input.trim() : "";
  if (!input) return json({ error: "input is required" }, 400);

  try {
    const res = await sutraa.reasoning.generate({ input });

    // Public docs show `.output` (final answer) and `.reasoning` (the trace).
    // Read defensively in case of field-name variance.
    const output = res?.output ?? res?.text ?? res?.content ?? "";
    const trace = res?.reasoning ?? res?.trace ?? res?.thinking ?? "";

    return json({
      output: String(output).trim(),
      reasoning: String(trace).trim(),
      pro: Boolean(apiKey),
    });
  } catch (err) {
    return json(
      {
        error: err?.message ?? "Unexpected error",
        code: err?.code,
        requestId: err?.requestId,
      },
      err?.status ?? 500
    );
  }
}

export const maxDuration = 60;
