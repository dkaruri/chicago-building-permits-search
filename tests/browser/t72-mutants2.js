// FIX-037 mutation control, part 2: restore the ORIGINAL bug in full.
//
// The first attempt re-added `.slice(0, userListLimit)` on its own and the
// suite stayed green — correctly, because with the cap guard still in place
// the array never exceeds the cap and the slice is a no-op. The real bug is
// BOTH halves together: no guard, then slice. A mutant that reproduces only
// half a bug proves nothing, and reads as a weak test when it is really a weak
// mutant. Each entry here applies a LIST of replacements.
const fs = require("fs");
const { execFileSync } = require("child_process");

const GUARD = "        if (next.length >= userListLimit) { skipped += 1; return; }";
const NEXT = "      state.userPermitNumbers = next;";
const FILTERED = "      state.userPermitNumbers = filtered;";
const ISNEW = "      const isNew = !state.userPermitNumbers.includes(number);";
const REFUSE = "      if (isNew && state.userPermitNumbers.length >= userListLimit) {";

const MUTANTS = [
  ["index bulk add: the ORIGINAL bug, both halves", "docs/index.html",
   [[GUARD, "        ;"], [NEXT, "      state.userPermitNumbers = next.slice(0, userListLimit);"]]],
  ["map bulk add: the ORIGINAL bug, both halves", "docs/map.html",
   [[GUARD, "        ;"], [NEXT, "      state.userPermitNumbers = next.slice(0, userListLimit);"]]],
  ["index single add: the ORIGINAL bug, both halves", "docs/index.html",
   [[REFUSE, "      if (false) {"], [FILTERED, "      state.userPermitNumbers = filtered.slice(0, userListLimit);"]]],
  ["map single add: the ORIGINAL bug, both halves", "docs/map.html",
   [[REFUSE, "      if (false) {"], [FILTERED, "      state.userPermitNumbers = filtered.slice(0, userListLimit);"]]],
];

let bad = 0;
for (const [name, file, pairs] of MUTANTS) {
  const original = fs.readFileSync(file);
  let src = original.toString("latin1");
  let ok = true;
  for (const [from, to] of pairs) {
    if (!from || !to || from === to) { ok = false; break; }
    if (!src.includes(from)) { console.log(`SKIPPED (anchor missing: ${from.trim().slice(0, 40)}…)  ${name}`); ok = false; break; }
    src = src.replace(from, to);
  }
  if (!ok) { bad++; continue; }
  fs.writeFileSync(file, Buffer.from(src, "latin1"));
  let red = false;
  try { execFileSync("node", ["verify-tmp/t72-cap-aware-add.js"], { stdio: "pipe" }); } catch { red = true; }
  console.log(`${red ? "CAUGHT " : "MISSED "}  ${name}`);
  if (!red) bad++;
  fs.writeFileSync(file, original);
}
console.log(bad ? `\n${bad} MUTANT(S) NOT CAUGHT` : "\nALL MUTANTS CAUGHT");
process.exit(bad ? 1 : 0);
