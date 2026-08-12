// AUTO-EXTRACTED from docs/list.html.
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function tagChipHtml(name, slot) {
  const s = Math.max(0, Math.min(9, Number(slot) || 0));
  return `<span class="tag" style="--tc:var(--t${s})"><span class="swatch"></span>${esc(name)}</span>`;
}

export function directorySections(localLists, remoteRows) {
  const mine = Object.entries(localLists).map(([id, list]) => ({
    id,
    name: list.name,
    count: (list.permits || []).length,
    sharedId: list.sharedId || null,
    draft: !list.sharedId,
  }));
  // Your own published lists also appear under "Published to the site" —
  // the same way anyone else sees them (they still show under My lists too).
  return { mine, published: remoteRows };
}
