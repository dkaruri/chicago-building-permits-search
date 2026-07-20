# Map radius filter around a searched address — design

**Date:** 2026-07-20
**Page:** `docs/map.html` (self-contained HTML+JS app)
**Status:** shipped

> **Update 2026-07-20:** Behavior changed from dim-mode to a **hard filter** at
> the user's request. Permits outside the radius are now **removed** from the map
> (pins, clusters, result count, and visible list) rather than dimmed. The `ir`
> per-feature flag and the dimmed `circle-opacity` cases were dropped;
> `applyMapFilters` now filters `filteredRows` to the radius. The translucent
> circle and status note are unchanged. Sections below describing dim-mode are
> superseded by this note.

## Goal

Let a user focus the permit map on a mile radius around an address they search.
Only permits inside the radius are shown; permits outside are removed from the
map and the result list. A translucent circle shows the search area.

## User flow

1. User types an address into the existing top search box (`#map-q`).
2. User enters a number into a new **Radius (miles)** field in the Filters
   drawer and hits **Search** / **Apply filters**.
3. The map geocodes the address (reusing existing geocoding), draws a circle of
   the given radius around it, dims permits outside the circle, and appends
   `| within {N} mi of {address}` to the status strip.
4. Clearing the search (`clearMapSearch`) or resetting (`resetMapSettings`), or
   blanking/zeroing the radius, removes the circle and un-dims all pins.

## Changes (all in `docs/map.html`)

### 1. Settings
- `defaultMapSettings()`: add `radiusMiles: ""`.
- `saveMapSettingsFromControls()`: read `#map-radius` → `settings.radiusMiles`.
- `clearMapSearch()` and `resetMapSettings()`: clear `radiusMiles`.

### 2. UI
- One `<input id="map-radius" type="number" min="0" step="0.25" inputmode="decimal">`
  in the existing `.map-filter-grid`, labeled "Radius (miles)", styled like the
  `map-gc-field` inputs. Blank or `0` = feature off.

### 3. Center point (reuse existing geocode)
- The center is `state.map.searchLocation` (`{lat, lon}`), already produced by
  `geocodeMapSearch()` for address-like queries.
- Extend `applyMapFilters()` so that **when `radiusMiles > 0` and `#map-q` has
  text**, a geocode is ensured even if the existing highlight logic wouldn't
  have requested one. Reuse an already-fetched `searchLocation` to avoid a
  second Nominatim call in the common path.

### 4. Dimming (per-feature `ir` flag)
- In `applyMapFilters()`, after center + radius are known, tag each row in
  `state.map.filteredRows` with `ir`:
  - No active radius/center ⇒ `ir = 1` for every row (nothing dims).
  - Active ⇒ `ir = 1` if `haversineMiles(center, row) <= radiusMiles`, else `0`.
- `ir` flows into pin properties automatically (`mapFeatureCollection()` spreads
  `...row`).
- Extend the `circle-opacity` expression on layers `permit-points` and
  `permit-point-shadows` with an out-of-radius case.
  **Precedence:** `active` (always full) → `ir == 0` (dim, opacity ~0.18) →
  `m == 1` (highlight) → normal. So an out-of-radius text-match dims; the
  selected pin never dims.

### 5. Circle overlay
- New source `radius-circle` (empty `FeatureCollection` at map load), plus a
  `fill` layer (translucent) and a dashed `line` outline, inserted **beneath**
  the permit pin layers but above zoning/TIF (via `beforeId`).
- Helper `circlePolygon(lat, lon, miles)` builds a 64-point ring, converting
  miles to degrees with latitude correction
  (`dLat = miles/69.0`, `dLon = miles/(69.0*cos(lat))`).
- `setData` when center + radius active; set to empty when off.

### 6. Feedback
- Status strip (`applyStatus` render) appends `| within {N} mi of {address}`
  when the radius filter is active.

## Testing (headless Playwright, mobile viewport)

1. Enter a known Chicago address + radius (e.g. `1`), apply.
2. Assert `radius-circle` source has one polygon feature.
3. Assert filtered rows split into `ir:1` / `ir:0`, and the `ir:1` count matches
   an independent haversine count computed in-test against the same center.
4. Assert `permit-points` `circle-opacity` evaluates to the dim value for an
   `ir:0` sample and full/normal for `ir:1` / active.
5. Clear search → assert `radius-circle` empty and all rows `ir:1`.
6. Zero JS/console errors (Worker-CORS localhost failures excluded, as before).

## Out of scope (YAGNI)
- Hard filtering (removing out-of-radius pins) — user chose dim mode.
- A separate center-address field — reuse the existing search box.
- Drawing/dragging the circle interactively, unit toggle (km), multiple radii.
