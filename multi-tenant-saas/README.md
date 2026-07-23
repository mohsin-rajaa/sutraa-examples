# 🏢 Multi-Tenant SaaS Demo

A small "summarize text on behalf of a customer" SaaS, built to showcase the exact multi-tenant pattern from the [**@sutraa/sdk**](https://www.npmjs.com/package/@sutraa/sdk) README:

```ts
const sutraa = new SutraaClient();           // keyless free tier
const pro = new SutraaClient({ apiKey });    // pro
```

Three demo tenants, two plans, one shared API route — each tenant gets its own `SutraaClient` instance.

**Live demo → [multi-tenant-saas-zeta.vercel.app](https://multi-tenant-saas-zeta.vercel.app)**

> Note the `-zeta` suffix: `multi-tenant-saas.vercel.app` was already claimed by an unrelated project (the `.vercel.app` namespace is global, not per-account), and Vercel silently assigned this alias instead. Worth checking your actual assigned domain after a first deploy rather than assuming `<project-name>.vercel.app`.

## What it demonstrates

- **Per-tenant `SutraaClient` instances**, built once and cached (`Map<tenantId, SutraaClient>`), not recreated per request.
- **Mixed plans in one app**: `acme` (pro, uses the platform's API key) alongside `hobby` and `beta` (both keyless free tier).
- **The API key never reaches the browser** — same discipline as [`reasoning-explorer`](../reasoning-explorer): read from `process.env.SUTRAA_API_KEY`, stored as an encrypted, *Sensitive* Vercel env var.
- **Typed errors per tenant** — the route attaches `tenantId`/`plan` to error responses so a real app could route retries, alerting, or billing logic per tenant.

## Structure

```
multi-tenant-saas/
├── package.json
├── api/
│   └── summarize.js       # tenant lookup → cached SutraaClient → text.generate
└── public/
    └── index.html          # tenant picker + summarizer + per-session usage counts
```

## How it works

```js
import { SutraaClient } from "@sutraa/sdk";

const TENANTS = {
  acme:  { name: "Acme Corp",    plan: "pro"  },
  hobby: { name: "Hobby Dev",    plan: "free" },
  beta:  { name: "Beta Startup", plan: "free" },
};

const clients = new Map();
function clientFor(tenantId) {
  if (clients.has(tenantId)) return clients.get(tenantId);
  const { plan } = TENANTS[tenantId];
  const client = plan === "pro"
    ? new SutraaClient({ apiKey: process.env.SUTRAA_API_KEY })
    : new SutraaClient();
  clients.set(tenantId, client);
  return client;
}

const res = await clientFor(tenantId).text.generate({ task: "summarize", input: text });
```

## Run locally / deploy your own copy

```sh
npm install
vercel env add SUTRAA_API_KEY production   # your own key, for the pro tenant — never commit it
vercel deploy --prod
```

## Notes from testing

- All three tenants worked correctly, including two separate free-tier tenants running through the same keyless client concurrently — confirming tenant routing itself is just app-level logic, it doesn't require per-tenant credentials to function.
- **The free-tier quota we exhausted while testing [`vision-scanner`](../vision-scanner) had already reset** by the time this project was tested (a few hours later) — so it's a rolling/short window, not a hard lockout.
- Hit one transient `upstream_timeout` typed error on a free-tier call; an immediate retry succeeded. Worth building simple retry logic around calls in production, same as you would for any upstream LLM API.
- **Caveat worth knowing:** on the keyless free tier, limits are enforced "per device and per network" per the SDK docs — so two free-tier tenants served by the *same backend* likely share one underlying quota bucket, even though this demo tracks their usage separately at the app level. Real per-tenant isolation (so one noisy free tenant can't exhaust another's limit) requires giving each tenant its own API key, the way `acme` has here.
