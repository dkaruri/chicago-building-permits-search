// FEAT-047 — the tri-state Construction stage filter on the permit map.
// Covers: the dropdown's options and counts, the three-state cycle, Rule B
// (includes narrow, excludes remove, BOTH apply), counts staying still while
// you tick, the empty state, direction in the status strip, persistence across
// reload, 44px geometry and real keyboard operation.
//
// Socrata is stubbed so the counts are deterministic. Dates are generated from
// TODAY because the map's default range is the current month — a hard-coded
// date would make this suite pass today and fail next month.
const { chromium, CHROME } = require("./_boot");

const today = new Date();
const iso = d => d.toISOString().slice(0, 10);
const day = n => `${iso(new Date(today.getFullYear(), today.getMonth(), n))}T00:00:00`;

let seq = 0;
const permit = (milestone, status = "ACTIVE") => ({
  permit_: `P${++seq}`,
  permit_status: status,
  permit_milestone: milestone,
  permit_type: "PERMIT - RENOVATION/ALTERATION",
  review_type: "STANDARD PLAN REVIEW",
  issue_date: day(2),
  street_number: String(100 + seq),
  street_direction: "N",
  street_name: "TEST ST",
  work_type: "Alteration",
  work_description: "stage filter fixture",
  reported_cost: "1000",
  ward: "1",
  community_area: "1",
  latitude: String(41.9 + seq / 1000),
  longitude: "-87.7",
});

// 3 In progress, 2 Halted, 1 Fee due, 1 Finishing = 7 permits.
const ROWS = [
  permit("INSPECTIONS"), permit("INSPECTIONS"), permit("INSPECTIONS"),
  permit("STOP WORK", "SUSPENDED"), permit("SUSPENDED", "SUSPENDED"),
  permit("PERMIT ISSUED (FEE DUE)"),
  permit("INSPECTIONS (CERTIFICATE OF OCCUPANCY REQUIRED)"),
];
const TOTAL = ROWS.length;

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

async function openDrawer(page) {
  await page.evaluate(() => {
    const d = document.getElementById("map-filter-drawer");
    if (d && d.classList.contains("hidden")) toggleMapDrawer("filters");
    const det = document.getElementById("map-stage-details");
    if (det) det.open = true;
  });
  await page.waitForTimeout(120);
}

const readOptions = page => page.evaluate(() => {
  const rows = [...document.querySelectorAll("#map-stage-details .tri")];
  return rows.map(el => {
    const r = el.getBoundingClientRect();
    return {
      value: el.dataset.value,
      state: el.dataset.state || "",
      label: (el.querySelector(".tri-label") || {}).textContent || "",
      count: Number(((el.querySelector(".tri-count") || {}).textContent || "0").replace(/[^0-9]/g, "")),
      aria: el.getAttribute("aria-label") || "",
      h: +r.height.toFixed(1),
      tag: el.tagName,
    };
  });
});

const pinCount = page => page.evaluate(() => (state.map.filteredRows || []).length);
const strip = page => page.evaluate(() => (document.getElementById("map-status-strip") || {}).textContent || "");

async function clickStage(page, value) {
  await page.evaluate(v => setMapStageFilter(v), value);
  await page.waitForTimeout(350);
  await openDrawer(page);
}

async function run(viewport, label) {
  console.log(`\n== ${label} ==`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });
  await page.route("**/data.cityofchicago.org/resource/ydr8-5enu.json**", r => r.fulfill({ json: ROWS }));
  await page.route("**/api/**", r => r.fulfill({ json: { rows: [], total: 0 } }));
  // Deliberately NO addInitScript(localStorage.clear): it runs on EVERY
  // navigation, including the reload this suite uses to test persistence, so it
  // would wipe the very setting under test and report a product bug that is not
  // there. A fresh page context already starts with empty storage.

  await page.goto("http://localhost:8791/map.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  // NOT `window.state` — map.html declares `const state = {...}` at top level, and
  // a top-level const never becomes a window property, so that guard is
  // permanently falsy and this wait would always time out. Reference it bare.
  await page.waitForFunction(() => (state.map.filteredRows || []).length > 0, null, { timeout: 30000 });
  await openDrawer(page);

  // ---- the options offered ----
  const opts = await readOptions(page);
  check("one option per stage PRESENT, not all seven", opts.length === 4,
    JSON.stringify(opts.map(o => o.value)));
  check("options are native buttons", opts.every(o => o.tag === "BUTTON"),
    JSON.stringify(opts.map(o => o.tag)));
  const byValue = Object.fromEntries(opts.map(o => [o.value, o]));
  check("In progress counts 3", byValue.progress && byValue.progress.count === 3, JSON.stringify(byValue.progress));
  check("Halted counts 2", byValue.halted && byValue.halted.count === 2, JSON.stringify(byValue.halted));
  check("Fee due counts 1", byValue.fee && byValue.fee.count === 1);
  check("Finishing counts 1", byValue.finishing && byValue.finishing.count === 1);
  check("labels are the friendly names", byValue.progress.label.trim() === "In progress", byValue.progress.label);
  check("every option row is >= 44px", opts.every(o => o.h >= 44), JSON.stringify(opts.map(o => o.h)));
  check("accessible name states the state and the next action",
    /not filtered, activate to include/.test(byValue.progress.aria), byValue.progress.aria);

  check(`all ${TOTAL} permits shown before filtering`, await pinCount(page) === TOTAL, String(await pinCount(page)));

  // ---- include narrows ----
  await clickStage(page, "progress");
  let o = await readOptions(page);
  check("first click includes", o.find(x => x.value === "progress").state === "include");
  check("include narrows to that stage only", await pinCount(page) === 3, String(await pinCount(page)));
  check("accessible name updates to say it can be excluded",
    /included, activate to exclude/.test(o.find(x => x.value === "progress").aria));
  // The counts are computed BEFORE the stage filter, so the others must not move.
  const stillThere = Object.fromEntries(o.map(x => [x.value, x.count]));
  check("counts beside the OTHER options do not move when one is ticked",
    stillThere.halted === 2 && stillThere.fee === 1 && stillThere.finishing === 1,
    JSON.stringify(stillThere));
  check("status strip names the included stage", /In progress/.test(await strip(page)), await strip(page));

  // ---- exclude removes ----
  await clickStage(page, "progress");
  o = await readOptions(page);
  check("second click excludes", o.find(x => x.value === "progress").state === "exclude");
  check("exclude removes only that stage", await pinCount(page) === TOTAL - 3, String(await pinCount(page)));
  check("status strip says NOT for an exclusion", /not In progress/.test(await strip(page)), await strip(page));

  // ---- third click clears ----
  await clickStage(page, "progress");
  o = await readOptions(page);
  check("third click clears", o.find(x => x.value === "progress").state === "");
  check("clearing restores every permit", await pinCount(page) === TOTAL, String(await pinCount(page)));
  check("status strip drops the stage note once nothing is set",
    !/In progress/.test(await strip(page)), await strip(page));

  // ---- Rule B: both apply, and can compose to nothing ----
  await clickStage(page, "halted");            // include halted
  await clickStage(page, "halted");            // exclude halted -> include set is empty, exclude halted
  await clickStage(page, "progress");          // include progress
  await clickStage(page, "progress");          // exclude progress
  check("two exclusions remove both stages", await pinCount(page) === TOTAL - 5, String(await pinCount(page)));

  // include a stage AND exclude the same one -> nothing survives
  await page.evaluate(() => {
    const s = loadMapSettings();
    s.stages = { include: ["fee"], exclude: ["fee"] };
  });
  await page.evaluate(() => applyMapFilters());
  await page.waitForTimeout(400);
  check("an include and exclude of the same stage yields nothing",
    await pinCount(page) === 0, String(await pinCount(page)));
  const empty = await page.evaluate(() => {
    const el = document.querySelector("#map-result-list .empty");
    const btn = el && el.querySelector("button");
    return { text: el ? el.textContent : null, hasClear: !!btn, h: btn ? +btn.getBoundingClientRect().height.toFixed(1) : 0 };
  });
  check("the empty state explains itself", empty.text && /No permits match/.test(empty.text), String(empty.text));
  check("the empty state offers a way out", empty.hasClear, JSON.stringify(empty));
  check("the way out is a 44px target", empty.h >= 44, String(empty.h));

  // ---- keyboard, with a REAL Enter ----
  await page.evaluate(() => { resetMapSettings(); });
  await page.waitForTimeout(500);
  await openDrawer(page);
  await page.focus("#map-stage-details .tri");
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.className);
  check("an option can take focus", /tri/.test(focused || ""), String(focused));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  await openDrawer(page);
  o = await readOptions(page);
  check("a real Enter press cycles the option, not just a mouse click",
    o.some(x => x.state === "include"), JSON.stringify(o.map(x => [x.value, x.state])));

  // ---- persistence ----
  const beforeReload = JSON.stringify(await page.evaluate(() => loadMapSettings().stages));
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const afterReload = JSON.stringify(await page.evaluate(() => loadMapSettings().stages));
  check("the stage selection survives a reload", beforeReload === afterReload,
    `${beforeReload} -> ${afterReload}`);

  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "desktop 1280x900");
  await run({ width: 390, height: 844 }, "iPhone 13 390x844");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
