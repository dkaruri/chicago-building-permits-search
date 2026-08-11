# Include/exclude filters on the map and the permit list — design

- **Date:** 2026-08-10
- **Board cards:** FEAT-047 (map), FEAT-048 (list). One design, two cards, so
  the map can ship before the list.
- **Depends on:** FEAT-046. There is no stage to filter by until
  `permit_milestone` is being selected.
- **Status:** design approved, not yet implemented

## Problem

Adding a stage filter with the existing chip pattern breaks both surfaces.

The map drawer already holds 8 groups and 13 controls. Five more stage chips
joins the 4 visited/called chips to make 9, four rows deep, inside a drawer
that is already long enough to scroll on a phone.

The permit list is worse. Its filter row is always visible above the table,
and the list is the one surface where closed permits appear — so it needs
seven stage chips, not five. Added to the existing five, that is 12 chips
running six rows deep at iPhone 13 width, which pushes the table itself below
the fold.

Both surfaces have also outgrown their controls independently of stage. Work
types can only be excluded, never included. Property use offers three fixed
levels and cannot express "manufacturing only". Visited and called spend four
chips on two questions.

## The tri-state control

One shared primitive, used by every set-valued filter on both surfaces.

| State | Glyph | Meaning |
|---|---|---|
| off | empty box | the value has no effect on the result |
| include | green ✓ | narrow the result to included values |
| exclude | red ✗ | remove this value from the result |

Clicking cycles off → include → exclude → off.

**Rule: includes narrow, excludes remove, and both always apply.** Start from
every row; if any include is set, keep only rows matching an include; then
drop rows matching any exclude. The alternative — treating any include as a
whitelist that mutes the excludes — was rejected because it lets a control the
user has visibly set stop doing anything, which reads as a bug.

Because both apply, filters can compose into an empty result. Every surface
using this control needs an explicit empty state with a Clear filters action
(see below); silently rendering nothing is what makes a filter feel broken.

### Accessibility

The control is **not** a checkbox. `aria-checked="mixed"` exists but means
"partially checked", and using it for "excluded" would announce something
false. Each option is `role="button"` with its state in the accessible name:

> "Halted, excluded. Activate to clear."

The green ✓ and red ✗ differ in shape as well as colour, so the states survive
colour blindness and a monochrome screen. **Both glyphs are plain characters,
never Material Symbols ligatures** — that font renders ligature names as
literal text until it loads, which is FIX-027.

Every option row and every dropdown header is a minimum of 44px.

### Which options are offered

Only values actually present in the current result set, with counts, matching
how the map's work-type list already behaves. A saved list holding no Fee due
permits does not offer Fee due at zero.

Counts are computed **before** that filter's own exclusions are applied, so
ticking one option never changes the numbers shown beside the others. This is
the FEAT-024 rule, restated because it now applies to three dropdowns rather
than one.

## Map — drawer restructure

Eight groups become three.

**Ranges** — typed fields, unchanged in behaviour: From, To, GC jobs min/max,
Min/Max value, Radius (miles), Neighborhood / street.

Date range stays two date fields. It is a continuous range, not a set: there
is nothing to put checkboxes on, and excluding a date range has no meaning
beside an include.

**Include / exclude** — three dropdowns, each using the tri-state control:

| Dropdown | Options | Today |
|---|---|---|
| Stage | the 5 open stages from FEAT-046 | does not exist |
| Property use | 8 zoning categories | 3 nested levels, single-select |
| Work types | as now, derived from the data | exclude-only |

**Your flags** — Visited and Called as two tri-state rows, replacing four
chips. Include Visited + exclude Called reads as *been there, nobody has
phoned yet*, which two chips only ever implied. The FEAT-040 scoping note
still holds and must still be stated on screen: these are meaningful only for
permits in a saved list, and treating the other ~40,000 as "not visited" would
be a lie.

### Property use is redefined

Today: `""` / `residential` / `residential_business` — three nested levels,
each strictly wider than the last. Tri-state over nested levels contradicts
itself, since including Residential while excluding Residential+business asks
about a set that contains the one being included.

It becomes a flat set of the 8 zoning categories the map **already** defines
and renders in its zoning legend at `map.html:4390`, with the same swatch
colours:

`Residential` (RS, RT, RM) · `Business` (B1–B3) · `Commercial` (C1–C3) ·
`Downtown` (DX, DC, DR, DS) · `Manufacturing` (M1–M3, PMD) ·
`Planned Dev` (PD) · `Open space` (POS) · `Transportation` (T)

This is strictly more capable — manufacturing-only is currently impossible to
ask for — and it introduces no new vocabulary, because the legend is already
on screen teaching these exact eight names.

The FEAT-024 reasoning survives intact: the classification still comes from
the zoning district the property sits in, not from the work description, and a
permit in no district at all still passes rather than being dropped.

## Permit list — filter row restructure

Twelve chips become four controls in a single always-visible row:

```
[ Stage — 1 excluded ▾ ]  [✓ Visited]  [✗ Called]  [⚑ Follow-up only]
```

- **Stage** — dropdown, tri-state, offering only the stages present in this
  list with counts of this list. Seven possible, since saved permits are the
  one place closed permits appear.
- **Visited** / **Called** — tri-state pills, replacing the four chips.
- **Follow-up only** — stays a plain on/off pill. It is deliberately the one
  binary control left: "everything except follow-ups" is not a question anyone
  asks, and this is the control most likely to be tapped in a hurry.

**Excluding Complete is the point of this on the list.** A saved list silently
accumulates finished jobs, and today the only ways to stop seeing them are to
scroll past them or delete them and lose the record.

## Filter summary must carry direction

Both surfaces already state active filters — the map in its status strip, the
list in `#list-filter-status`. Presence is no longer enough now that a filter
has a direction:

> Aug 1–10 · **In progress, Finishing**, not Halted · visited, not called · 1,204 permits

Without this a user cannot tell from the closed drawer whether a stage was
included or excluded.

## Persistence and migration

FIX-035 established that every map control survives reload, so these settings
are in real users' storage now and changing their shape without a migration
silently resets everyone's filters. All four migrate losslessly:

| Stored today | Becomes |
|---|---|
| `excludedWorkTypes: [...]` | `workTypes: { include: [], exclude: [...] }` |
| `propertyUse: "residential"` | `propertyUse: { include: ["residential"], exclude: [] }` |
| `propertyUse: "residential_business"` | `propertyUse: { include: ["residential", "business"], exclude: [] }` |
| `visited: "yes"` / `"no"` | `visited: "include"` / `"exclude"` |
| `called: "yes"` / `"no"` | `called: "include"` / `"exclude"` |

`stages: { include: [], exclude: [] }` is new and defaults to empty, which
means unfiltered. The migration runs once on read; an unrecognised shape falls
back to the default rather than throwing.

## Testing

- Tri-state cycle: three clicks return to off, on every control, on both
  surfaces.
- Rule B: include-only, exclude-only, and both together, including the
  compose-to-empty case, which must render the empty state and not a bare
  table.
- Counts are stable while ticking options in the same dropdown.
- Only-present-options: a list with no Fee due permits does not offer it.
- Migration: each row of the table above, plus an unrecognised shape, plus
  absent settings.
- Property use parity: a permit set filtered to the old `residential` level
  must give the same rows as the new `include: ["residential"]`, and
  `residential_business` the same as `include: ["residential", "business"]`.
  This is the regression that would otherwise go unnoticed.
- Keyboard: every option reachable and cyclable by keyboard, with the state
  announced. Driven by a real Enter/Space key event, never `.click()` — a
  `tabindex` element with only an onclick handler is keyboard-dead, and this
  repo has shipped that three times.
- Headless at desktop and iPhone 13, asserting the list table is still above
  the fold with filters applied, and 44px on every option row.
- `ui-ux-pro-max` second pass before landing, on each card.

## Out of scope

- **New filter kinds on the list.** The saved list still has no date, value,
  GC-jobs, neighbourhood or work-type filter. That gap is real but a saved
  list is small enough to read, and adding six controls to justify a
  restructure would invert the point of it.
- **Sorting by stage**, still — see FEAT-046.
- **Saving filter combinations** as named presets.
- **Map pin colour**, which stays on GC open-job count.
