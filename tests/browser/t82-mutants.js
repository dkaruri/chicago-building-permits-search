// FIX-044 mutation control. Re-introduces each half of the defect and requires
// t82-money-wrap.js to go RED.
//
// The fix has two cooperating parts — numbers opt out of `overflow-wrap:
// anywhere`, AND the Cost column is wide enough to hold the widest figure in
// the dataset. Reverting either alone must be caught, or one of them is
// decoration. M3 reverts both, because a mutant that only half restores a bug
// proves nothing.
//
// Anchors are single-line and converted to the file's line endings — docs/*.html
// are CRLF here, and a "\n" anchor silently never matches, which the runner
// reports as "skipped" and which reads like a pass at a glance.
const { execFileSync } = require("child_process");
const fs = require("fs");

const FILE = "docs/index.html";
const SNAP = "verify-tmp/_snap-t82-index.html";
const SUITE = "verify-tmp/t82-money-wrap.js";

const WIDTH_FIXED = "    .permits-table th:nth-child(6), .permits-table td:nth-child(6) { width: 108px; }";
const WIDTH_BROKEN = "    .permits-table th:nth-child(6), .permits-table td:nth-child(6) { width: 10%; }";
const NOWRAP_FIXED = "      white-space: nowrap;\r\n      font-variant-numeric: tabular-nums;";
const NOWRAP_BROKEN = "      white-space: normal;\r\n      font-variant-numeric: tabular-nums;";

const MUTANTS = [
  {
    name: "M1 the Cost column goes back to 10% — the original 72.7px that split $408,680",
    edits: [[WIDTH_FIXED, WIDTH_BROKEN]],
  },
  {
    name: "M2 numeric cells stop opting out of `overflow-wrap: anywhere` (column left wide)",
    edits: [[NOWRAP_FIXED, NOWRAP_BROKEN]],
  },
  {
    name: "M3 both halves reverted — the defect exactly as reported",
    edits: [[WIDTH_FIXED, WIDTH_BROKEN], [NOWRAP_FIXED, NOWRAP_BROKEN]],
  },
  {
    name: "M5 the 640px floor is dropped — columns get crushed again below 1120px",
    edits: [["      min-width: 640px;\r\n    }\r\n\r\n    .contacts-table", "      min-width: 0px;\r\n    }\r\n\r\n    .contacts-table"]],
  },
  {
    // The first draft of this mutant INSERTED a bogus selector alongside
    // `.results-table` instead of replacing it, so the release still applied
    // and it survived against working code — a no-op mutant reads exactly like
    // an untested defect. It has to take the real selector out.
    name: "M6 the stacked layout stops releasing the floor — 640px table at 390px",
    edits: [["      .table-wrap,\r\n      /* The stacked layout makes every cell full-width, so the 640px floor",
             "      .table-wrap-only-no-release,\r\n      /* The stacked layout makes every cell full-width, so the 640px floor"],
            ["      .results-table {\r\n        max-width: 100%;\r\n        min-width: 0;\r\n      }",
             "      .no-such-element-releases-it {\r\n        max-width: 100%;\r\n        min-width: 0;\r\n      }"]],
  },
  {
    name: "M4 the Issued column goes back to 12% — the date split into 2 lines below 1120px",
    edits: [["    .permits-table th:nth-child(4), .permits-table td:nth-child(4) { width: 88px; }",
             "    .permits-table th:nth-child(4), .permits-table td:nth-child(4) { width: 12%; }"]],
  },
];

function runSuite() {
  try { execFileSync("node", [SUITE], { stdio: "pipe", timeout: 900000 }); return 0; }
  catch (e) { return e.status == null ? -1 : e.status; }
}

(async () => {
  fs.copyFileSync(FILE, SNAP);
  const original = fs.readFileSync(FILE);
  let survivors = 0, skipped = 0;

  console.log("baseline (unmutated):");
  console.log(`  ${SUITE} exit=${runSuite()}   (0 = green)\n`);

  for (const m of MUTANTS) {
    let src = fs.readFileSync(FILE, "utf8");
    const crlf = src.includes("\r\n");
    const fix = s => (crlf ? s.replace(/\r?\n/g, "\r\n") : s.replace(/\r\n/g, "\n"));
    let missing = null;
    for (const [from, to] of m.edits) {
      const f = fix(from);
      if (!src.includes(f)) { missing = from; break; }
      src = src.replace(f, fix(to));
    }
    if (missing) {
      skipped++;
      console.log(`${m.name}\n  !! ANCHOR NOT FOUND (${missing.trim().slice(0, 60)}…) — not applied (a broken anchor, NOT a passing test)\n`);
      continue;
    }
    fs.writeFileSync(FILE, src);
    const code = runSuite();
    const caught = code !== 0;
    if (!caught) survivors++;
    console.log(`${m.name}\n  exit=${code}  ->  ${caught ? "CAUGHT (red, good)" : "SURVIVED (green — this defect is untested)"}\n`);

    fs.copyFileSync(SNAP, FILE);
    if (!fs.readFileSync(FILE).equals(original)) throw new Error("RESTORE FAILED — tree left mutated");
  }

  fs.unlinkSync(SNAP);
  const bad = survivors + skipped;
  console.log(bad ? `${survivors} SURVIVED, ${skipped} SKIPPED` : "all mutants caught; docs/index.html restored byte-identical");
  process.exit(bad ? 1 : 0);
})();
