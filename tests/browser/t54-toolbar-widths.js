// t54-toolbar-widths.js — FIX-028: every button in the My Permit List toolbar
// renders at the SAME width, on desktop and on mobile.
//
// The bug was two separate causes wearing one symptom:
//   desktop — buttons sized to their own label (Share 92.7px vs Optimize route
//             153.9px), because `.user-list-toolbar button { width: auto }`.
//   mobile  — the rule meant to equalize them, `.toolbar-primary > *`, scores
//             0-1-0 and LOSES to `.user-list-toolbar button` (0-1-1), so it
//             never applied at all and the buttons stayed content-sized.
//
// So this asserts equality at BOTH viewports, and separately asserts the things
// equalizing could plausibly break: touch height, no clipped labels, no
// horizontal page scroll, and that the destructive pair stays visually apart
// from the six normal actions (the whole point of keeping the gap).
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot");

const BASE = process.env.T54_BASE || "http://localhost:8791";
const URL = `${BASE}/list.html`;
const TOL = 1.0; // sub-pixel layout rounding only

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  PASS ${n}`); } else { fail++; console.log(`  FAIL ${n} ${x}`); } };

const readToolbar = () => {
  const t = document.querySelector(".user-list-toolbar");
  if (!t) return null;
  const btns = [...t.querySelectorAll("button")].filter(b => b.offsetParent !== null);
  return {
    buttons: btns.map(b => {
      const r = b.getBoundingClientRect();
      return {
        text: b.textContent.trim().replace(/\s+/g, " ").slice(0, 24),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
        top: +r.top.toFixed(1),
        right: +r.right.toFixed(1),
        // scrollWidth > clientWidth means the label is being cut off
        clipped: b.scrollWidth - b.clientWidth > 1,
        danger: b.classList.contains("danger-solid") || b.classList.contains("subtle-danger"),
      };
    }),
    hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
};

async function run(browser, tag, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  // Seed a local list and open it through the app's own showList(), so the
  // toolbar is laid out by the real code path. The Worker API is CORS-blocked
  // from localhost, so a shared-list URL cannot be used here.
  await page.addInitScript(() => {
    localStorage.setItem("chi_permit_lists", JSON.stringify({
      lastUsed: "t54",
      lists: { t54: { id: "t54", title: "t54 fixture", permits: [], created: Date.now() } },
    }));
  });
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body[data-ready]", { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => showList("t54")).catch(() => {});
  // The toolbar only exists once a list is open; wait for its buttons to lay out.
  await page.waitForFunction(
    () => [...document.querySelectorAll(".user-list-toolbar button")].filter(b => b.offsetParent !== null).length >= 8,
    { timeout: 30000 }
  ).catch(() => {});
  await page.waitForTimeout(1200);

  const r = await page.evaluate(readToolbar);
  console.log(`\n[${tag}]`);
  if (!r || r.buttons.length < 8) {
    ok(`[${tag}] toolbar rendered with 8 buttons`, false, `got ${r ? r.buttons.length : "none"}`);
    await ctx.close();
    return;
  }

  const ws = r.buttons.map(b => b.w);
  const spread = Math.max(...ws) - Math.min(...ws);
  for (const b of r.buttons) console.log(`     ${String(b.w).padStart(6)}px  ${b.danger ? "!" : " "} ${b.text}`);

  ok(`[${tag}] all ${r.buttons.length} toolbar buttons share one width`,
     spread <= TOL, `spread ${spread.toFixed(1)}px (${Math.min(...ws)}–${Math.max(...ws)})`);
  ok(`[${tag}] no button clips its own label`,
     r.buttons.every(b => !b.clipped),
     JSON.stringify(r.buttons.filter(b => b.clipped).map(b => b.text)));
  ok(`[${tag}] every button keeps a >=44px touch height`,
     r.buttons.every(b => b.h >= 43.5),
     JSON.stringify(r.buttons.filter(b => b.h < 43.5).map(b => [b.text, b.h])));
  ok(`[${tag}] no horizontal page scroll`, !r.hScroll);

  // Desktop must keep all eight on ONE row. Equal width alone is not enough:
  // the first version of this fix used a 156px floor, which was wider than any
  // desktop under 1600px could fit, so `Clear list`/`Delete list` silently
  // dropped to a second row. That is the regression this guards.
  if (/desktop/.test(tag)) {
    const rows = new Set(r.buttons.map(b => Math.round(b.top))).size;
    ok(`[${tag}] all buttons sit on a single row`, rows === 1, `${rows} rows`);
  }

  // The two destructive buttons must stay set apart from the six normal ones --
  // either on a later row, or with a clear horizontal gap. Colour alone is not
  // enough separation for a delete action.
  const danger = r.buttons.filter(b => b.danger);
  const normal = r.buttons.filter(b => !b.danger);
  ok(`[${tag}] exactly 2 destructive buttons found`, danger.length === 2, `got ${danger.length}`);
  if (danger.length === 2 && normal.length) {
    const dTop = Math.min(...danger.map(b => b.top));
    const nBottom = Math.max(...normal.map(b => b.top));
    const sameRow = Math.abs(dTop - nBottom) < 5;
    const lastNormalRight = Math.max(...normal.filter(b => Math.abs(b.top - dTop) < 5).map(b => b.right), 0);
    const firstDangerLeft = Math.min(...danger.map(b => b.right - b.w));
    const gap = sameRow ? firstDangerLeft - lastNormalRight : Infinity;
    ok(`[${tag}] destructive pair stays separated from the normal actions`,
       !sameRow || gap >= 16, sameRow ? `same row, gap only ${gap.toFixed(1)}px` : "");
  }
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  // Both desktop tiers: below 1400px uses the tighter numbers, above uses the
  // roomier ones. Each has its own chance to overflow into a second row.
  await run(browser, "desktop 1280", { viewport: { width: 1280, height: 900 } });
  await run(browser, "desktop 1440", { viewport: { width: 1440, height: 900 } });
  await run(browser, "iPhone 13", { ...devices["iPhone 13"] });
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
