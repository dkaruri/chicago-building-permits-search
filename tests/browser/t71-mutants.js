// Mutation control for FIX-035. map.html is CRLF, so anchors are SINGLE-LINE.
// Mutant 1 restores the ORIGINAL bug exactly; the rest break each guarantee.
const fs = require("fs");
const { execFileSync } = require("child_process");
const FILE = "docs/map.html";

const MUTANTS = [
  // The original bug: the fitBounds branch is unguarded again.
  ["fitBounds reframes over the restored viewport (the original bug)",
   "        if (state.map.skipRecentreOnce) {\r\n          // FIX-035. The camera was restored from storage at construction, so",
   "        if (false) {\r\n          // FIX-035. The camera was restored from storage at construction, so"],
  // The subtler bug my first attempt had: the flag is eaten by whichever
  // caller runs first, so the other one is free to reframe.
  ["the flag is consumed even when nothing was suppressed",
   "      if (state.map.searchLocation) {\r\n        if (state.map.skipRecentreOnce) {",
   "      const _eat = state.map.skipRecentreOnce; state.map.skipRecentreOnce = false;\r\n      if (state.map.searchLocation) {\r\n        if (_eat) {"],
  ["the viewport is never saved",
   `state.map.map.on("moveend", saveMapView);`, `void 0;`],
  ["a corrupt saved viewport is trusted instead of validated",
   "      return ok ? { lon, lat, zoom } : null;", "      return { lon, lat, zoom };"],
  ["filters stop being restored from storage",
   "      state.map.settings = { ...defaultMapSettings(), ...saved };",
   "      state.map.settings = { ...defaultMapSettings() };"],
];

const original = fs.readFileSync(FILE);
let bad = 0;
for (const [name, from, to] of MUTANTS) {
  const src = original.toString("latin1");
  if (!from || !to || from === to) { console.log(`BAD MUTANT (empty/no-op)  ${name}`); bad++; continue; }
  if (!src.includes(from)) { console.log(`SKIPPED (anchor missing!)  ${name}`); bad++; continue; }
  fs.writeFileSync(FILE, Buffer.from(src.replace(from, to), "latin1"));
  let red = false;
  try { execFileSync("node", ["verify-tmp/t71-map-persistence.js"], { stdio: "pipe" }); }
  catch { red = true; }
  console.log(`${red ? "CAUGHT " : "MISSED "}  ${name}`);
  if (!red) bad++;
  fs.writeFileSync(FILE, original);
}
console.log(bad ? `\n${bad} MUTANT(S) NOT CAUGHT` : "\nALL MUTANTS CAUGHT");
process.exit(bad ? 1 : 0);
