// Is MATRIX_BAND_TILES doing anything the budget cap is not? Three mutants
// survived that all imply it is not. Paired route cost decides it.
import { impl, MATRIX_TILE_SIZE, MATRIX_REQUEST_BUDGET } from "./feat039-impl.mjs";
import { impl as opt, randomInstance, routeCost } from "./feat035-impl.mjs";

// `node --test verify-tmp/*.mjs` sweeps this file up with the real tests — the
// leading underscore does not exclude it from a shell glob, the trap
// _feat032-mutants.mjs already documents. This is a one-off experiment (12 runs x 1000 permits, minutes of CPU), not a test.
if (process.env.NODE_TEST_CONTEXT) {
  console.log("feat039 kprobe: skipped under `node --test` — run `node verify-tmp/_feat039-kprobe.mjs` directly");
  process.exit(0);
}


const N = 1000, RUNS = 12, BUDGET = MATRIX_REQUEST_BUDGET - 1;

async function costWith(rows, matrix, k, nearestFirst = true) {
  const tagged = rows.map((r, i) => ({ ...r, _i: i }));
  impl.setTruth(matrix.durations);
  const order = impl.spatialOrder(tagged);
  const tiles = impl.spatialChunks(tagged, order, MATRIX_TILE_SIZE);
  const durations = Array.from({ length: rows.length }, () => new Array(rows.length).fill(null));
  await impl.fillCoarseDurations(tagged, order, durations);
  let pairs = impl.bandTilePairs(tiles, k, BUDGET);
  if (!nearestFirst) {
    // What the surviving "farthest first" mutant would fetch.
    const span = (a, b) => Math.hypot(tiles[a].x - tiles[b].x, tiles[a].y - tiles[b].y);
    const off = pairs.filter(([a, b]) => a !== b).sort((p, q) => span(q[0], q[1]) - span(p[0], p[1]));
    pairs = [...tiles.map((u, t) => [t, t]), ...off.slice(0, BUDGET - tiles.length)];
  }
  for (const [a, b] of pairs) {
    for (const i of tiles[a].members) for (const j of tiles[b].members) durations[i][j] = matrix.durations[i][j];
  }
  return { cost: routeCost(opt.greedyRouteOrder(rows, { durations }), rows, matrix), requests: pairs.length + 1 };
}

const variants = { "k=4 (shipped)": [4, true], "k=all, budget only": [1e9, true], "k=4, farthest first": [4, false] };
const out = Object.fromEntries(Object.keys(variants).map(k => [k, { d: [], r: 0 }]));

for (let seed = 1; seed <= RUNS; seed += 1) {
  const { rows, matrix } = randomInstance(N, seed);
  const base = routeCost(opt.greedyRouteOrder(rows, matrix), rows, matrix);
  for (const [name, [k, nf]] of Object.entries(variants)) {
    const { cost, requests } = await costWith(rows, matrix, k, nf);
    out[name].d.push((cost - base) / base * 100);
    out[name].r = requests;
  }
}

console.log(`n=${N}, ${RUNS} paired instances, budget ${MATRIX_REQUEST_BUDGET}`);
for (const [name, v] of Object.entries(out)) {
  const mean = v.d.reduce((a, b) => a + b, 0) / v.d.length;
  console.log(`${name.padEnd(22)} ${String(v.r).padStart(4)} req   ${mean.toFixed(2).padStart(6)}% worse than full   worst ${Math.max(...v.d).toFixed(2)}%`);
}
