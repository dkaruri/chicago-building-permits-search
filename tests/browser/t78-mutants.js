// FEAT-052 mutation control. Re-introduces each defect the card exists to
// prevent and requires t78-list-header.js to go RED.
//
// Two things this runner does deliberately:
//   * a mutant may carry a LIST of replacements — a defect with two cooperating
//     parts (the mark slot AND the label) stays green if only one is restored,
//     which reads as a weak TEST when it is a weak MUTANT;
//   * anchors are converted to the file's line endings and are single-line —
//     docs/list.html is CRLF, and a "\n" anchor silently never matches, which
//     reports as "skipped" and reads like a pass at a glance.
const { execFileSync } = require("child_process");
const fs = require("fs");

const FILE = "docs/list.html";
const SNAP = "verify-tmp/_snap-t78-list.html";
const SUITE = "verify-tmp/t78-list-header.js";

const MUTANTS = [
  {
    name: "M1 the tick is prepended to the label again instead of filling the reserved slot",
    edits: [
      ['        if (mark) mark.textContent = st === "include" ? "✓" : st === "exclude" ? "✗" : "";',
       '        if (mark) mark.textContent = "";'],
      ['        if (text) text.textContent = label;',
       '        if (text) text.textContent = st === "include" ? "✓ " + label : st === "exclude" ? "✗ " + label : label;'],
    ],
  },
  {
    name: "M2 the stage summary is prose again, so it grows as you tick",
    edits: [
      ['      if (stageBadge) stageBadge.textContent = !s.include.length && !s.exclude.length ? "all" : String(s.include.length + s.exclude.length);',
       '      if (stageBadge) stageBadge.textContent = stageWords;'],
    ],
  },
  {
    name: "M3 the filtered count moves back above the table",
    edits: [
      ['      <span id="list-filter-status" class="list-filter-status small" role="status" aria-live="polite"></span>',
       ''],
      ['        <span id="list-tally" class="list-filter-status small"></span>',
       '        <span id="list-tally" class="list-filter-status small"></span><span id="list-filter-status" class="list-filter-status small" role="status" aria-live="polite"></span>'],
    ],
  },
  {
    name: "M4 the undo line folds away with the header (the FIX-003 regression)",
    edits: [
      ['      fold.dataset.collapsed = collapsed ? "true" : "false";',
       '      fold.dataset.collapsed = collapsed ? "true" : "false"; $("list-action-status").hidden = collapsed;'],
    ],
  },
  {
    name: "M5 the fold resets on every repaint, shutting under someone reading it",
    edits: [
      ['      if (state.foldRenderedFor === state.activeListId) return;', ''],
      ['      applyListHeaderFold(readFoldedLists()[state.activeListId] === true);',
       '      applyListHeaderFold(false);'],
    ],
  },
  {
    name: "M6 the announcement line stops reserving its box, so a filter click shoves the table",
    edits: [
      ['      min-height: calc(1.4em + 20px);', '      min-height: 0;'],
      ['        min-height: calc(2.8em + 20px);', '        min-height: 0;'],
    ],
  },
  {
    name: "M7 the stage picker opens non-modal, so the row behind it stays live",
    edits: [
      ['      dlg.showModal();\r\n      const first = dlg.querySelector(".tri");',
       '      dlg.show();\r\n      const first = dlg.querySelector(".tri");'],
    ],
  },
];
// Dropped M8 ("closing the picker drops focus to <body>"): it SURVIVED, and the
// mutant was right to. <dialog>.showModal() restores focus itself, so the
// handler it broke was dead code and has been deleted. The suite still asserts
// the behaviour — that is a claim about using a real <dialog>, not about code
// of ours that could regress.

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
  console.log(bad ? `${survivors} SURVIVED, ${skipped} SKIPPED` : "all mutants caught; docs/list.html restored byte-identical");
  process.exit(bad ? 1 : 0);
})();
