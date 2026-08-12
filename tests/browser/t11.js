// t11: the permit detail overlay must fill the VIEWPORT on mobile, not the
// document. Regression guard for the `body { animation: pageIn ... both }`
// leftover transform, which made body the containing block for the
// position:fixed overlay — backdrop covered the page, card centered far below
// the fold. Fails if any ancestor of #permit-modal ever regains a transform.
const { chromium, devices } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

const ROW = {
  permit_number: "100999888", permit_status: "OPEN", permit_type: "PERMIT - RENOVATION/ALTERATION",
  issue_date: "2026-05-01", address: "123 N TEST ST", ward: "27", reported_cost: "125000",
  total_fee: "900", work_description: "INTERIOR ALTERATIONS 3 UNITS", work_type: "ALTERATION",
  review_type: "STANDARD PLAN REVIEW", community_area: "WEST TOWN", processing_time: "12",
  general_contractors: ["ACME BUILDERS"], open_subs: ["SPARKY ELECTRIC"],
};

async function check(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return page.evaluate(row => {
    // Scroll down first — the bug only shows once the document is taller than
    // the viewport and the page is scrolled away from the top.
    window.scrollTo(0, 240);
    openPermitDetail(row);
    const m = document.getElementById("permit-modal");
    const r = el => el.getBoundingClientRect();
    const modal = r(m), card = r(m.querySelector(".permit-modal-card"));
    let transformed = null;
    for (let n = m.parentElement; n; n = n.parentElement) {
      if (getComputedStyle(n).transform !== "none") { transformed = n.tagName; break; }
    }
    return {
      modalFillsViewport: Math.abs(modal.height - innerHeight) < 2 && Math.abs(modal.top) < 2,
      // card top may be a few px off mid rise-animation; must be on screen.
      cardOnScreen: card.top > -20 && card.top < innerHeight / 2,
      transformedAncestor: transformed,
      dims: { vh: innerHeight, modalH: Math.round(modal.height), cardTop: Math.round(card.top) },
    };
  }, ROW);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));

  const out = {};
  for (const p of ["list.html", "index.html"]) out[p] = await check(page, "http://127.0.0.1:8791/" + p);
  const ok = Object.values(out).every(v => v.modalFillsViewport && v.cardOnScreen && !v.transformedAncestor);
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(out));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
