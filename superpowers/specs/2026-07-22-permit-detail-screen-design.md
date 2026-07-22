# Permit Detail Screen — Design Spec

**Date:** 2026-07-22
**Scope:** `docs/list.html` and `docs/index.html` (client only; no Worker or data-pipeline change).
**Goal:** Replace the inline "Details" dropdown in **My Permit List** with a
dedicated permit detail **screen** that opens over the list — a centered modal
on desktop, a full-screen sheet on mobile — and make the permit views in the
**Search Directory** match its style and fields.

## Summary

Today a saved permit's extra info expands **inline, directly under the row**
(`.permit-more-body`, mobile only), while desktop spreads a subset across table
columns and a separate side panel (`#detail-panel` via `showPermitDetail`)
handles the search side. This spec unifies all of that into **one section-based
renderer**, `permitDetail(row)`, presented as an overlay:

- **Desktop:** centered modal card + dimmed backdrop over the list.
- **Mobile:** full-screen sheet.

The same renderer is used by the saved list *and* the Search Directory permit
views on both pages, so every permit view looks and reads the same.

Wireframe (approved): the desktop-modal / mobile-sheet mock with the exact
field set and section order this spec describes.

## Trigger and dismissal

- **Open:** clicking a saved permit row opens the detail overlay. The current
  inline `.permit-more-*` toggle and its cell are **removed**. Controls inside a
  row that must not open the detail (remove button, checkbox, notes textarea,
  move buttons, address maps-menu) keep their existing `event.stopPropagation()`.
- **Close:** the ✕ button, backdrop click (desktop), the `Esc` key, and the
  mobile back gesture. Reuse the existing `showDetail(html, pushHistory)` /
  `closeDetail()` history pattern so the phone back button closes the overlay
  rather than leaving the page.

## Presentation and animation

- One overlay markup, two layouts driven by a CSS breakpoint (reuse the site's
  existing mobile breakpoint, ~640px). Desktop = centered `role="dialog"`
  `aria-modal="true"` card with backdrop; mobile = full-bleed sheet.
- **Animated open and close on both viewports:** fade + small rise on desktop,
  slide-up on mobile. All motion is wrapped in
  `@media (prefers-reduced-motion: no-preference)`; reduced-motion users get an
  instant show/hide.
- **Scroll integrity (explicit requirement):**
  - Lock background scroll while open by adding a class to `<body>` that sets
    `overflow: hidden`; remove it on close. Restore the list's prior scroll
    position on close.
  - The overlay has its **own** internal scroll container (`overflow-y: auto`)
    so long content scrolls within the modal, never the page behind it.
  - Opening/closing must not cause the list to jump or double-scroll.

## Content — sections and order

Rendered as an ordered list of section builders (see "Extensibility"). Missing
values render as an em-dash (`—`); empty contractor lists render "None listed".

1. **Header** — permit number; a pill row of status / permit type / reported
   cost; an **Add to list / ✓ Saved** button (disabled when already saved).
2. **Location**
   - Address
   - Neighborhood (= `community_area`; keep the site's existing "Neighborhood"
     label — this replaces index.html's current "Community area" label for parity)
   - Zone *(on-demand geo lookup; see Data)*
   - TIF district *(on-demand geo lookup)*
3. **Permit details**
   - Issue date
   - Permit type
   - Status
   - **Building type** — best-effort, parsed from `work_description`; always
     shown with an **"approx."** badge and a tooltip stating it is guessed from
     the work description and is not an official field. When nothing is parsed,
     show `—` (no badge).
   - Review type
   - Work type
   - Processing time (days)
4. **Work description** — full text.
5. **Costs & fees**
   - Reported cost
   - Total fee
6. **General contractors** and **Open subs** — one entry per contractor:
   - Name
   - **License type** — the trade from the matched license (e.g. "General
     Contractor", "Electrical Contractor (General)", "Plumbing Contractor",
     "Mason Contractor"). "License not matched" when there is no registry match.
   - **Class** — A–E, parsed from the license type string when present
     (e.g. "General Contractor (Class E)" → Class E); omitted when the license
     has no class.
   - Open-jobs count and a tap-to-call phone link; "no phone on file" when the
     match has no non-`NA` phone. (Fetched on demand from the Worker
     `/api/contact/:name?category=…`, exactly as the current dropdown does.)
7. **Notes** — a section is reserved and rendered now as a **stub** (flagged
   "built out this session"). Wiring the editable note into this screen is a
   follow-up task in the same session (see "Notes: preservation and this-session
   build-out").

## Data — what is available and how each field is filled

Verified against the live data sources on 2026-07-22:

- **From the permit row (already present):** permit number, status, permit type,
  issue date, address, `community_area` (Neighborhood), ward, review type, work
  type, work description, processing time, reported cost, total fee.
- **Zone / TIF district:** on-demand Socrata geo lookups, reusing the existing
  `geoZoneCache` / `geoTifCache` and their fetch path. Show `…` while loading,
  resolved value or `—` after.
- **Building type:** **best-effort regex over `work_description`** for patterns
  like `N-unit`, `two/three/four-flat`, `single family`, `apartment`,
  `townhome`, `condo`, `mixed use`. This is heuristic and frequently absent —
  hence the mandatory "approx." badge. No new data source is introduced.
- **Contractors (License type, Class, open jobs, phone):** the Worker
  `/api/contact/:name?category=general_contractor|open_tech` already returns
  `open_jobs` and `license_matches[]`, where each match carries `license_type`
  (e.g. `"General Contractor (Class E)"`), `license_number`, `phone`,
  `license_expiration_date`. Frontend derives:
  - License type = `license_type` with any `"(Class X)"` suffix stripped.
  - Class = the `X` captured from `"(Class X)"`, if present.
  - Phone = first `license_matches[].phone` that is truthy and not `"NA"`.

**No field shown is fabricated.** Building type is the only heuristic value and
is always labeled as approximate.

## Extensibility (future features will be added to this view)

`permitDetail(row)` is built from an **ordered array of section builders**, each
a small function `(row) => htmlString | ""` (returning `""` when a section has
nothing to show). Adding a future field or section is a one-line insert into the
array — no change to the open/close, scroll-lock, or history machinery. The
overlay shell (header, scroll container, close controls, animation) is separate
from the section content.

## Search Directory parity

The current per-page detail renderers — `showPermitDetail()` in **list.html**
(around line 6048) and its twin in **index.html** (around line 5228), both
rendering into `#detail-panel` via `showDetail`/`detailShell`/`closeDetail` —
are replaced so they render the **same section set** as the saved-list overlay
and use the same overlay presentation. The search side gains License type /
Class on contractors and the "Neighborhood" label; the two pages stay in sync.

`index.html` and `list.html` each keep their own copy of the renderer (the site
has no shared JS module system today); the two copies are kept identical. Any
divergence is a bug.

## Notes: preservation and this-session build-out

**Preservation (hard requirement — must not lose existing notes):**

- Per-permit notes are stored in `localStorage` under the key
  **`chi_permit_user_notes`**, as JSON `{ "permits": { "<permitNumber>": "note" } }`,
  loaded into `state.userPermitNotes` and written by `savePermitNote()`.
- This rework **must not** change that key, its JSON shape, or the
  load/`savePermitNote` path. The saved-list row keeps its existing notes
  `<textarea>`. Notes the user has already typed on the live site survive the
  update untouched.

**This-session build-out:** the Notes **section inside the detail screen** binds
to the *same* `state.userPermitNotes` / `savePermitNote` so editing a note in
the overlay and in the row stay in sync through the one existing store. Delivered
as a follow-up task after the overlay lands; until then the section renders as a
stub.

## Route info stays in the list (unchanged)

The per-permit **route leg / drive-time** info stays **inline under each permit
in My Permit List** (its current `routeLegText(row)` placement). It is **not**
moved into the detail screen.

## Accessibility & polish (via ui-ux-pro-max during build)

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the permit number.
- **Focus management:** move focus into the overlay on open; **trap** focus
  within it; on close, **restore focus to the permit row** that opened it.
- `Esc` closes; visible keyboard focus rings; backdrop is not a focus trap gap.
- Tap targets ≥ 44px; contrast verified in **both** light and dark themes
  (the page's existing `chi_permit_theme` tokens).
- `tel:` links keep the tap-to-call behavior.

## Out of scope

- Any Worker, ingest, or `export-static` change.
- A real property/units data source for Building type (possible future feature).
- Moving route/drive info into the detail screen.
- Changing the notes storage key/format or the shareable-list payload.

## Acceptance criteria

1. Clicking a saved permit opens the detail as a centered modal (desktop) /
   full-screen sheet (mobile); the old inline "Details" dropdown is gone.
2. Open and close are animated on both viewports and respect
   `prefers-reduced-motion`.
3. Background scroll is locked while open and the list position is preserved on
   close; the modal scrolls internally with no double-scroll or jump.
4. All listed sections/fields render in the specified order, with `—` for
   missing values and the "approx." badge on Building type.
5. Contractors show License type + Class (when present) plus open jobs and a
   working tap-to-call link (or "no phone on file").
6. The Search Directory permit views (index.html + list.html search side) render
   the identical section set and presentation.
7. Existing `chi_permit_user_notes` are intact after the update; notes edited in
   the overlay and in the row stay in sync.
8. Dialog is keyboard-operable (focus trapped, `Esc` closes, focus restored to
   the trigger) and legible in both themes.
