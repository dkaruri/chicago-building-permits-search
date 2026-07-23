import { test } from "node:test";
import assert from "node:assert";
import { makePhotoId, sniffImageType, handlePhotos } from "../src/photos.js";

const JPEG = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);

test("makePhotoId is p_ plus 8 hex and varies", () => {
  assert.match(makePhotoId(), /^p_[0-9a-f]{8}$/);
  assert.notEqual(makePhotoId(), makePhotoId());
});

test("sniffImageType recognises jpeg, png and webp", () => {
  assert.equal(sniffImageType(JPEG), "image/jpeg");
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(WEBP), "image/webp");
});

test("sniffImageType rejects a disallowed type by its magic bytes", () => {
  assert.equal(sniffImageType(GIF), null);
  assert.equal(sniffImageType(new Uint8Array([1, 2, 3])), null);
});

function fakeR2() {
  const store = new Map();
  return {
    store,
    async put(key, body, opts) { store.set(key, { body: new Uint8Array(body), opts: opts || {} }); },
    async get(key) {
      const o = store.get(key);
      if (!o) return null;
      return {
        body: o.body,
        httpMetadata: o.opts.httpMetadata || {},
        writeHttpMetadata(headers) { if (o.opts.httpMetadata && o.opts.httpMetadata.contentType) headers.set("Content-Type", o.opts.httpMetadata.contentType); },
      };
    },
    async delete(key) { store.delete(key); },
  };
}
const ENV = () => ({ PHOTOS: fakeR2() });
const upload = (permit, bytes, type) => new Request(`https://w/api/photo/${permit}`, { method: "POST", headers: { "Content-Type": type }, body: bytes });

test("POST stores a webp and returns an id, then GET serves it", async () => {
  const env = ENV();
  const posted = await handlePhotos(new URL("https://w/api/photo/101082609"), env, upload("101082609", WEBP, "image/webp"));
  assert.equal(posted.status, 200);
  const { id } = await posted.json();
  assert.match(id, /^p_[0-9a-f]{8}$/);
  assert.ok(env.PHOTOS.store.has(`photo/101082609/${id}.webp`));

  const got = await handlePhotos(new URL(`https://w/api/photo/101082609/${id}`), env, new Request(`https://w/api/photo/101082609/${id}`));
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("Content-Type"), "image/webp");
  assert.match(got.headers.get("Cache-Control") || "", /max-age/);
});

test("POST rejects a permit that is not permit-shaped", async () => {
  const res = await handlePhotos(new URL("https://w/api/photo/bad%20key"), ENV(), upload("bad%20key", WEBP, "image/webp"));
  assert.equal(res.status, 400);
});

test("POST rejects a disallowed content-type even if the header lies", async () => {
  const res = await handlePhotos(new URL("https://w/api/photo/1"), ENV(), upload("1", GIF, "image/webp"));
  assert.equal(res.status, 415);
});

test("POST rejects a body over the 5MB cap", async () => {
  const big = new Uint8Array(5 * 1024 * 1024 + 1);
  big.set(WEBP, 0);
  const res = await handlePhotos(new URL("https://w/api/photo/1"), ENV(), upload("1", big, "image/webp"));
  assert.equal(res.status, 413);
});

test("GET on a missing photo is 404", async () => {
  const res = await handlePhotos(new URL("https://w/api/photo/1/p_deadbeef"), ENV(), new Request("https://w/api/photo/1/p_deadbeef"));
  assert.equal(res.status, 404);
});

test("DELETE removes the object", async () => {
  const env = ENV();
  const { id } = await (await handlePhotos(new URL("https://w/api/photo/1"), env, upload("1", WEBP, "image/webp"))).json();
  const del = await handlePhotos(new URL(`https://w/api/photo/1/${id}`), env, new Request(`https://w/api/photo/1/${id}`, { method: "DELETE" }));
  assert.equal(del.status, 200);
  assert.equal(env.PHOTOS.store.size, 0);
});

test("DELETE with a malformed id is rejected", async () => {
  const res = await handlePhotos(new URL("https://w/api/photo/1/not-an-id"), ENV(), new Request("https://w/api/photo/1/not-an-id", { method: "DELETE" }));
  assert.equal(res.status, 400);
});
