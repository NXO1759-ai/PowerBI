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
        sellingMarketing: null, operatingExpenses: null,
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
        payables: null, deferredRevenue: null,
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

  function ebitOf(period) {
    var is = period.incomeStatement;
    if (isNum(is.operatingIncome)) return is.operatingIncome;
    if (isNum(is.pretaxIncome) && isNum(is.interestExpense)) {
      return is.pretaxIncome + Math.abs(is.interestExpense);
    }
    return null;
  }

  /** Porter ROIC for one year, averaging capital with the prior year. */
  function porterRoic(period, priorPeriod, operatingCashRate) {
    var e = ebitOf(period);
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
    return { roic: roic, band: band, vsMedian: roic - b.median, bands: b };
  }

  /* ---------- industry aggregation ---------- */

  /**
   * One industry in one fiscal year: totals, shares, concentration, the
   * profit pool, and the spread of profitability across its members.
   */
  function industryYear(get, members, year) {
    var rows = [];
    for (var i = 0; i < members.length; i++) {
      var c = members[i], row = c.years[year];
      if (!row) continue;
      rows.push({
        ticker: c.ticker, name: c.name,
        revenue: get(row, "revenue"),
        operatingIncome: get(row, "operatingIncome"),
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
    var totalOperatingIncome = sum(rows.map(function (r) { return r.operatingIncome; }));
    var totalAssets = sum(rows.map(function (r) { return r.totalAssets; }));

    var margins = rows.map(function (r) { return div(r.operatingIncome, r.revenue); });
    var grossMargins = rows.map(function (r) {
      var gp = isNum(r.grossProfit) ? r.grossProfit
        : (isNum(r.revenue) && isNum(r.cogs) ? r.revenue - r.cogs : null);
      return div(gp, r.revenue);
    });

    /* Profit share against revenue share is the profit-pool read: a firm
       taking a materially bigger slice of the profit than of the revenue
       is capturing more value per dollar sold than its rivals do. */
    var pool = rows.map(function (r) {
      return {
        ticker: r.ticker, name: r.name,
        revenue: r.revenue,
        revenueShare: div(r.revenue, totalRevenue),
        operatingIncome: r.operatingIncome,
        profitShare: div(r.operatingIncome, totalOperatingIncome),
        operatingMargin: div(r.operatingIncome, r.revenue),
        /* Profit share divided by revenue share. Above 1 means the firm
           takes a bigger slice of the industry's profit than of its
           revenue — the numeric form of "profit share matters more than
           market share". Ford earned nearly half its profit from
           financing on under a fifth of its revenue. */
        poolCaptureRatio: (function () {
          var rs = div(r.revenue, totalRevenue);
          var ps = div(r.operatingIncome, totalOperatingIncome);
          return (isNum(rs) && isNum(ps) && rs > 0) ? ps / rs : null;
        })()
      };
    }).sort(function (a, b) { return (b.revenue || 0) - (a.revenue || 0); });

    var marginHi = quantile(margins, 0.75), marginLo = quantile(margins, 0.25);
    return {
      year: year,
      firms: rows.length,
      totalRevenue: totalRevenue,
      totalOperatingIncome: totalOperatingIncome,
      totalAssets: totalAssets,
      industryMargin: div(totalOperatingIncome, totalRevenue),
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
  function industrySeries(get, members, years) {
    var out = [];
    for (var i = 0; i < years.length; i++) {
      var y = industryYear(get, members, years[i]);
      if (y) out.push(y);
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
    var sorted = peers.slice().sort(function (a, b) { return b - a; });
    var med = median(peers);
    return {
      rank: sorted.indexOf(value) + 1,
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
    OPERATING_CASH_RATE: OPERATING_CASH_RATE,
    industryYear: industryYear, industrySeries: industrySeries,
    cagr: cagr, growthDecomposition: growthDecomposition,
    rankAmong: rankAmong, persistence: persistence
  };
});
