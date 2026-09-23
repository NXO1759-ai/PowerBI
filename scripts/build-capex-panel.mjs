/**
 * build-capex-panel.mjs — the hyperscaler and neocloud build-out monitor's
 * capex, sources-and-uses and debt/lease panel (blueprint section 15,
 * PR H2).
 *
 *   node scripts/build-capex-panel.mjs [--limit N] [--only TICKER,TICKER]
 *
 * For each member of frontend/data/cohorts.json this fetches companyfacts
 * live (paced, the SEC user agent scripts/lib/sec-pull.mjs already reads
 * from SEC_USER_AGENT), runs buildStatements, and writes one file per
 * cohort — frontend/data/capex/hyperscalers.json, neoclouds.json,
 * landlords.json — keyed by ticker, each point keyed by PERIOD END DATE
 * (never fiscal year and period), carrying its form, accession and the
 * tag that answered.
 *
 * What this file adds on top of buildStatements' own resolution:
 *   - the capex-adjustments.json hand-keyed second capex lines (IREN's
 *     computer-hardware payments, Cipher's deposits on equipment), added
 *     to the tagged capex line for the same span, de-cumulated the same
 *     way statements.mjs de-cumulates the tagged line itself (a quarter
 *     is its span less the earlier spans of the same fiscal year);
 *   - Nebius's quarters, which companyfacts does not carry at all (every
 *     6-K is isXBRL=0), read from the hand-keyed frontend/data/nbis-
 *     interims.json instead;
 *   - the derived ratios and totals of 15.1-15.3 (capex to operating cash
 *     flow, to revenue, to depreciation; free cash flow after capex and
 *     after buybacks and dividends; the funding gap; net debt and net
 *     debt to EBITDA; interest coverage; backlog to debt) computed from
 *     the tagged lines buildStatements already resolved, never typed;
 *   - the calendar quarter containing each period's end date, and the
 *     filer's own fiscal label, for the page's alignment rule (15.0).
 *
 * A missing input is null, never zero: the per-period `tags`,
 * `notDerivable` and `inferredZero` fields buildStatements attaches travel
 * through unchanged, so a reader can tell a genuine zero from a gap.
 * Nothing is summed across filers here — the page does cohort aggregation
 * at render, so it can state n.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildStatements, trimHistory, nearest, readDuration } from "./lib/statements.mjs";
import { fetchCompanyFactsRaw, paced } from "./lib/sec-pull.mjs";
import { CASHFLOW, labelFor } from "./lib/concepts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DAY_MS = 86400000;

/* ---------- small, pure helpers (exported for the offline test) ---------- */

/** "2026-Q2" for the calendar quarter CONTAINING the period end — the
    quarter of the date itself, never the filer's own fiscal quarter. This
    is what puts Oracle's and Applied Digital's May-ending quarter in the
    same bucket as the four hyperscalers whose quarter ends in June
    (blueprint 15.0's calendar-Q2 2026 stack). */
export function calendarQuarterOf(periodEnd) {
  if (!periodEnd) return null;
  const y = Number(periodEnd.slice(0, 4));
  const m = Number(periodEnd.slice(5, 7));
  return `${y}-Q${Math.ceil(m / 3)}`;
}

function ratio(num, den) {
  return (typeof num === "number" && typeof den === "number" && den !== 0) ? num / den : null;
}

/** null-safe difference; null if either side is missing. */
function diff(...vals) {
  if (vals.some((v) => typeof v !== "number")) return null;
  return vals.reduce((a, b, i) => (i === 0 ? b : a - b));
}

function spanDaysBetween(start, end) {
  if (!start || !end) return null;
  return Math.round((new Date(end) - new Date(start)) / DAY_MS);
}

/**
 * De-cumulate a set of hand-keyed adjustment rows the same way
 * statements.mjs de-cumulates the tagged line: rows sharing a start date
 * are one filer fiscal year, sorted shortest span first (Q1, H1, 9M, FY),
 * and each quarter is its cumulative value less the one before — with a
 * missing earlier span in the group (Cipher's 2025 Q1 and H1, already
 * recast onto the combined basis in the tagged line) taken as zero, since
 * that span's adjustment really is zero, not unknown.
 *
 * Returns one point per row, keyed by the row's own end date (the
 * discrete quarter that ends there), plus the row's own total as the
 * annual figure when its span is a fiscal year.
 */
export function decumulateAdjustmentRows(rows) {
  const groups = new Map();
  for (const r of rows) {
    const list = groups.get(r.start) || [];
    list.push(r);
    groups.set(r.start, list);
  }
  const quarterly = [];
  const annual = [];
  for (const list of groups.values()) {
    list.sort((a, b) => spanDaysBetween(a.start, a.end) - spanDaysBetween(b.start, b.end));
    let prevCumulative = 0;
    for (const r of list) {
      const delta = r.value - prevCumulative;
      const point = {
        end: r.end, value: delta, cumulative: r.value,
        form: r.form, accession: r.accession, filed: r.filed || null,
        line: r.line || r.statementLabel || null,
      };
      quarterly.push(point);
      const days = spanDaysBetween(r.start, r.end);
      if (days !== null && days >= 340 && days <= 380) {
        annual.push({ ...point, value: r.value });
      }
      prevCumulative = r.value;
    }
  }
  return { quarterly, annual };
}

/* balance-sheet keys and cash-flow keys copied straight through into the
   panel point, one place so the shape below stays short */
const SOURCES_AND_USES_KEYS = [
  "debtIssued", "debtRepaid", "otherDebtRepaid", "shortTermDebtProceeds", "shortTermDebtRepaid",
  "convertsIssued", "convertsRepaid", "equityIssued", "ipoProceeds", "preferredIssued",
  "warrantsIssued", "jvPartnerFunding", "jvInvestment", "financeLeaseAdditions", "capexAccrued",
];
const LEASE_KEYS = [
  "financeLeaseLiability", "financeLeaseAsset", "financeLeaseDue",
  "financeLeaseDueNextTwelveMonths", "financeLeaseDueYearTwo", "financeLeaseDueYearThree",
  "financeLeaseDueYearFour", "financeLeaseDueYearFive", "financeLeaseDueAfterYearFive",
  "operatingLeaseLiability", "opLeaseDue",
];
const OBLIGATION_KEYS = [
  "purchaseObligations", "contractualObligationRemainderOfFiscalYear",
  "contractualObligationNextTwelveMonths", "contractualObligationYearTwo",
  "contractualObligationYearThree", "contractualObligationYearFour",
  "contractualObligationYearFive", "contractualObligationAfterYearFive",
  "lessorBacklog", "lessorBacklogNextTwelveMonths", "lessorBacklogYearTwo",
  "lessorBacklogYearThree", "lessorBacklogYearFour", "lessorBacklogYearFive",
  "lessorBacklogThereafter", "remainingPerformanceObligation",
];
const MATURITY_KEYS = [
  "maturityRemainderOfFiscalYear", "maturityNextTwelveMonths", "maturityYearTwo",
  "maturityYearThree", "maturityYearFour", "maturityYearFive", "maturityAfterYearFive",
];

function pick(period, stmt, keys) {
  const out = {};
  for (const k of keys) {
    const v = period[stmt] ? period[stmt][k] : undefined;
    out[k] = typeof v === "number" ? v : null;
  }
  return out;
}

/** Net debt: gross debt less cash and marketable securities, restricted
    cash excluded. Some filers tag cash and short-term investments as one
    combined figure (concepts.mjs `liquidity`, CashCashEquivalentsAndShort
    TermInvestments — Alphabet); others tag the securities alone beside a
    separate cash balance. The tag each period resolved from (period.tags)
    says which, so the two are never added when the "combined" tag is the
    one that answered. */
function netDebtOf(period, cik) {
  let gross = period.balanceSheet.totalDebtPrincipal;
  /* A tagged zero beside other non-zero debt on the SAME instant is not
     really zero debt: TeraWulf's LongTermDebt resolves 0 at 2024-12-31
     while its $500m 2030 convertible notes (487,502,000 carrying) sit in
     the convertibles tag, and Cipher's LongTermDebt is 0 beside
     32,330,000 of NotesPayableCurrent. Treating that zero as real gross
     debt drove net debt negative (net cash) for a company that plainly
     carries debt. Serve null instead, the same as a genuinely missing
     tag, so the reader (latestWithField in credit-buildout.js) falls
     through to the last instant where gross debt actually resolved —
     the same fallback the file already relies on for Oracle's screened
     principal rows. */
  const convertibles = period.balanceSheet.convertibles;
  const longTermDebt = period.balanceSheet.longTermDebt;
  const shortTermDebt = period.balanceSheet.shortTermDebt;
  const otherDebtNonZero = [convertibles, longTermDebt, shortTermDebt]
    .some((v) => typeof v === "number" && v !== 0);
  if (gross === 0 && otherDebtNonZero) gross = null;
  if (typeof gross !== "number") return { value: null, grossDebt: null };
  const cash = period.balanceSheet.cash;
  const liquidity = period.balanceSheet.liquidity;
  const liquidityTag = period.tags && period.tags["balanceSheet.liquidity"];
  let cashPart = null;
  if (typeof cash === "number" || typeof liquidity === "number") {
    cashPart = liquidityTag === "CashCashEquivalentsAndShortTermInvestments"
      ? liquidity
      : (cash || 0) + (liquidity || 0);
  }
  return {
    value: typeof cashPart === "number" ? gross - cashPart : null,
    grossDebt: gross,
  };
}

/** Net debt to EBITDA and interest coverage, both trailing-four-quarter,
    both "n/m" when operating income is negative (the site never computes
    adjusted EBITDA). `ltmPeriod` is the buildLtm() entry at the same
    period end, or null where four consecutive quarters are not on file. */
function leverageOf(netDebtValue, ltmPeriod) {
  if (!ltmPeriod) return { netDebtToEbitda: null, interestCoverage: null, ebitda: null };
  const opInc = ltmPeriod.incomeStatement.operatingIncome;
  const da = ltmPeriod.cashFlow.depreciationAmortization;
  const ebitda = (typeof opInc === "number" && typeof da === "number") ? opInc + da : null;
  const interestExpense = ltmPeriod.incomeStatement.interestExpense;
  const capInterest = ltmPeriod.cashFlow.interestCapitalized;
  const interestDenom = (typeof interestExpense === "number")
    ? interestExpense + (typeof capInterest === "number" ? capInterest : 0)
    : null;
  const nm = typeof opInc === "number" && opInc <= 0;
  return {
    netDebtToEbitda: nm ? "n/m" : ratio(netDebtValue, ebitda),
    interestCoverage: nm ? "n/m" : ratio(opInc, interestDenom),
    ebitda,
  };
}

/** One panel point from a buildStatements period, plus the capex
    adjustment for that end date (if any) and the LTM entry to compute
    leverage from. `grain` is "quarter" or "annual". */
function pointFromPeriod(period, { grain, cik, adjustmentByEnd, ltmByEnd }) {
  const capexTag = period.cashFlow.capex;
  const capexOther = period.cashFlow.capexOther;
  const adj = adjustmentByEnd ? nearest(adjustmentByEnd, period.periodEnd, 5) : null;
  const taggedPlusOther = typeof capexTag === "number"
    ? capexTag + (typeof capexOther === "number" ? capexOther : 0)
    : (typeof capexOther === "number" ? capexOther : null);
  const total = typeof taggedPlusOther === "number"
    ? taggedPlusOther + (adj ? adj.value : 0)
    : (adj ? adj.value : null);

  const cfOps = period.cashFlow.cfOps;
  const revenue = period.incomeStatement.revenue;
  const da = period.cashFlow.depreciationAmortization;
  const buybacks = period.cashFlow.buybacks;
  const dividends = period.cashFlow.dividendsPaid;
  const debtRepaid = period.cashFlow.debtRepaid;

  const { value: netDebt, grossDebt } = netDebtOf(period, cik);
  const ltm = ltmByEnd ? nearest(ltmByEnd, period.periodEnd, 5) : null;
  const leverage = leverageOf(netDebt, ltm);

  const backlog = typeof period.balanceSheet.remainingPerformanceObligation === "number"
    ? period.balanceSheet.remainingPerformanceObligation
    : period.balanceSheet.lessorBacklog;

  return {
    periodEnd: period.periodEnd,
    periodStart: period.periodStart || null,
    grain,
    calendarQuarter: calendarQuarterOf(period.periodEnd),
    fiscalYear: period.fiscalYear,
    fiscalPeriod: period.fiscalPeriod,
    filerFiscalYear: period.filerFiscalYear || null,
    label: period.label,
    derived: !!period.derived,
    form: period.form || null,
    filed: period.filed || null,
    accession: period.accession || null,
    tags: period.tags || {},
    notDerivable: period.notDerivable || [],
    inferredZero: period.inferredZero || [],
    derivedFields: period.derivedFields || [],
    restated: period.restated && Object.keys(period.restated).length ? period.restated : null,

    capex: {
      tagged: typeof capexTag === "number" ? capexTag : null,
      capexOther: typeof capexOther === "number" ? capexOther : null,
      adjustment: adj ? { value: adj.value, source: "capex-adjustments.json", line: adj.line,
                          form: adj.form, accession: adj.accession, filed: adj.filed } : null,
      total,
    },
    ratios: {
      capexToOperatingCashFlow: ratio(total, cfOps),
      capexToRevenue: ratio(total, revenue),
      capexToDepreciation: ratio(total, da),
    },
    freeCashFlow: {
      afterCapex: diff(cfOps, total),
      afterCapexBuybacksDividends: diff(cfOps, total, buybacks, dividends),
    },
    fundingGap: (typeof total === "number" && typeof buybacks === "number" &&
                 typeof dividends === "number" && typeof debtRepaid === "number" &&
                 typeof cfOps === "number")
      ? total + buybacks + dividends + debtRepaid - cfOps : null,
    cashFlow: {
      cfOps: typeof cfOps === "number" ? cfOps : null,
      buybacks: typeof buybacks === "number" ? buybacks : null,
      dividendsPaid: typeof dividends === "number" ? dividends : null,
      depreciationAmortization: typeof da === "number" ? da : null,
      revenue: typeof revenue === "number" ? revenue : null,
    },
    sourcesAndUses: pick(period, "cashFlow", SOURCES_AND_USES_KEYS),
    cash: {
      cash: period.balanceSheet.cash ?? null,
      restrictedCash: period.balanceSheet.restrictedCash ?? null,
      liquidity: period.balanceSheet.liquidity ?? null,
      liquidityIncludesCash: (period.tags && period.tags["balanceSheet.liquidity"]) ===
        "CashCashEquivalentsAndShortTermInvestments",
    },
    debt: {
      grossDebt,
      longTermDebt: period.balanceSheet.longTermDebt ?? null,
      shortTermDebt: period.balanceSheet.shortTermDebt ?? null,
      convertibles: period.balanceSheet.convertibles ?? null,
      netDebt,
      netDebtToEbitda: leverage.netDebtToEbitda,
      ebitdaLtm: leverage.ebitda,
    },
    interest: {
      interestExpense: period.incomeStatement.interestExpense ?? null,
      interestPaid: period.cashFlow.interestPaid ?? null,
      interestCapitalized: period.cashFlow.interestCapitalized ?? null,
      interestCoverage: leverage.interestCoverage,
    },
    leases: {
      ...pick(period, "balanceSheet", LEASE_KEYS),
      uncommencedLeases: {
        value: period.balanceSheet.unrecordedPurchaseObligations ?? null,
        label: labelFor("unrecordedPurchaseObligations",
          period.tags && period.tags["balanceSheet.unrecordedPurchaseObligations"], cik) ||
          "Unrecorded unconditional purchase obligation",
      },
    },
    obligations: pick(period, "balanceSheet", OBLIGATION_KEYS),
    obligationsRatios: { backlogToDebt: ratio(backlog, grossDebt) },
    maturities: pick(period, "balanceSheet", MATURITY_KEYS),
  };
}

/** Trailing-four-quarter capex run-rate from the panel's OWN quarterly
    total (which already carries the hand-keyed adjustments), never last
    quarter times four, and only where four consecutive quarters (each
    within 80-100 days of the last) all carry a value. `checkValueByEnd`
    is Amazon's own TTM-tagged fact where one exists at that end date, the
    figure blueprint 15.1 checks the computed run-rate against. */
function attachRunRates(quarterlyPoints, checkValueByEnd) {
  const sorted = [...quarterlyPoints].sort((a, b) => a.periodEnd < b.periodEnd ? -1 : 1);
  for (let i = 0; i < sorted.length; i++) {
    const point = sorted[i];
    if (i < 3) { point.capexRunRate = null; continue; }
    const window = sorted.slice(i - 3, i + 1);
    let consecutive = true;
    for (let j = 1; j < 4; j++) {
      const gap = spanDaysBetween(window[j - 1].periodEnd, window[j].periodEnd);
      if (gap === null || gap < 80 || gap > 100) { consecutive = false; break; }
    }
    const values = window.map((p) => p.capex.total);
    if (!consecutive || values.some((v) => typeof v !== "number")) { point.capexRunRate = null; continue; }
    const check = checkValueByEnd ? nearest(checkValueByEnd, point.periodEnd, 5) : null;
    point.capexRunRate = {
      value: values.reduce((a, b) => a + b, 0),
      quarters: 4,
      checkValue: check ? check.value : null,
    };
  }
  return sorted;
}

/** Cash drawdown per period: the prior period's cash less this one's,
    positive meaning cash fell. Computed here (a change between two
    already-resolved balances), never re-derived from a flow. */
function attachCashDrawdown(points) {
  const sorted = [...points].sort((a, b) => a.periodEnd < b.periodEnd ? -1 : 1);
  for (let i = 0; i < sorted.length; i++) {
    const prior = i > 0 ? sorted[i - 1] : null;
    const cur = sorted[i].cash.cash;
    const prev = prior ? prior.cash.cash : null;
    sorted[i].cash.drawdown = (typeof cur === "number" && typeof prev === "number") ? prev - cur : null;
  }
  return sorted;
}

/**
 * The pure per-filer computation: a buildStatements() output (or, for
 * Nebius, a set of hand-built quarterly points) in, one filer's panel
 * entry out. Exported so scripts/test-capex-panel.mjs can call it
 * directly on fixtures without touching the network.
 */
export function buildFilerCapexPanel({ meta, statements, adjustmentRows = [] }) {
  const { quarterly: adjQuarters, annual: adjAnnual } = decumulateAdjustmentRows(adjustmentRows);
  const adjustmentByEnd = new Map(adjQuarters.map((p) => [p.end, p]));
  const adjustmentAnnualByEnd = new Map(adjAnnual.map((p) => [p.end, p]));
  const ltmByEnd = new Map(statements.ltm.map((p) => [p.periodEnd, p]));

  let quarterly = statements.quarterly.map((p) =>
    pointFromPeriod(p, { grain: "quarter", cik: meta.cik, adjustmentByEnd, ltmByEnd }));
  let annual = statements.annual.map((p) =>
    pointFromPeriod(p, { grain: "annual", cik: meta.cik, adjustmentByEnd: adjustmentAnnualByEnd, ltmByEnd }));

  const checkValueByEnd = meta.ticker === "AMZN"
    ? readDuration(statements.__bucket || {}, CASHFLOW.capex, { annual: true, spanTest: (d) => d !== null && d >= 340 && d <= 380 })
    : null;
  quarterly = attachRunRates(quarterly, checkValueByEnd);
  quarterly = attachCashDrawdown(quarterly);
  annual = attachCashDrawdown(annual);

  return {
    ticker: meta.ticker, cik: meta.cik, name: meta.name, group: meta.group,
    fyEndMonth: meta.fyEndMonth || statements.fiscalYearEndMonth,
    calendarQuarterFootnote: meta.ticker === "ORCL" || meta.ticker === "APLD",
    label: meta.label || null,
    quarterly, annual,
  };
}

/* ---------- Nebius: no companyfacts quarters, hand-keyed interims ---------- */

/** Nebius quarterly points from frontend/data/nbis-interims.json: the
    interim report's own three-month column (Q1) or the same-day earnings
    release's derived three-month column (Q2, six months less Q1), never
    from companyfacts, which carries no 6-K facts at all (every 6-K is
    isXBRL=0). Outflow lines are printed in parentheses (negative) and are
    flipped to this panel's positive-outflow convention; proceeds are
    already printed positive. Debt, lease and obligation detail is not
    available at quarterly grain for Nebius; it carries the annual
    companyfacts figures only, and the point says so. */
function nbisQuarterlyPoints(interims) {
  /* the file's own unit note: "USD millions as printed; the parser
     multiplies by 1,000,000" */
  const M = 1000000;
  const points = [];
  const push = (end, start, lines, isLines, provenance) => {
    const capex = typeof lines.capex === "number" ? Math.abs(lines.capex) * M : null;
    const cfOps = typeof lines.cfOps === "number" ? lines.cfOps * M : null;
    const da = ((typeof lines.depreciation === "number" ? lines.depreciation : 0) +
               (typeof lines.amortizationIntangibles === "number" ? lines.amortizationIntangibles : 0)) * M;
    const revenue = isLines && typeof isLines.revenue === "number" ? isLines.revenue * M : null;
    const netIncome = isLines && typeof isLines.netIncome === "number" ? isLines.netIncome * M : null;
    const operatingIncome = isLines && typeof isLines.operatingIncome === "number" ? isLines.operatingIncome * M : null;
    /* printed as an expense, in parentheses; stored as a positive
       magnitude, matching the tagged filers' interestExpense sign */
    const interestExpense = isLines && typeof isLines.interestExpense === "number" ? Math.abs(isLines.interestExpense) * M : null;
    points.push({
      periodEnd: end, periodStart: start, grain: "quarter",
      calendarQuarter: calendarQuarterOf(end),
      fiscalYear: Number(end.slice(0, 4)), fiscalPeriod: null, filerFiscalYear: null,
      label: null, derived: !!provenance.derived,
      form: provenance.form, filed: provenance.filed || null, accession: provenance.accession,
      tags: {}, notDerivable: [], inferredZero: [], derivedFields: [], restated: null,
      dataLimitation: "hand-keyed from the 6-K interim report and same-day earnings release " +
        "(frontend/data/nbis-interims.json); balance-sheet debt, lease and obligation detail is " +
        "annual only for Nebius",
      capex: { tagged: capex, capexOther: null, adjustment: null, total: capex },
      capexRunRate: null,
      ratios: {
        capexToOperatingCashFlow: ratio(capex, cfOps),
        capexToRevenue: ratio(capex, revenue), capexToDepreciation: ratio(capex, da || null),
      },
      freeCashFlow: { afterCapex: diff(cfOps, capex), afterCapexBuybacksDividends: null },
      fundingGap: null,
      cashFlow: { cfOps, buybacks: null, dividendsPaid: null, depreciationAmortization: da || null, revenue },
      incomeStatement: { revenue, netIncome, operatingIncome },
      sourcesAndUses: {
        debtIssued: null, debtRepaid: null, otherDebtRepaid: null,
        shortTermDebtProceeds: null, shortTermDebtRepaid: null,
        convertsIssued: typeof lines.convertsIssued === "number" ? lines.convertsIssued * M : null,
        convertsRepaid: null,
        equityIssued: typeof lines.treasurySharesSold === "number" ? lines.treasurySharesSold * M : null,
        ipoProceeds: null, preferredIssued: null,
        warrantsIssued: typeof lines.warrantsIssued === "number" ? lines.warrantsIssued * M : null,
        jvPartnerFunding: null, jvInvestment: null, financeLeaseAdditions: null, capexAccrued: null,
      },
      cash: { cash: null, restrictedCash: null, liquidity: null, liquidityIncludesCash: false, drawdown: null },
      debt: { grossDebt: null, longTermDebt: null, shortTermDebt: null, convertibles: null,
              netDebt: null, netDebtToEbitda: null, ebitdaLtm: null },
      interest: { interestExpense, interestPaid: null, interestCapitalized: null, interestCoverage: null },
      leases: Object.fromEntries(LEASE_KEYS.map((k) => [k, null])),
      obligations: Object.fromEntries(OBLIGATION_KEYS.map((k) => [k, null])),
      obligationsRatios: { backlogToDebt: null },
      maturities: Object.fromEntries(MATURITY_KEYS.map((k) => [k, null])),
    });
  };

  /* Cash-flow figures for a genuine discrete quarter: either the report's
     own three-month column (Q1 only — Nebius's Q2 interim statement
     carries six months and no three-month column at all) or, where the
     report has none, the matching row of derivedQuarters (the six months
     less the first quarter, read from the same-day earnings release's own
     three-month table and checked against it — see nbis-interims.json). A
     span is a quarter at 80-100 days, matching statements.mjs's own band. */
  const quarterCf = new Map();
  for (const report of interims.reports || []) {
    for (const cf of report.statements.cashFlow || []) {
      const days = spanDaysBetween(cf.start, cf.end);
      if (days !== null && days >= 80 && days <= 100) {
        quarterCf.set(cf.end, { lines: cf.lines, start: cf.start,
          form: report.form, filed: report.filed, accession: report.accession, derived: false });
      }
    }
  }
  for (const dq of interims.derivedQuarters || []) {
    if (!quarterCf.has(dq.end)) {
      quarterCf.set(dq.end, { lines: dq.lines, start: dq.start, form: "6-K", filed: null,
        accession: interims.printedQuarters ? interims.printedQuarters.accession : null, derived: true });
    }
  }
  /* the income statement carries a genuine three-month column in every
     report (Nebius's income statement, unlike its cash-flow statement,
     is not six-month-only) */
  const quarterIs = new Map();
  for (const report of interims.reports || []) {
    for (const is of report.statements.incomeStatement || []) {
      const days = spanDaysBetween(is.start, is.end);
      if (days !== null && days >= 80 && days <= 100) quarterIs.set(is.end, is.lines);
    }
  }
  for (const [end, cf] of quarterCf) {
    push(end, cf.start, cf.lines, quarterIs.get(end) || {},
      { form: cf.form, filed: cf.filed, accession: cf.accession, derived: cf.derived });
  }
  return attachRunRates(points, null);
}

/** Nebius's whole capex-panel entry: annual figures from its trimmed
    companyfacts (20-F only; the Yandex years are cut at historyStart),
    quarters from the hand-keyed interims. */
function buildNebiusPanel({ meta, statements, interims }) {
  const ltmByEnd = new Map(statements.ltm.map((p) => [p.periodEnd, p]));
  const annual = attachCashDrawdown(statements.annual.map((p) =>
    pointFromPeriod(p, { grain: "annual", cik: meta.cik, adjustmentByEnd: null, ltmByEnd })));
  const quarterly = interims ? nbisQuarterlyPoints(interims) : [];
  return {
    ticker: meta.ticker, cik: meta.cik, name: meta.name, group: meta.group,
    fyEndMonth: meta.fyEndMonth || statements.fiscalYearEndMonth,
    calendarQuarterFootnote: false, label: meta.label || null,
    quarterly, annual,
  };
}

/* ---------- I/O: cohorts, adjustments, interims, writeIfChanged ---------- */

function loadJson(relPath) {
  const p = join(ROOT, relPath);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

function adjustmentRowsFor(ticker, adjustments) {
  if (!adjustments || !Array.isArray(adjustments.adjustments)) return [];
  return adjustments.adjustments.filter((r) => r.ticker === ticker);
}

/* Same pattern as scripts/refresh-bdc.mjs: a file is rewritten only when
   its content actually changed, so an unchanged week's run touches
   nothing and the weekly commit carries no run timestamp to force a diff. */
function writeIfChanged(path, text) {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  writeFileSync(path, text, "utf8");
  return true;
}

function cohortMembers(cohorts, group) {
  return (cohorts[group] || []).map((row) => ({
    ticker: row.ticker, cik: row.cik, name: row.name, group,
    fyEndMonth: row.fyEndMonth || null, historyStart: row.historyStart || null,
    label: row.label || null,
  }));
}

/* ---------- main ---------- */

async function main() {
  const argv = process.argv.slice(2);
  const LIMIT = Number((argv[argv.indexOf("--limit") + 1]) || 0) || 0;
  const onlyIdx = argv.indexOf("--only");
  const ONLY = onlyIdx >= 0 ? new Set(argv[onlyIdx + 1].split(",").map((t) => t.trim().toUpperCase())) : null;

  const cohorts = loadJson("frontend/data/cohorts.json");
  if (!cohorts) { console.error("frontend/data/cohorts.json not found"); process.exitCode = 1; return; }
  const adjustments = loadJson("frontend/data/capex-adjustments.json");
  const nbisInterims = loadJson("frontend/data/nbis-interims.json");

  const groups = { hyperscalers: cohortMembers(cohorts, "hyperscalers"),
                    neoclouds: cohortMembers(cohorts, "neoclouds"),
                    landlords: cohortMembers(cohorts, "landlords") };

  let members = [...groups.hyperscalers, ...groups.neoclouds, ...groups.landlords];
  if (ONLY) members = members.filter((m) => ONLY.has(m.ticker));
  if (LIMIT) members = members.slice(0, LIMIT);

  console.log(`capex panel: ${members.length} filers`);
  const byTicker = new Map();
  const failures = [];

  for (const meta of members) {
    await paced();
    let raw = null;
    try {
      raw = await fetchCompanyFactsRaw(meta.cik, { timeoutMs: 45000 });
    } catch (e) {
      failures.push(`${meta.ticker} ${e.message}`);
    }
    if (!raw || !raw.facts || !raw.facts["us-gaap"]) {
      failures.push(`${meta.ticker} no us-gaap facts`);
      continue;
    }
    let bucket = raw.facts["us-gaap"];
    if (meta.historyStart) bucket = trimHistory(bucket, meta.historyStart);
    const statements = buildStatements(bucket, { annualLimit: 12, quarterLimit: 24, fyEndMonth: meta.fyEndMonth || undefined });
    statements.__bucket = bucket;

    if (meta.ticker === "NBIS") {
      byTicker.set(meta.ticker, buildNebiusPanel({ meta, statements, interims: nbisInterims }));
      process.stdout.write(".");
      continue;
    }
    const adjustmentRows = adjustmentRowsFor(meta.ticker, adjustments);
    byTicker.set(meta.ticker, buildFilerCapexPanel({ meta, statements, adjustmentRows }));
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  const outDir = join(ROOT, "frontend/data/capex");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  let wrote = 0;
  for (const [group, list] of Object.entries(groups)) {
    /* Seed from whatever this cohort file already carries, so a
       --limit/--only run (or a filer this run failed to fetch) leaves
       every OTHER company's last-written entry alone rather than
       dropping it — the same "keep last week's" behaviour the BDC layer
       uses on its own hiccups. A member no longer in cohorts.json is
       still dropped, since it is named explicitly below. */
    const existingPath = join(outDir, `${group}.json`);
    const existingDoc = existsSync(existingPath) ? JSON.parse(readFileSync(existingPath, "utf8")) : null;
    const existingCompanies = (existingDoc && existingDoc.companies) || {};
    const companies = {};
    for (const m of list) {
      const entry = byTicker.get(m.ticker);
      if (entry) companies[m.ticker] = entry;
      else if (existingCompanies[m.ticker]) companies[m.ticker] = existingCompanies[m.ticker];
    }
    const doc = {
      cohort: group,
      generatedBy: "scripts/build-capex-panel.mjs",
      quarterGrid: "keyed by period-end date; the calendar quarter containing it, never the " +
        "filer's own fiscal year and period (blueprint 15.0)",
      companies,
    };
    const text = JSON.stringify(doc, null, 1) + "\n";
    const path = join(outDir, `${group}.json`);
    if (writeIfChanged(path, text)) wrote++;
  }

  console.log(`wrote ${wrote} of 3 cohort files (unchanged files were left as they were)`);
  if (failures.length) console.log(`failures (${failures.length}): ${failures.join(", ")}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
