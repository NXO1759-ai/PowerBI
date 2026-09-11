/* Private Credit Terminal — renderer.
   Reads /api/credit-macro (22 FRED series and the USREC bands),
   /api/price-history (BIZD against a loan ETF) and /api/macro (the two
   Treasury yields it already serves), draws the Market view, and reuses
   the tile, caption and popup patterns from the Statement Analysis and
   Strategy pages. The Lenders and Underwriting views are placeholders
   until their own releases; the Glossary renders data/pc/glossary.json,
   the file every hover definition on the page is built from, fetched
   the first time that view is opened. */
(function () {
  "use strict";

  /* ---------- pure helpers: no DOM, so the caption test can run them ---------- */
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  /* "2026-09-09" → "Sep 9, 2026"; "2026-09" → "Sep 2026" */
  function fmtDate(d) {
    if (!d) return "—";
    var s = String(d), m = MONTHS[Number(s.slice(5, 7)) - 1] || "";
    return s.length >= 10 ? m + " " + Number(s.slice(8, 10)) + ", " + s.slice(0, 4) : m + " " + s.slice(0, 4);
  }
  function monthLabel(d) { return fmtDate(String(d || "").slice(0, 7)); }
  function withCommas(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  /* percent series arrive as percentage points: 2.71 means 2.71% */
  function fmtPct(v, dp) { return isNum(v) ? v.toFixed(dp === undefined ? 2 : dp) + "%" : "—"; }
  function fmtBps(v) { return isNum(v) ? withCommas(Math.round(v * 100)) + " bps" : "—"; }
  function bpsNum(v) { return isNum(v) ? withCommas(Math.round(v * 100)) : "—"; }
  function fmtSigned(v, dp, unit) {
    if (!isNum(v)) return "—";
    return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(dp) + (unit || "");
  }
  function fmtRet(v) { return isNum(v) ? (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "%" : "—"; }
  function fmtB(v) { return isNum(v) ? "$" + withCommas(Math.round(v)) + "B" : "—"; }
  function ordinal(n) {
    n = Math.round(n);
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* ---------- caption templates ----------
     Each template is a function of the values the renderer computes;
     `sample` holds the widest values a template can carry (the shapes
     come from the live pull of 2026-09-11 that also produced the
     fixtures: BIZD −25.8% / +24.4%, CCC 1,070 bps, SOFR 3.62%, the NDFI
     share 10.2%, each widened to its longest plausible print) so
     scripts/test-nav.mjs can measure every caption under 240 characters. The source stamp and the
     as-of date sit in the tile footer, not here. */
  var CAPTIONS = {
    /* caption */
    m8: {
      sample: { a: "BIZD", aPrice: "−100.0%", aTr: "+999.9%", b: "BKLN", bPrice: "−100.0%", bTr: "+999.9%",
                from: "Oct 2021", to: "Sep 2026", lead: "BKLN", gap: "999.9" },
      text: function (v) {
        return v.a + " price " + v.aPrice + ", total return " + v.aTr + " over five years (" + v.from + " to " + v.to +
          "); " + v.b + " price " + v.bPrice + ", total return " + v.bTr + ". " +
          v.lead + " led on total return by " + v.gap + " points.";
      }
    },
    /* caption */
    m8price: {
      sample: { a: "BIZD", aPrice: "−100.0%", b: "BKLN", bPrice: "−100.0%", from: "Oct 2021", to: "Sep 2026" },
      text: function (v) {
        return v.a + " price " + v.aPrice + " and " + v.b + " price " + v.bPrice + " over five years (" + v.from + " to " + v.to +
          "); total return is not available from this provider, so the shares alone are shown.";
      }
    },
    /* caption */
    m1: {
      sample: { ccc: "9,999", bb: "9,999", gap: "9,999", ig: "9,999", hy: "9,999", b: "9,999" },
      text: function (v) {
        return "CCC bonds pay " + v.ccc + " bps over Treasuries against " + v.bb + " for BB, a " + v.gap +
          " bps dispersion gap; investment grade " + v.ig + ", the high-yield index " + v.hy + ", single-B " + v.b +
          ". The BDC composite bar arrives with the schedules of investments.";
      }
    },
    /* caption */
    m2: {
      sample: { sofr: "10.00%", hy: "20.00%", gap: "10.00", sofrStart: "Apr 2018", hyStart: "Sep 2023" },
      text: function (v) {
        return "SOFR at " + v.sofr + " against a high-yield effective yield of " + v.hy + ": " + v.gap +
          " points of room between the base rate and the liquid alternative. SOFR runs from " + v.sofrStart +
          " and the high-yield yield from " + v.hyStart + ", where each history starts.";
      }
    },
    /* caption */
    ndfi: {
      sample: { share: "100.0%", asOf: "Aug 26, 2026", then: "100.0%", thenDate: "Jun 2016", mult: "99.9" },
      text: function (v) {
        return "Bank loans to nondepository financial institutions are " + v.share + " of total bank credit (" + v.asOf +
          "), against " + v.then + " in " + v.thenDate + " — " + v.mult + " times the share in ten years.";
      }
    }
  };
  CAPTIONS.sample = function () {
    var out = {};
    Object.keys(CAPTIONS).forEach(function (k) {
      if (CAPTIONS[k] && typeof CAPTIONS[k].text === "function") out[k] = CAPTIONS[k].text(CAPTIONS[k].sample);
    });
    return out;
  };

  /* The caption test loads this file in Node; there is no page to draw,
     so the templates are handed over and the renderer stops here. */
  if (typeof document === "undefined") {
    if (typeof module !== "undefined") module.exports = { CAPTIONS: CAPTIONS };
    return;
  }

  /* ---------- page plumbing ---------- */
  var C = window.RTCatalog || window.METRIC_CATALOG || null;
  var TERMS = window.RTTerms || null;
  var HTTP = window.RTHttp;
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* The deployed site serves /api beside the page. A localhost session
     usually does not, so it reads the deployed site instead — except
     when the repo's own dev server is running, which serves /api itself
     and answers /rt-dev.js to say so. Production never probes. */
  var PROD = "https://www.chineduokeke.mba";
  var API_BASE_READY = (function () {
    if (typeof window.RT_API_BASE === "string") return Promise.resolve(window.RT_API_BASE);
    if (!/^(localhost|127\.)/.test(location.hostname)) return Promise.resolve("");
    return fetch("rt-dev.js", { method: "HEAD" })
      .then(function (r) { return r.ok ? "" : PROD; }, function () { return PROD; });
  })();
  var API_BASE = "";

  /* ?fixture=1 reads the contract-shaped files under data/pc/fixtures so
     the page can be built and viewed before the endpoints deploy. */
  var FIXTURE = /[?&]fixture=1\b/.test(location.search);
  function fixtureFile(path) {
    if (path.indexOf("/api/credit-macro") === 0) return "credit-macro.json";
    if (path.indexOf("/api/macro") === 0) return "macro.json";
    var t = path.match(/ticker=([A-Z0-9.\-]+)/);
    if (path.indexOf("/api/price-history") === 0 && t) return "price-history-" + t[1] + ".json";
    return null;
  }
  function getJson(path, subject, force) {
    var url;
    if (FIXTURE) url = "data/pc/fixtures/" + fixtureFile(path);
    else url = API_BASE + path + (force ? (path.indexOf("?") >= 0 ? "&" : "?") + "force=1" : "");
    return fetch(url).then(function (r) { return HTTP.json(r, subject); });
  }

  /* ---------- definitions on hover: formula → caveat → definition → how to read ----------
     Same contract as metric-catalog.js, and the catalog's entry wins when
     it has the key; the entries here are the fallback for the keys it
     lacks (the ladder tile, the two Treasury tiles read through the macro
     feed) and for a deployment whose catalog predates the credit group. */
  var DEFS = {
    hyOas: { label: "High-yield OAS", formula: "Market-cap-weighted OAS of the ICE BofA US High Yield Index over a spot Treasury curve, in bps",
      definition: "The extra yield, over Treasuries and after the value of any call option is stripped out, that investors demand to hold US junk bonds.",
      interpretation: "Under 300 bps is tight, 300–500 normal, over 500 stress, over 800 crisis. It is the public price of below-investment-grade credit risk, and private loans are priced with it in view.",
      watch: "FRED serves three years of this series, so the percentile window is three years; the 2000–2026 median of about 457 bps is far above today's reading." },
    igOas: { label: "Investment-grade OAS", formula: "Market-cap-weighted OAS of the ICE BofA US Corporate Index over a spot Treasury curve, in bps",
      definition: "The spread investment-grade corporate bonds pay over Treasuries, option-adjusted.",
      interpretation: "Under 100 bps is tight and over 200 is stress. Tight investment-grade spreads mean the safest borrowers fund cheaply and the pressure to reach for yield moves down the ladder.",
      watch: "A three-year percentile window; the index carries long-dated bonds, so duration moves it as well as credit." },
    ratingLadder: { label: "BB / B / CCC OAS", formula: "Option-adjusted spread of the BB, single-B and CCC-and-lower subsets of the ICE BofA US High Yield Index, in bps",
      definition: "The same spread measured rung by rung down the rating scale, so the price of each step of risk can be read.",
      interpretation: "Read it as a ladder. The CCC–BB gap is dispersion: a wide gap means the market is pricing the riskiest borrowers very differently from the safest junk, which is the setting private lenders price against.",
      watch: "The CCC index is small and its constituents change with downgrades, so its spread jumps when a large issuer enters or leaves." },
    hyEffectiveYield: { label: "High-yield effective yield", formula: "Market-cap-weighted effective yield of the ICE BofA US High Yield Index, percent",
      definition: "What a buyer of the public high-yield index earns to maturity today — the liquid alternative to a private loan.",
      interpretation: "A private loan should pay more than this, because it cannot be sold. The gap between this yield and the composite's all-in yield is the private credit premium.",
      watch: "It is a yield, not a spread: five of the six ICE tiles are spreads and this one is not. It falls when Treasury yields fall even if credit risk is unchanged." },
    sofr: { label: "SOFR", formula: "Volume-weighted median rate on overnight Treasury repo, percent; the 90-day average compounds it",
      definition: "The Secured Overnight Financing Rate, the base rate of every floating-rate loan in a BDC's book.",
      interpretation: "A private loan pays SOFR plus a spread, so the base rate moves every loan's coupon at once. The 90-day average stands in for term SOFR, which FRED does not carry.",
      watch: "Overnight SOFR spikes at quarter and year ends; the 90-day average smooths those. Loan contracts often carry a floor below which the base rate does not fall." },
    baa10y: { label: "Baa minus 10-year Treasury", formula: "Moody's seasoned Baa corporate bond yield − 10-year Treasury constant-maturity yield, in bps",
      definition: "The long-run corporate risk premium: what the lowest investment-grade rating pays over the risk-free rate.",
      interpretation: "The series runs from 1986, so its percentile is a real ten-year view where the ICE spreads only reach back three. A thin premium says credit is cheap by the standards of the decade.",
      watch: "Baa is one rating, and the Treasury leg has its own cycle; the spread widens when Treasuries rally as well as when credit weakens." },
    sloosCiLarge: { label: "Bank lending standards, C&I", formula: "Net percentage of domestic banks tightening standards for C&I loans to large and middle-market firms, from the Senior Loan Officer Opinion Survey",
      definition: "The share of banks tightening minus the share loosening, each quarter, for the loans private credit competes to make.",
      interpretation: "Over 20 is tightening and under −10 is loosening. When banks retreat, as in 2022–23, private lenders fill the gap; when banks reopen, the syndicated market takes deals back.",
      watch: "A survey of about 60 banks, quarterly, dated at the quarter's start on FRED; it says what banks intend, not what they lent." },
    ciDelinquency: { label: "Bank C&I delinquency and charge-off", formula: "Delinquent business loans ÷ business loans, and annualized net charge-offs ÷ business loans, all commercial banks, percent",
      definition: "How much of the bank-lent business-loan book is late, and how much banks are writing off.",
      interpretation: "A lagging proxy for defaults among the borrowers private credit also lends to. Rising delinquency with flat charge-offs means losses are ahead, not behind.",
      watch: "Quarterly, seasonally adjusted, released with a lag of about two months; bank borrowers are larger and more diversified than the middle market as a whole." },
    busloans: { label: "C&I loans outstanding", formula: "Commercial and industrial loans at all commercial banks, billions of dollars, seasonally adjusted",
      definition: "The stock of business loans on bank balance sheets.",
      interpretation: "Bank lending shrinking while private credit grows is the substitution story; both growing is a credit expansion.",
      watch: "Nominal dollars, so inflation lifts it; H.8 revises recent weeks." },
    sloosDemand: { label: "C&I loan demand", formula: "Net percentage of domestic banks reporting stronger demand for C&I loans from large and middle-market firms",
      definition: "Whether borrowers are asking banks for more or less.",
      interpretation: "Strong demand with tightening standards is the setting in which private lenders win share.",
      watch: "Survey intent, quarterly, dated at the quarter's start." },
    sloosSmall: { label: "Bank lending standards, small firms", formula: "Net percentage of domestic banks tightening standards for C&I loans to small firms",
      definition: "The small-firm counterpart of the standards tile.",
      interpretation: "Small firms are the lower middle market; banks tighten on them first and loosen last.",
      watch: "The same survey and the same caveats as the large-firm series." },
    nfci: { label: "National Financial Conditions Index", formula: "Chicago Fed weekly index of 105 money-market, debt, equity and banking indicators; zero is the long-run average",
      definition: "A one-number summary of how loose or tight financial conditions are.",
      interpretation: "Below zero is looser than average; above zero is tighter. Credit spreads are one of its inputs, so it moves with the tiles above.",
      watch: "An index, not a rate; the components are re-weighted as the series is revised." },
    stlfsi: { label: "St. Louis Fed Financial Stress Index", formula: "Weekly principal component of 18 interest-rate, yield-spread and volatility series; zero is average stress",
      definition: "A measure of financial-market stress built from rates, spreads and volatility.",
      interpretation: "Below zero is below-average stress. It spikes in crises and says little in calm markets.",
      watch: "Version 4 of the index; earlier versions are not comparable." },
    t10y2y: { label: "10-year minus 2-year Treasury", formula: "10-year constant-maturity yield − 2-year constant-maturity yield, percentage points",
      definition: "The slope of the Treasury curve.",
      interpretation: "Inversions have preceded every modern US recession by a year or so; a steepening after inversion is the late-cycle signal.",
      watch: "The lag is long and variable, and the curve inverted in 2022 without a recession following on schedule." },
    prime: { label: "Bank prime loan rate", formula: "The rate posted by a majority of the largest US banks for their best business customers, percent",
      definition: "The bank base rate for small-business and consumer loans; about three points over the policy rate.",
      interpretation: "Where a bank-lent borrower starts; a private loan at SOFR plus a spread is compared with it.",
      watch: "Administered, not traded, so it moves in steps with the policy rate." },
    dgs10: { label: "10-year Treasury yield", formula: "Market yield on US Treasury securities at 10-year constant maturity, percent",
      definition: "The risk-free rate every corporate spread is measured over.",
      interpretation: "Read with the credit spreads: a yield that rises while spreads hold steady is a rates move, not a credit move.",
      watch: "Served through the macro feed as the latest observation of each month; the credit series above are daily." },
    dgs2: { label: "2-year Treasury yield", formula: "Market yield on US Treasury securities at 2-year constant maturity, percent",
      definition: "The market's expectation of the policy rate over the next two years.",
      interpretation: "Floating-rate loans reprice with the short end; the 2-year says where the base rate is heading.",
      watch: "Served through the macro feed as the latest observation of each month." },
    ndfiShare: { label: "Bank loans to nondepository financial institutions, share of bank credit", formula: "LNFACBW027SBOG ÷ TOTBKCR, percent, from the H.8 release",
      definition: "How much of bank credit is lent to nonbank lenders — private credit funds, BDCs, mortgage companies and the like — rather than to businesses and households directly.",
      interpretation: "A rising share means banks fund private credit instead of competing with it; the risk moved off the bank balance sheet in name but not in exposure.",
      watch: "Share of total bank credit, not of total assets, which is a lower figure; the loan series starts in 2015." },
    bdcVsLoans: { label: "Listed BDCs against leveraged loans", formula: "Each month's close ÷ the first month's close × 100; total return uses the dividend-adjusted close",
      definition: "The listed BDC ETF and a leveraged-loan ETF on the same scale, five years monthly.",
      interpretation: "BDC prices move months ahead of the quarterly NAV marks, so the ETF is the market's live opinion of private credit books. The loan ETF is the liquid neighbor.",
      watch: "Adjusted close reinvests distributions at the ex-date, which is the standard total return but not what a holder taking cash earned. The last point is the running month." },
    spreadLadder: { label: "Spread ladder", formula: "Option-adjusted spread over Treasuries by rating rung, in bps; the composite bar will be a spread over the base rate",
      definition: "What each rung of the bond market pays over Treasuries today.",
      interpretation: "The gap between the CCC and BB rungs is dispersion. A private loan's spread over SOFR sits on this ladder only after the base-rate difference is allowed for.",
      watch: "Bonds are priced over Treasuries and loans over a floating base; the two are not the same spread." },
    yieldStack: { label: "Yield stack", formula: "SOFR and the high-yield effective yield, month-end values; the composite yields are added when their schedules are parsed",
      definition: "The floor a floating loan pays and the yield of the liquid alternative, over time.",
      interpretation: "The floating-rate carry of 2023–24 was the base rate rising under fixed spreads; the reversal is the base rate falling while spreads compress.",
      watch: "Each line starts where FRED's history starts; the high-yield yield reaches back three years only." }
  };
  function def(key) { return (C && C.get ? C.get(key) : null) || DEFS[key] || null; }

  var pop = $("metric-pop"), popFor = null;
  function showPop(el, key) {
    var m = def(key);
    if (!m) return;
    popFor = el;
    /* formula first — the line a professional scans for — then the caveat
       that qualifies it, then what it is and how to read it */
    pop.innerHTML = "<h4>" + esc(m.label) + (m.subtitle ? " — " + esc(m.subtitle) : "") + "</h4>" +
      "<p class='pop-formula'>" + esc(m.formula) + "</p>" +
      (m.watch ? "<p class='pop-watch'><span class='pop-tag'>Caveat</span>" + esc(m.watch) + "</p>" : "") +
      "<p>" + esc(m.definition) + "</p>" +
      "<p><span class='pop-tag'>How to read it</span>" + esc(m.interpretation) + "</p>";
    pop.hidden = false;
    if (window.matchMedia("(max-width: 680px)").matches) {
      pop.style.left = ""; pop.style.top = ""; return;
    }
    var r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    var left = Math.min(r.left + window.scrollX,
      window.scrollX + document.documentElement.clientWidth - pw - 12);
    var top = r.bottom + window.scrollY + 8;
    if (r.bottom + ph + 20 > document.documentElement.clientHeight) {
      top = Math.max(window.scrollY + 8, r.top + window.scrollY - ph - 8);
    }
    pop.style.left = Math.max(window.scrollX + 8, left) + "px";
    pop.style.top = top + "px";
  }
  function hidePop(el) { if (el && popFor !== el) return; pop.hidden = true; popFor = null; }
  document.addEventListener("mouseover", function (e) {
    var c = e.target.closest("[data-metric]"); if (c) showPop(c, c.getAttribute("data-metric"));
  });
  document.addEventListener("mouseout", function (e) {
    var c = e.target.closest("[data-metric]");
    if (c && !c.contains(e.relatedTarget)) hidePop(c);
  });
  document.addEventListener("focusin", function (e) {
    var c = e.target.closest("[data-metric]"); if (c) showPop(c, c.getAttribute("data-metric"));
  });
  document.addEventListener("focusout", function (e) {
    var c = e.target.closest("[data-metric]"); if (c) hidePop(c);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !pop.hidden) hidePop(null);
  });
  /* the term popups share the element; the term library owns its own events */
  if (TERMS && typeof TERMS.attach === "function") TERMS.attach(pop);

  /* ---------- hover terms ----------
     Wrapped once per section after every render; a re-render replaces
     the nodes, so any earlier wrap inside the root is undone first and
     the library never sees a term it already wrapped. */
  function unwrapTerms(root) {
    root.querySelectorAll(".term").forEach(function (t) {
      t.parentNode.replaceChild(document.createTextNode(t.textContent), t);
    });
  }
  function wrapTerms(root) {
    if (!TERMS || typeof TERMS.wrap !== "function" || !root) return;
    unwrapTerms(root);
    try { TERMS.wrap(root, { perSection: "section" }); } catch (e) { /* a term library fault never takes the page down */ }
  }

  /* ---------- SVG helpers ---------- */
  var GOLD = "#f5c518", INK = "#8b8f98", LINE2 = "#b6bac2", GRID = "rgba(255,255,255,.08)", BAND = "rgba(255,255,255,.06)";
  /* A 24-point sparkline; the box is stretched to the tile, so the stroke
     is told not to scale with it. */
  function spark(points, opts) {
    opts = opts || {};
    var pts = (points || []).filter(function (p) { return p && isNum(p.v); });
    if (pts.length < 2) return "<svg viewBox='0 0 240 44' preserveAspectRatio='none' aria-hidden='true'></svg>";
    var W = 240, H = opts.h || 44, pad = 3;
    var vals = pts.map(function (p) { return p.v; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (lo === hi) { lo -= 1; hi += 1; }
    var X = function (i) { return pad + (i / (pts.length - 1)) * (W - 2 * pad); };
    var Y = function (v) { return pad + (H - 2 * pad) - ((v - lo) / (hi - lo)) * (H - 2 * pad); };
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.v).toFixed(1); }).join(" ");
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='none' aria-hidden='true'>";
    if (lo < 0 && hi > 0) {
      out += "<line x1='0' x2='" + W + "' y1='" + Y(0).toFixed(1) + "' y2='" + Y(0).toFixed(1) +
        "' stroke='rgba(245,197,24,.35)' stroke-width='1' stroke-dasharray='3 3' vector-effect='non-scaling-stroke'/>";
    }
    out += "<path d='" + d + "' fill='none' stroke='" + (opts.color || GOLD) + "' stroke-width='1.6' stroke-linejoin='round' vector-effect='non-scaling-stroke'/>";
    out += "<circle cx='" + X(pts.length - 1).toFixed(1) + "' cy='" + Y(pts[pts.length - 1].v).toFixed(1) + "' r='2.4' fill='" + (opts.color || GOLD) + "'/>";
    return out + "</svg>";
  }
  function pctMarker(p) {
    if (!p || !isNum(p.p)) return "";
    var title = ordinal(p.p) + " percentile of " + p.n + " observations from " + p.windowStart + " to " + p.windowEnd + " (" + p.windowLabel + " window)";
    return "<div class='tile-pct' title='" + esc(title) + "'><span class='track'><i style='left:" + Math.max(0, Math.min(100, p.p)) + "%'></i></span>" +
      "<span class='pct-label'>" + esc(ordinal(p.p)) + " pct · " + esc(p.windowLabel) + "</span></div>";
  }

  /* ---------- the series reader ----------
     One reader for both feeds. credit-macro serves { latest:{d,v}, ... }
     in percentage points; the macro feed serves DGS10 and DGS2 as
     monthly fractions (the latest observation of each month) with
     [date, value] history, so those are lifted into the same shape here
     and never read differently elsewhere. */
  function fromCredit(cm, id) {
    var s = cm && cm.series && cm.series[id];
    if (!s || !s.latest || !isNum(s.latest.v)) return null;
    return s;
  }
  function fromMacro(macro, key, id, name) {
    var s = macro && macro.leading && macro.leading[key];
    if (!s || !isNum(s.value)) return null;
    var hist = (s.history || []).map(function (h) { return { d: h[0], v: h[1] * 100 }; });
    /* the same rule as the credit feed: a ten-year date window anchored
       on the latest observation, ties split, never a count of points */
    var v = s.value * 100, period = String(s.period);
    var from = String(Number(period.slice(0, 4)) - 10) + period.slice(4);
    var win = hist.filter(function (h) { return h.d >= from; });
    var below = 0, equal = 0;
    win.forEach(function (h) { if (h.v < v) below++; else if (h.v === v) equal++; });
    return { id: id, name: name, unit: "percent", freq: "monthly", latest: { d: period, v: v },
      prior: hist.length > 1 ? hist[hist.length - 2] : null,
      change: hist.length > 1 ? v - hist[hist.length - 2].v : null,
      sparkline: hist.slice(-24), history: win,
      percentile: win.length ? { p: Math.round(1000 * (below + 0.5 * equal) / win.length) / 10, n: win.length, windowStart: win[0].d, windowEnd: period, windowLabel: "10-year" } : null,
      viaMacro: true };
  }

  /* ---------- the eight tiles and their reading rules ---------- */
  function regime(word, rest) { return "<span class='regime'>" + esc(word) + "</span> — " + esc(rest); }
  var TILES = [
    { key: "hyOas", label: "High-yield OAS", ids: ["BAMLH0A0HYM2"], kind: "bps",
      read: function (S) {
        var b = S[0].latest.v * 100;
        return b < 300 ? regime("Tight", "under the 300 bps line; 300–500 is normal, over 500 stress, over 800 crisis")
          : b <= 500 ? regime("Normal", "inside the 300–500 bps band; over 500 is stress")
          : b <= 800 ? regime("Stress", "over 500 bps; over 800 is crisis") : regime("Crisis", "over 800 bps");
      } },
    { key: "igOas", label: "Investment-grade OAS", ids: ["BAMLC0A0CM"], kind: "bps",
      read: function (S) {
        var b = S[0].latest.v * 100;
        return b < 100 ? regime("Tight", "under 100 bps; over 200 is stress")
          : b <= 200 ? regime("Normal", "between the 100 bps and 200 bps lines") : regime("Stress", "over 200 bps");
      } },
    { key: "ratingLadder", label: "BB / B / CCC OAS", ids: ["BAMLH0A1HYBB", "BAMLH0A2HYB", "BAMLH0A3HYC"], rowLabels: ["BB", "B", "CCC"],
      rowKeys: ["bbOas", "bOas", "cccOas"], kind: "bps", rows: true,
      read: function (S) {
        if (!S[0] || !S[2]) return regime("Dispersion", "the CCC–BB gap needs both rungs");
        return regime("Dispersion", "CCC–BB gap " + fmtBps(S[2].latest.v - S[0].latest.v) + ", the distance between the riskiest and safest junk borrowers");
      } },
    { key: "hyEffectiveYield", label: "High-yield effective yield", ids: ["BAMLH0A0HYM2EY"], kind: "pct",
      read: function (S, cm) {
        var sofr = fromCredit(cm, "SOFR");
        return sofr ? regime(fmtSigned(S[0].latest.v - sofr.latest.v, 2, " pp") + " over SOFR", "the liquid alternative to a private loan")
          : regime("Liquid alternative", "what a public high-yield buyer earns to maturity");
      } },
    { key: "sofr", label: "SOFR", ids: ["SOFR", "SOFR90DAYAVG"], rowLabels: ["Overnight", "90-day avg"], rowKeys: [null, "sofr90"], kind: "pct", secondary: true,
      read: function (S) {
        /* yearAgo is the observation nearest the same date twelve months
           back; a month-end point would sit weeks off and can straddle a
           policy step, which is how a 77 bps move once read as 62 */
        var ago = S[0].yearAgo;
        var ch = ago && isNum(ago.v) ? (S[0].latest.v - ago.v) * 100 : null;
        return isNum(ch) ? regime((ch >= 0 ? "Up " : "Down ") + Math.abs(Math.round(ch)) + " bps over 12 months",
            "the base rate of every floating loan, from " + fmtPct(ago.v, 2) + " on " + fmtDate(ago.d))
          : regime("Base rate", "of every floating loan");
      } },
    { key: "baa10y", label: "Baa minus 10-year Treasury", ids: ["BAA10Y"], kind: "bps",
      read: function (S) {
        var p = S[0].percentile;
        if (!p || !isNum(p.p)) return regime("Risk premium", "the long-run corporate premium over the risk-free rate");
        return regime(p.p < 25 ? "Thin premium" : p.p > 75 ? "Wide premium" : "Mid-range premium",
          ordinal(p.p) + " percentile of the " + p.windowLabel + " window; the long-run corporate risk premium");
      } },
    { key: "sloosCiLarge", label: "Bank lending standards, C&I", ids: ["DRTSCILM"], kind: "netpct", unitWord: "net tightening",
      read: function (S) {
        var v = S[0].latest.v;
        return v > 20 ? regime("Tightening", "over 20; banks retreat and private lenders fill the gap")
          : v < -10 ? regime("Loosening", "under −10; banks compete for the same borrowers")
          : regime("Neutral", "between −10 and 20 net; over 20 is tightening, under −10 loosening");
      } },
    { key: "ciDelinquency", label: "Bank C&I delinquency and charge-off", ids: ["DRBLACBS", "CORBLACBS"], rowLabels: ["Delinquent", "Charge-off"],
      rowKeys: ["ciDelinquency", "ciChargeoff"], kind: "pct", rows: true,
      read: function (S) {
        var p = S[0] && S[0].percentile;
        return regime("Lagging default proxy", "for the bank-lent middle market" +
          (p && isNum(p.p) ? "; delinquency at the " + ordinal(p.p) + " percentile of the " + p.windowLabel + " window" : ""));
      } }
  ];
  /* behind "More conditions" */
  var MORE = [
    { key: "busloans", label: "C&I loans outstanding", id: "BUSLOANS", kind: "billions" },
    { key: "sloosDemand", label: "C&I loan demand", id: "DRSDCILM", kind: "netpct", unitWord: "net stronger" },
    { key: "sloosSmall", label: "Standards, small firms", id: "DRTSCIS", kind: "netpct", unitWord: "net tightening" },
    { key: "nfci", label: "Financial conditions (NFCI)", id: "NFCI", kind: "index3" },
    { key: "stlfsi", label: "Financial stress (STLFSI4)", id: "STLFSI4", kind: "index2" },
    { key: "t10y2y", label: "10-year minus 2-year", id: "T10Y2Y", kind: "pp" },
    { key: "prime", label: "Prime rate", id: "DPRIME", kind: "pct" },
    { key: "dgs10", label: "10-year Treasury", id: "DGS10", kind: "pct", macro: "treasury10y" },
    { key: "dgs2", label: "2-year Treasury", id: "DGS2", kind: "pct", macro: "treasury2y" }
  ];

  function fmtKind(kind, v, unitWord) {
    if (!isNum(v)) return "—";
    if (kind === "bps") return bpsNum(v) + "<span class='unit'> bps</span>";
    if (kind === "pct") return esc(fmtPct(v, 2));
    if (kind === "netpct") return esc(fmtSigned(v, 1, "%")) + "<span class='unit'> " + esc(unitWord || "net") + "</span>";
    if (kind === "billions") return esc(fmtB(v));
    if (kind === "index3") return esc(fmtSigned(v, 3));
    if (kind === "index2") return esc(fmtSigned(v, 2));
    if (kind === "pp") return esc(fmtSigned(v, 2, " pp"));
    return esc(String(v));
  }
  function fmtPlain(kind, v) {
    if (!isNum(v)) return "—";
    if (kind === "bps") return fmtBps(v);
    if (kind === "pct") return fmtPct(v, 2);
    if (kind === "netpct") return fmtSigned(v, 1, "%");
    if (kind === "billions") return fmtB(v);
    if (kind === "index3") return fmtSigned(v, 3);
    if (kind === "index2") return fmtSigned(v, 2);
    if (kind === "pp") return fmtSigned(v, 2, " pp");
    return String(v);
  }
  function changeLine(s, kind) {
    if (!s || !isNum(s.change) || !s.prior) return "";
    var txt = kind === "bps" ? fmtSigned(s.change * 100, 0, " bps") : kind === "billions" ? fmtSigned(s.change, 0, "B")
      : kind === "index3" ? fmtSigned(s.change, 3) : fmtSigned(s.change, 2, kind === "pct" || kind === "netpct" ? " pp" : "");
    return "<span class='tile-change'>" + esc(txt) + " vs " + esc(s.prior.d) + "</span>";
  }
  function isQuarterly(s) { return s && s.freq === "quarterly"; }
  function sparkOf(s, h) {
    var pts = s.sparkline || [];
    /* a quarterly series has eight points in two years; the label says so */
    return "<div class='tile-spark'>" + spark(isQuarterly(s) ? pts.slice(-8) : pts, { h: h }) + "</div>";
  }
  function labelBtn(key, label) {
    return "<button type='button' class='tile-label' data-metric='" + esc(key) + "'><span>" + esc(label) + "</span></button>";
  }
  /* a stacked row's label: its own popup when the catalog has an entry
     for that series (BB, B, CCC, the 90-day average, charge-off) */
  function rowLabel(t, i) {
    var key = t.rowKeys && t.rowKeys[i];
    if (key && def(key)) return "<span class='r-id' data-metric='" + esc(key) + "' tabindex='0'>" + esc(t.rowLabels[i]) + "</span>";
    return "<span class='r-id'>" + esc(t.rowLabels[i]) + "</span>";
  }
  function foot(ids, S, extra) {
    var parts = ids.map(function (id, i) { return S[i] ? id + " " + S[i].latest.d : id + " not available"; });
    return "<p class='tile-foot'>FRED · " + esc(parts.join(" · ")) + (extra ? " · " + esc(extra) : "") + "</p>";
  }
  function naTile(t, ids) {
    return "<div class='tile' data-tile='" + esc(t.key) + "'><div class='tile-head'>" + labelBtn(t.key, t.label) + "</div>" +
      "<span class='tile-value na'>not available</span>" +
      "<p class='tile-reading'>The series did not answer; nothing is shown in its place.</p>" +
      "<p class='tile-foot'>FRED · " + esc(ids.join(" · ")) + " · not available</p></div>";
  }

  function tile(t, cm) {
    var S = t.ids.map(function (id) { return fromCredit(cm, id); });
    if (!S[0]) return naTile(t, t.ids);
    var main = S[0];
    var html = "<div class='tile' data-tile='" + esc(t.key) + "'>" +
      "<div class='tile-head'>" + labelBtn(t.key, t.label) + "<span class='tile-asof'>" + esc(main.latest.d) + "</span></div>";
    if (t.rows) {
      html += "<div class='tile-rows'>" + t.ids.map(function (id, i) {
        var s = S[i];
        return "<div class='tile-row'>" + rowLabel(t, i) +
          "<span class='r-spark'>" + (s ? spark(isQuarterly(s) ? (s.sparkline || []).slice(-8) : s.sparkline, { h: 22 }) : "") + "</span>" +
          "<span class='r-val" + (s ? "" : " na") + "'>" + (s ? fmtPlain(t.kind, s.latest.v) : "not available") + "</span>" +
          "<span class='r-pct" + (s && s.percentile ? "" : " na") + "'>" + (s && s.percentile ? esc(ordinal(s.percentile.p)) + " pct" : "—") + "</span></div>";
      }).join("") + "</div>";
      html += "<p class='tile-reading'>" + t.read(S, cm) + "</p>";
      var p0 = S[0] && S[0].percentile;
      if (p0) html += "<p class='tile-foot'>Percentile window " + esc(p0.windowLabel) + (isQuarterly(S[0]) ? ", eight quarters in the sparkline" : "") + "</p>";
    } else {
      html += "<span class='tile-value'>" + fmtKind(t.kind, main.latest.v, t.unitWord) + "</span>" +
        changeLine(main, t.kind) +
        "<p class='tile-reading'>" + t.read(S, cm) + "</p>" +
        sparkOf(main, 44) +
        pctMarker(main.percentile);
      if (t.secondary && S[1]) {
        html += "<div class='tile-rows'><div class='tile-row'>" + rowLabel(t, 1) +
          "<span class='r-spark'>" + spark(S[1].sparkline, { h: 22, color: LINE2 }) + "</span>" +
          "<span class='r-val'>" + esc(fmtPlain(t.kind, S[1].latest.v)) + "</span>" +
          "<span class='r-pct'>" + (S[1].percentile ? esc(ordinal(S[1].percentile.p)) + " pct" : "—") + "</span></div></div>";
      }
      if (isQuarterly(main)) html += "<p class='tile-foot'>Quarterly series: eight points in the sparkline</p>";
    }
    html += foot(t.ids, S);
    return html + "</div>";
  }

  function smallTile(t, cm, macro) {
    var s = t.macro ? fromMacro(macro, t.macro, t.id, t.label) : fromCredit(cm, t.id);
    if (!s) return naTile(t, [t.id]);
    return "<div class='tile' data-tile='" + esc(t.key) + "'>" +
      "<div class='tile-head'>" + labelBtn(t.key, t.label) + "<span class='tile-asof'>" + esc(s.latest.d) + "</span></div>" +
      "<span class='tile-value'>" + fmtKind(t.kind, s.latest.v, t.unitWord) + "</span>" +
      changeLine(s, t.kind) +
      sparkOf(s, 30) +
      pctMarker(s.percentile) +
      "<p class='tile-foot'>" + (s.viaMacro ? "FRED via the macro feed, latest observation of each month · " : "FRED · ") + esc(t.id) + " " + esc(s.latest.d) + "</p></div>";
  }

  /* ---------- the NDFI share block ---------- */
  function lineChart(hist, fmt, opts) {
    if (!hist || hist.length < 8) return "";
    var W = 720, H = 150, padL = 46, padR = 14, padT = 10, padB = 22;
    var iw = W - padL - padR, ih = H - padT - padB;
    var vals = hist.map(function (h) { return h.v; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (opts && opts.zero) lo = Math.min(lo, 0);
    if (lo === hi) { lo -= 1; hi += 1; }
    var span = hi - lo; lo -= span * 0.05; hi += span * 0.08;
    var X = function (i) { return padL + (i / (hist.length - 1)) * iw; };
    var Y = function (v) { return padT + ih - ((v - lo) / (hi - lo)) * ih; };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='" + esc(opts.label || "") + "'>";
    (opts.bands || []).forEach(function (b) {
      var a = -1, z = -1;
      for (var i = 0; i < hist.length; i++) {
        var m = hist[i].d.slice(0, 7);
        if (a < 0 && m >= b.start.slice(0, 7)) a = i;
        if (m <= b.end.slice(0, 7)) z = i;
      }
      if (a < 0 || z < a) return;
      out += "<rect x='" + X(a).toFixed(1) + "' y='" + padT + "' width='" + Math.max(2, X(z) - X(a)).toFixed(1) + "' height='" + ih + "' fill='" + BAND + "'><title>Recession " + esc(b.start.slice(0, 7)) + " to " + esc(b.end.slice(0, 7)) + "</title></rect>";
    });
    [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1].forEach(function (g) {
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + Y(g).toFixed(1) + "' y2='" + Y(g).toFixed(1) + "' stroke='" + GRID + "' stroke-width='1'/>" +
        "<text x='" + (padL - 6) + "' y='" + (Y(g) + 3).toFixed(1) + "' text-anchor='end' font-size='9' fill='" + INK + "'>" + esc(fmt(g)) + "</text>";
    });
    var step = Math.max(1, Math.floor(hist.length / 6));
    for (var i = 0; i < hist.length; i += step) {
      out += "<text x='" + X(i).toFixed(1) + "' y='" + (H - 7) + "' text-anchor='middle' font-size='9' fill='" + INK + "'>" + esc(hist[i].d.slice(0, 4)) + "</text>";
    }
    var path = hist.map(function (h, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(h.v).toFixed(1); }).join(" ");
    out += "<path d='" + path + "' fill='none' stroke='" + GOLD + "' stroke-width='1.8' stroke-linejoin='round'/>";
    var last = hist[hist.length - 1];
    out += "<circle cx='" + X(hist.length - 1).toFixed(1) + "' cy='" + Y(last.v).toFixed(1) + "' r='3' fill='" + GOLD + "'/>";
    return out + "</svg>";
  }
  function renderNdfi(cm) {
    var host = $("ndfi-block");
    var d = cm && cm.derived && cm.derived.ndfiShare;
    if (!d || !d.latest || !isNum(d.latest.v)) {
      host.innerHTML = "<div class='ndfi-head'>" + labelBtn("ndfiShare", "Bank loans to nondepository financial institutions, share of bank credit") +
        "</div><span class='tile-value na'>not available</span><p class='tile-foot'>FRED · LNFACBW027SBOG ÷ TOTBKCR · not available</p>";
      return;
    }
    var hist = d.history || [];
    /* the June 2016 point is the comparison the caption states */
    var then = null;
    for (var i = 0; i < hist.length; i++) if (hist[i].d.slice(0, 7) === "2016-06") { then = hist[i]; break; }
    var cap = then && isNum(then.v) && then.v > 0
      ? CAPTIONS.ndfi.text({ share: fmtPct(d.latest.v, 1), asOf: fmtDate(d.latest.d), then: fmtPct(then.v, 1),
          thenDate: monthLabel(then.d), mult: (d.latest.v / then.v).toFixed(1) })
      : "Bank loans to nondepository financial institutions are " + fmtPct(d.latest.v, 1) + " of total bank credit (" + fmtDate(d.latest.d) + ").";
    host.innerHTML = "<div class='ndfi-head'>" + labelBtn("ndfiShare", "Bank loans to nondepository financial institutions, share of bank credit") +
      "<span class='ndfi-value'>" + esc(fmtPct(d.latest.v, 1)) + "</span></div>" +
      "<div class='ndfi-chart'>" + lineChart(hist, function (v) { return v.toFixed(1) + "%"; }, { label: "Share of bank credit lent to nondepository financial institutions", bands: cm.recessions || [] }) + "</div>" +
      "<p class='chart-caption'>" + esc(cap) + "</p>" +
      "<p class='tile-foot'>FRED H.8 · " + esc(d.method || "LNFACBW027SBOG ÷ TOTBKCR") + " · monthly, last weekly observation of each month · " + esc(d.latest.d) + "</p>";
  }

  /* ---------- the strip ---------- */
  function renderStrip(cm, macro) {
    $("conditions-strip").innerHTML = TILES.map(function (t) { return tile(t, cm); }).join("");
    $("more-strip").innerHTML = MORE.map(function (t) { return smallTile(t, cm, macro); }).join("");
    renderNdfi(cm);
    /* the workbook's rows */
    var rows = ["<tr><th>Series</th><th>Name</th><th>Latest</th><th>Date</th><th>Prior</th><th>Change</th><th>Percentile</th><th>Window</th><th>Unit</th></tr>"];
    var ids = [];
    TILES.forEach(function (t) { ids = ids.concat(t.ids); });
    MORE.forEach(function (t) { if (!t.macro) ids.push(t.id); });
    ids.forEach(function (id) {
      var s = fromCredit(cm, id);
      if (!s) { rows.push("<tr><td>" + esc(id) + "</td><td colspan='8'>not available</td></tr>"); return; }
      rows.push("<tr><td>" + esc(id) + "</td><td>" + esc(s.name || "") + "</td><td>" + esc(String(s.latest.v)) + "</td><td>" + esc(s.latest.d) +
        "</td><td>" + esc(s.prior ? String(s.prior.v) : "") + "</td><td>" + esc(isNum(s.change) ? String(s.change) : "") +
        "</td><td>" + esc(s.percentile ? String(s.percentile.p) : "") + "</td><td>" + esc(s.percentile ? s.percentile.windowLabel : "") + "</td><td>" + esc(s.unit || "") + "</td></tr>");
    });
    $("t-conditions").innerHTML = rows.join("");
  }

  /* ---------- Chart.js scaffolding shared by M8 and M2 ---------- */
  var CHARTS = {};
  function monthKeys(from, to) {
    var out = [], y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
    while (true) {
      var k = y + "-" + (m < 10 ? "0" : "") + m;
      out.push(k);
      if (k >= to.slice(0, 7)) break;
      m += 1; if (m > 12) { m = 1; y += 1; }
      if (out.length > 600) break;
    }
    return out;
  }
  /* NBER recessions from USREC, drawn behind the lines */
  function recessionPlugin(bands, labels) {
    return { id: "recessions", beforeDatasetsDraw: function (chart) {
      var xs = chart.scales.x, area = chart.chartArea, ctx = chart.ctx;
      if (!xs || !area) return;
      ctx.save(); ctx.fillStyle = BAND;
      (bands || []).forEach(function (b) {
        var a = -1, z = -1;
        for (var i = 0; i < labels.length; i++) {
          if (a < 0 && labels[i] >= b.start.slice(0, 7)) a = i;
          if (labels[i] <= b.end.slice(0, 7)) z = i;
        }
        if (a < 0 || z < a) return;
        var x0 = xs.getPixelForValue(a), x1 = xs.getPixelForValue(z);
        ctx.fillRect(x0, area.top, Math.max(2, x1 - x0), area.bottom - area.top);
      });
      ctx.restore();
    } };
  }
  function baseOptions(labels, yfmt, unitLabel) {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1b1e23", borderColor: "rgba(245,197,24,.4)", borderWidth: 1,
          titleColor: "#e8eaed", bodyColor: "#b6bac2", titleFont: { family: "JetBrains Mono, monospace", size: 11 },
          bodyFont: { family: "JetBrains Mono, monospace", size: 11 }, padding: 8, displayColors: true, boxWidth: 8, boxHeight: 8,
          callbacks: {
            title: function (items) { return items.length ? monthLabel(labels[items[0].dataIndex]) : ""; },
            label: function (item) { return " " + item.dataset.label + " " + (isNum(item.parsed.y) ? yfmt(item.parsed.y) : "—"); }
          }
        }
      },
      scales: {
        x: { type: "category", grid: { display: false }, border: { color: GRID },
          ticks: { color: INK, font: { family: "JetBrains Mono, monospace", size: 10 }, maxRotation: 0, autoSkip: false,
            callback: function (val, idx) { return /-01$/.test(labels[idx]) ? labels[idx].slice(0, 4) : null; } } },
        y: { grid: { color: GRID }, border: { display: false },
          ticks: { color: INK, font: { family: "JetBrains Mono, monospace", size: 10 }, maxTicksLimit: 6,
            callback: function (v) { return yfmt(v); } },
          title: unitLabel ? { display: true, text: unitLabel, color: INK, font: { family: "JetBrains Mono, monospace", size: 10 } } : { display: false } }
      }
    };
  }
  function drawLine(id, labels, datasets, yfmt, unitLabel, bands) {
    var canvas = $(id);
    if (!canvas || typeof window.Chart !== "function") return null;
    if (CHARTS[id]) { CHARTS[id].destroy(); CHARTS[id] = null; }
    CHARTS[id] = new window.Chart(canvas.getContext("2d"), {
      type: "line", data: { labels: labels, datasets: datasets },
      options: baseOptions(labels, yfmt, unitLabel), plugins: [recessionPlugin(bands, labels)]
    });
    return CHARTS[id];
  }
  function legend(host, items) {
    $(host).innerHTML = items.map(function (it) {
      return "<span><i style='background:" + it.color + "'" + (it.dash ? " class='dash'" : "") + "></i>" + esc(it.label) + "</span>";
    }).join("");
  }
  function chartEmpty(hostId, msg) {
    var host = $(hostId);
    var old = host.querySelector(".chart-empty");
    if (old) old.parentNode.removeChild(old);
    if (!msg) return;
    var p = document.createElement("p"); p.className = "chart-empty";
    var t = document.createElement("span"); t.textContent = msg; p.appendChild(t);
    host.appendChild(p);
  }

  /* ---------- M8: BIZD against a loan ETF ---------- */
  var M8 = { basis: "total", data: null };
  function rebase(points, field) {
    var base = null, out = [];
    points.forEach(function (p) {
      var v = p[field];
      if (!isNum(v)) { out.push(null); return; }
      if (base === null) base = v;
      out.push(base ? Math.round(v / base * 10000) / 100 : null);
    });
    return out;
  }
  function renderM8() {
    var d = M8.data, cm = DATA.cm;
    var canvas = $("m8-canvas"), cap = $("m8-caption"), ft = $("m8-foot");
    if (!d || !d.a || !d.b) {
      chartEmpty("m8-chart", "Price history is not available: " + (d && d.why ? d.why : "the market feed did not answer") + ".");
      cap.textContent = "";
      ft.textContent = "Source: the market feed (/api/price-history) · BIZD" + (d && d.bTicker ? " and " + d.bTicker : "") + " · not available";
      legend("m8-legend", []);
      if (CHARTS["m8-canvas"]) { CHARTS["m8-canvas"].destroy(); CHARTS["m8-canvas"] = null; }
      return;
    }
    chartEmpty("m8-chart", null);
    var A = d.a, B = d.b;
    var adjOk = A.points.some(function (p) { return isNum(p.adjClose); }) && B.points.some(function (p) { return isNum(p.adjClose); });
    var basis = M8.basis === "total" && adjOk ? "adjClose" : "close";
    $("m8-total").disabled = !adjOk;
    $("m8-total").setAttribute("aria-pressed", basis === "adjClose" ? "true" : "false");
    $("m8-price").setAttribute("aria-pressed", basis === "close" ? "true" : "false");
    /* align both on month keys; the loan ETF may start later or end earlier */
    var byA = {}, byB = {};
    A.points.forEach(function (p) { byA[p.d.slice(0, 7)] = p; });
    B.points.forEach(function (p) { byB[p.d.slice(0, 7)] = p; });
    var keys = Object.keys(byA).filter(function (k) { return byB[k]; }).sort();
    if (keys.length < 2) { chartEmpty("m8-chart", "The two series share too few months to draw."); return; }
    var ptsA = keys.map(function (k) { return byA[k]; }), ptsB = keys.map(function (k) { return byB[k]; });
    var serA = rebase(ptsA, basis), serB = rebase(ptsB, basis);
    var lastPartial = !!(ptsA[ptsA.length - 1].partial || ptsB[ptsB.length - 1].partial);
    var dashLast = function (ctx) { return lastPartial && ctx.p1DataIndex === keys.length - 1 ? [4, 4] : undefined; };
    var yfmt = function (v) { return isNum(v) ? v.toFixed(0) : "—"; };
    drawLine("m8-canvas", keys, [
      { label: A.ticker, data: serA, borderColor: GOLD, backgroundColor: GOLD, borderWidth: 2, pointRadius: 0, pointHitRadius: 10, tension: 0, spanGaps: true, segment: { borderDash: dashLast } },
      { label: B.ticker, data: serB, borderColor: LINE2, backgroundColor: LINE2, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, pointHitRadius: 10, tension: 0, spanGaps: true }
    ], yfmt, "rebased, first month = 100", cm && cm.recessions);
    legend("m8-legend", [{ color: GOLD, label: A.ticker + " (listed BDCs)" }, { color: LINE2, dash: true, label: B.ticker + " (leveraged loans)" }]);
    /* the caption's five-year figures are computed here, never typed */
    var first = ptsA[0], last = ptsA[ptsA.length - 1], firstB = ptsB[0], lastB = ptsB[ptsB.length - 1];
    var aP = last.close / first.close - 1, bP = lastB.close / firstB.close - 1;
    var from = monthLabel(first.d), to = monthLabel(last.d);
    if (adjOk) {
      var aT = last.adjClose / first.adjClose - 1, bT = lastB.adjClose / firstB.adjClose - 1;
      var lead = aT >= bT ? A.ticker : B.ticker;
      /* the gap is taken from the rounded figures the sentence prints, so
         +24.4% and +26.7% never read as 2.2 points apart */
      var aR = Math.round(aT * 1000) / 10, bR = Math.round(bT * 1000) / 10;
      cap.textContent = CAPTIONS.m8.text({ a: A.ticker, aPrice: fmtRet(aP), aTr: fmtRet(aT), b: B.ticker, bPrice: fmtRet(bP), bTr: fmtRet(bT),
        from: from, to: to, lead: lead, gap: Math.abs(aR - bR).toFixed(1) });
    } else {
      cap.textContent = CAPTIONS.m8price.text({ a: A.ticker, aPrice: fmtRet(aP), b: B.ticker, bPrice: fmtRet(bP), from: from, to: to });
    }
    ft.textContent = "Source: the market feed (" + (A.source || "?") + (B.source && B.source !== A.source ? ", " + B.source : "") + ") · monthly closes, " +
      (basis === "adjClose" ? "dividend-adjusted" : "unadjusted price") + " · " + keys.length + " months · last point " + last.d +
      (lastPartial ? " (running month, dashed)" : "") + " · recessions from FRED USREC";
    /* the workbook's rows */
    var rows = ["<tr><th>Month</th><th>" + esc(A.ticker) + " close</th><th>" + esc(A.ticker) + " adjusted</th><th>" + esc(B.ticker) + " close</th><th>" + esc(B.ticker) + " adjusted</th></tr>"];
    keys.forEach(function (k, i) {
      rows.push("<tr><td>" + esc(k) + "</td><td>" + esc(String(ptsA[i].close)) + "</td><td>" + esc(isNum(ptsA[i].adjClose) ? String(ptsA[i].adjClose) : "") +
        "</td><td>" + esc(String(ptsB[i].close)) + "</td><td>" + esc(isNum(ptsB[i].adjClose) ? String(ptsB[i].adjClose) : "") + "</td></tr>");
    });
    $("t-prices").innerHTML = rows.join("");
  }
  $("m8-total").addEventListener("click", function () { M8.basis = "total"; renderM8(); wrapTerms($("market-view")); });
  $("m8-price").addEventListener("click", function () { M8.basis = "price"; renderM8(); wrapTerms($("market-view")); });

  /* ---------- M1: the spread ladder ---------- */
  var LADDER = [["Investment grade", "BAMLC0A0CM"], ["BB", "BAMLH0A1HYBB"], ["High yield", "BAMLH0A0HYM2"], ["Single-B", "BAMLH0A2HYB"], ["CCC and lower", "BAMLH0A3HYC"]];
  function renderM1(cm) {
    var host = $("m1-chart"), cap = $("m1-caption"), ft = $("m1-foot");
    var rows = LADDER.map(function (r) { var s = fromCredit(cm, r[1]); return { label: r[0], id: r[1], s: s, bps: s ? s.latest.v * 100 : null }; });
    var have = rows.filter(function (r) { return isNum(r.bps); });
    if (!have.length) {
      host.innerHTML = "<p class='chart-empty' style='position:static'><span>The spread series are not available: FRED " + esc(LADDER.map(function (r) { return r[1]; }).join(", ")) + ".</span></p>";
      cap.textContent = ""; ft.textContent = "Source: FRED, ICE BofA option-adjusted spreads · not available";
      return;
    }
    var top = Math.max.apply(null, have.map(function (r) { return r.bps; }));
    /* a round tick step — 100, 250 or 500 bps — and one scale for every bar */
    var step = [50, 100, 250, 500, 1000].filter(function (st) { return top / st <= 5; })[0] || 2000;
    var max = Math.ceil((top * 1.04) / step) * step;
    var pctOf = function (v) { return (100 * v / max).toFixed(2) + "%"; };
    /* HTML rows rather than an SVG: the bars stay readable at phone width */
    var out = "<div class='ladder'>";
    rows.forEach(function (r) {
      out += "<div class='ladder-row'><span class='l-label'>" + esc(r.label) + "</span>";
      if (isNum(r.bps)) {
        out += "<span class='l-track'><i class='" + (r.id === "BAMLH0A0HYM2" ? "accent" : "") + "' style='width:" + pctOf(r.bps) + "' title='" +
          esc(r.label + " " + fmtBps(r.s.latest.v) + " · " + r.id + " " + r.s.latest.d) + "'></i></span>" +
          "<span class='l-val'>" + esc(withCommas(Math.round(r.bps))) + "</span></div>";
      } else {
        out += "<span class='l-track'><span class='l-na'>not available (FRED " + esc(r.id) + ")</span></span><span class='l-val na'>—</span></div>";
      }
    });
    /* the slot the composite fills once the schedules of investments are parsed */
    out += "<div class='ladder-row slot'><span class='l-label'>BDC composite</span>" +
      "<span class='l-track'><span class='l-slot' style='width:50%'>spread over base · arrives with the BDC layer</span></span><span class='l-val na'>—</span></div>";
    out += "<div class='ladder-row scale'><span class='l-label'></span><span class='l-track'>";
    for (var v = step; v <= max; v += step) {
      out += "<b style='left:" + pctOf(v) + "'><span>" + esc(withCommas(v)) + "</span></b>";
    }
    out += "</span><span class='l-val'></span></div></div>";
    host.innerHTML = out;
    var by = {}; rows.forEach(function (r) { by[r.id] = r; });
    var ccc = by.BAMLH0A3HYC, bb = by.BAMLH0A1HYBB, ig = by.BAMLC0A0CM, hy = by.BAMLH0A0HYM2, b = by.BAMLH0A2HYB;
    if (isNum(ccc.bps) && isNum(bb.bps) && isNum(ig.bps) && isNum(hy.bps) && isNum(b.bps)) {
      cap.textContent = CAPTIONS.m1.text({ ccc: withCommas(Math.round(ccc.bps)), bb: withCommas(Math.round(bb.bps)), gap: withCommas(Math.round(ccc.bps - bb.bps)),
        ig: withCommas(Math.round(ig.bps)), hy: withCommas(Math.round(hy.bps)), b: withCommas(Math.round(b.bps)) });
    } else {
      cap.textContent = "One or more rungs did not answer, so the dispersion gap is not stated.";
    }
    var dates = have.map(function (r) { return r.s.latest.d; }).sort();
    ft.textContent = "Source: FRED, ICE BofA option-adjusted spreads (" + have.map(function (r) { return r.id; }).join(", ") + ") · as of " +
      (dates[0] === dates[dates.length - 1] ? dates[0] : dates[0] + " to " + dates[dates.length - 1]) +
      " · OAS over Treasuries for bonds; spread over base for loans";
  }

  /* ---------- M2: the yield stack ---------- */
  function renderM2(cm) {
    var cap = $("m2-caption"), ft = $("m2-foot");
    var sofr = fromCredit(cm, "SOFR"), hy = fromCredit(cm, "BAMLH0A0HYM2EY");
    if (!sofr && !hy) {
      chartEmpty("m2-chart", "The yield series are not available: FRED SOFR, BAMLH0A0HYM2EY.");
      cap.textContent = ""; ft.textContent = "Source: FRED · not available"; legend("m2-legend", []);
      if (CHARTS["m2-canvas"]) { CHARTS["m2-canvas"].destroy(); CHARTS["m2-canvas"] = null; }
      return;
    }
    chartEmpty("m2-chart", null);
    var endD = sofr && hy ? (hy.latest.d > sofr.latest.d ? hy.latest.d : sofr.latest.d) : (sofr || hy).latest.d;
    var endY = Number(endD.slice(0, 4)), endM = Number(endD.slice(5, 7));
    var startY = endY - 10, startM = endM + 1; if (startM > 12) { startM = 1; startY += 1; }
    var labels = monthKeys(startY + "-" + (startM < 10 ? "0" : "") + startM, endD);
    var toSeries = function (s) {
      if (!s) return labels.map(function () { return null; });
      var by = {}; (s.history || []).forEach(function (h) { by[h.d.slice(0, 7)] = h.v; });
      return labels.map(function (k) { return isNum(by[k]) ? by[k] : null; });
    };
    var yfmt = function (v) { return isNum(v) ? v.toFixed(1) + "%" : "—"; };
    drawLine("m2-canvas", labels, [
      { label: "High-yield effective yield", data: toSeries(hy), borderColor: GOLD, backgroundColor: GOLD, borderWidth: 2, pointRadius: 0, pointHitRadius: 10, tension: 0, spanGaps: false },
      { label: "SOFR", data: toSeries(sofr), borderColor: LINE2, backgroundColor: LINE2, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, pointHitRadius: 10, tension: 0, spanGaps: false }
    ], yfmt, "percent", cm.recessions);
    legend("m2-legend", [{ color: GOLD, label: "High-yield effective yield (BAMLH0A0HYM2EY)" }, { color: LINE2, dash: true, label: "SOFR" }]);
    if (sofr && hy) {
      var firstOf = function (s) { var h = s.history && s.history[0]; return h ? monthLabel(h.d) : "—"; };
      cap.textContent = CAPTIONS.m2.text({ sofr: fmtPct(sofr.latest.v, 2), hy: fmtPct(hy.latest.v, 2), gap: (hy.latest.v - sofr.latest.v).toFixed(2),
        sofrStart: firstOf(sofr), hyStart: firstOf(hy) });
    } else {
      cap.textContent = (sofr ? "SOFR at " + fmtPct(sofr.latest.v, 2) : "High-yield effective yield at " + fmtPct(hy.latest.v, 2)) +
        "; the other line did not answer (FRED " + (sofr ? "BAMLH0A0HYM2EY" : "SOFR") + ").";
    }
    ft.textContent = "Source: FRED (SOFR" + (sofr ? " " + sofr.latest.d : " not available") + "; BAMLH0A0HYM2EY" + (hy ? " " + hy.latest.d : " not available") +
      ") · month-end values · ten-year axis · recessions from FRED USREC · composite lines arrive with the BDC layer";
  }

  /* ---------- staleness ----------
     A daily or weekly series should have answered within 45 days and a
     monthly one within 75. FRED dates a quarter at its first day and
     publishes the delinquency and charge-off rates after the banks'
     Call Reports, up to five months after the quarter ends, so a
     quarterly series is aged from the end of its quarter and allowed
     200 days from there. */
  function checkStale(cm) {
    var warn = $("stale-warn");
    if (!cm || !cm.series) { warn.hidden = true; return; }
    var now = Date.now(), late = [];
    Object.keys(cm.series).forEach(function (id) {
      var s = cm.series[id];
      if (!s || !s.latest || !s.latest.d) return;
      var stamp = new Date(s.latest.d);
      if (s.freq === "quarterly") stamp.setUTCMonth(stamp.getUTCMonth() + 3);
      var days = (now - stamp.getTime()) / 864e5;
      var allow = s.freq === "quarterly" ? 200 : s.freq === "monthly" ? 75 : 45;
      if (days > allow) late.push(id + " (" + s.latest.d + ")");
    });
    if (!late.length) { warn.hidden = true; return; }
    warn.textContent = "Stale series: " + late.join(", ") + " — the last observation is older than the series' release rhythm allows, so read those tiles as history, not as today.";
    warn.hidden = false;
  }

  /* ---------- glossary ----------
     lib/credit-terms.js carries only the hover text, so the definitions
     come from data/pc/glossary.json, fetched the first time the view is
     shown and kept for the session. Only the fields the page prints are
     kept from each entry: whereUsed, fixNote and workingRef are
     maintenance notes and never reach the page. */
  var GLOSSARY = { terms: null, version: "", pending: null, error: null };
  function loadGlossary() {
    if (GLOSSARY.terms || GLOSSARY.pending) return;
    GLOSSARY.error = null;
    GLOSSARY.pending = fetch("data/pc/glossary.json")
      .then(function (r) { return HTTP.json(r, "the glossary"); })
      .then(function (g) {
        if (!g || !Array.isArray(g.terms)) throw new Error("The glossary file carries no term list.");
        GLOSSARY.terms = g.terms.map(function (t) {
          return { term: t.term, expansion: t.expansion, kind: t.kind, side: t.side,
                   popup: t.popup, definition: t.definition, source: t.source, aliases: t.aliases };
        });
        GLOSSARY.version = g.generated || "";
      })
      .catch(function (e) { GLOSSARY.error = e; })
      .then(function () { GLOSSARY.pending = null; renderGlossary(); });
  }
  /* glossary.json's side vocabulary: market | lender | both */
  var SIDES = [["market", "Market"], ["lender", "Lenders (BDCs)"], ["both", "Both sides"]];
  var KINDS = [["series-id", "Series ids"], ["acronym", "Acronyms"], ["instrument", "Instruments"], ["metric", "Metrics"], ["market", "Market terms"], ["regulation", "Regulation"]];
  function linkify(s) {
    return esc(s).replace(/(https?:\/\/[^\s)"'<>]+)/g, function (u) {
      var trail = u.match(/[.,;]+$/) ? u.match(/[.,;]+$/)[0] : "";
      var clean = trail ? u.slice(0, -trail.length) : u;
      return "<a href='" + clean + "' target='_blank' rel='noopener'>" + clean + "</a>" + trail;
    });
  }
  function renderGlossary() {
    var host = $("glossary-list"), count = $("glossary-count");
    var terms = GLOSSARY.terms;
    if (!terms) {
      count.textContent = "";
      if (GLOSSARY.error) {
        host.innerHTML = "<p class='gl-empty'>The glossary could not be loaded (" + esc(HTTP.message(GLOSSARY.error, "the glossary")) + "). " +
          "<button type='button' class='refresh-btn' id='glossary-retry'>Try again</button></p>";
        $("glossary-retry").addEventListener("click", function () { GLOSSARY.error = null; renderGlossary(); });
        return;
      }
      host.innerHTML = "<p class='gl-empty'>Loading the glossary…</p>";
      loadGlossary();
      return;
    }
    var q = ($("glossary-q").value || "").trim().toLowerCase();
    var shown = terms.filter(function (t) {
      if (!q) return true;
      var hay = [t.term, t.expansion, t.kind].concat(t.aliases || []).join(" ").toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    count.textContent = (q ? shown.length + " of " : "") + terms.length + " terms" + (GLOSSARY.version ? " · v" + GLOSSARY.version : "");
    if (!shown.length) { host.innerHTML = "<p class='gl-empty'>No term matches “" + esc(q) + "”.</p>"; return; }
    var html = "";
    SIDES.forEach(function (side) {
      var ofSide = shown.filter(function (t) { return (t.side || "market") === side[0]; });
      if (!ofSide.length) return;
      html += "<div class='gl-side'><h3>" + esc(side[1]) + "</h3>";
      var seen = {};
      KINDS.concat([["other", "Other"]]).forEach(function (kind) {
        var ofKind = ofSide.filter(function (t) {
          var k = KINDS.some(function (kk) { return kk[0] === t.kind; }) ? t.kind : "other";
          return k === kind[0] && !seen[t.term];
        });
        if (!ofKind.length) return;
        ofKind.sort(function (a, b) { return a.term.localeCompare(b.term); });
        html += "<div class='gl-kind'><h4>" + esc(kind[1]) + "</h4>";
        ofKind.forEach(function (t) {
          seen[t.term] = true;
          html += "<div class='gl-entry'><div class='gl-term'><b>" + esc(t.term) + "</b>" +
            (t.expansion && t.expansion !== t.term ? "<span class='gl-exp'>" + esc(t.expansion) + "</span>" : "") + "</div>" +
            "<p class='gl-def'>" + esc(t.definition || t.popup || "") + "</p>" +
            (t.source ? "<p class='gl-src'>Source: " + linkify(t.source) + "</p>" : "") + "</div>";
        });
        html += "</div>";
      });
      html += "</div>";
    });
    host.innerHTML = html;
  }
  $("glossary-q").addEventListener("input", renderGlossary);

  /* ---------- views ---------- */
  var VIEWS = ["market", "lenders", "underwriting", "glossary"];
  var state = { view: "market" };
  function setView(v, push) {
    if (VIEWS.indexOf(v) < 0) v = "market";
    state.view = v;
    VIEWS.forEach(function (k) {
      $(k + "-view").hidden = k !== v;
      $("view-" + k).setAttribute("aria-pressed", k === v ? "true" : "false");
    });
    if (v === "glossary") renderGlossary();
    if (push !== false) {
      var u = new URL(location.href);
      u.searchParams.set("view", v);
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
    hidePop(null);
  }
  VIEWS.forEach(function (k) { $("view-" + k).addEventListener("click", function () { setView(k); }); });

  /* ---------- loading ---------- */
  var DATA = { cm: null, macro: null };
  function statusLine(msg) { $("status").textContent = msg || ""; }
  function renderAll() {
    renderStrip(DATA.cm, DATA.macro);
    renderM8();
    renderM1(DATA.cm);
    renderM2(DATA.cm);
    checkStale(DATA.cm);
    wrapTerms($("market-view"));
  }
  /* the loan ETF: SRLN first, BKLN when it is not served */
  function loanEtf(force) {
    return getJson("/api/price-history?ticker=SRLN", "SRLN", force).catch(function (e1) {
      return getJson("/api/price-history?ticker=BKLN", "BKLN", force).catch(function (e2) {
        throw new Error(HTTP.message(e1, "SRLN") + " / " + HTTP.message(e2, "BKLN"));
      });
    });
  }
  function load(force) {
    statusLine(force ? "Refreshing every feed, skipping the six-hour cache…" : "Loading the credit series…");
    var problems = [];
    var note = function (what) { return function (e) { problems.push({ what: what, e: e }); return null; }; };
    return API_BASE_READY.then(function (base) {
      API_BASE = base;
      return Promise.all([
        getJson("/api/credit-macro", "the credit series", force).catch(note("credit series")),
        getJson("/api/macro", "the macro feed", force).catch(note("macro feed")),
        getJson("/api/price-history?ticker=BIZD", "BIZD", force).catch(note("BIZD price history")),
        loanEtf(force).catch(note("loan ETF price history"))
      ]);
    }).then(function (r) {
      /* a forced refresh that is refused or fails leaves what is already
         drawn in place; only a first load shows the empty state */
      var keep = force && DATA.cm;
      DATA.cm = r[0] || (keep ? DATA.cm : null);
      DATA.macro = r[1] || (keep ? DATA.macro : null);
      var why = problems.filter(function (p) { return /price/.test(p.what); }).map(function (p) { return HTTP.message(p.e); }).join("; ");
      var prev = M8.data || {};
      M8.data = { a: r[2] || (keep ? prev.a : null), b: r[3] || (keep ? prev.b : null),
                  bTicker: r[3] ? r[3].ticker : prev.bTicker || "SRLN", why: why || null };
      renderAll();
      var cm = DATA.cm;
      var n = cm && cm.series ? Object.keys(cm.series).filter(function (k) { return fromCredit(cm, k); }).length : 0;
      var refused = problems.filter(function (p) { return p.e && (p.e.status === 429 || p.e.status === 403); });
      if (force && refused.length) {
        statusLine("The forced refresh was not accepted (" + HTTP.message(refused[0].e) + "); it is limited to a few a minute and to the terminal's own pages. " +
          "The series already on the page stay as they were.");
      } else if (problems.length) {
        statusLine((cm ? n + " of 22 FRED series answered" + (cm.generated ? ", built " + cm.generated.slice(0, 16).replace("T", " ") + " UTC" : "") + ". " : "") +
          "Not available: " + problems.map(function (p) { return p.what + " (" + HTTP.message(p.e) + ")"; }).join("; ") + ".");
      } else {
        statusLine(n + " of 22 FRED series answered" + (cm && cm.generated ? ", built " + cm.generated.slice(0, 16).replace("T", " ") + " UTC" : "") +
          (cm && cm.keyed === false ? ", keyless" : "") + (FIXTURE ? " · fixture data" : "") + ".");
      }
    });
  }
  $("refresh-btn").addEventListener("click", function () {
    var b = $("refresh-btn");
    b.disabled = true; b.textContent = "Refreshing…";
    load(true).then(function () { b.disabled = false; b.textContent = "Refresh"; },
      function () { b.disabled = false; b.textContent = "Refresh"; });
  });

  /* ---------- about ---------- */
  var aboutModal = $("about-modal"), opener = null;
  $("about-btn").addEventListener("click", function () {
    opener = document.activeElement;
    aboutModal.hidden = false;
    aboutModal.querySelector(".modal").focus();
  });
  function closeAbout() {
    aboutModal.hidden = true;
    if (opener && opener.focus) opener.focus();
    opener = null;
  }
  $("about-close").addEventListener("click", closeAbout);
  aboutModal.addEventListener("click", function (ev) { if (ev.target === aboutModal) closeAbout(); });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !aboutModal.hidden) closeAbout();
  });

  /* ---------- export ---------- */
  (function () {
    var xb = $("export-xlsx");
    var ctx = function () { return { company: "Private credit", page: "Private Credit Terminal", source: ($("src-footer-text") || {}).textContent || "" }; };
    if (xb && window.RTExport) xb.addEventListener("click", function () {
      var tables = document.querySelectorAll("main table.grid");
      if (!window.RTExport.xlsx(tables, ctx())) xb.textContent = "Nothing to export";
    });
  })();

  /* ---------- init ---------- */
  /* ?view= picks the view; ?t=TICKER is reserved for the Lenders view's
     per-BDC drill-down and is carried, not acted on, until it ships. */
  var urlView = (location.search.match(/[?&]view=([a-z]+)/) || [])[1];
  setView(urlView || "market", false);
  wrapTerms($("lenders-view"));
  wrapTerms($("underwriting-view"));
  load(false);

  /* The edge fade appears only when the nav genuinely overflows. */
  (function () {
    var nav = document.querySelector(".nav-tabs");
    if (!nav) return;
    var sync = function () {
      nav.classList.toggle("is-scrollable", nav.scrollWidth > nav.clientWidth + 1);
    };
    var later = function () { requestAnimationFrame(sync); };
    sync();
    window.addEventListener("resize", later);
    window.addEventListener("orientationchange", later);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(later);
    if (typeof ResizeObserver === "function") new ResizeObserver(later).observe(nav);
  })();
})();
