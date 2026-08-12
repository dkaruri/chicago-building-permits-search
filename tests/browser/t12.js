// t12: Phase C presence pill — rendering, and what does and does not clear it.
//
// A published list open with 2+ live viewers shows a "N here" pill by the
// heading: it renders (non-zero box, correct text and label). What clears it was
// REWRITTEN for FIX-031 (FIX-033): the pill is bound to who is in the room, not
// to the state of our socket.
//   - a transport close does NOT clear it. ws.onclose deliberately leaves
//     presence alone — the count has not changed just because our socket
//     dropped, and repainting on every blip WAS the flicker FIX-031 fixed.
//   - a drop below 2 arriving as a presence frame is HELD for a grace period
//     (the phone-in-pocket case), not applied instantly.
//   - only a DELIBERATE leave (liveDisconnect) clears it, immediately.
//
// That last case is why it is here and not left implicit: with both of the old
// assertions inverted, a pill that was simply hardcoded visible would satisfy
// every other check in this file. The deliberate-leave case is what still
// discriminates.
//
// The grace period's own mechanics — expiry, cancel-on-return, no re-arm on a
// repeated drop, rises never delayed — belong to t58-presence-jiggle and are
// not duplicated here.
//
// Runs desktop + iPhone 13.
const { chromium, devices } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

const WS_STUB = () => {
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 0); }
    send(d) { (FakeWS.sent = FakeWS.sent || []).push(d); }
    close() { this.readyState = 3; this.onclose && this.onclose(); }
  }
  FakeWS.OPEN = 1;
  window.WebSocket = FakeWS;
  window.__wsRecv = m => FakeWS.last.onmessage({ data: JSON.stringify(m) });
  window.__wsClose = () => FakeWS.last.close();
};

async function check(page, url) {
  await page.addInitScript(WS_STUB);
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });

  return page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const box = () => { const el = document.getElementById("live-presence"); const r = el.getBoundingClientRect(); return { hidden: el.hidden, text: el.textContent, w: Math.round(r.width), h: Math.round(r.height), label: el.getAttribute("aria-label"), dotColor: getComputedStyle(el.querySelector(".dot") || document.body).backgroundColor }; };

    state.lists = { local_1: { name: "Test", permits: [], focal: null, sharedId: "YnF7y4t", ticks: {} } };
    state.activeListId = "local_1";
    showList("local_1"); // don't await — map load may hang; heading+connect are sync
    for (let i = 0; i < 50 && !state.live.connected; i++) await sleep(20);
    const connected = state.live.connected;

    // Three viewers -> pill visible, named.
    window.__wsRecv({ t: "presence", count: 3, names: ["Ana", "Ben"] });
    await sleep(10);
    const three = box();

    // Drop to one: HELD, not applied. The pill must still read "3 here", and
    // settleTo must show the drop is actually armed — otherwise "unchanged"
    // would also be satisfied by the frame having been dropped on the floor.
    window.__wsRecv({ t: "presence", count: 1, names: ["Ana"] });
    await sleep(10);
    const held = { ...box(), settleTo: state.live.settleTo };

    // A rise inside the window cancels the pending drop outright.
    window.__wsRecv({ t: "presence", count: 2, names: [] });
    await sleep(10);
    const back = { ...box(), settleTo: state.live.settleTo };

    // Our socket drops. Presence is about the ROOM, not our transport, so the
    // last known count stands until a reconnect says otherwise.
    window.__wsClose();
    await sleep(10);
    const closed = box();

    // A deliberate leave clears it at once — no grace period, no waiting.
    liveDisconnect();
    await sleep(10);
    const left = box();

    return { connected, three, held, back, closed, left };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const results = {};
  for (const [name, ctxOpts] of [["desktop", { viewport: { width: 1280, height: 900 } }], ["iphone13", { ...devices["iPhone 13"] }]]) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    results[name] = await check(page, "http://127.0.0.1:8791/list.html");
    await ctx.close();
  }
  await browser.close();

  const failures = [];
  for (const [name, r] of Object.entries(results)) {
    const expect = (cond, msg) => { if (!cond) failures.push(`${name}: ${msg}`); };
    expect(r.connected, "never connected");
    expect(!r.three.hidden && r.three.text === "3 here" && r.three.w > 40 && r.three.h > 14,
      `3 viewers should render a visible "3 here" pill, got hidden=${r.three.hidden} text="${r.three.text}" ${r.three.w}x${r.three.h}`);
    expect(/3 people here: Ana, Ben/.test(r.three.label), `label was "${r.three.label}"`);
    expect(!r.held.hidden && r.held.text === "3 here",
      `a drop to 1 must be HELD, not applied instantly — pill now "${r.held.text}" (hidden=${r.held.hidden})`);
    expect(r.held.settleTo === 1, `the held drop should be armed with settleTo=1, got ${r.held.settleTo}`);
    expect(!r.back.hidden && r.back.text === "2 here" && /2 people viewing/.test(r.back.label),
      `returning to 2 should apply at once, got "${r.back.text}" / "${r.back.label}"`);
    expect(r.back.settleTo === null, `a rise must cancel the pending drop, settleTo=${r.back.settleTo}`);
    expect(!r.closed.hidden && r.closed.text === "2 here",
      `a transport close must NOT clear the pill (FIX-031) — got hidden=${r.closed.hidden} text="${r.closed.text}"`);
    expect(r.left.hidden, "a deliberate leave must clear the pill immediately");
  }

  const ok = failures.length === 0;
  if (!ok) { console.log("FAIL"); failures.forEach(f => console.log("  " + f)); }
  else console.log("PASS");
  console.log(JSON.stringify(results, null, 2));
  process.exit(ok ? 0 : 1);
})();
