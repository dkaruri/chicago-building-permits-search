// t42 (FIX-011): permits carry community_area as a bare code (22, not "Logan
// Square") and the dataset has no name anywhere, so the pages resolve it.
//
// A. the table is complete and correct — all 77 codes, contiguous, with the
//    three the City stores awkwardly (MCKINLEY PARK, OHARE) rendered properly
// B. the permit overlay shows the NAME, never the code
// C. unknown / missing / junk codes fall back to the raw value, never blank and
//    never a wrong name — a mislabelled neighborhood is worse than a number
// D. an already-named value passes through untouched (some rows arrive resolved)
// E. exports carry the name
// F. the map's neighborhood filter matches on the NAME, which it could not
//    before — only the code was in the haystack
const { chromium, devices } = require("playwright");
const EXE = "C:/Users/divya/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";

const ROW = {
  permit_number: "100999888", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION/ALTERATION",
  issue_date: "2026-05-01", address: "2957 W DIVERSEY AVE", ward: "1", reported_cost: "125000",
  total_fee: "900", work_description: "INTERIOR ALTERATIONS", work_type: "ALTERATION",
  review_type: "STANDARD", community_area: 22, processing_time: "12",
  general_contractors: "", open_subs: "", contacts: [],
};

async function open(browser, file) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [], posts: [] }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/" + file, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const bad = [];

  for (const file of ["list.html", "index.html", "map.html"]) {
    const { ctx, page } = await open(browser, file);

    // A + C + D: the lookup itself.
    const table = await page.evaluate(() => {
      const codes = Object.keys(COMMUNITY_AREAS).map(Number).sort((a, b) => a - b);
      return {
        count: codes.length,
        contiguous: codes.every((c, i) => c === i + 1),
        spot: [22, 32, 59, 76, 8, 77].map(c => COMMUNITY_AREAS[c]),
        // Fallbacks: never blank, never invented.
        unknown: communityAreaName(99),
        zero: communityAreaName(0),
        missing: communityAreaName(null),
        empty: communityAreaName(""),
        junk: communityAreaName("not a number"),
        alreadyNamed: communityAreaName("WEST TOWN"),
        stringCode: communityAreaName("22"),
      };
    });
    if (table.count !== 77) bad.push(`${file}: ${table.count} areas, expected 77`);
    if (!table.contiguous) bad.push(`${file}: codes are not contiguous 1-77`);
    const want = ["Logan Square", "Loop", "McKinley Park", "O'Hare", "Near North Side", "Edgewater"];
    if (JSON.stringify(table.spot) !== JSON.stringify(want)) bad.push(`${file}: spot check ${JSON.stringify(table.spot)}`);
    if (table.unknown !== "99") bad.push(`${file}: unknown code -> ${JSON.stringify(table.unknown)}, want the raw value`);
    if (table.zero !== "0") bad.push(`${file}: code 0 -> ${JSON.stringify(table.zero)}`);
    if (table.missing !== "" || table.empty !== "") bad.push(`${file}: missing/empty should be "", got ${JSON.stringify([table.missing, table.empty])}`);
    if (table.junk !== "not a number") bad.push(`${file}: junk -> ${JSON.stringify(table.junk)}`);
    if (table.alreadyNamed !== "WEST TOWN") bad.push(`${file}: pre-named value mangled -> ${JSON.stringify(table.alreadyNamed)}`);
    if (table.stringCode !== "Logan Square") bad.push(`${file}: string code -> ${JSON.stringify(table.stringCode)}`);

    // B: the permit overlay, on the two pages that have one.
    if (file !== "map.html") {
      const shown = await page.evaluate(async row => {
        openPermitDetail(row);
        await new Promise(r => setTimeout(r, 300));
        const body = document.getElementById("permit-modal-body");
        const s = [...body.querySelectorAll("section.pm-block")].find(x => (x.querySelector("h3") || {}).textContent === "Location");
        const dts = [...s.querySelectorAll("dt")];
        const i = dts.findIndex(d => d.textContent.trim() === "Neighborhood");
        return i === -1 ? null : s.querySelectorAll("dd")[i].textContent.trim();
      }, ROW);
      if (shown !== "Logan Square") bad.push(`${file}: overlay shows ${JSON.stringify(shown)}, want "Logan Square"`);
    }

    // E: exports (list.html builds them).
    if (file === "list.html") {
      const line = await page.evaluate(row => {
        const pairs = permitExportDetails(row);
        const hit = pairs.find(([k]) => k === "Neighborhood");
        return hit ? hit[1] : null;
      }, ROW);
      if (line !== "Logan Square") bad.push(`list.html: export neighborhood ${JSON.stringify(line)}`);
    }

    // F: the map filter must match on the name.
    if (file !== "index.html") {
      const matched = await page.evaluate(() => {
        const norm = s => String(s || "").toLowerCase();
        const row = { cn: 22, ca: "", st: "DIVERSEY AVE" };
        const hay = norm(`${row.cn} ${communityAreaName(row.cn)} ${row.ca} ${row.st}`);
        return { byName: hay.includes("logan square"), byCode: hay.includes("22") };
      });
      if (!matched.byName) bad.push(`${file}: filter cannot match the neighborhood NAME`);
      if (!matched.byCode) bad.push(`${file}: filter lost the ability to match the code`);
    }

    console.log(`${file}: 77 areas=${table.count === 77} contiguous=${table.contiguous} spot=${table.spot.join("/")}`);
    await ctx.close();
  }

  bad.forEach(b => console.log("BAD " + b));
  console.log(bad.length ? `FAIL ${bad.length}` : "PASS");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
