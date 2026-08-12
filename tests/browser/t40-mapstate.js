// t40 (FIX-008): the map remembers layers, filters AND where you were looking.
//
// Filters and layers already persisted before this ticket; the viewport did
// not, so every reload threw you back to the whole-city default with the
// filters still applied. Measured, not assumed — see _mapstate.js.
//
// A. every filter control survives a reload
// B. every layer toggle survives a reload
// C. the viewport survives a reload with no search query
// D. the viewport survives a reload WITH a query — the restored query is
//    re-geocoded on load and used to yank the map back to the address
// E. but a NEW search still re-centres; the suppression is one-shot
// F. stale/corrupt saved state never breaks the page or blanks the map
const { chromium } = require("playwright");
const EXE = "C:/Users/divya/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";

const GEO = [{ lat: "41.8790", lon: "-87.6360", display_name: "233 S Wacker Dr" }];

async function boot(ctx, seed) {
  const page = await ctx.newPage();
  if (seed) await page.addInitScript(seed);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  // Tiles and glyphs stubbed: the map's "load" event waits on them, and anything
  // attached inside that handler does not exist until they resolve. Leaving them
  // unstubbed made this suite depend on openstreetmap.org being fast.
  await page.route("**/tile.openstreetmap.org/**", r => r.fulfill({ status: 200, contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") }));
  await page.route("**/fonts.openmaptiles.org/**", r => r.fulfill({ status: 404, body: "" }));
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(GEO) }));
  await page.goto("http://127.0.0.1:8791/map.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 30000 });
  await page.waitForTimeout(2000);
  return { page, errors };
}

const view = p => p.evaluate(() => ({
  lon: +state.map.map.getCenter().lng.toFixed(3),
  lat: +state.map.map.getCenter().lat.toFixed(3),
  zoom: +state.map.map.getZoom().toFixed(2),
}));
const same = (a, b) => ["lon", "lat", "zoom"].every(k => Math.abs(a[k] - b[k]) <= 0.02);

async function reload(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 30000 });
  await page.waitForTimeout(2200);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const bad = [];

  // A + B + D: everything set, including a query.
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let { page } = await boot(ctx);
  await page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set("map-date-from", "2025-03-01"); set("map-date-to", "2025-04-15");
    set("map-gc-min", "3"); set("map-gc-max", "40");
    set("map-q", "233 S Wacker Dr"); set("map-radius", "2");
    saveMapSettingsFromControls();
    setMapLayer("permits", false); setMapLayer("clusters", true);
    setMapLayer("heat", true); setMapLayer("zoning", true); setMapLayer("tif", true);
    state.map.map.jumpTo({ center: [-87.70, 41.92], zoom: 14 });
  });
  await page.waitForTimeout(800);
  const beforeCtl = await page.evaluate(() => ({
    dateFrom: document.getElementById("map-date-from").value,
    dateTo: document.getElementById("map-date-to").value,
    gcMin: document.getElementById("map-gc-min").value,
    gcMax: document.getElementById("map-gc-max").value,
    q: document.getElementById("map-q").value,
    radius: document.getElementById("map-radius").value,
    layers: { ...state.map.layers },
  }));
  const beforeView = await view(page);
  await reload(page);
  const afterCtl = await page.evaluate(() => ({
    dateFrom: document.getElementById("map-date-from").value,
    dateTo: document.getElementById("map-date-to").value,
    gcMin: document.getElementById("map-gc-min").value,
    gcMax: document.getElementById("map-gc-max").value,
    q: document.getElementById("map-q").value,
    radius: document.getElementById("map-radius").value,
    layers: { ...state.map.layers },
  }));
  const afterView = await view(page);
  for (const k of ["dateFrom", "dateTo", "gcMin", "gcMax", "q", "radius"]) {
    if (beforeCtl[k] !== afterCtl[k]) bad.push(`A filter ${k}: "${beforeCtl[k]}" -> "${afterCtl[k]}"`);
  }
  for (const k of Object.keys(beforeCtl.layers)) {
    if (beforeCtl.layers[k] !== afterCtl.layers[k]) bad.push(`B layer ${k}: ${beforeCtl.layers[k]} -> ${afterCtl.layers[k]}`);
  }
  if (!same(beforeView, afterView)) bad.push(`D viewport with query: ${JSON.stringify(beforeView)} -> ${JSON.stringify(afterView)}`);

  // E: a NEW search must still fly to the address.
  await page.evaluate(() => { state.map.map.jumpTo({ center: [-87.90, 42.05], zoom: 11 }); });
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    document.getElementById("map-q").value = "233 S Wacker Dr";
    saveMapSettingsFromControls();
    await renderMapMode(true);
  });
  await page.waitForTimeout(1200);
  const searched = await view(page);
  if (Math.abs(searched.lat - 41.879) > 0.05 || Math.abs(searched.lon + 87.636) > 0.05) {
    bad.push(`E a new search did not re-centre: ${JSON.stringify(searched)}`);
  }
  await ctx.close();

  // C: viewport with no query.
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  ({ page } = await boot(ctx));
  await page.evaluate(() => {
    document.getElementById("map-q").value = "";
    saveMapSettingsFromControls();
    state.map.map.jumpTo({ center: [-87.75, 41.95], zoom: 13.5 });
  });
  await page.waitForTimeout(600);
  const b2 = await view(page);
  await reload(page);
  const a2 = await view(page);
  if (!same(b2, a2)) bad.push(`C viewport without query: ${JSON.stringify(b2)} -> ${JSON.stringify(a2)}`);
  await ctx.close();

  // F: junk in storage must not break the page or blank the map.
  const junk = {
    "future dates": ['chi_permit_map_settings', JSON.stringify({ dateFrom: "2099-01-01", dateTo: "2099-12-31" })],
    "wrong types": ['chi_permit_map_settings', JSON.stringify({ dateFrom: 5, gcMin: {}, q: 7 })],
    "corrupt layers": ['chi_permit_map_layers', "not json at all"],
    "corrupt view": ['chi_permit_map_view', "{{{"],
    "NaN view": ['chi_permit_map_view', JSON.stringify({ lon: "x", lat: null, zoom: 99 })],
    "out-of-range view": ['chi_permit_map_view', JSON.stringify({ lon: 999, lat: 999, zoom: 3 })],
  };
  for (const [label, [key, value]] of Object.entries(junk)) {
    ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const j = await boot(ctx, `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
    const v = await view(j.page);
    const alive = Number.isFinite(v.lon) && Number.isFinite(v.lat) && Number.isFinite(v.zoom);
    if (j.errors.length) bad.push(`F ${label}: page error — ${j.errors[0].slice(0, 90)}`);
    if (!alive) bad.push(`F ${label}: map viewport is not finite — ${JSON.stringify(v)}`);
    console.log(`F ${label.padEnd(18)} errors=${j.errors.length} view=${JSON.stringify(v)}`);
    await ctx.close();
  }

  bad.forEach(b => console.log("BAD " + b));
  console.log(bad.length ? `FAIL ${bad.length}` : "PASS");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
