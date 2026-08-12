// t59 — FEAT-035: 1000-permit cap, 100-per-page pagination, and page memory.
//
// The unit suite (verify-tmp/feat035-pagination.mjs) covers the arithmetic. This
// covers what only a browser can answer: that a page renders 100 rows and not
// 250, that the stop ordinals keep counting across pages, that the page survives
// opening a permit and reloading, that exports and Optimize route still see the
// WHOLE list, and that the controls are usable at 390px.
//
// Runs at desktop AND iPhone 13 (devices), and asserts geometry, not presence.

const { devices } = require("playwright");
const { chromium, CHROME, openList, seedSavedList } = require("./_boot.js");

const BASE = "http://localhost:8791";
let failures = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
};

// 250 rows: three pages at 100/page, so "page 3 is a partial page" is covered.
const rows = n => Array.from({ length: n }, (_, i) => ({
  permit_number: `10${String(100000 + i)}`,
  permit_type: "PERMIT - RENOVATION/ALTERATION",
  permit_status: "ACTIVE",
  issue_date: "2026-01-15",
  address: `${1000 + i} W Fullerton Ave`,
  work_type: "RENOVATION",
  ward: "32",
  reported_cost: 125000,
  latitude: 41.9 + i * 0.001,
  longitude: -87.65 - i * 0.001,
}));

async function run(label, contextOpts, mobile) {
  console.log(`\n### ${label}`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  // Note counts are fetched for the visible page; stub so the URL length and
  // the request itself are deterministic.
  await page.route("**/api/notes/counts**", r => r.fulfill({ json: { counts: {} } }));
  // Saved permits rehydrate from Socrata on load — stub it, or after a reload
  // the list is a set of permit numbers with no rows and every page is empty
  // for reasons that have nothing to do with pagination.
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({
    json: rows(250).map(x => ({
      permit_: x.permit_number, permit_status: x.permit_status, permit_type: x.permit_type,
      issue_date: x.issue_date, street_number: String(1000 + Number(x.permit_number.slice(-3))),
      street_direction: "W", street_name: "FULLERTON AVE", work_type: x.work_type,
      work_description: "RENOVATION", reported_cost: String(x.reported_cost), ward: x.ward,
      latitude: String(x.latitude), longitude: String(x.longitude),
    })),
  }));
  await openList(page);
  await seedSavedList(page, rows(250));

  // ---- Paging the view ----
  const firstPage = await page.$$eval(".saved-permits-table tbody tr", tr => tr.length);
  ok("page 1 renders exactly 100 rows of a 250-row list", firstPage === 100, `got ${firstPage}`);

  const counted = await page.evaluate(() => state.userPermitNumbers.length);
  ok("the whole list is still in state, not truncated to a page", counted === 250, `got ${counted}`);

  const pagerCount = await page.$$eval("#user-list-pager-top, #user-list-pager", n => n.filter(x => x.innerHTML.trim()).length);
  ok("a pager is rendered above AND below the table", pagerCount === 2, `got ${pagerCount}`);

  const status = await page.textContent("#user-list-pager-top .small");
  ok("the pager states the page and the range", /Page 1 of 3/.test(status) && /1.*100.*of.*250/.test(status), JSON.stringify(status));

  // Ordinals are route stop numbers — they must keep counting across pages.
  const firstOrd = await page.$eval(".saved-permits-table tbody tr .list-ordinal", e => e.textContent.trim());
  ok("page 1 starts at stop 1", firstOrd === "1", firstOrd);

  await page.evaluate(() => setListPage(1));
  await page.waitForFunction(() => document.querySelector(".saved-permits-table tbody tr .list-ordinal")?.textContent.trim() === "101", null, { timeout: 5000 }).catch(() => {});
  const p2Ord = await page.$eval(".saved-permits-table tbody tr .list-ordinal", e => e.textContent.trim());
  ok("page 2 continues the stop numbers at 101, it does not restart at 1", p2Ord === "101", p2Ord);

  const p3 = await page.evaluate(async () => { await setListPage(2); return document.querySelectorAll(".saved-permits-table tbody tr").length; });
  ok("the last page renders only its remainder (50 rows)", p3 === 50, `got ${p3}`);

  // The move-up control on the first row of page 2 must be live: that row is
  // row 101 of the list and can move up into page 1.
  await page.evaluate(() => setListPage(1));
  const upDisabled = await page.$eval(".saved-permits-table tbody tr .move-controls button", b => b.disabled);
  ok("move-up is enabled on the first row of page 2 (it is row 101, not row 1)", upDisabled === false);

  await page.evaluate(() => setListPage(0));
  const upDisabled1 = await page.$eval(".saved-permits-table tbody tr .move-controls button", b => b.disabled);
  ok("move-up is still disabled on the true first row of the list", upDisabled1 === true);

  // ---- Full-scope invariants: pagination must not narrow anything ----
  const scope = await page.evaluate(() => ({
    listRows: userListRows().length,
    routable: routeRows().length,
    exportRows: mapExportRows().length,
    rendered: document.querySelectorAll(".saved-permits-table tbody tr").length,
  }));
  ok("Optimize route sees all 250 stops, not the visible 100", scope.routable === 250, JSON.stringify(scope));
  ok("exports see all 250 stops, not the visible 100", scope.exportRows === 250, JSON.stringify(scope));
  ok("...while the table itself is still showing one page", scope.rendered === 100, JSON.stringify(scope));

  // ---- Page memory across the permit overlay ----
  await page.evaluate(() => setListPage(1));
  await page.evaluate(() => {
    const row = document.querySelector(".saved-permits-table tbody tr");
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForSelector("#permit-modal:not([hidden])", { timeout: 5000 });
  await page.evaluate(() => closePermitModal());
  // waitForSelector("[hidden]") waits for VISIBILITY and can never match a
  // hidden element; ask for the property instead.
  await page.waitForFunction(() => document.getElementById("permit-modal").hidden, null, { timeout: 5000 });
  const afterOverlay = await page.evaluate(() => state.listPage);
  ok("opening a permit and coming back keeps you on page 2", afterOverlay === 1, `listPage=${afterOverlay}`);

  // ---- Page memory across a reload ----
  await page.evaluate(() => setListPage(2));
  await page.evaluate(() => flushLastView());
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("chi_permit_last_view") || "{}"));
  ok("the page is persisted under its own key, not the search pager's", stored.listPage === 2 && stored.listId === "L", JSON.stringify(stored));
  ok("...and the search pager's own key is left alone", !("page" in stored) || stored.page === 0, JSON.stringify(stored));

  // The real reload. Everything above only proves the page was WRITTEN; this is
  // the half that reads it back, and a mutant that never restores survived until
  // this was added.
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });
  await page.waitForSelector(".saved-permits-table tbody tr", { timeout: 15000 });
  const reloaded = await page.evaluate(() => ({
    page: state.listPage,
    firstOrdinal: document.querySelector(".saved-permits-table tbody tr .list-ordinal")?.textContent.trim(),
    rows: document.querySelectorAll(".saved-permits-table tbody tr").length,
  }));
  ok("a reload comes back to the same page", reloaded.page === 2, JSON.stringify(reloaded));
  ok("...and that page really is the third one, not just the number", reloaded.firstOrdinal === "201", JSON.stringify(reloaded));

  // A page remembered for one list must not be applied to a different one.
  const crossed = await page.evaluate(async () => {
    state.lists.OTHER = { name: "Other", permits: state.lists.L.permits.slice(0, 120), focal: null, sharedId: null };
    await showList("OTHER");
    return state.listPage;
  });
  ok("opening a DIFFERENT list starts at page 1, not the last list's page", crossed === 0, `listPage=${crossed}`);

  // ---- The cap ----
  const cap = await page.evaluate(async () => {
    const extra = Array.from({ length: 900 }, (_, i) => ({ permit_number: `99${String(100000 + i)}`, address: "x", permit_type: "P" }));
    extra.forEach(r => state.userPermitMap.set(r.permit_number, r));
    await addPermitsToUserList(extra, { listId: "L" });
    return { total: state.userPermitNumbers.length, msg: document.getElementById("list-action-status").textContent };
  });
  ok("adding past the cap stops at exactly 1000", cap.total === 1000, `got ${cap.total}`);
  ok("...and says how many were skipped", /could not be added/.test(cap.msg) && /1,?000/.test(cap.msg), JSON.stringify(cap.msg));

  const kept = await page.evaluate(() => state.userPermitNumbers.filter(n => n.startsWith("10")).length);
  ok("the permits already saved are NOT dropped to make room", kept === 250, `${kept} of the original 250 survived`);

  // The bulk "Add all N" on a contact card makes its own announcement, so the
  // add has to tell it what actually happened or it restates the request.
  const reported = await page.evaluate(async () => {
    const more = Array.from({ length: 5 }, (_, i) => ({ permit_number: `88${String(100000 + i)}`, address: "y", permit_type: "P" }));
    more.forEach(r => state.userPermitMap.set(r.permit_number, r));
    return await addPermitsToUserList(more, { listId: "L" });
  });
  ok("a full list reports 0 added and all of them skipped", reported && reported.added === 0 && reported.skipped === 5, JSON.stringify(reported));

  // ---- Geometry: the controls must be usable ----
  await page.evaluate(() => setListPage(0));
  // Layout animations must settle or every rect below is measured mid-flight.
  await page.waitForFunction(() => [...document.querySelectorAll("*")].every(e => e.getAnimations().every(a => a.playState !== "running")), null, { timeout: 5000 }).catch(() => {});

  const geom = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#user-list-pager-top button")];
    return {
      n: btns.length,
      small: btns.filter(b => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(b => { const r = b.getBoundingClientRect(); return `${b.textContent.trim()}:${Math.round(r.width)}x${Math.round(r.height)}`; }),
      offscreen: btns.filter(b => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 0.5; })
        .map(b => b.textContent.trim()),
      unlabelled: btns.filter(b => !b.getAttribute("aria-label") && !b.textContent.trim()).length,
      current: document.querySelectorAll('#user-list-pager-top [aria-current="page"]').length,
      docWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
    };
  });
  ok("every pager control is at least 44x44", geom.small.length === 0, geom.small.join(", "));
  ok("no pager control sits outside the viewport", geom.offscreen.length === 0, geom.offscreen.join(", "));
  ok("every pager control is named", geom.unlabelled === 0);
  ok("exactly one control carries aria-current=page", geom.current === 1, `got ${geom.current}`);
  ok("the pager introduces no sideways scroll", geom.docWidth <= geom.viewport + 1, `${geom.docWidth} > ${geom.viewport}`);

  // The current page must not be signalled by colour alone.
  const weight = await page.evaluate(() => {
    const cur = document.querySelector('#user-list-pager-top [aria-current="page"]');
    const other = [...document.querySelectorAll("#user-list-pager-top .pager-page")].find(b => b !== cur);
    return { cur: getComputedStyle(cur).fontWeight, other: other ? getComputedStyle(other).fontWeight : null };
  });
  ok("the current page differs by weight, not only colour", weight.cur !== weight.other, JSON.stringify(weight));

  await page.screenshot({ path: `verify-tmp/t59-${mobile ? "mobile" : "desktop"}.png`, fullPage: false });

  await browser.close();
}

(async () => {
  await run("desktop 1280x800", { viewport: { width: 1280, height: 800 } }, false);
  await run("iPhone 13", { ...devices["iPhone 13"] }, true);
  console.log(failures ? `\n${failures} FAILURES` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
