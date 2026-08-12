// FIX-035 step 1: INVENTORY, not a fix. For every control in the map's Filters
// drawer, answer three separate questions across a genuine page exit + return:
//
//   SAVE    — did the value reach localStorage?
//   RESTORE — does the control show it again after a reload?
//   APPLY   — does the MAP actually obey it on first render?
//
// APPLY is the one that matters. A control that shows its saved value while the
// map ignores it is the worse bug, because it lies. So every APPLY answer is
// measured from state.map.filteredRows / the map itself, never from the input.
const { chromium, CHROME } = require("./_boot.js");

const SETTINGS_KEY = "chi_permit_map_settings";
const LAYERS_KEY = "chi_permit_map_layers";
const VIEW_KEY = "chi_permit_map_view";

// A wide date window so there is a real population to filter.
const BASE = { dateFrom: "2026-06-01", dateTo: "2026-08-07" };

async function boot(page) {
  await page.goto("http://localhost:8791/map.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 60000 });
  // NOT "filteredRows.length > 0" — a restored filter may legitimately match
  // nothing, and waiting for rows then times out on the exact case under test.
  // The status strip is written at the END of applyMapFilters, so a strip
  // carrying the date range means the first filter pass has completed.
  await page.waitForFunction(() => {
    const el = document.getElementById("map-status-strip");
    return el && / to \d{4}-\d{2}-\d{2}/.test(el.textContent || "");
  }, null, { timeout: 60000 });
}

const snapshot = page => page.evaluate(() => ({
  rows: state.map.filteredRows.length,
  // The SET, sorted — row order depends on the search-match flag and on an
  // async geocode, so comparing the first few permits reports a false failure
  // for a filter that restored perfectly. What matters is which permits survive.
  numbers: state.map.filteredRows.map(r => String(r.n)).sort().join(","),
  settings: JSON.parse(JSON.stringify(state.map.settings || {})),
  center: state.map.map ? [Math.round(state.map.map.getCenter().lng * 1000) / 1000, Math.round(state.map.map.getCenter().lat * 1000) / 1000] : null,
  zoom: state.map.map ? Math.round(state.map.map.getZoom() * 10) / 10 : null,
}));

const results = [];
function record(control, save, restore, apply, note = "") {
  results.push({ control, save, restore, apply, note });
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ json: { rows: [], total: 0, row_count: 0 } }));

  // Seed a known baseline date window so runs are comparable.
  await page.addInitScript(b => { if (!localStorage.getItem("chi_permit_map_settings")) localStorage.setItem("chi_permit_map_settings", JSON.stringify(b)); }, BASE);
  await boot(page);
  const baseline = await snapshot(page);
  console.log(`baseline: ${baseline.rows} permits, ${BASE.dateFrom}..${BASE.dateTo}\n`);

  // Each probe: set the control the way a user would, apply, note the effect,
  // then RELOAD and re-measure. `set` runs in the page.
  const PROBES = [
    { control: "date range (dateFrom/dateTo)", key: "dateFrom",
      set: async () => { $("map-date-from").value = "2026-07-01"; $("map-date-to").value = "2026-07-15"; await applyMapFilters(); },
      saved: s => s.dateFrom === "2026-07-01" && s.dateTo === "2026-07-15" },
    { control: "GC open-job range (gcMin/gcMax)", key: "gcMin",
      set: async () => { $("map-gc-min").value = "3"; await applyMapFilters(); },
      saved: s => s.gcMin === "3" },
    { control: "value range (costMin/costMax)  [FEAT-021]", key: "costMin",
      set: async () => { $("map-cost-min").value = "50000"; await applyMapFilters(); },
      saved: s => s.costMin === "50000" },
    { control: "neighborhood / street", key: "neighborhood",
      set: async () => { $("map-neighborhood").value = "LOGAN"; await applyMapFilters(); },
      saved: s => s.neighborhood === "LOGAN" },
    { control: "radius (miles)", key: "radiusMiles",
      set: async () => { $("map-q").value = "233 S Wacker Dr"; $("map-radius").value = "1"; await applyMapFilters(); },
      saved: s => s.radiusMiles === "1" },
    { control: "search text (q)", key: "q",
      set: async () => { $("map-q").value = "ROOF"; await applyMapFilters(); },
      saved: s => s.q === "ROOF" },
    { control: "property use  [FEAT-024]", key: "propertyUse",
      set: async () => { const el = $("map-property-use"); el.value = el.options[1].value; await applyMapFilters(); },
      saved: s => !!s.propertyUse },
    { control: "work-type exclusions  [FEAT-024]", key: "excludedWorkTypes",
      set: async () => {
        const list = $("map-work-type-list");
        const box = list && list.querySelector("input[type=checkbox]");
        if (!box) return "no checkboxes rendered";
        box.checked = true;
        await applyMapFilters();
      },
      saved: s => Array.isArray(s.excludedWorkTypes) && s.excludedWorkTypes.length > 0 },
    { control: "visited / called chips  [FEAT-040]", key: "visited",
      set: async () => {
        state.lists = { L: { name: "L", permits: state.map.filteredRows.slice(0, 3).map(r => String(r.n)),
          ticks: { [String(state.map.filteredRows[0].n)]: "Divyam" }, called: {}, focal: null, sharedId: null } };
        state.activeListId = "L"; saveUserLists();
        await setMapFlagFilter("visited", "yes");
      },
      saved: s => s.visited === "yes" },
  ];

  for (const probe of PROBES) {
    // Fresh context each probe so they cannot contaminate one another.
    const p = await (await browser.newContext()).newPage();
    await p.route("**/api/**", r => r.fulfill({ json: { rows: [], total: 0, row_count: 0 } }));
    await p.addInitScript(b => { if (!localStorage.getItem("chi_permit_map_settings")) localStorage.setItem("chi_permit_map_settings", JSON.stringify(b)); }, BASE);
    await boot(p);
    // Open the drawer so every control exists in the DOM.
    await p.evaluate(() => { if (!$("map-drawer-filters") || $("map-drawer-filters").hidden) toggleMapDrawer("filters"); });
    await p.waitForTimeout(400);

    let skip = null;
    try { skip = await p.evaluate(probe.set); } catch (e) { skip = "set failed: " + e.message; }
    await p.waitForTimeout(2500);
    if (skip) { record(probe.control, "-", "-", "-", skip); await p.close(); continue; }

    const before = await snapshot(p);
    const stored = await p.evaluate(k => { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch { return {}; } }, SETTINGS_KEY);
    const save = probe.saved(stored);

    // A genuine page exit and return, not an in-place re-render.
    await p.goto("http://localhost:8791/disclaimer.html");
    await p.waitForTimeout(300);
    await boot(p);
    await p.evaluate(() => { if (!$("map-drawer-filters") || $("map-drawer-filters").hidden) toggleMapDrawer("filters"); });
    await p.waitForTimeout(2500);

    const after = await snapshot(p);
    const restore = probe.saved(after.settings);
    // APPLY: did the map come back the same? Compare the rendered result set.
    const apply = after.rows === before.rows && after.numbers === before.numbers;
    record(probe.control, save, restore, apply,
      apply ? "" : `rows ${before.rows} -> ${after.rows}`);
    await p.close();
  }

  // Layers + viewport live in their own keys.
  {
    const p = await (await browser.newContext()).newPage();
    await p.route("**/api/**", r => r.fulfill({ json: { rows: [], total: 0, row_count: 0 } }));
    await p.addInitScript(b => { if (!localStorage.getItem("chi_permit_map_settings")) localStorage.setItem("chi_permit_map_settings", JSON.stringify(b)); }, BASE);
    await boot(p);
    await p.evaluate(() => { state.map.map.jumpTo({ center: [-87.72, 41.93], zoom: 13.5 }); });
    await p.waitForTimeout(2000);
    const before = await snapshot(p);
    const storedView = await p.evaluate(k => localStorage.getItem(k), VIEW_KEY);
    await p.goto("http://localhost:8791/disclaimer.html");
    await p.waitForTimeout(300);
    await boot(p);
    await p.waitForTimeout(2000);
    const after = await snapshot(p);
    record("viewport (center/zoom)", !!storedView, !!storedView,
      JSON.stringify(after.center) === JSON.stringify(before.center) && after.zoom === before.zoom,
      `${JSON.stringify(before.center)}@${before.zoom} -> ${JSON.stringify(after.center)}@${after.zoom}`);
    const storedLayers = await p.evaluate(k => localStorage.getItem(k), LAYERS_KEY);
    record("layer toggles", !!storedLayers, !!storedLayers, "n/a", storedLayers || "nothing stored");
    await p.close();
  }

  console.log("control".padEnd(44) + "SAVE   RESTORE  APPLY   note");
  console.log("-".repeat(100));
  for (const r of results) {
    const f = v => (v === true ? "yes" : v === false ? "NO " : String(v)).padEnd(7);
    console.log(r.control.padEnd(44) + f(r.save) + f(r.restore) + f(r.apply) + r.note);
  }
  const broken = results.filter(r => r.save === false || r.restore === false || r.apply === false);
  console.log(`\n${broken.length} control(s) with at least one NO`);
  await browser.close();
})();
