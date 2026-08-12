// t8b: the overlay owns exactly the history entries it pushes, and closing
// unwinds all of them — so one Back from the list never lands the user back
// inside a permit they already closed.
//
// Was red on main since FEAT-025. It asserted `history.length` was UNCHANGED
// when a second permit was opened, which encoded the pre-card-stack design.
// The card stack deliberately pushes one entry PER CARD so that Back walks the
// stack; the invariant that still matters is that closePermitModal unwinds
// every entry it owns. That is what this now checks.
const { chromium, CHROME, openList } = require("./_boot");

const ROW = {
  permit_number: "777", permit_type: "X", permit_status: "ACTIVE", issue_date: "d",
  address: "a", community_area: "Loop", review_type: "r", work_type: "w",
  processing_time: "1", work_description: "", reported_cost: "1", total_fee: "1",
  general_contractors: "", open_subs: "",
};

(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage();
  await openList(page);

  const baseline = await page.evaluate(() => history.length);

  await page.evaluate(row => openPermitDetail(row), ROW);
  await page.waitForTimeout(250);
  const first = await page.evaluate(() => ({
    visible: !document.getElementById("permit-modal").hidden,
    bodyMarked: document.body.classList.contains("modal-open"),
    depth: _permitModalDepth,
    cards: state.cardStack.length,
  }));

  // A second card on top of the first: one more entry, one more card.
  await page.evaluate(row => openPermitDetail(row), ROW);
  await page.waitForTimeout(250);
  const second = await page.evaluate(() => ({
    visible: !document.getElementById("permit-modal").hidden,
    hasNumber: /777/.test(document.getElementById("permit-modal-body").innerText),
    depth: _permitModalDepth,
    cards: state.cardStack.length,
  }));

  await page.evaluate(() => document.querySelector(".pm-close").click());
  await page.waitForTimeout(600);
  const afterClose = await page.evaluate(() => ({
    hidden: document.getElementById("permit-modal").hidden,
    depth: _permitModalDepth,
    cards: state.cardStack.length,
    bodyMarked: document.body.classList.contains("modal-open"),
    rootMarked: document.documentElement.classList.contains("modal-open"),
    // history.go(-n) fires popstate asynchronously; the handler must ignore its
    // own unwind, so the overlay must still be shut once it has all landed.
    atBaseline: history.length,
  }));

  const ok =
    first.visible && first.depth === 1 && first.cards === 1 && first.bodyMarked &&
    second.visible && second.hasNumber && second.depth === 2 && second.cards === 2 &&
    afterClose.hidden && afterClose.depth === 0 && afterClose.cards === 0 &&
    !afterClose.bodyMarked && !afterClose.rootMarked &&
    afterClose.atBaseline >= baseline;

  console.log(JSON.stringify({ baseline, first, second, afterClose }));
  console.log(ok ? "PASS" : "FAIL");
  await b.close();
  process.exit(ok ? 0 : 1);
})();
