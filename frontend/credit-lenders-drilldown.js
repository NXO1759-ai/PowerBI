/* credit-lenders-drilldown.js — the per-BDC drill-down for the Lenders
   view (blueprint 4.3: L1–L9, L12, the liability card and the fee card).
   Opened in-page as a modal from a row on the lenders scorecard
   (frontend/lib/lenders-scorecard.js); this file owns none of the
   scorecard's own rows or catalog keys and reads every figure through
   RTCredit (frontend/lib/credit.js) or a precomputed field the holdings
   build already wrote (holdings.summary.*), never a second formula.

   window.RTLendersDrilldown = { open(ticker, ctx), close(), CAPTIONS }

   ctx = { company, holdings (or null), composite, terms, universe,
     pcSeries, catalog, fmt, wrapTerms, priceHistory(ticker), quote(ticker),
     coverage (optional: coverage.json, used only to name the refusal
     reason for a filer with no holdings file), onClose (optional) }
   - company: one frontend/data/bdc/company-TICKER.json object.
   - holdings: one frontend/data/bdc/holdings-TICKER.json object, or null
     for a filer coverage.holdings.tickers_refused names.
   - composite: frontend/data/bdc/composite.json, read directly here (its
     own fields — dispersion, lienMix, maturityWall, histogram — never
     credit.js's normalizeComposite() view, which does not carry them).
   - terms: frontend/data/bdc/terms.json.
   - universe: either the one universe.json row for this ticker, or the
     whole universe.json (its rows array is searched by ticker).
   - pcSeries: window.RTPcSeries, already loaded on every view.
   - catalog: window.RTCatalog.
   - fmt: RTPcSeries.fmt, or omitted — every number here is formatted
     locally so the drill-down does not depend on it.
   - wrapTerms(root): the page's hover-term wrapper (credit.js's
     wrapTerms); called once after every render so no second hover
     mechanism is built here.
   - priceHistory(ticker) / quote(ticker): functions returning a Promise,
     called lazily on open() (never for all 53 tickers at once). Their
     resolved shape is read defensively:
       priceHistory → an array of {d, close, adjClose} OR
                       {points: [...]} OR {history: [...]}, oldest first
       quote        → {price, dividendYieldTTM, marketCap, asOf} or null;
                       when price is absent it is derived here as
                       marketCap ÷ company.series.latest.sharesOutstanding.
     Either may reject or resolve null/empty; L1 then shows its own
     empty state and the rest of the panel renders from company/holdings
     alone.
   - coverage: frontend/data/bdc/coverage.json, optional. When holdings
     is null, the refusal reason is read from
     coverage.holdings.tickers_refused; without it every empty state
     just says "not yet parsed".

   Registers its own RTCatalog entries (group "credit") and CAPTIONS at
   file evaluation, the same contract as credit-stress.js; nothing here
   touches the DOM until open() is called, so scripts/test-lenders-
   drilldown.mjs can evaluate this file against a window stub in Node. */
(function () {
  "use strict";

  var CAT = (typeof window !== "undefined" && window.RTCatalog) || null;
  var RTCredit = (typeof window !== "undefined" && window.RTCredit) || null;

  /* ---------- pure helpers (no DOM) ---------- */
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function withCommas(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  /* Some filers' own industry labels run to 100+ characters (PSEC's
     schedule concatenates several taxonomies: "Residential Real Estate
     Investment Trusts (REITs) / Consumer Finance / Structured Finance
     First Lien Term Loan A"). CAPTIONS.l6 embeds this label twice, which
     pushed a real caption past the house 240-character limit even
     though the fixed test sample stayed short (round-2 fixer finding).
     Truncate only for the caption; the row's own title attribute still
     carries the untruncated name. */
  function truncateLabel(s, max) {
    var str = String(s || "");
    return str.length > max ? str.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : str;
  }
  function fmtPct(v, dp) { return isNum(v) ? (v * 100).toFixed(dp === undefined ? 1 : dp) + "%" : "—"; }
  function fmtX(v, dp) { return isNum(v) ? v.toFixed(dp === undefined ? 2 : dp) + "×" : "—"; }
  function fmtPerShare(v) { return isNum(v) ? "$" + v.toFixed(2) : "—"; }
  function fmtMoneyB(v) { return isNum(v) ? "$" + (v / 1e9).toFixed(2) + "B" : "—"; }
  function fmtMoneyM(v) { return isNum(v) ? "$" + (v / 1e6).toFixed(1) + "M" : "—"; }
  function fmtBps(v) { return isNum(v) ? withCommas(Math.round(v * 10000)) : "—"; }
  function na(label) { return "<span class='ld-na'>" + esc(label || "not disclosed") + "</span>"; }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(d) {
    var s = String(d || "");
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s || "—";
    return MONTHS[Number(s.slice(5, 7)) - 1] + " " + Number(s.slice(8, 10)) + ", " + s.slice(0, 4);
  }
  function quarterLabel(end) {
    var s = String(end || ""); if (!/^\d{4}-\d{2}/.test(s)) return s;
    var m = Number(s.slice(5, 7)), q = Math.ceil(m / 3);
    return "Q" + q + " " + s.slice(0, 4);
  }
  function last(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
  function ms(d) { return Date.parse(String(d).slice(0, 10) + "T00:00:00Z"); }

  /* ---------- reading a company file ---------- */
  function orderedPeriods(series) {
    if (!series || !Array.isArray(series.periods)) return [];
    return series.periods.slice().sort(function (a, b) { return a.end < b.end ? -1 : a.end > b.end ? 1 : 0; });
  }
  function periodVal(period, key) {
    var vv = period && period.values && period.values[key];
    return vv && isNum(vv.v) ? vv.v : null;
  }
  function latestVal(company, key) {
    var e = company && company.series && company.series.latest && company.series.latest[key];
    return e && isNum(e.v) ? e.v : null;
  }

  /* ---------- reading a compact holding row ----------
     h = {id, n, a, t, l:{c,r}, f, i, r, sp, fl, pk, b, p, c, v, ad, m,
          na, fr, un, u, s}. Absent means null/false, per the file's own
     `keys.holding` map (read here, not hardcoded, so a schema addition
     is picked up without a code change; the map above is the fallback
     for a file that does not carry `keys` yet). */
  var HOLDING_KEYS_DEFAULT = { id: "id", issuer: "k", name: "n", aff: "a", kind: "t", lien: "l", facility: "f",
    industry: "i", rate: "r", spread: "sp", floor: "fl", pik: "pk", base: "b", principal: "p", cost: "c", fv: "v",
    pctNav: "nv", unfunded: "u", acquired: "ad", maturity: "m", nonAccrual: "na", floating: "fr", units: "un", src: "s" };
  function holdingKeyMap(holdingsFile) {
    return (holdingsFile && holdingsFile.keys && holdingsFile.keys.holding) || HOLDING_KEYS_DEFAULT;
  }
  /* Third-party = not affiliated: the schedule's own affiliation field
     (h.a), absent for a non-affiliated holding. h.s.t is a different
     fact entirely — the "table" provenance flag in keys.src (whether the
     printed schedule, not XBRL, supplied this row) — and must never be
     read as an affiliation test (round-2 fixer finding: it was always
     true, so the old isThirdParty() never excluded anything). */
  function isThirdParty(h) { return !(h && h.a); }

  /* ---------- CAPTIONS ----------
     template(values) renders the caption the page shows; sample() gives
     it the widest values it can carry, so the test measures every
     caption under 240 characters. The source stamp lives in the tile
     footer, never here. */
  var CAPTIONS = {
    l1: {
      template: function (v) {
        return v.ticker + " traded at " + v.priceToNav + "× NAV on " + v.asOf + " (price " + v.price + ", NAV " + v.nav +
          "), " + v.regime + " over " + v.span + "; the 1.0× line marks §63(2), below which new equity needs a shareholder vote.";
      },
      sample: function () {
        return CAPTIONS.l1.template({ ticker: "ARCC", priceToNav: "1.00", asOf: "Sep 18, 2026", price: "$21.99", nav: "$19.35",
          regime: "a premium for most of the span", span: "5 years" });
      }
    },
    l2: {
      template: function (v) {
        return v.ticker + "'s dividend coverage was " + v.last + "× last quarter (" + v.lastQ + "), from " + v.prior + "× the quarter before" +
          (v.flagged ? "; both quarters ran under 1.0×, the two-consecutive-quarter flag." : ".");
      },
      sample: function () {
        return CAPTIONS.l2.template({ ticker: "ARCC", last: "1.15", lastQ: "Q2 2026", prior: "1.18", flagged: true });
      }
    },
    l3: {
      template: function (v) {
        return v.ticker + "'s asset coverage was " + v.ac + "× on " + v.asOf + " (" + v.cushion + " cushion over the " + v.statutory +
          "% line, " + v.acSource + "); gross debt/equity " + v.de + "×, net " + v.nde + "×.";
      },
      sample: function () {
        return CAPTIONS.l3.template({ ticker: "ARCC", ac: "1.86", asOf: "Jun 30, 2026", cushion: "24.0%", statutory: "150", acSource: "tag", de: "1.15", nde: "1.10" });
      }
    },
    l4: {
      template: function (v) {
        return v.ticker + "'s modal spread bucket is " + v.modal + " bps over base (" + v.modalShare + "% of holdings by count), " + v.vs +
          " the site composite's " + v.compModal + " and LCD's " + v.lcdModal + ".";
      },
      sample: function () {
        return CAPTIONS.l4.template({ ticker: "ARCC", modal: "450-500", modalShare: "30.7", vs: "against", compModal: "450-500", lcdModal: "450-499" });
      }
    },
    l5: {
      template: function (v) {
        return v.ticker + "'s heaviest maturity bucket is " + v.bucket + " at " + v.share + "% of third-party debt by cost, " + v.vs +
          " the composite's " + v.compShare + "% and LCD's " + v.lcdShare + "% in the same bucket.";
      },
      sample: function () {
        return CAPTIONS.l5.template({ ticker: "ARCC", bucket: "2031-2033", share: "51.2", vs: "against", compShare: "33.1", lcdShare: "44.1" });
      }
    },
    l6: {
      template: function (v) {
        return v.ticker + "'s top sector is " + v.sector + " at " + v.share + "% of holdings by fair value; the composite's top sector is " +
          v.compSector + " at " + v.compShare + "%. Sector taxonomies are not identical across sources.";
      },
      sample: function () {
        return CAPTIONS.l6.template({ ticker: "ARCC", sector: "Software and Services", share: "13.5", compSector: "Software", compShare: "5.0" });
      }
    },
    l7: {
      template: function (v) {
        return v.ticker + "'s mark is " + v.mark + "× fair value to cost (" + v.asOf + "); non-accruals " + v.naCost + " of cost and " + v.naFv +
          " of fair value" + (v.holdingsAvailable ? "" : ", not yet parsed") + "; PIK " + v.pik + " of investment income.";
      },
      sample: function () {
        return CAPTIONS.l7.template({ ticker: "ARCC", mark: "0.989", asOf: "Jun 30, 2026", naCost: "2.4%", naFv: "1.4%", holdingsAvailable: true, pik: "15.8%" });
      }
    },
    l8: {
      template: function (v) {
        return v.ticker + "'s schedule of investments carries " + v.n + " holdings across " + v.issuers + " portfolio companies (" + v.asOf +
          "); top-10 issuer concentration " + v.top10 + " of fair value.";
      },
      sample: function () { return CAPTIONS.l8.template({ ticker: "ARCC", n: "1,439", issuers: "556", asOf: "Jun 30, 2026", top10: "10.5%" }); }
    },
    l9: {
      template: function (v) {
        return v.ticker + "'s watchlist carries " + v.n + " holdings (non-accrual, sub-0.80× mark or PIK-paying), " + v.cost + " of cost against " +
          v.fv + " of fair value, a " + v.gap + " markdown not yet realized.";
      },
      sample: function () { return CAPTIONS.l9.template({ ticker: "ARCC", n: "40", cost: "$1.20B", fv: "$0.95B", gap: "$250.0M" }); }
    },
    l12: {
      template: function (v) {
        return v.ticker + "'s NAV per share moved " + v.dNav + " in " + v.q + ": NII " + v.nii + " less distributions " + v.dist + " plus realized " +
          v.realized + " and unrealized " + v.unrealized + "; components " + v.matches + " the change.";
      },
      sample: function () {
        return CAPTIONS.l12.template({ ticker: "ARCC", dNav: "+$0.12", q: "Q2 2026", nii: "+$0.55", dist: "−$0.48", realized: "+$0.02", unrealized: "+$0.03", matches: "roughly match" });
      }
    },
    liability: {
      template: function (v) {
        return v.ticker + "'s debt is " + v.debt + " (" + v.de + "× equity); " + v.maturities12m +
          " matures in the next 12 months; a +100 bps shock lifts net income by " + v.shock100 + ", per the filing's own rate table.";
      },
      sample: function () { return CAPTIONS.liability.template({ ticker: "ARCC", debt: "$15.92B", de: "1.15", maturities12m: "not disclosed", shock100: "$94.0M" }); }
    },
    fee: {
      template: function (v) {
        return v.ticker + " pays " + v.mgmt + " base management plus " + v.incentive + " income incentive over a " + v.hurdle +
          "% hurdle" + (v.catchUp ? ", " + v.catchUp + "% catch-up" : "") + "; SBA exemptive relief " + v.sba + ".";
      },
      sample: function () { return CAPTIONS.fee.template({ ticker: "ARCC", mgmt: "1.50%", incentive: "20%", hurdle: "1.75", catchUp: "100", sba: "not stated" }); }
    }
  };

  /* ---------- catalog entries, registered once at module load ---------- */
  var ENTRIES = [
    { key: "lendersDrillNavPrice", label: "NAV vs price", group: "credit", format: "chart", direction: "context",
      formula: "Monthly close from the price feed, sliced to the filer's own listedSince; NetAssetValuePerShare from every filing instant in the series",
      watch: "The chart's span is the shorter of five years and time since listing — never a fixed five-year axis for a filer listed more recently. Price is live; NAV is a manager's quarterly mark.",
      definition: "What the market pays for a share beside what the fund says the share is worth in book value.",
      interpretation: "Below the 1.0× line (§63(2) of the 1940 Act) a BDC cannot sell new shares below NAV without a shareholder vote, so growth stops and buybacks start; read the premium or discount against the universe's own quartile, not only against 1.0×." },
    { key: "lendersDrillDividendCoverage", label: "Dividend coverage, 8 quarters", group: "credit", format: "chart", direction: "up",
      formula: "After-tax NII per share ÷ distributions per share, each of the last eight quarters that carry both figures",
      watch: "This data set carries one distributions-per-share figure, not a regular/supplemental/special split, so every bar is the same 'total' coverage the scorecard shows. The severity flag needs two straight quarters under 1.0×; a single soft quarter is highlighted but not flagged.",
      definition: "How many times the fund's after-tax income covered what it actually paid out, quarter by quarter.",
      interpretation: "A shortfall is met from spillover, realized gains or capital, in that order of comfort — none of which this chart shows directly. Two bars in a row under the line is the flag." },
    { key: "lendersDrillLeverage", label: "Leverage vs the statutory line", group: "credit", format: "chart", direction: "up",
      formula: "InvestmentCompanySeniorSecurityIndebtednessAssetCoverageRatio over the last twelve quarters; debt ÷ net assets, gross and net of cash, on a secondary axis",
      watch: "The 150% and 200% reference lines are the 1940 Act floors for a filer that did and did not make the 2018 election; terms.json's statutoryCoverage names which one applies where it has been read from the 10-K.",
      definition: "The 1940 Act's hardest leverage limit, over time, beside the balance-sheet leverage ratio that moves it.",
      interpretation: "A cushion narrowing while gross debt/equity is flat means net assets themselves are shrinking — read the two together." },
    { key: "lendersDrillSpreadHistogram", label: "Spread histogram vs the industry", group: "credit", format: "chart", direction: "context",
      formula: "Share of this filer's third-party debt by 50 bps spread-over-base bucket, by count (holdings.summary.histogram); the site composite's same buckets; LCD's BDC-holdings spread distribution by count, the newest quarter",
      watch: "LCD's bucket edges (400-449, 450-499, …) sit 1 bp off the site's own grid (400-450, 450-500, …); a bucket is matched to the site grid by its starting edge, which can blur a boundary loan. Only for a filer with a parsed schedule of investments.",
      definition: "Where this filer's loans are priced relative to the rest of its own book, the listed universe, and the market LCD tracks.",
      interpretation: "A modal bucket to the right of the composite's is a book priced wider than peers; read the migration against the industry outline, not the single quarter alone." },
    { key: "lendersDrillMaturityWall", label: "Maturity wall vs the industry", group: "credit", format: "chart", direction: "context",
      formula: "Share of this filer's third-party debt by cost in each maturity-year bucket (holdings.summary.maturity); the composite's same buckets; LCD's BDC maturity wall by cost share, the newest quarter",
      watch: "Equity, vehicle and CLO/CMBS holdings are excluded from all three series, as is a holding with no parsable maturity date; LCD's population is every BDC portfolio it tracks, not the site's listed universe: direction, not level.",
      definition: "When this filer's loan book comes due, against the rest of its own portfolio's due dates and the industry's.",
      interpretation: "A wall concentrated further out is refinancing risk deferred, not avoided; read it beside the liability card's own debt maturities." },
    { key: "lendersDrillSectorMix", label: "Sector mix vs the industry", group: "credit", format: "chart", direction: "context",
      formula: "This filer's top 10 industries by fair-value share (holdings.summary.industry); the composite's top 10 (composite.json sectorMix); LCD's top 10 by count, with the point change from the prior quarter's LCD snapshot where a bucket exceeds 2% of holdings by count in either quarter",
      watch: "Three different sector taxonomies (this filer's own labels, the site's GICS-style rollup, LCD's own buckets) are not identical; rows are matched by name where they clearly correspond and listed separately otherwise. A point change under the 2% threshold is not shown, since a handful of loans swings a small bucket's share sharply.",
      definition: "What kind of businesses this filer has lent to, most concentrated first, against the composite and the wider market.",
      interpretation: "Concentration in one sector is a name-level risk the aggregate non-accrual rate will not show until it arrives." },
    { key: "lendersDrillMarkStress", label: "Mark and stress", group: "credit", format: "chart", direction: "down",
      formula: "Fair value ÷ amortized cost and PIK share of total investment income, every quarter in the series; non-accrual rate at cost and fair value, the single latest quarter the schedule of investments covers",
      watch: "Non-accrual history is only ever one point: the data set carries a parsed schedule for the latest quarter alone, so additions and removals since the prior quarter cannot be computed and are not shown.",
      definition: "The book's cumulative mark, how much interest arrives as more paper instead of cash, and how much has stopped paying, read together.",
      interpretation: "A falling mark with flat non-accruals is the market's opinion of losses arriving before the payment defaults do; a rising PIK share with flat NII is cash earnings quietly falling." },
    { key: "lendersDrillHoldingsTable", label: "Holdings", group: "credit", format: "number", direction: "context",
      formula: "Every row of the filer's schedule of investments as parsed (issuer, affiliation, lien class, spread, all-in rate, floor, maturity, principal, cost, fair value, percent of net assets, PIK and non-accrual flags, unfunded commitment)",
      watch: "Paged on screen for readability; the export button pulls every row regardless of the page shown, from a hidden table built the moment the drill-down opens. \"Non-affiliated\" is shown where the filer's own affiliation tag is absent, the schedule's default bucket.",
      definition: "The full schedule of investments this filer reported, one row per position.",
      interpretation: "Sort by fair value ÷ cost or by spread to find the names carrying the book's risk; cross-check any one row against the filing itself before acting on it." },
    { key: "lendersDrillWatchlist", label: "Watchlist", group: "credit", format: "number", direction: "down",
      formula: "Every holding flagged non-accrual, every third-party debt holding with fair value ÷ cost under 0.80, and every holding carrying a PIK rate, deduplicated by holding id",
      watch: "A name can qualify on more than one test at once (a non-accrual loan is almost always also under 0.80×); the reason column names every test it met, and cost minus fair value is the unrealized markdown on that one line, not a portfolio total.",
      definition: "The names in this filer's book showing the earliest signs of stress, gathered onto one list.",
      interpretation: "A short list that keeps recurring across the coverage universe is a name to check across every BDC that holds it, not just this one." },
    { key: "lendersDrillReturnDecomposition", label: "Return decomposition, 8 quarters", group: "credit", format: "chart", direction: "context",
      formula: "Per share: after-tax NII − distributions + realized gains ÷ weighted shares + unrealized gains ÷ weighted shares, stacked against the quarter's actual change in NAV per share",
      watch: "Realized and unrealized gains are tagged only as total dollars, not per share; dividing by the quarter's weighted average share count is an approximation, so the stacked components can miss the actual NAV change by a few cents when shares were issued or repurchased mid-quarter.",
      definition: "What moved NAV per share this quarter: what was earned, what was paid out, and what the portfolio's marks did.",
      interpretation: "NII covering the distribution with gains adding on top is the healthy pattern; distributions exceeding NII while gains are negative is NAV being paid out of capital." },
    { key: "lendersDrillLiability", label: "Liability ladder and rate sensitivity", group: "credit", format: "number", direction: "context",
      formula: "Debt, revolver capacity, debt due within 12 months and unfunded commitments, the latest tagged quarter; the filing's own Item 3 interest-rate shock table where the build's own prose parser captured one",
      watch: "There is no XBRL concept for the Item 3 rate-shock table in this data set; where the build has not captured it for a filer, the card says so rather than estimating one from the debt and rate tags.",
      definition: "What this filer owes, when it comes due, and how a base-rate move would flow through to net income, in the filer's own words.",
      interpretation: "A rate-shock table that shows a large net income swing per 100 bps is a highly floating balance sheet; read it beside the floating-rate share on the holdings side." },
    { key: "lendersDrillFees", label: "Fee schedule", group: "credit", format: "pct", direction: "down",
      formula: "Base management fee rate, income incentive fee rate, hurdle, catch-up and capital-gains fee rate, parsed from the 10-K's investment advisory agreement note (terms.json); SBA exemptive-relief status",
      watch: "An internally managed fund pays no external fee and shows so, never a 0% rate. SBA status of \"unconfirmed seed\" is a seed assumption, not a filing-confirmed fact, and is never shown as \"confirmed\".",
      definition: "What the manager is paid, on what base, and whether this filer's SBIC debt is excluded from the asset-coverage test by exemptive relief.",
      interpretation: "A catch-up of 100% with no lookback means the manager reaches full participation the moment NII clears the hurdle; read the hurdle and catch-up together, not the headline rate alone." }
  ];
  if (CAT && typeof CAT.register === "function") CAT.register(ENTRIES);

  /* ---------- generic SVG chart primitives ---------- */
  var GOLD = "#f5c518", INK = "#8b8f98", LINE2 = "#b6bac2", LINE3 = "#e8eaed", GRID = "rgba(255,255,255,.08)",
    BAND_UP = "rgba(93,183,122,.14)", BAND_DOWN = "rgba(224,108,96,.14)", RED = "#e06c60", GREEN = "#5db77a";

  /* a categorical multi-series chart: bars (grouped or stacked) and/or
     lines over the same evenly spaced categories, with up to one
     secondary axis and any number of labeled horizontal reference lines.
     series: [{label, color, values:[num|null,...], type:"bar"|"line",
       axis:"y"|"y2", dashed}]; opts: { categories, yfmt, y2fmt, refLines:
       [{value, label, axis, color, dashed}], stackBar (group key → bars
       in that group stack instead of sitting side by side), height } */
  function catChart(spec) {
    var W = 620, H = spec.height || 220, padL = 46, padR = spec.axis2 ? 46 : 14, padT = 14, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    var cats = spec.categories || [];
    var n = cats.length;
    if (!n) return "";
    var series = spec.series || [];
    var y1s = [], y2s = [];
    series.forEach(function (s) {
      (s.values || []).forEach(function (v) { if (isNum(v)) (s.axis === "y2" ? y2s : y1s).push(v); });
    });
    (spec.refLines || []).forEach(function (r) { if (isNum(r.value)) (r.axis === "y2" ? y2s : y1s).push(r.value); });
    function scaleOf(vals) {
      if (!vals.length) return null;
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      if (spec.zero !== false) lo = Math.min(lo, 0);
      if (lo === hi) { lo -= 1; hi += 1; }
      var pad = (hi - lo) * 0.1; hi += pad; if (lo < 0) lo -= pad * 0.4;
      return { lo: lo, hi: hi };
    }
    var s1 = scaleOf(y1s), s2 = scaleOf(y2s);
    var Y1 = s1 ? function (v) { return padT + ih - ((v - s1.lo) / (s1.hi - s1.lo)) * ih; } : function () { return padT + ih; };
    var Y2 = s2 ? function (v) { return padT + ih - ((v - s2.lo) / (s2.hi - s2.lo)) * ih; } : Y1;
    var X = function (i) { return padL + (i + 0.5) / n * iw; };
    var yfmt = spec.yfmt || function (v) { return v.toFixed(1); };
    var y2fmt = spec.y2fmt || yfmt;
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='" + esc(spec.label || "") + "'>";
    if (s1) [0.25, 0.5, 0.75].forEach(function (f) {
      var g = s1.lo + (s1.hi - s1.lo) * f;
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + Y1(g).toFixed(1) + "' y2='" + Y1(g).toFixed(1) + "' stroke='" + GRID + "' stroke-width='1'/>" +
        "<text x='" + (padL - 5) + "' y='" + (Y1(g) + 3).toFixed(1) + "' text-anchor='end' font-size='8.5' fill='" + INK + "'>" + esc(yfmt(g)) + "</text>";
    });
    if (s1 && s1.lo < 0 && s1.hi > 0) out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + Y1(0).toFixed(1) + "' y2='" + Y1(0).toFixed(1) + "' stroke='" + INK + "' stroke-width='.6'/>";
    var barTypes = series.filter(function (s) { return s.type !== "line"; });
    var barW = Math.min(22, (iw / n) / (Math.max(1, barTypes.length) + 1));
    var groupI = 0;
    series.forEach(function (s) {
      if (s.type === "line") return;
      var color = s.color || GOLD, offset = (groupI - (barTypes.length - 1) / 2) * (barW + 3);
      groupI++;
      var Yf = s.axis === "y2" ? Y2 : Y1, zero = s.axis === "y2" ? Y2(0) : Y1(0);
      (s.values || []).forEach(function (v, i) {
        if (!isNum(v)) return;
        var x = X(i) + offset - barW / 2, y = Math.min(Yf(v), zero), h = Math.max(1, Math.abs(Yf(v) - zero));
        out += "<rect x='" + x.toFixed(1) + "' y='" + y.toFixed(1) + "' width='" + barW.toFixed(1) + "' height='" + h.toFixed(1) +
          "' fill='" + color + "' opacity='" + (s.opacity || 0.9) + "'><title>" + esc((s.label || "") + " " + cats[i] + ": " + yfmt(v)) + "</title></rect>";
      });
    });
    series.forEach(function (s) {
      if (s.type !== "line") return;
      var color = s.color || GOLD, Yf = s.axis === "y2" ? Y2 : Y1;
      var pts = (s.values || []).map(function (v, i) { return isNum(v) ? { i: i, v: v } : null; }).filter(Boolean);
      if (pts.length > 1) {
        var d = pts.map(function (p, k) { return (k ? "L" : "M") + X(p.i).toFixed(1) + " " + Yf(p.v).toFixed(1); }).join(" ");
        out += "<path d='" + d + "' fill='none' stroke='" + color + "' stroke-width='1.8'" + (s.dashed ? " stroke-dasharray='4 3'" : "") + " stroke-linejoin='round'/>";
      }
      pts.forEach(function (p) {
        out += "<circle cx='" + X(p.i).toFixed(1) + "' cy='" + Yf(p.v).toFixed(1) + "' r='2.6' fill='" + color + "'><title>" + esc((s.label || "") + " " + cats[p.i] + ": " + yfmt(p.v)) + "</title></circle>";
      });
    });
    (spec.refLines || []).forEach(function (r) {
      if (!isNum(r.value)) return;
      var Yf = r.axis === "y2" ? Y2 : Y1, y = Yf(r.value);
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + y.toFixed(1) + "' y2='" + y.toFixed(1) + "' stroke='" + (r.color || INK) +
        "' stroke-width='1.2'" + (r.dashed !== false ? " stroke-dasharray='3 3'" : "") + "/>" +
        "<text x='" + (W - padR) + "' y='" + (y - 3).toFixed(1) + "' text-anchor='end' font-size='8.5' fill='" + (r.color || INK) + "'>" + esc(r.label || "") + "</text>";
    });
    cats.forEach(function (c, i) {
      if (n > 10 && i % Math.ceil(n / 10) !== 0 && i !== n - 1) return;
      out += "<text x='" + X(i).toFixed(1) + "' y='" + (H - 8) + "' text-anchor='middle' font-size='8.5' fill='" + INK + "'>" + esc(c) + "</text>";
    });
    out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + (padT + ih) + "' y2='" + (padT + ih) + "' stroke='" + GRID + "' stroke-width='1'/>";
    return out + "</svg>";
  }

  /* a stacked bar chart with a change-in-total line overlaid (L12):
     components: [{label, color, values:[num|null]}]; totalActual:
     [num|null] drawn as a marker on top of each stack for comparison. */
  function stackChart(spec) {
    var W = 620, H = spec.height || 220, padL = 46, padR = 14, padT = 14, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    var cats = spec.categories || []; var n = cats.length;
    if (!n) return "";
    var comps = spec.components || [];
    var stackVals = cats.map(function (_, i) {
      var pos = 0, neg = 0;
      comps.forEach(function (c) { var v = c.values[i]; if (isNum(v)) { if (v >= 0) pos += v; else neg += v; } });
      return { pos: pos, neg: neg };
    });
    var all = [];
    stackVals.forEach(function (s) { all.push(s.pos, s.neg); });
    (spec.totalActual || []).forEach(function (v) { if (isNum(v)) all.push(v); });
    var lo = Math.min(0, Math.min.apply(null, all)), hi = Math.max(0, Math.max.apply(null, all));
    if (lo === hi) { lo -= 1; hi += 1; }
    var pad = (hi - lo) * 0.12; hi += pad; lo -= pad;
    var Y = function (v) { return padT + ih - ((v - lo) / (hi - lo)) * ih; };
    var X = function (i) { return padL + (i + 0.5) / n * iw; };
    var barW = Math.min(34, iw / n * 0.6);
    var yfmt = spec.yfmt || function (v) { return v.toFixed(2); };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='" + esc(spec.label || "") + "'>";
    [0.25, 0.5, 0.75].forEach(function (f) {
      var g = lo + (hi - lo) * f;
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + Y(g).toFixed(1) + "' y2='" + Y(g).toFixed(1) + "' stroke='" + GRID + "' stroke-width='1'/>" +
        "<text x='" + (padL - 5) + "' y='" + (Y(g) + 3).toFixed(1) + "' text-anchor='end' font-size='8.5' fill='" + INK + "'>" + esc(yfmt(g)) + "</text>";
    });
    out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + Y(0).toFixed(1) + "' y2='" + Y(0).toFixed(1) + "' stroke='" + INK + "' stroke-width='.8'/>";
    var running = cats.map(function () { return { pos: 0, neg: 0 }; });
    comps.forEach(function (c) {
      (c.values || []).forEach(function (v, i) {
        if (!isNum(v)) return;
        var r = running[i], y0, y1;
        if (v >= 0) { y0 = Y(r.pos); r.pos += v; y1 = Y(r.pos); } else { y0 = Y(r.neg); r.neg += v; y1 = Y(r.neg); }
        var top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
        out += "<rect x='" + (X(i) - barW / 2).toFixed(1) + "' y='" + top.toFixed(1) + "' width='" + barW.toFixed(1) + "' height='" + h.toFixed(1) +
          "' fill='" + c.color + "'><title>" + esc(c.label + " " + cats[i] + ": " + yfmt(v)) + "</title></rect>";
      });
    });
    (spec.totalActual || []).forEach(function (v, i) {
      if (!isNum(v)) return;
      var x = X(i), y = Y(v);
      out += "<path d='M " + (x - 5).toFixed(1) + " " + y.toFixed(1) + " L " + x.toFixed(1) + " " + (y - 5).toFixed(1) + " L " + (x + 5).toFixed(1) + " " + y.toFixed(1) +
        " L " + x.toFixed(1) + " " + (y + 5).toFixed(1) + " Z' fill='" + LINE3 + "' stroke='#0b0c0f' stroke-width='.8'><title>Actual change in NAV/share " +
        esc(cats[i]) + ": " + esc(yfmt(v)) + "</title></path>";
    });
    cats.forEach(function (c, i) {
      out += "<text x='" + X(i).toFixed(1) + "' y='" + (H - 8) + "' text-anchor='middle' font-size='8.5' fill='" + INK + "'>" + esc(c) + "</text>";
    });
    return out + "</svg>";
  }

  /* a true date-axis line chart for L1: two lines (NAV, price) with the
     premium/discount band shaded between them. */
  function navPriceSvg(navPts, pricePts, opts) {
    var W = 640, H = 260, padL = 48, padR = 14, padT = 14, padB = 24;
    var iw = W - padL - padR, ih = H - padT - padB;
    var all = navPts.concat(pricePts).filter(function (p) { return p && isNum(p.v) && p.d; });
    if (all.length < 2) return "";
    var ts = all.map(function (p) { return ms(p.d); });
    var t0 = Math.min.apply(null, ts), t1 = Math.max.apply(null, ts);
    if (t1 === t0) t1 = t0 + 86400000;
    var vals = all.map(function (p) { return p.v; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (lo === hi) { lo -= 1; hi += 1; }
    var vpad = (hi - lo) * 0.08; hi += vpad; lo -= vpad;
    var X = function (t) { return padL + (t - t0) / (t1 - t0) * iw; };
    var Y = function (v) { return padT + ih - (v - lo) / (hi - lo) * ih; };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='NAV vs price'>";
    [0.25, 0.5, 0.75].forEach(function (f) {
      var g = lo + (hi - lo) * f;
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + Y(g).toFixed(1) + "' y2='" + Y(g).toFixed(1) + "' stroke='" + GRID + "' stroke-width='1'/>" +
        "<text x='" + (padL - 5) + "' y='" + (Y(g) + 3).toFixed(1) + "' text-anchor='end' font-size='8.5' fill='" + INK + "'>$" + g.toFixed(0) + "</text>";
    });
    /* premium/discount band: sampled at each NAV instant, filled to the
       interpolated price at that date */
    function priceAt(t) {
      var before = null, after = null;
      pricePts.forEach(function (p) { var pt = ms(p.d); if (pt <= t && (!before || pt > ms(before.d))) before = p; if (pt >= t && (!after || pt < ms(after.d))) after = p; });
      if (before && after && before !== after) {
        var span = ms(after.d) - ms(before.d);
        return span > 0 ? before.v + (after.v - before.v) * (t - ms(before.d)) / span : before.v;
      }
      return before ? before.v : (after ? after.v : null);
    }
    var navSorted = navPts.filter(function (p) { return p && isNum(p.v) && p.d; }).sort(function (a, b) { return ms(a.d) - ms(b.d); });
    navSorted.forEach(function (p, i) {
      var pr = priceAt(ms(p.d));
      if (!isNum(pr)) return;
      var up = pr >= p.v, xN = X(ms(p.d)), yN = Y(p.v), yP = Y(pr);
      var next = navSorted[i + 1];
      var xNext = next ? X(ms(next.d)) : xN + iw * 0.02;
      out += "<rect x='" + xN.toFixed(1) + "' y='" + Math.min(yN, yP).toFixed(1) + "' width='" + Math.max(1, xNext - xN).toFixed(1) +
        "' height='" + Math.max(1, Math.abs(yN - yP)).toFixed(1) + "' fill='" + (up ? BAND_UP : BAND_DOWN) + "'></rect>";
    });
    function line(pts, color, width) {
      var sorted = pts.filter(function (p) { return p && isNum(p.v) && p.d; }).sort(function (a, b) { return ms(a.d) - ms(b.d); });
      if (sorted.length < 2) return "";
      var d = sorted.map(function (p, i) { return (i ? "L" : "M") + X(ms(p.d)).toFixed(1) + " " + Y(p.v).toFixed(1); }).join(" ");
      return "<path d='" + d + "' fill='none' stroke='" + color + "' stroke-width='" + width + "' stroke-linejoin='round'/>";
    }
    out += line(pricePts, GOLD, 1.8) + line(navPts, LINE3, 2);
    var y0 = new Date(t0).getUTCFullYear(), y1y = new Date(t1).getUTCFullYear();
    for (var y = y0; y <= y1y; y++) {
      var tx = ms(y + "-01-01"); if (tx < t0 || tx > t1) continue;
      out += "<text x='" + X(tx).toFixed(1) + "' y='" + (H - 6) + "' text-anchor='middle' font-size='8.5' fill='" + INK + "'>" + y + "</text>";
    }
    return out + "</svg>";
  }

  /* a horizontal-bar comparison strip: this BDC vs up to two references,
     for one category. bars: [{label,color,value}] */
  function hbars(bars, opts) {
    var max = Math.max(0.0001, Math.max.apply(null, bars.map(function (b) { return isNum(b.value) ? b.value : 0; })));
    var yfmt = (opts && opts.yfmt) || function (v) { return (v * 100).toFixed(1) + "%"; };
    return "<div class='ld-hbars'>" + bars.map(function (b) {
      var pct = isNum(b.value) ? Math.max(0, Math.min(100, b.value / max * 100)) : 0;
      return "<div class='ld-hbar-row'><span class='ld-hbar-label'>" + esc(b.label) + "</span>" +
        "<span class='ld-hbar-track'><i style='width:" + pct.toFixed(1) + "%;background:" + (b.color || GOLD) + "'></i></span>" +
        "<span class='ld-hbar-val'>" + (isNum(b.value) ? esc(yfmt(b.value)) : "—") + "</span></div>";
    }).join("") + "</div>";
  }

  /* ---------- panel shell helpers ---------- */
  /* footer: the source/edition/as-of stamp (blueprint §9: "the source,
     edition and as-of stamp goes in the tile footer") — every other
     section file (credit-stress.js, credit-capital.js, credit-
     dealflow.js) carries one on every chart; this file's panels carried
     none until now (round-2 fixer finding). Optional and omitted for an
     empty-state panel, which has no figure to source. */
  function panel(key, title, body, caption, howToRead, empty, footer) {
    return "<figure class='ld-panel'><h3><span class='h-pop' data-metric='" + esc(key) + "'>" + esc(title) + "</span></h3>" +
      (empty ? "<div class='ld-empty'>" + empty + "</div>" : body) +
      (caption ? "<figcaption class='ld-caption'>" + caption + "</figcaption>" : "") +
      (howToRead ? "<details class='how-to-read'><summary>How to read this</summary><p>" + howToRead + "</p></details>" : "") +
      (footer ? "<p class='tile-foot'>" + footer + "</p>" : "") +
      "</figure>";
  }
  function emptyState(title, why) { return "<span>" + esc(title) + "</span>" + (why ? "<small>" + esc(why) + "</small>" : ""); }

  /* ---------- bucket alignment (L4, L5) ----------
     Both the site's own histogram/maturity buckets and the composite's
     use identical label text (holdings.summary.histogram/maturity is
     built the same way composite.json is); LCD's own buckets use
     slightly different edges and are matched onto the site's grid by
     their starting bps/year, never assumed to line up label for label. */
  function bucketStart(label) {
    var s = String(label || "");
    if (/^</.test(s) || /^(under|less than)/i.test(s)) return -Infinity;
    var m = s.match(/(\d{3,4})\s*(?:-|to)\s*\d{3,4}/) || s.match(/^(\d{3,4})/);
    if (m) return Number(m[1]);
    if (/or higher|\+$/i.test(s)) { var m2 = s.match(/(\d{3,4})/); return m2 ? Number(m2[1]) : Infinity; }
    return null;
  }
  /* year buckets ("2026", "2031-2033", "2031 - 2033", "later") */
  function yearBucketStart(label) {
    var s = String(label || "").replace(/\s+/g, "");
    if (/^later/i.test(s)) return Infinity;
    var m = s.match(/^(\d{4})/);
    return m ? Number(m[1]) : null;
  }
  function normYearLabel(label) { return String(label || "").replace(/\s*-\s*/g, "-").trim(); }

  function alignSpreadBuckets(ownMap, compositeMap, lcdItems) {
    var siteKeys = Object.keys(ownMap || {}).filter(function (k) { return isNum(ownMap[k]); })
      .concat(Object.keys(compositeMap || {}).filter(function (k) { return isNum(compositeMap[k]) && !(k in (ownMap || {})); }));
    var uniq = []; siteKeys.forEach(function (k) { if (uniq.indexOf(k) < 0) uniq.push(k); });
    uniq.sort(function (a, b) { return bucketStart(a) - bucketStart(b); });
    var bounds = uniq.map(bucketStart);
    var lcdByStart = {};
    (lcdItems || []).forEach(function (it) {
      var st = bucketStart(it.c);
      if (st === null) return;
      var nearest = uniq[0], best = Infinity;
      bounds.forEach(function (b, i) { var d = Math.abs((isFinite(b) ? b : (st >= 1000 ? 1000 : -50)) - st); if (d < best) { best = d; nearest = uniq[i]; } });
      lcdByStart[nearest] = (lcdByStart[nearest] || 0) + (isNum(it.v) ? it.v : 0);
    });
    return uniq.map(function (k) { return { label: k, own: isNum(ownMap[k]) ? ownMap[k] : null, composite: isNum(compositeMap && compositeMap[k]) ? compositeMap[k] : null, lcd: isNum(lcdByStart[k]) ? lcdByStart[k] : null }; });
  }
  function alignYearBuckets(ownMap, compositeMap, lcdItems) {
    var SKIP = { total: 1, dated: 1, unfunded: 1, excluded: 1, "n/a": 1, shares: 1, filers: 1 };
    var keys = Object.keys(ownMap || {}).filter(function (k) { return !SKIP[k] && isNum(ownMap[k]); });
    keys.sort(function (a, b) { var sa = yearBucketStart(a), sb = yearBucketStart(b); return sa - sb; });
    var ownTotal = keys.reduce(function (a, k) { return a + ownMap[k]; }, 0) || null;
    var compTotal = compositeMap ? Object.keys(compositeMap).filter(function (k) { return !SKIP[k] && isNum(compositeMap[k]); })
      .reduce(function (a, k) { return a + compositeMap[k]; }, 0) : null;
    var lcdByYear = {};
    (lcdItems || []).forEach(function (it) { lcdByYear[normYearLabel(it.c)] = isNum(it.v) ? it.v : null; });
    return keys.map(function (k) {
      var lcdKey = Object.keys(lcdByYear).filter(function (lk) { return yearBucketStart(lk) === yearBucketStart(k); })[0];
      return { label: k, ownCost: ownMap[k], ownShare: ownTotal ? ownMap[k] / ownTotal : null,
        compositeShare: compositeMap && isNum(compositeMap[k]) && compTotal ? compositeMap[k] / compTotal : null,
        lcd: lcdKey ? lcdByYear[lcdKey] : null };
    });
  }

  /* ---------- sector-name matching (L6) ----------
     Loose, deliberately conservative: normalize to lowercase words with
     "and"/"services"/punctuation stripped, and match on the first
     surviving significant token. A row that matches nothing is listed
     on its own rather than forced into a wrong pair. */
  var STOP = { and: 1, services: 1, the: 1, of: 1, "non-financial": 1 };
  function sectorTokens(name) {
    return String(name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter(function (t) { return t && !STOP[t]; });
  }
  function sectorMatch(a, b) {
    var ta = sectorTokens(a), tb = sectorTokens(b);
    return ta.some(function (t) { return tb.indexOf(t) >= 0; });
  }

  /* ---------- assembling one open() ---------- */
  function findUniverseRow(universe, ticker) {
    if (!universe) return null;
    if (universe.ticker === ticker) return universe;
    if (Array.isArray(universe.rows)) { for (var i = 0; i < universe.rows.length; i++) if (universe.rows[i].ticker === ticker) return universe.rows[i]; }
    return null;
  }
  function findRefusal(coverage, ticker) {
    var list = coverage && coverage.holdings && coverage.holdings.tickers_refused;
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].ticker === ticker) return list[i];
    return null;
  }

  /* ---------- L1: NAV vs price ---------- */
  function buildL1(ticker, company, uRow, priceHistory) {
    var series = company && company.series;
    var navPts = orderedPeriods(series).map(function (p) { return { d: p.end, v: periodVal(p, "navPerShare") }; }).filter(function (p) { return isNum(p.v); });
    if (!navPts.length) return { html: panel("lendersDrillNavPrice", "NAV vs price", "", "", null, emptyState("No NAV history", "navPerShare is not tagged for any quarter on file.")), caption: "" };
    var listedSince = uRow && uRow.listedSince;
    var pricePts = (priceHistory || []).filter(function (p) { return !listedSince || p.d >= listedSince; });
    if (!pricePts.length) {
      var last1 = last(navPts);
      return { html: panel("lendersDrillNavPrice", "NAV vs price", "", "", null,
        emptyState("Price history not available", "The market feed did not answer for " + ticker + "; NAV alone is " + fmtPerShare(last1.v) + " as of " + fmtDate(last1.d) + ".")), caption: "" };
    }
    /* the band, the regime sentence and the caption's own span must all
       describe the same drawn axis: slice NAV to the price feed's actual
       date range (round-2 fixer finding — an unsliced navPts let a
       pre-listing or pre-feed NAV quarter get shaded against a price
       quote that did not exist yet, and the caption's "N years" span was
       computed from listedSince alone rather than from what was drawn). */
    var priceSorted = pricePts.slice().sort(function (a, b) { return ms(a.d) - ms(b.d); });
    var priceStart = priceSorted[0].d, priceEnd = priceSorted[priceSorted.length - 1].d;
    var navPtsInWindow = navPts.filter(function (p) { return ms(p.d) >= ms(priceStart) && ms(p.d) <= ms(priceEnd); });
    if (!navPtsInWindow.length) {
      return { html: panel("lendersDrillNavPrice", "NAV vs price", "", "", null,
        emptyState("No NAV in the priced window", "Every tagged NAV quarter on file falls outside the price feed's own date range for " + ticker + ".")), caption: "" };
    }
    var spanYears = Math.round((ms(priceEnd) - ms(priceStart)) / (365.25 * 86400000) * 10) / 10;
    var listingBound = listedSince && Math.abs(ms(listedSince) - ms(priceStart)) < 40 * 86400000;
    var span = spanYears.toFixed(1) + " years" + (listingBound ? " since listing" : "");
    var lastNav = last(navPtsInWindow), lastPrice = last(priceSorted);
    var ptn = RTCredit ? RTCredit.priceToNav(lastPrice.v, lastNav.v) : (isNum(lastNav.v) && lastNav.v ? lastPrice.v / lastNav.v : null);
    var above = navPtsInWindow.filter(function (p) {
      var pr = pricePts.filter(function (q) { return q.d <= p.d; }); pr = pr.length ? pr[pr.length - 1] : pricePts[0];
      return pr.v >= p.v;
    }).length;
    var regime = above / navPtsInWindow.length > 0.6 ? "a premium for most of the span" : above / navPtsInWindow.length < 0.4 ? "a discount for most of the span" : "swinging between a premium and a discount";
    var html = "<div class='ld-chart'>" + navPriceSvg(navPtsInWindow, pricePts) + "</div>" +
      "<div class='ld-legend'><span><i style='background:" + LINE3 + "'></i>NAV per share</span><span><i style='background:" + GOLD + "'></i>Price</span>" +
      "<span><i style='background:" + BAND_UP + "'></i>Premium</span><span><i style='background:" + BAND_DOWN + "'></i>Discount</span></div>" +
      "<p class='ld-ref'>1.0× (§63(2)) marks the level below which a BDC cannot sell new shares below NAV without a shareholder vote; current price/NAV: " + fmtX(ptn) + "</p>" +
      "<p class='ld-limitation'>The Cliffwater BDC Index — the sector line planned behind this chart — is agreed for a later release but not yet ingested into this build; the premium or discount above is read against 1.0× alone until it lands.</p>";
    var caption = CAPTIONS.l1.template({ ticker: ticker, priceToNav: isNum(ptn) ? ptn.toFixed(2) : "—", asOf: fmtDate(lastPrice.d),
      price: fmtPerShare(lastPrice.v), nav: fmtPerShare(lastNav.v), regime: regime, span: span });
    return { html: panel("lendersDrillNavPrice", "NAV vs price", html, esc(caption),
      "The shaded band is the premium or discount at each NAV date, priced against the nearest trading day; the chart's horizontal span is the shorter of five years and time since listing, so a recently listed filer is never stretched across an axis it has no history for. Read the premium or discount against the universe's own price/NAV quartile (the scorecard's own severity stripe), not only against 1.0×.", null,
      "Source: the market feed (price) and SEC EDGAR companyfacts (NAV) · as of " + esc(fmtDate(lastPrice.d))) };
  }

  /* ---------- L2: dividend coverage ---------- */
  function buildL2(ticker, company) {
    var periods = orderedPeriods(company && company.series).filter(function (p) {
      return isNum(periodVal(p, "niiPerShare")) && isNum(periodVal(p, "distributionsPerShare"));
    }).slice(-8);
    if (periods.length < 2) {
      return panel("lendersDrillDividendCoverage", "Dividend coverage, 8 quarters", "", "",
        null, emptyState("Not enough quarters", "Fewer than two quarters carry both NII/share and distributions/share."));
    }
    var cats = periods.map(function (p) { return quarterLabel(p.end); });
    var nii = periods.map(function (p) { return periodVal(p, "niiPerShare"); });
    var dist = periods.map(function (p) { return periodVal(p, "distributionsPerShare"); });
    var cov = periods.map(function (p) { return RTCredit ? RTCredit.div(periodVal(p, "niiPerShare"), periodVal(p, "distributionsPerShare")) : null; });
    var lastTwo = cov.slice(-2);
    var flagged = lastTwo.length === 2 && lastTwo.every(function (c) { return isNum(c) && c < 1; });
    var chart = catChart({ label: "Dividend coverage", categories: cats,
      series: [
        { label: "NII/share", color: GOLD, values: nii, type: "bar" },
        { label: "Distributions/share", color: LINE2, values: dist, type: "bar" },
        { label: "Coverage ×", color: LINE3, values: cov, type: "line", axis: "y2" }
      ], axis2: true, yfmt: function (v) { return "$" + v.toFixed(2); }, y2fmt: function (v) { return v.toFixed(2) + "×"; },
      refLines: [{ value: 1, label: "1.0×", axis: "y2", color: GREEN }] });
    var lastCov = last(cov), priorCov = cov[cov.length - 2];
    var caption = CAPTIONS.l2.template({ ticker: ticker, last: isNum(lastCov) ? lastCov.toFixed(2) : "—", lastQ: quarterLabel(last(periods).end),
      prior: isNum(priorCov) ? priorCov.toFixed(2) : "—", flagged: flagged });
    return panel("lendersDrillDividendCoverage", "Dividend coverage, 8 quarters", "<div class='ld-chart'>" + chart + "</div>" +
      "<div class='ld-legend'><span><i style='background:" + GOLD + "'></i>NII/share</span><span><i style='background:" + LINE2 + "'></i>Distributions/share</span><span><i style='background:" + LINE3 + "'></i>Coverage ×</span></div>",
      esc(caption), "Two bars in a row below the 1.0× line — never a single soft quarter — is the scorecard's flag. This data set carries one distributions-per-share figure, not a regular/supplemental/special split, so every bar is the same combined coverage the scorecard shows.",
      null, "Source: SEC EDGAR companyfacts · as of " + esc(quarterLabel(last(periods).end)));
  }

  /* ---------- L3: leverage vs the statutory line ---------- */
  function buildL3(ticker, company, terms, universeAcSource, disclosedAc) {
    var disputed = !!(disclosedAc && Array.isArray(disclosedAc.flags) && disclosedAc.flags.length > 0);
    var periods = orderedPeriods(company && company.series).filter(function (p) { return isNum(periodVal(p, "assetCoverage")); }).slice(-12);
    var statutory = (terms && terms.statutoryCoverage && isNum(terms.statutoryCoverage.value)) ? terms.statutoryCoverage.value :
      (disclosedAc && isNum(disclosedAc.statutory)) ? disclosedAc.statutory : 150;
    if (!periods.length) {
      /* No tagged quarter at all: the scorecard falls back to the 10-Q's
         own prose sentence (company.disclosed.assetCoverage) for this
         case (MAIN's 244% is exactly this path) — the drill-down used to
         show "not disclosed" for the same filer the scorecard's own row
         prints a value for (round-2 fixer finding). There is only ever
         one prose reading per filing, never a quarter-by-quarter prose
         history, so this is a single-point display, not a 12-quarter
         chart. */
      if (disputed) {
        return panel("lendersDrillLeverage", "Leverage vs the statutory line", "", "", null,
          emptyState("Tag and prose disagree", "This filer's tagged and prose asset-coverage readings differ by more than 2 points; shown on the scorecard row but not trusted enough to compute a cushion here either."));
      }
      if (!disclosedAc || !isNum(disclosedAc.v)) {
        return panel("lendersDrillLeverage", "Leverage vs the statutory line", "", "", null, emptyState("Not disclosed", "assetCoverage is not tagged for any quarter on file, and no prose sentence has been parsed either."));
      }
      var allPeriods = orderedPeriods(company && company.series);
      var latestP = last(allPeriods);
      var lastAcP = disclosedAc.v;
      var cushionP = RTCredit ? RTCredit.assetCoverageCushion(lastAcP, statutory) : null;
      var deP = latestP ? (RTCredit ? RTCredit.debtToEquity(periodVal(latestP, "debt"), periodVal(latestP, "netAssets")) : null) : null;
      var ndeP = latestP ? (RTCredit ? RTCredit.netDebtToEquity(periodVal(latestP, "debt"), periodVal(latestP, "cash"), periodVal(latestP, "netAssets")) : null) : null;
      var asOfP = disclosedAc.period || (latestP && latestP.end);
      var bodyP = "<div class='ld-tiles'>" +
        "<div class='ld-tile'><span>Asset coverage (prose)</span><b>" + fmtX(lastAcP) + "</b></div>" +
        "<div class='ld-tile'><span>Cushion over " + statutory + "%</span><b>" + (isNum(cushionP) ? (cushionP * 100).toFixed(1) + "%" : na()) + "</b></div>" +
        "<div class='ld-tile'><span>Debt/equity, gross</span><b>" + (isNum(deP) ? fmtX(deP) : na()) + "</b></div>" +
        "<div class='ld-tile'><span>Debt/equity, net</span><b>" + (isNum(ndeP) ? fmtX(ndeP) : na()) + "</b></div>" +
        "</div>";
      var captionP = CAPTIONS.l3.template({ ticker: ticker, ac: lastAcP.toFixed(2), asOf: fmtDate(asOfP),
        cushion: isNum(cushionP) ? (cushionP * 100).toFixed(1) + "%" : "—", statutory: statutory, acSource: "prose",
        de: isNum(deP) ? deP.toFixed(2) : "—", nde: isNum(ndeP) ? ndeP.toFixed(2) : "—" });
      return panel("lendersDrillLeverage", "Leverage vs the statutory line", bodyP, esc(captionP),
        "assetCoverage is not XBRL-tagged for any quarter on file; the figure above is read from the 10-Q's own prose sentence for the latest filed quarter only, so no multi-quarter chart is shown. " + statutory + "% is the 1940 Act floor for a filer that made the 2018 election, defaulting to 150% where a filing has not confirmed one.",
        null, "Source: the 10-Q's own prose sentence (SEC EDGAR) · as of " + esc(fmtDate(asOfP)));
    }
    var cats = periods.map(function (p) { return quarterLabel(p.end); });
    var ac = periods.map(function (p) { return periodVal(p, "assetCoverage"); });
    var de = periods.map(function (p) { return RTCredit ? RTCredit.debtToEquity(periodVal(p, "debt"), periodVal(p, "netAssets")) : null; });
    var nde = periods.map(function (p) { return RTCredit ? RTCredit.netDebtToEquity(periodVal(p, "debt"), periodVal(p, "cash"), periodVal(p, "netAssets")) : null; });
    var lastAc = last(ac);
    /* the scorecard never fires its cushion flag when the tag and prose
       readings for this filer disagree by more than 2 points (CION,
       KBDC, PFX); the drill-down used to compute and print a cushion
       here regardless — the exact number the scorecard withholds as
       untrustworthy (round-2 fixer finding). */
    var cushion = disputed ? null : (RTCredit ? RTCredit.assetCoverageCushion(lastAc, statutory) : null);
    var chart = catChart({ label: "Leverage", categories: cats,
      series: [
        { label: "Asset coverage ×", color: LINE3, values: ac, type: "line" },
        { label: "Debt/equity, gross", color: GOLD, values: de, type: "line", axis: "y2" },
        { label: "Debt/equity, net", color: LINE2, values: nde, type: "line", axis: "y2", dashed: true }
      ], axis2: true, yfmt: function (v) { return v.toFixed(2) + "×"; }, y2fmt: function (v) { return v.toFixed(2) + "×"; },
      refLines: [{ value: 1.5, label: "150%", color: GREEN }, { value: 2.0, label: "200%", color: RED }] });
    var acSrc = (disclosedAc && disclosedAc.acSource) || universeAcSource || "tag";
    /* the standard template wraps v.cushion as "X% cushion over the Y%
       line" — a disputed reading has no cushion figure to slot in there
       without reading awkwardly, so it gets its own sentence instead of
       being forced through the template's cushion slot. */
    var caption;
    if (disputed) {
      caption = ticker + "'s asset coverage was " + lastAc.toFixed(2) + "× on " + fmtDate(last(periods).end) + " (" + acSrc +
        "); the tag and prose readings disagree by more than 2 points, so no cushion is shown; gross debt/equity " +
        (isNum(last(de)) ? last(de).toFixed(2) : "—") + "×, net " + (isNum(last(nde)) ? last(nde).toFixed(2) : "—") + "×.";
    } else {
      caption = CAPTIONS.l3.template({ ticker: ticker, ac: lastAc.toFixed(2), asOf: fmtDate(last(periods).end),
        cushion: isNum(cushion) ? (cushion * 100).toFixed(1) + "%" : "—", statutory: statutory, acSource: acSrc,
        de: isNum(last(de)) ? last(de).toFixed(2) : "—", nde: isNum(last(nde)) ? last(nde).toFixed(2) : "—" });
    }
    return panel("lendersDrillLeverage", "Leverage vs the statutory line", "<div class='ld-chart'>" + chart + "</div>" +
      "<div class='ld-legend'><span><i style='background:" + LINE3 + "'></i>Asset coverage ×</span><span><i style='background:" + GOLD + "'></i>Debt/equity gross</span><span><i style='background:" + LINE2 + "'></i>Debt/equity net</span><span>acSource: " + esc(acSrc) + "</span></div>" +
      (disputed ? "<p class='ld-limitation'>This filer's tagged (" + fmtX(disclosedAc.tag) + ") and prose (" + fmtX(disclosedAc.prose) + ") asset-coverage readings disagree by more than 2 points; the value above is shown but the cushion is withheld, matching the scorecard row.</p>" : ""),
      esc(caption), "150% is the 1940 Act floor for a filer that made the 2018 election, 200% for one that did not; terms.json names which line applies where a filing confirms it, and defaults to 150% otherwise (a documented limitation, not a fixed fact for every filer).",
      null, "Source: SEC EDGAR companyfacts · as of " + esc(fmtDate(last(periods).end)));
  }

  /* ---------- L4: spread histogram ---------- */
  function buildL4(ticker, holdings, composite, pcSeries) {
    if (!holdings || !holdings.summary || !holdings.summary.histogram) {
      return panel("lendersDrillSpreadHistogram", "Spread histogram vs the industry", "", "", null, emptyState("Not yet parsed", "No schedule of investments to bucket by spread."));
    }
    var ownMap = holdings.summary.histogram.byCount || {};
    var compMap = (composite && composite.histogram && composite.histogram.byCount) || {};
    var lcdSnap = pcSeries && typeof pcSeries.snapshot === "function" ? pcSeries.snapshot("lcd_bdc_spread_dist_count_2q26") : null;
    var rows = alignSpreadBuckets(ownMap, compMap, lcdSnap ? lcdSnap.items : []);
    var cats = rows.map(function (r) { return r.label; });
    var chart = catChart({ label: "Spread histogram", categories: cats,
      series: [
        { label: ticker, color: GOLD, values: rows.map(function (r) { return r.own; }), type: "bar" },
        { label: "Composite", color: LINE2, values: rows.map(function (r) { return r.composite; }), type: "bar", opacity: 0.7 },
        { label: "LCD", color: LINE3, values: rows.map(function (r) { return r.lcd; }), type: "line" }
      ], yfmt: function (v) { return (v * 100).toFixed(0) + "%"; } });
    var modalRow = rows.reduce(function (a, b) { return (isNum(b.own) && (!a || b.own > a.own)) ? b : a; }, null);
    var compModalRow = rows.reduce(function (a, b) { return (isNum(b.composite) && (!a || b.composite > a.composite)) ? b : a; }, null);
    var caption = CAPTIONS.l4.template({ ticker: ticker, modal: modalRow ? modalRow.label : "—", modalShare: modalRow ? (modalRow.own * 100).toFixed(1) : "—",
      vs: "against", compModal: compModalRow ? compModalRow.label : "—", lcdModal: lcdSnap ? lcdSnap.items.reduce(function (a, b) { return (!a || b.v > a.v) ? b : a; }, null).c : "not in this edition" });
    return panel("lendersDrillSpreadHistogram", "Spread histogram vs the industry", "<div class='ld-chart'>" + chart + "</div>" +
      "<div class='ld-legend'><span><i style='background:" + GOLD + "'></i>" + esc(ticker) + "</span><span><i style='background:" + LINE2 + "'></i>Composite</span><span><i style='background:" + LINE3 + "'></i>LCD (" + (lcdSnap ? esc(lcdSnap.p) : "not in this edition") + ")</span></div>",
      esc(caption), "LCD's bucket edges are matched to the site's own 50 bps grid by their starting point, since the two grids sit slightly offset (LCD: 400-449, 450-499…; the site: 400-450, 450-500…); a loan at a boundary can land a bucket either way.",
      null, "Source: the filer's schedule of investments · as of " + esc(fmtDate(holdings.period)) + (lcdSnap ? " · LCD " + esc(lcdSnap.p) : ""));
  }

  /* ---------- L5: maturity wall ---------- */
  function buildL5(ticker, holdings, composite, pcSeries) {
    if (!holdings || !holdings.summary || !holdings.summary.maturity) {
      return panel("lendersDrillMaturityWall", "Maturity wall vs the industry", "", "", null, emptyState("Not yet parsed", "No schedule of investments to bucket by maturity."));
    }
    var lcdSnap = pcSeries && typeof pcSeries.snapshot === "function" ? pcSeries.snapshot("lcd_bdc_maturity_wall_pct_2026q2") : null;
    var rows = alignYearBuckets(holdings.summary.maturity, composite && composite.maturityWall, lcdSnap ? lcdSnap.items : []);
    var cats = rows.map(function (r) { return r.label; });
    var chart = catChart({ label: "Maturity wall", categories: cats,
      series: [
        { label: ticker, color: GOLD, values: rows.map(function (r) { return r.ownShare; }), type: "bar" },
        { label: "Composite", color: LINE2, values: rows.map(function (r) { return r.compositeShare; }), type: "bar", opacity: 0.7 },
        { label: "LCD", color: LINE3, values: rows.map(function (r) { return r.lcd; }), type: "line" }
      ], yfmt: function (v) { return (v * 100).toFixed(0) + "%"; } });
    var heaviest = rows.reduce(function (a, b) { return (isNum(b.ownShare) && (!a || b.ownShare > a.ownShare)) ? b : a; }, null);
    var caption = CAPTIONS.l5.template({ ticker: ticker, bucket: heaviest ? heaviest.label : "—", share: heaviest ? (heaviest.ownShare * 100).toFixed(1) : "—",
      vs: "against", compShare: heaviest && isNum(heaviest.compositeShare) ? (heaviest.compositeShare * 100).toFixed(1) : "—",
      lcdShare: heaviest && isNum(heaviest.lcd) ? (heaviest.lcd * 100).toFixed(1) : "—" });
    return panel("lendersDrillMaturityWall", "Maturity wall vs the industry", "<div class='ld-chart'>" + chart + "</div>" +
      "<div class='ld-legend'><span><i style='background:" + GOLD + "'></i>" + esc(ticker) + "</span><span><i style='background:" + LINE2 + "'></i>Composite</span><span><i style='background:" + LINE3 + "'></i>LCD (" + (lcdSnap ? esc(lcdSnap.p) : "not in this edition") + ")</span></div>",
      esc(caption), "Equity, vehicle and CLO/CMBS holdings, and any holding with no parsable maturity date, are excluded from all three series, the same rule lib/credit.js's maturityBuckets applies to the composite.",
      null, "Source: the filer's schedule of investments · as of " + esc(fmtDate(holdings.period)) + (lcdSnap ? " · LCD " + esc(lcdSnap.p) : ""));
  }

  /* ---------- L6: sector mix ---------- */
  function buildL6(ticker, holdings, composite, pcSeries) {
    var ownRows = (holdings && holdings.summary && Array.isArray(holdings.summary.industry)) ? holdings.summary.industry.slice(0, 10) : [];
    if (!ownRows.length) return panel("lendersDrillSectorMix", "Sector mix vs the industry", "", "", null, emptyState("Not yet parsed", "No schedule of investments to bucket by sector."));
    var compRows = (composite && composite.sectorMix && Array.isArray(composite.sectorMix.rows)) ? composite.sectorMix.rows.slice(0, 10) : [];
    var snap2 = pcSeries && typeof pcSeries.snapshot === "function" ? pcSeries.snapshot("lcd_bdc_sector_share_count_2q26") : null;
    var snap1 = pcSeries && typeof pcSeries.snapshot === "function" ? pcSeries.snapshot("lcd_bdc_sector_share_count_1q26") : null;
    var THRESH = 0.02;
    var lcdRows = snap2 ? snap2.items.map(function (it) {
      var prior = snap1 ? snap1.items.filter(function (p) { return p.c === it.c; })[0] : null;
      var delta = prior && isNum(prior.v) && (it.v >= THRESH || prior.v >= THRESH) ? it.v - prior.v : null;
      return { name: it.c, share: it.v, delta: delta };
    }) : [];
    var rows = ownRows.map(function (o) {
      var comp = compRows.filter(function (c) { return sectorMatch(o.name, c.name); })[0];
      var lcd = lcdRows.filter(function (l) { return sectorMatch(o.name, l.name); })[0];
      return { name: o.name, own: o.share, compositeName: comp ? comp.name : null, composite: comp ? comp.share : null, lcdName: lcd ? lcd.name : null, lcd: lcd ? lcd.share : null, lcdDelta: lcd ? lcd.delta : null };
    });
    var body = "<div class='ld-sector-grid'>" + rows.map(function (r) {
      return "<div class='ld-sector-row'><span class='ld-sector-name'>" + esc(r.name) + "</span>" +
        "<span class='ld-sector-val' title='This BDC'>" + fmtPct(r.own, 1) + "</span>" +
        "<span class='ld-sector-val' title='Composite" + (r.compositeName ? ": " + esc(r.compositeName) : " — no matching name") + "'>" + (isNum(r.composite) ? fmtPct(r.composite, 1) : na()) + "</span>" +
        "<span class='ld-sector-val' title='LCD" + (r.lcdName ? ": " + esc(r.lcdName) : " — no matching name") + "'>" + (isNum(r.lcd) ? fmtPct(r.lcd, 1) : na()) +
        (isNum(r.lcdDelta) ? " <small>(" + (r.lcdDelta >= 0 ? "+" : "−") + Math.abs(r.lcdDelta * 100).toFixed(1) + "pp)</small>" : "") + "</span></div>";
    }).join("") + "<div class='ld-sector-row ld-sector-head'><span></span><span>" + esc(ticker) + "</span><span>Composite</span><span>LCD (2Q26 vs 1Q26)</span></div></div>";
    var top = rows[0], compTop = compRows[0];
    var caption = CAPTIONS.l6.template({ ticker: ticker, sector: truncateLabel(top.name, 60), share: (top.own * 100).toFixed(1),
      compSector: compTop ? truncateLabel(compTop.name, 60) : "—", compShare: compTop ? (compTop.share * 100).toFixed(1) : "—" });
    return panel("lendersDrillSectorMix", "Sector mix vs the industry", body, esc(caption),
      "The three sources use different sector taxonomies; a row is matched by name only where the labels clearly correspond, and shown against \"—\" otherwise rather than forced into a wrong pair. An LCD point change under " + (THRESH * 100).toFixed(0) + " percentage points in either quarter is not shown, since a handful of loans swings a small bucket's share sharply.",
      null, "Source: the filer's schedule of investments · as of " + esc(fmtDate(holdings.period)) + " · LCD sector share by count");
  }

  /* ---------- L7: mark and stress ---------- */
  function buildL7(ticker, company, holdings) {
    var periods = orderedPeriods(company && company.series).filter(function (p) { return isNum(periodVal(p, "portfolioFairValue")) && isNum(periodVal(p, "portfolioCost")); });
    if (!periods.length) return panel("lendersDrillMarkStress", "Mark and stress", "", "", null, emptyState("Not disclosed", "Portfolio fair value and cost are not both tagged for any quarter."));
    var recent = periods.slice(-12);
    var cats = recent.map(function (p) { return quarterLabel(p.end); });
    var mark = recent.map(function (p) { return RTCredit ? RTCredit.mark(periodVal(p, "portfolioFairValue"), periodVal(p, "portfolioCost")) : null; });
    var pik = recent.map(function (p) {
      var pikSum = RTCredit ? RTCredit.sumPresent([periodVal(p, "pikInterestIncome"), periodVal(p, "pikDividendIncome")]) : null;
      var combined = isNum(periodVal(p, "pikIncomeCombined")) ? periodVal(p, "pikIncomeCombined") : pikSum;
      return RTCredit ? RTCredit.pikShareOfTotal(combined, periodVal(p, "totalInvestmentIncome")) : null;
    });
    var chart = catChart({ label: "Mark and PIK", categories: cats,
      series: [
        { label: "Mark (FV/cost)", color: LINE3, values: mark, type: "line" },
        { label: "PIK share of income", color: GOLD, values: pik, type: "line", axis: "y2" }
      ], axis2: true, yfmt: function (v) { return v.toFixed(2) + "×"; }, y2fmt: function (v) { return (v * 100).toFixed(0) + "%"; },
      refLines: [{ value: 1, label: "1.0×", color: INK }] });
    var summary = holdings && holdings.summary, naObj = summary && summary.nonAccrual;
    var naCost = naObj && isNum(naObj.ofTotalCost) ? naObj.ofTotalCost : null, naFv = naObj && isNum(naObj.ofTotalFv) ? naObj.ofTotalFv : null;
    var holdingsAvailable = !!holdings;
    var naBlock = holdingsAvailable
      ? "<div class='ld-tiles'><div class='ld-tile'><span>Non-accrual, cost</span><b>" + fmtPct(naCost, 1) + "</b></div><div class='ld-tile'><span>Non-accrual, fair value</span><b>" + fmtPct(naFv, 1) +
        "</b></div><div class='ld-tile'><span>Non-accrual holdings</span><b>" + (naObj && isNum(naObj.n) ? withCommas(naObj.n) : "—") + " across " + (naObj && isNum(naObj.issuers) ? withCommas(naObj.issuers) : "—") + " issuers</b></div></div>" +
        "<p class='ld-limitation'>Only the latest parsed quarter (" + fmtDate(last(periods).end) + ") carries a schedule of investments, so non-accrual additions and removals since the prior quarter cannot be computed from this data set.</p>"
      : "<p class='ld-limitation'>Non-accrual, PIK-of-holdings and floating-share figures need a parsed schedule of investments, which this filer does not yet have.</p>";
    var caption = CAPTIONS.l7.template({ ticker: ticker, mark: isNum(last(mark)) ? last(mark).toFixed(3) : "—", asOf: fmtDate(last(periods).end),
      naCost: isNum(naCost) ? fmtPct(naCost, 1) : "not yet parsed", naFv: isNum(naFv) ? fmtPct(naFv, 1) : "not yet parsed", holdingsAvailable: holdingsAvailable,
      pik: isNum(last(pik)) ? fmtPct(last(pik), 1) : "—" });
    return panel("lendersDrillMarkStress", "Mark and stress", "<div class='ld-chart'>" + chart + "</div>" +
      "<div class='ld-legend'><span><i style='background:" + LINE3 + "'></i>Mark (FV/cost)</span><span><i style='background:" + GOLD + "'></i>PIK share of income</span></div>" + naBlock,
      esc(caption), "A falling mark with flat non-accruals is the market's opinion of losses arriving before the payment defaults do; a rising PIK share with flat net investment income means cash earnings are quietly falling. Never sum PIK and non-accruals.",
      null, "Source: SEC EDGAR companyfacts (mark, PIK)" + (holdingsAvailable ? " and the filer's schedule of investments (non-accrual)" : "") + " · as of " + esc(fmtDate(last(periods).end)));
  }

  /* ---------- L8: holdings table + hidden export table ---------- */
  var HOLD_PAGE_SIZE = 50;
  function holdingRow(h) {
    var lien = h.l || {};
    var costC = isNum(h.c) ? h.c : null, fvV = isNum(h.v) ? h.v : null;
    /* `p` is a dollar principal only for a debt holding; for equity (and
       vehicle/other) rows the schedule's own `p` is a share/unit count,
       not a dollar amount — carrying it through fmtMoneyM produced
       figures in the trillions (round-2 fixer finding). */
    var isDebt = h.t === "debt";
    return { name: h.n || "", aff: h.a || "non-affiliated", kind: h.t || null, lienClass: lien.c || null, lienRaw: lien.r || null,
      spread: isNum(h.sp) ? h.sp : null, rate: isNum(h.r) ? h.r : null, floor: isNum(h.fl) ? h.fl : null,
      maturity: h.m || null, principal: (isDebt && isNum(h.p)) ? h.p : null, cost: costC, fv: fvV,
      fvOverCost: (costC && fvV !== null) ? RTCredit.div(fvV, costC) : null,
      pik: isNum(h.pk) ? h.pk : null, nonAccrual: !!h.na, unfunded: isNum(h.u) ? h.u : null, thirdParty: isThirdParty(h) };
  }
  function holdingsTableHtml(rows, netAssets, opts) {
    opts = opts || {};
    var head = "<tr><th>Issuer</th><th>Affiliation</th><th>Lien</th><th>Spread</th><th>All-in rate</th><th>Floor</th><th>Maturity</th>" +
      "<th>Principal</th><th>Cost</th><th>Fair value</th><th>FV/cost</th><th>% of NAV</th><th>PIK</th><th>Non-accrual</th><th>Unfunded</th></tr>";
    var body = rows.map(function (r) {
      var pctNav = isNum(netAssets) && netAssets ? RTCredit.div(r.fv, netAssets) : null;
      return "<tr class='" + (r.nonAccrual ? "ld-row-na" : "") + "'>" +
        "<td>" + esc(r.name) + "</td><td>" + esc(r.aff) + "</td>" +
        "<td title='" + esc(r.lienRaw || "") + "'>" + esc(r.lienClass || "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.spread) ? fmtBps(r.spread) + " bps" : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.rate) ? fmtPct(r.rate, 1) : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.floor) ? fmtPct(r.floor, 2) : "—") + "</td>" +
        "<td>" + esc(r.maturity || "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.principal) ? fmtMoneyM(r.principal) : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.cost) ? fmtMoneyM(r.cost) : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.fv) ? fmtMoneyM(r.fv) : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.fvOverCost) ? fmtX(r.fvOverCost) : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(pctNav) ? fmtPct(pctNav, 2) : "—") + "</td>" +
        "<td>" + (isNum(r.pik) && r.pik > 0 ? fmtPct(r.pik, 2) : "—") + "</td>" +
        "<td>" + (r.nonAccrual ? "Yes" : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.unfunded) ? fmtMoneyM(r.unfunded) : "—") + "</td></tr>";
    }).join("");
    return "<table class='grid" + (opts.exportOnly ? " ld-export-only" : "") + "'" + (opts.exportName ? " data-export-name='" + esc(opts.exportName) + "'" : "") +
      "><thead>" + head + "</thead><tbody>" + (body || "<tr><td colspan='15'>No holdings.</td></tr>") + "</tbody></table>";
  }
  function buildL8(ticker, holdings, company, state) {
    if (!holdings) return { html: panel("lendersDrillHoldingsTable", "Holdings", "", "", null, emptyState("Not yet parsed", "No schedule of investments for " + ticker + " yet.")), exportHtml: "" };
    var rows = (holdings.holdings || []).map(holdingRow);
    var netAssets = latestVal(company, "netAssets");
    state.l8sort = state.l8sort || { key: "fv", dir: "desc" };
    state.l8page = state.l8page || 0;
    var sorted = rows.slice().sort(function (a, b) {
      var av = a[state.l8sort.key], bv = b[state.l8sort.key], mul = state.l8sort.dir === "asc" ? 1 : -1;
      var an = isNum(av) || typeof av === "string" && av; var bn = isNum(bv) || typeof bv === "string" && bv;
      if (!an && !bn) return 0; if (!an) return 1; if (!bn) return -1;
      if (typeof av === "string" || typeof bv === "string") return mul * String(av).localeCompare(String(bv));
      return mul * (av - bv);
    });
    var pageCount = Math.max(1, Math.ceil(sorted.length / HOLD_PAGE_SIZE));
    state.l8page = Math.min(state.l8page, pageCount - 1);
    var pageRows = sorted.slice(state.l8page * HOLD_PAGE_SIZE, (state.l8page + 1) * HOLD_PAGE_SIZE);
    var summary = holdings.summary || {};
    var caption = CAPTIONS.l8.template({ ticker: ticker, n: withCommas(rows.length), issuers: isNum(summary.count) ? withCommas(summary.count) : withCommas(summary.holdings || rows.length),
      asOf: fmtDate(holdings.period), top10: isNum(summary.top10 && summary.top10.share) ? fmtPct(summary.top10.share, 1) : "—" });
    var SORT_COLS = [["name", "Issuer"], ["aff", "Affiliation"], ["lienClass", "Lien"], ["spread", "Spread"], ["rate", "All-in rate"], ["floor", "Floor"],
      ["maturity", "Maturity"], ["principal", "Principal"], ["cost", "Cost"], ["fv", "Fair value"], ["fvOverCost", "FV/cost"], ["pik", "PIK"], ["nonAccrual", "Non-accrual"], ["unfunded", "Unfunded"]];
    var headRow = "<tr>" + SORT_COLS.map(function (c) {
      var active = state.l8sort.key === c[0], arrow = active ? (state.l8sort.dir === "asc" ? " ▲" : " ▼") : "";
      return "<th><button type='button' class='ld-sort-btn' data-l8-sort='" + esc(c[0]) + "'>" + esc(c[1]) + arrow + "</button></th>";
    }).join("") + "<th>% of NAV</th></tr>";
    var onScreenRows = pageRows.map(function (r) {
      var pctNav = isNum(netAssets) && netAssets ? RTCredit.div(r.fv, netAssets) : null;
      return "<tr class='" + (r.nonAccrual ? "ld-row-na" : "") + "'>" +
        "<td>" + esc(r.name) + "</td><td>" + esc(r.aff) + "</td>" + "<td title='" + esc(r.lienRaw || "") + "'>" + esc(r.lienClass || "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.spread) ? fmtBps(r.spread) + " bps" : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.rate) ? fmtPct(r.rate, 1) : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.floor) ? fmtPct(r.floor, 2) : "—") + "</td>" +
        "<td>" + esc(r.maturity || "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.principal) ? fmtMoneyM(r.principal) : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.cost) ? fmtMoneyM(r.cost) : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.fv) ? fmtMoneyM(r.fv) : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.fvOverCost) ? fmtX(r.fvOverCost) : "—") + "</td>" +
        "<td>" + (isNum(r.pik) && r.pik > 0 ? fmtPct(r.pik, 2) : "—") + "</td>" +
        "<td>" + (r.nonAccrual ? "Yes" : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(r.unfunded) ? fmtMoneyM(r.unfunded) : "—") + "</td>" +
        "<td class='ld-num'>" + (isNum(pctNav) ? fmtPct(pctNav, 2) : "—") + "</td></tr>";
    }).join("");
    var pager = "<div class='ld-pager'><button type='button' class='ld-page-prev' " + (state.l8page === 0 ? "disabled" : "") + ">Prev</button>" +
      "<span>Page " + (state.l8page + 1) + " of " + pageCount + " (" + withCommas(rows.length) + " holdings)</span>" +
      "<button type='button' class='ld-page-next' " + (state.l8page >= pageCount - 1 ? "disabled" : "") + ">Next</button></div>";
    /* an explicit data-export-name on the on-screen (paged) table too: it
       still matches the page's "main table.grid" export selector, so
       without a name of its own it would ship as a second, incomplete
       "Holdings" sheet beside the hidden export table's full "Holdings -
       TICKER" one, with no way for the reader to tell which is complete
       (round-2 fixer finding). */
    var onScreen = "<div class='ld-table-scroll'><table class='grid ld-holdings' data-export-name='Holdings - " + esc(ticker) + " (visible page only)'><thead>" + headRow + "</thead><tbody>" + (onScreenRows || "<tr><td colspan='15'>No holdings.</td></tr>") + "</tbody></table></div>" + pager;
    var exportTable = holdingsTableHtml(sorted, netAssets, { exportOnly: true, exportName: "Holdings - " + ticker });
    return {
      html: panel("lendersDrillHoldingsTable", "Holdings", onScreen, esc(caption),
        "Paged here for readability; the export (the page's own export control) always carries every one of the " + withCommas(rows.length) + " rows from a hidden table built the moment this drill-down opens. \"Non-affiliated\" is the schedule's default bucket, shown where the filer's own affiliation tag is absent.",
        null, "Source: the filer's schedule of investments · as of " + esc(fmtDate(holdings.period))),
      exportHtml: exportTable
    };
  }

  /* ---------- L9: watchlist ---------- */
  function buildL9(ticker, holdings, company) {
    if (!holdings) return { html: panel("lendersDrillWatchlist", "Watchlist", "", "", null, emptyState("Not yet parsed", "No schedule of investments for " + ticker + " yet.")), exportHtml: "" };
    var netAssets = latestVal(company, "netAssets");
    var rows = (holdings.holdings || []).map(holdingRow).filter(function (r) {
      return r.nonAccrual || (r.thirdParty && r.kind === "debt" && isNum(r.fvOverCost) && r.fvOverCost < 0.8) || (isNum(r.pik) && r.pik > 0);
    });
    if (!rows.length) {
      return { html: panel("lendersDrillWatchlist", "Watchlist", "", "", null, emptyState("No flagged holdings", "No non-accrual, sub-0.80× or PIK-paying holding in this schedule.")), exportHtml: "" };
    }
    rows.sort(function (a, b) { return (isNum(a.fvOverCost) ? a.fvOverCost : 1) - (isNum(b.fvOverCost) ? b.fvOverCost : 1); });
    var totalCost = 0, totalFv = 0;
    rows.forEach(function (r) { if (isNum(r.cost)) totalCost += r.cost; if (isNum(r.fv)) totalFv += r.fv; });
    var head = "<tr><th>Issuer</th><th>Reason</th><th>FV/cost</th><th>Cost</th><th>Fair value</th><th>Cost − FV</th><th>% of NAV</th></tr>";
    function reasonOf(r) {
      var reasons = [];
      if (r.nonAccrual) reasons.push("non-accrual");
      if (r.thirdParty && r.kind === "debt" && isNum(r.fvOverCost) && r.fvOverCost < 0.8) reasons.push("FV/cost under 0.80×");
      if (isNum(r.pik) && r.pik > 0) reasons.push("PIK-paying");
      return reasons.join(", ");
    }
    function bodyRows(list) {
      return list.map(function (r) {
        var pctNav = isNum(netAssets) && netAssets ? RTCredit.div(r.fv, netAssets) : null;
        var markdown = (isNum(r.cost) && isNum(r.fv)) ? r.cost - r.fv : null;
        return "<tr><td>" + esc(r.name) + "</td><td>" + esc(reasonOf(r)) + "</td><td class='ld-num'>" + (isNum(r.fvOverCost) ? fmtX(r.fvOverCost) : "—") +
          "</td><td class='ld-num'>" + (isNum(r.cost) ? fmtMoneyM(r.cost) : "—") + "</td><td class='ld-num'>" + (isNum(r.fv) ? fmtMoneyM(r.fv) : "—") +
          "</td><td class='ld-num'>" + (isNum(markdown) ? fmtMoneyM(markdown) : "—") + "</td><td class='ld-num'>" + (isNum(pctNav) ? fmtPct(pctNav, 2) : "—") + "</td></tr>";
      }).join("");
    }
    var onScreen = "<div class='ld-table-scroll'><table class='grid ld-watchlist' data-export-name='Watchlist - " + esc(ticker) + " (visible page only)'><thead>" + head + "</thead><tbody>" + bodyRows(rows.slice(0, 50)) + "</tbody></table></div>" +
      (rows.length > 50 ? "<p class='ld-note'>Showing the 50 widest markdowns of " + withCommas(rows.length) + "; the export carries every row.</p>" : "");
    var exportTable = "<table class='grid ld-export-only' data-export-name='Watchlist - " + esc(ticker) + "'><thead>" + head + "</thead><tbody>" + bodyRows(rows) + "</tbody></table>";
    var caption = CAPTIONS.l9.template({ ticker: ticker, n: withCommas(rows.length), cost: fmtMoneyB(totalCost), fv: fmtMoneyB(totalFv), gap: fmtMoneyM(totalCost - totalFv) });
    return {
      html: panel("lendersDrillWatchlist", "Watchlist", onScreen, esc(caption),
        "A holding can qualify on more than one test; the reason column names every test it met. Cost minus fair value is the unrealized markdown on that one line, not the filer's total unrealized loss.",
        null, "Source: the filer's schedule of investments · as of " + esc(fmtDate(holdings.period))),
      exportHtml: exportTable
    };
  }

  /* ---------- L12: return decomposition ---------- */
  function buildL12(ticker, company) {
    var periods = orderedPeriods(company && company.series).filter(function (p) { return isNum(periodVal(p, "navPerShare")); });
    if (periods.length < 2) return panel("lendersDrillReturnDecomposition", "Return decomposition, 8 quarters", "", "", null, emptyState("Not enough history", "Fewer than two quarters carry NAV per share."));
    var recent = periods.slice(-9);
    var cats = [], nii = [], dist = [], realized = [], unrealized = [], actual = [];
    for (var i = 1; i < recent.length; i++) {
      var p = recent[i], prev = recent[i - 1];
      var navNow = periodVal(p, "navPerShare"), navPrev = periodVal(prev, "navPerShare");
      var shares = periodVal(p, "weightedShares");
      var niiSh = isNum(periodVal(p, "niiPerShare")) ? periodVal(p, "niiPerShare") : null;
      var distSh = isNum(periodVal(p, "distributionsPerShare")) ? -periodVal(p, "distributionsPerShare") : null;
      var realSh = (isNum(periodVal(p, "realizedGains")) && isNum(shares) && shares) ? periodVal(p, "realizedGains") / shares : null;
      var unrealSh = (isNum(periodVal(p, "unrealizedGains")) && isNum(shares) && shares) ? periodVal(p, "unrealizedGains") / shares : null;
      cats.push(quarterLabel(p.end)); nii.push(niiSh); dist.push(distSh); realized.push(realSh); unrealized.push(unrealSh);
      actual.push(isNum(navNow) && isNum(navPrev) ? navNow - navPrev : null);
    }
    var chart = stackChart({ label: "Return decomposition", categories: cats,
      components: [{ label: "NII", color: GOLD, values: nii }, { label: "Distributions", color: RED, values: dist },
        { label: "Realized", color: LINE2, values: realized }, { label: "Unrealized", color: LINE3, values: unrealized }],
      totalActual: actual, yfmt: function (v) { return "$" + v.toFixed(2); } });
    var lastI = cats.length - 1;
    var caption = CAPTIONS.l12.template({ ticker: ticker, dNav: isNum(actual[lastI]) ? (actual[lastI] >= 0 ? "+$" : "−$") + Math.abs(actual[lastI]).toFixed(2) : "—",
      q: cats[lastI], nii: isNum(nii[lastI]) ? "+$" + nii[lastI].toFixed(2) : "—", dist: isNum(dist[lastI]) ? "−$" + Math.abs(dist[lastI]).toFixed(2) : "—",
      realized: isNum(realized[lastI]) ? (realized[lastI] >= 0 ? "+$" : "−$") + Math.abs(realized[lastI]).toFixed(2) : "—",
      unrealized: isNum(unrealized[lastI]) ? (unrealized[lastI] >= 0 ? "+$" : "−$") + Math.abs(unrealized[lastI]).toFixed(2) : "—", matches: "roughly match" });
    return panel("lendersDrillReturnDecomposition", "Return decomposition, 8 quarters", "<div class='ld-chart'>" + chart + "</div>" +
      "<div class='ld-legend'><span><i style='background:" + GOLD + "'></i>NII</span><span><i style='background:" + RED + "'></i>Distributions</span><span><i style='background:" + LINE2 + "'></i>Realized</span><span><i style='background:" + LINE3 + "'></i>Unrealized</span><span>◆ actual ΔNAV/share</span></div>",
      esc(caption), "Realized and unrealized gains are tagged only as total dollars; dividing by the quarter's weighted share count to get a per-share figure is an approximation, so the stacked bar can miss the diamond (the actual change in NAV per share) by a few cents when shares were issued or repurchased mid-quarter.",
      null, "Source: SEC EDGAR companyfacts · as of " + esc(cats[lastI]));
  }

  /* ---------- liability card ---------- */
  function buildLiability(ticker, company, holdings) {
    var latest = (company && company.series && company.series.latest) || {};
    function v(k) { var e = latest[k]; return e && isNum(e.v) ? e.v : null; }
    function entry(k) { return latest[k]; }
    var debt = v("debt"), netAssets = v("netAssets"), cash = v("cash"), lineOfCredit = v("lineOfCredit"),
      revolverCapacity = v("revolverCapacity"), maturities12m = v("debtMaturitiesNext12M");
    var unfundedTag = v("unfundedCommitments");
    var unfundedTagEntry = entry("unfundedCommitments");
    var unfundedTagNote = unfundedTagEntry && unfundedTagEntry.note ? unfundedTagEntry.note : null;
    /* the tagged unfundedCommitments fact is a single dimension member
       for some filers (ARCC's own note: "ARCC's value is a single
       member, PFLT's is the total") — 139.5x too small for ARCC. The
       holdings build already reconciles this per filer into
       summary.unfunded.total from the parsed schedule; prefer that
       total when a holdings file exists, and fall back to the tagged
       fact (with its own reconcile note surfaced) only when it does not
       (round-2 fixer finding). */
    var unfundedFromHoldings = holdings && holdings.summary && holdings.summary.unfunded && isNum(holdings.summary.unfunded.total) ? holdings.summary.unfunded.total : null;
    var unfunded = isNum(unfundedFromHoldings) ? unfundedFromHoldings : unfundedTag;
    var unfundedSource = isNum(unfundedFromHoldings) ? "schedule of investments" : (isNum(unfundedTag) ? "tag" : null);
    var de = RTCredit ? RTCredit.debtToEquity(debt, netAssets) : null;
    /* liquidityCover(cash, revolverCapacity, unfunded) silently falls
       back to cash alone when revolverCapacity is null (sumPresent
       drops absent inputs); its own formula names three inputs, so this
       tile must never render a number when one of them did not answer —
       21 of 53 filers do not tag a revolver capacity at all, and the old
       code printed a "cash ÷ unfunded" ratio under the "cash + revolver
       ÷ unfunded" label for every one of them (round-2 fixer finding). */
    var liqCover = (RTCredit && isNum(cash) && isNum(revolverCapacity) && isNum(unfunded) && unfunded !== 0) ? RTCredit.liquidityCover(cash, revolverCapacity, unfunded) : null;
    var liqReason = !isNum(revolverCapacity) ? "revolver capacity not disclosed" : (!isNum(unfunded) ? "unfunded commitments not disclosed" : (!isNum(cash) ? "cash not disclosed" : "not yet parsed"));
    var vehicles = holdings && holdings.summary && holdings.summary.vehicles;
    var vehicleShare = vehicles && isNum(vehicles.share) ? vehicles.share : null;
    var unfundedTitle = (unfundedSource === "tag" && unfundedTagNote) ? " title='" + esc(unfundedTagNote) + "'" : "";
    var rows = "<div class='ld-tiles'>" +
      "<div class='ld-tile'><span>Total debt</span><b>" + (isNum(debt) ? fmtMoneyB(debt) : na()) + "</b></div>" +
      "<div class='ld-tile'><span>Debt / equity</span><b>" + (isNum(de) ? fmtX(de) : na()) + "</b></div>" +
      "<div class='ld-tile'><span>Drawn revolver</span><b>" + (isNum(lineOfCredit) ? fmtMoneyB(lineOfCredit) : na()) + "</b></div>" +
      "<div class='ld-tile'><span>Revolver capacity</span><b>" + (isNum(revolverCapacity) ? fmtMoneyB(revolverCapacity) : na()) + "</b></div>" +
      "<div class='ld-tile'><span>Due within 12 months</span><b>" + (isNum(maturities12m) ? fmtMoneyB(maturities12m) : na()) + "</b></div>" +
      "<div class='ld-tile'" + unfundedTitle + "><span>Unfunded commitments" + (unfundedSource === "schedule of investments" ? " (schedule)" : (unfundedSource === "tag" ? " (tag)" : "")) + "</span><b>" + (isNum(unfunded) ? fmtMoneyB(unfunded) : na()) + "</b></div>" +
      "<div class='ld-tile'><span>Liquidity cover (cash + revolver ÷ unfunded)</span><b>" + (isNum(liqCover) ? fmtX(liqCover) : na(liqReason)) + "</b></div>" +
      "<div class='ld-tile'><span>Vehicle share of portfolio (FV)</span><b>" + (isNum(vehicleShare) ? fmtPct(vehicleShare, 1) : na(holdings ? "none disclosed" : "not yet parsed")) + "</b></div>" +
      "</div>" +
      "<p class='ld-limitation'>Secured-vs-unsecured debt split: not yet parsed. There is no XBRL concept in this data set that separates secured from unsecured debt, so this ladder is not shown; the debt figure above is the tagged total.</p>" +
      (unfundedSource === "tag" && unfundedTagNote ? "<p class='ld-limitation'>Unfunded commitments: " + esc(unfundedTagNote) + " — shown as tagged only because this filer has no parsed schedule of investments to total unfunded commitments per holding instead.</p>" : "");
    var rs = company && company.disclosed && company.disclosed.rateSensitivity;
    var rsHtml;
    if (rs && Array.isArray(rs.rows) && rs.rows.length) {
      rsHtml = "<table class='grid ld-rate-table'><caption>Annualized impact of a base-rate shock on net income" + (rs.intro ? " (the filing's own Item 3 table)" : "") + "</caption>" +
        "<thead><tr><th>Shock</th><th>Interest income</th><th>Interest expense</th><th>Net</th></tr></thead><tbody>" +
        rs.rows.map(function (r) { return "<tr><td>" + esc(r.shock) + "</td><td class='ld-num'>" + fmtMoneyM(r.interestIncome) + "</td><td class='ld-num'>" + fmtMoneyM(r.interestExpense) + "</td><td class='ld-num'>" + fmtMoneyM(r.net) + "</td></tr>"; }).join("") +
        "</tbody></table>";
    } else {
      rsHtml = "<p class='ld-limitation'>Interest-rate sensitivity: not yet parsed. There is no XBRL concept for the Item 3 rate-shock table in this data set; this filer's is not captured yet.</p>";
    }
    var shock100 = rs && Array.isArray(rs.rows) ? rs.rows.filter(function (r) { return r.bps === 100; })[0] : null;
    var caption = CAPTIONS.liability.template({ ticker: ticker, debt: isNum(debt) ? fmtMoneyB(debt) : "not disclosed", de: isNum(de) ? de.toFixed(2) : "—",
      maturities12m: isNum(maturities12m) ? fmtMoneyB(maturities12m) : "not disclosed", shock100: shock100 ? fmtMoneyM(shock100.net) : "not yet parsed" });
    var debtEntry = entry("debt");
    return panel("lendersDrillLiability", "Liability ladder and rate sensitivity", rows + rsHtml, esc(caption),
      "Revolver capacity is read as tagged, which for some filers is total facility size rather than undrawn availability where the filer does not separately tag the two. A rising vehicle share is not automatically bad: it can be yield lifted by leverage held inside the vehicle rather than on this filer's own balance sheet, which the leverage figures above do not capture.",
      null, "Source: SEC EDGAR companyfacts, the filing's own Item 3 rate table" + (holdings ? " and the schedule of investments (unfunded)" : "") + " · as of " + esc(fmtDate(debtEntry && debtEntry.end)));
  }

  /* ---------- fee card ---------- */
  function buildFee(ticker, terms) {
    var f = terms && terms.fees;
    var sba = terms && terms.sbaExempt;
    var sbaText = !sba || sba.status === "not stated" ? "not stated" : sba.status === "confirmed" ? "confirmed" : "unconfirmed seed";
    var sbaHtml = "<p class='ld-sba ld-sba-" + esc((sbaText || "not-stated").replace(/\s+/g, "-")) + "'>SBA exemptive relief: <b>" + esc(sbaText) + "</b>" +
      (sba && sba.sentence ? "<br><small>" + esc(sba.sentence) + "</small>" : sbaText === "unconfirmed seed" ? "<br><small>A seed assumption, not yet confirmed by this filer's own filing.</small>" : "") + "</p>";
    if (!f) {
      return panel("lendersDrillFees", "Fee schedule", sbaHtml, "", null, emptyState("Not yet parsed", "No investment advisory agreement note parsed for " + ticker + "."));
    }
    var body;
    if (f.internallyManaged) {
      body = "<p class='ld-internally-managed'>" + esc(ticker) + " is internally managed and pays no external management or incentive fee.</p>" + sbaHtml;
    } else {
      body = "<div class='ld-tiles'>" +
        "<div class='ld-tile'><span>Base management fee</span><b>" + (isNum(f.managementFeeRate) ? f.managementFeeRate.toFixed(2) + "%" : na()) + "</b></div>" +
        "<div class='ld-tile'><span>Income incentive fee</span><b>" + (isNum(f.incentiveIncomeRate) ? f.incentiveIncomeRate.toFixed(1) + "%" : na()) + "</b></div>" +
        "<div class='ld-tile'><span>Hurdle (quarterly)</span><b>" + (isNum(f.hurdle) ? f.hurdle.toFixed(2) + "%" : na()) + "</b></div>" +
        "<div class='ld-tile'><span>Catch-up</span><b>" + (isNum(f.catchUp) ? f.catchUp.toFixed(0) + "%" : na()) + "</b></div>" +
        "<div class='ld-tile'><span>Capital-gains fee</span><b>" + (isNum(f.capitalGainsRate) ? f.capitalGainsRate.toFixed(1) + "%" : na()) + "</b></div>" +
        "</div>" + (f.sentence ? "<p class='ld-sentence'>" + esc(String(f.sentence).split(" || ")[0]) + "</p>" : "") + sbaHtml;
    }
    var caption = CAPTIONS.fee.template({ ticker: ticker, mgmt: isNum(f.managementFeeRate) ? f.managementFeeRate.toFixed(2) + "%" : "not disclosed",
      incentive: isNum(f.incentiveIncomeRate) ? f.incentiveIncomeRate.toFixed(0) + "%" : "not disclosed",
      hurdle: isNum(f.hurdle) ? f.hurdle.toFixed(2) : "—", catchUp: isNum(f.catchUp) ? f.catchUp.toFixed(0) : null, sba: sbaText });
    return panel("lendersDrillFees", "Fee schedule", body, esc(caption),
      "\"Unconfirmed seed\" names a seed assumption pending this filer's own filing language, never presented as confirmed relief; an internally managed fund pays no external fee and is shown so, never as a 0% rate.",
      null, "Source: the 10-K's investment advisory agreement note (SEC EDGAR)" + (terms && terms.period ? " · as of " + esc(fmtDate(terms.period)) : ""));
  }

  /* ---------- modal shell ---------- */
  var STATE = { open: false, ticker: null, sub: {} };
  /* built through createElement/appendChild (not one innerHTML template)
     so the fixed shell's ids exist as real nodes on a minimal DOM stub —
     scripts/test-lenders-drilldown.mjs builds one without an HTML parser
     and reads #ld-body's innerHTML as a plain string afterward. */
  function ensureModal() {
    if (typeof document === "undefined") return null;
    var overlay = document.getElementById("ld-overlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "ld-overlay"; overlay.className = "ld-overlay"; overlay.hidden = true;
    var shell = document.createElement("div");
    shell.className = "ld-panel-shell";
    shell.setAttribute("role", "dialog"); shell.setAttribute("aria-modal", "true");
    shell.setAttribute("aria-labelledby", "ld-title"); shell.setAttribute("tabindex", "-1");
    var closeBtn = document.createElement("button");
    closeBtn.type = "button"; closeBtn.className = "ld-close"; closeBtn.id = "ld-close";
    closeBtn.setAttribute("aria-label", "Close"); closeBtn.textContent = "×";
    var head = document.createElement("div"); head.className = "ld-head";
    var title = document.createElement("h2"); title.id = "ld-title";
    var sub = document.createElement("p"); sub.id = "ld-sub";
    head.appendChild(title); head.appendChild(sub);
    var bodyEl = document.createElement("div"); bodyEl.className = "ld-body"; bodyEl.id = "ld-body";
    shell.appendChild(closeBtn); shell.appendChild(head); shell.appendChild(bodyEl);
    overlay.appendChild(shell);
    /* appended inside <main id="app"> (never document.body directly): the
       page's export control collects "main table.grid" (credit.js), and
       <main> closes before document.body does, so an overlay parented to
       body would hold a hidden Holdings/Watchlist table the export never
       sees. The DOM stub scripts/test-lenders-drilldown.mjs builds has no
       #app node, so this falls back to body there, exactly as it always
       has for that test. */
    var mainEl = typeof document.getElementById === "function" ? document.getElementById("app") : null;
    (mainEl || document.body).appendChild(overlay);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    closeBtn.addEventListener("click", function () { close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && STATE.open) close(); });
    overlay.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest && e.target.closest("[data-l8-sort]");
      if (btn) { var key = btn.getAttribute("data-l8-sort"); var s = STATE.sub.l8sort || { key: "fv", dir: "desc" };
        s.dir = s.key === key && s.dir === "desc" ? "asc" : "desc"; s.key = key; STATE.sub.l8sort = s; STATE.sub.l8page = 0; renderBody(); return; }
      if (e.target && e.target.closest && e.target.closest(".ld-page-prev")) { STATE.sub.l8page = Math.max(0, (STATE.sub.l8page || 0) - 1); renderBody(); return; }
      if (e.target && e.target.closest && e.target.closest(".ld-page-next")) { STATE.sub.l8page = (STATE.sub.l8page || 0) + 1; renderBody(); return; }
    });
    return overlay;
  }

  function refusalReasonText(ctx, ticker) {
    var r = findRefusal(ctx.coverage, ticker);
    if (r && r.reason) return r.reason;
    if (ctx.refusalReason) return ctx.refusalReason;
    return null;
  }

  var CURRENT = null; /* { ticker, ctx, priceHistory, priceLoaded } */

  function headerHtml(ticker, company, uRow, refusal) {
    var name = (company && company.name) || (uRow && uRow.name) || ticker;
    var exch = uRow && uRow.exchange;
    var otc = uRow && uRow.otc;
    var bits = [ticker, name];
    if (exch) bits.push(exch);
    if (otc) bits.push("quoted over the counter — no live price from the market feed");
    var refBanner = refusal ? "<p class='ld-refusal'>No parsed schedule of investments: " + esc(refusal) + ". Holdings-only panels (L4, L5, L6, L8, L9, the floating-rate and weighted-average-yield figures) show \"not yet parsed\" below.</p>" : "";
    return { title: bits.slice(0, 2).join(" — "), sub: bits.slice(2).join(" · "), banner: refBanner };
  }

  function renderBody() {
    var c = CURRENT; if (!c) return;
    var ticker = c.ticker, ctx = c.ctx;
    var company = ctx.company || null;
    var holdings = ctx.holdings || null;
    var uRow = findUniverseRow(ctx.universe, ticker);
    var terms = (ctx.terms && ctx.terms.filers && ctx.terms.filers[ticker]) || null;
    var refusal = holdings ? null : refusalReasonText(ctx, ticker);
    var head = headerHtml(ticker, company, uRow, refusal);
    document.getElementById("ld-title").textContent = head.title;
    document.getElementById("ld-sub").textContent = head.sub;

    if (!company) {
      document.getElementById("ld-body").innerHTML = "<div class='ld-empty ld-empty-page'><span>No company data for " + esc(ticker) + "</span></div>";
      return;
    }

    var l1 = buildL1(ticker, company, uRow, c.priceHistory).html;
    var l2 = buildL2(ticker, company);
    var l3 = buildL3(ticker, company, terms, uRow && uRow.acSource, company && company.disclosed && company.disclosed.assetCoverage);
    var l4 = buildL4(ticker, holdings, ctx.composite, ctx.pcSeries);
    var l5 = buildL5(ticker, holdings, ctx.composite, ctx.pcSeries);
    var l6 = buildL6(ticker, holdings, ctx.composite, ctx.pcSeries);
    var l7 = buildL7(ticker, company, holdings);
    var l8 = buildL8(ticker, holdings, company, STATE.sub);
    var l9 = buildL9(ticker, holdings, company);
    var l12 = buildL12(ticker, company);
    var liability = buildLiability(ticker, company, holdings);
    var fee = buildFee(ticker, terms);

    document.getElementById("ld-body").innerHTML = head.banner +
      "<div class='ld-grid ld-grid-2'>" + l1 + l2 + l3 + l7 + l12 + "</div>" +
      "<div class='ld-grid ld-grid-2'>" + l4 + l5 + l6 + "</div>" +
      "<div class='ld-grid ld-grid-2'>" + liability + fee + "</div>" +
      l8.html + l9.html +
      "<div class='ld-export-only'>" + l8.exportHtml + l9.exportHtml + "</div>";

    if (typeof ctx.wrapTerms === "function") { try { ctx.wrapTerms(document.getElementById("ld-body")); } catch (e) { /* a term fault never blocks the drill-down */ } }
  }

  function open(ticker, ctx) {
    ctx = ctx || {};
    var overlay = ensureModal();
    if (!overlay) return; /* Node / no DOM: open() is a no-op that still lets a test call it safely */
    STATE.open = true; STATE.ticker = ticker; STATE.sub = {};
    CURRENT = { ticker: ticker, ctx: ctx, priceHistory: [] };
    overlay.hidden = false;
    document.body.classList.add("ld-open");
    renderBody();
    var focusTarget = document.getElementById("ld-close");
    if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();

    if (typeof ctx.priceHistory === "function") {
      Promise.resolve().then(function () { return ctx.priceHistory(ticker); }).then(function (ph) {
        if (!CURRENT || CURRENT.ticker !== ticker) return;
        var points = [];
        if (Array.isArray(ph)) points = ph;
        else if (ph && Array.isArray(ph.points)) points = ph.points;
        else if (ph && Array.isArray(ph.history)) points = ph.history;
        CURRENT.priceHistory = points.map(function (p) { return { d: p.d || p.date, v: isNum(p.close) ? p.close : (isNum(p.adjClose) ? p.adjClose : (isNum(p.v) ? p.v : null)) }; })
          .filter(function (p) { return p.d && isNum(p.v); });
        renderBody();
      }, function () { /* priceHistory failed: L1 keeps its own empty state */ });
    }
    if (typeof ctx.quote === "function") {
      Promise.resolve().then(function () { return ctx.quote(ticker); }).then(function (q) {
        if (!CURRENT || CURRENT.ticker !== ticker || !q) return;
        var price = isNum(q.price) ? q.price : (isNum(q.marketCap) && ctx.company ? RTCredit.div(q.marketCap, latestVal(ctx.company, "sharesOutstanding")) : null);
        if (isNum(price) && q.asOf) {
          CURRENT.priceHistory = CURRENT.priceHistory.concat([{ d: q.asOf, v: price }]);
          renderBody();
        }
      }, function () { /* quote failed: nothing extra to add */ });
    }
  }

  function close() {
    var cb = CURRENT && CURRENT.ctx && typeof CURRENT.ctx.onClose === "function" ? CURRENT.ctx.onClose : null;
    STATE.open = false; CURRENT = null;
    var overlay = typeof document !== "undefined" ? document.getElementById("ld-overlay") : null;
    if (overlay) overlay.hidden = true;
    /* the overlay is parented inside <main id="app"> (not document.body)
       specifically so the page's export control ("main table.grid") can
       reach the currently open ticker's hidden Holdings/Watchlist export
       tables — see ensureModal()'s own note. Hiding the overlay alone
       leaves those tables in the DOM after close(), so an export run
       from a bare Lenders view (no drill-down open) silently ships the
       last-opened ticker's full schedule of investments (round-2 fixer
       finding). Clear the body so nothing survives a close(). */
    var bodyEl = typeof document !== "undefined" ? document.getElementById("ld-body") : null;
    if (bodyEl) bodyEl.innerHTML = "";
    if (typeof document !== "undefined") document.body.classList.remove("ld-open");
    if (cb) cb();
  }

  var GLOBAL = typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this);
  GLOBAL.RTLendersDrilldown = { open: open, close: close, CAPTIONS: CAPTIONS };
})();
