#!/usr/bin/env node
// FIX-020. The runner. Before this, the invocation was a shell loop retyped
// from memory each session, which is part of why suites sat red for weeks
// without anyone noticing.
//
//   node tests/browser/run.js                 every browser suite
//   node tests/browser/run.js t8              suites whose name contains "t8"
//   node tests/browser/run.js --units         the .mjs unit set only
//   node tests/browser/run.js --all           units, then every browser suite
//   node tests/browser/run.js --list          names only, run nothing
//   node tests/browser/run.js --network       ALSO run the suites that reach
//                                             the real internet (see SLOW/NETWORK)
//
// Exits non-zero if anything failed, so CI or a pre-push hook can use it.
const { spawn, spawnSync } = require("node:child_process");
const { readdirSync, existsSync } = require("node:fs");
const { join, dirname } = require("node:path");
const http = require("node:http");

const HERE = __dirname;
const ROOT = join(HERE, "..", "..");
const PORT = 8791; // The Worker's ALLOWED_ORIGIN names this exact port.
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const filters = args.filter(a => !a.startsWith("--"));

// Suites that are NOT self-contained. They are excluded by default so a red run
// means "the product broke", not "the wifi is slow" — the ambiguity FIX-020's
// checklist called out. Run them deliberately with --network.
// Named individually AND by the `-live` convention: the first sweep after this
// runner was written still picked up t67-live, t69-live, t71-live and t74-live,
// because listing three files by hand is a list that goes stale. They passed,
// but a suite whose result depends on the internet must be opted into.
const NETWORK_NAMED = new Set([
  "t14-live.js",        // reaches the real Socrata/Worker network
  "t30-share-live.js",  // publishes against the deployed Worker
  "t79-live-close.js",  // closes cards against the DEPLOYED site
]);
const isNetwork = f => NETWORK_NAMED.has(f) || /-live[.-]/.test(f);

// Mutation controls: they REWRITE docs/*.html while they run, so they can never
// run alongside anything else. Excluded from the sweep; run one at a time.
const isMutant = f => /mutants?\.js$/.test(f);

function suites() {
  return readdirSync(HERE)
    .filter(f => /^t.*\.js$/.test(f) && !isMutant(f))
    .filter(f => flag("--network") || !isNetwork(f))
    .filter(f => !filters.length || filters.some(x => f.includes(x)))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

function serverUp() {
  return new Promise(resolve => {
    const req = http.get({ host: "localhost", port: PORT, path: "/index.html", timeout: 1500 },
      res => { res.resume(); resolve(res.statusCode === 200); });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  if (await serverUp()) return null;
  const py = process.platform === "win32" ? "python" : "python3";
  const child = spawn(py, ["-m", "http.server", String(PORT), "--directory", join(ROOT, "docs")],
    { cwd: ROOT, stdio: "ignore", detached: false });
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (await serverUp()) return child;
  }
  child.kill();
  throw new Error(`Could not start the static server on ${PORT}. Start it yourself:\n  ${py} -m http.server ${PORT} --directory docs`);
}

function runUnits() {
  // The glob is expanded here rather than handed to a shell: `shell: true` on
  // Windows runs the command through cmd.exe, which splits node's own path at
  // the space in "C:\Program Files" and fails before it starts.
  const units = readdirSync(HERE).filter(f => f.endsWith(".mjs")).map(f => join(HERE, f));
  console.log(`\n=== ${units.length} unit files (node --test) ===`);
  const r = spawnSync(process.execPath, ["--test", ...units], { cwd: ROOT, stdio: "inherit" });
  return r.status === 0;
}

(async () => {
  if (flag("--list")) { suites().forEach(s => console.log(s)); return; }

  let unitsOk = true;
  if (flag("--units") || flag("--all")) unitsOk = runUnits();
  if (flag("--units")) process.exit(unitsOk ? 0 : 1);

  const list = suites();
  if (!list.length) { console.error("No suites matched."); process.exit(1); }

  let server;
  try {
    server = await ensureServer();
  } catch (e) {
    console.error(String(e.message));
    process.exit(1);
  }

  const started = Date.now();
  const failed = [];
  console.log(`\n=== ${list.length} browser suites on http://localhost:${PORT} ===`);
  for (const [i, file] of list.entries()) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(HERE, file)], { cwd: ROOT, encoding: "utf8" });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const ok = r.status === 0;
    if (!ok) failed.push({ file, out: (r.stdout || "") + (r.stderr || "") });
    console.log(`${String(i + 1).padStart(3)}/${list.length} ${ok ? "PASS" : "FAIL"}  ${file.padEnd(34)} ${secs}s`);
  }
  if (server) server.kill();

  console.log(`\n${list.length - failed.length}/${list.length} passed in ${((Date.now() - started) / 1000 / 60).toFixed(1)} min`);
  if (failed.length) {
    console.log("\nFailed:");
    for (const f of failed) {
      console.log(`\n--- ${f.file}`);
      // The failing assertion lines, not the whole transcript.
      const lines = f.out.split(/\r?\n/).filter(l => /FAIL|Error|✖/.test(l)).slice(0, 6);
      lines.forEach(l => console.log("    " + l.trim().slice(0, 160)));
    }
  }
  process.exit(failed.length || !unitsOk ? 1 : 0);
})();
