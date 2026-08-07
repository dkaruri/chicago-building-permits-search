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
 * Client sort key -> SoQL column. FEAT-044.
 *
 * An allowlist, not a passthrough: these land in `$order` and must never be
 * interpolated from user input. An unrecognised key falls back to the default
 * AND is reported back in the response as `sort`, so the client can tell that
 * what it asked for is not what it got — a silent fallback here would be the
 * same class of lie as the truncation this feature is fixing.
 *
 * `address` is deliberately absent. It is composed from street_number,
 * street_direction and street_name and has no single sortable column;
 * approximating it as `street_name, street_number` would sort "100" before
 * "99" within a street, because street_number is TEXT in the source. Rather
 * than ship an ordering that is subtly wrong, address is not sortable.
 */
const SORT_COLUMNS = {
  issued: "issue_date",
  cost: "reported_cost",
  permit_number: "permit_",
  permit_status: "permit_status",
};

const DEFAULT_ORDER = "issue_date DESC";

/**
 * GET /api/permits?q=&ward=&status=&type=&contact_name=&cost_min=&cost_max=
 *                 &usable_processing=&sort=&dir=&limit=&offset=
 *
 * Proxies to Socrata with contact pivoting.
 * Returns { rows, row_count, total, offset, limit, sort, dir }.
 * `total` counts every row matching the filters, not the page — the client
 * pages against it, so it must come from the SAME where-clause as the rows.
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
  // FEAT-044. "Usable processing only" used to filter client-side AFTER the
  // fetch. Once the client pages against `total`, a post-fetch filter would
  // shrink pages unpredictably and desynchronise them from the count — so the
  // rule has to live where the counting happens.
  if (url.searchParams.get("usable_processing") === "1") {
    whereClauses.push("processing_time > 0");
  }

  // Built ONCE and handed to both queries. If the count and the rows could be
  // built from different clauses the pager would confidently page past the end
  // of the result set, or stop short of it.
  const where = whereClauses.join(" AND ");

  const sortKey = url.searchParams.get("sort") || "";
  const column = SORT_COLUMNS[sortKey];
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
  // NULL LAST is not decoration. Socrata sorts NULLs FIRST on DESC, and 3,646
  // of 40,868 open permits have no reported_cost (8.9%, measured 2026-08-07) —
  // so "sort by Cost, highest first" would have opened on roughly 24 pages of
  // blank-cost permits before the most expensive one. Only reported_cost is
  // nullable among these four today (issue_date, permit_status and permit_ all
  // measured zero), but it costs nothing to be right if that changes.
  const order = column ? `${column} ${dir.toUpperCase()} NULL LAST` : DEFAULT_ORDER;

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

  // Both in flight together — the count is a separate round trip and there is
  // no reason to pay for it serially.
  const [rows, countRows] = await Promise.all([
    query(env, {
      $select: selectCols,
      $where: where,
      $order: order,
      $limit: String(limit),
      $offset: String(offset),
    }),
    query(env, { $select: "count(1)", $where: where }),
  ]);
  const total = parseInt(countRows?.[0]?.count_1 ?? "", 10);

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

  return json({
    rows: results,
    row_count: results.length,
    // Null rather than 0 if the count query came back unparseable: a client
    // that pages against 0 shows "no results" for a full page of rows, whereas
    // a null is an obvious "unknown" it can fall back on.
    total: Number.isFinite(total) ? total : null,
    offset,
    limit,
    // Echoed so the client can see whether its sort was honoured. "" means the
    // default order, including when an unsupported key was asked for.
    sort: column ? sortKey : "",
    dir: column ? dir : "desc",
  });
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
