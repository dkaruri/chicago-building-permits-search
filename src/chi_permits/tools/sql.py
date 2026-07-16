from __future__ import annotations

import re

_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|COPY|"
    r"INSTALL|LOAD|SET|CALL|EXPORT|IMPORT|TRUNCATE|GRANT|REVOKE|EXECUTE|VACUUM)\b",
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
