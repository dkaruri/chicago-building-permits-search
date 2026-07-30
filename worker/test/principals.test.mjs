import { test } from "node:test";
import assert from "node:assert/strict";
import {
  titleRank,
  formatPersonName,
  buildPrincipalIndex,
  attachPrincipals,
  fetchBusinessOwners,
} from "../src/principals.js";

const owners = [
  // Two humans + one COMPANY owner on the same business.
  { doing_business_as_name: "BEAR CONSTRUCTION COMPANY", owner_first_name: "George", owner_last_name: "Wienold", owner_title: "SECRETARY" },
  { doing_business_as_name: "Bear Construction Co.", owner_first_name: "Dana", owner_last_name: "Ali", owner_title: "PRESIDENT" },
  { doing_business_as_name: "BEAR CONSTRUCTION COMPANY", owner_name: "Holdco Inc.", owner_title: "SHAREHOLDER" },
  // Same human twice, different titles.
  { doing_business_as_name: "ELEMENTS GROUP CONSTRUCTION, LLC", owner_first_name: "MAREK", owner_last_name: "MIETKA", owner_title: "SECRETARY" },
  { doing_business_as_name: "Elements Group Construction LLC", owner_first_name: "Marek", owner_last_name: "Mietka", owner_title: "MANAGING MEMBER" },
];

test("title rank orders officers, unknown titles sort last", () => {
  assert.ok(titleRank("PRESIDENT") < titleRank("SECRETARY"));
  assert.ok(titleRank("SECRETARY") < titleRank("WIZARD"));
  assert.equal(titleRank("president"), titleRank("PRESIDENT"));
  assert.equal(titleRank(null), titleRank("ANYTHING UNLISTED"));
});

// These four came straight off the first production seed. The synthetic
// fixtures never produced a generational suffix or a pre-punctuated initial,
// so "Allan E. Bulley, Iii" and "Michael W..D.. Sudol" shipped and were only
// caught by reading the live API back.
test("real names from the live registry survive formatting", () => {
  assert.equal(formatPersonName("ALLAN", "E", "BULLEY, III"), "Allan E. Bulley, III");
  assert.equal(formatPersonName("MICHAEL", "W.D.", "SUDOL"), "Michael W.D. Sudol");
  assert.equal(formatPersonName("GEORGE", "H", "WIENOLD"), "George H. Wienold");
  assert.equal(formatPersonName("BONNIE", "E", "FRACKIEL"), "Bonnie E. Frackiel");
});

test("hyphens and apostrophes keep their inner capital", () => {
  assert.equal(formatPersonName("MARGUERITE", null, "VANDERBILT-HOLLINGSWORTH"), "Marguerite Vanderbilt-Hollingsworth");
  assert.equal(formatPersonName("SEAN", null, "O'BRIEN"), "Sean O'Brien");
  assert.equal(formatPersonName("MARIA", null, "DE LA CRUZ"), "Maria De La Cruz");
});

test("suffixes are not mistaken for initials, and vice versa", () => {
  assert.equal(formatPersonName("JOHN", null, "SMITH JR"), "John Smith JR");
  assert.equal(formatPersonName("ANNA", "V", "REYES"), "Anna V. Reyes");
  // "V" as a middle initial is an initial; "V" as a trailing suffix is not.
  assert.equal(formatPersonName("HENRY", null, "TUDOR V"), "Henry Tudor V");
});

test("shouted names are title-cased, mixed-case names are left alone", () => {
  assert.equal(formatPersonName("MAREK", null, "MIETKA"), "Marek Mietka");
  assert.equal(formatPersonName("Ron", "M", "Anderson"), "Ron M Anderson");
  // Do not mangle intentional inner capitals.
  assert.equal(formatPersonName("Sean", null, "McLennan"), "Sean McLennan");
  assert.equal(formatPersonName("", null, ""), "");
});

test("index joins name variants and keeps each human's best title", () => {
  const idx = buildPrincipalIndex(owners);
  const bear = idx.get("BEAR CONSTRUCTION");
  assert.deepEqual(bear.map((p) => p.name), ["Dana Ali", "George Wienold"], "president leads");
  assert.equal(bear.length, 2, "the company shareholder is not a person in charge");

  const elements = idx.get("ELEMENTS GROUP CONSTRUCTION");
  assert.equal(elements.length, 1, "one human, seen twice, stays one entry");
  assert.equal(elements[0].title, "MANAGING MEMBER", "best title wins over SECRETARY");
});

test("attach adds nothing at all when there is no match", () => {
  const idx = buildPrincipalIndex(owners);
  const profiles = [
    { contact_name: "Bear Construction Company, Inc." },
    { contact_name: "NOBODY KNOWS THIS FIRM LLC" },
  ];
  const matched = attachPrincipals(profiles, idx);
  assert.equal(matched, 1);
  assert.equal(profiles[0].principals[0].name, "Dana Ali");
  assert.equal(profiles[0].principal_count, 2);
  // The unmatched profile must not gain empty keys — the UI keys off absence.
  assert.ok(!("principals" in profiles[1]));
  assert.ok(!("principal_count" in profiles[1]));
});

test("principals are capped but the reported count is the true total", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    doing_business_as_name: "BIG FIRM LLC",
    owner_first_name: "Person", owner_last_name: `Number${i}`, owner_title: "MEMBER",
  }));
  const profiles = [{ contact_name: "Big Firm, L.L.C." }];
  attachPrincipals(profiles, buildPrincipalIndex(many));
  assert.equal(profiles[0].principals.length, 4);
  assert.equal(profiles[0].principal_count, 9);
});

test("fetch pages until a short batch and stops", async () => {
  const pages = [Array(50000).fill({ doing_business_as_name: "A", owner_first_name: "B", owner_last_name: "C" }), [{ doing_business_as_name: "D", owner_first_name: "E", owner_last_name: "F" }]];
  let calls = 0;
  const fake = async (url) => {
    const offset = new URL(url).searchParams.get("$offset");
    assert.equal(offset, String(calls * 50000));
    calls += 1;
    return { ok: true, json: async () => pages.shift() };
  };
  const rows = await fetchBusinessOwners(fake);
  assert.equal(calls, 2);
  assert.equal(rows.length, 50001);
});

test("fetch surfaces an HTTP failure instead of silently returning nothing", async () => {
  const fake = async () => ({ ok: false, status: 503, text: async () => "upstream down" });
  await assert.rejects(() => fetchBusinessOwners(fake), /503/);
});
