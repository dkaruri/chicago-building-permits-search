import { test } from "node:test";
import assert from "node:assert";
import {
  zoneCategoryAt, mapWorkTypeKey, mapRowMatchesPropertyUse, mapExcludedWorkTypes,
  PROPERTY_USE_OPTIONS, useZoneIndex, loadRealZoning, box, feature, collection
} from "./feat024-impl.mjs";

// A synthetic city: three districts side by side, plus one with a hole.
const CITY = collection(
  feature("residential", "RS-3", [box(-87.70, 41.90, -87.69, 41.91)]),
  feature("business", "B3-2", [box(-87.69, 41.90, -87.68, 41.91)]),
  feature("commercial", "C1-2", [box(-87.68, 41.90, -87.67, 41.91)]),
  feature("downtown", "DR-3", [box(-87.63, 41.88, -87.62, 41.89)]),
  feature("downtown", "DX-12", [box(-87.62, 41.88, -87.61, 41.89)]),
  // A manufacturing block with a residential parcel punched out of the middle.
  feature("manufacturing", "M1-2", [box(-87.75, 41.95, -87.73, 41.97), box(-87.745, 41.955, -87.735, 41.965)])
);

test("point-in-polygon finds the containing district", () => {
  useZoneIndex(CITY);
  assert.equal(zoneCategoryAt(-87.695, 41.905).zcat, "residential");
  assert.equal(zoneCategoryAt(-87.685, 41.905).zcat, "business");
  assert.equal(zoneCategoryAt(-87.675, 41.905).zcat, "commercial");
  assert.equal(zoneCategoryAt(-87.625, 41.885).zoneClass, "DR-3");
});

test("a point in a polygon HOLE is outside the district, not inside it", () => {
  useZoneIndex(CITY);
  assert.equal(zoneCategoryAt(-87.748, 41.958).zcat, "manufacturing", "inside the ring, outside the hole");
  assert.equal(zoneCategoryAt(-87.740, 41.960), null, "inside the hole");
});

test("a point in no district is null, not a guess", () => {
  useZoneIndex(CITY);
  assert.equal(zoneCategoryAt(-87.60, 41.80), null);
  assert.equal(zoneCategoryAt(0, 0), null);
});

test("bad coordinates never throw", () => {
  useZoneIndex(CITY);
  for (const [lon, lat] of [[NaN, 41.9], [-87.7, NaN], [undefined, undefined], [null, null]]) {
    assert.equal(zoneCategoryAt(Number(lon), Number(lat)), null);
  }
});

test("no index at all degrades to null rather than throwing", () => {
  useZoneIndex(null);
  assert.equal(zoneCategoryAt(-87.695, 41.905), null);
});

test("degenerate geometry is skipped, not crashed on", () => {
  const broken = collection(
    { type: "Feature", properties: {}, geometry: null },
    feature("residential", "RS-1", [[[-87.7, 41.9], [-87.6, 41.9]]]), // too few points
    { type: "Feature", properties: { zcat: "residential" }, geometry: { type: "Point", coordinates: [-87.7, 41.9] } },
    feature("residential", "RS-2", [box(-87.70, 41.90, -87.69, 41.91)])
  );
  useZoneIndex(broken);
  assert.equal(zoneCategoryAt(-87.695, 41.905).zoneClass, "RS-2");
});

// --- property-use predicate ---

const at = (lon, lat) => ({ lon, lat });

test("residential mode keeps RS/RT/RM and downtown DR only", () => {
  useZoneIndex(CITY);
  assert.equal(mapRowMatchesPropertyUse(at(-87.695, 41.905), "residential"), true, "RS-3");
  assert.equal(mapRowMatchesPropertyUse(at(-87.625, 41.885), "residential"), true, "DR-3 is downtown RESIDENTIAL");
  assert.equal(mapRowMatchesPropertyUse(at(-87.615, 41.885), "residential"), false, "DX-12 is not");
  assert.equal(mapRowMatchesPropertyUse(at(-87.685, 41.905), "residential"), false, "business excluded");
  assert.equal(mapRowMatchesPropertyUse(at(-87.675, 41.905), "residential"), false, "commercial excluded");
});

test("residential_business additionally keeps B1-B3", () => {
  useZoneIndex(CITY);
  assert.equal(mapRowMatchesPropertyUse(at(-87.685, 41.905), "residential_business"), true);
  assert.equal(mapRowMatchesPropertyUse(at(-87.695, 41.905), "residential_business"), true);
  assert.equal(mapRowMatchesPropertyUse(at(-87.675, 41.905), "residential_business"), false, "commercial still excluded");
});

test("permits in NO district are kept, never invented into a category", () => {
  useZoneIndex(CITY);
  assert.equal(mapRowMatchesPropertyUse(at(-87.60, 41.80), "residential"), true);
  assert.equal(mapRowMatchesPropertyUse(at(-87.740, 41.960), "residential"), true, "inside a hole = no district");
});

test("empty mode is a pass-through, and does not even consult the index", () => {
  useZoneIndex(null);
  assert.equal(mapRowMatchesPropertyUse(at(-87.675, 41.905), ""), true);
  assert.equal(mapRowMatchesPropertyUse(at(-87.675, 41.905), undefined), true);
});

test("a failed zoning load shows everything rather than emptying the map", () => {
  // ensureZoneIndex resolving false leaves zoneIndex null; the predicate must not
  // then hide every row.
  useZoneIndex(null);
  for (const mode of ["residential", "residential_business"]) {
    assert.equal(mapRowMatchesPropertyUse(at(-87.675, 41.905), mode), true, mode);
  }
});

test("the three property-use options are the ones the design settled on", () => {
  assert.deepEqual(PROPERTY_USE_OPTIONS.map(o => o.value), ["", "residential", "residential_business"]);
  // District codes must appear in the labels — the control has to say what it hides.
  assert.match(PROPERTY_USE_OPTIONS[1].label, /RS, RT, RM, DR/);
  assert.match(PROPERTY_USE_OPTIONS[2].label, /B1.B3/);
});

// --- work-type bucketing ---

test("an Express permit buckets by its own work_type", () => {
  assert.equal(mapWorkTypeKey({ wt: "Electrical Work", t: "PERMIT – EXPRESS PERMIT PROGRAM" }), "Electrical Work");
  assert.equal(mapWorkTypeKey({ wt: "Reroofing", t: "PERMIT – EXPRESS PERMIT PROGRAM" }), "Reroofing");
});

test("a work_type containing commas is ONE label, never split", () => {
  const key = mapWorkTypeKey({ wt: "Porch,Deck,Balcony,or Fire Escape", t: "PERMIT – EXPRESS PERMIT PROGRAM" });
  assert.equal(key, "Porch,Deck,Balcony,or Fire Escape");
});

test("the two blank-work_type permit types get synthesized buckets", () => {
  assert.equal(mapWorkTypeKey({ wt: "", t: "PERMIT - RENOVATION/ALTERATION" }), "Renovation / alteration");
  assert.equal(mapWorkTypeKey({ wt: null, t: "PERMIT - NEW CONSTRUCTION" }), "New construction");
  assert.equal(mapWorkTypeKey({ t: "permit - new construction" }), "New construction", "case insensitive");
});

test("an unseen blank-work_type permit type still gets a readable bucket", () => {
  // The EN DASH in the Express type differs from the hyphen in the other two.
  assert.equal(mapWorkTypeKey({ wt: "", t: "PERMIT – EXPRESS PERMIT PROGRAM" }), "Express permit program");
  assert.equal(mapWorkTypeKey({ wt: "", t: "PERMIT - WRECKING/DEMOLITION" }), "Wrecking/demolition");
  assert.equal(mapWorkTypeKey({ wt: "", t: "" }), "Unspecified");
  assert.equal(mapWorkTypeKey({}), "Unspecified");
  assert.equal(mapWorkTypeKey(null), "Unspecified");
});

test("whitespace-only work_type falls through to the permit type", () => {
  assert.equal(mapWorkTypeKey({ wt: "   ", t: "PERMIT - NEW CONSTRUCTION" }), "New construction");
});

// --- persisted exclusions ---

test("excluded work types are de-duplicated and trimmed", () => {
  assert.deepEqual(mapExcludedWorkTypes({ excludedWorkTypes: [" Reroofing ", "Reroofing", "Masonry Work"] }),
    ["Reroofing", "Masonry Work"]);
});

test("corrupt persisted state cannot take the filter down", () => {
  for (const value of [null, undefined, "Reroofing", 7, {}, { a: 1 }]) {
    assert.deepEqual(mapExcludedWorkTypes({ excludedWorkTypes: value }), [], String(value));
  }
  assert.deepEqual(mapExcludedWorkTypes({}), []);
  assert.deepEqual(mapExcludedWorkTypes(null), []);
  // Non-strings are dropped rather than stringified: a "0" key would match no work
  // type, so it would filter nothing while sitting in the checklist forever.
  assert.deepEqual(mapExcludedWorkTypes({ excludedWorkTypes: ["", "  ", null, undefined, 0, false, {}, []] }), []);
  assert.deepEqual(mapExcludedWorkTypes({ excludedWorkTypes: [0, "Reroofing", null] }), ["Reroofing"]);
});

// --- the real city file ---

test("the shipped zoning file classifies real Chicago addresses correctly", () => {
  useZoneIndex(loadRealZoning());
  // Coordinates lifted from live permits, cross-checked against the City's map.
  const cases = [
    { name: "Willis Tower, 233 S Wacker", lon: -87.6359, lat: 41.8789, zcat: "downtown" },
    { name: "Logan Square residential block", lon: -87.7078, lat: 41.9276, zcat: "residential" },
    { name: "Lake Michigan, 3 mi offshore", lon: -87.55, lat: 41.90, zcat: null }
  ];
  for (const c of cases) {
    const zone = zoneCategoryAt(c.lon, c.lat);
    assert.equal(zone ? zone.zcat : null, c.zcat, `${c.name} -> ${zone ? zone.zoneClass : "no district"}`);
  }
});

test("every district in the shipped file is reachable through the index", () => {
  const zoning = loadRealZoning();
  const index = useZoneIndex(zoning);
  assert.ok(index.rings.length > 14000, `only ${index.rings.length} rings indexed`);
  // Sampling a lat/lon rectangle would mostly measure how much of the rectangle is
  // Lake Michigan and suburb. Instead, take a point known to be in each sampled
  // district and require it to resolve to SOME district — that exercises parsing,
  // bbox rejection, grid bucketing and ray casting across the whole real file, and
  // a regression in any of them collapses the rate rather than moving it a little.
  let sampled = 0, resolved = 0;
  for (let i = 0; i < zoning.features.length; i += 37) {
    const geometry = zoning.features[i].geometry;
    if (!geometry) continue;
    const ring = geometry.type === "Polygon" ? geometry.coordinates[0]
      : geometry.type === "MultiPolygon" ? geometry.coordinates[0][0]
      : null;
    if (!ring || ring.length < 4) continue;
    let x = 0, y = 0;
    for (const point of ring) { x += point[0]; y += point[1]; }
    x /= ring.length;
    y /= ring.length;
    sampled++;
    if (zoneCategoryAt(x, y)) resolved++;
  }
  assert.ok(sampled > 300, `only ${sampled} districts sampled`);
  const rate = resolved / sampled;
  assert.ok(rate > 0.9, `only ${(rate * 100).toFixed(1)}% of ${sampled} district interiors resolved`);
});

test("classifying a realistic month of points stays well inside a frame budget", () => {
  useZoneIndex(loadRealZoning());
  const points = [];
  for (let i = 0; i < 2400; i++) {
    points.push([-87.82 + (i % 140) * 0.0019, 41.66 + ((i * 7) % 180) * 0.002]);
  }
  const started = Date.now();
  for (const [lon, lat] of points) zoneCategoryAt(lon, lat);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 250, `classifying 2,400 points took ${elapsed}ms`);
});
