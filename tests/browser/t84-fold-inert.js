// t84 — FIX-049. FEAT-052's header fold clips its block with
// `grid-template-rows: 1fr->0fr` + `overflow: hidden`. Clipping is a VISUAL
// operation: a clipped subtree stays in the focus order and in the
// accessibility tree, so folded, a keyboard user tabbed through Starting
// Location, the route controls, the description and List Note one invisible
// stop at a time, each landing in a zero-height box.
//
// Everything here is driven with REAL keys. `.click()` and `.focus()` would
// prove nothing about the tab order — that is the whole subject.
//
//   node verify-tmp/t84-fold-inert.js
//   BASE=https://…github.io/… node verify-tmp/t84-fold-inert.js
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const ROWS = [
  { permit_number: "101082609", address: "3701 W AINSLIE ST", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", ward: "39", reported_cost: 120000, lat: 41.97, lon: -87.72, general_contractors: "BEAR CONSTRUCTION" },
  { permit_number: "B200461632", address: "1200 N STATE PKWY", permit_status: "ACTIVE", permit_type: "PERMIT - NEW CONSTRUCTION", issue_date: "2026-07-02", ward: "2", reported_cost: 900000, lat: 41.90, lon: -87.62, general_contractors: "" },
];

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

// Where focus actually is, described well enough to name a culprit.
const WHERE = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: "body", inFold: false };
  const fold = document.getElementById("list-header-fold");
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
    inFold: !!(fold && fold.contains(el)),
    h: Math.round(r.height),
  };
};

// Tab n times from wherever focus is, recording each stop.
async function sweep(page, n) {
  const stops = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Tab");
    stops.push(await page.evaluate(WHERE));
  }
  return stops;
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
  await page.waitForSelector("#list-header-toggle", { timeout: 10000 });

  const focusToggle = () => page.evaluate(() => document.getElementById("list-header-toggle").focus());
  const collapsed = () => page.$eval("#list-header-fold", el => el.dataset.collapsed === "true");
  // How many focusable controls the fold holds while it is open — the count the
  // folded sweep has to drop to zero. Derived, never hard-coded: the block's
  // contents change with the feature.
  const foldFocusables = () => page.$$eval(
    "#list-header-fold a[href], #list-header-fold button, #list-header-fold input, #list-header-fold select, #list-header-fold textarea, #list-header-fold [tabindex]",
    els => els.filter(e => !e.disabled && e.getAttribute("tabindex") !== "-1").length);

  // ---- expanded: the control is the control ----
  check("the fold starts expanded", !(await collapsed()));
  const openCount = await foldFocusables();
  check("the open fold holds focusable controls to begin with", openCount > 0, String(openCount));

  await focusToggle();
  const openStops = await sweep(page, Math.min(openCount, 6));
  check("expanded, tabbing off the toggle goes INTO the fold",
    openStops[0] && openStops[0].inFold, JSON.stringify(openStops[0]));

  // A control inside the fold must be in the a11y tree while it is open —
  // the control that proves the collapsed assertion below can report success.
  const inA11yTree = async () => {
    const snap = await page.accessibility.snapshot();
    const seen = [];
    (function walk(n) { if (!n) return; if (n.name) seen.push(n.name); (n.children || []).forEach(walk); })(snap);
    return seen.some(n => /Optimize route/i.test(n));
  };
  check("a fold control is in the accessibility tree while open", await inA11yTree());

  const fullHeight = await page.$eval("#list-header-fold", el => el.getBoundingClientRect().height);

  // ---- collapse with a real key, not .click() ----
  await focusToggle();
  await page.keyboard.press("Enter");
  // Sampled MID-FLIGHT, ~110ms into a .22s transition. Applying inert on
  // collapse is deliberately immediate rather than deferred to the end of the
  // transition, so this is the assertion that says it did not cut the close
  // short — inert changes focus and the a11y tree, never layout.
  await page.waitForTimeout(110);
  const midH = await page.$eval("#list-header-fold", el => el.getBoundingClientRect().height);
  check("the closing animation still runs with inert applied immediately",
    midH > 0 && midH < fullHeight, `mid-flight ${Math.round(midH)}px of ${Math.round(fullHeight)}px`);
  await page.waitForFunction(() => document.getElementById("list-header-fold").dataset.collapsed === "true", null, { timeout: 5000 });
  check("Enter on the toggle collapses the fold", await collapsed());
  check("the toggle reports itself collapsed", await page.$eval("#list-header-toggle", el => el.getAttribute("aria-expanded")) === "false");

  // Past the .22s transition — applying inert too early cuts the close short,
  // so the assertion has to be made where a user would actually be.
  await page.waitForTimeout(400);
  check("the fold is clipped to zero height", await page.$eval("#list-header-fold", el => Math.round(el.getBoundingClientRect().height)) === 0);

  // ---- the actual defect ----
  check("the collapsed fold is inert", await page.$eval("#list-header-fold", el => el.inert === true));
  // The other half of the card: a screen reader still read the whole region.
  check("the collapsed fold is out of the accessibility tree too", !(await inA11yTree()));
  await focusToggle();
  const foldedStops = await sweep(page, Math.max(openCount, 8));
  const inside = foldedStops.filter(s => s.inFold);
  check("collapsed, a Tab sweep never lands inside the fold",
    inside.length === 0, `${inside.length} stop(s) inside: ${JSON.stringify(inside.slice(0, 4))}`);
  check("collapsed, the first Tab off the toggle lands on a visible control",
    foldedStops[0] && !foldedStops[0].inFold && foldedStops[0].h > 0, JSON.stringify(foldedStops[0]));

  // ---- focus must not be dropped on the floor when the region folds ----
  await page.evaluate(() => document.getElementById("list-header-toggle").click()); // reopen
  await page.waitForFunction(() => document.getElementById("list-header-fold").dataset.collapsed === "false", null, { timeout: 5000 });
  await page.waitForTimeout(400);
  const grabbed = await page.evaluate(() => {
    const el = document.querySelector("#list-header-fold input, #list-header-fold button, #list-header-fold a[href]");
    if (!el) return null;
    el.focus();
    return el.id || el.tagName.toLowerCase();
  });
  check("a control inside the open fold can take focus", !!grabbed, String(grabbed));
  await page.evaluate(() => toggleListHeader());
  await page.waitForTimeout(400);
  const after = await page.evaluate(WHERE);
  check("folding with focus inside moves focus to the toggle, not to <body>",
    after.id === "list-header-toggle", JSON.stringify(after));

  // ---- and it all comes back ----
  await focusToggle();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.getElementById("list-header-fold").dataset.collapsed === "false", null, { timeout: 5000 });
  await page.waitForTimeout(400);
  check("the reopened fold is not inert", await page.$eval("#list-header-fold", el => el.inert === false));
  check("the reopened fold holds the same focusable controls as before", await foldFocusables() === openCount);
  await focusToggle();
  const reopened = await sweep(page, 1);
  check("expanded again, tabbing off the toggle goes back into the fold",
    reopened[0] && reopened[0].inFold, JSON.stringify(reopened[0]));

  await browser.close();
}

// The list header fold is not the only region hidden by clipping. `.map-drawer`
// on map.html closes with max-height + opacity and never sets `visibility`, so
// it held FORTY-EIGHT focusable controls in the tab order — the same defect,
// 3.7x bigger, and it ships closed so they were reachable from first paint.
// Found by grepping the clipping pattern rather than the reported symptom.
//
// `.map-result-list` and `.map-detail-sheet` were checked the same way and are
// already safe: both set `visibility: hidden`, which does remove focus.
async function runMap(viewport, label) {
  console.log(`\n== map.html filter drawer — ${label} ==`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ json: [{ lat: "41.9", lon: "-87.7", display_name: "stub" }] }));
  await page.goto(`${(process.env.BASE || "http://localhost:8791")}/map.html`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });

  const state = () => page.$eval("#map-filter-drawer", el => {
    const sel = "a[href],button,input,select,textarea,[tabindex]";
    const foc = [...el.querySelectorAll(sel)].filter(e => !e.disabled && e.getAttribute("tabindex") !== "-1");
    let took = null;
    if (foc.length) { foc[0].focus(); took = document.activeElement === foc[0]; if (document.activeElement.blur) document.activeElement.blur(); }
    return { inert: el.inert, hidden: el.classList.contains("hidden"), focusables: foc.length, canFocus: took };
  });

  const closed = await state();
  check("the drawer ships closed", closed.hidden);
  check("it holds focusable controls at all (the control for the assertion below)", closed.focusables > 0, String(closed.focusables));
  check("closed at FIRST PAINT, the drawer is inert and takes no focus",
    closed.inert === true && closed.canFocus === false, JSON.stringify(closed));

  await page.evaluate(() => toggleMapDrawer("filters"));
  await page.waitForTimeout(300);
  const open = await state();
  check("opened, the drawer is live again and its controls take focus",
    open.inert === false && open.canFocus === true, JSON.stringify(open));
  check("opening does not change how many controls it has", open.focusables === closed.focusables);

  await page.evaluate(() => toggleMapDrawer("filters"));
  await page.waitForTimeout(300);
  const reclosed = await state();
  check("closed again, it is inert again",
    reclosed.inert === true && reclosed.canFocus === false, JSON.stringify(reclosed));

  // The drawer's markup used to hard-code `hidden` (and, briefly, `inert`),
  // while `state.map.drawer` could still say "filters". Any re-render then shut
  // an open drawer and left state disagreeing, so the next click on Filters
  // toggled it CLOSED instead of opening it. Nothing noticed while a closed
  // drawer stayed focusable; inert turned the silent desync into a red t76.
  await page.evaluate(() => toggleMapDrawer("filters"));
  await page.waitForTimeout(200);
  await page.evaluate(() => renderMapMode());
  await page.waitForTimeout(400);
  const survived = await state();
  check("an OPEN drawer survives a re-render, still open and still live",
    survived.hidden === false && survived.inert === false && survived.canFocus === true,
    JSON.stringify(survived));
  check("the toggle still reports it open after a re-render",
    await page.$eval("#map-filter-toggle", el => el.getAttribute("aria-expanded")) === "true");

  // This markup lives inside a JS template literal — a backtick in a comment
  // there ends the string and takes the whole page down. It did exactly that
  // once while this fix was being written, so the suite watches for it.
  check("map.html parses — no page errors", errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "desktop 1280x900");
  await run({ width: 390, height: 844 }, "iPhone 13 390x844");
  await runMap({ width: 1280, height: 900 }, "desktop 1280x900");
  await runMap({ width: 390, height: 844 }, "iPhone 13 390x844");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
