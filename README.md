# Sutraa Examples

Real, deployable example apps built on [**@sutraa/sdk**](https://www.npmjs.com/package/@sutraa/sdk) — *zero-config, multi-modal AI for Node.js.* One install, one import: reasoning, text, code, translation, moderation, vision, speech, and embeddings — **no provider accounts, no API key required** on the free tier.

```sh
npm install @sutraa/sdk
```

```ts
import { text, reasoning, sessions } from "@sutraa/sdk";

await text.generate({ input: "Summarize the plot of Dune in one line" });

const chat = await sessions.create();          // server-side memory, optional
await chat.generate({ input: "My name is Mohsin" });
await chat.generate({ input: "What's my name?" }); // → "Mohsin"
```

Each folder in this repo is a **self-contained, runnable project** — clone it, deploy it, read the code. They're meant as honest, from-the-README references for what building on Sutraa actually looks like.

## Examples

| Project | What it shows | Live demo |
|---|---|---|
| [`pet-chatbot`](./pet-chatbot) | A chatbot with a persistent persona + conversation memory using `text.generate` and `sessions`. Zero-config Vercel deploy (static UI + one serverless function), **no API key**. | [sutraa-pet-chatbot.vercel.app](https://sutraa-pet-chatbot.vercel.app) |

*More examples coming — each is just a new top-level directory.*

## Repo layout

```
sutraa-examples/
├── README.md          ← you are here
└── pet-chatbot/       ← one example project, self-contained
    ├── README.md
    ├── package.json
    ├── api/           ← serverless functions
    └── public/        ← static frontend
```

## Adding a new example

1. Create a new top-level directory: `mkdir my-example`
2. Make it self-contained (its own `package.json`, README, and code).
3. Depend on `@sutraa/sdk` and keep the free-tier, keyless flow where possible.
4. Add a row to the **Examples** table above.

## Capabilities at a glance

| Import | Method | Notes |
|---|---|---|
| `reasoning` | `.generate` / `.stream` | returns a reasoning trace |
| `text` | `.generate` / `.stream` | tasks: `chat`, `summarize`, `extract` |
| `code` | `.generate` / `.stream` | production-ready code |
| `translate` | `.text` | `{ input, to, from? }` |
| `moderate` | `.check` | `{ flagged, categories }` |
| `vision` | `.analyze` | `vision.describe`, `vision.ocr` |
| `tts` | `.speak` | linear PCM @ 22.05 kHz |
| `embeddings` | `.embed` | batched, order-preserving |

## License

MIT
