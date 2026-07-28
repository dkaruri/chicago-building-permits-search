// Local response helper, not index.js's `json` — importing index.js pulls in
// `cloudflare:workers` (the Durable Object), which node --test cannot load, and
// this module has tests. Same pattern as tags.js / notes.js. The router
// re-attaches CORS headers to every handler response, so nothing is lost.
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * GET /api/profiles?category=general_contractor|open_tech&q=&limit=&offset=
 *
 * Serves precomputed contractor profiles from KV cache.
 * Profiles are rebuilt daily by the cron handler.
 */
export async function handleProfiles(url, env) {
  const category = url.searchParams.get("category") || "general_contractor";
  if (!["general_contractor", "open_tech"].includes(category)) {
    return json({ error: "category must be general_contractor or open_tech" }, 400);
  }

  const cached = await env.CACHE.get(`profiles:${category}`, "json");
  if (!cached) {
    return json(
      { error: "Profile cache not built yet. Run wrangler dispatch or wait for cron." },
      503
    );
  }

  let rows = cached;

  // Client-side filter on name
  const q = (url.searchParams.get("q") || "").toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) =>
        (r.contact_name || "").toLowerCase().includes(q) ||
        (r.sample_contact_type || "").toLowerCase().includes(q) ||
        (r.city || "").toLowerCase().includes(q)
    );
  }

  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 5000);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const page = rows.slice(offset, offset + limit);

  return json(
    { category, rows: page, total: rows.length, offset, limit },
    200
  );
}

const CATEGORIES = ["general_contractor", "open_tech"];

/**
 * Loose form of a company name, for the last rung of the matching ladder:
 * upper-cased, punctuation stripped, whitespace collapsed, and a single
 * trailing corporate suffix dropped. Mirrors the client's normContractor —
 * keep the two in step.
 *
 * Known limitation: a trade name that genuinely ends in one of these words
 * ("SMITH CO") folds into its stem ("SMITH"). Only ever reached after exact
 * and cross-category matching both miss.
 */
export function normalizeContractorName(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(INC|LLC|CO|CORP|LTD)$/, "")
    .trim();
}

/**
 * GET /api/contact/:name?category=
 *
 * Serves a single contractor's full profile from KV cache, resolving the name
 * through a three-rung ladder: exact (case-insensitive) in the requested
 * category, then exact in the other category, then normalized in either.
 * Matching lives here rather than on the client so a client never has to
 * download a 5,000-row category list to resolve one name.
 *
 * The response carries `matched_as` and `matched_category` so the caller can
 * tell an exact hit from a fuzzy one, plus `seeded_at` for staleness.
 */
export async function handleContactDetail(url, env) {
  const name = decodeURIComponent(url.pathname.replace("/api/contact/", ""));
  if (!name) {
    return json({ error: "name is required in URL path" }, 400);
  }

  const requested = url.searchParams.get("category") || "general_contractor";
  if (!CATEGORIES.includes(requested)) {
    return json({ error: "category must be general_contractor or open_tech" }, 400);
  }
  // Requested category first, so an exact hit there always wins.
  const order = [requested, ...CATEGORIES.filter((c) => c !== requested)];

  const loaded = [];
  for (const category of order) {
    const rows = await env.CACHE.get(`profiles:${category}`, "json");
    if (rows) loaded.push([category, rows]);
  }
  if (!loaded.length) {
    return json({ error: "Profile cache not built yet." }, 503);
  }

  const lower = name.toLowerCase();
  let hit = null;
  // Rungs 1 and 2: exact, requested category before the other one.
  for (const [category, rows] of loaded) {
    const row = rows.find((r) => (r.contact_name || "").toLowerCase() === lower);
    if (row) { hit = { row, category }; break; }
  }
  // Rung 3: normalized, same category order. An empty normal form (a name that
  // is punctuation only) must not match every other unnameable row.
  if (!hit) {
    const norm = normalizeContractorName(name);
    if (norm) {
      for (const [category, rows] of loaded) {
        const row = rows.find((r) => normalizeContractorName(r.contact_name) === norm);
        if (row) { hit = { row, category }; break; }
      }
    }
  }
  if (!hit) {
    return json({ error: "Contact not found", name }, 404);
  }

  const seededAt = await env.CACHE.get(`profiles:${hit.category}:seeded_at`, "text");
  return json(
    {
      ...hit.row,
      matched_as: hit.row.contact_name,
      matched_category: hit.category,
      ...(seededAt ? { seeded_at: seededAt } : {}),
    },
    200
  );
}
