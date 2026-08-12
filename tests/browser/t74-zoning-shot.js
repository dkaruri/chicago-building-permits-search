// FIX-036 — screenshot the zoning layer at Divyam's case: an RM-4.5 pocket
// surrounded by RS-3, at -87.68890 / 41.91419 (computed from zoning.geojson:
// the RM-4.5 polygon with the most RS-3 neighbours per unit area).
//
// Usage: node verify-tmp/t74-zoning-shot.js <label> [zoom]
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot.js");

const CASE = { lon: -87.68890, lat: 41.91419 };
const label = process.argv[2] || "before";
const zooms = process.argv[3] ? [Number(process.argv[3])] : [14, 15.5];

async function shoot(browser, ctxOpts, tag) {
  const page = await (await browser.newContext(ctxOpts)).newPage();
  await page.route("**/api/**", r => r.fulfill({ json: { rows: [], total: 0, row_count: 0 } }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ json: [] }));
  await page.goto("http://localhost:8791/map.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 60000 });
  // Turn the zoning layer on and wait for the polygons to actually arrive.
  await page.evaluate(() => setMapLayer("zoning", true));
  await page.waitForFunction(() => {
    const s = state.map.map.getSource("zoning");
    return s && s._data && s._data.features && s._data.features.length > 1000;
  }, null, { timeout: 90000 });
  for (const z of zooms) {
    await page.evaluate(({ lon, lat, z }) => state.map.map.jumpTo({ center: [lon, lat], zoom: z }), { ...CASE, z });
    await page.waitForTimeout(3500);
    const path = `verify-tmp/t74-${label}-${tag}-z${z}.png`;
    await page.locator("#permit-map").screenshot({ path });
    console.log("wrote", path);
  }
  // Report what the map thinks is under the case point.
  const at = await page.evaluate(({ lon, lat }) => {
    const p = state.map.map.project([lon, lat]);
    const hits = state.map.map.queryRenderedFeatures(p, { layers: ["zoning-fill"] });
    return hits.map(h => h.properties.zone_class);
  }, CASE);
  console.log(`  zoning under the case point: ${JSON.stringify(at)}`);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  await shoot(browser, { viewport: { width: 900, height: 700 } }, "desktop");
  await shoot(browser, { ...devices["iPhone 13"] }, "iPhone13");
  await browser.close();
})();
