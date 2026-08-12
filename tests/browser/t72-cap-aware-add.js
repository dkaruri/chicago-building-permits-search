// FIX-037 — adding to a FULL list must never delete what is already saved.
//
// The bug: new permits were unshifted onto the head and the array sliced back
// to the cap, which trims the TAIL — the permits saved longest. Adding 40 to a
// full list destroyed 40 older ones with no warning, count or undo.
//
// Every assertion here checks the SURVIVORS, not just the length: a list that
// is still exactly `cap` long can have had its oldest silently replaced.
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot.js");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

const permit = n => ({
  permit_number: n, permit_type: "PERMIT - RENOVATION", permit_status: "ACTIVE",
  issue_date: "2026-01-01", address: `${n} W TEST ST`, ward: "1", reported_cost: 1000,
  work_type: "RENOVATION", work_description: "w", latitude: 41.9, longitude: -87.7,
  general_contractors: "ACME", open_subs: "", contacts: [],
});

async function open(page, file) {
  await page.route("**/api/stats*", r => r.fulfill({ json: { row_count: 40868 } }));
  await page.route("**/api/permits*", r => r.fulfill({ json: { rows: [], row_count: 0, total: 0, offset: 0, limit: 150 } }));
  await page.route("**/api/profiles*", r => r.fulfill({ json: { rows: [], total: 0 } }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ json: [] }));
  await page.goto(`http://localhost:8791/${file}`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 40000 });
}

/** Fill the active list to exactly `cap` permits named OLD000.. */
const fillToCap = page => page.evaluate(() => {
  const cap = userListLimit;
  const olds = Array.from({ length: cap }, (_, i) => `OLD${String(i).padStart(4, "0")}`);
  state.lists = { L: { name: "Full", permits: olds.slice(), focal: null, sharedId: null } };
  state.activeListId = "L";
  state.userPermitNumbers = olds.slice();
  saveUserLists();
  return { cap, first: olds[0], last: olds[cap - 1] };
});

const numbers = page => page.evaluate(() => state.userPermitNumbers.slice());

async function run(file, label, ctxOpts) {
  console.log(`\n=== ${file} @ ${label} ===`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext(ctxOpts)).newPage();
  page.on("dialog", d => d.accept());
  await open(page, file);

  // --- 1. bulk add to a FULL list -----------------------------------------
  const { cap, first, last } = await fillToCap(page);
  const before = await numbers(page);
  await page.evaluate(async () => {
    const mk = n => ({ permit_number: n, permit_type: "P", permit_status: "ACTIVE", issue_date: "2026-01-01",
      address: `${n} W TEST ST`, ward: "1", reported_cost: 1000, work_type: "R", work_description: "w",
      latitude: 41.9, longitude: -87.7, general_contractors: "ACME", open_subs: "", contacts: [] });
    const rows = Array.from({ length: 40 }, (_, i) => mk(`NEW${String(i).padStart(3, "0")}`));
    await addPermitsToUserList(rows, { listId: "L" });
  });
  await page.waitForTimeout(600);
  const after = await numbers(page);
  check("a full list stays at the cap", after.length === cap, `${after.length} vs cap ${cap}`);
  check("NOT ONE previously saved permit was deleted",
    before.every(n => after.includes(n)),
    `${before.filter(n => !after.includes(n)).length} lost, e.g. ${before.filter(n => !after.includes(n)).slice(0, 3).join(",")}`);
  check("the oldest saved permit is still there", after.includes(last), `looking for ${last}`);
  check("nothing new was added to a full list", !after.some(n => n.startsWith("NEW")));
  const msg = await page.locator("#user-route-summary").textContent();
  check("the refusal is reported to the user", /could not be added|full at/i.test(msg), msg.trim().slice(0, 90));

  // --- 2. single add to a FULL list ---------------------------------------
  await fillToCap(page);
  const before2 = await numbers(page);
  await page.evaluate(async () => {
    state.userPermitMap.set("SOLO1", { permit_number: "SOLO1", address: "1 SOLO ST", latitude: 41.9, longitude: -87.7 });
    await addPermitNumberToUserList("SOLO1");
  });
  await page.waitForTimeout(500);
  const after2 = await numbers(page);
  check("a single add to a full list deletes nothing",
    after2.length === cap && before2.every(n => after2.includes(n)),
    `${after2.length} long, ${before2.filter(n => !after2.includes(n)).length} lost`);
  check("the single refusal is reported",
    /full at/i.test(await page.locator("#user-route-summary").textContent()));

  // --- 3. CONTROL: repositioning on a full list must still work ------------
  await fillToCap(page);
  const b3 = await numbers(page);
  await page.evaluate(async () => {
    state.userPermitMap.set(state.userPermitNumbers.at(-1), { permit_number: state.userPermitNumbers.at(-1), address: "x", latitude: 41.9, longitude: -87.7 });
    await addPermitNumberToUserList(state.userPermitNumbers.at(-1), state.userPermitNumbers[0], "before");
  });
  await page.waitForTimeout(500);
  const a3 = await numbers(page);
  check("CONTROL: a full list can still be REORDERED by drag-and-drop",
    a3.length === cap && a3[0] === b3.at(-1) && b3.every(n => a3.includes(n)),
    `head is now ${a3[0]}, was ${b3[0]}`);

  // --- 4. CONTROL: a list with room still adds normally --------------------
  await page.evaluate(() => {
    state.lists = { L: { name: "Roomy", permits: ["KEEP1", "KEEP2"], focal: null, sharedId: null } };
    state.activeListId = "L"; state.userPermitNumbers = ["KEEP1", "KEEP2"]; saveUserLists();
  });
  await page.evaluate(async () => {
    const mk = n => ({ permit_number: n, permit_type: "P", permit_status: "ACTIVE", issue_date: "2026-01-01",
      address: `${n} W`, ward: "1", reported_cost: 1, work_type: "R", work_description: "w",
      latitude: 41.9, longitude: -87.7, general_contractors: "", open_subs: "", contacts: [] });
    await addPermitsToUserList([mk("ADD1"), mk("ADD2")], { listId: "L" });
  });
  await page.waitForTimeout(600);
  const a4 = await numbers(page);
  check("CONTROL: a list with room adds normally and keeps the old ones",
    a4.length === 4 && a4.includes("KEEP1") && a4.includes("KEEP2") && a4.includes("ADD1"), a4.join(","));

  // --- 5. partial fit: fills the remaining room, refuses the rest ----------
  await page.evaluate(() => {
    const cap = userListLimit;
    const olds = Array.from({ length: cap - 3 }, (_, i) => `P${String(i).padStart(4, "0")}`);
    state.lists = { L: { name: "Nearly", permits: olds.slice(), focal: null, sharedId: null } };
    state.activeListId = "L"; state.userPermitNumbers = olds.slice(); saveUserLists();
  });
  const b5 = await numbers(page);
  await page.evaluate(async () => {
    const mk = n => ({ permit_number: n, permit_type: "P", permit_status: "ACTIVE", issue_date: "2026-01-01",
      address: `${n} W`, ward: "1", reported_cost: 1, work_type: "R", work_description: "w",
      latitude: 41.9, longitude: -87.7, general_contractors: "", open_subs: "", contacts: [] });
    await addPermitsToUserList(Array.from({ length: 10 }, (_, i) => mk(`FIT${i}`)), { listId: "L" });
  });
  await page.waitForTimeout(600);
  const a5 = await numbers(page);
  const fitted = a5.filter(n => n.startsWith("FIT")).length;
  check("a partial add fills exactly the remaining room",
    a5.length === cap && fitted === 3, `${fitted} of 10 fitted, list ${a5.length}`);
  check("the partial add loses nothing that was already saved",
    b5.every(n => a5.includes(n)), `${b5.filter(n => !a5.includes(n)).length} lost`);
  check("the partial refusal is counted honestly",
    /7 could not be added/i.test(await page.locator("#user-route-summary").textContent()),
    (await page.locator("#user-route-summary").textContent()).trim().slice(0, 90));

  await browser.close();
}

(async () => {
  for (const file of ["index.html", "map.html"]) {
    await run(file, "desktop", {});
    await run(file, "iPhone13", { ...devices["iPhone 13"] });
  }
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
