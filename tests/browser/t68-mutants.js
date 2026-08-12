// Mutation control for the profiles client cap. Single-line anchors (index.html
// is CRLF in the working tree, so multi-line anchors silently never match).
const fs = require("fs");
const { execFileSync } = require("child_process");
const FILE = "docs/index.html";
const MUTANTS = [
  ["the client asks for 5000 again (the original bug)",
   "const PROFILE_PAGE = 20000;", "const PROFILE_PAGE = 5000;"],
  ["it stops after one page instead of paging to the total",
   "          } while (rows.length < total);", "          } while (false);"],
  ["total is ignored, so a short page reads as the whole set",
   "            total = Number.isFinite(data.total) ? data.total : rows.length + data.rows.length;",
   "            total = rows.length + data.rows.length;"],
];
const original = fs.readFileSync(FILE);
let bad = 0;
for (const [name, from, to] of MUTANTS) {
  const src = original.toString("latin1");
  if (!from || !to || from === to) { console.log(`BAD MUTANT  ${name}`); bad++; continue; }
  if (!src.includes(from)) { console.log(`SKIPPED (anchor missing!)  ${name}`); bad++; continue; }
  fs.writeFileSync(FILE, Buffer.from(src.replace(from, to), "latin1"));
  let red = false;
  try { execFileSync("node", ["verify-tmp/t68-profiles-cap.js"], { stdio: "pipe" }); } catch { red = true; }
  console.log(`${red ? "CAUGHT " : "MISSED "}  ${name}`);
  if (!red) bad++;
  fs.writeFileSync(FILE, original);
}
console.log(bad ? `\n${bad} MUTANT(S) NOT CAUGHT` : "\nALL MUTANTS CAUGHT");
process.exit(bad ? 1 : 0);
