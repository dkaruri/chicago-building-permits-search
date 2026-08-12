// t35: ui-ux-pro-max pass on the inline "Posting as ___" control (FIX-016).
//
// Inline-in-text targets are exempt from the 44px minimum (WCAG 2.5.8), but
// everything else still applies: contrast in both themes, a visible focus ring,
// an accessible name that says what activating it DOES, and it must not be
// distinguishable by colour alone — the underline carries it for anyone who
// cannot see the primary hue.
const { chromium, devices } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

const ROW = {
  permit_number: "100999888", permit_status: "OPEN", permit_type: "PERMIT - RENOVATION/ALTERATION",
  issue_date: "2026-05-01", address: "123 N TEST ST", ward: "27", reported_cost: "125000",
  total_fee: "900", work_description: "INTERIOR ALTERATIONS 3 UNITS", work_type: "ALTERATION",
  review_type: "STANDARD PLAN REVIEW", community_area: "WEST TOWN", processing_time: "12",
  general_contractors: ["ACME BUILDERS"], open_subs: ["SPARKY ELECTRIC"],
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

    const btn = document.querySelector("[data-posting-as]");
    const cs = getComputedStyle(btn);
    const surface = surfaceOf(btn);
    const sentence = btn.closest("span");
    const sentenceCs = getComputedStyle(sentence);
    const r = btn.getBoundingClientRect();

    return {
      contrast: Number(ratio(parse(cs.color), surface).toFixed(2)),
      // Against the surrounding sentence text: the control must be tellable
      // apart from plain copy WITHOUT relying on hue.
      underlined: cs.textDecorationLine.includes("underline"),
      contrastVsSentence: Number(ratio(parse(cs.color), parse(sentenceCs.color)).toFixed(2)),
      fontPx: Number(cs.fontSize.replace("px", "")),
      sentenceFontPx: Number(sentenceCs.fontSize.replace("px", "")),
      inlineHeight: Math.round(r.height),
      tapWidth: Math.round(r.width),
      accessibleName: btn.getAttribute("aria-label") || btn.textContent,
      nameSaysAction: /change/i.test(btn.getAttribute("aria-label") || ""),
      isRealButton: btn.tagName === "BUTTON" && btn.type === "button",
      cursor: cs.cursor,
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()
`;

async function run(browser, file, mobile, theme) {
  const ctx = mobile
    ? await browser.newContext({ ...devices["iPhone 13"] })
    : await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("chi_permit_author", "Divyam Karuri"));
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [], posts: [] }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/" + file, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });
  await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
  await page.evaluate(row => openPermitDetail(row), ROW);
  await page.waitForSelector("[data-posting-as]", { timeout: 10000 });
  const out = await page.evaluate(AUDIT);
  // :focus-visible is a pseudo-CLASS — getComputedStyle(el, ":focus-visible")
  // does not report it, and programmatic .focus() may not even match it. Drive a
  // real Tab from the textarea and read the plain computed style.
  await page.focus("#pm-note-draft");
  await page.keyboard.press("Tab");
  out.focusRing = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el.hasAttribute("data-posting-as")) return "tab-landed-elsewhere:" + el.tagName;
    const cs = getComputedStyle(el);
    return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2;
  });
  await ctx.close();
  return { label: `${file} ${mobile ? "mobile" : "desktop"} ${theme}`, ...out };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const rows = [];
  for (const file of ["list.html", "index.html"]) {
    for (const mobile of [false, true]) {
      for (const theme of ["light", "dark"]) rows.push(await run(browser, file, mobile, theme));
    }
  }
  for (const r of rows) console.log(JSON.stringify(r));

  const bad = rows.filter(r =>
    r.contrast < 4.5 || !r.underlined || r.fontPx < 12 ||
    r.focusRing !== true || !r.nameSaysAction || !r.isRealButton ||
    r.cursor !== "pointer" || r.hScroll ||
    // inline target: exempt from 44px, but must not be a hairline either
    r.inlineHeight < 16 || r.tapWidth < 24);
  console.log(bad.length ? `FAIL ${bad.length}` : "PASS");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
