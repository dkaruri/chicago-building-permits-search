import { json } from "./index.js";

/**
 * GET /api/profiles?category=general_contractor|open_tech&q=&limit=&offset=
 *
 * Serves precomputed contractor profiles from KV cache.
 * Profiles are rebuilt daily by the cron handler.
 */
export async function handleProfiles(url, env) {
  const category = url.searchParams.get("category") || "general_contractor";
  if (!["general_contractor", "open_tech"].includes(category)) {
    return json({ error: "category must be general_contractor or open_tech" }, 400, env);
  }

  const cached = await env.CACHE.get(`profiles:${category}`, "json");
  if (!cached) {
    return json(
      { error: "Profile cache not built yet. Run wrangler dispatch or wait for cron." },
      503,
      env
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
    200,
    env
  );
}

/**
 * GET /api/contact/:name?category=
 *
 * Serves a single contractor's full profile from KV cache.
 */
export async function handleContactDetail(url, env) {
  const name = decodeURIComponent(url.pathname.replace("/api/contact/", ""));
  if (!name) {
    return json({ error: "name is required in URL path" }, 400, env);
  }

  const category = url.searchParams.get("category") || "general_contractor";
  const cached = await env.CACHE.get(`profiles:${category}`, "json");
  if (!cached) {
    return json({ error: "Profile cache not built yet." }, 503, env);
  }

  const match = cached.find(
    (r) => (r.contact_name || "").toLowerCase() === name.toLowerCase()
  );
  if (!match) {
    return json({ error: "Contact not found", name }, 404, env);
  }

  return json(match, 200, env);
}
