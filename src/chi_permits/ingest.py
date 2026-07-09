from __future__ import annotations

import csv
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import httpx

from .config import (
    DATASET_ID,
    DATASET_NAME,
    PAGE_SIZE,
    SELECT_COLUMNS,
    SOCRATA_DOMAIN,
    app_token,
    db_path,
)

DDL = """
CREATE TABLE permits (
  id VARCHAR,
  permit_number VARCHAR,
  permit_status VARCHAR,
  permit_milestone VARCHAR,
  permit_type VARCHAR,
  review_type VARCHAR,
  application_start_date DATE,
  issue_date DATE,
  processing_time DOUBLE,
  street_number DOUBLE,
  street_direction VARCHAR,
  street_name VARCHAR,
  work_type VARCHAR,
  work_description VARCHAR,
  permit_condition VARCHAR,
  building_fee_paid DOUBLE,
  zoning_fee_paid DOUBLE,
  other_fee_paid DOUBLE,
  subtotal_paid DOUBLE,
  total_fee DOUBLE,
  reported_cost DOUBLE,
  pin_list VARCHAR,
  community_area INTEGER,
  census_tract VARCHAR,
  ward INTEGER,
  xcoordinate DOUBLE,
  ycoordinate DOUBLE,
  latitude DOUBLE,
  longitude DOUBLE,
  address VARCHAR
);

CREATE TABLE contacts (
  permit_number VARCHAR,
  permit_status VARCHAR,
  permit_type VARCHAR,
  issue_date DATE,
  processing_time DOUBLE,
  reported_cost DOUBLE,
  total_fee DOUBLE,
  address VARCHAR,
  ward INTEGER,
  community_area INTEGER,
  contact_slot INTEGER,
  contact_type VARCHAR,
  contact_name VARCHAR,
  contact_city VARCHAR,
  contact_state VARCHAR,
  contact_zipcode VARCHAR,
  contact_category VARCHAR
);
"""

INSERT_FROM_PAGE_SQL = """
INSERT INTO permits
SELECT
  id,
  permit_ AS permit_number,
  permit_status,
  permit_milestone,
  permit_type,
  review_type,
  try_cast(application_start_date AS DATE),
  try_cast(issue_date AS DATE),
  try_cast(processing_time AS DOUBLE),
  try_cast(street_number AS DOUBLE),
  street_direction,
  street_name,
  work_type,
  work_description,
  permit_condition,
  try_cast(building_fee_paid AS DOUBLE),
  try_cast(zoning_fee_paid AS DOUBLE),
  try_cast(other_fee_paid AS DOUBLE),
  try_cast(subtotal_paid AS DOUBLE),
  try_cast(total_fee AS DOUBLE),
  try_cast(reported_cost AS DOUBLE),
  pin_list,
  try_cast(community_area AS INTEGER),
  census_tract,
  try_cast(ward AS INTEGER),
  try_cast(xcoordinate AS DOUBLE),
  try_cast(ycoordinate AS DOUBLE),
  try_cast(latitude AS DOUBLE),
  try_cast(longitude AS DOUBLE),
  trim(concat_ws(' ', street_number, street_direction, street_name)) AS address
FROM page
"""


def _contact_category_expr(type_col: str) -> str:
    t = f"upper(coalesce({type_col}, ''))"
    return (
        "CASE "
        f"WHEN {t} LIKE '%GENERAL CONTRACTOR%' THEN 'general_contractor' "
        f"WHEN {t} LIKE '%CONTRACTOR%' OR {t} LIKE '%ARCHITECT%' OR {t} LIKE '%ENGINEER%' "
        f"OR {t} LIKE '%EXPEDIT%' OR {t} LIKE '%MASON%' THEN 'open_tech' "
        "ELSE 'other' END"
    )


CONTACT_INSERT_SQL = " UNION ALL ".join(
    f"""
    SELECT
      permit_,
      permit_status,
      permit_type,
      try_cast(issue_date AS DATE),
      try_cast(processing_time AS DOUBLE),
      try_cast(reported_cost AS DOUBLE),
      try_cast(total_fee AS DOUBLE),
      trim(concat_ws(' ', street_number, street_direction, street_name)),
      try_cast(ward AS INTEGER),
      try_cast(community_area AS INTEGER),
      {i},
      contact_{i}_type,
      contact_{i}_name,
      contact_{i}_city,
      contact_{i}_state,
      contact_{i}_zipcode,
      {_contact_category_expr(f"contact_{i}_type")}
    FROM page
    WHERE nullif(trim(coalesce(contact_{i}_name, '')), '') IS NOT NULL
       OR nullif(trim(coalesce(contact_{i}_type, '')), '') IS NOT NULL
    """
    for i in range(1, 16)
)

INSERT_CONTACTS_FROM_PAGE_SQL = f"INSERT INTO contacts {CONTACT_INSERT_SQL}"


def _headers() -> dict[str, str]:
    headers = {"User-Agent": "chi-permits-search/0.1"}
    token = app_token()
    if token:
        headers["X-App-Token"] = token
    return headers


def _metadata(client: httpx.Client) -> dict:
    url = f"https://{SOCRATA_DOMAIN}/api/views/{DATASET_ID}"
    r = client.get(url)
    r.raise_for_status()
    return r.json()


def _csv_page(client: httpx.Client, *, offset: int, limit: int) -> str:
    url = f"https://{SOCRATA_DOMAIN}/resource/{DATASET_ID}.csv"
    params = {
        "$select": ",".join(SELECT_COLUMNS),
        "$limit": str(limit),
        "$offset": str(offset),
        "$order": "id",
    }
    r = client.get(url, params=params)
    r.raise_for_status()
    return r.text


def _atomic_replace(shadow: Path, final: Path) -> None:
    final.parent.mkdir(parents=True, exist_ok=True)
    if not shadow.exists():
        raise FileNotFoundError(f"Shadow DuckDB was not created: {shadow}")
    backup = final.with_suffix(final.suffix + ".bak")
    if backup.exists():
        backup.unlink()
    if final.exists():
        final.replace(backup)
    shadow.replace(final)
    if backup.exists():
        backup.unlink()


def run_ingest(*, limit: int | None = None) -> dict:
    final = db_path()
    shadow = final.with_suffix(".shadow.duckdb")
    final.parent.mkdir(parents=True, exist_ok=True)
    if shadow.exists():
        shadow.unlink()
    wal = Path(str(shadow) + ".wal")
    if wal.exists():
        wal.unlink()
    page_dir = final.parent / "pages"
    if page_dir.exists():
        shutil.rmtree(page_dir)
    page_dir.mkdir(parents=True, exist_ok=True)

    with httpx.Client(headers=_headers(), timeout=60.0, follow_redirects=True) as client:
        meta = _metadata(client)
        con = duckdb.connect(str(shadow))
        try:
            con.execute(DDL)
            total = 0
            offset = 0
            while True:
                page_limit = PAGE_SIZE
                if limit is not None:
                    remaining = limit - total
                    if remaining <= 0:
                        break
                    page_limit = min(page_limit, remaining)
                text = _csv_page(client, offset=offset, limit=page_limit)
                line_count = max(0, text.count("\n") - 1)
                if line_count == 0:
                    break
                page_file = page_dir / f"permits_{offset}.csv"
                page_file.write_text(text, encoding="utf-8", newline="")
                con.execute("DROP TABLE IF EXISTS page")
                con.execute("CREATE TEMP TABLE page AS SELECT * FROM read_csv_auto(?, all_varchar=true)", [str(page_file)])
                con.execute(INSERT_FROM_PAGE_SQL)
                con.execute(INSERT_CONTACTS_FROM_PAGE_SQL)
                total += line_count
                offset += line_count
                if line_count < page_limit:
                    break
            con.execute("CREATE INDEX permits_issue_date_idx ON permits(issue_date)")
            con.execute("CREATE INDEX permits_number_idx ON permits(permit_number)")
            con.execute("CREATE INDEX permits_ward_idx ON permits(ward)")
            con.execute("CREATE INDEX contacts_name_idx ON contacts(contact_name)")
            con.execute("CREATE INDEX contacts_category_idx ON contacts(contact_category)")
            con.execute("""
                CREATE TABLE meta AS SELECT
                  ?::VARCHAR AS dataset_id,
                  ?::VARCHAR AS dataset_name,
                  ?::BIGINT AS row_count,
                  ?::TIMESTAMP AS ingested_at,
                  ?::BIGINT AS rows_updated_at,
                  ?::VARCHAR AS source_url,
                  ?::VARCHAR AS selected_columns_json
            """, [
                DATASET_ID,
                DATASET_NAME,
                total,
                datetime.now(timezone.utc).replace(tzinfo=None),
                int(meta.get("rowsUpdatedAt") or 0),
                f"https://{SOCRATA_DOMAIN}/Buildings/Building-Permits/{DATASET_ID}",
                json.dumps(list(SELECT_COLUMNS)),
            ])
            con.execute("CHECKPOINT")
        finally:
            con.close()

    _atomic_replace(shadow, final)
    if page_dir.exists():
        shutil.rmtree(page_dir)
    return {"database": str(final), "row_count": total, "rows_updated_at": meta.get("rowsUpdatedAt")}
