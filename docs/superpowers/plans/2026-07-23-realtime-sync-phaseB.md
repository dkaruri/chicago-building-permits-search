# Real-time list sync — Phase B (Client sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `list.html` to the live socket Phase A stands up — connect when viewing a published list, apply remote edits and re-render, and send local edits as patch ops — so a list edited on one device updates live on another that has it open.

**Architecture:** A small client sync layer (`state.live`) opens a WebSocket to `/api/lists/:id/live` on `showList` for a published list, closes it on `showDirectory`. Incoming `state`/`patch` messages run through a pure `applyListOp` reducer (mirroring the server), persist to `localStorage`, and re-render. The mutation paths that today only write `localStorage` (permit order, focal, custom stops, ticks, details) send a `patch` op when connected, guarded so remote-applied changes never echo back. Everything degrades to today's local-only behavior if the socket is down.

**Tech Stack:** Vanilla ES2022 in `docs/list.html` (no build step), the browser `WebSocket` API, `node --test` for the pure reducer, Playwright with a stubbed `WebSocket`.

## Global Constraints

- **Spec:** `superpowers/specs/2026-07-23-realtime-list-sync-design.md` §9. **Phase A is live** (`c873b22`): the DO, the WS endpoint, and the message protocol (§6) already work — verified with a two-client smoke test.
- **list.html only.** The live list view (toolbar, focal, ticks, table) lives only in `docs/list.html`. `index.html`/`map.html` have the multi-list store but do not open the list view, so they get no socket. No byte-identical-duplication concern for this feature.
- **No Worker change, no deploy.** Phase B is pure client; it merges and ships to Pages directly.
- **Message protocol (from Phase A, do not change):** client→server `{t:"hello",author}` and `{t:"patch",ops}`; server→client `{t:"state",doc,clock,presence}`, `{t:"patch",ops,clock}`, `{t:"presence",count,names}`, `{t:"error",code}`. Ops: `{f:"p",v}`, `{f:"f",v}`, `{f:"custom",v}`, `{f:"tick",k,v}`, `{f:"meta",v:{title,author,desc,tags}}`.
- **Only published lists** (with a `sharedId`) get a socket. Drafts stay local.
- **Never echo:** while applying a remote message, set a guard so the mutation paths do not re-send.
- **Degrade, never block:** if the socket fails to open or drops, every edit still works locally exactly as today; reconnect with capped backoff.
- **Presence UI is Phase C.** Phase B stores `state.live.presence` but renders nothing for it.
- **Editing HTML:** never via a bash heredoc (invisible 0x08/surrogate bytes). Use the Edit tool or a Python script asserting `count(b"\x08")==0 and count(b"\x00")==0`. Stage with `git -c core.autocrlf=false add docs/list.html`.
- **Verify headless at desktop AND iPhone 13** (per the standing ui-ux workflow), with a stubbed `WebSocket`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `docs/list.html` | The whole client sync layer + the outbound wiring into existing mutations | Modify |
| `verify-tmp/pb-reducer.mjs` + `-impl.mjs` | `applyListOp` unit tests (gitignored) | Create |

The sync layer is one cohesive block (`// ---- Live sync ----`) near the other list helpers, so it can be held in context at once.

---

### Task 1: The connection layer and inbound apply

**Files:**
- Modify: `docs/list.html` — add the `state.live` block, `applyListOp`, connect/disconnect/reconnect, the message handler, and re-render; wire connect into `showList` and disconnect into `showDirectory`.
- Test: `verify-tmp/pb-reducer.mjs`

**Interfaces:**
- Consumes: `activeList()`, `saveUserLists()`, `renderUserList()`, `renderListHeading()`, `renderFocalStatus()`, `state.focalPoint`, `API_BASE`.
- Produces: `applyListOp(list, op)` (mutates and returns the list), `liveConnect(sharedId)`, `liveDisconnect()`, `liveOnMessage(data)`, `state.live = { ws, id, clock, connected, applying, closing, presence, retry, retryTimer }`.

- [ ] **Step 1: Write the failing test for the pure reducer**

Create `verify-tmp/pb-reducer.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { applyListOp } from "./pb-reducer-impl.mjs";

const L = () => ({ name: "L", permits: ["1"], focal: null, custom: [], ticks: {}, sharedId: "abc", desc: "", author: "", tags: [] });

test("p replaces the permit order", () => {
  const l = L();
  applyListOp(l, { f: "p", v: ["2", "3"] });
  assert.deepEqual(l.permits, ["2", "3"]);
});

test("f sets and clears the focal", () => {
  const l = L();
  applyListOp(l, { f: "f", v: { lat: 41.9, lon: -87.6, label: "HQ" } });
  assert.equal(l.focal.label, "HQ");
  applyListOp(l, { f: "f", v: null });
  assert.equal(l.focal, null);
});

test("custom replaces the stops", () => {
  const l = L();
  applyListOp(l, { f: "custom", v: [{ id: "c_1", addr: "x" }] });
  assert.equal(l.custom.length, 1);
});

test("tick sets and deletes one key", () => {
  const l = L();
  applyListOp(l, { f: "tick", k: "1", v: 1 });
  assert.deepEqual(l.ticks, { "1": 1 });
  applyListOp(l, { f: "tick", k: "1", v: 0 });
  assert.deepEqual(l.ticks, {});
});

test("meta maps title/desc/author/tags onto the list", () => {
  const l = L();
  applyListOp(l, { f: "meta", v: { title: "Roof Runs", desc: "d", author: "Div", tags: [["roofing", 0]] } });
  assert.equal(l.name, "Roof Runs");
  assert.equal(l.desc, "d");
  assert.equal(l.author, "Div");
  assert.deepEqual(l.tags, [["roofing", 0]]);
});

test("an unknown field is a no-op", () => {
  const l = L();
  const snap = JSON.stringify(l);
  applyListOp(l, { f: "nope", v: 1 });
  assert.equal(JSON.stringify(l), snap);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test "verify-tmp/pb-reducer.mjs"`
Expected: FAIL — `Cannot find module './pb-reducer-impl.mjs'`

- [ ] **Step 3: Add the sync layer to `docs/list.html`**

Add before the `// ---- Add-to-list picker ----` marker (near the other list helpers):

```js
    // ---- Live sync (Phase B) ----
    // Applies a server op to a local list object. Mirrors the Worker's applyOp;
    // incoming ops are already server-validated, so this applies them directly.
    function applyListOp(list, op) {
      switch (op && op.f) {
        case "p": list.permits = Array.isArray(op.v) ? op.v.slice() : []; break;
        case "f": list.focal = op.v || null; break;
        case "custom": list.custom = Array.isArray(op.v) ? op.v.slice() : []; break;
        case "tick":
          list.ticks = list.ticks || {};
          if (op.k) { if (op.v) list.ticks[op.k] = 1; else delete list.ticks[op.k]; }
          break;
        case "meta": {
          const m = op.v || {};
          if (m.title != null) list.name = m.title;
          if (m.desc != null) list.desc = m.desc;
          if (m.author != null) list.author = m.author;
          if (m.tags != null) list.tags = m.tags;
          break;
        }
      }
      return list;
    }

    const WS_BASE = API_BASE.replace(/^http/, "ws");

    function liveConnect(sharedId) {
      liveDisconnect();
      if (!sharedId || typeof WebSocket === "undefined") return;
      const live = state.live;
      live.id = sharedId;
      live.closing = false;
      let ws;
      try { ws = new WebSocket(`${WS_BASE}/api/lists/${encodeURIComponent(sharedId)}/live`); }
      catch { liveScheduleReconnect(sharedId); return; }
      live.ws = ws;
      ws.onopen = () => {
        live.connected = true;
        live.retry = 0;
        try { ws.send(JSON.stringify({ t: "hello", author: (localStorage.getItem("chi_permit_author") || "").trim() })); } catch { /* closing */ }
      };
      ws.onmessage = ev => liveOnMessage(ev.data);
      ws.onerror = () => { /* onclose follows */ };
      ws.onclose = () => {
        live.connected = false;
        if (!live.closing && live.id === sharedId) liveScheduleReconnect(sharedId);
      };
    }

    function liveDisconnect() {
      const live = state.live;
      live.closing = true;
      live.connected = false;
      clearTimeout(live.retryTimer);
      if (live.ws) { try { live.ws.close(); } catch { /* already closed */ } }
      live.ws = null;
      live.id = null;
    }

    function liveScheduleReconnect(sharedId) {
      const live = state.live;
      const delay = Math.min(30000, 1000 * Math.pow(2, live.retry));
      live.retry += 1;
      clearTimeout(live.retryTimer);
      live.retryTimer = setTimeout(() => {
        const l = activeList();
        if (l && l.sharedId === sharedId) liveConnect(sharedId);
      }, delay);
    }

    function focalPointFromDoc(f) {
      if (!f || !Number.isFinite(Number(f.lat)) || !Number.isFinite(Number(f.lon))) return null;
      return { address: f.label || "", label: f.label || "", latitude: Number(f.lat), longitude: Number(f.lon), resolved: true, permitNumber: null, matched: false };
    }

    function liveOnMessage(data) {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      const live = state.live;
      if (msg.t === "error") { liveDisconnect(); return; }
      if (msg.t === "presence") { live.presence = { count: msg.count || 0, names: msg.names || [] }; return; }
      const list = activeList();
      if (!list || list.sharedId !== live.id) return;

      live.applying = true;
      try {
        if (msg.t === "state" && msg.doc) {
          const d = msg.doc;
          list.permits = Array.isArray(d.p) ? d.p.slice() : [];
          list.focal = d.f || null;
          list.custom = Array.isArray(d.custom) ? d.custom.slice() : [];
          list.ticks = d.ticks && typeof d.ticks === "object" ? d.ticks : {};
          if (d.meta) { list.name = d.meta.title || list.name; list.desc = d.meta.blurb != null ? d.meta.blurb : list.desc; list.author = d.meta.author != null ? d.meta.author : list.author; list.tags = d.meta.tags != null ? d.meta.tags : list.tags; }
          live.clock = msg.clock || 0;
          if (msg.presence) live.presence = msg.presence;
        } else if (msg.t === "patch" && Array.isArray(msg.ops)) {
          for (const op of msg.ops) applyListOp(list, op);
          live.clock = msg.clock || live.clock;
        } else {
          return;
        }
        // Reflect into the live view state, persist, re-render.
        state.userPermitNumbers = [...list.permits];
        state.focalPoint = focalPointFromDoc(list.focal);
        saveUserLists();
        saveFocalPoint();
        const focalInput = $("focal-input");
        if (focalInput) focalInput.value = state.focalPoint ? (state.focalPoint.address || "") : "";
        renderListHeading();
        renderFocalStatus();
        renderUserList();
      } finally {
        live.applying = false;
      }
    }
```

Add to the `state` object (beside `directory:` / `tagRegistry:`):

```js
      live: { ws: null, id: null, clock: 0, connected: false, applying: false, closing: false, presence: { count: 0, names: [] }, retry: 0, retryTimer: null },
```

- [ ] **Step 4: Connect on a published list, disconnect on the directory**

In `showList(id)`, after `state.userPermitNumbers = [...state.lists[id].permits];` and before `renderUserList()`, open the socket for a published list:

```js
      const opened = activeList();
      if (opened && opened.sharedId) liveConnect(opened.sharedId); else liveDisconnect();
```

In `showDirectory()`, at the top, close it:

```js
      liveDisconnect();
```

- [ ] **Step 5: Extract and run the reducer test**

Copy `applyListOp` into `verify-tmp/pb-reducer-impl.mjs` with `export` prepended.

Run: `node --test "verify-tmp/pb-reducer.mjs"`
Expected: PASS — 6 tests.

- [ ] **Step 6: Verify inbound apply in a browser (stubbed WebSocket)**

Serve `docs/`. Inject a fake `WebSocket` via `page.addInitScript` that records the URL + sent frames on `window.__ws` and exposes `window.__wsRecv(obj)` to push a server message into the page. Seed a **published** list (has `sharedId`). Assert:
1. Opening the list constructs a WebSocket to `…/api/lists/<sharedId>/live` and sends a `hello`.
2. Pushing a `state` message with a 3-permit doc re-renders the table to 3 rows and updates `state.live.clock`.
3. Pushing a `patch` `{f:"tick",k:"<permit>",v:1}` marks that row done (`tr.is-done`).
4. Pushing a `patch` `{f:"f",v:{lat,lon,label:"5010 N Monticello"}}` fills the focal input.
5. A **draft** list (no `sharedId`) constructs **no** WebSocket.
6. No console errors; the same at an iPhone 13 viewport.

- [ ] **Step 7: Commit**

```bash
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(list): live-sync connection layer and inbound apply

Opening a published list opens a WebSocket to its room; incoming state/patch
messages run through a pure applyListOp reducer, persist to localStorage, and
re-render the table, focal, ticks and heading. Draft lists get no socket.
Disconnects on returning to the directory. Reconnects with capped backoff."
```

---

### Task 2: Outbound — send local edits as patches

**Files:**
- Modify: `docs/list.html` — `sendListOp`, wired into `saveUserListCookie`, `setFocalPoint`/`clearFocalPoint`, `addCustomStop`/`removeCustomStop`, `toggleTick`, and the details save.

**Interfaces:**
- Consumes: `state.live`, `activeList()`, `focalShareData()`.
- Produces: `sendListOp(op)` — sends `{t:"patch",ops:[op]}` when connected to the active published list and not applying a remote message.

- [ ] **Step 1: Add `sendListOp`**

```js
    function sendListOp(op) {
      const live = state.live;
      if (live.applying || !live.connected || !live.ws) return;
      const list = activeList();
      if (!list || !list.sharedId || list.sharedId !== live.id) return;
      try { live.ws.send(JSON.stringify({ t: "patch", ops: [op] })); } catch { /* closing */ }
    }
```

> The `live.applying` guard is what prevents an echo: when `liveOnMessage` applies a remote op it calls the same mutation/render paths, but `sendListOp` no-ops while `applying` is true.

- [ ] **Step 2: Send the permit order**

`saveUserListCookie()` is the single choke point for add/remove/reorder (they all update `state.userPermitNumbers` then call it). After it writes `list.permits`, send a `p` op:

```js
    function saveUserListCookie() {
      state.userPermitNumbers = Array.from(new Set(state.userPermitNumbers)).slice(0, userListLimit);
      const list = activeList();
      if (list) list.permits = [...state.userPermitNumbers];
      saveUserLists();
      if (list) sendListOp({ f: "p", v: list.permits });
    }
```

- [ ] **Step 3: Send the focal**

At the end of both `setFocalPoint()` (after `saveFocalPoint()`) and `clearFocalPoint()` (after `saveFocalPoint()`), add:

```js
      sendListOp({ f: "f", v: focalShareData() });
```

Also mirror the focal onto the active list so a later `state` snapshot round-trips it: in both, after `saveFocalPoint()`:

```js
      const _l = activeList(); if (_l) _l.focal = focalShareData();
```

- [ ] **Step 4: Send custom stops**

In `addCustomStop(dlg)` after `saveUserLists()` and in `removeCustomStop(encodedId)` after `saveUserLists()`, add:

```js
      const _l = activeList(); if (_l) sendListOp({ f: "custom", v: _l.custom || [] });
```

- [ ] **Step 5: Send ticks (replace the HTTP PUT while connected)**

In `toggleTick(encodedKey, on)`, replace the `tickQueue.push(...); queueTickSync();` tail with a socket send when connected, else the existing debounced HTTP path:

```js
      if (state.live.connected && state.live.id && activeList() && activeList().sharedId === state.live.id) {
        sendListOp({ f: "tick", k: key, v: on ? 1 : 0 });
      } else {
        tickQueue.push([key, !!on]);
        queueTickSync();
      }
```

- [ ] **Step 6: Send details**

In the details save (`openListDetails` → save handler), after the local `list.*` fields are updated and `saveUserLists()` runs, add:

```js
          sendListOp({ f: "meta", v: { title: list.name, desc: list.desc || "", author: list.author || "", tags: list.tags || [] } });
```

> The existing POST/PUT still runs (it creates the KV entry / gets the `sharedId` for a first publish). Once published and connected, the `meta` op broadcasts the change live; the DO's write-through then re-writes the same metadata, so there is no conflict.

- [ ] **Step 7: Verify outbound + no-echo in a browser**

With the stubbed WebSocket that records sent frames: seed a published list, mark it connected. Assert:
1. Reordering / removing a permit sends a `patch` with `{f:"p"}` carrying the new order.
2. Setting the focal sends `{f:"f"}`; clearing sends `{f:"f",v:null}`.
3. Adding a custom stop sends `{f:"custom"}`.
4. Ticking a row sends `{f:"tick",k,v:1}` and issues **no** HTTP PUT to `/ticks`.
5. **No echo:** pushing a remote `patch` into the page (which re-renders) sends **zero** new frames.
6. On a **draft** list (not connected), the same edits send nothing and behave exactly as before (ticks still use the HTTP path — here, no socket so nothing).

- [ ] **Step 8: Commit**

```bash
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(list): send local edits as live patches

Reorder/add/remove, focal, custom stops, ticks and details now broadcast a
patch op when connected to a published list. Ticks send over the socket instead
of the HTTP PUT while live. An applying-guard stops remote edits from echoing.
Draft lists and offline sessions are unchanged."
```

---

### Task 3: Degradation, reconnect, and full verification

**Files:**
- Modify: `docs/list.html` (only if a fix is needed)
- Test: browser suites

- [ ] **Step 1: Verify graceful degradation**

With the WebSocket stub made to throw on construction (simulating no connectivity): open a published list and assert every edit (reorder, tick, focal, custom) still works locally and persists to `localStorage`, with no console error, and the list renders normally.

- [ ] **Step 2: Verify reconnect**

With a stub that lets the test fire `onclose`: open a published list, fire `onclose`, advance timers, and assert a new WebSocket is constructed (backoff reconnect). Then fire `onclose` with the list closed (back on the directory) and assert **no** reconnect.

- [ ] **Step 3: Two-peer round trip (simulated)**

Wire the stub so two page contexts share a message bus (frames sent by page A's socket are delivered to page B's `onmessage` and vice versa, echoing the Phase-A server semantics of broadcast-to-others). Open the same published list in both, tick a row in A, and assert B's row becomes `is-done` — the end-to-end Phase B behavior, without a live Worker.

- [ ] **Step 4: iPhone 13 pass**

Repeat Steps 1 and 3 at an iPhone 13 viewport. Assert no layout breakage and the table still updates on a remote patch.

- [ ] **Step 5: Run every suite**

`node --test "verify-tmp/pb-reducer.mjs"` and all prior `verify-tmp/*` suites, then each Playwright script. Confirm `docs/list.html` has zero `0x08`/NUL bytes.

- [ ] **Step 6: Commit, merge, push, report, fold memory**

Client-only — merge `--no-ff` to `main` and push (no deploy). Fold Phase B into memory. **Stop; do not start Phase C (presence UI) without confirmation.**

---

## Self-Review

**Spec coverage.** §9 connect on `showList` for a published list, close on `showDirectory` → Task 1 Step 4. §9 apply remote through the reducer + re-render (table, heading, focal, ticks) → Task 1. §9 send the mutations that were localStorage-only (permits/focal/custom/details) + ticks over the socket → Task 2. §9 degrade + reconnect → Tasks 1 (backoff), 3. §6 protocol (hello/state/patch/presence/error) honored → Task 1. §7 op shapes → Tasks 1, 2. Presence stored, not rendered (Phase C) → Task 1. §13 stubbed-WebSocket Playwright, desktop + iPhone 13 → Tasks 1, 2, 3.

**Deferred, not gaps:** presence UI is Phase C; syncing edits made from `index.html`/`map.html` (which never open the list view) stays out — those are local until the list is opened live, matching the spec's connect-on-`showList` model.

**Type consistency.** `applyListOp(list, op)` is identical in the reducer test, the impl, and `liveOnMessage`. `sendListOp(op)` takes a single op object at its definition and all six call sites. Op shapes (`{f:"p"|"f"|"custom"|"tick"|"meta"}`) match the Phase-A server (`list-doc.js` applyOp) and the message protocol. `state.live` fields (`ws/id/clock/connected/applying/closing/presence/retry/retryTimer`) are set in Task 1 and read consistently in Task 2.

**One risk carried deliberately.** A remote patch that lands mid-drag (user reordering while a peer edits) re-renders under the user; last-write-wins means the peer's order can replace an in-progress local reorder. Acceptable for a small team (spec R4); not worth locking the UI during edits.
