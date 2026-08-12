// t34 (FIX-016): the "Posting as ___" name in the permit view must be editable.
//
// It used to render as plain text from localStorage.chi_permit_author, captured
// once by prompt() and then unreachable — a typo was permanent, and a phone has
// no console to work around it.
//
// A. the name is a real <button>, focusable and keyboard-activatable
// B. changing it updates the visible label AND the stored key
// C. an in-progress note draft SURVIVES the change (repaint in place, do not
//    re-render the card — that would rebuild the textarea and lose the text)
// D. cancelling the prompt changes nothing
// E. blank / whitespace-only input is rejected, not stored
// F. inline metrics are kept at 390px: the 640px breakpoint forces
//    min-height:44px on every `button`, which would put a 44px box mid-sentence
// G. both pages behave identically
const { chromium, devices } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

const ROW = {
  permit_number: "100999888", permit_status: "OPEN", permit_type: "PERMIT - RENOVATION/ALTERATION",
  issue_date: "2026-05-01", address: "123 N TEST ST", ward: "27", reported_cost: "125000",
  total_fee: "900", work_description: "INTERIOR ALTERATIONS 3 UNITS", work_type: "ALTERATION",
  review_type: "STANDARD PLAN REVIEW", community_area: "WEST TOWN", processing_time: "12",
  general_contractors: ["ACME BUILDERS"], open_subs: ["SPARKY ELECTRIC"],
};

async function boot(browser, page404, mobile) {
  const ctx = mobile
    ? await browser.newContext({ ...devices["iPhone 13"] })
    : await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("chi_permit_author", "Wrgon Nmae"));
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [], posts: [] }) }));
  await page.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 0, cached_at: "2026-07-28" }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/" + page404, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });
  await page.evaluate(row => openPermitDetail(row), ROW);
  await page.waitForSelector("[data-posting-as]", { timeout: 10000 });
  return { ctx, page };
}

async function run(browser, file, mobile) {
  const { ctx, page } = await boot(browser, file, mobile);

  const initial = await page.evaluate(() => {
    const b = document.querySelector("[data-posting-as]");
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    return {
      tag: b.tagName,
      text: b.textContent,
      label: b.getAttribute("aria-label"),
      height: Math.round(r.height),
      fontPx: Number(cs.fontSize.replace("px", "")),
    };
  });

  // C: type a draft note first — it must still be there afterwards.
  await page.fill("#pm-note-draft", "half-written note");

  // D: cancel changes nothing.
  page.once("dialog", d => d.dismiss());
  await page.focus("[data-posting-as]");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const afterCancel = await page.evaluate(() => ({
    text: document.querySelector("[data-posting-as]").textContent,
    stored: localStorage.getItem("chi_permit_author"),
  }));

  // E: whitespace-only is rejected.
  page.once("dialog", d => d.accept("   "));
  await page.focus("[data-posting-as]");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const afterBlank = await page.evaluate(() => localStorage.getItem("chi_permit_author"));

  // A + B: a real Enter on the focused button opens the prompt; accept a name.
  page.once("dialog", d => d.accept("  Divyam K  "));
  await page.focus("[data-posting-as]");
  const focused = await page.evaluate(() => document.activeElement.getAttribute("data-posting-as") !== null);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);

  const after = await page.evaluate(() => ({
    text: document.querySelector("[data-posting-as]").textContent,
    label: document.querySelector("[data-posting-as]").getAttribute("aria-label"),
    stored: localStorage.getItem("chi_permit_author"),
    draft: document.getElementById("pm-note-draft").value,
    announced: (document.getElementById("pm-live") || {}).textContent || "",
  }));

  await ctx.close();
  return { file, mobile, initial, focused, afterCancel, afterBlank, after };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const out = [];
  for (const file of ["list.html", "index.html"]) {
    for (const mobile of [false, true]) out.push(await run(browser, file, mobile));
  }
  for (const r of out) console.log(JSON.stringify(r));

  const bad = out.filter(r =>
    r.initial.tag !== "BUTTON" ||
    r.initial.text !== "Wrgon Nmae" ||
    !/currently Wrgon Nmae/.test(r.initial.label || "") ||
    !r.focused ||
    // F: must not become a 44px box inside the sentence
    r.initial.height > 28 || r.initial.fontPx < 12 ||
    r.afterCancel.text !== "Wrgon Nmae" || r.afterCancel.stored !== "Wrgon Nmae" ||
    r.afterBlank !== "Wrgon Nmae" ||
    r.after.text !== "Divyam K" || r.after.stored !== "Divyam K" ||
    !/currently Divyam K/.test(r.after.label || "") ||
    r.after.draft !== "half-written note" ||
    !/Divyam K/.test(r.after.announced));
  console.log(bad.length ? `FAIL ${bad.length}` : "PASS");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
