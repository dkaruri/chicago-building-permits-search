import { test } from "node:test";
import assert from "node:assert";
import { handlePermits } from "../src/permits.js";

// FEAT-021 permit value range. The cost bounds are interpolated into SoQL
// UNQUOTED, so these assert both the range semantics and that nothing
// non-numeric can reach the query.

const ENV = { SOCRATA_DOMAIN: "example.test", DATASET_ID: "abcd-1234" };

/** Runs handlePermits with fetch stubbed; returns the $where Socrata was sent. */
async function whereFor(query) {
  const original = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (input) => {
    captured = new URL(String(input)).searchParams.get("$where");
    return { ok: true, async json() { return []; } };
  };
  try {
    await handlePermits(new URL(`https://w.test/api/permits${query}`), ENV);
  } finally {
    globalThis.fetch = original;
  }
  return captured;
}

test("no cost params adds no cost clause", async () => {
  const where = await whereFor("");
  assert.ok(!where.includes("reported_cost"), where);
});

test("cost_min and cost_max become an inclusive numeric range", async () => {
  const where = await whereFor("?cost_min=50000&cost_max=250000");
  assert.ok(where.includes("reported_cost >= 50000"), where);
  assert.ok(where.includes("reported_cost <= 250000"), where);
});

test("each bound is independent", async () => {
  const minOnly = await whereFor("?cost_min=1000");
  assert.ok(minOnly.includes("reported_cost >= 1000"), minOnly);
  assert.ok(!minOnly.includes("<="), minOnly);

  const maxOnly = await whereFor("?cost_max=1000");
  assert.ok(maxOnly.includes("reported_cost <= 1000"), maxOnly);
  assert.ok(!maxOnly.includes(">="), maxOnly);
});

test("decimals and zero survive; blanks are ignored", async () => {
  const where = await whereFor("?cost_min=0&cost_max=1500.75");
  assert.ok(where.includes("reported_cost >= 0"), where);
  assert.ok(where.includes("reported_cost <= 1500.75"), where);

  const blank = await whereFor("?cost_min=&cost_max=%20");
  assert.ok(!blank.includes("reported_cost"), blank);
});

test("non-numeric bounds are dropped, not escaped into the query", async () => {
  for (const bad of ["abc", "1 OR 1=1", "'; DROP--", "NaN", "1e"]) {
    const where = await whereFor(`?cost_min=${encodeURIComponent(bad)}`);
    assert.ok(!where.includes("reported_cost"), `${bad} -> ${where}`);
  }
});

test("Infinity is rejected — it would produce an unparseable SoQL literal", async () => {
  const where = await whereFor("?cost_max=Infinity");
  assert.ok(!where.includes("reported_cost"), where);
});
