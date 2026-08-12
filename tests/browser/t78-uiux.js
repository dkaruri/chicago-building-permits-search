// FEAT-052 — the ui-ux-pro-max pass on the folded header and the restacked
// filter row: contrast in BOTH themes, a real focus ring driven by a real Tab,
// the disclosure's semantics, and no meaning carried by colour or glyph alone.
//
// Run: node verify-tmp/t78-uiux.js   (needs :8791 serving docs/)
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const ROWS = ["A1", "A2"].map(n => ({
  permit_number: n, address: `${n} N TEST ST`, permit_status: "ACTIVE",
  permit_milestone: "INSPECTIONS", permit_type: "PERMIT - RENOVATION",
  issue_date: "2026-07-01", ward: "1", reported_cost: 1000, lat: 41.9, lon: -87.7,
}));

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

// Never a fixed delay: the theme transition is the documented trap that reported
// 4.26:1 for a colour that settles at 8.61:1.
const settle = page => page.waitForFunction(
  () => document.getAnimations().every(a => a.playState !== "running"), null, { timeout: 10000 });

const CONTRAST_PROBE = `(() => {
  // Chromium computes color-mix() to color(srgb r g b) with components in 0-1;
  // parsing those as 0-255 turns white into near-black.
  const parse = s => {
    let m = s.match(/color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)/);
    if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255];
    m = s.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  };
  const lum = ([r, g, b]) => {
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const fg = parse(getComputedStyle(el).color);
    let node = el, bg = null;
    while (node && !bg) {
      const c = getComputedStyle(node).backgroundColor;
      if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) bg = parse(c);
      node = node.parentElement;
    }
    bg = bg || [255, 255, 255];
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return { r: (a + 0.05) / (b + 0.05), size: parseFloat(getComputedStyle(el).fontSize) };
  };
  return Object.fromEntries([
    ["fold toggle", ".list-header-toggle"],
    ["row label", ".filter-line-label"],
    ["stage badge", "#list-stage-count"],
    ["stage wording", "#list-stage-words"],
    ["tally", "#list-tally"],
    ["filtered count", "#list-filter-status"],
    ["visited pill", "#filter-visited"],
  ].map(([name, sel]) => [name, ratio(sel)]));
})()`;

async function run(viewport, label) {
  console.log(`\n== ${label} ==`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.route("**/api/notes/**", r => r.fulfill({ json: { threads: {}, counts: {}, truncated: false } }));
  await openList(page);
  await seedSavedList(page, ROWS);
  // Give every probed element real text and a real state to measure.
  await page.evaluate(() => {
    activeList().ticks = { A1: 1 };
    setRowFilter("visited");
    setListStageFilter("progress");
    openStagePicker();
  });
  await settle(page);

  for (const theme of ["light", "dark"]) {
    await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
    await settle(page);
    const ratios = await page.evaluate(CONTRAST_PROBE);
    for (const [name, v] of Object.entries(ratios)) {
      if (!v) { check(`${theme}: ${name} present`, false); continue; }
      const floor = v.size >= 24 ? 3 : 4.5;
      check(`${theme}: ${name} meets ${floor}:1`, v.r >= floor, `${v.r.toFixed(2)}:1 at ${v.size}px`);
    }
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  // The picker is modal, so it traps Tab — close it before driving the keyboard
  // against the page behind it.
  await page.evaluate(() => closeStagePicker());
  await settle(page);

  // A real Tab from a known neighbour: getComputedStyle cannot take
  // :focus-visible, and .focus() may not match it at all.
  await page.focus(".back-to-dir");
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const el = document.activeElement, s = getComputedStyle(el);
    return { id: el.id, width: parseFloat(s.outlineWidth), style: s.outlineStyle };
  });
  check("the fold toggle takes focus from a real Tab and shows a ring",
    focus.id === "list-header-toggle" && focus.style !== "none" && focus.width >= 2, JSON.stringify(focus));

  const semantics = await page.evaluate(() => {
    const t = document.getElementById("list-header-toggle");
    const pill = document.getElementById("filter-visited");
    const summary = document.getElementById("list-stage-btn");
    return {
      expanded: t.getAttribute("aria-expanded"),
      controls: t.getAttribute("aria-controls"),
      controlled: !!document.getElementById(t.getAttribute("aria-controls")),
      labelText: t.textContent.replace(/[▲▼\s]/g, ""),
      pillName: pill.getAttribute("aria-label"),
      pillMark: (pill.querySelector(".mk") || {}).textContent,
      stageName: summary.getAttribute("aria-label"),
      groups: [...document.querySelectorAll("#list-filters [role=group]")].map(g => {
        const l = g.getAttribute("aria-labelledby");
        return l ? (document.getElementById(l) || {}).textContent : g.getAttribute("aria-label");
      }),
    };
  });
  check("the toggle is a disclosure, wired to a real element",
    semantics.expanded === "true" && semantics.controlled, JSON.stringify(semantics));
  check("the toggle says what it does, not just a chevron",
    semantics.labelText === "Details", `"${semantics.labelText}"`);
  check("an included pill states its state in words, not only the mark",
    /included/.test(semantics.pillName || "") && semantics.pillMark === "✓", JSON.stringify(semantics));
  check("the stage badge's count is backed by wording in its accessible name",
    /included/.test(semantics.stageName || ""), semantics.stageName);
  check("both filter lines are named groups",
    semantics.groups.includes("Permit") && semantics.groups.includes("Your activity"), JSON.stringify(semantics.groups));

  const noZoom = await page.evaluate(() => [...document.querySelectorAll("#list-filters button, #list-filters summary, .list-header-toggle")]
    .map(e => parseFloat(getComputedStyle(e).fontSize)).filter(s => s < 11.5));
  check("no filter control uses type under 11.5px", noZoom.length === 0, JSON.stringify(noZoom));

  await page.screenshot({ path: `verify-tmp/t78-uiux-${label.replace(/\W/g, "")}.png` });
  await ctx.close();
  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "desktop 1280x900");
  await run({ width: 390, height: 844 }, "iPhone 13 390x844");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
