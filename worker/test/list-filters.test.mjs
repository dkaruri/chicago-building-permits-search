// FEAT-048. The saved list's row filters, extracted from list.html and run
// directly so the rules are testable without a browser — same approach as
// worker/test/tristate.test.mjs.
//
// The rule that matters: Visited and Called are now tri-state (include /
// exclude / off) and Stage is a tri-state SET, but Follow-up stays a plain
// boolean on purpose. A version that made Follow-up tri-state, or that let a
// stage include silence a stage exclude, would be wrong.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "list.html"), "utf8");

function grab(name) {
  const m = SRC.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n    \\}`));
  assert.ok(m, `list.html has no ${name}`);
  return m[0];
}

// Build a sandbox with the real functions plus the minimum they depend on.
const sandbox = extras => Function(`"use strict";
  ${extras}
  ${grab("normalizeTriState")}
  ${grab("matchesTriState")}
  ${grab("cycleTriState")}
  ${grab("listFilterDefaults")}
  ${grab("visibleListRows")}
  return { listFilterDefaults, visibleListRows, matchesTriState, cycleTriState };`)();

// isFollowedUp / isTicked / isCalled / permitStage are supplied by the page;
// stub them off the row so the matcher's own logic is what gets exercised.
const STUBS = `
  const state = { listFilters: null };
  const isFollowedUp = r => !!r.fu;
  const isTicked = r => !!r.visited;
  const isCalled = r => !!r.called;
  const permitStage = r => r.stage || "";
`;

const F = sandbox(STUBS);
const withFilters = (filters, rows) => Function(`"use strict";
  ${STUBS}
  ${grab("normalizeTriState")}
  ${grab("matchesTriState")}
  ${grab("listFilterDefaults")}
  ${grab("visibleListRows")}
  state.listFilters = ${JSON.stringify(filters)};
  return visibleListRows(${JSON.stringify(rows)});`)();

const ROWS = [
  { id: "a", stage: "progress", visited: true, called: false, fu: false },
  { id: "b", stage: "progress", visited: false, called: true, fu: true },
  { id: "c", stage: "halted", visited: false, called: false, fu: false },
  { id: "d", stage: "complete", visited: true, called: true, fu: false },
  { id: "e", stage: "", visited: false, called: false, fu: false },
];
const ids = rows => rows.map(r => r.id).join("");

test("the default shape carries a stage set and null facets", () => {
  const d = F.listFilterDefaults();
  assert.deepStrictEqual(d.stages, { include: [], exclude: [] });
  assert.equal(d.visited, null);
  assert.equal(d.called, null);
  assert.equal(d.followUp, false);
});

test("no filters shows everything", () => {
  assert.equal(ids(withFilters(F.listFilterDefaults(), ROWS)), "abcde");
});

test("Visited include keeps only visited; exclude drops them", () => {
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), visited: "include" }, ROWS)), "ad");
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), visited: "exclude" }, ROWS)), "bce");
});

test("Called include and exclude behave the same way", () => {
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), called: "include" }, ROWS)), "bd");
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), called: "exclude" }, ROWS)), "ace");
});

test("visited + not called is the question the field actually asks", () => {
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), visited: "include", called: "exclude" }, ROWS)), "a");
});

test("Follow-up stays a plain boolean, not tri-state", () => {
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), followUp: true }, ROWS)), "b");
  // false must mean "no filter", never "exclude flagged".
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), followUp: false }, ROWS)), "abcde");
});

test("Stage include narrows, exclude removes, and BOTH apply", () => {
  const base = F.listFilterDefaults();
  assert.equal(ids(withFilters({ ...base, stages: { include: ["progress"], exclude: [] } }, ROWS)), "ab");
  assert.equal(ids(withFilters({ ...base, stages: { include: [], exclude: ["progress"] } }, ROWS)), "cde");
  // An exclude must still bite when includes are set.
  assert.equal(ids(withFilters({ ...base, stages: { include: ["progress", "halted"], exclude: ["progress"] } }, ROWS)), "c");
});

test("a CLOSED stage is filterable — this is the only surface where they appear", () => {
  const base = F.listFilterDefaults();
  assert.equal(ids(withFilters({ ...base, stages: { include: ["complete"], exclude: [] } }, ROWS)), "d");
  // Excluding Complete is the point of this feature: a saved list accumulates
  // finished jobs and there has never been a way to hide them.
  assert.equal(ids(withFilters({ ...base, stages: { include: [], exclude: ["complete"] } }, ROWS)), "abce");
});

test("a permit with no stage survives unless an include is set", () => {
  const base = F.listFilterDefaults();
  assert.equal(ids(withFilters({ ...base, stages: { include: [], exclude: ["halted"] } }, ROWS)), "abde");
  assert.equal(ids(withFilters({ ...base, stages: { include: ["progress"], exclude: [] } }, ROWS)), "ab");
});

test("facets combine across kinds", () => {
  const base = F.listFilterDefaults();
  assert.equal(ids(withFilters({ ...base, stages: { include: ["progress"], exclude: [] }, called: "exclude" }, ROWS)), "a");
});
