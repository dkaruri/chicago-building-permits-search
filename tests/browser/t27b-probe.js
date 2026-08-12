// Evidence gathering for FIX-010. Two questions:
//  Q1 does body.modal-open actually stop the page scrolling while open?
//  Q2 can a native <dialog> survive the permit overlay closing under it?
//     (a left-open modal dialog makes the whole document inert = "locked up")
const { chromium, devices } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

const ROW = {
  permit_number: "100999888", permit_status: "OPEN", permit_type: "PERMIT - RENOVATION/ALTERATION",
  issue_date: "2026-05-01", address: "123 N TEST ST", ward: "27", reported_cost: "125000",
  total_fee: "900", work_description: "INTERIOR ALTERATIONS 3 UNITS", work_type: "ALTERATION",
  review_type: "STANDARD PLAN REVIEW", community_area: "WEST TOWN", processing_time: "12",
  general_contractors: ["ACME BUILDERS"], open_subs: ["SPARKY ELECTRIC"],
};

async function boot(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.hasAttribute("data-ready"), null, { timeout: 20000 });
  await page.evaluate(() => { const d = document.createElement("div"); d.style.height = "3000px"; document.body.appendChild(d); });
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
  await page.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 1, cached_at: "2026-07-28" }) }));
  await page.route("**/api/contact/**", r => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));

  const out = {};
  for (const p of ["list.html", "index.html"]) {
    await boot(page, "http://127.0.0.1:8791/" + p);
    // Q1
    out[p + " Q1"] = await page.evaluate(row => {
      window.scrollTo(0, 400);
      openPermitDetail(row);
      const before = window.scrollY;
      window.scrollTo(0, 900);
      const after = window.scrollY;
      const cs = getComputedStyle(document.documentElement);
      return {
        pageStillScrollsWhileModalOpen: after !== before,
        before, after,
        htmlOverflow: cs.overflowY,
        bodyOverflow: getComputedStyle(document.body).overflowY,
        viewportScroller: document.scrollingElement.tagName,
      };
    }, ROW);
    await page.evaluate(() => closePermitModal());
  }

  // Q2: open the permit overlay, open the walkthrough dialog from it, then
  // close the permit overlay via history back and see if the dialog is left open.
  await boot(page, "http://127.0.0.1:8791/list.html");
  out.Q2 = await page.evaluate(row => {
    openPermitDetail(row);
    return { dialogs: [...document.querySelectorAll("dialog")].map(d => d.id + ":" + d.open) };
  }, ROW);

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
