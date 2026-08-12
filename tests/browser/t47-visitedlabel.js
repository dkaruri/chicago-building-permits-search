// FIX-018 — the checkbox column carries a visible word label on desktop (table
// header) and on mobile (stacked-card ::before), and neither overflows its cell.
//
// UPDATED for FEAT-031: the single "Visited/Called" column — one control for two
// different facts — became two independent columns, "Visited" and "Called".
// FIX-018's actual requirement is unchanged and still asserted here: the label
// is a real word, visible, legible (>=12px) and fits its cell. What changed is
// how many columns there are, so the expected strings changed with it.
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");
const { devices } = require("playwright");

const ROWS = [
  { permit_number: "B100000001", permit_type: "PERMIT - RENOVATION/ALTERATION", permit_status: "ACTIVE", issue_date: "2026-01-05", address: "1234 W FULLERTON AVE", ward: "32", reported_cost: 250000, work_type: "MASONRY" },
  { permit_number: "B100000002", permit_type: "PERMIT - NEW CONSTRUCTION", permit_status: "ACTIVE", issue_date: "2026-01-06", address: "5678 N CLARK ST", ward: "40", reported_cost: 900000, work_type: "ELECTRICAL" },
];

let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });

  // ---- desktop ----
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openList(page);
    await seedSavedList(page, ROWS);
    const r = await page.evaluate(() => {
      const th = document.querySelector(".saved-permits-table th.tick-cell");
      const td = document.querySelector(".saved-permits-table td.tick-cell");
      const box = th && th.getBoundingClientRect();
      const cs = th && getComputedStyle(th);
      // Rendered width of the header's own text, which scrollWidth cannot
      // report on a table cell (cells overflow visibly, they do not scroll).
      const textW = (() => {
        const rg = document.createRange();
        rg.selectNodeContents(th);
        return Math.max(...[...rg.getClientRects()].map(x => x.width), 0);
      })();
      // thead and tbody are emitted by two separate template strings, so the
      // tick header can drift to a different column index than the tick cell.
      // (Geometry cannot catch this — columns always line up BY INDEX; it is
      // the contents that end up one column apart.)
      const hs = [...document.querySelectorAll(".saved-permits-table thead th")];
      const cs0 = [...document.querySelectorAll(".saved-permits-table tbody tr:first-child td")];
      const thIdx = hs.indexOf(th), tdIdx = cs0.indexOf(td);
      return th && td ? {
        text: th.textContent.trim(),
        textW, cellW: th.clientWidth,
        thIdx, tdIdx, colCount: hs.length === cs0.length,
        // Header sits over the checkbox column, not some other column.
        thMid: box.left + box.width / 2,
        cbMid: (() => { const b = td.querySelector("input.tick").getBoundingClientRect(); return b.left + b.width / 2; })(),
        colWidth: box.width,
        fontPx: parseFloat(cs.fontSize),
        // The label carries meaning now, so it must not be smaller than the
        // headers beside it (the table-wide header size is out of scope here).
        siblingPx: parseFloat(getComputedStyle(hs[hs.indexOf(th) + 1] || hs[0]).fontSize),
        srOnlyLeftover: !!th.querySelector(".sr-only"),
      } : null;
    });
    ok("desktop: tick column exists", !!r);
    ok("desktop: header reads Visited", r && r.text === "Visited", r && r.text);
    // FEAT-031: the second column must be labelled too, or the split just
    // produces two anonymous checkboxes distinguished by position alone.
    const heads = await page.$$eval(".saved-permits-table thead th.tick-cell", ths => ths.map(t => t.textContent.trim()));
    ok("desktop: both flag columns exist and are named", heads.length === 2 && heads[1] === "Called", JSON.stringify(heads));
    ok("desktop: header text fits its cell", r && r.textW <= r.cellW + 1, r && `${r.textW.toFixed(1)} in ${r.cellW}`);
    ok("desktop: thead and tbody agree on column count", r && r.colCount);
    ok("desktop: tick header is at the tick cell's column index", r && r.thIdx === r.tdIdx && r.thIdx >= 0, r && `th ${r.thIdx} vs td ${r.tdIdx}`);
    ok("desktop: header aligns over the checkbox", r && Math.abs(r.thMid - r.cbMid) < r.colWidth / 2);
    ok("desktop: header not smaller than sibling headers", r && r.fontPx >= r.siblingPx, r && `${r.fontPx}px`);
    ok("desktop: no leftover sr-only duplicate", r && !r.srOnlyLeftover);
    await page.close();
  }

  // ---- iPhone 13 ----
  {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await openList(page);
    await seedSavedList(page, ROWS);
    const r = await page.evaluate(() => {
      const td = document.querySelector(".saved-permits-table td.tick-cell");
      const cb = td && td.querySelector("input.tick");
      const before = td && getComputedStyle(td, "::before");
      // thead is display:none in the card layout, so the label MUST come from
      // the cell's own ::before — assert that, not the header.
      const thead = document.querySelector(".saved-permits-table thead");
      return td ? {
        label: before.content,
        fontPx: parseFloat(before.fontSize),
        headHidden: getComputedStyle(thead).display === "none",
        cellW: td.getBoundingClientRect().width,
        rowRight: td.getBoundingClientRect().right,
        bodyW: document.documentElement.clientWidth,
        cbW: cb.getBoundingClientRect().width,
        cbH: cb.getBoundingClientRect().height,
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      } : null;
    });
    ok("mobile: tick cell exists", !!r);
    ok("mobile: stacked-card layout (thead hidden)", r && r.headHidden);
    ok("mobile: label reads Visited", r && /Visited/.test(r.label), r && r.label);
    ok("mobile: label >= 12px", r && r.fontPx >= 12, r && `${r.fontPx}px`);
    // FEAT-031: on a phone the ::before IS the label — an unlabelled second
    // checkbox in the stack would be indistinguishable from the first.
    const labels = await page.$$eval(".saved-permits-table tbody tr:first-child td.tick-cell",
      tds => tds.map(td => ({ text: getComputedStyle(td, "::before").content, px: parseFloat(getComputedStyle(td, "::before").fontSize) })));
    ok("mobile: both flag cells carry an inline label", labels.length === 2 && /Called/.test(labels[1].text), JSON.stringify(labels.map(l => l.text)));
    ok("mobile: the Called label is legible too", labels[1] && labels[1].px >= 12, labels[1] && `${labels[1].px}px`);
    ok("mobile: cell stays inside the viewport", r && r.rowRight <= r.bodyW + 1);
    ok("mobile: no horizontal page scroll", r && !r.hScroll);
    ok("mobile: checkbox still hit-sized", r && r.cbW >= 20 && r.cbH >= 20, r && `${r.cbW}x${r.cbH}`);
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
