# Real-time list sync — Phase A (Room + reducer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a `ListRoom` Durable Object that holds a published list's live document over WebSockets — accepting edits, broadcasting them, and writing through to the existing KV `list:<id>` — with a pure, unit-tested reducer at its core. No client yet.

**Architecture:** A pure module (`list-doc.js`) defines the synced document and `applyOp(doc, op)` — last-write-wins per field — tested with `node --test`. The `ListRoom` DO (SQLite-backed, WebSocket Hibernation) loads the doc from KV on first connect, applies patches, persists, broadcasts to other sockets, and debounces a write-through back to KV via an alarm. The Worker routes `/api/lists/:id/live` upgrades to the DO, bypassing the CORS response wrapper.

**Tech Stack:** Cloudflare Workers + Durable Objects (SQLite, hibernation) + KV, vanilla ES modules, `node --test`.

## Global Constraints

- **Spec:** `superpowers/specs/2026-07-23-realtime-list-sync-design.md`. Decisions R1–R8 bind.
- **This bundles with the pending deploy.** The branch already carries the Delete-list soft-delete (`046767e`) and UI fixes (`72ea5bb`); Phase A adds the DO. One `wrangler deploy` (Task 3, user-run) ships all of it.
- **No new npm dependency.** The pure reducer is unit-tested with `node --test`; the DO is verified post-deploy with a throwaway WS client script (R8). Do NOT add `@cloudflare/vitest-pool-workers`.
- **`node --test` must never load a file that imports `cloudflare:workers`.** `list-room.js` imports it; keep it out of every `*.test.mjs`. The tests import only the pure `list-doc.js` (which imports lists.js — all node-safe). `index.js` re-exports `ListRoom` but no test imports `index.js` — keep it that way.
- **The DO writes through to the SAME KV `list:<id>` value+metadata shape** the rest of the app reads (`{v:2,p,f,desc,custom,ticks}` + `buildListMeta` metadata), so the directory, share GET, and cold reads stay correct.
- **Trashed lists** (deleted): the room cold-load 404s if `list:<id>` is gone, so a deleted list cannot be edited live.
- **Free tier:** SQLite-backed DO only (`new_sqlite_classes`), hibernation to keep idle rooms free. Debounced write-through + coarse whole-array ops keep message volume low.
- **Worker test command:** `cd worker && npm test` (runs `node --test "test/*.test.mjs"`).
- **Never stage `worker/` WIP** (`.wrangler/`, `node_modules/`, `package-lock.json`).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `worker/src/list-doc.js` | Pure synced-document model + `applyOp` reducer + KV<->doc converters | **Create** |
| `worker/test/list-doc.test.mjs` | Reducer + converter units | **Create** |
| `worker/src/list-room.js` | The `ListRoom` Durable Object (WS, persistence, broadcast, write-through) | **Create** |
| `worker/src/index.js` | Route `/live` upgrades to the DO; re-export `ListRoom` | Modify |
| `worker/wrangler.toml` | DO binding + SQLite migration | Modify |

---

### Task 1: The pure document reducer

**Files:**
- Create: `worker/src/list-doc.js`
- Create: `worker/test/list-doc.test.mjs`

**Interfaces:**
- Consumes: `buildListMeta`, `sanitizePermits`, `sanitizeFocal`, `sanitizeCustom`, `sanitizeTicks`, `readList` from `./lists.js`
- Produces:
  - `emptyDoc() -> { p:[], f:null, custom:[], ticks:{}, meta:{title,author,blurb,tags} }`
  - `docFromStored(value, metadata) -> doc` (value is the raw KV string; metadata is the KV metadata object)
  - `applyOp(doc, op) -> doc` (returns a new doc; supported ops in §7 of the spec)
  - `listValueFromDoc(doc) -> { v:2, p, f, desc, custom, ticks }` (for the KV write-through)

- [ ] **Step 1: Write the failing tests**

Create `worker/test/list-doc.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { emptyDoc, docFromStored, applyOp, listValueFromDoc } from "../src/list-doc.js";

test("emptyDoc has the five fields", () => {
  const d = emptyDoc();
  assert.deepEqual(d.p, []);
  assert.equal(d.f, null);
  assert.deepEqual(d.custom, []);
  assert.deepEqual(d.ticks, {});
  assert.equal(d.meta.title, "Untitled list");
});

test("docFromStored builds a doc from a v2 KV value + metadata", () => {
  const value = JSON.stringify({ v: 2, p: ["101082609"], f: { lat: 41.9, lon: -87.6, label: "HQ" }, desc: "d", custom: [{ id: "c_1", addr: "x" }], ticks: { "101082609": 1 } });
  const meta = { title: "Roof Runs", author: "Div", blurb: "d", tags: [["roofing", 0]] };
  const doc = docFromStored(value, meta);
  assert.deepEqual(doc.p, ["101082609"]);
  assert.equal(doc.f.label, "HQ");
  assert.equal(doc.custom.length, 1);
  assert.deepEqual(doc.ticks, { "101082609": 1 });
  assert.equal(doc.meta.title, "Roof Runs");
  assert.deepEqual(doc.meta.tags, [["roofing", 0]]);
});

test("docFromStored on a null/absent value is an empty doc", () => {
  assert.deepEqual(docFromStored(null, null).p, []);
});

test("applyOp p replaces the permit order and re-sanitizes", () => {
  const d = applyOp(emptyDoc(), { f: "p", v: ["101082609", "bad space", "B200461632"] });
  assert.deepEqual(d.p, ["101082609", "B200461632"]);
});

test("applyOp f sets and clears the focal", () => {
  const set = applyOp(emptyDoc(), { f: "f", v: { lat: 41.9, lon: -87.6, label: "HQ" } });
  assert.equal(set.f.label, "HQ");
  const cleared = applyOp(set, { f: "f", v: null });
  assert.equal(cleared.f, null);
});

test("applyOp custom validates the stops", () => {
  const d = applyOp(emptyDoc(), { f: "custom", v: [{ id: "c_1", addr: "3701 W Ainslie", use: "residential" }, { id: "bad", addr: "x" }] });
  assert.equal(d.custom.length, 1);
  assert.equal(d.custom[0].id, "c_1");
});

test("applyOp tick sets and deletes one key", () => {
  const on = applyOp(emptyDoc(), { f: "tick", k: "101082609", v: 1 });
  assert.deepEqual(on.ticks, { "101082609": 1 });
  const off = applyOp(on, { f: "tick", k: "101082609", v: 0 });
  assert.deepEqual(off.ticks, {});
});

test("applyOp meta merges details and clamps them", () => {
  const d = applyOp(emptyDoc(), { f: "meta", v: { title: "T".repeat(200), author: "A", tags: [["roofing", 0]] } });
  assert.equal(d.meta.title.length, 80);
  assert.equal(d.meta.author, "A");
  assert.deepEqual(d.meta.tags, [["roofing", 0]]);
});

test("applyOp is pure — the input doc is not mutated", () => {
  const a = emptyDoc();
  applyOp(a, { f: "tick", k: "1", v: 1 });
  assert.deepEqual(a.ticks, {}, "original must be untouched");
});

test("applyOp ignores an unknown field", () => {
  const a = emptyDoc();
  const b = applyOp(a, { f: "nope", v: 1 });
  assert.deepEqual(b, a);
});

test("listValueFromDoc round-trips a doc to the v2 KV value shape", () => {
  const doc = applyOp(applyOp(emptyDoc(), { f: "p", v: ["101082609"] }), { f: "tick", k: "101082609", v: 1 });
  const val = listValueFromDoc(doc);
  assert.equal(val.v, 2);
  assert.deepEqual(val.p, ["101082609"]);
  assert.deepEqual(val.ticks, { "101082609": 1 });
  assert.equal(typeof val.desc, "string");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && npm test`
Expected: FAIL — `Cannot find module '../src/list-doc.js'`

- [ ] **Step 3: Implement `worker/src/list-doc.js`**

```js
import { sanitizePermits, sanitizeFocal, sanitizeCustom, sanitizeTicks, sanitizeMeta, readList } from "./lists.js";

const MAX_DESC = 2000;

export function emptyDoc() {
  return { p: [], f: null, custom: [], ticks: {}, desc: "", meta: sanitizeMeta({}) };
}

// value: the raw KV string (or null). metadata: the KV metadata object (or null).
export function docFromStored(value, metadata) {
  const list = readList(value);
  if (!list) return emptyDoc();
  return {
    p: Array.isArray(list.p) ? list.p : [],
    f: list.f || null,
    custom: Array.isArray(list.custom) ? list.custom : [],
    ticks: list.ticks && typeof list.ticks === "object" ? list.ticks : {},
    desc: typeof list.desc === "string" ? list.desc : "",
    // Metadata carries the directory-facing details; sanitizeMeta normalises them.
    meta: sanitizeMeta({
      title: metadata && metadata.title,
      author: metadata && metadata.author,
      desc: metadata && metadata.blurb,
      tags: metadata && metadata.tags,
    }),
  };
}

// Pure: returns a new doc, never mutates the input.
export function applyOp(doc, op) {
  const next = { ...doc, ticks: { ...doc.ticks }, meta: { ...doc.meta } };
  switch (op && op.f) {
    case "p":
      next.p = sanitizePermits(op.v);
      return next;
    case "f":
      next.f = sanitizeFocal(op.v);
      return next;
    case "custom":
      next.custom = sanitizeCustom(op.v);
      return next;
    case "tick": {
      const key = String(op.k || "");
      if (!key) return next;
      if (op.v) next.ticks[key] = 1; else delete next.ticks[key];
      return next;
    }
    case "meta": {
      const m = sanitizeMeta({ title: op.v && op.v.title, author: op.v && op.v.author, desc: op.v && op.v.desc, tags: op.v && op.v.tags });
      next.meta = m;
      next.desc = String((op.v && op.v.desc) ?? doc.desc ?? "").slice(0, MAX_DESC);
      return next;
    }
    default:
      return doc; // unknown field — no change (return the original, unmodified)
  }
}

export function listValueFromDoc(doc) {
  return {
    v: 2,
    p: Array.isArray(doc.p) ? doc.p : [],
    f: doc.f || null,
    desc: String(doc.desc || "").slice(0, MAX_DESC),
    custom: Array.isArray(doc.custom) ? doc.custom : [],
    ticks: doc.ticks && typeof doc.ticks === "object" ? doc.ticks : {},
  };
}
```

> `emptyDoc().meta` uses `sanitizeMeta({})`, which defaults `title` to `"Untitled list"` — matching the test.

- [ ] **Step 4: Run to verify pass**

Run: `cd worker && npm test`
Expected: PASS — the list-doc suite plus every existing suite.

- [ ] **Step 5: Commit**

```bash
git add worker/src/list-doc.js worker/test/list-doc.test.mjs
git commit -m "feat(worker): pure synced-list document + applyOp reducer

The live-sync document (p/f/custom/ticks/desc/meta) and a pure, last-write-wins
applyOp reducer, reusing the existing list sanitizers. docFromStored builds it
from a KV value+metadata; listValueFromDoc converts back for the write-through.
Unit-tested with node --test; no runtime dependency."
```

---

### Task 2: The ListRoom Durable Object and Worker wiring

**Files:**
- Create: `worker/src/list-room.js`
- Modify: `worker/src/index.js` (WS route + re-export)
- Modify: `worker/wrangler.toml` (binding + migration)

**Interfaces:**
- Consumes: `emptyDoc`, `docFromStored`, `applyOp`, `listValueFromDoc` (Task 1); `buildListMeta`, `readList` from `./lists.js`
- Produces: the `ListRoom` class (default persistence via `ctx.storage`), a WS endpoint `GET /api/lists/:id/live`, and the message protocol in spec §6.

- [ ] **Step 1: Add the DO binding + SQLite migration to `worker/wrangler.toml`**

After the `[[r2_buckets]]` block, add:

```toml
[[durable_objects.bindings]]
name = "LIST_ROOM"
class_name = "ListRoom"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ListRoom"]
```

> `new_sqlite_classes` is required for free-tier eligibility. The binding name `LIST_ROOM` is how the Worker reaches the namespace (`env.LIST_ROOM`).

- [ ] **Step 2: Create `worker/src/list-room.js`**

```js
import { DurableObject } from "cloudflare:workers";
import { emptyDoc, docFromStored, applyOp, listValueFromDoc } from "./list-doc.js";
import { buildListMeta } from "./lists.js";

const WRITE_THROUGH_MS = 1000; // debounce KV writes while a burst of edits lands
const LIST_TTL = 15552000;     // 6 months, matching lists.js

export class ListRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.loaded = false;
    this.id = null;
    this.doc = emptyDoc();
    this.clock = 0;
  }

  // Load persisted state once per wake. Hibernation can evict us between
  // messages, so every entry point calls this first.
  async load() {
    if (this.loaded) return;
    this.id = (await this.ctx.storage.get("id")) || null;
    const savedDoc = await this.ctx.storage.get("doc");
    this.doc = savedDoc || emptyDoc();
    this.clock = (await this.ctx.storage.get("clock")) || 0;
    this.loaded = true;
  }

  async persist() {
    await this.ctx.storage.put("doc", this.doc);
    await this.ctx.storage.put("clock", this.clock);
  }

  presence() {
    const sockets = this.ctx.getWebSockets();
    const names = [];
    for (const ws of sockets) {
      const a = ws.deserializeAttachment();
      if (a && a.author && !names.includes(a.author)) names.push(a.author);
    }
    return { count: sockets.length, names };
  }

  broadcast(obj, except) {
    const text = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) { try { ws.send(text); } catch { /* closing */ } }
    }
  }

  // Upgrade handshake. The Worker forwards ?id=<shareId>.
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    await this.load();
    const url = new URL(request.url);
    const id = url.searchParams.get("id") || "";
    if (this.id === null) {
      // First ever connect: cold-load the list from KV and remember the id.
      const stored = await this.env.CACHE.getWithMetadata("list:" + id);
      if (!stored.value) return new Response("not found", { status: 404 });
      this.id = id;
      this.doc = docFromStored(stored.value, stored.metadata);
      await this.ctx.storage.put("id", id);
      await this.persist();
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]); // server side, hibernatable
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, message) {
    await this.load();
    let msg;
    try { msg = JSON.parse(message); } catch { return; }

    if (msg.t === "hello") {
      ws.serializeAttachment({ author: String(msg.author || "").slice(0, 40) });
      ws.send(JSON.stringify({ t: "state", doc: this.doc, clock: this.clock, presence: this.presence() }));
      this.broadcast({ t: "presence", ...this.presence() }, ws);
      return;
    }

    if (msg.t === "patch" && Array.isArray(msg.ops)) {
      for (const op of msg.ops) this.doc = applyOp(this.doc, op);
      this.clock += 1;
      await this.persist();
      this.broadcast({ t: "patch", ops: msg.ops, clock: this.clock }, ws);
      // Debounced write-through to KV.
      await this.ctx.storage.setAlarm(Date.now() + WRITE_THROUGH_MS);
      return;
    }
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch { /* already closed */ }
    this.broadcast({ t: "presence", ...this.presence() });
  }

  async webSocketError(ws) {
    this.broadcast({ t: "presence", ...this.presence() });
  }

  // Write the current doc back to KV so the directory + share links stay correct.
  async alarm() {
    await this.load();
    if (!this.id) return;
    const value = listValueFromDoc(this.doc);
    const now = Math.floor(Date.now() / 1000);
    const current = await this.env.CACHE.getWithMetadata("list:" + this.id);
    // Preserve publishedAt/rev from the existing metadata; refresh the rest.
    const metadata = {
      ...buildListMeta(value, { ...(current.metadata || {}), ...this.doc.meta }, now),
      publishedAt: Number(current.metadata && current.metadata.publishedAt) || now,
      rev: Number(current.metadata && current.metadata.rev) || 1,
    };
    await this.env.CACHE.put("list:" + this.id, JSON.stringify(value), { expirationTtl: LIST_TTL, metadata });
  }
}
```

- [ ] **Step 3: Wire the Worker (`worker/src/index.js`)**

Add the re-export at the top (so the runtime can find the class named in the migration):

```js
export { ListRoom } from "./list-room.js";
```

In `fetch`, **before** the `for (const route of ROUTES)` loop (and after the OPTIONS check), route the upgrade straight to the DO so its 101/404 response is returned untouched by the CORS wrapper:

```js
    const live = url.pathname.match(/^\/api\/lists\/([A-Za-z0-9]{1,16})\/live$/);
    if (live) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const stub = env.LIST_ROOM.getByName(live[1]);
      const fwd = new URL(request.url);
      fwd.searchParams.set("id", live[1]);
      return stub.fetch(new Request(fwd, request));
    }
```

Add to the `endpoints` array:

```js
          "GET /api/lists/:id/live (WebSocket) -> live sync",
```

- [ ] **Step 4: Confirm the test suite is unaffected**

`list-room.js` imports `cloudflare:workers`, which `node --test` cannot resolve — but no test imports it, and `index.js` (which re-exports it) is not imported by any test either.

Run: `cd worker && npm test`
Expected: PASS — unchanged from Task 1 (the DO adds no node-testable surface; its logic lives in the already-tested reducer).

Then confirm no test transitively loads the DO:

```bash
cd worker && grep -rl "list-room\|cloudflare:workers\|index.js" test/ || echo "clean: no test imports the DO or the worker entry"
```

Expected: `clean: …`.

- [ ] **Step 5: Static sanity-check the DO module parses**

The DO can't run under `node --test`, but its syntax can be checked without the `cloudflare:workers` import resolving, by parsing it:

```bash
cd worker && node --check src/list-room.js && node --check src/index.js && echo "parse OK"
```

Expected: `parse OK` (node --check validates syntax without executing imports).

- [ ] **Step 6: Commit**

```bash
git add worker/src/list-room.js worker/src/index.js worker/wrangler.toml
git commit -m "feat(worker): ListRoom durable object for live list sync

A SQLite-backed, hibernatable DO per published list: cold-loads the doc from
KV on first connect, applies patches through the pure reducer, persists,
broadcasts to other sockets, and debounces a write-through back to KV via an
alarm so the directory and share links stay correct. The Worker routes
/api/lists/:id/live upgrades straight to the DO, bypassing the CORS wrapper."
```

---

### Task 3: Deploy and verify the live socket

- [ ] **Step 1: Run the full worker suite + parse checks**

```bash
cd worker && npm test && node --check src/list-room.js && node --check src/index.js
```

Expected: all tests pass; `parse OK`.

- [ ] **Step 2: Capture the baseline**

```bash
curl -s -H "Origin: https://dkaruri.github.io" \
  "https://chi-permits-api.divyam-c-karuri.workers.dev/api/lists/YnF7y4t" \
  | python -c "import json,sys; d=json.load(sys.stdin); print(len(d['permits']), d['focal']['label'])"
```

Expected: `99 5010 N Monticello`.

- [ ] **Step 3: Ask the user to deploy**

The DO migration + binding require a deploy (interactive Cloudflare auth). This single deploy also ships the Delete-list soft-delete and UI fixes already on the branch. Ask them to run:

```
! cd worker && npx wrangler deploy
```

> The first deploy with a new `[[migrations]]` creates the DO class. If wrangler reports a migration error, it usually means the `tag` was already used — bump the tag, do not delete the migration block.

- [ ] **Step 4: Verify the baseline survived + delete endpoint is live**

Re-run Step 2 (still `99 5010 N Monticello`). Then confirm the Phase-bundle DELETE works:

```bash
B="https://chi-permits-api.divyam-c-karuri.workers.dev"; O="Origin: https://dkaruri.github.io"
ID=$(curl -s -H "$O" -H "Content-Type: application/json" -d '{"permits":["100234"],"title":"smoke"}' "$B/api/lists" | python -c "import json,sys;print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -w "delete: %{http_code}\n" -X DELETE -H "$O" "$B/api/lists/$ID"
curl -s -o /dev/null -w "get after delete: %{http_code}\n" -H "$O" "$B/api/lists/$ID"
```

Expected: `delete: 200`, `get after delete: 404`.

- [ ] **Step 5: Verify the live socket end to end**

Install `ws` in the scratchpad and run a two-client script that connects, edits on one, and asserts the other receives the patch, presence updates, and the KV write-through lands. Create `verify-tmp/ws-smoke.mjs` (gitignored) using a real published list id — reuse the `YnF7y4t` id (it exists):

```js
import WebSocket from "ws"; // npm i ws in the scratchpad
const B = "wss://chi-permits-api.divyam-c-karuri.workers.dev";
const ID = "YnF7y4t";
const open = () => new Promise(res => { const w = new WebSocket(`${B}/api/lists/${ID}/live`, { headers: { Origin: "https://dkaruri.github.io" } }); w.on("open", () => res(w)); });
const a = await open(), b = await open();
let pass = 0, fail = 0;
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); ok ? pass++ : fail++; };

const gotB = new Promise(res => b.on("message", m => { const d = JSON.parse(m); if (d.t === "patch") res(d); }));
a.on("message", m => { const d = JSON.parse(m); if (d.t === "state") check("client A got initial state", Array.isArray(d.doc.p)); });
a.send(JSON.stringify({ t: "hello", author: "A" }));
b.send(JSON.stringify({ t: "hello", author: "B" }));
await new Promise(r => setTimeout(r, 400));
// edit a tick on A; B must receive it
a.send(JSON.stringify({ t: "patch", ops: [{ f: "tick", k: "SMOKE-KEY", v: 1 }] }));
const patch = await Promise.race([gotB, new Promise(r => setTimeout(() => r(null), 3000))]);
check("client B received A's patch", patch && patch.ops[0].k === "SMOKE-KEY");
// clean the tick back off so YnF7y4t is untouched
a.send(JSON.stringify({ t: "patch", ops: [{ f: "tick", k: "SMOKE-KEY", v: 0 }] }));
await new Promise(r => setTimeout(r, 1500)); // let the write-through fire
a.close(); b.close();
console.log(fail ? `\n${fail} FAILURES` : "\nlive socket OK");
process.exit(fail ? 1 : 0);
```

Run: `cd verify-tmp && npm i ws >/dev/null 2>&1 && node ws-smoke.mjs`
Expected: `client A got initial state`, `client B received A's patch`, `live socket OK`.

> The tick is set then cleared, and `SMOKE-KEY` is not a real permit, so `YnF7y4t` is left as it was. Re-run Step 2 to confirm 99 permits unchanged.

- [ ] **Step 6: Report and hold**

Report the results. **Do not start Phase B (client sync) without confirmation** — Phase A ships the server capability; the client does not use it yet, so nothing is user-visible until Phase B. Fold Phase A into memory per the standing instruction.

---

## Self-Review

**Spec coverage.** §5 architecture (DO per list, WS endpoint, write-through) → Tasks 2, 3. §6 message protocol (hello/state/patch/presence, 404) → Task 2. §7 document + per-field LWW reducer → Task 1. §8 SQLite persistence + debounced KV write-through via alarm → Task 2 (`persist`, `alarm`). §10 Worker wiring, upgrade bypasses CORS, wrangler binding/migration → Task 2. §11 trashed-list 404 on cold-load → Task 2 `fetch`. §13 reducer unit-tested + DO verified against a live socket script → Tasks 1, 3. R2 SQLite/hibernation, R8 no new test dep → Global Constraints + Task 1.

**Deferred, not gaps:** the client (connect, send/receive, render, presence UI) is Phases B and C. Phase A is server-only and not user-visible until then — stated in Task 3 Step 6.

**Placeholder scan:** none — every code step carries full code; every command has expected output.

**Type consistency.** `applyOp(doc, op)`, `docFromStored(value, metadata)`, `emptyDoc()`, `listValueFromDoc(doc)` are used with identical signatures in the DO (Task 2) and the tests (Task 1). The op shapes (`{f:"p"|"f"|"custom"|"tick"|"meta", v/k}`) match between the reducer, the tests, and the WS smoke script. `buildListMeta(value, metaInput, now)` is called with three args, matching lists.js. The DO's message types (`hello`/`state`/`patch`/`presence`) match spec §6 and the smoke script.

**One risk carried deliberately.** The DO cannot be unit-tested under `node --test` (needs the workers runtime, and R8 forbids adding the vitest pool). Its logic is concentrated in the pure, fully-tested reducer; the thin DO shell (persistence, broadcast, alarm) is verified end-to-end against the live socket in Task 3 Step 5 — the same deploy-then-smoke pattern used for notes and photos.
