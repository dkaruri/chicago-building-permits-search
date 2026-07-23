import { test } from "node:test";
import assert from "node:assert";
import { makeShareId, sanitizePermits, sanitizeFocal, sanitizeMeta, buildListMeta, readList } from "../src/lists.js";

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
  const meta = new Map();
  return {
    map,
    meta,
    async get(k) { return map.get(k) ?? null; },
    async put(k, v, opts) { map.set(k, v); if (opts && opts.metadata) meta.set(k, opts.metadata); },
    async getWithMetadata(k) { return { value: map.get(k) ?? null, metadata: meta.get(k) ?? null }; },
    async delete(k) { map.delete(k); meta.delete(k); },
    async list({ prefix = "", limit = 1000, cursor } = {}) {
      const all = [...map.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + limit);
      const end = start + page.length;
      return {
        keys: page.map(name => ({ name, metadata: meta.get(name) ?? null })),
        list_complete: end >= all.length,
        cursor: end >= all.length ? null : String(end),
      };
    },
  };
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
  const body = await fetched.json();
  // v2 extends the response with desc/custom/ticks/meta; permits + focal are unchanged.
  assert.deepEqual(body.permits, ["100234", "100987"]);
  assert.deepEqual(body.focal, { lat: 41.9, lon: -87.6, label: "HQ" });
  assert.deepEqual(body.custom, []);
  assert.deepEqual(body.ticks, {});
  assert.equal(body.meta.title, "Untitled list");
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

test("readList normalises a v1 payload to v2 shape", () => {
  const v1 = JSON.stringify({ v: 1, p: ["101082609"], f: { lat: 41.9, lon: -87.6, label: "HQ" } });
  const out = readList(v1);
  assert.equal(out.v, 2);
  assert.deepEqual(out.p, ["101082609"]);
  assert.deepEqual(out.f, { lat: 41.9, lon: -87.6, label: "HQ" });
  assert.equal(out.desc, "");
  assert.deepEqual(out.custom, []);
  assert.deepEqual(out.ticks, {});
});

test("readList returns null for unparseable storage", () => {
  assert.equal(readList("{not json"), null);
  assert.equal(readList(null), null);
});

test("sanitizeMeta clamps title, blurb and tag count", () => {
  const out = sanitizeMeta({
    title: "T".repeat(200),
    author: "A".repeat(200),
    desc: "D".repeat(500),
    tags: Array.from({ length: 20 }, (_, i) => [`tag${i}`, i % 10]),
  });
  assert.equal(out.title.length, 80);
  assert.equal(out.author.length, 40);
  assert.equal(out.blurb.length, 160);
  assert.equal(out.tags.length, 8);
});

test("sanitizeMeta drops malformed tags and clamps slots to 0-9", () => {
  const out = sanitizeMeta({ tags: [["ok", 3], ["bad", 99], ["neg", -1], "notpair", [123, 1]] });
  assert.deepEqual(out.tags, [["ok", 3]]);
});

test("sanitizeMeta defaults an empty title to Untitled list", () => {
  assert.equal(sanitizeMeta({}).title, "Untitled list");
});

test("buildListMeta stays under the 1024 byte KV metadata limit", () => {
  const stored = {
    v: 2,
    p: Array.from({ length: 220 }, (_, i) => "10000" + i),
    desc: "D".repeat(500),
    custom: [],
  };
  const meta = buildListMeta(stored, {
    title: "T".repeat(80),
    author: "A".repeat(40),
    tags: Array.from({ length: 8 }, (_, i) => ["a".repeat(24), i]),
  }, 1753228800);
  const size = new TextEncoder().encode(JSON.stringify(meta)).length;
  assert.ok(size <= 1024, `metadata was ${size} bytes`);
  assert.equal(meta.count, 220);
  assert.equal(meta.publishedAt, 1753228800);
});

test("buildListMeta counts custom stops toward count", () => {
  const meta = buildListMeta(
    { v: 2, p: ["101082609"], desc: "", custom: [{ id: "c_1", addr: "x" }] },
    { title: "T" },
    1
  );
  assert.equal(meta.count, 2);
});
