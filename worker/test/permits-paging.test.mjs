import { test } from "node:test";
import assert from "node:assert";
import { handlePermits } from "../src/permits.js";

// FEAT-044 — the permits endpoint learns to count and to order, so the client
// can page the whole result set instead of a 1000-row prefix of it.
//
// The two things that would break the pager silently:
//   1. the count and the rows built from DIFFERENT where-clauses — the pager
//      would page past the end, or stop short of it;
//   2. a `sort` key reaching $order without passing the allowlist.

const ENV = { SOCRATA_DOMAIN: "example.test", DATASET_ID: "abcd-1234" };

/**
 * Runs handlePermits with fetch stubbed, capturing every Socrata request.
 * Returns { body, calls } where each call is the parsed searchParams.
 */
async function run(query, { count = "40868", rows = [] } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const params = new URL(String(input)).searchParams;
    calls.push(Object.fromEntries(params));
    const isCount = params.get("$select") === "count(1)";
    return { ok: true, async json() { return isCount ? [{ count_1: count }] : rows; } };
  };
  let body;
  try {
    const res = await handlePermits(new URL(`https://w.test/api/permits${query}`), ENV);
    body = await res.json();
  } finally {
    globalThis.fetch = original;
  }
  const rowsCall = calls.find(c => c.$select !== "count(1)");
  const countCall = calls.find(c => c.$select === "count(1)");
  return { body, calls, rowsCall, countCall };
}

test("a count query is issued alongside the rows query", async () => {
  const { calls, countCall } = await run("");
  assert.equal(calls.length, 2, "expected exactly one rows query and one count query");
  assert.ok(countCall, "no count(1) query was issued");
});

test("total comes from the count query, not the page length", async () => {
  const { body } = await run("", { count: "40868", rows: [{ permit_: "A" }] });
  assert.equal(body.total, 40868);
  assert.equal(body.row_count, 1, "row_count still reports the page size");
});

test("the count and the rows are built from the SAME where-clause", async () => {
  const { rowsCall, countCall } = await run("?ward=1&cost_min=50000&q=ELM&usable_processing=1");
  assert.equal(rowsCall.$where, countCall.$where);
  // and it is not trivially empty
  assert.ok(countCall.$where.includes("ward='1'"), countCall.$where);
  assert.ok(countCall.$where.includes("reported_cost >= 50000"), countCall.$where);
});

test("the count query is not paged or ordered", async () => {
  const { countCall } = await run("?limit=150&offset=300");
  assert.ok(!("$limit" in countCall), "count must not inherit the page limit");
  assert.ok(!("$offset" in countCall), "count must not inherit the page offset");
  assert.ok(!("$order" in countCall), "ordering a count is pointless work");
});

test("an unparseable count reports null, never 0", async () => {
  const { body } = await run("", { count: "not-a-number", rows: [{ permit_: "A" }] });
  assert.equal(body.total, null,
    "0 would render as 'no results' over a full page of rows");
});

test("usable_processing=1 moves the filter into SoQL", async () => {
  const { countCall } = await run("?usable_processing=1");
  assert.ok(countCall.$where.includes("processing_time > 0"), countCall.$where);
});

test("usable_processing is off unless explicitly 1", async () => {
  for (const q of ["", "?usable_processing=0", "?usable_processing=true", "?usable_processing="]) {
    const { countCall } = await run(q);
    assert.ok(!countCall.$where.includes("processing_time"), `${q} -> ${countCall.$where}`);
  }
});

// ---- $order allowlist ----------------------------------------------------

test("no sort key keeps today's default order", async () => {
  const { rowsCall, body } = await run("");
  assert.equal(rowsCall.$order, "issue_date DESC");
  assert.equal(body.sort, "");
});

test("each supported key maps to its column", async () => {
  const expected = {
    issued: "issue_date",
    cost: "reported_cost",
    permit_number: "permit_",
    permit_status: "permit_status",
  };
  for (const [key, column] of Object.entries(expected)) {
    const { rowsCall, body } = await run(`?sort=${key}&dir=asc`);
    assert.equal(rowsCall.$order, `${column} ASC NULL LAST`, key);
    assert.equal(body.sort, key);
  }
});

test("address is NOT sortable and falls back rather than approximating", async () => {
  // street_number is TEXT in the source, so street_name,street_number would
  // sort "100" before "99" within a street. Dropped rather than shipped wrong.
  const { rowsCall, body } = await run("?sort=address&dir=asc");
  assert.equal(rowsCall.$order, "issue_date DESC");
  assert.equal(body.sort, "", "the response must not claim address was honoured");
  assert.ok(!rowsCall.$order.includes("street"), rowsCall.$order);
});

test("an unknown sort key falls back AND says so", async () => {
  for (const key of ["nonsense", "reported_cost", "1"]) {
    const { rowsCall, body } = await run(`?sort=${encodeURIComponent(key)}`);
    assert.equal(rowsCall.$order, "issue_date DESC", key);
    assert.equal(body.sort, "", `${key} must not be echoed as honoured`);
  }
});

test("a sort key can never be interpolated into $order", async () => {
  const injections = [
    "issue_date DESC, permit_ ASC",
    "issue_date; drop",
    "issue_date' OR '1'='1",
    "count(1)",
  ];
  for (const key of injections) {
    const { rowsCall } = await run(`?sort=${encodeURIComponent(key)}`);
    assert.equal(rowsCall.$order, "issue_date DESC", key);
  }
});

test("dir accepts only asc/desc and defaults to desc", async () => {
  for (const [given, want] of [["asc", "ASC"], ["desc", "DESC"], ["", "DESC"],
                               ["ASC", "DESC"], ["asc; drop", "DESC"], ["1", "DESC"]]) {
    const { rowsCall } = await run(`?sort=cost&dir=${encodeURIComponent(given)}`);
    assert.equal(rowsCall.$order, `reported_cost ${want} NULL LAST`, `dir=${given}`);
  }
});

test("sorting puts NULLs last, or Cost-descending opens on blank rows", async () => {
  // Socrata sorts NULLs FIRST on DESC. Measured live 2026-08-07: 3,646 of
  // 40,868 open permits have no reported_cost, so without this the "most
  // expensive" view would begin with ~24 pages of blank-cost permits.
  const { rowsCall } = await run("?sort=cost&dir=desc");
  assert.ok(rowsCall.$order.endsWith("NULL LAST"), rowsCall.$order);
  const asc = await run("?sort=cost&dir=asc");
  assert.ok(asc.rowsCall.$order.endsWith("NULL LAST"), asc.rowsCall.$order);
});

test("dir is ignored when the sort key was rejected", async () => {
  const { body } = await run("?sort=address&dir=asc");
  assert.equal(body.dir, "desc", "reporting asc here would describe an order that was never applied");
});

// ---- the page-size cap is unchanged --------------------------------------

test("the per-request cap still holds at 1000", async () => {
  const { rowsCall } = await run("?limit=5000");
  assert.equal(rowsCall.$limit, "1000");
});

test("offset is passed through so the client can page", async () => {
  const { rowsCall, body } = await run("?limit=150&offset=450");
  assert.equal(rowsCall.$offset, "450");
  assert.equal(body.offset, 450);
  assert.equal(body.limit, 150);
});
