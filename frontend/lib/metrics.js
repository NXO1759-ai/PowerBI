/**
 * metrics.js — the single definition of every derived figure on this site.
 *
 * Three consumers load this exact file, so a metric can never mean two
 * things at once:
 *   browser        <script src="lib/metrics.js">  -> window.RTMetrics
 *   serverless     import ... createRequire       -> api/pull.js
 *   weekly refresh require()                      -> scripts/refresh.mjs
 *
 * A fourth consumer, Power BI, reads the SQL views in sql/06_canonical_views.sql.
 * Those views restate the formulas below in SQL; scripts/verify-parity.mjs
 * proves the two agree on live data and fails the build when they drift.
 *
 * DEFINITIONS_VERSION must be bumped whenever a formula changes, and the
 * same value must be set in sql/06_canonical_views.sql. The parity check
 * compares them and fails on a mismatch, so SQL can never silently lag JS.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RTMetrics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFINITIONS_VERSION = 2;

  /* ---------- primitives ---------- */

  function isNum(v) {
    return v !== null && v !== undefined && typeof v === "number" && !isNaN(v);
  }
  /* Division that refuses to invent a number: a null input or a zero
     denominator yields null, never Infinity or NaN. Every ratio below
     goes through here. */
  function div(numerator, denominator) {
    if (!isNum(numerator) || !isNum(denominator) || denominator === 0) return null;
    var r = numerator / denominator;
    return isFinite(r) ? r : null;
  }
  function sub(a, b) {
    return isNum(a) && isNum(b) ? a - b : null;
  }
  /* Sum where all-null stays null, but a partial set sums the knowns.
     Matches how EDGAR reports cash-flow lines: a company with no investing
     activity often omits the tag rather than filing a zero. */
  function sumPresent(values) {
    var any = false, total = 0;
    for (var i = 0; i < values.length; i++) {
      if (isNum(values[i])) { any = true; total += values[i]; }
    }
    return any ? total : null;
  }

  /* ---------- period helpers ---------- */

  var QUARTER_MONTHS = 3, ANNUAL_MONTHS = 12;
  function spanMonths(fiscalPeriod) {
    return fiscalPeriod === "FY" ? ANNUAL_MONTHS : QUARTER_MONTHS;
  }

  /* ---------- balance sheet ---------- */

  function workingCapital(currentAssets, currentLiabilities) {
    return sub(currentAssets, currentLiabilities);
  }
  function currentRatio(currentAssets, currentLiabilities) {
    return div(currentAssets, currentLiabilities);
  }
  function liabilitiesToAssets(totalLiabilities, totalAssets) {
    return div(totalLiabilities, totalAssets);
  }

  /* ---------- income statement ---------- */

  function grossProfit(revenue, cogs) {
    return sub(revenue, cogs);
  }
  function grossMarginPct(grossProfitValue, revenue) {
    return div(grossProfitValue, revenue);
  }
  function netMarginPct(netIncome, revenue) {
    return div(netIncome, revenue);
  }

  /* ---------- cash flow & liquidity ---------- */

  function netCashChange(cfOps, cfInv, cfFin) {
    return sumPresent([cfOps, cfInv, cfFin]);
  }
  /* Net cash movement per month across the reporting span. Negative is a
     burn, positive is an inflow — the UI labels the sign rather than
     assuming one, because a financing quarter reads positive here. */
  function monthlyNetCash(netCashChangeValue, fiscalPeriod) {
    return div(netCashChangeValue, spanMonths(fiscalPeriod));
  }
  /* Runway on OPERATING burn only. Financing inflows are deliberately
     excluded: money raised is not money earned, and counting it would
     overstate how long the business can fund itself. Null when operations
     generate cash — runway is not a meaningful figure there. */
  function runwayMonths(cash, cfOps, fiscalPeriod) {
    if (!isNum(cash) || !isNum(cfOps) || cfOps >= 0) return null;
    var monthlyOperatingBurn = Math.abs(cfOps) / spanMonths(fiscalPeriod);
    return div(cash, monthlyOperatingBurn);
  }
  function remainingCashDays(cash, netCashChangeValue, fiscalPeriod) {
    if (!isNum(netCashChangeValue)) return null;
    var monthly = monthlyNetCash(netCashChangeValue, fiscalPeriod);
    if (monthly === null) return null;
    if (monthly >= 0) return "Infinite";
    if (!isNum(cash)) return null;
    return Math.round(cash / -monthly * 30);
  }

  /* ---------- per share ---------- */

  function epsComputed(netIncome, sharesOutstanding) {
    return div(netIncome, sharesOutstanding);
  }

  /* ---------- variance (financial-statements conventions) ---------- */

  /* Percent change against the absolute prior value, so a move from a
     negative base reports the correct direction: -10 -> -5 is +50%
     (improving), not -50%. */
  function pctChange(current, prior) {
    if (!isNum(current) || !isNum(prior) || prior === 0) return null;
    return ((current - prior) / Math.abs(prior)) * 100;
  }
  function dollarVariance(current, prior) {
    return sub(current, prior);
  }
  /* Margins and other ratios move in basis points, not percent-of-percent.
     Inputs are fractions (0.42 = 42%); 1bp = 0.01pp. */
  function bpsChange(currentRateFraction, priorRateFraction) {
    var d = sub(currentRateFraction, priorRateFraction);
    return d === null ? null : d * 10000;
  }

  /* Materiality, scaled by line-item size — the tiered convention from the
     financial-statements workflow. Either threshold breaching flags it. */
  function materiality(priorMagnitude) {
    var m = Math.abs(isNum(priorMagnitude) ? priorMagnitude : 0);
    if (m > 1e7) return { dollar: 5e5, pct: 5 };
    if (m >= 1e6) return { dollar: 1e5, pct: 10 };
    return { dollar: 5e4, pct: 15 };
  }
  function isMaterial(current, prior) {
    var d = dollarVariance(current, prior);
    var p = pctChange(current, prior);
    if (d === null && p === null) return false;
    var t = materiality(prior);
    return (d !== null && Math.abs(d) >= t.dollar) ||
           (p !== null && Math.abs(p) >= t.pct);
  }

  /* ---------- accuracy checks ---------- */

  /* The accounting identity every balance sheet must satisfy. Tolerance is
     relative because EDGAR values carry rounding at filing scale; 0.5% of
     total assets catches real tagging errors without firing on cents. */
  function balanceSheetTie(totalAssets, totalLiabilities, equity) {
    if (!isNum(totalAssets) || !isNum(totalLiabilities) || !isNum(equity)) {
      return { checked: false, ok: null, drift: null, driftPct: null };
    }
    var drift = totalAssets - (totalLiabilities + equity);
    var driftPct = div(Math.abs(drift), Math.abs(totalAssets));
    return {
      checked: true,
      ok: driftPct !== null && driftPct <= 0.005,
      drift: drift,
      driftPct: driftPct === null ? null : driftPct * 100,
    };
  }

  /* A company filing periodic reports never goes much beyond a year
     between them. Past 400 days the figures describe a company that may
     have deregistered, and must not be presented as current. */
  var STALE_AFTER_DAYS = 400;
  function filingAgeDays(filedDate, now) {
    if (!filedDate) return null;
    var t = Date.parse(String(filedDate).slice(0, 10) + "T00:00:00Z");
    if (isNaN(t)) return null;
    return ((now === undefined ? Date.now() : now) - t) / 864e5;
  }
  function isStale(filedDate, now) {
    var age = filingAgeDays(filedDate, now);
    return age !== null && age > STALE_AFTER_DAYS;
  }

  /* Full accuracy sweep over one company payload. Returns findings rather
     than throwing, so the refresh can report every problem in one pass
     instead of dying on the first. severity: "error" blocks publication,
     "warn" is recorded and shipped. */
  function validateCompany(d) {
    var findings = [];
    function add(severity, code, message) {
      findings.push({ severity: severity, code: code, message: message });
    }
    if (!d || !d.company || !d.company.ticker) {
      add("error", "no_identity", "payload has no company ticker");
      return findings;
    }
    var f = (d.fundamentals) || {};
    var bs = f.balanceSheet || {}, is = f.incomeStatement || {},
        cf = f.cashFlow || {};
    var pick = function (o) { return o && isNum(o.q) ? o.q : null; };

    /* The identity needs TOTAL equity. Parent-only equity omits
       noncontrolling interest and reports a false failure for every
       company with consolidated subsidiaries it does not wholly own. */
    var equityTotal = pick(bs.equityIncludingNci);
    if (!isNum(equityTotal) && isNum(pick(bs.equity))) {
      equityTotal = pick(bs.equity) + (pick(bs.minorityInterest) || 0);
    }
    var tie = balanceSheetTie(pick(bs.totalAssets), pick(bs.totalLiabilities),
                              equityTotal);
    if (tie.checked && !tie.ok) {
      /* Unverifiable without NCI is a warn; drift that survives WITH NCI
         present is a real tagging error and blocks publication. */
      var nciKnown = isNum(pick(bs.minorityInterest)) ||
                     isNum(pick(bs.equityIncludingNci));
      add(nciKnown ? "error" : "warn", "balance_sheet_tie",
        "assets do not equal liabilities plus total equity — off by " +
        tie.driftPct.toFixed(2) + "% of total assets" +
        (nciKnown ? "" : " (noncontrolling interest not reported)"));
    }

    /* Working capital and net cash change are stored, not trusted: recompute
       and compare, because a stored value that disagrees with its own
       components means the export drifted from the source. */
    var wcExpected = workingCapital(pick(bs.currentAssets),
                                    pick(bs.currentLiabilities));
    var wcStored = pick(bs.workingCapital);
    if (isNum(wcExpected) && isNum(wcStored) &&
        Math.abs(wcExpected - wcStored) > 1) {
      add("error", "working_capital_drift",
        "stored working capital disagrees with current assets minus " +
        "current liabilities");
    }
    var nccExpected = netCashChange(pick(cf.cfOps), pick(cf.cfInv),
                                    pick(cf.cfFin));
    var nccStored = pick(cf.netCashChange);
    if (isNum(nccExpected) && isNum(nccStored) &&
        Math.abs(nccExpected - nccStored) > 1) {
      add("error", "net_cash_change_drift",
        "stored net cash change disagrees with the three cash-flow lines");
    }

    /* Sign conventions. These catch the classic XBRL polarity error where a
       negated-label concept is loaded without flipping its sign. */
    if (isNum(pick(bs.totalAssets)) && pick(bs.totalAssets) < 0) {
      add("error", "negative_assets", "total assets are negative");
    }
    if (isNum(pick(bs.cash)) && pick(bs.cash) < 0) {
      add("error", "negative_cash", "cash and equivalents are negative");
    }
    if (isNum(pick(is.revenue)) && pick(is.revenue) < 0) {
      add("warn", "negative_revenue",
        "revenue is negative, which usually means a contra-revenue tag");
    }
    var gm = pick(is.grossMarginPct);
    if (isNum(gm) && (gm > 1.5 || gm < -5)) {
      add("warn", "gross_margin_range",
        "gross margin of " + (gm * 100).toFixed(1) + "% is outside the " +
        "plausible range and suggests a revenue or COGS mismatch");
    }

    if (d.latestFiling && d.latestFiling.date && isStale(d.latestFiling.date)) {
      add("warn", "stale_filing",
        "latest periodic filing is more than " + STALE_AFTER_DAYS +
        " days old");
    }
    if (!d.period || !d.period.label) {
      add("error", "no_period", "payload has no reporting period");
    }
    if (d.shares && isNum(d.shares.outstanding) && d.shares.outstanding <= 0) {
      add("error", "bad_share_count", "shares outstanding is not positive");
    }
    return findings;
  }

  return {
    DEFINITIONS_VERSION: DEFINITIONS_VERSION,
    STALE_AFTER_DAYS: STALE_AFTER_DAYS,
    isNum: isNum, div: div, sumPresent: sumPresent, spanMonths: spanMonths,
    workingCapital: workingCapital,
    currentRatio: currentRatio,
    liabilitiesToAssets: liabilitiesToAssets,
    grossProfit: grossProfit,
    grossMarginPct: grossMarginPct,
    netMarginPct: netMarginPct,
    netCashChange: netCashChange,
    monthlyNetCash: monthlyNetCash,
    runwayMonths: runwayMonths,
    remainingCashDays: remainingCashDays,
    epsComputed: epsComputed,
    pctChange: pctChange,
    dollarVariance: dollarVariance,
    bpsChange: bpsChange,
    materiality: materiality,
    isMaterial: isMaterial,
    balanceSheetTie: balanceSheetTie,
    filingAgeDays: filingAgeDays,
    isStale: isStale,
    validateCompany: validateCompany,
  };
});
