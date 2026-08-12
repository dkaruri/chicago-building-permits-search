// t39 (FIX-012): the contractor timing stats.
//
// The metric the ticket asked for — average issue-to-close days — is not in any
// published dataset, so it is OBSERVED across seeds and is absent until samples
// exist. That makes "renders nothing when absent" the single most important
// behaviour here: for months after this ships, almost every contractor will have
// no close time, and a 0 would read as "closes same day".
//
// A. a contractor WITH observations shows the close-time pill, with its sample
// B. a contractor WITHOUT them shows no close pill at all — no 0, no n/a
// C. open-job age shows on the card for both
// D. the old stat is relabelled: no pill still says "processing days"
// E. directory column shows the age, and an em dash (never 0) when there is none
const { chromium, devices } = require("playwright");
const EXE = "C:/Users/divya/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";

const WITH = {
  contact_name: "SEEN CLOSING LLC", open_jobs: 5, total_jobs: 40,
  avg_processing_days: 7.6, open_age_avg_days: 642, open_age_median_days: 577, open_age_max_days: 2050,
  close_days_avg: 118, close_sample: 9,
  license_matches: [], work_types: [], reported_cost_total: 1000,
};
const WITHOUT = {
  contact_name: "NEVER SEEN LLC", open_jobs: 3, total_jobs: 12,
  avg_processing_days: 4.2, open_age_avg_days: 300,
  license_matches: [], work_types: [], reported_cost_total: 500,
};

async function cardPills(page, name) {
  await page.evaluate(n => openContactCard(encodeURIComponent(n), "general_contractor"), name);
  await page.waitForTimeout(700);
  return page.evaluate(() =>
    [...document.querySelectorAll("#permit-modal .pm-tagrow.stats .pm-tag")].map(e => e.textContent.trim()));
}

async function run(browser, file) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [], posts: [] }) }));
  await page.route("**/api/contact/**", r => {
    const n = decodeURIComponent(new URL(r.request().url()).pathname.split("/api/contact/")[1].split("?")[0]);
    const p = /SEEN CLOSING/i.test(n) ? WITH : /NEVER SEEN/i.test(n) ? WITHOUT : null;
    return p ? r.fulfill({ contentType: "application/json", body: JSON.stringify(p) })
             : r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/" + file, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });

  const withPills = await cardPills(page, "SEEN CLOSING LLC");
  await page.evaluate(() => closePermitModal());
  await page.waitForTimeout(300);
  const withoutPills = await cardPills(page, "NEVER SEEN LLC");
  await ctx.close();
  return { file, withPills, withoutPills };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const rows = [];
  for (const f of ["list.html", "index.html"]) rows.push(await run(browser, f));

  // E: the directory helper, index.html only (list.html hides the directory).
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });
  const age = await page.evaluate(() => ({
    withAge: profileOpenAge({ open_age_avg_days: 642 }),
    none: profileOpenAge({}),
    zero: profileOpenAge({ open_age_avg_days: 0 }),
  }));
  await ctx.close();
  await browser.close();

  const bad = [];
  for (const r of rows) {
    const wj = r.withPills.join(" | "), oj = r.withoutPills.join(" | ");
    console.log(`${r.file}\n   with   : ${wj}\n   without: ${oj}`);
    if (!/closes in ~118 days \(9 seen\)/.test(wj)) bad.push(`${r.file}: close pill missing`);
    if (/closes in/.test(oj)) bad.push(`${r.file}: close pill shown without observations`);
    if (!/open jobs avg 642 days old/.test(wj)) bad.push(`${r.file}: open age missing (with)`);
    if (!/open jobs avg 300 days old/.test(oj)) bad.push(`${r.file}: open age missing (without)`);
    if (/processing days/.test(wj) || /processing days/.test(oj)) bad.push(`${r.file}: stale "processing days" label`);
    if (!/days to get issued/.test(wj)) bad.push(`${r.file}: issuance stat not relabelled`);
  }
  console.log("directory helper:", JSON.stringify(age));
  if (age.withAge !== "642d") bad.push("directory age wrong");
  if (age.none !== "\u2014" || age.zero !== "\u2014") bad.push("directory shows a number instead of an em dash when there is no age");

  bad.forEach(b => console.log("BAD " + b));
  console.log(bad.length ? `FAIL ${bad.length}` : "PASS");
  process.exit(bad.length ? 1 : 0);
})();
