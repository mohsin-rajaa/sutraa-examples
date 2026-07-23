// Multi-tenant SaaS demo — built against the public @sutraa/sdk README's
// multi-tenant pattern:
//
//   const sutraa = new SutraaClient();           // keyless free tier
//   const pro = new SutraaClient({ apiKey });     // pro
//
// Each tenant gets its own SutraaClient instance, chosen by plan. Pro
// tenants share the platform's own API key (never sent to the browser,
// read only from the encrypted SUTRAA_API_KEY env var); free tenants get
// a plain keyless client.
//
// IMPORTANT: SutraaClient's constructor falls back to the SUTRAA_API_KEY
// env var whenever `apiKey` isn't explicitly passed — `new SutraaClient()`
// is only keyless if that env var is unset for the whole process. In this
// app SUTRAA_API_KEY *is* set (for the pro tenant below), so free-tier
// clients must override it explicitly with an empty string to force the
// anonymous/keyless flow rather than silently inheriting the pro key.
import { SutraaClient } from "@sutraa/sdk";

const TENANTS = {
  acme: { name: "Acme Corp", plan: "pro" },
  hobby: { name: "Hobby Dev", plan: "free" },
  beta: { name: "Beta Startup", plan: "free" },
};

// One client per tenant, built once and reused across requests (matches the
// README's guidance to construct SutraaClient once, not per call).
const clients = new Map();
function clientFor(tenantId) {
  if (clients.has(tenantId)) return clients.get(tenantId);
  const tenant = TENANTS[tenantId];
  if (!tenant) return null;

  const client =
    tenant.plan === "pro" && process.env.SUTRAA_API_KEY
      ? new SutraaClient({ apiKey: process.env.SUTRAA_API_KEY })
      : new SutraaClient({ apiKey: "" }); // "" forces keyless, overriding env fallback

  clients.set(tenantId, client);
  return client;
}

// Demo-only usage counter, per warm container — not persisted, just enough
// to show that each tenant's calls are tracked/attributed separately.
const usage = new Map();

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

  const tenantId = typeof body?.tenantId === "string" ? body.tenantId : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const tenant = TENANTS[tenantId];

  if (!tenant) return json({ error: `Unknown tenant "${tenantId}"` }, 400);
  if (!text) return json({ error: "text is required" }, 400);

  const client = clientFor(tenantId);

  try {
    const res = await client.text.generate({ task: "summarize", input: text });
    const summary = res?.output ?? res?.text ?? res?.content ?? (typeof res === "string" ? res : "");

    usage.set(tenantId, (usage.get(tenantId) ?? 0) + 1);

    return json({
      tenantId,
      tenantName: tenant.name,
      plan: tenant.plan,
      summary: String(summary).trim(),
      requestsThisContainer: usage.get(tenantId),
    });
  } catch (err) {
    return json(
      {
        error: err?.message ?? "Unexpected error",
        code: err?.code,
        requestId: err?.requestId,
        tenantId,
        plan: tenant.plan,
      },
      err?.status ?? 500
    );
  }
}

export const maxDuration = 60;
