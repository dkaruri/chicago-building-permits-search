import { test } from "node:test";
import assert from "node:assert";
import { makeShareId, sanitizePermits, sanitizeFocal, sanitizeMeta, buildListMeta, readList, filterEntries, sanitizeCustom, sanitizeTicks } from "../src/lists.js";

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
import { revKey, pruneRevs } from "../src/revisions.js";

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

const ENTRIES = [
  { name: "list:aaa", metadata: { title: "North Side Roof Runs", author: "Divyam", blurb: "Albany Park", tags: [["roofing", 0]], count: 100 } },
  { name: "list:bbb", metadata: { title: "Logan Square tuckpointing", author: "M. Reyes", blurb: "masonry", tags: [["masonry", 9]], count: 62 } },
  { name: "list:ccc", metadata: { title: "Stalled jobs", author: "anonymous", blurb: "watchlist", tags: [], count: 23 } },
];

test("filterEntries matches title, author, blurb case-insensitively", () => {
  assert.deepEqual(filterEntries(ENTRIES, "roof", "").map(e => e.name), ["list:aaa"]);
  assert.deepEqual(filterEntries(ENTRIES, "REYES", "").map(e => e.name), ["list:bbb"]);
  assert.deepEqual(filterEntries(ENTRIES, "watchlist", "").map(e => e.name), ["list:ccc"]);
});

test("filterEntries matches tag names", () => {
  assert.deepEqual(filterEntries(ENTRIES, "masonry", "").map(e => e.name), ["list:bbb"]);
});

test("filterEntries tag filter is exact, not substring", () => {
  assert.deepEqual(filterEntries(ENTRIES, "", "roofing").map(e => e.name), ["list:aaa"]);
  assert.deepEqual(filterEntries(ENTRIES, "", "roof"), []);
});

test("filterEntries combines q and tag with AND", () => {
  assert.deepEqual(filterEntries(ENTRIES, "roof", "masonry"), []);
  assert.deepEqual(filterEntries(ENTRIES, "north", "roofing").map(e => e.name), ["list:aaa"]);
});

test("filterEntries with no filters returns everything", () => {
  assert.equal(filterEntries(ENTRIES, "", "").length, 3);
});

test("filterEntries tolerates entries with no metadata", () => {
  assert.deepEqual(filterEntries([{ name: "list:zzz" }], "roof", ""), []);
  assert.equal(filterEntries([{ name: "list:zzz" }], "", "").length, 1);
});

test("GET /api/lists pages with a cursor and filters the page", async () => {
  const env = ENV();
  for (let i = 0; i < 3; i++) {
    await handleLists(new URL("https://w/api/lists"), env,
      post({ permits: ["10000" + i], title: i === 1 ? "Roofing run" : "Other " + i, tags: [["roofing", 0]] }));
  }
  const all = await handleLists(new URL("https://w/api/lists"), env, new Request("https://w/api/lists"));
  const body = await all.json();
  assert.equal(body.lists.length, 3);
  assert.equal(body.cursor, null, "a complete page must report no cursor");
  assert.ok(body.lists.every(row => /^[0-9A-Za-z]{7}$/.test(row.id)), "rows expose a bare id");

  const filtered = await handleLists(new URL("https://w/api/lists?q=roofing+run"), env,
    new Request("https://w/api/lists?q=roofing+run"));
  assert.equal((await filtered.json()).lists.length, 1);
});

test("GET /api/lists returns a cursor when more than one page remains", async () => {
  const env = ENV();
  for (let i = 0; i < 250; i++) {
    await env.CACHE.put("list:" + String(i).padStart(4, "0"), JSON.stringify({ v: 2, p: ["1"] }),
      { metadata: { title: "L" + i, publishedAt: i } });
  }
  const first = await handleLists(new URL("https://w/api/lists"), env, new Request("https://w/api/lists"));
  const page1 = await first.json();
  assert.equal(page1.lists.length, 200);
  assert.ok(page1.cursor, "an incomplete page must return a cursor");

  const next = new URL(`https://w/api/lists?cursor=${page1.cursor}`);
  const second = await handleLists(next, env, new Request(next));
  const page2 = await second.json();
  assert.equal(page2.lists.length, 50);
  assert.equal(page2.cursor, null);

  const ids = new Set([...page1.lists, ...page2.lists].map(r => r.id));
  assert.equal(ids.size, 250, "pages must not overlap or drop rows");
});

test("revKey builds a padded, sortable key", () => {
  assert.equal(revKey("YnF7y4t", 3), "listrev:YnF7y4t:0003");
  assert.equal(revKey("YnF7y4t", 1200), "listrev:YnF7y4t:1200");
});

test("pruneRevs keeps the newest 20 and returns older ones to delete", () => {
  assert.deepEqual(pruneRevs(5), []);
  assert.deepEqual(pruneRevs(20), []);
  assert.deepEqual(pruneRevs(21), [1]);
  assert.deepEqual(pruneRevs(25), [1, 2, 3, 4, 5]);
});

test("PUT edits metadata, bumps rev and snapshots the prior value", async () => {
  const env = ENV();
  const created = await handleLists(new URL("https://w/api/lists"), env,
    post({ permits: ["100234"], title: "First" }));
  const { id } = await created.json();

  const url = new URL(`https://w/api/lists/${id}`);
  const put = body => new Request(url, { method: "PUT", body: JSON.stringify(body) });
  const edited = await handleLists(url, env, put({ title: "Second", author: "Divyam" }));
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).rev, 2);

  const fetched = await handleLists(url, env, get(id));
  const body = await fetched.json();
  assert.equal(body.meta.title, "Second");
  assert.equal(body.meta.author, "Divyam");
  assert.deepEqual(body.permits, ["100234"], "omitting permits must not clear them");
  assert.ok(env.CACHE.map.has(revKey(id, 1)), "prior value must be snapshotted");
});

test("PUT preserves the original publishedAt", async () => {
  const env = ENV();
  const { id } = await (await handleLists(new URL("https://w/api/lists"), env,
    post({ permits: ["100234"], title: "First" }))).json();
  const before = env.CACHE.meta.get("list:" + id).publishedAt;
  const url = new URL(`https://w/api/lists/${id}`);
  await handleLists(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ title: "Second" }) }));
  assert.equal(env.CACHE.meta.get("list:" + id).publishedAt, before);
});

test("PUT on an unknown id is 404", async () => {
  const url = new URL("https://w/api/lists/ZzZz999");
  const res = await handleLists(url, ENV(), new Request(url, { method: "PUT", body: "{}" }));
  assert.equal(res.status, 404);
});

test("PUT prunes revisions beyond the newest 20", async () => {
  const env = ENV();
  const { id } = await (await handleLists(new URL("https://w/api/lists"), env,
    post({ permits: ["100234"], title: "v" }))).json();
  const url = new URL(`https://w/api/lists/${id}`);
  for (let i = 0; i < 25; i++) {
    await handleLists(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ title: "v" + i }) }));
  }
  const revs = [...env.CACHE.map.keys()].filter(k => k.startsWith("listrev:"));
  assert.ok(revs.length <= 20, `kept ${revs.length} revisions`);
  assert.ok(!env.CACHE.map.has(revKey(id, 1)), "the oldest revision must be gone");
});

test("a filtered page can be short while a cursor still remains", async () => {
  const env = ENV();
  for (let i = 0; i < 250; i++) {
    await env.CACHE.put("list:" + String(i).padStart(4, "0"), JSON.stringify({ v: 2, p: ["1"] }),
      { metadata: { title: i === 5 ? "needle" : "L" + i, tags: [] } });
  }
  const url = new URL("https://w/api/lists?q=needle");
  const res = await handleLists(url, env, new Request(url));
  const body = await res.json();
  // Exactly the trap the client must not fall into: 1 row back, but more pages exist.
  assert.equal(body.lists.length, 1);
  assert.ok(body.cursor, "cursor must survive filtering");
});

test("sanitizeCustom keeps well-formed stops and clamps fields", () => {
  const out = sanitizeCustom([{
    id: "c_3f1a", pos: 3, addr: "3701 W Ainslie St", lat: 41.97, lon: -87.72,
    use: "residential", work: "Gut rehab", gc: "606 CONSTRUCTION",
  }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].addr, "3701 W Ainslie St");
  assert.equal(out[0].lat, 41.97);
  assert.equal(out[0].use, "residential");
});

test("sanitizeCustom keeps a stop that failed to geocode, with null coords", () => {
  const out = sanitizeCustom([{ id: "c_1", pos: 1, addr: "Coach house behind 4901 N Kedzie" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].lat, null);
  assert.equal(out[0].lon, null);
});

test("sanitizeCustom drops entries with no usable address", () => {
  assert.deepEqual(sanitizeCustom([{ id: "c_1", addr: "   " }, { id: "c_2" }]), []);
});

test("sanitizeCustom rejects an unusable id rather than trusting it", () => {
  assert.deepEqual(sanitizeCustom([{ id: "../../etc", addr: "x" }]), []);
  assert.deepEqual(sanitizeCustom([{ id: "list:evil", addr: "x" }]), []);
});

test("sanitizeCustom clamps an out-of-range use to unclear", () => {
  assert.equal(sanitizeCustom([{ id: "c_1", addr: "x", use: "spaceship" }])[0].use, "unclear");
});

test("sanitizeCustom caps the array at 60", () => {
  const many = Array.from({ length: 90 }, (_, i) => ({ id: "c_" + i, addr: "A" + i }));
  assert.equal(sanitizeCustom(many).length, 60);
});

test("sanitizeCustom rejects a non-array", () => {
  assert.deepEqual(sanitizeCustom("nope"), []);
  assert.deepEqual(sanitizeCustom(null), []);
});

test("sanitizeTicks keeps only keys present in the list", () => {
  assert.deepEqual(sanitizeTicks({ "101082609": 1, "999": 1 }, new Set(["101082609"])),
    { "101082609": 1 });
});

test("sanitizeTicks stores only truthy ticks, normalised to 1", () => {
  assert.deepEqual(sanitizeTicks({ a: 1, b: 0, c: true, d: false }, new Set(["a", "b", "c", "d"])),
    { a: 1, c: 1 });
});

test("sanitizeTicks tolerates junk", () => {
  assert.deepEqual(sanitizeTicks(null, new Set(["a"])), {});
  assert.deepEqual(sanitizeTicks("nope", new Set(["a"])), {});
});

test("PUT /ticks flips a single key without rewriting permits", async () => {
  const env = ENV();
  const { id } = await (await handleLists(new URL("https://w/api/lists"), env,
    post({ permits: ["100234", "100987"], title: "T" }))).json();
  const url = new URL(`https://w/api/lists/${id}/ticks`);
  const res = await handleLists(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ key: "100234", on: true }) }));
  assert.equal(res.status, 200);
  const body = await (await handleLists(new URL(`https://w/api/lists/${id}`), env, get(id))).json();
  assert.deepEqual(body.ticks, { "100234": 1 });
  assert.deepEqual(body.permits, ["100234", "100987"], "permits must be untouched");
});

test("PUT /ticks can clear a tick", async () => {
  const env = ENV();
  const { id } = await (await handleLists(new URL("https://w/api/lists"), env,
    post({ permits: ["100234"], title: "T" }))).json();
  const url = new URL(`https://w/api/lists/${id}/ticks`);
  await handleLists(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ key: "100234", on: true }) }));
  await handleLists(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ key: "100234", on: false }) }));
  const body = await (await handleLists(new URL(`https://w/api/lists/${id}`), env, get(id))).json();
  assert.deepEqual(body.ticks, {});
});

test("PUT /ticks refuses a key that is not in the list", async () => {
  const env = ENV();
  const { id } = await (await handleLists(new URL("https://w/api/lists"), env,
    post({ permits: ["100234"], title: "T" }))).json();
  const url = new URL(`https://w/api/lists/${id}/ticks`);
  const res = await handleLists(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ key: "999999", on: true }) }));
  assert.equal(res.status, 400);
});

test("PUT /ticks does NOT write a revision", async () => {
  const env = ENV();
  const { id } = await (await handleLists(new URL("https://w/api/lists"), env,
    post({ permits: ["100234"], title: "T" }))).json();
  const url = new URL(`https://w/api/lists/${id}/ticks`);
  await handleLists(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ key: "100234", on: true }) }));
  const revs = [...env.CACHE.map.keys()].filter(k => k.startsWith("listrev:"));
  assert.equal(revs.length, 0, "a checkbox tap is not an edit worth versioning");
});

test("POST round-trips custom stops", async () => {
  const env = ENV();
  const created = await handleLists(new URL("https://w/api/lists"), env, post({
    permits: ["100234"], title: "T",
    custom: [{ id: "c_1", pos: 2, addr: "3701 W Ainslie St", lat: 41.97, lon: -87.72, use: "residential", work: "Gut rehab" }],
  }));
  const { id } = await created.json();
  const body = await (await handleLists(new URL(`https://w/api/lists/${id}`), env, get(id))).json();
  assert.equal(body.custom.length, 1);
  assert.equal(body.custom[0].addr, "3701 W Ainslie St");
  assert.equal(body.meta.count, 2, "custom stops count toward the list size");
});
