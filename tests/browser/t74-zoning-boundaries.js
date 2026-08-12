// FIX-036 — zoning district boundaries and labels.
//
// The property that matters is not "a label exists" but "every label sits
// INSIDE a district of its own class". That is measured here by querying each
// rendered label's screen position against the zoning fill underneath it — the
// exact failure Divyam reported (an RM-4.5 label over what reads as RS-3).
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot.js");

// The RM-4.5 pocket with the most RS-3 neighbours per unit area, computed from
// zoning.geojson — Divyam's case.
const CASE = { lon: -87.68890, lat: 41.91419 };
// A dense downtown block, for label collision and small-polygon behaviour.
const LOOP = { lon: -87.6298, lat: 41.8825 };

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

async function boot(page) {
  await page.route("**/api/**", r => r.fulfill({ json: { rows: [], total: 0, row_count: 0 } }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ json: [] }));
  await page.goto("http://localhost:8791/map.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 60000 });
}

async function zoningOn(page) {
  const t0 = Date.now();
  await page.evaluate(() => setMapLayer("zoning", true));
  await page.waitForFunction(() => {
    const s = state.map.map.getSource("zoning");
    return s && s._data && s._data.features && s._data.features.length > 1000;
  }, null, { timeout: 90000 });
  return Date.now() - t0;
}

// Jump, then wait for the map to be IDLE — not a fixed delay. Querying rendered
// symbols while tiles are still arriving reported "0 labels" on iPhone for a
// build that actually draws 45 of them; a fixed 3s was simply too short on the
// smaller viewport some runs. `idle` fires when nothing is left to load or draw.
async function goto(page, at, zoom) {
  await page.evaluate(({ lon, lat, z }) => state.map.map.jumpTo({ center: [lon, lat], zoom: z }), { ...at, z: zoom });
  await page.evaluate(() => new Promise(resolve => {
    const map = state.map.map;
    if (map.loaded() && !map.isMoving()) { map.once("idle", resolve); } else { map.once("idle", resolve); }
    setTimeout(resolve, 20000); // never hang the suite on a stalled tile
  }));
  await page.waitForTimeout(400); // let symbol placement settle after idle
}

/** For every rendered label, what zoning class is actually under it? */
const labelAudit = page => page.evaluate(() => {
  const map = state.map.map;
  const labels = map.queryRenderedFeatures({ layers: ["zoning-label"] });
  const out = [];
  for (const l of labels) {
    const [lon, lat] = l.geometry.coordinates;
    const p = map.project([lon, lat]);
    const under = map.queryRenderedFeatures(p, { layers: ["zoning-fill"] })
      .map(f => f.properties.zone_class);
    out.push({ says: l.properties.zone_class, under });
  }
  return out;
});

async function run(label, ctxOpts) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext(ctxOpts)).newPage();
  await boot(page);

  // --- performance: cost of switching the layer on --------------------------
  const loadMs = await zoningOn(page);
  const derived = await page.evaluate(() => {
    const s = state.map.map.getSource("zoning-label-points");
    return s && s._data ? s._data.features.length : -1;
  });
  // Four districts in zoning.geojson carry an EMPTY MultiPolygon
  // (coordinates: []) — 2x RS-3, B2-3, RT-4. They cannot be filled, outlined
  // or labelled because they have no inside, so having no label point is
  // correct rather than a gap. Count the ones with real geometry.
  const polys = await page.evaluate(() => state.map.map.getSource("zoning")._data.features
    .filter(f => f.geometry && (f.geometry.coordinates || []).length).length);
  const empty = await page.evaluate(() => state.map.map.getSource("zoning")._data.features
    .filter(f => !f.geometry || !(f.geometry.coordinates || []).length).length);
  check("one label point derived per district that has geometry",
    derived === polys, `${derived} points for ${polys} drawable districts (${empty} empty in the source)`);
  console.log(`   zoning layer on in ${loadMs}ms (fetch + derive)`);

  // --- the reported case ----------------------------------------------------
  await goto(page, CASE, 15.5);


  const audit = await labelAudit(page);
  check("labels are actually rendered at this zoom", audit.length > 0, `${audit.length} labels`);
  const wrong = audit.filter(a => a.under.length && !a.under.includes(a.says));
  check("EVERY label sits inside a district of its own class",
    wrong.length === 0,
    wrong.length ? `${wrong.length} misplaced, e.g. "${wrong[0].says}" over ${JSON.stringify(wrong[0].under)}` : `${audit.length} checked`);

  // No duplicates: the polygon source produced one label per TILE.
  const counts = {};
  for (const a of audit) counts[a.says] = (counts[a.says] || 0) + 1;
  const dupes = await page.evaluate(() => {
    const map = state.map.map;
    const pts = map.queryRenderedFeatures({ layers: ["zoning-label"] });
    const seen = new Map();
    for (const p of pts) {
      const k = p.geometry.coordinates.map(v => v.toFixed(6)).join(",");
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    return [...seen.values()].filter(v => v > 1).length;
  });
  check("no district is labelled twice at the same point", dupes === 0, `${dupes} duplicated points`);

  // --- the boundary must be visible, i.e. NOT the fill colour --------------
  const outline = await page.evaluate(() => ({
    color: state.map.map.getPaintProperty("zoning-outline", "line-color"),
    width: state.map.map.getPaintProperty("zoning-outline", "line-width"),
  }));
  check("the boundary is a contrasting stroke, not each district's own fill colour",
    typeof outline.color === "string" && !JSON.stringify(outline.color).includes("zone_class"),
    JSON.stringify(outline.color).slice(0, 60));
  check("boundary width scales with zoom", Array.isArray(outline.width), JSON.stringify(outline.width).slice(0, 60));

  // --- the RM-4.5 pocket specifically --------------------------------------
  const pocket = await page.evaluate(({ lon, lat }) => {
    const map = state.map.map;
    const p = map.project([lon, lat]);
    const cls = map.queryRenderedFeatures(p, { layers: ["zoning-fill"] }).map(f => f.properties.zone_class);
    // Is there a boundary line drawn within 60px of the case point?
    const near = map.queryRenderedFeatures(
      [[p.x - 60, p.y - 60], [p.x + 60, p.y + 60]], { layers: ["zoning-outline"] });
    return { cls, outlines: near.length };
  }, CASE);
  check("the reported RM-4.5 pocket has a drawn boundary around it",
    pocket.cls.includes("RM-4.5") && pocket.outlines > 0,
    `under=${JSON.stringify(pocket.cls)}, outline features nearby=${pocket.outlines}`);

  // --- dense downtown: labels must not spill or vanish ----------------------
  await goto(page, LOOP, 15.5);

  const loop = await labelAudit(page);
  const loopWrong = loop.filter(a => a.under.length && !a.under.includes(a.says));
  check("downtown: labels still land inside their own district",
    loopWrong.length === 0,
    loopWrong.length ? `${loopWrong.length} of ${loop.length} misplaced` : `${loop.length} checked`);
  check("downtown: labels are not all suppressed by collisions", loop.length > 0, `${loop.length} labels`);

  // --- zoom behaviour -------------------------------------------------------
  await goto(page, CASE, 12);

  const zoomedOut = await page.evaluate(() => ({
    labels: state.map.map.queryRenderedFeatures({ layers: ["zoning-label"] }).length,
    outlines: state.map.map.queryRenderedFeatures({ layers: ["zoning-outline"] }).length,
  }));
  check("zoomed out: boundaries still drawn, labels held back", zoomedOut.outlines > 0 && zoomedOut.labels === 0,
    `${zoomedOut.outlines} outlines, ${zoomedOut.labels} labels at z12`);

  // --- the toggle governs fill, outline AND labels as one unit -------------
  await goto(page, CASE, 15.5);
  await page.waitForTimeout(1500);
  await page.evaluate(() => setMapLayer("zoning", false));
  await page.waitForTimeout(800);
  const off = await page.evaluate(() => ["zoning-fill", "zoning-outline", "zoning-label"]
    .map(id => state.map.map.getLayoutProperty(id, "visibility")));
  check("toggling the layer off hides fill, outline and labels together",
    off.every(v => v === "none"), JSON.stringify(off));
  await page.evaluate(() => setMapLayer("zoning", true));
  await page.waitForTimeout(800);
  const on = await page.evaluate(() => ["zoning-fill", "zoning-outline", "zoning-label"]
    .map(id => state.map.map.getLayoutProperty(id, "visibility")));
  check("toggling it back on restores all three", on.every(v => v === "visible"), JSON.stringify(on));

  await page.close();
  await browser.close();
}

(async () => {
  await run("desktop", { viewport: { width: 900, height: 700 } });
  await run("iPhone13", { ...devices["iPhone 13"] });
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
