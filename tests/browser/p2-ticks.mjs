import { test } from "node:test";
import assert from "node:assert";
import { coalesceTicks } from "./p2-ticks-impl.mjs";

test("the last write for a key wins", () => {
  assert.deepEqual(coalesceTicks([["a", true], ["a", false], ["a", true]]), [["a", true]]);
});

test("distinct keys are all kept, in first-seen order", () => {
  assert.deepEqual(coalesceTicks([["a", true], ["b", false], ["a", false]]),
    [["a", false], ["b", false]]);
});

test("an empty queue coalesces to nothing", () => {
  assert.deepEqual(coalesceTicks([]), []);
});

test("a tick and untick of the same key collapses to one write", () => {
  assert.equal(coalesceTicks([["a", true], ["a", false]]).length, 1);
});
