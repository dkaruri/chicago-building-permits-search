from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import httpx

LICENSE_SOURCE_URL = "https://webapps1.chicago.gov/licensedcontractors/general"
LICENSE_DATA_URL = "https://webapps1.chicago.gov/licensedcontractors/allcontractors/paginated/general"


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


def _license_params(start: int, length: int) -> dict[str, Any]:
    params: dict[str, Any] = {
        "draw": "1",
        "start": str(start),
        "length": str(length),
        "order[0][column]": "2",
        "order[0][dir]": "asc",
        "search[value]": "",
        "search[regex]": "false",
    }
    columns = [
        ("licenseType", "LICENSETYPE", "false"),
        ("licenseNo", "LICENSENO", "false"),
        ("name", "NAME", "true"),
        ("address", "ADDRESS", "false"),
        ("phone", "PHONE", "false"),
        ("licenseExpDate", "LICENSEEXPDATE", "false"),
        ("insBond_ExpDt", "LICENSEEXPDATE", "false"),
        ("lic_Inactive", "LIC_INACTIVE", "false"),
    ]
    for index, (data, name, orderable) in enumerate(columns):
        params[f"columns[{index}][data]"] = data
        params[f"columns[{index}][name]"] = name
        params[f"columns[{index}][searchable]"] = "true"
        params[f"columns[{index}][orderable]"] = orderable
        params[f"columns[{index}][search][value]"] = ""
        params[f"columns[{index}][search][regex]"] = "false"
    return params


def fetch_general_contractor_licenses(page_size: int = 5000) -> dict[str, Any]:
    headers = {
        "Referer": LICENSE_SOURCE_URL,
        "User-Agent": "chi-permits-search/0.1",
    }
    rows: list[dict[str, Any]] = []
    with httpx.Client(timeout=60, headers=headers, follow_redirects=True) as client:
        start = 0
        total: int | None = None
        while total is None or start < total:
            response = client.get(LICENSE_DATA_URL, params=_license_params(start, page_size))
            response.raise_for_status()
            payload = response.json()
            if total is None:
                total = int(payload.get("recordsTotal") or payload.get("recordsFiltered") or 0)
            batch = payload.get("data") or []
            if not batch:
                break
            rows.extend(
                {
                    "license_type": item.get("licenseType"),
                    "license_number": item.get("licenseNo"),
                    "name": item.get("name"),
                    "address": item.get("address"),
                    "phone": item.get("phone"),
                    "license_expiration_date": item.get("licenseExpDate"),
                    "insurance_expiration_date": item.get("insBond_ExpDt"),
                    "license_inactive": item.get("lic_Inactive"),
                }
                for item in batch
            )
            start += len(batch)
    return {
        "source_url": LICENSE_SOURCE_URL,
        "data_url": LICENSE_DATA_URL,
        "fetched_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "rows": rows,
    }
