const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const PERMIT_RE = /^[A-Za-z0-9-]{1,16}$/;
const MAX_PERMITS = 220;

const LIST_TTL = 15552000;
const MAX_BODY = 8192;
const ID_RE = /^[A-Za-z0-9]{1,16}$/;

const MAX_TITLE = 80;
const MAX_AUTHOR = 40;
const MAX_BLURB = 160;
const MAX_DESC = 2000;
const MAX_TAGS = 8;
const MAX_TAG_LEN = 24;
const PAGE_SIZE = 200;

function resp(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export async function handleLists(url, env, request) {
  const isCollection = url.pathname === "/api/lists" || url.pathname === "/api/lists/";
  if (request.method === "POST" && isCollection) {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return resp({ error: "too large" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return resp({ error: "bad json" }, 400); }
    const permits = sanitizePermits(body && body.permits);
    if (!permits.length) return resp({ error: "no valid permits" }, 400);
    const focal = sanitizeFocal(body && body.focal);
    const id = makeShareId();
    const now = Math.floor(Date.now() / 1000);
    const value = { v: 2, p: permits, f: focal, desc: String(body.desc ?? "").slice(0, MAX_DESC), custom: [], ticks: {} };
    const metadata = buildListMeta(value, body, now);
    await env.CACHE.put("list:" + id, JSON.stringify(value), { expirationTtl: LIST_TTL, metadata });
    return resp({ id }, 200);
  }
  if (request.method === "GET" && isCollection) {
    const cursor = url.searchParams.get("cursor") || undefined;
    const listed = await env.CACHE.list({ prefix: "list:", limit: PAGE_SIZE, cursor });
    const rows = filterEntries(listed.keys, url.searchParams.get("q"), url.searchParams.get("tag"))
      .map(entry => ({ id: entry.name.slice(5), ...(entry.metadata || {}) }))
      .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
    return resp({ lists: rows, cursor: listed.list_complete ? null : listed.cursor }, 200);
  }
  if (request.method === "GET" && !isCollection) {
    const id = url.pathname.replace(/^\/api\/lists\//, "");
    if (!ID_RE.test(id)) return resp({ error: "not found" }, 404);
    const { value: stored, metadata } = await env.CACHE.getWithMetadata("list:" + id);
    const data = readList(stored);
    if (!data) return resp({ error: "not found" }, 404);
    return resp({
      permits: data.p,
      focal: data.f,
      desc: data.desc,
      custom: data.custom,
      ticks: data.ticks,
      meta: metadata || null,
    }, 200);
  }
  return resp({ error: "method not allowed" }, 405);
}

// KV.list() cannot filter by metadata, so a page is fetched first and filtered
// after. A 200-key page can therefore yield fewer than 200 rows while a cursor
// still remains — the client must key "load more" off the cursor, never a count.
export function filterEntries(entries, q, tag) {
  const needle = String(q || "").trim().toLowerCase();
  const wanted = String(tag || "").trim().toLowerCase();
  return entries.filter(entry => {
    const m = entry.metadata;
    if (!m) return !needle && !wanted;
    const tags = Array.isArray(m.tags) ? m.tags.map(t => String(t[0]).toLowerCase()) : [];
    if (wanted && !tags.includes(wanted)) return false;
    if (!needle) return true;
    const hay = [m.title, m.author, m.blurb, ...tags].join(" ").toLowerCase();
    return hay.includes(needle);
  });
}

export function makeShareId(len = 7) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += ID_ALPHABET[bytes[i] % 62];
  return out;
}

export function sanitizePermits(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const s = String(item);
    if (PERMIT_RE.test(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s);
      if (out.length >= MAX_PERMITS) break;
    }
  }
  return out;
}

export function sanitizeFocal(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: String(value.label ?? "").slice(0, 120) };
}

// Normalises any stored payload to the v2 shape. A missing `v` means v1,
// which is what the live YnF7y4t share link still holds.
export function readList(stored) {
  if (!stored) return null;
  let data;
  try { data = JSON.parse(stored); } catch { return null; }
  if (!data || typeof data !== "object") return null;
  return {
    v: 2,
    p: Array.isArray(data.p) ? data.p : [],
    f: data.f || null,
    desc: typeof data.desc === "string" ? data.desc : "",
    custom: Array.isArray(data.custom) ? data.custom : [],
    ticks: data.ticks && typeof data.ticks === "object" ? data.ticks : {},
  };
}

export function sanitizeMeta(body) {
  const b = body && typeof body === "object" ? body : {};
  const str = (v, n) => String(v ?? "").slice(0, n);
  const tags = (Array.isArray(b.tags) ? b.tags : [])
    .filter(t => Array.isArray(t) && t.length === 2
      && typeof t[0] === "string" && t[0].length > 0 && t[0].length <= MAX_TAG_LEN
      && Number.isInteger(t[1]) && t[1] >= 0 && t[1] <= 9)
    .slice(0, MAX_TAGS);
  return {
    title: str(b.title, MAX_TITLE) || "Untitled list",
    author: str(b.author, MAX_AUTHOR),
    blurb: str(b.desc, MAX_BLURB),
    tags,
  };
}

// KV caps metadata at 1024 bytes. Every field here is clamped by sanitizeMeta,
// so the worst case is title 80 + author 40 + blurb 160 + 8 tags + numbers.
export function buildListMeta(stored, metaInput, now) {
  const meta = sanitizeMeta({ ...metaInput, desc: metaInput?.blurb ?? stored?.desc });
  const permits = Array.isArray(stored?.p) ? stored.p.length : 0;
  const customs = Array.isArray(stored?.custom) ? stored.custom.length : 0;
  const ts = Number(now) || 0;
  return {
    title: meta.title,
    author: meta.author,
    blurb: meta.blurb,
    tags: meta.tags,
    count: permits + customs,
    publishedAt: ts,
    editedAt: ts,
    rev: 1,
  };
}
