/**
 * "Person in charge" of a contractor company (FIX-015).
 *
 * SOURCE NOTE — the ticket guessed wrong, so this is worth stating. The person
 * in charge is NOT in either dataset the ticket suggested:
 *   - the permits dataset's contact slots carry only name/type/city/state/zip,
 *     and the person-shaped names on a GC's permits are the OWNER contact, i.e.
 *     the GC's CUSTOMER. Showing those would name the wrong human entirely.
 *   - the city licensed-contractor registry is a flat table of
 *     licenseType/licenseNo/name/address/phone/expiry. No officer, no agent,
 *     and no per-license detail page to scrape.
 * It IS in a third city dataset the ticket does not mention: Business Owners
 * (ezma-pppn), which lists named owners and their titles per business licence.
 * Deeper LLC enrichment from the IL Secretary of State stays with FEAT-026.
 */

import { normalizeLicenseName } from "./licenses.js";

const OWNERS_DOMAIN = "data.cityofchicago.org";
const OWNERS_DATASET = "ezma-pppn";
const OWNERS_PAGE = 50000;

// Most authoritative first. A company can list several owners (measured: 48% of
// matched GCs do), so this decides whose name leads. Ranks are also the reason
// the pick is stable across rebuilds — never rely on the dataset's row order.
const TITLE_RANK = [
  "PRESIDENT",
  "SOLE PROPRIETOR",
  "MANAGING MEMBER",
  "OWNER",
  "PRINCIPAL OFFICER",
  "MANAGER",
  "MEMBER",
  "PARTNER",
  "VICE PRESIDENT",
  "TREASURER",
  "SECRETARY",
  "DIRECTOR",
  "SHAREHOLDER",
  "INDIVIDUAL",
];

const MAX_PRINCIPALS = 4;

export function titleRank(title) {
  const i = TITLE_RANK.indexOf((title || "").toUpperCase().trim());
  return i === -1 ? TITLE_RANK.length : i;
}

/**
 * The dataset mixes "Brian Burfield" and "MAREK MIETKA". Title-case the shouted
 * ones so a card does not look like it is yelling one name and not the next;
 * leave already-mixed-case names alone rather than mangling "McLennan".
 */
const NAME_SUFFIXES = new Set(["II", "III", "IV", "V", "VI", "VII", "JR", "SR"]);

function formatWord(word, isLast) {
  const bare = word.replace(/[.,]/g, "");
  // Generational suffixes stay upper: "III" must not become "Iii". Only the
  // LAST word can be one — "V" is a suffix in "Henry Tudor V" and a middle
  // initial in "Anna V. Reyes", and position is the only thing separating them.
  if (isLast && NAME_SUFFIXES.has(bare)) return word.replace(bare, bare.toUpperCase());
  // Already-punctuated initials keep their own dots: "W.D." must not become
  // "W..D.." by having a period appended to each letter.
  if (/^(?:[A-Z]\.)+,?$/.test(word)) return word;
  // A bare single letter is an initial and gains one period.
  if (/^[A-Z],?$/.test(word)) return word.replace(/^([A-Z])/, "$1.");
  // Title-case across internal punctuation so hyphenated and O'/D' names keep
  // their inner capital: VANDERBILT-HOLLINGSWORTH, O'BRIEN.
  return word
    .toLowerCase()
    .replace(/(^|[-'’])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
}

export function formatPersonName(first, middle, last) {
  const raw = [first, middle, last].map((p) => (p || "").trim()).filter(Boolean).join(" ");
  if (!raw) return "";
  const collapsed = raw.replace(/\s+/g, " ");
  if (collapsed !== collapsed.toUpperCase()) return collapsed;
  const words = collapsed.split(" ");
  return words.map((w, i) => formatWord(w, i === words.length - 1)).join(" ");
}

/**
 * Build normalized-business-name -> [{name, title}] from Business Owners rows.
 * Rows whose owner is another COMPANY (owner_name, no first/last) are dropped —
 * "Marsh & McLennan Companies, Inc." is not a person in charge.
 */
export function buildPrincipalIndex(rows) {
  const byBusiness = new Map();
  for (const row of rows || []) {
    const name = formatPersonName(row.owner_first_name, row.owner_middle_initial, row.owner_last_name);
    if (!name) continue;
    const key = normalizeLicenseName(row.doing_business_as_name);
    if (!key) continue;
    if (!byBusiness.has(key)) byBusiness.set(key, new Map());
    const people = byBusiness.get(key);
    const title = (row.owner_title || "").trim();
    const personKey = name.toUpperCase();
    const seen = people.get(personKey);
    // Same human can appear under several licences; keep their best title.
    if (!seen || titleRank(title) < titleRank(seen.title)) people.set(personKey, { name, title });
  }

  const index = new Map();
  for (const [key, people] of byBusiness) {
    index.set(
      key,
      [...people.values()].sort(
        (a, b) => titleRank(a.title) - titleRank(b.title) || a.name.localeCompare(b.name)
      )
    );
  }
  return index;
}

/**
 * Attach `principals` (capped) and `principal_count` (the true total) to each
 * profile. Companies with no match get NEITHER field rather than an empty array
 * — the UI omits the line entirely when it is absent, which is what the ticket
 * asks for: no blank "Person in charge: —" junk on the ~79% with no data.
 */
export function attachPrincipals(profiles, index) {
  let matched = 0;
  for (const p of profiles || []) {
    const people = index.get(normalizeLicenseName(p.contact_name));
    if (!people || !people.length) continue;
    p.principals = people.slice(0, MAX_PRINCIPALS);
    p.principal_count = people.length;
    matched += 1;
  }
  return matched;
}

/** Page the Business Owners dataset, person-owner rows only. */
export async function fetchBusinessOwners(fetchImpl = fetch) {
  const rows = [];
  for (let offset = 0; ; offset += OWNERS_PAGE) {
    const url = new URL(`https://${OWNERS_DOMAIN}/resource/${OWNERS_DATASET}.json`);
    url.searchParams.set(
      "$select",
      "doing_business_as_name,owner_first_name,owner_middle_initial,owner_last_name,owner_title"
    );
    url.searchParams.set("$where", "owner_first_name IS NOT NULL");
    url.searchParams.set("$limit", String(OWNERS_PAGE));
    url.searchParams.set("$offset", String(offset));
    const res = await fetchImpl(url.toString(), { headers: { "User-Agent": "chi-permits-seed/0.1" } });
    if (!res.ok) throw new Error(`Business Owners ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < OWNERS_PAGE) return rows;
  }
}
