# Permit list filter row on the tri-state control (FEAT-048) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the saved list's five filter chips with four controls — a Stage dropdown plus Visited and Called as tri-state pills — keeping Follow-up only as a plain on/off pill.

**Architecture:** `state.listFilters` gains a `stages` set and changes `visited`/`called` from `"yes"|"no"` to `"include"|"exclude"`. One matcher (`visibleListRows`) reads the new shape; the existing status, empty-state and clear helpers are updated to match. All the new logic is reachable as pure functions so it can be unit-tested without a browser, following FEAT-047.

**Tech Stack:** Vanilla JS in `docs/list.html`; `node --test` for unit tests; Playwright for browser verification.

**Spec:** `docs/superpowers/specs/2026-08-10-filter-restructure-design.md`
**Branch:** `feat-048-list-filters`, cut from `feat-047-map-filters` (needs the tri-state control).

## Global Constraints

- **`docs/list.html` ONLY.** The saved-list filter row exists nowhere else. `index.html` has a saved-list *preview* but no filter bar, and `map.html` has neither.
- **Never edit `docs/*.html` through a bash heredoc.** Use the Edit tool.
- **`list.html` is CRLF.** A multi-line search anchor written with `\n` silently never matches.
- **`state.listFilters` is NOT persisted** — it is in-memory and reset on list switch (`list.html:4451`). There is no migration and no storage shape to defend. Do not add persistence; that is not in scope.
- **The list needs SEVEN stages, not five.** Saved permits are the one surface where CLOSED permits appear — a permit saved while open that has since completed or been revoked — so `Complete` and `Ended early` must be offered when present.
- **Follow-up only stays a binary on/off pill.** This is a deliberate decision: "everything except follow-ups" is not a question anyone asks, and it is the control most likely to be tapped in a hurry. Do not convert it.
- **Reuse FEAT-047's control.** `normalizeTriState`, `cycleTriState`, `matchesTriState`, `triStateOf` and `triStateOptionHtml` already exist in `list.html`. Do not write a second implementation.
- **There is a global `button { width: 100% }`** (FIX-022). Any new button needs its own width.
- **44px minimum** on every option row, pill and dropdown header.
- Baseline: `cd worker && node --test "test/*.test.mjs"` is 263 passing.

---

### Task 1: The filter shape and the matcher

**Files:**
- Modify: `docs/list.html` — `state.listFilters` (~4062), the list-switch reset (~4451), `isListFiltered`, `visibleListRows`, `setRowFilter`, `clearListFilters` (~7673-7702)
- Test: `worker/test/list-filters.test.mjs` (create)

**Interfaces:**
- Produces: `listFilterDefaults()`, `setRowFilter(facet)` (note: one argument now, not two), `setListStageFilter(value)`, and a `visibleListRows(rows)` that reads the new shape.

- [ ] **Step 1: Write the failing test**

Create `worker/test/list-filters.test.mjs`:

```javascript
// FEAT-048. The saved list's row filters, extracted from list.html and run
// directly so the rules are testable without a browser — same approach as
// worker/test/tristate.test.mjs.
//
// The rule that matters: Visited and Called are now tri-state (include /
// exclude / off) and Stage is a tri-state SET, but Follow-up stays a plain
// boolean on purpose. A version that made Follow-up tri-state, or that let a
// stage include silence a stage exclude, would be wrong.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "list.html"), "utf8");

function grab(name) {
  const m = SRC.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n    \\}`));
  assert.ok(m, `list.html has no ${name}`);
  return m[0];
}

// Build a sandbox with the real functions plus the minimum they depend on.
const sandbox = extras => Function(`"use strict";
  ${extras}
  ${grab("normalizeTriState")}
  ${grab("matchesTriState")}
  ${grab("cycleTriState")}
  ${grab("listFilterDefaults")}
  ${grab("visibleListRows")}
  return { listFilterDefaults, visibleListRows, matchesTriState, cycleTriState };`)();

// isFollowedUp / isTicked / isCalled / permitStage are supplied by the page;
// stub them off the row so the matcher's own logic is what gets exercised.
const STUBS = `
  const state = { listFilters: null };
  const isFollowedUp = r => !!r.fu;
  const isTicked = r => !!r.visited;
  const isCalled = r => !!r.called;
  const permitStage = r => r.stage || "";
`;

const F = sandbox(STUBS);
const withFilters = (filters, rows) => Function(`"use strict";
  ${STUBS}
  ${grab("normalizeTriState")}
  ${grab("matchesTriState")}
  ${grab("listFilterDefaults")}
  ${grab("visibleListRows")}
  state.listFilters = ${JSON.stringify(filters)};
  return visibleListRows(${JSON.stringify(rows)});`)();

const ROWS = [
  { id: "a", stage: "progress", visited: true, called: false, fu: false },
  { id: "b", stage: "progress", visited: false, called: true, fu: true },
  { id: "c", stage: "halted", visited: false, called: false, fu: false },
  { id: "d", stage: "complete", visited: true, called: true, fu: false },
  { id: "e", stage: "", visited: false, called: false, fu: false },
];
const ids = rows => rows.map(r => r.id).join("");

test("the default shape carries a stage set and null facets", () => {
  const d = F.listFilterDefaults();
  assert.deepStrictEqual(d.stages, { include: [], exclude: [] });
  assert.equal(d.visited, null);
  assert.equal(d.called, null);
  assert.equal(d.followUp, false);
});

test("no filters shows everything", () => {
  assert.equal(ids(withFilters(F.listFilterDefaults(), ROWS)), "abcde");
});

test("Visited include keeps only visited; exclude drops them", () => {
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), visited: "include" }, ROWS)), "ad");
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), visited: "exclude" }, ROWS)), "bce");
});

test("Called include and exclude behave the same way", () => {
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), called: "include" }, ROWS)), "bd");
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), called: "exclude" }, ROWS)), "ace");
});

test("visited + not called is the question the field actually asks", () => {
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), visited: "include", called: "exclude" }, ROWS)), "a");
});

test("Follow-up stays a plain boolean, not tri-state", () => {
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), followUp: true }, ROWS)), "b");
  // false must mean "no filter", never "exclude flagged".
  assert.equal(ids(withFilters({ ...F.listFilterDefaults(), followUp: false }, ROWS)), "abcde");
});

test("Stage include narrows, exclude removes, and BOTH apply", () => {
  const base = F.listFilterDefaults();
  assert.equal(ids(withFilters({ ...base, stages: { include: ["progress"], exclude: [] } }, ROWS)), "ab");
  assert.equal(ids(withFilters({ ...base, stages: { include: [], exclude: ["progress"] } }, ROWS)), "cde");
  // An exclude must still bite when includes are set.
  assert.equal(ids(withFilters({ ...base, stages: { include: ["progress", "halted"], exclude: ["progress"] } }, ROWS)), "c");
});

test("a CLOSED stage is filterable — this is the only surface where they appear", () => {
  const base = F.listFilterDefaults();
  assert.equal(ids(withFilters({ ...base, stages: { include: ["complete"], exclude: [] } }, ROWS)), "d");
  // Excluding Complete is the point of this feature: a saved list accumulates
  // finished jobs and there has never been a way to hide them.
  assert.equal(ids(withFilters({ ...base, stages: { include: [], exclude: ["complete"] } }, ROWS)), "abce");
});

test("a permit with no stage survives unless an include is set", () => {
  const base = F.listFilterDefaults();
  assert.equal(ids(withFilters({ ...base, stages: { include: [], exclude: ["halted"] } }, ROWS)), "abde");
  assert.equal(ids(withFilters({ ...base, stages: { include: ["progress"], exclude: [] } }, ROWS)), "ab");
});

test("facets combine across kinds", () => {
  const base = F.listFilterDefaults();
  assert.equal(ids(withFilters({ ...base, stages: { include: ["progress"], exclude: [] }, called: "exclude" }, ROWS)), "a");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && node --test test/list-filters.test.mjs`
Expected: FAIL — "list.html has no listFilterDefaults".

- [ ] **Step 3: Add the default factory and change the shape**

In `docs/list.html`, add immediately **above** `function isListFiltered() {`:

```javascript
    // FEAT-048. One factory, so the initial value and the list-switch reset can
    // never drift apart. Visited and Called are now tri-state ("include" |
    // "exclude" | null) on FEAT-047's control; Follow-up stays a plain boolean
    // on purpose, because "everything except follow-ups" is not a question
    // anyone asks and it is the control most likely to be tapped in a hurry.
    // Not persisted: this state is in-memory and resets when you switch lists,
    // so there is no stored shape to migrate.
    function listFilterDefaults() {
      return { followUp: false, visited: null, called: null, stages: { include: [], exclude: [] } };
    }
```

Replace the initial value at `state` (~4062):

```javascript
      listFilters: { followUp: false, visited: null, called: null, stages: { include: [], exclude: [] } },
```

Replace the list-switch reset (~4451):

```javascript
        if (id !== state.activeListId) state.listFilters = listFilterDefaults();
```

Replace `clearListFilters`'s body assignment:

```javascript
      state.listFilters = listFilterDefaults();
```

- [ ] **Step 4: Update the matcher and the predicates**

Replace `isListFiltered` and `visibleListRows` with:

```javascript
    function isListFiltered() {
      const f = state.listFilters;
      const s = normalizeTriState(f.stages);
      return !!(f.followUp || f.visited || f.called || s.include.length || s.exclude.length);
    }

    function visibleListRows(rows) {
      const f = state.listFilters;
      return rows.filter(row =>
        (!f.followUp || isFollowedUp(row))
        && (!f.visited || isTicked(row) === (f.visited === "include"))
        && (!f.called || isCalled(row) === (f.called === "include"))
        && matchesTriState(permitStage(row), f.stages));
    }
```

- [ ] **Step 5: Make the pill handler tri-state**

`setRowFilter` currently takes `(facet, want)` and toggles. It becomes one argument and cycles:

```javascript
    // Cycles off -> include -> exclude -> off, matching the map's dropdown so
    // the two surfaces behave identically.
    function setRowFilter(facet) {
      const now = state.listFilters[facet];
      state.listFilters[facet] = now === "include" ? "exclude" : now === "exclude" ? null : "include";
      renderUserList();
      announceFilterState();
    }
    function setListStageFilter(value) {
      state.listFilters.stages = cycleTriState(state.listFilters.stages, value);
      renderUserList();
      announceFilterState();
    }
```

- [ ] **Step 6: Verify**

Run: `cd worker && node --test test/list-filters.test.mjs` — expect PASS, 10 tests.
Then `cd worker && node --test "test/*.test.mjs"` — expect 273 passing.
Then control bytes:
```bash
node -e 'const b=require("fs").readFileSync("docs/list.html"); console.log("0x08:",b.filter(x=>x===8).length,"NUL:",b.filter(x=>x===0).length)'
```
Expected `0 0`. And syntax:
```bash
node -e 'const s=require("fs").readFileSync("docs/list.html","utf8");const m=[...s.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];let bad=0;for(const x of m){try{new Function(x[1]);}catch(e){bad++;console.log("SYNTAX ERROR:",e.message.slice(0,120));}}console.log(bad?"FAILED":"parses OK");'
```

At this point the page will be BROKEN in the browser: the four old chips still call `setRowFilter(facet, want)` with two arguments. Task 2 replaces them. Do not patch the markup here.

- [ ] **Step 7: Commit**

```bash
git add docs/list.html worker/test/list-filters.test.mjs
git commit -m "FEAT-048: tri-state list filter shape and matcher"
```

---

### Task 2: The filter row — Stage dropdown and tri-state pills

**Files:**
- Modify: `docs/list.html` — the `#list-filters` markup (~3853), `renderListFilters` (~7730), plus one CSS block

**Interfaces:**
- Consumes: `triStateOptionHtml`, `triStateOf`, `setRowFilter`, `setListStageFilter`, `permitStage`, `PERMIT_STAGE_LABELS`.

- [ ] **Step 1: Replace the chip markup**

The current bar holds five buttons (`filter-visited`, `filter-not-visited`, `filter-called`, `filter-not-called`, `filter-followup`) plus a status span. Replace the four visited/called buttons with two, and add the dropdown before them:

```html
      <div id="list-filters" class="list-filters" role="group" aria-label="Filter permits in this list" hidden>
        <details class="list-filter-group" id="list-stage-details">
          <summary id="list-stage-summary">Stage <b>all</b></summary>
          <div class="tri-list" id="list-stage-list" role="group" aria-label="Filter by construction stage"></div>
          <p class="tri-hint">Click to include, again to exclude, again to clear. <button type="button" class="list-clear-filters" onclick="clearListFilters()">Clear</button></p>
        </details>
        <button type="button" id="filter-visited" class="tri-pill" data-state="" onclick="setRowFilter('visited')">Visited</button>
        <button type="button" id="filter-called" class="tri-pill" data-state="" onclick="setRowFilter('called')">Called</button>
        <button type="button" id="filter-followup" class="tag" aria-pressed="false" onclick="toggleFollowUpFilter()">
          <span class="material-symbols-outlined" aria-hidden="true">flag</span>Follow-up only
        </button>
        <span id="list-filter-status" class="list-filter-status small" role="status" aria-live="polite"></span>
      </div>
```

`ROW_FILTER_CHIPS` (the old four-way sync table) is now dead — delete it and its use in `renderListFilters`.

- [ ] **Step 2: Populate and sync in `renderListFilters`**

Inside `renderListFilters`, after the existing counts, add:

```javascript
      // Only stages PRESENT in this list, counted over the whole list rather
      // than the filtered view, so ticking one option never moves the numbers
      // beside the others.
      const stageCounts = new Map();
      for (const row of rows) {
        const stage = permitStage(row);
        if (stage) stageCounts.set(stage, (stageCounts.get(stage) || 0) + 1);
      }
      const stageList = $("list-stage-list");
      if (stageList) {
        stageList.innerHTML = [...stageCounts].map(([stage, n]) => triStateOptionHtml({
          value: stage,
          label: PERMIT_STAGE_LABELS[stage] || stage,
          count: n,
          state: triStateOf(state.listFilters.stages, stage),
          onclick: `setListStageFilter('${enc(stage)}')`,
        })).join("");
      }
      const stageSummary = document.querySelector("#list-stage-summary b");
      if (stageSummary) {
        const s = normalizeTriState(state.listFilters.stages);
        stageSummary.textContent = !s.include.length && !s.exclude.length ? "all"
          : [s.include.length ? `${s.include.length} included` : "", s.exclude.length ? `${s.exclude.length} excluded` : ""].filter(Boolean).join(", ");
      }
      const stageDetails = $("list-stage-details");
      if (stageDetails) stageDetails.hidden = stageCounts.size === 0;
```

And replace the old chip-sync loop with the two pills:

```javascript
      for (const facet of ["visited", "called"]) {
        const pill = $(`filter-${facet}`);
        if (!pill) continue;
        const st = state.listFilters[facet] || "";
        pill.dataset.state = st;
        const label = facet === "visited" ? "Visited" : "Called";
        const said = st === "include" ? "included, activate to exclude"
          : st === "exclude" ? "excluded, activate to clear"
          : "not filtered, activate to include";
        pill.setAttribute("aria-label", `${label}, ${said}`);
        pill.textContent = st === "include" ? `✓ ${label}` : st === "exclude" ? `✗ ${label}` : label;
      }
```

- [ ] **Step 3: Add the CSS**

Insert beside the `.tri` rules, in `docs/list.html`:

```css
    /* FEAT-048. The list's filter row. `width: auto` is load-bearing against the
       global `button { width: 100% }` (FIX-022). The mark is a plain character,
       never a Material Symbols ligature, which renders as literal text until the
       font loads (FIX-027) — and the state is in the accessible name regardless,
       so it is never carried by colour or glyph alone. */
    .tri-pill {
      width: auto;
      min-height: 44px;
      padding: 6px 13px;
      border: 1px solid var(--tag-border);
      border-radius: 999px;
      background: var(--panel);
      color: var(--tag-text);
      font-size: 12.5px;
      font-weight: 650;
      white-space: nowrap;
      cursor: pointer;
    }
    .tri-pill[data-state="include"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .tri-pill[data-state="exclude"] { border-color: var(--danger); background: var(--danger-soft); color: var(--danger); }
    .tri-pill:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .list-filter-group { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
    .list-filter-group > summary {
      display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 10px;
      list-style: none; cursor: pointer; color: var(--muted); font-size: 12px; font-weight: 700;
    }
    .list-filter-group > summary::-webkit-details-marker { display: none; }
    .list-filter-group > summary b { color: var(--ink); }
    .list-filter-group > summary:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; border-radius: 8px; }
    .list-clear-filters {
      width: auto; min-height: 44px; padding: 0 10px;
      border: 1px solid var(--line); border-radius: 8px;
      background: var(--panel); color: var(--primary);
      font-size: 12.5px; font-weight: 700; cursor: pointer;
    }
```

- [ ] **Step 4: Verify and commit**

Syntax-check and control-byte check `docs/list.html` as in Task 1. Run `cd worker && node --test "test/*.test.mjs"` — 273 passing.

```bash
git add docs/list.html
git commit -m "FEAT-048: Stage dropdown and tri-state Visited/Called pills"
```

---

### Task 3: Direction in the status line, and a way out of an empty view

**Files:**
- Modify: `docs/list.html` — `announceFilterState` (~7708), `renderListFilters`'s status assignment, `noRowsMatchText` (~7757)

- [ ] **Step 1: Say direction, not presence**

`announceFilterState` and `noRowsMatchText` both build a word list from the old `"yes"|"no"` shape. Update both to the new one, and include stages:

```javascript
    function activeFilterWords() {
      const f = state.listFilters;
      const s = normalizeTriState(f.stages);
      const name = st => PERMIT_STAGE_LABELS[st] || st;
      const on = [];
      if (f.followUp) on.push("flagged for follow-up");
      if (f.visited) on.push(f.visited === "include" ? "visited" : "not visited");
      if (f.called) on.push(f.called === "include" ? "called" : "not called");
      if (s.include.length) on.push(s.include.map(name).join(" or "));
      if (s.exclude.length) on.push("not " + s.exclude.map(name).join(", not "));
      return on;
    }
```

Then have `announceFilterState` and `noRowsMatchText` both call it, so the two can never disagree about what is on.

- [ ] **Step 2: The empty view already has a way out — leave it alone**

**PLAN CORRECTION (found during self-review).** An earlier draft said to add a
clear control to the empty view. It is already there — `docs/list.html:8774`
renders `noRowsMatchText()` followed by a `.linkish` button calling
`clearListFilters()`, and `.linkish` *does* exist in this page (unlike
`map.html`, where FEAT-047 had to supply it). **Do not add a second one.**

What this step actually needs is a check, not a change: confirm that empty view
still appears and still clears correctly now that Rule B makes it reachable a
new way — a stage included and excluded at once. `clearListFilters` already
calls `listFilterDefaults()` from Task 1, so it resets the stage set too. Verify
by hand or leave it to Task 4's suite; write no code here unless it is broken.

- [ ] **Step 3: Verify and commit**

```bash
git add docs/list.html
git commit -m "FEAT-048: list filter status states direction; empty view offers a way out"
```

---

### Task 4: Headless verification and mutation controls

**Files:**
- Create: `verify-tmp/t77-list-filters.js`, `verify-tmp/t77-mutants.js`

- [ ] **Step 1: Write the browser suite**

Create `verify-tmp/t77-list-filters.js`, running at desktop 1280x900 AND iPhone 13 390x844. Use `_boot.js`'s `openList` and `seedSavedList`. Seed a list holding permits across several stages INCLUDING at least one closed one (`permit_status: "COMPLETE"`), plus visited/called/follow-up flags. Assert:

```
- the Stage dropdown lists one option per stage present, with counts of THIS list
- a CLOSED stage (Complete) is offered — the list is the only surface where they appear
- clicking cycles include -> exclude -> off, and the table narrows/expands to match
- counts beside the other options do not move when one is ticked
- Visited and Called pills cycle through three states and read ✓ / ✗
- the pills' accessible names state the current state
- Follow-up only stays a TWO-state toggle — three clicks must not produce an exclude
- visited include + called exclude yields the "been there, nobody called" set
- an impossible stage filter empties the view, which says so and offers Clear
- the status line states direction, e.g. "not Complete"
- every pill, option row and the summary is >= 44px at BOTH viewports
- the table is still above the fold at 390px with the bar showing
- a real Enter key press operates a pill, not just .click()
```

Model the structure on `verify-tmp/t76-stage-filter.js`.

**Two traps this suite must avoid**, both of which cost time on FEAT-047:
- Do NOT reference `window.state` — `list.html` declares `const state` at top level and a top-level `const` never becomes a window property. Reference it bare inside `evaluate`.
- Do NOT use `addInitScript(localStorage.clear)`. It runs on every navigation, so it wipes state mid-test and reports product bugs that are not there.

- [ ] **Step 2: Run it at both viewports until it passes**

If an assertion fails, decide whether the FEATURE or the TEST is wrong before changing anything, and record which it was.

- [ ] **Step 3: Mutation controls**

Create `verify-tmp/t77-mutants.js` by copying `verify-tmp/t76-mutants.js` and replacing its `MUTANTS` array — that runner already handles CRLF anchors and byte-verifies the restore. Each must turn the suite red:

1. In `visibleListRows`, drop the `matchesTriState(permitStage(row), f.stages)` clause — the stage filter stops working.
2. In `setRowFilter`, make the third click return to `"include"` instead of `null`.
3. Make `toggleFollowUpFilter` tri-state — Follow-up must stay binary.
4. Count the stages over the FILTERED rows instead of all rows — counts shift as you tick.
5. Remove the Clear control from the empty view.

- [ ] **Step 4: Regression set**

```bash
cd worker && node --test "test/*.test.mjs" && cd ..
for s in t44-followup t57-visited-called t59-list-pagination t46-multilist t75-permit-stage t76-stage-filter; do
  node verify-tmp/$s.js >/dev/null 2>&1 && echo "$s ok" || echo "$s FAILED"
done
```

**`t57-visited-called` WILL break, and this is measured, not predicted:** it
references `filter-not-visited` three times and `filter-not-called` twice — the
two buttons this task deletes. It is the FEAT-031 guard, so it must be
**repaired, never deleted or loosened**. Point it at the two new tri-state
pills, keeping every behavioural assertion it already makes: within a facet the
states are mutually exclusive, across facets they combine, and "visited + not
called" is still the question it checks. Then prove the repair kept its teeth —
revert one of the pill's states in a scratch copy and confirm the repaired suite
goes red. A suite that passes against both the old and the new behaviour has
been gutted, which is worse than deleting it.

`t44-followup` does NOT reference those ids (measured: zero hits) and should
survive untouched. If it fails, that is a real regression in the Follow-up pill,
which this task is not supposed to change at all.

- [ ] **Step 5: ui-ux-pro-max pass**

Measure the filter row in BOTH themes at BOTH viewports: contrast on the pills in all three states, 44px targets, focus rings, the ✓/✗ marks not being the only signal, no horizontal scroll, and the table still above the fold at 390px.

- [ ] **Step 6: Commit**

`verify-tmp/` is gitignored, so this commit will be empty. Expected — keep the files on disk and say so.

---

## Done when

- Worker tests green, including `list-filters.test.mjs`.
- `t77-list-filters.js` passes at both viewports; all five mutants caught.
- `t44-followup` and `t57-visited-called` are green — updated if they asserted the old markup, with their discriminating power proven.
- The board's FEAT-048 checklist is ticked and the card is `done`.
- Merged only on Divyam's explicit approval.
