import { json } from "./index.js";
import { query, OPEN_STATUS_CLAUSE } from "./socrata.js";

const CACHE_TTL = 3600; // 1 hour

/**
 * GET /api/stats
 *
 * Returns live dataset stats from Socrata (cached 1 hour in KV).
 */
export async function handleStats(url, env) {
  const cached = await env.CACHE.get("stats", "json");
  if (cached) return json(cached, 200, env);

  const [countResult, openResult, dateResult] = await Promise.all([
    query(env, { $select: "count(*) as total" }),
    query(env, {
      $select: "count(*) as open_count",
      $where: `permit_status in(${OPEN_STATUS_CLAUSE})`,
    }),
    query(env, {
      $select: "min(issue_date) as first_date, max(issue_date) as latest_date",
    }),
  ]);

  const stats = {
    row_count: parseInt(countResult[0].total),
    open_permit_count: parseInt(openResult[0].open_count),
    first_issue_date: (dateResult[0].first_date || "").slice(0, 10),
    latest_issue_date: (dateResult[0].latest_date || "").slice(0, 10),
    cached_at: new Date().toISOString(),
  };

  // Add profile counts if available
  const gcProfiles = await env.CACHE.get("profiles:general_contractor", "json");
  const techProfiles = await env.CACHE.get("profiles:open_tech", "json");
  stats.general_contractor_count = gcProfiles ? gcProfiles.length : null;
  stats.open_sub_count = techProfiles ? techProfiles.length : null;

  const licenseData = await env.CACHE.get("licenses:meta", "json");
  if (licenseData) {
    stats.license_source = licenseData;
  }

  await env.CACHE.put("stats", JSON.stringify(stats), {
    expirationTtl: CACHE_TTL,
  });

  return json(stats, 200, env);
}
