// t41 — FEAT-034 phase 2: the per-list notes feed.
// Covers: entry point, scope, newest-first order, search, both empty states,
// and the round trip permit <-> feed preserving search AND scroll.
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const ROWS = [
  { permit_number: "101082609", address: "3701 W AINSLIE ST", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", ward: "39", reported_cost: 120000, lat: 41.97, lon: -87.72 },
  { permit_number: "B200461632", address: "1200 N STATE PKWY", permit_status: "ACTIVE", permit_type: "PERMIT - NEW CONSTRUCTION", issue_date: "2026-07-02", ward: "2", reported_cost: 900000, lat: 41.90, lon: -87.62 },
  { permit_number: "100987654", address: "55 E MONROE ST", permit_status: "ACTIVE", permit_type: "PERMIT - EASY PERMIT", issue_date: "2026-07-03", ward: "42", reported_cost: 4000, lat: 41.88, lon: -87.62 },
];

// Two shared posts on the first permit, one on the second. Third permit has
// only a private note. A fourth permit that is NOT in the list has notes too —
// it must never appear.
const THREADS = {
  "101082609": [
    { id: "n_a1", kind: "text", author: "Divyam", text: "Roof crew on site, foreman is Luis", ts: 1900000000 },
    { id: "n_a2", kind: "walk", author: "Sam", ts: 1900000500, job: "new", gc: { name: "BEAR CONSTRUCTION" }, sub: null },
  ],
  "B200461632": [
    { id: "n_b1", kind: "photo", author: "Divyam", text: "back stairs", photos: [{ id: "p_1" }, { id: "p_2" }], ts: 1900000200 },
  ],
  "999NOTINLIST": [
    { id: "n_z1", kind: "text", author: "Nobody", text: "SHOULD NEVER APPEAR", ts: 1999999999 },
  ],
};

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) { console.log(`  ok   ${name}`); }
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

async function run(viewport, label) {
  console.log(`\n== ${label} ==`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });

  await page.route("**/api/notes/bulk*", route => {
    const url = new URL(route.request().url());
    const want = new Set((url.searchParams.get("p") || "").split(",").filter(Boolean));
    const threads = {};
    for (const [permit, posts] of Object.entries(THREADS)) if (want.has(permit)) threads[permit] = posts;
    route.fulfill({ json: { threads, truncated: false } });
  });
  await page.route("**/api/notes/counts*", route => route.fulfill({ json: { counts: { "101082609": 2, "B200461632": 1 } } }));
  await page.route("**/api/contact/**", route => route.fulfill({ json: {} }));

  await openList(page);
  await page.evaluate(() => {
    localStorage.setItem("chi_permit_user_notes", JSON.stringify({
      list: "",
      permits: { "100987654": "Gate code 4432, park on Wabash", "101082609": "legacy note with no timestamp" },
      noteTs: { "100987654": 1900000900 },
    }));
    loadUserNotes();
  });
  await seedSavedList(page, ROWS);

  // ---- entry point ----
  const btn = await page.$("#notes-feed-btn");
  check("Notes button exists in the list toolbar", !!btn);
  await page.waitForFunction(() => document.getElementById("notes-feed-count").textContent.trim() !== "", null, { timeout: 5000 }).catch(() => {});
  const badge = await page.$eval("#notes-feed-count", el => el.textContent.trim());
  // 2 private notes + 3 public (counts endpoint says 2 + 1) = 5
  check("button count includes private and shared notes", badge === "5", `got "${badge}"`);

  await page.click("#notes-feed-btn");
  await page.waitForSelector("#notes-feed[open] .feed-entry", { timeout: 10000 });

  // ---- contents & scope ----
  const texts = await page.$$eval("#notes-feed .feed-text", els => els.map(e => e.textContent.trim()));
  check("no note from a permit outside the list", !texts.some(t => t.includes("SHOULD NEVER APPEAR")),
    JSON.stringify(texts));
  check("all five notes are listed", texts.length === 5, `got ${texts.length}: ${JSON.stringify(texts)}`);

  // ---- newest first, undated last ----
  check("newest note is first", /Gate code 4432/.test(texts[0]), texts[0]);
  check("walkthrough renders as prose", texts.some(t => /Walkthrough/.test(t) && /BEAR CONSTRUCTION/.test(t)),
    JSON.stringify(texts));
  check("photo post is described by count and caption", texts.some(t => /2 photos/.test(t) && /back stairs/.test(t)),
    JSON.stringify(texts));
  check("undated legacy note sorts last", /legacy note with no timestamp/.test(texts[texts.length - 1]),
    texts[texts.length - 1]);

  // ---- source badges carry a word, not just a colour ----
  const badges = await page.$$eval("#notes-feed .feed-src", els => els.map(e => e.textContent.trim()));
  check("private notes are labelled with the word Private", badges.some(b => /Private/i.test(b)), JSON.stringify(badges));
  check("shared notes are labelled in words", badges.some(b => /Shared|Walkthrough|Photo/i.test(b)), JSON.stringify(badges));

  // ---- search ----
  await page.fill("#feed-q", "gate");
  await page.waitForTimeout(60);
  let shown = await page.$$eval("#notes-feed .feed-text", els => els.map(e => e.textContent.trim()));
  check("search filters to matching notes", shown.length === 1 && /Gate code/.test(shown[0]), JSON.stringify(shown));
  const countLabel = await page.$eval("#notes-feed .feed-count", el => el.textContent.trim());
  check("count shows matched of total while searching", /1 of 5 notes/.test(countLabel), countLabel);

  await page.fill("#feed-q", "ainslie");
  await page.waitForTimeout(60);
  shown = await page.$$eval("#notes-feed .feed-text", els => els.length);
  check("search matches on address", shown === 3, `got ${shown}`);

  await page.fill("#feed-q", "zzzznotathing");
  await page.waitForTimeout(60);
  const noMatch = await page.$eval("#notes-feed .feed-body", el => el.textContent);
  check("no-match empty state names the query", /No notes match/.test(noMatch) && /zzzznotathing/.test(noMatch), noMatch.slice(0, 120));
  check("no-match empty state offers a way out", !!(await page.$("#notes-feed .feed-empty button")));

  await page.click("#notes-feed .feed-empty button");
  await page.waitForTimeout(60);
  shown = await page.$$eval("#notes-feed .feed-text", els => els.length);
  check("clear search restores every note", shown === 5, `got ${shown}`);

  // ---- round trip: feed -> permit -> back to feed, state preserved ----
  await page.fill("#feed-q", "roof");
  await page.waitForTimeout(60);
  await page.evaluate(() => { document.querySelector("#notes-feed .feed-body").scrollTop = 0; });
  await page.click("#notes-feed .feed-entry");
  await page.waitForSelector("#permit-modal:not([hidden])", { timeout: 10000 });
  const openPermit = await page.$eval("#permit-modal", el => el.textContent.includes("101082609"));
  check("clicking a note opens its permit", openPermit);
  const feedClosed = await page.$eval("#notes-feed", el => !el.open);
  check("feed closes while the permit is open", feedClosed);

  await page.evaluate(() => closePermitModal());
  await page.waitForSelector("#notes-feed[open]", { timeout: 10000 });
  check("closing the permit returns to the feed", true);
  const restoredQ = await page.$eval("#feed-q", el => el.value);
  check("search text survives the round trip", restoredQ === "roof", `got "${restoredQ}"`);

  // ---- scroll restoration ----
  // Five notes do not overflow the panel at either viewport, so the restore
  // would be trivially "0 === 0" and prove nothing. Push in enough posts that
  // the body genuinely scrolls before measuring.
  await page.fill("#feed-q", "");
  await page.evaluate(() => {
    const many = [];
    for (let i = 0; i < 40; i++) {
      many.push({ id: `n_bulk${i}`, kind: "text", author: "Bulk", text: `Filler note number ${i} to make the feed scroll`, ts: 1800000000 + i });
    }
    state.feed.threads["101082609"] = (state.feed.threads["101082609"] || []).concat(many);
    state.feed.entries = buildFeedEntries(feedRows());
    state.feed.shown = 999;
    renderNotesFeed();
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const b = document.querySelector("#notes-feed .feed-body");
    b.scrollTop = Math.floor(b.scrollHeight / 2);
  });
  const before = await page.$eval("#notes-feed .feed-body", b => b.scrollTop);
  check("feed body actually overflows, so the restore is a real measurement", before > 40, `scrollTop ${before}`);

  // Click an entry that is ALREADY on screen. Playwright scrolls an off-screen
  // element into view before clicking it, which moves the very scrollTop under
  // test — that is the test driver, not a person tapping a note they can see.
  const clicked = await page.evaluate(() => {
    const body = document.querySelector("#notes-feed .feed-body");
    const box = body.getBoundingClientRect();
    for (const el of body.querySelectorAll(".feed-entry")) {
      const r = el.getBoundingClientRect();
      if (r.top >= box.top && r.bottom <= box.bottom) { el.click(); return true; }
    }
    return false;
  });
  check("found a fully visible entry to tap", clicked);
  await page.waitForSelector("#permit-modal:not([hidden])", { timeout: 10000 });
  const captured = await page.evaluate(() => state.feed.returnTo && state.feed.returnTo.scrollTop);
  check("leaving the feed captures the scroll position it was at", captured === before, `captured ${captured}, was ${before}`);

  await page.evaluate(() => closePermitModal());
  await page.waitForSelector("#notes-feed[open]", { timeout: 10000 });
  await page.waitForTimeout(120);
  const after = await page.$eval("#notes-feed .feed-body", b => b.scrollTop);
  check("scroll position survives the round trip", Math.abs(after - before) <= 4, `before ${before}, after ${after}`);

  // ---- permit -> feed filtered to that permit ----
  await page.evaluate(() => closeNotesFeed());
  await page.waitForTimeout(50);
  await page.evaluate(() => openPermitDetail(state.userPermitMap.get("101082609")));
  await page.waitForSelector("#permit-modal:not([hidden]) .pm-feed-btn", { timeout: 10000 });
  await page.click(".pm-feed-btn");
  await page.waitForSelector("#notes-feed[open] .feed-entry", { timeout: 10000 });
  const scoped = await page.$$eval("#notes-feed .feed-where .fp", els => [...new Set(els.map(e => e.textContent.trim()))]);
  check("feed opened from a permit is filtered to that permit", scoped.length === 1 && scoped[0] === "101082609",
    JSON.stringify(scoped));
  const scopeHead = await page.$eval("#notes-feed .feed-scope", el => el.textContent);
  check("scope line says which permit", /101082609/.test(scopeHead), scopeHead);

  // ---- separate feeds per list ----
  await page.evaluate(() => closeNotesFeed());
  await page.waitForTimeout(50);
  await page.evaluate(async () => {
    state.lists.L2 = { name: "Other", permits: ["100987654"], focal: null, sharedId: null };
    await showList("L2");
  });
  await page.waitForTimeout(120);
  await page.click("#notes-feed-btn");
  await page.waitForSelector("#notes-feed[open]", { timeout: 10000 });
  await page.waitForTimeout(400);
  const otherTexts = await page.$$eval("#notes-feed .feed-text", els => els.map(e => e.textContent.trim()));
  check("a different list has its own feed", otherTexts.length === 1 && /Gate code/.test(otherTexts[0]),
    JSON.stringify(otherTexts));

  // ---- empty state when the list has no notes ----
  await page.evaluate(() => closeNotesFeed());
  await page.waitForTimeout(50);
  await page.evaluate(async () => {
    state.userPermitNotes = {}; state.userNoteTs = {};
    state.feed.threads = {}; state.feed.loadedFor = "";
    state.lists.L3 = { name: "Empty", permits: ["B200461632"], focal: null, sharedId: null };
    await showList("L3");
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => { state.feed.loadedFor = "L3"; state.feed.threads = {}; });
  await page.click("#notes-feed-btn");
  await page.waitForSelector("#notes-feed[open] .feed-empty", { timeout: 10000 });
  const emptyText = await page.$eval("#notes-feed .feed-empty", el => el.textContent);
  check("no-notes empty state differs from no-match", /No notes in this list yet/.test(emptyText), emptyText.slice(0, 120));

  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "desktop 1280x900");
  await run({ width: 390, height: 844 }, "iPhone 13 390x844");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
