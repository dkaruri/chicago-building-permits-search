# Chicago Building Permits Search — project guide for Claude

Static search/profile tool over the City of Chicago Building Permits dataset
(Socrata `ydr8-5enu`), backed by a local DuckDB and published as a GitHub Pages
static site.

## Read this first
- Despite the directory name (`chicago-building-permits-mcp`) and the original
  task that created it ("install the MCP server at ..."), **there is no MCP
  server wired up in this codebase**. `src/chi_permits/tools/` (`permits.py`,
  `sql.py`) contains MCP-tool-shaped read functions, but nothing registers them
  with `mcp`/`FastMCP`/stdio — they're called directly by `web.py` (the
  Starlette local preview app). If asked to "run the MCP server," confirm
  that's actually wanted: the current live product is the static GitHub Pages
  site, not an MCP server.
- Goal: surface City of Chicago Building Permits data (open permits, general
  contractors, open subs) as a fast static search/browse tool, not an MCP
  server. Repo pushes to
  `https://github.com/dkaruri/chicago-building-permits-search`.
- `README.md` documents refresh commands and data files — keep it in sync with
  `static_export.py`'s output when JSON files are added or renamed.

## Site pages (`docs/`, each a large self-contained HTML+JS app, ~5,000+ lines)
- `index.html` — <https://dkaruri.github.io/chicago-building-permits-search/> —
  search directory: open permits, general contractors, open subs.
- `map.html` — <https://dkaruri.github.io/chicago-building-permits-search/map.html>
  — MapLibre permit map. Lets a user filter by issue-date range
  (`settings.dateFrom`/`dateTo`) and by general-contractor open-job-count range,
  reading from the monthly `docs/data/map/permits_YYYY_MM.json` shards.
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
- Two DuckDB tables: `permits` (one row per permit) and `contacts` (pivoted
  from the permit's 15 `contact_N_*` slots into one row per contact per
  permit). `ingest.py::_contact_category_expr` classifies each contact into
  `general_contractor` / `open_tech` / `other` from the raw `contact_type`
  string.
- **Company vs. person classification is decided twice, two different ways** —
  know which one a given code path uses before changing either:
  - `ingest.py` derives the DB-level `contact_category` from a keyword match
    on `contact_type`.
  - `static_export.py`'s `_company_name_condition` / `_person_name_condition`
    regexes re-derive company-like vs. person-like straight from the
    `contact_name` string when building exported profile JSON.
- Ingest (`ingest.py::run_ingest`) always builds into a `*.shadow.duckdb` file,
  then atomically replaces the live `var/permits.duckdb`. Never open the live
  DB read-write directly while diagnosing something live.
- Full ingest paginates the Socrata CSV export (`PAGE_SIZE=50000`); when run
  without `limit`, it also does a recent-issue-date backfill (default last 45
  days, `CHI_PERMITS_RECENT_BACKFILL_DAYS`) to catch late-arriving rows.
- `static_export.py` writes `docs/data/{open_permits,general_contractors,
  open_subs,contractor_licenses,manifest}.json` plus monthly map shards
  `docs/data/map/permits_YYYY_MM.json`. It cross-references contractor names
  against `licensed_contractors.py`'s scrape of the City's licensed-contractor
  lookup (multiple trade categories) via `normalize_license_name`, to attach
  phone numbers where names match.
- `tools/sql.py::run_sql_on` is a read-only, single-SELECT/WITH SQL sandbox
  (regex-blocks mutating keywords, 100-row cap, 30s timeout) — reuse it rather
  than writing a new ad hoc query runner if arbitrary read access is needed.

## Running & testing
- `uv sync`, then `uv run chi-permits init` (first load) / `uv run chi-permits
  update` (refresh) / `uv run chi-permits export-static` (regenerate
  `docs/data/*.json`) / `uv run chi-permits status`.
- Local web preview: `uv run chi-permits-web` (Starlette + uvicorn on `:8765`)
  — separate from the static Pages site; queries the live DuckDB directly.
- Static site preview: `python -m http.server 8765 --directory docs`.
- Tests: `uv run pytest` (currently only covers `tools/sql.py`'s validator).
- `scripts/accuracy_check.py` cross-checks local DuckDB counts, exported JSON
  counts, live Socrata counts, and live City license-registry counts — run
  after any ingest or export change.

## Automation
- `.github/workflows/refresh-pages-data.yml` runs on a schedule (targeting
  midnight/6am/noon America/Chicago, expressed as multiple UTC cron lines to
  cover DST) and on manual dispatch: `chi-permits init` → `export-static` →
  `accuracy_check.py` → auto-commits `docs/data/**/*.json`.

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
- **UI/UX Pro Max on every new UI feature (standing instruction, 2026-07-23).**
  Any change that adds or reworks user-facing UI on `docs/*.html` must invoke the
  `ui-ux-pro-max` skill and verify the result against its checklist BEFORE landing:
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
  change both and verify the shared block matches. Stage `list.html` with
  `git -c core.autocrlf=false add` (its blob is CRLF; index/map are LF).
