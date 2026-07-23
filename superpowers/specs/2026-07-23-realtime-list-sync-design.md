# Real-time list sync — design

**Date:** 2026-07-23
**Status:** Approved for planning
**Builds on:** the List Directory rework (`2026-07-23-list-directory-design.md`), phases 1–4 live.

Make a **published** list update live across every device that has it open, using a
Cloudflare Durable Object per list over WebSockets.

---

## 1. Problem

Lists live in each browser's `localStorage`; a published list also has a KV copy. But the
KV copy only updates on an explicit publish/edit-details save (and on tick toggles), and
another device only sees changes when it re-opens the list (pull-on-open). So editing a
list on a phone does not reach a desktop that has it open — there is no live sync. The
user confirmed this is the gap to close, and chose true real-time (live while open).

## 2. Goals

- A published list open on two devices updates on both, live, as either edits.
- Everything on the list syncs: permit order, add/remove, visited ticks, starting
  location, custom stops, and details (title/description/author/tags).
- A simple **presence count** — "N people on this list" — shown while connected.
- The existing KV directory, share links, and cold reads keep working unchanged.
- Graceful degradation: if the socket is unavailable, fall back to today's local +
  pull-on-open behavior, and reconnect when possible.
- Stays within the Cloudflare **free tier** (SQLite-backed DO: 100k requests/day incl.
  WS messages, 13k GB-s/day, 5 GB storage — ample for a small team).

## 3. Non-goals

- Real-time sync of **draft** (unpublished) lists — those stay device-local until
  published. A draft has no share id and therefore no room.
- Accounts or cross-device identity. Author remains unverified free text.
- Operational-transform / CRDT conflict resolution. Conflicts are last-write-wins per
  field (§7).
- Live sync of the permit **note threads** — those are already server-side per-permit and
  out of scope here.

## 4. Decisions

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| R1 | One Durable Object per published list, keyed by share id | One global DO | A DO is a coordination atom; per-list scales and isolates |
| R2 | SQLite-backed DO (free tier), WebSocket Hibernation | KV-only polling | Live push, idle rooms cost nothing, free-tier eligible |
| R3 | DO writes through to the existing KV `list:<id>` | DO storage as sole source | Keeps the directory, share links, and no-DO cold reads working |
| R4 | Last-write-wins per field, ordered by a per-room logical clock | OT / CRDT | Simple and correct for a small team; avoids a big build |
| R5 | Everything on a published list syncs live | Only permits/ticks | User's call — one live document, no partial disagreement |
| R6 | Presence = a connected-socket count (+ posted author names when known) | Full cursors/avatars | Reassures a team without the cost of live cursors |
| R7 | Only published lists get a room | Rooms for drafts too | Drafts are local by design; no id to key a room |
| R8 | No new test dependency — unit-test the pure reducer with `node --test`; verify the DO with `wrangler dev` + a WS client script | Add `@cloudflare/vitest-pool-workers` | Keeps the toolchain as-is |

## 5. Architecture

```
 client (list.html / index.html)
   │  opens WS when viewing a PUBLISHED list
   ▼
 Worker fetch()  ──/api/lists/:id/live──►  env.LIST_ROOM.getByName(id)
                                              │  ListRoom (Durable Object)
                                              │   - authoritative list doc (SQLite)
                                              │   - connected sockets (hibernatable)
                                              │   - logical clock
                                              ├─ write-through ─► KV list:<id> (debounced)
                                              └─ broadcast patch ─► all other sockets
```

- **`ListRoom` Durable Object** (`worker/src/list-room.js`), bound as `LIST_ROOM`, SQLite
  migration `new_sqlite_classes: ["ListRoom"]`.
- **WS endpoint:** `GET /api/lists/:id/live` with `Upgrade: websocket`. The Worker routes
  to `env.LIST_ROOM.getByName(id)` which accepts the socket via hibernation
  (`ctx.acceptWebSocket`).
- **Cold load:** on first connect, if the room's SQLite is empty, it loads the list from
  KV `list:<id>` (or 404s if the id is unknown / trashed).

## 6. Message protocol (JSON over WS)

Client → server:
- `{ t: "hello", author }` — sent on open; server replies `state` + `presence`.
- `{ t: "patch", ops }` — one or more field ops (§7). Server applies, bumps the clock,
  write-throughs, broadcasts.

Server → client:
- `{ t: "state", doc, clock, presence }` — full snapshot on join (and after a resync).
- `{ t: "patch", ops, clock }` — a remote edit to apply.
- `{ t: "presence", count, names }` — presence changed.
- `{ t: "error", code }` — e.g. `not_found` (trashed/unknown id) → client closes and
  falls back.

## 7. Document model and conflict

The synced document mirrors the v2 list value plus its metadata:

```jsonc
{
  p: ["101082609", …],            // permit order
  f: { lat, lon, label } | null,  // focal
  custom: [ … ],                  // custom stops
  ticks: { key: 1 },              // visited
  meta: { title, author, blurb, tags }
}
```

**Ops** are field-scoped so last-write-wins is per field, not whole-doc:
- `{ f: "p", v: [...] }` — replace the permit order (reorder/add/remove send the whole array).
- `{ f: "f", v: {...}|null }` — focal.
- `{ f: "custom", v: [...] }` — custom stops.
- `{ f: "tick", k: "<key>", v: 0|1 }` — one tick.
- `{ f: "meta", v: {...} }` — details.

Each op carries the room's next logical `clock`. A client applies a remote op only if its
clock is newer than the last it applied for that field; the server is the sole clock
authority, so ordering is total. The reducer that applies an op to a doc is **pure**
(`applyOp(doc, op) -> doc`) and unit-tested without the runtime (R8).

## 8. Persistence and the KV write-through

- The DO holds the authoritative doc in SQLite (survives eviction).
- After applying a patch, the DO schedules a **debounced** write-through (~1 s) to KV
  `list:<id>`, rebuilding the value (`{v:2,p,f,desc,custom,ticks}`) and metadata via the
  existing `buildListMeta`. This keeps the directory, share GET, and cold reads correct
  without a KV write per keystroke.
- The tick endpoint (`PUT /api/lists/:id/ticks`) and the details PUT continue to exist for
  non-connected clients; when a room is live they route through the DO too so state stays
  single-sourced. (Detail: those HTTP paths call the DO if a room exists, else write KV
  directly — the DO is authoritative only while it has connections + recent state.)

## 9. Client

- **Connect:** `showList(id)` opens a WS to `/api/lists/:id/live` **only if the list has a
  `sharedId`**. On `state`, replace the local list doc and re-render. Close the socket when
  leaving the list view or opening the directory.
- **Send:** the mutation paths that today only write `localStorage` (reorder, add/remove,
  focal, custom, details) now also send a `patch` op when a socket is open. Ticks send a
  `tick` op instead of the HTTP PUT while connected.
- **Receive:** apply remote ops through the same pure reducer, persist to `localStorage`,
  and re-render (the table, heading, tick states, focal input).
- **Presence:** render "N here" near the list heading from `presence` messages.
- **Degrade:** if the socket fails to open or drops, keep working locally exactly as today
  and retry the connection with backoff. Nothing blocks on the socket.

## 10. Worker wiring

- `wrangler.toml`: add the DO binding + SQLite migration.
- `index.js`: before the `/api/lists` route, detect `…/live` upgrade requests and hand off
  to the DO; everything else unchanged.
- CORS/WS: the upgrade response must not be wrapped by the JSON CORS helper.

## 11. Risks, stated

- **Last-write-wins** can drop a simultaneous edit (two reorders in the same second). The
  logical clock makes ordering deterministic; the loser sees the winner's state on the next
  broadcast. Acceptable for a small team (R4).
- **Free-tier ceilings** (100k requests/day incl. WS messages). Debounced write-through and
  coarse ops (whole-array replace) keep message volume low. If a list ever gets busy enough
  to matter, batch harder.
- **DO testing** needs the workers runtime; we unit-test the pure reducer with `node --test`
  and verify the socket end-to-end against `wrangler dev` (R8).
- **Trashed lists** (from the delete feature): the room 404s on cold load if `list:<id>` is
  gone, so a deleted list cannot be edited live.

## 12. Phasing

Each phase is independently landable; the DO deploy + `wrangler.toml` migration happen in
Phase 1 (the user runs `wrangler deploy`).

| Phase | Contents |
|---|---|
| **A · Room + reducer** | `ListRoom` DO, the pure `applyOp` reducer (unit-tested), WS accept/hello/state, KV cold-load and debounced write-through, `wrangler.toml` binding + migration. No client yet; verified with a WS script against `wrangler dev`. |
| **B · Client sync** | Connect on a published list, send/receive patches for permits/focal/custom/ticks/details, re-render, `localStorage` persistence, degrade + reconnect. |
| **C · Presence** | Connected-socket count + posted names, shown by the heading. |

## 13. Testing

- **Pure reducer** (`applyOp`, clock ordering, per-field LWW): `node --test`, no runtime.
- **DO end-to-end:** `wrangler dev` + a Node WS client script in the scratchpad — connect
  two sockets, edit on one, assert the other receives the patch and the KV write-through
  lands. (Not committed; gitignored like `verify-tmp/`.)
- **Client:** the headless Playwright recipe with a **stubbed WebSocket** (inject a fake
  `WebSocket` that echoes/loops messages) to drive connect → edit → remote-apply → render
  without a live Worker. Desktop and iPhone 13.

## 14. Gotchas carried from the project

- Never edit `docs/*.html` via a bash heredoc (invisible 0x08/surrogate bytes). Edit tool
  or a byte-asserting Python script; raw strings for literal `\uXXXX`.
- The overlay/list code is byte-identical across `list.html` and `index.html` — change both.
- Stage `list.html` with `git -c core.autocrlf=false add`.
- Run `ui-ux-pro-max` on any new UI (the presence indicator) — desktop + iPhone 13.
