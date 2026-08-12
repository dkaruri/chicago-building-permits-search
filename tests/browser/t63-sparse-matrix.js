// t63 (FEAT-039): a full 1000-permit list must actually sort, in the real page,
// inside the routing-request budget.
//
// A. at the cap the Optimize button is available (the note is what FEAT-039
//    removed the need for below 1000)
// B. the sort completes and keeps every permit, once
// C. it costs no more OSRM requests than a 500-stop sort does today, and no
//    request exceeds the 100-coordinate limit
// D. the resulting order is genuinely better than the order it started from
// E. progress reporting stays sane: fractions never exceed the total, and the
//    aria-live region is not spammed
// F. 500 stops still fetches the FULL square — lists that route today are not
//    quietly degraded to buy headroom for bigger ones
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

// Every product number is read from the page at test time. t32 went red once
// for hardcoding a cap the product had legitimately moved.
const SRC = fs.readFileSync(path.join(__dirname, "..", "..", "docs", "list.html"), "utf8");
const num = name => Number(new RegExp(`const ${name} = (\\d+);`).exec(SRC)[1]);
const MAX_SORT_STOPS = num("MAX_SORT_STOPS");
const MATRIX_REQUEST_BUDGET = num("MATRIX_REQUEST_BUDGET");
const MATRIX_TILE_SIZE = num("MATRIX_TILE_SIZE");
const OSRM_TABLE_COORD_LIMIT = num("OSRM_TABLE_COORD_LIMIT");

const FAKE_OSRM = `
  window.__tableCalls = 0;
  window.__maxCoords = 0;
  window.__cells = new Set();
  const realFetch = window.fetch;
  // The same asymmetric cost the optimizer will be scored against below, so a
  // "better route" here means better under the numbers it was actually given.
  window.__cost = (a, b) => {
    if (a[0] === b[0] && a[1] === b[1]) return 0;
    const base = Math.hypot(a[0] - b[0], a[1] - b[1]) * 100000;
    return base * (1 + 0.3 * ((Math.round(a[0] * 1e4) + 2 * Math.round(b[1] * 1e4)) % 5) / 4);
  };
  window.fetch = (url, opt) => {
    const s = String(url);
    if (s.includes("/table/v1/driving/")) {
      const u = new URL(s);
      const coords = u.pathname.split("/driving/")[1].split(";").map(p => p.split(",").map(Number));
      window.__tableCalls += 1;
      window.__maxCoords = Math.max(window.__maxCoords, coords.length);
      const idx = key => {
        const v = u.searchParams.get(key);
        return v === null ? coords.map((unused, i) => i) : v.split(";").map(Number);
      };
      const src = idx("sources"), dst = idx("destinations");
      for (const i of src) for (const j of dst) window.__cells.add(coords[i].join() + ">" + coords[j].join());
      const durations = src.map(i => dst.map(j => window.__cost(coords[i], coords[j])));
      return Promise.resolve(new Response(JSON.stringify({ durations, distances: durations }),
        { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (s.includes("/route/v1/driving/")) {
      const n = new URL(s).pathname.split("/driving/")[1].split(";").length;
      return Promise.resolve(new Response(JSON.stringify({
        routes: [{ legs: Array.from({ length: n - 1 }, () => ({ distance: 1000, duration: 60 })) }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return realFetch(url, opt);
  };
`;

// Spread over the real Chicago bounding box, deterministically and unevenly —
// a perfect grid would flatter a spatial tiling that real addresses will not.
const seed = n => `
  state.focalPoint = null;
  state.userPermitMap = new Map();
  state.userPermitNumbers = [];
  state.lists = { L: { name: "Big", permits: [], focal: null, sharedId: null } };
  state.activeListId = "L";
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < ${n}; i += 1) {
    const num = "P" + String(i).padStart(4, "0");
    state.userPermitMap.set(num, {
      permit_number: num,
      latitude: 41.65 + rnd() * 0.36,
      longitude: -87.85 + rnd() * 0.32,
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
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  // 8791, the port every other t*.js uses (via _boot.js). This suite predates
  // that convention and sat on 8793, which nothing serves during a sweep — so
  // it failed with a connection error / timeout that read as a product bug.
  await page.goto("http://127.0.0.1:8791/list.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });

  await page.evaluate(async s => { eval(s); await showList("L"); }, seed(n));

  const before = await page.evaluate(() => {
    const btn = document.getElementById("optimize-route-btn");
    // Watch the aria-live region rather than reaching into setRouteProgress —
    // this is what a screen reader would actually be told.
    window.__announced = [];
    const region = document.getElementById("user-route-summary");
    new MutationObserver(() => window.__announced.push(region.textContent)).observe(
      region, { childList: true, subtree: true, characterData: true });
    const pt = num => {
      const row = state.userPermitMap.get(num);
      return [Number(row.longitude), Number(row.latitude)];
    };
    const cost = order => order.slice(1).reduce((sum, num, i) => sum + window.__cost(pt(order[i]), pt(num)), 0);
    window.__routeCost = cost;
    return {
      ariaDisabled: btn.getAttribute("aria-disabled"),
      noteHidden: document.getElementById("optimize-route-note").hidden,
      order: state.userPermitNumbers.join(","),
      cost: cost(state.userPermitNumbers),
      stops: state.userPermitNumbers.length,
    };
  });

  await page.click("#optimize-route-btn");
  await page.waitForFunction(() => state.userRouteSummary && /Sorted route/.test(state.userRouteSummary), { timeout: 240000 });

  const after = await page.evaluate(() => ({
    tableCalls: window.__tableCalls,
    maxCoords: window.__maxCoords,
    cells: window.__cells.size,
    order: state.userPermitNumbers.join(","),
    stops: state.userPermitNumbers.length,
    unique: new Set(state.userPermitNumbers).size,
    cost: window.__routeCost(state.userPermitNumbers),
    announced: window.__announced.filter(t => /fetching drive times/.test(t)),
  }));

  await page.close();
  const fractions = after.announced.map(t => (/\((\d+)\/(\d+)\)/.exec(t) || []).slice(1).map(Number)).filter(p => p.length === 2);
  return {
    n,
    ...before,
    ...after,
    order: undefined,
    orderChanged: before.order !== after.order,
    improvedPct: (before.cost - after.cost) / before.cost * 100,
    progressSane: fractions.length > 0
      && fractions.every(([d, t]) => d >= 1 && d <= t && t === after.tableCalls)
      && fractions.every(([d], i) => i === 0 || d >= fractions[i - 1][0]),
    announcements: after.announced.length,
    announced: undefined,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const cap = await run(browser, MAX_SORT_STOPS);
  const dense = await run(browser, 500);
  console.log(JSON.stringify({ cap, dense }, null, 2));

  const fullSquare = Math.ceil(500 / MATRIX_TILE_SIZE) ** 2;
  const ok =
    // A
    cap.ariaDisabled === "false" && cap.noteHidden === true && cap.stops === MAX_SORT_STOPS &&
    // B
    cap.unique === MAX_SORT_STOPS && cap.orderChanged === true &&
    // C
    cap.tableCalls <= MATRIX_REQUEST_BUDGET && cap.maxCoords <= OSRM_TABLE_COORD_LIMIT &&
    // D — a real improvement, not a reshuffle
    cap.improvedPct > 50 &&
    // E
    cap.progressSane && cap.announcements < cap.tableCalls &&
    // F — 500 still buys the whole square, one call per tile pair, nothing sparse
    dense.tableCalls === fullSquare && dense.cells === 500 * 500 && dense.improvedPct > 50;
  console.log(ok ? "PASS" : "FAIL");
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
