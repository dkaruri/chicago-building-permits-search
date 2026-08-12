// Mutation control for FEAT-040. map.html is CRLF (7,337 / 0 bare LF), so every
// anchor here is SINGLE-LINE — a multi-line one silently never matches and the
// mutant reports as "skipped", which reads like a pass.
const fs = require("fs");
const { execFileSync } = require("child_process");
const FILE = "docs/map.html";

const MUTANTS = [
  ["visited means the ACTIVE list only, not any list",
   "      for (const list of Object.values(state.lists || {})) {",
   "      for (const list of [activeList()].filter(Boolean)) {"],
  ["unlisted permits are treated as 'not visited' (the dishonest reading)",
   "          if (!flags.listed.has(clean(row.n))) return false;", "          ;"],
  ["pressing the active chip no longer clears the facet",
   "      settings[facet] = settings[facet] === want ? null : want;",
   "      settings[facet] = want;"],
  ["the chip bar shows even when no flag can exist",
   "      bar.hidden = !flags.visited.size && !flags.called.size && !mapFlagFilterOn(settings);",
   "      bar.hidden = false;"],
  ["the status strip stops stating the scope",
   "        ? ` | your saved permits only, ${flagNames.join(\" and \")}`", "        ? ``"],
  ["chips stretch to full width on mobile again (FIX-019's bug)",
   "      .map-drawer .list-filters button.tag {", "      .map-drawer .list-filters button.tag--off {"],
  // The real persistence hazard is not a missing save — applyMapFilters saves
  // the whole settings object anyway. It is saveMapSettingsFromControls
  // rebuilding a facet from a control that is not on the page, which is exactly
  // how FEAT-024's work-type exclusions could have been silently cleared.
  ["saveMapSettingsFromControls clobbers the facets",
   "      if (propertyUse) settings.propertyUse = propertyUse.value || \"\";",
   "      if (propertyUse) settings.propertyUse = propertyUse.value || \"\"; settings.visited = null; settings.called = null;"],
  ["the pressed state loses its check glyph (colour alone)",
   "    button.tag[aria-pressed=\"true\"]::before { content: \"\\2713\"; font-size: .8em; }",
   "    button.tag[aria-pressed=\"true\"]::before { content: \"\"; font-size: .8em; }"],
];

const original = fs.readFileSync(FILE);
let bad = 0;
for (const [name, from, to] of MUTANTS) {
  const src = original.toString("latin1");
  if (!from || !to || from === to) { console.log(`BAD MUTANT (empty/no-op)  ${name}`); bad++; continue; }
  if (!src.includes(from)) { console.log(`SKIPPED (anchor missing!)  ${name}`); bad++; continue; }
  fs.writeFileSync(FILE, Buffer.from(src.replace(from, to), "latin1"));
  let red = false;
  try { execFileSync("node", ["verify-tmp/t69-map-visited-called.js"], { stdio: "pipe" }); }
  catch { red = true; }
  console.log(`${red ? "CAUGHT " : "MISSED "}  ${name}`);
  if (!red) bad++;
  fs.writeFileSync(FILE, original);
}
console.log(bad ? `\n${bad} MUTANT(S) NOT CAUGHT` : "\nALL MUTANTS CAUGHT");
process.exit(bad ? 1 : 0);
