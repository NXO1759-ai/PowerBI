/* Strategy Analysis — renderer.
   Reads the precomputed panel, computes with lib/strategy.js, and reuses
   the metric-card and popup patterns from the Statement Analysis page. */
(function () {
  "use strict";
  var S = window.RTStrategy;
  var PANEL = window.STRATEGY_PANEL, FIELDS = window.PANEL_FIELDS;
  var MAP = window.INDUSTRY_MAP || {};
  if (!S || !PANEL) throw new Error("strategy.js or the panel failed to load");

  var get = S.makeReader(FIELDS);
  var INDEX = Array.isArray(window.COMPANY_INDEX) ? window.COMPANY_INDEX : [];
  var isNum = S.isNum;

  /* Companies grouped by industry, once. */
  var BY_INDUSTRY = {};
  Object.keys(PANEL).forEach(function (t) {
    var c = PANEL[t];
    var entry = { ticker: t, name: c.name, industry: c.industry,
                  sector: c.sector, years: c.years };
    (BY_INDUSTRY[c.industry] = BY_INDUSTRY[c.industry] || []).push(entry);
  });

  var state = { ticker: "NVDA", industry: null, view: "industry" };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function money(v) {
    if (!isNum(v)) return "—";
    var neg = v < 0, a = Math.abs(v), s;
    if (a >= 1e12) s = (a / 1e12).toFixed(2) + "T";
    else if (a >= 1e9) s = (a / 1e9).toFixed(1) + "B";
    else if (a >= 1e6) s = (a / 1e6).toFixed(0) + "M";
    else s = (a / 1e3).toFixed(0) + "K";
    return (neg ? "−$" : "$") + s;
  }
  function pct(v, dp) { return isNum(v) ? (v * 100).toFixed(dp === undefined ? 1 : dp) + "%" : "—"; }
  function pp(v) { return isNum(v) ? (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + " pp" : "—"; }
  function num(v, dp) { return isNum(v) ? v.toFixed(dp === undefined ? 0 : dp) : "—"; }

  /* ---------- definitions on hover, same contract as the statements page ---------- */
  var DEFS = {
    cr4: { label: "CR4", formula: "Combined revenue share of the four largest firms",
      definition: "How much of the industry's revenue the top four companies account for. A long-standing measure of how few hands the industry sits in.",
      interpretation: "Rising CR4 over time means consolidation. The course reads it by geography and across decades — US car makers fell from 98% in 1969 to 58% by 2024, which is a structural story, not a data artefact.",
      watch: "Computed over listed peers only, so private and foreign competitors are missing and the true figure is lower." },
    hhi: { label: "HHI", formula: "Sum of squared percentage market shares",
      definition: "Concentration weighted by size, so one dominant firm scores far higher than several evenly matched rivals holding the same combined share.",
      interpretation: "Merger guidelines read below 1,500 as unconcentrated, 1,500–2,500 moderate, above 2,500 highly concentrated.",
      watch: "An extension — HHI appears nowhere in the course pack, which uses top-N shares. Also an upper bound, since it is computed on listed peers." },
    roic: { label: "Return on invested capital", formula: "EBIT ÷ (average invested capital − excess cash)",
      definition: "What the industry earns on the capital tied up in competing. EBIT keeps capital structure and tax out of it; excess cash comes out because idle cash is not capital the business needs.",
      interpretation: "Placed against Porter's distribution of US industries: median 14.3%, upper quartile 18.6%, top decile 25.3%. Placement is context, not a grade.",
      watch: "Excess cash assumes operating cash of 2% of revenue. For financial firms the whole notion of invested capital differs, so bank and insurer figures are not comparable with industrials." },
    poolCapture: { label: "Pool capture", formula: "Profit share ÷ revenue share",
      definition: "Whether a firm takes a bigger slice of the industry's profit than of its revenue.",
      interpretation: "Above 1 means capturing more value per dollar sold than rivals. Ford earned nearly half its profit from financing on under a fifth of its revenue — the pattern this number is built to catch.",
      watch: "Undefined when the industry's total operating profit is near zero or negative." },
    marginSpread: { label: "Margin spread", formula: "75th percentile margin − 25th percentile margin",
      definition: "How far apart the better and worse performers in an industry sit.",
      interpretation: "A wide spread says firm choices matter more than industry membership. A narrow one says structure dominates and everyone earns much alike.",
      watch: "Sensitive to small peer groups — with four firms the quartiles are barely meaningful." },
    shareEffect: { label: "Share effect", formula: "Firm revenue CAGR − industry revenue CAGR",
      definition: "The part of growth that came from taking share rather than from the industry expanding.",
      interpretation: "Positive means outgrowing peers. A firm growing 8% in an industry growing 8% has gained nothing competitively.",
      watch: "Share of the covered peer group, not of the true served market." },
    persistence: { label: "Persistence", formula: "Years above the industry median ÷ years observed",
      definition: "How often the company sat above its industry's median return across the whole window.",
      interpretation: "Strategy is about durable position. Ahead in 15 of 19 years is a different claim from managing it three times.",
      watch: "Being above a weak median is not the same as earning well." }
  };
  var pop = $("metric-pop"), popFor = null;
  function showPop(el, key) {
    var m = DEFS[key];
    if (!m) return;
    popFor = el;
    pop.innerHTML = "<h4>" + esc(m.label) + "</h4>" +
      "<p class='pop-formula'>" + esc(m.formula) + "</p>" +
      "<p>" + esc(m.definition) + "</p>" +
      "<p><span class='pop-tag'>How to read it</span>" + esc(m.interpretation) + "</p>" +
      "<p class='pop-watch'><span class='pop-tag'>Watch for</span>" + esc(m.watch) + "</p>";
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

  function card(metricKey, label, value, note, flag) {
    return "<button type='button' class='mcard'" +
      (metricKey ? " data-metric='" + esc(metricKey) + "'" : "") + ">" +
      "<span class='m-label'><span>" + esc(label) + "</span></span>" +
      "<span class='m-value" + (value === "—" ? " na" : "") + "'>" + esc(value) + "</span>" +
      (note ? "<span class='m-gloss'>" + esc(note) + "</span>" : "") +
      (flag ? "<span class='m-flag warn'>" + esc(flag) + "</span>" : "") +
      "</button>";
  }

  /* ---------- SVG helpers ---------- */
  var NS = "http://www.w3.org/2000/svg";
  function el(n, a) {
    var e = document.createElementNS(NS, n);
    for (var k in a) e.setAttribute(k, a[k]);
    return e;
  }
  var INK = "#8b8f98", GRID = "rgba(255,255,255,.08)", GOLD = "#f5c518",
      BAR = "#6b6f78", POS = "#5ecb8f", NEG = "#ff8a80";

  /* ---------- industry data ---------- */
  function industryData(industry) {
    var members = BY_INDUSTRY[industry] || [];
    var yearSet = {};
    members.forEach(function (m) {
      Object.keys(m.years).forEach(function (y) { yearSet[Number(y)] = 1; });
    });
    var years = Object.keys(yearSet).map(Number).sort(function (a, b) { return a - b; })
      /* The final panel year is often a stub: only companies with early
         fiscal year ends have reported it, so an industry total built on
         it would understate the industry rather than describe it. */
      .filter(function (y) { return y >= 2008 && y <= 2025; });
    return { members: members, years: years,
             series: S.industrySeries(get, members, years) };
  }

  /* ---------- 1. structure ---------- */
  function renderStructure(ind, data) {
    var latest = data.series[data.series.length - 1];
    var first = data.series[0];
    if (!latest) { $("structure-cards").innerHTML = ""; return; }
    var c = latest.concentration;
    var revCagr = (first && latest && latest.year > first.year)
      ? S.cagr(first.totalRevenue, latest.totalRevenue, latest.year - first.year) : null;
    var crDelta = (first && first.concentration && c)
      ? c.cr4 - first.concentration.cr4 : null;

    $("structure-cards").innerHTML =
      card(null, "Firms covered", String(latest.firms),
        "Large listed US companies in this industry. Private and foreign rivals are outside the panel.") +
      card("cr4", "CR4", num(c.cr4, 0) + "%",
        isNum(crDelta) ? (crDelta >= 0 ? "Up " : "Down ") + Math.abs(crDelta).toFixed(0) +
          " points since " + first.year + " — " + (crDelta >= 0 ? "consolidating" : "fragmenting")
          : "Top four firms' combined revenue share") +
      card("hhi", "HHI", num(c.hhi, 0), c.band, "extension, not from the course") +
      card(null, "Industry revenue", money(latest.totalRevenue),
        isNum(revCagr) ? pct(revCagr) + " a year since " + first.year : "") +
      card(null, "Industry margin", pct(latest.industryMargin),
        "Aggregate operating income over aggregate revenue") +
      card("marginSpread", "Margin spread", pp(latest.marginSpread),
        isNum(latest.marginSpread) && latest.marginSpread > 0.10
          ? "Wide — firm choices matter more than industry membership here"
          : "Narrow — structure dominates, firms earn much alike");

    var caution = S.inflationCaution(data.years);
    var disp = S.dispersionTrend(data.series);
    var dispText = "";
    if (disp && isNum(disp.medianChange) && isNum(disp.spreadChange)) {
      dispText = " Between " + disp.fromYear + " and " + disp.toYear +
        " the median operating margin moved " + pp(disp.medianChange) +
        " while the gap between better and worse performers moved " +
        pp(disp.spreadChange) + ". Level and spread are two separate findings: a whole " +
        "distribution can slide down without compressing, which is what competitive " +
        "convergence looks like.";
    }
    /* What the margin actually covers, said plainly. An aggregate built on
       four of five members is a different claim from one built on all five. */
    var cov = "";
    if (latest.poolFirms < latest.firms) {
      cov += " The margin and profit pool cover " + latest.poolFirms + " of the " +
        latest.firms + " firms — " + pct(latest.profitCoverage, 0) + " of industry revenue. " +
        "The rest do not report revenue and profit on a comparable basis";
      cov += latest.implausibleFirms && latest.implausibleFirms.length
        ? ", and " + latest.implausibleFirms.map(esc).join(", ") +
          " report a profit larger than the revenue line this pull reads, which means the " +
          "revenue is partial rather than the margin extraordinary."
        : ".";
    }
    if (latest.syntheticProfitFirms) {
      cov += " Operating profit is rebuilt from pre-tax income for " +
        latest.syntheticProfitFirms + " of the " + latest.firms +
        ", which no longer tag an operating income line at all.";
    }
    $("structure-note").innerHTML =
      "<strong>Concentration here is an upper bound.</strong> It is computed over the " +
      latest.firms + " large listed companies this panel covers, so private firms, " +
      "foreign entrants and smaller rivals — all of which shape rivalry — are missing. " +
      "Read the direction of travel rather than the level." + cov + dispText +
      (caution ? "<div class='caution'>" + esc(caution.note) + "</div>" : "");
  }

  /* ---------- 2. returns vs Porter's distribution ---------- */
  function industryRoicSeries(members, years) {
    return years.map(function (y) {
      var vals = [];
      members.forEach(function (m) {
        var row = m.years[y], prior = m.years[y - 1];
        if (!row) return;
        var p = S.toPeriod(get, row, y);
        var pp2 = prior ? S.toPeriod(get, prior, y - 1) : null;
        var r = S.porterRoic(p, pp2);
        if (isNum(r) && Math.abs(r) < 3) vals.push(r);
      });
      return { year: y, median: S.median(vals), n: vals.length };
    }).filter(function (d) { return isNum(d.median); });
  }

  function renderRoic(ind, data) {
    var series = industryRoicSeries(data.members, data.years);
    var box = $("roic-chart");
    box.innerHTML = "";
    if (series.length < 2) { $("roic-caption").textContent = "Not enough history."; return; }
    var W = Math.max(320, box.clientWidth || 760), H = 250;
    var padL = 52, padR = 92, padT = 16, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    var B = S.PORTER_ROIC_BANDS;
    var roll = S.rollingAverage(series, "median", 5);
    var vals = series.map(function (d) { return d.median; })
      .concat(roll.map(function (r) { return r.value; })).filter(isNum);
    var lo = Math.min(0, Math.min.apply(null, vals), B.p10);
    var hi = Math.max(Math.max.apply(null, vals), B.p90) * 1.08;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "presentation" });
    var Y = function (v) { return padT + ih * (1 - (v - lo) / (hi - lo)); };
    var X = function (i) { return padL + (series.length === 1 ? iw / 2 : i / (series.length - 1) * iw); };

    /* Porter's percentile bands as reference lines — placement, not scoring. */
    [["p90", B.p90, "90th"], ["p75", B.p75, "75th"], ["median", B.median, "median"],
     ["p25", B.p25, "25th"], ["p10", B.p10, "10th"]].forEach(function (b) {
      var y = Y(b[1]);
      svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: y, y2: y,
        stroke: b[0] === "median" ? "rgba(245,197,24,.35)" : GRID,
        "stroke-width": 1, "stroke-dasharray": b[0] === "median" ? "4 3" : "2 4" }));
      var t = el("text", { x: W - padR + 6, y: y + 3, "font-size": "9.5", fill: INK });
      t.textContent = b[2] + " " + (b[1] * 100).toFixed(1) + "%";
      svg.appendChild(t);
    });
    var zero = Y(0);
    if (zero < padT + ih) {
      svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: zero, y2: zero,
        stroke: "rgba(255,255,255,.2)", "stroke-width": 1 }));
    }
    /* Annual sits behind, thin and grey: the cycle stays visible rather
       than being smoothed out of sight. The rolling average is the line
       to read, because structure is a multi-year property and Porter
       names "confusing cyclical or transient changes with true structural
       changes" as a pitfall. */
    var annual = series.map(function (d, i) {
      return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(d.median).toFixed(1);
    }).join(" ");
    svg.appendChild(el("path", { d: annual, fill: "none", stroke: "#6b6f78",
      "stroke-width": 1.2, "stroke-linejoin": "round" }));
    var rollPts = roll.filter(function (r) { return isNum(r.value); });
    if (rollPts.length > 1) {
      var rollPath = rollPts.map(function (r, i) {
        var idx = series.findIndex(function (d) { return d.year === r.year; });
        return (i ? "L" : "M") + X(idx).toFixed(1) + " " + Y(r.value).toFixed(1);
      }).join(" ");
      svg.appendChild(el("path", { d: rollPath, fill: "none", stroke: GOLD,
        "stroke-width": 2.2, "stroke-linejoin": "round" }));
    }
    var lg1 = el("text", { x: padL + 2, y: padT - 4, "font-size": "9", fill: GOLD });
    lg1.textContent = "5-year average";
    svg.appendChild(lg1);
    var lg2 = el("text", { x: padL + 78, y: padT - 4, "font-size": "9", fill: "#6b6f78" });
    lg2.textContent = "annual";
    svg.appendChild(lg2);
    var step = Math.max(1, Math.ceil(series.length / 8));
    series.forEach(function (d, i) {
      if (i % step) return;
      var t = el("text", { x: X(i), y: padT + ih + 14, "text-anchor": "middle",
        "font-size": "9", fill: INK });
      t.textContent = String(d.year);
      svg.appendChild(t);
    });
    var yl = el("text", { x: padL - 8, y: Y(hi) + 10, "text-anchor": "end",
      "font-size": "9.5", fill: INK });
    yl.textContent = pct(hi, 0);
    svg.appendChild(yl);
    box.appendChild(svg);

    var lastRoll = rollPts.length ? rollPts[rollPts.length - 1] : null;
    var headline = lastRoll ? lastRoll.value : series[series.length - 1].median;
    var place = S.placeAgainstPorter(headline);
    var nb = S.porterNeighbours(headline);
    var mk = S.MCKINSEY_ROIC_BAND;
    var comparable = "";
    if (nb && nb.exact) {
      comparable = " That is the level Porter recorded for " +
        esc(nb.exact[0].toLowerCase()) + " (" + pct(nb.exact[1]) + ").";
    } else if (nb && nb.above && nb.below) {
      comparable = " That places it between " + esc(nb.below[0].toLowerCase()) +
        " (" + pct(nb.below[1]) + ") and " + esc(nb.above[0].toLowerCase()) +
        " (" + pct(nb.above[1]) + ") on Porter's own list.";
    } else if (nb && nb.above) {
      comparable = " That is below every industry on Porter's list, the lowest of which " +
        "was " + esc(nb.above[0].toLowerCase()) + " at " + pct(nb.above[1]) + ".";
    } else if (nb && nb.below) {
      comparable = " That is above every industry on Porter's list, the highest of which " +
        "was " + esc(nb.below[0].toLowerCase()) + " at " + pct(nb.below[1]) + ".";
    }
    $("roic-caption").innerHTML =
      "<strong>" + esc(ind) + " sits " + esc(place.phrase) +
      "</strong> of Porter's distribution — a five-year average of " + pct(headline) +
      " to " + (lastRoll ? lastRoll.year : series[series.length - 1].year) +
      ", against a US industry median of " + pct(B.median) + " (1992–2006, Compustat)." +
      comparable +
      " The five-year line is the one to read: structure is a multi-year property, and " +
      "reading a single year confuses the cycle with the structure. " +
      "A separate long-run reference puts US nonfinancial returns at " +
      pct(mk.low, 0) + "–" + pct(mk.high, 0) + " across 1963–2008; the two differ because " +
      "one is pre-tax EBIT on invested capital net of excess cash and the other an " +
      "after-tax return across a wider universe, so both are shown rather than either " +
      "being treated as the benchmark.";
  }

  /* ---------- 3. profit pool ---------- */
  function renderPool(ind, data) {
    var latest = data.series[data.series.length - 1];
    var box = $("pool-chart");
    box.innerHTML = "";
    if (!latest || !latest.pool.length) return;
    var pool = latest.pool.filter(function (p) { return isNum(p.revenueShare); });
    var W = Math.max(320, box.clientWidth || 760), H = 230;
    var padL = 46, padR = 14, padT = 16, padB = 34;
    var iw = W - padL - padR, ih = H - padT - padB;
    var margins = pool.map(function (p) { return p.operatingMargin; }).filter(isNum);
    var hi = Math.max(0.05, Math.max.apply(null, margins) * 1.12);
    var lo = Math.min(0, Math.min.apply(null, margins) * 1.12);
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "presentation" });
    var Y = function (v) { return padT + ih * (1 - (v - lo) / (hi - lo)); };

    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var v = lo + (hi - lo) * f, y = Y(v);
      svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: y, y2: y,
        stroke: GRID, "stroke-width": 1 }));
      var t = el("text", { x: padL - 6, y: y + 3, "text-anchor": "end",
        "font-size": "9", fill: INK });
      t.textContent = pct(v, 0);
      svg.appendChild(t);
    });
    /* Width is revenue share, height is margin, so area is profit. */
    var x = padL;
    pool.forEach(function (p) {
      var w = p.revenueShare * iw;
      var m = isNum(p.operatingMargin) ? p.operatingMargin : 0;
      var y0 = Y(0), y1 = Y(m);
      var isYou = p.ticker === state.ticker;
      svg.appendChild(el("rect", {
        x: x + 0.5, y: Math.min(y0, y1), width: Math.max(1, w - 1),
        height: Math.max(1, Math.abs(y1 - y0)),
        fill: isYou ? GOLD : (m < 0 ? NEG : BAR),
        opacity: isYou ? 0.95 : 0.72
      }));
      if (w > 34) {
        var t = el("text", { x: x + w / 2, y: padT + ih + 13, "text-anchor": "middle",
          "font-size": "9", fill: isYou ? GOLD : INK });
        t.textContent = p.ticker;
        svg.appendChild(t);
      }
      x += w;
    });
    var xl = el("text", { x: padL, y: padT + ih + 27, "font-size": "9", fill: INK });
    xl.textContent = "share of industry revenue →   (width × height = profit)";
    svg.appendChild(xl);
    box.appendChild(svg);

    var rows = pool.slice(0, 12).map(function (p) {
      var you = p.ticker === state.ticker;
      var cls = you ? " class='pool-you'" : "";
      return "<tr><td" + cls + ">" + esc(p.ticker) + "</td>" +
        "<td class='num" + (you ? " pool-you" : "") + "'>" + money(p.revenue) + "</td>" +
        "<td class='num" + (you ? " pool-you" : "") + "'>" + pct(p.revenueShare) + "</td>" +
        "<td class='num" + (you ? " pool-you" : "") + "'>" + pct(p.profitShare) + "</td>" +
        "<td class='num" + (you ? " pool-you" : "") + "'>" + pct(p.operatingMargin) + "</td>" +
        "<td class='num" + (you ? " pool-you" : "") + "'>" +
          (isNum(p.poolCaptureRatio) ? p.poolCaptureRatio.toFixed(2) + "×" : "—") + "</td></tr>";
    }).join("");
    $("t-pool").innerHTML =
      "<thead><tr><th scope='col'>" + latest.year + "</th>" +
      "<th scope='col' class='num'>Revenue</th>" +
      "<th scope='col' class='num'>Rev share</th>" +
      "<th scope='col' class='num'>Profit share</th>" +
      "<th scope='col' class='num'>Margin</th>" +
      "<th scope='col' class='num' data-metric='poolCapture'>Pool capture</th></tr></thead>" +
      "<tbody>" + rows + "</tbody>";
  }

  /* ---------- 4. position ---------- */
  function renderPosition(ind, data) {
    var me = PANEL[state.ticker];
    var host = $("position-cards");
    if (!me || me.industry !== ind) {
      host.innerHTML = "";
      $("position-chart").innerHTML = "";
      $("position-caption").textContent =
        state.ticker + " is not in this industry, so only the industry view above applies.";
      return;
    }
    var roicSeries = industryRoicSeries(data.members, data.years);
    var medianByYear = {};
    roicSeries.forEach(function (d) { medianByYear[d.year] = d.median; });
    var mine = {};
    data.years.forEach(function (y) {
      var row = me.years[y], prior = me.years[y - 1];
      if (!row) return;
      var r = S.porterRoic(S.toPeriod(get, row, y),
        prior ? S.toPeriod(get, prior, y - 1) : null);
      if (isNum(r) && Math.abs(r) < 3) mine[y] = r;
    });
    var pers = S.persistence(mine, medianByYear);
    var latestYear = data.series[data.series.length - 1].year;
    var peerRoics = data.members.map(function (m) {
      var row = m.years[latestYear], prior = m.years[latestYear - 1];
      if (!row) return null;
      return S.porterRoic(S.toPeriod(get, row, latestYear),
        prior ? S.toPeriod(get, prior, latestYear - 1) : null);
    }).filter(function (v) { return isNum(v) && Math.abs(v) < 3; });
    var rank = S.rankAmong(mine[latestYear], peerRoics);
    var pool = data.series[data.series.length - 1].pool
      .filter(function (p) { return p.ticker === state.ticker; })[0];

    host.innerHTML =
      card("roic", "Return on capital", pct(mine[latestYear]),
        rank ? "Rank " + rank.rank + " of " + rank.of + " in " + latestYear +
          " · " + (rank.vsMedian >= 0 ? "+" : "−") +
          Math.abs(rank.vsMedian * 100).toFixed(1) + " pp vs median" : "") +
      card("persistence", "Persistence", pers ? pers.yearsAbove + " / " + pers.years + " yrs" : "—",
        pers ? pers.verdict + " · longest run " + pers.longestStreak + " years" : "") +
      card("poolCapture", "Pool capture",
        pool && isNum(pool.poolCaptureRatio) ? pool.poolCaptureRatio.toFixed(2) + "×" : "—",
        pool && isNum(pool.poolCaptureRatio)
          ? (pool.poolCaptureRatio > 1
              ? "Takes a bigger share of profit than of revenue"
              : "Takes a smaller share of profit than of revenue") : "") +
      card(null, "Revenue share", pool ? pct(pool.revenueShare) : "—",
        "Of the covered peer group");

    /* firm against industry median, over the window */
    var box = $("position-chart");
    box.innerHTML = "";
    var pts = data.years.map(function (y) {
      return { year: y, me: mine[y], med: medianByYear[y] };
    }).filter(function (d) { return isNum(d.me) && isNum(d.med); });
    if (pts.length < 2) { $("position-caption").textContent = ""; return; }
    var W = Math.max(320, box.clientWidth || 760), H = 210;
    var padL = 48, padR = 60, padT = 14, padB = 28;
    var iw = W - padL - padR, ih = H - padT - padB;
    var all = pts.map(function (d) { return d.me; }).concat(pts.map(function (d) { return d.med; }));
    var lo = Math.min(0, Math.min.apply(null, all)), hi = Math.max.apply(null, all) * 1.1;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "presentation" });
    var Y = function (v) { return padT + ih * (1 - (v - lo) / (hi - lo)); };
    var X = function (i) { return padL + i / (pts.length - 1) * iw; };
    svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: Y(0), y2: Y(0),
      stroke: "rgba(255,255,255,.18)", "stroke-width": 1 }));
    [["med", GRID, "2 3"], ["me", GOLD, null]].forEach(function (k) {
      var d = pts.map(function (p, i) {
        return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(k[0] === "me" ? p.me : p.med).toFixed(1);
      }).join(" ");
      svg.appendChild(el("path", { d: d, fill: "none",
        stroke: k[0] === "me" ? GOLD : "#8b8f98",
        "stroke-width": k[0] === "me" ? 2 : 1.4,
        "stroke-dasharray": k[2] || "none" }));
    });
    var l1 = el("text", { x: W - padR + 6, y: Y(pts[pts.length - 1].me) + 3,
      "font-size": "9.5", fill: GOLD });
    l1.textContent = state.ticker;
    svg.appendChild(l1);
    var l2 = el("text", { x: W - padR + 6, y: Y(pts[pts.length - 1].med) + 3,
      "font-size": "9.5", fill: INK });
    l2.textContent = "median";
    svg.appendChild(l2);
    var step2 = Math.max(1, Math.ceil(pts.length / 8));
    pts.forEach(function (p, i) {
      if (i % step2) return;
      var t = el("text", { x: X(i), y: padT + ih + 13, "text-anchor": "middle",
        "font-size": "9", fill: INK });
      t.textContent = String(p.year);
      svg.appendChild(t);
    });
    box.appendChild(svg);
    renderDupont(ind, data);
    $("position-caption").innerHTML = pers
      ? "<strong>" + esc(state.ticker) + " was above the industry median in " +
        pers.yearsAbove + " of " + pers.years + " years</strong> observed, longest unbroken run " +
        pers.longestStreak + ". A single good year is not an advantage; this is the test of whether one held."
      : "";
  }

  /* One reference per year, computed once and reused. */
  var PANEL_REF = {};
  function panelRef(year) {
    if (!(year in PANEL_REF)) PANEL_REF[year] = S.panelReference(PANEL, get, year);
    return PANEL_REF[year];
  }

  function renderDupont(ind, data) {
    var me = PANEL[state.ticker];
    var host = $("dupont-cards");
    if (!me) { host.innerHTML = ""; $("dupont-caption").textContent = ""; return; }
    /* Walk back to the newest year the decomposition actually resolves.
       A company's most recent panel year is often a partial one: the
       balance sheet is filed before the full-year income statement, so
       Amazon's 2026 row carries assets and no revenue. Showing four dashes
       there would report absence where a complete 2025 exists.
       The comparison set is the whole panel's nonfinancial companies, not
       this industry — with two or three peers the median is the company
       itself, which reported Costco as unremarkable on asset turns. */
    var d = null, latestYear = null;
    var mine = Object.keys(me.years).map(Number).sort(function (a, b) { return b - a; });
    for (var yi = 0; yi < mine.length && yi < 5; yi++) {
      var y = mine[yi];
      var cand = S.dupontThreeFactor(S.toPeriod(get, me.years[y], y),
        me.years[y - 1] ? S.toPeriod(get, me.years[y - 1], y - 1) : null, panelRef(y));
      if (isNum(cand.pretaxRoe)) { latestYear = y; d = cand; break; }
    }
    if (latestYear === null) {
      /* Nothing resolved in five years — say why rather than showing a row
         of dashes with no explanation. */
      host.innerHTML = "";
      $("dupont-caption").innerHTML = S.isFinancial(me)
        ? "Not shown for banks, insurers and property trusts. This split divides profit "
          + "by sales and sales by assets, and neither ratio describes a business whose "
          + "assets are its inventory."
        : "Not available — " + esc(state.ticker) + " does not report revenue and asset "
          + "figures this split can use on a comparable basis.";
      return;
    }
    host.innerHTML =
      card(null, "Pre-tax margin", pct(d.pretaxMargin), "Profit before tax per dollar of sales") +
      card(null, "Asset turnover", isNum(d.assetTurnover) ? d.assetTurnover.toFixed(2) + "×" : "—",
        "Sales per dollar of average assets") +
      card(null, "Equity multiplier", isNum(d.equityMultiplier) ? d.equityMultiplier.toFixed(2) + "×" : "—",
        "Average assets per dollar of average equity") +
      card(null, "Pre-tax ROE", pct(d.pretaxRoe), "The three multiplied together");
    if (S.isFinancial(me)) {
      $("dupont-caption").innerHTML =
        "In " + latestYear + ", " + esc(state.ticker) + "'s pre-tax return of " +
        pct(d.pretaxRoe) + " came from a " + pct(d.pretaxMargin) + " margin on " +
        (isNum(d.assetTurnover) ? d.assetTurnover.toFixed(2) : "—") + "× asset turns, geared " +
        (isNum(d.equityMultiplier) ? d.equityMultiplier.toFixed(2) : "—") + "×. " +
        "<strong>The margin-versus-turnover read is withheld here.</strong> For a bank, " +
        "insurer or property trust the asset base is the business rather than the means " +
        "of producing sales, so a low turnover says nothing about operating shape — and " +
        "the comparison set is the panel's nonfinancial companies, which are not its peers.";
      return;
    }
    $("dupont-caption").innerHTML = d.driver
      ? "In " + latestYear + ", " + esc(state.ticker) + "'s pre-tax return of " +
        pct(d.pretaxRoe) + " came from a " + pct(d.pretaxMargin) + " margin on " +
        (isNum(d.assetTurnover) ? d.assetTurnover.toFixed(2) : "—") +
        "× asset turns, geared " + (isNum(d.equityMultiplier) ? d.equityMultiplier.toFixed(2) : "—") +
        "×. <strong>" + esc(d.driver) + ".</strong>"
      : "";
  }

  /* ---------- 5. growth ---------- */
  function renderGrowth(ind, data) {
    var me = PANEL[state.ticker];
    var host = $("growth-cards");
    if (!me || me.industry !== ind) { host.innerHTML = ""; $("growth-chart").innerHTML = ""; $("growth-caption").textContent = ""; return; }
    /* Compare like with like: the decomposition is measured only over
       years the industry series actually covers. Thin early years are
       dropped from the industry aggregate, and measuring the firm from a
       start year the industry no longer has would compare a 17-year firm
       CAGR against a 12-year industry one. */
    var industryYears = {};
    data.series.forEach(function (d) { industryYears[d.year] = 1; });
    var firmSeries = data.years.filter(function (y) { return industryYears[y]; })
      .map(function (y) {
        var row = me.years[y];
        return row ? { year: y, revenue: get(row, "revenue") } : null;
      }).filter(function (d) { return d && isNum(d.revenue); });
    var decomp = S.growthDecomposition(firmSeries, data.series);
    var periods = S.companyPeriods(get, me).filter(function (p) {
      return p.fiscalYear >= 2008 && p.fiscalYear <= 2025;
    });
    var gq = S.growthQuality(periods);

    host.innerHTML =
      card(null, "Revenue CAGR", decomp ? pct(decomp.firmCagr) : "—",
        decomp ? "Over " + decomp.years + " years" : "") +
      card(null, "Industry CAGR", decomp ? pct(decomp.industryCagr) : "—",
        "Same window, covered peers") +
      card("shareEffect", "Share effect", decomp ? pp(decomp.shareEffect) : "—",
        decomp && decomp.outgrewIndustry === true ? "Grew faster than the industry — gained share"
          : decomp && decomp.outgrewIndustry === false ? "Grew slower than the industry — lost share" : "") +
      card(null, "Margin trajectory", gq ? pp(gq.marginChange) : "—",
        gq ? gq.verdict : "",
        gq && gq.verdict && gq.verdict.indexOf("trap") !== -1 ? "growth trap" : null);

    $("growth-chart").innerHTML = "";
    $("growth-caption").innerHTML = gq
      ? "Over " + gq.years + " years revenue compounded at " + pct(gq.salesCagr) +
        " and operating profit at " + pct(gq.earningsCagr) + ", against asset growth of " +
        pct(gq.assetCagr) + ". <strong>" + esc(gq.verdict) + ".</strong> " +
        "Earnings outpacing sales, and sales outpacing assets, is what a decade of healthy " +
        "organic growth looks like in the statements; the inverse is revenue bought at the " +
        "cost of the returns that made it worth growing."
      : "";
  }

  /* ---------- 6. five forces ---------- */
  function renderForces(ind, data) {
    var latest = data.series[data.series.length - 1];
    if (!latest) return;
    var c = latest.concentration;
    var forces = [
      { name: "Rivalry among existing competitors",
        metric: num(c.cr4, 0) + "% CR4",
        evidence: "Top four hold " + num(c.cr4, 0) + "% of covered revenue across " +
          latest.firms + " firms, and the industry's margin spread is " + pp(latest.marginSpread) +
          ". A wide spread alongside low concentration usually means firms are competing on " +
          "different things rather than purely on price.",
        gap: "exit barriers, capacity increments, and whether rivals read each other's signals — none are visible in filings." },
      { name: "Threat of new entrants",
        metric: pct(latest.capexIntensity) + " capex intensity",
        evidence: "Capital spending runs " + pct(latest.capexIntensity) + " of revenue and R&D " +
          pct(latest.rndIntensity) + ". Both raise what an entrant must commit before earning anything, " +
          "which is one of the seven barriers the course names.",
        gap: "brand strength, distribution access, regulatory licences, and expected retaliation." },
      { name: "Bargaining power of buyers",
        metric: pct(latest.grossMarginMedian) + " median gross margin",
        evidence: "The median firm keeps " + pct(latest.grossMarginMedian) +
          " of each revenue dollar after direct costs. Sustained high gross margins are hard to hold " +
          "when buyers are concentrated or switching is cheap.",
        gap: "buyer concentration, switching costs, and how large a share of the buyer's own cost this product is — the course asks for all three as percentages." },
      { name: "Bargaining power of suppliers",
        metric: pct(isNum(latest.grossMarginMedian) ? 1 - latest.grossMarginMedian : null) + " of revenue to inputs",
        evidence: "Direct costs take " + pct(isNum(latest.grossMarginMedian) ? 1 - latest.grossMarginMedian : null) +
          " of revenue. A rising share over time is consistent with suppliers capturing more of the value, " +
          "though it can equally be mix or scale.",
        gap: "supplier concentration, differentiation of inputs, and credible forward-integration threats." },
      { name: "Threat of substitutes",
        metric: "—",
        evidence: "Financial statements cannot see outside the industry's own boundary, so nothing here " +
          "evidences substitution. What the panel can show is the consequence: if substitutes are " +
          "biting, industry revenue growth decays while margins compress.",
        gap: "the price-performance trade-off offered by alternatives, and buyers' cost of switching to them. This force needs outside evidence entirely." }
    ];
    $("forces-body").innerHTML = "<div class='force-list'>" + forces.map(function (f) {
      return "<div class='force'><h3>" + esc(f.name) + "</h3>" +
        "<p class='force-evidence'><span class='force-metric'>" + esc(f.metric) + "</span>" +
        esc(f.evidence) + "</p>" +
        "<p class='force-gap'>" + esc(f.gap) + "</p></div>";
    }).join("") + "</div>";
  }

  /* ---------- 7. sustainability ---------- */
  function renderSustain() {
    var p = Number($("p-imitate").value), n = Number($("n-activities").value);
    $("p-out").textContent = p.toFixed(2);
    $("n-out").textContent = String(n);
    var joint = Math.pow(p, n);
    $("sustain-result").innerHTML =
      "<span class='big'>" + (joint * 100).toFixed(1) + "%</span>" +
      "A rival with a " + (p * 100).toFixed(0) + "% chance of matching any single activity has a " +
      "<strong>" + (joint * 100).toFixed(1) + "%</strong> chance of matching all " + n +
      " together. That is why positions built on interlocking systems outlast positions built " +
      "on one thing: the odds compound against the imitator, and the whole matters more than " +
      "any individual part.";
  }

  /* ---------- orchestration ---------- */
  /* =====================================================================
     COMPANY VIEW

     Everything below is computed from the filings panel and the company's
     peer set. Nothing is estimated, and nothing that a filing does not
     contain is filled in with a plausible-looking number — where an answer
     is not available the block says so and the evidence register at the
     foot of the view records what would actually settle it.
     ===================================================================== */

  /* Metrics measured across the peer set. Each takes a period and returns
     one number, so cohortStats can run any of them the same way and the
     count behind every comparison is known. */
  var M = {
    ebitMargin: function (p) { return S.div(S.ebitOf(p, false), p.incomeStatement.revenue); },
    grossMargin: function (p) {
      var is = p.incomeStatement;
      var gp = isNum(is.grossProfit) ? is.grossProfit
        : (isNum(is.cogs) ? is.revenue - is.cogs : null);
      return S.div(gp, is.revenue);
    },
    netMargin: function (p) { return S.div(p.incomeStatement.netIncome, p.incomeStatement.revenue); },
    opexIntensity: function (p) {
      var is = p.incomeStatement;
      if (!isNum(is.sellingGeneralAdmin) && !isNum(is.researchDevelopment)) return null;
      return S.div((is.sellingGeneralAdmin || 0) + (is.researchDevelopment || 0), is.revenue);
    },
    rndIntensity: function (p) { return S.div(p.incomeStatement.researchDevelopment, p.incomeStatement.revenue); },
    capitalTurns: function (p, prior) {
      var ic = S.investedCapital(p), ip = prior ? S.investedCapital(prior) : null;
      var avg = isNum(ic) ? (isNum(ip) ? (ic + ip) / 2 : ic) : null;
      return (isNum(avg) && avg > 0) ? S.div(p.incomeStatement.revenue, avg) : null;
    },
    assetTurns: function (p, prior) {
      var a = p.balanceSheet.totalAssets, pa = prior ? prior.balanceSheet.totalAssets : null;
      var avg = isNum(a) ? (isNum(pa) ? (a + pa) / 2 : a) : null;
      return S.div(p.incomeStatement.revenue, avg);
    },
    roe: function (p, prior) {
      var eq = function (b) {
        return isNum(b.equityIncludingNci) ? b.equityIncludingNci
          : (isNum(b.equity) ? b.equity + (isNum(b.minorityInterest) ? b.minorityInterest : 0) : null);
      };
      var e = eq(p.balanceSheet), pe = prior ? eq(prior.balanceSheet) : null;
      var avg = isNum(e) ? (isNum(pe) ? (e + pe) / 2 : e) : null;
      if (!isNum(avg) || avg <= 0) return null;
      return S.div(p.incomeStatement.netIncomeIncludingNci !== null
        ? p.incomeStatement.netIncomeIncludingNci : p.incomeStatement.netIncome, avg);
    },
    roic: function (p, prior, c) { return S.porterRoic(p, prior, undefined, c ? S.isFinancial(c) : false); },
    inventoryTurns: function (p, prior) {
      var i = p.balanceSheet.inventory, pi = prior ? prior.balanceSheet.inventory : null;
      var avg = isNum(i) ? (isNum(pi) ? (i + pi) / 2 : i) : null;
      return (isNum(avg) && avg > 0) ? S.div(p.incomeStatement.cogs, avg) : null;
    }
  };

  /* Cohort statistics are recomputed whenever the company or year changes
     and cached, because each pass walks every member of the industry. */
  var COHORT_CACHE = {};
  function cohortOf(members, year, key) {
    var id = key + "|" + year + "|" + members.length + "|" + (members[0] && members[0].ticker);
    if (!(id in COHORT_CACHE)) COHORT_CACHE[id] = S.cohortStats(get, members, year, M[key]);
    return COHORT_CACHE[id];
  }

  /* A company's standing on one metric, stated with the count behind it. */
  function standing(value, cohort) {
    if (!isNum(value) || !cohort || !cohort.enoughForMedian) return null;
    var vals = cohort.values.indexOf(value) === -1
      ? cohort.values.concat([value]) : cohort.values;
    var r = S.rankAmong(value, vals);
    if (!r) return null;
    return { rank: r.rank, of: r.of, percentile: r.percentile,
             median: cohort.median, vsMedian: value - cohort.median, n: cohort.n };
  }

  function rankNote(st) {
    return st ? ("rank " + st.rank + " of " + st.of) : null;
  }

  /* A horizontal meter: where a value sits between the cohort's worst and
     best, with the median marked. Used for the objectives block. */
  function meter(label, value, cohort, fmt) {
    var st = standing(value, cohort);
    if (!st) {
      return "<div class='meter'><div class='meter-head'><span>" + esc(label) +
        "</span><span class='meter-val na'>—</span></div>" +
        "<p class='meter-note'>Too few peers reporting to place this.</p></div>";
    }
    var lo = Math.min.apply(null, cohort.values), hi = Math.max.apply(null, cohort.values);
    var span = hi - lo;
    var at = span > 0 ? (value - lo) / span : 0.5;
    var med = span > 0 ? (cohort.median - lo) / span : 0.5;
    var pos = Math.max(0, Math.min(1, at)) * 100;
    var medPos = Math.max(0, Math.min(1, med)) * 100;
    return "<div class='meter'>" +
      "<div class='meter-head'><span>" + esc(label) + "</span>" +
      "<span class='meter-val'>" + fmt(value) + "</span></div>" +
      "<div class='meter-track' role='img' aria-label='" + esc(label) + " " + fmt(value) +
      ", ranked " + st.rank + " of " + st.of + ", peer median " + fmt(cohort.median) + "'>" +
      "<div class='meter-fill' style='inline-size:" + pos.toFixed(1) + "%'></div>" +
      "<div class='meter-median' style='inset-inline-start:" + medPos.toFixed(1) + "%'></div>" +
      "</div>" +
      "<p class='meter-note'>Rank " + st.rank + " of " + st.of +
      " · peer median " + fmt(cohort.median) + "</p></div>";
  }

  /* ---------- shared context for the whole view ---------- */
  function companyContext() {
    var me = PANEL[state.ticker];
    if (!me) return null;
    var peers = BY_INDUSTRY[me.industry] || [];
    var years = [];
    var all = Object.keys(me.years).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < all.length; i++) years.push(all[i]);
    var year = S.latestResolvedYear(get, me, function (p) { return p.incomeStatement.revenue; }, 5);
    if (year === null) return { me: me, peers: peers, years: years, year: null };
    var period = S.toPeriod(get, me.years[year], year);
    var prior = me.years[year - 1] ? S.toPeriod(get, me.years[year - 1], year - 1) : null;
    return {
      me: me, peers: peers, years: years, year: year,
      period: period, prior: prior,
      isFin: S.isFinancial(me),
      /* Ratios per dollar of sales are withheld entirely when the revenue
         line itself is partial, rather than shown wrong. */
      revenueCredible: S.marginIsCredible(period.incomeStatement.revenue, S.ebitOf(period, S.isFinancial(me)))
    };
  }

  /* ---------- 1. executive summary ---------- */
  function renderExec(ctx) {
    var me = ctx.me, year = ctx.year;
    var co = S.companyRoicSeries(get, me, ctx.years, ctx.isFin);
    var coh = S.cohortRoicSeries(get, ctx.peers, ctx.years);
    var adv = S.advantageSpread(co, coh, 5);
    var roicCohort = cohortOf(ctx.peers, year, "roic");
    var roicNow = M.roic(ctx.period, ctx.prior, me);
    var stRoic = standing(roicNow, roicCohort);
    var mine = {}; co.forEach(function (d) { mine[d.year] = d.roic; });
    var medByYear = {}; coh.forEach(function (d) { medByYear[d.year] = d.median; });
    var pers = S.persistence(mine, medByYear);

    $("exec-cards").innerHTML =
      card("advantageSpread", "Return on capital, 5-yr",
        adv ? pct(adv.co) : "—",
        adv ? ("average of " + adv.fromYear + "–" + adv.toYear) : "",
        adv && !adv.complete ? "only " + adv.years + " years" : null) +
      card("advantageSpread", "Versus its peers",
        adv ? pp(adv.gap) : "—",
        adv ? ("peer median " + pct(adv.cohort) + " over the same years") : "") +
      card(null, "Held above the median",
        pers ? (pers.yearsAbove + " of " + pers.years + " yrs") : "—",
        pers ? pers.verdict : "") +
      card(null, "Rank this year", stRoic ? (stRoic.rank + " of " + stRoic.of) : "—",
        stRoic ? ("on return on capital, " + year) : "");

    var parts = [];
    if (adv) {
      parts.push("<strong>" + esc(state.ticker) + "</strong> earned <strong>" + pct(adv.co) +
        "</strong> on invested capital over the five years to " + adv.toYear +
        ", against <strong>" + pct(adv.cohort) + "</strong> for the " + roicCohort.n +
        " peers reporting in " + esc(me.industry) + " — a gap of " + pp(adv.gap) + ".");
      if (pers) {
        parts.push("It sat above the peer median in " + pers.yearsAbove + " of " +
          pers.years + " years. A single good year is not an advantage; holding one across a cycle is.");
      }
      if (adv.syntheticYears) {
        parts.push("<span class='soft'>Operating profit is rebuilt from pre-tax income in " +
          adv.syntheticYears + " of those " + adv.years +
          " years, because the company no longer tags an operating income line.</span>");
      }
    } else {
      parts.push("Not enough matched years to compare " + esc(state.ticker) +
        " against its peers on return on capital.");
    }
    $("exec-caption").innerHTML = parts.join(" ");

    renderPillars(ctx);
    renderOkr(ctx, roicCohort, roicNow);
    renderHealth(ctx);
  }

  /* Capital deployment — the observable half of "strategic priorities". */
  function renderPillars(ctx) {
    var mix = S.reinvestmentMix(get, ctx.me, ctx.years).slice(-10);
    var box = $("pillars-chart"); box.innerHTML = "";
    if (mix.length < 2) {
      $("pillars-caption").textContent =
        "Not enough years of cash flow data to show how capital was deployed.";
      return;
    }
    var W = Math.max(320, box.clientWidth || 760), H = 210;
    var padL = 40, padR = 12, padT = 12, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    var maxY = Math.max(1.2, Math.max.apply(null, mix.map(function (m) { return m.deployed; })) * 1.1);
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "xMidYMid meet", role: "img" });
    var Y = function (v) { return padT + ih - (v / maxY) * ih; };
    [0, 0.5, 1].forEach(function (g) {
      svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: Y(g), y2: Y(g),
        stroke: g === 1 ? "rgba(245,197,24,.35)" : GRID, "stroke-width": 1 }));
      var t = el("text", { x: padL - 6, y: Y(g) + 3, "text-anchor": "end", "font-size": "9", fill: INK });
      t.textContent = (g * 100).toFixed(0) + "%";
      svg.appendChild(t);
    });
    var slot = iw / mix.length, bw = Math.min(38, slot * 0.62);
    var keys = [["capex", "#5b8def"], ["rnd", GOLD], ["dividends", "#59b87a"], ["buybacks", "#b07bd4"]];
    mix.forEach(function (m, i) {
      var x = padL + slot * i + (slot - bw) / 2, acc = 0;
      keys.forEach(function (k) {
        var v = m[k[0]]; if (!isNum(v) || v <= 0) return;
        var y0 = Y(acc + v), y1 = Y(acc);
        svg.appendChild(el("rect", { x: x, y: y0, width: bw, height: Math.max(0, y1 - y0),
          fill: k[1], opacity: "0.9" }));
        acc += v;
      });
      var lb = el("text", { x: x + bw / 2, y: H - 10, "text-anchor": "middle", "font-size": "9", fill: INK });
      lb.textContent = String(m.year).slice(2);
      svg.appendChild(lb);
    });
    box.appendChild(svg);
    box.insertAdjacentHTML("beforeend",
      "<div class='mix-legend'>" + keys.map(function (k) {
        return "<span><i style='background:" + k[1] + "'></i>" +
          esc({ capex: "Capital expenditure", rnd: "Research and development",
                dividends: "Dividends", buybacks: "Buybacks" }[k[0]]) + "</span>";
      }).join("") + "</div>");

    var last = mix[mix.length - 1];
    var ranked = keys.map(function (k) { return { k: k[0], v: last[k[0]] }; })
      .filter(function (x) { return isNum(x.v) && x.v > 0; })
      .sort(function (a, b) { return b.v - a.v; });
    var nameOf = { capex: "capital expenditure", rnd: "research and development",
                   dividends: "dividends", buybacks: "buybacks" };
    $("pillars-caption").innerHTML = ranked.length
      ? "In " + last.year + ", " + esc(state.ticker) + " put " + pct(ranked[0].v) +
        " of its operating cash into " + nameOf[ranked[0].k] +
        (ranked[1] ? " and " + pct(ranked[1].v) + " into " + nameOf[ranked[1].k] : "") +
        ", deploying " + pct(last.deployed) + " in total. " +
        (last.deployed > 1
          ? "That is more than the business generated, so the difference came from the balance sheet."
          : "The remainder stayed on the balance sheet or went to debt.") +
        " <span class='soft'>A filing does not state priorities; it records which ones were funded.</span>"
      : "";
  }

  function renderOkr(ctx, roicCohort, roicNow) {
    var year = ctx.year;
    var rows = [
      ["Return on invested capital", roicNow, roicCohort, function (v) { return pct(v); }],
      ["Operating margin", M.ebitMargin(ctx.period), cohortOf(ctx.peers, year, "ebitMargin"), function (v) { return pct(v); }],
      ["Return on equity", M.roe(ctx.period, ctx.prior), cohortOf(ctx.peers, year, "roe"), function (v) { return pct(v); }],
      ["Capital turns", M.capitalTurns(ctx.period, ctx.prior), cohortOf(ctx.peers, year, "capitalTurns"), function (v) { return num(v, 2) + "×"; }],
      ["R&D as share of sales", M.rndIntensity(ctx.period), cohortOf(ctx.peers, year, "rndIntensity"), function (v) { return pct(v); }]
    ];
    $("okr-meters").innerHTML = rows.map(function (r) {
      return meter(r[0], r[1], r[2], r[3]);
    }).join("");
  }

  function renderHealth(ctx) {
    var periods = S.companyPeriods(get, ctx.me);
    var r = null;
    try { r = window.RTRatios ? window.RTRatios.computeRatios(periods) : null; } catch (e) { r = null; }
    var latest = (r && r.length) ? r[r.length - 1] : null;
    var z = latest && latest.altmanZ, eq = latest && latest.earningsQuality;
    var fcf = latest && latest.freeCashFlow, nd = latest && latest.netDebt;
    var ebitda = latest && latest.ebitda;
    $("health-cards").innerHTML =
      card(null, "Distress score", (z && isNum(z.score)) ? num(z.score, 2) : "—",
        (z && z.zone) ? z.zone : "Not applicable to this balance sheet") +
      card(null, "Earnings quality", (eq && isNum(eq.ratio)) ? num(eq.ratio, 2) + "×" : "—",
        "Operating cash flow per dollar of reported profit") +
      card(null, "Free cash flow", isNum(fcf) ? money(fcf) : "—",
        "Operating cash flow after capital expenditure") +
      card(null, "Net debt to profit",
        (isNum(nd) && isNum(ebitda) && ebitda > 0) ? num(nd / ebitda, 2) + "×" : "—",
        "Borrowings net of cash, against operating profit before depreciation");
    var bits = [];
    if (z && isNum(z.score)) {
      bits.push("The distress score reads <strong>" + num(z.score, 2) + "</strong> — " +
        esc(String(z.zone || "").toLowerCase()) + ".");
    }
    if (eq && isNum(eq.ratio)) {
      bits.push("Every dollar of reported profit came with <strong>" + num(eq.ratio, 2) +
        "</strong> dollars of operating cash" +
        (eq.ratio < 1 ? ", so profit is running ahead of the cash behind it." : "."));
    }
    bits.push("<span class='soft'>These are four separate readings, deliberately not blended into " +
      "one score: a single number would hide which of them moved, and averaging a solvency " +
      "measure against a cash measure produces a figure that means nothing on its own.</span>");
    $("health-caption").innerHTML = bits.join(" ");
  }

  /* ---------- 2. financial performance ---------- */
  function renderFinancial(ctx) {
    var year = ctx.year, me = ctx.me;
    var revs = ctx.years.map(function (y) {
      var row = me.years[y]; return row ? { year: y, v: get(row, "revenue") } : null;
    }).filter(function (d) { return d && isNum(d.v); });
    var cagr5 = null, cagr10 = null;
    if (revs.length >= 2) {
      var last = revs[revs.length - 1];
      var f5 = revs[Math.max(0, revs.length - 6)], f10 = revs[0];
      cagr5 = S.cagr(f5.v, last.v, last.year - f5.year);
      cagr10 = S.cagr(f10.v, last.v, last.year - f10.year);
    }
    var roicNow = M.roic(ctx.period, ctx.prior, me);
    var roeNow = M.roe(ctx.period, ctx.prior);
    var cf = ctx.period.cashFlow;
    var fcf = (isNum(cf.cfOps) && isNum(cf.capex)) ? cf.cfOps - Math.abs(cf.capex) : null;

    $("fin-cards").innerHTML =
      card(null, "Revenue", money(ctx.period.incomeStatement.revenue), "Fiscal " + year) +
      card(null, "Growth, 5-yr", isNum(cagr5) ? pct(cagr5) : "—", "Compound annual") +
      card(null, "Growth, full window", isNum(cagr10) ? pct(cagr10) : "—",
        revs.length ? (revs[0].year + "–" + revs[revs.length - 1].year) : "") +
      card("roic", "Return on invested capital", pct(roicNow),
        "Operating profit over the capital behind it",
        S.ebitIsSynthetic(ctx.period) ? "operating profit rebuilt" : null) +
      card(null, "Return on equity", pct(roeNow), "On average total equity") +
      card(null, "Free cash flow", isNum(fcf) ? money(fcf) : "—", "After capital expenditure");

    renderMargins(ctx);
    renderCash(ctx);

    $("fin-gap").innerHTML =
      "revenue by segment and by geography. Neither is in the company facts feed this " +
      "dashboard reads — that feed carries only consolidated totals, with no segment or " +
      "regional dimension on any figure. Answering it needs the SEC financial statement " +
      "data sets, where the segment axis is preserved, or the individual filing exhibits.";
  }

  function renderMargins(ctx) {
    var box = $("margin-chart"); box.innerHTML = "";
    var series = ctx.years.map(function (y) {
      var row = ctx.me.years[y]; if (!row) return null;
      var p = S.toPeriod(get, row, y);
      return { year: y, gross: M.grossMargin(p), op: M.ebitMargin(p), net: M.netMargin(p) };
    }).filter(function (d) { return d && (isNum(d.gross) || isNum(d.op) || isNum(d.net)); });
    if (series.length < 2) { $("margin-caption").textContent = "Not enough history for a margin trend."; return; }
    var W = Math.max(320, box.clientWidth || 760), H = 220;
    var padL = 46, padR = 60, padT = 14, padB = 28;
    var iw = W - padL - padR, ih = H - padT - padB;
    var vals = [];
    series.forEach(function (d) { ["gross", "op", "net"].forEach(function (k) { if (isNum(d[k])) vals.push(d[k]); }); });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max.apply(null, vals) * 1.08;
    var X = function (i) { return padL + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw); };
    var Y = function (v) { return padT + ih - ((v - lo) / (hi - lo || 1)) * ih; };
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "xMidYMid meet", role: "img" });
    [lo, (lo + hi) / 2, hi].forEach(function (g) {
      svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: Y(g), y2: Y(g), stroke: GRID, "stroke-width": 1 }));
      var t = el("text", { x: padL - 6, y: Y(g) + 3, "text-anchor": "end", "font-size": "9", fill: INK });
      t.textContent = (g * 100).toFixed(0) + "%";
      svg.appendChild(t);
    });
    [["gross", "#5b8def", "Gross"], ["op", GOLD, "Operating"], ["net", "#59b87a", "Net"]].forEach(function (k) {
      var pts = series.map(function (d, i) { return isNum(d[k[0]]) ? { i: i, v: d[k[0]] } : null; }).filter(Boolean);
      if (pts.length < 2) return;
      svg.appendChild(el("path", { d: pts.map(function (p, j) {
        return (j ? "L" : "M") + X(p.i).toFixed(1) + " " + Y(p.v).toFixed(1); }).join(" "),
        fill: "none", stroke: k[1], "stroke-width": 1.8, "stroke-linejoin": "round" }));
      var lastPt = pts[pts.length - 1];
      var lb = el("text", { x: X(lastPt.i) + 6, y: Y(lastPt.v) + 3, "font-size": "9.5", fill: k[1] });
      lb.textContent = k[2];
      svg.appendChild(lb);
    });
    series.forEach(function (d, i) {
      if (i % Math.ceil(series.length / 8) !== 0 && i !== series.length - 1) return;
      var t = el("text", { x: X(i), y: H - 9, "text-anchor": "middle", "font-size": "9", fill: INK });
      t.textContent = String(d.year).slice(2);
      svg.appendChild(t);
    });
    box.appendChild(svg);
    var first = series[0], last = series[series.length - 1];
    var route = ctx.revenueCredible
      ? S.marginRoute(ctx.period, cohortOf(ctx.peers, ctx.year, "grossMargin").median,
          cohortOf(ctx.peers, ctx.year, "opexIntensity").median)
      : null;
    $("margin-caption").innerHTML =
      "Between " + first.year + " and " + last.year + ", the operating margin moved " +
      pp((isNum(last.op) && isNum(first.op)) ? last.op - first.op : null) +
      " and the gross margin " +
      pp((isNum(last.gross) && isNum(first.gross)) ? last.gross - first.gross : null) + ". " +
      (route && route.label
        ? "<strong>" + esc(route.label) + ".</strong> Gross margin sits " + pp(route.grossMarginGap) +
          " against the peer median and overhead " + pp(route.opexIntensityGap) +
          " better. <span class='soft'>A filing cannot separate price from mix — a wider gross " +
          "margin may be a higher price, a richer product mix, or a cheaper input, and the " +
          "statements do not distinguish them.</span>"
        : "");
  }

  function renderCash(ctx) {
    var box = $("cash-chart"); box.innerHTML = "";
    var series = ctx.years.map(function (y) {
      var row = ctx.me.years[y]; if (!row) return null;
      var p = S.toPeriod(get, row, y);
      var ops = p.cashFlow.cfOps, cap = p.cashFlow.capex;
      if (!isNum(ops) && !isNum(cap)) return null;
      return { year: y, ops: ops, capex: isNum(cap) ? Math.abs(cap) : null };
    }).filter(Boolean).slice(-12);
    if (series.length < 2) { $("cash-caption").textContent = ""; return; }
    var W = Math.max(320, box.clientWidth || 760), H = 200;
    var padL = 52, padR = 12, padT = 14, padB = 28;
    var iw = W - padL - padR, ih = H - padT - padB;
    var vals = [];
    series.forEach(function (d) { if (isNum(d.ops)) vals.push(d.ops); if (isNum(d.capex)) vals.push(d.capex); });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max.apply(null, vals) * 1.08;
    var Y = function (v) { return padT + ih - ((v - lo) / (hi - lo || 1)) * ih; };
    var slot = iw / series.length, bw = Math.min(16, slot * 0.34);
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "xMidYMid meet", role: "img" });
    svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: Y(0), y2: Y(0), stroke: GRID, "stroke-width": 1 }));
    series.forEach(function (d, i) {
      var x = padL + slot * i + (slot - bw * 2 - 3) / 2;
      if (isNum(d.ops)) svg.appendChild(el("rect", { x: x, y: Math.min(Y(d.ops), Y(0)),
        width: bw, height: Math.abs(Y(d.ops) - Y(0)), fill: GOLD, opacity: "0.9" }));
      if (isNum(d.capex)) svg.appendChild(el("rect", { x: x + bw + 3, y: Math.min(Y(d.capex), Y(0)),
        width: bw, height: Math.abs(Y(d.capex) - Y(0)), fill: "#5b8def", opacity: "0.85" }));
      if (i % Math.ceil(series.length / 8) === 0 || i === series.length - 1) {
        var t = el("text", { x: x + bw, y: H - 9, "text-anchor": "middle", "font-size": "9", fill: INK });
        t.textContent = String(d.year).slice(2);
        svg.appendChild(t);
      }
    });
    box.appendChild(svg);
    box.insertAdjacentHTML("beforeend",
      "<div class='mix-legend'><span><i style='background:" + GOLD + "'></i>Operating cash flow</span>" +
      "<span><i style='background:#5b8def'></i>Capital expenditure</span></div>");
    var last = series[series.length - 1];
    var conv = (isNum(last.ops) && isNum(last.capex) && last.ops !== 0)
      ? (last.ops - last.capex) / last.ops : null;
    $("cash-caption").innerHTML = isNum(conv)
      ? "In " + last.year + ", " + pct(conv) + " of operating cash survived capital spending. " +
        "Capital expenditure ran at " + pct(S.div(last.capex, last.ops)) + " of operating cash flow."
      : "";
  }

  /* ---------- 3. market and competitive position ---------- */
  function renderMarket(ctx) {
    var year = ctx.year;
    var iy = S.industryYear(get, ctx.peers, year);
    var mine = iy && iy.pool.filter(function (p) { return p.ticker === state.ticker; })[0];
    var gm = cohortOf(ctx.peers, year, "grossMargin");
    var route = ctx.revenueCredible ? S.marginRoute(ctx.period, gm.median, cohortOf(ctx.peers, year, "opexIntensity").median) : null;

    $("mkt-cards").innerHTML =
      card(null, "Share of covered peers", mine ? pct(mine.revenueShare) : "—",
        "Of " + (iy ? iy.poolFirms : 0) + " firms' combined revenue — an upper bound, not market share") +
      card("poolCapture", "Profit share", mine ? pct(mine.profitShare) : "—",
        "Share of the peer set's combined operating profit") +
      card("poolCapture", "Value capture", (mine && isNum(mine.poolCaptureRatio)) ? num(mine.poolCaptureRatio, 2) + "×" : "—",
        "Profit share divided by revenue share") +
      card(null, "Gross margin vs peers", route ? pp(route.grossMarginGap) : "—",
        "The price-minus-cost outcome, not a price index");

    var rowsHtml = (iy ? iy.pool : []).slice(0, 12).map(function (p) {
      var m = (BY_INDUSTRY[ctx.me.industry] || []).filter(function (x) { return x.ticker === p.ticker; })[0];
      var g = null;
      if (m) {
        var ys = Object.keys(m.years).map(Number).sort(function (a, b) { return a - b; });
        var lastY = ys[ys.length - 1], firstY = ys[Math.max(0, ys.length - 6)];
        var a = m.years[firstY] && get(m.years[firstY], "revenue");
        var b = m.years[lastY] && get(m.years[lastY], "revenue");
        if (isNum(a) && isNum(b) && lastY > firstY) g = S.cagr(a, b, lastY - firstY);
      }
      var self = p.ticker === state.ticker;
      return "<tr><td class='" + (self ? "pool-you" : "") + "'>" + esc(p.ticker) + "</td>" +
        "<td class='num" + (self ? " pool-you" : "") + "'>" + money(p.revenue) + "</td>" +
        "<td class='num" + (self ? " pool-you" : "") + "'>" + pct(p.revenueShare) + "</td>" +
        "<td class='num" + (self ? " pool-you" : "") + "'>" + pct(p.operatingMargin) + "</td>" +
        "<td class='num" + (self ? " pool-you" : "") + "'>" + (isNum(g) ? pct(g) : "—") + "</td></tr>";
    }).join("");
    $("t-bench").innerHTML =
      "<thead><tr><th scope='col'>" + year + "</th><th scope='col' class='num'>Revenue</th>" +
      "<th scope='col' class='num'>Share</th><th scope='col' class='num'>Op margin</th>" +
      "<th scope='col' class='num'>Growth, 5-yr</th></tr></thead><tbody>" + rowsHtml + "</tbody>";

    $("mkt-caption").innerHTML = mine
      ? esc(state.ticker) + " takes " + pct(mine.revenueShare) + " of the covered peers' revenue and " +
        pct(mine.profitShare) + " of their operating profit" +
        (isNum(mine.poolCaptureRatio)
          ? ", so it captures " + num(mine.poolCaptureRatio, 2) + "× its revenue share of the profit."
          : ".") +
        " <span class='soft'>Read this as position among large listed rivals. It is not market " +
        "share: private firms, foreign entrants and smaller competitors are outside the panel, " +
        "so the true denominator is larger and every share here is an upper bound.</span>"
      : "";

    $("mkt-gap").innerHTML =
      "share of a served market or of a total addressable market, a true pricing index, and " +
      "share of voice. Market sizing needs an industry data source with private and foreign " +
      "competitors in it; a pricing index needs published price lists or a producer price " +
      "series, since a filing reports revenue and never unit prices; share of voice needs " +
      "media and search measurement, which is not financial data at all.";
  }

  /* ---------- 4. customer and product ---------- */
  function renderCustomer(ctx) {
    var bl = S.backlogTrend(get, ctx.me, ctx.years);
    var latest = bl ? bl[bl.length - 1] : null;
    var is = ctx.period.incomeStatement;
    var sm = is.sellingMarketing;
    var prevRev = ctx.prior ? ctx.prior.incomeStatement.revenue : null;
    var deltaRev = (isNum(is.revenue) && isNum(prevRev)) ? is.revenue - prevRev : null;
    var acquisition = (isNum(sm) && isNum(deltaRev) && deltaRev > 0) ? sm / deltaRev : null;
    var deferredNow = ctx.period.balanceSheet.deferredRevenue;
    var deferredPrior = ctx.prior ? ctx.prior.balanceSheet.deferredRevenue : null;
    var deferredGrowth = (isNum(deferredNow) && isNum(deferredPrior) && deferredPrior > 0)
      ? (deferredNow - deferredPrior) / deferredPrior : null;

    $("cust-cards").innerHTML =
      card(null, "Contracted backlog", latest && isNum(latest.backlog) ? money(latest.backlog) : "—",
        latest && isNum(latest.backlog) ? "Signed revenue not yet recognised" : "Not disclosed by this filer") +
      card(null, "Backlog cover", latest && isNum(latest.coverage) ? pct(latest.coverage) : "—",
        "Backlog as a share of one year's revenue") +
      card(null, "Deferred revenue growth", isNum(deferredGrowth) ? pct(deferredGrowth) : "—",
        "Customer prepayments — demand already banked") +
      card(null, "Acquisition spend per new dollar", isNum(acquisition) ? num(acquisition, 2) + "×" : "—",
        isNum(sm) ? "Sales and marketing per dollar of revenue growth" : "Selling and marketing not reported separately");

    renderBacklog(ctx, bl);

    var bits = [];
    if (latest && isNum(latest.backlog)) {
      bits.push("Customers have already committed <strong>" + money(latest.backlog) +
        "</strong>" + (isNum(latest.coverage) ? ", equal to " + pct(latest.coverage) +
        " of a year's revenue" : "") + ". This is contracted and disclosed, not forecast.");
    }
    if (isNum(deferredGrowth)) {
      bits.push("Customer prepayments " + (deferredGrowth >= 0 ? "rose " : "fell ") +
        pct(Math.abs(deferredGrowth)) + " over the year" +
        (deferredGrowth < 0 ? ", which is the direction that would accompany weakening demand." : "."));
    }
    if (!bits.length) bits.push("This filer discloses neither a contracted backlog nor customer prepayments.");
    $("cust-caption").innerHTML = bits.join(" ");

    $("cust-gap").innerHTML =
      "customer acquisition cost, lifetime value, churn, net promoter score and revenue by " +
      "product line. None of these is a reporting requirement and none appears in any filing. " +
      "Acquisition cost and lifetime value need the company's own cohort data; churn and " +
      "promoter score need its customer records or a survey; product-line revenue needs the " +
      "segment disclosures, which the company facts feed strips out. The backlog and " +
      "prepayment figures above are what a filing genuinely carries in their place, and they " +
      "answer a narrower question than the ones asked.";
  }

  function renderBacklog(ctx, bl) {
    var box = $("backlog-chart"); box.innerHTML = "";
    if (!bl || bl.length < 2) return;
    var series = bl.filter(function (d) { return isNum(d.backlog); });
    if (series.length < 2) return;
    var W = Math.max(320, box.clientWidth || 760), H = 170;
    var padL = 56, padR = 12, padT = 12, padB = 26;
    var iw = W - padL - padR, ih = H - padT - padB;
    var hi = Math.max.apply(null, series.map(function (d) { return d.backlog; })) * 1.1;
    var Y = function (v) { return padT + ih - (v / (hi || 1)) * ih; };
    var slot = iw / series.length, bw = Math.min(30, slot * 0.55);
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "xMidYMid meet", role: "img" });
    svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: Y(0), y2: Y(0), stroke: GRID, "stroke-width": 1 }));
    series.forEach(function (d, i) {
      var x = padL + slot * i + (slot - bw) / 2;
      svg.appendChild(el("rect", { x: x, y: Y(d.backlog), width: bw,
        height: Math.max(0, Y(0) - Y(d.backlog)), fill: GOLD, opacity: "0.85" }));
      var t = el("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle", "font-size": "9", fill: INK });
      t.textContent = String(d.year).slice(2);
      svg.appendChild(t);
    });
    box.appendChild(svg);
  }

  /* ---------- 5. operations ---------- */
  function renderOps(ctx) {
    var year = ctx.year;
    var wc = S.workingCapitalDays(ctx.period, ctx.prior);
    var invTurns = M.inventoryTurns(ctx.period, ctx.prior);
    var rnd = M.rndIntensity(ctx.period);
    var assetT = M.assetTurns(ctx.period, ctx.prior);
    var rndCohort = cohortOf(ctx.peers, year, "rndIntensity");
    var atCohort = cohortOf(ctx.peers, year, "assetTurns");
    var stRnd = standing(rnd, rndCohort), stAt = standing(assetT, atCohort);

    $("ops-cards").innerHTML =
      card(null, "Asset turns", isNum(assetT) ? num(assetT, 2) + "×" : "—",
        stAt ? ("Revenue per dollar of assets · " + rankNote(stAt)) : "Revenue per dollar of average assets") +
      card(null, "Inventory turns", isNum(invTurns) ? num(invTurns, 1) + "×" : "—",
        isNum(invTurns) ? "Cost of sales over average inventory" : "No inventory reported") +
      card(null, "Cash conversion cycle", isNum(wc.cashCycle) ? num(wc.cashCycle, 0) + " days" : "—",
        "Days sales outstanding plus inventory days, less days payable") +
      card(null, "R&D as share of sales", pct(rnd),
        stRnd ? rankNote(stRnd) : "Not reported separately");

    var bits = [];
    if (isNum(wc.cashCycle)) {
      bits.push(wc.cashCycle < 0
        ? "The cash cycle is <strong>negative at " + num(wc.cashCycle, 0) + " days</strong>: customers pay " +
          "before suppliers are paid, so growth funds itself rather than consuming cash."
        : "Cash is tied up for <strong>" + num(wc.cashCycle, 0) + " days</strong> between paying for inputs " +
          "and being paid for output — " + num(wc.dso, 0) + " days in receivables, " + num(wc.dio, 0) +
          " in inventory, less " + num(wc.dpo, 0) + " days of supplier credit.");
    }
    if (stRnd && isNum(rnd)) {
      bits.push("Research spending is " + pct(rnd) + " of sales, " + rankNote(stRnd) +
        " in the peer set against a median of " + pct(rndCohort.median) + ".");
    }
    $("ops-caption").innerHTML = bits.join(" ");

    $("ops-gap").innerHTML =
      "capacity utilisation, headcount, employee turnover and project milestones. Headcount " +
      "is the important one: it is not a tagged financial concept, so revenue per employee " +
      "cannot be computed here at all — the denominator does not exist in the data. It appears " +
      "as plain text on a filing's cover page and would need text extraction. Capacity " +
      "utilisation is an operational measure companies rarely publish, and milestones are " +
      "internal project data that never appears in a financial report.";
  }

  /* ---------- 6. risk ---------- */
  function renderRisk(ctx) {
    var periods = S.companyPeriods(get, ctx.me);
    var r = null;
    try { r = window.RTRatios ? window.RTRatios.computeRatios(periods) : null; } catch (e) { r = null; }
    var latest = (r && r.length) ? r[r.length - 1] : null;
    var b = ctx.period.balanceSheet;
    var debt = (isNum(b.shortTermDebt) ? b.shortTermDebt : 0) + (isNum(b.longTermDebt) ? b.longTermDebt : 0);
    var cash = (isNum(b.cash) ? b.cash : 0) + (isNum(b.shortTermInvestments) ? b.shortTermInvestments : 0);
    var ebit = S.ebitOf(ctx.period, ctx.isFin);
    var cover = (isNum(ebit) && isNum(ctx.period.incomeStatement.interestExpense) &&
      Math.abs(ctx.period.incomeStatement.interestExpense) > 0)
      ? ebit / Math.abs(ctx.period.incomeStatement.interestExpense) : null;
    /* Volatility of the operating margin over the window: a structural
       exposure the statements genuinely evidence. */
    var margins = ctx.years.map(function (y) {
      var row = ctx.me.years[y]; return row ? M.ebitMargin(S.toPeriod(get, row, y)) : null;
    }).filter(isNum);
    var vol = margins.length >= 4 ? S.stdev(margins) : null;
    var z = latest && latest.altmanZ;

    $("risk-cards").innerHTML =
      card(null, "Net debt", isNum(debt - cash) ? money(debt - cash) : "—",
        (debt - cash) < 0 ? "Net cash — more liquid assets than borrowings" : "Borrowings net of cash and investments") +
      card(null, "Interest cover", isNum(cover) ? num(cover, 1) + "×" : "—",
        isNum(cover) ? "Operating profit per dollar of interest" : "No material interest expense") +
      card(null, "Margin volatility", isNum(vol) ? pp(vol) : "—",
        "Standard deviation of the operating margin across the window") +
      card(null, "Distress score", (z && isNum(z.score)) ? num(z.score, 2) : "—",
        (z && z.zone) ? z.zone : "Not applicable to this balance sheet");

    var bits = [];
    if (isNum(debt - cash)) {
      bits.push((debt - cash) < 0
        ? "The company holds <strong>" + money(cash - debt) + " more in cash and investments than borrowings</strong>, " +
          "which removes refinancing risk from the picture entirely."
        : "Borrowings exceed cash by <strong>" + money(debt - cash) + "</strong>" +
          (isNum(cover) ? ", covered " + num(cover, 1) + "× by operating profit." : "."));
    }
    if (isNum(vol)) {
      bits.push("The operating margin has varied by " + pp(vol) + " around its own average across " +
        margins.length + " years" +
        (vol > 0.08 ? ", which is wide enough that a single year is a poor guide to the next." : "."));
    }
    $("risk-caption").innerHTML = bits.join(" ");

    $("risk-gap").innerHTML =
      "strategic and operational risk severity, regulatory compliance status, and macro " +
      "exposure. A filing does carry a risk-factor section and a legal-proceedings section in " +
      "narrative text, and an internal-control conclusion, but none of those is a severity or " +
      "a likelihood — placing them on a heat map would be plotting an opinion and calling it " +
      "data. Compliance status is held by regulators, not published in financial statements. " +
      "Macro series such as inflation and policy rates are public but come from a central " +
      "bank feed rather than from any company's accounts.";
  }

  /* ---------- evidence register ---------- */
  var EVIDENCE = [
    ["Revenue by segment", "Financial performance", "Consolidated totals only; the company facts feed carries no segment dimension", "SEC financial statement data sets, which preserve the segment axis, or the filing exhibits"],
    ["Geographic mix", "Financial performance", "Same — no regional dimension on any figure", "The entity-wide geographic tags, for the minority of filers that use them, or the data sets"],
    ["Market share against a served market", "Market position", "The panel holds large listed companies only", "An industry source that includes private and foreign competitors"],
    ["Pricing index", "Market position", "Filings report revenue, never unit prices", "Published price lists, or a producer price series for the category"],
    ["Share of voice", "Market position", "Not financial data", "Media and search measurement"],
    ["Customer acquisition cost and lifetime value", "Customer", "Never a reporting requirement", "The company's own cohort economics"],
    ["Churn, promoter score, satisfaction", "Customer", "Internal or survey measures, never filed", "Customer records, or a commissioned survey"],
    ["Revenue by product line", "Customer", "Stripped out with the segment dimension", "The segment disclosures in the filing itself"],
    ["Headcount, turnover, employee sentiment", "Operations", "Headcount is not a tagged financial concept, so revenue per employee cannot be computed either", "Text extraction from the filing cover page; sentiment needs an employee survey"],
    ["Capacity utilisation", "Operations", "Operational measure, rarely published", "Company disclosure or an industry survey"],
    ["Project milestones", "Operations", "Internal project data", "Company planning records"],
    ["Strategic and operational risk severity", "Risk", "Filings carry risk narrative, not severity or likelihood", "Assessment against an external framework, declared as judgement"],
    ["Regulatory compliance status", "Risk", "Held by regulators, not in financial statements", "Regulator registers, and the filing's own legal-proceedings section"],
    ["Macro indicators", "Risk", "Not company data", "A central bank statistical feed"]
  ];

  function renderEvidence() {
    $("t-evidence").innerHTML =
      "<thead><tr><th scope='col'>Not shown</th><th scope='col'>Block</th>" +
      "<th scope='col'>Why not</th><th scope='col'>What would settle it</th></tr></thead><tbody>" +
      EVIDENCE.map(function (e) {
        return "<tr><td>" + esc(e[0]) + "</td><td>" + esc(e[1]) + "</td><td>" +
          esc(e[2]) + "</td><td>" + esc(e[3]) + "</td></tr>";
      }).join("") + "</tbody>";
  }

  /* ---------- stock performance ---------- */
  var STOCK_CACHE = {};
  function renderStock(ticker, force) {
    var host = $("stock-block");
    if (!force && STOCK_CACHE[ticker]) { paintStock(ticker, STOCK_CACHE[ticker]); return; }
    host.innerHTML = "<p class='hint' id='stock-status' role='status'>Loading price history…</p>";
    fetch("/api/market?ticker=" + encodeURIComponent(ticker) + (force ? "&force=1" : ""))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(String(r.status))); })
      .then(function (d) { STOCK_CACHE[ticker] = d; if (state.ticker === ticker) paintStock(ticker, d); })
      .catch(function () {
        if (state.ticker !== ticker) return;
        $("stock-block").innerHTML =
          "<p class='hint'>Price history is unavailable right now. Every figure above comes " +
          "from the filings and is unaffected.</p>";
      });
  }

  function paintStock(ticker, d) {
    var q = d && d.quote, prof = d && d.profile;
    if (!q || !isNum(q.price)) {
      $("stock-block").innerHTML = "<p class='hint'>No price data for " + esc(ticker) + ".</p>";
      return;
    }
    var chg = isNum(q.changePercent) ? q.changePercent / 100 : null;
    $("stock-block").innerHTML =
      "<div class='kpi-grid'>" +
      card(null, "Price", "$" + num(q.price, 2), prof && prof.exchange ? esc(prof.exchange) : "Latest close") +
      card(null, "Change", isNum(chg) ? pct(chg) : "—", "On the session") +
      card(null, "Market value", isNum(q.marketCap) ? money(q.marketCap * 1e6) : "—", "Shares at the current price") +
      card(null, "52-week range",
        (isNum(q.low52) && isNum(q.high52)) ? "$" + num(q.low52, 0) + "–$" + num(q.high52, 0) : "—",
        "Trading range over the year") +
      "</div>" +
      "<p class='chart-caption'>Market value is what the equity is priced at today; every " +
      "other figure in this view is what the business reported. The two answer different " +
      "questions and are deliberately not combined into one score.</p>";
  }

  /* ---------- view dispatch ---------- */
  function renderCompanyView() {
    var ctx = companyContext();
    var host = $("company-view");
    if (!ctx) {
      host.innerHTML = "<section class='panel-card fsa-section'><p class='hint'>" +
        esc(state.ticker) + " is not in the covered panel.</p></section>";
      return;
    }
    if (ctx.year === null) {
      $("exec-cards").innerHTML = "";
      $("exec-caption").textContent = esc(state.ticker) +
        " does not report revenue in a form this dashboard can read, so the company view is withheld.";
      return;
    }
    COHORT_CACHE = {};
    renderExec(ctx);
    renderFinancial(ctx);
    renderMarket(ctx);
    renderCustomer(ctx);
    renderOps(ctx);
    renderRisk(ctx);
    renderEvidence();
    renderStock(state.ticker, false);
  }

  function setView(v) {
    state.view = (v === "company") ? "company" : "industry";
    $("view-industry").setAttribute("aria-pressed", String(state.view === "industry"));
    $("view-company").setAttribute("aria-pressed", String(state.view === "company"));
    $("industry-view").hidden = state.view !== "industry";
    $("company-view").hidden = state.view === "industry";
    render();
    var h = document.querySelector(
      (state.view === "company" ? "#company-view" : "#industry-view") + " h2");
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  }

  function render() {
    var ind = state.industry;
    var data = industryData(ind);
    if (!data.series.length) {
      $("status").textContent = "No usable data for " + ind + ".";
      $("strategy-body").hidden = true;
      return;
    }
    $("status").textContent = "";
    $("strategy-body").hidden = false;
    if (state.view === "company") {
      renderCompanyView();
    } else {
      renderStructure(ind, data);
      renderRoic(ind, data);
      renderPool(ind, data);
      renderPosition(ind, data);
      renderGrowth(ind, data);
      renderForces(ind, data);
      renderSustain();
    }
    var span = data.years[0] + "–" + data.years[data.years.length - 1];
    $("src-footer-text").textContent =
      "Source: SEC EDGAR XBRL, " + Object.keys(PANEL).length + " large listed US companies, " +
      span + ". SEC XBRL begins around 2007–2009 because the mandate phased in from 2009, " +
      "so the window reaches back roughly 19 years rather than to 2002. " +
      "Industry grouping is the SEC's own SIC classification, refined to three digits where " +
      "the two-digit group mixes businesses that do not compete. Not investment advice.";
  }

  function setCompany(ticker) {
    state.ticker = ticker;
    var meta = PANEL[ticker] || MAP[ticker];
    $("co-name").textContent = meta ? meta.name : ticker;
    $("co-meta").innerHTML = "<span class='tk'>" + esc(ticker) + "</span>" +
      (meta ? " <span class='sep'>·</span> <span>" + esc(meta.industry) + "</span>" +
        " <span class='sep'>·</span> <span>" + esc(meta.sector) + "</span>" : "");
    document.title = ticker + " — Strategy Analysis";
    try {
      history.replaceState({ t: ticker, v: state.view }, "",
        location.pathname + "?t=" + encodeURIComponent(ticker) +
        (state.view === "company" ? "&v=company" : ""));
    } catch (e) { /* sandboxed */ }
    if (meta && meta.industry) {
      state.industry = meta.industry;
      $("industry-select").value = meta.industry;
    }
    render();
  }

  /* industry picker */
  var industries = Object.keys(BY_INDUSTRY).sort();
  $("industry-select").innerHTML = industries.map(function (i) {
    return "<option value='" + esc(i) + "'>" + esc(i) + " (" + BY_INDUSTRY[i].length + ")</option>";
  }).join("");
  $("industry-select").addEventListener("change", function () {
    state.industry = this.value;
    render();
  });
  $("view-industry").addEventListener("click", function () { setView("industry"); });
  $("view-company").addEventListener("click", function () { setView("company"); });

  /* Refresh re-reads live market data and, on the company view, redraws
     everything from the panel. Filing figures come from the exported panel
     and only change when the data is rebuilt, so the button says what it
     did rather than implying it refetched accounts. */
  $("refresh-btn").addEventListener("click", function () {
    var btn = this;
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = "Refreshing…";
    delete STOCK_CACHE[state.ticker];
    if (state.view === "company") renderStock(state.ticker, true);
    render();
    window.setTimeout(function () {
      btn.disabled = false;
      btn.textContent = was;
      $("status").textContent = "Refreshed " +
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ".";
      window.setTimeout(function () { $("status").textContent = ""; }, 4000);
    }, 600);
  });

  $("p-imitate").addEventListener("input", renderSustain);
  $("n-activities").addEventListener("input", renderSustain);

  /* ---------- search ---------- */
  var q = $("q"), rBox = $("results"), rList = $("results-list"), activeIdx = -1, matches = [];
  function findMatches(text) {
    var t = text.trim().toUpperCase();
    if (!t) return [];
    var out = [];
    Object.keys(PANEL).forEach(function (tk) {
      var nm = (PANEL[tk].name || "").toUpperCase();
      if (tk === t) out.unshift([tk, PANEL[tk].name]);
      else if (tk.indexOf(t) === 0 || nm.indexOf(t) !== -1) out.push([tk, PANEL[tk].name]);
    });
    return out.slice(0, 8);
  }
  function renderResults() {
    rList.innerHTML = matches.length ? matches.map(function (m, i) {
      return "<li role='option' id='st-opt-" + i + "' data-i='" + i + "' aria-selected='" +
        (i === activeIdx) + "'><span class='tk'>" + esc(m[0]) + "</span>" +
        "<span class='nm'>" + esc(m[1]) + "</span></li>";
    }).join("") : "<li class='none'>No matching companies</li>";
    rBox.classList.add("open");
    q.setAttribute("aria-expanded", "true");
    if (activeIdx >= 0 && matches.length) q.setAttribute("aria-activedescendant", "st-opt-" + activeIdx);
    else q.removeAttribute("aria-activedescendant");
  }
  function closeResults() {
    rBox.classList.remove("open");
    q.setAttribute("aria-expanded", "false");
    q.removeAttribute("aria-activedescendant");
    activeIdx = -1;
  }
  function pick(m) { q.value = m[0] + " — " + m[1]; closeResults(); setCompany(m[0]); }
  q.addEventListener("input", function () {
    matches = findMatches(q.value);
    activeIdx = matches.length ? 0 : -1;
    if (q.value.trim()) renderResults(); else closeResults();
  });
  q.addEventListener("keydown", function (ev) {
    if (ev.key === "ArrowDown" && matches.length) { ev.preventDefault(); activeIdx = Math.min(activeIdx + 1, matches.length - 1); renderResults(); }
    else if (ev.key === "ArrowUp" && matches.length) { ev.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderResults(); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (matches.length) pick(matches[Math.max(0, activeIdx)]); }
    else if (ev.key === "Escape") closeResults();
  });
  rList.addEventListener("click", function (ev) {
    var li = ev.target.closest("li[data-i]");
    if (li) pick(matches[Number(li.getAttribute("data-i"))]);
  });
  document.addEventListener("click", function (ev) {
    if (!ev.target.closest(".search")) closeResults();
  });
  document.addEventListener("keydown", function (ev) {
    var inField = ev.target && ev.target.closest &&
      ev.target.closest("input, textarea, select, [contenteditable]");
    var cmdK = (ev.ctrlKey || ev.metaKey) && (ev.key === "k" || ev.key === "K");
    if (cmdK || (!inField && ev.key === "/")) { ev.preventDefault(); q.focus(); q.select(); }
  });

  /* ---------- about modal ---------- */
  var aboutModal = $("about-modal"), aboutPanel = aboutModal.querySelector(".modal"), opener = null;
  $("about-btn").addEventListener("click", function () {
    opener = document.activeElement; aboutModal.hidden = false; aboutPanel.focus();
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

  /* nav fade, matching the other pages */
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

  window.addEventListener("resize", function () {
    clearTimeout(window.__stResize);
    window.__stResize = setTimeout(render, 180);
  });

  /* ---------- init ---------- */
  var urlT = (location.search.match(/[?&]t=([A-Za-z0-9.\-]+)/) || [])[1];
  var initial = urlT ? decodeURIComponent(urlT).toUpperCase() : "NVDA";
  if (!PANEL[initial]) initial = "NVDA";
  var m0 = PANEL[initial];
  q.value = m0 ? initial + " — " + m0.name : initial;
  /* A shared link that opened the company view reopens it there. Set
     before the first render so the view is not drawn twice. */
  if (/[?&]v=company/.test(location.search)) {
    state.view = "company";
    $("view-industry").setAttribute("aria-pressed", "false");
    $("view-company").setAttribute("aria-pressed", "true");
    $("industry-view").hidden = true;
    $("company-view").hidden = false;
  }
  setCompany(initial);
})();
