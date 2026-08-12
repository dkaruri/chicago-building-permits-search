// AUTO-EXTRACTED from docs/list.html.

export function customToRow(c) {
  // Number(null) is 0, which is finite — so a null coordinate would read as
  // 0,0 in the Gulf of Guinea rather than "no location". Check for null first.
  const hasGeo = c.lat != null && c.lon != null
    && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon));
  return {
    // Never fabricate a permit number. An empty string is honest; a
    // placeholder could be mistaken for real city data.
    permit_number: "",
    custom_id: c.id,
    is_custom: true,
    no_geo: !hasGeo,
    address: c.addr,
    work_description: c.work || "",
    work_type: c.work || "",
    permit_type: "",
    permit_status: "",
    issue_date: "",
    reported_cost: "",
    ward: "",
    general_contractors: c.gc || "",
    open_subs: "",
    latitude: hasGeo ? Number(c.lat) : null,
    longitude: hasGeo ? Number(c.lon) : null,
    _use: c.use || "unclear",
  };
}

export function mergeCustomStops(permitRows, custom) {
  const out = [...permitRows];
  const sorted = [...(custom || [])].sort((a, b) => (Number(a.pos) || 0) - (Number(b.pos) || 0));
  sorted.forEach(c => {
    const at = Math.max(0, Math.min(out.length, (Number(c.pos) || out.length + 1) - 1));
    out.splice(at, 0, customToRow(c));
  });
  return out;
}

