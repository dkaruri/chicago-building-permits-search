// Mutation control for FIX-036. map.html is CRLF — SINGLE-LINE anchors only.
// Mutant 1 restores the original bug (label bound to the polygon source);
// mutant 2 restores the invisible boundary. Both must go red.
const fs = require("fs");
const { execFileSync } = require("child_process");
const FILE = "docs/map.html";

const MUTANTS = [
  ["labels bound to the POLYGON source again (per-tile duplicates, centroid placement)",
   [['          source: "zoning-label-points",', '          source: "zoning",']]],
  ["the boundary is painted in each district's own fill colour again (invisible)",
   [['            "line-color": "#374151",', '            "line-color": zoneColorMatch,']]],
  ["the label point falls back to a plain centroid (can land outside a concave district)",
   [["      return best == null ? [sx / ring.length, cy] : [best, cy];",
     "      return [sx / ring.length, cy];"]]],
  ["the layer toggle stops governing the labels",
   [['      setLayerVisibility("zoning-label", state.map.layers.zoning);', "      ;"]]],
  ["boundary width stops scaling with zoom",
   [['            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.4, 13, 0.9, 15, 1.6, 17, 2.4],',
     '            "line-width": 0.6,']]],
];

const original = fs.readFileSync(FILE);
let bad = 0;
for (const [name, pairs] of MUTANTS) {
  let src = original.toString("latin1");
  let ok = true;
  for (const [from, to] of pairs) {
    if (!from || !to || from === to) { ok = false; break; }
    if (!src.includes(from)) { console.log(`SKIPPED (anchor missing!)  ${name}`); ok = false; break; }
    src = src.replace(from, to);
  }
  if (!ok) { bad++; fs.writeFileSync(FILE, original); continue; }
  fs.writeFileSync(FILE, Buffer.from(src, "latin1"));
  let red = false;
  try { execFileSync("node", ["verify-tmp/t74-zoning-boundaries.js"], { stdio: "pipe" }); } catch { red = true; }
  console.log(`${red ? "CAUGHT " : "MISSED "}  ${name}`);
  if (!red) bad++;
  fs.writeFileSync(FILE, original);
}
console.log(bad ? `\n${bad} MUTANT(S) NOT CAUGHT` : "\nALL MUTANTS CAUGHT");
process.exit(bad ? 1 : 0);
