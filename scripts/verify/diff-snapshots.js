#!/usr/bin/env node
// Diff two snapshot-controls.js runs and group the changes by declaration.
//
//   node scripts/verify/diff-snapshots.js before.json after.json [--all]
//
// Exit code is 1 when anything changed, so it can gate a refactor that is
// supposed to be behaviour-preserving.
//
// Read the output as: every line is a declaration the change altered on N
// controls. For a pure-refactor claim the answer must be 0. For a deliberate
// change, each group must be one you can name and defend -- a group you cannot
// explain is the regression.

const { resolve } = require("node:path");

const [beforePath, afterPath] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const showAll = process.argv.includes("--all");
if (!beforePath || !afterPath) {
  console.error("usage: diff-snapshots.js <before.json> <after.json> [--all]");
  process.exit(2);
}
const a = require(resolve(beforePath));
const b = require(resolve(afterPath));

const diffs = [];
let missing = 0, added = 0;
for (const combo of Object.keys(a)) {
  for (const key of Object.keys(a[combo])) {
    const x = a[combo][key];
    const y = (b[combo] || {})[key];
    if (!y) { missing++; continue; }
    for (const p of Object.keys(x)) {
      if (String(x[p]) !== String(y[p])) diffs.push({ combo, key, p, from: x[p], to: y[p] });
    }
  }
}
for (const combo of Object.keys(b)) {
  for (const key of Object.keys(b[combo])) if (!(a[combo] || {})[key]) added++;
}

// An element that vanished is not "no change" -- it usually means the change
// broke the surface that renders it, so report it rather than diffing around it.
if (missing) console.log(`WARNING: ${missing} controls present before but MISSING after`);
if (added) console.log(`NOTE: ${added} controls present after but not before`);

console.log(`CHANGED DECLARATIONS: ${diffs.length}\n`);
if (!diffs.length && !missing) {
  console.log("identical — the change is behaviour-preserving for every control measured");
  process.exit(0);
}

const byProp = {};
for (const d of diffs) (byProp[`${d.p}: ${d.from} -> ${d.to}`] ||= []).push(`${d.combo} ${d.key.split("|").pop() || "?"}`);
const groups = Object.entries(byProp).sort((m, n) => n[1].length - m[1].length);
for (const [decl, where] of (showAll ? groups : groups.slice(0, 40))) {
  console.log(`${String(where.length).padStart(4)}x  ${decl}`);
  console.log(`        e.g. ${where.slice(0, 3).join(" | ")}`);
}
if (!showAll && groups.length > 40) console.log(`\n... ${groups.length - 40} more groups (--all)`);
process.exit(1);
