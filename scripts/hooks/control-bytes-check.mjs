// Blocks a commit that would introduce an invisible control byte (FIX-030).
//
// Checks STAGED content, not the working tree -- what is actually being
// committed. Deliberately contains no backslash escapes anywhere: this entire
// class of bug comes from escaping being eaten by a layer of tooling, and a
// guard that could be corrupted the same way would be worthless.
//
// Enable in a fresh clone with:   git config core.hooksPath scripts/hooks
// The shared, always-on guard is worker/test/control-bytes.test.mjs, which CI
// runs before the daily seed writes to production KV. This hook is the earlier,
// opt-in half.
import { execFileSync } from 'node:child_process';

const NUL = 0, BACKSPACE = 8, NEWLINE = 10, BACKSLASH = 92;

// Extension allowlist, not content sniffing. A tracked PNG in this repo holds
// 810 backspace bytes and 2153 NULs, so scanning by content would block every
// commit that touches an image.
export const TEXT_EXTENSIONS = new Set(
  ['js','mjs','cjs','html','css','json','py','md','yml','yaml','toml','txt','sh','cfg']);

// Exported so the test suite can exercise it without staging anything.
export function findControlBytes(name, buf) {
  const out = [];
  for (const [byte, label] of [[BACKSPACE, 'BACKSPACE (0x08)'], [NUL, 'NUL (0x00)']]) {
    let at = buf.indexOf(byte);
    while (at !== -1 && out.length < 40) {
      const line = buf.subarray(0, at).toString('utf8').split(String.fromCharCode(NEWLINE)).length;
      out.push('  ' + name + ':' + line + '  ' + label);
      at = buf.indexOf(byte, at + 1);
    }
  }
  return out;
}

export function stagedTextFiles() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return out.split(String.fromCharCode(NEWLINE)).filter(Boolean)
    .filter(f => TEXT_EXTENSIONS.has((f.split('.').pop() || '').toLowerCase()));
}

// Only run the check when invoked as the hook, so importing this from a test
// does not try to read a staging area.
if (process.argv[1] && process.argv[1].endsWith('control-bytes-check.mjs')) {
  const offences = [];
  for (const file of stagedTextFiles()) {
    let buf;
    try { buf = execFileSync('git', ['show', ':' + file], { maxBuffer: 64 * 1024 * 1024 }); }
    catch { continue; }
    offences.push(...findControlBytes(file, buf));
  }
  if (offences.length) {
    const bs = String.fromCharCode(BACKSLASH);
    console.error('');
    console.error('COMMIT BLOCKED: invisible control bytes in staged content.');
    console.error('');
    offences.forEach(o => console.error(o));
    console.error('');
    console.error('Almost always a regex word boundary written as a real byte instead of');
    console.error('the two characters ' + bs + 'b -- usually because a shell or heredoc ate the');
    console.error('escaping. Rewrite building the backslash numerically: bytes([92]) in');
    console.error('Python, String.fromCharCode(92) in Node.');
    console.error('');
    console.error('Your editor and `sed` will BOTH render the file as though it were already');
    console.error('correct -- a backspace byte erases the character before it.');
    console.error('Inspect with:  git show :<file> | cat -v');
    console.error('');
    console.error('Override only if you are certain:  git commit --no-verify');
    console.error('');
    process.exit(1);
  }
}
