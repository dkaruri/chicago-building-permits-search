// FIX-035 guard suite — every control in the map's Filters drawer survives a
// genuine page exit and return, AND the map that comes back matches the one
// that was left (camera included).
//
// Asserting the input value alone would pass the "shows but does not apply"
// bug, so every check reads state.map.filteredRows or the camera itself.
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot.js");

const BASE = { dateFrom: "2026-06-01", dateTo: "2026-08-07" };
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

async function boot(page) {
  await page.goto("http://localhost:8791/map.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 60000 });
  // Not "rows > 0" — a restored filter may legitimately match nothing.
  await page.waitForFunction(() => {
    const el = document.getElementById("map-status-strip");
    return el && / to \d{4}-\d{2}-\d{2}/.test(el.textContent || "");
  }, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
}

async function leaveAndReturn(page) {
  await page.goto("http://localhost:8791/disclaimer.html");
  await page.waitForTimeout(300);
  await boot(page);
}

const shot = page => page.evaluate(() => ({
  rows: state.map.filteredRows.length,
  set: state.map.filteredRows.map(r => String(r.n)).sort().join(","),
  lon: Math.round(state.map.map.getCenter().lng * 100) / 100,
  lat: Math.round(state.map.map.getCenter().lat * 100) / 100,
  zoom: Math.round(state.map.map.getZoom() * 10) / 10,
}));

async function newPage(browser, ctxOpts, seed = BASE) {
  const p = await (await browser.newContext(ctxOpts)).newPage();
  await p.route("**/api/**", r => r.fulfill({ json: { rows: [], total: 0, row_count: 0 } }));
  await p.addInitScript(b => {
    // Seed ONLY when empty — re-seeding on every navigation clobbers exactly
    // what this suite is trying to observe.
    if (!localStorage.getItem("chi_permit_map_settings")) {
      localStorage.setItem("chi_permit_map_settings", JSON.stringify(b));
    }
  }, seed);
  return p;
}

async function run(label, ctxOpts) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });

  // --- 1. every filter control, set together, survives the round trip -------
  {
    const p = await newPage(browser, ctxOpts);
    await boot(p);
    await p.evaluate(() => { if (!$("map-drawer-filters") || $("map-drawer-filters").hidden) toggleMapDrawer("filters"); });
    await p.waitForTimeout(400);
    await p.evaluate(async () => {
      // Tuned to leave a NON-EMPTY, non-total result set: 0 -> 0 would still
      // discriminate (a dropped filter gives thousands) but it is a weak guard.
      $("map-date-from").value = "2026-07-01";
      $("map-date-to").value = "2026-07-20";
      $("map-cost-min").value = "25000";
      $("map-neighborhood").value = "LOGAN";
      const box = $("map-work-type-list") && $("map-work-type-list").querySelector("input[type=checkbox]");
      if (box) box.checked = true;
      await applyMapFilters();
    });
    await p.waitForTimeout(2500);
    const before = await shot(p);
    check("the combined filters leave a non-trivial result set to compare",
      before.rows > 0, `${before.rows} rows`);
    await leaveAndReturn(p);
    const after = await shot(p);
    check("every filter re-applies together after a page exit",
      after.set === before.set && after.rows === before.rows, `${before.rows} -> ${after.rows}`);
    const controls = await p.evaluate(() => ({
      from: $("map-date-from").value, to: $("map-date-to").value,
      cost: $("map-cost-min").value, hood: $("map-neighborhood").value,
      excluded: (loadMapSettings().excludedWorkTypes || []).length,
    }));
    check("the controls show what was applied",
      controls.from === "2026-07-01" && controls.to === "2026-07-20"
      && controls.cost === "25000" && controls.hood === "LOGAN" && controls.excluded > 0,
      JSON.stringify(controls));
    await p.close();
  }

  // --- 2. the viewport: the defect this card is really about ---------------
  {
    const p = await newPage(browser, ctxOpts);
    await boot(p);
    await p.evaluate(() => { state.map.map.jumpTo({ center: [-87.72, 41.93], zoom: 13.5 }); state.map.map.fire("moveend"); });
    await p.waitForTimeout(1500);
    const before = await shot(p);
    await leaveAndReturn(p);
    const after = await shot(p);
    check("the map comes back where it was left",
      Math.abs(after.zoom - before.zoom) < 0.3 && Math.abs(after.lon - before.lon) < 0.02 && Math.abs(after.lat - before.lat) < 0.02,
      `${before.lon},${before.lat}@${before.zoom} -> ${after.lon},${after.lat}@${after.zoom}`);
    // And the saved view must not have been overwritten by an auto-fit.
    const stored = await p.evaluate(() => JSON.parse(localStorage.getItem("chi_permit_map_view") || "null"));
    check("returning does not overwrite the saved view with a fit-to-all-pins",
      stored && Math.abs(stored.zoom - 13.5) < 0.3, JSON.stringify(stored));
    await p.close();
  }

  // --- 3. CONTROL: a NEW search must still re-centre ------------------------
  {
    const p = await newPage(browser, ctxOpts);
    await boot(p);
    await p.evaluate(() => { state.map.map.jumpTo({ center: [-87.9, 41.65], zoom: 14 }); state.map.map.fire("moveend"); });
    await p.waitForTimeout(1200);
    const before = await shot(p);
    await p.evaluate(async () => { $("map-q").value = "233 S Wacker Dr"; await applyMapFilters(); });
    await p.waitForTimeout(4000);
    const after = await shot(p);
    check("CONTROL: a new search still re-centres the map",
      Math.abs(after.lon - before.lon) > 0.05 || Math.abs(after.lat - before.lat) > 0.05,
      `${before.lon},${before.lat} -> ${after.lon},${after.lat}`);
    await p.close();
  }

  // --- 4. CONTROL: changing a filter still re-frames ------------------------
  {
    const p = await newPage(browser, ctxOpts);
    await boot(p);
    await p.evaluate(() => { state.map.map.jumpTo({ center: [-88.5, 42.5], zoom: 16 }); state.map.map.fire("moveend"); });
    await p.waitForTimeout(1200);
    const before = await shot(p);
    await p.evaluate(async () => { $("map-neighborhood").value = "LOGAN"; await applyMapFilters(); });
    await p.waitForTimeout(3000);
    const after = await shot(p);
    check("CONTROL: applying a filter in-session still frames the results",
      after.zoom !== before.zoom || Math.abs(after.lon - before.lon) > 0.05,
      `${before.lon},${before.lat}@${before.zoom} -> ${after.lon},${after.lat}@${after.zoom}`);
    await p.close();
  }

  // --- 5. degrade safely on stale / corrupt saved state --------------------
  const CORRUPT = [
    ["a value range with min > max", { ...BASE, costMin: "900000", costMax: "1000" }],
    ["an excluded work type that no longer exists", { ...BASE, excludedWorkTypes: ["NO_SUCH_WORK_TYPE_XYZ"] }],
    ["a property use that is not an option", { ...BASE, propertyUse: "not-a-real-use" }],
    ["a garbage date range", { ...BASE, dateFrom: "nonsense", dateTo: "" }],
  ];
  for (const [name, seed] of CORRUPT) {
    const p = await newPage(browser, ctxOpts, seed);
    let crashed = null;
    p.on("pageerror", e => { crashed = e.message; });
    await p.goto("http://localhost:8791/map.html");
    const ready = await p.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 })
      .then(() => true).catch(() => false);
    await p.waitForTimeout(3000);
    const strip = await p.locator("#map-status-strip").textContent().catch(() => "");
    check(`degrades safely: ${name}`, ready && !crashed && (strip || "").trim().length > 0,
      crashed ? `page error: ${crashed}` : `strip: "${(strip || "").trim().slice(0, 70)}"`);
    await p.close();
  }

  // --- 6. corrupt viewport must not blank the canvas -----------------------
  {
    const p = await newPage(browser, ctxOpts);
    await p.addInitScript(() => localStorage.setItem("chi_permit_map_view", JSON.stringify({ lon: 999, lat: 999, zoom: 99 })));
    await boot(p);
    const s = await shot(p);
    check("a corrupt saved viewport falls back to the default",
      Number.isFinite(s.lon) && Number.isFinite(s.zoom) && Math.abs(s.lat) <= 90,
      `${s.lon},${s.lat}@${s.zoom}`);
    await p.close();
  }

  await browser.close();
}

(async () => {
  await run("desktop", {});
  await run("iPhone13", { ...devices["iPhone 13"] });
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
