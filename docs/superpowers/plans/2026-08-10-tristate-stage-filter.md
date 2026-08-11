# Tri-state filter control + map Stage filter (FEAT-047) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable three-state (off / include / exclude) filter control, and use it to filter the permit map by construction stage.

**Architecture:** Four pure functions carry all the logic and are unit-tested without a browser; one renderer emits a native `<button>` per option; the map drawer gains one dropdown that calls them. Nothing existing changes behaviour — this card is additive, so `loadMapSettings`' `{...defaults, ...saved}` spread gives stored settings the new key for free and **no migration is needed**. Converting the existing filters is FEAT-050.

**Tech Stack:** Vanilla JS in three self-contained HTML pages; `node --test` for unit tests; Playwright for browser verification.

**Spec:** `docs/superpowers/specs/2026-08-10-filter-restructure-design.md`
**Branch:** `feat-047-map-filters`, cut from `feat-046-permit-stage` (the Stage filter needs `permitStage`).

## Global Constraints

- **Never edit `docs/*.html` through a bash heredoc.** Use the Edit tool.
- **All three pages are CRLF.** A multi-line search anchor written with `\n` silently never matches.
- **All three pages carry their own copy** of `defaultMapSettings`, `applyMapFilters`, etc. This triplication is a deliberate project decision — change all three, keep them byte-identical, do NOT factor into a shared module.
- **Use a native `<button>` for each option.** The spec says `role="button"`; a real button is strictly better because it is keyboard-operable without a `keydown` handler. A `tabindex` element with only an `onclick` is keyboard-dead and this repo has shipped that three times.
- **Never `aria-checked="mixed"`** — it means "partially checked", not "excluded", and would announce something false. The state goes in the accessible name.
- **The ✓ and ✗ are plain characters**, never Material Symbols ligatures — that font renders ligature names as literal text until it loads (FIX-027).
- **There is a global `button { width: 100% }` rule** in these pages (FIX-022). Any new button must set its own width or it will stretch.
- **44px minimum** on every option row and dropdown header.
- Run `cd worker && node --test "test/*.test.mjs"` after any change to a page the tests read. Baseline is 252.

---

### Task 1: The four pure functions

**Files:**
- Modify: `docs/index.html`, `docs/list.html`, `docs/map.html`
- Test: `worker/test/tristate.test.mjs` (create)

**Interfaces:**
- Produces, in every page: `normalizeTriState(v)`, `cycleTriState(filter, value)`, `matchesTriState(value, filter)`, `triStateOf(filter, value)`.

- [ ] **Step 1: Write the failing test**

Create `worker/test/tristate.test.mjs`:

```javascript
// FEAT-047. The tri-state filter's whole behaviour lives in four pure functions
// so it can be tested without a browser. They are declared in all three pages
// (no shared module on this site), and this file both exercises them and holds
// the copies in agreement — the FIX-046 lesson.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs");
const PAGES = ["index.html", "map.html", "list.html"];
const read = p => readFileSync(join(DOCS, p), "utf8");

function loadFns(page) {
  const src = read(page);
  const grab = name => {
    const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n    \\}`));
    assert.ok(m, `${page} has no ${name}`);
    return m[0];
  };
  return Function(`"use strict";
    ${grab("normalizeTriState")}
    ${grab("cycleTriState")}
    ${grab("matchesTriState")}
    ${grab("triStateOf")}
    return { normalizeTriState, cycleTriState, matchesTriState, triStateOf };`)();
}

const F = loadFns("map.html");

test("all three pages declare each function exactly once", () => {
  for (const page of PAGES) {
    for (const fn of ["normalizeTriState", "cycleTriState", "matchesTriState", "triStateOf"]) {
      const hits = read(page).match(new RegExp(`function ${fn}\\(`, "g")) || [];
      assert.equal(hits.length, 1, `${page} declares ${fn} ${hits.length} times`);
    }
  }
});

test("the three copies are identical", () => {
  const [a, b, c] = PAGES.map(p => JSON.stringify(loadFns(p) && read(p).match(/function normalizeTriState\([\s\S]*?\n    \}[\s\S]*?function triStateOf\([\s\S]*?\n    \}/)[0]));
  assert.equal(a, b, "index.html and map.html disagree");
  assert.equal(a, c, "index.html and list.html disagree");
});

test("normalizeTriState survives anything storage can hold", () => {
  assert.deepStrictEqual(F.normalizeTriState(undefined), { include: [], exclude: [] });
  assert.deepStrictEqual(F.normalizeTriState(null), { include: [], exclude: [] });
  assert.deepStrictEqual(F.normalizeTriState("nonsense"), { include: [], exclude: [] });
  assert.deepStrictEqual(F.normalizeTriState({ include: "x" }), { include: [], exclude: [] });
  assert.deepStrictEqual(F.normalizeTriState({ include: ["a", 1, null], exclude: ["b"] }),
    { include: ["a"], exclude: ["b"] });
});

test("cycling goes off -> include -> exclude -> off", () => {
  let f = { include: [], exclude: [] };
  f = F.cycleTriState(f, "progress");
  assert.deepStrictEqual(f, { include: ["progress"], exclude: [] });
  f = F.cycleTriState(f, "progress");
  assert.deepStrictEqual(f, { include: [], exclude: ["progress"] });
  f = F.cycleTriState(f, "progress");
  assert.deepStrictEqual(f, { include: [], exclude: [] });
});

test("cycling one value never disturbs another", () => {
  let f = { include: ["a"], exclude: ["b"] };
  f = F.cycleTriState(f, "c");
  assert.deepStrictEqual(f.include.sort(), ["a", "c"]);
  assert.deepStrictEqual(f.exclude, ["b"]);
});

test("triStateOf reports the state of one value", () => {
  const f = { include: ["a"], exclude: ["b"] };
  assert.equal(F.triStateOf(f, "a"), "include");
  assert.equal(F.triStateOf(f, "b"), "exclude");
  assert.equal(F.triStateOf(f, "z"), "");
});

test("Rule B: includes narrow, excludes remove, and BOTH apply", () => {
  // No filter set -> everything passes.
  assert.equal(F.matchesTriState("a", { include: [], exclude: [] }), true);
  // Include-only is a whitelist.
  assert.equal(F.matchesTriState("a", { include: ["a"], exclude: [] }), true);
  assert.equal(F.matchesTriState("b", { include: ["a"], exclude: [] }), false);
  // Exclude-only is a blacklist.
  assert.equal(F.matchesTriState("a", { include: [], exclude: ["a"] }), false);
  assert.equal(F.matchesTriState("b", { include: [], exclude: ["a"] }), true);
  // Both apply. This is the rule the alternative design got wrong: an include
  // must NOT silence an exclude.
  assert.equal(F.matchesTriState("a", { include: ["a", "b"], exclude: ["a"] }), false,
    "an exclude must still bite when includes are set");
  assert.equal(F.matchesTriState("b", { include: ["a", "b"], exclude: ["a"] }), true);
});

test("a value with no stage is excluded once any include is set", () => {
  // "" is what permitStage returns for a permit with no usable milestone.
  assert.equal(F.matchesTriState("", { include: [], exclude: [] }), true);
  assert.equal(F.matchesTriState("", { include: ["progress"], exclude: [] }), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd worker && node --test test/tristate.test.mjs`
Expected: FAIL — "map.html has no normalizeTriState".

- [ ] **Step 3: Add the block to all three pages**

Insert into each page immediately **above** the line `function permitStage(row) {`. Byte-identical in all three:

```javascript
    // FEAT-047. The tri-state filter control: off -> include -> exclude -> off.
    // All the behaviour is in these four pure functions so it can be tested
    // without a browser; the renderer below is only markup.
    //
    // Triplicated because this site has no shared module, and held in agreement
    // by worker/test/tristate.test.mjs — the guard FIX-046 needed after three
    // copies of one constant silently disagreed.
    function normalizeTriState(value) {
      // Storage can hold anything a previous version wrote, or nothing at all.
      const list = v => (Array.isArray(v) ? v.filter(x => typeof x === "string") : []);
      return { include: list(value && value.include), exclude: list(value && value.exclude) };
    }
    function triStateOf(filter, value) {
      const f = normalizeTriState(filter);
      if (f.include.includes(value)) return "include";
      if (f.exclude.includes(value)) return "exclude";
      return "";
    }
    function cycleTriState(filter, value) {
      const f = normalizeTriState(filter);
      const include = new Set(f.include), exclude = new Set(f.exclude);
      if (include.has(value)) { include.delete(value); exclude.add(value); }
      else if (exclude.has(value)) { exclude.delete(value); }
      else { include.add(value); }
      return { include: [...include], exclude: [...exclude] };
    }
    // Rule B: includes narrow, excludes remove, and BOTH always apply. The
    // rejected alternative let any include silence the excludes, which lets a
    // control the user has visibly set stop doing anything — that reads as a bug.
    function matchesTriState(value, filter) {
      const f = normalizeTriState(filter);
      if (f.include.length && !f.include.includes(value)) return false;
      if (f.exclude.includes(value)) return false;
      return true;
    }
```

- [ ] **Step 4: Verify**

Run: `cd worker && node --test test/tristate.test.mjs` — expect PASS, 8 tests.
Then: `cd worker && node --test "test/*.test.mjs"` — expect 260 passing.
Then control bytes:
```bash
node -e 'for (const f of ["docs/index.html","docs/list.html","docs/map.html"]) { const b=require("fs").readFileSync(f); console.log(f, b.filter(x=>x===8).length, b.filter(x=>x===0).length); }'
```
Expected: every line ends `0 0`.

- [ ] **Step 5: Commit**

```bash
git add docs/index.html docs/list.html docs/map.html worker/test/tristate.test.mjs
git commit -m "FEAT-047: tri-state filter primitives, with a drift test"
```

---

### Task 2: The option renderer and its styling

**Files:**
- Modify: `docs/index.html`, `docs/list.html`, `docs/map.html` (one JS function + one CSS block each)

**Interfaces:**
- Consumes: `triStateOf` from Task 1.
- Produces: `triStateOptionHtml({ value, label, count, state, onclick })` returning one `<button class="tri">`.

- [ ] **Step 1: Add the renderer to all three pages**

Insert immediately **below** `matchesTriState` from Task 1, byte-identical in all three:

```javascript
    // One option row. A NATIVE <button>, not a div with role="button": a real
    // button is keyboard-operable without a keydown handler, and a tabindex
    // element with only an onclick is keyboard-dead — this repo has shipped
    // that three times.
    //
    // The state goes in the ACCESSIBLE NAME. aria-checked="mixed" is not usable
    // here: it means "partially checked", not "excluded", and would announce
    // something false. The glyphs are plain characters, never Material Symbols
    // ligatures, which render as literal text until the font loads (FIX-027).
    function triStateOptionHtml(opt) {
      const state = opt.state || "";
      const mark = state === "include" ? "✓" : state === "exclude" ? "✗" : "";
      const said = state === "include" ? "included, activate to exclude"
        : state === "exclude" ? "excluded, activate to clear"
        : "not filtered, activate to include";
      const count = opt.count == null ? "" : `<span class="tri-count">${fmt(opt.count)}</span>`;
      return `<button type="button" class="tri" data-state="${esc(state)}" data-value="${esc(opt.value)}"
        aria-label="${esc(opt.label)}, ${said}" onclick="${opt.onclick}"><span class="tri-box" aria-hidden="true">${mark}</span><span class="tri-label">${esc(opt.label)}</span>${count}</button>`;
    }
```

- [ ] **Step 2: Add the CSS to all three pages**

Insert immediately **above** the `.stage {` rule added by FEAT-046, byte-identical in all three:

```css
    /* FEAT-047. Tri-state filter option. `width: auto` is load-bearing: these
       pages carry a global `button { width: 100% }` (FIX-022) that would
       otherwise stretch every option across the drawer. 44px min-height is the
       touch target — the row is the control, not the little box. */
    .tri {
      width: auto;
      display: flex;
      align-items: center;
      gap: 9px;
      min-height: 44px;
      padding: 6px 8px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--ink);
      font-size: 12.5px;
      text-align: left;
      cursor: pointer;
    }
    .tri:hover { background: var(--panel-2); }
    .tri:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
    .tri-box {
      width: 20px; height: 20px; flex: none;
      display: flex; align-items: center; justify-content: center;
      border: 1.5px solid var(--line-strong); border-radius: 5px;
      background: var(--field); color: var(--muted);
      font-size: 13px; font-weight: 800; line-height: 1;
    }
    .tri[data-state="include"] .tri-box { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .tri[data-state="exclude"] .tri-box { border-color: var(--danger); background: var(--danger-soft); color: var(--danger); }
    .tri-label { flex: 1; min-width: 0; }
    .tri-count { color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 3: Check nothing outranks it**

`.tri` is 0-1-0. A container-scoped rule would beat it — this trap has bitten the repo four times, most recently in FEAT-046 where `.map-result span` flattened a chip.

```bash
grep -nE '\.(map-filter-drawer|list-filters|pm-filters) (button|span)' docs/index.html docs/list.html docs/map.html
```
Expected: no output. If any appear, scope the `.tri` rules to match rather than reaching for `!important`.

- [ ] **Step 4: Verify and commit**

Run: `cd worker && node --test "test/*.test.mjs"` — expect 260 passing (unchanged).
Check control bytes as in Task 1.

```bash
git add docs/index.html docs/list.html docs/map.html
git commit -m "FEAT-047: tri-state option renderer and styling"
```

---

### Task 3: The Stage dropdown, wired

**Files:**
- Modify: `docs/map.html` ONLY — `defaultMapSettings` (~3659), `applyMapFilters` (~4908), `renderMapShell` (~4318)

**PLAN CORRECTION (2026-08-10, found during execution).** An earlier draft said to
change all three pages. That is wrong, and measuring settles it: `index.html` and
`list.html` carry a **vestigial** map mode whose `applyMapFilters` is 39 lines with
**zero** `workTypeCounts`, **zero** second filter pass and **zero** flag filters,
against map.html's 138 lines. FEAT-024 (work types), FEAT-038 (property use) and
FEAT-040 (visited/called) were all applied to `map.html` alone — map filters are a
map.html feature, and that is the established pattern this task follows.

Tasks 1 and 2 correctly went into all three pages: those are generic helpers with a
drift test, and FEAT-048 will use them on `list.html`. Only the *wiring* is map-only.

**Interfaces:**
- Consumes: `matchesTriState`, `cycleTriState`, `triStateOf`, `triStateOptionHtml` (Tasks 1–2); `permitStage`, `PERMIT_STAGE_LABELS` (FEAT-046).
- Produces: `settings.stages`, `setMapStageFilter(value)`, `clearMapStageFilter()`, `state.map.stageCounts`.

- [ ] **Step 1: Add the setting**

In `defaultMapSettings` in all three pages, add after `propertyUse: "",`:

```javascript
        // FEAT-047. Additive: loadMapSettings spreads defaults under whatever is
        // stored, so settings saved before this shipped get it for free. No
        // migration needed — unlike the four keys FEAT-050 has to convert.
        stages: { include: [], exclude: [] },
```

- [ ] **Step 2: Add the handlers**

Insert immediately below `defaultMapSettings` in all three pages:

```javascript
    // Mirrors setMapFlagFilter deliberately. There is NO explicit save call:
    // applyMapFilters() runs saveMapSettingsFromControls(), which writes this
    // same settings object wholesale, so `stages` rides along because it lives
    // on it. Both are async for the same reason setMapFlagFilter is.
    async function setMapStageFilter(value) {
      const settings = loadMapSettings();
      settings.stages = cycleTriState(settings.stages, value);
      await applyMapFilters();
    }
    async function clearMapStageFilter() {
      const settings = loadMapSettings();
      settings.stages = { include: [], exclude: [] };
      await applyMapFilters();
    }
```

**Do NOT add `stages` to `saveMapSettingsFromControls`.** That function rebuilds
settings from DOM controls, and its own FEAT-024 comment records why that is
dangerous: the drawer is re-rendered wholesale by `renderMapShell`, so reading a
control that happens to be absent silently clears the persisted value. `stages`
must ride along on the settings object exactly as `visited` and `called` do —
never be reconstructed from the dropdown.

- [ ] **Step 3: Count, then filter**

In `applyMapFilters` in all three pages, immediately **after** the `workTypeCounts` block and **before** the second `.filter(...)` pass, add:

```javascript
      // Counted BEFORE the stage exclusion, so ticking one option never changes
      // the number beside another. Same rule as FEAT-024's work-type counts.
      const stageCounts = new Map();
      for (const row of state.map.filteredRows) {
        const stage = permitStage(mapRowToPermit(row));
        if (stage) stageCounts.set(stage, (stageCounts.get(stage) || 0) + 1);
      }
      state.map.stageCounts = [...stageCounts];
```

Then inside the second `.filter(row => { ... })` pass, add as its first line:

```javascript
        if (!matchesTriState(permitStage(mapRowToPermit(row)), settings.stages)) return false;
```

- [ ] **Step 4: Render the dropdown**

In `renderMapShell` in all three pages, immediately **after** the `map-flag-filters` block, add:

```javascript
              <details class="map-filter-group" id="map-stage-details">
                <summary id="map-stage-summary">Construction stage <b>${mapStageSummaryText(settings)}</b></summary>
                <div class="tri-list" role="group" aria-label="Filter by construction stage">
                  ${(state.map.stageCounts || []).map(([stage, n]) => triStateOptionHtml({
                    value: stage,
                    label: PERMIT_STAGE_LABELS[stage] || stage,
                    count: n,
                    state: triStateOf(settings.stages, stage),
                    onclick: `setMapStageFilter('${enc(stage)}')`,
                  })).join("")}
                </div>
                <p class="tri-hint">Click to include, again to exclude, again to clear. <button type="button" class="linkish" onclick="clearMapStageFilter()">Clear</button></p>
              </details>
```

And add the summary helper beside the handlers from Step 2:

```javascript
    function mapStageSummaryText(settings) {
      const f = normalizeTriState(settings && settings.stages);
      if (!f.include.length && !f.exclude.length) return "all";
      const parts = [];
      if (f.include.length) parts.push(`${f.include.length} included`);
      if (f.exclude.length) parts.push(`${f.exclude.length} excluded`);
      return parts.join(", ");
    }
```

- [ ] **Step 5: Verify by hand**

```bash
python -m http.server 8791 --directory docs
```
Open <http://localhost:8791/map.html>, wait for pins, open Filters, expand Construction stage. Confirm: one row per stage present in the result with a count; clicking cycles ✓ → ✗ → off; the map's pin count changes; a reload keeps the selection.

- [ ] **Step 6: Commit**

```bash
git add docs/index.html docs/list.html docs/map.html
git commit -m "FEAT-047: Stage dropdown on the map, counted before exclusion"
```

---

### Task 4: Direction in the status strip, and an empty state

**Files:**
- Modify: `docs/map.html` ONLY — the status-strip line in `applyMapFilters` (~5355) and the empty branch in `renderMapSideList`

Same correction as Task 3: `index.html` and `list.html` carry a vestigial map mode
with no status strip of this shape and no flag/work-type filters. Map filters are a
map.html feature.

**Interfaces:**
- Consumes: `normalizeTriState`, `PERMIT_STAGE_LABELS`.
- Produces: `mapStageNote(settings)`.

- [ ] **Step 1: Add the note builder**

Beside `mapStageSummaryText`, in all three pages:

```javascript
    // Presence is not enough once a filter has a DIRECTION: from the closed
    // drawer a user cannot otherwise tell whether a stage was included or
    // excluded. Reads as: "In progress, Finishing, not Halted".
    function mapStageNote(settings) {
      const f = normalizeTriState(settings && settings.stages);
      const name = s => PERMIT_STAGE_LABELS[s] || s;
      const bits = [];
      if (f.include.length) bits.push(f.include.map(name).join(", "));
      if (f.exclude.length) bits.push("not " + f.exclude.map(name).join(", not "));
      return bits.length ? ` | ${bits.join(", ")}` : "";
    }
```

- [ ] **Step 2: Use it in the status strip**

In the long `map-status-strip` assignment in all three pages, add `${mapStageNote(settings)}` immediately after `${flagNote}`.

- [ ] **Step 3: Empty state**

Immediately after the second filter pass in `applyMapFilters`, add:

`renderMapSideList` already emits `<div class="empty">No permits match these map
filters.</div>` when nothing survives, so the empty case is handled — what it
lacks is a way out. Do NOT add a competing empty block in `applyMapFilters`;
extend the existing one in `renderMapSideList` in all three pages:

```javascript
        setMapResultListHtml(rows.length ? rows.map(mapResultButton).join("") : `<div class="empty" role="status">No permits match these map filters.<br><button type="button" class="map-clear-filters" onclick="resetMapSettings()">Clear filters</button></div>`, scrollTop);
```

`class="linkish"` is NOT available here — it exists only in `list.html`.

**Task 3 shipped four classes with no CSS at all** (`.map-filter-group`,
`.tri-list`, `.tri-hint`, and a `.linkish` Clear button), so the dropdown
currently renders unstyled. Fixing that is part of this task. Add one block
beside the `.tri` rules from Task 2, in **`docs/map.html` only** — the other two
pages have no map drawer:

```css
    /* FEAT-047. The dropdown shell. <details> supplies open/close and keyboard
       operation natively, so the summary is the 44px header and needs no
       handler of its own. The default disclosure marker is removed because the
       summary is a flex row; list-style AND the -webkit- rule are both required
       to cover every engine. */
    .map-filter-group {
      margin-top: 8px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .map-filter-group > summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 44px;
      padding: 0 10px;
      list-style: none;
      cursor: pointer;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .map-filter-group > summary::-webkit-details-marker { display: none; }
    .map-filter-group > summary b { color: var(--ink); }
    .map-filter-group > summary:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; border-radius: 8px; }
    .tri-list { display: flex; flex-direction: column; padding: 4px; border-top: 1px solid var(--line); }
    .tri-hint { margin: 0; padding: 6px 10px 8px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11.5px; }
    /* The way out of an impossible filter, and the dropdown's own Clear. Rule B
       lets includes and excludes compose into nothing, and a result with no
       action reads as broken. `width: auto` is load-bearing against the global
       `button { width: 100% }`. */
    .map-clear-filters, .tri-hint .linkish {
      width: auto;
      min-height: 44px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--primary);
      font-size: 12.5px;
      font-weight: 700;
      cursor: pointer;
    }
    .map-clear-filters { margin-top: 6px; }
```

`resetMapSettings()` clears every filter, not only the stage — that is the
honest meaning of "Clear filters" when the user is staring at nothing, and it is
an existing function with existing semantics. Do not narrow it to the stage.

- [ ] **Step 4: Verify and commit**

Reload the map, include one stage and exclude the same stage, confirm the empty state appears with a working Clear filters link, and that the status strip names the direction.

```bash
git add docs/index.html docs/list.html docs/map.html
git commit -m "FEAT-047: status strip states filter direction; empty state for an impossible filter"
```

---

### Task 5: Headless verification and mutation controls

**Files:**
- Create: `verify-tmp/t76-stage-filter.js`, `verify-tmp/t76-mutants.js`

- [ ] **Step 1: Write the browser suite**

Create `verify-tmp/t76-stage-filter.js`. It must run at desktop 1280x900 AND iPhone 13 390x844, stub Socrata with a fixed set of permits covering several stages, and assert:

```
- the dropdown lists one row per stage PRESENT, with its count
- clicking once includes: only that stage's permits remain, count on the map drops accordingly
- clicking twice excludes: that stage's permits are the only ones gone
- clicking three times clears: the original count returns
- including A and excluding A yields the EMPTY STATE, with a working Clear filters control
- counts beside the OTHER options do not change when one option is ticked
- every option row is >= 44px at BOTH viewports
- each option is operable by a real Enter key press, not .click()
- the accessible name states the current state ("included, activate to exclude")
- the status strip names the direction, e.g. "not Halted"
- the selection survives a reload
```

Model the file on `verify-tmp/t75-permit-stage.js` for structure, and read `verify-tmp/_boot.js` first — it documents two races that have caused flakes here.

- [ ] **Step 2: Run it**

```bash
node verify-tmp/t76-stage-filter.js
```
Expected: ALL PASS at both viewports.

- [ ] **Step 3: Mutation controls**

Create `verify-tmp/t76-mutants.js` by copying `verify-tmp/_fix045-mutants.js` and replacing its `MUTANTS` array — that runner already handles CRLF anchors and byte-verifies the restore. Each mutant must turn `t76-stage-filter.js` red:

1. In `matchesTriState`, `return true` before the exclude check — an exclude stops biting when includes are set (the rejected Rule A).
2. In `cycleTriState`, make the third click return to `include` instead of clearing.
3. Move the `stageCounts` loop to AFTER the stage filter — counts then shift as you tick.
4. Drop the state from the accessible name in `triStateOptionHtml`.
5. Remove the empty-state block from Task 4.

- [ ] **Step 4: Run the mutants and the regression set**

```bash
node verify-tmp/t76-mutants.js
cd worker && node --test "test/*.test.mjs" && cd ..
for s in t69-map-visited-called t71-map-persistence t52-worktype-residential t62-property-use t75-permit-stage t75-uiux t75-mapchip; do
  node verify-tmp/$s.js >/dev/null 2>&1 && echo "$s ok" || echo "$s FAILED"
done
```
Expected: all five mutants caught; worker 260 passing; every listed suite `ok`. `t71-map-persistence` matters most — it is the FIX-035 guard that every map control survives reload.

- [ ] **Step 5: ui-ux-pro-max pass**

Invoke the `ui-ux-pro-max` skill against the built result. Measure at **both** themes and **both** viewports, and measure the dropdown option rows specifically — FEAT-046's pass passed while missing a broken render site because it measured only one. Check: 44px targets, focus rings, 4.5:1 contrast on the ✓/✗ marks and the count text in both themes, no meaning by colour alone (the accessible name carries it), reduced-motion respected.

- [ ] **Step 6: Commit**

```bash
git add verify-tmp/t76-stage-filter.js verify-tmp/t76-mutants.js
git commit -m "FEAT-047: headless suite and mutation controls for the stage filter"
```

Note: `verify-tmp/` is gitignored, so this commit will be empty. Expected — keep the suites on disk and say so in the report.

---

## Done when

- `worker/` tests green, including `tristate.test.mjs`.
- `t76-stage-filter.js` passes at both viewports; all five mutants caught.
- `t71-map-persistence.js` still green — the stage selection must survive a reload like every other map control.
- The board's FEAT-047 checklist is ticked and the card is `done`.
- Merged only on Divyam's explicit approval.
