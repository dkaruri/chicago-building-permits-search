// FEAT-039 — the sparse-matrix candidate, prototyped here so it can be measured
// against the full matrix BEFORE it goes into docs/list.html.
//
// The whole point of the card: the matrix costs ceil(n/50)^2 OSRM requests, so
// 1000 stops costs 400. Fetch fewer CELLS instead of routing faster.

// --- Hilbert curve index, so contiguous chunks of the sorted array are
// --- compact geographic tiles rather than arbitrary slices of a list.
export function hilbertIndex(x, y, bits) {
  let d = 0;
  for (let s = 1 << (bits - 1); s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      const t = x; x = y; y = t;
    }
  }
  return d;
}

export function spatialOrder(pts) {
  const BITS = 16, SIZE = (1 << BITS) - 1;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const sx = maxX > minX ? SIZE / (maxX - minX) : 0;
  const sy = maxY > minY ? SIZE / (maxY - minY) : 0;
  return pts
    .map((p, i) => ({ i, d: hilbertIndex(Math.round((p.x - minX) * sx), Math.round((p.y - minY) * sy), BITS) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map(e => e.i);
}

// Which tile pairs get fetched. Returns ordered [a,b] tile-index pairs.
export function tilePairs(centroids, K) {
  const T = centroids.length;
  const near = centroids.map((c, a) => centroids
    .map((o, b) => ({ b, d: Math.hypot(c.x - o.x, c.y - o.y) }))
    .sort((p, q) => p.d - q.d)
    .slice(0, Math.min(K, T))
    .map(e => e.b));
  const keep = new Set();
  for (let a = 0; a < T; a += 1) for (const b of near[a]) { keep.add(`${a},${b}`); keep.add(`${b},${a}`); }
  return [...keep].map(s => s.split(",").map(Number));
}

// Build the sparse matrix the optimizer will see, and report what it cost.
// `truth` is the full matrix an oracle would have; here it stands in for OSRM.
export function sparseMatrix(pts, truth, { tileSize = 50, K = 4, coarseFill = true, coarseCells = 100 } = {}) {
  const n = pts.length;
  const perm = spatialOrder(pts);
  const tiles = [];
  for (let s = 0; s < n; s += tileSize) tiles.push(perm.slice(s, s + tileSize));
  const centroids = tiles.map(t => ({
    x: t.reduce((s, i) => s + pts[i].x, 0) / t.length,
    y: t.reduce((s, i) => s + pts[i].y, 0) / t.length,
  }));
  const durations = Array.from({ length: n }, () => new Array(n).fill(null));

  let requests = 0;
  for (const [a, b] of tilePairs(centroids, K)) {
    requests += 1; // one OSRM Table call per ordered tile pair (a===b is the full square)
    for (const i of tiles[a]) for (const j of tiles[b]) durations[i][j] = truth[i][j];
  }

  if (coarseFill && tiles.length > 1) {
    // ONE extra request fills every pair the band skipped. A Table request takes
    // 100 coordinates, so the fallback layer is a 100-cell grid over the whole
    // list — a tenth of the stops at the 1000 cap, not one point per tile.
    requests += 1;
    const cellSize = Math.ceil(n / Math.min(coarseCells, n));
    const cells = [];
    for (let s = 0; s < n; s += cellSize) cells.push(perm.slice(s, s + cellSize));
    const cellOf = new Array(n);
    cells.forEach((c, ci) => c.forEach(i => { cellOf[i] = ci; }));
    const reps = cells.map(c => {
      const cx = c.reduce((s, i) => s + pts[i].x, 0) / c.length;
      const cy = c.reduce((s, i) => s + pts[i].y, 0) / c.length;
      return c.reduce((best, i) =>
        Math.hypot(pts[i].x - cx, pts[i].y - cy) < Math.hypot(pts[best].x - cx, pts[best].y - cy) ? i : best, c[0]);
    });
    const coarse = reps.map(a => reps.map(b => truth[a][b]));
    for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
      if (durations[i][j] == null) durations[i][j] = coarse[cellOf[i]][cellOf[j]];
    }
  }
  return { durations, requests, tiles: tiles.length };
}
