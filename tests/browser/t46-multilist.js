// t46 — FEAT-034 close-out: the feature across MULTIPLE lists, and the whole
// list view's touch targets on a phone.
// Feeds stay separate (t41 proves that for one switch); this proves the
// follow-up flags stay separate too, that the filter does not leak between
// lists, and that a flag survives leaving the list and coming back.
const { chromium, CHROME, openList } = require("./_boot");

const A = [
  { permit_number: "101082609", address: "3701 W AINSLIE ST", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", ward: "39", reported_cost: 120000, lat: 41.97, lon: -87.72,
    general_contractors: "BEAR CONSTRUCTION" },
  { permit_number: "B200461632", address: "1200 N STATE PKWY", permit_status: "ACTIVE", permit_type: "PERMIT - NEW CONSTRUCTION", issue_date: "2026-07-02", ward: "2", reported_cost: 900000, lat: 41.90, lon: -87.62,
    general_contractors: "SECOND GC" },
];
const B = [
  { permit_number: "100987654", address: "55 E MONROE ST", permit_status: "ACTIVE", permit_type: "PERMIT - EASY PERMIT", issue_date: "2026-07-03", ward: "42", reported_cost: 4000, lat: 41.88, lon: -87.62,
    general_contractors: "MONROE BUILDERS" },
  { permit_number: "100111222", address: "900 W FULTON MKT", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-04", ward: "27", reported_cost: 55000, lat: 41.88, lon: -87.65,
    general_contractors: "FULTON BUILD CO" },
];

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const permitsShown = page => page.$$eval(".saved-permits-table tbody tr",
  els => els.map(e => e.querySelector("strong").textContent.trim()));

async function run(viewport, label) {
  console.log(`\n== ${label} ==`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });
  await page.route("**/api/notes/bulk*", r => r.fulfill({ json: { threads: {}, truncated: false } }));
  await page.route("**/api/notes/counts*", r => r.fulfill({ json: { counts: {} } }));
  await page.route("**/api/contact/**", r => r.fulfill({ json: {} }));

  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));

  await openList(page);
  await page.evaluate(async ({ A, B }) => {
    state.userPermitMap = new Map([...A, ...B].map(r => [r.permit_number, r]));
    state.lists = {
      LA: { name: "North side", permits: A.map(r => r.permit_number), focal: null, sharedId: null },
      LB: { name: "West loop", permits: B.map(r => r.permit_number), focal: null, sharedId: null },
    };
    await showList("LA");
  }, { A, B });
  await page.waitForSelector(".saved-permits-table tbody tr", { timeout: 15000 });

  // ---- flag one permit in list A, and one in list B ----
  await page.evaluate(() => toggleFollowUp(encodeURIComponent("101082609"), true));
  await page.waitForTimeout(150);
  check("list A shows its one badge", (await page.$$(".fu-badge")).length === 1);

  await page.evaluate(async () => { await showList("LB"); });
  await page.waitForTimeout(250);
  check("switching lists shows the other list's permits",
    JSON.stringify(await permitsShown(page)) === JSON.stringify(["100987654", "100111222"]),
    JSON.stringify(await permitsShown(page)));
  check("list A's flag does not leak into list B", (await page.$$(".fu-badge")).length === 0);
  check("filter bar is hidden in a list with nothing flagged", await page.$eval("#list-filters", el => el.hidden));

  await page.evaluate(() => toggleFollowUp(encodeURIComponent("100111222"), true));
  await page.waitForTimeout(150);
  const bBadge = await page.$eval(".fu-badge", el => el.closest("tr").querySelector("strong").textContent.trim());
  check("list B flags its own permit", bBadge === "100111222", bBadge);

  // ---- the filter must not follow you between lists ----
  await page.click("#filter-followup");
  await page.waitForTimeout(150);
  check("filter narrows list B", (await permitsShown(page)).length === 1);
  await page.evaluate(async () => { await showList("LA"); });
  await page.waitForTimeout(250);
  check("the filter does not carry into the next list",
    await page.$eval("#filter-followup", el => el.getAttribute("aria-pressed")) === "false");
  check("list A comes back whole, not filtered", (await permitsShown(page)).length === 2);

  // ---- the flag survives leaving the list and coming back ----
  const aBadge = await page.$$eval(".fu-badge", els => els.map(e => e.closest("tr").querySelector("strong").textContent.trim()));
  check("list A's own flag survived the round trip", JSON.stringify(aBadge) === JSON.stringify(["101082609"]), JSON.stringify(aBadge));

  // ---- and a reload ----
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });
  await page.evaluate(async ({ A, B }) => {
    // The permit map is rebuilt from the network in real use; restore it here so
    // rows render, but DO NOT touch state.lists — the flags must come from what
    // was persisted, not from anything this test hands back.
    state.userPermitMap = new Map([...A, ...B].map(r => [r.permit_number, r]));
    await showList("LA");
  }, { A, B });
  await page.waitForSelector(".saved-permits-table tbody tr", { timeout: 15000 });
  const afterReload = await page.$$eval(".fu-badge", els => els.map(e => e.closest("tr").querySelector("strong").textContent.trim()));
  check("flags persist across a reload", JSON.stringify(afterReload) === JSON.stringify(["101082609"]), JSON.stringify(afterReload));
  const bAfter = await page.evaluate(async () => {
    await showList("LB");
    return Object.keys(state.lists.LB.fu || {});
  });
  check("the other list's flag persisted too and stayed its own", JSON.stringify(bAfter) === JSON.stringify(["100111222"]), JSON.stringify(bAfter));

  // ---- whole-view touch targets on the phone ----
  if (viewport.width < 500) {
    await page.evaluate(async () => { await showList("LA"); });
    await page.waitForTimeout(200);
    const small = await page.$$eval("#user-list-panel button:not([hidden]), #user-list-panel input:not([type=hidden])",
      els => els.filter(e => e.offsetParent !== null && !e.closest("[hidden]"))
        .map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, h: Math.round(r.height) }; })
        .filter(t => t.h > 0 && t.h < 44));
    check("every visible control in the list view is at least 44px tall on a phone",
      small.length === 0, JSON.stringify(small));
  }

  check("no page errors anywhere in the run", errs.length === 0, JSON.stringify(errs));
  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "desktop 1280x900");
  await run({ width: 390, height: 844 }, "iPhone 13 390x844");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
