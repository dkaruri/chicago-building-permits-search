/**
 * Socrata SODA API client.
 * All queries go through here so the app token and domain are centralized.
 */

const OPEN_STATUSES = ["ACTIVE", "SUSPENDED", "PHASED PERMITTING"];
const OPEN_STATUS_CLAUSE = OPEN_STATUSES.map((s) => `'${s}'`).join(",");

// Columns available on ydr8-5enu
const CONTACT_SLOTS = Array.from({ length: 15 }, (_, i) => i + 1);

export { OPEN_STATUSES, OPEN_STATUS_CLAUSE, CONTACT_SLOTS };

/**
 * Query the Socrata dataset. Returns parsed JSON.
 * @param {object} env - Worker env with SOCRATA_DOMAIN, DATASET_ID, SOCRATA_APP_TOKEN
 * @param {Record<string, string>} params - SoQL parameters ($select, $where, etc.)
 */
export async function query(env, params) {
  const url = new URL(
    `https://${env.SOCRATA_DOMAIN}/resource/${env.DATASET_ID}.json`
  );
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }

  const headers = { "User-Agent": "chi-permits-worker/0.1" };
  if (env.SOCRATA_APP_TOKEN) {
    headers["X-App-Token"] = env.SOCRATA_APP_TOKEN;
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Socrata ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Pivot a single Socrata permit row's 15 contact_N_* columns into an array.
 * Returns [{slot, type, name, city, state, zipcode, category}]
 */
export function pivotContacts(row) {
  const contacts = [];
  for (const i of CONTACT_SLOTS) {
    const name = (row[`contact_${i}_name`] || "").trim();
    const type = (row[`contact_${i}_type`] || "").trim();
    if (!name && !type) continue;
    contacts.push({
      slot: i,
      type,
      name,
      city: (row[`contact_${i}_city`] || "").trim(),
      state: (row[`contact_${i}_state`] || "").trim(),
      zipcode: (row[`contact_${i}_zipcode`] || "").trim(),
      category: classifyContact(type),
    });
  }
  return contacts;
}

/**
 * Classify a contact_type string into general_contractor / open_tech / other.
 * Mirrors ingest.py::_contact_category_expr.
 */
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

/**
 * Build an address string from Socrata's split fields.
 */
export function buildAddress(row) {
  return [row.street_number, row.street_direction, row.street_name]
    .filter(Boolean)
    .join(" ")
    .trim();
}
