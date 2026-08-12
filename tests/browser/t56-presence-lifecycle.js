// t56 (FIX-009): the CLIENT half of accurate viewer counts.
//  1. hello carries a session id, and that id survives a reload (so the room
//     sees one viewer, not two, after a refresh).
//  2. a heartbeat ping is sent on the 30s interval (the room's stale sweep).
//  3. pagehide closes the socket immediately, instead of leaving a socket the
//     room only reaps after the TTL — the mobile app-switch case.
//  4. becoming visible again reconnects without waiting on backoff.
// Fails against pre-FIX-009 list.html: no sid, no ping, no lifecycle handlers.
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");

const CACHE = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
const EXE = (() => {
  const dirs = fs.readdirSync(CACHE).filter(d => d.startsWith("chromium_headless_shell-"));
  dirs.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  return path.join(CACHE, dirs[0], "chrome-headless-shell-win64", "chrome-headless-shell.exe");
})();

const STUB = () => {
  class FakeWS {
    constructor(url) {
      this.url = url; this.readyState = 0;
      FakeWS.last = this; (FakeWS.all = FakeWS.all || []).push(this);
      setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 0);
    }
    send(d) { (FakeWS.sent = FakeWS.sent || []).push(d); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose && this.onclose(); }
  }
  FakeWS.OPEN = 1;
  window.WebSocket = FakeWS;
  window.__sent = () => (FakeWS.sent || []).map(JSON.parse);
  window.__sockets = () => (FakeWS.all || []).length;
  // Capture intervals so the 30s heartbeat can be fired without waiting 30s.
  window.__intervals = [];
  const realSetInterval = window.setInterval.bind(window);
  window.setInterval = (fn, ms) => { window.__intervals.push({ fn, ms }); return realSetInterval(fn, ms); };
};

const OPEN_LIST = async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  state.lists = { local_1: { name: "Test", permits: [], focal: null, sharedId: "PeeXTko", ticks: {} } };
  state.activeListId = "local_1";
  showList("local_1"); // not awaited: map load can hang, connect is sync
  for (let i = 0; i < 60 && !state.live.connected; i++) await sleep(20);
  return state.live.connected;
};

async function check(page, url) {
  await page.addInitScript(STUB);
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });

  const first = await page.evaluate(async openList => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const connected = await eval(`(${openList})`)();
    const hello = window.__sent().find(m => m.t === "hello");

    // 2. heartbeat: fire the captured 30s interval, expect a ping frame.
    const beat = window.__intervals.find(i => i.ms === 30000);
    if (beat) beat.fn();
    await sleep(10);
    const pinged = window.__sent().some(m => m.t === "ping");

    // 3. pagehide -> socket closed now, not on TTL.
    dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    await sleep(20);
    const closedOnHide = !state.live.connected && state.live.ws === null;
    const socketsAfterHide = window.__sockets();

    // 4. coming back reconnects, without a backoff wait.
    dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    for (let i = 0; i < 60 && !state.live.connected; i++) await sleep(20);
    const resumed = state.live.connected;
    const socketsAfterShow = window.__sockets();

    return { connected, sid: hello && hello.sid, hasBeat: !!beat, pinged, closedOnHide, socketsAfterHide, resumed, socketsAfterShow };
  }, OPEN_LIST.toString());

  // 1. a reload must reuse the same session id.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  const second = await page.evaluate(async openList => {
    await eval(`(${openList})`)();
    const hello = window.__sent().find(m => m.t === "hello");
    return { sid: hello && hello.sid };
  }, OPEN_LIST.toString());

  return { ...first, sidAfterReload: second.sid };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const results = {};
  for (const [name, opts] of [["desktop", { viewport: { width: 1280, height: 900 } }], ["iphone13", { ...devices["iPhone 13"] }]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    results[name] = await check(page, "http://127.0.0.1:8791/list.html");
    await ctx.close();
  }
  await browser.close();

  const fails = [];
  for (const [name, r] of Object.entries(results)) {
    if (!r.connected) fails.push(`${name}: never connected`);
    if (!r.sid) fails.push(`${name}: hello carried no sid`);
    if (r.sid !== r.sidAfterReload) fails.push(`${name}: sid changed across reload (${r.sid} -> ${r.sidAfterReload})`);
    if (!r.hasBeat) fails.push(`${name}: no 30s heartbeat interval`);
    if (!r.pinged) fails.push(`${name}: heartbeat sent no ping`);
    if (!r.closedOnHide) fails.push(`${name}: pagehide left the socket open`);
    if (!r.resumed) fails.push(`${name}: did not reconnect on pageshow`);
    if (r.socketsAfterShow !== r.socketsAfterHide + 1) fails.push(`${name}: expected exactly one new socket on resume`);
  }
  console.log(fails.length ? "FAIL" : "PASS", JSON.stringify({ results, fails }, null, 2));
  process.exit(fails.length ? 1 : 0);
})();
