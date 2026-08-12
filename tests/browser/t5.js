const { chromium, CHROME, openList } = require("./_boot");
const ROW = { permit_number: "100991233", permit_type: "X", permit_status: "ACTIVE", issue_date: "d",
  address: "a", community_area: "Logan Square", review_type: "r", work_type: "w", processing_time: "1",
  work_description: "", reported_cost: "1", total_fee: "1", general_contractors: "", open_subs: "" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage(); await openList(page);

  // 1. Open with empty caches — no pre-seed. Read the DOM in the SAME
  // evaluate call, synchronously after openPermitDetail returns, so the
  // async onOpen->fillPermitGeo fetch (which fires automatically now that
  // it's wired) has not had a tick to resolve and overwrite the spans yet.
  const initial = await page.evaluate(row => {
    openPermitDetail(row);
    return {
      zone: document.querySelector('#permit-modal-body .geo-zone[data-permit="100991233"]').textContent,
      tif: document.querySelector('#permit-modal-body .geo-tif[data-permit="100991233"]').textContent,
    };
  }, ROW);

  // 2. Seed caches and invoke fillPermitGeo directly against the open body.
  const filled = await page.evaluate(() => {
    geoZoneCache.set("100991233", "B3-2");
    geoTifCache.set("100991233", "Fullerton/Milwaukee");
    const body = document.getElementById("permit-modal-body");
    return fillPermitGeo(body, { permit_number: "100991233" }).then(() => ({
      zone: body.querySelector('.geo-zone[data-permit="100991233"]').textContent,
      tif: body.querySelector('.geo-tif[data-permit="100991233"]').textContent,
    }));
  });

  const t = {
    initialUnresolved: initial.zone === "…" && initial.tif === "…",
    zone: filled.zone === "B3-2",
    tif: filled.tif === "Fullerton/Milwaukee",
  };
  const ok = t.initialUnresolved && t.zone && t.tif;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify({ initial, filled }));
  await b.close(); process.exit(ok ? 0 : 1);
})();
