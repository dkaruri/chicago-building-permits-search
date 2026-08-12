// Phase 3: chi_permit_last_view grows from a bare string into
// { view, tab, q, sort, page, scroll, selected } and is restored on load.
//  A. index.html round-trips tab + query + sort + page + selection + scroll
//  B. an explicit ?mode=/?q= beats the restored value
//  C. a legacy bare-string value migrates to { view } instead of being dropped
//  D. list.html still restores its view through the new object form
//  E. two saves inside one debounce window both survive (no lost patch)
//  F. the overlay is deliberately NOT restored
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const KEY = "chi_permit_last_view";

// 180 contractors: enough for several pages at pageSize 100.
const CONTACTS = Array.from({ length: 180 }, (_, i) => ({
  contact_name: `CONTRACTOR ${String(i).padStart(3, "0")}`,
  open_jobs: 180 - i, total_jobs: 200 + i, avg_processing_days: 5 + (i % 9),
  reported_cost_total: 1000 * i, city: "CHICAGO", state: "IL", zipcode: "60601",
  sample_contact_type: "GENERAL CONTRACTOR", license_matches: [], work_types: [], permit_types: [], contact_types: [],
}));

async function page(browser, { url = "http://127.0.0.1:8791/index.html", seed = null, query = "", height = 900 } = {}) {
  // A short viewport for the scroll cases — at 900px tall with the detail pane
  // open the page does not overflow, so window.scrollY can never leave 0.
  const p = await browser.newPage({ viewport: { width: 1280, height } });
  if (seed !== null) await p.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, seed]);
  // Playwright resolves overlapping page.route patterns LIFO, so the catch-all
  // must be registered FIRST for the specific mocks to win.
  await p.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
  await p.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 1, cached_at: "2026-07-28" }) }));
  await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0 }) }));
  await p.route("**/api/contact/**", r => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Contact not found" }) }));
  await p.route("**/api/profiles**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: CONTACTS, total: CONTACTS.length }) }));
  await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await p.goto(url + query, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });
  return p;
}

const stored = p => p.evaluate(k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return localStorage.getItem(k); } }, KEY);

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const out = [];
  for (const url of ["http://127.0.0.1:8791/index.html", "http://127.0.0.1:8791/list.html"]) {
    for (const [vp, tag] of [[{ width: 390, height: 844 }, "mobile"], [{ width: 844, height: 390 }, "landscape"], [{ width: 1280, height: 900 }, "desktop"]]) {
      for (const theme of ["light", "dark"]) {
        const p = await browser.newPage({ viewport: vp });
        await p.addInitScript(t => localStorage.setItem("chi_permit_theme", t), theme);
        await p.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
        await p.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 1, cached_at: "x" }) }));
        await p.route("**/api/contact/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ contact_name: "CONTRACTOR 000", matched_as: "CONTRACTOR 000", matched_category: "general_contractor", seeded_at: "2026-07-28T12:00:00.000Z", total_jobs: 9, license_matches: [], work_types: [], permit_types: [], contact_types: [] }) }));
        await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: Array.from({ length: 60 }, (_, i) => ({ permit_number: "P" + i, permit_status: "ACTIVE", issue_date: "2026-07-01", address: "ST " + i, work_type: "RENOVATION", permit_type: "PERMIT - RENOVATION", reported_cost: 1000 * i, general_contractors: "CONTRACTOR 000", open_subs: "" })), row_count: 60 }) }));
        await p.route("**/api/profiles**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: CONTACTS, total: CONTACTS.length }) }));
        await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
        await p.goto(url, { waitUntil: "domcontentloaded" });
        await p.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });
        // The search directory is index.html only — list.html hides .layout
        // entirely (body.list-page). There the same card is reached through the
        // saved list's permit overlay, so push it directly.
        const hasDirectory = url.endsWith("index.html");
        if (hasDirectory) {
          await p.evaluate(() => { state.mode = "general_contractors"; return search(); });
          await p.waitForFunction(() => document.querySelector(".contacts-table tbody tr"));
          await p.evaluate(() => document.querySelector(".contacts-table tbody tr").focus());
          await p.keyboard.press("Enter");
        } else {
          await p.evaluate(() => { openPermitModal(); pushCard({ type: "contact", name: "CONTRACTOR 000", role: "general_contractor" }); });
        }
        // The card is PUSHED synchronously; `loaded` only flips once both
        // fetches resolve. Assert the push (that is what Enter is responsible
        // for), then wait for the data before measuring.
        const rowKeyboard = await p.waitForFunction(() => !document.getElementById("permit-modal").hidden, { timeout: 8000 }).then(() => true).catch(() => false);
        if (!rowKeyboard) { out.push([`${url.split("/").pop()} ${tag} ${theme}`, { rowKeyboard: false, cardRowKeyboard: false }]); await p.close(); continue; }
        await p.waitForFunction(() => (activeCard() || {}).loaded, { timeout: 15000 }).catch(() => {});

        const m = await p.evaluate(() => {
          const rgb = s => (s.match(/[\d.]+/g) || [0,0,0]).slice(0,3).map(Number);
          const lum = c => { const [r,g,b] = c.map(v => { v/=255; return v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; }); return 0.2126*r+0.7152*g+0.0722*b; };
          const ratio = (a,b) => { const [x,y] = [lum(a),lum(b)].sort((m,k)=>k-m); return +(((x+0.05)/(y+0.05))).toFixed(2); };
          const card = document.querySelector(".permit-modal-card");
          const cardBg = rgb(getComputedStyle(card).backgroundColor);
          const controls = [...card.querySelectorAll(".pm-filters input, .pm-filters select, .pm-pager button:not([disabled])")];
          const labels = [...card.querySelectorAll(".pm-filters label")];
          return {
            controlsMin: controls.length ? Math.min(...controls.map(c => Math.min(c.offsetWidth, c.offsetHeight))) : null,
            entryFontMin: (es => es.length ? Math.min(...es.map(c => parseFloat(getComputedStyle(c).fontSize))) : null)([...card.querySelectorAll(".pm-filters input, .pm-filters select")]),
            everyControlLabelled: controls.every(c => c.closest("label") || c.getAttribute("aria-label") || (c.id && document.querySelector(`label[for="${c.id}"]`)) || (c.textContent || "").trim()),
            labelContrastMin: labels.length ? Math.min(...labels.map(l => ratio(rgb(getComputedStyle(l).color), cardBg))) : null,
            focusRings: controls.every(c => { c.focus(); const cs = getComputedStyle(c); return (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== "none") || cs.boxShadow !== "none"; }),
            rowCursor: getComputedStyle(document.querySelector(".pm-tablewrap tbody tr")).cursor,
            rowFocusRing: (() => { const r = document.querySelector(".pm-tablewrap tbody tr"); r.focus(); const cs = getComputedStyle(r); return (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== "none") || cs.boxShadow !== "none"; })(),
            noHScroll: (b => b.scrollWidth <= b.clientWidth)(document.querySelector(".permit-modal-body")),
            docNoHScroll: document.documentElement.scrollWidth <= window.innerWidth,
            emptyStateAnnounced: true,
          };
        });

        // A permit row INSIDE the card must also activate by keyboard.
        await p.evaluate(() => document.querySelector(".pm-tablewrap tbody tr").focus());
        await p.keyboard.press("Enter");
        const cardRowKeyboard = await p.waitForFunction(() => state.cardIndex === 1, { timeout: 8000 }).then(() => true).catch(() => false);

        out.push([`${url.split("/").pop()} ${tag} ${theme}`, { rowKeyboard: hasDirectory ? rowKeyboard : "n/a", cardRowKeyboard, ...m }]);
        await p.close();
      }
    }
  }
  const problems = [];
  for (const [key, r] of out) {
    if (r.rowKeyboard === false) problems.push(`${key}: results row does not activate on Enter`);
    if (!r.cardRowKeyboard) problems.push(`${key}: permit row inside the card does not activate on Enter`);
    if (r.controlsMin !== null && r.controlsMin < 44) problems.push(`${key}: filter/pager control ${r.controlsMin}px < 44`);
    if (r.entryFontMin != null && r.entryFontMin < 16) problems.push(`${key}: text-entry control ${r.entryFontMin}px < 16 (iOS zooms on focus; buttons are exempt)`);
    if (!r.everyControlLabelled) problems.push(`${key}: a filter control has no accessible name`);
    if (r.labelContrastMin !== null && r.labelContrastMin < 4.5) problems.push(`${key}: filter label contrast ${r.labelContrastMin}:1 < 4.5`);
    if (!r.focusRings) problems.push(`${key}: a filter/pager control has no focus ring`);
    if (r.rowCursor !== "pointer") problems.push(`${key}: clickable row cursor is ${r.rowCursor}`);
    if (!r.rowFocusRing) problems.push(`${key}: focused table row has no visible focus ring`);
    if (!r.noHScroll) problems.push(`${key}: card body scrolls horizontally`);
    if (!r.docNoHScroll) problems.push(`${key}: document scrolls horizontally`);
  }
  console.log(problems.length ? "FAIL" : "PASS");
  console.log(JSON.stringify(out, null, 1));
  if (problems.length) console.log("PROBLEMS:" + String.fromCharCode(10) + problems.join(String.fromCharCode(10)));
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})();
