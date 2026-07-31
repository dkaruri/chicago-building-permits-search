// Local response helper, not index.js's `json` — importing index.js pulls in
// `cloudflare:workers` (the Durable Object), which node --test cannot load, and
// this module has tests. Same pattern as profiles.js / tags.js / notes.js. The
// router re-attaches CORS headers to every handler response, so nothing is lost.
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

import {
  query,
  pivotContacts,
  buildAddress,
  classifyContact,
  OPEN_STATUS_CLAUSE,
} from "./socrata.js";

/**
 * GET /api/permits?q=&ward=&status=&type=&contact_name=&cost_min=&cost_max=&limit=&offset=
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
  // FEAT-021. Filtered in SoQL rather than on the client because this endpoint
  // caps at 1000 rows ordered by issue_date DESC — a client-side range filter
  // would quietly drop every match that fell outside that first page.
  const costMin = numericParam(url.searchParams.get("cost_min"));
  const costMax = numericParam(url.searchParams.get("cost_max"));
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
  if (costMin != null) {
    whereClauses.push(`reported_cost >= ${costMin}`);
  }
  if (costMax != null) {
    whereClauses.push(`reported_cost <= ${costMax}`);
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

  return json({ rows: results, row_count: results.length, offset, limit });
}

/**
 * Parse a numeric query param, or null if absent/not a finite number.
 * These land in SoQL unquoted, so anything non-numeric must be dropped
 * outright rather than escaped.
 */
function numericParam(value) {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Strip characters that could break SoQL string literals. */
function sanitize(value) {
  return value.replace(/['"\\]/g, "");
}
