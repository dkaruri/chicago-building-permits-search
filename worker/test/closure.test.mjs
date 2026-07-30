import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysBetween, openAgeStats, departedPermits,
  closureAdditions, mergeClosureStats, attachClosureStats,
} from "../src/closure.js";

test("daysBetween ignores time-of-day and rejects junk", () => {
  assert.equal(daysBetween("2026-01-01", "2026-01-31"), 30);
  assert.equal(daysBetween("2024-01-02T00:00:00.000", "2024-03-01"), 59); // leap year
  assert.equal(daysBetween("not a date", "2026-01-01"), null);
});

test("open age reports avg, median and max, and drops impossible ages", () => {
  const s = openAgeStats(["2026-07-20", "2026-07-10", "2026-06-30"], "2026-07-30");
  assert.deepEqual(s, { n: 3, avg: 20, median: 20, max: 30 });
  // A future issue date is bad data, not a brand-new job.
  const f = openAgeStats(["2026-07-20", "2027-01-01", "bogus"], "2026-07-30");
  assert.equal(f.n, 1);
  assert.equal(openAgeStats([], "2026-07-30"), null);
  assert.equal(openAgeStats(["2027-01-01"], "2026-07-30"), null, "no valid ages -> null, not 0");
});

test("median is the mean of the middle pair when the count is even", () => {
  assert.equal(openAgeStats(["2026-07-29", "2026-07-28", "2026-07-20", "2026-07-10"], "2026-07-30").median, 6);
});

test("departed = was open last time, not open now", () => {
  const prev = { A: "2025-01-01", B: "2025-02-01", C: "2025-03-01" };
  assert.deepEqual(departedPermits(prev, ["B"]).sort(), ["A", "C"]);
  assert.deepEqual(departedPermits(prev, ["A", "B", "C"]), []);
  assert.deepEqual(departedPermits(null, ["A"]), []);
});

const ROWS = [
  { permit_: "A", permit_status: "COMPLETE", issue_date: "2026-01-01",
    contact_1_type: "CONTRACTOR-GENERAL CONTRACTOR", contact_1_name: "ACME BUILDERS",
    contact_2_type: "CONTRACTOR-ELECTRICAL", contact_2_name: "SPARKY LLC",
    contact_3_type: "OWNER", contact_3_name: "A PERSON" },
  // Left the open set but EXPIRED — stopped, not finished. Must not count.
  { permit_: "B", permit_status: "EXPIRED", issue_date: "2026-01-01",
    contact_1_type: "CONTRACTOR-GENERAL CONTRACTOR", contact_1_name: "ACME BUILDERS" },
  // Same contractor twice on one permit must not double their sample.
  { permit_: "C", permit_status: "COMPLETE", issue_date: "2026-03-01",
    contact_1_type: "CONTRACTOR-GENERAL CONTRACTOR", contact_1_name: "ACME BUILDERS",
    contact_2_type: "CONTRACTOR-GENERAL CONTRACTOR", contact_2_name: "ACME BUILDERS" },
];

test("only COMPLETE permits are booked, and owners are not contractors", () => {
  const prev = { A: "2026-01-01", B: "2026-01-01", C: "2026-03-01" };
  const add = closureAdditions(ROWS, prev, "2026-07-30");
  assert.equal(add.general_contractor["ACME BUILDERS"].n, 2, "A and C, never the EXPIRED B");
  assert.equal(add.general_contractor["ACME BUILDERS"].days, 210 + 151);
  assert.equal(add.open_tech["SPARKY LLC"].n, 1);
  assert.ok(!add.general_contractor["A PERSON"], "the OWNER contact is not a contractor");
  assert.ok(!add.open_tech["A PERSON"]);
});

test("issue date comes from the snapshot, so a restated row cannot rewrite history", () => {
  // Socrata later reports a different issue_date; the date we recorded when the
  // permit was open is the one that counts.
  const rows = [{ ...ROWS[0], issue_date: "2026-06-01" }];
  const add = closureAdditions(rows, { A: "2026-01-01" }, "2026-07-30");
  assert.equal(add.general_contractor["ACME BUILDERS"].days, 210);
});

test("merge accumulates across runs without mutating the previous totals", () => {
  const prev = { general_contractor: { "ACME BUILDERS": { n: 2, days: 100 } }, open_tech: {} };
  const merged = mergeClosureStats(prev, { general_contractor: { "ACME BUILDERS": { n: 1, days: 50 }, "NEW CO": { n: 1, days: 7 } }, open_tech: {} });
  assert.deepEqual(merged.general_contractor["ACME BUILDERS"], { n: 3, days: 150 });
  assert.deepEqual(merged.general_contractor["NEW CO"], { n: 1, days: 7 });
  assert.equal(prev.general_contractor["ACME BUILDERS"].n, 2, "previous object untouched");
});

test("profiles with no observations get no keys at all, never a zero", () => {
  const profiles = [{ contact_name: "ACME BUILDERS" }, { contact_name: "UNSEEN LLC" }];
  const stats = { general_contractor: { "ACME BUILDERS": { n: 4, days: 402 } }, open_tech: {} };
  assert.equal(attachClosureStats(profiles, stats, "general_contractor"), 1);
  assert.equal(profiles[0].close_days_avg, 101);
  assert.equal(profiles[0].close_sample, 4);
  assert.ok(!("close_days_avg" in profiles[1]));
  assert.ok(!("close_sample" in profiles[1]));
});

test("a zero-sample entry is treated as no data", () => {
  const profiles = [{ contact_name: "ACME BUILDERS" }];
  attachClosureStats(profiles, { general_contractor: { "ACME BUILDERS": { n: 0, days: 0 } } }, "general_contractor");
  assert.ok(!("close_days_avg" in profiles[0]));
});
