// FEAT-039. Extracted from docs/list.html AT TEST TIME, same reason
// feat035-impl.mjs gives: a hand transcription drifts from the page it claims
// to mirror, and a test that agrees with a stale copy proves nothing.
//
// fetchTableChunk is the ONLY thing stubbed — it is the network. Everything
// deciding which cells to ask for, and what to do with the answers, is the
// shipped code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTML = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "list.html");
const source = readFileSync(HTML, "utf8");

function extractBlock(header) {
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`FEAT-039 extraction failed: no ${header.trim()} in docs/list.html`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`FEAT-039 extraction failed: unbalanced braces after ${header.trim()}`);
}

const fn = name => extractBlock(`\n    function ${name}(`);
const asyncFn = name => extractBlock(`\n    async function ${name}(`);

function constant(name) {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(source);
  if (!m) throw new Error(`FEAT-039 extraction failed: no ${name} in docs/list.html`);
  return Number(m[1]);
}

export const OSRM_TABLE_COORD_LIMIT = constant("OSRM_TABLE_COORD_LIMIT");
export const MATRIX_TILE_SIZE = constant("MATRIX_TILE_SIZE");
export const MATRIX_TILE_CONCURRENCY = constant("MATRIX_TILE_CONCURRENCY");
export const MATRIX_REQUEST_BUDGET = constant("MATRIX_REQUEST_BUDGET");
export const MAX_SORT_STOPS = constant("MAX_SORT_STOPS");
export const userListLimit = constant("userListLimit");

const preamble = `
  const OSRM_TABLE_COORD_LIMIT = ${OSRM_TABLE_COORD_LIMIT};
  const MATRIX_TILE_SIZE = ${MATRIX_TILE_SIZE};
  const MATRIX_TILE_CONCURRENCY = ${MATRIX_TILE_CONCURRENCY};
  const MATRIX_REQUEST_BUDGET = ${MATRIX_REQUEST_BUDGET};
  // Stands in for the network. Rows carry _i, their index in the caller's array,
  // so the stub can answer from a full truth matrix and record what was asked.
  let _truth = null;
  let _calls = [];
  function setTruth(t) { _truth = t; _calls = []; }
  function calls() { return _calls; }
  async function fetchTableChunk(rows, sourceCount) {
    if (rows.length > OSRM_TABLE_COORD_LIMIT) {
      throw new Error("stub: " + rows.length + " coordinates exceeds the OSRM request limit");
    }
    const sources = sourceCount == null ? rows : rows.slice(0, sourceCount);
    const dests = sourceCount == null ? rows : rows.slice(sourceCount);
    _calls.push({ coords: rows.length, cells: sources.length * dests.length });
    return sources.map(a => dests.map(b => _truth[a._i][b._i]));
  }
`;

const body = [
  preamble,
  fn("hilbertIndex"),
  fn("spatialOrder"),
  fn("spatialChunks"),
  fn("bandTilePairs"),
  asyncFn("fillCoarseDurations"),
  asyncFn("fetchDurationMatrix"),
  `return { setTruth, calls, hilbertIndex, spatialOrder, spatialChunks,
            bandTilePairs, fillCoarseDurations, fetchDurationMatrix };`,
].join("\n");

// eslint-disable-next-line no-new-func
export const impl = new Function(body)();

// Points + an asymmetric truth matrix, tagged with _i for the stub. Asymmetry
// matters: a symmetric matrix would hide a transposed tile write.
export function instance(n, seed = 1) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const rows = Array.from({ length: n }, (unused, i) => ({
    _i: i,
    permit_number: `P${i}`,
    latitude: 41.7 + rnd() * 0.4,
    longitude: -87.8 + rnd() * 0.4,
  }));
  const durations = rows.map((a, i) => rows.map((b, j) => {
    if (i === j) return 0;
    const base = Math.hypot(a.longitude - b.longitude, a.latitude - b.latitude) * 60000;
    return base * (1 + 0.35 * ((i * 7 + j * 13) % 5) / 4);
  }));
  return { rows, durations };
}
