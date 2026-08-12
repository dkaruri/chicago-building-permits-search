// FEAT-032. Extracted from docs/list.html AT TEST TIME rather than hand-copied,
// for the reason feat024-impl.mjs gives: a static transcription drifts, and a
// test that agrees with a stale copy proves nothing about what ships.
//
// Also asserts the block is byte-identical in docs/index.html and docs/map.html.
// All three pages carry it verbatim, and "fixed on one page only" is the failure
// mode this repo keeps hitting.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs");

const START = "    const LIST_SOURCE_RE = ";
// noteListSource is the last function in the shared block; on list.html
// pushListMeta follows it, which is that page's own and not part of the compare.
const END = "      list.descPending = true;\n    }\n";

function sharedBlock(page) {
  const text = readFileSync(join(DOCS, page), "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf(START);
  if (start < 0) throw new Error(`FEAT-032 extraction failed: no ${START.trim()} in ${page}`);
  const end = text.indexOf(END, start);
  if (end < 0) throw new Error(`FEAT-032 extraction failed: block end not found in ${page}`);
  return text.slice(start, end + END.length);
}

const block = sharedBlock("list.html");
export const blockDrift = ["index.html", "map.html"].filter(page => sharedBlock(page) !== block);

// Stubs for the page globals the extracted code closes over. `clean` is
// transcribed from docs/list.html; it is a one-liner with no FEAT-032 logic in
// it, so drift there is not what this test guards. `Date` is shadowed so the
// provenance stamp is a fixture rather than whatever day the suite runs on.
const preamble = `
  const clean = v => (v === null || v === undefined) ? "" : String(v);
  const Date = globalThis.__stubDate;
  const state = globalThis.__stubState;
  const $ = id => globalThis.__stubControls[id];
  const loadMapSettings = () => globalThis.__stubState.map.settings;
`;

// eslint-disable-next-line no-new-func
const build = new Function(`
  ${preamble}
  ${block}
  return { addSourceSummary, noteListSource, sourceMoney, sourceRange, sourceDay,
           sourceDateRange, sourceCount, LIST_SOURCE_RE, LIST_DESC_LIMIT };
`);

// `today` is "YYYY-MM-DD". Controls are { id: {value} | {checked} }, matching
// what $("cost-min").value / $("usable-processing").checked read.
export function makeApp({ today = "2026-08-05", mode = "open_permits", controls = {}, mapSettings = {}, propertyUseOptions } = {}) {
  const [y, m, d] = today.split("-").map(Number);
  class StubDate {
    constructor() { this.y = y; this.m = m; this.d = d; }
    getMonth() { return this.m - 1; }
    getDate() { return this.d; }
  }
  globalThis.__stubDate = StubDate;
  globalThis.__stubState = { mode, map: { settings: mapSettings } };
  globalThis.__stubControls = controls;
  const app = build();
  // PROPERTY_USE_OPTIONS only exists on map.html; the block guards it with
  // typeof, so leaving it undeclared is the index.html/list.html case.
  if (propertyUseOptions) globalThis.PROPERTY_USE_OPTIONS = propertyUseOptions;
  else delete globalThis.PROPERTY_USE_OPTIONS;
  return app;
}
