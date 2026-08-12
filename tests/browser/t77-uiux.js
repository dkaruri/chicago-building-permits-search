// FEAT-048 ui-ux-pro-max pre-landing pass for the saved list's filter row.
// Both themes x both viewports, measuring the pills in ALL THREE states and the
// dropdown options — FEAT-046's pass passed while missing a broken render site
// because it measured only one place.
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const row = (n, m, s) => ({
  permit_number: n, address: `${n} N TEST ST`, permit_status: s, permit_milestone: m,
  permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", ward: "1",
  reported_cost: 1000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE",
});
const ROWS = [
  row("A1", "INSPECTIONS", "ACTIVE"), row("B1", "STOP WORK", "SUSPENDED"),
  row("C1", "COMPLETE", "COMPLETE"), row("D1", "PERMIT ISSUED (FEE DUE)", "ACTIVE"),
];

let failures = 0;
const check = (n, c, e = "") => { if (c) console.log(`  ok   ${n}`); else { failures++; console.log(`  FAIL ${n}${e ? " — " + e : ""}`); } };

const MEASURE = () => {
  const lum = c => { const p = c.match(/[\d.]+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; };
  const bgOf = el => { let n = el; while (n) { const b = getComputedStyle(n).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; n = n.parentElement; } return getComputedStyle(document.body).backgroundColor; };
  const ratio = el => { const a = lum(getComputedStyle(el).color), b = lum(bgOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return +(((hi + 0.05) / (lo + 0.05)).toFixed(2)); };
  const pills = ["filter-visited", "filter-called", "filter-followup"].map(id => {
    const el = document.getElementById(id);
    return el && !el.closest("[hidden]") ? {
      id, state: el.dataset.state || "", h: +el.getBoundingClientRect().height.toFixed(1),
      w: +el.getBoundingClientRect().width.toFixed(1), ratio: ratio(el),
      aria: el.getAttribute("aria-label") || el.textContent.trim(),
    } : null;
  }).filter(Boolean);
  const opts = [...document.querySelectorAll("#list-stage-list .tri")].map(el => ({
    h: +el.getBoundingClientRect().height.toFixed(1),
    labelRatio: ratio(el.querySelector(".tri-label")),
    countRatio: ratio(el.querySelector(".tri-count")),
    markRatio: ratio(el.querySelector(".tri-box")),
    aria: el.getAttribute("aria-label") || "",
  }));
  // FEAT-052: the <details> summary became a button opening #stage-picker.
  const summary = document.querySelector("#list-stage-btn");
  return {
    pills, opts,
    summaryH: summary ? +summary.getBoundingClientRect().height.toFixed(1) : 0,
    marker: summary ? summary.getAttribute("aria-haspopup") : null,
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
};

async function run(viewport, label) {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });
  for (const r of ["**/api/notes/bulk*", "**/api/notes/counts*", "**/api/contact/**"]) {
    await page.route(r, x => x.fulfill({ json: { threads: {}, counts: {}, truncated: false } }));
  }
  await openList(page);
  await seedSavedList(page, ROWS);
  await page.evaluate(() => { activeList().ticks = { A1: 1 }; activeList().called = { B1: "Divyam" }; renderUserList(); });
  await page.waitForTimeout(300);
  // One pill included, one excluded, so both marked states get measured.
  await page.evaluate(() => { setRowFilter("visited"); });
  await page.evaluate(() => { setRowFilter("called"); setRowFilter("called"); });
  await page.evaluate(() => openStagePicker());
  await page.waitForTimeout(300);

  for (const theme of ["light", "dark"]) {
    console.log(`\n== ${label} / ${theme} ==`);
    await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
    // NOT a fixed wait. These pages carry a 0.16s colour transition, and a
    // stopwatch lands mid-fade under load — where text and background are
    // momentarily the SAME colour and contrast reads ~1.06:1. That is the
    // theme-transition trap this repo already documented; wait for every
    // animation to stop instead.
    await page.waitForFunction(sel => {
      const els = [...document.querySelectorAll(sel), document.documentElement, document.body];
      return els.every(e => e.getAnimations().every(a => a.playState !== "running"));
    }, "#list-filters button");
    await page.waitForTimeout(60);
    const m = await page.evaluate(MEASURE);

    check("all three pills present", m.pills.length === 3, JSON.stringify(m.pills.map(p => p.id)));
    check("an included and an excluded pill are both on screen",
      m.pills.some(p => p.state === "include") && m.pills.some(p => p.state === "exclude"),
      JSON.stringify(m.pills.map(p => [p.id, p.state])));
    check("every pill >= 44px", m.pills.every(p => p.h >= 44), JSON.stringify(m.pills.map(p => p.h)));
    check("no pill stretched to full width", m.pills.every(p => p.w > 0 && p.w < viewport.width - 40), JSON.stringify(m.pills.map(p => p.w)));
    check("pill contrast >= 4.5 in every state", m.pills.every(p => p.ratio >= 4.5), JSON.stringify(m.pills.map(p => [p.state, p.ratio])));
    check("pill state is in the accessible name, not colour alone",
      m.pills.filter(p => p.id !== "filter-followup").every(p => /included|excluded|not filtered/.test(p.aria)),
      JSON.stringify(m.pills.map(p => p.aria.slice(-30))));

    check("stage options render", m.opts.length >= 3, String(m.opts.length));
    check("every option >= 44px", m.opts.every(o => o.h >= 44), JSON.stringify(m.opts.map(o => o.h)));
    check("option label contrast >= 4.5", m.opts.every(o => o.labelRatio >= 4.5), JSON.stringify(m.opts.map(o => o.labelRatio)));
    check("option count contrast >= 4.5", m.opts.every(o => o.countRatio >= 4.5), JSON.stringify(m.opts.map(o => o.countRatio)));
    check("tick/cross mark contrast >= 4.5", m.opts.every(o => o.markRatio >= 4.5), JSON.stringify(m.opts.map(o => o.markRatio)));
    check("summary header >= 44px", m.summaryH >= 44, String(m.summaryH));
    // Was "the <details> marker is suppressed"; since FEAT-052 the control is a
    // button into a modal, so what matters is that it announces the dialog.
    check("the Stage control announces that it opens a dialog",
      m.marker === "dialog", String(m.marker));
    check("no horizontal page scroll", !m.hscroll);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  const anim = await page.$$eval("#list-filters button", els => els.map(e => getComputedStyle(e).animationName));
  check("no animation on a filter control under reduced motion", anim.every(a => a === "none"), JSON.stringify(anim));
  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "desktop 1280x900");
  await run({ width: 390, height: 844 }, "iPhone 13 390x844");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
