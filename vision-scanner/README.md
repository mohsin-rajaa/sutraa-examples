# 🖼️ Vision Scanner

An image describe + OCR tool built on [**@sutraa/sdk**](https://www.npmjs.com/package/@sutraa/sdk)'s `vision.analyze()`. Paste any public image URL, and get either a natural-language description or extracted text.

**Live demo → [vision-scanner-ten.vercel.app](https://vision-scanner-ten.vercel.app)**

## What it demonstrates

- **`vision.analyze({ image: { url }, task })`** — the two documented tasks, `vision.describe` and `vision.ocr`, side by side in one UI.
- **Keyless free tier** — same zero-config flow as [`pet-chatbot`](../pet-chatbot), no API key.
- **Typed errors** — the API route surfaces the SDK's stable `code` + `requestId` on failure (rate limits, quota, upstream errors), rather than swallowing them.

## Structure

```
vision-scanner/
├── package.json          # one dependency: @sutraa/sdk
├── api/
│   └── vision.js          # serverless POST handler → vision.analyze
└── public/
    └── index.html          # image-URL input + describe/OCR buttons
```

## How it works

```js
import { vision } from "@sutraa/sdk";

const res = await vision.analyze({
  image: { url: "https://example.com/photo.jpg" },
  task: "vision.describe", // or "vision.ocr"
});
res.output; // description or extracted text
```

## Run locally

```sh
npm install
npx vercel dev
```

Or deploy directly:

```sh
npx vercel deploy --prod
```

## Gotcha found while building this (worth knowing)

`image.url` has to be **directly and reliably fetchable by Sutraa's server**, not just openable in a browser. While testing this example, full-resolution **Wikimedia Commons** URLs consistently failed with a `502 upstream_error` — smaller/simpler hosts (`httpbin.org`, `dummyimage.com`, `http.cat`) worked fine, including correctly OCR'ing generated text and describing photos in detail. If your own images fail the same way, try:

- A smaller/resized version of the image (e.g. a thumbnail, not the original multi-MB file).
- A different host — some origins appear to reject or throttle the fetch.

This is a hosting/fetch quirk, not a bug in the SDK's API surface — `vision.analyze()` itself behaved exactly as documented once given a reachable URL.

Also note: the free tier has **both** a per-request rate limit and a **monthly token quota** — both come back as typed errors (`rate_limited`, `quota_exceeded`) with a `requestId`, so they're easy to catch and message to users.
