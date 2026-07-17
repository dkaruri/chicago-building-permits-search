/**
 * Licensed contractor scraper — JS port of licensed_contractors.py.
 * Fetches from https://webapps1.chicago.gov/licensedcontractors
 */

const BASE_URL = "https://webapps1.chicago.gov/licensedcontractors";

const LICENSE_CATEGORIES = {
  general: {
    label: "General Contractors",
    endpoint: "general",
    orderColumn: 2,
    columns: ["licenseType", "licenseNo", "name", "address", "phone", "licenseExpDate", "insBond_ExpDt", "lic_Inactive"],
  },
  active: {
    label: "All Trade Contractors",
    endpoint: "all",
    orderColumn: 2,
    columns: ["licenseType", "licenseNo", "name", "address", "phone", "licenseExpDate", "insBond_ExpDt", "lic_Inactive"],
  },
  elevator: {
    label: "Elevator Mechanic Contractors",
    endpoint: "elevator",
    orderColumn: 1,
    columns: ["licenseNo", "name", "address", "phone", "licenseExpDate", "lic_Inactive"],
  },
  electrical: {
    label: "Electrical Contractors",
    endpoint: "electrical",
    orderColumn: 2,
    columns: ["licenseType", "licenseNo", "name", "address", "phone", "licenseExpDate", "lic_Inactive"],
  },
  mason: {
    label: "Mason Contractors",
    endpoint: "mason",
    orderColumn: 2,
    columns: ["licenseType", "licenseNo", "name", "address", "phone", "licenseExpDate", "lic_Inactive"],
  },
  plumbing: {
    label: "Plumbing Contractors",
    endpoint: "plumbing",
    orderColumn: 1,
    columns: ["licenseNo", "name", "address", "phone", "licenseExpDate", "insBond_ExpDt", "lic_Inactive"],
  },
};

/**
 * Normalize a name for fuzzy license matching.
 * Mirrors licensed_contractors.py::normalize_license_name.
 */
export function normalizeLicenseName(value) {
  let text = (value || "").toUpperCase().replace(/&/g, " AND ");
  text = text.replace(/[^A-Z0-9 ]+/g, " ");
  text = text.replace(
    /\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|LTD|LLP|LP|L P|PLC|PC)\b/g,
    " "
  );
  text = text.replace(/\b(DBA|THE)\b/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Fetch all licensed contractors from the city registry.
 * Returns { fetched_at, sources, rows }.
 */
export async function fetchLicensedContractors(pageSize = 5000) {
  const fetchedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const rowsByKey = new Map();
  const sources = [];

  for (const [key, category] of Object.entries(LICENSE_CATEGORIES)) {
    const sourceUrl = `${BASE_URL}/${key}`;
    const dataUrl = `${BASE_URL}/allcontractors/paginated/${category.endpoint}`;
    let total = null;
    let fetched = 0;
    let start = 0;

    while (total === null || start < total) {
      const params = buildParams(category, start, pageSize);
      const res = await fetch(`${dataUrl}?${params}`, {
        headers: {
          Referer: sourceUrl,
          "User-Agent": "chi-permits-worker/0.1",
        },
      });

      if (!res.ok) {
        console.error(`License fetch failed for ${key}: ${res.status}`);
        break;
      }

      const payload = await res.json();
      if (total === null) {
        total = parseInt(payload.recordsTotal || payload.recordsFiltered || 0);
      }

      const batch = payload.data || [];
      if (!batch.length) break;

      for (const item of batch) {
        const row = {
          license_category: key,
          license_type: item.licenseType || category.label,
          license_number: item.licenseNo,
          name: item.name,
          address: item.address,
          phone: item.phone,
          license_expiration_date: item.licenseExpDate,
          insurance_expiration_date: item.insBond_ExpDt,
          source_url: sourceUrl,
        };

        const rowKey = [
          row.license_type || "",
          row.license_number || "",
          normalizeLicenseName(row.name),
          row.license_expiration_date || "",
          row.phone || "",
        ].join("|");

        if (!rowsByKey.has(rowKey)) {
          rowsByKey.set(rowKey, row);
        }
        fetched++;
      }
      start += batch.length;
    }

    sources.push({ category: key, label: category.label, rows: fetched });
  }

  const rows = [...rowsByKey.values()].sort((a, b) =>
    normalizeLicenseName(a.name).localeCompare(normalizeLicenseName(b.name))
  );

  return { fetched_at: fetchedAt, sources, rows };
}

function buildParams(category, start, length) {
  const p = new URLSearchParams();
  p.set("draw", "1");
  p.set("start", String(start));
  p.set("length", String(length));
  p.set("order[0][column]", String(category.orderColumn));
  p.set("order[0][dir]", "asc");
  p.set("search[value]", "");
  p.set("search[regex]", "false");

  category.columns.forEach((col, i) => {
    p.set(`columns[${i}][data]`, col);
    p.set(`columns[${i}][name]`, col.toUpperCase());
    p.set(`columns[${i}][searchable]`, "true");
    p.set(`columns[${i}][orderable]`, col === "name" ? "true" : "false");
    p.set(`columns[${i}][search][value]`, "");
    p.set(`columns[${i}][search][regex]`, "false");
  });

  return p.toString();
}
