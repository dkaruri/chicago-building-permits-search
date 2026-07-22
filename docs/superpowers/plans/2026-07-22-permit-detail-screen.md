# Permit Detail Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline "Details" dropdown in My Permit List with a permit detail overlay — a centered modal on desktop, full-screen sheet on mobile — and make the Search Directory permit views use the same overlay.

**Architecture:** All client-side, inside the two self-contained pages `docs/list.html` and `docs/index.html`. A single section-based renderer builds the detail HTML; a small overlay controller shows it as a modal/sheet with scroll-lock, focus-trap, animation, and browser-back-to-close. Contractor and geo (Zone/TIF) fields fill in asynchronously after the shell opens. `list.html` is built first and fully verified; `index.html` receives an identical copy last.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step, no framework, no module system). Verification via Playwright headless per the project recipe (see Test Harness below).

## Global Constraints

- **No new data source, no Worker/pipeline change.** Every field is filled from data the page already fetches (`row.*`, `/api/contact`, existing `geoZoneCache`/`geoTifCache`). Building type is the only heuristic value and MUST always carry an "approx." badge.
- **Notes storage is untouchable.** Per-permit notes live in `localStorage` key **`chi_permit_user_notes`** as JSON `{ "permits": { "<permitNumber>": "note" } }`, held in `state.userPermitNotes`, read at load and written by `savePermitNote(encodedNumber, value)`. Do NOT change the key, JSON shape, or that read/write path.
- **`list.html` and `index.html` copies must stay identical** for the shared functions (`parseBuildingType`, `parseLicenseType`, `parseLicenseClass`, `permitDetailSections`, `permitDetailHtml`, `openPermitDetail`, `openPermitModal`, `closePermitModal`, and the overlay CSS). Any divergence is a bug.
- **Neighborhood = `community_area`.** Use the label "Neighborhood" everywhere (this replaces index.html's current "Community area" label).
- **Route info stays inline in the list** (`routeLegText(row)` placement) — never moved into the modal.
- **Motion respects `prefers-reduced-motion`;** the design works in both light and dark themes (existing `chi_permit_theme` tokens).
- Branch: `permit-detail-screen` (already created). One commit per task.

## Test Harness (set up once, in Task 1)

Playwright is not a repo dependency; a complete Chromium headless-shell is already cached. Create a throwaway, uncommitted verify dir:

```bash
mkdir -p verify-tmp && cd verify-tmp && npm init -y >/dev/null 2>&1 && npm i playwright@1.53.0 >/dev/null 2>&1 && cd ..
echo "verify-tmp/" >> .gitignore
```

Serve the site in a second terminal (leave running for all tasks):

```bash
python -m http.server 8791 --directory docs
```

Every verify script uses this boilerplate (`CHROME` path and page gotchas come from the project's headless recipe):

```js
// verify-tmp/_boot.js — shared launcher
const { chromium } = require("playwright");
const CHROME = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
async function openList(page, path = "list.html") {
  // Stub external services for determinism; localhost cannot reach the Worker.
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ json: [{ lat: "41.9", lon: "-87.7", display_name: "stub" }] }));
  await page.goto(`http://localhost:8791/${path}`);
  await page.waitForFunction(() => typeof state !== "undefined");
}
module.exports = { chromium, CHROME, openList };
```

Notes for every script:
- Reference `state` by **bare name** (it is a top-level `const`, not `window.state`).
- Filter expected console noise: `/socrata|worker|api|Failed to fetch|net::ERR|profiles|stats|contact/i`.
- To exercise a permit detail without network, call the render/parse functions directly via `page.evaluate` with an inline `row` object.

A sample row object used across tests:

```js
const SAMPLE_ROW = {
  permit_number: "100991233", permit_type: "PERMIT - RENOVATION/ALTERATION",
  permit_status: "ACTIVE", issue_date: "2026-06-01", address: "2500 N Milwaukee Ave",
  community_area: "Logan Square", review_type: "Standard Plan Review",
  work_type: "Interior alteration", processing_time: "34",
  work_description: "RENOVATION OF EXISTING 4-UNIT RESIDENTIAL BUILDING, NEW PARTITIONS",
  reported_cost: "248500", total_fee: "3412",
  general_contractors: "Halsted Building Group LLC", open_subs: "Sparkline Electric Inc",
};
```

---

### Task 1: Heuristic + license parse helpers (list.html)

Three pure functions. High value, trivially testable, no DOM.

**Files:**
- Modify: `docs/list.html` (add functions in the `<script>` block, e.g. just above `contractorLinesHtml`, ~line 5928)
- Test: `verify-tmp/t1.js`

**Interfaces:**
- Produces:
  - `parseBuildingType(desc: string) -> string` — best-effort building type from a work description, or `""`.
  - `parseLicenseType(licenseType: string) -> string` — trade with any `(Class X)` suffix stripped; `""` for falsy input.
  - `parseLicenseClass(licenseType: string) -> string` — the `X` from `(Class X)`, or `""`.

- [ ] **Step 1: Write the failing test** — `verify-tmp/t1.js`

```js
const { chromium, CHROME, openList } = require("./_boot");
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage(); await openList(page);
  const r = await page.evaluate(() => ({
    fourUnit: parseBuildingType("RENOVATION OF EXISTING 4-UNIT RESIDENTIAL BUILDING"),
    twoFlat: parseBuildingType("REPAIR OF TWO-FLAT PORCH"),
    single: parseBuildingType("NEW SINGLE FAMILY RESIDENCE"),
    none: parseBuildingType("ELECTRICAL SERVICE UPGRADE"),
    typeE: parseLicenseType("General Contractor (Class E)"),
    typePlain: parseLicenseType("Electrical Contractor (General)"),
    classE: parseLicenseClass("General Contractor (Class E)"),
    classNone: parseLicenseClass("Plumbing Contractor"),
  }));
  const ok =
    r.fourUnit === "4-Unit" && r.twoFlat === "Two-Flat" && r.single === "Single Family" &&
    r.none === "" && r.typeE === "General Contractor" &&
    r.typePlain === "Electrical Contractor (General)" &&
    r.classE === "E" && r.classNone === "";
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(r));
  await b.close(); process.exit(ok ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node verify-tmp/t1.js`
Expected: FAIL (ReferenceError: parseBuildingType is not defined)

- [ ] **Step 3: Write minimal implementation** — add to `docs/list.html`

```js
    // Best-effort building/dwelling type from the free-text work description.
    // Heuristic only — callers MUST label the result "approx.". "" when nothing matches.
    function parseBuildingType(desc) {
      const s = (desc || "").toUpperCase();
      const num = s.match(/\b(\d{1,3})[- ]?UNIT\b/);
      if (num) return `${num[1]}-Unit`;
      if (/\bSINGLE[- ]FAMILY\b/.test(s)) return "Single Family";
      if (/\bTWO[- ]?FLAT\b/.test(s)) return "Two-Flat";
      if (/\bTHREE[- ]?FLAT\b/.test(s)) return "Three-Flat";
      if (/\bTOWN\s?HO(ME|USE)\b/.test(s)) return "Townhome";
      if (/\bCONDO(MINIUM)?\b/.test(s)) return "Condominium";
      if (/\bMIXED[- ]USE\b/.test(s)) return "Mixed Use";
      if (/\bAPARTMENT|MULTI[- ]?FAMILY\b/.test(s)) return "Apartment / Multi-Family";
      if (/\bCOMMERCIAL\b/.test(s)) return "Commercial";
      return "";
    }

    // Trade portion of a license type string, e.g. "General Contractor (Class E)" -> "General Contractor".
    function parseLicenseType(licenseType) {
      return (licenseType || "").replace(/\s*\(Class\s+[A-Z]\)\s*/i, "").trim();
    }

    // Class letter from a license type string, e.g. "... (Class E)" -> "E". "" when none.
    function parseLicenseClass(licenseType) {
      const m = (licenseType || "").match(/\(Class\s+([A-Z])\)/i);
      return m ? m[1].toUpperCase() : "";
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node verify-tmp/t1.js`
Expected: `PASS ...`

- [ ] **Step 5: Commit**

```bash
git add docs/list.html .gitignore
git commit -m "feat(list): add building-type + license parse helpers"
```

---

### Task 2: Overlay shell — markup, CSS, open/close controller (list.html)

Low-level modal machinery, independent of permit content. Content is passed as an HTML string.

**Files:**
- Modify: `docs/list.html` — add modal markup before `</body>`; add CSS in the `<style>` block; add JS controller near the other detail functions (~line 3241).
- Test: `verify-tmp/t2.js`

**Interfaces:**
- Produces:
  - `openPermitModal(html: string, opts?: { onOpen?: (root: HTMLElement) => void }) -> void` — injects `html` into the modal body, shows the overlay, locks background scroll, traps focus, pushes a history entry so browser-back closes it, and calls `opts.onOpen(modalBodyEl)` after injection (used later for async fills).
  - `closePermitModal() -> void` — hides overlay, unlocks scroll, restores focus and scroll position, and — when a history entry is present — consumes it.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test** — `verify-tmp/t2.js`

```js
const { chromium, CHROME, openList } = require("./_boot");
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage(); await openList(page);
  await page.evaluate(() => openPermitModal("<p id='probe'>hello</p>"));
  const opened = await page.evaluate(() => ({
    visible: !document.getElementById("permit-modal").hasAttribute("hidden"),
    bodyLocked: document.body.classList.contains("modal-open"),
    probe: !!document.getElementById("probe"),
    dialog: document.querySelector("#permit-modal [role='dialog']") != null,
  }));
  await page.keyboard.press("Escape");
  const closed = await page.evaluate(() => ({
    visible: !document.getElementById("permit-modal").hasAttribute("hidden"),
    bodyLocked: document.body.classList.contains("modal-open"),
  }));
  const ok = opened.visible && opened.bodyLocked && opened.probe && opened.dialog &&
             !closed.visible && !closed.bodyLocked;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify({ opened, closed }));
  await b.close(); process.exit(ok ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node verify-tmp/t2.js`
Expected: FAIL (openPermitModal is not defined)

- [ ] **Step 3a: Add modal markup** — insert immediately before `</body>` in `docs/list.html`

```html
  <div id="permit-modal" class="permit-modal" hidden>
    <div class="permit-modal-backdrop" onclick="closePermitModal()"></div>
    <div class="permit-modal-card" role="dialog" aria-modal="true" aria-labelledby="permit-modal-title">
      <div id="permit-modal-body" class="permit-modal-body"></div>
    </div>
  </div>
```

- [ ] **Step 3b: Add CSS** — append to the `<style>` block in `docs/list.html`

```css
    body.modal-open { overflow: hidden; }
    .permit-modal { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; }
    .permit-modal[hidden] { display: none; }
    .permit-modal-backdrop { position: absolute; inset: 0; background: rgba(16,26,40,0.55); }
    .permit-modal-card {
      position: relative; z-index: 1; display: flex; flex-direction: column;
      width: min(560px, 92vw); max-height: 88vh; background: var(--panel);
      border: 1px solid var(--line); border-radius: 14px; overflow: hidden;
      box-shadow: 0 24px 60px -18px rgba(16,26,40,0.45);
    }
    .permit-modal-body { overflow-y: auto; overscroll-behavior: contain; }
    @media (max-width: 640px) {
      .permit-modal-card { width: 100vw; height: 100dvh; max-height: 100dvh; border: 0; border-radius: 0; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .permit-modal:not([hidden]) .permit-modal-card { animation: permitRise 0.24s ease; }
      @keyframes permitRise { from { opacity: 0; transform: translateY(14px); } }
    }
```

- [ ] **Step 3c: Add controller JS** — add near `closeDetail` (~line 3294) in `docs/list.html`

```js
    let _permitModalPrevFocus = null;
    let _permitModalScrollY = 0;
    let _permitModalHistory = false;

    function openPermitModal(html, opts = {}) {
      const modal = $("permit-modal");
      const body = $("permit-modal-body");
      _permitModalPrevFocus = document.activeElement;
      _permitModalScrollY = window.scrollY;
      body.innerHTML = html;
      modal.hidden = false;
      document.body.classList.add("modal-open");
      // Browser back closes the modal (Android/iOS back gesture).
      history.pushState({ permitModal: true }, "");
      _permitModalHistory = true;
      // Focus first focusable control (or the card) for keyboard users.
      const focusable = body.querySelector("button, a[href], textarea, input, [tabindex]");
      (focusable || modal.querySelector(".permit-modal-card")).focus?.();
      if (opts.onOpen) opts.onOpen(body);
    }

    function closePermitModal(fromPopState = false) {
      const modal = $("permit-modal");
      if (modal.hidden) return;
      modal.hidden = true;
      $("permit-modal-body").innerHTML = "";
      document.body.classList.remove("modal-open");
      window.scrollTo(0, _permitModalScrollY);
      if (_permitModalPrevFocus && _permitModalPrevFocus.focus) _permitModalPrevFocus.focus();
      if (_permitModalHistory && !fromPopState) { _permitModalHistory = false; history.back(); }
      else { _permitModalHistory = false; }
    }

    window.addEventListener("popstate", () => {
      if (!$("permit-modal").hidden) closePermitModal(true);
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !$("permit-modal").hidden) closePermitModal();
      if (e.key === "Tab" && !$("permit-modal").hidden) trapPermitModalFocus(e);
    });

    // Keep Tab focus inside the open modal.
    function trapPermitModalFocus(e) {
      const nodes = [...$("permit-modal").querySelectorAll(
        'button:not([disabled]), a[href], textarea, input, [tabindex]:not([tabindex="-1"])'
      )].filter(n => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
```

Also add `tabindex="-1"` to the card so it can receive focus: change the `permit-modal-card` div to `<div class="permit-modal-card" role="dialog" aria-modal="true" aria-labelledby="permit-modal-title" tabindex="-1">`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node verify-tmp/t2.js`
Expected: `PASS ...`

- [ ] **Step 5: Commit**

```bash
git add docs/list.html
git commit -m "feat(list): add permit detail overlay shell (modal/sheet)"
```

---

### Task 3: Section renderer + open entry point (list.html)

Builds the ordered detail content from a row (synchronous fields), with placeholders where async fills land later.

**Files:**
- Modify: `docs/list.html` — add renderer functions near `showPermitDetail` (~line 6048).
- Test: `verify-tmp/t3.js`

**Interfaces:**
- Consumes: `parseBuildingType` (Task 1); `openPermitModal` (Task 2); existing `esc`, `money`, `clean`, `days`, `isInUserList`, `enc`, `addPermitFromEncoded`, `geoZoneCache`, `geoTifCache`.
- Produces:
  - `permitDetailSections(row) -> Array<() => string>` — ordered section builders (extensibility seam).
  - `permitDetailHtml(row) -> string` — concatenated sections wrapped for the modal.
  - `openPermitDetail(row) -> void` — `openPermitModal(permitDetailHtml(row), { onOpen })` where `onOpen` triggers the async geo + contractor fills (Tasks 4–5). In THIS task `onOpen` may be a no-op stub; Tasks 4–5 fill it in.

- [ ] **Step 1: Write the failing test** — `verify-tmp/t3.js`

```js
const { chromium, CHROME, openList } = require("./_boot");
const SAMPLE_ROW = { permit_number: "100991233", permit_type: "PERMIT - RENOVATION/ALTERATION",
  permit_status: "ACTIVE", issue_date: "2026-06-01", address: "2500 N Milwaukee Ave",
  community_area: "Logan Square", review_type: "Standard Plan Review", work_type: "Interior alteration",
  processing_time: "34", work_description: "RENOVATION OF EXISTING 4-UNIT RESIDENTIAL BUILDING",
  reported_cost: "248500", total_fee: "3412", general_contractors: "Halsted Building Group LLC",
  open_subs: "Sparkline Electric Inc" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage(); await openList(page);
  await page.evaluate(row => openPermitDetail(row), SAMPLE_ROW);
  const t = await page.evaluate(() => {
    const body = document.getElementById("permit-modal-body");
    const text = body.innerText;
    return {
      heads: [...body.querySelectorAll("h3")].map(h => h.textContent.trim()),
      hasPermitNo: text.includes("100991233"),
      hasNeighborhood: /Neighborhood/.test(text) && /Logan Square/.test(text),
      hasBuildingType: /Building type/.test(text) && /4-Unit/.test(text),
      hasApprox: !!body.querySelector(".approx"),
      hasTotalFee: /Total fee/.test(text),
      notesStub: !!body.querySelector(".notes-stub"),
    };
  });
  const need = ["Location","Permit details","Work description","Costs & fees","General contractors","Open subs","Notes"];
  const ok = need.every(h => t.heads.includes(h)) && t.hasPermitNo && t.hasNeighborhood &&
             t.hasBuildingType && t.hasApprox && t.hasTotalFee && t.notesStub;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(t));
  await b.close(); process.exit(ok ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node verify-tmp/t3.js`
Expected: FAIL (openPermitDetail is not defined)

- [ ] **Step 3a: Add shared field/section CSS** — append to `<style>` in `docs/list.html`

```css
    .pm-head { display: flex; align-items: center; gap: 12px; padding: 16px 18px 14px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--panel); }
    .pm-head .pm-title { flex: 1; min-width: 0; }
    .pm-head .pm-title .k { font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
    .pm-head .pm-title .v { font-weight: 700; font-size: 1.02rem; }
    .pm-close { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; font-size: 1.05rem; flex: none; }
    .pm-content { padding: 4px 18px 22px; }
    .pm-tagrow { display: flex; flex-wrap: wrap; gap: 6px; padding: 14px 0 6px; }
    .pm-tag { font-size: 0.74rem; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: var(--primary-soft); border: 1px solid var(--line); color: var(--primary); }
    .pm-block { padding: 14px 0; border-top: 1px solid var(--line); }
    .pm-block h3 { margin: 0 0 10px; font-size: 0.72rem; letter-spacing: 0.11em; text-transform: uppercase; color: var(--primary); font-weight: 700; }
    .pm-facts { display: grid; grid-template-columns: minmax(96px, 34%) 1fr; gap: 7px 14px; }
    .pm-facts dt { color: var(--muted); font-size: 0.8rem; margin: 0; }
    .pm-facts dd { margin: 0; font-size: 0.88rem; }
    .approx { font-size: 0.66rem; font-weight: 700; text-transform: uppercase; color: #8a6100; background: #fbf0dc; padding: 1px 6px; border-radius: 5px; margin-left: 6px; cursor: help; }
    .notes-stub { border: 1px dashed var(--line); border-radius: 10px; padding: 12px 14px; background: var(--panel-2, var(--bg)); color: var(--muted); font-size: 0.86rem; }
```

(If `--text`, `--panel`, `--primary`, `--primary-soft`, `--muted`, `--line`, `--bg` names differ in this file, use the file's existing token names — grep `:root` in `docs/list.html`.)

- [ ] **Step 3b: Add renderer JS** — add above `showPermitDetail` in `docs/list.html`

```js
    // One fact row list; missing values render as an em-dash.
    function pmFacts(pairs) {
      return `<dl class="pm-facts">${pairs.map(([k, v, extra]) =>
        `<dt>${esc(k)}</dt><dd>${v ? esc(v) : "—"}${extra || ""}</dd>`).join("")}</dl>`;
    }

    // Ordered section builders — insert future sections here (extensibility seam).
    function permitDetailSections(row) {
      const num = clean(row.permit_number);
      const bt = parseBuildingType(row.work_description);
      const approx = bt ? ` <span class="approx" title="Guessed from the work description — not an official field">approx.</span>` : "";
      const saved = isInUserList(row.permit_number);
      const payload = enc(JSON.stringify(row));
      return [
        () => `<div class="pm-head">
            <div class="pm-title"><div class="k">Permit</div><div class="v" id="permit-modal-title">${esc(row.permit_number)}</div></div>
            <button class="primary" onclick="addPermitFromEncoded('${payload}')" ${saved ? "disabled" : ""}>${saved ? "✓ Saved" : "Add to list"}</button>
            <button class="pm-close" aria-label="Close" onclick="closePermitModal()">✕</button>
          </div>
          <div class="pm-content">
          <div class="pm-tagrow">
            <span class="pm-tag">${esc(row.permit_status)}</span>
            <span class="pm-tag">${esc(row.permit_type)}</span>
            ${row.reported_cost ? `<span class="pm-tag">${money(row.reported_cost)}</span>` : ""}
          </div>`,
        () => `<section class="pm-block"><h3>Location</h3>${pmFacts([
            ["Address", clean(row.address)],
            ["Neighborhood", clean(row.community_area)],
            ["Zone", "", `<span class="geo-zone" data-permit="${esc(num)}">${geoZoneCache.has(num) ? esc(geoZoneCache.get(num) || "—") : "…"}</span>`],
            ["TIF district", "", `<span class="geo-tif" data-permit="${esc(num)}">${geoTifCache.has(num) ? esc(geoTifCache.get(num) || "—") : "…"}</span>`],
          ])}</section>`,
        () => `<section class="pm-block"><h3>Permit details</h3>${pmFacts([
            ["Issue date", clean(row.issue_date)],
            ["Permit type", clean(row.permit_type)],
            ["Status", clean(row.permit_status)],
            ["Building type", bt, approx],
            ["Review type", clean(row.review_type)],
            ["Work type", clean(row.work_type)],
            ["Processing time", days ? days(row.processing_time) : clean(row.processing_time)],
          ])}</section>`,
        () => row.work_description ? `<section class="pm-block"><h3>Work description</h3><p class="small">${esc(row.work_description)}</p></section>` : "",
        () => `<section class="pm-block"><h3>Costs &amp; fees</h3>${pmFacts([
            ["Reported cost", money(row.reported_cost)],
            ["Total fee", money(row.total_fee)],
          ])}</section>`,
        () => `<section class="pm-block"><h3>General contractors</h3><div class="pm-contractors" data-role="general_contractor">${contractorLinesHtml(row.general_contractors, "general_contractor")}</div></section>`,
        () => `<section class="pm-block"><h3>Open subs</h3><div class="pm-contractors" data-role="open_tech">${contractorLinesHtml(row.open_subs, "open_tech")}</div></section>`,
        () => `<section class="pm-block"><h3>Notes</h3><div class="notes-stub">Notes for this permit — coming this session.</div></section>`,
        () => `</div>`, // close .pm-content
      ];
    }

    function permitDetailHtml(row) {
      return permitDetailSections(row).map(fn => fn()).join("");
    }

    // Public entry point for opening a permit's detail overlay.
    function openPermitDetail(row) {
      state.activeDetail = { type: "permit", row };
      openPermitModal(permitDetailHtml(row), { onOpen: body => { /* async fills wired in Tasks 4–5 */ } });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node verify-tmp/t3.js`
Expected: `PASS ...`

- [ ] **Step 5: Commit**

```bash
git add docs/list.html
git commit -m "feat(list): section-based permit detail renderer + open entry point"
```

---

### Task 4: Contractor fill — License type, Class, Does, open jobs, phone (list.html)

Extend the existing on-demand fetch to also carry work types + license type, and render the full contractor entry.

**Files:**
- Modify: `docs/list.html` — extend `fetchContractorInfo` (~line 5943) and add `fillPermitContractors`; wire it into `openPermitDetail`'s `onOpen`.
- Test: `verify-tmp/t4.js`

**Interfaces:**
- Consumes: `parseLicenseType`, `parseLicenseClass` (Task 1); existing `fetchContractorInfo`, `contractorLinesHtml`, `API_BASE`.
- Produces: `fillPermitContractors(body: HTMLElement) -> Promise<void>` — fills every `.contractor-line` inside `body` with License type / Class / Does / open-jobs / phone.

- [ ] **Step 1: Write the failing test** — `verify-tmp/t4.js` (stubs the Worker `/api/contact`)

```js
const { chromium, CHROME, openList } = require("./_boot");
const SAMPLE_ROW = { permit_number: "100991233", permit_type: "X", permit_status: "ACTIVE",
  issue_date: "2026-06-01", address: "2500 N Milwaukee Ave", community_area: "Logan Square",
  review_type: "R", work_type: "W", processing_time: "34", work_description: "4-UNIT",
  reported_cost: "1", total_fee: "1", general_contractors: "Halsted Building Group LLC", open_subs: "" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage();
  await page.route("**/api/contact/**", r => r.fulfill({ json: {
    open_jobs: 4,
    work_types: [{ work_type: "Nonstructural Interior Work", jobs: 9 }, { work_type: "Reroofing", jobs: 4 }, { work_type: "Masonry Work", jobs: 2 }, { work_type: "Fence", jobs: 1 }],
    license_matches: [{ license_type: "General Contractor (Class E)", phone: "(312) 555-0142" }],
  }}));
  await openList(page);
  await page.evaluate(row => openPermitDetail(row), SAMPLE_ROW);
  await page.waitForFunction(() => /Class E/.test(document.getElementById("permit-modal-body").innerText), { timeout: 5000 });
  const t = await page.evaluate(() => {
    const txt = document.getElementById("permit-modal-body").innerText;
    return { licType: /General Contractor/.test(txt), cls: /Class E/.test(txt),
      does: /Nonstructural Interior Work/.test(txt) && /Masonry Work/.test(txt),
      onlyThree: !/Fence/.test(txt), jobs: /4 open jobs/.test(txt),
      phone: !!document.querySelector('#permit-modal-body a[href^="tel:"]') };
  });
  const ok = t.licType && t.cls && t.does && t.onlyThree && t.jobs && t.phone;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(t));
  await b.close(); process.exit(ok ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node verify-tmp/t4.js`
Expected: FAIL (Does line / Class not rendered; timeout)

- [ ] **Step 3a: Extend `fetchContractorInfo`** — in `docs/list.html`, replace its body so it also returns `license_type` and `does`

```js
    async function fetchContractorInfo(name, role) {
      const key = role + " " + name.toLowerCase();
      if (contractorInfoCache.has(key)) return contractorInfoCache.get(key);
      let info = null;
      try {
        const res = await fetch(`${API_BASE}/api/contact/${encodeURIComponent(name)}?category=${role}`);
        if (res.ok) {
          const p = await res.json();
          const phone = (p.license_matches || []).map(m => clean(m.phone)).find(ph => ph && ph.toUpperCase() !== "NA") || "";
          const license_type = (p.license_matches || []).map(m => clean(m.license_type)).find(Boolean) || "";
          const does = (p.work_types || []).slice(0, 3).map(w => clean(w.work_type)).filter(Boolean);
          info = { open_jobs: p.open_jobs, phone, license_type, does };
        }
      } catch {}
      contractorInfoCache.set(key, info);
      return info;
    }
```

- [ ] **Step 3b: Add `fillPermitContractors`** — in `docs/list.html`, near `fillContractorInfo`

```js
    async function fillPermitContractors(body) {
      const lines = [...body.querySelectorAll(".contractor-line:not([data-filled])")];
      await Promise.all(lines.map(async line => {
        line.setAttribute("data-filled", "1");
        const meta = line.querySelector(".ci-meta");
        const info = await fetchContractorInfo(line.getAttribute("data-contractor"), line.getAttribute("data-role"));
        if (!info) { meta.textContent = ""; return; }
        const licType = parseLicenseType(info.license_type);
        const cls = parseLicenseClass(info.license_type);
        const chips = [];
        if (licType) chips.push(`<span class="lic-type">${esc(licType)}</span>`);
        if (cls) chips.push(`<span class="lic-class">Class ${esc(cls)}</span>`);
        const bits = [];
        if (info.open_jobs != null) bits.push(esc(`${fmt(info.open_jobs)} open jobs`));
        if (info.phone) {
          const tel = info.phone.replace(/[^\d+]/g, "");
          bits.push(`<a href="tel:${esc(tel)}" onclick="event.stopPropagation()">${esc(info.phone)}</a>`);
        }
        meta.innerHTML =
          (chips.length ? `<div class="clic">${chips.join("")}</div>` : "") +
          (info.does && info.does.length ? `<div class="cdoes"><span class="dk">Does</span> ${info.does.map(esc).join(" · ")}</div>` : "") +
          (bits.length ? `<div class="cmeta-line">${bits.join(" · ")}</div>` : "");
      }));
    }
```

- [ ] **Step 3c: Add contractor CSS** — append to `<style>`

```css
    .pm-contractors .clic { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
    .pm-contractors .lic-type { font-size: 0.72rem; font-weight: 600; color: var(--primary); background: var(--primary-soft); padding: 2px 8px; border-radius: 6px; }
    .pm-contractors .lic-class { font-size: 0.72rem; font-weight: 600; color: var(--text); background: var(--bg); border: 1px solid var(--line); padding: 2px 8px; border-radius: 6px; }
    .pm-contractors .cdoes { font-size: 0.79rem; color: var(--text); margin-top: 4px; }
    .pm-contractors .cdoes .dk { font-size: 0.66rem; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-right: 4px; }
    .pm-contractors .cmeta-line { font-size: 0.79rem; color: var(--muted); margin-top: 4px; }
```

- [ ] **Step 3d: Wire the fill into `openPermitDetail`** — replace the `onOpen` no-op

```js
      openPermitModal(permitDetailHtml(row), { onOpen: body => { fillPermitContractors(body); } });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node verify-tmp/t4.js`
Expected: `PASS ...`

- [ ] **Step 5: Commit**

```bash
git add docs/list.html
git commit -m "feat(list): contractor license type, class, and work-type lines in detail"
```

---

### Task 5: Fill Zone / TIF in the open modal (list.html)

Populate the Zone/TIF placeholders using the existing geo cache/fetch.

**Files:**
- Modify: `docs/list.html` — add `fillPermitGeo`; call it from `openPermitDetail`'s `onOpen`.
- Test: `verify-tmp/t5.js`

**Interfaces:**
- Consumes: existing `resolveGeoForRows(rows)`, `geoZoneCache`, `geoTifCache`, `clean`.
- Produces: `fillPermitGeo(body, row) -> Promise<void>` — resolves the row's geo and writes the `.geo-zone` / `.geo-tif` spans inside `body`.

- [ ] **Step 1: Write the failing test** — `verify-tmp/t5.js` (seed the caches so no network)

```js
const { chromium, CHROME, openList } = require("./_boot");
const ROW = { permit_number: "100991233", permit_type: "X", permit_status: "ACTIVE", issue_date: "d",
  address: "a", community_area: "Logan Square", review_type: "r", work_type: "w", processing_time: "1",
  work_description: "", reported_cost: "1", total_fee: "1", general_contractors: "", open_subs: "" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage(); await openList(page);
  await page.evaluate(() => { geoZoneCache.set("100991233", "B3-2"); geoTifCache.set("100991233", "Fullerton/Milwaukee"); });
  await page.evaluate(row => openPermitDetail(row), ROW);
  await page.waitForFunction(() => /B3-2/.test(document.getElementById("permit-modal-body").innerText), { timeout: 5000 });
  const t = await page.evaluate(() => {
    const txt = document.getElementById("permit-modal-body").innerText;
    return { zone: /B3-2/.test(txt), tif: /Fullerton\/Milwaukee/.test(txt) };
  });
  const ok = t.zone && t.tif;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(t));
  await b.close(); process.exit(ok ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node verify-tmp/t5.js`
Expected: FAIL (spans still show "…"; timeout)

- [ ] **Step 3a: Add `fillPermitGeo`** — in `docs/list.html`

```js
    async function fillPermitGeo(body, row) {
      const num = clean(row.permit_number);
      if (!geoZoneCache.has(num) || !geoTifCache.has(num)) {
        try { await resolveGeoForRows([row]); } catch {}
      }
      const zone = body.querySelector(`.geo-zone[data-permit="${CSS.escape(num)}"]`);
      const tif = body.querySelector(`.geo-tif[data-permit="${CSS.escape(num)}"]`);
      if (zone) zone.textContent = geoZoneCache.get(num) || "—";
      if (tif) tif.textContent = geoTifCache.get(num) || "—";
    }
```

- [ ] **Step 3b: Call it from `openPermitDetail`** — update `onOpen`

```js
      openPermitModal(permitDetailHtml(row), { onOpen: body => { fillPermitContractors(body); fillPermitGeo(body, row); } });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node verify-tmp/t5.js`
Expected: `PASS ...`

- [ ] **Step 5: Commit**

```bash
git add docs/list.html
git commit -m "feat(list): fill Zone/TIF in permit detail overlay"
```

---

### Task 6: Wire the saved list to the overlay; remove the inline dropdown (list.html)

Make row-click open the overlay, and delete the old inline `.permit-more-*` cell/toggle.

**Files:**
- Modify: `docs/list.html` — `permitTable` (~line 5848–5882): remove the `.permit-more-cell` `<td>` (the `options.move ? ...` block at ~5877) and the `moveHead`/`.permit-more-cell` header if present; change the row `onclick` for the saved list to open the detail. Remove now-dead `togglePermitMore` (~5919).
- Test: `verify-tmp/t6.js`

**Interfaces:**
- Consumes: `openPermitDetail` (Task 3). Keep `contractorLinesHtml`, `fetchContractorInfo` (still used by the overlay).

- [ ] **Step 1: Write the failing test** — `verify-tmp/t6.js` (injects a saved list, clicks a row)

```js
const { chromium, CHROME, openList } = require("./_boot");
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage(); await openList(page);
  // Inject a one-permit saved list and re-render.
  await page.evaluate(() => {
    const row = { permit_number: "100991233", permit_type: "PERMIT - RENOVATION/ALTERATION",
      permit_status: "ACTIVE", issue_date: "2026-06-01", address: "2500 N Milwaukee Ave",
      community_area: "Logan Square", review_type: "R", work_type: "W", processing_time: "34",
      work_description: "4-UNIT", reported_cost: "1", total_fee: "1", general_contractors: "", open_subs: "" };
    state.userPermitNumbers = ["100991233"];
    state.userPermitMap = { "100991233": row };
    renderUserList();
  });
  await page.waitForSelector(".saved-permits-table tbody tr");
  const noDropdown = await page.evaluate(() => !document.querySelector(".permit-more-toggle"));
  await page.click(".saved-permits-table tbody tr");
  const opened = await page.evaluate(() => !document.getElementById("permit-modal").hidden &&
    /100991233/.test(document.getElementById("permit-modal-body").innerText));
  const ok = noDropdown && opened;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify({ noDropdown, opened }));
  await b.close(); process.exit(ok ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node verify-tmp/t6.js`
Expected: FAIL (`.permit-more-toggle` still present, and/or row click does not open overlay)

- [ ] **Step 3a: Change the saved-list row click** — in `permitTable` (`docs/list.html`), the row `onclick` currently is:

```js
              onclick="${options.select ? `selectPermit(${i})` : `showPermitFromEncoded('${enc(JSON.stringify(row))}')`}"
```

Change the non-select branch to open the overlay directly:

```js
              onclick="${options.select ? `selectPermit(${i})` : `openPermitDetailFromEncoded('${enc(JSON.stringify(row))}')`}"
```

Then add a small decoder helper near `showPermitFromEncoded` (~line 5808):

```js
    function openPermitDetailFromEncoded(encoded) {
      openPermitDetail(JSON.parse(decodeURIComponent(encoded)));
    }
```

(Net effect: clicking a saved row calls `openPermitDetailFromEncoded`, which opens the overlay. `showPermitFromEncoded` remains for the search-results card path until Task 8.)

- [ ] **Step 3b: Remove the inline details cell** — in `permitTable`, delete the entire `options.move ? \`<td class="permit-more-cell">…</td>\` : ""` block (the long line at ~5877). Leave the surrounding notes/move cells intact.

- [ ] **Step 3c: Remove dead code** — delete the `togglePermitMore` function (~line 5919) and the `.permit-more-cell`, `.permit-more-toggle`, `.permit-more-body`, `.permit-more-grid`, `.permit-more-contacts` CSS rules (~lines 947–1046) and the `body.list-page .saved-permits-table td.permit-more-cell` rules (~2828). Keep `.contractor-line` / `.ci-name` / `.ci-meta` rules (still used by the overlay).

- [ ] **Step 4: Run test to verify it passes**

Run: `node verify-tmp/t6.js`
Expected: `PASS ...`

- [ ] **Step 5: Commit**

```bash
git add docs/list.html
git commit -m "feat(list): open detail overlay on row click; remove inline Details dropdown"
```

---

### Task 7: Notes section build-out in the overlay (list.html)

Bind the modal Notes section to the same store as the row textarea; verify existing notes survive.

**Files:**
- Modify: `docs/list.html` — replace the Notes stub builder in `permitDetailSections`; ensure `savePermitNote` also refreshes the row textarea if present.
- Test: `verify-tmp/t7.js`

**Interfaces:**
- Consumes: `state.userPermitNotes`, `savePermitNote(encodedNumber, value)`, `clean`, `esc`, `enc`.

- [ ] **Step 1: Write the failing test** — `verify-tmp/t7.js`

```js
const { chromium, CHROME, openList } = require("./_boot");
const ROW = { permit_number: "100991233", permit_type: "X", permit_status: "ACTIVE", issue_date: "d",
  address: "a", community_area: "c", review_type: "r", work_type: "w", processing_time: "1",
  work_description: "", reported_cost: "1", total_fee: "1", general_contractors: "", open_subs: "" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage(); await openList(page);
  // Pre-existing note must be shown and preserved.
  await page.evaluate(() => { state.userPermitNotes["100991233"] = "call Monday"; });
  await page.evaluate(row => openPermitDetail(row), ROW);
  const shown = await page.evaluate(() => document.querySelector("#permit-modal-body .pm-note").value);
  await page.evaluate(() => {
    const ta = document.querySelector("#permit-modal-body .pm-note");
    ta.value = "call Monday + email"; ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const stored = await page.evaluate(() => {
    return { state: state.userPermitNotes["100991233"],
      ls: JSON.parse(localStorage.getItem("chi_permit_user_notes")).permits["100991233"] };
  });
  const ok = shown === "call Monday" && stored.state === "call Monday + email" && stored.ls === "call Monday + email";
  console.log(ok ? "PASS" : "FAIL", JSON.stringify({ shown, stored }));
  await b.close(); process.exit(ok ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node verify-tmp/t7.js`
Expected: FAIL (`.pm-note` not found — section is still the stub)

- [ ] **Step 3a: Replace the Notes stub builder** — in `permitDetailSections` (`docs/list.html`), swap the last content section:

```js
        () => `<section class="pm-block"><h3>Notes</h3>
            <textarea class="pm-note" placeholder="Add a note about this permit…" aria-label="Note for permit ${esc(row.permit_number)}"
              oninput="savePermitNote('${enc(row.permit_number)}', this.value)">${esc(state.userPermitNotes[num] || "")}</textarea>
          </section>`,
```

(`num` is already defined at the top of `permitDetailSections`.)

- [ ] **Step 3b: Add note CSS** — append to `<style>`

```css
    .pm-note { width: 100%; min-height: 64px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--text); font: inherit; font-size: 0.88rem; padding: 9px 11px; resize: vertical; }
```

- [ ] **Step 3c: Keep row + overlay in sync** — at the end of `savePermitNote`, mirror the value into the other visible textarea for the same permit. Locate `savePermitNote` (~line 4411) and append before its close:

```js
      // Mirror into any other visible textarea for this permit (row <-> overlay).
      document.querySelectorAll(`.pm-note, .permit-note`).forEach(ta => {
        if (ta.value !== note && ta.getAttribute("data-permit") === number) ta.value = note;
      });
```

Add `data-permit="${esc(clean(row.permit_number))}"` to both the `.pm-note` textarea (Step 3a) and the existing `.permit-note` row textarea in `permitTable` so the mirror can target them. (If simpler, skip mirroring — the store is the source of truth and the row re-renders on next `renderUserList`; the test only requires the store to update. Mirroring is a polish nicety.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node verify-tmp/t7.js`
Expected: `PASS ...`

- [ ] **Step 5: Commit**

```bash
git add docs/list.html
git commit -m "feat(list): editable Notes in permit detail overlay (shared store, preserved)"
```

---

### Task 8: Search Directory parity on list.html (rewrite `showPermitDetail`)

Point the search-side permit view at the same overlay.

**Files:**
- Modify: `docs/list.html` — replace `showPermitDetail` (~line 6048) body to delegate to `openPermitDetail`; update `showPermitFromEncoded` (~line 5808) if it routed to the old panel; `selectPermit` (~line 6044) already calls `showPermitDetail`.
- Test: `verify-tmp/t8.js`

**Interfaces:**
- Consumes: `openPermitDetail` (Task 3).

- [ ] **Step 1: Write the failing test** — `verify-tmp/t8.js`

```js
const { chromium, CHROME, openList } = require("./_boot");
const ROW = { permit_number: "777", permit_type: "X", permit_status: "ACTIVE", issue_date: "d",
  address: "a", community_area: "Loop", review_type: "r", work_type: "w", processing_time: "1",
  work_description: "", reported_cost: "1", total_fee: "1", general_contractors: "", open_subs: "" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage(); await openList(page);
  await page.evaluate(row => showPermitDetail(row), ROW);
  const ok = await page.evaluate(() => !document.getElementById("permit-modal").hidden &&
    /777/.test(document.getElementById("permit-modal-body").innerText) &&
    /Neighborhood/.test(document.getElementById("permit-modal-body").innerText));
  console.log(ok ? "PASS" : "FAIL");
  await b.close(); process.exit(ok ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node verify-tmp/t8.js`
Expected: FAIL (old `showPermitDetail` renders into `#detail-panel`, not `#permit-modal`)

- [ ] **Step 3: Replace `showPermitDetail`** — in `docs/list.html`

```js
    function showPermitDetail(row, pushHistory = true) {
      openPermitDetail(row);
    }
```

Leave `showDetail`/`detailShell`/`closeDetail`/`#detail-panel` in place — they still serve contact profiles (`openContactProfile`, `selectContact`). Only permit views move to the overlay.

- [ ] **Step 4: Run test to verify it passes**

Run: `node verify-tmp/t8.js`
Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add docs/list.html
git commit -m "feat(list): search-directory permit view uses the detail overlay"
```

---

### Task 9: Port everything to index.html

Replicate the identical helpers, markup, CSS, and renderer; rewrite index.html's `showPermitDetail`.

**Files:**
- Modify: `docs/index.html` — add the same modal markup before `</body>`; the same overlay + field/contractor/note CSS; the same JS functions (`parseBuildingType`, `parseLicenseType`, `parseLicenseClass`, `openPermitModal`/`closePermitModal` + popstate/keydown/trap, `pmFacts`, `permitDetailSections`, `permitDetailHtml`, `openPermitDetail`, `fillPermitContractors`, `fillPermitGeo`, note handling); rewrite `showPermitDetail` (~line 5228) to call `openPermitDetail`.
- Test: `verify-tmp/t9.js`

**Interfaces:**
- Must match list.html exactly. Before porting, confirm index.html has the primitives these depend on: `esc`, `money`, `clean`, `enc`, `isInUserList`/equivalent, `fetchContractorInfo` or `contractorLinesHtml`, `geoZoneCache`/`geoTifCache`/`resolveGeoForRows`. If index.html lacks the contractor fetch or geo cache, guard those fills (e.g. `if (typeof resolveGeoForRows === "function")`) so the shell still renders. Note any missing primitive in the commit body.

- [ ] **Step 1: Write the failing test** — `verify-tmp/t9.js`

```js
const { chromium, CHROME } = require("./_boot");
const ROW = { permit_number: "888", permit_type: "X", permit_status: "ACTIVE", issue_date: "d",
  address: "a", community_area: "Loop", review_type: "r", work_type: "w", processing_time: "1",
  work_description: "3-UNIT BUILDING", reported_cost: "1", total_fee: "1", general_contractors: "", open_subs: "" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage();
  await page.goto("http://localhost:8791/index.html");
  await page.waitForFunction(() => typeof state !== "undefined");
  await page.evaluate(row => showPermitDetail(row), ROW);
  const ok = await page.evaluate(() => {
    const body = document.getElementById("permit-modal-body");
    return body && !document.getElementById("permit-modal").hidden &&
      /888/.test(body.innerText) && /Neighborhood/.test(body.innerText) &&
      /Building type/.test(body.innerText) && /3-Unit/.test(body.innerText);
  });
  console.log(ok ? "PASS" : "FAIL");
  await b.close(); process.exit(ok ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node verify-tmp/t9.js`
Expected: FAIL (no `#permit-modal` in index.html yet)

- [ ] **Step 3: Port the code** — copy the markup/CSS/JS from list.html into index.html (same names, same content — this is the "must stay identical" constraint) and replace index.html's `showPermitDetail` with:

```js
    function showPermitDetail(row, pushHistory = true) {
      openPermitDetail(row);
    }
```

Use index.html's own token names in the CSS if they differ (grep its `:root`). Adjust the Building type / Neighborhood into index's existing permit-detail data flow.

- [ ] **Step 4: Run test to verify it passes**

Run: `node verify-tmp/t9.js`
Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add docs/index.html
git commit -m "feat(index): permit detail overlay parity with list.html"
```

---

### Task 10: Accessibility + dual-theme + reduced-motion polish (both pages)

A dedicated review/verify pass (spec item 8). Load **ui-ux-pro-max** for the accessibility/contrast checklist.

**Files:**
- Modify: `docs/list.html`, `docs/index.html` — small a11y/contrast fixes as found.
- Test: `verify-tmp/t10.js` + screenshots.

**Interfaces:** none new.

- [ ] **Step 1: Load ui-ux-pro-max** and walk its accessibility checklist against the overlay (focus order, focus-visible, contrast in both themes, 44px targets, `aria-modal`, labelled title).

- [ ] **Step 2: Write the verify script** — `verify-tmp/t10.js`

```js
const { chromium, CHROME, openList } = require("./_boot");
const ROW = { permit_number: "999", permit_type: "X", permit_status: "ACTIVE", issue_date: "d",
  address: "a", community_area: "Loop", review_type: "r", work_type: "w", processing_time: "1",
  work_description: "", reported_cost: "1", total_fee: "1", general_contractors: "", open_subs: "" };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  for (const theme of ["light", "dark"]) {
    const page = await b.newPage();
    await page.emulateMedia({ colorScheme: theme });
    await openList(page);
    await page.evaluate(row => openPermitDetail(row), ROW);
    const a = await page.evaluate(() => {
      const card = document.querySelector("#permit-modal [role='dialog']");
      return { modal: card.getAttribute("aria-modal") === "true",
        labelled: !!document.getElementById(card.getAttribute("aria-labelledby")),
        closeName: !!document.querySelector('.pm-close[aria-label]') };
    });
    if (!a.modal || !a.labelled || !a.closeName) { console.log("FAIL", theme, JSON.stringify(a)); await b.close(); process.exit(1); }
    await page.locator("#permit-modal .permit-modal-card").screenshot({ path: `verify-tmp/modal-${theme}.png` });
    await page.close();
  }
  console.log("PASS (see verify-tmp/modal-light.png, modal-dark.png)");
  await b.close();
})();
```

- [ ] **Step 3: Run it, fix any a11y/contrast issues found**

Run: `node verify-tmp/t10.js` — Expected: `PASS`; then eyeball both screenshots for contrast and truncation in each theme, and apply fixes to both files.

- [ ] **Step 4: Full regression** — re-run every script to confirm nothing regressed

Run: `for t in t1 t2 t3 t4 t5 t6 t7 t8 t9 t10; do node verify-tmp/$t.js || echo "REGRESSION $t"; done`
Expected: all `PASS`, no `REGRESSION`.

- [ ] **Step 5: Commit**

```bash
git add docs/list.html docs/index.html
git commit -m "polish(detail): a11y, dual-theme, and reduced-motion pass on permit overlay"
```

---

## Self-Review

**Spec coverage:**
- Modal desktop / full-screen mobile + animation + scroll-lock → Task 2 (CSS breakpoint, `permitRise`, `body.modal-open`, `overscroll-behavior`). ✅
- Trigger = row click, inline dropdown removed → Task 6. ✅
- Close via ✕ / backdrop / Esc / browser back → Task 2 (`closePermitModal`, backdrop `onclick`, keydown Esc, popstate). ✅
- Content + order (Location/Neighborhood/Zone/TIF, Permit details w/ Building type approx, Work desc, Costs, GC/Subs, Notes) → Task 3. ✅
- Building type best-effort + approx badge → Task 1 (`parseBuildingType`) + Task 3 (badge). ✅
- Contractor License type + Class + Does + jobs + phone → Task 1 (parsers) + Task 4. ✅
- Zone/TIF on-demand → Task 5. ✅
- Notes preserved + this-session build-out → Task 7 (key/shape untouched; overlay textarea binds to `savePermitNote`). ✅
- Extensibility (ordered section builders) → Task 3 (`permitDetailSections` array). ✅
- Search Directory parity (list.html + index.html) → Tasks 8, 9. ✅
- Route info stays in list → untouched (Task 6 removes only `.permit-more-cell`, not `routeLegText`). ✅
- Accessibility, both themes, reduced motion → Task 2 + Task 10. ✅

**Placeholder scan:** No "TBD/TODO"; every code step shows real code; Task 9's port explicitly repeats (does not say "same as Task N") because the constraint requires identical copies — the source is Task 1–8's committed code in list.html.

**Type consistency:** `openPermitModal(html, opts)` / `closePermitModal(fromPopState)` / `openPermitDetail(row)` / `permitDetailSections(row)` / `permitDetailHtml(row)` / `fillPermitContractors(body)` / `fillPermitGeo(body, row)` / `parseBuildingType(desc)` / `parseLicenseType(s)` / `parseLicenseClass(s)` — names used consistently across Tasks 2–9.
