# 🖼️ Vision Scanner

An image-understanding tool built on [**@sutraa/sdk**](https://www.npmjs.com/package/@sutraa/sdk)'s `vision.analyze()`. Paste any public image URL to get a natural-language description or extracted text (OCR).

**Live demo → [vision-scanner-ten.vercel.app](https://vision-scanner-ten.vercel.app)**

## Overview

This example covers the `vision` capability:

- **`vision.analyze({ image: { url }, task })`** — a single method handling both documented tasks, `vision.describe` and `vision.ocr`.
- **Keyless free tier** — same zero-config flow as [`pet-chatbot`](../pet-chatbot).
- **Typed error handling** — the API route forwards the SDK's stable `code` and `requestId` on failure instead of collapsing every error into a generic message, so a caller can distinguish rate limiting from a bad image URL from an upstream failure.

## Project structure

```
vision-scanner/
├── package.json          # one dependency: @sutraa/sdk
├── api/
│   └── vision.js           # serverless POST handler
└── public/
    └── index.html           # image-URL input + describe/OCR actions
```

## Implementation

```js
import { vision } from "@sutraa/sdk";

const res = await vision.analyze({
  image: { url: "https://example.com/photo.jpg" },
  task: "vision.describe", // or "vision.ocr"
});
res.output; // description or extracted text
```

The API route validates the URL, forwards it with the selected task, and returns `{ task, result }` on success or `{ error, code, requestId }` on failure.

## Setup & deployment

```sh
npm install
npx vercel deploy --prod
```

Run locally with:

```sh
npx vercel dev
```

## Image URL requirements

`image.url` must be **directly and reliably fetchable by Sutraa's server** — not merely viewable in a browser. In practice:

- Prefer a reasonably sized image (a thumbnail or resized version) over a large, original-resolution file.
- Use a host that serves images directly without redirects, authentication, or hotlink protection. The sample images in this app (`httpbin.org`, `dummyimage.com`, `http.cat`) are chosen because they satisfy this reliably.
- If a URL you control fails with an upstream error, first confirm it resolves to a plain image response (correct `Content-Type`, no redirect chain) before assuming the request itself is malformed.

## Rate limits and quotas

The free tier enforces both a per-request rate limit and a rolling token quota, surfaced as typed errors (`rate_limited`, `quota_exceeded`) with a `requestId`. Design your UI to catch these explicitly — for example, disable the action buttons and show a clear retry message rather than a raw error string.
