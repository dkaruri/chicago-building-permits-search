import test from "node:test";
import assert from "node:assert/strict";
import {
  impl, instance, MAX_SORT_STOPS, MATRIX_REQUEST_BUDGET, MATRIX_TILE_SIZE,
  OSRM_TABLE_COORD_LIMIT, userListLimit,
} from "./feat039-impl.mjs";
import { impl as opt, randomInstance, routeCost } from "./feat035-impl.mjs";

const build = async (n, seed = 1) => {
  const { rows, durations } = instance(n, seed);
  impl.setTruth(durations);
  const matrix = await impl.fetchDurationMatrix(rows);
  return { rows, durations, matrix, calls: impl.calls() };
};

test("the 1000-stop cap is the list cap, and it is affordable", async () => {
  assert.equal(MAX_SORT_STOPS, userListLimit, "the sort ceiling is now the list cap itself");
  const { calls } = await build(MAX_SORT_STOPS);
  assert.ok(
    calls.length <= MATRIX_REQUEST_BUDGET,
    `${MAX_SORT_STOPS} stops cost ${calls.length} requests, over the ${MATRIX_REQUEST_BUDGET} budget`,
  );
  // A full square would have been ceil(1000/50)^2 = 400.
  assert.ok(calls.length < (MAX_SORT_STOPS / MATRIX_TILE_SIZE) ** 2 / 4);
});

test("the budget holds whatever shape the list is", async () => {
  // Uncapped, a real month of Chicago permits cost 101 where a uniform random
  // cloud cost 93 — the mutual-ness of the k-nearest relation moves with the
  // geography. These are deliberately awkward shapes, not more of the same.
  const shapes = {
    "one dense downtown blob": i => ({ latitude: 41.88 + Math.sin(i) * 0.004, longitude: -87.63 + Math.cos(i * 2.7) * 0.004 }),
    "a single north-south corridor": i => ({ latitude: 41.65 + (i / 1000) * 0.36, longitude: -87.65 + Math.sin(i) * 0.002 }),
    "two clusters far apart": i => (i % 2
      ? { latitude: 41.70 + (i % 97) * 0.0004, longitude: -87.80 + (i % 89) * 0.0004 }
      : { latitude: 42.00 + (i % 97) * 0.0004, longitude: -87.60 + (i % 89) * 0.0004 }),
    "a ring": i => ({ latitude: 41.85 + Math.sin(i / 159) * 0.15, longitude: -87.65 + Math.cos(i / 159) * 0.15 }),
  };
  for (const [name, place] of Object.entries(shapes)) {
    const rows = Array.from({ length: MAX_SORT_STOPS }, (unused, i) => ({ _i: i, permit_number: `P${i}`, ...place(i) }));
    const truth = rows.map(a => rows.map(b => 1 + Math.hypot(a.longitude - b.longitude, a.latitude - b.latitude) * 60000));
    for (let i = 0; i < rows.length; i += 1) truth[i][i] = 0;
    impl.setTruth(truth);
    await impl.fetchDurationMatrix(rows);
    assert.ok(
      impl.calls().length <= MATRIX_REQUEST_BUDGET,
      `${name}: ${impl.calls().length} requests, over the ${MATRIX_REQUEST_BUDGET} budget`,
    );
  }
});

test("every tile keeps its own square however tight the budget", () => {
  const { rows } = instance(1000, 11);
  const order = impl.spatialOrder(rows);
  const tiles = impl.spatialChunks(rows, order, MATRIX_TILE_SIZE);
  // A budget that buys nothing but the diagonal must still buy the diagonal:
  // those cells are most of the route's actual legs.
  const starved = impl.bandTilePairs(tiles, 0);
  assert.deepEqual(starved, tiles.map((unused, t) => [t, t]));
});

test("no list size costs more than it does today", async () => {
  for (const n of [550, 600, 700, 800, 900, 1000]) {
    const { calls } = await build(n, 2);
    const full = Math.ceil(n / MATRIX_TILE_SIZE) ** 2;
    assert.ok(calls.length < full, `${n} stops: ${calls.length} requests vs ${full} for the full square`);
    assert.ok(calls.length <= MATRIX_REQUEST_BUDGET, `${n} stops: ${calls.length} requests over budget`);
  }
});

test("no request exceeds OSRM's coordinate limit", async () => {
  for (const n of [150, 500, 1000]) {
    const { calls } = await build(n);
    for (const call of calls) assert.ok(call.coords <= OSRM_TABLE_COORD_LIMIT, `${n}: ${call.coords} coords`);
  }
});

test("lists that route today are untouched: still every cell, still measured", async () => {
  // 500 stops = 100 requests = exactly the budget, so it stays dense.
  const { rows, durations, matrix, calls } = await build(500);
  assert.equal(calls.length, (500 / MATRIX_TILE_SIZE) ** 2);
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = 0; j < rows.length; j += 1) {
      assert.equal(matrix.durations[i][j], durations[i][j], `cell ${i},${j} is not the measured value`);
    }
  }
});

test("under the coordinate limit it is still one plain request", async () => {
  const { calls } = await build(80);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].coords, 80);
});

test("the sparse matrix leaves no hole for the optimizer to trip on", async () => {
  const { rows, matrix } = await build(1000);
  let measured = 0;
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = 0; j < rows.length; j += 1) {
      assert.notEqual(matrix.durations[i][j], null, `cell ${i},${j} is missing`);
      if (i !== j) assert.ok(matrix.durations[i][j] > 0, `cell ${i},${j} is a free teleport`);
    }
  }
  // Sanity on the mix: the band really is a band, not the whole square.
  const { durations } = instance(1000, 1);
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = 0; j < rows.length; j += 1) if (matrix.durations[i][j] === durations[i][j]) measured += 1;
  }
  assert.ok(measured > 200000 && measured < 400000, `measured cells: ${measured}`);
});

test("the coarse layer is fine-grained, and never invents a free leg", async () => {
  // On its own, with nothing measured on top — the band normally hides both of
  // these, and hiding them is exactly how a bad fallback ships unnoticed.
  const n = 1000;
  const { rows, durations: truth } = instance(n, 7);
  impl.setTruth(truth);
  const durations = Array.from({ length: n }, () => new Array(n).fill(null));
  await impl.fillCoarseDurations(rows, impl.spatialOrder(rows), durations);
  let holes = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      if (durations[i][j] == null) { holes += 1; continue; }
      assert.ok(durations[i][j] > 0, `estimate ${i},${j} is a free leg`);
    }
  }
  // Only pairs sharing a representative are left out. At the 100-coordinate
  // limit that is ~10 stops a cell, so ~10*9 per cell over 100 cells. One
  // representative per 50-stop TILE instead would leave ~49k — five times as
  // coarse, and measured 3.0% worse routes at 1000 stops against 1.4%.
  assert.ok(holes < 15000, `${holes} pairs share a representative — the coarse grid is too coarse`);
});

test("a measured value always beats the coarse estimate", async () => {
  const { rows, durations, matrix } = await build(600);
  const order = impl.spatialOrder(rows);
  const tiles = impl.spatialChunks(rows, order, MATRIX_TILE_SIZE);
  for (const [a, b] of impl.bandTilePairs(tiles, MATRIX_REQUEST_BUDGET - 1)) {
    for (const i of tiles[a].members) {
      for (const j of tiles[b].members) {
        assert.equal(matrix.durations[i][j], durations[i][j], `fetched cell ${i},${j} kept an estimate`);
      }
    }
  }
});

test("legDuration still means Infinity when OSRM cannot route a pair", async () => {
  // A null inside a FETCHED tile must survive the coarse layer underneath it.
  const { rows, durations } = instance(600, 3);
  const order = impl.spatialOrder(rows);
  const tiles = impl.spatialChunks(rows, order, MATRIX_TILE_SIZE);
  const [a, b] = [tiles[0].members[0], tiles[0].members[1]];
  durations[a][b] = null;
  impl.setTruth(durations);
  const matrix = await impl.fetchDurationMatrix(rows);
  assert.equal(matrix.durations[a][b], null, "an unroutable pair was papered over with an estimate");
  const legDuration = (x, y) => { const d = matrix.durations[x]?.[y]; return d == null ? Infinity : d; };
  assert.equal(legDuration(a, b), Infinity);
});

test("the spatial order is a permutation and the tiles partition it", () => {
  const { rows } = instance(777, 5);
  const order = impl.spatialOrder(rows);
  assert.deepEqual([...order].sort((p, q) => p - q), rows.map((unused, i) => i));
  const tiles = impl.spatialChunks(rows, order, MATRIX_TILE_SIZE);
  assert.deepEqual(tiles.flatMap(t => t.members).sort((p, q) => p - q), rows.map((unused, i) => i));
  for (const t of tiles) assert.ok(t.members.length <= MATRIX_TILE_SIZE);
});

test("a list stacked on one coordinate does not break the ordering", () => {
  const rows = Array.from({ length: 120 }, (unused, i) => ({ _i: i, latitude: 41.88, longitude: -87.63 }));
  const order = impl.spatialOrder(rows);
  assert.deepEqual(order, rows.map((unused, i) => i));
});

test("the band keeps a tile's own square, and is symmetric", () => {
  const { rows } = instance(1000, 9);
  const order = impl.spatialOrder(rows);
  const tiles = impl.spatialChunks(rows, order, MATRIX_TILE_SIZE);
  const pairs = impl.bandTilePairs(tiles, MATRIX_REQUEST_BUDGET - 1);
  const set = new Set(pairs.map(p => p.join(",")));
  for (let t = 0; t < tiles.length; t += 1) assert.ok(set.has(`${t},${t}`), `tile ${t} lost its own square`);
  for (const [a, b] of pairs) assert.ok(set.has(`${b},${a}`), `pair ${a},${b} has no reverse`);
});

test("the budget buys the closest tile pairs RELATIVE TO TILE SIZE", () => {
  // Structural, and exact: every pair that was fetched must be at least as close
  // as every pair that was not. This is the whole contract of spending a fixed
  // budget nearest-first, and it is cheap enough to assert directly rather than
  // hoping a route-cost average notices it.
  const { rows } = instance(1000, 13);
  const tiles = impl.spatialChunks(rows, impl.spatialOrder(rows), MATRIX_TILE_SIZE);
  // Ranked in units of the two tiles' own size, not raw degrees — an equal-COUNT
  // tiling makes a downtown tile tiny and a south-side tile huge.
  const rank = (a, b) => Math.hypot(tiles[a].x - tiles[b].x, tiles[a].y - tiles[b].y) / (tiles[a].r + tiles[b].r || 1e-9);
  const fetched = new Set(impl.bandTilePairs(tiles, MATRIX_REQUEST_BUDGET - 1).map(p => p.join(",")));
  let longestFetched = 0, shortestSkipped = Infinity, skipped = 0;
  for (let a = 0; a < tiles.length; a += 1) {
    for (let b = a + 1; b < tiles.length; b += 1) {
      if (fetched.has(`${a},${b}`)) longestFetched = Math.max(longestFetched, rank(a, b));
      else { shortestSkipped = Math.min(shortestSkipped, rank(a, b)); skipped += 1; }
    }
  }
  assert.ok(skipped > 0, "the budget did not bind, so this proves nothing — use more stops");
  assert.ok(
    longestFetched <= shortestSkipped,
    `a skipped pair (${shortestSkipped.toFixed(4)}) is closer than a fetched one (${longestFetched.toFixed(4)})`,
  );
});

test("route quality: sparse is within a few percent of the full matrix", async () => {
  // At the CAP, where the budget genuinely binds — an earlier version of this
  // ran at 300 stops, where the budget affords every tile pair anyway, so the
  // matrix was quietly dense and two mutants walked straight through it.
  // Paired, because two correct local optima differ 10% either way on a single
  // run and one comparison says nothing (FEAT-035's lesson).
  const deltas = [];
  for (let seed = 1; seed <= 6; seed += 1) {
    const { rows, matrix } = randomInstance(MAX_SORT_STOPS, seed);
    const tagged = rows.map((r, i) => ({ ...r, _i: i }));
    impl.setTruth(matrix.durations);
    const sparse = await impl.fetchDurationMatrix(tagged);
    const full = routeCost(opt.greedyRouteOrder(rows, matrix), rows, matrix);
    const got = routeCost(opt.greedyRouteOrder(rows, sparse), rows, matrix);
    deltas.push((got - full) / full * 100);
  }
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  assert.ok(mean < 4, `sparse routes averaged ${mean.toFixed(2)}% worse than the full matrix`);
  assert.ok(Math.max(...deltas) < 9, `worst instance was ${Math.max(...deltas).toFixed(2)}% worse`);
});

test("the local search terminates and improves on the sparse matrix", async () => {
  const { rows, matrix } = await build(1000, 4);
  const plain = rows.map(r => ({ permit_number: r.permit_number, latitude: r.latitude, longitude: r.longitude }));
  const started = Date.now();
  const ordered = opt.greedyRouteOrder(plain, matrix);
  assert.ok(Date.now() - started < 20000, "the local search did not finish in 20s");
  assert.equal(ordered.length, plain.length);
  assert.equal(ordered[0].permit_number, plain[0].permit_number, "the pinned start moved");
  assert.equal(new Set(ordered.map(r => r.permit_number)).size, plain.length, "a stop was dropped or duplicated");
  assert.ok(Number.isFinite(routeCost(ordered, plain, matrix)), "the route cost is not finite");
});
