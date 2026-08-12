import { test } from "node:test";
import assert from "node:assert";
import { stackPush, stackGo } from "./p5-stack-impl.mjs";
import { normContractor, rowsForContractor } from "./p5-stack-impl.mjs";

const permit = n => ({ type: "permit", row: { permit_number: n } });
const contact = n => ({ type: "contact", name: n, role: "general_contractor" });

test("stackPush appends and advances the index", () => {
  const a = stackPush([], -1, permit("100"));
  assert.equal(a.stack.length, 1);
  assert.equal(a.index, 0);
  const b = stackPush(a.stack, a.index, contact("ACME"));
  assert.equal(b.stack.length, 2);
  assert.equal(b.index, 1);
});

test("stackPush truncates forward entries", () => {
  let s = stackPush([], -1, permit("100"));
  s = stackPush(s.stack, s.index, contact("ACME"));
  s = stackPush(s.stack, s.index, permit("200"));
  const back = stackGo(s.stack, s.index, -2);
  assert.equal(back.index, 0);
  const pushed = stackPush(back.stack, back.index, contact("OTHER"));
  assert.equal(pushed.stack.length, 2, "forward entries dropped");
  assert.equal(pushed.stack[1].name, "OTHER");
  assert.equal(pushed.index, 1);
});

test("stackPush does not mutate the input stack", () => {
  const original = [permit("100")];
  stackPush(original, 0, contact("ACME"));
  assert.equal(original.length, 1);
});

test("stackGo clamps at both ends", () => {
  const stack = [permit("100"), contact("ACME"), permit("200")];
  assert.equal(stackGo(stack, 2, -5).index, 0);
  assert.equal(stackGo(stack, 0, 5).index, 2);
  assert.equal(stackGo(stack, 1, -1).index, 0);
  assert.equal(stackGo(stack, 1, 1).index, 2);
});

test("stackGo never returns a different stack array", () => {
  const stack = [permit("100"), contact("ACME")];
  assert.strictEqual(stackGo(stack, 1, -1).stack, stack);
});

test("normContractor folds case, punctuation and corporate suffixes", () => {
  assert.equal(normContractor("ACME BUILDERS, INC."), normContractor("acme builders inc"));
  assert.equal(normContractor("Acme  Builders   LLC"), normContractor("ACME BUILDERS"));
  assert.equal(normContractor("A-1 Roofing Co."), normContractor("A1 ROOFING"));
});

test("normContractor keeps genuinely different names apart", () => {
  assert.notEqual(normContractor("ACME BUILDERS"), normContractor("ACME PLUMBING"));
});

test("rowsForContractor drops the substring over-fetch", () => {
  const rows = [
    { permit_number: "1", general_contractors: "ACME BUILDERS", open_subs: "" },
    { permit_number: "2", general_contractors: "ACME PLUMBING", open_subs: "" },
    { permit_number: "3", general_contractors: "", open_subs: "ACME BUILDERS" },
  ];
  const out = rowsForContractor(rows, "ACME BUILDERS", "general_contractor");
  assert.deepEqual(out.map(r => r.permit_number), ["1"],
    "row 2 is a different company; row 3 lists the name as a sub, not a GC");
});

test("rowsForContractor matches open subs on the open_tech role", () => {
  const rows = [{ permit_number: "3", general_contractors: "", open_subs: "ACME BUILDERS | OTHER CO" }];
  assert.equal(rowsForContractor(rows, "ACME BUILDERS", "open_tech").length, 1);
});

test("rowsForContractor tolerates missing fields", () => {
  assert.deepEqual(rowsForContractor([{ permit_number: "1" }], "ACME", "general_contractor"), []);
  assert.deepEqual(rowsForContractor(null, "ACME", "general_contractor"), []);
});
