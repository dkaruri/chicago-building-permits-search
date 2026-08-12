import { test } from "node:test";
import assert from "node:assert";
import { walkFieldsToPayload } from "./p3-walk-impl.mjs";
test("nobody on site yields no party or gc", () => {
  const out = walkFieldsToPayload({ job: "remodel", onsite: "none" });
  assert.equal(out.onsite, "none"); assert.equal(out.party, undefined);
});
test("a GC on site carries one contact block and no their-GC", () => {
  const out = walkFieldsToPayload({ job: "new", onsite: "gc", name: "GC CO", phone: "3125550198", covers: "General", jobs: "2", estimate: "week" });
  assert.equal(out.onsite, "gc"); assert.equal(out.party.name, "GC CO"); assert.equal(out.party.jobs, 2); assert.equal(out.gc, undefined);
});
test("a sub on site adds a their-GC block", () => {
  const out = walkFieldsToPayload({ job: "new", onsite: "sub", name: "SUB", jobs: "3", estimate: "1-3d", gcName: "THEIR GC", gcPhone: "3125550198" });
  assert.equal(out.party.name, "SUB"); assert.equal(out.gc.name, "THEIR GC");
});
test("jobs coerces to a number or null", () => {
  assert.equal(walkFieldsToPayload({ onsite: "gc", name: "X", jobs: "" }).party.jobs, null);
  assert.equal(walkFieldsToPayload({ onsite: "gc", name: "X", jobs: "4" }).party.jobs, 4);
});
test("a sub with no GC name omits the gc block", () => {
  assert.equal(walkFieldsToPayload({ onsite: "sub", name: "SUB", gcName: "  " }).gc, undefined);
});
