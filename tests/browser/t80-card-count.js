// FIX-040. The contractor card's "Add all N to list" count and the set it adds
// must follow the card's filters (work type, permit type, role, text), not the
// unfiltered permit list.
//   A. control — no filter: button says 60, adding adds 60 (proves the probe
//      can report success)
//   B. work type = RENOVATION: table shows 30, button must say 30
//   C. adding then adds exactly those 30 — the number shown equals the number added
//   D. the same holds for a NON work-type filter (text search), so the fix is at
//      the derivation, not on the work-type path alone
// Runs on index.html and list.html (the card markup is shared by design) at
// desktop and iPhone 13 viewports.
const { chromium, devices } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

const CONTACTS = [{
  contact_name: "CONTRACTOR 000", open_jobs: 60, total_jobs: 90, avg_processing_days: 7,
  reported_cost_total: 1234, city: "CHICAGO", state: "IL", zipcode: "60601",
  sample_contact_type: "GENERAL CONTRACTOR", license_matches: [], work_types: [], permit_types: [], contact_types: []
}];
// 60 permits: 30 RENOVATION (odd i, "NORTH ST") and 30 NEW CONSTRUCTION (even i).
const PERMITS = Array.from({ length: 60 }, (_, i) => ({
  permit_number: "P" + i, permit_status: "ACTIVE", issue_date: "2026-07-01",
  address: (i % 2 ? "NORTH" : "SOUTH") + " ST " + i,
  work_type: i % 2 ? "RENOVATION" : "NEW CONSTRUCTION",
  permit_type: "PERMIT - RENOVATION", reported_cost: 1000 * i,
  general_contractors: "CONTRACTOR 000", open_subs: ""
}));

const addAllText = () => {
  const btn = [...document.querySelectorAll(".pm-actions .pm-act")].find(b => /Add all/.test(b.textContent));
  return btn ? btn.textContent.trim() : "";
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const results = [];
  // BASE=https://dkaruri.github.io/chicago-building-permits-search drives the
  // DEPLOYED pages instead of the local preview (the API/Socrata calls are
  // mocked either way, so only the page under test changes).
  const BASE = process.env.BASE || "http://127.0.0.1:8791";
  for (const url of [`${BASE}/index.html`, `${BASE}/list.html`]) {
    for (const [ctxOpts, tag] of [[{ viewport: { width: 1280, height: 900 } }, "desktop"], [{ ...devices["iPhone 13"] }, "iphone13"]]) {
      const ctx = await browser.newContext(ctxOpts);
      const p = await ctx.newPage();
      const errs = [];
      p.on("pageerror", e => errs.push(String(e).slice(0, 160)));
      await p.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
      await p.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 1, cached_at: "x" }) }));
      await p.route("**/api/contact/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ contact_name: "CONTRACTOR 000", matched_as: "CONTRACTOR 000", matched_category: "general_contractor", seeded_at: "2026-07-28T12:00:00.000Z", total_jobs: 90, license_matches: [], work_types: [], permit_types: [], contact_types: [] }) }));
      await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: PERMITS, row_count: PERMITS.length }) }));
      await p.route("**/api/profiles**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: CONTACTS, total: CONTACTS.length }) }));
      await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
      await p.goto(url, { waitUntil: "domcontentloaded" });
      await p.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });

      // list.html hides the directory, so reach the card through openContactCard
      // directly on both pages — the card, not the route to it, is under test.
      await p.evaluate(() => {
        window.__added = [];
        window.pickList = () => Promise.resolve("L1");
        window.addPermitsToUserList = rows => { window.__added.push(rows.length); return Promise.resolve(); };
      });
      await p.evaluate(() => openContactCard(encodeURIComponent("CONTRACTOR 000"), "general_contractor"));
      await p.waitForFunction(() => (activeCard() || {}).loaded, { timeout: 15000 });

      const read = () => p.evaluate(([fn]) => ({
        button: new Function("return (" + fn + ")()")(),
        rows: document.querySelectorAll(".pm-tablewrap tbody tr").length,
        filtered: cardFilteredPermits(activeCard()).length,
        total: (activeCard().permits || []).length
      }), [String(addAllText)]);
      const clickAdd = () => p.evaluate(() => {
        window.__added = [];
        return addAllFromCard().then(() => window.__added.slice());
      });

      const control = await read();
      const controlAdded = await clickAdd();

      await p.evaluate(() => setCardFilter("workType", "RENOVATION"));
      const filtered = await read();
      const filteredAdded = await clickAdd();

      await p.evaluate(() => { setCardFilter("workType", ""); setCardFilter("q", "NORTH ST 1"); });
      const textFiltered = await read();
      const textAdded = await clickAdd();

      results.push([`${url.split("/").pop()} ${tag}`, { control, controlAdded, filtered, filteredAdded, textFiltered, textAdded, errs }]);
      await ctx.close();
    }
  }

  const problems = [];
  for (const [key, r] of results) {
    if (r.errs.length) problems.push(`${key}: page errors ${r.errs.join(" | ")}`);
    // A. control
    if (r.control.total !== 60) problems.push(`${key}: setup — ${r.control.total} permits on the card, expected 60`);
    if (!/Add all 60 to list/.test(r.control.button)) problems.push(`${key}: unfiltered button "${r.control.button}", expected "Add all 60 to list"`);
    if (String(r.controlAdded) !== "60") problems.push(`${key}: unfiltered add added ${r.controlAdded}, expected 60`);
    // B/C. work-type filter
    if (r.filtered.filtered !== 30 || r.filtered.rows !== 25) problems.push(`${key}: work-type filter matched ${r.filtered.filtered} (rows ${r.filtered.rows}), expected 30 (25 on page 1)`);
    if (!/Add all 30 to list/.test(r.filtered.button)) problems.push(`${key}: filtered button "${r.filtered.button}", expected "Add all 30 to list"`);
    if (String(r.filteredAdded) !== "30") problems.push(`${key}: filtered add added ${r.filteredAdded}, expected 30`);
    // D. text filter — same derivation
    if (!(r.textFiltered.filtered > 0 && r.textFiltered.filtered < 30)) problems.push(`${key}: text filter matched ${r.textFiltered.filtered}, expected a proper subset of the 60`);
    if (!new RegExp(`Add all ${r.textFiltered.filtered} to list`).test(r.textFiltered.button)) problems.push(`${key}: text-filtered button "${r.textFiltered.button}", expected ${r.textFiltered.filtered}`);
    if (String(r.textAdded) !== String(r.textFiltered.filtered)) problems.push(`${key}: text-filtered add added ${r.textAdded}, expected ${r.textFiltered.filtered}`);
  }
  console.log(problems.length ? "FAIL" : "PASS");
  console.log(JSON.stringify(results, null, 1));
  if (problems.length) console.log("PROBLEMS:" + String.fromCharCode(10) + problems.join(String.fromCharCode(10)));
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})();
