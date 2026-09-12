/**
 * credit.js — the single definition of every BDC and underwriting figure.
 *
 * A business development company is a lender, so the ratios that describe
 * it are not the operating-company ratios in ratios.js: the balance sheet
 * is a loan book marked to fair value, the income statement is interest
 * less the cost of funding it, and the hardest limit the company has is
 * the statutory asset-coverage test of the 1940 Act. Every formula the
 * credit page, the weekly BDC refresh and the composite use lives here, so
 * a number on a tile and the number in composite.json can never be two
 * different arithmetics.
 *
 * Three consumers load this exact file, as they load metrics.js:
 *   browser        <script src="lib/credit.js">   -> window.RTCredit
 *   concept map    require() via createRequire    -> scripts/lib/bdc-concepts.mjs
 *                  (the lien map, so the holdings build classifies a
 *                  label the way the page does; the composite build of
 *                  a later PR loads the formulas the same way)
 *   tests          require()                      -> scripts/test-credit-ratios.mjs
 *
 * CREDIT_VERSION is stamped into composite.json and bumped whenever a
 * formula here changes, so a published file can be told apart from one
 * computed under an older definition.
 *
 * Conventions, the same as ratios.js: a figure that cannot be computed is
 * null, never zero (a zero is a measurement, an absence is not); rates,
 * yields, shares and returns are FRACTIONS (0.092, not 9.2); dollar
 * inputs are in whatever unit the caller keeps, since every formula is a
 * ratio of like units; quarterly flows annualise ×4 against average
 * balances, the ratios.js convention for historical returns.
 *
 * What is deliberately NOT here (blueprint §11, must-not-build): a
 * borrower's leverage, interest coverage or loan-to-value, an internal
 * risk-rating mix, core or adjusted NII, and yields on new investments or
 * exits. Where a BDC states them they pass through disclosedOnly() with
 * the sentence as provenance; nothing computes them.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RTCredit = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CREDIT_VERSION = "1.1.0";

  /* The 1940 Act §61(a)(2) floor for a BDC that made the 2018 election;
     200% for one that never did (read its 10-K). Coverage is a ratio
     (1.78), the unit of the XBRL tag; a filing's "178.0%" is the same
     number in percent. */
  var STATUTORY_COVERAGE = 1.5;
  var STATUTORY_COVERAGE_UNELECTED = 2.0;

  /* ---------- primitives (as metrics.js) ---------- */

  function isNum(v) {
    return v !== null && v !== undefined && typeof v === "number" && !isNaN(v);
  }
  /* Division that refuses to invent a number: a null input or a zero
     denominator yields null, never Infinity or NaN. */
  function div(numerator, denominator) {
    if (!isNum(numerator) || !isNum(denominator) || denominator === 0) return null;
    var r = numerator / denominator;
    return isFinite(r) ? r : null;
  }
  function sub(a, b) { return isNum(a) && isNum(b) ? a - b : null; }
  function sumPresent(values) {
    var any = false, total = 0;
    for (var i = 0; i < values.length; i++) {
      if (isNum(values[i])) { any = true; total += values[i]; }
    }
    return any ? total : null;
  }
  /* Average balance for a flow measured across a period; with no prior
     balance the closing one stands in, as ratios.js does. */
  function avg(current, prior) {
    if (!isNum(current)) return null;
    if (!isNum(prior)) return current;
    return (current + prior) / 2;
  }
  /* A coverage ratio arrives as 1.78 from the XBRL tag and as 178.0 from
     a filing sentence. No BDC covers its debt ten times over, so anything
     above 10 is a percent. */
  function asRatio(coverage) {
    if (!isNum(coverage)) return null;
    return coverage > 10 ? coverage / 100 : coverage;
  }

  /* ---------- scorecard: book, price and leverage (§4.2) ---------- */

  /* Portfolio mark: fair value ÷ amortized cost, the tagged totals.
     ARCC 0.989 and MAIN 1.155 at Jun 30 2026. */
  function mark(fv, cost) { return div(fv, cost); }

  /* Price / NAV: the market close ÷ NetAssetValuePerShare from the filing,
     never the market feed's price-to-book, which is a different number.
     Under 1.0× a BDC cannot issue equity without a shareholder vote
     (§63(2)), so growth stops and buybacks start. */
  function priceToNav(price, navPerShare) { return div(price, navPerShare); }

  /* Statutory cushion: coverage ÷ 150% − 1, how far above the floor the
     balance sheet sits (BXSL 178% → 18.7%). Under 15% is the flag. */
  function assetCoverageCushion(coverage, statutory) {
    var c = asRatio(coverage), s = asRatio(isNum(statutory) ? statutory : STATUTORY_COVERAGE);
    var r = div(c, s);
    return r === null ? null : r - 1;
  }
  /* The markdown on the portfolio that breaks the ratio: 1 − 150 ÷
     coverage (15.7% at 178%; 11.8% at 170%; 6.3% at 160%). Negative means
     the ratio is already below the floor; the caller says so. */
  function breakingMarkdown(coverage, statutory) {
    var c = asRatio(coverage), s = asRatio(isNum(statutory) ? statutory : STATUTORY_COVERAGE);
    var r = div(s, c);
    return r === null ? null : 1 - r;
  }

  /* Debt ÷ net assets, and net of cash. Debt is the resolved carrying
     amount from the 4.2 tag chain, never a single facility. */
  function debtToEquity(debt, netAssets) { return div(debt, netAssets); }
  function netDebtToEquity(debt, cash, netAssets) {
    return div(sub(debt, cash), netAssets);
  }

  /* ---------- scorecard: earnings and distributions ---------- */

  /* NII return on NAV: 4 × quarterly after-tax NII ÷ average net assets.
     Never the tagged InvestmentCompanyInvestmentIncomeLossRatio, which
     BXSL annualises and MAIN does not. periodsPerYear is 4 for a quarter
     and 2 for a half-year flow. */
  function niiReturnOnNav(quarterlyNii, avgNetAssets, periodsPerYear) {
    var k = isNum(periodsPerYear) ? periodsPerYear : 4;
    var r = div(quarterlyNii, avgNetAssets);
    return r === null ? null : r * k;
  }

  /* Dividend coverage is earned, not declared: after-tax NII per share
     against the regular dividend, and against everything paid. A
     supplemental or special not disclosed counts as none; the note split
     is what decides "regular", never the size of the payment. MAIN Q2 2026:
     0.97 vs 0.78 + 0.30 → 1.24× regular, 0.90× total. */
  function dividendCoverage(niiPerShare, regular, supplemental, special) {
    if (!isNum(niiPerShare) || !isNum(regular)) return { regular: null, total: null };
    var total = regular + (isNum(supplemental) ? supplemental : 0) + (isNum(special) ? special : 0);
    return { regular: div(niiPerShare, regular), total: div(niiPerShare, total) };
  }

  /* Total return on NAV, the fallback when InvestmentCompanyTotalReturn is
     not tagged: (NAV end − NAV start + distributions) ÷ NAV start over the
     same span. Filers compute theirs with distributions reinvested at
     NAV, so this runs a little under a disclosed figure; label it. */
  function totalReturnNav(navEnd, navStart, distributions) {
    if (!isNum(navEnd) || !isNum(navStart) || !isNum(distributions)) return null;
    return div(navEnd - navStart + distributions, navStart);
  }

  /* Operating expense ratio: 4 × (total expenses − interest expense) ÷
     average net assets, the one cost measure comparable across internally
     and externally managed BDCs; fees are read against the peer median of
     this, never against 2/20. */
  function operatingExpenseRatio(totalExpenses, interestExpense, avgNetAssets, periodsPerYear) {
    var k = isNum(periodsPerYear) ? periodsPerYear : 4;
    var r = div(sub(totalExpenses, interestExpense), avgNetAssets);
    return r === null ? null : r * k;
  }

  /* Cost of debt: annualised interest expense ÷ average debt, the fallback
     when DebtWeightedAverageInterestRate is not tagged. Runs 0.1–0.3
     points over a filer's all-in figure because the average of two
     quarter-ends is not the daily average balance. */
  function costOfDebt(interestExpense, avgDebt, periodsPerYear) {
    var k = isNum(periodsPerYear) ? periodsPerYear : 4;
    var r = div(interestExpense, avgDebt);
    return r === null ? null : r * k;
  }

  /* Net interest margin: weighted-average yield at cost − cost of debt,
     in points of yield. */
  function netInterestMargin(yieldAtCost, costOfDebtValue) {
    return sub(yieldAtCost, costOfDebtValue);
  }

  /* ---------- scorecard: stress (§3.3) ---------- */

  /* PIK share of interest: PIK interest ÷ (cash interest + PIK interest),
     every affiliation class summed, the ratio Cliffwater and most filers
     quote. The denominator INCLUDES the PIK — pass total interest income,
     not cash interest alone. BXSL Q2 2026: 21.1 ÷ 319.9 = 6.6%. */
  function pikShare(pikInterestIncome, totalInterestIncome) {
    return div(pikInterestIncome, totalInterestIncome);
  }
  /* PIK share of total investment income: (PIK interest + PIK dividends)
     ÷ GrossInvestmentIncomeOperating. ARCC Q2 2026: 121 ÷ 768 = 15.8%. */
  function pikShareOfTotal(pikIncome, totalInvestmentIncome) {
    return div(pikIncome, totalInvestmentIncome);
  }

  /* Non-accrual rate at cost and at fair value: the basis every filer,
     LCD and the rating agencies use. Read the two together — a wide gap
     means the loans were marked before they stopped paying. */
  function nonAccrualRate(nonAccrualCost, totalCost) {
    return div(nonAccrualCost, totalCost);
  }
  function nonAccrualRateFv(nonAccrualFv, totalFv) {
    return div(nonAccrualFv, totalFv);
  }
  /* The numerators, from holdings carrying the schedule's non-accrual
     footnote: cost and fair value summed, loans and distinct issuers
     counted (BXSL Jun 30 2026: eight loans, six issuers). An issuer is
     the portfolio company where the holding names one — BXSL's CFCo and
     Daylight Beta rows are both Benefytt — else the identifier text. */
  function issuerKey(h) {
    return String(h.company || h.issuer || "");
  }
  function nonAccrualTotals(holdings) {
    var cost = null, fv = null, loans = 0, issuers = {};
    for (var i = 0; i < (holdings || []).length; i++) {
      var h = holdings[i];
      if (!h || h.nonAccrual !== true) continue;
      loans++;
      if (isNum(h.cost)) cost = (cost === null ? 0 : cost) + h.cost;
      if (isNum(h.fv)) fv = (fv === null ? 0 : fv) + h.fv;
      if (issuerKey(h)) issuers[issuerKey(h)] = true;
    }
    return { cost: cost, fv: fv, loans: loans, issuers: Object.keys(issuers).length };
  }

  /* Liquidity cover: (cash + undrawn revolver) ÷ unfunded commitments.
     BXSL Jun 30 2026: (267 + 2,628) ÷ 1,416 = 2.0×. */
  function liquidityCover(cash, revolverCapacity, unfunded) {
    return div(sumPresent([cash, revolverCapacity]), unfunded);
  }

  /* ---------- holdings (§4.2, schedule of investments) ----------
   *
   * One holding shape, the compact form the refresh writes:
   *   { issuer, company, rawLabel, lien, isDebt, thirdParty, accruing,
   *     nonAccrual, principal, cost, fv, rate, spread, maturity, unfunded }
   * rate and spread are fractions (0.0897, 0.0525); maturity is a date
   * string or a year. A holding is debt only when isDebt is true; it is
   * third-party unless thirdParty is false; it accrues unless accruing is
   * false. Every portfolio figure below is computed on third-party debt
   * only — vehicles (JV, SLP, CLO equity, asset managers) lift a yield
   * with leverage inside the vehicle, not loan pricing.
   */

  function isThirdPartyDebt(h) {
    return !!h && h.isDebt === true && h.thirdParty !== false;
  }

  /* Weighted-average yield on debt investments, before discount
     accretion: Σ(principal × all-in rate) over accruing third-party debt ÷
     Σ cost (basis "cost") or Σ fair value (basis "fv") of the same
     holdings. OID accretion is not tagged per loan, so expect 0–0.3 points
     under the disclosed figure (BXSL 9.2% at cost, 9.4% at FV). */
  function weightedAverageYield(holdings, basis) {
    var key = basis === "fv" ? "fv" : "cost";
    var num = 0, den = 0, any = false;
    for (var i = 0; i < (holdings || []).length; i++) {
      var h = holdings[i];
      if (!isThirdPartyDebt(h) || h.accruing === false) continue;
      if (!isNum(h.principal) || !isNum(h.rate) || !isNum(h[key])) continue;
      num += h.principal * h.rate;
      den += h[key];
      any = true;
    }
    return any ? div(num, den) : null;
  }

  /* Spread over base, cost-weighted: Σ(cost × spread) ÷ Σ cost over
     floating third-party debt, as a fraction (0.0525 = 525 bps). */
  function spreadCostWeighted(holdings) {
    var num = 0, den = 0, any = false;
    for (var i = 0; i < (holdings || []).length; i++) {
      var h = holdings[i];
      if (!isThirdPartyDebt(h) || !isNum(h.spread) || !isNum(h.cost)) continue;
      num += h.cost * h.spread;
      den += h.cost;
      any = true;
    }
    return any ? div(num, den) : null;
  }

  /* Floating-rate share: cost of debt holdings carrying a spread fact ÷
     cost of debt holdings. Computed from the presence of a spread, not
     the data set's rate-type column, which only one filer fills. */
  function floatingShare(holdings) {
    var floating = 0, total = 0, any = false;
    for (var i = 0; i < (holdings || []).length; i++) {
      var h = holdings[i];
      if (!isThirdPartyDebt(h) || !isNum(h.cost)) continue;
      total += h.cost;
      if (isNum(h.spread) || h.floating === true) floating += h.cost;
      any = true;
    }
    return any ? div(floating, total) : null;
  }

  /* Top-10 issuer concentration: Σ fair value of the ten largest
     third-party issuers (portfolio companies) ÷ portfolio fair value, the
     tagged total. */
  function top10Concentration(holdings, portfolioFv) {
    if (!isNum(portfolioFv)) return null;
    var byIssuer = {};
    for (var i = 0; i < (holdings || []).length; i++) {
      var h = holdings[i];
      if (!h || h.thirdParty === false || !issuerKey(h) || !isNum(h.fv)) continue;
      var k = issuerKey(h);
      byIssuer[k] = (byIssuer[k] || 0) + h.fv;
    }
    var totals = Object.keys(byIssuer).map(function (k) { return byIssuer[k]; });
    if (!totals.length) return null;
    totals.sort(function (a, b) { return b - a; });
    var top = 0;
    for (var j = 0; j < Math.min(10, totals.length); j++) top += totals[j];
    return div(top, portfolioFv);
  }

  /* ---------- lien classes (§4.2, the lien map) ----------
   *
   * The same map is applied to the data set's Investment Type axis and to
   * the HTML section headers. First lien = {first lien senior secured,
   * first lien, senior secured, one stop, unitranche}; last-out and
   * unitranche are the sub-class "first lien incl. unitranche/last-out",
   * never second lien; then second lien; unsecured/subordinated;
   * structured (CLO, JV certificates) → vehicles; equity. A label the map
   * does not know returns null and keeps its raw text on the holding —
   * MAIN's "Secured Debt" is first lien only through its filer override.
   */
  var LIEN = {
    FIRST: "first lien",
    FIRST_UNITRANCHE: "first lien incl. unitranche/last-out",
    SECOND: "second lien",
    UNSECURED: "unsecured",
    VEHICLES: "vehicles",
    EQUITY: "equity",
  };
  var LIEN_CLASSES = [LIEN.FIRST, LIEN.FIRST_UNITRANCHE, LIEN.SECOND, LIEN.UNSECURED, LIEN.VEHICLES, LIEN.EQUITY];
  /* Per-filer labels that only mean one thing for that filer. Seed from
     the filings read so far; terms.json carries the sentence. */
  var FILER_LIEN_OVERRIDES = {
    MAIN: { "secured debt": LIEN.FIRST },
    /* MSIF is managed by MAIN's adviser and prints MAIN's vocabulary:
       its 10-Q for 2026-06-30 (0001535778-26-000085) heads its debt
       "Secured Debt" with tranche numbers, first-lien by the same
       reading as MAIN's */
    MSIF: { "secured debt": LIEN.FIRST },
  };

  function normalizeLabel(raw) {
    return String(raw === null || raw === undefined ? "" : raw)
      .toLowerCase()
      .replace(/[–—_/,.()]+/g, " ")
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function lienClass(rawLabel, filerOverrides) {
    var s = normalizeLabel(rawLabel)
      /* a tranche number a filer hangs on the label ("Secured Debt 2",
         MSIF and MAIN) names the same class as the label alone */
      .replace(/\s+\d{1,3}$/, "");
    if (!s) return null;
    if (filerOverrides) {
      var keys = Object.keys(filerOverrides);
      for (var i = 0; i < keys.length; i++) {
        if (normalizeLabel(keys[i]) === s) return filerOverrides[keys[i]];
      }
    }
    if (/\b(clo|collateralized|structured|cmbs|certificates?|joint venture|jv|senior loan program|slp|vehicles?|funds?)\b/.test(s)) return LIEN.VEHICLES;
    if (/\b(second|2nd) lien\b/.test(s)) return LIEN.SECOND;
    if (/\blast out\b|\bunitranche\b|\bone stop\b/.test(s)) return LIEN.FIRST_UNITRANCHE;
    if (/\b(first|1st) lien\b|\bsenior secured\b/.test(s)) return LIEN.FIRST;
    if (/\bunsecured\b|\bsubordinated\b|\bmezzanine\b|\bjunior\b/.test(s)) return LIEN.UNSECURED;
    if (/\b(equity|preferred|common|warrants?|units?|shares?|stock|interests?|membership)\b/.test(s)) return LIEN.EQUITY;
    return null;
  }
  /* Both first-lien classes count toward the first-lien share. */
  function isFirstLien(cls) {
    return cls === LIEN.FIRST || cls === LIEN.FIRST_UNITRANCHE;
  }

  /* ---------- maturity wall (§4.2, LCD's buckets) ---------- */

  /* The buckets of the LCD monitor's BDC maturity wall, so the composite
     and a BDC draw against the industry outline on the same axis. */
  var MATURITY_BUCKETS = [
    { label: "2026", from: 2026, to: 2026 },
    { label: "2027", from: 2027, to: 2027 },
    { label: "2028", from: 2028, to: 2028 },
    { label: "2029", from: 2029, to: 2029 },
    { label: "2030", from: 2030, to: 2030 },
    { label: "2031-2033", from: 2031, to: 2033 },
    { label: "later", from: 2034, to: Infinity },
  ];
  function maturityYear(maturity) {
    if (isNum(maturity)) return maturity >= 1900 ? Math.floor(maturity) : null;
    var m = /(\d{4})/.exec(String(maturity || ""));
    return m ? Number(m[1]) : null;
  }
  /* Σ cost of third-party debt by maturity year, excluding equity, CLO,
     CMBS and vehicle holdings as the deck footnote does; a revolver or
     delayed-draw loan sits in its own maturity year and its unfunded
     balance is reported beside the wall, not inside it. A loan already
     past the first bucket's year lands in the first bucket. */
  function maturityBuckets(holdings) {
    var buckets = MATURITY_BUCKETS.map(function (b) { return { label: b.label, cost: 0, share: null }; });
    var total = 0, unfunded = null, noMaturity = 0, any = false;
    for (var i = 0; i < (holdings || []).length; i++) {
      var h = holdings[i];
      if (!isThirdPartyDebt(h) || !isNum(h.cost)) continue;
      if (h.lien === LIEN.EQUITY || h.lien === LIEN.VEHICLES) continue;
      if (/\b(clo|cmbs)\b/.test(normalizeLabel(h.rawLabel))) continue;
      var y = maturityYear(h.maturity);
      /* an undated row with a negative cost (a receivable a filer nets
         inside its schedule) would drag the "n/a" bucket below zero; it
         is left out here and the caller reports it as excluded */
      if (y === null && h.cost < 0) continue;
      if (y === null) { noMaturity += h.cost; continue; }
      any = true;
      total += h.cost;
      if (isNum(h.unfunded)) unfunded = (unfunded === null ? 0 : unfunded) + h.unfunded;
      var placed = false;
      for (var j = 0; j < MATURITY_BUCKETS.length; j++) {
        var b = MATURITY_BUCKETS[j];
        if (y >= b.from && y <= b.to) { buckets[j].cost += h.cost; placed = true; break; }
      }
      if (!placed) buckets[0].cost += h.cost;
    }
    if (!any) return null;
    for (var k = 0; k < buckets.length; k++) buckets[k].share = div(buckets[k].cost, total);
    return { buckets: buckets, total: total, unfunded: unfunded, noMaturity: noMaturity };
  }

  /* ---------- disclosed-only fields (§4.2, §11) ---------- */

  /* Figures a BDC states about its borrowers or its own adjusted earnings
     that the site never computes: they pass through with the sentence as
     provenance or stay empty. A key outside this list is dropped, so no
     computed value can ride in under a disclosed name. */
  var DISCLOSED_ONLY = [
    "ltv",
    "borrowerNetLeverage",
    "borrowerInterestCoverage",
    "riskRatingMix",
    "coreNiiPerShare",
    "yieldOnNewInvestments",
    "yieldOnExits",
  ];
  function disclosedOnly(stated, provenance) {
    var out = { source: "disclosed", provenance: provenance || null };
    for (var i = 0; i < DISCLOSED_ONLY.length; i++) {
      var k = DISCLOSED_ONLY[i];
      var v = stated && Object.prototype.hasOwnProperty.call(stated, k) ? stated[k] : null;
      out[k] = v === undefined ? null : v;
    }
    return out;
  }

  return {
    CREDIT_VERSION: CREDIT_VERSION,
    STATUTORY_COVERAGE: STATUTORY_COVERAGE,
    STATUTORY_COVERAGE_UNELECTED: STATUTORY_COVERAGE_UNELECTED,
    LIEN: LIEN, LIEN_CLASSES: LIEN_CLASSES, FILER_LIEN_OVERRIDES: FILER_LIEN_OVERRIDES,
    MATURITY_BUCKETS: MATURITY_BUCKETS, DISCLOSED_ONLY: DISCLOSED_ONLY,
    isNum: isNum, div: div, sub: sub, avg: avg, sumPresent: sumPresent, asRatio: asRatio,
    normalizeLabel: normalizeLabel,
    mark: mark,
    priceToNav: priceToNav,
    assetCoverageCushion: assetCoverageCushion,
    breakingMarkdown: breakingMarkdown,
    debtToEquity: debtToEquity,
    netDebtToEquity: netDebtToEquity,
    niiReturnOnNav: niiReturnOnNav,
    dividendCoverage: dividendCoverage,
    totalReturnNav: totalReturnNav,
    operatingExpenseRatio: operatingExpenseRatio,
    costOfDebt: costOfDebt,
    netInterestMargin: netInterestMargin,
    pikShare: pikShare,
    pikShareOfTotal: pikShareOfTotal,
    nonAccrualRate: nonAccrualRate,
    nonAccrualRateFv: nonAccrualRateFv,
    nonAccrualTotals: nonAccrualTotals,
    liquidityCover: liquidityCover,
    weightedAverageYield: weightedAverageYield,
    spreadCostWeighted: spreadCostWeighted,
    floatingShare: floatingShare,
    top10Concentration: top10Concentration,
    lienClass: lienClass,
    isFirstLien: isFirstLien,
    maturityBuckets: maturityBuckets,
    disclosedOnly: disclosedOnly,
  };
});
