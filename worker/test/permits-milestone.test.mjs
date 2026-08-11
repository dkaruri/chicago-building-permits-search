// FEAT-046. The stage chip is derived from permit_milestone, so the column has
// to survive the Worker's explicit select list into the response row. An
// omission here is silent: every downstream chip just disappears.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "permits.js"), "utf8");

test("permit_milestone is in the SoQL select list", () => {
  const block = SRC.slice(SRC.indexOf("const selectCols"), SRC.indexOf("].join(\",\")"));
  assert.ok(block.includes('"permit_milestone"'),
    "permit_milestone missing from selectCols — Socrata will not return it");
});

test("permit_milestone is copied onto the response row", () => {
  assert.ok(/permit_milestone:\s*row\.permit_milestone/.test(SRC),
    "permit_milestone selected but never mapped onto the result row");
});
