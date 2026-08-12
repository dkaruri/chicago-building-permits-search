// AUTO-EXTRACTED.
export function walkFieldsToPayload(f) {
  const out = { kind: "walk", job: f.job === "new" ? "new" : "remodel", onsite: ["none", "gc", "sub"].includes(f.onsite) ? f.onsite : "none" };
  if (out.onsite !== "none") {
    const jobs = parseInt(f.jobs, 10);
    out.party = { name: (f.name || "").trim(), phone: (f.phone || "").trim(), covers: (f.covers || "").trim(),
      jobs: Number.isInteger(jobs) ? jobs : null, estimate: f.estimate || "unknown" };
  }
  if (out.onsite === "sub" && (f.gcName || "").trim()) {
    out.gc = { name: f.gcName.trim(), phone: (f.gcPhone || "").trim() };
  }
  return out;
}
