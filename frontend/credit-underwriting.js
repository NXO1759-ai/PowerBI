/* credit-underwriting.js — the Underwriting view (blueprint section 5, PR F):
   would a credit committee lend to this covered company, and on what terms?

   Not a member of window.RTCreditSections (that registry is the Market
   view's ingested-section contract — a paced multi-series load keyed to
   credit.js's own mountSections()). This view reads exactly one static
   file, frontend/data/underwriting.json, built weekly by
   scripts/build-underwriting-panel.mjs from the covered companies' own
   SEC filings through the existing statements feed. credit.js's lazy-mount
   hook (the one line it owns for this view) calls
   window.RTCreditUnderwriting.mount(container) the first time the
   Underwriting tab is shown; this file owns everything inside that
   container from there.

   Contract with the rest of the page:
     window.RTCreditUnderwriting = {
       mount(container) -> Promise    idempotent: fetches the panel once,
                                       re-renders from memory on a later call
       selectTicker(ticker)           also the click/keyboard handler's
                                       target; exposed so an offline test
                                       can drive a selection without a real
                                       DOM event
       writeNote()                    posts the credit note for the
                                       selected company; exposed for the
                                       same reason
       state()                        { loaded, error, selected } — for
                                       the offline test and the console
     }

   Every number on this view is a copy or a ratio of a field already on
   the panel row for the selected company (frontend/data/underwriting.json,
   built by buildRow() in scripts/build-underwriting-panel.mjs), or, for
   the loan-to-value line only, one live /api/comps call for the ONE
   selected ticker — never a fan-out across the 137 covered companies.
   EBITDA on this page is operating income plus D&A, stated as such, never
   an adjusted figure; covenant headroom is the distance to the next
   published S&P band, labeled synthetic, never a real covenant. A missing
   input reads "not disclosed", "no maturity schedule tagged" or "not
   computable without a live quote" — never a zero.

   RTCatalog.register runs once at module evaluation (this file's own
   entries for U1–U4 and the six summary cards), same rule the Market
   view's section files follow: register at file evaluation, not inside
   mount, which can run again. */
(function () {
  "use strict";

  var CAT = window.RTCatalog || null;
  var TERMS = window.RTTerms || null;
  var HTTP = window.RTHttp || null;

  /* ---------- pure helpers (no DOM) ---------- */
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function withCommas(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function fmtX(v, dp) {
    if (!isNum(v)) return "—";
    var d = dp === undefined ? (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2) : dp;
    return (v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + "x";
  }
  /* a count of turns of leverage (a headroom distance), not a multiple —
     no "x" suffix, so "0.62x of turns" does not read as a multiple of a
     multiple */
  function fmtTurns(v, dp) {
    if (!isNum(v)) return "—";
    var d = dp === undefined ? 2 : dp;
    return (v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  }
  function fmtPctFrac(v, dp) {
    if (!isNum(v)) return "—";
    return (v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(dp === undefined ? 1 : dp) + "%";
  }
  function fmtUSD(v) {
    if (!isNum(v)) return "—";
    var sign = v < 0 ? "−" : "", a = Math.abs(v);
    if (a >= 1e9) return sign + "$" + (a / 1e9).toFixed(a >= 1e11 ? 0 : 1) + "B";
    if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + "M";
    if (a >= 1e3) return sign + "$" + withCommas(Math.round(a / 1e3)) + "K";
    return sign + "$" + withCommas(Math.round(a));
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(d) {
    if (!d) return "—";
    var s = String(d), m = MONTHS[Number(s.slice(5, 7)) - 1] || "";
    return s.length >= 10 ? m + " " + Number(s.slice(8, 10)) + ", " + s.slice(0, 4) : m + " " + s.slice(0, 4);
  }
  function bandLabel(b) { return b && b.label ? b.label : null; }

  /* ---------- caption templates (design notes 9: a finding and a number
     under 240 characters; sample() carries the widest values so a build
     test can measure the template) ---------- */
  var CAPTIONS = {
    /* FIXER ROUND 1: the caption used to carry one combined "skipped"
       count and attribute it to a single reason ("no tagged interest
       expense or non-positive coverage") that in fact explained only a
       fraction of the companies left off — most were missing a
       computable debt/EBITDA instead (no EBITDA, no debt, or a negative
       EBITDA refused by the sign guard). scatterSvg now counts the two
       reasons separately (and a third: excluded as a bank, insurer,
       REIT or utility, where the corporate leverage ladder does not
       apply) so the caption's number and its reason agree. */
    u1: {
      /* FIXER ROUND 2: sector-excluded companies (banks, insurers, REITs,
         utilities) are no longer left off the chart — they plot as
         hollow markers when their own raw ratios resolve, so `n` and the
         caption count them as plotted, with `sectorPlotted` naming how
         many of the plotted points are hollow (excluded from the S&P
         ladder, shown for reference). `skippedSector` now counts only
         the sector-excluded names that ALSO have no computable ratio. */
      template: function (v) {
        var parts = [];
        if (v.skippedLeverage) parts.push(v.skippedLeverage + " no debt/EBITDA");
        if (v.skippedCoverage) parts.push(v.skippedCoverage + " no coverage");
        if (v.skippedSector) parts.push(v.skippedSector + " sector-excluded");
        var left = v.skipped ? " (" + v.skipped + " left off: " + (parts.join(", ") || "not computable") + ")" : "";
        var hollow = v.sectorPlotted ? "; " + v.sectorPlotted + " hollow (banks/insurers/REITs/utilities, reference only)" : "";
        return v.n + " of " + v.total + " plotted" + hollow + left + "; S&P debt/EBITDA band edges at 2x, 3x, 4x, 5x.";
      },
      sample: function () { return CAPTIONS.u1.template({ n: "98", total: "137", skipped: "39", skippedLeverage: "27", skippedCoverage: "5", skippedSector: "7", sectorPlotted: "32" }); }
    },
    u3: {
      template: function (v) {
        return v.ticker + "'s liquidity runway covers " + v.x + " of its next-twelve-month maturities and lease payments due, from cash, undrawn revolver and LTM free cash flow; under 1.0x means it must refinance.";
      },
      sample: function () { return CAPTIONS.u3.template({ ticker: "AAPL", x: "12.34x" }); }
    }
  };

  /* ---------- the catalog entries: U1–U4 and the six section 5 cards.
     FIXER ROUND 2: the "watch" strings below used to quote three
     tag-coverage counts (lease payments due "103", revolver capacity
     "11", the maturity ladder "90 of 130") lifted from the planning
     document's own 130-company probe, not from this page's own data —
     stale against the 137-row panel this file actually reads, and off by
     a factor of three for the maturity ladder. updateCoverageText() below
     mutates these same registered entries in place, once, right after
     the panel loads, replacing the placeholder counts with this run's
     own numbers (frontend/data/underwriting.json's `coverage` block, as
     computeCoverage() in build-underwriting-panel.mjs computes it) —
     never a number typed here. Every "the blueprint's own X" phrase is
     also gone: the planning document is never named to the reader, the
     same as every other section file on this site. */
  var ENTRIES = [
    { key: "u1LeverageCoverageScatter", label: "Leverage vs. coverage — the covered companies", subtitle: "U1: debt/EBITDA against interest coverage",
      formula: "Debt ÷ EBITDA (x-axis) against EBIT ÷ interest expense (y-axis, log scale), one point per covered company that tags both; quadrant lines at the S&P financial-risk band edges 2x, 3x, 4x and 5x",
      watch: "EBITDA here is operating income plus D&A, stated as such — never an adjusted figure. A company with no computable debt/EBITDA, no tagged interest expense, or a non-positive coverage ratio cannot sit on a log axis and is left off the chart. A bank, insurer, REIT or utility is excluded from the S&P corporate leverage ladder (its balance sheet is not comparable), but still plots here with a hollow marker when its own raw ratios resolve — for reference, not banded. Select any point, or any company from the list, to open its scorecard below.",
      definition: "Where every covered company sits on the two axes a credit committee reads first: how much it has borrowed against its cash-generating power, and how comfortably it covers the interest bill.",
      interpretation: "A point right of the 4x line and low on the coverage axis sits in the sub-investment-grade zone the leveraged-lending ladder (U4) covers. Click a point, or choose a company from the list, to open its scorecard below." },
    { key: "u2MaturityLadder", label: "Maturity wall", subtitle: "U2: principal due by year, for the selected company",
      formula: "The LongTermDebtMaturitiesRepaymentsOfPrincipal… ladder tagged by the filer: this fiscal year, the next twelve months, years two through five and after year five",
      watch: "A filer that tags the ladder only in its 10-K and never retags it in a 10-Q (AT&T, RTX) is shown from that 10-K, dated, rather than read as untagged. A company with no schedule tagged anywhere (NVIDIA is the standing example) shows that fact, never a zero.",
      definition: "How a company's debt comes due, year by year, as it discloses the schedule.",
      interpretation: "More than 30% of principal due within 24 months (the next-twelve-months bucket plus year two) is this page's own refinancing-risk line." },
    { key: "u3LiquidityRunway", label: "Liquidity runway", subtitle: "U3: coverage of near-term obligations",
      formula: "(cash + undrawn revolver capacity + trailing-twelve-month free cash flow) ÷ (next-twelve-month debt maturities + next-twelve-month operating lease payments due)",
      watch: "Revolver capacity (LineOfCreditFacilityRemainingBorrowingCapacity) is rare among operating companies, so it is usually treated as zero in the numerator, not missing. Lease payments due reads the filer's ONE-YEAR row (LesseeOperatingLeaseLiabilityPaymentsDueNextTwelveMonths), never the whole remaining schedule, which runs several times larger. The free-cash-flow term is withheld only for a company with no usable period at all — an annual period counts as its own trailing-twelve-month window.",
      definition: "How many times over a company's readiest cash and credit cover what it must pay lenders and landlords in the next year.",
      interpretation: "Under 1.0x means the company must refinance or draw fresh capital to meet next year's obligations, this page's own reading rule." },
    { key: "u4CovenantHeadroom", label: "Covenant headroom (synthetic)", subtitle: "U4: distance to the next S&P band, and the leveraged-lending ladder",
      formula: "Turns of (gross) debt/EBITDA to the edge of the next, worse S&P financial-risk band, and the EBITDA decline (debt held fixed) that would reach it; for a company at or above the 4.0x sub-investment-grade line, the same two figures against the 6.0x leveraged-lending guidance line, plus the 4.5–5.0x bank and 6.0–7.0x unitranche attach points and the PE-backed opening-leverage medians as static reference lines",
      watch: "Driven off (gross) debt/EBITDA, the same measure card 1's Overall S&P placement uses, so the two never disagree; a company's net debt/EBITDA is shown alongside as a secondary reading when it differs. Synthetic in the strict sense: no credit agreement is read, and a company's real covenant, if it has one, is very likely set at a different level than a published guideline. Not computable when EBITDA is not positive, when total debt is not tagged, or for a bank, insurer, REIT or utility, whose balance sheet the S&P corporate ladder is not built to read.",
      definition: "How much room a company has before its own leverage crosses into the next, harsher rating-agency tier — a public yardstick, not the company's own loan documents.",
      interpretation: "A company already at or past the 6.0x guidance line has crossed a guideline written for leveraged-loan originations (2013 interagency guidance), not a characterization of the company itself — least of all a regulated utility or bank the sub-ladder should not fire on in the first place. The EBITDA-decline figure translates turns of leverage into a plain-English shock." },
    { key: "uwLeverageCoverage", label: "Leverage & coverage", subtitle: "the six-card scorecard, card 1",
      formula: "debt/EBITDA, net debt/EBITDA, FFO/debt, interest coverage, fixed-charge coverage — (EBITDA − capex − cash taxes) ÷ (cash interest + mandatory amortization) — and FCF/debt, all LTM (or the latest annual period where no LTM window exists)",
      watch: "The S&P financial-risk ladder (2009 matrix, Table 2, carried into the 2013 corporate methodology): debt/EBITDA minimal under 1.5x, modest 1.5–2x, intermediate 2–3x, significant 3–4x, aggressive 4–5x, highly leveraged over 5x; FFO/debt over 60% / 45–60% / 30–45% / 20–30% / 12–20% / under 12%. No interest-coverage floor is quoted — no source document states one. Not shown for a bank, insurer, REIT or utility (see the data notes below the scorecard for the reason); FFO is proxied as net income plus D&A, not S&P's own fuller bridge, and a company whose quarters do not tag D&A may carry EBITDA from its latest 10-K instead — both stated in the data notes.",
      definition: "How much this company has borrowed against what it earns, and how comfortably it services that debt — a lender's first read of any borrower.",
      interpretation: "Where debt/EBITDA and FFO/debt disagree on a band, this page's own convention is that the worse of the two governs — no source document states a tie-break rule for the two ladders." },
    { key: "uwMaturityWall", label: "Maturity wall", subtitle: "the six-card scorecard, card 2",
      formula: "Principal due in years 1 through 5 and after, from the tagged maturity ladder",
      watch: "A 10-K-only tagger is shown from that filing, dated.",
      definition: "When a company's debt comes due.",
      interpretation: "More than 30% due within 24 months is refinancing risk." },
    { key: "uwLiquidityRunway", label: "Liquidity runway", subtitle: "the six-card scorecard, card 3",
      formula: "(cash + revolver capacity + trailing-twelve-month FCF) ÷ (12-month maturities + next-twelve-month lease payments due)",
      watch: "Revolver capacity is rare among operating companies; the lease-payments-due term is the filer's one-year row, never the whole remaining schedule.",
      definition: "Coverage of what a company must pay lenders and landlords over the next year.",
      interpretation: "Under 1.0x means it must refinance." },
    { key: "uwCovenantHeadroom", label: "Covenant headroom", subtitle: "the six-card scorecard, card 4",
      formula: "Synthetic: distance to the next S&P band off (gross) debt/EBITDA, in turns and in the EBITDA decline that reaches it; for sub-investment-grade names also the distance to 6.0x",
      watch: "Labeled synthetic; real covenants live in the credit agreement, which this page never reads. Not shown for a bank, insurer, REIT or utility, or when EBITDA is not positive.",
      definition: "How close a company sits to the next, harsher leverage tier.",
      interpretation: "A public yardstick, not the company's own loan terms." },
    { key: "uwPriorityRecovery", label: "Priority & recovery", subtitle: "the six-card scorecard, card 5",
      formula: "Loan-to-value = net debt ÷ a live enterprise value (one /api/comps call for the selected ticker only); LongTermDebtFairValue against long-term debt carrying value (the same scope the tag covers) as the market's mark on the debt",
      watch: "Debt fair value is tagged by a minority of covered companies, and suppressed even then when the tag plainly covers only part of long-term debt outstanding (below 60% of it), rather than mismatched against a wider debt total. LTV needs a live quote and is not computable when the market-data feed is not configured or has no enterprise value for this ticker; secured share is not tracked by this feed. BDC average LTV runs about 51.9% (BXSL, Q2 2026) as a rough external reference, not a peer computed on this page.",
      definition: "What a lender would actually recover: how much debt sits against the company's market value, and whether the debt itself is trading above or below what is owed.",
      interpretation: "A lower LTV and a fair value near or above carrying value both point the same way: more cushion before a lender takes a loss." },
    { key: "uwCreditCycle", label: "The credit cycle", subtitle: "the six-card scorecard, card 6",
      formula: "The company's own cost of debt — DebtWeightedAverageInterestRate where tagged, else interest expense over average debt — against the credit cycle the Market view's own strip already draws",
      watch: "Tagged by very few operating companies; most rows use the interest-over-average-debt fallback, stated as such. The Treasury benchmark shown here, when it appears, is the Market view's own live Baa-minus-10-year reading, not a second fetch this page makes on its own.",
      definition: "What this company actually pays to borrow, set against the market's own read of the corporate risk premium.",
      interpretation: "A company's own cost of debt running far above the market's risk premium for its rough position on the leverage ladder is a lender pricing something the ladder alone does not show." }
  ];
  if (CAT && typeof CAT.register === "function") CAT.register(ENTRIES);

  /* ---------- state ---------- */
  var STATE = {
    container: null, bound: false,
    data: null, error: null, loading: null,
    selected: null,
    comps: {}, /* ticker -> { status: "pending"|"done"|"error", row, error } */
    note: { pending: false, error: null, result: null, forTicker: null }
  };

  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (HTTP && typeof HTTP.json === "function") return HTTP.json(r, url);
      if (!r || !r.ok) { var e = new Error("HTTP " + (r && r.status)); e.status = r && r.status; throw e; }
      return r.json();
    });
  }
  function httpMessage(e, subject) {
    if (HTTP && typeof HTTP.message === "function") return HTTP.message(e, subject);
    return (e && e.message) || "the request failed";
  }

  function companiesList() {
    var cs = (STATE.data && STATE.data.companies) || {};
    return Object.keys(cs).sort().map(function (t) { return cs[t]; });
  }

  /* ---------- U1: leverage-vs-coverage scatter ---------- */
  var GOLD = "#f5c518", INK = "#8b8f98", LINE2 = "#b6bac2", GRID = "rgba(255,255,255,.08)";
  function niceLogBounds(values) {
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    var loDecade = Math.pow(10, Math.floor(Math.log(lo) / Math.LN10));
    var hiDecade = Math.pow(10, Math.ceil(Math.log(hi) / Math.LN10));
    if (!isFinite(loDecade) || loDecade <= 0) loDecade = 0.1;
    if (!isFinite(hiDecade) || hiDecade <= loDecade) hiDecade = loDecade * 10;
    return { lo: loDecade, hi: hiDecade };
  }
  function scatterSvg(companies, selectedTicker) {
    var W = 640, H = 360, padL = 40, padR = 14, padT = 14, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    /* FIXER ROUND 1: the caption's "left off" count used to carry one
       reason ("no tagged interest expense or non-positive coverage")
       that in fact explained only a small share of the skips; most were
       missing a computable debt/EBITDA instead. Counted separately here,
       mutually exclusively (sector exclusion first, then leverage, then
       coverage), so the caption's number and reason always agree.

       FIXER ROUND 2: a bank, insurer, REIT or utility used to be dropped
       from the plot entirely the moment sectorCaveat was set, which
       dropped 39 of 137 covered companies from the chart the view is
       built around — DLR (one of the seven data-center tickers coverage
       .js deliberately added) among them — against blueprint section 5's
       instruction to plot the covered universe. The S&P corporate ladder
       still does not apply to these sectors (their raw debt/EBITDA and
       interest-coverage numbers are shown for reference, never banded),
       so they now plot with a distinct hollow marker instead of being
       omitted, and "skippedSector" counts only the sector-excluded names
       whose own raw ratios also fail to resolve. */
    var pts = [], sectorPts = [], skippedLeverage = 0, skippedCoverage = 0, skippedSector = 0;
    companies.forEach(function (c) {
      var x = c.leverage && c.leverage.debtToEbitda, y = c.leverage && c.leverage.interestCoverage;
      var xOk = isNum(x) && x >= 0, yOk = isNum(y) && y > 0;
      if (!xOk || !yOk) {
        if (c.sectorCaveat) skippedSector++;
        else if (!xOk) skippedLeverage++;
        else skippedCoverage++;
        return;
      }
      (c.sectorCaveat ? sectorPts : pts).push({ ticker: c.ticker, x: x, y: y, sector: !!c.sectorCaveat });
    });
    var allPts = pts.concat(sectorPts);
    var skipped = skippedLeverage + skippedCoverage + skippedSector;
    if (!allPts.length) {
      return { svg: "<div class='chart-empty'><span>No covered company tags both debt/EBITDA and a positive interest coverage this week.</span></div>",
        n: 0, skipped: skipped, skippedLeverage: skippedLeverage, skippedCoverage: skippedCoverage, skippedSector: skippedSector };
    }
    var xMax = Math.max(6, Math.ceil(Math.max.apply(null, allPts.map(function (p) { return p.x; })) + 0.5));
    var xMin = 0;
    var yb = niceLogBounds(allPts.map(function (p) { return p.y; }));
    var X = function (v) { return padL + ((v - xMin) / (xMax - xMin)) * iw; };
    var Y = function (v) { return padT + ih - (Math.log(v / yb.lo) / Math.log(yb.hi / yb.lo)) * ih; };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Debt to EBITDA against interest coverage, one point per covered company'>";
    /* horizontal gridlines at powers of ten */
    for (var d = yb.lo; d <= yb.hi * 1.0001; d *= 10) {
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + Y(d).toFixed(1) + "' y2='" + Y(d).toFixed(1) + "' stroke='" + GRID + "' stroke-width='1'/>" +
        "<text x='" + (padL - 5) + "' y='" + (Y(d) + 3).toFixed(1) + "' text-anchor='end' font-size='9' fill='" + INK + "'>" + (d >= 1 ? withCommas(d) : d) + "x</text>";
    }
    /* the S&P band-edge quadrant lines */
    [2, 3, 4, 5].forEach(function (edge) {
      if (edge < xMin || edge > xMax) return;
      out += "<line x1='" + X(edge).toFixed(1) + "' x2='" + X(edge).toFixed(1) + "' y1='" + padT + "' y2='" + (padT + ih) + "' stroke='" + GRID + "' stroke-width='1' stroke-dasharray='3 3'/>" +
        "<text x='" + X(edge).toFixed(1) + "' y='" + (padT - 3) + "' text-anchor='middle' font-size='9' fill='" + INK + "'>" + edge + "x</text>";
    });
    out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + (padT + ih) + "' y2='" + (padT + ih) + "' stroke='" + GRID + "' stroke-width='1'/>";
    var drawPoint = function (p) {
      var isSel = p.ticker === selectedTicker;
      var cx = X(clamp(p.x, xMin, xMax)).toFixed(1), cy = Y(clamp(p.y, yb.lo, yb.hi)).toFixed(1);
      var label = esc(p.ticker) + ": debt/EBITDA " + p.x.toFixed(2) + "x, interest coverage " + p.y.toFixed(2) + "x" +
        (p.sector ? " (excluded from the S&P ladder — reference only)" : "");
      /* a sector-excluded company (bank, insurer, REIT, utility) draws
         hollow — an unfilled ring — so it reads as "on the chart, not on
         the ladder" rather than as just another banded point */
      var mark = p.sector
        ? "<circle cx='" + cx + "' cy='" + cy + "' r='" + (isSel ? 5 : 3.2) + "' fill='none' stroke='" + (isSel ? GOLD : INK) + "' stroke-width='1.3'/>"
        : "<circle cx='" + cx + "' cy='" + cy + "' r='" + (isSel ? 5 : 3) + "' fill='" + (isSel ? GOLD : LINE2) + "'" + (isSel ? " stroke='#fff' stroke-width='1.2'" : "") + "/>";
      return "<g class='uw-pt" + (isSel ? " is-selected" : "") + "' tabindex='0' role='button' data-uw-ticker='" + esc(p.ticker) +
        "' aria-label='" + label + "'>" +
        "<circle cx='" + cx + "' cy='" + cy + "' r='9' fill='transparent'/>" + mark +
        "<title>" + label + "</title></g>";
    };
    pts.forEach(function (p) { out += drawPoint(p); });
    sectorPts.forEach(function (p) { out += drawPoint(p); });
    out += "</svg>";
    return { svg: out, n: allPts.length, sectorPlotted: sectorPts.length,
      skipped: skipped, skippedLeverage: skippedLeverage, skippedCoverage: skippedCoverage, skippedSector: skippedSector };
  }

  /* ---------- U2: maturity ladder ---------- */
  function emptyBlock(title, why) {
    return "<div class='uw-empty'><span>" + esc(title) + "</span>" + (why ? "<small>" + esc(why) + "</small>" : "") + "</div>";
  }
  /* FIXER ROUND 1: the 30% refinancing-risk conclusion, and the raw
     "due within 24 months" dollar figure, both used to treat an untagged
     bucket as $0 — fabricating a risk flag (or its absence) on any
     company whose ladder is only partly tagged, and printing a null
     12-month bucket as a literal "$0". Both figures now require the
     specific buckets they need to be numerically tagged, and the 30%
     conclusion additionally requires the ladder to be complete enough to
     serve as a denominator (every bucket tagged, or the tagged sum
     within 5% of total interest-bearing debt) before it is stated at
     all — a partial ladder shows its bars without a risk verdict rather
     than a false one. */
  function maturityCompleteness(c) {
    var L = c.maturityLadder || {};
    var keys = ["remainderOfFiscalYear", "nextTwelveMonths", "yearTwo", "yearThree", "yearFour", "yearFive", "afterYearFive"];
    var allTagged = keys.every(function (k) { return isNum(L[k]); });
    var total = keys.reduce(function (a, k) { return a + (isNum(L[k]) ? L[k] : 0); }, 0);
    var debtTotal = c.leverage && c.leverage.debtTotal;
    var completeEnough = allTagged || (isNum(debtTotal) && debtTotal > 0 && Math.abs(total - debtTotal) <= 0.05 * debtTotal);
    var withinKnown = isNum(L.nextTwelveMonths) && isNum(L.yearTwo);
    var within24 = withinKnown ? (L.nextTwelveMonths + L.yearTwo) : null;
    var share = (completeEnough && withinKnown && total > 0) ? within24 / total : null;
    return { total: total, withinKnown: withinKnown, within24: within24, completeEnough: completeEnough, share: share };
  }
  function ladderHtml(c) {
    var L = c.maturityLadder;
    if (!L || !L.tagged) {
      var note = (c.notes || []).filter(function (n) { return /maturity schedule/i.test(n); })[0] || "no maturity schedule tagged";
      return emptyBlock("No maturity schedule tagged for " + c.ticker + ".",
        note + " — this is not the same as zero maturities due; the filer simply does not tag the ladder.");
    }
    var buckets = [
      ["This fiscal year", L.remainderOfFiscalYear], ["Next 12 months", L.nextTwelveMonths],
      ["Year 2", L.yearTwo], ["Year 3", L.yearThree], ["Year 4", L.yearFour], ["Year 5", L.yearFive],
      ["After year 5", L.afterYearFive]
    ].filter(function (b) { return isNum(b[1]); });
    if (!buckets.length) return emptyBlock("No maturity schedule tagged for " + c.ticker + ".", "no maturity schedule tagged");
    var max = Math.max.apply(null, buckets.map(function (b) { return b[1]; }).concat([1]));
    var comp = maturityCompleteness(c);
    var rows = buckets.map(function (b) {
      var pct = Math.max(2, Math.round(b[1] / max * 100));
      return "<div class='uw-bar-row'><span class='uw-bar-label'>" + esc(b[0]) + "</span>" +
        "<span class='uw-bar-track'><i style='width:" + pct + "%'></i></span>" +
        "<span class='uw-bar-val'>" + fmtUSD(b[1]) + "</span></div>";
    }).join("");
    var asOfNote = (L.asOf && L.asOf !== c.periodEnd)
      ? " Tagged in the latest 10-K (" + fmtDate(L.asOf) + "), not retagged in the " + fmtDate(c.periodEnd) + " quarter."
      : "";
    var riskNote;
    if (isNum(comp.share)) {
      riskNote = comp.share > 0.30
        ? " " + fmtPctFrac(comp.share) + " is due within 24 months — over this page's 30% refinancing-risk line."
        : " " + fmtPctFrac(comp.share) + " is due within 24 months, under the 30% refinancing-risk line.";
    } else if (buckets.length < 7) {
      riskNote = " The maturity schedule is only partly tagged (" + buckets.length + " of 7 buckets), so the 30% refinancing-risk share is not computed.";
    } else {
      riskNote = "";
    }
    return "<div class='uw-bars'>" + rows + "</div><p class='uw-note'>Principal due by year, as tagged." + asOfNote + riskNote + "</p>";
  }

  /* ---------- U3: liquidity runway ---------- */
  function runwayHtml(c) {
    var Liq = c.liquidity;
    var cashLine = "Cash " + (isNum(Liq.cash) ? fmtUSD(Liq.cash) : "not tagged") + " + revolver " + (isNum(Liq.revolverCapacity) ? fmtUSD(Liq.revolverCapacity) : "not tagged (treated as $0)") +
      " + trailing-twelve-month free cash flow " + (isNum(Liq.ltmFcf) ? fmtUSD(Liq.ltmFcf) : "not tagged") +
      " ÷ next-12-month maturities " + (isNum(Liq.nextTwelveMonthMaturities) ? fmtUSD(Liq.nextTwelveMonthMaturities) : "not tagged") +
      " + next-12-month lease payments due " + (isNum(Liq.leasePaymentsDue) ? fmtUSD(Liq.leasePaymentsDue) : "not tagged");
    /* FIXER ROUND 1/2: build-underwriting-panel.mjs refuses to publish a
       runwayCoverage at all unless cash, next-twelve-month maturities and
       next-twelve-month lease payments due are all tagged, and unless the
       resulting ratio is positive (a numerator swamped by a deeply
       negative free cash flow is not a "coverage" of any length) — so a
       null here always means one of those, never a silently zeroed term.
       Free cash flow is read on the period buildRow picked (annual counts
       as its own trailing-twelve-month window) and is never withheld for
       an annual basis, only when the cash flow statement itself is not
       tagged. */
    if (!isNum(Liq.runwayCoverage)) {
      var missing = [];
      if (!isNum(Liq.cash)) missing.push("cash is not tagged");
      if (!isNum(Liq.nextTwelveMonthMaturities)) missing.push("next-12-month maturities are not tagged");
      if (!isNum(Liq.leasePaymentsDue)) missing.push("next-12-month lease payments due are not tagged");
      var reason = missing.length ? missing.join("; ") :
        "cash, revolver capacity and trailing-twelve-month free cash flow together do not exceed zero — a negative reading is not a coverage of any length";
      return emptyBlock("Liquidity runway not computable for " + c.ticker + ".", cashLine + " — " + reason + ".");
    }
    var v = Liq.runwayCoverage, scaleMax = 3, pct = clamp(v / scaleMax * 100, 2, 100), onePct = (1 / scaleMax * 100).toFixed(1);
    return "<div class='uw-runway'><div class='uw-runway-track'><i style='width:" + pct.toFixed(1) + "%'></i><b style='left:" + onePct + "%' title='1.0x — under this line the company must refinance'></b></div>" +
      "<p class='uw-runway-val'>" + fmtX(v) + " <span class='uw-runway-line'>under 1.0x means it must refinance</span></p></div>" +
      "<p class='uw-note'>" + esc(cashLine) + ".</p>";
  }

  /* ---------- U4: covenant headroom gauges ---------- */
  function gaugeBar(lo, hi, value) {
    var top = isNum(hi) ? hi : lo + Math.max(2, (value - lo) * 1.3);
    var v = clamp(value, lo, top);
    var pct = top > lo ? (v - lo) / (top - lo) * 100 : 0;
    return "<span class='uw-gauge-track'><i style='width:" + pct.toFixed(1) + "%'></i></span>";
  }
  /* the PE-backed median opening-leverage lines and the bank/unitranche
     attach bands blueprint section 5 draws alongside the 6.0x guidance
     line, for a company at or above the 4.0x sub-investment-grade
     threshold — static reference points from the blueprint's own cited
     sources, not computed from this company's own filings */
  var SUB_LADDER_REFS =
    "Reference points only, not this company's own capital structure: bank " +
    "facilities typically attach around 4.5–5.0x of EBITDA, unitranche around " +
    "6.0–7.0x; PE-backed buyouts priced a median opening leverage of about " +
    "4.5x from 2024 through Jul 31, 2025, and about 5.0x over the last 25 years.";
  function headroomHtml(c) {
    var H = c.covenantHeadroom, L = c.leverage;
    /* FIXER ROUND 1 (empty-state reason): this used to infer the reason
       from the sign of net debt/EBITDA alone, which told four companies
       with real, positive net debt (APLD, CIFR, IREN, NBIS) that they
       "held net cash" when the true reason was a negative EBITDA this
       period. build-underwriting-panel.mjs now records the actual reason
       once, correctly distinguishing a sector exclusion, an uncomputable
       EBITDA, a non-positive EBITDA and an untagged debt balance — this
       just displays it. */
    if (!H) {
      var reason = L.leverageNotComputableReason || ("debt/EBITDA is not computable for " + c.ticker + " this week");
      return emptyBlock("Covenant headroom not computable for " + c.ticker + ".", reason + " — the synthetic headroom only places a company inside the S&P leverage bands.");
    }
    var cur = H.currentBand, next = H.nextBand;
    /* FIXER ROUND 1 (basis): the gauge and its text now read (gross)
       debt/EBITDA, the same measure as card 1's "Overall S&P placement",
       so the two never show contradictory band names on the same screen.
       A company's net debt/EBITDA, when it differs materially (net cash
       or extra leverage net of cash), is still named as a secondary
       reading rather than silently dropped. */
    var netCashAside = isNum(L.netDebtToEbitda) && L.netDebtToEbitda < 0
      ? " On a net-of-cash basis the company is net cash (net debt/EBITDA " + fmtX(L.netDebtToEbitda) + ")."
      : "";
    var g1 = "<div class='uw-gauge-card'><h4>Distance to the next S&P band</h4>" +
      gaugeBar(cur.min, isFinite(cur.max) ? cur.max : null, L.debtToEbitda) +
      "<p class='uw-note'>Currently " + esc(cur.label) + " (debt/EBITDA " + fmtX(L.debtToEbitda) + ")" +
      (next ? "; " + fmtTurns(H.turnsToNext) + " turns from " + esc(next.label) + " (an EBITDA decline of " + fmtPctFrac(H.ebitdaDeclinePctToNext) + ", debt held fixed, would reach it)" : "; already in the highest band, no further band to cross") +
      "." + netCashAside + " Synthetic — no credit agreement is read.</p></div>";
    var blocks = [g1];
    if (isNum(H.guidanceLine)) {
      var past = H.turnsToGuidanceLine < 0;
      blocks.push("<div class='uw-gauge-card'><h4>Leveraged-lending sub-ladder</h4>" +
        gaugeBar(4.0, 6.0, L.debtToEbitda) +
        "<p class='uw-note'>" + (past ? fmtTurns(Math.abs(H.turnsToGuidanceLine)) + " turns past the 6.0x leveraged-lending guidance line" : fmtTurns(H.turnsToGuidanceLine) + " turns below the 6.0x leveraged-lending guidance line") +
        (past ? " — it is already " + fmtPctFrac(Math.abs(H.ebitdaDeclinePctToGuidanceLine)) + " of EBITDA past that line." : " (an EBITDA decline of " + fmtPctFrac(H.ebitdaDeclinePctToGuidanceLine) + " would reach it).") +
        " A guideline for leveraged-loan originations (2013 interagency guidance), not a characterization of this company. " + SUB_LADDER_REFS + "</p></div>");
    }
    return "<div class='uw-gauges'>" + blocks.join("") + "</div>";
  }

  /* ---------- the six summary cards ---------- */
  function cardHead(key, label) { return "<h4><span class='h-pop' data-metric='" + esc(key) + "' tabindex='0'>" + esc(label) + "</span></h4>"; }
  function line(label, value) { return "<p class='uw-line'><span>" + esc(label) + "</span><b>" + value + "</b></p>"; }
  /* FIXER ROUND 2: card 6's empty-state text used to be one fixed string
     ("no tagged rate and no prior period to average debt against"),
     which build-underwriting-panel.mjs's own notes show is false for the
     34 of 137 rows whose real gap is an untagged interest expense, not a
     missing prior period. buildRow() now pushes the specific reason into
     c.notes as "cost of debt: <reason>"; this reads that reason back
     instead of asserting a fixed cause. */
  function costOfDebtReasonText(c) {
    if (c.costOfDebt.source === "tagged") return "Tagged (DebtWeightedAverageInterestRate).";
    if (c.costOfDebt.source) return c.costOfDebt.source.charAt(0).toUpperCase() + c.costOfDebt.source.slice(1) + ".";
    var note = (c.notes || []).filter(function (n) { return /^cost of debt:/i.test(n); })[0];
    if (note) {
      var rest = note.replace(/^cost of debt:\s*/i, "");
      rest = rest.charAt(0).toUpperCase() + rest.slice(1);
      return /[.?!]$/.test(rest) ? rest : rest + ".";
    }
    return "Not disclosed.";
  }
  function summaryCards(c) {
    var L = c.leverage, S = c.spBand, H = c.covenantHeadroom, D = c.debtFairValue;
    var card1 = "<div class='uw-card'>" + cardHead("uwLeverageCoverage", "Leverage & coverage") +
      line("Debt/EBITDA", fmtX(L.debtToEbitda) + (bandLabel(S.debtToEbitda && S.debtToEbitda.band) ? " · " + esc(bandLabel(S.debtToEbitda.band)) : "")) +
      line("Net debt/EBITDA", fmtX(L.netDebtToEbitda) + (bandLabel(S.netDebtToEbitda && S.netDebtToEbitda.band) ? " · " + esc(bandLabel(S.netDebtToEbitda.band)) : "")) +
      line("FFO/debt", fmtPctFrac(L.ffoToDebt) + (bandLabel(S.ffoToDebt && S.ffoToDebt.band) ? " · " + esc(bandLabel(S.ffoToDebt.band)) : "")) +
      line("Interest coverage", fmtX(L.interestCoverage)) +
      line("Fixed-charge coverage", isNum(L.fixedChargeCoverage.value) ? fmtX(L.fixedChargeCoverage.value) : "not disclosed") +
      line("FCF/debt", fmtPctFrac(L.fcfToDebt)) +
      "<p class='uw-note'>Overall S&P placement: " + (bandLabel(S.worse.band) ? "<strong>" + esc(bandLabel(S.worse.band)) + "</strong>" : "not computable") +
      (S.worse.note ? " — " + esc(S.worse.note) : "") + "</p></div>";

    var comp2 = maturityCompleteness(c);
    var card2 = "<div class='uw-card'>" + cardHead("uwMaturityWall", "Maturity wall") +
      (c.maturityLadder.tagged
        ? line("Next 12 months", fmtUSD(c.maturityLadder.nextTwelveMonths)) +
          line("Due within 24 months", comp2.withinKnown
            ? fmtUSD(comp2.within24) + (isNum(comp2.share) ? " (" + fmtPctFrac(comp2.share) + " of the tagged total)" : "")
            : "not disclosed — next-twelve-months or year-two bucket not tagged") +
          line("After year 5", fmtUSD(c.maturityLadder.afterYearFive))
        : "<p class='uw-note'>" + esc((c.notes || []).filter(function (n) { return /maturity schedule/i.test(n); })[0] || "no maturity schedule tagged") + "</p>") +
      "</div>";

    var card3 = "<div class='uw-card'>" + cardHead("uwLiquidityRunway", "Liquidity runway") +
      line("Runway coverage", fmtX(c.liquidity.runwayCoverage)) +
      line("Cash", fmtUSD(c.liquidity.cash)) +
      line("Revolver capacity", isNum(c.liquidity.revolverCapacity) ? fmtUSD(c.liquidity.revolverCapacity) : "not tagged") +
      "<p class='uw-note'>Under 1.0x means the company must refinance.</p></div>";

    var card4 = "<div class='uw-card'>" + cardHead("uwCovenantHeadroom", "Covenant headroom") +
      (H
        ? line("Current band", esc(bandLabel(H.currentBand))) +
          line("Turns to next band", isNum(H.turnsToNext) ? fmtTurns(H.turnsToNext) : "already highest band") +
          (isNum(H.guidanceLine) ? line("Turns to 6.0x guidance", fmtTurns(H.turnsToGuidanceLine)) : "")
        : "<p class='uw-note'>Not computable" + (L.leverageNotComputableReason ? " — " + esc(L.leverageNotComputableReason) : "") + ".</p>") +
      "<p class='uw-note'>Synthetic; real covenants live in the credit agreement.</p></div>";

    var slot = STATE.comps[c.ticker];
    var ltv = null, ltvNote;
    if (slot && slot.status === "pending") { ltvNote = "Fetching a live quote…"; }
    else if (slot && slot.status === "done" && slot.row && slot.row.ok && isNum(slot.row.enterpriseValue) && slot.row.enterpriseValue > 0 && isNum(L.netDebt)) {
      ltv = L.netDebt / slot.row.enterpriseValue; ltvNote = null;
    } else { ltvNote = "not computable without a live quote"; }
    var card5 = "<div class='uw-card'>" + cardHead("uwPriorityRecovery", "Priority & recovery") +
      line("Loan-to-value", isNum(ltv) ? fmtPctFrac(ltv) : ltvNote) +
      line("Debt fair value vs. carrying", isNum(D.markPct) ? fmtPctFrac(D.markPct) : "not disclosed") +
      line("Secured share", "not tracked by this feed") +
      "<p class='uw-note'>For rough external reference only, BDC average LTV runs about 51.9% (BXSL, Q2 2026) — not a peer this page computes.</p></div>";

    var card6 = "<div class='uw-card'>" + cardHead("uwCreditCycle", "The credit cycle") +
      line("Cost of debt", isNum(c.costOfDebt.value) ? fmtPctFrac(c.costOfDebt.value, 2) : "not disclosed") +
      "<p class='uw-note'>" + esc(costOfDebtReasonText(c)) +
      creditCycleBenchmark() + "</p></div>";

    return "<div class='uw-summary'>" + card1 + card2 + card3 + card4 + card5 + card6 + "</div>";
  }
  /* the Market view's own live Baa-minus-10-year reading, reused through
     window.RTCreditPage.ctx() when the Market view has already loaded it
     this session — never a second fetch this file makes on its own */
  function creditCycleBenchmark() {
    try {
      if (window.RTCreditPage && typeof window.RTCreditPage.ctx === "function") {
        var ctx = window.RTCreditPage.ctx();
        var s = ctx && typeof ctx.fromCredit === "function" ? ctx.fromCredit("BAA10Y") : null;
        if (s && isNum(s.latest && s.latest.v)) {
          return " The market's Baa-minus-10-year corporate risk premium is " + (s.latest.v * 100).toFixed(0) + " bps (" + s.latest.d + ").";
        }
      }
    } catch (e) { /* the Market view's data is optional context here, never required */ }
    return "";
  }

  /* ---------- the credit committee's note (independent control) ---------- */
  function buildNoteFacts(c) {
    var facts = [];
    if (!c || !c.basis) return { facts: [], periodLabel: c ? c.ticker + ": no usable period this week" : "" };
    var L = c.leverage, S = c.spBand, H = c.covenantHeadroom, Liq = c.liquidity, D = c.debtFairValue;
    if (isNum(L.debtToEbitda)) facts.push("Debt/EBITDA " + fmtX(L.debtToEbitda) + (bandLabel(S.debtToEbitda && S.debtToEbitda.band) ? " (" + bandLabel(S.debtToEbitda.band) + ", S&P financial-risk table)" : "") +
      "; net debt/EBITDA " + fmtX(L.netDebtToEbitda));
    if (isNum(L.ffoToDebt)) facts.push("FFO/debt " + fmtPctFrac(L.ffoToDebt) + "; overall S&P placement " + (bandLabel(S.worse.band) || "not computable"));
    if (isNum(L.interestCoverage)) facts.push("Interest coverage " + fmtX(L.interestCoverage) + (isNum(L.fixedChargeCoverage.value) ? "; fixed-charge coverage " + fmtX(L.fixedChargeCoverage.value) : "; fixed-charge coverage not disclosed"));
    if (isNum(Liq.runwayCoverage)) facts.push("Liquidity runway " + fmtX(Liq.runwayCoverage) + " of next-12-month obligations covered by cash, revolver capacity and LTM free cash flow");
    if (H) facts.push("Covenant headroom (synthetic, off debt/EBITDA): " + (isNum(H.turnsToNext) ? fmtTurns(H.turnsToNext) + " turns to the next S&P band" : "already the highest S&P band") +
      (isNum(H.guidanceLine) ? "; " + fmtTurns(H.turnsToGuidanceLine) + " turns from the 6.0x leveraged-lending guidance line" : ""));
    var slot = STATE.comps[c.ticker];
    if (slot && slot.status === "done" && slot.row && slot.row.ok && isNum(slot.row.enterpriseValue) && slot.row.enterpriseValue > 0 && isNum(L.netDebt)) {
      facts.push("Loan-to-value " + fmtPctFrac(L.netDebt / slot.row.enterpriseValue) + " (net debt over a live enterprise value)");
    }
    if (isNum(D.markPct)) facts.push("Debt fair value " + fmtPctFrac(D.markPct) + " of carrying value");
    var periodLabel = c.ticker + " " + (c.fiscalPeriod || "period") + " through " + (c.periodEnd ? fmtDate(c.periodEnd) : "an unstated date");
    return { facts: facts.slice(0, 12), periodLabel: periodLabel };
  }
  function noteSectionHtml(c) {
    var f = buildNoteFacts(c), n = STATE.note;
    var pending = n.pending && n.forTicker === c.ticker;
    var canWrite = f.facts.length >= 3 && !pending;
    var meta = f.facts.length < 3
      ? "The note needs at least three computable figures on this company; not enough are available yet."
      : f.facts.length + " facts on " + esc(c.ticker) + " · " + esc(f.periodLabel);
    var body;
    if (pending) body = "<p class='hint' role='status'>Writing the note from " + f.facts.length + " facts on " + esc(c.ticker) + "…</p>";
    else if (n.forTicker === c.ticker && n.error) body = "<p class='hint'>" + esc(n.error && n.error.status === 503
      ? "The note feed is not configured on this deployment, so no note is written; every figure above stands on its own."
      : "The note could not be written just now (" + httpMessage(n.error, "the note") + "). Every figure above stands on its own.") + "</p>";
    else if (n.forTicker === c.ticker && n.result) {
      body = String((n.result && n.result.note) || "").split("\n\n").map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("") +
        "<p class='note-meta'>Written by the research model from the " + f.facts.length + " facts drawn on this company's scorecard and nothing else · " + esc(f.periodLabel) + "</p>";
    } else body = "<p class='hint' role='status'>Press “Write the note” to have the research model read this company's scorecard.</p>";
    return "<div class='uw-note-block'><div class='chart-controls'>" +
      "<button type='button' id='uw-note-btn' class='refresh-btn'" + (canWrite ? "" : " disabled") + ">" + (pending ? "Writing…" : "Write the note") + "</button>" +
      "<span class='tile-foot'>" + meta + "</span></div><div id='uw-analyst-note-body'>" + body + "</div></div>";
  }

  /* ---------- top-level render ---------- */
  function sectionHead() {
    return "<div class='section-head'><h2 id='h-underwriting'>Underwriting — the covered companies as borrowers</h2>" +
      "<p class='section-blurb'>Would a credit committee lend to this company, and on what terms? Every covered company read as a lender would read it, from its own SEC filings — never a BDC's private borrower.</p>" +
      "<details class='how-to-read'><summary>How to read this</summary><p>EBITDA is operating income plus D&amp;A, stated as such, never an adjusted figure. Covenant headroom is synthetic — the distance to the next published S&amp;P band, not a real covenant from a credit agreement. A missing input reads as \"not disclosed\" or \"no maturity schedule tagged\", never as a zero. Loan-to-value uses one live quote for the selected company only.</p></details></div>";
  }
  function renderLoading() {
    if (!STATE.container) return;
    STATE.container.innerHTML = "<section class='panel-card fsa-section uw-root'>" + sectionHead() +
      "<p class='hint' role='status'>Loading the underwriting panel for the covered companies…</p></section>";
  }
  function renderErrorState() {
    if (!STATE.container) return;
    STATE.container.innerHTML = "<section class='panel-card fsa-section uw-root'>" + sectionHead() +
      "<p class='chart-empty' style='position:static'><span>The underwriting panel could not be loaded: " +
      esc(httpMessage(STATE.error, "the underwriting panel")) + ". Nothing is shown in its place.</span></p></section>";
  }
  function controlsHtml(companies) {
    var opts = companies.map(function (c) { return "<option value='" + esc(c.ticker) + "'" + (c.ticker === STATE.selected ? " selected" : "") + ">" + esc(c.ticker) + " — " + esc(c.name || c.ticker) + "</option>"; }).join("");
    return "<div class='uw-controls'><label class='uw-select-label' for='uw-company-select'>Company</label>" +
      "<select id='uw-company-select'><option value=''>Choose a covered company…</option>" + opts + "</select>" +
      "<span class='tile-foot'>" + companies.length + " covered companies · " + esc((STATE.data && STATE.data.source) || "") + "</span></div>";
  }
  function u1Html(companies) {
    var r = scatterSvg(companies, STATE.selected);
    var cap = CAPTIONS.u1.template({ n: r.n, total: companies.length, skipped: r.skipped,
      skippedLeverage: r.skippedLeverage, skippedCoverage: r.skippedCoverage, skippedSector: r.skippedSector,
      sectorPlotted: r.sectorPlotted });
    return "<section class='panel-card fsa-section' aria-labelledby='h-u1'>" +
      "<div class='section-head'><h3 id='h-u1'><span class='h-pop' data-metric='u1LeverageCoverageScatter' tabindex='0'>Leverage vs. coverage — every covered company</span></h3></div>" +
      "<div class='chart-box uw-scatter-box'>" + r.svg + "</div><p class='chart-caption'>" + esc(cap) + "</p></section>";
  }
  function preSelectionEmpty() {
    return "<section class='panel-card fsa-section'><p class='chart-empty' style='position:static'><span>Click a point on the chart above, or choose a company from the list, to see its maturity ladder, liquidity runway, covenant headroom and full scorecard.</span></p></section>";
  }
  /* FIXER ROUND 1 (notes rendering): buildRow() records a caveat for every
     proxy this page leans on — FFO as net income plus D&A rather than
     S&P's own bridge, fixed-charge coverage's cash taxes as the accrual
     tax provision, the cost-of-debt fallback basis, an EBITDA borrowed
     from the latest 10-K — but the page previously surfaced only the
     maturity-schedule note, so a card like FFO/debt carried an S&P band
     label with no visible caveat anywhere on screen. All of the row's
     notes are shown here, once, under the scorecard. */
  function notesBlockHtml(c) {
    var notes = c.notes || [];
    if (!notes.length) return "";
    var items = notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
    return "<details class='how-to-read uw-data-notes'><summary>Data notes for " + esc(c.ticker) + " (" + notes.length + ")</summary><ul>" + items + "</ul></details>";
  }
  function detailHtml(c) {
    return "<section class='panel-card fsa-section' aria-labelledby='h-u2'>" +
      "<div class='section-head'><h3 id='h-u2'><span class='h-pop' data-metric='u2MaturityLadder' tabindex='0'>Maturity wall</span> — " + esc(c.ticker) + "</h3></div>" +
      ladderHtml(c) + "</section>" +
      "<section class='panel-card fsa-section' aria-labelledby='h-u3'>" +
      "<div class='section-head'><h3 id='h-u3'><span class='h-pop' data-metric='u3LiquidityRunway' tabindex='0'>Liquidity runway</span> — " + esc(c.ticker) + "</h3></div>" +
      runwayHtml(c) + (isNum(c.liquidity.runwayCoverage) ? "<p class='chart-caption'>" + esc(CAPTIONS.u3.template({ ticker: c.ticker, x: fmtX(c.liquidity.runwayCoverage) })) + "</p>" : "") + "</section>" +
      "<section class='panel-card fsa-section' aria-labelledby='h-u4'>" +
      "<div class='section-head'><h3 id='h-u4'><span class='h-pop' data-metric='u4CovenantHeadroom' tabindex='0'>Covenant headroom</span> — " + esc(c.ticker) + " <small>(synthetic)</small></h3></div>" +
      headroomHtml(c) + "</section>" +
      "<section class='panel-card fsa-section' aria-labelledby='h-uw-summary'>" +
      "<div class='section-head'><h3 id='h-uw-summary'>Scorecard — " + esc(c.name || c.ticker) + " (" + esc(c.ticker) + ")</h3>" +
      "<p class='section-blurb'>" + esc(c.fiscalPeriod || "") + " period through " + esc(fmtDate(c.periodEnd)) + (c.form ? ", " + esc(c.form) : "") + ".</p></div>" +
      summaryCards(c) + notesBlockHtml(c) + noteSectionHtml(c) + "</section>";
  }
  function render() {
    if (!STATE.container) return;
    if (STATE.error) { renderErrorState(); return; }
    if (!STATE.data) { renderLoading(); return; }
    var companies = companiesList();
    var selected = STATE.selected ? STATE.data.companies[STATE.selected] : null;
    var html = "<section class='panel-card fsa-section uw-root'>" + sectionHead() + controlsHtml(companies) + "</section>" +
      u1Html(companies) + (selected ? detailHtml(selected) : preSelectionEmpty());
    STATE.container.innerHTML = html;
    wrapTerms(STATE.container);
  }

  function wrapTerms(root) {
    if (!TERMS || typeof TERMS.wrap !== "function" || !root || typeof root.querySelectorAll !== "function") return;
    try {
      root.querySelectorAll(".term").forEach(function (t) { t.parentNode.replaceChild(document.createTextNode(t.textContent), t); });
      if (root.normalize) root.normalize();
    } catch (e) { /* a stale term node never blocks a re-render */ }
    try { TERMS.wrap(root, { perSection: "section" }); } catch (e) { /* a term-library fault never breaks this view */ }
  }

  /* ---------- selection and the live LTV quote ----------
     Both return their promise (a real caller — the click/keyboard/change
     handlers below — ignores it) so an offline test can await the async
     leg of a selection instead of guessing at timing. */
  function selectTicker(ticker) {
    if (!STATE.data || !ticker || !STATE.data.companies[ticker]) return Promise.resolve();
    STATE.selected = ticker;
    render();
    return fetchComps(ticker);
  }
  function fetchComps(ticker) {
    var slot = STATE.comps[ticker];
    if (slot && (slot.status === "pending" || slot.status === "done")) return Promise.resolve();
    STATE.comps[ticker] = { status: "pending", row: null, error: null };
    return fetchJson("/api/comps?tickers=" + encodeURIComponent(ticker)).then(function (d) {
      var row = d && Array.isArray(d.rows) ? d.rows[0] : null;
      STATE.comps[ticker] = { status: "done", row: row || null, error: null };
      if (STATE.selected === ticker) render();
    }).catch(function (e) {
      STATE.comps[ticker] = { status: "error", row: null, error: e };
      if (STATE.selected === ticker) render();
    });
  }

  /* ---------- the credit note ----------
     Returns its promise for the same reason selectTicker() does — the
     real click handler ignores it, an offline test can await it. */
  function writeNote() {
    var c = STATE.selected && STATE.data && STATE.data.companies[STATE.selected];
    if (!c) return Promise.resolve();
    var f = buildNoteFacts(c);
    if (f.facts.length < 3 || (STATE.note.pending && STATE.note.forTicker === c.ticker)) { render(); return Promise.resolve(); }
    STATE.note = { pending: true, error: null, result: null, forTicker: c.ticker };
    render();
    return fetch("/api/fsa-note", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "underwriting", ticker: c.ticker, periodLabel: f.periodLabel, facts: f.facts })
    }).then(function (r) {
      return HTTP && typeof HTTP.json === "function" ? HTTP.json(r, "the note") : r.json();
    }).then(function (d) {
      STATE.note = { pending: false, error: null, result: d, forTicker: c.ticker };
      render();
    }).catch(function (e) {
      STATE.note = { pending: false, error: e, result: null, forTicker: c.ticker };
      render();
    });
  }

  /* ---------- event delegation, bound once on the container ---------- */
  function onClick(e) {
    var t = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-uw-ticker], #uw-note-btn") : null;
    if (!t) return;
    if (t.id === "uw-note-btn") { writeNote(); return; }
    var ticker = t.getAttribute && t.getAttribute("data-uw-ticker");
    if (ticker) selectTicker(ticker);
  }
  function onKeydown(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var t = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-uw-ticker]") : null;
    if (!t) return;
    e.preventDefault();
    selectTicker(t.getAttribute("data-uw-ticker"));
  }
  function onChange(e) {
    if (e.target && e.target.id === "uw-company-select" && e.target.value) selectTicker(e.target.value);
  }

  /* ---------- coverage counts, applied to the already-registered catalog
     entries once the panel loads (FIXER ROUND 2) ----------
     RTCatalog.register() copies each entry's fields into a NEW object
     (metric-catalog.js's own `entry` merge), so mutating ENTRIES[i] here
     would not touch what CAT.get(key) returns — the live object has to be
     fetched and mutated directly. Runs once (coverageApplied guards a
     second mount() from appending twice) and only ever APPENDS a
     computed sentence; it never invents a count when `coverage` is
     missing (an older cached underwriting.json without the field). */
  var coverageApplied = false;
  function applyCoverageToCatalog(coverage) {
    if (coverageApplied || !coverage || !CAT || typeof CAT.get !== "function") return;
    coverageApplied = true;
    var total = coverage.total;
    var append = function (key, sentence) {
      var entry = CAT.get(key);
      if (entry && typeof entry.watch === "string") entry.watch += " " + sentence;
    };
    var pct = function (n) { return isNum(n) && isNum(total) && total > 0 ? n + " of " + total : null; }
    var ladder = pct(coverage.maturityLadderTagged);
    if (ladder) {
      append("u2MaturityLadder", "This week, the ladder is tagged (directly or via the 10-K fallback) by " + ladder + " covered companies.");
      append("uwMaturityWall", "This week, tagged by " + ladder + " covered companies.");
    }
    var lease = pct(coverage.leasePaymentsDueTagged), revolver = pct(coverage.revolverCapacityTagged);
    if (lease || revolver) {
      var bits = [];
      if (revolver) bits.push("revolver capacity by " + revolver);
      if (lease) bits.push("next-twelve-month lease payments due by " + lease);
      var sentence = "This week: " + bits.join("; ") + ".";
      append("u3LiquidityRunway", sentence);
      append("uwLiquidityRunway", sentence);
    }
  }

  /* ---------- mount: fetches the panel once, idempotent thereafter ---------- */
  function mount(container) {
    STATE.container = container;
    if (container && !STATE.bound && typeof container.addEventListener === "function") {
      container.addEventListener("click", onClick);
      container.addEventListener("keydown", onKeydown);
      container.addEventListener("change", onChange);
      STATE.bound = true;
    }
    if (STATE.data || STATE.error) { render(); return Promise.resolve(); }
    if (STATE.loading) return STATE.loading;
    renderLoading();
    STATE.loading = fetchJson("data/underwriting.json").then(function (d) {
      STATE.loading = null;
      if (!d || !d.companies || typeof d.companies !== "object") throw new Error("the underwriting panel carries no companies");
      STATE.data = d;
      applyCoverageToCatalog(d.coverage);
      render();
    }).catch(function (e) {
      STATE.loading = null;
      STATE.error = e;
      render();
    });
    return STATE.loading;
  }

  window.RTCreditUnderwriting = {
    mount: mount,
    selectTicker: selectTicker,
    writeNote: writeNote,
    state: function () { return { loaded: !!STATE.data, error: STATE.error, selected: STATE.selected, note: STATE.note }; },
    /* exposed only so scripts/test-underwriting-view.mjs can measure every
       caption template's sample() the way test-pc-page.mjs does for the
       Market view's own section files; no runtime code reads this */
    CAPTIONS: CAPTIONS
  };
})();
