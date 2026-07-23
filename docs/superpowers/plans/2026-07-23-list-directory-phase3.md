# List Directory — Phase 3 (Posts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the permit detail overlay's private note box into a private draft plus a public, per-permit thread anyone can post to — plain text and a structured site walkthrough — with open subs captured into the contractor section and a live note count on the saved-list chip.

**Architecture:** A new `worker/src/notes.js` stores one array of posts per permit under `note:<permitNumber>`, with a `{n}` count in KV metadata so the whole count map reads in a single `list()` call. The overlay's Notes section gains a Post button (the existing local draft is untouched) and renders the fetched thread; photos are deferred to Phase 4 but the renderer tolerates a `photo` post existing.

**Tech Stack:** Vanilla ES2022 in self-contained HTML (no build step), Cloudflare Workers + KV, `node --test`, Playwright.

## Global Constraints

- **Spec:** `superpowers/specs/2026-07-23-list-directory-design.md` §9 and §5.2. Decisions D4, D5, D6 are binding.
- **Branch off `list-directory-phase2`, not `main`.** Phase 2 is built but not yet deployed or merged; Phase 3 stacks on it. See Task 6 for the combined deploy/merge.
- **Phase 1 + 2 primitives exist — reuse them:** `openPermitModal(html, {onOpen, onClose})`, `permitDetailSections(row)`, `savePermitNote`, `state.userPermitNotes`, `announceListAction`, `contractorLinesHtml(value, role)`, the `#list-action-status` aria-live region, native `<dialog>`, and the v2 KV list schema.
- **Prefer native `<dialog>`** for the walkthrough form (top-layer, immune to the Jul 22 transformed-ancestor bug).
- **The overlay section renderer is byte-identical in `list.html` and `index.html`** by project design. Every change to `permitDetailSections` and its helpers goes into BOTH, verified identical.
- **Never edit these HTML files with a bash heredoc.** A heredoc turned `\b` into literal 0x08 bytes in Phase 2 — invisible in diffs, silently broke regexes. Use the Edit tool, or a Python script that reads bytes, patches, and asserts `count(b"\x08") == 0 and count(b"\x00") == 0` before writing.
- **Line endings:** stage `list.html` with `git -c core.autocrlf=false add docs/list.html`. `index.html` stages normally (LF).
- **Never stage `worker/` WIP** (`.wrangler/`, `node_modules/`, `package-lock.json`).
- **`body.modal-open { animation: none }`** stays. No `transform`/`filter`/`will-change`/`contain` on an ancestor of `#permit-modal`.
- **Author is unverified free text** (D2). Remember the last-used name in `chi_permit_author`, default `anonymous`.
- **Photos are Phase 4.** Do not build upload or gallery here. The thread renderer must not crash on a `kind: "photo"` post — render its text and a muted "photo" marker.
- **Verification:** `python -m http.server 8791 --directory docs`; Playwright at the cached shell path. Seed `localStorage` with `page.addInitScript`, never `evaluate()` after a `goto`. Scope route stubs by method. Run each browser suite on its own to avoid port contention.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `worker/src/notes.js` | Thread CRUD, walkthrough validation, count map | **Create** |
| `worker/src/index.js` | Route table | Modify — add two routes |
| `worker/test/notes.test.mjs` | Worker note units | **Create** |
| `docs/list.html` | Draft+Post, thread render, walkthrough, counts | Modify |
| `docs/index.html` | Same overlay changes (kept identical) | Modify |

---

### Task 1: Worker — the note thread store

**Files:**
- Create: `worker/src/notes.js`
- Create: `worker/test/notes.test.mjs`
- Modify: `worker/src/index.js` (import + two routes + endpoint list)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `sanitizeText(value) -> string` (trimmed, ≤2000 chars)
  - `sanitizeWalk(body) -> object | null` — a validated `walk` post payload
  - `makeNoteId() -> "n_" + 8 hex`
  - `handleNotes(url, env, request)` serving `/api/notes/:permit` (GET, POST, PUT, DELETE) and `/api/notes/counts?p=a,b,c` (GET)

- [ ] **Step 1: Write the failing tests**

Create `worker/test/notes.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { sanitizeText, sanitizeWalk, makeNoteId, handleNotes } from "../src/notes.js";

test("makeNoteId is n_ plus 8 hex and varies", () => {
  assert.match(makeNoteId(), /^n_[0-9a-f]{8}$/);
  assert.notEqual(makeNoteId(), makeNoteId());
});

test("sanitizeText trims and caps at 2000", () => {
  assert.equal(sanitizeText("  hi  "), "hi");
  assert.equal(sanitizeText("x".repeat(3000)).length, 2000);
  assert.equal(sanitizeText(null), "");
});

test("sanitizeWalk keeps a full sub-on-site payload", () => {
  const out = sanitizeWalk({
    job: "new", onsite: "sub",
    party: { name: "A PLUS REFRIGERATION", phone: "7735550142", covers: "Electrical", jobs: 3, estimate: "1-3d" },
    gc: { name: "606 CONSTRUCTION", phone: "3125550198" },
  });
  assert.equal(out.job, "new");
  assert.equal(out.onsite, "sub");
  assert.equal(out.party.name, "A PLUS REFRIGERATION");
  assert.equal(out.party.jobs, 3);
  assert.equal(out.gc.name, "606 CONSTRUCTION");
});

test("sanitizeWalk clamps job and onsite to their allowed sets", () => {
  assert.equal(sanitizeWalk({ job: "spaceship", onsite: "nobody" }).job, "remodel");
  assert.equal(sanitizeWalk({ job: "new", onsite: "aliens" }).onsite, "none");
});

test("sanitizeWalk clamps estimate to the fixed set", () => {
  assert.equal(sanitizeWalk({ onsite: "gc", party: { estimate: "someday" } }).party.estimate, "unknown");
  assert.equal(sanitizeWalk({ onsite: "gc", party: { estimate: "1-3d" } }).party.estimate, "1-3d");
});

test("sanitizeWalk with nobody on site drops party and gc", () => {
  const out = sanitizeWalk({ job: "remodel", onsite: "none", party: { name: "x" }, gc: { name: "y" } });
  assert.equal(out.party, null);
  assert.equal(out.gc, null);
});

test("sanitizeWalk keeps gc only when a sub was on site", () => {
  const gcOnSite = sanitizeWalk({ onsite: "gc", party: { name: "GC" }, gc: { name: "ignored" } });
  assert.equal(gcOnSite.gc, null, "a GC on site has no separate their-GC block");
  const subOnSite = sanitizeWalk({ onsite: "sub", party: { name: "Sub" }, gc: { name: "Their GC" } });
  assert.equal(subOnSite.gc.name, "Their GC");
});

function fakeKV() {
  const map = new Map(), meta = new Map();
  return {
    map, meta,
    async getWithMetadata(k) { return { value: map.get(k) ?? null, metadata: meta.get(k) ?? null }; },
    async put(k, v, opts) { map.set(k, v); if (opts && opts.metadata) meta.set(k, opts.metadata); },
    async delete(k) { map.delete(k); meta.delete(k); },
    async list({ prefix = "" } = {}) {
      return { keys: [...map.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name, metadata: meta.get(name) ?? null })), list_complete: true, cursor: null };
    },
  };
}
const ENV = () => ({ CACHE: fakeKV() });
const noteReq = (permit, method, body) => new Request(`https://w/api/notes/${permit}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

test("POST then GET round-trips a text post", async () => {
  const env = ENV();
  const posted = await handleNotes(new URL("https://w/api/notes/101082609"), env, noteReq("101082609", "POST", { kind: "text", author: "Divyam", text: "Roof crew on site" }));
  assert.equal(posted.status, 200);
  const { id } = await posted.json();
  assert.match(id, /^n_[0-9a-f]{8}$/);
  const got = await handleNotes(new URL("https://w/api/notes/101082609"), env, noteReq("101082609", "GET"));
  const body = await got.json();
  assert.equal(body.notes.length, 1);
  assert.equal(body.notes[0].text, "Roof crew on site");
  assert.equal(body.notes[0].author, "Divyam");
  assert.ok(body.notes[0].ts > 0);
});

test("author falls back to anonymous", async () => {
  const env = ENV();
  await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "POST", { kind: "text", text: "hi" }));
  const body = await (await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "GET"))).json();
  assert.equal(body.notes[0].author, "anonymous");
});

test("POST rejects a permit key that is not permit-shaped", async () => {
  const res = await handleNotes(new URL("https://w/api/notes/bad%20key"), ENV(), noteReq("bad%20key", "POST", { kind: "text", text: "x" }));
  assert.equal(res.status, 400);
});

test("POST rejects an empty text post", async () => {
  const res = await handleNotes(new URL("https://w/api/notes/1"), ENV(), noteReq("1", "POST", { kind: "text", text: "   " }));
  assert.equal(res.status, 400);
});

test("PUT edits a post in place, keeping author and ts, stamping editedTs", async () => {
  const env = ENV();
  const { id } = await (await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "POST", { kind: "text", author: "A", text: "first" }))).json();
  const url = new URL(`https://w/api/notes/1/${id}`);
  const res = await handleNotes(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ text: "edited" }) }));
  assert.equal(res.status, 200);
  const body = await (await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "GET"))).json();
  assert.equal(body.notes[0].text, "edited");
  assert.equal(body.notes[0].author, "A");
  assert.ok(body.notes[0].editedTs > 0);
});

test("DELETE removes one post and updates the count", async () => {
  const env = ENV();
  const { id } = await (await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "POST", { kind: "text", text: "a" }))).json();
  await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "POST", { kind: "text", text: "b" }));
  const url = new URL(`https://w/api/notes/1/${id}`);
  await handleNotes(url, env, new Request(url, { method: "DELETE" }));
  const body = await (await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "GET"))).json();
  assert.equal(body.notes.length, 1);
  assert.equal(env.CACHE.meta.get("note:1").n, 1);
});

test("the count map reads every noted permit in one list call", async () => {
  const env = ENV();
  await handleNotes(new URL("https://w/api/notes/100"), env, noteReq("100", "POST", { kind: "text", text: "a" }));
  await handleNotes(new URL("https://w/api/notes/100"), env, noteReq("100", "POST", { kind: "text", text: "b" }));
  await handleNotes(new URL("https://w/api/notes/200"), env, noteReq("200", "POST", { kind: "text", text: "c" }));
  const url = new URL("https://w/api/notes/counts?p=100,200,300");
  const res = await handleNotes(url, env, new Request(url));
  const body = await res.json();
  assert.deepEqual(body.counts, { "100": 2, "200": 1 });
  assert.equal(body.counts["300"], undefined, "a permit with no notes is simply absent");
});

test("a walkthrough post round-trips", async () => {
  const env = ENV();
  await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "POST", {
    kind: "walk", author: "Divyam", job: "new", onsite: "sub",
    party: { name: "Sub", phone: "7735550142", covers: "Electrical", jobs: 3, estimate: "1-3d" },
    gc: { name: "Their GC", phone: "3125550198" },
  }));
  const body = await (await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "GET"))).json();
  assert.equal(body.notes[0].kind, "walk");
  assert.equal(body.notes[0].party.name, "Sub");
  assert.equal(body.notes[0].gc.name, "Their GC");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && npm test`
Expected: FAIL — `Cannot find module '../src/notes.js'`

- [ ] **Step 3: Create `worker/src/notes.js`**

```js
const PERMIT_RE = /^[A-Za-z0-9-]{1,16}$/;
const NOTE_ID_RE = /^n_[0-9a-f]{8}$/;
const MAX_TEXT = 2000;
const MAX_NAME = 120;
const MAX_POSTS = 200;
const JOBS = new Set(["new", "remodel"]);
const ONSITE = new Set(["none", "gc", "sub"]);
const ESTIMATES = new Set(["same-day", "1-3d", "week", "longer", "unknown"]);

function resp(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export function makeNoteId() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return "n_" + [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

export function sanitizeText(value) {
  return String(value ?? "").trim().slice(0, MAX_TEXT);
}

function sanitizeParty(value) {
  if (!value || typeof value !== "object") return null;
  const name = String(value.name ?? "").trim().slice(0, MAX_NAME);
  if (!name) return null;
  const jobs = Number(value.jobs);
  return {
    name,
    phone: String(value.phone ?? "").replace(/[^0-9+() .-]/g, "").slice(0, 24),
    covers: String(value.covers ?? "").slice(0, MAX_NAME),
    jobs: Number.isInteger(jobs) && jobs > 0 && jobs < 1000 ? jobs : null,
    estimate: ESTIMATES.has(value.estimate) ? value.estimate : "unknown",
  };
}

export function sanitizeWalk(body) {
  const b = body && typeof body === "object" ? body : {};
  const onsite = ONSITE.has(b.onsite) ? b.onsite : "none";
  const party = onsite === "none" ? null : sanitizeParty(b.party);
  // Only a sub on site has a separate "their GC" block.
  const gc = onsite === "sub" && b.gc && typeof b.gc === "object"
    ? (() => {
        const name = String(b.gc.name ?? "").trim().slice(0, MAX_NAME);
        return name ? { name, phone: String(b.gc.phone ?? "").replace(/[^0-9+() .-]/g, "").slice(0, 24) } : null;
      })()
    : null;
  return { job: JOBS.has(b.job) ? b.job : "remodel", onsite, party, gc };
}

async function readThread(env, permit) {
  const stored = await env.CACHE.getWithMetadata("note:" + permit);
  if (!stored.value) return [];
  try { const a = JSON.parse(stored.value); return Array.isArray(a) ? a : []; } catch { return []; }
}

async function writeThread(env, permit, thread) {
  if (!thread.length) { await env.CACHE.delete("note:" + permit); return; }
  await env.CACHE.put("note:" + permit, JSON.stringify(thread.slice(0, MAX_POSTS)), { metadata: { n: Math.min(thread.length, MAX_POSTS) } });
}

export async function handleNotes(url, env, request) {
  // GET /api/notes/counts?p=a,b,c
  if (url.pathname === "/api/notes/counts") {
    const want = new Set((url.searchParams.get("p") || "").split(",").filter(Boolean));
    const listed = await env.CACHE.list({ prefix: "note:" });
    const counts = {};
    for (const key of listed.keys) {
      const permit = key.name.slice(5);
      const n = Number(key.metadata && key.metadata.n);
      if (want.has(permit) && n > 0) counts[permit] = n;
    }
    return resp({ counts }, 200);
  }

  const m = url.pathname.match(/^\/api\/notes\/([^/]+)(?:\/([^/]+))?$/);
  if (!m) return resp({ error: "not found" }, 404);
  const permit = decodeURIComponent(m[1]);
  const noteId = m[2];
  if (!PERMIT_RE.test(permit)) return resp({ error: "bad permit" }, 400);

  if (request.method === "GET" && !noteId) {
    return resp({ notes: await readThread(env, permit) }, 200);
  }

  if (request.method === "POST" && !noteId) {
    let body;
    try { body = JSON.parse(await request.text()); } catch { return resp({ error: "bad json" }, 400); }
    const author = String(body.author ?? "").trim().slice(0, 40) || "anonymous";
    const now = Math.floor(Date.now() / 1000);
    const base = { id: makeNoteId(), author, ts: now, editedTs: null };
    let post;
    if (body.kind === "walk") post = { ...base, kind: "walk", ...sanitizeWalk(body) };
    else if (body.kind === "photo") post = { ...base, kind: "photo", text: sanitizeText(body.text), photos: [] }; // Phase 4 fills photos
    else {
      const text = sanitizeText(body.text);
      if (!text) return resp({ error: "empty" }, 400);
      post = { ...base, kind: "text", text };
    }
    const thread = await readThread(env, permit);
    thread.push(post);
    await writeThread(env, permit, thread);
    return resp({ id: post.id }, 200);
  }

  if ((request.method === "PUT" || request.method === "DELETE") && noteId) {
    if (!NOTE_ID_RE.test(noteId)) return resp({ error: "bad id" }, 400);
    const thread = await readThread(env, permit);
    const i = thread.findIndex(p => p.id === noteId);
    if (i < 0) return resp({ error: "not found" }, 404);
    if (request.method === "DELETE") {
      thread.splice(i, 1);
    } else {
      let body;
      try { body = JSON.parse(await request.text()); } catch { return resp({ error: "bad json" }, 400); }
      const post = thread[i];
      if (post.kind === "walk") Object.assign(post, sanitizeWalk(body));
      else { const text = sanitizeText(body.text); if (!text) return resp({ error: "empty" }, 400); post.text = text; }
      post.editedTs = Math.floor(Date.now() / 1000);
    }
    await writeThread(env, permit, thread);
    return resp({ ok: true }, 200);
  }

  return resp({ error: "method not allowed" }, 405);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd worker && npm test`
Expected: PASS — all note tests plus the existing suites.

- [ ] **Step 5: Register the routes**

In `worker/src/index.js`, add the import:

```js
import { handleNotes } from "./notes.js";
```

Add to `ROUTES`, **before** `/api/lists` is irrelevant, but `/api/notes/counts` must be reachable — a single `/^\/api\/notes/` pattern covers both the thread and the counts path since `handleNotes` branches on the exact pathname:

```js
  { pattern: /^\/api\/notes/, handler: handleNotes },
```

Add to the `endpoints` array:

```js
          "GET·POST /api/notes/:permit ; PUT·DELETE /api/notes/:permit/:id",
          "GET /api/notes/counts?p=a,b,c -> {counts}",
```

- [ ] **Step 6: Confirm the counts path is not shadowed**

Run:

```bash
cd worker && node -e "
const re = /^\/api\/notes/;
for (const p of ['/api/notes/counts', '/api/notes/101082609', '/api/notes/101082609/n_deadbeef']) console.log(p, re.test(p));
"
```

Expected: all `true` (all handled by `handleNotes`, which then distinguishes `counts` from a permit).

- [ ] **Step 7: Commit**

```bash
git add worker/src/notes.js worker/test/notes.test.mjs worker/src/index.js
git commit -m "feat(worker): public note threads per permit

note:<permit> holds an array of posts (text | walk | photo) with a {n} count
in KV metadata, so GET /api/notes/counts reads every noted permit in one
list() call. Walkthrough validation collapses to one contact block plus an
optional their-GC block that exists only when a sub was on site."
```

---

### Task 2: Client — draft, Post, and the text thread

**Files:**
- Modify: `docs/list.html` — the Notes section builder in `permitDetailSections`, plus thread fetch/render/post helpers
- Modify: `docs/index.html` — identical changes
- Test: `verify-tmp/p3-thread.mjs`

**Interfaces:**
- Consumes: `openPermitModal`'s `onOpen`, `savePermitNote`, `state.userPermitNotes`, `API_BASE`, `esc`, `clean`, `announceListAction`
- Produces (identical in both pages): `postNoteText(permit)`, `fetchThread(permit)`, `renderThread(permit)`, `threadPostHtml(post)`, `dateStampLabel(ts)`, `editNotePost(permit, id)`, `deleteNotePost(permit, id)`, `state.threads` cache `{ [permit]: { loading, posts, error } }`

- [ ] **Step 1: Write the failing test for the pure renderer**

Create `verify-tmp/p3-thread.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { threadPostHtml } from "./p3-thread-impl.mjs";

test("a text post shows author, text and escapes both", () => {
  const html = threadPostHtml({ id: "n_1", kind: "text", author: "<b>Div</b>", text: "<script>x", ts: 1753088040, editedTs: null });
  assert.match(html, /&lt;b&gt;Div/);
  assert.match(html, /&lt;script&gt;x/);
  assert.ok(!/<script>x/.test(html), "must not emit raw markup");
});

test("an edited post is marked edited", () => {
  assert.match(threadPostHtml({ id: "n_1", kind: "text", author: "A", text: "hi", ts: 1, editedTs: 2 }), /edited/i);
});

test("a walk post renders its structured fields", () => {
  const html = threadPostHtml({ id: "n_2", kind: "walk", author: "A", ts: 1, job: "new", onsite: "sub",
    party: { name: "SUB CO", phone: "7735550142", covers: "Electrical", jobs: 3, estimate: "1-3d" },
    gc: { name: "GC CO", phone: "3125550198" } });
  assert.match(html, /New build/);
  assert.match(html, /SUB CO/);
  assert.match(html, /GC CO/);
  assert.match(html, /tel:7735550142/);
});

test("a photo post (Phase 4 forward-compat) renders without crashing", () => {
  const html = threadPostHtml({ id: "n_3", kind: "photo", author: "A", ts: 1, text: "site pic", photos: [] });
  assert.match(html, /site pic/);
  assert.ok(typeof html === "string" && html.length > 0);
});

test("edit and delete controls carry the post id", () => {
  const html = threadPostHtml({ id: "n_abc", kind: "text", author: "A", text: "x", ts: 1, editedTs: null });
  assert.match(html, /n_abc/);
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement the helpers in `docs/list.html`**

Add near the other overlay helpers. `dec` does not exist in this file — decode with `decodeURIComponent`:

```js
    const ESTIMATE_LABELS = { "same-day": "Same day", "1-3d": "1–3 days", "week": "About a week", "longer": "Longer", "unknown": "Didn't say" };
    const JOB_LABELS = { "new": "New build", "remodel": "Remodel" };

    function dateStampLabel(ts) {
      const d = new Date(Number(ts) * 1000);
      if (!Number.isFinite(d.getTime())) return "";
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    function threadPostHtml(post) {
      const when = dateStampLabel(post.ts) + (post.editedTs ? " · edited" : "");
      const head = `<p class="tp-head"><span class="tp-who">${esc(post.author || "anonymous")}</span><time>${esc(when)}</time>
        <span class="tp-kind">${post.kind === "walk" ? "Walkthrough" : post.kind === "photo" ? "Photo" : "Note"}</span></p>`;
      const acts = `<p class="tp-act">
        <button type="button" onclick="editNotePost('${esc(currentThreadPermit)}','${esc(post.id)}')">Edit</button>
        <button type="button" class="del" onclick="deleteNotePost('${esc(currentThreadPermit)}','${esc(post.id)}')">Delete</button></p>`;
      if (post.kind === "walk") {
        const p = post.party;
        const rows = [
          ["Job", JOB_LABELS[post.job] || "—"],
          ["On site", post.onsite === "sub" ? "Open sub" : post.onsite === "gc" ? "General contractor" : "Nobody"],
        ];
        if (p) {
          if (p.name) rows.push(["Company", esc(p.name)]);
          if (p.phone) rows.push(["Phone", `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>`]);
          if (p.covers) rows.push(["Covers", esc(p.covers)]);
          const cap = [p.jobs ? `${p.jobs} jobs at a time` : "", ESTIMATE_LABELS[p.estimate] ? `estimates ${ESTIMATE_LABELS[p.estimate]}` : ""].filter(Boolean).join(" · ");
          if (cap) rows.push(["Capacity", esc(cap)]);
        }
        if (post.gc && post.gc.name) rows.push(["Their GC", esc(post.gc.name) + (post.gc.phone ? ` · <a href="tel:${esc(post.gc.phone)}">${esc(post.gc.phone)}</a>` : "")]);
        return `<article class="tp walk">${head}<dl class="tp-kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>${acts}</article>`;
      }
      const photo = post.kind === "photo" ? `<p class="tp-photo-note">📷 photo</p>` : "";
      return `<article class="tp">${head}<p class="tp-text">${esc(post.text || "")}</p>${photo}${acts}</article>`;
    }
```

> `currentThreadPermit` is a module-level string set by `renderThread`. Inline `onclick` handlers cannot close over a local, and the permit is the same for the whole open overlay, so a single module global is the simplest correct choice.

- [ ] **Step 4: Add fetch, render, post, edit, delete**

```js
    let currentThreadPermit = "";

    async function fetchThread(permit) {
      state.threads = state.threads || {};
      state.threads[permit] = { loading: true, posts: [], error: "" };
      renderThread(permit);
      try {
        const res = await fetch(`${API_BASE}/api/notes/${encodeURIComponent(permit)}`);
        if (!res.ok) throw new Error("thread unavailable");
        const data = await res.json();
        state.threads[permit] = { loading: false, posts: Array.isArray(data.notes) ? data.notes : [], error: "" };
      } catch {
        state.threads[permit] = { loading: false, posts: [], error: "Public notes could not be loaded." };
      }
      renderThread(permit);
    }

    function renderThread(permit) {
      currentThreadPermit = permit;
      const host = document.getElementById("pm-thread");
      if (!host) return;
      const t = (state.threads && state.threads[permit]) || { loading: true, posts: [] };
      if (t.loading) { host.innerHTML = `<p class="tp-empty">Loading public notes…</p>`; return; }
      if (t.error) { host.innerHTML = `<p class="tp-empty">${esc(t.error)}</p>`; return; }
      host.innerHTML = t.posts.length
        ? `<h4 class="tp-count">Public notes · ${t.posts.length}</h4>${t.posts.map(threadPostHtml).join("")}`
        : `<p class="tp-empty">No public notes yet. Post one above.</p>`;
    }

    async function postNoteText(permit) {
      const box = document.getElementById("pm-note-draft");
      const text = (box && box.value || "").trim();
      if (!text) { announceListAction("Type a note before posting."); return; }
      const author = (localStorage.getItem("chi_permit_author") || "").trim();
      const btn = document.getElementById("pm-post-btn");
      if (btn) btn.disabled = true;
      try {
        const res = await fetch(`${API_BASE}/api/notes/${encodeURIComponent(permit)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "text", author, text }),
        });
        if (!res.ok) throw new Error("post failed");
        await fetchThread(permit);
        announceListAction("Note posted.");
        const first = document.querySelector("#pm-thread .tp");
        if (first) first.setAttribute("tabindex", "-1"), first.focus();
      } catch {
        announceListAction("Could not post — this needs the live site.");
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function deleteNotePost(permit, id) {
      if (!window.confirm("Delete this public note?")) return;
      try {
        await fetch(`${API_BASE}/api/notes/${encodeURIComponent(permit)}/${encodeURIComponent(id)}`, { method: "DELETE" });
        await fetchThread(permit);
        announceListAction("Note deleted.");
      } catch { announceListAction("Could not delete right now."); }
    }

    async function editNotePost(permit, id) {
      const t = state.threads && state.threads[permit];
      const post = t && t.posts.find(p => p.id === id);
      if (!post || post.kind === "walk") return; // walk edits reopen the form (Task 3)
      const next = window.prompt("Edit note", post.text || "");
      if (next === null) return;
      try {
        await fetch(`${API_BASE}/api/notes/${encodeURIComponent(permit)}/${encodeURIComponent(id)}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: next }),
        });
        await fetchThread(permit);
        announceListAction("Note updated.");
      } catch { announceListAction("Could not update right now."); }
    }
```

- [ ] **Step 5: Replace the Notes section builder**

In `permitDetailSections`, replace the final Notes builder (the `<textarea class="pm-note">` section) with a private draft plus Post button plus a thread host. Keep the draft bound to `savePermitNote` so existing local notes are untouched:

```js
        () => `<section class="pm-block"><h3>Notes</h3>
            <div class="pm-note-draft">
              <label class="pm-draft-label" for="pm-note-draft">My note <span class="pm-lock">🔒 private to this browser</span></label>
              <textarea id="pm-note-draft" class="pm-note" placeholder="Private note, saved as you type…"
                oninput="savePermitNote('${enc(row.permit_number)}', this.value)">${esc(state.userPermitNotes[num] || "")}</textarea>
              <div class="pm-post-row">
                <span class="small">Posting as <strong>${esc((typeof localStorage !== "undefined" && localStorage.getItem("chi_permit_author")) || "anonymous")}</strong></span>
                <button type="button" class="primary" id="pm-post-btn" onclick="postNoteFromDraft('${enc(row.permit_number)}')">Post to permit</button>
              </div>
            </div>
            <div id="pm-thread" class="pm-thread"></div>
          </section>`,
```

Add `postNoteFromDraft` (posts the draft text, then also lets the user name themselves the first time):

```js
    async function postNoteFromDraft(encodedPermit) {
      const permit = decodeURIComponent(encodedPermit);
      if (!(localStorage.getItem("chi_permit_author") || "").trim()) {
        const name = window.prompt("Post publicly as (leave blank for anonymous):", "");
        if (name === null) return;
        try { localStorage.setItem("chi_permit_author", name.trim()); } catch { /* storage blocked */ }
      }
      await postNoteText(permit);
    }
```

- [ ] **Step 6: Load the thread when the overlay opens**

Find `openPermitDetail` (it calls `openPermitModal(html, {onOpen})`). In the `onOpen` callback, after existing wiring, add:

```js
      const permit = clean(row.permit_number);
      if (permit) fetchThread(permit);
```

If `openPermitDetail` does not already pass `onOpen`, add one that calls `resolveGeoForRows`/existing logic **and** `fetchThread`. Read the function first; do not clobber existing `onOpen` work.

- [ ] **Step 7: Add CSS**

```css
    .pm-note-draft { border: 1px solid var(--line); border-radius: 8px; padding: .6rem; background: var(--surface-subtle); margin-bottom: .8rem; }
    .pm-draft-label { display: flex; justify-content: space-between; font-size: .78rem; color: var(--muted); margin-bottom: .35rem; }
    .pm-lock { font-weight: 600; }
    .pm-post-row { display: flex; justify-content: space-between; align-items: center; gap: .5rem; flex-wrap: wrap; margin-top: .5rem; }
    .pm-thread { display: grid; gap: .6rem; }
    .tp { border: 1px solid var(--cell-line); border-left: 3px solid var(--t7); border-radius: 0 8px 8px 0; padding: .55rem .7rem; background: var(--surface-subtle); }
    .tp-head { display: flex; gap: .5rem; align-items: baseline; flex-wrap: wrap; font-size: .78rem; color: var(--muted); margin-bottom: .25rem; }
    .tp-who { font-weight: 700; color: var(--ink); font-size: .84rem; }
    .tp-kind { font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; border: 1px solid var(--t7); color: var(--t7); border-radius: 3px; padding: 0 .25rem; }
    .tp-text { font-size: .88rem; }
    .tp-kv { display: grid; grid-template-columns: auto 1fr; gap: .2rem .7rem; font-size: .85rem; margin: 0; }
    .tp-kv dt { color: var(--muted); }
    .tp-kv dd { margin: 0; }
    .tp-act { display: flex; gap: .5rem; margin-top: .35rem; }
    .tp-act button { font: inherit; font-size: .78rem; font-weight: 600; background: none; border: 1px solid transparent; padding: .3rem .5rem; border-radius: 6px; color: var(--muted); cursor: pointer; min-height: 40px; }
    .tp-act button:hover { border-color: var(--line); }
    .tp-act button.del { color: var(--danger); }
    .tp-count { font-size: .74rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 .2rem; }
    .tp-empty { color: var(--muted); font-size: .85rem; }
```

- [ ] **Step 8: Apply the identical change to `index.html`**, then verify the shared block is byte-identical (the Phase 1 Task 5 Step 7 technique, matching from a marker comment through `postNoteFromDraft`).

- [ ] **Step 9: Extract and run the unit test**

Copy `threadPostHtml`, `dateStampLabel`, the label maps, an `esc`, and a `let currentThreadPermit=""` into `verify-tmp/p3-thread-impl.mjs`. Run `node --test "verify-tmp/p3-thread.mjs"` → PASS.

- [ ] **Step 10: Verify in a browser (both pages, both viewports)**

Stub `GET /api/notes/:permit` → a two-post thread, `POST` → `{id:"n_00000001"}`. For `list.html` and `index.html`:
1. Opening a permit loads and shows the thread.
2. The private draft still binds to `savePermitNote` (type → `chi_permit_user_notes` updates).
3. Post sends `{kind:"text", author, text}` and re-fetches; the aria-live region announces "Note posted."
4. First post gets focus after posting.
5. At an iPhone 13 viewport, the overlay + thread fit and the draft textarea is ≥16px.

- [ ] **Step 11: Commit**

```bash
git add docs/index.html
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(overlay): private draft plus public note thread

The overlay note box stays private and local (chi_permit_user_notes, unchanged);
a Post button publishes a copy to the permit's public thread, which renders
below with author, timestamp, edit and delete. The thread is keyed by permit
number, so it is the same on list.html and index.html. Photo posts render
forward-compatibly ahead of Phase 4."
```

---

### Task 3: Client — the walkthrough form and open subs

**Files:**
- Modify: `docs/list.html` — walkthrough `<dialog>`, `openWalkthrough`, `postWalkthrough`, contractor-section merge
- Modify: `docs/index.html` — identical
- Test: `verify-tmp/p3-walk.mjs`

**Interfaces:**
- Consumes: `postNoteText`/`fetchThread` (Task 2), `contractorLinesHtml`, `API_BASE`
- Produces (identical in both): `openWalkthrough(permit)`, `walkPayload(dialog)`, `reportedSubsFor(permit)`

- [ ] **Step 1: Write the failing test for the payload builder**

```js
import { test } from "node:test";
import assert from "node:assert";
import { walkFieldsToPayload } from "./p3-walk-impl.mjs";

test("nobody on site yields no party or gc", () => {
  const out = walkFieldsToPayload({ job: "remodel", onsite: "none" });
  assert.equal(out.onsite, "none");
  assert.equal(out.party, undefined);
});

test("a GC on site carries one contact block and no their-GC", () => {
  const out = walkFieldsToPayload({ job: "new", onsite: "gc", name: "GC CO", phone: "3125550198", covers: "General", jobs: "2", estimate: "week" });
  assert.equal(out.onsite, "gc");
  assert.equal(out.party.name, "GC CO");
  assert.equal(out.party.jobs, 2);
  assert.equal(out.gc, undefined);
});

test("a sub on site adds a their-GC block", () => {
  const out = walkFieldsToPayload({ job: "new", onsite: "sub", name: "SUB", phone: "7735550142", covers: "Electrical", jobs: "3", estimate: "1-3d", gcName: "THEIR GC", gcPhone: "3125550198" });
  assert.equal(out.party.name, "SUB");
  assert.equal(out.gc.name, "THEIR GC");
});

test("jobs coerces to a number or null", () => {
  assert.equal(walkFieldsToPayload({ onsite: "gc", name: "X", jobs: "" }).party.jobs, null);
  assert.equal(walkFieldsToPayload({ onsite: "gc", name: "X", jobs: "4" }).party.jobs, 4);
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

```js
    function walkFieldsToPayload(f) {
      const out = { kind: "walk", job: f.job === "new" ? "new" : "remodel", onsite: ["none", "gc", "sub"].includes(f.onsite) ? f.onsite : "none" };
      if (out.onsite !== "none") {
        const jobs = parseInt(f.jobs, 10);
        out.party = { name: (f.name || "").trim(), phone: (f.phone || "").trim(), covers: (f.covers || "").trim(),
          jobs: Number.isInteger(jobs) ? jobs : null, estimate: f.estimate || "unknown" };
      }
      if (out.onsite === "sub" && (f.gcName || "").trim()) {
        out.gc = { name: f.gcName.trim(), phone: (f.gcPhone || "").trim() };
      }
      return out;
    }
```

- [ ] **Step 4: Build the dialog** (native `<dialog id="walkthrough">`). One `fieldset` per question — Job (New build / Remodel), Who was on site (Nobody / GC / Open sub). Choosing GC or sub reveals a contact block (company, phone `type=tel`, covers, jobs `type=number`, estimate `<select>` of the five fixed options). Choosing sub reveals a second short block (their GC name + phone). Revealing a block scrolls it into view and focuses its first field. Submit builds `walkFieldsToPayload`, POSTs it, closes, and `fetchThread(permit)`.

Wire an `openWalkthrough(permit)` and a "Log a site walkthrough" button in the Notes section, next to Post.

- [ ] **Step 5: Merge reported subs into the contractor section**

`reportedSubsFor(permit)` reads the cached thread's `walk` posts and returns sub company names not already in the permit's `open_subs`. In the Open subs section builder, append these badged `reported on site` so user-reported names never blend into city data:

```js
        () => { const reported = reportedSubsFor(clean(row.permit_number));
          return `<section class="pm-block"><h3>Open subs</h3>
            <div class="pm-contractors" data-role="open_tech">${contractorLinesHtml(row.open_subs, "open_tech")}</div>
            ${reported.length ? `<div class="pm-reported">${reported.map(n => `<span class="rep-sub">${esc(n)} <span class="rep-badge">reported on site</span></span>`).join("")}</div>` : ""}
          </section>`; },
```

Because the contractor section renders before the thread loads, re-render or patch it after `fetchThread` resolves: in `fetchThread`'s success path, if the open overlay matches this permit, update the `.pm-reported` container. Read `openPermitModal`'s refresh-in-place behavior first and reuse it rather than reinventing.

- [ ] **Step 6: CSS**

```css
    .wk-fieldset { border: 1px solid var(--line); border-radius: 8px; padding: .6rem .75rem; margin: 0 0 .7rem; }
    .wk-fieldset legend { font-size: .82rem; font-weight: 700; padding: 0 .3rem; }
    .wk-choices { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .3rem; }
    .wk-choice { display: inline-flex; align-items: center; gap: .4rem; cursor: pointer; border: 1px solid var(--line); border-radius: 8px; padding: .4rem .7rem; min-height: 44px; font-size: .86rem; background: var(--surface-subtle); }
    .wk-choice:has(input:checked) { border-color: var(--primary); background: var(--primary-soft); font-weight: 600; }
    .wk-branch { border-left: 3px solid var(--primary); background: var(--surface-subtle); border-radius: 0 8px 8px 0; padding: .7rem .8rem; margin-bottom: .7rem; }
    .rep-sub { display: inline-flex; align-items: center; gap: .35rem; margin-right: .6rem; font-size: .85rem; }
    .rep-badge { font-size: .66rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--warning); border: 1px dashed var(--warning); border-radius: 3px; padding: 0 .2rem; }
```

- [ ] **Step 7: Apply identically to `index.html`; verify byte-identical.**

- [ ] **Step 8: Extract and run** `verify-tmp/p3-walk.mjs` → PASS.

- [ ] **Step 9: Verify in a browser**
1. Choosing "Open sub" reveals both the contact block and the their-GC block; "Nobody" hides both.
2. Submitting posts a `walk` payload and it renders in the thread with its fields.
3. The reported sub appears in the Open subs section badged "reported on site".
4. iPhone 13: dialog fits, choices are ≥44px, inputs ≥16px, revealed block is focused.

- [ ] **Step 10: Commit**

```bash
git add docs/index.html
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(overlay): site walkthrough form and reported subs

One who-was-on-site answer with a single contact block; picking Open sub adds a
short their-GC block. Estimate turnaround is the fixed five-option set. Subs
named in a walkthrough are appended to the Open subs section badged 'reported
on site' so user reports never blend into the city contact data."
```

---

### Task 4: Client — note counts on the saved-list chip

**Files:**
- Modify: `docs/list.html` — `renderUserList` count wiring
- Test: `verify-tmp/p3-counts.mjs`

**Interfaces:**
- Consumes: `GET /api/notes/counts?p=…`, the Phase 2 `.notecount` chip
- Produces: `fetchNoteCounts(permits)`, `applyNoteCounts()`

- [ ] **Step 1: Write the failing test for the merge logic**

```js
import { test } from "node:test";
import assert from "node:assert";
import { chipLabel } from "./p3-counts-impl.mjs";

test("a public count wins over the private-only chip", () => {
  assert.equal(chipLabel({ hasPrivate: true, publicCount: 3 }), "3");
});

test("public zero but private present still shows the private mark", () => {
  assert.equal(chipLabel({ hasPrivate: true, publicCount: 0 }), "✎");
});

test("nothing shows a zero", () => {
  assert.equal(chipLabel({ hasPrivate: false, publicCount: 0 }), "0");
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

The Phase 2 chip reflects the private note only. Phase 3 overlays the public count. `chipLabel` decides what a chip shows; `fetchNoteCounts` bulk-loads counts for the on-screen permits after the table renders, then `applyNoteCounts` updates each `.notecount[data-permit]` in place (like `fillListGeoCells`):

```js
    function chipLabel({ hasPrivate, publicCount }) {
      if (publicCount > 0) return String(publicCount);
      if (hasPrivate) return "✎";
      return "0";
    }

    async function fetchNoteCounts(permits) {
      const ids = permits.filter(Boolean).slice(0, 220);
      if (!ids.length) return;
      try {
        const res = await fetch(`${API_BASE}/api/notes/counts?p=${encodeURIComponent(ids.join(","))}`);
        if (!res.ok) return;
        state.noteCounts = (await res.json()).counts || {};
        applyNoteCounts();
      } catch { /* offline — chips keep their private-only state */ }
    }

    function applyNoteCounts() {
      document.querySelectorAll(".notecount[data-permit]").forEach(el => {
        const permit = el.getAttribute("data-permit");
        const publicCount = Number((state.noteCounts || {})[permit]) || 0;
        const hasPrivate = !!(state.userPermitNotes[permit]);
        const label = chipLabel({ hasPrivate, publicCount });
        el.textContent = publicCount > 0 ? `💬 ${label}` : label;
        el.classList.toggle("zero", label === "0");
      });
    }
```

- [ ] **Step 4: Add `data-permit` to the Phase 2 chip and call the fetch**

In `permitTable`'s note-count cell (Phase 2), add `data-permit="${esc(clean(row.permit_number))}"` to the `.notecount` span (custom stops have no permit number — skip the attribute for `is_custom` rows). After `renderUserList` builds the table, call `fetchNoteCounts(rows.filter(r => !r.is_custom).map(r => clean(r.permit_number)))`.

- [ ] **Step 5: Extract and run** `verify-tmp/p3-counts.mjs` → PASS.

- [ ] **Step 6: Verify in a browser**
1. A permit with 3 public notes shows `💬 3` on the chip.
2. A permit with only a private note shows `✎`.
3. A permit with neither shows `0`.
4. With the counts endpoint stubbed to fail, chips fall back to the private-only state with no console error.

- [ ] **Step 7: Commit**

```bash
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(list): public note count on the saved-list chip

The Phase 2 chip reflected the private note only. It now bulk-fetches public
thread counts for the on-screen permits and shows the public count when there
is one, falling back to the private mark, then zero. One list() -backed request
per render; failure leaves the private-only chip untouched."
```

---

### Task 5: Client — announce and a11y sweep

**Files:**
- Modify: `docs/list.html`, `docs/index.html`

- [ ] **Step 1: Confirm posting announces and moves focus**

`postNoteText` already writes to `#list-action-status` (aria-live polite) and focuses the new post. Confirm the walkthrough post does the same — route it through the same announce + focus tail.

- [ ] **Step 2: Confirm every thread control has a name**

Edit/Delete buttons carry visible text; the delete confirm is a `window.confirm`. The private draft has a `<label>`. Verify at both viewports that no thread control is icon-only without a name.

- [ ] **Step 3: Verify and commit**

```bash
git add docs/index.html
git -c core.autocrlf=false add docs/list.html
git commit -m "chore(overlay): announce posts and confirm thread control names"
```

---

### Task 6: Deploy and verify (covers Phase 2 + Phase 3)

Phase 2 is not yet deployed, so this single deploy carries both phases' Worker changes, and merging this stacked branch brings Phase 2 to `main` with it.

- [ ] **Step 1: Run every suite**

`cd worker && npm test` (Phase 1+2+3 Worker), then `node --test "verify-tmp/p3-*.mjs"` and the earlier `verify-tmp` suites, then each Playwright script individually.

- [ ] **Step 2: Confirm no control characters**

```bash
python -c "import pathlib
for f in ['docs/list.html','docs/index.html','docs/map.html']:
    b=pathlib.Path(f).read_bytes(); print(f, b.count(b'\x08'), b.count(b'\x00'))"
```

Expected: all zeros.

- [ ] **Step 3: Capture the baseline**

```bash
curl -s -H "Origin: https://dkaruri.github.io" \
  "https://chi-permits-api.divyam-c-karuri.workers.dev/api/lists/YnF7y4t" \
  | python -c "import json,sys; d=json.load(sys.stdin); print(len(d['permits']), d['focal']['label'])"
```

Expected: `99 5010 N Monticello`.

- [ ] **Step 4: Ask the user to deploy**

The `/api/notes/*` and Phase 2's `/ticks` endpoints must exist before the client reaches Pages. Ask them to run:

```
! cd worker && npx wrangler deploy
```

- [ ] **Step 5: Verify live**

Re-run Step 3 (unchanged). Then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Origin: https://dkaruri.github.io" -H "Content-Type: application/json" \
  -d '{"kind":"text","author":"smoke","text":"deploy check"}' \
  "https://chi-permits-api.divyam-c-karuri.workers.dev/api/notes/SMOKE-TEST-1"
```

Expected: `200`. Then GET `/api/notes/counts?p=SMOKE-TEST-1` returns `{"counts":{"SMOKE-TEST-1":1}}`, and delete the smoke post via its id so the registry stays clean.

- [ ] **Step 6: Merge, push, report, fold memory**

Merge the stacked branch `--no-ff` to `main` (this also lands Phase 2), push, then fold both phases into memory per the standing instruction. **Stop; do not begin Phase 4 without confirmation.**

---

## Self-Review

**Spec coverage.** §9 thread keyed by permit, three kinds → Task 1 (store), Task 2 (text render, photo forward-compat). §9.1 private draft + explicit Post, `chi_permit_user_notes` unchanged, announce + focus, one-time author prompt → Tasks 2, 5. §9.2 walkthrough one-contact-block + their-GC-only-for-sub + fixed estimate set + fieldset/legend + focus-on-reveal → Task 3. §9.3 reported subs badged "reported on site" → Task 3 Step 5. §9.4 photos deferred, renderer tolerant → Task 2 (photo branch), Task 1 (photo POST stores empty photos). §5.2 `note:<permit>` with `{n}` metadata + counts in one list() → Task 1. Note-count chip → Task 4. §13 iPhone-13 geometry → Tasks 2, 3. §14 CRLF + no-heredoc → every `list.html` step.

**Deferred, not gaps:** photo upload and gallery are Phase 4; the Phase 2 note chip's public overlay is completed here in Task 4.

**Type consistency.** `threadPostHtml(post)` consumes the exact post shape Task 1 stores (`kind`, `author`, `ts`, `editedTs`, `text`/`party`/`gc`). `walkFieldsToPayload` output (`kind:"walk"`, `job`, `onsite`, `party`, `gc`) matches `sanitizeWalk`'s input. `chipLabel({hasPrivate, publicCount})` is identical in test, impl and caller. `fetchThread(permit)` / `renderThread(permit)` / `currentThreadPermit` agree across Tasks 2–3. `estimate` values (`same-day|1-3d|week|longer|unknown`) match between `sanitizeParty`, `ESTIMATE_LABELS` and the dialog `<select>`.

**Two risks carried in deliberately.** (1) `currentThreadPermit` is a module global because inline `onclick` cannot close over the permit; it is safe because only one overlay is open at a time. (2) The contractor section renders before the thread loads, so reported subs are patched in after `fetchThread` resolves — Task 3 Step 5 reuses `openPermitModal`'s existing refresh-in-place rather than a second render path.
