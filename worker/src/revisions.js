const KEEP_REVS = 20;

// Zero-padded so KV.list() returns revisions in numeric order.
export function revKey(id, n) {
  return `listrev:${id}:${String(n).padStart(4, "0")}`;
}

// Given the revision about to be written, returns the revision numbers that
// have aged out and should be deleted.
export function pruneRevs(rev) {
  const oldest = rev - KEEP_REVS;
  if (oldest < 1) return [];
  return Array.from({ length: oldest }, (_, i) => i + 1);
}
