from __future__ import annotations

import re
import threading

import duckdb

from ..config import RUN_SQL_ROW_CAP, RUN_SQL_TIMEOUT_SECONDS

_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|COPY|"
    r"INSTALL|LOAD|SET|CALL|EXPORT|IMPORT)\b",
    re.IGNORECASE,
)
_LITERAL_OR_COMMENT = re.compile(r"'(?:[^']|'')*'|--[^\n]*|/\*.*?\*/", re.DOTALL)


def validate_select(query: str) -> str:
    q = query.strip().rstrip(";").strip()
    scannable = _LITERAL_OR_COMMENT.sub(" ", q)
    if ";" in scannable:
        raise ValueError("Only a single statement is allowed.")
    if not re.match(r"(?is)^\s*(SELECT|WITH)\b", q):
        raise ValueError("Only SELECT/WITH queries are allowed.")
    if _FORBIDDEN.search(scannable):
        raise ValueError("Query contains a forbidden keyword (read-only only).")
    return q


def _interrupt_after(con: duckdb.DuckDBPyConnection, seconds: int) -> threading.Timer:
    t = threading.Timer(seconds, con.interrupt)
    t.daemon = True
    t.start()
    return t


def run_sql_on(con: duckdb.DuckDBPyConnection, query: str, *,
               row_cap: int = RUN_SQL_ROW_CAP,
               timeout: int = RUN_SQL_TIMEOUT_SECONDS) -> dict:
    q = validate_select(query)
    timer = _interrupt_after(con, timeout)
    try:
        cur = con.execute(f"SELECT * FROM ({q}\n) AS _sub LIMIT {row_cap + 1}")
        cols = [d[0] for d in cur.description]
        fetched = cur.fetchall()
    finally:
        timer.cancel()
    rows = [dict(zip(cols, r)) for r in fetched[:row_cap]]
    return {
        "rows": rows,
        "truncated": len(fetched) > row_cap,
        "row_count": len(rows),
        "provenance": {"reproduce_sql": q, "row_cap": row_cap},
    }
