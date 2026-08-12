// AUTO-EXTRACTED.
export function chipLabel(o) {
  if (o.publicCount > 0) return String(o.publicCount);
  if (o.hasPrivate) return "✎";
  return "0";
}
