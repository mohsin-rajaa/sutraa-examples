// @langchain/langgraph-sdk ships a rolldown-bundled copy of its dependencies
// under dist/node_modules/ (p-queue, p-retry, eventemitter3, and a shared
// _virtual/_rolldown/runtime.js they all import). Every one of those .js files
// is an ES module, but the tree ships without any package.json, so Node treats
// them as CommonJS and crashes on serverless with:
//   "SyntaxError: Cannot use import statement outside a module"
//
// This postinstall drops a { "type": "module" } marker into every directory of
// that vendored tree that contains ESM .js files but no package.json — a marker
// per directory so Vercel's file tracer includes each one alongside the files
// it belongs to. The .cjs siblings keep their extension and stay CommonJS.
// Targeted workaround for a packaging gap in a transitive dependency.
import { readdirSync, statSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "node_modules/@langchain/langgraph-sdk/dist/node_modules";

let wrote = 0;

function dirHasEsmJs(dir, names) {
  for (const name of names) {
    if (!name.endsWith(".js")) continue;
    try {
      if (/^\s*(import|export)\s/m.test(readFileSync(join(dir, name), "utf8"))) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function walk(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  if (!existsSync(join(dir, "package.json")) && dirHasEsmJs(dir, names)) {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n");
    wrote++;
  }
  for (const name of names) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p);
  }
}

if (existsSync(ROOT)) walk(ROOT);
console.log(`[fix-vendored-esm] wrote ${wrote} type:module marker(s) across the langgraph-sdk vendored bundle`);
