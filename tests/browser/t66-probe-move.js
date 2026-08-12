// Same root cause, different control: do the up/down reorder buttons work on a
// hand-typed stop? They also take enc(row.permit_number), which is "" for one.
const { chromium, CHROME, openList } = require("./_boot.js");
const ROWS = [1, 2].map(i => ({
  permit_number: `10000${i}`, permit_type: "P", permit_status: "ACTIVE", issue_date: `2026-01-0${i}`,
  address: `${i}00 W TEST ST`, ward: "1", reported_cost: 1000, work_type: "R", latitude: 41.9, longitude: -87.7
}));
const CUSTOM = { id: "c_test1", pos: 2, addr: "999 N HAND TYPED AVE", lat: 41.91, lon: -87.71, use: "residential", work: "siding", gc: "" };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await openList(page);
  await page.evaluate(async ({ rows, c }) => {
    state.userPermitMap = new Map(rows.map(r => [r.permit_number, r]));
    state.lists = { L: { name: "T", permits: rows.map(r => r.permit_number), focal: null, sharedId: null, custom: [c] } };
    await showList("L");
  }, { rows: ROWS, c: CUSTOM });
  await page.waitForSelector(".saved-permits-table tbody tr");

  const order = () => page.evaluate(() => Array.from(document.querySelectorAll('.saved-permits-table tbody tr td[data-label="Address"]')).map(n => n.textContent.trim().slice(0, 12)));
  console.log("before:", await order());
  const custom = await page.evaluate(() => Array.from(document.querySelectorAll(".saved-permits-table tbody tr")).findIndex(tr => tr.textContent.includes("HAND TYPED")));
  await page.locator(`.saved-permits-table tbody tr:nth-child(${custom + 1}) td.move-cell button`).first().click();
  await page.waitForTimeout(600);
  console.log("after up:", await order());
  console.log("page errors:", errors.length ? errors : "none");
  await browser.close();
})();
