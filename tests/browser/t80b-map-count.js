// FIX-040, second surface: the Permit Map's counts. The report is about
// work-type include/exclude, so prove the map's three count surfaces
// (#result-count, #map-count-pill, #map-visible-summary), the "Add all N to
// list" button, the painted source features and what add-all actually adds all
// come from ONE filtered set — before and after excluding a work type, and
// after a value-range filter (the checklist asks whether the other filters
// share the bug).
const { chromium, devices } = require("playwright");
const EXE = "C:/Users/divya/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  PASS ${n}`); } else { fail++; console.log(`  FAIL ${n} ${x}`); } };

const permit = (id, work_type, permit_type, cost) => ({
  permit_: id, permit_status: "ACTIVE", permit_type, work_type,
  issue_date: "2026-07-15T00:00:00.000", street_number: "1", street_direction: "N", street_name: "TEST ST",
  work_description: "TEST", reported_cost: String(cost), ward: "1", community_area: "22",
  latitude: "41.905", longitude: "-87.695"
});
// 6 Electrical, 4 Reroofing. Costs split so a value filter cuts across both.
const PERMITS = [
  ...Array.from({ length: 6 }, (_, i) => permit(`ELEC-${i}`, "Electrical Work", "PERMIT – EXPRESS PERMIT PROGRAM", 10000 * (i + 1))),
  ...Array.from({ length: 4 }, (_, i) => permit(`ROOF-${i}`, "Reroofing", "PERMIT – EXPRESS PERMIT PROGRAM", 10000 * (i + 1)))
];

async function boot(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/tile.openstreetmap.org/**", r => r.fulfill({ status: 200, contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") }));
  await page.route("**/fonts.openmaptiles.org/**", r => r.fulfill({ status: 404, body: "" }));
  await page.route("**/api/**", r => r.fulfill({ json: { rows: [], row_count: 0, lists: [] } }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ json: [] }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ json: PERMITS }));
  await page.goto("http://127.0.0.1:8791/map.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return { page, errors };
}

const applyWith = (page, mutate) => page.evaluate(async mutate => {
  $("map-date-from").value = "2026-07-01";
  $("map-date-to").value = "2026-07-31";
  // eslint-disable-next-line no-eval
  eval(mutate);
  await applyMapFilters();
  const num = el => { const m = /([\d,]+)/.exec(el ? el.textContent : ""); return m ? Number(m[1].replace(/,/g, "")) : null; };
  // What add-all would add, without touching the user's list: the same
  // filteredRows minus what is already saved (nothing is, in this fixture).
  window.__added = null;
  window.pickList = () => Promise.resolve("L1");
  window.addPermitsToUserList = rows => { window.__added = rows.length; return Promise.resolve(); };
  await addAllMapPermitsToList();
  return {
    filtered: state.map.filteredRows.length,
    resultCount: num($("result-count")),
    pill: num($("map-count-pill")),
    visibleSummary: /of ([\d,]+) filtered/.exec($("map-visible-summary").textContent),
    addAllLabel: num($("map-add-all")),
    features: state.map.map.getSource("permits")._data.features.length,
    added: window.__added
  };
}, mutate);

const setExcluded = keys => `document.querySelectorAll("#map-work-type-list input").forEach(b => { b.checked = ${JSON.stringify(keys)}.includes(b.value); });`;

const agree = (label, r, expected) => {
  const summary = r.visibleSummary ? Number(r.visibleSummary[1].replace(/,/g, "")) : null;
  ok(`${label}: filteredRows = ${expected}`, r.filtered === expected, JSON.stringify(r));
  ok(`${label}: #result-count agrees`, r.resultCount === expected, JSON.stringify(r));
  ok(`${label}: count pill agrees`, r.pill === expected, JSON.stringify(r));
  ok(`${label}: visible summary total agrees`, summary === expected, JSON.stringify(r));
  // At zero the button drops the number and disables ("Add all to list").
  ok(`${label}: "Add all N" agrees`, r.addAllLabel === expected || (expected === 0 && r.addAllLabel === null), JSON.stringify(r));
  ok(`${label}: painted features agree`, r.features === expected, JSON.stringify(r));
  // At zero the add is a no-op by design, so nothing is handed to the list.
  ok(`${label}: add-all adds exactly that many`, r.added === expected || (expected === 0 && r.added === null), JSON.stringify(r));
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  for (const [ctxOpts, tag] of [[{ viewport: { width: 1280, height: 900 } }, "desktop"], [{ ...devices["iPhone 13"] }, "iphone13"]]) {
    const ctx = await browser.newContext(ctxOpts);
    const { page, errors } = await boot(ctx);
    console.log(tag);
    agree(`${tag} baseline`, await applyWith(page, "void 0;"), 10);
    agree(`${tag} Electrical excluded`, await applyWith(page, setExcluded(["Electrical Work"])), 4);
    agree(`${tag} Electrical + Reroofing excluded`, await applyWith(page, setExcluded(["Electrical Work", "Reroofing"])), 0);
    agree(`${tag} exclusion cleared`, await applyWith(page, setExcluded([])), 10);
    agree(`${tag} value range >= 30000`, await applyWith(page, `$("map-cost-min").value = "30000";`), 6);
    await applyWith(page, `$("map-cost-min").value = "";`);
    ok(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  console.log(`${fail ? "FAIL" : "PASS"} ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
