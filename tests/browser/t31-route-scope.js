// t31 (FIX-004): Sort by drive time must cover the WHOLE saved list, not the
// first 100 stops, and the tiled matrix must be assembled correctly.
//
// The old code refused outright above OSRM's 100-coordinate Table limit
// ("limited to 100 mapped permits at a time"). It now tiles: two 50-blocks per
// request, asking for the block-A -> block-B corner via sources=/destinations=.
//
// A. a 150-stop list is no longer refused, and every stop survives the sort
// B. the assembled matrix equals ground truth cell-for-cell — including the
//    asymmetric direction, which is what a mis-indexed tile would scramble
// C. no request exceeds 100 coordinates, and the count is exactly ceil(n/50)^2
// D. the sorted order is genuinely cheaper than the order it started from
// E. the <=100 fast path still issues exactly one request
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

// Fake OSRM: durations derived from the coordinates themselves, so the expected
// value of any cell is computable independently of how the tiles were cut.
// Deliberately ASYMMETRIC — d(a,b) != d(b,a).
const FAKE_OSRM = `
  window.__tableCalls = [];
  const realFetch = window.fetch;
  window.__cost = (a, b) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) * 1000 + (a[0] > b[0] ? 7 : 0);
  window.fetch = (url, opt) => {
    const s = String(url);
    if (s.includes("/table/v1/driving/")) {
      const u = new URL(s);
      const coordText = u.pathname.split("/driving/")[1];
      const coords = coordText.split(";").map(p => p.split(",").map(Number));
      window.__tableCalls.push({ coordCount: coords.length, url: s });
      const idx = key => {
        const v = u.searchParams.get(key);
        return v === null ? coords.map((_, i) => i) : v.split(";").map(Number);
      };
      const sources = idx("sources"), destinations = idx("destinations");
      const durations = sources.map(i => destinations.map(j => window.__cost(coords[i], coords[j])));
      // distances is here only so the PRE-FIX code clears its own
      // !payload.distances guard - otherwise the revert check fails on a
      // missing field instead of on the scope bug it is meant to catch.
      // (No backticks in this comment: it lives inside a template literal.)
      return Promise.resolve(new Response(JSON.stringify({ durations, distances: durations }),
        { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (s.includes("/route/v1/driving/")) {
      const coordText = new URL(s).pathname.split("/driving/")[1];
      const n = coordText.split(";").length;
      return Promise.resolve(new Response(JSON.stringify({
        routes: [{ legs: Array.from({ length: n - 1 }, () => ({ distance: 1000, duration: 60 })) }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return realFetch(url, opt);
  };
`;

const seedList = n => `
  state.focalPoint = null;
  state.userPermitMap = new Map();
  state.userPermitNumbers = [];
  state.lists = { L: { name: "Big", permits: [], focal: null, sharedId: null } };
  state.activeListId = "L";
  for (let i = 0; i < ${n}; i += 1) {
    const num = "P" + String(i).padStart(4, "0");
    // Spread over a plausible city box; deterministic, no RNG.
    const lat = 41.7 + ((i * 37) % 100) / 400;
    const lon = -87.8 + ((i * 53) % 100) / 400;
    state.userPermitMap.set(num, {
      permit_number: num, latitude: lat, longitude: lon,
      address: i + " TEST ST", permit_status: "ACTIVE",
    });
    state.userPermitNumbers.push(num);
    state.lists.L.permits.push(num);
  }
`;

async function run(browser, n) {
  const page = await browser.newPage();
  await page.addInitScript(FAKE_OSRM);
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
  await page.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 0, cached_at: "2026-07-28" }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/list.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });

  const out = await page.evaluate(async ([seed, n]) => {
    eval(seed);
    const before = state.userPermitNumbers.slice();
    const rows = routeRows(userListRows());

    // B: assembled matrix vs ground truth, computed straight from the rows.
    window.__tableCalls.length = 0;
    const matrix = await fetchDurationMatrix(rows);
    const tableCalls = window.__tableCalls.slice();
    const pt = r => [Number(r.longitude), Number(r.latitude)];
    let worstCell = 0, nullCells = 0;
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = 0; j < rows.length; j += 1) {
        const got = matrix.durations[i][j];
        if (got == null) { nullCells += 1; continue; }
        const want = window.__cost(pt(rows[i]), pt(rows[j]));
        worstCell = Math.max(worstCell, Math.abs(got - want));
      }
    }

    // A + D: the real entry point must sort the whole list and improve on it.
    const cost = order => {
      let s = 0;
      for (let k = 0; k < order.length - 1; k += 1) {
        const a = state.userPermitMap.get(order[k]), b = state.userPermitMap.get(order[k + 1]);
        s += window.__cost([Number(a.longitude), Number(a.latitude)], [Number(b.longitude), Number(b.latitude)]);
      }
      return s;
    };
    const costBefore = cost(before);
    await optimizeUserListRoute();
    const after = state.userPermitNumbers.slice();
    const costAfter = cost(after);

    return {
      n,
      matrixCells: rows.length,
      nullCells,
      worstCell,
      tileRequests: tableCalls.length,
      maxCoordsPerRequest: Math.max(...tableCalls.map(c => c.coordCount)),
      keptAll: after.length === before.length && new Set(after).size === before.length,
      refused: /limited to|handles up to/i.test(state.userRouteSummary || ""),
      summary: state.userRouteSummary,
      costBefore: Math.round(costBefore),
      costAfter: Math.round(costAfter),
    };
  }, [seedList(n), n]);

  await page.close();
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const big = await run(browser, 150);
  const small = await run(browser, 40);
  console.log(JSON.stringify({ big, small }, null, 2));

  const expectedTiles = Math.ceil(150 / 50) ** 2;
  const ok =
    big.nullCells === 0 && big.worstCell < 1e-6 &&
    big.tileRequests === expectedTiles && big.maxCoordsPerRequest <= 100 &&
    big.keptAll && !big.refused && big.costAfter < big.costBefore &&
    small.tileRequests === 1 && small.keptAll && !small.refused &&
    small.costAfter < small.costBefore;
  console.log(ok ? "PASS" : "FAIL", `expected ${expectedTiles} tiles for n=150`);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
