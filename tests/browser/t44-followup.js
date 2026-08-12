// t44 — FEAT-034 phase 3: the GC follow-up tag.
// Covers: the toggle inside the permit card, the badge on the list row, the
// filter bar, reorder locking while filtered, and the shared-list PUT.
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const ROWS = [
  { permit_number: "101082609", address: "3701 W AINSLIE ST", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", ward: "39", reported_cost: 120000, lat: 41.97, lon: -87.72,
    general_contractors: "BEAR CONSTRUCTION | SECOND GC" },
  { permit_number: "B200461632", address: "1200 N STATE PKWY", permit_status: "ACTIVE", permit_type: "PERMIT - NEW CONSTRUCTION", issue_date: "2026-07-02", ward: "2", reported_cost: 900000, lat: 41.90, lon: -87.62,
    general_contractors: "" },
  { permit_number: "100987654", address: "55 E MONROE ST", permit_status: "ACTIVE", permit_type: "PERMIT - EASY PERMIT", issue_date: "2026-07-03", ward: "42", reported_cost: 4000, lat: 41.88, lon: -87.62,
    general_contractors: "MONROE BUILDERS" },
];

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) { console.log(`  ok   ${name}`); }
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

async function run(viewport, label) {
  console.log(`\n== ${label} ==`);
  const failuresAtStart = failures;
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });
  // FIX-045. Trace every run, but only KEEP it when something failed. On a green
  // run the zip is discarded, so this costs nothing in the normal case; on a red
  // one it hands over a DOM snapshot at the failing moment, which is the single
  // artefact both flake investigations lacked. Open with:
  //   npx playwright show-trace verify-tmp/_t44-trace-<label>.zip
  await page.context().tracing.start({ screenshots: true, snapshots: true });

  const puts = [];
  await page.route("**/api/notes/bulk*", r => r.fulfill({ json: { threads: {}, truncated: false } }));
  await page.route("**/api/notes/counts*", r => r.fulfill({ json: { counts: {} } }));
  await page.route("**/api/contact/**", r => r.fulfill({ json: {} }));
  await page.route("**/api/lists/*/follow", r => {
    puts.push({ url: r.request().url(), body: JSON.parse(r.request().postData() || "{}") });
    r.fulfill({ json: { ok: true } });
  });

  await openList(page);
  await seedSavedList(page, ROWS);

  // ---- filter bar hidden until something is flagged ----
  check("filter bar is hidden when nothing is flagged", await page.$eval("#list-filters", el => el.hidden));

  // ---- the toggle lives in the permit card, next to the GC ----
  await page.evaluate(() => openPermitDetail(state.userPermitMap.get("101082609")));
  await page.waitForSelector("#permit-modal:not([hidden]) .pm-followup", { timeout: 10000 });
  const near = await page.evaluate(() => {
    const btn = document.querySelector("#permit-modal .pm-followup");
    const block = btn.closest(".pm-block");
    return block && /General contractors/.test(block.querySelector("h3").textContent);
  });
  check("toggle sits inside the General contractors block", near);
  const labelBefore = await page.$eval("#permit-modal .pm-followup", el => el.textContent.trim());
  check("toggle names the GC it is about", /BEAR CONSTRUCTION/.test(labelBefore), labelBefore);
  check("toggle starts unpressed", await page.$eval("#permit-modal .pm-followup", el => el.getAttribute("aria-pressed")) === "false");
  const stateBefore = await page.$eval("#permit-modal .pm-followup", el => el.parentElement.querySelector(".pm-fu-state").textContent.trim());
  check("state is stated in words, not colour alone", /Not flagged/i.test(stateBefore), stateBefore);
  // FIX-047. This flaked ~1 run in 5 and always accused the product's touch
  // target. It was the check: `.pm-fu` carries `min-height: 44px`, so a button
  // that is actually rendered can NEVER measure under 44 — the only sub-44
  // values reachable are the unmeasurable ones, 0 (in a hidden subtree) and -1
  // (no match). Driving those two states deliberately reproduces the recorded
  // flake signature exactly, `h:0, hidden:true, connected:true` — the same
  // reading the ResizeObserver hunt captured and could not place.
  //
  // The window was structural: waitForSelector resolved in one round trip and
  // the measurement read the DOM again in a SECOND, so anything that unmounted
  // the card in between was measured as a small button. Closed by making the
  // wait itself return the measurement, so both happen in one page task.
  //
  // The condition is "mounted and painted", NOT "h >= 44" — waiting on the
  // threshold would mask the very defect this asserts. The threshold below is
  // unchanged and still fails at anything under 44; proved with a mutant that
  // shrinks .pm-fu to 20px.
  //
  // `polls` is how many times the condition had to run. Riding past a real
  // transient unmount must not SWALLOW it — anything above 1 means the card was
  // genuinely not mounted on first look, which is the trigger two hunts never
  // caught. It is reported, not asserted on: failing there would just rebuild
  // the flake.
  const fu = await page.waitForFunction(() => {
    window.__fuPolls = (window.__fuPolls || 0) + 1;
    const all = [...document.querySelectorAll("#permit-modal .pm-followup")];
    const el = all[0];
    if (!el || !el.isConnected || el.offsetParent === null) return null;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.height) return null;
    const icon = el.querySelector(".material-symbols-outlined");
    return {
      h: +r.height.toFixed(2), w: +r.width.toFixed(2), top: +r.top.toFixed(1),
      matches: all.length, hidden: el.offsetParent === null, connected: el.isConnected,
      minH: cs.minHeight, disp: cs.display, vis: cs.visibility, op: cs.opacity,
      anim: cs.animationName, cardAnim: (() => {
        const c = document.querySelector(".permit-modal-card");
        return c ? getComputedStyle(c).animationName : null;
      })(),
      iconW: icon ? +icon.getBoundingClientRect().width.toFixed(2) : null,
      fonts: document.fonts ? document.fonts.status : "n/a",
      modalHidden: document.getElementById("permit-modal").hidden,
      polls: window.__fuPolls,
    };
  }, null, { timeout: 10000 }).then(h => h.jsonValue(), e => ({ h: -1, note: "never mounted and painted: " + e.message }));
  check("toggle meets the 44px touch target", fu.h >= 44, JSON.stringify(fu));
  if (fu.polls > 1) console.log(`  note the card was NOT mounted on first look — ${fu.polls} polls. FIX-047: this is the unattributed trigger; capture what ran here.`);

  await page.click("#permit-modal .pm-followup");
  await page.waitForTimeout(120);
  check("toggle reads pressed after tapping", await page.$eval("#permit-modal .pm-followup", el => el.getAttribute("aria-pressed")) === "true");
  const stateAfter = await page.$eval("#permit-modal .pm-followup", el => el.parentElement.querySelector(".pm-fu-state").textContent.trim());
  check("state text flips too", /Flagged/i.test(stateAfter), stateAfter);
  const said = await page.$eval("#list-action-status", el => el.textContent).catch(() => "");
  check("the announcement names the GC", /BEAR CONSTRUCTION/.test(said), said);

  // ---- badge on the row, visible WITHOUT opening the permit ----
  await page.evaluate(() => closePermitModal());
  await page.waitForTimeout(150);
  const badges = await page.$$eval(".saved-permits-table .fu-badge", els => els.map(e => ({
    text: e.textContent.trim(), title: e.getAttribute("title"), row: e.closest("tr").querySelector("strong").textContent.trim(),
  })));
  check("exactly one row carries a follow-up badge", badges.length === 1, JSON.stringify(badges));
  check("badge carries the words, not just a glyph", /Follow up/.test(badges[0].text), badges[0].text);
  check("badge names the GC in its title", /BEAR CONSTRUCTION/.test(badges[0].title || ""), badges[0].title);
  check("badge is on the flagged permit's row", /101082609/.test(badges[0].row), badges[0].row);

  // ---- the flag survives a rerender, and only one permit has it ----
  check("only the flagged permit reads as flagged", await page.evaluate(() =>
    ["101082609", "B200461632", "100987654"].map(p => isFollowedUp(state.userPermitMap.get(p))).join(",")
  ) === "true,false,false");

  // ---- a permit with no named GC still flags, with generic wording ----
  await page.evaluate(() => openPermitDetail(state.userPermitMap.get("B200461632")));
  await page.waitForSelector("#permit-modal:not([hidden]) .pm-followup", { timeout: 10000 });
  const generic = await page.$eval("#permit-modal .pm-followup", el => el.textContent.trim());
  check("permit with no GC gets generic wording, not 'undefined'", /this permit/i.test(generic) && !/undefined/.test(generic), generic);
  await page.evaluate(() => closePermitModal());
  await page.waitForTimeout(120);

  // ---- filter ----
  const filterVisible = await page.$eval("#list-filters", el => !el.hidden);
  check("filter bar appears once something is flagged", filterVisible);
  // FEAT-052 split the line: the unfiltered tally stays in the filter row
  // (#list-tally), the filtered count moved below the table.
  const status = await page.$eval("#list-tally", el => el.textContent.trim());
  check("filter bar reports the flagged count", /1 flagged/.test(status), status);
  check("filter chip meets a usable target height", await page.$eval("#filter-followup", el => el.getBoundingClientRect().height) >= 32);

  await page.click("#filter-followup");
  await page.waitForTimeout(120);
  const rowsShown = await page.$$eval(".saved-permits-table tbody tr", els => els.map(e => e.querySelector("strong").textContent.trim()));
  check("filter narrows the table to flagged permits", rowsShown.length === 1 && /101082609/.test(rowsShown[0]), JSON.stringify(rowsShown));
  check("filter chip reads pressed", await page.$eval("#filter-followup", el => el.getAttribute("aria-pressed")) === "true");
  const filteredStatus = await page.$eval("#list-filter-status", el => el.textContent.trim());
  check("status says how much is hidden", /1 of 3/.test(filteredStatus), filteredStatus);

  // Filtering is a VIEW filter: exports and routing must still see everything.
  check("filtering does not narrow the underlying list", await page.evaluate(() => userListRows().length) === 3);

  // ---- reorder is locked, and says why ----
  const move = await page.$eval(".saved-permits-table .move-cell button", el => ({
    ariaDisabled: el.getAttribute("aria-disabled"), title: el.getAttribute("title"), label: el.getAttribute("aria-label"),
  }));
  check("move buttons are aria-disabled while filtered", move.ariaDisabled === "true", JSON.stringify(move));
  check("move buttons stay focusable to explain themselves", await page.$eval(".saved-permits-table .move-cell button", el => !el.disabled));
  check("the lock states its reason", /filter/i.test(move.title || "") && /filter/i.test(move.label || ""), JSON.stringify(move));

  await page.click("#filter-followup");
  await page.waitForTimeout(120);
  check("clearing the filter restores every row", (await page.$$(".saved-permits-table tbody tr")).length === 3);
  check("clearing the filter unlocks reorder", await page.$eval(".saved-permits-table .move-cell button", el => el.getAttribute("aria-disabled")) === null);

  // ---- empty state when the filter matches nothing ----
  await page.evaluate(() => { toggleFollowUp(encodeURIComponent("101082609"), false); });
  await page.waitForTimeout(120);
  await page.evaluate(() => { state.listFilters.followUp = true; renderUserList(); });
  await page.waitForTimeout(120);
  const empty = await page.$eval("#user-list", el => el.textContent);
  check("empty filter state explains itself", /flagged for follow-up/i.test(empty), empty.slice(0, 140));
  check("empty filter state offers a way back", !!(await page.$("#user-list .linkish")));
  await page.click("#user-list .linkish");
  await page.waitForTimeout(150);
  check("the way back works", (await page.$$(".saved-permits-table tbody tr")).length === 3);
  check("filter bar hides again once nothing is flagged and no filter is on", await page.$eval("#list-filters", el => el.hidden));

  // ---- shared list: the flag syncs like a visited tick ----
  await page.evaluate(() => { state.lists.L.sharedId = "SHARED1"; });
  await page.evaluate(() => { toggleFollowUp(encodeURIComponent("100987654"), true); });
  await page.waitForTimeout(1200); // the flag queue debounces at 800ms
  check("a flag on a shared list PUTs to /follow", puts.length === 1, JSON.stringify(puts));
  if (puts.length) {
    check("the PUT targets the shared id", /\/api\/lists\/SHARED1\/follow$/.test(puts[0].url), puts[0].url);
    check("the PUT carries the key and the on flag", puts[0].body.key === "100987654" && puts[0].body.on === true, JSON.stringify(puts[0].body));
  }

  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.evaluate(() => renderUserList());
  await page.waitForTimeout(100);
  check("no page errors", errs.length === 0, JSON.stringify(errs));

  if (failures > failuresAtStart) {
    const path = `verify-tmp/_t44-trace-${label.replace(/\W+/g, "-")}.zip`;
    await page.context().tracing.stop({ path });
    console.log(`  ->   trace saved: ${path}  (npx playwright show-trace ${path})`);
  } else {
    await page.context().tracing.stop();
  }
  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "desktop 1280x900");
  await run({ width: 390, height: 844 }, "iPhone 13 390x844");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
