// Repro probe for FIX-003: does a tap inside the Remove cell but OFF the button
// fall through to the row's open handler?
const { devices } = require("playwright");
const { chromium, CHROME, openList, seedSavedList } = require("./_boot.js");

const ROWS = [1, 2, 3].map(i => ({
  permit_number: `10000${i}`, permit_type: "PERMIT - RENOVATION", permit_status: "ACTIVE",
  issue_date: "2026-01-0" + i, address: `${i}00 W TEST ST`, ward: "1",
  reported_cost: 1000 * i, work_type: "RENOVATION", latitude: 41.9, longitude: -87.7
}));

async function run(name, ctxOpts) {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await openList(page);
  await seedSavedList(page, ROWS);

  const geo = await page.evaluate(() => {
    const td = document.querySelector('.saved-permits-table tbody tr td[data-label="Remove"]');
    const btn = td.querySelector("button");
    const t = td.getBoundingClientRect(), b = btn.getBoundingClientRect();
    return { td: { x: t.x, y: t.y, w: t.width, h: t.height }, btn: { x: b.x, y: b.y, w: b.width, h: b.height } };
  });
  console.log(`[${name}] td`, geo.td, "btn", geo.btn);

  // A point inside the cell but outside the button, if one exists.
  const pts = [];
  if (geo.btn.y - geo.td.y > 2) pts.push(["above button", geo.btn.x + geo.btn.w / 2, geo.td.y + 1]);
  if (geo.td.y + geo.td.h - (geo.btn.y + geo.btn.h) > 2) pts.push(["below button", geo.btn.x + geo.btn.w / 2, geo.td.y + geo.td.h - 1]);
  if (geo.btn.x - geo.td.x > 2) pts.push(["left of button", geo.td.x + 1, geo.btn.y + geo.btn.h / 2]);
  if (geo.td.x + geo.td.w - (geo.btn.x + geo.btn.w) > 2) pts.push(["right of button", geo.td.x + geo.td.w - 1, geo.btn.y + geo.btn.h / 2]);

  if (!pts.length) console.log(`[${name}] no dead zone inside the Remove cell`);
  for (const [label, x, y] of pts) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(400);
    const opened = await page.evaluate(() => !!document.querySelector(".permit-modal:not([hidden]), #permit-modal:not([hidden])"));
    const cardOpen = await page.evaluate(() => { try { return !!activeCard(); } catch { return "n/a"; } });
    console.log(`[${name}] click ${label} -> card open: ${cardOpen}, modal: ${opened}`);
    await page.evaluate(() => { try { closePermitModal(); } catch {} });
    await page.waitForTimeout(200);
  }
  await browser.close();
}

(async () => {
  await run("desktop", {});
  await run("iPhone13", { ...devices["iPhone 13"] });
})();
