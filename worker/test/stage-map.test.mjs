// FEAT-046. The stage table is a bare object literal declared separately in all
// three pages, because there is no shared module to put it in. FIX-046 is what
// happens when three copies of one constant drift: index and map kept 220 while
// list said 1000, and opening the map deleted 180 saved permits. Same guard here.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs");
const PAGES = ["index.html", "map.html", "list.html"];
const read = page => readFileSync(join(DOCS, page), "utf8");

// Pull `const PERMIT_STAGES = { ... };` out of a page and evaluate it.
function stageTable(page) {
  const m = read(page).match(/const\s+PERMIT_STAGES\s*=\s*(\{[\s\S]*?\});/);
  assert.ok(m, `${page} has no PERMIT_STAGES declaration`);
  return Function(`"use strict"; return (${m[1]});`)();
}
function labelTable(page) {
  const m = read(page).match(/const\s+PERMIT_STAGE_LABELS\s*=\s*(\{[\s\S]*?\});/);
  assert.ok(m, `${page} has no PERMIT_STAGE_LABELS declaration`);
  return Function(`"use strict"; return (${m[1]});`)();
}

test("every page declares the stage table exactly once", () => {
  for (const page of PAGES) {
    const hits = read(page).match(/const\s+PERMIT_STAGES\s*=/g) || [];
    assert.equal(hits.length, 1, `${page} declares PERMIT_STAGES ${hits.length} times`);
  }
});

test("the three pages agree on the stage table", () => {
  const [a, b, c] = PAGES.map(stageTable);
  assert.deepStrictEqual(a, b, "index.html and map.html disagree on PERMIT_STAGES");
  assert.deepStrictEqual(a, c, "index.html and list.html disagree on PERMIT_STAGES");
});

test("the three pages agree on the stage labels", () => {
  const [a, b, c] = PAGES.map(labelTable);
  assert.deepStrictEqual(a, b, "index.html and map.html disagree on PERMIT_STAGE_LABELS");
  assert.deepStrictEqual(a, c, "index.html and list.html disagree on PERMIT_STAGE_LABELS");
});

test("the table covers all 11 open milestone values and nothing else", () => {
  // Measured against Socrata 2026-08-10: these are exactly the values that
  // appear on ACTIVE / SUSPENDED / PHASED PERMITTING permits. Adding a value
  // here is fine; doing it without re-measuring is not.
  const expected = {
    "PERMIT ISSUED (FEE DUE)": "fee",
    "INSPECTION ELIGIBLE": "notstarted",
    "INSPECTIONS": "progress",
    "PROGRESS INSPECTIONS": "progress",
    "INSPECTIONS (CERTIFICATE OF OCCUPANCY REQUIRED)": "finishing",
    "CERTIFICATE OF OCCUPANCY PENDING": "finishing",
    "CERTIFICATE OF OCCUPANCY PENDING (TEMPORARY OR PARTIAL OCCUPANCY APPROVED)": "finishing",
    "POST CONSTRUCTION FILING": "finishing",
    "FINAL INSPECTION": "finishing",
    "SUSPENDED": "halted",
    "STOP WORK": "halted",
  };
  assert.deepStrictEqual(stageTable("index.html"), expected);
});

test("every label is present and every stage is labelled", () => {
  const labels = labelTable("index.html");
  assert.deepStrictEqual(Object.keys(labels).sort(),
    ["complete", "ended", "fee", "finishing", "halted", "notstarted", "progress"]);
  const used = new Set(Object.values(stageTable("index.html")));
  for (const stage of used) assert.ok(labels[stage], `stage "${stage}" has no label`);
});

test("closed-permit milestone values are NOT in the table", () => {
  // A closed permit is decided by permit_status, never by milestone: 13,973
  // closed permits carry an in-progress milestone because they expired or were
  // revoked mid-inspection. Listing these here would label an EXPIRED permit
  // "In progress".
  const table = stageTable("index.html");
  for (const v of ["COMPLETE", "CANCELLED", "EXPIRED", "DENIED", "CERTIFICATE OF OCCUPANCY ISSUED"]) {
    assert.ok(!(v in table), `${v} must not be in PERMIT_STAGES — status decides closed permits`);
  }
});

test("permitStage resolves status before milestone", () => {
  // Extract the real function from the page and run it, so the test exercises
  // shipped code rather than a copy that can drift.
  const src = read("index.html");
  const table = src.match(/const\s+PERMIT_STAGES\s*=\s*\{[\s\S]*?\};/)[0];
  const fn = src.match(/function\s+permitStage\s*\(row\)\s*\{[\s\S]*?\n    \}/)[0];
  const permitStage = Function(`"use strict";
    const clean = v => (v == null ? "" : String(v));
    ${table}
    ${fn}
    return permitStage;`)();

  assert.equal(permitStage({ permit_status: "ACTIVE", permit_milestone: "INSPECTIONS" }), "progress");
  assert.equal(permitStage({ permit_status: "SUSPENDED", permit_milestone: "SUSPENDED" }), "halted");
  assert.equal(permitStage({ permit_status: "ACTIVE", permit_milestone: "PERMIT ISSUED (FEE DUE)" }), "fee");
  assert.equal(permitStage({ permit_status: "PHASED PERMITTING", permit_milestone: "INSPECTIONS" }), "progress");
  assert.equal(permitStage({ permit_status: "COMPLETE", permit_milestone: "COMPLETE" }), "complete");

  // The 13,973-permit trap: closed, but the milestone still says work is live.
  assert.equal(permitStage({ permit_status: "EXPIRED", permit_milestone: "INSPECTIONS" }), "ended",
    "a closed permit must never read as In progress");
  assert.equal(permitStage({ permit_status: "REVOKED", permit_milestone: "INSPECTIONS" }), "ended");
  assert.equal(permitStage({ permit_status: "CANCELLED", permit_milestone: "INSPECTIONS" }), "ended");
  assert.equal(permitStage({ permit_status: "COMPLETE", permit_milestone: "CERTIFICATE OF OCCUPANCY ISSUED" }), "complete");

  // No chip rather than a placeholder.
  assert.equal(permitStage({ permit_status: null, permit_milestone: null }), "");
  assert.equal(permitStage({ permit_status: "", permit_milestone: "" }), "");
  assert.equal(permitStage({ permit_status: "ACTIVE", permit_milestone: "SOMETHING NEW" }), "");
  assert.equal(permitStage({}), "");
  assert.equal(permitStage(null), "");

  // Case and whitespace tolerance — Socrata has shipped padded values before.
  assert.equal(permitStage({ permit_status: "active", permit_milestone: " inspections " }), "progress");
});
