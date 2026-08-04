/**
 * How long a contractor's permits stay open (FIX-012).
 *
 * WHY THIS IS SHAPED LIKE THIS. The ticket asks for average issuance-to-closure
 * days. That cannot be computed from published data: `ydr8-5enu` has 122 columns
 * and the only date/status fields are application_start_date, issue_date,
 * processing_time and permit_status. permit_status carries COMPLETE (462k rows),
 * so closure is knowable as a STATE — but the dataset is a snapshot and never
 * records WHEN the state changed. Socrata's row-level `:updated_at` is not a
 * substitute: COMPLETE permits issued in 2020 all carry the same
 * 2025-10-14T20:5x timestamp, seconds apart, because that is a bulk re-upload.
 * No inspections dataset links a permit to a final inspection either.
 *
 * So there are two metrics here, and they are deliberately different things:
 *
 *   1. OPEN AGE — exact and available immediately. How long this contractor's
 *      currently-open permits have been open. Answers "are their jobs dragging".
 *
 *   2. TIME TO CLOSE — the metric actually asked for, which we must OBSERVE
 *      because it was never published. Each seed snapshots which permits are
 *      open; a permit that has left the open set and now reads COMPLETE closed
 *      somewhere between the two runs, and we book issue_date -> observation
 *      date. Accurate to the seed cadence, and blind to everything that closed
 *      before we started watching, so it stays absent until samples accumulate
 *      rather than reporting a confident zero.
 *
 * Stats are stored aggregated per contractor ({n, days}), not as a per-permit
 * log, so the KV value is bounded by the number of contractors rather than
 * growing forever with every permit that ever closes.
 */

import { classifyContact } from "./socrata.js";

const DAY_MS = 86400000;

export function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${String(fromIso).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(toIso).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

/** avg/median/max age in days of a set of issue dates, as of `asOf`. */
export function openAgeStats(issueDates, asOf) {
  const ages = (issueDates || [])
    .map((d) => daysBetween(d, asOf))
    // A permit issued in the future, or an unparseable date, is bad data — not
    // a zero-day-old job. Averaging those in would drag every number down.
    .filter((n) => n != null && n >= 0)
    .sort((a, b) => a - b);
  if (!ages.length) return null;
  const mid = Math.floor(ages.length / 2);
  return {
    n: ages.length,
    avg: Math.round(ages.reduce((a, b) => a + b, 0) / ages.length),
    median: ages.length % 2 ? ages[mid] : Math.round((ages[mid - 1] + ages[mid]) / 2),
    max: ages[ages.length - 1],
  };
}

/**
 * Permit numbers that were open at the previous seed and are not open now.
 * They have left ACTIVE/SUSPENDED/PHASED — but that includes EXPIRED, CANCELLED
 * and REVOKED, so the caller must check each one's real status before booking it
 * as a closure. "No longer open" is not "finished".
 */
export function departedPermits(prevSnapshot, currentOpenNumbers) {
  const open = new Set(currentOpenNumbers || []);
  return Object.keys(prevSnapshot || {}).filter((pn) => !open.has(pn));
}

/**
 * Turn freshly-COMPLETE permit rows into per-contractor day totals.
 * Only rows whose status is COMPLETE count: an expired permit tells us the work
 * stopped, not that it finished, and folding it in would flatter slow builders.
 */
export function closureAdditions(rows, prevSnapshot, observedOn) {
  const add = { general_contractor: {}, open_tech: {} };
  for (const row of rows || []) {
    if ((row.permit_status || "").toUpperCase() !== "COMPLETE") continue;
    const pn = row.permit_;
    const issued = (prevSnapshot || {})[pn] || (row.issue_date || "").slice(0, 10);
    if (!pn || !issued) continue;
    const days = daysBetween(issued, observedOn);
    if (days == null || days < 0) continue;
    for (let i = 1; i <= 15; i += 1) {
      const name = (row[`contact_${i}_name`] || "").trim();
      const type = (row[`contact_${i}_type`] || "").trim();
      if (!name) continue;
      const cat = classifyContact(type);
      if (cat !== "general_contractor" && cat !== "open_tech") continue;
      const bucket = add[cat];
      if (!bucket[name]) bucket[name] = { n: 0, days: 0 };
      // One permit counts once per contractor even if they hold several slots
      // on it, otherwise a contractor listed twice doubles their own sample.
      if (bucket[name]._seen === pn) continue;
      bucket[name]._seen = pn;
      bucket[name].n += 1;
      bucket[name].days += days;
    }
  }
  for (const cat of Object.keys(add)) {
    for (const v of Object.values(add[cat])) delete v._seen;
  }
  return add;
}

/** Fold new observations into the running totals. */
export function mergeClosureStats(prev, additions) {
  const out = { general_contractor: {}, open_tech: {} };
  for (const cat of Object.keys(out)) {
    const base = (prev && prev[cat]) || {};
    for (const [name, v] of Object.entries(base)) out[cat][name] = { n: v.n, days: v.days };
    for (const [name, v] of Object.entries((additions && additions[cat]) || {})) {
      if (!out[cat][name]) out[cat][name] = { n: 0, days: 0 };
      out[cat][name].n += v.n;
      out[cat][name].days += v.days;
    }
  }
  return out;
}

/**
 * Attach the observed close time to profiles. Contractors with no observations
 * get NO keys — the UI keys off absence, and for months after this ships that
 * will be almost everyone. Never emit 0, which would read as "closes instantly".
 */
export function attachClosureStats(profiles, stats, category) {
  const table = (stats && stats[category]) || {};
  let matched = 0;
  for (const p of profiles || []) {
    const s = table[p.contact_name];
    if (!s || !s.n) continue;
    p.close_days_avg = Math.round(s.days / s.n);
    p.close_sample = s.n;
    matched += 1;
  }
  return matched;
}

/**
 * Did a `wrangler kv key get` fail because the key does not exist yet, or for
 * some other reason?
 *
 * This distinction is load-bearing and was originally missing. The seed read
 * its previous snapshot inside a bare `catch { return null }`, so ANY failure —
 * no credentials, a network blip, a permissions change — was indistinguishable
 * from "first run ever". The first CI run proved it: with no API token the seed
 * announced "no previous snapshot, this run establishes the baseline". Had the
 * writes then succeeded, it would have overwritten closure:stats with an empty
 * object and destroyed every closure observation ever recorded, reporting
 * success the whole way.
 */
export function isKeyMissingError(text) {
  const s = String(text || "");
  // The word boundaries are \b as two-character ESCAPES. Written with real
  // 0x08 backspace BYTES this tested for a literal backspace and could never
  // match, so this branch was dead (FIX-030). It is not redundant with the
  // check below: that one needs the literal word "key" followed by a space,
  // which the real message only contains when the KEY NAME happens to end in
  // "key" -- it does not match for closure:stats, the key this actually reads.
  if (/\b404\b/.test(s) && /not found/i.test(s)) return true;
  // Wrangler has phrased this differently across versions; accept the explicit
  // wording too, but never a bare "not found" on its own — an auth error can
  // easily contain that phrase without meaning the key is absent.
  return /key .*not found/i.test(s);
}
