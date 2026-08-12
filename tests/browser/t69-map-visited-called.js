// FEAT-040 — visited / not visited / called / not called on the Permit Map.
//
// The scope decision this verifies (recorded on the card before any code):
// the chips implicitly narrow the map to permits in ANY of your lists, and a
// permit is "visited" if ANY list records a visit. So "not visited" means
// in-a-list-and-visited-nowhere, never "any of the 40,868 permits in Chicago".
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot.js");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

// Six permits. P1..P4 are in lists, P5/P6 are in none — the honesty case.
const ROWS = [
  { n: "P1", a: "1 W TEST ST" }, { n: "P2", a: "2 W TEST ST" },
  { n: "P3", a: "3 W TEST ST" }, { n: "P4", a: "4 W TEST ST" },
  { n: "P5", a: "5 W TEST ST" }, { n: "P6", a: "6 W TEST ST" },
].map((r, i) => ({
  ...r, s: "ACTIVE", d: "2026-01-15", t: "PERMIT - RENOVATION", wt: "RENOVATION",
  x: "work", c: 10000, go: 1, gc: "ACME", os: "", lat: 41.9 + i * 0.001, lon: -87.7,
  cn: "1", ca: "1", st: "TEST ST",
}));

// P1 visited in list A only. P2 visited in list B only (proves the ANY rule
// across lists). P3 called, not visited. P4 in a list, neither.
const LISTS = {
  A: { name: "A", permits: ["P1", "P3", "P4"], ticks: { P1: "Divyam" }, called: { P3: "Divyam" }, focal: null, sharedId: null },
  B: { name: "B", permits: ["P2"], ticks: { P2: "Sam" }, called: {}, focal: null, sharedId: null },
};

// applyMapFilters() reloads the month shards from Socrata every run, so seeding
// state.map.rows is pointless — it gets replaced. Stub the SOURCE instead, in
// the raw Socrata column shape loadMapMonths() expects.
const socrataRow = r => ({
  permit_: r.n, permit_status: r.s, permit_type: r.t, review_type: "STANDARD",
  issue_date: `${r.d}T00:00:00`, street_number: r.a.split(" ")[0],
  street_direction: "W", street_name: "TEST ST", work_type: r.wt,
  work_description: r.x, reported_cost: String(r.c), ward: "1", community_area: "1",
  latitude: String(r.lat), longitude: String(r.lon),
  contact_1_type: "CONTRACTOR-GENERAL CONTRACTOR", contact_1_name: "ACME",
});

async function stubData(page, lists) {
  await page.route("**/api/stats*", r => r.fulfill({ json: { row_count: 40868 } }));
  await page.route("**/api/permits*", r => r.fulfill({ json: { rows: [], row_count: 0, total: 0, offset: 0, limit: 150 } }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ json: ROWS.map(socrataRow) }));
  await page.route("**/api/profiles*", r => r.fulfill({ json: { rows: [], total: 0 } }));
  await page.addInitScript(l => {
    localStorage.setItem("chi_permit_lists", JSON.stringify({ lastUsed: "A", lists: l }));
    localStorage.setItem("chi_permit_map_settings", JSON.stringify({
      dateFrom: "2026-01-01", dateTo: "2026-12-31", gcMin: "", gcMax: "", costMin: "",
      costMax: "", neighborhood: "", q: "", radiusMiles: "", excludedWorkTypes: [],
      propertyUse: "", visited: null, called: null,
    }));
  }, lists);
}

async function open(page, lists = LISTS) {
  await stubData(page, lists);
  await page.goto("http://localhost:8791/map.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 40000 });
  await page.waitForFunction(() => state.map.filteredRows && state.map.filteredRows.length > 0, null, { timeout: 40000 });
}

const visible = page => page.evaluate(() => state.map.filteredRows.map(r => r.n).sort());
const strip = page => page.locator("#map-status-strip").textContent();

async function run(label, ctxOpts) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext(ctxOpts)).newPage();
  await open(page);

  check("unfiltered, every permit shows including the unlisted ones",
    (await visible(page)).join(",") === "P1,P2,P3,P4,P5,P6", (await visible(page)).join(","));

  const bar = page.locator("#map-flag-filters");
  check("the chip bar is shown once anything is visited or called",
    await bar.evaluate(el => !el.hidden));

  // --- visited: the ANY-list rule ---------------------------------------
  await page.evaluate(async () => await setMapFlagFilter("visited", "yes"));
  await page.waitForTimeout(500);
  check("Visited = visited in ANY list (P1 from list A, P2 from list B)",
    (await visible(page)).join(",") === "P1,P2", (await visible(page)).join(","));
  check("the status strip states the SCOPE, not just the facet",
    /saved permits only/i.test(await strip(page)) && /visited/i.test(await strip(page)),
    (await strip(page)).trim());
  check("the chip reports itself pressed",
    await page.locator("#map-filter-visited").getAttribute("aria-pressed") === "true");

  // --- not visited: never means "the whole city" -------------------------
  await page.evaluate(async () => await setMapFlagFilter("visited", "no"));
  await page.waitForTimeout(500);
  const notVisited = await visible(page);
  check("Not visited = in a list and visited nowhere — NOT the unlisted permits",
    notVisited.join(",") === "P3,P4", notVisited.join(","));
  check("unlisted permits are excluded, never treated as 'not visited'",
    !notVisited.includes("P5") && !notVisited.includes("P6"), notVisited.join(","));

  // --- pressing the active chip clears the facet -------------------------
  await page.evaluate(async () => await setMapFlagFilter("visited", "no"));
  await page.waitForTimeout(500);
  check("pressing the active chip clears its facet (its own escape route)",
    (await visible(page)).length === 6, (await visible(page)).join(","));
  check("cleared chip drops its pressed state",
    await page.locator("#map-filter-not-visited").getAttribute("aria-pressed") === "false");

  // --- mutually exclusive within a pair ----------------------------------
  await page.evaluate(async () => { await setMapFlagFilter("visited", "yes"); await setMapFlagFilter("visited", "no"); });
  await page.waitForTimeout(500);
  check("within a pair the chips are mutually exclusive",
    await page.locator("#map-filter-visited").getAttribute("aria-pressed") === "false"
    && await page.locator("#map-filter-not-visited").getAttribute("aria-pressed") === "true");

  // --- combine across pairs ----------------------------------------------
  await page.evaluate(async () => await setMapFlagFilter("called", "yes"));
  await page.waitForTimeout(500);
  check("across pairs the facets COMBINE (not visited AND called = P3)",
    (await visible(page)).join(",") === "P3", (await visible(page)).join(","));
  check("the strip names both facets",
    /not visited and called/i.test(await strip(page)), (await strip(page)).trim());

  // --- empty result is explained, not blank ------------------------------
  await page.evaluate(async () => { await setMapFlagFilter("called", "yes"); await setMapFlagFilter("visited", "yes"); await setMapFlagFilter("called", "no"); });
  await page.waitForTimeout(500);
  check("an empty combination still explains itself in the strip",
    /saved permits only/i.test(await strip(page)), (await strip(page)).trim());

  // --- persistence --------------------------------------------------------
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("chi_permit_map_settings")));
  check("the facets persist with the other map filters",
    saved.visited === "yes" && saved.called === "no", JSON.stringify({ v: saved.visited, c: saved.called }));

  // --- a11y ---------------------------------------------------------------
  const box = await page.locator("#map-filter-visited").boundingBox();
  check("chips meet a 44px touch target", box.height >= 44, `${Math.round(box.width)}x${Math.round(box.height)}`);
  // Height alone let a full-width chip through on the first run: `.map-drawer
  // button { width: 100% }` beat `button.tag` and stacked one chip per row at
  // 346px, which is FIX-019's exact signature. Assert the chips SHARE a row.
  const rows = await page.evaluate(() => {
    const els = ["map-filter-visited", "map-filter-not-visited", "map-filter-called", "map-filter-not-called"]
      .map(id => document.getElementById(id).getBoundingClientRect());
    const bar = document.getElementById("map-flag-filters").getBoundingClientRect();
    return { tops: [...new Set(els.map(r => Math.round(r.top)))].length, widest: Math.round(Math.max(...els.map(r => r.width))), bar: Math.round(bar.width) };
  });
  check("chips sit side by side, not one per row",
    rows.tops < 4 && rows.widest < rows.bar * 0.9,
    `${rows.tops} row(s), widest chip ${rows.widest}px in a ${rows.bar}px bar`);
  const glyph = await page.evaluate(() =>
    getComputedStyle(document.getElementById("map-filter-visited"), "::before").content);
  check("pressed state is not colour alone (check glyph)", glyph.includes("✓"), glyph);

  // Contrast in BOTH themes, pressed and unpressed. Reading mid-transition has
  // produced false failures on this project twice, so settle animations first.
  for (const theme of ["light", "dark"]) {
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"),
      null, { timeout: 5000 }).catch(() => {});
    const measured = await page.evaluate(() => {
      const parse = s => {
        const n = s.match(/[\d.]+/g).map(Number);
        return s.startsWith("color(") ? n.slice(0, 3).map(v => v * 255) : n.slice(0, 3);
      };
      const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = el => {
        const cs = getComputedStyle(el);
        let node = el, bg = null;
        while (node && !bg) {
          const c = getComputedStyle(node).backgroundColor;
          if (c && !/rgba?\([^)]*,\s*0\)/.test(c) && c !== "transparent") bg = parse(c);
          node = node.parentElement;
        }
        const a = lum(parse(cs.color)), b = lum(bg || [255, 255, 255]);
        return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
      };
      return {
        pressed: ratio(document.getElementById("map-filter-visited")),
        unpressed: ratio(document.getElementById("map-filter-called")),
        status: ratio(document.getElementById("map-flag-filter-status")),
      };
    });
    check(`pressed chip contrast >= 4.5:1 (${theme})`, measured.pressed >= 4.5, `${measured.pressed}:1`);
    check(`unpressed chip contrast >= 4.5:1 (${theme})`, measured.unpressed >= 4.5, `${measured.unpressed}:1`);
    check(`scope statement contrast >= 4.5:1 (${theme})`, measured.status >= 4.5, `${measured.status}:1`);
  }
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });

  // Screenshot the chips themselves, not the collapsed drawer — geometry
  // assertions are blind to typography and this is the only step that sees it.
  await page.evaluate(async () => {
    await setMapFlagFilter("called", "no");     // back to a single clean facet
    toggleMapDrawer("filters");
  });
  await page.waitForTimeout(700);
  await page.locator("#map-flag-filters").scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: `verify-tmp/t69-${label}.png` });
  const chipBox = await page.locator("#map-flag-filters").boundingBox();
  if (chipBox) await page.screenshot({
    path: `verify-tmp/t69-${label}-chips.png`,
    clip: { x: Math.max(0, chipBox.x - 8), y: Math.max(0, chipBox.y - 8), width: Math.min(chipBox.width + 16, 1100), height: chipBox.height + 16 },
  });
  await browser.close();
}

// With no flags anywhere the bar must not appear — pressing a chip there would
// silently empty the map.
async function noFlags() {
  console.log("\n=== a list with nothing visited or called ===");
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext()).newPage();
  await open(page, { A: { name: "A", permits: ["P1"], ticks: {}, called: {}, focal: null, sharedId: null } });
  check("the chip bar hides when no flag can exist yet",
    await page.locator("#map-flag-filters").evaluate(el => el.hidden));
  await browser.close();
}

(async () => {
  await run("desktop", {});
  await run("iPhone13", { ...devices["iPhone 13"] });
  await noFlags();
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
