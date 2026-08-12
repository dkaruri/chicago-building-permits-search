// The client's live-sync reducer, sliced out of docs/list.html AT TEST TIME.
//
// This file used to say "AUTO-EXTRACTED" and was in fact a hand transcription.
// It had already drifted: FEAT-034 added a `fu` case to the real applyListOp in
// 2026-07 and this copy never grew one, so every test here had been passing
// against a reducer that no longer matched what ships. Extracting for real
// means a future divergence fails loudly ("extraction failed") instead of
// quietly agreeing with a stale copy.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTML = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "list.html");
const source = readFileSync(HTML, "utf8");

const start = source.indexOf("\n    function applyListOp(");
if (start < 0) throw new Error("pb-reducer extraction failed: no applyListOp in docs/list.html");
let depth = 0, end = -1;
for (let i = source.indexOf("{", start); i < source.length; i++) {
  if (source[i] === "{") depth++;
  else if (source[i] === "}" && --depth === 0) { end = i + 1; break; }
}
if (end < 0) throw new Error("pb-reducer extraction failed: unbalanced braces in applyListOp");

// eslint-disable-next-line no-new-func
export const applyListOp = new Function(`${source.slice(start, end)}\nreturn applyListOp;`)();
