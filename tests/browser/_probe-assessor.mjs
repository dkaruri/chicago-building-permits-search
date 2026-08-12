// Can the Assessor's property class replace the "approx" use badge?
// Joins a real month of open permits to Cook County Assessor parcel classes via
// the pin_list field the permits dataset already carries, and cross-tabs the
// result against the shipped text heuristic and against zoning.

const SOCRATA = "https://data.cityofchicago.org/resource/ydr8-5enu.json";
const ASSESSOR = "https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json";

// `node --test verify-tmp/*.mjs` sweeps this file up with the real tests — the
// leading underscore does not exclude it from a shell glob, the trap
// _feat032-mutants.mjs already documents. This is a one-off probe, and it goes to the LIVE network, not a test.
if (process.env.NODE_TEST_CONTEXT) {
  console.log("probe-assessor: skipped under `node --test` — run `node verify-tmp/_probe-assessor.mjs` directly");
  process.exit(0);
}


// Cook County major class families (Assessor Classification Code Manual).
function classUse(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  if (c === "EX" || c.startsWith("EX")) return "exempt";
  const n = parseInt(c, 10);
  if (!Number.isFinite(n)) return null;
  const major = Math.floor(n / 100);
  if (major === 0 || major === 1) return "vacant/land";
  if (major === 2) return "residential";          // 2xx: houses, 2-6 units
  if (major === 3) return "residential";          // 3xx: apartments 7+
  if (major === 4) return "not-for-profit";
  if (major === 5) return "commercial/industrial";
  if (major >= 6 && major <= 9) return "incentive (comm/ind)";
  return null;
}

function permitUse(row) {
  const s = `${row.permit_type || ""} ${row.work_description || ""}`.toUpperCase();
  if (/\b(WRECK\w*|DEMOLITION)\b/.test(s) && !/\bRESIDENTIAL\b/.test(s)) return "unclear";
  const RES = /\b\d{1,3}[- ]?UNITS?\b|\bSINGLE[- ]?FAMILY\b|\b(TWO|THREE|FOUR|SIX)[- ]?FLAT\b|\b\d{1,2}[- ]?FLAT\b|\bTOWN\s?HO(ME|USE)\b|\bCONDO(MINIUM)?\b|\bAPARTMENT\b|\bMULTI[- ]?FAMILY\b|\bDWELLING\b|\bRESIDENTIAL\b/;
  const COM = /\bCOMMERCIAL\b|\bRESTAURANT\b|\bRETAIL\b|\bOFFICE\b|\bSTOREFRONT\b|\bTENANT\b|\bWAREHOUSE\b|\bHOTEL\b/;
  if (/\bMIXED[- ]?USE\b/.test(s)) return "mixed";
  const res = RES.test(s), com = COM.test(s);
  if (res && com) return "mixed";
  if (res) return "residential";
  if (com) return "commercial";
  return "unclear";
}

const where = `permit_status in('ACTIVE','SUSPENDED','PHASED PERMITTING') AND issue_date>='2026-07-01T00:00:00' AND issue_date<='2026-07-31T23:59:59' AND latitude IS NOT NULL`;
const permits = await (await fetch(`${SOCRATA}?${new URLSearchParams({
  $select: "permit_,permit_type,work_type,work_description,pin_list,latitude,longitude", $where: where, $limit: "50000" })}`)).json();
console.log(`open permits in July 2026 with coordinates: ${permits.length}`);

const firstPin = p => String(p.pin_list || "").split("|")[0].replace(/\D/g, "").slice(0, 10);
const withPin = permits.filter(p => firstPin(p).length === 10);
console.log(`carrying a usable 10-digit PIN:                ${withPin.length} (${(100 * withPin.length / permits.length).toFixed(1)}%)`);

// Fetch classes in batches.
const pins = [...new Set(withPin.map(firstPin))];
console.log(`distinct parcels to look up:                   ${pins.length}`);
const classOf = new Map();
const BATCH = 150;
for (let i = 0; i < pins.length; i += BATCH) {
  const slice = pins.slice(i, i + BATCH);
  const q = new URLSearchParams({
    $select: "pin10,class,year",
    $where: `pin10 in(${slice.map(p => `'${p}'`).join(",")})`,
    $order: "year DESC",
    $limit: "5000"
  });
  const rows = await (await fetch(`${ASSESSOR}?${q}`)).json();
  for (const r of rows) if (!classOf.has(r.pin10)) classOf.set(r.pin10, r.class); // year DESC => newest first
  process.stdout.write(`\r  looked up ${Math.min(i + BATCH, pins.length)}/${pins.length} parcels`);
}
console.log("");

const resolved = withPin.filter(p => classOf.has(firstPin(p)));
console.log(`\nmatched to an Assessor parcel record:          ${resolved.length} (${(100 * resolved.length / permits.length).toFixed(1)}% of all permits)`);

const tally = (rows, fn) => {
  const m = new Map();
  for (const r of rows) { const k = fn(r); m.set(k, (m.get(k) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]);
};

console.log("\n=== Assessor property class -> use, over all permits ===");
for (const [k, n] of tally(permits, p => {
  const c = classOf.get(firstPin(p));
  return c === undefined ? "(no parcel match)" : (classUse(c) || `unmapped class ${c}`);
})) console.log(`${String(n).padStart(6)}  ${(100 * n / permits.length).toFixed(1).padStart(5)}%  ${k}`);

console.log("\n=== Assessor class vs the shipped text heuristic (where both speak) ===");
const both = resolved.filter(p => permitUse(p) !== "unclear");
let agree = 0, disagree = 0;
const conflicts = [];
for (const p of both) {
  const a = classUse(classOf.get(firstPin(p)));
  const t = permitUse(p);
  if (!a || a === "exempt" || a === "vacant/land" || a === "not-for-profit") continue;
  const aRes = a === "residential";
  const tRes = t === "residential";
  if (aRes === tRes) agree++; else { disagree++; if (conflicts.length < 8) conflicts.push({ p, a, t, c: classOf.get(firstPin(p)) }); }
}
console.log(`  agree: ${agree}   disagree: ${disagree}   (${(100 * agree / (agree + disagree)).toFixed(1)}% agreement)`);
console.log("\n  sample disagreements:");
for (const c of conflicts) {
  console.log(`   class ${c.c} (${c.a}) vs text "${c.t}"`);
  console.log(`     ${(c.p.work_description || "").slice(0, 110)}`);
}

console.log("\n=== what the badge could say today, per permit ===");
for (const [k, n] of tally(permits, p => {
  const c = classOf.get(firstPin(p));
  const a = c === undefined ? null : classUse(c);
  if (a && a !== "exempt") return `Assessor: ${a}`;
  const t = permitUse(p);
  return t === "unclear" ? "still unknown" : `text fallback: ${t}`;
})) console.log(`${String(n).padStart(6)}  ${(100 * n / permits.length).toFixed(1).padStart(5)}%  ${k}`);
