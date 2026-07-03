PRIMER = """
Chicago Building Permits MCP over the City of Chicago Socrata dataset ydr8-5enu.

Domain notes:
- A permit row represents a permit record from the public Building Permits dataset.
- The dataset excludes permits later voided or revoked according to the source description.
- `issue_date` is the main time axis for trend questions; `application_start_date` is useful for processing-time context.
- `reported_cost` is applicant-reported and should be treated as an estimate, not audited project value.
- Geography fields are permit-record attributes: ward, community_area, census_tract, latitude/longitude.
- Fees and costs are numeric but may be missing; rankings and sums exclude NULL values.
- Contacts are intentionally not ingested in this focused first version; use the source dataset for full contact fields.
"""
