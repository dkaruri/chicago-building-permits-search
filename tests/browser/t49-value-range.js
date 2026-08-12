// t49-value-range.js — FEAT-021 permit value range on Search + Map Search.
// Desktop AND iPhone 13, geometry asserted rather than DOM presence.
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot");

const BASE = "http://localhost:8791";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

// Permits the stubbed Worker returns. The Worker does the range filtering for
// real, so the page's job is only to SEND the bounds — asserted on the URL.
const WORKER_ROWS = [
  { permit_number: "P1", permit_status: "ACTIVE", issue_date: "2026-07-01", address: "1 N MAIN", reported_cost: 5000, work_description: "small" },
  { permit_number: "P2", permit_status: "ACTIVE", issue_date: "2026-07-02", address: "2 N MAIN", reported_cost: 500000, work_description: "big" },
];

// Map rows come straight from Socrata and are filtered in the browser.
const SOCRATA_ROWS = [
  { permit_: "M1", permit_status: "ACTIVE", issue_date: "2026-07-05T00:00:00", street_number: "1", street_direction: "N", street_name: "CLARK", reported_cost: "10000", latitude: "41.90", longitude: "-87.63", ward: "42", community_area: "8", work_type: "NEW", work_description: "cheap job" },
  { permit_: "M2", permit_status: "ACTIVE", issue_date: "2026-07-06T00:00:00", street_number: "2", street_direction: "N", street_name: "CLARK", reported_cost: "250000", latitude: "41.91", longitude: "-87.63", ward: "42", community_area: "8", work_type: "NEW", work_description: "mid job" },
  { permit_: "M3", permit_status: "ACTIVE", issue_date: "2026-07-07T00:00:00", street_number: "3", street_direction: "N", street_name: "CLARK", reported_cost: "9000000", latitude: "41.92", longitude: "-87.63", ward: "42", community_area: "8", work_type: "NEW", work_description: "huge job" },
  // No reported_cost at all — must NOT survive a bounded search.
  { permit_: "M4", permit_status: "ACTIVE", issue_date: "2026-07-08T00:00:00", street_number: "4", street_direction: "N", street_name: "CLARK", latitude: "41.93", longitude: "-87.63", ward: "42", community_area: "8", work_type: "NEW", work_description: "unpriced job" },
];

async function stubIndex(page, seen) {
  await page.route("**/api/stats*", r => r.fulfill({ json: { row_count: 1, open_permit_count: 1, general_contractor_count: 1, open_sub_count: 1, cached_at: "2026-07-31" } }));
  await page.route("**/api/permits*", r => {
    seen.push(new URL(r.request().url()).search);
    r.fulfill({ json: { rows: WORKER_ROWS, row_count: WORKER_ROWS.length, offset: 0, limit: 1000 } });
  });
}

async function stubMap(page) {
  await page.route("**/api/stats*", r => r.fulfill({ json: { row_count: 1, open_permit_count: 1, general_contractor_count: 1, open_sub_count: 1, cached_at: "2026-07-31" } }));
  await page.route("**/data/general_contractors.json", r => r.fulfill({ json: [] }));
  await page.route("**/resource/ydr8-5enu.json*", r => r.fulfill({ json: SOCRATA_ROWS }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ json: [] }));
}

// ---------------------------------------------------------------- Search page

async function searchPage(browser, deviceOpts, label) {
  const ctx = await browser.newContext(deviceOpts);
  const page = await ctx.newPage();
  const seen = [];
  await stubIndex(page, seen);
  await page.goto(`${BASE}/index.html`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });

  // Hidden in the contractor directory modes: those rows carry only a lifetime
  // reported_cost_total, which is a different number from a permit's value.
  const hiddenInGc = await page.evaluate(() => {
    setMode("general_contractors");
    return $("cost-min-field").offsetParent === null && $("cost-max-field").offsetParent === null;
  });
  ok(`[${label}] value range hidden in General Contractors mode`, hiddenInGc);

  await page.evaluate(() => setMode("open_permits"));
  await page.waitForFunction(() => document.body.dataset.ready === "1");
  const shownInPermits = await page.evaluate(() =>
    $("cost-min-field").offsetParent !== null && $("cost-max-field").offsetParent !== null);
  ok(`[${label}] value range shown in Open Permits mode`, shownInPermits);

  // Geometry, not presence. The 44px touch floor is a MOBILE rule; on desktop
  // these match the panel's established 36px control size.
  const geo = await page.evaluate(() => ["cost-min", "cost-max", "q", "sort"].map(id => {
    const el = $(id);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { id, h: r.height, w: r.width, font: parseFloat(cs.fontSize), right: r.right };
  }));
  const mine = geo.filter(g => g.id.startsWith("cost-"));
  if (deviceOpts.isMobile) {
    ok(`[${label}] both inputs >= 44px tall`, mine.every(g => g.h >= 44), JSON.stringify(mine));
  }
  // Parity with the existing sibling controls, rather than an absolute font
  // floor: these inputs sit below 16px site-wide (index.html shrinks html to
  // 15px under 640px), which is a pre-existing iOS-zoom issue across every
  // filter field on the page — see FIX-025. This catches a regression that
  // shrinks ONLY the new fields.
  ok(`[${label}] inputs match the sibling controls' font size`,
    mine.every(g => Math.abs(g.font - geo.find(x => x.id === "sort").font) < 0.51), JSON.stringify(geo));
  ok(`[${label}] neither input overflows the viewport`, mine.every(g => g.right <= page.viewportSize().width + 0.5), JSON.stringify(mine));

  // Every input has an accessible name from its visible wrapping label.
  const names = await page.evaluate(() => ["cost-min", "cost-max"].map(id =>
    ($(id).closest("label")?.textContent || "").trim()));
  ok(`[${label}] inputs carry visible labels`, names.every(n => /value/i.test(n) && n.includes("$")), JSON.stringify(names));

  // The bounds must reach the Worker — filtering client-side would be truncated
  // by the endpoint's 1000-row issue_date cap.
  seen.length = 0;
  await page.evaluate(async () => {
    $("cost-min").value = "50000";
    $("cost-max").value = "750000";
    await search();
  });
  const sent = seen.join("|");
  ok(`[${label}] cost_min sent to the Worker`, sent.includes("cost_min=50000"), sent);
  ok(`[${label}] cost_max sent to the Worker`, sent.includes("cost_max=750000"), sent);

  // One bound only.
  seen.length = 0;
  await page.evaluate(async () => { $("cost-max").value = ""; await search(); });
  const oneSided = seen.join("|");
  ok(`[${label}] a blank max sends no cost_max`, oneSided.includes("cost_min=50000") && !oneSided.includes("cost_max"), oneSided);

  // min > max: inline error, announced, and no pointless request.
  seen.length = 0;
  const bad = await page.evaluate(async () => {
    $("cost-min").value = "900000";
    $("cost-max").value = "1000";
    await search();
    const box = $("cost-error");
    return {
      visible: !box.hidden && box.offsetParent !== null,
      role: box.getAttribute("role"),
      text: box.textContent.trim(),
      invalid: $("cost-min").getAttribute("aria-invalid"),
      described: $("cost-min").getAttribute("aria-describedby"),
      rows: state.filteredRows.length,
    };
  });
  ok(`[${label}] min>max shows an inline error`, bad.visible, JSON.stringify(bad));
  ok(`[${label}] error is role=alert and self-explaining`, bad.role === "alert" && /higher than max/i.test(bad.text), JSON.stringify(bad));
  ok(`[${label}] fields marked aria-invalid and described by the error`, bad.invalid === "true" && bad.described === "cost-error", JSON.stringify(bad));
  ok(`[${label}] min>max issues no request and returns no rows`, seen.length === 0 && bad.rows === 0, `${seen.length} ${bad.rows}`);

  // "Error near the field" is a layout claim, not a DOM-order one: the mobile
  // panel is an order:N grid, and `.controls > p { order: 8 }` once dropped this
  // message below the Search button, a screen away from the inputs.
  const placement = await page.evaluate(() => {
    const y = id => $(id).getBoundingClientRect().top;
    return { err: y("cost-error"), max: y("cost-max"), sort: y("sort") };
  });
  ok(`[${label}] error renders directly below the range, above Sort`,
    placement.err > placement.max && placement.err < placement.sort, JSON.stringify(placement));

  // Error must be legible in BOTH themes (it is the only failure signal).
  const contrast = await page.evaluate(() => {
    const lum = c => {
      const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const out = {};
    for (const theme of ["light", "dark"]) {
      document.documentElement.setAttribute("data-theme", theme);
      const cs = getComputedStyle($("cost-error"));
      const a = lum(cs.color), b = lum(cs.backgroundColor);
      out[theme] = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }
    return out;
  });
  ok(`[${label}] error text >= 4.5:1 in light`, contrast.light >= 4.5, JSON.stringify(contrast));
  ok(`[${label}] error text >= 4.5:1 in dark`, contrast.dark >= 4.5, JSON.stringify(contrast));

  // Clear results wipes the range and the error with it.
  const cleared = await page.evaluate(async () => {
    await clearSearch();
    return { min: $("cost-min").value, max: $("cost-max").value, err: $("cost-error").hidden };
  });
  ok(`[${label}] Clear results resets the range and the error`, cleared.min === "" && cleared.max === "" && cleared.err, JSON.stringify(cleared));

  await ctx.close();
}

// ------------------------------------------------------------------- Map page

async function mapPage(browser, deviceOpts, label) {
  const ctx = await browser.newContext(deviceOpts);
  const page = await ctx.newPage();
  await stubMap(page);
  await page.addInitScript(() => {
    localStorage.setItem("chi_permit_map_settings", JSON.stringify({
      dateFrom: "2026-07-01", dateTo: "2026-07-31",
      gcMin: "", gcMax: "", costMin: "", costMax: "", neighborhood: "", q: "", radiusMiles: ""
    }));
  });
  await page.goto(`${BASE}/map.html`);
  await page.waitForFunction(() => document.body.dataset.ready === "1" && typeof state !== "undefined" && state.map && state.map.map, null, { timeout: 30000 });
  await page.waitForFunction(() => state.map.filteredRows.length > 0, null, { timeout: 20000 });

  const all = await page.evaluate(() => state.map.filteredRows.map(r => r.n));
  ok(`[${label}] unbounded map shows every permit`, all.length === 4, JSON.stringify(all));

  const apply = (min, max) => page.evaluate(async ([min, max]) => {
    $("map-cost-min").value = min;
    $("map-cost-max").value = max;
    await applyMapFilters();
    return state.map.filteredRows.map(r => r.n);
  }, [min, max]);

  ok(`[${label}] range keeps only permits inside it`, JSON.stringify(await apply("50000", "500000")) === JSON.stringify(["M2"]));
  ok(`[${label}] min alone is a lower bound`, JSON.stringify((await apply("50000", "")).sort()) === JSON.stringify(["M2", "M3"]));
  ok(`[${label}] max alone is an upper bound`, JSON.stringify((await apply("", "50000")).sort()) === JSON.stringify(["M1"]));

  // A permit with no reported cost cannot be shown to sit in a range.
  const unpriced = await apply("0", "99999999");
  ok(`[${label}] unpriced permits drop out of a bounded search`, !unpriced.includes("M4"), JSON.stringify(unpriced));
  const unbounded = await apply("", "");
  ok(`[${label}] unpriced permits return when unbounded`, unbounded.includes("M4"), JSON.stringify(unbounded));

  // Bounds are inclusive at both ends.
  ok(`[${label}] bounds are inclusive`, JSON.stringify((await apply("10000", "250000")).sort()) === JSON.stringify(["M1", "M2"]));

  // The map source the user actually sees must match the filtered rows.
  const painted = await page.evaluate(() => {
    const src = state.map.map.getSource("permits");
    return (src && src._data ? src._data.features : []).map(f => f.properties.n);
  });
  ok(`[${label}] rendered map source matches the filter`, JSON.stringify(painted.sort()) === JSON.stringify(["M1", "M2"]), JSON.stringify(painted));

  // Persisted, like every other map filter.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("chi_permit_map_settings")));
  ok(`[${label}] range persists to localStorage`, saved.costMin === "10000" && saved.costMax === "250000", JSON.stringify(saved));

  // min > max: error in the DRAWER (the status strip is display:none on mobile).
  const bad = await page.evaluate(async () => {
    const before = state.map.filteredRows.map(r => r.n);
    $("map-cost-min").value = "900000";
    $("map-cost-max").value = "1000";
    await applyMapFilters();
    const box = $("map-cost-error");
    return {
      hidden: box.hidden,
      inDrawer: !!box.closest("#map-filter-drawer"),
      role: box.getAttribute("role"),
      text: box.textContent.trim(),
      invalid: $("map-cost-min").getAttribute("aria-invalid"),
      unchanged: JSON.stringify(before) === JSON.stringify(state.map.filteredRows.map(r => r.n)),
    };
  });
  ok(`[${label}] map min>max shows an error`, !bad.hidden && /higher than max/i.test(bad.text), JSON.stringify(bad));
  ok(`[${label}] map error lives in the drawer, not the status strip`, bad.inDrawer && bad.role === "alert", JSON.stringify(bad));
  ok(`[${label}] map fields marked aria-invalid`, bad.invalid === "true", JSON.stringify(bad));
  ok(`[${label}] invalid range leaves the map untouched`, bad.unchanged, JSON.stringify(bad));

  // Geometry of the drawer fields.
  await page.evaluate(() => { $("map-filter-drawer").classList.remove("hidden"); });
  const geo = await page.evaluate(() => ["map-cost-min", "map-cost-max", "map-gc-min"].map(id => {
    const el = $(id);
    const r = el.getBoundingClientRect();
    return { id, h: r.height, font: parseFloat(getComputedStyle(el).fontSize), right: r.right, label: (el.closest("label")?.textContent || "").trim() };
  }));
  const mine = geo.filter(g => g.id.startsWith("map-cost-"));
  const sibling = geo.find(g => g.id === "map-gc-min");
  if (deviceOpts.isMobile) {
    ok(`[${label}] map inputs >= 44px tall`, mine.every(g => g.h >= 44), JSON.stringify(mine));
  }
  // Parity with the GC jobs pair they sit beside — see the note on the Search
  // page above and FIX-025 for the site-wide sub-16px input issue.
  ok(`[${label}] map inputs match the GC jobs fields`,
    mine.every(g => Math.abs(g.font - sibling.font) < 0.51 && Math.abs(g.h - sibling.h) < 1.5), JSON.stringify(geo));
  ok(`[${label}] map inputs stay inside the viewport`, mine.every(g => g.right <= page.viewportSize().width + 0.5), JSON.stringify(mine));
  ok(`[${label}] map inputs carry visible labels`, mine.every(g => /value/i.test(g.label) && g.label.includes("$")), JSON.stringify(mine));

  // The min/max pair must not be split across a wrap.
  const sameRow = await page.evaluate(() =>
    Math.abs($("map-cost-min").getBoundingClientRect().top - $("map-cost-max").getBoundingClientRect().top) < 2);
  ok(`[${label}] min and max sit on the same row`, sameRow);

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const iphone = { ...devices["iPhone 13"] };
  for (const [opts, label] of [[{ viewport: { width: 1280, height: 900 } }, "desktop"], [iphone, "iPhone 13"]]) {
    console.log(`\n== Search — ${label}`);
    await searchPage(browser, opts, label);
    console.log(`\n== Map — ${label}`);
    await mapPage(browser, opts, label);
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
