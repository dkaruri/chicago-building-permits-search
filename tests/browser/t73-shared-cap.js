// FIX-046 — the three pages share one stored list, so they must share one cap.
//
// The failure this guards is not "a confusing refusal". Measured before the
// fix: a 400-permit list built on My Permit List was cut to 220 by merely
// OPENING the Permit Map — 180 permits destroyed with no user action at all.
// So the load-does-not-mutate check below is the important one.
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot.js");

const N = 400;
const PERMITS = Array.from({ length: N }, (_, i) => `L${String(i).padStart(4, "0")}`);
const PAGES = ["index.html", "map.html", "list.html"];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

async function open(page, file) {
  await page.route("**/api/stats*", r => r.fulfill({ json: { row_count: 40868 } }));
  await page.route("**/api/permits*", r => r.fulfill({ json: { rows: [], row_count: 0, total: 0, offset: 0, limit: 150 } }));
  await page.route("**/api/profiles*", r => r.fulfill({ json: { rows: [], total: 0 } }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ json: [] }));
  await page.goto(`http://localhost:8791/${file}`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 40000 });
  await page.waitForTimeout(800);
}

const stored = page => page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("chi_permit_lists") || "{}");
  return ((raw.lists || {}).L || {}).permits || [];
});

const seedStorage = permits => {
  localStorage.setItem("chi_permit_lists", JSON.stringify({
    lastUsed: "L", lists: { L: { name: "Big", permits, focal: null, sharedId: null } },
  }));
};

async function run(label, ctxOpts) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext(ctxOpts);

  // --- 1. every page agrees on the cap ------------------------------------
  const caps = {};
  for (const file of PAGES) {
    const p = await ctx.newPage();
    await p.addInitScript(seedStorage, PERMITS);
    await open(p, file);
    caps[file] = await p.evaluate(() => userListLimit);
    await p.close();
  }
  check("the three pages agree on the cap",
    new Set(Object.values(caps)).size === 1, JSON.stringify(caps));

  // --- 2. merely LOADING a page must not change the stored list -----------
  // This is the regression that destroyed 180 permits with no user action.
  for (const file of PAGES) {
    const p = await ctx.newPage();
    await p.addInitScript(seedStorage, PERMITS);
    await open(p, file);
    const after = await stored(p);
    check(`opening ${file} leaves all ${N} saved permits untouched`,
      after.length === N && after.includes("L0000") && after.includes("L0399"),
      `${after.length} of ${N} survived`);
    await p.close();
  }

  // --- 3. adding from any page keeps everything and lands the new one -----
  for (const file of ["index.html", "map.html"]) {
    const p = await ctx.newPage();
    await p.addInitScript(seedStorage, PERMITS);
    await open(p, file);
    await p.evaluate(async () => {
      state.activeListId = "L";
      state.userPermitNumbers = [...state.lists.L.permits];
      const mk = n => ({ permit_number: n, permit_type: "P", permit_status: "ACTIVE", issue_date: "2026-01-01",
        address: `${n} W`, ward: "1", reported_cost: 1, work_type: "R", work_description: "w",
        latitude: 41.9, longitude: -87.7, general_contractors: "", open_subs: "", contacts: [] });
      await addPermitsToUserList([mk("BRANDNEW")], { listId: "L" });
    });
    await p.waitForTimeout(700);
    const after = await stored(p);
    check(`adding from ${file} to a ${N}-permit list keeps every one and lands the new permit`,
      after.length === N + 1 && after.includes("BRANDNEW") && PERMITS.every(n => after.includes(n)),
      `${after.length} permits, ${PERMITS.filter(n => !after.includes(n)).length} lost`);
    await p.close();
  }

  // --- 4. a list AT the shared cap refuses identically on all three -------
  const full = Array.from({ length: caps["list.html"] }, (_, i) => `F${String(i).padStart(4, "0")}`);
  for (const file of PAGES) {
    const p = await ctx.newPage();
    await p.addInitScript(seedStorage, full);
    await open(p, file);
    const res = await p.evaluate(async () => {
      state.activeListId = "L";
      state.userPermitNumbers = [...state.lists.L.permits];
      const before = state.userPermitNumbers.length;
      const mk = n => ({ permit_number: n, permit_type: "P", permit_status: "ACTIVE", issue_date: "2026-01-01",
        address: `${n} W`, ward: "1", reported_cost: 1, work_type: "R", work_description: "w",
        latitude: 41.9, longitude: -87.7, general_contractors: "", open_subs: "", contacts: [] });
      await addPermitsToUserList([mk("OVERFLOW")], { listId: "L" });
      return { before, after: state.userPermitNumbers.length, landed: state.userPermitNumbers.includes("OVERFLOW") };
    });
    await p.waitForTimeout(500);
    const s = await stored(p);
    check(`${file}: a full list refuses the add and loses nothing`,
      res.after === res.before && !res.landed && s.length === full.length,
      `${res.before} -> ${res.after}, stored ${s.length}`);
    await p.close();
  }

  // --- 5. a stored list ALREADY ABOVE the cap must not be trimmed ---------
  // This is what makes the save-path trim reachable: a list that grew under an
  // older/larger cap, or arrived from a shared list. Trimming it would delete
  // real permits at load, which is precisely the 400 -> 220 failure this card
  // is about, just with different numbers. A save must never destroy.
  const over = Array.from({ length: caps["list.html"] + 200 }, (_, i) => `X${String(i).padStart(4, "0")}`);
  for (const file of PAGES) {
    const p = await ctx.newPage();
    await p.addInitScript(seedStorage, over);
    await open(p, file);
    // Touch the list the way any ordinary interaction does.
    await p.evaluate(() => { state.activeListId = "L"; state.userPermitNumbers = [...state.lists.L.permits]; saveUserListCookie(); });
    await p.waitForTimeout(400);
    const after = await stored(p);
    check(`${file}: an over-cap stored list survives being opened and saved`,
      after.length === over.length && after.includes("X0000") && after.includes(over.at(-1)),
      `${after.length} of ${over.length} survived`);
    await p.close();
  }

  await browser.close();
}

(async () => {
  await run("desktop", {});
  await run("iPhone13", { ...devices["iPhone 13"] });
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
