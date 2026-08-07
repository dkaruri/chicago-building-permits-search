// Repo-wide guard: the three pages must agree on the saved-list cap (FIX-046).
//
// `userListLimit` is a bare `const` declared separately in index.html, map.html
// and list.html, and all three read and write ONE stored list. When FEAT-035
// raised it to 1000 on list.html only, the other two kept 220 — so a list built
// on My Permit List was, on the other pages, 180 permits over a limit they then
// enforced by deleting the tail. Measured 2026-08-07: opening a 400-permit list
// on map.html cut it to 220 before the user touched anything.
//
// There is no build step and no shared module to put the number in, so the
// agreement is enforced here instead. This runs in the normal
// `node --test test/*.test.mjs` that CI already executes.

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs");
const PAGES = ["index.html", "map.html", "list.html"];

const read = page => readFileSync(join(DOCS, page), "utf8");

test("every page declares userListLimit exactly once", () => {
  for (const page of PAGES) {
    const hits = read(page).match(/const\s+userListLimit\s*=\s*\d+\s*;/g) || [];
    assert.equal(hits.length, 1, `${page} declares it ${hits.length} times`);
  }
});

test("the three pages agree on the cap", () => {
  const caps = PAGES.map(page => {
    const m = read(page).match(/const\s+userListLimit\s*=\s*(\d+)\s*;/);
    assert.ok(m, `${page} has no userListLimit declaration`);
    return [page, Number(m[1])];
  });
  const values = new Set(caps.map(([, n]) => n));
  assert.equal(values.size, 1,
    `the pages disagree on the saved-list cap: ${caps.map(([p, n]) => `${p}=${n}`).join(", ")}. ` +
    `They share one stored list, so the lowest number silently deletes permits the others hold.`);
});

test("saving the list never trims it to the cap", () => {
  // A SAVE must not destroy data. The cap belongs where an add happens, because
  // only that code knows it is adding rather than persisting what the user
  // already has. FIX-037 made the add paths cap-aware; a trim here undid it.
  for (const page of PAGES) {
    const src = read(page);
    const fn = src.slice(src.indexOf("function saveUserListCookie"));
    const body = fn.slice(0, fn.indexOf("\n    }"));
    assert.ok(!body.includes("slice(0, userListLimit)"),
      `${page}'s saveUserListCookie still trims to the cap — a save must never delete saved permits`);
  }
});

test("the cap is the value FEAT-035 measured", () => {
  // Not a style rule: 1000 is the ceiling FEAT-035 measured against a Durable
  // Object 128 KiB per-value limit and an OSRM request budget. Changing it is
  // allowed, but it must be re-measured against those, not just typed.
  const m = read("list.html").match(/const\s+userListLimit\s*=\s*(\d+)\s*;/);
  assert.equal(Number(m[1]), 1000);
});
