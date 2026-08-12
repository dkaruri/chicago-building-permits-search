const { chromium, CHROME, openList } = require("./_boot");
const SAMPLE_ROW = { permit_number: "100991233", permit_type: "X", permit_status: "ACTIVE",
  issue_date: "2026-06-01", address: "2500 N Milwaukee Ave", community_area: "Logan Square",
  review_type: "R", work_type: "W", processing_time: "34", work_description: "4-UNIT",
  reported_cost: "1", total_fee: "1", general_contractors: "Halsted Building Group LLC", open_subs: "" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage();
  await page.route("**/api/contact/**", r => r.fulfill({ json: {
    open_jobs: 4,
    work_types: [{ work_type: "Nonstructural Interior Work", jobs: 9 }, { work_type: "Reroofing", jobs: 4 }, { work_type: "Masonry Work", jobs: 2 }, { work_type: "Fence", jobs: 1 }],
    license_matches: [{ license_type: "General Contractor (Class E)", phone: "(312) 555-0142" }],
  }}));
  await openList(page);
  await page.evaluate(row => openPermitDetail(row), SAMPLE_ROW);
  await page.waitForFunction(() => /Class E/.test(document.getElementById("permit-modal-body").innerText), { timeout: 5000 });
  const t = await page.evaluate(() => {
    const txt = document.getElementById("permit-modal-body").innerText;
    return { licType: /General Contractor/.test(txt), cls: /Class E/.test(txt),
      does: /Nonstructural Interior Work/.test(txt) && /Masonry Work/.test(txt),
      onlyThree: !/Fence/.test(txt), jobs: /4 open jobs/.test(txt),
      phone: !!document.querySelector('#permit-modal-body a[href^="tel:"]') };
  });
  const ok = t.licType && t.cls && t.does && t.onlyThree && t.jobs && t.phone;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(t));
  await b.close(); process.exit(ok ? 0 : 1);
})();
