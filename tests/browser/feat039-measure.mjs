// FEAT-039 measurement: paired route cost, full matrix vs sparse, over many
// instances. Paired because two correct local optima differ 10% either way on a
// single run (FEAT-035's lesson) — only the distribution of the DIFFERENCE says
// anything.
import { impl, randomInstance, routeCost } from "./feat035-impl.mjs";
import { sparseMatrix } from "./feat039-sparse.mjs";

const N = Number(process.argv[2] || 500);
const RUNS = Number(process.argv[3] || 40);
const TILE = 50;

const variants = [
  { name: "band K=4 grid100 ", K: 4, coarseFill: true },
  { name: "band K=4 tilefill", K: 4, coarseFill: true, coarseCells: Math.ceil(N / TILE) },
];

const pct = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const at = q => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { p50: at(0.5), p90: at(0.9), max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length };
};

const results = new Map(variants.map(v => [v.name, { deltas: [], requests: 0 }]));
let fullRequests = 0;

for (let run = 0; run < RUNS; run += 1) {
  const { rows, matrix } = randomInstance(N, run + 1);
  const pts = rows.map(r => ({ x: r.longitude, y: r.latitude }));
  const base = routeCost(impl.greedyRouteOrder(rows, matrix), rows, matrix);
  fullRequests = Math.ceil(N / TILE) ** 2;

  for (const v of variants) {
    const sparse = sparseMatrix(pts, matrix.durations, {
      tileSize: TILE, K: v.K, coarseFill: v.coarseFill,
      ...(v.coarseCells ? { coarseCells: v.coarseCells } : {}),
    });
    // The optimizer sees the sparse matrix; the cost is scored on the TRUE one.
    const cost = routeCost(impl.greedyRouteOrder(rows, { durations: sparse.durations }), rows, matrix);
    const r = results.get(v.name);
    r.deltas.push((cost - base) / base * 100);
    r.requests = sparse.requests;
  }
}

console.log(`n=${N}, ${RUNS} paired instances, tile=${TILE}. Full matrix: ${fullRequests} requests.`);
console.log("variant            requests  cost vs full (%)  p50     p90     worst");
for (const v of variants) {
  const r = results.get(v.name);
  const s = pct(r.deltas);
  console.log(`${v.name}  ${String(r.requests).padStart(8)}  ${s.mean.toFixed(2).padStart(16)}  ${s.p50.toFixed(2).padStart(6)}  ${s.p90.toFixed(2).padStart(6)}  ${s.max.toFixed(2).padStart(6)}`);
}
