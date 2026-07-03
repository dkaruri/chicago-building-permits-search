from __future__ import annotations

import typer

from .config import db_path
from .db import connect
from .ingest import run_ingest
from .static_export import export_static

app = typer.Typer(help="Chicago Building Permits MCP utilities")


@app.command()
def init(limit: int | None = typer.Option(None, help="Optional max rows for smoke tests.")) -> None:
    summary = run_ingest(limit=limit)
    typer.echo(f"Loaded {summary['row_count']} rows into {summary['database']}")


@app.command()
def update(limit: int | None = typer.Option(None, help="Optional max rows for smoke tests.")) -> None:
    summary = run_ingest(limit=limit)
    typer.echo(f"Updated {summary['row_count']} rows into {summary['database']}")


@app.command()
def status() -> None:
    path = db_path()
    if not path.exists():
        typer.echo(f"No database at {path}. Run `uv run chi-permits init`.")
        raise typer.Exit(1)
    con = connect(read_only=True)
    try:
        row = con.execute("SELECT dataset_name, row_count, ingested_at, rows_updated_at, source_url FROM meta").fetchone()
        latest = con.execute("SELECT max(issue_date), min(issue_date), count(*) FROM permits").fetchone()
    finally:
        con.close()
    typer.echo(f"{row[0]}: {row[1]} rows")
    typer.echo(f"Issue dates: {latest[1]} to {latest[0]}")
    typer.echo(f"Ingested at: {row[2]}")
    typer.echo(f"Source updated at unix: {row[3]}")
    typer.echo(f"Database: {path}")


@app.command("export-static")
def export_static_command(
    out_dir: str = typer.Option("docs/data", help="Directory for GitHub Pages JSON files."),
) -> None:
    manifest = export_static(out_dir)
    typer.echo(f"Exported static Pages data to {out_dir}")
    typer.echo(f"Open permits: {manifest['files']['open_permits']['rows']}")
    typer.echo(f"General contractors: {manifest['files']['general_contractors']['rows']}")
    typer.echo(f"Open techs: {manifest['files']['open_techs']['rows']}")
