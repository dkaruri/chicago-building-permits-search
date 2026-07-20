import { test } from "node:test";
import assert from "node:assert";
import { makeShareId, sanitizePermits, sanitizeFocal } from "../src/lists.js";

test("makeShareId is 7 base62 chars and varies", () => {
  const a = makeShareId();
  assert.match(a, /^[0-9A-Za-z]{7}$/);
  assert.notEqual(a, makeShareId());
});

test("sanitizePermits keeps valid, dedupes, drops bad, caps at 220", () => {
  assert.deepEqual(sanitizePermits(["100234", "B200461632", "100234"]), ["100234", "B200461632"]);
  assert.deepEqual(sanitizePermits(["ok-1", "bad space", "sql'; DROP", "toolong01234567890"]), ["ok-1"]);
  assert.equal(sanitizePermits(Array.from({ length: 300 }, (_, i) => "1000000" + i)).length, 220);
  assert.deepEqual(sanitizePermits("nope"), []);
});

test("sanitizeFocal validates coords and caps label", () => {
  assert.deepEqual(sanitizeFocal({ lat: 41.9, lon: -87.6, label: "HQ" }), { lat: 41.9, lon: -87.6, label: "HQ" });
  assert.equal(sanitizeFocal({ lat: "x", lon: -87.6 }), null);
  assert.equal(sanitizeFocal(null), null);
  assert.equal(sanitizeFocal({ lat: 41.9, lon: -87.6, label: "x".repeat(200) }).label.length, 120);
});
