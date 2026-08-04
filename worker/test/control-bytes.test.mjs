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
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

// ---- The opt-in pre-commit hook (FIX-030) ----
//
// The hook is opt-in per clone (`git config core.hooksPath scripts/hooks`), so
// these do NOT require it to be enabled. They require that it is INSTALLABLE and
// that an existing opt-in is not quietly broken.

test('the tracked pre-commit hook exists and is executable in the index', () => {
  const root = repoRoot();
  const entries = execFileSync('git', ['ls-files', '-s', 'scripts/hooks'],
    { cwd: root, encoding: 'utf8' }).split(String.fromCharCode(10)).filter(Boolean);
  const hook = entries.find(l => l.endsWith('scripts/hooks/pre-commit'));
  assert.ok(hook, 'scripts/hooks/pre-commit is not tracked');
  // 100755, or a fresh clone gets a file git refuses to execute.
  assert.ok(hook.startsWith('100755'), `pre-commit is mode ${hook.split(' ')[0]}, not 100755`);
  assert.ok(entries.some(l => l.endsWith('control-bytes-check.mjs')), 'the checker is not tracked');
});

test('the hook script keeps LF endings, or its shebang is invalid', () => {
  const root = repoRoot();
  // A #!/bin/sh script checked out with CRLF has a carriage return in its
  // interpreter line and does not run at all -- silently disabling the guard.
  const staged = execFileSync('git', ['show', ':scripts/hooks/pre-commit'], { cwd: root });
  assert.equal(staged.includes(Buffer.from([13, 10])), false, 'pre-commit has CRLF endings');
  const attrs = readFileSync(join(root, '.gitattributes'), 'utf8');
  assert.match(attrs, /scripts\/hooks\/pre-commit\s+text\s+eol=lf/,
    '.gitattributes does not pin the hook to LF, so a fresh clone may break it');
});

test('if core.hooksPath is set, it points somewhere that actually exists', () => {
  const root = repoRoot();
  let configured = '';
  try {
    configured = execFileSync('git', ['config', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return; // not opted in; nothing to check
  }
  // This is the failure that prompted the test: with hooksPath aimed at a
  // directory that does not exist, git runs NO hook and says nothing. A commit
  // that should have been blocked sails through, and the guard looks enabled.
  assert.ok(existsSync(join(root, configured)),
    `core.hooksPath is "${configured}" but that directory does not exist -- git is silently running no hooks`);
  assert.ok(existsSync(join(root, configured, 'pre-commit')),
    `core.hooksPath is "${configured}" but it holds no pre-commit hook`);
});

test('the hook checker flags a poisoned buffer and passes a clean one', async () => {
  const root = repoRoot();
  const { findControlBytes } = await import(
    pathToFileURL(join(root, 'scripts', 'hooks', 'control-bytes-check.mjs')).href);
  const poisoned = Buffer.concat([Buffer.from('const x = /'), Buffer.from([8]), Buffer.from('404/;')]);
  assert.equal(findControlBytes('f.js', poisoned).length, 1);
  assert.match(findControlBytes('f.js', poisoned)[0], /f\.js:1 {2}BACKSPACE/);
  assert.deepEqual(findControlBytes('f.js', Buffer.from('const x = 1;')), []);
});
