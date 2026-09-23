/**
 * lenders-scorecard.js — one row per listed BDC, sortable, for the
 * Lenders view (blueprint §4.2, version-2 detail §4.2, §4.6).
 *
 * UMD like frontend/lib/credit.js: the browser gets
 * window.RTLendersScorecard; require() of this exact file in Node gets
 * the same object, so scripts/test-lenders-scorecard.mjs can build rows
 * and exercise render() without a DOM. RTCredit supplies every formula
 * (mark, priceToNav, dividendCoverage, assetCoverageCushion,
 * debtToEquity, netDebtToEquity, pikShareOfTotal) — nothing here
 * duplicates one of its calculations, per house rule.
 *
 * Coverage (decision 12.1): every one of the 53 universe rows gets a
 * scorecard row, not only the 32 with a parsed schedule of investments.
 * Portfolio-level figures (NAV, price/NAV, mark, leverage, dividend
 * coverage, asset coverage) come from EDGAR companyfacts/frames through
 * the company file and are available for most of the 53. Holdings-only
 * figures (non-accrual rate, PIK share of interest, floating share,
 * weighted-average yield) need the parsed schedule and are null, with a
 * "not yet parsed" reason, for a filer coverage.holdings.tickers_refused
 * names.
 *
 * Every numeric field a source cannot answer is null — never 0, never
 * NaN. `sources` records which tag ladder step answered an ambiguous
 * field (debt, the two NII lines, distributions per share, asset
 * coverage), so a reader can tell a tagged figure from a prose or
 * formula fallback.
 *
 * Three severity flags fire as a stripe (blueprint §4.6 / §9); a fourth
 * reading — regular dividend coverage under 1.0x for two consecutive
 * quarters — is a blueprint rule this data set cannot confirm (round-2
 * fixer: it carries only one, already-combined distributions-per-share
 * figure, never a regular/supplemental split) and so is surfaced as a
 * note on the dividend-coverage cell instead, per the blueprint's own
 * instruction that a special dividend with total coverage under 1.0× is
 * a note, not a flag:
 *   (b) asset-coverage cushion under 15% — RTCredit.assetCoverageCushion
 *       against the statutory line terms.json states for the filer
 *       (150 or 200), defaulting to 150 with the limitation noted below.
 *   (c) non-accruals over 3% of investments at cost — holdings-only.
 *   (d) price/NAV below the universe's own 25th percentile, computed
 *       here from every row's priceToNav (composite.json's
 *       priceToNavP25 is not part of this module's input contract — the
 *       cross-check against it belongs to the caller/build script, and
 *       the current composite.json ships that field null, so there is
 *       nothing to compare against yet; see the PR notes).
 *
 * Known data-contract limitations, documented rather than papered over:
 *   - the data carries only a single, already-differenced distributions-
 *     per-share figure (InvestmentCompanyDistributionToShareholdersPerShare,
 *     falling back to CommonStockDividendsPerShareDeclared); nothing
 *     splits "regular" from "supplemental" or "special". Per blueprint
 *     4.2's own instruction ("when the note does not split, label
 *     total"), dividendCoverage.regular and .total are the same number
 *     here until a split is available; flag (a) reads that one number.
 *   - the statutory asset-coverage line is 150% for a filer whose 10-K
 *     confirms the 2018 election was made (terms.json states so for
 *     most of the universe) and defaults to 150% otherwise — there is
 *     no 2018-election field for a filer terms.json has not parsed, so
 *     a filer that never made the election would show a cushion against
 *     the wrong floor. This is the same limitation blueprint §4.6 (3)
 *     and the task both name; it is not silently fixed here.
 *   - PIK "share of interest" (interest-statement definition: PIK
 *     interest ÷ (cash + PIK interest)) needs a total-interest-income
 *     concept the data set does not carry (composite.json's own n for
 *     it is 0 across all 50 filers). What is available instead is the
 *     holdings-weighted "PIK share of interest, contractual"
 *     (holdings summary.wa.pikContractual) — a different, cost-weighted
 *     measure computed from the schedule of investments, holdings-only,
 *     used here and labelled accordingly.
 *   - `opexRatio` is not an alias of `expenseRatio`: `expenseRatio` is
 *     RTCredit.operatingExpenseRatio() (4 × (total expenses − interest
 *     expense) ÷ average net assets, the one measure comparable across
 *     internally and externally managed BDCs, blueprint 4.2); `opexRatio`
 *     is the filer's own tagged ratio (InvestmentCompanyExpenseRatio
 *     IncludingIncentiveFee, or …BeforeIncentiveAllocation) carried as a
 *     cross-check — the two are expected to differ, sometimes because
 *     the tagged one includes the incentive fee and the computed one
 *     never does.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./credit.js"));
  else root.RTLendersScorecard = factory(root.RTCredit);
})(typeof self !== "undefined" ? self : this, function (RTCredit) {
  "use strict";

  var GLOBAL = typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : {});

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function withCommas(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  /* ---------- flag keys (exported so a caller/test never re-types them) ---------- */
  var FLAGS = {
    ASSET_COVERAGE_CUSHION: "assetCoverageCushionBelow15",
    NON_ACCRUAL: "nonAccrualAbove3pctCost",
    PRICE_TO_NAV_P25: "priceToNavBelowUniverseP25",
  };
  /* Plain-English sentences for the flag dot's tooltip — the reader's
     only text for the stripe, so the raw camelCase key must never reach
     it (round-2 fixer finding: tooltips read literally
     "assetCoverageCushionBelow15, nonAccrualAbove3pctCost"). */
  var FLAG_LABELS = {
    assetCoverageCushionBelow15: "asset-coverage cushion under 15% over the statutory line",
    nonAccrualAbove3pctCost: "non-accruals over 3% of investments at cost",
    priceToNavBelowUniverseP25: "price/NAV below the 25th percentile of this universe",
  };
  function flagLabel(key) { return FLAG_LABELS[key] || key; }

  /* ---------- percentile (linear interpolation between closest ranks, the PERCENTILE.INC method) ---------- */
  function percentile(values, p) {
    var arr = (values || []).filter(isNum).slice().sort(function (a, b) { return a - b; });
    if (!arr.length) return null;
    if (arr.length === 1) return arr[0];
    var idx = p * (arr.length - 1);
    var lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return arr[lo];
    return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
  }

  /* ---------- reading a company file's resolved concepts ---------- */
  function orderedPeriods(series) {
    if (!series || !Array.isArray(series.periods)) return [];
    return series.periods.slice().sort(function (a, b) {
      return a.end < b.end ? -1 : a.end > b.end ? 1 : 0;
    });
  }
  function periodVal(period, key) {
    var vv = period && period.values && period.values[key];
    return vv && isNum(vv.v) ? vv.v : null;
  }
  /* true only when two period-end dates are one fiscal quarter apart (a
     BDC's quarters run roughly 80-100 days regardless of fiscal
     year-end): the "two consecutive quarters" flag must never fire on
     two quarters that happen to both carry a value but are separated by
     a real gap in the filing history. */
  function isAdjacentQuarter(endA, endB) {
    var a = Date.parse(String(endA || "").slice(0, 10) + "T00:00:00Z");
    var b = Date.parse(String(endB || "").slice(0, 10) + "T00:00:00Z");
    if (!isFinite(a) || !isFinite(b)) return false;
    var days = Math.abs(b - a) / 86400000;
    return days >= 75 && days <= 100;
  }
  /* the last two quarters carrying BOTH niiPerShare and distributionsPerShare
     (never forced past a gap): regular dividend coverage per quarter, for
     the two-consecutive-quarter flag */
  function coverageSeries(series) {
    var out = [];
    orderedPeriods(series).forEach(function (p) {
      var nii = periodVal(p, "niiPerShare"), dist = periodVal(p, "distributionsPerShare");
      if (nii === null || dist === null) return;
      out.push({ end: p.end, coverage: RTCredit.div(nii, dist) });
    });
    return out;
  }

  /* ---------- one row ---------- */
  function buildRow(u, input) {
    var ticker = u.ticker;
    var company = (input.companies && input.companies[ticker]) || null;
    var series = (company && company.series) || null;
    var latest = (series && series.latest) || {};
    var disclosed = (company && company.disclosed) || null;
    var covT = (input.coverage && input.coverage.byTicker && input.coverage.byTicker[ticker]) || {};
    var holdings = (input.holdings && input.holdings[ticker]) || null;
    var summary = (holdings && holdings.summary) || null;
    var terms = (input.terms && input.terms.filers && input.terms.filers[ticker]) || null;
    var priceRow = (input.prices && input.prices[ticker]) || null;
    var refusal = null;
    if (input.coverage && input.coverage.holdings && Array.isArray(input.coverage.holdings.tickers_refused)) {
      for (var i = 0; i < input.coverage.holdings.tickers_refused.length; i++) {
        if (input.coverage.holdings.tickers_refused[i] && input.coverage.holdings.tickers_refused[i].ticker === ticker) {
          refusal = input.coverage.holdings.tickers_refused[i]; break;
        }
      }
    }

    function v(key) { var e = latest[key]; return e && isNum(e.v) ? e.v : null; }
    function tagOf(key) { var e = covT[key]; return e && e.tag ? e.tag : null; }
    function entryOf(key) { var e = latest[key]; return e && isNum(e.v) ? e : null; }
    /* every ratio below must be built from two (or three) inputs the SAME
       filing period answered: `latest` resolves each concept on its own,
       so it can otherwise pair this quarter's fair value with a stale
       cost from a different quarter — a wrong number, not a null one.
       Returns null when the inputs agree (or there is nothing yet to
       compare) and a plain-English mismatch string, for the cell's
       title, when they do not. */
    function periodMismatch(keys) {
      var seen = [];
      for (var i = 0; i < keys.length; i++) {
        var e = entryOf(keys[i]);
        if (e) seen.push(keys[i] + " as of " + (e.end || "an unknown date"));
      }
      if (seen.length < 2) return null;
      var ends = keys.map(function (k) { var e = entryOf(k); return e ? (e.end || null) : null; }).filter(function (x) { return x !== null; });
      var mismatched = ends.some(function (e) { return e !== ends[0]; });
      return mismatched ? "not comparable: " + seen.join(", ") + " are different filing periods" : null;
    }

    var portfolioFv = v("portfolioFairValue");
    var portfolioCost = v("portfolioCost");
    var nav = v("navPerShare");
    var price = priceRow && isNum(priceRow.price) ? priceRow.price : null;
    var dividendYieldTTM = priceRow && isNum(priceRow.dividendYieldTTM) ? priceRow.dividendYieldTTM : null;
    /* /api/comps (the only source for price and dividend yield) 503s
       "not configured" on a deployment with no FINNHUB_API_KEY — a
       deployment gap, never a company-level disclosure gap, and the two
       must read differently: "not disclosed" says the filer did not say;
       this says the market-data feed was never asked (round-2 fixer
       finding). Only applies to a non-OTC row, which already carries its
       own, different reason for having no live price. */
    var marketFeedUnconfigured = !!(input.compsUnconfigured && !u.otc && !isNum(price));
    var niiAfterTax = v("niiAfterTax");
    var niiPerShare = v("niiPerShare");
    var distributionsPerShare = v("distributionsPerShare");
    var netAssets = v("netAssets");
    var debt = v("debt");
    var cash = v("cash");
    var totalExpenses = v("totalExpenses");
    var interestExpense = v("interestExpense");
    var pikInterestIncome = v("pikInterestIncome");
    var pikDividendIncome = v("pikDividendIncome");
    var pikIncomeCombined = v("pikIncomeCombined");
    var totalInvestmentIncome = v("totalInvestmentIncome");
    var managementFee = v("managementFee");
    var incentiveFeeIncome = v("incentiveFeeIncome");

    /* dividend coverage: total = the one distributions-per-share figure
       the data carries; regular is the same number (see file header) */
    var divCoverageMismatch = periodMismatch(["niiPerShare", "distributionsPerShare"]);
    var divCoverageTotal = divCoverageMismatch ? null : RTCredit.div(niiPerShare, distributionsPerShare);

    /* asset coverage: the prose/formula reading from the same filing wins
       when it exists (disclosed.assetCoverage), the tagged ratio otherwise */
    var acValue = null, acSource = null, acStatutory = 150, acDisputed = null;
    if (disclosed && disclosed.assetCoverage && isNum(disclosed.assetCoverage.v)) {
      acValue = disclosed.assetCoverage.v;
      acSource = disclosed.assetCoverage.acSource || "prose";
      if (isNum(disclosed.assetCoverage.statutory)) acStatutory = disclosed.assetCoverage.statutory;
      if (Array.isArray(disclosed.assetCoverage.flags) && disclosed.assetCoverage.flags.length > 0) {
        /* no apostrophe here: this string is rendered into a single-quoted
           HTML title attribute (naTd/td), where esc() does not escape ' */
        acDisputed = "the tag and prose readings for this filer disagree" +
          (isNum(disclosed.assetCoverage.prose) ? " (prose reads " + (disclosed.assetCoverage.prose * 100).toFixed(0) + "%)" : "") +
          "; this figure is shown but not trusted enough to fire the cushion flag.";
      }
    } else {
      var tagV = v("assetCoverage");
      if (isNum(tagV)) { acValue = tagV; acSource = "tag"; }
    }
    if (terms && terms.statutoryCoverage && isNum(terms.statutoryCoverage.value)) acStatutory = terms.statutoryCoverage.value;
    var acCushion = RTCredit.assetCoverageCushion(acValue, acStatutory);

    /* average net assets for the operating expense ratio: this quarter
       and the one before it, RTCredit.avg's "closing stands in" rule
       when there is no prior quarter */
    var ordered = orderedPeriods(series);
    var priorNetAssets = ordered.length >= 2 ? periodVal(ordered[ordered.length - 2], "netAssets") : null;
    var avgNetAssets = RTCredit.avg(netAssets, priorNetAssets);
    var expenseRatioMismatch = periodMismatch(["totalExpenses", "interestExpense"]);
    var expenseRatio = expenseRatioMismatch ? null : RTCredit.operatingExpenseRatio(totalExpenses, interestExpense, avgNetAssets);
    var opexRatioTagged = v("expenseRatio");

    var pikIncomeSum = isNum(pikIncomeCombined) ? pikIncomeCombined : RTCredit.sumPresent([pikInterestIncome, pikDividendIncome]);
    var pikMismatch = periodMismatch(isNum(pikIncomeCombined)
      ? ["pikIncomeCombined", "totalInvestmentIncome"]
      : ["pikInterestIncome", "pikDividendIncome", "totalInvestmentIncome"]);
    var pikShareOfTotal = pikMismatch ? null : RTCredit.pikShareOfTotal(pikIncomeSum, totalInvestmentIncome);
    var pikShareOfInterest = summary && summary.wa && isNum(summary.wa.pikContractual) ? summary.wa.pikContractual : null;

    var nonAccrualCost = summary && summary.nonAccrual && isNum(summary.nonAccrual.ofTotalCost) ? summary.nonAccrual.ofTotalCost : null;
    var nonAccrualFv = summary && summary.nonAccrual && isNum(summary.nonAccrual.ofTotalFv) ? summary.nonAccrual.ofTotalFv : null;
    var holdingsAvailable = !!holdings;
    var nonAccrualSource = holdingsAvailable ? "schedule" : (refusal ? "not yet parsed: " + refusal.reason : "not yet parsed");

    var floatingShare = summary && summary.wa && isNum(summary.wa.floatingShare) ? summary.wa.floatingShare : null;
    var weightedAverageYield = summary && summary.wa && isNum(summary.wa.yieldAtCost) ? summary.wa.yieldAtCost : null;

    /* stale/flagged: every metric key this row actually reads (v() calls
       above), tested against coverage.json's own per-metric tickers_stale
       AND tickers_flagged lists — never guessed from a date alone, and
       never limited to only the four identity figures: a PIK, expense or
       leverage figure built from a stale or flagged input must carry the
       same warning the identity figures do. tickers_stale (the refresh
       knows this is not the current quarter's figure) and tickers_flagged
       (the refresh itself distrusts this figure) are two distinct
       states, both surfaced, never collapsed into one. */
    var STALE_KEYS = ["navPerShare", "portfolioFairValue", "portfolioCost", "niiAfterTax", "niiPerShare",
      "distributionsPerShare", "netAssets", "debt", "cash", "assetCoverage", "expenseRatio", "totalExpenses",
      "interestExpense", "pikInterestIncome", "pikDividendIncome", "pikIncomeCombined", "totalInvestmentIncome",
      "managementFee", "incentiveFeeIncome"];
    var stale = false, staleKeys = [], flaggedKeys = [];
    if (input.coverage && input.coverage.metrics) {
      for (var s = 0; s < STALE_KEYS.length; s++) {
        var m = input.coverage.metrics[STALE_KEYS[s]];
        if (!m) continue;
        if (Array.isArray(m.tickers_stale) && m.tickers_stale.indexOf(ticker) >= 0) { stale = true; staleKeys.push(STALE_KEYS[s]); }
        if (Array.isArray(m.tickers_flagged) && m.tickers_flagged.indexOf(ticker) >= 0) { flaggedKeys.push(STALE_KEYS[s]); }
      }
    }
    var dataFlagged = flaggedKeys.length > 0;

    var flags = [];
    /* Blueprint v2 detail §4.3 L2: "regular coverage under 1.0× for two
       consecutive quarters is a flag; a special dividend with total
       coverage under 1.0× is a note, not a flag." This data set carries
       only one, already-combined distributions-per-share figure — never
       a regular/supplemental split — so dividendCoverage.total is the
       only reading available, and it can never satisfy the flag's own
       "regular coverage" condition. Firing the severity stripe from it
       anyway mislabeled a note as the blueprint's flag (round-2 fixer
       finding: MAIN's own worked example, 1.24× regular / 0.90× total,
       was flagged on the 0.90× total). This is therefore surfaced as a
       note on the coverage cell, never a stripe. */
    var covSeries = coverageSeries(series);
    var lastTwo = covSeries.slice(-2);
    var latestPeriodEnd = ordered.length ? ordered[ordered.length - 1].end : null;
    var dividendCoverageTwoQNote = lastTwo.length === 2 && isAdjacentQuarter(lastTwo[0].end, lastTwo[1].end) &&
      /* the newer of the two quarters must be the filer's own latest
         filed quarter — otherwise a stale pair (MSIF: last two quarters
         carrying both inputs end 2025-12-31/2026-03-31, one filing
         behind its 2026-06-30 latest, and coverage.json's own refresh
         already distrusts that distributions-per-share reading) reads as
         current when it is not (round-2 fixer finding). */
      lastTwo[1].end === latestPeriodEnd &&
      lastTwo.every(function (q) { return isNum(q.coverage) && q.coverage < 1; });
    if (isNum(acCushion) && acCushion < 0.15 && !acDisputed) flags.push(FLAGS.ASSET_COVERAGE_CUSHION);
    if (holdingsAvailable && isNum(nonAccrualCost) && nonAccrualCost > 0.03) flags.push(FLAGS.NON_ACCRUAL);
    /* the price/NAV-below-p25 flag is added by buildRows() once every
       row's priceToNav is known */

    var markMismatch = periodMismatch(["portfolioFairValue", "portfolioCost"]);
    var markVal = markMismatch ? null : RTCredit.mark(portfolioFv, portfolioCost);
    var deMismatch = periodMismatch(["debt", "netAssets"]);
    var debtToEquityVal = deMismatch ? null : RTCredit.debtToEquity(debt, netAssets);
    var ndeMismatch = periodMismatch(["debt", "cash", "netAssets"]);
    var netDebtToEquityVal = ndeMismatch ? null : RTCredit.netDebtToEquity(debt, cash, netAssets);

    return {
      ticker: ticker, name: u.name || null, cik: u.cik || null,
      listed: u.listed === true, otc: u.otc === true,
      fyEndMonth: isNum(u.fyEndMonth) ? u.fyEndMonth : null,
      listedSince: u.listedSince || null,
      nav: nav, price: price,
      priceToNav: RTCredit.priceToNav(price, nav),
      dividendYieldTTM: dividendYieldTTM,
      marketFeedUnconfigured: marketFeedUnconfigured,
      niiAfterTax: niiAfterTax, niiPerShare: niiPerShare,
      dividendCoverage: { regular: divCoverageTotal, total: divCoverageTotal, twoQuarterNote: dividendCoverageTwoQNote },
      mark: markVal,
      assetCoverage: { value: acValue, source: acSource, cushion: acCushion, statutory: acStatutory, disputed: acDisputed },
      debtToEquity: debtToEquityVal,
      netDebtToEquity: netDebtToEquityVal,
      nonAccrual: { cost: nonAccrualCost, fv: nonAccrualFv, source: nonAccrualSource },
      pik: { shareOfTotal: pikShareOfTotal, shareOfInterest: pikShareOfInterest },
      floatingShare: floatingShare,
      weightedAverageYield: weightedAverageYield,
      expenseRatio: expenseRatio,
      opexRatio: opexRatioTagged,
      managementFee: managementFee,
      incentiveFeeIncome: incentiveFeeIncome,
      fees: terms && terms.fees ? terms.fees : null,
      portfolioFv: portfolioFv, portfolioCost: portfolioCost,
      holdingsAvailable: holdingsAvailable,
      flags: flags,
      stale: stale,
      staleKeys: staleKeys,
      dataFlagged: dataFlagged,
      flaggedKeys: flaggedKeys,
      /* a mismatch string per cell whose inputs came from different
         filing periods — null when the row's inputs agree (finding: a
         cross-period quotient must never render as a plain number) */
      mismatches: {
        mark: markMismatch, dividendCoverage: divCoverageMismatch,
        debtToEquity: deMismatch, netDebtToEquity: ndeMismatch,
        expenseRatio: expenseRatioMismatch, pik: pikMismatch,
      },
      sources: {
        debt: tagOf("debt"), niiAfterTax: tagOf("niiAfterTax"), niiPerShare: tagOf("niiPerShare"),
        distributionsPerShare: tagOf("distributionsPerShare"), netAssets: tagOf("netAssets"),
        assetCoverage: acSource,
      },
    };
  }

  /**
   * buildRows({ universe, coverage, companies, holdings, terms, prices })
   * → [row, …], one per universe row (53), decision 12.1. `prices` may be
   * null or partial; every field it would answer is then null, never 0.
   */
  function buildRows(input) {
    input = input || {};
    var universe = input.universe || { rows: [] };
    var rows = (Array.isArray(universe.rows) ? universe.rows : []).map(function (u) { return buildRow(u, input); });
    var p25 = percentile(rows.map(function (r) { return r.priceToNav; }), 0.25);
    rows.forEach(function (r) {
      if (isNum(r.priceToNav) && isNum(p25) && r.priceToNav < p25) r.flags.push(FLAGS.PRICE_TO_NAV_P25);
    });
    return rows;
  }

  /* ================= catalog entries, registered once at module load ================= */
  var ENTRIES = [
    { key: "lendersNav", label: "NAV per share and price", group: "credit", format: "money", direction: "context",
      formula: "NetAssetValuePerShare from the latest 10-Q/10-K instant; price is derived as /api/comps market capitalization ÷ the company file's own latest sharesOutstanding, not a market feed's own per-share quote (there is no live price for an OTC-only filer)",
      watch: "NAV is a manager's mark, updated quarterly. The derived price can lag a real-time share count by up to a quarter, since the share count comes from the same filing as every other scorecard figure; a filer's drill-down instead uses the price feed's own monthly close, so the two can differ slightly. When /api/comps itself is not configured on this deployment (no market-data key), every non-OTC row's price shows \"not configured\" rather than \"not disclosed\" — a deployment gap, not a company-level one.",
      definition: "What the fund says its shares are worth (book value per share) beside what the market pays for them.",
      interpretation: "A NAV with no price (OTC-only, or a filer the market feed has not priced) still supports every book-value ratio on the row; only price/NAV and dividend yield are then unavailable." },
    { key: "lendersPriceToNav", label: "Price / NAV", group: "credit", format: "x", direction: "context",
      formula: "(Market capitalization ÷ the company file's own latest sharesOutstanding) ÷ NetAssetValuePerShare — never the market feed's price-to-book, a different number",
      watch: "Under 1.0× a BDC cannot sell new shares below NAV without a shareholder vote (§63(2)), so growth stops and buybacks start. Read the discount against the universe's own quartile, not only against 1.0×. The price half of this ratio can lag a real-time share count by up to a quarter (see lendersNav); a filer's own drill-down reads price from the price feed's monthly close instead, so the two can differ slightly. When the market-data feed is not configured on this deployment, this column and its severity flag cannot be computed for any row.",
      definition: "What the market pays for a dollar of the fund's book value.",
      interpretation: "The severity stripe fires when a row's price/NAV sits below the 25th percentile of every priced row in this universe, computed fresh at each build." },
    { key: "lendersDividendYield", label: "Dividend yield (TTM)", group: "credit", format: "pct", direction: "context",
      formula: "/api/comps dividendYieldTTM, a trailing-twelve-month fraction rendered here as a percent (never multiplied by price, which would give dividends per share instead)",
      watch: "A trailing measure; a BDC that just cut its dividend will show a yield that has not caught up yet.",
      definition: "Trailing twelve months of dividends paid, as a share of the current price.",
      interpretation: "Compare with dividend coverage: a high yield with coverage under 1.0× is being paid partly from spillover, gains or capital." },
    { key: "lendersNii", label: "Net investment income, after tax", group: "credit", format: "money", direction: "up",
      formula: "InvestmentIncomeOperatingAfterExpenseAndTax where tagged; else NetInvestmentIncome − the tax line; else NetInvestmentIncome labeled untaxed; else InvestmentIncomeNet. Per-share: the differenced InvestmentCompanyInvestmentIncomeLossPerShare",
      watch: "Not every filer tags the after-tax line every quarter; the row's own sources record names the tag that answered, so a reader can tell an after-tax figure from a pre-tax one.",
      definition: "What the fund earned from running its loan book this quarter, after the fund-level income and excise tax — the number the dividend is paid from.",
      interpretation: "Read it against the dividend, never against the change in NAV, which also carries marks." },
    { key: "lendersDividendCoverage", label: "Dividend coverage (total)", group: "credit", format: "x", direction: "up",
      formula: "After-tax NII per share ÷ distributions per share (InvestmentCompanyDistributionToShareholdersPerShare, YTD-differenced; CommonStockDividendsPerShareDeclared as fallback)",
      watch: "This data set carries one distributions-per-share figure, not a regular/supplemental/special split, so this is always the combined (\"total\") reading, labeled as such per the house rule (label total when a filer's own note does not split it). Both figures must come from the same filing period; when they do not, this cell shows not disclosed with the mismatch named on hover, rather than a cross-period quotient. Blueprint §4.3 L2's own rule is a flag on REGULAR coverage under 1.0× for two consecutive quarters, and a NOTE (not a flag) when only total coverage runs under 1.0×; since this data set can only ever produce the total reading, two straight soft quarters show here as an italicized note on the cell, never the severity stripe.",
      definition: "Dividends are earned, not declared: this is how many times over the fund's after-tax income covered its total distribution.",
      interpretation: "A shortfall is met from spillover, realized gains or capital, in that order of comfort — none of which this row shows directly. Two straight quarters under 1.0× is worth reading closely even as a note, not a flag." },
    { key: "lendersMark", label: "Mark (fair value ÷ cost)", group: "credit", format: "x", direction: "context",
      formula: "InvestmentOwnedAtFairValue ÷ InvestmentOwnedAtCost, the tagged portfolio totals",
      watch: "Equity and warrant positions lift it; a mark above 1.0 is not automatically good news if it comes from a concentrated equity stake. Fair value and cost must come from the same filing period; when they do not, this cell shows not disclosed with the mismatch named on hover, rather than a cross-period quotient.",
      definition: "The book's cumulative unrealized gain or loss — the private-loan analogue of a loan price.",
      interpretation: "A falling mark with flat non-accruals is the market's opinion of losses arriving before the payment defaults do." },
    { key: "lendersAssetCoverage", label: "Asset coverage and cushion", group: "credit", format: "x", direction: "up",
      formula: "InvestmentCompanySeniorSecurityIndebtednessAssetCoverageRatio where tagged; otherwise the 10-Q's own sentence; cushion = coverage ÷ statutory line − 1",
      watch: "The statutory line is 150% for a filer confirmed to have made the 2018 election and defaults to 150% when terms.json has not confirmed one — there is no field that says a filer definitely did NOT elect, so a non-electing filer's cushion would be read against the wrong floor until its 10-K is read for that sentence. When the pipeline's own tagged and prose readings for a filer disagree, the value is shown but the cushion severity flag does not fire on it, and the row's own note says so.",
      definition: "The 1940 Act's hardest leverage limit: (total assets − liabilities other than debt) ÷ senior debt. Below it a BDC cannot borrow more, declare a distribution, or buy back stock.",
      interpretation: "The severity stripe fires under a 15% cushion. The row's own source field says whether the value came from the tag, the filing's prose, or the formula fallback." },
    { key: "lendersLeverage", label: "Debt / equity, gross and net", group: "credit", format: "x", direction: "context",
      formula: "Debt (the resolved carrying-amount tag chain) ÷ net assets; net of cash ÷ net assets",
      watch: "Debt is resolved through a four-tag ladder plus an instance-level fallback; the row's own sources record names the tag that answered. A single-facility tag (LineOfCredit) is never treated as total debt. Debt and net assets must come from the same filing period; when they do not, the cell shows not disclosed with the mismatch named on hover, rather than a cross-period quotient.",
      definition: "How much borrowed money sits behind each dollar of the fund's equity.",
      interpretation: "Read beside the asset-coverage cushion, the statutory version of the same question." },
    { key: "lendersNonAccrual", label: "Non-accrual rate", group: "credit", format: "pct", direction: "down",
      formula: "Cost (and fair value) of schedule-of-investments holdings flagged non-accrual ÷ total investments at cost (fair value), holdings-only",
      watch: "Only computed for a filer whose 10-Q schedule of investments has been parsed (32 of 53 at this build); the rest show \"not yet parsed\" with the refusal reason on hover, never a zero.",
      definition: "Loans no longer paying as agreed, as a share of the book.",
      interpretation: "The severity stripe fires over 3% of investments at cost. Read cost and fair value together — a wide gap means the loans were marked down before they stopped paying." },
    { key: "lendersPik", label: "PIK share", group: "credit", format: "pct", direction: "down",
      formula: "Share of total investment income: (PIK interest + PIK dividend income) ÷ GrossInvestmentIncomeOperating, from companyfacts. Share of interest: the holdings-weighted contractual PIK rate on debt at cost (schedule of investments, holdings-only)",
      watch: "\"Share of interest\" here is a holdings-weighted, cost-basis measure, not PIK interest ÷ (cash + PIK interest) off the income statement — the data set carries no total-interest-income concept to build that ratio (composite.json's own coverage for it is zero filers). The two PIK figures on this row are therefore not directly comparable with each other.",
      definition: "Interest or dividends paid in more paper instead of cash, as a share of what the book earns.",
      interpretation: "A rising share with flat net investment income means cash earnings are falling. Never summed with non-accruals — they are separate tracks." },
    { key: "lendersFloatingShare", label: "Floating-rate share", group: "credit", format: "pct", direction: "context",
      formula: "Cost of third-party debt holdings carrying a spread fact ÷ cost of third-party debt holdings, holdings-only",
      watch: "Computed from the presence of a spread fact on each holding, not the SEC data set's rate-type column, which only one filer fills.",
      definition: "How much of the loan book reprices with the base rate.",
      interpretation: "A private loan book near 90–100% floating moves in lockstep with SOFR; a lower share carries fixed-rate exposure the SOFR tile does not explain." },
    { key: "lendersWeightedAverageYield", label: "Weighted-average yield on debt investments", group: "credit", format: "pct", direction: "context",
      formula: "Σ(principal × all-in rate) over accruing third-party debt ÷ Σ cost of the same holdings, holdings-only, before discount accretion",
      watch: "Expect this to run 0–0.3 points under a filer's own disclosed all-in yield, because OID accretion is not tagged per loan.",
      definition: "What the loans in the book actually pay, on a cost-weighted basis.",
      interpretation: "Read against the SOFR tile on the Market view: the gap is the spread the book is earning over the base rate." },
    { key: "lendersExpenseRatio", label: "Operating expense ratio", group: "credit", format: "pct", direction: "down",
      formula: "4 × (total expenses − interest and credit-facility expense) ÷ average net assets — the one cost measure comparable across internally and externally managed BDCs",
      watch: "The row's own tagged expense ratio (InvestmentCompanyExpenseRatioIncludingIncentiveFee, or …BeforeIncentiveAllocation) is shown alongside as a cross-check; the two are expected to differ, since the tagged one sometimes includes the incentive fee and this one never does. Total expenses and interest expense must come from the same filing period; when they do not, this cell shows not disclosed with the mismatch named on hover. Fees are read against the peer median of this ratio, never against \"2 and 20\", which is charged on committed capital, a different base.",
      definition: "How much of the fund's net assets its running costs consume in a year, excluding the cost of its own debt.",
      interpretation: "Externally managed funds compare here on equal footing with internally managed ones (MAIN, HTGC, TRIN, CSWC), which show \"internally managed\" on the fee column rather than a fee rate." },
    { key: "lendersFees", label: "Management and incentive fees", group: "credit", format: "pct", direction: "down",
      formula: "Base management fee rate, income incentive fee rate, hurdle, catch-up and capital-gains fee rate, parsed from the 10-K's investment advisory agreement note",
      watch: "An internally managed fund (MAIN, HTGC, TRIN, CSWC) pays no external fee and shows \"internally managed\", never a 0% rate. The dollar figures charged this quarter (management fee and incentive fee income) are on the row even where the rate schedule is not yet parsed. An incentive rate the fee note has not yet parsed shows \"not yet parsed\" beside the base rate, never a bare dash.",
      definition: "What the manager is paid, and on what base — never on committed capital, which \"2 and 20\" describes for a closed-end fund but a BDC does not use.",
      interpretation: "An incentive fee that keeps accruing while NAV falls, with no hurdle relief or lookback, is a governance flag the fee schedule (not this row) would show in full." },
    { key: "lendersPortfolioSize", label: "Portfolio at fair value and cost", group: "credit", format: "money", direction: "context",
      formula: "InvestmentOwnedAtFairValue and InvestmentOwnedAtCost, the tagged portfolio totals",
      watch: "The default scorecard view shows the 30 largest filers by this figure; \"Show all 53\" is a display toggle only — every computed figure already covers the full universe.",
      definition: "The size of the loan book, at what the manager paid for it and at what it is marked today.",
      interpretation: "Mark (fair value ÷ cost) is the ratio of these two; read portfolio size beside leverage to judge how much of the book is funded with debt." },
    { key: "lendersSeverityFlags", label: "Severity flags", group: "credit", format: "number", direction: "down",
      formula: "Three independent tests: (b) asset-coverage cushion under 15%; (c) non-accruals over 3% of investments at cost (holdings-only); (d) price/NAV below the 25th percentile of every priced row in this universe",
      watch: "Each test is independent — a row can carry more than one flag, or none. (b) never fires on a value the pipeline's own tag and prose readings disagree on. (c) can only fire for a filer with a parsed schedule of investments; (d) never fires when the market-data feed is not configured on this deployment. The blueprint's own fourth test — regular dividend coverage under 1.0× for two consecutive quarters — needs a regular/supplemental split this data set does not carry (it has only one, already-combined distributions figure); two straight soft quarters on that combined figure is shown as an italicized note on the dividend-coverage cell instead, per the blueprint's own instruction that a special dividend with total coverage under 1.0× is a note, not a flag.",
      definition: "The reading rules this scorecard applies mechanically and shows as a stripe, never a full-row wash.",
      interpretation: "A flag names a mechanical threshold crossed, not a verdict; read the row's own figures before concluding anything." },
  ];
  if (GLOBAL.RTCatalog && typeof GLOBAL.RTCatalog.register === "function") {
    GLOBAL.RTCatalog.register(ENTRIES);
  }

  /* ================= render(container, rows, ctx) ================= */
  var DEFAULT_TOP_N = 30;

  function fmtMoneyB(v) { return isNum(v) ? "$" + (v / 1e9).toFixed(2) + "B" : null; }
  function fmtMoneyM(v) { return isNum(v) ? "$" + (v / 1e6).toFixed(1) + "M" : null; }
  function fmtPerShare(v) { return isNum(v) ? "$" + v.toFixed(2) : null; }
  function fmtX(v) { return isNum(v) ? v.toFixed(2) + "×" : null; }
  function fmtPct(v, dp) { return isNum(v) ? (v * 100).toFixed(dp === undefined ? 1 : dp) + "%" : null; }
  function fmtPctPoints(v, dp) { return isNum(v) ? v.toFixed(dp === undefined ? 1 : dp) + "%" : null; }

  function td(html, cls, title) {
    return "<td class='" + esc(cls || "") + "'" + (title ? " title='" + esc(title) + "'" : "") + ">" + html + "</td>";
  }
  /* a null-valued cell: the reason lives in the title, never a blank or a zero */
  function naTd(cls, label, reason) {
    return "<td class='" + esc(cls || "") + " ls-na'" + (reason ? " title='" + esc(reason) + "'" : "") + ">" + esc(label) + "</td>";
  }
  function valueTd(v, fmt, cls, naLabel, reason) {
    return isNum(v) ? td(esc(fmt(v)), "ls-num " + (cls || "")) : naTd("ls-num " + (cls || ""), naLabel || "not disclosed", reason);
  }

  var COLUMNS = [
    { key: "bdc", label: "BDC", sortKey: "ticker",
      sortValue: function (r) { return r.ticker || ""; },
      cell: function (r) {
        var dot = r.flags.length ? "<i class='ls-flag-dot' title='" + esc(r.flags.map(flagLabel).join("; ")) + "'></i>" : "";
        var otc = r.otc ? "<span class='ls-otc' title='Quoted over the counter; no live price from the market feed'>OTC</span>" : "";
        return "<td class='ls-bdc'><button type='button' class='ls-ticker-btn' data-ticker='" + esc(r.ticker) + "'>" + dot + esc(r.ticker) + "</button>" + otc +
          "<span class='ls-name'>" + esc(r.name || "") + "</span></td>";
      } },
    { key: "nav", label: "NAV", metric: "lendersNav", sortValue: function (r) { return r.nav; },
      cell: function (r) { return valueTd(r.nav, fmtPerShare, "", "not disclosed"); } },
    { key: "price", label: "Price", metric: "lendersNav", sortValue: function (r) { return r.price; },
      cell: function (r) {
        if (r.marketFeedUnconfigured) return naTd("ls-num", "not configured", "the market-data feed (/api/comps) is not configured on this deployment; no live price for any filer until it is");
        return valueTd(r.price, fmtPerShare, "", "not disclosed", r.otc ? "quoted over the counter; no live price from the market feed" : null);
      } },
    { key: "priceToNav", label: "Price/NAV", metric: "lendersPriceToNav", sortValue: function (r) { return r.priceToNav; },
      cell: function (r) {
        if (r.marketFeedUnconfigured) return naTd("ls-num", "not configured", "the market-data feed (/api/comps) is not configured on this deployment; price/NAV and its severity flag cannot be computed until it is");
        return valueTd(r.priceToNav, fmtX, "", "not disclosed");
      } },
    { key: "dividendYieldTTM", label: "Div. yield", metric: "lendersDividendYield", sortValue: function (r) { return r.dividendYieldTTM; },
      cell: function (r) {
        if (r.marketFeedUnconfigured) return naTd("ls-num", "not configured", "the market-data feed (/api/comps) is not configured on this deployment");
        return valueTd(r.dividendYieldTTM, function (v) { return fmtPct(v, 1); }, "", "not disclosed");
      } },
    { key: "niiPerShare", label: "NII/sh", metric: "lendersNii", sortValue: function (r) { return r.niiPerShare; },
      cell: function (r) { return valueTd(r.niiPerShare, fmtPerShare, "", "not disclosed"); } },
    { key: "dividendCoverage", label: "Div. coverage (total)", metric: "lendersDividendCoverage",
      sortValue: function (r) { return r.dividendCoverage && r.dividendCoverage.total; },
      cell: function (r) {
        var dc = r.dividendCoverage || {};
        var reason = (r.mismatches && r.mismatches.dividendCoverage) || "needs both NII per share and distributions per share for the latest quarter";
        if (dc.twoQuarterNote) reason = "note (not a severity flag): total coverage ran under 1.0× for two straight quarters; this data set has no regular/supplemental split to confirm the blueprint's regular-coverage flag";
        return valueTd(dc.total, fmtX, dc.twoQuarterNote ? "ls-note" : "", "not disclosed", reason);
      } },
    { key: "mark", label: "Mark", metric: "lendersMark", sortValue: function (r) { return r.mark; },
      cell: function (r) { return valueTd(r.mark, fmtX, "", "not disclosed", r.mismatches && r.mismatches.mark); } },
    { key: "assetCoverage", label: "Asset coverage", metric: "lendersAssetCoverage",
      sortValue: function (r) { return r.assetCoverage && r.assetCoverage.value; },
      cell: function (r) {
        var ac = r.assetCoverage || {};
        if (!isNum(ac.value)) return naTd("ls-num", "not disclosed", "no tag, prose sentence or formula answered for this filer");
        var cushionTxt = ac.disputed ? "cushion not shown" : (isNum(ac.cushion) ? (ac.cushion * 100).toFixed(1) + "% cushion" : "cushion not computed");
        var title = ac.disputed ? ac.disputed : "source: " + (ac.source || "unknown") + " · " + cushionTxt + " over the " + ac.statutory + "% statutory line";
        return td(esc(ac.value.toFixed(2)) + "×", "ls-num" + (ac.disputed ? " ls-disputed" : ""), title);
      } },
    { key: "debtToEquity", label: "Debt/equity", metric: "lendersLeverage",
      sortValue: function (r) { return r.debtToEquity; },
      cell: function (r) {
        var mismatch = r.mismatches && r.mismatches.debtToEquity;
        var net = isNum(r.netDebtToEquity) ? "net " + r.netDebtToEquity.toFixed(2) + "×" : (r.mismatches && r.mismatches.netDebtToEquity ? "net " + r.mismatches.netDebtToEquity : "net not disclosed");
        return valueTd(r.debtToEquity, fmtX, "", "not disclosed", mismatch || net);
      } },
    { key: "nonAccrual", label: "Non-accrual", metric: "lendersNonAccrual",
      sortValue: function (r) { return r.nonAccrual && r.nonAccrual.cost; },
      cell: function (r) {
        var na = r.nonAccrual || {};
        if (!isNum(na.cost)) return naTd("ls-num", r.holdingsAvailable ? "not disclosed" : "not yet parsed", na.source);
        var fv = isNum(na.fv) ? "; " + fmtPct(na.fv, 1) + " at fair value" : "";
        return td(esc(fmtPct(na.cost, 1)), "ls-num", "of investments at cost" + fv);
      } },
    { key: "pik", label: "PIK", metric: "lendersPik",
      sortValue: function (r) { return r.pik && r.pik.shareOfTotal; },
      cell: function (r) {
        var p = r.pik || {};
        if (!isNum(p.shareOfTotal) && !isNum(p.shareOfInterest)) return naTd("ls-num", "not disclosed", r.mismatches && r.mismatches.pik);
        var parts = [];
        if (isNum(p.shareOfTotal)) parts.push(fmtPct(p.shareOfTotal, 1) + " of income");
        if (isNum(p.shareOfInterest)) parts.push(fmtPct(p.shareOfInterest, 1) + " of interest (holdings, contractual)");
        return td(esc(parts[0] || "not disclosed"), "ls-num", parts.join("; "));
      } },
    { key: "floatingShare", label: "Floating", metric: "lendersFloatingShare",
      sortValue: function (r) { return r.floatingShare; },
      cell: function (r) { return valueTd(r.floatingShare, function (v) { return fmtPct(v, 0); }, "", r.holdingsAvailable ? "not disclosed" : "not yet parsed"); } },
    { key: "weightedAverageYield", label: "WA yield", metric: "lendersWeightedAverageYield",
      sortValue: function (r) { return r.weightedAverageYield; },
      cell: function (r) { return valueTd(r.weightedAverageYield, function (v) { return fmtPct(v, 1); }, "", r.holdingsAvailable ? "not disclosed" : "not yet parsed"); } },
    { key: "expenseRatio", label: "Expense ratio", metric: "lendersExpenseRatio",
      sortValue: function (r) { return r.expenseRatio; },
      cell: function (r) {
        var mismatch = r.mismatches && r.mismatches.expenseRatio;
        var tagged = isNum(r.opexRatio) ? "as tagged: " + fmtPct(r.opexRatio, 1) : "no tagged cross-check";
        return valueTd(r.expenseRatio, function (v) { return fmtPct(v, 1); }, "", "not disclosed", mismatch || tagged);
      } },
    { key: "fees", label: "Fees", metric: "lendersFees",
      sortValue: function (r) { return r.fees && isNum(r.fees.managementFeeRate) ? r.fees.managementFeeRate : null; },
      cell: function (r) {
        var f = r.fees;
        if (f && f.internallyManaged) return td("Internally managed", "ls-fees");
        if (!f || !isNum(f.managementFeeRate)) return naTd("ls-fees", "not disclosed");
        var inc = isNum(f.incentiveIncomeRate) ? f.incentiveIncomeRate.toFixed(0) + "%" : "not yet parsed";
        var title = (isNum(f.hurdle) ? f.hurdle + "% quarterly hurdle" : "") + (isNum(f.catchUp) ? ", " + f.catchUp + "% catch-up" : "");
        return td(f.managementFeeRate.toFixed(2) + "% + " + inc, "ls-fees", title || null);
      } },
    { key: "portfolioFv", label: "Portfolio (FV)", metric: "lendersPortfolioSize",
      sortValue: function (r) { return r.portfolioFv; },
      cell: function (r) { return valueTd(r.portfolioFv, fmtMoneyB, "", "not disclosed"); } },
  ];
  var COLUMN_BY_KEY = {};
  COLUMNS.forEach(function (c) { COLUMN_BY_KEY[c.key] = c; });

  function compareBy(col, dir) {
    var mul = dir === "asc" ? 1 : -1;
    return function (a, b) {
      var av = col.sortValue(a), bv = col.sortValue(b);
      var an = isNum(av) || typeof av === "string" && av !== "";
      var bn = isNum(bv) || typeof bv === "string" && bv !== "";
      if (!an && !bn) return 0;
      if (!an) return 1;
      if (!bn) return -1;
      if (typeof av === "string" || typeof bv === "string") return mul * String(av).localeCompare(String(bv));
      return mul * (av - bv);
    };
  }

  function applyFilterSortShow(rows, state) {
    var q = String(state.filter || "").trim().toLowerCase();
    var base;
    if (q) {
      base = rows.filter(function (r) { return (r.ticker || "").toLowerCase().indexOf(q) >= 0 || (r.name || "").toLowerCase().indexOf(q) >= 0; });
    } else if (!state.showAll) {
      base = rows.slice().sort(function (a, b) { return (isNum(b.portfolioFv) ? b.portfolioFv : -1) - (isNum(a.portfolioFv) ? a.portfolioFv : -1); }).slice(0, DEFAULT_TOP_N);
    } else {
      base = rows.slice();
    }
    var col = COLUMN_BY_KEY[state.sortKey] || COLUMN_BY_KEY.portfolioFv;
    return base.slice().sort(compareBy(col, state.sortDir));
  }

  function headerCell(col, state, catalog) {
    var active = state.sortKey === col.key;
    var arrow = active ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
    var label = col.label;
    if (col.metric && catalog && typeof catalog.get === "function") {
      var m = catalog.get(col.metric);
      if (m && m.label) label = col.label; /* keep the short column head; the full label lives in the popup */
    }
    var metricAttr = col.metric ? " data-metric='" + esc(col.metric) + "' tabindex='0'" : "";
    return "<th><button type='button' class='ls-th-btn' data-sort-key='" + esc(col.key) + "'" + metricAttr + ">" +
      esc(label) + "<span class='ls-sort-arrow'>" + arrow + "</span></button></th>";
  }

  function paintHtml(rows, state, ctx) {
    var view = applyFilterSortShow(rows, state);
    var head = "<tr>" + COLUMNS.map(function (c) { return headerCell(c, state, ctx.catalog); }).join("") + "</tr>";
    var body = view.map(function (r) {
      var cls = "ls-row" + (r.flags.length ? " ls-flagged" : "") + (r.stale ? " ls-stale" : "");
      /* no apostrophe in either string below: this text is rendered into a
         single-quoted HTML title attribute, where esc() does not escape ' */
      var titleParts = [];
      if (r.stale) titleParts.push("Flagged stale by the refresh, not from the current quarter (" + r.staleKeys.join(", ") + ")");
      if (r.dataFlagged) titleParts.push("The refresh distrusts the following figures on this row: " + r.flaggedKeys.join(", ") + " — read each affected cell title before comparing across filers");
      var rowTitle = titleParts.length ? " title='" + esc(titleParts.join("; ") + ".") + "'" : "";
      return "<tr class='" + cls + "' data-ticker='" + esc(r.ticker) + "'" + rowTitle + ">" +
        COLUMNS.map(function (c) { return c.cell(r); }).join("") + "</tr>";
    }).join("");
    var shown = view.length, total = rows.length;
    var toggleLabel = state.showAll ? "Show the 30 largest" : "Show all " + total;
    var countLine = state.filter
      ? shown + " of " + total + " match “" + esc(state.filter) + "”"
      : (state.showAll ? "All " + total + " listed BDCs" : "The " + Math.min(DEFAULT_TOP_N, total) + " largest by portfolio fair value, of " + total);
    /* the export button's own promise is "every table on this page" — the
       on-screen table only ever shows the toggled/filtered subset, so a
       second, hidden table (never affected by the filter or the top-30
       toggle) carries all `total` rows for the workbook.
       Two round-2 fixer findings on this block:
       - the comment above used to claim the visible table "carries no
         data-export-name, so RTExport reads this one and only this one"
         — false: the page's export control selects every "main
         table.grid" element, with or without a name (falling back to the
         nearest heading), so the visible table was ALSO exported, as a
         second, incomplete "BDC scorecard"-like sheet with no way to
         tell it apart from the complete one. It now carries its own
         name, distinct and self-describing.
       - `ld-export-only` on a <table> directly does nothing: a table's
         own display box ignores `width:1px` (the class's CSS), so the
         hidden table rendered at its full ~1,750px width and gave the
         whole Lenders view horizontal scroll at every viewport width.
         The drill-down avoids this by wrapping its own hidden export
         tables in a block-level `<div class='ld-export-only'>`, which
         DOES clip; do the same here. */
    var allRows = rows.slice().sort(function (a, b) { return (isNum(b.portfolioFv) ? b.portfolioFv : -1) - (isNum(a.portfolioFv) ? a.portfolioFv : -1); });
    var exportBody = allRows.map(function (r) {
      return "<tr data-ticker='" + esc(r.ticker) + "'>" + COLUMNS.map(function (c) { return c.cell(r); }).join("") + "</tr>";
    }).join("");
    return (
      "<div class='ls-controls'>" +
        "<label class='ls-filter-label'><span class='ind-picker-label'>Filter</span>" +
          "<input type='search' class='ls-filter' placeholder='Ticker or name…' autocomplete='off' value='" + esc(state.filter) + "' aria-label='Filter BDCs' /></label>" +
        "<button type='button' class='ls-showall'>" + esc(toggleLabel) + "</button>" +
        "<span class='ls-count'>" + esc(countLine) + "</span>" +
      "</div>" +
      "<div class='ls-table-scroll'><table class='grid ls-scorecard' data-export-name='Lenders — visible rows only'>" +
        "<thead>" + head + "</thead><tbody>" + (body || "<tr><td colspan='" + COLUMNS.length + "' class='ls-na'>No BDC matches this filter.</td></tr>") + "</tbody>" +
      "</table></div>" +
      "<div class='ld-export-only'><table class='grid' data-export-name='BDC scorecard'><thead>" + head + "</thead><tbody>" + exportBody + "</tbody></table></div>"
    );
  }

  /**
   * render(container, rows, ctx) — ctx = { catalog, fmt, onRowClick(ticker),
   * wrapTerms }. Every part is optional except container and rows: the
   * table paints with local formatters when ctx.fmt/catalog are absent,
   * so the offline test can call it with a minimal object.
   */
  function render(container, rows, ctx) {
    if (!container) return;
    ctx = ctx || {};
    rows = Array.isArray(rows) ? rows : [];
    var state = container.__lsState || { sortKey: "portfolioFv", sortDir: "desc", filter: "", showAll: false };
    container.__lsState = state;

    function paint() { container.innerHTML = paintHtml(rows, state, ctx); }
    paint();

    if (!container.__lsBound) {
      container.addEventListener("input", function (e) {
        var t = e && e.target;
        if (t && t.className && String(t.className).indexOf("ls-filter") >= 0) {
          state.filter = t.value || "";
          var caret = t.selectionStart;
          paint();
          /* paint() replaces the whole subtree, including the input that
             just fired this event, which would otherwise drop focus after
             every keystroke; put it back, caret and all */
          var again = typeof container.querySelector === "function" ? container.querySelector(".ls-filter") : null;
          if (again && typeof again.focus === "function") {
            again.focus();
            if (typeof again.setSelectionRange === "function" && typeof caret === "number") {
              try { again.setSelectionRange(caret, caret); } catch (e2) { /* ignore */ }
            }
          }
        }
      });
      container.addEventListener("click", function (e) {
        var t = e && e.target, el = t && typeof t.closest === "function" ? t.closest("[data-sort-key]") : null;
        if (el) {
          var key = el.getAttribute("data-sort-key");
          state.sortDir = state.sortKey === key && state.sortDir === "desc" ? "asc" : (state.sortKey === key ? "desc" : "desc");
          state.sortKey = key;
          paint();
          return;
        }
        var toggle = t && typeof t.closest === "function" ? t.closest(".ls-showall") : null;
        if (toggle) { state.showAll = !state.showAll; paint(); return; }
        var rowBtn = t && typeof t.closest === "function" ? t.closest(".ls-ticker-btn") : null;
        if (rowBtn && typeof ctx.onRowClick === "function") ctx.onRowClick(rowBtn.getAttribute("data-ticker"));
      });
      container.__lsBound = true;
    }
    if (typeof ctx.wrapTerms === "function") ctx.wrapTerms(container);
  }

  return {
    FLAGS: FLAGS,
    percentile: percentile,
    buildRows: buildRows,
    render: render,
    CATALOG_ENTRIES: ENTRIES,
    COLUMNS: COLUMNS,
  };
});
