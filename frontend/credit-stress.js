/* credit-stress.js — the Market view's stress section (blueprint 3.3,
   chart M6) and the LCD references that complete the price of private
   credit (3.2: M4, M5 and the M1 dot; the M2 line is drawn by credit.js).

   Registers itself on window.RTCreditSections (contract L3 in credit.js)
   and its popups through RTCatalog.register, both at file evaluation;
   credit.js loads the series groups named below, empties #sec-stress and
   calls mount(container, ctx). Nothing here touches the DOM before
   mount, so scripts/test-pc-page.mjs can evaluate the file in Node and
   measure every caption sample.

   Two panels render into the container, in this order:
     1. "The price of private credit — LCD's series": the M1 reference
        (LCD's new-issue direct-lending LBO spread as dated dots, the
        rolling three-month point hatched), M4 (the BDC holdings spread
        histogram: LCD's four quarterly snapshots as grouped columns, the
        site composite's latest quarter as an outlined bar when present,
        toggles for unitranche and first lien, one modal bucket in
        accent) and M5 (yield decomposition: the composite's base rate
        plus spread as a stack when present; LCD's cost-weighted all-in
        rate always, beside the SOFR 90-day average at quarter end, the
        blueprint's 3.2 reference). credit.js exposes no hook onto the
        M1 ladder, so the M1 dot is the row of dated dots at the top of
        this panel, read against the ladder's single-B rung in its
        caption; M2's LCD line is drawn by credit.js itself
        (completeM2, once this section's group is loaded) as the fourth
        line on the yield stack, and M5 carries the same series beside
        the SOFR 90-day average with its n and population in the footer.
     2. "Stress and defaults": M6 as small multiples — the composite's
        non-accrual (both bases), PIK (both ratios), FV/cost and
        distressed share from ctx.composite, each the designed
        "composite after the holdings release" state until the holdings
        release; the Proskauer index with its EBITDA bands; KBRA; Fitch
        (default rate and BDC leverage); the Moody's range; the loan
        index on both tracks; the Cliffwater headline; bank C&I
        delinquency and charge-off from the credit-macro payload; and a
        dated-statements tile. Every point of a press-class series links
        to the page it was read from (press-series.json's URL), every
        footer states n or the population, and one-observation series
        are drawn as dots.

   The composite: this section never reads data/bdc/composite.json
   itself; credit.js reads the file the holdings refresh writes
   ({ creditVersion, n, asOf, totals, weighted { nonAccrualCost,
   nonAccrualFv, pikShareOfInterest, pikShareOfTotal, fvOverCost, ... },
   histogram { byCount, byCost } }) and hands every section the one view
   its normalizeComposite() builds, as ctx.composite. The fields read
   here; any field absent leaves that panel in its empty state. Rates
   and shares are FRACTIONS, the lib/credit.js convention (0.024 is 2.4%):
     { asOf: "2026-06-30", n: 50,
       quarters: [ { p: "2026-06-30", n: 44,
           nonAccrualCost, nonAccrualFv,            ÷ total investments
           nonAccrualDebtCost, nonAccrualDebtFv,    ÷ debt investments
           pikShareOfInterest, pikShareOfTotal,
           fvOverCost,                              FV ÷ cost, the mark
           distressedShare,                         debt cost with FV/cost < 0.80 ÷ debt cost
           allInYield, spreadOverBase, baseRate } ],   one row from the
                                                 weighted block until the
                                                 refresh writes a history
       latest: the last row,
       histogram: { p, n, byCount: [ { label: "450-499", share } ], byCost: [ ... ] } }

   Nothing is typed from a report: every figure comes from a series key
   through ctx.series, the credit-macro payload, the composite, or a
   computation at render, and every caption computes its numbers. Where
   an LCD population meets the site's the caption says "direction, not
   level". The Fed and FSB sector-sizing statements are not in this
   edition's press-series.json, so that slot says so instead of carrying
   a figure. */
(function () {
  "use strict";

  var REG = window.RTCreditSections = window.RTCreditSections || [];
  var CAT = window.RTCatalog || null;

  /* ---------- pure helpers (no DOM) ---------- */
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function withCommas(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function pct(v, dp) { return isNum(v) ? v.toFixed(dp === undefined ? 1 : dp) + "%" : "—"; }
  function pctNum(v, dp) { return isNum(v) ? v.toFixed(dp === undefined ? 1 : dp) : "—"; }
  function bpsNum(v) { return isNum(v) ? withCommas(Math.round(v)) : "—"; }
  function domainOf(url) {
    var m = String(url || "").match(/^https?:\/\/(?:www\.)?([^\/]+)/i);
    return m ? m[1] : "";
  }
  function uniq(arr) { var seen = {}, out = []; arr.forEach(function (x) { if (x && !seen[x]) { seen[x] = true; out.push(x); } }); return out; }
  function last(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
  function ms(d) { return Date.parse(String(d).slice(0, 10) + "T00:00:00Z"); }

  /* ---------- caption templates ----------
     template(values) renders the caption the page shows; sample() renders
     it with the widest values it can carry, so the build test measures
     every caption under 240 characters. The source stamp lives in the
     footer, never here. */
  var CAPTIONS = {
    m1Lcd: {
      template: function (v) {
        return "LCD's new-issue direct-lending LBO spread: " + v.lbo + " bps over base in " + v.window + " (" + v.firstV + " in " + v.first + ", " +
          v.priorV + " in " + v.prior + "), " + v.bond + "; PE-backed deals " + v.pe + " bps. The rolling window overlaps " + v.overlap + ".";
      },
      sample: function () {
        return CAPTIONS.m1Lcd.template({ lbo: "1,000", window: "Jun–Aug 2026", firstV: "1,000", first: "Q1 2026", priorV: "1,000", prior: "Q2 2026",
          bond: "about 1,000 bps over single-B OAS at 1,000", pe: "1,000", overlap: "Q2 2026" });
      }
    },
    m4: {
      template: function (v) {
        return "LCD's BDC portfolios hold " + v.band + "% of " + v.what + " at 450–549 bps over base (" + v.prior + "% in " + v.priorQ +
          "); modal bucket " + v.modal + " at " + v.modalShare + "% (" + v.modalPrior + "% in " + v.priorQ + "). " + v.site;
      },
      sample: function () {
        /* the widest site clause is the empty state, which carries the
           population caveat wherever the composite slot exists */
        return CAPTIONS.m4.template({ band: "100.0", what: "first-lien term loans", prior: "100.0", priorQ: "4Q25", modal: "800 bps or more",
          modalShare: "100.0", modalPrior: "100.0", site: "The site composite arrives with the holdings release; direction, not level." });
      }
    },
    m5: {
      template: function (v) {
        return "LCD's all-in rate on BDC-held loans: " + v.v + " in " + v.q + " from " + v.prior + " in " + v.priorQ + " (peak " + v.peak +
          " in " + v.peakQ + "); " + v.gap + " points over " + v.base + " (" + v.sofr + " at quarter end). " + v.site;
      },
      sample: function () {
        return CAPTIONS.m5.template({ v: "11.51%", q: "Q2 2026", prior: "11.51%", priorQ: "Q1 2026", peak: "11.51%", peakQ: "Q3 2023",
          gap: "10.00", base: "overnight SOFR", sofr: "10.00%", site: "The site composite arrives with the holdings release; direction, not level." });
      }
    },
    m5composite: {
      template: function (v) {
        return "The site's composite earns " + v.allIn + " all-in on accruing third-party debt: base " + v.base + " plus " + v.spread + " bps of spread (" +
          v.q + ", n = " + v.n + "); LCD's all-in rate " + v.lcd + " in " + v.lcdQ + ". Direction, not level.";
      },
      sample: function () {
        return CAPTIONS.m5composite.template({ allIn: "10.00%", base: "10.00%", spread: "1,000", q: "Q2 2026", n: "50", lcd: "11.51%", lcdQ: "Q2 2026" });
      }
    },
    m6Proskauer: {
      template: function (v) {
        return "Proskauer's index: " + v.v + " of active loans in default in " + v.q + " (" + v.n + " loans, $" + v.principal + "B), from " + v.prior + " in " +
          v.priorQ + "; by EBITDA band under $25M " + v.lt25 + ", $25–49.9M " + v.mid + ", $50M and over " + v.ge50 + ".";
      },
      sample: function () {
        return CAPTIONS.m6Proskauer.template({ v: "10.00%", q: "Q2 2026", n: "1,000", principal: "195.6", prior: "10.00%", priorQ: "Q1 2026",
          lt25: "10.0%", mid: "10.0%", ge50: "10.0%" });
      }
    },
    m6Kbra: {
      template: function (v) {
        return "KBRA DLD's headline: " + v.head + " of issuers in default, " + v.headLabel + "; " + v.year + " " + v.yearLine + "; the " + v.fy +
          " forecast " + v.f + " (" + v.fq + "). Count-weighted and volume-weighted points are not one series.";
      },
      sample: function () {
        return CAPTIONS.m6Kbra.template({ head: "10.0%", headLabel: "TTM to mid-June 2026", year: "2025", yearLine: "10.0% (by volume), 10.0% (loan-weighted)", fy: "2026",
          f: "10.0%", fq: "by issuer count" });
      }
    },
    m6Fitch: {
      template: function (v) {
        return "Fitch's TTM private credit default rate: " + v.v + " to " + v.label + ", " + v.move + ", " + v.high +
          "; the privately monitored subset (the higher-risk book) " + v.pmr + " (" + v.pmrLabel + "), the composite runs lower.";
      },
      sample: function () {
        return CAPTIONS.m6Fitch.template({ v: "10.0%", label: "Jun 30, 2026", move: "down from 10.0% (May 31, 2026)", high: "under its high of 10.0% (Mar 31, 2026)",
          pmr: "10.0%", pmrLabel: "Mar 31, 2026" });
      }
    },
    m6FitchLeverage: {
      template: function (v) {
        return "Fitch-rated BDCs average " + v.v + " debt to equity at " + v.label + ", " + v.move + " " + v.prior + " at " + v.priorLabel + " and " + v.first + " at " +
          v.firstLabel + "; " + v.read;
      },
      sample: function () {
        return CAPTIONS.m6FitchLeverage.template({ v: "10.00×", label: "Mar 31, 2026", move: "up from", prior: "10.00×", priorLabel: "Dec 31, 2025", first: "10.00×", firstLabel: "Dec 31, 2024",
          read: "leverage mixed across the points while Fitch's default rate above sits under its high of 10.0% (Mar 31, 2026)." });
      }
    },
    m6Moodys: {
      template: function (v) {
        return "Moody's puts the " + v.year + " private credit default rate between " + v.lo + " excluding distressed exchanges and " + v.hi +
          " including them; its speculative-grade rate was " + v.sg + " at " + v.sgLabel + ". Two tracks, never summed.";
      },
      sample: function () {
        return CAPTIONS.m6Moodys.template({ year: "2025", lo: "10.0%", hi: "10.0%", sg: "10.0%", sgLabel: "end-2025" });
      }
    },
    m6LoanIndex: {
      template: function (v) {
        return "The loan index's TTM default rate by issuer count: " + v.inc + " with distressed exchanges and " + v.exc + " without (" + v.label +
          "), from " + v.incPrior + " and " + v.excPrior + " (" + v.priorLabel + "). The gap between the tracks is the exchange track.";
      },
      sample: function () {
        return CAPTIONS.m6LoanIndex.template({ inc: "10.00%", exc: "10.00%", label: "Jun 30, 2026", incPrior: "10.00%", excPrior: "10.00%", priorLabel: "Dec 31, 2025" });
      }
    },
    m6Cliffwater: {
      template: function (v) {
        return "Cliffwater's direct lending index returned " + v.ttm + " in the twelve months to " + v.ttmLabel + " and " + v.h + " in " + v.hLabel + ", after " +
          v.y + " in " + v.yLabel + "; " + v.incYear + " interest income " + v.inc + " of assets, of which PIK " + v.pik + " points.";
      },
      sample: function () {
        return CAPTIONS.m6Cliffwater.template({ ttm: "10.0%", ttmLabel: "Jun 30, 2026", h: "10.0%", hLabel: "H1 2026", y: "10.0%", yLabel: "2025",
          incYear: "2025", inc: "10.0%", pik: "10.0" });
      }
    },
    m6Bank: {
      template: function (v) {
        return "Bank C&I loans: " + v.del + " delinquent and " + v.co + " charged off (" + v.q + "), from " + v.delPrior + " and " + v.coPrior +
          " the quarter before; delinquency sits at the " + v.pctile + " percentile of " + v.win + ".";
      },
      sample: function () {
        return CAPTIONS.m6Bank.template({ del: "10.00%", co: "10.00%", q: "Q2 2026", delPrior: "10.00%", coPrior: "10.00%", pctile: "100th", win: "the 100 quarters since Q2 2016" });
      }
    },
    m6NonAccrual: {
      template: function (v) {
        /* the debt-only pair is a second measure the refresh may not
           write; the clause is dropped, never printed as dashes */
        var debt = v.debtCost && v.debtCost !== "—" ? "; of debt investments " + v.debtCost + (v.debtFv && v.debtFv !== "—" ? " and " + v.debtFv : "") : "";
        return "The composite's non-accruals are " + v.cost + " of investments at cost and " + v.fv + " at fair value (" + v.q + ", n = " + v.n + ")" + debt +
          ". The fair-value figure is smaller because those loans are already marked down.";
      },
      sample: function () {
        return CAPTIONS.m6NonAccrual.template({ cost: "10.0%", fv: "10.0%", q: "Q2 2026", n: "50", debtCost: "10.0%", debtFv: "10.0%" });
      }
    },
    m6Pik: {
      template: function (v) {
        return "PIK is " + v.interest + " of the composite's interest and " + v.income + " of its total investment income (" + v.q + ", n = " + v.n +
          "); a rising share with flat NII means cash earnings are falling. Never summed with non-accruals.";
      },
      sample: function () { return CAPTIONS.m6Pik.template({ interest: "10.0%", income: "10.0%", q: "Q2 2026", n: "50" }); }
    },
    m6Mark: {
      template: function (v) {
        /* prior is the quarter before's mark, or null on one observation */
        var move = v.prior && v.prior !== "—" ? ", " + v.dir + " " + v.prior + " the quarter before" : ", one observation";
        return "The composite's mark is " + v.mark + " fair value to cost (" + v.q + ", n = " + v.n + ")" + move + "; equity-heavy books lift it.";
      },
      sample: function () { return CAPTIONS.m6Mark.template({ mark: "10.000", q: "Q2 2026", n: "50", dir: "down from", prior: "10.000" }); }
    },
    m6Distressed: {
      template: function (v) {
        return v.site + "The loan index's distressed ratio (loans priced under 80): " + v.v + " at " + v.label + ", from a " + v.peak + " peak at " + v.peakLabel + ".";
      },
      sample: function () {
        return CAPTIONS.m6Distressed.template({ site: "The composite holds 10.0% of third-party debt cost under 0.80 (Q2 2026, n = 50). ", v: "10.0%", label: "Dec 31, 2023",
          peak: "10.0%", peakLabel: "Dec 31, 2022" });
      }
    }
  };

  /* ---------- popups: formula → caveat → definition → how to read it ---------- */
  var ENTRIES = [
    { key: "pcPriceLcd", label: "The price of private credit — LCD's series", subtitle: "M1 reference, M4, M5",
      formula: "LCD's new-issue direct-lending LBO spread (bps over base, three windows); BDC holdings by 50 bps spread bucket, share by count; the cost-weighted all-in rate on BDC-held loans, quarterly",
      watch: "LCD's population is every BDC portfolio it tracks (the footer states how many), which implies non-listed funds; the site composite is the listed universe. Compare direction, not level. From 2026 the spread series mix privately sourced values with public ones.",
      definition: "What private loans cost the borrower, read three ways: the spread on new deals, the spread on the loans BDCs already hold, and the all-in rate those loans pay.",
      interpretation: "New-issue spread leads the book: a bucket migration on new deals shows up in the holdings distribution over the following quarters, and the all-in rate follows the base rate first and spread second." },
    { key: "m1LcdLboSpread", label: "New-issue direct-lending LBO spread (LCD)", subtitle: "the M1 reference dot, bps over base",
      formula: "Average spread over base on US LBOs financed in the direct lending market, per LCD, for Q1, Q2 and the rolling three months to the monitor's as-of date; PE-backed deals (all uses of proceeds) beside it",
      watch: "The rolling three-month window overlaps the last quarter and is never summed with it; 2026 values include privately sourced spreads; floors, OID and fees are not in the spread. Bonds on the ladder above are priced over Treasuries, loans over a floating base.",
      definition: "The price of credit risk plus illiquidity on a new leveraged buyout loan from a direct lender, before the base rate.",
      interpretation: "Set it against single-B OAS on the ladder: the excess is the illiquidity and control premium. A rising spread with falling volume is lenders being selective, not a repricing of the whole market." },
    { key: "m4SpreadHistogram", label: "Spread histogram — BDC holdings", subtitle: "M4, share of loans by 50 bps bucket over base",
      formula: "Share of BDC-held loans by count in each 50 bps spread bucket over base, per LCD, for the last four quarter ends; the site composite's latest quarter as an outline; toggles for unitranche and senior secured first-lien term loans",
      watch: "LCD's buckets are by count and its base rate is not named, so the label is bps over base, never SOFR plus. Unitranche and first-lien snapshots use six and seven buckets. The composite outline is a different population: direction, not level.",
      definition: "Where the loans in BDC books are priced: the distribution of contractual spreads, with the modal bucket in accent.",
      interpretation: "Read the migration: name the modal bucket, the bucket it displaced and both prior shares, then translate to borrower cost. A shift down the buckets is spread compression on the book, not on new deals." },
    { key: "m5YieldDecomposition", label: "Yield decomposition", subtitle: "M5: all-in = base + spread; the same LCD line sits on M2",
      formula: "Composite: base rate + cost-weighted spread = all-in yield on accruing third-party debt, quarterly, from the schedules of investments. LCD: cost-weighted average all-in interest rate on senior secured, unsecured and subordinated debt held by BDCs, quarterly; the SOFR 90-day average at quarter end from FRED (the overnight rate when the average is missing)",
      watch: "The composite stack arrives with the holdings release. LCD's population is every BDC portfolio it tracks (the footer states how many); the site's is the listed universe: direction, not level. The 90-day SOFR average stands in for term SOFR, which FRED does not carry; loan contracts often carry a floor below which the base rate does not fall.",
      definition: "What a private loan pays, split into the base rate every floating loan shares and the spread that is the price of the borrower's risk.",
      interpretation: "The floating-rate carry of 2023–24 was the base rate rising under fixed spreads; the reversal is the base rate falling while spreads compress. The gap between the all-in rate and SOFR is the spread the book earns." },
    { key: "stressPanel", label: "Stress and defaults", subtitle: "M6, every public proxy as its own series",
      formula: "Composite non-accrual, PIK, FV/cost and distressed share from the schedules; Proskauer, KBRA, Fitch and Moody's read from their release pages; the loan index on both tracks from the reports; bank C&I delinquency and charge-off from FRED",
      watch: "Private credit has no single public default rate. Each proxy defines default differently and covers a different population; they are drawn side by side and never averaged. Payment defaults and distressed exchanges are separate tracks and are never summed.",
      definition: "How much of the private loan market is not paying as agreed, read through every public measure that exists.",
      interpretation: "In a BDC book the payment track is non-accruals and the exchange track is PIK conversions plus amendments. Read the two together with the marks: a low non-accrual rate with rising PIK is stress moving down the second track." },
    { key: "m6NonAccrual", label: "Composite non-accrual rate", subtitle: "cost and fair value; ÷ total and ÷ debt investments",
      formula: "Σ cost (fair value) of investments on non-accrual ÷ Σ total investments at cost (fair value) across the listed BDCs; a second pair ÷ debt investments only",
      watch: "A BDC decides when to stop accruing; the fair-value figure is smaller because those loans are already marked down. The series starts where the schedules of investments are parsed, so early quarters are single observations.",
      definition: "Loans no longer paying as agreed, as a share of the book — the payment-default track of a BDC portfolio.",
      interpretation: "Over 3% of total investments at cost is the scorecard flag. Read it with PIK and amendments and with additions and removals, not alone." },
    { key: "m6PikShare", label: "Composite PIK share", subtitle: "of interest, and of total investment income",
      formula: "Σ PIK interest ÷ Σ (cash interest + PIK interest), all affiliation classes; and Σ PIK income ÷ Σ total investment income; income tags differenced from year-to-date, never the cash-flow adjustment",
      watch: "PIK may be contractual from day one (a feature) or a later conversion (a symptom); the filing rarely says which. The first ratio is the one Cliffwater and most filers quote; the second is larger where PIK dividends are large.",
      definition: "Interest or dividends paid in more paper instead of cash, as a share of what the book earns — the exchange track of a BDC portfolio.",
      interpretation: "A rising share with flat net investment income means cash earnings are falling. Never summed with non-accruals." },
    { key: "m6Mark", label: "Composite mark (FV/cost)", subtitle: "fair value ÷ amortized cost",
      formula: "Σ investments at fair value ÷ Σ investments at amortized cost across the listed BDCs, quarterly from companyfacts",
      watch: "Equity positions lift it; BDCs with warrants run above 1.0. Appraisal-based marks understate volatility against traded loan prices.",
      definition: "The book's cumulative unrealized gain or loss: the private analogue of loan prices.",
      interpretation: "A mark falling while non-accruals are flat is the market's losses arriving before the payment defaults do." },
    { key: "m6Distressed", label: "Distressed share", subtitle: "debt with FV/cost under 0.80, and the loan index's under-80 ratio",
      formula: "Composite: cost of third-party debt holdings with fair value ÷ cost under 0.80 ÷ cost of third-party debt. Loan index: share of performing loans priced below 80 (LCD), dated points from the reports",
      watch: "The private analogue of the liquid under-80 ratio, not the same measure: BDC marks are appraisals, loan prices are trades. The loan-index points are the dates the reports printed, not a series.",
      definition: "How much of the book the lender has already marked as impaired, before any default is recorded.",
      interpretation: "Read it against the mark: a distressed share rising faster than the mark falls means losses are concentrated in a few names." },
    { key: "m6Proskauer", label: "Proskauer Private Credit Default Index", subtitle: "overall and by EBITDA band, quarterly",
      formula: "Share of active US senior secured and unitranche loans in Proskauer's database in default during the quarter, overall and for borrowers with EBITDA under $25M, $25–49.9M and $50M or more at origination; every value read on the proskauer.com release page",
      watch: "Proskauer's default is the earliest of a missed payment, a distressed restructuring, a bankruptcy filing or a covenant default — broader than a payment default. The index composition changes each quarter (the loan count and principal are drawn beside it), so it is not a fixed cohort; Q1 2023 is read from the following quarter's page.",
      definition: "The one quarterly default index on private loans with a public release page, and the longest such series.",
      interpretation: "The smaller bands default more often in most quarters; read the overall rate with the loan count, because a shrinking index with a steady rate is a different signal from a growing one." },
    { key: "m6Kbra", label: "KBRA DLD direct-lending default rate", subtitle: "trailing twelve months, headlines and forecasts",
      formula: "Share of borrowers in the KBRA DLD US direct lending index that defaulted in the trailing twelve months, by issuer count unless the point says by volume or loan-weighted; the annual forecasts are drawn hollow",
      watch: "The monthly report is subscriber-only, so the series is what press pages quote, dated and weighted as each page states; a point with no calendar date is listed, not plotted. Forecasts are kept off the actuals line. KBRA's middle-market monitor is a different universe and is not drawn here.",
      definition: "The default rate on the loans BDCs hold, as one rating agency's index counts them.",
      interpretation: "Read the headline against the forecast for the same year: a headline matching the inception high while the forecast sits higher says the agency expects more." },
    { key: "m6Fitch", label: "Fitch US private credit default rate", subtitle: "trailing twelve months, composite and the PMR subset",
      formula: "Trailing-twelve-month default rate across the US private-debt borrowers Fitch tracks (privately monitored ratings plus model-implied credit opinions), and the privately monitored subset alone, as quoted by pages syndicating Fitch's commentary",
      watch: "Fitch's own pages serve no article text, so every value is from a page quoting Fitch; the population is described in the footer. The PMR subset is the higher-risk portfolio used by insurers, so its rate is not comparable with the composite.",
      definition: "A rating agency's count of defaults among the private borrowers it monitors, twelve months trailing.",
      interpretation: "A composite rising toward its record while the PMR subset runs near ten percent is the two-tier picture: broad stress is modest, concentrated stress is not." },
    { key: "m6FitchLeverage", label: "Fitch-rated BDC leverage", subtitle: "average debt to equity, ×",
      formula: "Average debt ÷ equity across the BDCs Fitch rates, as stated in Fitch's BDC commentary and read on its syndication",
      watch: "An average across Fitch's rated set, not the site's universe; the site computes its own composite leverage from the filings when the holdings release lands.",
      definition: "How much borrowed money sits behind each dollar of BDC equity, on average.",
      interpretation: "Leverage rising while net asset value falls compresses the asset-coverage cushion; the 1940 Act limit is about 2:1 for a BDC that took the 2018 election." },
    { key: "m6Moodys", label: "Moody's private credit default range", subtitle: "2025, excluding and including distressed exchanges",
      formula: "Moody's approximated 2025 US private credit default rate as two figures, the low excluding distressed exchanges and the high including them; the speculative-grade corporate default rate beside it as context",
      watch: "A range, not a series, from two dated moodys.com pages; the one-year expected probability of default is a different measure and is kept off this line. The speculative-grade rate is a different population.",
      definition: "The clearest public statement of how much the definition of default moves the private credit number.",
      interpretation: "The spread between the two figures is the exchange track: most 2025 defaults were restructurings rather than missed payments." },
    { key: "m6LoanIndex", label: "Loan index default rate, both tracks", subtitle: "TTM by issuer count, with and without distressed exchanges",
      formula: "Trailing-twelve-month default rate by issuer count in the Morningstar LSTA US Leveraged Loan Index, including distressed exchanges and payment defaults only, at the dates the PitchBook reports printed",
      watch: "Proprietary and dated: the points are the report dates, not a monthly series. About a quarter to a third of exchangers default again within three years, so the two tracks are not alternatives.",
      definition: "LCD's broader default measure on the liquid neighbor of private credit, split into the two tracks the 2023 report defined.",
      interpretation: "The gap between the tracks is the exchange track. Never sum them, and read the private proxies above with the same split." },
    { key: "m6Cliffwater", label: "Cliffwater Direct Lending Index", subtitle: "headline total return, income and PIK",
      formula: "Unlevered, gross-of-fees total return of US middle-market loans held by eligible BDCs, asset-weighted, as stated in Cliffwater's press releases; the calendar-year interest-income return and its PIK component",
      watch: "Headline points only, from releases Cliffwater began issuing in 2026; the growth-of-$1 history is not drawn. A half-year and a trailing-twelve-month figure share the same as-of date and are different windows.",
      definition: "The return the loans in BDC books earned before leverage and fees, as the index provider publishes it.",
      interpretation: "Interest carries the return and price is the volatile part; PIK inside the income figure is return not yet received in cash." },
    { key: "m6BankCi", label: "Bank C&I delinquency and charge-off", subtitle: "all commercial banks, quarterly",
      formula: "Delinquent business loans ÷ business loans, and annualized net charge-offs ÷ business loans, all US commercial banks, seasonally adjusted, from FRED (DRBLACBS, CORBLACBS)",
      watch: "Released with a lag of about two months and dated at the quarter's start on FRED; bank borrowers are larger and more diversified than the middle market, so the level is a floor, not a match.",
      definition: "How much of the bank-lent business-loan book is late, and how much banks are writing off.",
      interpretation: "A lagging proxy for defaults among the borrowers private credit also lends to. Rising delinquency with flat charge-offs means losses are ahead, not behind." },
    { key: "m6Statements", label: "Dated statements", subtitle: "counts and sector sizing from public releases",
      formula: "Counts read from a release page (Fitch's July 2026 peer review); the Fed Financial Stability Report and FSB sector-sizing statements when they are keyed into press-series.json",
      watch: "A statement is a dated sentence, not a series; nothing here is typed from memory, so a statement the edition does not carry says so instead.",
      definition: "What the regulators and rating agencies have said about the size and state of the sector, with the date they said it.",
      interpretation: "Read the counts as the agency's mood and the sizing as the denominator every default rate above is a share of." }
  ];
  if (CAT && typeof CAT.register === "function") CAT.register(ENTRIES);

  /* ---------- the LCD bucket labels ---------- */
  function bucketStart(c) {
    var s = String(c || "");
    if (/^(under|less than)/i.test(s)) return -1;
    var m = s.match(/^(\d+)/);
    return m ? Number(m[1]) : null;
  }
  function bucketShort(c) {
    var s = String(c || ""), m;
    if ((m = s.match(/^(?:under|less than)\s*(\d+)/i))) return "<" + m[1];
    if ((m = s.match(/^(\d+)\s*or higher/i))) return m[1] + "+";
    if ((m = s.match(/^(\d+)\s*-\s*(\d+)/))) return m[1];
    return s;
  }
  function bucketLong(c) {
    var s = String(c || ""), m;
    if ((m = s.match(/^(?:under|less than)\s*(\d+)/i))) return "under " + m[1] + " bps over base";
    if ((m = s.match(/^(\d+)\s*or higher/i))) return m[1] + " bps or more over base";
    if ((m = s.match(/^(\d+)\s*-\s*(\d+)/))) return m[1] + "–" + m[2] + " bps over base";
    return s;
  }
  /* the bucket with its unit for a caption whose band clause already
     says "over base": "450–499 bps", "800 bps or more", "under 450 bps" */
  function bucketName(c) {
    var s = String(c || ""), m;
    if ((m = s.match(/^(\d+)\s*-\s*(\d+)/))) return m[1] + "–" + m[2] + " bps";
    if ((m = s.match(/^(?:under|less than)\s*(\d+)/i))) return "under " + m[1] + " bps";
    if ((m = s.match(/^(\d+)\s*or higher/i))) return m[1] + " bps or more";
    return s;
  }

  /* ---------- the SVG small-multiple renderer ----------
     spec = { label, series: [{ label, color, points: [{ d, v, url, title,
       hollow, hatched, period }], line, dashed, width, range }], yfmt, zero,
       bands, hiPad }. Every point with a url is an SVG link, so the page
       it was read from is one click away; the title is the hover text.
     Dates place the points on a real time axis; a single date is centered. */
  var GOLD = "#f5c518", INK = "#8b8f98", LINE2 = "#b6bac2", LINE3 = "#6b6f78", GRID = "rgba(255,255,255,.08)", BAND = "rgba(255,255,255,.06)", HOLLOW = "#16181c";
  var svgSeq = 0;
  function svgSeries(spec) {
    var W = 320, H = 136, padL = 38, padR = 12, padT = 12, padB = 20;
    var iw = W - padL - padR, ih = H - padT - padB;
    var all = [];
    spec.series.forEach(function (s) { (s.points || []).forEach(function (p) { if (p && p.d && isNum(p.v)) all.push(p); }); });
    if (!all.length) return "";
    var ts = all.map(function (p) { return ms(p.d); }).filter(isNum);
    var t0 = Math.min.apply(null, ts), t1 = Math.max.apply(null, ts), tMax = t1;
    if (spec.from && ms(spec.from) < t0) t0 = ms(spec.from);
    if (t1 - t0 < 86400000 * 120) { var mid = (t0 + t1) / 2; t0 = mid - 86400000 * 200; t1 = mid + 86400000 * 200; }
    var span = t1 - t0; t0 -= span * 0.04; t1 += span * 0.06;
    var vals = all.map(function (p) { return p.v; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (spec.zero !== false) lo = Math.min(lo, 0);
    if (lo === hi) { lo -= 1; hi += 1; }
    var vs = hi - lo; hi += vs * (spec.hiPad || 0.12); if (lo < 0) lo -= vs * 0.06;
    var X = function (t) { return padL + ((t - t0) / (t1 - t0)) * iw; };
    var Y = function (v) { return padT + ih - ((v - lo) / (hi - lo)) * ih; };
    var yfmt = spec.yfmt || function (v) { return v.toFixed(1); };
    var id = "m6h" + (++svgSeq);
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='" + esc(spec.label || "") + "'>";
    out += "<defs><pattern id='" + id + "' patternUnits='userSpaceOnUse' width='4' height='4' patternTransform='rotate(45)'><rect width='4' height='4' fill='" + HOLLOW + "'/><rect width='1.6' height='4' fill='" + GOLD + "'/></pattern></defs>";
    /* recession bands from USREC */
    (spec.bands || []).forEach(function (b) {
      var a = ms(b.start), z = ms(b.end);
      if (!isNum(a) || !isNum(z) || z < t0 || a > t1) return;
      var x0 = X(Math.max(a, t0)), x1 = X(Math.min(z, t1));
      out += "<rect x='" + x0.toFixed(1) + "' y='" + padT + "' width='" + Math.max(2, x1 - x0).toFixed(1) + "' height='" + ih + "' fill='" + BAND + "'><title>Recession " + esc(b.start.slice(0, 7)) + " to " + esc(b.end.slice(0, 7)) + "</title></rect>";
    });
    /* three gridlines, labeled */
    [0.25, 0.5, 0.75].forEach(function (f) {
      var g = lo + (hi - lo) * f;
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + Y(g).toFixed(1) + "' y2='" + Y(g).toFixed(1) + "' stroke='" + GRID + "' stroke-width='1'/>" +
        "<text x='" + (padL - 5) + "' y='" + (Y(g) + 3).toFixed(1) + "' text-anchor='end' font-size='8.5' fill='" + INK + "'>" + esc(yfmt(g)) + "</text>";
    });
    if (lo < 0 && hi > 0) out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + Y(0).toFixed(1) + "' y2='" + Y(0).toFixed(1) + "' stroke='" + INK + "' stroke-width='.6'/>";
    /* year ticks */
    var y0 = new Date(t0).getUTCFullYear() + 1, y1 = new Date(t1).getUTCFullYear();
    var every = (y1 - y0) > 9 ? 2 : 1;
    /* year ticks stop at the last observation, so no year is labeled that
       the series never reaches */
    for (var y = y0; y <= y1; y++) {
      var tx = ms(y + "-01-01"); if (tx < t0 || tx > tMax) continue;
      out += "<line x1='" + X(tx).toFixed(1) + "' x2='" + X(tx).toFixed(1) + "' y1='" + (padT + ih) + "' y2='" + (padT + ih + 3) + "' stroke='" + INK + "' stroke-width='.6'/>";
      if ((y - y0) % every === 0) out += "<text x='" + X(tx).toFixed(1) + "' y='" + (H - 6) + "' text-anchor='middle' font-size='8.5' fill='" + INK + "'>" + y + "</text>";
    }
    out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + (padT + ih) + "' y2='" + (padT + ih) + "' stroke='" + GRID + "' stroke-width='1'/>";
    /* lines, then points on top */
    spec.series.forEach(function (s) {
      var pts = (s.points || []).filter(function (p) { return p && p.d && isNum(p.v); }).sort(function (a, b) { return ms(a.d) - ms(b.d); });
      if (!pts.length) return;
      var color = s.color || GOLD;
      if (s.range && pts.length >= 2) {
        var x = X(ms(pts[0].d));
        var vv = pts.map(function (p) { return p.v; });
        out += "<line x1='" + x.toFixed(1) + "' x2='" + x.toFixed(1) + "' y1='" + Y(Math.min.apply(null, vv)).toFixed(1) + "' y2='" + Y(Math.max.apply(null, vv)).toFixed(1) + "' stroke='" + color + "' stroke-width='2'/>";
      } else if (s.line !== false && pts.length > 1) {
        var d = "", pen = false;
        pts.forEach(function (p) { d += (pen ? "L" : "M") + X(ms(p.d)).toFixed(1) + " " + Y(p.v).toFixed(1) + " "; pen = true; });
        out += "<path d='" + d.trim() + "' fill='none' stroke='" + color + "' stroke-width='" + (s.width || 1.6) + "' stroke-linejoin='round'" + (s.dashed ? " stroke-dasharray='4 3'" : "") + "/>";
      }
    });
    spec.series.forEach(function (s) {
      var pts = (s.points || []).filter(function (p) { return p && p.d && isNum(p.v); }).sort(function (a, b) { return ms(a.d) - ms(b.d); });
      var color = s.color || GOLD;
      var showDots = s.dots !== false;
      pts.forEach(function (p, i) {
        var cx = X(ms(p.d)).toFixed(1), cy = Y(p.v).toFixed(1);
        var isLast = i === pts.length - 1;
        var r = s.line === false || s.range ? 3.2 : (isLast ? 3 : 2);
        var fill = p.hatched ? "url(#" + id + ")" : p.hollow ? HOLLOW : color;
        var title = (p.title || (s.label ? s.label + " " : "") + yfmt(p.v) + (p.period ? " · " + p.period : "")) + (p.url ? " · " + domainOf(p.url) : "");
        var body = "<circle cx='" + cx + "' cy='" + cy + "' r='7' fill='transparent'/>" +
          (showDots || isLast ? "<circle class='pt' cx='" + cx + "' cy='" + cy + "' r='" + r + "' fill='" + fill + "' stroke='" + color + "' stroke-width='1.2'/>" : "") +
          "<title>" + esc(title) + "</title>";
        if (p.url) out += "<a href='" + esc(p.url) + "' target='_blank' rel='noopener' aria-label='" + esc(title) + "'>" + body + "</a>";
        else out += "<g>" + body + "</g>";
        if (isLast && s.labelLast !== false && s.line !== false && !s.range) {
          var anchor = Number(cx) > W - padR - 40 ? "end" : "start", dx = anchor === "end" ? -6 : 6;
          out += "<text x='" + (Number(cx) + dx).toFixed(1) + "' y='" + (Number(cy) - 6).toFixed(1) + "' text-anchor='" + anchor + "' font-size='9' font-weight='600' fill='" + color + "'>" + esc(yfmt(p.v)) + "</text>";
        }
      });
      if (s.range && pts.length >= 2) {
        pts.forEach(function (p) {
          out += "<text x='" + (X(ms(p.d)) + 7).toFixed(1) + "' y='" + (Y(p.v) + 3).toFixed(1) + "' font-size='9' font-weight='600' fill='" + color + "'>" + esc(yfmt(p.v)) + "</text>";
        });
      }
    });
    return out + "</svg>";
  }

  /* a diagonal-stripe fill for a provisional bar on a Chart.js canvas */
  var hatchCache = {};
  function hatch(canvas, color) {
    if (!canvas || !canvas.getContext) return color;
    if (hatchCache[color]) return hatchCache[color];
    var tile = document.createElement("canvas"); tile.width = 6; tile.height = 6;
    var t = tile.getContext("2d");
    t.fillStyle = HOLLOW; t.fillRect(0, 0, 6, 6);
    t.strokeStyle = color; t.lineWidth = 1.6;
    t.beginPath(); t.moveTo(-1, 7); t.lineTo(7, -1); t.moveTo(-1, 1); t.lineTo(1, -1); t.moveTo(5, 7); t.lineTo(7, 5); t.stroke();
    var pat = canvas.getContext("2d").createPattern(tile, "repeat");
    hatchCache[color] = pat || color;
    return hatchCache[color];
  }

  /* ---------- rendering helpers ---------- */
  function h3(key, label, small) {
    return "<h3><span class='h-pop' data-metric='" + esc(key) + "'>" + esc(label) + "</span>" + (small ? "<small>" + esc(small) + "</small>" : "") + "</h3>";
  }
  function keyRow(items) {
    return "<p class='m6-key'>" + items.map(function (it) {
      return "<span><i class='" + esc(it.cls || "") + "' style='background:" + (it.color || GOLD) + ";color:" + (it.color || GOLD) + "'></i>" + esc(it.label) + "</span>";
    }).join("") + "</p>";
  }
  function panel(key, label, small, body, caption, foot) {
    return "<figure class='m6-panel'>" + h3(key, label, small) + body +
      (caption ? "<figcaption class='m6-caption'>" + caption + "</figcaption>" : "") +
      (foot ? "<p class='m6-foot'>" + foot + "</p>" : "") + "</figure>";
  }
  function emptyState(title, why) {
    return "<div class='m6-empty'><span>" + esc(title) + "</span>" + (why ? "<small>" + esc(why) + "</small>" : "") + "</div>";
  }
  function link(url, text) { return url ? "<a href='" + esc(url) + "' target='_blank' rel='noopener'>" + esc(text) + "</a>" : esc(text); }
  function pressFoot(S, keys, extra) {
    var parts = [], domains = [];
    keys.forEach(function (k) {
      var e = S.get(k); if (!e) return;
      (e.points || []).forEach(function (p) { if (p && p.url) domains.push(domainOf(p.url)); });
    });
    if (extra) parts.push(extra);
    domains = uniq(domains);
    if (domains.length) parts.push("read on " + domains.join(", ") + " (a link per point)");
    var st = S.stampOf(keys[0]);
    if (st) parts.push(st);
    return parts.map(esc).join(" · ");
  }
  /* the population's first clause; the ingest stores population to 200
     characters, so a clause cut mid-word is trimmed to its last whole word */
  function firstClause(s) {
    var str = String(s || ""), c = str.split(/[.;]/)[0];
    if (c === str && str.length >= 200) c = c.replace(/\s+\S*$/, "") + "…";
    return c;
  }
  /* LCD's BDC population as its own series states it ("over 100 BDC
     portfolios"), read off the population field through the loader's
     shared helper, never typed */
  function lcdN(S) {
    return typeof S.populationN === "function" ? S.populationN(S.has("lcd_bdc_all_in_rate_quarterly") ? "lcd_bdc_all_in_rate_quarterly" : "lcd_bdc_spread_dist_count_2q26") : "the BDC portfolios LCD tracks";
  }
  /* a series id in a footer is a hover term: its popup is the entry
     registerIds builds from the loader at mount */
  function idSpan(k) { return "<span class='st-id' data-metric='" + esc(k) + "'>" + esc(k) + "</span>"; }
  function idList(keys) { return keys.map(idSpan).join(", "); }
  /* the point's period the page prints, from the loader's formatter */
  function per(F, p) { return F.period(p); }
  function pointsWithUrl(S, key, opts) {
    return S.pointsOf(key, opts).filter(function (p) { return isNum(p.y); }).map(function (p) {
      /* a rolling window or a point the report marks provisional is hatched */
      return { d: p.x, v: p.y, url: p.url, period: per(S.fmt, p) + (S.isProvisional(p) ? " (provisional)" : ""), q: p.q, label: p.label, g: p.g,
        forecast: !!p.forecast, hollow: !!p.forecast, hatched: S.isRolling(p) || S.isProvisional(p), provisional: S.isProvisional(p) };
    });
  }
  function dedupe(pts) {
    var seen = {}, out = [];
    pts.forEach(function (p) { var id = p.d + "|" + p.v + "|" + String(p.q || "").split(",")[0]; if (seen[id]) return; seen[id] = true; out.push(p); });
    return out;
  }
  /* the newest point; an undated point (a composite row the refresh did
     not date) counts as the newest */
  function latestOf(pts) {
    var t = function (p) { var v = p.d ? ms(p.d) : NaN; return isNum(v) ? v : Infinity; };
    return pts.length ? pts.slice().sort(function (a, b) { return t(a) - t(b); })[pts.length - 1] : null;
  }

  /* ---------- the composite reader ---------- */
  /* the view's rows in date order; a row the refresh did not date sorts
     last and prints as the latest quarter (it has no place on a chart) */
  function compQuarters(comp) {
    var q = comp && Array.isArray(comp.quarters) ? comp.quarters.filter(Boolean) : [];
    return q.slice().sort(function (a, b) { return !a.p ? 1 : !b.p ? -1 : a.p < b.p ? -1 : a.p > b.p ? 1 : 0; });
  }
  function compSeries(comp, field) {
    return compQuarters(comp).filter(function (r) { return isNum(r[field]); }).map(function (r) {
      return { d: r.p || null, v: r[field], n: r.n, period: r.p ? "Q" + Math.ceil(Number(r.p.slice(5, 7)) / 3) + " " + r.p.slice(0, 4) : "latest quarter" };
    });
  }
  function compFoot(comp, pts, what) {
    var l = latestOf(pts);
    return "n = " + (l && isNum(l.n) ? l.n : (comp && isNum(comp.n) ? comp.n : "—")) + " listed BDCs · " + what + " · " + (pts.length === 1 ? "one observation (" + pts[0].period + ")" : pts.length + " quarters") +
      (comp && comp.asOf ? " · composite as of " + esc(comp.asOf) : "");
  }
  var COMPOSITE_EMPTY = "Composite after the holdings release";
  /* the caption clause for a composite slot that is still empty: the
     same words the deal-flow section prints for its D14 and D15 slots */
  var COMPOSITE_SLOT = "The site composite arrives with the holdings release; direction, not level.";

  /* ---------- section state ---------- */
  var state = { charts: [], m4Family: "all" };
  function destroyCharts() {
    state.charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* already gone */ } });
    state.charts = [];
  }

  /* ---------- panel 1: the price of private credit ---------- */
  function renderM1Dot(ctx) {
    var S = ctx.series, F = ctx.fmt;
    var lbo = S.pointsOf("lcd_dl_lbo_spread_recent").filter(function (p) { return isNum(p.y); });
    var pe = S.pointsOf("lcd_dl_pe_spread_recent").filter(function (p) { return isNum(p.y); });
    if (!lbo.length) {
      return { html: emptyState("Not in this edition", "lcd_dl_lbo_spread_recent carries no points."), caption: "", foot: esc(S.stamp("lcd-monitor")) };
    }
    var all = lbo.concat(pe).map(function (p) { return p.y; });
    var lo = Math.floor((Math.min.apply(null, all) - 15) / 25) * 25, hi = Math.ceil((Math.max.apply(null, all) + 15) / 25) * 25;
    var pos = function (v) { return (100 * (v - lo) / (hi - lo)).toFixed(2) + "%"; };
    var latestL = last(lbo), quartersL = lbo.filter(function (p) { return p.g === "quarter"; });
    /* the quarter a rolling window overlaps is the one its start month sits in */
    var overlapOf = function (p) { return F.quarter(p.start || p.x); };
    var row = function (label, pts) {
      var l = last(pts);
      var dots = pts.map(function (p, i) {
        var isLast = i === pts.length - 1;
        var cls = isLast ? (S.isRolling(p) ? "latest rolling" : "latest") : "prior";
        /* the prior quarters' tags alternate above and below the track so two close dots never share a label line */
        var tag = isLast ? "" : "<span class='dot-tag" + (i % 2 ? " below" : "") + "' style='left:" + pos(p.y) + "'>" + esc(F.quarterDeck(p.x)) + "</span>";
        return tag + "<b class='dot " + cls + "' style='left:" + pos(p.y) + "' title='" + esc(label + " " + F.bps(p.y) + " · " + F.period(p) + (S.isRolling(p) ? " (overlaps " + overlapOf(p) + ")" : "")) + "'></b>";
      }).join("");
      return "<div class='lcd-row'><span class='l-label'>" + esc(label) + "</span><span class='l-dots'>" + dots + "</span>" +
        "<span class='l-val'>" + (l ? bpsNum(l.y) + "<small> bps</small>" : "—") + "</span></div>";
    };
    var out = "<div class='lcd-dots pc-figure'>" + row("Direct-lending LBOs", lbo) + (pe.length ? row("PE-backed deals", pe) : "");
    out += "<div class='lcd-row scale'><span class='l-label'></span><span class='l-dots'>";
    for (var v = lo; v <= hi; v += 25) out += "<b style='left:" + pos(v) + "'><span>" + esc(withCommas(v)) + "</span></b>";
    out += "</span><span class='l-val'></span></div></div>";
    out += "<p class='lcd-key'><span><i class='hatch'></i>rolling three months, overlaps " + esc(overlapOf(latestL)) + "</span><span><i class='hollow'></i>the quarters before</span><span>bps over base</span></p>";
    /* the ladder's single-B rung (FRED, OAS over Treasuries, percent
       points) is the bond the blueprint sets this loan spread against */
    var singleB = ctx.fromCredit("BAMLH0A2HYB"), bBps = singleB ? singleB.latest.v * 100 : null;
    var bond = isNum(bBps) ? "about " + bpsNum(latestL.y - bBps) + " bps over single-B OAS at " + bpsNum(bBps)
      : "single-B OAS did not answer, so the bond comparison is not stated";
    var caption = "";
    if (S.isRolling(latestL) && quartersL.length >= 2) {
      var first = quartersL[0], prior = last(quartersL), peL = last(pe);
      caption = CAPTIONS.m1Lcd.template({
        lbo: bpsNum(latestL.y), window: F.period(latestL), firstV: bpsNum(first.y), first: F.quarter(first.x), priorV: bpsNum(prior.y), prior: F.quarter(prior.x),
        bond: bond, pe: peL ? bpsNum(peL.y) : "—", overlap: overlapOf(latestL)
      });
    } else {
      caption = "LCD's direct-lending LBO spread: " + F.bps(latestL.y) + " over base in " + F.period(latestL) + ", " + bond + ".";
    }
    var e = S.get("lcd_dl_lbo_spread_recent");
    var foot = "Population: " + esc(firstClause(e.population)) + " · " + idList(["lcd_dl_lbo_spread_recent", "lcd_dl_pe_spread_recent"]) + " · " + esc(S.stamp("lcd-monitor")) +
      (singleB ? " · single-B OAS: FRED BAMLH0A2HYB " + esc(singleB.latest.d) + ", over Treasuries" : "");
    return { html: out, caption: caption, foot: foot };
  }

  var FAMILIES = {
    all: { label: "All holdings", what: "loans", re: /^lcd_bdc_spread_dist_count_\dq\d\d$/ },
    unitranche: { label: "Unitranche", what: "unitranche loans", re: /^lcd_bdc_unitranche_spread_dist_count_/ },
    firstlien: { label: "First lien", what: "first-lien term loans", re: /^lcd_bdc_first_lien_spread_dist_count_/ }
  };
  function m4Snapshots(S, family) {
    var keys = S.keysOf("lcd-bdc").filter(function (k) { return FAMILIES[family].re.test(k); });
    var snaps = keys.map(function (k) { var s = S.snapshot(k); return s ? { key: k, p: s.p, items: s.items } : null; }).filter(Boolean);
    return snaps.sort(function (a, b) { return a.p < b.p ? -1 : a.p > b.p ? 1 : 0; });
  }
  function bandShare(items) {
    var t = 0, any = false;
    items.forEach(function (it) { var b = bucketStart(it.c); if ((b === 450 || b === 500) && isNum(it.v)) { t += it.v; any = true; } });
    return any ? t : null;
  }
  function modalOf(items) {
    var best = null;
    items.forEach(function (it) { if (isNum(it.v) && (!best || it.v > best.v)) best = it; });
    return best;
  }
  function shareOf(items, c) { var s = bucketStart(c), hit = null; items.forEach(function (it) { if (bucketStart(it.c) === s) hit = it; }); return hit ? hit.v : null; }
  function renderM4(ctx, host) {
    var S = ctx.series, F = ctx.fmt, family = state.m4Family, fam = FAMILIES[family];
    var chartHost = host.querySelector("#st-m4-chart"), cap = host.querySelector("#st-m4-caption"), ft = host.querySelector("#st-m4-foot"), lg = host.querySelector("#st-m4-legend");
    var snaps = m4Snapshots(S, family);
    ctx.chart.empty(chartHost, null);
    if (!snaps.length) {
      ctx.chart.empty(chartHost, "Not in this edition: no " + fam.label.toLowerCase() + " spread snapshot in the lcd-bdc group.");
      cap.textContent = ""; ft.textContent = S.stamp("lcd-monitor"); lg.innerHTML = "";
      return;
    }
    var latest = last(snaps), earliest = snaps[0];
    var cats = latest.items.map(function (it) { return it.c; });
    var labels = cats.map(bucketShort);
    var modal = modalOf(latest.items);
    var shades = ["rgba(255,255,255,.16)", "rgba(255,255,255,.26)", "rgba(255,255,255,.38)"];
    /* the latest snapshot is hatched when the monitor marks it provisional */
    var canvas = chartHost.querySelector("canvas");
    var provisional = S.pointsOf(latest.key).some(function (p) { return S.isProvisional(p); });
    var datasets = snaps.map(function (s, i) {
      var isLast = i === snaps.length - 1;
      var data = cats.map(function (c) { var v = shareOf(s.items, c); return isNum(v) ? v * 100 : null; });
      var colors = isLast ? cats.map(function (c) { var col = modal && bucketStart(c) === bucketStart(modal.c) ? GOLD : LINE2; return provisional ? hatch(canvas, col) : col; })
        : shades[Math.max(0, i - (snaps.length - 1 - shades.length))] || shades[0];
      return { label: F.quarterDeck(s.p) + (isLast && provisional ? " (provisional)" : ""), data: data, backgroundColor: colors, borderWidth: 0, borderRadius: 2, categoryPercentage: 0.82, barPercentage: 0.9 };
    });
    /* the site composite's histogram by count, from the view credit.js
       builds ([{label, share}]), read into the bucket shape LCD's
       snapshots use ({c, v}) so the same band and modal helpers apply */
    var comp = ctx.composite, compHist = comp && comp.histogram && Array.isArray(comp.histogram.byCount) && comp.histogram.byCount.length ? comp.histogram : null;
    var siteBand = null, siteN = null;
    if (family === "all" && compHist) {
      var items = compHist.byCount.filter(function (it) { return it && isNum(it.share); }).map(function (it) { return { c: it.label, v: it.share }; });
      siteBand = bandShare(items); siteN = isNum(compHist.n) ? compHist.n : (isNum(comp.n) ? comp.n : null);
      datasets.push({ label: "site composite " + (compHist.p ? F.quarterDeck(compHist.p) : ""), data: cats.map(function (c) { var v = shareOf(items, c); return isNum(v) ? v * 100 : null; }),
        backgroundColor: "transparent", borderColor: "#e8eaed", borderWidth: 1.5, borderRadius: 2, categoryPercentage: 0.82, barPercentage: 0.9 });
    }
    var yfmt = function (v) { return isNum(v) ? v.toFixed(0) + "%" : "—"; };
    var opt = ctx.chart.baseOptions(labels, yfmt, "share of " + fam.what + " by count");
    opt.scales.x.ticks.callback = function (val, idx) { return labels[idx]; };
    opt.scales.x.ticks.maxRotation = 50;
    opt.scales.y.beginAtZero = true;
    opt.plugins.tooltip.callbacks.title = function (items) { return items.length ? bucketLong(cats[items[0].dataIndex]) : ""; };
    opt.plugins.tooltip.callbacks.label = function (item) { return " " + item.dataset.label + " " + (isNum(item.parsed.y) ? item.parsed.y.toFixed(1) + "%" : "—"); };
    var c = ctx.chart.make(canvas, { type: "bar", data: { labels: labels, datasets: datasets }, options: opt });
    if (c) state.charts.push(c);
    lg.innerHTML = snaps.map(function (s, i) {
      var isLast = i === snaps.length - 1;
      var color = isLast ? LINE2 : shades[Math.max(0, i - (snaps.length - 1 - shades.length))] || shades[0];
      var hatched = isLast && provisional;
      return "<span><i class='fill" + (hatched ? " hatch" : "") + "' style='" + (hatched ? "color:" : "background:") + color + "'></i>" + esc(F.quarterDeck(s.p)) + (isLast ? (provisional ? " (latest, provisional)" : " (latest)") : "") + "</span>";
    }).join("") + "<span><i class='fill' style='background:" + GOLD + "'></i>modal bucket</span>" +
      (family === "all" ? "<span><i class='outline'></i>" + (compHist ? "site composite (outline)" : "site composite: after the holdings release") + "</span>" : "");
    var band = bandShare(latest.items), prior = bandShare(earliest.items), modalPrior = modal ? shareOf(earliest.items, modal.c) : null;
    /* the population caveat is stated wherever the composite slot exists,
       in the words the deal-flow section uses for the same slot */
    var site = family !== "all" ? "The site composite is compared on all holdings. Direction, not level."
      : compHist && isNum(siteBand) ? "The site's " + (isNum(siteN) ? siteN : "—") + " listed BDCs hold " + pctNum(siteBand * 100) + "%. Direction, not level."
      : COMPOSITE_SLOT;
    cap.textContent = CAPTIONS.m4.template({ band: pctNum(band * 100), what: fam.what, prior: pctNum(prior * 100), priorQ: F.quarterDeck(earliest.p),
      modal: modal ? bucketName(modal.c) : "—", modalShare: modal ? pctNum(modal.v * 100) : "—", modalPrior: pctNum(modalPrior * 100), site: site });
    var e = S.get(latest.key);
    ft.innerHTML = "Population: " + esc(firstClause(e.population)) + " · " + snaps.length + " snapshots, " + esc(F.quarterDeck(earliest.p)) + " to " + esc(F.quarterDeck(latest.p)) + " · " +
      idList(snaps.map(function (s) { return s.key; })) + " · " + esc(S.stamp("lcd-monitor"));
  }

  function renderM5(ctx, host) {
    var S = ctx.series, F = ctx.fmt;
    var chartHost = host.querySelector("#st-m5-chart"), cap = host.querySelector("#st-m5-caption"), ft = host.querySelector("#st-m5-foot"), lg = host.querySelector("#st-m5-legend"), slot = host.querySelector("#st-m5-slot");
    var key = "lcd_bdc_all_in_rate_quarterly";
    var lcd = S.pointsOf(key, { grain: "quarter" }).filter(function (p) { return isNum(p.y); });
    if (!lcd.length) {
      ctx.chart.empty(chartHost, "Not in this edition: " + key + " carries no points.");
      cap.textContent = ""; ft.textContent = S.stamp("lcd-monitor"); lg.innerHTML = ""; slot.hidden = true;
      return;
    }
    ctx.chart.empty(chartHost, null);
    var labels = lcd.map(function (p) { return p.x.slice(0, 7); });
    /* loans reset on term SOFR, which FRED does not carry; the 90-day
       average stands in for it (the blueprint's 3.2 reference), the
       overnight rate is the fallback when the average did not answer */
    var sofrId = ctx.fromCredit("SOFR90DAYAVG") ? "SOFR90DAYAVG" : "SOFR", sofr = ctx.fromCredit(sofrId);
    var sofrName = sofrId === "SOFR90DAYAVG" ? "90-day SOFR" : "overnight SOFR";
    var sofrBy = {}; ((sofr && sofr.history) || []).forEach(function (h) { sofrBy[String(h.d).slice(0, 7)] = h.v; });
    var sofrData = labels.map(function (k) { return isNum(sofrBy[k]) ? sofrBy[k] : null; });
    var comp = ctx.composite, base = compSeries(comp, "baseRate"), allIn = compSeries(comp, "allInYield"), spread = compSeries(comp, "spreadOverBase");
    var byD = function (pts) { var o = {}; pts.forEach(function (p) { if (p.d) o[p.d.slice(0, 7)] = p.v * 100; }); return labels.map(function (k) { return isNum(o[k]) ? o[k] : null; }); };
    var datasets = [];
    var haveStack = base.length && allIn.length;
    if (haveStack) {
      datasets.push({ label: "composite base rate", data: byD(base), borderColor: LINE3, backgroundColor: "rgba(255,255,255,.10)", borderWidth: 1, pointRadius: 0, pointHitRadius: 10, fill: "origin", tension: 0, spanGaps: false });
      datasets.push({ label: "composite all-in yield (base + spread)", data: byD(allIn), borderColor: "#e8eaed", backgroundColor: "rgba(245,197,24,.18)", borderWidth: 1.5, pointRadius: 0, pointHitRadius: 10, fill: "-1", tension: 0, spanGaps: false });
    }
    datasets.push({ label: "LCD all-in rate, BDC-held loans", data: lcd.map(function (p) { return p.y; }), borderColor: GOLD, backgroundColor: GOLD, borderWidth: 2, pointRadius: 2, pointHitRadius: 10, tension: 0, spanGaps: false });
    datasets.push({ label: sofrName + " at quarter end", data: sofrData, borderColor: LINE2, backgroundColor: LINE2, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, pointHitRadius: 10, tension: 0, spanGaps: false });
    var yfmt = function (v) { return isNum(v) ? v.toFixed(1) + "%" : "—"; };
    var opt = ctx.chart.baseOptions(labels, yfmt, "percent");
    opt.scales.x.ticks.callback = function (val, idx) { return /-03$/.test(labels[idx]) ? labels[idx].slice(0, 4) : null; };
    opt.plugins.tooltip.callbacks.title = function (items) { return items.length ? F.quarter(lcd[items[0].dataIndex].x) : ""; };
    opt.scales.y.beginAtZero = true;
    var canvas = chartHost.querySelector("canvas");
    var c = ctx.chart.make(canvas, { type: "line", data: { labels: labels, datasets: datasets }, options: opt, plugins: [ctx.usrec.plugin(labels)] });
    if (c) state.charts.push(c);
    lg.innerHTML = (haveStack ? "<span><i class='fill' style='background:rgba(255,255,255,.22)'></i>composite base rate</span><span><i class='fill' style='background:rgba(245,197,24,.35)'></i>composite spread (to all-in)</span>" : "") +
      "<span><i style='background:" + GOLD + "'></i>LCD all-in rate (BDC-held loans)</span><span><i class='dash' style='color:" + LINE2 + ";background:" + LINE2 + "'></i>" + esc(sofrName) + " at quarter end" + (sofr ? "" : " (not available)") + "</span>";
    slot.hidden = !!haveStack;
    var l = last(lcd), prior = lcd.length > 1 ? lcd[lcd.length - 2] : null;
    var peak = lcd.reduce(function (a, p) { return !a || p.y > a.y ? p : a; }, null);
    var sofrEnd = sofrBy[l.x.slice(0, 7)];
    var lA = last(allIn), lB = last(base), lSp = last(spread);
    if (haveStack && lA && lB) {
      cap.textContent = CAPTIONS.m5composite.template({ allIn: pct(lA.v * 100, 2), base: pct(lB.v * 100, 2), spread: lSp ? bpsNum(lSp.v * 10000) : bpsNum((lA.v - lB.v) * 10000),
        q: lA.period, n: isNum(lA.n) ? withCommas(lA.n) : "—", lcd: pct(l.y, 2), lcdQ: F.quarter(l.x) });
    } else {
      cap.textContent = CAPTIONS.m5.template({ v: pct(l.y, 2), q: F.quarter(l.x), prior: prior ? pct(prior.y, 2) : "—", priorQ: prior ? F.quarter(prior.x) : "—",
        peak: pct(peak.y, 2), peakQ: F.quarter(peak.x),
        gap: isNum(sofrEnd) ? (l.y - sofrEnd).toFixed(2) : "—", base: sofrName, sofr: isNum(sofrEnd) ? pct(sofrEnd, 2) : "—",
        site: COMPOSITE_SLOT });
    }
    var e = S.get(key);
    ft.innerHTML = "n: " + esc(lcdN(S)) + " · population: " + esc(firstClause(e.population)) + " · " + lcd.length + " quarters, " + esc(F.quarter(lcd[0].x)) + " to " + esc(F.quarter(l.x)) +
      " · " + idSpan(key) + " · " + esc(S.stamp("lcd-monitor")) + " · " + esc(sofrName + ": FRED " + sofrId + (sofr && sofr.latest ? " " + sofr.latest.d + ", month-end value of the quarter's last month" : ", not available")) + " · recessions from FRED USREC" +
      (haveStack ? " · composite n = " + esc(isNum(lA.n) ? lA.n : "—") : "");
  }

  function pricePanel(ctx) {
    var S = ctx.series, m1 = renderM1Dot(ctx);
    return "<section class='panel-card fsa-section' id='st-price' aria-labelledby='h-st-price'>" +
      "<div class='section-head'><h2 id='h-st-price'><span class='h-pop' data-metric='pcPriceLcd'>The price of private credit — LCD's series</span></h2>" +
      "<p class='section-blurb'>The three LCD series that complete the spread ladder and the yield stack above: what a new direct-lending buyout loan pays over base, where the loans BDCs already hold are priced, and the all-in rate those loans earn.</p>" +
      "<details class='how-to-read'><summary>How to read this</summary><p>The M1 dot is the new-issue direct-lending LBO spread in the monitor's three windows — Q1, Q2 and the rolling three months, which overlaps the last quarter and is hatched for that reason. The spread histogram is the same market one step later: LCD's four quarterly snapshots of BDC holdings by 50 bps bucket over base, by count, with one modal bucket in accent and the site's composite drawn as an outline once the holdings are parsed. The yield decomposition carries LCD's cost-weighted all-in rate on BDC-held loans beside the SOFR 90-day average at quarter end, so the distance between the two lines is the spread the book earns; the composite's base-plus-spread stack joins it with the holdings release. LCD covers " + esc(lcdN(S)) + ", which implies non-listed funds, and the site composite is the listed universe: wherever the two meet the caption says direction, not level. Bonds on the ladder above are priced over Treasuries; every loan figure here is over a floating base.</p></details></div>" +
      "<div class='pc-sub'>" + h3("m1LcdLboSpread", "New-issue direct-lending LBO spread", "M1 reference") + m1.html +
      "<p class='chart-caption' id='st-m1-caption'>" + esc(m1.caption) + "</p><p class='tile-foot' id='st-m1-foot'>" + m1.foot + "</p></div>" +
      "<div class='pc-sub'>" + h3("m4SpreadHistogram", "Spread histogram — BDC holdings by bucket over base", "M4") +
      "<div class='chart-controls'><div class='seg' role='group' aria-label='Holdings shown'>" +
      Object.keys(FAMILIES).map(function (f) { return "<button type='button' data-family='" + f + "' aria-pressed='" + (state.m4Family === f) + "'>" + esc(FAMILIES[f].label) + "</button>"; }).join("") +
      "</div><span class='chart-legend' id='st-m4-legend'></span></div>" +
      "<div class='chart-box' id='st-m4-chart'><canvas role='img' aria-label='BDC holdings spread distribution by 50 bps bucket over base, four quarterly snapshots'></canvas></div>" +
      "<p class='chart-caption' id='st-m4-caption'></p><p class='tile-foot' id='st-m4-foot'></p></div>" +
      "<div class='pc-sub'>" + h3("m5YieldDecomposition", "Yield decomposition — LCD's all-in rate beside the base rate", "M5") +
      "<div class='chart-controls'><span class='chart-legend' id='st-m5-legend'></span></div>" +
      "<div class='chart-box' id='st-m5-chart'><canvas role='img' aria-label='LCD cost-weighted all-in rate on BDC-held loans, quarterly, beside the SOFR 90-day average at quarter end'></canvas></div>" +
      "<p class='pc-slot' id='st-m5-slot'>Base rate + spread = all-in, from the site's composite: after the holdings release</p>" +
      "<p class='chart-caption' id='st-m5-caption'></p><p class='tile-foot' id='st-m5-foot'></p></div>" +
      "</section>";
  }

  /* ---------- panel 2: stress and defaults (M6) ---------- */
  function compositePanel(ctx, key, label, small, field, what, captionFn, formulaNote) {
    var comp = ctx.composite, pts = compSeries(comp, field);
    if (!pts.length) {
      return panel(key, label, small, emptyState(COMPOSITE_EMPTY, formulaNote), "", "n stated when computed · " + esc(what));
    }
    var l = latestOf(pts);
    var body = "<div class='m6-value'>" + esc(captionFn.value(l, pts)) + "</div>" +
      "<div class='m6-chart'>" + svgSeries({ label: label, series: captionFn.series(pts), yfmt: captionFn.yfmt, zero: captionFn.zero !== false }) + "</div>";
    return panel(key, label, small, body, esc(captionFn.caption(l, pts)), compFoot(comp, pts, what));
  }

  function m6Composite(ctx) {
    var comp = ctx.composite, out = "";
    /* non-accrual, both bases */
    var na = compSeries(comp, "nonAccrualCost"), naFv = compSeries(comp, "nonAccrualFv"), naD = compSeries(comp, "nonAccrualDebtCost"), naDFv = compSeries(comp, "nonAccrualDebtFv");
    var pf = function (v) { return isNum(v) ? (v * 100).toFixed(1) + "%" : "—"; };
    if (na.length) {
      var l = latestOf(na), lFv = latestOf(naFv), lD = latestOf(naD), lDFv = latestOf(naDFv);
      out += panel("m6NonAccrual", "Composite non-accrual rate", "of investments; at cost and at fair value",
        "<div class='m6-value'>" + esc(pf(l.v)) + "<span class='unit'> at cost</span><span class='second'>" + esc(lFv ? pf(lFv.v) : "—") + " at FV</span></div>" +
        "<div class='m6-chart'>" + svgSeries({ label: "Composite non-accrual rate", yfmt: function (v) { return (v * 100).toFixed(1) + "%"; }, series: [
          { label: "at cost", color: GOLD, points: na }, { label: "at fair value", color: LINE2, dashed: true, points: naFv },
          { label: "of debt, at cost", color: LINE3, points: naD, dots: false }] }) + "</div>" +
        keyRow([{ label: "at cost", color: GOLD }, { label: "at fair value", color: LINE2, cls: "dash" }, { label: "of debt investments, at cost", color: LINE3 }]),
        esc(CAPTIONS.m6NonAccrual.template({ cost: pf(l.v), fv: lFv ? pf(lFv.v) : "—", q: l.period, n: isNum(l.n) ? l.n : (isNum(comp.n) ? comp.n : "—"), debtCost: lD ? pf(lD.v) : "—", debtFv: lDFv ? pf(lDFv.v) : "—" })),
        compFoot(comp, na, "schedule footnotes, non-accrual cost and fair value ÷ totals"));
    } else {
      out += panel("m6NonAccrual", "Composite non-accrual rate", "of investments; at cost and at fair value",
        emptyState(COMPOSITE_EMPTY, "Σ cost (and fair value) of investments on non-accrual ÷ Σ total investments, from the schedules of investments; a second pair over debt investments only; n stated when computed."),
        "", "n stated when computed · schedule footnotes");
    }
    /* PIK, both ratios */
    var pi = compSeries(comp, "pikShareOfInterest"), pt = compSeries(comp, "pikShareOfTotal");
    if (pi.length || pt.length) {
      var lp = latestOf(pi.length ? pi : pt), lt = latestOf(pt);
      out += panel("m6PikShare", "Composite PIK share", "of interest; of total investment income",
        "<div class='m6-value'>" + esc(pi.length ? pf(latestOf(pi).v) : "—") + "<span class='unit'> of interest</span><span class='second'>" + esc(lt ? pf(lt.v) : "—") + " of income</span></div>" +
        "<div class='m6-chart'>" + svgSeries({ label: "Composite PIK share", yfmt: function (v) { return (v * 100).toFixed(1) + "%"; }, series: [
          { label: "of interest", color: GOLD, points: pi }, { label: "of total investment income", color: LINE2, dashed: true, points: pt }] }) + "</div>" +
        keyRow([{ label: "PIK ÷ (cash + PIK interest)", color: GOLD }, { label: "PIK income ÷ total investment income", color: LINE2, cls: "dash" }]),
        esc(CAPTIONS.m6Pik.template({ interest: pi.length ? pf(latestOf(pi).v) : "—", income: lt ? pf(lt.v) : "—", q: lp.period, n: isNum(lp.n) ? lp.n : (isNum(comp.n) ? comp.n : "—") })),
        compFoot(comp, pi.length ? pi : pt, "companyfacts income tags differenced from year-to-date"));
    } else {
      out += panel("m6PikShare", "Composite PIK share", "of interest; of total investment income",
        emptyState(COMPOSITE_EMPTY, "Σ PIK interest ÷ Σ (cash interest + PIK interest), and Σ PIK income ÷ Σ total investment income, from companyfacts; n stated when computed."),
        "", "n stated when computed · companyfacts");
    }
    /* the mark */
    var mk = compSeries(comp, "fvOverCost");
    if (mk.length) {
      var lm = latestOf(mk), pm = mk.length > 1 ? mk[mk.length - 2] : null;
      out += panel("m6Mark", "Composite mark", "fair value ÷ cost",
        "<div class='m6-value'>" + esc(lm.v.toFixed(3)) + "<span class='unit'> FV/cost</span></div>" +
        "<div class='m6-chart'>" + svgSeries({ label: "Composite mark", yfmt: function (v) { return v.toFixed(2); }, zero: false, series: [{ label: "FV/cost", color: GOLD, points: mk }] }) + "</div>",
        esc(CAPTIONS.m6Mark.template({ mark: lm.v.toFixed(3), q: lm.period, n: isNum(lm.n) ? lm.n : (isNum(comp.n) ? comp.n : "—"), dir: pm ? (lm.v >= pm.v ? "up from" : "down from") : "", prior: pm ? pm.v.toFixed(3) : null })),
        compFoot(comp, mk, "Σ InvestmentOwnedAtFairValue ÷ Σ InvestmentOwnedAtCost"));
    } else {
      out += panel("m6Mark", "Composite mark", "fair value ÷ cost",
        emptyState(COMPOSITE_EMPTY, "Σ investments at fair value ÷ Σ investments at amortized cost across the listed BDCs, from companyfacts; n stated when computed."),
        "", "n stated when computed · companyfacts");
    }
    /* distressed share with the loan-index reference dots */
    var S = ctx.series, F = ctx.fmt;
    var ds = compSeries(comp, "distressedShare");
    var ref = pointsWithUrl(S, "lcd_distressed_ratio_and_volume");
    var refL = latestOf(ref), refPeak = ref.reduce(function (a, p) { return !a || p.v > a.v ? p : a; }, null);
    var series = [];
    if (ds.length) series.push({ label: "composite, under 0.80", color: GOLD, points: ds.map(function (p) { return { d: p.d, v: p.v * 100, period: p.period }; }) });
    if (ref.length) series.push({ label: "loan index, priced under 80 (LCD)", color: LINE2, line: false, points: ref });
    var siteText = ds.length ? "The composite holds " + pf(latestOf(ds).v) + " of third-party debt cost under 0.80 (" + latestOf(ds).period + ", n = " + (isNum(latestOf(ds).n) ? latestOf(ds).n : (isNum(comp.n) ? comp.n : "—")) + "). " : "";
    var dBody = (ds.length ? "<div class='m6-value'>" + esc(pf(latestOf(ds).v)) + "<span class='unit'> of debt cost under 0.80</span></div>" : "<p class='pc-slot'>" + esc(COMPOSITE_EMPTY) + ": cost of third-party debt with FV/cost under 0.80 ÷ cost of third-party debt</p>") +
      (series.length ? "<div class='m6-chart'>" + svgSeries({ label: "Distressed share", yfmt: function (v) { return v.toFixed(1) + "%"; }, series: series }) + "</div>" +
        keyRow((ds.length ? [{ label: "composite, under 0.80", color: GOLD }] : []).concat(ref.length ? [{ label: "loan index priced under 80, dated points", color: LINE2, cls: "dot" }] : [])) : "");
    var dCap = refL && refPeak ? CAPTIONS.m6Distressed.template({ site: siteText, v: pct(refL.v), label: F.date(refL.d), peak: pct(refPeak.v), peakLabel: F.date(refPeak.d) }) : siteText;
    var dFoot = (ds.length ? compFoot(comp, ds, "per-holding FV ÷ cost") + " · " : "n stated when computed · ") +
      (ref.length ? "loan index: " + esc(firstClause(S.get("lcd_distressed_ratio_and_volume").population)) + ", " + ref.length + " dated points · " + esc(S.stampOf("lcd_distressed_ratio_and_volume")) : "");
    out += panel("m6Distressed", "Distressed share", "FV/cost under 0.80; the loan index's under-80 ratio", dBody, esc(dCap), dFoot);
    return out;
  }

  function m6Proskauer(ctx) {
    var S = ctx.series, F = ctx.fmt;
    var overall = pointsWithUrl(S, "proskauer_pcdi_overall");
    if (!overall.length) return panel("m6Proskauer", "Proskauer Private Credit Default Index", "", emptyState("Not in this edition", "proskauer_pcdi_overall carries no points."), "", pressFoot(S, ["proskauer_pcdi_overall"]));
    var lt25 = pointsWithUrl(S, "proskauer_pcdi_ebitda_lt25"), mid = pointsWithUrl(S, "proskauer_pcdi_ebitda_25_50"), ge50 = pointsWithUrl(S, "proskauer_pcdi_ebitda_ge50");
    var count = pointsWithUrl(S, "proskauer_pcdi_loan_count"), principal = pointsWithUrl(S, "proskauer_pcdi_principal");
    var sp = pointsWithUrl(S, "sp_spec_grade_default_vs_proskauer");
    var l = latestOf(overall), prior = overall.length > 1 ? overall[overall.length - 2] : null;
    var atL = function (pts) { var hit = null; pts.forEach(function (p) { if (p.d === l.d) hit = p; }); return hit || latestOf(pts); };
    var lc = atL(count), lp = atL(principal), b1 = atL(lt25), b2 = atL(mid), b3 = atL(ge50);
    var yfmt = function (v) { return v.toFixed(1) + "%"; };
    var body = "<div class='m6-value'>" + esc(pct(l.v, 2)) + "<span class='unit'> of active loans, " + esc(l.period) + "</span></div>" +
      "<div class='m6-chart'>" + svgSeries({ label: "Proskauer Private Credit Default Index", yfmt: yfmt, series: [
        { label: "EBITDA under $25M", color: LINE3, points: lt25, width: 1, dots: false, labelLast: false },
        { label: "EBITDA $25–49.9M", color: LINE3, points: mid, width: 1, dashed: true, dots: false, labelLast: false },
        { label: "EBITDA $50M and over", color: LINE2, points: ge50, width: 1, dots: false, labelLast: false },
        { label: "overall", color: GOLD, points: overall, width: 2 },
        { label: "S&P speculative-grade rate (context)", color: INK, line: false, points: sp.map(function (p) { return { d: p.d, v: p.v, url: p.url, period: p.period, hollow: true }; }) }
      ] }) + "</div>" +
      keyRow([{ label: "overall", color: GOLD }, { label: "EBITDA $50M+", color: LINE2 }, { label: "under $25M", color: LINE3 }, { label: "$25–49.9M", color: LINE3, cls: "dash" }].concat(sp.length ? [{ label: "S&P speculative-grade, one point", color: INK, cls: "dot hollow" }] : []));
    var cap = CAPTIONS.m6Proskauer.template({ v: pct(l.v, 2), q: l.period, n: lc ? withCommas(Math.round(lc.v)) : "—", principal: lp ? lp.v.toFixed(1) : "—",
      prior: prior ? pct(prior.v, 2) : "—", priorQ: prior ? prior.period : "—", lt25: b1 ? pct(b1.v) : "—", mid: b2 ? pct(b2.v) : "—", ge50: b3 ? pct(b3.v) : "—" });
    var foot = "n = " + (lc ? withCommas(Math.round(lc.v)) + " active loans" : "—") + (lp ? ", $" + lp.v.toFixed(1) + "B original principal" : "") + " (" + l.period + ") · " + overall.length + " quarterly points, " + overall[0].period + " to " + l.period +
      " · " + pressFoot(S, ["proskauer_pcdi_overall", "proskauer_pcdi_ebitda_lt25", "proskauer_pcdi_ebitda_25_50", "proskauer_pcdi_ebitda_ge50"]);
    return panel("m6Proskauer", "Proskauer Private Credit Default Index", "quarterly, with EBITDA bands", body, esc(cap), foot);
  }

  function m6Kbra(ctx) {
    var S = ctx.series, F = ctx.fmt;
    var e = S.get("kbra_dld_ttm_default_rate");
    if (!e) return panel("m6Kbra", "KBRA DLD direct-lending default rate", "", emptyState("Not in this edition", "kbra_dld_ttm_default_rate is not in the press group."), "", "");
    var actual = dedupe(pointsWithUrl(S, "kbra_dld_ttm_default_rate"));
    var undated = S.pointsOf("kbra_dld_ttm_default_rate", { withLabels: true }).filter(function (p) { return !p.x && isNum(p.y); });
    var fc = dedupe(pointsWithUrl(S, "kbra_dld_default_forecasts")).map(function (p) { p.hollow = true; return p; });
    var qual = function (p) { return p.q ? String(p.q) : ""; };
    var yfmt = function (v) { return v.toFixed(1) + "%"; };
    var head = undated.length ? undated[0] : null;
    var latestA = latestOf(actual);
    var body = "<div class='m6-value'>" + (head ? esc(pct(head.y)) + "<span class='unit'> of issuers, " + esc(head.label || "undated") + "</span>" : latestA ? esc(pct(latestA.v)) + "<span class='unit'> " + esc(latestA.period) + "</span>" : "—") + "</div>" +
      "<div class='m6-chart'>" + svgSeries({ label: "KBRA DLD direct lending default rate", yfmt: yfmt, series: [
        { label: "TTM default rate (headline)", color: GOLD, line: false, points: actual.map(function (p) { return { d: p.d, v: p.v, url: p.url, period: p.period + (qual(p) ? " (" + qual(p) + ")" : ""), hollow: false }; }) },
        { label: "forecast", color: LINE2, line: false, points: fc.map(function (p) { return { d: p.d, v: p.v, url: p.url, period: p.period + (qual(p) ? " (" + qual(p) + ")" : ""), hollow: true }; }) }
      ] }) + "</div>" +
      keyRow([{ label: "actual (weighting per point)", color: GOLD, cls: "dot" }, { label: "forecast, hollow", color: LINE2, cls: "dot hollow" }]);
    /* the caption: the undated headline, the latest full year, the newest forecast for the coming year */
    var yearPts = actual.filter(function (p) { return p.g === "year"; }), ly = latestOf(yearPts);
    var fcSorted = fc.slice().sort(function (a, b) { return ms(a.d) - ms(b.d); }), lf = last(fcSorted);
    /* the forecast for the newest year, by issuer count where the release gives one */
    if (lf) { var sameYear = fcSorted.filter(function (p) { return p.d.slice(0, 4) === lf.d.slice(0, 4); }); lf = sameYear.filter(function (p) { return /count/i.test(qual(p)); })[0] || lf; }
    var plain = function (q) { return String(q || "").replace(/^forecast\s*/i, "").replace(/^\((.*)\)$/, "$1"); };
    /* every point of the latest year, each with its weighting, in the order the file carries them */
    var yearLine = ly ? yearPts.filter(function (p) { return p.d === ly.d; }).map(function (p) { return pct(p.v) + " (" + (qual(p) || "as quoted") + ")"; }).join(", ") : "";
    var cap = head && ly && lf ? CAPTIONS.m6Kbra.template({ head: pct(head.y), headLabel: head.label || "undated", year: ly.d.slice(0, 4), yearLine: yearLine,
      fy: lf.d.slice(0, 4), f: pct(lf.v), fq: plain(qual(lf)) || "as quoted" })
      : latestA ? "KBRA DLD: " + pct(latestA.v) + " (" + latestA.period + (qual(latestA) ? ", " + qual(latestA) : "") + ")." : "";
    var foot = "population: " + esc(firstClause(e.population)) + (head ? " · undated headline listed, not plotted: " + link(head.url, (head.label || "") + " " + pct(head.y)) : "") +
      " · " + pressFoot(S, ["kbra_dld_ttm_default_rate", "kbra_dld_default_forecasts"]);
    return panel("m6Kbra", "KBRA DLD direct-lending default rate", "trailing twelve months, headlines", body, esc(cap), foot);
  }

  /* where the newest Fitch composite point sits in its own history:
     "the high of its 7 points", "under its high of 6.0%" — computed, so
     the leverage caption below can read the two together */
  function fitchHigh(pts) {
    if (!pts.length) return "";
    var l = latestOf(pts), top = pts.reduce(function (a, p) { return !a || p.v > a.v ? p : a; }, null);
    return l.v >= top.v ? "the high of its " + pts.length + " points" : "under its high of " + pct(top.v) + " (" + top.period.replace(/^TTM to /, "") + ")";
  }
  function m6Fitch(ctx) {
    var S = ctx.series, F = ctx.fmt;
    var comp = pointsWithUrl(S, "fitch_us_private_credit_default_rate"), pmr = pointsWithUrl(S, "fitch_pmr_default_rate");
    if (!comp.length) return panel("m6Fitch", "Fitch US private credit default rate", "", emptyState("Not in this edition", "fitch_us_private_credit_default_rate carries no points."), "", "");
    var l = latestOf(comp), prior = comp.length > 1 ? comp[comp.length - 2] : null, lp = latestOf(pmr);
    var yfmt = function (v) { return v.toFixed(1) + "%"; };
    var body = "<div class='m6-value'>" + esc(pct(l.v)) + "<span class='unit'> TTM, " + esc(l.period.replace(/^TTM to /, "to ")) + "</span></div>" +
      "<div class='m6-chart'>" + svgSeries({ label: "Fitch US private credit default rate", yfmt: yfmt, series: [
        { label: "PMR subset", color: LINE2, dashed: true, points: pmr },
        { label: "composite", color: GOLD, width: 2, points: comp }
      ] }) + "</div>" + keyRow([{ label: "composite (PMR + MCO)", color: GOLD }, { label: "privately monitored subset", color: LINE2, cls: "dash" }]);
    /* a slow series gets stability language, never false precision */
    var move = !prior ? "one prior point short of a change" : Math.abs(l.v - prior.v) < 0.05 ? "unchanged from " + prior.period.replace(/^TTM to /, "")
      : (l.v > prior.v ? "up from " : "down from ") + pct(prior.v) + " (" + prior.period.replace(/^TTM to /, "") + ")";
    var high = fitchHigh(comp);
    var cap = CAPTIONS.m6Fitch.template({ v: pct(l.v), label: l.period.replace(/^TTM to /, ""), move: move, high: high,
      pmr: lp ? pct(lp.v) : "—", pmrLabel: lp ? lp.period.replace(/^TTM to /, "") : "—" });
    var e = S.get("fitch_us_private_credit_default_rate");
    var foot = "population: " + esc(firstClause(e.population)) + " · " + comp.length + " composite and " + pmr.length + " PMR points · " + pressFoot(S, ["fitch_us_private_credit_default_rate", "fitch_pmr_default_rate"]);
    return panel("m6Fitch", "Fitch US private credit default rate", "trailing twelve months", body, esc(cap), foot);
  }

  function m6FitchLeverage(ctx) {
    var S = ctx.series, F = ctx.fmt;
    var lev = pointsWithUrl(S, "fitch_bdc_leverage");
    if (!lev.length) return panel("m6FitchLeverage", "Fitch-rated BDC leverage", "", emptyState("Not in this edition", "fitch_bdc_leverage carries no points."), "", "");
    var l = latestOf(lev), prior = lev.length > 1 ? lev[lev.length - 2] : null, first = lev[0];
    var yfmt = function (v) { return v.toFixed(2) + "×"; };
    /* the points carry mixed grains (a quarter, two as-of dates), so every
       one prints as its calendar date and the sentence keeps one form */
    var when = function (p) { return F.date(p.d); };
    var body = "<div class='m6-value'>" + esc(F.x(l.v, 2)) + "<span class='unit'> debt to equity, " + esc(when(l)) + "</span></div>" +
      "<div class='m6-chart'>" + svgSeries({ label: "Fitch-rated BDC average leverage", yfmt: yfmt, zero: false, hiPad: 0.25, series: [{ label: "average debt/equity", color: GOLD, points: lev }] }) + "</div>";
    /* the reading is computed: the direction across every point, and where
       Fitch's own default rate (the panel above) sits in its history */
    var rising = lev.every(function (p, i) { return i === 0 || p.v > lev[i - 1].v; }), falling = lev.every(function (p, i) { return i === 0 || p.v < lev[i - 1].v; });
    var fitch = pointsWithUrl(S, "fitch_us_private_credit_default_rate"), fh = fitchHigh(fitch);
    var read = (rising ? "leverage up at every point" : falling ? "leverage down at every point" : "leverage mixed across the points") +
      (fh ? " while Fitch's default rate above sits " + (fh.indexOf("under") === 0 ? fh : "at " + fh) + "." : ".");
    var cap = lev.length >= 3 ? CAPTIONS.m6FitchLeverage.template({ v: F.x(l.v, 2), label: when(l), move: l.v > prior.v ? "up from" : l.v < prior.v ? "down from" : "unchanged from",
      prior: F.x(prior.v, 2), priorLabel: when(prior), first: F.x(first.v, 2), firstLabel: when(first), read: read })
      : "Fitch-rated BDCs average " + F.x(l.v, 2) + " debt to equity (" + when(l) + ")" + (lev.length === 1 ? "; one observation." : ".");
    var e = S.get("fitch_bdc_leverage");
    var foot = "population: " + esc(firstClause(e.population)) + " · " + lev.length + " points" + (lev.length === 1 ? " (one observation)" : "") + " · " + pressFoot(S, ["fitch_bdc_leverage"]);
    return panel("m6FitchLeverage", "Fitch-rated BDC leverage", "average debt to equity", body, esc(cap), foot);
  }

  function m6Moodys(ctx) {
    var S = ctx.series, F = ctx.fmt;
    var range = dedupe(pointsWithUrl(S, "moodys_private_credit_default_2025_range"));
    if (!range.length) return panel("m6Moodys", "Moody's private credit default range", "", emptyState("Not in this edition", "moodys_private_credit_default_2025_range carries no points."), "", "");
    var lo = range.reduce(function (a, p) { return !a || p.v < a.v ? p : a; }, null), hi = range.reduce(function (a, p) { return !a || p.v > a.v ? p : a; }, null);
    var sg = dedupe(pointsWithUrl(S, "moodys_spec_grade_default_rate"));
    var sgActual = sg.filter(function (p) { return !p.forecast; }), sgL = latestOf(sgActual);
    var yfmt = function (v) { return v.toFixed(1) + "%"; };
    var body = "<div class='m6-value'>" + esc(pct(lo.v)) + "<span class='unit'> to </span>" + esc(pct(hi.v)) + "<span class='unit'> " + esc(lo.d.slice(0, 4)) + "</span></div>" +
      "<div class='m6-chart'>" + svgSeries({ label: "Moody's private credit default range", yfmt: yfmt, hiPad: 0.2, series: [
        { label: "private credit range", color: GOLD, range: true, points: [lo, hi].map(function (p) { return { d: p.d, v: p.v, url: p.url, period: p.period + (p.q ? " (" + p.q + ")" : "") }; }) },
        { label: "speculative-grade rate", color: LINE2, line: false, points: sg.map(function (p) { return { d: p.d, v: p.v, url: p.url, period: p.period + (p.q ? " (" + p.q + ")" : ""), hollow: !!p.forecast }; }) }
      ] }) + "</div>" + keyRow([{ label: "excluding → including distressed exchanges", color: GOLD }, { label: "speculative-grade rate (forecast hollow)", color: LINE2, cls: "dot" }]);
    var cap = CAPTIONS.m6Moodys.template({ year: lo.d.slice(0, 4), lo: pct(lo.v), hi: pct(hi.v), sg: sgL ? pct(sgL.v) : "—", sgLabel: sgL ? (sgL.label || sgL.period) : "—" });
    var e = S.get("moodys_private_credit_default_2025_range");
    var foot = "population: " + esc(firstClause(e.population)) + " · a range, two dated pages · " + pressFoot(S, ["moodys_private_credit_default_2025_range", "moodys_spec_grade_default_rate"]);
    return panel("m6Moodys", "Moody's private credit default range", "2025, two tracks", body, esc(cap), foot);
  }

  function m6LoanIndex(ctx) {
    var S = ctx.series, F = ctx.fmt;
    var inc = pointsWithUrl(S, "lcd_dual_track_default_rate"), exc = pointsWithUrl(S, "lcd_dual_track_default_rate_excl_distressed_exchanges");
    if (!inc.length) return panel("m6LoanIndex", "Loan index default rate, both tracks", "", emptyState("Not in this edition", "lcd_dual_track_default_rate carries no points."), "", "");
    var l = latestOf(inc), lx = latestOf(exc);
    var priorI = inc.length > 1 ? inc[inc.length - 2] : null, priorX = exc.length > 1 ? exc[exc.length - 2] : null;
    var yfmt = function (v) { return v.toFixed(1) + "%"; };
    var body = "<div class='m6-value'>" + esc(pct(l.v, 2)) + "<span class='unit'> with exchanges</span><span class='second'>" + esc(lx ? pct(lx.v, 2) : "—") + " without</span></div>" +
      "<div class='m6-chart'>" + svgSeries({ label: "Loan index default rate, both tracks", yfmt: yfmt, series: [
        { label: "including distressed exchanges", color: GOLD, points: inc, dashed: true },
        { label: "payment defaults only", color: LINE2, points: exc, dashed: true }
      ] }) + "</div>" + keyRow([{ label: "with distressed exchanges", color: GOLD, cls: "dash" }, { label: "payment defaults only", color: LINE2, cls: "dash" }, { label: "dated report points, dashed", color: LINE3 }]);
    var cap = lx && priorI && priorX ? CAPTIONS.m6LoanIndex.template({ inc: pct(l.v, 2), exc: pct(lx.v, 2), label: F.date(l.d), incPrior: pct(priorI.v, 2), excPrior: pct(priorX.v, 2), priorLabel: F.date(priorI.d) })
      : "The loan index's TTM default rate by issuer count: " + pct(l.v, 2) + " with distressed exchanges (" + F.date(l.d) + ")" + (lx ? ", " + pct(lx.v, 2) + " without (" + F.date(lx.d) + ")." : ".");
    var e = S.get("lcd_dual_track_default_rate");
    var foot = "population: " + esc(firstClause(e.population)) + " · " + inc.length + " and " + exc.length + " dated points · " + idList(["lcd_dual_track_default_rate", "lcd_dual_track_default_rate_excl_distressed_exchanges"]) + " · " + esc(S.stampOf("lcd_dual_track_default_rate"));
    return panel("m6LoanIndex", "Loan index default rate, both tracks", "TTM by issuer count", body, esc(cap), foot);
  }

  function m6Cliffwater(ctx) {
    var S = ctx.series, F = ctx.fmt;
    var ret = pointsWithUrl(S, "cliffwater_cdli_headline_return"), inc = pointsWithUrl(S, "cliffwater_cdli_income_and_pik");
    if (!ret.length) return panel("m6Cliffwater", "Cliffwater Direct Lending Index", "", emptyState("Not in this edition", "cliffwater_cdli_headline_return carries no points."), "", "");
    var ttm = latestOf(ret.filter(function (p) { return p.g === "rolling12m"; })), half = latestOf(ret.filter(function (p) { return p.g === "half"; })), yr = latestOf(ret.filter(function (p) { return p.g === "year"; }));
    var incP = inc.filter(function (p) { return /^interest/i.test(String(p.q || "")); }), pikP = inc.filter(function (p) { return /pik/i.test(String(p.q || "")); });
    var li = latestOf(incP), lk = latestOf(pikP);
    var yfmt = function (v) { return v.toFixed(1) + "%"; };
    var body = "<div class='m6-value'>" + esc(ttm ? pct(ttm.v) : pct(latestOf(ret).v)) + "<span class='unit'> " + esc(ttm ? ttm.period : latestOf(ret).period) + "</span></div>" +
      "<div class='m6-chart'>" + svgSeries({ label: "Cliffwater Direct Lending Index headline return", yfmt: yfmt, hiPad: 0.2, series: [
        { label: "total return, headline", color: GOLD, line: false, points: ret.map(function (p) { return { d: p.d, v: p.v, url: p.url, period: p.period + " (" + (p.label || p.g) + ")" }; }) },
        { label: "interest income, % of assets", color: LINE2, line: false, points: incP.map(function (p) { return { d: p.d, v: p.v, url: p.url, period: p.period + " interest income" }; }) },
        { label: "PIK component", color: LINE3, line: false, points: pikP.map(function (p) { return { d: p.d, v: p.v, url: p.url, period: p.period + " PIK interest income" }; }) }
      ] }) + "</div>" + keyRow([{ label: "total return (year, half, TTM)", color: GOLD, cls: "dot" }, { label: "interest income, % of assets", color: LINE2, cls: "dot" }, { label: "of which PIK", color: LINE3, cls: "dot" }]);
    var cap = ttm && half && yr && li && lk ? CAPTIONS.m6Cliffwater.template({ ttm: pct(ttm.v), ttmLabel: F.date(ttm.d), h: pct(half.v), hLabel: F.half(half.d), y: pct(yr.v), yLabel: yr.d.slice(0, 4),
      incYear: li.d.slice(0, 4), inc: pct(li.v), pik: pctNum(lk.v) })
      : "Cliffwater's index: " + ret.map(function (p) { return pct(p.v) + " (" + p.period + ")"; }).join(", ") + ".";
    var e = S.get("cliffwater_cdli_headline_return");
    var foot = "population: " + esc(firstClause(e.population)) + " · " + ret.length + " headline points; the growth-of-$1 history is not drawn · " + pressFoot(S, ["cliffwater_cdli_headline_return", "cliffwater_cdli_income_and_pik"]);
    return panel("m6Cliffwater", "Cliffwater Direct Lending Index", "headline points", body, esc(cap), foot);
  }

  function m6Bank(ctx) {
    var del = ctx.fromCredit("DRBLACBS"), co = ctx.fromCredit("CORBLACBS");
    if (!del && !co) return panel("m6BankCi", "Bank C&I delinquency and charge-off", "FRED, quarterly", emptyState("Not available", "FRED DRBLACBS and CORBLACBS did not answer in the credit-macro payload."), "", "Source: FRED · not available");
    var toPts = function (s) { return ((s && s.history) || []).filter(function (h) { return isNum(h.v); }).map(function (h) { return { d: h.d, v: h.v, period: "quarter dated " + h.d }; }); };
    var yfmt = function (v) { return v.toFixed(1) + "%"; };
    var body = "<div class='m6-value'>" + (del ? esc(pct(del.latest.v, 2)) + "<span class='unit'> delinquent</span>" : "—") + (co ? "<span class='second'>" + esc(pct(co.latest.v, 2)) + " charged off</span>" : "") + "</div>" +
      "<div class='m6-chart'>" + svgSeries({ label: "Bank C&I delinquency and charge-off rates", yfmt: yfmt, bands: ctx.usrec.bands, series: [
        { label: "delinquency rate", color: GOLD, points: toPts(del), dots: false }, { label: "charge-off rate", color: LINE2, dashed: true, points: toPts(co), dots: false }] }) + "</div>" +
      keyRow([{ label: "delinquency (DRBLACBS)", color: GOLD }, { label: "net charge-off (CORBLACBS)", color: LINE2, cls: "dash" }]);
    var qOf = function (d) { return "Q" + Math.ceil(Number(String(d).slice(5, 7)) / 3) + " " + String(d).slice(0, 4); };
    /* the window is read off the payload: its observation count and start */
    var pw = del && del.percentile;
    var win = pw && isNum(pw.n) && pw.windowStart ? "the " + pw.n + " quarters since " + qOf(pw.windowStart) : "its window";
    var cap = del && co ? CAPTIONS.m6Bank.template({ del: pct(del.latest.v, 2), co: pct(co.latest.v, 2), q: qOf(del.latest.d), delPrior: del.prior ? pct(del.prior.v, 2) : "—", coPrior: co.prior ? pct(co.prior.v, 2) : "—",
      pctile: pw && isNum(pw.p) ? ctx.fmt.ordinal(pw.p) : "—", win: win })
      : (del ? "Bank C&I delinquency " + pct(del.latest.v, 2) + " (" + qOf(del.latest.d) + ")." : "Bank C&I charge-off " + pct(co.latest.v, 2) + " (" + qOf(co.latest.d) + ").");
    var foot = "Source: FRED (DRBLACBS" + (del ? " " + del.latest.d : " not available") + "; CORBLACBS" + (co ? " " + co.latest.d : " not available") + ") · all commercial banks, seasonally adjusted, dated at the quarter's start · recessions from FRED USREC";
    return panel("m6BankCi", "Bank C&I delinquency and charge-off", "FRED, quarterly", body, esc(cap), foot);
  }

  function m6Statements(ctx) {
    var S = ctx.series, F = ctx.fmt;
    var rows = [];
    var pr = S.pointsOf("fitch_bdc_peer_review_2026").filter(function (p) { return isNum(p.y); });
    if (pr.length) {
      var by = {}; pr.forEach(function (p) { by[String(p.q || "")] = p; });
      var rev = by.reviewed, neg = by["negative outlooks"], stb = by["stable outlooks"];
      var e = S.get("fitch_bdc_peer_review_2026");
      rows.push("<p class='m6-stmt'>" + esc(e && e.label ? e.label : "Fitch BDC peer review") + ": <b>" + esc(rev ? F.count(rev.y) : "—") + "</b> BDCs reviewed, <b>" + esc(neg ? F.count(neg.y) : "—") + "</b> negative outlooks, <b>" + esc(stb ? F.count(stb.y) : "—") + "</b> stable" +
        "<span class='when'>" + esc(rev ? F.period(rev) : "") + " · " + link(rev && rev.url, domainOf(rev && rev.url) || "source") + "</span></p>");
    }
    rows.push("<p class='m6-stmt slot'>Sector sizing — the Federal Reserve Financial Stability Report and the FSB statements: not in this edition of press-series.json, so no figure is shown; each is keyed in with its date and a URL per statement, never typed from memory.</p>");
    var foot = "counts and statements, dated · " + esc(S.stamp("press"));
    return panel("m6Statements", "Dated statements", "counts and sector sizing", "<div class='m6-statements'>" + rows.join("") + "</div>", "", foot);
  }

  function stressPanel(ctx) {
    var grid = m6Composite(ctx) + m6Proskauer(ctx) + m6Kbra(ctx) + m6Fitch(ctx) + m6FitchLeverage(ctx) + m6Moodys(ctx) + m6LoanIndex(ctx) + m6Cliffwater(ctx) + m6Bank(ctx) + m6Statements(ctx);
    return "<section class='panel-card fsa-section' id='st-stress' aria-labelledby='h-st-stress'>" +
      "<div class='section-head'><h2 id='h-st-stress'><span class='h-pop' data-metric='stressPanel'>Stress and defaults</span></h2>" +
      "<p class='section-blurb'>Private credit has no single public default rate, so every public proxy is drawn as its own series with its own definition, beside the site's composite measures of the listed BDC books.</p>" +
      "<details class='how-to-read'><summary>How to read this</summary><p>Payment defaults and distressed exchanges are separate tracks; never sum them. The loan index panel shows the split directly, Moody's range shows how far the definition moves the private number, and in a BDC book the equivalents are non-accruals on the payment track and PIK conversions plus amendments on the exchange track — show them together, read them together, add nothing. Proskauer, KBRA, Fitch and Moody's each define default and population differently, so they sit side by side and are never averaged; every point of a press-class series links to the page it was read from, and each footer states n or the population. A one-observation series is a dot. The composite panels compute from the schedules of investments and say so until the holdings release; the bank series is a lagging floor from a larger, more diversified borrower base.</p></details></div>" +
      "<div class='m6-grid'>" + grid + "</div></section>";
  }

  /* ---------- mount ---------- */
  /* every series id a footer prints: the note's keys plus the spread
     snapshots of all three families, so each is a hover term with a
     popup built from the loader (registerIds skips a key the catalog
     already knows, so a Refresh re-mount registers nothing twice) */
  function footerKeys(S) {
    var ks = KEYS.slice();
    Object.keys(FAMILIES).forEach(function (f) { m4Snapshots(S, f).forEach(function (s) { if (ks.indexOf(s.key) < 0) ks.push(s.key); }); });
    return ks;
  }
  /* the hover terms are wrapped once per section: a redraw unwraps the
     whole host and wraps it again rather than wrapping the caption alone */
  function rewrap(ctx, host) {
    if (!ctx.terms || typeof ctx.terms.wrap !== "function" || !host) return;
    host.querySelectorAll(".term").forEach(function (t) { t.parentNode.replaceChild(document.createTextNode(t.textContent), t); });
    if (host.normalize) host.normalize();
    try { ctx.terms.wrap(host, { perSection: "section" }); } catch (e) { /* a term fault never takes the chart down */ }
  }
  function mount(container, ctx) {
    destroyCharts();
    if (!ctx || !ctx.series) throw new Error("the series loader is not available");
    var S = ctx.series;
    if (typeof S.registerIds === "function") S.registerIds(ctx.catalog, footerKeys(S));
    container.innerHTML = pricePanel(ctx) + stressPanel(ctx);
    var price = container.querySelector("#st-price");
    renderM4(ctx, price);
    renderM5(ctx, price);
    price.querySelectorAll(".seg button[data-family]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.m4Family = b.getAttribute("data-family");
        price.querySelectorAll(".seg button[data-family]").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        renderM4(ctx, price);
        if (typeof ctx.popup === "function") ctx.popup(price);
        rewrap(ctx, container);
      });
    });
    if (typeof ctx.popup === "function") ctx.popup(container);
    if (ctx.terms && typeof ctx.terms.wrap === "function") { try { ctx.terms.wrap(container, { perSection: "section" }); } catch (e) { /* as above */ } }
    return Promise.resolve();
  }

  /* ---------- the note's facts: computed lines, nothing typed ---------- */
  var KEYS = ["lcd_dl_lbo_spread_recent", "lcd_dl_pe_spread_recent", "lcd_bdc_spread_dist_count_2q26", "lcd_bdc_all_in_rate_quarterly",
    "proskauer_pcdi_overall", "proskauer_pcdi_loan_count", "proskauer_pcdi_principal", "kbra_dld_ttm_default_rate", "fitch_us_private_credit_default_rate",
    "fitch_bdc_leverage", "moodys_private_credit_default_2025_range", "lcd_dual_track_default_rate", "lcd_dual_track_default_rate_excl_distressed_exchanges",
    "cliffwater_cdli_headline_return", "lcd_distressed_ratio_and_volume"];
  function facts(ctx) {
    var S = ctx.series, F = ctx.fmt, out = [];
    if (!S) return out;
    /* the page caps a fact at 400 characters; the stamp is the part that
       must survive, so the body (its population clause last) gives way
       first, cut at a whole word */
    var fit = function (body, k) {
      var s = S.stampOf(k), tail = s ? " — " + s : "", room = 400 - tail.length;
      if (body.length > room) body = body.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, "").replace(/[\s,;:—-]+$/, "") + "…";
      return body + tail;
    };
    var pop = function (k) { var e = S.get(k); return e && e.population ? " — population: " + firstClause(e.population) : ""; };
    var o = latestOf(pointsWithUrl(S, "proskauer_pcdi_overall")), oAll = pointsWithUrl(S, "proskauer_pcdi_overall"), oPrior = oAll.length > 1 ? oAll[oAll.length - 2] : null;
    var lc = latestOf(pointsWithUrl(S, "proskauer_pcdi_loan_count")), lp = latestOf(pointsWithUrl(S, "proskauer_pcdi_principal"));
    if (o) out.push(fit("Proskauer Private Credit Default Index: " + pct(o.v, 2) + " of active loans in default (" + o.period + ")" + (oPrior ? ", from " + pct(oPrior.v, 2) + " (" + oPrior.period + ")" : "") +
      (lc ? "; " + withCommas(Math.round(lc.v)) + " loans" : "") + (lp ? ", $" + lp.v.toFixed(1) + "B principal" : "") + "; Proskauer's default is broader than a missed payment", "proskauer_pcdi_overall"));
    /* KBRA: the undated headline, every point of the latest year with its
       weighting, and the newest forecast year (by issuer count where the
       release gives one), the same choices the panel's caption makes */
    var kb = S.pointsOf("kbra_dld_ttm_default_rate", { withLabels: true }).filter(function (p) { return isNum(p.y); });
    var kbHead = kb.filter(function (p) { return !p.x; })[0], kbYears = dedupe(pointsWithUrl(S, "kbra_dld_ttm_default_rate")).filter(function (p) { return p.g === "year"; }), kbYear = latestOf(kbYears);
    var kbFs = dedupe(pointsWithUrl(S, "kbra_dld_default_forecasts")).sort(function (a, b) { return ms(a.d) - ms(b.d); }), kbF = last(kbFs);
    if (kbF) { var kbSame = kbFs.filter(function (p) { return p.d.slice(0, 4) === kbF.d.slice(0, 4); }); kbF = kbSame.filter(function (p) { return /count/i.test(String(p.q || "")); })[0] || kbF; }
    var kbQual = function (p) { return String(p.q || "").replace(/^forecast\s*/i, "").replace(/^\((.*)\)$/, "$1"); };
    if (kbHead || kbYear) out.push(fit("KBRA DLD direct lending default rate: " + (kbHead ? pct(kbHead.y) + " of issuers (" + kbHead.label + ")" : "") +
      (kbYear ? (kbHead ? "; " : "") + kbYear.d.slice(0, 4) + " " + kbYears.filter(function (p) { return p.d === kbYear.d; }).map(function (p) { return pct(p.v) + " (" + (kbQual(p) || "as quoted") + ")"; }).join(", ") : "") +
      (kbF ? "; " + kbF.d.slice(0, 4) + " forecast " + pct(kbF.v) + " (" + (kbQual(kbF) || "as quoted") + ")" : "") + "; weighting differs by point", "kbra_dld_ttm_default_rate"));
    var fi = pointsWithUrl(S, "fitch_us_private_credit_default_rate"), fl = latestOf(fi), fp = fi.length > 1 ? fi[fi.length - 2] : null, pm = latestOf(pointsWithUrl(S, "fitch_pmr_default_rate"));
    var ttm = function (p) { return p.period.replace(/^TTM to /, ""); };
    if (fl) out.push(fit("Fitch US private credit default rate, TTM: " + pct(fl.v) + " (to " + ttm(fl) + ")" + (fp ? (Math.abs(fl.v - fp.v) < 0.05 ? ", unchanged from " + ttm(fp) : ", from " + pct(fp.v) + " (" + ttm(fp) + ")") : "") + (pm ? "; privately monitored subset " + pct(pm.v) + " (to " + ttm(pm) + ")" : "") + pop("fitch_us_private_credit_default_rate"), "fitch_us_private_credit_default_rate"));
    var lev = latestOf(pointsWithUrl(S, "fitch_bdc_leverage"));
    if (lev) out.push(fit("Fitch-rated BDC average leverage: " + F.x(lev.v, 2) + " debt to equity (" + F.date(lev.d) + ")" + pop("fitch_bdc_leverage"), "fitch_bdc_leverage"));
    var mr = dedupe(pointsWithUrl(S, "moodys_private_credit_default_2025_range"));
    if (mr.length) out.push(fit("Moody's estimated private credit default rate, " + mr[0].d.slice(0, 4) + ": " + mr.map(function (p) { return pct(p.v) + " (" + p.q + ")"; }).join(", ") + "; the two figures are the two tracks, never summed", "moodys_private_credit_default_2025_range"));
    var li = latestOf(pointsWithUrl(S, "lcd_dual_track_default_rate")), lx = latestOf(pointsWithUrl(S, "lcd_dual_track_default_rate_excl_distressed_exchanges"));
    if (li) out.push(fit("Loan index TTM default rate by issuer count: " + pct(li.v, 2) + " including distressed exchanges (" + F.date(li.d) + ")" + (lx ? ", " + pct(lx.v, 2) + " payment defaults only (" + F.date(lx.d) + ")" : "") + pop("lcd_dual_track_default_rate"), "lcd_dual_track_default_rate"));
    var ai = S.pointsOf("lcd_bdc_all_in_rate_quarterly", { grain: "quarter" }).filter(function (p) { return isNum(p.y); }), al = last(ai), ap = ai.length > 1 ? ai[ai.length - 2] : null;
    var sofrId = ctx.fromCredit("SOFR90DAYAVG") ? "SOFR90DAYAVG" : "SOFR", sofr = ctx.fromCredit(sofrId), sofrName = sofrId === "SOFR90DAYAVG" ? "90-day SOFR" : "overnight SOFR";
    var sofrBy = {}; ((sofr && sofr.history) || []).forEach(function (h) { sofrBy[String(h.d).slice(0, 7)] = h.v; });
    if (al) out.push(fit("LCD cost-weighted all-in rate on BDC-held loans: " + pct(al.y, 2) + " (" + F.quarter(al.x) + ")" + (ap ? ", from " + pct(ap.y, 2) + " (" + F.quarter(ap.x) + ")" : "") +
      (isNum(sofrBy[al.x.slice(0, 7)]) ? "; " + (al.y - sofrBy[al.x.slice(0, 7)]).toFixed(2) + " points over the " + sofrName + " at quarter end (" + pct(sofrBy[al.x.slice(0, 7)], 2) + ")" : "") + "; direction, not level, against the site composite" + pop("lcd_bdc_all_in_rate_quarterly"), "lcd_bdc_all_in_rate_quarterly"));
    var snaps = m4Snapshots(S, "all");
    if (snaps.length) {
      var latest = last(snaps), earliest = snaps[0], modal = modalOf(latest.items);
      out.push(fit("LCD BDC holdings spread distribution by count: " + pctNum(bandShare(latest.items) * 100) + "% of loans at 450–549 bps over base (" + F.quarterDeck(latest.p) + "; " + pctNum(bandShare(earliest.items) * 100) + "% in " + F.quarterDeck(earliest.p) + ")" +
        (modal ? "; modal bucket " + bucketName(modal.c) + " at " + pctNum(modal.v * 100) + "%" : "") + "; the site composite is compared on direction, not level", latest.key));
    }
    return out.slice(0, 8);
  }

  REG.push({
    id: "stress",
    title: "Stress and defaults",
    groups: ["lcd-pricing", "lcd-bdc", "press", "reports"],
    keys: KEYS,
    mount: mount,
    facts: facts,
    CAPTIONS: CAPTIONS
  });
})();
