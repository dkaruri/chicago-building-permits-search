// FEAT-052 — the list header folds, the filter row stays put, the count moved
// below the table.
//
// The card's three complaints were MEASURED, so this suite measures the same
// things: dx/dy/dw of every filter control and the table's top edge across each
// interaction (all must be 0), the fold's effect on that top edge, and the two
// things that must NEVER fold — #list-filters and #list-action-status, the
// latter because it carries FIX-003's undo link.
//
// Run: node verify-tmp/t78-list-header.js   (needs :8791 serving docs/)
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const row = (n, milestone, status, extra = {}) => ({
  permit_number: n, address: `${n} N TEST ST`, permit_status: status,
  permit_milestone: milestone, permit_type: "PERMIT - RENOVATION",
  issue_date: "2026-07-01", ward: "1", reported_cost: 1000,
  lat: 41.9, lon: -87.7, general_contractors: "GC ONE", ...extra,
});

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

// Every layout read waits on animations first: #user-list-panel plays listRise
// and the fold animates grid-template-rows. Reading mid-flight reports phantom
// movement and blames the element under test.
const settle = page => page.waitForFunction(
  () => document.getAnimations().every(a => a.playState !== "running"), null, { timeout: 10000 });

const SELECTORS = ["#list-stage-btn", "#filter-visited", "#filter-called", "#filter-followup", "#user-list", "#list-filters", "#list-action-status"];

const snap = page => page.evaluate(sels => Object.fromEntries(sels.map(s => {
  const el = document.querySelector(s);
  if (!el) return [s, null];
  const r = el.getBoundingClientRect();
  // DOCUMENT-relative, not viewport-relative: page.click scrolls a control into
  // view, and a uniform shift across every element is the page moving, not the
  // layout — exactly the false alarm that reads as a catastrophic regression.
  return [s, { x: +(r.x + window.scrollX).toFixed(2), y: +(r.y + window.scrollY).toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }];
})), SELECTORS);

// The table's own height changes when a filter hides rows — that is the point.
// Only x/y/width are pinned, and only height is ignored, for the table.
function movement(before, after) {
  const moved = [];
  for (const s of SELECTORS) {
    const a = before[s], b = after[s];
    if (!a || !b) { moved.push(`${s} missing`); continue; }
    const d = { dx: b.x - a.x, dy: b.y - a.y, dw: b.w - a.w };
    if (Math.abs(d.dx) > 0.5 || Math.abs(d.dy) > 0.5 || Math.abs(d.dw) > 0.5) {
      moved.push(`${s} dx=${d.dx.toFixed(1)} dy=${d.dy.toFixed(1)} dw=${d.dw.toFixed(1)}`);
    }
  }
  return moved;
}

async function stubs(page) {
  await page.route("**/api/notes/bulk*", r => r.fulfill({ json: { threads: {}, truncated: false } }));
  await page.route("**/api/notes/counts*", r => r.fulfill({ json: { counts: {} } }));
  await page.route("**/api/contact/**", r => r.fulfill({ json: {} }));
}

async function run(viewport, label) {
  console.log(`\n== ${label} ==`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await stubs(page);
  await openList(page);
  await seedSavedList(page, ROWS);
  // A description long enough that the fold is worth something.
  await page.evaluate(() => {
    activeList().desc = Array.from({ length: 8 }, (_, i) => `• Aug ${i + 1} — 1 from Search: Open Permits · Ward ${i}`).join("\n");
    renderListHeading();
  });
  await settle(page);

  // ---- 1. Nothing moves when a filter is clicked ----
  // The three interactions the card measured: +13px, +45px and +118px of shove.
  const actions = [
    ["clicking Visited", () => setRowFilter("visited")],
    ["including a stage", () => setListStageFilter("progress")],
    ["toggling Follow-up", () => toggleFollowUpFilter()],
  ];
  for (const [name, fn] of actions) {
    const before = await snap(page);
    await page.evaluate(`(${fn.toString()})()`);
    await settle(page);
    const after = await snap(page);
    const moved = movement(before, after);
    check(`${name} moves nothing`, moved.length === 0, moved.join("; "));
  }
  await page.evaluate(() => { clearListFilters(); setRowFilter("visited"); setRowFilter("visited"); setRowFilter("visited"); });
  await page.evaluate(() => clearListFilters());
  await settle(page);

  // ---- 2. The stage badge is fixed width whatever is on ----
  const badge = async () => page.$eval("#list-stage-count", el => +el.getBoundingClientRect().width.toFixed(2));
  const w0 = await badge();
  await page.evaluate(() => setListStageFilter("progress"));
  await settle(page);
  const w1 = await badge();
  await page.evaluate(() => { setListStageFilter("halted"); setListStageFilter("halted"); });
  await settle(page);
  const w2 = await badge();
  check("the stage badge keeps one width across all / 1 / 2 constraints",
    Math.abs(w1 - w0) < 0.5 && Math.abs(w2 - w0) < 0.5, `${w0} / ${w1} / ${w2}`);
  const words = await page.$eval("#list-stage-words", el => el.textContent.trim());
  check("the full wording lives inside the picker", /included/.test(words) && /excluded/.test(words), words);

  // ---- 2b. The Stage control opens a modal, and opening it moves nothing ----
  // The options used to expand inline, which pushed the table down the page.
  const beforePick = await snap(page);
  await page.click("#list-stage-btn");
  await settle(page);
  const picker = await page.evaluate(() => {
    const d = document.getElementById("stage-picker");
    return {
      open: d.open, modal: d.matches(":modal"),
      options: d.querySelectorAll(".tri").length,
      focused: document.activeElement.classList.contains("tri"),
      haspopup: document.getElementById("list-stage-btn").getAttribute("aria-haspopup"),
    };
  });
  check("the Stage control opens a modal picker with the options in it",
    picker.open && picker.modal && picker.options > 0 && picker.haspopup === "dialog", JSON.stringify(picker));
  check("focus lands inside the picker", picker.focused, JSON.stringify(picker));
  check("opening the picker moves nothing behind it",
    movement(beforePick, await snap(page)).length === 0, movement(beforePick, await snap(page)).join("; "));
  await page.keyboard.press("Escape");
  await settle(page);
  const afterEsc = await page.evaluate(() => ({
    open: document.getElementById("stage-picker").open,
    focused: document.activeElement.id,
  }));
  check("Escape closes it and returns focus to the control that opened it",
    !afterEsc.open && afterEsc.focused === "list-stage-btn", JSON.stringify(afterEsc));

  await page.evaluate(() => clearListFilters());
  await settle(page);

  // ---- 3. The counts sit where the design put them ----
  const order = await page.evaluate(() => {
    const pos = (a, b) => document.querySelector(a).compareDocumentPosition(document.querySelector(b)) & Node.DOCUMENT_POSITION_FOLLOWING;
    return {
      countBelowTable: !!pos("#user-list", "#list-filter-status"),
      filtersAboveTable: !!pos("#list-filters", "#user-list"),
      statusAboveFilters: !!pos("#list-action-status", "#list-filters"),
      tallyInBar: !!document.querySelector("#list-filters #list-tally"),
    };
  });
  check("the filtered count is below the table", order.countBelowTable, JSON.stringify(order));
  check("the filter row sits directly above the table", order.filtersAboveTable, JSON.stringify(order));
  check("the undo line sits above the filter row", order.statusAboveFilters, JSON.stringify(order));
  check("the unfiltered tally stays in the filter row", order.tallyInBar, JSON.stringify(order));

  await page.evaluate(() => { activeList().ticks = { A1: 1 }; renderUserList(); });
  await settle(page);
  const split = await page.evaluate(() => ({
    tally: $("list-tally").textContent.trim(), filtered: $("list-filter-status").textContent.trim(),
  }));
  check("unfiltered: the tally counts, the filtered line is silent",
    /1 visited/.test(split.tally) && split.filtered === "", JSON.stringify(split));
  await page.evaluate(() => setRowFilter("visited"));
  await settle(page);
  const split2 = await page.evaluate(() => ({
    tally: $("list-tally").textContent.trim(), filtered: $("list-filter-status").textContent.trim(),
  }));
  check("filtered: the count appears below the table", /Showing 1 of 5/.test(split2.filtered), JSON.stringify(split2));
  await page.evaluate(() => clearListFilters());
  await settle(page);

  // ---- 4. The fold ----
  const openTop = await page.$eval("#user-list", el => el.getBoundingClientRect().top + window.scrollY);
  await page.click("#list-header-toggle");
  await settle(page);
  const folded = await page.evaluate(() => {
    const vis = id => { const r = document.getElementById(id).getBoundingClientRect(); return { h: r.height, w: r.width }; };
    return {
      top: document.getElementById("user-list").getBoundingClientRect().top + window.scrollY,
      foldH: document.getElementById("list-header-fold").getBoundingClientRect().height,
      expanded: document.getElementById("list-header-toggle").getAttribute("aria-expanded"),
      filters: vis("list-filters"),
      status: vis("list-action-status"),
      toolbarVisible: document.querySelector(".user-list-toolbar").getBoundingClientRect().height,
    };
  });
  check("folding lifts the table", folded.top < openTop - 100, `${folded.top.toFixed(0)}px vs ${openTop.toFixed(0)}px open`);
  check("the fold is actually closed", folded.foldH < 2 && folded.expanded === "false", JSON.stringify(folded));
  check("the filter row never folds", folded.filters.h > 0 && folded.filters.w > 0, JSON.stringify(folded.filters));

  // ---- 5. Undo must be reachable while folded (FIX-003) ----
  await page.evaluate(() => removePermitFromUserList("A2"));
  await page.waitForTimeout(400);
  await settle(page);
  const undo = await page.evaluate(() => {
    const node = document.getElementById("list-action-status");
    const link = node.querySelector(".linkish");
    const r = (link || node).getBoundingClientRect();
    return {
      text: node.textContent.trim(), hasLink: !!link,
      onScreen: r.height > 0 && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight,
      insideFold: !!document.getElementById("list-header-fold").contains(node),
    };
  });
  check("removing a permit while folded still offers Undo", undo.hasLink && /Undo/i.test(undo.text), undo.text);
  check("the Undo link is on screen with the header folded", undo.onScreen, JSON.stringify(undo));
  check("the undo line is not inside the fold at all", !undo.insideFold);
  await page.evaluate(() => { const b = document.querySelector("#list-action-status .linkish"); if (b) b.click(); });
  await settle(page);

  // ---- 6. Reopening restores the header ----
  await page.click("#list-header-toggle");
  await settle(page);
  const reopened = await page.evaluate(() => ({
    top: document.getElementById("user-list").getBoundingClientRect().top + window.scrollY,
    expanded: document.getElementById("list-header-toggle").getAttribute("aria-expanded"),
  }));
  check("reopening puts the table back", Math.abs(reopened.top - openTop) < 2 && reopened.expanded === "true",
    `${reopened.top.toFixed(0)}px vs ${openTop.toFixed(0)}px`);

  // ---- 7. A repaint must not reset the fold ----
  // renderListHeading runs after every add and on every live sync frame; folding
  // shut under someone reading the list is the trap the card recorded.
  await page.click("#list-header-toggle");
  await settle(page);
  const survives = await page.evaluate(() => {
    renderListHeading();
    renderUserList();
    renderListHeading();
    return document.getElementById("list-header-fold").dataset.collapsed;
  });
  check("a repaint (add / live frame) does not reopen the fold", survives === "true", `collapsed=${survives}`);

  // ---- 8. It survives a reload ----
  await page.waitForTimeout(600); // saveLastView debounces 400ms
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });
  await seedSavedList(page, ROWS);
  await settle(page);
  const afterReload = await page.evaluate(() => document.getElementById("list-header-fold").dataset.collapsed);
  check("the folded state survives a reload", afterReload === "true", `collapsed=${afterReload}`);
  await page.click("#list-header-toggle");
  await page.waitForTimeout(600);

  // ---- 9. Touch targets and labels ----
  const a11y = await page.evaluate(() => {
    const t = document.getElementById("list-header-toggle").getBoundingClientRect();
    const pills = [...document.querySelectorAll("#list-filters button")].map(b => ({
      id: b.id, h: +b.getBoundingClientRect().height.toFixed(1),
      name: (b.getAttribute("aria-label") || b.textContent).trim(),
    }));
    const summary = document.getElementById("list-stage-btn").getBoundingClientRect();
    return { toggleH: +t.height.toFixed(1), pills, summaryH: +summary.height.toFixed(1),
      labels: [...document.querySelectorAll(".filter-line-label")].map(e => e.textContent.trim()) };
  });
  check("the fold toggle is a 44px target", a11y.toggleH >= 43.5, `${a11y.toggleH}px`);
  check("every filter control is a 44px target", a11y.pills.every(p => p.h >= 43.5) && a11y.summaryH >= 43.5,
    JSON.stringify(a11y.pills.map(p => [p.id, p.h])));
  check("every filter control names itself", a11y.pills.every(p => p.name.length > 1), JSON.stringify(a11y.pills.map(p => p.name)));
  check("the two rows are labelled Permit / Your activity",
    a11y.labels.join("|") === "Permit|Your activity", JSON.stringify(a11y.labels));

  await page.screenshot({ path: `verify-tmp/t78-${label.replace(/\W/g, "")}.png`, fullPage: false });
  await ctx.close();
  await browser.close();
}

// prefers-reduced-motion: the fold must jump, not animate.
async function runReducedMotion() {
  console.log("\n== reduced motion (desktop) ==");
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await stubs(page);
  await openList(page);
  await seedSavedList(page, ROWS);
  await settle(page);
  await page.click("#list-header-toggle");
  // Read immediately: a running transition would still be mid-flight here.
  const anims = await page.evaluate(() => document.getAnimations()
    .filter(a => a.transitionProperty === "grid-template-rows")
    .map(a => a.effect.getTiming().duration));
  check("the fold does not animate under prefers-reduced-motion",
    anims.every(d => d <= 1), JSON.stringify(anims));
  const collapsed = await page.evaluate(() => document.getElementById("list-header-fold").getBoundingClientRect().height);
  check("it still folds under prefers-reduced-motion", collapsed < 2, `${collapsed.toFixed(1)}px`);
  await ctx.close();
  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "desktop 1280x900");
  await run({ width: 390, height: 844 }, "iPhone 13 390x844");
  await runReducedMotion();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
