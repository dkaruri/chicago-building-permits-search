// FEAT-038. The Property use row in the permit-detail overlay, driven in a real
// browser on BOTH pages. The unit suite (feat038-use.mjs) covers the resolution
// logic; this covers the thing the unit suite cannot — that the row is actually
// wired into the overlay and reaches the user.
const { chromium, CHROME, openList, seedSavedList } = require("./_boot");

const PERMIT = {
  permit_number: "T62000001",
  permit_status: "ACTIVE",
  permit_type: "PERMIT - EASY PERMIT PROCESS",
  issue_date: "2026-07-15",
  address: "1234 N TEST ST",
  work_description: "REPAIR PORCH",   // deliberately unclassifiable by permitUse()
  reported_cost: 12000,
  latitude: 41.9, longitude: -87.7,
  community_area: 24, ward: 1,
  general_contractors: "", open_subs: "", contacts: [],
};

// Stub both hops: the permits lookup that resolves pin_list, and Cook County.
async function stubSources(page, { pinList = "17-04-100-001-0000", parcels = [{ pin10: "1704100001", class: "203", year: "2026" }] } = {}) {
  await page.route("**/data.cityofchicago.org/resource/ydr8-5enu.json*", route => {
    const q = decodeURIComponent(route.request().url().replace(/\+/g, " "));
    if (/pin_list/.test(q)) return route.fulfill({ json: [{ pin_list: pinList }] });
    return route.fulfill({ json: [] });
  });
  await page.route("**/datacatalog.cookcountyil.gov/**", route => route.fulfill({ json: parcels }));
  // Zone/TIF share the overlay's fill path; keep them deterministic.
  await page.route("**/data.cityofchicago.org/resource/dj47-wfun.json*", route => route.fulfill({ json: [{ zone_class: "RS-3" }] }));
  await page.route("**/data.cityofchicago.org/resource/eejr-xtfb.json*", route => route.fulfill({ json: [] }));
}

async function readUseRow(page) {
  return page.evaluate(async () => {
    const label = [...document.querySelectorAll("#permit-modal dt")].find(d => d.textContent.trim() === "Property use");
    if (!label) return { missing: true };
    const dd = label.nextElementSibling;
    return { text: dd.innerText.replace(/\s+/g, " ").trim(), html: dd.innerHTML };
  });
}

async function openPermit(page, path) {
  await openList(page, path);
  if (path === "list.html") {
    await seedSavedList(page, [PERMIT]);
    await page.evaluate(row => openPermitDetail(row), PERMIT);
  } else {
    await page.evaluate(row => openPermitDetail(row), PERMIT);
  }
  // #permit-modal is a plain div toggled by the `hidden` PROPERTY — waitForSelector
  // waits for visibility and can never match it. Ask for the property.
  await page.waitForFunction(() => !document.getElementById("permit-modal").hidden, null, { timeout: 15000 });
  // The row starts at "…" and is filled by fillPermitGeo; wait for the fill, not
  // a fixed delay.
  await page.waitForFunction(() => {
    const dt = [...document.querySelectorAll("#permit-modal dt")].find(d => d.textContent.trim() === "Property use");
    return dt && dt.nextElementSibling && !/…/.test(dt.nextElementSibling.textContent);
  }, null, { timeout: 20000 });
}

const failures = [];
const check = (name, ok, detail) => { if (!ok) failures.push(`${name}: ${detail}`); console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : ` — ${detail}`}`); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });

  for (const path of ["index.html", "list.html"]) {
    // 1. A matched parcel renders as a sourced fact with no approx badge.
    let page = await browser.newPage();
    await stubSources(page);
    await openPermit(page, path);
    let row = await readUseRow(page);
    check(`${path}: Property use row exists`, !row.missing, "no dt labelled 'Property use'");
    check(`${path}: sourced label`, /^Residential/.test(row.text || ""), JSON.stringify(row.text));
    check(`${path}: cites the class`, /Cook County class 203/.test(row.text || ""), JSON.stringify(row.text));
    check(`${path}: no approx badge on a sourced class`, !/approx/.test(row.html || ""), row.html);
    // Found while building FEAT-038 and fixed at the root in pmFacts: the empty
    // placeholder was emitted even when `extra` supplied the value, so all three
    // async Location rows carried a stray leading dash on every permit.
    const location = await page.evaluate(() => {
      const out = {};
      for (const dt of document.querySelectorAll("#permit-modal .pm-facts dt")) out[dt.textContent.trim()] = dt.nextElementSibling.innerText.trim();
      return out;
    });
    check(`${path}: Zone has no stray placeholder dash`, location.Zone === "RS-3", JSON.stringify(location.Zone));
    check(`${path}: empty TIF district is a single dash`, location["TIF district"] === "—", JSON.stringify(location["TIF district"]));
    await page.close();

    // 2. No parcel match falls back to the heuristic, still badged approximate.
    page = await browser.newPage();
    await stubSources(page, { parcels: [] });
    await page.evaluate(() => {}).catch(() => {});
    await openPermit(page, path);
    row = await readUseRow(page);
    check(`${path}: unmatched + unclassifiable text reads as a dash`, (row.text || "").trim() === "—", JSON.stringify(row.text));
    await page.close();

    // 3. Unmatched but classifiable text keeps the approx badge.
    page = await browser.newPage();
    await stubSources(page, { parcels: [] });
    await openList(page, path);
    const guessy = { ...PERMIT, work_description: "INTERIOR ALTERATIONS TO SINGLE FAMILY RESIDENCE" };
    if (path === "list.html") await seedSavedList(page, [guessy]);
    await page.evaluate(r => openPermitDetail(r), guessy);
    // #permit-modal is a plain div toggled by the `hidden` PROPERTY — waitForSelector
  // waits for visibility and can never match it. Ask for the property.
  await page.waitForFunction(() => !document.getElementById("permit-modal").hidden, null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const dt = [...document.querySelectorAll("#permit-modal dt")].find(d => d.textContent.trim() === "Property use");
      return dt && dt.nextElementSibling && !/…/.test(dt.nextElementSibling.textContent);
    }, null, { timeout: 20000 });
    row = await readUseRow(page);
    check(`${path}: fallback guess is badged approx`, /approx/.test(row.html || ""), row.html);
    check(`${path}: fallback guess is not attributed to the County`, !/Cook County class/.test(row.text || ""), JSON.stringify(row.text));
    await page.close();
  }

  // 4. iPhone 13: the row must not overflow the overlay horizontally.
  const { devices } = require("playwright");
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await stubSources(page, { parcels: [{ pin10: "1704100001", class: "203", year: "2026" }, { pin10: "1704100002", class: "517", year: "2026" }] });
  await openPermit(page, "index.html");
  const geom = await page.evaluate(() => {
    const dt = [...document.querySelectorAll("#permit-modal dt")].find(d => d.textContent.trim() === "Property use");
    const dd = dt.nextElementSibling;
    const r = dd.getBoundingClientRect();
    const cs = getComputedStyle(dd);
    return { right: r.right, width: innerWidth, text: dd.innerText.replace(/\s+/g, " ").trim(), fontSize: parseFloat(cs.fontSize), docScroll: document.documentElement.scrollWidth, inner: innerWidth };
  });
  check("iPhone 13: value stays inside the viewport", geom.right <= geom.width + 0.5, `right=${geom.right} vw=${geom.width}`);
  check("iPhone 13: no horizontal page scroll", geom.docScroll <= geom.inner + 0.5, `scrollWidth=${geom.docScroll} vw=${geom.inner}`);
  check("iPhone 13: multi-parcel disagreement reads Mixed use", /^Mixed use/.test(geom.text), JSON.stringify(geom.text));
  await page.screenshot({ path: "verify-tmp/t62-property-use-mobile.png", fullPage: false });
  await ctx.close();

  await browser.close();
  console.log(failures.length ? `\n${failures.length} FAILURES` : "\nPASS");
  process.exit(failures.length ? 1 : 0);
})();
