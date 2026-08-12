// AUTO-EXTRACTED from docs/list.html.

export function normalizeTag(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 \-_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

export function parseTagInput(text, registry, newSlot = 0) {
  const seen = new Set();
  const out = [];
  for (const part of String(text || "").split(",")) {
    const name = normalizeTag(part);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const slot = Number.isInteger(registry[name]) ? registry[name] : newSlot;
    out.push([name, Math.max(0, Math.min(9, slot))]);
    if (out.length >= 8) break;
  }
  return out;
}

