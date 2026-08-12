// FEAT-031. Extracted from docs/list.html AT TEST TIME rather than hand-copied,
// for the reason feat024-impl.mjs gives: a static transcription can silently
// drift from the page it claims to mirror, and a test that agrees with a stale
// copy proves nothing about what ships.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HTML = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "list.html");
const source = readFileSync(HTML, "utf8");

function extractBlock(header) {
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`FEAT-031 extraction failed: no ${header.trim()} in docs/list.html`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`FEAT-031 extraction failed: unbalanced braces after ${header.trim()}`);
}

const fn = name => extractBlock(`\n    function ${name}(`);
const obj = name => extractBlock(`\n    const ${name} = {`);

// The page's own globals that these functions close over. `state` and
// `activeList` are the seams the tests drive.
const preamble = `
  const clean = value => (value === null || value === undefined) ? "" : String(value);
  const fmt = n => String(n);
  let _list = null;
  let state = { listFilters: { followUp: false, visited: null, called: null }, live: { connected: false, id: null } };
  function activeList() { return _list; }
  function setList(l) { _list = l; }
  function setFilters(f) { state.listFilters = f; }
  function saveUserLists() {}
  function sendListOp() {}
  function renderUserList() {}
  function announceListAction() {}
  function actorName() { return _actor; }
  let _actor = "";
  function setActor(a) { _actor = a; }
  const flagQueues = { ticks: [], follow: [], called: [] };
  function queueFlagSync() {}
`;

const body = [
  preamble,
  obj("FLAGS"),
  fn("setFlag"),
  fn("flagOn"),
  fn("flagActor"),
  fn("flagByText"),
  fn("tickKeyFor"),
  fn("isTicked"),
  fn("isCalled"),
  fn("isFollowedUp"),
  // FEAT-047 (`0be750d`) rewired isListFiltered and visibleListRows onto these
  // two and did not add them here, so every extracted call threw
  // "normalizeTriState is not defined" — 12 of the 13 reds in this set. The
  // extractor pulls a NAMED list, so a new dependency inside an already-listed
  // function is invisible until it runs: when you make an extracted function
  // call something new, add the callee here in the same change.
  fn("normalizeTriState"),
  fn("matchesTriState"),
  // FEAT-046 added a stage facet to the same filter, so visibleListRows now
  // calls permitStage, which reads PERMIT_STAGES.
  obj("PERMIT_STAGES"),
  fn("permitStage"),
  fn("isListFiltered"),
  fn("visibleListRows"),
  fn("setRowFilter"),
  fn("noRowsMatchText"),
  obj("PERMIT_STAGE_LABELS"),
  fn("activeFilterWords"),
  fn("announceFilterState"),
  `return { setList, setFilters, setActor, state, flagQueues, setFlag, flagOn, flagActor, flagByText,
            tickKeyFor, isTicked, isCalled, isFollowedUp, normalizeTriState, matchesTriState,
            permitStage, isListFiltered, visibleListRows, setRowFilter, noRowsMatchText };`,
].join("\n");

// eslint-disable-next-line no-new-func
export const impl = new Function(body)();

// A row as userListRows() builds it.
export const permit = (permit_number, address = "") => ({ permit_number, address });
export const custom = custom_id => ({ is_custom: true, custom_id, permit_number: "" });
