// FEAT-044 follow-up — the CLIENT's own limit=5000 on /api/profiles.
// Removing the Worker's ceiling was not enough: the contractor directory still
// showed exactly 5,000 rows because the client asked for exactly 5,000.
// Verified live against production before this fix: 5000 rows of 5,793.
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot.js");

const TOTAL = 7432;
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

async function openDirectory(page, { requests, serverPageCap = Infinity } = {}) {
  await page.route("**/api/stats*", r => r.fulfill({ json: { row_count: 40868 } }));
  await page.route("**/api/profiles*", r => {
    const u = new URL(r.request().url());
    const limit = Math.min(parseInt(u.searchParams.get("limit") || "50"), serverPageCap);
    const offset = parseInt(u.searchParams.get("offset") || "0");
    if (requests) requests.push({ limit: parseInt(u.searchParams.get("limit") || "50"), offset });
    const rows = Array.from({ length: Math.max(0, Math.min(limit, TOTAL - offset)) }, (_, i) => ({
      contact_name: `CONTRACTOR ${String(offset + i).padStart(5, "0")}`,
      sample_contact_type: "CONTRACTOR-GENERAL CONTRACTOR", city: "CHICAGO",
      open_jobs: 1, total_jobs: 2,
    }));
    r.fulfill({ json: { category: u.searchParams.get("category"), rows, total: TOTAL, offset, limit } });
  });
  await page.goto("http://localhost:8791/index.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });
  await page.evaluate(async () => { setMode("general_contractors"); await search(); });
  await page.waitForFunction(() => state.filteredRows.length > 0, null, { timeout: 20000 });
}

async function run(label, ctxOpts) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext(ctxOpts)).newPage();
  const requests = [];
  await openDirectory(page, { requests });

  const loaded = await page.evaluate(() => state.data.general_contractors.length);
  check("every profile row is loaded, not a 5,000-row prefix", loaded === TOTAL, `${loaded} of ${TOTAL}`);
  check("the row past the old ceiling is present",
    await page.evaluate(() => state.data.general_contractors.some(r => r.contact_name === "CONTRACTOR 05000")));
  check("the client no longer asks for exactly 5000",
    !requests.some(r => r.limit === 5000), JSON.stringify(requests));
  check("one request is enough in practice", requests.length === 1, `${requests.length} requests`);
  check("the count label reports the full directory",
    /of 7,432 shown/.test(await page.locator("#result-count").textContent()),
    (await page.locator("#result-count").textContent()).trim());

  await browser.close();
}

// If the server ever pages smaller than the client asks, the client must keep
// going rather than silently show a prefix — that is the whole point.
async function pagedServer() {
  console.log("\n=== server pages smaller than requested ===");
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext()).newPage();
  const requests = [];
  await openDirectory(page, { requests, serverPageCap: 3000 });
  const loaded = await page.evaluate(() => state.data.general_contractors.length);
  check("the client keeps paging until it holds the total", loaded === TOTAL, `${loaded} of ${TOTAL}`);
  check("it took more than one request", requests.length === 3, `${requests.length} requests: ${JSON.stringify(requests)}`);
  check("offsets advance without gaps or repeats",
    requests.map(r => r.offset).join(",") === "0,3000,6000", JSON.stringify(requests.map(r => r.offset)));
  await browser.close();
}

(async () => {
  await run("desktop", {});
  await run("iPhone13", { ...devices["iPhone 13"] });
  await pagedServer();
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
