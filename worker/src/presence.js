// Presence for a live list room. Pure, so it can be unit-tested without the
// Durable Object runtime (importing cloudflare:workers breaks `node --test`).
//
// A viewer is a SESSION, not a socket. A reload opens the new socket before the
// old one's close reaches us, and a backgrounded mobile tab can leave a socket
// that never closes at all — counting sockets double-counts both.

export const HEARTBEAT_MS = 30000;

// Ten missed heartbeats, not three. The TTL is enforced against a client-side
// `setInterval`, and browsers throttle that in a hidden tab — Chrome to roughly
// one tick a minute after five minutes hidden, iOS Safari suspends it outright.
// At the old 90s a single throttled tick was enough to reap a viewer who was
// sitting right there: the survivor's pill dropped to one, the reaped client
// reconnected, and the cycle repeated every ~90s with nobody having left.
//
// A graceful departure does not rely on this at all — `pagehide` disconnects
// explicitly, and that is the path a backgrounded phone actually takes. The TTL
// only has to catch UNGRACEFUL deaths (crash, lost network, a close frame that
// never lands).
//
// THE TRADE-OFF, stated rather than hidden: an ungraceful death now inflates
// the count for up to five minutes instead of ninety seconds. That is the right
// way round for this feature. A count that is briefly one too high sits still
// and corrects itself quietly; the old setting produced a pill that flashed in
// and out every ninety seconds and shoved the page each time. A stale number is
// cheaper than a moving one — and the client no longer blanks the pill on a
// reconnect either, so neither failure mode flickers now.
export const PRESENCE_TTL_MS = 300000;

// entries: [{ key, sid, author, seen, beats }] — one per open socket.
// `beats` marks a client that sends heartbeats; only those can go stale, so a
// cached pre-FIX-009 page that never pings is not reaped every 90 seconds.
// Returns { count, names, stale }; `stale` holds the keys for the caller to close.
export function presenceFrom(entries, now = Date.now()) {
  const stale = [];
  const names = [];
  const sids = new Set();
  for (const e of entries || []) {
    if (!e || !e.sid) continue; // no hello yet — not a viewer
    if (e.beats && now - Number(e.seen || 0) > PRESENCE_TTL_MS) { stale.push(e.key); continue; }
    sids.add(e.sid);
    const a = String(e.author || "").trim();
    if (a && !names.includes(a)) names.push(a);
  }
  return { count: sids.size, names, stale };
}

// Stable string for "has what viewers see changed?" — lets the room skip
// broadcasting a presence frame on every heartbeat.
export function presenceKey(p) {
  return `${p.count}|${p.names.join(" ")}`;
}
