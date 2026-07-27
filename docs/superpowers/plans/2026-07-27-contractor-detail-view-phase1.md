# Contractor Detail View — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping a General Contractor or Open Sub inside the permit detail overlay opens a full contractor card in that same overlay, tapping a permit inside that card opens the permit's card, and the user can move back and forward through the resulting stack — identically on `docs/index.html` and `docs/list.html`, desktop and mobile.

**Architecture:** A typed card-stack (`state.cardStack` of descriptors, `state.cardIndex`) replaces the single-shot `openPermitModal` body swap. `renderCard()` dispatches on descriptor `type` to the existing `permitDetailHtml(row)` or a new `contactDetailHtml(desc)`, then runs that type's `onOpen` hooks. Contractor data is fetched per card from the Worker API (`/api/contact` for aggregates, `/api/permits` for the live permit list) and cached on the descriptor. One `history.pushState` per card push, so the phone's back gesture steps the stack and closes only at the bottom.

**Tech Stack:** Vanilla ES2020 in two self-contained static HTML pages. No build step, no framework, no new dependencies. Tests: `node:test` for extracted pure functions, Playwright (cached headless-shell) for browser behaviour.

**Spec:** `superpowers/specs/2026-07-27-contractor-detail-view-design.md`

## Global Constraints

- **Phase 1 is client-only.** No changes under `worker/`. The Worker matching ladder, `matched_as`, and `seeded_at` are Phase 2 — do not implement them here, and do not read those fields.
- **The overlay block must stay byte-identical between `docs/index.html` and `docs/list.html`.** Every task edits both files with the same text and verifies with a byte-diff before committing.
- **Never edit `docs/*.html` with a bash heredoc.** Use the Edit tool, or a Python script that asserts `count(b"\x08")==0 and count(b"\x00")==0` before writing. Match literal `\uXXXX` source text with a RAW Python string; write astral emoji as `\U0001F4AC`, never the literal character.
- **Stage `docs/list.html` with `git -c core.autocrlf=false add`** — its blob is CRLF while `index.html` is LF.
- Accessibility floors, from the spec, apply to every task: ≥44×44px touch targets with ≥8px spacing, ≥16px font on inputs, visible labels, 4.5:1 contrast in **both** themes, no meaning by colour alone, `prefers-reduced-motion` respected, heading levels sequential (`h3` inside the overlay, never `h4`).
- Animation: push 240ms `permitRise`, back 160ms `permitFall`, both gated behind `@media (prefers-reduced-motion: no-preference)`, both interruptible.
- Local preview server for all browser tests: `python -m http.server 8791 --directory docs`
- Playwright executable path: `C:\Users\divya\AppData\Local\ms-playwright\chromium_headless_shell-1228\chrome-headless-shell-win64\chrome-headless-shell.exe`
- Work on a branch: `git checkout -b contractor-detail-phase1`. Do not push to `main` until the whole phase is verified.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `docs/index.html` | Search Directory page | Modify — card stack, contractor card, CSS |
| `docs/list.html` | My Permit List page | Modify — identical shared block |
| `verify-tmp/p5-stack-impl.mjs` | Extracted pure stack + filter functions | Create |
| `verify-tmp/p5-stack.mjs` | `node:test` suite for the above | Create |
| `verify-tmp/p5-card-impl.mjs` | Extracted contractor-card HTML builders | Create |
| `verify-tmp/p5-card.mjs` | `node:test` suite for the above | Create |
| `verify-tmp/t17.js` | Playwright: stack navigation depth 3, both pages | Create |
| `verify-tmp/t18.js` | Playwright: a11y + geometry at 390px and desktop, both themes | Create |
| `verify-tmp/_bytediff.py` | Asserts the shared overlay block matches across both files | Create |

`verify-tmp/` is gitignored — these files are verification scaffolding, not shipped code.

---

### Task 1: Card stack core

Pure stack transitions, extracted and unit-tested first, then wired into the existing modal machinery.

**Files:**
- Create: `verify-tmp/p5-stack-impl.mjs`
- Create: `verify-tmp/p5-stack.mjs`
- Modify: `docs/index.html:5526-5566` (modal state vars, `openPermitModal`, `closePermitModal`, `popstate`)
- Modify: `docs/list.html:3685-3725` (same block, identical text)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `stackPush(stack, index, desc) -> {stack, index}`, `stackGo(stack, index, delta) -> {stack, index}`, and the globals `state.cardStack`, `state.cardIndex`, `pushCard(desc)`, `popCard()`, `forwardCard()`, `renderCard(direction)`. Task 2 supplies `contactDetailHtml`; Task 4 calls `pushCard`.

- [ ] **Step 1: Write the failing test**

Create `verify-tmp/p5-stack-impl.mjs` with only the imports the test needs — leave the functions unimplemented so the test genuinely fails:

```js
// AUTO-EXTRACTED from docs/index.html (card stack core).
export function stackPush() { throw new Error("not implemented"); }
export function stackGo() { throw new Error("not implemented"); }
```

Create `verify-tmp/p5-stack.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { stackPush, stackGo } from "./p5-stack-impl.mjs";

const permit = n => ({ type: "permit", row: { permit_number: n } });
const contact = n => ({ type: "contact", name: n, role: "general_contractor" });

test("stackPush appends and advances the index", () => {
  const a = stackPush([], -1, permit("100"));
  assert.equal(a.stack.length, 1);
  assert.equal(a.index, 0);
  const b = stackPush(a.stack, a.index, contact("ACME"));
  assert.equal(b.stack.length, 2);
  assert.equal(b.index, 1);
});

test("stackPush truncates forward entries", () => {
  let s = stackPush([], -1, permit("100"));
  s = stackPush(s.stack, s.index, contact("ACME"));
  s = stackPush(s.stack, s.index, permit("200"));
  const back = stackGo(s.stack, s.index, -2);
  assert.equal(back.index, 0);
  const pushed = stackPush(back.stack, back.index, contact("OTHER"));
  assert.equal(pushed.stack.length, 2, "forward entries dropped");
  assert.equal(pushed.stack[1].name, "OTHER");
  assert.equal(pushed.index, 1);
});

test("stackPush does not mutate the input stack", () => {
  const original = [permit("100")];
  stackPush(original, 0, contact("ACME"));
  assert.equal(original.length, 1);
});

test("stackGo clamps at both ends", () => {
  const stack = [permit("100"), contact("ACME"), permit("200")];
  assert.equal(stackGo(stack, 2, -5).index, 0);
  assert.equal(stackGo(stack, 0, 5).index, 2);
  assert.equal(stackGo(stack, 1, -1).index, 0);
  assert.equal(stackGo(stack, 1, 1).index, 2);
});

test("stackGo never returns a different stack array", () => {
  const stack = [permit("100"), contact("ACME")];
  assert.strictEqual(stackGo(stack, 1, -1).stack, stack);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test verify-tmp/p5-stack.mjs`
Expected: FAIL — every test errors with `not implemented`.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `verify-tmp/p5-stack-impl.mjs`:

```js
// AUTO-EXTRACTED from docs/index.html (card stack core).
export function stackPush(stack, index, desc) {
  return { stack: [...stack.slice(0, index + 1), desc], index: index + 1 };
}

export function stackGo(stack, index, delta) {
  const next = Math.min(Math.max(index + delta, 0), stack.length - 1);
  return { stack, index: next };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test verify-tmp/p5-stack.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the stack to page state**

In **both** `docs/index.html` and `docs/list.html`, find the `state` object literal (index.html around line 3150, list.html around line 3160 — the one containing `detailPageSize: 25,`) and add two keys immediately after `detailPageSize: 25,`:

```js
      cardStack: [],
      cardIndex: -1,
```

- [ ] **Step 6: Replace the modal machinery**

In **both** files, replace the block from `let _permitModalPrevFocus = null;` through the closing `});` of the `popstate` listener (index.html:5526-5566, list.html:3685-3725) with this text, identical in both:

```js
    let _permitModalPrevFocus = null;
    let _permitModalScrollY = 0;
    // How many history entries the open overlay owns — one per card pushed.
    let _permitModalDepth = 0;
    // Set while closePermitModal unwinds its own entries, so the popstate
    // handler ignores the events history.go(-n) is about to fire.
    let _permitModalClosing = false;

    // Card-stack transitions. Pure; mirrored in verify-tmp/p5-stack-impl.mjs.
    function stackPush(stack, index, desc) {
      return { stack: [...stack.slice(0, index + 1), desc], index: index + 1 };
    }

    function stackGo(stack, index, delta) {
      const next = Math.min(Math.max(index + delta, 0), stack.length - 1);
      return { stack, index: next };
    }

    function activeCard() {
      return state.cardStack[state.cardIndex] || null;
    }

    // Push a new card onto the stack and show it. Opens the overlay if closed.
    function pushCard(desc) {
      const next = stackPush(state.cardStack, state.cardIndex, desc);
      state.cardStack = next.stack;
      state.cardIndex = next.index;
      openPermitModal();
      history.pushState({ permitModal: true, card: state.cardIndex }, "");
      _permitModalDepth += 1;
      renderCard("forward");
    }

    function popCard() {
      if (state.cardIndex <= 0) { closePermitModal(); return; }
      const next = stackGo(state.cardStack, state.cardIndex, -1);
      state.cardIndex = next.index;
      renderCard("back");
    }

    function forwardCard() {
      if (state.cardIndex >= state.cardStack.length - 1) return;
      const next = stackGo(state.cardStack, state.cardIndex, 1);
      state.cardIndex = next.index;
      renderCard("forward");
    }

    // Show the overlay shell. The body is filled by renderCard.
    function openPermitModal() {
      const modal = $("permit-modal");
      if (!modal.hidden) return;
      _permitModalPrevFocus = document.activeElement;
      _permitModalScrollY = window.scrollY;
      modal.hidden = false;
      document.body.classList.add("modal-open");
    }

    function closePermitModal(fromPopState = false) {
      const modal = $("permit-modal");
      if (modal.hidden) return;
      const depth = _permitModalDepth;
      modal.hidden = true;
      $("permit-modal-body").innerHTML = "";
      document.body.classList.remove("modal-open");
      state.cardStack = [];
      state.cardIndex = -1;
      _permitModalDepth = 0;
      window.scrollTo(0, _permitModalScrollY);
      if (_permitModalPrevFocus && _permitModalPrevFocus.focus) _permitModalPrevFocus.focus();
      // Drop the history entries this overlay owns. One popstate already fired
      // when the user pressed Back, so unwind one fewer in that case.
      const unwind = fromPopState ? depth - 1 : depth;
      if (unwind > 0) {
        _permitModalClosing = true;
        history.go(-unwind);
        setTimeout(() => { _permitModalClosing = false; }, 0);
      }
    }

    window.addEventListener("popstate", () => {
      if (_permitModalClosing) return;
      if ($("permit-modal").hidden) return;
      _permitModalDepth = Math.max(0, _permitModalDepth - 1);
      if (state.cardIndex > 0) popCard();
      else closePermitModal(true);
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !$("permit-modal").hidden) closePermitModal();
      if (e.key === "Tab" && !$("permit-modal").hidden) trapPermitModalFocus(e);
    });
```

- [ ] **Step 7: Add renderCard**

In **both** files, immediately after the `keydown` listener added in Step 6, insert:

```js
    // Render the active card into the overlay body and run its onOpen hooks.
    // direction is "forward" or "back" and only drives the animation.
    function renderCard(direction = "forward") {
      const desc = activeCard();
      if (!desc) return;
      const body = $("permit-modal-body");
      body.innerHTML = desc.type === "permit"
        ? permitDetailHtml(desc.row)
        : contactDetailHtml(desc);
      if (desc.type === "permit") {
        fillPermitContractors(body);
        fillPermitGeo(body, desc.row);
        const pn = clean(desc.row.permit_number);
        if (pn) fetchThread(pn);
      } else {
        fillContactCard(body, desc);
      }
    }
```

`contactDetailHtml` and `fillContactCard` land in Task 2. Until then `renderCard` only handles permits — that is expected and the permit path must keep working.

- [ ] **Step 8: Repoint openPermitDetail at the stack**

In `docs/index.html:6245-6252` and `docs/list.html:7507` (the `openPermitDetail` / `openPermitDetailFromEncoded` pair), replace `openPermitDetail` with:

```js
    // Public entry point for opening a permit's detail overlay. Starts a fresh
    // stack when the overlay is closed; pushes a card when it is already open.
    function openPermitDetail(row) {
      pushCard({ type: "permit", row });
    }
```

Leave `openPermitDetailFromEncoded` and `showPermitDetail` unchanged — they delegate to `openPermitDetail`.

Then delete the now-dead `state.activeDetail = { type: "permit", row };` assignment that was the first line of the old `openPermitDetail`, and add this alias immediately after `activeCard()` in the block from Step 6, so existing readers of `state.activeDetail` keep working:

```js
    // Back-compat alias: several call sites still read state.activeDetail.
    Object.defineProperty(state, "activeDetail", {
      get() { return state.cardStack[state.cardIndex] || null; },
      set(v) { if (v) { state.cardStack = [v]; state.cardIndex = 0; } },
      configurable: true,
    });
```

Place the `Object.defineProperty` call at the same indentation, immediately after the `function activeCard() { ... }` definition.

- [ ] **Step 9: Verify the shared block is byte-identical**

Create `verify-tmp/_bytediff.py`:

```python
"""Assert the shared overlay block is byte-identical in index.html and list.html.

Usage: python verify-tmp/_bytediff.py "<start marker>" "<end marker>"
Compares the slice between the two markers (inclusive of start, exclusive of
end) in both files and exits non-zero on any difference.
"""
import sys, pathlib

start, end = sys.argv[1], sys.argv[2]
slices = {}
for name in ("index.html", "list.html"):
    text = pathlib.Path("docs", name).read_text(encoding="utf-8")
    i = text.index(start)
    j = text.index(end, i)
    body = text[i:j].replace("\r\n", "\n")
    slices[name] = body
    print(f"{name}: {len(body)} bytes")

if slices["index.html"] == slices["list.html"]:
    print("MATCH")
else:
    print("DIFFER")
    a, b = slices["index.html"], slices["list.html"]
    for k in range(min(len(a), len(b))):
        if a[k] != b[k]:
            print(f"first difference at offset {k}: {a[k-60:k+60]!r} vs {b[k-60:k+60]!r}")
            break
    sys.exit(1)
```

Run: `python verify-tmp/_bytediff.py "let _permitModalPrevFocus" "function trapPermitModalFocus"`
Expected: two byte counts and `MATCH`.

Note: do **not** widen the end marker to `const geoZoneCache` — the region beyond `trapPermitModalFocus` contains pre-existing, unrelated ordering drift between the two files (`detailBack` sits in a different place in each), so a wider range reports DIFFER for reasons this phase did not cause and must not "fix".

- [ ] **Step 10: Write the browser test for stack navigation**

Create `verify-tmp/t17.js`:

```js
// t17: card-stack navigation in the permit overlay, on BOTH pages.
//  1) push 3 cards -> body shows the third; back steps to the second, then first
//  2) back at depth 0 closes the overlay
//  3) forward re-enters a card that was stepped back from
// Contractor cards are stubbed at the API layer so this test covers navigation
// only, not the contractor fetch (see t18 for the rendered card).
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const PAGES = ["http://127.0.0.1:8791/index.html", "http://127.0.0.1:8791/list.html"];

const ROW = { permit_number: "100923847", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", address: "4 N AVE", work_type: "RENOVATION", work_description: "Interior work", reported_cost: 120000, total_fee: 900, general_contractors: "ACME BUILDERS", open_subs: "", latitude: 41.9, longitude: -87.7 };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const results = [];
  for (const url of PAGES) {
    const p = await browser.newPage();
    await p.route("**/api/contact/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ contact_name: "ACME BUILDERS", open_jobs: 12, total_jobs: 88, avg_processing_days: 9.4, reported_cost_total: 4200000, license_matches: [], work_types: [], permit_types: [], contact_types: [] }) }));
    await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [ROW], row_count: 1 }) }));
    await p.route("**/api/notes/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [] }) }));
    await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
    await p.goto(url, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => typeof pushCard === "function");

    await p.evaluate(row => openPermitDetail(row), ROW);
    await p.evaluate(() => pushCard({ type: "contact", name: "ACME BUILDERS", role: "general_contractor" }));
    await p.evaluate(row => pushCard({ type: "permit", row }), { ...ROW, permit_number: "100923901" });
    const depth3 = await p.evaluate(() => ({ len: state.cardStack.length, i: state.cardIndex, title: document.getElementById("permit-modal-title").textContent }));

    await p.goBack(); await p.waitForTimeout(120);
    const afterBack1 = await p.evaluate(() => ({ i: state.cardIndex, title: document.getElementById("permit-modal-title").textContent }));
    await p.goBack(); await p.waitForTimeout(120);
    const afterBack2 = await p.evaluate(() => ({ i: state.cardIndex, title: document.getElementById("permit-modal-title").textContent }));
    await p.goBack(); await p.waitForTimeout(150);
    const afterBack3 = await p.evaluate(() => ({ hidden: document.getElementById("permit-modal").hidden, len: state.cardStack.length }));

    results.push([url, { depth3, afterBack1, afterBack2, afterBack3 }]);
    await p.close();
  }

  const ok = results.every(([, r]) =>
    r.depth3.len === 3 && r.depth3.i === 2 && r.depth3.title === "100923901" &&
    r.afterBack1.i === 1 && r.afterBack1.title === "ACME BUILDERS" &&
    r.afterBack2.i === 0 && r.afterBack2.title === "100923847" &&
    r.afterBack3.hidden === true && r.afterBack3.len === 0);

  console.log(ok ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
```

- [ ] **Step 11: Run the browser test**

Start the server in a second shell: `python -m http.server 8791 --directory docs`
Run: `node verify-tmp/t17.js`
Expected: `FAIL` at this point — `contactDetailHtml` does not exist yet, so the contact card throws. The permit assertions (`depth3.title`, `afterBack2`) should already be satisfiable; confirm the failure is only the contact card, then proceed. Re-run this test at the end of Task 2, where it must print `PASS`.

- [ ] **Step 12: Commit**

```bash
git checkout -b contractor-detail-phase1
git add docs/index.html
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(overlay): typed card stack behind the permit modal

Replaces the single-shot body swap with state.cardStack + cardIndex and one
history entry per card, so browser Back steps the stack and closes only at the
bottom. state.activeDetail becomes a getter over the stack for existing readers."
```

---

### Task 2: Contractor card renderer

The card's HTML, built with the permit card's own classes, and correct for accessibility from the first commit.

**Files:**
- Create: `verify-tmp/p5-card-impl.mjs`
- Create: `verify-tmp/p5-card.mjs`
- Modify: `docs/index.html` — insert after `permitDetailHtml` (around line 6228)
- Modify: `docs/list.html` — insert at the matching location (around line 7500)

**Interfaces:**
- Consumes: `state.cardIndex` and `activeCard()` from Task 1; existing `esc`, `clean`, `fmt`, `money`, `norm`, `pmFacts`, `pmAnnounce`.
- Produces: `contactDetailHtml(desc) -> string`, `cardKicker(desc) -> string`, `contactPillsHtml(profile) -> string`, `cardSkeletonHtml() -> string`. Task 3 supplies `fillContactCard`; Task 4 calls `openContactCard`.

- [ ] **Step 1: Write the failing test**

Create `verify-tmp/p5-card-impl.mjs`:

```js
// AUTO-EXTRACTED from docs/index.html (contractor card builders).
export function cardKicker() { throw new Error("not implemented"); }
export function contactPillsHtml() { throw new Error("not implemented"); }
export function contactDetailHtml() { throw new Error("not implemented"); }
```

Create `verify-tmp/p5-card.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { cardKicker, contactPillsHtml, contactDetailHtml } from "./p5-card-impl.mjs";

const desc = (over = {}) => ({
  type: "contact",
  name: "ACME BUILDERS",
  role: "general_contractor",
  profile: { open_jobs: 12, total_jobs: 88, avg_processing_days: 9.4, usable_processing_jobs: 40, reported_cost_total: 4200000, license_matches: [], work_types: [], permit_types: [], contact_types: [] },
  permits: [],
  relatedError: "",
  ...over,
});

test("cardKicker names the role in words, not a slug", () => {
  assert.equal(cardKicker({ type: "contact", role: "general_contractor" }), "General contractor");
  assert.equal(cardKicker({ type: "contact", role: "open_tech" }), "Open sub");
  assert.equal(cardKicker({ type: "permit" }), "Permit");
});

test("the card supplies the id the dialog is labelled by", () => {
  const html = contactDetailHtml(desc());
  assert.match(html, /id="permit-modal-title"/,
    'the dialog is aria-labelledby="permit-modal-title" — without this id it has no accessible name');
  assert.match(html, /id="permit-modal-title"[^>]*>ACME BUILDERS</);
});

test("the card title is focusable so navigation can move focus to it", () => {
  assert.match(contactDetailHtml(desc()), /id="permit-modal-title"[^>]*tabindex="-1"/);
});

test("no h4 anywhere — the overlay uses h3 for every block", () => {
  const html = contactDetailHtml(desc());
  assert.ok(!/<h4/.test(html), "h4 under h3 is a heading-level skip");
  assert.match(html, /<h3>/);
});

test("pills use the permit card's own classes", () => {
  const html = contactPillsHtml(desc().profile, 12);
  assert.match(html, /class="pm-tagrow"/);
  assert.match(html, /class="pm-tag"/);
  assert.ok(!/class="tag"/.test(html), "the detail pane's .tag is a different visual language");
});

test("open jobs comes from the live count, not the cached profile", () => {
  const html = contactPillsHtml({ open_jobs: 999, total_jobs: 88 }, 12);
  assert.match(html, /12 open jobs/);
  assert.ok(!/999/.test(html), "cached open_jobs must not win over the live count");
});

test("the card escapes a hostile contractor name", () => {
  const html = contactDetailHtml(desc({ name: '<img src=x onerror=alert(1)>' }));
  assert.ok(!/<img src=x/.test(html));
  assert.match(html, /&lt;img/);
});

test("a back button appears only when there is something to go back to", () => {
  assert.match(contactDetailHtml(desc(), 1), /class="pm-back"/);
  assert.ok(!/class="pm-back"/.test(contactDetailHtml(desc(), 0)));
});

test("the permits table is wrapped so it cannot scroll the card body sideways", () => {
  const html = contactDetailHtml(desc({ permits: [{ permit_number: "1", address: "A", issue_date: "2026-01-01", work_type: "W", permit_type: "P", reported_cost: 1, permit_status: "ACTIVE", general_contractors: "ACME BUILDERS", open_subs: "" }] }));
  assert.match(html, /class="pm-tablewrap"/);
  assert.match(html, /aria-label="Open permits for ACME BUILDERS"/);
});

test("zero open permits explains itself instead of rendering an empty table", () => {
  const html = contactDetailHtml(desc({ permits: [] }));
  assert.match(html, /No open permits on file/);
  assert.ok(!/Add all/.test(html), "an Add-all button for zero rows is noise");
});

test("a fetch failure states the problem and offers a retry", () => {
  const html = contactDetailHtml(desc({ relatedError: "Network error" }));
  assert.match(html, /role="alert"/);
  assert.match(html, /Retry/);
});

test("the card carries the full profile, not just the permits table", () => {
  const html = contactDetailHtml(desc({
    profile: {
      total_jobs: 88,
      license_matches: [{ license_type: "General Contractor (Class E)", phone: "(773) 555-0180", license_number: "TGC12345", license_expiration_date: "2027-03-01" }],
      work_types: [{ work_type: "RENOVATION", jobs: 40 }, { work_type: "NEW CONSTRUCTION", jobs: 12 }],
      permit_types: [], contact_types: [],
      city: "CHICAGO", state: "IL", zipcode: "60618",
    },
  }));
  assert.match(html, /<h3>License<\/h3>/);
  assert.match(html, /General Contractor/);
  assert.match(html, /Class E/);
  assert.match(html, /\(773\) 555-0180/);
  assert.match(html, /CHICAGO, IL 60618/);
  assert.match(html, /<h3>Specialties<\/h3>/);
  assert.match(html, /RENOVATION/);
});

test("a contractor with no license match says so rather than showing an empty block", () => {
  const html = contactDetailHtml(desc({ profile: { license_matches: [], work_types: [], permit_types: [], contact_types: [] } }));
  assert.match(html, /No City license match/);
});

test("associations list the OTHER role and open a card, never the pane", () => {
  const html = contactDetailHtml(desc({
    permits: [
      { permit_number: "1", address: "A", issue_date: "2026-01-01", permit_status: "ACTIVE", reported_cost: 1, general_contractors: "ACME BUILDERS", open_subs: "SPARK ELECTRIC | FLOW PLUMBING" },
      { permit_number: "2", address: "B", issue_date: "2026-01-02", permit_status: "ACTIVE", reported_cost: 2, general_contractors: "ACME BUILDERS", open_subs: "SPARK ELECTRIC" },
    ],
  }));
  assert.match(html, /<h3>Associations<\/h3>/);
  assert.match(html, /SPARK ELECTRIC/);
  assert.match(html, /FLOW PLUMBING/);
  // Association chips must push a card onto the stack. openContactProfile drives
  // the separate directory pane and would wipe the overlay's stack.
  assert.match(html, /openContactCard\(/);
  assert.ok(!/openContactProfile\(/.test(html), "the pane entry point must not be used from inside the overlay");
  assert.match(html, /open_tech/, "a GC's associations are its open subs");
});

test("associations are counted, most frequent first", () => {
  const html = contactDetailHtml(desc({
    permits: [
      { permit_number: "1", general_contractors: "ACME BUILDERS", open_subs: "SPARK ELECTRIC | FLOW PLUMBING" },
      { permit_number: "2", general_contractors: "ACME BUILDERS", open_subs: "SPARK ELECTRIC" },
    ],
  }));
  assert.ok(html.indexOf("SPARK ELECTRIC") < html.indexOf("FLOW PLUMBING"));
  assert.match(html, /SPARK ELECTRIC<\/span> <span class="assoc-n">2/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test verify-tmp/p5-card.mjs`
Expected: FAIL — all 11 tests error with `not implemented`.

- [ ] **Step 3: Write the implementation**

Write the real functions into `verify-tmp/p5-card-impl.mjs`, prefixed with the helpers it needs standalone:

```js
// AUTO-EXTRACTED from docs/index.html (contractor card builders).
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clean = v => (v == null ? "" : String(v));
const fmt = n => Number(n || 0).toLocaleString("en-US");
const money = n => (n == null || n === "" ? "—" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const enc = encodeURIComponent;

export function cardKicker(desc) {
  if (desc.type === "permit") return "Permit";
  return desc.role === "open_tech" ? "Open sub" : "General contractor";
}

export function contactPillsHtml(profile, liveOpenJobs) {
  const p = profile || {};
  const pills = [];
  if (liveOpenJobs != null) pills.push(`${fmt(liveOpenJobs)} open jobs`);
  if (p.total_jobs != null) pills.push(`${fmt(p.total_jobs)} total jobs`);
  if (p.avg_processing_days != null) pills.push(`${Number(p.avg_processing_days).toFixed(1)} avg processing days`);
  if (p.usable_processing_jobs != null) pills.push(`${fmt(p.usable_processing_jobs)} usable timing records`);
  if (p.reported_cost_total != null) pills.push(`${money(p.reported_cost_total)} reported cost`);
  if (!pills.length) return "";
  return `<div class="pm-tagrow">${pills.map(t => `<span class="pm-tag num">${esc(t)}</span>`).join("")}</div>`;
}

export function contactDetailHtml(desc, cardIndex = 0) {
  const name = clean(desc.name);
  const rows = desc.permits || [];
  const err = clean(desc.relatedError);
  const back = cardIndex > 0
    ? `<button class="pm-back" aria-label="Back" onclick="popCard()">&lsaquo;</button>`
    : "";
  const phone = ((desc.profile && desc.profile.license_matches) || [])
    .map(m => clean(m.phone)).find(ph => ph && ph.toUpperCase() !== "NA") || "";
  const actions = [];
  if (phone) actions.push(`<a class="pm-act primary" href="tel:${esc(phone.replace(/[^\d+]/g, ""))}">Call ${esc(phone)}</a>`);
  if (rows.length) actions.push(`<button class="pm-act" onclick="addAllFromCard()">Add all ${fmt(rows.length)} to list</button>`);

  return `<div class="pm-head stacked">
      <div class="pm-titlerow">
        ${back}
        <div class="pm-title">
          <div class="k">${esc(cardKicker(desc))}</div>
          <div class="v" id="permit-modal-title" tabindex="-1">${esc(name)}</div>
        </div>
        <button class="pm-close" aria-label="Close" onclick="closePermitModal()">&#10005;</button>
      </div>
      ${actions.length ? `<div class="pm-actions">${actions.join("")}</div>` : ""}
    </div>
    <div class="pm-content">
    ${contactPillsHtml(desc.profile, rows.length)}
    <section class="pm-block"><h3>Open permits</h3>
      ${err
        ? `<p class="pm-error" role="alert">${esc(err)} <button class="pm-act" onclick="retryContactCard()">Retry</button></p>`
        : rows.length
          ? `<div class="pm-tablewrap"><table aria-label="Open permits for ${esc(name)}"><thead><tr><th>Permit</th><th>Issued</th><th>Address</th><th>Cost</th></tr></thead><tbody>${rows.map(r => `<tr tabindex="0" onclick="openPermitDetailFromEncoded('${enc(JSON.stringify(r))}')"><td><strong>${esc(r.permit_number)}</strong><br><span class="small">${esc(r.permit_status)}</span></td><td class="num">${esc(r.issue_date)}</td><td>${esc(r.address)}</td><td class="num">${money(r.reported_cost)}</td></tr>`).join("")}</tbody></table></div>`
          : `<p class="pm-empty">No open permits on file for this contractor.</p>`}
    </section>
    ${licenseBlockHtml(desc.profile)}
    ${specialtiesBlockHtml(desc.profile)}
    ${associationsBlockHtml(desc)}
    </div>`;
}

// Trade portion of a license type string: "General Contractor (Class E)" -> "General Contractor".
function parseLicenseTypeLocal(t) { return String(t || "").replace(/\s*\(Class\s+[A-Z]\)\s*/i, "").trim(); }
// Class letter: "... (Class E)" -> "E", "" when none.
function parseLicenseClassLocal(t) { const m = String(t || "").match(/\(Class\s+([A-Z])\)/i); return m ? m[1].toUpperCase() : ""; }

export function licenseBlockHtml(profile) {
  const p = profile || {};
  const matches = p.license_matches || [];
  if (!matches.length) {
    return `<section class="pm-block"><h3>License</h3><p class="pm-empty">No City license match on file for this name.</p></section>`;
  }
  const m = matches[0];
  const phone = matches.map(x => clean(x.phone)).find(ph => ph && ph.toUpperCase() !== "NA") || "";
  const where = [clean(p.city), clean(p.state)].filter(Boolean).join(", ");
  const locality = [where, clean(p.zipcode)].filter(Boolean).join(" ");
  const rows = [
    ["Type", parseLicenseTypeLocal(m.license_type)],
    ["Class", parseLicenseClassLocal(m.license_type) ? `Class ${parseLicenseClassLocal(m.license_type)}` : ""],
    ["Licence no.", clean(m.license_number)],
    ["Expires", clean(m.license_expiration_date)],
    ["Phone", phone],
    ["Based in", locality],
  ];
  return `<section class="pm-block"><h3>License</h3><dl class="pm-facts">${rows.map(([k, v]) =>
    `<dt>${esc(k)}</dt><dd>${v ? (k === "Phone" ? `<a href="tel:${esc(String(v).replace(/[^\d+]/g, ""))}">${esc(v)}</a>` : esc(v)) : "—"}</dd>`).join("")}</dl>${
    matches.length > 1 ? `<p class="pm-empty">${fmt(matches.length - 1)} more licence rows matched this name.</p>` : ""}</section>`;
}

export function specialtiesBlockHtml(profile) {
  const items = ((profile || {}).work_types || []).slice(0, 6);
  if (!items.length) return "";
  return `<section class="pm-block"><h3>Specialties</h3><ul class="pm-chiplist">${items.map(w =>
    `<li><span>${esc(clean(w.work_type))}</span> <span class="assoc-n">${fmt(w.jobs)}</span></li>`).join("")}</ul></section>`;
}

// Contractors seen alongside this one on its permits, in the opposite role.
// Chips push a card — openContactProfile drives the separate directory pane and
// would replace the overlay's stack.
export function associationsBlockHtml(desc) {
  const otherField = desc.role === "open_tech" ? "general_contractors" : "open_subs";
  const otherRole = desc.role === "open_tech" ? "general_contractor" : "open_tech";
  const counts = new Map();
  (desc.permits || []).forEach(row => {
    clean(row[otherField]).split("|").map(x => x.trim()).filter(Boolean)
      .forEach(nm => counts.set(nm, (counts.get(nm) || 0) + 1));
  });
  if (!counts.size) {
    return `<section class="pm-block"><h3>Associations</h3><p class="pm-empty">No other contractors named on these permits.</p></section>`;
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20);
  return `<section class="pm-block"><h3>Associations</h3><ul class="pm-chiplist">${sorted.map(([nm, n]) =>
    `<li><button type="button" class="assoc" onclick="openContactCard('${enc(nm)}', '${otherRole}')" aria-label="Open profile for ${esc(nm)}"><span>${esc(nm)}</span> <span class="assoc-n">${fmt(n)}</span></button></li>`).join("")}</ul></section>`;
}
```

These three helpers are what makes the card **full parity** with the directory pane, which the spec's decision #1 requires. Note they are exported from the extracted module for testing, and ported into both pages alongside `contactDetailHtml` in Step 5. `parseLicenseTypeLocal` / `parseLicenseClassLocal` exist only in the extracted test module — **both pages already define `parseLicenseType` and `parseLicenseClass`**, so in the page copies call those existing functions instead and do not add duplicates.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test verify-tmp/p5-card.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Port the builders into both pages**

Copy `cardKicker`, `contactPillsHtml` and `contactDetailHtml` — **without** the standalone `esc`/`clean`/`fmt`/`money`/`enc` shims, which both pages already define — into `docs/index.html` immediately after `permitDetailHtml` (around line 6228) and into `docs/list.html` at the matching point. In the page copies, change the `contactDetailHtml(desc, cardIndex = 0)` signature call site: `renderCard` passes the index, so update Task 1's `renderCard` line to:

```js
        : contactDetailHtml(desc, state.cardIndex);
```

Also extend the permit card's head so both card types share the back button. In `permitDetailSections` (index.html:6173, list.html matching), replace the `<div class="pm-head">` opening block with:

```js
        () => `<div class="pm-head stacked">
            <div class="pm-titlerow">
              ${state.cardIndex > 0 ? `<button class="pm-back" aria-label="Back" onclick="popCard()">&lsaquo;</button>` : ""}
              <div class="pm-title"><div class="k">Permit</div><div class="v" id="permit-modal-title" tabindex="-1">${esc(row.permit_number)}</div></div>
              <button class="pm-close" aria-label="Close" onclick="closePermitModal()">&#10005;</button>
            </div>
            <div class="pm-actions"><button class="pm-act primary" onclick="addPermitFromEncoded('${payload}')" ${saved ? "disabled" : ""}>${saved ? "\u2713 Saved" : "Add to list"}</button></div>
          </div>
          <div class="pm-content">
          <div class="pm-tagrow">
            <span class="pm-tag">${esc(row.permit_status)}</span>
            <span class="pm-tag">${esc(row.permit_type)}</span>
            ${row.reported_cost ? `<span class="pm-tag num">${money(row.reported_cost)}</span>` : ""}
          </div>`,
```

- [ ] **Step 6: Add the CSS**

In **both** files, immediately after the `.pm-facts dd` rule (index.html:2739, list.html matching), insert — identical text in both:

```css
    /* Card-stack header: one row on desktop, title over actions on mobile. */
    .pm-head.stacked { flex-direction: column; align-items: stretch; gap: 10px; }
    .pm-titlerow { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .pm-title .v { overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .pm-back { width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer; font-size: 1.35rem; line-height: 1; flex: none; }
    .pm-back:focus-visible, .pm-close:focus-visible, .pm-act:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .pm-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .pm-act { min-height: 44px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; text-decoration: none; }
    .pm-act.primary { background: var(--primary); border-color: var(--primary); color: var(--panel); }
    .pm-act[disabled] { opacity: 0.45; cursor: default; }
    /* Tabular figures so paging cannot jitter the column widths. */
    .pm-tag.num, .pm-tablewrap td.num { font-variant-numeric: tabular-nums; }
    /* Horizontal only — a nested vertical scroller would fight the card body. */
    .pm-tablewrap { overflow-x: auto; overflow-y: visible; }
    .pm-tablewrap table { width: 100%; border-collapse: collapse; }
    .pm-tablewrap th, .pm-tablewrap td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); font-size: 0.85rem; }
    .pm-tablewrap tbody tr { cursor: pointer; }
    .pm-tablewrap tbody tr:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
    .pm-empty, .pm-error { font-size: 0.85rem; color: var(--muted); }
    .pm-error { color: var(--ink); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    @media (min-width: 721px) {
      .pm-head.stacked { flex-direction: row; align-items: center; }
      .pm-actions { flex: none; }
    }
    @media (max-width: 720px) {
      /* Full-screen card: keep the sticky header and actions clear of the
         notch and the home indicator. */
      .pm-head.stacked { padding-top: calc(16px + env(safe-area-inset-top)); }
      .pm-content { padding-bottom: calc(22px + env(safe-area-inset-bottom)); }
      .pm-act { flex: 1 1 auto; justify-content: center; }
    }
```

- [ ] **Step 7: Verify the shared blocks still match**

Run: `python verify-tmp/_bytediff.py "let _permitModalPrevFocus" "function trapPermitModalFocus"`
Run: `python verify-tmp/_bytediff.py "function cardKicker" "function fillPermitGeo"`
Expected: `MATCH` from both.

- [ ] **Step 8: Run the browser test from Task 1**

With the server running, run: `node verify-tmp/t17.js`
Expected: `PASS` — both pages, all three navigation assertions.

- [ ] **Step 9: Commit**

```bash
git add docs/index.html
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(overlay): contractor card rendered in the permit card's shell

Same .pm-head/.pm-block/.pm-tag vocabulary as a permit card, with the accessible
name (#permit-modal-title), a focusable title, h3-only headings, tabular figures
and a horizontally-scrolling permits table. Header stacks on mobile and respects
safe areas."
```

---

### Task 3: Contractor data layer

Fetch the profile and the live permits, derive the open-jobs count, and filter away the substring over-fetch.

**Files:**
- Modify: `verify-tmp/p5-stack-impl.mjs` (add the filter)
- Modify: `verify-tmp/p5-stack.mjs` (add its tests)
- Modify: `docs/index.html`, `docs/list.html` — insert after `contactDetailHtml`

**Interfaces:**
- Consumes: `contactDetailHtml`, `cardSkeletonHtml` from Task 2; `API_BASE`, `norm`, `clean` from the pages.
- Produces: `normContractor(name) -> string`, `rowsForContractor(rows, name, role) -> array`, `fillContactCard(body, desc) -> Promise<void>`, `retryContactCard()`.

- [ ] **Step 1: Write the failing test**

Append to `verify-tmp/p5-stack.mjs`:

```js
import { normContractor, rowsForContractor } from "./p5-stack-impl.mjs";

test("normContractor folds case, punctuation and corporate suffixes", () => {
  assert.equal(normContractor("ACME BUILDERS, INC."), normContractor("acme builders inc"));
  assert.equal(normContractor("Acme  Builders   LLC"), normContractor("ACME BUILDERS"));
  assert.equal(normContractor("A-1 Roofing Co."), normContractor("A1 ROOFING"));
});

test("normContractor keeps genuinely different names apart", () => {
  assert.notEqual(normContractor("ACME BUILDERS"), normContractor("ACME PLUMBING"));
});

test("rowsForContractor drops the substring over-fetch", () => {
  const rows = [
    { permit_number: "1", general_contractors: "ACME BUILDERS", open_subs: "" },
    { permit_number: "2", general_contractors: "ACME PLUMBING", open_subs: "" },
    { permit_number: "3", general_contractors: "", open_subs: "ACME BUILDERS" },
  ];
  const out = rowsForContractor(rows, "ACME BUILDERS", "general_contractor");
  assert.deepEqual(out.map(r => r.permit_number), ["1"],
    "row 2 is a different company; row 3 lists the name as a sub, not a GC");
});

test("rowsForContractor matches open subs on the open_tech role", () => {
  const rows = [{ permit_number: "3", general_contractors: "", open_subs: "ACME BUILDERS | OTHER CO" }];
  assert.equal(rowsForContractor(rows, "ACME BUILDERS", "open_tech").length, 1);
});

test("rowsForContractor tolerates missing fields", () => {
  assert.deepEqual(rowsForContractor([{ permit_number: "1" }], "ACME", "general_contractor"), []);
  assert.deepEqual(rowsForContractor(null, "ACME", "general_contractor"), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test verify-tmp/p5-stack.mjs`
Expected: FAIL — `normContractor` / `rowsForContractor` are not exported.

- [ ] **Step 3: Write the implementation**

Append to `verify-tmp/p5-stack-impl.mjs`:

```js
// Fold a contractor name to a comparison key: case, punctuation, whitespace and
// a trailing corporate suffix are all noise when matching permit text against a
// profile name.
export function normContractor(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(INC|LLC|CO|CORP|LTD)$/, "")
    .trim();
}

// /api/permits?contact_name= is a substring LIKE across all 15 contact slots,
// so "ACME" also returns "ACME PLUMBING". Keep only rows that actually name
// this contractor in the role we are showing.
export function rowsForContractor(rows, name, role) {
  const key = normContractor(name);
  const field = role === "open_tech" ? "open_subs" : "general_contractors";
  return (rows || []).filter(row =>
    String(row[field] || "").split("|").map(normContractor).includes(key));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test verify-tmp/p5-stack.mjs`
Expected: PASS, 10 tests (5 from Task 1, 5 new).

- [ ] **Step 5: Add the skeleton builder and the fetch to both pages**

Add `cardSkeletonHtml` next to `contactDetailHtml` in **both** files:

```js
    // Shown while the two contractor fetches are in flight. Both routinely
    // exceed 300ms, and a blank card reads as a broken overlay.
    function cardSkeletonHtml(desc, cardIndex) {
      return `<div class="pm-head stacked">
          <div class="pm-titlerow">
            ${cardIndex > 0 ? `<button class="pm-back" aria-label="Back" onclick="popCard()">&lsaquo;</button>` : ""}
            <div class="pm-title"><div class="k">${esc(cardKicker(desc))}</div><div class="v" id="permit-modal-title" tabindex="-1">${esc(clean(desc.name))}</div></div>
            <button class="pm-close" aria-label="Close" onclick="closePermitModal()">&#10005;</button>
          </div>
        </div>
        <div class="pm-content">
          <div class="pm-tagrow">${"<span class=\"pm-skel pill\"></span>".repeat(4)}</div>
          <section class="pm-block"><h3>Open permits</h3>
            <div class="pm-skel line"></div><div class="pm-skel line"></div><div class="pm-skel line"></div>
          </section>
        </div>`;
    }
```

Then `normContractor`, `rowsForContractor` (copy verbatim from Step 3) and:

```js
    // Fetch a contractor's profile and live permits, cache them on the
    // descriptor, and re-render the card. Cached descriptors skip the fetch
    // entirely, so stepping back is instant.
    async function fillContactCard(body, desc) {
      if (desc.loaded) return;
      body.setAttribute("aria-busy", "true");
      const role = desc.role === "open_tech" ? "open_tech" : "general_contractor";
      const [profile, permitsResult] = await Promise.all([
        fetch(`${API_BASE}/api/contact/${encodeURIComponent(desc.name)}?category=${role}`)
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${API_BASE}/api/permits?contact_name=${encodeURIComponent(desc.name)}&limit=200`)
          .then(r => (r.ok ? r.json() : Promise.reject(new Error(`Permits unavailable (${r.status})`))))
          .catch(e => ({ error: e.message || "Open permits could not be loaded." })),
      ]);
      desc.profile = profile;
      desc.relatedError = permitsResult.error || "";
      desc.permits = permitsResult.error ? [] : rowsForContractor(permitsResult.rows, desc.name, role);
      desc.loaded = true;
      if (activeCard() !== desc) return; // user navigated away mid-flight
      body.removeAttribute("aria-busy");
      renderCard("none");
    }

    // Retry button in the card's error state.
    function retryContactCard() {
      const desc = activeCard();
      if (!desc || desc.type !== "contact") return;
      desc.loaded = false;
      renderCard("none");
    }
```

- [ ] **Step 6: Render the skeleton before the fetch**

In `renderCard` (Task 1, Step 7), change the contact branch so an unloaded card paints the skeleton first:

```js
      body.innerHTML = desc.type === "permit"
        ? permitDetailHtml(desc.row)
        : desc.loaded
          ? contactDetailHtml(desc, state.cardIndex)
          : cardSkeletonHtml(desc, state.cardIndex);
```

- [ ] **Step 7: Add the skeleton CSS**

Append to the CSS block added in Task 2, Step 6, in **both** files:

```css
    .pm-skel { display: block; background: var(--line); border-radius: 6px; opacity: 0.55; }
    .pm-skel.pill { display: inline-block; width: 92px; height: 26px; border-radius: 999px; margin-right: 6px; }
    .pm-skel.line { height: 38px; margin: 8px 0; }
    @media (prefers-reduced-motion: no-preference) {
      .pm-skel { animation: pmPulse 1.2s ease-in-out infinite; }
      @keyframes pmPulse { 50% { opacity: 0.25; } }
    }
```

- [ ] **Step 8: Verify and commit**

Run: `node --test verify-tmp/p5-stack.mjs` — Expected: PASS, 10 tests.
Run: `python verify-tmp/_bytediff.py "function cardKicker" "function fillPermitGeo"` — Expected: `MATCH`.

```bash
git add docs/index.html verify-tmp/p5-stack-impl.mjs verify-tmp/p5-stack.mjs
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(overlay): contractor card data layer

Parallel fetch of /api/contact (aggregates) and /api/permits (live rows),
cached on the descriptor so Back never re-fetches. Open-jobs is derived from
the live rows after filtering away the substring over-fetch that contact_name
LIKE returns. Skeleton + aria-busy while in flight, Retry on failure."
```

---

### Task 4: Bidirectional wiring

Make contractor rows open contractor cards, and keep permit rows inside a contractor card opening permit cards.

**Files:**
- Modify: `docs/index.html:5674-5678` (`contractorLinesHtml`) and `:5708-5731` (`fillPermitContractors`)
- Modify: `docs/list.html:6859-6863` and `:6892-6915` (same functions)

**Interfaces:**
- Consumes: `pushCard` (Task 1), `fetchContractorInfo` (existing), `rowsForContractor` (Task 3).
- Produces: `openContactCard(encodedName, role)`, `addAllFromCard()`.

- [ ] **Step 1: Write the failing browser test**

Create `verify-tmp/t18.js`:

```js
// t18: permit -> contractor -> permit, both directions, on BOTH pages, and the
// no-profile row stays inert. Runs at an iPhone 13 viewport.
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const PAGES = ["http://127.0.0.1:8791/index.html", "http://127.0.0.1:8791/list.html"];
const ROW = { permit_number: "100923847", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", address: "4 N AVE", work_type: "RENOVATION", work_description: "Interior", reported_cost: 120000, total_fee: 900, general_contractors: "ACME BUILDERS | J. RIVERA", open_subs: "", latitude: 41.9, longitude: -87.7 };
const OTHER = { ...ROW, permit_number: "100923901", address: "22 W ST" };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const results = [];
  for (const url of PAGES) {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await p.route("**/api/contact/ACME%20BUILDERS**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ contact_name: "ACME BUILDERS", open_jobs: 999, total_jobs: 88, avg_processing_days: 9.4, reported_cost_total: 4200000, license_matches: [{ phone: "(773) 555-0180", license_type: "General Contractor (Class E)" }], work_types: [], permit_types: [], contact_types: [] }) }));
    await p.route("**/api/contact/**", r => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Contact not found" }) }));
    await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [ROW, OTHER, { ...ROW, permit_number: "999", general_contractors: "ACME PLUMBING" }], row_count: 3 }) }));
    await p.route("**/api/notes/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [] }) }));
    await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
    await p.goto(url, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => typeof pushCard === "function");

    await p.evaluate(row => openPermitDetail(row), ROW);
    await p.waitForSelector('.contractor-line[data-filled]');
    // A contractor with a profile is a button; one without is not clickable.
    const rowStates = await p.evaluate(() => [...document.querySelectorAll(".contractor-line")].map(el => ({
      name: el.getAttribute("data-contractor"),
      clickable: el.tagName === "BUTTON" || el.hasAttribute("onclick"),
      text: el.textContent,
    })));

    await p.evaluate(() => document.querySelector('.contractor-line[data-contractor="ACME BUILDERS"]').click());
    await p.waitForFunction(() => state.cardIndex === 1 && (activeCard() || {}).loaded);
    const card = await p.evaluate(() => ({
      title: document.getElementById("permit-modal-title").textContent,
      pills: [...document.querySelectorAll(".pm-tag")].map(t => t.textContent),
      tableRows: document.querySelectorAll(".pm-tablewrap tbody tr").length,
      focused: document.activeElement.id,
      noHorizontalScroll: document.querySelector(".permit-modal-body").scrollWidth <= document.querySelector(".permit-modal-body").clientWidth,
      backSize: (b => b && { w: b.offsetWidth, h: b.offsetHeight })(document.querySelector(".pm-back")),
    }));

    await p.evaluate(() => document.querySelector(".pm-tablewrap tbody tr").click());
    await p.waitForFunction(() => state.cardIndex === 2);
    const third = await p.evaluate(() => ({ i: state.cardIndex, title: document.getElementById("permit-modal-title").textContent }));

    results.push([url, { rowStates, card, third }]);
    await p.close();
  }

  const ok = results.every(([, r]) => {
    const acme = r.rowStates.find(x => x.name === "ACME BUILDERS");
    const rivera = r.rowStates.find(x => x.name === "J. RIVERA");
    return acme.clickable && !rivera.clickable && /No profile on file/.test(rivera.text) &&
      r.card.title === "ACME BUILDERS" &&
      r.card.pills.some(t => /2 open jobs/.test(t)) &&
      !r.card.pills.some(t => /999/.test(t)) &&
      r.card.tableRows === 2 &&
      r.card.focused === "permit-modal-title" &&
      r.card.noHorizontalScroll &&
      r.card.backSize.w >= 44 && r.card.backSize.h >= 44 &&
      r.third.i === 2 && r.third.title === "100923847";
  });

  console.log(ok ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node verify-tmp/t18.js`
Expected: FAIL — contractor rows are still inert `<div>`s.

- [ ] **Step 3: Make contractor rows clickable**

In **both** files, replace `contractorLinesHtml`:

```js
    // Contractor (GC / open sub) lines for a permit's detail overlay. Names come
    // from the permit; license/open-jobs/phone are filled on demand by
    // fillPermitContractors, which also promotes a row with a profile to a
    // button that opens that contractor's card.
    function contractorLinesHtml(value, role) {
      const names = clean(value).split("|").map(x => x.trim()).filter(Boolean);
      if (!names.length) return `<div class="pc-empty">None listed</div>`;
      return names.map(name => `<div class="contractor-line" data-contractor="${esc(name)}" data-role="${role}"><span class="ci-name">${esc(name)}</span><span class="ci-meta"> · …</span></div>`).join("");
    }

    // Open a contractor's card on top of the current one.
    function openContactCard(encodedName, role) {
      pushCard({ type: "contact", name: decodeURIComponent(encodedName), role });
    }

    // Add every permit currently listed on the active contractor card.
    function addAllFromCard() {
      const desc = activeCard();
      if (!desc || desc.type !== "contact") return;
      const btn = document.querySelector('.pm-actions .pm-act:not(.primary)');
      if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
      (desc.permits || []).forEach(row => addPermitToUserList(row));
      pmAnnounce(`${(desc.permits || []).length} permits added to your list`);
      renderCard("none");
    }
```

If the page's add-one-permit entry point is not named `addPermitToUserList`, use the function `addPermitFromEncoded` delegates to — check `docs/index.html` for `function addPermitFromEncoded` and call the same underlying function, so a bulk add follows exactly the same path as a single add.

- [ ] **Step 4: Promote filled rows to buttons**

In **both** files, in `fillPermitContractors`, replace the `if (!info) { meta.textContent = ""; return; }` line with:

```js
        if (!info) {
          meta.textContent = "";
          line.insertAdjacentHTML("beforeend", `<span class="ci-none">No profile on file</span>`);
          return;
        }
        // A contractor we have a profile for becomes a button to its card.
        line.setAttribute("role", "button");
        line.setAttribute("tabindex", "0");
        line.setAttribute("onclick", `openContactCard('${enc(line.getAttribute("data-contractor"))}', '${line.getAttribute("data-role")}')`);
        line.setAttribute("aria-label", `Open profile for ${line.getAttribute("data-contractor")}`);
        line.classList.add("clickable");
```

and append to the CSS block from Task 2, Step 6, in **both** files:

```css
    .contractor-line.clickable { cursor: pointer; min-height: 44px; }
    .contractor-line.clickable:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .ci-none { display: block; font-size: 0.79rem; color: var(--muted); margin-top: 4px; }
```

- [ ] **Step 5: Run the test**

Run: `node verify-tmp/t18.js`
Expected: `PASS` on both pages.

- [ ] **Step 6: Commit**

```bash
git add docs/index.html
git -c core.autocrlf=false add docs/list.html
git commit -m "feat(overlay): contractor rows open contractor cards, both directions

A contractor with a profile becomes a 44px button to its card; one without is
labelled 'No profile on file' and stays inert. Permit rows inside a contractor
card push a permit card, so the stack alternates in both directions."
```

---

### Task 5: Focus, announcement and animation

The three blocking accessibility defects from the spec, plus the push/back motion.

**Files:**
- Modify: `docs/index.html`, `docs/list.html` — `renderCard`, plus CSS

**Interfaces:**
- Consumes: `renderCard` (Task 1), `cardKicker` (Task 2), `pmAnnounce` (existing).
- Produces: no new exports.

- [ ] **Step 1: Extend renderCard with focus, announcement and motion**

In **both** files, replace `renderCard` with:

```js
    // Render the active card into the overlay body and run its onOpen hooks.
    // direction is "forward", "back" or "none" and only drives the animation.
    function renderCard(direction = "forward") {
      const desc = activeCard();
      if (!desc) return;
      const body = $("permit-modal-body");
      body.innerHTML = desc.type === "permit"
        ? permitDetailHtml(desc.row)
        : desc.loaded
          ? contactDetailHtml(desc, state.cardIndex)
          : cardSkeletonHtml(desc, state.cardIndex);

      // Motion: replay the card-entry keyframe on the body only. Clearing the
      // class first makes a rapid second tap cancel the running animation
      // instead of queueing behind it.
      body.classList.remove("pm-in", "pm-out");
      if (direction !== "none") {
        void body.offsetWidth; // force reflow so the class re-triggers
        body.classList.add(direction === "back" ? "pm-out" : "pm-in");
      }

      // The swapped innerHTML destroyed whatever had focus. Without this, focus
      // falls to <body> and keyboard/screen-reader users lose the stack.
      const title = document.getElementById("permit-modal-title");
      if (title) title.focus({ preventScroll: true });
      body.scrollTop = 0;
      pmAnnounce(`${cardKicker(desc)}, ${desc.type === "permit" ? clean(desc.row.permit_number) : clean(desc.name)}`);

      if (desc.type === "permit") {
        fillPermitContractors(body);
        fillPermitGeo(body, desc.row);
        const pn = clean(desc.row.permit_number);
        if (pn) fetchThread(pn);
      } else {
        fillContactCard(body, desc);
      }
    }
```

- [ ] **Step 2: Add the motion CSS**

Append to the CSS block from Task 2, Step 6, in **both** files:

```css
    @media (prefers-reduced-motion: no-preference) {
      /* Forward enters from below, back from above — the standard hierarchy
         cue. Exit is ~65% of enter so going back feels immediate. */
      .permit-modal-body.pm-in { animation: permitRise 0.24s ease; }
      .permit-modal-body.pm-out { animation: permitFall 0.16s ease; }
      @keyframes permitFall { from { opacity: 0; transform: translateY(-14px); } }
    }
```

`permitRise` already exists (index.html:2724) and is reused unchanged.

- [ ] **Step 3: Write the a11y verification test**

Append a second block to `verify-tmp/t18.js`, before the final `ok` computation — a desktop pass over both themes:

```js
  // Desktop + both themes: contrast-relevant tokens resolve, targets are big
  // enough and spaced, and reduced-motion removes the card animation.
  for (const url of PAGES) {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await p.route("**/api/contact/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ contact_name: "ACME BUILDERS", total_jobs: 88, avg_processing_days: 9.4, reported_cost_total: 4200000, license_matches: [{ phone: "(773) 555-0180" }], work_types: [], permit_types: [], contact_types: [] }) }));
    await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [ROW], row_count: 1 }) }));
    await p.route("**/api/notes/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [] }) }));
    await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
    for (const theme of ["light", "dark"]) {
      await p.addInitScript(t => localStorage.setItem("chi_permit_theme", t), theme);
      await p.emulateMedia({ reducedMotion: "reduce" });
      await p.goto(url, { waitUntil: "domcontentloaded" });
      await p.waitForFunction(() => typeof pushCard === "function");
      await p.evaluate(() => pushCard({ type: "contact", name: "ACME BUILDERS", role: "general_contractor" }));
      await p.waitForFunction(() => (activeCard() || {}).loaded);
      results.push([`${url}#${theme}`, await p.evaluate(() => {
        const acts = [...document.querySelectorAll(".pm-act, .pm-close, .pm-back")];
        const body = document.querySelector(".permit-modal-body");
        return {
          allBigEnough: acts.every(a => a.offsetWidth >= 44 && a.offsetHeight >= 44),
          labelled: acts.every(a => (a.textContent || "").trim() || a.getAttribute("aria-label")),
          noH4: !document.querySelector(".permit-modal-body h4"),
          titleId: !!document.getElementById("permit-modal-title"),
          animationNone: getComputedStyle(body).animationName === "none",
          noHScroll: body.scrollWidth <= body.clientWidth,
        };
      })]);
    }
    await p.close();
  }
```

and extend the final `ok` expression to require, for every entry whose key contains `#`:
`allBigEnough && labelled && noH4 && titleId && animationNone && noHScroll`.

- [ ] **Step 4: Run both browser tests**

Run: `node verify-tmp/t17.js` — Expected: `PASS`
Run: `node verify-tmp/t18.js` — Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add docs/index.html
git -c core.autocrlf=false add docs/list.html
git commit -m "fix(a11y): move focus and announce on every card navigation

innerHTML swaps destroyed the focused element and dropped focus to body.
renderCard now focuses the new card's title, resets scroll, and announces the
card through the existing aria-live region. Adds interruptible push/back motion
(240ms rise / 160ms fall) behind the reduced-motion gate."
```

---

### Task 6: Full-suite verification

**Files:** none modified — this task only runs what exists and fixes what it finds.

- [ ] **Step 1: Run every client unit suite**

Run: `node --test verify-tmp/p5-stack.mjs verify-tmp/p5-card.mjs`
Expected: PASS, 21 tests.

- [ ] **Step 2: Run the pre-existing client suites for regressions**

Run: `node --test verify-tmp/p1-*.mjs verify-tmp/p2-*.mjs verify-tmp/p3-*.mjs verify-tmp/p4-*.mjs verify-tmp/pb-*.mjs`
Expected: PASS, 65 tests. Any failure here is a regression from this phase — fix before continuing.

- [ ] **Step 3: Run the pre-existing browser suites**

With the server running, run each of `t11.js`, `t13.js`, `t15.js`, `t16.js`:

```bash
node verify-tmp/t11.js && node verify-tmp/t13.js && node verify-tmp/t15.js && node verify-tmp/t16.js
```

Expected: `PASS` from each. `t16` in particular drives the walkthrough on both pages through the permit overlay, so it exercises the rewritten modal machinery.

- [ ] **Step 4: Run the worker suite unchanged**

Run: `cd worker && npm test`
Expected: PASS, 99 tests. Phase 1 touches no Worker code; a failure means something was edited that should not have been.

- [ ] **Step 5: Verify both shared blocks are byte-identical**

```bash
python verify-tmp/_bytediff.py "let _permitModalPrevFocus" "function trapPermitModalFocus"
python verify-tmp/_bytediff.py "function cardKicker" "function fillPermitGeo"
```

Expected: `MATCH` from both.

- [ ] **Step 6: Confirm no invisible bytes were introduced**

```bash
python -c "import pathlib; [print(n, pathlib.Path('docs',n).read_bytes().count(b'\x08'), pathlib.Path('docs',n).read_bytes().count(b'\x00')) for n in ('index.html','list.html')]"
```

Expected: `index.html 0 0` and `list.html 0 0`. Any non-zero count means a patch script mangled the file — revert and redo that edit with the Edit tool.

- [ ] **Step 7: Screenshot both pages at iPhone 13 and desktop for a visual check**

Adapt `verify-tmp/_shot.js` to open a contractor card and capture at 390×844 and 1280×900, in both themes. Review the four images for: the header stacking correctly with a long name, no clipped card bottom, the permits table scrolling rather than overflowing, and pill/label contrast in dark mode.

- [ ] **Step 8: Commit any fixes and report**

Do **not** merge to `main` or push yet. Report the suite results and the screenshots, and confirm Phase 2 before starting it.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Card stack of typed descriptors, push/pop/forward | 1 |
| One history entry per card; back steps, closes at bottom | 1 |
| `state.activeDetail` alias preserved | 1 |
| Contractor card in the permit card's shell (`.pm-head`/`.pm-block`/`.pm-tag`) | 2 |
| Header actions: Call primary + Add all N | 2, 4 |
| Mobile stacked header, two-line title, safe areas | 2 |
| Table wrapped `overflow-x`, `aria-label`, tabular numerals | 2 |
| Parallel fetch, cached on descriptor, live open-jobs | 3 |
| Exact-name filter against the substring over-fetch | 3 |
| Skeleton + `aria-busy`; empty; error + Retry + `role="alert"` | 2, 3 |
| Contractor rows clickable; `No profile on file` inert | 4 |
| Permit rows inside a card push a permit card | 4 |
| Dialog accessible name (`#permit-modal-title`) on both card types | 2 |
| Focus moves to the new card's title; announcement | 5 |
| No `<h4>` in the overlay | 2 (asserted), 5 (asserted at runtime) |
| Push 240ms / back 160ms, interruptible, reduced-motion | 5 |
| Byte-identical shared block | every task, Step "verify"; 6 |

Deferred to later phases by design: Worker matching ladder, `matched_as`, `No profile on file` driven by a normalized Worker lookup rather than a client 404, `seeded_at` / "Profile data as of" (all Phase 2); last-view persistence (Phase 3).

**Placeholder scan:** none — every code step carries the code, every command carries its expected output. The one judgement call left to the implementer is flagged explicitly in Task 4 Step 3 (the add-one-permit function name, to be read from the page rather than guessed).

**Type consistency:** `stackPush`/`stackGo` return `{stack, index}` in both the extracted module and the page copies. `contactDetailHtml(desc, cardIndex)` is two-argument at every call site (`renderCard`, both tests). `cardKicker(desc)` takes the descriptor, not the role string. `rowsForContractor(rows, name, role)` takes the same role token (`general_contractor` | `open_tech`) used by `fetchContractorInfo` and the `data-role` attribute.
