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
 *
 * Every period says where each figure came from and what was inferred:
 *   tags          the tag each line resolved from, keyed "statement.key"
 *                 ("A+B" for a composite of two lines)
 *   derivedFields lines recovered from a year-to-date span
 *   inferredZero  lines a financing key took as zero because the filer's
 *                 statement for that quarter had no such line
 *                 (concepts.mjs ABSENT_IS_ZERO)
 *   notDerivable  lines the arithmetic declined: the inputs resolved from
 *                 different tags (the same-tag rule, MIXABLE), or a
 *                 proceeds line came out negative (NEVER_NEGATIVE)
 */

import { INCOME, BALANCE, CASHFLOW, PERSHARE, SHARE_COUNTS, COMPOSITES, PURE,
         FILL_ONLY, FILL_COMPOSITES, FILL_CONTINUES, END_DATED_BALANCE, REPORTED_AS_BALANCE,
         MIXABLE, ABSENT_IS_ZERO, NEVER_NEGATIVE, ZERO_YIELDS, SUM_FIRST } from "./concepts.mjs";

const DAY_MS = 86400000;
/* A period cannot end after the day it is read. Oracle's feed carries one
   fact dated 2199-12-31 (RestructuringAndRelatedCostExpectedCost, a
   placeholder in a 10-Q/A filed 2010-09-29), and any reader that sorts by
   end date would put it first. */
const TODAY = new Date().toISOString().slice(0, 10);
/* Periodic reports, plus the 6-K interim reports of foreign private
   issuers: a filer that tags its half-year or quarterly statements on
   Form 6-K has real periods there. Dropping the form left Enlivex with a
   2025 annual report and nothing between it and 2016. */
export const REPORT_FORM = /^(10-K|10-Q|20-F|40-F|6-K)(\/A)?$/;

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

/* Days between a period end and the nearest month-end of the filer's
   fiscal-year-end month, in either direction. */
function daysFromFiscalYearEnd(end, fyEndMonth) {
  const t = new Date(end + "T00:00:00Z").getTime();
  const y = Number(end.slice(0, 4));
  let best = Infinity;
  for (const yy of [y - 1, y, y + 1]) {
    /* day 0 of the next month is the last day of this one */
    const me = Date.UTC(yy, fyEndMonth, 0);
    best = Math.min(best, Math.abs(me - t) / DAY_MS);
  }
  return best;
}

/**
 * An annual-length span is a fiscal year only where it ends at one.
 *
 * Amazon tags a trailing-twelve-month figure on every cash-flow line of
 * its 10-Qs (173,028,000,000 of capex for 2025-07-01..2026-06-30, in the
 * 10-Q filed 2026-07-31), and by span length alone that row is a year:
 * before this rule it became a "2026" fiscal year in the strategy panel,
 * with a null revenue beside it, and its twenty-eight trailing windows
 * crowded the real years before 2020 out of the panel's history.
 *
 * An annual report is trusted whatever its end month, because a year-end
 * change is real: Goldman Sachs and Morgan Stanley closed November years
 * until 2008 and December years after, and ServiceNow's first two years
 * ended in June. A span in any other filing counts only where its end
 * sits at the filer's fiscal year end, within the days a 52/53-week
 * calendar moves it. That keeps the full-year comparatives a 10-Q
 * restates after a recast — American Express's 2007 operating cash flow
 * of 8,500,000,000 lives in a 10-Q filed 2010-08-05 — and drops every
 * trailing-twelve-month row, since none of those ends at a year end.
 * Until the year end is known (the first pass that finds it) a 10-Q span
 * is not trusted at all.
 */
function isFiscalYearRow(row, fyEndMonth) {
  const form = String(row.form || "");
  if (/^(10-K|20-F|40-F)/.test(form)) return true;
  if (!fyEndMonth) return !/^10-Q/.test(form);
  return daysFromFiscalYearEnd(row.end, fyEndMonth) <= 10;
}

/* The span test for a series, with the fiscal-year rule folded in for
   annual grains. */
function spanFilter({ annual, spanTest, fyEndMonth }) {
  const test = spanTest || (annual ? isAnnualSpan : isQuarterSpan);
  return (r) => test(spanDays(r)) && (!annual || spanTest || isFiscalYearRow(r, fyEndMonth));
}

/* Later filings restate earlier periods. Keyed on the period itself, the
   last one filed wins — an amendment supersedes the original, which is
   the same precedence sql/06_canonical_views.sql applies. */
export function keepLatestFiled(rows) {
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
function pickRows(bucket, tags, reader, fill = [], { zeroYields = false } = {}) {
  const fillSet = new Set(fill);
  const collect = (list, into, skip) => {
    for (const tag of list) {
      for (const row of reader(bucket, tag)) {
        if (!row.end || row.end > TODAY) continue;
        if (skip && skip.has(row.end)) continue;
        const key = `${row.start || ""}|${row.end}|${row.form}|${row.accn || ""}`;
        /* every row remembers the tag it resolved from: the period it
           lands in carries the tag (period.tags), and the arithmetic
           across periods checks it (sameTag) */
        const prev = into.get(key);
        if (!prev) into.set(key, { ...row, tag });
        /* a financing line tagged zero yields to a lower-ranked tag's
           non-zero row for the same span and filing (concepts.mjs
           ZERO_YIELDS: TeraWulf's 2024 convertible proceeds) */
        else if (zeroYields && !skip && prev.val === 0 && row.val !== 0 && row.val != null) into.set(key, { ...row, tag });
      }
    }
  };
  const byPeriod = new Map();
  collect(tags.filter((t) => !fillSet.has(t)), byPeriod);
  /* The fill-only tier (FILL_ONLY in concepts.mjs) may add a period END
     no filing reported under the tags above, never re-decide one. The
     test is the end date, not the span: Arthur J. Gallagher tags its
     combined D&A year to date only and plain depreciation for the
     quarter as well, so a span-level test would let the quarter's
     depreciation (50,000,000 for the three months to 2025-06-30) stand
     in for a quarter that the year-to-date figures put at 230,000,000. */
  const reported = new Set([...byPeriod.values()].map((r) => r.end));
  collect(tags.filter((t) => fillSet.has(t)), byPeriod, reported);
  return [...byPeriod.values()];
}

/* The period ends the tags reported in any filing at any span: the set a
   fill tier may not touch (the end-date rule above). */
function reportedEnds(bucket, tags, reader) {
  const ends = new Set();
  for (const tag of tags) {
    for (const row of reader(bucket, tag)) {
      if (row.end && row.end <= TODAY) ends.add(row.end);
    }
  }
  return ends;
}

/* Whether a tag string came from a fill tier (FILL_ONLY, or a
   FILL_COMPOSITES sum written as "A+B") for the key; a fill tag that
   continues the primary line under a new name (FILL_CONTINUES) counts
   as a primary. */
function isFillTag(key, tag) {
  if (!tag) return false;
  if ((FILL_CONTINUES[key] || []).includes(tag)) return false;
  if ((FILL_ONLY[key] || []).includes(tag)) return true;
  return (FILL_COMPOSITES[key] || []).some((parts) => parts.join("+") === tag);
}

/**
 * The same-tag rule for arithmetic across periods (concepts.mjs MIXABLE).
 *
 * Returns the tag the result inherits, null where no input carried one
 * (inferred zeros carry none), or false where the inputs resolved from
 * different tags and the arithmetic must not proceed: a year filled from
 * Depreciation less three quarters of DepreciationDepletionAndAmortization
 * is not a fourth quarter (Merck 2020: -1,052,000,000). The MIXABLE keys
 * keep the cross-alternate arithmetic the site served before the fill
 * tiers existed, and the rule bites for them only when a fill-tier tag is
 * among the inputs.
 */
function sameTag(key, path, periods) {
  const tags = periods.map((p) => p.tags && p.tags[path]).filter((t) => t != null);
  if (!tags.length) return null;
  if (new Set(tags).size === 1) return tags[0];
  if (MIXABLE.has(key) && !tags.some((t) => isFillTag(key, t))) return tags[0];
  return false;
}

/* A null in a period for one of the ABSENT_IS_ZERO keys is zero when the
   period is on file (it is a built period, so its anchors were reported)
   and the null is not one the derivations declined to fill. */
function absentIsZero(period, key, path) {
  return ABSENT_IS_ZERO.has(key) && !(period.notDerivable || []).includes(path);
}
const mark = (period, list, path) => {
  if (!period[list]) period[list] = [];
  if (!period[list].includes(path)) period[list].push(path);
};

/* ---------- period extraction ---------- */

/* Largest candidate per period rather than first-tag-wins. Used for
   revenue, where the alternates are a mix of totals and components of
   totals and no fixed ordering separates them for every filer. */
function maxDurationSeries(bucket, tags, opts) {
  const out = new Map();
  for (const tag of tags) {
    for (const [end, row] of durationSeries(bucket, [tag], opts)) {
      const prev = out.get(end);
      if (!prev || row.value > prev.value) out.set(end, row);
    }
  }
  return out;
}

/* Fill periods the primary tags missed by summing disclosed components.
   Every component must be present for the period, and an existing value is
   never overwritten. */
function fillFromComposites(series, bucket, field, opts) {
  const groups = COMPOSITES[field];
  if (!groups) return series;
  for (const parts of groups) {
    const partSeries = parts.map((t) => durationSeries(bucket, [t], opts));
    const ends = new Set(partSeries.flatMap((m) => [...m.keys()]));
    for (const end of ends) {
      if (series.has(end)) continue;
      const rows = partSeries.map((m) => m.get(end));
      if (rows.some((r) => !r)) continue;
      const total = rows.reduce((a, r) => a + r.value, 0);
      series.set(end, { ...rows[0], value: total, composite: parts.slice(), tag: parts.join("+") });
    }
  }
  return series;
}

function durationSeries(bucket, tags, opts) {
  const fill = opts.fill || [];
  const composites = opts.fillComposites || [];
  const primary = fill.length ? tags.filter((t) => !fill.includes(t)) : tags;
  const keep = (rows) => rows
    .filter((r) => REPORT_FORM.test(r.form || "") && r.end)
    .filter(spanFilter(opts));
  const toRow = (r) => ({ value: r.val, end: r.end, start: r.start,
                          filed: r.filed, form: r.form, fy: r.fy, fp: r.fp,
                          accn: r.accn || null, tag: r.tag });
  const out = new Map();
  for (const r of keepLatestFiled(keep(pickRows(bucket, primary, usdRows, [], { zeroYields: opts.zeroYields })))) out.set(r.end, toRow(r));
  if (!fill.length && !composites.length) return out;

  /* The fill tiers, in order: a composite of two lines the filer tags
     separately (FILL_COMPOSITES), then a single alternate (FILL_ONLY).
     Either may add a period END the primary tags never reported, in any
     filing at any span, and never re-decide one (the end-date rule in
     pickRows). */
  const reported = reportedEnds(bucket, primary, usdRows);
  for (const parts of composites) {
    const partSeries = parts.map((t) => durationSeries(bucket, [t], { ...opts, fill: [], fillComposites: [] }));
    for (const end of new Set(partSeries.flatMap((m) => [...m.keys()]))) {
      if (reported.has(end) || out.has(end)) continue;
      const rows = partSeries.map((m) => m.get(end));
      if (rows.some((r) => !r)) continue;
      out.set(end, { ...rows[0], value: rows.reduce((a, r) => a + r.value, 0),
                     composite: parts.slice(), tag: parts.join("+") });
    }
  }
  if (fill.length) {
    const skip = new Set([...reported, ...out.keys()]);
    const rows = keep(pickRows(bucket, fill, usdRows).filter((r) => !skip.has(r.end)));
    for (const r of keepLatestFiled(rows)) if (!out.has(r.end)) out.set(r.end, toRow(r));
  }
  return out;
}

/**
 * What every filing said about a period, before the latest one wins.
 *
 * Two things live only in the earlier rows. The company's OWN name for
 * the period: a 10-K's fy field is the fiscal year the FILING covers, so
 * the FY2024 comparative inside the FY2025 10-K carries fy=2025 — the
 * original filing is the one whose fy names the period as the company
 * does (Microsoft's year to June 2026 is its FY2026; Target's year to
 * February 2025 is its fiscal 2024). And restatements: when the latest
 * filing reports a different value for a period than the original did,
 * that revision is a fact a reader should see, not a silent overwrite.
 */
function provenance(bucket, tags, opts) {
  const { annual, instant } = opts;
  const keep = spanFilter(opts);
  const rows = pickRows(bucket, tags, usdRows, opts.fill, { zeroYields: opts.zeroYields })
    .filter((r) => REPORT_FORM.test(r.form || "") && r.end)
    .filter((r) => (instant ? !r.start : keep(r)));
  const byKey = new Map();
  /* A filing's fy and fp describe the filing's OWN period, and every
     filing also carries comparatives from a year earlier under the same
     fy. The filing's own period is the latest end among its rows, so a
     row is trusted for naming only when its end is that latest end. */
  const ownEnd = new Map();
  for (const r of rows) {
    const key = instant ? r.end : `${r.start || ""}|${r.end}`;
    (byKey.get(key) || byKey.set(key, []).get(key)).push(r);
    const a = r.accn || "";
    if (!ownEnd.has(a) || r.end > ownEnd.get(a)) ownEnd.set(a, r.end);
  }
  const out = new Map();
  for (const [, list] of byKey) {
    list.sort((a, b) => String(a.filed).localeCompare(String(b.filed)));
    const first = list[0], last = list[list.length - 1];
    const revised = list.length > 1 && first.val !== last.val &&
      Math.abs(last.val - first.val) > Math.abs(first.val || 1) * 0.005;
    const isQ = (r) => /^Q[1-4]$/.test(r.fp || "");
    const isOwn = (r) => ownEnd.get(r.accn || "") === r.end;
    let named = list.find((r) => isOwn(r) && (annual ? r.fp === "FY" : isQ(r)));
    let fy = named ? named.fy : null, fp = named ? named.fp : null;
    /* A period reported only as a comparative — a new listing's first
       year — takes the naming of the filing it appears in, one year
       back, since a comparative sits exactly a fiscal year behind. */
    if (!named) {
      const carrier = list.find((r) => (annual ? r.fp === "FY" : isQ(r)) && r.fy);
      if (carrier && ownEnd.get(carrier.accn || "")) {
        const gap = (new Date(ownEnd.get(carrier.accn || "")) - new Date(carrier.end)) / DAY_MS;
        if (gap > 300 && gap < 430) { fy = carrier.fy - 1; fp = carrier.fp; }
      }
    }
    out.set(first.end, {
      fy: fy,
      fp: fp,
      restated: revised ? {
        original: { value: first.val, filed: first.filed, form: first.form },
        latest: { value: last.val, filed: last.filed, form: last.form },
      } : null,
    });
  }
  return out;
}

/* SUM_FIRST (concepts.mjs): both parts tagged at an end date, from the
   same filing, add up to the balance and outrank every single tag. */
function sumFirstRows(bucket, rule) {
  const parts = rule.parts;
  const byKey = new Map();
  for (const tag of parts) {
    for (const r of usdRows(bucket, tag)) {
      if (!r.end || r.start || r.end > TODAY || !REPORT_FORM.test(r.form || "")) continue;
      const key = r.end + "|" + (r.accn || r.form);
      (byKey.get(key) || byKey.set(key, new Map()).get(key)).set(tag, r);
    }
  }
  const rows = [];
  for (const m of byKey.values()) {
    if (m.size !== parts.length) continue;
    const first = m.get(parts[0]);
    if (rule.onlyIfFirstBelowSecond && !(first.val < m.get(parts[1]).val)) continue;
    rows.push({ ...first, val: parts.reduce((a, t) => a + m.get(t).val, 0), tag: parts.join("+") });
  }
  return rows;
}

function instantSeries(bucket, tags, fill, screen, sumFirst = []) {
  /* a screen drops a tag's row before the ladder resolves the period,
     so the next tag at that date can take it */
  const reader = screen
    ? (b, tag) => usdRows(b, tag).filter((r) => screen({ ...r, tag }))
    : usdRows;
  const rows = pickRows(bucket, tags, reader, fill)
    .filter((r) => REPORT_FORM.test(r.form || "") && r.end && !r.start);
  const summed = sumFirst.flatMap((rule) => sumFirstRows(bucket, rule));
  const summedEnds = new Set(summed.map((r) => r.end));
  const out = new Map();
  for (const r of keepLatestFiled(rows.filter((r) => !summedEnds.has(r.end)).concat(summed))) {
    out.set(r.end, { value: r.val, end: r.end, filed: r.filed,
                     form: r.form, fy: r.fy, fp: r.fp, accn: r.accn || null, tag: r.tag });
  }
  return out;
}

/**
 * A PURE-unit instant reader (concepts.mjs PURE), modeled on
 * instantSeries: the tag's value is a ratio already expressed as a
 * fraction — a coupon rate, never a dollar amount — so it is read from
 * the "pure" unit bucket via unitRows rather than usdRows, and the value
 * is never scaled or rounded to a whole number. DebtWeightedAverageInterestRate
 * is the one tag Underwriting reads this way (blueprint section 5): rare
 * among operating companies and, where a filer does tag it, annual-only
 * (RTX 0.045 at 2025-12-31, tagged in the 10-K, absent from both 2026
 * 10-Qs), so the card falls back to interest expense over average debt
 * wherever this reads null.
 */
function pureInstantSeries(bucket, tags, fill = []) {
  const reader = (b, tag) => unitRows(b, tag, "pure");
  const rows = pickRows(bucket, tags, reader, fill)
    .filter((r) => REPORT_FORM.test(r.form || "") && r.end && !r.start);
  const out = new Map();
  for (const r of keepLatestFiled(rows)) {
    out.set(r.end, { value: r.val, end: r.end, filed: r.filed,
                     form: r.form, fy: r.fy, fp: r.fp, accn: r.accn || null, tag: r.tag });
  }
  return out;
}

/** The raw reader, for a builder that needs a pure-unit tag's series with
    its provenance rather than a resolved statement line. */
export { pureInstantSeries as readPureInstant };

/* A balance read by END DATE whether the filer tagged it as an instant or
   over the period (END_DATED_BALANCE). Where a period end carries more
   than one row the ladder rank decides first (the earlier tag wins), then
   an instant beats a duration, then the row filed last. Rank came first
   after Alphabet's uncommenced leases, an instant under the third tag of
   the purchaseObligations ladder, displaced its 232,700,000,000 purchase
   commitment, a duration under the second, at 2026-03-31. */
function endDatedSeries(bucket, tags, fill) {
  const rows = pickRows(bucket, tags, usdRows, fill)
    .filter((r) => REPORT_FORM.test(r.form || "") && r.end);
  const out = new Map();
  const rank = (r) => tags.indexOf(r.tag);
  /* sorted so the row that should win comes LAST and overwrites */
  const ranked = keepLatestFiled(rows).sort((a, b) =>
    (rank(b) - rank(a)) ||
    ((a.start ? 0 : 1) - (b.start ? 0 : 1)) ||
    String(a.filed).localeCompare(String(b.filed)));
  for (const r of ranked) {
    out.set(r.end, { value: r.val, end: r.end, start: r.start || null, filed: r.filed,
                     form: r.form, fy: r.fy, fp: r.fp, accn: r.accn || null, tag: r.tag });
  }
  return out;
}

/**
 * The screen on DebtInstrumentCarryingAmount before it resolves as
 * totalDebtPrincipal (blueprint 15.3). Two ways the tag carries something
 * other than the filer's total principal, both seen 2026-09-11:
 *
 *   - Oracle files each quarter's NEW ISSUE under it at 10-Q dates:
 *     18,000,000,000 at 2025-11-30 and 43,000,000,000 at 2026-02-28
 *     (10-Qs 0001193125-25-315925 and 0001193125-26-101045) against
 *     130,105,000,000 in the 10-K to 2026-05-31, while its balance sheet
 *     carried 99,984 + 8,091 and 124,718 + 9,887 million of notes at those
 *     dates. A row below half the debt the balance sheet carries at the
 *     same date (the longTermDebt and shortTermDebt ladders), or below
 *     half the filer's latest earlier annual-report row of the same tag,
 *     is an issue size, not the total.
 *   - Amazon files its NON-CURRENT carrying amount under it:
 *     128,894,000,000 at 2026-06-30 is its LongTermDebtNoncurrent to the
 *     dollar (10-Q 0001018724-26-000026), beside 132,995,000,000 of face
 *     under LongTermDebt and 3,330,000,000 of current maturities. A row
 *     equal to LongTermDebtNoncurrent at the same date is that balance.
 *
 * A screened row falls through to the next tag of the ladder at that
 * date, or to null, which a card shows as "last tagged <date>".
 */
function principalScreen(bucket) {
  const noncurrent = instantSeries(bucket, ["LongTermDebtNoncurrent"]);
  const longTerm = instantSeries(bucket, BALANCE.longTermDebt, FILL_ONLY.longTermDebt);
  const shortTerm = instantSeries(bucket, BALANCE.shortTermDebt, FILL_ONLY.shortTermDebt);
  const annualRows = usdRows(bucket, "DebtInstrumentCarryingAmount")
    .filter((r) => !r.start && r.end && r.end <= TODAY && /^(10-K|20-F|40-F)/.test(r.form || ""))
    .sort((a, b) => String(a.end).localeCompare(String(b.end)));
  return (r) => {
    if (r.tag !== "DebtInstrumentCarryingAmount") return true;
    const nc = noncurrent.get(r.end);
    if (nc && nc.value === r.val) return false;
    const lt = longTerm.get(r.end), st = shortTerm.get(r.end);
    if (lt && r.val < (lt.value + (st ? st.value : 0)) / 2) return false;
    if (!/^(10-K|20-F|40-F)/.test(r.form || "")) {
      const prior = annualRows.filter((a) => a.end < r.end).pop();
      if (prior && r.val < prior.val / 2) return false;
    }
    return true;
  };
}
const SCREENS = { totalDebtPrincipal: principalScreen };

/** The raw readers, for a builder that needs one tag's series with its
    provenance rather than a resolved statement line. */
export { durationSeries as readDuration, instantSeries as readInstant, endDatedSeries as readEndDated };

/**
 * A companyfacts bucket cut to the facts ending on or after `from`.
 *
 * A CIK can outlive the company: TeraWulf's is the IKONICS Corp shell it
 * reverse-merged into in December 2021, so its feed carries a photo-imaging
 * company's 2010-2020 statements, and Nebius's is Yandex N.V.'s, whose
 * USD facts run from 2011. frontend/data/cohorts.json names the first
 * period end that is the company's own (historyStart), and the panel
 * builder cuts the bucket here before it builds statements, so a year
 * before the start never reaches the panel. A fact that spans the start
 * (a fiscal year ending after it) is kept: the cut is on the end date.
 */
export function trimHistory(bucket, from) {
  if (!from || !bucket) return bucket;
  const out = {};
  for (const [tag, c] of Object.entries(bucket)) {
    const units = {};
    for (const [u, rows] of Object.entries((c && c.units) || {})) {
      const kept = Array.isArray(rows) ? rows.filter((r) => r.end && r.end >= from) : rows;
      if (!Array.isArray(kept) || kept.length) units[u] = kept;
    }
    out[tag] = { ...c, units };
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
export function nearest(map, end, toleranceDays = 5) {
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
export function buildStatementSeries(bucket, { annual, limit = 20, fyEndMonth, spanTest } = {}) {
  const opts = { annual, spanTest, fyEndMonth };
  const optsFor = (k) => ({
    ...opts,
    fill: FILL_ONLY[k] || [],
    fillComposites: FILL_COMPOSITES[k] || [],
    zeroYields: ZERO_YIELDS.has(k),
  });

  const income = {};
  for (const [k, tags] of Object.entries(INCOME)) {
    income[k] = k === "revenue"
      ? maxDurationSeries(bucket, tags, opts)
      : durationSeries(bucket, tags, optsFor(k));
    fillFromComposites(income[k], bucket, k, opts);
  }
  const cash = {};
  for (const [k, tags] of Object.entries(CASHFLOW)) {
    cash[k] = durationSeries(bucket, tags, optsFor(k));
  }
  const balance = {};
  for (const [k, tags] of Object.entries(BALANCE)) {
    balance[k] = END_DATED_BALANCE.has(k)
      ? endDatedSeries(bucket, tags, FILL_ONLY[k])
      : instantSeries(bucket, tags, FILL_ONLY[k], SCREENS[k] ? SCREENS[k](bucket) : null, SUM_FIRST[k] || []);
  }
  const perShare = {};
  for (const [k, tags] of Object.entries(PERSHARE)) {
    perShare[k] = perShareSeries(bucket, tags, opts);
  }
  const shares = {};
  for (const [k, tags] of Object.entries(SHARE_COUNTS)) {
    shares[k] = shareSeries(bucket, tags, opts);
  }
  /* concepts.mjs PURE: an instant ratio tag (DebtWeightedAverageInterestRate)
     read from the "pure" unit bucket, kept apart from balance so a reader
     never mistakes a fraction for a dollar figure. */
  const pure = {};
  for (const [k, tags] of Object.entries(PURE)) {
    pure[k] = pureInstantSeries(bucket, tags);
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
  /* the filer's own names, and every revision, read from all filings */
  const naming = provenance(bucket, INCOME.revenue, opts);
  const namingAlt = provenance(bucket, INCOME.netIncome, opts);
  const revisions = {};
  for (const [k, tags] of Object.entries(INCOME)) revisions["incomeStatement." + k] = provenance(bucket, tags, optsFor(k));
  for (const [k, tags] of Object.entries(CASHFLOW)) revisions["cashFlow." + k] = provenance(bucket, tags, optsFor(k));
  for (const [k, tags] of Object.entries(BALANCE)) revisions["balanceSheet." + k] = provenance(bucket, tags, { instant: true, fill: FILL_ONLY[k] });

  const periods = anchors.slice(-limit).map((end) => {
    /* Period metadata comes from whichever core item reported it. */
    const rev = income.revenue.get(end) || income.netIncome.get(end) ||
                income.operatingIncome.get(end) || cash.cfOps.get(end);
    const fy = fiscalYearFor(end, fyEnd);
    const fq = fiscalQuarterFor(end, fyEnd, rev.start);
    const own = naming.get(end) || namingAlt.get(end) || {};
    /* The company's own label where the filing states it; the derived
       calendar-aligned year otherwise. The aligned year is kept for
       cross-company work, since a June year-end and a December one can
       only be compared on a shared calendar. */
    const filerFy = own.fy || null;
    const filerFp = annual ? "FY" : (own.fp && /^Q[1-4]$/.test(own.fp) ? own.fp : `Q${fq}`);
    const period = {
      periodEnd: end,
      periodStart: rev.start || null,
      fiscalYear: fy,
      fiscalPeriod: annual ? "FY" : `Q${fq}`,
      filerFiscalYear: filerFy,
      filerPeriod: filerFp,
      label: filerFy
        ? (annual ? `FY${filerFy}` : `${filerFp} FY${filerFy}`)
        : (annual ? `FY ${fy}` : `Q${fq} ${fy}`),
      form: rev.form,
      filed: rev.filed,
      accession: rev.accn,
      incomeStatement: {},
      balanceSheet: {},
      cashFlow: {},
      perShare: {},
      shares: {},
      pure: {},
      restated: {},
      /* the tag each line resolved from, keyed "statement.key", for
         every line that carries a value; a composite reads "A+B" */
      tags: {},
    };
    const take = (stmt, k, hit) => {
      period[stmt][k] = val(hit);
      if (hit && typeof hit.value === "number" && hit.tag) period.tags[stmt + "." + k] = hit.tag;
    };
    for (const k of Object.keys(income)) take("incomeStatement", k, income[k].get(end));
    for (const k of Object.keys(cash)) take("cashFlow", k, cash[k].get(end));
    for (const k of Object.keys(balance)) take("balanceSheet", k, nearest(balance[k], end));
    for (const k of Object.keys(perShare)) period.perShare[k] = val(perShare[k].get(end));
    for (const k of Object.keys(shares)) period.shares[k] = val(nearest(shares[k], end, 40));
    for (const k of Object.keys(pure)) take("pure", k, nearest(pure[k], end));
    for (const [path, map] of Object.entries(revisions)) {
      const p = map.get(end);
      if (p && p.restated) period.restated[path] = p.restated;
    }
    return period;
  });

  /* A filer's own year can repeat. Oracle's 10-Q for the quarter to
     2026-08-31, the first quarter of its fiscal 2027 (filed 2026-09-11,
     0001193125-26-389274), carries fy=2026 like the 10-Q for the quarter
     to 2025-08-31, so both read "Q1 FY2026"; CrowdStrike's 10-K for the
     year to January 2023 carries fy=2022 like the one for the year to
     January 2022, and the next two years follow one behind. A period
     whose filer label an earlier period already holds is moved on a
     year, and again while the label is still taken, so a chain of
     repeats resolves in order. Only a repeat moves: a gap in the labels
     (Cipher's first year, a 2020 period its 10-K/A files as fy=2021,
     followed by fiscal 2022) is left as the filer names it. */
  const used = new Map();
  for (const p of periods) {
    if (!p.filerFiscalYear) continue;
    let key = `${p.filerPeriod}|${p.filerFiscalYear}`;
    let moved = false;
    while (used.has(key) &&
           (new Date(p.periodEnd) - new Date(used.get(key).periodEnd)) / DAY_MS >= 300) {
      p.filerFiscalYear += 1;
      moved = true;
      key = `${p.filerPeriod}|${p.filerFiscalYear}`;
    }
    if (moved) p.label = annual ? `FY${p.filerFiscalYear}` : `${p.filerPeriod} FY${p.filerFiscalYear}`;
    if (!used.has(key)) used.set(key, p);
  }

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

    const q4 = {
      periodEnd: year.periodEnd,
      periodStart: q3.periodEnd,
      fiscalYear: year.fiscalYear,
      fiscalPeriod: "Q4",
      filerFiscalYear: year.filerFiscalYear || null,
      filerPeriod: "Q4",
      label: year.filerFiscalYear ? `Q4 FY${year.filerFiscalYear}` : `Q4 ${year.fiscalYear}`,
      form: year.form,
      filed: year.filed,
      accession: year.accession,
      restated: {},
      derived: true,
      incomeStatement: {},
      balanceSheet: { ...year.balanceSheet },
      cashFlow: {},
      perShare: {},
      shares: { ...year.shares },
      /* an instant ratio, like a balance: the year-end reading IS the Q4
         reading, never a subtraction */
      pure: { ...year.pure },
      tags: {},
    };
    for (const [path, tag] of Object.entries(year.tags || {})) {
      if (path.startsWith("balanceSheet.") || path.startsWith("pure.")) q4.tags[path] = tag;
    }

    const subtract = (statement, key) => {
      const path = statement + "." + key;
      const full = year[statement][key];
      /* a period-end balance restated in every year-to-date column is
         the year's figure at year end, not the year less its quarters */
      if (REPORTED_AS_BALANCE.has(key)) {
        if (typeof full !== "number") return null;
        if (year.tags && year.tags[path]) q4.tags[path] = year.tags[path];
        return full;
      }
      if (typeof full !== "number") return null;
      let inferred = false;
      const parts = [q1, q2, q3].map((q) => {
        const v = q[statement][key];
        if (typeof v === "number") return v;
        if (absentIsZero(q, key, path)) { inferred = true; return 0; }
        return null;
      });
      if (parts.some((p) => p === null)) return null;
      /* the year and the quarters must have resolved from one tag */
      const tag = sameTag(key, path, [year, q1, q2, q3]);
      if (tag === false) return null;
      const value = full - parts.reduce((s, p) => s + p, 0);
      if (NEVER_NEGATIVE.has(key) && value < 0) { mark(q4, "notDerivable", path); return null; }
      if (inferred) mark(q4, "inferredZero", path);
      if (tag) q4.tags[path] = tag;
      return value;
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
    /* a pre-revenue company still has a fourth quarter: its net income
       is as derivable as anyone else's revenue */
    if (q4.incomeStatement.revenue !== null || q4.incomeStatement.netIncome !== null) derived.push(q4);
  }
  return derived;
}

/** Both grains from one bucket, with Q4 filled in. */
/**
 * Quarters recovered from a year-to-date span.
 *
 * A 10-Q reports the quarter AND the year to date, so a half-year of
 * $418.5m alongside a second quarter of $201.8m states the first quarter
 * at $216.7m as surely as if it were tagged. The subtraction is only
 * made when exactly one quarter of the span is missing and the rest are
 * present, so a gap of two quarters never collapses into one overstated
 * period.
 *
 * This matters most for a company whose facts feed carries a single
 * filing: a recent listing has no annual report for deriveFourthQuarters
 * to work from, and without this its dashboard shows two quarters where
 * the filing supports four.
 */
function deriveFromYearToDate(bucket, quarterly, fyEndMonth) {
  const ytdSpan = (d) => d !== null &&
    ((d >= 150 && d <= 200) || (d >= 240 && d <= 290));
  const ytd = buildStatementSeries(bucket, { spanTest: ytdSpan, limit: 40, fyEndMonth });
  const byEnd = new Map(quarterly.map((p) => [p.periodEnd, p]));
  const out = [];
  for (const span of ytd) {
    const days = Math.round(
      (new Date(span.periodEnd) - new Date(span.periodStart || span.periodEnd)) / DAY_MS);
    const quartersInSpan = days > 220 ? 3 : 2;
    /* the quarter ends this span covers, walking back from its own end */
    const ends = [];
    let cur = new Date(span.periodEnd + "T00:00:00");
    for (let i = 0; i < quartersInSpan; i++) {
      ends.push(cur.toISOString().slice(0, 10));
      cur = new Date(cur.getTime() - 91 * DAY_MS);
    }
    /* match loosely: 52/53-week filers close a few days either side */
    const matched = ends.map((e) => {
      let best = null, bestGap = Infinity;
      for (const p of quarterly) {
        const gap = Math.abs(new Date(p.periodEnd) - new Date(e));
        if (gap < bestGap) { bestGap = gap; best = p; }
      }
      return bestGap <= 20 * DAY_MS ? best : null;
    });
    const missingAt = matched.indexOf(null);
    if (missingAt === -1) continue;
    if (matched.filter((x) => x === null).length !== 1) continue;
    const known = matched.filter(Boolean);
    const derivedEnd = ends[missingAt];
    if (byEnd.has(derivedEnd)) continue;
    /* subtract the known quarters from the span, statement by statement */
    /* Every consumer of a period reads the same shape, so a derived one
       carries every group a reported one does — per-share figures and
       share counts null, since neither is a flow that can be subtracted
       out of a year-to-date span. */
    const period = { periodEnd: derivedEnd, periodStart: null, label: null,
      fiscalYear: null, fiscalPeriod: null, derived: true,
      incomeStatement: {}, balanceSheet: {}, cashFlow: {},
      perShare: {}, shares: {}, pure: {}, tags: {} };
    for (const k of Object.keys(span.perShare || {})) period.perShare[k] = null;
    for (const k of Object.keys(span.shares || {})) period.shares[k] = null;
    let anyValue = false;
    for (const stmt of ["incomeStatement", "cashFlow"]) {
      for (const key of Object.keys(span[stmt] || {})) {
        const path = stmt + "." + key;
        const total = span[stmt][key];
        /* the span's balance belongs to the span's own end, not to the
           quarter being recovered */
        if (typeof total !== "number" || REPORTED_AS_BALANCE.has(key)) { period[stmt][key] = null; continue; }
        let rest = 0, complete = true, inferred = false;
        for (const q of known) {
          const v = q[stmt][key];
          if (typeof v === "number") { rest += v; continue; }
          if (absentIsZero(q, key, path)) { inferred = true; continue; }
          complete = false; break;
        }
        if (!complete) { period[stmt][key] = null; continue; }
        /* the span and the known quarters must have resolved from one tag */
        const tag = sameTag(key, path, [span, ...known]);
        if (tag === false) { period[stmt][key] = null; mark(period, "notDerivable", path); continue; }
        const value = total - rest;
        if (NEVER_NEGATIVE.has(key) && value < 0) { period[stmt][key] = null; mark(period, "notDerivable", path); continue; }
        period[stmt][key] = value;
        if (inferred) mark(period, "inferredZero", path);
        if (tag) period.tags[path] = tag;
        anyValue = true;
      }
    }
    /* A balance sheet is a point in time and cannot be subtracted; the
       derived quarter carries none rather than a wrong one. A pure-unit
       instant ratio belongs to the span's own end for the same reason. */
    for (const key of Object.keys(span.balanceSheet || {})) period.balanceSheet[key] = null;
    for (const key of Object.keys(span.pure || {})) period.pure[key] = null;
    if (!anyValue || (period.incomeStatement.revenue === null && period.incomeStatement.netIncome === null)) continue;
    period.fiscalYear = fiscalYearFor(derivedEnd, fyEndMonth);
    period.fiscalPeriod = "Q" + fiscalQuarterFor(derivedEnd, fyEndMonth, null);
    /* the span's own filing names the year the derived quarter sits in */
    period.filerFiscalYear = span.filerFiscalYear || null;
    period.filerPeriod = period.fiscalPeriod;
    period.label = span.filerFiscalYear
      ? period.fiscalPeriod + " FY" + span.filerFiscalYear
      : period.fiscalPeriod + " " + period.fiscalYear;
    out.push(period);
    byEnd.set(derivedEnd, period);
  }
  return out;
}

/**
 * Cash flow for the quarters a 10-Q reports only year to date.
 *
 * The income statement in a 10-Q carries the quarter and the year to
 * date; the cash flow statement carries only the year to date. So a
 * second quarter's income statement is tagged directly while its cash
 * flow exists only as a six-month span, and a third quarter's only as a
 * nine-month span. Every quarter but the first therefore lacked cash
 * flow, and with it every LTM cash figure.
 *
 * The span less the quarters before it is the quarter: H1 − Q1 = Q2,
 * 9M − (Q1 + Q2) = Q3. The subtraction fills a null in the span's own
 * last quarter only, and only from earlier quarters that carry the
 * figure, so nothing is ever overwritten and nothing is derived from a
 * gap. Applies to income-statement lines a filer tags only year to date
 * as well.
 */
function fillFromYearToDate(bucket, quarterly, fyEndMonth) {
  const ytdSpan = (d) => d !== null &&
    ((d >= 150 && d <= 200) || (d >= 240 && d <= 290));
  const ytd = buildStatementSeries(bucket, { spanTest: ytdSpan, limit: 40, fyEndMonth });
  const closest = (e) => {
    let best = null, bestGap = Infinity;
    for (const p of quarterly) {
      const gap = Math.abs(new Date(p.periodEnd) - new Date(e));
      if (gap < bestGap) { bestGap = gap; best = p; }
    }
    return bestGap <= 20 * DAY_MS ? best : null;
  };
  let filled = 0;
  for (const span of ytd) {
    const days = Math.round(
      (new Date(span.periodEnd) - new Date(span.periodStart || span.periodEnd)) / DAY_MS);
    const n = days > 220 ? 3 : 2;
    const ends = [];
    let cur = new Date(span.periodEnd + "T00:00:00");
    for (let i = 0; i < n; i++) {
      ends.push(cur.toISOString().slice(0, 10));
      cur = new Date(cur.getTime() - 91 * DAY_MS);
    }
    const matched = ends.map(closest);
    if (matched.some((q) => !q)) continue;
    const last = matched[0], earlier = matched.slice(1);
    for (const stmt of ["cashFlow", "incomeStatement"]) {
      for (const key of Object.keys(span[stmt] || {})) {
        const path = stmt + "." + key;
        if (typeof last[stmt][key] === "number") continue;
        if ((last.notDerivable || []).includes(path)) continue;
        const total = span[stmt][key];
        if (typeof total !== "number") continue;
        /* a period-end balance in the year-to-date column IS the
           quarter-end figure; nothing to subtract */
        if (REPORTED_AS_BALANCE.has(key)) {
          last[stmt][key] = total;
          if (span.tags && span.tags[path]) last.tags[path] = span.tags[path];
          (last.derivedFields || (last.derivedFields = [])).push(path);
          filled++;
          continue;
        }
        let rest = 0, complete = true;
        const zeros = [];
        for (const q of earlier) {
          const v = q[stmt][key];
          if (typeof v === "number") { rest += v; continue; }
          /* a financing line absent from an earlier quarter's statement
             was zero in that quarter (concepts.mjs ABSENT_IS_ZERO) */
          if (absentIsZero(q, key, path)) { zeros.push(q); continue; }
          complete = false; break;
        }
        if (!complete) continue;
        /* the span and the earlier quarters must have resolved from one tag */
        const tag = sameTag(key, path, [span, ...earlier]);
        if (tag === false) { mark(last, "notDerivable", path); continue; }
        const value = total - rest;
        if (NEVER_NEGATIVE.has(key) && value < 0) { mark(last, "notDerivable", path); continue; }
        for (const q of zeros) { q[stmt][key] = 0; mark(q, "inferredZero", path); }
        last[stmt][key] = value;
        if (tag) last.tags[path] = tag;
        (last.derivedFields || (last.derivedFields = [])).push(path);
        filled++;
      }
    }
  }
  return filled;
}

export function buildStatements(bucket, { annualLimit = 10, quarterLimit = 20, fyEndMonth: fyOverride } = {}) {
  const annualEnds = [...durationSeries(bucket, INCOME.revenue, { annual: true }).keys()];
  /* A company with no annual filing yet gives fiscalYearEndMonth nothing
     to read, so an override from the registrant's own cover page is used
     when the caller has one. */
  const fyEndMonth = fyOverride || fiscalYearEndMonth(annualEnds);
  const annual = buildStatementSeries(bucket, { annual: true, limit: annualLimit, fyEndMonth });
  let quarterly = buildStatementSeries(bucket, { annual: false, limit: quarterLimit, fyEndMonth });

  /* missing quarters first, then the year-to-date-only lines of the
     reported ones, then Q4 from the year less the three now-complete
     quarters — the order matters: a Q4 cash flow needs Q2 and Q3 to
     carry theirs */
  quarterly = quarterly
    .concat(deriveFromYearToDate(bucket, quarterly, fyEndMonth))
    .sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)));
  fillFromYearToDate(bucket, quarterly, fyEndMonth);
  quarterly = quarterly
    .concat(deriveFourthQuarters(annual, quarterly))
    .sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)));

  return { annual, quarterly, ltm: buildLtm(quarterly), fiscalYearEndMonth: fyEndMonth };
}

/**
 * Trailing twelve months at every quarter end: the four most recent
 * consecutive quarters summed for flows, the latest quarter's balance
 * sheet taken as it stands.
 *
 * LTM is the working basis of professional analysis because it is the
 * most recent full year at every point in time — a fiscal year is nine
 * months stale by its third quarter, and a single quarter carries the
 * season. A window is built only where all four quarters are present and
 * consecutive (each end within 100 days of the last), so a missing
 * quarter yields no window rather than a three-quarter figure dressed as
 * a year. Per-share figures sum across the four quarters; share counts
 * are the latest quarter's.
 */
function buildLtm(quarterly) {
  const out = [];
  for (let i = 3; i < quarterly.length; i++) {
    const win = quarterly.slice(i - 3, i + 1);
    let consecutive = true;
    for (let j = 1; j < 4; j++) {
      const gap = (new Date(win[j].periodEnd) - new Date(win[j - 1].periodEnd)) / DAY_MS;
      if (gap < 80 || gap > 100) { consecutive = false; break; }
    }
    if (!consecutive) continue;
    const last = win[3];
    const period = {
      periodEnd: last.periodEnd,
      periodStart: win[0].periodStart || null,
      fiscalYear: last.fiscalYear,
      fiscalPeriod: "LTM",
      filerFiscalYear: last.filerFiscalYear,
      filerPeriod: "LTM",
      label: "LTM " + last.label.replace(/^Q\d\s*/, "").replace(/^(FY)?\s*/, (m) => m),
      basis: "ltm",
      derived: win.some((q) => q.derived),
      form: last.form, filed: last.filed, accession: last.accession,
      incomeStatement: {}, balanceSheet: {}, cashFlow: {}, perShare: {}, shares: {}, pure: {},
      restated: {},
      tags: {},
    };
    period.label = "LTM " + last.label;
    const sum = (stmt, key) => {
      const path = stmt + "." + key;
      if (REPORTED_AS_BALANCE.has(key)) {
        if (typeof last[stmt][key] !== "number") return null;
        if (last.tags && last.tags[path]) period.tags[path] = last.tags[path];
        return last[stmt][key];
      }
      let total = 0, inferred = false;
      for (const q of win) {
        const v = q[stmt][key];
        if (typeof v === "number") { total += v; continue; }
        if (absentIsZero(q, key, path)) { inferred = true; continue; }
        return null;
      }
      /* four quarters summed must have resolved from one tag */
      const tag = sameTag(key, path, win);
      if (tag === false) return null;
      if (inferred) mark(period, "inferredZero", path);
      if (tag) period.tags[path] = tag;
      return total;
    };
    for (const k of Object.keys(last.incomeStatement)) period.incomeStatement[k] = sum("incomeStatement", k);
    for (const k of Object.keys(last.cashFlow)) period.cashFlow[k] = sum("cashFlow", k);
    for (const k of Object.keys(last.balanceSheet)) {
      period.balanceSheet[k] = last.balanceSheet[k];
      if (last.tags && last.tags["balanceSheet." + k]) period.tags["balanceSheet." + k] = last.tags["balanceSheet." + k];
    }
    /* an instant ratio, like a balance sheet figure: the latest quarter's
       reading stands for the trailing year, never a sum of four */
    for (const k of Object.keys(last.pure || {})) {
      period.pure[k] = last.pure[k];
      if (last.tags && last.tags["pure." + k]) period.tags["pure." + k] = last.tags["pure." + k];
    }
    for (const k of Object.keys(last.perShare)) period.perShare[k] = sum("perShare", k);
    for (const k of Object.keys(last.shares)) period.shares[k] = last.shares[k];
    /* a derived quarter carries no per-share figure, so the sum fails
       whenever the window holds one; LTM earnings over the latest share
       count is the figure an analyst would compute instead */
    const ni = period.incomeStatement.netIncome;
    if (typeof ni === "number") {
      if (period.perShare.epsDiluted === null && typeof period.shares.dilutedShares === "number" && period.shares.dilutedShares > 0) {
        period.perShare.epsDiluted = ni / period.shares.dilutedShares;
      }
      if (period.perShare.epsBasic === null && typeof period.shares.basicShares === "number" && period.shares.basicShares > 0) {
        period.perShare.epsBasic = ni / period.shares.basicShares;
      }
    }
    out.push(period);
  }
  return out;
}

/**
 * Shares outstanding from the cover page of the latest report — the
 * dei:EntityCommonStockSharesOutstanding fact, dated a few weeks after
 * the period end. A multi-class filer reports one row per class under
 * the same date and filing; they are summed. Returns null when the
 * feed carries none.
 */
export function coverShares(deiBucket) {
  const tag = deiBucket && deiBucket.EntityCommonStockSharesOutstanding;
  const rows = tag && tag.units && tag.units.shares;
  if (!Array.isArray(rows) || !rows.length) return null;
  const groups = new Map();
  for (const r of rows) {
    if (typeof r.val !== "number" || !r.end) continue;
    const key = r.end + "|" + (r.accn || r.filed || "");
    const g = groups.get(key) || { end: r.end, filed: r.filed || null, form: r.form || null, value: 0, classes: 0 };
    g.value += r.val;
    g.classes++;
    groups.set(key, g);
  }
  let best = null;
  for (const g of groups.values()) {
    if (!best || g.end > best.end || (g.end === best.end && String(g.filed) > String(best.filed))) best = g;
  }
  return best ? { value: best.value, asOf: best.end, filed: best.filed, form: best.form, classes: best.classes } : null;
}
