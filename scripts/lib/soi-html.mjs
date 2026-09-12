/**
 * soi-html.mjs — the schedule of investments as the 10-Q prints it.
 *
 * The SEC data set and the filing instance carry every loan's cost,
 * fair value, principal, spread and rate, but for most filers three
 * things live only in the HTML table: the maturity date, the industry
 * the loan sits under, and the footnote that says a loan is on
 * non-accrual. This module reads that table.
 *
 * The table is not one table. A filer's schedule runs to a hundred
 * pages and every page is its own <table> with the header repeated,
 * the section it was in re-stated with "(continued)", and the industry
 * carried silently from the page before (BXSL's 10-Q for June 30 2026
 * prints its June schedule over 34 page tables, its December 31 2025
 * comparative over another 31, then eight tables of unfunded
 * commitments that also say "Fair Value"). So the read is sequential:
 * every table whose header the column map resolves is a page of a
 * schedule; consecutive pages under the same heading date are one
 * schedule; a lien-type row, an affiliation row and an industry row
 * each set a section that holds until the next one, across page
 * breaks; a row of numbers with no name, or a name that starts with
 * "Total", is a subtotal and is counted, not kept.
 *
 * Columns are found by header name, never by position, because filers
 * order them differently and because a cell here is not a column: a
 * filer lays "$" and "260,600" in two cells under one header, and
 * "SOFR +" and "5.25 %" in two cells under "Reference Rate and Spread".
 * The header cells are laid over the raw column positions their
 * colspans cover, and every data cell belongs to the header whose span
 * covers its first raw column (or the last header before it, when a
 * spacer column sits between). The one thing this module fixes before
 * handing the HTML to interim-parse's tables() is the self-closing
 * spacer cell (`<td colspan="3"/>`, 37,439 of them in BXSL's 10-Q),
 * which tables() would otherwise swallow into the next cell and lose
 * its width.
 *
 * Footnote markers sit in a "Footnotes" column when the filer prints
 * one and trail the issuer cell otherwise. The footnote bodies follow
 * the schedule's last page, each marker printed alone in its own
 * element before the sentence (BXSL wraps most in ix:footnote and
 * prints three as plain spans in the same block); the markers restart
 * at (1) for the comparative schedule, so a marker is resolved against
 * the block that follows its own schedule, never against the whole
 * document. A row is non-accrual when one of its markers resolves to a
 * sentence that says so.
 *
 * Money is scaled by the note beside the heading ("(in thousands)");
 * the number of shares of an equity position is not (BXSL's footnote 1:
 * "the number of shares or units (in whole amounts) owned is presented
 * for equity investments"), and a par printed in another currency
 * ("EUR 1,337") keeps its currency beside it. Rates come back as
 * fractions to four decimals, dates as YYYY-MM-DD.
 *
 * Nothing here estimates. A column the map cannot name is left out of
 * the row; a date that does not parse is null with its text kept (a
 * month without a day is the first of the month, and the row says
 * so); a table whose header does not resolve cost and fair value and a
 * date or principal column is not a schedule page and is ignored.
 */

import { tables, strip, scaleOf } from "./interim-parse.mjs";
import { lienClass, classifyAffiliation } from "./bdc-concepts.mjs";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";

const round4 = (v) => v == null ? null : Math.round(v * 1e4) / 1e4;
const roundUnit = (v) => v == null ? null : Math.round(v);

/* ---------- the header map ----------
 *
 * Ordered: for each header cell the first key whose pattern matches
 * and that no earlier cell has claimed wins. The order settles the
 * ambiguities that exist between filers: "Investments" is the issuer
 * column for BXSL, and "Investment" the type column for a filer that
 * already named "Company"; "Reference Rate and Spread" is the spread
 * column, so spread is tried before rate; "Fair Value" is tried before
 * a bare "Value". Anchored patterns are the ones a longer header must
 * not fall into. */
export const HEADER_MAP = [
  ["issuer", /^(investments?|portfolio compan(y|ies)( name)?|compan(y|ies)( name)?|issuer( name)?|name of issuer|borrower|portfolio company\/investment|company\/investment|investments?\/portfolio compan(y|ies)|name|portfolio investments?)$|^(?:[a-z ]+\/)+compan(y|ies)$|^portfolio company, location and industry$/],
  ["footnotes", /^(footnotes?|notes?)$/],
  ["industry", /^(industry|business description|sector|industry sector|industry\/sector)$/],
  ["type", /^(investment( type)?|type of investment|security( type| description)?|type|instrument( type)?|description( of investment)?|investment description|asset type|tranche)$/],
  /* "Ref" is the reference rate (TCPC prints "Ref | Floor | Spread |
     Total Coupon"), never a footnote column: a filer's markers sit in
     "Notes" or trail the issuer cell */
  ["base", /^(reference|index|base rate|benchmark|reference index|ref\.?)$/],
  ["spread", /reference rate|spread|index|basis|margin/],
  ["floor", /floor/],
  ["pik", /^pik( rate)?$|paid[- ]in[- ]kind/],
  ["rate", /interest rate|^rate$|coupon|^interest$|cash rate|current rate|total rate|^interest\b|\brate\b|yield/],
  ["acquired", /acquisition|acquired|investment date|initial investment|origination|purchase date|date of investment/],
  ["maturity", /maturity|expiration|due date/],
  ["principal", /\bpar\b|principal|units|shares|quantity|no\. of|number of|face|notional/],
  ["cost", /amortized cost|\bcost\b/],
  ["fv", /fair value|^value$|market value/],
  ["pctNav", /% of net assets|percentage of net assets|% of net asset value|percent of net assets|% of nav|% of total net assets|percentage of net asset value|% net assets|% of net$|net assets$|percentage of net$/],
];

/* A header cell's name without its footnote markers, superscripts and
   the line break a two-row header leaves behind. */
export function headerName(text) {
  return String(text || "")
    .replace(/\(\s*(\d{1,2}|[a-z]{1,2})\s*\)/gi, " ")
    /* CSWC's "Portfolio Company 1,5,21" and "Cost 12,17": bare marker
       numbers after the name */
    .replace(/\s+\d{1,2}(?:\s*,\s*\d{1,2})*\s*$/, " ")
    .replace(/[*†‡§]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * Column map of one header row (or a merged header block): each entry
 * is { key, at, span } over raw column positions. Returns null when the
 * cells do not read as a schedule header: cost and fair value must
 * both resolve, with a maturity, acquisition, principal, spread or
 * rate column beside them, or the table is a summary or a fair-value
 * hierarchy, not the schedule.
 */
/* "Shares/Units" and "Principal" sit as two distinct top-level header
   cells in the same row for a filer whose schedule prices its equity
   units and its debt par in separate columns (MAIN, FRBP, GAIN, GLAD,
   MSIF, PIAC); RTCredit's single `principal` field (with the `units`
   flag beside it) holds either one, so both columns are let claim
   "principal" rather than the second one going unmapped and its raw
   column bleeding into whatever key sits before it. Every other key
   keeps first-match-wins: two unrelated headers should never merge. */
const MULTI_CLAIM_KEYS = new Set(["principal"]);

export function mapHeader(cells) {
  const claimed = new Set();
  const cols = [];
  let pos = 0;
  for (const c of cells) {
    const at = pos; pos += c.span;
    const name = headerName(c.text);
    if (!name) continue;
    for (const [key, re] of HEADER_MAP) {
      if (claimed.has(key) && !MULTI_CLAIM_KEYS.has(key)) continue;
      if (re.test(name)) { claimed.add(key); cols.push({ key, at, span: c.span, name }); break; }
    }
  }
  const has = (k) => claimed.has(k);
  if (!has("cost") || !has("fv")) return null;
  if (!(has("maturity") || has("acquired") || has("principal") || has("spread") || has("rate"))) return null;
  /* a first column with no header cell over it is the issuer column
     (GBDC prints two blank cells before "Investment Type") */
  if (!has("issuer") && cols.length && cols[0].at > 0) {
    cols.unshift({ key: "issuer", at: 0, span: cols[0].at, name: "(unlabeled first column)" });
    claimed.add("issuer");
  }
  return { cols, width: pos, keys: [...claimed] };
}

/* ---------- cell readers ---------- */

/* The currency a cell names before its figure: "EUR 1,337", "£ 2,000",
   "C$ 500". "$" alone is USD and comes back null. */
const CURRENCY_RE = /^\s*(EUR|GBP|CAD|AUD|DKK|SEK|NOK|CHF|JPY|NZD|SGD|HKD|MXN|BRL|INR|ZAR|PLN|CZK|HUF|ILS|€|£|¥|C\$|A\$|NZ\$|S\$|HK\$|kr)(?![A-Za-z])/i;
export function currencyOf(text) {
  const m = String(text || "").match(CURRENCY_RE);
  if (!m) return null;
  const c = m[1].toUpperCase();
  return { "€": "EUR", "£": "GBP", "¥": "JPY", "C$": "CAD", "A$": "AUD", "NZ$": "NZD", "S$": "SGD", "HK$": "HKD", "KR": "SEK" }[c] || c;
}

/* "$ 260,600" → 260600; "EUR 1,337" → 1337; "( 5,789 )" → -5789; "-" and "—" → 0; text → null */
export function money(text) {
  const t = String(text || "").replace(CURRENCY_RE, "").replace(/\$/g, "").replace(/\s/g, "");
  if (!t) return null;
  if (/^[-—–]+$/.test(t)) return 0;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  const digits = t.replace(/[()]/g, "").replace(/^-/, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const v = Number(digits);
  return neg ? -v : v;
}

/* "5.25 %" → 0.0525; "525 bps" → 0.0525; "5.25" → 0.0525 */
function percent(text) {
  const m = String(text || "").match(/(-?\d+(?:\.\d+)?)\s*(%|bps|basis points)?/i);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  return round4(/bps|basis/i.test(m[2] || "") ? v / 1e4 : v / 100);
}

/* The reference rate a spread is quoted over: the name before the "+".
   SOFR under its printed names (SOFR, TSFR, SF, "3M SOFR") is "SOFR";
   any other name is "other" (BXSL's "S +" is SONIA by its footnote 2,
   "E +" Euribor, "P +" prime, "CA +" CORRA); no "+" is no base. */
export function baseOf(text) {
  const t = String(text || "");
  const plus = t.indexOf("+");
  if (plus < 0) return null;
  const head = t.slice(0, plus);
  if (/\b(SOFR|TSFR|SF)\b/i.test(head)) return "SOFR";
  if (/[A-Za-z]/.test(head)) return "other";
  return null;
}

/**
 * The rate text of a row, from its spread cell and its rate cell:
 *   "SOFR + 5.25 %"                    → base SOFR, spread 0.0525
 *   "8.97 %"                           → rate 0.0897
 *   "14.17 % (incl. 9.50 % PIK)"       → rate 0.1417, pik 0.095
 *   "13.67 % PIK"                      → rate 0.1367, pik 0.1367
 *   "SOFR + 5.75 % (1.00 % Floor)"     → floor 0.01
 *   "12.00 % Cash / 2.00 % PIK"        → rate 0.12 (cash), pik 0.02
 * A filer that prints "SOFR + 5.75% (11.08%)" in one cell yields both
 * the spread and the all-in rate from it. A bare percentage in the
 * spread column is a spread only when the rate column says something
 * else: BXSL prints "13.75 %" under "Reference Rate and Spread" for
 * its fixed-rate unsecured note and "13.75 % PIK" under "Interest
 * Rate", and that is a fixed coupon, not a spread over nothing.
 */
export function parseRateText(spreadText, rateText) {
  const out = { base: null, spread: null, rate: null, pik: null, floor: null };
  const s = String(spreadText || "").trim();
  const r = String(rateText || "").trim();
  let bare = false;
  const readSpread = (t) => {
    const b = baseOf(t);
    if (b) out.base = b;
    const m = t.match(/\+\s*(\d+(?:\.\d+)?)\s*(%|bps)?/i);
    if (m) out.spread = /bps/i.test(m[2] || "") ? round4(Number(m[1]) / 1e4) : round4(Number(m[1]) / 100);
    else if (b === null && /^\d+(\.\d+)?\s*(%|bps)?$/.test(t)) { out.spread = percent(t); bare = true; }
    const f = t.match(/(\d+(?:\.\d+)?)\s*%?\s*floor|floor[^\d]{0,12}(\d+(?:\.\d+)?)\s*%?/i);
    if (f) out.floor = round4(Number(f[1] || f[2]) / 100);
  };
  if (s) readSpread(s);
  if (r) {
    if (/\+/.test(r) && baseOf(r)) {
      if (out.spread == null) readSpread(r);
      /* the all-in rate follows the spread: "(11.08%)" or after a comma */
      const after = r.replace(/^[^+]*\+\s*\d+(?:\.\d+)?\s*(%|bps)?/i, "");
      const all = after.match(/(\d+(?:\.\d+)?)\s*%/);
      if (all) out.rate = round4(Number(all[1]) / 100);
    } else {
      const first = r.match(/(\d+(?:\.\d+)?)\s*%/);
      if (first) out.rate = round4(Number(first[1]) / 100);
    }
    const pikIn = r.match(/\(\s*(?:incl(?:uding|\.)?|of which|includes)\s*(\d+(?:\.\d+)?)\s*%\s*PIK/i)
      || r.match(/(\d+(?:\.\d+)?)\s*%\s*PIK/i);
    if (pikIn) out.pik = round4(Number(pikIn[1]) / 100);
    const f = r.match(/(\d+(?:\.\d+)?)\s*%?\s*floor/i);
    if (f && out.floor == null) out.floor = round4(Number(f[1]) / 100);
  }
  if (bare && (out.rate == null || out.rate === out.spread)) {
    /* a fixed coupon printed in the spread column */
    if (out.rate == null) out.rate = out.spread;
    out.spread = null;
  }
  return out;
}

/**
 * A printed date as YYYY-MM-DD: "2/5/2020", "02/05/20", "2020-02-05",
 * "February 5, 2020", "Feb 5, 2020", "5-Feb-2020". A month without a
 * day ("Feb 2020", "2/2020") is the first of the month, and the caller
 * sees precision "month". Anything else is null.
 */
export function parseDate(text) {
  const t = String(text || "").replace(/&#160;| /g, " ").trim();
  if (!t || /^(n\/?a|none|-+|—)$/i.test(t)) return null;
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() && y > 1900 && y < 2200;
  let m;
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return valid(y, Number(m[1]), Number(m[2])) ? { iso: iso(y, Number(m[1]), Number(m[2])), precision: "day" } : null;
  }
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    return valid(Number(m[1]), Number(m[2]), Number(m[3])) ? { iso: t, precision: "day" } : null;
  }
  if ((m = t.match(new RegExp(`^(${MONTH_RE})\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "i")))) {
    const mo = MONTHS[m[1].toLowerCase().replace(/\./g, "").slice(0, 3)] || MONTHS[m[1].toLowerCase().replace(/\./g, "")];
    const y = Number(m[3]), d = Number(m[2]);
    return mo && valid(y, mo, d) ? { iso: iso(y, mo, d), precision: "day" } : null;
  }
  if ((m = t.match(new RegExp(`^(\\d{1,2})[-\\s](${MONTH_RE})[-\\s](\\d{2}|\\d{4})$`, "i")))) {
    const mo = MONTHS[m[2].toLowerCase().replace(/\./g, "").slice(0, 3)];
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), d = Number(m[1]);
    return mo && valid(y, mo, d) ? { iso: iso(y, mo, d), precision: "day" } : null;
  }
  if ((m = t.match(new RegExp(`^(${MONTH_RE})[-\\s,]+(\\d{4})$`, "i")))) {
    const mo = MONTHS[m[1].toLowerCase().replace(/\./g, "").slice(0, 3)];
    return mo ? { iso: iso(Number(m[2]), mo, 1), precision: "month" } : null;
  }
  if ((m = t.match(/^(\d{1,2})\/(\d{4})$/))) {
    const mo = Number(m[1]);
    return mo >= 1 && mo <= 12 ? { iso: iso(Number(m[2]), mo, 1), precision: "month" } : null;
  }
  /* "04/28" (BBDC prints acquisition and maturity as MM/YY): month
     precision, the century as the two-digit-year form above */
  if ((m = t.match(/^(\d{1,2})\/(\d{2})$/))) {
    const mo = Number(m[1]);
    return mo >= 1 && mo <= 12 ? { iso: iso(2000 + Number(m[2]), mo, 1), precision: "month" } : null;
  }
  return null;
}

/* ---------- issuer names ---------- */

const LEGAL = /\b(inc|incorporated|llc|l\s?l\s?c|lp|l\s?p|llp|ltd|limited|corp|corporation|co|company|plc|sa|sarl|sàrl|gmbh|bv|nv|ag|ab|as|oy|pty|srl|spa|kg|se|holdings?|holdco)\b/g;

/** Lower case, "&" as "and", punctuation gone, one space between words. */
export function normalizeIssuer(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&amp;/g, "&").replace(/&/g, " and ")
    .replace(/[.,'’"`()\[\]/\\:;*†‡]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The normalized name without its legal form, for matching across
 *  the instance's "Corfin Holdings, Inc. 1" and the table's "Corfin
 *  Holdings, Inc.". "Holdings" goes too: a filer prints it on one side
 *  and not the other more often than two different issuers share the
 *  rest of a name, and the principal check separates those. */
export function issuerKey(text) {
  const key = normalizeIssuer(text).replace(LEGAL, " ").replace(/\b\d+\b$/, "").replace(/\s+/g, " ").trim();
  return key || normalizeIssuer(text);
}

/**
 * The parts of an identifier member's text. Filers name a member
 * three ways: "Issuer | Type N" (ARCC, June 2026), "Issuer N |
 * affiliation" (BXSL) and "Issuer, Type N" (ARCC's comparative, Golub,
 * OFS). A type is recognised by the lien vocabulary; a trailing
 * sequence number is dropped from the issuer and kept as seq.
 */
export function splitMember(text) {
  const raw = strip(String(text || ""));
  let issuer = raw, type = null, aff = null, seq = null;
  const takeSeq = (s) => { const m = s.match(/^(.*?)[\s,]*(\d{1,3})$/); if (m && m[1].trim()) { seq = Number(m[2]); return m[1].trim(); } return s.trim(); };
  if (raw.includes("|")) {
    const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (classifyAffiliation(last) && parts.length >= 2) {
      aff = classifyAffiliation(last);
      issuer = takeSeq(parts.slice(0, -1).join(" | "));
    } else if (parts.length >= 2) {
      issuer = parts[0];
      type = takeSeq(parts.slice(1).join(" | "));
    }
  } else {
    const parts = raw.split(",").map((s) => s.trim());
    if (parts.length >= 2) {
      const last = takeSeq(parts[parts.length - 1]);
      if (lienClass(last) || /\b(loan|note|bond|debt|revolver|term|delayed draw|warrant|unit|share|stock|interest|equity|preferred|common)/i.test(last)) {
        type = last;
        issuer = parts.slice(0, -1).join(", ");
      }
    }
    if (!type) issuer = takeSeq(raw);
  }
  return { issuer: issuer.replace(/\s+/g, " ").trim(), type, aff, seq, raw };
}

/* ---------- footnotes ---------- */

/**
 * Every footnote body in the document with the marker printed beside
 * it and its position, in document order: [{ marker: "(17)", text,
 * at }]. A body is the text that follows a marker printed alone in
 * its own element, up to the end of the block that holds them. That
 * covers the forms seen: a marker span before an ix:footnote (BXSL's
 * (17)), a marker span before a plain span (BXSL prints (12) and (13)
 * that way in the same block), an ix:footnote nested inside the text
 * span ((15)), and a marker cell beside a text cell (the R pages'
 * "[11]"). A marker cell in a Footnotes column matches too, but its
 * block ends at once and the empty body is dropped. Brackets and
 * parentheses both come back as "(n)".
 */
export function findFootnotes(html) {
  const out = [];
  const re = /(?:<(?:span|td|div|p|sup|font|b|a|strong)\b[^>]*>\s*)+[\[(]\s*(\d{1,2}|[a-z]{1,2})\s*[\])]\s*<\/(?:span|td|div|p|sup|font|b|a|strong)>\s*([\s\S]{0,6000}?)(?=<\/(?:div|td|tr|p|li|table)>|(?:<(?:span|td|div|p)\b[^>]*>\s*)+[\[(]\s*(?:\d{1,2}|[a-z]{1,2})\s*[\])]\s*<\/)/g;
  let m;
  while ((m = re.exec(html))) {
    const text = strip(m[2]).replace(/\s+([.,;:])/g, "$1");
    if (!text || text.length < 8 || !/[A-Za-z]{3}/.test(text)) continue;
    out.push({ marker: `(${m[1].toLowerCase()})`, text, at: m.index });
  }
  return out;
}

export const NON_ACCRUAL_RE = /\bnon-?\s?accrual\b/i;
const ACCRUAL_RESUMED_RE = /\b(no longer|removed from|returned to|taken off|restored to)\b/i;
/* A sentence that names non-accrual without saying this holding is on
   it: PSEC's PIK footnote reads "The interest rate on the below list
   of investments, which excludes those on non-accrual, contains a
   paid in kind (PIK) provision" (10-K 0001287032-26-000269, R9.htm
   markers (30) and (32)); a policy sentence says what "placed on
   non-accrual" means; a negation says it is not. */
const NON_ACCRUAL_NEGATED_RE = /\b(?:exclud(?:es|ing|ed)|other than|except(?:ing)?|not (?:on|currently on|placed on)|are not|is not|was not|were not|unless)\b[^.;]{0,60}\bnon-?\s?accrual\b|\bnon-?\s?accrual\b[^.;]{0,40}\b(?:are|is|was|were) excluded\b/i;
const NON_ACCRUAL_POLICY_RE = /\b(?:generally|policy|when|if|would|will be|may be|are placed on|is placed on)\b[^.;]{0,80}\bnon-?\s?accrual\b(?! status as of| status at)/i;
/* The status statement itself: "on non-accrual status", "non-accrual
   investment", "classified as non-accrual", "Non-accrual security",
   "has been on non-accrual since", "placed the investment on
   nonaccrual" (AFCG), "Non-accrual status" alone (MFIC). */
const NON_ACCRUAL_STATUS_RE = /\b(?:on|in) non-?\s?accrual(?: status)?\b|\bnon-?\s?accrual (?:status|investment|security|securit|asset|loan|debt|position|or non-income)\b|\bclassified as (?:a )?non-?\s?accrual\b|\bnon-?\s?accrual\.?$|^non-?\s?accrual\b|\bplaced (?:the )?(?:investment|loan|debt|security)?\s?on non-?\s?accrual\b/i;
/* A partial mark: the PIK component alone is not accruing (BBDC's
   "Payment-in-kind ("PIK") non-accrual investment", footnote (27) of
   10-Q 0001379785-26-000030, which the filer keeps out of its
   non-accrual totals). */
const PIK_NON_ACCRUAL_RE = /\b(?:PIK|payment[- ]in[- ]kind)\b[^.;]{0,30}\bnon-?\s?accrual\b|\bpartial(?:ly)? (?:on )?non-?\s?accrual\b|\bnon-?\s?accrual\b[^.;]{0,40}\b(?:only )?with respect to the PIK\b/i;

/** Whether a footnote sentence marks a holding as non-accrual: a
 *  status statement, not a negation, a reference or a policy, and
 *  not the PIK-only partial mark (see isPikNonAccrual). */
export function saysNonAccrual(text) {
  const t = String(text || "").trim();
  if (!NON_ACCRUAL_RE.test(t) || ACCRUAL_RESUMED_RE.test(t)) return false;
  if (NON_ACCRUAL_NEGATED_RE.test(t)) return false;
  if (isPikNonAccrual(t)) return false;
  if (!NON_ACCRUAL_STATUS_RE.test(t)) return false;
  if (NON_ACCRUAL_POLICY_RE.test(t) && !/\b(?:is|was|were|are|currently|has been) (?:on |placed on |classified as )?non-?\s?accrual\b|\bnon-?\s?accrual (?:status|investment|security|asset)\b/i.test(t)) return false;
  return true;
}

/**
 * The affiliation a footnote sentence states for the row it marks, for
 * a filer whose schedule has no affiliation sections (ARCC's 10-Q for
 * 2026-06-30, 0001628280-26-050307: "(4) ... the Company is deemed to
 * be an 'Affiliated Person' ... (but not a portfolio company that the
 * Company is deemed to Control)" and "(5) ... deemed to be both an
 * 'Affiliated Person' and 'Control' this portfolio company"). A policy
 * sentence ("(1) Other than ... the Company does not 'Control' any of
 * its portfolio companies") marks nothing, and "non-controlled" never
 * reads as controlled. Null when the sentence states no class.
 */
export function affiliationOfFootnote(text) {
  const t = String(text || "");
  if (!/affiliat|control/i.test(t)) return null;
  if (/\b(?:does not|do not|is not|are not|other than|except)\b[^.]{0,80}\bcontrol/i.test(t) && !/deemed to (?:be both|control)/i.test(t)) return null;
  const notControl = /\(but not[^)]*control[^)]*\)|but not a portfolio company that (?:the company|we) (?:is|are) deemed to control/i.test(t);
  const control = /deemed to (?:be both [^.]{0,60}and )?["“]?control|(?:is|are) deemed to control|deemed to be a controlled|(?<!non[- ])\bcontrolled (?:investment|portfolio company|affiliate|company)|\bcontrol investment/i.test(t);
  if (control && !notControl) return "controlled";
  if (/non-?s?affiliat|unaffiliat/i.test(t)) return "non-controlled/non-affiliated";
  if (/affiliated person|non-?\s?controlled[,/ ]+affiliat|affiliated investment|\baffiliate\b/i.test(t)) return "non-controlled affiliated";
  return null;
}
export function affiliationOfMarkers(markers, footnotes) {
  let out = null;
  for (const mk of markers || []) {
    const a = affiliationOfFootnote(footnotes && footnotes[mk]);
    if (a === "controlled") return a;
    if (a) out = a;
  }
  return out;
}

/** Whether a footnote marks the PIK component alone as non-accruing. */
export function isPikNonAccrual(text) {
  const t = String(text || "");
  return NON_ACCRUAL_RE.test(t) && PIK_NON_ACCRUAL_RE.test(t);
}

/** The date a non-accrual footnote names ("as of June 30, 2026", "at
 *  December 31, 2025"), as YYYY-MM-DD, or null when it names none. A
 *  footnote dated to the comparative period marks nothing in the
 *  current one: the R pages and some main documents carry both. */
export function nonAccrualDateOf(text) {
  const m = String(text || "").match(/\b(?:as of|at|as at)\s+([A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/i);
  if (!m) return null;
  const d = parseDate(m[1].replace(/\./g, "").replace(/\s+/g, " "));
  return d ? d.iso : null;
}

/** saysNonAccrual, and the sentence's own date (when it names one) is
 *  the period asked for. */
export function marksNonAccrualAt(text, period) {
  if (!saysNonAccrual(text)) return false;
  if (!period) return true;
  const d = nonAccrualDateOf(text);
  return !d || d === period;
}

/* Markers in a cell: "(4)(5)(10)(17)" → ["(4)","(5)","(10)","(17)"];
   also "[4]", "(a)" and FDUS's two-letter "(bg)" forms. */
export function markersOf(text) {
  const out = [];
  const re = /[\[(]\s*(\d{1,2}|[a-z]{1,2})\s*[\])]/gi;
  let m;
  while ((m = re.exec(String(text || "")))) out.push(`(${m[1].toLowerCase()})`);
  return out;
}
/* "Houston, TX", "Karnes City, TX", "Toronto, Ontario, Canada": a
   city and state or country, which some filers print beside the
   company name where others print the industry. */
export const LOCATION_RE = /^[A-Z][A-Za-z.'\- ]{1,40},\s*(?:[A-Z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)?)(?:,\s*[A-Z][A-Za-z ]+)?$/;
/* A text that ends in a legal form is a company, not an industry. */
export const COMPANY_TAIL_RE = /\b(?:LLC|L\.L\.C\.|Inc\.?|L\.?P\.?|LLP|Ltd\.?|Limited|Corp\.?|Corporation|PLC|S\.A\.?|GmbH|B\.V\.?|N\.V\.?|Holdings?|Holdco|Bidco|Topco|Midco|Buyer|Parent)\.?\)?$/i;
/* The issuer text without its trailing markers. */
function withoutMarkers(text) {
  return String(text || "").replace(/(\s*[\[(]\s*(\d{1,2}|[a-z]{1,2})\s*[\])])+\s*$/i, "").replace(/\s+/g, " ").trim();
}

/* A first-column text that is a tranche, not a company: it opens with
   an instrument word ("First Lien Debt", "Second Lien Debt", "Common
   Equity ( 2,522 units)", "Subordinated Debt", "Revolving Loan",
   "Warrant ( 275,000 shares)"), the layout OFS and FDUS print under a
   company line. A company whose name opens with such a word ("First
   Brands Group, LLC") ends with a legal form, and is not one. */
const INSTRUMENT_START_RE = /^(?:first|second|third|1st|2nd|senior|sr\.?|junior|unsecured|subordinated|sub\.?|mezzanine|unitranche|one[- ]stop|last[- ]out|term loan|term debt|revolv|delayed[- ]draw|line of credit|common|preferred|pref\.?|warrants?|equity|membership|class [a-z]|series [a-z0-9]|units?\b|shares?\b|notes?\b|bonds?\b|convertible|secured|debt\b|loan\b)/i;
const LEGAL_FORM_END_RE = /\b(?:inc|llc|l\.l\.c|lp|l\.p|llp|ltd|limited|corp|corporation|co|company|plc|sa|ag|gmbh|bv|nv|holdings?|holdco|group)\.?\s*(?:\([^)]*\))?\s*$/i;
export function startsAsInstrument(text) {
  const t = String(text || "").trim();
  if (!t || !INSTRUMENT_START_RE.test(t)) return false;
  if (LEGAL_FORM_END_RE.test(t) && !/\(\s*[\d,]+\s*(?:units?|shares?|warrants?)/i.test(t)) return false;
  return true;
}

/* ---------- sections ---------- */

const LIEN_WORDS = /\b(first|second|third|1st|2nd|3rd)[- ]lien\b|\bsenior secured\b|\bsecured (debt|loans?|notes?)\b|\bunsecured\b|\bsubordinated\b|\bmezzanine\b|\bunitranche\b|\bone stop\b|\blast[- ]out\b|\bequity\b|\bpreferred\b|\bwarrants?\b|\bcommon stock\b|\b(debt|loan|note|bond) investments?\b|\bsenior (debt|loans?|notes?)\b|\bjunior\b|\bstructured\b|\bclo\b|\bjoint ventures?\b|\bcash( and cash)? equivalents\b|\bshort[- ]term investments\b|\bmoney market\b|\bderivatives?\b|\bswaps?\b|\bforward contracts?\b|\btreasury\b|\bdebt\b|\bloans?\b|\bnotes?\b|\binvestments?\b|\bsecurities\b/i;
/* Industry names that carry a lien word without being one. */
const INDUSTRY_LOOKALIKE = /real estate investment trusts?|\(reits?\)|investment (companies|banking|management|services)|equity real estate|asset management|capital markets|debt collection|consumer finance/i;

/**
 * What a one-cell row means: a lien-type section, an affiliation
 * section, both ("First Lien Debt - non-controlled/non-affiliated"),
 * or an industry. "(continued)" re-states the section a page break
 * interrupted and resets nothing beneath it.
 */
export function classifySection(text) {
  const continued = /\(\s*continued\s*\)|\bcontinued\b/i.test(text);
  const t = strip(text).replace(/\s*[-–—:]?\s*\(\s*continued\s*\)\s*$/i, "").replace(/\s*[-–—:]\s*continued\s*$/i, "")
    /* the share of net assets a filer prints on the section line
       (GAIN "Aerospace and Defense - 16.7 %", PNNT "First Lien Secured
       Debt - 86.7 % of Net Assets", BCIC "Collateralized Loan
       Obligations - 8.7 %") and its footnote markers */
    .replace(/\s*[-–—:]?\s*\(?\d{1,3}(?:\.\d+)?\s?%(?:\s*of (?:total )?net assets)?\)?\s*:?\s*$/i, "")
    .replace(/(\s*[\[(]\s*(\d{1,2}|[a-z]{1,2})\s*[\])])+\s*$/i, "")
    .replace(/\s*[-–—:]\s*$/, "")
    .trim();
  const aff = classifyAffiliation(t);
  let lien = null, industry = null, affOnly = false;
  /* a sentence inside the table ("The accompanying notes are an
     integral part…", "See notes to…") is neither section nor industry */
  if (/accompanying notes|see (the )?notes|table of contents|continued on|unaudited/i.test(t) || (t.length > 60 && /\.$/.test(t))) {
    return { text: t, continued, lien: null, aff: null, affOnly: false, industry: null, ignore: true };
  }
  if (aff) {
    const rest = t
      .replace(/\s*[-–—:(]\s*(non[- ]?controlled[^)]*?|controlled[^)]*?|affiliated[^)]*?)\)?\s*$/i, "")
      .replace(/^(non[- ]?controlled[^-–—:]*?|controlled[^-–—:]*?|affiliated[^-–—:]*?)\s*[-–—:]\s*/i, "")
      .trim();
    if (rest && rest !== t && LIEN_WORDS.test(rest)) lien = rest;
    else affOnly = true;
  } else if (LIEN_WORDS.test(t) && !INDUSTRY_LOOKALIKE.test(t)) {
    lien = t;
  } else {
    industry = t;
  }
  return { text: t, continued, lien, aff, affOnly, industry };
}

/* "Total", "Subtotal", "Sub Total Collateralized Securities" (FRBP),
   "Sub-total": a subtotal line, counted and never kept as a holding */
export const TOTAL_RE = /^(sub[- ]?)?totals?\b|^net (assets|investments)|^total\b|^grand total/i;

/* ---------- the read ---------- */

/* The heading date above a page: the date that follows "Schedule of
   Investments" in the text before the table. */
function headingDate(before) {
  const m = before.match(new RegExp(`schedule of (?:portfolio )?investments\\s*(?:\\([^)]*\\)\\s*)?(?:as of\\s*)?(${MONTH_RE}\\s+\\d{1,2},?\\s+\\d{4})`, "i"))
    || before.match(new RegExp(`as of\\s+(${MONTH_RE}\\s+\\d{1,2},?\\s+\\d{4})\\s*$`, "i"));
  if (!m) return null;
  const d = parseDate(m[1].replace(/\s+/g, " "));
  return d ? d.iso : null;
}

/* Raw positions of a row's cells. */
function positions(row) {
  let pos = 0;
  return row.map((c) => { const at = pos; pos += c.span; return { at, span: c.span, text: c.text }; });
}

/* One row laid over the header's columns: { key: "text joined" }. A
   cell belongs to the header whose span covers its first raw column,
   or the last header before it. */
const hasDigits = (t) => /\d/.test(String(t || ""));
const looksNumeric = (t) => money(t) !== null && hasDigits(t);

/* Two header rows as one: the second row's cells laid over the raw
   columns of the first. A sub-cell under a wider header cell splits
   it (CSWC's "Current Interest Rate" over "Coupon | Reference | Spread
   | Floor | PIK" becomes five columns named by the sub-cells); a
   sub-cell of the same width joins its text below the cell above
   ("Par Amount" + "Units"); a sub-cell with no cell above it (a
   section label printed on the header's second line) is dropped. */
function mergeHeaderRows(top, second) {
  const tops = positions(top);
  const subs = positions(second).filter((c) => c.text);
  const out = [];
  for (const h of tops) {
    const under = subs.filter((s) => s.at >= h.at && s.at < h.at + h.span);
    if (!under.length) { out.push({ span: h.span, text: h.text }); continue; }
    if (under.length === 1 && under[0].span >= h.span) {
      /* a section label on the header's second line (CSWC's "Debt
         Investments" under "Portfolio Company") names no column */
      const sec = classifySection(under[0].text);
      out.push({ span: h.span, text: sec.lien || sec.aff ? h.text : [h.text, under[0].text].filter(Boolean).join(" ") });
      continue;
    }
    /* split: the sub-cells name the columns, the gaps keep the width */
    let pos = h.at;
    for (const s of under) {
      if (s.at > pos) out.push({ span: s.at - pos, text: "" });
      out.push({ span: s.span, text: s.text });
      pos = s.at + s.span;
    }
    if (pos < h.at + h.span) out.push({ span: h.at + h.span - pos, text: "" });
  }
  return out;
}

/* The money columns in print order, for the repair below. */
const MONEY_KEYS = ["principal", "cost", "fv", "pctNav"];
const MARKERS_ONLY_RE = /^(?:\s*[\[(]\s*(?:\d{1,2}|[a-z]{1,2})\s*[\])]\s*,?)+$/i;

function layRow(row, header) {
  const cells = positions(row);
  const out = {};
  const parts = {};
  const starts = header.cols.map((c) => c.at);
  for (const cell of cells) {
    if (!cell.text) continue;
    let idx = -1;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= cell.at) idx = i;
    if (idx < 0) continue;
    /* a cell of nothing but markers ("(7)(16)" in the unlabelled
       column CSWC prints after Fair Value) is the row's footnotes
       wherever it sits; joined to a figure it would read as a number */
    const key = MARKERS_ONLY_RE.test(cell.text) ? "footnotes" : header.cols[idx].key;
    out[key] = out[key] ? out[key] + " " + cell.text : cell.text;
    (parts[key] = parts[key] || []).push(cell.text);
  }
  /* A row printed with fewer cells than the header's columns (TCPC
     lays "$ | 13,653,092 | $ | 13,589,337 | $ | 13,748,664" on its
     first row and "6,562,500 | 6,517,861 | 6,608,438" on the next, under
     a header whose Principal, Cost and Fair Value each span two raw
     columns) drifts every figure one column left: two numbers land
     under Cost and the net-assets percentage under Fair Value. When
     one money column received two numeric cells, the numeric cells
     under the money columns are dealt out again in print order — only
     when there are at least as many as the header has money columns
     (a column the map does not name, TCPC's "% of Total Cash and
     Investments", spills its figure into the last named one), so a
     parenthesised negative split over two cells ("( 401" and ")") is
     never taken apart. */
  const moneyKeys = MONEY_KEYS.filter((k) => header.cols.some((c) => c.key === k));
  const doubled = moneyKeys.some((k) => (parts[k] || []).filter(looksNumeric).length >= 2);
  if (doubled) {
    const tokens = [];
    for (const k of moneyKeys) for (const t of parts[k] || []) if (looksNumeric(t)) tokens.push(t);
    if (tokens.length >= moneyKeys.length) {
      moneyKeys.forEach((k, i) => {
        /* keep a currency prefix the cell carried ("EUR 538,813" is one
           cell; a lone "$" cell is dropped, money() ignores it) */
        out[k] = tokens[i];
      });
    }
  }
  return out;
}

/* the tr blocks of a table, aligned with tables()'s rows (which drop
   rows without a text cell), for the contextRef of an inline-XBRL row */
function rowHtmlOf(tableHtml) {
  const out = [];
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(tableHtml))) {
    const tdRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let td, any = false;
    while ((td = tdRe.exec(tr[0]))) if (strip(td[1])) { any = true; break; }
    if (any) out.push(tr[0]);
  }
  return out;
}
function contextOf(rowHtml) {
  const counts = new Map();
  const re = /contextRef="([^"]+)"/g;
  let m;
  while ((m = re.exec(rowHtml))) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  let best = null, n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}

/**
 * The schedule of investments of one document.
 *
 *   parseScheduleTables(html, { period })
 *   → { period, periods, tables, scale, rows, subtotals, subtotalRows, totals, footnotes, headers, notes }
 *
 * `period` (YYYY-MM-DD) picks the schedule when the document prints
 * more than one; the default is the latest heading date, which is the
 * current period in every 10-Q. `rows` are holdings in print order:
 *
 *   { issuer, type, section: { lien, lienClass, aff, industry },
 *     industry, footnotes, nonAccrual, base, spread, rate, pik, floor,
 *     acquired, maturity, maturityPrecision, principal, currency,
 *     units, cost, fv, pctNav, ctx, page, raw }
 *
 * `principal` is the par in the currency the cell names (BXSL prints
 * "EUR 1,337" for a euro loan while cost and fair value stay in
 * dollars); `currency` is that code, null for dollars.
 *
 * `headers` lists every header variant seen with the key it resolved
 * to; `footnotes` is the schedule's own block, { "(17)": "Loan was on
 * non-accrual status as of June 30, 2026." }.
 */
export function parseScheduleTables(html, { period = null } = {}) {
  const src = String(html || "").replace(/<(td|th)\b([^>]*?)\/>/gi, "<$1$2></$1>");
  const all = tables(src);
  const notes = [];
  const headers = new Map();

  /* pages: every table whose header resolves, with the heading date;
     a headerless table that follows a page across nothing but a page
     number continues it under the same header (FDUS prints its
     schedule over seven tables and heads only the first) */
  const pages = [];
  let lastDate = null;
  let cursor = 0;
  let lastTable = -1;
  for (let ti = 0; ti < all.length; ti++) {
    const t = all[ti];
    let header = null, headerRow = -1;
    for (let r = 0; r < Math.min(t.rows.length, 8); r++) {
      const h = mapHeader(t.rows[r]);
      if (h) { header = h; headerRow = r; break; }
    }
    let firstData = headerRow + 1;
    let continued = false;
    if (!header) {
      const prev = pages.length ? pages[pages.length - 1] : null;
      const start = prev ? src.indexOf(t.html, prev.end) : -1;
      const between = prev && start >= 0 ? strip(src.slice(prev.end, start)).replace(/table of contents/ig, "").trim() : "x";
      const numericRows = t.rows.filter((r) => r.some((c) => looksNumeric(c.text))).length;
      if (prev && ti === lastTable + 1 && /^(?:\d{1,3}|)$/.test(between) && numericRows >= 3) {
        header = prev.header; firstData = 0; continued = true;
      } else continue;
    }
    /* a second header line ("Units" under "Par Amount/", CSWC's
       "Coupon | Reference | Spread | Floor | PIK" under a "Current
       Interest Rate" cell spanning five columns): a following row that
       carries no number and no date is laid over the header's raw
       columns; a sub-cell under a wider header cell becomes a column
       of its own, a sub-cell of the same width joins the text above */
    const headerish = (r) => {
      const texts = r.filter((c) => c.text);
      return texts.length >= 2 && !texts.some((c) => looksNumeric(c.text)) && !texts.some((c) => parseDate(c.text));
    };
    let base = continued ? null : t.rows[headerRow];
    /* the line above the header when the header is the second line
       (FDUS: "Portfolio Company | Variable Index | Rate | Investment |
       Principal | Fair | Percent of" over "Investment Type | Industry |
       Spread / Floor | Cash/PIK | Date | Maturity | Amount | Cost |
       Value | Net Assets") */
    if (!continued && headerRow > 0 && headerish(t.rows[headerRow - 1])) {
      const cells = mergeHeaderRows(t.rows[headerRow - 1], base);
      const merged = mapHeader(cells);
      if (merged && merged.keys.length >= header.keys.length) { header = merged; base = cells; }
    }
    while (!continued && firstData < t.rows.length) {
      const r = t.rows[firstData];
      if (headerish(r)) {
        const cells = mergeHeaderRows(base, r);
        const merged = mapHeader(cells);
        if (merged && merged.keys.length >= header.keys.length) { header = merged; base = cells; }
        firstData++;
      } else break;
    }
    for (const c of header.cols) headers.set(c.name, c.key);
    const date = continued ? lastDate : (headingDate(t.before) || lastDate);
    lastDate = date;
    const at = src.indexOf(t.html, cursor);
    cursor = at + t.html.length;
    lastTable = ti;
    pages.push({ table: ti, t, header, firstData, date, at, end: cursor, continued,
      scale: continued ? pages[pages.length - 1].scale : scaleOf(t.before + " " + t.rows.slice(0, firstData).map((r) => r.map((c) => c.text).join(" ")).join(" ")) });
  }
  if (!pages.length) return { period: null, periods: [], tables: 0, scale: 1, rows: [], subtotals: 0, subtotalRows: [], totals: null, footnotes: {}, headers: {}, notes: ["no table resolved as a schedule"] };

  /* schedules: consecutive pages under one heading date; a page with
     no date continues the one before; a "Total Investments" row ends
     one when no date separates them */
  const schedules = [];
  let cur = null, closed = false;
  for (const p of pages) {
    const startNew = !cur || (p.date && cur.date && p.date !== cur.date) || (closed && !p.date && !cur.date);
    if (startNew) { cur = { date: p.date, pages: [] }; schedules.push(cur); closed = false; }
    if (!cur.date && p.date) cur.date = p.date;
    cur.pages.push(p);
    for (const r of p.t.rows) {
      const label = r.find((c) => c.text && !looksNumeric(c.text));
      if (label && /^total (investment portfolio|investments|portfolio investments)\b/i.test(label.text) && r.some((c) => looksNumeric(c.text))) closed = true;
    }
  }
  const periods = [...new Set(schedules.map((s) => s.date).filter(Boolean))].sort();
  let chosen = period ? schedules.find((s) => s.date === period) : null;
  if (!chosen) {
    if (period) notes.push(`no schedule headed ${period}; ${periods.length ? "found " + periods.join(", ") : "no heading date found"}`);
    const dated = schedules.filter((s) => s.date);
    chosen = dated.length ? dated.reduce((a, b) => (b.date > a.date ? b : a)) : schedules[0];
  }

  /* the schedule's footnote block: bodies after its last page and
     before the next schedule's first page; else the nearest before */
  const bodies = findFootnotes(src);
  const lastEnd = chosen.pages[chosen.pages.length - 1].end;
  /* the block ends where the markers restart at (1) — the comparative
     schedule's own footnotes — or at the next DATED schedule's first
     page. A footnote whose body carries a table of its own (ARCC's (4)
     and (5), the affiliate transaction tables, 10-Q 0001628280-26-
     050307) reads as an undated page, and cutting there would lose
     every footnote after it: (5), the control list, sat past that cut. */
  const next = schedules.find((s) => s.pages[0].at > lastEnd && s.date && s.date !== chosen.date);
  const limit = next ? next.pages[0].at : Infinity;
  let block = bodies.filter((f) => f.at >= lastEnd && f.at < limit);
  /* a restart is a second "(1)" with a "(2)" close behind it — not a
     lettered sub-list (GBDC's (a)…(m) contract notes between (1) and
     (2)) and not a stray "(1)" in a sentence */
  const restarts = block.map((f, i) => (f.marker === "(1)" && block.slice(i + 1, i + 4).some((g) => g.marker === "(2)") ? i : -1)).filter((i) => i >= 0);
  if (restarts.length >= 2) block = block.slice(0, restarts[1]);
  if (!block.length) block = bodies.filter((f) => f.at < chosen.pages[0].at).slice(-40);
  const footnotes = {};
  for (const f of block) if (!(f.marker in footnotes)) footnotes[f.marker] = f.text;

  /* rows */
  const rows = [];
  let subtotals = 0, totals = null, wrapped = 0;
  const subtotalRows = [];
  const section = { lien: null, aff: null, industry: null };
  let lastIssuer = null;
  /* what an issuer line carried beside the name: its footnote markers
     (OFS prints "(6)" for non-accrual on the issuer line, above the
     tranches) and the industry printed in the second cell (OFS, FDUS) */
  let lastIssuerMarkers = [], lastIssuerIndustry = null;
  const setIssuer = (text, industryText = null) => {
    lastIssuer = withoutMarkers(text);
    lastIssuerMarkers = markersOf(text.slice(lastIssuer.length));
    /* a location beside the name ("Houston, TX": PIAC prints the
       city and state in the second cell) is not an industry */
    lastIssuerIndustry = industryText && !looksNumeric(industryText) && !parseDate(industryText) && !LOCATION_RE.test(withoutMarkers(industryText)) ? withoutMarkers(industryText) : null;
  };
  /* a filer that closes each industry with a "Total <industry>" line
     (MFIC: "Aerospace & Defense" ... "Total Aerospace & Defense") prints
     its company groups as lone lines too ("Beaufort", "Sperry
     Acquisition, LLC") between the industry line and its total; when
     three or more lone lines have such a total, a lone line without one
     is a group header above its companies, never an industry section */
  const normText = (t) => withoutMarkers(String(t || "")).toLowerCase().replace(/\s+/g, " ").trim();
  const loneTexts = new Set(), totalTexts = new Set();
  for (const p of chosen.pages) {
    for (const r of p.t.rows) {
      const texts = r.filter((c) => c.text);
      if (!texts.length) continue;
      const numeric = texts.filter((c) => looksNumeric(c.text));
      if (texts.length === 1 && !numeric.length) {
        /* industry lines only: BXSL closes its lien sections with
           "Total First Lien Debt" and prints no industry totals, which
           must not switch the rule on */
        const sec = classifySection(texts[0].text);
        if (sec.industry && !sec.lien && !sec.aff && !sec.ignore) loneTexts.add(normText(texts[0].text));
      }
      const tm = /^total\s+(.+)$/i.exec(texts[0].text.trim());
      if (tm && !/^(investments?|portfolio|net assets)/i.test(tm[1])) totalTexts.add(normText(tm[1]));
    }
  }
  const industriesWithTotals = [...loneTexts].filter((t) => totalTexts.has(t));
  const groupLinesLikely = industriesWithTotals.length >= 3;
  let scale = 1;
  let pageNo = 0;
  for (const p of chosen.pages) {
    pageNo++;
    if (p.scale !== 1) scale = p.scale;
    const header = p.header;
    const keyed = new Set(header.keys);
    /* NMFC's "Portfolio Company, Location and Industry" column: the
       company on its own line, the industry in the same column on each
       tranche row beneath it. MFIC's "Industry/Company" column is the
       other way round — the industry on its own line, the company on
       each row — which is the ordinary layout (a lone line that names
       no lien or affiliation is a section industry), so only the
       company-first form takes this path. */
    const issuerCol = header.cols.find((c) => c.key === "issuer");
    const issuerHoldsIndustry = !!issuerCol && /^portfolio compan(?:y|ies).*industry/.test(issuerCol.name);
    const rowHtml = rowHtmlOf(p.t.html);
    const laid = p.t.rows.map((r) => layRow(r, header));
    for (let ri = p.firstData; ri < p.t.rows.length; ri++) {
      const r = p.t.rows[ri];
      /* a footnote marker printed in a cell of its own, never appended to
         the name it belongs to (MAIN's "AAC Holdings, Inc." | "(11)" |
         "Substance Abuse Treatment Service Provider" in three cells, the
         marker sitting in the unlabeled gap between the issuer and
         business-description columns) must not be counted as a second or
         third piece of content when a row's shape is read: it made a
         three-cell issuer-plus-industry line miss every issuer-detection
         branch below, so the industry cell was skipped, `lastIssuer`
         never advanced past the company before it, and every tranche
         under the real issuer (AAC Holdings' Secured Debt 4 and 5, both
         non-accrual) inherited that company's name instead — joining
         nothing, and reporting as an unmatched non-accrual row under the
         wrong issuer. The marker itself is still read: layRow(r, header)
         above runs over the untouched row, so a row of nothing but
         markers still becomes the "footnotes" column wherever it sits. */
      const texts = r.filter((c) => c.text && !MARKERS_ONLY_RE.test(c.text));
      if (!texts.length) continue;
      const cells = laid[ri];
      const numeric = texts.filter((c) => looksNumeric(c.text));
      const label = texts.find((c) => !looksNumeric(c.text) && !/^[$%]$/.test(c.text));

      /* a repeated header inside the page */
      if (mapHeader(r)) continue;

      /* one-cell rows: a section, or an issuer named on its own line
         above its tranches */
      if (texts.length === 1 && !numeric.length && label) {
        const nextRow = p.t.rows[ri + 1];
        const nextCells = nextRow ? laid[ri + 1] : null;
        const nextIsTranche = nextCells && (!nextCells.issuer || issuerHoldsIndustry) && (nextCells.cost != null || nextCells.fv != null) &&
          (nextCells.type || nextCells.maturity || nextCells.rate || nextCells.spread);
        const sec = classifySection(label.text);
        if (nextIsTranche && !sec.lien && !sec.aff) { setIssuer(label.text); continue; }
        if (sec.affOnly) { section.aff = sec.aff; if (!sec.continued) section.industry = null; continue; }
        if (sec.lien) {
          section.lien = sec.lien;
          section.aff = sec.aff || (sec.continued ? section.aff : null);
          if (!sec.continued) section.industry = null;
          continue;
        }
        /* under NMFC's layout a lone line that is neither section nor
           affiliation is the next company (its industry sits on the
           tranche rows), whatever follows it */
        if (issuerHoldsIndustry) { setIssuer(label.text); continue; }
        /* a lone line that ends in a legal form is a company printed
           above its tranches even when the tranche rows repeat its name
           in the issuer cell (MFIC's "Sperry Acquisition, LLC" under
           "Aerospace & Defense"): never an industry section */
        if (sec.industry && COMPANY_TAIL_RE.test(withoutMarkers(sec.industry))) { setIssuer(label.text); continue; }
        if (sec.industry && groupLinesLikely && !totalTexts.has(normText(label.text)) && section.industry) { setIssuer(label.text); continue; }
        if (sec.industry) { section.industry = sec.industry; continue; }
        continue;
      }

      /* subtotals: numbers with no name, or a name that says Total */
      if (!label || TOTAL_RE.test(label.text)) {
        if (numeric.length) {
          subtotals++;
          const t = { label: label ? label.text : null, cost: money(cells.cost) != null ? roundUnit(money(cells.cost) * scale) : null,
            fv: money(cells.fv) != null ? roundUnit(money(cells.fv) * scale) : null, page: pageNo, after: rows.length };
          subtotalRows.push(t);
          if (label && /^total (investment portfolio|investments|portfolio investments)\b/i.test(label.text) && !/cash/i.test(label.text)) totals = t;
        }
        continue;
      }

      const cost = money(cells.cost), fv = money(cells.fv);
      if (cost == null && fv == null) {
        /* a name with no figures: an issuer line (with the industry in
           a second cell, OFS and FDUS), or a section the filer laid
           over several cells */
        if (!numeric.length && texts.length <= 2) {
          const sec = classifySection(label.text);
          if (sec.lien || sec.aff) {
            if (sec.lien) section.lien = sec.lien;
            if (sec.aff) section.aff = sec.aff;
            if (!sec.continued) section.industry = null;
          } else {
            const other = texts.find((c) => c !== label);
            setIssuer(label.text, other ? other.text : null);
          }
        }
        continue;
      }

      let issuerText = cells.issuer || "";
      let typeText = cells.type || null;
      let rowIndustry = null;
      let fromIssuerLine = false;
      if (issuerHoldsIndustry && issuerText && lastIssuer) {
        /* NMFC: the first column of a tranche row is the industry */
        rowIndustry = withoutMarkers(issuerText);
        issuerText = "";
      } else if (issuerText && lastIssuer && !typeText && startsAsInstrument(withoutMarkers(issuerText))) {
        /* OFS, FDUS: "First Lien Debt (6) (11) (15)" in the company
           column is the tranche under the company line above it */
        typeText = issuerText;
        issuerText = "";
      }
      const issuer = issuerText ? withoutMarkers(issuerText) : lastIssuer;
      if (!issuer) { notes.push(`page ${pageNo}: a row with figures and no issuer was skipped`); continue; }
      if (issuerText) setIssuer(issuerText); else fromIssuerLine = true;
      /* a numbered marker printed on the rate side of the row — NMFC
         hangs its non-accrual "(17)" on the reference cell, "SOFR(M)(17)*"
         (10-Q 0001496099-26-000029) — counts as the row's; only
         numbered ones there, since "(M)" is the tenor, not a footnote */
      const rateSideMarkers = ["base", "spread", "rate", "floor", "pik", "maturity", "acquired", "industry"]
        .flatMap((k) => (keyed.has(k) && cells[k] ? markersOf(cells[k]) : []))
        .filter((mk) => /^\(\d{1,2}\)$/.test(mk));
      const markers = [...new Set([...markersOf(cells.footnotes || ""), ...markersOf(issuerText.slice(issuer.length)), ...markersOf(typeText || ""),
        ...rateSideMarkers, ...(fromIssuerLine ? lastIssuerMarkers : [])])];
      const rates = parseRateText(cells.spread, cells.rate);
      if (!rates.base && keyed.has("base") && cells.base) rates.base = baseOf(cells.base);
      if (keyed.has("floor") && cells.floor) rates.floor = percent(cells.floor);
      if (keyed.has("pik") && cells.pik) rates.pik = percent(cells.pik);
      const mat = keyed.has("maturity") ? parseDate(cells.maturity) : null;
      const acq = keyed.has("acquired") ? parseDate(cells.acquired) : null;
      const isDebt = !!(rates.spread != null || rates.rate != null || mat || /\b(loan|note|bond|debt|revolver|term|delayed draw|credit)/i.test(typeText || section.lien || ""));
      const principalRaw = money(cells.principal);
      const units = principalRaw != null && !isDebt && !/\$/.test(cells.principal || "") && !!(section.lien && lienClass(section.lien) === "equity" || /unit|share|warrant|stock|equity|interest/i.test(typeText || section.lien || ""));
      /* a marker resolves to its own schedule's block; a sentence that
         names the comparative date marks nothing here */
      const nonAccrualByNote = markers.some((mk) => marksNonAccrualAt(footnotes[mk], chosen.date));
      const nonAccrualByText = NON_ACCRUAL_RE.test(issuerText) || NON_ACCRUAL_RE.test(typeText || "");
      const pikNonAccrual = !nonAccrualByNote && markers.some((mk) => isPikNonAccrual(footnotes[mk]));
      /* a printed row the filer's renderer broke into two <tr>s: the
         second carries the same cost and fair value with no name, type,
         rate, date or principal of its own (OBDC's equity pages,
         "382 | 2,061 | - | %" under Amergin Asset Management's row in
         10-Q 0001655888-26-000056). It is the same position, not a
         second one; counted, never kept. */
      const prev = rows[rows.length - 1];
      if (prev && !issuerText && !typeText && rates.rate == null && rates.spread == null && !mat && principalRaw == null &&
          prev.issuer === issuer && prev.page === pageNo && cost != null && fv != null &&
          prev.cost === roundUnit(cost * scale) && prev.fv === roundUnit(fv * scale)) {
        wrapped++;
        continue;
      }
      rows.push({
        issuer,
        type: typeText ? withoutMarkers(typeText) : null,
        section: { lien: section.lien, lienClass: section.lien ? lienClass(section.lien) : null, aff: section.aff, industry: section.industry },
        industry: rowIndustry || ((keyed.has("industry") && cells.industry) ? cells.industry : null) || (fromIssuerLine ? lastIssuerIndustry : null) || section.industry,
        footnotes: markers,
        /* the class a footnote states for this row, where the schedule
           has no affiliation sections to say it */
        affNote: section.aff ? null : affiliationOfMarkers(markers, footnotes),
        nonAccrual: nonAccrualByNote || nonAccrualByText,
        ...(pikNonAccrual ? { pikNonAccrual: true } : {}),
        base: rates.base, spread: rates.spread, rate: rates.rate, pik: rates.pik, floor: rates.floor,
        acquired: acq ? acq.iso : null,
        maturity: mat ? mat.iso : null,
        maturityPrecision: mat ? mat.precision : null,
        principal: principalRaw == null ? null : roundUnit(units ? principalRaw : principalRaw * scale),
        currency: currencyOf(cells.principal),
        units,
        cost: cost == null ? null : roundUnit(cost * scale),
        fv: fv == null ? null : roundUnit(fv * scale),
        pctNav: keyed.has("pctNav") && cells.pctNav ? percent(cells.pctNav) : null,
        ctx: contextOf(rowHtml[ri] || ""),
        page: pageNo,
        raw: { spread: cells.spread || null, rate: cells.rate || null, maturity: cells.maturity || null, acquired: cells.acquired || null },
      });
    }
  }
  const count = (cls) => rows.filter((r) => r.section.lienClass === cls).length;
  if (!rows.some((r) => r.section.lien)) notes.push("no lien-type section rows: lien comes from the type column or the data set");
  if (count("equity") === 0 && rows.length) notes.push("no equity section seen");
  if (wrapped) notes.push(`${wrapped} printed row(s) broken over two lines were read once`);
  return {
    period: chosen.date, periods, tables: chosen.pages.length, scale,
    rows, subtotals, subtotalRows, totals, footnotes,
    headers: Object.fromEntries(headers), notes,
  };
}

/* ---------- the join ---------- */

const within = (a, b, tol) => a != null && b != null && (a === b || Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b)));

/**
 * Members of the tagged schedule (data set or instance: { id, issuer,
 * principal, cost, fv, ... }) matched to table rows: by issuer key and
 * principal within 0.5%, then key and cost within 0.5%, then key alone
 * where one member and one row remain under it. Each side is used
 * once. Rows the members do not claim come back whole in
 * unmatchedRows, non-accrual ones first, so a footnote is never lost
 * to a name the instance spells differently.
 */
export function joinHoldings(members, tableRows, { tolerance = 0.005 } = {}) {
  const ms = (members || []).map((m, i) => ({ i, m, key: issuerKey(m.issuer || splitMember(m.id || "").issuer), used: false }));
  const rs = (tableRows || []).map((r, i) => ({ i, r, key: issuerKey(r.issuer), used: false }));
  const byKey = new Map();
  for (const r of rs) { if (!byKey.has(r.key)) byKey.set(r.key, []); byKey.get(r.key).push(r); }
  const matched = [];
  const stages = { principal: 0, cost: 0, name: 0 };
  const pass = (stage, test) => {
    for (const m of ms) {
      if (m.used) continue;
      const cands = (byKey.get(m.key) || []).filter((r) => !r.used);
      if (!cands.length) continue;
      const hit = test(m, cands);
      if (hit) { m.used = hit.used = true; matched.push({ member: m.m, row: hit.r, stage }); stages[stage]++; }
    }
  };
  pass("principal", (m, cands) => cands.find((r) => within(m.m.principal, r.r.principal, tolerance)));
  pass("cost", (m, cands) => cands.find((r) => within(m.m.cost, r.r.cost, tolerance)));
  pass("name", (m, cands) => {
    const openMembers = ms.filter((x) => !x.used && x.key === m.key);
    return openMembers.length === 1 && cands.length === 1 ? cands[0] : null;
  });
  const unmatchedRows = rs.filter((r) => !r.used).map((r) => r.r)
    .sort((a, b) => Number(!!b.nonAccrual) - Number(!!a.nonAccrual));
  const unmatchedMembers = ms.filter((m) => !m.used).map((m) => m.m);
  return {
    matched, unmatchedRows, unmatchedMembers, stages,
    rate: ms.length ? matched.length / ms.length : 0,
    nonAccrualUnmatched: unmatchedRows.filter((r) => r.nonAccrual).length,
  };
}
