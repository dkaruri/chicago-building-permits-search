import { test } from "node:test";
import assert from "node:assert";
import { mergeCustomStops, customToRow } from "./p2-custom-impl.mjs";

const P = n => ({ permit_number: n, address: "P" + n });

test("a custom stop lands at its requested position", () => {
  const out = mergeCustomStops([P("1"), P("2"), P("3")], [{ id: "c_1", pos: 2, addr: "Custom" }]);
  assert.deepEqual(out.map(r => r.address), ["P1", "Custom", "P2", "P3"]);
});

test("position 1 puts it first", () => {
  assert.equal(mergeCustomStops([P("1"), P("2")], [{ id: "c_1", pos: 1, addr: "Custom" }])[0].address, "Custom");
});

test("a position past the end appends", () => {
  const out = mergeCustomStops([P("1")], [{ id: "c_1", pos: 99, addr: "Custom" }]);
  assert.equal(out[out.length - 1].address, "Custom");
});

test("several custom stops keep their relative order", () => {
  const out = mergeCustomStops([P("1"), P("2")], [
    { id: "c_1", pos: 1, addr: "A" }, { id: "c_2", pos: 2, addr: "B" }]);
  assert.deepEqual(out.map(r => r.address), ["A", "B", "P1", "P2"]);
});

test("no custom stops leaves the list untouched", () => {
  assert.deepEqual(mergeCustomStops([P("1"), P("2")], []).map(r => r.address), ["P1", "P2"]);
  assert.deepEqual(mergeCustomStops([P("1")], null).map(r => r.address), ["P1"]);
});

test("customToRow marks the row and never invents a permit number", () => {
  const r = customToRow({ id: "c_1", addr: "3701 W Ainslie St", lat: 41.97, lon: -87.72, use: "residential", work: "Gut rehab" });
  assert.equal(r.permit_number, "");
  assert.equal(r.custom_id, "c_1");
  assert.equal(r.is_custom, true);
  assert.equal(r.latitude, 41.97);
  assert.equal(r.no_geo, false);
});

test("customToRow flags a stop with no coordinates as unroutable", () => {
  const r = customToRow({ id: "c_1", addr: "Coach house", lat: null, lon: null });
  assert.equal(r.no_geo, true);
  assert.equal(r.latitude, null);
});
