// AUTO-EXTRACTED from docs/list.html.
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
let currentThreadPermit = "test-permit";

export const ESTIMATE_LABELS = { "same-day": "Same day", "1-3d": "1\u20133 days", "week": "About a week", "longer": "Longer", "unknown": "Didn't say" };
export const JOB_LABELS = { "new": "New build", "remodel": "Remodel" };
export function dateStampLabel(ts) {
  const d = new Date(Number(ts) * 1000);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function threadPostHtml(post) {
  const when = dateStampLabel(post.ts) + (post.editedTs ? " \u00b7 edited" : "");
  const head = `<p class="tp-head"><span class="tp-who">${esc(post.author || "anonymous")}</span><time>${esc(when)}</time>` +
    `<span class="tp-kind">${post.kind === "walk" ? "Walkthrough" : post.kind === "photo" ? "Photo" : "Note"}</span></p>`;
  const acts = `<p class="tp-act">` +
    `<button type="button" onclick="editNotePost('${esc(currentThreadPermit)}','${esc(post.id)}')">Edit</button>` +
    `<button type="button" class="del" onclick="deleteNotePost('${esc(currentThreadPermit)}','${esc(post.id)}')">Delete</button></p>`;
  if (post.kind === "walk") {
    const p = post.party;
    const rows = [
      ["Job", esc(JOB_LABELS[post.job] || "\u2014")],
      ["On site", post.onsite === "sub" ? "Open sub" : post.onsite === "gc" ? "General contractor" : "Nobody"],
    ];
    if (p) {
      if (p.name) rows.push(["Company", esc(p.name)]);
      if (p.phone) rows.push(["Phone", `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>`]);
      if (p.covers) rows.push(["Covers", esc(p.covers)]);
      const cap = [p.jobs ? `${p.jobs} jobs at a time` : "", ESTIMATE_LABELS[p.estimate] ? `estimates ${ESTIMATE_LABELS[p.estimate]}` : ""].filter(Boolean).join(" \u00b7 ");
      if (cap) rows.push(["Capacity", esc(cap)]);
    }
    if (post.gc && post.gc.name) rows.push(["Their GC", esc(post.gc.name) + (post.gc.phone ? ` \u00b7 <a href="tel:${esc(post.gc.phone)}">${esc(post.gc.phone)}</a>` : "")]);
    return `<article class="tp walk">${head}<dl class="tp-kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>${acts}</article>`;
  }
  const photo = post.kind === "photo" ? `<p class="tp-photo-note">\ud83d\udcf7 photo</p>` : "";
  return `<article class="tp">${head}<p class="tp-text">${esc(post.text || "")}</p>${photo}${acts}</article>`;
}

