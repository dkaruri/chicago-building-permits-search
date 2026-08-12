// FIX-042 — a hand-typed "+ Add address" stop cannot be removed, and Clear list
// leaves it behind.
//
// Custom stops live in `list.custom`, NOT in `state.userPermitNumbers`, and
// customToRow deliberately sets `permit_number: ""` (never fabricate a permit
// number). The row template calls removePermitFromUserList(row.permit_number)
// for every row, so a custom stop's X calls it with "" — a no-op.
// removeCustomStop() exists and has ZERO call sites.
//
// Control cases prove real permits — including anything reached through map
// search, which only ever yields real permit numbers — still remove normally.
const { devices } = require("playwright");
const { chromium, CHROME, openList, seedSavedList } = require("./_boot.js");

const ROWS = [1, 2].map(i => ({
  permit_number: `10000${i}`, permit_type: "PERMIT - RENOVATION", permit_status: "ACTIVE",
  issue_date: `2026-01-0${i}`, address: `${i}00 W TEST ST`, ward: "1",
  reported_cost: 1000 * i, work_type: "RENOVATION", latitude: 41.9, longitude: -87.7
}));

// Exactly the shape addCustomStop() builds.
const CUSTOM = { id: "c_test1", pos: 2, addr: "999 N HAND TYPED AVE", lat: 41.91, lon: -87.71, use: "residential", work: "siding", gc: "" };

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

const customIds = page => page.evaluate(() => (activeList()?.custom || []).map(c => c.id));
const addresses = page => page.evaluate(() =>
  Array.from(document.querySelectorAll('.saved-permits-table tbody tr td[data-label="Address"]'))
    .map(n => n.textContent.trim().split("\n")[0]));

// Seeds permits AND the custom stop in one shot. _boot's seedSavedList waits on
// a rendered row, which a custom-only list has none of until custom lands — so
// the two-step version times out on exactly the case being tested.
async function seed(page, opts = {}) {
  await page.evaluate(async ({ rows, c }) => {
    state.userPermitMap = new Map(rows.map(r => [r.permit_number, r]));
    state.lists = { L: { name: "Test", permits: rows.map(r => r.permit_number), focal: null, sharedId: null, custom: [JSON.parse(JSON.stringify(c))] } };
    await showList("L");
  }, { rows: opts.permits === false ? [] : ROWS, c: CUSTOM });
  await page.waitForSelector(".saved-permits-table tbody tr", { timeout: 15000 });
  await page.waitForTimeout(200);
}

async function run(label, ctxOpts) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on("dialog", d => d.accept()); // Clear list still confirms, by design.

  await openList(page);
  await seed(page);

  const rowIndex = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".saved-permits-table tbody tr"))
      .findIndex(tr => tr.textContent.includes("HAND TYPED")));
  check("the hand-typed stop renders in the list", rowIndex >= 0, `row ${rowIndex}`);

  // --- 1. its X actually removes it ---------------------------------------
  await page.locator(`.saved-permits-table tbody tr:nth-child(${rowIndex + 1}) td[data-label="Remove"] button`).click();
  await page.waitForTimeout(500);
  check("X removes the hand-typed stop from list.custom",
    (await customIds(page)).length === 0, JSON.stringify(await customIds(page)));
  check("X removes the hand-typed stop from the table",
    !(await addresses(page)).some(a => a.includes("HAND TYPED")), (await addresses(page)).join(" | "));
  check("removing the hand-typed stop leaves the real permits alone",
    (await page.evaluate(() => state.userPermitNumbers.slice())).join(",") === "100001,100002");

  // --- 2. undo restores it, at its position --------------------------------
  const undo = page.locator("#list-action-status button.linkish");
  check("an Undo is offered for the hand-typed stop", await undo.count() === 1);
  if (await undo.count()) {
    await undo.click();
    await page.waitForTimeout(500);
    check("Undo restores the hand-typed stop", (await customIds(page)).join(",") === "c_test1");
    const back = await addresses(page);
    check("Undo restores it at its original position (pos 2 = 2nd row)",
      back[1] && back[1].includes("HAND TYPED"), back.join(" | "));
  }

  // --- 3. Clear list takes it too ------------------------------------------
  await page.evaluate(() => clearUserList());
  await page.waitForTimeout(600);
  check("Clear list empties list.custom", (await customIds(page)).length === 0,
    JSON.stringify(await customIds(page)));
  check("Clear list empties the permits too",
    (await page.evaluate(() => state.userPermitNumbers.length)) === 0);
  check("Clear list leaves no rows rendered",
    (await page.evaluate(() => document.querySelectorAll(".saved-permits-table tbody tr").length)) === 0);

  // --- 4. a list of ONLY hand-typed stops can still be cleared -------------
  await seed(page, { permits: false });
  check("a custom-only list renders its stop", (await customIds(page)).length === 1);
  await page.evaluate(() => clearUserList());
  await page.waitForTimeout(600);
  check("Clear list works on a list holding only hand-typed stops",
    (await customIds(page)).length === 0, JSON.stringify(await customIds(page)));

  // --- 4b. the arrows are no longer blocked (FIX-043) ----------------------
  // This section used to assert the OPPOSITE: FIX-042 could not reorder a
  // hand-typed stop, so it gave the arrows an aria-disabled explanation rather
  // than let them pretend to work. FIX-043 made them really work, so the
  // explanation is gone and what is left here is a guard against the fallback
  // creeping back. The reordering itself is t81-move-custom-stop.js.
  await seed(page);
  const cRow = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".saved-permits-table tbody tr"))
      .findIndex(tr => tr.textContent.includes("HAND TYPED")));
  const arrow = page.locator(`.saved-permits-table tbody tr:nth-child(${cRow + 1}) td.move-cell button`).first();
  check("the hand-typed stop's move arrow is NOT aria-disabled any more",
    await arrow.getAttribute("aria-disabled") === null,
    String(await arrow.getAttribute("aria-disabled")));
  check("the removed 'remove it and add it again' message is gone from the page",
    !/keeps the stop number it was typed with/.test(await page.content()));
  // CONTROL: a real permit's arrow still moves it — one VISIBLE place, which
  // over a hand-typed stop is a pos change and not a permit reorder.
  await page.locator('.saved-permits-table tbody tr:nth-child(3) td.move-cell button').first().click();
  await page.waitForTimeout(400);
  check("CONTROL: a real permit's arrow still moves it one place",
    (await addresses(page)).map(a => a.includes("HAND TYPED") ? "X" : a.slice(0, 1)).join(",") === "1,2,X",
    (await addresses(page)).join(" | "));

  // --- 5. CONTROL: a real permit (the map-search / directory path) ----------
  await seed(page);
  await page.locator('.saved-permits-table tbody tr:nth-child(1) td[data-label="Remove"] button').click();
  await page.waitForTimeout(500);
  check("CONTROL: a real permit still removes",
    (await page.evaluate(() => state.userPermitNumbers.slice())).join(",") === "100002");
  check("CONTROL: removing a real permit leaves the hand-typed stop",
    (await customIds(page)).join(",") === "c_test1");

  await page.screenshot({ path: `verify-tmp/t66-${label}.png` });
  await browser.close();
}

(async () => {
  await run("desktop", {});
  await run("iPhone13", { ...devices["iPhone 13"] });
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
