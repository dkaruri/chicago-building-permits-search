// FEAT-046 — verifies the final review's Fix 1 at the site the ui-ux pass missed.
// `.map-result span` (0-1-1) used to outrank `.stage` (0-1-0), flattening the map
// side-list chip to a full-width grey block. Measures the chip AS RENDERED in the
// map result rail: it must be inline-flex, narrow, and one distinct colour per stage.
const { chromium, CHROME } = require("./_boot");

const MONTH = [
  { permit_: "M1", permit_status: "ACTIVE", permit_milestone: "PERMIT ISSUED (FEE DUE)", permit_type: "PERMIT - RENOVATION", review_type: "STANDARD", issue_date: "2026-08-03T00:00:00", street_number: "1", street_direction: "N", street_name: "TEST ST", work_type: "Alteration", work_description: "x", reported_cost: "1000", ward: "1", community_area: "1", latitude: "41.9", longitude: "-87.7" },
  { permit_: "M2", permit_status: "ACTIVE", permit_milestone: "INSPECTIONS", permit_type: "PERMIT - RENOVATION", review_type: "STANDARD", issue_date: "2026-08-04T00:00:00", street_number: "2", street_direction: "N", street_name: "TEST ST", work_type: "Alteration", work_description: "x", reported_cost: "2000", ward: "1", community_area: "1", latitude: "41.9", longitude: "-87.7" },
  { permit_: "M3", permit_status: "ACTIVE", permit_milestone: "INSPECTIONS (CERTIFICATE OF OCCUPANCY REQUIRED)", permit_type: "PERMIT - RENOVATION", review_type: "STANDARD", issue_date: "2026-08-05T00:00:00", street_number: "3", street_direction: "N", street_name: "TEST ST", work_type: "Alteration", work_description: "x", reported_cost: "3000", ward: "1", community_area: "1", latitude: "41.9", longitude: "-87.7" },
  { permit_: "M4", permit_status: "SUSPENDED", permit_milestone: "STOP WORK", permit_type: "PERMIT - RENOVATION", review_type: "STANDARD", issue_date: "2026-08-06T00:00:00", street_number: "4", street_direction: "N", street_name: "TEST ST", work_type: "Alteration", work_description: "x", reported_cost: "4000", ward: "1", community_area: "1", latitude: "41.9", longitude: "-87.7" },
];

let failures = 0;
const check = (n, c, e = "") => { if (c) console.log(`  ok   ${n}`); else { failures++; console.log(`  FAIL ${n}${e ? " — " + e : ""}`); } };

(async () => {
  for (const [vp, label] of [[{ width: 1280, height: 900 }, "desktop"], [{ width: 390, height: 844 }, "iPhone 13"]]) {
    const browser = await chromium.launch({ executablePath: CHROME });
    const page = await browser.newPage({ viewport: vp });
    await page.route("**/data.cityofchicago.org/resource/ydr8-5enu.json**", r => r.fulfill({ json: MONTH }));
    await page.route("**/api/**", r => r.fulfill({ json: { rows: [], total: 0 } }));
    await page.goto("http://localhost:8791/map.html");
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
    await page.waitForSelector(".map-result .stage", { timeout: 20000 }).catch(() => {});

    for (const theme of ["light", "dark"]) {
      await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(120);
      const chips = await page.evaluate(() => [...document.querySelectorAll(".map-result .stage")].map(el => {
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        return { text: el.textContent.trim(), display: cs.display, colour: cs.color, w: +r.width.toFixed(1) };
      }));
      console.log(`\n== map side list / ${label} / ${theme} ==`);
      check("chips present", chips.length >= 3, `${chips.length}`);
      check("chip is inline-flex, not a full-width block",
        chips.every(c => c.display === "inline-flex"), JSON.stringify(chips.map(c => c.display)));
      check("chip is narrow, not stretched across the row",
        chips.every(c => c.w > 0 && c.w < 200), JSON.stringify(chips.map(c => c.w)));
      const colours = new Set(chips.map(c => c.colour));
      check("each stage keeps its OWN colour (not all one grey)",
        colours.size === chips.length, `${colours.size} distinct for ${chips.length} chips: ${[...colours].join(" / ")}`);
    }
    await browser.close();
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
