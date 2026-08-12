// FEAT-046 ui-ux-pro-max pre-landing pass, per CLAUDE.md's standing instruction.
// t75-permit-stage.js measures contrast in whatever theme is active; this pass
// measures BOTH themes at BOTH viewports, and checks the geometry the chip could
// plausibly break — a table cell it overflows, or a row it makes scroll sideways.
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const ROWS = [
  { permit_number: "S1", address: "1 N TEST ST", permit_status: "ACTIVE", permit_milestone: "PERMIT ISSUED (FEE DUE)", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", reported_cost: 1000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S2", address: "2 N TEST ST", permit_status: "ACTIVE", permit_milestone: "INSPECTIONS", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-02", reported_cost: 2000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S3", address: "3 N TEST ST", permit_status: "ACTIVE", permit_milestone: "INSPECTIONS (CERTIFICATE OF OCCUPANCY REQUIRED)", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-03", reported_cost: 3000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S4", address: "4 N TEST ST", permit_status: "SUSPENDED", permit_milestone: "STOP WORK", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-04", reported_cost: 4000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S5", address: "5 N TEST ST", permit_status: "EXPIRED", permit_milestone: "INSPECTIONS", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-05", reported_cost: 5000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S6", address: "6 N TEST ST", permit_status: "COMPLETE", permit_milestone: "COMPLETE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-06", reported_cost: 6000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S7", address: "7 N TEST ST", permit_status: "ACTIVE", permit_milestone: "INSPECTION ELIGIBLE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-07", reported_cost: 7000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
];

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const MEASURE = () => {
  const lum = c => {
    const p = c.match(/[\d.]+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  };
  const bgOf = el => {
    let n = el;
    while (n) { const b = getComputedStyle(n).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; n = n.parentElement; }
    return getComputedStyle(document.body).backgroundColor || "rgb(255,255,255)";
  };
  return [...document.querySelectorAll(".stage")].map(el => {
    const r = el.getBoundingClientRect();
    const cell = el.closest("td") || el.parentElement;
    const cr = cell.getBoundingClientRect();
    const a = lum(getComputedStyle(el).color), b = lum(bgOf(el));
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return {
      text: el.textContent.trim(),
      ratio: +(((hi + 0.05) / (lo + 0.05)).toFixed(2)),
      overflowsCell: r.right > cr.right + 1,
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      colourOnly: el.textContent.trim().length === 0,
    };
  });
};

async function run(viewport, label) {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });
  await page.route("**/api/notes/bulk*", r => r.fulfill({ json: { threads: {}, truncated: false } }));
  await page.route("**/api/notes/counts*", r => r.fulfill({ json: { counts: {} } }));
  await page.route("**/api/contact/**", r => r.fulfill({ json: {} }));
  await openList(page);
  await seedSavedList(page, ROWS);

  for (const theme of ["light", "dark"]) {
    console.log(`\n== ${label} / ${theme} ==`);
    await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, theme);
    await page.waitForTimeout(120); // let the theme transition settle before measuring

    const chips = await page.evaluate(MEASURE);
    // Seven seeded rows, one per stage — so this pass measures every stage the
    // feature can produce, not a sample of them.
    check("all seven stages render", chips.length === 7, `${chips.length} chips`);
    const labels = [...new Set(chips.map(c => c.text))].sort();
    check("all seven distinct labels present",
      labels.join("|") === "Complete|Ended early|Fee due|Finishing|Halted|In progress|Not started",
      labels.join("|"));
    for (const c of chips) check(`contrast >= 4.5 · ${c.text}`, c.ratio >= 4.5, `${c.ratio}:1`);
    check("no chip overflows its cell", chips.every(c => !c.overflowsCell),
      JSON.stringify(chips.filter(c => c.overflowsCell).map(c => c.text)));
    check("every chip carries a text label, never colour alone", chips.every(c => !c.colourOnly));

    const hscroll = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check("no horizontal page scroll", !hscroll);

    // Chips must not be the only thing announcing state: the status word stays.
    const statusIntact = await page.$$eval(".saved-permits-table td[data-label='Status']",
      tds => tds.every(td => /ACTIVE|SUSPENDED|EXPIRED|COMPLETE/.test(td.textContent)));
    check("permit_status still present alongside the chip", statusIntact);
  }

  // Reduced motion: the chip must not animate.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const anim = await page.$$eval(".stage", els => els.map(e => getComputedStyle(e).animationName));
  check("no animation on the chip under reduced motion", anim.every(a => a === "none"), JSON.stringify(anim));

  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "desktop 1280x900");
  await run({ width: 390, height: 844 }, "iPhone 13 390x844");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
