# Permit construction stage (FEAT-046) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each permit's construction stage everywhere a permit is displayed, sourced from `permit_milestone` on `ydr8-5enu`.

**Architecture:** Add one column to seven existing SoQL `$select` lists, add one frozen lookup table plus two helper functions to each of the three pages, and call the helper at six render sites. No new endpoint, no new dependency, no build step. The lookup table is triplicated to match the codebase, and a drift test enforces that the copies agree.

**Tech Stack:** Vanilla JS in three self-contained HTML pages; Cloudflare Worker (`worker/src/permits.js`); `node --test` for unit tests; Playwright for browser verification.

**Spec:** `docs/superpowers/specs/2026-08-10-permit-milestones-design.md`

## Global Constraints

- **Never edit `docs/*.html` through a bash heredoc.** Use the Edit tool. Heredocs embed invisible 0x08/NUL bytes; this has bitten the repo three times.
- **Both `docs/index.html` and `docs/list.html` working trees are CRLF.** Multi-line search anchors written with `\n` silently never match.
- **Overlay code is byte-identical across `index.html` and `list.html` by design.** Any change to a shared block goes into both, and the block must still be byte-identical afterwards.
- **No Material Symbols icons in the stage chip.** That font renders ligature names as literal text until it loads (FIX-027). The stage label is a word; it carries the meaning by itself.
- **Chip contrast must hold in light AND dark at 4.5:1.** Measured values are in the spec; do not substitute other tokens.
- **44px minimum touch target** on anything interactive. The chip is not interactive and is exempt.
- Run `node --test "test/*.test.mjs"` from `worker/` after any change to `worker/` or to a page the drift test reads.

---

### Task 1: Worker returns `permit_milestone`

**Files:**
- Modify: `worker/src/permits.js:123` (`selectCols`) and `:171` (result map)
- Test: `worker/test/permits-milestone.test.mjs` (create)

**Interfaces:**
- Produces: `/api/permits` response rows gain a `permit_milestone` string field (may be `undefined` when Socrata omits it).

- [ ] **Step 1: Write the failing test**

Create `worker/test/permits-milestone.test.mjs`:

```javascript
// FEAT-046. The stage chip is derived from permit_milestone, so the column has
// to survive the Worker's explicit select list into the response row. An
// omission here is silent: every downstream chip just disappears.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "permits.js"), "utf8");

test("permit_milestone is in the SoQL select list", () => {
  const block = SRC.slice(SRC.indexOf("const selectCols"), SRC.indexOf("].join(\",\")"));
  assert.ok(block.includes('"permit_milestone"'),
    "permit_milestone missing from selectCols — Socrata will not return it");
});

test("permit_milestone is copied onto the response row", () => {
  assert.ok(/permit_milestone:\s*row\.permit_milestone/.test(SRC),
    "permit_milestone selected but never mapped onto the result row");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && node --test test/permits-milestone.test.mjs`
Expected: FAIL, both tests — "permit_milestone missing from selectCols".

- [ ] **Step 3: Add the column**

In `worker/src/permits.js`, inside the `selectCols` array, add `"permit_milestone",` immediately after `"permit_status",`:

```javascript
  const selectCols = [
    "permit_",
    "permit_status",
    "permit_milestone",
    "permit_type",
```

In the same file's result map, add the field immediately after `permit_status`:

```javascript
      permit_number: row.permit_,
      permit_status: row.permit_status,
      permit_milestone: row.permit_milestone,
      permit_type: row.permit_type,
```

- [ ] **Step 4: Run the whole worker suite**

Run: `cd worker && node --test "test/*.test.mjs"`
Expected: PASS, 234 tests (232 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add worker/src/permits.js worker/test/permits-milestone.test.mjs
git commit -m "FEAT-046: Worker returns permit_milestone"
```

---

### Task 2: The stage table and helpers, in all three pages

**Files:**
- Modify: `docs/index.html`, `docs/list.html`, `docs/map.html` (insert one block into each)
- Test: `worker/test/stage-map.test.mjs` (create)

**Interfaces:**
- Produces, in every page: `PERMIT_STAGES` (object), `PERMIT_STAGE_LABELS` (object), `permitStage(row) -> string` returning one of `"fee" | "notstarted" | "progress" | "finishing" | "halted" | "complete" | "ended" | ""`, and `permitStageChip(row) -> string` returning HTML or `""`.

- [ ] **Step 1: Write the failing test**

Create `worker/test/stage-map.test.mjs`:

```javascript
// FEAT-046. The stage table is a bare object literal declared separately in all
// three pages, because there is no shared module to put it in. FIX-046 is what
// happens when three copies of one constant drift: index and map kept 220 while
// list said 1000, and opening the map deleted 180 saved permits. Same guard here.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs");
const PAGES = ["index.html", "map.html", "list.html"];
const read = page => readFileSync(join(DOCS, page), "utf8");

// Pull `const PERMIT_STAGES = { ... };` out of a page and evaluate it.
function stageTable(page) {
  const m = read(page).match(/const\s+PERMIT_STAGES\s*=\s*(\{[\s\S]*?\});/);
  assert.ok(m, `${page} has no PERMIT_STAGES declaration`);
  return Function(`"use strict"; return (${m[1]});`)();
}
function labelTable(page) {
  const m = read(page).match(/const\s+PERMIT_STAGE_LABELS\s*=\s*(\{[\s\S]*?\});/);
  assert.ok(m, `${page} has no PERMIT_STAGE_LABELS declaration`);
  return Function(`"use strict"; return (${m[1]});`)();
}

test("every page declares the stage table exactly once", () => {
  for (const page of PAGES) {
    const hits = read(page).match(/const\s+PERMIT_STAGES\s*=/g) || [];
    assert.equal(hits.length, 1, `${page} declares PERMIT_STAGES ${hits.length} times`);
  }
});

test("the three pages agree on the stage table", () => {
  const [a, b, c] = PAGES.map(stageTable);
  assert.deepStrictEqual(a, b, "index.html and map.html disagree on PERMIT_STAGES");
  assert.deepStrictEqual(a, c, "index.html and list.html disagree on PERMIT_STAGES");
});

test("the three pages agree on the stage labels", () => {
  const [a, b, c] = PAGES.map(labelTable);
  assert.deepStrictEqual(a, b, "index.html and map.html disagree on PERMIT_STAGE_LABELS");
  assert.deepStrictEqual(a, c, "index.html and list.html disagree on PERMIT_STAGE_LABELS");
});

test("the table covers all 11 open milestone values and nothing else", () => {
  // Measured against Socrata 2026-08-10: these are exactly the values that
  // appear on ACTIVE / SUSPENDED / PHASED PERMITTING permits. Adding a value
  // here is fine; doing it without re-measuring is not.
  const expected = {
    "PERMIT ISSUED (FEE DUE)": "fee",
    "INSPECTION ELIGIBLE": "notstarted",
    "INSPECTIONS": "progress",
    "PROGRESS INSPECTIONS": "progress",
    "INSPECTIONS (CERTIFICATE OF OCCUPANCY REQUIRED)": "finishing",
    "CERTIFICATE OF OCCUPANCY PENDING": "finishing",
    "CERTIFICATE OF OCCUPANCY PENDING (TEMPORARY OR PARTIAL OCCUPANCY APPROVED)": "finishing",
    "POST CONSTRUCTION FILING": "finishing",
    "FINAL INSPECTION": "finishing",
    "SUSPENDED": "halted",
    "STOP WORK": "halted",
  };
  assert.deepStrictEqual(stageTable("index.html"), expected);
});

test("every label is present and every stage is labelled", () => {
  const labels = labelTable("index.html");
  assert.deepStrictEqual(Object.keys(labels).sort(),
    ["complete", "ended", "fee", "finishing", "halted", "notstarted", "progress"]);
  const used = new Set(Object.values(stageTable("index.html")));
  for (const stage of used) assert.ok(labels[stage], `stage "${stage}" has no label`);
});

test("closed-permit milestone values are NOT in the table", () => {
  // A closed permit is decided by permit_status, never by milestone: 13,973
  // closed permits carry an in-progress milestone because they expired or were
  // revoked mid-inspection. Listing these here would label an EXPIRED permit
  // "In progress".
  const table = stageTable("index.html");
  for (const v of ["COMPLETE", "CANCELLED", "EXPIRED", "DENIED", "CERTIFICATE OF OCCUPANCY ISSUED"]) {
    assert.ok(!(v in table), `${v} must not be in PERMIT_STAGES — status decides closed permits`);
  }
});

test("permitStage resolves status before milestone", () => {
  // Extract the real function from the page and run it, so the test exercises
  // shipped code rather than a copy that can drift.
  const src = read("index.html");
  const table = src.match(/const\s+PERMIT_STAGES\s*=\s*\{[\s\S]*?\};/)[0];
  const fn = src.match(/function\s+permitStage\s*\(row\)\s*\{[\s\S]*?\n    \}/)[0];
  const permitStage = Function(`"use strict";
    const clean = v => (v == null ? "" : String(v));
    ${table}
    ${fn}
    return permitStage;`)();

  assert.equal(permitStage({ permit_status: "ACTIVE", permit_milestone: "INSPECTIONS" }), "progress");
  assert.equal(permitStage({ permit_status: "SUSPENDED", permit_milestone: "SUSPENDED" }), "halted");
  assert.equal(permitStage({ permit_status: "ACTIVE", permit_milestone: "PERMIT ISSUED (FEE DUE)" }), "fee");
  assert.equal(permitStage({ permit_status: "PHASED PERMITTING", permit_milestone: "INSPECTIONS" }), "progress");
  assert.equal(permitStage({ permit_status: "COMPLETE", permit_milestone: "COMPLETE" }), "complete");

  // The 13,973-permit trap: closed, but the milestone still says work is live.
  assert.equal(permitStage({ permit_status: "EXPIRED", permit_milestone: "INSPECTIONS" }), "ended",
    "a closed permit must never read as In progress");
  assert.equal(permitStage({ permit_status: "REVOKED", permit_milestone: "INSPECTIONS" }), "ended");
  assert.equal(permitStage({ permit_status: "CANCELLED", permit_milestone: "INSPECTIONS" }), "ended");
  assert.equal(permitStage({ permit_status: "COMPLETE", permit_milestone: "CERTIFICATE OF OCCUPANCY ISSUED" }), "complete");

  // No chip rather than a placeholder.
  assert.equal(permitStage({ permit_status: null, permit_milestone: null }), "");
  assert.equal(permitStage({ permit_status: "", permit_milestone: "" }), "");
  assert.equal(permitStage({ permit_status: "ACTIVE", permit_milestone: "SOMETHING NEW" }), "");
  assert.equal(permitStage({}), "");
  assert.equal(permitStage(null), "");

  // Case and whitespace tolerance — Socrata has shipped padded values before.
  assert.equal(permitStage({ permit_status: "active", permit_milestone: " inspections " }), "progress");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && node --test test/stage-map.test.mjs`
Expected: FAIL — "index.html has no PERMIT_STAGES declaration".

- [ ] **Step 3: Insert the block into all three pages**

Insert this block into each of `docs/index.html`, `docs/list.html`, `docs/map.html`, immediately **above** the line `function permitFacts(row, facts) {` in that page. Use the Edit tool; the text must be **byte-identical in all three**.

```javascript
    // FEAT-046. Construction stage, from ydr8-5enu's permit_milestone column.
    // Spec: docs/superpowers/specs/2026-08-10-permit-milestones-design.md
    //
    // Triplicated deliberately — there is no shared module on this site — and
    // held in agreement by worker/test/stage-map.test.mjs, the same guard
    // FIX-046 needed after three copies of one cap silently disagreed.
    //
    // These are the 11 values that appear on OPEN permits (measured against
    // Socrata 2026-08-10, 100% coverage every issue year 2015-2026). Closed
    // permits are deliberately absent: they are decided by permit_status below,
    // because 13,973 of them carry an in-progress milestone after expiring or
    // being revoked mid-inspection, and reading milestone first would label an
    // EXPIRED permit "In progress".
    const PERMIT_STAGES = {
      "PERMIT ISSUED (FEE DUE)": "fee",
      "INSPECTION ELIGIBLE": "notstarted",
      "INSPECTIONS": "progress",
      "PROGRESS INSPECTIONS": "progress",
      "INSPECTIONS (CERTIFICATE OF OCCUPANCY REQUIRED)": "finishing",
      "CERTIFICATE OF OCCUPANCY PENDING": "finishing",
      "CERTIFICATE OF OCCUPANCY PENDING (TEMPORARY OR PARTIAL OCCUPANCY APPROVED)": "finishing",
      "POST CONSTRUCTION FILING": "finishing",
      "FINAL INSPECTION": "finishing",
      "SUSPENDED": "halted",
      "STOP WORK": "halted"
    };
    const PERMIT_STAGE_LABELS = {
      fee: "Fee due",
      notstarted: "Not started",
      progress: "In progress",
      finishing: "Finishing",
      halted: "Halted",
      complete: "Complete",
      ended: "Ended early"
    };
    // Total over all 7 permit_status values plus null (843,715 rows). Returns ""
    // for anything unrecognised, which renders NO chip rather than a placeholder
    // — FIX-012's rule that no sample means no pill, never a zero.
    function permitStage(row) {
      const status = clean(row && row.permit_status).trim().toUpperCase();
      if (status === "COMPLETE") return "complete";
      if (status === "EXPIRED" || status === "CANCELLED" || status === "REVOKED") return "ended";
      if (status !== "ACTIVE" && status !== "SUSPENDED" && status !== "PHASED PERMITTING") return "";
      return PERMIT_STAGES[clean(row && row.permit_milestone).trim().toUpperCase()] || "";
    }
    // The chip. Carries the verbatim city value as its title, so the grouping
    // never hides what the dataset actually said.
    function permitStageChip(row) {
      const stage = permitStage(row);
      if (!stage) return "";
      const raw = clean(row && row.permit_milestone).trim();
      return `<span class="stage stage-${stage}"${raw ? ` title="${esc(raw)}"` : ""}>${esc(PERMIT_STAGE_LABELS[stage])}</span>`;
    }
```

- [ ] **Step 4: Verify it passes and the copies match**

Run: `cd worker && node --test test/stage-map.test.mjs`
Expected: PASS, 7 tests.

Then confirm byte-identity across the pages:

```bash
cd ..
diff <(awk '/const PERMIT_STAGES = \{/,/^    \}$/' docs/index.html) <(awk '/const PERMIT_STAGES = \{/,/^    \}$/' docs/map.html) && echo IDENTICAL
```
Expected: `IDENTICAL`.

- [ ] **Step 5: Check for control bytes**

```bash
node -e 'for (const f of ["docs/index.html","docs/list.html","docs/map.html"]) { const b=require("fs").readFileSync(f); console.log(f, b.filter(x=>x===8).length, b.filter(x=>x===0).length); }'
```
Expected: every line ends `0 0`.

- [ ] **Step 6: Commit**

```bash
git add docs/index.html docs/list.html docs/map.html worker/test/stage-map.test.mjs
git commit -m "FEAT-046: stage lookup table and helpers, with a drift test"
```

---

### Task 3: Chip styling

**Files:**
- Modify: `docs/index.html`, `docs/list.html`, `docs/map.html` (one CSS block each)

**Interfaces:**
- Consumes: the `stage stage-<name>` class names emitted by `permitStageChip` in Task 2.

- [ ] **Step 1: Add the CSS block to all three pages**

Insert immediately **above** the `.permit-status {` rule in `index.html` and `list.html`, and above the `.tag {` rule in `map.html`. Byte-identical in all three:

```css
    /* FEAT-046. Construction stage. Every colour is an existing token — no new
       palette. Measured contrast, light/dark: Fee due 6.02/10.32, Not started
       6.32/8.51, In progress 6.77/6.95, Finishing 4.80/7.35, Halted 5.95/7.03,
       Complete 6.32/8.51, Ended early 4.89/9.38. Finishing and Ended early are
       the tightest — re-measure both if this font-size ever drops.
       The label is always a word, so colour is reinforcement, never the only
       cue. No icon: Material Symbols renders ligature names as literal text
       until it loads (FIX-027). */
    .stage {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: transparent;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }
    .stage-fee { color: var(--teal); border-color: var(--teal); }
    .stage-notstarted { color: var(--muted); border-color: var(--line); }
    .stage-progress { color: var(--primary); border-color: var(--primary); background: var(--primary-soft); }
    .stage-finishing { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
    .stage-halted { color: var(--danger); border-color: var(--danger); background: var(--danger-soft); }
    .stage-complete { color: var(--muted); border-color: var(--line); }
    .stage-ended { color: var(--warning); border-color: var(--warning); background: var(--warning-soft); }
```

- [ ] **Step 2: Confirm nothing outranks it**

`.stage` is 0-1-0. A container-scoped rule like `.pm-tagrow span` would beat it (this is the FIX-029 / container-specificity trap). Check:

```bash
grep -nE '\.(pm-tagrow|tag-row|permit-facts|move-controls) span' docs/index.html docs/list.html docs/map.html
```
Expected: no output. If any appear, scope the stage rules to match rather than adding `!important`.

- [ ] **Step 3: Commit**

```bash
git add docs/index.html docs/list.html docs/map.html
git commit -m "FEAT-046: stage chip styling, existing tokens only"
```

---

### Task 4: The Status cell in `permitTable` (all three pages)

**Files:**
- Modify: `docs/index.html:6128`, `docs/list.html:9002`, `docs/map.html:7375`

**Interfaces:**
- Consumes: `permitStageChip(row)` from Task 2.

- [ ] **Step 1: Change the Status cell in each page**

Find in each page:

```html
              <td data-label="Status">${esc(row.permit_status)}</td>
```

Replace with:

```html
              <td data-label="Status">${esc(row.permit_status)}${(() => { const c = permitStageChip(row); return c ? `<br><span class="small">${c}</span>` : ""; })()}</td>
```

`permit_status` stays the primary value and stays the sortable key. The stage goes on a second line, matching how `permit_type` already sits under the permit number and `work_type` under the address.

- [ ] **Step 2: Verify by eye in a browser**

```bash
python -m http.server 8791 --directory docs
```
Open <http://localhost:8791/index.html>, search open permits, confirm a chip sits under the status in the results table, and that a permit with no milestone shows the status alone with no empty chip.

- [ ] **Step 3: Commit**

```bash
git add docs/index.html docs/list.html docs/map.html
git commit -m "FEAT-046: stage chip in the permitTable status cell"
```

---

### Task 5: The permit overlay (index + list)

**Files:**
- Modify: `docs/index.html:7211,7226`, `docs/list.html:10244,10259`

**Interfaces:**
- Consumes: `permitStageChip(row)`, `PERMIT_STAGE_LABELS`, `permitStage(row)` from Task 2.

This block is byte-identical across the two pages by design. Change both and re-verify.

- [ ] **Step 1: Add the chip to the tag row**

Find in both pages:

```javascript
            <span class="pm-tag">${esc(row.permit_status)}</span>
            <span class="pm-tag">${esc(row.permit_type)}</span>
```

Replace with:

```javascript
            <span class="pm-tag">${esc(row.permit_status)}</span>
            ${permitStageChip(row)}
            <span class="pm-tag">${esc(row.permit_type)}</span>
```

- [ ] **Step 2: Add the verbatim value to the facts block**

Find in both pages:

```javascript
            ["Status", clean(row.permit_status)],
```

Replace with:

```javascript
            ["Status", clean(row.permit_status)],
            ["Stage", clean(row.permit_milestone)],
```

`pmFacts` already drops rows whose value is empty, so a permit without a milestone shows no Stage row. This deliberately shows the **verbatim** city value, not the grouped label — the overlay is where the grouping must not hide the source.

- [ ] **Step 3: Confirm the shared block is still byte-identical**

```bash
diff <(awk '/const pmFacts|<div class="pm-tagrow">/,/Costs &amp; fees/' docs/index.html) <(awk '/const pmFacts|<div class="pm-tagrow">/,/Costs &amp; fees/' docs/list.html) && echo IDENTICAL
```
Expected: `IDENTICAL`.

- [ ] **Step 4: Commit**

```bash
git add docs/index.html docs/list.html
git commit -m "FEAT-046: stage chip and verbatim milestone in the permit overlay"
```

---

### Task 6: The contractor card and the map (all sites)

**Files:**
- Modify: `docs/index.html:7350`, `docs/list.html:10383` (`cardPermitTableHtml`)
- Modify: `docs/index.html:4130,5359`, `docs/list.html:5252,6960`, `docs/map.html:4052,6442` (the six `$select` lists)
- Modify: `mapRowToPermit`, `mapResultButton`, `mapPermitDetails` in all three pages

**Interfaces:**
- Consumes: `permitStageChip(row)` from Task 2.
- Produces: map row objects gain an `ms` key carrying the verbatim milestone.

- [ ] **Step 1: Add the column to all six page-level select lists**

In each of the six locations, add `permit_milestone,` immediately after `permit_status,` inside the backtick string:

```javascript
      const select = `permit_,permit_status,permit_milestone,permit_type,review_type,issue_date,...
```

- [ ] **Step 2: Carry it into the compact map row**

In each page's `loadMapMonths`, in the object returned by the `rawRows.map(...)` callback, add `ms` next to `s`:

```javascript
          n: row.permit_, s: row.permit_status, ms: row.permit_milestone, t: row.permit_type, r: row.review_type,
```

- [ ] **Step 3: Carry it back out again**

In each page's `mapRowToPermit`, add the field after `permit_status`:

```javascript
        permit_number: row.n,
        permit_status: row.s,
        permit_milestone: row.ms,
        permit_type: row.t,
```

In each page's `ensurePermitMap`, in the `mapped` object, add it after `permit_status`:

```javascript
            permit_status: row.permit_status,
            permit_milestone: row.permit_milestone,
```

- [ ] **Step 4: Render it in the map side list**

In each page's `mapResultButton`, add the chip to the third line:

```javascript
          <span>${esc(row.wt || row.t || "")} ${permitStageChip(mapRowToPermit(row))}</span>
```

- [ ] **Step 5: Render it in the map detail tag row**

In each page's `mapPermitDetails`, after the status tag:

```javascript
          <span class="tag">${esc(permit.permit_status)}</span>
          ${permitStageChip(permit)}
          <span class="tag">${esc(permit.permit_type)}</span>
```

- [ ] **Step 6: Render it on the contractor card**

In `cardPermitTableHtml` in `index.html` and `list.html`, the permit cell is built inside a `rows.map(r => ...)` template. Find:

```javascript
<td><strong>${esc(r.permit_number)}</strong><br><span class="small">${esc(r.permit_status)}</span></td>
```

Replace with (the chip is built once, not twice — `permitStageChip` is called in both the test and the output if you inline it):

```javascript
<td><strong>${esc(r.permit_number)}</strong><br><span class="small">${esc(r.permit_status)}</span>${(() => { const c = permitStageChip(r); return c ? `<br><span class="small">${c}</span>` : ""; })()}</td>
```

- [ ] **Step 7: Verify the whole path end to end**

```bash
python -m http.server 8791 --directory docs
```
Open <http://localhost:8791/map.html>, wait for pins, open a permit from the side list, and confirm the chip appears in both the side list and the detail panel. Open a contractor from <http://localhost:8791/index.html> and confirm the chip on its permit rows.

- [ ] **Step 8: Commit**

```bash
git add docs/index.html docs/list.html docs/map.html
git commit -m "FEAT-046: stage on the contractor card and both map surfaces"
```

---

### Task 7: Headless verification and mutation controls

**Files:**
- Create: `verify-tmp/t75-permit-stage.js`
- Create: `verify-tmp/t75-mutants.js`

**Interfaces:**
- Consumes: everything from Tasks 1–6.

- [ ] **Step 1: Write the browser suite**

Create `verify-tmp/t75-permit-stage.js`. It must run at **desktop 1280x900 and iPhone 13 390x844**, seed a saved list containing one permit per stage, and assert **geometry, not just presence**:

```javascript
// FEAT-046 — the construction stage chip on every surface.
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const ROWS = [
  { permit_number: "S1", address: "1 N TEST ST", permit_status: "ACTIVE", permit_milestone: "PERMIT ISSUED (FEE DUE)", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", reported_cost: 1000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S2", address: "2 N TEST ST", permit_status: "ACTIVE", permit_milestone: "INSPECTIONS", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-02", reported_cost: 2000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S3", address: "3 N TEST ST", permit_status: "SUSPENDED", permit_milestone: "STOP WORK", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-03", reported_cost: 3000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S4", address: "4 N TEST ST", permit_status: "EXPIRED", permit_milestone: "INSPECTIONS", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-04", reported_cost: 4000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
  { permit_number: "S5", address: "5 N TEST ST", permit_status: "ACTIVE", permit_milestone: "", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-05", reported_cost: 5000, lat: 41.9, lon: -87.7, general_contractors: "GC ONE" },
];

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

async function run(viewport, label) {
  console.log(`\n== ${label} ==`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport });
  await page.route("**/api/notes/bulk*", r => r.fulfill({ json: { threads: {}, truncated: false } }));
  await page.route("**/api/notes/counts*", r => r.fulfill({ json: { counts: {} } }));
  await page.route("**/api/contact/**", r => r.fulfill({ json: {} }));
  await openList(page);
  await seedSavedList(page, ROWS);

  const chips = await page.$$eval(".saved-permits-table .stage",
    els => els.map(e => ({ text: e.textContent.trim(), title: e.getAttribute("title"), h: +e.getBoundingClientRect().height.toFixed(2) })));

  const byTitle = t => chips.filter(c => c.title === t).map(c => c.text);

  check("one chip per permit that has a stage, and none for S5", chips.length === 4,
    JSON.stringify(chips.map(c => c.text)));
  check("fee due is labelled", chips.some(c => c.text === "Fee due"), JSON.stringify(chips));
  check("a STOP WORK permit reads Halted", byTitle("STOP WORK").join() === "Halted",
    JSON.stringify(byTitle("STOP WORK")));
  // The 13,973-permit trap, asserted on the SPECIFIC row: S2 and S4 both carry
  // milestone INSPECTIONS, but S4 is EXPIRED. Matching on title alone would let
  // S2's correct "In progress" satisfy a sloppy assertion, so both are named.
  const inspections = byTitle("INSPECTIONS").sort();
  check("INSPECTIONS gives In progress when ACTIVE and Ended early when EXPIRED",
    inspections.join("|") === "Ended early|In progress", JSON.stringify(inspections));
  check("no chip is rendered empty", chips.every(c => c.text.length > 0),
    JSON.stringify(chips.map(c => c.text)));
  check("every chip carries the verbatim value as its title",
    chips.every(c => c.title && c.title.length > 0), JSON.stringify(chips.map(c => c.title)));
  check("every chip has real height", chips.every(c => c.h >= 16), JSON.stringify(chips.map(c => c.h)));

  // The overlay: chip in the tag row AND the verbatim value in the facts.
  await page.evaluate(() => openPermitDetail(state.userPermitMap.get("S3")));
  await page.waitForSelector("#permit-modal:not([hidden]) .pm-tagrow", { timeout: 10000 });
  const overlay = await page.evaluate(() => {
    const body = document.getElementById("permit-modal-body");
    const chip = body.querySelector(".pm-tagrow .stage");
    return { chip: chip ? chip.textContent.trim() : null, text: body.innerText };
  });
  check("overlay tag row carries the chip", overlay.chip === "Halted", String(overlay.chip));
  check("overlay states the VERBATIM milestone", /STOP WORK/.test(overlay.text));

  // Contrast is asserted, not assumed, in whichever theme is active.
  const contrast = await page.evaluate(() => {
    const lum = c => { const [r,g,b] = c.match(/\d+/g).slice(0,3).map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }); return 0.2126*r+0.7152*g+0.0722*b; };
    const bgOf = el => { let n = el; while (n) { const b = getComputedStyle(n).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; n = n.parentElement; } return "rgb(255,255,255)"; };
    return [...document.querySelectorAll(".stage")].map(el => {
      const a = lum(getComputedStyle(el).color), b = lum(bgOf(el));
      const [hi, lo] = a > b ? [a, b] : [b, a];
      return { text: el.textContent.trim(), ratio: +(((hi + 0.05) / (lo + 0.05)).toFixed(2)) };
    });
  });
  for (const c of contrast) check(`contrast >= 4.5 for "${c.text}"`, c.ratio >= 4.5, String(c.ratio));

  await browser.close();
}

(async () => {
  await run({ width: 1280, height: 900 }, "desktop 1280x900");
  await run({ width: 390, height: 844 }, "iPhone 13 390x844");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
```

- [ ] **Step 2: Run it**

```bash
python -m http.server 8791 --directory docs &
node verify-tmp/t75-permit-stage.js
```
Expected: `ALL PASS`, exit 0.

- [ ] **Step 3: Write the mutation control**

Create `verify-tmp/t75-mutants.js`. Copy `verify-tmp/_fix045-mutants.js` and replace its `MUTANTS` array with the one below — that file already snapshots the pages, converts anchors to the file's line endings (both pages are CRLF, and an anchor written with `\n` silently never matches), byte-verifies the restore, and deletes the snapshots afterwards.

```javascript
const FILES = ["docs/index.html", "docs/list.html", "docs/map.html"];
const SUITE = "verify-tmp/t75-permit-stage.js";

const MUTANTS = [
  {
    name: "M1 closed permits fall through to the milestone lookup (the 13,973-permit trap)",
    suite: SUITE,
    edits: [{ file: "docs/list.html",
      from: '      if (status === "EXPIRED" || status === "CANCELLED" || status === "REVOKED") return "ended";\r\n',
      to: "" }],
  },
  {
    name: "M2 STOP WORK is treated as active work",
    suite: SUITE,
    edits: [{ file: "docs/list.html", from: '"STOP WORK": "halted"', to: '"STOP WORK": "progress"' }],
  },
  {
    name: "M3 the no-stage guard is removed, so an empty chip renders",
    suite: SUITE,
    edits: [{ file: "docs/list.html",
      from: '      const stage = permitStage(row);\r\n      if (!stage) return "";\r\n',
      to: '      const stage = permitStage(row) || "notstarted";\r\n' }],
  },
  {
    name: "M4 the verbatim milestone is dropped from the chip title",
    suite: SUITE,
    edits: [{ file: "docs/list.html",
      from: '${raw ? ` title="${esc(raw)}"` : ""}', to: "" }],
  },
  {
    name: "M5 Finishing loses its colour (EXPECTED SURVIVOR — see below)",
    suite: SUITE,
    edits: [{ file: "docs/list.html",
      from: ".stage-finishing { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }",
      to: ".stage-finishing { color: var(--muted); border-color: var(--line); }" }],
  },
];
```

**M5 is expected to survive**, and that is the correct outcome to record rather than engineer away. The suite asserts contrast and labels, and `--muted` on the panel passes 6.32:1 — so a wrong-but-legible colour is genuinely outside what these assertions cover. Colour correctness is checked by the `ui-ux-pro-max` pass in Step 6 and by the measured table in the spec, not by this suite. Do **not** add a hard-coded expected-colour assertion to kill it; that would pin the test to today's palette and break on any future theme change.

Note the mutants edit `docs/list.html` only. Task 2's drift test is what guarantees the other two pages carry the same table, so mutating one page is sufficient — and if a mutant unexpectedly survives, run `node --test test/stage-map.test.mjs` first, because a page that failed to receive the Task 2 block would produce exactly that symptom.

- [ ] **Step 4: Run the mutants**

```bash
node verify-tmp/t75-mutants.js
```
Expected: mutants 1–4 CAUGHT, mutant 5 documented as a survivor, tree restored byte-identical.

- [ ] **Step 5: Run every other suite that touches these files**

```bash
cd worker && node --test "test/*.test.mjs" && cd ..
for s in t4 t5 t9 t44-followup t52-worktype-residential t62-property-use t59-list-pagination; do
  node verify-tmp/$s.js >/dev/null 2>&1 && echo "$s ok" || echo "$s FAILED"
done
```
Expected: worker 234/234; every listed suite `ok`. (`t44-followup` may flake on its 44px check — see FIX-045; check the failure line, which now reports the measured height.)

- [ ] **Step 6: ui-ux-pro-max pass before landing**

Invoke the `ui-ux-pro-max` skill against the built result and check the standing list: ≥44px touch targets, visible labels, focus states, 4.5:1 in **both** themes, no meaning by colour alone, no sub-16px inputs, reduced-motion respected. Record any deliberate deviation.

- [ ] **Step 7: Commit**

```bash
git add verify-tmp/t75-permit-stage.js verify-tmp/t75-mutants.js
git commit -m "FEAT-046: headless suite and mutation controls for the stage chip"
```

Note: `verify-tmp/` is gitignored, so this commit will be empty unless that changes. Commit the message against the page changes instead, and keep the suites on disk.

---

## Done when

- `node --test "test/*.test.mjs"` in `worker/` is green, including `stage-map.test.mjs`.
- `t75-permit-stage.js` passes at both viewports.
- Mutants 1–4 are caught.
- The board's FEAT-046 checklist is fully ticked and the card is `done`.
- The branch is merged only on Divyam's explicit approval.
