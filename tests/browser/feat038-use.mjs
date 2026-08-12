import { test } from "node:test";
import assert from "node:assert";
import { makeApp, stubSocrata, blockDrift } from "./feat038-impl.mjs";

const permit = (extra = {}) => ({ permit_number: "100999001", permit_type: "PERMIT - EASY PERMIT PROCESS", work_description: "", ...extra });

test("the FEAT-038 block is identical on index.html and list.html", () => {
  assert.deepEqual(blockDrift, [], `drifted between the two pages: ${blockDrift.join(", ")}`);
});

test("the class table buckets by class, not by leading digit", () => {
  const { ASSESSOR_CLASS_USE } = makeApp(stubSocrata());
  // The four codes that make a major-class mapping wrong. 591/593 share a digit
  // and differ; 991/997 are residential despite the 9.
  assert.equal(ASSESSOR_CLASS_USE.get("591"), "commercial");
  assert.equal(ASSESSOR_CLASS_USE.get("593"), "commercial");   // industrial, same bucket
  assert.equal(ASSESSOR_CLASS_USE.get("991"), "residential");
  assert.equal(ASSESSOR_CLASS_USE.get("997"), "residential");
  // The genuinely mixed-use classes, which sit under three different major types.
  for (const code of ["212", "318", "418", "918"]) assert.equal(ASSESSOR_CLASS_USE.get(code), "mixed", code);
  assert.equal(ASSESSOR_CLASS_USE.get("299"), "residential");
  assert.equal(ASSESSOR_CLASS_USE.get("EX"), "exempt");
  assert.equal(ASSESSOR_CLASS_USE.get("100"), "vacant");
  assert.equal(ASSESSOR_CLASS_USE.get("497"), "nonprofit");
});

test("a matched parcel is a sourced fact, with no approx badge", async () => {
  const app = makeApp(stubSocrata({
    pins: { "100999001": "17-04-100-001-0000" },
    parcels: { "1704100001": [{ class: "203", year: "2026" }] },
  }));
  const hit = await app.ensurePermitParcelUse(permit());
  assert.deepEqual(hit, { label: "Residential", classes: ["203"] });
  const html = app.parcelUseHtml(hit, permit());
  assert.match(html, /^Residential /);
  assert.match(html, /Cook County class 203/);
  assert.ok(!html.includes("approx"), "a sourced class must not carry the approx badge");
});

test("the newest assessment year wins", async () => {
  const app = makeApp(stubSocrata({
    pins: { "100999001": "17-04-100-001-0000" },
    // The parcel was commercial in 2019 and is residential now.
    parcels: { "1704100001": [{ class: "517", year: "2019" }, { class: "211", year: "2026" }] },
  }));
  assert.deepEqual(await app.ensurePermitParcelUse(permit()), { label: "Residential", classes: ["211"] });
});

test("a multi-PIN permit whose parcels disagree reads Mixed use", async () => {
  const app = makeApp(stubSocrata({
    pins: { "100999001": "17-04-100-001-0000|17-04-100-002-0000" },
    parcels: {
      "1704100001": [{ class: "203", year: "2026" }],
      "1704100002": [{ class: "517", year: "2026" }],
    },
  }));
  const hit = await app.ensurePermitParcelUse(permit());
  assert.equal(hit.label, "Mixed use");
  assert.deepEqual(hit.classes, ["203", "517"]);
  assert.match(app.parcelUseHtml(hit, permit()), /Cook County classes 203, 517/);
});

test("a multi-PIN permit whose parcels agree keeps the single label", async () => {
  const app = makeApp(stubSocrata({
    pins: { "100999001": "17-04-100-001-0000|17-04-100-002-0000" },
    parcels: {
      "1704100001": [{ class: "203", year: "2026" }],
      "1704100002": [{ class: "211", year: "2026" }],
    },
  }));
  assert.deepEqual(await app.ensurePermitParcelUse(permit()), { label: "Residential", classes: ["203", "211"] });
});

test("no parcel match falls back to the text heuristic, still badged approx", async () => {
  const app = makeApp(stubSocrata({ pins: { "100999001": "" } }));
  assert.equal(await app.ensurePermitParcelUse(permit()), null);
  const html = app.parcelUseHtml(null, permit({ work_description: "INTERIOR ALTERATIONS TO SINGLE FAMILY RESIDENCE" }));
  assert.match(html, /^Residential /);
  assert.match(html, /approx\./);
  // The tooltip may say WHY there is no County class; it must never cite one.
  assert.ok(!/Cook County class/.test(html), "a guess must not be attributed to the County");
});

test("no parcel match and no usable text reads as an em dash, never a guess", async () => {
  const app = makeApp(stubSocrata({ pins: { "100999001": "" } }));
  assert.equal(app.parcelUseHtml(null, permit({ work_description: "REPAIR PORCH" })), "&mdash;");
});

test("an unknown class code falls through to the heuristic rather than being guessed", async () => {
  const app = makeApp(stubSocrata({
    pins: { "100999001": "17-04-100-001-0000" },
    parcels: { "1704100001": [{ class: "ZZZ", year: "2026" }] },
  }));
  assert.equal(await app.ensurePermitParcelUse(permit()), null);
});

test("a network failure is not cached — a blip must not harden into unknown", async () => {
  let broken = true;
  const app = makeApp(stubSocrata({
    pins: { "100999001": "17-04-100-001-0000" },
    parcels: { "1704100001": [{ class: "203", year: "2026" }] },
    fail: url => broken && url.includes("cookcountyil"),
  }));
  assert.equal(await app.ensurePermitParcelUse(permit()), null);
  assert.equal(app.parcelUseCache.has("100999001"), false, "a failed lookup must not be cached");
  broken = false;
  assert.deepEqual(await app.ensurePermitParcelUse(permit()), { label: "Residential", classes: ["203"] });
});

test("a resolved permit is fetched once, not on every overlay open", async () => {
  const seen = [];
  const app = makeApp(stubSocrata({
    seen,
    pins: { "100999001": "17-04-100-001-0000" },
    parcels: { "1704100001": [{ class: "203", year: "2026" }] },
  }));
  await app.ensurePermitParcelUse(permit());
  const first = seen.length;
  await app.ensurePermitParcelUse(permit());
  assert.equal(seen.length, first, "the second open must be served from cache");
});

test("pin_list already on the row skips the permits lookup entirely", async () => {
  const seen = [];
  const app = makeApp(stubSocrata({ seen, parcels: { "1704100001": [{ class: "203", year: "2026" }] } }));
  const hit = await app.ensurePermitParcelUse(permit({ pin_list: "17-04-100-001-0000" }));
  assert.deepEqual(hit, { label: "Residential", classes: ["203"] });
  assert.equal(seen.filter(u => u.includes("cityofchicago")).length, 0);
});

test("a permit with no number never reaches the network", async () => {
  const seen = [];
  const app = makeApp(stubSocrata({ seen }));
  assert.equal(await app.ensurePermitParcelUse({ permit_number: "" }), null);
  assert.equal(seen.length, 0);
});

test("class codes and labels are HTML-escaped", () => {
  const app = makeApp(stubSocrata());
  const html = app.parcelUseHtml({ label: "Residential", classes: ["<img src=x>"] }, permit());
  assert.ok(!html.includes("<img"), "class codes must be escaped");
});
