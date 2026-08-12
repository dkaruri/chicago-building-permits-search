// t45 — ui-ux-pro-max pre-landing pass on the GC follow-up tag (FEAT-034 ph 3).
// Geometry and computed colour, both themes, both viewports: contrast of the
// badge / toggle / filter chip, 44px targets, focus rings on the aria-disabled
// move buttons, icon declaration, and no horizontal overflow on a phone.
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const ROWS = [
  { permit_number: "101082609", address: "3701 W AINSLIE ST", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", ward: "39", reported_cost: 120000, lat: 41.97, lon: -87.72,
    general_contractors: "BEAR CONSTRUCTION AND REMODELING COMPANY OF ILLINOIS" },
  { permit_number: "B200461632", address: "1200 N STATE PKWY", permit_status: "ACTIVE", permit_type: "PERMIT - NEW CONSTRUCTION", issue_date: "2026-07-02", ward: "2", reported_cost: 900000, lat: 41.90, lon: -87.62,
    general_contractors: "SECOND GC" },
];

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

function lum([r, g, b]) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg, bg) {
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const parse = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

async function run(viewport, theme, label) {
  console.log(`\n== ${label} ==`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });
  await page.route("**/api/notes/bulk*", r => r.fulfill({ json: { threads: {}, truncated: false } }));
  await page.route("**/api/notes/counts*", r => r.fulfill({ json: { counts: {} } }));
  await page.route("**/api/contact/**", r => r.fulfill({ json: {} }));
  await page.route("**/api/lists/*/follow", r => r.fulfill({ json: { ok: true } }));

  await page.addInitScript(t => localStorage.setItem("chi_permit_theme", t), theme);
  await openList(page);
  await seedSavedList(page, ROWS);

  // ---- the toggle, inside the permit card ----
  await page.evaluate(() => openPermitDetail(state.userPermitMap.get("101082609")));
  await page.waitForSelector("#permit-modal:not([hidden]) .pm-followup", { timeout: 10000 });

  const fuBox = await page.$eval("#permit-modal .pm-followup", el => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  check("follow-up toggle is at least 44px tall", fuBox.h >= 44, JSON.stringify(fuBox));
  check("follow-up toggle does not span the whole card like a form field",
    fuBox.w < viewport.width - 40, JSON.stringify(fuBox));

  // A very long GC name must wrap inside the card, not push it sideways.
  const cardOverflow = await page.$eval("#permit-modal .pm-body, #permit-modal .permit-modal-body",
    el => el.scrollWidth - el.clientWidth).catch(() => 0);
  check("a 50-char GC name does not make the card scroll sideways", cardOverflow <= 1, `${cardOverflow}px`);

  await page.click("#permit-modal .pm-followup");
  await page.waitForTimeout(150);
  const pressedRing = await page.$eval("#permit-modal .pm-followup", el => {
    const cs = getComputedStyle(el);
    return { border: cs.borderTopWidth, color: cs.color, bg: cs.backgroundColor };
  });
  check("pressed state changes more than the text colour", parseFloat(pressedRing.border) >= 2, JSON.stringify(pressedRing));

  await page.evaluate(() => closePermitModal());
  await page.waitForTimeout(200);

  // ---- contrast on every new surface ----
  await page.evaluate(() => { state.listFilters.followUp = true; renderUserList(); });
  await page.waitForTimeout(150);
  const colours = await page.evaluate(() => {
    const g = sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      let bg = cs.backgroundColor, node = el;
      while (bg === "rgba(0, 0, 0, 0)" && node.parentElement) { node = node.parentElement; bg = getComputedStyle(node).backgroundColor; }
      return { fg: cs.color, bg, size: parseFloat(cs.fontSize), weight: cs.fontWeight };
    };
    return {
      badge: g(".fu-badge"),
      filterChipOn: g("#filter-followup"),
      filterStatus: g("#list-tally"),
    };
  });
  for (const [name, c] of Object.entries(colours)) {
    if (!c) { check(`contrast: ${name} present`, false); continue; }
    const bg = parse(c.bg).length === 3 ? parse(c.bg) : [255, 255, 255];
    const r = ratio(parse(c.fg), bg);
    const large = c.size >= 24 || (c.size >= 18.66 && Number(c.weight) >= 700);
    const floor = large ? 3 : 4.5;
    check(`contrast: ${name} >= ${floor}:1`, r >= floor, `${r.toFixed(2)}:1 (${c.fg} on ${c.bg}, ${c.size}px)`);
  }

  // ---- the badge must not be a 11.5px scrap that falls under the floor ----
  const badgeSize = await page.$eval(".fu-badge", el => parseFloat(getComputedStyle(el).fontSize));
  check("badge text is at least 11.5px", badgeSize >= 11.5, `${badgeSize}px`);

  // ---- aria-disabled move buttons keep a focus ring (they are still tabbable) ----
  await page.evaluate(() => document.querySelector(".saved-permits-table .move-cell button").focus());
  const focusable = await page.evaluate(() => document.activeElement.closest(".move-cell") !== null);
  check("an aria-disabled move button can take focus", focusable);

  // ---- icons declared ----
  const iconCheck = await page.evaluate(() => {
    const link = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map(l => l.href).find(h => h.includes("Material+Symbols"));
    // Parse the query properly. Splitting on "icon_names=" and taking the rest
    // of the string assumed icon_names was the LAST parameter — FIX-027 appended
    // &display=block after it, which turned the final entry into
    // "sunny&display=block" and reported a declared icon as missing.
    const declared = new Set(
      (new URL(link || "http://x/", "http://x/").searchParams.get("icon_names") || "").split(",").map(s => s.trim()).filter(Boolean)
    );
    const used = [...document.querySelectorAll(".material-symbols-outlined")]
      .map(e => e.textContent.trim()).filter(Boolean);
    return { missing: [...new Set(used.filter(u => !declared.has(u)))] };
  });
  check("every icon on screen is declared in the font request",
    iconCheck.missing.length === 0, `undeclared: ${JSON.stringify(iconCheck.missing)}`);

  // ---- no horizontal overflow from the badge or the filter bar ----
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bar: (() => { const b = document.querySelector("#list-filters"); return b.scrollWidth - b.clientWidth; })(),
  }));
  check("filter bar does not scroll sideways", overflow.bar <= 1, JSON.stringify(overflow));
  check("page does not gain horizontal scroll", overflow.doc <= 1, JSON.stringify(overflow));

  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "light", "desktop light");
  await run({ width: 1280, height: 900 }, "dark", "desktop dark");
  await run({ width: 390, height: 844 }, "light", "iPhone 13 light");
  await run({ width: 390, height: 844 }, "dark", "iPhone 13 dark");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
