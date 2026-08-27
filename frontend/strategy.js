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

  var state = { ticker: "NVDA", industry: null };

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
    renderStructure(ind, data);
    renderRoic(ind, data);
    renderPool(ind, data);
    renderPosition(ind, data);
    renderGrowth(ind, data);
    renderForces(ind, data);
    renderSustain();
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
      history.replaceState({ t: ticker }, "", location.pathname + "?t=" + encodeURIComponent(ticker));
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
  setCompany(initial);
})();
