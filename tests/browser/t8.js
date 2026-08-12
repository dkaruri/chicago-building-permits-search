const { chromium, CHROME, openList } = require("./_boot");
const ROW = { permit_number: "777", permit_type: "X", permit_status: "ACTIVE", issue_date: "d",
  address: "a", community_area: "Loop", review_type: "r", work_type: "w", processing_time: "1",
  work_description: "", reported_cost: "1", total_fee: "1", general_contractors: "", open_subs: "" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage(); await openList(page);
  await page.evaluate(row => showPermitDetail(row), ROW);
  const ok = await page.evaluate(() => !document.getElementById("permit-modal").hidden &&
    /777/.test(document.getElementById("permit-modal-body").innerText) &&
    /Neighborhood/.test(document.getElementById("permit-modal-body").innerText));
  console.log(ok ? "PASS" : "FAIL");
  await b.close(); process.exit(ok ? 0 : 1);
})();
