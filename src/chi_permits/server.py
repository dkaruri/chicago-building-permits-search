from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from .db import DBMissingError, ro_conn
from .primer import PRIMER
from .tools.permits import (
    contact_detail_from,
    contact_summary_from,
    dataset_info_from,
    open_permits_from,
    permit_breakdown_from,
    permit_lookup_from,
    permit_trends_from,
    recent_permits_from,
    top_permits_from,
)
from .tools.sql import run_sql_on

mcp = FastMCP("chi-permits", instructions=PRIMER)


def _with_conn(fn, *args, **kwargs):
    try:
        with ro_conn() as con:
            return fn(con, *args, **kwargs)
    except DBMissingError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def dataset_info() -> dict:
    """Source freshness, row count, date span, top permit types, tables, and caveats."""
    return _with_conn(dataset_info_from)


@mcp.tool()
def permit_lookup(query: str, n: int = 10) -> dict:
    """Look up permits by permit number, source id, address text, or work-description text."""
    return _with_conn(permit_lookup_from, query, n)


@mcp.tool()
def recent_permits(n: int = 20, permit_type: str | None = None, ward: int | None = None) -> dict:
    """Most recently issued permits, optionally filtered by permit_type and/or ward."""
    return _with_conn(recent_permits_from, n, permit_type, ward)


@mcp.tool()
def permit_breakdown(group_by: str = "permit_type", metric: str = "count", n: int = 20) -> dict:
    """Aggregate permits by permit_type/status/milestone/review_type/work_type/ward/community_area.

    metric: count | reported_cost | total_fee | processing_time.
    """
    return _with_conn(permit_breakdown_from, group_by, metric, n)


@mcp.tool()
def permit_trends(grain: str = "month", metric: str = "count",
                  permit_type: str | None = None, ward: int | None = None,
                  community_area: int | None = None,
                  start_date: str | None = None, end_date: str | None = None,
                  n: int = 120) -> dict:
    """Trend permits by issue_date month/year.

    metric: count | reported_cost | total_fee | processing_time.
    Optional filters: permit_type, ward, community_area, start_date, end_date.
    """
    return _with_conn(permit_trends_from, grain, metric, permit_type, ward,
                      community_area, start_date, end_date, n)


@mcp.tool()
def top_permits(rank_by: str = "reported_cost", n: int = 20,
                permit_type: str | None = None, ward: int | None = None) -> dict:
    """Rank permits by reported_cost, total_fee, or processing_time."""
    return _with_conn(top_permits_from, rank_by, n, permit_type, ward)


@mcp.tool()
def open_permits(n: int = 50, query: str | None = None,
                 contact_category: str | None = None,
                 ward: int | None = None) -> dict:
    """Search open permits. Open means ACTIVE, SUSPENDED, or PHASED PERMITTING.

    Optional contact_category: general_contractor | open_tech | other.
    """
    return _with_conn(open_permits_from, n, query, contact_category, ward)


@mcp.tool()
def general_contractors(query: str | None = None, n: int = 50) -> dict:
    """Summarize General Contractors: public contact fields, open jobs, total jobs, avg processing days."""
    return _with_conn(contact_summary_from, "general_contractor", query, n)


@mcp.tool()
def open_techs(query: str | None = None, n: int = 50) -> dict:
    """Summarize trade/technical contacts: contractors, architects, engineers, expediters, masons."""
    return _with_conn(contact_summary_from, "open_tech", query, n)


@mcp.tool()
def contact_detail(contact_name: str, category: str | None = None, n: int = 50) -> dict:
    """List permits for one contact, including open-job counts and average processing time."""
    return _with_conn(contact_detail_from, contact_name, category, n)


@mcp.tool()
def run_sql(query: str) -> dict:
    """Run a read-only SELECT/WITH query against the local DuckDB.

    Main table: permits. Useful columns include permit_number, permit_status,
    permit_type, review_type, application_start_date, issue_date, processing_time,
    address, work_type, work_description, total_fee, reported_cost, community_area,
    census_tract, ward, latitude, longitude.
    """
    return _with_conn(run_sql_on, query)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
