// t41 (FIX-014): a chip's count must sit INSIDE its bubble, on both lists.
//
// Measured geometrically, not by class name: "hangs outside the pill" is a
// layout fact. The count's box must be within the painted bounds of the element
// that carries the background/border, for Specialties exactly as for
// Associations. Asserting the markup instead would pass even if the CSS drifted
// back — which is precisely how these two diverged in the first place.
//
// A. every Specialties count is inside its bubble
// B. every Associations count is inside its bubble (the reference behaviour)
// C. both lists paint the same pill — same radius, background and border
// D. a hostile case (very long specialty, 4-digit count) stays inside the card
//    at 390px and does not force horizontal scroll
const { chromium, devices } = require("playwright");
const EXE = "C:/Users/divya/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";

const PROFILE = {
  contact_name: "CHIP TEST BUILDERS LLC", open_jobs: 9, total_jobs: 40,
  license_matches: [],
  work_types: [
    { work_type: "Nonstructural Interior Work", jobs: 9 },
    { work_type: "Reroofing", jobs: 4 },
    { work_type: "Masonry Work", jobs: 1284 },
    { work_type: "Porch Or Deck Construction And Repair Including Stairs", jobs: 3 },
  ],
};

// Rows so Associations has something to draw, in the opposite role.
const ROWS = [
  { permit_number: "1", permit_status: "ACTIVE", issue_date: "2026-01-01", address: "1 A ST",
    general_contractors: "CHIP TEST BUILDERS LLC", open_subs: "SOME ELECTRICAL CONTRACTOR COMPANY LLC" },
  { permit_number: "2", permit_status: "ACTIVE", issue_date: "2026-01-02", address: "2 A ST",
    general_contractors: "CHIP TEST BUILDERS LLC", open_subs: "SOME ELECTRICAL CONTRACTOR COMPANY LLC" },
];

const MEASURE = `
  (() => {
    const painted = el => {
      const cs = getComputedStyle(el);
      return cs.borderTopLeftRadius !== "0px" && !/rgba\\(0, 0, 0, 0\\)/.test(cs.backgroundColor);
    };
    const read = section => {
      const s = [...document.querySelectorAll("#permit-modal section.pm-block")]
        .find(x => (x.querySelector("h3") || {}).textContent === section);
      if (!s) return null;
      return [...s.querySelectorAll(".assoc-n")].map(num => {
        // The bubble is the nearest ancestor that actually paints one.
        let bubble = num.parentElement;
        while (bubble && !painted(bubble)) bubble = bubble.parentElement;
        if (!bubble) return { label: num.textContent.trim(), noBubble: true };
        const n = num.getBoundingClientRect();
        const b = bubble.getBoundingClientRect();
        const cs = getComputedStyle(bubble);
        return {
          label: num.textContent.trim(),
          // A tenth of a pixel of slack for subpixel rounding, nothing more.
          inside: n.left >= b.left - 0.1 && n.right <= b.right + 0.1 &&
                  n.top >= b.top - 0.1 && n.bottom <= b.bottom + 0.1,
          overflowRight: +(n.right - b.right).toFixed(1),
          radius: cs.borderTopLeftRadius,
          background: cs.backgroundColor,
          border: cs.borderTopWidth + " " + cs.borderTopColor,
        };
      });
    };
    const body = document.getElementById("permit-modal-body");
    return {
      specialties: read("Specialties"),
      associations: read("Associations"),
      cardOverflow: body ? body.scrollWidth > body.clientWidth + 1 : false,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()
`;

async function run(browser, file, mobile) {
  const ctx = mobile
    ? await browser.newContext({ ...devices["iPhone 13"] })
    : await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: ROWS, row_count: ROWS.length, lists: [], posts: [] }) }));
  await page.route("**/api/contact/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(PROFILE) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/" + file, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  await page.evaluate(() => openContactCard(encodeURIComponent("CHIP TEST BUILDERS LLC"), "general_contractor"));
  await page.waitForSelector("#permit-modal .pm-chiplist .assoc-n", { timeout: 10000 });
  await page.waitForTimeout(400);
  const out = await page.evaluate(MEASURE);
  if (file === "list.html" && mobile) await page.screenshot({ path: "verify-tmp/chips_mobile.png" });
  await ctx.close();
  return { label: `${file} ${mobile ? "mobile" : "desktop"}`, ...out };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const rows = [];
  for (const file of ["list.html", "index.html"]) {
    for (const mobile of [false, true]) rows.push(await run(browser, file, mobile));
  }
  const bad = [];
  for (const r of rows) {
    const spec = r.specialties || [];
    const assoc = r.associations || [];
    if (!spec.length) bad.push(`${r.label}: no Specialties chips rendered`);
    for (const c of spec) {
      if (c.noBubble) bad.push(`${r.label}: specialty "${c.label}" has no painted bubble`);
      else if (!c.inside) bad.push(`${r.label}: specialty count "${c.label}" outside its bubble by ${c.overflowRight}px`);
    }
    for (const c of assoc) {
      if (!c.noBubble && !c.inside) bad.push(`${r.label}: association count "${c.label}" outside its bubble`);
    }
    // C: the two lists must paint the SAME pill.
    if (spec.length && assoc.length) {
      for (const k of ["radius", "background", "border"]) {
        if (spec[0][k] !== assoc[0][k]) bad.push(`${r.label}: ${k} differs — specialties ${spec[0][k]} vs associations ${assoc[0][k]}`);
      }
    }
    if (r.cardOverflow) bad.push(`${r.label}: overlay scrolls horizontally`);
    if (r.pageOverflow) bad.push(`${r.label}: page scrolls horizontally`);
    console.log(`${r.label}: specialties=${spec.length} inside=${spec.filter(c => c.inside).length} | associations=${assoc.length} inside=${assoc.filter(c => c.inside).length} | radius=${(spec[0]||{}).radius}`);
  }
  bad.forEach(b => console.log("BAD " + b));
  console.log(bad.length ? `FAIL ${bad.length}` : "PASS");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
