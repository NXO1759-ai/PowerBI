/**
 * statements.mjs — multi-period financial statements from raw XBRL.
 *
 * The Company Overview needs two periods. Statement analysis needs a
 * history: trends, common-size statements over time, multi-year DuPont,
 * and averages of balance sheet figures. This builds that series.
 *
 * Periods are identified by the LENGTH OF THE REPORTED SPAN, not by
 * subtracting year-to-date figures. EDGAR tags a Q3 10-Q with both a
 * three-month and a nine-month duration for the same concept; picking the
 * ~90-day row gives a true discrete quarter directly. Subtracting YTD
 * figures gets the same answer when every quarter is present and a wrong
 * one when any is missing, which is the common case near a fiscal-year
 * change or a restatement.
 *
 * Instant items (balance sheet) carry no span and are read as reported at
 * each period end.
 */

import { INCOME, BALANCE, CASHFLOW, PERSHARE, SHARE_COUNTS } from "./concepts.mjs";

const DAY_MS = 86400000;
const REPORT_FORM = /^(10-K|10-Q|20-F|40-F)(\/A)?$/;

/* A quarter is nominally 91 days and an annual period 365, but fiscal
   calendars run 13-week quarters and 52/53-week years, and filers round
   period boundaries to month ends. These bands accept the real spread
   without letting a half-year masquerade as a quarter. */
const QUARTER_MIN = 80, QUARTER_MAX = 100;
const ANNUAL_MIN = 340, ANNUAL_MAX = 380;

function spanDays(row) {
  if (!row.start || !row.end) return null;
  return Math.round((new Date(row.end) - new Date(row.start)) / DAY_MS);
}

function isQuarterSpan(d) { return d !== null && d >= QUARTER_MIN && d <= QUARTER_MAX; }
function isAnnualSpan(d) { return d !== null && d >= ANNUAL_MIN && d <= ANNUAL_MAX; }

/* Later filings restate earlier periods. Keyed on the period itself, the
   last one filed wins — an amendment supersedes the original, which is
   the same precedence sql/06_canonical_views.sql applies. */
function keepLatestFiled(rows) {
  const best = new Map();
  for (const r of rows) {
    const key = `${r.start || ""}|${r.end}`;
    const prior = best.get(key);
    if (!prior || String(r.filed) > String(prior.filed)) best.set(key, r);
  }
  return [...best.values()];
}

function usdRows(bucket, tag) {
  const c = bucket && bucket[tag];
  const units = (c && c.units) || {};
  const rows = units.USD;
  return Array.isArray(rows) ? rows : [];
}
function unitRows(bucket, tag, unit) {
  const c = bucket && bucket[tag];
  const units = (c && c.units) || {};
  for (const key of Object.keys(units)) {
    if (key === unit || key.startsWith(unit)) {
      const rows = units[key];
      if (Array.isArray(rows)) return rows;
    }
  }
  return [];
}

/**
 * Merge an ordered alternate list into one row set, PER PERIOD.
 *
 * Resolving to whichever single tag has the most rows breaks any company
 * that changed tags mid-history. NVIDIA reported revenue under
 * RevenueFromContractWithCustomerExcludingAssessedTax through FY2022 and
 * under Revenues from FY2023, so a first-tag-wins resolver returns a
 * series that stops in 2022 and silently drops every recent year.
 *
 * Each period takes the earliest tag in the list that reported it, so tag
 * preference is still honoured where both exist, and the series stays
 * continuous across a change.
 */
function pickRows(bucket, tags, reader) {
  const byPeriod = new Map();
  for (const tag of tags) {
    for (const row of reader(bucket, tag)) {
      const key = `${row.start || ""}|${row.end}|${row.form}|${row.accn || ""}`;
      if (!byPeriod.has(key)) byPeriod.set(key, row);
    }
  }
  return [...byPeriod.values()];
}

/* ---------- period extraction ---------- */

function durationSeries(bucket, tags, { annual }) {
  const rows = pickRows(bucket, tags, usdRows)
    .filter((r) => REPORT_FORM.test(r.form || "") && r.end)
    .filter((r) => (annual ? isAnnualSpan(spanDays(r)) : isQuarterSpan(spanDays(r))));
  const out = new Map();
  for (const r of keepLatestFiled(rows)) {
    out.set(r.end, { value: r.val, end: r.end, start: r.start,
                     filed: r.filed, form: r.form, fy: r.fy, fp: r.fp,
                     accn: r.accn || null });
  }
  return out;
}

function instantSeries(bucket, tags) {
  const rows = pickRows(bucket, tags, usdRows)
    .filter((r) => REPORT_FORM.test(r.form || "") && r.end && !r.start);
  const out = new Map();
  for (const r of keepLatestFiled(rows)) {
    out.set(r.end, { value: r.val, end: r.end, filed: r.filed,
                     form: r.form, fy: r.fy, fp: r.fp, accn: r.accn || null });
  }
  return out;
}

function perShareSeries(bucket, tags, { annual }) {
  const rows = pickRows(bucket, tags, (b, t) => unitRows(b, t, "USD/shares"))
    .filter((r) => REPORT_FORM.test(r.form || "") && r.end)
    .filter((r) => (annual ? isAnnualSpan(spanDays(r)) : isQuarterSpan(spanDays(r))));
  const out = new Map();
  for (const r of keepLatestFiled(rows)) out.set(r.end, { value: r.val, end: r.end });
  return out;
}

function shareSeries(bucket, tags, { annual }) {
  const rows = pickRows(bucket, tags, (b, t) => unitRows(b, t, "shares"))
    .filter((r) => REPORT_FORM.test(r.form || "") && r.end)
    .filter((r) => !r.start || (annual ? isAnnualSpan(spanDays(r)) : isQuarterSpan(spanDays(r))));
  const out = new Map();
  for (const r of keepLatestFiled(rows)) out.set(r.end, { value: r.val, end: r.end });
  return out;
}

/* Balance sheet dates rarely coincide exactly with an income statement
   period end — a filer may close the books on the 28th and tag the
   balance sheet to the 30th. Match within a few days before giving up. */
function nearest(map, end, toleranceDays = 5) {
  if (map.has(end)) return map.get(end);
  const target = new Date(end).getTime();
  let best = null, bestGap = Infinity;
  for (const [k, v] of map) {
    const gap = Math.abs(new Date(k).getTime() - target) / DAY_MS;
    if (gap <= toleranceDays && gap < bestGap) { best = v; bestGap = gap; }
  }
  return best;
}

const val = (hit) => (hit && typeof hit.value === "number" ? hit.value : null);

/* ---------- fiscal calendar ----------
 *
 * EDGAR's `fy` and `fp` describe the FILING, not the period. A 10-K
 * carries three years of comparatives and tags all of them with the
 * filing's fiscal year, so reading `fy` labels three different Apple
 * years all "FY 2025". Everything below is derived from the period end
 * date and the company's own fiscal year-end month instead.
 */

const monthOf = (iso) => Number(String(iso).slice(5, 7));
const yearOf = (iso) => Number(String(iso).slice(0, 4));

/** The month a company closes its books, taken from its annual periods. */
export function fiscalYearEndMonth(annualEnds) {
  if (!annualEnds.length) return 12;
  const counts = {};
  for (const end of annualEnds) {
    const m = monthOf(end);
    counts[m] = (counts[m] || 0) + 1;
  }
  return Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]);
}

/**
 * The fiscal year a period end belongs to: the year of the first
 * fiscal-year-end falling on or after it. A fiscal year closing in the
 * first half of the calendar year is named for the year it began, which
 * is why a retailer's FY2024 ends in January 2025.
 */
export function fiscalYearFor(end, fyEndMonth) {
  const y = yearOf(end), m = monthOf(end);
  const fyEndCalendarYear = m <= fyEndMonth ? y : y + 1;
  return fyEndMonth <= 6 ? fyEndCalendarYear - 1 : fyEndCalendarYear;
}

/**
 * Which quarter of its fiscal year a period falls in, 1 through 4.
 *
 * Classified by the MIDPOINT of the period, not its end. Companies on a
 * 52/53-week calendar close a quarter a few days either side of the month
 * boundary: Coca-Cola's first quarter of 2026 runs to April 3rd, and
 * reading the end month alone calls that Q2. The midpoint of a quarter
 * sits squarely inside it however the edges fall.
 */
export function fiscalQuarterFor(end, fyEndMonth, start) {
  const ref = midpoint(start, end);
  const monthsIntoYear = (((ref - fyEndMonth - 1 + 12) % 12) + 1);
  return Math.ceil(monthsIntoYear / 3);
}

/** Month number at the centre of a period, or the end month if no start. */
function midpoint(start, end) {
  if (!start) return monthOf(end);
  const a = new Date(start).getTime(), b = new Date(end).getTime();
  if (isNaN(a) || isNaN(b)) return monthOf(end);
  return new Date((a + b) / 2).getUTCMonth() + 1;
}

/**
 * Build a period series. `annual: true` gives fiscal years; false gives
 * discrete quarters.
 *
 * Returns newest-last, so charts and trend arithmetic read left to right.
 */
export function buildStatementSeries(bucket, { annual, limit = 20, fyEndMonth } = {}) {
  const opts = { annual };

  const income = {};
  for (const [k, tags] of Object.entries(INCOME)) {
    income[k] = durationSeries(bucket, tags, opts);
  }
  const cash = {};
  for (const [k, tags] of Object.entries(CASHFLOW)) {
    cash[k] = durationSeries(bucket, tags, opts);
  }
  const balance = {};
  for (const [k, tags] of Object.entries(BALANCE)) {
    balance[k] = instantSeries(bucket, tags);
  }
  const perShare = {};
  for (const [k, tags] of Object.entries(PERSHARE)) {
    perShare[k] = perShareSeries(bucket, tags, opts);
  }
  const shares = {};
  for (const [k, tags] of Object.entries(SHARE_COUNTS)) {
    shares[k] = shareSeries(bucket, tags, opts);
  }

  /* Which periods exist is the union of the periods in which ANY core
     duration item was reported. Anchoring on revenue alone loses
     pre-revenue companies: Kraig Biocraft files quarterly with no sales,
     so a revenue anchor yields a single period and no trend at all. Net
     income and operating cash flow are reported by every filer regardless
     of whether it has customers yet. */
  const anchorSet = new Set([
    ...income.revenue.keys(),
    ...income.netIncome.keys(),
    ...income.operatingIncome.keys(),
    ...cash.cfOps.keys(),
  ]);
  const anchors = [...anchorSet].sort();
  const fyEnd = fyEndMonth || fiscalYearEndMonth(anchors);
  const periods = anchors.slice(-limit).map((end) => {
    /* Period metadata comes from whichever core item reported it. */
    const rev = income.revenue.get(end) || income.netIncome.get(end) ||
                income.operatingIncome.get(end) || cash.cfOps.get(end);
    const fy = fiscalYearFor(end, fyEnd);
    const fq = fiscalQuarterFor(end, fyEnd, rev.start);
    const period = {
      periodEnd: end,
      periodStart: rev.start || null,
      fiscalYear: fy,
      fiscalPeriod: annual ? "FY" : `Q${fq}`,
      label: annual ? `FY ${fy}` : `Q${fq} ${fy}`,
      form: rev.form,
      filed: rev.filed,
      accession: rev.accn,
      incomeStatement: {},
      balanceSheet: {},
      cashFlow: {},
      perShare: {},
      shares: {},
    };
    for (const k of Object.keys(income)) period.incomeStatement[k] = val(income[k].get(end));
    for (const k of Object.keys(cash)) period.cashFlow[k] = val(cash[k].get(end));
    for (const k of Object.keys(balance)) period.balanceSheet[k] = val(nearest(balance[k], end));
    for (const k of Object.keys(perShare)) period.perShare[k] = val(perShare[k].get(end));
    for (const k of Object.keys(shares)) period.shares[k] = val(nearest(shares[k], end, 40));
    return period;
  });

  return periods;
}

/**
 * Derive the fourth quarter, which most filers never tag.
 *
 * A 10-K reports the full year, not a discrete Q4, so a quarterly series
 * built purely from ~90-day spans has a hole every fourth period. Q4 is
 * the year minus the first three quarters for anything measured over a
 * period; balance sheet figures need no arithmetic because the year-end
 * balance IS the Q4 balance.
 *
 * Only derived when all three earlier quarters are present — with one
 * missing the subtraction silently produces a Q4 inflated by the gap.
 */
function deriveFourthQuarters(annual, quarterly) {
  const byYear = new Map();
  for (const q of quarterly) {
    if (!byYear.has(q.fiscalYear)) byYear.set(q.fiscalYear, new Map());
    byYear.get(q.fiscalYear).set(q.fiscalPeriod, q);
  }
  const derived = [];
  for (const year of annual) {
    const quarters = byYear.get(year.fiscalYear);
    if (!quarters || quarters.has("Q4")) continue;
    const q1 = quarters.get("Q1"), q2 = quarters.get("Q2"), q3 = quarters.get("Q3");
    if (!q1 || !q2 || !q3) continue;

    const subtract = (statement, key) => {
      const full = year[statement][key];
      const parts = [q1, q2, q3].map((q) => q[statement][key]);
      if (typeof full !== "number" || parts.some((p) => typeof p !== "number")) {
        return null;
      }
      return full - parts.reduce((s, p) => s + p, 0);
    };

    const q4 = {
      periodEnd: year.periodEnd,
      periodStart: q3.periodEnd,
      fiscalYear: year.fiscalYear,
      fiscalPeriod: "Q4",
      label: `Q4 ${year.fiscalYear}`,
      form: year.form,
      filed: year.filed,
      accession: year.accession,
      derived: true,
      incomeStatement: {},
      balanceSheet: { ...year.balanceSheet },
      cashFlow: {},
      perShare: {},
      shares: { ...year.shares },
    };
    for (const k of Object.keys(year.incomeStatement)) {
      q4.incomeStatement[k] = subtract("incomeStatement", k);
    }
    for (const k of Object.keys(year.cashFlow)) {
      q4.cashFlow[k] = subtract("cashFlow", k);
    }
    /* Per-share figures are not additive across quarters — the share
       count moves — so they are left null rather than back-solved. */
    for (const k of Object.keys(year.perShare)) q4.perShare[k] = null;
    if (q4.incomeStatement.revenue !== null) derived.push(q4);
  }
  return derived;
}

/** Both grains from one bucket, with Q4 filled in. */
export function buildStatements(bucket, { annualLimit = 10, quarterLimit = 20 } = {}) {
  const annualEnds = [...durationSeries(bucket, INCOME.revenue, { annual: true }).keys()];
  const fyEndMonth = fiscalYearEndMonth(annualEnds);
  const annual = buildStatementSeries(bucket, { annual: true, limit: annualLimit, fyEndMonth });
  let quarterly = buildStatementSeries(bucket, { annual: false, limit: quarterLimit, fyEndMonth });

  quarterly = quarterly
    .concat(deriveFourthQuarters(annual, quarterly))
    .sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)));

  return { annual, quarterly, fiscalYearEndMonth: fyEndMonth };
}
