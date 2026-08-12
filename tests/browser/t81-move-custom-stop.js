// FIX-043 — a hand-typed "+ Add address" stop can be reordered with the arrows.
//
// There is one order on screen but it is stored in two places: permits in
// state.userPermitNumbers, custom stops in their own `pos` inside list.custom,
// spliced together by mergeCustomStops. Every mover used to reach for the
// permits array alone, which is two bugs in one: a custom stop is not in that
// array, so its arrows moved nothing (FIX-042 made them say so); and a permit's
// arrow LEAPFROGGED an added address, moving two visible places on one press.
//
// The assertions are written against what a user can see — the rendered order —
// and then against both stores, because a move that renders right but persists
// wrong comes back wrong on the next load.
const { devices } = require("playwright");
const { chromium, CHROME, openList } = require("./_boot.js");

const ROWS = [1, 2, 3].map(i => ({
  permit_number: `10000${i}`, permit_type: "PERMIT - RENOVATION", permit_status: "ACTIVE",
  issue_date: `2026-01-0${i}`, address: `${i}00 W TEST ST`, ward: "1",
  reported_cost: 1000 * i, work_type: "RENOVATION", latitude: 41.9, longitude: -87.7
}));

// Exactly the shape addCustomStop() builds. pos 2 = second row of the merged list.
const CUSTOM = { id: "c_test1", pos: 2, addr: "999 N HAND TYPED AVE", lat: 41.91, lon: -87.71, use: "residential", work: "siding", gc: "" };

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

// What the user sees: one short token per row, in rendered order.
const shown = page => page.evaluate(() =>
  Array.from(document.querySelectorAll(".saved-permits-table tbody tr")).map(tr => {
    const addr = tr.querySelector('td[data-label="Address"]').textContent.trim();
    return addr.includes("HAND TYPED") ? "X" : addr.slice(0, 1);
  }).join(","));

// What is stored. The rendered order is rebuilt from these two on every load,
// so a move that only looks right is not a move.
const stored = page => page.evaluate(() => ({
  permits: state.userPermitNumbers.slice(),
  custom: (activeList()?.custom || []).map(c => ({ id: c.id, pos: c.pos })),
}));

const rowOf = (page, token) => page.evaluate(t =>
  Array.from(document.querySelectorAll(".saved-permits-table tbody tr"))
    .findIndex(tr => t === "X"
      ? tr.textContent.includes("HAND TYPED")
      : tr.textContent.includes(`${t}00 W TEST ST`)), token);

// nth-child is 1-based; `first()` is the up arrow, `last()` the down arrow.
const arrow = (page, row, dir) =>
  page.locator(`.saved-permits-table tbody tr:nth-child(${row + 1}) td.move-cell button`)[dir < 0 ? "first" : "last"]();

async function seed(page, custom = CUSTOM) {
  await page.evaluate(async ({ rows, c }) => {
    // Seeding does not reset the filters, and section 10 leaves one on — which
    // makes every arrow aria-disabled and muted, so section 11 measured a
    // "live" button that was nothing of the kind. Reset here, once.
    state.listFilters = listFilterDefaults();
    state.userPermitMap = new Map(rows.map(r => [r.permit_number, r]));
    state.lists = { L: { name: "Test", permits: rows.map(r => r.permit_number), focal: null, sharedId: null, custom: c ? [JSON.parse(JSON.stringify(c))] : [] } };
    await showList("L");
  }, { rows: ROWS, c: custom });
  await page.waitForSelector(".saved-permits-table tbody tr", { timeout: 15000 });
  await page.waitForTimeout(200);
}

async function run(label, ctxOpts) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();

  // BASE=https://dkaruri.github.io/chicago-building-permits-search drives the
  // DEPLOYED page instead of the local preview — same convention as t80. The
  // seed goes through state and showList(), so nothing here depends on the
  // Worker being reachable; only the origin changes.
  if (process.env.BASE) {
    await page.goto(`${process.env.BASE}/list.html`);
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  } else {
    await openList(page);
  }
  await seed(page);
  check("the seeded order is 1, hand-typed, 2, 3", await shown(page) === "1,X,2,3", await shown(page));

  // --- 1. the arrows are live on a hand-typed stop -------------------------
  let at = await rowOf(page, "X");
  const up = arrow(page, at, -1);
  check("the hand-typed stop's up arrow is no longer aria-disabled",
    await up.getAttribute("aria-disabled") === null);
  check("...and is not `disabled` either, away from the ends of the list",
    await up.evaluate(el => !el.disabled));
  check("its aria-label names the stop by address, not by an empty permit number",
    /999 N HAND TYPED AVE/.test(await up.getAttribute("aria-label")),
    await up.getAttribute("aria-label"));

  // --- 2. up moves it exactly one visible place ----------------------------
  await up.click();
  await page.waitForTimeout(400);
  check("up moves the hand-typed stop one place", await shown(page) === "X,1,2,3", await shown(page));
  let s = await stored(page);
  check("...and writes it back as pos 1", s.custom[0].pos === 1, JSON.stringify(s.custom));
  check("...without disturbing the permits", s.permits.join(",") === "100001,100002,100003", s.permits.join(","));

  // --- 3. the stored order is the rendered order ---------------------------
  // Re-merging from the two stores has to reproduce what is on screen, or the
  // move only survives until the next render.
  check("re-merging the stores reproduces the rendered order",
    await page.evaluate(() => userListRows().map(r => r.is_custom ? "X" : r.address.slice(0, 1)).join(",")) === await shown(page));

  // --- 4. down, twice, past two permits ------------------------------------
  await arrow(page, await rowOf(page, "X"), 1).click();
  await page.waitForTimeout(400);
  check("down moves it one place", await shown(page) === "1,X,2,3", await shown(page));
  await arrow(page, await rowOf(page, "X"), 1).click();
  await page.waitForTimeout(400);
  check("down again moves it one more", await shown(page) === "1,2,X,3", await shown(page));
  s = await stored(page);
  check("pos tracks it to 3", s.custom[0].pos === 3, JSON.stringify(s.custom));
  check("the permits are STILL untouched by three custom moves",
    s.permits.join(",") === "100001,100002,100003", s.permits.join(","));

  // --- 5. the ends of the list ---------------------------------------------
  await arrow(page, await rowOf(page, "X"), 1).click();
  await page.waitForTimeout(400);
  check("it can reach the last place", await shown(page) === "1,2,3,X", await shown(page));
  at = await rowOf(page, "X");
  check("the down arrow is disabled at the end",
    await arrow(page, at, 1).evaluate(el => el.disabled));
  check("the up arrow is still live there",
    await arrow(page, at, -1).evaluate(el => !el.disabled));

  // --- 6. THE SIBLING BUG: a permit no longer leapfrogs an added address ----
  await seed(page);                                     // back to 1,X,2,3
  await arrow(page, await rowOf(page, "2"), -1).click(); // press up on permit 2
  await page.waitForTimeout(400);
  check("a permit's arrow moves it ONE visible place, over the hand-typed stop",
    await shown(page) === "1,2,X,3", await shown(page));
  s = await stored(page);
  check("...which is a pos change, not a permit reorder — the permits keep their order",
    s.permits.join(",") === "100001,100002,100003", s.permits.join(","));
  check("...recorded as the stop stepping back to pos 3", s.custom[0].pos === 3, JSON.stringify(s.custom));
  // And once past it, the SAME press does reorder the permits.
  await arrow(page, await rowOf(page, "2"), -1).click();
  await page.waitForTimeout(400);
  check("pressing up again swaps the two permits", await shown(page) === "2,1,X,3", await shown(page));
  check("...and that one IS a permit reorder",
    (await stored(page)).permits.join(",") === "100002,100001,100003",
    (await stored(page)).permits.join(","));

  // --- 7. keyboard: focus survives the re-render ---------------------------
  // renderUserList replaces the table's innerHTML, so the button just pressed
  // is gone. Without refocusMoveButton focus lands on <body> and a second press
  // is impossible without re-tabbing — which is what makes the arrows the
  // keyboard alternative to drag-and-drop rather than a mouse-only control.
  await seed(page);
  at = await rowOf(page, "X");
  await arrow(page, at, -1).evaluate(el => el.focus());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  check("a real Enter on the arrow moves the stop", await shown(page) === "X,1,2,3", await shown(page));
  check("focus is still on a move arrow of the moved row, not on <body>",
    await page.evaluate(() => {
      const el = document.activeElement;
      return !!el && el.closest("td.move-cell") !== null && el.closest("tr").textContent.includes("HAND TYPED");
    }), await page.evaluate(() => document.activeElement && document.activeElement.tagName + " " + (document.activeElement.getAttribute("aria-label") || "")));
  check("...and it is the DOWN arrow, because the up arrow is now an end and cannot take focus",
    await page.evaluate(() => /down/i.test(document.activeElement.getAttribute("aria-label") || "")),
    await page.evaluate(() => document.activeElement.getAttribute("aria-label")));

  // --- 8. drag-and-drop agrees with the arrows -----------------------------
  // No synthesized HTML5 drag in Playwright; drive the handler the row's own
  // ondrop calls, with the same keys the template emits.
  await seed(page);
  // The template has to hand the drag handlers the same key the arrows use, or
  // the two controls disagree about a list's order — a hand-typed stop's row
  // used to emit an EMPTY permit number to both ondragstart and ondrop.
  const dragKeys = await page.evaluate(() => {
    const tr = Array.from(document.querySelectorAll(".saved-permits-table tbody tr"))
      .find(row => row.textContent.includes("HAND TYPED"));
    return { start: tr.getAttribute("ondragstart"), drop: tr.getAttribute("ondrop"), tick: tr.dataset.tickRow };
  });
  check("the hand-typed row's ondragstart carries its custom id, not an empty permit number",
    dragKeys.start.includes("c_test1"), dragKeys.start);
  check("...and so does its ondrop target",
    dragKeys.drop && dragKeys.drop.includes("c_test1"), String(dragKeys.drop));
  check("...both matching the key the ticks and the X already use",
    dragKeys.tick === "c_test1", dragKeys.tick);

  // Guarded so the red-first run against pre-FIX-043 code, where moveStopTo does
  // not exist at all, reports a failed assertion instead of aborting the suite.
  const dragged = await page.evaluate(async () => {
    try { await moveStopTo("c_test1", "100003", "after"); return "ok"; }
    catch (e) { return String(e.message || e); }
  });
  check("drag-and-drop goes through the same merged-order mover", dragged === "ok", dragged);
  await page.waitForTimeout(400);
  check("dropping the hand-typed stop after the last permit lands it there",
    await shown(page) === "1,2,3,X", await shown(page));
  check("...and drag writes pos the same way the arrows do",
    (await stored(page)).custom[0].pos === 4, JSON.stringify((await stored(page)).custom));
  await page.evaluate(async () => { try { await moveStopTo("100003", "c_test1", "after"); } catch {} });
  await page.waitForTimeout(400);
  check("dragging a permit past the hand-typed stop also moves one place",
    await shown(page) === "1,2,X,3", await shown(page));

  // --- 9. the announcement says where it landed ----------------------------
  await seed(page);
  await arrow(page, await rowOf(page, "X"), 1).click();
  await page.waitForTimeout(400);
  const said = (await page.locator("#list-action-status").textContent()).trim();
  check("the live region names the stop and its new position",
    /999 N HAND TYPED AVE moved to stop 3 of 4/.test(said), said);

  // --- 10. a filtered view still refuses, with its reason ------------------
  // The offset moves a row within the FULL list, so from a filtered view it
  // would often not appear to move. That block is unchanged by FIX-043 and has
  // to stay.
  await seed(page);
  await page.evaluate(() => { state.listFilters.visited = "exclude"; renderUserList(); });
  await page.waitForTimeout(400);
  const locked = arrow(page, await rowOf(page, "X"), -1);
  check("under a filter the arrow is aria-disabled again",
    await locked.getAttribute("aria-disabled") === "true");
  await locked.evaluate(el => el.focus());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check("...and says which filter to clear",
    /clear the follow-up filter/i.test(await page.locator("#list-action-status").textContent()),
    (await page.locator("#list-action-status").textContent()).trim());

  // --- 11. an unavailable arrow LOOKS unavailable --------------------------
  // Both dead states were painted exactly like a live button before FIX-043:
  // the author `color` on .icon-button outranks the UA's :disabled styling.
  await seed(page);
  const paint = async loc => loc.evaluate(el => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor, border: s.borderTopColor };
  });
  const live = await paint(arrow(page, await rowOf(page, "X"), -1));
  const dead = await paint(arrow(page, 0, -1)); // first row: up is at the end
  check("a disabled end arrow is painted differently from a live one",
    dead.color !== live.color, `${dead.color} vs ${live.color}`);
  // A dispatched mouseover does NOT trigger CSS :hover in Chromium, so probing
  // the rule that way can only ever pass. Ask the cascade instead: the muted
  // rule must be the one that wins, which is a fact about source order that a
  // reordered stylesheet would break.
  check("...and is painted with the muted tokens, not the primary ones",
    await arrow(page, 0, -1).evaluate(el => {
      const want = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
      const probe = document.createElement("span");
      probe.style.color = want;
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(el).color === resolved;
    }), `${dead.color} should be var(--muted)`);

  // --- 11b. and it stays legible in BOTH themes ----------------------------
  // A genuinely `disabled` control is exempt from the contrast rule, but the
  // filter-locked arrow is aria-disabled: still focusable, still with something
  // to say when pressed. It has to be readable. Wait for the theme transition
  // to settle first — measured mid-flight this reports a colour the button
  // never rests at.
  for (const theme of ["light", "dark"]) {
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForFunction(() =>
      document.getAnimations().every(a => a.playState !== "running"), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const ratio = await arrow(page, 0, -1).evaluate(el => {
      const lum = c => {
        const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number)
          .map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const s = getComputedStyle(el);
      const a = lum(s.color), b = lum(s.backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    check(`an unavailable arrow is still legible in ${theme} theme`, ratio >= 4.5, `${ratio.toFixed(2)}:1`);
  }
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });

  // --- 12. touch targets, both viewports -----------------------------------
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll("td.move-cell .icon-button"))
      .map(el => el.getBoundingClientRect())
      .filter(r => r.width < 44 || r.height < 44).length);
  check("every move arrow is at least 44x44", small === 0, `${small} under size`);

  // --- 13. the arrows carry a visible focus ring ---------------------------
  // Driven with a real Tab, not .focus(): getComputedStyle(el, ":focus-visible")
  // does not work (it takes pseudo-ELEMENTS), and a programmatic focus may not
  // match :focus-visible at all, so the lazy version silently reports "no ring"
  // for a control that has one. Tabbing also proves the arrow is genuinely in
  // the tab order, which is what makes it the keyboard alternative to dragging.
  await seed(page);
  await page.evaluate(() => {
    const tr = Array.from(document.querySelectorAll(".saved-permits-table tbody tr"))
      .find(row => row.textContent.includes("HAND TYPED"));
    tr.querySelector('td[data-label="Remove"] button').focus();
  });
  let reached = false;
  for (let i = 0; i < 12 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => !!document.activeElement.closest("td.move-cell"));
  }
  check("tabbing forward from the row reaches a move arrow", reached);
  if (reached) {
    const ring = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { outline: s.outlineStyle, width: s.outlineWidth, shadow: s.boxShadow };
    });
    check("...and it shows a focus ring",
      (ring.outline !== "none" && parseFloat(ring.width) > 0) || (ring.shadow && ring.shadow !== "none"),
      JSON.stringify(ring));
  }

  await page.screenshot({ path: `verify-tmp/t81-${label}.png` });
  await browser.close();
}

(async () => {
  await run("desktop", {});
  await run("iPhone13", { ...devices["iPhone 13"] });
  console.log(`\n${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
})();
