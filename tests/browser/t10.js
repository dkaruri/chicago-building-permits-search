const { chromium, CHROME, openList } = require("./_boot");
const ROW = { permit_number: "999", permit_type: "X", permit_status: "ACTIVE", issue_date: "d",
  address: "a", community_area: "Loop", review_type: "r", work_type: "w", processing_time: "1",
  work_description: "", reported_cost: "1", total_fee: "1", general_contractors: "", open_subs: "" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  for (const theme of ["light", "dark"]) {
    const page = await b.newPage();
    await page.emulateMedia({ colorScheme: theme });
    await openList(page);
    await page.evaluate(row => openPermitDetail(row), ROW);
    const a = await page.evaluate(() => {
      const card = document.querySelector("#permit-modal [role='dialog']");
      return { modal: card.getAttribute("aria-modal") === "true",
        labelled: !!document.getElementById(card.getAttribute("aria-labelledby")),
        closeName: !!document.querySelector('.pm-close[aria-label]') };
    });
    if (!a.modal || !a.labelled || !a.closeName) { console.log("FAIL", theme, JSON.stringify(a)); await b.close(); process.exit(1); }
    await page.locator("#permit-modal .permit-modal-card").screenshot({ path: `verify-tmp/modal-${theme}.png` });
    await page.close();
  }
  console.log("PASS (see verify-tmp/modal-light.png, modal-dark.png)");
  await b.close();
})();
