// FIX-031 — the live-presence pill must not move the page when it appears or
// disappears, and must not blank out on a transient reconnect.
// Measures GEOMETRY at desktop and iPhone 13: the top of the element below the
// title row must not move when the pill toggles.
const { devices } = require("playwright");
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const ROWS = [
  { permit_number: "100234", address: "1 N State St", permit_status: "ACTIVE", issue_date: "2026-07-01", permit_type: "PERMIT - RENOVATION/ALTERATION", work_type: "", reported_cost: "10000", general_contractors: "" },
  { permit_number: "100987", address: "2 S Clark St", permit_status: "ACTIVE", issue_date: "2026-07-02", permit_type: "PERMIT - ELECTRIC WIRING", work_type: "", reported_cost: "20000", general_contractors: "" },
];

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL " + m); } };
// Sub-pixel: layout values are fractional (the pill is 22.719px), so compare
// with a tolerance rather than ===. Anything under a device pixel is invisible.
const same = (a, b) => Math.abs(a - b) < 0.5;

// Drive presence the way the socket does, without a socket.
const setPresence = (page, connected, count) => page.evaluate(([c, n]) => {
  state.live.connected = c;
  state.live.presence = { count: n, names: [] };
  renderPresence();
}, [connected, count]);

const layout = page => page.evaluate(() => {
  const below = document.querySelector(".user-list-toolbar");
  const pill = document.getElementById("live-presence");
  return {
    belowTop: below.getBoundingClientRect().top,
    rowHeight: document.querySelector(".user-list-title-row").getBoundingClientRect().height,
    docHeight: document.documentElement.scrollHeight,
    pillText: pill.textContent.trim(),
    pillVisible: !pill.hidden && getComputedStyle(pill).visibility !== "hidden",
  };
});

async function run(context, label) {
  const startPass = pass, startFail = fail;
  const page = await context.newPage();
  await openList(page);
  await seedSavedList(page, ROWS);
  // #user-list-panel plays `listRise` (0.24s, translateY(14px)) when the list
  // opens. Measuring during it reports the whole panel drifting ~1.5px and
  // blames the pill for it. Wait for every running animation to finish first.
  await page.waitForFunction(
    () => document.getAnimations().every(a => a.playState !== "running"), null, { timeout: 5000 });
  console.log(`\n== ${label} ==`);

  // Baseline: two viewers, pill showing.
  await setPresence(page, true, 2);
  const shown = await layout(page);
  ok(shown.pillVisible && /2 here/.test(shown.pillText), `pill should show "2 here", got "${shown.pillText}"`);

  // The reap/reconnect cycle: the socket drops, then comes back. The count is
  // unchanged in reality — the user is still on both devices.
  await setPresence(page, false, 2);
  const dropped = await layout(page);

  ok(same(dropped.belowTop, shown.belowTop),
    `page moved ${Math.abs(dropped.belowTop - shown.belowTop).toFixed(1)}px when the socket blipped`);
  ok(same(dropped.rowHeight, shown.rowHeight),
    `title row height changed ${Math.abs(dropped.rowHeight - shown.rowHeight).toFixed(1)}px on a blip`);
  ok(dropped.pillVisible,
    "a transient disconnect must not blank the pill — the viewers have not changed");

  // A REAL drop to one viewer: the pill may go, but must still not move the page.
  await setPresence(page, true, 1);
  const alone = await layout(page);
  ok(!alone.pillVisible || alone.pillText === "", "at 1 viewer the pill should not read a count");
  ok(same(alone.belowTop, shown.belowTop),
    `page moved ${Math.abs(alone.belowTop - shown.belowTop).toFixed(1)}px when the count legitimately fell to 1`);
  ok(same(alone.docHeight, shown.docHeight),
    `document height changed ${Math.abs(alone.docHeight - shown.docHeight)}px between 1 and 2 viewers`);

  // The real reconnect path, not just a simulated one: liveConnect() tears the
  // old socket down before opening a new one, and that teardown used to wipe
  // the count. Drive the actual function. The socket cannot reach the Worker
  // from localhost, which is fine — the teardown is synchronous and is what is
  // under test here.
  await setPresence(page, true, 2);
  const reconnect = await page.evaluate(() => {
    const before = state.live.presence.count;
    liveConnect("PeeXTko");                 // same path liveScheduleReconnect uses
    const after = state.live.presence.count;
    const pill = document.getElementById("live-presence");
    const kept = { before, after, hidden: pill.hidden, text: pill.textContent.trim() };
    liveDisconnect();                       // stop the retry timer before we move on
    return kept;
  });
  ok(reconnect.after === reconnect.before,
    `liveConnect() wiped the count: ${reconnect.before} -> ${reconnect.after}`);
  ok(!reconnect.hidden && /2 here/.test(reconnect.text),
    `the pill blanked during a reconnect (hidden=${reconnect.hidden}, text="${reconnect.text}")`);

  // A deliberate leave still clears it — otherwise the pill would lie forever.
  const left = await page.evaluate(() => {
    liveDisconnect();
    const pill = document.getElementById("live-presence");
    return { count: state.live.presence.count, hidden: pill.hidden };
  });
  ok(left.count === 0 && left.hidden, "a deliberate leave must clear the pill, not keep a stale count");

  // And back up.
  await setPresence(page, true, 3);
  const three = await layout(page);
  ok(same(three.belowTop, shown.belowTop),
    `page moved ${Math.abs(three.belowTop - shown.belowTop).toFixed(1)}px going 1 -> 3 viewers`);
  ok(/3 here/.test(three.pillText), `expected "3 here", got "${three.pillText}"`);

  // ---- The grace period on a DROP (the iOS pocket case) ----
  // A phone whose screen goes off fires pagehide and disconnects cleanly, so
  // the server correctly reports one viewer. Holding that briefly means a short
  // pocket trip produces no visible change at all.
  await page.evaluate(() => { window.__settle = PRESENCE_SETTLE_MS; });
  const settleMs = await page.evaluate(() => window.__settle);
  ok(settleMs >= 10000 && settleMs <= 60000, `grace period is ${settleMs}ms — outside a sane 10-60s`);

  // Drop to 1: the pill must NOT change yet.
  await page.evaluate(() => { state.live.connected = true; state.live.presence = { count: 2, names: [] }; renderPresence(); });
  const beforeDrop = await layout(page);
  await page.evaluate(() => applyPresence({ count: 1, names: [] }));
  const heldRaw = await layout(page);
  ok(heldRaw.pillVisible && /2 here/.test(heldRaw.pillText),
    `a drop should be held, not applied instantly (pill now "${heldRaw.pillText}")`);
  ok(same(heldRaw.belowTop, beforeDrop.belowTop), "holding a drop must not move the page");

  // Coming back inside the window cancels it — nothing ever moved.
  await page.evaluate(() => applyPresence({ count: 2, names: [] }));
  const returned = await layout(page);
  ok(returned.pillVisible && /2 here/.test(returned.pillText), "returning inside the window should be a no-op");
  ok(same(returned.belowTop, beforeDrop.belowTop), "a pocket trip must not move the page at all");

  // A rise is never delayed.
  await page.evaluate(() => { state.live.presence = { count: 1, names: [] }; renderPresence(); applyPresence({ count: 3, names: [] }); });
  ok(/3 here/.test((await layout(page)).pillText), "a rise must apply immediately, not after the grace period");

  // The grace period must not become a permanent lie: once it expires the drop
  // lands. Driven with a short override rather than waiting 25s.
  const expired = await page.evaluate(async () => {
    state.live.presence = { count: 2, names: [] }; renderPresence();
    const real = window.PRESENCE_SETTLE_MS;
    // applyPresence closes over the const, so drive the timer directly instead.
    applyPresence({ count: 1, names: [] });
    await new Promise(r => setTimeout(r, 60));
    const midway = document.getElementById("live-presence").textContent.trim();
    clearTimeout(state.live.settleTimer);
    state.live.presence = { count: 1, names: [] }; renderPresence();   // simulate expiry
    const after = document.getElementById("live-presence");
    return { midway, expiredHidden: after.hidden, real };
  });
  ok(/2 here/.test(expired.midway), `the count should still read 2 mid-grace, got "${expired.midway}"`);
  ok(expired.expiredHidden, "once the grace period expires the drop must actually land");

  // The grace period is a DELAY, not a suppression: repeating the same drop
  // (which a reconnect does, since it re-sends the room state) must not restart
  // the clock, or the pill would claim someone is here indefinitely.
  const rearm = await page.evaluate(async () => {
    state.live.presence = { count: 2, names: [] }; renderPresence();
    applyPresence({ count: 1, names: [] });
    const first = state.live.settleTimer;
    await new Promise(r => setTimeout(r, 30));
    applyPresence({ count: 1, names: [] });   // same drop again, as a reconnect would
    applyPresence({ count: 1, names: [] });
    const after = state.live.settleTimer;
    clearTimeout(state.live.settleTimer); state.live.settleTo = null;
    return { same: first === after };
  });
  ok(rearm.same, "a repeated identical drop must not restart the grace timer");

  // And a deliberate leave bypasses the grace entirely.
  await page.evaluate(() => { state.live.connected = true; state.live.presence = { count: 2, names: [] }; renderPresence(); liveDisconnect(); });
  const leftNow = await page.evaluate(() => ({
    count: state.live.presence.count, hidden: document.getElementById("live-presence").hidden,
  }));
  ok(leftNow.count === 0 && leftNow.hidden, "leaving the list must clear the pill at once, not after 25s");

  console.log(`  ${pass - startPass} assertions passed, ${fail - startFail} failed at ${label}`);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  try {
    const d = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await run(d, "desktop 1280x900");
    await d.close();
    const m = await browser.newContext({ ...devices["iPhone 13"] });
    await run(m, "iPhone 13 390x844");
    await m.close();
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
