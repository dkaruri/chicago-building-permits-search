// FIX-003 — Speed up permit removal in My Permit List and stop accidental opens.
//
// Guards three things:
//   1. a click anywhere in the Remove CELL (not just on the button) never falls
//      through to the row's open handler — the desktop cell is 60x110 around a
//      44x44 button, so most of it used to open the permit;
//   2. removal is instant (no window.confirm) and offers an Undo that restores
//      the permit at its ORIGINAL stop number with its note;
//   3. rapid successive removals leave state and localStorage in agreement.
//
// Runs at desktop and iPhone 13. Revert either half of the fix and this fails.
const { devices } = require("playwright");
const { chromium, CHROME, openList, seedSavedList } = require("./_boot.js");

const ROWS = [1, 2, 3, 4].map(i => ({
  permit_number: `10000${i}`, permit_type: "PERMIT - RENOVATION", permit_status: "ACTIVE",
  issue_date: `2026-01-0${i}`, address: `${i}00 W TEST ST`, ward: "1",
  reported_cost: 1000 * i, work_type: "RENOVATION", latitude: 41.9, longitude: -87.7
}));

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

const listPermits = page => page.evaluate(() => state.userPermitNumbers.slice());
const storedPermits = page => page.evaluate(() =>
  (JSON.parse(localStorage.getItem("chi_permit_lists") || "{}").lists || {}).L?.permits || []);
const cardOpen = page => page.evaluate(() => { try { return !!activeCard(); } catch { return false; } });

async function removeCellBox(page) {
  return page.evaluate(() => {
    const td = document.querySelector('.saved-permits-table tbody tr td[data-label="Remove"]');
    const btn = td.querySelector("button");
    const t = td.getBoundingClientRect(), b = btn.getBoundingClientRect();
    return { td: { x: t.x, y: t.y, w: t.width, h: t.height }, btn: { x: b.x, y: b.y, w: b.width, h: b.height } };
  });
}

async function run(label, ctxOpts) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();

  // A confirm() would be auto-dismissed by Playwright and silently do nothing;
  // catching the event is how we prove the dialog is gone rather than ignored.
  let dialogs = 0;
  page.on("dialog", d => { dialogs++; d.dismiss(); });

  await openList(page);
  await seedSavedList(page, ROWS);
  await page.evaluate(() => { state.userPermitNotes["100002"] = "call the GC"; saveUserNotes(); });

  // --- 1. the Remove cell absorbs its own clicks -------------------------
  const geo = await removeCellBox(page);
  const halo = [];
  if (geo.btn.y - geo.td.y > 2) halo.push(["above", geo.btn.x + geo.btn.w / 2, geo.td.y + 1]);
  if (geo.td.y + geo.td.h - (geo.btn.y + geo.btn.h) > 2) halo.push(["below", geo.btn.x + geo.btn.w / 2, geo.td.y + geo.td.h - 1]);
  if (geo.btn.x - geo.td.x > 2) halo.push(["left", geo.td.x + 1, geo.btn.y + geo.btn.h / 2]);
  if (geo.td.x + geo.td.w - (geo.btn.x + geo.btn.w) > 2) halo.push(["right", geo.td.x + geo.td.w - 1, geo.btn.y + geo.btn.h / 2]);

  check("Remove cell has a halo around the button", halo.length > 0,
    `cell ${Math.round(geo.td.w)}x${Math.round(geo.td.h)}, button ${Math.round(geo.btn.w)}x${Math.round(geo.btn.h)}, ${halo.length} edges`);

  for (const [side, x, y] of halo) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
    const opened = await cardOpen(page);
    check(`click ${side} of the button does not open the permit`, !opened);
    if (opened) { await page.evaluate(() => closePermitModal()); await page.waitForTimeout(200); }
    const still = await listPermits(page);
    check(`click ${side} of the button removes nothing`, still.length === 4, `${still.length} left`);
  }

  // Control: the row itself must still open the permit.
  await page.click('.saved-permits-table tbody tr td[data-label="Status"]');
  await page.waitForTimeout(350);
  check("CONTROL: clicking the row body still opens the permit", await cardOpen(page));
  await page.evaluate(() => closePermitModal());
  await page.waitForTimeout(250);

  // --- 2. instant removal, no dialog -------------------------------------
  await page.click('.saved-permits-table tbody tr td[data-label="Remove"] button');
  await page.waitForTimeout(400);
  check("removing does not raise a confirm dialog", dialogs === 0, `${dialogs} dialog(s)`);
  let after = await listPermits(page);
  check("permit removed on the first click", after.join(",") === "100002,100003,100004", after.join(","));
  check("removal reached localStorage", (await storedPermits(page)).join(",") === after.join(","));
  check("removing does not open the permit", !(await cardOpen(page)));

  // --- 3. Undo restores position and note --------------------------------
  const undo = page.locator("#list-action-status button.linkish");
  check("an Undo control is offered", await undo.count() === 1);
  const undoBox = await undo.boundingBox();
  check("Undo is visible on screen", !!undoBox && undoBox.width > 0 && undoBox.height > 0);
  check("Undo is at least 44x44", undoBox.width >= 44 && undoBox.height >= 44,
    `${Math.round(undoBox.width)}x${Math.round(undoBox.height)}`);
  // Reached by Tab from a known neighbour, so this also proves it is in the tab
  // order — getComputedStyle(el, ":focus-visible") silently reports nothing.
  await page.evaluate(() => document.getElementById("focal-input").focus());
  let hops = 0, onUndo = false;
  while (hops++ < 12 && !onUndo) {
    await page.keyboard.press("Tab");
    onUndo = await page.evaluate(() => document.activeElement?.classList.contains("linkish")
      && document.activeElement.closest("#list-action-status") !== null);
  }
  check("Undo is keyboard reachable", onUndo, `${hops} tabs`);

  for (const theme of ["light", "dark"]) {
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
    // Reading mid-transition reports a colour the element never settles at —
    // this trap has produced two false contrast failures on this page already.
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"),
      null, { timeout: 5000 }).catch(() => {});
    const ratio = await page.evaluate(() => {
      const el = document.querySelector("#list-action-status .linkish");
      const parse = s => {
        const n = s.match(/[\d.]+/g).map(Number);
        return s.startsWith("color(") ? n.slice(0, 3).map(v => v * 255) : n.slice(0, 3);
      };
      const lum = c => {
        const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      let bgNode = el, bg = null;
      while (bgNode && !bg) {
        const c = getComputedStyle(bgNode).backgroundColor;
        if (c && !/rgba?\([^)]*,\s*0\)/.test(c) && c !== "transparent") bg = parse(c);
        bgNode = bgNode.parentElement;
      }
      const a = lum(parse(getComputedStyle(el).color)), b = lum(bg || [255, 255, 255]);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      return { ratio, fg: getComputedStyle(el).color, bg: bg && `rgb(${bg.map(Math.round)})` };
    });
    check(`Undo contrast >= 4.5:1 (${theme})`, ratio.ratio >= 4.5,
      `${ratio.ratio.toFixed(2)}:1  fg ${ratio.fg} on ${ratio.bg}`);
  }
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
  await undo.click();
  await page.waitForTimeout(400);
  after = await listPermits(page);
  check("Undo restores the permit at its original stop number",
    after.join(",") === "100001,100002,100003,100004", after.join(","));
  check("Undo reached localStorage", (await storedPermits(page)).join(",") === after.join(","));

  // Undo must restore the note it deleted, too.
  await page.click('.saved-permits-table tbody tr:nth-child(2) td[data-label="Remove"] button');
  await page.waitForTimeout(350);
  check("note deleted with the permit",
    await page.evaluate(() => state.userPermitNotes["100002"] === undefined));
  await page.locator("#list-action-status button.linkish").click();
  await page.waitForTimeout(400);
  check("Undo restores the permit's note",
    await page.evaluate(() => state.userPermitNotes["100002"] === "call the GC"));

  // --- 4. rapid successive removals stay in sync -------------------------
  await page.evaluate(async () => {
    // No awaiting between them: this is the "tap tap tap down the list" case.
    removePermitFromUserList("100001");
    removePermitFromUserList("100003");
    removePermitFromUserList("100004");
  });
  await page.waitForTimeout(900);
  after = await listPermits(page);
  check("three rapid removals leave exactly the untouched permit",
    after.join(",") === "100002", after.join(","));
  check("rapid removals agree with localStorage",
    (await storedPermits(page)).join(",") === after.join(","), (await storedPermits(page)).join(","));
  const rendered = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.saved-permits-table tbody tr td[data-label="Permit"] strong')).map(n => n.textContent.trim()));
  check("the rendered table agrees with state", rendered.join(",") === after.join(","), rendered.join(","));

  // --- 5. touch target ---------------------------------------------------
  const btnBox = await page.locator('.saved-permits-table tbody tr td[data-label="Remove"] button').first().boundingBox();
  check("Remove button is at least 44x44", btnBox.width >= 44 && btnBox.height >= 44,
    `${Math.round(btnBox.width)}x${Math.round(btnBox.height)}`);

  await page.screenshot({ path: `verify-tmp/t65-${label}.png`, fullPage: false });
  await browser.close();
}

(async () => {
  await run("desktop", {});
  await run("iPhone13", { ...devices["iPhone 13"] });
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
