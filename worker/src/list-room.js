import { DurableObject } from "cloudflare:workers";
import { emptyDoc, docFromStored, applyOp, listValueFromDoc } from "./list-doc.js";
import { buildListMeta } from "./lists.js";

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

  // Load persisted state once per wake. Hibernation can evict us between
  // messages, so every entry point calls this first.
  async load() {
    if (this.loaded) return;
    this.id = (await this.ctx.storage.get("id")) || null;
    const savedDoc = await this.ctx.storage.get("doc");
    this.doc = savedDoc || emptyDoc();
    this.clock = (await this.ctx.storage.get("clock")) || 0;
    this.loaded = true;
  }

  async persist() {
    await this.ctx.storage.put("doc", this.doc);
    await this.ctx.storage.put("clock", this.clock);
  }

  presence() {
    const sockets = this.ctx.getWebSockets();
    const names = [];
    for (const ws of sockets) {
      const a = ws.deserializeAttachment();
      if (a && a.author && !names.includes(a.author)) names.push(a.author);
    }
    return { count: sockets.length, names };
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
      ws.serializeAttachment({ author: String(msg.author || "").slice(0, 40) });
      ws.send(JSON.stringify({ t: "state", doc: this.doc, clock: this.clock, presence: this.presence() }));
      this.broadcast({ t: "presence", ...this.presence() }, ws);
      return;
    }

    if (msg.t === "patch" && Array.isArray(msg.ops)) {
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
    this.broadcast({ t: "presence", ...this.presence() });
  }

  async webSocketError() {
    this.broadcast({ t: "presence", ...this.presence() });
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
