// t55-map-clear-target.js — FIX-029: the map search "clear" button is a real
// 44x44 touch target, on all three pages that carry the .map-search block.
//
// The bug: `.map-search-clear` (0-1-0) declared 32px square, 28px below 640px,
// but `.map-search button { min-width: 44px }` (0-1-1) outranked it. min-width
// therefore came from the winner while min-height came from the loser, so the
// button rendered 44x28 on mobile -- under the 44x44 minimum -- while the CSS
// claimed 28x28. Found by the specificity audit after FIX-028.
//
// Also asserts the button no longer overlaps the input's text area: it sits at
// right:6-8px and is 44px wide, so the input has to reserve >= 50-52px.
const { chromium, CHROME } = require("./_boot");

const BASE = process.env.T55_BASE || "http://localhost:8791";
const PAGES = ["index.html", "map.html", "list.html"];
const MIN = 44;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  PASS ${n}`); } else { fail++; console.log(`  FAIL ${n} ${x}`); } };

const probe = () => {
  const btn = document.querySelector(".map-search-clear");
  const inp = document.querySelector(".map-search input");
  if (!btn || !inp) return null;
  const b = btn.getBoundingClientRect(), i = inp.getBoundingClientRect();
  const ics = getComputedStyle(inp), bcs = getComputedStyle(btn);
  return {
    // list.html hides the whole search directory (`body.list-page .layout {
    // display:none }`), so the button there has NO layout box and only the
    // computed contract can be checked. It is not user-reachable on that page;
    // it exists because the .map-search block is kept identical across pages.
    laidOut: b.width > 0 && b.height > 0,
    minW: parseFloat(bcs.minWidth) || 0,
    minH: parseFloat(bcs.minHeight) || 0,
    w: +b.width.toFixed(1),
    h: +b.height.toFixed(1),
    // how far the button reaches past the padding the input reserves for it.
    // positive => the button is sitting over text.
    intrusion: +((i.right - parseFloat(ics.paddingRight)) - b.left).toFixed(1),
    inputTop: +i.top.toFixed(1), inputBottom: +i.bottom.toFixed(1),
    btnTop: +b.top.toFixed(1), btnBottom: +b.bottom.toFixed(1),
  };
};

async function run(browser, page_) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.addInitScript(() => {
    localStorage.setItem("chi_permit_lists", JSON.stringify({
      lastUsed: "t55", lists: { t55: { id: "t55", title: "t55 fixture", permits: [], created: Date.now() } },
    }));
  });
  await page.goto(`${BASE}/${page_}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body[data-ready]", { timeout: 30000 }).catch(() => {});
  // list.html renders the map inside an OPEN list; on the directory view its
  // whole ancestor chain is display:none, so the button has no layout box and
  // cannot be measured. Open a list first.
  await page.evaluate(async () => { try { await showList("t55"); } catch {} }).catch(() => {});
  // On index.html and list.html the map search is built by renderMapMode() on
  // demand -- it is not static markup there, unlike map.html. Drive the real
  // code path rather than skipping those pages: the .map-search block is
  // byte-identical across all three, so all three must be checked.
  await page.evaluate(async () => {
    if (!document.querySelector(".map-search input") && typeof renderMapMode === "function") {
      await renderMapMode();
    }
  }).catch(() => {});
  await page.waitForSelector(".map-search input", { timeout: 20000 }).catch(() => {});
  // the clear button only reveals itself once the field has content
  await page.fill(".map-search input", "4521 South Michigan Avenue").catch(() => {});
  await page.waitForTimeout(600);

  for (const [tag, w, h] of [["desktop", 1280, 900], ["mobile 390", 390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await check(page, `[${page_} ${tag}]`);
  }
  await ctx.close();
}

// Split out so both viewports reuse the SAME page -- and therefore the same
// single map initialisation -- rather than paying for a fresh one each time.
async function check(page, label) {
  const r = await page.evaluate(probe);
  if (!r) { ok(`${label} map search present`, false, "no .map-search-clear"); return; }

  // The CSS contract holds on every page, laid out or not. This is what
  // actually regresses if the selector is demoted back to a single class.
  ok(`${label} computed min-width >= ${MIN}px`, r.minW >= MIN, `${r.minW}px`);
  ok(`${label} computed min-height >= ${MIN}px`, r.minH >= MIN, `${r.minH}px`);

  if (!r.laidOut) {
    console.log(`  ${label} no layout box (search directory hidden on this page) - computed contract checked only`);
    return;
  }

  console.log(`  ${label} ${r.w}x${r.h}, intrusion ${r.intrusion}px`);
  ok(`${label} clear button renders >= ${MIN}px wide`, r.w >= MIN - 0.5, `${r.w}px`);
  ok(`${label} clear button renders >= ${MIN}px tall`, r.h >= MIN - 0.5, `${r.h}px`);
  ok(`${label} clear button does not overlap the input text area`, r.intrusion <= 0.5, `${r.intrusion}px into text`);
  // it must still fit inside the field rather than spilling out of it
  ok(`${label} clear button stays within the input's vertical bounds`,
     r.btnTop >= r.inputTop - 1 && r.btnBottom <= r.inputBottom + 1,
     `btn ${r.btnTop}-${r.btnBottom} vs input ${r.inputTop}-${r.inputBottom}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  for (const p of PAGES) await run(browser, p);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
