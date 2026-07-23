const PERMIT_RE = /^[A-Za-z0-9-]{1,16}$/;
const PHOTO_ID_RE = /^p_[0-9a-f]{8}$/;
const MAX_BYTES = 5 * 1024 * 1024;

function resp(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export function makePhotoId() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return "p_" + [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

// Trust the bytes, not the client's header. Only these three types are stored.
export function sniffImageType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

export async function handlePhotos(url, env, request) {
  const m = url.pathname.match(/^\/api\/photo\/([^/]+)(?:\/([^/]+))?$/);
  if (!m) return resp({ error: "not found" }, 404);
  const permit = decodeURIComponent(m[1]);
  const photoId = m[2];
  if (!PERMIT_RE.test(permit)) return resp({ error: "bad permit" }, 400);

  if (request.method === "POST" && !photoId) {
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.length > MAX_BYTES) return resp({ error: "too large" }, 413);
    const type = sniffImageType(buf);
    if (!type) return resp({ error: "unsupported image type" }, 415);
    const id = makePhotoId();
    const key = `photo/${permit}/${id}.webp`;
    await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type } });
    return resp({ id }, 200);
  }

  if (request.method === "GET" && photoId) {
    if (!PHOTO_ID_RE.test(photoId)) return resp({ error: "not found" }, 404);
    const obj = await env.PHOTOS.get(`photo/${permit}/${photoId}.webp`);
    if (!obj) return resp({ error: "not found" }, 404);
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "image/webp");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(obj.body, { status: 200, headers });
  }

  if (request.method === "DELETE" && photoId) {
    if (!PHOTO_ID_RE.test(photoId)) return resp({ error: "bad id" }, 400);
    await env.PHOTOS.delete(`photo/${permit}/${photoId}.webp`);
    return resp({ ok: true }, 200);
  }

  return resp({ error: "method not allowed" }, 405);
}
