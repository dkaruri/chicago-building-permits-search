// Mutation control for t65: break each half of FIX-003 and prove the suite goes
// red. Anchors are SINGLE-LINE — docs/list.html's blob is CRLF, so a multi-line
// anchor never matches and the mutant reports as "skipped", which reads as a pass.
const fs = require("fs");
const { execFileSync } = require("child_process");
const FILE = "docs/list.html";

const MUTANTS = [
  ["cell no longer stops propagation",
   'data-label="Remove" onclick="event.stopPropagation()"', 'data-label="Remove"'],
  ["undo appends instead of restoring the stop number",
   "next.splice(Math.min(index, next.length), 0, number);", "next.push(number);"],
  ["undo does not restore the note",
   "if (note !== undefined) state.userPermitNotes[number] = note;", "void note;"],
];

const original = fs.readFileSync(FILE);
let bad = 0;
for (const [name, from, to] of MUTANTS) {
  const src = original.toString("latin1");
  if (!src.includes(from)) { console.log(`SKIPPED (anchor missing!)  ${name}`); bad++; continue; }
  fs.writeFileSync(FILE, Buffer.from(src.replace(from, to), "latin1"));
  let red = false;
  try { execFileSync("node", ["verify-tmp/t65-fast-remove.js"], { stdio: "pipe" }); }
  catch { red = true; }
  console.log(`${red ? "CAUGHT " : "MISSED "}  ${name}`);
  if (!red) bad++;
  fs.writeFileSync(FILE, original);
}
console.log(bad ? `\n${bad} MUTANT(S) NOT CAUGHT` : "\nALL MUTANTS CAUGHT");
process.exit(bad ? 1 : 0);
