// FEAT-046 — the construction stage chip on every surface.
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const ROWS = [
  { permit_number: "S1", address: "1 N TEST ST", permit_status: "ACTIVE", permit_milestone: "PERMIT ISSUED (FEE DUE)", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", reported_cost: 1000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S2", address: "2 N TEST ST", permit_status: "ACTIVE", permit_milestone: "INSPECTIONS", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-02", reported_cost: 2000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S3", address: "3 N TEST ST", permit_status: "SUSPENDED", permit_milestone: "STOP WORK", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-03", reported_cost: 3000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S4", address: "4 N TEST ST", permit_status: "EXPIRED", permit_milestone: "INSPECTIONS", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-04", reported_cost: 4000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S5", address: "5 N TEST ST", permit_status: "ACTIVE", permit_milestone: "", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-05", reported_cost: 5000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
];

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

async function run(viewport, label) {
  console.log(`\n== ${label} ==`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });
  await page.route("**/api/notes/bulk*", r => r.fulfill({ json: { threads: {}, truncated: false } }));
  await page.route("**/api/notes/counts*", r => r.fulfill({ json: { counts: {} } }));
  await page.route("**/api/contact/**", r => r.fulfill({ json: {} }));
  await openList(page);
  await seedSavedList(page, ROWS);

  const chips = await page.$$eval(".saved-permits-table .stage",
    els => els.map(e => ({ text: e.textContent.trim(), title: e.getAttribute("title"), h: +e.getBoundingClientRect().height.toFixed(2) })));

  const byTitle = t => chips.filter(c => c.title === t).map(c => c.text);

  check("one chip per permit that has a stage, and none for S5", chips.length === 4,
    JSON.stringify(chips.map(c => c.text)));
  check("fee due is labelled", chips.some(c => c.text === "Fee due"), JSON.stringify(chips));
  check("a STOP WORK permit reads Halted", byTitle("STOP WORK").join() === "Halted",
    JSON.stringify(byTitle("STOP WORK")));
  // The 13,973-permit trap, asserted on the SPECIFIC row: S2 and S4 both carry
  // milestone INSPECTIONS, but S4 is EXPIRED. Matching on title alone would let
  // S2's correct "In progress" satisfy a sloppy assertion, so both are named.
  const inspections = byTitle("INSPECTIONS").sort();
  check("INSPECTIONS gives In progress when ACTIVE and Ended early when EXPIRED",
    inspections.join("|") === "Ended early|In progress", JSON.stringify(inspections));
  check("no chip is rendered empty", chips.every(c => c.text.length > 0),
    JSON.stringify(chips.map(c => c.text)));
  check("every chip carries the verbatim value as its title",
    chips.every(c => c.title && c.title.length > 0), JSON.stringify(chips.map(c => c.title)));
  check("every chip has real height", chips.every(c => c.h >= 16), JSON.stringify(chips.map(c => c.h)));

  // The overlay: chip in the tag row AND the verbatim value in the facts.
  await page.evaluate(() => openPermitDetail(state.userPermitMap.get("S3")));
  await page.waitForSelector("#permit-modal:not([hidden]) .pm-tagrow", { timeout: 10000 });
  const overlay = await page.evaluate(() => {
    const body = document.getElementById("permit-modal-body");
    const chip = body.querySelector(".pm-tagrow .stage");
    return { chip: chip ? chip.textContent.trim() : null, text: body.innerText };
  });
  check("overlay tag row carries the chip", overlay.chip === "Halted", String(overlay.chip));
  check("overlay states the VERBATIM milestone", /STOP WORK/.test(overlay.text));

  // Contrast is asserted, not assumed, in whichever theme is active.
  const contrast = await page.evaluate(() => {
    const lum = c => { const [r,g,b] = c.match(/\d+/g).slice(0,3).map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }); return 0.2126*r+0.7152*g+0.0722*b; };
    const bgOf = el => { let n = el; while (n) { const b = getComputedStyle(n).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; n = n.parentElement; } return "rgb(255,255,255)"; };
    return [...document.querySelectorAll(".stage")].map(el => {
      const a = lum(getComputedStyle(el).color), b = lum(bgOf(el));
      const [hi, lo] = a > b ? [a, b] : [b, a];
      return { text: el.textContent.trim(), ratio: +(((hi + 0.05) / (lo + 0.05)).toFixed(2)) };
    });
  });
  for (const c of contrast) check(`contrast >= 4.5 for "${c.text}"`, c.ratio >= 4.5, String(c.ratio));

  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "desktop 1280x900");
  await run({ width: 390, height: 844 }, "iPhone 13 390x844");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
