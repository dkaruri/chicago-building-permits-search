// t2: the permit overlay shell — opens with a labelled dialog and real content,
// marks the page behind it, and Escape closes it and clears the marks.
//
// Was red on main since FEAT-025: it called `openPermitModal("<p>…</p>")`, but
// the card stack made openPermitModal() the shell-only opener that takes no
// arguments — content arrives via renderCard. The `probe` assertion could never
// pass again. Driving the real entry point instead.
const { chromium, CHROME, openList } = require("./_boot");

const ROW = {
  permit_number: "100999888", permit_type: "PERMIT - RENOVATION/ALTERATION",
  permit_status: "ACTIVE", issue_date: "2026-05-01", address: "123 N TEST ST",
  community_area: "WEST TOWN", review_type: "R", work_type: "W", processing_time: "12",
  work_description: "INTERIOR ALTERATIONS", reported_cost: "125000", total_fee: "900",
  general_contractors: "", open_subs: "",
};

(async () => {
  const b = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await b.newPage();
  await openList(page);

  await page.evaluate(row => openPermitDetail(row), ROW);
  await page.waitForSelector("#permit-modal [role='dialog']", { timeout: 10000 });
  const opened = await page.evaluate(() => {
    const dlg = document.querySelector("#permit-modal [role='dialog']");
    return {
      visible: !document.getElementById("permit-modal").hasAttribute("hidden"),
      bodyMarked: document.body.classList.contains("modal-open"),
      rootMarked: document.documentElement.classList.contains("modal-open"),
      // Content comes from renderCard now, so assert the permit is actually on
      // screen rather than that an injected probe survived.
      hasPermit: /100999888/.test(document.getElementById("permit-modal-body").innerText),
      dialog: dlg != null,
      // aria-labelledby must resolve to a real, non-empty element — a dangling
      // idref is an unlabelled dialog to a screen reader.
      labelled: (() => {
        const id = dlg && dlg.getAttribute("aria-labelledby");
        const el = id && document.getElementById(id);
        return !!(el && el.textContent.trim());
      })(),
    };
  });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() => ({
    visible: !document.getElementById("permit-modal").hasAttribute("hidden"),
    bodyMarked: document.body.classList.contains("modal-open"),
    rootMarked: document.documentElement.classList.contains("modal-open"),
  }));

  const ok = opened.visible && opened.bodyMarked && opened.rootMarked &&
             opened.hasPermit && opened.dialog && opened.labelled &&
             !closed.visible && !closed.bodyMarked && !closed.rootMarked;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify({ opened, closed }));
  await b.close();
  process.exit(ok ? 0 : 1);
})();
