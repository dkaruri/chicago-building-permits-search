// Mutation control for FEAT-044 phase 2. Each mutant restores one way the
// directory could go back to lying about how much data it is showing.
// Single-line anchors only, per the CRLF lesson — and an empty/no-op mutant is
// rejected outright rather than reported as a MISSED.
const fs = require("fs");
const { execFileSync } = require("child_process");
const FILE = "docs/index.html";

const MUTANTS = [
  ["pager divides the resident page again (the original bug)",
   "return Math.max(1, Math.ceil(totalRowCount() / state.pageSize));",
   "return Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));"],
  ["the count label reports the page instead of the total",
   "      if (!total || !state.filteredRows.length) return \"0 shown\";",
   "      total = state.filteredRows.length; if (!total) return \"0 shown\";"],
  ["changePage refetches the page it is already on",
   "        const current = await fetchPermitsPage(next, token);",
   "        const current = await fetchPermitsPage(state.pageIndex, token);"],
  ["Address becomes sortable again in permits mode",
   "        serverSorted: true,", "        serverSorted: false,"],
  ["the client sort no longer reaches the server",
   "        await search();", "        renderCurrentMode();"],
  // The guard appears TWICE in fetchPermitsPage (catch block, then the main
  // path); only the second one protects the render. nth targets it.
  ["the stale-response guard is dropped from the paged fetch",
   "      if (token !== state.searchToken) return false;", "      ;", 2],
  ["the processing filter stops going to the server",
   "      if (usableProcessingOnly()) params.set(\"usable_processing\", \"1\");", "      ;"],
  ["the client asks for a 1000-row prefix again",
   "      params.set(\"limit\", String(state.pageSize));", "      params.set(\"limit\", \"1000\");"],
];

/** Replace the nth (1-based) occurrence of `from`, leaving the others alone. */
function replaceNth(src, from, to, nth) {
  let at = -1;
  for (let i = 0; i < nth; i++) {
    at = src.indexOf(from, at + 1);
    if (at < 0) return null;
  }
  return src.slice(0, at) + to + src.slice(at + from.length);
}

const original = fs.readFileSync(FILE);
let bad = 0;
for (const [name, from, to, nth = 1] of MUTANTS) {
  const src = original.toString("latin1");
  if (!from || !to || from === to) { console.log(`BAD MUTANT (empty/no-op)  ${name}`); bad++; continue; }
  const mutated = replaceNth(src, from, to, nth);
  if (mutated === null) { console.log(`SKIPPED (anchor missing!)  ${name}`); bad++; continue; }
  fs.writeFileSync(FILE, Buffer.from(mutated, "latin1"));
  let red = false;
  try { execFileSync("node", ["verify-tmp/t67-directory-caps.js"], { stdio: "pipe" }); }
  catch { red = true; }
  console.log(`${red ? "CAUGHT " : "MISSED "}  ${name}`);
  if (!red) bad++;
  fs.writeFileSync(FILE, original);
}
console.log(bad ? `\n${bad} MUTANT(S) NOT CAUGHT` : "\nALL MUTANTS CAUGHT");
process.exit(bad ? 1 : 0);
