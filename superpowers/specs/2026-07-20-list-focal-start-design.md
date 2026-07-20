# Static focal-point start address for My Permit List — design

**Date:** 2026-07-20
**Page:** `docs/list.html` (self-contained HTML+JS app)
**Status:** approved design, pending spec review

## Goal

Let a user set a persistent **starting location** (focal point) for their permit
list. It is a fixed origin for all routing — it need not be a permit, but if the
typed address matches a permit already in the saved list, snap to that permit's
exact coordinates.

## Decisions (confirmed)

- **Drives:** route start point only (origin for distance estimates, the
  greedy "sort by drive time" start, and Google Maps route links). No
  per-permit distance, no sort-by-nearness.
- **Match scope:** **saved list only** — match the address against permits
  already in the list. If none match, geocode. (Not the whole dataset.)
- **On match:** snap to the matched permit's coordinates.
- **UI:** a field in the list toolbar area; persists across sessions.

## UI

A "Starting location" row inside `#user-list-panel`'s `.panel-head`, below the
`.user-list-toolbar` and above `#user-route-summary`:
- `<input id="focal-input">` (address text), a **Set** button
  (`onclick="setFocalPoint()"`), and a **Clear** button
  (`onclick="clearFocalPoint()"`).
- A resolved-state line `#focal-status` (aria-live polite):
  - matched: `Start: {address} — matched permit {number}`
  - geocoded: `Start: {label} — geocoded`
  - unresolved: `Couldn't locate "{text}". Routing will start from the first permit.`

## Data + persistence

- New localStorage key `focalPointKey = "chi_permit_focal"`.
- Stored object (also held at `state.focalPoint`):
  `{ address, latitude, longitude, permitNumber|null, matched, resolved }`.
  `latitude`/`longitude` names chosen so the object doubles as a synthetic route
  row for the existing `mapCoordinateText` / `routeCoordinateText` helpers.
- Load on init (`loadFocalPoint()`), populate the input, render status.

## Resolve flow — `setFocalPoint()`

1. Read + trim `#focal-input`. Empty ⇒ treat as Clear.
2. **Saved-list match:** normalize the text and compare against
   `userListRows()` addresses (reuse the existing `norm()` /
   `clean()` helpers; match on normalized equality, then a contains fallback).
   First hit with finite coords ⇒
   `{ address: row.address, latitude, longitude, permitNumber: row.permit_number,
   matched: true, resolved: true }`.
3. **Else geocode:** `await geocodeMapSearch(text)` (existing Nominatim helper,
   returns `{lat, lon, label}`). Success ⇒
   `{ address: text, latitude: lat, longitude: lon, permitNumber: null,
   matched: false, resolved: true }` (keep `label` for status text).
4. **Else unresolved:** `{ address: text, resolved: false }`. Not used as origin.
5. Persist, render status, and recompute the route summary the user last saw
   (call `renderRouteSummary()`; do not auto-fire network routing).

## Routing integration

Add `focalOriginRow()` → returns a synthetic row
`{ permit_number: "", address, latitude, longitude, focal: true }` when
`state.focalPoint?.resolved`, else `null`. Helper
`withFocalOrigin(rows)` prepends it when present.

- **`googleMapsDirectionsUrl` callers** (`openGoogleMapsRoute`,
  `showGoogleRouteChunks`): build from `withFocalOrigin(mapExportRows())`.
  The 5-stop slice and chunking then start at the focal point.
  `routeChunkStops` must render the focal row as `Start` (no permit number).
- **`calculateUserListRoute`:** `fetchRouteLegs(withFocalOrigin(routable))`.
  The first leg (focal → first permit) counts toward the total. Per-row
  "To next" labels still key off `permit_number`; the focal→first leg has an
  empty `from` and simply isn't shown under any list row (acceptable).
- **`optimizeUserListRoute`:** run `fetchDurationMatrix` / `greedyRouteOrder`
  on `withFocalOrigin(routable)`. `greedyRouteOrder` starts at index 0 = focal,
  so the focal stays the fixed start and permits order outward from it. Before
  persisting `state.userPermitNumbers`, **filter out the focal row**
  (`ordered.filter(r => !r.focal)`); pass the same filtered order to
  `fetchRouteLegs` for display, or keep focal in the leg fetch for the total —
  keep focal in the leg fetch (total includes the start leg), strip only for
  `userPermitNumbers`.

## Edge cases

- Empty list: setting a start is allowed; routing still needs ≥1 permit to form
  a route, existing min-length guards apply (focal + 1 permit = 2 points).
- Unresolved focal: `focalOriginRow()` returns null ⇒ behavior identical to
  today (origin = first permit).
- Clear (`clearFocalPoint()`): remove key, clear `state.focalPoint`, clear the
  input, re-render status + route summary.

## Testing (headless Playwright, mobile viewport)

1. Seed a saved list (localStorage `userListKey`) with known permit numbers so
   rows hydrate from Socrata (or stub the Socrata fetch for determinism).
2. Set a focal address equal to a saved permit's address → assert
   `state.focalPoint.matched === true` and coords equal that permit's.
3. Set a non-permit address (stub Nominatim) → assert `matched === false`,
   coords equal the stub.
4. Assert `googleMapsDirectionsUrl(withFocalOrigin(rows))` `origin` param equals
   the focal `lat,lon`.
5. Assert an unresolved focal ⇒ `focalOriginRow()` null ⇒ origin falls back to
   first permit.
6. Assert persistence: reload, focal restored from localStorage.
7. Clear → assert origin reverts to first permit; zero JS errors
   (Worker/Socrata CORS on localhost excluded, as before).

## Out of scope (YAGNI)
- Whole-dataset address matching (chose saved-list only).
- Per-permit distance columns / sort-by-nearness.
- Showing the focal point on a map pin (list view is a table).
- Multiple/starred focal points.
