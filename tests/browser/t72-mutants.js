// Mutation control for FIX-037. Both files are CRLF, so anchors are SINGLE-LINE.
// Mutants 1-4 restore the ORIGINAL bug on each page and each add path.
const fs = require("fs");
const { execFileSync } = require("child_process");

const MUTANTS = [
  ["index bulk add: slice back to the cap again (the original bug)", "docs/index.html",
   "      state.userPermitNumbers = next;", "      state.userPermitNumbers = next.slice(0, userListLimit);"],
  ["map bulk add: slice back to the cap again (the original bug)", "docs/map.html",
   "      state.userPermitNumbers = next;", "      state.userPermitNumbers = next.slice(0, userListLimit);"],
  ["index single add: slice back to the cap again", "docs/index.html",
   "      state.userPermitNumbers = filtered;", "      state.userPermitNumbers = filtered.slice(0, userListLimit);"],
  ["map single add: slice back to the cap again", "docs/map.html",
   "      state.userPermitNumbers = filtered;", "      state.userPermitNumbers = filtered.slice(0, userListLimit);"],
  ["index: the cap guard lets new permits through", "docs/index.html",
   "        if (next.length >= userListLimit) { skipped += 1; return; }", "        ;"],
  ["map: the cap guard lets new permits through", "docs/map.html",
   "        if (next.length >= userListLimit) { skipped += 1; return; }", "        ;"],
  ["index: the refusal is silent again", "docs/index.html",
   "      if (skipped) {", "      if (false) {"],
  ["map: the refusal is silent again", "docs/map.html",
   "      if (skipped) {", "      if (false) {"],
  ["index: the cap refuses REPOSITIONS too, freezing reorder on a full list", "docs/index.html",
   "      const isNew = !state.userPermitNumbers.includes(number);", "      const isNew = true;"],
  ["map: the cap refuses REPOSITIONS too, freezing reorder on a full list", "docs/map.html",
   "      const isNew = !state.userPermitNumbers.includes(number);", "      const isNew = true;"],
];

let bad = 0;
for (const [name, file, from, to] of MUTANTS) {
  const original = fs.readFileSync(file);
  const src = original.toString("latin1");
  if (!from || !to || from === to) { console.log(`BAD MUTANT (empty/no-op)  ${name}`); bad++; continue; }
  if (!src.includes(from)) { console.log(`SKIPPED (anchor missing!)  ${name}`); bad++; continue; }
  fs.writeFileSync(file, Buffer.from(src.replace(from, to), "latin1"));
  let red = false;
  try { execFileSync("node", ["verify-tmp/t72-cap-aware-add.js"], { stdio: "pipe" }); } catch { red = true; }
  console.log(`${red ? "CAUGHT " : "MISSED "}  ${name}`);
  if (!red) bad++;
  fs.writeFileSync(file, original);
}
console.log(bad ? `\n${bad} MUTANT(S) NOT CAUGHT` : "\nALL MUTANTS CAUGHT");
process.exit(bad ? 1 : 0);
