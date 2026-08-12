// t33: ui-ux-pro-max pass on the over-the-cap Optimize route state.
//
// The risk in dimming a control with opacity is that BOTH its text and its
// background composite against the surface behind, so the real contrast is not
// the token contrast. WCAG exempts genuinely disabled controls — but this one is
// aria-disabled and still focusable, so it must stay legible. The note carries
// the actual meaning, so it is held to the full 4.5:1.
const { chromium, devices } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

// Read the ceiling out of docs/list.html instead of hardcoding it. This suite
// hardcoded 400/401 and went red the moment FEAT-035 raised the cap to 500 --
// the behaviour was correct, the test had simply outlived the number. Derived,
// it tracks whatever ships.
const MAX_SORT_STOPS = Number(
  /const MAX_SORT_STOPS = (\d+);/.exec(
    require("fs").readFileSync(require("path").join(__dirname, "..", "..", "docs", "list.html"), "utf8"),
  )[1],
);


const seed = n => `
  state.focalPoint = null;
  state.userPermitMap = new Map();
  state.userPermitNumbers = [];
  state.lists = { L: { name: "Big", permits: [], focal: null, sharedId: null } };
  state.activeListId = "L";
  for (let i = 0; i < ${n}; i += 1) {
    const num = "P" + String(i).padStart(4, "0");
    state.userPermitMap.set(num, {
      permit_number: num,
      latitude: 41.7 + ((i * 37) % 100) / 400,
      longitude: -87.8 + ((i * 53) % 100) / 400,
      address: i + " TEST ST", permit_status: "ACTIVE",
    });
    state.userPermitNumbers.push(num);
    state.lists.L.permits.push(num);
  }
`;

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
    // Walk up for the first non-transparent background.
    const surfaceOf = el => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) return parse(bg);
      }
      return [255, 255, 255];
    };
    const composite = (fg, bg, a) => fg.map((v, i) => v * a + bg[i] * (1 - a));

    const btn = document.getElementById("optimize-route-btn");
    const note = document.getElementById("optimize-route-note");
    const cs = getComputedStyle(btn);
    const alpha = Number(cs.opacity);
    const surface = surfaceOf(btn);
    // The whole button is faded, so text AND background both composite.
    const textEff = composite(parse(cs.color), surface, alpha);
    const bgEff = composite(parse(cs.backgroundColor), surface, alpha);

    const noteCs = getComputedStyle(note);
    const noteBg = /rgba\\(0, 0, 0, 0\\)|transparent/.test(noteCs.backgroundColor)
      ? surfaceOf(note) : parse(noteCs.backgroundColor);

    const r = btn.getBoundingClientRect();
    const noteR = note.getBoundingClientRect();
    return {
      opacity: alpha,
      buttonContrast: Number(ratio(textEff, bgEff).toFixed(2)),
      noteContrast: Number(ratio(parse(noteCs.color), noteBg).toFixed(2)),
      target: { w: Math.round(r.width), h: Math.round(r.height) },
      noteFontPx: Number(noteCs.fontSize.replace("px", "")),
      noteWithinViewport: noteR.right <= innerWidth + 1 && noteR.left >= -1,
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      focusVisible: (() => {
        btn.focus();
        const f = getComputedStyle(btn, ":focus-visible");
        return f.outlineStyle !== "none" || f.boxShadow !== "none";
      })(),
      // Meaning must not rest on colour alone.
      noteHasText: (note.textContent || "").trim().length > 20,
    };
  })()
`;

async function run(browser, viewport, theme) {
  const ctx = viewport
    ? await browser.newContext({ ...devices["iPhone 13"] })
    : await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
  await page.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 0, cached_at: "2026-07-28" }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/list.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });
  await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
  await page.evaluate(async s => { eval(s); await showList("L"); }, seed(MAX_SORT_STOPS + 1));
  // Setting data-theme TRANSITIONS every themed colour. Reading mid-flight
  // reports a colour that is part-way between the two themes: this measured
  // 4.42:1 once, under machine load, for a button whose computed style is
  // byte-identical to the one that measures 6.32:1 on three quiet runs. Never a
  // fixed delay — wait for the animations themselves.
  await page.waitForFunction(
    () => [...document.querySelectorAll("*")].every(e => e.getAnimations().every(a => a.playState !== "running")),
    { timeout: 5000 },
  ).catch(() => {});
  const out = await page.evaluate(AUDIT);
  await ctx.close();
  return { label: `${viewport ? "mobile" : "desktop"} ${theme}`, ...out };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const rows = [];
  for (const vp of [false, true]) for (const theme of ["light", "dark"]) rows.push(await run(browser, vp, theme));
  for (const r of rows) console.log(JSON.stringify(r));

  const bad = rows.filter(r =>
    r.buttonContrast < 4.5 || r.noteContrast < 4.5 ||
    r.target.h < 44 || r.noteFontPx < 12 ||
    !r.noteWithinViewport || r.hScroll || !r.focusVisible || !r.noteHasText);
  console.log(bad.length ? `FAIL ${bad.length}` : "PASS");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
