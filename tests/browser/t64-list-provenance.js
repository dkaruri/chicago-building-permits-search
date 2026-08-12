// t64 — FEAT-032: the search conditions that produced an add are recorded in the
// list description, and that description is visible on the list itself.
//
// Drives the real pages rather than the extracted block (feat032-source.mjs
// covers the logic): what this proves is that the add PATHS actually call it,
// on all three pages, and that the rendered block behaves at both viewports.
//
// Run: node verify-tmp/t64-list-provenance.js   (needs :8791 serving docs/)
const { devices } = require("playwright");
const { chromium, CHROME, openList } = require("./_boot.js");

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

// Seed one list and drop the page into the list view. Mirrors _boot.seedSavedList
// but keeps the desc so provenance can be asserted, and works on index/map too
// (which have no showList).
const SEED = `(() => {
  state.lists = { L: { name: "Test", permits: [], focal: null, sharedId: null } };
  state.activeListId = "L";
  saveUserLists();
})()`;

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  try {
    // ---- 1. an add from Search records the Search conditions ----
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await openList(page, "index.html");
      await page.evaluate(SEED);
      const desc = await page.evaluate(async () => {
        state.mode = "open_permits";
        document.getElementById("q").value = "roof";
        document.getElementById("ward").value = "47";
        document.getElementById("cost-min").value = "50000";
        await addPermitsToUserList(
          [{ permit_number: "P1", address: "1 N Main" }, { permit_number: "P2", address: "2 N Main" }],
          { listId: "L" }
        );
        return state.lists.L.desc;
      });
      check("Search add writes a provenance line",
        /^• \w{3} \d{1,2} — 2 from Search: Open Permits · "roof" · Ward 47 · \$50k\+$/.test(desc || ""),
        JSON.stringify(desc));
      await ctx.close();
    }

    // ---- 2. an add from the Permit Map records the map drawer ----
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await openList(page, "map.html");
      await page.evaluate(SEED);
      const desc = await page.evaluate(async () => {
        state.mode = "map";
        state.map.settings = {
          dateFrom: "2026-07-01", dateTo: "2026-08-05", gcMin: "", gcMax: "",
          costMin: "50000", costMax: "250000", neighborhood: "", q: "",
          radiusMiles: "", excludedWorkTypes: ["RENOVATION"], propertyUse: ""
        };
        await addPermitsToUserList([{ permit_number: "M1", address: "9 W Oak" }], { listId: "L", skipModeRefresh: true });
        return state.lists.L.desc;
      });
      check("Permit Map add writes the map filters",
        /— 1 from Permit Map: Jul 1–Aug 5, 2026 · \$50k–\$250k · 1 work type excluded$/.test(desc || ""),
        JSON.stringify(desc));
      await ctx.close();
    }

    // ---- 3. a hand-typed stop says it had no filters ----
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.route("**/nominatim.openstreetmap.org/**", r =>
        r.fulfill({ json: [{ lat: "41.9", lon: "-87.7", display_name: "5 S Elm, Chicago" }] }));
      await openList(page, "list.html");
      const desc = await page.evaluate(async () => {
        state.lists = { L: { name: "Test", permits: [], custom: [], focal: null, sharedId: null } };
        state.activeListId = "L";
        await showList("L");
        openAddAddress();
        const dlg = document.getElementById("add-address");
        dlg.querySelector("#ca-addr").value = "5 S Elm";
        await addCustomStop(dlg);
        return state.lists.L.desc;
      });
      check("a hand-typed stop records no filters",
        /— 1 added by hand: no filters$/.test(desc || ""),
        JSON.stringify(desc));
      await ctx.close();
    }

    // ---- 4/5. the description renders, clamps, and expands — both viewports ----
    for (const [label, opts] of [["desktop", {}], ["iPhone 13", { ...devices["iPhone 13"] }]]) {
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      await openList(page, "list.html");
      const long = Array.from({ length: 12 }, (_, i) => `• Aug ${i + 1} — ${i + 1} from Search: Open Permits · Ward ${i}`).join("\n");
      await page.evaluate(async desc => {
        state.lists = { L: { name: "Test", permits: [], custom: [], focal: null, sharedId: null, desc } };
        state.activeListId = "L";
        await showList("L");
      }, long);
      await page.waitForFunction(() => !document.getElementById("user-list-desc-wrap").hidden, null, { timeout: 10000 });
      // Layout animations (listRise) must settle before any geometry is read.
      await page.waitForFunction(() =>
        document.getAnimations().every(a => a.playState !== "running"), null, { timeout: 10000 });

      // FEAT-052 replaced the 3-line clamp with the header fold: the description
      // is shown IN FULL and it is the whole header that folds, open by default.
      const collapsed = await page.evaluate(() => {
        const body = document.getElementById("user-list-desc");
        const more = document.getElementById("list-header-toggle");
        const r = more.getBoundingClientRect();
        return {
          text: body.textContent.slice(0, 20),
          shownHeight: body.clientHeight,
          fullHeight: body.scrollHeight,
          moreShown: !more.hidden,
          moreLabel: more.textContent.trim().split(/\s+/)[0],
          expanded: more.getAttribute("aria-expanded"),
          controls: more.getAttribute("aria-controls"),
          targetH: r.height,
          targetW: r.width,
          docWidth: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
        };
      });
      check(`[${label}] the description is rendered`, collapsed.text.startsWith("• Aug 1 — 1 from"), collapsed.text);
      check(`[${label}] the description is shown in full, not clamped`,
        collapsed.shownHeight >= collapsed.fullHeight - 1,
        `${collapsed.shownHeight}px of ${collapsed.fullHeight}px`);
      check(`[${label}] the header fold toggle is offered`, collapsed.moreShown && collapsed.moreLabel === "Details");
      check(`[${label}] the toggle is wired to the fold for screen readers`,
        collapsed.expanded === "true" && collapsed.controls === "list-header-fold");
      check(`[${label}] the toggle meets the 44px touch target`,
        collapsed.targetH >= 43.5, `${collapsed.targetH.toFixed(1)}px tall`);
      check(`[${label}] no horizontal overflow`,
        collapsed.docWidth <= collapsed.viewport + 1, `${collapsed.docWidth} vs ${collapsed.viewport}`);

      // A 12-line description now renders in full (FEAT-052 dropped the 3-line
      // clamp), so the toolbar below it is no longer on the first screen — that
      // is the trade the fold pays for. What must hold instead: folding the
      // header brings the toolbar (and everything under it) back up.
      const vh = opts.viewport ? opts.viewport.height : 720;
      const toolbarTop = await page.evaluate(() =>
        document.querySelector(".user-list-toolbar").getBoundingClientRect().top);
      await page.click("#list-header-toggle");
      await page.waitForFunction(() =>
        document.getAnimations().every(a => a.playState !== "running"), null, { timeout: 10000 });
      const filtersTop = await page.evaluate(() =>
        document.getElementById("list-filters").getBoundingClientRect().top);
      await page.click("#list-header-toggle");
      await page.waitForFunction(() =>
        document.getAnimations().every(a => a.playState !== "running"), null, { timeout: 10000 });
      check(`[${label}] folding the header brings the filters onto the first screen`,
        filtersTop < vh && filtersTop < toolbarTop,
        `filters at ${filtersTop.toFixed(0)}px folded vs toolbar at ${toolbarTop.toFixed(0)}px open, viewport ${vh}px`);

      // The collapsed default is what users actually land on — shoot it before
      // anything expands or switches theme.
      await page.screenshot({ path: `verify-tmp/t64-${label.replace(/\W/g, "")}-collapsed.png`, fullPage: false });

      // Keyboard, driven for real: focus it from a known neighbour so the
      // element must genuinely be in the tab order, read the ring off
      // activeElement (getComputedStyle cannot take :focus-visible), and
      // activate with Enter rather than .click(), which would pass even on a
      // control that has no key handling at all.
      const keyboard = await (async () => {
        // Tab in from the link that precedes the toggle in the title row, so the
        // toggle must genuinely be in the tab order to be reached.
        await page.focus(".back-to-dir");
        await page.keyboard.press("Tab");
        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          const s = getComputedStyle(el);
          return { id: el.id, outline: s.outlineWidth, style: s.outlineStyle };
        });
        await page.keyboard.press("Enter");
        await page.waitForFunction(() =>
          document.getAnimations().every(a => a.playState !== "running"), null, { timeout: 10000 });
        const after = await page.evaluate(() =>
          document.getElementById("list-header-toggle").getAttribute("aria-expanded"));
        return { ...focused, after };
      })();
      check(`[${label}] the fold toggle is reachable by Tab`, keyboard.id === "list-header-toggle", `focus landed on "${keyboard.id}"`);
      check(`[${label}] the focused toggle shows a ring`,
        keyboard.style !== "none" && parseFloat(keyboard.outline) >= 2, `${keyboard.style} ${keyboard.outline}`);
      check(`[${label}] Enter folds the header`, keyboard.after === "false", `aria-expanded=${keyboard.after}`);

      // Back open, so the click path below starts where it expects to.
      await page.click("#list-header-toggle");
      await page.waitForFunction(() =>
        document.getAnimations().every(a => a.playState !== "running"), null, { timeout: 10000 });
      const open = await page.evaluate(() => {
        const body = document.getElementById("user-list-desc");
        const more = document.getElementById("list-header-toggle");
        return {
          h: body.clientHeight, full: body.scrollHeight,
          expanded: more.getAttribute("aria-expanded"),
          foldH: document.getElementById("list-header-fold").getBoundingClientRect().height,
        };
      });
      check(`[${label}] reopening shows the whole description again`,
        open.h >= open.full - 1 && open.expanded === "true" && open.foldH > 0,
        `${open.h}px of ${open.full}px, fold ${open.foldH.toFixed(0)}px`);

      // Contrast, in BOTH themes. color() components are 0-1 in Chromium.
      for (const theme of ["light", "dark"]) {
        await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
        await page.waitForFunction(() =>
          document.getAnimations().every(a => a.playState !== "running"), null, { timeout: 10000 });
        const ratio = await page.evaluate(() => {
          const parse = s => {
            let m = s.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/);
            if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255];
            m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
            return m ? [+m[1], +m[2], +m[3]] : null;
          };
          const lum = ([r, g, b]) => {
            const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
          };
          const el = document.getElementById("user-list-desc");
          const fg = parse(getComputedStyle(el).color);
          let node = el, bg = null;
          while (node && !bg) {
            const c = getComputedStyle(node).backgroundColor;
            if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) bg = parse(c);
            node = node.parentElement;
          }
          bg = bg || [255, 255, 255];
          const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          return (a + 0.05) / (b + 0.05);
        });
        check(`[${label}] description text meets 4.5:1 in ${theme}`, ratio >= 4.5, `${ratio.toFixed(2)}:1`);
      }

      await page.screenshot({ path: `verify-tmp/t64-${label.replace(/\W/g, "")}.png`, fullPage: false });

      // A list nobody has folded opens OPEN (FEAT-052's default), whatever the
      // list before it was left as — fold state is stored per list.
      const switched = await page.evaluate(async () => {
        state.lists.M = {
          name: "Second", permits: [], custom: [], focal: null, sharedId: null,
          desc: Array.from({ length: 9 }, (_, i) => `• Aug ${i + 1} — 1 from Search: Open Permits · Ward ${i}`).join("\n"),
        };
        await showList("M");
        const more = document.getElementById("list-header-toggle");
        return {
          collapsed: document.getElementById("list-header-fold").dataset.collapsed,
          expanded: more.getAttribute("aria-expanded"),
        };
      });
      check(`[${label}] a list nobody has folded opens with its details showing`,
        switched.collapsed === "false" && switched.expanded === "true",
        `collapsed=${switched.collapsed} aria-expanded=${switched.expanded}`);

      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log(`${failed.length} FAILURES`);
    process.exit(1);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
