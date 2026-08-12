// FEAT-044 phase 2 — the open-permits directory pages the whole result set
// instead of a 1,000-row prefix of it.
//
// The Worker is mocked so paging is deterministic and offline: it emulates the
// real contract (total from the whole set, offset/limit, an allowlisted
// sort/dir echoed back, address refused). Every request it receives is
// recorded, so the tests can assert what the CLIENT asked for, not just what
// ended up on screen.
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot.js");

const TOTAL = 40868;          // matches production on 2026-08-07
const SORTABLE = ["permit_number", "permit_status", "issued", "cost"];

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

// A permit whose number encodes its absolute index, so a page's identity is
// visible in the DOM and two pages can be compared directly.
const permitAt = i => ({
  permit_number: `P${String(i).padStart(6, "0")}`,
  permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", review_type: "STANDARD",
  issue_date: "2026-01-01", processing_time: 5,
  address: `${i} W TEST ST`, work_type: "RENOVATION", work_description: "work",
  reported_cost: (TOTAL - i) * 10, total_fee: 100, ward: 1, community_area: 1,
  latitude: 41.9, longitude: -87.7, general_contractors: "ACME", open_subs: "", contacts: []
});

async function open(page, { requests, delayFor } = {}) {
  await page.route("**/api/stats*", r => r.fulfill({ json: { row_count: TOTAL, contractors: 5793, subs: 7432, exported: "2026-08-07" } }));
  await page.route("**/api/profiles*", r => {
    const u = new URL(r.request().url());
    const limit = parseInt(u.searchParams.get("limit") || "50");
    const total = 7432;
    const rows = Array.from({ length: Math.min(limit, total) }, (_, i) => ({
      contact_name: `CONTRACTOR ${String(i).padStart(5, "0")}`, open_jobs: i, city: "CHICAGO",
    }));
    r.fulfill({ json: { category: u.searchParams.get("category"), rows, total, offset: 0, limit } });
  });
  await page.route("**/api/permits*", async r => {
    const u = new URL(r.request().url());
    const offset = parseInt(u.searchParams.get("offset") || "0");
    const limit = parseInt(u.searchParams.get("limit") || "200");
    const sort = u.searchParams.get("sort") || "";
    const dir = u.searchParams.get("dir") === "asc" ? "asc" : "desc";
    const honoured = SORTABLE.includes(sort);
    if (requests) requests.push({ offset, limit, sort, dir, usable: u.searchParams.get("usable_processing") });
    // Let a test hold one response back to prove the token guard.
    if (delayFor && delayFor.offset === offset) await new Promise(res => setTimeout(res, delayFor.ms));
    const rows = Array.from({ length: Math.max(0, Math.min(limit, TOTAL - offset)) },
      (_, i) => permitAt(offset + i));
    r.fulfill({ json: { rows, row_count: rows.length, total: TOTAL, offset, limit,
                        sort: honoured ? sort : "", dir: honoured ? dir : "desc" } });
  });
  await page.goto("http://localhost:8791/index.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });
  await page.evaluate(async () => { setMode("open_permits"); await search(); });
  await page.waitForSelector(".permits-table tbody tr", { timeout: 15000 });
}

const shown = page => page.evaluate(() =>
  Array.from(document.querySelectorAll(".permits-table tbody tr td[data-label='Permit'] strong")).map(n => n.textContent.trim()));
const pagerText = page => page.locator("#pager").textContent();
const countText = page => page.locator("#result-count").textContent();

async function run(label, ctxOpts) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const requests = [];
  await open(page, { requests });

  // --- 1. the pager counts the whole result set --------------------------
  const expectedPages = Math.ceil(TOTAL / 150);
  check("the pager's denominator is the full result set, not the prefix",
    (await pagerText(page)).includes(`of ${expectedPages.toLocaleString("en-US")}`),
    (await pagerText(page)).replace(/\s+/g, " ").trim());
  check("the count label reports the full total",
    /1-150 of 40,868 shown/.test(await countText(page)), (await countText(page)).trim());
  check("the first request asked for one page, not 1000",
    requests[0] && requests[0].limit === 150 && requests[0].offset === 0, JSON.stringify(requests[0]));

  // --- 2. Next actually advances ------------------------------------------
  const page1 = await shown(page);
  await page.evaluate(() => changePage(1));
  await page.waitForFunction(() => !document.querySelector(".permits-table tbody tr td[data-label='Permit'] strong")?.textContent.includes("P000000"), null, { timeout: 15000 });
  const page2 = await shown(page);
  check("Next renders a different set of permits",
    page1[0] !== page2[0] && !page2.some(p => page1.includes(p)), `${page1[0]} -> ${page2[0]}`);
  check("Next refetched at the right offset",
    requests.at(-1).offset === 150, JSON.stringify(requests.at(-1)));
  check("page 2 reports its own range",
    /151-300 of 40,868 shown/.test(await countText(page)), (await countText(page)).trim());

  // --- 3. sorting spans the dataset, not the page -------------------------
  await page.evaluate(() => setResultSort("cost"));
  await page.waitForTimeout(600);
  const sortReq = requests.at(-1);
  check("changing sort asks the SERVER to sort", sortReq.sort === "cost", JSON.stringify(sortReq));
  check("changing sort returns to page 0", sortReq.offset === 0, `offset ${sortReq.offset}`);
  check("the pager still spans the whole set after sorting",
    (await pagerText(page)).includes(`of ${expectedPages.toLocaleString("en-US")}`));

  // --- 4. Address is not offered as a sort --------------------------------
  const headers = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".permits-table thead th")).map(th => ({
      label: th.textContent.trim(), sortable: !!th.querySelector("button.sort-header") })));
  const address = headers.find(h => h.label.startsWith("Address"));
  const cost = headers.find(h => h.label.startsWith("Cost"));
  check("Address is NOT a sort control in permits mode", address && !address.sortable,
    JSON.stringify(headers.map(h => h.label + (h.sortable ? "*" : ""))));
  check("CONTROL: Cost still is a sort control", cost && cost.sortable);

  // --- 5. the processing filter goes to the server ------------------------
  const before = requests.length;
  const hasToggle = await page.evaluate(() => {
    const el = document.getElementById("usable-processing");
    if (!el) return false;
    el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  });
  if (hasToggle) {
    await page.waitForTimeout(600);
    check("'usable processing only' is sent to the server",
      requests.length > before && requests.at(-1).usable === "1", JSON.stringify(requests.at(-1)));
  } else {
    console.log("SKIP  no #usable-processing toggle on this page");
  }

  await page.screenshot({ path: `verify-tmp/t67-${label}.png` });
  await browser.close();
}

// A slow page-2 response must not overwrite a newer page-1 render.
async function raceTest() {
  console.log("\n=== stale-response guard ===");
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext()).newPage();
  await open(page, { delayFor: { offset: 150, ms: 2500 } });
  const first = (await shown(page))[0];
  page.evaluate(() => changePage(1));          // slow, lands last
  await page.waitForTimeout(300);
  await page.evaluate(async () => { await search(); }); // newer, lands first
  await page.waitForTimeout(3500);
  const finalRows = await shown(page);
  check("a slow page-2 response cannot overwrite a newer page-1",
    finalRows[0] === first, `${first} -> ${finalRows[0]}`);
  check("the pager agrees with the rows on screen",
    /1-150 of/.test(await countText(page)), (await countText(page)).trim());
  await browser.close();
}

(async () => {
  await run("desktop", {});
  await run("iPhone13", { ...devices["iPhone 13"] });
  await raceTest();
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
