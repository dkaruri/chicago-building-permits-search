// t43 (FIX-013 + FIX-019): tag chips must hug their text, not the container.
//
// Cause: the global `button, input, select, textarea { width: 100% }` rule
// catches every <button class="tag">, so each filter chip rendered as a
// full-width block — measured 1039px on desktop and 348px on mobile, one per
// row. Sibling <span class="tag"> chips were never affected, which is why only
// some tag pills looked wrong. Same trap as FIX-016's inline button: a button
// that is not a form control must opt out of BOTH width and min-height.
//
// A. no chip is anywhere near the container width, at either viewport
// B. chips of different text lengths have DIFFERENT widths — the real proof
//    they size to content, which a fixed max-width would also pass
// C. several chips share a row (they wrap, not stack)
// D. touch targets stay >= 44px high on mobile
// E. the pressed-state marker is a real tick, not the mojibake it used to be
const { chromium, devices } = require("playwright");
const EXE = "C:/Users/divya/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";

const TAGS = ["Hot", "Called back", "A considerably longer tag name than the others"];

async function measure(browser, mobile) {
  const ctx = mobile
    ? await browser.newContext({ ...devices["iPhone 13"] })
    : await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [], posts: [] }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/list.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });

  const out = await page.evaluate(tags => {
    const row = document.getElementById("dir-tags");
    row.hidden = false;
    row.style.display = "flex";
    row.innerHTML = tags.map((n, i) =>
      `<button class="tag" type="button" aria-pressed="${i === 1}" style="--tc:var(--t${i + 1})"><span class="swatch"></span>${n}</button>`).join("");
    const btns = [...row.querySelectorAll("button.tag")];
    const rects = btns.map(b => b.getBoundingClientRect());
    const rowRect = row.getBoundingClientRect();
    return {
      rowWidth: Math.round(rowRect.width),
      widths: rects.map(r => Math.round(r.width)),
      heights: rects.map(r => Math.round(r.height)),
      // Distinct top offsets = how many rows the chips occupy.
      rowsUsed: new Set(rects.map(r => Math.round(r.top))).size,
      pressedMarker: getComputedStyle(btns[1], "::before").content,
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  }, TAGS);
  await ctx.close();
  return { label: mobile ? "mobile" : "desktop", ...out };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const bad = [];
  for (const mobile of [false, true]) {
    const r = await measure(browser, mobile);
    console.log(`${r.label}: row=${r.rowWidth} chips=${JSON.stringify(r.widths)} h=${JSON.stringify(r.heights)} rowsUsed=${r.rowsUsed} marker=${r.pressedMarker}`);

    // A: nothing may fill the container.
    for (const w of r.widths) {
      if (w >= r.rowWidth - 8) bad.push(`${r.label}: a chip is ${w}px in a ${r.rowWidth}px row — still full width`);
    }
    // B: different text, different width. A fixed cap would pass A but not this.
    if (new Set(r.widths).size !== r.widths.length) {
      bad.push(`${r.label}: chips of different lengths share a width ${JSON.stringify(r.widths)} — not sized to content`);
    }
    if (!(r.widths[0] < r.widths[1] && r.widths[1] < r.widths[2])) {
      bad.push(`${r.label}: widths not ordered by text length ${JSON.stringify(r.widths)}`);
    }
    // C: they wrap as a chip row rather than stacking one per line.
    if (r.rowsUsed >= TAGS.length) bad.push(`${r.label}: chips occupy ${r.rowsUsed} rows for ${TAGS.length} chips — stacked, not wrapped`);
    // D: touch targets.
    if (r.label === "mobile" && r.heights.some(h => h < 44)) {
      bad.push(`mobile: chip height ${JSON.stringify(r.heights)} below the 44px target`);
    }
    // E: a real tick, and definitely not the old mojibake.
    if (!/\u2713/.test(r.pressedMarker)) bad.push(`${r.label}: pressed marker is ${r.pressedMarker}, expected a tick`);
    if (/\u00b9/.test(r.pressedMarker)) bad.push(`${r.label}: pressed marker still contains the mojibake character`);
    if (r.hScroll) bad.push(`${r.label}: page scrolls horizontally`);
  }
  bad.forEach(b => console.log("BAD " + b));
  console.log(bad.length ? `FAIL ${bad.length}` : "PASS");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
