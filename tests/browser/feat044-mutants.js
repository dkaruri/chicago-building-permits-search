// Mutation control for FEAT-044 phase 1. Each mutant reintroduces a specific
// way the pager could lie; the suite must go red for every one.
const fs = require("fs");
const { execFileSync } = require("child_process");

const MUTANTS = [
  ["profiles: the 5000 ceiling comes back", "worker/src/profiles.js",
   "const limit = Number.isFinite(requested) && requested > 0 ? requested : 50;",
   "const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 50, 5000);"],
  ["permits: total reports the page length instead of the count", "worker/src/permits.js",
   "total: Number.isFinite(total) ? total : null,", "total: results.length,"],
  ["permits: the count uses a different where-clause than the rows", "worker/src/permits.js",
   "query(env, { $select: \"count(1)\", $where: where }),",
   "query(env, { $select: \"count(1)\", $where: whereClauses[0] }),"],
  ["permits: sort key is interpolated straight into $order", "worker/src/permits.js",
   "const order = column ? `${column} ${dir.toUpperCase()} NULL LAST` : DEFAULT_ORDER;",
   "const order = sortKey ? `${sortKey} ${dir.toUpperCase()} NULL LAST` : DEFAULT_ORDER;"],
  // Single-line anchor deliberately: a multi-line one silently fails to match
  // and the mutant is reported "skipped", which reads as a pass at a glance.
  ["permits: address becomes sortable as an approximation", "worker/src/permits.js",
   `  cost: "reported_cost",`, `  cost: "reported_cost", address: "street_name, street_number",`],
  ["permits: NULLs come back to the top of a DESC sort", "worker/src/permits.js",
   "${dir.toUpperCase()} NULL LAST`", "${dir.toUpperCase()}`"],
  ["permits: dir is passed through unvalidated", "worker/src/permits.js",
   "const dir = url.searchParams.get(\"dir\") === \"asc\" ? \"asc\" : \"desc\";",
   "const dir = url.searchParams.get(\"dir\") || \"desc\";"],
  ["permits: usable_processing accepts any truthy value", "worker/src/permits.js",
   "if (url.searchParams.get(\"usable_processing\") === \"1\") {",
   "if (url.searchParams.get(\"usable_processing\")) {"],
  ["permits: an unparseable count becomes 0", "worker/src/permits.js",
   "total: Number.isFinite(total) ? total : null,", "total: Number.isFinite(total) ? total : 0,"],
];

let bad = 0;
for (const [name, file, from, to] of MUTANTS) {
  const original = fs.readFileSync(file);
  const src = original.toString("utf8");
  // An empty anchor would "match" everything and mutate nothing, reporting a
  // MISSED that looks like a weak assertion rather than a broken script.
  if (!from || !to || from === to) { console.log(`BAD MUTANT (empty/no-op)  ${name}`); bad++; continue; }
  if (!src.includes(from)) { console.log(`SKIPPED (anchor missing!)  ${name}`); bad++; continue; }
  fs.writeFileSync(file, src.replace(from, to));
  let red = false;
  try {
    execFileSync("node", ["--test", "worker/test/permits-paging.test.mjs",
                          "worker/test/profiles-cap.test.mjs", "worker/test/permits-cost.test.mjs"],
                 { stdio: "pipe" });
  } catch { red = true; }
  console.log(`${red ? "CAUGHT " : "MISSED "}  ${name}`);
  if (!red) bad++;
  fs.writeFileSync(file, original);
}
console.log(bad ? `\n${bad} MUTANT(S) NOT CAUGHT` : "\nALL MUTANTS CAUGHT");
process.exit(bad ? 1 : 0);
