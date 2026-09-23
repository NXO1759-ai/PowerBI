/**
 * ratios.js — the analytical engine of the Statement Analysis dashboard.
 *
 * The framework is the one taught in ACCOUNTG 597 (Chen, Fuqua): the
 * balance sheet is REFORMULATED into operating and financing items before
 * any return is computed, and return on equity is decomposed ADDITIVELY
 * into an operating return and a financing return.
 *
 *     A  = L + E
 *     OA + FA = OL + FL + E
 *     NOA = OA − OL = FL − FA + E        ( = Net Debt + E )
 *
 *     RNOA = NOPAT / avg NOA = (NOPAT/Rev) × (Rev/NOA)
 *     ROE  = RNOA + [ RNOA − r_d·(1−t) ] × ( Net Debt / BVE )
 *                    └────── spread ──────┘   └── leverage ──┘
 *                    └──── financial leverage gain ─────────┘
 *
 * This matters and is not interchangeable with textbook DuPont. Classic
 * DuPont multiplies margin, turnover and an equity multiplier, which mixes
 * operating performance with financing decisions in a single number. The
 * additive form separates them, so a company whose ROE rose purely on
 * borrowing is visibly distinguishable from one that got better at
 * operating. Cracker Barrel's ROE went 13.4% to 71.0% while its RNOA went
 * 12.3% to 11.5% — all leverage, no improvement. Classic DuPont hides
 * that; this shows it.
 *
 * Two conventions, both deliberate and both from the course:
 *   - HISTORICAL returns use AVERAGE balance sheet figures, because
 *     income is earned across a period while a balance sheet is one
 *     instant. Dividing a flow by a closing balance flatters any company
 *     that grew during the period.
 *   - Anything that cannot be computed is null, never zero. A zero is a
 *     measurement; an absence is not, and they must not look alike.
 *
 * Margins and returns are FRACTIONS (0.42), not percentages.
 *
 * Definitions live beside the arithmetic in METRICS at the foot of this
 * file, so the hover text on a card and the number on it can never drift
 * apart. Loaded UMD-style like metrics.js: one file, browser and Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RTRatios = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FRAMEWORK_VERSION = 1;
  var STATUTORY_TAX_RATE = 0.21;

  function isNum(v) {
    return v !== null && v !== undefined && typeof v === "number" && !isNaN(v);
  }
  function div(a, b) {
    if (!isNum(a) || !isNum(b) || b === 0) return null;
    var r = a / b;
    return isFinite(r) ? r : null;
  }
  function sub(a, b) { return isNum(a) && isNum(b) ? a - b : null; }
  function add() {
    var any = false, total = 0;
    for (var i = 0; i < arguments.length; i++) {
      if (isNum(arguments[i])) { any = true; total += arguments[i]; }
    }
    return any ? total : null;
  }
  function avg(current, prior) {
    if (!isNum(current)) return null;
    if (!isNum(prior)) return current;
    return (current + prior) / 2;
  }
  var absOf = function (v) { return isNum(v) ? Math.abs(v) : null; };

  /* ================= reformulation =================
   *
   * Only INTEREST-BEARING debt is a financial liability. Deferred taxes,
   * accrued expenses, payables and other non-current liabilities are
   * OPERATING — they arise from running the business, not from financing
   * it, and sweeping them into debt would understate NOA and inflate
   * RNOA. Financial assets are cash and short-term investments only.
   */

  function financialLiabilities(p) {
    var b = p.balanceSheet;
    return add(b.shortTermDebt, b.longTermDebt);
  }
  function financialAssets(p) {
    var b = p.balanceSheet;
    return add(b.cash, b.shortTermInvestments);
  }
  function netDebt(p) {
    var fl = financialLiabilities(p), fa = financialAssets(p);
    if (!isNum(fl) && !isNum(fa)) return null;
    return (isNum(fl) ? fl : 0) - (isNum(fa) ? fa : 0);
  }
  /**
   * TOTAL equity, including noncontrolling interest.
   *
   * NOA = Net Debt + Equity is an identity, and it only holds if equity
   * is the whole right-hand side of the balance sheet after debt. Using
   * parent-only equity leaves noncontrolling interest stranded and the
   * identity fails by exactly that amount. The course's Costco worked
   * example makes the point explicitly: it takes total equity of 12,573,
   * which includes the 571 of noncontrolling interest, not the 12,002
   * attributable to Costco's own shareholders.
   */
  function bookEquity(p) {
    var b = p.balanceSheet;
    if (isNum(b.equityIncludingNci)) return b.equityIncludingNci;
    if (isNum(b.equity)) {
      return b.equity + (isNum(b.minorityInterest) ? b.minorityInterest : 0);
    }
    return null;
  }
  /** Equity attributable to common shareholders — used for per-share only. */
  function commonEquity(p) { return p.balanceSheet.equity; }

  /**
   * Net income for the reformulation: the consolidated bottom line,
   * including the share belonging to noncontrolling interests.
   *
   * It must match the equity it is measured against. NOA is built on
   * total equity, so pairing it with parent-only income would break the
   * ROE identity by exactly the noncontrolling share — which is how
   * Costco's spread comes out at −3.8% instead of the correct −1.2%.
   */
  function totalNetIncome(p) {
    var is = p.incomeStatement;
    if (isNum(is.netIncomeIncludingNci)) return is.netIncomeIncludingNci;
    return is.netIncome;
  }

  /** NOA = FL − FA + E = Net Debt + Equity. Also called invested capital. */
  function netOperatingAssets(p) {
    var nd = netDebt(p), e = bookEquity(p);
    if (!isNum(e)) return null;
    return (isNum(nd) ? nd : 0) + e;
  }

  /* ================= operating profit =================
   *
   * EBIT is "earnings before interest expense and income taxes". Where a
   * filer does not tag operating income, it is rebuilt as pre-tax income
   * plus interest expense, which is EBIT by definition.
   */
  function ebit(p) {
    var is = p.incomeStatement;
    if (isNum(is.operatingIncome)) return is.operatingIncome;
    if (isNum(is.pretaxIncome) && isNum(is.interestExpense)) {
      return is.pretaxIncome + Math.abs(is.interestExpense);
    }
    return null;
  }
  function ebitda(p) {
    var e = ebit(p), da = p.cashFlow.depreciationAmortization;
    return isNum(e) && isNum(da) ? e + da : null;
  }
  /** t = income tax provision / pre-tax income. */
  function effectiveTaxRate(p) {
    var is = p.incomeStatement;
    var t = div(is.incomeTax, is.pretaxIncome);
    return t;
  }
  /* A loss year or a one-off benefit produces a negative or absurd
     effective rate that would distort NOPAT more than it informs, so the
     statutory federal rate stands in and the substitution is flagged. */
  function taxRateForNopat(p) {
    var t = effectiveTaxRate(p);
    if (isNum(t) && t >= 0 && t <= 0.6) return { rate: t, statutory: false };
    return { rate: STATUTORY_TAX_RATE, statutory: true };
  }
  /** NOPAT = EBIT × (1 − t). */
  function nopat(p) {
    var e = ebit(p);
    if (!isNum(e)) return null;
    return e * (1 - taxRateForNopat(p).rate);
  }

  /* ================= cash flow =================
   *
   * FCFU = CFO + after-tax interest paid − long-term investment.
   * "Long-term investment" is implemented as TOTAL cash used in investing,
   * following the course's worked example, not capex alone. Adding back
   * after-tax interest removes the financing decision from an operating
   * cash flow measure, which is the same move the reformatted statement
   * of cash flows makes.
   */
  function afterTaxInterest(p) {
    var i = absOf(p.incomeStatement.interestExpense);
    if (!isNum(i)) return null;
    return i * (1 - taxRateForNopat(p).rate);
  }
  function freeCashFlowToFirm(p) {
    var cfo = p.cashFlow.cfOps, ati = afterTaxInterest(p), cfi = p.cashFlow.cfInv;
    if (!isNum(cfo)) return null;
    return cfo + (isNum(ati) ? ati : 0) - (isNum(cfi) ? Math.abs(cfi) : 0);
  }
  /** The conventional measure: operating cash flow less capital spending. */
  function freeCashFlow(p) {
    var cfo = p.cashFlow.cfOps, capex = absOf(p.cashFlow.capex);
    if (!isNum(cfo)) return null;
    return isNum(capex) ? cfo - capex : cfo;
  }

  /* ================= life cycle =================
   *
   * The sign pattern across the three cash flow sections places a company
   * in its life cycle. A negative operating cash flow is normal for a
   * young company and alarming for a mature one, so the same numbers only
   * mean something once the stage is named.
   */
  function lifeCycleStage(p) {
    var cf = p.cashFlow;
    var o = cf.cfOps, i = cf.cfInv, f = cf.cfFin;
    if (!isNum(o) || !isNum(i) || !isNum(f)) return null;
    if (o < 0 && i < 0 && f > 0) return "Introduction or growth";
    if (o > 0 && i < 0 && f > 0) return "Growth";
    if (o > 0 && i < 0 && f < 0) return "Mature";
    if (o > 0 && i > 0 && f < 0) return "Mature or declining";
    if (o < 0 && i > 0 && f < 0) return "Decline";
    if (o < 0 && i > 0 && f > 0) return "Distress or restructuring";
    return "Atypical";
  }

  /* ================= one period ================= */

  function computePeriod(p, prior) {
    var is = p.incomeStatement, b = p.balanceSheet, cf = p.cashFlow;
    var pb = prior ? prior.balanceSheet : null;
    var rev = is.revenue;

    /* Quarterly flows annualise by four wherever a flow meets a balance,
       so a quarterly RNOA is comparable with an annual one. */
    var perYear = p.fiscalPeriod === "FY" ? 1 : 4;
    var ann = function (v) { return isNum(v) ? v * perYear : null; };
    var daysInPeriod = p.fiscalPeriod === "FY" ? 365 : 91;

    var e = ebit(p), eb = ebitda(p), np = nopat(p);
    var niTotal = totalNetIncome(p);
    var taxInfo = taxRateForNopat(p);
    var fl = financialLiabilities(p), fa = financialAssets(p);
    var nd = netDebt(p), noa = netOperatingAssets(p), bve = bookEquity(p);
    var ndPrior = prior ? netDebt(prior) : null;
    var noaPrior = prior ? netOperatingAssets(prior) : null;
    var bvePrior = prior ? bookEquity(prior) : null;

    var avgNoa = avg(noa, noaPrior);
    var avgNetDebt = avg(nd, ndPrior);
    var avgEquity = avg(bve, bvePrior);
    var avgAssets = avg(b.totalAssets, pb ? pb.totalAssets : null);
    var avgReceivables = avg(b.receivables, pb ? pb.receivables : null);
    var avgInventory = avg(b.inventory, pb ? pb.inventory : null);
    var avgPayables = avg(b.payables, pb ? pb.payables : null);

    var r = {};
    r.periodEnd = p.periodEnd;
    r.label = p.label;
    r.fiscalYear = p.fiscalYear;
    r.fiscalPeriod = p.fiscalPeriod;
    r.derived = !!p.derived;
    r.averagesApproximate = !prior;
    r.taxRateIsStatutory = taxInfo.statutory;

    /* --- reformulated balance sheet --- */
    r.financialLiabilities = fl;
    r.financialAssets = fa;
    r.netDebt = nd;
    r.netOperatingAssets = noa;
    r.bookEquity = bve;
    r.ebit = e;
    r.ebitda = eb;
    r.nopat = np;
    r.effectiveTaxRate = effectiveTaxRate(p);

    /* --- the operating return --- */
    r.rnoa = div(ann(np), avgNoa);
    r.nopatMargin = div(np, rev);
    r.noaTurnover = div(ann(rev), avgNoa);
    r.roe = div(ann(niTotal), avgEquity);
    r.roa = div(ann(niTotal), avgAssets);

    /* --- the financing return ---
     *
     * After-tax NET interest expense is derived as NOPAT − NI, not read
     * off the income statement. That is deliberate and it matters:
     *   - it is NET, so interest income on cash offsets interest paid on
     *     debt, which is the only treatment consistent with a NET debt
     *     denominator;
     *   - it sweeps up every non-operating item, not just the ones a
     *     filer happens to tag;
     *   - it makes the decomposition close by construction, so any gap
     *     between the sum and ROE is a data problem rather than a
     *     definitional one.
     *
     * When NOPAT < NI the firm earns net non-operating INCOME and the
     * figure is correctly negative — a company with more cash than debt
     * has a negative net borrowing rate, which is not an error.
     */
    var afterTaxNetInterestExpense = (isNum(np) && isNum(niTotal))
      ? np - niTotal : null;
    r.afterTaxNetInterestExpense = afterTaxNetInterestExpense;
    /* Net debt near zero makes the rate explode, so it is withheld rather
       than reported as a meaningless number. */
    r.afterTaxNetInterestRate = (isNum(avgNetDebt) && Math.abs(avgNetDebt) > 1)
      ? div(ann(afterTaxNetInterestExpense), avgNetDebt) : null;
    r.spread = (isNum(r.rnoa) && isNum(r.afterTaxNetInterestRate))
      ? r.rnoa - r.afterTaxNetInterestRate : null;
    r.netFinancialLeverage = div(avgNetDebt, avgEquity);
    r.financialLeverageGain = (isNum(r.spread) && isNum(r.netFinancialLeverage))
      ? r.spread * r.netFinancialLeverage : null;

    /* Advanced DuPont: ROE = RNOA + Spread x Net Financial Leverage.
       Additive, so the operating and financing contributions to ROE are
       readable in percentage points side by side. `residual` should be
       near zero; a large one means the reformulation did not hold, which
       usually points at missing balance sheet tags. */
    r.advancedDupont = {
      rnoa: r.rnoa,
      spread: r.spread,
      netFinancialLeverage: r.netFinancialLeverage,
      financialLeverageGain: r.financialLeverageGain,
      reconciled: (isNum(r.rnoa) && isNum(r.financialLeverageGain))
        ? r.rnoa + r.financialLeverageGain : null,
      roe: r.roe,
      residual: (isNum(r.rnoa) && isNum(r.financialLeverageGain) && isNum(r.roe))
        ? r.roe - (r.rnoa + r.financialLeverageGain) : null,
    };

    /* Modified DuPont: ROE = RNOA x Earnings Leverage x Financial Leverage.
       Earnings leverage (NI/NOPAT) is the income-statement half of the
       financing effect — below 1 when the firm pays net interest, above 1
       when it earns net non-operating income. Financial leverage here is
       NOA/Equity, the balance-sheet half. */
    r.earningsLeverage = div(niTotal, np);
    r.financialLeverage = div(avgNoa, avgEquity);
    r.modifiedDupont = {
      rnoa: r.rnoa,
      earningsLeverage: r.earningsLeverage,
      financialLeverage: r.financialLeverage,
      product: (isNum(r.rnoa) && isNum(r.earningsLeverage) && isNum(r.financialLeverage))
        ? r.rnoa * r.earningsLeverage * r.financialLeverage : null,
      roe: r.roe,
    };

    /* Traditional DuPont, kept for comparison rather than for decisions.
       It multiplies an equity multiplier straight into the return, so a
       company that merely borrowed more looks like one that got better
       at operating. Showing it beside the advanced form is the point. */
    r.assetTurnoverTraditional = div(ann(rev), avgAssets);
    r.equityMultiplier = div(avgAssets, avgEquity);
    r.traditionalDupont = {
      netMargin: div(is.netIncome, rev),
      assetTurnover: r.assetTurnoverTraditional,
      roa: r.roa,
      equityMultiplier: r.equityMultiplier,
      product: (isNum(r.roa) && isNum(r.equityMultiplier))
        ? r.roa * r.equityMultiplier : null,
      roe: r.roe,
    };

    /* RNOA = NOPAT margin x NOA turnover — what a strategy entails.
       A cost leader earns a thin margin on fast turnover; a
       differentiator earns a fat margin on slow turnover. Two companies
       can reach the same RNOA by opposite routes, and the split says
       which business they are actually running. */
    r.rnoaDrivers = {
      nopatMargin: r.nopatMargin,
      noaTurnover: r.noaTurnover,
      product: (isNum(r.nopatMargin) && isNum(r.noaTurnover))
        ? r.nopatMargin * r.noaTurnover : null,
      rnoa: r.rnoa,
    };

    /* --- margins --- */
    var gp = isNum(is.grossProfit) ? is.grossProfit : sub(rev, is.cogs);
    r.grossMargin = div(gp, rev);
    r.operatingMargin = div(e, rev);
    r.netMargin = div(is.netIncome, rev);
    r.ebitdaMargin = div(eb, rev);
    r.sgaMargin = div(is.sellingGeneralAdmin, rev);
    r.rndMargin = div(is.researchDevelopment, rev);

    /* --- working capital efficiency --- */
    r.assetTurnover = div(ann(rev), avgAssets);
    r.receivablesTurnover = div(ann(rev), avgReceivables);
    r.daysSalesOutstanding = div(avgReceivables, div(rev, daysInPeriod));
    r.inventoryTurnover = div(ann(is.cogs), avgInventory);
    r.daysInventoryOutstanding = div(avgInventory, div(is.cogs, daysInPeriod));
    /* Payables turnover is built on PURCHASES, not cost of goods sold.
       What a company owes suppliers arises from what it bought, and what
       it bought is what it consumed plus what it added to the shelf:
           BB + Purchases − COGS = EB  =>  Purchases = COGS + ΔInventory
       Substituting COGS is the common shortcut and it understates
       payable days for any company building inventory. */
    r.purchases = (isNum(is.cogs) && pb && isNum(b.inventory) && isNum(pb.inventory))
      ? is.cogs + (b.inventory - pb.inventory) : is.cogs;
    r.payablesTurnover = div(ann(r.purchases), avgPayables);
    r.daysPayablesOutstanding = div(avgPayables, div(r.purchases, daysInPeriod));
    /* The operating cycle is how long cash is tied up in the business
       before suppliers are taken into account; the cash cycle nets them
       off. A negative cash cycle means suppliers fund the working
       capital, which is why a sub-1 current ratio can be perfectly safe. */
    r.netOperatingCycle = (isNum(r.daysSalesOutstanding) && isNum(r.daysInventoryOutstanding))
      ? r.daysSalesOutstanding + r.daysInventoryOutstanding : null;
    r.cashConversionCycle = (isNum(r.netOperatingCycle) && isNum(r.daysPayablesOutstanding))
      ? r.netOperatingCycle - r.daysPayablesOutstanding : null;
    r.fixedAssetTurnover = div(ann(rev), avg(b.ppe, pb ? pb.ppe : null));

    /* --- liquidity --- */
    r.workingCapital = sub(b.currentAssets, b.currentLiabilities);
    r.currentRatio = div(b.currentAssets, b.currentLiabilities);
    r.quickRatio = div(add(b.cash, b.shortTermInvestments, b.receivables),
                       b.currentLiabilities);
    r.cashRatio = div(add(b.cash, b.shortTermInvestments), b.currentLiabilities);
    r.operatingCashFlowRatio = div(cf.cfOps, b.currentLiabilities);

    /* Cash burn measured in DAYS of liquid assets, not as a percentage —
       "how long could this company operate on what it holds" is the
       question a liquidity reader is actually asking. Read it beside the
       cash conversion cycle: Walmart shows 11.5 days of liquid assets and
       a current ratio under 1, which looks alarming until the cash cycle
       turns out to be minus 14 days. */
    var dailyOperatingSpend = div(add(is.cogs, is.sellingGeneralAdmin), daysInPeriod);
    r.cashBurnDays = div(add(b.cash, b.shortTermInvestments, b.receivables),
                         dailyOperatingSpend);
    r.cashFlowAdequacy = div(cf.cfOps,
      add(absOf(cf.capex), absOf(cf.dividendsPaid)));

    /* --- solvency --- */
    var interest = absOf(is.interestExpense);
    r.debtToEquity = div(fl, bve);
    r.netDebtToEquity = div(nd, bve);
    r.debtToAssets = div(fl, b.totalAssets);
    r.liabilitiesToAssets = div(b.totalLiabilities, b.totalAssets);
    r.liabilitiesToEquity = div(b.totalLiabilities, bve);
    r.netDebtToEbitda = div(nd, ann(eb));
    /* Times interest earned, kept as named variants rather than collapsed
       into one. Which numerator is right depends on what you take to be
       the firm's true economic income — the same argument as net income
       versus operating cash flow. */
    r.interestCoverageEbit = (isNum(e) && isNum(interest) && interest > 0)
      ? e / interest : null;
    r.interestCoverageEbitda = (isNum(eb) && isNum(interest) && interest > 0)
      ? eb / interest : null;
    r.interestCoverageNopat = (isNum(np) && isNum(interest) && interest > 0)
      ? np / interest : null;
    r.interestCoverageCash = (isNum(cf.cfOps) && isNum(interest) && interest > 0)
      ? cf.cfOps / interest : null;
    r.interestCoverage = r.interestCoverageEbit;

    /* --- cash flow and earnings quality --- */
    r.freeCashFlow = freeCashFlow(p);
    r.freeCashFlowToFirm = freeCashFlowToFirm(p);
    r.afterTaxInterest = afterTaxInterest(p);
    r.fcfMargin = div(r.freeCashFlow, rev);
    r.cashConversion = div(cf.cfOps, is.netIncome);
    /* The share of reported profit not backed by operating cash. High and
       persistent readings precede reversals. */
    r.accrualsRatio = div(sub(is.netIncome, cf.cfOps), avgAssets);
    r.capex = absOf(cf.capex);
    r.capexToRevenue = div(r.capex, rev);
    /* Capital spending against the depreciation it is meant to replace.
       Below 1.0 sustained means the asset base is shrinking. */
    r.capexToDepreciation = div(r.capex, cf.depreciationAmortization);
    r.sbcToRevenue = div(cf.shareBasedComp, rev);
    r.lifeCycleStage = lifeCycleStage(p);

    /* Asset age, from depreciation. Net property over the annual charge
       says roughly how many years of book life remain, which is how soon
       a replacement wave of capital spending is due. A short remaining
       life beside weak free cash flow is a squeeze in the making. */
    r.assetRemainingLifeYears = div(b.ppe, cf.depreciationAmortization);

    /* Cash-flow cushion: how far operating cash could fall before it no
       longer covers the interest bill. Expressed as the fraction of
       headroom, so 0.17 means adjusted operating cash flow can drop 17%
       before interest stops being serviceable. */
    var adjustedCfo = add(cf.cfOps, r.afterTaxInterest);
    r.cashFlowCushion = (isNum(adjustedCfo) && isNum(interest) && adjustedCfo > 0)
      ? (adjustedCfo - interest) / adjustedCfo : null;

    /* --- the reformatted statement of cash flows ---
       Interest is moved out of operations and into debt service, so the
       operating subtotal is genuinely free of the financing decision. */
    r.reformattedCashFlow = {
      netIncome: is.netIncome,
      afterTaxInterestExpense: r.afterTaxInterest,
      longTermAccruals: add(cf.depreciationAmortization, cf.shareBasedComp),
      adjustedCfoBeforeInvestments: add(is.netIncome, r.afterTaxInterest,
        cf.depreciationAmortization, cf.shareBasedComp),
      netInvestmentInLongTermAssets: isNum(r.capex) ? -r.capex : null,
      surplusFromOperations: r.freeCashFlowToFirm,
      netCashForShareholders: (function () {
        var d = absOf(cf.dividendsPaid), bb = absOf(cf.buybacks);
        var t = add(d, bb);
        return isNum(t) ? -t : null;
      })(),
    };

    /* --- shareholder returns --- */
    r.dividendsPaid = absOf(cf.dividendsPaid);
    r.buybacks = absOf(cf.buybacks);
    r.shareholderReturn = add(r.dividendsPaid, r.buybacks);
    r.payoutRatio = div(r.dividendsPaid, is.netIncome);
    r.fcfPayoutRatio = div(r.shareholderReturn, r.freeCashFlow);

    /* --- per share --- */
    var shareCount = p.shares.dilutedShares || p.shares.sharesOutstanding;
    r.epsBasic = p.perShare.epsBasic;
    r.epsDiluted = p.perShare.epsDiluted;
    r.bookValuePerShare = div(bve, shareCount);
    r.fcfPerShare = div(r.freeCashFlow, shareCount);

    /* --- common size income statement --- */
    r.commonSize = {
      cogs: div(is.cogs, rev),
      grossProfit: r.grossMargin,
      researchDevelopment: r.rndMargin,
      sellingGeneralAdmin: r.sgaMargin,
      operatingIncome: r.operatingMargin,
      interestExpense: div(interest, rev),
      incomeTax: div(is.incomeTax, rev),
      netIncome: r.netMargin,
    };

    return r;
  }

  /* ================= series ================= */

  function growth(current, prior) {
    if (!isNum(current) || !isNum(prior) || prior === 0) return null;
    return (current - prior) / Math.abs(prior);
  }

  function computeRatios(periods) {
    if (!periods || !periods.length) return [];
    return periods.map(function (p, i) {
      var prior = i > 0 ? periods[i - 1] : null;
      var yearAgoIndex = p.fiscalPeriod === "FY" ? i - 1 : i - 4;
      var yearAgo = yearAgoIndex >= 0 ? periods[yearAgoIndex] : null;
      var r = computePeriod(p, prior);
      r.growth = {
        revenue: yearAgo ? growth(p.incomeStatement.revenue, yearAgo.incomeStatement.revenue) : null,
        netIncome: yearAgo ? growth(p.incomeStatement.netIncome, yearAgo.incomeStatement.netIncome) : null,
        ebit: yearAgo ? growth(ebit(p), ebit(yearAgo)) : null,
        eps: yearAgo ? growth(p.perShare.epsDiluted, yearAgo.perShare.epsDiluted) : null,
        freeCashFlow: yearAgo ? growth(freeCashFlow(p), freeCashFlow(yearAgo)) : null,
        totalAssets: yearAgo ? growth(p.balanceSheet.totalAssets, yearAgo.balanceSheet.totalAssets) : null,
        netOperatingAssets: yearAgo ? growth(netOperatingAssets(p), netOperatingAssets(yearAgo)) : null,
      };
      return r;
    });
  }

  /**
   * Altman Z-score — bankruptcy screening.
   *
   *   Z = 1.2·(WC/TA) + 1.4·(RE/TA) + 3.3·(EBIT/TA)
   *       + 0.6·(MVE/Debt) + 1.0·(Sales/TA)
   *
   * The five terms stand in for liquidity, accumulated profitability,
   * operating profitability, solvency and asset productivity, which is
   * why it is fairly described as a weighted average of DuPont ratios
   * with weights fitted to historical bankruptcies.
   *
   * Below 1.81 predicts bankruptcy, above 2.99 predicts survival, and
   * everything between is the ZONE OF IGNORANCE — the model declining to
   * answer, which is information in itself rather than a middling score.
   *
   * It is a screen, not a verdict. Accuracy runs about 95% one year
   * before failure and decays to roughly a third by year five, so a
   * reading here is a reason to look harder, never a conclusion.
   *
   * marketCap is passed in because it is not in the filings. Without it
   * the fourth term falls back to book equity, which understates the
   * score for any company trading above book — flagged in `usedBookEquity`.
   */
  function altmanZ(p, marketCap) {
    var b = p.balanceSheet, is = p.incomeStatement;
    var ta = b.totalAssets;
    if (!isNum(ta) || ta === 0) return null;
    var wc = sub(b.currentAssets, b.currentLiabilities);
    var debt = financialLiabilities(p);
    if (!isNum(debt) || debt === 0) debt = b.totalLiabilities;
    var equityForRatio = isNum(marketCap) ? marketCap : bookEquity(p);
    var usedBookEquity = !isNum(marketCap);
    var e = ebit(p);
    /* Annualise a quarterly income statement so EBIT/TA and Sales/TA are
       comparable with the annual data the weights were fitted on. */
    var perYear = p.fiscalPeriod === "FY" ? 1 : 4;
    var terms = {
      workingCapitalToAssets: div(wc, ta),
      retainedEarningsToAssets: div(b.retainedEarnings, ta),
      ebitToAssets: div(isNum(e) ? e * perYear : null, ta),
      equityToDebt: div(equityForRatio, debt),
      salesToAssets: div(isNum(is.revenue) ? is.revenue * perYear : null, ta),
    };
    var weights = {
      workingCapitalToAssets: 1.2,
      retainedEarningsToAssets: 1.4,
      ebitToAssets: 3.3,
      equityToDebt: 0.6,
      salesToAssets: 1.0,
    };
    var z = 0, missing = [];
    for (var k in terms) {
      if (isNum(terms[k])) z += weights[k] * terms[k];
      else missing.push(k);
    }
    /* A score missing two or more of five inputs is not a Z-score. */
    if (missing.length > 1) return null;
    var zone = z < 1.81 ? "Distress"
      : z > 2.99 ? "Safe" : "Zone of ignorance";
    return {
      score: z, zone: zone, terms: terms, weights: weights,
      missing: missing, usedBookEquity: usedBookEquity,
    };
  }

  /**
   * Residual income: profit left after charging for the equity used.
   *
   *   RI = NI − r_e × BVE
   *
   * Positive residual income and ROE above the cost of equity are the
   * same statement. It is the pass/fail line for whether a company
   * created value for its owners, as distinct from merely reporting a
   * profit — accounting income charges for debt but never for equity,
   * so a company can be profitable and still be destroying value.
   */
  function residualIncome(p, costOfEquity, priorPeriod) {
    var ni = p.incomeStatement.netIncome;
    var bve = priorPeriod ? bookEquity(priorPeriod) : bookEquity(p);
    if (!isNum(ni) || !isNum(bve) || !isNum(costOfEquity)) return null;
    var perYear = p.fiscalPeriod === "FY" ? 1 : 4;
    var charge = costOfEquity * bve;
    return {
      netIncome: ni * perYear,
      equityCharge: charge,
      residualIncome: ni * perYear - charge,
      createsValue: (ni * perYear - charge) > 0,
      costOfEquity: costOfEquity,
      bookValueUsed: bve,
      basis: priorPeriod ? "beginning equity" : "ending equity",
    };
  }

  /**
   * Earnings quality over the whole history.
   *
   * Over a long enough window, cumulative net income should approximate
   * cumulative free cash flow. A persistent gap means reported profit is
   * not converting into cash, which is either an investment cycle the
   * income statement has not caught up with, or an accrual problem.
   * W.T. Grant reported positive income for a decade while operating cash
   * flow was deeply negative, and the divergence was visible years before
   * the bankruptcy.
   */
  function earningsQuality(periods) {
    if (!periods || !periods.length) return null;
    var sumNi = 0, sumFcf = 0, sumCfo = 0, n = 0;
    for (var i = 0; i < periods.length; i++) {
      var ni = periods[i].incomeStatement.netIncome;
      var f = freeCashFlow(periods[i]);
      var cfo = periods[i].cashFlow.cfOps;
      if (isNum(ni) && isNum(f)) { sumNi += ni; sumFcf += f; n++; }
      if (isNum(cfo)) sumCfo += cfo;
    }
    if (!n) return null;
    return {
      periods: n,
      cumulativeNetIncome: sumNi,
      cumulativeFreeCashFlow: sumFcf,
      cumulativeOperatingCashFlow: sumCfo,
      gap: sumNi - sumFcf,
      /* >1 means profit has outrun cash over the window */
      conversionRatio: div(sumFcf, sumNi),
      cashConversionRatio: div(sumCfo, sumNi),
    };
  }

  /**
   * The level AND the volatility of the spread.
   *
   * Whether a company carries too much debt is not answered by how much
   * it has borrowed. It is answered by how far the operating return
   * exceeds the after-tax cost of that debt, and by how stable that gap
   * is. A thin but steady spread supports far more leverage safely than
   * a wide but erratic one, because the erratic one goes negative in the
   * years the company can least afford it.
   *
   * Reported together for exactly that reason — a mean with no dispersion
   * beside it invites the wrong conclusion.
   */
  function spreadStability(ratios) {
    if (!ratios || !ratios.length) return null;
    var values = [];
    for (var i = 0; i < ratios.length; i++) {
      if (isNum(ratios[i].spread)) values.push(ratios[i].spread);
    }
    if (values.length < 2) return null;
    var sum = 0;
    for (var j = 0; j < values.length; j++) sum += values[j];
    var mean = sum / values.length;
    var sq = 0;
    for (var k = 0; k < values.length; k++) sq += Math.pow(values[k] - mean, 2);
    var sd = Math.sqrt(sq / (values.length - 1));
    var negatives = values.filter(function (v) { return v < 0; }).length;
    return {
      periods: values.length,
      mean: mean,
      standardDeviation: sd,
      min: Math.min.apply(null, values),
      max: Math.max.apply(null, values),
      periodsNegative: negatives,
      /* Mean divided by dispersion: how many standard deviations of
         cushion sit between the average spread and zero. */
      stability: sd > 0 ? mean / sd : null,
    };
  }

  /* ================= Underwriting (blueprint section 5) =================
   *
   * The covered companies read as a lender would read them, through the
   * same reformulation above plus three pieces the Statement Analysis
   * dashboard never needed: a fixed-charge test that nets out capital
   * spending and cash taxes before the debt service line, an FFO-based
   * leverage measure the rating agencies use beside debt/EBITDA, and the
   * distance from a company's own ratio to the next tier of a band table
   * — the synthetic covenant headroom, since the site never computes a
   * real covenant. These take plain numbers, not a period object: the
   * underwriting page sources EBITDA, capex and the rest from the LTM
   * period itself (EBITDA there is operating income plus D&A, stated as
   * such — never an adjusted figure — per the house rule against
   * computing a real covenant or an adjusted EBITDA).
   */

  /**
   * Fixed-charge coverage, the non-GAAP form blueprint section 5 names:
   *
   *   (EBITDA − capex − cash taxes) ÷ (cash interest + mandatory amortization)
   *
   * Null-refusing on every input: a missing capex or tax figure is not
   * silently treated as zero, because doing so would flatter the coverage
   * of a company whose capex line the feed simply never resolved. This is
   * therefore stricter than ratios like ebitdaMargin above, which use
   * add() to tolerate a missing term — a fixed-charge test built on a
   * silently-zeroed input is worse than none at all.
   */
  function fixedChargeCoverage(ebitda, capex, cashTaxes, cashInterest, mandatoryAmortization) {
    if (!isNum(ebitda) || !isNum(capex) || !isNum(cashTaxes) ||
        !isNum(cashInterest) || !isNum(mandatoryAmortization)) return null;
    return div(ebitda - capex - cashTaxes, cashInterest + mandatoryAmortization);
  }

  /**
   * FFO to total debt, the S&P ratio that anchors the financial-risk
   * matrix's FFO/debt column beside debt/EBITDA.
   *
   * FFO has no single GAAP definition — S&P's own is a longer bridge from
   * net income through several add-backs a filing does not tag uniformly
   * across companies — so the site proxies it as
   *
   *   FFO ≈ net income + depreciation and amortization
   *
   * and the caller states that proxy is what it passed in. This function
   * only divides; it does not compute the proxy itself, so a caller using
   * the fuller S&P bridge where the tags support it can pass that figure
   * through the same division. Null-refusing, like the coverage measure
   * above.
   */
  function ffoToDebt(ffo, totalDebt) {
    if (!isNum(ffo) || !isNum(totalDebt)) return null;
    return div(ffo, totalDebt);
  }

  /**
   * S&P's financial-risk matrix for net debt/EBITDA (the 2009 matrix,
   * Table 2, carried into the 2013 corporate methodology; blueprint
   * section 5): minimal under 1.5x, modest 1.5–2x, intermediate 2–3x,
   * significant 3–4x, aggressive 4–5x, highly leveraged over 5x.
   *
   * Declared once here rather than in the underwriting page or the
   * weekly panel builder that reads it, per the blueprint's instruction
   * not to duplicate the table: ratios.js is already loaded by both (the
   * browser page directly, the builder through the same UMD export), so
   * one array serves the U1 scatter's quadrant lines, the scorecard band
   * label and bandDistance below without three copies of the breakpoints
   * drifting apart. `min` is inclusive, `max` exclusive except the last
   * band's, which is unbounded.
   */
  var SP_FINANCIAL_RISK_BANDS = [
    { key: "minimal", label: "Minimal", min: 0, max: 1.5 },
    { key: "modest", label: "Modest", min: 1.5, max: 2 },
    { key: "intermediate", label: "Intermediate", min: 2, max: 3 },
    { key: "significant", label: "Significant", min: 3, max: 4 },
    { key: "aggressive", label: "Aggressive", min: 4, max: 5 },
    { key: "highlyLeveraged", label: "Highly leveraged", min: 5, max: Infinity },
  ];

  /**
   * The synthetic covenant headroom: how far a debt/EBITDA-style ratio
   * (ascending risk — higher is worse, `bands` ordered lowest risk first
   * with touching edges) sits from the next, worse band of a table like
   * SP_FINANCIAL_RISK_BANDS above, plus — once the company sits at or
   * above the 4.0x sub-investment-grade line blueprint section 5 draws a
   * second ladder from — its distance to the 6.0x leveraged-lending
   * guidance line.
   *
   *   currentBand              the band `value` falls in
   *   nextBand                 the next-worse band, or null at the top
   *   turnsToNext               turns of leverage to the next band's edge
   *   ebitdaDeclinePctToNext    the EBITDA decline that would produce it,
   *                             debt held fixed: since value = debt / EBITDA,
   *                             reaching the edge needs
   *                             EBITDA' = debt / edge = EBITDA x value / edge,
   *                             a decline of (edge − value) / edge
   *   guidanceLine, turnsToGuidanceLine, ebitdaDeclinePctToGuidanceLine
   *                             the same two figures against the 6.0x
   *                             line, populated only at or above
   *                             `guidanceThreshold` (4.0 by default) —
   *                             below it the sub-investment-grade ladder
   *                             does not apply and all three are null. A
   *                             negative distance means the company has
   *                             already crossed the guidance line.
   *
   * Every field this labels "synthetic": no credit agreement is read, and
   * the real covenant, if the company has one, is very likely set at a
   * different level than a published guideline. null-refusing: a
   * non-numeric value or an empty or non-array band table returns null
   * rather than guessing a band.
   */
  function bandDistance(value, bands, opts) {
    if (!isNum(value) || !Array.isArray(bands) || !bands.length) return null;
    opts = opts || {};
    var guidanceLine = isNum(opts.guidanceLine) ? opts.guidanceLine : 6.0;
    var guidanceThreshold = isNum(opts.guidanceThreshold) ? opts.guidanceThreshold : 4.0;

    var idx = -1;
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      if (!isNum(b.min) || typeof b.max !== "number") continue;
      if (value >= b.min && (value < b.max || !isFinite(b.max))) { idx = i; break; }
    }
    if (idx === -1) return null;

    var currentBand = bands[idx];
    var nextBand = idx + 1 < bands.length ? bands[idx + 1] : null;
    var edge = nextBand && isFinite(currentBand.max) ? currentBand.max : null;
    var turnsToNext = edge !== null ? edge - value : null;
    var ebitdaDeclinePctToNext = (edge !== null && edge > 0) ? (edge - value) / edge : null;

    var atOrAboveThreshold = value >= guidanceThreshold;
    return {
      currentBand: currentBand,
      nextBand: nextBand,
      turnsToNext: turnsToNext,
      ebitdaDeclinePctToNext: ebitdaDeclinePctToNext,
      guidanceLine: atOrAboveThreshold ? guidanceLine : null,
      turnsToGuidanceLine: atOrAboveThreshold ? (guidanceLine - value) : null,
      ebitdaDeclinePctToGuidanceLine: (atOrAboveThreshold && guidanceLine > 0)
        ? (guidanceLine - value) / guidanceLine : null,
    };
  }

  /** Compound annual growth rate across an annual series. */
  function cagr(periods, pick, years) {
    if (!periods || periods.length < 2) return null;
    var end = periods[periods.length - 1];
    var startIndex = Math.max(0, periods.length - 1 - years);
    var start = periods[startIndex];
    var n = periods.length - 1 - startIndex;
    var a = pick(start), b = pick(end);
    if (!isNum(a) || !isNum(b) || a <= 0 || b <= 0 || n <= 0) return null;
    return Math.pow(b / a, 1 / n) - 1;
  }

  return {
    FRAMEWORK_VERSION: FRAMEWORK_VERSION,
    isNum: isNum, div: div, avg: avg, add: add,
    financialLiabilities: financialLiabilities,
    financialAssets: financialAssets,
    netDebt: netDebt,
    netOperatingAssets: netOperatingAssets,
    bookEquity: bookEquity,
    ebit: ebit, ebitda: ebitda, nopat: nopat,
    effectiveTaxRate: effectiveTaxRate,
    afterTaxInterest: afterTaxInterest,
    freeCashFlow: freeCashFlow,
    freeCashFlowToFirm: freeCashFlowToFirm,
    lifeCycleStage: lifeCycleStage,
    computePeriod: computePeriod,
    computeRatios: computeRatios,
    earningsQuality: earningsQuality,
    spreadStability: spreadStability,
    altmanZ: altmanZ,
    residualIncome: residualIncome,
    commonEquity: commonEquity,
    totalNetIncome: totalNetIncome,
    growth: growth,
    cagr: cagr,
    fixedChargeCoverage: fixedChargeCoverage,
    ffoToDebt: ffoToDebt,
    bandDistance: bandDistance,
    SP_FINANCIAL_RISK_BANDS: SP_FINANCIAL_RISK_BANDS,
  };
});
