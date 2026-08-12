// t32 (FIX-004): above MAX_SORT_STOPS the Optimize route button must be
// genuinely unusable, not a button that accepts a click and then errors.
//
// A. over the cap: aria-disabled="true", the reason is visible, and clicking
//    fires NO routing request and does not touch the saved order
// B. the button stays FOCUSABLE and keyboard-activatable — it is aria-disabled,
//    not disabled, so a screen-reader user can still land on it and hear why.
//    A real Enter press must also be refused (not silently reorder the list).
// C. the reason is wired to the button via aria-describedby
// D. under the cap: not aria-disabled, note hidden, and the sort still runs
// E. the focal origin counts against the budget (399 + focal = at the cap)
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

// Read the ceiling out of docs/list.html instead of hardcoding it. This suite
// hardcoded 400/401 and went red the moment FEAT-035 raised the cap to 500 --
// the behaviour was correct, the test had simply outlived the number. Derived,
// it tracks whatever ships.
const MAX_SORT_STOPS = Number(
  /const MAX_SORT_STOPS = (\d+);/.exec(
    require("fs").readFileSync(require("path").join(__dirname, "..", "..", "docs", "list.html"), "utf8"),
  )[1],
);


const FAKE_OSRM = `
  window.__tableCalls = 0;
  const realFetch = window.fetch;
  window.fetch = (url, opt) => {
    const s = String(url);
    if (s.includes("/table/v1/driving/")) {
      window.__tableCalls += 1;
      const u = new URL(s);
      const coords = u.pathname.split("/driving/")[1].split(";").map(p => p.split(",").map(Number));
      const idx = key => {
        const v = u.searchParams.get(key);
        return v === null ? coords.map((_, i) => i) : v.split(";").map(Number);
      };
      const cost = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * 1000;
      const durations = idx("sources").map(i => idx("destinations").map(j => cost(coords[i], coords[j])));
      return Promise.resolve(new Response(JSON.stringify({ durations, distances: durations }),
        { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (s.includes("/route/v1/driving/")) {
      const n = new URL(s).pathname.split("/driving/")[1].split(";").length;
      return Promise.resolve(new Response(JSON.stringify({
        routes: [{ legs: Array.from({ length: n - 1 }, () => ({ distance: 1000, duration: 60 })) }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return realFetch(url, opt);
  };
`;

const seed = (n, withFocal) => `
  // focalOriginRow() ignores an unresolved focal point, so resolved:true is
  // required for this to count against the budget at all.
  state.focalPoint = ${withFocal ? `{ label: "Start", resolved: true, latitude: 41.88, longitude: -87.63 }` : "null"};
  state.userPermitMap = new Map();
  state.userPermitNumbers = [];
  state.lists = { L: { name: "Big", permits: [], focal: null, sharedId: null } };
  state.activeListId = "L";
  for (let i = 0; i < ${n}; i += 1) {
    const num = "P" + String(i).padStart(4, "0");
    state.userPermitMap.set(num, {
      permit_number: num,
      latitude: 41.7 + ((i * 37) % 100) / 400,
      longitude: -87.8 + ((i * 53) % 100) / 400,
      address: i + " TEST ST", permit_status: "ACTIVE",
    });
    state.userPermitNumbers.push(num);
    state.lists.L.permits.push(num);
  }
`;

async function run(browser, n, withFocal = false) {
  const page = await browser.newPage();
  await page.addInitScript(FAKE_OSRM);
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
  await page.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 0, cached_at: "2026-07-28" }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/list.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });

  await page.evaluate(async s => { eval(s); await showList("L"); }, seed(n, withFocal));

  const before = await page.evaluate(() => {
    const btn = document.getElementById("optimize-route-btn");
    const note = document.getElementById("optimize-route-note");
    window.__tableCalls = 0;
    return {
      ariaDisabled: btn.getAttribute("aria-disabled"),
      domDisabled: btn.disabled,
      noteHidden: note.hidden,
      noteText: note.textContent,
      describedBy: btn.getAttribute("aria-describedby"),
      orderBefore: state.userPermitNumbers.slice(0, 5).join(","),
    };
  });

  // B: focus it for real and press Enter — an aria-disabled button is still a
  // <button>, so this fires onclick and must be refused there.
  await page.focus("#optimize-route-btn");
  const focused = await page.evaluate(() => document.activeElement.id);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);

  const after = await page.evaluate(() => ({
    tableCalls: window.__tableCalls,
    orderAfter: state.userPermitNumbers.slice(0, 5).join(","),
    summary: state.userRouteSummary,
  }));

  await page.close();
  return { n, withFocal, focused, ...before, ...after, orderChanged: before.orderBefore !== after.orderAfter };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const over = await run(browser, MAX_SORT_STOPS + 1);
  const under = await run(browser, 60);
  const atCapWithFocal = await run(browser, MAX_SORT_STOPS, true);   // cap + focal origin = cap + 1 > cap
  console.log(JSON.stringify({ over, under, atCapWithFocal }, null, 2));

  const ok =
    // A + B + C
    over.ariaDisabled === "true" && over.domDisabled === false &&
    over.noteHidden === false && /unavailable/i.test(over.noteText) &&
    over.describedBy === "optimize-route-note" &&
    over.focused === "optimize-route-btn" &&
    over.tableCalls === 0 && over.orderChanged === false &&
    // E: the focal origin counts against the budget
    atCapWithFocal.ariaDisabled === "true" && atCapWithFocal.tableCalls === 0 &&
    // D
    under.ariaDisabled === "false" && under.noteHidden === true &&
    under.tableCalls > 0 && under.orderChanged === true;
  console.log(ok ? "PASS" : "FAIL");
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
