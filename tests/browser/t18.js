// t18: permit -> contractor -> permit, both directions, on BOTH pages, and the
// no-profile row stays inert. Runs at an iPhone 13 viewport.
const { chromium } = require("playwright");
const EXE = "C:\\Users\\divya\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const PAGES = ["http://127.0.0.1:8791/index.html", "http://127.0.0.1:8791/list.html"];
const ROW = { permit_number: "100923847", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION", issue_date: "2026-07-01", address: "4 N AVE", work_type: "RENOVATION", work_description: "Interior", reported_cost: 120000, total_fee: 900, general_contractors: "ACME BUILDERS | J. RIVERA", open_subs: "", latitude: 41.9, longitude: -87.7 };
const OTHER = { ...ROW, permit_number: "100923901", address: "22 W ST" };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const results = [];
  for (const url of PAGES) {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
    // Playwright resolves overlapping page.route patterns LIFO (most recently
    // registered wins) unless the handler calls route.fallback(), so the
    // catch-all 404 must be registered BEFORE the specific ACME mock for the
    // specific one to actually take precedence.
    await p.route("**/api/contact/**", r => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Contact not found" }) }));
    await p.route("**/api/contact/ACME%20BUILDERS**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ contact_name: "ACME BUILDERS", open_jobs: 999, total_jobs: 88, avg_processing_days: 9.4, reported_cost_total: 4200000, license_matches: [{ phone: "(773) 555-0180", license_type: "General Contractor (Class E)" }], work_types: [], permit_types: [], contact_types: [] }) }));
    await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [ROW, OTHER, { ...ROW, permit_number: "999", general_contractors: "ACME PLUMBING" }], row_count: 3 }) }));
    await p.route("**/api/notes/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [] }) }));
    await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
    await p.goto(url, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });

    await p.evaluate(row => openPermitDetail(row), ROW);
    await p.waitForSelector('.contractor-line[data-filled]');
    // FIX-022: a contractor with a profile gets a "Read more" button; one
    // without gets nothing. The ROW itself must never navigate any more, or the
    // name cannot be selected and copied — that is the whole point of the fix.
    const rowStates = await p.evaluate(() => [...document.querySelectorAll(".contractor-line")].map(el => {
      const more = el.querySelector(".ci-more");
      return {
        name: el.getAttribute("data-contractor"),
        clickable: !!more,
        rowNavigates: el.tagName === "BUTTON" || el.hasAttribute("onclick") ||
          el.hasAttribute("role") || el.hasAttribute("tabindex") || el.classList.contains("clickable"),
        moreLabel: more ? more.getAttribute("aria-label") : "",
        moreSize: more ? { w: more.offsetWidth, h: more.offsetHeight } : null,
        // Right of the details column, and inside the row.
        moreOnRight: more
          ? more.getBoundingClientRect().left >= el.querySelector(".ci-main").getBoundingClientRect().right - 1 &&
            more.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1
          : false,
        text: el.textContent,
      };
    }));

    // Keyboard activation: it is a real <button> now, so Enter comes free —
    // focus it and press Enter, do NOT synthesise a click.
    await p.evaluate(() => document.querySelector('.contractor-line[data-contractor="ACME BUILDERS"] .ci-more').focus());
    await p.keyboard.press("Enter");
    await p.waitForFunction(() => state.cardIndex === 1 && (activeCard() || {}).loaded);
    const viaKeyboard = await p.evaluate(() => state.cardIndex);
    const card = await p.evaluate(() => ({
      title: document.getElementById("permit-modal-title").textContent,
      pills: [...document.querySelectorAll(".pm-tag")].map(t => t.textContent),
      tableRows: document.querySelectorAll(".pm-tablewrap tbody tr").length,
      focused: document.activeElement.id,
      noHorizontalScroll: document.querySelector(".permit-modal-body").scrollWidth <= document.querySelector(".permit-modal-body").clientWidth,
      backSize: (b => b && { w: b.offsetWidth, h: b.offsetHeight })(document.querySelector(".pm-back")),
    }));

    await p.evaluate(() => document.querySelector(".pm-tablewrap tbody tr").click());
    await p.waitForFunction(() => state.cardIndex === 2);
    const third = await p.evaluate(() => ({ i: state.cardIndex, title: document.getElementById("permit-modal-title").textContent }));

    results.push([url, { rowStates, card, third, viaKeyboard }]);
    await p.close();
  }

  // Desktop + both themes: every overlay control is big enough and named, no
  // <h4> sneaks into the body, the dialog keeps its accessible name, and
  // reduced-motion removes the card animation entirely.
  for (const url of PAGES) {
    for (const theme of ["light", "dark"]) {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
      await p.addInitScript(t => localStorage.setItem("chi_permit_theme", t), theme);
      await p.route("**/api/contact/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ contact_name: "ACME BUILDERS", total_jobs: 88, avg_processing_days: 9.4, reported_cost_total: 4200000, license_matches: [{ phone: "(773) 555-0180" }], work_types: [], permit_types: [], contact_types: [] }) }));
      await p.route("**/api/permits**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [ROW], row_count: 1 }) }));
      await p.route("**/api/notes/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [] }) }));
      await p.route("**/api/stats**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ row_count: 0, cached_at: "2026-07-28" }) }));
      await p.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
      await p.goto(url, { waitUntil: "domcontentloaded" });
      await p.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
      await p.evaluate(() => { openPermitModal(); pushCard({ type: "contact", name: "ACME BUILDERS", role: "general_contractor" }); });
      await p.waitForFunction(() => (activeCard() || {}).loaded);
      results.push([`${url}#${theme}`, await p.evaluate(() => {
        const acts = [...document.querySelectorAll(".pm-act, .pm-close, .pm-back")];
        const body = document.querySelector(".permit-modal-body");
        return {
          controls: acts.length,
          allBigEnough: acts.every(a => a.offsetWidth >= 44 && a.offsetHeight >= 44),
          labelled: acts.every(a => (a.textContent || "").trim() || a.getAttribute("aria-label")),
          noH4: !body.querySelector("h4"),
          titleId: !!document.getElementById("permit-modal-title"),
          focusedTitle: document.activeElement.id === "permit-modal-title",
          announced: (document.getElementById("pm-live") || {}).textContent || "",
          animationNone: getComputedStyle(body).animationName === "none",
          noHScroll: body.scrollWidth <= body.clientWidth,
        };
      })]);
      await p.close();
    }
  }

  const ok = results.every(([key, r]) => {
    if (key.includes("#")) {
      return r.controls > 0 && r.allBigEnough && r.labelled && r.noH4 && r.titleId &&
        r.focusedTitle && /General contractor, ACME BUILDERS/.test(r.announced) &&
        r.animationNone && r.noHScroll;
    }
    const acme = r.rowStates.find(x => x.name === "ACME BUILDERS");
    const rivera = r.rowStates.find(x => x.name === "J. RIVERA");
    return acme.clickable && !rivera.clickable && /No profile on file/.test(rivera.text) &&
      !acme.rowNavigates && !rivera.rowNavigates &&
      acme.moreLabel === "Read more about ACME BUILDERS" &&
      acme.moreSize.h >= 44 && acme.moreOnRight &&
      r.card.title === "ACME BUILDERS" &&
      r.card.pills.some(t => /2 open jobs/.test(t)) &&
      !r.card.pills.some(t => /999/.test(t)) &&
      r.card.tableRows === 2 &&
      r.card.focused === "permit-modal-title" &&
      r.card.noHorizontalScroll &&
      r.card.backSize.w >= 44 && r.card.backSize.h >= 44 &&
      r.third.i === 2 && r.third.title === "100923847" &&
      r.viaKeyboard === 1;
  });

  console.log(ok ? "PASS" : "FAIL", JSON.stringify(results, null, 1));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
