from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import duckdb

from .config import DATASET_ID, OPEN_STATUSES, SOCRATA_DOMAIN, jsonable
from .db import connect
from .licensed_contractors import fetch_licensed_contractors, normalize_license_name
from .tools.permits import rows as _rows

COMMUNITY_AREAS: dict[int, str] = {
    1: "Rogers Park",
    2: "West Ridge",
    3: "Uptown",
    4: "Lincoln Square",
    5: "North Center",
    6: "Lake View",
    7: "Lincoln Park",
    8: "Near North Side",
    9: "Edison Park",
    10: "Norwood Park",
    11: "Jefferson Park",
    12: "Forest Glen",
    13: "North Park",
    14: "Albany Park",
    15: "Portage Park",
    16: "Irving Park",
    17: "Dunning",
    18: "Montclare",
    19: "Belmont Cragin",
    20: "Hermosa",
    21: "Avondale",
    22: "Logan Square",
    23: "Humboldt Park",
    24: "West Town",
    25: "Austin",
    26: "West Garfield Park",
    27: "East Garfield Park",
    28: "Near West Side",
    29: "North Lawndale",
    30: "South Lawndale",
    31: "Lower West Side",
    32: "Loop",
    33: "Near South Side",
    34: "Armour Square",
    35: "Douglas",
    36: "Oakland",
    37: "Fuller Park",
    38: "Grand Boulevard",
    39: "Kenwood",
    40: "Washington Park",
    41: "Hyde Park",
    42: "Woodlawn",
    43: "South Shore",
    44: "Chatham",
    45: "Avalon Park",
    46: "South Chicago",
    47: "Burnside",
    48: "Calumet Heights",
    49: "Roseland",
    50: "Pullman",
    51: "South Deering",
    52: "East Side",
    53: "West Pullman",
    54: "Riverdale",
    55: "Hegewisch",
    56: "Garfield Ridge",
    57: "Archer Heights",
    58: "Brighton Park",
    59: "McKinley Park",
    60: "Bridgeport",
    61: "New City",
    62: "West Elsdon",
    63: "Gage Park",
    64: "Clearing",
    65: "West Lawn",
    66: "Chicago Lawn",
    67: "West Englewood",
    68: "Englewood",
    69: "Greater Grand Crossing",
    70: "Ashburn",
    71: "Auburn Gresham",
    72: "Beverly",
    73: "Washington Heights",
    74: "Mount Greenwood",
    75: "Morgan Park",
    76: "O'Hare",
    77: "Edgewater",
}


def _write_json(path: Path, data: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(jsonable(data), ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    return path.stat().st_size


def _clip_text(value: Any, limit: int = 180) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else text[: limit - 3].rstrip() + "..."


def _license_phones_for_names(names: list[str], license_index: dict[str, list[dict]]) -> str:
    phones: list[str] = []
    seen: set[str] = set()
    for name in names:
        for match in license_index.get(normalize_license_name(name), []):
            phone = str(match.get("phone") or "").strip()
            if not phone or phone.upper() in {"NA", "N/A", "NONE"}:
                continue
            normalized = phone.upper()
            if normalized in seen:
                continue
            seen.add(normalized)
            phones.append(phone)
            if len(phones) >= 2:
                return " | ".join(phones)
    return " | ".join(phones)


def _write_map_shards(con: duckdb.DuckDBPyConnection, out: Path, license_index: dict[str, list[dict]]) -> dict:
    map_dir = out / "map"
    map_dir.mkdir(parents=True, exist_ok=True)
    for old in map_dir.glob("permits_*.json"):
        old.unlink()
    company_filter = _company_name_condition("contact_name")
    gc_open_rows = _rows(con, f"""
        SELECT contact_name, count(DISTINCT permit_number) AS open_jobs
        FROM contacts
        WHERE contact_category = 'general_contractor'
          AND nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL
          AND {company_filter}
          AND permit_number IN (
            SELECT permit_number
            FROM permits
            WHERE permit_status IN {tuple(OPEN_STATUSES)}
          )
        GROUP BY contact_name
    """)
    gc_open_jobs = {str(row["contact_name"]).strip().upper(): int(row["open_jobs"] or 0) for row in gc_open_rows}
    rows = _rows(con, f"""
        WITH contact_names AS (
            SELECT permit_number,
                   string_agg(DISTINCT contact_name, ' | ') FILTER (WHERE contact_category = 'general_contractor') AS general_contractors,
                   string_agg(DISTINCT contact_name, ' | ') FILTER (WHERE contact_category = 'open_tech') AS open_subs
            FROM contacts
            WHERE nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL
            GROUP BY permit_number
        )
        SELECT p.permit_number, p.permit_status, p.permit_type, p.review_type,
               p.issue_date, p.address, p.ward, p.community_area, p.street_name, p.work_type,
               p.reported_cost, p.latitude, p.longitude,
               p.work_description,
               c.general_contractors, c.open_subs
        FROM permits p
        LEFT JOIN contact_names c USING (permit_number)
        WHERE p.latitude IS NOT NULL
          AND p.longitude IS NOT NULL
          AND p.issue_date IS NOT NULL
        ORDER BY p.issue_date DESC NULLS LAST, p.permit_number
    """)
    shards: dict[str, list[dict]] = {}
    for row in rows:
        issue = row.get("issue_date")
        if not issue:
            continue
        month = str(issue)[:7]
        community_area = row.get("community_area")
        gc_names = [name.strip() for name in str(row.get("general_contractors") or "").split("|") if name.strip()]
        gc_counts = [gc_open_jobs.get(name.upper(), 0) for name in gc_names]
        max_gc_open_jobs = max(gc_counts) if gc_counts else 0
        shards.setdefault(month, []).append({
            "n": row.get("permit_number"),
            "s": row.get("permit_status"),
            "t": row.get("permit_type"),
            "r": row.get("review_type"),
            "d": str(issue)[:10],
            "a": row.get("address"),
            "w": row.get("ward"),
            "ca": community_area,
            "cn": COMMUNITY_AREAS.get(int(community_area)) if community_area is not None else "",
            "st": row.get("street_name"),
            "wt": row.get("work_type"),
            "c": int(row["reported_cost"]) if row.get("reported_cost") is not None else None,
            "lat": round(float(row.get("latitude")), 6),
            "lon": round(float(row.get("longitude")), 6),
            "gc": _clip_text(row.get("general_contractors"), 220),
            "gp": _license_phones_for_names(gc_names, license_index),
            "go": max_gc_open_jobs,
            "os": _clip_text(row.get("open_subs"), 220),
            "x": _clip_text(row.get("work_description"), 220),
        })
    files = []
    total_rows = 0
    total_bytes = 0
    for month, payload in sorted(shards.items()):
        rel = f"map/permits_{month.replace('-', '_')}.json"
        size = _write_json(out / rel, payload)
        files.append({"month": month, "path": f"data/{rel}", "rows": len(payload), "bytes": size})
        total_rows += len(payload)
        total_bytes += size
    index = {
        "type": "monthly_geojson_shards",
        "pmtiles_protocol": True,
        "rows": total_rows,
        "bytes": total_bytes,
        "community_areas": [{"id": key, "name": value} for key, value in COMMUNITY_AREAS.items()],
        "files": files,
    }
    index_size = _write_json(out / "permit_map_index.json", index)
    return {
        "path": "data/permit_map_index.json",
        "rows": total_rows,
        "bytes": total_bytes + index_size,
        "months": len(files),
        "type": "monthly_geojson_shards",
        "pmtiles_protocol": True,
    }


def _company_name_condition(column: str = "contact_name") -> str:
    value = f"upper(' ' || trim(coalesce({column}, '')) || ' ')"
    return (
        "("
        f"{value} LIKE '% LLC %' OR {value} LIKE '% L.L.C%' OR {value} LIKE '% INC %' "
        f"OR {value} LIKE '% INC.%' OR {value} LIKE '% INCORPORATED %' OR {value} LIKE '% CORP %' "
        f"OR {value} LIKE '% CORPORATION %' OR {value} LIKE '% COMPANY %' OR {value} LIKE '% CO %' "
        f"OR {value} LIKE '% CO.%' OR {value} LIKE '% LTD %' OR {value} LIKE '% LTD.%' OR {value} LIKE '% LLP %' "
        f"OR {value} LIKE '% LP %' OR {value} LIKE '% L.P.%' OR {value} LIKE '% PLC %' "
        f"OR {value} LIKE '% PC %' OR {value} LIKE '% DBA %' OR {value} LIKE '% CORP.%' "
        f"OR regexp_matches({value}, '( INC|\\.INC| CORP|\\.CORP| LLC| LTD| CO| L\\.P| CONTR| CONTR\\.)\\.? *$') "
        f"OR {value} LIKE '% CONSTRUCTION%' OR {value} LIKE '% CONTRACT%' OR {value} LIKE '% CONTR.%' "
        f"OR {value} LIKE '% CONTR %' OR {value} LIKE '% GENERAL CONTR%' "
        f"OR {value} LIKE '% ELECTRIC%' OR {value} LIKE '% PLUMB%' OR {value} LIKE '% MASON%' "
        f"OR {value} LIKE '% ROOF%' OR {value} LIKE '% HVAC%' OR {value} LIKE '% H.V.A.C%' "
        f"OR {value} LIKE '% MECH %' OR {value} LIKE '% MECH.%' OR {value} LIKE '%MECH.%' "
        f"OR {value} LIKE '% MECHANICAL%' OR {value} LIKE '% ENGINEER%' OR {value} LIKE '% ARCHITECT%' "
        f"OR {value} LIKE '% BUILD%' OR {value} LIKE '% DESIGN%' OR {value} LIKE '% GROUP%' "
        f"OR {value} LIKE '% ASSOCIATES%' OR {value} LIKE '% PARTNERS%' OR {value} LIKE '% SERVICES%' "
        f"OR {value} LIKE '% SERVIC%' OR {value} LIKE '% SYSTEM%' OR {value} LIKE '% SYSTM%' "
        f"OR {value} LIKE '% SOLUTIONS%' OR {value} LIKE '% ENTERPRISE%' OR {value} LIKE '% INDUSTRIES%' "
        f"OR {value} LIKE '% CONSULTING%' OR {value} LIKE '% COMMUNICATION%' OR {value} LIKE '% HOLDINGS%' "
        f"OR {value} LIKE '% COLLECTIONS%' OR {value} LIKE '% BROTHERS%' OR {value} LIKE '% BROS%' "
        f"OR {value} LIKE '% IMPROV%' OR {value} LIKE '% DEMOLITION%'"
        ")"
    )


def _person_name_condition(column: str = "contact_name") -> str:
    trimmed = f"trim(coalesce({column}, ''))"
    company = _company_name_condition(column)
    return (
        "("
        f"NOT {company} "
        f"AND NOT regexp_matches({trimmed}, '[0-9@&/]') "
        f"AND regexp_matches({trimmed}, '^[A-Za-z][A-Za-z''.-]+( +[A-Za-z][A-Za-z''.-]+){{1,4}}$')"
        ")"
    )


def _contact_profiles(
    con: duckdb.DuckDBPyConnection,
    category: str,
    entity_filter: str,
    license_index: dict[str, list[dict]] | None = None,
) -> list[dict]:
    profiles = _rows(con, f"""
        WITH contact_permits AS (
            SELECT
                contact_name,
                any_value(contact_type) AS sample_contact_type,
                any_value(contact_city) AS city,
                any_value(contact_state) AS state,
                any_value(contact_zipcode) AS zipcode,
                permit_number,
                any_value(permit_status) AS permit_status,
                any_value(permit_type) AS permit_type,
                any_value(processing_time) AS processing_time,
                any_value(issue_date) AS issue_date,
                any_value(reported_cost) AS reported_cost,
                any_value(total_fee) AS total_fee
            FROM contacts
            WHERE contact_category = ?
              AND nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL
              AND {entity_filter}
            GROUP BY contact_name, permit_number
        ),
        base AS (
            SELECT
                contact_name,
                any_value(sample_contact_type) AS sample_contact_type,
                any_value(city) AS city,
                any_value(state) AS state,
                any_value(zipcode) AS zipcode,
                count(*) AS total_jobs,
                count(CASE WHEN permit_status IN {tuple(OPEN_STATUSES)} THEN permit_number END) AS open_jobs,
                coalesce(avg(CASE WHEN processing_time > 0 THEN processing_time WHEN processing_time = 0 THEN 1.0 END), 1.0) AS avg_processing_days,
                count(CASE WHEN processing_time > 0 THEN permit_number END) AS usable_processing_jobs,
                avg(CASE WHEN processing_time > 0 THEN processing_time END) AS avg_usable_processing_days,
                min(issue_date) AS first_issue_date,
                max(issue_date) AS latest_issue_date,
                sum(reported_cost) AS reported_cost_total,
                sum(total_fee) AS total_fee_total
            FROM contact_permits
            GROUP BY contact_name
        ),
        work_type_ranked AS (
            SELECT c.contact_name, p.work_type,
                   count(DISTINCT c.permit_number) AS jobs,
                   count(DISTINCT CASE WHEN c.permit_status IN {tuple(OPEN_STATUSES)} THEN c.permit_number END) AS open_jobs,
                   row_number() OVER (PARTITION BY c.contact_name ORDER BY count(DISTINCT c.permit_number) DESC) AS rn
            FROM contact_permits c
            JOIN permits p USING (permit_number)
            WHERE nullif(trim(coalesce(p.work_type, '')), '') IS NOT NULL
            GROUP BY c.contact_name, p.work_type
        ),
        permit_type_ranked AS (
            SELECT contact_name, permit_type,
                   count(DISTINCT permit_number) AS jobs,
                   count(DISTINCT CASE WHEN permit_status IN {tuple(OPEN_STATUSES)} THEN permit_number END) AS open_jobs,
                   row_number() OVER (PARTITION BY contact_name ORDER BY count(DISTINCT permit_number) DESC) AS rn
            FROM contact_permits
            WHERE nullif(trim(coalesce(permit_type, '')), '') IS NOT NULL
            GROUP BY contact_name, permit_type
        ),
        contact_type_ranked AS (
            SELECT contact_name, sample_contact_type AS contact_type,
                   count(DISTINCT permit_number) AS jobs,
                   row_number() OVER (PARTITION BY contact_name ORDER BY count(DISTINCT permit_number) DESC) AS rn
            FROM contact_permits
            WHERE nullif(trim(coalesce(sample_contact_type, '')), '') IS NOT NULL
            GROUP BY contact_name, sample_contact_type
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
    """, [category])
    for profile in profiles:
        profile["work_types"] = json.loads(profile.pop("work_types_json") or "[]")
        profile["permit_types"] = json.loads(profile.pop("permit_types_json") or "[]")
        profile["contact_types"] = json.loads(profile.pop("contact_types_json") or "[]")
        if license_index is not None:
            key = normalize_license_name(profile.get("contact_name"))
            matches = license_index.get(key, [])
            profile["license_matches"] = matches[:5]
            profile["license_match_count"] = len(matches)
    return profiles


def _open_permits(con: duckdb.DuckDBPyConnection) -> list[dict]:
    return _rows(con, f"""
        WITH contact_names AS (
            SELECT permit_number,
                   string_agg(DISTINCT contact_name, ' | ') FILTER (WHERE contact_category = 'general_contractor') AS general_contractors,
                   string_agg(DISTINCT contact_name, ' | ') FILTER (WHERE contact_category = 'open_tech') AS open_subs
            FROM contacts
            WHERE nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL
            GROUP BY permit_number
        )
        SELECT p.permit_number, p.permit_status, p.permit_type, p.review_type,
               p.issue_date, p.address, p.ward, p.community_area, p.work_type,
               p.reported_cost, p.total_fee, p.processing_time,
               p.latitude, p.longitude,
               left(p.work_description, 260) AS work_description,
               c.general_contractors, c.open_subs
        FROM permits p
        LEFT JOIN contact_names c USING (permit_number)
        WHERE p.permit_status IN {tuple(OPEN_STATUSES)}
        ORDER BY p.issue_date DESC NULLS LAST, p.permit_number
    """)


def export_static(out_dir: Path | str = "docs/data") -> dict:
    out = Path(out_dir)
    con = connect(read_only=True)
    try:
        company_filter = _company_name_condition("contact_name")
        person_filter = _person_name_condition("contact_name")
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
                   AND {company_filter}
                   AND nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL) AS general_contractor_count,
                (SELECT count(DISTINCT contact_name)
                 FROM contacts
                 WHERE contact_category = 'open_tech'
                   AND {person_filter}
                   AND nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL) AS open_sub_count
        """)[0]
        exported_at = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
        licenses = fetch_licensed_contractors()
        license_index: dict[str, list[dict]] = {}
        for row in licenses["rows"]:
            license_index.setdefault(normalize_license_name(row.get("name")), []).append(row)
        manifest = {
            **meta,
            **span,
            "exported_at": exported_at,
            "dataset_api": f"https://{SOCRATA_DOMAIN}/api/v3/views/{DATASET_ID}/query.json",
            "license_source": {
                "source_url": licenses["source_url"],
                "sources": licenses["sources"],
                "fetched_at": licenses["fetched_at"],
                "rows": len(licenses["rows"]),
            },
            "files": {},
        }
        files = {
            "open_permits": _open_permits(con),
            "general_contractors": _contact_profiles(con, "general_contractor", company_filter, license_index),
            "open_subs": _contact_profiles(con, "open_tech", person_filter, license_index),
            "contractor_licenses": licenses["rows"],
        }
        for name, payload in files.items():
            rel = f"{name}.json"
            size = _write_json(out / rel, payload)
            manifest["files"][name] = {
                "path": f"data/{rel}",
                "rows": len(payload),
                "bytes": size,
            }
        manifest["files"]["permit_map"] = _write_map_shards(con, out, license_index)
        manifest_size = _write_json(out / "manifest.json", manifest)
        manifest["files"]["manifest"] = {"path": "data/manifest.json", "rows": 1, "bytes": manifest_size}
        _write_json(out / "manifest.json", manifest)
        return manifest
    finally:
        con.close()
