const MAX_TAG_LEN = 24;
const TAG_STRIP = /[^a-z0-9 \-_]/g;

function resp(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

// MUST stay byte-identical to normalizeTag() in docs/list.html. If the two
// diverge, a tag typed in the browser forks from the one the registry stored
// and the colour silently stops resolving.
export function normalizeTag(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(TAG_STRIP, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_LEN);
}

export async function handleTags(url, env, request) {
  if (request.method === "GET") {
    // The slot lives in metadata as well as the value, so the whole registry
    // reads in one list() call with zero get()s.
    const listed = await env.CACHE.list({ prefix: "tag:", limit: 1000 });
    const tags = {};
    for (const key of listed.keys) {
      const slot = Number(key.metadata?.slot);
      if (Number.isInteger(slot)) tags[key.name.slice(4)] = slot;
    }
    return resp({ tags }, 200);
  }
  if (request.method === "PUT") {
    let body;
    try { body = JSON.parse(await request.text()); } catch { return resp({ error: "bad json" }, 400); }
    const name = normalizeTag(body && body.name);
    const slot = body && body.slot;
    if (!name) return resp({ error: "bad tag" }, 400);
    if (!Number.isInteger(slot) || slot < 0 || slot > 9) return resp({ error: "bad slot" }, 400);
    await env.CACHE.put("tag:" + name, String(slot), { metadata: { slot } });
    return resp({ name, slot }, 200);
  }
  return resp({ error: "method not allowed" }, 405);
}
