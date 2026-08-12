// t61 — FEAT-035: the saved-list page index against everything that can move
// under it. clampedListPage clamps on every READ rather than being fixed up at
// each mutation, because ticks, filters and a remote peer's edit do not funnel
// through any one place; these are the three that would otherwise leave a page
// index pointing past the end and render a blank table with no way back.
const { chromium, CHROME } = require("./_boot.js");
const rows = n => Array.from({ length: n }, (_, i) => ({
  permit_number: `10${String(100000+i)}`, permit_type: "P", permit_status: "ACTIVE",
  issue_date: "2026-01-15", address: `${1000+i} W Fullerton Ave`, work_type: "R",
  ward: "32", reported_cost: 1000, latitude: 41.9+i*0.001, longitude: -87.65-i*0.001 }));
let bad = 0;
const ok = (n, c, d="") => { console.log((c?"  ok   ":"  FAIL ")+n+(c?"":" — "+d)); if(!c) bad++; };
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const p = await (await b.newContext({ viewport:{width:1280,height:800} })).newPage();
  await p.route("**/api/notes/counts**", r => r.fulfill({ json: { counts: {} } }));
  await p.goto("http://127.0.0.1:8791/list.html");
  await p.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 20000 });
  await p.evaluate(async R => {
    state.userPermitMap = new Map(R.map(r => [r.permit_number, r]));
    state.lists = { L: { name:"T", permits: R.map(r=>r.permit_number), focal:null, sharedId:null, ticks:{}, fu:{}, called:{} } };
    await showList("L");
  }, rows(250));

  // Ticking a row on page 2 must not throw you back to page 1.
  const tick = await p.evaluate(async () => {
    await setListPage(1);
    const key = document.querySelector(".saved-permits-table tbody tr").getAttribute("data-tick-row");
    toggleTick(encodeURIComponent(key), true);
    await new Promise(r => setTimeout(r, 60));
    return { page: state.listPage, first: document.querySelector(".list-ordinal")?.textContent.trim(),
             ticked: isTicked(userListRows()[100]) };
  });
  ok("marking a row Visited on page 2 keeps you on page 2", tick.page === 1 && tick.first === "101", JSON.stringify(tick));
  ok("...and the flag actually landed on the right row", tick.ticked === true, JSON.stringify(tick));

  // A filter that empties the current page must land somewhere real, not blank.
  const filt = await p.evaluate(async () => {
    await setListPage(2);
    setRowFilter("visited", "yes");           // only 1 row matches, it is on page 2
    await new Promise(r => setTimeout(r, 60));
    return { page: state.listPage, rows: document.querySelectorAll(".saved-permits-table tbody tr").length };
  });
  ok("a filter that shrinks the list clamps the page instead of rendering blank", filt.page === 0 && filt.rows === 1, JSON.stringify(filt));

  // A remote peer's edit arriving over live sync must not blank the page either.
  const remote = await p.evaluate(async () => {
    clearListFilters();
    await setListPage(2);
    const l = activeList();
    applyListOp(l, { f: "p", v: l.permits.slice(0, 120) });   // peer removed 130 stops
    state.userPermitNumbers = [...l.permits];
    await renderUserList();
    return { page: state.listPage, rows: document.querySelectorAll(".saved-permits-table tbody tr").length,
             ordinal: document.querySelector(".list-ordinal")?.textContent.trim() };
  });
  ok("a remote edit that shrinks the list clamps to the new last page", remote.page === 1 && remote.rows === 20 && remote.ordinal === "101", JSON.stringify(remote));

  console.log(bad ? `\n${bad} FAILURES` : "\nall passed");
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
