// FEAT-047 mutation control. Re-introduces each defect the stage filter is
// supposed to prevent and requires t76-stage-filter.js to go RED. Snapshots
// docs/map.html, byte-verifies the restore, and converts anchors to the file's
// line endings — map.html is CRLF, and an anchor written with \n silently never
// matches, which reports as "skipped" and reads like a broken mutant rather
// than a broken anchor.
const { execFileSync } = require("child_process");
const fs = require("fs");

const FILE = "docs/map.html";
const SNAP = "verify-tmp/_snap-t76-map.html";
const SUITE = "verify-tmp/t76-stage-filter.js";

const MUTANTS = [
  {
    name: "M1 an include silences the excludes (the rejected Rule A)",
    from: "      if (f.exclude.includes(value)) return false;",
    to:   "      if (f.include.length) return true;\n      if (f.exclude.includes(value)) return false;",
  },
  {
    name: "M2 the third click re-includes instead of clearing",
    from: "      else if (exclude.has(value)) { exclude.delete(value); }",
    to:   "      else if (exclude.has(value)) { exclude.delete(value); include.add(value); }",
  },
  {
    name: "M3 counts are taken AFTER the stage filter, so they shift as you tick",
    from: "      const stageCounts = new Map();",
    to:   "      const stageCounts = new Map();\n      state.map.filteredRows = state.map.filteredRows.filter(r => matchesTriState(permitStage(mapRowToPermit(r)), settings.stages));",
  },
  {
    name: "M4 the accessible name drops the state",
    from: '      const said = state === "include" ? "included, activate to exclude"',
    to:   '      const said = state === "include" ? "filter option"',
  },
  {
    name: "M5 the empty result offers no way out",
    from: '<br><button type="button" class="map-clear-filters" onclick="resetMapSettings()">Clear filters</button>',
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
      console.log(`${m.name}\n  !! ANCHOR NOT FOUND — mutant not applied (this is a broken anchor, not a passing test)\n`);
      continue;
    }
    fs.writeFileSync(FILE, src.replace(from, to));
    const code = runSuite();
    const caught = code !== 0;
    if (!caught) survivors++;
    console.log(`${m.name}\n  exit=${code}  ->  ${caught ? "CAUGHT (red, good)" : "SURVIVED (green — this defect is untested)"}\n`);

    fs.copyFileSync(SNAP, FILE);
    if (!fs.readFileSync(FILE).equals(original)) throw new Error("RESTORE FAILED — tree is left mutated");
  }

  fs.unlinkSync(SNAP);
  const bad = survivors + skipped;
  console.log(bad
    ? `${survivors} SURVIVED, ${skipped} SKIPPED`
    : "all mutants caught; docs/map.html restored byte-identical");
  process.exit(bad ? 1 : 0);
})();
