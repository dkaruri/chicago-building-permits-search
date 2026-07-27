# Contractor detail view — design

Date: 2026-07-27
Pages: `docs/index.html` (Search Directory), `docs/list.html` (My Permit List)
Also touches: `worker/src/profiles.js`, `worker/seed-kv.js`

## Problem

A permit's General Contractors and Open Subs render as dead text inside the
permit detail overlay (`contractorLinesHtml`, index.html:5674 / list.html:6859).
A contractor profile exists, but only on `index.html`, and only in the page's
right-hand detail pane (`renderContactDetail`) — a different surface with a
different look. There is no way to go permit → contractor → that contractor's
other permits, and no way back. Neither page remembers where the user left off:
`index.html` persists nothing but the theme, `list.html` persists only
list-vs-directory (`chi_permit_last_view`).

## Goals

1. Tapping a GC or Open Sub in the permit overlay opens a **contractor card in
   that same overlay**, styled and animated exactly like the permit card.
2. Tapping a permit inside a contractor card opens that permit's card.
3. Forward and back through the resulting stack, via an in-overlay `‹` button
   **and** the browser/phone back gesture.
4. Identical behaviour on `index.html` and `list.html`, desktop and mobile.
5. Contractor data is fetched from the API per card, never read from an
   already-loaded search snapshot.
6. Both pages restore where the user left off.

## Non-goals

- Restoring the overlay itself on reload (decided: page position only).
- Any change to `map.html`, which has no permit overlay.
- Replacing `index.html`'s existing detail pane — it stays as-is.

## Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | Contractor card carries **full parity** with `renderContactDetail`: stat pills, license, specialties, open-permits table *with* its 4 filters and paging, associations | A trimmed contact card; a card that punts to the pane via a "See all permits" button |
| 2 | Browser back **steps one card**, closing only at the bottom of the stack | Back closes the whole overlay from any depth (today's behaviour) |
| 3 | Restore tab / query / sort / page / scroll / selection, but **not** the overlay | Restore the overlay stack too; restore only tab + query |
| 4 | Name matching tries exact → other category → normalized, then renders `No profile on file` | Exact-only; fuzzy-but-silent |
| 5 | Typed **card-stack descriptors**, re-rendered on navigation | Reusing `state.detailHistory`, which stores rendered HTML snapshots |
| 6 | Contractor data always fetched from the API | Reading the row out of `state.visibleRows` (absent on list.html) |
| 7 | KV aggregates shown with a `Profile data as of <date>` line | Showing them unqualified; dropping them for live-only fields |
| 8 | Header actions: `📞 Call` primary when a phone exists, `Add all N to list` secondary | Call only; add-all only |

## Architecture

### Card stack

```js
state.cardStack = [];   // descriptors, oldest first
state.cardIndex = 0;
```

Descriptor shapes:

```js
{ type: "permit",  row }
{ type: "contact", name, role, profile, permits, relatedError, matchedAs }
```

`role` is `general_contractor | open_tech`. `profile` and `permits` are filled
after fetch and cached on the descriptor, so stepping back is instant and never
re-fetches.

Three functions, all inside the block that is byte-identical across
`index.html` and `list.html`:

- `pushCard(desc)` — drop any forward entries, push, render, `history.pushState`.
- `popCard()` / `forwardCard()` — move `cardIndex`, re-render from the descriptor.
- `renderCard()` — dispatch on `type` to `permitDetailHtml(row)` or
  `contactDetailHtml(desc)`, set the body, run that type's `onOpen` hooks
  (`fillPermitContractors` + `fillPermitGeo` + `fetchThread` for permits;
  `fillContactCard` for contacts).

`openPermitDetail(row)` becomes `pushCard({type:"permit", row})` on a fresh
stack. `state.activeDetail` becomes an alias for `cardStack[cardIndex]` so
existing readers keep working unchanged.

Descriptors, not HTML snapshots: the contractor card re-renders on every filter
change, and `onOpen` hooks cannot survive a snapshot. This is why
`state.detailHistory` is not reused.

### Contractor card anatomy

Same shell as the permit card, class for class:

| Permit card | Contractor card |
|---|---|
| `.pm-head` — `.k` "Permit", `.v` number, primary "Add to list", 44px `.pm-close` | `.pm-head` — `.k` "General contractor" / "Open sub", `.v` name, `📞 Call` primary + `Add all N to list` secondary, same `.pm-close` |
| `.pm-tagrow` of `.pm-tag` pills | `.pm-tag` pills: open jobs (live), total jobs, avg processing days, usable timing records, reported cost |
| `.pm-block` + uppercase `h3` + `.pm-facts` | `.pm-block` sections: License, Specialties, Open permits, Associations |

The pane's version uses `.tag` and `<h3>/<h4>`; in the overlay the same data
goes through `.pm-tag` / `.pm-block` / `.pm-facts` so the two card types are
visually indistinguishable.

Back affordance: a 44px `‹` button at the left of `.pm-head`, styled like
`.pm-close`, rendered only when `cardIndex > 0`. `aria-label="Back to <previous
card title>"`.

**Header at 390px.** A long company name plus two buttons will not fit one row.
The header stacks on mobile: title row (`‹`, `.pm-title`, `✕`), then a full-width
button row beneath. Desktop keeps one row. The `Add all N` button is omitted
entirely when the card has zero open permits.

### Animation

`.permit-modal-card` animates once on open via `permitRise 0.24s ease`
(opacity + `translateY(14px)`), gated behind
`@media (prefers-reduced-motion: no-preference)`. Pushing a card currently swaps
`innerHTML` with no motion.

Replay the same keyframe on `.permit-modal-body` per navigation: `permitRise` on
push, a mirrored `permitFall` (from `translateY(-14px)`) on back. Same duration,
same easing, same reduced-motion gate — under `reduce` both are absent, as the
card entry already is. The card frame never re-animates, so a push does not read
as the modal reopening.

Mobile keeps `100vw / 100dvh`; `.permit-modal-body`'s `flex:1; min-height:0`
(the 2026-07-27 iOS fix) is what lets a long contractor card scroll rather than
clip.

## Data flow

Opening a contractor card fires two requests in parallel, both cached on the
descriptor:

| Need | Source | Freshness |
|---|---|---|
| Open permits table, Associations | `GET /api/permits?contact_name=…&limit=200` | live Socrata proxy |
| Open-jobs count | derived by counting live rows after exact-name filtering | live |
| Total jobs, avg processing days, reported-cost total, license matches + phone, specialties | `GET /api/contact/:name?category=` | KV, last `seed-kv.js` run |

Open-jobs is derived live rather than read from KV's `open_jobs`; where the two
disagree, live wins.

`contact_name` is a substring `LIKE` across all 15 contact slots, so `ACME` also
returns `ACME PLUMBING`. The card filters returned rows to an exact normalized
name on the matching role before counting and before drawing the table.

Failure handling: if `/api/permits` fails, the card still renders with the
profile block and an inline message in place of the table (mirrors
`selectContact`'s existing `relatedError`). If `/api/contact` 404s or the Worker
is unreachable, the card renders live permits only, with the aggregate pills
omitted and a `No profile on file` line — never a half-filled pill row.

## Name matching

Implemented in the Worker's `handleContactDetail`, not the client: ~15 lines
there, versus every client downloading a 5,000-row category list to match
locally. `list.html` never loads that list at all.

Ladder: exact (case-insensitive) → other category → normalized. Normalization
strips punctuation, collapses whitespace, and drops a trailing corporate suffix
(`INC`, `LLC`, `CO`, `CORP`, `LTD`).

The response gains `matched_as` and `matched_category`. When `matched_as`
differs from the requested name, the card shows a muted
`matched as <name>` line, so a fuzzy hit is never passed off as an exact one.
A total miss returns 404; the contractor row renders `No profile on file` and is
not clickable.

**Deploy order: Worker first, then Pages.** The client depends on
`matched_as`/`matched_category` that an undeployed Worker will not return.

## Staleness

`seed-kv.js` writes a `profiles:<category>:seeded_at` ISO timestamp alongside
each category. `handleContactDetail` returns it as `seeded_at`. The card renders
a muted `Profile data as of <date>` line directly beneath the aggregate pills.
When the timestamp is absent (KV seeded before this change), the line is omitted
rather than guessed.

## Persistence

`chi_permit_last_view` grows from a bare string into:

```js
{ view, tab, q, sort, page, scroll, selected }
```

- `view` — existing `list | directory` (list.html only).
- `tab` — `open_permits | general_contractors | open_subs` (index.html).
- `q`, `sort`, `page`, `scroll` — search box, sort key, page index, scroll offset.
- `selected` — `{name, role}` of the profile in the detail pane, reopened on load.

Written debounced at 400ms; read in `init()`. Migration: a plain-string value is
read as `{view}`. `index.html` adopts the same key, which it does not use today.
A `#s=` share link still wins over a restored view, as it does now. The overlay
is deliberately not restored.

## Testing

**Worker** — added to the existing 99 tests in `worker/test/`:
- matching ladder: exact hit, cross-category hit, normalized hit, total miss
- `matched_as` / `matched_category` present and correct on a fuzzy hit
- `seeded_at` passthrough, and its absence handled

**Client** — `verify-tmp/` Playwright specs, run at desktop **and** iPhone 13
(390×844), on both pages:
- push/pop/forward to depth 3; back at depth 0 closes the overlay
- filter changes inside a contractor card do not push history entries
- `Add all N` adds exactly the filtered rows
- a contractor with no profile is non-clickable and labelled
- restore-on-reload for tab, query, sort, page, scroll, selection
- `ui-ux-pro-max` checklist per `CLAUDE.md`: ≥44px targets, labelled controls,
  focus states, 4.5:1 contrast in both themes, no sub-16px inputs,
  reduced-motion respected

**Invariant** — the shared overlay block must stay byte-identical between
`index.html` and `list.html`; verify with a byte-diff of the block before
landing. Stage `list.html` with `git -c core.autocrlf=false add` (CRLF blob).

## Phasing

Three phases, each independently shippable. Per the standing instruction,
confirm before starting each one.

1. **Card stack + contractor card** (client only, both pages). Uses
   `/api/contact` exactly as it behaves today. No Worker deploy needed, so this
   phase reaches Pages on its own.
2. **Matching ladder + `seeded_at`** (`worker/src/profiles.js`,
   `worker/seed-kv.js`, plus the client lines that render `matched as …`,
   `No profile on file`, and the `Profile data as of` note). **Worker deploys
   before Pages.**
3. **Persistence / restore** (client only, both pages).

Phase 1 is the bulk of the work; phases 2 and 3 are small and independent of
each other.

## Risks

- **Header crowding at 390px** with a long company name and two buttons —
  mitigated by the stacked mobile header; verify with the longest real name in
  the dataset, not a placeholder.
- **Substring over-fetch**: a very common name fragment could return many
  irrelevant rows within the 200-row cap, so exact-name filtering could leave a
  short table while more matches exist beyond the cap. Accepted for now; the
  count is labelled from the filtered set, never from `row_count`.
- **KV/live disagreement** is visible by design (live open-jobs beside a dated
  profile line) rather than hidden.
