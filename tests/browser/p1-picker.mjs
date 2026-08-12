import { test } from "node:test";
import assert from "node:assert";
import { listCapacity } from "./p1-picker-impl.mjs";

test("reports full remaining room on an empty list", () => {
  assert.deepEqual(listCapacity({ permits: [] }, 63), { room: 220, fits: true, willAdd: 63 });
});

test("reports a partial fit when the list is nearly full", () => {
  assert.deepEqual(listCapacity({ permits: new Array(180).fill("x") }, 63),
    { room: 40, fits: false, willAdd: 40 });
});

test("reports zero room on a full list", () => {
  assert.deepEqual(listCapacity({ permits: new Array(220).fill("x") }, 5),
    { room: 0, fits: false, willAdd: 0 });
});

test("a single add always fits when there is any room", () => {
  assert.deepEqual(listCapacity({ permits: new Array(219).fill("x") }, 1),
    { room: 1, fits: true, willAdd: 1 });
});

test("tolerates a missing or malformed list", () => {
  assert.deepEqual(listCapacity(null, 3), { room: 220, fits: true, willAdd: 3 });
  assert.deepEqual(listCapacity({}, 3), { room: 220, fits: true, willAdd: 3 });
});
