// t38: ui-ux-pro-max pass on the FIX-015 surfaces.
//
// This project has twice shipped muted-on-panel text that measured below 4.5:1,
// so every new colour is measured against its real composited surface rather
// than trusted. Also checks the 12px floor, that no new element forces
// horizontal scroll at 390px, and that "Run by" is carried by a WORD and not by
// colour alone (colour-not-only).
const { chromium, devices } = require("playwright");
const EXE = "C:/Users/divya/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";

const ROW = {
  permit_number: "100999888", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION/ALTERATION",
  issue_date: "2026-05-01", address: "123 N TEST ST", ward: "27", reported_cost: "125000",
  total_fee: "900", work_description: "INTERIOR ALTERATIONS 3 UNITS", work_type: "ALTERATION",
  review_type: "STANDARD PLAN REVIEW", community_area: "WEST TOWN", processing_time: "12",
  general_contractors: "BEAR CONSTRUCTION COMPANY",
  open_subs: "",
  contacts: [
    // Deliberately hostile: a long owner name and a long role, the case that
    // wraps badly at 390px. Assertions are blind to typography — the screenshot
    // is the real check on this one.
    { type: "OWNER AS ARCHITECT & CONTRACTR", name: "MARGUERITE VANDERBILT-HOLLINGSWORTH", city: "CHICAGO", state: "IL", zipcode: "60614" },
  ],
};

const PROFILE = {
  contact_name: "BEAR CONSTRUCTION COMPANY", open_jobs: 12,
  license_matches: [{ license_type: "General Contractor (Class A)", phone: "(312) 555-0142" }],
  work_types: [{ work_type: "Nonstructural Interior Work" }],
  principals: [{ name: "James S. Wienold", title: "PRESIDENT" }, { name: "Georgina Wienold-Castellanos", title: "SECRETARY" }],
  principal_count: 3,
};

const AUDIT = `
  (() => {
    const parse = c => (c.match(/[\\d.]+/g) || []).map(Number).slice(0, 3);
    const lum = ([r, g, b]) => {
      const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
      return (hi + 0.05) / (lo + 0.05);
    };
    const surfaceOf = el => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) return parse(bg);
      }
      return [255, 255, 255];
    };
    const probe = (sel, label) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        label,
        contrast: Number(ratio(parse(cs.color), surfaceOf(el)).toFixed(2)),
        fontPx: Number(cs.fontSize.replace("px", "")),
        text: (el.textContent || "").trim().slice(0, 40),
      };
    };
    return {
      probes: [
        probe(".cprincipal .dk", "Run by label"),
        probe(".cprincipal .pname", "principal name"),
        probe(".cprincipal .ptitle", "principal title"),
        probe(".cprincipal .pmore", "+N more"),
        probe(".owner-line .owner-role", "owner role"),
        probe(".owner-line .ci-name", "owner name"),
      ].filter(Boolean),
      // colour-not-only: the relationship must survive a greyscale render, so a
      // literal word has to say it.
      runByHasWord: /run by/i.test((document.querySelector(".cprincipal") || {}).textContent || ""),
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      modalHScroll: (() => {
        const b = document.getElementById("permit-modal-body");
        return b ? b.scrollWidth > b.clientWidth + 1 : false;
      })(),
    };
  })()
`;

async function run(browser, file, mobile, theme, shot) {
  const ctx = mobile
    ? await browser.newContext({ ...devices["iPhone 13"] })
    : await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [], posts: [] }) }));
  // Name-aware, NOT a blanket profile: a catch-all made the owner inherit the
  // GC's principal and the screenshot showed "Run by" under UNIT OWNER, which
  // would have been read as a product bug. The owner here has no contractor
  // profile, which is the common case and the one worth looking at.
  await page.route("**/api/contact/**", r => {
    const name = decodeURIComponent(new URL(r.request().url()).pathname.split("/api/contact/")[1].split("?")[0]);
    return /BEAR CONSTRUCTION/i.test(name)
      ? r.fulfill({ contentType: "application/json", body: JSON.stringify(PROFILE) })
      : r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/" + file, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });
  await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
  await page.evaluate(row => openPermitDetail(row), ROW);
  await page.waitForFunction(() => document.querySelector(".cprincipal") != null, { timeout: 10000 });
  await page.waitForTimeout(250);
  const out = await page.evaluate(AUDIT);
  if (shot) await page.screenshot({ path: shot, fullPage: false });
  await ctx.close();
  return { label: `${file} ${mobile ? "mobile" : "desktop"} ${theme}`, ...out };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const rows = [];
  for (const file of ["list.html", "index.html"]) {
    for (const mobile of [false, true]) {
      for (const theme of ["light", "dark"]) {
        const shot = file === "list.html" ? `verify-tmp/principals_${mobile ? "mobile" : "desktop"}_${theme}.png` : null;
        rows.push(await run(browser, file, mobile, theme, shot));
      }
    }
  }
  const bad = [];
  for (const r of rows) {
    for (const p of r.probes) {
      if (p.contrast < 4.5) bad.push(`${r.label}: ${p.label} contrast ${p.contrast}`);
      if (p.fontPx < 12) bad.push(`${r.label}: ${p.label} font ${p.fontPx}px`);
    }
    if (!r.runByHasWord) bad.push(`${r.label}: "Run by" not carried by a word`);
    const name = r.probes.find(p => p.label === "principal name");
    const lab = r.probes.find(p => p.label === "Run by label");
    // Hierarchy, not just legibility: the person's name is the payload and must
    // read stronger than the scaffolding around it. They measured identical
    // (6.32 both) before .pname existed.
    if (name && lab && name.contrast <= lab.contrast) {
      bad.push(`${r.label}: name (${name.contrast}) does not out-contrast its label (${lab.contrast})`);
    }
    if (r.hScroll) bad.push(`${r.label}: page h-scroll`);
    if (r.modalHScroll) bad.push(`${r.label}: overlay h-scroll`);
    console.log(r.label, JSON.stringify(r.probes.map(p => [p.label, p.contrast, p.fontPx])));
  }
  bad.forEach(b => console.log("BAD " + b));
  console.log(bad.length ? `FAIL ${bad.length}` : "PASS");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
