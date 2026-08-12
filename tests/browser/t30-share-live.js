// t30 (FIX-005, second half): after the FIRST Share mints a share id, later edits
// to the list must still reach the shared copy.
//
// sendListOp is a no-op unless state.live is connected to that share id, and
// liveConnect only runs from showList() — which had already run, before the id
// existed. So the very first Share left the publisher disconnected from its own
// room: every edit until the next navigation was dropped, and re-Sharing handed
// out the same id pointing at a stale copy.
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

// Minimal fake WebSocket: records what the page sends, reports open immediately.
const FAKE_WS = `
  window.__sent = [];
  window.__sockets = 0;
  class FakeWS {
    constructor(url) {
      this.url = url; this.readyState = 1; window.__sockets++;
      window.__lastWs = this;
      setTimeout(() => this.onopen && this.onopen({}), 0);
    }
    send(data) { window.__sent.push(data); }
    close() { this.readyState = 3; this.onclose && this.onclose({}); }
  }
  FakeWS.OPEN = 1;
  window.WebSocket = FakeWS;
`;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const page = await browser.newPage();
  await page.addInitScript(FAKE_WS);
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [] }) }));
  await page.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 0, cached_at: "2026-07-28" }) }));
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/list.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });

  const out = await page.evaluate(async () => {
    window.fetch = (url, opt) => {
      if (String(url).endsWith("/api/lists") && opt && opt.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ id: "MINTED1" }),
          { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    };
    try { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true }); } catch (e) {}
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });

    // A brand-new, never-shared list, opened the normal way.
    state.lists = { b: { name: "Draft", permits: ["100"], focal: null, sharedId: null } };
    state.activeListId = "b";
    state.userPermitNumbers = ["100"];
    await showList("b");
    const beforeShare = { sockets: window.__sockets, liveId: state.live.id, connected: state.live.connected };

    await shareUserList();
    await new Promise(r => setTimeout(r, 150));   // let the socket report open
    const afterShare = {
      sharedId: state.lists.b.sharedId,
      sockets: window.__sockets,
      liveId: state.live.id,
      connected: state.live.connected,
    };

    // Now edit the list — this must reach the room the link points at.
    window.__sent.length = 0;
    state.lists.b.permits = ["100", "200"];
    state.userPermitNumbers = ["100", "200"];
    sendListOp({ f: "p", v: state.lists.b.permits });
    const edit = { sent: window.__sent.length, payload: window.__sent[0] || null };

    return { beforeShare, afterShare, edit };
  });

  console.log(JSON.stringify(out, null, 2));
  const ok =
    out.afterShare.sharedId === "MINTED1" &&
    out.afterShare.connected === true &&
    out.afterShare.liveId === "MINTED1" &&
    out.edit.sent === 1;
  console.log(ok ? "PASS" : "FAIL");
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
