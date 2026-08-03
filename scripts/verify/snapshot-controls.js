#!/usr/bin/env node
// Snapshot the computed style of EVERY form control on every page, at three
// viewports, into a JSON file. Pair with diff-snapshots.js.
//
// WHY THIS EXISTS. A change to one rule that covers many elements -- a global
// `button {}`, a blanket floor, a specificity change -- cannot be checked by
// looking at the page. The regression is always in the one member the rule was
// not written for, and it is invisible until someone opens that surface.
// Snapshot before, apply the change, snapshot after, diff.
//
// It earned its keep immediately: a proposed `:where()` sweep over 61
// container-scoped selectors looked correct and locally tested fine, but the
// diff showed it changed 364 declarations -- min-height 44px -> 36px on 54
// controls, and silent reversals of two fixes that had shipped that day. The
// change was reverted on the evidence rather than merged on the reasoning.
//
//   node scripts/verify/snapshot-controls.js before.json
//   ...make the change...
//   node scripts/verify/snapshot-controls.js after.json
//   node scripts/verify/diff-snapshots.js before.json after.json
//
// Args:  <out.json> [base-url]        default base http://localhost:8791
// Env:   CHROME_PATH                  explicit browser binary (optional)
//
// Needs a static server on the docs/ dir, e.g.
//   npx http-server docs -p 8791 --silent

const { writeFileSync, existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

// Playwright's own default points at whichever browser build its version
// expects, which is NOT necessarily the one cached on this machine -- the
// mismatch fails with "Executable doesn't exist ... chromium_headless_shell-1178"
// while 1228 sits installed. So find the newest cached headless shell rather
// than hardcoding a build number that goes stale on the next upgrade.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ||
    join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!existsSync(root)) return undefined;
  const builds = readdirSync(root)
    .filter(d => d.startsWith("chromium_headless_shell-"))
    .map(d => ({ d, n: parseInt(d.split("-").pop(), 10) || 0 }))
    .sort((a, b) => b.n - a.n);
  for (const { d } of builds) {
    for (const rel of [["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
                       ["chrome-win", "headless_shell.exe"]]) {
      const p = join(root, d, ...rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined; // let playwright try its own default and report
}

// playwright is installed under the gitignored verify-tmp/ on this machine.
// Try the normal resolution first so this still works if it is ever installed
// at the repo root or globally.
function loadPlaywright() {
  const candidates = ["playwright", join(__dirname, "..", "..", "verify-tmp", "node_modules", "playwright")];
  for (const c of candidates) {
    try { return require(c); } catch { /* try next */ }
  }
  console.error("Could not resolve `playwright`. Install it, or run from a tree that has it:\n" +
                "  npm i -D playwright   (or reuse verify-tmp/node_modules)");
  process.exit(2);
}
const { chromium, devices } = loadPlaywright();

const OUT = process.argv[2];
const BASE = process.argv[3] || "http://localhost:8791";
if (!OUT) { console.error("usage: snapshot-controls.js <out.json> [base-url]"); process.exit(2); }

const PAGES = ["index.html", "map.html", "list.html", "disclaimer.html"];

// Three viewports, not two: the middle one catches rules that only apply above
// a desktop breakpoint (the list toolbar has tiers at 641px and 1400px).
const VIEWPORTS = [
  ["desktop", { viewport: { width: 1280, height: 900 } }],
  ["wide", { viewport: { width: 1600, height: 900 } }],
  ["mobile", () => ({ ...devices["iPhone 13"] })],
];

const PROPS = [
  "min-height", "height", "min-width", "width", "max-width",
  "font-size", "font-weight", "border-radius", "border-top-width",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin-left", "color", "background-color", "display", "gap",
  "white-space", "flex-grow", "flex-basis", "position", "text-align",
];

const CAPTURE = (props) => {
  // Positional path, so the same element lines up across runs even when it has
  // no id and its classes are what the change is altering.
  const pathOf = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const p = e.parentElement;
      const i = p ? [...p.children].indexOf(e) : 0;
      parts.unshift(`${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}:${i}`);
    }
    return parts.join(">");
  };
  const out = {};
  for (const el of document.querySelectorAll("button, input, select, textarea")) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const rec = { _w: +r.width.toFixed(1), _h: +r.height.toFixed(1), _vis: !!el.offsetParent };
    for (const p of props) rec[p] = cs.getPropertyValue(p);
    out[`${pathOf(el)}|${(el.className || "").toString().trim().split(/\s+/)[0]}`] = rec;
  }
  return out;
};

// On-demand UI is where blanket rules hide. Dialogs and the map shell are built
// by innerHTML on first open, so a sweep that only looks at the initial DOM
// misses them -- that is how an earlier audit undercounted index.html 7 vs 9.
const REVEAL = async (page) => {
  await page.evaluate(async () => {
    const go = async (fn) => { try { await fn(); } catch { /* surface absent on this page */ } };
    await go(() => showList("snap"));
    await go(async () => {
      if (!document.querySelector(".map-search input") && typeof renderMapMode === "function") await renderMapMode();
    });
    await go(() => document.querySelector("#map-filter-toggle")?.click());
    await go(() => openAddAddress());
    await go(() => openListDetails());
    await go(() => openNotesFeed());
  });
};

(async () => {
  const launch = { headless: true };
  const exe = findChrome();
  if (exe) launch.executablePath = exe;
  const browser = await chromium.launch(launch).catch(e => {
    console.error(`${e.message}\n\nSet CHROME_PATH to a chrome-headless-shell binary, or run: npx playwright install`);
    process.exit(2);
  });
  const snap = {};
  for (const p of PAGES) {
    for (const [tag, opts] of VIEWPORTS) {
      const ctx = await browser.newContext(typeof opts === "function" ? opts() : opts);
      const page = await ctx.newPage();
      // Determinism: no network variance in a baseline that will be diffed.
      await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: "{}" }));
      await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
      await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
      await page.addInitScript(() => localStorage.setItem("chi_permit_lists", JSON.stringify({
        lastUsed: "snap", lists: { snap: { id: "snap", title: "snap", permits: [], created: Date.now() } },
      })));
      await page.goto(`${BASE}/${p}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("body[data-ready]", { timeout: 30000 }).catch(() => {});
      await REVEAL(page);
      await page.waitForTimeout(1200);
      snap[`${p}|${tag}`] = await page.evaluate(CAPTURE, PROPS);
      await ctx.close();
    }
  }
  await browser.close();
  writeFileSync(OUT, JSON.stringify(snap, null, 1));
  const n = Object.values(snap).reduce((s, o) => s + Object.keys(o).length, 0);
  console.log(`wrote ${OUT}: ${Object.keys(snap).length} page/viewport combos, ${n} control records`);
})();
