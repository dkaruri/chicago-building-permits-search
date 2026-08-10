# Construction stage on every permit surface — design

- **Date:** 2026-08-10
- **Board card:** FEAT-046 (this spec). Follow-on: FEAT-047, map stage filter.
- **Status:** design approved, not yet implemented

## Problem

`permit_status` tells a user a permit is open. It does not tell them what is
happening on site. A permit issued last week and a permit two inspections from
a certificate of occupancy both read `ACTIVE`, and the tool gives no way to
tell them apart — so a user scanning for somewhere worth visiting today has to
open permits one at a time.

Chicago Cityscape's Building Permit Browser exposes this axis as "milestone"
filters. It is not a separate dataset: `permit_milestone` is a column on
`ydr8-5enu`, the dataset this project already reads. The tell is Cityscape's
own filter label, "Inspections (cert. of occupancy req'd)", which is the raw
value `INSPECTIONS (CERTIFICATE OF OCCUPANCY REQUIRED)` shortened. No join
exists to make: the Data Portal has no building-inspections dataset
(`22u3-xenr` is Violations) and the city publishes no certificate-of-occupancy
database.

The project has never selected the column.

## Coverage — why this is worth doing

Measured live against Socrata on 2026-08-10:

- **100% populated on open permits, every issue year 2015–2026**, and 100%
  populated on closed permits too. The 302,070 dataset-wide nulls are rows
  that also have no `permit_status` — pre-system records, not permits any
  surface here routinely shows. Unlike the assessor parcel class (FEAT-038,
  87.7% sourced), this needs no "no data" affordance.
- 41,005 open permits carry a milestone.

Two states are invisible in the tool today because `permit_status` cannot
express them: `STOP WORK` (26 permits) and `PERMIT ISSUED (FEE DUE)` (632)
both read as plain `ACTIVE`/`SUSPENDED`.

**Status and milestone genuinely disagree.** 4,152 open permits (10%) have
`permit_status = SUSPENDED` but a milestone saying work is live
(`INSPECTIONS` and friends). Zero permits are `ACTIVE` with a halted
milestone. Milestone is the more current of the two fields. The design shows
both rather than resolving the disagreement on the user's behalf.

## Stage vocabulary

The city's 11 values are too long for a chip — `INSPECTIONS (CERTIFICATE OF
OCCUPANCY REQUIRED)` is 47 characters and its distinguishing words are at the
end, so truncation destroys it. The UI shows seven stages — five for open
permits, two for closed; the verbatim value is always available.

Open permits, in lifecycle order:

| Stage | Open permits | Raw `permit_milestone` values |
|---|---:|---|
| Fee due | 632 | `PERMIT ISSUED (FEE DUE)` |
| Not started | 6,577 | `INSPECTION ELIGIBLE` |
| In progress | 24,545 | `INSPECTIONS`, `PROGRESS INSPECTIONS` |
| Finishing | 1,748 | `INSPECTIONS (CERTIFICATE OF OCCUPANCY REQUIRED)`, `CERTIFICATE OF OCCUPANCY PENDING`, `CERTIFICATE OF OCCUPANCY PENDING (TEMPORARY OR PARTIAL OCCUPANCY APPROVED)`, `POST CONSTRUCTION FILING`, `FINAL INSPECTION` |
| Halted | 7,503 | `SUSPENDED`, `STOP WORK` |

Counts sum to 41,005, matching the open-permit total exactly.

**Fee due is its own stage, not folded into Not started.** The city has issued
the permit but is still owed money on it, which is a different situation from
a paid permit waiting on its first inspection — and it is one of the two
states `permit_status` cannot express at all (it reads plain `ACTIVE`). 632
permits is small, but it is a specific, actionable condition rather than a
long tail, and burying it inside a 7,209-permit bucket is what made it
invisible in the first place.

### Closed permits

Closed permits reach the UI by exactly one path. The Worker defaults every
query to open statuses (`permits.js:68`), so the only way to see a closed
permit is to have saved it while it was open and have it close since;
`ensurePermitMap()` re-fetches by permit number with no status filter. That
makes the saved lists — and the overlay opened from them — the home for these
two stages.

| Stage | Permits | `permit_status` |
|---|---:|---|
| Complete | 484,221 | `COMPLETE` |
| Ended early | 16,419 | `EXPIRED`, `CANCELLED`, `REVOKED` |

**A closed permit's chip is decided by `permit_status`, never by
`permit_milestone`.** 13,973 closed permits carry an in-progress milestone —
their permit expired or was revoked while inspections were still running.
Keying off milestone would label an `EXPIRED` permit **In progress**, which is
actively wrong. `permit_status` is present on every closed permit, so it is
the reliable signal; the milestone survives as the verbatim detail, which is
where "expired during INSPECTIONS" remains recoverable.

### Resolution order

`permit_status` is enumerated: 7 values plus null, totalling 843,715 rows.
The rule below is total over that set.

1. `COMPLETE` → **Complete**
2. `EXPIRED` / `CANCELLED` / `REVOKED` → **Ended early**
3. `ACTIVE` / `SUSPENDED` / `PHASED PERMITTING` → look up `permit_milestone`
   in the five-stage open table above
4. anything else → **no chip**

Step 3 always hits: milestone is 100% populated across the open set, and no
open permit carries a closed milestone value. Step 4 is reached only by the
302,070 rows that have neither a status nor a milestone — pre-system records
that can appear only if a user saved one directly. For those, and only those,
no chip renders rather than a placeholder, per FIX-012's rule that no sample
means no pill.

## Where the mapping lives

One frozen lookup table, copied into `index.html`, `list.html` and `map.html`,
matching how the rest of this codebase is organised.

Copying is the drift risk that produced FIX-046 (three pages disagreeing on
`userListLimit`, 220 vs 1000). The mitigation is the one already shipped for
that bug: `worker/test/stage-map.test.mjs` parses the table out of all three
files and fails if they disagree, exactly as `worker/test/list-cap.test.mjs`
does for the cap. Drift is caught mechanically, not by discipline.

A shared `docs/app.js` was considered and rejected **for this card only**: it
is the right long-term answer (the repo carries 2,811 lines of byte-identical
triplicated JS) but starting that refactor is not this feature's job, and it
introduces a deploy-order dependency between the pages and a new file.

## Data plumbing

`permit_milestone` is added to seven `$select` lists and one result map. Each
page carries its own `loadMapMonths` and `ensurePermitMap` — the same
triplication described above.

| File | Line | Function | Feeds |
|---|---:|---|---|
| `worker/src/permits.js` | 123 | `selectCols` | directory, GC/open-sub card, list "open permits" mode |
| `worker/src/permits.js` | 170 | result map | adds `permit_milestone` to the response row |
| `docs/index.html` | 4130 | `loadMapMonths` | |
| `docs/index.html` | 5359 | `ensurePermitMap` | |
| `docs/list.html` | 5252 | `loadMapMonths` | |
| `docs/list.html` | 6960 | `ensurePermitMap` | every saved permit |
| `docs/map.html` | 4052 | `loadMapMonths` | the map's rows |
| `docs/map.html` | 6442 | `ensurePermitMap` | |

**There is no migration.** Saved lists persist permit *numbers* only;
`ensurePermitMap()` re-fetches row data from Socrata on every load and its own
comment states it is the only hydration path for saved permits. Permits saved
before this change pick up their current stage automatically.

`worker/seed-kv.js:272` also selects `permit_status` but feeds the closure and
profile seed, not any display surface. It is not touched.

## Rendering

Five surfaces across six render sites — the permit overlay is touched twice,
and `permitTable()` covers three surfaces on its own because the directory and
both saved-list views share it.

| Surface | Site | Treatment |
|---|---|---|
| Directory results, saved list on `index.html`, saved list on `list.html` | `permitTable()` Status cell | stage chip on a second line in `<span class="small">`, below the existing status text |
| Permit overlay | `pm-tagrow` | fourth chip, after status / type / cost |
| Permit overlay | "Permit details" `pmFacts` block | a `Stage` row carrying the **verbatim** city value |
| GC / open-sub card | `cardPermitTableHtml()` Permit cell | chip below the existing status text |
| Map side list | `renderMapSideList()` | chip in the row |
| Map detail | `mapPermitDetails()` | chip plus verbatim value |

The Status column keeps `permit_status` as its primary value and stays the
sortable key. Stage sits underneath it, which is the idiom already used twice
in this table — `permit_type` under the permit number, `work_type` under the
address. No column is added, so the mobile stacked layout gains one line, not
one labelled row.

Every chip carries `title="<verbatim permit_milestone>"`.

### Visual treatment

A colour per stage, drawn entirely from existing tokens — no new palette:

| Stage | Text | Background |
|---|---|---|
| Fee due | `--teal` | transparent, `--teal` border |
| Not started | `--muted` | transparent, `--line` border |
| In progress | `--primary` | `--primary-soft` |
| Finishing | `--accent` | `--accent-soft` |
| Halted | `--danger` | `--danger-soft` |
| Complete | `--muted` | transparent, `--line` border |
| Ended early | `--warning` | `--warning-soft` |

`--teal` is already defined in both themes and is used by no other chip, so
Fee due costs no new token. It takes the outlined treatment because there is
no `--teal-soft`, and adding one to fill a 632-permit stage is not worth a
palette change.

`Halted` and `Ended early` are deliberately different colours. Halted is an
open permit whose work has stopped and can resume; Ended early is a permit
that is over. Collapsing them onto `--danger` would say those are the same
situation. `Complete` shares the neutral treatment with `Not started` — both
are states where there is nothing happening and nothing to chase — and they
never appear in the same list in practice, since one is open-only and the
other closed-only.

Measured contrast, both themes:

| | Fee due | Not started | In progress | Finishing | Halted | Complete | Ended early |
|---|---:|---:|---:|---:|---:|---:|---:|
| Light | 6.02 | 6.32 | 6.77 | **4.80** | 5.95 | 6.32 | 4.89 |
| Dark | 10.32 | 8.51 | 6.95 | 7.35 | 7.03 | 8.51 | 9.38 |

All fourteen pairs clear 4.5:1. The transparent-background chips were also
measured against `--row-alt`, since `permitTable` stripes its rows: Fee due
holds at 5.90 light / 10.64 dark, Not started and Complete at 6.20 / 8.77.
Finishing (4.80) and Ended early (4.89), both in light mode, are the tightest
pairs and the ones to re-measure if the chip's font size ever drops.

**No icons.** The obvious way to satisfy "never meaning by colour alone" is a
glyph, but this app's Material Symbols font renders ligature names as literal
text until it loads — the FIX-027 failure. The stage label is always spelled
out, so the text itself carries the meaning and colour is redundant
reinforcement. Green and red appear on the same axis, but never as the only
distinction.

## Testing

- `worker/test/stage-map.test.mjs` — parse the table from all three HTML
  files, assert deep equality. Red if any copy drifts.
- Mapping unit coverage: all 11 open milestone values; all 7 `permit_status`
  values; the closed-status-with-open-milestone case (`EXPIRED` +
  `INSPECTIONS` must give **Ended early**, never In progress — this is the
  13,973-permit trap); and `null` status with `null` milestone, asserting no
  chip. An unrecognised string in either field must also produce no chip
  rather than throwing.
- Worker test: `permit_milestone` survives `selectCols` into the response row.
- Headless verify at desktop **and** iPhone 13, asserting chip geometry and
  that the Status cell's second line does not overflow — geometry, not DOM
  presence, per the standing instruction.
- Mutation controls: break the mapping table, drop the field from one
  `$select`, and reorder the resolution so milestone is consulted before
  status on a closed permit; each must turn a test red.
- `ui-ux-pro-max` second pass before landing.

## Out of scope

- **Stage filtering.** Follow-on card FEAT-047: four toggle chips on the map,
  built on the FEAT-040 visited/called chip pattern, persisted in map settings
  per FIX-035, with counts computed before the exclusion is applied.
- **Sorting by stage.** Alphabetical ordering of the raw value is meaningless
  (`CERTIFICATE…` sorts before `INSPECTIONS`); a useful order needs a SoQL
  `CASE`. `permit_status` remains the sortable key.
- **Stage filters in the directory and the GC/open-sub card.** The directory
  pages server-side, so a client-side filter would desynchronise it from
  `total` — the FEAT-044 failure. It would have to move into the SoQL
  where-clause.
- **Milestone dates.** The field is current state only; there is no
  `milestone_date`, so "how long has this been in inspections" is
  unanswerable from the dataset. Obtaining it means observing transitions
  across daily seeds, the way `closure.js` already observes close time. That
  is its own feature.
- **Map pin colour**, which stays on GC open-job count.

## Sources

- [Building Permits — `ydr8-5enu`](https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu/data)
- [Chicago Cityscape Building Permits Browser](https://www.chicagocityscape.com/permits)
- [City of Chicago — Certificates of Occupancy](https://www.chicago.gov/city/en/depts/bldgs/supp_info/certificate-of-occupancy.html)
