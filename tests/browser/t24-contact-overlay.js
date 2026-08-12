// Phase 3: chi_permit_last_view grows from a bare string into
// { view, tab, q, sort, page, scroll, selected } and is restored on load.
//  A. index.html round-trips tab + query + sort + page + selection + scroll
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
  const results = [];
  for (const url of ["http://127.0.0.1:8791/index.html", "http://127.0.0.1:8791/list.html"]) {
    for (const [vp, tag] of [[{ width: 390, height: 844 }, "mobile"], [{ width: 1280, height: 900 }, "desktop"]]) {
      const p = await browser.newPage({ viewport: vp });
      const errs = [];
      p.on("pageerror", e => errs.push(String(e).slice(0, 120)));
      await p.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
      await p.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 1, cached_at: "x" }) }));
      await p.route("**/api/contact/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ contact_name: "CONTRACTOR 000", matched_as: "CONTRACTOR 000", matched_category: "general_contractor", seeded_at: "2026-07-28T12:00:00.000Z", total_jobs: 9, license_matches: [], work_types: [], permit_types: [], contact_types: [] }) }));
      await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: Array.from({ length: 60 }, (_, i) => ({ permit_number: "P" + i, permit_status: "ACTIVE", issue_date: "2026-07-01", address: (i % 2 ? "NORTH" : "SOUTH") + " ST " + i, work_type: i % 2 ? "RENOVATION" : "NEW CONSTRUCTION", permit_type: "PERMIT - RENOVATION", reported_cost: 1000 * i, general_contractors: "CONTRACTOR 000", open_subs: "" })), row_count: 60 }) }));
      await p.route("**/api/profiles**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: CONTACTS, total: CONTACTS.length }) }));
      await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
      await p.goto(url, { waitUntil: "domcontentloaded" });
      await p.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });
      await p.evaluate(() => { state.mode = "general_contractors"; return search(); });
      await p.waitForFunction(() => state.filteredRows.length > 0);

      // A contractor row must open the SAME overlay a permit row opens.
      await p.evaluate(() => document.querySelector(".contacts-table tbody tr").click());
      await p.waitForFunction(() => (activeCard() || {}).loaded, { timeout: 15000 });
      const opened = await p.evaluate(() => ({
        overlayOpen: !document.getElementById("permit-modal").hidden,
        title: document.getElementById("permit-modal-title").textContent,
        hasFilters: !!document.querySelector(".pm-filters"),
        hasPager: !!document.querySelector(".pm-pager"),
        rows: document.querySelectorAll(".pm-tablewrap tbody tr").length,
        inputPx: parseFloat(getComputedStyle(document.getElementById("card-q")).fontSize),
        inputH: document.getElementById("card-q").offsetHeight,
        noPane: !document.getElementById("detail-panel"),
        noHScroll: (b => b.scrollWidth <= b.clientWidth)(document.querySelector(".permit-modal-body")),
      }));

      // Typing must not lose focus or caret, and must not push history.
      const histBefore = await p.evaluate(() => history.length);
      await p.focus("#card-q");
      await p.keyboard.type("NORTH");
      await p.waitForFunction(() => (activeCard().filters || {}).q === "NORTH", { timeout: 5000 });
      const typed = await p.evaluate(() => ({
        focusKept: document.activeElement.id === "card-q",
        value: document.getElementById("card-q").value,
        caret: document.getElementById("card-q").selectionStart,
        rows: document.querySelectorAll(".pm-tablewrap tbody tr").length,
        matched: cardFilteredPermits(activeCard()).length,
        cardIndex: state.cardIndex,
      }));
      const histAfter = await p.evaluate(() => history.length);

      // Paging stays inside the card.
      const paged = await p.evaluate(() => { document.getElementById("card-q").value = ""; setCardFilter("q", ""); changeCardPage(1); return { page: activeCard().page, cardIndex: state.cardIndex }; });

      results.push([`${url.split("/").pop()} ${tag}`, { opened, typed, histDelta: histAfter - histBefore, paged, errs }]);
      await p.close();
    }
  }
  const problems = [];
  for (const [key, r] of results) {
    if (r.errs.length) problems.push(`${key}: page errors ${r.errs.join(" | ")}`);
    if (!r.opened.overlayOpen) problems.push(`${key}: row did not open the overlay`);
    if (r.opened.title !== "CONTRACTOR 000") problems.push(`${key}: title ${r.opened.title}`);
    if (!r.opened.hasFilters) problems.push(`${key}: filters missing`);
    if (!r.opened.hasPager) problems.push(`${key}: pager missing (60 permits, 25/page)`);
    if (r.opened.rows !== 25) problems.push(`${key}: ${r.opened.rows} rows, expected 25`);
    if (r.opened.inputPx < 16) problems.push(`${key}: filter input ${r.opened.inputPx}px < 16 (iOS zooms)`);
    if (r.opened.inputH < 44) problems.push(`${key}: filter input ${r.opened.inputH}px tall < 44`);
    if (!r.opened.noPane) problems.push(`${key}: #detail-panel still in the DOM`);
    if (!r.opened.noHScroll) problems.push(`${key}: card scrolls horizontally`);
    if (!r.typed.focusKept) problems.push(`${key}: focus lost while typing in the filter`);
    if (r.typed.value !== "NORTH") problems.push(`${key}: filter value ${r.typed.value}`);
    if (r.typed.caret !== 5) problems.push(`${key}: caret at ${r.typed.caret}, expected 5`);
    if (r.typed.matched !== 30) problems.push(`${key}: filter matched ${r.typed.matched}, expected 30 of 60`);
    if (r.typed.cardIndex !== 0) problems.push(`${key}: filtering changed cardIndex to ${r.typed.cardIndex}`);
    if (r.histDelta !== 0) problems.push(`${key}: filtering pushed ${r.histDelta} history entries`);
    if (r.paged.page !== 1) problems.push(`${key}: paging did not advance`);
    if (r.paged.cardIndex !== 0) problems.push(`${key}: paging changed cardIndex`);
  }
  console.log(problems.length ? "FAIL" : "PASS");
  console.log(JSON.stringify(results, null, 1));
  if (problems.length) console.log("PROBLEMS:" + String.fromCharCode(10) + problems.join(String.fromCharCode(10)));
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})();
