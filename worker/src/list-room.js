import { DurableObject } from "cloudflare:workers";
import { emptyDoc, docFromStored, applyOp, listValueFromDoc, splitDocForStorage, docFromStorage } from "./list-doc.js";
import { buildListMeta } from "./lists.js";
import { presenceFrom, presenceKey } from "./presence.js";

const WRITE_THROUGH_MS = 1000; // debounce KV writes while a burst of edits lands
const LIST_TTL = 15552000;     // 6 months, matching lists.js

export class ListRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.loaded = false;
    this.id = null;
    this.doc = emptyDoc();
    this.clock = 0;
  }

  // The doc is stored in four parts, not one, because Durable Object storage
  // caps a single VALUE at 128 KiB and one blob does not fit at FEAT-035's
  // 1000-permit cap: measured 179 KiB worst case — every stop visited, called
  // AND flagged, each by a 40-character actor name. Split, the largest part is
  // the biggest flag map at ~55 KiB and the core is ~43 KiB, both with room to
  // spare. The three flag maps are the parts that grow with the actor names,
  // which is why they are what gets separated out.
  //
  // Rooms written before this shipped hold a single "doc" key. load() prefers
  // it and the next persist() rewrites them into the split form, so there is no
  // migration pass and no version field.
  async load() {
    if (this.loaded) return;
    this.id = (await this.ctx.storage.get("id")) || null;
    const legacy = await this.ctx.storage.get("doc");
    this.legacyDoc = !!legacy;
    const parts = legacy ? null : Object.fromEntries(
      await this.ctx.storage.get(["doc:core", "doc:ticks", "doc:fu", "doc:called"]),
    );
    this.doc = docFromStorage(legacy, parts);
    this.clock = (await this.ctx.storage.get("clock")) || 0;
    this.loaded = true;
  }

  async persist() {
    await this.ctx.storage.put({
      ...splitDocForStorage(this.doc),
      clock: this.clock,
    });
    // Only after the split copy is safely down, and only once.
    if (this.legacyDoc) {
      await this.ctx.storage.delete("doc");
      this.legacyDoc = false;
    }
  }

  // Stamp a socket as alive, merging into whatever it already carries.
  touch(ws, extra) {
    const a = ws.deserializeAttachment() || {};
    ws.serializeAttachment({ ...a, ...extra, seen: Date.now() });
  }

  // Count SESSIONS, not sockets, and drop sockets that stopped heartbeating.
  // `except` omits a socket that is on its way out but still listed.
  presence(except) {
    const entries = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = ws.deserializeAttachment() || {};
      entries.push({ key: ws, sid: a.sid, author: a.author, seen: a.seen, beats: a.beats });
    }
    const { count, names, stale } = presenceFrom(entries);
    for (const ws of stale) { try { ws.close(1001, "stale"); } catch { /* already gone */ } }
    return { count, names };
  }

  // Only send a presence frame when what viewers see actually changed —
  // otherwise every heartbeat would broadcast to the whole room.
  broadcastPresence(p, except) {
    const key = presenceKey(p);
    if (key === this.presenceKey) return;
    this.presenceKey = key;
    this.broadcast({ t: "presence", ...p }, except);
  }

  broadcast(obj, except) {
    const text = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) { try { ws.send(text); } catch { /* closing */ } }
    }
  }

  // Upgrade handshake. The Worker forwards ?id=<shareId>.
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    await this.load();
    const url = new URL(request.url);
    const id = url.searchParams.get("id") || "";
    if (this.id === null) {
      // First ever connect: cold-load the list from KV and remember the id.
      const stored = await this.env.CACHE.getWithMetadata("list:" + id);
      if (!stored.value) return new Response("not found", { status: 404 });
      this.id = id;
      this.doc = docFromStored(stored.value, stored.metadata);
      await this.ctx.storage.put("id", id);
      await this.persist();
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]); // server side, hibernatable
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, message) {
    await this.load();
    let msg;
    try { msg = JSON.parse(message); } catch { return; }

    if (msg.t === "hello") {
      const sid = String(msg.sid || "").slice(0, 64);
      this.touch(ws, {
        author: String(msg.author || "").slice(0, 40),
        // A pre-FIX-009 client sends no sid: give it a synthetic one so it is
        // still one viewer, and leave beats false so it is never swept.
        sid: sid || crypto.randomUUID(),
        beats: !!sid,
      });
      const p = this.presence();
      ws.send(JSON.stringify({ t: "state", doc: this.doc, clock: this.clock, presence: p }));
      this.broadcastPresence(p, ws);
      return;
    }

    // Heartbeat. Doubles as the sweep trigger: presence() reaps sockets whose
    // client vanished without a close, so a remaining viewer's own beat fixes
    // the count for everyone.
    if (msg.t === "ping") {
      this.touch(ws);
      this.broadcastPresence(this.presence());
      return;
    }

    if (msg.t === "patch" && Array.isArray(msg.ops)) {
      this.touch(ws);
      for (const op of msg.ops) this.doc = applyOp(this.doc, op);
      this.clock += 1;
      await this.persist();
      this.broadcast({ t: "patch", ops: msg.ops, clock: this.clock }, ws);
      // Debounced write-through to KV.
      await this.ctx.storage.setAlarm(Date.now() + WRITE_THROUGH_MS);
      return;
    }
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch { /* already closed */ }
    // The closing socket is still listed here — omit it or we report it as a viewer.
    this.broadcastPresence(this.presence(ws), ws);
  }

  async webSocketError(ws) {
    this.broadcastPresence(this.presence(ws), ws);
  }

  // Write the current doc back to KV so the directory + share links stay correct.
  async alarm() {
    await this.load();
    if (!this.id) return;
    const value = listValueFromDoc(this.doc);
    const now = Math.floor(Date.now() / 1000);
    const current = await this.env.CACHE.getWithMetadata("list:" + this.id);
    // Preserve publishedAt/rev from the existing metadata; refresh the rest.
    const metadata = {
      ...buildListMeta(value, { ...(current.metadata || {}), ...this.doc.meta }, now),
      publishedAt: Number(current.metadata && current.metadata.publishedAt) || now,
      rev: Number(current.metadata && current.metadata.rev) || 1,
    };
    await this.env.CACHE.put("list:" + this.id, JSON.stringify(value), { expirationTtl: LIST_TTL, metadata });
  }
}
