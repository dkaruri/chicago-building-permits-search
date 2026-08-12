// AUTO-EXTRACTED.
const API_BASE='https://api.test';
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function photoGalleryHtml(post, permit) {
  const photos = Array.isArray(post.photos) ? post.photos : [];
  if (!photos.length) return "";
  return `<div class="tp-gallery">${photos.map(ph =>
    `<a class="tp-shot" href="${API_BASE}/api/photo/${encodeURIComponent(permit)}/${encodeURIComponent(ph.id)}" target="_blank" rel="noopener"><img loading="lazy" src="${API_BASE}/api/photo/${encodeURIComponent(permit)}/${encodeURIComponent(ph.id)}" alt="${esc(ph.caption || "Site photo")}"></a>`).join("")}</div>`;
}
