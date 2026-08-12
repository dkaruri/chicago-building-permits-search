// FIX-035 against PRODUCTION. Sets real filters, moves the map, leaves the site
// entirely, comes back — and asserts both the result set and the camera.
// Reaches the live network; retry before believing a failure.
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot.js");

const SITE = "https://dkaruri.github.io/chicago-building-permits-search";
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

async function boot(page) {
  await page.goto(`${SITE}/map.html`);
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 60000 });
  await page.waitForFunction(() => {
    const el = document.getElementById("map-status-strip");
    return el && / to \d{4}-\d{2}-\d{2}/.test(el.textContent || "");
  }, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
}

const shot = page => page.evaluate(() => ({
  rows: state.map.filteredRows.length,
  set: state.map.filteredRows.map(r => String(r.n)).sort().join(","),
  lon: Math.round(state.map.map.getCenter().lng * 100) / 100,
  lat: Math.round(state.map.map.getCenter().lat * 100) / 100,
  zoom: Math.round(state.map.map.getZoom() * 10) / 10,
}));

async function run(label, ctxOpts) {
  console.log(`\n=== ${label} (production) ===`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext(ctxOpts)).newPage();
  await boot(page);

  // Set filters the way a person would, then move the map somewhere specific.
  await page.evaluate(() => { if (!$("map-drawer-filters") || $("map-drawer-filters").hidden) toggleMapDrawer("filters"); });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    $("map-cost-min").value = "40000";
    $("map-neighborhood").value = "LOGAN";
    await applyMapFilters();
  });
  await page.waitForTimeout(4000);
  await page.evaluate(() => { state.map.map.jumpTo({ center: [-87.71, 41.92], zoom: 14.2 }); state.map.map.fire("moveend"); });
  await page.waitForTimeout(2000);
  const before = await shot(page);
  console.log(`   left with ${before.rows} permits at ${before.lon},${before.lat}@${before.zoom}`);
  check("the filters actually narrowed the live map", before.rows > 0 && before.rows < 40000, `${before.rows} rows`);

  // Leave the site entirely, then come back.
  await page.goto(`${SITE}/disclaimer.html`);
  await page.waitForTimeout(1000);
  await boot(page);
  const after = await shot(page);
  console.log(`   returned with ${after.rows} permits at ${after.lon},${after.lat}@${after.zoom}`);

  check("the filtered result set is identical on return",
    after.set === before.set && after.rows === before.rows, `${before.rows} -> ${after.rows}`);
  check("the camera is where it was left",
    Math.abs(after.zoom - before.zoom) < 0.3 && Math.abs(after.lon - before.lon) < 0.02 && Math.abs(after.lat - before.lat) < 0.02,
    `${before.lon},${before.lat}@${before.zoom} -> ${after.lon},${after.lat}@${after.zoom}`);
  check("the controls came back populated",
    await page.evaluate(() => $("map-cost-min").value) === "40000"
    && await page.evaluate(() => $("map-neighborhood").value) === "LOGAN");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("chi_permit_map_view") || "null"));
  check("returning did not overwrite the saved view with a fit-to-all-pins",
    saved && Math.abs(saved.zoom - 14.2) < 0.3, JSON.stringify(saved));

  await page.screenshot({ path: `verify-tmp/t71-live-${label}.png` });
  await browser.close();
}

(async () => {
  await run("desktop", {});
  await run("iPhone13", { ...devices["iPhone 13"] });
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
