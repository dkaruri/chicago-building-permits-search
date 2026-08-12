const { chromium, CHROME, openList } = require("./_boot");
const SAMPLE_ROW = { permit_number: "100991233", permit_type: "PERMIT - RENOVATION/ALTERATION",
  permit_status: "ACTIVE", issue_date: "2026-06-01", address: "2500 N Milwaukee Ave",
  community_area: "Logan Square", review_type: "Standard Plan Review", work_type: "Interior alteration",
  processing_time: "34", work_description: "RENOVATION OF EXISTING 4-UNIT RESIDENTIAL BUILDING",
  reported_cost: "248500", total_fee: "3412", general_contractors: "Halsted Building Group LLC",
  open_subs: "Sparkline Electric Inc" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage(); await openList(page);
  await page.evaluate(row => openPermitDetail(row), SAMPLE_ROW);
  const t = await page.evaluate(() => {
    const body = document.getElementById("permit-modal-body");
    const text = body.innerText;
    return {
      heads: [...body.querySelectorAll("h3")].map(h => h.textContent.trim()),
      hasPermitNo: text.includes("100991233"),
      hasNeighborhood: /Neighborhood/.test(text) && /Logan Square/.test(text),
      hasBuildingType: /Building type/.test(text) && /4-Unit/.test(text),
      hasApprox: !!body.querySelector(".approx"),
      hasTotalFee: /Total fee/.test(text),
      notes: !!body.querySelector("textarea.pm-note"),
    };
  });
  const need = ["Location","Permit details","Work description","Costs & fees","General contractors","Open subs","Notes"];
  const ok = need.every(h => t.heads.includes(h)) && t.hasPermitNo && t.hasNeighborhood &&
             t.hasBuildingType && t.hasApprox && t.hasTotalFee && t.notes;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(t));
  await b.close(); process.exit(ok ? 0 : 1);
})();
