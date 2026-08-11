# Permit list: a collapsible header, a stable filter row, and the count under the table — design

- **Date:** 2026-08-11
- **Board card:** FEAT-052
- **Status:** design approved, not yet implemented
- **Supersedes:** the 3-line clamp on the list description (`toggleListDesc`)

## Problem

Three complaints, all measured on the working branch rather than inferred.

**1. The controls jump when you click them.** Positions snapped before and after
each interaction:

| Action | Desktop | Mobile |
|---|---|---|
| Click Visited | pill +13px, everything right of it shifts 13px | **table drops 38px** |
| Include a stage | summary `all`→`1 included` = +45px, all pills shift | **table drops 44px** |
| Toggle Follow-up | status text +118px | status wraps, jumps 138px left |

On a phone the rows you are reading move under your finger every time you tap a
filter. Three causes: the ✓/✗ is *added to* the label so the pill resizes; the
stage summary is prose whose length changes; the status line grows until it
wraps and changes the bar's height.

**2. The filter row has no alignment.** The status text sits at y=287 while every
control sits at 273–274 — it floats 13px below the row it belongs to. The Stage
dropdown is 46px tall against the pills' 44px. Four controls, four widths
(76/68/64/130), two shapes.

**3. You scroll past half a screen of chrome before seeing a permit.** The table's
top edge is 651px on desktop and **1330px on mobile**, in an 844px viewport.

## Design

### A. Two labelled rows, sized so nothing moves

The filter row splits by kind — what a permit *is*, then what *you* did to it:

```
Permit          [ Stage  (2) ▾ ]
Your activity   [✓ Visited] [✗ Called] [⚑ Follow-up only]
```

Four mechanics keep it still:

- **Reserved mark slot.** A 16px `<i class="mk">` is always present — empty, ✓,
  or ✗. Today the glyph is prepended to the label, which is why the pill grows.
- **`min-width` per control**, sized to its widest state, so cycling cannot
  resize it.
- **The stage summary becomes a fixed-width badge** carrying just a count.
  `all` / `1 included` / `2 included, 1 excluded` is prose that grows 45px; a
  number cannot. The full wording moves into the dropdown's own header, where
  there is room for it.
- **Follow-up keeps its two states** and its own width. Unchanged otherwise.

### B. The filtered count moves below the table

`#list-filter-status` currently does two jobs. They separate:

- **Unfiltered tally** (`2 visited · 1 called`) — **stays in the filter row**. It
  is the prompt to reach for a filter in the first place, and below the table it
  would not be seen.
- **Filtered count** (`Showing 3 of 5 · visited, not called`) — **moves below
  the table**, between `#user-list` and `#user-list-pager`. Its length then
  cannot affect anything above it, so no vertical space has to be reserved for
  it and the table's top edge is fixed.

On an empty result there is no table, so the count lands under the "no permits
match" message. That reads correctly — the message already names the active
filters.

`role="status" aria-live="polite"` is preserved. A screen-reader user now hears
the rows, then the summary; that ordering is an improvement, but it IS a
behavioural change and is recorded as deliberate.

### C. A collapsible header, open by default

Replaces the description's 3-line clamp entirely. One control folds a contiguous
block with an animated height transition.

**Folds:**
`#user-list-desc-wrap` · `.user-list-toolbar` · `#optimize-route-note` ·
`.focal-row` · `#user-route-summary` · `.list-note`

**Never folds:**

| Element | Why |
|---|---|
| `#user-list-title` | the heading the toggle belongs to |
| `#list-filters` | filtering must not require reopening |
| `#list-action-status` | **holds the FIX-003 undo link after a removal.** Folded away, "Undo" would silently disappear at the exact moment it is needed |
| the table, pagers, filtered count | the content |

**DOM move required.** The filter row currently sits *between* folding blocks
(toolbar above, focal-row below), so the fold region is not contiguous. Move
`#list-filters` and `#list-action-status` to sit directly above
`#user-list-pager-top`. This also puts the filters adjacent to the table they
filter, which is where they belong.

Resulting order:

```
user-list-title            + the fold toggle
[ FOLD: desc · toolbar · optimize-note · focal-row · route-summary · note ]
list-action-status         (undo lives here)
list-filters               Permit / Your activity
user-list-pager-top
user-list                  the table
user-list-pager
list-filter-status         the filtered count
```

**Default is OPEN.** Everything shows on arrival; the fold is an action the user
takes, not a state they must undo.

**Persistence:** remember the state per list in the same store as the other list
view state, so collapsing survives a reload. Collapse must NOT reset on every
repaint — `renderListDesc` already documents this trap: it runs after each add
and on every live frame, and resetting there would shut the panel while someone
was reading it. Reset only on a change of `activeListId`.

**Motion:** animate `height` between `0` and the measured content height, with
`overflow: hidden`. Respect `prefers-reduced-motion: reduce` by jumping straight
to the end state. The toggle carries `aria-expanded` and `aria-controls`, and
its label states what it does — `Details` with a ▲/▼, never a bare chevron.

**What it buys:**

| | table top now | collapsed |
|---|---:|---:|
| Desktop | 651px | ~353px |
| Mobile | 1330px | ~729px |

## Out of scope

- The map's filter drawer. FEAT-050 converts its remaining filters; this card
  does not touch `map.html`.
- Any change to what the filters *do*. This is layout and stability only — the
  tri-state semantics, Rule B matching and stage vocabulary are unchanged.
- The `index.html` saved-list preview, which has no filter bar.

## Verification

- Re-run the shift measurement from the Problem section: after this change,
  clicking any filter must move **nothing** — assert dx/dy/dw of every control
  and the table's top edge are all 0.
- Collapse and expand at both viewports; assert the table's top edge lands where
  the table above predicts, and that `#list-action-status` and `#list-filters`
  stay visible in both states.
- Assert the undo link is reachable while collapsed — remove a permit with the
  header folded and confirm "Undo" is on screen.
- `prefers-reduced-motion: reduce` produces no animation.
- Collapse state survives a reload and does NOT reset on an add or a live frame.
- Mutants: prepend the glyph to the label instead of the slot; make the stage
  summary prose again; move the filtered count back above the table; fold
  `#list-action-status`. Each must turn the suite red.
