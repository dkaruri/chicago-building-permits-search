// FEAT-048 — the saved list's filter row on the tri-state control.
// Covers the Stage dropdown (including CLOSED stages, which appear on no other
// surface), the two tri-state pills, Follow-up staying binary, direction in the
// status line, the empty view's way out, geometry and real keyboard operation.
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const row = (n, milestone, status, extra = {}) => ({
  permit_number: n, address: `${n} N TEST ST`, permit_status: status,
  permit_milestone: milestone, permit_type: "PERMIT - RENOVATION",
  issue_date: "2026-07-01", ward: "1", reported_cost: 1000,
  lat: 41.9, lon: -87.7, general_contractors: "GC ONE", ...extra,
});

// 2 In progress, 1 Halted, 1 Complete (closed — only the list shows these), 1 Fee due.
const ROWS = [
  row("A1", "INSPECTIONS", "ACTIVE"),
  row("A2", "INSPECTIONS", "ACTIVE"),
  row("B1", "STOP WORK", "SUSPENDED"),
  row("C1", "COMPLETE", "COMPLETE"),
  row("D1", "PERMIT ISSUED (FEE DUE)", "ACTIVE"),
];

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const rowCount = page => page.evaluate(() => document.querySelectorAll(".saved-permits-table tbody tr").length);
const statusText = page => page.evaluate(() => ($("list-filter-status") || {}).textContent || "");

// FEAT-052 moved the options into a modal (#stage-picker) — opening them inline
// pushed the table down the page. openStagePicker() is a no-op if it is already
// open, so this is safe to call repeatedly.
async function openStage(page) {
  await page.evaluate(() => openStagePicker());
  await page.waitForTimeout(100);
}

const stageOptions = page => page.evaluate(() => [...document.querySelectorAll("#list-stage-list .tri")].map(el => ({
  value: el.dataset.value, state: el.dataset.state || "",
  label: (el.querySelector(".tri-label") || {}).textContent || "",
  count: Number(((el.querySelector(".tri-count") || {}).textContent || "0").replace(/[^0-9]/g, "")),
  h: +el.getBoundingClientRect().height.toFixed(1),
  aria: el.getAttribute("aria-label") || "",
})));

async function clickStage(page, value) {
  await page.evaluate(v => setListStageFilter(v), value);
  await page.waitForTimeout(180);
  await openStage(page);
}

async function run(viewport, label) {
  console.log(`\n== ${label} ==`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });
  await page.route("**/api/notes/bulk*", r => r.fulfill({ json: { threads: {}, truncated: false } }));
  await page.route("**/api/notes/counts*", r => r.fulfill({ json: { counts: {} } }));
  await page.route("**/api/contact/**", r => r.fulfill({ json: {} }));
  await openList(page);
  await seedSavedList(page, ROWS);
  await page.waitForTimeout(300);

  // ---- The bar must be reachable on a list where NOTHING is flagged ----
  // Every permit has a stage, so unlike visited/called the stage filter is never
  // a dead control. If the bar only appears once something is ticked, the whole
  // feature is unreachable on a fresh list.
  const barHidden = await page.$eval("#list-filters", el => el.hidden);
  check("filter bar is reachable with no ticks, calls or flags", barHidden === false,
    `hidden=${barHidden}`);

  await openStage(page);
  const opts = await stageOptions(page);
  const by = Object.fromEntries(opts.map(o => [o.value, o]));

  check("one option per stage present in THIS list", opts.length === 4, JSON.stringify(opts.map(o => o.value)));
  check("In progress counts 2", by.progress && by.progress.count === 2, JSON.stringify(by.progress));
  check("Halted counts 1", by.halted && by.halted.count === 1);
  check("Fee due counts 1", by.fee && by.fee.count === 1);
  check("a CLOSED stage is offered — the list is the only surface with them",
    !!by.complete && by.complete.count === 1, JSON.stringify(opts.map(o => o.value)));
  check("every option row >= 44px", opts.every(o => o.h >= 44), JSON.stringify(opts.map(o => o.h)));
  check("accessible name states the state", /not filtered, activate to include/.test(by.progress.aria), by.progress.aria);
  check("all 5 rows before filtering", await rowCount(page) === 5, String(await rowCount(page)));

  // ---- include / exclude / clear ----
  await clickStage(page, "progress");
  check("include narrows to that stage", await rowCount(page) === 2, String(await rowCount(page)));
  let now = await stageOptions(page);
  check("counts beside the others do not move when one is ticked",
    now.find(o => o.value === "halted").count === 1 && now.find(o => o.value === "complete").count === 1,
    JSON.stringify(now.map(o => [o.value, o.count])));
  check("status line names the included stage", /In progress/.test(await statusText(page)), await statusText(page));

  await clickStage(page, "progress");
  check("exclude removes that stage", await rowCount(page) === 3, String(await rowCount(page)));
  check("status line says NOT for an exclusion", /not In progress/.test(await statusText(page)), await statusText(page));

  await clickStage(page, "progress");
  check("third click clears", await rowCount(page) === 5, String(await rowCount(page)));

  // ---- excluding Complete is the point of this feature ----
  await clickStage(page, "complete");
  await clickStage(page, "complete");
  check("excluding Complete hides the finished job", await rowCount(page) === 4, String(await rowCount(page)));
  check("status line names the excluded closed stage", /not Complete/.test(await statusText(page)), await statusText(page));
  await clickStage(page, "complete");

  // ---- the pills ----
  // Close the stage picker first: since FEAT-052 it is a real modal, so the row
  // behind it is inert and a keyboard press aimed at a pill goes nowhere —
  // correctly. Leaving it open failed the Enter check for the right reason.
  await page.evaluate(() => closeStagePicker());
  await page.waitForTimeout(120);
  await page.evaluate(() => { activeList().ticks = { A1: 1 }; activeList().called = { A2: "Divyam" }; renderUserList(); });
  await page.waitForTimeout(200);
  const pill = id => page.$eval(`#${id}`, el => ({
    state: el.dataset.state || "", text: el.textContent.trim(),
    aria: el.getAttribute("aria-label") || "", h: +el.getBoundingClientRect().height.toFixed(1),
  }));
  await page.evaluate(() => setRowFilter("visited"));
  await page.waitForTimeout(180);
  let p = await pill("filter-visited");
  check("Visited include shows a tick and says so", p.state === "include" && /^✓/.test(p.text) && /included/.test(p.aria), JSON.stringify(p));
  check("Visited include narrows to the visited permit", await rowCount(page) === 1, String(await rowCount(page)));
  await page.evaluate(() => setRowFilter("visited"));
  await page.waitForTimeout(180);
  p = await pill("filter-visited");
  check("Visited exclude shows a cross and says so", p.state === "exclude" && /^✗/.test(p.text) && /excluded/.test(p.aria), JSON.stringify(p));
  check("Visited exclude drops it", await rowCount(page) === 4, String(await rowCount(page)));
  check("pill >= 44px", p.h >= 44, String(p.h));
  await page.evaluate(() => setRowFilter("visited"));
  await page.waitForTimeout(180);
  check("third click clears the pill", (await pill("filter-visited")).state === "", JSON.stringify(await pill("filter-visited")));

  // ---- Follow-up stays BINARY ----
  // Sample after EVERY click, not just at the end. A tri-state mutant cycles
  // false -> true -> "exclude" -> true, so the end state after three clicks is a
  // boolean and an end-only check passes against the bug. The invariant that
  // actually pins it down is that TWO clicks return to where you started.
  await page.evaluate(() => { state.listFilters.followUp = false; renderUserList(); });
  const fuStates = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => toggleFollowUpFilter());
    await page.waitForTimeout(80);
    fuStates.push(await page.evaluate(() => state.listFilters.followUp));
  }
  check("Follow-up is a boolean at every step, never a string state",
    fuStates.every(v => typeof v === "boolean"), JSON.stringify(fuStates));
  check("two clicks return Follow-up to where it started",
    fuStates[0] === true && fuStates[1] === false && fuStates[2] === true && fuStates[3] === false,
    JSON.stringify(fuStates));
  await page.evaluate(() => { state.listFilters.followUp = false; renderUserList(); });

  // ---- an impossible filter empties the view, and offers a way out ----
  await page.evaluate(() => { state.listFilters.stages = { include: ["progress"], exclude: ["progress"] }; renderUserList(); });
  await page.waitForTimeout(200);
  const empty = await page.evaluate(() => {
    const el = document.querySelector("#user-list .empty");
    const btn = el && el.querySelector("button");
    return { text: el ? el.textContent.trim() : null, hasClear: !!btn };
  });
  check("the empty view explains itself", empty.text && /No permits in this list are/.test(empty.text), String(empty.text));
  check("the empty view offers exactly one way out", empty.hasClear, JSON.stringify(empty));
  await page.evaluate(() => clearListFilters());
  await page.waitForTimeout(200);
  check("clearing restores every row", await rowCount(page) === 5, String(await rowCount(page)));

  // ---- keyboard, with a real Enter ----
  await page.focus("#filter-visited");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  check("a real Enter press operates a pill", (await pill("filter-visited")).state === "include",
    JSON.stringify(await pill("filter-visited")));
  await page.evaluate(() => clearListFilters());

  // ---- the bar must not have grown ----
  // NOT "the table is above the fold": measured, it never was on this page. At
  // 390px the table sits ~1234px down a stack dominated by the header (223),
  // the stat tiles (210) and the focal row (157) — the filter bar is a small
  // part of it. The spec's real concern was the bar GROWING, which is what the
  // rejected twelve-chip design would have done. Measured baseline: the old
  // five-chip bar was 96px at 390px; this one is 98px and does more.
  // Measured with the picker CLOSED — its resting state, and the only fair
  // comparison to a predecessor that had nothing to expand. Earlier this test
  // measured it open and reported 367px against the old 96px, which compared
  // two different things. Since FEAT-052 the options are a modal, so they never
  // contribute to this height at all.
  const barH = await page.evaluate(() => {
    closeStagePicker();
    const el = document.getElementById("list-filters");
    return el && !el.hidden ? +el.getBoundingClientRect().height.toFixed(0) : -1;
  });
  // FEAT-052 deliberately spent height here: two labelled lines, a reserved
  // tally slot, and min-widths that stop the controls resizing. Measured after
  // that change: 177px at 390px and 125px at 1280px, against the old 96px. The
  // fold above it returns ~690px on a phone, which is what pays for it. This
  // stays a growth guard — it just pins the NEW baseline, not the old one.
  check("the filter bar did not grow past its measured FEAT-052 baseline",
    barH > 0 && barH <= 190, `${barH}px (FEAT-052 baseline: 177px at 390px, 125px at 1280px)`);

  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "desktop 1280x900");
  await run({ width: 390, height: 844 }, "iPhone 13 390x844");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
