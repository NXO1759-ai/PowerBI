/**
 * soi-parse.mjs — the schedule of investments, one holding per row.
 *
 * Two sources, one normalizer, one gate (blueprint 7.3):
 *
 *   readSoiDataset   the SEC's monthly BDC data set (YYYY_MM_bdc.zip):
 *                    soi.tsv streamed from the archive, one row per
 *                    dimensioned fact, the covered filers kept, the row
 *                    rule applied;
 *   readNumFacts     datasets/num.tsv streamed once for the tags a
 *                    caller names — the per-loan unfunded commitments
 *                    (InvestmentCompanyFinancialCommitmentToInvesteeFutureAmount
 *                    on an InvestmentIdentifierAxis member) and the
 *                    filing's own InvestmentOwnedAtCost / AtFairValue
 *                    totals, which the data set carries beside the rows;
 *   parseSoiInstance the filing's inline-XBRL instance (bxsl-20260630_htm.xml),
 *                    for a filing not yet in a monthly zip: the typed
 *                    InvestmentIdentifierAxis members at the period-end
 *                    instant, the same fields, unitRef kept verbatim;
 *   normalizeRow     either source's record to the holding shape;
 *   reconcile        Σ cost and Σ fair value against the tagged totals,
 *                    within 0.5%, or the filing is refused.
 *
 * The row rule, verified on the July 2026 file: keep a row whose
 * identifier is non-empty, whose ddate is the filing's own period and
 * which carries BOTH a cost and a fair value. A fair-value-only row is
 * an issuer subtotal or a summary member (ARCC: Ivy Hill Asset
 * Management $2,842.8M, Senior Direct Lending Program $1,153.7M,
 * "Largest Portfolio Company Investment", "Top Five ..."), not a loan.
 * Two more subtotal shapes turned up in the same file and are dropped
 * by the same rule: a row whose identifier segment reads "Total <name>"
 * or "Sub Total ..." and carries both values (Hercules: "Debt
 * Investments, Application Software, Total Tipalti Solutions Ltd.",
 * ten rows worth $433.7M at cost; Saratoga's "Total Employee
 * Collaboration Software"), and a money-market or cash-equivalent line
 * that a filer lists inside its schedule but outside its
 * InvestmentOwnedAtCost (Hercules: "Investment Fund, Cash & Cash
 * Equivalent, GS Financial Square Government Fund", $22.3M). A row
 * dimensioned on a Legal Entity or Consolidated Entities axis is a
 * consolidated vehicle's own holding (Saratoga's CLO, 230 rows) and is
 * dropped when the filing's other rows carry no such axis. Every drop
 * is counted by kind and the gate reports the count. Saratoga still
 * fails the gate after all of that (Σ cost 4.6% under its tag: sixteen
 * of its rows carry a cost and no fair value), which is the designed
 * outcome — a refusal recorded, no holdings file written.
 *
 * The holding shape is contract H1 of the build plan with these
 * additions, each there because a source needed it: `name` (the
 * readable issuer beside the `issuer` match key), `facility`
 * (revolver | delayed draw | term loan | null, which the unfunded join
 * and the maturity wall read), `units` (unitRef per numeric fact,
 * verbatim, instance path only), src.unf ("member" | "issuer" | null,
 * how a commitment joined), and the value "id" in src.ind, src.mat and
 * src.na where the industry, maturity or non-accrual mark was read from
 * the identifier text rather than an axis or a table. A maturity read
 * as "May 2028" is stored as that month's last day.
 *
 * Cost and fair value sit in the columns "Adjusted cost basis" and
 * "Initial fair value of Investment"; the columns named "Investment
 * Owned, Cost" and "Investment Owned, Fair Value" are empty in the July
 * file and are read only as a fallback should a later file fill them.
 * Floating-rate share is computed from the presence of a spread fact,
 * never from the rate-type column, which only OFS fills.
 *
 * Identifier text is the filer's own and its shape varies: ARCC and
 * BXSL write "Issuer | instrument N" or "Issuer N | affiliation", Golub
 * "Issuer, One stop 1", Hercules "Debt Investments, industry, Issuer,
 * Senior Secured, May 2028, ...", Saratoga "Affiliation - pct - Issuer -
 * industry - instrument", OFS a run-on "Portfolio Company ... Issuer
 * FLD (Revolver) Industry ... IR 9.63% SAI SOFR+ 5.75% ...". The
 * splitter below reads each of those shapes into issuer, instrument,
 * affiliation and industry, keeps the raw text on every holding, and
 * never guesses where it cannot parse (issuer falls back to the whole
 * identifier). The HTML-table path of the holdings build is what
 * corrects the residue.
 *
 * Zero dependencies. Nothing here touches the network.
 */

import { basename } from "node:path";
import { readCentralDirectory, streamMember, readLines } from "./zip-stream.mjs";
import { LIEN, lienClass, isVehicle, classifyAffiliation } from "./bdc-concepts.mjs";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const round0 = (v) => (isNum(v) ? Math.round(v) : null);
const round4 = (v) => (isNum(v) ? Math.round(v * 10000) / 10000 : null);
const num = (s) => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/* ---------- the data set's columns ---------- */

/* soi.tsv: 60 columns, read by header name, never by position. */
export const SOI_COLUMNS = {
  adsh: "adsh", cik: "cik", name: "name", ddate: "ddate", form: "form", filed: "filed",
  period: "period", inlineurl: "inlineurl",
  industry: "Industry Sector Axis",
  id: "Investment, Identifier Axis",
  affiliation: "Investment, Issuer Affiliation Axis",
  type: "Investment Type Axis",
  rate: "Investment Interest Rate",
  spread: "Investment, Basis Spread, Variable Rate",
  maturity: "Investment Maturity Date",
  principal: "Investment Owned, Balance, Principal Amount",
  costStandard: "Investment Owned, Cost",
  fvStandard: "Investment Owned, Fair Value",
  pctNav: "Investment Owned, Net Assets, Percentage",
  cost: "Adjusted cost basis",
  fv: "Initial fair value of Investment",
  cashEquivalents: "Cash equivalents",
  shares: "Investment shares",
  acquired: "Investment, Acquisition Date",
  floor: "Investment, Interest Rate, Floor",
  cashRate: "Investment, Interest Rate, Paid in Cash",
  pik: "Investment, Interest Rate, Paid in Kind",
  rateType: "Investment, Variable Interest Rate, Type [Extensible Enumeration]",
  legalEntity: "Legal Entity Axis",
  consolidatedEntities: "Consolidated Entities Axis",
  /* an unconsolidated joint venture's own schedule, tagged beside the
     filer's in the August 2026 file (BCSF 202 rows, NMFC 243, OCSL 292,
     CSWC 15, FRBP 2) */
  nonconsolidatedSubsidiary: "Investment Company, Nonconsolidated Subsidiary Axis",
};

export const UNFUNDED_TAG = "InvestmentCompanyFinancialCommitmentToInvesteeFutureAmount";
export const COST_TAG = "InvestmentOwnedAtCost";
export const FV_TAG = "InvestmentOwnedAtFairValue";
export const GATE_TOLERANCE = 0.005;

/* num.tsv and sub.tsv write dates as YYYYMMDD; soi.tsv as YYYY-MM-DD. */
export const isoDate = (s) => {
  const t = String(s || "").trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return t || null;
};

/* ---------- text ---------- */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : m));
}
const clean = (s) => decodeEntities(s).replace(/\s+/g, " ").trim();

/* "bxsl:DebtSecuritiesFirstLienMember" -> "Debt Securities First Lien";
   "Diversified Financial Services [Member]" -> "Diversified Financial Services". */
export function memberLabel(text) {
  let t = clean(text);
  if (!t) return null;
  t = t.replace(/^[a-z0-9-]+:/i, "").replace(/\s*\[Member\]$/i, "").replace(/(Segment)?Member$/, "");
  if (!/\s/.test(t) && /[a-z][A-Z]/.test(t)) {
    t = t.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
  }
  return t.trim() || null;
}

/* ---------- affiliation ---------- */

/* InvestmentIssuerAffiliationAxis members and the affiliation tails of
   identifier text, in every spelling seen: "Non-Affiliated Issuer",
   "Non - Affiliated Issuer", "Non-Controlled Affiliated", "Investment,
   Affiliated Issuer, Noncontrolled", "Investment, Unaffiliated Issuer",
   "Control investments", "Non-control/Non-affiliate investments",
   "InvestmentAffiliatedIssuerControlledMember". bdc-concepts'
   classifyAffiliation reads "Non-Affiliated Issuer" as affiliated
   (the word is there), so the non-affiliated test runs first here. */
export function affiliationClass(text) {
  const t = memberLabel(text);
  if (!t) return null;
  /* one vocabulary: bdc-concepts' classifyAffiliation reads the same
     spellings for the HTML sections and the member texts */
  return classifyAffiliation(t);
}

/* The affiliation heading an identifier opens with, when the axis
   itself is blank (FDUS): "Non-control/Non-affiliate Investments
   Barefoot Mosquito ...", "Affiliate Investments CP Communications,
   LLC ...", "Non-Controlled/Non-Affiliated Investments ...". Anchored
   to the start, so a company whose own name happens to contain
   "affiliate" is never misread. */
export const LEADING_AFF_RE =
  /^(?:non[- ]?control(?:led)?\s*[\/,]?\s*(?:non[- ]?)?affiliat(?:e|ed)|control(?:led)?(?:\s*[\/,]?\s*affiliat(?:e|ed))?|affiliat(?:e|ed)|unaffiliated)\s+(?:affiliate\s+)?(?:portfolio companies|investments?|issuers?)\b/i;

/* ---------- identifiers ---------- */

const LEGAL_SUFFIX = /^(?:llc|l\.l\.c\.|inc\.?|incorporated|l\.?p\.?|llp|ltd\.?|limited|corp\.?|corporation|co\.?|company|plc|s\.?a\.?|ag|gmbh|b\.?v\.?|n\.?v\.?|c\.?v\.?|s\.?à\s?r\.?l\.?|s\.?a\.?r\.?l\.?|oy|ab|as|se|pty\.?)$/i;
const ENTITY_WORDS = /\b(?:LLC|L\.L\.C\.|Inc\.?|Incorporated|L\.?P\.?|LLP|Ltd\.?|Limited|Corp\.?|Corporation|Co\.|Company|PLC|S\.A\.?|AG|GmbH|B\.V\.?|N\.V\.?|C\.V\.?|S\.à r\.l\.|Oy|AB|SE|Holdings?|Holdco|Bidco|Midco|Topco|Buyer|Parent|Group|Partners|Acquisition|Intermediate|Capital|Technologies|Enterprises|Industries|Ventures|Systems|Solutions|Services|Brands|Products)\b/;
const INSTRUMENT_RE = /\b(?:loans?|revolver|revolving|delayed[- ]draw|term loan|first[- ]lien|second[- ]lien|1st lien|2nd lien|senior secured|senior|secured|unsecured|subordinated|mezzanine|one stop|unitranche|last[- ]out|notes?|bonds?|debentures?|debt|equity|common|preferred|warrants?|units?|shares?|stock|interests?|membership|class [a-z0-9-]+|series [a-z0-9-]+|certificates?|clo|structured|convertible|facility|line of credit|pik|options?|vehicles?|funds?)\b/i;
const MONTH_YEAR_RE = /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i;
const RATE_TEXT_RE = /\b(?:SOFR|LIBOR|Prime|EURIBOR|SONIA|CDOR|Floor rate|Cap rate|PIK Interest|Exit Fee)\b|\d+(?:\.\d+)?\s?%/i;
const SUBTOTAL_RE = /^(?:sub[- ]?)?total\b/i;
const AGGREGATE_ID_RE = /^(?:largest portfolio company investment|top (?:five|ten|5|10) (?:largest )?portfolio company investments?|other aggregated investments?|investment (?:one|two|three|four|five|six|seven|eight|nine|ten))$/i;
const CASH_RE = /\bcash (?:&|and) cash equivalents?\b|\bmoney market\b|\btreasury (?:fund|portfolio|bill)\b|\bgovernment (?:money market )?fund\b|\bcash equivalents?\b/i;
/* CLO, CMBS and asset-backed paper. A bare "ABS" is not in the list: it
   is a word in borrowers' names (ARCC's "Gestion ABS Bidco Inc."). */
const STRUCTURED_RE = /structured finance|\bclo\b|\bcmbs\b|asset[- ]backed|collateralized/i;
const SENIOR_LOAN_RE = /first[- ]lien|second[- ]lien|senior secured|unitranche|one stop/i;
const DEBT_WORDS_RE = /\b(?:loans?|revolver|revolving|delayed[- ]draw|term loan|lien|senior secured|secured|unsecured|subordinated|mezzanine|one stop|unitranche|last[- ]out|notes?|bonds?|debentures?|debt|facility|line of credit|convertible)\b/i;
const EQUITY_WORDS_RE = /\b(?:equity|common|preferred|warrants?|units?|shares?|stock|interests?|membership|options?)\b/i;

/* OFS's run-on identifiers abbreviate the instrument. */
const OFS_CODES = { FLD: "First Lien Debt", SLD: "Second Lien Debt", SN: "Subordinated Note", MD: "Mezzanine Debt", CE: "Common Equity", PE: "Preferred Equity" };

/* Split on ", " but keep "Marathon Health, LLC" together: a part that is
   a bare legal suffix belongs to the part before it. */
function commaParts(text) {
  const out = [];
  for (const p of text.split(/,\s+/)) {
    const t = p.trim();
    if (!t) continue;
    if (out.length && LEGAL_SUFFIX.test(t)) out[out.length - 1] += ", " + t;
    else out.push(t);
  }
  return out;
}

/* The match key: lower case, entities decoded, parentheticals and
   punctuation gone, "&" as "and", legal suffixes stripped from the end.
   "Corfin Holdings, Inc. 1" -> "corfin holdings"; "L&S Mechanical
   Acquisition, LLC" -> "l and s mechanical acquisition". */
/* A tranche label a filer hangs on the issuer name with a dash:
   PNNT's "ACP Avenu Buyer, LLC - Unfunded Revolver" and "- Funded
   Term Loan" name one borrower three times. */
const TRANCHE_SUFFIX_RE = /\s+[-–—]\s*(?:un)?funded\b[^|]*$/i;

/* The printed footnote markers a name can trail: GBDC's "Blue River
   Pet Care, LLC+" (its non-qualifying-asset mark), "*", "†", "#". */
export function stripNameMarkers(name) {
  return String(name == null ? "" : name).replace(/[\s*+†‡#^]+$/, "").replace(/(\s*\((?:\d{1,2}|[a-z]{1,2})\))+\s*$/i, "").trim();
}

export function normalizeIssuer(name) {
  let s = stripNameMarkers(clean(name)).toLowerCase();
  s = s.replace(TRANCHE_SUFFIX_RE, "");
  /* a tranche number after the legal suffix: "Corfin Holdings, Inc. 1" */
  s = s.replace(/^(.*\b(?:inc|llc|l\.?p|ltd|corp|co|plc|limited|corporation|company|ag|gmbh|oy|ab|s\.?a|b\.?v|n\.?v)\.?)\s+\d{1,2}$/i, "$1");
  s = s.replace(/\([^()]*\)/g, " ").replace(/&/g, " and ");
  s = s.replace(/[.,'’"`/\\:;()\[\]{}-]+/g, " ").replace(/\s+/g, " ").trim();
  for (;;) {
    const before = s;
    s = s.replace(/\s+(?:llc|l l c|inc|incorporated|lp|l p|llp|ltd|limited|corp|corporation|co|company|plc|sa|s a|ag|gmbh|bv|b v|nv|n v|cv|c v|sarl|s a r l|s à r l|oy|ab|as|se|pty)$/i, "");
    if (s === before) break;
  }
  return s.trim();
}

/* The instrument's shape, where the text names one. */
export function facilityOf(text) {
  const s = clean(text).toLowerCase();
  if (!s) return null;
  if (/revolv|\(r\)|\brcf\b/.test(s)) return "revolver";
  if (/delayed[- ]draw|\bddtl\b|\(dd\)/.test(s)) return "delayed draw";
  if (/term loan|\btl\b/.test(s)) return "term loan";
  return null;
}

/**
 * Read a filer's identifier into its parts:
 * { issuer, instrument, affText, industry, tranche, maturityText, baseText }.
 * The raw text always survives on the holding as `id`; the splitter
 * returns the whole identifier as the issuer when no shape matches.
 */
export function splitIdentifier(id) {
  const raw = clean(id);
  const out = { issuer: raw, instrument: null, affText: null, industry: null, tranche: null, maturityText: null, baseText: null };
  if (!raw) return out;

  if (/\s\|\s|\s\|$|^\|\s/.test(raw)) {
    /* "Issuer N | affiliation", "Issuer | instrument N",
       "Issuer - Common Equity | | Non - Affiliated Issuer" */
    const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
    let issuer = parts[0] || raw;
    const rest = parts.slice(1);
    if (rest.length && affiliationClass(rest[rest.length - 1])) out.affText = rest.pop();
    let instrument = rest.length ? rest.join(" | ") : null;
    const dash = /^(.*?\S)\s+-\s*((?:additional |vehicle |class |series |common |preferred |(?:un)?funded |units?\b|shares?\b|warrants?\b|equity\b|interests?\b|membership\b|stock\b|notes?\b|loans?\b|term loan\b|term debt\b|revolver\b|delayed draw\b|line of credit\b).*)$/i.exec(issuer);
    if (dash) { issuer = dash[1]; instrument = instrument ? `${dash[2]} | ${instrument}` : dash[2]; }
    out.issuer = issuer;
    out.instrument = instrument;
  } else if (/^Portfolio Company\b/i.test(raw)) {
    /* OFS: "Portfolio Company Investment Type NCNA Inv. Debt and Equity Inv.
       Honor HN Buyer Inc. FLD (Revolver) Industry Services ... IR 9.63%
       SAI SOFR+5.75% IAD 10/15/2021 Maturity 10/15/2027 One" */
    let s = raw.replace(/^Portfolio Company\s+/i, "")
      .replace(/^Investment Type\s+[A-Z]+\s+/i, "")
      .replace(/^(?:Inv\.\s+)?(?:Debt and Equity Inv\.\s+|Structured Finance Securities\s+|I\s+)?/i, "");
    const code = /\s(FLD|SLD|SN|MD|CE|PE|Warrants|Unsecured|First Lien Debt|Second Lien Debt)\b/.exec(s);
    if (code) {
      out.issuer = s.slice(0, code.index).replace(/^Investment Type\s+/i, "").trim();
      let inst = s.slice(code.index + 1);
      const cut = inst.search(/\s(?:Industry|IR|IAD|SAI|SPI|Maturity)\s/);
      if (cut > 0) inst = inst.slice(0, cut);
      out.instrument = inst.replace(/\b(FLD|SLD|SN|MD|CE|PE)\b/g, (m) => OFS_CODES[m]).trim();
      const ind = /\sIndustry\s+(.*?)(?=\s(?:IR|IAD|SAI|SPI|Maturity)\s|$)/.exec(s);
      if (ind && ind[1].trim()) out.industry = ind[1].trim();
      const mat = /\sMaturity\s+(?:\d+\s+)?(\d{1,2}\/\d{1,2}\/\d{4})/.exec(s);
      if (mat) out.maturityText = mat[1];
      const base = /\b(SOFR|LIBOR|Prime|EURIBOR|SONIA)\b/i.exec(s);
      if (base) out.baseText = base[1];
    } else {
      /* "Portfolio Company Avison Young Inc. Investment Type First Lien Debt Four" */
      const m = /^(.*?)\s+Investment Type\s+(.*)$/i.exec(s);
      if (m) { out.issuer = m[1].trim(); out.instrument = m[2].trim(); }
    }
  } else if (/^(?:Debt|Equity|Warrant|Investment Funds?)[^,]*,\s/i.test(raw) && commaParts(raw).length >= 4) {
    /* Hercules: "Debt Investments, Healthcare Services, Other, Marathon
       Health, LLC, Senior Secured, February 2029, Prime + 0.25%, Floor
       rate 8.25%, PIK Interest 2.25%" — a comma-separated list of
       fields. TCPC's "Debt Investments Aerospace & Defense Skydio, Inc
       First Lien Delayed Draw Term Loan A Ref SOFR(M) ..." opens the
       same way but its only comma is the one in "Skydio, Inc", so it
       takes the general path below and the section-and-industry
       prefix comes off in the holdings build (stripSectionPrefix). */
    const parts = commaParts(raw);
    let k = -1;
    for (let i = 2; i < parts.length; i++) {
      const p = parts[i];
      if (ENTITY_WORDS.test(p) && !MONTH_YEAR_RE.test(p) && !RATE_TEXT_RE.test(p)) continue;
      if (INSTRUMENT_RE.test(p) || MONTH_YEAR_RE.test(p) || RATE_TEXT_RE.test(p)) { k = i; break; }
    }
    if (k < 0) k = parts.length;
    const issuerIdx = Math.max(1, k - 1);
    out.issuer = parts[issuerIdx];
    out.industry = parts.slice(1, issuerIdx).join(", ") || null;
    out.instrument = parts.slice(k).join(", ") || parts[0];
    const my = parts.slice(k).find((p) => MONTH_YEAR_RE.test(p));
    if (my) out.maturityText = my;
    const base = /\b(SOFR|LIBOR|Prime|EURIBOR|SONIA)\b/i.exec(out.instrument || "");
    if (base) out.baseText = base[1];
  } else {
    const dashParts = raw.split(/\s+-\s+|(?<=%)-\s+/);
    if (dashParts.length >= 4 && affiliationClass(dashParts[0]) && /^\d+(?:\.\d+)?\s?%$/.test(dashParts[1].trim())) {
      /* Saratoga: "Affiliate investments - 13.3% - Axero Holdings, LLC -
         Employee Collaboration Software - First Lien Term Loan 10.66% Cash,
         (3M USD TERM SOFR + 7.00%) PIK, 12/31/2027" */
      out.affText = dashParts[0].trim();
      out.issuer = dashParts[2].trim();
      out.industry = dashParts[3] ? dashParts[3].trim() : null;
      out.instrument = dashParts.slice(4).join(" - ").trim() || null;
      const mat = /(\d{1,2}\/\d{1,2}\/\d{4})\s*$/.exec(out.instrument || "");
      if (mat) out.maturityText = mat[1];
      const base = /\b(SOFR|LIBOR|Prime|EURIBOR|SONIA)\b/i.exec(out.instrument || "");
      if (base) out.baseText = base[1];
    } else if (/,\s/.test(raw)) {
      /* Golub, OFS's short form, the num.tsv commitment members:
         "ABC Legal Holdings, LLC, One stop 1"; "Honor HN Buyer Inc., First
         Lien Debt (Revolver)"; "I Love Produce, LLC First Lien Debt (Delayed Draw)" */
      const parts = commaParts(raw);
      const last = parts[parts.length - 1];
      if (parts.length > 1 && INSTRUMENT_RE.test(last) && !(ENTITY_WORDS.test(last) && !INSTRUMENT_RE.test(last.replace(ENTITY_WORDS, "")))) {
        out.instrument = last;
        out.issuer = parts.slice(0, -1).join(", ");
        /* "I Love Produce, LLC First Lien Debt (Delayed Draw)", "B+T
           Group Acquisition, Inc. Line of Credit 1" (GAIN), "Skydio,
           Inc First Lien Delayed Draw Term Loan A ..." (TCPC): the
           legal form rode into the instrument part and belongs to the
           issuer, whatever word the issuer ends with */
        const suffix = /^(LLC|L\.L\.C\.|Inc\.?|L\.?P\.?|Ltd\.?|Corp\.?|Co\.?|LLP|PLC)\s+(.+)$/i.exec(last);
        /* ... unless the issuer already ends in its legal form: "Kodiak
           Buyer, LLC, LP interest" is an LP interest in Kodiak Buyer,
           LLC, not a "Kodiak Buyer, LLC, LP" */
        const issuerHasLegal = /\b(?:LLC|L\.L\.C\.|Inc\.?|L\.?P\.?|Ltd\.?|Corp\.?|Co\.?|LLP|PLC)\.?$/i.test(out.issuer);
        if (suffix && !issuerHasLegal && INSTRUMENT_RE.test(suffix[2])) {
          out.issuer += ", " + suffix[1]; out.instrument = suffix[2];
        }
      } else {
        const tail = /^(.*?,\s*(?:LLC|Inc\.?|L\.?P\.?|Ltd\.?|Corp\.?|Co\.?|LLP|PLC))\s+((?:First|Second|Senior|Unsecured|Subordinated|Term|Revolv|Delayed).*)$/i.exec(raw);
        if (tail) { out.issuer = tail[1]; out.instrument = tail[2]; }
      }
    } else {
      const tail = /^(.*?\b(?:LLC|Inc\.?|L\.?P\.?|Ltd\.?|Corp\.?|Co\.?|LLP|PLC))\s+((?:First|Second|Senior|Unsecured|Subordinated|Term|Revolv|Delayed).*)$/i.exec(raw);
      if (tail) { out.issuer = tail[1]; out.instrument = tail[2]; }
      else {
        /* no legal form to split at: "Diligent Delivery Systems Term
           Debt" (GAIN) ends in the instrument, and the two or more
           words before it are the issuer */
        const bare = /^((?:\S+\s+){1,}\S+?)\s+((?:Term (?:Debt|Loan)|Line of Credit|Revolv(?:er|ing)(?: Loan| Line)?|Delayed Draw(?: Term Loan)?|Common (?:Stock|Equity|Units)|Preferred (?:Stock|Equity|Units)|Warrants?|Senior Secured(?: Debt| Loan| Note)?|First Lien(?: \w+)*|Second Lien(?: \w+)*)(?:\s+\d{1,2})?)$/i.exec(raw);
        if (bare && bare[1].split(/\s+/).length >= 2) { out.issuer = bare[1]; out.instrument = bare[2]; }
      }
    }
  }
  /* a tranche number on the issuer: "Corfin Holdings, Inc. 1" */
  const tr = /^(.*\S)\s+(\d{1,2})$/.exec(out.issuer);
  if (tr) { out.issuer = tr[1]; out.tranche = Number(tr[2]); }
  if (out.instrument) {
    const trI = /^(.*\S)\s+(\d{1,2})$/.exec(out.instrument);
    if (trI && out.tranche === null) out.tranche = Number(trI[2]);
  }
  return out;
}

/* ---------- the August 2026 sentence forms ---------- */

/* A section, affiliation or column heading that opens a member text
   before the issuer: "Debt Investments Aerospace & Defense Skydio, Inc
   ..." (TCPC), "Affiliate Investments CP Communications, LLC ..."
   (FDUS), "Portfolio Company Debt Investments Auto Components First
   Brands Group, LLC Investment ..." (PSBD), "Non-controlled/Non-
   Affiliated Investments Beverage ..." (BCSF), "Investments in
   Non-Control, Non-Affiliated Portfolio Companies First Lien Secured
   Debt Issuer Name ACP Avenu Buyer, LLC" (PNNT), "Investments in
   Affiliate Portfolio Companies Collateralized Loan Obligations JMP
   ..." (BCIC), "Portfolio Company Debt Securities- Canada Construction
   Technology Nexii, Inc." (TRIN). Each is taken off the front, in
   turn, until none matches. */
const SECTION_PREFIX_RES = [
  /^p?ortfolio compan(?:y|ies)\s+/i,
  /^investments? in\s+/i,
  /* an affiliation heading ends in "investments", "portfolio
     companies" or "issuer(s)", or is the two-part form itself; a bare
     "Control" or "Affiliate" that opens a company's name stays */
  /^(?:(?:non[- ]?control(?:led)?(?:\s*[\/,]?\s*(?:non[- ]?)?affiliat(?:e|ed))?|control(?:led)?(?:\s*[\/,]?\s*affiliat(?:e|ed))?|affiliat(?:e|ed)|unaffiliated)\s+(?:affiliate\s+)?(?:portfolio companies|investments?|issuers?)\s+|non[- ]?control(?:led)?\s*[\/,]\s*(?:non[- ]?)?affiliat(?:e|ed)\s+)/i,
  /* "Debt Investments", "Equity Securities", "Debt Securities- Canada",
     "Warrant Investments": a kind word is required, so a company
     whose name opens with "Investment" keeps it */
  /^(?:debt|equity|warrants?|(?:senior |first lien |second lien )?secured|unsecured|subordinated|preferred|common|other|structured|fund)\s+(?:investments?|securities)(?:\s*[-–—]\s*(?:united states|canada|u\.?s\.?|non[- ]u\.?s\.?|international|europe)\b)?\s+(?!investments?\b|securities\b)/i,
  /^(?:first lien|second lien|senior secured|unsecured|subordinated) (?:secured )?(?:debt|loans?|notes?)\s+(?=issuer name\s+|[A-Z])/,
  /^issuer name\s+/i,
  /^investment type\s+/i,
];

/* The instrument words a member text runs into after the issuer, when
   no separator was printed ("Zenith AcquisitionCo LLC Sr Secured
   Revolver Ref SOFR(Q) ...", "Diligent Delivery Systems Term Debt",
   "Applegate Greenfiber Intermediate Inc ( fka US GreenFiber LLC)
   Building Products Manufacturing Common Equity (5,690 units)"). Only
   the two-word forms that no company is named after. */
const INSTRUMENT_TAIL_RE = /\s+((?:(?:first|second|third|1st|2nd)[- ]lien|senior secured|sr\.? secured|senior (?:debt|loan|note|term)|term (?:loan|debt|notes?)|revolv(?:er|ing)|delayed[- ]draw|line of credit|common (?:stock|equity|units?|shares?|warrants?)|preferred (?:stock|equity|units?|shares?)|warrants?(?: to purchase| for \d)|equity (?:interests?|units?|securities|investment)|membership (?:interests?|units?)|(?:llc|lp|partnership) (?:interests?|units?)|class [a-z0-9-]+ (?:units?|shares?|common|preferred|interests?)|series [a-z0-9-]+ (?:preferred|units?|shares?)|subordinated (?:debt|loan|notes?)|unsecured (?:debt|loan|notes?)|mezzanine (?:debt|loan|notes?)|unitranche|one[- ]stop|secured (?:loan|debt|notes?)|growth capital loan|equipment financing|convertible (?:notes?|debt|preferred)|senior secured revolver)\b.*)$/i;

/**
 * A holding's name and industry read again once the filing's own
 * industry vocabulary is known — the table's section and industry
 * cells, the R page's industry members, the filer's industry axis —
 * for a member text the general splitter could not cut. Strips the
 * section prefixes, then a leading industry from the name (TCPC,
 * PSBD, MFIC: industry then issuer), then an industry inside the name
 * or at the head of the instrument (FDUS: issuer then industry), then
 * an instrument tail left on the name. Sets src.nm "id" on a row it
 * changed and src.ind "id" on an industry it found; a name it cannot
 * improve is left as it was. Returns the count changed.
 */
export function refineNames(holdings, { industries = [] } = {}) {
  const lex = [...new Set((industries || []).map((s) => clean(s)).filter((s) => s && s.length >= 3))]
    .sort((a, b) => b.length - a.length);
  const lower = lex.map((s) => s.toLowerCase());
  const leadIndustry = (text) => {
    const t = text.toLowerCase();
    for (let i = 0; i < lex.length; i++) {
      const s = lower[i];
      if (t.startsWith(s) && (t.length === s.length || /[\s:,]/.test(t[s.length]))) return lex[i];
    }
    return null;
  };
  const insideIndustry = (text) => {
    const t = text.toLowerCase();
    let best = null;
    for (let i = 0; i < lex.length; i++) {
      const s = lower[i];
      const at = t.indexOf(" " + s + " ");
      if (at > 0 && (best === null || at < best.at)) best = { at: at + 1, name: lex[i] };
    }
    return best;
  };
  let changed = 0;
  for (const h of holdings || []) {
    if (!h || typeof h.name !== "string" || h.src.nm === "table") continue;
    let name = h.name.trim(), instrument = h.lien.raw || null, industry = h.industry || null, touched = false;
    for (;;) {
      const before = name;
      for (const re of SECTION_PREFIX_RES) name = name.replace(re, "");
      if (name === before) break;
      touched = true;
    }
    if (!name) { continue; }
    /* the industry-and-instrument heuristics below assume a specific
       shape — a section heading, then the issuer, then its industry and
       instrument, in one order or the other (FDUS, TCPC, PSBD, MFIC,
       BCSF, PNNT, BCIC, TRIN: every documented shape opens with one of
       SECTION_PREFIX_RES's headings). Without that heading stripped,
       there is no evidence the text has this shape at all — an
       identifier that already opens with the instrument itself (LIEN:
       "First Lien Senior Secured Canadian Debt Cannabis Canopy Growth
       Corporation Facility Type Term Loan...", no recognized heading)
       would have an industry word land in the middle of running text
       for an unrelated reason, and treating everything before it as the
       issuer merges every company under that industry into "First
       Lien". So the industry/instrument split runs only once a real
       heading came off. */
    if (!touched) { continue; }
    /* the industry before the issuer */
    const lead = leadIndustry(name);
    if (lead && name.length > lead.length + 2) {
      if (!industry) { industry = lead; h.src.ind = h.src.ind || "id"; }
      name = name.slice(lead.length).replace(/^[\s:,-]+/, "");
    }
    /* the industry after the issuer, inside the name or heading the instrument */
    const inside = insideIndustry(name);
    if (inside && inside.at > 2) {
      if (!industry) { industry = inside.name; h.src.ind = h.src.ind || "id"; }
      const rest = name.slice(inside.at + inside.name.length).trim();
      name = name.slice(0, inside.at).trim();
      if (rest) instrument = instrument ? `${rest} | ${instrument}` : rest;
    } else if (instrument) {
      const leadI = leadIndustry(instrument);
      if (leadI && instrument.length > leadI.length + 2) {
        if (!industry) { industry = leadI; h.src.ind = h.src.ind || "id"; }
        instrument = instrument.slice(leadI.length).replace(/^[\s:,-]+/, "");
      }
    }
    /* an instrument tail still on the name */
    const tail = INSTRUMENT_TAIL_RE.exec(name);
    if (tail && tail.index > 0) {
      const head = name.slice(0, tail.index).trim();
      if (head && !/^(?:the|a|an)$/i.test(head)) {
        name = head;
        instrument = instrument && instrument !== tail[1] ? `${tail[1]} | ${instrument}` : tail[1];
      }
    }
    /* a column heading the run-on left on the name ("Maple Raptor
       Acquisition Inc. Type of Investment", TRIN) */
    name = name.replace(/\s+(?:type of investment|investment type|investment|issuer name)$/i, "");
    name = stripNameMarkers(name).replace(/[\s,;:-]+$/, "").trim();
    if (!touched || !name || name === h.name) continue;
    h.name = name;
    h.issuer = normalizeIssuer(name);
    if (industry && industry !== h.industry) h.industry = industry.replace(/\s+Sector$/i, "");
    if (instrument && instrument !== h.lien.raw) {
      h.lien.raw = instrument;
      if (!h.lien.class) {
        const cls = lienClass(instrument);
        if (cls) { h.lien.class = cls === LIEN.FIRST_UNITRANCHE ? LIEN.FIRST : cls; h.lien.subclass = cls === LIEN.FIRST_UNITRANCHE ? "incl. unitranche/last-out" : null; }
      }
      if (!h.facility) h.facility = facilityOf(instrument);
    }
    h.src.nm = "id";
    changed++;
  }
  return changed;
}

/* A row that is a subtotal by its label, or one of the aggregate
   members a filer tags beside its schedule. */
export function isSubtotalIdentifier(id) {
  const raw = clean(id);
  if (!raw) return false;
  if (AGGREGATE_ID_RE.test(raw)) return true;
  const segs = raw.split(/\s+-\s+|(?<=%)-\s+|,\s+|\s\|\s/);
  /* "Sub Total Affiliate investments", "Total Investment Fund": a lone
     segment that is itself a total */
  if (segs.length === 1 && SUBTOTAL_RE.test(raw)) return true;
  /* Saratoga's industry subtotal: "Affiliation - pct - Industry", no
     issuer and no instrument */
  if (segs.length === 3 && affiliationClass(segs[0]) && /^\d+(?:\.\d+)?\s?%$/.test(segs[1].trim())) return true;
  return segs.some((s, i) => i > 0 && SUBTOTAL_RE.test(s.trim()));
}

/* A money-market fund or a cash-equivalent line inside the schedule. */
export function isCashEquivalent(id, typeText) {
  return CASH_RE.test(clean(id)) || CASH_RE.test(memberLabel(typeText) || "");
}

/* ---------- classification ---------- */

/* The lien class from the type axis first, then from the instrument
   text; the label that answered is kept as raw, else the first label. */
function lienFor(typeText, instrument, filerOverrides) {
  const labels = [memberLabel(typeText), instrument].filter(Boolean);
  for (const label of labels) {
    const cls = lienClass(label, filerOverrides);
    if (cls) return { cls, raw: label };
  }
  return { cls: null, raw: labels[0] || null };
}

/* debt | equity | structured | vehicle | other, from the type axis, the
   vehicle test and the instrument words. A loan to an affiliated asset
   manager or a senior loan program is a vehicle; a non-affiliated
   borrower whose name happens to say "Asset Management" is a loan. */
function kindFor({ typeText, instrument, issuer, industry, id, aff, lienCls, spread, rate, principal }) {
  const typeLabel = memberLabel(typeText) || "";
  const text = [typeLabel, instrument || "", id || ""].join(" | ");
  if (STRUCTURED_RE.test(typeLabel) || STRUCTURED_RE.test(instrument || "") || STRUCTURED_RE.test(industry || "") || STRUCTURED_RE.test(issuer || "")) return "structured";
  if (isVehicle(typeLabel)) return "vehicle";
  /* the issuer's own name says vehicle (JV, SLP, asset manager, CLO
     equity, REIT): a controlled one always is; an unlabelled one is
     unless the instrument is an ordinary senior loan, which a borrower
     called "Global Asset Management LLC" or "Co-Invest, SLP" can carry */
  if (isVehicle(issuer || id) && aff !== "non-controlled/non-affiliated" &&
      (aff === "controlled" || !SENIOR_LOAN_RE.test(instrument || ""))) return "vehicle";
  if (lienCls === LIEN.VEHICLES) return "vehicle";
  if (lienCls === LIEN.EQUITY) return "equity";
  if (lienCls) return "debt";
  if (DEBT_WORDS_RE.test(instrument || "")) return "debt";
  if (EQUITY_WORDS_RE.test(instrument || "")) return "equity";
  if (DEBT_WORDS_RE.test(typeLabel)) return "debt";
  if (EQUITY_WORDS_RE.test(typeLabel)) return "equity";
  if (isNum(spread) || (isNum(rate) && isNum(principal))) return "debt";
  if (DEBT_WORDS_RE.test(text)) return "debt";
  if (EQUITY_WORDS_RE.test(text)) return "equity";
  return "other";
}

function baseFor(rateType, ...texts) {
  const rt = memberLabel(rateType) || "";
  if (/sofr/i.test(rt)) return "SOFR";
  if (rt) return "other";
  for (const t of texts) {
    if (!t) continue;
    if (/\bSOFR\b/i.test(t)) return "SOFR";
    if (/\b(?:LIBOR|Prime|EURIBOR|SONIA|CDOR|BBSY|STIBOR|NIBOR|CIBOR|base rate)\b/i.test(t)) return "other";
  }
  return null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/* "May 2028" -> the month's last day; "10/15/2027" -> 2027-10-15. */
function dateFromText(text) {
  if (!text) return null;
  const my = /^([A-Za-z]+)\s+(\d{4})$/.exec(text.trim());
  if (my) {
    const m = MONTHS.indexOf(my[1].toLowerCase());
    if (m < 0) return null;
    const last = new Date(Date.UTC(Number(my[2]), m + 1, 0)).getUTCDate();
    return `${my[2]}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  }
  return isoDate(text);
}

/**
 * One record from either source to the holding shape:
 *   { id, issuer, name, aff, kind, lien: { class, subclass, raw }, facility,
 *     industry, rate, spread, floor, pik, base, principal, cost, fv,
 *     pctNav, unfunded, acquired, maturity, nonAccrual, floating, units,
 *     src: { row, table, r, na, ind, mat, unf } }
 * `issuer` is the match key (normalizeIssuer); `name` the readable issuer.
 * Dollars are rounded to the unit, rates to four decimals. `units` holds
 * the unitRef of each numeric fact verbatim where the source had one.
 */
export function normalizeRow(rec, { source = "dataset", filerOverrides = null } = {}) {
  const id = clean(rec.id);
  const parts = splitIdentifier(id);
  /* a filer whose "Investment, Issuer Affiliation Axis" is blank on
     every row (FDUS) still tags its affiliation, as the leading section
     the identifier opens with — "Non-control/Non-affiliate Investments
     Barefoot Mosquito and Pest Control, LLC ...", "Affiliate Investments
     CP Communications, LLC ...". That heading is the filer's own tag and
     must be read before the table's section tracking gets a chance to
     guess (a comma-heavy sentence like this one can join the wrong
     printed row and hand back another company's Control Investments
     section — enrichFromTable only fills aff when the holding has
     none). A company name that merely contains the word "affiliate"
     without opening with one of these headings is left alone. */
  const leadingAff = !parts.affText && LEADING_AFF_RE.test(id) ? LEADING_AFF_RE.exec(id)[0] : null;
  const affText = (rec.aff != null && String(rec.aff).trim()) ? rec.aff : (parts.affText || leadingAff);
  const aff = affiliationClass(affText);
  const { cls, raw } = lienFor(rec.type, parts.instrument, filerOverrides);
  const spread = round4(num(rec.spread));
  const rate = round4(num(rec.rate));
  const principal = round0(num(rec.principal));
  const kind = kindFor({ typeText: rec.type, instrument: parts.instrument, issuer: parts.issuer, industry: memberLabel(rec.industry) || parts.industry, id, aff, lienCls: cls, spread, rate, principal });
  const lien = {
    class: cls === LIEN.FIRST_UNITRANCHE ? LIEN.FIRST : cls,
    subclass: cls === LIEN.FIRST_UNITRANCHE ? "incl. unitranche/last-out" : null,
    raw,
  };
  const industryAxis = memberLabel(rec.industry);
  const industry = industryAxis || parts.industry || null;
  const maturityAxis = rec.maturity ? isoDate(rec.maturity) : null;
  const maturityText = maturityAxis ? null : dateFromText(parts.maturityText);
  const base = baseFor(rec.rateType, parts.instrument, parts.baseText, id);
  const naText = /non-?\s?accrual/i.test(id);
  const units = rec.units && Object.keys(rec.units).length ? { ...rec.units } : null;
  return {
    id,
    issuer: normalizeIssuer(parts.issuer),
    name: parts.issuer,
    aff,
    kind,
    lien,
    facility: facilityOf(parts.instrument) || facilityOf(memberLabel(rec.type)),
    industry: industry ? industry.replace(/\s+Sector$/i, "") : null,
    rate,
    spread,
    floor: round4(num(rec.floor)),
    pik: round4(num(rec.pik)),
    base,
    principal,
    cost: round0(num(rec.cost)),
    fv: round0(num(rec.fv)),
    pctNav: round4(num(rec.pctNav)),
    unfunded: isNum(num(rec.unfunded)) ? round0(num(rec.unfunded)) : null,
    acquired: rec.acquired ? isoDate(rec.acquired) : null,
    maturity: maturityAxis || maturityText,
    nonAccrual: naText ? true : null,
    floating: isNum(spread) || base !== null,
    units,
    src: {
      row: source,
      table: false,
      r: false,
      na: naText ? "id" : "none",
      ind: industryAxis ? "axis" : (parts.industry ? "id" : null),
      mat: maturityAxis ? "axis" : (maturityText ? "id" : null),
      unf: isNum(num(rec.unfunded)) ? "member" : null,
    },
  };
}

/* credit.js's flat holding shape (frontend/lib/credit.js, "holdings"),
   for the formulas that read isDebt / thirdParty / lien-as-string. */
export function toCreditHolding(h) {
  /* a cash-equivalent line a filer keeps inside its Total Investments
     (PNNT's Treasury bill under "US Government Securities") stays in
     the gate but is no portfolio company; a debt row whose lien label
     reads as a vehicle (BBDC's JV note) is a vehicle exposure, not
     third-party credit. Blueprint 13: "vehicles and affiliates are
     split out" — the 1940 Act's affiliate test catches "non-controlled
     affiliated" the same as "controlled" (both mean MAIN or another
     filer holds enough of the issuer's voting securities to influence
     it), so both are excluded here, not "controlled" alone; only
     "non-controlled/non-affiliated" and the unlabeled majority (null)
     are third-party. */
  const thirdParty = h.kind !== "vehicle" && h.kind !== "structured" &&
    h.aff !== "controlled" && h.aff !== "non-controlled affiliated" &&
    h.cashEquivalent !== true && h.lien.class !== LIEN.VEHICLES;
  return {
    issuer: h.issuer, company: h.name, rawLabel: h.lien.raw,
    lien: h.lien.subclass ? LIEN.FIRST_UNITRANCHE : (h.kind === "vehicle" || h.kind === "structured" ? LIEN.VEHICLES : h.lien.class),
    isDebt: h.kind === "debt", thirdParty,
    accruing: h.nonAccrual === true ? false : true, nonAccrual: h.nonAccrual,
    principal: h.principal, cost: h.cost, fv: h.fv, rate: h.rate, spread: h.spread,
    floating: h.floating, maturity: h.maturity, unfunded: h.unfunded,
  };
}

/* ---------- the gate ---------- */

/**
 * Σ cost and Σ fair value of the kept rows against the filing's tagged
 * InvestmentOwnedAtCost and InvestmentOwnedAtFairValue for the same
 * period, each within `tolerance` (0.5%). `dropped` is the reader's count
 * object and is reported, not used. Nothing is written until this passes.
 */
export function reconcile(rows, { costTag, fvTag, tolerance = GATE_TOLERANCE, dropped = null } = {}) {
  let cost = 0, fv = 0, n = 0;
  for (const r of rows || []) {
    if (!r) continue;
    if (isNum(r.cost)) cost += r.cost;
    if (isNum(r.fv)) fv += r.fv;
    n++;
  }
  const side = (sum, tag) => {
    const t = num(tag);
    const diffPct = t === null ? null : (t === 0 ? (sum === 0 ? 0 : null) : Math.abs(sum - t) / Math.abs(t));
    return { sum: round0(sum), tag: t, diffPct: diffPct === null ? null : Math.round(diffPct * 1e6) / 1e6,
             ok: diffPct !== null && diffPct <= tolerance };
  };
  const c = side(cost, costTag), f = side(fv, fvTag);
  const subtotalRowsDropped = dropped ? (dropped.fvOnly || 0) + (dropped.subtotal || 0) : null;
  const reason = n === 0 ? "no rows kept"
    : c.tag === null || f.tag === null ? "no tagged total to reconcile against"
    : !c.ok && !f.ok ? "cost and fair value both outside tolerance"
    : !c.ok ? "cost outside tolerance" : !f.ok ? "fair value outside tolerance" : null;
  return {
    passed: n > 0 && c.ok && f.ok,
    reason,
    tolerance,
    cost: { sum: c.sum, tag: c.tag, diffPct: c.diffPct },
    fv: { sum: f.sum, tag: f.tag, diffPct: f.diffPct },
    rows: n,
    subtotalRowsDropped,
    dropped: dropped ? { ...dropped } : null,
  };
}

/* ---------- unfunded commitments ---------- */

/**
 * Attach commitment facts to holdings. A commitment member equal to a
 * holding's identifier lands on that holding (src.unf "member"); one
 * that names only the issuer — ARCC's "Spirit RR Holdings, Inc. and
 * Winterfell Co-Invest SCSp", BXSL's "Accordion Partners, LLC |
 * Revolver" — lands on that issuer's debt holding whose facility matches
 * the member's (revolver, delayed draw), else its largest by cost
 * (src.unf "issuer"). Unmatched members are returned, never dropped.
 * The filing-level total is the sum of the commitment facts, not of the
 * holdings, so a commitment is never counted twice.
 */
export function attachUnfunded(rows, commitments) {
  const byId = new Map(), byIssuer = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    byId.set(r.id, r);
    if (!byIssuer.has(r.issuer)) byIssuer.set(r.issuer, []);
    byIssuer.get(r.issuer).push(r);
  }
  const unmatched = [];
  let matched = 0, total = 0;
  for (const c of commitments || []) {
    const amount = num(c.amount);
    if (amount === null) continue;
    total += amount;
    const member = clean(c.member);
    let target = byId.get(member) || null;
    let how = "member";
    if (!target) {
      const parts = splitIdentifier(member);
      const key = normalizeIssuer(parts.issuer);
      /* a commitment to buy equity ("... | Equity") lands on the issuer's
         equity holding; every other commitment is a loan's */
      const wantKind = parts.instrument && EQUITY_WORDS_RE.test(parts.instrument) && !DEBT_WORDS_RE.test(parts.instrument) ? "equity" : "debt";
      const candidates = (byIssuer.get(key) || []).filter((r) => r.kind === wantKind);
      if (candidates.length) {
        const fac = facilityOf(parts.instrument) || facilityOf(member);
        const same = fac ? candidates.filter((r) => r.facility === fac) : [];
        const pool = same.length ? same : candidates;
        target = pool.reduce((best, r) => (best === null || (r.cost || 0) > (best.cost || 0) ? r : best), null);
        how = "issuer";
      }
    }
    if (!target) { unmatched.push({ member, amount: round0(amount) }); continue; }
    target.unfunded = round0((target.unfunded || 0) + amount);
    target.src.unf = target.src.unf === "member" && how === "issuer" ? "member" : how;
    matched++;
  }
  return { matched, unmatched, total: round0(total) };
}

/* ---------- the data set ---------- */

function tsvHeaderIndex(header) {
  const idx = {};
  header.split("\t").forEach((h, i) => { idx[h.trim()] = i; });
  return idx;
}

/** datasets/sub.tsv: { [adsh]: { cik, name, form, period, filed, fy, fp, fye } }. */
export async function readSubmissions(zipPath, { directory } = {}) {
  const dir = directory || await readCentralDirectory(zipPath);
  const out = {};
  let idx = null;
  await readLines(await streamMember(zipPath, /(^|\/)sub\.tsv$/, { directory: dir }), (line, i) => {
    if (i === 0) { idx = tsvHeaderIndex(line); return; }
    if (!line) return;
    const c = line.split("\t");
    const adsh = c[idx.adsh];
    if (!adsh) return;
    out[adsh] = {
      adsh, cik: Number(c[idx.cik]), name: c[idx.name] || null, form: c[idx.form] || null,
      period: isoDate(c[idx.period]), filed: isoDate(c[idx.filed]),
      fy: c[idx.fy] ? Number(c[idx.fy]) : null, fp: c[idx.fp] || null, fye: c[idx.fye] || null,
    };
  });
  return out;
}

/**
 * soi.tsv, streamed: { zip, lines, filings: { [adsh]: filing } } with
 * filing = { cik, adsh, name, form, period, filed, inlineUrl, counts,
 * dropped, rows: [holdings] }. `ciks` (numbers or strings) keeps only
 * the covered filers; `adshs` keeps only named filings; both optional.
 * counts: { rows (every row of the filer), identifier, atPeriod, kept };
 * dropped: { otherDate, otherEntity, subtotal, cash, fvOnly, costOnly,
 * neither }.
 */
export async function readSoiDataset(zipPath, { ciks, adshs, directory, filerOverrides } = {}) {
  const dir = directory || await readCentralDirectory(zipPath);
  const keepCik = ciks ? new Set([...ciks].map((c) => Number(c))) : null;
  const keepAdsh = adshs ? new Set(Array.isArray(adshs) ? adshs : Object.keys(adshs)) : null;
  const filings = {};
  const pending = {};
  let idx = null, col = null;
  const lines = await readLines(await streamMember(zipPath, /(^|\/)soi\.tsv$/, { directory: dir }), (line, i) => {
    if (i === 0) {
      idx = tsvHeaderIndex(line);
      col = {};
      for (const [k, name] of Object.entries(SOI_COLUMNS)) col[k] = idx[name] === undefined ? -1 : idx[name];
      for (const k of ["adsh", "cik", "id", "ddate", "period", "cost", "fv"]) {
        if (col[k] < 0) throw new Error(`soi.tsv has no column "${SOI_COLUMNS[k]}"`);
      }
      return;
    }
    if (!line) return;
    /* the cheap test first: cik is the second column */
    const t1 = line.indexOf("\t"), t2 = line.indexOf("\t", t1 + 1);
    if (keepCik && !keepCik.has(Number(line.slice(t1 + 1, t2)))) return;
    if (keepAdsh && !keepAdsh.has(line.slice(0, t1))) return;
    const c = line.split("\t");
    const get = (k) => (col[k] >= 0 ? (c[col[k]] || "") : "");
    const adsh = get("adsh");
    let f = filings[adsh];
    if (!f) {
      f = filings[adsh] = {
        cik: Number(get("cik")), adsh, name: get("name") || null, form: get("form") || null,
        period: isoDate(get("period")), filed: isoDate(get("filed")), inlineUrl: get("inlineurl") || null,
        counts: { rows: 0, identifier: 0, atPeriod: 0, kept: 0 },
        dropped: { otherDate: 0, otherEntity: 0, subtotal: 0, cash: 0, fvOnly: 0, costOnly: 0, neither: 0 },
        rows: [],
      };
      pending[adsh] = { plain: [], entity: [] };
    }
    f.counts.rows++;
    const id = get("id");
    if (!id) return;
    f.counts.identifier++;
    if (isoDate(get("ddate")) !== f.period) { f.dropped.otherDate++; return; }
    f.counts.atPeriod++;
    const typeText = get("type");
    if (isSubtotalIdentifier(id)) { f.dropped.subtotal++; return; }
    const cost = get("cost") || get("costStandard");
    const fv = get("fv") || get("fvStandard");
    const cash = isCashEquivalent(id, typeText) || Boolean(get("cashEquivalents"));
    if (cash) f.dropped.cash++;
    else if (!cost && !fv) { f.dropped.neither++; return; }
    else if (!cost) { f.dropped.fvOnly++; return; }
    else if (!fv) f.dropped.costOnly++;
    if (cash && !cost) return;
    const rec = {
      id, aff: get("affiliation"), type: typeText, industry: get("industry"),
      rate: get("rate"), spread: get("spread"), floor: get("floor"), pik: get("pik"), cashRate: get("cashRate"),
      rateType: get("rateType"), principal: get("principal"), cost, fv: fv || "0", pctNav: get("pctNav"),
      shares: get("shares"), acquired: get("acquired"), maturity: get("maturity"),
      /* a cost-only row is a position whose fair value the filer did
         not tag — a written-off loan printed as a dash (FDUS 34 rows,
         TRIN 50); a cash-equivalent line sits inside some filers'
         InvestmentOwnedAtCost (PNNT's Treasury bills, $269.3M) and
         outside others' (Hercules). Both go to `extra` and the gate
         decides which the filing counts. */
      extra: cash ? "cash" : (!fv ? "costOnly" : null),
    };
    const entityAxis = get("legalEntity") || get("consolidatedEntities") || get("nonconsolidatedSubsidiary");
    (entityAxis ? pending[adsh].entity : pending[adsh].plain).push(rec);
  });
  for (const [adsh, f] of Object.entries(filings)) {
    const { plain, entity } = pending[adsh];
    /* rows of a consolidated vehicle are dropped only when the filer's
       own rows carry no entity axis; a filer that dimensions everything
       on its own legal entity keeps its schedule */
    const use = plain.length ? plain : entity;
    if (plain.length) f.dropped.otherEntity = entity.filter((r) => !r.extra).length;
    f.extra = { costOnly: [], cash: [] };
    for (const rec of use) {
      const { extra, ...rest } = rec;
      const row = normalizeRow(rest, { source: "dataset", filerOverrides: filerOverrides || null });
      if (extra === "costOnly") { row.fvUntagged = true; f.extra.costOnly.push(row); }
      else if (extra === "cash") { row.cashEquivalent = true; f.extra.cash.push(row); }
      else f.rows.push(row);
    }
    f.counts.kept = f.rows.length;
  }
  return { zip: basename(zipPath), lines, filings };
}

/* "InvestmentIdentifierAxis(us-gaap/2026)=Spirit RR Holdings, Inc.();
   InvestmentTypeAxis(us-gaap/2025)=UndrawnRevolverMember(0001930087-26-000078);"
   -> [{ axis, member }] with the version parenthesis stripped and the
   typed member's text kept whole even when it ends in ")". */
export function parseSegments(segments) {
  const out = [];
  for (const seg of String(segments || "").split(";")) {
    const s = seg.trim();
    if (!s) continue;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const axis = s.slice(0, eq).replace(/\(.*$/, "").trim();
    const member = s.slice(eq + 1).replace(/\([^()]*\)$/, "").trim();
    out.push({ axis, member });
  }
  return out;
}

/**
 * datasets/num.tsv streamed once for the named tags of the named
 * filings: { [adsh]: [{ tag, ddate, qtrs, uom, segments: [{axis, member}],
 * dimn, value, footnote }] }. `adshs` is an array or an object keyed by
 * accession. The whole August file's num.tsv is 1.17 GB inflated; the
 * accession is the first column, so a line outside the set costs one
 * slice and a Set lookup.
 */
export async function readNumFacts(zipPath, { adshs, tags, directory } = {}) {
  const dir = directory || await readCentralDirectory(zipPath);
  const keepAdsh = adshs ? new Set(Array.isArray(adshs) ? adshs : Object.keys(adshs)) : null;
  const keepTag = tags ? new Set(tags) : null;
  const out = {};
  let idx = null;
  await readLines(await streamMember(zipPath, /(^|\/)num\.tsv$/, { directory: dir }), (line, i) => {
    if (i === 0) { idx = tsvHeaderIndex(line); return; }
    if (!line) return;
    const t1 = line.indexOf("\t");
    const adsh = line.slice(0, t1);
    if (keepAdsh && !keepAdsh.has(adsh)) return;
    const t2 = line.indexOf("\t", t1 + 1);
    const tag = line.slice(t1 + 1, t2);
    if (keepTag && !keepTag.has(tag)) return;
    const c = line.split("\t");
    (out[adsh] = out[adsh] || []).push({
      tag, ddate: isoDate(c[idx.ddate]), qtrs: Number(c[idx.qtrs]), uom: c[idx.uom] || null,
      segments: parseSegments(c[idx.segments]), dimn: Number(c[idx.dimn]),
      value: num(c[idx.value]), footnote: c[idx.footnote] || null,
    });
  });
  return out;
}

/** From one filing's num facts: the commitment total (no dimension) and
    the per-member commitments at `period`. */
export function unfundedFromFacts(facts, period) {
  const total = (facts || []).find((f) => f.tag === UNFUNDED_TAG && f.ddate === period && f.dimn === 0);
  const members = [];
  for (const f of facts || []) {
    if (f.tag !== UNFUNDED_TAG || f.ddate !== period || f.dimn < 1 || f.value === null) continue;
    const seg = f.segments.find((s) => /InvestmentIdentifierAxis$/.test(s.axis));
    if (!seg) continue;
    members.push({ member: clean(seg.member), amount: f.value, uom: f.uom,
                   otherAxes: f.segments.filter((s) => s !== seg) });
  }
  return { total: total ? total.value : null, members };
}

/** From one filing's num facts: the dimensionless InvestmentOwnedAtCost
    and InvestmentOwnedAtFairValue at `period`, for the gate. */
export function totalsFromFacts(facts, period) {
  const pick = (tag) => {
    const f = (facts || []).find((x) => x.tag === tag && x.ddate === period && x.dimn === 0 && x.value !== null);
    return f ? { value: f.value, tag, uom: f.uom } : null;
  };
  return { cost: pick(COST_TAG), fv: pick(FV_TAG) };
}

/**
 * The per-loan unfunded commitments of the named filings, joined on
 * accession plus member: { [adsh]: { period, total, members } }. `adshs`
 * may map accession -> period; otherwise periods come from sub.tsv.
 */
export async function readUnfunded(zipPath, { adshs, directory } = {}) {
  const dir = directory || await readCentralDirectory(zipPath);
  let periods = adshs && !Array.isArray(adshs) ? { ...adshs } : null;
  const list = adshs ? (Array.isArray(adshs) ? adshs : Object.keys(adshs)) : null;
  if (!periods || Object.values(periods).some((p) => !p)) {
    const subs = await readSubmissions(zipPath, { directory: dir });
    periods = periods || {};
    for (const [adsh, s] of Object.entries(subs)) if (!periods[adsh]) periods[adsh] = s.period;
  }
  const facts = await readNumFacts(zipPath, { adshs: list, tags: [UNFUNDED_TAG], directory: dir });
  const out = {};
  for (const adsh of list || Object.keys(facts)) {
    const period = periods[adsh] || null;
    out[adsh] = { period, ...unfundedFromFacts(facts[adsh] || [], period) };
  }
  return out;
}

/* ---------- the filing instance ---------- */

const INSTANCE_TAGS = {
  InvestmentOwnedAtCost: "cost",
  InvestmentOwnedAtFairValue: "fv",
  InvestmentOwnedPercentOfNetAssets: "pctNav",
  InvestmentOwnedBalancePrincipalAmount: "principal",
  InvestmentBasisSpreadVariableRate: "spread",
  InvestmentInterestRate: "rate",
  InvestmentInterestRatePaidInKind: "pik",
  InvestmentInterestRatePaidInCash: "cashRate",
  InvestmentInterestRateFloor: "floor",
  InvestmentCompanyFinancialCommitmentToInvesteeFutureAmount: "unfunded",
  InvestmentOwnedBalanceShares: "shares",
  InvestmentMaturityDate: "maturity",
  InvestmentAcquisitionDate: "acquired",
};
const INSTANCE_ENUMS = {
  InvestmentTypeExtensibleEnumeration: "type",
  InvestmentIssuerAffiliationExtensibleEnumeration: "aff",
  InvestmentIndustrySectorExtensibleEnumeration: "industry",
  InvestmentVariableInterestRateTypeExtensibleEnumeration: "rateType",
};
const AXES = {
  id: /:InvestmentIdentifierAxis$/,
  type: /:InvestmentTypeAxis$/,
  industry: /:(?:EquitySecuritiesByIndustryAxis|IndustrySectorAxis|InvestmentIndustrySectorAxis)$/,
  aff: /:InvestmentIssuerAffiliationAxis$/,
};

/**
 * The schedule from an XBRL instance (the extracted bxsl-20260630_htm.xml
 * or the inline document): { period, instants, contexts, members,
 * holdings, unfunded, totals, units, dropped }. Holdings are the typed
 * InvestmentIdentifierAxis members whose instant is the period end and
 * which carry both cost and fair value, through normalizeRow with
 * src.row "instance"; a member carrying only a commitment goes to
 * `unfunded` for attachUnfunded. `period` defaults to the latest instant
 * that carries cost and fair value facts. unitRef travels verbatim in
 * each holding's `units`. filing-parse's parseInstance is not reused: it
 * drops instants and typed members by design.
 */
export function parseSoiInstance(xml, { period = null, filerOverrides = null } = {}) {
  const x = String(xml);
  const inline = x.indexOf("<ix:nonFraction") !== -1;
  const ctx = {};
  const cre = /<(?:xbrli:)?context\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g;
  let m;
  while ((m = cre.exec(x))) {
    const body = m[2];
    const dims = {};
    let member = null;
    let d;
    const tre = /<xbrldi:typedMember\s+dimension="([^"]+)"\s*>\s*<[^>]+>([\s\S]*?)<\/[^>]+>\s*<\/xbrldi:typedMember>/g;
    while ((d = tre.exec(body))) {
      if (AXES.id.test(d[1])) member = clean(d[2]);
      else dims[d[1]] = clean(d[2]);
    }
    const ere = /<xbrldi:explicitMember\s+dimension="([^"]+)"\s*>\s*([^<\s]+)\s*<\/xbrldi:explicitMember>/g;
    while ((d = ere.exec(body))) dims[d[1]] = d[2];
    const instant = (body.match(/<(?:xbrli:)?instant>\s*([^<\s]+)\s*</) || [])[1] || null;
    const end = (body.match(/<(?:xbrli:)?endDate>\s*([^<\s]+)\s*</) || [])[1] || null;
    ctx[m[1]] = { member, dims, instant, end, dimCount: Object.keys(dims).length + (member ? 1 : 0) };
  }
  const units = {};
  const ure = /<(?:xbrli:)?unit\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?unit>/g;
  while ((m = ure.exec(x))) {
    const measures = [...m[2].matchAll(/<(?:xbrli:)?measure>\s*([^<\s]+)\s*</g)].map((u) => u[1]);
    units[m[1]] = measures.join("/");
  }

  /* facts: one pass over every us-gaap element whose local name is wanted;
     attributes may sit on their own lines, so [^>]* is the only assumption */
  const perMember = {};
  const undimensioned = {};
  const push = (tag, attrs, text) => {
    const field = INSTANCE_TAGS[tag] || INSTANCE_ENUMS[tag];
    if (!field) return;
    const ref = (attrs.match(/contextRef="([^"]+)"/) || [])[1];
    const c = ref && ctx[ref];
    if (!c || !c.instant) return;
    const unitRef = (attrs.match(/unitRef="([^"]+)"/) || [])[1] || null;
    let value;
    if (INSTANCE_ENUMS[tag] || field === "maturity" || field === "acquired") {
      value = clean(text.replace(/<[^>]*>/g, ""));
    } else {
      /* a nil fact is no fact; an inline fact whose transformation is
         fixed-zero or zerodash prints a dash and means 0 — its text is
         "&#8212;", which read as digits would be 8,212 × 10^scale
         (ARCC's 0001628280-26-050307 carries 3,706 such
         InvestmentOwnedAtCost facts at scale 6; FSK 303, OFS 50), so the
         entities are decoded before anything is stripped and a dash is 0 */
      if (/xsi:nil="true"/.test(attrs)) return;
      const format = (attrs.match(/format="[a-z0-9-]*:([a-z0-9-]+)"/i) || [])[1] || "";
      const printed = decodeEntities(text.replace(/<[^>]*>/g, "")).trim();
      if (/^(?:fixed-?zero|zero-?dash)$/i.test(format) || /^[-—–]+$/.test(printed)) {
        value = 0;
      } else {
        const raw = printed.replace(/[^0-9.\-]/g, "");
        if (!raw) return;
        value = Number(raw);
        if (!Number.isFinite(value)) return;
        if (inline) {
          const scale = (attrs.match(/scale="(-?[0-9]+)"/) || [])[1];
          if (scale) value *= Math.pow(10, Number(scale));
          if (/sign="-"/.test(attrs)) value = -value;
        }
      }
    }
    if (!c.member) {
      if (c.dimCount === 0 && (field === "cost" || field === "fv" || field === "unfunded")) {
        const slot = (undimensioned[c.instant] = undimensioned[c.instant] || {});
        if (!(field in slot)) slot[field] = { value, unitRef };
      }
      return;
    }
    const key = c.instant + "|" + c.member;
    const row = perMember[key] || (perMember[key] = { member: c.member, instant: c.instant, fields: {}, units: {}, dims: {} });
    if (!(field in row.fields)) { row.fields[field] = value; if (unitRef) row.units[field] = unitRef; }
    for (const [axis, mem] of Object.entries(c.dims)) {
      for (const [k, re] of Object.entries(AXES)) if (k !== "id" && re.test(axis) && !(k in row.dims)) row.dims[k] = mem;
    }
  };
  if (inline) {
    const re = /<ix:nonFraction([^>]*)>([\s\S]*?)<\/ix:nonFraction>/g;
    while ((m = re.exec(x))) {
      const name = (m[1].match(/name="[a-z0-9-]+:([A-Za-z0-9]+)"/i) || [])[1];
      if (name) push(name, m[1], m[2]);
    }
    const nre = /<ix:nonNumeric([^>]*)>([\s\S]*?)<\/ix:nonNumeric>/g;
    while ((m = nre.exec(x))) {
      const name = (m[1].match(/name="[a-z0-9-]+:([A-Za-z0-9]+)"/i) || [])[1];
      if (name) push(name, m[1], m[2]);
    }
  } else {
    const re = /<us-gaap:([A-Za-z0-9]+)((?:\s[^>]*)?)>([^<]*)<\/us-gaap:\1>/g;
    while ((m = re.exec(x))) push(m[1], m[2], m[3]);
  }

  /* the period: the latest instant at which members carry both values */
  const instants = {};
  for (const row of Object.values(perMember)) {
    if ("cost" in row.fields && "fv" in row.fields) instants[row.instant] = (instants[row.instant] || 0) + 1;
  }
  const chosen = period || Object.keys(instants).sort().pop() || null;

  const holdings = [], unfunded = [];
  const extra = { costOnly: [], cash: [] };
  const dropped = { otherDate: 0, subtotal: 0, cash: 0, fvOnly: 0, costOnly: 0, neither: 0, commitmentOnly: 0 };
  let members = 0;
  for (const row of Object.values(perMember)) {
    if (row.instant !== chosen) { dropped.otherDate++; continue; }
    members++;
    const f = row.fields;
    const typeText = row.dims.type || f.type || null;
    if (isSubtotalIdentifier(row.member)) { dropped.subtotal++; continue; }
    const cash = isCashEquivalent(row.member, typeText);
    const hasCost = "cost" in f, hasFv = "fv" in f;
    if (cash) dropped.cash++;
    else if (!hasCost && !hasFv) {
      if ("unfunded" in f) { unfunded.push({ member: row.member, amount: f.unfunded, unitRef: row.units.unfunded || null }); dropped.commitmentOnly++; }
      else dropped.neither++;
      continue;
    }
    else if (!hasCost) { dropped.fvOnly++; continue; }
    else if (!hasFv) dropped.costOnly++;
    if (cash && !hasCost) continue;
    const h = normalizeRow({
      id: row.member, aff: row.dims.aff || f.aff || null, type: typeText,
      industry: row.dims.industry || f.industry || null,
      rate: f.rate, spread: f.spread, floor: f.floor, pik: f.pik, cashRate: f.cashRate,
      rateType: f.rateType || null, principal: f.principal, cost: f.cost, fv: hasFv ? f.fv : 0, pctNav: f.pctNav,
      shares: f.shares, acquired: f.acquired || null, maturity: f.maturity || null,
      unfunded: "unfunded" in f ? f.unfunded : null, units: row.units,
    }, { source: "instance", filerOverrides });
    /* as the data set: a cost-only member and a cash-equivalent line
       go to `extra` for the gate to decide */
    if (cash) { h.cashEquivalent = true; extra.cash.push(h); }
    else if (!hasFv) { h.fvUntagged = true; extra.costOnly.push(h); }
    else holdings.push(h);
  }
  const tot = undimensioned[chosen] || {};
  return {
    period: chosen,
    instants,
    contexts: Object.keys(ctx).length,
    members,
    holdings,
    extra,
    unfunded,
    totals: { cost: tot.cost ? { value: tot.cost.value, tag: COST_TAG, unitRef: tot.cost.unitRef } : null,
              fv: tot.fv ? { value: tot.fv.value, tag: FV_TAG, unitRef: tot.fv.unitRef } : null,
              unfunded: tot.unfunded ? { value: tot.unfunded.value, tag: UNFUNDED_TAG, unitRef: tot.unfunded.unitRef } : null },
    units,
    dropped,
  };
}
