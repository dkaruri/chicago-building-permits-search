import { test } from "node:test";
import assert from "node:assert";
import { impl, permit, custom } from "./feat031-impl.mjs";

const A = permit("100234", "1 N State St");
const B = permit("100987", "2 S Clark St");
const C = permit("100555", "3 W Adams St");
const ROWS = [A, B, C];

function fresh(list = {}) {
  impl.setList({ permits: ["100234", "100987", "100555"], ticks: {}, fu: {}, called: {}, ...list });
  impl.setFilters({ followUp: false, visited: null, called: null });
  impl.setActor("");
  return impl;
}

// ---- The flags themselves ----

test("the three flags are read from three separate maps", () => {
  fresh({ ticks: { 100234: 1 }, called: { 100987: 1 }, fu: { 100555: 1 } });
  assert.equal(impl.isTicked(A), true);
  assert.equal(impl.isCalled(A), false);
  assert.equal(impl.isCalled(B), true);
  assert.equal(impl.isTicked(B), false);
  assert.equal(impl.isFollowedUp(C), true);
  assert.equal(impl.isTicked(C), false);
});

test("a custom stop is flagged by its custom_id, not an empty permit number", () => {
  const stop = custom("c_1");
  fresh({ called: { c_1: 1 } });
  assert.equal(impl.tickKeyFor(stop), "c_1");
  assert.equal(impl.isCalled(stop), true);
});

test("setFlag writes the actor's name, and clearing removes the key entirely", () => {
  const l = { permits: ["100234"], ticks: {}, fu: {}, called: {} };
  fresh();
  impl.setList(l);
  impl.setActor("Divyam");
  impl.setFlag("called", "100234", true);
  assert.equal(l.called["100234"], "Divyam");
  impl.setFlag("called", "100234", false);
  assert.deepEqual(l.called, {}, "a cleared flag must not linger as a falsy value");
});

test("with no author set the flag stores 1, and still reads as set", () => {
  const l = { permits: ["100234"], ticks: {}, fu: {}, called: {} };
  fresh();
  impl.setList(l);
  impl.setFlag("called", "100234", true);
  assert.equal(l.called["100234"], 1);
  assert.equal(impl.isCalled(A), true);
  assert.equal(impl.flagActor("called", A), "", "1 means set, with nobody to name");
});

// The backward-compatibility rule the whole design rests on.
test("a legacy 1 and a name are both truthy, so old lists filter identically", () => {
  fresh({ called: { 100234: 1, 100987: "Divyam" } });
  assert.equal(impl.isCalled(A), true);
  assert.equal(impl.isCalled(B), true);
  assert.equal(impl.flagActor("called", A), "");
  assert.equal(impl.flagActor("called", B), "Divyam");
  assert.equal(impl.flagByText("called", B), " by Divyam");
  assert.equal(impl.flagByText("called", A), "", "a legacy flag must not render a blank 'by'");
});

// A list saved before FEAT-031 has no `called` key at all.
test("setFlag on a list with no map yet does not throw", () => {
  const l = { permits: ["100234"] };
  fresh();
  impl.setList(l);
  impl.setFlag("called", "100234", true);
  assert.equal(l.called["100234"], 1);
});

// ---- The filters ----
//
// FEAT-047 renamed this vocabulary from "yes"/"no" to "include"/"exclude" and
// left this suite speaking the old one. That is not a harmless rename: the
// product reads `f.visited === "include"`, so a stale "yes" filtered for NOT
// visited — the tests were asserting the exact inverse of the shipped
// behaviour and had been red since 0be750d. The filters are in-memory only
// (listFilterDefaults() on every list switch), so no saved "yes" can reach
// this code and the product needed no migration.

test("no filter shows every row", () => {
  fresh({ ticks: { 100234: 1 } });
  assert.equal(impl.isListFiltered(), false);
  assert.deepEqual(impl.visibleListRows(ROWS), ROWS);
});

test("visited yes/no are complements over the same rows", () => {
  fresh({ ticks: { 100234: 1 } });
  impl.setFilters({ followUp: false, visited: "include", called: null });
  assert.deepEqual(impl.visibleListRows(ROWS), [A]);
  impl.setFilters({ followUp: false, visited: "exclude", called: null });
  assert.deepEqual(impl.visibleListRows(ROWS), [B, C]);
});

test("called yes/no are complements over the same rows", () => {
  fresh({ called: { 100987: "Divyam" } });
  impl.setFilters({ followUp: false, visited: null, called: "include" });
  assert.deepEqual(impl.visibleListRows(ROWS), [B]);
  impl.setFilters({ followUp: false, visited: null, called: "exclude" });
  assert.deepEqual(impl.visibleListRows(ROWS), [A, C]);
});

// The combination this feature exists for.
test("visited AND not called is the 'been there, nobody has phoned' view", () => {
  fresh({ ticks: { 100234: 1, 100987: 1 }, called: { 100987: 1 } });
  impl.setFilters({ followUp: false, visited: "include", called: "exclude" });
  assert.deepEqual(impl.visibleListRows(ROWS), [A]);
});

// FEAT-034's chip must keep working on its own — the composed filter must not
// quietly drop the facet it inherited.
test("the follow-up facet still filters by itself", () => {
  fresh({ fu: { 100555: 1 } });
  impl.setFilters({ followUp: true, visited: null, called: null });
  assert.deepEqual(impl.visibleListRows(ROWS), [C]);
});

// FEAT-046 added a fourth clause to visibleListRows and no test here covered
// it: deleting `matchesTriState(permitStage(row), f.stages)` from the product
// left this whole suite green. Found by mutation while repairing the suite
// (FIX-050, folded back into FIX-044) — a repaired test that still misses a
// clause is a repaired test that proves less than it looks like it does.
test("the stage facet narrows and subtracts, and both apply together", () => {
  // permitStage maps status + milestone; these are the shipped mappings.
  const P = (n, permit_status, permit_milestone) => ({ permit_number: n, address: "", permit_status, permit_milestone });
  const prog = P("100234", "ACTIVE", "INSPECTIONS");            // -> "progress"
  const fee = P("100987", "ACTIVE", "PERMIT ISSUED (FEE DUE)"); // -> "fee"
  const done = P("100555", "COMPLETE", "");                     // -> "complete"
  const rows = [prog, fee, done];
  fresh();
  assert.deepEqual([prog, fee, done].map(impl.permitStage), ["progress", "fee", "complete"]);

  impl.setFilters({ followUp: false, visited: null, called: null, stages: { include: ["progress"], exclude: [] } });
  assert.deepEqual(impl.visibleListRows(rows), [prog], "an include is a whitelist");

  impl.setFilters({ followUp: false, visited: null, called: null, stages: { include: [], exclude: ["complete"] } });
  assert.deepEqual(impl.visibleListRows(rows), [prog, fee], "an exclude subtracts");

  // Rule B: includes narrow, excludes remove, and BOTH always apply — an
  // include must not silence a visibly-set exclude.
  impl.setFilters({ followUp: false, visited: null, called: null, stages: { include: ["progress", "fee"], exclude: ["fee"] } });
  assert.deepEqual(impl.visibleListRows(rows), [prog], "an include does not silence an exclude");

  impl.setFilters({ followUp: false, visited: null, called: null, stages: { include: [], exclude: [] } });
  assert.deepEqual(impl.visibleListRows(rows), rows, "an empty tri-state filters nothing");
});

test("all three facets compose", () => {
  fresh({ ticks: { 100234: 1, 100987: 1 }, called: { 100234: 1 }, fu: { 100234: 1, 100555: 1 } });
  impl.setFilters({ followUp: true, visited: "include", called: "include" });
  assert.deepEqual(impl.visibleListRows(ROWS), [A]);
});

test("a filter that matches nothing returns empty rather than falling back to all", () => {
  fresh({ called: {} });
  impl.setFilters({ followUp: false, visited: null, called: "include" });
  assert.deepEqual(impl.visibleListRows(ROWS), []);
});

test("isListFiltered is true for any facet, false only when all are off", () => {
  fresh();
  assert.equal(impl.isListFiltered(), false);
  for (const f of [{ followUp: true }, { visited: "include" }, { visited: "exclude" }, { called: "include" }, { called: "exclude" }]) {
    impl.setFilters({ followUp: false, visited: null, called: null, ...f });
    assert.equal(impl.isListFiltered(), true, JSON.stringify(f));
  }
});

// Within a facet the chips are mutually exclusive; pressing the active one clears it.
// FEAT-047 also changed the SIGNATURE: setRowFilter(facet, value) became a
// one-argument cycle, off -> include -> exclude -> off, matching the map's
// dropdown. The old two-argument calls silently passed an ignored second
// argument, so these two were testing an API that no longer exists.
test("setRowFilter cycles its own facet and never leaves a contradiction", () => {
  fresh();
  impl.setRowFilter("visited");
  assert.equal(impl.state.listFilters.visited, "include");
  impl.setRowFilter("visited");
  assert.equal(impl.state.listFilters.visited, "exclude", "the opposite state replaces, never stacks");
  impl.setRowFilter("visited");
  assert.equal(impl.state.listFilters.visited, null, "a third press turns the facet off");
});

test("setRowFilter leaves the other facet alone", () => {
  fresh();
  impl.setRowFilter("visited");
  impl.setRowFilter("called");
  impl.setRowFilter("called");
  assert.equal(impl.state.listFilters.visited, "include", "cycling called must not disturb visited");
  assert.equal(impl.state.listFilters.called, "exclude");
});

// ---- The empty state names the filters that emptied it ----

test("the empty-view sentence names every active filter, not just follow-up", () => {
  fresh();
  impl.setFilters({ followUp: false, visited: "exclude", called: "include" });
  assert.equal(impl.noRowsMatchText(), "No permits in this list are not visited and called.");
  impl.setFilters({ followUp: true, visited: null, called: null });
  assert.equal(impl.noRowsMatchText(), "No permits in this list are flagged for follow-up.");
  impl.setFilters({ followUp: false, visited: "include", called: null });
  assert.equal(impl.noRowsMatchText(), "No permits in this list are visited.");
});
