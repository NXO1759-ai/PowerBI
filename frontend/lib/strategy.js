/**
 * strategy.js — industry structure and competitive position.
 *
 * Works off the precomputed panel (frontend/data/strategy-panel.js): 130
 * companies, ~19 fiscal years, 34 line items each, grouped by industry.
 *
 * Firm-level profitability is NOT reimplemented here. The panel is
 * adapted into the period shape ratios.js already expects, so RNOA,
 * NOPAT, invested capital and the rest come from the engine that was
 * validated against the course's own worked example. This file adds only
 * what is genuinely new: the cross-sectional view.
 *
 * Two cautions that shape everything below.
 *
 * The universe is a sample, not a census. It holds large listed US
 * companies, so an industry here means its big public players — not the
 * private firms, foreign entrants or small competitors that also shape
 * rivalry. Concentration computed on this base is an UPPER BOUND on true
 * concentration, and is labelled as such wherever it is shown.
 *
 * Revenue is a rough proxy for served market where firms compete in
 * different segments. Share here is share of the covered peer group's
 * revenue: a starting point for a structural read, not a market-share
 * figure a regulator would accept.
 *
 * UMD, like metrics.js and ratios.js: one file, browser and Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RTStrategy = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function isNum(v) {
    return v !== null && v !== undefined && typeof v === "number" && !isNaN(v);
  }
  function div(a, b) {
    if (!isNum(a) || !isNum(b) || b === 0) return null;
    var r = a / b;
    return isFinite(r) ? r : null;
  }
  function sum(xs) {
    var any = false, t = 0;
    for (var i = 0; i < xs.length; i++) if (isNum(xs[i])) { any = true; t += xs[i]; }
    return any ? t : null;
  }
  function median(xs) {
    var v = xs.filter(isNum).slice().sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function quantile(xs, q) {
    var v = xs.filter(isNum).slice().sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var pos = (v.length - 1) * q, base = Math.floor(pos), rest = pos - base;
    return v[base + 1] !== undefined ? v[base] + rest * (v[base + 1] - v[base]) : v[base];
  }
  function stdev(xs) {
    var v = xs.filter(isNum);
    if (v.length < 2) return null;
    var m = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
    var s = v.reduce(function (a, b) { return a + Math.pow(b - m, 2); }, 0);
    return Math.sqrt(s / (v.length - 1));
  }

  /* ---------- panel access ----------
     Panel values are in THOUSANDS and stored positionally. */
  function makeReader(fields) {
    var idx = {};
    for (var i = 0; i < fields.length; i++) idx[fields[i]] = i;
    return function (row, name) {
      if (!row) return null;
      var i = idx[name];
      if (i === undefined) return null;
      var v = row[i];
      return isNum(v) ? v * 1000 : null;
    };
  }

  /** Panel row into the period object ratios.js consumes. */
  function toPeriod(get, row, fiscalYear) {
    var f = function (n) { return get(row, n); };
    return {
      periodEnd: String(fiscalYear) + "-12-31",
      label: "FY " + fiscalYear,
      fiscalYear: fiscalYear,
      fiscalPeriod: "FY",
      incomeStatement: {
        revenue: f("revenue"), cogs: f("cogs"), grossProfit: f("grossProfit"),
        researchDevelopment: f("researchDevelopment"),
        sellingGeneralAdmin: f("sellingGeneralAdmin"),
        sellingMarketing: f("sellingMarketing"), operatingExpenses: null,
        operatingIncome: f("operatingIncome"),
        interestExpense: f("interestExpense"),
        pretaxIncome: f("pretaxIncome"), incomeTax: f("incomeTax"),
        netIncome: f("netIncome"),
        netIncomeIncludingNci: f("netIncomeIncludingNci")
      },
      balanceSheet: {
        cash: f("cash"), shortTermInvestments: f("shortTermInvestments"),
        receivables: f("receivables"), inventory: f("inventory"),
        currentAssets: f("currentAssets"), ppe: f("ppe"),
        goodwill: f("goodwill"), intangibles: f("intangibles"),
        operatingLeaseAsset: null, totalAssets: f("totalAssets"),
        payables: f("payables"), deferredRevenue: f("deferredRevenue"),
        remainingPerformanceObligation: f("remainingPerformanceObligation"),
        shortTermDebt: f("shortTermDebt"),
        currentLiabilities: f("currentLiabilities"),
        longTermDebt: f("longTermDebt"), operatingLeaseLiability: null,
        totalLiabilities: null, equity: f("equity"),
        minorityInterest: f("minorityInterest"),
        equityIncludingNci: f("equityIncludingNci"),
        retainedEarnings: null, treasuryStock: null
      },
      cashFlow: {
        cfOps: f("cfOps"), cfInv: f("cfInv"), cfFin: f("cfFin"),
        depreciationAmortization: f("depreciationAmortization"),
        shareBasedComp: f("shareBasedComp"), capex: f("capex"),
        dividendsPaid: f("dividendsPaid"), buybacks: f("buybacks")
      },
      perShare: { epsBasic: null, epsDiluted: null },
      shares: { dilutedShares: null, basicShares: null, sharesOutstanding: null }
    };
  }

  /** Every fiscal year a company has, oldest first, as period objects. */
  function companyPeriods(get, company) {
    return Object.keys(company.years)
      .map(Number).sort(function (a, b) { return a - b; })
      .map(function (y) { return toPeriod(get, company.years[y], y); });
  }

  /* ---------- concentration ----------
   *
   * HHI is the sum of squared percentage shares. It weights by size, so
   * unlike a simple firm count it separates an industry with one dominant
   * player from one with several evenly matched rivals — the difference
   * that actually governs how rivalry plays out.
   *
   * The US horizontal merger guidelines read HHI on a 0-10,000 scale:
   * below 1,500 unconcentrated, 1,500-2,500 moderately concentrated,
   * above 2,500 highly concentrated. Those bands are applied here with
   * the standing caveat that this is computed over listed peers rather
   * than the whole market, so the true figure is lower.
   */
  function concentration(shares) {
    var vals = shares.filter(isNum).filter(function (v) { return v > 0; });
    if (!vals.length) return null;
    var total = vals.reduce(function (a, b) { return a + b; }, 0);
    if (!total) return null;
    var pctShares = vals.map(function (v) { return v / total * 100; })
      .sort(function (a, b) { return b - a; });
    var hhi = pctShares.reduce(function (a, p) { return a + p * p; }, 0);
    var cum = function (n) {
      return pctShares.slice(0, n).reduce(function (a, b) { return a + b; }, 0);
    };
    return {
      firms: pctShares.length,
      /* CR3, CR4 and CR10 are what the course actually uses — the Tesla
         session reads CR4 by geography over time, Boston Beer reads CR3
         and CR10. HHI is carried alongside as an extension, labelled as
         such in the UI, because it separates a dominant-firm industry
         from an evenly-matched one in a way a top-N count cannot. */
      cr3: cum(3), cr10: cum(10),
      hhi: hhi,
      band: hhi > 2500 ? "Highly concentrated"
        : hhi >= 1500 ? "Moderately concentrated" : "Unconcentrated",
      cr4: cum(4), cr8: cum(8),
      topShare: pctShares[0],
      /* An equal-share industry of n firms scores 10000/n. Comparing the
         actual figure against that says how much of the concentration is
         skew rather than simply having few players. */
      equalShareHhi: 10000 / pctShares.length,
      shares: pctShares
    };
  }

  /* ---------- Porter's ROIC ----------
   *
   * "Return on invested capital (ROIC) is the appropriate measure of
   * profitability for strategy formulation... Return on sales or the
   * growth rate of profits fail to account for the capital required to
   * compete in the industry. Here, we utilize earnings before interest
   * and taxes divided by average invested capital less excess cash."
   *
   * The definition is deliberate on three counts: EBIT strips out capital
   * structure and tax differences so industries are comparable; capital
   * is AVERAGED because income is earned across a year while a balance
   * sheet is one instant; and EXCESS cash is removed because idle cash is
   * not capital the business needs to compete, so leaving it in
   * understates the return of any company sitting on a hoard.
   *
   * Excess cash needs a line, and the course does not draw one. Operating
   * cash is taken at 2% of revenue — the top of the 0.5-2% range used for
   * the same judgement elsewhere in the Fuqua materials — and everything
   * above that counts as excess. The assumption is exposed rather than
   * buried, because it materially changes the answer for cash-rich firms.
   */
  var OPERATING_CASH_RATE = 0.02;

  function excessCash(period, operatingCashRate) {
    var b = period.balanceSheet;
    var liquid = sum([b.cash, b.shortTermInvestments]);
    if (!isNum(liquid)) return null;
    var rev = period.incomeStatement.revenue;
    var rate = isNum(operatingCashRate) ? operatingCashRate : OPERATING_CASH_RATE;
    var needed = isNum(rev) ? rev * rate : 0;
    return Math.max(0, liquid - needed);
  }

  /** Invested capital: interest-bearing debt plus total equity, less the
      cash the business does not need to operate. */
  function investedCapital(period, operatingCashRate) {
    var b = period.balanceSheet;
    var debt = sum([b.shortTermDebt, b.longTermDebt]);
    var eq = isNum(b.equityIncludingNci) ? b.equityIncludingNci
      : (isNum(b.equity)
          ? b.equity + (isNum(b.minorityInterest) ? b.minorityInterest : 0)
          : null);
    if (!isNum(eq)) return null;
    var ic = (isNum(debt) ? debt : 0) + eq;
    var xs = excessCash(period, operatingCashRate);
    return isNum(xs) ? ic - xs : ic;
  }

  function ebitOf(period, isLender) {
    var is = period.incomeStatement;
    if (isNum(is.operatingIncome)) return is.operatingIncome;
    /* For a bank or other lender, interest paid is the cost of the product
       rather than a charge for the capital being measured. Adding it back
       reported JPMorgan at $168bn of operating income against $72.6bn of
       pre-tax income, and a 92% margin. Pre-tax income is used as-is. */
    if (isLender) return isNum(is.pretaxIncome) ? is.pretaxIncome : null;
    /* Roughly a quarter of large filers no longer tag OperatingIncomeLoss
       at all — Exxon, Chevron, J&J, Lilly and IBM among them. Pre-tax
       income plus interest rebuilds the same figure, and it is what a
       return on invested capital wants anyway: earnings before the cost of
       the capital being measured.
       A company reporting pre-tax income but no separate interest line has
       interest too small to break out, not interest of unknown size, so
       the absent tag is read as zero. Requiring both would discard the
       whole figure over its smaller component. */
    if (isNum(is.pretaxIncome)) {
      return is.pretaxIncome + (isNum(is.interestExpense) ? Math.abs(is.interestExpense) : 0);
    }
    return null;
  }

  /** Whether ebitOf returned a reported figure or a reconstructed one. */
  function ebitIsSynthetic(period) {
    var is = period.incomeStatement;
    return !isNum(is.operatingIncome) && isNum(is.pretaxIncome);
  }

  /* A margin above 100% of sales is not a very profitable company; it is
     a revenue line that failed to capture the whole top line. Capital One
     reports $8.1bn of revenue against $13.8bn of pre-tax income, and
     American Tower $0.9bn against $4.8bn, because this pull does not yet
     read the interest-and-fee revenue tags lenders and property trusts
     use. Such members are dropped from the pool and counted, rather than
     being left to distort an industry aggregate. */
  function marginIsCredible(revenue, profit) {
    if (!isNum(revenue) || !isNum(profit) || revenue <= 0) return false;
    var m = profit / revenue;
    return m <= 1 && m >= -2;
  }

  /** Porter ROIC for one year, averaging capital with the prior year. */
  function porterRoic(period, priorPeriod, operatingCashRate, isLender) {
    var e = ebitOf(period, isLender);
    var icNow = investedCapital(period, operatingCashRate);
    var icPrior = priorPeriod ? investedCapital(priorPeriod, operatingCashRate) : null;
    var avgIc = isNum(icNow)
      ? (isNum(icPrior) ? (icNow + icPrior) / 2 : icNow) : null;
    /* Negative invested capital makes the ratio meaningless rather than
       merely negative, so it is withheld. */
    if (!isNum(avgIc) || avgIc <= 0) return null;
    return div(e, avgIc);
  }

  /**
   * Porter's benchmark distribution of average industry ROIC across US
   * industries, 1992-2006 (Compustat). Used to place a computed figure in
   * context rather than to grade it — the course is explicit that the
   * point "is not to declare the industry attractive or unattractive."
   */
  var PORTER_ROIC_BANDS = {
    source: "Porter, The Five Competitive Forces That Shape Strategy, 1992-2006",
    p10: 0.070, p25: 0.109, median: 0.143, p75: 0.186, p90: 0.253, mean: 0.149
  };
  function placeAgainstPorter(roic) {
    if (!isNum(roic)) return null;
    var b = PORTER_ROIC_BANDS;
    var band = roic >= b.p90 ? "Top decile"
      : roic >= b.p75 ? "Upper quartile"
      : roic >= b.median ? "Above median"
      : roic >= b.p25 ? "Below median"
      : roic >= b.p10 ? "Lower quartile" : "Bottom decile";
    /* Four of the six band names are noun phrases that take "in the", but
       the two median ones are not; carrying a ready-made phrase avoids
       "sits in the above median" at the call site. */
    var phrase = (band === "Above median") ? "above the median"
      : (band === "Below median") ? "below the median"
      : "in the " + band.toLowerCase();
    return { roic: roic, band: band, phrase: phrase, vsMedian: roic - b.median, bands: b };
  }

  /**
   * Porter's own 1992-2006 ROIC by industry — the 31 he published.
   *
   * Percentile bands say where a number sits; a named comparable says what
   * it resembles. "17% puts you between household furniture and grocery
   * stores" is a more useful sentence than "above median", because the
   * reader already knows what those businesses are like.
   */
  var PORTER_INDUSTRY_ROIC = [
    ["Security Brokers and Dealers", 0.409], ["Soft Drinks", 0.376],
    ["Prepackaged Software", 0.376], ["Pharmaceuticals", 0.317],
    ["Perfume, Cosmetics, Toiletries", 0.286], ["Advertising Agencies", 0.273],
    ["Distilled Spirits", 0.264], ["Semiconductors", 0.213],
    ["Medical Instruments", 0.210], ["Men's and Boys' Clothing", 0.195],
    ["Tires", 0.195], ["Household Appliances", 0.192],
    ["Malt Beverages", 0.190], ["Child Day Care Services", 0.176],
    ["Household Furniture", 0.170], ["Drug Stores", 0.165],
    ["Grocery Stores", 0.160], ["Iron and Steel Foundries", 0.156],
    ["Cookies and Crackers", 0.154], ["Mobile Homes", 0.150],
    ["Wine and Brandy", 0.139], ["Bakery Products", 0.138],
    ["Engines and Turbines", 0.137], ["Book Publishing", 0.134],
    ["Laboratory Equipment", 0.134], ["Oil and Gas Machinery", 0.126],
    ["Soft Drink Bottling", 0.117], ["Knitting Mills", 0.105],
    ["Hotels", 0.104], ["Catalog, Mail-Order Houses", 0.059],
    ["Airlines", 0.059]
  ];
  /** The two Porter industries a computed return falls between. */
  function porterNeighbours(roic) {
    if (!isNum(roic)) return null;
    var above = null, below = null;
    for (var i = 0; i < PORTER_INDUSTRY_ROIC.length; i++) {
      var e = PORTER_INDUSTRY_ROIC[i];
      if (e[1] >= roic) above = e;
      if (e[1] <= roic && !below) below = e;
    }
    /* An exact hit on one of Porter's industries is a match, not a range. */
    if (above && below && above[0] === below[0]) return { exact: above };
    return { above: above, below: below };
  }

  /**
   * Rolling average over a window of years.
   *
   * Porter is explicit that structure is read over a full business cycle —
   * three to five years for most industries — and that it is "average
   * profitability over this period, not profitability in any particular
   * year, that should be the focus of analysis". A single year mixes the
   * structural signal with the cycle, and one of the named pitfalls is
   * "confusing cyclical or transient changes with true structural
   * changes". The rolling series is therefore the one to read; the annual
   * series is kept alongside so the cycle stays visible rather than
   * smoothed out of sight.
   */
  function rollingAverage(series, valueKey, windowYears) {
    var w = windowYears || 5;
    return series.map(function (d, i) {
      var start = Math.max(0, i - w + 1);
      var slice = series.slice(start, i + 1)
        .map(function (x) { return x[valueKey]; }).filter(isNum);
      return {
        year: d.year,
        value: slice.length ? slice.reduce(function (a, b) { return a + b; }, 0) / slice.length : null,
        years: slice.length,
        complete: slice.length >= w
      };
    });
  }

  /**
   * The three-factor DuPont the course teaches, on a PRE-TAX basis.
   *
   *   ROE(pre-tax) = PBT/Sales x Sales/avg Assets x avg Assets/avg Equity
   *
   * Pre-tax deliberately: it keeps tax-rate differences out of a
   * comparison between competitors, the same reason Porter's ROIC uses
   * EBIT. The course's demonstration is two brewers reaching near-identical
   * ROE by opposite routes — one asset-light and levered at 5.7x asset
   * turns on a 1% margin, the other capital-intensive at 0.77x turns on a
   * 28% margin. Identical outcome, completely different business. ROE on
   * its own hides that; this is what exposes it.
   */
  /**
   * Which of the three factors the return actually rests on.
   *
   * Judged against the company's own industry rather than fixed cutoffs.
   * A 65% margin is margin-led whatever the asset turns are, but no single
   * absolute threshold catches that without miscategorising a business
   * somewhere else in the panel. Measuring each factor as a multiple of its
   * industry median puts a chipmaker and a grocer on the same scale, which
   * is the comparison the decomposition exists to make.
   */
  /**
   * Which of the three factors the return rests on.
   *
   * Measured against the whole panel, not the company's own industry. With
   * two or three firms in a segment the median simply is the company, so a
   * within-industry read tells Costco it is unremarkable at 3.8x asset
   * turns. The course's own case was two brewers in ONE industry with
   * opposite shapes — margin-fat and slow against margin-thin and fast —
   * so the comparison that exposes shape has to be economy-wide.
   */
  function describeDriver(margin, turnover, ref) {
    if (!isNum(margin) || !isNum(turnover)) return null;
    if (!ref || !isNum(ref.margin) || !isNum(ref.turnover) ||
        ref.margin <= 0 || ref.turnover <= 0) return null;
    var mRel = margin / ref.margin, tRel = turnover / ref.turnover;
    var HI = 1.25, LO = 0.8;
    var mHi = mRel >= HI, mLo = mRel <= LO, tHi = tRel >= HI, tLo = tRel <= LO;
    var m = mRel.toFixed(1) + "× the typical margin", t = tRel.toFixed(1) + "× the typical asset turns";
    /* Strong on both is not "balanced" — it is a business out-earning the
       economy on two independent dimensions, and saying so is the point. */
    if (mHi && tHi) return "Strong on both — " + m + " and " + t;
    if (mLo && tLo) return "Weak on both — " + m + " and " + t;
    if (mHi && !tHi) return "Margin-led — " + m + ", " + t;
    if (tHi && !mHi) return "Turnover-led — " + t + ", " + m;
    /* One factor below and the other merely ordinary: the shortfall is the
       finding, not a phantom "lead" in whichever fell less. */
    if (mLo) return "Held back by margin — " + m + ", " + t;
    if (tLo) return "Held back by asset intensity — " + t + ", " + m;
    return "Unremarkable on both — " + m + " and " + t;
  }

  /** Whether the revenue/assets shape comparison applies to this company
      at all. It does not for balance-sheet businesses. */
  function isFinancial(company) {
    return /financ/i.test(company && company.sector || "");
  }

  /** Median pre-tax margin and asset turnover across the NONFINANCIAL
      companies reporting in a given year — the reference describeDriver
      compares to. */
  function panelReference(panel, fieldReader, year) {
    var ms = [], ts = [];
    Object.keys(panel).forEach(function (t) {
      var c = panel[t], row = c.years[year]; if (!row) return;
      /* Banks, insurers and REITs are excluded from the reference. Asset
         turnover for a bank is a statement about balance-sheet size, not
         about how the business converts assets into sales, and a quarter
         of this panel is financial — leaving them in drags the median
         turnover down and inflates every other company's multiple. */
      if (isFinancial(c)) return;
      var d = dupontThreeFactor(toPeriod(fieldReader, row, year),
        c.years[year - 1] ? toPeriod(fieldReader, c.years[year - 1], year - 1) : null);
      if (isNum(d.pretaxMargin)) ms.push(d.pretaxMargin);
      if (isNum(d.assetTurnover)) ts.push(d.assetTurnover);
    });
    var med = function (a) {
      if (!a.length) return null;
      var v = a.slice().sort(function (x, y) { return x - y; }), h = Math.floor(v.length / 2);
      return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
    };
    return { margin: med(ms), turnover: med(ts), firms: ms.length };
  }

  function dupontThreeFactor(period, priorPeriod, peerMedians) {
    var is = period.incomeStatement, b = period.balanceSheet;
    var pb = priorPeriod ? priorPeriod.balanceSheet : null;
    var pbt = is.pretaxIncome;
    /* Pre-tax income is not always tagged; EBIT less interest is the same
       thing by construction where it is not. */
    if (!isNum(pbt)) {
      var e = ebitOf(period);
      if (isNum(e) && isNum(is.interestExpense)) pbt = e - Math.abs(is.interestExpense);
    }
    var avg = function (cur, prior) {
      if (!isNum(cur)) return null;
      return isNum(prior) ? (cur + prior) / 2 : cur;
    };
    var avgAssets = avg(b.totalAssets, pb ? pb.totalAssets : null);
    var eqNow = isNum(b.equityIncludingNci) ? b.equityIncludingNci
      : (isNum(b.equity) ? b.equity + (isNum(b.minorityInterest) ? b.minorityInterest : 0) : null);
    var eqPrior = pb ? (isNum(pb.equityIncludingNci) ? pb.equityIncludingNci
      : (isNum(pb.equity) ? pb.equity + (isNum(pb.minorityInterest) ? pb.minorityInterest : 0) : null)) : null;
    var avgEquity = avg(eqNow, eqPrior);
    var margin = div(pbt, is.revenue);
    var turnover = div(is.revenue, avgAssets);
    var leverage = div(avgAssets, avgEquity);
    var product = (isNum(margin) && isNum(turnover) && isNum(leverage))
      ? margin * turnover * leverage : null;
    return {
      pretaxMargin: margin, assetTurnover: turnover, equityMultiplier: leverage,
      pretaxRoe: product,
      driver: describeDriver(margin, turnover, peerMedians)
    };
  }

  /**
   * How an industry's profitability level and spread move together.
   *
   * The course's apparel panel shows the median margin falling from 12.4%
   * to 8.4% across seventeen years while the spread between best and worst
   * stayed roughly constant — competitive convergence pulling the whole
   * distribution down without compressing it. Level and dispersion are two
   * different findings and are reported separately.
   */
  function dispersionTrend(series) {
    if (!series || series.length < 3) return null;
    var first = series[0], last = series[series.length - 1];
    return {
      fromYear: first.year, toYear: last.year,
      medianStart: first.marginMedian, medianEnd: last.marginMedian,
      medianChange: (isNum(first.marginMedian) && isNum(last.marginMedian))
        ? last.marginMedian - first.marginMedian : null,
      spreadStart: first.marginSpread, spreadEnd: last.marginSpread,
      spreadChange: (isNum(first.marginSpread) && isNum(last.marginSpread))
        ? last.marginSpread - first.marginSpread : null
    };
  }

  /* ---------- cohorts ---------- */

  /* Below five members a quartile is not a quartile; below three a median
     is not a distribution. The cross-section degrades rather than
     pretending, because "top quartile of four" reads as a finding and is
     not one. */
  var MIN_QUANTILE_COHORT = 5, MIN_MEDIAN_COHORT = 3;

  /** Members sharing the first n digits of a SIC code. */
  function cohortBySic(panel, sic, digits) {
    if (!sic) return [];
    var pre = String(sic).slice(0, digits || 3);
    return Object.keys(panel).map(function (t) {
      var c = panel[t];
      return { ticker: t, name: c.name, industry: c.industry, sector: c.sector,
               sic: c.sic, years: c.years };
    }).filter(function (c) { return String(c.sic || "").slice(0, digits || 3) === pre; });
  }

  /**
   * One metric measured across a cohort for one year.
   *
   * Every "versus its peers" figure on the page goes through here, so the
   * count behind a comparison is always known and always the same on both
   * sides of it. The industry aggregates broke once because a numerator and
   * a denominator covered different companies; a single path is how that
   * stops being possible.
   */
  function cohortStats(get, members, year, metricFn) {
    var values = [], tickers = [], synthetic = 0;
    for (var i = 0; i < members.length; i++) {
      var c = members[i], row = c.years[year];
      if (!row) continue;
      var period = toPeriod(get, row, year);
      var prior = c.years[year - 1] ? toPeriod(get, c.years[year - 1], year - 1) : null;
      var v = metricFn(period, prior, c);
      if (!isNum(v)) continue;
      if (ebitIsSynthetic(period)) synthetic++;
      values.push(v); tickers.push(c.ticker);
    }
    var n = values.length;
    return {
      values: values, tickers: tickers, n: n, of: members.length,
      syntheticCount: synthetic,
      syntheticShare: n ? synthetic / n : null,
      median: n >= MIN_MEDIAN_COHORT ? median(values) : null,
      p25: n >= MIN_QUANTILE_COHORT ? quantile(values, 0.25) : null,
      p75: n >= MIN_QUANTILE_COHORT ? quantile(values, 0.75) : null,
      enoughForMedian: n >= MIN_MEDIAN_COHORT,
      enoughForQuantiles: n >= MIN_QUANTILE_COHORT
    };
  }

  /**
   * The newest year a given figure actually resolves for a company.
   *
   * A company's most recent panel year is often partial — the balance
   * sheet is filed before the full-year income statement, so Amazon's 2026
   * row carries assets and no revenue. Every headline figure in a case
   * resolves through this so that the sections cannot silently report
   * different years from one another.
   */
  function latestResolvedYear(get, company, resolver, maxBack) {
    var years = Object.keys(company.years).map(Number).sort(function (a, b) { return b - a; });
    var back = maxBack || 5;
    for (var i = 0; i < years.length && i < back; i++) {
      var y = years[i];
      var prior = company.years[y - 1] ? toPeriod(get, company.years[y - 1], y - 1) : null;
      if (isNum(resolver(toPeriod(get, company.years[y], y), prior, company))) return y;
    }
    return null;
  }

  /* ---------- company case ---------- */

  /* A return outside 300% either way is a broken denominator, not a
     business. Both sides of every comparison filter identically, so a
     company and its peers are never screened on different rules. */
  function sane(r) { return isNum(r) && Math.abs(r) < 3; }

  /** Return on invested capital, per year, for one company. */
  function companyRoicSeries(get, company, years, isLender) {
    return years.map(function (y) {
      var row = company.years[y]; if (!row) return null;
      var prior = company.years[y - 1] ? toPeriod(get, company.years[y - 1], y - 1) : null;
      var period = toPeriod(get, row, y);
      var r = porterRoic(period, prior, undefined, isLender);
      return sane(r) ? { year: y, roic: r, syntheticEbit: ebitIsSynthetic(period) } : null;
    }).filter(Boolean);
  }

  /** Median return on invested capital, per year, across a peer set. */
  function cohortRoicSeries(get, members, years) {
    return years.map(function (y) {
      var vals = [];
      for (var i = 0; i < members.length; i++) {
        var m = members[i], row = m.years[y]; if (!row) continue;
        var prior = m.years[y - 1] ? toPeriod(get, m.years[y - 1], y - 1) : null;
        var r = porterRoic(toPeriod(get, row, y), prior, undefined, isFinancial(m));
        if (sane(r)) vals.push(r);
      }
      return { year: y, median: median(vals), n: vals.length };
    }).filter(function (d) { return isNum(d.median); });
  }

  /**
   * The gap between a company's return and its peers', averaged over a
   * window and over the SAME years on both sides.
   *
   * Taking each side's own last five years would compare a company's good
   * run against a cohort's different five, which is not a comparison.
   */
  function advantageSpread(coSeries, cohortSeries, windowYears) {
    var w = windowYears || 5;
    var byYear = {};
    cohortSeries.forEach(function (d) { byYear[d.year] = d.median; });
    var paired = coSeries.filter(function (d) { return isNum(byYear[d.year]); });
    if (!paired.length) return null;
    var use = paired.slice(-w);
    var co = use.reduce(function (a, d) { return a + d.roic; }, 0) / use.length;
    var ind = use.reduce(function (a, d) { return a + byYear[d.year]; }, 0) / use.length;
    return {
      years: use.length, complete: use.length >= w,
      fromYear: use[0].year, toYear: use[use.length - 1].year,
      co: co, cohort: ind, gap: co - ind,
      syntheticYears: use.filter(function (d) { return d.syntheticEbit; }).length
    };
  }

  /**
   * Why the return differs from the peer median.
   *
   * Return on capital is margin times capital turns, so the gap splits
   * exactly into a margin effect, a turns effect, and the interaction
   * between them. The interaction is shown rather than folded into either
   * one, because absorbing it silently overstates whichever absorbed it.
   */
  function advantageDecomposition(period, prior, cohortMargin, cohortTurns, isLender) {
    var e = ebitOf(period, isLender), rev = period.incomeStatement.revenue;
    var icNow = investedCapital(period), icPrior = prior ? investedCapital(prior) : null;
    var avgIc = isNum(icNow) ? (isNum(icPrior) ? (icNow + icPrior) / 2 : icNow) : null;
    if (!isNum(avgIc) || avgIc <= 0) return null;
    var m = div(e, rev), t = div(rev, avgIc);
    /* A cohort median at or below zero makes every relative reading
       meaningless rather than merely large, so the split is withheld. */
    if (!isNum(m) || !isNum(t) || !isNum(cohortMargin) || !isNum(cohortTurns)) return null;
    if (cohortMargin <= 0 || cohortTurns <= 0) return null;
    var marginEffect = (m - cohortMargin) * cohortTurns;
    var turnsEffect = cohortMargin * (t - cohortTurns);
    var interaction = (m - cohortMargin) * (t - cohortTurns);
    return {
      margin: m, turns: t, cohortMargin: cohortMargin, cohortTurns: cohortTurns,
      marginEffect: marginEffect, turnsEffect: turnsEffect, interaction: interaction,
      total: marginEffect + turnsEffect + interaction,
      leadBy: Math.abs(marginEffect) >= Math.abs(turnsEffect) ? "margin" : "turns"
    };
  }

  /**
   * Whether a margin advantage comes from what a company charges or from
   * what it spends running the business.
   *
   * Gross margin carries price, mix and input cost together. Operating
   * expense intensity carries the cost of the activity set behind them. A
   * filing cannot separate price from mix, and the page says so rather
   * than implying it can.
   */
  function marginRoute(period, cohortGrossMargin, cohortOpexIntensity) {
    var is = period.incomeStatement, rev = is.revenue;
    if (!isNum(rev) || rev <= 0) return null;
    var gp = isNum(is.grossProfit) ? is.grossProfit
      : (isNum(is.cogs) ? rev - is.cogs : null);
    var haveOpex = isNum(is.sellingGeneralAdmin) || isNum(is.researchDevelopment);
    var opex = (isNum(is.sellingGeneralAdmin) ? is.sellingGeneralAdmin : 0) +
               (isNum(is.researchDevelopment) ? is.researchDevelopment : 0);
    var gm = div(gp, rev), oi = haveOpex ? opex / rev : null;
    var gmGap = (isNum(gm) && isNum(cohortGrossMargin)) ? gm - cohortGrossMargin : null;
    /* Spending less is an advantage, so the sign is flipped and both gaps
       read the same way: positive means better than the peer set. */
    var opexGap = (isNum(oi) && isNum(cohortOpexIntensity)) ? cohortOpexIntensity - oi : null;
    var label = null;
    if (isNum(gmGap) && isNum(opexGap)) {
      var g = gmGap >= 0.02, o = opexGap >= 0.02;
      var gl = gmGap <= -0.02, ol = opexGap <= -0.02;
      label = (g && o) ? "Both routes at once: it earns more per sale and spends less to make it"
        : (g && !gl) ? "Price and mix: a wider gross margin than its peers"
        : (o && !ol) ? "The cost of the activity set: less overhead per dollar of sales"
        : (gl && ol) ? "Neither: a narrower gross margin and heavier overhead than its peers"
        : gl ? "Held back on gross margin"
        : ol ? "Held back by overhead"
        : "Neither route separates it from its peers";
    }
    return { grossMargin: gm, opexIntensity: oi, grossMarginGap: gmGap,
             opexIntensityGap: opexGap, label: label };
  }

  /**
   * Where each dollar of revenue ends up.
   *
   * Share-based compensation is deliberately absent as a slice: it is a
   * cash-flow add-back, and the same expense already sits inside cost of
   * sales, research and overhead. Showing it beside them would push the
   * split past 100%. The slices are reconciled against revenue, and the
   * section refuses to render when they do not close.
   */
  function valueSplit(period) {
    var is = period.incomeStatement, rev = is.revenue;
    if (!isNum(rev) || rev <= 0) return null;
    var cogs = isNum(is.cogs) ? is.cogs
      : (isNum(is.grossProfit) ? rev - is.grossProfit : null);
    var net = is.netIncome;
    if (!isNum(cogs) || !isNum(net)) return null;
    var rnd = isNum(is.researchDevelopment) ? is.researchDevelopment : 0;
    var sga = isNum(is.sellingGeneralAdmin) ? is.sellingGeneralAdmin : 0;
    var interest = isNum(is.interestExpense) ? Math.abs(is.interestExpense) : 0;
    var tax = isNum(is.incomeTax) ? is.incomeTax : 0;
    /* Everything the income statement names, before the plug. */
    var named = cogs + rnd + sga + interest + tax + net;
    var other = rev - named;
    var slices = [
      { key: "cogs", label: "Suppliers and production", value: cogs },
      { key: "rnd", label: "Research and development", value: rnd },
      { key: "sga", label: "Selling and administration", value: sga },
      { key: "other", label: "Other operating items", value: other },
      { key: "interest", label: "Lenders", value: interest },
      { key: "tax", label: "Tax", value: tax },
      { key: "net", label: "Shareholders", value: net }
    ].map(function (x) {
      return { key: x.key, label: x.label, value: x.value, share: x.value / rev };
    });
    /* The residual is a plug, so the slices always sum to revenue and
       checking that proves nothing. What is worth checking is the SIZE of
       the plug: a large one means the statement is not being read
       correctly, and a negative one means the company earned more outside
       operations than the plug can represent as a cost — true of a
       cash-rich business earning interest, and worth naming rather than
       drawing as a negative bar. */
    var residualShare = other / rev;
    return {
      revenue: rev, slices: slices, residualShare: residualShare,
      residualIsIncome: other < 0,
      usable: Math.abs(residualShare) < 0.25
    };
  }

  /**
   * What a company did with its operating cash.
   *
   * A filing never states a strategy, but it records every capital
   * decision behind one. Shares are of operating cash flow and are allowed
   * to exceed it, because a company can outspend what it earns; the
   * residual is labelled rather than normalised away.
   */
  function reinvestmentMix(get, company, years) {
    return years.map(function (y) {
      var row = company.years[y]; if (!row) return null;
      var p = toPeriod(get, row, y), cf = p.cashFlow;
      var ops = cf.cfOps;
      if (!isNum(ops) || ops <= 0) return null;
      var v = function (x) { return isNum(x) ? Math.abs(x) : 0; };
      var capex = v(cf.capex), rnd = v(p.incomeStatement.researchDevelopment);
      var dividends = v(cf.dividendsPaid), buybacks = v(cf.buybacks);
      return {
        year: y, cfOps: ops,
        capex: capex / ops, rnd: rnd / ops,
        dividends: dividends / ops, buybacks: buybacks / ops,
        deployed: (capex + rnd + dividends + buybacks) / ops
      };
    }).filter(Boolean);
  }

  /** How long cash is tied up between paying for stock and being paid for it. */
  function workingCapitalDays(period, prior) {
    var is = period.incomeStatement, b = period.balanceSheet;
    var pb = prior ? prior.balanceSheet : null;
    var avg = function (a, p) { return isNum(a) ? (isNum(p) ? (a + p) / 2 : a) : null; };
    var dso = div(avg(b.receivables, pb && pb.receivables), is.revenue);
    var dio = div(avg(b.inventory, pb && pb.inventory), is.cogs);
    /* Days payable is measured against purchases, not cost of sales: what
       was bought in the period, which is cost of sales plus the movement
       in inventory. */
    var purchases = (isNum(is.cogs) && isNum(b.inventory) && pb && isNum(pb.inventory))
      ? is.cogs + (b.inventory - pb.inventory) : is.cogs;
    var dpo = div(avg(b.payables, pb && pb.payables), purchases);
    var d = function (x) { return isNum(x) ? x * 365 : null; };
    var dsoD = d(dso), dioD = d(dio), dpoD = d(dpo);
    return {
      dso: dsoD, dio: dioD, dpo: dpoD,
      cashCycle: (isNum(dsoD) && isNum(dioD) && isNum(dpoD)) ? dsoD + dioD - dpoD : null
    };
  }

  /** Contracted but unrecognised revenue — the only signed forward demand a filing carries. */
  function backlogTrend(get, company, years) {
    var out = years.map(function (y) {
      var row = company.years[y]; if (!row) return null;
      var p = toPeriod(get, row, y);
      var rpo = p.balanceSheet.remainingPerformanceObligation;
      var deferred = p.balanceSheet.deferredRevenue;
      if (!isNum(rpo) && !isNum(deferred)) return null;
      return { year: y, backlog: rpo, deferred: deferred,
               coverage: isNum(rpo) ? div(rpo, p.incomeStatement.revenue) : null };
    }).filter(Boolean);
    return out.length ? out : null;
  }

  /**
   * Whether a company's standing depends on where the industry boundary
   * was drawn. Where it moves a lot, the boundary is a strategic choice
   * rather than a property of the data, and the page says so.
   */
  function scopeTest(get, company, narrow, wide, year, metricFn) {
    var row = company.years[year]; if (!row) return null;
    var n = cohortStats(get, narrow, year, metricFn);
    var w = cohortStats(get, wide, year, metricFn);
    if (!n.enoughForMedian || !w.enoughForMedian) return null;
    var prior = company.years[year - 1] ? toPeriod(get, company.years[year - 1], year - 1) : null;
    var v = metricFn(toPeriod(get, row, year), prior, company);
    if (!isNum(v)) return null;
    /* The subject is added to whichever set does not already contain it,
       so both percentiles are measured over a set that includes it. */
    var withSubject = function (vals) {
      return vals.indexOf(v) === -1 ? vals.concat([v]) : vals;
    };
    var rn = rankAmong(v, withSubject(n.values));
    var rw = rankAmong(v, withSubject(w.values));
    if (!rn || !rw) return null;
    return {
      value: v, narrowN: n.n, wideN: w.n,
      narrowPct: rn.percentile, widePct: rw.percentile,
      shift: rw.percentile - rn.percentile,
      material: Math.abs(rw.percentile - rn.percentile) >= 0.15
    };
  }

  /* ---------- industry aggregation ---------- */

  /**
   * One industry in one fiscal year: totals, shares, concentration, the
   * profit pool, and the spread of profitability across its members.
   */
  function industryYear(get, members, year) {
    /* Coverage guards against a fake growth story. An industry total
       built from 12 of 19 members understates the industry, and a CAGR
       measured from such a base year reads as growth that never
       happened. Every aggregate carries the fraction of members actually
       reporting, so the caller can drop thin years rather than average
       across them unknowingly. */
    var memberCount = members.length;
    var rows = [];
    for (var i = 0; i < members.length; i++) {
      var c = members[i], row = c.years[year];
      if (!row) continue;
      rows.push({
        ticker: c.ticker, name: c.name,
        revenue: get(row, "revenue"),
        /* ebitOf, not the raw tag: with four of five refiners no longer
           tagging operating income, the raw field divided one member's
           profit by the whole industry's revenue and reported 1.0%. */
        operatingIncome: ebitOf(toPeriod(get, row, year), isFinancial(c)),
        operatingIncomeReported: get(row, "operatingIncome"),
        netIncome: get(row, "netIncome"),
        totalAssets: get(row, "totalAssets"),
        rnd: get(row, "researchDevelopment"),
        capex: get(row, "capex"),
        ppe: get(row, "ppe"),
        grossProfit: get(row, "grossProfit"),
        cogs: get(row, "cogs")
      });
    }
    if (!rows.length) return null;

    var revenues = rows.map(function (r) { return r.revenue; });
    var totalRevenue = sum(revenues);
    /* Disclosed rather than buried: a reader is entitled to know how much
       of an industry total was rebuilt from pre-tax income. */
    var synthetic = rows.filter(function (r) {
      return !isNum(r.operatingIncomeReported) && isNum(r.operatingIncome);
    });
    var syntheticRevenue = sum(synthetic.map(function (r) { return r.revenue; }));
    /* Members with no usable operating figure at all are counted, because
       they would otherwise sit in one total and not the other. */
    var missingProfit = rows.filter(function (r) {
      return !isNum(r.operatingIncome) && isNum(r.revenue);
    });

    /* A margin is only meaningful over firms present in BOTH totals.
       Members contributing revenue but no profit understate it — four of
       five refiners no longer tag operating income, which reported the
       industry at 1.0%. Members contributing profit but no revenue
       overstate it — Wells Fargo, Goldman and Morgan Stanley report
       pre-tax income with no revenue line this pull recognises, which put
       Banks above 100%. Both are the same defect: an aggregate ratio whose
       numerator and denominator cover different companies. The pool is
       therefore built on matched members only, and how much of the
       industry that leaves out is reported rather than hidden. */
    var matched = rows.filter(function (r) {
      return isNum(r.revenue) && isNum(r.operatingIncome) &&
        marginIsCredible(r.revenue, r.operatingIncome);
    });
    var implausible = rows.filter(function (r) {
      return isNum(r.revenue) && isNum(r.operatingIncome) &&
        !marginIsCredible(r.revenue, r.operatingIncome);
    });
    var matchedRevenue = sum(matched.map(function (r) { return r.revenue; }));
    var matchedProfit = sum(matched.map(function (r) { return r.operatingIncome; }));
    var profitCoverage = div(matchedRevenue, totalRevenue);
    var totalOperatingIncome = matchedProfit;
    var totalAssets = sum(rows.map(function (r) { return r.totalAssets; }));

    var margins = matched.map(function (r) { return div(r.operatingIncome, r.revenue); });
    var grossMargins = rows.map(function (r) {
      var gp = isNum(r.grossProfit) ? r.grossProfit
        : (isNum(r.revenue) && isNum(r.cogs) ? r.revenue - r.cogs : null);
      return div(gp, r.revenue);
    });

    /* Profit share against revenue share is the profit-pool read: a firm
       taking a materially bigger slice of the profit than of the revenue
       is capturing more value per dollar sold than its rivals do. Shares
       are taken over the matched subset so they sum to one. */
    var pool = matched.map(function (r) {
      return {
        ticker: r.ticker, name: r.name,
        revenue: r.revenue,
        revenueShare: div(r.revenue, matchedRevenue),
        operatingIncome: r.operatingIncome,
        profitShare: div(r.operatingIncome, matchedProfit),
        operatingMargin: div(r.operatingIncome, r.revenue),
        /* Profit share divided by revenue share. Above 1 means the firm
           takes a bigger slice of the industry's profit than of its
           revenue — the numeric form of "profit share matters more than
           market share". Ford earned nearly half its profit from
           financing on under a fifth of its revenue. */
        poolCaptureRatio: (function () {
          var rs = div(r.revenue, matchedRevenue);
          var ps = div(r.operatingIncome, matchedProfit);
          return (isNum(rs) && isNum(ps) && rs > 0) ? ps / rs : null;
        })()
      };
    }).sort(function (a, b) { return (b.revenue || 0) - (a.revenue || 0); });

    var marginHi = quantile(margins, 0.75), marginLo = quantile(margins, 0.25);
    return {
      year: year,
      firms: rows.length,
      memberCount: memberCount,
      coverage: memberCount ? rows.length / memberCount : null,
      totalRevenue: totalRevenue,
      syntheticProfitFirms: synthetic.length,
      syntheticProfitShare: div(syntheticRevenue, totalRevenue),
      missingProfitFirms: missingProfit.length,
      /* Share of industry revenue whose owners also report a usable
         profit figure. The margin below describes only these firms. */
      profitCoverage: profitCoverage,
      poolFirms: matched.length,
      poolRevenue: matchedRevenue,
      implausibleFirms: implausible.map(function (r) { return r.ticker; }),
      totalOperatingIncome: totalOperatingIncome,
      totalAssets: totalAssets,
      industryMargin: div(matchedProfit, matchedRevenue),
      concentration: concentration(revenues),
      pool: pool,
      marginMedian: median(margins),
      marginP25: marginLo,
      marginP75: marginHi,
      /* How far apart the best and worst performers sit. A wide spread
         says firm choices matter more than industry membership; a narrow
         one says structure dominates and everyone earns roughly alike. */
      marginSpread: (isNum(marginHi) && isNum(marginLo)) ? marginHi - marginLo : null,
      marginStdev: stdev(margins),
      grossMarginMedian: median(grossMargins),
      rndIntensity: div(sum(rows.map(function (r) { return r.rnd; })), totalRevenue),
      capexIntensity: div(sum(rows.map(function (r) { return r.capex; })), totalRevenue),
      assetTurnover: div(totalRevenue, totalAssets)
    };
  }

  /** The full time series for one industry. */
  function industrySeries(get, members, years, minCoverage) {
    var floor = isNum(minCoverage) ? minCoverage : 0.8;
    var out = [];
    for (var i = 0; i < years.length; i++) {
      var y = industryYear(get, members, years[i]);
      /* A year where most of the industry has not reported is dropped
         rather than shown, because a partial total is not a smaller
         industry — it is a missing measurement. */
      if (y && (y.coverage === null || y.coverage >= floor)) out.push(y);
    }
    return out;
  }

  /* ---------- growth ---------- */

  function cagr(first, last, years) {
    if (!isNum(first) || !isNum(last) || first <= 0 || last <= 0 || years <= 0) return null;
    return Math.pow(last / first, 1 / years) - 1;
  }

  /**
   * Split a firm's growth into the part the industry delivered and the
   * part that came from taking share.
   *
   * A company growing 8% in an industry growing 8% has gained nothing
   * competitively; one growing 3% while its industry shrinks 5% has
   * gained a great deal. Reported growth alone cannot tell those apart,
   * which is why it is decomposed rather than shown on its own.
   */
  function growthDecomposition(firmSeries, industryData) {
    if (!firmSeries || firmSeries.length < 2) return null;
    var f0 = firmSeries[0], f1 = firmSeries[firmSeries.length - 1];
    var n = f1.year - f0.year;
    if (n <= 0) return null;
    var firmCagr = cagr(f0.revenue, f1.revenue, n);
    var i0 = null, i1 = null;
    for (var i = 0; i < industryData.length; i++) {
      if (industryData[i].year === f0.year) i0 = industryData[i];
      if (industryData[i].year === f1.year) i1 = industryData[i];
    }
    var industryCagr = (i0 && i1) ? cagr(i0.totalRevenue, i1.totalRevenue, n) : null;
    var share0 = i0 ? div(f0.revenue, i0.totalRevenue) : null;
    var share1 = i1 ? div(f1.revenue, i1.totalRevenue) : null;
    return {
      years: n,
      firmCagr: firmCagr,
      industryCagr: industryCagr,
      /* The gap is the share effect: growth beyond what the industry
         handed to every participant. */
      shareEffect: (isNum(firmCagr) && isNum(industryCagr)) ? firmCagr - industryCagr : null,
      shareStart: share0, shareEnd: share1,
      shareChange: (isNum(share0) && isNum(share1)) ? share1 - share0 : null,
      outgrewIndustry: (isNum(firmCagr) && isNum(industryCagr)) ? firmCagr > industryCagr : null
    };
  }

  /**
   * McKinsey's long-run reference: ROIC for US nonfinancial companies ran
   * 8-11% across 1963-2008. It sits alongside Porter's 14.9% rather than
   * contradicting it — Porter measures EBIT before tax against invested
   * capital net of excess cash, McKinsey measures an after-tax return
   * across the whole nonfinancial universe. Two different questions, two
   * different normals; both are shown so neither is mistaken for the only
   * benchmark.
   */
  var MCKINSEY_ROIC_BAND = { low: 0.08, high: 0.11,
    source: "McKinsey, US nonfinancial companies, 1963-2008" };

  /**
   * Inflation distorts every margin and return in a panel that spans a
   * price shock, and the distortion runs one way.
   *
   * Assets are replaced only a fraction at a time, so the capital base and
   * the depreciation charged against it lag inflation by years while
   * revenue reprices almost immediately. Reported margins and returns on
   * capital therefore RISE after an inflation spike even when nothing has
   * changed in real terms. The historical check is that US returns stayed
   * near 8-11% through the high-inflation 1970s and 80s: had companies
   * genuinely passed inflation through, returns would have shown 25-30%.
   *
   * This panel spans the 2021-23 spike, so any read of improving returns
   * across that window has to clear this bar before it counts as real.
   * The flag is advisory — it marks years for interpretation rather than
   * adjusting the figures, because a credible deflator needs
   * industry-specific input prices this data does not carry.
   */
  var INFLATION_YEARS = { 2021: 0.047, 2022: 0.080, 2023: 0.041 };
  function inflationCaution(years) {
    var hits = (years || []).filter(function (y) { return INFLATION_YEARS[y]; });
    if (!hits.length) return null;
    return {
      years: hits,
      note: "Spans the " + hits[0] + "-" + hits[hits.length - 1] +
        " inflation period. Reported margins and returns on capital rise " +
        "mechanically after a price shock, because revenue reprices at once " +
        "while the capital base and its depreciation lag by years. Treat " +
        "improvement across this window as nominal until shown otherwise."
    };
  }

  /**
   * The shape of healthy organic growth, read off a long trajectory.
   *
   * The pattern to look for is earnings compounding faster than sales,
   * and sales faster than assets — the business getting more profitable
   * and more capital-efficient as it grows, rather than simply bigger.
   * The inverse, sales outrunning earnings, is the growth trap: revenue
   * bought at the cost of the returns that made the business worth
   * growing. Maytag grew revenue fivefold while return on sales fell by
   * an order of magnitude.
   */
  function growthQuality(periods) {
    if (!periods || periods.length < 3) return null;
    var first = periods[0], last = periods[periods.length - 1];
    var n = last.fiscalYear - first.fiscalYear;
    if (n < 2) return null;
    var ebitFirst = ebitOf(first), ebitLast = ebitOf(last);
    var salesCagr = cagr(first.incomeStatement.revenue, last.incomeStatement.revenue, n);
    var earningsCagr = cagr(ebitFirst, ebitLast, n);
    var assetCagr = cagr(first.balanceSheet.totalAssets, last.balanceSheet.totalAssets, n);
    var marginFirst = div(ebitFirst, first.incomeStatement.revenue);
    var marginLast = div(ebitLast, last.incomeStatement.revenue);
    var marginChange = (isNum(marginFirst) && isNum(marginLast))
      ? marginLast - marginFirst : null;
    var verdict = null;
    if (isNum(salesCagr) && isNum(marginChange)) {
      if (salesCagr > 0.02 && marginChange > 0.01) verdict = "Compounding — growth with rising margin";
      else if (salesCagr > 0.02 && marginChange < -0.02) verdict = "Growth trap — revenue up, margin down";
      else if (salesCagr > 0.02) verdict = "Growing, margin roughly held";
      else if (salesCagr <= 0.02 && marginChange > 0.01) verdict = "Harvesting — margin up, little growth";
      else verdict = "Flat or declining";
    }
    return {
      years: n, salesCagr: salesCagr, earningsCagr: earningsCagr,
      assetCagr: assetCagr,
      marginStart: marginFirst, marginEnd: marginLast, marginChange: marginChange,
      earningsBeatSales: (isNum(earningsCagr) && isNum(salesCagr)) ? earningsCagr > salesCagr : null,
      salesBeatAssets: (isNum(salesCagr) && isNum(assetCagr)) ? salesCagr > assetCagr : null,
      verdict: verdict
    };
  }

  /* ---------- competitive position ---------- */

  /**
   * Where a firm sits among its peers on one measure in one year.
   * Percentile accompanies rank because "3rd of 5" and "3rd of 19" are
   * not the same statement.
   */
  function rankAmong(value, peerValues) {
    if (!isNum(value)) return null;
    var peers = peerValues.filter(isNum);
    if (peers.length < 2) return null;
    var below = peers.filter(function (v) { return v < value; }).length;
    var med = median(peers);
    /* Counted, not looked up. indexOf returned -1 for a value absent from
       the array, so the rank came out 0 — an impossible rank — whenever
       the subject was not itself one of the peers. That is the normal case
       once a company can be compared against a cohort it does not belong
       to. Counting how many beat it is correct either way, and it gives
       tied values the same rank instead of ordering them arbitrarily. */
    return {
      rank: peers.filter(function (v) { return v > value; }).length + 1,
      of: peers.length,
      percentile: below / (peers.length - 1),
      median: med,
      vsMedian: isNum(med) ? value - med : null
    };
  }

  /**
   * Does an advantage hold, or was it a good year?
   *
   * Counts how often a firm sat above its industry's median across the
   * whole window. Strategy is about durable position, so a company ahead
   * in 15 of 19 years is telling a different story from one that managed
   * it three times.
   */
  function persistence(firmByYear, industryMedianByYear) {
    var years = 0, above = 0, streak = 0, bestStreak = 0;
    var keys = Object.keys(firmByYear).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < keys.length; i++) {
      var y = keys[i];
      var v = firmByYear[y], m = industryMedianByYear[y];
      if (!isNum(v) || !isNum(m)) continue;
      years++;
      if (v > m) { above++; streak++; if (streak > bestStreak) bestStreak = streak; }
      else streak = 0;
    }
    if (!years) return null;
    var share = above / years;
    return {
      years: years, yearsAbove: above,
      share: share,
      longestStreak: bestStreak,
      verdict: share >= 0.8 ? "Persistent advantage"
        : share >= 0.55 ? "Usually ahead"
        : share >= 0.3 ? "Mixed" : "Persistently behind"
    };
  }

  return {
    isNum: isNum, div: div, sum: sum, median: median, quantile: quantile, stdev: stdev,
    makeReader: makeReader, toPeriod: toPeriod, companyPeriods: companyPeriods,
    concentration: concentration,
    excessCash: excessCash, investedCapital: investedCapital, ebitOf: ebitOf,
    porterRoic: porterRoic, PORTER_ROIC_BANDS: PORTER_ROIC_BANDS,
    placeAgainstPorter: placeAgainstPorter,
    PORTER_INDUSTRY_ROIC: PORTER_INDUSTRY_ROIC, porterNeighbours: porterNeighbours,
    rollingAverage: rollingAverage, dupontThreeFactor: dupontThreeFactor,
    dispersionTrend: dispersionTrend, describeDriver: describeDriver,
    cohortBySic: cohortBySic, cohortStats: cohortStats,
    latestResolvedYear: latestResolvedYear,
    companyRoicSeries: companyRoicSeries, cohortRoicSeries: cohortRoicSeries,
    advantageSpread: advantageSpread, advantageDecomposition: advantageDecomposition,
    marginRoute: marginRoute, valueSplit: valueSplit,
    reinvestmentMix: reinvestmentMix, workingCapitalDays: workingCapitalDays,
    backlogTrend: backlogTrend, scopeTest: scopeTest,
    MIN_QUANTILE_COHORT: MIN_QUANTILE_COHORT, MIN_MEDIAN_COHORT: MIN_MEDIAN_COHORT,
    marginIsCredible: marginIsCredible, ebitIsSynthetic: ebitIsSynthetic,
    panelReference: panelReference, isFinancial: isFinancial,
    OPERATING_CASH_RATE: OPERATING_CASH_RATE,
    industryYear: industryYear, industrySeries: industrySeries,
    cagr: cagr, growthDecomposition: growthDecomposition,
    MCKINSEY_ROIC_BAND: MCKINSEY_ROIC_BAND,
    inflationCaution: inflationCaution, INFLATION_YEARS: INFLATION_YEARS,
    growthQuality: growthQuality,
    rankAmong: rankAmong, persistence: persistence
  };
});
