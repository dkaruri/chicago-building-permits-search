// t15: list.html remembers the last view across a reload.
//  1) last view "list" + that list still exists -> reopen the list.
//  2) navigating to the directory persists "directory" -> reload stays on directory.
//  3) a first visit (no stored last view) opens the directory, not a list.
// Note: page.addInitScript re-fires on every navigation, so the reload case (2)
// seeds ONLY the lists there and drives last_view through the UI, otherwise the
// re-seed would clobber the "directory" value showDirectory() writes.
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const URL = "http://127.0.0.1:8791/list.html";
const LISTS = { a: { name: "My mobile list", permits: ["100"], focal: null, sharedId: "PeeXTko" } };

const ready = page => page.waitForFunction(() => document.body.dataset.ready === "1");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const results = [];
  const newPage = async () => {
    const p = await browser.newPage();
    await p.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
    return p;
  };

  // 1) last view "list" -> reopens the list, panel visible, directory hidden.
  {
    const p = await newPage();
    await p.addInitScript(ls => {
      localStorage.setItem("chi_permit_lists", JSON.stringify({ lastUsed: "a", lists: ls }));
      localStorage.setItem("chi_permit_last_view", "list");
    }, LISTS);
    await p.goto(URL, { waitUntil: "domcontentloaded" }); await ready(p);
    results.push(["restore list", await p.evaluate(() => ({
      view: state.view,
      panelShown: !document.getElementById("user-list-panel").hidden,
      dirHidden: document.getElementById("directory-view").hidden,
    }))]);
    await p.close();
  }

  // 2) open a list then go to the directory; reload must stay on the directory.
  {
    const p = await newPage();
    await p.addInitScript(ls => {
      localStorage.setItem("chi_permit_lists", JSON.stringify({ lastUsed: "a", lists: ls }));
    }, LISTS);
    await p.goto(URL, { waitUntil: "domcontentloaded" }); await ready(p);
    await p.evaluate(async () => { await showList("a"); showDirectory(); });
    await p.reload({ waitUntil: "domcontentloaded" }); await ready(p);
    results.push(["reload stays directory", await p.evaluate(() => ({
      view: state.view,
      // Phase 3 stores an object, not a bare string. Assert the parsed view so
      // this guard tracks the behaviour rather than the serialisation.
      lastView: (() => { try { return JSON.parse(localStorage.getItem("chi_permit_last_view")).view; } catch { return localStorage.getItem("chi_permit_last_view"); } })(),
    }))]);
    await p.close();
  }

  // 3) first visit (nothing stored) opens the directory, not a list.
  {
    const p = await newPage();
    await p.goto(URL, { waitUntil: "domcontentloaded" }); await ready(p);
    results.push(["first visit -> directory", await p.evaluate(() => ({ view: state.view }))]);
    await p.close();
  }

  const ok =
    results[0][1].view === "list" && results[0][1].panelShown && results[0][1].dirHidden &&
    results[1][1].view === "directory" && results[1][1].lastView === "directory" &&
    results[2][1].view === "directory";

  console.log(ok ? "PASS" : "FAIL", JSON.stringify(results));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
