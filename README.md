# Chicago Building Permits Search

Static search and profile tool for the City of Chicago Building Permits dataset:

<https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu>

The project downloads permit records into a local DuckDB database, builds compact JSON indexes, and publishes a GitHub Pages search experience for:

- Open permits (`ACTIVE`, `SUSPENDED`, `PHASED PERMITTING`)
- General Contractors, limited to company-like names
- Open Subs, limited to person-like public contact names

For each profile, the site shows public portal contact fields, open jobs, total jobs, average positive permit processing days, and specialization summaries.

## Hosted Tool

<https://dkaruri.github.io/chicago-building-permits-search/>

GitHub Pages uses generated JSON indexes from `docs/data/`:

- `docs/data/open_permits.json`
- `docs/data/general_contractors.json`
- `docs/data/open_subs.json`
- `docs/data/manifest.json`

## Refresh Data

```powershell
uv sync
uv run chi-permits init
uv run chi-permits export-static
```

The workflow at `.github/workflows/refresh-pages-data.yml` runs on a daily schedule and can also be triggered manually. It downloads the latest Chicago Data Portal records, exports the static JSON files, and commits changes back to the repo so Pages rebuilds.

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
