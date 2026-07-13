from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import duckdb
import httpx

from chi_permits.config import DATASET_ID, OPEN_STATUSES, SOCRATA_DOMAIN, db_path
from chi_permits.licensed_contractors import fetch_licensed_contractors


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "docs" / "data"


def load_json(name: str) -> Any:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def live_socrata_counts() -> dict[str, Any]:
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        meta_response = client.get(f"https://{SOCRATA_DOMAIN}/api/views/{DATASET_ID}")
        meta_response.raise_for_status()
        meta = meta_response.json()

        count_response = client.get(
            f"https://{SOCRATA_DOMAIN}/resource/{DATASET_ID}.json",
            params={"$select": "count(*)"},
        )
        count_response.raise_for_status()
        live_count = int(count_response.json()[0]["count"])

        open_response = client.get(
            f"https://{SOCRATA_DOMAIN}/resource/{DATASET_ID}.json",
            params={
                "$select": "count(*)",
                "$where": "permit_status in('ACTIVE','SUSPENDED','PHASED PERMITTING')",
            },
        )
        open_response.raise_for_status()
        live_open_count = int(open_response.json()[0]["count"])

        latest_response = client.get(
            f"https://{SOCRATA_DOMAIN}/resource/{DATASET_ID}.json",
            params={"$select": "max(issue_date) as latest_issue_date"},
        )
        latest_response.raise_for_status()
        live_latest_issue_date = latest_response.json()[0]["latest_issue_date"][:10]

    return {
        "row_count": live_count,
        "open_permit_count": live_open_count,
        "rows_updated_at": int(meta.get("rowsUpdatedAt") or 0),
        "latest_issue_date": live_latest_issue_date,
    }


def local_db_counts() -> dict[str, Any]:
    con = duckdb.connect(str(db_path()), read_only=True)
    try:
        meta = con.execute("""
            SELECT row_count, rows_updated_at, ingested_at
            FROM meta
        """).fetchone()
        open_statuses = tuple(OPEN_STATUSES)
        counts = con.execute(f"""
            SELECT
              count(*) AS permits,
              count(DISTINCT permit_number) AS distinct_permits,
              count(*) FILTER (WHERE permit_number IS NULL OR trim(permit_number) = '') AS missing_permit_numbers,
              count(*) FILTER (WHERE permit_status IN {open_statuses}) AS open_permits,
              min(issue_date) AS first_issue_date,
              max(issue_date) AS latest_issue_date
            FROM permits
        """).fetchone()
        contacts = con.execute("""
            SELECT
              count(*) AS contacts,
              count(*) FILTER (WHERE contact_category = 'general_contractor') AS general_contractor_contacts,
              count(*) FILTER (WHERE contact_category = 'open_tech') AS open_sub_contacts
            FROM contacts
        """).fetchone()
    finally:
        con.close()
    return {
        "meta_row_count": int(meta[0]),
        "meta_rows_updated_at": int(meta[1]),
        "ingested_at": str(meta[2]),
        "permits": int(counts[0]),
        "distinct_permits": int(counts[1]),
        "missing_permit_numbers": int(counts[2]),
        "open_permits": int(counts[3]),
        "first_issue_date": str(counts[4]),
        "latest_issue_date": str(counts[5]),
        "contacts": int(contacts[0]),
        "general_contractor_contacts": int(contacts[1]),
        "open_sub_contacts": int(contacts[2]),
    }


def exported_counts() -> dict[str, Any]:
    manifest = load_json("manifest.json")
    open_permits = load_json("open_permits.json")
    general_contractors = load_json("general_contractors.json")
    open_subs = load_json("open_subs.json")
    licenses = load_json("contractor_licenses.json")

    return {
        "manifest": manifest,
        "open_permits_rows": len(open_permits),
        "general_contractors_rows": len(general_contractors),
        "open_subs_rows": len(open_subs),
        "license_rows": len(licenses),
        "bad_open_status_rows": sum(1 for row in open_permits if row.get("permit_status") not in OPEN_STATUSES),
        "open_permits_with_unusable_processing": sum(
            1 for row in open_permits
            if row.get("processing_time") is None or float(row.get("processing_time") or 0) <= 0
        ),
        "general_contractors_with_license_match": sum(
            1 for row in general_contractors
            if int(row.get("license_match_count") or 0) > 0
        ),
        "open_subs_with_license_match": sum(
            1 for row in open_subs
            if int(row.get("license_match_count") or 0) > 0
        ),
        "profiles_missing_usable_processing_field": sum(
            1 for row in [*general_contractors, *open_subs]
            if "usable_processing_jobs" not in row or "avg_usable_processing_days" not in row
        ),
    }


def compare() -> dict[str, Any]:
    local = local_db_counts()
    exported = exported_counts()
    live = live_socrata_counts()
    live_licenses = fetch_licensed_contractors()
    manifest = exported["manifest"]

    checks = {
        "db_meta_matches_db_permit_rows": local["meta_row_count"] == local["permits"],
        "export_manifest_matches_db_rows": manifest["row_count"] == local["permits"],
        "export_manifest_matches_live_rows": manifest["row_count"] == live["row_count"],
        "export_manifest_rows_updated_at_matches_live": manifest["rows_updated_at"] == live["rows_updated_at"],
        "export_latest_issue_date_matches_live": manifest["latest_issue_date"] == live["latest_issue_date"],
        "export_open_permits_match_db": manifest["open_permit_count"] == local["open_permits"],
        "export_open_permits_match_live": manifest["open_permit_count"] == live["open_permit_count"],
        "open_permits_file_count_matches_manifest": exported["open_permits_rows"] == manifest["files"]["open_permits"]["rows"],
        "general_contractors_file_count_matches_manifest": exported["general_contractors_rows"] == manifest["files"]["general_contractors"]["rows"],
        "open_subs_file_count_matches_manifest": exported["open_subs_rows"] == manifest["files"]["open_subs"]["rows"],
        "license_file_count_matches_manifest": exported["license_rows"] == manifest["files"]["contractor_licenses"]["rows"],
        "license_source_matches_live_fetch": manifest["license_source"]["rows"] == len(live_licenses["rows"]),
        "open_permit_statuses_are_open_only": exported["bad_open_status_rows"] == 0,
        "profiles_have_usable_processing_fields": exported["profiles_missing_usable_processing_field"] == 0,
    }

    return {
        "checks": checks,
        "local_db": local,
        "live_socrata": live,
        "exported": {
            key: value for key, value in exported.items()
            if key != "manifest"
        },
        "manifest": {
            "exported_at": manifest["exported_at"],
            "row_count": manifest["row_count"],
            "latest_issue_date": manifest["latest_issue_date"],
            "open_permit_count": manifest["open_permit_count"],
            "license_rows": manifest["license_source"]["rows"],
            "license_sources": [
                {"category": source["category"], "rows": source["rows"]}
                for source in manifest["license_source"]["sources"]
            ],
        },
        "live_license_rows": len(live_licenses["rows"]),
    }


def main() -> None:
    result = compare()
    print(json.dumps(result, indent=2, sort_keys=True))
    if not all(result["checks"].values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
