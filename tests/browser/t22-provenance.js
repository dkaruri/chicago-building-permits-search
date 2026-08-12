// Phase 2 client: the card renders what the Worker resolved.
//  A. matched_as differing from the tapped name shows "matched as <name>"
//  B. matched_as equal to the tapped name shows NO such line
//  C. seeded_at renders "Profile data as of <date>"; absent => line omitted
//  D. a cross-category hit (matched_category = open_tech on a GC row) filters
//     the permits table on open_subs, not general_contractors
//  E. an older Worker returning neither field degrades to today's behaviour
//  F. the provenance line clears 4.5:1 in both themes
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const PAGES = ["http://127.0.0.1:8791/index.html", "http://127.0.0.1:8791/list.html"];

const BASE = { permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", address: "4 N AVE", work_type: "RENOVATION", work_description: "x", reported_cost: 1000, total_fee: 9, latitude: 41.9, longitude: -87.7 };
// One permit lists the contractor as a GC, one as an open sub. Which of the two
// the table shows is exactly what matched_category decides.
const AS_GC = { ...BASE, permit_number: "111", general_contractors: "ACME BUILDERS LLC", open_subs: "" };
const AS_SUB = { ...BASE, permit_number: "222", general_contractors: "SOMEONE ELSE", open_subs: "ACME BUILDERS LLC" };

async function open(browser, url, profile) {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p.route("**/api/contact/**", r => (profile
    ? r.fulfill({ contentType: "application/json", body: JSON.stringify(profile) })
    : r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Contact not found" }) })));
  await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [AS_GC, AS_SUB], row_count: 2 }) }));
  await p.route("**/api/notes/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [] }) }));
  await p.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 0, cached_at: "2026-07-28" }) }));
  await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await p.goto(url, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  // Tapped as a general contractor, under a loosely-typed name.
  await p.evaluate(() => { openPermitModal(); pushCard({ type: "contact", name: "Acme Builders", role: "general_contractor" }); });
  await p.waitForFunction(() => (activeCard() || {}).loaded);
  const out = await p.evaluate(() => ({
    prov: (document.querySelector(".pm-prov") || {}).textContent || "",
    permits: [...document.querySelectorAll(".pm-tablewrap tbody tr td strong")].map(td => td.textContent),
    empty: !!document.querySelector(".pm-empty"),
  }));
  await p.close();
  return out;
}

const PROFILE = { contact_name: "ACME BUILDERS LLC", open_jobs: 2, total_jobs: 9, license_matches: [], work_types: [], permit_types: [], contact_types: [] };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const results = [];
  for (const url of PAGES) {
    // A + C + D: fuzzy cross-category hit, with a timestamp.
    const fuzzySub = await open(browser, url, { ...PROFILE, matched_as: "ACME BUILDERS LLC", matched_category: "open_tech", seeded_at: "2026-07-28T12:00:00.000Z" });
    // B: exact hit on the tapped name — no "matched as" line.
    const exact = await open(browser, url, { ...PROFILE, contact_name: "Acme Builders", matched_as: "Acme Builders", matched_category: "general_contractor", seeded_at: "2026-07-28T12:00:00.000Z" });
    // C-negative: no seeded_at => no staleness line.
    const noSeed = await open(browser, url, { ...PROFILE, matched_as: "ACME BUILDERS LLC", matched_category: "general_contractor" });
    // E: an older Worker, neither field.
    const legacy = await open(browser, url, { ...PROFILE });

    const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const contrast = {};
    for (const theme of ["light", "dark"]) {
      await p.addInitScript(t => localStorage.setItem("chi_permit_theme", t), theme);
      await p.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: "{}" }));
      await p.goto(url, { waitUntil: "domcontentloaded" });
      contrast[theme] = await p.evaluate(() => {
        const host = document.createElement("div");
        host.className = "permit-modal-card";
        host.innerHTML = `<p class="pm-prov">matched as X</p>`;
        document.body.appendChild(host);
        const el = host.querySelector(".pm-prov");
        const rgb = s => (s.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
        const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const bg = rgb(getComputedStyle(document.body).backgroundColor);
        const [x, y] = [lum(rgb(getComputedStyle(el).color)), lum(bg)].sort((m, k) => k - m);
        const px = parseFloat(getComputedStyle(el).fontSize);
        host.remove();
        return { ratio: +(((x + 0.05) / (y + 0.05))).toFixed(2), px };
      });
    }
    await p.close();
    results.push([url.split("/").pop(), { fuzzySub, exact, noSeed, legacy, contrast }]);
  }

  const problems = [];
  for (const [key, r] of results) {
    if (!/matched as ACME BUILDERS LLC/.test(r.fuzzySub.prov)) problems.push(`${key}: fuzzy hit did not show "matched as"`);
    if (!/Profile data as of/.test(r.fuzzySub.prov)) problems.push(`${key}: seeded_at did not render`);
    // D: matched_category open_tech must select the open_subs permit, not the GC one.
    if (JSON.stringify(r.fuzzySub.permits) !== JSON.stringify(["222"])) problems.push(`${key}: cross-category filter picked ${JSON.stringify(r.fuzzySub.permits)}, expected ["222"]`);
    if (/matched as/.test(r.exact.prov)) problems.push(`${key}: exact hit wrongly showed "matched as"`);
    if (!/Profile data as of/.test(r.exact.prov)) problems.push(`${key}: exact hit lost the staleness line`);
    if (/Profile data as of/.test(r.noSeed.prov)) problems.push(`${key}: absent seeded_at was guessed`);
    if (r.legacy.prov !== "") problems.push(`${key}: legacy Worker response produced a provenance line: ${r.legacy.prov}`);
    if (JSON.stringify(r.legacy.permits) !== JSON.stringify(["111"])) problems.push(`${key}: legacy fallback filter picked ${JSON.stringify(r.legacy.permits)}, expected ["111"]`);
    for (const t of ["light", "dark"]) {
      if (r.contrast[t].ratio < 4.5) problems.push(`${key}: .pm-prov ${t} contrast ${r.contrast[t].ratio}:1 < 4.5`);
      if (r.contrast[t].px < 12) problems.push(`${key}: .pm-prov ${r.contrast[t].px}px < 12`);
    }
  }

  console.log(problems.length ? "FAIL" : "PASS");
  console.log(JSON.stringify(results, null, 1));
  if (problems.length) console.log("PROBLEMS:\n" + problems.join("\n"));
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})();
