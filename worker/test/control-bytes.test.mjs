// Repo-wide guard against invisible control bytes in tracked source (FIX-030).
//
// A raw 0x08 (backspace) or 0x00 (NUL) inside a string or regex is invisible in
// an editor, survives review, and passes every test that does not happen to
// exercise the exact expression it corrupted. This repo has now had FOUR of
// them; the one that prompted this test sat in `main` for six weeks, silently
// making a regex test for a literal backspace so its whole branch was dead.
//
// They get in through tooling, not typing: a bash heredoc, or a shell that
// collapses `\\b` to `\b` before the writing script ever sees it. So the guard
// belongs somewhere automatic rather than in anyone's discipline. This runs in
// the normal `node --test test/*.test.mjs`, which CI already executes before
// the daily seed writes to production KV.
//
// 0x1b (ESC) is deliberately NOT flagged: closure.test.mjs holds real captured
// wrangler output with ANSI colour codes, and that is legitimate.

import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Extensions that must never contain these bytes. Anything not listed (png,
// geojson fixtures, LICENSE) is skipped rather than guessed at — a binary file
// is full of 0x00 by definition and would make this fail forever.
const TEXT_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "html", "css", "json", "py", "md",
  "yml", "yaml", "toml", "txt", "sh", "cfg",
]);

const FORBIDDEN = [
  { byte: 0x08, name: "BACKSPACE (0x08)", hint: "a regex word boundary written as a real byte instead of the two characters backslash-b" },
  { byte: 0x00, name: "NUL (0x00)", hint: "a truncated escape, or a file written through a mangling shell" },
];

function repoRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

function trackedTextFiles(root) {
  // `cwd: root` is load-bearing: git ls-files is relative to the working
  // directory, and CI runs this from worker/, where it would otherwise list
  // that directory's 30 files and quietly guard almost nothing.
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean)
    .filter(f => TEXT_EXTENSIONS.has((f.split(".").pop() || "").toLowerCase()));
}

test("no tracked source file contains invisible control bytes", () => {
  const root = repoRoot();
  const files = trackedTextFiles(root);
  // If this ever collapses to a handful of files the guard has stopped
  // guarding, and a green run would mean nothing.
  assert.ok(files.length > 50, `only ${files.length} tracked text files found — is git ls-files working?`);

  const offences = [];
  for (const rel of files) {
    let buf;
    try { buf = readFileSync(join(root, rel)); } catch { continue; }
    for (const { byte, name, hint } of FORBIDDEN) {
      let at = buf.indexOf(byte);
      while (at !== -1) {
        const line = buf.subarray(0, at).toString("utf8").split("\n").length;
        offences.push(`${rel}:${line} contains ${name} — ${hint}`);
        at = buf.indexOf(byte, at + 1);
        if (offences.length > 40) break;
      }
    }
  }
  assert.deepEqual(offences, [], `\n${offences.join("\n")}\n`);
});

// The guard is only worth having if it can actually fire, and a scan that
// silently matched nothing would look identical to a clean repo.
test("the control-byte scan detects a byte when one is present", () => {
  const poisoned = Buffer.from(`if (/${String.fromCharCode(8)}404${String.fromCharCode(8)}/.test(s)) return true;`, "utf8");
  assert.equal(poisoned.indexOf(0x08), 5, "the probe did not embed the byte it claims to look for");
  assert.equal(poisoned.subarray(0, poisoned.indexOf(0x08)).toString("utf8").split("\n").length, 1);
  // And the clean form is not flagged.
  assert.equal(Buffer.from("if (/\\b404\\b/.test(s)) return true;", "utf8").indexOf(0x08), -1);
});
