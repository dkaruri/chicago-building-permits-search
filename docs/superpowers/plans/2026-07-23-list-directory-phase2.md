# List Directory — Phase 2 (List view) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the saved-list view — consolidated icon toolbar, an inferred Use column, a shared visited checkbox, hand-typed custom stops, and the Notes column removed.

**Architecture:** All client work lands in `docs/list.html` except the Worker's tick and custom-stop validation. Custom stops travel in their own `custom` array so the permit-number path keeps its tight regex, and ticks get a dedicated endpoint so a checkbox tap is not a whole-list rewrite.

**Tech Stack:** Vanilla ES2022 in self-contained HTML (no build step), Cloudflare Workers + KV, `node --test`, Playwright.

## Global Constraints

- **Spec:** `superpowers/specs/2026-07-23-list-directory-design.md` §6.2, §6.3, §7, §8. Decisions D6, D11, D12, D13 are binding.
- **Phase 1 is live** (`4137b89`). `state.lists`, `activeList()`, `saveUserLists()`, `showList()`, `renderListHeading()`, `pickList()` and the v2 KV schema all exist — reuse them, do not reimplement.
- **Prefer native `<dialog>`** for any new modal. `map.html` has no `openPermitModal`, and a top-layer dialog is immune to the transformed-ancestor bug that shipped on Jul 22. Both Phase 1 dialogs (`#list-picker`, `#list-details`) follow this.
- **No build step, no new dependencies.**
- **Line endings:** stage with `git -c core.autocrlf=false add docs/list.html`. Staging it normally yields a spurious ~6,200-line diff.
- **Never stage `worker/` WIP** (`.wrangler/`, `node_modules/`, `package-lock.json`).
- **`body.modal-open { animation: none }`** stays. Never add `transform`/`filter`/`will-change`/`contain` to an ancestor of `#permit-modal`.
- **Worker deploy needs the user** (`npx wrangler deploy`, interactive auth). Deploy the Worker BEFORE pushing client changes to Pages, or the new endpoints 404 for live users.
- **Verification:** `python -m http.server 8791 --directory docs`; Playwright at `C:\Users\divya\AppData\Local\ms-playwright\chromium_headless_shell-1228\...\chrome-headless-shell.exe`. Seed `localStorage` with **`page.addInitScript`**, never `evaluate()` after a `goto` — that loses a race with `init()`'s async tail calling `saveUserLists()`. Scope Playwright route stubs by method; `pathname.endsWith("/api/lists")` otherwise swallows `GET /api/lists?q=`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `worker/src/lists.js` | Add `sanitizeCustom`, `sanitizeTicks`, the ticks endpoint | Modify |
| `worker/test/lists.test.mjs` | Worker units | Modify |
| `docs/list.html` | Toolbar, Use column, checkbox, custom stops, Notes removal | Modify |
| `docs/index.html`, `docs/map.html` | `permitUse` only (shared helper) | Modify |

---

### Task 1: Worker — custom stops and ticks

**Files:**
- Modify: `worker/src/lists.js` (add `sanitizeCustom`, `sanitizeTicks`; wire into POST/PUT; add the ticks route)
- Test: `worker/test/lists.test.mjs`

**Interfaces:**
- Consumes: `readList`, `buildListMeta` (Phase 1)
- Produces:
  - `sanitizeCustom(value) -> Array<{id,pos,addr,lat,lon,use,work,gc}>`, capped at 60
  - `sanitizeTicks(value, validKeys) -> Record<string, 1>`
  - `PUT /api/lists/:id/ticks` body `{key, on}` → `{ok:true}`

- [ ] **Step 1: Write the failing tests**

Extend the import to include `sanitizeCustom, sanitizeTicks`. Append:

```js
test("sanitizeCustom keeps well-formed stops and clamps fields", () => {
  const out = sanitizeCustom([{
    id: "c_3f1a", pos: 3, addr: "3701 W Ainslie St", lat: 41.97, lon: -87.72,
    use: "residential", work: "Gut rehab", gc: "606 CONSTRUCTION",
  }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].addr, "3701 W Ainslie St");
  assert.equal(out[0].lat, 41.97);
  assert.equal(out[0].use, "residential");
});

test("sanitizeCustom keeps a stop that failed to geocode, with null coords", () => {
  const out = sanitizeCustom([{ id: "c_1", pos: 1, addr: "Coach house behind 4901 N Kedzie" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].lat, null);
  assert.equal(out[0].lon, null);
});

test("sanitizeCustom drops entries with no usable address", () => {
  assert.deepEqual(sanitizeCustom([{ id: "c_1", addr: "   " }, { id: "c_2" }]), []);
});

test("sanitizeCustom rejects an unusable id rather than trusting it", () => {
  assert.deepEqual(sanitizeCustom([{ id: "../../etc", addr: "x" }]), []);
  assert.deepEqual(sanitizeCustom([{ id: "list:evil", addr: "x" }]), []);
});

test("sanitizeCustom clamps an out-of-range use to unclear", () => {
  assert.equal(sanitizeCustom([{ id: "c_1", addr: "x", use: "spaceship" }])[0].use, "unclear");
});

test("sanitizeCustom caps the array at 60", () => {
  const many = Array.from({ length: 90 }, (_, i) => ({ id: "c_" + i, addr: "A" + i }));
  assert.equal(sanitizeCustom(many).length, 60);
});

test("sanitizeCustom rejects a non-array", () => {
  assert.deepEqual(sanitizeCustom("nope"), []);
  assert.deepEqual(sanitizeCustom(null), []);
});

test("sanitizeTicks keeps only keys present in the list", () => {
  assert.deepEqual(sanitizeTicks({ "101082609": 1, "999": 1 }, new Set(["101082609"])),
    { "101082609": 1 });
});

test("sanitizeTicks stores only truthy ticks, normalised to 1", () => {
  assert.deepEqual(sanitizeTicks({ a: 1, b: 0, c: true, d: false }, new Set(["a", "b", "c", "d"])),
    { a: 1, c: 1 });
});

test("sanitizeTicks tolerates junk", () => {
  assert.deepEqual(sanitizeTicks(null, new Set(["a"])), {});
  assert.deepEqual(sanitizeTicks("nope", new Set(["a"])), {});
});

test("PUT /ticks flips a single key without rewriting permits", async () => {
  const env = ENV();
  const { id } = await (await handleLists(new URL("https://w/api/lists"), env,
    post({ permits: ["100234", "100987"], title: "T" }))).json();

  const url = new URL(`https://w/api/lists/${id}/ticks`);
  const res = await handleLists(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ key: "100234", on: true }) }));
  assert.equal(res.status, 200);

  const fetched = await handleLists(new URL(`https://w/api/lists/${id}`), env, get(id));
  const body = await fetched.json();
  assert.deepEqual(body.ticks, { "100234": 1 });
  assert.deepEqual(body.permits, ["100234", "100987"], "permits must be untouched");
});

test("PUT /ticks can clear a tick", async () => {
  const env = ENV();
  const { id } = await (await handleLists(new URL("https://w/api/lists"), env,
    post({ permits: ["100234"], title: "T" }))).json();
  const url = new URL(`https://w/api/lists/${id}/ticks`);
  await handleLists(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ key: "100234", on: true }) }));
  await handleLists(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ key: "100234", on: false }) }));
  const body = await (await handleLists(new URL(`https://w/api/lists/${id}`), env, get(id))).json();
  assert.deepEqual(body.ticks, {});
});

test("PUT /ticks refuses a key that is not in the list", async () => {
  const env = ENV();
  const { id } = await (await handleLists(new URL("https://w/api/lists"), env,
    post({ permits: ["100234"], title: "T" }))).json();
  const url = new URL(`https://w/api/lists/${id}/ticks`);
  const res = await handleLists(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ key: "999999", on: true }) }));
  assert.equal(res.status, 400);
});

test("PUT /ticks does NOT write a revision", async () => {
  const env = ENV();
  const { id } = await (await handleLists(new URL("https://w/api/lists"), env,
    post({ permits: ["100234"], title: "T" }))).json();
  const url = new URL(`https://w/api/lists/${id}/ticks`);
  await handleLists(url, env, new Request(url, { method: "PUT", body: JSON.stringify({ key: "100234", on: true }) }));
  const revs = [...env.CACHE.map.keys()].filter(k => k.startsWith("listrev:"));
  assert.equal(revs.length, 0, "a checkbox tap is not an edit worth versioning");
});

test("POST round-trips custom stops", async () => {
  const env = ENV();
  const created = await handleLists(new URL("https://w/api/lists"), env, post({
    permits: ["100234"], title: "T",
    custom: [{ id: "c_1", pos: 2, addr: "3701 W Ainslie St", lat: 41.97, lon: -87.72, use: "residential", work: "Gut rehab" }],
  }));
  const { id } = await created.json();
  const body = await (await handleLists(new URL(`https://w/api/lists/${id}`), env, get(id))).json();
  assert.equal(body.custom.length, 1);
  assert.equal(body.custom[0].addr, "3701 W Ainslie St");
  assert.equal(body.meta.count, 2, "custom stops count toward the list size");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && npm test`
Expected: FAIL — `does not provide an export named 'sanitizeCustom'`

- [ ] **Step 3: Implement**

Add to `worker/src/lists.js`, beside the other constants:

```js
const MAX_CUSTOM = 60;
const MAX_ADDR = 120;
const MAX_WORK = 200;
const CUSTOM_ID_RE = /^c_[A-Za-z0-9]{1,14}$/;
const USES = new Set(["residential", "commercial", "mixed", "unclear"]);
```

Add the two functions after `sanitizeFocal`:

```js
// Custom stops carry user-typed text, so they get their own validation rather
// than being squeezed through the permit-number regex.
export function sanitizeCustom(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id ?? "");
    if (!CUSTOM_ID_RE.test(id)) continue;
    const addr = String(item.addr ?? "").trim().slice(0, MAX_ADDR);
    if (!addr) continue;
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    const use = String(item.use ?? "").toLowerCase();
    out.push({
      id,
      pos: Number.isInteger(Number(item.pos)) ? Number(item.pos) : 0,
      addr,
      // A stop that would not geocode is kept, with null coords, and sits out
      // of routing rather than being silently dropped.
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      use: USES.has(use) ? use : "unclear",
      work: String(item.work ?? "").slice(0, MAX_WORK),
      gc: String(item.gc ?? "").slice(0, MAX_ADDR),
    });
    if (out.length >= MAX_CUSTOM) break;
  }
  return out;
}

export function sanitizeTicks(value, validKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (validKeys.has(k) && v) out[k] = 1;
  }
  return out;
}
```

In the POST branch, replace `custom: []` with `custom: sanitizeCustom(body.custom)`.

In the PUT branch, replace `custom: existing.custom` with:

```js
      custom: body.custom === undefined ? existing.custom : sanitizeCustom(body.custom),
```

Add the ticks route to `handleLists`, **before** the generic `PUT && !isCollection` branch (it is more specific and must win):

```js
  const tickMatch = url.pathname.match(/^\/api\/lists\/([A-Za-z0-9]{1,16})\/ticks\/?$/);
  if (request.method === "PUT" && tickMatch) {
    const id = tickMatch[1];
    let body;
    try { body = JSON.parse(await request.text()); } catch { return resp({ error: "bad json" }, 400); }
    const current = await env.CACHE.getWithMetadata("list:" + id);
    const existing = readList(current.value);
    if (!existing) return resp({ error: "not found" }, 404);
    const valid = new Set([...existing.p, ...existing.custom.map(c => c.id)]);
    const key = String(body && body.key || "");
    if (!valid.has(key)) return resp({ error: "unknown key" }, 400);
    const ticks = { ...existing.ticks };
    if (body.on) ticks[key] = 1; else delete ticks[key];
    // Deliberately no revision: a checkbox tap is not an edit worth versioning,
    // and ticking through a 99-stop list would otherwise evict all 20 revisions.
    await env.CACHE.put("list:" + id, JSON.stringify({ ...existing, ticks }),
      { expirationTtl: LIST_TTL, metadata: current.metadata });
    return resp({ ok: true }, 200);
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd worker && npm test`
Expected: PASS — all suites.

- [ ] **Step 5: Confirm the ticks route wins over the generic PUT**

Run:

```bash
cd worker && node -e "
const re = /^\/api\/lists\/([A-Za-z0-9]{1,16})\/ticks\/?\$/;
for (const p of ['/api/lists/YnF7y4t/ticks', '/api/lists/YnF7y4t', '/api/lists']) {
  console.log(p, '-> ticks route:', re.test(p));
}"
```

Expected: `true`, `false`, `false`.

- [ ] **Step 6: Commit**

```bash
git add worker/src/lists.js worker/test/lists.test.mjs
git commit -m "feat(worker): custom stops and shared visited ticks

sanitizeCustom validates user-typed stops separately so the permit-number
regex stays tight. PUT /api/lists/:id/ticks flips one key without rewriting
the list and without writing a revision — ticking through 99 stops would
otherwise evict every stored revision."
```

---

### Task 2: Client — toolbar rework, icons, and KML removal

**Files:**
- Modify: `docs/list.html:25` (Material Symbols link)
- Modify: `docs/list.html:3022-3040` (`.user-list-toolbar`)
- Delete: `downloadUserListKml` (`:5241`), `kmlPlacemarkDescription` (`:5105`), the inline `toKmlColor` and pin palette
- Modify: `optimizeUserListRoute` (`:5490`) to chain into `calculateUserListRoute` (`:5392`)

**Interfaces:**
- Consumes: `openListDetails`, `shareUserList`, `downloadUserListCsv`, `calculateUserListRoute`, `optimizeUserListRoute`
- Produces: `optimizeAndRoute()` — the merged action behind one button

- [ ] **Step 1: Extend the existing icon link**

`docs/list.html:25` already loads Material Symbols. Add the six new names to that **one** query — do not add further `<link>` tags:

```html
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=add_photo_alternate,csv,database_search,edit,list,map_search,moon_stars,photo,policy,route,share,sunny" rel="stylesheet">
```

`add_photo_alternate` and `photo` are included now so Phase 4 needs no further change to this line.

- [ ] **Step 2: Add the icon helper and toolbar CSS**

```js
    // Material Symbols renders by ligature. aria-hidden because every icon in
    // this toolbar sits beside a real text label.
    function icon(name) {
      return `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
    }
```

```css
    .material-symbols-outlined {
      font-variation-settings: "FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24;
      font-size: 20px; line-height: 1;
    }
    .toolbar-primary button { display: inline-flex; align-items: center; gap: .4rem; }
```

- [ ] **Step 3: Replace the toolbar markup**

Replace the `<div class="toolbar-primary">` block (`docs/list.html:3023-3039`) with, in this order — Edit details leftmost, per the design:

```html
          <div class="toolbar-primary">
            <button data-list-action onclick="openListDetails()">
              <span class="material-symbols-outlined" aria-hidden="true">edit</span>
              <span id="list-details-label">Edit details</span>
            </button>
            <button class="primary" data-list-action onclick="optimizeAndRoute()">
              <span class="material-symbols-outlined" aria-hidden="true">route</span>Optimize route
            </button>
            <button data-list-action onclick="shareUserList()">
              <span class="material-symbols-outlined" aria-hidden="true">share</span>Share
            </button>
            <button data-list-action onclick="downloadUserListCsv()">
              <span class="material-symbols-outlined" aria-hidden="true">csv</span>Export CSV
            </button>
            <button data-list-action onclick="openAddAddress()">+ Add address</button>
            <details class="action-menu" data-list-menu>
              <summary aria-haspopup="true">More</summary>
              <div class="action-menu-panel" role="menu" aria-label="More list tools">
                <button role="menuitem" data-list-action onclick="openGoogleMapsRoute()">Open in Google Maps</button>
                <button role="menuitem" data-list-action onclick="showGoogleRouteChunks()">Google route chunks</button>
              </div>
            </details>
          </div>
```

The `#list-details-label` id moves here from the panel head; **delete the old `.list-details-btn` block** added in Phase 1 so the id is not duplicated. Keep the `← All lists` link and `#user-list-title`.

- [ ] **Step 4: Merge sort and route into one action**

```js
    // "Sort by drive time" and "Route" were two buttons that were almost always
    // pressed in sequence. One action: fetch the matrix, optimise the order,
    // then measure the legs. Same two OSRM calls as before.
    async function optimizeAndRoute() {
      await optimizeUserListRoute();
      if (state.userRouteError) return;
      await calculateUserListRoute();
    }
```

Read `optimizeUserListRoute` before editing: if it already ends by calling `calculateUserListRoute`, this wrapper is redundant — call it directly from the button instead and skip the wrapper. Do not double-fetch the matrix.

- [ ] **Step 5: Delete KML**

Remove `downloadUserListKml`, `kmlPlacemarkDescription`, the inline `toKmlColor`, the `pinHref`/palette constants, and any `startPin`/`routeLine` style strings. Confirm nothing references them:

```bash
grep -n "Kml\|kml\|KML" docs/list.html
```

Expected: no matches.

- [ ] **Step 6: Verify in a browser**

Serve `docs/`, stub `/api/lists*`. Assert:
1. Toolbar order is Edit details, Optimize route, Share, Export CSV, + Add address, More.
2. Every toolbar button has a non-empty accessible name (icons are `aria-hidden`, labels are real text).
3. Each button's height ≥44px at an iPhone 13 viewport, and the toolbar does not overflow horizontally.
4. `typeof downloadUserListKml === "undefined"`.
5. `#list-details-label` appears exactly once in the DOM.

- [ ] **Step 7: Commit**

```bash
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(list): consolidated icon toolbar, KML removed

Sort by drive time and Route merge into one Optimize route action. Export goes
straight to CSV. Edit details is leftmost. Icons are appended to the single
existing Material Symbols link rather than added as separate stylesheets, and
each is aria-hidden beside a real text label."
```

---

### Task 3: Client — the Use column

**Files:**
- Modify: `docs/list.html:6562` (`parseBuildingType`), `permitTable` (`:6490`, head `:6501`, row `:6512`)
- Modify: `docs/index.html`, `docs/map.html` (add `permitUse` so the three copies stay identical)
- Test: `verify-tmp/p2-use.mjs`

**Interfaces:**
- Consumes: `parseBuildingType`
- Produces: `permitUse(row) -> { key: "residential"|"commercial"|"mixed"|"unclear", label, glyph }`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert";
import { permitUse } from "./p2-use-impl.mjs";

const u = (permit_type, work_description) => permitUse({ permit_type, work_description }).key;

test("reads residential from a unit count", () => {
  assert.equal(u("PERMIT - RENOVATION/ALTERATION", "INTERIOR RENOVATION TO A TWO STORY MASONRY 4 FLAT"), "residential");
  assert.equal(u("", "6 UNITS RESIDENTIAL"), "residential");
});

test("reads residential from dwelling words", () => {
  assert.equal(u("", "SINGLE FAMILY HOME REAR ADDITION"), "residential");
  assert.equal(u("", "TWO-FLAT PORCH REPLACEMENT"), "residential");
  assert.equal(u("", "CONDOMINIUM UNIT 3B KITCHEN"), "residential");
});

test("reads commercial", () => {
  assert.equal(u("", "INTERIOR BUILD OUT FOR RESTAURANT TENANT"), "commercial");
  assert.equal(u("", "COMMERCIAL OFFICE ALTERATION"), "commercial");
  assert.equal(u("", "NEW RETAIL STOREFRONT"), "commercial");
});

test("reads mixed use", () => {
  assert.equal(u("", "MIXED USE BUILDING - RETAIL BELOW 4 UNITS ABOVE"), "mixed");
});

test("says unclear rather than guessing", () => {
  assert.equal(u("", "REPAIR"), "unclear");
  assert.equal(u("", ""), "unclear");
  assert.equal(u("", null), "unclear");
  assert.equal(u(null, undefined), "unclear");
});

test("wrecking and scaffolding permits do not read as commercial", () => {
  assert.equal(u("PERMIT - WRECKING/DEMOLITION", "WRECKING OF 2 STORY FRAME BUILDING"), "unclear");
});

test("every result carries a label and a glyph, so colour is never the only cue", () => {
  for (const desc of ["4 FLAT", "RESTAURANT", "MIXED USE", "REPAIR"]) {
    const r = permitUse({ permit_type: "", work_description: desc });
    assert.ok(r.label && r.glyph, desc);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test "verify-tmp/p2-use.mjs"` → FAIL, module not found.

- [ ] **Step 3: Implement, identically in all three pages**

```js
    // The permits dataset has NO occupancy field, so this is a heuristic over
    // permit_type + work_description, exactly like parseBuildingType. Every
    // result is rendered with an "approx" badge, and anything the text does not
    // support reads "Unclear" rather than being guessed at.
    function permitUse(row) {
      const s = `${(row && row.permit_type) || ""} ${(row && row.work_description) || ""}`.toUpperCase();
      const RES = /\b(\d{1,3})[- ]?UNITS?\b|\bSINGLE[- ]?FAMILY\b|\b(TWO|THREE|FOUR|SIX)[- ]?FLAT\b|\bFLAT\b|\bTOWN\s?HO(ME|USE)\b|\bCONDO(MINIUM)?\b|\bAPARTMENT|MULTI[- ]?FAMILY\b|\bDWELLING\b|\bRESIDENTIAL\b/;
      const COM = /\bCOMMERCIAL\b|\bRESTAURANT\b|\bRETAIL\b|\bOFFICE\b|\bSTOREFRONT\b|\bTENANT\b|\bWAREHOUSE\b|\bHOTEL\b/;
      const MIX = /\bMIXED[- ]?USE\b/;
      if (MIX.test(s)) return { key: "mixed", label: "Mixed use", glyph: "\u25EB" };
      const res = RES.test(s);
      const com = COM.test(s);
      if (res && com) return { key: "mixed", label: "Mixed use", glyph: "\u25EB" };
      if (res) return { key: "residential", label: "Residential", glyph: "\u25E7" };
      if (com) return { key: "commercial", label: "Commercial", glyph: "\u25A4" };
      return { key: "unclear", label: "Unclear", glyph: "\u2014" };
    }
```

- [ ] **Step 4: Render the column in `permitTable`**

Head — add after the Address column, only on the saved list (`options.move`):

```js
      const useHead = options.move ? "<th>Use</th>" : "";
```

Row:

```js
      const useCell = options.move ? (() => {
        const u = permitUse(row);
        return `<td data-label="Use"><span class="use use-${u.key}">${u.glyph} ${esc(u.label)}</span>${u.key === "unclear" ? "" : `<span class="approx" title="Inferred from the work description">approx</span>`}</td>`;
      })() : "";
```

CSS:

```css
    .use {
      display: inline-flex; align-items: center; gap: .3rem; white-space: nowrap;
      font-size: .78rem; font-weight: 600; padding: .1rem .4rem;
      border-radius: 4px; border: 1px solid currentColor;
    }
    .use-residential { color: var(--t3); }
    .use-commercial  { color: var(--t5); }
    .use-mixed       { color: var(--t7); }
    .use-unclear     { color: var(--muted); font-weight: 500; }
    .approx {
      font-size: .66rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
      color: var(--muted); border: 1px dashed var(--line-strong); border-radius: 3px;
      padding: 0 .2rem; margin-left: .25rem;
    }
```

Colours reuse the Phase 1 tag slots, which are already contrast-checked in both themes.

- [ ] **Step 5: Extract, run the test, verify the three copies match**

Extract `permitUse` to `verify-tmp/p2-use-impl.mjs`, run `node --test "verify-tmp/p2-use.mjs"` (expect PASS), then diff the three copies as in Phase 1 Task 5 Step 7.

- [ ] **Step 6: Sanity-check against real data**

```bash
curl -s -H "Origin: https://dkaruri.github.io" \
  "https://chi-permits-api.divyam-c-karuri.workers.dev/api/permits?limit=40" \
  > /tmp/p2-sample.json
```

Run `permitUse` over those 40 real rows and print a key histogram plus 5 examples per bucket. **Read them.** If more than about half land in `unclear`, the patterns need widening before shipping; if anything is confidently wrong, tighten it. Record the histogram in the commit message.

- [ ] **Step 7: Commit**

```bash
git add docs/index.html docs/map.html
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(list): inferred Use column

Residential / Commercial / Mixed use / Unclear, derived from permit_type and
work_description. The dataset has no occupancy field, so every inferred value
carries an approx badge and unsupported text reads Unclear rather than being
guessed. Each label leads with a glyph so the distinction survives without
colour."
```

---

### Task 4: Client — the shared visited checkbox

**Files:**
- Modify: `docs/list.html` (`permitTable` head and row, `toggleTick`)
- Test: `verify-tmp/p2-ticks.mjs`

**Interfaces:**
- Consumes: `activeList`, `saveUserLists`, `PUT /api/lists/:id/ticks`
- Produces: `toggleTick(key, on)`, `queueTickSync(sharedId, key, on)`

- [ ] **Step 1: Write the failing test for the debounce/coalesce logic**

```js
import { test } from "node:test";
import assert from "node:assert";
import { coalesceTicks } from "./p2-ticks-impl.mjs";

test("the last write for a key wins", () => {
  assert.deepEqual(coalesceTicks([["a", true], ["a", false], ["a", true]]), [["a", true]]);
});

test("distinct keys are all kept, in first-seen order", () => {
  assert.deepEqual(coalesceTicks([["a", true], ["b", false], ["a", false]]),
    [["a", false], ["b", false]]);
});

test("an empty queue coalesces to nothing", () => {
  assert.deepEqual(coalesceTicks([]), []);
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

```js
    // Ticking rapidly down a list would otherwise fire one PUT per tap. Queue
    // them, keep only the last state per key, and flush once.
    function coalesceTicks(queue) {
      const seen = new Map();
      for (const [key, on] of queue) seen.set(key, on);
      return [...seen.entries()].map(([key, on]) => [key, on]);
    }

    let tickQueue = [];
    let tickTimer = null;

    function queueTickSync() {
      const list = activeList();
      if (!list || !list.sharedId) { tickQueue = []; return; }
      clearTimeout(tickTimer);
      tickTimer = setTimeout(async () => {
        const batch = coalesceTicks(tickQueue);
        tickQueue = [];
        for (const [key, on] of batch) {
          try {
            await fetch(`${API_BASE}/api/lists/${encodeURIComponent(list.sharedId)}/ticks`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key, on }),
            });
          } catch {
            // Offline or Worker unreachable. The tick is already stored locally
            // and will resync the next time this list is opened and saved.
          }
        }
      }, 800);
    }

    function toggleTick(key, on) {
      const list = activeList();
      if (!list) return;
      list.ticks = list.ticks || {};
      if (on) list.ticks[key] = 1; else delete list.ticks[key];
      saveUserLists();
      const row = document.querySelector(`tr[data-tick-row="${CSS.escape(key)}"]`);
      if (row) row.classList.toggle("is-done", !!on);
      tickQueue.push([key, !!on]);
      queueTickSync();
    }
```

- [ ] **Step 4: Render the column**

Head, first column on the saved list only:

```js
      const tickHead = options.move
        ? `<th class="tick-cell"><span aria-hidden="true">\u2713</span><span class="sr-only">Visited</span></th>`
        : "";
```

Row, first cell:

```js
      const key = clean(row.permit_number) || row.custom_id;
      const on = !!(activeList() && activeList().ticks && activeList().ticks[key]);
      const tickCell = options.move
        ? `<td class="tick-cell" data-label="Visited"><input type="checkbox" class="tick" ${on ? "checked" : ""} aria-label="Mark ${esc(row.address || row.permit_number)} visited" onclick="event.stopPropagation()" onchange="toggleTick('${enc(key)}', this.checked)"></td>`
        : "";
```

Add `data-tick-row="${esc(key)}"` and `${on ? " is-done" : ""}` to the `<tr>`.

CSS — the state must not be carried by colour alone:

```css
    .tick { width: 22px; height: 22px; accent-color: var(--accent); cursor: pointer; margin: .5rem; }
    tbody tr.is-done td:not(.tick-cell) { opacity: .62; }
    tbody tr.is-done td[data-label="Address"] strong,
    tbody tr.is-done .address-open { text-decoration: line-through; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
```

- [ ] **Step 5: Load ticks when a shared list is opened**

In `openSharedList` and `applySharedList`, carry `data.ticks` onto the local list:

```js
        ticks: data.ticks || {},
```

- [ ] **Step 6: Verify in a browser**

1. Tick a box → `state.lists[..].ticks` updates and persists to `localStorage`.
2. The row gains `is-done`, and the address is struck through (`getComputedStyle(...).textDecorationLine` contains `line-through`).
3. Each checkbox has a non-empty accessible name.
4. On a list with a `sharedId`, ticking 5 boxes fast issues **at most 5** PUTs after the debounce, and ticking the same box 3 times issues exactly 1. Count via `page.route`.
5. On a draft list (no `sharedId`), no PUT is issued at all.
6. At an iPhone 13 viewport, each checkbox's tap target is ≥44px including margin.

- [ ] **Step 7: Commit**

```bash
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(list): shared visited checkbox

Stored in ticks on the shared list so a team sees the same state through one
link. Writes are coalesced per key and debounced 800ms, so ticking down a list
does not fire a PUT per tap. Ticked rows dim and strike their address, so the
state is not carried by colour alone."
```

---

### Task 5: Client — custom hand-typed stops

**Files:**
- Modify: `docs/list.html` (add-address dialog, `userListRows`, `downloadUserListCsv`, route builders)
- Test: `verify-tmp/p2-custom.mjs`

**Interfaces:**
- Consumes: `geocodeAddress` (existing focal-point geocoder), `activeList`, `saveUserLists`
- Produces: `openAddAddress()`, `addCustomStop(fields)`, `customToRow(custom)`, `mergeCustomStops(permitRows, custom)`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert";
import { mergeCustomStops, customToRow } from "./p2-custom-impl.mjs";

const P = n => ({ permit_number: n, address: "P" + n });

test("a custom stop lands at its requested position", () => {
  const out = mergeCustomStops([P("1"), P("2"), P("3")], [{ id: "c_1", pos: 2, addr: "Custom" }]);
  assert.deepEqual(out.map(r => r.address), ["P1", "Custom", "P2", "P3"]);
});

test("position 1 puts it first", () => {
  const out = mergeCustomStops([P("1"), P("2")], [{ id: "c_1", pos: 1, addr: "Custom" }]);
  assert.equal(out[0].address, "Custom");
});

test("a position past the end appends", () => {
  const out = mergeCustomStops([P("1")], [{ id: "c_1", pos: 99, addr: "Custom" }]);
  assert.equal(out[out.length - 1].address, "Custom");
});

test("several custom stops keep their relative order", () => {
  const out = mergeCustomStops([P("1"), P("2")], [
    { id: "c_1", pos: 1, addr: "A" }, { id: "c_2", pos: 2, addr: "B" },
  ]);
  assert.deepEqual(out.map(r => r.address), ["A", "B", "P1", "P2"]);
});

test("no custom stops leaves the list untouched", () => {
  const rows = [P("1"), P("2")];
  assert.deepEqual(mergeCustomStops(rows, []).map(r => r.address), ["P1", "P2"]);
});

test("customToRow marks the row and never invents a permit number", () => {
  const r = customToRow({ id: "c_1", addr: "3701 W Ainslie St", lat: 41.97, lon: -87.72, use: "residential", work: "Gut rehab" });
  assert.equal(r.permit_number, "");
  assert.equal(r.custom_id, "c_1");
  assert.equal(r.is_custom, true);
  assert.equal(r.latitude, 41.97);
});

test("customToRow flags a stop with no coordinates as unroutable", () => {
  const r = customToRow({ id: "c_1", addr: "Coach house", lat: null, lon: null });
  assert.equal(r.no_geo, true);
  assert.equal(r.latitude, null);
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

```js
    function customToRow(c) {
      const hasGeo = Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon));
      return {
        // Never fabricate a permit number — an empty string is honest, a
        // placeholder could be mistaken for real city data.
        permit_number: "",
        custom_id: c.id,
        is_custom: true,
        no_geo: !hasGeo,
        address: c.addr,
        work_description: c.work || "",
        work_type: c.work || "",
        permit_type: "",
        permit_status: "",
        issue_date: "",
        general_contractors: c.gc || "",
        latitude: hasGeo ? Number(c.lat) : null,
        longitude: hasGeo ? Number(c.lon) : null,
        _use: c.use || "unclear",
      };
    }

    function mergeCustomStops(permitRows, custom) {
      const out = [...permitRows];
      const sorted = [...(custom || [])].sort((a, b) => (a.pos || 0) - (b.pos || 0));
      sorted.forEach(c => {
        const at = Math.max(0, Math.min(out.length, (Number(c.pos) || out.length + 1) - 1));
        out.splice(at, 0, customToRow(c));
      });
      return out;
    }
```

Wire `mergeCustomStops` into `userListRows()` so every consumer — the table, exports, and routing — sees custom stops.

- [ ] **Step 4: Add the dialog**

A native `<dialog id="add-address">` with: Address (required), Position (number, defaults to end), Use (select), Work description, GC (optional). On submit:

1. Search permits for the address first. If one matches, offer it instead of a hand-typed stub.
2. Otherwise geocode with the existing Nominatim helper. Success → store `lat`/`lon`.
3. Geocode failure → store the stop anyway with `lat: null, lon: null` and show "Added, but it could not be placed on the map — it will sit out of drive-time sorting."

Render `✎ Added by hand` on geocoded custom rows and `⚠ No location` on ungeocoded ones.

- [ ] **Step 5: Keep ungeocoded stops out of routing, visibly**

In the drive-time path, filter `no_geo` rows out of the coordinate list before building the OSRM matrix, then append to the route summary: `N stop(s) without a location were left out of the route.` Never silently drop them.

- [ ] **Step 6: Add the CSV source column**

In `downloadUserListCsv`, add a `source` column reading `permit` or `manual`. Custom rows leave every permit-specific field empty.

- [ ] **Step 7: Verify in a browser**

1. Adding an address that geocodes inserts at the chosen position and shows `Added by hand`.
2. Adding one that fails to geocode still inserts, shows `No location`, and the route summary names how many were excluded.
3. CSV contains the `source` column and the custom row has an empty permit number.
4. `Optimize route` succeeds with a mix of geocoded and ungeocoded stops.
5. At an iPhone 13 viewport, the dialog fits the viewport and inputs are ≥16px.

- [ ] **Step 8: Commit**

```bash
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(list): hand-typed custom stops

An address the city data lacks can be added at a chosen position. It routes,
exports and links like any other stop, badged Added by hand. One that will not
geocode is still kept at its position, badged No location, excluded from the
duration matrix, and counted in the route summary rather than silently dropped.
CSV gains a source column; custom rows never carry a fabricated permit number."
```

---

### Task 6: Client — remove the Notes column

**Files:**
- Modify: `docs/list.html:6494` (`notesHead`), `:6519` (the note `<td>`), `.permit-note` CSS at `:1766`, `:1942`, `:2779`

**Interfaces:**
- Consumes: nothing new. `savePermitNote` and `state.userPermitNotes` stay exactly as they are.

- [ ] **Step 1: Confirm the overlay note is the only remaining editor**

```bash
grep -n "permit-note\|pm-note\|savePermitNote" docs/list.html
```

Record which are the table textarea (to delete) and which are the overlay textarea (to keep).

- [ ] **Step 2: Replace the Notes column with a note count**

Head:

```js
      const notesHead = options.notes ? "<th class=\"note-count-cell\">Notes</th>" : "";
```

Cell — the count comes from the local private note for now; the public thread count arrives in Phase 3:

```js
      const noteText = state.userPermitNotes[clean(row.permit_number)] || "";
      const notesCell = options.notes
        ? `<td class="note-count-cell" data-label="Notes">${noteText ? `<span class="notecount" title="You have a private note on this permit">\u270E 1</span>` : `<span class="notecount zero">0</span>`}</td>`
        : "";
```

Delete the `<textarea class="permit-note">` cell and all three `.permit-note` CSS blocks.

- [ ] **Step 3: Verify**

1. No `<textarea class="permit-note">` in the DOM at any viewport.
2. Opening the detail overlay still shows the note, and typing still persists to `chi_permit_user_notes` — the guarantee that nothing was lost.
3. A permit with a note shows `✎ 1`; one without shows `0`.
4. Escape closes the overlay and the note survives a reload.

- [ ] **Step 4: Commit**

```bash
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(list): remove the Notes column

Notes are edited only in the permit detail overlay now, on desktop as well as
mobile — one note surface instead of two to keep in sync. The column becomes a
count. chi_permit_user_notes and savePermitNote are untouched, so nothing a
user has written is lost."
```

---

### Task 7: Deploy and verify

- [ ] **Step 1: Run every suite**

`cd worker && npm test`, then `node --test "verify-tmp/p2-*.mjs"`, then every Playwright script. All must pass.

- [ ] **Step 2: Capture the baseline**

```bash
curl -s -H "Origin: https://dkaruri.github.io" \
  "https://chi-permits-api.divyam-c-karuri.workers.dev/api/lists/YnF7y4t" \
  | python -c "import json,sys; d=json.load(sys.stdin); print(len(d['permits']), d['focal']['label'], d.get('custom'), d.get('ticks'))"
```

Expected: `99 5010 N Monticello [] {}`

- [ ] **Step 3: Ask the user to deploy the Worker**

The new `/ticks` endpoint must exist before the client reaches Pages, or every checkbox tap 404s. Ask them to run:

```
! cd worker && npx wrangler deploy
```

- [ ] **Step 4: Verify live**

Re-run Step 2's command — the 99 permits and focal must be unchanged. Then confirm the ticks route rejects an unknown key with 400 rather than 404:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PUT \
  -H "Origin: https://dkaruri.github.io" -H "Content-Type: application/json" \
  -d '{"key":"nope","on":true}' \
  "https://chi-permits-api.divyam-c-karuri.workers.dev/api/lists/YnF7y4t/ticks"
```

Expected: `400`. A `404` means the route did not register; a `405` means it fell through to the generic PUT.

- [ ] **Step 5: Merge, push, report**

Merge `--no-ff`, push `main`, then fold into memory per the standing instruction.

**Stop here.** Do not begin Phase 3 without explicit confirmation.

---

## Self-Review

**Spec coverage.** §6.2 toolbar consolidation → Task 2. §6.2 KML removal → Task 2 Step 5. §6.3 columns + Notes removal → Tasks 3, 4, 6. §6.4 icons on the single existing link → Task 2 Step 1. §7 custom stops incl. all three geocode outcomes, CSV `source`, and separate validation → Tasks 1, 5. §8 shared ticks with debounce → Tasks 1, 4. §13 iPhone-13 geometry → Tasks 2, 4, 5. §14 CRLF staging → every `list.html` commit.

**Deferred, not gaps:** the public note thread and its counts are Phase 3, so Task 6's count reflects the private note only; photos are Phase 4.

**Type consistency.** `permitUse` returns `{key,label,glyph}` in the test, the implementation and the table cell. `customToRow` returns `is_custom`/`no_geo`/`custom_id`, consumed by `mergeCustomStops`, the table and the routing filter. `coalesceTicks` takes and returns `Array<[string, boolean]>` at both ends. `sanitizeTicks(value, validKeys)` takes a `Set` in both the test and the caller.

**Two risks carried in deliberately.** Task 3's heuristic is unverifiable by unit test alone — Step 6 exists to force reading real output before shipping, and the histogram goes in the commit message. Task 1's ticks endpoint skips revisions on purpose: ticking through 99 stops would otherwise evict all 20 stored revisions, which is a worse failure than an unversioned checkbox.
