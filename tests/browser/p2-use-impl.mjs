// AUTO-EXTRACTED from docs/list.html.

export function permitUse(row) {
  const s = `${(row && row.permit_type) || ""} ${(row && row.work_description) || ""}`.toUpperCase();
  if (/\b(WRECK\w*|DEMOLITION)\b/.test(s) && !/\bRESIDENTIAL\b/.test(s)) return { key: "unclear", label: "Unclear", glyph: "\u2014" };
  const RES = /\b\d{1,3}[- ]?UNITS?\b|\bSINGLE[- ]?FAMILY\b|\b(TWO|THREE|FOUR|SIX)[- ]?FLAT\b|\b\d{1,2}[- ]?FLAT\b|\bTOWN\s?HO(ME|USE)\b|\bCONDO(MINIUM)?\b|\bAPARTMENT\b|\bMULTI[- ]?FAMILY\b|\bDWELLING\b|\bRESIDENTIAL\b/;
  const COM = /\bCOMMERCIAL\b|\bRESTAURANT\b|\bRETAIL\b|\bOFFICE\b|\bSTOREFRONT\b|\bTENANT\b|\bWAREHOUSE\b|\bHOTEL\b/;
  if (/\bMIXED[- ]?USE\b/.test(s)) return { key: "mixed", label: "Mixed use", glyph: "\u25EB" };
  const res = RES.test(s);
  const com = COM.test(s);
  if (res && com) return { key: "mixed", label: "Mixed use", glyph: "\u25EB" };
  if (res) return { key: "residential", label: "Residential", glyph: "\u25E7" };
  if (com) return { key: "commercial", label: "Commercial", glyph: "\u25A4" };
  return { key: "unclear", label: "Unclear", glyph: "\u2014" };
}
