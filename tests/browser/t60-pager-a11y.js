// t60 — FEAT-035 accessibility pass on the saved-list pager.
// Contrast measured live in BOTH themes, a real Tab for the focus ring, and the
// reduced-motion path. Each probe carries a control that poisons the value on
// purpose, because a probe that has never reported a failure has not been shown
// to be able to.

const { devices } = require("playwright");
const { chromium, CHROME, openList, seedSavedList } = require("./_boot.js");

let failures = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
};

const rows = n => Array.from({ length: n }, (_, i) => ({
  permit_number: `10${String(100000 + i)}`, permit_type: "PERMIT - RENOVATION",
  permit_status: "ACTIVE", issue_date: "2026-01-15", address: `${1000 + i} W Fullerton Ave`,
  work_type: "RENOVATION", ward: "32", reported_cost: 125000,
  latitude: 41.9 + i * 0.001, longitude: -87.65 - i * 0.001,
}));

// Chromium computes color-mix() to `color(srgb r g b / a)` with components in
// 0-1; parsing those as 0-255 turns white into near-black and invents failures.
const COLOR_PROBE = `
  function parseColor(s) {
    s = String(s).trim();
    let m = s.match(/^color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\)$/);
    if (m) return [ +m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : +m[4] ];
    m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
    return [ p[0], p[1], p[2], p.length > 3 ? p[3] : 1 ];
  }
  function over(fg, bg) {
    const a = fg[3];
    return [0,1,2].map(i => fg[i] * a + bg[i] * (1 - a)).concat(1);
  }
  function lum(c) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function ratio(fg, bg) {
    const a = lum(fg), b = lum(bg);
    return (Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05);
  }
  // Walk up for the first opaque background, compositing translucent layers.
  function bgOf(el) {
    let stack = [], n = el;
    while (n && n !== document.documentElement.parentNode) {
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) { stack.push(c); if (c[3] === 1) break; }
      n = n.parentElement;
    }
    let base = [255,255,255,1];
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  }
  function contrastOf(el) {
    const fg = parseColor(getComputedStyle(el).color);
    const bg = bgOf(el);
    return ratio(over(fg, bg), bg);
  }
`;

async function settle(page) {
  await page.waitForFunction(
    () => [...document.querySelectorAll("*")].every(e => e.getAnimations().every(a => a.playState !== "running")),
    null, { timeout: 5000 },
  ).catch(() => {});
}

async function run(label, contextOpts) {
  console.log(`\n### ${label}`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  await page.route("**/api/notes/counts**", r => r.fulfill({ json: { counts: {} } }));
  await openList(page);
  await seedSavedList(page, rows(250));
  await page.evaluate(`(() => { ${COLOR_PROBE}; window._probe = { contrastOf, parseColor }; })()`);

  for (const theme of ["light", "dark"]) {
    await page.evaluate(t => setTheme(t), theme);
    // A theme swap TRANSITIONS the colour; reading mid-flight reported 4.26:1
    // for a colour that settles at 8.61:1 on FEAT-031.
    await settle(page);
    await page.evaluate(`(() => { ${COLOR_PROBE}; window._probe = { contrastOf, parseColor }; })()`);
    const c = await page.evaluate(() => {
      const cur = document.querySelector('#user-list-pager-top [aria-current="page"]');
      const other = [...document.querySelectorAll("#user-list-pager-top .pager-page")].find(b => b !== cur);
      const status = document.querySelector("#user-list-pager-top .small");
      return {
        current: window._probe.contrastOf(cur),
        other: window._probe.contrastOf(other),
        status: window._probe.contrastOf(status),
      };
    });
    ok(`${theme}: current page ${c.current.toFixed(2)}:1`, c.current >= 4.5);
    ok(`${theme}: other page numbers ${c.other.toFixed(2)}:1`, c.other >= 4.5);
    ok(`${theme}: the "Page N of M" status ${c.status.toFixed(2)}:1`, c.status >= 4.5);
  }

  // Control: the probe must still be able to report a failure. transition:none
  // so the poisoned value is not itself measured mid-flight.
  const poisoned = await page.evaluate(() => {
    const cur = document.querySelector('#user-list-pager-top [aria-current="page"]');
    cur.style.transition = "none";
    cur.style.background = "#7a7a7a";
    cur.style.color = "#808080";
    return window._probe.contrastOf(cur);
  });
  ok(`control: a deliberately poisoned colour reads as failing (${poisoned.toFixed(2)}:1)`, poisoned < 4.5);
  await page.evaluate(() => { const c = document.querySelector('#user-list-pager-top [aria-current="page"]'); c.style.background = ""; c.style.color = ""; c.style.transition = ""; });

  // Focus ring: getComputedStyle(el, ":focus-visible") does not work (it takes
  // pseudo-ELEMENTS), so drive a real Tab and read the active element.
  // A real Tab from a known neighbour, not .focus(): programmatic focus may not
  // match :focus-visible at all, and this also proves the control is genuinely
  // in the tab order.
  await page.evaluate(() => document.querySelector("#user-list-note").focus());
  let focus = null;
  for (let i = 0; i < 12 && !focus; i += 1) {
    await page.keyboard.press("Tab");
    focus = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el.closest("#user-list-pager-top")) return null;
      const s = getComputedStyle(el);
      return { tag: el.tagName, label: el.textContent.trim(), outline: s.outlineWidth, style: s.outlineStyle, shadow: s.boxShadow };
    });
  }
  ok("tabbing reaches a pager control", focus !== null);
  focus = focus || { outline: "0px", style: "none", shadow: "none" };
  const hasRing = (parseFloat(focus.outline) > 0 && focus.style !== "none") || (focus.shadow && focus.shadow !== "none");
  ok("a focused pager control shows a focus ring", hasRing, JSON.stringify(focus));

  const tabbable = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#user-list-pager-top button")];
    return btns.filter(b => b.tabIndex < 0).length;
  });
  ok("every pager control is reachable by keyboard", tabbable === 0, `${tabbable} out of the tab order`);

  // Changing page must not animate a long scroll — restoring a position is not
  // a navigation, and it must behave the same under prefers-reduced-motion.
  await ctx.close();
  const rmCtx = await browser.newContext({ ...contextOpts, reducedMotion: "reduce" });
  const rm = await rmCtx.newPage();
  await rm.route("**/api/notes/counts**", r => r.fulfill({ json: { counts: {} } }));
  await openList(rm);
  await seedSavedList(rm, rows(250));
  const moved = await rm.evaluate(async () => {
    await setListPage(1);
    return { page: state.listPage, first: document.querySelector(".list-ordinal")?.textContent.trim() };
  });
  ok("paging works under prefers-reduced-motion", moved.page === 1 && moved.first === "101", JSON.stringify(moved));
  // NOT "no animations": the page's global reduce block sets
  // `animation-duration: 0.01ms !important` rather than removing animations, so
  // they still exist — they just finish instantly. Asserting a count of zero
  // reported a clean failure for correct code (and passed on mobile only
  // because the 0.01ms animations had already ended by the time it looked).
  // What matters is that none of them has a perceptible duration.
  const longest = await rm.evaluate(() => Math.max(0, ...[...document.querySelectorAll("*")]
    .flatMap(e => e.getAnimations())
    .map(a => (a.effect && a.effect.getTiming().duration) || 0)));
  ok("...and no animation it starts has a perceptible duration", longest <= 1, `longest ${longest}ms`);

  await browser.close();
}

(async () => {
  await run("desktop 1280x800", { viewport: { width: 1280, height: 800 } });
  await run("iPhone 13", { ...devices["iPhone 13"] });
  console.log(failures ? `\n${failures} FAILURES` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
