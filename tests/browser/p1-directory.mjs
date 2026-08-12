import { test } from "node:test";
import assert from "node:assert";
import { tagChipHtml, directorySections } from "./p1-directory-impl.mjs";

test("tagChipHtml uses the slot custom property, never a raw hex", () => {
  const html = tagChipHtml("roofing", 0);
  assert.match(html, /--tc:var\(--t0\)/);
  assert.ok(!/#b3261e/.test(html), "must not inline a theme-specific hex");
  assert.match(html, />roofing</);
});

test("tagChipHtml escapes tag names", () => {
  assert.match(tagChipHtml('<img src=x onerror=1>', 3), /&lt;img/);
});

test("tagChipHtml clamps an out-of-range slot", () => {
  assert.match(tagChipHtml("x", 99), /--tc:var\(--t9\)/);
  assert.match(tagChipHtml("x", -3), /--tc:var\(--t0\)/);
  assert.match(tagChipHtml("x", "nope"), /--tc:var\(--t0\)/);
});

test("directorySections lists mine, and published carries every remote row incl. mine", () => {
  const local = { a: { name: "A", permits: [], sharedId: "YnF7y4t" }, b: { name: "B", permits: [] } };
  const remote = [{ id: "YnF7y4t", title: "A" }, { id: "zzz", title: "Other" }];
  const out = directorySections(local, remote);
  assert.deepEqual(out.mine.map(l => l.name), ["A", "B"]);
  // My own published list (YnF7y4t) now shows under Published too, not filtered out.
  assert.deepEqual(out.published.map(l => l.id), ["YnF7y4t", "zzz"]);
});

test("directorySections marks unpublished local lists as drafts", () => {
  const out = directorySections({ b: { name: "B", permits: [] } }, []);
  assert.equal(out.mine[0].draft, true);
  assert.equal(out.mine[0].count, 0);
});

test("directorySections shows my published list in BOTH sections", () => {
  const local = { a: { name: "Mine", permits: ["1"], sharedId: "abc" } };
  const out = directorySections(local, [{ id: "abc", title: "Mine" }]);
  assert.equal(out.mine.length, 1);
  assert.equal(out.published.length, 1);
  assert.equal(out.published[0].id, "abc");
});
