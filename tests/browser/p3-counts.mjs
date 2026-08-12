import { test } from "node:test";
import assert from "node:assert";
import { chipLabel } from "./p3-counts-impl.mjs";
test("a public count wins over the private-only chip", () => assert.equal(chipLabel({ hasPrivate: true, publicCount: 3 }), "3"));
test("public zero but private present shows the private mark", () => assert.equal(chipLabel({ hasPrivate: true, publicCount: 0 }), "✎"));
test("nothing shows a zero", () => assert.equal(chipLabel({ hasPrivate: false, publicCount: 0 }), "0"));
