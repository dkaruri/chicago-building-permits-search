# Chicago Building Permits Search

Static search and profile tool for the City of Chicago Building Permits dataset:

<https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu>

The project downloads permit records into a local DuckDB database, builds compact JSON indexes, and publishes a GitHub Pages search experience for:

- Open permits (`ACTIVE`, `SUSPENDED`, `PHASED PERMITTING`)
- General Contractors, limited to company-like names
- Open Subs, limited to person-like public contact names
- A searchable MapLibre permit map that defaults to current-month open permits

For each profile, the site shows public portal contact fields, open jobs, total jobs, average positive permit processing days, specialization summaries, and matched City licensed contractor records when available.

## Hosted Tool

- Search directory: <https://dkaruri.github.io/chicago-building-permits-search/>
- Permit map: <https://dkaruri.github.io/chicago-building-permits-search/map.html>

GitHub Pages uses generated JSON indexes from `docs/data/`:

- `docs/data/open_permits.json`
- `docs/data/general_contractors.json`
- `docs/data/open_subs.json`
- `docs/data/contractor_licenses.json`
- `docs/data/permit_map_index.json`
- `docs/data/map/permits_YYYY_MM.json`
- `docs/data/manifest.json`

## Refresh Data

```powershell
uv sync
uv run chi-permits init
uv run chi-permits export-static
uv run python scripts/accuracy_check.py
```

The workflow at `.github/workflows/refresh-pages-data.yml` runs on a daily schedule and can also be triggered manually. It downloads the latest Chicago Data Portal records from the Socrata API, exports the static JSON files and monthly map shards, fetches the City licensed contractor registries, runs the accuracy check, and commits changes back to the repo so Pages rebuilds.

The accuracy check compares the local DuckDB row counts, generated JSON indexes, live Chicago Data Portal permit counts, and live City licensed contractor registry counts.

## Local Preview

```powershell
python -m http.server 8765 --directory docs
```

Open:

```text
http://127.0.0.1:8765
```

## Notes

`reported_cost` is applicant-reported. Treat extreme values as data-quality outliers unless confirmed from another source.

Contact information is limited to public fields provided by the Chicago Data Portal: contact type, name, city, state, and ZIP code. Phone and email are not present in the source dataset.
