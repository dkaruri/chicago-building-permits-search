from __future__ import annotations

import duckdb

from .config import db_path


def connect(path=None, *, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    p = path or db_path()
    if read_only and not p.exists():
        raise RuntimeError(f"Chicago permits database not found at {p}. Run `uv run chi-permits init` first.")
    return duckdb.connect(str(p), read_only=read_only)
