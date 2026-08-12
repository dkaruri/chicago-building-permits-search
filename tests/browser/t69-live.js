// FEAT-040 against PRODUCTION — the deployed map, real Socrata data, a seeded
// saved list. No mocks. Reaches the live network, so retry before believing it.
const { chromium, CHROME } = require("./_boot.js");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await (await browser.newContext()).newPage();
  await page.goto("https://dkaruri.github.io/chicago-building-permits-search/map.html");
  await page.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 60000 });
  await page.waitForFunction(() => state.map.filteredRows && state.map.filteredRows.length > 5, null, { timeout: 60000 });

  const all = await page.evaluate(() => state.map.filteredRows.length);
  console.log(`   ${all} open permits on the map before filtering`);

  // Seed a real list from permits actually on the map: 2 visited, 1 called, 1 bare.
  const picked = await page.evaluate(() => {
    const n = state.map.filteredRows.slice(0, 4).map(r => String(r.n));
    state.lists = {
      L1: { name: "Live A", permits: [n[0], n[2], n[3]], ticks: { [n[0]]: "Divyam" }, called: { [n[2]]: "Divyam" }, focal: null, sharedId: null },
      L2: { name: "Live B", permits: [n[1]], ticks: { [n[1]]: "Sam" }, called: {}, focal: null, sharedId: null },
    };
    state.activeListId = "L1";
    saveUserLists();
    return n;
  });

  await page.evaluate(async () => await setMapFlagFilter("visited", "yes"));
  await page.waitForFunction(() => !document.getElementById("map-flag-filters").hidden, null, { timeout: 20000 });
  await page.waitForTimeout(3000);

  const visited = await page.evaluate(() => state.map.filteredRows.map(r => String(r.n)).sort());
  check("Visited spans BOTH lists on the live map",
    visited.length === 2 && visited.includes(picked[0]) && visited.includes(picked[1]),
    visited.join(","));
  const strip = (await page.locator("#map-status-strip").textContent()).trim();
  check("the live status strip states the scope", /saved permits only/i.test(strip), strip);
  check("the filter really narrowed the map", visited.length < all, `${all} -> ${visited.length}`);

  await page.evaluate(async () => await setMapFlagFilter("visited", "no"));
  await page.waitForTimeout(3000);
  const notVisited = await page.evaluate(() => state.map.filteredRows.map(r => String(r.n)).sort());
  check("Not visited = listed and unvisited, never the whole city",
    notVisited.length === 2 && notVisited.includes(picked[2]) && notVisited.includes(picked[3]),
    notVisited.join(","));

  await page.evaluate(async () => await setMapFlagFilter("called", "yes"));
  await page.waitForTimeout(3000);
  check("facets combine live (not visited AND called)",
    (await page.evaluate(() => state.map.filteredRows.map(r => String(r.n)))).join(",") === picked[2],
    (await page.evaluate(() => state.map.filteredRows.map(r => String(r.n)))).join(","));

  const box = await page.locator("#map-filter-visited").boundingBox();
  check("live chip is a real 44px target", box.height >= 44, `${Math.round(box.width)}x${Math.round(box.height)}`);

  await page.screenshot({ path: "verify-tmp/t69-live.png" });
  await browser.close();
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
