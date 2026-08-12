// t29 (FIX-005): Share must never latch the list toolbar.
//
// shareUserList awaits navigator.share(). When the OS share sheet is dismissed
// without a choice, that promise can stay pending forever (desktop Chrome), and
// withListAction has no timeout — so state.listActionBusy stays true and
// setListActionBusy(true) leaves EVERY [data-list-action] button disabled. Share,
// CSV export, drive distances and sort all die together, permanently.
//
// The board reported it as "hangs when a link is already generated" because only
// the second Share reaches navigator.share with transient user activation intact:
// the first awaits fetch() first, which drops activation, so navigator.share
// rejects immediately and falls through to the clipboard path.
//
// A. a never-settling navigator.share must not leave the toolbar disabled
// B. after that, a further Share must still work (no permanent latch)
// C. a REJECTING navigator.share (user cancelled) still falls through to clipboard
// D. the happy path still returns without touching the fallback
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

// Defined in the page so every case can reuse them. `state` is a top-level
// lexical const, which is a global binding — reachable from a script installed
// this way, as long as it is only READ at call time.
const HELPERS = `
  window.SEEDFN = () => {
    state.lists = { a: { name: "Pub", permits: ["100"], focal: null, sharedId: "SHARED1" } };
    state.activeListId = "a";
    state.userPermitNumbers = ["100"];
    try { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true }); } catch (e) {}
  };
  // Counts anything still presented as busy — disabled OR aria-busy="true".
  // Checking only .disabled would miss a stale aria-busy left on for AT.
  window.TOOLBARFN = () =>
    [...document.querySelectorAll("[data-list-action]")]
      .filter(b => b.disabled || b.getAttribute("aria-busy") === "true").length;
`;

async function boot(browser, viewport) {
  const page = await browser.newPage(viewport ? { viewport } : undefined);
  await page.addInitScript(HELPERS);
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
  await page.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 0, cached_at: "2026-07-28" }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/list.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });
  return page;
}

// SEEDFN seeds a list that ALREADY has a share id, so shareUserList skips the
// fetch and goes straight at navigator.share — the reported "already generated"
// case. TOOLBARFN counts disabled list-action buttons.

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const out = {};

  // A + B: navigator.share never settles. Run at BOTH viewports — the native
  // share sheet is the mobile path, which is where this actually bites.
  for (const [key, viewport] of [["hang", null], ["hangMobile", { width: 390, height: 844 }]]) {
    const page = await boot(browser, viewport);
    out[key] = await page.evaluate(async () => {
      SEEDFN();
      Object.defineProperty(navigator, "share", { value: () => new Promise(() => {}), configurable: true });
      const total = document.querySelectorAll("[data-list-action]").length;
      shareUserList();                                  // deliberately not awaited
      // Wait past SHARE_SHEET_TIMEOUT_MS (20s). Read the real constant rather
      // than hard-coding it, so raising the timeout cannot silently pass this.
      await new Promise(r => setTimeout(r, SHARE_SHEET_TIMEOUT_MS + 1500));
      const stuckDisabled = TOOLBARFN();
      const busy = state.listActionBusy;
      // B: can the user share again afterwards?
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      let secondWorked = false;
      await shareUserList();
      secondWorked = /copied|Share link/i.test(state.userRouteSummary || "");
      return { total, stuckDisabled, busy, secondWorked, summary: state.userRouteSummary };
    });
    await page.close();
  }

  // C: user cancels the sheet (promise rejects) -> clipboard fallback still runs.
  {
    const page = await boot(browser);
    out.cancel = await page.evaluate(async () => {
      SEEDFN();
      Object.defineProperty(navigator, "share", { value: () => Promise.reject(new Error("AbortError")), configurable: true });
      await shareUserList();
      return { busy: state.listActionBusy, disabled: TOOLBARFN(), summary: state.userRouteSummary };
    });
    await page.close();
  }

  // D: happy path -> share sheet accepted, no fallback text, toolbar released.
  {
    const page = await boot(browser);
    out.happy = await page.evaluate(async () => {
      SEEDFN();
      let called = 0;
      Object.defineProperty(navigator, "share", { value: () => { called++; return Promise.resolve(); }, configurable: true });
      await shareUserList();
      return { called, busy: state.listActionBusy, disabled: TOOLBARFN(), summary: state.userRouteSummary };
    });
    await page.close();
  }

  console.log(JSON.stringify(out, null, 2));
  const ok =
    out.hang.stuckDisabled === 0 && out.hang.busy === false && out.hang.secondWorked === true &&
    out.hangMobile.stuckDisabled === 0 && out.hangMobile.busy === false && out.hangMobile.secondWorked === true &&
    out.cancel.busy === false && out.cancel.disabled === 0 && /copied|Share link/i.test(out.cancel.summary || "") &&
    out.happy.called === 1 && out.happy.busy === false && out.happy.disabled === 0;
  console.log(ok ? "PASS" : "FAIL");
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
