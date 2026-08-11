# Chicago Building Permits Search

A search, mapping, and field-work tool built on the City of Chicago Building Permits
dataset ([Socrata `ydr8-5enu`](https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu)).

It answers three questions that the raw dataset makes hard: **which permits are
currently open**, **who the general contractor is**, and **which trades on a job
have no contractor attached yet**. Around that it adds contractor profiles,
licence matching, an interactive map, and shared permit lists with real-time
collaboration.

**Live:**
[Search directory](https://dkaruri.github.io/chicago-building-permits-search/) ·
[Permit map](https://dkaruri.github.io/chicago-building-permits-search/map.html) ·
[My Permit List](https://dkaruri.github.io/chicago-building-permits-search/list.html) ·
[Disclaimer](https://dkaruri.github.io/chicago-building-permits-search/disclaimer.html)

---

## Contents

- [Scale](#scale)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [The four surfaces](#the-four-surfaces)
- [Derived data: how the interesting numbers are made](#derived-data-how-the-interesting-numbers-are-made)
- [API](#api)
- [Repository layout](#repository-layout)
- [Running locally](#running-locally)
- [Automation](#automation)
- [Data sources and caveats](#data-sources-and-caveats)
- [Known gaps](#known-gaps)
- [Licence](#licence)

---

## Scale

Figures measured against the live Socrata dataset (`ydr8-5enu`):

| | |
|---|---|
| Permit rows ingested | 841,358 |
| Coverage | 2006-01-03 → present |
| Open permits | 40,181 |
| General contractor profiles | 21,622 |
| Open sub profiles | 10,978 |
| Licensed-contractor records | 17,185 across 6 trade categories |
| Monthly map shards | 247 |
| Published JSON | ~67 MB of indexes, plus sharded map data |

---

## Architecture

Three tiers, deployed independently.

```
  City of Chicago                    Chicago licensed-contractor
  Socrata API (ydr8-5enu)            registry (6 trade categories)
        │                                       │
        ├───────────────┬───────────────────────┤
        │               │                       │
        ▼               ▼                       ▼
  ┌──────────────┐   ┌──────────────────────────────────┐
  │ Python /     │   │ seed-kv.js (Node)                │
  │ DuckDB       │   │ run daily by GitHub Actions      │
  │ pipeline     │   └──────────────┬───────────────────┘
  │ (see note)   │                  │
  └──────┬───────┘                  ▼
         │              ┌────────────────────────────┐
         │              │ Cloudflare Workers         │
         │              │ chi-permits-api            │
         ▼              │                            │
  ┌──────────────┐      │  KV      profiles, licences,│
  │ docs/data/   │      │          closure log        │
  │ static JSON  │      │  R2      permit photos      │
  │ + map shards │      │  DO      ListRoom — live    │
  └──────┬───────┘      │          list sync over WS  │
         │              └──────────────┬─────────────┘
         │                             │
         └──────────────┬──────────────┘
                        ▼
              ┌──────────────────────┐
              │ GitHub Pages         │
              │ index / map / list   │
              │ vanilla JS + MapLibre│
              └──────────────────────┘
```

**Why split this way.** Bulk permit data is large, slow-changing, and identical
for every visitor, so it is precomputed into static JSON and served from Pages
for free at CDN speed. Anything user-specific or mutable — saved lists, notes,
photos, tags, presence — needs a backend, so it lives in a Worker at the edge.
Neither tier blocks the other: the site still loads and searches if the API is
down; the API still serves lists if the static export is stale.

> **Note on the ingestion pipeline.** The Python/DuckDB pipeline described below
> is not currently committed to this repository — it runs locally and its output
> (`docs/data/*.json`) is what ships. Treat the pipeline sections as a
> description of how the published data is produced, not as something you can
> clone and run today. The Node seed path (`worker/seed-kv.js`) **is** committed
> and runs in CI.

---

## Tech stack

| Layer | Technology |
|---|---|
| **Languages** | Python, JavaScript (ES modules), SQL, HTML/CSS |
| **Ingestion** | Socrata CSV export API, paginated at 50,000 rows |
| **Analytical store** | DuckDB — two tables, `permits` and a pivoted `contacts` |
| **Python tooling** | `uv` for dependency and script management; `pytest`; Starlette + uvicorn for a local preview server |
| **Edge API** | Cloudflare Workers (`chi-permits-api`), plain `fetch` handler with regex routing |
| **Edge storage** | Workers KV (profiles, licence matches, closure log), R2 (photos), Durable Objects with SQLite (`ListRoom`) |
| **Real-time** | WebSocket upgrade routed directly to the list's Durable Object; presence and revision tracking |
| **Frontend** | Vanilla JavaScript, no framework or build step — three self-contained HTML apps |
| **Mapping** | MapLibre GL; monthly GeoJSON shards; zoning and TIF overlay layers |
| **Hosting** | GitHub Pages (static), Cloudflare Workers (API) |
| **CI** | GitHub Actions — tests gate a production KV write, followed by live read-back verification |
| **Tests** | `node --test` for the Worker (10 suites), `pytest` for the pipeline |

Deliberately absent: no framework, no bundler, no npm dependencies in the
frontend. `wrangler` is the only devDependency in the whole project.

---

## The four surfaces

**`index.html` — search directory.** Open permits, general contractors, and open
subs in one searchable index. Contractor profiles show public portal contact
fields, open jobs, total jobs, specialisation summaries, open-permit age, and
matched City licence records with phone numbers where a name match exists.

**`map.html` — permit map.** MapLibre map defaulting to the current month's open
permits. Filters by issue-date range and by a general contractor's open-job
count. Reads monthly shards so the browser never loads 247 months of geometry at
once. Zoning and TIF district overlays are available as additional layers.

**`list.html` — My Permit List.** The field-work surface. Curate permits from
either of the above, then add notes and photos, tag them, mark visited/called,
reorder, estimate drive distances, generate chunked Google Maps routes, and
export CSV/KML. Lists are shareable by link, and multiple people viewing the
same list see each other's presence and edits live over a WebSocket.

**`disclaimer.html`** — data-source provenance and liability notice.

All pages share a `chi_permit_theme` light/dark preference. UI work follows a
standing accessibility bar: ≥44px touch targets, labels on every control, 4.5:1
contrast in both themes, no sub-16px inputs (iOS zoom), reduced-motion respected,
verified headless at both desktop and iPhone 13 viewports.

---

## Derived data: how the interesting numbers are made

Most of the value here is inference. The source dataset does not contain "open
subs", "time to close", or a contractor's licence — each is constructed.

### Open permits

`permit_status` in `ACTIVE`, `SUSPENDED`, or `PHASED PERMITTING`. This tuple is
the definition of "open" throughout the codebase and must stay consistent
wherever it appears.

### General contractors vs. open subs

Each permit carries up to 15 `contact_N_*` slots, pivoted into one row per
contact per permit. Classification happens in two places, by two different
methods — worth knowing which a code path uses:

1. **At ingest**, `contact_category` is derived from a keyword match on the raw
   `contact_type` string, producing `general_contractor` / `open_tech` / `other`.
2. **At export**, company-like vs. person-like is re-derived by regex on the
   `contact_name` string when building profile JSON.

An "open sub" is a trade contact on an open permit whose name reads as a person
rather than a company. This is a heuristic, not a published field.

### Time to close — an observed metric

The dataset makes closure knowable as a *state* (`COMPLETE`) but never records
*when* the state changed. Socrata's row-level `:updated_at` is not a substitute:
permits issued in 2020 all share a single bulk re-upload timestamp. No
inspections dataset links a permit to a final inspection.

So two distinct metrics are published:

- **Open age** — exact and immediate. How long a contractor's currently-open
  permits have been open.
- **Time to close** — *observed*. Each daily seed snapshots the open set. A
  permit that has left the open set and now reads `COMPLETE` closed somewhere
  between the two runs, and is booked as `issue_date → observation date`.

This is why the daily cadence matters beyond freshness: **the gap between runs is
the precision of the metric.** Running it by hand every few weeks would round
every closure to weeks.

Guards worth noting: permits that left the open set as `EXPIRED`, `CANCELLED`, or
`REVOKED` are excluded — work stopping is not work finishing. A contractor
holding several slots on one permit counts once. Contractors with no observations
get no key at all rather than a zero, because the UI keys off absence and for
months after launch that will be nearly everyone. Stats are stored aggregated per
contractor (`{n, days}`) so the KV value is bounded by contractor count rather
than growing forever.

### Licence matching

Contractor names from permits are normalised and matched against a scrape of the
City's licensed-contractor lookup across six categories — all trades, general,
electrical, plumbing, mason, and elevator. Where a name matches, a phone number
is attached. **Phone numbers come from the licence registry, never from the
permits dataset**, which contains no contact numbers at all.

---

## API

Base: `https://chi-permits-api.<account>.workers.dev`

```
GET    /api/permits?q=&ward=&status=&type=&limit=&offset=
GET    /api/profiles?category=general_contractor|open_tech
GET    /api/contact/:name
GET    /api/stats

GET    /api/lists?q=&tag=&cursor=        -> {lists, cursor}
POST   /api/lists                        -> {id}
GET    /api/lists/:id                    -> {permits, focal, desc, custom, ticks, fu, called, meta}
PUT    /api/lists/:id                    -> {id, rev}
PUT    /api/lists/:id/ticks|/follow|/called
DELETE /api/lists/:id                    -> soft delete, 30-day trash
GET    /api/lists/:id/live               -> WebSocket live sync

GET    /api/tags                         PUT /api/tags
GET    /api/notes/:permit                POST /api/notes/:permit
PUT    /api/notes/:permit/:id            DELETE /api/notes/:permit/:id
GET    /api/notes/counts?p=a,b,c         GET /api/notes/bulk?p=a,b,c

POST   /api/photo/:permit                GET|DELETE /api/photo/:permit/:id
```

CORS is locked to the Pages origin via `ALLOWED_ORIGIN`. The WebSocket upgrade
bypasses the CORS wrapper so the Durable Object's 101 response is returned
untouched.

---

## Repository layout

```
docs/                 GitHub Pages site (the deployed frontend)
  index.html          search directory
  map.html            MapLibre permit map
  list.html           My Permit List
  disclaimer.html
  assets/
  data/               only what is genuinely static
    zoning.geojson      reference geography, built by scripts/build_zoning.py
    tif.geojson         reference geography, built by scripts/build_tif.py
    general_contractors.json   fallback, used only when the Worker is unreachable
    open_subs.json             fallback, same

worker/               Cloudflare Worker — the API tier
  src/
    index.js          router, CORS, WebSocket upgrade
    permits.js        permit queries
    profiles.js       contractor profiles and contact detail
    licenses.js       licence registry matching
    principals.js     person-in-charge resolution
    closure.js        observed close-time metric
    lists.js          shared permit lists
    list-room.js      Durable Object — live sync
    presence.js       who is viewing a list
    revisions.js      list revision tracking
    notes.js          per-permit notes
    photos.js         R2-backed photo storage
    tags.js  stats.js  socrata.js  list-doc.js
  test/               10 suites, node --test
  seed-kv.js          rebuilds profiles/licences/closure log into production KV
  wrangler.toml

scripts/
  build_zoning.py     generates docs/data/zoning.geojson
  build_tif.py        generates docs/data/tif.geojson

.github/workflows/
  seed-kv.yml         daily KV seed, gated on tests, verified against live API

CLAUDE.md             working notes and conventions for AI-assisted development
```

---

## Running locally

**Static site:**

```bash
python -m http.server 8765 --directory docs
# http://127.0.0.1:8765
```

**Worker API:**

```bash
cd worker
npm ci
npm run dev          # wrangler dev
npm test             # node --test "test/*.test.mjs"
npm run deploy       # wrangler deploy
npm run tail         # live logs
```

Seeding production KV requires `CLOUDFLARE_API_TOKEN` (scoped to Account →
Workers KV Storage → Edit) and `CLOUDFLARE_ACCOUNT_ID`. Local Worker secrets go
in `.dev.vars`, which is gitignored and must never be committed.

**Overlay layers:**

```bash
python scripts/build_zoning.py
python scripts/build_tif.py
```

---

## Automation

`.github/workflows/seed-kv.yml` runs daily at 10:00 UTC — after the City's
overnight dataset refresh, before the Chicago working day — and on manual
dispatch.

The seed cannot run inside the Worker's own cron despite `wrangler.toml`
declaring one. It holds roughly 40,000 permit rows and 320,000 business-owner
rows in memory simultaneously, well past the 128 MB Worker limit, and its
paginated Socrata fetches plus the six-category licence scrape push against the
subrequest cap. It runs in Actions instead, where neither limit applies.

The workflow is built around the fact that it **writes directly to production
KV**:

- **Concurrency group, `cancel-in-progress: false`.** Two seeds must never
  overlap — both read the previous closure snapshot then write a new one, so
  interleaved runs would silently lose every closure detected in between. Queue
  rather than cancel; a half-finished seed killed mid-upload is exactly the
  partial state to avoid.
- **Unit tests run before the write.** Failing before costs nothing; failing
  after means bad data is already live.
- **Credential preflight.** Catches the real failure mode of a token pasted as
  the secret *name*, which leaves the variable unset while `gh secret list` looks
  populated.
- **Read-back verification.** The seed script reports success even when wrangler
  has written to a local simulation, which has bitten this project before. The
  final step curls the deployed API and fails if `seeded_at` is more than 90
  minutes old or expected fields are missing.

One related hazard is documented in `closure.js`: reading the previous snapshot
inside a bare `catch { return null }` made "no credentials" indistinguishable
from "first run ever", which would have overwritten the entire closure history
with an empty object while reporting success. `isKeyMissingError` now
distinguishes the two.

---

## Data sources and caveats

**Sources**

- [Chicago Building Permits](https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu) (Socrata `ydr8-5enu`)
- [Chicago licensed contractor lookup](https://webapps1.chicago.gov/licensedcontractors/active) — 6 trade categories
- Chicago zoning districts and TIF district boundaries

**Caveats**

- `reported_cost` is applicant-reported and not audited. Treat extreme values as
  data-quality outliers unless confirmed elsewhere.
- The permits dataset exposes only public contact fields: contact type, name,
  city, state, ZIP. **No phone or email exists in the source.** Phone numbers
  shown come from the separate licensed-contractor match.
- "Open sub" is a derived heuristic, not a published field. It infers that a
  trade has no contractor attached from the *absence* of a contact, which can
  also mean a separate permit exists, the GC self-performs, or the field simply
  was not filled in.
- Time to close is observed from the seed cadence forward and is blind to
  everything that closed before observation began.
- This is a research and lead-generation aid over public records. It is not an
  authoritative record of permit status — verify against the City before acting.

---

## Known gaps

Tracked on a separate board: [dkaruri/kanban](https://github.com/dkaruri/kanban)
· [live view](https://dkaruri.github.io/kanban/board.html)

- The Python ingestion pipeline is not committed to this repository.
- The browser test suite exists on one machine and is gitignored.
- Committed `pytest` coverage reaches only the read-only SQL validator.
- The GC/open-sub classification has no measured precision or recall.
- Presence lifecycle is unreliable when a mobile tab is backgrounded —
  `pagehide` does not always close the socket, so viewer counts drift.
- Company-vs-person classification is implemented twice, by different methods,
  in ingest and export.

---

## Licence

MIT. See [LICENSE](LICENSE).

Permit and licence data is published by the City of Chicago and remains subject
to the City's terms of use.
