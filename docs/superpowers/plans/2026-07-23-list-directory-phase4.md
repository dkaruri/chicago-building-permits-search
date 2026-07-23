# List Directory — Phase 4 (Photos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone attach up to six photos to a permit's public thread — resized, EXIF-stripped and re-encoded to WebP in the browser before upload — stored in R2 and shown as a gallery, deletable by anyone.

**Architecture:** A new `worker/src/photos.js` streams image bytes to an R2 bucket bound as `PHOTOS`, keyed `photo/<permit>/<photoId>.webp`, and serves them back with a long cache header. The client resizes each picked image on a `<canvas>` (which discards EXIF as a side effect), uploads each, then posts a `kind:"photo"` note that references the returned ids; the thread renderer already tolerates that post and gains a real gallery.

**Tech Stack:** Vanilla ES2022 in self-contained HTML (no build step), Cloudflare Workers + KV + **R2**, `node --test`, Playwright.

## Global Constraints

- **Spec:** `superpowers/specs/2026-07-23-list-directory-design.md` §5.4, §9.4, §10, §11. Decision D14 (photos fully open, no review) is binding — but the input-validation guardrails in §11 are in scope and mandatory.
- **Phases 1–3 are live** (`0517f57`). Reuse: `handleNotes`, `note:<permit>` posts, the overlay thread (`fetchThread`, `renderThread`, `threadPostHtml`, `currentThreadPermit`, `pmAnnounce`), the byte-identical overlay across `list.html`/`index.html`, native `<dialog>`, `API_BASE`, `esc`.
- **The `photo` post is already forward-compatible.** `worker/src/notes.js:96` stores `{ kind:"photo", text, photos:[] }`; `threadPostHtml` renders a `📷 photo` marker. This phase fills `photos` with real refs and replaces the marker with a gallery.
- **Mandatory input validation on the public upload endpoint (§11):** a content-type **allowlist** (`image/jpeg`, `image/png`, `image/webp` only), a **5 MB** hard size cap, server-side **magic-byte sniffing** (never trust the client's Content-Type header alone), and a **delete-any** control on every photo. EXIF is stripped client-side by the canvas re-encode.
- **≤ 6 photos per post.** Enforced client-side and in the note-ref validator.
- **Resize target: 1600px** longest edge. Re-encode to `image/webp`.
- **No build step, no new runtime dependencies** in the client. The Worker gains only the R2 binding, no npm package.
- **Prefer native `<dialog>`** for the photo compose UI.
- **The overlay thread code is byte-identical in `list.html` and `index.html`.** Every change goes into BOTH, verified identical.
- **Never edit the HTML files with a bash heredoc** — it embeds invisible 0x08 / lone-surrogate bytes. Use the Edit tool or a Python script that reads bytes, patches, and asserts `count(b"\x08") == 0 and count(b"\x00") == 0` before writing. Astral emoji in a Python patch string must use `\U0001F4AC`-style escapes, never `\uD83D\uDCAC` (a lone surrogate throws on `.encode("utf-8")`).
- **Line endings:** stage `list.html` with `git -c core.autocrlf=false add docs/list.html`; `index.html` stages normally.
- **Never stage `worker/` WIP** (`.wrangler/`, `node_modules/`, `package-lock.json`).
- **Worker + R2 need the user.** Creating the R2 bucket and deploying require interactive Cloudflare auth an agent cannot do (Task 5). Deploy the Worker **before** the client reaches Pages, or every upload 404s.
- **Verification:** `python -m http.server 8791 --directory docs`; Playwright at `C:\Users\divya\AppData\Local\ms-playwright\chromium_headless_shell-1228\...\chrome-headless-shell.exe`. Seed `localStorage` with `page.addInitScript`, never `evaluate()` after a `goto`. Scope route stubs by method. Run each browser suite alone.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `worker/wrangler.toml` | R2 bucket binding | Modify — add `[[r2_buckets]]` |
| `worker/src/photos.js` | Upload, serve, delete an R2 image | **Create** |
| `worker/src/notes.js` | Accept validated photo refs on a photo post | Modify |
| `worker/src/index.js` | Route table | Modify — one route |
| `worker/test/photos.test.mjs` | Worker photo units (fake R2) | **Create** |
| `worker/test/notes.test.mjs` | photo-ref validation | Modify |
| `docs/list.html`, `docs/index.html` | Compose pipeline, upload, gallery, delete | Modify (identical) |

---

### Task 1: Worker — R2 binding, upload, serve, delete

**Files:**
- Modify: `worker/wrangler.toml` (add the R2 binding)
- Create: `worker/src/photos.js`
- Modify: `worker/src/index.js` (import + one route + endpoint list)
- Create: `worker/test/photos.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `makePhotoId() -> "p_" + 8 hex`
  - `sniffImageType(bytes: Uint8Array) -> "image/jpeg" | "image/png" | "image/webp" | null`
  - `handlePhotos(url, env, request)` serving `POST /api/photo/:permit`, `GET /api/photo/:permit/:id`, `DELETE /api/photo/:permit/:id`

- [ ] **Step 1: Add the R2 binding to `worker/wrangler.toml`**

After the `[[kv_namespaces]]` block, add:

```toml
[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "chi-permits-photos"
```

> The bucket itself is created in Task 5 (`wrangler r2 bucket create chi-permits-photos`). Adding the binding here is safe to commit before the bucket exists; only `wrangler deploy` requires it to exist.

- [ ] **Step 2: Write the failing tests**

Create `worker/test/photos.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { makePhotoId, sniffImageType, handlePhotos } from "../src/photos.js";

const JPEG = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);

test("makePhotoId is p_ plus 8 hex and varies", () => {
  assert.match(makePhotoId(), /^p_[0-9a-f]{8}$/);
  assert.notEqual(makePhotoId(), makePhotoId());
});

test("sniffImageType recognises jpeg, png and webp", () => {
  assert.equal(sniffImageType(JPEG), "image/jpeg");
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(WEBP), "image/webp");
});

test("sniffImageType rejects a disallowed type by its magic bytes", () => {
  assert.equal(sniffImageType(GIF), null);
  assert.equal(sniffImageType(new Uint8Array([1, 2, 3])), null);
});

function fakeR2() {
  const store = new Map();
  return {
    store,
    async put(key, body, opts) { store.set(key, { body: new Uint8Array(body), opts: opts || {} }); },
    async get(key) {
      const o = store.get(key);
      if (!o) return null;
      return {
        body: o.body,
        httpMetadata: o.opts.httpMetadata || {},
        writeHttpMetadata(headers) { if (o.opts.httpMetadata && o.opts.httpMetadata.contentType) headers.set("Content-Type", o.opts.httpMetadata.contentType); },
      };
    },
    async delete(key) { store.delete(key); },
  };
}
const ENV = () => ({ PHOTOS: fakeR2() });
const upload = (permit, bytes, type) => new Request(`https://w/api/photo/${permit}`, { method: "POST", headers: { "Content-Type": type }, body: bytes });

test("POST stores a webp and returns an id, then GET serves it", async () => {
  const env = ENV();
  const posted = await handlePhotos(new URL("https://w/api/photo/101082609"), env, upload("101082609", WEBP, "image/webp"));
  assert.equal(posted.status, 200);
  const { id } = await posted.json();
  assert.match(id, /^p_[0-9a-f]{8}$/);
  assert.ok(env.PHOTOS.store.has(`photo/101082609/${id}.webp`));

  const got = await handlePhotos(new URL(`https://w/api/photo/101082609/${id}`), env, new Request(`https://w/api/photo/101082609/${id}`));
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("Content-Type"), "image/webp");
  assert.match(got.headers.get("Cache-Control") || "", /max-age/);
});

test("POST rejects a permit that is not permit-shaped", async () => {
  const res = await handlePhotos(new URL("https://w/api/photo/bad%20key"), ENV(), upload("bad%20key", WEBP, "image/webp"));
  assert.equal(res.status, 400);
});

test("POST rejects a disallowed content-type even if the header lies", async () => {
  // Header claims webp, bytes are a GIF — the sniff must win.
  const res = await handlePhotos(new URL("https://w/api/photo/1"), ENV(), upload("1", GIF, "image/webp"));
  assert.equal(res.status, 415);
});

test("POST rejects a body over the 5MB cap", async () => {
  const big = new Uint8Array(5 * 1024 * 1024 + 1);
  big.set(WEBP, 0);
  const res = await handlePhotos(new URL("https://w/api/photo/1"), ENV(), upload("1", big, "image/webp"));
  assert.equal(res.status, 413);
});

test("GET on a missing photo is 404", async () => {
  const res = await handlePhotos(new URL("https://w/api/photo/1/p_deadbeef"), ENV(), new Request("https://w/api/photo/1/p_deadbeef"));
  assert.equal(res.status, 404);
});

test("DELETE removes the object", async () => {
  const env = ENV();
  const { id } = await (await handlePhotos(new URL("https://w/api/photo/1"), env, upload("1", WEBP, "image/webp"))).json();
  const del = await handlePhotos(new URL(`https://w/api/photo/1/${id}`), env, new Request(`https://w/api/photo/1/${id}`, { method: "DELETE" }));
  assert.equal(del.status, 200);
  assert.equal(env.PHOTOS.store.size, 0);
});

test("DELETE with a malformed id is rejected", async () => {
  const res = await handlePhotos(new URL("https://w/api/photo/1/not-an-id"), ENV(), new Request("https://w/api/photo/1/not-an-id", { method: "DELETE" }));
  assert.equal(res.status, 400);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd worker && npm test`
Expected: FAIL — `Cannot find module '../src/photos.js'`

- [ ] **Step 4: Create `worker/src/photos.js`**

```js
const PERMIT_RE = /^[A-Za-z0-9-]{1,16}$/;
const PHOTO_ID_RE = /^p_[0-9a-f]{8}$/;
const MAX_BYTES = 5 * 1024 * 1024;

function resp(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export function makePhotoId() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return "p_" + [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

// Trust the bytes, not the client's header. Only these three types are stored.
export function sniffImageType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

export async function handlePhotos(url, env, request) {
  const m = url.pathname.match(/^\/api\/photo\/([^/]+)(?:\/([^/]+))?$/);
  if (!m) return resp({ error: "not found" }, 404);
  const permit = decodeURIComponent(m[1]);
  const photoId = m[2];
  if (!PERMIT_RE.test(permit)) return resp({ error: "bad permit" }, 400);

  if (request.method === "POST" && !photoId) {
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.length > MAX_BYTES) return resp({ error: "too large" }, 413);
    const type = sniffImageType(buf);
    if (!type) return resp({ error: "unsupported image type" }, 415);
    const id = makePhotoId();
    const key = `photo/${permit}/${id}.webp`;
    await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type } });
    return resp({ id }, 200);
  }

  if (request.method === "GET" && photoId) {
    if (!PHOTO_ID_RE.test(photoId)) return resp({ error: "not found" }, 404);
    const obj = await env.PHOTOS.get(`photo/${permit}/${photoId}.webp`);
    if (!obj) return resp({ error: "not found" }, 404);
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "image/webp");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(obj.body, { status: 200, headers });
  }

  if (request.method === "DELETE" && photoId) {
    if (!PHOTO_ID_RE.test(photoId)) return resp({ error: "bad id" }, 400);
    await env.PHOTOS.delete(`photo/${permit}/${photoId}.webp`);
    return resp({ ok: true }, 200);
  }

  return resp({ error: "method not allowed" }, 405);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd worker && npm test`
Expected: PASS — the photo suite plus everything prior.

- [ ] **Step 6: Register the route**

In `worker/src/index.js`, add the import:

```js
import { handlePhotos } from "./photos.js";
```

Add to `ROUTES`, **before** `/api/permits` order does not matter here since the pattern is distinct — append after the notes route:

```js
  { pattern: /^\/api\/photo\//, handler: handlePhotos },
```

Add to the `endpoints` array:

```js
          "POST /api/photo/:permit ; GET·DELETE /api/photo/:permit/:id",
```

> The existing CORS wrapper in `index.js` copies the handler's response headers and adds CORS, then returns `new Response(response.body, …)`. That preserves the streamed R2 body and its `Content-Type`/`Cache-Control` — do not change it.

- [ ] **Step 7: Commit**

```bash
git add worker/wrangler.toml worker/src/photos.js worker/src/index.js worker/test/photos.test.mjs
git commit -m "feat(worker): R2-backed photo upload, serve, delete

POST /api/photo/:permit stores an image at photo/<permit>/<id>.webp after a
magic-byte sniff (jpeg/png/webp only, header ignored) and a 5MB cap; GET serves
it with a one-year immutable cache header; DELETE removes it. Binds a new R2
bucket PHOTOS in wrangler.toml (bucket created at deploy time)."
```

---

### Task 2: Worker — accept photo refs on a photo post

**Files:**
- Modify: `worker/src/notes.js` (`sanitizePhotoRefs`, wire into the photo POST and PUT)
- Modify: `worker/test/notes.test.mjs`

**Interfaces:**
- Consumes: nothing new
- Produces: `sanitizePhotoRefs(value) -> Array<{id, caption}>` (id matches `/^p_[0-9a-f]{8}$/`, caption ≤ 200, capped at 6)

- [ ] **Step 1: Write the failing tests** — append to `worker/test/notes.test.mjs`:

```js
import { sanitizePhotoRefs } from "../src/notes.js";

test("sanitizePhotoRefs keeps well-formed refs and caps captions", () => {
  const out = sanitizePhotoRefs([{ id: "p_deadbeef", caption: "x".repeat(300) }, { id: "p_00000001", caption: "front" }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].caption.length, 200);
  assert.equal(out[1].id, "p_00000001");
});

test("sanitizePhotoRefs drops refs with a malformed id", () => {
  assert.deepEqual(sanitizePhotoRefs([{ id: "../../etc", caption: "x" }, { id: "p_zz", caption: "y" }]), []);
});

test("sanitizePhotoRefs caps at 6 and tolerates junk", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ id: "p_0000000" + (i % 10), caption: "c" }));
  assert.equal(sanitizePhotoRefs(many).length, 6);
  assert.deepEqual(sanitizePhotoRefs("nope"), []);
  assert.deepEqual(sanitizePhotoRefs(null), []);
});

test("a photo post round-trips its refs", async () => {
  const env = ENV();
  await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "POST", {
    kind: "photo", author: "A", text: "site pics",
    photos: [{ id: "p_00000001", caption: "front" }, { id: "p_00000002", caption: "roof" }],
  }));
  const body = await (await handleNotes(new URL("https://w/api/notes/1"), env, noteReq("1", "GET"))).json();
  assert.equal(body.notes[0].kind, "photo");
  assert.equal(body.notes[0].photos.length, 2);
  assert.equal(body.notes[0].photos[0].caption, "front");
});

test("a photo post with no valid photos and no text is rejected", async () => {
  const res = await handleNotes(new URL("https://w/api/notes/1"), ENV(), noteReq("1", "POST", { kind: "photo", text: "  ", photos: [{ id: "bad" }] }));
  assert.equal(res.status, 400);
});
```

`ENV`, `noteReq` already exist in the file from Phase 3.

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && npm test`
Expected: FAIL — `does not provide an export named 'sanitizePhotoRefs'`

- [ ] **Step 3: Implement in `worker/src/notes.js`**

Add the constant and function beside the others:

```js
const PHOTO_ID_RE = /^p_[0-9a-f]{8}$/;

export function sanitizePhotoRefs(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || !PHOTO_ID_RE.test(String(item.id))) continue;
    out.push({ id: item.id, caption: String(item.caption ?? "").slice(0, 200) });
    if (out.length >= 6) break;
  }
  return out;
}
```

Replace the photo branch of the POST handler (currently `post = { ...base, kind: "photo", text: sanitizeText(body.text), photos: [] };`) with one that keeps validated refs and rejects an empty post:

```js
    else if (body.kind === "photo") {
      const photos = sanitizePhotoRefs(body.photos);
      const text = sanitizeText(body.text);
      if (!photos.length && !text) return resp({ error: "empty" }, 400);
      post = { ...base, kind: "photo", text, photos };
    }
```

In the PUT handler, extend the edit branch so a photo post can have its caption/text edited without losing refs. Change the non-walk edit branch to:

```js
      if (post.kind === "walk") Object.assign(post, sanitizeWalk(body));
      else if (post.kind === "photo") {
        if (body.text !== undefined) post.text = sanitizeText(body.text);
        if (body.photos !== undefined) post.photos = sanitizePhotoRefs(body.photos);
      }
      else { const text = sanitizeText(body.text); if (!text) return resp({ error: "empty" }, 400); post.text = text; }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd worker && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/notes.js worker/test/notes.test.mjs
git commit -m "feat(worker): validated photo refs on a photo post

A photo post now stores up to 6 { id, caption } refs whose ids match the R2
photo-id shape; a post with neither a valid photo nor text is rejected. The
Phase 3 forward-compat stub (photos: []) is replaced."
```

---

### Task 3: Client — the compose pipeline and upload

**Files:**
- Modify: `docs/list.html`, `docs/index.html` (identical): `fitDimensions`, `resizeToWebp`, the compose `<dialog>`, `uploadPhotos`, wiring an "Add photos" button into the Notes section
- Test: `verify-tmp/p4-fit.mjs`

**Interfaces:**
- Consumes: `postNoteText`/`fetchThread`/`pmAnnounce`/`API_BASE` (Phase 3)
- Produces (identical in both): `fitDimensions(w, h, max)`, `resizeToWebp(file, max)`, `openPhotoCompose(permit)`, `uploadOnePhoto(permit, blob)`

- [ ] **Step 1: Write the failing test for the pure scaler**

Create `verify-tmp/p4-fit.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { fitDimensions } from "./p4-fit-impl.mjs";

test("a landscape image scales by its width", () => {
  assert.deepEqual(fitDimensions(3200, 2400, 1600), { w: 1600, h: 1200 });
});

test("a portrait image scales by its height", () => {
  assert.deepEqual(fitDimensions(2400, 3200, 1600), { w: 1200, h: 1600 });
});

test("an image already within bounds is unchanged", () => {
  assert.deepEqual(fitDimensions(1000, 800, 1600), { w: 1000, h: 800 });
});

test("dimensions are rounded to whole pixels", () => {
  const d = fitDimensions(1601, 1000, 1600);
  assert.ok(Number.isInteger(d.w) && Number.isInteger(d.h));
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement the pipeline in `docs/list.html`**

```js
    // ---- Photo compose (Phase 4) ----
    function fitDimensions(w, h, max) {
      const longest = Math.max(w, h);
      if (longest <= max) return { w: Math.round(w), h: Math.round(h) };
      const s = max / longest;
      return { w: Math.round(w * s), h: Math.round(h * s) };
    }

    // Drawing to a canvas discards EXIF (only pixels survive) and lets us
    // re-encode to WebP. This is the EXIF-strip and resize in one step.
    function resizeToWebp(file, max) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const { w, h } = fitDimensions(img.naturalWidth, img.naturalHeight, max);
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(img.src);
          canvas.toBlob(b => b ? resolve(b) : reject(new Error("encode failed")), "image/webp", 0.82);
        };
        img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error("not an image")); };
        img.src = URL.createObjectURL(file);
      });
    }

    async function uploadOnePhoto(permit, blob) {
      const res = await fetch(`${API_BASE}/api/photo/${encodeURIComponent(permit)}`, {
        method: "POST", headers: { "Content-Type": "image/webp" }, body: blob,
      });
      if (!res.ok) throw new Error("upload failed");
      return (await res.json()).id;
    }
```

- [ ] **Step 4: Build the compose dialog**

A native `<dialog id="photo-compose">` opened by `openPhotoCompose(permit)`. It has:
- a `<input type="file" accept="image/jpeg,image/png,image/webp" multiple>` (the `accept` is a hint; the Worker sniff is the real gate),
- a preview list, one row per picked file with a thumbnail and a caption `<input maxlength="200">` (caption doubles as alt text),
- an optional post-level text box,
- a Post button.

On file pick: cap the selection at 6, reject files whose type is not in the allowlist with a visible message, and reject any over 5 MB before resizing. On Post: `resizeToWebp` each, `uploadOnePhoto` each, collect `{id, caption}`, then POST the note `{ kind:"photo", author, text, photos }`, close, `fetchThread(permit)`, and `pmAnnounce("Photos posted.")`. Disable Post and show progress ("Uploading 2 of 3…") during upload.

Add an "Add photos" button to the Notes section's post row (next to "Log walkthrough" and "Post to permit"):

```js
                  <button type="button" onclick="openPhotoCompose('${enc(row.permit_number)}')">Add photos</button>
```

- [ ] **Step 5: CSS**

```css
    #photo-compose { border: 1px solid var(--line-strong); border-radius: 12px; padding: 1rem; background: var(--panel); color: var(--ink); max-width: 520px; width: calc(100vw - 2rem); max-height: calc(100vh - 3rem); overflow-y: auto; box-shadow: 0 12px 30px var(--shadow); }
    #photo-compose::backdrop { background: rgba(6, 14, 26, 0.55); }
    #photo-compose h3 { margin: 0 0 .6rem; font-size: 1.05rem; }
    .pc-file { font: inherit; margin-bottom: .8rem; }
    .pc-list { display: grid; gap: .6rem; }
    .pc-item { display: flex; gap: .6rem; align-items: center; }
    .pc-thumb { width: 64px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid var(--line-strong); flex: none; }
    .pc-item input { font: inherit; font-size: 1rem; flex: 1; min-height: 44px; background: var(--field); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: .4rem .6rem; }
    .pc-msg { color: var(--warning); font-size: .82rem; margin: .4rem 0; }
    .pc-foot { display: flex; justify-content: flex-end; gap: .5rem; margin-top: .8rem; }
```

- [ ] **Step 6: Apply identically to `index.html`; verify byte-identical** (marker-to-marker slice, as in prior phases). Add the `<dialog id="photo-compose">` before `</body>` in both.

- [ ] **Step 7: Extract and run the unit test**

Copy `fitDimensions` into `verify-tmp/p4-fit-impl.mjs` with `export`. Run `node --test "verify-tmp/p4-fit.mjs"` → PASS.

- [ ] **Step 8: Verify in a browser**

`resizeToWebp` needs a real image and canvas, which Playwright provides. Build a tiny PNG data URL in-page, feed a `File` to the compose flow, stub `POST /api/photo/:permit` → `{id:"p_00000001"}` and the note POST. Assert:
1. Picking a 2000px test image and posting uploads a **WebP** blob (assert the request body's first bytes are `RIFF…WEBP`) whose dimensions are ≤1600 (decode the uploaded blob back in-page).
2. The note POST carries `kind:"photo"` and the returned photo id.
3. Picking a GIF (`image/gif`) shows the allowlist message and does not upload.
4. Picking 7 files caps the list at 6.
5. iPhone 13: the compose dialog fits the viewport and the caption inputs are ≥16px.

- [ ] **Step 9: Commit**

```bash
git add docs/index.html
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(overlay): photo compose, resize, EXIF strip, upload

Picked images are drawn to a canvas (which discards EXIF), resized to a 1600px
longest edge and re-encoded to WebP before upload, capped at 6 per post with a
per-photo caption that doubles as alt text. The client rejects non-allowlisted
types and oversize files before touching the network; the Worker sniff is the
real gate."
```

---

### Task 4: Client — the gallery and delete

**Files:**
- Modify: `docs/list.html`, `docs/index.html` (identical): the photo branch of `threadPostHtml`, `deletePhotoPost`
- Test: `verify-tmp/p4-gallery.mjs`

**Interfaces:**
- Consumes: `threadPostHtml` (Phase 3), `currentThreadPermit`, `API_BASE`, `esc`
- Produces: `photoGalleryHtml(post, permit)`, `deletePhotoPost(permit, id)`

- [ ] **Step 1: Write the failing test**

Create `verify-tmp/p4-gallery.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { photoGalleryHtml } from "./p4-gallery-impl.mjs";

test("renders one img per ref with the caption as alt", () => {
  const html = photoGalleryHtml({ photos: [{ id: "p_00000001", caption: "north roof" }, { id: "p_00000002", caption: "" }] }, "101082609");
  assert.equal((html.match(/<img/g) || []).length, 2);
  assert.match(html, /alt="north roof"/);
  assert.match(html, /\/api\/photo\/101082609\/p_00000001/);
});

test("escapes a caption and the permit in the src/alt", () => {
  const html = photoGalleryHtml({ photos: [{ id: "p_00000001", caption: '"><img src=x onerror=1>' }] }, "1");
  assert.ok(!/onerror=1>/.test(html.replace(/&[a-z]+;/g, "")), "caption must be escaped");
});

test("lazy-loads and renders nothing for an empty photo list", () => {
  assert.equal(photoGalleryHtml({ photos: [] }, "1"), "");
  assert.match(photoGalleryHtml({ photos: [{ id: "p_00000001", caption: "x" }] }, "1"), /loading="lazy"/);
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

```js
    function photoGalleryHtml(post, permit) {
      const photos = Array.isArray(post.photos) ? post.photos : [];
      if (!photos.length) return "";
      return `<div class="tp-gallery">${photos.map(ph =>
        `<a class="tp-shot" href="${API_BASE}/api/photo/${encodeURIComponent(permit)}/${encodeURIComponent(ph.id)}" target="_blank" rel="noopener">
          <img loading="lazy" src="${API_BASE}/api/photo/${encodeURIComponent(permit)}/${encodeURIComponent(ph.id)}" alt="${esc(ph.caption || "Site photo")}">
        </a>`).join("")}</div>`;
    }
```

Replace the `📷 photo` marker line in `threadPostHtml`:

```js
      const photo = post.kind === "photo" ? photoGalleryHtml(post, currentThreadPermit) : "";
```

(Keep the caption text `post.text` rendering that already precedes it, so a photo post shows its text and gallery.)

- [ ] **Step 4: Delete**

The existing `deleteNotePost` (Phase 3) removes the note. For a photo post, also delete its R2 objects first so nothing is orphaned — anyone can do this, matching delete-any:

```js
    async function deleteNotePost(permit, id) {
      if (!window.confirm("Delete this public note?")) return;
      try {
        const t = state.threads && state.threads[permit];
        const post = t && t.posts.find(p => p.id === id);
        if (post && post.kind === "photo") {
          for (const ph of (post.photos || [])) {
            await fetch(`${API_BASE}/api/photo/${encodeURIComponent(permit)}/${encodeURIComponent(ph.id)}`, { method: "DELETE" }).catch(() => {});
          }
        }
        await fetch(`${API_BASE}/api/notes/${encodeURIComponent(permit)}/${encodeURIComponent(id)}`, { method: "DELETE" });
        await fetchThread(permit);
        pmAnnounce("Note deleted.");
      } catch { pmAnnounce("Could not delete right now."); }
    }
```

> This replaces the Phase 3 `deleteNotePost`. Confirm the Phase 3 version used `pmAnnounce` (it did after the Task 2 announce fix) so the wording stays consistent.

- [ ] **Step 5: CSS**

```css
    .tp-gallery { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .45rem; }
    .tp-shot { display: block; border-radius: 6px; overflow: hidden; border: 1px solid var(--line-strong); }
    .tp-shot img { display: block; width: 96px; height: 72px; object-fit: cover; }
```

- [ ] **Step 6: Apply identically to `index.html`; verify byte-identical.**

- [ ] **Step 7: Extract and run** `verify-tmp/p4-gallery.mjs` → PASS.

- [ ] **Step 8: Verify in a browser**

Stub `GET /api/notes/:permit` to return a photo post with two refs, and `GET /api/photo/:permit/:id` to return a 1×1 WebP. Assert:
1. The gallery shows two `<img>`, each `loading="lazy"`, with the caption as `alt`.
2. Deleting a photo post issues a DELETE for each photo id **and** the note, then re-fetches.
3. A photo post also shows its text.
4. iPhone 13: the gallery wraps within the overlay width and each thumb is tappable (≥44px in at least one dimension; thumbs are 96×72).

- [ ] **Step 9: Commit**

```bash
git add docs/index.html
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(overlay): photo gallery and delete

A photo post renders its text plus a lazy-loaded thumbnail gallery, each thumb
linking to the full image and captioned as alt text. Deleting a photo post
removes its R2 objects first, then the post, so nothing is orphaned — anyone
can do it, matching the wiki delete-any model."
```

---

### Task 5: Deploy and verify

- [ ] **Step 1: Run every suite**

`cd worker && npm test`, then `node --test "verify-tmp/p4-*.mjs"` and the earlier `verify-tmp` suites, then each Playwright script individually. All pass.

- [ ] **Step 2: Confirm no control characters**

```bash
python -c "import pathlib
for f in ['docs/list.html','docs/index.html','docs/map.html']:
    b=pathlib.Path(f).read_bytes(); print(f, b.count(b'\x08'), b.count(b'\x00'))"
```

Expected: all zeros.

- [ ] **Step 3: Ask the user to create the R2 bucket and deploy**

The bucket must exist before `wrangler deploy`, and the Worker must deploy before the client reaches Pages. Ask them to run:

```
! cd worker && npx wrangler r2 bucket create chi-permits-photos && npx wrangler deploy
```

- [ ] **Step 4: Capture the baseline and smoke-test the round trip**

```bash
curl -s -H "Origin: https://dkaruri.github.io" \
  "https://chi-permits-api.divyam-c-karuri.workers.dev/api/lists/YnF7y4t" \
  | python -c "import json,sys; d=json.load(sys.stdin); print(len(d['permits']), d['focal']['label'])"
```

Expected: `99 5010 N Monticello`.

Upload a tiny valid WebP and confirm it serves, then delete it:

```bash
B="https://chi-permits-api.divyam-c-karuri.workers.dev"; O="Origin: https://dkaruri.github.io"
printf 'RIFF\x00\x00\x00\x00WEBPVP8 ' > /tmp/tiny.webp
ID=$(curl -s -H "$O" -H "Content-Type: image/webp" --data-binary @/tmp/tiny.webp "$B/api/photo/SMOKE-1" | python -c "import json,sys;print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -w "serve: %{http_code} %{content_type}\n" -H "$O" "$B/api/photo/SMOKE-1/$ID"
curl -s -o /dev/null -w "delete: %{http_code}\n" -X DELETE -H "$O" "$B/api/photo/SMOKE-1/$ID"
curl -s -o /dev/null -w "gif rejected: %{http_code}\n" -H "$O" -H "Content-Type: image/webp" --data-binary $'GIF89a\x00\x00' "$B/api/photo/SMOKE-1"
```

Expected: `serve: 200 image/webp`, `delete: 200`, `gif rejected: 415`.

- [ ] **Step 5: Merge, push, report, fold memory**

Merge `--no-ff` to `main`, push, then fold Phase 4 into memory per the standing instruction. This completes all four phases.

---

## Self-Review

**Spec coverage.** §5.4 `photo/<permit>/<id>.webp` in R2 → Task 1. §9.4 up to 6, 1600px resize, EXIF strip, WebP, jpeg/png/webp only, 5 MB, caption as alt, delete-any → Tasks 1 (size/type/serve/delete), 2 (≤6 refs), 3 (resize/EXIF/WebP/caption/allowlist), 4 (gallery alt, delete-any). §10 `POST·DELETE /api/photo/:permit`, `GET /api/photo/:permit/:id` → Task 1. §11 content-type allowlist, size cap, EXIF strip, delete-any control → Tasks 1, 3, 4 (all four named guardrails present). Photo post storage → Task 2. Gallery in the thread → Task 4.

**Placeholder scan:** none — every step carries its code or exact command.

**Type consistency.** `sniffImageType(bytes) -> type|null` matches its test and caller. `makePhotoId` shape `p_[0-9a-f]{8}` is identical in `photos.js`, `notes.js`'s `PHOTO_ID_RE`, and the client. `sanitizePhotoRefs(value) -> [{id, caption}]` is the exact shape `photoGalleryHtml` consumes and the note POST stores. `fitDimensions(w,h,max) -> {w,h}` agrees across test, `resizeToWebp`, and impl. `photoGalleryHtml(post, permit)` takes the permit explicitly and is called with `currentThreadPermit` from `threadPostHtml`.

**Two risks carried in deliberately.** (1) `resizeToWebp` and the gallery cannot be unit-tested in node — Tasks 3 and 4 rely on Playwright with a real canvas and stubbed endpoints, and Step 8 in each asserts the actual bytes (WebP magic) and DOM, not just that a function ran. (2) Deleting a photo post orchestrates R2 deletes from the client before the note delete; if a photo delete fails the note still deletes, leaving an orphaned R2 object — invisible, cleanable, and cheaper than coupling `notes.js` to the R2 binding. Named in the Task 4 commit.
