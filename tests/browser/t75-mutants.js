// FEAT-046 mutation control. Snapshots all three pages, re-introduces each
// defect, asserts the suite that should catch it goes RED, then restores and
// byte-compares against the snapshot. A green mutant means the fix is untested.
const { execFileSync } = require("child_process");
const fs = require("fs");

const FILES = ["docs/index.html", "docs/list.html", "docs/map.html"];
const SNAP = f => `verify-tmp/_snap-${f.replace(/[\/]/g, "_")}`;
const SUITE = "verify-tmp/t75-permit-stage.js";

const MUTANTS = [
  {
    name: "M1 closed permits fall through to the milestone lookup (the 13,973-permit trap)",
    suite: SUITE,
    edits: [{ file: "docs/list.html",
      from: '      if (status === "EXPIRED" || status === "CANCELLED" || status === "REVOKED") return "ended";\r\n',
      to: "" }],
  },
  {
    name: "M2 STOP WORK is treated as active work",
    suite: SUITE,
    edits: [{ file: "docs/list.html", from: '"STOP WORK": "halted"', to: '"STOP WORK": "progress"' }],
  },
  {
    name: "M3 the no-stage guard is removed, so an empty chip renders",
    suite: SUITE,
    edits: [{ file: "docs/list.html",
      from: '      const stage = permitStage(row);\r\n      if (!stage) return "";\r\n',
      to: '      const stage = permitStage(row) || "notstarted";\r\n' }],
  },
  {
    name: "M4 the verbatim milestone is dropped from the chip title",
    suite: SUITE,
    edits: [{ file: "docs/list.html",
      from: '${raw ? ` title="${esc(raw)}"` : ""}', to: "" }],
  },
  {
    name: "M5 Finishing loses its colour (EXPECTED SURVIVOR — see below)",
    suite: SUITE,
    edits: [{ file: "docs/list.html",
      from: ".stage-finishing { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }",
      to: ".stage-finishing { color: var(--muted); border-color: var(--line); }" }],
  },
];

function snapshot() { for (const f of FILES) fs.copyFileSync(f, SNAP(f)); }
function restore() { for (const f of FILES) fs.copyFileSync(SNAP(f), f); }
function verifyRestored() {
  for (const f of FILES) {
    if (!fs.readFileSync(f).equals(fs.readFileSync(SNAP(f)))) throw new Error(`RESTORE FAILED: ${f} differs from its snapshot`);
  }
}
function runSuite(s) {
  try { execFileSync("node", [s], { stdio: "pipe", timeout: 300000 }); return 0; }
  catch (e) { return e.status == null ? -1 : e.status; }
}

(async () => {
  snapshot();
  console.log("baseline (unmutated):");
  for (const m of [...new Set(MUTANTS.map(x => x.suite))]) console.log(`  ${m} exit=${runSuite(m)}  ${"(0 = green)"}`);

  let survivors = 0;
  for (const m of MUTANTS) {
    let applied = 0;
    for (const e of m.edits) {
      const src = fs.readFileSync(e.file, "utf8");
      // Both pages are CRLF. An anchor written with \n silently never matches,
      // which reads as "mutant skipped" rather than "mutant broken" — this exact
      // trap has cost this repo a mutation run before. Match the file's endings.
      const crlf = src.includes("\r\n");
      const fix = s => (crlf ? s.replace(/\r?\n/g, "\r\n") : s.replace(/\r\n/g, "\n"));
      const from = fix(e.from), to = fix(e.to);
      if (!src.includes(from)) { console.log(`  !! anchor not found in ${e.file} — mutant not applied`); continue; }
      fs.writeFileSync(e.file, src.replace(from, to));
      applied++;
    }
    if (applied !== m.edits.length) { restore(); console.log(`${m.name}\n  SKIPPED (anchor miss)\n`); continue; }
    const code = runSuite(m.suite);
    const caught = code !== 0;
    if (!caught) survivors++;
    console.log(`${m.name}\n  ${m.suite} exit=${code}  ->  ${caught ? "CAUGHT (red, good)" : "SURVIVED (green — the fix is untested)"}\n`);
    restore();
    verifyRestored();
  }

  verifyRestored();
  for (const f of FILES) fs.unlinkSync(SNAP(f));
  console.log(survivors ? `${survivors} MUTANT(S) SURVIVED` : "all mutants caught; tree restored and byte-identical");
  process.exit(survivors ? 1 : 0);
})();
