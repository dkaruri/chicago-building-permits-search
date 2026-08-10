// FEAT-047. The tri-state filter's whole behaviour lives in four pure functions
// so it can be tested without a browser. They are declared in all three pages
// (no shared module on this site), and this file both exercises them and holds
// the copies in agreement — the FIX-046 lesson.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs");
const PAGES = ["index.html", "map.html", "list.html"];
const read = p => readFileSync(join(DOCS, p), "utf8");

function loadFns(page) {
  const src = read(page);
  const grab = name => {
    const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n    \\}`));
    assert.ok(m, `${page} has no ${name}`);
    return m[0];
  };
  return Function(`"use strict";
    ${grab("normalizeTriState")}
    ${grab("cycleTriState")}
    ${grab("matchesTriState")}
    ${grab("triStateOf")}
    return { normalizeTriState, cycleTriState, matchesTriState, triStateOf };`)();
}

const F = loadFns("map.html");

test("all three pages declare each function exactly once", () => {
  for (const page of PAGES) {
    for (const fn of ["normalizeTriState", "cycleTriState", "matchesTriState", "triStateOf"]) {
      const hits = read(page).match(new RegExp(`function ${fn}\\(`, "g")) || [];
      assert.equal(hits.length, 1, `${page} declares ${fn} ${hits.length} times`);
    }
  }
});

test("the three copies are identical", () => {
  const [a, b, c] = PAGES.map(p => JSON.stringify(loadFns(p) && read(p).match(/function normalizeTriState\([\s\S]*?\n    \}[\s\S]*?function triStateOf\([\s\S]*?\n    \}/)[0]));
  assert.equal(a, b, "index.html and map.html disagree");
  assert.equal(a, c, "index.html and list.html disagree");
});

test("normalizeTriState survives anything storage can hold", () => {
  assert.deepStrictEqual(F.normalizeTriState(undefined), { include: [], exclude: [] });
  assert.deepStrictEqual(F.normalizeTriState(null), { include: [], exclude: [] });
  assert.deepStrictEqual(F.normalizeTriState("nonsense"), { include: [], exclude: [] });
  assert.deepStrictEqual(F.normalizeTriState({ include: "x" }), { include: [], exclude: [] });
  assert.deepStrictEqual(F.normalizeTriState({ include: ["a", 1, null], exclude: ["b"] }),
    { include: ["a"], exclude: ["b"] });
});

test("cycling goes off -> include -> exclude -> off", () => {
  let f = { include: [], exclude: [] };
  f = F.cycleTriState(f, "progress");
  assert.deepStrictEqual(f, { include: ["progress"], exclude: [] });
  f = F.cycleTriState(f, "progress");
  assert.deepStrictEqual(f, { include: [], exclude: ["progress"] });
  f = F.cycleTriState(f, "progress");
  assert.deepStrictEqual(f, { include: [], exclude: [] });
});

test("cycling one value never disturbs another", () => {
  let f = { include: ["a"], exclude: ["b"] };
  f = F.cycleTriState(f, "c");
  assert.deepStrictEqual(f.include.sort(), ["a", "c"]);
  assert.deepStrictEqual(f.exclude, ["b"]);
});

test("triStateOf reports the state of one value", () => {
  const f = { include: ["a"], exclude: ["b"] };
  assert.equal(F.triStateOf(f, "a"), "include");
  assert.equal(F.triStateOf(f, "b"), "exclude");
  assert.equal(F.triStateOf(f, "z"), "");
});

test("Rule B: includes narrow, excludes remove, and BOTH apply", () => {
  // No filter set -> everything passes.
  assert.equal(F.matchesTriState("a", { include: [], exclude: [] }), true);
  // Include-only is a whitelist.
  assert.equal(F.matchesTriState("a", { include: ["a"], exclude: [] }), true);
  assert.equal(F.matchesTriState("b", { include: ["a"], exclude: [] }), false);
  // Exclude-only is a blacklist.
  assert.equal(F.matchesTriState("a", { include: [], exclude: ["a"] }), false);
  assert.equal(F.matchesTriState("b", { include: [], exclude: ["a"] }), true);
  // Both apply. This is the rule the alternative design got wrong: an include
  // must NOT silence an exclude.
  assert.equal(F.matchesTriState("a", { include: ["a", "b"], exclude: ["a"] }), false,
    "an exclude must still bite when includes are set");
  assert.equal(F.matchesTriState("b", { include: ["a", "b"], exclude: ["a"] }), true);
});

test("a value with no stage is excluded once any include is set", () => {
  // "" is what permitStage returns for a permit with no usable milestone.
  assert.equal(F.matchesTriState("", { include: [], exclude: [] }), true);
  assert.equal(F.matchesTriState("", { include: ["progress"], exclude: [] }), false);
});
