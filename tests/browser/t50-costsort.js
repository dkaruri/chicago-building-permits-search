// t50-costsort.js — FIX-026: "Reported cost" sort was a no-op in the two
// contractor-profile modes. Profiles carry reported_cost_total, not
// reported_cost, so every row compared as 0 and the list silently kept its
// previous order. Asserts the ORDER changes and is correct, not that a control
// exists — the old bug passed every presence check.
const { chromium, CHROME } = require("./_boot");

const BASE = "http://localhost:8791";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  PASS ${n}`); } else { fail++; console.log(`  FAIL ${n} ${x}`); } };

// Deliberately ordered so open_jobs (the default sort) and reported_cost_total
// disagree: if the cost sort is a no-op, the list stays in open_jobs order and
// the assertion catches it. A shared no-op would otherwise look like a pass.
const PROFILES = [
  { contact_name: "LOW COST MANY JOBS", open_jobs: 99, reported_cost_total: 1000, total_jobs: 99, work_types: [], license_matches: [] },
  { contact_name: "MID COST MID JOBS", open_jobs: 50, reported_cost_total: 500000, total_jobs: 50, work_types: [], license_matches: [] },
  { contact_name: "TOP COST FEW JOBS", open_jobs: 1, reported_cost_total: 9000000, total_jobs: 1, work_types: [], license_matches: [] },
];

const PERMITS = [
  { permit_number: "P-CHEAP", permit_status: "ACTIVE", issue_date: "2026-07-03", address: "1 N A", reported_cost: 1000, work_description: "" },
  { permit_number: "P-RICH", permit_status: "ACTIVE", issue_date: "2026-07-01", address: "2 N A", reported_cost: 9000000, work_description: "" },
  { permit_number: "P-MID", permit_status: "ACTIVE", issue_date: "2026-07-02", address: "3 N A", reported_cost: 500000, work_description: "" },
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/api/stats*", r => r.fulfill({ json: { row_count: 3, open_permit_count: 3, general_contractor_count: 3, open_sub_count: 3, cached_at: "2026-07-31" } }));
  // Open Permits is SERVER-paged since FEAT-044, so the client no longer sorts
  // these rows — it asks the API for them in order. A mock that ignores the
  // sort parameter would return the fixture order and make a correct product
  // look broken, so this one honours it, and permitSorts records what was
  // actually asked for.
  const permitSorts = [];
  await page.route("**/api/permits*", r => {
    const u = new URL(r.request().url());
    const sort = u.searchParams.get("sort") || "";
    const dir = (u.searchParams.get("dir") || "desc").toLowerCase();
    permitSorts.push(sort ? `${sort}:${dir}` : "");
    const col = { cost: "reported_cost", issued: "issue_date" }[sort];
    let rows = PERMITS.slice();
    if (col) {
      const sign = dir === "asc" ? 1 : -1;
      rows.sort((a, b) => (col === "issue_date"
        ? String(a[col]).localeCompare(String(b[col]))
        : Number(a[col] || 0) - Number(b[col] || 0)) * sign);
    }
    r.fulfill({ json: { rows, row_count: rows.length, offset: 0, limit: 1000, sort, dir } });
  });
  // Profiles come from the Worker (/api/profiles), not the docs/data JSON —
  // that file is only the map page's GC job index.
  await page.route("**/api/profiles*", r => r.fulfill({ json: { rows: PROFILES, row_count: PROFILES.length } }));
  await page.goto(`${BASE}/index.html`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });

  const sortBy = (mode, value) => page.evaluate(async ([mode, value]) => {
    setMode(mode);
    $("sort").value = value;
    clearColumnSort();
    await search();
    return state.filteredRows.map(r => r.contact_name || r.permit_number);
  }, [mode, value]);

  for (const mode of ["general_contractors", "open_subs"]) {
    const byJobs = await sortBy(mode, "open_jobs");
    ok(`[${mode}] baseline sorts by open jobs`,
      JSON.stringify(byJobs) === JSON.stringify(["LOW COST MANY JOBS", "MID COST MID JOBS", "TOP COST FEW JOBS"]), JSON.stringify(byJobs));

    const byCost = await sortBy(mode, "reported_cost");
    ok(`[${mode}] cost sort actually reorders the list`,
      JSON.stringify(byCost) !== JSON.stringify(byJobs), JSON.stringify(byCost));
    ok(`[${mode}] cost sort is descending by reported_cost_total`,
      JSON.stringify(byCost) === JSON.stringify(["TOP COST FEW JOBS", "MID COST MID JOBS", "LOW COST MANY JOBS"]), JSON.stringify(byCost));

    // The two fields answer different questions, so the option must say which.
    const labelled = await page.evaluate(() => $("sort").querySelector('option[value="reported_cost"]').textContent.trim());
    ok(`[${mode}] option is relabelled "Total reported cost"`, labelled === "Total reported cost", labelled);
  }

  // No regression on the mode that was already working.
  permitSorts.length = 0;
  const permitsByCost = await sortBy("open_permits", "reported_cost");
  ok(`[open_permits] still sorts by per-permit reported_cost`,
    JSON.stringify(permitsByCost) === JSON.stringify(["P-RICH", "P-MID", "P-CHEAP"]), JSON.stringify(permitsByCost));
  // The rendered order above can only be right if the request was right, but
  // assert the request too: it is the half the client still owns, and it is the
  // half that silently stopped happening when this mode went server-paged.
  ok(`[open_permits] the dropdown reaches the API as a real sort`,
    permitSorts.includes("cost:desc"), JSON.stringify(permitSorts));
  const permitLabel = await page.evaluate(() => $("sort").querySelector('option[value="reported_cost"]').textContent.trim());
  ok(`[open_permits] option reads "Reported cost"`, permitLabel === "Reported cost", permitLabel);

  // The label must follow the mode both ways, not just on first switch.
  const backToGc = await page.evaluate(async () => {
    setMode("general_contractors");
    return $("sort").querySelector('option[value="reported_cost"]').textContent.trim();
  });
  ok(`label follows the mode back to a profile mode`, backToGc === "Total reported cost", backToGc);

  await ctx.close();
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
