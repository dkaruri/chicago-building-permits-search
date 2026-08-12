// The synthetic clouds said "spend the budget nearest-first, ignore k". One live
// run on real permits came out 6% longer than the k=4 build it replaced. n=1 on
// a stochastic local search proves nothing either way, so: REAL Chicago permit
// coordinates, both selection rules, paired over many samples.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { impl, MATRIX_TILE_SIZE, MATRIX_REQUEST_BUDGET } from "./feat039-impl.mjs";
import { impl as opt, routeCost } from "./feat035-impl.mjs";

// `node --test verify-tmp/*.mjs` sweeps this file up with the real tests — the
// leading underscore does not exclude it from a shell glob, the trap
// _feat032-mutants.mjs already documents. This is a one-off experiment, not a
// test, and it was the ENOENT that had the documented unit command red since
// 03bd149 (FIX-050, folded back into FIX-044).
if (process.env.NODE_TEST_CONTEXT) {
  console.log("feat039 realgeo: skipped under `node --test` — run `node verify-tmp/_feat039-realgeo.mjs` directly");
  process.exit(0);
}

const MAP = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "data", "map");
// The shards were deleted in 03bd149 when loadMapMonths moved to fetching
// Socrata directly. The experiment is not dead — the data is one git command
// away — so say so instead of throwing a bare ENOENT at whoever runs this next.
if (!existsSync(MAP)) {
  console.error([
    "feat039 realgeo needs docs/data/map, deleted in 03bd149 (loadMapMonths now fetches Socrata directly).",
    "The 247 shards are still in git. To run this experiment:",
    "  git checkout 03bd149^ -- docs/data/map",
    "  node verify-tmp/_feat039-realgeo.mjs",
    "  git rm -r --cached docs/data/map && rm -rf docs/data/map    # ~342 MB, do not re-commit",
  ].join("\n"));
  process.exit(1);
}
const all = readdirSync(MAP).filter(f => f.endsWith(".json"))
  .flatMap(f => JSON.parse(readFileSync(join(MAP, f), "utf8")))
  .filter(r => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)));

const N = 1000, RUNS = 8, BUDGET = MATRIX_REQUEST_BUDGET - 1;

function sample(seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pool = all.slice();
  const rows = [];
  for (let i = 0; i < N; i += 1) rows.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return rows.map((r, i) => ({ _i: i, permit_number: `P${i}`, latitude: Number(r.lat), longitude: Number(r.lon) }));
}

// Asymmetric, and scaled the way lat/lon actually are at Chicago's latitude —
// a plain hypot on degrees would make the city 1.3x too wide and flatter any
// east-west tiling.
function truthMatrix(rows) {
  const KX = 111320 * Math.cos(41.85 * Math.PI / 180), KY = 111320;
  return rows.map((a, i) => rows.map((b, j) => {
    if (i === j) return 0;
    const d = Math.hypot((a.longitude - b.longitude) * KX, (a.latitude - b.latitude) * KY);
    return d * (1 + 0.35 * ((i * 7 + j * 13) % 5) / 4);
  }));
}

// The rejected rule: each tile's k nearest tiles, symmetrised, then capped.
function kNearestPairs(tiles, k, budget) {
  const span = (a, b) => Math.hypot(tiles[a].x - tiles[b].x, tiles[a].y - tiles[b].y);
  const near = new Set();
  tiles.forEach((tile, a) => {
    tiles.map((other, b) => ({ b, d: span(a, b) })).sort((p, q) => p.d - q.d || p.b - q.b)
      .slice(0, Math.min(k, tiles.length))
      .forEach(({ b }) => { if (a !== b) near.add(a < b ? `${a},${b}` : `${b},${a}`); });
  });
  return [
    ...tiles.map((u, t) => [t, t]),
    ...[...near].map(key => key.split(",").map(Number))
      .sort((p, q) => span(p[0], p[1]) - span(q[0], q[1]))
      .slice(0, Math.max(0, Math.floor((budget - tiles.length) / 2)))
      .flatMap(([a, b]) => [[a, b], [b, a]]),
  ];
}

async function costOf(rows, truth, pairsFor) {
  impl.setTruth(truth);
  const order = impl.spatialOrder(rows);
  const tiles = impl.spatialChunks(rows, order, MATRIX_TILE_SIZE);
  const durations = Array.from({ length: rows.length }, () => new Array(rows.length).fill(null));
  await impl.fillCoarseDurations(rows, order, durations);
  const pairs = pairsFor(tiles);
  for (const [a, b] of pairs) {
    for (const i of tiles[a].members) for (const j of tiles[b].members) durations[i][j] = truth[i][j];
  }
  return { cost: routeCost(opt.greedyRouteOrder(rows, { durations }), rows, { durations: truth }), requests: pairs.length + 1 };
}

// Rank pairs by span RELATIVE to the two tiles' own radii. Equal-COUNT tiles
// over clustered permits differ enormously in physical size: a 50-permit tile
// downtown is a few blocks, a 50-permit tile on the far south side is miles. A
// raw-distance ranking therefore spends the entire budget downtown and leaves
// the outlying tiles with nothing but the coarse layer.
function normalisedPairs(rows, tiles, budget, floorK = 0) {
  const radius = tiles.map(t => t.members.reduce((s, i) =>
    s + Math.hypot(Number(rows[i].longitude) - t.x, Number(rows[i].latitude) - t.y), 0) / t.members.length || 1e-9);
  const span = (a, b) => Math.hypot(tiles[a].x - tiles[b].x, tiles[a].y - tiles[b].y);
  const rank = (a, b) => span(a, b) / (radius[a] + radius[b]);
  const cand = new Set();
  if (floorK) {
    tiles.forEach((unused, a) => tiles.map((u, b) => ({ b, d: span(a, b) })).sort((p, q) => p.d - q.d)
      .slice(0, floorK).forEach(({ b }) => { if (a !== b) cand.add(a < b ? `${a},${b}` : `${b},${a}`); }));
  } else {
    for (let a = 0; a < tiles.length; a += 1) for (let b = a + 1; b < tiles.length; b += 1) cand.add(`${a},${b}`);
  }
  return [
    ...tiles.map((u, t) => [t, t]),
    ...[...cand].map(k => k.split(",").map(Number))
      .sort((p, q) => rank(p[0], p[1]) - rank(q[0], q[1]))
      .slice(0, Math.max(0, Math.floor((budget - tiles.length) / 2)))
      .flatMap(([a, b]) => [[a, b], [b, a]]),
  ];
}

let ROWS = null;
const rules = {
  "b=100 raw span (shipped)": tiles => impl.bandTilePairs(tiles, 99),
  "b=100 span/radius": tiles => normalisedPairs(ROWS, tiles, 99),
  "b=100 span/radius + k=4": tiles => normalisedPairs(ROWS, tiles, 99, 4),
  "b=200 raw span": tiles => impl.bandTilePairs(tiles, 199),
  "b=200 span/radius": tiles => normalisedPairs(ROWS, tiles, 199),
};
const out = Object.fromEntries(Object.keys(rules).map(k => [k, { d: [], r: 0 }]));

for (let seed = 1; seed <= RUNS; seed += 1) {
  const rows = sample(seed); ROWS = rows;
  const truth = truthMatrix(rows);
  const base = routeCost(opt.greedyRouteOrder(rows, { durations: truth }), rows, { durations: truth });
  for (const [name, pairsFor] of Object.entries(rules)) {
    const { cost, requests } = await costOf(rows, truth, pairsFor);
    out[name].d.push((cost - base) / base * 100);
    out[name].r = requests;
  }
}

console.log(`${RUNS} paired samples of ${N} REAL Chicago permits, budget ${MATRIX_REQUEST_BUDGET}`);
for (const [name, v] of Object.entries(out)) {
  const mean = v.d.reduce((a, b) => a + b, 0) / v.d.length;
  console.log(`${name.padEnd(32)} ${String(v.r).padStart(4)} req  ${mean.toFixed(2).padStart(6)}% worse  worst ${Math.max(...v.d).toFixed(2)}%`);
}
const [a, b] = Object.values(out).map(v => v.d);

