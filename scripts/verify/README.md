# Control-style snapshot harness

Before/after diffing for CSS changes that touch many elements at once.

## When to use it

Reach for this whenever a change edits **one rule that covers many elements**:

- a global `button {}` / `input, select, textarea {}` rule
- a blanket floor (the 16px iOS font floor, a 44px touch-target floor)
- a specificity change (`:is()`, `:where()`, re-scoping a selector)
- anything described as "just a refactor, no visual change"

You cannot check these by looking at the page. The regression is always in the
one member the rule was **not** written for, and it stays invisible until
someone opens that surface.

## Usage

Needs a static server on `docs/`:

```bash
npx http-server docs -p 8791 --silent
```

Then:

```bash
node scripts/verify/snapshot-controls.js before.json
# ...make the change...
node scripts/verify/snapshot-controls.js after.json
node scripts/verify/diff-snapshots.js before.json after.json
```

`diff-snapshots.js` exits **1** if anything changed, so it can gate a refactor
that is meant to be behaviour-preserving. Add `--all` to see every group.

Optional: `CHROME_PATH=/path/to/chrome-headless-shell` — otherwise the newest
cached `chromium_headless_shell-*` under `%LOCALAPPDATA%\ms-playwright` is used.
Playwright's own default is deliberately not trusted: it points at whatever
build its version expects, which is often not the one actually installed.

## What it captures

Every `button, input, select, textarea` on all four pages, at three viewports
(1280 / 1600 / iPhone 13) — 12 combinations, ~483 controls. Both computed style
(~23 properties) and measured box.

Three viewports because two is not enough: the list toolbar has desktop tiers at
641px **and** 1400px, and a change to the upper tier is invisible at 1280.

It opens the on-demand surfaces first (list view, map shell, filter drawer, the
add-address / list-details / notes dialogs). Those are built by `innerHTML` on
first open, so a sweep of the initial DOM alone undercounts — an earlier audit
found 7 controls on `index.html` where there are 9.

## Reading the output

For a pure-refactor claim, the only acceptable answer is `CHANGED
DECLARATIONS: 0`. For a deliberate change, every group must be one you can name
and defend. **A group you cannot explain is the regression.**

`WARNING: N controls present before but MISSING after` matters as much as a
changed value — it usually means the change broke the surface that renders them.

## Why it exists

A proposed `:where()` sweep over 61 container-scoped selectors was locally
tested, looked correct, and was reasoned about carefully. The diff showed it
changed **364 declarations**: `min-height: 44px -> 36px` on 54 controls (touch
targets under the minimum), plus silent reversals of two fixes that had shipped
that same day. It was reverted on the evidence rather than merged on the
reasoning, and the revert was confirmed with a third snapshot at 0 differences.
