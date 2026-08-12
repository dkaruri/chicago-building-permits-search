const { chromium, CHROME, openList } = require("./_boot");
const ROW = { permit_number: "100991233", permit_type: "X", permit_status: "ACTIVE", issue_date: "d",
  address: "a", community_area: "c", review_type: "r", work_type: "w", processing_time: "1",
  work_description: "", reported_cost: "1", total_fee: "1", general_contractors: "", open_subs: "" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage(); await openList(page);
  // Pre-existing note must be shown and preserved.
  await page.evaluate(() => { state.userPermitNotes["100991233"] = "call Monday"; });
  await page.evaluate(row => openPermitDetail(row), ROW);
  const shown = await page.evaluate(() => document.querySelector("#permit-modal-body .pm-note").value);
  await page.evaluate(() => {
    const ta = document.querySelector("#permit-modal-body .pm-note");
    ta.value = "call Monday + email"; ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const stored = await page.evaluate(() => {
    return { state: state.userPermitNotes["100991233"],
      ls: JSON.parse(localStorage.getItem("chi_permit_user_notes")).permits["100991233"] };
  });
  const ok = shown === "call Monday" && stored.state === "call Monday + email" && stored.ls === "call Monday + email";
  console.log(ok ? "PASS" : "FAIL", JSON.stringify({ shown, stored }));
  await b.close(); process.exit(ok ? 0 : 1);
})();
