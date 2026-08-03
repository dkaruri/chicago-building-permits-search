import { test } from "node:test";
import assert from "node:assert";
import { presenceFrom, presenceKey, PRESENCE_TTL_MS } from "../src/presence.js";

const NOW = 1_700_000_000_000;
const live = (key, sid, author) => ({ key, sid, author, seen: NOW, beats: true });

test("one session on two sockets counts once (the reload double-count)", () => {
  // A reload: the new socket is open before the old one's close reaches us.
  const p = presenceFrom([live("old", "s1", "Div"), live("new", "s1", "Div")], NOW);
  assert.equal(p.count, 1);
  assert.deepEqual(p.names, ["Div"]);
  assert.deepEqual(p.stale, []);
});

test("distinct sessions each count", () => {
  const p = presenceFrom([live("a", "s1", "Div"), live("b", "s2", "Sam")], NOW);
  assert.equal(p.count, 2);
  assert.deepEqual(p.names, ["Div", "Sam"]);
});

test("a socket that stopped heartbeating is not counted and is reported stale", () => {
  // The backgrounded-mobile case: the socket never closed, it just went quiet.
  const gone = { key: "phone", sid: "s2", author: "Sam", seen: NOW - PRESENCE_TTL_MS - 1, beats: true };
  const p = presenceFrom([live("desk", "s1", "Div"), gone], NOW);
  assert.equal(p.count, 1);
  assert.deepEqual(p.names, ["Div"]);
  assert.deepEqual(p.stale, ["phone"]);
});

test("a socket still inside the TTL counts", () => {
  const quiet = { key: "phone", sid: "s2", seen: NOW - PRESENCE_TTL_MS + 1000, beats: true };
  assert.equal(presenceFrom([quiet], NOW).count, 1);
});

test("a client that does not heartbeat is never reaped (cached pre-fix page)", () => {
  // Old list.html: server-minted sid, no pings. Must keep working, just without
  // the reload/app-switch accuracy the new client gets.
  const old = { key: "cached", sid: "server-uuid", author: "Sam", seen: NOW - PRESENCE_TTL_MS * 10 };
  const p = presenceFrom([live("desk", "s1", "Div"), old], NOW);
  assert.equal(p.count, 2);
  assert.deepEqual(p.stale, []);
});

test("a socket that has not said hello is not a viewer", () => {
  assert.equal(presenceFrom([{ key: "half-open", seen: NOW }], NOW).count, 0);
  assert.deepEqual(presenceFrom([{ key: "half-open", seen: NOW }], NOW).stale, []);
});

test("empty and junk input are safe", () => {
  assert.deepEqual(presenceFrom([], NOW), { count: 0, names: [], stale: [] });
  assert.deepEqual(presenceFrom(null, NOW), { count: 0, names: [], stale: [] });
  assert.equal(presenceFrom([null, undefined], NOW).count, 0);
});

test("blank and duplicate authors never reach the names list", () => {
  const p = presenceFrom([live("a", "s1", "  "), live("b", "s2", "Div"), live("c", "s3", "Div")], NOW);
  assert.equal(p.count, 3);
  assert.deepEqual(p.names, ["Div"]);
});

test("presenceKey changes only when the count or names change", () => {
  const a = presenceFrom([live("a", "s1", "Div")], NOW);
  const b = presenceFrom([live("z", "s1", "Div")], NOW);
  const c = presenceFrom([live("a", "s1", "Div"), live("b", "s2", "Sam")], NOW);
  assert.equal(presenceKey(a), presenceKey(b));
  assert.notEqual(presenceKey(a), presenceKey(c));
});
