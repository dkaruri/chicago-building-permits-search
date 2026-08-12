// FEAT-047 ui-ux-pro-max pre-landing pass. Measures the DROPDOWN specifically,
// in BOTH themes at BOTH viewports — FEAT-046's pass passed while missing a
// broken render site because it measured only one place.
const { chromium, CHROME } = require("./_boot");

const today = new Date();
const iso = d => d.toISOString().slice(0, 10);
const day = n => `${iso(new Date(today.getFullYear(), today.getMonth(), n))}T00:00:00`;
let seq = 0;
const permit = (milestone, status = "ACTIVE") => ({
  permit_: `P${++seq}`, permit_status: status, permit_milestone: milestone,
  permit_type: "PERMIT - RENOVATION", review_type: "STANDARD", issue_date: day(2),
  street_number: String(seq), street_direction: "N", street_name: "TEST ST",
  work_type: "Alteration", work_description: "x", reported_cost: "1000",
  ward: "1", community_area: "1", latitude: String(41.9 + seq / 1000), longitude: "-87.7",
});
const ROWS = [
  permit("INSPECTIONS"), permit("STOP WORK", "SUSPENDED"),
  permit("PERMIT ISSUED (FEE DUE)"), permit("INSPECTION ELIGIBLE"),
  permit("INSPECTIONS (CERTIFICATE OF OCCUPANCY REQUIRED)"),
];

let failures = 0;
const check = (n, c, e = "") => { if (c) console.log(`  ok   ${n}`); else { failures++; console.log(`  FAIL ${n}${e ? " — " + e : ""}`); } };

const MEASURE = () => {
  const lum = c => { const p = c.match(/[\d.]+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; };
  const bgOf = el => { let n = el; while (n) { const b = getComputedStyle(n).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; n = n.parentElement; } return getComputedStyle(document.body).backgroundColor; };
  const ratio = (fg, bg) => { const a = lum(fg), b = lum(bg); const [hi, lo] = a > b ? [a, b] : [b, a]; return +(((hi + 0.05) / (lo + 0.05)).toFixed(2)); };
  const rows = [...document.querySelectorAll("#map-stage-details .tri")];
  const summary = document.querySelector("#map-stage-details > summary");
  const hint = document.querySelector("#map-stage-details .tri-hint");
  const clear = hint && hint.querySelector("button");
  return {
    rows: rows.map(el => {
      const box = el.querySelector(".tri-box"), label = el.querySelector(".tri-label"), count = el.querySelector(".tri-count");
      return {
        state: el.dataset.state || "", h: +el.getBoundingClientRect().height.toFixed(1),
        labelRatio: ratio(getComputedStyle(label).color, bgOf(label)),
        countRatio: ratio(getComputedStyle(count).color, bgOf(count)),
        markRatio: ratio(getComputedStyle(box).color, bgOf(box)),
        markText: box.textContent.trim(),
        aria: el.getAttribute("aria-label") || "",
      };
    }),
    summaryH: summary ? +summary.getBoundingClientRect().height.toFixed(1) : 0,
    summaryMarker: summary ? getComputedStyle(summary).listStyleType : null,
    clearH: clear ? +clear.getBoundingClientRect().height.toFixed(1) : 0,
    clearW: clear ? +clear.getBoundingClientRect().width.toFixed(1) : 0,
    hintRatio: hint ? ratio(getComputedStyle(hint).color, bgOf(hint)) : 0,
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
};

async function run(viewport, label) {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });
  await page.route("**/data.cityofchicago.org/resource/ydr8-5enu.json**", r => r.fulfill({ json: ROWS }));
  await page.route("**/api/**", r => r.fulfill({ json: { rows: [], total: 0 } }));
  await page.goto("http://localhost:8791/map.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  await page.waitForFunction(() => (state.map.filteredRows || []).length > 0, null, { timeout: 30000 });
  // One included and one excluded, so both marked states get measured.
  await page.evaluate(() => setMapStageFilter("progress"));
  await page.waitForTimeout(300);
  await page.evaluate(() => { setMapStageFilter("halted"); setMapStageFilter("halted"); });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const d = document.getElementById("map-filter-drawer");
    if (d && d.classList.contains("hidden")) toggleMapDrawer("filters");
    document.getElementById("map-stage-details").open = true;
  });
  await page.waitForTimeout(200);

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
    }, "#map-stage-details .tri");
    await page.waitForTimeout(60);
    const m = await page.evaluate(MEASURE);

    check("options render", m.rows.length >= 4, String(m.rows.length));
    check("both an included and an excluded option are present",
      m.rows.some(r => r.state === "include") && m.rows.some(r => r.state === "exclude"),
      JSON.stringify(m.rows.map(r => r.state)));
    check("every option row >= 44px", m.rows.every(r => r.h >= 44), JSON.stringify(m.rows.map(r => r.h)));
    check("label contrast >= 4.5 everywhere", m.rows.every(r => r.labelRatio >= 4.5), JSON.stringify(m.rows.map(r => r.labelRatio)));
    check("count contrast >= 4.5 everywhere", m.rows.every(r => r.countRatio >= 4.5), JSON.stringify(m.rows.map(r => r.countRatio)));
    check("the tick/cross mark contrast >= 4.5", m.rows.every(r => r.markRatio >= 4.5), JSON.stringify(m.rows.map(r => r.markRatio)));
    check("state is never conveyed by colour alone — the accessible name says it",
      m.rows.every(r => /included|excluded|not filtered/.test(r.aria)), JSON.stringify(m.rows.map(r => r.aria.slice(-34))));
    check("summary header >= 44px", m.summaryH >= 44, String(m.summaryH));
    check("the default disclosure marker is suppressed", m.summaryMarker === "none", String(m.summaryMarker));
    check("Clear button >= 44px", m.clearH >= 44, String(m.clearH));
    check("Clear button did not stretch to full width", m.clearW > 0 && m.clearW < 200, String(m.clearW));
    check("hint text contrast >= 4.5", m.hintRatio >= 4.5, String(m.hintRatio));
    check("no horizontal page scroll", !m.hscroll);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  const anim = await page.$$eval("#map-stage-details .tri", els => els.map(e => getComputedStyle(e).animationName));
  check("no animation on an option under reduced motion", anim.every(a => a === "none"), JSON.stringify(anim));
  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "desktop 1280x900");
  await run({ width: 390, height: 844 }, "iPhone 13 390x844");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
