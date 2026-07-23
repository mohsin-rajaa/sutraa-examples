# 🏢 Multi-Tenant SaaS Demo

A "summarize text on behalf of a customer" application built to demonstrate the multi-tenant pattern documented by [**@sutraa/sdk**](https://www.npmjs.com/package/@sutraa/sdk):

```ts
const sutraa = new SutraaClient();           // keyless free tier
const pro = new SutraaClient({ apiKey });    // pro
```

Three demo tenants across two plans, served by one API route — each tenant resolves to its own `SutraaClient` instance.

**Live demo → [multi-tenant-saas-zeta.vercel.app](https://multi-tenant-saas-zeta.vercel.app)**

## Overview

- **Per-tenant client instances**, constructed once and cached in a `Map<tenantId, SutraaClient>`, rather than recreated on every request.
- **Mixed plans in a single deployment**: `acme` runs on the pro tier via an API key; `hobby` and `beta` run on the keyless free tier.
- **Server-only secrets**: the API key never reaches the browser — read from `process.env.SUTRAA_API_KEY`, stored as a Vercel Sensitive environment variable, same as [`reasoning-explorer`](../reasoning-explorer).
- **Per-tenant error context**: failed requests include `tenantId` and `plan` alongside the SDK's typed error fields, so a real application can route retries, alerting, or billing logic per tenant.

## Project structure

```
multi-tenant-saas/
├── package.json
├── api/
│   └── summarize.js       # tenant lookup → cached SutraaClient → text.generate
└── public/
    └── index.html           # tenant picker + summarizer + usage counts
```

## Implementation

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
    : new SutraaClient({ apiKey: "" }); // see "Environment variable precedence" below
  clients.set(tenantId, client);
  return client;
}

const res = await clientFor(tenantId).text.generate({ task: "summarize", input: text });
```

Caching clients by tenant avoids re-establishing device identity or re-parsing configuration on every request, and keeps each tenant's calls attributable to the correct plan.

## Environment variable precedence

`SutraaClient`'s constructor resolves its key as `options.apiKey ?? process.env.SUTRAA_API_KEY`. This means **`new SutraaClient()` is keyless only when `SUTRAA_API_KEY` is unset for the whole process** — in any app where that variable is set for one client (here, the `acme` pro tenant), every other `SutraaClient()` constructed without an explicit key will silently inherit it too.

In a single-tenant app this is usually the behavior you want — it's what lets `configure({ apiKey })` and the env var work interchangeably for the module-level `text`/`reasoning`/etc. functions. In a **multi-tenant** app deliberately mixing plans, it's the opposite of what you want: it collapses your free-tier tenants onto the pro key without any code signaling that it happened.

The fix is to override explicitly for tenants that must stay keyless:

```js
new SutraaClient({ apiKey: "" }) // empty string is falsy — the SDK skips auth and uses the anonymous flow
```

`options.apiKey` only falls through to the env var when it is `null`/`undefined` (via `??`); an explicit empty string is preserved and evaluated as "no key" downstream. `null` and `undefined` are **not** safe overrides here — both are nullish and still trigger the env var fallback.

## Setup & deployment

```sh
npm install
vercel env add SUTRAA_API_KEY production   # your own key, for the pro tenant
vercel deploy --prod
```

**Deployment note:** `*.vercel.app` subdomains are allocated globally across all Vercel accounts, not per-project. If your chosen project name is already taken, Vercel assigns a suffixed alias automatically (e.g. `my-app-zeta.vercel.app`). After your first deploy, confirm the actual assigned domain with `vercel ls` rather than assuming `<project-name>.vercel.app`.

## Production considerations

**Tenant isolation.** The free tier's limits are enforced per device/network, not per logical tenant. Two free-tier tenants served by the same backend share one underlying quota — this demo tracks their usage separately at the application level for visibility, but that is attribution, not isolation. For tenants that need guaranteed, independent limits, provision a dedicated API key per tenant, the way `acme` has here.

**Transient failures.** Upstream calls can occasionally fail with a typed, retryable error (e.g. `upstream_timeout`). Wrap calls in retry-with-backoff logic rather than surfacing a single failed attempt directly to the end user — this is standard practice for any upstream LLM integration, not specific to Sutraa.

**Quota windows.** Rate limits and quotas reset on a rolling basis rather than persisting indefinitely once hit. Don't treat a `quota_exceeded` response as a permanent state in your application logic — surface it to the user as temporary, and retry later rather than disabling the feature outright.
