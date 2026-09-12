/**
 * interim-parse.mjs — financial statements read from the tables of a
 * report that carries no XBRL.
 *
 * A foreign private issuer furnishes its interim statements on Form 6-K,
 * and nothing obliges it to tag them. Enlivex tagged its half-year 2025
 * report and not its third quarter; the third quarter exists only as
 * three HTML tables in an exhibit. Those tables are regular enough to
 * read: a header block naming the periods ("For the three months ended
 * … September 30, 2025 | 2024"), a label column, and one numeric column
 * per period, in thousands. This module turns such tables into rows
 * shaped like the SEC facts feed, under the same concept tags the period
 * builder already reads, so a parsed quarter and a tagged one look the
 * same downstream.
 *
 * Every parsed figure is marked form "6-K" and carries the exhibit it
 * came from. Nothing here estimates: a label that matches no concept is
 * dropped, a column whose period cannot be dated is dropped.
 *
 * Nebius Group (20-F annual, 6-K interim reports from Q1 2026; CIK
 * 1513845) is the second filer read this way. Its exhibits differ from
 * Enlivex's in four regular ways, each handled below rather than
 * special-cased: empty cells hold a zero-width space (&#8203;), a "Notes"
 * column carries note numbers between the label and the figures, labels
 * carry footnote markers ("Cost of revenues (1)"), and the cash-flow
 * totals read "Net cash provided by / (used in) operating activities".
 * Its lines are in millions, and the cash-flow statement is six-month
 * only in the half-year report, so a second quarter is the half-year
 * minus the first quarter — the same de-cumulation the period builder
 * already applies to a 10-Q.
 */
import { INCOME, BALANCE, CASHFLOW } from "./concepts.mjs";

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12 };

export const strip = (h) => String(h)
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<br\s*\/?>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/g, " ")
  /* the zero-width space some typesetters put in an empty cell — it
     must read as nothing, or an empty cell becomes the row's label */
  .replace(/&#8203;|&#x200b;|\u200b/gi, "")
  .replace(/&amp;/g, "&").replace(/&rsquo;|&#8217;|&#39;/g, "'").replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, "\"")
  .replace(/&#8211;|&ndash;|&#8212;|&mdash;/g, "-")
  .replace(/\s+/g, " ").trim();

/** Every table in a document, as rows of cells with their colspans. */
export function tables(html) {
  const out = [];
  const re = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = re.exec(html))) {
    const before = html.slice(Math.max(0, m.index - 1500), m.index);
    const rows = [];
    const trRe = /<tr[\s\S]*?<\/tr>/gi;
    let tr;
    while ((tr = trRe.exec(m[0]))) {
      const cells = [];
      const tdRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
      let td;
      while ((td = tdRe.exec(tr[0]))) {
        const span = Number((td[1].match(/colspan\s*=\s*"?(\d+)/i) || [])[1] || 1);
        const text = strip(td[2]);
        cells.push({ text, span });
      }
      if (cells.some((c) => c.text)) rows.push(cells);
    }
    if (rows.length) out.push({ rows, before: strip(before), html: m[0] });
  }
  return out;
}

/* "(2,557" → -2557; "1,484" → 1484; "-" → 0; "0.09" → 0.09 */
function toNumber(text) {
  const t = text.replace(/\$/g, "").replace(/\s/g, "");
  if (t === "-" || t === "—" || t === "–") return 0;
  const neg = /^\(/.test(t) || /\)$/.test(t) || /^-/.test(t);
  const digits = t.replace(/[()]/g, "").replace(/^-/, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const v = Number(digits);
  return neg ? -v : v;
}
const isNumeric = (text) => toNumber(text) !== null && /\d/.test(text);
/* a figure cell: a number, or the dash a filer prints for nil ("-",
   "—"). The dash counts as a figure only where the row already carries a
   real number, so a row of dashes is never mistaken for data, and it is
   never used to locate the figure columns. */
const isDash = (text) => /^[-—–]$/.test(text.trim());

/** The scale stated near a table: "U.S. dollars in thousands",
    "(In millions of U.S. dollars)", "In USD $ millions", "$ millions". */
export function scaleOf(text) {
  if (/in millions|(usd|\$)\s*\$?\s*millions|\(millions\)/i.test(text)) return 1e6;
  if (/in thousands|(usd|\$)\s*\$?\s*thousands|\(thousands\)/i.test(text)) return 1e3;
  return 1;
}

function lastDayOf(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function iso(y, m, d) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function shiftMonths(end, months) {
  /* A period ending on the last day of a month starts on the first day
     of the month `months` earlier; one ending mid-month starts the day
     after the same date `months` earlier. */
  const [y, m, d] = end.split("-").map(Number);
  let mm = m - months + 1, yy = y;
  while (mm <= 0) { mm += 12; yy--; }
  if (d === lastDayOf(y, m)) return iso(yy, mm, 1);
  let m2 = m - months, y2 = y;
  while (m2 <= 0) { m2 += 12; y2--; }
  const dd = Math.min(d, lastDayOf(y2, m2));
  return new Date(Date.UTC(y2, m2 - 1, dd) + 86400000).toISOString().slice(0, 10);
}

/**
 * The period of each numeric column, read from the header rows.
 *
 * A filer's table has more raw columns than figures: a "$" cell, the
 * figure, a ")" cell, a spacer. Header cells span groups of them
 * ("For the three months ended" over six raw columns). So every header
 * value is laid out over the raw columns its colspan covers, and the
 * value over each FIGURE column — the raw positions where a data row
 * carries a number — is the one that names it. Balance-sheet headers
 * have no span phrase; those columns are instants.
 */
export function columnsOf(rows, dataCols) {
  const rawPositions = (r) => {
    let pos = 0;
    return r.map((c) => { const at = pos; pos += c.span; return { at, span: c.span, text: c.text }; });
  };
  const header = [];
  let numericRaw = null;
  for (const r of rows) {
    const cells = rawPositions(r);
    const numeric = cells.filter((c) => isNumeric(c.text));
    const isYearRow = numeric.length >= 2 && numeric.every((c) => /^(19|20)\d\d$/.test(c.text.trim()));
    if (numeric.length >= 2 && !isYearRow) {
      /* the first data row fixes where the figures sit */
      if (numeric.length === dataCols) numericRaw = numeric.map((c) => c.at);
      break;
    }
    header.push(cells);
    if (header.length > 10) break;
  }
  if (!numericRaw) {
    for (const r of rows) {
      const cells = rawPositions(r);
      const numeric = cells.filter((c) => isNumeric(c.text) && !/^(19|20)\d\d$/.test(c.text.trim()));
      if (numeric.length === dataCols) { numericRaw = numeric.map((c) => c.at); break; }
    }
  }
  if (!numericRaw) return null;
  /* lay a header row's values over raw positions, then read the figure positions */
  const over = (cells, pick) => {
    const raw = [];
    for (const c of cells) {
      const v = pick(c.text);
      for (let i = 0; i < c.span; i++) raw[c.at + i] = v;
    }
    return numericRaw.map((at) => {
      /* a header narrower than the data row: take the last value at or before the figure */
      for (let i = at; i >= 0; i--) if (raw[i] !== undefined && raw[i] !== null) return raw[i];
      return null;
    });
  };
  const yearOf = (t) => { const y = (t.match(/\b(19|20)\d\d\b/) || [])[0]; return y ? Number(y) : null; };
  const monthsOf = (t) => {
    const s = t.toLowerCase();
    if (/three[- ]months?|quarter ended|three month period/.test(s)) return 3;
    if (/six[- ]months?|half[- ]year/.test(s)) return 6;
    if (/nine[- ]months?/.test(s)) return 9;
    if (/twelve[- ]months?|year ended|years ended|fiscal year/.test(s)) return 12;
    return null;
  };
  const dateOf = (t) => {
    const m = t.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i);
    return m ? { month: MONTHS[m[1].toLowerCase()], day: Number(m[2]) } : null;
  };
  let years = null, dates = null, spans = null;
  for (const cells of header) {
    const y = over(cells, yearOf); if (y.every((v) => v !== null) && cells.some((c) => yearOf(c.text))) years = y;
    const d = over(cells, dateOf); if (d.every((v) => v !== null) && cells.some((c) => dateOf(c.text))) dates = d;
    const s = over(cells, monthsOf); if (!spans && s.every((v) => v !== null) && cells.some((c) => monthsOf(c.text))) spans = s;
  }
  /* "September 30, 2025" in one cell: year and date together */
  if (!years || !dates) {
    for (const cells of header) {
      const both = over(cells, (t) => { const d = dateOf(t), y = yearOf(t); return d && y ? { d, y } : null; });
      if (both.every((v) => v !== null)) { years = both.map((v) => v.y); dates = both.map((v) => v.d); }
    }
  }
  if (!years || !dates) return null;
  const cols = [];
  for (let i = 0; i < dataCols; i++) {
    const end = iso(years[i], dates[i].month, Math.min(dates[i].day, lastDayOf(years[i], dates[i].month)));
    const months = spans ? spans[i] : null;
    cols.push({ end, months, start: months ? shiftMonths(end, months) : null });
  }
  return cols;
}

/* label → concept, in the order tried. A concept may be a list when one
   printed line stands for two tags (a filer with no noncontrolling
   interest prints one equity total, which is both the parent's equity
   and the consolidated equity). */
const IS_MAP = [
  [/^(total )?(net )?(revenues?|sales)( ,? net)?$/i, "revenue"],
  [/^cost of (revenues?|sales|goods sold)$/i, "cogs"],
  [/^gross (profit|margin)$/i, "grossProfit"],
  /* Nebius files research and development as "Product development" */
  [/research and development|^product development$/i, "researchDevelopment"],
  [/general and administrative|selling, general/i, "sellingGeneralAdmin"],
  [/^(sales|selling) and marketing/i, "sellingMarketing"],
  [/^depreciation and amortization$/i, "depreciationAmortization"],
  [/^total operating (costs and )?expenses$|^operating expenses$/i, "operatingExpenses"],
  [/^operating (loss|income|profit)|^(loss|income|profit) from operations/i, "operatingIncome"],
  [/^interest expense/i, "interestExpense"],
  [/(loss|income|profit) before (income )?tax/i, "pretaxIncome"],
  [/^(income )?tax(es)?( on income| expense| benefit)?( \/ \((benefit|expense)\))?$|^taxes on income/i, "incomeTax"],
  /* "Net income / (loss)" is the bottom line; "… from continuing
     operations" is not, and the anchor keeps it out */
  [/^net (loss|income|profit)( \/ \((loss|income)\))?( for the period)?( attributable to (the company|ordinary shareholders|shareholders))?$/i, "netIncome"],
];
const PER_SHARE_MAP = [
  [/basic (&|and) diluted/i, ["epsBasic", "epsDiluted"]],
  [/diluted/i, ["epsDiluted"]],
  [/basic/i, ["epsBasic"]],
];
const SHARES_MAP = [
  [/weighted average.*diluted/i, ["dilutedShares"]],
  [/weighted average.*basic/i, ["basicShares"]],
  [/weighted average/i, ["basicShares", "dilutedShares"]],
];
const BS_MAP = [
  [/^cash and cash equivalents$/i, "cash"],
  [/^restricted cash( and cash equivalents)?(, current)?$/i, "restrictedCash"],
  [/^restricted cash( and cash equivalents)?, non-?current$/i, "restrictedCashNoncurrent"],
  [/short[- ]term (interest[- ]bearing )?(bank )?deposits|marketable securities|short[- ]term investments/i, "shortTermInvestments"],
  [/^(trade |accounts )?receivables?/i, "receivables"],
  [/^inventor(y|ies)/i, "inventory"],
  [/^total current assets$/i, "currentAssets"],
  [/^property(, plant)? and equipment(, net|$)/i, "ppe"],
  [/^intangible assets(, net)?$/i, "intangibles"],
  [/^goodwill$/i, "goodwill"],
  [/^operating lease right-of-use assets$/i, "operatingLeaseAsset"],
  [/^total assets$/i, "totalAssets"],
  [/^(trade |accounts )?payables?( trade)?$/i, "payables"],
  [/^deferred revenue(, current)?$/i, "deferredRevenue"],
  [/^deferred revenue, non-?current$/i, "deferredRevenueNoncurrent"],
  [/current maturities of (long[- ]term )?(debt|loans)|short[- ]term (debt|loans?|borrowings)|^debt, current$/i, "shortTermDebt"],
  [/^total current liabilities$/i, "currentLiabilities"],
  [/^long[- ]term (debt|loans?|borrowings)|^debt, non-?current$/i, "longTermDebt"],
  [/^(total )?convertible (debt|notes)( payable)?(, non-?current)?$/i, "convertibles"],
  [/^operating lease liabilit(y|ies), non-?current$/i, "operatingLeaseLiabilityNoncurrent"],
  [/^total liabilities$/i, "totalLiabilities"],
  /* the parent's share first, so that where a filer prints both it is
     the attributable line that becomes StockholdersEquity and the
     consolidated total that becomes the including-NCI tag */
  [/^total equity attributable to/i, "equity"],
  [/^noncontrolling interests?$/i, "minorityInterest"],
  [/^total (shareholders'?|stockholders'?) equity$/i, ["equity", "equityIncludingNci"]],
];
/* "Net cash used in", "Net cash provided by / (used in)", "Net cash
   provided by/(used in)", "Net cash (used in) provided by". Anchored at
   both ends so that a filer's "… operating activities - continuing
   operations" sub-total never stands in for the total. */
const NET_CASH = (activity) => new RegExp(
  "^net cash (?:provided by|used in|from|\\(used in\\)|\\(provided by\\))" +
  "(?:\\s*/?\\s*\\(?(?:used in|provided by)\\)?)? " + activity + " activities$", "i");
const CF_MAP = [
  [NET_CASH("operating"), "cfOps"],
  [NET_CASH("investing"), "cfInv"],
  [NET_CASH("financing"), "cfFin"],
  /* Nebius's one investing line for capex covers intangibles too; the
     panel that reads it says so (blueprint 15.9) */
  [/^purchases of property(, plant)? and equipment and intangible assets$/i, "capex"],
  [/purchases? of property|capital expenditures?/i, "capex"],
  [/^depreciation( and amortization)?$/i, "depreciationAmortization"],
  [/^depreciation of property(, plant)? and equipment$/i, "depreciation"],
  [/^amortization of intangible assets$/i, "amortizationIntangibles"],
  [/share[- ]based|stock[- ]based compensation/i, "shareBasedComp"],
  [/^deferred revenue$/i, "deferredRevenueChange"],
  [/^acquisitions? of businesses?, net of cash acquired$/i, "acquisitions"],
  /* Nebius's H1 2026 financing lines (6-K acc 0001104659-26-094844) */
  [/^proceeds from (the )?issuance of convertible (senior )?notes$/i, "convertsIssued"],
  [/^convertible notes issuance costs$|^payments? (of|for) debt issuance costs$/i, "debtIssuanceCosts"],
  [/^proceeds from (the )?sale of treasury (shares|stock)$/i, "treasurySharesSold"],
  [/^treasury shares issuance costs$|^payments? of (stock|share) issuance costs$/i, "equityIssuanceCosts"],
  /* the Q1 2026 report prints "… pre-funded warrants sale" */
  [/^proceeds from (the )?issuance of pre-?funded warrants( sale)?$/i, "warrantsIssued"],
  [/^proceeds from (the )?exercise of (share|stock) options$/i, "optionsExercised"],
  [/^interest paid(, net( of amounts capitalized)?)?$/i, "interestPaid"],
];
/* Read only where the table printed no total: a filer that reports a
   single "… operating activities from continuing operations" line and
   no unqualified total keeps its cash flow, while one that prints both
   (Nebius) has already taken the total in the first pass. */
const NET_CASH_CONTINUING = (activity) => new RegExp(
  "^net cash (?:provided by|used in|from|\\(used in\\)|\\(provided by\\))" +
  "(?:\\s*/?\\s*\\(?(?:used in|provided by)\\)?)? " + activity +
  " activities[\\s,-]*(?:from )?continuing operations$", "i");
const CF_FALLBACK = [
  [NET_CASH_CONTINUING("operating"), "cfOps"],
  [NET_CASH_CONTINUING("investing"), "cfInv"],
  [NET_CASH_CONTINUING("financing"), "cfFin"],
];

/* the first canonical tag of each concept, which the period builder reads */
const TAG = {};
for (const [k, v] of Object.entries(INCOME)) TAG[k] = v[0];
for (const [k, v] of Object.entries(BALANCE)) TAG[k] = v[0];
for (const [k, v] of Object.entries(CASHFLOW)) TAG[k] = v[0];
TAG.operatingExpenses = TAG.operatingExpenses || "OperatingExpenses";
TAG.totalLiabilities = TAG.totalLiabilities || "Liabilities";
TAG.epsBasic = "EarningsPerShareBasic"; TAG.epsDiluted = "EarningsPerShareDiluted";
TAG.basicShares = "WeightedAverageNumberOfSharesOutstandingBasic";
TAG.dilutedShares = "WeightedAverageNumberOfDilutedSharesOutstanding";
/* Tags for the lines above that concepts.mjs does not (yet) group. Each
   is the us-gaap element the same line carries in a tagged filing, and
   the "||" hands the choice to concepts.mjs the moment it defines the
   key, so this file never holds a second ladder. */
TAG.restrictedCash = TAG.restrictedCash || "RestrictedCash";
TAG.restrictedCashNoncurrent = TAG.restrictedCashNoncurrent || "RestrictedCashNoncurrent";
TAG.deferredRevenueNoncurrent = TAG.deferredRevenueNoncurrent || "ContractWithCustomerLiabilityNoncurrent";
TAG.convertibles = TAG.convertibles || "ConvertibleNotesPayable";
TAG.operatingLeaseLiabilityNoncurrent = TAG.operatingLeaseLiabilityNoncurrent || "OperatingLeaseLiabilityNoncurrent";
TAG.depreciation = TAG.depreciation || "Depreciation";
TAG.amortizationIntangibles = TAG.amortizationIntangibles || "AmortizationOfIntangibleAssets";
TAG.deferredRevenueChange = TAG.deferredRevenueChange || "IncreaseDecreaseInContractWithCustomerLiability";
TAG.acquisitions = TAG.acquisitions || "PaymentsToAcquireBusinessesNetOfCashAcquired";
TAG.convertsIssued = TAG.convertsIssued || "ProceedsFromConvertibleDebt";
TAG.debtIssuanceCosts = TAG.debtIssuanceCosts || "PaymentsOfDebtIssuanceCosts";
TAG.treasurySharesSold = TAG.treasurySharesSold || "ProceedsFromSaleOfTreasuryStock";
TAG.equityIssuanceCosts = TAG.equityIssuanceCosts || "PaymentsOfStockIssuanceCosts";
TAG.warrantsIssued = TAG.warrantsIssued || "ProceedsFromIssuanceOfWarrants";
TAG.optionsExercised = TAG.optionsExercised || "ProceedsFromStockOptionsExercised";
TAG.interestPaid = TAG.interestPaid || "InterestPaidNet";

/* A "Notes" column: note numbers printed between the label and the
   figures. Its cells are numeric ("7", "3, 9") and would otherwise be
   read as the first period's figure and shift every column, so every
   cell under that header is blanked before the rows are read. The
   header is looked for in the first ten rows and never at the row's
   first position, where a label would sit. */
function withoutNotesColumn(rows) {
  const at = new Set();
  for (const r of rows.slice(0, 10)) {
    let pos = 0;
    for (const c of r) {
      if (pos > 0 && /^notes?$/i.test(c.text.trim())) at.add(pos);
      pos += c.span;
    }
  }
  if (!at.size) return rows;
  return rows.map((r) => {
    let pos = 0;
    return r.map((c) => {
      const hit = at.has(pos);
      pos += c.span;
      return hit ? { ...c, text: "" } : c;
    });
  });
}

/* "Cost of revenues (1)", "Revenues*": the footnote marker is not part
   of the label */
const cleanLabel = (text) => text
  .replace(/[:’']/g, (ch) => ch === ":" ? "" : "'")
  .replace(/\s*\((?:\d{1,2}|[a-z]|[ivx]{1,4})\)\s*$/i, "")
  .replace(/\*+$/, "")
  .trim();

function classify(table) {
  const text = table.rows.map((r) => r.map((c) => c.text).join(" ")).join(" ");
  if (/net cash (provided by|used in|from|\(used in\))(\s*\/?\s*\(?(used in|provided by)\)?)? operating/i.test(text)) return "cashFlow";
  if (/total assets/i.test(text) && /total (current )?liabilities|shareholders'? equity/i.test(text)) return "balanceSheet";
  if (/net (loss|income|profit)/i.test(text) && /operating (expenses|loss|income)|revenues?|research and development/i.test(text)) return "incomeStatement";
  return null;
}

/**
 * Facts from one document: [{ concept, tag, start, end, val, unit }].
 * `filed` and `accn` are stamped by the caller.
 */
export function extractInterimFacts(html) {
  const facts = [];
  const seen = new Set();
  for (const table of tables(html)) {
    const kind = classify(table);
    if (!kind) continue;
    const scale = scaleOf(table.before + " " + table.rows.slice(0, 4).map((r) => r.map((c) => c.text).join(" ")).join(" "));
    const rows = withoutNotesColumn(table.rows);
    /* data rows: a label then ≥ 1 numeric cells */
    const data = rows.map((r) => {
      const label = r.find((c) => c.text && !isNumeric(c.text) && !isDash(c.text));
      const hasFigure = r.some((c) => isNumeric(c.text));
      const nums = r.filter((c) => isNumeric(c.text) || (hasFigure && isDash(c.text)))
        .map((c) => toNumber(c.text));
      return { label: label ? cleanLabel(label.text) : "", nums };
    }).filter((r) => r.nums.length);
    if (!data.length) continue;
    const dataCols = Math.max(...data.map((r) => r.nums.length));
    const cols = columnsOf(rows, dataCols);
    if (!cols) continue;
    const map = kind === "incomeStatement" ? IS_MAP : kind === "balanceSheet" ? BS_MAP : CF_MAP;
    /* two passes over the rows: the statement's own labels first, then
       the fallback patterns for whatever the first pass left unfilled */
    const passes = kind === "cashFlow" ? [map, CF_FALLBACK] : [map];
    for (const [pass, rules] of passes.entries()) {
      for (const row of data) {
        if (row.nums.length !== dataCols) continue;
        const label = row.label;
        if (!label) continue;
        let concepts = null, unit = "USD", mult = scale;
        if (pass === 0 && kind === "incomeStatement" && /per share/i.test(label)) {
          const hit = PER_SHARE_MAP.find(([re]) => re.test(label));
          if (hit) { concepts = hit[1]; unit = "USD/shares"; mult = 1; }
        } else if (pass === 0 && kind === "incomeStatement" && /weighted average/i.test(label)) {
          const hit = SHARES_MAP.find(([re]) => re.test(label));
          if (hit) { concepts = hit[1]; unit = "shares"; mult = 1; }
        } else {
          const hit = rules.find(([re]) => re.test(label));
          if (hit) concepts = Array.isArray(hit[1]) ? hit[1] : [hit[1]];
        }
        if (!concepts) continue;
        row.nums.forEach((v, i) => {
          const col = cols[i];
          if (!col) return;
          if (kind !== "balanceSheet" && !col.start) return;
          if (kind === "balanceSheet" && col.start) return;
          for (const concept of concepts) {
            const key = concept + "|" + (col.start || "") + "|" + col.end;
            if (seen.has(key)) continue;
            seen.add(key);
            facts.push({ concept, tag: TAG[concept], unit, start: kind === "balanceSheet" ? null : col.start, end: col.end,
              val: v * mult, kind });
          }
        });
      }
    }
  }
  /* a total the filer left unlabelled: operating expenses as the sum of
     the lines when no total row matched */
  return facts;
}

/**
 * Whether a document looks like it carries interim statements at all —
 * cheap enough to run on every exhibit before parsing.
 */
export function looksLikeStatements(html) {
  const t = strip(html);
  return /(three|six|nine|twelve) months ended|quarter ended|year ended/i.test(t) &&
    /net (loss|income|profit)/i.test(t) && /<table/i.test(html);
}

/**
 * Parsed facts merged into a companyfacts-shaped bucket under the tags
 * the period builder reads. `meta` = { form, filed, accn, fyEndMonth }.
 * fy/fp follow the facts feed's convention: the fiscal year the period
 * end falls in and the quarter of that end.
 */
export function factsToBucket(facts, meta, fiscalYearFor, fiscalQuarterFor) {
  const bucket = {};
  for (const f of facts) {
    if (!f.tag) continue;
    const fy = fiscalYearFor(f.end, meta.fyEndMonth);
    const q = fiscalQuarterFor(f.end, meta.fyEndMonth, f.start);
    const fp = f.start && f.end && Math.round((new Date(f.end) - new Date(f.start)) / 86400000) > 300 ? "FY" : "Q" + q;
    const b = (bucket[f.tag] = bucket[f.tag] || { units: {} });
    const u = (b.units[f.unit] = b.units[f.unit] || []);
    u.push({ start: f.start || undefined, end: f.end, val: f.val, accn: meta.accn, fy, fp, form: meta.form || "6-K",
      filed: meta.filed, frame: undefined });
  }
  return bucket;
}
