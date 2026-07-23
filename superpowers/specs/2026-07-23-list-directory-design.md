# List Directory — design

**Date:** 2026-07-23
**Status:** Approved for planning
**Supersedes:** parts of `2026-07-20-shareable-lists-design.md` (share links stay; the single-list assumption goes)
**Wireframe:** ten-screen prototype, published as an artifact during design

Reworks "My Permit List" from one browser-local list into a directory of many named
lists, publicly published and publicly editable, with permit notes anyone can post.

---

## 1. Problem

`list.html` holds exactly one saved list in `localStorage` under `chi_permit_user_list`.
Sharing (shipped 2026-07-20, live) writes that list to Workers KV and returns a short
`#s=<id>` link, but the recipient can only *replace* their own list with it. There is no
way to keep several lists, no way to find a list you did not receive a link to, and no
way to see what anyone learned about a permit.

Notes have the same shape problem: `chi_permit_user_notes` is private to one browser, so
field intelligence dies where it was typed.

## 2. Goals

- Many named lists per browser, with one active concept removed entirely.
- A public directory of every published list, searchable and filterable by tag.
- Lists carry title, description, author, published date, and color-coded tags.
- Notes become public, timestamped posts attached to a permit and visible everywhere
  that permit appears.
- Structured site-visit capture (the walkthrough form) and photos as post kinds.
- Hand-typed stops for addresses the city data does not have.
- The existing share link `#s=YnF7y4t` keeps working and keeps its data.

## 3. Non-goals

- User accounts, login, or identity verification. Author is unverified free text.
- Moderation gates on any write. See §11.
- Changing how permits are searched, mapped, or ingested.
- Preserving KML export (removed, see §6.2).

## 4. Decisions

Recorded because each was a fork with a real alternative.

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| D1 | Everything shared is public | Opt-in publish | User wants a browsable commons, not private links |
| D2 | Anyone can edit anything (wiki) | Owner tokens, accounts | No signup friction; user accepted the abuse trade |
| D3 | Revision history + revert as the only guardrail | Turnstile, IP rate limit | Makes cleanup cheap without adding friction |
| D4 | Notes are global to the permit | Scoped to the list | A permit's intel should follow the permit into search and map |
| D5 | Private draft + explicit Post | Everything typed is public | Nothing goes public by accident; existing notes survive untouched |
| D6 | Notes edited only in the detail overlay | Keep the desktop table textarea | One note surface instead of two to keep in sync |
| D7 | Picker on every "Add to list" | One active list | No hidden state to drift across three pages |
| D8 | Directory lives in `list.html` | New `lists.html` | No fourth 6,000-line page |
| D9 | Tag colors are 10 fixed slots, light+dark pairs | Free hex | Free hex fails contrast in dark mode (§5.3) |
| D10 | Directory index rides on KV metadata | Separate `dir:index` key | A separate key can desync; metadata cannot |
| D11 | 220-permit cap is per list | 220 total across lists | User's call |
| D12 | Visited checkbox is shared on the list | Private per browser | It exists to coordinate a team |
| D13 | Custom stops are full routing participants | List-only placeholders | A hand-added stop is exactly what you want on the route |
| D14 | Photos fully open, no review | Hold queue, AI screening | User's call, made after the risk was stated (§11) |
| D15 | Walkthrough uses one contact block, not two branches | Literal two-branch form | Both branches asked identical fields |
| D16 | Estimate turnaround is a fixed set | Free text | Answers stay comparable across permits |

## 5. Data model

### 5.1 Workers KV — `list:<id>`

The value carries everything; the **metadata** carries what the directory needs.
`KV.list()` returns keys with their metadata in one call, so rendering the directory
costs one operation rather than one `get()` per list. Both are written by a single
`put()`, so there is no second key to half-fail (D10).

```jsonc
// VALUE
{
  "v": 2,
  "p": ["101082609", "B200475676"],        // unchanged from v1
  "f": { "lat": 41.972, "lon": -87.719, "label": "5010 N Monticello" },
  "desc": "Hundred open permits…",
  "custom": [                               // §7
    { "id": "c_3f1a", "pos": 3, "addr": "3701 W Ainslie St",
      "lat": 41.9721, "lon": -87.7203, "use": "residential",
      "work": "Gut rehab", "gc": "" }
  ],
  "ticks": { "101082609": 1, "c_3f1a": 0 }  // §8
}

// METADATA (<=1024 bytes)
{
  "title": "North Side Roof Runs — July",
  "author": "Divyam Karuri",
  "blurb": "Hundred open permits with…",    // first 160 chars of desc
  "tags": [["roofing", 0], ["north side", 4]],
  "count": 100,
  "publishedAt": 1753228800,
  "editedAt": 1753401600,
  "rev": 3
}
```

Metadata budget: title 80 + author 40 + blurb 160 + tags ~120 + numbers ~60 ≈ 460 bytes.
The writer truncates `title` to 80 and `blurb` to 160 and drops tags past 8 to stay inside
1024 under worst-case UTF-8.

### 5.2 Other KV keys

| Key | Value |
|---|---|
| `listrev:<id>:<n>` | Prior version of a list value. Last 20 kept. |
| `note:<permitNumber>` | Array of posts (§9). Metadata `{ n: <count> }`. |
| `tag:<name>` | `{ slot: 0..9, uses: 12 }` — the color registry (§5.3) |

A tag's slot is stored twice on purpose: in `tag:<name>` as the source of truth, and
denormalized into each list's metadata so the directory renders without an extra read per
tag. A recolor updates the registry and is picked up by lists lazily on their next write;
until then a recolored tag may show its old slot on stale cards. Accepted — it is a color,
not data.

### 5.3 Tag color slots

A tag stores a **slot index 0–9**, not a hex. Each slot is a light/dark pair, so a tag
keeps its identity across themes without becoming unreadable. First list to use a tag
name claims its slot; anyone can recolor it for everyone, consistent with D2.

Free hex was rejected after measurement: `#b4232a` on the dark surface `#0c1726` gives
**1.9:1** against a 4.5:1 requirement.

| Slot | Name | Light | On `#f8fbff` | Dark | On `#0c1726` |
|---|---|---|---|---|---|
| 0 | red | `#b3261e` | 6.30 | `#ff9d9b` | 9.05 |
| 1 | orange | `#8f4700` | 6.59 | `#f0a95c` | 9.03 |
| 2 | olive | `#5c6300` | 6.25 | `#c9d15a` | 10.93 |
| 3 | green | `#146c43` | 6.21 | `#62d991` | 10.16 |
| 4 | teal | `#0f6674` | 6.38 | `#6fd0e8` | 10.17 |
| 5 | blue | `#1f4fa3` | 7.48 | `#8eb8ff` | 8.96 |
| 6 | indigo | `#4338a8` | 8.54 | `#b0a8ff` | 8.48 |
| 7 | purple | `#6b3fa0` | 7.12 | `#d3a0ee` | 8.60 |
| 8 | magenta | `#9c2c74` | 6.69 | `#f39ac8` | 8.80 |
| 9 | slate | `#45566c` | 7.22 | `#b6c8dc` | 10.53 |

Selected-chip state (panel color on solid fill) measured separately: 6.45–10.50.

### 5.4 R2 — photos

`photo/<permitNumber>/<photoId>.webp`. Free tier is 10 GB with **zero egress cost**;
at ~250 KB per resized photo that is roughly 40,000 photos before any charge.

### 5.5 Browser `localStorage`

```jsonc
// chi_permit_lists — REPLACES chi_permit_user_list
{
  "lastUsed": "local_1",
  "lists": {
    "local_1": { "name": "North Side Roof Runs", "permits": [],
                 "focal": {}, "custom": [], "sharedId": "YnF7y4t" },
    "local_2": { "name": "Fire damage rebuilds", "permits": [] }
  }
}

// chi_permit_user_notes — UNCHANGED, still private
{ "permits": { "101082609": "Gate code 4412…" } }

// chi_permit_author — remembered posting name
"Divyam Karuri"
```

Migration from `chi_permit_user_list` runs once on load: the existing list becomes
`local_1` named "My Permit List", and the old key is left in place for one release as a
rollback path.

## 6. Directory and list view

### 6.1 Directory

`list.html` opens to the directory. Two sections: **My lists** (from `localStorage`,
marked `★ Mine`, showing Draft or Published) then **Published to the site** from
`GET /api/lists`. Search matches title, author and tags. Tag chips filter.

Pagination: page size 200. The Load more control renders only when the Worker returns a
cursor, which happens only once a page comes back full — matching the requested
"visible only if the count goes over 200".

KV list metadata is eventually consistent and can lag a write by up to a minute.
Publishing therefore navigates to the list itself, never back to the directory, so a user
never looks at a directory missing what they just made.

### 6.2 List view toolbar

Left to right: **Edit details** (`edit`) · **Optimize route** (`route`, primary) ·
**Share** (`share`) · **Export CSV** (`csv`) · **+ Add address**.

- *Sort by drive time* and *Route* are consolidated into **Optimize route**: fetch the
  duration matrix, run the existing 2-opt + Or-opt pass, reorder, measure legs, print the
  summary. Same two OSRM calls, one button, one stepped progress readout.
- **KML export is removed**, along with `downloadUserListKml`, `kmlPlacemarkDescription`,
  `toKmlColor` and the pin palette (commit `898d1f6`). Export is CSV with no menu.

### 6.3 Table columns

`✓ | # | Address | Permit | Use | Issued | Type | Notes | reorder`

The **Notes column textarea** (`docs/list.html:5896`) is deleted (D6). A note count chip
replaces it; the row opens the detail overlay.

**Use** is Residential / Commercial / Mixed use / Unclear, inferred from `permit_type`
plus `work_description` by the same kind of heuristic as `parseBuildingType`. The permits
dataset has **no occupancy field**, so every inferred value carries an `approx` badge, and
unsupported text yields `— Unclear` rather than a guess. Each label carries a glyph so the
distinction is not color-only.

### 6.4 Icons

`list.html` already loads Material Symbols. Every icon is appended to that one existing
`icon_names=` query — not added as separate `<link>` tags:

```
icon_names=add_photo_alternate,csv,database_search,edit,list,map_search,
           moon_stars,photo,policy,route,share,sunny
```

All icons are `aria-hidden` beside a real text label.

## 7. Custom stops

"+ Add address" captures an address the city data lacks. Typing an address has three
outcomes:

1. **Matches a permit** — offer the real permit instead of a hand-typed stub.
2. **No permit, geocodes** — added with coordinates, badged `✎ Added by hand`. Routes,
   exports and map links all work (D13).
3. **Will not geocode** — added anyway, holds its assigned position, badged
   `⚠ No location`. Excluded from the duration matrix, and the route summary says so
   rather than silently dropping it.

The entry form captures position, use, work description, optional GC, and an optional
first note. Detail view shows the typed fields in place of city data plus the full notes
thread; zone and TIF still resolve, since those derive from coordinates.

CSV gains a `source` column reading `permit` or `manual`. A custom stop never carries a
fabricated permit number — the field stays empty.

Custom stops travel in their own `custom` array so the permit-number path keeps its tight
`/^[A-Za-z0-9-]{1,16}$/` validation in `sanitizePermits`.

## 8. Visited checkbox

A checkbox per row, stored in `ticks` on the shared list (D12), so a team sees the same
state through one link. Deliberately unlabeled beyond "Visited" — the team assigns the
meaning.

Flipping one writes `PUT /api/lists/:id/ticks` with a single key, not a whole-list
rewrite. Writes are debounced 800 ms and coalesced. A ticked row strikes and dims its
address so the state is not carried by color alone.

## 9. Posts under a permit

One thread per permit number, three post kinds, rendered in the detail overlay on
`list.html`, `index.html` and `map.html`.

```jsonc
// note:<permitNumber>
[
  { "id": "n_8fa2", "kind": "text", "author": "Divyam Karuri",
    "text": "Roof crew on site…", "ts": 1753088040, "editedTs": null },

  { "id": "n_b104", "kind": "walk", "author": "Divyam Karuri", "ts": 1753270800,
    "job": "new",            // new | remodel
    "onsite": "sub",         // none | gc | sub
    "party": { "name": "A PLUS REFRIGERATION", "phone": "7735550142",
               "covers": "Electrical, HVAC", "jobs": 3, "estimate": "1-3d" },
    "gc": { "name": "606 CONSTRUCTION LLC", "phone": "3125550198" } },

  { "id": "n_c77e", "kind": "photo", "author": "M. Reyes", "ts": 1753192800,
    "text": "Dumpster out front…",
    "photos": [{ "id": "p_19d2", "caption": "Dumpster at the front of the property" }] }
]
```

### 9.1 Private draft, explicit post

The overlay's note box stays private, local and autosaved — `chi_permit_user_notes`
unchanged. **Post to permit** publishes a copy with author and timestamp (D5). Posting
announces via the existing `aria-live="polite"` region and moves focus to the new post.

A one-time **Post my saved notes** action in the More menu lists every local note with a
checkbox, so existing notes are published selectively rather than in bulk.

### 9.2 Walkthrough form

Both of the branches originally specified asked the same four things, so the form is one
contact block, not two (D15):

1. **What kind of job is it?** New build / Remodel
2. **Who was on site?** Nobody / General contractor / Open sub
3. If GC or sub: name, contact number, work covered, jobs at a time,
   **estimate turnaround** — Same day / 1–3 days / About a week / Longer / Didn't say (D16)
4. If **sub**: an additional short block for their GC — name and contact number

GC name pre-fills from the permit's `general_contractors`; phone pre-fills from
`/api/contact`. Both stay editable, because the crew on site is often not who pulled the
permit.

Each question is a `fieldset` with a `legend`. Revealing a branch scrolls it into view and
focuses its first field.

### 9.3 Open subs found on site

Any company named in a walkthrough is appended to the permit's contractor section, badged
`reported on site` so user-reported names never blend into the city's contact data.

### 9.4 Photos

Up to 6 per post. In-browser before upload: resize to 1600px max edge, re-encode to WebP,
**strip EXIF** (job-site photos carry GPS and camera serials). Server accepts only
`image/jpeg`, `image/png`, `image/webp` under 5 MB.

Each photo takes a caption, used as both the visible caption and the `alt` text — one
field so it actually gets filled. Thumbnails are buttons, named
"View photo 2 of 3 — <caption>". Anyone can delete any photo.

## 10. Worker API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/lists?q=&tag=&cursor=` | Directory page of 200 from `KV.list()`; returns `cursor` when more remain |
| POST | `/api/lists` | Create (existing) |
| GET | `/api/lists/:id` | Read (existing; still reads v1 payloads) |
| PUT | `/api/lists/:id` | Edit metadata or permits; writes a revision |
| PUT | `/api/lists/:id/ticks` | Single checkbox flip |
| GET·POST | `/api/lists/:id/revisions` | History and revert |
| GET·POST | `/api/notes/:permit` | Read and post a thread |
| PUT·DELETE | `/api/notes/:permit/:noteId` | Wiki edits on a post |
| GET | `/api/notes/counts?p=…` | Bulk counts for the permits on screen (capped at 220 ids) |
| POST·DELETE | `/api/photo/:permit` | R2 upload and removal |
| GET | `/api/photo/:permit/:id` | Serve with a long cache header |
| GET·PUT | `/api/tags` | Slot registry |

### 10.1 Migration of `YnF7y4t`

The live link currently returns `{permits:[100 ids], focal:{…, "5010 N Monticello"}}` and
no metadata. Handling:

- `GET /api/lists/:id` keeps reading v1 payloads; a missing `v` implies 1.
- Opening a v1 list shows the details dialog pre-filled as "Untitled list" with today's
  date. Saving writes v2 to the **same key**, so the URL never changes.
- Notes are attached separately, from the browser holding them, via §9.1. Notes written on
  another device cannot be captured — only the browser that has them can publish them.

## 11. Risk, stated once

Every write endpoint is unauthenticated and world-writable by choice (D2, D14). Revision
history makes text cleanup cheap. Photos are the sharper edge: anyone can put any image on
the domain and it is public the moment it lands, with deletion the only remedy.

Mitigations that are input validation rather than moderation, and are in scope:
content-type allowlist, size cap, EXIF stripping, delete-any control.

A hold queue or Workers AI screening can be added later without changing any data shape
in this document.

## 12. Phasing

Each phase is independently shippable and gets its own implementation plan.

| Phase | Contents |
|---|---|
| **1 · Lists** | Multi-list storage, directory, publish/edit metadata, tag slots, pagination, add-to-list picker, `YnF7y4t` migration |
| **2 · List view** | Toolbar consolidation and icons, Use column, visited checkbox, custom stops, Notes column removal |
| **3 · Posts** | Thread model, private draft + Post, walkthrough form, open subs, note counts |
| **4 · Photos** | R2 upload, client resize, EXIF strip, gallery |

Phase 4 is deliberately last and separable, so an R2 binding never blocks the rest.

## 13. Testing

Per `chi-permits-headless-verify`: Playwright against the cached Chromium headless-shell,
serving `docs/` locally, stubbing Nominatim, Socrata, OSRM and the Worker.

Mandatory, from the Jul 22 regression:

- Every overlay and full-screen sheet is asserted at an **iPhone 13 viewport**, checking
  `getBoundingClientRect()` against `innerHeight` — DOM presence is not evidence of
  visibility. `verify-tmp/t11.js` is the template.
- The ancestor chain of `#permit-modal` is walked for `transform`, `filter`,
  `will-change` and `contain`; any of them recreates the off-screen bug.
- Each new test is sanity-checked by reverting its fix and confirming it fails.

Worker logic gets `node --test` units alongside `worker/test/lists.test.mjs`: metadata
size clamping, cursor paging, tick coalescing, revision retention, custom-stop validation,
and the photo content-type allowlist.

## 14. Known gotchas

- **Line endings.** `list.html` blobs are CRLF while `index.html` and `map.html` are LF,
  with `core.autocrlf=true` and no `.gitattributes`. Stage with
  `git -c core.autocrlf=false add docs/list.html` or get a spurious ~6,200-line diff.
- **Duplicated overlay.** The permit overlay exists verbatim in `list.html` and
  `index.html` by project design. Keep shared functions byte-identical; check for stray
  NUL bytes after bulk edits.
- **`worker/` carries pre-existing uncommitted WIP** that is not ours. Never stage it.
- **`body.modal-open { animation: none }`** is load-bearing and must not be removed.
