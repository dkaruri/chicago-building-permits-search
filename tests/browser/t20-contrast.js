// Task 2's deferred item: .assoc / .assoc-n contrast was never independently
// measured. Measures real computed colours against the real backgrounds, in
// both themes, on both pages. 4.5:1 for the label, 4.5:1 for the count.
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const PAGES = ["http://127.0.0.1:8791/index.html", "http://127.0.0.1:8791/list.html"];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const out = [];
  for (const url of PAGES) {
    for (const theme of ["light", "dark"]) {
      const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await p.addInitScript(t => localStorage.setItem("chi_permit_theme", t), theme);
      await p.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0 }) }));
      await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
      await p.goto(url, { waitUntil: "domcontentloaded" });
      const res = await p.evaluate(() => {
        const host = document.createElement("div");
        host.innerHTML = `<button class="assoc"><span>SOME CONTRACTOR</span><span class="assoc-n">7</span></button>`;
        document.body.appendChild(host);
        const btn = host.querySelector(".assoc");
        const n = host.querySelector(".assoc-n");
        const rgb = s => s.match(/[\d.]+/g).slice(0, 3).map(Number);
        const lum = c => {
          const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, k) => k - m); return (x + 0.05) / (y + 0.05); };
        const bg = rgb(getComputedStyle(btn).backgroundColor);
        const r = { label: ratio(rgb(getComputedStyle(btn).color), bg), count: ratio(rgb(getComputedStyle(n).color), bg) };
        host.remove();
        return r;
      });
      out.push([`${url.split("/").pop()}#${theme}`, { label: +res.label.toFixed(2), count: +res.count.toFixed(2) }]);
      await p.close();
    }
  }
  const ok = out.every(([, r]) => r.label >= 4.5 && r.count >= 4.5);
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(out));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
