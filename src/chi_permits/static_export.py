from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

import duckdb

from .config import DATASET_ID, OPEN_STATUSES, SOCRATA_DOMAIN
from .db import connect


def _jsonable(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    return value


def _rows(con: duckdb.DuckDBPyConnection, sql: str, params: list | None = None) -> list[dict]:
    cur = con.execute(sql, params or [])
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _write_json(path: Path, data: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(_jsonable(data), ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    return path.stat().st_size


def _contact_profiles(con: duckdb.DuckDBPyConnection, category: str) -> list[dict]:
    profiles = _rows(con, f"""
        WITH base AS (
            SELECT
                contact_name,
                any_value(contact_type) AS sample_contact_type,
                any_value(contact_city) AS city,
                any_value(contact_state) AS state,
                any_value(contact_zipcode) AS zipcode,
                count(DISTINCT permit_number) AS total_jobs,
                count(DISTINCT CASE WHEN permit_status IN {tuple(OPEN_STATUSES)} THEN permit_number END) AS open_jobs,
                avg(processing_time) AS avg_processing_days,
                min(issue_date) AS first_issue_date,
                max(issue_date) AS latest_issue_date,
                sum(reported_cost) AS reported_cost_total,
                sum(total_fee) AS total_fee_total
            FROM contacts
            WHERE contact_category = ?
              AND nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL
            GROUP BY contact_name
        ),
        work_type_ranked AS (
            SELECT c.contact_name, p.work_type,
                   count(DISTINCT c.permit_number) AS jobs,
                   count(DISTINCT CASE WHEN c.permit_status IN {tuple(OPEN_STATUSES)} THEN c.permit_number END) AS open_jobs,
                   row_number() OVER (PARTITION BY c.contact_name ORDER BY count(DISTINCT c.permit_number) DESC) AS rn
            FROM contacts c
            JOIN permits p USING (permit_number)
            WHERE c.contact_category = ?
              AND nullif(trim(coalesce(c.contact_name, '')), '') IS NOT NULL
              AND nullif(trim(coalesce(p.work_type, '')), '') IS NOT NULL
            GROUP BY c.contact_name, p.work_type
        ),
        permit_type_ranked AS (
            SELECT contact_name, permit_type,
                   count(DISTINCT permit_number) AS jobs,
                   count(DISTINCT CASE WHEN permit_status IN {tuple(OPEN_STATUSES)} THEN permit_number END) AS open_jobs,
                   row_number() OVER (PARTITION BY contact_name ORDER BY count(DISTINCT permit_number) DESC) AS rn
            FROM contacts
            WHERE contact_category = ?
              AND nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL
              AND nullif(trim(coalesce(permit_type, '')), '') IS NOT NULL
            GROUP BY contact_name, permit_type
        ),
        contact_type_ranked AS (
            SELECT contact_name, contact_type,
                   count(DISTINCT permit_number) AS jobs,
                   row_number() OVER (PARTITION BY contact_name ORDER BY count(DISTINCT permit_number) DESC) AS rn
            FROM contacts
            WHERE contact_category = ?
              AND nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL
              AND nullif(trim(coalesce(contact_type, '')), '') IS NOT NULL
            GROUP BY contact_name, contact_type
        )
        SELECT
            b.*,
            coalesce((
                SELECT json_group_array(json_object('work_type', work_type, 'jobs', jobs, 'open_jobs', open_jobs))
                FROM work_type_ranked w
                WHERE w.contact_name = b.contact_name AND rn <= 6
            ), '[]') AS work_types_json,
            coalesce((
                SELECT json_group_array(json_object('permit_type', permit_type, 'jobs', jobs, 'open_jobs', open_jobs))
                FROM permit_type_ranked pt
                WHERE pt.contact_name = b.contact_name AND rn <= 6
            ), '[]') AS permit_types_json,
            coalesce((
                SELECT json_group_array(json_object('contact_type', contact_type, 'jobs', jobs))
                FROM contact_type_ranked ct
                WHERE ct.contact_name = b.contact_name AND rn <= 6
            ), '[]') AS contact_types_json
        FROM base b
        ORDER BY open_jobs DESC, total_jobs DESC, contact_name
    """, [category, category, category, category])
    for profile in profiles:
        profile["work_types"] = json.loads(profile.pop("work_types_json") or "[]")
        profile["permit_types"] = json.loads(profile.pop("permit_types_json") or "[]")
        profile["contact_types"] = json.loads(profile.pop("contact_types_json") or "[]")
    return profiles


def _open_permits(con: duckdb.DuckDBPyConnection) -> list[dict]:
    return _rows(con, f"""
        WITH contact_names AS (
            SELECT permit_number,
                   string_agg(DISTINCT contact_name, ' | ') FILTER (WHERE contact_category = 'general_contractor') AS general_contractors,
                   string_agg(DISTINCT contact_name, ' | ') FILTER (WHERE contact_category = 'open_tech') AS open_techs
            FROM contacts
            WHERE nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL
            GROUP BY permit_number
        )
        SELECT p.permit_number, p.permit_status, p.permit_type, p.review_type,
               p.issue_date, p.address, p.ward, p.community_area, p.work_type,
               p.reported_cost, p.total_fee, p.processing_time,
               left(p.work_description, 260) AS work_description,
               c.general_contractors, c.open_techs
        FROM permits p
        LEFT JOIN contact_names c USING (permit_number)
        WHERE p.permit_status IN {tuple(OPEN_STATUSES)}
        ORDER BY p.issue_date DESC NULLS LAST, p.permit_number
    """)


def export_static(out_dir: Path | str = "docs/data") -> dict:
    out = Path(out_dir)
    con = connect(read_only=True)
    try:
        meta = _rows(con, """
            SELECT dataset_id, dataset_name, row_count, ingested_at, rows_updated_at, source_url
            FROM meta
        """)[0]
        span = _rows(con, f"""
            SELECT
                (SELECT min(issue_date) FROM permits) AS first_issue_date,
                (SELECT max(issue_date) FROM permits) AS latest_issue_date,
                (SELECT count(*) FROM permits WHERE permit_status IN {tuple(OPEN_STATUSES)}) AS open_permit_count,
                (SELECT count(DISTINCT contact_name)
                 FROM contacts
                 WHERE contact_category = 'general_contractor'
                   AND nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL) AS general_contractor_count,
                (SELECT count(DISTINCT contact_name)
                 FROM contacts
                 WHERE contact_category = 'open_tech'
                   AND nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL) AS open_tech_count
        """)[0]
        exported_at = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
        manifest = {
            **meta,
            **span,
            "exported_at": exported_at,
            "dataset_api": f"https://{SOCRATA_DOMAIN}/api/v3/views/{DATASET_ID}/query.json",
            "files": {},
        }
        files = {
            "open_permits": _open_permits(con),
            "general_contractors": _contact_profiles(con, "general_contractor"),
            "open_techs": _contact_profiles(con, "open_tech"),
        }
        for name, payload in files.items():
            rel = f"{name}.json"
            size = _write_json(out / rel, payload)
            manifest["files"][name] = {
                "path": f"data/{rel}",
                "rows": len(payload),
                "bytes": size,
            }
        manifest_size = _write_json(out / "manifest.json", manifest)
        manifest["files"]["manifest"] = {"path": "data/manifest.json", "rows": 1, "bytes": manifest_size}
        _write_json(out / "manifest.json", manifest)
        return manifest
    finally:
        con.close()
