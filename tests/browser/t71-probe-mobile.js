// Why does the restored viewport survive on desktop but not on iPhone 13?
// Instrument every camera move and every map construction.
const { devices } = require("playwright");
const { chromium, CHROME } = require("./_boot.js");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  for (const [label, opts] of [["desktop", {}], ["iPhone13", { ...devices["iPhone 13"] }]]) {
    const p = await (await browser.newContext(opts)).newPage();
    await p.route("**/api/**", r => r.fulfill({ json: { rows: [], total: 0, row_count: 0 } }));
    await p.addInitScript(() => {
      if (!localStorage.getItem("chi_permit_map_settings")) {
        localStorage.setItem("chi_permit_map_settings", JSON.stringify({ dateFrom: "2026-06-01", dateTo: "2026-08-07" }));
      }
      localStorage.setItem("chi_permit_map_view", JSON.stringify({ lon: -87.72, lat: 41.93, zoom: 13.5 }));
      window.__log = [];
      // Count map constructions and every fitBounds/easeTo, from page start.
      const t = setInterval(() => {
        if (typeof maplibregl === "undefined" || !maplibregl.Map || maplibregl.Map.__wrapped) return;
        clearInterval(t);
        const Orig = maplibregl.Map;
        function Wrapped(opts) {
          window.__log.push(`construct zoom=${opts.zoom} center=${JSON.stringify(opts.center)}`);
          const m = new Orig(opts);
          for (const fn of ["fitBounds", "easeTo", "jumpTo", "flyTo"]) {
            const orig = m[fn].bind(m);
            m[fn] = (...a) => { window.__log.push(`${fn} -> zoom ${Math.round(m.getZoom()*10)/10}`); return orig(...a); };
          }
          return m;
        }
        Wrapped.__wrapped = true;
        Wrapped.prototype = Orig.prototype;
        Object.setPrototypeOf(Wrapped, Orig);
        maplibregl.Map = Wrapped;
      }, 5);
    });
    await p.goto("http://localhost:8791/map.html");
    await p.waitForFunction(() => document.body.dataset.ready === "1" && state.map && state.map.map, null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(6000);
    const log = await p.evaluate(() => window.__log || []);
    const z = await p.evaluate(() => Math.round(state.map.map.getZoom() * 10) / 10);
    console.log(`\n=== ${label} === final zoom ${z}`);
    log.forEach(l => console.log("   " + l));
    await p.close();
  }
  await browser.close();
})();
