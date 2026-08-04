import { test } from "node:test";
import assert from "node:assert";
import { emptyDoc, docFromStored, applyOp, listValueFromDoc } from "../src/list-doc.js";

test("emptyDoc has the five fields", () => {
  const d = emptyDoc();
  assert.deepEqual(d.p, []);
  assert.equal(d.f, null);
  assert.deepEqual(d.custom, []);
  assert.deepEqual(d.ticks, {});
  assert.equal(d.meta.title, "Untitled list");
});

test("docFromStored builds a doc from a v2 KV value + metadata", () => {
  const value = JSON.stringify({ v: 2, p: ["101082609"], f: { lat: 41.9, lon: -87.6, label: "HQ" }, desc: "d", custom: [{ id: "c_1", addr: "x" }], ticks: { "101082609": 1 } });
  const meta = { title: "Roof Runs", author: "Div", blurb: "d", tags: [["roofing", 0]] };
  const doc = docFromStored(value, meta);
  assert.deepEqual(doc.p, ["101082609"]);
  assert.equal(doc.f.label, "HQ");
  assert.equal(doc.custom.length, 1);
  assert.deepEqual(doc.ticks, { "101082609": 1 });
  assert.equal(doc.meta.title, "Roof Runs");
  assert.deepEqual(doc.meta.tags, [["roofing", 0]]);
});

test("docFromStored on a null/absent value is an empty doc", () => {
  assert.deepEqual(docFromStored(null, null).p, []);
});

test("applyOp p replaces the permit order and re-sanitizes", () => {
  const d = applyOp(emptyDoc(), { f: "p", v: ["101082609", "bad space", "B200461632"] });
  assert.deepEqual(d.p, ["101082609", "B200461632"]);
});

test("applyOp f sets and clears the focal", () => {
  const set = applyOp(emptyDoc(), { f: "f", v: { lat: 41.9, lon: -87.6, label: "HQ" } });
  assert.equal(set.f.label, "HQ");
  const cleared = applyOp(set, { f: "f", v: null });
  assert.equal(cleared.f, null);
});

test("applyOp custom validates the stops", () => {
  const d = applyOp(emptyDoc(), { f: "custom", v: [{ id: "c_1", addr: "3701 W Ainslie", use: "residential" }, { id: "bad", addr: "x" }] });
  assert.equal(d.custom.length, 1);
  assert.equal(d.custom[0].id, "c_1");
});

test("applyOp tick sets and deletes one key", () => {
  const on = applyOp(emptyDoc(), { f: "tick", k: "101082609", v: 1 });
  assert.deepEqual(on.ticks, { "101082609": 1 });
  const off = applyOp(on, { f: "tick", k: "101082609", v: 0 });
  assert.deepEqual(off.ticks, {});
});

test("applyOp meta merges details and clamps them", () => {
  const d = applyOp(emptyDoc(), { f: "meta", v: { title: "T".repeat(200), author: "A", tags: [["roofing", 0]] } });
  assert.equal(d.meta.title.length, 80);
  assert.equal(d.meta.author, "A");
  assert.deepEqual(d.meta.tags, [["roofing", 0]]);
});

test("applyOp is pure — the input doc is not mutated", () => {
  const a = emptyDoc();
  applyOp(a, { f: "tick", k: "1", v: 1 });
  assert.deepEqual(a.ticks, {}, "original must be untouched");
});

test("applyOp ignores an unknown field", () => {
  const a = emptyDoc();
  const b = applyOp(a, { f: "nope", v: 1 });
  assert.deepEqual(b, a);
});

test("listValueFromDoc round-trips a doc to the v2 KV value shape", () => {
  const doc = applyOp(applyOp(emptyDoc(), { f: "p", v: ["101082609"] }), { f: "tick", k: "101082609", v: 1 });
  const val = listValueFromDoc(doc);
  assert.equal(val.v, 2);
  assert.deepEqual(val.p, ["101082609"]);
  assert.deepEqual(val.ticks, { "101082609": 1 });
  assert.equal(typeof val.desc, "string");
});

// ---- FEAT-034: follow-up flags ----

test("emptyDoc starts with no follow-ups", () => {
  assert.deepEqual(emptyDoc().fu, {});
});

test("applyOp fu sets and clears a follow-up flag", () => {
  const on = applyOp(emptyDoc(), { f: "fu", k: "101082609", v: 1 });
  assert.deepEqual(on.fu, { "101082609": 1 });
  const off = applyOp(on, { f: "fu", k: "101082609", v: 0 });
  assert.deepEqual(off.fu, {});
});

test("applyOp fu ignores an empty key", () => {
  assert.deepEqual(applyOp(emptyDoc(), { f: "fu", k: "", v: 1 }).fu, {});
});

test("applyOp fu does not mutate the input doc", () => {
  const before = emptyDoc();
  applyOp(before, { f: "fu", k: "101082609", v: 1 });
  assert.deepEqual(before.fu, {}, "applyOp must be pure");
});

test("applyOp fu and tick are independent", () => {
  let d = applyOp(emptyDoc(), { f: "fu", k: "A", v: 1 });
  d = applyOp(d, { f: "tick", k: "A", v: 1 });
  d = applyOp(d, { f: "fu", k: "A", v: 0 });
  assert.deepEqual(d.fu, {}, "clearing follow-up must not touch the tick");
  assert.deepEqual(d.ticks, { A: 1 }, "the visited tick must survive");
});

test("a list stored before follow-ups existed reads back with an empty fu", () => {
  const legacy = JSON.stringify({ v: 2, p: ["101082609"], f: null, desc: "", custom: [], ticks: { "101082609": 1 } });
  const doc = docFromStored(legacy, null);
  assert.deepEqual(doc.fu, {});
  // and is still writable without throwing
  assert.deepEqual(applyOp(doc, { f: "fu", k: "101082609", v: 1 }).fu, { "101082609": 1 });
});

test("listValueFromDoc persists follow-ups so they survive a round trip", () => {
  const doc = applyOp(applyOp(emptyDoc(), { f: "p", v: ["101082609"] }), { f: "fu", k: "101082609", v: 1 });
  const stored = JSON.stringify(listValueFromDoc(doc));
  assert.deepEqual(docFromStored(stored, null).fu, { "101082609": 1 });
});

// ---- Called flag (FEAT-031) ----

test("emptyDoc starts with nothing called", () => {
  assert.deepEqual(emptyDoc().called, {});
});

test("applyOp call sets and clears a called flag", () => {
  const on = applyOp(emptyDoc(), { f: "call", k: "101082609", v: 1 });
  assert.deepEqual(on.called, { "101082609": 1 });
  const off = applyOp(on, { f: "call", k: "101082609", v: 0 });
  assert.deepEqual(off.called, {});
});

test("applyOp call ignores an empty key", () => {
  assert.deepEqual(applyOp(emptyDoc(), { f: "call", k: "", v: 1 }).called, {});
});

test("applyOp call does not mutate the input doc", () => {
  const before = emptyDoc();
  applyOp(before, { f: "call", k: "101082609", v: 1 });
  assert.deepEqual(before.called, {}, "applyOp must be pure");
});

// The three flags share one case in applyOp, so the test that matters is that
// they still write to three separate maps.
test("call, tick and fu are three independent flags on the same key", () => {
  let d = emptyDoc();
  for (const f of ["call", "tick", "fu"]) d = applyOp(d, { f, k: "A", v: 1 });
  d = applyOp(d, { f: "call", k: "A", v: 0 });
  assert.deepEqual(d.called, {}, "clearing called must not touch the others");
  assert.deepEqual(d.ticks, { A: 1 }, "the visited tick must survive");
  assert.deepEqual(d.fu, { A: 1 }, "the follow-up flag must survive");
});

test("a list stored before called existed reads back with an empty called", () => {
  const legacy = JSON.stringify({ v: 2, p: ["101082609"], f: null, desc: "", custom: [], ticks: { "101082609": 1 }, fu: {} });
  const doc = docFromStored(legacy, null);
  assert.deepEqual(doc.called, {});
  assert.deepEqual(doc.ticks, { "101082609": 1 }, "the legacy 1 value must survive untouched");
  assert.deepEqual(applyOp(doc, { f: "call", k: "101082609", v: 1 }).called, { "101082609": 1 });
});

test("listValueFromDoc persists called so it survives a round trip", () => {
  const doc = applyOp(applyOp(emptyDoc(), { f: "p", v: ["101082609"] }), { f: "call", k: "101082609", v: 1 });
  const stored = JSON.stringify(listValueFromDoc(doc));
  assert.deepEqual(docFromStored(stored, null).called, { "101082609": 1 });
});

// ---- Actor attribution: "show who acted where the data allows" ----

test("op.by stores the actor's name instead of 1, and survives a round trip", () => {
  const d = applyOp(emptyDoc(), { f: "call", k: "101082609", v: 1, by: "Divyam" });
  assert.deepEqual(d.called, { "101082609": "Divyam" });
  assert.deepEqual(docFromStored(JSON.stringify(listValueFromDoc(d)), null).called, { "101082609": "Divyam" });
});

test("a blank or non-string actor falls back to 1, never an empty name", () => {
  assert.deepEqual(applyOp(emptyDoc(), { f: "tick", k: "A", v: 1, by: "   " }).ticks, { A: 1 });
  assert.deepEqual(applyOp(emptyDoc(), { f: "tick", k: "A", v: 1, by: 42 }).ticks, { A: 1 });
  assert.deepEqual(applyOp(emptyDoc(), { f: "tick", k: "A", v: 1 }).ticks, { A: 1 });
});

test("an actor name is trimmed and capped at 40 characters", () => {
  const d = applyOp(emptyDoc(), { f: "call", k: "A", v: 1, by: "  " + "N".repeat(60) + "  " });
  assert.equal(d.called.A, "N".repeat(40));
});

// The point of the fallback: a name is a display detail, and every code path
// that asks "is this set?" must keep working on a list that stores plain 1s.
test("both flag shapes are truthy, so old and new lists filter identically", () => {
  const doc = docFromStored(JSON.stringify({ v: 2, p: ["A", "B"], custom: [], ticks: { A: 1, B: "Divyam" } }), null);
  assert.deepEqual(Object.keys(doc.ticks).filter(k => doc.ticks[k]), ["A", "B"]);
});
