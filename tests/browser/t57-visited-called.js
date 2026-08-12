// FEAT-031 — visited/called columns + combinable row filters.
// Desktop AND iPhone 13, asserting GEOMETRY, not DOM presence.
const { devices } = require("playwright");
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const ROWS = [
  { permit_number: "100234", address: "1 N State St", permit_status: "ACTIVE", issue_date: "2026-07-01", permit_type: "PERMIT - RENOVATION/ALTERATION", work_type: "", reported_cost: "10000", general_contractors: "ACME BUILDERS LLC" },
  { permit_number: "100987", address: "2 S Clark St", permit_status: "ACTIVE", issue_date: "2026-07-02", permit_type: "PERMIT - ELECTRIC WIRING", work_type: "", reported_cost: "20000", general_contractors: "" },
  { permit_number: "100555", address: "3 W Adams St", permit_status: "ACTIVE", issue_date: "2026-07-03", permit_type: "PERMIT - NEW CONSTRUCTION", work_type: "", reported_cost: "30000", general_contractors: "" },
];

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("  FAIL " + msg); } };

// Set the flags directly on the active list, the way a sync or a tap would.
async function setFlags(page, flags) {
  await page.evaluate(async f => {
    const l = activeList();
    l.ticks = f.ticks || {}; l.called = f.called || {}; l.fu = f.fu || {};
    await renderUserList();
  }, flags);
}

const rowCount = page => page.$$eval(".saved-permits-table tbody tr", rs => rs.length);

// FEAT-048. Visited/Called became TRI-STATE pills (off -> include -> exclude),
// replacing four chips. This drives a pill to a named state rather than counting
// clicks, so the assertions below still say what they mean. Every behavioural
// check from the four-chip era is preserved: within a facet the states remain
// mutually exclusive, across facets they still combine, and "visited + not
// called" is still the question being asked.
async function setPill(page, id, target) {
  for (let i = 0; i < 4; i++) {
    const st = await page.$eval("#" + id, e => e.dataset.state || "");
    if (st === target) return;
    await page.click("#" + id);
    await page.waitForTimeout(90);
  }
  throw new Error(`could not drive #${id} to "${target}"`);
}

async function run(context, label, isMobile) {
  const page = await context.newPage();
  await openList(page);
  await seedSavedList(page, ROWS);
  console.log(`\n== ${label} ==`);

  // ---- Two columns, both labelled ----
  const heads = await page.$$eval(".saved-permits-table thead th.tick-cell", ths => ths.map(t => t.textContent.trim()));
  ok(heads.length === 2, `expected 2 tick columns, got ${heads.length}`);
  ok(heads[0] === "Visited" && heads[1] === "Called", `column headers were ${JSON.stringify(heads)}`);

  const boxes = await page.$$eval(".saved-permits-table tbody tr:first-child input.tick", ins =>
    ins.map(i => ({ cls: i.className, label: i.getAttribute("aria-label"), ...i.getBoundingClientRect().toJSON() })));
  ok(boxes.length === 2, `expected 2 checkboxes per row, got ${boxes.length}`);
  ok(/tick-visited/.test(boxes[0].cls) && /tick-called/.test(boxes[1].cls), "checkbox classes wrong");
  // Every control has an accessible name that says WHICH permit and WHICH facet.
  ok(/^Visited — 1 N State St/.test(boxes[0].label || ""), `visited aria-label: ${boxes[0].label}`);
  ok(/^Called — 1 N State St/.test(boxes[1].label || ""), `called aria-label: ${boxes[1].label}`);

  // ---- 44px touch targets, measured including the margin ----
  const targets = await page.$$eval(".saved-permits-table tbody tr:first-child input.tick", ins => ins.map(i => {
    const cs = getComputedStyle(i);
    const r = i.getBoundingClientRect();
    return {
      w: r.width + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight),
      h: r.height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom),
    };
  }));
  for (const [i, t] of targets.entries()) {
    ok(t.w >= 44 && t.h >= 44, `checkbox ${i} hit area ${t.w.toFixed(1)}x${t.h.toFixed(1)}, under 44`);
  }

  // ---- Independence: ticking visited must not tick called ----
  await page.click(".saved-permits-table tbody tr:first-child input.tick-visited");
  await page.waitForTimeout(120);
  const after = await page.$$eval(".saved-permits-table tbody tr:first-child input.tick", ins => ins.map(i => i.checked));
  ok(after[0] === true && after[1] === false, `after ticking visited: ${JSON.stringify(after)}`);
  const stored = await page.evaluate(() => ({ t: activeList().ticks, c: activeList().called || {} }));
  ok(stored.t["100234"] && !stored.c["100234"], "visited tick must not write the called map");

  // ---- The filter bar ----
  await setFlags(page, { ticks: { 100234: 1 }, called: { 100987: "Divyam" }, fu: { 100555: 1 } });
  const barHidden = await page.$eval("#list-filters", el => el.hidden);
  ok(barHidden === false, "filter bar must appear once anything is flagged");

  const chipIds = ["filter-visited", "filter-called", "filter-followup"];
  for (const id of chipIds) {
    const box = await page.$eval("#" + id, el => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, top: r.top, left: r.left, right: r.right, text: el.textContent.trim() };
    });
    ok(box.h >= 44, `chip ${id} is ${box.h.toFixed(1)}px tall, under 44`);
    ok(box.text.length > 0, `chip ${id} has no visible text`);
    ok(box.left >= 0 && box.right <= (isMobile ? 390 : 1280) + 1, `chip ${id} overflows the viewport (${box.left.toFixed(0)}..${box.right.toFixed(0)})`);
  }

  // Chips must not overlap each other (the 8px touch-spacing rule).
  const rects = await page.$$eval("#list-filters button.tag, #list-filters button.tri-pill", bs => bs.map(b => b.getBoundingClientRect().toJSON()));
  for (let i = 1; i < rects.length; i++) {
    const a = rects[i - 1], b = rects[i];
    const sameRow = Math.abs(a.top - b.top) < 4;
    ok(!sameRow || b.left - a.right >= 6, `chips ${i - 1}/${i} are ${(b.left - a.right).toFixed(1)}px apart`);
  }

  // ---- Filtering actually filters ----
  ok(await rowCount(page) === 3, "unfiltered list must show all 3");

  await setPill(page, "filter-visited", "include");
  await page.waitForTimeout(120);
  ok(await rowCount(page) === 1, "Visited must show 1 row");
  ok(await page.$eval("#filter-visited", e => /included/.test(e.getAttribute("aria-label") || "")), "pill must announce its included state");

  // Mutually exclusive within the pair.
  await setPill(page, "filter-visited", "exclude");
  await page.waitForTimeout(120);
  ok(await rowCount(page) === 2, "Not visited must show 2 rows");
  ok(await page.$eval("#filter-visited", e => (e.dataset.state || "") === "exclude"),
    "excluding must release the include — a row cannot be both");

  // Combining across facets.
  await setPill(page, "filter-visited", "include");
  await setPill(page, "filter-called", "exclude");
  await page.waitForTimeout(120);
  ok(await rowCount(page) === 1, "visited + not called must show exactly the 1 matching row");
  const shown = await page.$eval(".saved-permits-table tbody tr td[data-label='Permit'] strong", e => e.textContent.trim());
  ok(shown === "100234", `visited+not-called showed ${shown}`);

  // The empty state names the filters, and offers a way out.
  await setPill(page, "filter-called", "include");  // visited + called -> nothing
  await page.waitForTimeout(120);
  const empty = await page.$eval("#user-list .empty", e => e.textContent.trim()).catch(() => "");
  ok(/visited and called/.test(empty), `empty state did not name the filters: ${empty}`);
  ok(await page.$("#user-list .empty button.linkish") !== null, "empty state must offer Show all");
  await page.click("#user-list .empty button.linkish");
  await page.waitForTimeout(120);
  ok(await rowCount(page) === 3, "Show all must restore every row");

  // ---- Reordering stays locked while filtered (inherited from FEAT-034) ----
  await setPill(page, "filter-called", "include");
  await page.waitForTimeout(120);
  const moveState = await page.$eval(".saved-permits-table tbody tr .move-cell button", b => ({
    ariaDisabled: b.getAttribute("aria-disabled"), disabled: b.disabled,
  }));
  ok(moveState.ariaDisabled === "true", "move buttons must be aria-disabled while filtered");
  ok(moveState.disabled === false, "must stay focusable so it can explain itself, never hard-disabled");
  await setPill(page, "filter-called", "");
  await page.waitForTimeout(120);

  // ---- Attribution reaches the label, in text ----
  const calledLabel = await page.$eval(".saved-permits-table tbody tr:nth-child(2) input.tick-called", i => i.getAttribute("aria-label"));
  ok(/by Divyam/.test(calledLabel), `actor missing from the label: ${calledLabel}`);
  const visitedLabel = await page.$eval(".saved-permits-table tbody tr:first-child input.tick-visited", i => i.getAttribute("aria-label"));
  ok(!/by\s*$/.test(visitedLabel), `a legacy 1 flag must not render a dangling 'by': ${visitedLabel}`);

  // ---- Export scope is NOT narrowed by the view filter ----
  await setPill(page, "filter-visited", "include");
  await page.waitForTimeout(120);
  const exportScope = await page.evaluate(() => userListRows().length);
  ok(exportScope === 3, `exports/routing must still see all 3 rows while filtered, saw ${exportScope}`);
  await setPill(page, "filter-visited", "");
  await page.waitForTimeout(120);

  // ---- CSV: the new columns line up, and carry the actor ----
  // The header list and the row builder are two separate literals, which is
  // exactly how the thead/tbody column drift happened on this table before.
  const csv = await page.evaluate(async () => {
    let captured = "";
    const realBlob = window.downloadBlob;
    window.downloadBlob = (name, content) => { captured = content; };
    try { await downloadUserListCsv(); } finally { window.downloadBlob = realBlob; }
    return captured;
  });
  if (!csv) {
    ok(false, "CSV export produced nothing (downloadBlob could not be intercepted)");
  } else {
    const lines = csv.split("\r\n");
    const cells = l => l.match(/"(?:[^"]|"")*"|[^,]+/g) || [];
    const head = lines[0].split(",");
    ok(head.includes("visited") && head.includes("visited_by") && head.includes("called") && head.includes("called_by"),
      `CSV header missing a flag column: ${lines[0]}`);
    for (let i = 1; i < lines.length; i++) {
      ok(cells(lines[i]).length === head.length,
        `CSV row ${i} has ${cells(lines[i]).length} cells against ${head.length} headers`);
    }
    // 100987 was called by Divyam; that must reach the export, not just the UI.
    const called = lines.find(l => l.includes("100987"));
    ok(/"Divyam"/.test(called || ""), `CSV lost the actor: ${called}`);
    ok(lines.length - 1 === 3, `CSV must export all 3 rows regardless of the view filter, got ${lines.length - 1}`);
  }

  // ---- Mobile: the Called cell must sit with Visited under the permit
  //      number, not at the bottom of the stacked card ----
  if (isMobile) {
    const order = await page.$$eval(".saved-permits-table tbody tr:first-child td", tds =>
      tds.map(td => ({
        label: td.getAttribute("data-label"),
        order: getComputedStyle(td).order,
        display: getComputedStyle(td).display,
        top: td.getBoundingClientRect().top,
      })));
    const permitTop = order.find(o => o.label === "Permit").top;
    const visited = order.find(o => o.label === "Visited");
    const called = order.find(o => o.label === "Called");
    ok(visited.order === "2" && called.order === "2", `stack order was visited:${visited.order} called:${called.order}`);
    ok(visited.top > permitTop && called.top > permitTop, "both boxes must sit below the permit number");
    // Only VISIBLE data cells: this table hides Issued/Cost/Zone/TIF at 390px
    // and a display:none cell reports top 0, which reads as "above everything".
    // Remove/Move are row controls, not data, and sit outside the stack order.
    const DATA = ["Status", "Address", "Use", "Notes"];
    const below = order.filter(o => DATA.includes(o.label) && o.display !== "none");
    ok(below.length >= 3, `expected the visible data cells, found ${below.length}`);
    ok(below.every(o => o.top >= called.top), "Called must come before the data cells, not after them");
    // The ::before inline label is what carries the meaning on a phone.
    const beforeText = await page.$$eval(".saved-permits-table tbody tr:first-child td.tick-cell", tds =>
      tds.map(td => getComputedStyle(td, "::before").content));
    ok(/Visited/.test(beforeText[0]) && /Called/.test(beforeText[1]), `inline labels were ${JSON.stringify(beforeText)}`);

    // No horizontal overflow at 390px.
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(hscroll <= 1, `page scrolls horizontally by ${hscroll}px`);
  }

  // ---- Contrast of the pressed chips, both themes ----
  // This page TRANSITIONS background-color on a theme change. Measured 80ms
  // after the switch the chip reads rgba(142,184,255,0.706) — mid-flight — and
  // reported 4.26:1 for a colour that settles at 8.6:1. Wait for the element's
  // own transitions to finish, never a fixed delay.
  const settled = sel => page.waitForFunction(
    s => document.querySelector(s).getAnimations().every(a => a.playState !== "running"), sel);

  const contrastOf = async sel => page.$eval(sel, el => {
    const parse = s => {
      const nums = (s.match(/[\d.]+/g) || []).map(Number);
      const rgb = s.startsWith("color(") ? nums.slice(0, 3).map(n => n * 255) : nums.slice(0, 3);
      return { rgb, a: s.startsWith("color(") ? (nums[3] ?? 1) : (nums[3] ?? 1) };
    };
    // Composite a translucent surface over whatever is actually behind it.
    const behind = node => {
      for (let n = node.parentElement; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c.a === 1) return c.rgb;
      }
      return [255, 255, 255];
    };
    const over = (fg, bg) => fg.rgb.map((v, i) => v * fg.a + bg[i] * (1 - fg.a));
    const cs = getComputedStyle(el);
    const base = behind(el);
    const bg = over(parse(cs.backgroundColor), base);
    const fg = over(parse(cs.color), bg);
    const lum = rgb => {
      const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return { ratio: (hi + 0.05) / (lo + 0.05), fg: cs.color, bg: cs.backgroundColor };
  });

  for (const theme of ["light", "dark"]) {
    await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
    await setPill(page, "filter-called", "include");
    await settled("#filter-called");
    const c = await contrastOf("#filter-called");
    ok(c.ratio >= 4.5, `pressed Called chip contrast ${c.ratio.toFixed(2)}:1 in ${theme} (fg ${c.fg} on bg ${c.bg})`);

    // CONTROL: poison the colour and confirm the probe can still fail. A probe
    // that has only ever returned "pass" has not been shown to discriminate.
    // Paint the text in its own background colour — guaranteed ~1:1 whatever
    // the theme — and wait for the colour TRANSITION, which caught this control
    // out once already and made it report the unpoisoned value.
    await page.evaluate(() => {
      const el = document.getElementById("filter-called");
      el.style.transition = "none";
      el.style.color = getComputedStyle(el).backgroundColor;
    });
    await settled("#filter-called");
    const poisoned = await contrastOf("#filter-called");
    ok(poisoned.ratio < 4.5, `contrast probe failed to catch a deliberately poisoned colour (${poisoned.ratio.toFixed(2)}:1)`);
    await page.evaluate(() => {
      const el = document.getElementById("filter-called");
      el.style.color = ""; el.style.transition = "";
    });

    await setPill(page, "filter-called", "");
  }
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));

  await page.screenshot({ path: `verify-tmp/t57-${isMobile ? "mobile" : "desktop"}.png`, fullPage: false });
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  try {
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await run(desktop, "desktop 1280x900", false);
    await desktop.close();

    const mobile = await browser.newContext({ ...devices["iPhone 13"] });
    await run(mobile, "iPhone 13 390x844", true);
    await mobile.close();
  } finally {
    await browser.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
