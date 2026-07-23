import { sanitizePermits, sanitizeFocal, sanitizeCustom, sanitizeMeta, readList } from "./lists.js";

const MAX_DESC = 2000;

export function emptyDoc() {
  return { p: [], f: null, custom: [], ticks: {}, desc: "", meta: sanitizeMeta({}) };
}

// value: the raw KV string (or null). metadata: the KV metadata object (or null).
export function docFromStored(value, metadata) {
  const list = readList(value);
  if (!list) return emptyDoc();
  return {
    p: Array.isArray(list.p) ? list.p : [],
    f: list.f || null,
    custom: Array.isArray(list.custom) ? list.custom : [],
    ticks: list.ticks && typeof list.ticks === "object" ? list.ticks : {},
    desc: typeof list.desc === "string" ? list.desc : "",
    // Metadata carries the directory-facing details; sanitizeMeta normalises them.
    meta: sanitizeMeta({
      title: metadata && metadata.title,
      author: metadata && metadata.author,
      desc: metadata && metadata.blurb,
      tags: metadata && metadata.tags,
    }),
  };
}

// Pure: returns a new doc, never mutates the input.
export function applyOp(doc, op) {
  const next = { ...doc, ticks: { ...doc.ticks }, meta: { ...doc.meta } };
  switch (op && op.f) {
    case "p":
      next.p = sanitizePermits(op.v);
      return next;
    case "f":
      next.f = sanitizeFocal(op.v);
      return next;
    case "custom":
      next.custom = sanitizeCustom(op.v);
      return next;
    case "tick": {
      const key = String(op.k || "");
      if (!key) return next;
      if (op.v) next.ticks[key] = 1; else delete next.ticks[key];
      return next;
    }
    case "meta": {
      next.meta = sanitizeMeta({ title: op.v && op.v.title, author: op.v && op.v.author, desc: op.v && op.v.desc, tags: op.v && op.v.tags });
      next.desc = String((op.v && op.v.desc) ?? doc.desc ?? "").slice(0, MAX_DESC);
      return next;
    }
    default:
      return doc; // unknown field — no change (return the original, unmodified)
  }
}

export function listValueFromDoc(doc) {
  return {
    v: 2,
    p: Array.isArray(doc.p) ? doc.p : [],
    f: doc.f || null,
    desc: String(doc.desc || "").slice(0, MAX_DESC),
    custom: Array.isArray(doc.custom) ? doc.custom : [],
    ticks: doc.ticks && typeof doc.ticks === "object" ? doc.ticks : {},
  };
}
