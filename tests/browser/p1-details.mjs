import { test } from "node:test";
import assert from "node:assert";
import { parseTagInput, normalizeTag } from "./p1-details-impl.mjs";
import { normalizeTag as workerNormalizeTag } from "../../worker/src/tags.js";

test("an existing tag inherits its registered slot", () => {
  assert.deepEqual(parseTagInput("roofing", { roofing: 7 }), [["roofing", 7]]);
});

test("a new tag takes the requested slot", () => {
  assert.deepEqual(parseTagInput("gut rehab", {}, 3), [["gut rehab", 3]]);
});

test("tags are normalised the same way the Worker normalises them", () => {
  assert.deepEqual(parseTagInput("  North   Side  ", {}, 4), [["north side", 4]]);
});

test("duplicates collapse and order is preserved", () => {
  assert.deepEqual(parseTagInput("roofing, roofing, masonry", { roofing: 0, masonry: 9 }),
    [["roofing", 0], ["masonry", 9]]);
});

test("unusable tag text is dropped, not stored as empty", () => {
  assert.deepEqual(parseTagInput("///, ,roofing", { roofing: 0 }), [["roofing", 0]]);
});

test("at most 8 tags survive", () => {
  const many = Array.from({ length: 12 }, (_, i) => "t" + i).join(",");
  assert.equal(parseTagInput(many, {}, 1).length, 8);
});

test("an out-of-range registry slot is clamped", () => {
  assert.deepEqual(parseTagInput("roofing", { roofing: 99 }), [["roofing", 9]]);
  assert.deepEqual(parseTagInput("roofing", { roofing: -5 }), [["roofing", 0]]);
});

// The load-bearing one: client and Worker must agree, or the tag registry forks.
test("client and Worker normalizeTag agree on every case", () => {
  const cases = ["  North   Side  ", "ROOFING", "roof/ing", "a:b", "2-4 flat",
                 "x".repeat(50), "   ", "///", "", "café", "tag_1", "A  B   C",
                 "list:injected", "../../etc", "éè"];
  for (const s of cases) {
    assert.equal(normalizeTag(s), workerNormalizeTag(s), `mismatch on ${JSON.stringify(s)}`);
  }
});
