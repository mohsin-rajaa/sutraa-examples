// ChatSutraa — a LangChain chat model backed by @sutraa/sdk.
//
// deepagents (like any LangChain tool-calling agent) needs a model that can
// emit structured tool calls. Sutraa's text/reasoning capabilities return
// plain text, so this adapter bridges the gap: it renders the conversation +
// an allowed-tool catalog into a prompt, asks Sutraa to reply with a single
// strict JSON decision, and parses that back into an AIMessage carrying either
// `tool_calls` or a final answer — exactly what the agent loop expects.
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === "string" ? p : p?.text ?? "")).join("");
  }
  return String(content ?? "");
}

/** Best-effort, dependency-free hint of a zod tool schema's top-level arg keys. */
function argHint(schema) {
  try {
    const shape = schema?.shape ?? schema?._def?.shape?.() ?? {};
    const keys = Object.keys(shape);
    if (!keys.length) return "{}";
    return "{ " + keys.map((k) => `"${k}": <value>`).join(", ") + " }";
  } catch {
    return "{ ... }";
  }
}

/** Pull the first balanced JSON object out of a possibly-chatty model reply. */
function extractJson(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export class ChatSutraa extends BaseChatModel {
  constructor(fields) {
    super({});
    this.client = fields.client; // a SutraaClient (pro or keyless)
    this.useReasoning = fields.useReasoning ?? false;
    // Only these tool names are offered to the model. Everything else deepagents
    // binds (write_todos, filesystem, …) is intentionally hidden to keep this
    // bounded demo short and reliable; unknown tool calls degrade to a final answer.
    this.exposeTools = new Set(fields.exposeTools ?? []);
    // Hard cap on tool calls so the loop always terminates well within the
    // serverless time budget: once this many tool results are in the history,
    // the model is forced to produce a final answer.
    this.maxToolCalls = fields.maxToolCalls ?? 2;
  }

  get lc_namespace() {
    return ["sutraa", "chat_models"];
  }

  _llmType() {
    return "sutraa";
  }

  #buildPrompt(messages, tools, mustFinish) {
    const lines = [];
    for (const m of messages) {
      const type = m._getType?.() ?? m.type;
      const text = contentToText(m.content);
      if (type === "system") lines.push(`# Instructions\n${text}`);
      else if (type === "human") lines.push(`User: ${text}`);
      else if (type === "tool") lines.push(`Tool result (${m.name ?? "tool"}):\n${text}`);
      else if (type === "ai") {
        if (m.tool_calls?.length) {
          for (const tc of m.tool_calls) lines.push(`You called ${tc.name}(${JSON.stringify(tc.args)}).`);
        } else if (text) {
          lines.push(`Assistant: ${text}`);
        }
      }
    }

    const exposed = tools.filter((t) => this.exposeTools.has(t.name));
    const catalog = exposed
      .map((t) => `- ${t.name}: ${t.description ?? ""}\n  args: ${argHint(t.schema)}`)
      .join("\n");

    lines.push(
      [
        "",
        "# How to respond",
        "Ignore any earlier instructions about todo lists or files.",
        "Reply with EXACTLY ONE JSON object and nothing else — no prose, no markdown fences.",
        mustFinish
          ? "You have gathered enough information. You MUST finish now — do not call any more tools."
          : "To use a tool:\n  {\"tool\": \"<name>\", \"args\": { ... }}",
        "When you have enough information to answer the user, respond:",
        '  {"tool": "finish", "args": {"answer": "<your full answer, citing source URLs inline>"}}',
        "",
        "Available tools:",
        mustFinish ? "(none — you must finish now)" : catalog || "(none — answer directly with finish)",
      ].join("\n"),
    );

    return lines.join("\n\n");
  }

  /** A plain-prose-only prompt, used as a fallback when the forced-finish
   * turn doesn't produce a clean answer (reasoning models sometimes keep
   * emitting JSON/meta-commentary even when told to stop). */
  #buildFinishPrompt(messages) {
    const lines = [];
    for (const m of messages) {
      const type = m._getType?.() ?? m.type;
      const text = contentToText(m.content);
      if (type === "human") lines.push(`User asked: ${text}`);
      else if (type === "tool") lines.push(`Search result (${m.name ?? "tool"}):\n${text}`);
    }
    lines.push(
      [
        "",
        "Your response is shown to the user VERBATIM — it must contain ONLY the final answer, nothing else.",
        "Base it strictly on the search results above; do not guess or add facts they don't support.",
        'Do NOT include any planning, thinking, or meta-commentary (e.g. "We need to...", "Let\'s...", "I\'ll...").',
        "Begin immediately with the substantive answer, as a concise 120–180 word brief citing the source URLs inline.",
      ].join("\n"),
    );
    return lines.join("\n\n");
  }

  /** Last-resort cleanup: if the model still opens with a "thinking out loud"
   * sentence despite instructions, drop it and keep the rest. */
  #stripMetaCommentary(text) {
    const META_LEAD_IN = /^(we need to|let'?s|i'?ll|i will|first,? i|okay,?|first)\b[^.]*\.\s*/i;
    let out = text;
    for (let i = 0; i < 3 && META_LEAD_IN.test(out); i++) out = out.replace(META_LEAD_IN, "");
    return out.trim();
  }

  async _generate(messages, options) {
    const tools = options?.tools ?? [];
    const priorToolResults = messages.filter((m) => (m._getType?.() ?? m.type) === "tool").length;
    const mustFinish = priorToolResults >= this.maxToolCalls;
    const prompt = this.#buildPrompt(messages, tools, mustFinish);

    // Ask for a schema-shaped decision: {"tool": "<name|finish>", "args": {...}}.
    // @sutraa/sdk >=0.6.0 constrains the model to this envelope and returns the
    // gateway-parsed object on `res.json` (code fences / stray prose already
    // repaired, and recovered from the reasoning trace when `.output` is empty).
    const decisionSchema = {
      type: "object",
      properties: {
        tool: { type: "string", enum: [...this.exposeTools, "finish"] },
        args: { type: "object" },
      },
      required: ["tool", "args"],
    };

    const api = this.useReasoning ? this.client.reasoning : this.client.text;
    const res = await api.generate(mustFinish ? { input: prompt } : { input: prompt, schema: decisionSchema });
    const raw = contentToText(res?.output || res?.reasoning || "").trim();

    // Prefer the SDK's parsed structured output; fall back to local extraction
    // for a gateway that predates structured-output support.
    const parsed = res?.json ?? extractJson(raw);
    let toolName = parsed?.tool;
    let toolArgs = parsed?.args;

    // They also don't reliably follow the { tool, args } envelope — sometimes
    // they emit bare args (e.g. { "query": "..." }) for whichever tool they
    // mean. When exactly one tool is exposed and the parsed object isn't an
    // envelope or a finish answer, treat it as args for that tool.
    if (!toolName && parsed && typeof parsed === "object" && !("answer" in parsed) && this.exposeTools.size === 1) {
      [toolName] = this.exposeTools;
      toolArgs = parsed;
    }

    let message;
    if (!mustFinish && toolName && toolName !== "finish" && this.exposeTools.has(toolName)) {
      message = new AIMessage({
        content: "",
        tool_calls: [
          {
            name: toolName,
            args: toolArgs ?? {},
            id: `call_${Math.random().toString(36).slice(2, 12)}`,
            type: "tool_call",
          },
        ],
      });
    } else {
      // "finish", unknown tool, or unparseable → treat as the final answer.
      let answer = parsed?.args?.answer ?? parsed?.answer;
      if (!answer && mustFinish) {
        // The forced-finish turn didn't yield a clean answer (the model kept
        // "thinking" in JSON/meta-commentary despite being told to stop).
        // One plain-prose-only retry is far more reliable than trying to
        // salvage the messy raw text.
        const res2 = await api.generate({ input: this.#buildFinishPrompt(messages) });
        answer = this.#stripMetaCommentary(contentToText(res2?.output || res2?.reasoning || "").trim());
      }
      message = new AIMessage({ content: String(answer || raw) });
    }

    return { generations: [{ text: contentToText(message.content), message }] };
  }

  bindTools(tools, kwargs) {
    // LangChain 1.x dropped Runnable.bind(); withConfig carries the tools
    // through to _generate's options (they aren't a reserved config key).
    return this.withConfig({ tools, ...(kwargs ?? {}) });
  }
}
