import { test } from "node:test";
import assert from "node:assert";
import { photoGalleryHtml } from "./p4-gallery-impl.mjs";
test("one img per ref with caption as alt", () => {
  const html = photoGalleryHtml({ photos: [{ id: "p_00000001", caption: "north roof" }, { id: "p_00000002", caption: "" }] }, "101082609");
  assert.equal((html.match(/<img/g)||[]).length, 2);
  assert.match(html, /alt="north roof"/);
  assert.match(html, /\/api\/photo\/101082609\/p_00000001/);
});
test("escapes a caption", () => {
  const html = photoGalleryHtml({ photos: [{ id: "p_00000001", caption: '"><img src=x onerror=1>' }] }, "1");
  assert.ok(!/onerror=1>/.test(html.replace(/&[a-z#0-9]+;/g,"")), "caption escaped");
});
test("empty list renders nothing, lazy otherwise", () => {
  assert.equal(photoGalleryHtml({ photos: [] }, "1"), "");
  assert.match(photoGalleryHtml({ photos: [{ id: "p_00000001", caption: "x" }] }, "1"), /loading="lazy"/);
});
