// FIX-053 — the permit table inside the General Contractor / Open Sub card:
// fixed column widths on wide screens, stacked cards on phones.
//
// The table is `.pm-tablewrap table` in `buildContactCard` (index.html and
// list.html; map.html has no contact card). Four columns — Permit (number +
// status + stage), Issued, Address, Cost. Before this card they had NO widths
// at all: the browser's auto layout re-apportioned them from the data on every
// page of the card, so the figures moved sideways between pages, and at 390px
// the whole table scrolled horizontally inside `.pm-tablewrap` instead of
// stacking like every other table on the site does at that width.
//
// What is asserted:
//   desktop  — Issued/Cost hold their EXACT px width, unchanged between the GC
//              card and the Open Sub card and between two viewport widths;
//              Address absorbs the remainder and is never squeezed below its
//              floor; no figure (permit number, date, dollar amount) wraps.
//   iPhone13 — the row is a stacked card: thead gone, every cell full-width and
//              carrying its own visible label, and NO horizontal scroll.
//
// Geometry is asserted, not DOM presence (FIX-027), and wraps are counted as
// LINE BOXES over the text node (FIX-044) — a width assertion alone is blind to
// a figure splitting in half.
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot.js");

const BASE = process.env.BASE || "http://127.0.0.1:8791";

// The spec, from the mockup walkthrough recorded on FIX-053. The Select and
// Status columns of that six-column table do not exist here: this table has no
// checkbox, and the status rides under the permit number inside the Permit
// cell. So Permit carries the spec's Permit(96)+Status(148) content and takes
// the wider of the two, and the three remaining columns keep their spec widths.
const SPEC = { permit: 148, issued: 104, address: 262, cost: 112 };

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

const CONTACT = {
  contact_name: "CONTRACTOR 000", open_jobs: 12, total_jobs: 20, avg_processing_days: 7,
  reported_cost_total: 1234, city: "CHICAGO", state: "IL", zipcode: "60601",
  sample_contact_type: "GENERAL CONTRACTOR", license_matches: [], work_types: [], permit_types: [], contact_types: []
};

// Deliberately hostile rows: the widest real figure ($730,000,000 — max
// reported_cost over open permits on 2026-08-11, the number FIX-044 sized the
// Cost column from), the longest street name in the city, and a status string
// long enough to need two lines under the permit number.
const PERMITS = Array.from({ length: 12 }, (_, i) => ({
  permit_number: "100" + String(100000 + i),
  permit_status: i === 0 ? "PHASED PERMITTING" : "OPEN - IN PROGRESS",
  permit_type: "PERMIT - RENOVATION/ALTERATION",
  issue_date: "2026-01-01",
  // Row 0's address is longer than the 262px column on purpose: Address is the
  // one column that MUST still wrap, and an address that happens to fit proves
  // nothing about whether it can.
  address: i === 0 ? "1234 S DR MARTIN LUTHER KING JR DR UNIT 1500 REAR BUILDING" : `${1000 + i} W IRVING PARK RD`,
  work_type: "RENOVATION",
  reported_cost: i === 0 ? 730000000 : 408680 + i,
  general_contractors: "CONTRACTOR 000", open_subs: "CONTRACTOR 000",
}));

async function openCard(page, url, role) {
  // Playwright matches routes in REVERSE registration order, so the catch-all
  // has to be registered FIRST or it swallows every specific mock below it.
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
  await page.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 1, cached_at: "x" }) }));
  await page.route("**/api/contact/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ contact_name: CONTACT.contact_name, matched_as: CONTACT.contact_name, matched_category: role, seeded_at: "2026-07-28T12:00:00.000Z", total_jobs: 20, license_matches: [], work_types: [], permit_types: [], contact_types: [] }) }));
  await page.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: PERMITS, row_count: PERMITS.length }) }));
  await page.route("**/api/profiles**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [CONTACT], total: 1 }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });
  await page.evaluate(role => openContactCard(encodeURIComponent("CONTRACTOR 000"), role), role);
  await page.waitForFunction(() => (activeCard() || {}).loaded, { timeout: 15000 });
  await page.waitForSelector(".pm-tablewrap tbody tr", { timeout: 15000 });
}

// Column widths from the FIRST body row, plus the wrap state of every cell that
// holds a figure. One round trip: a second is a chance for layout to move
// under the assertion (FIX-047).
const measure = page => page.evaluate(() => {
  const lineBoxes = node => {
    if (!node || !node.textContent.trim()) return 0;
    const r = document.createRange();
    r.selectNodeContents(node);
    return r.getClientRects().length;
  };
  const wrap = document.querySelector(".pm-tablewrap");
  const table = wrap.querySelector("table");
  const cells = [...table.querySelectorAll("tbody tr")].map(tr => [...tr.children]);
  const first = cells[0];
  const w = td => +td.getBoundingClientRect().width.toFixed(1);
  const label = td => {
    const c = getComputedStyle(td, "::before").content;
    return c && c !== "none" ? c.replace(/^"|"$/g, "") : "";
  };
  return {
    columns: first.length,
    width: { permit: w(first[0]), issued: w(first[1]), address: w(first[2]), cost: w(first[3]) },
    display: { td: getComputedStyle(first[0]).display, thead: getComputedStyle(table.querySelector("thead")).display },
    labels: first.map(label),
    // The row's CONTENT width. Stacked, the row is a card with 13px of padding
    // and a 1px border, so a full-width cell is 28px narrower than the row's
    // border box — comparing against that reported a false failure on a
    // correctly stacked layout.
    rowWidth: (() => {
      const tr = first[0].closest("tr"), cs = getComputedStyle(tr);
      return +(tr.getBoundingClientRect().width
        - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)).toFixed(1);
    })(),
    // Figures that must never split: the permit number, the date, the amount.
    figureWraps: cells.flatMap(tds => [
      { what: "permit", text: tds[0].querySelector("strong").textContent, lines: lineBoxes(tds[0].querySelector("strong").firstChild) },
      { what: "issued", text: tds[1].textContent.trim(), lines: lineBoxes(tds[1].firstChild) },
      { what: "cost", text: tds[3].textContent.trim(), lines: lineBoxes(tds[3].firstChild) },
    ]).filter(f => f.lines !== 1),
    // The longest address is row 0 and MUST be allowed to wrap rather than
    // widen the table — the counterpart to the nowrap above.
    addressLines: lineBoxes(cells[0][2].firstChild),
    addressText: cells[0][2].textContent.trim(),
    scroll: {
      wrap: wrap.scrollWidth > wrap.clientWidth + 1,
      doc: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      body: document.body.scrollWidth > document.body.clientWidth + 1,
    },
    // A figure that has eaten its cell's padding is already touching the next
    // column, even though nothing "overflowed" the border box. Measured over a
    // Range on the TEXT, never on the cell: for Issued and Cost the figure IS
    // the whole cell, so comparing element box to cell box compares a box with
    // itself and reports a spill on every build, sound or not.
    spills: cells.flatMap(tds => [
      { text: tds[0].querySelector("strong").firstChild, td: tds[0] },
      { text: tds[1].firstChild, td: tds[1] },
      { text: tds[3].firstChild, td: tds[3] },
    ]).filter(({ text, td }) => {
      if (!text) return false;
      const r = document.createRange();
      r.selectNodeContents(text);
      const pad = parseFloat(getComputedStyle(td).paddingRight) || 0;
      return r.getBoundingClientRect().right > td.getBoundingClientRect().right - pad + 0.5;
    }).map(({ text }) => text.textContent.trim()),
  };
});

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const seen = {};

  for (const page of ["index.html", "list.html"]) {
    for (const [role, roleName] of [["general_contractor", "GC"], ["open_tech", "Open Sub"]]) {
      // --- wide screens: the columns are fixed -----------------------------
      // 700px is not decoration: it is the only width that distinguishes the
      // table's 626px floor from the column widths themselves. There the card
      // is 92vw = 644px (content ~606px), narrower than the table, so WITHOUT
      // the floor the fixed columns are crushed proportionally — exactly the
      // failure FIX-044 hit — and WITH it `.pm-tablewrap` scrolls instead. A
      // mutant that deleted `table-layout: fixed; min-width: 626px` survived
      // 1280 and 1000 untouched.
      for (const width of [1280, 1000, 700]) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 } });
        const p = await ctx.newPage();
        const errs = [];
        p.on("pageerror", e => errs.push(String(e).slice(0, 160)));
        await openCard(p, `${BASE}/${page}`, role);
        const m = await measure(p);
        const tag = `${page} ${roleName} @${width}`;

        check(`${tag}: no page error`, errs.length === 0, errs.join(" | "));
        check(`${tag}: four columns`, m.columns === 4, `${m.columns}`);
        for (const col of ["permit", "issued", "cost"]) {
          check(`${tag}: ${col} column is exactly ${SPEC[col]}px`,
            Math.abs(m.width[col] - SPEC[col]) <= 1, `${m.width[col]}px`);
        }
        check(`${tag}: address gets at least ${SPEC.address}px`,
          m.width.address >= SPEC.address - 1, `${m.width.address}px`);
        check(`${tag}: no figure wraps mid-value`,
          m.figureWraps.length === 0, JSON.stringify(m.figureWraps.slice(0, 2)));
        check(`${tag}: no figure spills into the next column`,
          m.spills.length === 0, JSON.stringify(m.spills.slice(0, 2)));
        check(`${tag}: the long address DOES wrap (the columns are not held open by it)`,
          m.addressLines > 1, `${m.addressLines} lines — ${m.addressText}`);
        check(`${tag}: no horizontal page scroll`, !m.scroll.doc && !m.scroll.body, JSON.stringify(m.scroll));
        // Room for the whole table is what the widened contact card buys. Drop
        // that widening and every width assertion above still passes — the
        // table just scrolls sideways inside a 560px card instead, which is
        // the thing a reader actually notices. Below 1000px the card is 92vw
        // and the wrapper scrolling IS the designed behaviour, so this is
        // asserted only where the card is at its full width.
        if (width >= 1000) {
          check(`${tag}: the card itself does not scroll sideways`,
            !m.scroll.wrap, JSON.stringify(m.scroll));
        }

        seen[tag] = m.width;
        await ctx.close();
      }

      // --- phone: stacked cards -------------------------------------------
      const ctx = await browser.newContext({ ...devices["iPhone 13"] });
      const p = await ctx.newPage();
      await openCard(p, `${BASE}/${page}`, role);
      const m = await measure(p);
      const tag = `${page} ${roleName} @iPhone13`;

      check(`${tag}: rows are stacked cards, not table rows`,
        m.display.td === "block" && m.display.thead === "none",
        `td=${m.display.td} thead=${m.display.thead}`);
      check(`${tag}: every stacked cell carries its own visible label`,
        m.labels.length === 4 && m.labels.every(l => l.trim().length > 0), JSON.stringify(m.labels));
      check(`${tag}: every cell is full card width`,
        Object.values(m.width).every(w => Math.abs(w - m.rowWidth) <= 2),
        `${JSON.stringify(m.width)} vs row ${m.rowWidth}`);
      check(`${tag}: NO horizontal scroll anywhere`,
        !m.scroll.wrap && !m.scroll.doc && !m.scroll.body, JSON.stringify(m.scroll));
      check(`${tag}: no figure wraps mid-value`,
        m.figureWraps.length === 0, JSON.stringify(m.figureWraps.slice(0, 2)));
      check(`${tag}: the address still wraps`, m.addressLines > 1, `${m.addressLines} lines`);

      // --- the a11y bar, in BOTH themes -----------------------------------
      // A stacked card is a new surface, so it gets measured rather than
      // assumed: the row is the tap target and the ::before is new text.
      for (const theme of ["light", "dark"]) {
        const a11y = await p.evaluate(t => {
          document.documentElement.dataset.theme = t;
          localStorage.setItem("chi_permit_theme", t);
          const tr = document.querySelector(".pm-tablewrap tbody tr");
          const td = tr.children[0];
          const px = c => {
            const m = getComputedStyle(document.body).getPropertyValue("--x") && null;
            const probe = document.createElement("span");
            probe.style.color = c; document.body.appendChild(probe);
            const rgb = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
            probe.remove(); return rgb;
          };
          // WCAG relative luminance. The label sits on the card's own
          // background, not the page's — read the ancestor that paints.
          const lum = ([r, g, b]) => {
            const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
          };
          const bgOf = el => {
            for (let n = el; n; n = n.parentElement) {
              const c = getComputedStyle(n).backgroundColor;
              const p = c.match(/[\d.]+/g).map(Number);
              if (p.length < 4 || p[3] > 0) return p.slice(0, 3);
            }
            return [255, 255, 255];
          };
          const before = getComputedStyle(td, "::before");
          const fg = px(before.color), bg = bgOf(td);
          const L1 = lum(fg), L2 = lum(bg);
          return {
            ratio: +(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05))).toFixed(2),
            fontPx: parseFloat(before.fontSize),
            rowHeight: +tr.getBoundingClientRect().height.toFixed(1),
            tabbable: tr.tabIndex === 0,
            hasKeyHandler: !!tr.getAttribute("onkeydown"),
          };
        }, theme);
        check(`${tag} ${theme}: stacked label contrast >= 4.5:1`,
          a11y.ratio >= 4.5, `${a11y.ratio}:1 at ${a11y.fontPx}px`);
        check(`${tag} ${theme}: the row is a >=44px target`,
          a11y.rowHeight >= 44, `${a11y.rowHeight}px`);
        check(`${tag} ${theme}: the row is keyboard reachable and activatable`,
          a11y.tabbable && a11y.hasKeyHandler, JSON.stringify(a11y));
      }
      await ctx.close();
    }
  }

  // --- the actual requirement: the widths do not move ----------------------
  // "Fixed on wide screens" is a claim about STABILITY across views and
  // viewports, which no single measurement can make. Compare them all.
  const keys = Object.keys(seen);
  const ref = seen[keys[0]];
  for (const k of keys.slice(1)) {
    for (const col of ["permit", "issued", "cost"]) {
      check(`${col} column identical: "${k}" vs "${keys[0]}"`,
        Math.abs(seen[k][col] - ref[col]) <= 1, `${seen[k][col]} vs ${ref[col]}`);
    }
  }

  await browser.close();
  console.log(`\n${failures === 0 ? "ALL GREEN" : failures + " FAILURE(S)"}`);
  process.exit(failures ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
