import { test } from "node:test";
import assert from "node:assert";
import {
  buildFeedEntries, sortFeedEntries, filterFeedEntries,
  chunkPermits, feedCountLabel, walkSummary,
} from "./p6-feed-impl.mjs";

const rows = [
  { permit_number: "101082609", address: "3701 W AINSLIE ST" },
  { permit_number: "B200461632", address: "1200 N STATE PKWY" },
];

test("a private note and a public post both become entries", () => {
  const out = buildFeedEntries({
    rows,
    privateNotes: { "101082609": "Gate code 4432" },
    noteTs: { "101082609": 1000 },
    threads: { "101082609": [{ id: "n_1", kind: "text", text: "Roof crew on site", author: "Div", ts: 2000 }] },
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].text, "Roof crew on site");
  assert.equal(out[0].shared, true);
  assert.equal(out[1].text, "Gate code 4432");
  assert.equal(out[1].shared, false);
});

test("the feed is scoped to the list — a note on a permit not in the list is dropped", () => {
  const out = buildFeedEntries({
    rows,
    privateNotes: { "999NOTINLIST": "should not appear" },
    threads: { "999NOTINLIST": [{ id: "n_9", kind: "text", text: "nor this", ts: 5000 }] },
  });
  assert.deepEqual(out, []);
});

test("entries carry the permit and address they belong to", () => {
  const out = buildFeedEntries({ rows, privateNotes: { "B200461632": "Call owner" }, noteTs: { "B200461632": 10 } });
  assert.equal(out[0].permit, "B200461632");
  assert.equal(out[0].address, "1200 N STATE PKWY");
});

test("newest first", () => {
  const out = buildFeedEntries({
    rows,
    threads: {
      "101082609": [
        { id: "n_old", kind: "text", text: "older", ts: 100 },
        { id: "n_new", kind: "text", text: "newer", ts: 900 },
      ],
    },
  });
  assert.deepEqual(out.map(e => e.text), ["newer", "older"]);
});

test("an undated private note sorts last, not first", () => {
  // A note written before FEAT-034 has no timestamp. Treating "no time" as
  // "time zero" would be fine, but treating it as newest would put the OLDEST
  // notes at the top of a newest-first feed.
  const out = buildFeedEntries({
    rows,
    privateNotes: { "101082609": "legacy note, no timestamp" },
    noteTs: {},
    threads: { "B200461632": [{ id: "n_1", kind: "text", text: "recent", ts: 500 }] },
  });
  assert.deepEqual(out.map(e => e.text), ["recent", "legacy note, no timestamp"]);
  assert.equal(out[1].ts, null, "undated stays null rather than being given a time");
});

test("sort is stable for identical timestamps", () => {
  const a = [
    { id: "b", ts: 5 }, { id: "a", ts: 5 }, { id: "c", ts: 5 },
  ];
  assert.deepEqual(sortFeedEntries(a).map(e => e.id), ["a", "b", "c"]);
  assert.deepEqual(sortFeedEntries(sortFeedEntries(a)).map(e => e.id), ["a", "b", "c"]);
});

test("a walkthrough post reads as prose, not as a blank entry", () => {
  const out = buildFeedEntries({
    rows,
    threads: { "101082609": [{ id: "n_1", kind: "walk", ts: 1, job: "new", gc: { name: "BEAR CONSTRUCTION" }, sub: null }] },
  });
  assert.equal(out[0].kind, "walk");
  assert.match(out[0].text, /New construction/);
  assert.match(out[0].text, /BEAR CONSTRUCTION/);
});

test("walkSummary names both parties when both were on site", () => {
  const s = walkSummary({ job: "remodel", gc: { name: "GC CO" }, sub: { name: "SUB CO" } });
  assert.match(s, /GC CO/);
  assert.match(s, /SUB CO/);
});

test("walkSummary says nobody was on site rather than trailing off", () => {
  assert.match(walkSummary({ job: "remodel", gc: null, sub: null }), /nobody on site/);
});

test("a photo post is described by its count and caption", () => {
  const out = buildFeedEntries({
    rows,
    threads: {
      "101082609": [
        { id: "n_1", kind: "photo", ts: 2, photos: [{ id: "p_1" }, { id: "p_2" }], text: "back stairs" },
        { id: "n_2", kind: "photo", ts: 1, photos: [{ id: "p_3" }], text: "" },
      ],
    },
  });
  assert.equal(out[0].text, "2 photos — back stairs");
  assert.equal(out[1].text, "1 photo");
});

test("an empty note contributes nothing", () => {
  const out = buildFeedEntries({
    rows,
    privateNotes: { "101082609": "   " },
    threads: { "101082609": [{ id: "n_1", kind: "text", text: "", ts: 1 }] },
  });
  assert.deepEqual(out, []);
});

test("search matches note text, permit number and address", () => {
  const entries = buildFeedEntries({
    rows,
    privateNotes: { "101082609": "Gate code 4432", "B200461632": "Call owner" },
    noteTs: { "101082609": 2, "B200461632": 1 },
  });
  assert.equal(filterFeedEntries(entries, "gate").length, 1);
  assert.equal(filterFeedEntries(entries, "B2004").length, 1);
  assert.equal(filterFeedEntries(entries, "ainslie").length, 1);
  assert.equal(filterFeedEntries(entries, "").length, 2);
});

test("search is case-insensitive and every term must match", () => {
  const entries = buildFeedEntries({
    rows,
    privateNotes: { "101082609": "Gate code 4432" },
    noteTs: { "101082609": 1 },
  });
  assert.equal(filterFeedEntries(entries, "GATE CODE").length, 1);
  assert.equal(filterFeedEntries(entries, "gate ainslie").length, 1, "both terms are present");
  assert.equal(filterFeedEntries(entries, "gate nonsense").length, 0, "one term missing filters it out");
});

test("search matches the author name", () => {
  const entries = buildFeedEntries({
    rows,
    threads: { "101082609": [{ id: "n_1", kind: "text", text: "x", author: "Divyam", ts: 1 }] },
  });
  assert.equal(filterFeedEntries(entries, "divyam").length, 1);
});

test("chunkPermits splits, dedupes and drops blanks", () => {
  assert.deepEqual(chunkPermits(["a", "b", "c"], 2), [["a", "b"], ["c"]]);
  assert.deepEqual(chunkPermits(["a", "a", "b"], 10), [["a", "b"]]);
  assert.deepEqual(chunkPermits(["", null, "a"], 10), [["a"]]);
  assert.deepEqual(chunkPermits([], 10), []);
});

test("feedCountLabel distinguishes no notes from no matches", () => {
  assert.equal(feedCountLabel(0, 0, false), "No notes");
  assert.equal(feedCountLabel(1, 1, false), "1 note");
  assert.equal(feedCountLabel(3, 3, false), "3 notes");
  assert.equal(feedCountLabel(0, 5, true), "0 of 5 notes");
  assert.equal(feedCountLabel(2, 5, true), "2 of 5 notes");
});
