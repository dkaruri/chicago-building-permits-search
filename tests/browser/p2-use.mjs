import { test } from "node:test";
import assert from "node:assert";
import { permitUse } from "./p2-use-impl.mjs";

const u = (permit_type, work_description) => permitUse({ permit_type, work_description }).key;

test("reads residential from a unit count", () => {
  assert.equal(u("PERMIT - RENOVATION/ALTERATION", "INTERIOR RENOVATION TO A TWO STORY MASONRY 4 FLAT"), "residential");
  assert.equal(u("", "6 UNITS RESIDENTIAL"), "residential");
});

test("reads residential from dwelling words", () => {
  assert.equal(u("", "SINGLE FAMILY HOME REAR ADDITION"), "residential");
  assert.equal(u("", "TWO-FLAT PORCH REPLACEMENT"), "residential");
  assert.equal(u("", "CONDOMINIUM UNIT 3B KITCHEN"), "residential");
});

test("reads commercial", () => {
  assert.equal(u("", "INTERIOR BUILD OUT FOR RESTAURANT TENANT"), "commercial");
  assert.equal(u("", "COMMERCIAL OFFICE ALTERATION"), "commercial");
  assert.equal(u("", "NEW RETAIL STOREFRONT"), "commercial");
});

test("reads mixed use", () => {
  assert.equal(u("", "MIXED USE BUILDING - RETAIL BELOW 4 UNITS ABOVE"), "mixed");
});

test("says unclear rather than guessing", () => {
  assert.equal(u("", "REPAIR"), "unclear");
  assert.equal(u("", ""), "unclear");
  assert.equal(u("", null), "unclear");
  assert.equal(u(null, undefined), "unclear");
  assert.equal(permitUse(null).key, "unclear");
});

test("wrecking permits do not read as commercial", () => {
  assert.equal(u("PERMIT - WRECKING/DEMOLITION", "WRECKING OF 2 STORY FRAME BUILDING"), "unclear");
});

test("residential plus commercial words reads as mixed", () => {
  assert.equal(u("", "GROUND FLOOR RETAIL WITH 8 UNITS ABOVE"), "mixed");
});

test("every result carries a label and a glyph, so colour is never the only cue", () => {
  for (const desc of ["4 FLAT", "RESTAURANT", "MIXED USE", "REPAIR"]) {
    const r = permitUse({ permit_type: "", work_description: desc });
    assert.ok(r.label && r.glyph, desc);
  }
});
