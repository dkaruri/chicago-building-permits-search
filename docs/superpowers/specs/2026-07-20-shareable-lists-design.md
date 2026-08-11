# Shareable Lists — Design Spec

**Date:** 2026-07-20
**Scope:** `docs/list.html` (client) + `worker/src/` (Cloudflare Worker).
**Goal:** Let a user share their saved permit list (permit order + focal start
location) as a short URL that another person opens on their own device to load
the same list.

## Summary

"My Permit List" is stored only in the sender's browser (localStorage). Sharing
copies the list to a small server-side store (Cloudflare KV, via the existing
Worker) keyed by a short random id, and the shared URL carries only that id in
the hash: `…/list.html#s=<id>` (~78 chars, independent of list size). The
recipient's page reads the id, fetches the list from the Worker, and — after a
confirmation if they already have a list — loads it.

A short id (rather than the data in the URL) is required because ~100 permit
numbers carry too much identity to compress below ~500 chars; only an
indirection through stored data reaches <100.

## What is shared

- **Permit numbers, in saved order.** Required.
- **Focal start location**, if set: `{ lat, lon, label }`. Optional.
- **NOT shared:** per-permit notes, the list note.

## Worker changes (`worker/src/`)

Reuses the existing `CACHE` KV namespace (already bound in `wrangler.toml`) with
a `list:` key prefix. No new namespace, no `wrangler.toml` change.

### Routing (`src/index.js`)
- Add route: `{ pattern: /^\/api\/lists/, handler: handleLists }`.
- Pass `request` to handlers: change `route.handler(url, env)` →
  `route.handler(url, env, request)`. Existing handlers keep their `(url, env)`
  signature and ignore the third arg — no other handler is touched.
- CORS: change `Access-Control-Allow-Methods` from `"GET, OPTIONS"` to
  `"GET, POST, OPTIONS"` in `corsHeaders`.

### `src/lists.js`
`handleLists(url, env, request)`:

**`POST /api/lists`** (create)
- Parse JSON body `{ permits: string[], focal: {lat,lon,label}|null }`.
- Validate:
  - `permits` is a non-empty array, length ≤ 220; each entry matches
    `^[A-Za-z0-9-]{1,16}$` (sanitize/drop invalid). If none valid → `400`.
  - `focal`, if present: `lat`/`lon` are finite numbers; `label` coerced to
    string, capped at 120 chars. Invalid focal → stored as `null`.
- Generate a 7-char base62 id via `crypto.getRandomValues`.
- Store `KV.put("list:"+id, JSON.stringify({ v:1, p:permits, f:focal }), { expirationTtl: 15552000 })` (180 days = 6 months).
- Return `200 { id }`.
- Reject body > 8 KB (guards abuse) → `413`.

**`GET /api/lists/:id`** (fetch)
- Extract id from `url.pathname` (`/api/lists/<id>`); validate `^[A-Za-z0-9]{1,16}$`.
- `KV.get("list:"+id)`. Missing/expired → `404 { error: "not found" }`.
- Return `200 { permits, focal }` (mapping stored `p`/`f`).

Collision handling: 62^7 ≈ 3.5e12 keyspace; at this app's scale collisions are
negligible, so create does not pre-check existence. (`ponytail:` acceptable
ceiling; add a get-before-put check only if collisions ever surface.)

## Client — Sender (`docs/list.html`)

Add a **"Share list"** action to the existing list **More** menu.

- `shareUserList()`:
  - If `state.userPermitNumbers` empty → no-op (button disabled anyway).
  - Build body: `{ permits: state.userPermitNumbers, focal }` where `focal` is
    `{ lat: Number(focalPoint.latitude), lon: Number(focalPoint.longitude),
    label: focalPoint.address || focalPoint.label || "" }` from
    `state.focalPoint` when `resolved` with finite coords, else `null`.
  - `POST ${API_BASE}/api/lists`; on `{id}` build
    `shareUrl = ${location.origin}${location.pathname}#s=${id}`.
  - Deliver: `navigator.share({ url: shareUrl, title: "Chicago Permit List" })`
    if available; else `navigator.clipboard.writeText(shareUrl)` + announce
    "Share link copied." via the aria-live route/status line. If clipboard is
    blocked, fall back to a readonly, pre-selected text field with the URL.
  - Worker unreachable (e.g. localhost preview — CORS locked to Pages origin) →
    error "Sharing needs the live site." List untouched.

## Client — Recipient (`docs/list.html`)

Add `applySharedList()`, called from `init()` **after** the local list + focal
are loaded (`loadUserListCookie`, `loadFocalPoint`) so the replace-confirm knows
the existing count, and `await`ed before the initial `renderUserList()` so the
first paint reflects the shared list.

- Read `#s=<id>` via `new URLSearchParams(location.hash.slice(1)).get("s")`.
- Absent → return (normal page load).
- `GET ${API_BASE}/api/lists/${id}`:
  - `404`/error/offline → announce "This shared list link has expired or could
    not be loaded." Recipient's own list untouched. Strip the hash.
  - Success `{ permits, focal }`:
    - If recipient's saved list is **non-empty** →
      `confirm("Replace your saved list (N permits) with this shared list (M permits)?")`.
      Cancel → keep theirs, strip hash, done.
    - Empty list, or confirmed → set `state.userPermitNumbers = permits`
      (deduped, capped at 220); set `state.focalPoint` from `focal`
      (`{ address: label, label, latitude: lat, longitude: lon, resolved: true, permitNumber: null, matched: false }`)
      or clear it if `focal` null; persist both to localStorage
      (`saveUserListCookie`, focal save); `await ensurePermitMap()`; render list
      + focal status.
- Always `history.replaceState(null, "", location.pathname)` after handling, so
  a refresh does not re-prompt.

## Edge cases

- Permit numbers no longer in Socrata → absent after `ensurePermitMap` fetch
  (same as today's missing-coords handling); the rest still load.
- Malformed/empty `focal` → list loads without a start.
- Malformed `#s` id → treated as no share.
- Recipient offline → Socrata + Worker both unreachable; error message, no
  partial state.

## Security / privacy

- Stored data is public permit numbers + a self-chosen start address. The start
  address is the only potentially personal datum; the user opts in by sharing.
- 6-month TTL bounds retention; expired ids 404.
- Server-side validation (regex on permit numbers, numeric parse on lat/lon,
  body-size cap) prevents injection into downstream Socrata `IN(...)` queries and
  limits abuse. Client re-sanitizes on receipt.
- No auth: anyone with a link can read that list (acceptable — it is a
  share-by-link feature, like an unlisted doc).

## Testing

- **Worker unit test** (Node, `worker/`): validation + id generation logic —
  rejects >220 / bad permit numbers / oversized body; accepts valid; id matches
  `^[A-Za-z0-9]{7}$`; round-trips `{permits,focal}` through the stored shape.
- **Client headless** (established Playwright recipe): stub `POST /api/lists` →
  `{id}` and `GET /api/lists/:id` → a fixture; assert (a) share builds
  `#s=<id>` and copies/shares it; (b) opening `#s=<id>` on an empty list
  hydrates permits + focal and strips the hash; (c) on a non-empty list the
  replace-confirm fires and Cancel leaves the local list intact; (d) a `404`
  shows the expired message without touching the local list.
- **Live verification** (post-deploy, by user): tap Share on the live site,
  open the link on another device.

## Deployment (user-run, final step)

The Worker must be redeployed for `/api/lists` to exist. From `worker/`:
`npx wrangler whoami` (confirm auth) → `npx wrangler deploy`. `CACHE` KV is
already provisioned; no config change. The assistant cannot run this
(interactive Cloudflare auth). Until deployed, the Share button errors on the
live site. Do not stage `worker/package.json` / `node_modules/` / `.wrangler/`
(pre-existing WIP).

## Out of scope (YAGNI)

- QR codes (the <100-char id makes this feasible later, but not now).
- Editing/revoking a shared list; share analytics; auth.
- Sharing notes.
- A plain data-in-URL fallback (single path: id only).
