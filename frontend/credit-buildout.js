/* credit-buildout.js — the hyperscaler and neocloud build-out monitor
   (blueprint section 15.1-15.3, PR H2). A fourth top-level view on the
   credit page, beside Market, Lenders and Underwriting, mounted lazily
   the first time its tab is opened (the pattern credit.js's own
   renderGlossary() uses for the Glossary view).

   Reads the three small files scripts/build-capex-panel.mjs (PR H1)
   already writes: data/capex/hyperscalers.json, neoclouds.json,
   landlords.json. Every figure on this view is one of:
     - a value already resolved in those files (a tagged XBRL fact, a
       hand-keyed adjustment with its own accession, or a ratio
       buildFilerCapexPanel computed from tagged lines), or
     - an arithmetic combination of those values done here at render
       time (a cohort sum, a year-over-year change, a share of a
       total) — never a number typed from the blueprint's prose.
   A null field is a genuine gap (not tagged, not yet filed, or — for
   Nebius's quarterly balance-sheet fields — not available at that
   grain, per each point's own dataLimitation) and renders as a
   designed empty state, never as zero.

   Contract, mirroring credit-stress.js:
     - RTCatalog.register() runs at file evaluation (module load), so a
       duplicate key throws immediately and never depends on this
       view being opened.
     - CAPTIONS: { name: { template(values), sample() } } — every
       sample() is measured under 240 characters by
       scripts/test-buildout-view.mjs, the same rule every other
       caption on this page follows (blueprint section 9).
     - Every render function that does not need the DOM is a pure
       function of its data (string in, HTML string out), so
       scripts/test-buildout-view.mjs can call it in Node against a
       small real cut of the committed panel files. Only render()
       and the small event-binding helpers below it touch `document`.
     - window.RTBuildout = { render, CAPTIONS, _internal } — render()
       is what credit.js's view-toggle hook calls; _internal exposes
       the pure functions the offline test drives directly.

   Must-not-build (blueprint 15.9), respected here: no CDS, no
   secondary bond prices, no valuation/IRR for a private company or
   SPV, no adjusted EBITDA/DSCR computed by the site (net debt to
   EBITDA and interest coverage use only the operating-income and D&A
   lines the panel already resolved), no guidance-derived figure (that
   is 15.4, PR H3), no single AI-capex total mixing sources, no sum
   across filers of purchase obligations or uncommenced leases (H8
   draws them side by side, never summed), no company-quoted capex
   plotted against the tagged line without the bridge (this view shows
   the tagged line only; the bridge is 15.4/H9-H10, out of scope here),
   and Amazon's TTM facts never stand in for a quarter or a year (the
   panel's own capexRunRate.checkValue is the only place a TTM figure
   appears, labeled as the company's own check value, never merged
   into the run-rate itself). */
(function () {
  "use strict";

  var CAT = window.RTCatalog || null;

  /* ---------- pure helpers: no DOM ---------- */
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  /* dollars in -> "$35.8B" / "−$4.2B"; dp defaults to 1, or 2 under $1B */
  function fmtB(v, dp) {
    if (!isNum(v)) return "—";
    var b = v / 1e9, a = Math.abs(b);
    var d = dp !== undefined ? dp : (a < 1 ? 2 : (a < 10 ? 1 : 0));
    return (v < 0 ? "−$" : "$") + a.toFixed(d) + "B";
  }
  function fmtX(v) {
    if (v === "n/m") return "n/m";
    return isNum(v) ? v.toFixed(2) + "×" : "—";
  }
  function fmtQ(cq) {
    var m = /^(\d{4})-Q(\d)$/.exec(String(cq || ""));
    return m ? "Q" + m[2] + " " + m[1] : (cq || "—");
  }
  function fmtDate(d) {
    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (!d) return "—";
    var s = String(d);
    return s.length >= 10 ? MONTHS[Number(s.slice(5, 7)) - 1] + " " + Number(s.slice(8, 10)) + ", " + s.slice(0, 4) : s;
  }
  function last(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
  function sortByEnd(arr) { return (arr || []).slice().sort(function (a, b) { return a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0; }); }
  function daysBetween(a, b) {
    var da = a ? new Date(a).getTime() : NaN, db = b ? new Date(b).getTime() : NaN;
    return (isFinite(da) && isFinite(db)) ? Math.abs(db - da) / 86400000 : Infinity;
  }
  function get(obj, path) {
    var parts = path.split("."), v = obj;
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }

  /* ---------- the universe ---------- */
  var COHORTS = {
    hyperscalers: ["MSFT", "GOOG", "AMZN", "META", "ORCL"],
    neoclouds: ["CRWV", "NBIS", "APLD", "IREN", "CIFR", "WULF"],
    landlords: ["EQIX", "DLR"]
  };
  var COHORT_LABEL = { hyperscalers: "Hyperscalers", neoclouds: "Neoclouds", landlords: "Landlords" };
  var NAMES = {
    MSFT: "Microsoft", GOOG: "Alphabet", AMZN: "Amazon", META: "Meta", ORCL: "Oracle",
    CRWV: "CoreWeave", NBIS: "Nebius", APLD: "Applied Digital", IREN: "IREN", CIFR: "Cipher",
    WULF: "TeraWulf", EQIX: "Equinix", DLR: "Digital Realty"
  };
  var FOOTNOTE_TICKERS = { ORCL: 1, APLD: 1 }; /* quarters end one month early */
  var PALETTE = ["#f5c518", "#5ecb8f", "#ff8a80", "#c99cf2", "#6bc9c9", "#f0c96a", "#e8935a"];
  function colorOf(tickers, ticker) { return PALETTE[tickers.indexOf(ticker) % PALETTE.length] || "#8b8f98"; }
  var INK = "#8b8f98", LINE2 = "#b6bac2", GRID = "rgba(255,255,255,.08)", HOLLOW = "#16181c";

  /* ---------- reading the panel files ---------- */
  /* companiesOf(panels, cohort) -> { TICKER: companyEntry } for the
     tickers that cohort names and that the fetched file actually
     carries (a filer the build script could not reach that week is
     simply absent, never a fabricated zero). */
  function companiesOf(panels, cohort) {
    var doc = panels && panels[cohort];
    var out = {};
    (COHORTS[cohort] || []).forEach(function (t) {
      if (doc && doc.companies && doc.companies[t]) out[t] = doc.companies[t];
    });
    return out;
  }
  function pointsByQuarter(company) {
    var out = {};
    (company.quarterly || []).forEach(function (p) { if (p.grain === "quarter" && p.calendarQuarter) out[p.calendarQuarter] = p; });
    return out;
  }
  /* every calendar quarter at least one company in the set reports,
     ascending; plain string sort is correct for "YYYY-Qn" */
  function quartersOf(companiesByTicker, tickers) {
    var seen = {};
    tickers.forEach(function (t) {
      var c = companiesByTicker[t]; if (!c) return;
      (c.quarterly || []).forEach(function (p) { if (p.grain === "quarter" && p.calendarQuarter) seen[p.calendarQuarter] = true; });
    });
    return Object.keys(seen).sort();
  }
  function quarterBefore(cq, n) {
    var m = /^(\d{4})-Q(\d)$/.exec(String(cq || "")); if (!m) return null;
    var y = Number(m[1]), q = Number(m[2]) - n;
    while (q <= 0) { q += 4; y -= 1; }
    return y + "-Q" + q;
  }
  /* the latest point (quarterly ∪ annual) whose `field` is non-null —
     ORCL's most recent 10-Q, for example, shows gross debt as null
     (the DebtInstrumentCarryingAmount leakage the blueprint's
     refutation names at 15.3), so the debt/lease chapter falls
     through to its last good 10-K instant rather than showing a hole
     next to real fields from the same filing. */
  function latestWithField(company, field) {
    var all = sortByEnd((company.quarterly || []).concat(company.annual || [])).reverse();
    for (var i = 0; i < all.length; i++) { if (isNum(get(all[i], field))) return all[i]; }
    return all[0] || null;
  }
  /* the latest point (quarterly ∪ annual) that carries at least one
     tagged maturity bucket. Anchoring the maturity ladder on
     latestWithField(company, "debt.grossDebt") instead (the field that
     happens to answer soonest) silently drops GOOG's and AMZN's ladders:
     both re-tag gross debt every 10-Q but tag the maturity schedule only
     in the 10-K, so their newest gross-debt point carries no bucket at
     all. This scans for the bucket directly, the same way
     latestWithField scans for any other field. */
  function latestWithLadder(company) {
    var all = sortByEnd((company.quarterly || []).concat(company.annual || [])).reverse();
    for (var i = 0; i < all.length; i++) {
      if (MATURITY_BUCKETS.some(function (b) { return isNum(all[i].maturities[b[0]]); })) return all[i];
    }
    return null;
  }
  /* the latest calendar quarter where at least half the cohort has
     reported — anchors a caption's "latest quarter" reading, so one
     early filer (Oracle's fiscal quarter ends first among this cohort)
     does not make a one-company quarter read as the whole cohort, or
     its year-over-year change look like a cliff. The chart itself
     still draws every quarter, hatching a filer that has not reported
     yet — this only changes which quarter the CAPTION talks about. */
  function mostCompleteQuarter(quarters, companiesByTicker, tickers) {
    for (var i = quarters.length - 1; i >= 0; i--) {
      var have = tickers.filter(function (t) { var c = companiesByTicker[t]; return c && pointsByQuarter(c)[quarters[i]]; }).length;
      if (have >= Math.ceil(tickers.length / 2)) return quarters[i];
    }
    return last(quarters);
  }

  /* ================= H1: aggregate capex by company, quarterly ================= */
  /* Pure and exported: the acceptance figure (blueprint 15.9) is the
     calendar-Q2 2026 hyperscaler stack, 181,543,000,000 — computed
     here from the real panel file, never typed. */
  function calendarQuarterStack(companiesByTicker, tickers, quarter) {
    var parts = [], total = 0, any = false, missing = [];
    tickers.forEach(function (t) {
      var c = companiesByTicker[t];
      var byQ = c ? pointsByQuarter(c) : {};
      var p = byQ[quarter];
      var v = p && isNum(p.capex.total) ? p.capex.total : null;
      if (v === null) missing.push(t); else { total += v; any = true; }
      parts.push({ ticker: t, value: v, form: p ? p.form : null, accession: p ? p.accession : null });
    });
    return { quarter: quarter, total: any ? total : null, parts: parts, missing: missing };
  }
  function h1Data(companiesByTicker, tickers, nQuarters) {
    var all = quartersOf(companiesByTicker, tickers);
    var quarters = all.slice(Math.max(0, all.length - nQuarters));
    return quarters.map(function (q) { return calendarQuarterStack(companiesByTicker, tickers, q); });
  }
  function svgH1(stacks, tickers) {
    var W = 720, H = 260, padL = 46, padR = 10, padT = 10, padB = 34;
    var iw = W - padL - padR, ih = H - padT - padB;
    var n = stacks.length || 1;
    var maxTotal = 0;
    stacks.forEach(function (s) { var t = s.parts.reduce(function (a, p) { return a + (p.value || 0); }, 0); if (t > maxTotal) maxTotal = t; });
    if (maxTotal <= 0) maxTotal = 1;
    var Y = function (v) { return padT + ih - (v / maxTotal) * ih; };
    var bw = (iw / n) * 0.62, gap = (iw / n) * 0.38;
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Aggregate capex by company, quarterly'>";
    out += "<text x='" + padL + "' y='" + (padT - 2) + "' font-size='8' fill='" + INK + "'>$B</text>";
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var y = Y(maxTotal * f);
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + y.toFixed(1) + "' y2='" + y.toFixed(1) + "' stroke='" + GRID + "' stroke-width='1'/>" +
        "<text x='" + (padL - 6) + "' y='" + (y + 3).toFixed(1) + "' text-anchor='end' font-size='9' fill='" + INK + "'>" + (maxTotal * f / 1e9).toFixed(0) + "</text>";
    });
    out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + (padT + ih) + "' y2='" + (padT + ih) + "' stroke='" + GRID + "' stroke-width='1'/>";
    stacks.forEach(function (s, i) {
      var x = padL + gap / 2 + i * (bw + gap);
      var y0 = padT + ih;
      s.parts.forEach(function (p) {
        var v = p.value || 0;
        var h = v > 0 ? Math.max(1, (v / maxTotal) * ih) : 0;
        var color = colorOf(tickers, p.ticker);
        if (p.value === null) {
          /* a missing filer for this quarter: a small hatched marker,
             never a silent zero */
          out += "<rect x='" + x.toFixed(1) + "' y='" + (y0 - 6).toFixed(1) + "' width='" + bw.toFixed(1) + "' height='6' fill='" + HOLLOW + "' stroke='" + color + "' stroke-width='1' stroke-dasharray='2 2'>" +
            "<title>" + esc(NAMES[p.ticker] || p.ticker) + ": no tagged capex for " + esc(fmtQ(s.quarter)) + "</title></rect>";
          return;
        }
        var srcSuffix = p.form ? " (" + p.form + (p.accession ? ", accession " + p.accession : "") + ")" : "";
        out += "<rect x='" + x.toFixed(1) + "' y='" + (y0 - h).toFixed(1) + "' width='" + bw.toFixed(1) + "' height='" + h.toFixed(1) + "' fill='" + color + "'>" +
          "<title>" + esc(NAMES[p.ticker] || p.ticker) + " " + esc(fmtQ(s.quarter)) + ": " + fmtB(v) + esc(srcSuffix) + "</title></rect>";
        y0 -= h;
      });
      out += "<text x='" + (x + bw / 2).toFixed(1) + "' y='" + (H - 10) + "' text-anchor='middle' font-size='9' fill='" + INK + "'>" + esc(fmtQ(s.quarter)) + "</text>";
    });
    out += "</svg>";
    return out;
  }
  function h1Legend(tickers, companiesByTicker) {
    return tickers.filter(function (t) { return companiesByTicker[t]; }).map(function (t) {
      return "<span><i style='background:" + colorOf(tickers, t) + "'></i>" + esc(NAMES[t] || t) + (FOOTNOTE_TICKERS[t] ? "&nbsp;†" : "") + "</span>";
    }).join("");
  }

  /* ================= H2: capex against operating cash flow ================= */
  function h2CompanyData(company, nQuarters) {
    var pts = sortByEnd((company.quarterly || []).filter(function (p) { return p.grain === "quarter"; }));
    return pts.slice(Math.max(0, pts.length - nQuarters)).map(function (p) {
      return { end: p.periodEnd, cq: p.calendarQuarter, capex: p.capex.total, cfo: p.cashFlow.cfOps };
    });
  }
  function svgH2(points) {
    var W = 300, H = 130, padL = 34, padR = 8, padT = 8, padB = 18;
    var iw = W - padL - padR, ih = H - padT - padB;
    var have = points.filter(function (p) { return isNum(p.capex) || isNum(p.cfo); });
    if (!have.length) return "";
    var vals = [];
    points.forEach(function (p) { if (isNum(p.capex)) vals.push(p.capex); if (isNum(p.cfo)) vals.push(p.cfo); });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max.apply(null, vals) * 1.1 || 1;
    var Y = function (v) { return padT + ih - ((v - lo) / (hi - lo)) * ih; };
    var n = points.length;
    var X = function (i) { return padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw); };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Capex against operating cash flow'>";
    out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + Y(0).toFixed(1) + "' y2='" + Y(0).toFixed(1) + "' stroke='" + GRID + "' stroke-width='1'/>";
    var gapPath = "M" + X(0).toFixed(1) + " " + Y(points[0].capex || 0).toFixed(1);
    points.forEach(function (p, i) { gapPath += " L" + X(i).toFixed(1) + " " + Y(isNum(p.capex) ? p.capex : 0).toFixed(1); });
    for (var i = points.length - 1; i >= 0; i--) gapPath += " L" + X(i).toFixed(1) + " " + Y(isNum(points[i].cfo) ? points[i].cfo : 0).toFixed(1);
    out += "<path d='" + gapPath + " Z' fill='rgba(245,197,24,.14)' stroke='none'/>";
    function line(key, color, dash) {
      var d = "", pen = false;
      points.forEach(function (p, i) { if (!isNum(p[key])) { pen = false; return; } d += (pen ? "L" : "M") + X(i).toFixed(1) + " " + Y(p[key]).toFixed(1) + " "; pen = true; });
      if (d) out += "<path d='" + d.trim() + "' fill='none' stroke='" + color + "' stroke-width='1.8'" + (dash ? " stroke-dasharray='4 3'" : "") + "/>";
    }
    line("cfo", LINE2, true);
    line("capex", "#f5c518", false);
    points.forEach(function (p, i) {
      if (isNum(p.capex)) out += "<circle cx='" + X(i).toFixed(1) + "' cy='" + Y(p.capex).toFixed(1) + "' r='2' fill='#f5c518'><title>" + esc(fmtQ(p.cq)) + " capex " + fmtB(p.capex) + "</title></circle>";
      if (isNum(p.cfo)) out += "<circle cx='" + X(i).toFixed(1) + "' cy='" + Y(p.cfo).toFixed(1) + "' r='2' fill='" + LINE2 + "'><title>" + esc(fmtQ(p.cq)) + " operating cash flow " + fmtB(p.cfo) + "</title></circle>";
    });
    out += "</svg>";
    return out;
  }

  /* ================= H3: capex intensity heat table ================= */
  var H3_RATIOS = [
    { key: "capexToOperatingCashFlow", label: "Capex ÷ operating cash flow", stripe: 1.0 },
    { key: "capexToRevenue", label: "Capex ÷ revenue", stripe: null },
    { key: "capexToDepreciation", label: "Capex ÷ depreciation", stripe: 3.0, growth: true }
  ];
  /* capex ÷ operating cash flow can be negative when operating cash flow
     itself was negative that quarter — the company funded ALL of capex
     from outside operations, which is worse than a ratio over 1.0, never
     a safe or unmeasurable one. `hot` (computed by the caller from the
     company's own consecutive-quarter run, below) already treats a
     negative ratio as exceeding; this only decides the cell's style. */
  function h3Cell(v, rule, hot) {
    if (!isNum(v)) return { text: "—", cls: "" };
    var cls = "";
    if (rule.growth) { if (v > rule.stripe) cls = "bo-cell-growth"; }
    else if (rule.stripe !== null && hot) cls = "bo-cell-hot";
    return { text: v.toFixed(2) + "×", cls: cls };
  }
  /* capex ÷ operating cash flow "exceeds" whenever it reads over 1.0 OR
     the ratio is negative (negative operating cash flow); a stripe marks
     only the fourth or later quarter of a run of exceeding quarters,
     computed over the company's own full quarterly history so a run that
     started before the visible window still counts. */
  function h3ExceedsOpsCashFlow(v) { return isNum(v) && (v > 1.0 || v < 0); }
  function h3HotByQuarter(company) {
    var pts = sortByEnd((company.quarterly || []).filter(function (p) { return p.grain === "quarter"; }));
    var run = 0, out = {};
    pts.forEach(function (p) {
      var v = p.ratios && p.ratios.capexToOperatingCashFlow;
      run = h3ExceedsOpsCashFlow(v) ? run + 1 : 0;
      if (p.calendarQuarter) out[p.calendarQuarter] = run >= 4;
    });
    return out;
  }

  /* ================= H4: funding mix per company per year ================= */
  var SOURCE_KEYS = ["cfOps", "debtNet", "convertsNet", "equity", "partners", "cashDrawnDown"];
  var USE_LABEL = { capex: "Capex", buybacks: "Buybacks", dividends: "Dividends", debtRepaidGross: "Debt repaid" };
  /* null-safe sum: a component that is never tagged is a genuine gap, not
     a zero (module header) — this returns null only when EVERY component
     is null, so a company with nothing tagged for "equity" renders
     "not tagged" (fmtB(null) -> "—"), never "$0.00B". */
  function sumOrNull() {
    var total = 0, any = false;
    for (var i = 0; i < arguments.length; i++) { var v = arguments[i]; if (isNum(v)) { any = true; total += v; } }
    return any ? total : null;
  }
  function h4YearPoint(annualPoint) {
    var su = annualPoint.sourcesAndUses || {};
    var debtNet = sumOrNull(su.debtIssued, isNum(su.debtRepaid) ? -su.debtRepaid : null,
      su.shortTermDebtProceeds, isNum(su.shortTermDebtRepaid) ? -su.shortTermDebtRepaid : null);
    var convertsNet = sumOrNull(su.convertsIssued, isNum(su.convertsRepaid) ? -su.convertsRepaid : null);
    var equity = sumOrNull(su.equityIssued, su.preferredIssued, su.ipoProceeds, su.warrantsIssued);
    var partners = sumOrNull(su.jvPartnerFunding, isNum(su.jvInvestment) ? -su.jvInvestment : null);
    /* cash.drawdown > 0 means cash FELL that year — a source of funding
       ("Cash drawn down"), stacked above the axis. cash.drawdown < 0
       means cash ROSE — a use of funding ("Cash built up"), stacked
       below with capex and the rest. Never negated: the sign kept here
       is the sign of what actually happened to the cash balance. */
    var drawdown = isNum(annualPoint.cash && annualPoint.cash.drawdown) ? annualPoint.cash.drawdown : null;
    var cashDrawnDown = drawdown !== null && drawdown > 0 ? drawdown : 0;
    var cashBuiltUp = drawdown !== null && drawdown < 0 ? -drawdown : 0;
    var cfOps = annualPoint.cashFlow ? annualPoint.cashFlow.cfOps : null;
    var uses = {
      capex: annualPoint.capex ? annualPoint.capex.total : null,
      buybacks: annualPoint.cashFlow ? annualPoint.cashFlow.buybacks : null,
      dividends: annualPoint.cashFlow ? annualPoint.cashFlow.dividendsPaid : null,
      debtRepaidGross: su.debtRepaid || null
    };
    return {
      end: annualPoint.periodEnd, label: annualPoint.label || annualPoint.filerFiscalYear,
      sources: { cfOps: cfOps, debtNet: debtNet, convertsNet: convertsNet, equity: equity, partners: partners, cashDrawnDown: cashDrawnDown },
      leaseAdditions: su.financeLeaseAdditions,
      uses: uses,
      fundingGap: isNum(annualPoint.fundingGap) ? annualPoint.fundingGap : null,
      freeCashFlowAfterCapex: annualPoint.freeCashFlow ? annualPoint.freeCashFlow.afterCapex : null,
      freeCashFlowAfterCapexBuybacksDividends: annualPoint.freeCashFlow ? annualPoint.freeCashFlow.afterCapexBuybacksDividends : null,
      cashBuiltUp: cashBuiltUp
    };
  }
  var SOURCE_COLOR = { cfOps: "#f5c518", debtNet: "#b6bac2", convertsNet: "#c99cf2", equity: "#5ecb8f", partners: "#6bc9c9", cashDrawnDown: "#8b8f98" };
  var SOURCE_LABEL = { cfOps: "Operating cash flow", debtNet: "Debt raised, net", convertsNet: "Converts, net", equity: "Equity and preferred", partners: "JV partner funding, net", cashDrawnDown: "Cash drawn down" };
  function svgH4(years) {
    var W = 300, H = 150, padL = 34, padR = 8, padT = 8, padB = 18;
    var iw = W - padL - padR, ih = H - padT - padB;
    var maxUp = 0, maxDown = 0;
    years.forEach(function (y) {
      var up = 0; SOURCE_KEYS.forEach(function (k) { up += y.sources[k] > 0 ? y.sources[k] : 0; });
      var down = (y.uses.capex || 0) + (y.uses.buybacks || 0) + (y.uses.dividends || 0) + (y.uses.debtRepaidGross || 0) + (y.cashBuiltUp || 0);
      if (up > maxUp) maxUp = up; if (down > maxDown) maxDown = down;
    });
    var scale = Math.max(maxUp, maxDown, 1);
    var mid = padT + (maxUp / (maxUp + maxDown || 1)) * ih;
    /* keep the zero line comfortably inside the frame even with a lopsided mix */
    mid = Math.min(padT + ih - 14, Math.max(padT + 14, mid));
    var pxPerDollar = Math.min((mid - padT) / (maxUp || 1), (padT + ih - mid) / (maxDown || 1));
    var n = years.length, bw = (iw / n) * 0.5, gap = (iw / n) * 0.5;
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Funding mix per year'>";
    out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + mid.toFixed(1) + "' y2='" + mid.toFixed(1) + "' stroke='" + INK + "' stroke-width='.8'/>";
    years.forEach(function (y, i) {
      var x = padL + gap / 2 + i * (bw + gap);
      var up = mid;
      SOURCE_KEYS.forEach(function (k) {
        var v = y.sources[k]; if (!isNum(v) || v <= 0) return;
        var h = v * pxPerDollar;
        out += "<rect x='" + x.toFixed(1) + "' y='" + (up - h).toFixed(1) + "' width='" + bw.toFixed(1) + "' height='" + h.toFixed(1) + "' fill='" + SOURCE_COLOR[k] + "'><title>" + esc(SOURCE_LABEL[k]) + " " + fmtB(v) + "</title></rect>";
        up -= h;
      });
      if (isNum(y.leaseAdditions) && y.leaseAdditions > 0) {
        var lh = y.leaseAdditions * pxPerDollar;
        out += "<rect x='" + x.toFixed(1) + "' y='" + (up - lh).toFixed(1) + "' width='" + bw.toFixed(1) + "' height='" + lh.toFixed(1) + "' fill='none' stroke='#f5c518' stroke-width='1.3' stroke-dasharray='3 2'><title>Finance-lease additions (non-cash) " + fmtB(y.leaseAdditions) + "</title></rect>";
      }
      var down = mid;
      [["capex", "#f5c518"], ["buybacks", LINE2], ["dividends", "#6bc9c9"], ["debtRepaidGross", "#ff8a80"]].forEach(function (pair) {
        var v = y.uses[pair[0]]; if (!isNum(v) || v <= 0) return;
        var h = v * pxPerDollar;
        out += "<rect x='" + x.toFixed(1) + "' y='" + down.toFixed(1) + "' width='" + bw.toFixed(1) + "' height='" + h.toFixed(1) + "' fill='" + pair[1] + "' fill-opacity='.72'><title>" + esc(USE_LABEL[pair[0]] || pair[0]) + " " + fmtB(v) + "</title></rect>";
        down += h;
      });
      if (y.cashBuiltUp > 0) {
        var ch = y.cashBuiltUp * pxPerDollar;
        out += "<rect x='" + x.toFixed(1) + "' y='" + down.toFixed(1) + "' width='" + bw.toFixed(1) + "' height='" + ch.toFixed(1) + "' fill='" + INK + "' fill-opacity='.5'><title>Cash built up " + fmtB(y.cashBuiltUp) + "</title></rect>";
      }
      out += "<text x='" + (x + bw / 2).toFixed(1) + "' y='" + (H - 6) + "' text-anchor='middle' font-size='9' fill='" + INK + "'>" + esc(y.label) + "</text>";
    });
    out += "</svg>";
    return out;
  }

  /* ================= H5: cohort sources of capex funding, 100% stacked ================= */
  function h5YearShares(companiesByTicker, tickers) {
    var byYear = {};
    tickers.forEach(function (t) {
      var c = companiesByTicker[t]; if (!c) return;
      (c.annual || []).forEach(function (a) {
        var y = h4YearPoint(a);
        var calYear = Number(String(a.periodEnd).slice(0, 4));
        if (!byYear[calYear]) byYear[calYear] = { cfOps: 0, debtNet: 0, convertsNet: 0, equity: 0, partners: 0, cashDrawnDown: 0, n: 0, uses: 0 };
        var row = byYear[calYear];
        SOURCE_KEYS.forEach(function (k) { if (isNum(y.sources[k])) row[k] += Math.max(0, y.sources[k]); });
        row.uses += (y.uses.capex || 0) + (y.uses.buybacks || 0) + (y.uses.dividends || 0) + (y.uses.debtRepaidGross || 0);
        row.n++;
      });
    });
    return Object.keys(byYear).sort().map(function (y) {
      var r = byYear[y], total = SOURCE_KEYS.reduce(function (a, k) { return a + r[k]; }, 0) || 1;
      var shares = {}; SOURCE_KEYS.forEach(function (k) { shares[k] = r[k] / total; });
      return { year: y, shares: shares, n: r.n, uses: r.uses, debtEquityShare: (shares.debtNet + shares.convertsNet + shares.equity) };
    });
  }
  function svgH5(years) {
    var W = 300, H = 150, padL = 8, padR = 8, padT = 8, padB = 18;
    var iw = W - padL - padR, ih = H - padT - padB;
    var n = years.length || 1, bw = (iw / n) * 0.6, gap = (iw / n) * 0.4;
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Cohort sources of capex funding'>";
    years.forEach(function (y, i) {
      var x = padL + gap / 2 + i * (bw + gap), up = padT + ih;
      SOURCE_KEYS.forEach(function (k) {
        var v = y.shares[k]; if (!v) return;
        var h = v * ih;
        out += "<rect x='" + x.toFixed(1) + "' y='" + (up - h).toFixed(1) + "' width='" + bw.toFixed(1) + "' height='" + h.toFixed(1) + "' fill='" + SOURCE_COLOR[k] + "'" +
          (y.hatch ? " fill-opacity='.55'" : "") + "><title>" + esc(SOURCE_LABEL[k]) + " " + (v * 100).toFixed(0) + "% of " + y.year + " (" + y.n + " reporting)" + "</title></rect>";
        up -= h;
      });
      out += "<text x='" + (x + bw / 2).toFixed(1) + "' y='" + (H - 6) + "' text-anchor='middle' font-size='9' fill='" + INK + "'>" + esc(y.hatch ? y.year + " YTD" : y.year) + "</text>";
    });
    out += "</svg>";
    return out;
  }

  /* ================= H6: net debt trend ================= */
  /* net debt to EBITDA above 3.0x for a hyperscaler or 6.0x for a
     neocloud, or interest cover (already carrying capitalized interest
     added back, per leverageOf in build-capex-panel.mjs) below 3.0x,
     takes the accent — no threshold is defined for landlords. */
  var LEVERAGE_THRESHOLD = { hyperscalers: 3.0, neoclouds: 6.0 };
  var INTEREST_COVER_FLOOR = 3.0;
  function h6Series(company) {
    function mapPoint(p) {
      return { end: p.periodEnd, v: p.debt.netDebt, mult: p.debt.netDebtToEbitda,
        interestCoverage: p.interest ? p.interest.interestCoverage : null };
    }
    var qs = sortByEnd((company.quarterly || []).filter(function (p) { return isNum(p.debt && p.debt.netDebt); }));
    if (qs.length >= 3) return qs.map(mapPoint);
    var as = sortByEnd((company.annual || []).filter(function (p) { return isNum(p.debt && p.debt.netDebt); }));
    return as.map(mapPoint);
  }
  function svgH6(series, threshold) {
    var W = 300, H = 120, padL = 40, padR = 8, padT = 10, padB = 16;
    var iw = W - padL - padR, ih = H - padT - padB;
    if (!series.length) return "";
    var vals = series.map(function (p) { return p.v; });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
    if (lo === hi) { lo -= 1; hi += 1; }
    var span = hi - lo; hi += span * 0.1; lo -= span * 0.05;
    var Y = function (v) { return padT + ih - ((v - lo) / (hi - lo)) * ih; };
    var n = series.length;
    var X = function (i) { return padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw); };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Net debt trend'>";
    out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + Y(0).toFixed(1) + "' y2='" + Y(0).toFixed(1) + "' stroke='" + GRID + "' stroke-width='1'/>" +
      "<text x='" + (padL - 5) + "' y='" + (Y(0) + 3).toFixed(1) + "' text-anchor='end' font-size='8' fill='" + INK + "'>0</text>";
    var d = "";
    series.forEach(function (p, i) { d += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.v).toFixed(1) + " "; });
    out += "<path d='" + d.trim() + "' fill='none' stroke='#f5c518' stroke-width='1.8'/>";
    series.forEach(function (p, i) {
      var overLeverage = isNum(p.mult) && isNum(threshold) && p.mult > threshold;
      var underCover = isNum(p.interestCoverage) && p.interestCoverage < INTEREST_COVER_FLOOR;
      var fill = overLeverage || underCover ? "#ff8a80" : "#f5c518";
      out += "<circle cx='" + X(i).toFixed(1) + "' cy='" + Y(p.v).toFixed(1) + "' r='2.2' fill='" + fill + "'><title>" + esc(fmtDate(p.end)) + ": net debt " + fmtB(p.v) +
        (p.mult !== null && p.mult !== undefined ? " (" + fmtX(p.mult) + " net debt to EBITDA)" : "") +
        (p.interestCoverage !== null && p.interestCoverage !== undefined ? "; interest cover " + fmtX(p.interestCoverage) : "") +
        "</title></circle>";
    });
    out += "</svg>";
    return out;
  }

  /* ================= H7: maturity ladders ================= */
  var MATURITY_BUCKETS = [
    ["maturityRemainderOfFiscalYear", "Remainder"], ["maturityNextTwelveMonths", "NTM"],
    ["maturityYearTwo", "Y2"], ["maturityYearThree", "Y3"], ["maturityYearFour", "Y4"],
    ["maturityYearFive", "Y5"], ["maturityAfterYearFive", "After Y5"]
  ];
  function svgH7(point) {
    var buckets = MATURITY_BUCKETS.filter(function (b) { return isNum(point.maturities[b[0]]); });
    if (!buckets.length) return "";
    var W = 300, H = 18 * buckets.length + 14, padL = 58, padR = 44, padT = 6, padB = 8;
    var iw = W - padL - padR;
    var max = Math.max.apply(null, buckets.map(function (b) { return point.maturities[b[0]]; })) || 1;
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Maturity ladder'>";
    buckets.forEach(function (b, i) {
      var v = point.maturities[b[0]];
      var w = Math.max(1, (v / max) * iw);
      var y = padT + i * 18;
      out += "<text x='" + (padL - 6) + "' y='" + (y + 10) + "' text-anchor='end' font-size='9' fill='" + INK + "'>" + esc(b[1]) + "</text>";
      out += "<rect x='" + padL + "' y='" + y + "' width='" + w.toFixed(1) + "' height='12' fill='#f5c518'" +
        (point.hatched ? " fill-opacity='.6'" : "") + "><title>" + esc(b[1]) + ": " + fmtB(v) + "</title></rect>";
      out += "<text x='" + (padL + w + 5).toFixed(1) + "' y='" + (y + 10) + "' font-size='9' fill='" + LINE2 + "'>" + fmtB(v) + "</text>";
    });
    out += "</svg>";
    return out;
  }

  /* ================= H8: off-balance-sheet commitments beside debt ================= */
  var H8_CATS = [
    { key: "grossDebt", label: "Gross debt", color: "#f5c518" },
    { key: "financeLease", label: "Finance leases", color: "#b6bac2" },
    { key: "operatingLease", label: "Operating leases", color: "#6bc9c9" },
    { key: "leasesNotCommenced", label: "Leases not yet commenced", color: "#ff8a80" },
    { key: "commitments", label: "Purchase / contractual commitments", color: "#c99cf2" }
  ];
  /* Three of the four disclosing hyperscalers never tag their
     uncommenced-lease disclosure at all (it sits in the leases note's
     prose, not a fact) — only Meta does, and under a tag for a different
     concept (UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount).
     Blueprint 15.3 requires these hand-keyed with accession, the same
     pattern frontend/data/capex-adjustments.json uses for the second
     capex line. It stays inline here (three rows, hyperscalers only)
     rather than a fetched file until PR H3's ledger absorbs it; asOf is
     checked against the exact point below, so a hand-keyed figure is
     never carried forward onto a later filing it was not read from —
     it would instead fall back to "not tagged" until re-keyed. */
  var UNCOMMENCED_LEASE_ADJUSTMENTS = {
    MSFT: { asOf: "2026-06-30", value: 329100000000, form: "10-K", accession: "0001193125-26-323660",
      note: "Leases not yet commenced (Note 13), commencing fiscal 2027 through fiscal 2033." },
    GOOG: { asOf: "2026-06-30", value: 85200000000, form: "10-Q", accession: "0001652044-26-000071",
      note: "Leases not yet commenced (Note 4); a further ~$5.8B non-cancelable commitment entered June 2026, commencing Q3 2026, is not included." },
    AMZN: { asOf: "2026-06-30", value: 137214000000, form: "10-Q", accession: "0001018724-26-000026",
      note: "Leases not yet commenced, from the commitments table." }
  };
  function h8Row(company, ticker) {
    var p = latestWithField(company, "debt.grossDebt");
    if (!p) return null;
    var uncommenced = p.leases && p.leases.uncommencedLeases;
    var labelIsLease = uncommenced && /lease/i.test(uncommenced.label || "");
    var hasPurchaseObligations = isNum(p.obligations && p.obligations.purchaseObligations);
    var usesUncommencedAsCommitments = !hasPurchaseObligations && !labelIsLease && uncommenced && isNum(uncommenced.value);
    var taggedLease = labelIsLease && isNum(uncommenced.value) ? uncommenced.value : null;
    var handKey = ticker && UNCOMMENCED_LEASE_ADJUSTMENTS[ticker];
    var handKeyApplies = !!(handKey && handKey.asOf === p.periodEnd);
    var leasesNotCommencedHandKeyed = taggedLease === null && handKeyApplies;
    /* Meta's resolved tag for its operating-lease liability is
       OperatingLeaseLiabilityNoncurrent — concepts.mjs's own comment
       calls the fall-through "a floor for filers that never tag a
       total" — so its bar is the non-current portion only ($26.2B),
       $2.4B short of the $28.65B Meta actually owes (blueprint 15.3:
       "2,425 + 26,229 millions"). The bar and its tooltip say so rather
       than presenting the floor as the whole liability. */
    var operatingLeaseTag = p.tags && p.tags["balanceSheet.operatingLeaseLiability"];
    var operatingLeaseIsFloor = operatingLeaseTag === "OperatingLeaseLiabilityNoncurrent";
    return {
      end: p.periodEnd,
      grossDebt: p.debt.grossDebt,
      financeLease: p.leases ? p.leases.financeLeaseLiability : null,
      operatingLease: p.leases ? p.leases.operatingLeaseLiability : null,
      operatingLeaseIsFloor: operatingLeaseIsFloor,
      leasesNotCommenced: taggedLease !== null ? taggedLease : (handKeyApplies ? handKey.value : null),
      leasesNotCommencedHandKeyed: leasesNotCommencedHandKeyed,
      leasesNotCommencedSource: leasesNotCommencedHandKeyed ? (handKey.form + ", accession " + handKey.accession) : null,
      commitments: hasPurchaseObligations ? p.obligations.purchaseObligations :
        (usesUncommencedAsCommitments ? uncommenced.value : null),
      /* the label must follow whichever tag actually supplied the drawn
         number — falling back to uncommenced.label whenever that object
         merely existed (regardless of whether its value was used)
         mislabeled Amazon's ContractualObligation ($650B) and Alphabet's
         LongTermPurchaseCommitmentAmount ($707B) as "Unrecorded
         unconditional purchase obligation", a different concept. */
      commitmentsLabel: usesUncommencedAsCommitments ? uncommenced.label : "Purchase obligation / contractual commitment"
    };
  }
  function svgH8(rows, tickers) {
    var rowH = 20, groupGap = 8;
    var H = rows.length * (H8_CATS.length * rowH + groupGap) + 20;
    var W = 620, padL = 96, padR = 90, padT = 10;
    var iw = W - padL - padR;
    var max = 1;
    rows.forEach(function (r) { H8_CATS.forEach(function (c) { if (isNum(r.row[c.key]) && r.row[c.key] > max) max = r.row[c.key]; }); });
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Off-balance-sheet commitments beside debt, per hyperscaler'>";
    var y = padT;
    rows.forEach(function (r) {
      out += "<text x='4' y='" + (y + (H8_CATS.length * rowH) / 2 + 4) + "' font-size='11' font-weight='600' fill='#e8eaed'>" + esc(NAMES[r.ticker] || r.ticker) + "</text>";
      H8_CATS.forEach(function (c) {
        var v = r.row[c.key];
        var label = c.key === "commitments" ? (r.row.commitmentsLabel || c.label) : c.label;
        var isHandKeyed = c.key === "leasesNotCommenced" && r.row.leasesNotCommencedHandKeyed;
        var isFloor = c.key === "operatingLease" && r.row.operatingLeaseIsFloor;
        if (!isNum(v)) {
          out += "<text x='" + padL + "' y='" + (y + 13) + "' font-size='9' fill='" + INK + "' font-style='italic'>" + esc(label) + ": not tagged</text>";
          y += rowH; return;
        }
        var w = Math.max(1, (v / max) * iw);
        var titleSuffix = isHandKeyed ? " (hand-keyed, " + r.row.leasesNotCommencedSource + ")" :
          (isFloor ? " (floor — non-current portion only, per concepts.mjs's fall-through)" : "");
        var strokeAttr = (isHandKeyed || isFloor) ? " stroke='#e8eaed' stroke-width='1' stroke-dasharray='3 2'" : "";
        /* a "+" on the value text is the only cue visible without a
           hover — the bars themselves never print a category label, so
           the floor caveat must live on the number a reader actually
           sees, not only in the title attribute a mouse has to find. */
        var valueText = isFloor ? fmtB(v) + "+" : fmtB(v);
        out += "<rect x='" + padL + "' y='" + y + "' width='" + w.toFixed(1) + "' height='14' fill='" + c.color + "'" + strokeAttr + "><title>" + esc(NAMES[r.ticker] || r.ticker) + " — " + esc(label) + ": " + fmtB(v) + esc(titleSuffix) + "</title></rect>" +
          "<text x='" + (padL + w + 5).toFixed(1) + "' y='" + (y + 11) + "' font-size='9' fill='" + LINE2 + "'>" + esc(valueText) + "</text>";
        y += rowH;
      });
      y += groupGap;
    });
    out += "</svg>";
    return out;
  }
  var H8_KEY = "<p class='m6-key'>" + H8_CATS.map(function (c) { return "<span><i style='background:" + c.color + "'></i>" + esc(c.label) + "</span>"; }).join("") + "</p>";

  /* ---------- caption templates ----------
     sample() carries the widest values a caption can hold, so every
     one measures under 240 characters however the real figures land. */
  var CAPTIONS = {
    h1: {
      template: function (v) {
        var lead = "The " + v.cohort + " spent " + v.total + " on property and equipment in " + v.quarter + ", " + v.pct + " than a year earlier";
        /* when only one company in the cohort has filed that quarter, "X
           alone spent $Y" restates the total the sentence just gave —
           the caller sets soleFiler so the clause says what is actually
           informative (that one filer is the whole reading), never a
           circular repeat of the same number */
        return v.soleFiler ? lead + "; " + v.top + " is the only one of the group that has filed " + v.quarter + " so far." :
          lead + "; " + v.top + " alone spent " + v.topValue + ".";
      },
      sample: function () {
        return CAPTIONS.h1.template({ cohort: "six neoclouds", total: "$999.9B", quarter: "Q4 2026", pct: "999.9% more",
          top: "Applied Digital", topValue: "$999.9B" });
      }
    },
    h2: {
      template: function (v) {
        return v.company + "'s capex " + v.verb + " operating cash flow by " + v.gap + " over the trailing four quarters (" + v.ratio + " cover).";
      },
      sample: function () { return CAPTIONS.h2.template({ company: "Applied Digital", verb: "exceeded", gap: "$999.9B", ratio: "9.99×" }); }
    },
    h3: {
      template: function (v) {
        var noun = v.total === 1 ? "builder" : "builders";
        return v.n + " of the " + v.total + " " + noun + " (" + v.m + " reporting " + v.quarter + ") spent more than their operating cash flow on capex.";
      },
      sample: function () { return CAPTIONS.h3.template({ n: 6, m: 6, total: 6, quarter: "Q4 2026" }); }
    },
    h4: {
      template: function (v) {
        return v.company + " funded " + v.capex + " of " + v.year + " capex with " + v.cfo + " from operations, " + v.debt +
          " of " + (v.debtLabel || "net debt") + " and " + v.equity + " of equity and preferred; cash " + v.dir + " " + v.cash + ".";
      },
      sample: function () {
        return CAPTIONS.h4.template({ company: "Applied Digital", capex: "$999.9B", year: "FY2026", cfo: "$999.9B", debt: "$999.9B",
          debtLabel: "net debt and converts", equity: "$999.9B", dir: "fell", cash: "$999.9B" });
      }
    },
    h5: {
      /* debtEquityShare (h5YearShares) is each channel's share of the
         SUM OF SOURCES that year — the denominator the 100%-stacked
         chart itself draws — never a share of that year's capex, which
         can be smaller or larger than total sources raised. */
      template: function (v) { return "Debt, converts and equity were " + v.pct + "% of the neoclouds' " + v.year + " funding sources and " + v.pctH + "% of the hyperscalers'."; },
      sample: function () { return CAPTIONS.h5.template({ pct: "100.0", year: "2026", pctH: "100.0" }); }
    },
    h6: {
      template: function (v) {
        return v.company + "'s net debt moved from " + v.start + " to " + v.end + " over " + v.period + "; " + v.n +
          " of the " + v.reporting + " " + v.cohortLabel + " reporting a current debt balance carry net debt.";
      },
      sample: function () { return CAPTIONS.h6.template({ company: "Applied Digital", start: "−$999.9B", end: "$999.9B", period: "Jun 30, 2018 to Jun 30, 2026", n: 6, reporting: 6, cohortLabel: "neoclouds" }); }
    },
    h7: {
      template: function (v) {
        return v.company + " has " + v.nearTerm + " due within two years against " + v.cash + " of cash; " + v.pctAfter5 +
          "% of its principal matures after five years" + (v.asOf || "") + ".";
      },
      sample: function () { return CAPTIONS.h7.template({ company: "Applied Digital", nearTerm: "$999.9B", cash: "$999.9B", pctAfter5: "100.0", asOf: " (as of Dec 31, 2023)" }); }
    },
    h8: {
      template: function (v) { return v.company + "'s " + v.what + " (" + v.leases + ") are " + v.mult + "× its debt (" + v.debt + ")."; },
      sample: function () { return CAPTIONS.h8.template({ company: "Microsoft", what: "uncommenced leases", leases: "$999.9B", mult: "99.9", debt: "$999.9B" }); }
    }
  };

  /* ---------- RTCatalog.register at module load ---------- */
  var ENTRIES = [
    { key: "boCapexSection", label: "Capex and its run-rate", subtitle: "15.1: H1-H3",
      formula: "The cash-flow line each filer tags for property and equipment (PaymentsToAcquirePropertyPlantAndEquipment or its filer-specific alias), the trailing four-quarter run-rate, and its ratio to operating cash flow, revenue and depreciation",
      watch: "Never the capex figure a company quotes on its call — Microsoft and Meta add finance leases, Amazon nets incentives, CoreWeave counts gross PP&E including construction in progress. The bridge from the tagged line to a company's own metric is a later release (blueprint 15.4); this view shows the tagged line only.",
      definition: "How much cash the builders are actually spending on property and equipment, from the line each one tags in its own cash-flow statement, never a figure typed from an earnings call.",
      interpretation: "Read the run-rate for pace and the ratios for who is funding the build from operations versus the balance sheet or the market." },
    { key: "boH1", label: "H1 — Aggregate capex by company, quarterly", subtitle: "stacked columns, cohort toggle",
      formula: "Sum of each company's quarterly tagged capex (plus its hand-keyed second line, where one exists) in the calendar quarter containing its period end; a missing filer is drawn hatched, never zero",
      watch: "Oracle's and Applied Digital's fiscal quarters end in February, May, August and November, one month before the calendar quarter they are stacked in; every total that includes them carries that footnote.",
      definition: "How much the selected cohort spent on property and equipment each calendar quarter, and who drove it.",
      interpretation: "Height is the pace of the build; the mix of colors is who is driving it. A quarter with a hatched sliver is a filer the build script has not yet reached, not a company that spent nothing." },
    { key: "boH2", label: "H2 — Capex against operating cash flow", subtitle: "small multiples, gap shaded",
      formula: "The tagged capex line and NetCashProvidedByUsedInOperatingActivities, same period basis, per company per quarter; the shaded area is the gap between them",
      watch: "A shaded area above the cash-flow line means that quarter's capex was not covered by that quarter's operations; it says nothing about the following quarter.",
      definition: "Whether each company's build is being paid for out of its own operating cash flow, quarter by quarter.",
      interpretation: "A widening gap financed for several consecutive quarters is what shows up as debt, converts or equity raised in the sources-and-uses chart below." },
    { key: "boH3", label: "H3 — Capex intensity ratios", subtitle: "heat table, three switchable ratios",
      formula: "Capex ÷ operating cash flow, capex ÷ revenue, and capex ÷ depreciation and amortization, per company per quarter",
      watch: "Capex to operating cash flow above 1.0 for four consecutive quarters takes a stripe (financed from outside operations); capex to depreciation above 3.0 is marked as growth, not as a quality judgment — a young asset base with low depreciation will show a high ratio even at a steady spending pace.",
      definition: "Three ways to read how heavy the build is relative to the business generating the cash for it.",
      interpretation: "Read the color, not just the number: an accent cell under the operating-cash-flow ratio is a funding question, the same accent under the depreciation ratio is simply a young, fast-growing asset base." },
    { key: "boSourcesSection", label: "Sources and uses of cash", subtitle: "15.2: H4-H5",
      formula: "Sources: operating cash flow, debt raised net of repaid, converts net, equity and preferred issued, JV partner and customer funding, cash drawn down. Uses: capex, buybacks, dividends, debt repaid. Finance-lease additions are shown separately as a non-cash source",
      watch: "Finance-lease additions never pass through the cash-flow statement, so they are drawn as an outlined bar beside the cash sources, not stacked inside them.",
      definition: "Where the cash for a year's build-out actually came from, and where it went.",
      interpretation: "When debt and equity together exceed capex the company raised ahead of spending; when operating cash flow alone exceeds capex, market activity that year was refinancing, not funding the build." },
    { key: "boH4", label: "H4 — Funding mix per company per year", subtitle: "sources above the axis, uses below",
      formula: "Each source and use of 15.2, per company, for its most recent fiscal years, with finance-lease additions as an outlined non-cash bar beside the sources; free cash flow after capex (operating cash flow minus capex) and the funding gap (capex plus buybacks, dividends and debt repaid, minus operating cash flow) are noted below each chart from the same tagged lines",
      watch: "A fiscal year for a June or May filer (Microsoft, Oracle, Applied Digital, IREN) ends mid-calendar-year, labeled by the filer's own fiscal-year name.",
      definition: "One company's cash sources and uses, year by year.",
      interpretation: "A tall lease outline beside a comparatively short capex bar is expansion financed off the cash-flow statement entirely; a positive funding gap is what that year's sources above had to cover." },
    { key: "boH5", label: "H5 — Cohort sources of capex funding", subtitle: "100% stacked columns by calendar year",
      formula: "Each cohort's sources of 15.2, summed across its members by calendar year and shown as a share of the total; the current calendar year is year-to-date and hatched",
      watch: "A sum across companies whose fiscal years do not all end on December 31 mixes fiscal years that overlap the calendar year unevenly; the chart is a directional read on funding mix, not a precise calendar-year total.",
      definition: "How the hyperscalers as a group, and the neoclouds as a group, funded their capex each year.",
      interpretation: "A rising debt-and-equity share across the two cohorts is the market financing more of the build; a rising operating-cash-flow share is the build increasingly paying for itself." },
    { key: "boDebtSection", label: "Debt, leases and obligations", subtitle: "15.3: H6-H8",
      formula: "Gross and net debt, net debt to EBITDA, interest coverage, finance and operating lease liabilities, leases not yet commenced, purchase obligations and the maturity ladder",
      watch: "The site never computes adjusted EBITDA; net debt to EBITDA and interest coverage read 'n/m' whenever trailing operating income is zero or negative. Definitions of 'commitment' differ by filer, so nothing here is summed across companies.",
      definition: "What the builders now owe, on the balance sheet and off it.",
      interpretation: "Read debt, leases and commitments together per company; the shapes differ by filer far more than the totals do." },
    { key: "boH6", label: "H6 — Net debt trend", subtitle: "one line per company, EBITDA multiple on hover",
      formula: "Gross debt minus cash and marketable securities (restricted cash excluded), per company, quarterly where tagged else annually; net debt to EBITDA on hover from trailing four-quarter operating income plus depreciation and amortization",
      watch: "A company below the zero line holds more cash and securities than debt (net cash); net debt to EBITDA reads 'n/m' when trailing operating income is zero or negative, never a computed adjusted-EBITDA figure.",
      definition: "How much each company owes net of what it holds in cash and securities, over time.",
      interpretation: "A line crossing zero is the moment a company stops being a net creditor of the bond market and starts being a net borrower." },
    { key: "boH7", label: "H7 — Maturity ladders", subtitle: "small multiples, horizontal bars by bucket",
      formula: "Principal due by bucket (remainder of fiscal year, next twelve months, year two through five, after year five) from each filer's own tagged maturity schedule",
      watch: "A ladder is hatched when its balance-sheet date predates debt the company issued afterward — read the hatched ladder as stale, not as the company's current maturity profile.",
      definition: "When each company's debt principal comes due.",
      interpretation: "A long near-term bar against a short cash tile is refinancing risk; a bar concentrated after year five is debt raised for a build that has years to prove itself before it must be repaid or rolled." },
    { key: "boH8", label: "H8 — Off-balance-sheet commitments beside debt", subtitle: "grouped bars, hyperscalers only",
      formula: "Gross debt, finance-lease liability, operating-lease liability, leases not yet commenced, and purchase or contractual commitments, each per its own filer definition",
      /* the qualifier that these are undiscounted future payments, not
         debt outstanding today, is stated here (the Caveat, rendered
         second) rather than only in interpretation (rendered last), so a
         reader meets it before the multiple in the chart's caption. */
      watch: "Leases not yet commenced and purchase or contractual commitments are undiscounted future payments over terms up to twenty years, never debt outstanding today. These five bars are also never summed across companies or within a company into one number — each filer defines 'commitment' differently (Amazon's table includes debt and leases; Meta's does not), so the chart draws them side by side only. A bar not tagged for a given filer says so rather than showing zero.",
      definition: "Everything a hyperscaler has promised to pay, whether or not it appears as debt.",
      interpretation: "Read the size next to what it is, not before it: a large uncommenced-lease or commitment bar is a future payment obligation, not a debt balance the company owes today." }
  ];
  if (CAT && typeof CAT.register === "function") CAT.register(ENTRIES);

  /* ---------- small rendering helpers (pure: build a string) ---------- */
  function h3Sub(key, label, small) {
    return "<h3><span class='h-pop' data-metric='" + esc(key) + "' tabindex='0'>" + esc(label) + "</span>" + (small ? "<small>" + esc(small) + "</small>" : "") + "</h3>";
  }
  function emptyState(title, why) {
    return "<div class='m6-empty'><span>" + esc(title) + "</span>" + (why ? "<small>" + esc(why) + "</small>" : "") + "</div>";
  }
  function panel(body) { return "<figure class='m6-panel'>" + body + "</figure>"; }
  function seg(id, options, active) {
    return "<div class='seg bo-seg' role='group' data-seg='" + esc(id) + "'>" + options.map(function (o) {
      return "<button type='button' data-val='" + esc(o[0]) + "' aria-pressed='" + (o[0] === active ? "true" : "false") + "'>" + esc(o[1]) + "</button>";
    }).join("") + "</div>";
  }
  function footNote(tickers) {
    var any = tickers.some(function (t) { return FOOTNOTE_TICKERS[t]; });
    return any ? "<p class='bo-footnote'>† Oracle and Applied Digital quarters end one month before the calendar quarter shown.</p>" : "";
  }
  /* the annual counterpart of footNote, for charts (H5) that aggregate by
     calendar YEAR rather than calendar quarter — blueprint 15.0 requires
     the footnote on every aggregate that includes these two filers, not
     only the quarterly ones. */
  function footNoteAnnual(tickers) {
    var any = tickers.some(function (t) { return FOOTNOTE_TICKERS[t]; });
    return any ? "<p class='bo-footnote'>† Oracle's and Applied Digital's fiscal years end May 31, one month before the calendar year they are grouped into here.</p>" : "";
  }

  /* ---------- section builders (pure) ---------- */
  function buildH1Section(panels, cohort) {
    var tickers = COHORTS[cohort], companiesByTicker = companiesOf(panels, cohort);
    var have = Object.keys(companiesByTicker);
    if (!have.length) return { html: emptyState("No " + COHORT_LABEL[cohort].toLowerCase() + " data yet", "The weekly build has not written this cohort's file, or every filer in it failed to fetch."), captions: [] };
    var stacks = h1Data(companiesByTicker, tickers, 9);
    var captionQuarter = mostCompleteQuarter(stacks.map(function (s) { return s.quarter; }), companiesByTicker, tickers);
    var latest = stacks.filter(function (s) { return s.quarter === captionQuarter; })[0] || last(stacks);
    var captions = [];
    var body = "";
    if (latest && isNum(latest.total)) {
      var priorQ = quarterBefore(latest.quarter, 4);
      var priorStack = calendarQuarterStack(companiesByTicker, tickers, priorQ);
      /* the year-over-year change is only fair over the filers that
         reported BOTH quarters — comparing latest.total (which can be
         missing a filer, e.g. Digital Realty's un-filed Q2 2026) against
         priorStack.total (which has every filer) compares one company
         against two and prints a fabricated swing. */
      var priorByTicker = {};
      priorStack.parts.forEach(function (p) { priorByTicker[p.ticker] = p.value; });
      var commonTotal = 0, priorCommonTotal = 0, commonCount = 0;
      latest.parts.forEach(function (p) {
        if (isNum(p.value) && isNum(priorByTicker[p.ticker])) { commonTotal += p.value; priorCommonTotal += priorByTicker[p.ticker]; commonCount++; }
      });
      var pct = commonCount > 0 && priorCommonTotal !== 0 ? ((commonTotal / priorCommonTotal - 1) * 100) : null;
      var reportingParts = latest.parts.filter(function (p) { return isNum(p.value); });
      var top = reportingParts.slice().sort(function (a, b) { return (b.value || 0) - (a.value || 0); })[0];
      var cap = CAPTIONS.h1.template({
        cohort: COHORT_LABEL[cohort].toLowerCase(), total: fmtB(latest.total), quarter: fmtQ(latest.quarter),
        pct: pct === null ? "an unknown amount more" : (pct >= 0 ? Math.abs(pct).toFixed(1) + "% more" : Math.abs(pct).toFixed(1) + "% less"),
        top: NAMES[top.ticker] || top.ticker, topValue: fmtB(top.value), soleFiler: reportingParts.length === 1
      });
      captions.push(cap);
      body += "<p class='chart-caption'>" + esc(cap) + "</p>";
      if (latest.missing.length) {
        /* a filer absent from this quarter's stack may have filed on time
           and simply not reached the SEC's derived companyfacts feed yet
           (blueprint 15.9's own Digital Realty example) — the copy states
           the feed gap, never "has not filed", which asserts a filing
           failure by a named public company the site cannot verify. */
        var missingNames = latest.missing.map(function (t) { return NAMES[t] || t; });
        var missingClause = missingNames.length === 1
          ? missingNames[0] + "'s " + fmtQ(latest.quarter) + " is not in the SEC companyfacts feed yet"
          : missingNames.join(", ") + "'s " + fmtQ(latest.quarter) + " figures are not in the SEC companyfacts feed yet";
        body += "<p class='bo-footnote'>" + esc(missingClause) +
          "; the year-over-year change above compares only the " + (commonCount === 1 ? "one filer" : commonCount + " filers") +
          " that reported both quarters.</p>";
      }
    }
    body = h3Sub("boH1", "Aggregate capex by company, quarterly") + body;
    body += "<div class='bo-chart-wide'>" + svgH1(stacks, tickers) + "</div>";
    body += "<p class='chart-legend'>" + h1Legend(tickers, companiesByTicker) + "</p>";
    body += footNote(tickers);
    body += "<p class='tile-foot'>Source: SEC EDGAR companyfacts, form and accession on hover; the tagged cash-flow line plus each filer's hand-keyed second line where one exists (IREN, Cipher).</p>";
    return { html: body, captions: captions };
  }

  function buildH2Section(panels, cohort) {
    var tickers = COHORTS[cohort], companiesByTicker = companiesOf(panels, cohort);
    var have = tickers.filter(function (t) { return companiesByTicker[t]; });
    if (!have.length) return { html: emptyState("No " + COHORT_LABEL[cohort].toLowerCase() + " data yet", ""), captions: [] };
    var captions = [];
    var grid = have.map(function (t) {
      var c = companiesByTicker[t];
      var pts = h2CompanyData(c, 9);
      var svg = svgH2(pts);
      if (!svg) return panel(h3Sub("boH2", NAMES[t] || t) + emptyState("No tagged capex or operating cash flow yet", ""));
      var rr = last((c.quarterly || []).filter(function (p) { return p.grain === "quarter"; }));
      var cap = "";
      if (rr && rr.capexRunRate && isNum(rr.capexRunRate.value) && isNum(rr.cashFlow.cfOps)) {
        var trailingCfo = sortByEnd(c.quarterly.filter(function (p) { return p.grain === "quarter"; })).slice(-4).reduce(function (a, p) { return a + (p.cashFlow.cfOps || 0); }, 0);
        var gap = rr.capexRunRate.value - trailingCfo;
        /* a "cover" multiple only means something against positive
           trailing operating cash flow; a company whose trailing four
           quarters net to zero or negative operations reads "n/m",
           never a ratio flipped by a negative denominator */
        var ratio = trailingCfo > 0 ? rr.capexRunRate.value / trailingCfo : "n/m";
        cap = CAPTIONS.h2.template({ company: NAMES[t] || t, verb: gap >= 0 ? "exceeded" : "trailed", gap: fmtB(Math.abs(gap)), ratio: fmtX(ratio) });
        captions.push(cap);
      }
      return panel(h3Sub("boH2", NAMES[t] || t) + "<div class='m6-chart'>" + svg + "</div>" + (cap ? "<figcaption class='m6-caption'>" + esc(cap) + "</figcaption>" : ""));
    }).join("");
    var body = h3Sub("boH2", "Capex against operating cash flow", "small multiples, gap shaded");
    body += "<p class='chart-legend'><span><i style='background:#f5c518'></i>Capex</span><span><i class='dash' style='color:" + LINE2 + "'></i>Operating cash flow</span></p>";
    body += "<div class='m6-grid'>" + grid + "</div>";
    body += "<p class='tile-foot'>Shaded area is the trailing gap between the two lines each quarter; source as H1.</p>";
    return { html: body, captions: captions };
  }

  function buildH3Section(panels, cohort) {
    var tickers = COHORTS[cohort], companiesByTicker = companiesOf(panels, cohort);
    var have = tickers.filter(function (t) { return companiesByTicker[t]; });
    if (!have.length) return { html: emptyState("No " + COHORT_LABEL[cohort].toLowerCase() + " data yet", ""), captions: [] };
    var quarters = quartersOf(companiesByTicker, tickers).slice(-6);
    var captions = [];
    var rows = have.map(function (t) {
      var c = companiesByTicker[t], byQ = pointsByQuarter(c);
      var hotByQuarter = h3HotByQuarter(c);
      var cells = quarters.map(function (q) {
        var p = byQ[q];
        var out = "";
        H3_RATIOS.forEach(function (r) {
          var v = p ? p.ratios[r.key] : null;
          var hot = r.key === "capexToOperatingCashFlow" && !!hotByQuarter[q];
          var cell = h3Cell(v, r, hot);
          out += "<span class='bo-ratio " + cell.cls + "' data-ratio='" + esc(r.key) + "'>" + cell.text + "</span>";
        });
        return "<td>" + out + "</td>";
      }).join("");
      return "<tr><th scope='row'>" + esc(NAMES[t] || t) + "</th>" + cells + "</tr>";
    }).join("");
    var head = "<th scope='col'></th>" + quarters.map(function (q) { return "<th scope='col'>" + esc(fmtQ(q)) + "</th>"; }).join("");
    var latestQ = mostCompleteQuarter(quarters, companiesByTicker, have);
    if (latestQ) {
      var n = 0, m = 0;
      have.forEach(function (t) {
        var p = pointsByQuarter(companiesByTicker[t])[latestQ];
        if (p && isNum(p.ratios.capexToOperatingCashFlow)) { m++; if (h3ExceedsOpsCashFlow(p.ratios.capexToOperatingCashFlow)) n++; }
      });
      if (m) { var cap = CAPTIONS.h3.template({ n: n, m: m, total: tickers.length, quarter: fmtQ(latestQ) }); captions.push(cap);
        var capHtml = "<p class='chart-caption'>" + esc(cap) + "</p>"; }
    }
    var body = h3Sub("boH3", "Capex intensity ratios", "heat table") +
      (typeof capHtml === "string" ? capHtml : "") +
      seg("bo-ratio", [["capexToOperatingCashFlow", "÷ operating cash flow"], ["capexToRevenue", "÷ revenue"], ["capexToDepreciation", "÷ depreciation"]], "capexToOperatingCashFlow") +
      "<div class='bo-heat-wrap'><table class='bo-heat'><thead><tr>" + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
      "<p class='m6-key'><span><i class='bo-cell-hot'></i>Capex &gt; operating cash flow (4+ quarters is a stripe)</span><span><i class='bo-cell-growth'></i>Capex &gt; 3× depreciation — growth, not a quality flag</span></p>" +
      footNote(tickers) +
      "<p class='tile-foot'>Source as H1; ratios computed from the same tagged lines.</p>";
    return { html: body, captions: captions };
  }

  function buildH4Section(panels, cohort) {
    var tickers = COHORTS[cohort], companiesByTicker = companiesOf(panels, cohort);
    var have = tickers.filter(function (t) { return companiesByTicker[t]; });
    if (!have.length) return { html: emptyState("No " + COHORT_LABEL[cohort].toLowerCase() + " data yet", ""), captions: [] };
    var captions = [];
    var grid = have.map(function (t) {
      var c = companiesByTicker[t];
      var years = sortByEnd(c.annual || []).slice(-4).map(h4YearPoint);
      if (!years.length) return panel(h3Sub("boH4", NAMES[t] || t) + emptyState("No annual filing parsed yet", ""));
      var latestY = last(years);
      var cap = "";
      if (isNum(latestY.uses.capex) && isNum(latestY.sources.cfOps)) {
        /* sumOrNull, not a raw "+" — debtNet and convertsNet are each
           null when every underlying tag is null, and null + null is 0
           in JavaScript, which would render "$0.00B of net debt" for a
           filer with nothing tagged at all (module header: a null field
           is a gap, never a zero) */
        var debtEquity = sumOrNull(latestY.sources.debtNet, latestY.sources.convertsNet);
        /* the "net debt" slot must not silently absorb a company's
           converts — IREN's FY2026 channel is almost entirely
           ProceedsFromConvertibleDebt, not bonds or bank debt (blueprint
           15.2 keeps them as separate channels), so the label names
           converts whenever they are the larger (or only) part of the
           combined figure. */
        var debtNetOnly = latestY.sources.debtNet, convertsOnly = latestY.sources.convertsNet;
        var convertsDominate = isNum(convertsOnly) && convertsOnly > 0 && (!isNum(debtNetOnly) || debtNetOnly <= 0 || convertsOnly >= debtNetOnly);
        var debtLabel = convertsDominate ? (isNum(debtNetOnly) && debtNetOnly > 0 ? "net debt and converts" : "converts") : "net debt";
        var equityAndPreferred = latestY.sources.equity;
        /* latestY.sources.cashDrawnDown > 0 means cash fell that year (a
           source); latestY.cashBuiltUp > 0 means cash rose (a use) — the
           two are mutually exclusive by construction in h4YearPoint, and
           both are 0 (not null) when the drawdown itself is unresolved,
           so cashKnown gates the caption instead of guessing a direction
           from two zeros. */
        var cashFellAmt = latestY.sources.cashDrawnDown;
        var cashRoseAmt = latestY.cashBuiltUp;
        var cashKnown = (isNum(cashFellAmt) && cashFellAmt > 0) || (isNum(cashRoseAmt) && cashRoseAmt > 0);
        if (cashKnown) {
          var dir = cashFellAmt > 0 ? "fell" : "rose";
          var cashAmt = cashFellAmt > 0 ? cashFellAmt : cashRoseAmt;
          cap = CAPTIONS.h4.template({
            company: NAMES[t] || t, capex: fmtB(latestY.uses.capex), year: latestY.label, cfo: fmtB(latestY.sources.cfOps),
            debt: fmtB(debtEquity), debtLabel: debtLabel, equity: fmtB(equityAndPreferred), dir: dir, cash: fmtB(cashAmt)
          });
          captions.push(cap);
        }
      }
      /* free cash flow after capex and the funding gap (blueprint 15.1's
         own metric table) are already resolved in the panel from the
         same tagged lines this chart draws — they simply were not shown
         anywhere on the page. No new data, just surfacing what
         build-capex-panel.mjs already computed. */
      var fcfLine = "";
      if (isNum(latestY.freeCashFlowAfterCapex) || isNum(latestY.fundingGap)) {
        var fcfParts = [];
        if (isNum(latestY.freeCashFlowAfterCapex)) fcfParts.push("free cash flow after capex " + fmtB(latestY.freeCashFlowAfterCapex));
        if (isNum(latestY.fundingGap)) fcfParts.push("funding gap " + fmtB(latestY.fundingGap));
        fcfLine = "<p class='bo-footnote'>" + esc(latestY.label) + ": " + esc(fcfParts.join("; ")) + ".</p>";
      }
      return panel(h3Sub("boH4", NAMES[t] || t, latestY.label) + "<div class='m6-chart'>" + svgH4(years) + "</div>" +
        (cap ? "<figcaption class='m6-caption'>" + esc(cap) + "</figcaption>" : "") + fcfLine);
    }).join("");
    var legend = "<p class='chart-legend'>" + Object.keys(SOURCE_LABEL).map(function (k) {
      return "<span><i style='background:" + SOURCE_COLOR[k] + "'></i>" + esc(SOURCE_LABEL[k]) + "</span>";
    }).join("") + "<span><i class='outline'></i>Finance-lease additions (non-cash)</span></p>" +
      "<p class='chart-legend'><span>Uses (below the line): capex, buybacks, dividends, debt repaid, cash drawn down</span></p>";
    var body = h3Sub("boH4", "Funding mix per company per year") + legend + "<div class='m6-grid'>" + grid + "</div>" +
      "<p class='tile-foot'>Source as H1; sources and uses per company's own cash-flow statement and financing notes.</p>";
    return { html: body, captions: captions };
  }

  function buildH5Section(panels) {
    var hs = h5YearShares(companiesOf(panels, "hyperscalers"), COHORTS.hyperscalers);
    var nc = h5YearShares(companiesOf(panels, "neoclouds"), COHORTS.neoclouds);
    var nowYear = new Date().getUTCFullYear();
    hs.forEach(function (y) { if (Number(y.year) === nowYear) y.hatch = true; });
    nc.forEach(function (y) { if (Number(y.year) === nowYear) y.hatch = true; });
    var captions = [];
    var commonYear = null;
    for (var i = hs.length - 1; i >= 0; i--) {
      var match = nc.filter(function (y) { return y.year === hs[i].year && !y.hatch; })[0];
      if (!hs[i].hatch && match) { commonYear = { hy: hs[i], nc: match }; break; }
    }
    var cap = "";
    if (commonYear) {
      cap = CAPTIONS.h5.template({ pct: (commonYear.nc.debtEquityShare * 100).toFixed(1), year: commonYear.hy.year, pctH: (commonYear.hy.debtEquityShare * 100).toFixed(1) });
      captions.push(cap);
    }
    var legend = "<p class='chart-legend'>" + Object.keys(SOURCE_LABEL).map(function (k) {
      return "<span><i style='background:" + SOURCE_COLOR[k] + "'></i>" + esc(SOURCE_LABEL[k]) + "</span>";
    }).join("") + "</p>";
    var body = h3Sub("boH5", "Cohort sources of capex funding", "100% stacked, by calendar year") +
      (cap ? "<p class='chart-caption'>" + esc(cap) + "</p>" : "") + legend +
      "<div class='bo-grid-2'>" +
      "<figure class='m6-panel'>" + h3Sub("boH5", "Hyperscalers") + "<div class='m6-chart'>" + (hs.length ? svgH5(hs) : "") + "</div>" + (!hs.length ? emptyState("No annual data yet", "") : "") + "</figure>" +
      "<figure class='m6-panel'>" + h3Sub("boH5", "Neoclouds") + "<div class='m6-chart'>" + (nc.length ? svgH5(nc) : "") + "</div>" + (!nc.length ? emptyState("No annual data yet", "") : "") + "</figure>" +
      "</div>" +
      footNoteAnnual(COHORTS.hyperscalers.concat(COHORTS.neoclouds)) +
      "<p class='tile-foot'>Each bar sums the cohort's members reporting that calendar year (n on hover); the current year is year-to-date and hatched. Source as H1.</p>";
    return { html: body, captions: captions };
  }

  function buildH6Section(panels, cohort) {
    var tickers = COHORTS[cohort], companiesByTicker = companiesOf(panels, cohort);
    var have = tickers.filter(function (t) { return companiesByTicker[t]; });
    if (!have.length) return { html: emptyState("No " + COHORT_LABEL[cohort].toLowerCase() + " data yet", ""), captions: [] };
    var captions = [];
    var netPositive = 0, reporting = 0, staleTickers = [];
    have.forEach(function (t) {
      var c = companiesByTicker[t];
      var p = latestWithField(c, "debt.netDebt");
      var mostRecent = last(sortByEnd((c.quarterly || []).concat(c.annual || [])));
      /* a net-debt instant more than ~14 months older than this filer's
         own newest reported period is not "now": Applied Digital's only
         resolved net-debt instant on file is 2022-05-31 (its recent
         periods all carry a null gross-debt tag), and counting that
         stale point toward "carries net debt today" scored it as net
         cash instead of excluding it. */
      var current = p && mostRecent && daysBetween(p.periodEnd, mostRecent.periodEnd) <= 425;
      if (current) { reporting++; if (p.debt.netDebt > 0) netPositive++; } else { staleTickers.push(t); }
    });
    var grid = have.map(function (t) {
      var c = companiesByTicker[t];
      var series = h6Series(c);
      if (series.length < 2) return panel(h3Sub("boH6", NAMES[t] || t) + emptyState("Not enough dated debt instants yet", ""));
      var first = series[0], lastP = last(series);
      var cap = CAPTIONS.h6.template({ company: NAMES[t] || t, start: fmtB(first.v), end: fmtB(lastP.v),
        period: fmtDate(first.end) + " to " + fmtDate(lastP.end), n: netPositive,
        reporting: reporting, cohortLabel: COHORT_LABEL[cohort].toLowerCase() });
      captions.push(cap);
      return panel(h3Sub("boH6", NAMES[t] || t) + "<div class='m6-chart'>" + svgH6(series, LEVERAGE_THRESHOLD[cohort]) + "</div><figcaption class='m6-caption'>" + esc(cap) + "</figcaption>");
    }).join("");
    var staleNote = staleTickers.length ? "<p class='bo-footnote'>" + esc(staleTickers.map(function (t) { return NAMES[t] || t; }).join(", ")) +
      (staleTickers.length === 1 ? " has" : " have") + " no debt balance tagged within the last 14 months and " +
      (staleTickers.length === 1 ? "is" : "are") + " excluded from the net-debt count above.</p>" : "";
    var body = h3Sub("boH6", "Net debt trend") + "<div class='m6-grid'>" + grid + "</div>" + staleNote +
      "<p class='tile-foot'>Net debt = gross debt − cash − marketable securities, restricted cash excluded; net debt to EBITDA on hover, “n/m” where trailing operating income is zero or negative.</p>";
    return { html: body, captions: captions };
  }

  function buildH7Section(panels, cohort) {
    var tickers = COHORTS[cohort], companiesByTicker = companiesOf(panels, cohort);
    var have = tickers.filter(function (t) { return companiesByTicker[t]; });
    if (!have.length) return { html: emptyState("No " + COHORT_LABEL[cohort].toLowerCase() + " data yet", ""), captions: [] };
    var captions = [];
    var grid = have.map(function (t) {
      var c = companiesByTicker[t];
      var p = latestWithLadder(c);
      if (!p) {
        var anyPoint = latestWithField(c, "debt.grossDebt");
        return panel(h3Sub("boH7", NAMES[t] || t) + emptyState("No tagged maturity schedule yet", anyPoint && anyPoint.dataLimitation ? anyPoint.dataLimitation : ""));
      }
      /* hatched when the ladder's own balance-sheet date predates the
         filer's own newest reported period — not the cohort's max year,
         which never caught GOOG or AMZN because their newest gross-debt
         point (with no ladder) was itself always the current year, so
         "pointYear < maxYear" could never fire for the two filers the
         blueprint names. A company whose ladder IS tagged at its newest
         period (MSFT, and Meta's partial ladder) is never hatched by
         this rule. */
      var mostRecent = last(sortByEnd((c.quarterly || []).concat(c.annual || [])));
      var hatched = !!(mostRecent && p.periodEnd !== mostRecent.periodEnd);
      var point = { maturities: p.maturities, hatched: hatched };
      var svg = svgH7(point);
      var nearTerm = (p.maturities.maturityRemainderOfFiscalYear || 0) + (p.maturities.maturityNextTwelveMonths || 0) + (p.maturities.maturityYearTwo || 0);
      var afterFive = p.maturities.maturityAfterYearFive;
      /* the tagged buckets rarely sum to the company's own gross debt —
         Meta's five tagged buckets total $10.25B against $84B of gross
         debt because its after-year-five bucket is hand-keyed per the
         blueprint and not in this panel — so every ladder states which
         buckets it carries and the share of gross debt they cover,
         rather than drawing a partial ladder as though it were whole. */
      var taggedBuckets = MATURITY_BUCKETS.filter(function (b) { return isNum(p.maturities[b[0]]); });
      var taggedSum = taggedBuckets.reduce(function (a, b) { return a + p.maturities[b[0]]; }, 0);
      var coveragePct = isNum(p.debt.grossDebt) && p.debt.grossDebt > 0 ? (taggedSum / p.debt.grossDebt) * 100 : null;
      var coverageNote = "";
      if (coveragePct !== null && coveragePct < 98) {
        coverageNote = "<p class='bo-footnote'>Tagged buckets shown here (" + esc(taggedBuckets.map(function (b) { return b[1]; }).join(", ")) +
          ") total " + fmtB(taggedSum) + ", " + coveragePct.toFixed(0) + "% of " + esc(NAMES[t] || t) + "'s " + fmtB(p.debt.grossDebt) +
          " gross debt; the rest (often the after-year-five bucket) is not tagged here.</p>";
      }
      var cap = "";
      if (isNum(p.debt.grossDebt) && isNum(afterFive)) {
        cap = CAPTIONS.h7.template({ company: NAMES[t] || t, nearTerm: fmtB(nearTerm), cash: fmtB(p.cash ? p.cash.cash : null),
          pctAfter5: ((afterFive / p.debt.grossDebt) * 100).toFixed(1), asOf: point.hatched ? " (as of " + fmtDate(p.periodEnd) + ")" : "" });
        captions.push(cap);
      }
      return panel(h3Sub("boH7", NAMES[t] || t, point.hatched ? "as of " + fmtDate(p.periodEnd) + " — predates later issuance" : "as of " + fmtDate(p.periodEnd)) +
        "<div class='m6-chart'>" + svg + "</div>" + (cap ? "<figcaption class='m6-caption'>" + esc(cap) + "</figcaption>" : "") + coverageNote);
    }).join("");
    var body = h3Sub("boH7", "Maturity ladders") + "<div class='m6-grid'>" + grid + "</div>" +
      "<p class='tile-foot'>Bars hatched where the balance-sheet date predates debt issued afterward in the cohort. Source as H1; buckets are each filer's own tagged fiscal-year schedule.</p>";
    return { html: body, captions: captions };
  }

  function buildH8Section(panels) {
    var tickers = COHORTS.hyperscalers, companiesByTicker = companiesOf(panels, "hyperscalers");
    var have = tickers.filter(function (t) { return companiesByTicker[t]; });
    if (!have.length) return { html: emptyState("No hyperscaler data yet", ""), captions: [] };
    var captions = [];
    var capRows = [];
    var rows = have.map(function (t) { return { ticker: t, row: h8Row(companiesByTicker[t], t) || {} }; });
    rows.forEach(function (r) {
      if (isNum(r.row.leasesNotCommenced) && isNum(r.row.grossDebt)) {
        var cap = CAPTIONS.h8.template({ company: NAMES[r.ticker] || r.ticker, what: "uncommenced leases", leases: fmtB(r.row.leasesNotCommenced),
          mult: (r.row.leasesNotCommenced / r.row.grossDebt).toFixed(1), debt: fmtB(r.row.grossDebt) });
        captions.push(cap);
        capRows.push({ cap: cap, value: r.row.leasesNotCommenced });
      }
    });
    /* the single headline caption names the LARGEST disclosing filer's
       uncommenced leases, not whichever filer happens to come first in
       cohort order (which, before the hand-keyed rows above, was always
       whichever filer's figure happened to carry a tag — Meta's $279B,
       the smallest of the four once Microsoft's $329.1B is included). */
    capRows.sort(function (a, b) { return b.value - a.value; });
    var headlineCap = capRows.length ? capRows[0].cap : null;
    var body = h3Sub("boH8", "Off-balance-sheet commitments beside debt", "hyperscalers only") +
      (headlineCap ? "<p class='chart-caption'>" + esc(headlineCap) + "</p>" : "") +
      "<div class='bo-chart-wide'>" + svgH8(rows, tickers) + "</div>" + H8_KEY +
      "<p class='tile-foot'>Never summed across companies or into one figure — each filer defines a commitment differently. Leases not yet commenced and purchase/contractual commitments are undiscounted future payments, not debt; a hand-keyed uncommenced-lease figure (Microsoft, Alphabet, Amazon) shows its filing and accession on hover, and a dashed \"+\" bar (Meta's operating leases) is a floor — the filer's current-portion tag only, not its whole liability. Source as H6-H7.</p>";
    return { html: body, captions: captions };
  }


  /* ---------- top-level page build (pure) ---------- */
  function sectionHead(id, title, blurb, howTo, metricKey) {
    /* every section <h2> gets the id its section's aria-labelledby names
       (they resolved to nothing before), and the three section-level
       catalog entries (boCapexSection, boSourcesSection, boDebtSection)
       are wrapped in the same .h-pop span the chart headings use, so
       they are reachable instead of registered-but-dead. */
    var heading = metricKey
      ? "<span class='h-pop' data-metric='" + esc(metricKey) + "' tabindex='0'>" + esc(title) + "</span>"
      : esc(title);
    return "<div class='section-head'><h2 id='" + esc(id) + "'>" + heading + "</h2><p class='section-blurb'>" + esc(blurb) + "</p>" +
      "<details class='how-to-read'><summary>How to read this</summary><p>" + howTo + "</p></details></div>";
  }
  function buildHtml(panels, state) {
    if (!panels) return "<p class='chart-empty'><span>Loading the build-out monitor…</span></p>";
    var cohort = state && state.cohort || "hyperscalers";
    var cohortToggle = seg("cohort", [["hyperscalers", "Hyperscalers"], ["neoclouds", "Neoclouds"], ["landlords", "Landlords"]], cohort);
    var h1 = buildH1Section(panels, cohort), h2 = buildH2Section(panels, cohort), h3 = buildH3Section(panels, cohort);
    var h4 = buildH4Section(panels, cohort), h5 = buildH5Section(panels);
    var h6 = buildH6Section(panels, cohort), h7 = buildH7Section(panels, cohort), h8 = buildH8Section(panels);

    var out = "";
    out += "<section class='panel-card fsa-section' aria-labelledby='bo-h-intro'>" +
      sectionHead("bo-h-intro", "Build-out monitor",
        "How much the five hyperscalers, six neoclouds and (behind the toggle) two data-center landlords spend on their build-out, where the cash comes from, and what they now owe on and off the balance sheet.",
        "Every figure is the cash-flow line or balance-sheet tag a filer itself reports to the SEC, or a hand-keyed line carrying its own accession, never a number typed from an earnings call. Microsoft and IREN's fiscal quarters end in March, June, September and December and line up with the calendar without adjustment; Oracle's and Applied Digital's end one month earlier and are footnoted wherever a chart adds them into a calendar-quarter total. Landlords (Equinix, Digital Realty) are off by default.") +
      "<div class='chart-controls'>" + cohortToggle + "</div>" +
      "</section>";

    out += "<section class='panel-card fsa-section' aria-labelledby='bo-h-capex' id='bo-capex'>" +
      sectionHead("bo-h-capex", "Capex and its run-rate",
        "Cash spent on property and equipment each quarter, the trailing four-quarter run-rate, and the ratios that say whether the build is being paid for out of operations.",
        "Capex is the cash-flow line a filer tags, never the figure quoted on a call. Run-rate sums the trailing four quarters; it is never the latest quarter times four. Capex over operating cash flow above 1.0 for four consecutive quarters takes a stripe below; capex over depreciation above 3.0 marks a young, fast-growing asset base, not a quality judgment.",
        "boCapexSection") +
      h1.html + h2.html + h3.html +
      "</section>";

    out += "<section class='panel-card fsa-section' aria-labelledby='bo-h-sources' id='bo-sources'>" +
      sectionHead("bo-h-sources", "Sources and uses of cash",
        "Where the money for the build came from each year, and where it went.",
        "Sources are operating cash flow, debt raised net of repaid, converts, equity and preferred, JV partner and customer funding, and cash drawn down; uses are capex, buybacks, dividends and debt repaid. Finance-lease additions never pass through the cash-flow statement, so they are drawn as a separate outlined bar.",
        "boSourcesSection") +
      h4.html + h5.html +
      "</section>";

    out += "<section class='panel-card fsa-section' aria-labelledby='bo-h-debt' id='bo-debt'>" +
      sectionHead("bo-h-debt", "Debt, leases and obligations",
        "What the builders owe on the balance sheet and off it: gross and net debt, leverage, interest cover, leases, and the maturity ladder.",
        "Net debt to EBITDA above 3.0× for a hyperscaler or 6.0× for a neocloud takes the accent; interest cover below 3.0× is a stripe, with capitalized interest added back. Purchase obligations and leases not yet commenced are drawn per filer and never summed across companies, because each filer defines a commitment differently.",
        "boDebtSection") +
      h6.html + h7.html + h8.html +
      "</section>";

    return out;
  }

  /* ---------- fetching (the only async part) ---------- */
  /* `groups` lets the first paint skip the landlords file (off by
     default, blueprint 15.0) — defaults to all three so existing callers
     (the offline test) see the same shape as before. */
  function fetchPanels(fetchImpl, base, groups) {
    var f = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!f) return Promise.reject(new Error("fetch is not available"));
    var prefix = base || "data/capex/";
    var list = groups || ["hyperscalers", "neoclouds", "landlords"];
    function one(group) {
      return f(prefix + group + ".json").then(function (r) {
        if (!r || (typeof r.ok === "boolean" && !r.ok)) throw new Error(group + ": " + (r && r.status));
        return r.json();
      });
    }
    return Promise.all(list.map(one)).then(function (docs) {
      var out = {};
      list.forEach(function (g, i) { out[g] = docs[i]; });
      return out;
    });
  }

  /* ---------- DOM mount (the only part that touches document) ---------- */
  var STATE = { panels: null, error: null, pending: null, cohort: "hyperscalers", landlordsPending: null };

  /* the landlords cohort is off by default (blueprint 15.0); its 675KB
     file is fetched only the first time someone actually opens that
     toggle, not on every first paint of the view. */
  function ensureLandlords() {
    if (!STATE.panels || STATE.panels.landlords || STATE.landlordsPending) return;
    STATE.landlordsPending = fetchPanels(undefined, undefined, ["landlords"])
      .then(function (p) { STATE.panels.landlords = p.landlords; })
      .catch(function () { STATE.panels.landlords = { companies: {} }; })
      .then(function () { STATE.landlordsPending = null; mount(); });
  }

  function mount() {
    var host = document.getElementById("buildout-root");
    if (!host) return;
    if (STATE.error) {
      host.innerHTML = "<section class='panel-card fsa-section'><div class='chart-empty'><span>The build-out monitor could not load its data (" +
        esc(STATE.error.message || String(STATE.error)) + ").</span><button type='button' class='refresh-btn' id='bo-retry'>Try again</button></div></section>";
      var retry = document.getElementById("bo-retry");
      if (retry) retry.addEventListener("click", function () { STATE.error = null; render(); });
      return;
    }
    if (!STATE.panels) { host.innerHTML = "<section class='panel-card fsa-section'><p class='hint' role='status'>Loading the build-out monitor…</p></section>"; return; }
    host.innerHTML = buildHtml(STATE.panels, STATE);
    bindEvents(host);
    if (window.RTTerms && typeof window.RTTerms.wrap === "function") {
      try { window.RTTerms.wrap(document.getElementById("buildout-view"), { perSection: "section" }); } catch (e) { /* never take the page down */ }
    }
  }
  function bindEvents(host) {
    var seg = host.querySelector("[data-seg='cohort']");
    if (seg) {
      seg.querySelectorAll("button").forEach(function (b) {
        b.addEventListener("click", function () {
          STATE.cohort = b.getAttribute("data-val");
          if (STATE.cohort === "landlords") ensureLandlords();
          mount();
        });
      });
    }
    var ratioSeg = host.querySelector("[data-seg='bo-ratio']");
    if (ratioSeg) {
      ratioSeg.querySelectorAll("button").forEach(function (b) {
        b.addEventListener("click", function () {
          ratioSeg.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
          var key = b.getAttribute("data-val");
          host.querySelectorAll(".bo-heat .bo-ratio").forEach(function (cell) { cell.hidden = cell.getAttribute("data-ratio") !== key; });
        });
      });
      /* default view: only the active ratio's cells show */
      var activeKey = "capexToOperatingCashFlow";
      host.querySelectorAll(".bo-heat .bo-ratio").forEach(function (cell) { cell.hidden = cell.getAttribute("data-ratio") !== activeKey; });
    }
  }
  function render() {
    if (STATE.panels || STATE.error) { mount(); return; }
    if (STATE.pending) return;
    mount();
    STATE.pending = fetchPanels(undefined, undefined, ["hyperscalers", "neoclouds"]).then(function (panels) { STATE.panels = panels; })
      .catch(function (e) { STATE.error = e; })
      .then(function () { STATE.pending = null; mount(); });
  }

  window.RTBuildout = {
    render: render,
    CAPTIONS: CAPTIONS,
    _internal: {
      calendarQuarterStack: calendarQuarterStack, h1Data: h1Data, companiesOf: companiesOf, quartersOf: quartersOf,
      quarterBefore: quarterBefore, buildHtml: buildHtml, fetchPanels: fetchPanels, latestWithField: latestWithField,
      latestWithLadder: latestWithLadder, h8Row: h8Row, h5YearShares: h5YearShares, h4YearPoint: h4YearPoint,
      COHORTS: COHORTS, NAMES: NAMES
    }
  };
})();
