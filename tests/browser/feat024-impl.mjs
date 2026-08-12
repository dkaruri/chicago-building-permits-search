// FEAT-024. Extracted from docs/map.html AT TEST TIME rather than hand-copied.
// The sibling *-impl.mjs files in this directory are static transcriptions, which
// can silently drift from the page they claim to mirror — and a test that agrees
// with a stale copy proves nothing about what ships.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTML = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "map.html");
const source = readFileSync(HTML, "utf8");

// Slice out a top-level `function name(...) { ... }` by brace matching. Naive
// counting is fine here: these functions contain no braces inside strings,
// template literals or regex literals, and the extraction asserts it found one.
function extractFunction(name) {
  const start = source.indexOf(`\n    function ${name}(`);
  if (start < 0) throw new Error(`FEAT-024 extraction failed: no function ${name} in docs/map.html`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`FEAT-024 extraction failed: unbalanced braces in ${name}`);
}

function extractConst(name) {
  const start = source.indexOf(`\n    const ${name} =`);
  if (start < 0) throw new Error(`FEAT-024 extraction failed: no const ${name} in docs/map.html`);
  const end = source.indexOf("\n    ;", start);
  const semi = source.indexOf(";", source.indexOf("=", start));
  return source.slice(start, (end > -1 && end < semi ? end : semi) + 1);
}

const preamble = `
  const clean = value => (value === null || value === undefined) ? "" : String(value);
  const state = { map: { zoneIndex: null } };
`;

const bundle = [
  preamble,
  extractConst("ZONE_CELL"),
  extractConst("MAP_PERMIT_TYPE_WORK_LABELS"),
  extractConst("PROPERTY_USE_OPTIONS"),
  extractFunction("buildZoneIndex"),
  extractFunction("pointInRing"),
  extractFunction("zoneCategoryAt"),
  extractFunction("mapWorkTypeKey"),
  extractFunction("mapRowMatchesPropertyUse"),
  extractFunction("mapExcludedWorkTypes"),
  "return { state, ZONE_CELL, MAP_PERMIT_TYPE_WORK_LABELS, PROPERTY_USE_OPTIONS, buildZoneIndex, pointInRing, zoneCategoryAt, mapWorkTypeKey, mapRowMatchesPropertyUse, mapExcludedWorkTypes };"
].join("\n");

export const map = new Function(bundle)();
export const {
  state, ZONE_CELL, PROPERTY_USE_OPTIONS,
  buildZoneIndex, pointInRing, zoneCategoryAt,
  mapWorkTypeKey, mapRowMatchesPropertyUse, mapExcludedWorkTypes
} = map;

// Install a zone index so zoneCategoryAt has something to read.
export function useZoneIndex(geojson) {
  state.map.zoneIndex = geojson ? buildZoneIndex(geojson) : null;
  return state.map.zoneIndex;
}

// The real city file, for the coverage assertions.
export function loadRealZoning() {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "data", "zoning.geojson");
  return JSON.parse(readFileSync(path, "utf8"));
}

// Square ring helper: [[minX,minY],...] closed, counter-clockwise.
export function box(minX, minY, maxX, maxY) {
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]];
}

export function feature(zcat, zone_class, coordinates, type = "Polygon") {
  return { type: "Feature", properties: { zcat, zone_class }, geometry: { type, coordinates } };
}

export function collection(...features) {
  return { type: "FeatureCollection", features };
}
