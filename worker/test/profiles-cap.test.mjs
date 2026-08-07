import { test } from "node:test";
import assert from "node:assert";
import { handleProfiles } from "../src/profiles.js";

// FEAT-044 — the 5,000 ceiling on /api/profiles was never protecting anything.
// `total` is computed from the cached rows BEFORE the slice, so every row was
// already in memory; the clamp only discarded some on the way out, silently.
// Measured live 2026-08-07: 793 of 5,793 general contractors and 2,432 of
// 7,432 open subs (32.7%) were unreachable, with nothing in the UI saying so.

const BIG = Array.from({ length: 7432 }, (_, i) => ({
  contact_name: `CONTRACTOR ${String(i).padStart(5, "0")}`,
  sample_contact_type: "CONTRACTOR-GENERAL CONTRACTOR",
  city: i % 2 ? "CHICAGO" : "EVANSTON",
  open_jobs: i,
}));

function fakeEnv(rows = BIG) {
  return {
    CACHE: {
      async get(key, type) {
        if (key !== "profiles:general_contractor") return null;
        return type === "text" ? JSON.stringify(rows) : rows;
      },
    },
  };
}

const call = async (qs, env = fakeEnv()) =>
  (await handleProfiles(new URL(`https://w.dev/api/profiles?category=general_contractor${qs}`), env)).json();

test("a limit above the old 5000 ceiling now returns every row", async () => {
  const body = await call("&limit=10000");
  assert.equal(body.total, 7432);
  assert.equal(body.rows.length, 7432, "the 5000 clamp is gone");
});

test("the row that used to be cut is reachable", async () => {
  const body = await call("&limit=10000");
  // Index 5000 sat one past the old ceiling and could not be fetched at all.
  assert.equal(body.rows[5000].contact_name, "CONTRACTOR 05000");
  assert.equal(body.rows.at(-1).contact_name, "CONTRACTOR 07431");
});

test("total still counts matches, not the page", async () => {
  const body = await call("&limit=10");
  assert.equal(body.total, 7432);
  assert.equal(body.rows.length, 10);
});

test("the default stays small for callers that pass no limit", async () => {
  const body = await call("");
  assert.equal(body.rows.length, 50);
  assert.equal(body.limit, 50);
});

test("a junk or non-positive limit falls back to the default", async () => {
  for (const given of ["abc", "0", "-5", ""]) {
    const body = await call(`&limit=${encodeURIComponent(given)}`);
    assert.equal(body.rows.length, 50, `limit=${given}`);
  }
});

test("filtering still narrows total, and paging works past 5000", async () => {
  const body = await call("&q=chicago&limit=10000");
  assert.equal(body.total, 3716, "half the fixture is in CHICAGO");
  assert.equal(body.rows.length, 3716);
});

test("offset still pages", async () => {
  const body = await call("&limit=100&offset=7400");
  assert.equal(body.rows.length, 32, "the tail is shorter than a full page");
  assert.equal(body.rows[0].contact_name, "CONTRACTOR 07400");
});
