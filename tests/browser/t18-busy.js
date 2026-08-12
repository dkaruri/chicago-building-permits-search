// t18-busy.js: Verify that aria-busy attribute is cleared when a contact-card
// fetch is interrupted by navigating away (popCard) before it resolves.
//
// Real scenario: pushCard({type:"contact", ...}) renders a skeleton and calls
// fillContactCard, which sets aria-busy="true" then awaits /api/contact. If
// the user pops the card before that fetch resolves, the fix in renderCard
// clears aria-busy unconditionally on every render (not just in
// fillContactCard's success path), so the stale fetch settling afterward
// cannot leave the body permanently marked busy.
//
// An optional CLI arg points this at a different origin (e.g. a scratch copy
// serving pre-fix code) via: node t18-busy.js http://127.0.0.1:PORT
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

const origin = process.argv[2] || "http://127.0.0.1:8791";
const PAGES = [`${origin}/index.html`, `${origin}/list.html`];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  console.log(`Testing aria-busy interrupted-fetch handling against ${origin} ...`);
  let allOk = true;

  for (const url of PAGES) {
    const page = await browser.newPage();

    // Stub /api/contact and /api/permits with a delay long enough to
    // interact mid-flight. Keep the other existing stubs (notes, Socrata).
    await page.route("**/api/contact/**", (route) => {
      setTimeout(() => {
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            contact_name: "TEST CONTRACTOR",
            open_jobs: 5,
            license_matches: [],
            work_types: [],
          }),
        });
      }, 3000);
    });

    await page.route("**/api/permits**", (route) => {
      setTimeout(() => {
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ rows: [], row_count: 0 }),
        });
      }, 3000);
    });

    await page.route("**/api/notes/**", (route) => {
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ notes: [] }) });
    });

    await page.route("**/data.cityofchicago.org/**", (route) => {
      route.fulfill({ contentType: "application/json", body: "[]" });
    });

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => typeof pushCard === "function" && typeof popCard === "function",
      { timeout: 15000 }
    );

    const body = await page.$(".permit-modal-body");

    // Baseline: nothing open yet.
    const baseline = await body.getAttribute("aria-busy");
    if (baseline) {
      console.error(`  FAIL [${url}]: aria-busy already set before test: ${baseline}`);
      allOk = false;
      await page.close();
      continue;
    }

    // Push a filler PERMIT card first so the stack has depth: popCard() at
    // cardIndex<=0 calls closePermitModal() instead of renderCard(), which
    // never touches aria-busy at all and would make this test pass
    // vacuously for the wrong reason. With a card underneath, popping the
    // contact card takes the renderCard("back") path, which is what
    // actually needs to clear aria-busy for an interrupted fetch.
    await page.evaluate(() => {
      window.pushCard({ type: "permit", row: { permit_number: "100923847", address: "Test Address" } });
    });
    await page.waitForTimeout(100);

    // Push a CONTACT card on top. This is the path that actually calls
    // fillContactCard and sets aria-busy="true" while /api/contact is in flight.
    await page.evaluate(() => {
      window.pushCard({ type: "contact", name: "TEST CONTRACTOR", role: "general_contractor" });
    });

    await page.waitForTimeout(200);

    // Intermediate assertion: while the fetch is in flight, aria-busy MUST be "true".
    const midBusy = await body.getAttribute("aria-busy");
    console.log(`  [${url}] mid-flight aria-busy = ${midBusy}`);
    if (midBusy !== "true") {
      console.error(`  FAIL [${url}]: expected aria-busy="true" mid-flight (scenario not reproduced), got: ${midBusy}`);
      allOk = false;
      await page.close();
      continue;
    }

    // Navigate away from the card while the fetch is still in flight.
    await page.evaluate(() => window.popCard());
    await page.waitForTimeout(100);

    // Wait past the stub's 3s delay so the stale fetch settles.
    await page.waitForTimeout(3200);

    const finalHasAttr = await page.evaluate(
      () => document.querySelector(".permit-modal-body").hasAttribute("aria-busy")
    );
    console.log(`  [${url}] final hasAttribute("aria-busy") = ${finalHasAttr}`);

    if (finalHasAttr !== false) {
      console.error(`  FAIL [${url}]: aria-busy leaked after interrupted fetch settled`);
      allOk = false;
      await page.close();
      continue;
    }

    console.log(`  PASS [${url}]`);
    await page.close();
  }

  await browser.close();
  if (allOk) {
    console.log("\u2713 All aria-busy interrupted-fetch tests passed");
    process.exit(0);
  } else {
    console.log("\u2717 aria-busy interrupted-fetch test FAILED");
    process.exit(1);
  }
})().catch((e) => {
  console.error("Test error:", e);
  process.exit(1);
});
