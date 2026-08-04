import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysBetween, openAgeStats, departedPermits,
  closureAdditions, mergeClosureStats, attachClosureStats, isKeyMissingError,
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

// The real 404 wrangler emits for an absent key, captured from a live run.
// The key name here MUST be the one the seed actually reads. It used to say
// "..._a_key", and that trailing "_a_key" gave the /key .*not found/i fallback
// a "key " to match -- so this test passed for six weeks while the 404 branch
// it exists to cover was dead (FIX-030). A fixture is a claim about production.
const REAL_404 = `[31m✘ [ERROR] Failed to fetch https://api.cloudflare.com/client/v4/accounts/65d6.../storage/kv/namespaces/ef1c.../values/closure%3Astats - 404: Not Found[0m`;
// The real error when credentials are absent, captured from the first CI run.
const REAL_NO_TOKEN = `✘ [ERROR] In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable for wrangler to work. Please go to https://developers.cloudflare.com/fundamentals/api/get-started/create-token/ for instructions.`;

test("a missing key is a first run; anything else is not", () => {
  assert.equal(isKeyMissingError(REAL_404), true);
  // THE bug: without this returning false, the seed announces "no previous
  // snapshot", re-baselines, and discards every closure ever observed.
  assert.equal(isKeyMissingError(REAL_NO_TOKEN), false);
  assert.equal(isKeyMissingError("Authentication error [code: 10000]"), false);
  assert.equal(isKeyMissingError("getaddrinfo ENOTFOUND api.cloudflare.com"), false);
  assert.equal(isKeyMissingError("403: Forbidden"), false);
  assert.equal(isKeyMissingError(""), false);
  assert.equal(isKeyMissingError(null), false);
});

test("the 404 branch carries the real message on its own, not the /key / fallback", () => {
  // FIX-030. The two checks are independent and this pins that: strip anything
  // the fallback could latch onto and the 404 branch must still answer true.
  // Against the pre-fix source (real 0x08 bytes instead of the escapes) this
  // fails, which is the point -- the old fixture could not tell the difference.
  const noKeyWord = REAL_404.replace(/key/gi, "kv-entry");
  assert.equal(/key .*not found/i.test(noKeyWord), false, "fixture no longer isolates the 404 branch");
  assert.equal(isKeyMissingError(noKeyWord), true);

  // ...and the boundaries are real boundaries: 404 embedded in a longer number
  // is an account id or a byte count, not a status code.
  assert.equal(isKeyMissingError("Failed: 1404040 bytes not found"), false);
  assert.equal(isKeyMissingError("HTTP 404 - Not Found"), true);
});

test("a 403 mentioning 'not found' elsewhere is not treated as a missing key", () => {
  assert.equal(isKeyMissingError("403: Forbidden - account not found in this scope"), false);
});
