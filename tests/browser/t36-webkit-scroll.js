// t36 (FIX-010 regression): reproduce the user's exact mobile flow on WebKit.
//
// Reported: open the permit view from a saved list, scroll DOWN and UP inside
// the permit view, close it — the list can no longer be scrolled until reload.
// t27 covered open/close but never scrolled the overlay body, and ran on
// Chromium only. This runs the full flow on WebKit (Safari's engine) with
// Chromium as the control.
//
// Probes after close, in order of what they would prove:
//   docScrollHeight <= innerHeight  -> the document itself collapsed (relayout
//                                      never happened after un-fixing body)
//   bodyPosition === "fixed"        -> the lock is still applied
//   moved === false w/ tall doc     -> engine kept the viewport locked
const { chromium, webkit, devices } = require("playwright");
const CHROME = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

const ROW = {
  permit_number: "100999888", permit_status: "OPEN", permit_type: "PERMIT - RENOVATION/ALTERATION",
  issue_date: "2026-05-01", address: "123 N TEST ST", ward: "27", reported_cost: "125000",
  total_fee: "900", work_description: "INTERIOR ALTERATIONS 3 UNITS", work_type: "ALTERATION",
  review_type: "STANDARD PLAN REVIEW", community_area: "WEST TOWN", processing_time: "12",
  general_contractors: ["ACME BUILDERS"], open_subs: ["SPARKY ELECTRIC"],
};

const START = 400;

async function trial(page, url, scrollOverlay) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.hasAttribute("data-ready"), null, { timeout: 20000 });
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.id = "t36-pad"; d.style.height = "3000px";
    document.body.appendChild(d);
  });
  await page.evaluate(y => window.scrollTo(0, y), START);

  const startY = await page.evaluate(row => {
    const y = window.scrollY;
    openPermitDetail(row);
    return y;
  }, ROW);
  await page.waitForTimeout(300);

  // The mobile contract: NO page lock (nothing taken out of flow, nothing to
  // restore), background panning stopped at the input layer instead, and pinch
  // zoom preserved in both touch-action values.
  const contract = await page.evaluate(() => ({
    rootOverflowY: getComputedStyle(document.documentElement).overflowY,
    rootLocked: document.documentElement.classList.contains("modal-open"),
    modalTouch: getComputedStyle(document.querySelector(".permit-modal")).touchAction,
    bodyTouch: getComputedStyle(document.getElementById("permit-modal-body")).touchAction,
    bodyPositionWhileOpen: getComputedStyle(document.body).position,
  }));

  let overlay = null;
  if (scrollOverlay) {
    // Make sure the overlay body really overflows, then scroll it down and back
    // up the way a finger would — a wheel over the element, not scrollTop.
    await page.evaluate(() => {
      const b = document.getElementById("permit-modal-body");
      if (b.scrollHeight <= b.clientHeight + 40) {
        const d = document.createElement("div");
        d.style.height = "1200px";
        b.appendChild(d);
      }
    });
    // Mobile WebKit has no wheel and Playwright has no touch drag, so step the
    // scroller programmatically. This reproduces the DOM/layout consequences of
    // the gesture, not the compositor's momentum state.
    for (let i = 1; i <= 6; i += 1) {
      await page.evaluate(n => { document.getElementById("permit-modal-body").scrollTop = n * 200; }, i);
      await page.waitForTimeout(60);
    }
    const mid = await page.evaluate(() => document.getElementById("permit-modal-body").scrollTop);
    for (let i = 5; i >= 0; i -= 1) {
      await page.evaluate(n => { document.getElementById("permit-modal-body").scrollTop = n * 200; }, i);
      await page.waitForTimeout(60);
    }
    overlay = { mid, end: await page.evaluate(() => document.getElementById("permit-modal-body").scrollTop) };
  }

  await page.evaluate(() => document.querySelector(".pm-close").click());
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => {
    const before = window.scrollY;
    window.scrollBy(0, 300);
    return {
      hidden: document.getElementById("permit-modal").hidden,
      modalOpen: document.body.classList.contains("modal-open"),
      bodyTop: document.body.style.top,
      bodyPosition: getComputedStyle(document.body).position,
      docScrollHeight: document.documentElement.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      innerHeight: window.innerHeight,
      restoredY: before,
      moved: window.scrollY !== before,
    };
  });
  // The momentum cancel flips the overlay scroller's overflow off on close. The
  // regression it risks is leaving it off — reopen and confirm it scrolls again.
  await page.evaluate(row => openPermitDetail(row), ROW);
  await page.waitForTimeout(300);
  const reopened = await page.evaluate(() => ({
    overflowY: getComputedStyle(document.getElementById("permit-modal-body")).overflowY,
    inlineOverflowY: document.getElementById("permit-modal-body").style.overflowY,
  }));
  await page.evaluate(() => document.querySelector(".pm-close").click());
  await page.waitForTimeout(200);

  return { scrollOverlay, startY, overlay, contract, reopened, ...after };
}

(async () => {
  const engines = [["webkit", webkit, {}], ["chromium", chromium, { executablePath: CHROME }]];
  const rows = [];
  for (const [name, type, opts] of engines) {
    let browser;
    try { browser = await type.launch({ headless: true, ...opts }); }
    catch (e) { console.log(`SKIP ${name}: ${e.message.split("\n")[0]}`); continue; }
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
    await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
    await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
    for (const scrollOverlay of [false, true]) {
      rows.push({ engine: name, ...(await trial(page, "http://127.0.0.1:8791/list.html", scrollOverlay)) });
    }
    await ctx.close();
    await browser.close();
  }
  for (const r of rows) console.log(JSON.stringify(r));
  // The control (scrollOverlay:false) must pass too — if it fails the probe is
  // measuring itself, not the bug.
  const bad = rows.filter(r =>
    !r.moved || r.modalOpen || r.bodyPosition === "fixed" || r.docScrollHeight <= r.innerHeight ||
    // mobile contract, asserted while the overlay is open
    r.contract.rootOverflowY === "hidden" ||
    r.contract.bodyPositionWhileOpen === "fixed" ||
    !/pinch-zoom/.test(r.contract.modalTouch) ||
    !/pinch-zoom/.test(r.contract.bodyTouch) ||
    !/pan-y/.test(r.contract.bodyTouch) ||
    /pan-y/.test(r.contract.modalTouch) ||
    // reopening must restore the scroller the momentum cancel switched off
    r.reopened.overflowY !== "auto" || r.reopened.inlineOverflowY !== "");
  console.log(bad.length ? `FAIL ${bad.length}/${rows.length}` : `PASS ${rows.length}/${rows.length}`);
  process.exit(bad.length ? 1 : 0);
})();
