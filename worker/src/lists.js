const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const PERMIT_RE = /^[A-Za-z0-9-]{1,16}$/;
const MAX_PERMITS = 220;

const LIST_TTL = 15552000;
const MAX_BODY = 8192;
const ID_RE = /^[A-Za-z0-9]{1,16}$/;

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
    await env.CACHE.put("list:" + id, JSON.stringify({ v: 1, p: permits, f: focal }), { expirationTtl: LIST_TTL });
    return resp({ id }, 200);
  }
  if (request.method === "GET" && !isCollection) {
    const id = url.pathname.replace(/^\/api\/lists\//, "");
    if (!ID_RE.test(id)) return resp({ error: "not found" }, 404);
    const stored = await env.CACHE.get("list:" + id);
    if (!stored) return resp({ error: "not found" }, 404);
    let data;
    try { data = JSON.parse(stored); } catch { return resp({ error: "not found" }, 404); }
    return resp({ permits: data.p || [], focal: data.f || null }, 200);
  }
  return resp({ error: "method not allowed" }, 405);
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
