// The entire backend. serve() exposes /v1/models, /v1/chat/completions,
// /v1/responses, and /v1/embeddings (all with streaming), backed by Sutraa's
// free tier — no OpenAI/Gemini/Anthropic key, no config. See vercel.json for
// the one rewrite rule that routes /v1/* to this function.
import { serve } from "@sutraa/sdk";

export default serve();

export const maxDuration = 60; // LLM calls need headroom (Hobby caps at 60s)
