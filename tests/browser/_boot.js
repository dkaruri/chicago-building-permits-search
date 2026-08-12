// tests/browser/_boot.js — shared launcher.
const { chromium } = require("playwright");
const { existsSync } = require("node:fs");

// FIX-020. This was one hard-coded path into one person's home directory, which
// is a large part of why the suite only ever ran on one machine. Resolution
// order now: CHROME env var, then Playwright's own resolved browser, then the
// cached headless-shell this repo has always used.
//
// Playwright's executablePath() is the right answer on a fresh clone — it points
// at whatever `npx playwright install chromium` put down. The literal path stays
// last so an existing checkout keeps working with the build it already has.
function resolveChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch {
    // Older Playwright, or no browser installed — fall through.
  }
  return "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
}

const CHROME = resolveChrome();

// A missing browser otherwise surfaces as a Playwright launch error several
// frames deep, which reads as a broken test rather than a missing prerequisite.
if (!existsSync(CHROME)) {
  console.error([
    `No Chromium at: ${CHROME}`,
    "Install it with:  npx playwright install chromium",
    "or point CHROME at an existing build:  CHROME=/path/to/chrome node tests/browser/t1.js",
    "See tests/browser/README.md.",
  ].join("\n"));
  process.exit(2);
}
async function openList(page, path = "list.html") {
  // Stub external services for determinism; localhost cannot reach the Worker.
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ json: [{ lat: "41.9", lon: "-87.7", display_name: "stub" }] }));
  // Deliberately NO `**/api/**` catch-all here. Playwright resolves overlapping
  // routes LIFO, and this helper runs AFTER a caller's own routes — a catch-all
  // registered here silently swallows the specific mocks suites set up before
  // calling openList (it broke t4's /api/contact/ mock the moment it was added).
  // Callers stub what they need; unreachable Worker calls are expected here.
  await page.goto(`http://localhost:8791/${path}`);
  // NOT `typeof state !== "undefined"` — declarations hoist, so that fires
  // before init() has even started, and init's async tail then overwrites any
  // state a test seeds (loadUserListCookie replaces state.lists, search resets
  // pageIndex/filteredRows). Both pages set body[data-ready] at the end of
  // init(); wait on that. This one race caused three separate flakes before it
  // was named, and these three suites still had the old wait.
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });
}

// Seed a saved list the way the multi-list rework expects. Two things changed
// under the suites written before it, and each one alone renders nothing:
//   1. rows come from the ACTIVE list, so state.lists + activeListId must exist
//      — userPermitNumbers/userPermitMap on their own are no longer the source;
//   2. list.html now has a directory view AND a list view, and init() restores
//      whichever the user saw last. Rendering into the list panel while the
//      directory is showing produces rows that are in the DOM but `hidden`, so
//      waitForSelector(...) times out on a page that is working fine.
// showList() does both: activates the list and unhides its panel.
async function seedSavedList(page, rows) {
  await page.evaluate(async rows => {
    state.userPermitMap = new Map(rows.map(r => [r.permit_number, r]));
    state.lists = { L: { name: "Test", permits: rows.map(r => r.permit_number), focal: null, sharedId: null } };
    await showList("L");
  }, rows);
  await page.waitForSelector(".saved-permits-table tbody tr", { timeout: 15000 });
}
module.exports = { chromium, CHROME, openList, seedSavedList };
