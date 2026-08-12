# Browser and unit suites

The tests for `docs/*.html`. Until FIX-020 these lived in the gitignored
`verify-tmp/`, so they existed on exactly one machine, were never reviewable in
a diff, and nothing stopped them rotting — `t2`, `t6` and `t8b` sat red for
weeks because `_boot.js` drifted behind the multi-list rework and no commit ever
showed it.

`verify-tmp/` still exists and is still ignored. It is **scratch only** now:
screenshots, traces, run logs, and one-off probes.

## Run them

```bash
node tests/browser/run.js              # every self-contained browser suite
node tests/browser/run.js t8           # just the ones whose name contains "t8"
node tests/browser/run.js --units      # the .mjs unit set (fast, no browser)
node tests/browser/run.js --all        # units, then the browser suites
node tests/browser/run.js --list       # names only
node tests/browser/run.js --network    # ALSO the suites that hit the internet
```

The runner starts `python -m http.server 8791 --directory docs` if nothing is
already serving that port, and stops it again afterwards. **Port 8791 is not
arbitrary** — the Worker's `ALLOWED_ORIGIN` names it, and on any other port every
API call is CORS-blocked while the map still works, which reads as a feature bug
and is not one.

A single suite runs standalone, with the server already up:

```bash
python -m http.server 8791 --directory docs &
node tests/browser/t83-count-overflow.js
```

Suites are plain Node scripts: they print `ok` / `FAIL` per assertion and exit
non-zero if anything failed.

## Prerequisites

```bash
cd tests/browser && npm install     # Playwright, pinned by package-lock.json
npx playwright install chromium     # the browser itself
```

`_boot.js` resolves Chromium in this order: `$CHROME`, then Playwright's own
`chromium.executablePath()`, then the cached `chromium_headless_shell-1228`
build this repo has used all along. If none exists it says so and exits 2,
rather than failing several frames deep inside Playwright.

To use a browser you already have:

```bash
CHROME=/path/to/chrome-headless-shell node tests/browser/t83-count-overflow.js
```

**WebKit** is only needed by `t36-webkit-scroll.js`. `npx playwright install
webkit` has stalled here; fetch the build zip from the Playwright CDN and
unpack it into the Playwright browsers directory by hand.

## Which suites are which

| Kind | Pattern | Notes |
|---|---|---|
| Browser suites | `t*.js` | Playwright, driven through `_boot.js` |
| Unit suites | `*.mjs` | `node --test`, no browser, ~42s for all 251 |
| Mutation controls | `*mutants*.js` | **Excluded from the sweep** — see below |
| One-off probes | `_*.mjs` | Self-skip under `node --test`; run directly |

**Mutation controls rewrite `docs/*.html` while they run.** They restore the
file in a `finally`, but nothing else can run at the same time — a sibling suite
reading a mutated page fails on a mutant it never asked for. `run.js` leaves
them out; run one at a time, deliberately:

```bash
node tests/browser/t78-mutants.js
```

**One-off probes** (`_feat032-mutants.mjs`, `_feat039-kprobe.mjs`,
`_feat039-realgeo.mjs`, `_probe-assessor.mjs`) carry a
`process.env.NODE_TEST_CONTEXT` guard so `node --test` skips them: one hits the
live network, one burns minutes of CPU, one reads a data directory that was
deleted in `03bd149`. **Keep that guard on every new `_`-prefixed script**, or
the unit command goes red for something that was never a test.

## Suites that are not self-contained

Excluded from the default sweep so a red run means the product broke, not that
the network was slow. Run with `--network`.

| Suite | Why |
|---|---|
| `t14-live.js` | reaches the real Socrata / Worker network |
| `t30-share-live.js` | publishes against the deployed Worker |
| `t79-live-close.js` | closes cards against the **deployed** site |

Several suites also accept `BASE` to run against a deployment instead of the
local preview — that is how a card gets closed against the live site:

```bash
BASE=https://dkaruri.github.io/chicago-building-permits-search node tests/browser/t83-count-overflow.js
```

## Writing one

- `require("./_boot")` gives you `chromium`, `CHROME`, `openList`,
  `seedSavedList`.
- Wait on `body[data-ready]`, never on `typeof someFunction !== "undefined"` —
  declarations hoist, so that fires before `init()` has run and init's async
  tail then overwrites whatever the test seeded. That one race caused three
  separate flakes before it was named.
- Assert **geometry**, not just DOM presence, for anything about layout, and
  check desktop *and* an iPhone 13 viewport (390x844).
- Drive the keyboard with real keys (`page.keyboard.press("Tab")`), not
  `.click()` / `.focus()`, whenever the tab order or a focus ring is the subject.
- Show the probe can report success before trusting a failure, and prove a new
  assertion is worth having by making it fail — a mutant, or the pre-fix build.
- Scratch output (screenshots, traces) goes to `verify-tmp/`, which is ignored.
  Suites run from the repo root, so a plain `verify-tmp/name.png` path works.
