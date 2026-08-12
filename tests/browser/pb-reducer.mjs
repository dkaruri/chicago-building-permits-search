import { test } from "node:test";
import assert from "node:assert";
import { applyListOp } from "./pb-reducer-impl.mjs";

const L = () => ({ name: "L", permits: ["1"], focal: null, custom: [], ticks: {}, sharedId: "abc", desc: "", author: "", tags: [] });

test("p replaces the permit order", () => {
  const l = L(); applyListOp(l, { f: "p", v: ["2", "3"] });
  assert.deepEqual(l.permits, ["2", "3"]);
});
test("f sets and clears the focal", () => {
  const l = L(); applyListOp(l, { f: "f", v: { lat: 41.9, lon: -87.6, label: "HQ" } });
  assert.equal(l.focal.label, "HQ");
  applyListOp(l, { f: "f", v: null }); assert.equal(l.focal, null);
});
test("custom replaces the stops", () => {
  const l = L(); applyListOp(l, { f: "custom", v: [{ id: "c_1", addr: "x" }] });
  assert.equal(l.custom.length, 1);
});
test("tick sets and deletes one key", () => {
  const l = L(); applyListOp(l, { f: "tick", k: "1", v: 1 });
  assert.deepEqual(l.ticks, { "1": 1 });
  applyListOp(l, { f: "tick", k: "1", v: 0 }); assert.deepEqual(l.ticks, {});
});
test("meta maps title/desc/author/tags onto the list", () => {
  const l = L(); applyListOp(l, { f: "meta", v: { title: "Roof Runs", desc: "d", author: "Div", tags: [["roofing", 0]] } });
  assert.equal(l.name, "Roof Runs"); assert.equal(l.desc, "d"); assert.equal(l.author, "Div"); assert.deepEqual(l.tags, [["roofing", 0]]);
});
test("an unknown field is a no-op", () => {
  const l = L(); const snap = JSON.stringify(l);
  applyListOp(l, { f: "nope", v: 1 }); assert.equal(JSON.stringify(l), snap);
});

// ---- the two flags this file had silently stopped covering ----

test("fu sets and clears a follow-up flag (FEAT-034)", () => {
  const l = L(); applyListOp(l, { f: "fu", k: "1", v: 1 });
  assert.deepEqual(l.fu, { "1": 1 });
  applyListOp(l, { f: "fu", k: "1", v: 0 }); assert.deepEqual(l.fu, {});
});

test("call sets and clears a call mark (FEAT-031)", () => {
  const l = L(); applyListOp(l, { f: "call", k: "1", v: 1 });
  assert.deepEqual(l.called, { "1": 1 });
  applyListOp(l, { f: "call", k: "1", v: 0 }); assert.deepEqual(l.called, {});
});

// What makes a remote flag useful on a shared list: it arrives with a name.
test("an incoming op carries the actor through to the local list", () => {
  const l = L();
  applyListOp(l, { f: "call", k: "1", v: 1, by: "Divyam" });
  applyListOp(l, { f: "tick", k: "1", v: 1, by: "Sam" });
  assert.equal(l.called["1"], "Divyam");
  assert.equal(l.ticks["1"], "Sam");
});

test("an op with no actor still applies, as a plain 1", () => {
  const l = L(); applyListOp(l, { f: "call", k: "1", v: 1 });
  assert.equal(l.called["1"], 1, "a peer on an older build sends no `by`");
});

test("the three flags are independent over the wire", () => {
  const l = L();
  for (const f of ["tick", "fu", "call"]) applyListOp(l, { f, k: "1", v: 1 });
  applyListOp(l, { f: "call", k: "1", v: 0 });
  assert.deepEqual(l.called, {});
  assert.deepEqual(l.ticks, { "1": 1 });
  assert.deepEqual(l.fu, { "1": 1 });
});
