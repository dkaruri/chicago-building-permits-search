// Mutation control for t66. Single-line anchors only — docs/list.html is CRLF.
const fs = require("fs");
const { execFileSync } = require("child_process");
const FILE = "docs/list.html";

const MUTANTS = [
  ["row X goes straight to removePermitFromUserList again (the original bug)",
   `removeStopFromUserList('\${enc(tickKeyFor(row))}')`, `removePermitFromUserList('\${enc(row.permit_number)}')`],
  ["clear list stops emptying list.custom",
   "        list.custom = [];", "        void 0;"],
  ["clear list counts only permits again (custom-only list refuses)",
   "if (!state.userPermitNumbers.length && !customStops.length) {", "if (!state.userPermitNumbers.length) {"],
  ["undo does not put the custom stop back",
   "back.custom = [...(back.custom || []), stop];", "back.custom = [...(back.custom || [])];"],
  // FIX-043 removed the blocked-arrow fallback this mutant used to restore —
  // the arrows really move a hand-typed stop now. What t66 still guards is that
  // the fallback does not creep BACK, so the mutant is inverted: put it back and
  // t66 must go red. The reordering itself is t81-mutants.js.
  ["the aria-disabled arrow fallback creeps back in",
   `                  : "";`, `                  : row.is_custom ? "An added address keeps the stop number it was typed with. Remove it and add it again to move it" : "";`],
];

const original = fs.readFileSync(FILE);
let bad = 0;
for (const [name, from, to] of MUTANTS) {
  const src = original.toString("latin1");
  if (!src.includes(from)) { console.log(`SKIPPED (anchor missing!)  ${name}`); bad++; continue; }
  fs.writeFileSync(FILE, Buffer.from(src.replace(from, to), "latin1"));
  let red = false;
  try { execFileSync("node", ["verify-tmp/t66-custom-stop-remove.js"], { stdio: "pipe" }); }
  catch { red = true; }
  console.log(`${red ? "CAUGHT " : "MISSED "}  ${name}`);
  if (!red) bad++;
  fs.writeFileSync(FILE, original);
}
console.log(bad ? `\n${bad} MUTANT(S) NOT CAUGHT` : "\nALL MUTANTS CAUGHT");
process.exit(bad ? 1 : 0);
