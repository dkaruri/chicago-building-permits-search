// t6: tapping a row in the saved list opens that permit's detail view, and the
// old per-row "more" dropdown is gone (it was replaced by the overlay).
//
// Was red on main since the multi-list + directory rework: it seeded only
// userPermitNumbers/userPermitMap and rendered while the DIRECTORY view was
// showing, so the rows existed but were `hidden` and waitForSelector timed out
// on a page that was working. Seeding now goes through _boot's shared helper.
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const ROW = {
  permit_number: "100991233", permit_type: "PERMIT - RENOVATION/ALTERATION",
  permit_status: "ACTIVE", issue_date: "2026-06-01", address: "2500 N Milwaukee Ave",
  community_area: "Logan Square", review_type: "R", work_type: "W", processing_time: "34",
  work_description: "4-UNIT", reported_cost: "1", total_fee: "1",
  general_contractors: "", open_subs: "",
};

(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage();
  await openList(page);
  await seedSavedList(page, [ROW]);

  const noDropdown = await page.evaluate(() => !document.querySelector(".permit-more-toggle"));
  await page.click(".saved-permits-table tbody tr");
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() =>
    !document.getElementById("permit-modal").hidden &&
    /100991233/.test(document.getElementById("permit-modal-body").innerText));

  const ok = noDropdown && opened;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify({ noDropdown, opened }));
  await b.close();
  process.exit(ok ? 0 : 1);
})();
