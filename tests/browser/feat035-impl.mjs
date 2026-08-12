// FEAT-035. Extracted from docs/list.html AT TEST TIME, same reason
// feat024-impl.mjs and feat031-impl.mjs give: a hand transcription drifts from
// the page it claims to mirror, and a test that agrees with a stale copy proves
// nothing about what ships.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTML = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "list.html");
const source = readFileSync(HTML, "utf8");

function extractBlock(header) {
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`FEAT-035 extraction failed: no ${header.trim()} in docs/list.html`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`FEAT-035 extraction failed: unbalanced braces after ${header.trim()}`);
}

const fn = name => extractBlock(`\n    function ${name}(`);

// Pull the two caps out of the page rather than restating them, so a test can
// assert the shipped numbers instead of a copy that can quietly disagree.
function constant(name) {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(source);
  if (!m) throw new Error(`FEAT-035 extraction failed: no ${name} in docs/list.html`);
  return Number(m[1]);
}

export const LIST_PAGE_SIZE = constant("LIST_PAGE_SIZE");
export const userListLimit = constant("userListLimit");
export const MAX_SORT_STOPS = constant("MAX_SORT_STOPS");

const preamble = `
  const LIST_PAGE_SIZE = ${LIST_PAGE_SIZE};
  const userListLimit = ${userListLimit};
  let state = { listPage: 0 };
  function setPage(p) { state.listPage = p; }
  const fmt = n => String(n);
  const clean = value => (value === null || value === undefined) ? "" : String(value);
  let _rows = [];
  function setRows(rows) { _rows = rows; }
  function userListRows() { return _rows; }
  function visibleListRows(rows) { return rows; }
`;

const body = [
  preamble,
  fn("listPageCount"),
  fn("clampedListPage"),
  fn("listPageNumbers"),
  // followPermitToPage was refactored to delegate to followStopToPage when
  // hand-typed stops got their own identity (FIX-042/043), and this list was
  // not updated — so both of its tests threw "followStopToPage is not
  // defined". tickKeyFor comes with it, extracted rather than stubbed: it IS
  // the identity rule the follow depends on, and a stub would let the test
  // agree with a copy instead of the page.
  fn("tickKeyFor"),
  fn("followStopToPage"),
  fn("followPermitToPage"),
  fn("greedyRouteOrder"),
  `return { state, setPage, setRows, listPageCount, clampedListPage, listPageNumbers,
            tickKeyFor, followStopToPage, followPermitToPage, greedyRouteOrder };`,
].join("\n");

// eslint-disable-next-line no-new-func
export const impl = new Function(body)();

// The optimizer as it stood before FEAT-035 rewrote the local search: identical
// accept/reject rule, but every candidate priced by rebuilding and re-summing
// the whole path. Kept here ONLY as the reference the new incremental version
// is measured against — route quality must not regress, and the delta
// arithmetic must agree with a full recompute.
export function greedyRouteOrderFullRecompute(rows, matrix) {
  const remaining = new Set(rows.map((_, index) => index));
  let order = [0];
  remaining.delete(0);
  while (remaining.size) {
    const last = order[order.length - 1];
    let best = null;
    remaining.forEach(index => {
      const duration = matrix.durations[last]?.[index];
      if (duration == null) return;
      if (!best || duration < best.duration) best = { index, duration };
    });
    const next = best ? best.index : remaining.values().next().value;
    order.push(next);
    remaining.delete(next);
  }
  const legDuration = (a, b) => {
    const d = matrix.durations[a]?.[b];
    return d == null ? Infinity : d;
  };
  const pathCost = seq => {
    let sum = 0;
    for (let i = 0; i < seq.length - 1; i += 1) sum += legDuration(seq[i], seq[i + 1]);
    return sum;
  };
  let bestCost = pathCost(order);
  let improved = true;
  let passes = 0;
  while (improved && passes < 60) {
    improved = false;
    passes += 1;
    for (let i = 1; i < order.length - 1; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        let lo = i, hi = j;
        while (lo < hi) { const t = order[lo]; order[lo] = order[hi]; order[hi] = t; lo += 1; hi -= 1; }
        const cost = pathCost(order);
        if (cost < bestCost - 1e-6) { bestCost = cost; improved = true; }
        else { lo = i; hi = j; while (lo < hi) { const t = order[lo]; order[lo] = order[hi]; order[hi] = t; lo += 1; hi -= 1; } }
      }
    }
    for (let p = 1; p < order.length; p += 1) {
      for (let q = 1; q < order.length; q += 1) {
        if (q === p) continue;
        const candidate = order.slice();
        const [node] = candidate.splice(p, 1);
        candidate.splice(q > p ? q - 1 : q, 0, node);
        const cost = pathCost(candidate);
        if (cost < bestCost - 1e-6) { order = candidate; bestCost = cost; improved = true; }
      }
    }
  }
  return order.map(index => rows[index]);
}

// A deterministic asymmetric duration matrix over random points. Asymmetry is
// the point: a symmetric matrix would let a wrong 2-opt delta pass unnoticed,
// because the reversed interior would cost the same as the forward one.
export function randomInstance(n, seed = 1) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pts = Array.from({ length: n }, () => ({ x: rnd() * 100, y: rnd() * 100 }));
  const durations = pts.map((a, i) => pts.map((b, j) => {
    if (i === j) return 0;
    const base = Math.hypot(a.x - b.x, a.y - b.y);
    // One-way streets: the cost of a->b is not the cost of b->a.
    return base * (1 + 0.35 * ((i * 7 + j * 13) % 5) / 4);
  }));
  const rows = pts.map((p, i) => ({ permit_number: `P${i}`, latitude: p.y, longitude: p.x }));
  return { rows, matrix: { durations } };
}

export function routeCost(ordered, rows, matrix) {
  const index = new Map(rows.map((r, i) => [r.permit_number, i]));
  let sum = 0;
  for (let i = 0; i < ordered.length - 1; i += 1) {
    sum += matrix.durations[index.get(ordered[i].permit_number)][index.get(ordered[i + 1].permit_number)];
  }
  return sum;
}
