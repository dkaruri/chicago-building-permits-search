// t37 (FIX-015): the person in charge, and the unit owner, on every surface.
//
// A. permit view has a "Unit owner" block naming the OWNER contact from the
//    permit's own slots — and it must be the owner, never mistaken for the GC
// B. an owner who is also a licensed contractor shows a real tel: link
// C. an owner who is not shows city/state/ZIP and says plainly that no phone is
//    published, rather than reading as a failed lookup
// D. a GC line shows "Run by <name>" from the joined profile
// E. a contractor with NO principals shows no "Run by" and no empty block —
//    that is ~4 companies in 5, so a blank would be the commonest thing on screen
// F. the contractor card lists every principal with titles
// G. the directory row (index.html only) shows the lead name
const { chromium, devices } = require("playwright");
const EXE = "C:/Users/divya/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";

const ROW = {
  permit_number: "100999888", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION/ALTERATION",
  issue_date: "2026-05-01", address: "123 N TEST ST", ward: "27", reported_cost: "125000",
  total_fee: "900", work_description: "INTERIOR ALTERATIONS 3 UNITS", work_type: "ALTERATION",
  review_type: "STANDARD PLAN REVIEW", community_area: "WEST TOWN", processing_time: "12",
  general_contractors: "BEAR CONSTRUCTION COMPANY", open_subs: "NOBODY SUBS LLC",
  contacts: [
    { type: "CONTRACTOR-GENERAL CONTRACTOR", name: "BEAR CONSTRUCTION COMPANY", city: "CHICAGO", state: "IL", zipcode: "60614" },
    { type: "OWNER", name: "TIM LEUNG", city: "EVANSTON", state: "IL", zipcode: "60201" },
    { type: "OWNER AS GENERAL CONTRACTOR", name: "SELFBUILD LLC", city: "CHICAGO", state: "IL", zipcode: "60622" },
  ],
};

const PROFILES = {
  "BEAR CONSTRUCTION COMPANY": {
    contact_name: "BEAR CONSTRUCTION COMPANY", open_jobs: 12,
    license_matches: [{ license_type: "General Contractor (Class A)", phone: "(312) 555-0142", license_number: "TGC1", license_expiration_date: "05/16/2027" }],
    work_types: [{ work_type: "Nonstructural Interior Work" }],
    principals: [{ name: "James S. Wienold", title: "PRESIDENT" }, { name: "George Wienold", title: "SECRETARY" }],
    principal_count: 3,
  },
  // Owner who IS a licensed contractor -> real phone (case B).
  "SELFBUILD LLC": {
    contact_name: "SELFBUILD LLC", open_jobs: 1,
    license_matches: [{ license_type: "General Contractor (Class C)", phone: "(773) 555-0199" }],
    work_types: [],
  },
  // Contractor with no principals at all (case E).
  "NOBODY SUBS LLC": { contact_name: "NOBODY SUBS LLC", open_jobs: 4, license_matches: [], work_types: [] },
};

async function run(browser, file) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  // Catch-all FIRST: Playwright resolves overlapping routes LIFO, so the
  // specific /api/contact/ mock must be registered AFTER it or it never runs.
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [], posts: [] }) }));
  await page.route("**/api/contact/**", r => {
    const name = decodeURIComponent(new URL(r.request().url()).pathname.split("/api/contact/")[1].split("?")[0]);
    const p = PROFILES[name.toUpperCase()];
    return p ? r.fulfill({ contentType: "application/json", body: JSON.stringify(p) })
             : r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  await page.goto("http://127.0.0.1:8791/" + file, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });

  await page.evaluate(row => openPermitDetail(row), ROW);
  await page.waitForFunction(() => !/·\s*…/.test(document.getElementById("permit-modal-body").innerText), { timeout: 10000 });
  await page.waitForTimeout(300);

  const permit = await page.evaluate(() => {
    const body = document.getElementById("permit-modal-body");
    const blockText = h => {
      const s = [...body.querySelectorAll("section.pm-block")].find(x => (x.querySelector("h3") || {}).textContent === h);
      return s ? s.innerText : null;
    };
    const ownerBlock = blockText("Unit owner") || "";
    const gcBlock = blockText("General contractors") || "";
    const subBlock = blockText("Open subs") || "";
    const ownerLine = [...body.querySelectorAll('[data-owner]')].map(n => n.innerText);
    return {
      hasOwnerBlock: !!blockText("Unit owner"),
      ownerNamed: /TIM LEUNG/.test(ownerBlock),
      ownerLocation: /EVANSTON, IL, 60201/.test(ownerBlock),
      ownerNoPhoneNote: /No phone published for owners/.test(ownerBlock),
      ownerAsGcPhone: !!body.querySelector('[data-owner] a[href="tel:7735550199"]'),
      ownerRoleShown: /Owner as general contractor/i.test(ownerBlock),
      // The owner must NOT be presented as the GC's person in charge.
      ownerNotInGcRunBy: !/TIM LEUNG/.test(gcBlock),
      // innerText reflects CSS text-transform, so the "Run by" label comes
      // back as "RUN BY". Match case-insensitively rather than asserting the
      // rendering of a style rule.
      gcRunBy: /run by/i.test(gcBlock) && /James S\. Wienold/.test(gcBlock),
      gcMore: /\+2 more/.test(gcBlock),
      subNoRunBy: !/run by/i.test(subBlock),
      ownerLineCount: ownerLine.length,
    };
  });

  // F: the contractor card's own block.
  // FIX-022: the row itself no longer navigates — "Read more" is the target.
  await page.evaluate(() => document.querySelector('#permit-modal [data-contractor="BEAR CONSTRUCTION COMPANY"] .ci-more').click());
  await page.waitForTimeout(700);
  const card = await page.evaluate(() => {
    const body = document.getElementById("permit-modal-body");
    const s = [...body.querySelectorAll("section.pm-block")].find(x => (x.querySelector("h3") || {}).textContent === "Person in charge");
    return { present: !!s, text: s ? s.innerText.replace(/\s+/g, " ") : "" };
  });

  await ctx.close();
  return { file, permit, card };
}

// H. REGRESSION: a permit hydrated through ensurePermitMap (the saved-list
// path, i.e. everything in My Permit List) must carry contacts. It did not —
// the mapper dropped them, so every saved permit reported "No owner named".
async function savedListOwner(browser, file) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.route("**/api/**", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], row_count: 0, lists: [], posts: [] }) }));
  await page.route("**/nominatim.openstreetmap.org/**", r => r.fulfill({ contentType: "application/json", body: "[]" }));
  // Socrata shaped exactly as the real endpoint returns it, contact slots and all.
  await page.route("**/data.cityofchicago.org/**", r => r.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{
      permit_: "555000111", permit_status: "ACTIVE", permit_type: "PERMIT - RENOVATION/ALTERATION",
      issue_date: "2026-05-01T00:00:00.000", street_number: "9", street_direction: "N", street_name: "SAVED ST",
      work_type: "ALTERATION", work_description: "X", reported_cost: "1000", ward: "1",
      community_area: "24", latitude: "41.9", longitude: "-87.7",
      contact_1_type: "CONTRACTOR-GENERAL CONTRACTOR", contact_1_name: "SOME GC INC",
      contact_2_type: "OWNER", contact_2_name: "DANA OWNER", contact_2_city: "SKOKIE",
      contact_2_state: "IL", contact_2_zipcode: "60076",
    }]),
  }));
  await page.goto("http://127.0.0.1:8791/" + file, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 20000 });
  const got = await page.evaluate(async () => {
    state.userPermitNumbers = ["555000111"];
    state.userPermitMap = new Map();
    await ensurePermitMap();
    const row = state.userPermitMap.get("555000111");
    return { hasContacts: Array.isArray(row && row.contacts), owners: row && row.contacts ? row.contacts.filter(c => /OWNER/i.test(c.type)).map(c => c.name + "|" + c.city + "|" + c.zipcode) : [] };
  });
  await ctx.close();
  return { file, ...got };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const out = [];
  for (const f of ["list.html", "index.html"]) out.push(await run(browser, f));
  const saved = [];
  for (const f of ["list.html", "index.html"]) saved.push(await savedListOwner(browser, f));
  saved.forEach(s => console.log("saved-list " + JSON.stringify(s)));
  for (const r of out) console.log(JSON.stringify(r));

  const bad = out.filter(r =>
    !r.permit.hasOwnerBlock || !r.permit.ownerNamed || !r.permit.ownerLocation ||
    !r.permit.ownerNoPhoneNote || !r.permit.ownerAsGcPhone || !r.permit.ownerRoleShown ||
    !r.permit.ownerNotInGcRunBy || !r.permit.gcRunBy || !r.permit.gcMore ||
    !r.permit.subNoRunBy || r.permit.ownerLineCount !== 2 ||
    !r.card.present || !/PRESIDENT James S\. Wienold/.test(r.card.text) ||
    !/SECRETARY George Wienold/.test(r.card.text) || !/1 more named/.test(r.card.text));
  saved.forEach(s => {
    if (!s.hasContacts || s.owners.join() !== "DANA OWNER|SKOKIE|60076") bad.push(s);
  });
  console.log(bad.length ? `FAIL ${bad.length}` : "PASS");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
