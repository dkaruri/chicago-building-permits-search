// Phase 3: chi_permit_last_view grows from a bare string into
// { view, tab, q, sort, page, scroll, selected } and is restored on load.
//  A. index.html round-trips tab + query + sort + page + scroll
//     (selection is NOT persisted: the side pane it selected into was removed
//     when contractor profiles moved into the overlay, and the overlay is
//     deliberately never restored)
//  B. an explicit ?mode=/?q= beats the restored value
//  C. a legacy bare-string value migrates to { view } instead of being dropped
//  D. list.html still restores its view through the new object form
//  E. two saves inside one debounce window both survive (no lost patch)
//  F. the overlay is deliberately NOT restored
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const KEY = "chi_permit_last_view";

// 180 contractors: enough for several pages at pageSize 100.
const CONTACTS = Array.from({ length: 180 }, (_, i) => ({
  contact_name: `CONTRACTOR ${String(i).padStart(3, "0")}`,
  open_jobs: 180 - i, total_jobs: 200 + i, avg_processing_days: 5 + (i % 9),
  reported_cost_total: 1000 * i, city: "CHICAGO", state: "IL", zipcode: "60601",
  sample_contact_type: "GENERAL CONTRACTOR", license_matches: [], work_types: [], permit_types: [], contact_types: [],
}));

async function page(browser, { url = "http://127.0.0.1:8791/index.html", seed = null, query = "", height = 900 } = {}) {
  // A short viewport for the scroll cases — at 900px tall with the detail pane
  // open the page does not overflow, so window.scrollY can never leave 0.
  const p = await browser.newPage({ viewport: { width: 1280, height } });
  if (seed !== null) await p.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, seed]);
  // Playwright resolves overlapping page.route patterns LIFO, so the catch-all
  // must be registered FIRST for the specific mocks to win.
  await p.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
  await p.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 1, cached_at: "2026-07-28" }) }));
  await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0 }) }));
  await p.route("**/api/contact/**", r => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Contact not found" }) }));
  await p.route("**/api/profiles**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: CONTACTS, total: CONTACTS.length }) }));
  await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await p.goto(url + query, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });
  return p;
}

const stored = p => p.evaluate(k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return localStorage.getItem(k); } }, KEY);

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const out = {};

  // ---- A: write side, then restore side.
  let p = await page(browser, { height: 420 });
  await p.evaluate(() => {
    state.mode = "general_contractors";
    document.getElementById("q").value = "CONTRACTOR 0";
  });
  await p.evaluate(() => search());
  await p.waitForFunction(() => state.filteredRows.length > 0);
  await p.evaluate(() => changePage(1));
  await p.evaluate(() => window.scrollTo(0, 240));
  await p.waitForFunction(() => window.scrollY > 0, { timeout: 5000 });
  await p.waitForFunction(() => (readLastView().scroll || 0) > 0, { timeout: 5000 });
  await p.evaluate(() => flushLastView());
  out.written = await stored(p);
  await p.close();

  p = await page(browser, { seed: JSON.stringify(out.written), height: 420 });
  out.restored = await p.evaluate(() => ({
    tab: state.mode,
    q: document.getElementById("q").value,
    sort: document.getElementById("sort").value,
    page: state.pageIndex,
    overlayOpen: !document.getElementById("permit-modal").hidden,
    activeTabHighlighted: !!document.querySelector("#tab-general_contractors.active"),
    modeSelect: document.getElementById("mode-select") ? document.getElementById("mode-select").value : null,
  }));
  await p.waitForFunction(() => window.scrollY > 0, { timeout: 4000 }).catch(() => {});
  out.restoredScroll = await p.evaluate(() => Math.round(window.scrollY));
  await p.close();

  // ---- B: an explicit URL param wins over the stored value.
  p = await page(browser, {
    seed: JSON.stringify({ tab: "general_contractors", q: "STORED QUERY" }),
    query: "?mode=open_permits&q=URLQUERY",
  });
  out.urlWins = await p.evaluate(() => ({ tab: state.mode, q: document.getElementById("q").value }));
  await p.close();

  // ---- C: legacy bare string migrates rather than being dropped.
  p = await page(browser, { seed: "directory" });
  out.legacyMigrated = await p.evaluate(() => readLastView());
  await p.close();

  // ---- D: list.html restores its view through the object form.
  p = await page(browser, { url: "http://127.0.0.1:8791/list.html", seed: "directory" });
  out.listLegacyView = await p.evaluate(() => state.view);
  await p.close();
  p = await page(browser, { url: "http://127.0.0.1:8791/list.html", seed: JSON.stringify({ view: "directory", q: "x" }) });
  out.listObjectView = await p.evaluate(() => state.view);
  await p.close();

  // ---- E: two patches inside one debounce window must both survive.
  p = await page(browser);
  out.debounceMerge = await p.evaluate(async () => {
    localStorage.removeItem("chi_permit_last_view");
    saveLastView({ q: "first" });
    saveLastView({ page: 7 });
    flushLastView();
    return JSON.parse(localStorage.getItem("chi_permit_last_view"));
  });
  await p.close();

  const problems = [];
  const w = out.written || {};
  if (w.tab !== "general_contractors") problems.push(`written tab ${w.tab}`);
  if (w.q !== "CONTRACTOR 0") problems.push(`written q ${JSON.stringify(w.q)}`);
  if (w.page !== 1) problems.push(`written page ${w.page}`);
  if (!(w.scroll > 0)) problems.push(`written scroll ${w.scroll}`);
  const r = out.restored || {};
  if (r.tab !== w.tab) problems.push(`restored tab ${r.tab}`);
  if (r.q !== w.q) problems.push(`restored q ${JSON.stringify(r.q)}`);
  if (r.page !== w.page) problems.push(`restored page ${r.page}`);
  if (r.overlayOpen) problems.push("overlay was restored — it must not be");
  if (!r.activeTabHighlighted) problems.push("restored tab is not highlighted as active");
  if (r.modeSelect && r.modeSelect !== w.tab) problems.push(`mode select shows ${r.modeSelect}, not ${w.tab}`);
  if (!(out.restoredScroll > 0)) problems.push(`restored scroll ${out.restoredScroll}`);
  if (out.urlWins.tab !== "open_permits") problems.push(`?mode= lost to the stored tab (${out.urlWins.tab})`);
  if (out.urlWins.q !== "URLQUERY") problems.push(`?q= lost to the stored query (${out.urlWins.q})`);
  if (out.legacyMigrated.view !== "directory") problems.push(`legacy string did not migrate: ${JSON.stringify(out.legacyMigrated)}`);
  if (out.listLegacyView !== "directory") problems.push(`list.html lost the legacy view (${out.listLegacyView})`);
  if (out.listObjectView !== "directory") problems.push(`list.html lost the object view (${out.listObjectView})`);
  if (out.debounceMerge.q !== "first" || out.debounceMerge.page !== 7) {
    problems.push(`debounce dropped a patch: ${JSON.stringify(out.debounceMerge)}`);
  }

  console.log(problems.length ? "FAIL" : "PASS");
  console.log(JSON.stringify(out, null, 1));
  if (problems.length) console.log("PROBLEMS:\n" + problems.join("\n"));
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})();
