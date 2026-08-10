// ALLOWED_ORIGIN became a comma-separated list so a local preview of a test
// branch can exercise the real API. Before that, every Worker call from
// http://localhost:8791 was blocked and the pages silently fell back to stale
// bundled JSON — a local test that looked fine and proved nothing.
//
// The failure mode this guards is subtle: returning the raw list as the header
// value looks correct in curl (the string is right there) but every browser
// rejects it, because Access-Control-Allow-Origin must equal the caller's
// origin EXACTLY or be "*". A test that asserts the header merely "contains"
// the origin would pass against that bug.

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "src", "index.js"), "utf8");
const TOML = readFileSync(join(HERE, "..", "wrangler.toml"), "utf8");

// Pull the real allowedOrigin() out of the Worker and run it, so this exercises
// shipped code rather than a re-implementation that can drift.
const allowedOrigin = Function(`"use strict";
  ${SRC.match(/function allowedOrigin\(env, request\)\s*\{[\s\S]*?\n\}/)[0]}
  return allowedOrigin;`)();

const req = origin => ({ headers: { get: h => (h === "Origin" && origin ? origin : null) } });
const PROD = "https://dkaruri.github.io";
const LOCAL = "http://localhost:8791";
const LIST = { ALLOWED_ORIGIN: `${PROD},${LOCAL}` };

test("a configured origin is echoed back EXACTLY, never the list", () => {
  assert.equal(allowedOrigin(LIST, req(PROD)), PROD);
  assert.equal(allowedOrigin(LIST, req(LOCAL)), LOCAL);
});

test("an unconfigured origin gets the first entry, not itself", () => {
  // Echoing an arbitrary origin back would make the allowlist meaningless.
  assert.equal(allowedOrigin(LIST, req("https://evil.example")), PROD);
});

test("no Origin header falls back to production", () => {
  assert.equal(allowedOrigin(LIST, req(null)), PROD);
  assert.equal(allowedOrigin(LIST, null), PROD);
  assert.equal(allowedOrigin(LIST, undefined), PROD);
});

test("whitespace around a list entry is tolerated", () => {
  const spaced = { ALLOWED_ORIGIN: `${PROD} , ${LOCAL}` };
  assert.equal(allowedOrigin(spaced, req(LOCAL)), LOCAL);
});

test("a single-value config still behaves as before", () => {
  const one = { ALLOWED_ORIGIN: PROD };
  assert.equal(allowedOrigin(one, req(PROD)), PROD);
  assert.equal(allowedOrigin(one, req(LOCAL)), PROD);
});

test("wildcard and empty config still yield *", () => {
  assert.equal(allowedOrigin({ ALLOWED_ORIGIN: "*" }, req(LOCAL)), "*");
  assert.equal(allowedOrigin({}, req(LOCAL)), "*");
});

test("the response varies by Origin, so caches cannot cross-serve it", () => {
  assert.match(SRC, /Vary:\s*"Origin"/,
    "corsHeaders must set Vary: Origin — without it a shared cache can hand one origin's response to another");
});

test("production is the FIRST configured origin", () => {
  // Order is load-bearing: the first entry is what a caller with no Origin gets.
  const m = TOML.match(/^ALLOWED_ORIGIN\s*=\s*"([^"]+)"/m);
  assert.ok(m, "wrangler.toml has no ALLOWED_ORIGIN");
  assert.equal(m[1].split(",")[0].trim(), PROD);
});

test("every CORS call site passes the request through", () => {
  // corsHeaders(env) without a request silently loses origin echoing, which
  // reintroduces the bug for whichever response forgot it.
  assert.equal((SRC.match(/corsHeaders\(env\)/g) || []).length, 0,
    "a corsHeaders(env) call is missing its request argument");
});
