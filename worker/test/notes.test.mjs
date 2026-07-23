import { test } from "node:test";
import assert from "node:assert";
import { sanitizeText, sanitizeWalk, makeNoteId, handleNotes } from "../src/notes.js";

test("makeNoteId is n_ plus 8 hex and varies", () => {
  assert.match(makeNoteId(), /^n_[0-9a-f]{8}$/);
  assert.notEqual(makeNoteId(), makeNoteId());
});

test("sanitizeText trims and caps at 2000", () => {
  assert.equal(sanitizeText("  hi  "), "hi");
  assert.equal(sanitizeText("x".repeat(3000)).length, 2000);
  assert.equal(sanitizeText(null), "");
});

test("sanitizeWalk keeps a full sub-on-site payload", () => {
  const out = sanitizeWalk({
    job: "new", onsite: "sub",
    party: { name: "A PLUS REFRIGERATION", phone: "7735550142", covers: "Electrical", jobs: 3, estimate: "1-3d" },
    gc: { name: "606 CONSTRUCTION", phone: "3125550198" },
  });
  assert.equal(out.job, "new");
  assert.equal(out.onsite, "sub");
  assert.equal(out.party.name, "A PLUS REFRIGERATION");
  assert.equal(out.party.jobs, 3);
  assert.equal(out.gc.name, "606 CONSTRUCTION");
});

test("sanitizeWalk clamps job and onsite to their allowed sets", () => {
  assert.equal(sanitizeWalk({ job: "spaceship", onsite: "nobody" }).job, "remodel");
  assert.equal(sanitizeWalk({ job: "new", onsite: "aliens" }).onsite, "none");
});

test("sanitizeWalk clamps estimate to the fixed set", () => {
  assert.equal(sanitizeWalk({ onsite: "gc", party: { name: "X", estimate: "someday" } }).party.estimate, "unknown");
  assert.equal(sanitizeWalk({ onsite: "gc", party: { name: "X", estimate: "1-3d" } }).party.estimate, "1-3d");
});

test("sanitizeWalk with nobody on site drops party and gc", () => {
  const out = sanitizeWalk({ job: "remodel", onsite: "none", party: { name: "x" }, gc: { name: "y" } });
  assert.equal(out.party, null);
  assert.equal(out.gc, null);
});

test("sanitizeWalk keeps gc only when a sub was on site", () => {
  const gcOnSite = sanitizeWalk({ onsite: "gc", party: { name: "GC" }, gc: { name: "ignored" } });
  assert.equal(gcOnSite.gc, null, "a GC on site has no separate their-GC block");
  const subOnSite = sanitizeWalk({ onsite: "sub", party: { name: "Sub" }, gc: { name: "Their GC" } });
  assert.equal(subOnSite.gc.name, "Their GC");
});

function fakeKV() {
  const map = new Map(), meta = new Map();
  return {
    map, meta,
    async getWithMetadata(k) { return { value: map.get(k) ?? null, metadata: meta.get(k) ?? null }; },
    async put(k, v, opts) { map.set(k, v); if (opts && opts.metadata) meta.set(k, opts.metadata); },
    async delete(k) { map.delete(k); meta.delete(k); },
    async list({ prefix = "" } = {}) {
      return { keys: [...map.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name, metadata: meta.get(name) ?? null })), list_complete: true, cursor: null };
    },
  };
}
const ENV = () => ({ CACHE: fakeKV() });
const noteReq = (permit, method, body) => new Request(`https://w/api/notes/${permit}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

test("POST then GET round-trips a text post", async () => {
  const env = ENV();
  const posted = await handleNotes(new URL("https://w/api/notes/101082609"), env, noteReq("101082609", "POST", { kind: "text", author: "Divyam", text: "Roof crew on site" }));
  assert.equal(posted.status, 200);
  const { id } = await posted.json();
  assert.match(id, /^n_[0-9a-f]{8}$/);
  const got = await handleNotes(new URL("https://w/api/notes/101082609"), env, noteReq("101082609", "GET"));
  const body = await got.json();
  assert.equal(body.notes.length, 1);
  assert.equal(body.notes[0].text, "Roof crew on site");
  assert.equal(body.notes[0].author, "Divyam");
  assert.ok(body.notes[0].ts > 0);
});

test("author falls back to anonymous", async () => {
  const env = ENV();
  await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "POST", { kind: "text", text: "hi" }));
  const body = await (await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "GET"))).json();
  assert.equal(body.notes[0].author, "anonymous");
});

test("POST rejects a permit key that is not permit-shaped", async () => {
  const res = await handleNotes(new URL("https://w/api/notes/bad%20key"), ENV(), noteReq("bad%20key", "POST", { kind: "text", text: "x" }));
  assert.equal(res.status, 400);
});

test("POST rejects an empty text post", async () => {
  const res = await handleNotes(new URL("https://w/api/notes/1"), ENV(), noteReq("1", "POST", { kind: "text", text: "   " }));
  assert.equal(res.status, 400);
});

test("PUT edits a post in place, keeping author and ts, stamping editedTs", async () => {
  const env = ENV();
  const { id } = await (await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "POST", { kind: "text", author: "A", text: "first" }))).json();
  const url = new URL(`https://w/api/notes/1/${id}`);
  const res = await handleNotes(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ text: "edited" }) }));
  assert.equal(res.status, 200);
  const body = await (await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "GET"))).json();
  assert.equal(body.notes[0].text, "edited");
  assert.equal(body.notes[0].author, "A");
  assert.ok(body.notes[0].editedTs > 0);
});

test("DELETE removes one post and updates the count", async () => {
  const env = ENV();
  const { id } = await (await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "POST", { kind: "text", text: "a" }))).json();
  await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "POST", { kind: "text", text: "b" }));
  const url = new URL(`https://w/api/notes/1/${id}`);
  await handleNotes(url, env, new Request(url, { method: "DELETE" }));
  const body = await (await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "GET"))).json();
  assert.equal(body.notes.length, 1);
  assert.equal(env.CACHE.meta.get("note:1").n, 1);
});

test("the count map reads every noted permit in one list call", async () => {
  const env = ENV();
  await handleNotes(new URL("https://w/api/notes/100"), env, noteReq("100", "POST", { kind: "text", text: "a" }));
  await handleNotes(new URL("https://w/api/notes/100"), env, noteReq("100", "POST", { kind: "text", text: "b" }));
  await handleNotes(new URL("https://w/api/notes/200"), env, noteReq("200", "POST", { kind: "text", text: "c" }));
  const url = new URL("https://w/api/notes/counts?p=100,200,300");
  const res = await handleNotes(url, env, new Request(url));
  const body = await res.json();
  assert.deepEqual(body.counts, { "100": 2, "200": 1 });
  assert.equal(body.counts["300"], undefined, "a permit with no notes is simply absent");
});

test("a walkthrough post round-trips", async () => {
  const env = ENV();
  await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "POST", {
    kind: "walk", author: "Divyam", job: "new", onsite: "sub",
    party: { name: "Sub", phone: "7735550142", covers: "Electrical", jobs: 3, estimate: "1-3d" },
    gc: { name: "Their GC", phone: "3125550198" },
  }));
  const body = await (await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "GET"))).json();
  assert.equal(body.notes[0].kind, "walk");
  assert.equal(body.notes[0].party.name, "Sub");
  assert.equal(body.notes[0].gc.name, "Their GC");
});
