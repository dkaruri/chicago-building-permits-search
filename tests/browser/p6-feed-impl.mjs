// Mirror of the per-list notes feed logic in docs/list.html (FEAT-034).
// Kept in sync by hand, the same way p1-store-impl / p2-ticks-impl are.

// One line of prose describing a walkthrough post, so a walk reads as a note in
// the feed instead of as a blank entry. Mirrors the walkthrough card's wording.
export function walkSummary(post) {
  const job = post.job === "new" ? "New construction" : "Remodel";
  const who = [];
  if (post.gc && post.gc.name) who.push(`GC ${post.gc.name}`);
  if (post.sub && post.sub.name) who.push(`sub ${post.sub.name}`);
  const parties = who.length ? who.join(" and ") : "nobody on site";
  return `Walkthrough — ${job}, ${parties}`;
}

function postText(post) {
  if (post.kind === "walk") return walkSummary(post);
  if (post.kind === "photo") {
    const n = Array.isArray(post.photos) ? post.photos.length : 0;
    const caption = String(post.text || "").trim();
    const label = n === 1 ? "1 photo" : `${n} photos`;
    return caption ? `${label} — ${caption}` : label;
  }
  return String(post.text || "").trim();
}

// Build the feed for ONE list. Scope is always the list you are in: `rows` is
// that list's permits, and nothing outside it can appear.
//
// `privateNotes` / `noteTs` are the browser-local notes; `threads` is what
// /api/notes/bulk returned. A private note whose permit has no timestamp
// recorded (written before FEAT-034) gets ts null and is shown as undated
// rather than being handed a made-up time.
export function buildFeedEntries({ rows = [], privateNotes = {}, noteTs = {}, threads = {} } = {}) {
  const entries = [];
  for (const row of rows) {
    const permit = String(row.permit_number || "");
    if (!permit) continue;
    const address = String(row.address || "");

    const mine = String(privateNotes[permit] || "").trim();
    if (mine) {
      entries.push({
        id: `private:${permit}`,
        permit, address,
        text: mine,
        ts: Number.isFinite(Number(noteTs[permit])) ? Number(noteTs[permit]) : null,
        author: "",
        kind: "private",
        shared: false,
      });
    }

    for (const post of threads[permit] || []) {
      const text = postText(post);
      if (!text) continue;
      entries.push({
        id: `post:${permit}:${post.id}`,
        permit, address,
        text,
        ts: Number.isFinite(Number(post.ts)) ? Number(post.ts) : null,
        author: String(post.author || "").trim(),
        kind: post.kind === "walk" || post.kind === "photo" ? post.kind : "note",
        shared: true,
        edited: !!post.editedTs,
      });
    }
  }
  return sortFeedEntries(entries);
}

// Newest first. Undated entries sort last — they are old private notes, and
// floating them to the top would misrepresent them as the most recent thing.
// Ties break on permit then id so the order is stable across renders.
export function sortFeedEntries(entries) {
  return entries.slice().sort((a, b) => {
    if (a.ts == null && b.ts == null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (a.ts == null) return 1;
    if (b.ts == null) return -1;
    if (b.ts !== a.ts) return b.ts - a.ts;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Every whitespace-separated term must match somewhere in the entry, so
// "roof 1010" narrows rather than widens. Searching covers the note text, the
// permit number and the address — the three things a person has in mind.
export function filterFeedEntries(entries, query) {
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return entries;
  return entries.filter(entry => {
    const hay = `${entry.text} ${entry.permit} ${entry.address} ${entry.author}`.toLowerCase();
    return terms.every(term => hay.includes(term));
  });
}

// Split the list's permits into request-sized chunks for /api/notes/bulk.
export function chunkPermits(permits, size = 200) {
  const out = [];
  const seen = new Set();
  for (const p of permits) {
    const permit = String(p || "");
    if (!permit || seen.has(permit)) continue;
    seen.add(permit);
    if (!out.length || out[out.length - 1].length >= size) out.push([]);
    out[out.length - 1].push(permit);
  }
  return out;
}

// "3 notes" / "1 note" / "No notes" — and when a search is active, how many of
// how many, so an empty result never looks like data loss.
export function feedCountLabel(shown, total, searching) {
  if (!total) return "No notes";
  if (searching) return `${shown} of ${total} ${total === 1 ? "note" : "notes"}`;
  return `${total} ${total === 1 ? "note" : "notes"}`;
}
