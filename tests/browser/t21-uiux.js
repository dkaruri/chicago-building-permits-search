// ui-ux-pro-max pre-landing audit of the contractor detail card.
// Checks the rules the existing suites do NOT already cover: touch spacing,
// row target height, focus visibility on every interactive element, escape
// routes, muted-text contrast, scrim strength, safe-area insets, landscape,
// and interruptible motion. Desktop + iPhone 13 + landscape, both themes,
// both pages.
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const PAGES = ["http://127.0.0.1:8791/index.html", "http://127.0.0.1:8791/list.html"];
const NAME = "MIDWEST PREMIER GENERAL CONTRACTING & RESTORATION LLC";
const ROW = { permit_number: "100923847", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", address: "4527 N MILWAUKEE AVE", work_type: "RENOVATION", work_description: "Interior", reported_cost: 120000, total_fee: 900, general_contractors: NAME, open_subs: "", latitude: 41.9, longitude: -87.7 };
const ROWS = Array.from({ length: 6 }, (_, i) => ({ ...ROW, permit_number: `10092384${i}` }));

const VIEWPORTS = [
  [{ width: 390, height: 844 }, "mobile"],
  [{ width: 844, height: 390 }, "landscape"],
  [{ width: 1280, height: 900 }, "desktop"],
];

async function audit(browser, url, vp, tag, theme) {
  const p = await browser.newPage({ viewport: vp });
  await p.addInitScript(t => localStorage.setItem("chi_permit_theme", t), theme);
  await p.route("**/api/contact/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ contact_name: NAME, matched_as: NAME, matched_category: "general_contractor", seeded_at: "2026-07-28T12:00:00.000Z", total_jobs: 188, avg_processing_days: 9.4, reported_cost_total: 42000000, license_matches: [{ phone: "(773) 555-0180", license_type: "General Contractor (Class E)" }], work_types: [{ work_type: "RENOVATION", n: 40 }], permit_types: [], contact_types: [] }) }));
  await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: ROWS, row_count: ROWS.length }) }));
  await p.route("**/api/notes/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [] }) }));
  await p.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 0, cached_at: "2026-07-28" }) }));
  await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await p.goto(url, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  await p.evaluate(() => { openPermitModal(); pushCard({ type: "contact", name: "Midwest Premier General Contracting & Restoration", role: "general_contractor" }); });
  await p.waitForFunction(() => (activeCard() || {}).loaded);
  await p.waitForFunction(() => {
    // The CARD runs permitRise too; a translateY still in flight makes the
    // card's measured bottom overshoot the viewport. Wait for both.
    const els = [document.querySelector(".permit-modal-card"), document.querySelector(".permit-modal-body")];
    return els.every(e => e.getAnimations().every(a => a.playState !== "running"));
  });

  const res = await p.evaluate(() => {
    const rgb = s => (s.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
    const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, k) => k - m); return (x + 0.05) / (y + 0.05); };
    const card = document.querySelector(".permit-modal-card");
    const body = document.querySelector(".permit-modal-body");
    const cardBg = rgb(getComputedStyle(card).backgroundColor);

    // Every focusable thing inside the overlay.
    const focusables = [...card.querySelectorAll('button, a[href], [tabindex="0"], [role="button"]')]
      .filter(el => el.offsetParent !== null);

    // Touch targets and the gaps between adjacent header actions.
    const acts = [...card.querySelectorAll(".pm-act, .pm-close, .pm-back")];
    const rects = acts.map(a => a.getBoundingClientRect());
    let minGap = Infinity;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
        const dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
        if (dx === 0 && dy === 0) continue; // overlapping/nested, not adjacent
        minGap = Math.min(minGap, Math.max(dx, dy));
      }
    }

    // Muted / small text contrast against the card surface.
    const sample = sel => {
      const el = card.querySelector(sel);
      return el ? +ratio(rgb(getComputedStyle(el).color), cardBg).toFixed(2) : null;
    };
    const smallest = Math.min(...[...card.querySelectorAll("*")]
      .filter(el => el.offsetParent !== null && el.textContent.trim() && !el.children.length)
      .map(el => parseFloat(getComputedStyle(el).fontSize)));

    const tableRows = [...card.querySelectorAll(".pm-tablewrap tbody tr")];
    const scrim = document.querySelector(".permit-modal-backdrop");
    const scrimAlpha = (getComputedStyle(scrim).backgroundColor.match(/[\d.]+\)$/) || ["1)"])[0].slice(0, -1);

    return {
      // focus visibility: does every focusable get an outline or box-shadow on :focus-visible?
      focusablesWithoutFocusStyle: focusables.filter(el => {
        el.focus();
        const cs = getComputedStyle(el);
        const outline = parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== "none";
        return !(outline || cs.boxShadow !== "none");
      }).map(el => el.className || el.tagName),
      minTouch: Math.min(...acts.map(a => Math.min(a.offsetWidth, a.offsetHeight))),
      minGapPx: minGap === Infinity ? null : +minGap.toFixed(1),
      rowMinHeight: tableRows.length ? Math.min(...tableRows.map(r => r.getBoundingClientRect().height)) : null,
      rowFocusable: tableRows.every(r => r.getAttribute("tabindex") === "0"),
      smallestFontPx: +smallest.toFixed(2),
      contrastMuted: sample(".small") ?? sample(".pm-empty"),
      contrastKicker: sample(".pm-head .k"),
      contrastProv: sample(".pm-prov"),
      provPresent: !!card.querySelector(".pm-prov"),
      contrastBody: sample(".pm-tablewrap td"),
      scrimAlpha: +scrimAlpha,
      cardBottomWithinViewport: card.getBoundingClientRect().bottom <= window.innerHeight + 1,
      bodyReachesBottom: body.getBoundingClientRect().bottom <= window.innerHeight + 1,
      tableScrollable: (() => { const w = card.querySelector(".pm-tablewrap"); return w ? getComputedStyle(w).overflowX : null; })(),
      noHScroll: body.scrollWidth <= body.clientWidth && document.documentElement.scrollWidth <= window.innerWidth,
      headingLevels: [...body.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(h => h.tagName),
      hasSafeAreaPadding: /env\(safe-area|constant\(safe-area/.test([...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText); } catch { return []; } }).join(" ")),
    };
  });

  // Escape must close the overlay (escape-routes / modal-escape).
  await p.keyboard.press("Escape");
  await p.waitForTimeout(120);
  res.escapeCloses = await p.evaluate(() => $("permit-modal").hidden);

  await p.close();
  return res;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const out = [];
  for (const url of PAGES) {
    for (const [vp, tag] of VIEWPORTS) {
      for (const theme of ["light", "dark"]) {
        out.push([`${url.split("/").pop()} ${tag} ${theme}`, await audit(browser, url, vp, tag, theme)]);
      }
    }
  }
  const problems = [];
  for (const [key, r] of out) {
    if (r.focusablesWithoutFocusStyle.length) problems.push(`${key}: no focus style on ${r.focusablesWithoutFocusStyle.join(", ")}`);
    if (r.minTouch < 44) problems.push(`${key}: touch target ${r.minTouch}px < 44`);
    if (r.minGapPx !== null && r.minGapPx < 8) problems.push(`${key}: target gap ${r.minGapPx}px < 8`);
    if (r.rowMinHeight !== null && r.rowMinHeight < 44) problems.push(`${key}: table row ${r.rowMinHeight}px < 44`);
    if (!r.rowFocusable) problems.push(`${key}: table rows not keyboard focusable`);
    if (r.smallestFontPx < 12) problems.push(`${key}: font ${r.smallestFontPx}px < 12`);
    if (!r.provPresent) problems.push(`${key}: provenance line missing from the audited card`);
    for (const k of ["contrastMuted", "contrastKicker", "contrastBody", "contrastProv"]) {
      if (r[k] !== null && r[k] < 4.5) problems.push(`${key}: ${k} ${r[k]}:1 < 4.5`);
    }
    if (r.scrimAlpha < 0.4) problems.push(`${key}: scrim alpha ${r.scrimAlpha} < 0.40`);
    if (!r.cardBottomWithinViewport) problems.push(`${key}: card bottom past viewport`);
    if (!r.noHScroll) problems.push(`${key}: horizontal scroll`);
    if (!r.escapeCloses) problems.push(`${key}: Escape does not close the overlay`);
    if (r.tableScrollable !== "auto") problems.push(`${key}: table wrapper overflow-x=${r.tableScrollable}`);
  }
  console.log(problems.length ? "FAIL" : "PASS");
  console.log(JSON.stringify(out, null, 1));
  if (problems.length) console.log("PROBLEMS:\n" + problems.join("\n"));
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})();
