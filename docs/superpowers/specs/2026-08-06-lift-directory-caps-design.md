# Lift the directory result caps (FEAT-040)

**Date:** 2026-08-06
**Status:** design, awaiting approval
**Branch:** `feat-040-lift-directory-caps`

## Problem

Three directories on `docs/index.html` silently serve a truncated slice of the
dataset. Measured 2026-08-06 against the live Worker and Socrata:

| Directory | Real total | Served | Missing | Where |
|---|---|---|---|---|
| General contractors | 5,790 | 5,000 | 790 (13.6%) | `worker/src/profiles.js:42` |
| Open subs (`open_tech`) | 7,431 | 5,000 | 2,431 (32.7%) | same line |
| Open permits | 40,785 | 1,000 | 39,785 (97.5%) | `worker/src/permits.js:34` |

All three truncate **silently**: the UI shows no indication that results were
cut, and the permits pager reports "Page X of Y" computed from the truncated
array, so `Y` is wrong and the last page looks like the end of the data.

These are three different mechanisms and need two different fixes.

## Findings that shape the design

**Profiles are already fully cached.** `profiles.js` computes
`total: rows.length` *before* `rows.slice(offset, offset + limit)`. KV already
holds all 5,790 GCs and all 7,431 subs. The 5,000 is purely an output filter
discarding rows that are already in memory. **No re-seed and no ingest change is
required** — this is a one-line fix on each side.

**Permits are a live Socrata proxy.** `/api/permits` passes `$limit` straight
through, returns **no `total` field at all**, and applies every filter
(`q`, `ward`, `cost_min/max`, `type`, `status`, `contact_name`) server-side in
SoQL. The endpoint already accepts `offset` — it is paging-ready except that
nobody can page without knowing the total.

**The pager already exists.** `index.html:5751-5791` implements Prev/Next over
`state.filteredRows` with a "Page X of Y · N per page" label and correct
disabled states. It needs a different denominator, not a rewrite.

**Permits-mode sorting is the column-header sort, not the `#sort` dropdown.**
The `#sort` `<select>` (`index.html:3281`) lists only profile fields
(`open_jobs`, `total_jobs`, `open_age_avg_days`, `avg_processing_days`,
`latest_issue_date`, `reported_cost`) and is inert in permits mode — the FIX-026
trap. Permits sort through `state.resultSort.key`, set by `sortHeader(label, key)`
with keys `permit_number`, `permit_status`, `issued`, `address`, `cost`.

## Decisions

1. **Permits are reachable, not resident.** The browser holds one page; the
   server knows the total. Rejected: fetching all 40,785 rows (~2KB/row across
   91 selected columns ≈ 80MB, ~41 sequential Socrata requests).
2. **Sorting moves into SoQL `$order`.** Client-side sorting over a server-paged
   result set would sort only the current page — "most expensive" would mean
   "most expensive of the 150 on screen". This is the same silent-truncation bug
   class the FEAT-021 comment in `permits.js:29-31` already documents for the
   cost filter.
3. **The per-request 1,000 cap stays.** It is a reasonable page-size guard. It
   was only a bug because it doubled as the total.

## Design

### 1. Profiles: remove the ceiling

`worker/src/profiles.js:42` — drop the `Math.min(..., 5000)` clamp, keeping a
default for callers that pass no limit. `docs/index.html:3654` — stop sending
`limit=5000`.

Both directories then load complete (7,431 rows worst case, same order of
magnitude as today's 5,000). Client-side sort and filter over profiles are
unaffected and stay as they are.

### 2. Permits: the Worker learns to count and to order

`worker/src/permits.js` gains:

- **`total`** — a `count(1)` query against the identical `$where`, returned
  alongside `rows`. The where-clause must be built once and used by both queries;
  a divergence makes the pager lie.
- **`sort`/`dir` params** — mapped through an allowlist to `$order`:

  | Client key | SoQL `$order` |
  |---|---|
  | `issued` | `issue_date` |
  | `cost` | `reported_cost` |
  | `permit_number` | `permit_` |
  | `permit_status` | `permit_status` |
  | `address` | `street_name, street_number` |
  | (none) | `issue_date DESC` (today's behaviour) |

  An unrecognised key falls back to the default and must never be interpolated
  into SoQL. `dir` accepts only `asc`/`desc`.

  `address` is a composite with no single Socrata column; ordering by
  `street_name, street_number` is a deliberate approximation. `street_number` is
  a text column in the source, so numeric ordering within a street is
  lexicographic ("100" sorts before "99"). Accepted; noted in the spec so it is
  not rediscovered as a bug.

- **`processing_time > 0`** — the "usable processing only" toggle currently
  filters client-side at `index.html:3914`, after fetch. Under paging that would
  shrink pages unpredictably and desynchronise the count. It moves into the
  SoQL where-clause as a new `usable_processing=1` param.

### 3. Client: fetch a page, not a prefix

- `search()` sends `offset`, `limit = state.pageSize` (150), the sort key and
  direction, and `usable_processing`. It stores `{rows, total}`; `state.permitTotal`
  becomes the pager denominator.
- `changePage()` becomes `async` and refetches at the new offset instead of
  slicing a local array.
- `toggleColumnSort()` in permits mode resets to page 0 and refetches.
- `pageCount()` and the result-count label read `state.permitTotal` in permits
  mode, `filteredRows.length` in contacts mode.
- The existing `state.searchToken` guard must wrap the paged fetches too, or a
  slow page-2 response can overwrite a newer page-1 render.

Contacts mode keeps its current fully-resident, client-sorted behaviour.

## Testing

Unit (`worker/test/permits.test.mjs`):
- an unmapped `sort` key falls back to the default and does not reach `$order`
- `dir` rejects anything but `asc`/`desc`
- the count query and the rows query are built from the same where-clause
- `usable_processing=1` adds `processing_time > 0`

Integration:
- page N+1 shares no `permit_` with page N for each sort key
- `total` matches a direct Socrata `count(1)` for a filtered and an unfiltered query

Headless (`verify-tmp/`):
- the pager reads "Page 1 of 272" (or current equivalent) rather than "of 7"
- Next advances and renders different permits
- sorting by Cost DESC puts a permit costlier than anything on page 1 of the
  default sort at the top — proves the sort spans the dataset, not the page
- desktop and iPhone 13 viewports, per the standing `ui-ux-pro-max` rule

## Out of scope

- `docs/data/*.json` — 66MB of files (`open_permits.json` 28MB,
  `general_contractors.json` 21MB, `contractor_licenses.json` 10MB,
  `open_subs.json` 7MB) that no page reads since the Worker migration. Dead
  weight worth deleting, but a separate change.
- `map.html`'s own data path and the `$limit: "50000"` Socrata calls at
  `index.html:4027` and `:5250` — different code paths, not part of this cap.
- Any ingest or KV re-seed. Not required; see Findings.
