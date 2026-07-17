import { query, OPEN_STATUS_CLAUSE, CONTACT_SLOTS } from "./socrata.js";
import { normalizeLicenseName, fetchLicensedContractors } from "./licenses.js";

/**
 * Cron trigger: rebuild contractor profiles and license cache daily.
 *
 * Flow:
 * 1. Fetch all open permits from Socrata (paginated)
 * 2. Pivot contacts, classify, aggregate into profiles
 * 3. Scrape city license registry for phone numbers
 * 4. Enrich profiles with license matches
 * 5. Store in KV
 */
export async function rebuildCache(env) {
  console.log("Cron: starting profile rebuild");

  // 1. Fetch open permits with contacts
  const permits = await fetchOpenPermits(env);
  console.log(`Cron: fetched ${permits.length} open permits`);

  // 2. Pivot contacts and build profiles
  const gcProfiles = buildProfiles(permits, "general_contractor");
  const techProfiles = buildProfiles(permits, "open_tech");
  console.log(
    `Cron: ${gcProfiles.length} GC profiles, ${techProfiles.length} tech profiles`
  );

  // 3. Scrape licenses
  let licenseIndex = {};
  let licenseMeta = null;
  try {
    const licenses = await fetchLicensedContractors();
    licenseIndex = {};
    for (const row of licenses.rows) {
      const key = normalizeLicenseName(row.name);
      if (!licenseIndex[key]) licenseIndex[key] = [];
      licenseIndex[key].push(row);
    }
    licenseMeta = {
      fetched_at: licenses.fetched_at,
      rows: licenses.rows.length,
      sources: licenses.sources,
    };
    console.log(`Cron: ${licenses.rows.length} license records`);
  } catch (err) {
    console.error("Cron: license scrape failed, continuing without:", err.message);
  }

  // 4. Enrich profiles with license phone matches
  enrichWithLicenses(gcProfiles, licenseIndex);
  enrichWithLicenses(techProfiles, licenseIndex);

  // 5. Store in KV (25 MB max per key — profiles are ~10-20 MB each, fits)
  await env.CACHE.put(
    "profiles:general_contractor",
    JSON.stringify(gcProfiles)
  );
  await env.CACHE.put("profiles:open_tech", JSON.stringify(techProfiles));
  if (licenseMeta) {
    await env.CACHE.put("licenses:meta", JSON.stringify(licenseMeta));
  }

  // Invalidate stats cache so next request gets fresh counts
  await env.CACHE.delete("stats");

  console.log("Cron: rebuild complete");
}

/**
 * Paginate all open permits from Socrata with contact fields.
 */
async function fetchOpenPermits(env) {
  const PAGE = 10000;
  const permits = [];
  let offset = 0;

  const contactCols = CONTACT_SLOTS.flatMap((i) => [
    `contact_${i}_type`,
    `contact_${i}_name`,
    `contact_${i}_city`,
    `contact_${i}_state`,
    `contact_${i}_zipcode`,
  ]);

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
    ...contactCols,
  ].join(",");

  while (true) {
    const page = await query(env, {
      $select: selectCols,
      $where: `permit_status in(${OPEN_STATUS_CLAUSE})`,
      $order: "permit_",
      $limit: String(PAGE),
      $offset: String(offset),
    });
    permits.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }

  return permits;
}

/**
 * Pivot contacts from raw permit rows and aggregate into profiles.
 */
function buildProfiles(permits, category) {
  // Aggregate per contact_name
  const byName = {};

  for (const row of permits) {
    for (const i of CONTACT_SLOTS) {
      const name = (row[`contact_${i}_name`] || "").trim();
      const type = (row[`contact_${i}_type`] || "").trim();
      if (!name) continue;
      if (classifyContact(type) !== category) continue;

      if (!byName[name]) {
        byName[name] = {
          contact_name: name,
          sample_contact_type: type,
          city: (row[`contact_${i}_city`] || "").trim(),
          state: (row[`contact_${i}_state`] || "").trim(),
          zipcode: (row[`contact_${i}_zipcode`] || "").trim(),
          permits: new Set(),
          open_permits: new Set(),
          processing_days: [],
          costs: 0,
          fees: 0,
          first_issue: null,
          latest_issue: null,
          work_types: {},
          permit_types: {},
          contact_types: {},
        };
      }

      const profile = byName[name];
      const permitNum = row.permit_;
      if (!permitNum) continue;

      profile.permits.add(permitNum);
      const status = row.permit_status || "";
      if (["ACTIVE", "SUSPENDED", "PHASED PERMITTING"].includes(status)) {
        profile.open_permits.add(permitNum);
      }

      const pt = parseFloat(row.processing_time);
      if (pt > 0) profile.processing_days.push(pt);

      const cost = parseFloat(row.reported_cost);
      if (cost > 0) profile.costs += cost;

      const fee = parseFloat(row.total_fee);
      if (fee > 0) profile.fees += fee;

      const issueDate = (row.issue_date || "").slice(0, 10);
      if (issueDate) {
        if (!profile.first_issue || issueDate < profile.first_issue)
          profile.first_issue = issueDate;
        if (!profile.latest_issue || issueDate > profile.latest_issue)
          profile.latest_issue = issueDate;
      }

      if (row.work_type) {
        profile.work_types[row.work_type] =
          (profile.work_types[row.work_type] || 0) + 1;
      }
      if (row.permit_type) {
        profile.permit_types[row.permit_type] =
          (profile.permit_types[row.permit_type] || 0) + 1;
      }
      if (type) {
        profile.contact_types[type] =
          (profile.contact_types[type] || 0) + 1;
      }
    }
  }

  // Flatten into sorted array
  return Object.values(byName)
    .map((p) => ({
      contact_name: p.contact_name,
      sample_contact_type: p.sample_contact_type,
      city: p.city,
      state: p.state,
      zipcode: p.zipcode,
      total_jobs: p.permits.size,
      open_jobs: p.open_permits.size,
      avg_processing_days: p.processing_days.length
        ? +(p.processing_days.reduce((a, b) => a + b, 0) / p.processing_days.length).toFixed(1)
        : 1.0,
      first_issue_date: p.first_issue,
      latest_issue_date: p.latest_issue,
      reported_cost_total: Math.round(p.costs),
      total_fee_total: Math.round(p.fees),
      work_types: topN(p.work_types, 6, "work_type"),
      permit_types: topN(p.permit_types, 6, "permit_type"),
      contact_types: topN(p.contact_types, 6, "contact_type"),
    }))
    .sort((a, b) => b.open_jobs - a.open_jobs || b.total_jobs - a.total_jobs);
}

function classifyContact(type) {
  const t = (type || "").toUpperCase();
  if (t.includes("GENERAL CONTRACTOR")) return "general_contractor";
  if (
    t.includes("CONTRACTOR") ||
    t.includes("ARCHITECT") ||
    t.includes("ENGINEER") ||
    t.includes("EXPEDIT") ||
    t.includes("MASON")
  )
    return "open_tech";
  return "other";
}

function topN(counts, n, labelKey) {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([label, jobs]) => ({ [labelKey]: label, jobs }));
}

function enrichWithLicenses(profiles, licenseIndex) {
  for (const profile of profiles) {
    const key = normalizeLicenseName(profile.contact_name);
    const matches = licenseIndex[key] || [];
    profile.license_matches = matches.slice(0, 5).map((m) => ({
      license_number: m.license_number,
      license_type: m.license_type,
      phone: m.phone,
      license_expiration_date: m.license_expiration_date,
    }));
    profile.license_match_count = matches.length;
  }
}
