// FIX-044 — a dollar figure must never break mid-number.
//
// The defect: `th, td { overflow-wrap: anywhere }` applies to every table cell,
// including the Cost column, which is 10% of a `table-layout: fixed` table. At
// 1280px that is ~73px, so "$408,680" renders as "$408,68" / "0" — a different
// number at a glance.
//
// The probe measures LINE BOXES, not geometry: a Range over the cell's text
// node reports one client rect per line box, so `> 1` is literally "this text
// wrapped". Geometry assertions (no clipping, no h-scroll) are blind to this —
// that is the whole reason the bug shipped (see FIX-027).
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot.js");

// 8791, not 8792. `run.js` serves 8791 (the port the Worker's ALLOWED_ORIGIN
// names), so an 8792 default made this the one suite in the tracked set that
// could never pass under the runner: it died on ERR_CONNECTION_REFUSED at the
// first goto, before a single assertion, and reported as a product failure.
// Green in isolation only if you happened to have something on 8792. Found by
// FIX-039's regression sweep; the default has been wrong since FIX-020 tracked
// this file (e12749e).
const PORT = process.env.PORT || 8791;
// Same convention as t80/t81: BASE=<pages url> drives the DEPLOYED site so a
// card can be closed against what users actually load, not against the build.
// The /api mocks below still apply — Playwright intercepts regardless of origin
// — so the rows stay deterministic while the CSS under test is the live one.
const BASE = process.env.BASE || `http://localhost:${PORT}`;
const TOTAL = 40868;

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

// A deliberately hostile row: the widest realistic cost, a long unbroken
// work-type token that MUST still wrap, and a real-shaped permit number.
const permitAt = i => ({
  permit_number: `100${String(i).padStart(6, "0")}`,
  permit_status: "OPEN - IN PROGRESS", permit_type: "PERMIT - RENOVATION/ALTERATION",
  review_type: "STANDARD PLAN REVIEW", issue_date: "2026-01-01", processing_time: 5,
  address: `${1000 + i} W IRVING PARK RD`,
  work_type: "RESIDENTIALCONSTRUCTIONALTERATIONWORK",
  // Row 0 carries the widest figure the dataset actually holds — max
  // reported_cost over open permits was $730,000,000 on 2026-08-11 (Socrata).
  // The column is sized from that number, so the test must contain it or it
  // measures a requirement nobody has.
  work_description: "work", reported_cost: i === 0 ? 730000000 : 408680 + i, total_fee: 12500,
  ward: 1, community_area: 1, latitude: 41.9, longitude: -87.7,
  general_contractors: "ACME", open_subs: "", contacts: []
});

async function open(page) {
  await page.route("**/api/stats*", r => r.fulfill({ json: { row_count: TOTAL, contractors: 5793, subs: 7432, exported: "2026-08-11" } }));
  await page.route("**/api/profiles*", r => r.fulfill({ json: { category: "gc", rows: [], total: 0, offset: 0, limit: 50 } }));
  await page.route("**/api/permits*", r => {
    const u = new URL(r.request().url());
    const offset = parseInt(u.searchParams.get("offset") || "0");
    const limit = parseInt(u.searchParams.get("limit") || "150");
    const rows = Array.from({ length: Math.min(limit, 20) }, (_, i) => permitAt(offset + i));
    r.fulfill({ json: { rows, row_count: rows.length, total: TOTAL, offset, limit, sort: "", dir: "desc" } });
  });
  await page.goto(`${BASE}/index.html`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });
  await page.evaluate(async () => { setMode("open_permits"); await search(); });
  await page.waitForSelector(".permits-table tbody tr", { timeout: 15000 });
}

// One evaluate: line-box count + the text, for every cell matching `sel`.
// A second round trip is always a chance for layout to move under us.
const lines = (page, sel) => page.evaluate(sel => {
  const out = [];
  for (const cell of document.querySelectorAll(sel)) {
    // Measure the deepest text-bearing node so a <br>-separated sibling in the
    // same cell is not miscounted as a wrap of the value under test.
    const target = cell.firstChild && cell.firstChild.nodeType === 3 ? cell.firstChild : cell;
    const node = target.nodeType === 3 ? target : (target.firstChild || target);
    if (!node || !node.textContent.trim()) continue;
    const r = document.createRange();
    r.selectNodeContents(node);
    out.push({ text: node.textContent.trim(), lines: r.getClientRects().length, width: cell.getBoundingClientRect().width });
  }
  return out;
}, sel);

async function run(label, ctxOpts, shot) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await open(page);

  // --- 1. the money cell never breaks inside a figure ---------------------
  const money = await lines(page, ".permits-table tbody td.money");
  check("every Cost cell rendered", money.length >= 10, `${money.length} cells`);
  const wrapped = money.filter(m => m.lines > 1);
  check("no dollar figure wraps mid-number",
    wrapped.length === 0,
    wrapped.length ? `${wrapped.length}/${money.length} wrapped, e.g. ${JSON.stringify(wrapped[0])}` : `all 1 line, col ${money[0] && money[0].width.toFixed(1)}px`);

  // --- 2. the whole figure is actually readable, not clipped --------------
  const clipped = await page.evaluate(() => {
    const bad = [];
    for (const c of document.querySelectorAll(".permits-table tbody td.money")) {
      // scrollWidth > clientWidth with overflow hidden/visible means the text
      // does not fit its box; a value the user cannot fully see is no better
      // than one split in half.
      if (c.scrollWidth > c.clientWidth + 1) bad.push({ text: c.textContent.trim(), sw: c.scrollWidth, cw: c.clientWidth });
    }
    return bad;
  });
  check("no Cost cell overflows its column", clipped.length === 0, JSON.stringify(clipped.slice(0, 2)));

  // --- 3. permit numbers, the same class of break -------------------------
  const permits = await page.evaluate(() => {
    const out = [];
    for (const s of document.querySelectorAll(".permits-table tbody td[data-label='Permit'] strong")) {
      const r = document.createRange(); r.selectNodeContents(s);
      out.push({ text: s.textContent.trim(), lines: r.getClientRects().length });
    }
    return out;
  });
  const permitWrapped = permits.filter(p => p.lines > 1);
  check("no permit number wraps mid-number",
    permits.length > 0 && permitWrapped.length === 0,
    permitWrapped.length ? JSON.stringify(permitWrapped[0]) : `${permits.length} checked`);

  // --- 4. the date column too ---------------------------------------------
  const issued = await lines(page, ".permits-table tbody td[data-label='Issued']");
  const issuedWrapped = issued.filter(d => d.lines > 1);
  check("no issued date wraps mid-date", issuedWrapped.length === 0, JSON.stringify(issuedWrapped[0] || {}));

  // --- 5. long PROSE must still wrap — the fix must not turn into nowrap ---
  const work = await page.evaluate(() => {
    const s = document.querySelector(".permits-table tbody td[data-label='Address'] span.small");
    if (!s) return null;
    const r = document.createRange(); r.selectNodeContents(s);
    return { text: s.textContent.trim(), lines: r.getClientRects().length, cell: s.closest("td").getBoundingClientRect().width };
  });
  check("a long unbroken work-type token still wraps rather than escaping its cell",
    work && work.lines > 1, JSON.stringify(work));

  // --- 6. and it must not have bought that with a horizontal scrollbar ----
  const hscroll = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    body: document.body.scrollWidth > document.body.clientWidth + 1,
    table: (() => { const w = document.querySelector(".table-wrap, .results-wrap"); return w ? w.scrollWidth > w.clientWidth + 1 : false; })(),
  }));
  check("no horizontal page scroll", !hscroll.doc && !hscroll.body, JSON.stringify(hscroll));

  // --- 7. the control: prove this probe CAN report a wrap -----------------
  // Force `anywhere` back onto the money cell. If the probe still says "1
  // line", it is measuring nothing and every PASS above is worthless.
  // The width is pinned as well as the wrap mode: at the mobile stacked layout
  // the cell is 318px wide, where `break-all` alone has nothing to break and
  // the control reported a false "cannot detect a wrap" on a working probe.
  const control = await page.evaluate(() => {
    const st = document.createElement("style");
    // The header cell has to be narrowed too: under `table-layout: fixed` the
    // column width comes from the FIRST row, so narrowing only the tbody cell
    // left the column at 102px and the control reported a false negative on a
    // probe that was working.
    st.textContent =
      ".permits-table th:nth-child(6) { width: 40px !important; }" +
      ".permits-table tbody td.money { overflow-wrap: anywhere !important; word-break: break-all !important; white-space: normal !important; width: 40px !important; max-width: 40px !important; }";
    document.head.appendChild(st);
    const c = document.querySelector(".permits-table tbody td.money");
    const r = document.createRange(); r.selectNodeContents(c.firstChild || c);
    const n = r.getClientRects().length;
    st.remove();
    return { lines: n, text: c.textContent.trim() };
  });
  check("CONTROL — the probe reports a wrap when one is forced", control.lines > 1, JSON.stringify(control));

  // --- 7b. the column is sized for TODAY's maximum; nowrap owns tomorrow's -
  // 108px holds $730,000,000, the widest figure in the dataset on 2026-08-11.
  // If a bigger permit is ever filed the column will be too narrow, and the
  // failure mode must be "visibly too wide", never "silently a different
  // number". That is the property `white-space: nowrap` owns, and the only
  // case that distinguishes it from the width — so it is asserted directly.
  const overflowingFigure = await page.evaluate(() => {
    const td = document.querySelector(".permits-table tbody td.money");
    const orig = td.textContent;
    td.textContent = "$7,300,000,000";                      // 10x the real max
    const r = document.createRange(); r.selectNodeContents(td.firstChild);
    const out = { lines: r.getClientRects().length, width: +r.getBoundingClientRect().width.toFixed(1), col: +td.getBoundingClientRect().width.toFixed(1) };
    td.textContent = orig;
    return out;
  });
  check("a figure too wide for the column overflows rather than splitting",
    overflowingFigure.lines === 1, JSON.stringify(overflowingFigure));

  // --- 7c. a number must stay inside its OWN column -----------------------
  // `white-space: nowrap` stops a figure splitting, but on its own it just
  // trades a split for a spill: measured at 900px the Permit column was 43px
  // holding 67px of digits, which painted "100000000OPE" across the Status
  // cell. The 640px floor on `.results-table` is what keeps the columns their
  // real size; `.table-wrap` is already `overflow: auto`, so the TABLE
  // scrolls instead of the columns collapsing.
  const spills = await page.evaluate(() => {
    const bad = [];
    for (const cell of document.querySelectorAll(".permits-table tbody td.money, .permits-table tbody td[data-label='Issued'], .permits-table tbody td[data-label='Permit'] strong")) {
      const td = cell.closest("td");
      const box = td.getBoundingClientRect();
      // The CONTENT edge, not the border edge: text that has eaten the cell's
      // padding is already touching its neighbour. Comparing against
      // `box.right` (and, in the first draft, `box.right - 1`) reported a spill
      // for text sitting legally 0.9px inside the padding.
      const contentRight = box.right - parseFloat(getComputedStyle(td).paddingRight || 0);
      const r = document.createRange(); r.selectNodeContents(cell.firstChild || cell);
      const t = r.getBoundingClientRect();
      if (t.width && t.right > contentRight + 1) bad.push({ text: cell.textContent.trim().slice(0, 20), textRight: +t.right.toFixed(1), contentRight: +contentRight.toFixed(1) });
    }
    return bad;
  });
  check("no number spills out of its own column into the next one",
    spills.length === 0, spills.length ? `${spills.length} spilling, e.g. ${JSON.stringify(spills[0])}` : "checked money, issued and permit");

  // --- 8. the OTHER nine `overflow-wrap: anywhere` rules ------------------
  // The card asks whether the same class of break lives elsewhere. Rather than
  // reading the nine rules and reasoning about each, sweep the rendered page:
  // any element whose entire text is a currency figure or a permit number must
  // occupy one line box. This covers the permit overlay's fact list and chips,
  // where `.permit-fact-value`, `.pm-chiplist .chip > span` and `.assoc > span`
  // all inherit `anywhere` too.
  // The table screenshot is taken FIRST — the overlay covers the rows it is
  // the evidence for. Scroll it into view: at 390px the table sits well below
  // the fold and the first version of this shot was a picture of the header,
  // which is no evidence of anything.
  await page.evaluate(() => document.querySelector(".permits-table").scrollIntoView({ block: "start" }));
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"), null, { timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: `verify-tmp/${shot}`, fullPage: false });
  console.log(`   screenshot → verify-tmp/${shot}  (LOOK at it — assertions are blind to typography)`);
  await page.evaluate(() => openPermitDetail(state.filteredRows[0]));
  await page.waitForSelector(".pm-card, .permit-facts, #permit-modal", { timeout: 15000 });
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"), null, { timeout: 8000 }).catch(() => {});
  const sweep = await page.evaluate(() => {
    const NUMERIC = /^\$[\d,]+$|^\d{6,}$/;
    const bad = []; let seen = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (el.children.length) continue;                     // leaf nodes only
      const text = el.textContent.trim();
      if (!NUMERIC.test(text)) continue;
      if (!el.getClientRects().length) continue;            // hidden
      seen++;
      const r = document.createRange(); r.selectNodeContents(el);
      const n = r.getClientRects().length;
      if (n > 1) bad.push({ text, lines: n, sel: el.className || el.tagName });
    }
    return { bad, seen };
  });
  // A sweep that found nothing to examine is not a pass — it is a vacuous
  // assertion. Assert the candidate count as well as the verdict.
  check("the numeric sweep actually found numbers to examine", sweep.seen >= 20, `${sweep.seen} candidates`);
  check("no currency figure or permit number anywhere on the page wraps",
    sweep.bad.length === 0,
    sweep.bad.length ? JSON.stringify(sweep.bad.slice(0, 3)) : `${sweep.seen} numeric leaves, overlay open`);

  const overlayShot = shot.replace(".png", "-overlay.png");
  await page.screenshot({ path: `verify-tmp/${overlayShot}`, fullPage: false });
  console.log(`   screenshot → verify-tmp/${overlayShot}`);
  await browser.close();
}

(async () => {
  await run("desktop 1280x900", { viewport: { width: 1280, height: 900 } }, "t82-desktop.png");
  // 760px is the narrowest the table is still a REAL table — the stacked
  // layout starts at 640px. Every column is at its tightest here, which is
  // where a number is most likely to split, and the 1280-only suite could not
  // see it.
  await run("narrow desktop 760x900", { viewport: { width: 760, height: 900 } }, "t82-narrow.png");
  await run("iPhone 13", { ...devices["iPhone 13"] }, "t82-iPhone13.png");
  console.log(failures ? `\n${failures} FAILURES` : "\nALL GREEN");
  process.exit(failures ? 1 : 0);
})();
