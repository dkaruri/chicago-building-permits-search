// FEAT-048 mutation control. Re-introduces each defect the list filter row is
// meant to prevent and requires t77-list-filters.js to go RED. Snapshots
// docs/list.html, byte-verifies the restore, and converts anchors to the file's
// line endings — list.html is CRLF, and an anchor written with \n silently never
// matches, which reports as "skipped" and reads like a broken mutant rather than
// a broken anchor.
const { execFileSync } = require("child_process");
const fs = require("fs");

const FILE = "docs/list.html";
const SNAP = "verify-tmp/_snap-t77-list.html";
const SUITE = "verify-tmp/t77-list-filters.js";

const MUTANTS = [
  {
    name: "M1 the stage filter is not applied at all",
    from: "        && matchesTriState(permitStage(row), f.stages));",
    to:   "        && true);",
  },
  {
    name: "M2 the third click re-includes instead of clearing",
    from: '      state.listFilters[facet] = now === "include" ? "exclude" : now === "exclude" ? null : "include";',
    to:   '      state.listFilters[facet] = now === "include" ? "exclude" : "include";',
  },
  {
    name: "M3 Follow-up becomes tri-state (it must stay binary)",
    from: "      state.listFilters.followUp = !state.listFilters.followUp;",
    to:   '      state.listFilters.followUp = state.listFilters.followUp === true ? "exclude" : true;',
  },
  {
    name: "M4 stage counts are taken over the FILTERED rows, so they shift as you tick",
    from: "      const stageCounts = new Map();\n      for (const row of rows) {\n        const stage = permitStage(row);",
    to:   "      const stageCounts = new Map();\n      for (const row of filtered) {\n        const stage = permitStage(row);",
  },
  {
    name: "M5 the empty view offers no way out",
    from: ' <button type="button" class="linkish" onclick="clearListFilters()">Show all ${fmt(rows.length)}</button>',
    to:   "",
  },
];

function runSuite() {
  try { execFileSync("node", [SUITE], { stdio: "pipe", timeout: 600000 }); return 0; }
  catch (e) { return e.status == null ? -1 : e.status; }
}

(async () => {
  fs.copyFileSync(FILE, SNAP);
  const original = fs.readFileSync(FILE);
  let survivors = 0, skipped = 0;

  console.log("baseline (unmutated):");
  console.log(`  ${SUITE} exit=${runSuite()}   (0 = green)\n`);

  for (const m of MUTANTS) {
    const src = fs.readFileSync(FILE, "utf8");
    const crlf = src.includes("\r\n");
    const fix = s => (crlf ? s.replace(/\r?\n/g, "\r\n") : s.replace(/\r\n/g, "\n"));
    const from = fix(m.from), to = fix(m.to);

    if (!src.includes(from)) {
      skipped++;
      console.log(`${m.name}\n  !! ANCHOR NOT FOUND — not applied (a broken anchor, NOT a passing test)\n`);
      continue;
    }
    fs.writeFileSync(FILE, src.replace(from, to));
    const code = runSuite();
    const caught = code !== 0;
    if (!caught) survivors++;
    console.log(`${m.name}\n  exit=${code}  ->  ${caught ? "CAUGHT (red, good)" : "SURVIVED (green — this defect is untested)"}\n`);

    fs.copyFileSync(SNAP, FILE);
    if (!fs.readFileSync(FILE).equals(original)) throw new Error("RESTORE FAILED — tree left mutated");
  }

  fs.unlinkSync(SNAP);
  const bad = survivors + skipped;
  console.log(bad ? `${survivors} SURVIVED, ${skipped} SKIPPED` : "all mutants caught; docs/list.html restored byte-identical");
  process.exit(bad ? 1 : 0);
})();
