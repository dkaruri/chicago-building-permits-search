/**
 * One-off script: build profiles locally and upload to production KV.
 * Run: node seed-kv.js
 *
 * The CF Worker cron can't handle the full profile build within the
 * 10ms CPU limit on the free tier, so we seed KV from a local Node run.
 */

import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";

const SOCRATA_DOMAIN = "data.cityofchicago.org";
const DATASET_ID = "ydr8-5enu";
const KV_NAMESPACE_ID = "ef1c7094f8ec473aa1d1a00a63a392b3";
const OPEN_STATUSES = ["ACTIVE", "SUSPENDED", "PHASED PERMITTING"];
const OPEN_STATUS_CLAUSE = OPEN_STATUSES.map((s) => `'${s}'`).join(",");
const CONTACT_SLOTS = Array.from({ length: 15 }, (_, i) => i + 1);
const PAGE = 10000;

async function socrataQuery(params) {
  const url = new URL(`https://${SOCRATA_DOMAIN}/resource/${DATASET_ID}.json`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "chi-permits-seed/0.1" },
  });
  if (!res.ok) throw new Error(`Socrata ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchOpenPermits() {
  const contactCols = CONTACT_SLOTS.flatMap((i) => [
    `contact_${i}_type`, `contact_${i}_name`, `contact_${i}_city`,
    `contact_${i}_state`, `contact_${i}_zipcode`,
  ]);
  const selectCols = [
    "permit_", "permit_status", "permit_type", "review_type", "issue_date",
    "processing_time", "street_number", "street_direction", "street_name",
    "work_type", "work_description", "reported_cost", "total_fee",
    "ward", "community_area", "latitude", "longitude", ...contactCols,
  ].join(",");

  const permits = [];
  let offset = 0;
  while (true) {
    console.log(`  Fetching permits offset=${offset}...`);
    const page = await socrataQuery({
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

function classifyContact(type) {
  const t = (type || "").toUpperCase();
  if (t.includes("GENERAL CONTRACTOR")) return "general_contractor";
  if (t.includes("CONTRACTOR") || t.includes("ARCHITECT") || t.includes("ENGINEER") || t.includes("EXPEDIT") || t.includes("MASON")) return "open_tech";
  return "other";
}

function buildProfiles(permits, category) {
  const byName = {};
  for (const row of permits) {
    for (const i of CONTACT_SLOTS) {
      const name = (row[`contact_${i}_name`] || "").trim();
      const type = (row[`contact_${i}_type`] || "").trim();
      if (!name || classifyContact(type) !== category) continue;
      if (!byName[name]) {
        byName[name] = {
          contact_name: name, sample_contact_type: type,
          city: (row[`contact_${i}_city`] || "").trim(),
          state: (row[`contact_${i}_state`] || "").trim(),
          zipcode: (row[`contact_${i}_zipcode`] || "").trim(),
          permits: new Set(), open_permits: new Set(),
          processing_days: [], costs: 0, fees: 0,
          first_issue: null, latest_issue: null,
          work_types: {}, permit_types: {}, contact_types: {},
        };
      }
      const p = byName[name];
      const pn = row.permit_;
      if (!pn) continue;
      p.permits.add(pn);
      if (OPEN_STATUSES.includes(row.permit_status)) p.open_permits.add(pn);
      const pt = parseFloat(row.processing_time);
      if (pt > 0) p.processing_days.push(pt);
      const cost = parseFloat(row.reported_cost);
      if (cost > 0) p.costs += cost;
      const fee = parseFloat(row.total_fee);
      if (fee > 0) p.fees += fee;
      const d = (row.issue_date || "").slice(0, 10);
      if (d) {
        if (!p.first_issue || d < p.first_issue) p.first_issue = d;
        if (!p.latest_issue || d > p.latest_issue) p.latest_issue = d;
      }
      if (row.work_type) p.work_types[row.work_type] = (p.work_types[row.work_type] || 0) + 1;
      if (row.permit_type) p.permit_types[row.permit_type] = (p.permit_types[row.permit_type] || 0) + 1;
      if (type) p.contact_types[type] = (p.contact_types[type] || 0) + 1;
    }
  }
  const topN = (counts, n, key) => Object.entries(counts).sort(([,a],[,b]) => b - a).slice(0, n).map(([label, jobs]) => ({ [key]: label, jobs }));
  return Object.values(byName).map((p) => ({
    contact_name: p.contact_name, sample_contact_type: p.sample_contact_type,
    city: p.city, state: p.state, zipcode: p.zipcode,
    total_jobs: p.permits.size, open_jobs: p.open_permits.size,
    avg_processing_days: p.processing_days.length ? +(p.processing_days.reduce((a, b) => a + b, 0) / p.processing_days.length).toFixed(1) : 1.0,
    first_issue_date: p.first_issue, latest_issue_date: p.latest_issue,
    reported_cost_total: Math.round(p.costs), total_fee_total: Math.round(p.fees),
    work_types: topN(p.work_types, 6, "work_type"),
    permit_types: topN(p.permit_types, 6, "permit_type"),
    contact_types: topN(p.contact_types, 6, "contact_type"),
  })).sort((a, b) => b.open_jobs - a.open_jobs || b.total_jobs - a.total_jobs);
}

function normalizeLicenseName(value) {
  let t = (value || "").toUpperCase().replace(/&/g, " AND ");
  t = t.replace(/[^A-Z0-9 ]+/g, " ");
  t = t.replace(/\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|LTD|LLP|LP|L P|PLC|PC)\b/g, " ");
  t = t.replace(/\b(DBA|THE)\b/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

async function fetchLicenses() {
  const BASE = "https://webapps1.chicago.gov/licensedcontractors";
  const categories = {
    general: { endpoint: "general", orderColumn: 2, columns: ["licenseType","licenseNo","name","address","phone","licenseExpDate","insBond_ExpDt","lic_Inactive"] },
    active: { endpoint: "all", orderColumn: 2, columns: ["licenseType","licenseNo","name","address","phone","licenseExpDate","insBond_ExpDt","lic_Inactive"] },
    elevator: { endpoint: "elevator", orderColumn: 1, columns: ["licenseNo","name","address","phone","licenseExpDate","lic_Inactive"] },
    electrical: { endpoint: "electrical", orderColumn: 2, columns: ["licenseType","licenseNo","name","address","phone","licenseExpDate","lic_Inactive"] },
    mason: { endpoint: "mason", orderColumn: 2, columns: ["licenseType","licenseNo","name","address","phone","licenseExpDate","lic_Inactive"] },
    plumbing: { endpoint: "plumbing", orderColumn: 1, columns: ["licenseNo","name","address","phone","licenseExpDate","insBond_ExpDt","lic_Inactive"] },
  };
  const rowsByKey = new Map();
  for (const [key, cat] of Object.entries(categories)) {
    console.log(`  Scraping licenses: ${key}...`);
    const dataUrl = `${BASE}/allcontractors/paginated/${cat.endpoint}`;
    let total = null, start = 0;
    while (total === null || start < total) {
      const params = new URLSearchParams();
      params.set("draw", "1"); params.set("start", String(start)); params.set("length", "5000");
      params.set("order[0][column]", String(cat.orderColumn)); params.set("order[0][dir]", "asc");
      params.set("search[value]", ""); params.set("search[regex]", "false");
      cat.columns.forEach((col, i) => {
        params.set(`columns[${i}][data]`, col); params.set(`columns[${i}][name]`, col.toUpperCase());
        params.set(`columns[${i}][searchable]`, "true"); params.set(`columns[${i}][orderable]`, col === "name" ? "true" : "false");
        params.set(`columns[${i}][search][value]`, ""); params.set(`columns[${i}][search][regex]`, "false");
      });
      const res = await fetch(`${dataUrl}?${params}`, { headers: { Referer: `${BASE}/${key}`, "User-Agent": "chi-permits-seed/0.1" } });
      if (!res.ok) break;
      const payload = await res.json();
      if (total === null) total = parseInt(payload.recordsTotal || 0);
      const batch = payload.data || [];
      if (!batch.length) break;
      for (const item of batch) {
        const row = { license_type: item.licenseType || key, license_number: item.licenseNo, name: item.name, phone: item.phone, license_expiration_date: item.licenseExpDate };
        const rk = [row.license_type, row.license_number, normalizeLicenseName(row.name), row.license_expiration_date || "", row.phone || ""].join("|");
        if (!rowsByKey.has(rk)) rowsByKey.set(rk, row);
      }
      start += batch.length;
    }
  }
  return [...rowsByKey.values()];
}

function kvPut(key, file) {
  execSync(`npx wrangler kv key put --namespace-id ${KV_NAMESPACE_ID} "${key}" --path "${file}"`, { stdio: "inherit" });
}

async function main() {
  console.log("1. Fetching open permits from Socrata...");
  const permits = await fetchOpenPermits();
  console.log(`   ${permits.length} open permits`);

  console.log("2. Building profiles...");
  const gc = buildProfiles(permits, "general_contractor");
  const tech = buildProfiles(permits, "open_tech");
  console.log(`   ${gc.length} GC profiles, ${tech.length} tech profiles`);

  console.log("3. Scraping licenses...");
  const licenses = await fetchLicenses();
  console.log(`   ${licenses.length} license records`);

  // Enrich with license matches
  const licenseIndex = {};
  for (const row of licenses) {
    const key = normalizeLicenseName(row.name);
    if (!licenseIndex[key]) licenseIndex[key] = [];
    licenseIndex[key].push(row);
  }
  for (const profiles of [gc, tech]) {
    for (const p of profiles) {
      const matches = licenseIndex[normalizeLicenseName(p.contact_name)] || [];
      p.license_matches = matches.slice(0, 5).map((m) => ({ license_number: m.license_number, license_type: m.license_type, phone: m.phone, license_expiration_date: m.license_expiration_date }));
      p.license_match_count = matches.length;
    }
  }

  console.log("4. Uploading to production KV...");
  const tmpGc = "tmp_gc.json", tmpTech = "tmp_tech.json", tmpMeta = "tmp_meta.json";
  writeFileSync(tmpGc, JSON.stringify(gc));
  writeFileSync(tmpTech, JSON.stringify(tech));
  writeFileSync(tmpMeta, JSON.stringify({ fetched_at: new Date().toISOString(), rows: licenses.length }));

  kvPut("profiles:general_contractor", tmpGc);
  kvPut("profiles:open_tech", tmpTech);
  kvPut("licenses:meta", tmpMeta);

  unlinkSync(tmpGc); unlinkSync(tmpTech); unlinkSync(tmpMeta);

  console.log("Done! Production KV seeded.");
}

main().catch((e) => { console.error(e); process.exit(1); });
