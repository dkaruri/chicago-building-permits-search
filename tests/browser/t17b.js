// t17b: Finding-1 regression — an in-place refresh triggered by the real
// add-to-list path (addPermitFromEncoded -> addPermitsToUserList ->
// refreshCard) must NOT push a duplicate card or a stray history entry.
// Open a permit card, invoke the add-to-list action while it's open, then
// assert the stack is still depth 1 and one history.back() closes the
// overlay (not just steps back to the same card again).
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

    // Open the permit card.
    await p.evaluate(row => openPermitDetail(row), ROW);
    const afterOpen = await p.evaluate(() => ({ len: state.cardStack.length, i: state.cardIndex, title: document.getElementById("permit-modal-title").textContent }));

    // Drive the real add-to-list path: makeLocalList bypasses the <dialog>
    // picker (jsdom-free headless has no way to click it), but everything
    // downstream — addPermitsToUserList -> refreshCard -> renderCard — is
    // the real production code path Finding 1 was about.
    await p.evaluate(async row => {
      const listId = makeLocalList("Test list");
      await addPermitsToUserList([row], { listId });
    }, ROW);
    const afterAdd = await p.evaluate(() => ({ len: state.cardStack.length, i: state.cardIndex, title: document.getElementById("permit-modal-title").textContent, hidden: document.getElementById("permit-modal").hidden }));

    // One Back press should close the overlay outright — not re-show the
    // same permit from a duplicate stack entry.
    await p.goBack(); await p.waitForTimeout(150);
    const afterBack = await p.evaluate(() => ({ hidden: document.getElementById("permit-modal").hidden, len: state.cardStack.length }));

    results.push([url, { afterOpen, afterAdd, afterBack }]);
    await p.close();
  }

  const ok = results.every(([, r]) =>
    r.afterOpen.len === 1 && r.afterOpen.i === 0 &&
    r.afterAdd.len === 1 && r.afterAdd.i === 0 && r.afterAdd.hidden === false &&
    r.afterAdd.title === "100923847" &&
    r.afterBack.hidden === true && r.afterBack.len === 0);

  console.log(ok ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
