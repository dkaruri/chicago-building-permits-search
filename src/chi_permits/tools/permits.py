from __future__ import annotations

import duckdb

ALLOWED_GROUPS = {
    "permit_type",
    "permit_status",
    "permit_milestone",
    "review_type",
    "work_type",
    "ward",
    "community_area",
}
ALLOWED_METRICS = {"count", "reported_cost", "total_fee", "processing_time"}
ALLOWED_RANKS = {"reported_cost", "total_fee", "processing_time"}
OPEN_STATUS_SQL = "('ACTIVE', 'SUSPENDED', 'PHASED PERMITTING')"


def rows(con: duckdb.DuckDBPyConnection, sql: str, params: list | None = None) -> list[dict]:
    cur = con.execute(sql, params or [])
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def dataset_info_from(con: duckdb.DuckDBPyConnection) -> dict:
    meta = rows(con, "SELECT * FROM meta")[0]
    date_span = rows(con, "SELECT min(issue_date) AS first_issue_date, max(issue_date) AS latest_issue_date FROM permits")[0]
    by_type = rows(con, """
        SELECT permit_type, count(*) AS permits
        FROM permits
        GROUP BY permit_type
        ORDER BY permits DESC
        LIMIT 12
    """)
    return {
        "dataset": meta,
        "date_span": date_span,
        "top_permit_types": by_type,
        "tables": {
            "permits": "Focused permit records with dates, status/type, fees/cost, address, ward/community area, and coordinates.",
            "contacts": "Normalized permit contact slots with public name/city/state/ZIP and derived contact_category.",
            "meta": "Source freshness and ingest metadata.",
        },
        "caveats": [
            "Reported cost is applicant-reported and not an audited valuation.",
            "The source says permits later voided or revoked are excluded.",
            "Contact information is limited to the public fields in the source: type, name, city, state, and ZIP code. Phone/email are not present.",
            "Open permits are treated as permit_status in ACTIVE, SUSPENDED, or PHASED PERMITTING.",
        ],
    }


def permit_lookup_from(con: duckdb.DuckDBPyConnection, query: str, n: int = 10) -> dict:
    like = f"%{query.lower()}%"
    out = rows(con, """
        SELECT permit_number, permit_status, permit_type, review_type, issue_date,
               address, ward, community_area, reported_cost, total_fee, work_type,
               left(work_description, 220) AS work_description
        FROM permits
        WHERE lower(coalesce(permit_number, '')) = lower(?)
           OR lower(coalesce(id, '')) = lower(?)
           OR lower(coalesce(address, '')) LIKE ?
           OR lower(coalesce(work_description, '')) LIKE ?
        ORDER BY issue_date DESC NULLS LAST
        LIMIT ?
    """, [query, query, like, like, n])
    return {"query": query, "rows": out, "row_count": len(out)}


def recent_permits_from(con: duckdb.DuckDBPyConnection, n: int = 20,
                        permit_type: str | None = None,
                        ward: int | None = None) -> dict:
    clauses = ["issue_date IS NOT NULL"]
    params: list = []
    if permit_type:
        clauses.append("lower(permit_type) = lower(?)")
        params.append(permit_type)
    if ward is not None:
        clauses.append("ward = ?")
        params.append(ward)
    params.append(n)
    out = rows(con, f"""
        SELECT permit_number, permit_status, permit_type, review_type, issue_date,
               address, ward, community_area, reported_cost, total_fee,
               left(work_description, 180) AS work_description
        FROM permits
        WHERE {' AND '.join(clauses)}
        ORDER BY issue_date DESC, permit_number
        LIMIT ?
    """, params)
    return {"rows": out, "row_count": len(out), "filters": {"permit_type": permit_type, "ward": ward}}


def permit_breakdown_from(con: duckdb.DuckDBPyConnection, group_by: str = "permit_type",
                          metric: str = "count", n: int = 20) -> dict:
    if group_by not in ALLOWED_GROUPS:
        return {"error": f"group_by must be one of {sorted(ALLOWED_GROUPS)}"}
    if metric not in ALLOWED_METRICS:
        return {"error": f"metric must be one of {sorted(ALLOWED_METRICS)}"}
    if metric == "count":
        value_expr = "count(*)"
    else:
        value_expr = f"sum({metric})"
    out = rows(con, f"""
        SELECT {group_by} AS group_value,
               count(*) AS permit_count,
               sum(reported_cost) AS reported_cost_total,
               sum(total_fee) AS total_fee_total,
               avg(processing_time) AS avg_processing_time,
               {value_expr} AS metric_value
        FROM permits
        GROUP BY {group_by}
        ORDER BY metric_value DESC NULLS LAST
        LIMIT ?
    """, [n])
    return {"group_by": group_by, "metric": metric, "rows": out}


def permit_trends_from(con: duckdb.DuckDBPyConnection, grain: str = "month",
                       metric: str = "count", permit_type: str | None = None,
                       ward: int | None = None, community_area: int | None = None,
                       start_date: str | None = None, end_date: str | None = None,
                       n: int = 120) -> dict:
    if grain not in {"month", "year"}:
        return {"error": "grain must be 'month' or 'year'"}
    if metric not in ALLOWED_METRICS:
        return {"error": f"metric must be one of {sorted(ALLOWED_METRICS)}"}
    value_expr = "count(*)" if metric == "count" else f"sum({metric})"
    clauses = ["issue_date IS NOT NULL"]
    params: list = []
    if permit_type:
        clauses.append("lower(permit_type) = lower(?)")
        params.append(permit_type)
    if ward is not None:
        clauses.append("ward = ?")
        params.append(ward)
    if community_area is not None:
        clauses.append("community_area = ?")
        params.append(community_area)
    if start_date:
        clauses.append("issue_date >= try_cast(? AS DATE)")
        params.append(start_date)
    if end_date:
        clauses.append("issue_date <= try_cast(? AS DATE)")
        params.append(end_date)
    params.append(n)
    out = rows(con, f"""
        SELECT date_trunc('{grain}', issue_date)::DATE AS period,
               count(*) AS permit_count,
               sum(reported_cost) AS reported_cost_total,
               sum(total_fee) AS total_fee_total,
               avg(processing_time) AS avg_processing_time,
               {value_expr} AS metric_value
        FROM permits
        WHERE {' AND '.join(clauses)}
        GROUP BY period
        ORDER BY period DESC
        LIMIT ?
    """, params)
    out.reverse()
    return {
        "grain": grain,
        "metric": metric,
        "filters": {
            "permit_type": permit_type,
            "ward": ward,
            "community_area": community_area,
            "start_date": start_date,
            "end_date": end_date,
        },
        "rows": out,
    }


def top_permits_from(con: duckdb.DuckDBPyConnection, rank_by: str = "reported_cost",
                     n: int = 20, permit_type: str | None = None,
                     ward: int | None = None) -> dict:
    if rank_by not in ALLOWED_RANKS:
        return {"error": f"rank_by must be one of {sorted(ALLOWED_RANKS)}"}
    clauses = [f"{rank_by} IS NOT NULL"]
    params: list = []
    if permit_type:
        clauses.append("lower(permit_type) = lower(?)")
        params.append(permit_type)
    if ward is not None:
        clauses.append("ward = ?")
        params.append(ward)
    params.append(n)
    out = rows(con, f"""
        SELECT permit_number, permit_status, permit_type, review_type, issue_date,
               address, ward, community_area, reported_cost, total_fee, processing_time,
               left(work_description, 180) AS work_description
        FROM permits
        WHERE {' AND '.join(clauses)}
        ORDER BY {rank_by} DESC NULLS LAST
        LIMIT ?
    """, params)
    return {"rank_by": rank_by, "rows": out, "filters": {"permit_type": permit_type, "ward": ward}}


def open_permits_from(con: duckdb.DuckDBPyConnection, n: int = 50,
                      query: str | None = None,
                      contact_category: str | None = None,
                      ward: int | None = None) -> dict:
    clauses = [f"p.permit_status IN {OPEN_STATUS_SQL}"]
    params: list = []
    if query:
        like = f"%{query.lower()}%"
        clauses.append("(lower(coalesce(p.permit_number, '')) LIKE ? OR lower(coalesce(p.address, '')) LIKE ? OR lower(coalesce(p.work_description, '')) LIKE ? OR lower(coalesce(c.contact_name, '')) LIKE ?)")
        params.extend([like, like, like, like])
    if contact_category:
        clauses.append("c.contact_category = ?")
        params.append(contact_category)
    if ward is not None:
        clauses.append("p.ward = ?")
        params.append(ward)
    params.append(n)
    out = rows(con, f"""
        SELECT DISTINCT p.permit_number, p.permit_status, p.permit_type, p.review_type,
               p.issue_date, p.address, p.ward, p.community_area, p.reported_cost,
               p.total_fee, p.processing_time, left(p.work_description, 180) AS work_description
        FROM permits p
        LEFT JOIN contacts c USING (permit_number)
        WHERE {' AND '.join(clauses)}
        ORDER BY p.issue_date DESC NULLS LAST
        LIMIT ?
    """, params)
    return {"rows": out, "row_count": len(out), "open_statuses": ["ACTIVE", "SUSPENDED", "PHASED PERMITTING"]}


def contact_summary_from(con: duckdb.DuckDBPyConnection, category: str = "general_contractor",
                         query: str | None = None, n: int = 50) -> dict:
    if category not in {"general_contractor", "open_tech", "other"}:
        return {"error": "category must be general_contractor, open_tech, or other"}
    clauses = ["contact_category = ?", "nullif(trim(coalesce(contact_name, '')), '') IS NOT NULL"]
    params: list = [category]
    if query:
        like = f"%{query.lower()}%"
        clauses.append("(lower(contact_name) LIKE ? OR lower(coalesce(contact_type, '')) LIKE ? OR lower(coalesce(contact_city, '')) LIKE ?)")
        params.extend([like, like, like])
    params.append(n)
    out = rows(con, f"""
        SELECT contact_name,
               any_value(contact_type) AS sample_contact_type,
               any_value(contact_city) AS city,
               any_value(contact_state) AS state,
               any_value(contact_zipcode) AS zipcode,
               count(DISTINCT permit_number) AS total_jobs,
               count(DISTINCT CASE WHEN permit_status IN {OPEN_STATUS_SQL} THEN permit_number END) AS open_jobs,
               avg(processing_time) AS avg_processing_days,
               max(issue_date) AS latest_issue_date,
               sum(reported_cost) AS reported_cost_total,
               sum(total_fee) AS total_fee_total
        FROM contacts
        WHERE {' AND '.join(clauses)}
        GROUP BY contact_name
        ORDER BY open_jobs DESC, total_jobs DESC
        LIMIT ?
    """, params)
    return {"category": category, "query": query, "rows": out}


def contact_detail_from(con: duckdb.DuckDBPyConnection, contact_name: str,
                        category: str | None = None, n: int = 50) -> dict:
    clauses = ["lower(contact_name) = lower(?)"]
    params: list = [contact_name]
    if category:
        clauses.append("contact_category = ?")
        params.append(category)
    summary_params = list(params)
    params.append(n)
    jobs = rows(con, f"""
        SELECT permit_number, permit_status, permit_type, issue_date, address, ward,
               community_area, contact_type, contact_city, contact_state, contact_zipcode,
               reported_cost, total_fee, processing_time
        FROM contacts
        WHERE {' AND '.join(clauses)}
        ORDER BY CASE WHEN permit_status IN {OPEN_STATUS_SQL} THEN 0 ELSE 1 END,
                 issue_date DESC NULLS LAST
        LIMIT ?
    """, params)
    summary = rows(con, f"""
        SELECT contact_name,
               count(DISTINCT permit_number) AS total_jobs,
               count(DISTINCT CASE WHEN permit_status IN {OPEN_STATUS_SQL} THEN permit_number END) AS open_jobs,
               avg(processing_time) AS avg_processing_days,
               min(issue_date) AS first_issue_date,
               max(issue_date) AS latest_issue_date
        FROM contacts
        WHERE {' AND '.join(clauses)}
        GROUP BY contact_name
    """, summary_params)
    contact_clauses = [
        clause.replace("lower(contact_name)", "lower(c.contact_name)").replace("contact_category", "c.contact_category")
        for clause in clauses
    ]
    top_work_types = rows(con, f"""
        SELECT p.work_type,
               count(DISTINCT c.permit_number) AS jobs,
               count(DISTINCT CASE WHEN c.permit_status IN {OPEN_STATUS_SQL} THEN c.permit_number END) AS open_jobs
        FROM contacts c
        JOIN permits p USING (permit_number)
        WHERE {' AND '.join(contact_clauses)}
          AND nullif(trim(coalesce(p.work_type, '')), '') IS NOT NULL
        GROUP BY p.work_type
        ORDER BY jobs DESC, open_jobs DESC
        LIMIT 8
    """, summary_params)
    top_permit_types = rows(con, f"""
        SELECT permit_type,
               count(DISTINCT permit_number) AS jobs,
               count(DISTINCT CASE WHEN permit_status IN {OPEN_STATUS_SQL} THEN permit_number END) AS open_jobs
        FROM contacts
        WHERE {' AND '.join(clauses)}
          AND nullif(trim(coalesce(permit_type, '')), '') IS NOT NULL
        GROUP BY permit_type
        ORDER BY jobs DESC, open_jobs DESC
        LIMIT 8
    """, summary_params)
    top_contact_types = rows(con, f"""
        SELECT contact_type,
               count(DISTINCT permit_number) AS jobs
        FROM contacts
        WHERE {' AND '.join(clauses)}
          AND nullif(trim(coalesce(contact_type, '')), '') IS NOT NULL
        GROUP BY contact_type
        ORDER BY jobs DESC
        LIMIT 8
    """, summary_params)
    return {
        "contact_name": contact_name,
        "summary": summary[0] if summary else None,
        "specialties": {
            "work_types": top_work_types,
            "permit_types": top_permit_types,
            "contact_types": top_contact_types,
        },
        "jobs": jobs,
    }
