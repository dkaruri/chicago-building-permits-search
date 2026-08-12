// FEAT-032 mutation check. A green suite proves nothing unless it goes red when
// the logic is wrong, so this breaks docs/list.html one edit at a time and
// requires feat032-source.mjs to catch each one.
//
// Every mutant is reverted in a finally block; a crash mid-run still restores
// the file. Run: node verify-tmp/feat032-mutants.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// `node --test verify-tmp/*.mjs` sweeps this file up with the real tests — the
// leading underscore does not exclude it from a shell glob. Left unguarded it
// then rewrites docs/list.html WHILE the sibling test processes are reading it,
// which shows up as an unrelated test failing on a mutant it never asked for.
// Refuse to run under the test runner; this is a script, run it directly.
if (process.env.NODE_TEST_CONTEXT) {
  console.log("feat032 mutants: skipped under `node --test` — run `node verify-tmp/_feat032-mutants.mjs` directly");
  process.exit(0);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = join(ROOT, "docs", "list.html");

const MUTANTS = [
  {
    name: "append becomes overwrite (a second search clobbers the first)",
    from: '        lines.push(`• ${stamp} — ${count} ${tail}`);',
    to: '        lines[Math.max(0, lines.length - 1)] = `• ${stamp} — ${count} ${tail}`;',
  },
  {
    name: "the day is ignored, so yesterday's line gets bumped",
    from: "      if (prev && prev[1] === stamp && prev[3] === tail) {",
    to: "      if (prev && prev[3] === tail) {",
  },
  {
    name: "the cap slices the string instead of evicting whole lines",
    from: "      let next = lines.join(\"\\n\");\n      while (next.length > LIST_DESC_LIMIT) {",
    to: "      let next = lines.join(\"\\n\");\n      while (false && next.length > LIST_DESC_LIMIT) {",
  },
  {
    name: "the date is parsed through Date(), which shifts a bare day back in UTC",
    from: "      const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(iso || \"\").trim());\n      if (!m) return null;\n      return { y: m[1], m: LIST_SOURCE_MONTHS[Number(m[2]) - 1] || \"\", d: String(Number(m[3])) };",
    to: "      const d = new Date(String(iso || \"\").trim());\n      if (Number.isNaN(d.getTime())) return null;\n      return { y: String(d.getFullYear()), m: LIST_SOURCE_MONTHS[d.getMonth()] || \"\", d: String(d.getDate()) };",
  },
  {
    name: "an add of zero permits still writes a line",
    from: "      if (!list || !(count > 0) || !tail) return;",
    to: "      if (!list || !tail) return;",
  },
  {
    name: "descPending is never set, so Search edits lose to the shared doc",
    from: "      list.descPending = true;",
    to: "      list.descPending = false;",
  },
];

const original = readFileSync(PAGE);
let survivors = 0;

// docs/list.html's blob is CRLF (see CLAUDE.md), so a multi-line anchor written
// with plain \n matches nothing and the mutant silently never runs — which
// reads as a lost anchor, not as a passing test. Re-line-end every anchor to
// whatever the file actually uses.
const CRLF = original.toString("utf8").includes("\r\n");
const fit = s => (CRLF ? s.replace(/\r?\n/g, "\r\n") : s.replace(/\r\n/g, "\n"));

for (const raw of MUTANTS) {
  const mutant = { name: raw.name, from: fit(raw.from), to: fit(raw.to) };
  const text = original.toString("utf8");
  if (!text.includes(mutant.from)) {
    console.log(`ANCHOR LOST  ${mutant.name}`);
    survivors++;
    continue;
  }
  if (text.split(mutant.from).length !== 2) {
    console.log(`ANCHOR AMBIGUOUS  ${mutant.name}`);
    survivors++;
    continue;
  }
  try {
    // Byte-safe write: the blob is CRLF and must stay that way (see CLAUDE.md).
    const mutated = Buffer.from(text.replace(mutant.from, mutant.to), "utf8");
    if (mutated.includes(0x08) || mutated.includes(0x00)) throw new Error("mutant introduced control bytes");
    writeFileSync(PAGE, mutated);
    let caught = false;
    try {
      execFileSync("node", ["--test", "verify-tmp/feat032-source.mjs"], { cwd: ROOT, stdio: "pipe" });
    } catch {
      caught = true;
    }
    console.log(`${caught ? "caught  " : "SURVIVED"}  ${mutant.name}`);
    if (!caught) survivors++;
  } finally {
    writeFileSync(PAGE, original);
  }
}

console.log(survivors ? `\n${survivors} mutant(s) survived` : `\nall ${MUTANTS.length} mutants caught`);
process.exit(survivors ? 1 : 0);
