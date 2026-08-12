// FIX-036 against PRODUCTION: the deployed map, the real zoning.geojson, at the
// reported RM-4.5 pocket. No mocks. Live network — retry before believing it.
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot.js");
const CASE = { lon: -87.68890, lat: 41.91419 };
let failures = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); if (!ok) failures++; };

async function run(label, opts) {
  console.log(`\n=== ${label} (production) ===`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext(opts)).newPage();
  await page.goto("https://dkaruri.github.io/chicago-building-permits-search/map.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 60000 });
  await page.evaluate(() => setMapLayer("zoning", true));
  await page.waitForFunction(() => { const s = state.map.map.getSource("zoning"); return s && s._data && s._data.features.length > 1000; }, null, { timeout: 120000 });
  await page.evaluate(({ lon, lat }) => state.map.map.jumpTo({ center: [lon, lat], zoom: 15.5 }), CASE);
  await page.evaluate(() => new Promise(r => { state.map.map.once("idle", r); setTimeout(r, 25000); }));
  await page.waitForTimeout(600);

  const audit = await page.evaluate(() => {
    const map = state.map.map;
    return map.queryRenderedFeatures({ layers: ["zoning-label"] }).map(l => {
      const p = map.project(l.geometry.coordinates);
      return { says: l.properties.zone_class, under: map.queryRenderedFeatures(p, { layers: ["zoning-fill"] }).map(f => f.properties.zone_class) };
    });
  });
  check("labels render on the live map", audit.length > 0, `${audit.length} labels`);
  const wrong = audit.filter(a => a.under.length && !a.under.includes(a.says));
  check("every live label sits inside a district of its own class", wrong.length === 0,
    wrong.length ? `${wrong.length} misplaced, e.g. "${wrong[0].says}" over ${JSON.stringify(wrong[0].under)}` : `${audit.length} checked`);
  const pocket = await page.evaluate(({ lon, lat }) => {
    const map = state.map.map, p = map.project([lon, lat]);
    return { cls: map.queryRenderedFeatures(p, { layers: ["zoning-fill"] }).map(f => f.properties.zone_class),
             outlines: map.queryRenderedFeatures([[p.x - 60, p.y - 60], [p.x + 60, p.y + 60]], { layers: ["zoning-outline"] }).length };
  }, CASE);
  check("the reported RM-4.5 pocket is bounded on the live map",
    pocket.cls.includes("RM-4.5") && pocket.outlines > 0, `under=${JSON.stringify(pocket.cls)}, outlines nearby=${pocket.outlines}`);
  await page.locator("#permit-map").screenshot({ path: `verify-tmp/t74-live-${label}.png` });
  await browser.close();
}
(async () => {
  await run("desktop", { viewport: { width: 900, height: 700 } });
  await run("iPhone13", { ...devices["iPhone 13"] });
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
