from __future__ import annotations

from contextlib import contextmanager

import duckdb

from .config import db_path


class DBMissingError(RuntimeError):
    pass


def connect(path=None, *, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    p = path or db_path()
    if read_only and not p.exists():
        raise DBMissingError(f"Chicago permits database not found at {p}. Run `uv run chi-permits init` first.")
    return duckdb.connect(str(p), read_only=read_only)


@contextmanager
def ro_conn():
    con = connect(read_only=True)
    try:
        yield con
    finally:
        con.close()
