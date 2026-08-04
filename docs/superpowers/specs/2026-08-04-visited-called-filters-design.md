# FEAT-031 — My Permit List: filter by visited / called

Design spec. Written 2026-08-04 after a design-time `ui-ux-pro-max` pass, before
any code. Board card: `dkaruri/kanban` → FEAT-031 (P1).

## What already exists (read before designing — it changed the design)

FEAT-034 built the seat this feature sits in, and left it explicitly labelled:

- `state.listFilters` is an **object**, not a boolean, and `docs/list.html:3694`
  carries the comment "Built as a group so FEAT-031's visited/called chips join
  this row rather than starting a second, competing filter bar."
- `visibleListRows()` is a **view filter and nothing else** — `renderUserList`
  passes the filtered rows to `permitTable` only; exports, drive-time legs and
  Optimize route all keep reading `userListRows()`. Checklist item 4 is
  therefore already satisfied by construction and must stay that way.
- Reordering is already **locked while filtered**, with `aria-disabled` (not
  `disabled`) so the buttons stay focusable and explain themselves.
- The Worker treats `ticks` (visited) and `fu` (follow-up) as **one shape** —
  a per-key boolean on one list document — behind one shared handler
  (`worker/src/lists.js`, the `(ticks|follow)` route) and one `applyOp`.

So "called" is a **third flag of the same shape**, not a new subsystem. Nothing
here needs a new storage model, a new endpoint shape, or a second filter bar.

## Decisions

### 1. Two columns, not two checkboxes in one cell

The row today has one checkbox in `td.tick-cell` under a header reading
`Visited/<wbr>Called` — one control for two different facts, which is exactly
what this card exists to separate.

**Rejected:** two checkboxes inside the single existing cell. On desktop the two
boxes are visually identical and only position distinguishes them, so the
meaning would rest on column order alone; adding visible per-box text ("Visited"
/ "Called") inside one cell pushes it to ~160px in a table that is already wide.

**Chosen:** a second `<td class="tick-cell" data-label="Called">` beside the
first, each with its own `<th>`. Meaning is carried by the column header on
desktop and by the existing `::before` inline label on mobile.

This needs **zero new CSS for the cell**, which is why it wins. The mobile
stack rules at `docs/list.html:3560-3571` are already written against
`td.tick-cell`: `order: 2` (directly under the permit number), `display: flex`
with an 8px gap, and a `::before` that prints `data-label` as inline text. A new
cell carrying the same class inherits all of it, and the two cells land in the
same order bucket, sequenced by source order — Visited, then Called.

**The trap this avoids:** a cell with a *new* class (`.call-cell`) would fall
into the default `order: 3` bucket and stack at the BOTTOM of the phone card,
separated from the visited box by every data cell in the row.

### 2. Touch targets — `.tick` is 38px today, under the floor

Measured, not assumed: `.tick` is `width/height: 22px` with `margin: .5rem`
(8px), giving a 38×38 hit area. That is under the 44px minimum, and this feature
doubles the number of these controls. `margin: .6875rem` (11px) makes it
22 + 22 = **44px exactly**, in one value, for both columns at once.

On mobile the two boxes sit in separate flex rows, so the 8px touch-spacing
minimum is met vertically by the cells' own `padding: 6px 0` plus the margins.

### 3. Filter chips — five, in the existing group

`Visited` · `Not visited` · `Called` · `Not called` · `Follow-up only`.

Within a pair the two chips are **mutually exclusive** (pressing "Visited"
clears "Not visited") — a state cannot be both, and offering the contradiction
just to render an empty table is a dead control. Across facets they **combine**:
"Visited" + "Not called" is the real question a field user asks (been there,
nobody has phoned yet).

State becomes `state.listFilters = { followUp: bool, visited: null|"yes"|"no",
called: null|"yes"|"no" }`.

Colour: chips are driven entirely by `--tc`, and a chip that does not set one
renders panel-on-panel (documented at `docs/list.html:657`). The visited pair
takes `--accent`, the called pair `--t5`, follow-up keeps `--warning`. Both
members of a pair share a colour — the label text distinguishes them, and
sharing keeps the pair legible as a pair.

Contrast measured with `scratchpad/contrast.mjs` (text on background), both
themes, both states — pressed chips invert to `var(--panel)` on `var(--tc)`:

| `--tc` | light | dark |
|---|---|---|
| `--accent` (visited) | 5.36:1 | 9.76:1 |
| `--t5` (called) | 7.76:1 | 8.61:1 |
| `--warning` (follow-up, existing) | 5.19:1 | 10.81:1 |

All clear 4.5:1. Pressed state is never colour alone: `button.tag[aria-pressed]`
already prints a `✓` glyph via `::before`.

Five chips wrap on a 390px phone — `.list-filters` is already `flex-wrap` with
an 8px gap. The whole bar stays hidden until there is something to filter.

### 4. No second row-dimming

Visited owns `tr.is-done` (opacity .62 + strike-through on the address). Called
gets **no** row-level dimming: two compounding opacity systems would land a
visited-and-called row at .62 × .62 = **.38**, well under any readable contrast.
The Called checkbox in its own labelled column is the row-level cue, and it is
textual, not colour.

### 5. "Called" is set by hand, and by using the Call action

Auto-set when a `tel:` link is activated **from inside a permit card** — one
delegated listener on the modal rather than an `onclick` threaded through the
three templates that render phone numbers, so a fourth template cannot forget.

Not auto-set from a **contractor** card: calling a GC from its own profile is
not a call about any one of its permits, and silently ticking one would be a
guess. The manual checkbox covers that case.

### 6. Attribution — "show who acted where the data allows"

Today a flag stores `1`. Store the actor's name instead (`chi_permit_author`,
the name the notes feed already prompts for), falling back to `1` when it is
blank. `1` stays truthy, so **every list stored before this ships keeps working
and simply has no name to show** — no migration.

Rendered in the checkbox's `title` and appended to its `aria-label`
("Visited by Divyam"), so it reaches a screen reader and is never colour or
hover alone.

### 7. Shared lists

Nothing new: the flag rides the existing Durable Object op (`{f:"call",k,v}`)
when live, and the existing debounced `PUT .../called` when not. The Worker's
flag route gains `called` as a third alternative in the one regex, and
`list-doc.js` a third `case`. The generic list `PUT` must preserve
`existing.called` exactly as it already preserves `existing.fu`, or a metadata
edit would wipe the team's call log.

## Out of scope (stated, not silently dropped)

- **Filters in the URL.** Chip state is not shareable/deep-linkable. Consistent
  with FEAT-034's follow-up chip; a separate change if wanted.
- **Timestamps** ("called 3 days ago"). The flag stores one actor, not a
  history. The notes feed already exists for narrative.
- **Calling from a contractor card marking every permit of that GC** — that is
  "chase this firm", the same larger feature FEAT-034 declined for follow-ups.

## Verification plan

- Unit: extract the predicates from `docs/list.html` **at test time** (never a
  hand-copied `-impl.mjs`, which can agree with a stale copy); Worker tests for
  the `called` route, the back-compat `1` value, and the `PUT`-preserves-called
  rule.
- Browser: desktop + iPhone 13 (390×844), asserting **geometry** — chip wrap,
  the 44px boxes, and that the Called cell renders directly under the permit
  number on mobile rather than at the bottom of the card.
- Mutants: break each predicate on a working build and confirm the suite catches
  it. A suite that only aborts on missing markup has not tested behaviour.
