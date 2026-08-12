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
  const url = "http://127.0.0.1:8791/index.html";

  const openCardPage = async seed => {
    const p = await page(browser, seed ? { seed } : {});
    return p;
  };

  // 1. Open a contractor card, leave, and it comes back.
  let p = await openCardPage();
  await p.evaluate(() => { state.mode = "general_contractors"; return search(); });
  await p.waitForFunction(() => document.querySelector(".contacts-table tbody tr"));
  await p.evaluate(() => document.querySelector(".contacts-table tbody tr").click());
  await p.waitForFunction(() => (activeCard() || {}).loaded, { timeout: 15000 });
  await p.evaluate(() => flushLastView());
  out.stored = await p.evaluate(() => JSON.parse(localStorage.getItem("chi_permit_last_view")).card);
  const seed = await p.evaluate(() => localStorage.getItem("chi_permit_last_view"));
  await p.close();

  p = await openCardPage(seed);
  await p.waitForFunction(() => !document.getElementById("permit-modal").hidden, { timeout: 15000 }).catch(() => {});
  out.restored = await p.evaluate(() => ({
    open: !document.getElementById("permit-modal").hidden,
    title: (document.getElementById("permit-modal-title") || {}).textContent || null,
    type: (activeCard() || {}).type || null,
    index: state.cardIndex,
  }));
  // Escape must close it cleanly, and it must not come back within the session.
  await p.keyboard.press("Escape");
  await p.waitForTimeout(200);
  await p.evaluate(() => flushLastView()); // the clear is debounced 400ms
  out.afterEscape = await p.evaluate(() => ({ open: !document.getElementById("permit-modal").hidden, stored: (JSON.parse(localStorage.getItem("chi_permit_last_view")) || {}).card }));
  await p.close();

  // 2. Closing the overlay clears the stored card.
  p = await openCardPage();
  await p.evaluate(() => { openPermitModal(); pushCard({ type: "contact", name: "CONTRACTOR 000", role: "general_contractor" }); });
  await p.waitForFunction(() => !document.getElementById("permit-modal").hidden);
  await p.evaluate(() => { closePermitModal(); flushLastView(); });
  out.clearedOnClose = await p.evaluate(() => (JSON.parse(localStorage.getItem("chi_permit_last_view")) || {}).card);
  await p.close();

  // 3. A PERMIT card is never restored.
  p = await openCardPage();
  await p.evaluate(() => { openPermitModal(); pushCard({ type: "permit", row: { permit_number: "P1", permit_status: "ACTIVE", address: "X", issue_date: "2026-07-01" } }); flushLastView(); });
  out.permitNotStored = await p.evaluate(() => (JSON.parse(localStorage.getItem("chi_permit_last_view")) || {}).card);
  await p.close();

  // 4. contact -> permit -> back leaves the CONTACT stored, not null.
  p = await openCardPage();
  await p.evaluate(() => { openPermitModal(); pushCard({ type: "contact", name: "CONTRACTOR 000", role: "general_contractor" }); });
  await p.waitForFunction(() => (activeCard() || {}).loaded, { timeout: 15000 });
  await p.evaluate(() => pushCard({ type: "permit", row: { permit_number: "P1", permit_status: "ACTIVE", address: "X", issue_date: "2026-07-01" } }));
  await p.evaluate(() => { popCard(); flushLastView(); });
  out.afterBack = await p.evaluate(() => (JSON.parse(localStorage.getItem("chi_permit_last_view")) || {}).card);
  await p.close();

  const problems = [];
  if (!out.stored || !out.stored.name) problems.push(`open card not stored: ${JSON.stringify(out.stored)}`);
  if (!out.restored.open) problems.push("card was not reopened on load");
  if (out.restored.type !== "contact") problems.push(`restored card type ${out.restored.type}`);
  if (out.restored.title !== out.stored.name) problems.push(`restored ${out.restored.title}, stored ${out.stored.name}`);
  if (out.restored.index !== 0) problems.push(`restored at stack index ${out.restored.index}, expected 0`);
  if (out.afterEscape.open) problems.push("Escape did not close the restored card");
  if (out.afterEscape.stored) problems.push("closing the restored card left it stored");
  if (out.clearedOnClose) problems.push(`closing the overlay left card stored: ${JSON.stringify(out.clearedOnClose)}`);
  if (out.permitNotStored) problems.push(`a permit card was stored: ${JSON.stringify(out.permitNotStored)}`);
  if (!out.afterBack || out.afterBack.name !== "CONTRACTOR 000") problems.push(`back to a contact card did not re-store it: ${JSON.stringify(out.afterBack)}`);

  console.log(problems.length ? "FAIL" : "PASS");
  console.log(JSON.stringify(out, null, 1));
  if (problems.length) console.log("PROBLEMS:" + String.fromCharCode(10) + problems.join(String.fromCharCode(10)));
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})();
