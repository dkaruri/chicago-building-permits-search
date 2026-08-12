// t83 — FIX-051. The "1-20 of 40,868 shown" count label overran .panel at
// ~660px and pushed the whole DOCUMENT sideways. The page must never scroll
// horizontally at any width; the table is allowed to, inside .table-wrap.
//
// Sweeps every width from 641 (just above the stacked breakpoint) to 1120 on
// all three pages, since the panel markup is shared. Reports the offending
// element, not just a number — a bare "it scrolls" is what made this take two
// passes to place the first time.
//
//   node verify-tmp/t83-count-overflow.js            (local preview on 8791)
//   BASE=https://…github.io/… node verify-tmp/t83-count-overflow.js
const { chromium, CHROME } = require("./_boot");

const BASE = process.env.BASE || "http://localhost:8791";
const PAGES = ["index.html", "list.html", "map.html"];
// 600/630 are below the 640px stacked breakpoint, where a media query already
// released the floor; 714/715/716 bracket the top of the band, which is where
// the document's 715px minimum stopped exceeding the viewport.
const WIDTHS = [600, 630, 641, 645, 660, 680, 700, 714, 715, 716, 760, 820, 900, 1000, 1120];

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

// Widest element whose right edge overruns the document, so a failure names a
// culprit. .table-wrap and anything inside it is excluded by design: it is an
// overflow:auto scroller and its content is supposed to be wider than it is.
const WIDEST = () => {
  const docW = document.documentElement.clientWidth;
  let worst = null;
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(".table-wrap")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const over = Math.round(r.right - docW);
    if (over > 1 && (!worst || over > worst.over)) {
      worst = { over, tag: el.tagName.toLowerCase(), cls: el.className && String(el.className).slice(0, 40),
        w: Math.round(r.width), text: (el.textContent || "").trim().slice(0, 40) };
    }
  }
  return worst;
};

async function run(page, path) {
  console.log(`\n== ${path} ==`);
  await page.goto(`${BASE}/${path}`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    // Let layout settle, then read scroll width and client width in ONE task so
    // the pair can never come from different layouts.
    const m = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
      const d = document.documentElement;
      res({ scrollW: d.scrollWidth, clientW: d.clientWidth });
    }))));
    const over = m.scrollW - m.clientW;
    const worst = over > 1 ? await page.evaluate(WIDEST) : null;
    check(`${width}px: the page does not scroll sideways`, over <= 1,
      `scrollWidth ${m.scrollW} vs clientWidth ${m.clientW} (+${over})` + (worst ? ` · widest overrun: <${worst.tag} class="${worst.cls}"> ${worst.w}px "${worst.text}"` : ""));
  }
}

// The count label is the NARROW case. The wide case is a live selection, which
// puts a nowrap "N selected · Add to list" button in the same box — and that
// button is the whole reason the 280px reservation exists, so this also proves
// the reservation still does its job. Both halves matter: a fix that stopped
// the page scrolling by dropping the reservation would trade this bug for a
// layout jump.
async function withSelection(page) {
  console.log(`\n== index.html, with a selection active (the widest content) ==`);
  await page.goto(`${BASE}/index.html`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });
  await page.setViewportSize({ width: 1280, height: 900 });
  // The page opens on general_contractors, which has no select column — the
  // selection UI lives in open_permits. Driven through setMode rather than the
  // tab button: the tab is not the visible control at every width (a select
  // replaces it), and this suite is about layout, not about the tab.
  await page.evaluate(() => setMode("open_permits"));
  await page.waitForSelector(".results-table .select-cell input", { timeout: 30000 });

  const geom = () => {
    const t = document.getElementById("results-title").getBoundingClientRect();
    // NOT document.querySelector(".panel-head") — the first one on the page is
    // the hidden user-list head, which measures 0 and makes the height check
    // pass no matter what. Take the head this label actually lives in.
    const h = document.getElementById("result-count").closest(".panel-head").getBoundingClientRect();
    return { titleX: Math.round(t.x), titleY: Math.round(t.y), headH: Math.round(h.height) };
  };
  const before = await page.evaluate(geom);
  // The whole cell is the target by design (FIX-029), and it intercepts a click
  // aimed at the checkbox — so click the cell.
  await page.click(".results-table tbody .select-cell");
  await page.waitForSelector("#result-count button", { timeout: 10000 });
  const after = await page.evaluate(geom);
  check("selecting a permit does not move the panel title sideways (the width reservation holds)",
    before.titleX === after.titleX, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  // A reservation names an axis — check the one it does NOT name. The 280px
  // reserved width only, so the 44px button still grew the head 20px -> 44px
  // and shoved the table down 12px. Both axes are asserted here: the box is
  // reserved, or it is not reserved.
  check("selecting a permit does not move the panel title down (the height reservation holds)",
    before.titleY === after.titleY, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  check("selecting a permit does not change the head height at desktop width",
    before.headH === after.headH, `${before.headH} -> ${after.headH}`);
  check("the add-to-list button still meets the 44px touch target",
    await page.$eval("#result-count button", el => el.getBoundingClientRect().height) >= 44);

  // Selection stays active across the sweep, so every width is measured with
  // the button present.
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const m = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
      const d = document.documentElement;
      res({ scrollW: d.scrollWidth, clientW: d.clientWidth, btn: !!document.querySelector("#result-count button") });
    }))));
    const over = m.scrollW - m.clientW;
    const worst = over > 1 ? await page.evaluate(WIDEST) : null;
    check(`${width}px with the button present: no sideways scroll`, over <= 1 && m.btn,
      `scrollWidth ${m.scrollW} vs clientWidth ${m.clientW} (+${over}), button ${m.btn}` + (worst ? ` · widest overrun: <${worst.tag} class="${worst.cls}"> ${worst.w}px "${worst.text}"` : ""));
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 660, height: 900 } });
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ json: [{ lat: "41.9", lon: "-87.7", display_name: "stub" }] }));
  for (const p of PAGES) await run(page, p);
  await withSelection(page);
  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
