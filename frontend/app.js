/* Research Terminal — Company Overview (v3)
   Renders the finance_db SEC EDGAR export (data/company-*.js).
   No external dependencies; charts are hand-built SVG.
   v3: fitted price axis + crosshair readout, ?t= deep links, combobox and
   dialog accessibility, grouped liquidity table. */
(function () {
  "use strict";
  try {
    /* Derived figures come from lib/metrics.js — the same file the weekly
       refresh and /api/pull use, and the definitions the SQL views in
       sql/06_canonical_views.sql restate for Power BI. Computing a ratio
       inline here is what let the four surfaces disagree. */
    var MX = window.RTMetrics;
    if (!MX) throw new Error("lib/metrics.js failed to load");

    var INDEX = Array.isArray(window.COMPANY_INDEX) ? window.COMPANY_INDEX : [];
    var COVERAGE = { KBLB: window.COMPANY_OVERVIEW_DATA || null };
    /* tickers with an exported data file (from data/coverage.js) */
    var COVERED = {};
    (Array.isArray(window.COMPANY_COVERAGE) ? window.COMPANY_COVERAGE : ["KBLB"])
      .forEach(function (t) { COVERED[t] = true; });
    var BY_TICKER = {};
    INDEX.forEach(function (row) { BY_TICKER[row[0]] = row; });
    /* colloquial names whose official SEC name differs */
    var ALIASES = {
      GOOGLE: ["GOOGL", "GOOG"],
      YOUTUBE: ["GOOGL", "GOOG"],
      FACEBOOK: ["META"],
      INSTAGRAM: ["META"],
      WHATSAPP: ["META"]
    };
    var loading = {};

    var state = { ticker: "KBLB", range: "30d", pct: false };

    /* chart palette (dark terminal) — mirrors the styles.css tokens */
    var CH_MUT = "#8b8f98";              /* axis labels, dates (text-tertiary) */
    var CH_BRD = "rgba(255,255,255,.08)"; /* gridlines */
    var CH_LINE = "#f5c518";             /* price line — terminal gold */
    var CH_BAR = "#6b6f78";              /* value-traded columns, graphite (≥3:1 on card) */
    var CH_XHAIR = "rgba(255,255,255,.3)";
    var CH_GROUND = "#16181c";           /* card surface behind the plot */

    function $(id) { return document.getElementById(id); }

    /* ---------- formatting ---------- */
    function money(v) {
      if (v === null || v === undefined || isNaN(v)) return "—";
      var neg = v < 0, a = Math.abs(v), s;
      if (a >= 1e12) s = (a / 1e12).toFixed(2) + "T";
      else if (a >= 1e9) s = (a / 1e9).toFixed(2) + "B";
      else if (a >= 1e6) s = (a / 1e6).toFixed(2) + "M";
      else if (a >= 1e3) s = (a / 1e3).toFixed(1) + "K";
      else s = a.toFixed(a < 1 ? 4 : 2);
      return (neg ? "−$" : "$") + s;
    }
    function count(v) {
      if (v === null || v === undefined || isNaN(v)) return "—";
      var a = Math.abs(v), neg = v < 0, s;
      if (a >= 1e12) s = (a / 1e12).toFixed(2) + "T";
      else if (a >= 1e9) s = (a / 1e9).toFixed(2) + "B";
      else if (a >= 1e6) s = (a / 1e6).toFixed(1) + "M";
      else if (a >= 1e3) s = (a / 1e3).toFixed(1) + "K";
      else s = String(Math.round(a));
      return (neg ? "−" : "") + s;
    }
    function pctChange(cur, prev) {
      if (cur === null || prev === null || cur === undefined || prev === undefined || isNaN(cur) || isNaN(prev) || prev === 0) return null;
      return ((cur - prev) / Math.abs(prev)) * 100;
    }
    function fmtPct(p) {
      if (p === null || p === undefined || isNaN(p)) return "—";
      return (p > 0 ? "+" : p < 0 ? "−" : "") + Math.abs(p).toFixed(1) + "%";
    }
    function fmtDate(iso) {
      if (!iso) return "—";
      var d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
      if (isNaN(d)) return iso;
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
    function cls(p) { return p === null || p === undefined ? "na" : p > 0 ? "up" : p < 0 ? "down" : ""; }

    /* ---------- table builder ---------- */
    function fillTable(tbl, head, rows) {
      if (!tbl) return;
      var html = "<thead><tr>";
      head.forEach(function (h, i) { html += "<th scope='col'" + (i === 0 ? "" : " class='num'") + ">" + h + "</th>"; });
      html += "</tr></thead><tbody>";
      rows.forEach(function (r) {
        if (r && !Array.isArray(r) && r.group) {
          html += "<tr class='tgroup'><td colspan='" + head.length + "'>" + r.group + "</td></tr>";
          return;
        }
        var c0 = r[0];
        if (c0 && typeof c0 === "object") html += "<tr><td class='" + (c0.c || "") + "'>" + c0.v + "</td>";
        else html += "<tr><td>" + c0 + "</td>";
        for (var i = 1; i < r.length; i++) {
          var cell = r[i];
          if (cell && typeof cell === "object") html += "<td class='num " + (cell.c || "") + "'>" + cell.v + "</td>";
          else html += "<td class='num'>" + cell + "</td>";
        }
        html += "</tr>";
      });
      tbl.innerHTML = html + "</tbody>";
    }

    /* ---------- hero ---------- */
    function renderHero(d) {
      var c = d.company, m = (d.price && d.price.market) || {};
      $("co-name").textContent = c.name || c.ticker;
      var meta = [];
      meta.push("<span class='tk'>" + c.ticker + "</span>");
      if (c.exchange) meta.push("<span class='sep'>·</span><span>" + c.exchange + "</span>");
      if (c.industry) meta.push("<span class='sep'>·</span><span>" + c.industry + "</span>");
      if (c.cik) meta.push("<span class='sep'>·</span><span class='tk'>CIK " + c.cik + "</span>");
      if (d.latestFiling && d.latestFiling.form) meta.push("<span class='sep'>·</span><span>Latest Filing " + d.latestFiling.form + " · " + fmtDate(d.latestFiling.date) + "</span>");
      $("co-meta").innerHTML = meta.join(" ");

      /* Staleness guard: a company filing periodic reports never goes more
         than ~12 months between them. Older than 400 days means EDGAR's
         data is stale (delisted, deregistered, or reporting elsewhere) —
         say so loudly instead of presenting old fundamentals as current. */
      var staleEl = $("stale-warn"), lf = d.latestFiling;
      if (staleEl) {
        var ageDays = lf && lf.date
          ? (Date.now() - new Date(lf.date + "T00:00:00Z").getTime()) / 864e5
          : NaN;
        if (lf && lf.form && !isNaN(ageDays) && ageDays > 400) {
          staleEl.textContent =
            "⚠ Stale SEC data: the latest periodic report on EDGAR is a " +
            lf.form + " filed " + fmtDate(lf.date) + " — over a year ago. " +
            "The company may have deregistered or may report only " +
            "elsewhere (e.g. OTC Markets). Fundamentals and the analyst " +
            "opinion below reflect that old filing, not current reality.";
          staleEl.hidden = false;
        } else {
          staleEl.hidden = true;
        }
      }

      var logo = $("co-logo");
      if (c.logo_url) { logo.src = c.logo_url; logo.hidden = false; logo.onerror = function () { logo.hidden = true; }; }
      else logo.hidden = true;

      var px = (m.close !== null && m.close !== undefined) ? m.close : m.currentPrice;
      $("px").textContent = px !== null && px !== undefined ? "$" + Number(px).toFixed(px < 1 ? 4 : 2) : "—";
      var ch = $("px-change");
      if (m.change2d && m.change2d.pct !== null && m.change2d.pct !== undefined) {
        ch.textContent = fmtPct(m.change2d.pct) +
          (m.change2d.vsDate ? " vs " + fmtDate(m.change2d.vsDate) : " vs prev close");
        ch.className = "delta " + cls(m.change2d.pct);
      } else { ch.textContent = "—"; ch.className = "delta flat"; }
      var asofPx = Number(m.currentPrice || px);
      var asofEl = $("px-asof");
      asofEl.textContent = m.asOf
        ? (d.liveQuoteAt
            ? "Live quote · As of " + fmtDate(m.asOf)
            : "As of " + fmtDate(m.asOf) + " · OHLC Avg $" + asofPx.toFixed(asofPx < 1 ? 4 : 2))
        : "";
      asofEl.classList.toggle("live", !!(m.asOf && d.liveQuoteAt));

      var facts = [
        ["Market Cap", money(m.marketCap)],
        ["Shares Outstanding", count(d.shares && d.shares.outstanding)],
        ["Float", count(c.float_shares)],
        ["Reporting Period", (d.period && d.period.label) || "—"]
      ];
      $("hero-facts").innerHTML = facts.map(function (f) {
        return "<div><dt>" + f[0] + "</dt><dd class='num'>" + f[1] + "</dd></div>";
      }).join("");
    }

    /* ---------- KPI strip ---------- */
    function renderKpis(d) {
      var bs = d.fundamentals.balanceSheet, cf = d.fundamentals.cashFlow, burn = d.fundamentals.burnRate;
      var per = d.period && d.period.fiscalPeriod;
      var currentRatio = MX.currentRatio(bs.currentAssets.q, bs.currentLiabilities.q);
      var runway = MX.runwayMonths(bs.cash.q, cf.cfOps.q, per);

      function sub(curV, prevV) {
        var p = pctChange(curV, prevV);
        if (p === null) return { v: "No Comparison", c: "" };
        return { v: fmtPct(p) + " vs " + d.period.compareLabel, c: cls(p) };
      }
      var kpis = [
        { lbl: "Cash & Equivalents", val: money(bs.cash.q), s: sub(bs.cash.q, bs.cash.ly) },
        { lbl: "Working Capital", val: money(bs.workingCapital.q), s: sub(bs.workingCapital.q, bs.workingCapital.ly) },
        { lbl: "Operating Cash Flow", val: money(cf.cfOps.q), s: sub(cf.cfOps.q, cf.cfOps.ly) },
        /* a positive month is not "burn" — say what the number actually is */
        { lbl: burn.q && burn.q.monthlyBurn !== null && burn.q.monthlyBurn !== undefined && burn.q.monthlyBurn >= 0
            ? "Monthly Net Cash" : "Monthly Burn",
          val: "—", burnKpi: true,
          raw: burn.q ? burn.q.monthlyBurn : null,
          s: { v: burn.q && burn.q.monthlyBurn < 0 ? "Net Outflow" : "Net Inflow (Financing)", c: burn.q && burn.q.monthlyBurn < 0 ? "down" : "" } },
        { lbl: "Current Ratio", val: currentRatio !== null ? currentRatio.toFixed(2) + "×" : "—",
          s: { v: runway !== null ? "≈ " + runway.toFixed(1) + " mo runway on op. burn" : "Cash-positive — runway not applicable", c: "" } }
      ];
      $("kpis").innerHTML = kpis.map(function (k) {
        var val = k.burnKpi && k.raw !== null && k.raw !== undefined
          ? (k.raw < 0 ? "−$" : k.raw > 0 ? "+$" : "$") + money(Math.abs(k.raw)).replace("$", "") : k.val;
        return "<div class='kpi'><span class='lbl'>" + k.lbl + "</span>" +
               "<output class='val num'>" + val + "</output>" +
               "<span class='sub " + (k.s.c || "") + "'>" + k.s.v + "</span></div>";
      }).join("");
    }

    /* ---------- chart ---------- */
    var NS = "http://www.w3.org/2000/svg";
    function el(name, attrs) {
      var n = document.createElementNS(NS, name);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    }
    function fmtAxisPrice(v, hi) {
      return "$" + v.toFixed(hi < 1 ? 4 : hi < 100 ? 2 : 0);
    }
    function renderChart(d) {
      var box = $("chart");
      if (!box) return;
      if (!d || !d.price || !d.price.series) {
        box.innerHTML = "";
        var p = document.createElement("p");
        p.className = "chart-empty" + (liveLoading[state.ticker] ? " pulse" : "");
        p.textContent = liveLoading[state.ticker]
          ? "Loading live price history…"
          : "Price history is not available for this ticker from the connected market-data providers.";
        box.appendChild(p);
        return;
      }
      var series = state.range === "30d" ? (d.price.series30 || d.price.series) : d.price.series;
      if (!series || !series.length) { box.textContent = "No price history available."; return; }

      var W = Math.max(280, box.clientWidth || 720);
      var padL = 56, padR = 56, padT = 20, padB = 26;
      var n = series.length;
      var slot = (W - padL - padR) / n;
      var H = state.range === "30d" ? 220 : 240;
      var iw = W - padL - padR, ih = H - padT - padB;

      var closes = series.map(function (s) { return s.close; });
      var vals = series.map(function (s) { return s.valueTraded || 0; });
      var maxP = Math.max.apply(null, closes) || 1;
      var minP = Math.min.apply(null, closes);
      var maxV = Math.max.apply(null, vals) || 1;
      /* price axis fits the traded range so the trend shape stays visible;
         value-traded bars remain zero-based on the shared grid */
      var span = maxP - minP;
      var pPad = span > 0 ? span * 0.08 : (maxP || 1) * 0.02;
      var pLo = Math.max(0, minP - pPad), pHi = maxP + pPad;
      if (pHi <= pLo) pHi = pLo + 1;
      var vTop = maxV * 1.05;

      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "presentation" });
      function X(i) { return padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw); }
      function Y(p) { return padT + ih * (1 - (p - pLo) / (pHi - pLo)); }

      /* shared gridlines: left labels = value traded (zero-based), right = fitted price */
      var levels = 5;
      for (var g = 0; g <= levels; g++) {
        var f = g / levels, gy = padT + ih * (1 - f);
        svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: CH_BRD, "stroke-width": g === 0 ? 1 : 0.7 }));
        var lv = el("text", { x: padL - 6, y: gy + 3, "text-anchor": "end", "font-size": "10", fill: CH_MUT });
        lv.textContent = f === 0 ? "$0" : money(vTop * f);
        svg.appendChild(lv);
        var rv = el("text", { x: W - padR + 8, y: gy + 3, "text-anchor": "start", "font-size": "10", fill: CH_MUT });
        rv.textContent = fmtAxisPrice(pLo + (pHi - pLo) * f, pHi);
        svg.appendChild(rv);
      }

      /* value bars: near-black columns with a hairline outline */
      var bw = Math.max(2, Math.min(14, slot * 0.55));
      series.forEach(function (s, i) {
        var bh = (s.valueTraded || 0) / vTop * ih;
        svg.appendChild(el("rect", { x: X(i) - bw / 2, y: padT + ih - bh, width: bw, height: Math.max(0.5, bh), fill: CH_BAR, rx: 1 }));
      });

      /* price line (gold-ink); point markers only while they stay legible */
      var path = closes.map(function (p, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p).toFixed(1); }).join(" ");
      svg.appendChild(el("path", { d: path, fill: "none", stroke: CH_LINE, "stroke-width": 1.8, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      if (n <= 40) {
        series.forEach(function (s, i) {
          svg.appendChild(el("circle", { cx: X(i), cy: Y(s.close), r: 1.6, fill: CH_LINE, stroke: CH_LINE, "stroke-width": 1.2 }));
        });
      }

      /* last point + direct label (kept clear of the right axis) */
      var li = closes.length - 1, lx = X(li), ly = Y(closes[li]);
      svg.appendChild(el("circle", { cx: lx, cy: ly, r: 3, fill: CH_LINE }));
      var labelRight = lx + 48 <= W - padR;
      var lt = el("text", { x: labelRight ? lx + 7 : lx - 7, y: ly + 3, "text-anchor": labelRight ? "start" : "end", "font-size": "11", "font-weight": "500", fill: CH_LINE });
      lt.textContent = "$" + closes[li].toFixed(closes[li] < 1 ? 4 : 2);
      svg.appendChild(lt);

      /* series legend */
      var lastV = series[li].valueTraded || 0;
      svg.appendChild(el("line", { x1: padL + 2, x2: padL + 16, y1: padT - 6, y2: padT - 6, stroke: CH_LINE, "stroke-width": 1.8, "stroke-linecap": "round" }));
      var lg1 = el("text", { x: padL + 20, y: padT - 3, "font-size": "10", fill: CH_MUT });
      lg1.textContent = "Close Price";
      svg.appendChild(lg1);
      var lg2x = padL + 88;
      svg.appendChild(el("rect", { x: lg2x, y: padT - 11, width: 8, height: 8, fill: CH_BAR, rx: 1 }));
      var lg2 = el("text", { x: lg2x + 12, y: padT - 3, "font-size": "10", fill: CH_MUT });
      lg2.textContent = "Value Traded (last " + money(lastV) + ")";
      svg.appendChild(lg2);

      /* horizontal date labels, thinned to fit; ticks mark the labeled days */
      var step = Math.max(1, Math.ceil(56 / slot));
      series.forEach(function (s, i) {
        if (i % step) return;
        var parts = String(s.date).split("-");
        if (parts.length < 3) return;
        var tx = X(i);
        if (tx > W - padR - 14) return;
        svg.appendChild(el("line", { x1: tx, x2: tx, y1: padT + ih, y2: padT + ih + 3, stroke: CH_BRD, "stroke-width": 1 }));
        var dt = el("text", { x: tx, y: padT + ih + 14, "text-anchor": "middle", "font-size": "9", fill: CH_MUT });
        dt.textContent = Number(parts[1]) + "/" + Number(parts[2]);
        svg.appendChild(dt);
      });

      box.innerHTML = "";
      box.appendChild(svg);
      attachChartHover(box, svg, series, {
        X: X, Y: Y, W: W, padL: padL, padR: padR, padT: padT, ih: ih
      });
      box.setAttribute("aria-label", "Close price " + fmtDate(series[0].date) + " to " + fmtDate(series[li].date) +
        ", range " + fmtAxisPrice(minP, pHi) + " to " + fmtAxisPrice(maxP, pHi) +
        ", last $" + closes[li].toFixed(closes[li] < 1 ? 4 : 2) +
        "; daily value traded up to " + money(maxV) + ", last " + money(lastV) +
        ". Hover or tap the chart for daily values.");
    }

    /* the terminal readout: crosshair + ink chip following the pointer */
    function attachChartHover(box, svg, series, gm) {
      var n = series.length;
      var xline = el("line", { y1: gm.padT, y2: gm.padT + gm.ih, stroke: CH_XHAIR, "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden" });
      var dot = el("circle", { r: 3.4, fill: CH_LINE, stroke: CH_GROUND, "stroke-width": 1.4, visibility: "hidden" });
      svg.appendChild(xline);
      svg.appendChild(dot);
      var tip = document.createElement("div");
      tip.className = "chart-tip";
      tip.hidden = true;
      box.appendChild(tip);
      var lastIdx = -1;

      function hide() {
        lastIdx = -1;
        tip.hidden = true;
        xline.setAttribute("visibility", "hidden");
        dot.setAttribute("visibility", "hidden");
      }
      function show(ev) {
        var rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        var scale = rect.width / gm.W;
        var xv = (ev.clientX - rect.left) / scale;
        var i = n === 1 ? 0 : Math.round((xv - gm.padL) / (gm.W - gm.padL - gm.padR) * (n - 1));
        i = Math.max(0, Math.min(n - 1, i));
        var s = series[i];
        var sx = gm.X(i), sy = gm.Y(s.close);
        xline.setAttribute("x1", sx); xline.setAttribute("x2", sx);
        xline.setAttribute("visibility", "visible");
        dot.setAttribute("cx", sx); dot.setAttribute("cy", sy);
        dot.setAttribute("visibility", "visible");
        if (i !== lastIdx) {
          lastIdx = i;
          var prev = i ? series[i - 1] : null;
          var chg = prev && prev.close ? (s.close / prev.close - 1) * 100 : null;
          tip.innerHTML =
            "<div class='tip-date'>" + fmtDate(s.date) + "</div>" +
            "<div class='tip-px'>$" + s.close.toFixed(s.close < 1 ? 4 : 2) +
            (chg === null ? "" : "<span class='tip-chg " + cls(chg) + "'>" + fmtPct(chg) + "</span>") +
            "</div>" +
            "<div class='tip-row'><span>Value traded</span><span>" + money(s.valueTraded || 0) + "</span></div>" +
            "<div class='tip-row'><span>Volume</span><span>" + count(s.volume) + "</span></div>";
        }
        tip.hidden = false;
        var bx = sx * scale;
        var tw = tip.offsetWidth, th = tip.offsetHeight;
        var leftPx = bx + 12;
        if (leftPx + tw > rect.width - 4) leftPx = bx - tw - 12;
        if (leftPx < 4) leftPx = 4;
        var topPx = sy * scale - th - 10;
        if (topPx < 2) topPx = sy * scale + 14;
        tip.style.left = leftPx + "px";
        tip.style.top = topPx + "px";
      }
      svg.addEventListener("pointermove", show);
      svg.addEventListener("pointerdown", show);
      svg.addEventListener("pointerleave", hide);
    }

    /* ---------- fundamentals ---------- */
    function renderFundamentals(d) {
      var f = d.fundamentals, p = d.period;
      var bs = f.balanceSheet, is = f.incomeStatement, cf = f.cashFlow, bn = f.burnRate;
      var headCur = p.label, headPrev = p.compareLabel, deltaHead = "Δ";
      var pctLbl = $("pct-lbl");
      if (pctLbl) pctLbl.textContent = "% Change vs " + (p.compareLabel || "Comparison Period");

      function rowBS(label, pair) {
        if (state.pct) {
          var pc = pctChange(pair.q, pair.ly);
          return [label, { v: money(pair.q), c: pair.q === null ? "na" : "" }, pc === null ? { v: "—", c: "na" } : { v: fmtPct(pc), c: cls(pc) }];
        }
        return [label, { v: money(pair.q), c: pair.q === null || pair.q === undefined ? "na" : "" },
                       { v: money(pair.ly), c: pair.ly === null || pair.ly === undefined ? "na" : "" }];
      }
      fillTable($("t-bs"), ["Balance Sheet", headCur, state.pct ? deltaHead : headPrev], [
        rowBS("Cash & Equivalents", bs.cash),
        rowBS("Current Assets", bs.currentAssets),
        rowBS("Current Liabilities", bs.currentLiabilities),
        rowBS("Working Capital", bs.workingCapital),
        rowBS("Total Assets", bs.totalAssets),
        rowBS("Total Liabilities", bs.totalLiabilities),
        rowBS("Equity", bs.equity),
        rowBS("Retained Earnings", bs.retainedEarnings)
      ]);

      $("h-is").textContent = "Income Statement — " + (p.isLabel || p.label);
      function rowIS(label, pair, isPctVal) {
        var cur = pair.q, prev = pair.fy;
        var fmt = isPctVal ? function (v) { return v === null || v === undefined ? "—" : v.toFixed(1) + "%"; } : money;
        if (state.pct && !isPctVal) {
          var pc = pctChange(cur, prev);
          return [label, { v: fmt(cur), c: cur === null ? "na" : "" }, pc === null ? { v: "—", c: "na" } : { v: fmtPct(pc), c: cls(pc) }];
        }
        return [label, { v: fmt(cur), c: cur === null || cur === undefined ? "na" : "" },
                       { v: fmt(prev), c: prev === null || prev === undefined ? "na" : "" }];
      }
      fillTable($("t-is"), ["Income", p.isLabel || p.label, state.pct ? deltaHead : (p.isCompareLabel || headPrev)], [
        rowIS("Revenue", is.revenue),
        rowIS("Cost of Goods Sold", is.cogs),
        rowIS("Gross Profit", is.grossProfit),
        rowIS("Gross Margin", is.grossMarginPct, true),
        rowIS("Net Income", is.netIncome)
      ]);

      fillTable($("t-cf"), ["Cash Flow", p.label, state.pct ? deltaHead : headPrev], [
        rowBS("Operations", cf.cfOps),
        rowBS("Investing", cf.cfInv),
        rowBS("Financing", cf.cfFin),
        rowBS("Net Cash Change", cf.netCashChange)
      ]);

      function burnDays(v) {
        if (v === null || v === undefined) return { v: "—", c: "na" };
        if (typeof v === "string") return { v: v === "Infinite" ? "Cash-Positive Qtr" : v, c: "" };
        return { v: Math.round(v) + " days", c: "" };
      }
      fillTable($("t-burn"), ["Burn", p.label, headPrev], [
        ["Net Cash Change", { v: money(bn.q && bn.q.netCashChange), c: "" }, { v: money(bn.ly && bn.ly.netCashChange), c: "" }],
        ["Monthly Burn",
          bn.q && bn.q.monthlyBurn !== null && bn.q.monthlyBurn !== undefined ? { v: (bn.q.monthlyBurn < 0 ? "−$" : "$") + money(Math.abs(bn.q.monthlyBurn)).replace("$", ""), c: bn.q.monthlyBurn < 0 ? "down" : "" } : { v: "—", c: "na" },
          bn.ly && bn.ly.monthlyBurn !== null && bn.ly.monthlyBurn !== undefined ? { v: (bn.ly.monthlyBurn < 0 ? "−$" : "$") + money(Math.abs(bn.ly.monthlyBurn)).replace("$", ""), c: bn.ly.monthlyBurn < 0 ? "down" : "" } : { v: "—", c: "na" }],
        ["Cash Runway", burnDays(bn.q && bn.q.remainingCashDays), burnDays(bn.ly && bn.ly.remainingCashDays)]
      ]);
    }

    /* ---------- ratios ---------- */
    function renderRatios(d) {
      var bs = d.fundamentals.balanceSheet, cf = d.fundamentals.cashFlow, e = d.earnings || {};
      var rows = [];
      var per = d.period && d.period.fiscalPeriod;
      var cr = MX.currentRatio(bs.currentAssets.q, bs.currentLiabilities.q);
      var la = MX.liabilitiesToAssets(bs.totalLiabilities.q, bs.totalAssets.q);
      var runway = MX.runwayMonths(bs.cash.q, cf.cfOps.q, per);
      rows.push(["Current Ratio", cr !== null ? cr.toFixed(2) + "×" : "—"]);
      rows.push(["Liabilities / Assets", la !== null ? la.toFixed(2) + "×" : "—"]);
      rows.push(["Cash Runway (Op. Burn)", runway !== null ? "≈ " + runway.toFixed(1) + " months" : "Not applicable — operations generate cash"]);
      rows.push(["Working Capital", money(bs.workingCapital.q)]);
      rows.push(["Equity Position", money(bs.equity.q)]);
      fillTable($("t-ratios"), ["Ratio", d.period.label], rows);

      function eps(v) { return v === null || v === undefined ? { v: "—", c: "na" } : { v: (v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(4), c: "" }; }
      fillTable($("t-eps"), ["EPS", d.period.label, d.period.compareLabel], [
        ["Filed", eps(e.epsFiled && e.epsFiled.q), eps(e.epsFiled && e.epsFiled.ly)],
        ["Computed", eps(e.epsComputed && e.epsComputed.q), eps(e.epsComputed && e.epsComputed.ly)]
      ]);
      var note = $("eps-note");
      if (e.estimateNote) { note.textContent = e.estimateNote; note.hidden = false; } else note.hidden = true;
    }

    /* ---------- volume & liquidity ---------- */
    function renderLiquidity(d) {
      if (!d.price || !d.price.series) {
        fillTable($("t-vol"), ["Activity", "30-Day", "60-Day", "90-Day"], [
          [{ v: liveLoading[state.ticker] ? "Loading live trading data…" : "No trading activity feed available for this ticker", c: "na" }, "", "", ""]
        ]);
        fillTable($("t-liq"), ["Position", "30-Day Avg", "60-Day Avg", "90-Day Avg"], [
          [{ v: "No liquidation estimates available", c: "na" }, "", "", ""]
        ]);
        return;
      }
      var vs = d.price.volumeStats || {}, vals = d.price.valueStats || {};
      fillTable($("t-vol"), ["Activity", "30-Day", "60-Day", "90-Day"], [
        ["Avg Volume", count(vs.avg30), count(vs.avg60), count(vs.avg90)],
        ["Avg Value Traded", money(vals.avg30), money(vals.avg60), money(vals.avg90)],
        ["30-Day Volume Range", count(vs.min30) + " – " + count(vs.max30), { v: "", c: "" }, { v: "", c: "" }]
      ]);
      var rows = [];
      function fmtDays(days) {
        if (days === null || days === undefined || isNaN(days)) return "—";
        if (days >= 1) return days.toFixed(1) + " days";
        var hrs = days * 6.5; /* trading hours per day */
        if (hrs >= 0.1) return hrs.toFixed(1) + " hrs";
        return Math.max(1, Math.round(hrs * 60)) + " min";
      }
      function posLabel(v) {
        return money(v).replace(/\.(\d*?)0+([KMBT])$/, function (_, dgt, unit) {
          return (dgt ? "." + dgt : "") + unit;
        }).replace(".00", "");
      }
      (d.price.liquidation || []).forEach(function (grp) {
        rows.push({ group: Math.round((grp.pct || 0) * 100) + "% of daily value traded" });
        (grp.rows || []).forEach(function (r) {
          rows.push([
            posLabel(r.amount) + " position",
            r.d30 ? fmtDays(r.d30.days) : "—",
            r.d60 ? fmtDays(r.d60.days) : "—",
            r.d90 ? fmtDays(r.d90.days) : "—"
          ]);
        });
      });
      if (!rows.length) rows.push([{ v: "No liquidation estimates available", c: "na" }, "", "", ""]);
      fillTable($("t-liq"), ["Position", "30-Day Avg", "60-Day Avg", "90-Day Avg"], rows);
    }

    /* ---------- analyst notes & news ---------- */
    function esc(s) {
      return String(s === null || s === undefined ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    function renderNotes(d) {
      var live = d.liveInsight || null;
      var ds = d.researchNote || null;
      var blocks = [], newsItems = [];

      if (live && live.analyst) {
        var a = live.analyst;
        blocks.push(["Analyst Consensus" + (a.period ? " · " + a.period.slice(0, 7) : ""),
          "Strong Buy " + (a.strongBuy || 0) + "  ·  Buy " + (a.buy || 0) +
          "  ·  Hold " + (a.hold || 0) + "  ·  Sell " + (a.sell || 0) +
          "  ·  Strong Sell " + (a.strongSell || 0)]);
      }

      if (ds && ds.company_needs) {
        var nd = ds.company_needs;
        /* Company Overview is one cohesive narrative (direction + plans);
           fall back to joining the legacy two fields for cached payloads. */
        var overview = nd.company_overview ||
          [nd.general_direction, nd.plans].filter(Boolean).join(" ");
        [["Company Overview", overview],
         ["Uses of Funds", nd.uses_of_funds],
         ["Sources of Funds", nd.sources_of_funds],
         ["Financing Need", nd.financing_need]].forEach(function (p) {
          if (p[1]) blocks.push([p[0], p[1]]);
        });
        newsItems = (ds.picked_news || []).map(function (n) {
          return { date: n.date, source: n.source, title: n.title,
                   relevance: n.relevance };
        });
      }

      if (!ds) {
        if (live && live.priceTarget) {
          var pt = live.priceTarget;
          blocks.push(["Analyst Price Target",
            "Mean $" + Number(pt.mean).toFixed(2) +
            (pt.low != null && pt.high != null
              ? " · range $" + Number(pt.low).toFixed(2) + " – $" + Number(pt.high).toFixed(2) : "") +
            (pt.analysts ? " · " + pt.analysts + " analysts" : "") +
            (pt.updated ? " · updated " + fmtDate(String(pt.updated).slice(0, 10)) : "")]);
        }
        var ins = d.insight || {}, needs = ins.company_needs || {};
        var insOverview = needs.company_overview ||
          [needs.general_direction, needs.plans].filter(Boolean).join(" ");
        if (insOverview) blocks.push(["Company Overview", insOverview]);
        if (needs.financing_need) blocks.push(["Financing Need", needs.financing_need]);
        if (needs.sources_of_funds) blocks.push(["Sources of Funds", needs.sources_of_funds]);
        newsItems = ((live && live.news) || ins.news || []).slice(0, 5);
      }

      var bodyHtml = blocks.map(function (b) {
        return "<p class='note-block'><span class='tag'>" + b[0] + "</span>" + esc(b[1]) + "</p>";
      }).join("");
      /* The panel status must stay visible even when fallback blocks
         (consensus, price target) rendered — otherwise a failed or
         pending note is silently masked by live data. */
      var statusHtml = "";
      if (analysisError[state.ticker]) {
        /* visible even when stale content is on screen — failures must
           never be masked */
        statusHtml = "<p class='note-block na' role='status'>The research note for " +
          esc(state.ticker) + " could not be prepared (" +
          esc(analysisError[state.ticker]) + "). " +
          "<button type='button' class='retry-btn' " +
          "data-act='retry-analysis'>Try again</button></p>";
      } else if (!ds) {
        if (analysisLoading[state.ticker]) {
          statusHtml = "<p class='note-block na pulse' role='status'>Preparing the " +
            esc(state.ticker) + " research note from its latest filing…</p>";
        } else if (liveLoading[state.ticker]) {
          statusHtml = "<p class='note-block na pulse' role='status'>Loading market data…</p>";
        } else if (!bodyHtml) {
          statusHtml = "<p class='note-block na'>No research note available " +
            "for this ticker.</p>";
        }
      }
      $("notes-body").innerHTML = statusHtml + bodyHtml;

      var spikeLinked = {};
      if (ds && ds.spike_analysis) {
        ds.spike_analysis.forEach(function (s) {
          (s.news || []).forEach(function (n) {
            if (n.title) spikeLinked[n.title] = true;
          });
        });
      }
      $("news").innerHTML = newsItems.map(function (n) {
        var tag = spikeLinked[n.title] ? "<span class='spike-tag'>Spike-linked</span>" : "";
        return "<li>" + tag +
               "<span class='n-meta'><span>" + fmtDate(n.date) + "</span><span>·</span><span>" + esc(n.source || "") + "</span></span>" +
               "<p class='n-title'>" + esc(n.title) + "</p>" +
               (n.relevance ? "<p class='n-rel'>" + esc(n.relevance) + "</p>" : "") + "</li>";
      }).join("") || "<li><p class='n-title na'>No recent news items.</p></li>";

      /* Methodology line. Names the filing the note is built on and the
         period covered — what a reader needs to judge it — without naming
         any upstream vendor. */
      var cav = $("caveats");
      var basis = d.latestFiling && d.latestFiling.form
        ? d.latestFiling.form + " filed " + fmtDate(d.latestFiling.date)
        : "the latest 10-K/10-Q";
      if (ds) {
        cav.textContent = "Method: prepared from the company's " + basis +
          ", its trading activity, and six months of headlines. Figures are " +
          "as reported; derived ratios are computed from them. Not " +
          "investment advice." +
          (ds.caveats ? " Limitations: " + ds.caveats : "");
        cav.hidden = false;
      } else if (!live && d.insight && d.insight.caveats) {
        cav.textContent = "Limitations: " + d.insight.caveats;
        cav.hidden = false;
      } else if (live) {
        cav.textContent = "Market data and headlines update through the " +
          "trading day. Not investment advice.";
        cav.hidden = false;
      } else cav.hidden = true;
    }

    /* ---------- footer ---------- */
    function renderFooter(d) {
      var gen = d.generatedAt ? fmtDate(d.generatedAt.slice(0, 10)) : "—";
      var asOf = d.price && d.price.market && d.price.market.asOf ? fmtDate(d.price.market.asOf) : "—";
      var txt =
        "Fundamentals from SEC EDGAR filings · updated " + gen +
        " · prices as of " + asOf +
        ". Derived ratios are computed from reported figures.";
      if (d.liveQuoteAt) {
        txt += " Market data refreshed " + fmtDate(d.liveQuoteAt) + ".";
      }
      var span = $("src-footer-text");
      if (span) span.textContent = txt;
      else $("src-footer").textContent = txt;
    }

    /* ---------- coverage state ---------- */
    function setDataVisible(visible) {
      ["kpis", "chart-panel", "panels", "src-footer", "hero-facts", "hero-price", "stale-warn"].forEach(function (id) {
        var n = $(id); if (n) n.hidden = !visible;
      });
      $("coverage").hidden = visible;
    }
    function renderNoCoverage(meta) {
      $("co-name").textContent = meta.name;
      $("co-meta").innerHTML = "<span class='tk'>" + meta.ticker + "</span> <span class='sep'>·</span> <span class='tk'>CIK " + meta.cik + "</span>";
      $("co-logo").hidden = true;
      setDataVisible(false);
      $("coverage-title").textContent = meta.ticker + " — No Data Pulled Yet";
      $("coverage-text").textContent =
        meta.name + " is not in the exported coverage set. Pull its fundamentals directly from SEC EDGAR — " +
        "it takes a few seconds, then the full overview renders like any covered company.";
      var btn = $("pull-btn");
      if (btn) {
        btn.hidden = false;
        btn.disabled = false;
        btn.textContent = "Pull " + meta.ticker + " Data";
      }
    }
    function pullTicker(ticker) {
      var meta = BY_TICKER[ticker];
      if (!meta) return;
      var btn = $("pull-btn");
      if (btn) { btn.disabled = true; btn.textContent = "Pulling from SEC EDGAR…"; }
      $("coverage-title").textContent = ticker + " — Pulling Data…";
      $("coverage-text").textContent =
        "Fetching " + meta[2] + " fundamentals from SEC EDGAR (10-K/10-Q XBRL facts)…";
      fetch("/api/pull?ticker=" + encodeURIComponent(ticker) +
            "&cik=" + encodeURIComponent(meta[1]) +
            "&name=" + encodeURIComponent(meta[2]))
        .then(function (r) {
          return r.json().then(function (body) {
            if (!r.ok) {
              throw new Error(body && body.error ? body.error
                : "SEC pull failed (HTTP " + r.status + ")");
            }
            return body;
          });
        })
        .then(function (d) {
          if (btn) btn.hidden = true;
          COVERAGE[ticker] = d;
          COVERED[ticker] = true;
          if (state.ticker === ticker) renderAll(d);
          fetchLive(ticker);
        })
        .catch(function (err) {
          $("coverage-title").textContent = ticker + " — Pull Failed";
          $("coverage-text").textContent =
            String(err && err.message ? err.message : err) +
            " You can retry — SEC EDGAR rate-limits bursts.";
          if (btn) { btn.disabled = false; btn.textContent = "Retry Pull"; }
        });
    }
    function renderLoading(ticker) {
      var meta = BY_TICKER[ticker];
      if (meta) {
        $("co-name").textContent = meta[2];
        $("co-meta").innerHTML = "<span class='tk'>" + meta[0] + "</span> <span class='sep'>·</span> <span class='tk'>CIK " + meta[1] + "</span>";
        $("co-logo").hidden = true;
      }
      setDataVisible(false);
      $("coverage-title").textContent = ticker + " — Loading…";
      $("coverage-text").textContent = "Fetching fundamentals exported from finance_db.";
    }
    function loadCompany(ticker) {
      if (loading[ticker]) return;
      loading[ticker] = true;
      var s = document.createElement("script");
      s.src = "data/company-" + ticker.toLowerCase() + ".js";
      s.onload = function () {
        delete loading[ticker];
        COVERAGE[ticker] = window.COMPANY_OVERVIEW_DATA || null;
        window.COMPANY_OVERVIEW_DATA = null;
        if (state.ticker !== ticker || !COVERAGE[ticker]) return;
        if (LIVE[ticker]) applyLive(ticker, LIVE[ticker]);
        else { renderAll(COVERAGE[ticker]); fetchLive(ticker); }
      };
      s.onerror = function () {
        delete loading[ticker];
        COVERED[ticker] = false;
        if (state.ticker === ticker) {
          var meta = BY_TICKER[ticker];
          if (meta) renderNoCoverage({ ticker: meta[0], cik: meta[1], name: meta[2] });
        }
      };
      document.head.appendChild(s);
    }
    function renderAll(d) {
      setDataVisible(true);
      renderHero(d);
      renderKpis(d);
      renderChart(d);
      renderFundamentals(d);
      renderRatios(d);
      renderLiquidity(d);
      renderNotes(d);
      renderFooter(d);
    }
    /* ---------- URL + title state (shareable deep links) ---------- */
    function urlTicker() {
      var m = location.search.match(/[?&]t=([A-Za-z0-9.\-]+)/);
      return m ? decodeURIComponent(m[1]).toUpperCase() : null;
    }
    function syncUrl(ticker, push) {
      var url = location.pathname + "?t=" + encodeURIComponent(ticker);
      try {
        (push ? history.pushState : history.replaceState)
          .call(history, { t: ticker }, "", url);
      } catch (e) { /* file:// and sandboxed contexts */ }
    }
    function setTitle(ticker) {
      var meta = BY_TICKER[ticker];
      document.title = ticker + (meta ? " · " + meta[2] : "") + " — Research Terminal";
    }

    function select(ticker, opts) {
      opts = opts || {};
      state.ticker = ticker;
      setTitle(ticker);
      if (opts.nav !== false) syncUrl(ticker, opts.push === true);
      var d = COVERAGE[ticker];
      if (d) { renderAll(d); fetchLive(ticker); return; }
      var meta = BY_TICKER[ticker];
      if (!meta) return;
      if (COVERED[ticker]) {
        renderLoading(ticker);
        loadCompany(ticker);
        fetchLive(ticker);
      }
      else renderNoCoverage({ ticker: meta[0], cik: meta[1], name: meta[2] });
    }
    window.addEventListener("popstate", function () {
      var t = urlTicker() || "KBLB";
      if (t !== state.ticker && (BY_TICKER[t] || COVERAGE[t])) {
        var meta = BY_TICKER[t];
        q.value = meta ? t + " — " + meta[2] : t;
        select(t, { nav: false });
      }
    });

    /* ---------- live market data (per-company API pull) ---------- */
    var LIVE = {}, liveLoading = {};

    function tailAvg(xs, n) {
      var w = xs.length >= n ? xs.slice(xs.length - n) : xs.slice();
      if (!w.length) return null;
      var s = 0; for (var i = 0; i < w.length; i++) s += w[i];
      return s / w.length;
    }
    /* port of the exporter's price_block: same shape, same formulas */
    function priceBlockFromCandles(candles, shares) {
      var series = candles.map(function (p) {
        var ohlcAvg = (p.open + p.high + p.low + p.close) / 4;
        return { date: p.date, ohlcAvg: ohlcAvg, close: p.close,
                 volume: p.volume, valueTraded: ohlcAvg * p.volume };
      });
      var vols = series.map(function (s) { return s.volume; });
      var vals = series.map(function (s) { return s.valueTraded; });
      var v30 = vols.slice(-30), val30 = vals.slice(-30);
      var volumeStats = {
        avg30: tailAvg(vols, 30), avg60: tailAvg(vols, 60), avg90: tailAvg(vols, 90),
        min30: v30.length ? Math.min.apply(null, v30) : null,
        max30: v30.length ? Math.max.apply(null, v30) : null
      };
      var valueStats = {
        avg30: tailAvg(vals, 30), avg60: tailAvg(vals, 60), avg90: tailAvg(vals, 90),
        min30: val30.length ? Math.min.apply(null, val30) : null,
        max30: val30.length ? Math.max.apply(null, val30) : null,
        daysUnder5k30: val30.filter(function (v) { return v < 5000; }).length
      };
      function liq(amount, pct, n) {
        var a = tailAvg(vals, n);
        if (!a) return null;
        var days = amount / (pct * a);
        return { days: Math.round(days * 1000) / 1000, months: Math.round(days / 21 * 10) / 10 };
      }
      /* position tiers scale with the company's liquidity — micro-cap
         defaults (100K/50K/25K) are meaningless for mega-caps */
      var avgV = tailAvg(vals, 90) || 0;
      var amounts = avgV >= 1e9 ? [50e6, 25e6, 10e6]
        : avgV >= 1e8 ? [10e6, 5e6, 2.5e6]
        : avgV >= 1e7 ? [1e6, 5e5, 2.5e5]
        : [1e5, 5e4, 2.5e4];
      var liquidation = [0.3, 0.2, 0.1].map(function (pct) {
        return { pct: pct, rows: amounts.map(function (amount) {
          return { amount: amount, d30: liq(amount, pct, 30),
                   d60: liq(amount, pct, 60), d90: liq(amount, pct, 90) };
        }) };
      });
      var latest = series[series.length - 1];
      var base2 = series.length >= 3 ? series[series.length - 3]
        : (series.length >= 2 ? series[series.length - 2] : null);
      var price = latest.ohlcAvg;
      return {
        series: series, series30: series.slice(-22),
        volumeStats: volumeStats, valueStats: valueStats,
        liquidation: liquidation,
        market: {
          asOf: latest.date, currentPrice: price, close: latest.close,
          change2d: base2 ? {
            abs: price - base2.ohlcAvg,
            pct: (price / base2.ohlcAvg - 1) * 100,
            vsDate: base2.date
          } : { abs: null, pct: null, vsDate: null },
          marketCap: shares ? price * shares : null,
          shares499: shares ? 0.0499 * shares : null,
          value499: shares ? 0.0499 * shares * price : null
        }
      };
    }

    function applyLive(ticker, live) {
      var d = COVERAGE[ticker];
      if (!d) return;
      var prof = live.profile || {};
      var shares = prof.sharesOutstanding ||
        (d.shares && d.shares.outstanding) || null;
      var q = live.quote || null;

      if (live.candles && live.candles.length) {
        d.price = priceBlockFromCandles(live.candles, shares);
        d.price.liveSource = live.candleSource || null;
      }
      if (d.price && q) {
        var m = d.price.market = d.price.market || {};
        m.currentPrice = q.price;
        m.close = q.price;
        m.asOf = q.time || (live.asOf || "").slice(0, 10) || m.asOf;
        if (q.changePct !== null && q.changePct !== undefined) {
          m.change2d = { abs: q.changeAbs, pct: q.changePct, vsDate: null };
        }
      }
      if (d.price && d.price.market) {
        if (prof.marketCap) d.price.market.marketCap = prof.marketCap;
        else if (d.price.market.marketCap == null && shares &&
                 d.price.market.close) {
          d.price.market.marketCap = shares * d.price.market.close;
        }
      }
      if (!d.price && q) {
        d.price = { series: null, series30: null,
                    market: { asOf: q.time || (live.asOf || "").slice(0, 10),
                              currentPrice: q.price, close: q.price,
                              change2d: { abs: q.changeAbs, pct: q.changePct, vsDate: null },
                              marketCap: prof.marketCap ||
                                (shares ? shares * q.price : null) } };
      }
      if (prof.floatShares) d.company.float_shares = prof.floatShares;
      if (prof.sharesOutstanding) {
        d.shares = d.shares || {};
        d.shares.outstanding = prof.sharesOutstanding;
      }
      if (prof.logo && !d.company.logo_url) d.company.logo_url = prof.logo;
      if (prof.industry && !d.company.industry) d.company.industry = prof.industry;
      d.liveCandleSource = live.candleSource || null;
      if (live.analyst || live.priceTarget || (live.news && live.news.length)) {
        d.liveInsight = { analyst: live.analyst, priceTarget: live.priceTarget,
                          news: live.news || [] };
      }
      d.liveQuoteAt = (live.asOf || "").slice(0, 10) || null;
      if (ANALYSIS[ticker]) d.researchNote = ANALYSIS[ticker];
      if (state.ticker === ticker) renderAll(d);
      fetchAnalysis(ticker);
    }

    function fetchLive(ticker, force) {
      if (!force && LIVE[ticker]) { applyLive(ticker, LIVE[ticker]); return; }
      if (liveLoading[ticker]) return;
      liveLoading[ticker] = true;
      var settle = function (payload) {
        delete liveLoading[ticker];
        if (payload && !payload.error && payload.ticker === ticker) {
          LIVE[ticker] = payload;
          applyLive(ticker, payload);
        } else {
          var d = COVERAGE[ticker];
          if (d && state.ticker === ticker) {
            renderChart(d); renderLiquidity(d); renderNotes(d);
          }
          /* analyst opinion is mandatory — run it even when the live
             market feed failed (evidence falls back to exported data) */
          fetchAnalysis(ticker);
        }
      };
      fetch("/api/market?ticker=" + encodeURIComponent(ticker))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(settle)
        .catch(function () { settle(null); });
    }

    /* ---------- research note (prepared on every company change) ---------- */
    var ANALYSIS = {}, analysisLoading = {}, analysisError = {};

    /* top value-traded days with context — mirrors loaders/09 evidence */
    function computeSpikes(series) {
      if (!series || !series.length) return [];
      return series.map(function (b, i) {
        var prev = i ? series[i - 1] : null;
        var win = series.slice(Math.max(0, i - 20), i)
          .map(function (x) { return x.volume; });
        var avg20 = win.length
          ? win.reduce(function (s, v) { return s + v; }, 0) / win.length
          : null;
        return {
          date: b.date,
          valueTradedUsd: Math.round(b.valueTraded || 0),
          volumeShares: b.volume,
          ohlcAvgUsd: Math.round((b.ohlcAvg || 0) * 10000) / 10000,
          dayChangePct: prev && prev.ohlcAvg
            ? Math.round(((b.ohlcAvg / prev.ohlcAvg) - 1) * 1000) / 10 : null,
          volumeVs20DayAvg: avg20
            ? Math.round((b.volume / avg20) * 10) / 10 : null
        };
      }).sort(function (a, b) {
        return b.valueTradedUsd - a.valueTradedUsd;
      }).slice(0, 5);
    }

    function analysisBody(ticker) {
      var d = COVERAGE[ticker], live = LIVE[ticker] || {};
      var f = d.fundamentals || {};
      var bs = f.balanceSheet || {}, is = f.incomeStatement || {};
      var cf = f.cashFlow || {}, bn = (f.burnRate || {}).q || {};
      var pick = function (o) { return o ? o.q : null; };
      return {
        ticker: ticker,
        name: d.company && d.company.name,
        industry: d.company && d.company.industry,
        period: d.period && d.period.label,
        latestFiling: d.latestFiling || null,
        fundamentals: {
          cash: pick(bs.cash), workingCapital: pick(bs.workingCapital),
          equity: pick(bs.equity),
          revenue: pick(is.revenue), netIncome: pick(is.netIncome),
          grossMarginPct: pick(is.grossMarginPct),
          cfOps: pick(cf.cfOps), cfInv: pick(cf.cfInv), cfFin: pick(cf.cfFin),
          monthlyBurn: bn.monthlyBurn
        },
        marketCap: d.price && d.price.market && d.price.market.marketCap,
        sharesOutstanding: d.shares && d.shares.outstanding,
        spikes: d.price && d.price.series ? computeSpikes(d.price.series) : [],
        news: live.news || [],
        consensus: live.analyst || null
      };
    }

    function fetchAnalysis(ticker, force) {
      var d = COVERAGE[ticker];
      if (!d) return;
      if (ANALYSIS[ticker] && !force) {
        d.researchNote = ANALYSIS[ticker];
        if (state.ticker === ticker) renderNotes(d);
        return;
      }
      if (analysisLoading[ticker]) return;
      analysisLoading[ticker] = true;
      delete analysisError[ticker];
      if (state.ticker === ticker && !d.researchNote) renderNotes(d);
      var settle = function (payload, errMsg) {
        delete analysisLoading[ticker];
        var dd = COVERAGE[ticker];
        if (payload && !payload.error && payload.ticker === ticker) {
          ANALYSIS[ticker] = payload;
          delete analysisError[ticker];
          if (dd) dd.researchNote = payload;
        } else {
          /* surface the failure — the analyst opinion is mandatory, so a
             silent fallback is not acceptable */
          analysisError[ticker] = errMsg ||
            (payload && payload.error) || "provider unavailable";
        }
        if (dd && state.ticker === ticker) renderNotes(dd);
      };
      fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(analysisBody(ticker))
      })
        .then(function (r) {
          return r.json()
            .then(function (body) {
              return r.ok ? body
                : { error: (body && body.error) || ("HTTP " + r.status) };
            })
            .catch(function () {
              return r.ok ? null : { error: "HTTP " + r.status };
            });
        })
        .then(function (body) { settle(body); })
        .catch(function (e) { settle(null, e && e.message); });
    }

    function refreshTicker(ticker) {
      if (!ticker) return;
      var btn = $("refresh-btn");
      if (btn) { btn.disabled = true; btn.textContent = "Refreshing…"; }
      var done = function () {
        if (btn) { btn.disabled = false; btn.textContent = "Refresh"; }
      };
      delete LIVE[ticker];
      delete ANALYSIS[ticker];
      delete analysisError[ticker];
      delete COVERAGE[ticker];
      renderLoading(ticker);
      var s = document.createElement("script");
      s.src = "data/company-" + ticker.toLowerCase() + ".js?v=" + Date.now();
      s.onload = function () {
        COVERAGE[ticker] = window.COMPANY_OVERVIEW_DATA || null;
        window.COMPANY_OVERVIEW_DATA = null;
        if (state.ticker === ticker && COVERAGE[ticker]) {
          renderAll(COVERAGE[ticker]);
        }
        fetchLive(ticker, true);
        setTimeout(done, 800);
      };
      s.onerror = function () { select(ticker); done(); };
      document.head.appendChild(s);
    }

    /* ---------- search ---------- */
    var q = $("q"), rBox = $("results"), rList = $("results-list"), activeIdx = -1, matches = [];
    function findMatches(text) {
      var t = text.trim().toUpperCase();
      if (!t) return [];
      var exactTicker = [], prefix = [], nameHit = [];
      (ALIASES[t] || []).forEach(function (tk) {
        if (BY_TICKER[tk]) exactTicker.push(BY_TICKER[tk]);
      });
      for (var i = 0; i < INDEX.length; i++) {
        var tk = INDEX[i][0], nm = INDEX[i][2] || "", cik = String(INDEX[i][1]);
        if (tk === t) exactTicker.push(INDEX[i]);
        else if (tk.indexOf(t) === 0) prefix.push(INDEX[i]);
        else if (nm.toUpperCase().indexOf(t) !== -1 || cik === t) nameHit.push(INDEX[i]);
        if (exactTicker.length + prefix.length + nameHit.length > 40) break;
      }
      return exactTicker.concat(prefix, nameHit).slice(0, 8);
    }
    function renderResults() {
      if (!matches.length) {
        rList.innerHTML = "<li class='none'>No matching companies</li>";
      } else {
        rList.innerHTML = matches.map(function (m, i) {
          var cov = COVERED[m[0]] ? "<span class='cov'>Data available</span>" : "";
          return "<li role='option' id='co-opt-" + i + "' data-i='" + i + "' aria-selected='" + (i === activeIdx) + "'>" +
                 "<span class='tk'>" + m[0] + "</span><span class='nm'>" + m[2] + "</span>" + cov + "</li>";
        }).join("");
      }
      rBox.classList.add("open");
      q.setAttribute("aria-expanded", "true");
      if (activeIdx >= 0 && matches.length) q.setAttribute("aria-activedescendant", "co-opt-" + activeIdx);
      else q.removeAttribute("aria-activedescendant");
    }
    function closeResults() {
      rBox.classList.remove("open");
      q.setAttribute("aria-expanded", "false");
      q.removeAttribute("aria-activedescendant");
      activeIdx = -1;
    }
    q.addEventListener("input", function () {
      matches = findMatches(q.value);
      activeIdx = matches.length ? 0 : -1;
      if (q.value.trim()) renderResults(); else closeResults();
    });
    q.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown" && matches.length) { ev.preventDefault(); activeIdx = Math.min(activeIdx + 1, matches.length - 1); renderResults(); }
      else if (ev.key === "ArrowUp" && matches.length) { ev.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderResults(); }
      else if (ev.key === "Enter") {
        ev.preventDefault();
        if (matches.length && activeIdx >= 0) pick(matches[activeIdx]);
        else if (matches.length) pick(matches[0]);
      }
      else if (ev.key === "Escape") closeResults();
    });
    rList.addEventListener("click", function (ev) {
      var li = ev.target.closest("li[data-i]");
      if (li) pick(matches[Number(li.getAttribute("data-i"))]);
    });
    document.addEventListener("click", function (ev) {
      if (!ev.target.closest(".search")) closeResults();
    });
    function pick(m) {
      q.value = m[0] + " — " + m[2];
      closeResults();
      select(m[0], { push: true });
    }
    /* "/" or Ctrl/Cmd+K focuses search from anywhere */
    document.addEventListener("keydown", function (ev) {
      var inField = ev.target && ev.target.closest &&
        ev.target.closest("input, textarea, select, [contenteditable]");
      var cmdK = (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey &&
        (ev.key === "k" || ev.key === "K");
      var slash = !inField && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key === "/";
      if (cmdK || slash) { ev.preventDefault(); q.focus(); q.select(); }
    });

    /* ---------- controls ---------- */
    $("range-30").addEventListener("click", function () { setRange("30d"); });
    $("range-6m").addEventListener("click", function () { setRange("6m"); });
    var refreshBtn = $("refresh-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", function () { refreshTicker(state.ticker); });
    function setRange(r) {
      state.range = r;
      $("range-30").setAttribute("aria-pressed", r === "30d" ? "true" : "false");
      $("range-6m").setAttribute("aria-pressed", r === "6m" ? "true" : "false");
      var d = COVERAGE[state.ticker];
      if (d) renderChart(d);
    }
    $("pct").addEventListener("change", function () {
      state.pct = $("pct").checked;
      var d = COVERAGE[state.ticker];
      if (d) renderFundamentals(d);
    });
    var pullBtn = $("pull-btn");
    if (pullBtn) pullBtn.addEventListener("click", function () { pullTicker(state.ticker); });
    $("notes-body").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-act='retry-analysis']");
      if (b) { b.disabled = true; fetchAnalysis(state.ticker, true); }
    });

    /* ---------- about modal (focus moves in, is trapped, and returns) ---------- */
    var aboutModal = $("about-modal");
    if ($("about-btn") && aboutModal) {
      var aboutPanel = aboutModal.querySelector(".modal");
      var aboutOpener = null;
      var openAbout = function () {
        aboutOpener = document.activeElement;
        aboutModal.hidden = false;
        if (aboutPanel) aboutPanel.focus();
      };
      var closeAbout = function () {
        aboutModal.hidden = true;
        if (aboutOpener && aboutOpener.focus) aboutOpener.focus();
        aboutOpener = null;
      };
      $("about-btn").addEventListener("click", openAbout);
      $("about-close").addEventListener("click", closeAbout);
      aboutModal.addEventListener("click", function (ev) {
        if (ev.target === aboutModal) closeAbout();
      });
      aboutModal.addEventListener("keydown", function (ev) {
        if (ev.key !== "Tab") return;
        var f = aboutModal.querySelectorAll("button, a[href]");
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && (document.activeElement === first || document.activeElement === aboutPanel)) {
          ev.preventDefault(); last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault(); first.focus();
        }
      });
      document.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape" && !aboutModal.hidden) closeAbout();
      });
    }

    /* ---------- resize ---------- */
    if (typeof ResizeObserver === "function") {
      var ro = new ResizeObserver(function () {
        var d = COVERAGE[state.ticker];
        if (d && !$("chart-panel").hidden) renderChart(d);
      });
      ro.observe($("chart"));
    }

    /* ---------- init (honor ?t= deep links) ---------- */
    var initial = urlTicker();
    if (!initial || !(BY_TICKER[initial] || COVERAGE[initial])) initial = "KBLB";
    var initialMeta = BY_TICKER[initial];
    q.value = initialMeta ? initial + " — " + initialMeta[2]
      : "KBLB — Kraig Biocraft Laboratories, Inc.";
    select(initial, { push: false });
  } catch (err) {
    var app = document.getElementById("app");
    if (app) {
      var p = document.createElement("p");
      p.textContent = "Company overview data could not be loaded in this context.";
      app.appendChild(p);
    }
  }
})();
