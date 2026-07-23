const PERMIT_RE = /^[A-Za-z0-9-]{1,16}$/;
const NOTE_ID_RE = /^n_[0-9a-f]{8}$/;
const MAX_TEXT = 2000;
const MAX_NAME = 120;
const MAX_POSTS = 200;
const JOBS = new Set(["new", "remodel"]);
const ONSITE = new Set(["none", "gc", "sub"]);
const ESTIMATES = new Set(["same-day", "1-3d", "week", "longer", "unknown"]);
const PHOTO_ID_RE = /^p_[0-9a-f]{8}$/;

export function sanitizePhotoRefs(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || !PHOTO_ID_RE.test(String(item.id))) continue;
    out.push({ id: item.id, caption: String(item.caption ?? "").slice(0, 200) });
    if (out.length >= 6) break;
  }
  return out;
}

function resp(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export function makeNoteId() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return "n_" + [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

export function sanitizeText(value) {
  return String(value ?? "").trim().slice(0, MAX_TEXT);
}

function sanitizeParty(value) {
  if (!value || typeof value !== "object") return null;
  const name = String(value.name ?? "").trim().slice(0, MAX_NAME);
  if (!name) return null;
  const jobs = Number(value.jobs);
  return {
    name,
    phone: String(value.phone ?? "").replace(/[^0-9+() .-]/g, "").slice(0, 24),
    covers: String(value.covers ?? "").slice(0, MAX_NAME),
    jobs: Number.isInteger(jobs) && jobs > 0 && jobs < 1000 ? jobs : null,
    estimate: ESTIMATES.has(value.estimate) ? value.estimate : "unknown",
  };
}

export function sanitizeWalk(body) {
  const b = body && typeof body === "object" ? body : {};
  const onsite = ONSITE.has(b.onsite) ? b.onsite : "none";
  const party = onsite === "none" ? null : sanitizeParty(b.party);
  // Only a sub on site has a separate "their GC" block.
  const gc = onsite === "sub" && b.gc && typeof b.gc === "object"
    ? (() => {
        const name = String(b.gc.name ?? "").trim().slice(0, MAX_NAME);
        return name ? { name, phone: String(b.gc.phone ?? "").replace(/[^0-9+() .-]/g, "").slice(0, 24) } : null;
      })()
    : null;
  return { job: JOBS.has(b.job) ? b.job : "remodel", onsite, party, gc };
}

async function readThread(env, permit) {
  const stored = await env.CACHE.getWithMetadata("note:" + permit);
  if (!stored.value) return [];
  try { const a = JSON.parse(stored.value); return Array.isArray(a) ? a : []; } catch { return []; }
}

async function writeThread(env, permit, thread) {
  if (!thread.length) { await env.CACHE.delete("note:" + permit); return; }
  const capped = thread.slice(0, MAX_POSTS);
  await env.CACHE.put("note:" + permit, JSON.stringify(capped), { metadata: { n: capped.length } });
}

export async function handleNotes(url, env, request) {
  // GET /api/notes/counts?p=a,b,c — one list() covers every noted permit.
  if (url.pathname === "/api/notes/counts") {
    const want = new Set((url.searchParams.get("p") || "").split(",").filter(Boolean));
    const listed = await env.CACHE.list({ prefix: "note:" });
    const counts = {};
    for (const key of listed.keys) {
      const permit = key.name.slice(5);
      const n = Number(key.metadata && key.metadata.n);
      if (want.has(permit) && n > 0) counts[permit] = n;
    }
    return resp({ counts }, 200);
  }

  const m = url.pathname.match(/^\/api\/notes\/([^/]+)(?:\/([^/]+))?$/);
  if (!m) return resp({ error: "not found" }, 404);
  const permit = decodeURIComponent(m[1]);
  const noteId = m[2];
  if (!PERMIT_RE.test(permit)) return resp({ error: "bad permit" }, 400);

  if (request.method === "GET" && !noteId) {
    return resp({ notes: await readThread(env, permit) }, 200);
  }

  if (request.method === "POST" && !noteId) {
    let body;
    try { body = JSON.parse(await request.text()); } catch { return resp({ error: "bad json" }, 400); }
    const author = String(body.author ?? "").trim().slice(0, 40) || "anonymous";
    const now = Math.floor(Date.now() / 1000);
    const base = { id: makeNoteId(), author, ts: now, editedTs: null };
    let post;
    if (body.kind === "walk") post = { ...base, kind: "walk", ...sanitizeWalk(body) };
    else if (body.kind === "photo") {
      const photos = sanitizePhotoRefs(body.photos);
      const text = sanitizeText(body.text);
      if (!photos.length && !text) return resp({ error: "empty" }, 400);
      post = { ...base, kind: "photo", text, photos };
    }
    else {
      const text = sanitizeText(body.text);
      if (!text) return resp({ error: "empty" }, 400);
      post = { ...base, kind: "text", text };
    }
    const thread = await readThread(env, permit);
    thread.push(post);
    await writeThread(env, permit, thread);
    return resp({ id: post.id }, 200);
  }

  if ((request.method === "PUT" || request.method === "DELETE") && noteId) {
    if (!NOTE_ID_RE.test(noteId)) return resp({ error: "bad id" }, 400);
    const thread = await readThread(env, permit);
    const i = thread.findIndex(p => p.id === noteId);
    if (i < 0) return resp({ error: "not found" }, 404);
    if (request.method === "DELETE") {
      thread.splice(i, 1);
    } else {
      let body;
      try { body = JSON.parse(await request.text()); } catch { return resp({ error: "bad json" }, 400); }
      const post = thread[i];
      if (post.kind === "walk") Object.assign(post, sanitizeWalk(body));
      else if (post.kind === "photo") {
        if (body.text !== undefined) post.text = sanitizeText(body.text);
        if (body.photos !== undefined) post.photos = sanitizePhotoRefs(body.photos);
      }
      else { const text = sanitizeText(body.text); if (!text) return resp({ error: "empty" }, 400); post.text = text; }
      post.editedTs = Math.floor(Date.now() / 1000);
    }
    await writeThread(env, permit, thread);
    return resp({ ok: true }, 200);
  }

  return resp({ error: "method not allowed" }, 405);
}
