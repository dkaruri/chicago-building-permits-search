// FIX-043 mutation control. Re-introduces each defect the card exists to
// prevent and requires t81-move-custom-stop.js to go RED.
//
// Written against the FIXED code, not the original: a mutant that only half
// restores a bug proves nothing, so a defect with two cooperating parts carries
// a LIST of replacements. Anchors are converted to the file's line endings —
// docs/list.html is CRLF, and a "\n" anchor silently never matches, which the
// runner would report as "skipped" and which reads like a pass at a glance.
const { execFileSync } = require("child_process");
const fs = require("fs");

const FILE = "docs/list.html";
const SNAP = "verify-tmp/_snap-t81-list.html";
const SUITE = "verify-tmp/t81-move-custom-stop.js";

const MUTANTS = [
  {
    name: "M1 a move no longer rewrites `pos`, so the hand-typed stop snaps back on the next render",
    edits: [
      ['        return seat < 0 ? c : { ...c, pos: seat + 1 };', '        return c;'],
    ],
  },
  {
    name: "M2 the arrow passes row.permit_number again — blank on a hand-typed stop (the FIX-042 root cause)",
    edits: [
      ["onclick=\"event.stopPropagation(); moveStopByOffset('${enc(tickKeyFor(row))}', ${dir})\"",
       "onclick=\"event.stopPropagation(); moveStopByOffset('${enc(row.permit_number)}', ${dir})\""],
    ],
  },
  {
    name: "M3 the aria-disabled 'remove it and add it again' fallback comes back for custom rows",
    edits: [
      ['                  ? "Clear the follow-up filter to reorder stops"\r\n                  : "";',
       '                  ? "Clear the follow-up filter to reorder stops"\r\n                  : row.is_custom ? "An added address keeps the stop number it was typed with. Remove it and add it again to move it" : "";'],
    ],
  },
  {
    name: "M4 focus is not restored after the re-render, so a second keyboard press is impossible",
    edits: [
      ['      if (target && !target.disabled) target.focus();', '      return;'],
    ],
  },
  {
    name: "M5 focus goes to the arrow that was pressed even when the stop landed at an end (disabled = no focus)",
    edits: [
      ['      const target = wanted && !wanted.disabled ? wanted : other;', '      const target = wanted;'],
    ],
  },
  {
    name: "M6 the announcement goes back to saying nothing a screen-reader user can act on",
    edits: [
      ['      announceListAction(`${stopLabel(moved)} moved to stop ${nextIndex + 1} of ${merged.length}.`);',
       '      announceListAction("Permit moved.");'],
    ],
  },
  {
    name: "M7 the row hands drag an empty permit number again, so drag and the arrows disagree",
    edits: [
      ["ondragstart=\"permitDragStart(event, '${enc(tickKeyFor(row))}')\"",
       "ondragstart=\"permitDragStart(event, '${enc(row.permit_number)}')\""],
      ["ondrop=\"savedPermitDrop(event, this, '${enc(tickKeyFor(row))}')\"",
       "ondrop=\"savedPermitDrop(event, this, '${enc(row.permit_number)}')\""],
    ],
  },
  {
    name: "M8 an unavailable arrow is painted like a live one again (invalid selector kills the whole rule)",
    edits: [
      ['    .icon-button:disabled,', '    .icon-button:disabled-no-such-pseudo,'],
    ],
  },
  {
    name: "M9 permit moves stop being merged-order moves, so a permit leapfrogs a hand-typed stop again",
    edits: [
      ['      const rows = userListRows();\r\n      const index = rows.findIndex(row => tickKeyFor(row) === key);',
       '      const rows = state.userPermitNumbers.map(n => state.userPermitMap.get(n)).filter(Boolean);\r\n      const index = rows.findIndex(row => tickKeyFor(row) === key);'],
    ],
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
  console.log(bad ? `${survivors} SURVIVED, ${skipped} SKIPPED` : "all mutants caught; docs/list.html restored byte-identical");
  process.exit(bad ? 1 : 0);
})();
