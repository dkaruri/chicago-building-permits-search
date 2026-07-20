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

import { handleLists } from "../src/lists.js";

function fakeKV() {
  const map = new Map();
  return { map, async get(k) { return map.get(k) ?? null; }, async put(k, v) { map.set(k, v); } };
}
const ENV = () => ({ CACHE: fakeKV() });
const post = (body) => new Request("https://w/api/lists", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (id) => new Request(`https://w/api/lists/${id}`, { method: "GET" });

test("POST then GET round-trips permits + focal", async () => {
  const env = ENV();
  const created = await handleLists(new URL("https://w/api/lists"), env, post({ permits: ["100234", "100987"], focal: { lat: 41.9, lon: -87.6, label: "HQ" } }));
  assert.equal(created.status, 200);
  const { id } = await created.json();
  assert.match(id, /^[0-9A-Za-z]{7}$/);
  const fetched = await handleLists(new URL(`https://w/api/lists/${id}`), env, get(id));
  assert.equal(fetched.status, 200);
  assert.deepEqual(await fetched.json(), { permits: ["100234", "100987"], focal: { lat: 41.9, lon: -87.6, label: "HQ" } });
});

test("POST with no valid permits is 400", async () => {
  const res = await handleLists(new URL("https://w/api/lists"), ENV(), post({ permits: ["bad space"] }));
  assert.equal(res.status, 400);
});

test("POST oversized body is 413", async () => {
  const res = await handleLists(new URL("https://w/api/lists"), ENV(), post("x".repeat(9000)));
  assert.equal(res.status, 413);
});

test("GET unknown id is 404", async () => {
  const res = await handleLists(new URL("https://w/api/lists/ZzZz999"), ENV(), get("ZzZz999"));
  assert.equal(res.status, 404);
});

test("stored value carries a 6-month TTL", async () => {
  const env = ENV();
  let ttl;
  env.CACHE.put = async (k, v, opts) => { ttl = opts && opts.expirationTtl; };
  await handleLists(new URL("https://w/api/lists"), env, post({ permits: ["100234"], focal: null }));
  assert.equal(ttl, 15552000);
});
