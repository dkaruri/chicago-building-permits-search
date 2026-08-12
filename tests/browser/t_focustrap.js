// Confirms the carried-over focus-trap fix: trapPermitModalFocus's focusable-node
// query includes select/input(:not disabled), and that a <select> injected into the
// modal body actually participates in the Tab wrap (last node -> Shift+Tab skips it
// only per the query; Tab from last node wraps to first).
const { chromium, CHROME, openList } = require("./_boot");
const ROW = { permit_number: "999", permit_type: "X", permit_status: "ACTIVE", issue_date: "d",
  address: "a", community_area: "Loop", review_type: "r", work_type: "w", processing_time: "1",
  work_description: "", reported_cost: "1", total_fee: "1", general_contractors: "", open_subs: "" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage();
  await openList(page);
  await page.evaluate(row => openPermitDetail(row), ROW);

  // Source-contains check (robust, doesn't depend on layout/visibility quirks).
  const src = await page.evaluate(() => trapPermitModalFocus.toString());
  const hasSelect = /select:not\(\[disabled\]\)/.test(src);
  const hasInput = /input:not\(\[disabled\]\)/.test(src);

  // Behavioral check: inject a <select> as the last focusable node, Tab from it, confirm wrap to first (.pm-close).
  await page.evaluate(() => {
    const body = document.getElementById("permit-modal-body");
    const sel = document.createElement("select");
    sel.id = "t-injected-select";
    sel.innerHTML = "<option>a</option><option>b</option>";
    body.appendChild(sel);
  });
  await page.locator("#t-injected-select").focus();
  await page.keyboard.press("Tab");
  const wrapped = await page.evaluate(() => {
    const nodes = [...document.getElementById("permit-modal").querySelectorAll(
      'button:not([disabled]), a[href], textarea:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(n => n.offsetParent !== null);
    return document.activeElement === nodes[0];
  });

  const ok = hasSelect && hasInput && wrapped;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify({ hasSelect, hasInput, wrapped }));
  await b.close();
  process.exit(ok ? 0 : 1);
})();
