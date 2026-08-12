// t53 (FIX-027): icon <span>s must not render their ligature NAME as layout.
//
// `<span class="material-symbols-outlined">moon_stars</span>` shows the literal
// text "moon_stars" until the Material Symbols font arrives. At 22px that is
// ~92px wide instead of 22px, and the theme toggle is position:fixed against the
// right edge — so every cold page load on a phone briefly scrolls sideways and
// flashes icon names as words. "keyboard_double_arrow_down" measures 275px.
//
// This is what made t28 flap (its `before` sample raced the font) and t43 fail
// outright (it measures immediately after data-ready). Both were reporting a
// real product defect that had nothing to do with scroll locks or tag chips.
//
// The font is BLOCKED here rather than raced, so the pre-font state is a stable
// thing to assert against — it is also exactly what a phone on a bad connection
// renders, and what everyone sees if fonts.gstatic.com is blocked outright.
const { chromium, devices } = require("playwright");
const EXE = "C:/Users/divya/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";

const PAGES = ["index.html", "list.html", "map.html", "disclaimer.html"];
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  PASS ${n}`); } else { fail++; console.log(`  FAIL ${n} ${x}`); } };

async function open(browser, page_, mobile, blockFont) {
  const ctx = mobile
    ? await browser.newContext({ ...devices["iPhone 13"] })
    : await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  if (blockFont) {
    await page.route("**/fonts.googleapis.com/**", r => r.abort());
    await page.route("**/fonts.gstatic.com/**", r => r.abort());
  }
  await page.route("**/tile.openstreetmap.org/**", r => r.fulfill({ status: 200, contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") }));
  await page.route("**/fonts.openmaptiles.org/**", r => r.fulfill({ status: 404, body: "" }));
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [], posts: [] }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto(`http://127.0.0.1:8791/${page_}`, { waitUntil: "domcontentloaded" });
  // disclaimer.html is static and sets no data-ready flag.
  if (page_ !== "disclaimer.html") {
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  }
  await page.waitForTimeout(900);
  return { ctx, page };
}

const measure = page => page.evaluate(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const all = [...document.querySelectorAll(".material-symbols-outlined")].filter(el => {
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && el.getBoundingClientRect().width > 0;
  }).map(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    return {
      text: el.textContent.trim(), width: Math.round(r.width), right: Math.round(r.right),
      fontSize: fs, ems: +(r.width / fs).toFixed(2), display: cs.display
    };
  });
  // A display:block/flex/grid icon is sized by its CONTAINER, not by its glyph —
  // disclaimer.html has a legitimate 48px block icon in a 48px box. Measuring
  // those in ems measures the container and means nothing, so the width check
  // covers only icons that are sized by their own content and can therefore
  // push layout around.
  const inlineSized = all.filter(i => !["block", "flex", "grid"].includes(i.display));
  return {
    count: all.length,
    worstEms: inlineSized.sort((a, b) => b.ems - a.ems)[0] || null,
    pastEdge: all.filter(i => i.right > vw + 1).sort((a, b) => b.right - a.right)[0] || null,
    smallest: all.slice().sort((a, b) => a.width - b.width)[0] || null,
    scrollWidth: de.scrollWidth,
    clientWidth: vw,
    hScroll: de.scrollWidth > vw + 1
  };
});

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });

  for (const page_ of PAGES) {
    for (const mobile of [true, false]) {
      const label = `${page_} ${mobile ? "iPhone" : "desktop"}`;

      // --- the pre-font state: the bug ---
      const blocked = await open(browser, page_, mobile, true);
      const b = await measure(blocked.page);
      ok(`[${label}] no page-level horizontal scroll before the icon font loads (${b.scrollWidth}/${b.clientWidth})`,
        !b.hScroll, JSON.stringify(b.worstEms));
      // 1em is the glyph's advance width; allow slack for padding and sub-pixel
      // rounding. "moon_stars" at 22px measures 4.2em, "database_search" 6.5em,
      // "keyboard_double_arrow_down" 12.5em.
      ok(`[${label}] no icon lays out wider than its own glyph before the font loads (worst ${b.worstEms ? b.worstEms.ems : 0}em)`,
        b.worstEms ? b.worstEms.ems <= 1.6 : true, JSON.stringify(b.worstEms));
      ok(`[${label}] no icon sticks out past the right edge before the font loads`,
        !b.pastEdge, JSON.stringify(b.pastEdge));
      await blocked.ctx.close();

      // --- the normal state must be unharmed ---
      const loaded = await open(browser, page_, mobile, false);
      const l = await measure(loaded.page);
      ok(`[${label}] icons still render at their normal size once the font loads (worst ${l.worstEms ? l.worstEms.ems : 0}em)`,
        l.worstEms ? l.worstEms.ems <= 1.6 : true, JSON.stringify(l.worstEms));
      // The fix bounds the box; it must not shrink a real glyph to a sliver.
      ok(`[${label}] no icon is clipped below its own glyph width`,
        l.count > 0 && l.smallest.width >= l.smallest.fontSize * 0.9, JSON.stringify(l.smallest));
      ok(`[${label}] no horizontal scroll with the font loaded`, !l.hScroll, `${l.scrollWidth}/${l.clientWidth}`);
      await loaded.ctx.close();
    }
  }

  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (fail) { console.log(`\n  ${fail} FAILURES`); process.exit(1); }
})();
