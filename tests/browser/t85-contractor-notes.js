// t85 — FIX-034. A note lives on a permit; a contractor's notes are the notes
// on the permits that name them. Rolled up at READ time and never copied, so
// notes that already existed appear with no backfill and cannot drift between
// two stored copies.
//
// Runs against both index.html and list.html — the contact-card block is
// byte-identical across them by design.
//
//   node verify-tmp/t85-contractor-notes.js
const { chromium, CHROME } = require("./_boot");

const BASE = process.env.BASE || "http://localhost:8791";

// Two GCs and two open subs spread over three permits, so the roll-up has to
// pick the right subset per contractor and one note has to land under several.
const PERMITS = [
  { permit_number: "100111", address: "1 N STATE ST", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION",
    issue_date: "2026-07-01", reported_cost: 100000, latitude: 41.88, longitude: -87.63,
    general_contractors: "ACME BUILDERS", open_subs: "ZED PLUMBING" },
  { permit_number: "100222", address: "2 S CLARK ST", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION",
    issue_date: "2026-07-02", reported_cost: 200000, latitude: 41.88, longitude: -87.63,
    general_contractors: "ACME BUILDERS", open_subs: "" },
  { permit_number: "100333", address: "3 W ADAMS ST", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION",
    issue_date: "2026-07-03", reported_cost: 300000, latitude: 41.88, longitude: -87.63,
    general_contractors: "OTHER CONSTRUCTION", open_subs: "" },
];

// 100111 carries two public notes and is shared by a GC and a sub — the
// multi-contractor case. 100222 has one. 100333 belongs to a different GC and
// must never leak into ACME's card.
const THREADS = {
  "100111": [
    { id: "n_00000001", author: "Divyam", ts: 1754000000, editedTs: null, kind: "text", text: "Gate code is 4417" },
    { id: "n_00000002", author: "Sam", ts: 1754000900, editedTs: null, kind: "walk", job: "remodel",
      gc: { name: "ACME BUILDERS", phone: "", covers: "", jobs: null, estimate: "unknown" }, sub: null },
  ],
  "100222": [
    { id: "n_00000003", author: "Divyam", ts: 1754001800, editedTs: null, kind: "text", text: "Owner prefers mornings" },
  ],
  "100333": [
    { id: "n_00000004", author: "Nobody", ts: 1754002700, editedTs: null, kind: "text", text: "SHOULD NOT APPEAR on ACME" },
  ],
};

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

async function openCard(page, name, role) {
  // Closing unwinds the overlay's history entries, and history.go() destroys the
  // execution context — so close, let it settle, THEN open. Doing both in one
  // evaluate kills the call mid-flight.
  await page.evaluate(() => {
    if (!document.getElementById("permit-modal").hidden) closePermitModal();
  }).catch(() => {});
  await page.waitForTimeout(400);
  await page.evaluate(([n, r]) => openContactProfile(encodeURIComponent(n), r), [name, role]);
  await page.waitForFunction(() => {
    const d = document.querySelector("#permit-modal .contact-card");
    return d && !document.querySelector("#permit-modal-body [aria-busy='true']");
  }, null, { timeout: 15000 });
  // The notes block fills after the permits land, in its own round trip.
  await page.waitForTimeout(600);
}

const notesBlock = page => page.evaluate(() => {
  const host = document.getElementById("pm-contact-notes");
  // Always the same shape, so a missing block reports every assertion as a
  // failure instead of crashing the run on the first one.
  if (!host) return { missing: true, hidden: null, heading: "", count: 0, entries: [] };
  const arts = [...host.querySelectorAll("article")];
  return {
    hidden: host.hidden,
    heading: (host.querySelector("h3") || {}).textContent || "",
    count: arts.length,
    entries: arts.map(a => ({
      who: (a.querySelector(".tp-who") || {}).textContent || "",
      kind: (a.querySelector(".tp-kind") || {}).textContent || "",
      text: (a.querySelector(".tp-text") || {}).textContent || "",
      when: (a.querySelector("time") || {}).textContent || "",
      permit: (a.querySelector(".tp-act button") || {}).textContent || "",
    })),
  };
});

async function run(pagePath, viewport, label) {
  console.log(`\n== ${pagePath} — ${label} ==`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });
  const bulkCalls = [];

  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ json: [{ lat: "41.9", lon: "-87.7", display_name: "stub" }] }));
  await page.route("**/api/notes/bulk*", r => {
    const want = new URL(r.request().url()).searchParams.get("p") || "";
    bulkCalls.push(want);
    const threads = {};
    for (const p of want.split(",").filter(Boolean)) if (THREADS[p]) threads[p] = THREADS[p];
    r.fulfill({ json: { threads, truncated: false } });
  });
  await page.route("**/api/notes/counts*", r => r.fulfill({ json: { counts: {} } }));
  await page.route("**/api/contact/**", r => r.fulfill({ json: { matched_as: "", matched_category: "", license_matches: [], principals: [] } }));
  await page.route("**/api/permits?**", r => {
    const name = (new URL(r.request().url()).searchParams.get("contact_name") || "").toUpperCase();
    const rows = PERMITS.filter(p =>
      (p.general_contractors || "").toUpperCase().includes(name) || (p.open_subs || "").toUpperCase().includes(name));
    r.fulfill({ json: { rows, total: rows.length } });
  });

  await page.goto(`${BASE}/${pagePath}`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });

  // A private note lives in this browser only. It must show on the card, and it
  // must never be sent anywhere — the bulk request carries permit numbers only.
  await page.evaluate(() => {
    state.userPermitNotes["100222"] = "Private: park round the back";
    state.userNoteTs["100222"] = 1754003600;
  });

  // ---- a GC with notes across several permits ----
  await openCard(page, "ACME BUILDERS", "general_contractors");
  const acme = await notesBlock(page);
  check("the notes block exists on the contractor card", !acme.missing, JSON.stringify(acme));
  check("it is shown when the contractor has notes", acme.hidden === false, JSON.stringify(acme));
  check("it is headed Notes", /Notes/i.test(acme.heading), acme.heading);
  // 2 public on 100111 + 1 public on 100222 + 1 private on 100222 = 4.
  check("it rolls up every note on the contractor's permits, plus the private one",
    acme.count === 4, `${acme.count}: ${JSON.stringify(acme.entries.map(e => e.text))}`);
  check("another contractor's note never leaks in",
    acme.entries.length > 0 && !acme.entries.some(e => /SHOULD NOT APPEAR/.test(e.text)), JSON.stringify(acme.entries));
  check("newest first",
    !!acme.entries[0] && acme.entries[0].text.includes("Private: park round the back"), JSON.stringify(acme.entries.map(e => e.text)));
  check("each note says which permit it came from",
    acme.entries.length === 4 && acme.entries.every(e => /\b100(111|222)\b/.test(e.permit)), JSON.stringify(acme.entries.map(e => e.permit)));
  check("each note carries its author", acme.entries.some(e => /Divyam/.test(e.who)), JSON.stringify(acme.entries.map(e => e.who)));
  check("each note carries a timestamp", acme.entries.length === 4 && acme.entries.every(e => e.when.trim().length > 0), JSON.stringify(acme.entries.map(e => e.when)));
  check("the private note is labelled as private and attributed to you",
    acme.entries.some(e => /private/i.test(e.kind) && /your/i.test(e.who)), JSON.stringify(acme.entries));
  check("a walkthrough post is summarised, not blank",
    acme.entries.some(e => /walk/i.test(e.kind) && e.text.trim().length > 0), JSON.stringify(acme.entries));
  check("the private note was never sent to the API",
    bulkCalls.length > 0 && bulkCalls.every(c => !/park round the back/i.test(c)), JSON.stringify(bulkCalls));

  // The repo requires >=44px on every touch target. `.tp-act button` shipped at
  // 40px, so the new "On permit N" button inherited a short one — raised on the
  // shared rule rather than only for this card, which also lifts the thread's
  // Edit/Delete buttons.
  const target = await page.evaluate(() => {
    const b = document.querySelector("#pm-contact-notes .tp-act button");
    const r = b.getBoundingClientRect();
    return { h: Math.round(r.height), w: Math.round(r.width), name: (b.textContent || "").trim() };
  });
  check("the permit button meets the 44px touch target", target.h >= 44, JSON.stringify(target));
  check("the permit button names the permit rather than saying 'open'",
    /\d{6}/.test(target.name), target.name);

  // ---- the SAME note under an Open Sub on the same permit ----
  await openCard(page, "ZED PLUMBING", "open_subs");
  const zed = await notesBlock(page);
  check("an open sub gets the notes block too (not GCs only)", zed.hidden === false, JSON.stringify(zed));
  check("the sub sees the notes of the permit it shares with the GC",
    zed.entries.some(e => /Gate code is 4417/.test(e.text)), JSON.stringify(zed.entries.map(e => e.text)));
  check("the sub does not see notes from permits it is not on",
    zed.entries.length > 0 && !zed.entries.some(e => /mornings|SHOULD NOT APPEAR/.test(e.text)), JSON.stringify(zed.entries.map(e => e.text)));

  // ---- a contractor with no notes gets NO section, not an empty one ----
  await openCard(page, "OTHER CONSTRUCTION", "general_contractors");
  await page.evaluate(() => { window.__t85 = true; });
  const other = await notesBlock(page);
  check("a contractor whose only note is its own still shows it", other.hidden === false, JSON.stringify(other));

  // Strip 100333's thread so this contractor genuinely has none.
  await page.evaluate(() => { const d = activeCard(); if (d) { d.notes = null; d.notesLoaded = false; } });
  await page.unroute("**/api/notes/bulk*");
  await page.route("**/api/notes/bulk*", r => r.fulfill({ json: { threads: {}, truncated: false } }));
  await openCard(page, "OTHER CONSTRUCTION", "general_contractors");
  const none = await notesBlock(page);
  check("a contractor with no notes gets no visible section and no zero badge",
    none.hidden === true && none.count === 0, JSON.stringify(none));

  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.evaluate(() => renderCard("none"));
  await page.waitForTimeout(200);
  check("no page errors", errs.length === 0, JSON.stringify(errs));

  await browser.close();
}

(async () => {
  for (const p of ["index.html", "list.html"]) {
    await run(p, { width: 1280, height: 900 }, "desktop 1280x900");
    await run(p, { width: 390, height: 844 }, "iPhone 13 390x844");
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
