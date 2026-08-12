import { test } from "node:test";
import assert from "node:assert";
import { threadPostHtml } from "./p3-thread-impl.mjs";

test("a text post shows author, text and escapes both", () => {
  const html = threadPostHtml({ id: "n_1", kind: "text", author: "<b>Div</b>", text: "<script>x", ts: 1753088040, editedTs: null });
  assert.match(html, /&lt;b&gt;Div/);
  assert.match(html, /&lt;script&gt;x/);
  assert.ok(!/<script>x/.test(html), "must not emit raw markup");
});
test("an edited post is marked edited", () => {
  assert.match(threadPostHtml({ id: "n_1", kind: "text", author: "A", text: "hi", ts: 1, editedTs: 2 }), /edited/i);
});
test("a walk post renders its structured fields", () => {
  const html = threadPostHtml({ id: "n_2", kind: "walk", author: "A", ts: 1, job: "new", onsite: "sub",
    party: { name: "SUB CO", phone: "7735550142", covers: "Electrical", jobs: 3, estimate: "1-3d" },
    gc: { name: "GC CO", phone: "3125550198" } });
  assert.match(html, /New build/);
  assert.match(html, /SUB CO/);
  assert.match(html, /GC CO/);
  assert.match(html, /tel:7735550142/);
});
test("a photo post renders without crashing", () => {
  const html = threadPostHtml({ id: "n_3", kind: "photo", author: "A", ts: 1, text: "site pic", photos: [] });
  assert.match(html, /site pic/);
  assert.ok(html.length > 0);
});
test("edit and delete controls carry the post id", () => {
  assert.match(threadPostHtml({ id: "n_abc", kind: "text", author: "A", text: "x", ts: 1, editedTs: null }), /n_abc/);
});
