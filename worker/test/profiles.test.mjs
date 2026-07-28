import { test } from "node:test";
import assert from "node:assert";
import { handleContactDetail, normalizeContractorName } from "../src/profiles.js";

test("normalizeContractorName strips punctuation, case and whitespace", () => {
  assert.equal(normalizeContractorName("  A-1  Roofing, Inc. "), "A1 ROOFING");
  assert.equal(normalizeContractorName("ACME BUILDERS LLC"), "ACME BUILDERS");
  assert.equal(normalizeContractorName("Acme   Builders"), "ACME BUILDERS");
});

test("normalizeContractorName drops only ONE trailing suffix", () => {
  // "CO LLC" -> "CO": the regex is anchored and runs once, by design.
  assert.equal(normalizeContractorName("SMITH CO LLC"), "SMITH CO");
});

test("normalizeContractorName returns empty for unusable input", () => {
  assert.equal(normalizeContractorName("///"), "");
  assert.equal(normalizeContractorName(null), "");
  assert.equal(normalizeContractorName(undefined), "");
});

const GC = [
  { contact_name: "ACME BUILDERS LLC", open_jobs: 4 },
  { contact_name: "NORTHSIDE RENOVATION", open_jobs: 2 },
];
const TECH = [
  { contact_name: "RIVERA PLUMBING", open_jobs: 7 },
  { contact_name: "A-1 ROOFING, INC.", open_jobs: 1 },
];

function fakeEnv(overrides = {}) {
  const store = {
    "profiles:general_contractor": GC,
    "profiles:open_tech": TECH,
    ...overrides,
  };
  return {
    CACHE: {
      async get(key, type) {
        if (!(key in store)) return null;
        const v = store[key];
        return type === "text" && typeof v !== "string" ? JSON.stringify(v) : v;
      },
    },
  };
}

const call = (name, env, category = "general_contractor") =>
  handleContactDetail(
    new URL(`https://w.dev/api/contact/${encodeURIComponent(name)}?category=${category}`),
    env
  );

test("rung 1: exact match in the requested category", async () => {
  const body = await (await call("ACME BUILDERS LLC", fakeEnv())).json();
  assert.equal(body.contact_name, "ACME BUILDERS LLC");
  assert.equal(body.matched_as, "ACME BUILDERS LLC");
  assert.equal(body.matched_category, "general_contractor");
});

test("rung 1 is case-insensitive", async () => {
  const body = await (await call("acme builders llc", fakeEnv())).json();
  assert.equal(body.matched_as, "ACME BUILDERS LLC");
  assert.equal(body.matched_category, "general_contractor");
});

test("rung 2: exact match in the OTHER category", async () => {
  const res = await call("RIVERA PLUMBING", fakeEnv());
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.matched_as, "RIVERA PLUMBING");
  assert.equal(body.matched_category, "open_tech", "must report where it was actually found");
  assert.equal(body.open_jobs, 7);
});

test("rung 3: normalized match when no exact match exists anywhere", async () => {
  const body = await (await call("Acme Builders", fakeEnv())).json();
  assert.equal(body.matched_as, "ACME BUILDERS LLC");
  assert.equal(body.matched_category, "general_contractor");
});

test("rung 3 crosses categories and reports the category it landed in", async () => {
  const body = await (await call("A1 Roofing", fakeEnv())).json();
  assert.equal(body.matched_as, "A-1 ROOFING, INC.");
  assert.equal(body.matched_category, "open_tech");
});

test("an exact hit beats a normalized hit in the requested category", async () => {
  // "NORTHSIDE RENOVATION" is exact in GC; a normalized scan would find it too,
  // but matched_as must be the exact row, not a near neighbour.
  const body = await (await call("NORTHSIDE RENOVATION", fakeEnv())).json();
  assert.equal(body.matched_as, "NORTHSIDE RENOVATION");
});

test("the requested category wins when both categories match exactly", async () => {
  const env = fakeEnv({
    "profiles:open_tech": [{ contact_name: "ACME BUILDERS LLC", open_jobs: 99 }],
  });
  const gcFirst = await (await call("ACME BUILDERS LLC", env, "general_contractor")).json();
  assert.equal(gcFirst.matched_category, "general_contractor");
  assert.equal(gcFirst.open_jobs, 4);
  const techFirst = await (await call("ACME BUILDERS LLC", env, "open_tech")).json();
  assert.equal(techFirst.matched_category, "open_tech");
  assert.equal(techFirst.open_jobs, 99);
});

test("a total miss is a 404", async () => {
  const res = await call("NO SUCH CONTRACTOR", fakeEnv());
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Contact not found", name: "NO SUCH CONTRACTOR" });
});

test("a punctuation-only name does not match every row via the empty normal form", async () => {
  const res = await call("///", fakeEnv());
  assert.equal(res.status, 404, "empty normal form must not be treated as a wildcard");
});

test("seeded_at is returned for the category the profile was found in", async () => {
  const env = fakeEnv({
    "profiles:general_contractor:seeded_at": "2026-07-28T12:00:00.000Z",
    "profiles:open_tech:seeded_at": "2026-01-01T00:00:00.000Z",
  });
  const body = await (await call("RIVERA PLUMBING", env)).json();
  assert.equal(body.matched_category, "open_tech");
  assert.equal(body.seeded_at, "2026-01-01T00:00:00.000Z", "must follow the matched category");
});

test("seeded_at is omitted, not guessed, when the key is absent", async () => {
  const body = await (await call("ACME BUILDERS LLC", fakeEnv())).json();
  assert.ok(!("seeded_at" in body), "absent key must omit the field entirely");
});

test("a missing name is a 400", async () => {
  const res = await handleContactDetail(new URL("https://w.dev/api/contact/"), fakeEnv());
  assert.equal(res.status, 400);
});

test("an unknown category is a 400, not a silent fallback", async () => {
  const res = await call("ACME BUILDERS LLC", fakeEnv(), "not_a_category");
  assert.equal(res.status, 400);
});

test("an unseeded cache is a 503", async () => {
  const env = { CACHE: { async get() { return null; } } };
  const res = await call("ACME BUILDERS LLC", env);
  assert.equal(res.status, 503);
});

test("one seeded category still serves, even if the other is missing", async () => {
  const env = {
    CACHE: {
      async get(key) { return key === "profiles:open_tech" ? TECH : null; },
    },
  };
  const res = await call("RIVERA PLUMBING", env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).matched_category, "open_tech");
});
