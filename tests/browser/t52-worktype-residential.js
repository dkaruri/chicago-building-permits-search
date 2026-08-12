// t52 (FEAT-024): Map Search can exclude work types and narrow to residential.
//
// Two controls, one shared filter pass:
//   A. an "Exclude work types" checklist, including the two synthesized entries
//      for the permit types that carry a BLANK work_type (renovation and new
//      construction) — 30% of permits, unreachable without them;
//   B. a "Property use" select backed by the zoning district the permit sits in,
//      not by its work description.
//
// Asserts behaviour (which rows survive), not presence — the interesting failure
// modes here all leave the controls sitting there looking correct.
const { chromium, devices } = require("playwright");
const EXE = "C:/Users/divya/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  PASS ${n}`); } else { fail++; console.log(`  FAIL ${n} ${x}`); } };

// A synthetic city: three 0.01-degree blocks, each a different zoning category.
const ring = (minX, minY, maxX, maxY) => [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]];
const ZONING = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { zcat: "residential", zone_class: "RS-3" }, geometry: { type: "Polygon", coordinates: [ring(-87.70, 41.90, -87.69, 41.91)] } },
    { type: "Feature", properties: { zcat: "business", zone_class: "B3-2" }, geometry: { type: "Polygon", coordinates: [ring(-87.69, 41.90, -87.68, 41.91)] } },
    { type: "Feature", properties: { zcat: "commercial", zone_class: "C1-2" }, geometry: { type: "Polygon", coordinates: [ring(-87.68, 41.90, -87.67, 41.91)] } }
  ]
};

// lon/lat chosen to land in a known block. "OFFMAP" is in no district at all.
const IN_RES = { latitude: "41.905", longitude: "-87.695" };
const IN_BIZ = { latitude: "41.905", longitude: "-87.685" };
const IN_COM = { latitude: "41.905", longitude: "-87.675" };
const OFFMAP = { latitude: "41.800", longitude: "-87.600" };

const permit = (id, work_type, permit_type, where, extra = {}) => ({
  permit_: id, permit_status: "ACTIVE", permit_type, work_type,
  issue_date: "2026-07-15T00:00:00.000", street_number: "1", street_direction: "N", street_name: "TEST ST",
  work_description: "TEST", reported_cost: "100000", ward: "1", community_area: "22",
  ...where, ...extra
});

const PERMITS = [
  permit("RES-ELEC", "Electrical Work", "PERMIT – EXPRESS PERMIT PROGRAM", IN_RES),
  permit("RES-ROOF", "Reroofing", "PERMIT – EXPRESS PERMIT PROGRAM", IN_RES),
  permit("RES-PORCH", "Porch,Deck,Balcony,or Fire Escape", "PERMIT – EXPRESS PERMIT PROGRAM", IN_RES),
  permit("RES-RENO", "", "PERMIT - RENOVATION/ALTERATION", IN_RES),
  permit("RES-NEW", "", "PERMIT - NEW CONSTRUCTION", IN_RES),
  permit("BIZ-ELEC", "Electrical Work", "PERMIT – EXPRESS PERMIT PROGRAM", IN_BIZ),
  permit("BIZ-RENO", "", "PERMIT - RENOVATION/ALTERATION", IN_BIZ),
  permit("COM-ELEC", "Electrical Work", "PERMIT – EXPRESS PERMIT PROGRAM", IN_COM),
  permit("COM-ROOF", "Reroofing", "PERMIT – EXPRESS PERMIT PROGRAM", IN_COM),
  permit("NOWHERE", "Reroofing", "PERMIT – EXPRESS PERMIT PROGRAM", OFFMAP)
];

async function boot(ctx, { failZoning = false, seed = null } = {}) {
  const page = await ctx.newPage();
  if (seed) await page.addInitScript(seed);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/tile.openstreetmap.org/**", r => r.fulfill({ status: 200, contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") }));
  await page.route("**/fonts.openmaptiles.org/**", r => r.fulfill({ status: 404, body: "" }));
  await page.route("**/api/**", r => r.fulfill({ json: { rows: [], row_count: 0, lists: [] } }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ json: [] }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ json: PERMITS }));
  // Stubbed rather than served: the real file is 5 MB, and this pins exactly
  // which permits are residential instead of depending on Chicago's geometry.
  await page.route("**/data/zoning.geojson", r => failZoning
    ? r.fulfill({ status: 500, body: "boom" })
    : r.fulfill({ json: ZONING }));
  await page.goto("http://127.0.0.1:8791/map.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return { page, errors };
}

// Widen the date range to cover the fixture, then apply.
const applyWith = (page, mutate) => page.evaluate(async mutate => {
  $("map-date-from").value = "2026-07-01";
  $("map-date-to").value = "2026-07-31";
  // eslint-disable-next-line no-eval
  eval(mutate);
  await applyMapFilters();
  return state.map.filteredRows.map(r => r.n).sort();
}, mutate);

const setExcluded = keys => `document.querySelectorAll("#map-work-type-list input").forEach(b => { b.checked = ${JSON.stringify(keys)}.includes(b.value); });`;
const setUse = value => `$("map-property-use").value = ${JSON.stringify(value)};`;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });

  // ---------- desktop ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const { page, errors } = await boot(ctx);

    const base = await applyWith(page, "void 0;");
    ok("baseline loads every fixture permit", base.length === 10, JSON.stringify(base));

    // --- the checklist itself ---
    await page.evaluate(() => $("map-work-type-details").open = true);
    const types = await page.evaluate(() => Array.from(document.querySelectorAll("#map-work-type-list .wt-name")).map(e => e.textContent));
    ok("checklist offers the Express work types", types.includes("Electrical Work") && types.includes("Reroofing"), JSON.stringify(types));
    ok("checklist synthesizes Renovation / alteration", types.includes("Renovation / alteration"), JSON.stringify(types));
    ok("checklist synthesizes New construction", types.includes("New construction"), JSON.stringify(types));
    ok("a comma-bearing work type is ONE row, not four",
      types.includes("Porch,Deck,Balcony,or Fire Escape") && !types.includes("Deck"), JSON.stringify(types));

    const counts = await page.evaluate(() => Object.fromEntries(
      Array.from(document.querySelectorAll("#map-work-type-list .map-work-type-row"))
        .map(r => [r.querySelector(".wt-name").textContent, r.querySelector(".wt-count").textContent])));
    ok("counts are shown per type", counts["Electrical Work"] === "3" && counts["Reroofing"] === "3", JSON.stringify(counts));
    ok("counts are ordered most-common first",
      types[0] === "Electrical Work" || types[0] === "Reroofing", JSON.stringify(types.slice(0, 3)));

    // --- excluding actually removes rows ---
    const noElec = await applyWith(page, setExcluded(["Electrical Work"]));
    ok("excluding a work type removes exactly its permits",
      JSON.stringify(noElec) === JSON.stringify(["BIZ-RENO", "COM-ROOF", "NOWHERE", "RES-NEW", "RES-PORCH", "RES-RENO", "RES-ROOF"]), JSON.stringify(noElec));

    const noReno = await applyWith(page, setExcluded(["Renovation / alteration", "New construction"]));
    ok("the synthesized entries exclude the blank-work_type permits",
      !noReno.includes("RES-RENO") && !noReno.includes("BIZ-RENO") && !noReno.includes("RES-NEW") && noReno.length === 7, JSON.stringify(noReno));

    const cleared = await applyWith(page, setExcluded([]));
    ok("clearing every exclusion restores the full set", cleared.length === 10, JSON.stringify(cleared));

    // --- property use ---
    const res = await applyWith(page, setUse("residential"));
    ok("residential-only keeps the residentially zoned permits",
      ["RES-ELEC", "RES-ROOF", "RES-PORCH", "RES-RENO", "RES-NEW"].every(n => res.includes(n)), JSON.stringify(res));
    ok("residential-only drops business-zoned permits", !res.includes("BIZ-ELEC") && !res.includes("BIZ-RENO"), JSON.stringify(res));
    ok("residential-only drops commercially zoned permits", !res.includes("COM-ELEC") && !res.includes("COM-ROOF"), JSON.stringify(res));
    ok("a permit in NO zoning district is kept, not invented into a category", res.includes("NOWHERE"), JSON.stringify(res));

    const resBiz = await applyWith(page, setUse("residential_business"));
    ok("residential + business adds the B1-B3 permits",
      resBiz.includes("BIZ-ELEC") && resBiz.includes("BIZ-RENO"), JSON.stringify(resBiz));
    ok("residential + business still drops commercial",
      !resBiz.includes("COM-ELEC") && !resBiz.includes("COM-ROOF"), JSON.stringify(resBiz));

    // --- the two filters combine, and combine with the pre-existing ones ---
    const both = await applyWith(page, setUse("residential") + setExcluded(["Electrical Work", "Reroofing"]));
    ok("both filters apply together",
      JSON.stringify(both) === JSON.stringify(["RES-NEW", "RES-PORCH", "RES-RENO"]), JSON.stringify(both));

    const withCost = await page.evaluate(async () => {
      $("map-cost-min").value = "999999999";
      await applyMapFilters();
      const n = state.map.filteredRows.length;
      $("map-cost-min").value = "";
      return n;
    });
    ok("they compose with the FEAT-021 value range rather than overriding it", withCost === 0, String(withCost));

    const withDate = await page.evaluate(async () => {
      $("map-date-from").value = "2026-06-01";
      $("map-date-to").value = "2026-06-30";
      await applyMapFilters();
      return state.map.filteredRows.length;
    });
    ok("they compose with the date range", withDate === 0, String(withDate));

    // --- the status strip explains a thin map ---
    const strip = await applyWith(page, setUse("residential") + setExcluded(["Electrical Work"]))
      .then(() => page.evaluate(() => $("map-status-strip").textContent));
    ok("status strip names the excluded work types", /1 work type excluded/.test(strip), strip);
    ok("status strip names the property-use filter", /Residential zoning only/.test(strip), strip);

    // --- summary count ---
    const summary = await page.evaluate(() => $("map-work-type-count").textContent);
    ok("collapsed summary states the exclusion count in words", summary === "1 of 5 excluded", summary);
    await page.evaluate(() => setAllMapWorkTypes(true));
    const allSummary = await page.evaluate(() => $("map-work-type-count").textContent);
    ok("Select all ticks every row and the summary follows", allSummary === "5 of 5 excluded", allSummary);
    await page.evaluate(() => setAllMapWorkTypes(false));
    ok("Clear unticks every row", (await page.evaluate(() => $("map-work-type-count").textContent)) === "0 of 5 excluded");

    // --- accessibility ---
    const a11y = await page.evaluate(() => {
      const select = $("map-property-use");
      const label = select.closest("label");
      const summary = $("map-work-type-summary");
      return {
        selectLabelled: Boolean(label && label.textContent.trim().startsWith("Property use")),
        selectDescribed: Boolean(document.getElementById(select.getAttribute("aria-describedby"))),
        summaryHeight: summary.getBoundingClientRect().height,
        optionText: Array.from(select.options).map(o => o.textContent.trim())
      };
    });
    ok("the property-use select has a visible label", a11y.selectLabelled, JSON.stringify(a11y));
    ok("the select's aria-describedby resolves to a real element", a11y.selectDescribed);
    ok("option text names the zoning districts", /RS, RT, RM, DR/.test(a11y.optionText[1]) && /B1.B3/.test(a11y.optionText[2]), JSON.stringify(a11y.optionText));

    // Real Tab, not .focus() — getComputedStyle cannot read :focus-visible, and
    // this also proves the summary is genuinely in the tab order.
    //
    // FIX-049: the drawer has to be OPEN for that to mean anything. This block
    // used to run against the closed drawer and passed only because a closed
    // drawer left all 48 of its controls focusable — it was asserting the tab
    // order of a region the user cannot see, which is the defect FIX-049 fixed.
    // Opened and closed again here so the rest of the suite still starts from
    // the shipped closed state (line ~256 toggles it open on purpose).
    await page.evaluate(() => toggleMapDrawer("filters"));
    await page.waitForTimeout(300);
    const focusRing = await page.evaluate(async () => {
      $("map-property-use").focus();
      return true;
    }).then(() => page.keyboard.press("Tab")).then(() => page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { id: el.id, tag: el.tagName, outline: cs.outlineWidth };
    }));
    await page.evaluate(() => toggleMapDrawer("filters"));
    await page.waitForTimeout(300);
    ok("tabbing past the select reaches a focusable control with a visible ring",
      parseFloat(focusRing.outline) >= 2 || focusRing.id === "map-work-type-summary", JSON.stringify(focusRing));

    // --- persistence ---
    await page.evaluate(async () => {
      $("map-property-use").value = "residential";
      document.querySelectorAll("#map-work-type-list input").forEach(b => { b.checked = b.value === "Reroofing"; });
      await applyMapFilters();
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const restored = await page.evaluate(() => ({
      use: $("map-property-use").value,
      excluded: JSON.parse(localStorage.getItem("chi_permit_map_settings")).excludedWorkTypes,
      rows: state.map.filteredRows.map(r => r.n).sort()
    }));
    ok("the property-use choice survives a reload", restored.use === "residential", JSON.stringify(restored));
    ok("the exclusions survive a reload", JSON.stringify(restored.excluded) === JSON.stringify(["Reroofing"]), JSON.stringify(restored));
    ok("the restored filters are APPLIED on first render, not just shown in the controls",
      !restored.rows.includes("RES-ROOF") && !restored.rows.includes("COM-ELEC"), JSON.stringify(restored.rows));

    const real = errors.filter(e => !/socrata|worker|api|Failed to fetch|net::ERR|profiles|stats/i.test(e));
    ok("no page errors", real.length === 0, JSON.stringify(real));
    await ctx.close();
  }

  // ---------- zoning load failure ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const { page } = await boot(ctx, {
      failZoning: true,
      seed: () => localStorage.setItem("chi_permit_map_settings", JSON.stringify({
        dateFrom: "2026-07-01", dateTo: "2026-07-31", propertyUse: "residential", excludedWorkTypes: []
      }))
    });
    const after = await page.evaluate(() => ({
      rows: state.map.filteredRows.length,
      strip: $("map-status-strip").textContent
    }));
    ok("a failed zoning load shows every permit rather than emptying the map", after.rows === 10, JSON.stringify(after));
    ok("and says why, with a retry route", /zoning/i.test(after.strip) && /again/i.test(after.strip), after.strip);
    await ctx.close();
  }

  // ---------- iPhone 13 ----------
  {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const { page } = await boot(ctx);
    await applyWith(page, "void 0;");
    await page.evaluate(() => { toggleMapDrawer("filters"); $("map-work-type-details").open = true; });
    await page.waitForTimeout(400);

    const m = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".map-work-type-row"));
      const select = $("map-property-use");
      const list = $("map-work-type-list");
      const drawer = document.querySelector(".map-drawer");
      return {
        rowMin: Math.min(...rows.map(r => r.getBoundingClientRect().height)),
        rowCount: rows.length,
        summaryH: $("map-work-type-summary").getBoundingClientRect().height,
        selectFont: parseFloat(getComputedStyle(select).fontSize),
        selectH: select.getBoundingClientRect().height,
        listScrolls: list.scrollHeight > list.clientHeight,
        listBottom: list.getBoundingClientRect().bottom,
        drawerBottom: drawer.getBoundingClientRect().bottom,
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth
      };
    });
    ok(`[iPhone] every checklist row is a 44px target (min ${m.rowMin.toFixed(1)})`, m.rowMin >= 44, JSON.stringify(m));
    ok(`[iPhone] the summary is a 44px target (${m.summaryH.toFixed(1)})`, m.summaryH >= 44, String(m.summaryH));
    ok(`[iPhone] the select clears the iOS zoom floor (${m.selectFont}px)`, m.selectFont >= 16, String(m.selectFont));
    ok(`[iPhone] the select is a 44px target (${m.selectH.toFixed(1)})`, m.selectH >= 44, String(m.selectH));

    // The three defects the SCREENSHOTS caught that every assertion above missed.
    const visual = await page.evaluate(() => {
      const select = $("map-property-use");
      const probe = document.createElement("span");
      const cs = getComputedStyle(select);
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font}`;
      probe.textContent = select.options[1].textContent;
      document.body.appendChild(probe);
      const textWidth = probe.getBoundingClientRect().width;
      probe.remove();
      const row = document.querySelector(".map-work-type-row .wt-name");
      const layerRow = document.querySelector(".check-row span");
      // The neighborhood field is the same full-width rule and had the same
      // specificity bug; measure it here so the pair cannot regress apart.
      const hood = $("map-neighborhood");
      const hoodProbe = document.createElement("span");
      const hoodCs = getComputedStyle(hood);
      hoodProbe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${hoodCs.font}`;
      hoodProbe.textContent = hood.placeholder;
      document.body.appendChild(hoodProbe);
      const hoodTextWidth = hoodProbe.getBoundingClientRect().width;
      hoodProbe.remove();
      return {
        selectWidth: select.getBoundingClientRect().width,
        textWidth,
        hoodWidth: hood.getBoundingClientRect().width,
        hoodTextWidth,
        drawerWidth: document.querySelector(".map-filter-grid").getBoundingClientRect().width,
        rowTransform: getComputedStyle(row).textTransform,
        layerTransform: getComputedStyle(layerRow).textTransform,
        summary: $("map-work-type-count").textContent
      };
    });
    // Below 640px .map-filter-grid is a FLEXBOX, so `grid-column` is inert and a
    // bare `.map-use-field` loses to `.map-filter-grid label` — the select
    // rendered at 50% and clipped "Residential zoning only (RS, RT, RM, DR)".
    ok(`[iPhone] the select is wide enough for its longest option (${visual.selectWidth.toFixed(0)}px for ${visual.textWidth.toFixed(0)}px of text)`,
      visual.selectWidth >= visual.textWidth + 20, JSON.stringify(visual));
    ok("[iPhone] the select spans the full filter row", visual.selectWidth >= visual.drawerWidth - 2, JSON.stringify(visual));
    // Pre-existing bug fixed on this branch: the neighborhood field carried the
    // identical rule and lost the identical specificity fight, so it sat at 50%
    // with "Search area, id, or street" clipped on every phone.
    ok(`[iPhone] the neighborhood field fits its placeholder (${visual.hoodWidth.toFixed(0)}px for ${visual.hoodTextWidth.toFixed(0)}px of text)`,
      visual.hoodWidth >= visual.hoodTextWidth + 20, JSON.stringify(visual));
    ok("[iPhone] the neighborhood field spans the full filter row", visual.hoodWidth >= visual.drawerWidth - 2, JSON.stringify(visual));
    // Work-type names are DATA, not field labels; the global label styling
    // uppercased all 22, inconsistently with the layer toggles right below.
    ok("[iPhone] work-type names are not uppercased", visual.rowTransform === "none", visual.rowTransform);
    ok("[iPhone] and match the layer toggles beneath them", visual.rowTransform === visual.layerTransform, `${visual.rowTransform} vs ${visual.layerTransform}`);
    // The list cuts off mid-row; the summary has to say how many there are.
    ok("[iPhone] the summary states the total, not just the excluded count", /of \d+ excluded/.test(visual.summary), visual.summary);
    // The point of bounding the list: .map-drawer is max-height 720px with
    // overflow visible, so an unbounded list spills OUTSIDE its border. The
    // fixture only has five work types, which does not overflow anything — so
    // pad it to the real 22 and check it actually scrolls rather than grows.
    const bounded = await page.evaluate(() => {
      const list = $("map-work-type-list");
      const cs = getComputedStyle(list);
      const before = list.getBoundingClientRect().height;
      const row = list.querySelector(".map-work-type-row");
      for (let i = 0; i < 20; i++) list.appendChild(row.cloneNode(true));
      const after = list.getBoundingClientRect().height;
      const drawer = document.querySelector(".map-drawer").getBoundingClientRect();
      const result = {
        overflowY: cs.overflowY,
        maxHeight: cs.maxHeight,
        before, after,
        cappedAt: parseFloat(cs.maxHeight),
        contentHeight: list.scrollHeight,
        scrolls: list.scrollHeight > list.clientHeight + 1,
        spills: list.getBoundingClientRect().bottom > drawer.bottom + 1
      };
      for (let i = 0; i < 20; i++) list.lastElementChild.remove();
      return result;
    });
    ok("[iPhone] the checklist is a bounded scroll container", bounded.overflowY === "auto" && /px$/.test(bounded.maxHeight), JSON.stringify(bounded));
    // 22 rows of content, capped at max-height, with the overflow reachable by
    // scrolling rather than by the drawer getting taller.
    ok("[iPhone] a full 22-row list scrolls instead of growing without bound",
      bounded.scrolls && bounded.after <= bounded.cappedAt + 1 && bounded.contentHeight > bounded.cappedAt,
      JSON.stringify(bounded));
    ok("[iPhone] a full 22-row list does not spill outside the drawer", !bounded.spills, JSON.stringify(bounded));
    ok("[iPhone] the checklist does not spill past the drawer", m.listBottom <= m.drawerBottom + 1, JSON.stringify(m));
    ok("[iPhone] no horizontal scroll", m.docW <= m.winW + 1, `${m.docW} vs ${m.winW}`);

    // Contrast of the count text against the drawer, both themes.
    // `control` deliberately poisons the colour first: a probe that only ever
    // reports success proves nothing, and the first version of this one silently
    // reported 3.30:1 for text that measures 6.32:1.
    for (const theme of ["light", "dark", "control"]) {
      const ratio = await page.evaluate(t => {
        document.documentElement.dataset.theme = t === "control" ? "light" : t;
        const el = document.querySelector(".wt-count");
        el.style.color = t === "control" ? "#f0f0f0" : "";
        // MUST handle color(srgb r g b / a) as well as rgb()/rgba(). The drawer's
        // background is a color-mix(), which Chromium computes to the color()
        // form with components in 0-1 — parsing those as 0-255 turns white into
        // near-black and reports a false contrast failure. It did exactly that on
        // the first run of this suite.
        const parse = c => {
          const n = (c.match(/[-\d.]+(?=%?)/g) || []).map(Number);
          const scale = /^color\(/.test(c) ? 255 : 1;
          return { r: n[0] * scale, g: n[1] * scale, b: n[2] * scale, a: n.length > 3 ? n[3] : 1 };
        };
        const lum = ({ r, g, b }) => {
          const f = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const page = parse(getComputedStyle(document.body).backgroundColor);
        let bg = { r: 255, g: 255, b: 255, a: 1 };
        for (let n = el; n; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && !/rgba\(0, 0, 0, 0\)|transparent|\/ 0\)/.test(c)) { bg = parse(c); break; }
        }
        // Composite a translucent surface over the page beneath it.
        const over = k => bg.a * bg[k] + (1 - bg.a) * page[k];
        const a = lum(parse(getComputedStyle(el).color));
        const b = lum({ r: over("r"), g: over("g"), b: over("b") });
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }, theme);
      if (theme === "control") {
        ok(`[iPhone] CONTROL: the contrast probe can report a failure (${ratio.toFixed(2)}:1)`, ratio < 4.5, String(ratio));
      } else {
        ok(`[iPhone] count text meets 4.5:1 in ${theme} (${ratio.toFixed(2)}:1)`, ratio >= 4.5, String(ratio));
      }
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });

    await page.screenshot({ path: "verify-tmp/_shot-t52-iphone.png", fullPage: false });
    await ctx.close();
  }

  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (fail) { console.log(`\n  ${fail} FAILURES`); process.exit(1); }
})();
