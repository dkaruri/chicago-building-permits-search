// FEAT-038. Extracted from docs/index.html AT TEST TIME rather than hand-copied,
// for the reason feat024-impl.mjs gives: a static transcription drifts, and a
// test that agrees with a stale copy proves nothing about what ships.
//
// Also asserts the block is byte-identical in docs/list.html — the two pages
// duplicate the permit overlay by design, and a fix applied to one of them is
// the failure mode this repo keeps hitting.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs");
const source = readFileSync(join(DOCS, "index.html"), "utf8");
const listSource = readFileSync(join(DOCS, "list.html"), "utf8");

function extractFunction(text, name, where) {
  let start = text.indexOf(`\n    function ${name}(`);
  if (start < 0) start = text.indexOf(`\n    async function ${name}(`);
  if (start < 0) throw new Error(`FEAT-038 extraction failed: no function ${name} in ${where}`);
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`FEAT-038 extraction failed: unbalanced braces in ${name}`);
}

// The two class tables, sliced between markers rather than brace-matched: the
// first is an IIFE whose closing brace is not the end of the statement.
function extractTables(text, where) {
  const start = text.indexOf("    const ASSESSOR_CLASS_USE = ");
  const end = text.indexOf("    const parcelUseCache = new Map();");
  if (start < 0 || end < 0 || end < start) throw new Error(`FEAT-038 extraction failed: class tables not found in ${where}`);
  return text.slice(start, end);
}

const NAMES = ["ensurePermitPins", "ensurePermitParcelUse", "parcelUseHtml", "permitUse"];

const pieces = [extractTables(source, "docs/index.html"), ...NAMES.map(n => extractFunction(source, n, "docs/index.html"))];
const listPieces = [extractTables(listSource, "docs/list.html"), ...NAMES.map(n => extractFunction(listSource, n, "docs/list.html"))];

const LABELS = ["class tables", ...NAMES];
export const blockDrift = LABELS.filter((_, i) => pieces[i] !== listPieces[i]);

// Stubs for the page globals the extracted code closes over. `clean` and `esc`
// are transcribed from docs/index.html; they are one-liners with no FEAT-038
// logic in them, so drift there is not what this test is guarding.
const preamble = `
  const clean = v => (v === null || v === undefined) ? "" : String(v);
  const esc = s => clean(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const parcelUseCache = new Map();
  const permitPinCache = new Map();
  let fetch = globalThis.__stubFetch;
`;

const body = `${preamble}\n${pieces.join("\n")}\n
  return { ASSESSOR_CLASS_USE, ASSESSOR_USE_LABEL, ensurePermitPins, ensurePermitParcelUse,
           parcelUseHtml, permitUse, parcelUseCache, permitPinCache };`;

// eslint-disable-next-line no-new-func
const build = new Function(body);

export function makeApp(stubFetch) {
  globalThis.__stubFetch = stubFetch;
  return build();
}

// A stub Socrata pair. `pins` maps permit number -> raw pin_list string;
// `parcels` maps pin10 -> array of { class, year } (any order — the code relies
// on the $order=year DESC the real endpoint applies, so the stub applies it too).
export function stubSocrata({ pins = {}, parcels = {}, fail = () => false, seen = [] } = {}) {
  const decode = url => decodeURIComponent(url.replace(/\+/g, " "));
  return async url => {
    seen.push(url);
    if (fail(url)) throw new Error("network");
    const query = decode(url);
    if (url.includes("data.cityofchicago.org")) {
      const number = query.match(/permit_ = '([^']*)'/)?.[1] ?? "";
      const value = pins[number];
      return { json: async () => (value === undefined ? [] : [{ pin_list: value }]) };
    }
    const wanted = (query.match(/pin10 in\(([^)]*)\)/)?.[1] || "")
      .split(",").map(s => s.replace(/'/g, "").trim()).filter(Boolean);
    const rows = [];
    for (const pin of wanted) for (const rec of parcels[pin] || []) rows.push({ pin10: pin, class: rec.class, year: rec.year });
    // The real endpoint applies $order=year DESC; the code depends on that, so
    // the stub must too — otherwise the test would pass on an unordered feed.
    rows.sort((a, b) => Number(b.year) - Number(a.year));
    return { json: async () => rows };
  };
}
