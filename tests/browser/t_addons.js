const { chromium, CHROME } = require("./_boot");
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  let ok = true, out = {};
  for (const page_ of ["list.html","index.html"]) {
    const page = await b.newPage();
    await page.goto("http://localhost:8791/"+page_);
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
    const r = await page.evaluate(() => ({
      plural: parseBuildingType("CONVERSION TO 3 UNITS RESIDENTIAL"),
      pluralHyphen: parseBuildingType("RENOVATION OF EXISTING 4-UNIT BUILDING"),
      singular: parseBuildingType("2 UNIT BUILDING"),
      none: parseBuildingType("ELECTRICAL SERVICE UPGRADE"),
    }));
    out[page_] = r;
    if (!(r.plural === "3-Unit" && r.pluralHyphen === "4-Unit" && r.singular === "2-Unit" && r.none === "")) ok = false;
    await page.close();
  }
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(out));
  await b.close(); process.exit(ok ? 0 : 1);
})();
