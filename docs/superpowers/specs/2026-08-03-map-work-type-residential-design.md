# FEAT-024 — Map Search: exclude work types, filter to residential

**Board card:** FEAT-024 (dkaruri/kanban), P2-Medium
**Surface:** `docs/map.html` only
**Date:** 2026-08-03

## Problem

Map Search shows every open permit in the date range. Two kinds of noise dominate:
work the user does not care about (electrical pulls, monthly maintenance,
scaffolding), and non-residential property. Neither can be filtered today.

## Data findings that shaped the design

Measured against live Socrata (`ydr8-5enu`) and the shipped
`docs/data/zoning.geojson` before any code was written.

### `work_type` exists only on Express permits

Open permits, trailing 12 months:

| permit_type | count | carries `work_type`? |
|---|---:|---|
| PERMIT – EXPRESS PERMIT PROGRAM | 14,798 | yes — 20 distinct labels |
| PERMIT - RENOVATION/ALTERATION | 4,812 | **always blank** |
| PERMIT - NEW CONSTRUCTION | 1,466 | **always blank** |

A control offering only the 20 Socrata labels cannot exclude renovation or new
construction — 30% of permits, and the two categories a user is most likely to
want to isolate. The filterable set is therefore **22 entries**: the 20 labels,
plus two synthesized from `permit_type` for the blank-`work_type` rows.

The 20 labels, with trailing-12-month counts: Electrical Work (4,082), Masonry
Work (1,783), Reroofing (1,105), Fire Alarm System (1,099), Nonstructural
Interior Work (997), Monthly Maintenance Permit (935), Fence or Trash Enclosure
(917), Small-Scale Solar PV System (881), `Porch,Deck,Balcony,or Fire Escape`
(513), Detached Frame Garage (512), Plumbing Work (468), Mechanical Work (350),
Exterior Windows/Doors Replacement (322), Other Work (287), Scaffolding (286),
Storm Water Management Plan (103), Communication Equipment (92), Administrative
Change (45), Small Temporary Structure (14), Construction Trailer (7).

Note the literal commas inside `Porch,Deck,Balcony,or Fire Escape` — the field is
a single label, not a delimited list. Never split `work_type` on commas.

### Zoning beats the text heuristic for "residential", decisively

The permits dataset carries no occupancy field. `permitUse()` (FEAT-013, shipped
on `index.html`/`list.html`) infers use from `permit_type` + `work_description`.
Over July 2026 (2,384 open, geocoded permits):

| signal | classified | residential |
|---|---:|---:|
| `permitUse()` text heuristic | 32% | 623 (26%) |
| **zoning district (point-in-polygon)** | **99.8%** | **1,496 (62.8%)** |

Only 5 of 2,384 permits fall outside every zoning district. 1,084 permits the
text called "unclear" sit in RS/RT/RM districts.

An `OCCUPANCY:` label appears in the description of just 73 of 2,384 rows, almost
all non-residential (Business 23, Utility 11, Education 11). Not a usable
residential signal.

Full July distribution by zoning category: residential 1,496 (62.8%), planned
development 373 (15.6%), business 201 (8.4%), downtown 140 (5.9%), commercial 64
(2.7%), manufacturing 60 (2.5%), open space 43 (1.8%), no district 5 (0.2%),
transportation 2 (0.1%).

### Zoning states what is allowed, not what is built

B1–B3 "business" districts are storefronts with housing above, and the
disagreements confirm real housing work sits there — a B3-5 fire-alarm permit
reading `AFFECTS: 40 DWELLING UNITS`, plumbing-fixture replacements in B3-2 and
B3-3. Strict RS/RT/RM drops roughly 200 permits a month of genuine residential
work. Hence two levels of strictness rather than one toggle.

### Cost is affordable

`docs/data/zoning.geojson` is 5.0 MB raw, ~850 KB gzipped, 14,877 features →
16,369 rings after flattening. Measured in Node against the real file:

| step | time |
|---|---:|
| parse | 104 ms |
| build grid index | 77 ms |
| classify 2,384 points | **11 ms** |

The map already lazy-loads this exact file for the Zoning Districts layer.

## Design

### 1. Work-type exclude control

A `<details>` element in the filter drawer, collapsed by default.

- `<summary>` is a ≥44px target reading `Exclude work types`, followed by a count
  (`3 excluded`) so the state is legible while collapsed. Text, not colour.
- `<details>`/`<summary>` is native: keyboard-operable and screen-reader
  announced with no custom JS, and no animation to gate on reduced-motion.
- Inside: `Select all` / `Clear` buttons, then a list of 22 `.check-row`
  checkboxes, each showing the type name and its count within the currently
  loaded rows.
- The list is `max-height: 260px; overflow-y: auto`. **Required, not cosmetic:**
  `.map-drawer` is `max-height: 720px` with `overflow: visible`, so unbounded
  content spills outside the drawer's border instead of scrolling.
- Counts use tabular figures and a muted token (≥4.5:1 in both themes).
- Default: nothing excluded. The map is unchanged until the user opts in.

### 2. Property use control

A labelled `<select>` in `.map-filter-grid`:

| option | predicate | ~share of month |
|---|---|---:|
| All property types (default) | no filter | 100% |
| Residential zoning only | `zcat === "residential"` or `zone_class` starts `DR` | ~63% |
| Residential + business | above, plus `zcat === "business"` (B1–B3) | ~71% |

District codes appear in the option text so nothing about what got hidden is
hidden.

### 3. Zoning resolution

New `zoneCategoryAt(lon, lat)`, built once from `zoning.geojson`:

1. Flatten every Polygon/MultiPolygon to rings, recording a bbox per ring set.
2. Index each into a `0.005°` (~550 m) grid keyed `gx,gy`.
3. Look up the point's cell, bbox-reject, then even-odd ray-cast the outer ring
   and reject if any inner ring (hole) also contains the point.

Returns `{ zcat, zone_class }` or `null` when the point is in no district.

- Selecting a non-`All` option triggers the existing `ensureZoningLoaded()`.
  The count pill shows `Loading zoning…` and the filter does not apply until the
  index is built — an unresolved filter must never silently produce wrong rows.
- On fetch failure the select reports it and falls back to showing everything.
  An empty map with no stated reason is the worse failure.
- Points in no district are **kept** when a residential filter is active. Same
  principle as the FIX-011 neighborhood fallback: never invent a classification,
  and 5 rows a month is not worth a silent drop.

### 4. Filtering and persistence

Both predicates go into the existing `state.map.filteredRows` filter in
`applyMapFilters`, after the cost band and before the neighborhood match.

Both settings persist in `chi_permit_map_settings` alongside the FIX-008 keys.
A reload with a residential filter active must await the zoning load before the
first render, or the first paint shows unfiltered rows.

The status strip gains a note when either filter is active, so a thin map
explains itself.

### Explicitly not doing

`permitUse()` is not used for this filter and is not modified. The card's
checklist assumed the FEAT-013 text heuristic ("defining which building types
count as residential"); zoning replaces it here. `permitUse()` continues to label
individual permits on `index.html`/`list.html` — that is a different question
(what the work says) from the one this filter answers (what the property is).

## Testing

- Unit: `zoneCategoryAt` against known coordinates — a Loop address (downtown), a
  Logan Square two-flat (residential), an O'Hare point, a point in Lake Michigan
  (no district), and a point inside a polygon hole.
- Unit: the 22-entry work-type set derives correctly, including the two
  synthesized entries and the comma-bearing label.
- Browser guard `verify-tmp/t50-work-type-residential.js`, desktop + iPhone 13:
  both controls present and labelled, summary ≥44px, rows ≥44px at 390px, the
  select ≥16px font, exclusions actually remove rows, the property-use select
  narrows to the measured share, both combine with the date and value filters,
  settings survive a reload, and the zoning-load failure path falls back rather
  than emptying. Every assertion must be shown to fail against the pre-change
  tree.
- Performance check with all filters active across a multi-month range.
- Full regression: browser scripts, client and Worker unit tests.
