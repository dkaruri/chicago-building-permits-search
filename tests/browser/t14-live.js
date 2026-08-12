// t14: verify on the LIVE site + LIVE Worker that Share reuses an existing
// share id and does NOT POST a new list. We intercept POST /api/lists as a
// safety net (fail if it fires) so a regression can't create a real orphan.
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const LIVE = "https://dkaruri.github.io/chicago-building-permits-search/list.html";

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const page = await browser.newPage();

  let postCount = 0;
  await page.route("**/api/lists", route => {
    if (route.request().method() === "POST") {
      postCount++; // block it — do not create a real orphan on the live Worker
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "BLOCKED_NEW" }) });
    }
    return route.continue();
  });

  await page.goto(LIVE, { waitUntil: "domcontentloaded" });
  // NOT `typeof shareUserList === "function"`: declarations hoist, so that
  // fires before init() has even started. init's async tail then calls
  // loadUserListCookie(), which REPLACES state.lists and wipes the seed below —
  // the failure was "Cannot read properties of undefined (reading 'sharedId')"
  // on roughly half of runs. body[data-ready] is set at the end of init.
  // Same race that kept t2/t6/t8b red; this suite predates the _boot.js fix and
  // does not use it, because it drives the LIVE site rather than localhost.
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });

  const res = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let copied = null;
    try { Object.defineProperty(navigator, "clipboard", { value: { writeText: t => { copied = t; return Promise.resolve(); } }, configurable: true }); } catch {}
    // seed a real published list (YnF7y4t = the live 99-permit list)
    state.lists = { live: { name: "Live", permits: ["100000000"], focal: null, sharedId: "YnF7y4t" } };
    state.activeListId = "live";
    state.userPermitNumbers = ["100000000"];
    await shareUserList();
    // Wait for the clipboard write rather than guessing at 50ms — shareUserList
    // races a share sheet against a timeout and then connects the live socket.
    for (let i = 0; i < 100 && copied === null; i += 1) await sleep(20);
    return {
      copied,
      sharedId: (state.lists.live || {}).sharedId ?? null,
      listKeys: Object.keys(state.lists || {}),
      hasReuseFix: typeof shareUserList === "function" && shareUserList.toString().includes("existing share id"),
    };
  });

  // listKeys is reported so a future failure says WHY — an empty or default
  // list set means the seed was clobbered again, not that sharing regressed.
  const ok = postCount === 0 && res.sharedId === "YnF7y4t" && /#s=YnF7y4t$/.test(res.copied || "") && res.hasReuseFix;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify({ postCount, ...res }));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
