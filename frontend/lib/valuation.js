/* valuation.js — the valuation course, as functions.
 *
 * Everything here follows the rules of a valuation and fundamental
 * analysis course (comparable selection after Alford 1992; multiple
 * aggregation and driver ranking after Liu, Nissim and Thomas 2002;
 * enterprise value, cost of capital, free cash flow and residual income
 * after the course notes). Each function names the rule it applies.
 * Pure functions, no DOM: the same file runs in the browser and in the
 * test runner.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RTValuation = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function div(a, b) { return isNum(a) && isNum(b) && b !== 0 ? a / b : null; }
  function median(xs) {
    var v = xs.filter(isNum).slice().sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var h = Math.floor(v.length / 2);
    return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
  }
  function mean(xs) {
    var v = xs.filter(isNum);
    return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : null;
  }
  /** Harmonic mean, n / Σ(1/x): the course's headline aggregate for a
      peer multiple (Liu, Nissim & Thomas eq. 3). Positive inputs only. */
  function harmonicMean(xs) {
    var v = xs.filter(function (x) { return isNum(x) && x > 0; });
    if (!v.length) return null;
    return v.length / v.reduce(function (s, x) { return s + 1 / x; }, 0);
  }

  /**
   * One peer multiple, aggregated three ways.
   *
   * Negative and zero multiples are excluded (a negative P/E is not a
   * cheap stock, it is a loss), as are values outside a sanity ceiling
   * that stands in for the course's 1%/99% trim when the set is too
   * small to trim by rank. Returns the count used and the count excluded
   * so the page can say so.
   */
  function aggregate(values, opts) {
    var ceiling = (opts && opts.ceiling) || 250;
    var used = [], excluded = 0;
    values.forEach(function (x) {
      if (!isNum(x)) return;
      if (x <= 0 || x > ceiling) { excluded++; return; }
      used.push(x);
    });
    return {
      n: used.length, excluded: excluded,
      harmonic: harmonicMean(used), median: median(used), mean: mean(used)
    };
  }

  /* ---------- comparable selection ---------- */

  /**
   * Alford (1992): the most accurate comparable set was the firms in the
   * same industry (SIC, widened a digit at a time until at least six
   * other firms) that were closest to the target on return on equity;
   * matching on size did about as well as industry alone, and the course
   * summary is "2–3 digit SIC, matched by size". Three SIC digits carry
   * all the information; a fourth adds nothing.
   *
   * So: pool by three SIC digits, widen to two, then to the panel's
   * industry label, then to the sector, until the pool holds `minPool`
   * other firms. Rank the pool by distance from the subject on size
   * (log total assets — a doubling is one unit) and return on equity (ten
   * percentage points is one unit), and keep the nearest `keep`. A
   * candidate missing either figure ranks after every complete one.
   *
   * subject / candidates: { ticker, name, sic, industry, sector, size, roe }
   *
   * opts.distance(subject, candidate), when given, replaces the size/ROE
   * ranking rule above with a caller-supplied one — same pool selection
   * (still by SIC/industry/sector), only the ranking changes. It may
   * return either a plain number (null when the candidate cannot be
   * ranked at all) or a { distance, complete } pair when the caller wants
   * to distinguish "ranked on partial information" from "fully ranked",
   * the same distinction the size/ROE rule draws between a candidate
   * missing one figure and one missing both. Leaving opts.distance out
   * runs the size/ROE rule exactly as before — no numeric change.
   */
  function selectComparables(subject, candidates, opts) {
    opts = opts || {};
    var minPool = opts.minPool || 6, keep = opts.keep || 8;
    var customDistance = typeof opts.distance === "function" ? opts.distance : null;
    var others = candidates.filter(function (c) { return c && c.ticker !== subject.ticker; });
    var sic = String(subject.sic || "");
    var levels = [
      { level: "3-digit SIC " + sic.slice(0, 3), test: function (c) { return sic.length >= 3 && String(c.sic || "").slice(0, 3) === sic.slice(0, 3); } },
      { level: "2-digit SIC " + sic.slice(0, 2), test: function (c) { return sic.length >= 2 && String(c.sic || "").slice(0, 2) === sic.slice(0, 2); } },
      { level: subject.industry ? "industry: " + subject.industry : "industry", test: function (c) { return !!subject.industry && c.industry === subject.industry; } },
      { level: subject.sector ? "sector: " + subject.sector : "sector", test: function (c) { return !!subject.sector && c.sector === subject.sector; } },
      { level: "every covered company", test: function () { return true; } }
    ];
    var pool = [], chosen = null, steps = [];
    for (var i = 0; i < levels.length; i++) {
      pool = others.filter(levels[i].test);
      steps.push({ level: levels[i].level, count: pool.length });
      if (pool.length >= minPool) { chosen = levels[i]; break; }
    }
    if (!chosen) chosen = levels[levels.length - 1];
    var lnS = isNum(subject.size) && subject.size > 0 ? Math.log(subject.size) : null;
    var ranked = pool.map(function (c) {
      var d, complete;
      if (customDistance) {
        var r = customDistance(subject, c);
        if (r && typeof r === "object") {
          d = isNum(r.distance) ? r.distance : null;
          complete = !!r.complete;
        } else {
          d = isNum(r) ? r : null;
          complete = d !== null;
        }
      } else {
        var dSize = (lnS !== null && isNum(c.size) && c.size > 0) ? Math.abs(Math.log(c.size) - lnS) / Math.LN2 : null;
        var dRoe = (isNum(subject.roe) && isNum(c.roe)) ? Math.abs(c.roe - subject.roe) / 0.10 : null;
        complete = dSize !== null && dRoe !== null;
        d = complete ? Math.sqrt(dSize * dSize + dRoe * dRoe)
          : (dSize !== null ? dSize : (dRoe !== null ? dRoe : null));
      }
      return { ticker: c.ticker, name: c.name, sic: c.sic, industry: c.industry, sector: c.sector,
        size: c.size, roe: c.roe, fv: c.fv, firstLienShare: c.firstLienShare, nonAccrualRate: c.nonAccrualRate,
        distance: d, complete: complete };
    }).sort(function (a, b) {
      if (a.complete !== b.complete) return a.complete ? -1 : 1;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });
    return {
      peers: ranked.slice(0, keep),
      passedOver: ranked.slice(keep),
      pool: { level: chosen.level, count: pool.length, steps: steps },
      rule: customDistance
        ? "Same industry by SIC, widened until at least " + minPool + " other firms, then the " +
          Math.min(keep, ranked.length) + " closest by the caller's distance."
        : "Same industry by SIC, widened until at least " + minPool + " other firms, then the " +
          Math.min(keep, ranked.length) + " closest on size and return on equity (Alford 1992)."
    };
  }

  /**
   * BDC peer distance (blueprint §4.5): sqrt(dSize² + dLien² + dNonAccrual²)
   * with dSize the absolute log2 ratio of portfolio fair value, dLien the
   * absolute difference in first-lien share over 0.10, and dNonAccrual the
   * absolute difference in the non-accrual rate over 0.01 — the same unit
   * convention as the size/ROE rule (a doubling, ten points and one point
   * are each one unit). Each term is null on its own when either side
   * lacks that figure, exactly as the size/ROE rule's dSize and dRoe are;
   * `complete` is true only when all three are present, so a candidate
   * ranked on fewer than three still sorts after one ranked on all three
   * (see selectComparables's sort comparator). subject / candidate:
   * { fv, firstLienShare, nonAccrualRate }.
   */
  function bdcDistance(subject, candidate) {
    var dSize = (isNum(subject.fv) && subject.fv > 0 && isNum(candidate.fv) && candidate.fv > 0)
      ? Math.abs(Math.log(candidate.fv / subject.fv) / Math.LN2) : null;
    var dLien = (isNum(subject.firstLienShare) && isNum(candidate.firstLienShare))
      ? Math.abs(candidate.firstLienShare - subject.firstLienShare) / 0.10 : null;
    var dNonAccrual = (isNum(subject.nonAccrualRate) && isNum(candidate.nonAccrualRate))
      ? Math.abs(candidate.nonAccrualRate - subject.nonAccrualRate) / 0.01 : null;
    var terms = [dSize, dLien, dNonAccrual].filter(function (x) { return x !== null; });
    var complete = dSize !== null && dLien !== null && dNonAccrual !== null;
    var distance = terms.length
      ? Math.sqrt(terms.reduce(function (s, x) { return s + x * x; }, 0))
      : null;
    return { distance: distance, complete: complete, dSize: dSize, dLien: dLien, dNonAccrual: dNonAccrual };
  }

  /* ---------- enterprise value ---------- */

  /**
   * The bridge from market value to enterprise value, course definition:
   * EV = equity + debt + preferred + minority interest, all at market
   * where a market exists, less financial assets in the net-debt view.
   * Operating lease liabilities are debt in the course; they are carried
   * as a separate line so the reader sees both the vendor-comparable
   * figure (without) and the course figure (with).
   */
  function evBridge(x) {
    var n = function (v) { return isNum(v) ? v : 0; };
    var marketCap = isNum(x.marketCap) ? x.marketCap : (isNum(x.price) && isNum(x.shares) ? x.price * x.shares : null);
    if (!isNum(marketCap)) return null;
    var debt = n(x.shortTermDebt) + n(x.longTermDebt);
    var leases = n(x.operatingLeaseLiability);
    var nci = n(x.minorityInterest);
    var preferred = n(x.preferred);
    var financialAssets = n(x.cash) + n(x.shortTermInvestments);
    var ev = marketCap + debt + nci + preferred - financialAssets;
    return {
      marketCap: marketCap, price: isNum(x.price) ? x.price : null, shares: isNum(x.shares) ? x.shares : null,
      debt: debt, leases: leases, nci: nci, preferred: preferred,
      financialAssets: financialAssets, cash: n(x.cash), shortTermInvestments: n(x.shortTermInvestments),
      netDebt: debt + nci + preferred - financialAssets,
      ev: ev, evWithLeases: ev + leases
    };
  }

  /** Multiples from the filings on a trailing-twelve-month period. */
  function ownMultiples(b, ltm, shares) {
    if (!b || !ltm) return null;
    var is = ltm.incomeStatement || {}, cf = ltm.cashFlow || {}, bs = ltm.balanceSheet || {};
    var ebit = isNum(is.operatingIncome) ? is.operatingIncome : null;
    var da = isNum(cf.depreciationAmortization) ? Math.abs(cf.depreciationAmortization) : null;
    var ebitda = isNum(ebit) && da !== null ? ebit + da : null;
    var fcf = isNum(cf.cfOps) && isNum(cf.capex) ? cf.cfOps - Math.abs(cf.capex) : null;
    var equity = isNum(bs.equity) ? bs.equity : null;
    var per = function (v) { return isNum(v) && isNum(shares) && shares > 0 ? v / shares : null; };
    return {
      revenue: is.revenue, ebit: ebit, ebitda: ebitda, netIncome: is.netIncome, fcf: fcf, equity: equity,
      evSales: div(b.ev, is.revenue),
      evEbitda: ebitda !== null && ebitda > 0 ? b.ev / ebitda : null,
      evEbit: ebit !== null && ebit > 0 ? b.ev / ebit : null,
      pe: isNum(is.netIncome) && is.netIncome > 0 ? b.marketCap / is.netIncome : null,
      pb: equity !== null && equity > 0 ? b.marketCap / equity : null,
      fcfYield: fcf !== null ? fcf / b.marketCap : null,
      perShare: { eps: per(is.netIncome), sales: per(is.revenue), ebitda: per(ebitda), ebit: per(ebit),
        book: per(equity), fcf: per(fcf), netDebt: per(b.netDebt) }
    };
  }

  /* ---------- cost of capital ---------- */

  /** CAPM: r_E = r_F + β × equity risk premium. The course's premium runs
      4–5.5%; the ten-year Treasury is the risk-free proxy. */
  function costOfEquity(rf, beta, erp) {
    if (!isNum(rf) || !isNum(beta)) return null;
    return rf + beta * (isNum(erp) ? erp : 0.05);
  }
  /** Cost of debt from the statements: interest paid over debt carried,
      floored at the risk-free rate; a spread over Treasuries when the
      company carries no interest line. */
  function costOfDebt(interestExpense, debt, rf) {
    var r = isNum(interestExpense) && isNum(debt) && debt > 0 ? Math.abs(interestExpense) / debt : null;
    if (r !== null && isNum(rf) && r < rf) r = rf;
    if (r !== null && r > 0.20) r = null;
    return r !== null ? r : (isNum(rf) ? rf + 0.015 : null);
  }
  /** WACC at market-value weights: w_E r_E + w_D (1 − τ) r_D, minority
      interest at the cost of equity and tax-affected, as the course does. */
  function wacc(x) {
    var E = x.marketCap, D = x.debt, N = isNum(x.nci) ? x.nci : 0;
    if (!isNum(E) || !isNum(D) || !isNum(x.re)) return null;
    var V = E + D + N;
    if (V <= 0) return null;
    var t = isNum(x.tax) ? Math.min(Math.max(x.tax, 0), 0.5) : 0.21;
    var rd = isNum(x.rd) ? x.rd : 0;
    return (E / V) * x.re + (D / V) * (1 - t) * rd + (N / V) * (1 - t) * x.re;
  }

  /* ---------- what the price assumes ---------- */

  /** Trailing P/E = (1 + g) / (r − g) in steady state, so the growth the
      price assumes is g = (P/E × r − 1) / (P/E + 1). */
  function impliedGrowthFromPE(pe, r) {
    if (!isNum(pe) || !isNum(r) || pe <= 0) return null;
    return (pe * r - 1) / (pe + 1);
  }
  /** EV = FCF × (1 + g) / (WACC − g), so g = (EV × WACC − FCF) / (EV + FCF). */
  function impliedGrowthFromFcf(ev, fcf, w) {
    if (!isNum(ev) || !isNum(fcf) || !isNum(w) || fcf <= 0 || ev <= 0) return null;
    return (ev * w - fcf) / (ev + fcf);
  }
  /** Price-to-book the theory expects: 1 + (ROE − r) / (r − g). */
  function theoreticalPB(roe, r, g) {
    if (!isNum(roe) || !isNum(r) || !isNum(g) || r <= g) return null;
    return 1 + (roe - r) / (r - g);
  }

  /* ---------- value creation ---------- */

  /**
   * NOPAT, invested capital, return on invested capital and economic
   * value added, both views the course keeps: operating assets (capital
   * includes the cash and securities) and net debt (financial assets
   * netted out). Capital is beginning-of-period where a prior balance
   * sheet is given.
   */
  function valueCreation(x) {
    var n = function (v) { return isNum(v) ? v : 0; };
    if (!isNum(x.ebit)) return null;
    var tax = isNum(x.tax) ? Math.min(Math.max(x.tax, 0), 0.5) : 0.21;
    var nopat = x.ebit * (1 - tax);
    var ic = function (b) {
      if (!b) return null;
      var oa = n(b.shortTermDebt) + n(b.longTermDebt) + n(b.operatingLeaseLiability) + n(b.equity) + n(b.minorityInterest);
      return { oa: oa, nd: oa - n(b.cash) - n(b.shortTermInvestments) };
    };
    var begin = ic(x.priorBalance) || ic(x.balance);
    if (!begin) return null;
    var roicOA = begin.oa > 0 ? nopat / begin.oa : null, roicND = begin.nd > 0 ? nopat / begin.nd : null;
    return {
      nopat: nopat, taxRate: tax, icOA: begin.oa, icND: begin.nd,
      roicOA: roicOA, roicND: roicND,
      evaOA: isNum(x.wacc) && roicOA !== null ? (roicOA - x.wacc) * begin.oa : null,
      evaND: isNum(x.wacc) && roicND !== null ? (roicND - x.wacc) * begin.nd : null
    };
  }

  /* ---------- perpetual growth: never above the economy ---------- */

  /**
   * Growth into perpetuity is capped at nominal economic growth. The
   * three defensible choices: the long-run inflation rate (about 2% in a
   * stable developed economy), the safe choice of 2–3% for a mature US
   * company, and the nominal GDP rate of 3–4% as the absolute ceiling.
   */
  var TERMINAL_GROWTH = {
    cap: 0.04,
    options: [
      { key: "inflation", label: "Inflation baseline", g: 0.02, note: "the long-term inflation rate of a stable developed economy" },
      { key: "safe", label: "Safe choice", g: 0.025, note: "conservative, standard and easy to defend for a mature US company" },
      { key: "safeUpper", label: "Safe choice, upper", g: 0.03, note: "the top of the 2–3% range" },
      { key: "gdp", label: "GDP cap", g: 0.035, note: "nominal GDP growth, the upper limit" },
      { key: "gdpCeiling", label: "GDP cap, ceiling", g: 0.04, note: "the absolute upper limit, nominal GDP at the top of its range" }
    ],
    defaultKey: "safe"
  };
  function terminalGrowthOption(key) {
    var o = TERMINAL_GROWTH.options.filter(function (x) { return x.key === key; })[0];
    return o || TERMINAL_GROWTH.options.filter(function (x) { return x.key === TERMINAL_GROWTH.defaultKey; })[0];
  }
  /** A growth rate for use in perpetuity: never above the cap. */
  function clampTerminalGrowth(g) {
    if (!isNum(g)) return null;
    return Math.min(g, TERMINAL_GROWTH.cap);
  }

  /**
   * What the company is worth in steady state at a chosen perpetual
   * growth rate, the course's one-line models per share:
   *   earnings         P = EPS × (1 + g) ÷ (r − g)
   *   free cash flow   EV = FCF × (1 + g) ÷ (WACC − g), less net debt
   *   residual income  V = B₀ + (ROE − r) × B₀ ÷ (r − g)
   * and the multiples those identities justify. Each is a perpetuity of
   * the trailing year, so a year that is not steady state gives a value
   * that is not either; the page says so.
   */
  function steadyStateValue(x) {
    var g = clampTerminalGrowth(x.g);
    if (g === null) return null;
    var re = x.re, w = x.wacc;
    var out = { g: g, capped: isNum(x.g) && x.g > TERMINAL_GROWTH.cap,
      earnings: null, fcf: null, residualIncome: null,
      justifiedPE: null, justifiedForwardPE: null, justifiedEvFcf: null };
    if (isNum(re) && re > g) {
      out.justifiedPE = (1 + g) / (re - g);
      out.justifiedForwardPE = 1 / (re - g);
      if (isNum(x.eps) && x.eps > 0) out.earnings = x.eps * (1 + g) / (re - g);
      if (isNum(x.bookPerShare) && x.bookPerShare > 0 && isNum(x.roe)) {
        out.residualIncome = x.bookPerShare + (x.roe - re) * x.bookPerShare / (re - g);
      }
    }
    if (isNum(w) && w > g) {
      out.justifiedEvFcf = (1 + g) / (w - g);
      if (isNum(x.fcfPerShare) && x.fcfPerShare > 0) {
        out.fcf = x.fcfPerShare * (1 + g) / (w - g) - (isNum(x.netDebtPerShare) ? x.netDebtPerShare : 0);
      }
    }
    return out;
  }

  /* ---------- what the peers imply ---------- */

  /**
   * Liu, Nissim and Thomas: interquartile range of pricing errors by
   * driver, same-industry harmonic mean. Forward earnings price best;
   * sales prices worst. Shown beside each implied price as its
   * reliability.
   */
  var DRIVER_RELIABILITY = {
    epsForward: { iqr: 0.317, note: "two-year-ahead earnings priced best in the study" },
    epsLtm: { iqr: 0.348, note: "trailing earnings, a little behind forward" },
    ebitda: { iqr: 0.553, note: "EBITDA, well behind earnings" },
    book: { iqr: 0.602, note: "book value, behind EBITDA" },
    sales: { iqr: 0.738, note: "sales priced worst of the accounting drivers" }
  };

  /**
   * Implied price per share from each driver: equity multiples apply to
   * the per-share driver directly; enterprise multiples give an
   * enterprise value per share from which net debt per share is taken.
   * peers: rows with the vendor's multiples; drivers: the subject's
   * per-share figures.
   */
  function impliedPrices(x) {
    var peers = x.peers || [], d = x.drivers || {}, nd = isNum(d.netDebt) ? d.netDebt : 0;
    var col = function (k) { return peers.map(function (p) { return p[k]; }); };
    var rows = [];
    var add = function (key, label, multipleLabel, agg, driver, enterprise) {
      if (!agg || agg.harmonic === null || !isNum(driver)) return;
      var byH = enterprise ? agg.harmonic * driver - nd : agg.harmonic * driver;
      var byM = agg.median !== null ? (enterprise ? agg.median * driver - nd : agg.median * driver) : null;
      rows.push({ key: key, label: label, multipleLabel: multipleLabel, driver: driver,
        harmonic: agg.harmonic, median: agg.median, n: agg.n, excluded: agg.excluded,
        priceHarmonic: byH, priceMedian: byM, reliability: DRIVER_RELIABILITY[key] || null });
    };
    add("epsForward", "Forward earnings per share", "P/E, forward", aggregate(col("forwardPE")), d.epsForward, false);
    add("epsLtm", "Trailing earnings per share", "P/E, trailing", aggregate(col("peTTM")), d.epsLtm, false);
    add("ebitda", "EBITDA per share", "EV/EBITDA", aggregate(col("evEbitdaTTM")), d.ebitda, true);
    add("book", "Book value per share", "P/B", aggregate(col("pb")), d.book, false);
    add("sales", "Sales per share", "EV/Sales", aggregate(col("evRevenueTTM")), d.sales, true);
    return rows;
  }

  return {
    isNum: isNum, div: div, median: median, mean: mean, harmonicMean: harmonicMean, aggregate: aggregate,
    selectComparables: selectComparables, bdcDistance: bdcDistance,
    evBridge: evBridge, ownMultiples: ownMultiples,
    costOfEquity: costOfEquity, costOfDebt: costOfDebt, wacc: wacc,
    impliedGrowthFromPE: impliedGrowthFromPE, impliedGrowthFromFcf: impliedGrowthFromFcf,
    theoreticalPB: theoreticalPB, valueCreation: valueCreation,
    impliedPrices: impliedPrices, DRIVER_RELIABILITY: DRIVER_RELIABILITY,
    TERMINAL_GROWTH: TERMINAL_GROWTH, terminalGrowthOption: terminalGrowthOption,
    clampTerminalGrowth: clampTerminalGrowth, steadyStateValue: steadyStateValue,
    DEFAULT_ERP: 0.05
  };
});
