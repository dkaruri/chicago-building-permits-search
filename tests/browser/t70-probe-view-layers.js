// Focused probe on the two rows the inventory flagged. The layer row was not
// earned — the first pass read the key without ever toggling a layer.
const { chromium, CHROME } = require("./_boot.js");

async function boot(page) {
  await page.goto("http://localhost:8791/map.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 60000 });
  await page.waitForFunction(() => {
    const el = document.getElementById("map-status-strip");
    return el && / to \d{4}-\d{2}-\d{2}/.test(el.textContent || "");
  }, null, { timeout: 60000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext()).newPage();
  await page.route("**/api/**", r => r.fulfill({ json: { rows: [], total: 0, row_count: 0 } }));
  await boot(page);

  console.log("=== VIEWPORT ===");
  console.log("view key before any movement:", await page.evaluate(() => localStorage.getItem("chi_permit_map_view")));

  // Move the map the way a user does — a real drag/zoom fires moveend.
  await page.evaluate(async () => {
    state.map.map.jumpTo({ center: [-87.72, 41.93], zoom: 13.5 });
    state.map.map.fire("moveend");
    state.map.map.fire("dragend");
    state.map.map.fire("zoomend");
  });
  await page.waitForTimeout(2500);
  const afterMove = await page.evaluate(() => localStorage.getItem("chi_permit_map_view"));
  console.log("view key after moving + firing moveend/dragend/zoomend:", afterMove);
  console.log(afterMove ? "  -> something writes it" : "  -> NOTHING writes it: saveMapView() is never called");

  // Prove loadMapView would work if the key were populated — i.e. the restore
  // half is fine and only the save half is missing.
  await page.evaluate(() => localStorage.setItem("chi_permit_map_view",
    JSON.stringify({ lon: -87.72, lat: 41.93, zoom: 13.5 })));
  await boot(page);
  await page.waitForTimeout(1500);
  const restored = await page.evaluate(() => ({
    c: [Math.round(state.map.map.getCenter().lng * 100) / 100, Math.round(state.map.map.getCenter().lat * 100) / 100],
    z: Math.round(state.map.map.getZoom() * 10) / 10,
  }));
  console.log("with the key hand-populated, the map opens at:", JSON.stringify(restored));
  console.log(restored.z === 13.5 ? "  -> loadMapView WORKS; only the save side is missing"
                                  : "  -> restore is broken too");

  console.log("\n=== LAYERS ===");
  const before = await page.evaluate(() => JSON.parse(JSON.stringify(state.map.layers)));
  console.log("default layers:", JSON.stringify(before));
  const toggled = await page.evaluate(() => {
    const key = Object.keys(state.map.layers)[0];
    setMapLayer(key, !state.map.layers[key]);
    return key;
  });
  await page.waitForTimeout(2000);
  const storedLayers = await page.evaluate(() => localStorage.getItem("chi_permit_map_layers"));
  console.log(`after toggling "${toggled}":`, storedLayers);
  await boot(page);
  await page.waitForTimeout(1500);
  const afterReload = await page.evaluate(() => JSON.parse(JSON.stringify(state.map.layers)));
  console.log("layers after a reload:", JSON.stringify(afterReload));
  console.log(afterReload[toggled] !== before[toggled] ? "  -> layer toggle PERSISTS" : "  -> layer toggle LOST");

  await browser.close();
})();
