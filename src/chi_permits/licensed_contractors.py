from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import httpx

BASE_URL = "https://webapps1.chicago.gov/licensedcontractors"
LICENSE_CATEGORIES = {
    "active": {
        "label": "All Trade Contractors",
        "page_slug": "active",
        "endpoint_slug": "all",
        "order_column": 2,
        "columns": [
            ("licenseType", "LICENSETYPE", "false"),
            ("licenseNo", "LICENSENO", "false"),
            ("name", "NAME", "true"),
            ("address", "ADDRESS", "false"),
            ("phone", "PHONE", "false"),
            ("licenseExpDate", "LICENSEEXPDATE", "false"),
            ("insBond_ExpDt", "INSBOND_EXPDT", "false"),
            ("lic_Inactive", "LIC_INACTIVE", "false"),
        ],
    },
    "general": {
        "label": "General Contractors",
        "page_slug": "general",
        "endpoint_slug": "general",
        "order_column": 2,
        "columns": [
            ("licenseType", "LICENSETYPE", "false"),
            ("licenseNo", "LICENSENO", "false"),
            ("name", "NAME", "true"),
            ("address", "ADDRESS", "false"),
            ("phone", "PHONE", "false"),
            ("licenseExpDate", "LICENSEEXPDATE", "false"),
            ("insBond_ExpDt", "LICENSEEXPDATE", "false"),
            ("lic_Inactive", "LIC_INACTIVE", "false"),
        ],
    },
    "elevator": {
        "label": "Elevator Mechanic Contractors",
        "page_slug": "elevator",
        "endpoint_slug": "elevator",
        "order_column": 1,
        "columns": [
            ("licenseNo", "LICENSENO", "false"),
            ("name", "NAME", "true"),
            ("address", "ADDRESS", "false"),
            ("phone", "PHONE", "false"),
            ("licenseExpDate", "LICENSEEXPDATE", "false"),
            ("lic_Inactive", "LIC_INACTIVE", "false"),
        ],
    },
    "electrical": {
        "label": "Electrical Contractors",
        "page_slug": "electrical",
        "endpoint_slug": "electrical",
        "order_column": 2,
        "columns": [
            ("licenseType", "LICENSETYPE", "false"),
            ("licenseNo", "LICENSENO", "false"),
            ("name", "NAME", "true"),
            ("address", "ADDRESS", "false"),
            ("phone", "PHONE", "false"),
            ("licenseExpDate", "LICENSEEXPDATE", "false"),
            ("lic_Inactive", "LIC_INACTIVE", "false"),
        ],
    },
    "mason": {
        "label": "Mason Contractors",
        "page_slug": "mason",
        "endpoint_slug": "mason",
        "order_column": 2,
        "columns": [
            ("licenseType", "LICENSETYPE", "false"),
            ("licenseNo", "LICENSENO", "false"),
            ("name", "NAME", "true"),
            ("address", "ADDRESS", "false"),
            ("phone", "PHONE", "false"),
            ("licenseExpDate", "LICENSEEXPDATE", "false"),
            ("lic_Inactive", "LIC_INACTIVE", "false"),
        ],
    },
    "plumbing": {
        "label": "Plumbing Contractors",
        "page_slug": "plumbing",
        "endpoint_slug": "plumbing",
        "order_column": 1,
        "columns": [
            ("licenseNo", "LICENSENO", "false"),
            ("name", "NAME", "true"),
            ("address", "ADDRESS", "false"),
            ("phone", "PHONE", "false"),
            ("licenseExpDate", "LICENSEEXPDATE", "false"),
            ("insBond_ExpDt", "INSBOND_EXPDT", "false"),
            ("lic_Inactive", "LIC_INACTIVE", "false"),
        ],
    },
}


def normalize_license_name(value: str | None) -> str:
    text = (value or "").upper().replace("&", " AND ")
    text = re.sub(r"[^A-Z0-9 ]+", " ", text)
    text = re.sub(
        r"\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|LTD|LLP|LP|L P|PLC|PC)\b",
        " ",
        text,
    )
    text = re.sub(r"\b(DBA|THE)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _license_params(category: dict[str, Any], start: int, length: int) -> dict[str, Any]:
    params: dict[str, Any] = {
        "draw": "1",
        "start": str(start),
        "length": str(length),
        "order[0][column]": str(category["order_column"]),
        "order[0][dir]": "asc",
        "search[value]": "",
        "search[regex]": "false",
    }
    for index, (data, name, orderable) in enumerate(category["columns"]):
        params[f"columns[{index}][data]"] = data
        params[f"columns[{index}][name]"] = name
        params[f"columns[{index}][searchable]"] = "true"
        params[f"columns[{index}][orderable]"] = orderable
        params[f"columns[{index}][search][value]"] = ""
        params[f"columns[{index}][search][regex]"] = "false"
    return params


def _row_key(row: dict[str, Any]) -> tuple[str, str, str, str, str]:
    return (
        str(row.get("license_type") or ""),
        str(row.get("license_number") or ""),
        normalize_license_name(row.get("name")),
        str(row.get("license_expiration_date") or ""),
        str(row.get("phone") or ""),
    )


def fetch_licensed_contractors(page_size: int = 5000) -> dict[str, Any]:
    fetched_at = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    headers = {
        "Referer": f"{BASE_URL}/active",
        "User-Agent": "chi-permits-search/0.1",
    }
    rows_by_key: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    sources: list[dict[str, Any]] = []
    with httpx.Client(timeout=60, headers=headers, follow_redirects=True) as client:
        for key, category in LICENSE_CATEGORIES.items():
            source_url = f"{BASE_URL}/{category['page_slug']}"
            data_url = f"{BASE_URL}/allcontractors/paginated/{category['endpoint_slug']}"
            total: int | None = None
            fetched = 0
            start = 0
            while total is None or start < total:
                response = client.get(
                    data_url,
                    params=_license_params(category, start, page_size),
                    headers={"Referer": source_url},
                )
                response.raise_for_status()
                payload = response.json()
                if total is None:
                    total = int(payload.get("recordsTotal") or payload.get("recordsFiltered") or 0)
                batch = payload.get("data") or []
                if not batch:
                    break
                for item in batch:
                    row = {
                        "license_category": key,
                        "license_category_label": category["label"],
                        "license_type": item.get("licenseType") or category["label"],
                        "license_number": item.get("licenseNo"),
                        "name": item.get("name"),
                        "address": item.get("address"),
                        "phone": item.get("phone"),
                        "license_expiration_date": item.get("licenseExpDate"),
                        "insurance_expiration_date": item.get("insBond_ExpDt"),
                        "license_inactive": item.get("lic_Inactive"),
                        "source_url": source_url,
                    }
                    row_id = _row_key(row)
                    existing = rows_by_key.get(row_id)
                    if existing:
                        categories = set(existing["source_categories"])
                        categories.add(key)
                        existing["source_categories"] = sorted(categories)
                        urls = set(existing["source_urls"])
                        urls.add(source_url)
                        existing["source_urls"] = sorted(urls)
                    else:
                        row["source_categories"] = [key]
                        row["source_urls"] = [source_url]
                        rows_by_key[row_id] = row
                    fetched += 1
                start += len(batch)
            sources.append({
                "category": key,
                "label": category["label"],
                "source_url": source_url,
                "data_url": data_url,
                "rows": fetched,
            })
    rows = sorted(rows_by_key.values(), key=lambda row: (normalize_license_name(row.get("name")), row.get("license_number") or ""))
    return {
        "source_url": f"{BASE_URL}/active",
        "fetched_at": fetched_at,
        "sources": sources,
        "rows": rows,
    }


def fetch_general_contractor_licenses(page_size: int = 5000) -> dict[str, Any]:
    licenses = fetch_licensed_contractors(page_size)
    licenses["rows"] = [
        row for row in licenses["rows"]
        if "general" in row.get("source_categories", []) or row.get("license_category") == "general"
    ]
    return licenses
