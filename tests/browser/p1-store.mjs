import { test } from "node:test";
import assert from "node:assert";
import { migrateUserLists } from "./p1-store-impl.mjs";

test("migrates a legacy pipe-joined list into local_1", () => {
  const out = migrateUserLists(null, "101082609|B200475676");
  assert.equal(out.lastUsed, "local_1");
  assert.deepEqual(out.lists.local_1.permits, ["101082609", "B200475676"]);
  assert.equal(out.lists.local_1.name, "My Permit List");
});

test("an empty legacy value still yields one empty list", () => {
  const out = migrateUserLists(null, "");
  assert.deepEqual(Object.keys(out.lists), ["local_1"]);
  assert.deepEqual(out.lists.local_1.permits, []);
});

test("existing v2 storage is returned untouched", () => {
  const raw = JSON.stringify({ lastUsed: "local_2", lists: { local_2: { name: "Callbacks", permits: ["1"] } } });
  const out = migrateUserLists(raw, "ignored|values");
  assert.equal(out.lastUsed, "local_2");
  assert.deepEqual(Object.keys(out.lists), ["local_2"]);
});

test("corrupt storage falls back to migrating the legacy value", () => {
  const out = migrateUserLists("{not json", "101082609");
  assert.deepEqual(out.lists.local_1.permits, ["101082609"]);
});

test("lastUsed pointing at a missing list is repaired", () => {
  const raw = JSON.stringify({ lastUsed: "gone", lists: { local_1: { name: "A", permits: [] } } });
  assert.equal(migrateUserLists(raw, "").lastUsed, "local_1");
});

test("storage with zero lists is repaired to one empty list", () => {
  const out = migrateUserLists(JSON.stringify({ lastUsed: "x", lists: {} }), "");
  assert.deepEqual(Object.keys(out.lists), ["local_1"]);
});

test("permits are deduped and capped at 220", () => {
  const many = Array.from({ length: 300 }, (_, i) => "p" + i).join("|");
  assert.equal(migrateUserLists(null, many).lists.local_1.permits.length, 220);
  assert.deepEqual(migrateUserLists(null, "a|a|b").lists.local_1.permits, ["a", "b"]);
});
