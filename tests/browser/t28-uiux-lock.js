// FIX-010 ui-ux-pro-max pass. The new lock takes body out of flow, which is the
// classic source of two regressions:
//   1. layout shift (CLS) when the desktop scrollbar disappears
//   2. content losing its safe-area / gutter insets while fixed
// Also re-checks that fixed chrome (.theme-toggle) does not move, that nothing
// gains a horizontal scrollbar, and that focus returns to the trigger on close.
const { chromium, devices } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

const ROW = {
  permit_number: "100999888", permit_status: "OPEN", permit_type: "PERMIT - RENOVATION/ALTERATION",
  issue_date: "2026-05-01", address: "123 N TEST ST", ward: "27", reported_cost: "125000",
  total_fee: "900", work_description: "INTERIOR ALTERATIONS 3 UNITS", work_type: "ALTERATION",
  review_type: "STANDARD PLAN REVIEW", community_area: "WEST TOWN", processing_time: "12",
  general_contractors: ["ACME BUILDERS"], open_subs: ["SPARKY ELECTRIC"],
};

const probe = () => {
  const main = document.getElementById("main-content");
  const toggle = document.querySelector(".theme-toggle");
  const r = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width) }; };
  return {
    main: r(main),
    toggle: toggle ? r(toggle) : null,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    bodyPadLeft: getComputedStyle(document.body).paddingLeft,
  };
};

async function run(page, url, label, theme) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.hasAttribute("data-ready"), null, { timeout: 20000 });
  await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
  await page.evaluate(() => {
    const d = document.createElement("div"); d.style.height = "3000px"; document.body.appendChild(d);
    window.scrollTo(0, 300);
    // Give focus to a real trigger so the restore is observable.
    document.querySelector("button, a")?.focus();
  });
  const before = await page.evaluate(probe);
  const focusBefore = await page.evaluate(() => document.activeElement.tagName + "|" + (document.activeElement.className || ""));

  await page.evaluate(row => openPermitDetail(row), ROW);
  await page.waitForTimeout(400);
  const during = await page.evaluate(probe);

  await page.evaluate(() => document.querySelector(".pm-close").click());
  await page.waitForTimeout(400);
  const after = await page.evaluate(probe);
  const focusAfter = await page.evaluate(() => document.activeElement.tagName + "|" + (document.activeElement.className || ""));

  return {
    label: `${label} ${theme}`,
    shiftOnOpen: Math.abs(during.main.x - before.main.x) + Math.abs(during.main.w - before.main.w),
    shiftOnClose: Math.abs(after.main.x - before.main.x) + Math.abs(after.main.w - before.main.w),
    toggleMoved: before.toggle && during.toggle ? Math.abs(during.toggle.x - before.toggle.x) : 0,
    hScroll: [before.hScroll, during.hScroll, after.hScroll],
    padLeft: [before.bodyPadLeft, during.bodyPadLeft],
    focusRestored: focusBefore === focusAfter,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const out = [];
  for (const dev of ["iPhone 13", "desktop"]) {
    const ctx = dev === "desktop"
      ? await browser.newContext({ viewport: { width: 1280, height: 900 } })
      : await browser.newContext({ ...devices[dev] });
    const page = await ctx.newPage();
    await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
    await page.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 1, cached_at: "2026-07-28" }) }));
    await page.route("**/api/contact/**", r => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
    await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
    for (const p of ["list.html", "index.html"]) {
      for (const theme of ["light", "dark"]) {
        out.push(await run(page, "http://127.0.0.1:8791/" + p, `${dev} ${p}`, theme));
      }
    }
    await ctx.close();
  }
  for (const r of out) console.log(JSON.stringify(r));
  const bad = out.filter(r =>
    r.shiftOnOpen > 1 || r.shiftOnClose > 1 || r.toggleMoved > 1 ||
    r.hScroll.some(Boolean) || r.padLeft[0] !== r.padLeft[1] || !r.focusRestored);
  console.log(bad.length ? `FAIL ${bad.length}` : "PASS");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
