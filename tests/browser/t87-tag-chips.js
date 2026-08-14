// t87 — FIX-039. The List details dialog's tag control.
//
// The old control was a bare <input> holding a comma-separated string: the only
// thing telling you a comma starts a second tag was a hint below the box, and
// while you were editing, tags were text rather than objects. This suite drives
// the chip input with REAL keys and REAL clicks, and asserts geometry rather
// than DOM presence — a chip that exists but renders full-width, one per row,
// is FIX-019's bug and passes any presence check.
//
//   node tests/browser/t87-tag-chips.js
//   BASE=https://…github.io/… node tests/browser/t87-tag-chips.js
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const ROWS = [
  { permit_number: "101082609", address: "3701 W AINSLIE ST", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", ward: "39", reported_cost: 120000, lat: 41.97, lon: -87.72, general_contractors: "BEAR CONSTRUCTION" },
];

// `roofing` is already in the registry at slot 7; `masonry` is not. That split
// is what proves an existing tag keeps its agreed colour while a new one takes
// the picker's.
const REGISTRY = { roofing: 7, masonry: 3 };

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

// WCAG relative luminance, from whatever the browser actually computed — the
// point is to catch a token that fails in ONE theme, so nothing may be assumed.
const CONTRAST = `(fg, bg) => {
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = s => { const [r, g, b] = s.match(/\\d+(\\.\\d+)?/g).map(Number); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  const a = lum(fg), b2 = lum(bg);
  return Math.round(((Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05)) * 100) / 100;
}`;

const names = page => page.$$eval("#ld-tagchips .tag", els =>
  els.map(el => el.textContent.replace(/×\s*$/, "").trim()));

// Everything a chip has to be, measured: its box, its remove button's box, and
// the text on that button (which is what carries the colour word).
const chipGeom = page => page.$$eval("#ld-tagchips .tag", els => els.map(el => {
  const r = el.getBoundingClientRect();
  const x = el.querySelector(".tagedit-x");
  const xr = x ? x.getBoundingClientRect() : null;
  return {
    w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top),
    xw: xr ? Math.round(xr.width) : 0, xh: xr ? Math.round(xr.height) : 0,
    xLabel: x ? x.getAttribute("aria-label") : null,
    tc: getComputedStyle(el).color,
  };
}));

async function openDetails(page, tags) {
  await page.evaluate(async tags => {
    state.lists.L.tags = tags;
    state.lists.L.sharedId = "SHARED1";
    await openListDetails("L");
  }, tags);
  await page.waitForSelector("#ld-tag-entry", { timeout: 10000 });
}

async function type(page, text) {
  await page.click("#ld-tag-entry");
  await page.keyboard.type(text);
}

async function run(viewport, label, theme) {
  console.log(`\n== ${label} · ${theme} ==`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport, colorScheme: theme });
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("requestfailed", r => { if (/\/api\//.test(r.url())) errs.push(`unstubbed ${r.method()} ${r.url()}`); });
  let saved = null;
  await page.route(/\/api\/tags/, r => r.request().method() === "GET"
    ? r.fulfill({ json: { tags: REGISTRY } })
    : r.fulfill({ json: { ok: true } }));
  // A RegExp, not a glob. `**/api/lists*` matched the directory's GET but NOT
  // the PUT to /api/lists/SHARED1, so the save fell through to the real Worker,
  // took a 404, and this suite reported a product failure that was its own
  // stub. A probe that reports failure has to be shown to report success first.
  await page.route(/\/api\/lists/, r => {
    if (r.request().method() === "PUT" || r.request().method() === "POST") {
      saved = JSON.parse(r.request().postData() || "{}");
      return r.fulfill({ json: { id: "SHARED1" } });
    }
    return r.fulfill({ json: { lists: [] } });
  });
  await page.route("**/api/notes/**", r => r.fulfill({ json: { threads: {}, counts: {} } }));
  await openList(page);
  await page.evaluate(t => { try { localStorage.setItem("chi_permit_theme", t); } catch {} }, theme);
  await seedSavedList(page, ROWS);

  // ---- 1. an already-tagged list arrives as chips (the migration case) ----
  await openDetails(page, [["roofing", 7], ["masonry", 3]]);
  check("an existing list's tags open as chips, not as a comma string",
    JSON.stringify(await names(page)) === JSON.stringify(["roofing", "masonry"]),
    JSON.stringify(await names(page)));
  check("the old comma text field is gone", await page.$("#ld-tags") === null);

  let geom = await chipGeom(page);
  // The whole point of a chip: it hugs its text. FIX-013/019 is the global
  // `button { width: 100% }` catching a button that is not a form control.
  const box = await page.$eval("#ld-tagedit", el => Math.round(el.getBoundingClientRect().width));
  check("chips hug their text rather than spanning the box",
    geom.every(g => g.w < box * 0.75), `box ${box}px, chips ${geom.map(g => g.w).join("/")}`);
  check("two chips share one row",
    geom.length === 2 && geom[0].top === geom[1].top, JSON.stringify(geom.map(g => g.top)));
  // The entry has to FLOW after the chips, not sit on its own row under them:
  // "type the next one right here" is the whole affordance that replaces the
  // comma rule. `.dlg-field input { width: 100% }` puts it on its own line and
  // every other assertion in this suite still passes — a surviving mutant
  // named this gap rather than a spare rule.
  //
  // Only asserted where there is ROOM for it. On a 390px phone the box is
  // ~324px and two chips fill it, so the entry wrapping to the next line is
  // correct behaviour and indistinguishable from the bug — asserting it there
  // would be measuring the viewport, not the rule.
  const entryBox = await page.$eval("#ld-tag-entry", el => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), w: Math.round(r.width) };
  });
  const lastChip = await page.$$eval("#ld-tagchips .tag", els => {
    const r = els[els.length - 1].getBoundingClientRect();
    return { right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
  });
  const boxRight = await page.$eval("#ld-tagedit", el => Math.round(el.getBoundingClientRect().right));
  const room = boxRight - lastChip.right;
  if (room >= 128) {
    check("with room beside the chips, the entry flows after them instead of onto its own row",
      entryBox.top < lastChip.bottom && entryBox.w < box * 0.9,
      `entry top ${entryBox.top} w ${entryBox.w}, chip row ${lastChip.top}-${lastChip.bottom}, ${room}px of room, box ${box}`);
  } else {
    console.log(`  --   entry-flows check skipped: only ${room}px beside the last chip`);
  }
  check("an existing tag keeps the registry's colour, a chip is not recoloured on open",
    await page.$eval("#ld-tagchips .tag", el => el.getAttribute("style").includes("--t7")));

  // ---- 2. adding a second and third tag needs no comma and no instructions --
  await type(page, "gut rehab");
  await page.keyboard.press("Enter");
  check("Enter commits a tag", (await names(page)).includes("gut rehab"), JSON.stringify(await names(page)));
  check("the entry box is empty and ready for the next one",
    await page.$eval("#ld-tag-entry", el => el.value) === "");
  check("committing announces itself to a screen reader",
    /gut rehab added, 3 of 8/.test(await page.$eval("#ld-tag-live", el => el.textContent)),
    await page.$eval("#ld-tag-live", el => el.textContent));
  check("the hint counts what you have rather than teaching comma syntax",
    /3 of 8/.test(await page.$eval("#ld-tag-help", el => el.textContent)),
    await page.$eval("#ld-tag-help", el => el.textContent));

  // A comma still works — it was the documented way for months.
  await type(page, "north side,");
  check("a typed comma still commits, so the old habit is not broken",
    (await names(page)).includes("north side"), JSON.stringify(await names(page)));

  // ---- 3. the colour picker, and colour never being the only signal ----
  check("the picker appears for a name the registry has never seen",
    await page.$eval("#ld-newtag", el => el.hidden) === false);
  await page.click('.slotbtn[data-slot="5"]');
  geom = await chipGeom(page);
  check("choosing a colour recolours the new chips immediately",
    await page.$$eval("#ld-tagchips .tag", els =>
      els.slice(2).every(el => el.getAttribute("style").includes("--t5"))));
  check("the registry's own tags are NOT recoloured by that choice",
    await page.$$eval("#ld-tagchips .tag", els =>
      els[0].getAttribute("style").includes("--t7") && els[1].getAttribute("style").includes("--t3")));
  check("every chip names its colour in words, so the swatch is never alone",
    geom.every(g => /Remove tag .+, (red|orange|olive|green|teal|blue|indigo|purple|magenta|slate)$/.test(g.xLabel || "")),
    JSON.stringify(geom.map(g => g.xLabel)));
  check("the colour swatches in the picker are named too, not just numbered",
    await page.$eval('.slotbtn[data-slot="0"]', el => el.getAttribute("aria-label")) === "red, colour 1 of 10");

  // ---- 4. removing one, by mouse and by keyboard ----
  await page.click('#ld-tagchips .tag:nth-child(2) .tagedit-x');
  check("clicking a chip's remove button removes THAT chip",
    JSON.stringify(await names(page)) === JSON.stringify(["roofing", "gut rehab", "north side"]),
    JSON.stringify(await names(page)));
  check("removal is announced",
    /masonry removed, 3 of 8/.test(await page.$eval("#ld-tag-live", el => el.textContent)),
    await page.$eval("#ld-tag-live", el => el.textContent));
  check("focus lands on the entry box, not on <body>",
    await page.evaluate(() => document.activeElement && document.activeElement.id) === "ld-tag-entry",
    await page.evaluate(() => document.activeElement && document.activeElement.id));

  await page.keyboard.press("Backspace");
  check("Backspace in an empty box removes the last chip",
    JSON.stringify(await names(page)) === JSON.stringify(["roofing", "gut rehab"]),
    JSON.stringify(await names(page)));

  // Every remove button must be reachable by Tab — a chip you can only delete
  // with a mouse is not a replacement for editing text.
  await page.evaluate(() => document.getElementById("ld-tag-entry").focus());
  const reachable = await page.evaluate(() => {
    const stops = [];
    const all = [...document.querySelectorAll("#list-details button, #list-details input, #list-details textarea")]
      .filter(e => !e.disabled && e.tabIndex >= 0);
    for (const el of all) if (el.classList.contains("tagedit-x")) stops.push(el.getAttribute("aria-label"));
    return stops;
  });
  check("both remove buttons are in the tab order", reachable.length === 2, JSON.stringify(reachable));

  // ---- 5. the cap still holds, and says so ----
  for (const t of ["a1", "a2", "a3", "a4", "a5", "a6", "a7"]) { await type(page, t); await page.keyboard.press("Enter"); }
  check("the cap of 8 holds", (await names(page)).length === 8, String((await names(page)).length));
  check("at the cap the hint explains what to do",
    /remove one/i.test(await page.$eval("#ld-tag-help", el => el.textContent)),
    await page.$eval("#ld-tag-help", el => el.textContent));
  // A control that still accepts keystrokes must not claim to be disabled —
  // by either route. Playwright's own actionability check is the witness: an
  // aria-disabled field here made this suite hang for 30s waiting to click it.
  check("the full entry box is neither disabled nor claiming to be",
    await page.$eval("#ld-tag-entry", el => el.disabled === false && !el.hasAttribute("aria-disabled")));
  check("the cap explanation is what the field points its description at",
    await page.$eval("#ld-tag-entry", el => el.getAttribute("aria-describedby")) === "ld-tag-help");
  await type(page, "overflow");
  await page.keyboard.press("Enter");
  check("a 9th tag is refused with a reason, not silently dropped",
    (await names(page)).length === 8 && /limit/i.test(await page.$eval("#ld-tag-live", el => el.textContent)),
    await page.$eval("#ld-tag-live", el => el.textContent));

  // ---- 6. geometry and legibility ----
  geom = await chipGeom(page);
  check("every remove button is a 44x44 target",
    geom.every(g => g.xw >= 44 && g.xh >= 44), JSON.stringify(geom.map(g => `${g.xw}x${g.xh}`)));
  const fs = await page.$eval("#ld-tag-entry", el => parseFloat(getComputedStyle(el).fontSize));
  check("the entry is at least 16px, so iOS does not zoom on focus", fs >= 16, `${fs}px`);
  const dlgW = await page.$eval("#list-details", el => el.getBoundingClientRect().width);
  const overflow = await page.$eval("#ld-tagedit", el => el.scrollWidth - el.clientWidth);
  check("eight chips wrap inside the dialog instead of scrolling sideways",
    overflow <= 1 && dlgW <= viewport.width, `overflow ${overflow}px, dialog ${Math.round(dlgW)} of ${viewport.width}`);
  check("the page itself never scrolls sideways with the dialog open",
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  const contrast = await page.evaluate(fn => {
    const c = eval(`(${fn})`);
    const chip = document.querySelector("#ld-tagchips .tag");
    const bg = getComputedStyle(document.getElementById("ld-tagedit")).backgroundColor;
    const hint = document.getElementById("ld-tag-help");
    return {
      chip: c(getComputedStyle(chip).color, bg),
      hint: c(getComputedStyle(hint).color, getComputedStyle(document.getElementById("list-details")).backgroundColor),
    };
  }, CONTRAST);
  check("chip text clears 4.5:1 against the field it sits in", contrast.chip >= 4.5, `${contrast.chip}:1`);
  check("the hint clears 4.5:1", contrast.hint >= 4.5, `${contrast.hint}:1`);

  // The focus ring has to be on the box the user sees, not swallowed.
  await page.evaluate(() => document.getElementById("ld-tag-entry").focus());
  check("focusing the entry rings the whole control",
    await page.$eval("#ld-tagedit", el => {
      const s = getComputedStyle(el);
      return parseFloat(s.outlineWidth) >= 2 && s.outlineStyle !== "none";
    }));

  // ---- 7. what gets SAVED is unchanged in shape, and loses nothing ----
  await page.evaluate(() => {
    const box = document.getElementById("ld-tagchips");
    // Down to two chips, so the payload is small enough to read.
    [...box.querySelectorAll(".tagedit-x")].slice(2).reverse().forEach(b => b.click());
  });
  await type(page, "pending");           // typed, deliberately NOT committed
  await page.click("#ld-save");
  await page.waitForFunction(() => !document.getElementById("list-details").open, null, { timeout: 10000 })
    .catch(async () => check("the save went through", false,
      await page.$eval("#ld-error", el => el.textContent) || "dialog stayed open"));
  check("save keeps the stored shape: [name, slot] pairs",
    Array.isArray(saved && saved.tags) && saved.tags.every(p => Array.isArray(p) && typeof p[0] === "string" && Number.isInteger(p[1])),
    JSON.stringify(saved && saved.tags));
  check("a tag typed but not committed is still saved, not dropped",
    (saved.tags || []).some(p => p[0] === "pending"), JSON.stringify(saved.tags));
  check("the registry's slot survived the round trip",
    (saved.tags || []).some(p => p[0] === "roofing" && p[1] === 7), JSON.stringify(saved.tags));

  check("no page errors", errs.length === 0, errs.join(" | "));
  await browser.close();
}

(async () => {
  for (const theme of ["light", "dark"]) {
    await run({ width: 1280, height: 900 }, "desktop 1280", theme);
    await run({ width: 390, height: 844 }, "iPhone 13 390", theme);
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nall green");
  process.exit(failures ? 1 : 0);
})();
