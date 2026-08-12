// AUTO-EXTRACTED from docs/index.html (card stack core).
export function stackPush(stack, index, desc) {
  return { stack: [...stack.slice(0, index + 1), desc], index: index + 1 };
}

export function stackGo(stack, index, delta) {
  const next = Math.min(Math.max(index + delta, 0), stack.length - 1);
  return { stack, index: next };
}

// Fold a contractor name to a comparison key: case, punctuation, whitespace and
// a trailing corporate suffix are all noise when matching permit text against a
// profile name.
export function normContractor(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(INC|LLC|CO|CORP|LTD)$/, "")
    .trim();
}

// /api/permits?contact_name= is a substring LIKE across all 15 contact slots,
// so "ACME" also returns "ACME PLUMBING". Keep only rows that actually name
// this contractor in the role we are showing.
export function rowsForContractor(rows, name, role) {
  const key = normContractor(name);
  const field = role === "open_tech" ? "open_subs" : "general_contractors";
  return (rows || []).filter(row =>
    String(row[field] || "").split("|").map(normContractor).includes(key));
}
