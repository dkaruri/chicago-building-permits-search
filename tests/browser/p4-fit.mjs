import { test } from "node:test";
import assert from "node:assert";
import { fitDimensions } from "./p4-fit-impl.mjs";
test("landscape scales by width", () => assert.deepEqual(fitDimensions(3200,2400,1600),{w:1600,h:1200}));
test("portrait scales by height", () => assert.deepEqual(fitDimensions(2400,3200,1600),{w:1200,h:1600}));
test("within bounds unchanged", () => assert.deepEqual(fitDimensions(1000,800,1600),{w:1000,h:800}));
test("rounds to whole pixels", () => { const d=fitDimensions(1601,1000,1600); assert.ok(Number.isInteger(d.w)&&Number.isInteger(d.h)); });
