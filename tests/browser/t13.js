// t13: the Share button must reuse an existing share id, never mint a second
// backend copy. Also: sharing an unpublished list POSTs once, stores the id,
// and the next Share reuses it (no 2nd POST).
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const page = await browser.newPage();
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  // Every network call is mocked: this test used to reach the LIVE Worker for
  // stats and the directory, so its timing moved with the network.
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
  await page.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 0, cached_at: "2026-07-28" }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/list.html", { waitUntil: "domcontentloaded" });
  // THE FLAKE: waiting only for shareUserList to be defined let init() finish
  // mid-test, and init's loadUserListCookie REPLACES state.lists — wiping the
  // lists this test seeds. Wait for init to actually finish.
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });

  const out = await page.evaluate(async () => {
    // Count POSTs to /api/lists (the create-new-list call).
    const posts = [];
    const realFetch = window.fetch;
    window.fetch = (url, opt) => {
      if (String(url).endsWith("/api/lists") && opt && opt.method === "POST") {
        posts.push(url);
        return Promise.resolve(new Response(JSON.stringify({ id: "NEWID" + posts.length }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return realFetch(url, opt);
    };
    // clipboard present so we don't hit the DOM fallback dialog
    try { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true }); } catch {}

    // Case A: already published -> reuse, zero POSTs
    state.lists = { a: { name: "Pub", permits: ["100"], focal: null, sharedId: "YnF7y4t" } };
    state.activeListId = "a";
    state.userPermitNumbers = ["100"];
    await shareUserList();
    const publishedReuse = { posts: posts.length, sharedId: state.lists.a.sharedId };

    // Case B: unpublished -> one POST, id stored, then reuse (still one POST total)
    posts.length = 0;
    state.lists = { b: { name: "Draft", permits: ["200"], focal: null, sharedId: null } };
    state.activeListId = "b";
    state.userPermitNumbers = ["200"];
    await shareUserList();
    const afterFirst = { posts: posts.length, sharedId: state.lists.b.sharedId };
    await shareUserList();
    const afterSecond = { posts: posts.length, sharedId: state.lists.b.sharedId };

    return { publishedReuse, afterFirst, afterSecond };
  });

  const ok =
    out.publishedReuse.posts === 0 && out.publishedReuse.sharedId === "YnF7y4t" &&
    out.afterFirst.posts === 1 && out.afterFirst.sharedId === "NEWID1" &&
    out.afterSecond.posts === 1 && out.afterSecond.sharedId === "NEWID1";
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(out));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
