from __future__ import annotations

import duckdb

from ..config import OPEN_STATUSES

OPEN_STATUS_SQL = "(" + ", ".join(f"'{s}'" for s in OPEN_STATUSES) + ")"


def rows(con: duckdb.DuckDBPyConnection, sql: str, params: list | None = None) -> list[dict]:
    cur = con.execute(sql, params or [])
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


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
               coalesce(avg(CASE WHEN processing_time > 0 THEN processing_time WHEN processing_time = 0 THEN 1.0 END), 1.0) AS avg_processing_days,
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
               coalesce(avg(CASE WHEN processing_time > 0 THEN processing_time WHEN processing_time = 0 THEN 1.0 END), 1.0) AS avg_processing_days,
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
