// FIX-046 step 1: reproduce. A list built on My Permit List (cap 1000) is then
// opened on Search and the Permit Map (cap 220). What actually happens?
const { chromium, CHROME } = require("./_boot.js");

const N = 400;
const PERMITS = Array.from({ length: N }, (_, i) => `L${String(i).padStart(4, "0")}`);

async function open(page, file) {
  await page.route("**/api/stats*", r => r.fulfill({ json: { row_count: 40868 } }));
  await page.route("**/api/permits*", r => r.fulfill({ json: { rows: [], row_count: 0, total: 0, offset: 0, limit: 150 } }));
  await page.route("**/api/profiles*", r => r.fulfill({ json: { rows: [], total: 0 } }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ json: [] }));
  await page.goto(`http://localhost:8791/${file}`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 40000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Build the list on list.html, the page whose cap is 1000.
  await open(page, "list.html");
  const built = await page.evaluate(async permits => {
    state.lists = { L: { name: "Big", permits: permits.slice(), focal: null, sharedId: null } };
    state.activeListId = "L";
    state.userPermitNumbers = permits.slice();
    saveUserListCookie();           // goes through the cap + backstop
    return { cap: userListLimit, stored: (JSON.parse(localStorage.getItem("chi_permit_lists")).lists.L.permits || []).length };
  }, PERMITS);
  console.log(`list.html   cap=${built.cap}  stored ${built.stored} of ${N}`);

  for (const file of ["index.html", "map.html"]) {
    const p = await ctx.newPage();   // same origin, same localStorage
    await open(p, file);
    const seen = await p.evaluate(() => ({
      cap: userListLimit,
      inStorage: (JSON.parse(localStorage.getItem("chi_permit_lists")).lists.L.permits || []).length,
      inState: (state.lists.L ? state.lists.L.permits.length : -1),
    }));
    console.log(`${file.padEnd(11)} cap=${seen.cap}  storage ${seen.inStorage}  state ${seen.inState}`);

    // Now do what a user would: add one permit from this page.
    const after = await p.evaluate(async () => {
      state.activeListId = "L";
      state.userPermitNumbers = [...state.lists.L.permits];
      const mk = n => ({ permit_number: n, permit_type: "P", permit_status: "ACTIVE", issue_date: "2026-01-01",
        address: `${n} W`, ward: "1", reported_cost: 1, work_type: "R", work_description: "w",
        latitude: 41.9, longitude: -87.7, general_contractors: "", open_subs: "", contacts: [] });
      await addPermitsToUserList([mk("NEWONE")], { listId: "L" });
      return {
        len: state.userPermitNumbers.length,
        hasNew: state.userPermitNumbers.includes("NEWONE"),
        firstStillThere: state.userPermitNumbers.includes("L0000"),
        lastStillThere: state.userPermitNumbers.includes(`L${String(399).padStart(4, "0")}`),
        stored: (JSON.parse(localStorage.getItem("chi_permit_lists")).lists.L.permits || []).length,
        msg: (document.getElementById("user-route-summary") || {}).textContent || "",
      };
    });
    console.log(`   after adding 1 from ${file}: list=${after.len}, stored=${after.stored}, new added=${after.hasNew}, oldest kept=${after.lastStillThere}`);
    console.log(`   message: ${after.msg.trim().slice(0, 100)}`);
    await p.close();
  }

  await browser.close();
})();
