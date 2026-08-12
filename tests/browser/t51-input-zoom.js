// t51-input-zoom.js — FIX-025: no form control may compute under 16px at a
// mobile viewport, or iOS Safari zooms the page on focus and leaves it zoomed.
//
// Two halves, and the second matters as much as the first: raising text size
// can push fields out of their containers, so this also asserts nothing
// overflows, clips, or introduces horizontal scroll at 390px.
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot");

const BASE = "http://localhost:8791";
const PAGES = ["index.html", "map.html", "list.html"];
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  PASS ${n}`); } else { fail++; console.log(`  FAIL ${n} ${x}`); } };

const ROWS = [
  { permit_number: "P1", permit_status: "ACTIVE", issue_date: "2026-07-01", address: "1 N STATE", reported_cost: 1000, work_description: "x", latitude: 41.9, longitude: -87.63, contacts: [] },
];

async function stub(page) {
  await page.route("**/api/stats*", r => r.fulfill({ json: {} }));
  await page.route("**/api/profiles*", r => r.fulfill({ json: { rows: [] } }));
  await page.route("**/api/permits*", r => r.fulfill({ json: { rows: [] } }));
  await page.route("**/api/**", r => r.fulfill({ json: {} }));
  await page.route("**/data/general_contractors.json", r => r.fulfill({ json: [] }));
  await page.route("**/resource/ydr8-5enu.json*", r => r.fulfill({ json: [] }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ json: [] }));
}

// Every control, including ones inside closed drawers and dialogs.
const measure = () => Array.from(document.querySelectorAll("input, select, textarea"))
  .filter(el => !["checkbox", "radio"].includes(el.type))
  .map(el => ({
    id: el.id || `.${(el.className || "").toString().split(" ")[0]}`,
    type: el.type || el.tagName.toLowerCase(),
    font: +parseFloat(getComputedStyle(el).fontSize).toFixed(2),
    overflow: el.scrollWidth - el.clientWidth,
    right: el.getBoundingClientRect().right,
    width: el.getBoundingClientRect().width,
    visible: el.offsetParent !== null,
  }));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });

  for (const file of PAGES) {
    // ---------- mobile: the floor applies
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await stub(page);
    await page.goto(`${BASE}/${file}`);
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
    if (file === "map.html") {
      await page.waitForFunction(() => typeof state !== "undefined" && state.map && state.map.map, null, { timeout: 40000 });
      await page.evaluate(() => $("map-filter-drawer")?.classList.remove("hidden"));
    }

    // Render the on-demand dialogs too — they are created by innerHTML and were
    // absent from the first audit entirely.
    await page.evaluate(() => {
      try { if (typeof openPhotoCompose === "function") openPhotoCompose(); } catch {}
      try { if (typeof openWalkthroughDialog === "function") openWalkthroughDialog(); } catch {}
    });

    const all = await page.evaluate(measure);
    const under = all.filter(c => c.font < 16);
    ok(`[${file}] every control >= 16px (${all.length} checked)`, under.length === 0, JSON.stringify(under));

    const clipped = all.filter(c => c.visible && c.overflow > 1);
    ok(`[${file}] no control clips its own content`, clipped.length === 0, JSON.stringify(clipped));

    const vw = page.viewportSize().width;
    const spilling = all.filter(c => c.visible && c.right > vw + 0.5);
    ok(`[${file}] no control spills past the viewport`, spilling.length === 0, JSON.stringify(spilling));

    const hscroll = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }));
    ok(`[${file}] no horizontal page scroll at 390px`, hscroll.doc <= 1 && hscroll.body <= 1, JSON.stringify(hscroll));
    await ctx.close();

    // ---------- desktop: the floor is scoped to <=640px and must not leak
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const dpage = await dctx.newPage();
    await stub(dpage);
    await dpage.goto(`${BASE}/${file}`);
    await dpage.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
    if (file === "map.html") {
      await dpage.waitForFunction(() => typeof state !== "undefined" && state.map && state.map.map, null, { timeout: 40000 });
      await dpage.evaluate(() => $("map-filter-drawer")?.classList.remove("hidden"));
    }
    // Desktop keeps its denser ~13px controls — the floor is scoped to <=640px
    // and must not leak upward. NOT "no desktop control is >=16px": #dir-search
    // on list.html is 16px on desktop and always was (verified against main),
    // so that phrasing failed on correct code. Assert the controls the floor
    // would have inflated are still at the dense size.
    const dense = await dpage.evaluate(() => ["q", "sort", "map-gc-min", "map-cost-min", "focal-input", "mode-select"]
      .map(id => document.getElementById(id))
      .filter(Boolean)
      .map(el => ({ id: el.id, font: +parseFloat(getComputedStyle(el).fontSize).toFixed(2) })));
    ok(`[${file}] mobile floor does not leak to desktop (${dense.length} controls still dense)`,
      dense.length > 0 && dense.every(c => c.font < 16), JSON.stringify(dense));
    await dctx.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
