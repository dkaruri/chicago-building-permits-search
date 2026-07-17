import { json } from "./index.js";
import {
  query,
  pivotContacts,
  buildAddress,
  classifyContact,
  OPEN_STATUS_CLAUSE,
} from "./socrata.js";

/**
 * GET /api/permits?q=&ward=&status=&type=&contact_name=&limit=&offset=
 *
 * Proxies to Socrata with contact pivoting.
 * Returns { rows, row_count, offset, limit }.
 */
export async function handlePermits(url, env) {
  const q = url.searchParams.get("q") || "";
  const ward = url.searchParams.get("ward") || "";
  const status = url.searchParams.get("status") || "";
  const permitType = url.searchParams.get("type") || "";
  const contactName = url.searchParams.get("contact_name") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const whereClauses = [];

  // Default to open permits unless status is explicitly set
  if (status) {
    whereClauses.push(`permit_status='${sanitize(status)}'`);
  } else {
    whereClauses.push(`permit_status in(${OPEN_STATUS_CLAUSE})`);
  }

  if (ward) {
    whereClauses.push(`ward='${sanitize(ward)}'`);
  }
  if (permitType) {
    whereClauses.push(`permit_type='${sanitize(permitType)}'`);
  }
  if (q) {
    whereClauses.push(
      `(upper(street_name) LIKE '%${sanitize(q.toUpperCase())}%' ` +
        `OR upper(work_description) LIKE '%${sanitize(q.toUpperCase())}%' ` +
        `OR permit_ LIKE '%${sanitize(q)}%')`
    );
  }
  if (contactName) {
    const cn = sanitize(contactName.toUpperCase());
    const contactSearch = Array.from({ length: 15 }, (_, i) =>
      `upper(contact_${i + 1}_name) LIKE '%${cn}%'`
    ).join(" OR ");
    whereClauses.push(`(${contactSearch})`);
  }

  const selectCols = [
    "permit_",
    "permit_status",
    "permit_type",
    "review_type",
    "issue_date",
    "processing_time",
    "street_number",
    "street_direction",
    "street_name",
    "work_type",
    "work_description",
    "reported_cost",
    "total_fee",
    "ward",
    "community_area",
    "latitude",
    "longitude",
    ...Array.from(
      { length: 15 },
      (_, i) =>
        `contact_${i + 1}_type,contact_${i + 1}_name,contact_${i + 1}_city,contact_${i + 1}_state,contact_${i + 1}_zipcode`
    ),
  ].join(",");

  const rows = await query(env, {
    $select: selectCols,
    $where: whereClauses.join(" AND "),
    $order: "issue_date DESC",
    $limit: String(limit),
    $offset: String(offset),
  });

  const results = rows.map((row) => {
    const contacts = pivotContacts(row);
    const gcNames = contacts
      .filter((c) => classifyContact(c.type) === "general_contractor")
      .map((c) => c.name);
    const subNames = contacts
      .filter((c) => classifyContact(c.type) === "open_tech")
      .map((c) => c.name);
    return {
      permit_number: row.permit_,
      permit_status: row.permit_status,
      permit_type: row.permit_type,
      review_type: row.review_type,
      issue_date: (row.issue_date || "").slice(0, 10),
      processing_time: row.processing_time
        ? parseFloat(row.processing_time)
        : null,
      address: buildAddress(row),
      work_type: row.work_type,
      work_description: row.work_description || "",
      reported_cost: row.reported_cost ? parseFloat(row.reported_cost) : null,
      total_fee: row.total_fee ? parseFloat(row.total_fee) : null,
      ward: row.ward ? parseInt(row.ward) : null,
      community_area: row.community_area ? parseInt(row.community_area) : null,
      latitude: row.latitude ? parseFloat(row.latitude) : null,
      longitude: row.longitude ? parseFloat(row.longitude) : null,
      general_contractors: gcNames.join(" | "),
      open_subs: subNames.join(" | "),
      contacts,
    };
  });

  return json({ rows: results, row_count: results.length, offset, limit }, 200, env);
}

/** Strip characters that could break SoQL string literals. */
function sanitize(value) {
  return value.replace(/['"\\]/g, "");
}
