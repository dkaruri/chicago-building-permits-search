# Chicago Building Permits Search — project guide for Claude

Static search/profile tool over the City of Chicago Building Permits dataset
(Socrata `ydr8-5enu`), published as a GitHub Pages static site and backed by a
Cloudflare Worker.

## Read this first
- **There is no Python, no DuckDB and no MCP server in this repo.** All of it —
  `src/chi_permits/`, `ingest.py`, `static_export.py`, `web.py`, `pyproject.toml`
  and the `refresh-pages-data.yml` workflow — was deleted in `42607fe`, "Delete
  dead Python pipeline and cron.js after Worker API migration". This section
  described that code for weeks after it was gone; if you are reading a claim
  here about a file, check it exists before believing it.
- The directory is still named `chicago-building-permits-mcp` for historical
  reasons only. If asked to "run the MCP server", say there isn't one.
- **Where the data actually comes from now:**
  - Permits — LIVE from Socrata. The Worker's `/api/permits` for the directory
    and the GC/open-sub card; `loadMapMonths` calls Socrata **directly** for the
    map, and `ensurePermitMap` does the same to rehydrate saved permits.
  - Profiles, contacts, stats — the Worker, reading KV that
    `.github/workflows/seed-kv.yml` reseeds daily at 10:00 UTC.
  - Lists, notes, tags, photos — the Worker (Durable Object + KV + R2).
  - `docs/data/` holds only what is genuinely static: `zoning.geojson` and
    `tif.geojson` (built by `scripts/build_zoning.py` / `build_tif.py`), plus
    `general_contractors.json` and `open_subs.json`, which are reached ONLY by
    `loadJson`'s fallback when the Worker is unreachable. `loadJson` throws for
    any other name, so no other file in there can ever be fetched — which is why
    the 378 MB of unreferenced exports were removed in 2026-08-11.
- Repo pushes to `https://github.com/dkaruri/chicago-building-permits-search`.

## Kanban board (cross-repo — dkaruri/kanban)
- The task board for this project lives OUTSIDE this repo:
  <https://github.com/dkaruri/kanban>, file `KANBAN.md`. Live view:
  <https://dkaruri.github.io/kanban/board.html>. It is the single source of
  truth for what to work on.
- Local convention: keep a sibling clone at `../kanban`. If missing, run
  `git clone https://github.com/dkaruri/kanban ../kanban`. ALWAYS
  `git -C ../kanban pull` before reading the board, and pull again right
  before pushing board updates.
- `KANBAN.md` opens with a CLAUDE CODE PROTOCOL comment block — follow it
  exactly: task selection is Fixes list → status todo → P0→P3 → oldest first
  unless the user names a list or ID; set in-progress before starting; stamp
  real Chicago time (`TZ=America/Chicago date '+%Y-%m-%d %H:%M CT'`); check
  off checklist items as completed; append a Log line per status change;
  never touch the Futures list, never delete tasks, never reuse IDs.
- **After completing any work in this repo that corresponds to a board task,
  updating the board is part of the task** — not optional: update status,
  checklist, Updated timestamp, and Log in `../kanban/KANBAN.md`, then commit
  (`board: <ID> <what changed>`) and push the kanban repo. If the work has no
  matching card, offer to add one.
- **Board-only requests are in scope for this project** — the user should
  never have to switch chats/projects to manage the board. Treat messages
  beginning with `kanban:` (e.g. `kanban: status`, `kanban: add fix — map
  popup clips on mobile, P1`, `kanban: mark FEAT-017 done`, `kanban: check
  off "Add export button" on FEAT-021`) as pure board operations: edit
  `../kanban/KANBAN.md` per the protocol, push, and make no changes in this
  repo. The board's own README and `CLAUDE_CODE_PROMPTS.md` (in the kanban
  repo) contain the full prompt patterns.
- Open one-time chore: tasks whose Log says "backfilled" carry placeholder
  dates — when asked, correct them from THIS repo's `git log` (first/last
  commit per feature) and record the correction in each task's Log.

## Site pages (`docs/`, each a large self-contained HTML+JS app, ~5,000+ lines)
- `index.html` — <https://dkaruri.github.io/chicago-building-permits-search/> —
  search directory: open permits, general contractors, open subs.
- `map.html` — <https://dkaruri.github.io/chicago-building-permits-search/map.html>
  — MapLibre permit map, and the ONLY page with a real map: `index.html` and
  `list.html` carry a vestigial 39-line `applyMapFilters` with none of the
  filter scaffolding, so every map filter feature (FEAT-024/038/040/047) landed
  here alone. `loadMapMonths` fetches the selected months **live from Socrata**
  — the old `docs/data/map/*.json` shards were superseded by that migration and
  deleted in 2026-08-11 (342 MB, zero references). Filters: issue-date range,
  GC open-job count, permit value, radius, neighborhood, property use, work-type
  exclusions, visited/called, and construction stage.
- `list.html` — <https://dkaruri.github.io/chicago-building-permits-search/list.html>
  — "My Permit List": user-curated saved permits carried over from `index.html`
  / `map.html`. Supports notes, reordering, drive-distance estimates, Google
  Maps route-chunk generation, and CSV/KML export. Persisted client-side
  (browser storage) — there is no backend/account system, so the list is local
  to one browser.
- `disclaimer.html` — <https://dkaruri.github.io/chicago-building-permits-search/disclaimer.html>
  — data-source and liability disclaimer, linked from site nav.
- All four pages share a `chi_permit_theme` light/dark preference key in
  `localStorage`; that's currently the only cross-page persisted state Claude
  found via search, aside from whatever `list.html` uses to hold the saved list
  itself.

## Architecture orientation
- **Contacts are pivoted in the Worker, not a database.** A permit carries 15
  `contact_N_*` slots; `worker/src/socrata.js::pivotContacts` flattens them, and
  `classifyContact` sorts each into `general_contractor` / `open_tech` / `other`
  from the raw `contact_type` string. That function is the single classifier —
  the old second, regex-on-the-name classifier died with the Python exporter.
- `worker/src/permits.js` builds an explicit SoQL `$select`. A column missing
  from that list is silently absent from every response, and a column present
  but unmapped is silently absent from the row — both invisible at runtime.
  `worker/test/permits-milestone.test.mjs` guards one such column; add a
  similar test when you add another.
- `worker/seed-kv.js` is the only thing that writes KV. It runs from
  `.github/workflows/seed-kv.yml`, never inside the Worker: it holds ~40,000
  permits and ~320,000 owner rows at once, far past the Worker's 128 MB limit.
  That workflow's header comment explains why the gap between runs IS the
  precision of the observed close-time metric.
- `worker/src/closure.js` and `principals.js` are reachable ONLY from
  `seed-kv.js`, not from any route. They are not dead — check before "cleaning
  them up".

## Running & testing
- Static site preview: `python -m http.server 8791 --directory docs`. **Use
  port 8791** — the Worker's `ALLOWED_ORIGIN` names it, and on any other port
  every API call is CORS-blocked while the map still works (it calls Socrata
  directly), which reads as a feature bug and is not one.
- Worker tests: `cd worker && node --test "test/*.test.mjs"` (282).
- Unit suites: `node --test verify-tmp/*.mjs` — **251 tests, green, ~42s**
  (baseline 2026-08-12). It had been red since `03bd149` and appeared to take
  over five minutes; both were the four `_`-prefixed one-off probes the glob
  sweeps up. Each now refuses to run under the runner
  (`if (process.env.NODE_TEST_CONTEXT)`) and prints how to run it directly —
  **keep that guard on every new `_`-prefixed script**, or the documented
  command goes red again for something that was never a test.
- Several suites (`feat024-impl`, `feat031-impl`, `feat035-impl`, …) EXTRACT
  functions out of `docs/*.html` by name and `eval` them, deliberately, so a
  test cannot agree with a stale hand-copy. The trap: the extractor pulls a
  **named list**, so when you make an already-extracted function call something
  new, add the callee to that list in the same change — otherwise it throws
  `X is not defined` in a file nobody is looking at. FEAT-046 and FEAT-047 each
  did this and left 13 tests red.
- Browser suites: `node verify-tmp/t<N>-*.js`. See
  [[chi-permits-headless-verify]] — they are gitignored and exist on one
  machine only (tracked as FIX-020).
- **Enable the pre-commit guard in a fresh clone:** `git config core.hooksPath
  scripts/hooks`. It blocks a commit that would introduce an invisible 0x08 or
  NUL byte into tracked source (FIX-030 — the class has bitten this repo four
  times). Git never installs hooks automatically, so this one command is
  required per clone; `worker/test/control-bytes.test.mjs` is the always-on
  guard and does NOT depend on it. If `core.hooksPath` ever points at a
  directory that does not exist, git runs no hook and says nothing — that test
  catches it.

## Automation
- `.github/workflows/seed-kv.yml` is the ONLY workflow. It runs daily at 10:00
  UTC and on manual dispatch: unit tests, then `npm run seed` into PRODUCTION
  KV, then a `curl` against the deployed API that fails the build if the live
  `seeded_at` is over 90 minutes old — it verifies at the destination, not at
  the build, because the seed script has reported success against a local
  simulation before.
- `refresh-pages-data.yml` no longer exists; it was deleted in `42607fe` along
  with the Python pipeline it drove. Nothing regenerates `docs/data/*.json` any
  more, which is fine — the only files left there are static reference geography
  and the two profile fallbacks.
- The Worker has NO cron. `[triggers]` and its empty `scheduled()` handler were
  removed 2026-08-11: the seed cannot run inside a Worker (memory limits), so
  the trigger fired daily into a no-op.

## Data caveats (baked into `dataset_info_from` — keep authoritative)
- `reported_cost` is applicant-reported, not audited.
- Only public contact fields are available (name/type/city/state/ZIP) — no
  phone/email in the source; phones shown in exports come from the separate
  licensed-contractor match, not the permits dataset.
- "Open" means `permit_status` in `ACTIVE`, `SUSPENDED`, `PHASED PERMITTING` —
  this exact tuple is repeated across `config.OPEN_STATUSES`,
  `tools/permits.py::OPEN_STATUS_SQL`, and inline elsewhere; keep them
  consistent if the definition ever changes.

## Workflow
- Tests should pass before landing; one PR/commit per change where practical.
- Check `git status` before assuming HEAD reflects deployed behavior — this
  repo frequently carries uncommitted work in progress.
- **Every finished feature branch merges into `integration` (standing
  instruction, 2026-08-11).** `main` is what GitHub Pages serves, so nothing
  reaches it without Divyam's explicit approval — but that left work stranded on
  branches with no single place to try it. `integration` is that place: a
  long-lived branch holding `main` plus everything built and verified but not yet
  shipped.
  - The moment a feature branch's own verification is green, merge it in and push:
    `git checkout integration && git merge --no-ff <branch> && git push`.
    Do this WITHOUT being asked — it is part of finishing the work, like updating
    the board.
  - Re-run the suites on `integration` after the merge, not just on the feature
    branch. A clean merge is not evidence: FIX-045 and FEAT-046 both edit
    `fillPermitGeo`, and the only proof they coexist is running them together.
  - Tell Divyam the branch is testable and on which URL. The local preview serves
    whatever is checked out, so leave `integration` checked out when handing over.
  - `integration` NEVER merges back into a feature branch and is never the base for
    new work — cut new branches from `main`, or from the one feature they depend on.
    It is a testing vehicle, not a trunk.
- **Local preview is not deploy-faithful by default.** Pages serves `main` +
  `/docs` only, so a branch is never live at the public URL, and the Worker's
  `ALLOWED_ORIGIN` must name the origin you are testing from or every API call is
  CORS-blocked while the map still works (it calls Socrata directly) — which looks
  like a feature bug and is not. `http://localhost:8791` is in the allowlist;
  serve on that exact port: `python -m http.server 8791 --directory docs`.
- **UI/UX Pro Max on every new UI feature (standing instruction, 2026-07-23;
  extended to design time 2026-07-27).** Invoke the `ui-ux-pro-max` skill TWICE
  on any change that adds or reworks user-facing UI on `docs/*.html`:
  1. **While designing** — before a spec or plan is written, so accessibility and
     mobile constraints shape the design instead of being retrofitted. Fold the
     findings into the spec as build requirements, and record any deliberate
     deviations. A design doc for a UI feature counts as UI work.
  2. **Before landing** — verify the built result against the checklist:
  ≥44px touch targets on mobile, visible labels/aria-labels on every control,
  focus states, 4.5:1 contrast in BOTH light and dark, no meaning by colour alone,
  no sub-16px inputs (iOS zoom), and reduced-motion respected. Verify headless at
  desktop AND an iPhone 13 viewport (assert geometry, not just DOM presence — see
  the headless recipe). The repo's a11y sweep pattern (unnamed buttons, unlabeled
  inputs, missing alt, sub-44px targets across each overlay) lives in the session
  scratchpad `audit.mjs`; re-run it against new surfaces.
- **Editing `docs/*.html`: never via a bash heredoc.** Heredocs silently embed
  invisible control bytes (0x08 backspace, lone surrogates) that break regexes and
  strings without showing in diffs — this bit the project three times. Use the Edit
  tool, or a Python script that reads bytes and asserts
  `count(b"\x08")==0 and count(b"\x00")==0` before writing. Match literal `\uXXXX`
  source text with a RAW python string; write astral emoji as `\U0001F4AC`, never
  `💬` (a lone surrogate throws on `.encode("utf-8")`).
- **Overlay code is byte-identical across `list.html` and `index.html`** by design;
  change both and verify the shared block matches — compare RAW BYTES, not text,
  or a line-ending difference passes as a match.
- **All three pages are CRLF in the working tree** (re-measured 2026-08-10:
  index 7,811/7,811, list 10,818/10,818, map 7,601/7,601), and `core.autocrlf`
  is `true`. This line previously claimed index and map were LF; that was wrong
  and cost a code review a false Critical before it was measured. Two
  consequences: a multi-line search anchor written with `\n` silently never
  matches, and a blob can still hold stray bare LF from an earlier commit — check
  with `git diff --ignore-cr-at-eol` before believing an unexplained hunk.
