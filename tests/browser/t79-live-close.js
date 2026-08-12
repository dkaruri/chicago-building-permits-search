// Closing check for FIX-045 / FEAT-046 / FEAT-047 / FEAT-048 — driven against
// the DEPLOYED site, not the local preview, because the question being answered
// is "is this actually live for users", not "does the branch work".
// No mocks: real Pages, real Worker, real Socrata. It therefore reaches the
// network and can flake — re-run before believing a failure (t14-live rule).
//
// Run: node verify-tmp/t79-live-close.js
const { chromium, CHROME } = require("./_boot");

const BASE = "https://dkaruri.github.io/chicago-building-permits-search";

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const ready = page => page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 });

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // ---- FEAT-046 on the live directory ----
  console.log("\n== live index.html ==");
  await page.goto(`${BASE}/index.html`);
  await ready(page);
  await page.evaluate(() => setMode("open_permits"));
  // NOT `#results table tbody tr` — the contractor table is already on screen
  // when setMode is called, so that selector matches the OLD table and reports
  // zero chips for a page that is rendering them correctly. Wait for a cell
  // only the permits table has.
  await page.waitForSelector('#results td[data-label="Permit"]', { timeout: 45000 });
  const chips = await page.evaluate(() => {
    const cells = [...document.querySelectorAll("#results table tbody tr")];
    const withChip = cells.filter(r => r.querySelector(".stage"));
    return {
      rows: cells.length,
      chipped: withChip.length,
      labels: [...new Set(withChip.map(r => r.querySelector(".stage").textContent.trim()))],
      titles: [...new Set(withChip.map(r => r.querySelector(".stage").getAttribute("title")))].slice(0, 4),
      inStatusCell: withChip.length > 0 && !!withChip[0].querySelector('td[data-label="Status"] .stage'),
    };
  });
  check("every live open-permit row carries a stage chip, in the Status cell",
    chips.rows > 0 && chips.chipped === chips.rows && chips.inStatusCell, JSON.stringify(chips));
  check("the chips carry the FEAT-046 vocabulary, not raw milestone strings",
    chips.labels.length > 0 && chips.labels.every(l =>
      ["Not started", "In progress", "Finishing", "Halted", "Fee due", "Complete", "Ended early"].includes(l)),
    JSON.stringify(chips.labels));
  check("the chip keeps the verbatim milestone in its title",
    chips.titles.length > 0 && chips.titles.every(t => t && t === t.toUpperCase()), JSON.stringify(chips.titles));

  // The overlay's verbatim Stage fact row, opened the way the page's own suite
  // opens it rather than by guessing at a clickable descendant.
  const opened = await page.evaluate(async () => {
    const row = state.filteredRows && state.filteredRows[0];
    if (!row) return false;
    openPermitDetail(row);
    return true;
  });
  await page.waitForSelector("#permit-modal:not([hidden]) .pm-tagrow", { timeout: 30000 });
  const overlay = await page.evaluate(() => {
    const m = document.getElementById("permit-modal");
    const text = m.textContent;
    return {
      chip: !!m.querySelector(".pm-tagrow .stage"),
      stageFact: /Stage/.test(text),
    };
  });
  check("the live permit overlay shows the stage chip and a verbatim Stage row",
    opened && overlay.chip && overlay.stageFact, JSON.stringify(overlay));

  // ---- FEAT-047 on the live map ----
  console.log("\n== live map.html ==");
  await page.goto(`${BASE}/map.html`);
  await page.waitForFunction(() => document.body.dataset.ready === "1" && typeof state !== "undefined" && state.map && state.map.map, null, { timeout: 60000 });
  const mapFilter = await page.evaluate(() => ({
    hasStageGroup: !!document.querySelector("#map-stage-list, #map-stage-details, [id*='stage']"),
    triControl: typeof triStateOptionHtml === "function",
    matcher: typeof matchesTriState === "function",
    persisted: Object.prototype.hasOwnProperty.call(defaultMapSettings(), "stages"),
  }));
  check("the live map carries the tri-state control and a Stage filter",
    mapFilter.hasStageGroup && mapFilter.triControl && mapFilter.matcher, JSON.stringify(mapFilter));
  check("stages is a persisted map setting (survives a reload, FIX-035)",
    mapFilter.persisted, JSON.stringify(mapFilter));

  // ---- FEAT-048 on the live list ----
  console.log("\n== live list.html ==");
  await page.goto(`${BASE}/list.html`);
  await ready(page);
  const list = await page.evaluate(() => ({
    stageBtn: !!document.getElementById("list-stage-btn"),
    pills: ["filter-visited", "filter-called"].every(id => {
      const el = document.getElementById(id);
      return el && el.classList.contains("tri-pill");
    }),
    followUpBinary: !!document.getElementById("filter-followup") &&
      document.getElementById("filter-followup").getAttribute("aria-pressed") !== null,
    fold: !!document.getElementById("list-header-fold"),
    countBelowTable: !!(document.getElementById("user-list") && document.getElementById("list-filter-status") &&
      (document.getElementById("user-list").compareDocumentPosition(document.getElementById("list-filter-status")) & Node.DOCUMENT_POSITION_FOLLOWING)),
  }));
  check("the live list has the Stage picker and tri-state pills (FEAT-048)",
    list.stageBtn && list.pills, JSON.stringify(list));
  check("Follow-up stayed a plain on/off pill", list.followUpBinary, JSON.stringify(list));
  check("FEAT-052's fold and relocated count are live too",
    list.fold && list.countBelowTable, JSON.stringify(list));

  // ---- FIX-045 on the live overlay: Zone and TIF fill independently ----
  // The defect was that a slow third-party parcel lookup held Zone and TIF at
  // "…" long after their own answers had arrived. Assert they RESOLVE.
  console.log("\n== live FIX-045 (zoning/TIF fill) ==");
  await page.goto(`${BASE}/index.html`);
  await ready(page);
  await page.evaluate(() => setMode("open_permits"));
  await page.waitForSelector('#results td[data-label="Permit"]', { timeout: 45000 });
  await page.evaluate(() => openPermitDetail(state.filteredRows[0]));
  await page.waitForSelector("#permit-modal:not([hidden]) .pm-tagrow", { timeout: 30000 });
  const geo = await page.waitForFunction(() => {
    const m = document.getElementById("permit-modal");
    if (!m || m.hidden) return false;
    const pending = [...m.querySelectorAll("span, td, dd")].filter(e => e.textContent.trim() === "…").length;
    return pending === 0 ? { pending } : false;
  }, null, { timeout: 30000 }).then(h => h.jsonValue()).catch(() => null);
  check("the live permit overlay leaves nothing stuck at '…' (FIX-045)",
    geo !== null, geo ? JSON.stringify(geo) : "still pending after 30s");

  await page.screenshot({ path: "verify-tmp/t79-live-close.png" });
  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
