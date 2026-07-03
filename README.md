# Chicago Building Permits MCP

A local MCP server over the City of Chicago Building Permits Socrata dataset:

<https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu>

The server ingests permit records into a local DuckDB database and exposes permit-aware tools for lookup, recent permits, trends, breakdowns, rankings, and read-only SQL.

## Install

```powershell
uv sync
uv run chi-permits init
uv run chi-permits status
```

For a small smoke-test database:

```powershell
uv run chi-permits init --limit 50000
```

## MCP Client

The server speaks stdio. Use absolute paths in GUI client configs:

```json
{
  "mcpServers": {
    "chi-permits": {
      "command": "C:\\Users\\divya\\.local\\bin\\uv.exe",
      "args": [
        "run",
        "--directory",
        "C:\\path\\to\\chicago-building-permits-mcp",
        "chi-permits-server"
      ],
      "env": {
        "PYTHONPATH": "C:\\path\\to\\chicago-building-permits-mcp\\src"
      }
    }
  }
}
```

## Tools

- `dataset_info`
- `permit_lookup`
- `recent_permits`
- `permit_breakdown`
- `permit_trends`
- `top_permits`
- `open_permits`
- `general_contractors`
- `open_techs`
- `contact_detail`
- `run_sql`

## Web Tool

Run the local web search tool:

```powershell
uv run chi-permits-web
```

Open:

```text
http://127.0.0.1:8765
```

The web tool searches:

- Open permits (`ACTIVE`, `SUSPENDED`, `PHASED PERMITTING`)
- General Contractors
- Open technical/trade contacts: contractors, architects, engineers, expediters, and masons

For each contact, it shows public portal contact fields, open jobs, total jobs, and average permit processing days.
Click a contact to open a profile with specialization summaries:

- Most common work types
- Permit type mix
- Public contact role mix

These are derived from the permits associated with that contact.

When the web tool checks `/api/status`, it compares the local ingest timestamp to the Chicago Data Portal metadata. If the portal has newer rows, it automatically starts a background refresh. You can also trigger refresh manually with the button in the UI.

## GitHub Pages Static Tool

The repository also publishes a static search tool from `docs/`:

<https://dkaruri.github.io/chicago-building-permits-mcp/>

GitHub Pages cannot run Python, DuckDB, or an MCP server directly, so the hosted tool uses generated JSON indexes:

- `docs/data/open_permits.json`
- `docs/data/general_contractors.json`
- `docs/data/open_techs.json`
- `docs/data/manifest.json`

Build or refresh those files locally:

```powershell
uv run chi-permits init
uv run chi-permits export-static
```

The workflow at `.github/workflows/refresh-pages-data.yml` runs on a daily schedule and can also be triggered manually. It downloads the latest Chicago Data Portal records, exports the static JSON files, and commits changes back to the repo so Pages rebuilds.

## Notes

This is independent from the NYC Capital Projects MCP. It uses Chicago permit concepts: permit number, permit type/status, issue date, work type, reported cost, fees, ward, community area, address, coordinates, and normalized public contact slots.

`reported_cost` is applicant-reported. Treat extreme values as data-quality outliers unless confirmed from another source.

Contact information is limited to public fields provided by the Chicago Data Portal: contact type, name, city, state, and ZIP code. Phone/email are not present in the source dataset.

## Verification

The MCP verifier starts the stdio server, lists tools, and calls `dataset_info`, `top_permits`, and `permit_trends`:

```powershell
uv run python ..\verify_chi_permits_mcp.py
```
