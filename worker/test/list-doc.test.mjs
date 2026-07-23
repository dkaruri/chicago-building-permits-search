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
