// Did making Address plain text (instead of a sort button) squeeze the Cost
// column into wrapping mid-number? Measures both renderings of the SAME rows.
const { chromium, CHROME } = require("./_boot.js");
const TOTAL = 40868;
const permitAt = i => ({
  permit_number: `P${String(i).padStart(6, "0")}`, permit_status: "ACTIVE",
  permit_type: "PERMIT - RENOVATION", review_type: "STANDARD", issue_date: "2026-01-01",
  processing_time: 5, address: `${i} W TEST ST`, work_type: "RENOVATION",
  work_description: "work", reported_cost: (TOTAL - i) * 10, total_fee: 100, ward: 1,
  community_area: 1, latitude: 41.9, longitude: -87.7, general_contractors: "ACME",
  open_subs: "", contacts: []
});

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext()).newPage();
  await page.route("**/api/stats*", r => r.fulfill({ json: { row_count: TOTAL } }));
  await page.route("**/api/permits*", r => {
    const u = new URL(r.request().url());
    const offset = parseInt(u.searchParams.get("offset") || "0");
    const limit = parseInt(u.searchParams.get("limit") || "150");
    r.fulfill({ json: { rows: Array.from({ length: limit }, (_, i) => permitAt(offset + i)),
                        row_count: limit, total: TOTAL, offset, limit, sort: "", dir: "desc" } });
  });
  await page.goto("http://localhost:8791/index.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });
  await page.evaluate(async () => { setMode("open_permits"); await search(); });
  await page.waitForSelector(".permits-table tbody tr");

  const measure = () => page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll(".permits-table thead th"));
    const costCell = document.querySelector(".permits-table tbody tr td[data-label='Cost']");
    const cs = getComputedStyle(costCell);
    // A cell whose text is taller than one line has wrapped.
    const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    const range = document.createRange();
    range.selectNodeContents(costCell);
    const textW = range.getBoundingClientRect().width;
    return {
      headers: cells.map(th => `${th.textContent.trim()}:${Math.round(th.getBoundingClientRect().width)}`),
      costWidth: Math.round(costCell.getBoundingClientRect().width),
      costHeight: Math.round(costCell.getBoundingClientRect().height),
      lines: Math.round(costCell.getBoundingClientRect().height / lineH),
      text: costCell.textContent.trim(),
      textWidth: Math.round(textW),
    };
  });

  const after = await measure();
  console.log("AFTER  (Address plain):   ", JSON.stringify(after));

  // Re-render the same rows with Address sortable again — the pre-change shape.
  await page.evaluate(() => {
    document.getElementById("results").innerHTML = permitTable(state.visibleRows, {
      select: true, remove: false, sortable: true, serverSorted: false,
      emptyText: "No matching permits."
    });
  });
  const before = await measure();
  console.log("BEFORE (Address sortable):", JSON.stringify(before));

  console.log("\ncost column width delta:", after.costWidth - before.costWidth);
  console.log("wrapped after:", after.lines > 1, " wrapped before:", before.lines > 1);
  await page.screenshot({ path: "verify-tmp/t67-width-probe.png" });
  await browser.close();
})();
