const { chromium, CHROME } = require("./_boot");
const ROW = { permit_number: "888", permit_type: "PERMIT - RENOVATION/ALTERATION", permit_status: "ACTIVE",
  issue_date: "2026-06-01", address: "2500 N Milwaukee Ave", community_area: "Logan Square",
  review_type: "Standard Plan Review", work_type: "Interior alteration", processing_time: "34",
  work_description: "RENOVATION OF EXISTING 3-UNIT BUILDING", reported_cost: "248500", total_fee: "3412",
  latitude: "41.928", longitude: "-87.71", general_contractors: "Halsted Building Group LLC", open_subs: "" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage();
  await page.route("**/api/contact/**", r => r.fulfill({ json: {
    open_jobs: 4,
    work_types: [{ work_type: "Reroofing", jobs: 9 }, { work_type: "Masonry Work", jobs: 4 }, { work_type: "Siding", jobs: 2 }, { work_type: "Fence", jobs: 1 }],
    license_matches: [{ license_type: "General Contractor (Class E)", phone: "(312) 555-0142" }],
  }}));
  await page.route("**/data.cityofchicago.org/resource/dj47-wfun.json**", r => r.fulfill({ json: [{ zone_class: "B3-2" }] }));
  await page.route("**/data.cityofchicago.org/resource/eejr-xtfb.json**", r => r.fulfill({ json: [{ name: "Fullerton/Milwaukee", ref: "T-071", expiration: "2033-12-31" }] }));
  await page.goto("http://localhost:8791/index.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  await page.evaluate(row => showPermitDetail(row), ROW);
  await page.waitForFunction(() => /Class E/.test((document.getElementById("permit-modal-body")||{}).innerText||""), { timeout: 6000 });
  const t = await page.evaluate(() => {
    const body = document.getElementById("permit-modal-body");
    const txt = body.innerText;
    return {
      visible: !document.getElementById("permit-modal").hidden,
      heads: [...body.querySelectorAll("h3")].map(h => h.textContent.trim()),
      permitNo: /888/.test(txt), neighborhood: /Neighborhood/.test(txt) && /Logan Square/.test(txt),
      buildingType: /Building type/.test(txt) && /3-Unit/.test(txt), approx: !!body.querySelector(".approx"),
      zone: /B3-2/.test(txt), tif: /Fullerton\/Milwaukee/.test(txt),
      licClass: /General Contractor/.test(txt) && /Class E/.test(txt),
      does: /Reroofing/.test(txt) && /Masonry Work/.test(txt) && !/Fence/.test(txt),
      jobs: /4 open jobs/.test(txt), phone: !!body.querySelector('a[href^="tel:"]'),
      note: !!body.querySelector(".pm-note"),
    };
  });
  const need = ["Location","Permit details","Work description","Costs & fees","General contractors","Open subs","Notes"];
  const ok = t.visible && need.every(h => t.heads.includes(h)) && t.permitNo && t.neighborhood &&
    t.buildingType && t.approx && t.zone && t.tif && t.licClass && t.does && t.jobs && t.phone && t.note;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(t));
  await b.close(); process.exit(ok ? 0 : 1);
})();
