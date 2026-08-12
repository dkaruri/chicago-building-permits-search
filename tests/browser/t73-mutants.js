// Mutation control for FIX-046. Files are CRLF, so anchors are SINGLE-LINE.
// Each mutant may apply a LIST of replacements — a defect with two cooperating
// parts must be restored in FULL or the mutant proves nothing (FIX-037's
// lesson: a re-added slice is a no-op while the guard stands).
const fs = require("fs");
const { execFileSync } = require("child_process");

const TRIM = "      state.userPermitNumbers = Array.from(new Set(state.userPermitNumbers));";
const TRIM_OLD = "      state.userPermitNumbers = Array.from(new Set(state.userPermitNumbers)).slice(0, userListLimit);";
const CAP1000 = "    const userListLimit = 1000;";
const CAP220 = "    const userListLimit = 220;";

const MUTANTS = [
  ["index: the ORIGINAL bug — cap back to 220 AND the save trims again",
   [["docs/index.html", CAP1000, CAP220], ["docs/index.html", TRIM, TRIM_OLD]],
   "verify-tmp/t73-shared-cap.js"],
  ["map: the ORIGINAL bug — cap back to 220 AND the save trims again",
   [["docs/map.html", CAP1000, CAP220], ["docs/map.html", TRIM, TRIM_OLD]],
   "verify-tmp/t73-shared-cap.js"],
  ["index: cap drifts to 220 (save no longer trims, so only adds are wrong)",
   [["docs/index.html", CAP1000, CAP220]], "verify-tmp/t73-shared-cap.js"],
  ["map: the save trims to the cap again",
   [["docs/map.html", TRIM, TRIM_OLD]], "verify-tmp/t73-shared-cap.js"],
  ["list: the save trims to the cap again",
   [["docs/list.html", TRIM, TRIM_OLD]], "verify-tmp/t73-shared-cap.js"],
  // The unit guard must itself catch a drift, without a browser.
  ["index: cap drifts — caught by the unit guard alone",
   [["docs/index.html", CAP1000, CAP220]], "worker/test/list-cap.test.mjs"],
  ["list: the save trims — caught by the unit guard alone",
   [["docs/list.html", TRIM, TRIM_OLD]], "worker/test/list-cap.test.mjs"],
];

let bad = 0;
for (const [name, edits, target] of MUTANTS) {
  const originals = new Map();
  let ok = true;
  for (const [file, from, to] of edits) {
    if (!originals.has(file)) originals.set(file, fs.readFileSync(file));
    if (!from || !to || from === to) { ok = false; break; }
    const src = fs.readFileSync(file).toString("latin1");
    if (!src.includes(from)) { console.log(`SKIPPED (anchor missing in ${file})  ${name}`); ok = false; break; }
    fs.writeFileSync(file, Buffer.from(src.replace(from, to), "latin1"));
  }
  if (!ok) { for (const [f, b] of originals) fs.writeFileSync(f, b); bad++; continue; }
  let red = false;
  const args = target.endsWith(".test.mjs") ? ["--test", target] : [target];
  try { execFileSync("node", args, { stdio: "pipe" }); } catch { red = true; }
  console.log(`${red ? "CAUGHT " : "MISSED "}  ${name}`);
  if (!red) bad++;
  for (const [f, b] of originals) fs.writeFileSync(f, b);
}
console.log(bad ? `\n${bad} MUTANT(S) NOT CAUGHT` : "\nALL MUTANTS CAUGHT");
process.exit(bad ? 1 : 0);
