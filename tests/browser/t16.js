// t16: walkthrough logs a GC AND a sub, each with full info.
//  A) tick both, fill both -> POST payload has full gc + full sub (new shape).
//  B) tick GC only, leave name blank -> validation error, no POST.
//  C) walkParties() normalises legacy (onsite/party) and new posts both ways.
// Runs on BOTH list.html and index.html (byte-identical walk code).
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";

async function run(page, pageName) {
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto(`http://127.0.0.1:8791/${pageName}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });

  return await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // Capture POSTs to /api/notes and stub a 200 so the flow completes.
    const posts = [];
    const realFetch = window.fetch;
    window.fetch = (url, opt) => {
      if (/\/api\/notes\//.test(String(url)) && opt && opt.method === "POST") {
        posts.push(JSON.parse(opt.body));
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (/\/api\/notes\//.test(String(url))) return Promise.resolve(new Response(JSON.stringify({ notes: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
      return realFetch(url, opt);
    };
    try { localStorage.setItem("chi_permit_author", "Tester"); } catch {}
    const set = (id, v) => { const el = document.querySelector(id); el.value = v; };
    const tick = id => { const el = document.querySelector(id); el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); };

    // A) both parties
    openWalkthrough(encodeURIComponent("100999999"), null);
    tick("#wk-has-gc"); tick("#wk-has-sub");
    set("#wk-gc-name", "ACME BUILDERS"); set("#wk-gc-phone", "3125550100"); set("#wk-gc-covers", "General"); set("#wk-gc-jobs", "5"); set("#wk-gc-est", "week");
    set("#wk-sub-name", "COOL AIR HVAC"); set("#wk-sub-phone", "7735550142"); set("#wk-sub-covers", "HVAC"); set("#wk-sub-jobs", "3"); set("#wk-sub-est", "1-3d");
    document.querySelector("#wk-save").click();
    await sleep(60);
    const both = posts[posts.length - 1];

    // B) GC ticked, no name -> error, no new POST
    const before = posts.length;
    openWalkthrough(encodeURIComponent("100999999"), null);
    tick("#wk-has-gc");
    document.querySelector("#wk-save").click();
    await sleep(40);
    const errShown = !document.querySelector("#wk-msg").hidden;
    const noExtraPost = posts.length === before;
    document.querySelector("#walkthrough").close();

    // C) walkParties normaliser
    const legacySub = walkParties({ kind: "walk", onsite: "sub", party: { name: "SubCo" }, gc: { name: "GC Co" } });
    const newShape = walkParties({ kind: "walk", gc: { name: "G" }, sub: { name: "S" } });
    const nobody = walkParties({ kind: "walk", onsite: "none" });

    return {
      both: both && { kind: both.kind, gc: both.gc, sub: both.sub },
      errShown, noExtraPost,
      legacySub: { gc: legacySub.gc && legacySub.gc.name, sub: legacySub.sub && legacySub.sub.name },
      newShape: { gc: newShape.gc && newShape.gc.name, sub: newShape.sub && newShape.sub.name },
      nobody: { gc: nobody.gc, sub: nobody.sub },
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const out = {};
  for (const pg of ["list.html", "index.html"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    out[pg] = await run(page, pg);
    await page.close();
  }
  const ok = ["list.html", "index.html"].every(pg => {
    const r = out[pg];
    return r.both && r.both.kind === "walk" &&
      r.both.gc && r.both.gc.name === "ACME BUILDERS" && r.both.gc.jobs === 5 && r.both.gc.covers === "General" &&
      r.both.sub && r.both.sub.name === "COOL AIR HVAC" && r.both.sub.estimate === "1-3d" &&
      r.errShown && r.noExtraPost &&
      r.legacySub.gc === "GC Co" && r.legacySub.sub === "SubCo" &&
      r.newShape.gc === "G" && r.newShape.sub === "S" &&
      r.nobody.gc === null && r.nobody.sub === null;
  });
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(out, null, 2));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
