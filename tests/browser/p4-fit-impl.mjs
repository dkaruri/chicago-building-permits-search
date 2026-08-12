// AUTO-EXTRACTED.
export function fitDimensions(w, h, max) {
  const longest = Math.max(w, h);
  if (longest <= max) return { w: Math.round(w), h: Math.round(h) };
  const s = max / longest;
  return { w: Math.round(w * s), h: Math.round(h * s) };
}
