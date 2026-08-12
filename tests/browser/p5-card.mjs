import { test } from "node:test";
import assert from "node:assert";
import { cardKicker, contactPillsHtml, contactDetailHtml } from "./p5-card-impl.mjs";

const desc = (over = {}) => ({
  type: "contact",
  name: "ACME BUILDERS",
  role: "general_contractor",
  profile: { open_jobs: 12, total_jobs: 88, avg_processing_days: 9.4, usable_processing_jobs: 40, reported_cost_total: 4200000, license_matches: [], work_types: [], permit_types: [], contact_types: [] },
  permits: [],
  relatedError: "",
  ...over,
});

test("cardKicker names the role in words, not a slug", () => {
  assert.equal(cardKicker({ type: "contact", role: "general_contractor" }), "General contractor");
  assert.equal(cardKicker({ type: "contact", role: "open_tech" }), "Open sub");
  assert.equal(cardKicker({ type: "permit" }), "Permit");
});

test("the card supplies the id the dialog is labelled by", () => {
  const html = contactDetailHtml(desc());
  assert.match(html, /id="permit-modal-title"/,
    'the dialog is aria-labelledby="permit-modal-title" — without this id it has no accessible name');
  assert.match(html, /id="permit-modal-title"[^>]*>ACME BUILDERS</);
});

test("the card title is focusable so navigation can move focus to it", () => {
  assert.match(contactDetailHtml(desc()), /id="permit-modal-title"[^>]*tabindex="-1"/);
});

test("no h4 anywhere — the overlay uses h3 for every block", () => {
  const html = contactDetailHtml(desc());
  assert.ok(!/<h4/.test(html), "h4 under h3 is a heading-level skip");
  assert.match(html, /<h3>/);
});

test("pills use the permit card's own classes", () => {
  const html = contactPillsHtml(desc().profile, 12);
  assert.match(html, /class="pm-tagrow[^"]*"/);
  assert.match(html, /class="pm-tag"/);
  assert.ok(!/class="tag"/.test(html), "the detail pane's .tag is a different visual language");
});

test("open jobs comes from the live count, not the cached profile", () => {
  const html = contactPillsHtml({ open_jobs: 999, total_jobs: 88 }, 12);
  assert.match(html, /12 open jobs/);
  assert.ok(!/999/.test(html), "cached open_jobs must not win over the live count");
});

test("the card escapes a hostile contractor name", () => {
  const html = contactDetailHtml(desc({ name: '<img src=x onerror=alert(1)>' }));
  assert.ok(!/<img src=x/.test(html));
  assert.match(html, /&lt;img/);
});

test("a back button appears only when there is something to go back to", () => {
  assert.match(contactDetailHtml(desc(), 1), /class="pm-back"/);
  assert.ok(!/class="pm-back"/.test(contactDetailHtml(desc(), 0)));
});

test("the permits table is wrapped so it cannot scroll the card body sideways", () => {
  const html = contactDetailHtml(desc({ permits: [{ permit_number: "1", address: "A", issue_date: "2026-01-01", work_type: "W", permit_type: "P", reported_cost: 1, permit_status: "ACTIVE", general_contractors: "ACME BUILDERS", open_subs: "" }] }));
  assert.match(html, /class="pm-tablewrap"/);
  assert.match(html, /aria-label="Open permits for ACME BUILDERS"/);
});

test("zero open permits explains itself instead of rendering an empty table", () => {
  const html = contactDetailHtml(desc({ permits: [] }));
  assert.match(html, /No open permits on file/);
  assert.ok(!/Add all/.test(html), "an Add-all button for zero rows is noise");
});

test("a fetch failure states the problem and offers a retry", () => {
  const html = contactDetailHtml(desc({ relatedError: "Network error" }));
  assert.match(html, /role="alert"/);
  assert.match(html, /Retry/);
});

test("the card carries the full profile, not just the permits table", () => {
  const html = contactDetailHtml(desc({
    profile: {
      total_jobs: 88,
      license_matches: [{ license_type: "General Contractor (Class E)", phone: "(773) 555-0180", license_number: "TGC12345", license_expiration_date: "2027-03-01" }],
      work_types: [{ work_type: "RENOVATION", jobs: 40 }, { work_type: "NEW CONSTRUCTION", jobs: 12 }],
      permit_types: [], contact_types: [],
      city: "CHICAGO", state: "IL", zipcode: "60618",
    },
  }));
  assert.match(html, /<h3>License<\/h3>/);
  assert.match(html, /General Contractor/);
  assert.match(html, /Class E/);
  assert.match(html, /\(773\) 555-0180/);
  assert.match(html, /CHICAGO, IL 60618/);
  assert.match(html, /<h3>Specialties<\/h3>/);
  assert.match(html, /RENOVATION/);
});

test("a contractor with no license match says so rather than showing an empty block", () => {
  const html = contactDetailHtml(desc({ profile: { license_matches: [], work_types: [], permit_types: [], contact_types: [] } }));
  assert.match(html, /No City license match/);
});

test("associations list the OTHER role and open a card, never the pane", () => {
  const html = contactDetailHtml(desc({
    permits: [
      { permit_number: "1", address: "A", issue_date: "2026-01-01", permit_status: "ACTIVE", reported_cost: 1, general_contractors: "ACME BUILDERS", open_subs: "SPARK ELECTRIC | FLOW PLUMBING" },
      { permit_number: "2", address: "B", issue_date: "2026-01-02", permit_status: "ACTIVE", reported_cost: 2, general_contractors: "ACME BUILDERS", open_subs: "SPARK ELECTRIC" },
    ],
  }));
  assert.match(html, /<h3>Associations<\/h3>/);
  assert.match(html, /SPARK ELECTRIC/);
  assert.match(html, /FLOW PLUMBING/);
  // Association chips must push a card onto the stack. openContactProfile drives
  // the separate directory pane and would wipe the overlay's stack.
  assert.match(html, /openContactCard\(/);
  assert.ok(!/openContactProfile\(/.test(html), "the pane entry point must not be used from inside the overlay");
  assert.match(html, /open_tech/, "a GC's associations are its open subs");
});

test("associations are counted, most frequent first", () => {
  const html = contactDetailHtml(desc({
    permits: [
      { permit_number: "1", general_contractors: "ACME BUILDERS", open_subs: "SPARK ELECTRIC | FLOW PLUMBING" },
      { permit_number: "2", general_contractors: "ACME BUILDERS", open_subs: "SPARK ELECTRIC" },
    ],
  }));
  assert.ok(html.indexOf("SPARK ELECTRIC") < html.indexOf("FLOW PLUMBING"));
  assert.match(html, /SPARK ELECTRIC<\/span> <span class="assoc-n">2/);
});
