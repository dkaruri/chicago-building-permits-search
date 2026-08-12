// FEAT-044 against PRODUCTION — the real Pages build talking to the real
// Worker. No mocks: this is the only check that proves the deployed client and
// the deployed Worker agree with each other and with Socrata.
// Reaches the live network, so retry before believing a failure.
const { chromium, CHROME } = require("./_boot.js");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext()).newPage();
  const seen = [];
  page.on("request", r => {
    if (r.url().includes("/api/permits")) seen.push(new URL(r.url()).searchParams);
  });

  await page.goto("https://dkaruri.github.io/chicago-building-permits-search/");
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 });
  await page.evaluate(async () => { setMode("open_permits"); await search(); });
  await page.waitForSelector(".permits-table tbody tr", { timeout: 45000 });

  const count = (await page.locator("#result-count").textContent()).trim();
  const pager = (await page.locator("#pager").textContent()).replace(/\s+/g, " ").trim();
  console.log(`   count: ${count}\n   pager: ${pager}`);

  const total = await page.evaluate(() => state.permitTotal);
  check("the client learned the real total from the live Worker", total > 30000, `total=${total}`);
  check("the pager spans the whole set, not 7 pages",
    /of ([2-9]\d\d|\d{4,})/.test(pager), pager);
  check("the client asked for one page, not a 1000-row prefix",
    seen.length > 0 && seen[0].get("limit") === "150", seen[0] && seen[0].toString());

  // Cross-check the total against Socrata directly — the client, the Worker and
  // the source must all agree, or the pager is confidently wrong.
  const truth = await page.evaluate(async () => {
    const u = "https://data.cityofchicago.org/resource/ydr8-5enu.json?$select=count(1)"
      + "&$where=" + encodeURIComponent("permit_status in('ACTIVE','SUSPENDED','PHASED PERMITTING')");
    return parseInt((await (await fetch(u)).json())[0].count_1, 10);
  });
  check("the total matches Socrata's own count", Math.abs(total - truth) <= 50,
    `client ${total} vs socrata ${truth}`);

  // Page 2 must be real permits the first page did not contain.
  const first = await page.evaluate(() => state.filteredRows.map(r => r.permit_number));
  await page.evaluate(() => changePage(1));
  await page.waitForFunction(prev => state.filteredRows[0]?.permit_number !== prev,
    first[0], { timeout: 45000 });
  const second = await page.evaluate(() => state.filteredRows.map(r => r.permit_number));
  check("page 2 is 150 permits none of which were on page 1",
    second.length === 150 && !second.some(p => first.includes(p)),
    `${first[0]} -> ${second[0]}`);

  // Cost DESC must open on real money, not on the 3,646 null-cost permits.
  await page.evaluate(async () => { await setResultSort("cost"); });
  await page.waitForTimeout(2500);
  await page.evaluate(async () => { await setResultSort("cost"); }); // asc -> desc
  await page.waitForTimeout(2500);
  const costs = await page.evaluate(() => state.filteredRows.slice(0, 5).map(r => r.reported_cost));
  check("Cost-descending opens on the most expensive permits, not on NULLs",
    costs[0] != null && costs[0] > 1e6 && costs.every((c, i) => i === 0 || c <= costs[i - 1]),
    JSON.stringify(costs));

  // Profiles: the directory that was capped at 5,000.
  await page.evaluate(async () => { setMode("general_contractors"); await search(); });
  await page.waitForTimeout(4000);
  const gcTotal = await page.evaluate(() => state.filteredRows.length);
  check("the contractor directory is no longer cut at 5,000", gcTotal > 5000, `${gcTotal} rows`);

  await page.screenshot({ path: "verify-tmp/t67-live.png" });
  await browser.close();
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
