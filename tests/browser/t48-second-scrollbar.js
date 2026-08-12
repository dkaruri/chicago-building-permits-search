// FIX: a second page scrollbar appears after opening and closing a permit.
//
// `overflow-x: hidden` on <body> forces its overflow-y from `visible` to
// `auto`, making body a SECOND full-page scroll container behind html (which
// is the real page scroller). It stays invisible while body's content happens
// to fit its own box exactly; the overlay open/close perturbs layout by a
// sub-pixel, body's scrollHeight rounds up 1px, and the browser paints body's
// own scrollbar beside the page's.
//
// NOTE: this headless build has OVERLAY scrollbars (measured width 0), so the
// scrollbar itself is invisible here. Assert the STRUCTURE instead: body must
// not be a scroll container, and must not scroll independently of the page.
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");
const { devices } = require("playwright");

const ROWS = Array.from({ length: 25 }, (_, i) => ({
  permit_number: "B10000" + String(i).padStart(4, "0"),
  permit_type: "PERMIT - RENOVATION/ALTERATION", permit_status: "ACTIVE",
  issue_date: "2026-01-05", address: `${1000 + i} W FULLERTON AVE`,
  ward: "32", reported_cost: 250000, work_type: "MASONRY",
}));

let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

// A second scroller is one that (a) is a scroll container and (b) has content
// to scroll. Probe behaviourally too: a real one moves when you scroll it.
const probeBody = () => {
  const b = document.body;
  const cs = getComputedStyle(b);
  const start = b.scrollTop;
  b.scrollTop = 60;
  const moved = b.scrollTop !== start;
  b.scrollTop = start;
  return {
    overflowY: cs.overflowY, overflowX: cs.overflowX,
    scrollH: b.scrollHeight, clientH: b.clientHeight,
    overflowPx: b.scrollHeight - b.clientHeight,
    moved,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
};

async function openThenClose(page) {
  await page.click(".saved-permits-table tbody tr td[data-label='Permit']");
  await page.waitForFunction(() => !document.getElementById("permit-modal").hidden, null, { timeout: 10000 });
  await page.click(".pm-close");
  await page.waitForFunction(() => document.getElementById("permit-modal").hidden, null, { timeout: 10000 });
  await page.waitForTimeout(350);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });

  for (const [label, opts] of [
    ["desktop", { viewport: { width: 1280, height: 800 } }],
    ["iphone13", { ...devices["iPhone 13"] }],
  ]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await openList(page);
    await seedSavedList(page, ROWS);

    const before = await page.evaluate(probeBody);
    ok(`${label}: body is not a scroll container on load`, before.overflowY === "visible", `overflow-y: ${before.overflowY}`);
    ok(`${label}: no horizontal page scroll on load`, !before.hScroll);

    await openThenClose(page);
    const after = await page.evaluate(probeBody);
    ok(`${label}: body is still not a scroll container after close`, after.overflowY === "visible", `overflow-y: ${after.overflowY}`);
    // The sub-pixel overflow itself is fine and stays (body's box is a
    // fractional height); it is only a scrollbar when body is a scroller.
    ok(`${label}: body does not scroll independently after close`, !after.moved, `overflow ${after.overflowPx}px`);
    ok(`${label}: closing did not introduce horizontal scroll`, !after.hScroll);

    // Repeat opens must not make it worse either.
    await openThenClose(page);
    await openThenClose(page);
    const after3 = await page.evaluate(probeBody);
    ok(`${label}: still clean after three open/close cycles`, !after3.moved && after3.overflowY === "visible", `overflow ${after3.overflowPx}px`);

    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
