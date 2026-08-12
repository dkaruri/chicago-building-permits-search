import { test } from "node:test";
import assert from "node:assert";
import {
  impl, LIST_PAGE_SIZE, userListLimit, MAX_SORT_STOPS,
  greedyRouteOrderFullRecompute, randomInstance, routeCost,
} from "./feat035-impl.mjs";

const rows = n => Array.from({ length: n }, (_, i) => ({ permit_number: `P${i}` }));

// ---- The caps themselves ----

test("the shipped caps are the ones FEAT-035 asked for", () => {
  assert.equal(userListLimit, 1000);
  assert.equal(LIST_PAGE_SIZE, 100);
});

test("the client cap does not exceed the Worker's, or a shared list loses its tail", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../worker/src/lists.js", import.meta.url), "utf8");
  const workerCap = Number(/const MAX_PERMITS = (\d+);/.exec(src)[1]);
  assert.equal(workerCap, userListLimit);
});

test("the publish body limit can actually carry a full list", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../worker/src/lists.js", import.meta.url), "utf8");
  const maxBody = Number(/const MAX_BODY = (\d+);/.exec(src)[1]);
  // A full list of realistic 16-character permit numbers, as JSON.
  const body = JSON.stringify({ permits: Array.from({ length: userListLimit }, (_, i) => `1002${String(i).padStart(11, "0")}`) });
  assert.ok(body.length < maxBody, `a full list serialises to ${body.length} bytes, over MAX_BODY ${maxBody}`);
});

// ---- Page arithmetic ----

test("page count covers every row and never reports zero pages", () => {
  assert.equal(impl.listPageCount(0), 1);
  assert.equal(impl.listPageCount(1), 1);
  assert.equal(impl.listPageCount(100), 1);
  assert.equal(impl.listPageCount(101), 2);
  assert.equal(impl.listPageCount(1000), 10);
});

test("a page index left over from a longer list is clamped, not rendered empty", () => {
  impl.setPage(9);
  assert.equal(impl.clampedListPage(1000), 9);
  // The list shrank to 250 rows under a viewer sitting on page 10.
  assert.equal(impl.clampedListPage(250), 2);
  assert.equal(impl.clampedListPage(0), 0);
});

test("a negative or junk page index cannot escape downward", () => {
  impl.setPage(-4);
  assert.equal(impl.clampedListPage(1000), 0);
  impl.setPage(undefined);
  assert.equal(impl.clampedListPage(1000), 0);
});

// ---- The windowed page numbers ----

test("page numbers always include first, last and the current page's neighbours", () => {
  assert.deepEqual(impl.listPageNumbers(4, 10), [0, 3, 4, 5, 9]);
  assert.deepEqual(impl.listPageNumbers(0, 10), [0, 1, 9]);
  assert.deepEqual(impl.listPageNumbers(9, 10), [0, 8, 9]);
});

test("page numbers never duplicate or run past the ends on a short list", () => {
  for (let pages = 2; pages <= 12; pages += 1) {
    for (let page = 0; page < pages; page += 1) {
      const got = impl.listPageNumbers(page, pages);
      assert.deepEqual(got, [...new Set(got)], `duplicates at page ${page} of ${pages}`);
      assert.ok(got.every(n => n >= 0 && n < pages), `out of range at page ${page} of ${pages}`);
      assert.ok(got.includes(page), `current page missing at ${page} of ${pages}`);
      assert.deepEqual(got, [...got].sort((a, b) => a - b), "not ascending");
      // Five numbers at 44px plus gaps is what fits at 390px.
      assert.ok(got.length <= 5, `${got.length} numbers at page ${page} of ${pages}`);
    }
  }
});

// ---- Following a moved stop across a page boundary ----

test("a stop moved past the page boundary is followed to its new page", () => {
  impl.setRows(rows(250));
  impl.setPage(0);
  impl.followPermitToPage("P150");
  assert.equal(impl.state.listPage, 1);
  impl.followPermitToPage("P249");
  assert.equal(impl.state.listPage, 2);
  impl.followPermitToPage("P0");
  assert.equal(impl.state.listPage, 0);
});

test("following a permit that is not in the list leaves the page alone", () => {
  impl.setRows(rows(250));
  impl.setPage(1);
  impl.followPermitToPage("NOT-IN-LIST");
  assert.equal(impl.state.listPage, 1);
});

// ---- The optimizer rewrite ----

test("the 2-opt delta agrees exactly with a full recompute, on an asymmetric matrix", () => {
  const { matrix } = randomInstance(30, 3);
  const D = matrix.durations;
  const leg = (a, b) => D[a]?.[b] ?? Infinity;
  const cost = s => { let t = 0; for (let i = 0; i < s.length - 1; i += 1) t += leg(s[i], s[i + 1]); return t; };
  const order = [...Array(30).keys()];
  let checked = 0;
  for (let i = 1; i < order.length - 1; i += 1) {
    let fwd = 0, rev = 0;
    for (let j = i + 1; j < order.length; j += 1) {
      fwd += leg(order[j - 1], order[j]);
      rev += leg(order[j], order[j - 1]);
      const before = leg(order[i - 1], order[i]) + fwd;
      const after = leg(order[i - 1], order[j]) + rev;
      const tail = j + 1 < order.length ? order[j + 1] : null;
      const delta = tail === null
        ? after - before
        : (after + leg(order[i], tail)) - (before + leg(order[j], tail));
      const cand = order.slice();
      cand.splice(i, j - i + 1, ...cand.slice(i, j + 1).reverse());
      assert.ok(Math.abs((cost(cand) - cost(order)) - delta) < 1e-9, `2-opt delta wrong at i=${i} j=${j}`);
      checked += 1;
    }
  }
  assert.ok(checked > 400, "the delta check did not actually exercise the loop");
});

test("the optimizer returns every stop exactly once, and keeps the pinned start", () => {
  for (const n of [3, 17, 60]) {
    const { rows: r, matrix } = randomInstance(n, 5);
    const out = impl.greedyRouteOrder(r, matrix);
    assert.equal(out.length, n);
    assert.equal(out[0].permit_number, r[0].permit_number, "the pinned origin moved");
    assert.equal(new Set(out.map(x => x.permit_number)).size, n, "a stop was dropped or duplicated");
  }
});

test("the optimizer settles on a real local optimum — no improving move is left", () => {
  const { rows: r, matrix } = randomInstance(40, 6);
  const D = matrix.durations;
  const leg = (a, b) => D[a]?.[b] ?? Infinity;
  const cost = s => { let t = 0; for (let i = 0; i < s.length - 1; i += 1) t += leg(s[i], s[i + 1]); return t; };
  const idx = new Map(r.map((row, i) => [row.permit_number, i]));
  const o = impl.greedyRouteOrder(r, matrix).map(row => idx.get(row.permit_number));
  const base = cost(o);
  for (let i = 1; i < o.length - 1; i += 1) {
    for (let j = i + 1; j < o.length; j += 1) {
      const c = o.slice();
      c.splice(i, j - i + 1, ...c.slice(i, j + 1).reverse());
      assert.ok(cost(c) >= base - 1e-6, `a 2-opt move still improves by ${base - cost(c)}`);
    }
  }
  for (let p = 1; p < o.length; p += 1) {
    for (let q = 1; q < o.length; q += 1) {
      if (q === p) continue;
      const c = o.slice();
      const [node] = c.splice(p, 1);
      c.splice(q > p ? q - 1 : q, 0, node);
      assert.ok(cost(c) >= base - 1e-6, `an Or-opt move still improves by ${base - cost(c)}`);
    }
  }
});

test("route quality holds against the full-recompute version it replaced", () => {
  const diffs = [];
  for (const n of [8, 15, 25, 40, 60]) {
    for (let seed = 1; seed <= 12; seed += 1) {
      const { rows: r, matrix } = randomInstance(n, seed);
      const a = routeCost(impl.greedyRouteOrder(r, matrix), r, matrix);
      const b = routeCost(greedyRouteOrderFullRecompute(r, matrix), r, matrix);
      diffs.push((a - b) / b * 100);
    }
  }
  const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length;
  // Two local searches over the same neighbourhood land on the same optimum
  // most of the time and split the rest; what must not happen is a systematic
  // drift toward worse routes. Measured mean over 200 instances: +0.19%.
  assert.ok(mean < 1, `mean route cost drifted ${mean.toFixed(2)}% worse`);
});

test("the optimizer stays inside its stop ceiling in reasonable time", () => {
  const { rows: r, matrix } = randomInstance(MAX_SORT_STOPS, 11);
  const started = Date.now();
  impl.greedyRouteOrder(r, matrix);
  const ms = Date.now() - started;
  // The pre-FEAT-035 O(n^3) search took ~6.9s at 400 stops on this machine and
  // would be ~13s at 500. A generous bound: this only has to catch the
  // incremental evaluation being lost, which puts an order of magnitude back.
  assert.ok(ms < 5000, `${MAX_SORT_STOPS} stops took ${ms}ms — the local search is no longer incremental`);
});
