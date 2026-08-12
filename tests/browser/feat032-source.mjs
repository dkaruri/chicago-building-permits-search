// FEAT-032 — feed the search conditions/filters into the list description.
// Run: node --test verify-tmp/feat032-source.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { makeApp, blockDrift } from "./feat032-impl.mjs";

test("the provenance block is identical on all three pages", () => {
  assert.deepEqual(blockDrift, [], `FEAT-032 block drifted on: ${blockDrift.join(", ")}`);
});

// ---- what the summary says ----

test("a bare Open Permits search names the mode and nothing else", () => {
  const app = makeApp({ mode: "open_permits", controls: {} });
  assert.equal(app.addSourceSummary(), "from Search: Open Permits");
});

test("every Search control that is set shows up in the summary", () => {
  const app = makeApp({
    mode: "open_permits",
    controls: {
      q: { value: "roof" },
      ward: { value: "47" },
      "cost-min": { value: "50000" },
      "cost-max": { value: "250000" },
      "usable-processing": { checked: true },
    },
  });
  assert.equal(
    app.addSourceSummary(),
    'from Search: Open Permits · "roof" · Ward 47 · $50k–$250k · usable processing times only'
  );
});

test("a half-open cost range reads as a bound, not a range", () => {
  const min = makeApp({ controls: { "cost-min": { value: "50000" } } });
  assert.equal(min.addSourceSummary(), "from Search: Open Permits · $50k+");
  const max = makeApp({ controls: { "cost-max": { value: "250000" } } });
  assert.equal(max.addSourceSummary(), "from Search: Open Permits · up to $250k");
});

test("an empty or zero cost box is not a filter", () => {
  const app = makeApp({ controls: { "cost-min": { value: "0" }, "cost-max": { value: "" } } });
  assert.equal(app.addSourceSummary(), "from Search: Open Permits");
});

test("the map summary carries the whole drawer", () => {
  const app = makeApp({
    mode: "map",
    mapSettings: {
      q: "brick",
      neighborhood: "Logan Square",
      dateFrom: "2026-07-01",
      dateTo: "2026-08-05",
      costMin: "50000",
      costMax: "250000",
      gcMin: "2",
      gcMax: "10",
      radiusMiles: "3",
      propertyUse: "residential",
      excludedWorkTypes: ["RENOVATION", "SIGN"],
    },
    propertyUseOptions: [{ value: "residential", label: "Residential" }],
  });
  assert.equal(
    app.addSourceSummary(),
    'from Permit Map: "brick" · Logan Square · Jul 1–Aug 5, 2026 · $50k–$250k · 2–10 open GC jobs · within 3 mi · Residential · 2 work types excluded'
  );
});

test("a map with nothing set says so rather than trailing off", () => {
  const app = makeApp({ mode: "map", mapSettings: {} });
  assert.equal(app.addSourceSummary(), "from Permit Map: no filters");
});

test("a date range spanning a year boundary names both years", () => {
  const app = makeApp({ mode: "map", mapSettings: { dateFrom: "2025-12-28", dateTo: "2026-01-04" } });
  assert.equal(app.addSourceSummary(), "from Permit Map: Dec 28, 2025–Jan 4, 2026");
});

test("a bare YYYY-MM-DD is read as a local day, not shifted back by UTC", () => {
  // The bug this guards: new Date("2026-07-01") is midnight UTC, which is
  // Jun 30 in Chicago — the range would name a day the user never picked.
  const app = makeApp({ mode: "map", mapSettings: {} });
  assert.deepEqual(app.sourceDay("2026-07-01"), { y: "2026", m: "Jul", d: "1" });
  assert.equal(app.sourceDay("not-a-date"), null);
});

// ---- what gets written to the description ----

const MAP_TAIL = "from Permit Map: no filters";

test("the first add starts the description", () => {
  const app = makeApp();
  const list = {};
  app.noteListSource(list, 12, MAP_TAIL);
  assert.equal(list.desc, `• Aug 5 — 12 ${MAP_TAIL}`);
});

test("a hand-written description is kept, and the line is appended below it", () => {
  const app = makeApp();
  const list = { desc: "Jobs to quote this month." };
  app.noteListSource(list, 3, MAP_TAIL);
  assert.equal(list.desc, `Jobs to quote this month.\n• Aug 5 — 3 ${MAP_TAIL}`);
});

test("a repeat add from the same search bumps the count instead of stacking", () => {
  const app = makeApp();
  const list = {};
  app.noteListSource(list, 12, MAP_TAIL);
  app.noteListSource(list, 5, MAP_TAIL);
  assert.equal(list.desc, `• Aug 5 — 17 ${MAP_TAIL}`);
  assert.equal(list.desc.split("\n").length, 1);
});

test("a different search appends a second line rather than overwriting", () => {
  const app = makeApp();
  const list = {};
  app.noteListSource(list, 12, MAP_TAIL);
  app.noteListSource(list, 4, "from Search: Open Permits · Ward 47");
  assert.deepEqual(list.desc.split("\n"), [
    `• Aug 5 — 12 ${MAP_TAIL}`,
    "• Aug 5 — 4 from Search: Open Permits · Ward 47",
  ]);
});

test("the same search on a later day gets its own line", () => {
  const first = makeApp({ today: "2026-08-05" });
  const list = {};
  first.noteListSource(list, 2, MAP_TAIL);
  const later = makeApp({ today: "2026-08-06" });
  later.noteListSource(list, 2, MAP_TAIL);
  assert.deepEqual(list.desc.split("\n"), [
    `• Aug 5 — 2 ${MAP_TAIL}`,
    `• Aug 6 — 2 ${MAP_TAIL}`,
  ]);
});

test("only the LAST line can be bumped, so hand-written text below is never rewritten", () => {
  const app = makeApp();
  const list = {};
  app.noteListSource(list, 2, MAP_TAIL);
  list.desc += "\nCall these before Friday.";
  app.noteListSource(list, 2, MAP_TAIL);
  assert.deepEqual(list.desc.split("\n"), [
    `• Aug 5 — 2 ${MAP_TAIL}`,
    "Call these before Friday.",
    `• Aug 5 — 2 ${MAP_TAIL}`,
  ]);
});

test("an add of nothing new writes nothing", () => {
  const app = makeApp();
  const list = { desc: "untouched" };
  app.noteListSource(list, 0, MAP_TAIL);
  assert.equal(list.desc, "untouched");
  assert.equal(list.descPending, undefined);
});

test("a manual add is recorded as having no filters behind it", () => {
  const app = makeApp();
  const list = {};
  app.noteListSource(list, 1, "added by hand: no filters");
  assert.equal(list.desc, "• Aug 5 — 1 added by hand: no filters");
});

test("every add flags the description as needing a push to the shared doc", () => {
  const app = makeApp();
  const list = {};
  app.noteListSource(list, 1, MAP_TAIL);
  assert.equal(list.descPending, true);
});

// ---- the 2000-character cap ----

test("past the cap the OLDEST provenance is dropped, not the user's own text", () => {
  const app = makeApp();
  const mine = "My own notes about this list.";
  const list = { desc: mine };
  // Each line is ~60 chars; 40 distinct searches overruns the 2000 cap.
  for (let i = 0; i < 40; i++) app.noteListSource(list, 1, `from Search: Open Permits · Ward ${i}`);
  assert.ok(list.desc.length <= app.LIST_DESC_LIMIT, `desc is ${list.desc.length} chars`);
  const lines = list.desc.split("\n");
  assert.equal(lines[0], mine, "the user's own first line survived");
  // The newest line is still there; an early one was evicted.
  assert.ok(list.desc.includes("Ward 39"), "the newest add is present");
  assert.ok(!list.desc.includes("Ward 0 "), "an early add was evicted");
  // Nothing was cut mid-line.
  assert.ok(lines.every(line => line === mine || app.LIST_SOURCE_RE.test(line)), "no half-written line");
});

test("a hand-written description longer than the cap is left alone, not chopped", () => {
  const app = makeApp();
  // Nothing to evict: the block must stop rather than slice into the user's text.
  const long = "x".repeat(2100);
  const list = { desc: long };
  app.noteListSource(list, 1, MAP_TAIL);
  assert.ok(list.desc.startsWith(long.slice(0, 100)));
  assert.equal(list.desc.length, app.LIST_DESC_LIMIT);
});
