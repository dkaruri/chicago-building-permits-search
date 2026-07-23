# List Directory — Phase 1 (Lists) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single browser-local permit list with many named lists plus a public, searchable directory of published lists, without breaking the live share link `#s=YnF7y4t`.

**Architecture:** The Cloudflare Worker gains a v2 list schema whose directory-facing fields ride on Workers KV *metadata*, so `KV.list()` renders the directory in one operation and there is no second key to desync. The three static pages replace `chi_permit_user_list` (a pipe-joined string) with `chi_permit_lists` (a JSON object of named lists), and `list.html` gains a directory view that renders before any single list.

**Tech Stack:** Vanilla ES2022 in self-contained HTML files (no build step, no modules), Cloudflare Workers + KV, `node --test` for Worker units, Playwright for page verification.

## Global Constraints

- **Spec:** `superpowers/specs/2026-07-23-list-directory-design.md`. Every decision D1–D16 in §4 is binding.
- **No build step.** `docs/*.html` are self-contained. No bundler, no npm dependency, no ES module imports in page code.
- **No new runtime dependencies** in `worker/`. `wrangler` stays the only devDependency.
- **Duplicated code is the project's design.** `list.html`, `index.html` and `map.html` each carry their own copy of shared functions. Copies must be **byte-identical**. After any multi-file edit, verify with the command in Task 5 Step 7.
- **Line endings:** `docs/list.html` is CRLF in git; `index.html` and `map.html` are LF. Always stage list.html as `git -c core.autocrlf=false add docs/list.html`. Staging it normally produces a spurious ~6,200-line diff.
- **Never stage `worker/` WIP:** `worker/package.json` is modified and `worker/.wrangler/`, `worker/node_modules/`, `worker/package-lock.json` are untracked. These are pre-existing and not ours. Task 1 Step 5 is the *only* permitted `worker/package.json` change — stage it with an explicit path, never `git add worker/`.
- **List cap:** `userListLimit = 220`, per list (D11).
- **Permit-number validation stays tight:** `/^[A-Za-z0-9-]{1,16}$/` in `sanitizePermits`. Do not loosen it.
- **Tag slots are 0–9 only** (D9). The ten light/dark pairs in Task 4 are measured values — do not substitute other hexes.
- **`body.modal-open { animation: none }`** in `list.html` and `index.html` is load-bearing. Never remove it. Any new `transform`, `filter`, `will-change` or `contain` on an ancestor of `#permit-modal` reintroduces a bug where the overlay renders entirely off-screen on mobile.
- **Verification recipe:** serve with `python -m http.server 8791 --directory docs`. Playwright is not a repo dependency — install into the scratchpad and launch the cached binary at `C:\Users\divya\AppData\Local\ms-playwright\chromium_headless_shell-1228\chrome-headless-shell-win64\chrome-headless-shell.exe`. In `page.evaluate`, `state` is a bare global — reference it as `state`, never `window.state`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `worker/src/lists.js` | List CRUD, v1/v2 schema, metadata build, revisions | Modify — currently 68 lines, grows to ~200 |
| `worker/src/tags.js` | Tag slot registry | **Create** |
| `worker/src/index.js` | Route table | Modify — add one route |
| `worker/test/lists.test.mjs` | Worker list units | Modify |
| `worker/test/tags.test.mjs` | Worker tag units | **Create** |
| `worker/package.json` | Add `test` script | Modify (one line) |
| `docs/list.html` | Multi-list store, directory view, details dialog, picker | Modify |
| `docs/index.html` | Multi-list store, picker | Modify |
| `docs/map.html` | Multi-list store, picker | Modify |

`worker/src/lists.js` is split at Task 3: revision handling moves to `worker/src/revisions.js` rather than pushing one file past ~200 lines.

---

### Task 1: Worker — v2 schema and KV metadata

**Files:**
- Modify: `worker/src/lists.js:13-37` (`handleLists`), add `buildListMeta` and `sanitizeMeta`
- Modify: `worker/package.json` (add `test` script)
- Test: `worker/test/lists.test.mjs`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `sanitizeMeta(body) -> { title, author, blurb, tags, publishedAt, editedAt }` — `tags` is `Array<[string, number]>`
  - `buildListMeta(stored, now) -> object` clamped to ≤1024 bytes when JSON-encoded
  - `readList(stored) -> { v, p, f, desc, custom, ticks }` normalising v1 payloads to v2 shape

- [ ] **Step 1: Add the test script so tests can run at all**

`worker/package.json` currently has no `test` script. Add one line to `scripts`:

```json
    "test": "node --test test/",
```

The `scripts` block becomes:

```json
  "scripts": {
    "seed": "node seed-kv.js",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "tail": "wrangler tail",
    "test": "node --test test/"
  },
```

- [ ] **Step 2: Write the failing tests**

Append to `worker/test/lists.test.mjs`, and extend its import line to:

```js
import { makeShareId, sanitizePermits, sanitizeFocal, sanitizeMeta, buildListMeta, readList } from "../src/lists.js";
```

```js
test("readList normalises a v1 payload to v2 shape", () => {
  const v1 = JSON.stringify({ v: 1, p: ["101082609"], f: { lat: 41.9, lon: -87.6, label: "HQ" } });
  const out = readList(v1);
  assert.equal(out.v, 2);
  assert.deepEqual(out.p, ["101082609"]);
  assert.deepEqual(out.f, { lat: 41.9, lon: -87.6, label: "HQ" });
  assert.equal(out.desc, "");
  assert.deepEqual(out.custom, []);
  assert.deepEqual(out.ticks, {});
});

test("readList returns null for unparseable storage", () => {
  assert.equal(readList("{not json"), null);
  assert.equal(readList(null), null);
});

test("sanitizeMeta clamps title, blurb and tag count", () => {
  const out = sanitizeMeta({
    title: "T".repeat(200),
    author: "A".repeat(200),
    desc: "D".repeat(500),
    tags: Array.from({ length: 20 }, (_, i) => [`tag${i}`, i % 10]),
  });
  assert.equal(out.title.length, 80);
  assert.equal(out.author.length, 40);
  assert.equal(out.blurb.length, 160);
  assert.equal(out.tags.length, 8);
});

test("sanitizeMeta drops malformed tags and clamps slots to 0-9", () => {
  const out = sanitizeMeta({ tags: [["ok", 3], ["bad", 99], ["neg", -1], "notpair", [123, 1]] });
  assert.deepEqual(out.tags, [["ok", 3]]);
});

test("sanitizeMeta defaults an empty title to Untitled list", () => {
  assert.equal(sanitizeMeta({}).title, "Untitled list");
});

test("buildListMeta stays under the 1024 byte KV metadata limit", () => {
  const stored = {
    v: 2,
    p: Array.from({ length: 220 }, (_, i) => "10000" + i),
    desc: "D".repeat(500),
    custom: [],
  };
  const meta = buildListMeta(stored, {
    title: "T".repeat(80),
    author: "A".repeat(40),
    tags: Array.from({ length: 8 }, (_, i) => ["a".repeat(24), i]),
  }, 1753228800);
  const size = new TextEncoder().encode(JSON.stringify(meta)).length;
  assert.ok(size <= 1024, `metadata was ${size} bytes`);
  assert.equal(meta.count, 220);
  assert.equal(meta.publishedAt, 1753228800);
});

test("buildListMeta counts custom stops toward count", () => {
  const meta = buildListMeta(
    { v: 2, p: ["101082609"], desc: "", custom: [{ id: "c_1", addr: "x" }] },
    { title: "T" },
    1
  );
  assert.equal(meta.count, 2);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd worker && npm test`
Expected: FAIL — `SyntaxError: The requested module '../src/lists.js' does not provide an export named 'sanitizeMeta'`

- [ ] **Step 4: Implement**

In `worker/src/lists.js`, add these constants beside the existing ones at the top:

```js
const MAX_TITLE = 80;
const MAX_AUTHOR = 40;
const MAX_BLURB = 160;
const MAX_TAGS = 8;
const MAX_TAG_LEN = 24;
```

Add these three exported functions after `sanitizeFocal`:

```js
export function readList(stored) {
  if (!stored) return null;
  let data;
  try { data = JSON.parse(stored); } catch { return null; }
  if (!data || typeof data !== "object") return null;
  return {
    v: 2,
    p: Array.isArray(data.p) ? data.p : [],
    f: data.f || null,
    desc: typeof data.desc === "string" ? data.desc : "",
    custom: Array.isArray(data.custom) ? data.custom : [],
    ticks: data.ticks && typeof data.ticks === "object" ? data.ticks : {},
  };
}

export function sanitizeMeta(body) {
  const b = body && typeof body === "object" ? body : {};
  const str = (v, n) => String(v ?? "").slice(0, n);
  const tags = (Array.isArray(b.tags) ? b.tags : [])
    .filter(t => Array.isArray(t) && t.length === 2
      && typeof t[0] === "string" && t[0].length > 0 && t[0].length <= MAX_TAG_LEN
      && Number.isInteger(t[1]) && t[1] >= 0 && t[1] <= 9)
    .slice(0, MAX_TAGS);
  return {
    title: str(b.title, MAX_TITLE) || "Untitled list",
    author: str(b.author, MAX_AUTHOR),
    blurb: str(b.desc, MAX_BLURB),
    tags,
  };
}

export function buildListMeta(stored, metaInput, now) {
  const meta = sanitizeMeta({ ...metaInput, desc: metaInput?.blurb ?? stored?.desc });
  const permits = Array.isArray(stored?.p) ? stored.p.length : 0;
  const customs = Array.isArray(stored?.custom) ? stored.custom.length : 0;
  return {
    title: meta.title,
    author: meta.author,
    blurb: meta.blurb,
    tags: meta.tags,
    count: permits + customs,
    publishedAt: Number(now) || 0,
    editedAt: Number(now) || 0,
    rev: 1,
  };
}
```

Then rewrite the POST branch of `handleLists` to write metadata alongside the value. Replace lines 15–26 with:

```js
  if (request.method === "POST" && isCollection) {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return resp({ error: "too large" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return resp({ error: "bad json" }, 400); }
    const permits = sanitizePermits(body && body.permits);
    if (!permits.length) return resp({ error: "no valid permits" }, 400);
    const focal = sanitizeFocal(body && body.focal);
    const id = makeShareId();
    const now = Math.floor(Date.now() / 1000);
    const value = { v: 2, p: permits, f: focal, desc: String(body.desc ?? "").slice(0, 2000), custom: [], ticks: {} };
    const metadata = buildListMeta(value, body, now);
    await env.CACHE.put("list:" + id, JSON.stringify(value), { expirationTtl: LIST_TTL, metadata });
    return resp({ id }, 200);
  }
```

And rewrite the GET branch (lines 27–35) to use `readList`:

```js
  if (request.method === "GET" && !isCollection) {
    const id = url.pathname.replace(/^\/api\/lists\//, "");
    if (!ID_RE.test(id)) return resp({ error: "not found" }, 404);
    const { value: stored, metadata } = await env.CACHE.getWithMetadata("list:" + id);
    const data = readList(stored);
    if (!data) return resp({ error: "not found" }, 404);
    return resp({
      permits: data.p,
      focal: data.f,
      desc: data.desc,
      custom: data.custom,
      ticks: data.ticks,
      meta: metadata || null,
    }, 200);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS — all tests, including the 3 pre-existing ones.

- [ ] **Step 6: Verify the live v1 list still reads**

Run:

```bash
curl -s -H "Origin: https://dkaruri.github.io" \
  "https://chi-permits-api.divyam-c-karuri.workers.dev/api/lists/YnF7y4t" | head -c 300
```

Expected: 100 permit numbers and the `5010 N Monticello` focal point. This runs against the *deployed* Worker, so it is a regression baseline, not a test of your change — record the output and re-run it after deploy.

- [ ] **Step 7: Commit**

```bash
git add worker/src/lists.js worker/test/lists.test.mjs worker/package.json
git commit -m "feat(worker): v2 list schema with KV metadata

Directory fields ride on KV metadata so KV.list() renders the directory in
one operation with no second key to desync. readList normalises v1 payloads,
so the live YnF7y4t share link keeps working."
```

---

### Task 2: Worker — directory listing with cursor pagination

**Files:**
- Modify: `worker/src/lists.js` (`handleLists`, add `filterEntries`)
- Test: `worker/test/lists.test.mjs`

**Interfaces:**
- Consumes: `sanitizeMeta` from Task 1
- Produces: `filterEntries(entries, q, tag) -> entries[]` where an entry is `{ name, metadata }`; `GET /api/lists` returning `{ lists: [{id, ...metadata}], cursor: string|null }`

- [ ] **Step 1: Write the failing tests**

Extend the import to include `filterEntries`. Append:

```js
const ENTRIES = [
  { name: "list:aaa", metadata: { title: "North Side Roof Runs", author: "Divyam", blurb: "Albany Park", tags: [["roofing", 0]], count: 100 } },
  { name: "list:bbb", metadata: { title: "Logan Square tuckpointing", author: "M. Reyes", blurb: "masonry", tags: [["masonry", 9]], count: 62 } },
  { name: "list:ccc", metadata: { title: "Stalled jobs", author: "anonymous", blurb: "watchlist", tags: [], count: 23 } },
];

test("filterEntries matches title, author, blurb case-insensitively", () => {
  assert.deepEqual(filterEntries(ENTRIES, "roof", "").map(e => e.name), ["list:aaa"]);
  assert.deepEqual(filterEntries(ENTRIES, "REYES", "").map(e => e.name), ["list:bbb"]);
  assert.deepEqual(filterEntries(ENTRIES, "watchlist", "").map(e => e.name), ["list:ccc"]);
});

test("filterEntries matches tag names", () => {
  assert.deepEqual(filterEntries(ENTRIES, "masonry", "").map(e => e.name), ["list:bbb"]);
});

test("filterEntries tag filter is exact, not substring", () => {
  assert.deepEqual(filterEntries(ENTRIES, "", "roofing").map(e => e.name), ["list:aaa"]);
  assert.deepEqual(filterEntries(ENTRIES, "", "roof"), []);
});

test("filterEntries combines q and tag with AND", () => {
  assert.deepEqual(filterEntries(ENTRIES, "roof", "masonry"), []);
  assert.deepEqual(filterEntries(ENTRIES, "north", "roofing").map(e => e.name), ["list:aaa"]);
});

test("filterEntries with no filters returns everything", () => {
  assert.equal(filterEntries(ENTRIES, "", "").length, 3);
});

test("filterEntries tolerates entries with no metadata", () => {
  assert.deepEqual(filterEntries([{ name: "list:zzz" }], "roof", ""), []);
  assert.equal(filterEntries([{ name: "list:zzz" }], "", "").length, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && npm test`
Expected: FAIL — no export named `filterEntries`

- [ ] **Step 3: Implement**

Add to `worker/src/lists.js`:

```js
const PAGE_SIZE = 200;

export function filterEntries(entries, q, tag) {
  const needle = String(q || "").trim().toLowerCase();
  const wanted = String(tag || "").trim().toLowerCase();
  return entries.filter(entry => {
    const m = entry.metadata;
    if (!m) return !needle && !wanted;
    const tags = Array.isArray(m.tags) ? m.tags.map(t => String(t[0]).toLowerCase()) : [];
    if (wanted && !tags.includes(wanted)) return false;
    if (!needle) return true;
    const hay = [m.title, m.author, m.blurb, ...tags].join(" ").toLowerCase();
    return hay.includes(needle);
  });
}
```

Add the collection GET branch to `handleLists`, immediately before the existing `if (request.method === "GET" && !isCollection)`:

```js
  if (request.method === "GET" && isCollection) {
    const cursor = url.searchParams.get("cursor") || undefined;
    const listed = await env.CACHE.list({ prefix: "list:", limit: PAGE_SIZE, cursor });
    const rows = filterEntries(listed.keys, url.searchParams.get("q"), url.searchParams.get("tag"))
      .map(entry => ({ id: entry.name.slice(5), ...(entry.metadata || {}) }))
      .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
    return resp({ lists: rows, cursor: listed.list_complete ? null : listed.cursor }, 200);
  }
```

> **Why filtering happens after paging, not before:** `KV.list()` cannot filter by metadata. A page is 200 keys; filtering that page can return fewer than 200 rows while a cursor still remains. The client must treat "cursor present" — not "200 rows returned" — as the signal that more exist. This is why the Load more button keys off the cursor.

- [ ] **Step 4: Run to verify pass**

Run: `cd worker && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/lists.js worker/test/lists.test.mjs
git commit -m "feat(worker): directory listing with cursor pagination

GET /api/lists pages 200 keys at a time from KV.list(), filtering the page
by q and tag. Returns a cursor only when more keys remain, which is what the
client's Load more control keys off."
```

---

### Task 3: Worker — edit with revision history

**Files:**
- Create: `worker/src/revisions.js`
- Modify: `worker/src/lists.js` (`handleLists` PUT branch)
- Modify: `worker/src/index.js:6-12` (route table)
- Test: `worker/test/lists.test.mjs`

**Interfaces:**
- Consumes: `readList`, `buildListMeta` from Task 1
- Produces: `revKey(id, n) -> string`, `pruneRevs(rev) -> number[]` returning the revision numbers to delete; `PUT /api/lists/:id`, `GET /api/lists/:id/revisions`, `POST /api/lists/:id/revisions`

- [ ] **Step 1: Write the failing tests**

Create the import at the top of `worker/test/lists.test.mjs`:

```js
import { revKey, pruneRevs } from "../src/revisions.js";
```

Append:

```js
test("revKey builds a padded, sortable key", () => {
  assert.equal(revKey("YnF7y4t", 3), "listrev:YnF7y4t:0003");
  assert.equal(revKey("YnF7y4t", 1200), "listrev:YnF7y4t:1200");
});

test("pruneRevs keeps the newest 20 and returns older ones to delete", () => {
  assert.deepEqual(pruneRevs(5), []);
  assert.deepEqual(pruneRevs(20), []);
  assert.deepEqual(pruneRevs(21), [1]);
  assert.deepEqual(pruneRevs(25), [1, 2, 3, 4, 5]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && npm test`
Expected: FAIL — `Cannot find module '../src/revisions.js'`

- [ ] **Step 3: Create `worker/src/revisions.js`**

```js
const KEEP_REVS = 20;

export function revKey(id, n) {
  return `listrev:${id}:${String(n).padStart(4, "0")}`;
}

export function pruneRevs(rev) {
  const oldest = rev - KEEP_REVS;
  if (oldest < 1) return [];
  return Array.from({ length: oldest }, (_, i) => i + 1);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd worker && npm test`
Expected: PASS

- [ ] **Step 5: Add the PUT branch to `handleLists`**

Import at the top of `worker/src/lists.js`:

```js
import { revKey, pruneRevs } from "./revisions.js";
```

Add before the final `return resp({ error: "method not allowed" }, 405);`:

```js
  if (request.method === "PUT" && !isCollection) {
    const id = url.pathname.replace(/^\/api\/lists\//, "");
    if (!ID_RE.test(id)) return resp({ error: "not found" }, 404);
    const raw = await request.text();
    if (raw.length > MAX_BODY) return resp({ error: "too large" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return resp({ error: "bad json" }, 400); }

    const current = await env.CACHE.getWithMetadata("list:" + id);
    const existing = readList(current.value);
    if (!existing) return resp({ error: "not found" }, 404);

    const rev = Number(current.metadata?.rev || 1) + 1;
    await env.CACHE.put(revKey(id, rev - 1), current.value, { expirationTtl: LIST_TTL });
    for (const old of pruneRevs(rev)) await env.CACHE.delete(revKey(id, old));

    const permits = body.permits === undefined ? existing.p : sanitizePermits(body.permits);
    if (!permits.length) return resp({ error: "no valid permits" }, 400);
    const value = {
      v: 2,
      p: permits,
      f: body.focal === undefined ? existing.f : sanitizeFocal(body.focal),
      desc: body.desc === undefined ? existing.desc : String(body.desc).slice(0, 2000),
      custom: existing.custom,
      ticks: existing.ticks,
    };
    const metadata = {
      ...buildListMeta(value, { ...current.metadata, ...body }, Math.floor(Date.now() / 1000)),
      publishedAt: Number(current.metadata?.publishedAt) || Math.floor(Date.now() / 1000),
      rev,
    };
    await env.CACHE.put("list:" + id, JSON.stringify(value), { expirationTtl: LIST_TTL, metadata });
    return resp({ id, rev }, 200);
  }
```

- [ ] **Step 6: Allow PUT through CORS**

In `worker/src/index.js:17`, change:

```js
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
```

to:

```js
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
```

> Without this, every browser PUT fails the preflight and the edit dialog silently does nothing.

- [ ] **Step 7: Run the tests**

Run: `cd worker && npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add worker/src/lists.js worker/src/revisions.js worker/src/index.js worker/test/lists.test.mjs
git commit -m "feat(worker): list edits with revision history

PUT /api/lists/:id snapshots the prior value to listrev:<id>:<n> before
writing, keeping the newest 20. Adds PUT and DELETE to the CORS allow-methods
so browser preflight passes."
```

---

### Task 4: Worker — tag slot registry

**Files:**
- Create: `worker/src/tags.js`
- Create: `worker/test/tags.test.mjs`
- Modify: `worker/src/index.js:6-12` (route table)

**Interfaces:**
- Consumes: nothing
- Produces: `normalizeTag(name) -> string`, `handleTags(url, env, request)`; `GET /api/tags -> { tags: { name: slot } }`, `PUT /api/tags` body `{ name, slot }`

- [ ] **Step 1: Write the failing tests**

Create `worker/test/tags.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { normalizeTag } from "../src/tags.js";

test("normalizeTag lowercases, trims and collapses whitespace", () => {
  assert.equal(normalizeTag("  North   Side  "), "north side");
  assert.equal(normalizeTag("ROOFING"), "roofing");
});

test("normalizeTag strips characters that would break a KV key", () => {
  assert.equal(normalizeTag("roof/ing"), "roofing");
  assert.equal(normalizeTag("a:b"), "ab");
  assert.equal(normalizeTag("2-4 flat"), "2-4 flat");
});

test("normalizeTag caps length at 24", () => {
  assert.equal(normalizeTag("x".repeat(50)).length, 24);
});

test("normalizeTag returns empty string for unusable input", () => {
  assert.equal(normalizeTag("   "), "");
  assert.equal(normalizeTag(null), "");
  assert.equal(normalizeTag("///"), "");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && npm test`
Expected: FAIL — `Cannot find module '../src/tags.js'`

- [ ] **Step 3: Create `worker/src/tags.js`**

```js
const MAX_TAG_LEN = 24;
const TAG_STRIP = /[^a-z0-9 \-_]/g;

function resp(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export function normalizeTag(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(TAG_STRIP, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_LEN);
}

export async function handleTags(url, env, request) {
  if (request.method === "GET") {
    const listed = await env.CACHE.list({ prefix: "tag:", limit: 1000 });
    const tags = {};
    for (const key of listed.keys) {
      const slot = Number(key.metadata?.slot);
      if (Number.isInteger(slot)) tags[key.name.slice(4)] = slot;
    }
    return resp({ tags }, 200);
  }
  if (request.method === "PUT") {
    let body;
    try { body = JSON.parse(await request.text()); } catch { return resp({ error: "bad json" }, 400); }
    const name = normalizeTag(body && body.name);
    const slot = Number(body && body.slot);
    if (!name) return resp({ error: "bad tag" }, 400);
    if (!Number.isInteger(slot) || slot < 0 || slot > 9) return resp({ error: "bad slot" }, 400);
    await env.CACHE.put("tag:" + name, String(slot), { metadata: { slot } });
    return resp({ name, slot }, 200);
  }
  return resp({ error: "method not allowed" }, 405);
}
```

> The slot lives in metadata as well as the value so `GET /api/tags` needs one `list()` and zero `get()` calls.

- [ ] **Step 4: Register the route**

In `worker/src/index.js`, add the import:

```js
import { handleTags } from "./tags.js";
```

and add to `ROUTES`, **before** the `/api/permits` entry is irrelevant but order matters against `/api/lists` — append at the end of the array:

```js
  { pattern: /^\/api\/tags/, handler: handleTags },
```

Also add to the `endpoints` array in the fallback response:

```js
          "GET /api/tags -> {tags}",
          "PUT /api/tags  (body: {name, slot})",
```

- [ ] **Step 5: Run the tests**

Run: `cd worker && npm test`
Expected: PASS — 4 new tag tests plus everything prior.

- [ ] **Step 6: Commit**

```bash
git add worker/src/tags.js worker/test/tags.test.mjs worker/src/index.js
git commit -m "feat(worker): tag slot registry

Tag names map to one of 10 colour slots, stored in KV metadata so the whole
registry reads in a single list() call."
```

---

### Task 5: Client — multi-list store and migration

**Files:**
- Modify: `docs/list.html:3056` (`userListKey`), `:4364-4388` (`loadUserListCookie`/`saveUserListCookie`)
- Modify: `docs/index.html:2931`, and its `saveUserListCookie` equivalent
- Modify: `docs/map.html:2913`, and its `saveUserListCookie` equivalent
- Test: `verify-tmp/p1-store.mjs` (gitignored)

**Interfaces:**
- Consumes: nothing from earlier tasks (client-side)
- Produces, identically in all three pages:
  - `const listsKey = "chi_permit_lists"`
  - `migrateUserLists(raw, legacy) -> { lastUsed, lists }` — pure, testable
  - `loadUserLists()` populating `state.lists` and `state.activeListId`
  - `saveUserLists()` persisting `state.lists`
  - `activeList()` returning the active list object
  - `loadUserListCookie()` / `saveUserListCookie()` keep their names and signatures, now reading and writing the active list's `permits` array

> Keeping the two legacy function names means the ~30 existing call sites do not change in this task. Renaming them is out of scope.

- [ ] **Step 1: Write the failing test**

Create `verify-tmp/p1-store.mjs`. The project has no client test framework; pure logic is checked with a standalone `node --test` script that imports a copy of the function. Paste `migrateUserLists` into this file under a `// ---- copy of docs/list.html migrateUserLists ----` banner once Step 3 exists; for now write only the assertions:

```js
import { test } from "node:test";
import assert from "node:assert";
import { migrateUserLists } from "./p1-store-impl.mjs";

test("migrates a legacy pipe-joined list into local_1", () => {
  const out = migrateUserLists(null, "101082609|B200475676");
  assert.equal(out.lastUsed, "local_1");
  assert.deepEqual(out.lists.local_1.permits, ["101082609", "B200475676"]);
  assert.equal(out.lists.local_1.name, "My Permit List");
});

test("an empty legacy value still yields one empty list", () => {
  const out = migrateUserLists(null, "");
  assert.deepEqual(Object.keys(out.lists), ["local_1"]);
  assert.deepEqual(out.lists.local_1.permits, []);
});

test("existing v2 storage is returned untouched", () => {
  const raw = JSON.stringify({ lastUsed: "local_2", lists: { local_2: { name: "Callbacks", permits: ["1"] } } });
  const out = migrateUserLists(raw, "ignored|values");
  assert.equal(out.lastUsed, "local_2");
  assert.deepEqual(Object.keys(out.lists), ["local_2"]);
});

test("corrupt storage falls back to migrating the legacy value", () => {
  const out = migrateUserLists("{not json", "101082609");
  assert.deepEqual(out.lists.local_1.permits, ["101082609"]);
});

test("lastUsed pointing at a missing list is repaired", () => {
  const raw = JSON.stringify({ lastUsed: "gone", lists: { local_1: { name: "A", permits: [] } } });
  assert.equal(migrateUserLists(raw, "").lastUsed, "local_1");
});

test("storage with zero lists is repaired to one empty list", () => {
  const out = migrateUserLists(JSON.stringify({ lastUsed: "x", lists: {} }), "");
  assert.deepEqual(Object.keys(out.lists), ["local_1"]);
});

test("permits are deduped and capped at 220", () => {
  const many = Array.from({ length: 300 }, (_, i) => "p" + i).join("|");
  assert.equal(migrateUserLists(null, many).lists.local_1.permits.length, 220);
  assert.deepEqual(migrateUserLists(null, "a|a|b").lists.local_1.permits, ["a", "b"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test verify-tmp/p1-store.mjs`
Expected: FAIL — `Cannot find module './p1-store-impl.mjs'`

- [ ] **Step 3: Implement in `docs/list.html`**

Replace line 3056 `const userListKey = "chi_permit_user_list";` with:

```js
    const userListKey = "chi_permit_user_list";
    const listsKey = "chi_permit_lists";
```

Replace `loadUserListCookie` and `saveUserListCookie` (lines 4364–4388) entirely with:

```js
    function migrateUserLists(raw, legacy) {
      const capped = value => Array.from(new Set(
        String(value || "").split("|").map(v => v.trim()).filter(Boolean)
      )).slice(0, userListLimit);
      const fresh = () => ({
        lastUsed: "local_1",
        lists: { local_1: { name: "My Permit List", permits: capped(legacy), focal: null, sharedId: null } },
      });
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
      if (!data || typeof data !== "object" || !data.lists || typeof data.lists !== "object") return fresh();
      const ids = Object.keys(data.lists);
      if (!ids.length) return fresh();
      return {
        lastUsed: data.lists[data.lastUsed] ? data.lastUsed : ids[0],
        lists: data.lists,
      };
    }

    function loadUserLists() {
      let raw = "";
      let legacy = "";
      try {
        raw = localStorage.getItem(listsKey) || "";
        const stored = localStorage.getItem(userListKey);
        legacy = stored == null ? readCookie(userListKey) : stored;
      } catch (error) {
        legacy = readCookie(userListKey);
      }
      const migrated = migrateUserLists(raw, legacy);
      state.lists = migrated.lists;
      state.activeListId = migrated.lastUsed;
      if (!raw) saveUserLists();
    }

    function saveUserLists() {
      try {
        localStorage.setItem(listsKey, JSON.stringify({ lastUsed: state.activeListId, lists: state.lists }));
      } catch (error) {
        /* storage full or blocked — the in-memory list still works for this session */
      }
    }

    function activeList() {
      return state.lists[state.activeListId] || null;
    }

    function loadUserListCookie() {
      loadUserLists();
      const list = activeList();
      state.userPermitNumbers = list ? [...list.permits] : [];
    }

    function saveUserListCookie() {
      state.userPermitNumbers = Array.from(new Set(state.userPermitNumbers)).slice(0, userListLimit);
      const list = activeList();
      if (list) list.permits = [...state.userPermitNumbers];
      saveUserLists();
    }
```

Add to the `state` object at line 3016, beside `userPermitMap`:

```js
      lists: {},
      activeListId: "local_1",
```

> The legacy `chi_permit_user_list` key is deliberately **not** deleted. It is the rollback path for one release. Phase 2 removes it.

- [ ] **Step 4: Extract the implementation for the test**

Create `verify-tmp/p1-store-impl.mjs` containing `userListLimit` and a verbatim copy of `migrateUserLists` from `docs/list.html`, with `export` prepended:

```js
const userListLimit = 220;

export function migrateUserLists(raw, legacy) {
  // VERBATIM COPY from docs/list.html — if you edit one, edit both
  const capped = value => Array.from(new Set(
    String(value || "").split("|").map(v => v.trim()).filter(Boolean)
  )).slice(0, userListLimit);
  const fresh = () => ({
    lastUsed: "local_1",
    lists: { local_1: { name: "My Permit List", permits: capped(legacy), focal: null, sharedId: null } },
  });
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!data || typeof data !== "object" || !data.lists || typeof data.lists !== "object") return fresh();
  const ids = Object.keys(data.lists);
  if (!ids.length) return fresh();
  return {
    lastUsed: data.lists[data.lastUsed] ? data.lastUsed : ids[0],
    lists: data.lists,
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `node --test verify-tmp/p1-store.mjs`
Expected: PASS — 7 tests.

- [ ] **Step 6: Apply the identical change to `index.html` and `map.html`**

Both pages have the same `userListKey` declaration and their own `saveUserListCookie`. Apply the same block verbatim. `index.html` and `map.html` do **not** have `loadUserListCookie` with a cookie fallback in the same shape — read each page's existing function first and preserve its call signature.

- [ ] **Step 7: Verify the three copies are byte-identical**

Run:

```bash
python - <<'PY'
import re, pathlib
src = {}
for p in ["docs/list.html", "docs/index.html", "docs/map.html"]:
    t = pathlib.Path(p).read_text(encoding="utf-8")
    m = re.search(r"function migrateUserLists.*?\n    }\n", t, re.S)
    src[p] = m.group(0) if m else None
    print(p, "found" if m else "MISSING", len(m.group(0)) if m else 0)
vals = [v for v in src.values() if v]
print("identical:", len(set(vals)) == 1 and len(vals) == 3)
for p in src:
    n = pathlib.Path(p).read_bytes().count(b"\x00")
    if n: print("NUL BYTES IN", p, n)
PY
```

Expected: `found` for all three, `identical: True`, no NUL byte lines.

- [ ] **Step 8: Verify in a browser that the existing list survives**

Serve `python -m http.server 8791 --directory docs`, then with Playwright: set `localStorage.chi_permit_user_list = "101082609|B200475676"`, reload `list.html`, wait for `#focal-status` to have non-empty text (init is async — waiting on a function's existence fires too early), then assert:

```js
await page.evaluate(() => JSON.parse(localStorage.getItem("chi_permit_lists")).lists.local_1.permits)
// -> ["101082609", "B200475676"]
await page.evaluate(() => state.userPermitNumbers)
// -> ["101082609", "B200475676"]
```

Filter console errors matching `/socrata|worker|api|Failed to fetch|net::ERR|profiles|stats/i` — localhost cannot reach the Worker and those are expected.

- [ ] **Step 9: Commit**

```bash
git add docs/index.html docs/map.html
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(lists): multi-list localStorage store with migration

chi_permit_lists replaces the pipe-joined chi_permit_user_list. The legacy key
is left in place for one release as a rollback path. loadUserListCookie and
saveUserListCookie keep their names so the ~30 existing call sites are
untouched."
```

---

### Task 6: Client — directory view in `list.html`

**Files:**
- Modify: `docs/list.html` — add directory markup, `renderDirectory`, `fetchDirectory`, view switching
- Test: `verify-tmp/p1-directory.mjs`

**Interfaces:**
- Consumes: `state.lists`, `activeListId`, `saveUserLists` from Task 5; `GET /api/lists` from Task 2
- Produces: `TAG_SLOTS` (array of 10 `{light, dark}`), `tagChipHtml(name, slot)`, `renderDirectory()`, `showDirectory()`, `showList(id)`, `state.directory = { rows, cursor, q, tag, loading }`

- [ ] **Step 1: Add the tag slot palette**

These are measured values — every slot clears 4.5:1 on both `#f8fbff` and `#0c1726`. Do not substitute.

Add near the top of the script block in `docs/list.html`:

```js
    const TAG_SLOTS = [
      { name: "red",     light: "#b3261e", dark: "#ff9d9b" },
      { name: "orange",  light: "#8f4700", dark: "#f0a95c" },
      { name: "olive",   light: "#5c6300", dark: "#c9d15a" },
      { name: "green",   light: "#146c43", dark: "#62d991" },
      { name: "teal",    light: "#0f6674", dark: "#6fd0e8" },
      { name: "blue",    light: "#1f4fa3", dark: "#8eb8ff" },
      { name: "indigo",  light: "#4338a8", dark: "#b0a8ff" },
      { name: "purple",  light: "#6b3fa0", dark: "#d3a0ee" },
      { name: "magenta", light: "#9c2c74", dark: "#f39ac8" },
      { name: "slate",   light: "#45566c", dark: "#b6c8dc" },
    ];
```

Add to the stylesheet, alongside the existing `:root` and `:root[data-theme="dark"]` blocks:

```css
    :root {
      --t0:#b3261e; --t1:#8f4700; --t2:#5c6300; --t3:#146c43; --t4:#0f6674;
      --t5:#1f4fa3; --t6:#4338a8; --t7:#6b3fa0; --t8:#9c2c74; --t9:#45566c;
    }
    :root[data-theme="dark"] {
      --t0:#ff9d9b; --t1:#f0a95c; --t2:#c9d15a; --t3:#62d991; --t4:#6fd0e8;
      --t5:#8eb8ff; --t6:#b0a8ff; --t7:#d3a0ee; --t8:#f39ac8; --t9:#b6c8dc;
    }
    .tag {
      display:inline-flex; align-items:center; gap:.35rem;
      font-size:.76rem; font-weight:600; padding:.2rem .55rem; border-radius:999px;
      border:1px solid var(--tc); color:var(--tc); background:transparent; white-space:nowrap;
    }
    .tag .swatch { width:8px; height:8px; border-radius:2px; background:var(--tc); }
    button.tag { cursor:pointer; font-family:inherit; min-height:44px; padding:.4rem .75rem; }
    button.tag[aria-pressed="true"] { background:var(--tc); color:var(--panel); }
    button.tag[aria-pressed="true"] .swatch { display:none; }
    button.tag[aria-pressed="true"]::before { content:"✓"; font-size:.8em; }
```

- [ ] **Step 2: Write the failing test for the pure renderer**

Create `verify-tmp/p1-directory.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { tagChipHtml, directorySections } from "./p1-directory-impl.mjs";

test("tagChipHtml uses the slot custom property, never a raw hex", () => {
  const html = tagChipHtml("roofing", 0);
  assert.match(html, /--tc:var\(--t0\)/);
  assert.ok(!/#b3261e/.test(html), "must not inline a theme-specific hex");
  assert.match(html, />roofing</);
});

test("tagChipHtml escapes tag names", () => {
  assert.match(tagChipHtml('<img src=x onerror=1>', 3), /&lt;img/);
});

test("tagChipHtml clamps an out-of-range slot to 9", () => {
  assert.match(tagChipHtml("x", 99), /--tc:var\(--t9\)/);
  assert.match(tagChipHtml("x", -3), /--tc:var\(--t0\)/);
});

test("directorySections splits mine from published by sharedId", () => {
  const local = { a: { name: "A", permits: [], sharedId: "YnF7y4t" }, b: { name: "B", permits: [] } };
  const remote = [{ id: "YnF7y4t", title: "A" }, { id: "zzz", title: "Other" }];
  const out = directorySections(local, remote);
  assert.deepEqual(out.mine.map(l => l.name), ["A", "B"]);
  assert.deepEqual(out.published.map(l => l.id), ["zzz"]);
});

test("directorySections marks unpublished local lists as drafts", () => {
  const out = directorySections({ b: { name: "B", permits: [] } }, []);
  assert.equal(out.mine[0].draft, true);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test verify-tmp/p1-directory.mjs`
Expected: FAIL — `Cannot find module './p1-directory-impl.mjs'`

- [ ] **Step 4: Implement in `docs/list.html`**

```js
    function tagChipHtml(name, slot) {
      const s = Math.max(0, Math.min(9, Number(slot) || 0));
      return `<span class="tag" style="--tc:var(--t${s})"><span class="swatch"></span>${esc(name)}</span>`;
    }

    function directorySections(localLists, remoteRows) {
      const mineIds = new Set();
      const mine = Object.entries(localLists).map(([id, list]) => {
        if (list.sharedId) mineIds.add(list.sharedId);
        return { id, name: list.name, count: list.permits.length, sharedId: list.sharedId || null, draft: !list.sharedId };
      });
      return { mine, published: remoteRows.filter(row => !mineIds.has(row.id)) };
    }
```

- [ ] **Step 5: Add the fetch and render**

```js
    async function fetchDirectory(append = false) {
      state.directory.loading = true;
      renderDirectory();
      const params = new URLSearchParams();
      if (state.directory.q) params.set("q", state.directory.q);
      if (state.directory.tag) params.set("tag", state.directory.tag);
      if (append && state.directory.cursor) params.set("cursor", state.directory.cursor);
      try {
        const res = await fetch(`${API_BASE}/api/lists?${params}`);
        if (!res.ok) throw new Error("directory unavailable");
        const data = await res.json();
        state.directory.rows = append ? [...state.directory.rows, ...data.lists] : data.lists;
        state.directory.cursor = data.cursor;
        state.directory.error = "";
      } catch {
        state.directory.error = "Published lists could not be loaded. Your own lists are unaffected.";
        if (!append) state.directory.rows = [];
        state.directory.cursor = null;
      }
      state.directory.loading = false;
      renderDirectory();
    }
```

`renderDirectory()` writes into a new `<section id="directory-view">` placed immediately before the existing list panel, and toggles `hidden` on both. Cards follow the wireframe: an `<li>` containing an `<h4><a>` title (so the card is keyboard-reachable), a `★ Mine` label for local lists, `✔ Published` / `◷ Draft` pill, tag chips, and a meta line. **The Load more button renders only when `state.directory.cursor` is truthy** — never based on row count.

- [ ] **Step 6: Extract the implementation and run the test**

Copy `tagChipHtml`, `directorySections`, and a minimal `esc` into `verify-tmp/p1-directory-impl.mjs` with `export` prepended.

Run: `node --test verify-tmp/p1-directory.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 7: Verify in a browser, desktop and mobile**

Stub `**/api/lists*` with `page.route` returning two rows and `cursor: null`. Assert:

1. `#directory-view` is visible on load and the list panel is hidden.
2. Clicking a card title shows the list panel and hides the directory.
3. No Load more button when `cursor` is null; one appears when the stub returns a cursor.
4. **At an iPhone 13 viewport** (`browser.newContext({ ...devices["iPhone 13"] })`), scroll to `window.scrollTo(0, 240)` first, then assert every tag chip's `getBoundingClientRect().height >= 44` and that the page's `document.documentElement.scrollWidth <= innerWidth` (no horizontal scroll).
5. Toggle `data-theme` to `dark` and assert `getComputedStyle(chip).color` changes — proving the chip reads the token, not a baked hex.

- [ ] **Step 8: Commit**

```bash
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(lists): directory view with tag slots

list.html opens to a directory of your lists plus everything published.
Tag colours resolve through --t0..--t9 custom properties so a tag stays
legible in both themes; free hex failed contrast in dark mode (1.9:1)."
```

---

### Task 7: Client — publish and edit details dialog

**Files:**
- Modify: `docs/list.html` — dialog markup, `openListDetails`, `saveListDetails`
- Test: `verify-tmp/p1-details.mjs`

**Interfaces:**
- Consumes: `TAG_SLOTS`, `tagChipHtml` (Task 6); `POST /api/lists`, `PUT /api/lists/:id` (Tasks 1, 3); `PUT /api/tags` (Task 4)
- Produces: `parseTagInput(text, registry) -> Array<[string, number]>`, `openListDetails(id)`, `saveListDetails()`

- [ ] **Step 1: Write the failing test**

Create `verify-tmp/p1-details.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { parseTagInput } from "./p1-details-impl.mjs";

test("an existing tag inherits its registered slot", () => {
  assert.deepEqual(parseTagInput("roofing", { roofing: 7 }), [["roofing", 7]]);
});

test("a new tag takes the requested slot", () => {
  assert.deepEqual(parseTagInput("gut rehab", {}, 3), [["gut rehab", 3]]);
});

test("tags are normalised the same way the Worker normalises them", () => {
  assert.deepEqual(parseTagInput("  North   Side  ", {}, 4), [["north side", 4]]);
});

test("duplicates collapse and order is preserved", () => {
  assert.deepEqual(parseTagInput("roofing, roofing, masonry", { roofing: 0, masonry: 9 }),
    [["roofing", 0], ["masonry", 9]]);
});

test("unusable tag text is dropped, not stored as empty", () => {
  assert.deepEqual(parseTagInput("///, ,roofing", { roofing: 0 }), [["roofing", 0]]);
});

test("at most 8 tags survive", () => {
  const many = Array.from({ length: 12 }, (_, i) => "t" + i).join(",");
  assert.equal(parseTagInput(many, {}, 1).length, 8);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test verify-tmp/p1-details.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement in `docs/list.html`**

`normalizeTag` must match `worker/src/tags.js` exactly, or a tag typed in the browser and a tag stored by the Worker will disagree:

```js
    function normalizeTag(name) {
      return String(name ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9 \-_]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 24);
    }

    function parseTagInput(text, registry, newSlot = 0) {
      const seen = new Set();
      const out = [];
      for (const part of String(text || "").split(",")) {
        const name = normalizeTag(part);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const slot = Number.isInteger(registry[name]) ? registry[name] : newSlot;
        out.push([name, Math.max(0, Math.min(9, slot))]);
        if (out.length >= 8) break;
      }
      return out;
    }
```

The dialog reuses the existing `openPermitModal(html, {onOpen})` so focus trap, Escape, backdrop click, browser-back and scroll lock all come for free. Fields: Title, Description, Author (all with visible `<label>`, `font-size: 1rem` so iOS does not zoom on focus), a tag input, and the ten-swatch picker shown **only when the typed tag is not already in the registry**.

Saving: `POST /api/lists` when the list has no `sharedId`, `PUT /api/lists/:id` when it does; then `PUT /api/tags` for each newly-created tag; then store `sharedId` on the local list and `saveUserLists()`. On success **navigate to the list**, not back to the directory — KV list metadata is eventually consistent and can lag a write by up to a minute, so a directory refreshed immediately may not show what was just published.

- [ ] **Step 4: Extract and run the test**

Copy `normalizeTag` and `parseTagInput` into `verify-tmp/p1-details-impl.mjs` with `export` prepended.

Run: `node --test verify-tmp/p1-details.mjs`
Expected: PASS — 6 tests.

- [ ] **Step 5: Confirm client and Worker normalisation agree**

Run:

```bash
node -e "
import('./verify-tmp/p1-details-impl.mjs').then(async c => {
  const w = await import('./worker/src/tags.js');
  const cases = ['  North   Side  ', 'ROOFING', 'roof/ing', 'a:b', '2-4 flat', 'x'.repeat(50), '   ', '///'];
  let bad = 0;
  for (const s of cases) {
    if (c.normalizeTag(s) !== w.normalizeTag(s)) { bad++; console.log('MISMATCH', JSON.stringify(s), c.normalizeTag(s), w.normalizeTag(s)); }
  }
  console.log(bad ? 'FAIL' : 'client and worker agree on all cases');
});
"
```

Expected: `client and worker agree on all cases`

- [ ] **Step 6: Verify in a browser**

Stub `POST /api/lists` → `{id:"TestId1"}` and `PUT /api/tags` → `{}`. Publish a draft list and assert `state.lists[...].sharedId === "TestId1"` and that it persists to `localStorage`. At an iPhone 13 viewport, open the dialog after `window.scrollTo(0, 240)` and assert its `getBoundingClientRect()` fits inside `innerHeight`/`innerWidth` — the Jul 22 bug was exactly this, and DOM presence is not evidence of visibility.

- [ ] **Step 7: Commit**

```bash
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(lists): publish and edit details dialog

Title, description, author and tags, reusing openPermitModal for focus trap,
Escape, browser-back and scroll lock. Client normalizeTag is kept identical to
the Worker's; a mismatch would silently fork the tag registry."
```

---

### Task 8: Client — add-to-list picker on all three pages

**Files:**
- Modify: `docs/list.html:5186` (`addPermitsToUserList`)
- Modify: `docs/index.html:4634` (`addPermitsToUserList`), `:4763`, `:4769` (call sites)
- Modify: `docs/map.html:5431` (`addPermitsToUserList`), `:5560`, `:5574-5580` (bulk add)

**Interfaces:**
- Consumes: `state.lists`, `activeList`, `saveUserLists` (Task 5)
- Produces, identically in all three pages: `pickList(count) -> Promise<string|null>` resolving to a list id or `null` if cancelled; `addPermitsToUserList(rows, options)` gains `options.listId` to skip the picker

- [ ] **Step 1: Write the failing test for the capacity logic**

Create `verify-tmp/p1-picker.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { listCapacity } from "./p1-picker-impl.mjs";

test("reports full remaining room on an empty list", () => {
  assert.deepEqual(listCapacity({ permits: [] }, 63), { room: 220, fits: true, willAdd: 63 });
});

test("reports a partial fit when the list is nearly full", () => {
  assert.deepEqual(listCapacity({ permits: new Array(180).fill("x") }, 63),
    { room: 40, fits: false, willAdd: 40 });
});

test("reports zero room on a full list", () => {
  assert.deepEqual(listCapacity({ permits: new Array(220).fill("x") }, 5),
    { room: 0, fits: false, willAdd: 0 });
});

test("a single add always fits when there is any room", () => {
  assert.deepEqual(listCapacity({ permits: new Array(219).fill("x") }, 1),
    { room: 1, fits: true, willAdd: 1 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test verify-tmp/p1-picker.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement, identically in all three pages**

```js
    function listCapacity(list, incoming) {
      const room = Math.max(0, userListLimit - (list?.permits?.length || 0));
      const willAdd = Math.min(room, incoming);
      return { room, fits: willAdd >= incoming, willAdd };
    }

    function pickList(count) {
      return new Promise(resolve => {
        const entries = Object.entries(state.lists);
        const rows = entries.map(([id, list]) => {
          const cap = listCapacity(list, count);
          const note = cap.fits ? `${fmt(list.permits.length)}` : `⚠ room for ${fmt(cap.room)}`;
          return `<button class="pickrow" type="button" data-pick="${esc(id)}">
            <span>${esc(list.name)}</span><span class="cnt">${note}</span></button>`;
        }).join("");
        const heading = count === 1 ? "Add to which list?" : `Add ${fmt(count)} permits to which list?`;
        openPermitModal(
          `<h3 id="permit-modal-title">${esc(heading)}</h3>
           <div class="stack">${rows}
           <button class="pickrow new" type="button" data-pick="__new">+ New list…</button></div>`,
          {
            onOpen: root => {
              root.querySelectorAll("[data-pick]").forEach(btn => {
                btn.addEventListener("click", () => {
                  const id = btn.dataset.pick;
                  closePermitModal();
                  resolve(id === "__new" ? createListPrompt() : id);
                });
              });
            },
            onClose: () => resolve(null),
          }
        );
      });
    }
```

`addPermitsToUserList` gains at the top, before any mutation:

```js
      let targetId = options.listId;
      if (!targetId) {
        targetId = await pickList(rows.length);
        if (!targetId) return;
      }
      state.activeListId = targetId;
      state.userPermitNumbers = [...(state.lists[targetId]?.permits || [])];
```

> `openPermitModal` currently has no `onClose` hook. Add one that fires on ✕, backdrop, Escape and popstate — without it, dismissing the picker leaves the promise pending forever and every later add silently hangs.

On `map.html` the existing bulk-add `confirm()` at lines 5574–5580 is **replaced** by the per-row capacity note, which shows the same information before the choice rather than after it.

- [ ] **Step 4: Extract and run the test**

Copy `listCapacity` into `verify-tmp/p1-picker-impl.mjs` with `userListLimit = 220` and `export` prepended.

Run: `node --test verify-tmp/p1-picker.mjs`
Expected: PASS — 4 tests.

- [ ] **Step 5: Verify the three copies match**

Re-run the byte-identical check from Task 5 Step 7, changing the regex to `function pickList` and `function listCapacity`.

- [ ] **Step 6: Verify in a browser, all three pages**

For each of `index.html`, `map.html`, `list.html`:

1. Seed two lists in `chi_permit_lists`.
2. Trigger an add; assert the picker appears and lists both names.
3. Click the second list; assert the permit lands in **that** list in `localStorage` and not the first.
4. Trigger an add and press Escape; assert nothing was added and that a **subsequent** add still opens the picker — this is the regression that a missing `onClose` causes.
5. On `map.html`, seed a list with 180 permits and bulk-add 63; assert the row reads `⚠ room for 40`.
6. At an iPhone 13 viewport after `window.scrollTo(0, 240)`, assert the picker's bounding rect fits within the viewport and each `.pickrow` is ≥44px tall.

- [ ] **Step 7: Commit**

```bash
git add docs/index.html docs/map.html
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(lists): add-to-list picker on every add path

Every Add asks which list, including the map's bulk add, which now shows
remaining room per list instead of confirming after the fact. openPermitModal
gains an onClose hook so a dismissed picker resolves rather than hanging."
```

---

### Task 9: Client — migrate the live share link

**Files:**
- Modify: `docs/list.html:3148-3184` (`applySharedList`)
- Modify: `docs/list.html:6038` (`shareUserList`)

**Interfaces:**
- Consumes: `state.lists`, `saveUserLists` (Task 5); `openListDetails` (Task 7)
- Produces: `applySharedList()` importing into a **new** list rather than replacing the active one

- [ ] **Step 1: Rewrite `applySharedList`**

The current implementation replaces the user's only list after a `confirm()`. With many lists there is nothing to overwrite — the shared list becomes a new one. Replace lines 3160–3183 (from `const permits = ...` to `stripHash();`) with:

```js
      const permits = Array.isArray(data.permits) ? data.permits.map(clean).filter(Boolean) : [];
      if (!permits.length) { stripHash(); return; }

      const existingId = Object.keys(state.lists).find(key => state.lists[key].sharedId === id);
      if (existingId) {
        state.activeListId = existingId;
        state.lists[existingId].permits = permits;
      } else {
        const newId = `local_${Date.now().toString(36)}`;
        state.lists[newId] = {
          name: (data.meta && data.meta.title) || "Shared list",
          permits,
          focal: data.focal || null,
          sharedId: id,
        };
        state.activeListId = newId;
      }
      state.userPermitNumbers = permits;
      saveUserLists();
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
      showList(state.activeListId);
      stripHash();
      if (!data.meta || !data.meta.title) openListDetails(state.activeListId);
```

The `confirm()` prompt is removed with the replace behaviour it guarded — importing no longer destroys anything.

The final line is the v1 migration: a payload with no metadata is pre-v2, so the details dialog opens on "Untitled list" so title, author and tags can be filled in. Saving writes v2 to the **same key**, so the URL never changes.

- [ ] **Step 2: Point `shareUserList` at the active list**

At line 6049 the body is built from `state.userPermitNumbers`. Change it to send the list's own metadata, and to `PUT` when the list is already published:

```js
        const list = activeList();
        const published = list && list.sharedId;
        const res = await fetch(`${API_BASE}/api/lists${published ? "/" + encodeURIComponent(list.sharedId) : ""}`, {
          method: published ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            permits: state.userPermitNumbers,
            focal: focalShareData(),
            title: list ? list.name : "",
            author: list ? (list.author || "") : "",
            desc: list ? (list.desc || "") : "",
            tags: list ? (list.tags || []) : [],
          }),
        });
```

and after a successful response, persist `sharedId` so a second Share edits rather than duplicating:

```js
        if (list && !list.sharedId) { list.sharedId = id; saveUserLists(); }
```

- [ ] **Step 3: Verify against a stub**

Stub `GET **/api/lists/YnF7y4t` with the **real** payload shape — 100 permit numbers, the `5010 N Monticello` focal, and **no `meta` key**, exactly as the deployed v1 record returns. Load `list.html#s=YnF7y4t` with one pre-existing list in storage and assert:

1. The pre-existing list still exists and is unchanged — nothing was replaced.
2. A second list exists with `sharedId === "YnF7y4t"` and 100 permits.
3. The details dialog is open, because the payload had no metadata.
4. `location.hash` is empty.

Then re-run with `meta: { title: "North Side Roof Runs" }` and assert the dialog does **not** open and the list is named from the metadata.

- [ ] **Step 4: Verify against the live record before deploying**

Run:

```bash
curl -s -H "Origin: https://dkaruri.github.io" \
  "https://chi-permits-api.divyam-c-karuri.workers.dev/api/lists/YnF7y4t" \
  | python -c "import json,sys; d=json.load(sys.stdin); print('permits', len(d['permits']), '| focal', d['focal']['label'], '| meta', d.get('meta'))"
```

Expected before deploy: `permits 100 | focal 5010 N Monticello | meta None`
Expected after deploy: identical, with `meta` present only once the list has been saved through the new dialog.

- [ ] **Step 5: Commit**

```bash
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(lists): import shared links as new lists

A shared link no longer replaces the recipient's list — it becomes a new one,
so the destructive confirm() goes away with the behaviour it guarded. Opening
a v1 payload with no metadata prompts for title, author and tags, and saving
rewrites the same KV key so the URL never changes."
```

---

### Task 10: Deploy and verify end to end

**Files:** none modified

- [ ] **Step 1: Run every test**

Run: `cd worker && npm test`
Expected: PASS, all suites.

Run: `node --test verify-tmp/`
Expected: PASS — store, directory, details, picker.

- [ ] **Step 2: Capture the pre-deploy baseline**

```bash
curl -s -H "Origin: https://dkaruri.github.io" \
  "https://chi-permits-api.divyam-c-karuri.workers.dev/api/lists/YnF7y4t" > /tmp/ynf-before.json
wc -c /tmp/ynf-before.json
```

- [ ] **Step 3: Deploy the Worker**

**This step requires the user** — `wrangler deploy` needs interactive Cloudflare auth that an agent cannot complete. Ask them to run:

```
! cd worker && npx wrangler deploy
```

- [ ] **Step 4: Verify the live record survived**

```bash
curl -s -H "Origin: https://dkaruri.github.io" \
  "https://chi-permits-api.divyam-c-karuri.workers.dev/api/lists/YnF7y4t" \
  | python -c "import json,sys; d=json.load(sys.stdin); print(len(d['permits']), d['focal']['label'])"
```

Expected: `100 5010 N Monticello`

If this returns anything else, **stop and roll back** — `readList` is mishandling the v1 payload.

- [ ] **Step 5: Verify the directory endpoint is live**

```bash
curl -s -H "Origin: https://dkaruri.github.io" \
  "https://chi-permits-api.divyam-c-karuri.workers.dev/api/lists?q=" \
  | python -c "import json,sys; d=json.load(sys.stdin); print('lists', len(d['lists']), '| cursor', d['cursor'])"
```

Expected: a count and `cursor None`. Pre-existing lists created before this change have no metadata, so they appear with empty titles until edited — that is expected, not a bug.

- [ ] **Step 6: Push and report**

```bash
git push origin main
```

Then confirm on the live site after ~10 minutes (GitHub Pages sends `Cache-Control: max-age=600`; a hard refresh is needed inside that window).

**Stop here.** Per the standing instruction, do not begin Phase 2 without explicit confirmation. Report what shipped, then ask.

---

## Self-Review

**Spec coverage.** §5.1 v2 schema → Task 1. §5.1 metadata → Task 1. §5.2 `listrev:` → Task 3. §5.3 tag slots → Tasks 4, 6. §5.5 localStorage + migration → Task 5. §6.1 directory, search, tag filter, pagination → Tasks 2, 6. §6.1 publish-navigates-to-list → Task 7 Step 3. §10 `GET/POST/PUT /api/lists`, `/api/tags` → Tasks 1–4. §10.1 `YnF7y4t` migration → Tasks 1, 9. §12 Phase 1 scope → all tasks. §13 iPhone-13 geometry assertions → Tasks 6, 7, 8. §14 CRLF staging → every commit touching `list.html`.

Deferred to later phases, per §12 and therefore not gaps: `custom` and `ticks` are written into the schema in Task 1 but not populated until Phase 2; note threads and `/api/notes/*` are Phase 3; photos are Phase 4; the Notes-column deletion and toolbar rework are Phase 2.

**Type consistency.** `readList` returns `{v,p,f,desc,custom,ticks}`, matching what Task 3's PUT branch destructures. `buildListMeta(stored, metaInput, now)` takes three arguments at both its definition and its two call sites. `filterEntries(entries, q, tag)` matches its caller. `normalizeTag` is defined identically in `worker/src/tags.js` and `docs/list.html`, and Task 7 Step 5 is a test that proves it. `listCapacity` returns `{room, fits, willAdd}` in both the test and the `pickList` caller. `tagChipHtml(name, slot)` is consistent across Tasks 6 and 7.

**Known risk carried forward.** `openPermitModal` has no `onClose` hook today; Task 8 adds one. Every picker call site depends on it, so if Task 8 is implemented without it the picker will hang silently rather than fail loudly — Step 6 case 4 exists specifically to catch that.
