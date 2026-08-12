// AUTO-EXTRACTED from docs/index.html (contractor card builders).
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clean = v => (v == null ? "" : String(v));
const fmt = n => Number(n || 0).toLocaleString("en-US");
const money = n => (n == null || n === "" ? "—" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const enc = encodeURIComponent;

export function cardKicker(desc) {
  if (desc.type === "permit") return "Permit";
  return desc.role === "open_tech" ? "Open sub" : "General contractor";
}

export function contactPillsHtml(profile, liveOpenJobs) {
  const p = profile || {};
  const pills = [];
  if (liveOpenJobs != null) pills.push({ text: `${fmt(liveOpenJobs)} open jobs`, num: false });
  if (p.total_jobs != null) pills.push({ text: `${fmt(p.total_jobs)} total jobs`, num: false });
  if (p.avg_processing_days != null) pills.push({ text: `${Number(p.avg_processing_days).toFixed(1)} avg processing days`, num: false });
  if (p.usable_processing_jobs != null) pills.push({ text: `${fmt(p.usable_processing_jobs)} usable timing records`, num: false });
  if (p.reported_cost_total != null) pills.push({ text: `${money(p.reported_cost_total)} reported cost`, num: true });
  if (!pills.length) return "";
  return `<div class="pm-tagrow stats">${pills.map(t => `<span class="pm-tag">${esc(t.text)}</span>`).join("")}</div>`;
}

export function contactDetailHtml(desc, cardIndex = 0) {
  const name = clean(desc.name);
  const rows = desc.permits || [];
  const err = clean(desc.relatedError);
  const back = cardIndex > 0
    ? `<button class="pm-back" aria-label="Back" onclick="popCard()">&lsaquo;</button>`
    : "";
  const phone = ((desc.profile && desc.profile.license_matches) || [])
    .map(m => clean(m.phone)).find(ph => ph && ph.toUpperCase() !== "NA") || "";
  const actions = [];
  if (phone) actions.push(`<a class="pm-act primary" href="tel:${esc(phone.replace(/[^\d+]/g, ""))}">Call ${esc(phone)}</a>`);
  if (rows.length) actions.push(`<button class="pm-act" onclick="addAllFromCard()">Add all ${fmt(rows.length)} to list</button>`);

  return `<div class="pm-head stacked">
      <div class="pm-titlerow">
        ${back}
        <div class="pm-title">
          <div class="k">${esc(cardKicker(desc))}</div>
          <div class="v" id="permit-modal-title" tabindex="-1">${esc(name)}</div>
        </div>
        <button class="pm-close" aria-label="Close" onclick="closePermitModal()">&#10005;</button>
      </div>
      ${actions.length ? `<div class="pm-actions">${actions.join("")}</div>` : ""}
    </div>
    <div class="pm-content">
    ${contactPillsHtml(desc.profile, rows.length)}
    <section class="pm-block"><h3>Open permits</h3>
      ${err
        ? `<p class="pm-error" role="alert">${esc(err)} <button class="pm-act" onclick="retryContactCard()">Retry</button></p>`
        : rows.length
          ? `<div class="pm-tablewrap"><table aria-label="Open permits for ${esc(name)}"><thead><tr><th>Permit</th><th>Issued</th><th>Address</th><th>Cost</th></tr></thead><tbody>${rows.map(r => `<tr tabindex="0" onclick="openPermitDetailFromEncoded('${enc(JSON.stringify(r))}')"><td><strong>${esc(r.permit_number)}</strong><br><span class="small">${esc(r.permit_status)}</span></td><td class="num">${esc(r.issue_date)}</td><td>${esc(r.address)}</td><td class="num">${money(r.reported_cost)}</td></tr>`).join("")}</tbody></table></div>`
          : `<p class="pm-empty">No open permits on file for this contractor.</p>`}
    </section>
    ${licenseBlockHtml(desc.profile)}
    ${specialtiesBlockHtml(desc.profile)}
    ${associationsBlockHtml(desc)}
    </div>`;
}

// Trade portion of a license type string: "General Contractor (Class E)" -> "General Contractor".
function parseLicenseTypeLocal(t) { return String(t || "").replace(/\s*\(Class\s+[A-Z]\)\s*/i, "").trim(); }
// Class letter: "... (Class E)" -> "E", "" when none.
function parseLicenseClassLocal(t) { const m = String(t || "").match(/\(Class\s+([A-Z])\)/i); return m ? m[1].toUpperCase() : ""; }

export function licenseBlockHtml(profile) {
  const p = profile || {};
  const matches = p.license_matches || [];
  if (!matches.length) {
    return `<section class="pm-block"><h3>License</h3><p class="pm-empty">No City license match on file for this name.</p></section>`;
  }
  const m = matches[0];
  const phone = matches.map(x => clean(x.phone)).find(ph => ph && ph.toUpperCase() !== "NA") || "";
  const where = [clean(p.city), clean(p.state)].filter(Boolean).join(", ");
  const locality = [where, clean(p.zipcode)].filter(Boolean).join(" ");
  const rows = [
    ["Type", parseLicenseTypeLocal(m.license_type)],
    ["Class", parseLicenseClassLocal(m.license_type) ? `Class ${parseLicenseClassLocal(m.license_type)}` : ""],
    ["Licence no.", clean(m.license_number)],
    ["Expires", clean(m.license_expiration_date)],
    ["Phone", phone],
    ["Based in", locality],
  ];
  return `<section class="pm-block"><h3>License</h3><dl class="pm-facts">${rows.map(([k, v]) =>
    `<dt>${esc(k)}</dt><dd>${v ? (k === "Phone" ? `<a href="tel:${esc(String(v).replace(/[^\d+]/g, ""))}">${esc(v)}</a>` : esc(v)) : "—"}</dd>`).join("")}</dl>${
    matches.length > 1 ? `<p class="pm-empty">${fmt(matches.length - 1)} more licence rows matched this name.</p>` : ""}</section>`;
}

export function specialtiesBlockHtml(profile) {
  const items = ((profile || {}).work_types || []).slice(0, 6);
  if (!items.length) return "";
  return `<section class="pm-block"><h3>Specialties</h3><ul class="pm-chiplist">${items.map(w =>
    `<li><span>${esc(clean(w.work_type))}</span> <span class="assoc-n">${fmt(w.jobs)}</span></li>`).join("")}</ul></section>`;
}

// Contractors seen alongside this one on its permits, in the opposite role.
// Chips push a card — openContactProfile drives the separate directory pane and
// would replace the overlay's stack.
export function associationsBlockHtml(desc) {
  const otherField = desc.role === "open_tech" ? "general_contractors" : "open_subs";
  const otherRole = desc.role === "open_tech" ? "general_contractor" : "open_tech";
  const counts = new Map();
  (desc.permits || []).forEach(row => {
    clean(row[otherField]).split("|").map(x => x.trim()).filter(Boolean)
      .forEach(nm => counts.set(nm, (counts.get(nm) || 0) + 1));
  });
  if (!counts.size) {
    return `<section class="pm-block"><h3>Associations</h3><p class="pm-empty">No other contractors named on these permits.</p></section>`;
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20);
  return `<section class="pm-block"><h3>Associations</h3><ul class="pm-chiplist">${sorted.map(([nm, n]) =>
    `<li><button type="button" class="assoc" onclick="openContactCard('${enc(nm)}', '${otherRole}')" aria-label="Open profile for ${esc(nm)}"><span>${esc(nm)}</span> <span class="assoc-n">${fmt(n)}</span></button></li>`).join("")}</ul></section>`;
}
