import { sanitizePermits, sanitizeFocal, sanitizeCustom, sanitizeMeta, readList, flagValue, flagMap } from "./lists.js";

const MAX_DESC = 2000;

export function emptyDoc() {
  return { p: [], f: null, custom: [], ticks: {}, fu: {}, called: {}, desc: "", meta: sanitizeMeta({}) };
}

// value: the raw KV string (or null). metadata: the KV metadata object (or null).
export function docFromStored(value, metadata) {
  const list = readList(value);
  if (!list) return emptyDoc();
  return {
    p: Array.isArray(list.p) ? list.p : [],
    f: list.f || null,
    custom: Array.isArray(list.custom) ? list.custom : [],
    ticks: flagMap(list.ticks),
    // Follow-up flags (FEAT-034). Absent on every list stored before this
    // shipped, so it must default rather than assume the key exists.
    fu: flagMap(list.fu),
    // Called flags (FEAT-031). Same defaulting rule, same reason.
    called: flagMap(list.called),
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
  const next = { ...doc, ticks: { ...doc.ticks }, fu: { ...doc.fu }, called: { ...doc.called }, meta: { ...doc.meta } };
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
    // Three per-key flags, all keyed the same way: permit number, or custom_id
    // for a custom stop. `fu` is FEAT-034's follow-up, `called` is FEAT-031.
    // One case rather than three copies free to drift — the only difference
    // between them is which map they write to. `op.by` is the actor's name and
    // is optional; without it the flag stores 1.
    case "tick":
    case "fu":
    case "call": {
      const field = op.f === "tick" ? "ticks" : op.f === "fu" ? "fu" : "called";
      const key = String(op.k || "");
      if (!key) return next;
      if (op.v) next[field][key] = flagValue(op.by); else delete next[field][key];
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

// ---- Durable Object storage layout (FEAT-035) ----
//
// Durable Object storage caps a single VALUE at 128 KiB, and the doc does not
// fit at the 1000-permit cap: measured 179 KiB worst case, with every stop
// visited, called AND flagged by a 40-character actor name. The three flag maps
// are what grow with those names, so they are what gets split off — leaving a
// core of ~43 KiB and a largest flag map of ~55 KiB.
//
// Kept here, and pure, so the split and the migration off the old single-key
// layout are testable without standing up a Durable Object.
export function splitDocForStorage(doc) {
  const { ticks, fu, called, ...core } = doc;
  return {
    "doc:core": core,
    "doc:ticks": ticks || {},
    "doc:fu": fu || {},
    "doc:called": called || {},
  };
}

// `legacy` is the old single "doc" key, written before this shipped. It wins
// when present: a room that has not been rewritten yet holds nothing in the
// split keys, and reading those first would silently reset it to empty.
export function docFromStorage(legacy, parts) {
  if (legacy) return legacy;
  const core = parts && parts["doc:core"];
  if (!core) return emptyDoc();
  return {
    ...core,
    ticks: (parts["doc:ticks"]) || {},
    fu: (parts["doc:fu"]) || {},
    called: (parts["doc:called"]) || {},
  };
}

export function listValueFromDoc(doc) {
  return {
    v: 2,
    p: Array.isArray(doc.p) ? doc.p : [],
    f: doc.f || null,
    desc: String(doc.desc || "").slice(0, MAX_DESC),
    custom: Array.isArray(doc.custom) ? doc.custom : [],
    ticks: flagMap(doc.ticks),
    fu: flagMap(doc.fu),
    called: flagMap(doc.called),
  };
}
