// t27 (FIX-010): the permit overlay's page-scroll lock.
//
// The lock is DESKTOP ONLY. Below 641px the card is an opaque full-screen sheet,
// so there is nothing behind it to lock — and every mobile lock this project has
// tried has been the bug rather than the fix.
//
// NOTE on the probe: `overflow: hidden` blocks USER scrolling but still allows
// programmatic scrolling, so window.scrollBy is not a lock detector (it was one
// only because the old position:fixed lock collapsed the document). Drive a real
// wheel and assert the computed root overflow. `_wheelprobe.js` is the control
// proving this probe reports success on a page known to be scrollable.
//
// A. desktop: while the overlay is open a real wheel cannot scroll the page and
//    the root scroller reads overflow:hidden
// B. mobile: no lock is required, but the card must cover the whole viewport so
//    anything moving behind it is invisible
// C. after closing, both scroll again and are where they started
// D. every close path releases: close button, backdrop, Escape, browser back,
//    and closing from depth in the card stack
// E. re-entrant close (closePermitModal on an already-hidden modal) releases a
//    latched lock instead of returning early and leaving the page stuck
const { chromium, devices } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

const ROW = {
  permit_number: "100999888", permit_status: "OPEN", permit_type: "PERMIT - RENOVATION/ALTERATION",
  issue_date: "2026-05-01", address: "123 N TEST ST", ward: "27", reported_cost: "125000",
  total_fee: "900", work_description: "INTERIOR ALTERATIONS 3 UNITS", work_type: "ALTERATION",
  review_type: "STANDARD PLAN REVIEW", community_area: "WEST TOWN", processing_time: "12",
  general_contractors: ["ACME BUILDERS"], open_subs: ["SPARKY ELECTRIC"],
};

const START = 400;

async function boot(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.hasAttribute("data-ready"), null, { timeout: 20000 });
  // Guarantee a scrollable document regardless of how much data loaded.
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.id = "t27-pad"; d.style.height = "3000px";
    document.body.appendChild(d);
  });
  await page.evaluate(y => window.scrollTo(0, y), START);
}

// A real wheel over the middle of the viewport. Chromium honours overflow:hidden
// on the propagating root for wheel input, so this distinguishes locked from
// unlocked without depending on the document height.
async function tryScroll(page) {
  // Top-left corner, NOT the viewport centre: the centre sits over the results
  // table (`.table-wrap { overflow: auto }`) and the desktop nav rail, both of
  // which swallow the wheel, so the page never moves and every case reads
  // "locked". _wheelprobe.js is the control that this probe can report success.
  // Chromium latches a wheel gesture to the scroll node it first hit, so the
  // FIRST wheel delivered after the overlay closes is swallowed by the scroller
  // that no longer exists. Burn one, then measure — measured in _wheelprobe5.js,
  // where wheel #1 after close moved nothing and wheel #2 moved 300px.
  await page.mouse.move(4, 4);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(150);
  const snap = await page.evaluate(() => ({
    after: window.scrollY,
    rootOverflowY: getComputedStyle(document.documentElement).overflowY,
    scrollH: document.documentElement.scrollHeight,
    innerH: window.innerHeight,
    over: (el => el ? el.tagName + "." + (el.className || "") : "none")(document.elementFromPoint(4, 4)),
  }));
  return { before, moved: snap.after !== before, ...snap };
}

// Mobile has no lock by design, so measure what actually matters there: the card
// must cover the viewport, so whatever moves behind it cannot be seen.
const cardCoverage = page => page.evaluate(() => {
  const r = document.querySelector(".permit-modal-card").getBoundingClientRect();
  return r.top <= 1 && r.left <= 1 &&
    r.bottom >= window.innerHeight - 1 && r.right >= window.innerWidth - 1;
});

async function trial(page, url, closeHow, mobile) {
  await boot(page, url);
  // Read the position in the SAME evaluate that opens the overlay. A late async
  // render can shorten the document and clamp the scroll, so reading it in a
  // separate round trip races the open and reports a false restore failure.
  const startY = await page.evaluate(row => {
    const y = window.scrollY;
    openPermitDetail(row);
    return y;
  }, ROW);
  await page.waitForTimeout(250);

  // Only probe scrolling while open on desktop — on mobile the probe would move
  // the page (correctly, there is no lock) and then "scroll restored after
  // close" would be measuring the probe rather than the code.
  const whileOpen = mobile ? null : await tryScroll(page);
  const covered = mobile ? await cardCoverage(page) : null;

  if (closeHow === "button") await page.evaluate(() => document.querySelector(".pm-close").click());
  else if (closeHow === "backdrop") await page.evaluate(() => document.querySelector(".permit-modal-backdrop").click());
  else if (closeHow === "escape") await page.keyboard.press("Escape");
  else if (closeHow === "back") await page.goBack();
  else if (closeHow === "stack-back") {
    // Scope to the overlay — index.html's directory behind it also carries
    // openContactCard handlers, and clicking one of those scrolls the page.
    await page.evaluate(() => document.querySelector("#permit-modal [onclick*='openContactCard']")?.click());
    await page.waitForTimeout(350);
    await page.evaluate(() => document.querySelector(".pm-close").click());
  } else if (closeHow === "reentrant") {
    // Hide the modal behind closePermitModal's back, leaving the lock latched,
    // then close again — the release must not sit behind the early return.
    await page.evaluate(() => { document.getElementById("permit-modal").hidden = true; });
    await page.evaluate(() => closePermitModal());
  }
  await page.waitForTimeout(350);

  const after = await page.evaluate(() => ({
    hidden: document.getElementById("permit-modal").hidden,
    modalOpen: document.body.classList.contains("modal-open"),
    rootOpen: document.documentElement.classList.contains("modal-open"),
    rootOverflowY: getComputedStyle(document.documentElement).overflowY,
    bodyTop: document.body.style.top,
    scrollY: window.scrollY,
  }));
  const afterClose = await tryScroll(page);
  return {
    closeHow,
    // Desktop: genuinely locked. Mobile: not locked, but fully covered.
    lockedWhileOpen: mobile ? covered : (!whileOpen.moved && whileOpen.rootOverflowY === "hidden"),
    releasedAfterClose: afterClose.moved,
    // Desktop must land exactly where it started. Mobile no longer touches the
    // scroll position at all, so what is left is Chromium's scroll anchoring
    // re-settling the page as async renders change content height — measured at
    // ~50px on the reentrant path. The regression this guards against is a jump
    // to the top, so allow the settle and catch the reset.
    scrollRestored: Math.abs(after.scrollY - startY) < (mobile ? 64 : 4),
    after,
    whileOpen,
    afterClose,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const results = [];
  for (const device of ["iPhone 13", "desktop"]) {
    const ctx = device === "desktop"
      ? await browser.newContext({ viewport: { width: 1280, height: 900 } })
      : await browser.newContext({ ...devices[device] });
    const page = await ctx.newPage();
    // Catch-all FIRST — Playwright resolves overlapping routes LIFO.
    await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
    await page.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 1, cached_at: "2026-07-28" }) }));
    await page.route("**/api/contact/**", r => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
    await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
    for (const p of ["list.html", "index.html"]) {
      for (const how of ["button", "backdrop", "escape", "back", "stack-back", "reentrant"]) {
        results.push({ device, page: p, ...(await trial(page, "http://127.0.0.1:8791/" + p, how, device !== "desktop")) });
      }
    }
    await ctx.close();
  }

  const bad = results.filter(r =>
    !r.lockedWhileOpen || !r.releasedAfterClose || !r.scrollRestored ||
    !r.after.hidden || r.after.modalOpen || r.after.rootOpen ||
    r.after.rootOverflowY === "hidden" || r.after.bodyTop !== "");
  for (const r of bad) console.log("BAD " + JSON.stringify(r));
  console.log(`${results.length - bad.length}/${results.length} ok`);
  console.log(bad.length ? `FAIL ${bad.length}` : "PASS");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
