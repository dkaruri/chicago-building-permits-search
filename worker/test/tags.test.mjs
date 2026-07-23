import { test } from "node:test";
import assert from "node:assert";
import { normalizeTag, handleTags } from "../src/tags.js";

test("normalizeTag lowercases, trims and collapses whitespace", () => {
  assert.equal(normalizeTag("  North   Side  "), "north side");
  assert.equal(normalizeTag("ROOFING"), "roofing");
});

test("normalizeTag strips characters that would break a KV key", () => {
  assert.equal(normalizeTag("roof/ing"), "roofing");
  assert.equal(normalizeTag("a:b"), "ab");
  assert.equal(normalizeTag("2-4 flat"), "2-4 flat");
});

test("normalizeTag caps length at 24", () => {
  assert.equal(normalizeTag("x".repeat(50)).length, 24);
});

test("normalizeTag returns empty string for unusable input", () => {
  assert.equal(normalizeTag("   "), "");
  assert.equal(normalizeTag(null), "");
  assert.equal(normalizeTag("///"), "");
});

function fakeKV() {
  const map = new Map();
  const meta = new Map();
  return {
    map,
    meta,
    async put(k, v, opts) { map.set(k, v); if (opts && opts.metadata) meta.set(k, opts.metadata); },
    async list({ prefix = "" } = {}) {
      return {
        keys: [...map.keys()].filter(k => k.startsWith(prefix)).sort()
          .map(name => ({ name, metadata: meta.get(name) ?? null })),
        list_complete: true,
        cursor: null,
      };
    },
  };
}
const ENV = () => ({ CACHE: fakeKV() });
const url = new URL("https://w/api/tags");

test("PUT then GET round-trips a tag slot", async () => {
  const env = ENV();
  const put = await handleTags(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ name: "Roofing", slot: 0 }) }));
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), { name: "roofing", slot: 0 });

  const got = await handleTags(url, env, new Request(url));
  assert.deepEqual((await got.json()).tags, { roofing: 0 });
});

test("PUT rejects an out-of-range slot", async () => {
  const env = ENV();
  for (const slot of [10, -1, 1.5, "0", null]) {
    const res = await handleTags(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ name: "x", slot }) }));
    assert.equal(res.status, 400, `slot ${slot} should be rejected`);
  }
});

test("PUT rejects a tag that normalises to nothing", async () => {
  const res = await handleTags(url, ENV(), new Request(url, { method: "PUT", body: JSON.stringify({ name: "///", slot: 1 }) }));
  assert.equal(res.status, 400);
});

test("PUT rejects malformed json", async () => {
  const res = await handleTags(url, ENV(), new Request(url, { method: "PUT", body: "{nope" }));
  assert.equal(res.status, 400);
});

test("a recolor overwrites the existing slot", async () => {
  const env = ENV();
  await handleTags(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ name: "roofing", slot: 0 }) }));
  await handleTags(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ name: "roofing", slot: 7 }) }));
  assert.deepEqual((await (await handleTags(url, env, new Request(url))).json()).tags, { roofing: 7 });
});

test("DELETE is not allowed", async () => {
  const res = await handleTags(url, ENV(), new Request(url, { method: "DELETE" }));
  assert.equal(res.status, 405);
});
