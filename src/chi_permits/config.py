from __future__ import annotations

import os
from datetime import date, datetime
from pathlib import Path

SOCRATA_DOMAIN = "data.cityofchicago.org"
DATASET_ID = "ydr8-5enu"
DATASET_NAME = "Chicago Building Permits"
PAGE_SIZE = 50000

SELECT_COLUMNS: tuple[str, ...] = (
    "id",
    "permit_",
    "permit_status",
    "permit_milestone",
    "permit_type",
    "review_type",
    "application_start_date",
    "issue_date",
    "processing_time",
    "street_number",
    "street_direction",
    "street_name",
    "work_type",
    "work_description",
    "permit_condition",
    "building_fee_paid",
    "zoning_fee_paid",
    "other_fee_paid",
    "subtotal_paid",
    "total_fee",
    "reported_cost",
    "pin_list",
    "community_area",
    "census_tract",
    "ward",
    "xcoordinate",
    "ycoordinate",
    "latitude",
    "longitude",
    "contact_1_type",
    "contact_1_name",
    "contact_1_city",
    "contact_1_state",
    "contact_1_zipcode",
    "contact_2_type",
    "contact_2_name",
    "contact_2_city",
    "contact_2_state",
    "contact_2_zipcode",
    "contact_3_type",
    "contact_3_name",
    "contact_3_city",
    "contact_3_state",
    "contact_3_zipcode",
    "contact_4_type",
    "contact_4_name",
    "contact_4_city",
    "contact_4_state",
    "contact_4_zipcode",
    "contact_5_type",
    "contact_5_name",
    "contact_5_city",
    "contact_5_state",
    "contact_5_zipcode",
    "contact_6_type",
    "contact_6_name",
    "contact_6_city",
    "contact_6_state",
    "contact_6_zipcode",
    "contact_7_type",
    "contact_7_name",
    "contact_7_city",
    "contact_7_state",
    "contact_7_zipcode",
    "contact_8_type",
    "contact_8_name",
    "contact_8_city",
    "contact_8_state",
    "contact_8_zipcode",
    "contact_9_type",
    "contact_9_name",
    "contact_9_city",
    "contact_9_state",
    "contact_9_zipcode",
    "contact_10_type",
    "contact_10_name",
    "contact_10_city",
    "contact_10_state",
    "contact_10_zipcode",
    "contact_11_type",
    "contact_11_name",
    "contact_11_city",
    "contact_11_state",
    "contact_11_zipcode",
    "contact_12_type",
    "contact_12_name",
    "contact_12_city",
    "contact_12_state",
    "contact_12_zipcode",
    "contact_13_type",
    "contact_13_name",
    "contact_13_city",
    "contact_13_state",
    "contact_13_zipcode",
    "contact_14_type",
    "contact_14_name",
    "contact_14_city",
    "contact_14_state",
    "contact_14_zipcode",
    "contact_15_type",
    "contact_15_name",
    "contact_15_city",
    "contact_15_state",
    "contact_15_zipcode",
)

OPEN_STATUSES: tuple[str, ...] = ("ACTIVE", "SUSPENDED", "PHASED PERMITTING")
OPEN_STATUS_SQL = "(" + ", ".join(f"'{s}'" for s in OPEN_STATUSES) + ")"


def home() -> Path:
    return Path(os.environ.get("CHI_PERMITS_HOME", Path.cwd())).expanduser()


def db_path() -> Path:
    env = os.environ.get("CHI_PERMITS_DB")
    if env:
        return Path(env).expanduser()
    return home() / "var" / "permits.duckdb"


def app_token() -> str | None:
    return os.environ.get("CHI_SOCRATA_APP_TOKEN") or os.environ.get("SOCRATA_APP_TOKEN")


def jsonable(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, list):
        return [jsonable(v) for v in value]
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    return value
