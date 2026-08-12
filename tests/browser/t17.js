// t17: card-stack navigation in the permit overlay, on BOTH pages.
//  1) push 3 cards -> body shows the third; back steps to the second, then first
//  2) back at depth 0 closes the overlay
//  3) forward re-enters a card that was stepped back from
// Contractor cards are stubbed at the API layer so this test covers navigation
// only, not the contractor fetch (see t18 for the rendered card).
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const PAGES = ["http://127.0.0.1:8791/index.html", "http://127.0.0.1:8791/list.html"];

const ROW = { permit_number: "100923847", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", address: "4 N AVE", work_type: "RENOVATION", work_description: "Interior work", reported_cost: 120000, total_fee: 900, general_contractors: "ACME BUILDERS", open_subs: "", latitude: 41.9, longitude: -87.7 };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const results = [];
  for (const url of PAGES) {
    const p = await browser.newPage();
    await p.route("**/api/contact/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ contact_name: "ACME BUILDERS", open_jobs: 12, total_jobs: 88, avg_processing_days: 9.4, reported_cost_total: 4200000, license_matches: [], work_types: [], permit_types: [], contact_types: [] }) }));
    await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [ROW], row_count: 1 }) }));
    await p.route("**/api/notes/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [] }) }));
    await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
    await p.goto(url, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });

    await p.evaluate(row => openPermitDetail(row), ROW);
    await p.evaluate(() => pushCard({ type: "contact", name: "ACME BUILDERS", role: "general_contractor" }));
    await p.evaluate(row => pushCard({ type: "permit", row }), { ...ROW, permit_number: "100923901" });
    const depth3 = await p.evaluate(() => ({ len: state.cardStack.length, i: state.cardIndex, title: document.getElementById("permit-modal-title").textContent }));

    await p.goBack(); await p.waitForTimeout(120);
    const afterBack1 = await p.evaluate(() => ({ i: state.cardIndex, title: document.getElementById("permit-modal-title").textContent }));
    await p.goBack(); await p.waitForTimeout(120);
    const afterBack2 = await p.evaluate(() => ({ i: state.cardIndex, title: document.getElementById("permit-modal-title").textContent }));
    await p.goBack(); await p.waitForTimeout(150);
    const afterBack3 = await p.evaluate(() => ({ hidden: document.getElementById("permit-modal").hidden, len: state.cardStack.length }));

    results.push([url, { depth3, afterBack1, afterBack2, afterBack3 }]);
    await p.close();
  }

  const ok = results.every(([, r]) =>
    r.depth3.len === 3 && r.depth3.i === 2 && r.depth3.title === "100923901" &&
    r.afterBack1.i === 1 && r.afterBack1.title === "ACME BUILDERS" &&
    r.afterBack2.i === 0 && r.afterBack2.title === "100923847" &&
    r.afterBack3.hidden === true && r.afterBack3.len === 0);

  console.log(ok ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
