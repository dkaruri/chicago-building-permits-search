// t19: "Add all N to list" on a contractor card goes through the list picker.
// Two cases per page: pick a NON-active list (permits land there, not in the
// active one) and cancel (nothing is added, no false announcement).
// Fails against the pre-fix code, which passed { listId: state.activeListId }
// and so never opened the picker at all.
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const PAGES = ["http://127.0.0.1:8791/index.html", "http://127.0.0.1:8791/list.html"];
const ROW = { permit_number: "100923847", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", address: "4 N AVE", work_type: "RENOVATION", work_description: "Interior", reported_cost: 120000, total_fee: 900, general_contractors: "ACME BUILDERS | J. RIVERA", open_subs: "", latitude: 41.9, longitude: -87.7 };
const OTHER = { ...ROW, permit_number: "100923901", address: "22 W ST" };

async function openCard(browser, url) {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p.route("**/api/contact/**", r => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Contact not found" }) }));
  await p.route("**/api/contact/ACME%20BUILDERS**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ contact_name: "ACME BUILDERS", open_jobs: 2, total_jobs: 88, avg_processing_days: 9.4, reported_cost_total: 4200000, license_matches: [], work_types: [], permit_types: [], contact_types: [] }) }));
  await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [ROW, OTHER], row_count: 2 }) }));
  await p.route("**/api/notes/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [] }) }));
  await p.route("**/api/lists**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ lists: [] }) }));
  await p.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 0, cached_at: "2026-07-28" }) }));
  await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await p.goto(url, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  // init() is async and loads the saved lists AFTER an awaited fetch, so seeding
  // state.lists any earlier gets silently overwritten. list.html flags
  // body[data-ready]; index.html has no such flag, but renderStatus() runs on
  // the line after the lists load, so a populated #status is the same signal.
  await p.waitForFunction(() => document.body.dataset.ready === "1" ||
    (document.getElementById("status") || { children: [] }).children.length > 0);
  await p.evaluate(() => {
    state.lists = {
      la: { name: "List A", permits: [], focal: null, sharedId: null },
      lb: { name: "List B", permits: [], focal: null, sharedId: null },
    };
    state.activeListId = "la";
    state.userPermitNumbers = [];
  });
  await p.evaluate(row => openPermitDetail(row), ROW);
  await p.waitForSelector('.contractor-line[data-filled]');
  await p.evaluate(() => document.querySelector('.contractor-line[data-contractor="ACME BUILDERS"] .ci-more').click());
  await p.waitForFunction(() => state.cardIndex === 1 && (activeCard() || {}).loaded);
  return p;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const results = [];
  for (const url of PAGES) {
    // Case 1: pick List B while List A is active.
    let p = await openCard(browser, url);
    await p.evaluate(() => document.querySelector('.pm-actions .pm-act:not(.primary)').click());
    await p.waitForFunction(() => document.getElementById("list-picker").open);
    const picker = await p.evaluate(() => ({
      heading: document.querySelector("#list-picker h3").textContent,
      rows: [...document.querySelectorAll("#list-picker .pickrow")].map(b => b.value),
      // the <dialog> top layer must sit above the permit modal
      topmost: document.elementFromPoint(195, Math.round(document.getElementById("list-picker").getBoundingClientRect().top + 10)) !== null,
    }));
    await p.evaluate(() => [...document.querySelectorAll('#list-picker .pickrow')].find(b => b.value === "lb").click());
    await p.waitForFunction(() => !document.getElementById("list-picker").open);
    await p.waitForFunction(() => (state.lists.lb.permits || []).length === 2);
    const picked = await p.evaluate(() => ({
      a: state.lists.la.permits.length,
      b: state.lists.lb.permits.length,
      active: state.activeListId,
    }));
    await p.close();

    // Case 2: cancel the picker.
    p = await openCard(browser, url);
    await p.evaluate(() => document.querySelector('.pm-actions .pm-act:not(.primary)').click());
    await p.waitForFunction(() => document.getElementById("list-picker").open);
    await p.evaluate(() => document.querySelector('#list-picker .pickfoot button').click());
    await p.waitForFunction(() => !document.getElementById("list-picker").open);
    const cancelled = await p.evaluate(() => ({
      a: state.lists.la.permits.length,
      b: state.lists.lb.permits.length,
      active: state.activeListId,
      announce: (document.getElementById("pm-live") || {}).textContent || "",
      btnLabel: document.querySelector('.pm-actions .pm-act:not(.primary)').textContent,
      btnEnabled: !document.querySelector('.pm-actions .pm-act:not(.primary)').disabled,
    }));
    await p.close();

    results.push([url, { picker, picked, cancelled }]);
  }

  const ok = results.every(([, r]) =>
    /2 permits/.test(r.picker.heading) &&
    r.picker.rows.includes("la") && r.picker.rows.includes("lb") &&
    r.picker.topmost &&
    r.picked.a === 0 && r.picked.b === 2 && r.picked.active === "lb" &&
    r.cancelled.a === 0 && r.cancelled.b === 0 && r.cancelled.active === "la" &&
    !/added to your list/.test(r.cancelled.announce) &&
    r.cancelled.btnEnabled && /Add all/.test(r.cancelled.btnLabel));

  console.log(ok ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
