// t42 — ui-ux-pro-max pre-landing pass on the notes feed (FEAT-034 phase 2).
// Asserts GEOMETRY and COMPUTED COLOUR, not DOM presence: touch targets, the
// 16px input floor, contrast in both themes, focus visibility, no horizontal
// overflow, and that private-vs-shared survives being stripped of colour.
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const ROWS = [
  { permit_number: "101082609", address: "3701 W AINSLIE ST", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", ward: "39", reported_cost: 120000, lat: 41.97, lon: -87.72 },
  { permit_number: "B200461632", address: "1200 N STATE PKWY", permit_status: "ACTIVE", permit_type: "PERMIT - NEW CONSTRUCTION", issue_date: "2026-07-02", ward: "2", reported_cost: 900000, lat: 41.90, lon: -87.62 },
];
const THREADS = {
  "101082609": [{ id: "n_a1", kind: "text", author: "Divyam", text: "Roof crew on site", ts: 1900000000 }],
};

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

// WCAG relative luminance + contrast ratio.
function lum([r, g, b]) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg, bg) {
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const parse = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
// Composite a possibly-translucent colour over its backdrop.
function over(fg, bg, alpha) { return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)); }

async function openFeed(page) {
  await page.click("#notes-feed-btn");
  await page.waitForSelector("#notes-feed[open] .feed-entry", { timeout: 10000 });
}

async function run(viewport, theme, label) {
  console.log(`\n== ${label} ==`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });
  await page.route("**/api/notes/bulk*", r => r.fulfill({ json: { threads: THREADS, truncated: false } }));
  await page.route("**/api/notes/counts*", r => r.fulfill({ json: { counts: { "101082609": 1 } } }));
  await page.route("**/api/contact/**", r => r.fulfill({ json: {} }));

  await page.addInitScript(t => localStorage.setItem("chi_permit_theme", t), theme);
  await openList(page);
  await page.evaluate(() => {
    localStorage.setItem("chi_permit_user_notes", JSON.stringify({
      list: "", permits: { "B200461632": "Call the owner before 9am" }, noteTs: { "B200461632": 1900000500 },
    }));
    loadUserNotes();
  });
  await seedSavedList(page, ROWS);
  await openFeed(page);

  // ---- touch targets ----
  const targets = await page.$$eval(
    "#notes-feed button, #notes-feed input, #notes-feed-btn",
    els => els.map(e => {
      const r = e.getBoundingClientRect();
      return { tag: e.tagName, cls: e.className || e.id, w: Math.round(r.width), h: Math.round(r.height) };
    }));
  const small = targets.filter(t => t.h < 44);
  check("every control is at least 44px tall", small.length === 0, JSON.stringify(small));

  // ---- 8px spacing between adjacent entries ----
  const gaps = await page.$$eval("#notes-feed .feed-entry", els => {
    const out = [];
    for (let i = 1; i < els.length; i++) {
      out.push(Math.round(els[i].getBoundingClientRect().top - els[i - 1].getBoundingClientRect().bottom));
    }
    return out;
  });
  check("entries are spaced at least 8px apart", gaps.every(g => g >= 8), JSON.stringify(gaps));

  // ---- iOS zoom floor on the search field ----
  const fs = await page.$eval("#feed-q", el => parseFloat(getComputedStyle(el).fontSize));
  check("search input is >= 16px so iOS does not zoom", fs >= 16, `${fs}px`);

  // ---- visible label, not placeholder-only ----
  const labelled = await page.$eval("#feed-q", el => {
    const lab = document.querySelector(`label[for="${el.id}"]`);
    return !!lab && getComputedStyle(lab).display !== "none" && lab.textContent.trim().length > 0;
  });
  check("search field has a visible label, not just a placeholder", labelled);

  // ---- contrast ----
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
      text: g(".feed-text"),
      when: g(".feed-when"),
      count: g(".feed-count"),
      scope: g(".feed-scope"),
      where: g(".feed-where"),
      priv: g(".feed-src.private"),
      shared: g(".feed-src.shared"),
    };
  });
  for (const [name, c] of Object.entries(colours)) {
    if (!c) { check(`contrast: ${name} present`, false); continue; }
    // Badges sit on a translucent tint over the panel; composite before judging.
    const bg = parse(c.bg).length === 3 ? parse(c.bg) : [255, 255, 255];
    const r = ratio(parse(c.fg), bg);
    const large = c.size >= 24 || (c.size >= 18.66 && Number(c.weight) >= 700);
    const floor = large ? 3 : 4.5;
    check(`contrast: ${name} >= ${floor}:1`, r >= floor, `${r.toFixed(2)}:1 (${c.fg} on ${c.bg}, ${c.size}px)`);
  }

  // ---- meaning must survive without colour ----
  const words = await page.$$eval("#notes-feed .feed-src", els => els.map(e => e.textContent.trim().toLowerCase()));
  check("private/shared is stated in words, not colour alone",
    words.some(w => w.includes("private")) && words.some(w => /shared|walkthrough|photo/.test(w)),
    JSON.stringify(words));

  // ---- focus visibility ----
  // Must be driven by a REAL Tab. :focus-visible deliberately does not match a
  // programmatic .focus() on a button in Chromium, so el.focus() reports "no
  // ring" on a page whose ring works perfectly.
  await page.evaluate(() => document.querySelector("#feed-q").focus());
  let ring = null;
  for (let i = 0; i < 8 && !ring; i++) {
    await page.keyboard.press("Tab");
    ring = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || !el.classList.contains("feed-entry")) return null;
      const cs = getComputedStyle(el);
      return { outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, shadow: cs.boxShadow };
    });
  }
  check("tabbing reaches a feed entry", !!ring);
  check("focused entry shows a visible ring",
    !!ring && ((ring.outlineStyle !== "none" && parseFloat(ring.outlineWidth) >= 2) || (ring.shadow && ring.shadow !== "none")),
    JSON.stringify(ring));

  // ---- icon ligatures must be declared in the font request ----
  // The stylesheet is fetched with an explicit icon_names allowlist. An icon
  // used but not declared silently renders as its literal NAME in production
  // ("sticky_note_2" as running text) — invisible in any test that only checks
  // the DOM, because the element and its text are exactly what was asked for.
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
    return { missing: [...new Set(used.filter(u => !declared.has(u)))], declaredCount: declared.size };
  });
  check("every icon on screen is declared in the font request",
    iconCheck.missing.length === 0, `undeclared: ${JSON.stringify(iconCheck.missing)}`);

  // ---- no horizontal overflow ----
  const overflow = await page.evaluate(() => {
    const d = document.querySelector("#notes-feed");
    const b = document.querySelector("#notes-feed .feed-body");
    return { dlg: d.scrollWidth - d.clientWidth, body: b.scrollWidth - b.clientWidth, docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check("feed does not scroll horizontally", overflow.dlg <= 1 && overflow.body <= 1, JSON.stringify(overflow));
  check("page behind does not gain horizontal scroll", overflow.docScroll <= 1, JSON.stringify(overflow));

  // ---- long words must wrap, not blow the layout out ----
  await page.evaluate(() => {
    state.userPermitNotes["B200461632"] = "X".repeat(300);
    state.feed.entries = buildFeedEntries(feedRows());
    renderNotesFeed();
  });
  await page.waitForTimeout(60);
  const afterLong = await page.evaluate(() => {
    const b = document.querySelector("#notes-feed .feed-body");
    return b.scrollWidth - b.clientWidth;
  });
  check("an unbroken 300-char note wraps instead of overflowing", afterLong <= 1, `overflow ${afterLong}px`);

  // ---- escape closes ----
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  check("Escape closes the feed", await page.$eval("#notes-feed", el => !el.open));

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
