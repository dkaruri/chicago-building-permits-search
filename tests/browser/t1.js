const { chromium, CHROME, openList } = require("./_boot");
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage(); await openList(page);
  const r = await page.evaluate(() => ({
    fourUnit: parseBuildingType("RENOVATION OF EXISTING 4-UNIT RESIDENTIAL BUILDING"),
    twoFlat: parseBuildingType("REPAIR OF TWO-FLAT PORCH"),
    single: parseBuildingType("NEW SINGLE FAMILY RESIDENCE"),
    none: parseBuildingType("ELECTRICAL SERVICE UPGRADE"),
    typeE: parseLicenseType("General Contractor (Class E)"),
    typePlain: parseLicenseType("Electrical Contractor (General)"),
    classE: parseLicenseClass("General Contractor (Class E)"),
    classNone: parseLicenseClass("Plumbing Contractor"),
  }));
  const ok =
    r.fourUnit === "4-Unit" && r.twoFlat === "Two-Flat" && r.single === "Single Family" &&
    r.none === "" && r.typeE === "General Contractor" &&
    r.typePlain === "Electrical Contractor (General)" &&
    r.classE === "E" && r.classNone === "";
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(r));
  await b.close(); process.exit(ok ? 0 : 1);
})();
