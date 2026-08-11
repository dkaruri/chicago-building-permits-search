# Shareable Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user share their saved permit list (permit order + focal start) as a short `list.html#s=<id>` URL that another person opens to load the same list.

**Architecture:** The list is stored in Cloudflare KV via the existing Worker, keyed by a short random id. A new `/api/lists` endpoint creates (`POST`) and fetches (`GET`) lists. `docs/list.html` gets a Share action (sender) and an `applySharedList()` receiver wired into `init()`.

**Tech Stack:** Vanilla JS Cloudflare Worker (ES modules), `env.CACHE` KV; static `docs/list.html` (vanilla JS). Worker tests via `node --test`. Client verified headless (Playwright + cached Chromium).

## Global Constraints

- Reuse the existing `CACHE` KV namespace with a `list:` key prefix — no `wrangler.toml` change, no new namespace.
- KV TTL: `expirationTtl: 15552000` (180 days / 6 months).
- Limits: ≤ 220 permits; each permit `^[A-Za-z0-9-]{1,16}$`; focal `label` ≤ 120 chars; request body ≤ 8192 bytes.
- Share id: 7 chars from base62 (`crypto.getRandomValues`).
- `API_BASE = "https://chi-permits-api.divyam-c-karuri.workers.dev"` (already defined in `list.html`).
- Shared payload = permit order + focal only. NEVER notes.
- NEVER stage `worker/package.json`, `worker/node_modules/`, `worker/.wrangler/` (pre-existing WIP).
- Worker responses from handlers are plain `Response`; `index.js` adds CORS. `corsHeaders` must allow `POST`.
- Windows: run `node`/`git` via the Bash tool; serve docs with `python -m http.server`.

---

### Task 1: Worker pure helpers (id + validation)

**Files:**
- Create: `worker/src/lists.js`
- Test: `worker/test/lists.test.mjs`

**Interfaces:**
- Produces: `makeShareId(len=7): string`, `sanitizePermits(value): string[]`, `sanitizeFocal(value): {lat,lon,label}|null` — exported from `worker/src/lists.js`.

- [ ] **Step 1: Write the failing test**

Create `worker/test/lists.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { makeShareId, sanitizePermits, sanitizeFocal } from "../src/lists.js";

test("makeShareId is 7 base62 chars and varies", () => {
  const a = makeShareId();
  assert.match(a, /^[0-9A-Za-z]{7}$/);
  assert.notEqual(a, makeShareId());
});

test("sanitizePermits keeps valid, dedupes, drops bad, caps at 220", () => {
  assert.deepEqual(sanitizePermits(["100234", "B200461632", "100234"]), ["100234", "B200461632"]);
  assert.deepEqual(sanitizePermits(["ok-1", "bad space", "sql'; DROP", "toolong01234567890"]), ["ok-1"]);
  assert.equal(sanitizePermits(Array.from({ length: 300 }, (_, i) => "1000000" + i)).length, 220);
  assert.deepEqual(sanitizePermits("nope"), []);
});

test("sanitizeFocal validates coords and caps label", () => {
  assert.deepEqual(sanitizeFocal({ lat: 41.9, lon: -87.6, label: "HQ" }), { lat: 41.9, lon: -87.6, label: "HQ" });
  assert.equal(sanitizeFocal({ lat: "x", lon: -87.6 }), null);
  assert.equal(sanitizeFocal(null), null);
  assert.equal(sanitizeFocal({ lat: 41.9, lon: -87.6, label: "x".repeat(200) }).label.length, 120);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && node --test test/lists.test.mjs`
Expected: FAIL — `Cannot find module '../src/lists.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `worker/src/lists.js`:

```js
const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const PERMIT_RE = /^[A-Za-z0-9-]{1,16}$/;
const MAX_PERMITS = 220;

export function makeShareId(len = 7) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += ID_ALPHABET[bytes[i] % 62];
  return out;
}

export function sanitizePermits(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const s = String(item);
    if (PERMIT_RE.test(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s);
      if (out.length >= MAX_PERMITS) break;
    }
  }
  return out;
}

export function sanitizeFocal(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: String(value.label ?? "").slice(0, 120) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && node --test test/lists.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/lists.js worker/test/lists.test.mjs
git commit -m "feat(worker): share-list id + validation helpers"
```

---

### Task 2: Worker handleLists (POST create / GET fetch) + router wiring

**Files:**
- Modify: `worker/src/lists.js` (add `handleLists`)
- Modify: `worker/src/index.js` (route + pass `request` + CORS `POST`)
- Test: `worker/test/lists.test.mjs` (add handler cases)

**Interfaces:**
- Consumes: `makeShareId`, `sanitizePermits`, `sanitizeFocal` (Task 1).
- Produces: `handleLists(url: URL, env, request: Request): Promise<Response>`. `POST /api/lists` body `{permits, focal}` → `200 {id}`; `GET /api/lists/:id` → `200 {permits, focal}` or `404`.

- [ ] **Step 1: Write the failing test**

Append to `worker/test/lists.test.mjs`:

```js
import { handleLists } from "../src/lists.js";

function fakeKV() {
  const map = new Map();
  return { map, async get(k) { return map.get(k) ?? null; }, async put(k, v) { map.set(k, v); } };
}
const ENV = () => ({ CACHE: fakeKV() });
const post = (body) => new Request("https://w/api/lists", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (id) => new Request(`https://w/api/lists/${id}`, { method: "GET" });

test("POST then GET round-trips permits + focal", async () => {
  const env = ENV();
  const created = await handleLists(new URL("https://w/api/lists"), env, post({ permits: ["100234", "100987"], focal: { lat: 41.9, lon: -87.6, label: "HQ" } }));
  assert.equal(created.status, 200);
  const { id } = await created.json();
  assert.match(id, /^[0-9A-Za-z]{7}$/);
  const fetched = await handleLists(new URL(`https://w/api/lists/${id}`), env, get(id));
  assert.equal(fetched.status, 200);
  assert.deepEqual(await fetched.json(), { permits: ["100234", "100987"], focal: { lat: 41.9, lon: -87.6, label: "HQ" } });
});

test("POST with no valid permits is 400", async () => {
  const res = await handleLists(new URL("https://w/api/lists"), ENV(), post({ permits: ["bad space"] }));
  assert.equal(res.status, 400);
});

test("POST oversized body is 413", async () => {
  const res = await handleLists(new URL("https://w/api/lists"), ENV(), post("x".repeat(9000)));
  assert.equal(res.status, 413);
});

test("GET unknown id is 404", async () => {
  const res = await handleLists(new URL("https://w/api/lists/ZzZz999"), ENV(), get("ZzZz999"));
  assert.equal(res.status, 404);
});

test("stored value carries a 6-month TTL", async () => {
  const env = ENV();
  let ttl;
  env.CACHE.put = async (k, v, opts) => { ttl = opts && opts.expirationTtl; };
  await handleLists(new URL("https://w/api/lists"), env, post({ permits: ["100234"], focal: null }));
  assert.equal(ttl, 15552000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && node --test test/lists.test.mjs`
Expected: FAIL — `handleLists is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the TOP of `worker/src/lists.js` (after the existing consts):

```js
const LIST_TTL = 15552000;
const MAX_BODY = 8192;
const ID_RE = /^[A-Za-z0-9]{1,16}$/;

function resp(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export async function handleLists(url, env, request) {
  const isCollection = url.pathname === "/api/lists" || url.pathname === "/api/lists/";
  if (request.method === "POST" && isCollection) {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return resp({ error: "too large" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return resp({ error: "bad json" }, 400); }
    const permits = sanitizePermits(body && body.permits);
    if (!permits.length) return resp({ error: "no valid permits" }, 400);
    const focal = sanitizeFocal(body && body.focal);
    const id = makeShareId();
    await env.CACHE.put("list:" + id, JSON.stringify({ v: 1, p: permits, f: focal }), { expirationTtl: LIST_TTL });
    return resp({ id }, 200);
  }
  if (request.method === "GET" && !isCollection) {
    const id = url.pathname.replace(/^\/api\/lists\//, "");
    if (!ID_RE.test(id)) return resp({ error: "not found" }, 404);
    const stored = await env.CACHE.get("list:" + id);
    if (!stored) return resp({ error: "not found" }, 404);
    let data;
    try { data = JSON.parse(stored); } catch { return resp({ error: "not found" }, 404); }
    return resp({ permits: data.p || [], focal: data.f || null }, 200);
  }
  return resp({ error: "method not allowed" }, 405);
}
```

Modify `worker/src/index.js`:

Add import at top (after existing imports):
```js
import { handleLists } from "./lists.js";
```

Add to the `ROUTES` array (after the stats route):
```js
  { pattern: /^\/api\/lists/, handler: handleLists },
```

Change the CORS methods line in `corsHeaders`:
```js
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
```

Change the handler call inside the `for` loop (currently `route.handler(url, env)`):
```js
          const response = await route.handler(url, env, request);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && node --test test/lists.test.mjs`
Expected: PASS (8 tests total).

- [ ] **Step 5: Verify index.js still parses**

Run: `cd worker && node --check src/index.js && node --check src/lists.js`
Expected: no output (exit 0).

- [ ] **Step 6: Commit**

```bash
git add worker/src/lists.js worker/src/index.js worker/test/lists.test.mjs
git commit -m "feat(worker): /api/lists create + fetch endpoints"
```

---

### Task 3: Client — sender Share action

**Files:**
- Modify: `docs/list.html` (add `shareUserList`, `focalShareData`, `showShareFallback`; add Share button to the More menu)

**Interfaces:**
- Consumes: `state.userPermitNumbers`, `state.focalPoint`, `API_BASE`, `withListAction`, `announceListAction`, `renderRouteSummary`, `clearUserRoute` (existing in `list.html`).
- Produces: `shareUserList()` (onclick target), builds `${location.origin}${location.pathname}#s=${id}`.

- [ ] **Step 1: Add the Share menu item**

In `docs/list.html`, in the More menu panel (the `<div class="action-menu-panel" ...>` around line 2892), add as the FIRST item, before "Sort by drive time":

```html
                <button role="menuitem" data-list-action onclick="shareUserList()">Share list<span class="menu-hint">Copy a short link</span></button>
                <div class="action-menu-sep" role="separator"></div>
```

- [ ] **Step 2: Add the sender functions**

In `docs/list.html`, immediately AFTER the `function togglePermitMore(btn) { ... }` block (near the other list helpers), add:

```js
    function focalShareData() {
      const fp = state.focalPoint;
      if (!fp || !fp.resolved || !Number.isFinite(Number(fp.latitude)) || !Number.isFinite(Number(fp.longitude))) return null;
      return { lat: Number(fp.latitude), lon: Number(fp.longitude), label: fp.address || fp.label || "" };
    }

    function showShareFallback(url) {
      state.userRouteSummary = `Share link: ${url}`;
      renderRouteSummary();
      announceListAction("Share link ready — copy it from the status line.");
    }

    async function shareUserList() {
      if (!state.userPermitNumbers.length) {
        clearUserRoute("Add permits to your list before sharing.");
        return;
      }
      await withListAction("Creating share link...", async () => {
        let id;
        try {
          const res = await fetch(`${API_BASE}/api/lists`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ permits: state.userPermitNumbers, focal: focalShareData() }),
          });
          if (!res.ok) throw new Error("share failed");
          id = (await res.json()).id;
        } catch {
          clearUserRoute("Sharing needs the live site. Try again on the published page.");
          return;
        }
        const shareUrl = `${location.origin}${location.pathname}#s=${id}`;
        if (navigator.share) {
          try { await navigator.share({ title: "Chicago Permit List", url: shareUrl }); return; }
          catch { /* cancelled or blocked after await — fall through to copy */ }
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(shareUrl);
            state.userRouteSummary = "Share link copied to clipboard.";
            renderRouteSummary();
            announceListAction("Share link copied.");
            return;
          } catch { /* fall through */ }
        }
        showShareFallback(shareUrl);
      });
    }
```

- [ ] **Step 3: Headless verification (sender)**

Create `<scratchpad>/verify_share_sender.mjs` (scratchpad dir, not committed):

```js
import { chromium } from "playwright";
import assert from "node:assert";
const EXE = "C:/Users/divya/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";
const browser = await chromium.launch({ headless: true, executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
let posted = null;
await page.route("**/api/lists", async r => { posted = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "Xa9Kp2q" }) }); });
await page.route("**/api/stats", r => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
await page.goto("http://localhost:8791/list.html", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof shareUserList === "function", { timeout: 15000 });
await page.waitForTimeout(1000);
const copied = await page.evaluate(async () => {
  const clip = [];
  navigator.clipboard.writeText = async (t) => { clip.push(t); };
  state.userPermitMap = new Map(); state.userPermitNumbers = ["100234", "100987"];
  state.userPermitMap.set("100234", { permit_number: "100234", address: "1 State St", latitude: 41.88, longitude: -87.63 });
  state.userPermitMap.set("100987", { permit_number: "100987", address: "2 Wacker", latitude: 41.89, longitude: -87.64 });
  state.focalPoint = { address: "HQ", latitude: 41.87, longitude: -87.62, resolved: true };
  await shareUserList();
  return clip[0];
});
console.log("posted:", posted, "\ncopied url:", copied);
assert.deepEqual(posted.permits, ["100234", "100987"], "wrong permits posted");
assert.deepEqual(posted.focal, { lat: 41.87, lon: -87.62, label: "HQ" }, "wrong focal posted");
assert.match(copied, /#s=Xa9Kp2q$/, "share url not built/copied");
console.log("ok - sender posts list + copies #s= link");
await browser.close();
```

- [ ] **Step 4: Run it**

Run (serve first): `cd docs && python -m http.server 8791 & sleep 2 && node <scratchpad>/verify_share_sender.mjs`
Expected: `ok - sender posts list + copies #s= link`. Then stop the server.

- [ ] **Step 5: Commit**

```bash
git add docs/list.html
git commit -m "feat(list): Share list action posts to /api/lists and copies short link"
```

---

### Task 4: Client — recipient applySharedList + init wiring

**Files:**
- Modify: `docs/list.html` (add `applySharedList`; call it in `init()`)

**Interfaces:**
- Consumes: `API_BASE`, `state.userPermitNumbers`, `state.focalPoint`, `saveUserListCookie`, `saveFocalPoint`, `renderFocalStatus`, `ensurePermitMap`, `clearUserRoute`, `clean`, `fmt`, `$` (existing).
- Produces: `applySharedList()` — reads `#s=<id>`, fetches list, replace-with-confirm, strips hash.

- [ ] **Step 1: Add applySharedList**

In `docs/list.html`, immediately AFTER `function applyInitialUrlParams() { ... }` (ends ~line 3148), add:

```js
    async function applySharedList() {
      const id = new URLSearchParams(location.hash.slice(1)).get("s");
      if (!id || !/^[A-Za-z0-9]{1,16}$/.test(id)) return;
      const stripHash = () => history.replaceState(null, "", location.pathname);
      let data;
      try {
        const res = await fetch(`${API_BASE}/api/lists/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error("not found");
        data = await res.json();
      } catch {
        clearUserRoute("This shared list link has expired or could not be loaded.");
        stripHash();
        return;
      }
      const permits = Array.isArray(data.permits) ? data.permits.map(clean).filter(Boolean) : [];
      if (!permits.length) { stripHash(); return; }
      const existing = state.userPermitNumbers.length;
      if (existing && !window.confirm(`Replace your saved list (${fmt(existing)} permits) with this shared list (${fmt(permits.length)} permits)?`)) {
        stripHash();
        return;
      }
      state.userPermitNumbers = permits;
      saveUserListCookie();
      const f = data.focal;
      if (f && Number.isFinite(Number(f.lat)) && Number.isFinite(Number(f.lon))) {
        state.focalPoint = { address: f.label || "", label: f.label || "", latitude: Number(f.lat), longitude: Number(f.lon), resolved: true, permitNumber: null, matched: false };
      } else {
        state.focalPoint = null;
      }
      saveFocalPoint();
      const focalInput = $("focal-input");
      if (focalInput) focalInput.value = state.focalPoint ? (state.focalPoint.address || "") : "";
      renderFocalStatus();
      await ensurePermitMap();
      stripHash();
    }
```

- [ ] **Step 2: Wire into init()**

In `docs/list.html` `init()`, after `renderFocalStatus();` (line ~3264) and before `applyInitialUrlParams();`, add:

```js
      await applySharedList();
```

- [ ] **Step 3: Headless verification (recipient)**

Create `<scratchpad>/verify_share_recipient.mjs`:

```js
import { chromium } from "playwright";
import assert from "node:assert";
const EXE = "C:/Users/divya/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";
const FIXTURE = { permits: ["100234", "100987"], focal: { lat: 41.87, lon: -87.62, label: "HQ" } };
const browser = await chromium.launch({ headless: true, executablePath: EXE });

async function open(hash, { existing = 0, accept = true, listStatus = 200 } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  page.on("dialog", d => accept ? d.accept() : d.dismiss());
  await page.route("**/api/stats", r => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/api/lists/**", r => r.fulfill({ status: listStatus, contentType: "application/json", body: listStatus === 200 ? JSON.stringify(FIXTURE) : JSON.stringify({ error: "not found" }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE.permits.map(p => ({ permit_: p, latitude: "41.9", longitude: "-87.6", street_number: "1", street_name: "Test" }))) }));
  if (existing) await page.addInitScript(([n]) => { try { localStorage.setItem("chi_permit_user_list", Array.from({ length: n }, (_, i) => "999" + i).join("|")); } catch {} }, [existing]);
  await page.goto(`http://localhost:8791/list.html${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof applySharedList === "function", { timeout: 15000 });
  await page.waitForTimeout(1200);
  const out = await page.evaluate(() => ({ permits: state.userPermitNumbers, focal: state.focalPoint && { lat: state.focalPoint.latitude, lon: state.focalPoint.longitude, label: state.focalPoint.address }, hash: location.hash }));
  await page.close();
  return out;
}

// empty list -> loads directly, hash stripped
let r = await open("#s=Xa9Kp2q");
assert.deepEqual(r.permits, ["100234", "100987"], "shared permits not loaded");
assert.deepEqual(r.focal, { lat: 41.87, lon: -87.62, label: "HQ" }, "focal not set");
assert.equal(r.hash, "", "hash not stripped");

// existing list + confirm accepted -> replaced
r = await open("#s=Xa9Kp2q", { existing: 6, accept: true });
assert.deepEqual(r.permits, ["100234", "100987"], "replace-confirm accept did not replace");

// existing list + confirm cancelled -> kept
r = await open("#s=Xa9Kp2q", { existing: 6, accept: false });
assert.equal(r.permits.length, 6, "cancel should keep local list");

// 404 -> local list untouched, hash stripped
r = await open("#s=Xa9Kp2q", { existing: 6, listStatus: 404 });
assert.equal(r.permits.length, 6, "404 should not touch local list");
assert.equal(r.hash, "", "hash not stripped on 404");

console.log("ok - recipient loads/replaces/cancels/expires correctly");
await browser.close();
```

- [ ] **Step 4: Run it**

Run (serve first): `cd docs && python -m http.server 8791 & sleep 2 && node <scratchpad>/verify_share_recipient.mjs`
Expected: `ok - recipient loads/replaces/cancels/expires correctly`. Then stop the server.

- [ ] **Step 5: Commit**

```bash
git add docs/list.html
git commit -m "feat(list): load shared lists from #s= with replace-confirm"
```

---

### Task 5: Docs + push + deploy handoff

**Files:**
- Modify: `worker/src/index.js` (add `/api/lists` lines to the API index `endpoints` array — keep discoverability accurate)

- [ ] **Step 1: Update the API index endpoints list**

In `worker/src/index.js`, in the fallback `json({ name..., endpoints: [...] })`, add these two lines to the `endpoints` array:

```js
          "POST /api/lists  (body: {permits, focal}) -> {id}",
          "GET /api/lists/:id -> {permits, focal}",
```

- [ ] **Step 2: Re-run all worker tests**

Run: `cd worker && node --test test/lists.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 3: Commit + push**

```bash
git add worker/src/index.js
git commit -m "docs(worker): list endpoints in API index"
git push origin main
```

- [ ] **Step 4: Fold into memory** (standing instruction — see `chi-permits-fold-memory-after-push`)

Append the shipped feature to `chi-permits-2026-07-20.md` (flip the "IN PROGRESS" note to shipped, with commit hashes) and refresh the `MEMORY.md` index line.

- [ ] **Step 5: Deploy handoff (USER RUNS)**

Tell the user to deploy the Worker so `/api/lists` goes live:
```
cd "C:\Users\divya\Documents\Codex\2026-06-28\install-the-mcp-server-at-https\work\chicago-building-permits-mcp\worker"
npx wrangler whoami   # confirm auth
npx wrangler deploy
```
Then verify: `npx wrangler tail` while tapping Share on the live site. Until deployed, the Share button shows "Sharing needs the live site."

---

## Self-Review

**Spec coverage:** Worker create/fetch + KV `list:` prefix + TTL (Tasks 1–2); CORS POST + router request pass-through (Task 2); sender Share + navigator.share/clipboard fallback (Task 3); recipient applySharedList + replace-confirm + hash strip + focal (Task 4); validation/limits (Tasks 1–2); testing (unit in Tasks 1–2, headless in Tasks 3–4); deploy handoff + memory fold (Task 5). All spec sections covered.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `makeShareId`/`sanitizePermits`/`sanitizeFocal`/`handleLists` names and shapes match across tasks; focal wire shape `{lat,lon,label}` consistent sender↔worker↔recipient; stored shape `{v,p,f}` consistent between POST put and GET get; `#s=` id regex `^[A-Za-z0-9]{1,16}$` identical in worker GET and client.
