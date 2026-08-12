// FIX-036 checklist items 5 and 7: dark-theme legibility, and render/pan cost
// measured rather than assumed — this is a 14.9k-polygon layer and the change
// adds a second source plus a wider stroke.
const { chromium, CHROME } = require("./_boot.js");
const CASE = { lon: -87.68890, lat: 41.91419 };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
  await page.route("**/api/**", r => r.fulfill({ json: { rows: [], total: 0, row_count: 0 } }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ json: [] }));
  await page.goto("http://localhost:8791/map.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 60000 });

  const t0 = Date.now();
  await page.evaluate(() => setMapLayer("zoning", true));
  await page.waitForFunction(() => { const s = state.map.map.getSource("zoning"); return s && s._data && s._data.features.length > 1000; }, null, { timeout: 90000 });
  console.log(`layer on (fetch + derive): ${Date.now() - t0}ms`);

  // Derivation cost on its own, re-run against the already-loaded data.
  // Absent on the pre-fix build; report -1 rather than throwing, so the same
  // probe can measure the baseline for comparison.
  const deriveMs = await page.evaluate(() => {
    if (typeof zoningLabelPoints !== "function") return -1;
    const data = state.map.map.getSource("zoning")._data;
    const t = performance.now();
    zoningLabelPoints(data);
    return Math.round(performance.now() - t);
  });
  console.log(`deriving 14.9k label points: ${deriveMs}ms (one-off, at layer-on)`);

  // Pan cost: time a sequence of jumps to idle.
  const panMs = await page.evaluate(async ({ lon, lat }) => {
    const map = state.map.map;
    const idle = () => new Promise(r => { map.once("idle", r); setTimeout(r, 15000); });
    map.jumpTo({ center: [lon, lat], zoom: 15 }); await idle();
    const t = performance.now();
    for (const d of [0.004, -0.004, 0.006, -0.006]) {
      map.jumpTo({ center: [lon + d, lat + d / 2], zoom: 15 });
      await idle();
    }
    return Math.round(performance.now() - t);
  }, CASE);
  console.log(`four pans at z15 to idle: ${panMs}ms`);

  // Dark theme: the basemap is a raster OSM source, so check whether the page's
  // theme changes anything under the labels at all, then read the contrast.
  const themes = {};
  for (const theme of ["light", "dark"]) {
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(900);
    themes[theme] = await page.evaluate(() => ({
      canvasFilter: getComputedStyle(document.querySelector("#permit-map .maplibregl-canvas") || document.body).filter,
      containerBg: getComputedStyle(document.getElementById("permit-map")).backgroundColor,
      textColor: state.map.map.getPaintProperty("zoning-label", "text-color"),
      haloColor: state.map.map.getPaintProperty("zoning-label", "text-halo-color"),
      lineColor: state.map.map.getPaintProperty("zoning-outline", "line-color"),
    }));
    await page.evaluate(({ lon, lat }) => state.map.map.jumpTo({ center: [lon, lat], zoom: 15.5 }), CASE);
    await page.evaluate(() => new Promise(r => { state.map.map.once("idle", r); setTimeout(r, 15000); }));
    await page.locator("#permit-map").screenshot({ path: `verify-tmp/t74-theme-${theme}.png` });
  }
  console.log("light:", JSON.stringify(themes.light));
  console.log("dark: ", JSON.stringify(themes.dark));
  console.log(JSON.stringify(themes.light) === JSON.stringify(themes.dark)
    ? "  -> the map surface is identical in both themes (raster basemap, no filter), so one set of colours serves both"
    : "  -> the map surface CHANGES with theme; label/outline colours must be checked per theme");

  await browser.close();
})();
