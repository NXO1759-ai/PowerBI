/* Financial Statement Analysis — renderer.
   Reads statements from /api/statements, computes with lib/ratios.js and
   explains with lib/metric-catalog.js. No dependencies. */
(function () {
  "use strict";
  var R = window.RTRatios, C = window.RTCatalog;
  if (!R || !C) throw new Error("ratios.js or metric-catalog.js failed to load");

  var INDEX = Array.isArray(window.COMPANY_INDEX) ? window.COMPANY_INDEX : [];
  var BY_TICKER = {};
  INDEX.forEach(function (row) { BY_TICKER[row[0]] = row; });

  var state = { ticker: "NVDA", basis: "annual", view: "dollars", data: null };
  var CACHE = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  var isNum = R.isNum;

  /* ---------- formatting ---------- */
  function money(v) {
    if (!isNum(v)) return "—";
    var neg = v < 0, a = Math.abs(v), s;
    if (a >= 1e12) s = (a / 1e12).toFixed(2) + "T";
    else if (a >= 1e9) s = (a / 1e9).toFixed(2) + "B";
    else if (a >= 1e6) s = (a / 1e6).toFixed(1) + "M";
    else if (a >= 1e3) s = (a / 1e3).toFixed(1) + "K";
    else s = a.toFixed(0);
    return (neg ? "−$" : "$") + s;
  }
  function pct(v, dp) {
    if (!isNum(v)) return "—";
    return (v * 100).toFixed(dp === undefined ? 1 : dp) + "%";
  }
  function times(v) { return isNum(v) ? v.toFixed(2) + "×" : "—"; }
  function days(v) { return isNum(v) ? Math.round(v) + " days" : "—"; }
  function plain(v) { return isNum(v) ? v.toFixed(2) : "—"; }
  function fmt(value, format) {
    if (format === "pct") return pct(value);
    if (format === "x") return times(value);
    if (format === "days") return days(value);
    if (format === "money") return money(value);
    if (format === "number") return plain(value);
    return isNum(value) ? String(value) : "—";
  }
  /* Change between periods. Ratios move in percentage points; everything
     else moves in percent, because a percent change of a percentage is
     the classic way to mislead a reader. */
  function delta(current, prior, format) {
    if (!isNum(current) || !isNum(prior)) return null;
    if (format === "pct") {
      var pp = (current - prior) * 100;
      return { text: (pp >= 0 ? "+" : "−") + Math.abs(pp).toFixed(1) + " pp", raw: pp };
    }
    if (format === "days") {
      var d = current - prior;
      return { text: (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(0) + " days", raw: d };
    }
    if (prior === 0) return null;
    var g = (current - prior) / Math.abs(prior) * 100;
    return { text: (g >= 0 ? "+" : "−") + Math.abs(g).toFixed(1) + "%", raw: g };
  }

  /* ---------- the definition popup ----------
     One popup element reused, positioned next to whatever is focused or
     hovered. Focus works as well as hover so it is reachable without a
     mouse. */
  var pop = $("metric-pop"), popFor = null;
  function showPop(el, key) {
    var m = C.get(key);
    if (!m) return;
    popFor = el;
    pop.innerHTML =
      "<h4>" + esc(m.label) + (m.subtitle ? " — " + esc(m.subtitle) : "") + "</h4>" +
      "<p class='pop-formula'>" + esc(m.formula) + "</p>" +
      "<p>" + esc(m.definition) + "</p>" +
      "<p><span class='pop-tag'>How to read it</span>" + esc(m.interpretation) + "</p>" +
      (m.watch ? "<p class='pop-watch'><span class='pop-tag'>Watch for</span>" +
        esc(m.watch) + "</p>" : "");
    pop.hidden = false;
    /* Below this width the popup is a bottom sheet positioned entirely by
       CSS. Inline left/top would beat the stylesheet and strand it
       half off-screen, so they are cleared and the maths skipped. */
    if (window.matchMedia("(max-width: 680px)").matches) {
      pop.style.left = "";
      pop.style.top = "";
      return;
    }
    var r = el.getBoundingClientRect();
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    var left = r.left + window.scrollX;
    if (left + pw > window.scrollX + document.documentElement.clientWidth - 12) {
      left = window.scrollX + document.documentElement.clientWidth - pw - 12;
    }
    if (left < window.scrollX + 8) left = window.scrollX + 8;
    /* Prefer below; flip above when it would run off the bottom. */
    var top = r.bottom + window.scrollY + 8;
    if (r.bottom + ph + 20 > document.documentElement.clientHeight) {
      top = r.top + window.scrollY - ph - 8;
      if (top < window.scrollY + 8) top = r.bottom + window.scrollY + 8;
    }
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }
  function hidePop(el) {
    if (el && popFor !== el) return;
    pop.hidden = true;
    popFor = null;
  }
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !pop.hidden) hidePop(null);
  });
  window.addEventListener("scroll", function () { if (!pop.hidden) hidePop(null); }, { passive: true });

  /* ---------- KPI cards ---------- */
  function trendFor(key, format, series, index) {
    if (index < 1) return null;
    var cur = series[index][key], prev = series[index - 1][key];
    var d = delta(cur, prev, format);
    if (!d) return null;
    var m = C.get(key);
    var good = null;
    if (m && m.direction === "up") good = d.raw > 0;
    else if (m && m.direction === "down") good = d.raw < 0;
    return { text: d.text + " vs " + series[index - 1].label,
             cls: good === null ? "" : good ? "up" : "down" };
  }

  function cardHtml(metric, value, trend, flag) {
    var display = fmt(value, metric.format);
    return "<button type='button' class='mcard' data-metric='" + esc(metric.key) + "'>" +
      "<span class='m-label'><span>" + esc(metric.label) + "</span></span>" +
      "<span class='m-value" + (isNum(value) ? "" : " na") + "'>" + esc(display) + "</span>" +
      (trend ? "<span class='m-trend " + trend.cls + "'>" + esc(trend.text) + "</span>" : "") +
      "<span class='m-gloss'>" + esc(metric.interpretation.split(". ")[0]) + ".</span>" +
      (flag ? "<span class='m-flag warn'>" + esc(flag) + "</span>" : "") +
      "</button>";
  }

  function renderKpis(ratios) {
    var i = ratios.length - 1, latest = ratios[i];
    var host = $("kpi-groups"), html = "";
    C.GROUPS.forEach(function (g) {
      var metrics = C.byGroup(g.key);
      if (!metrics.length) return;
      var cards = metrics.map(function (m) {
        var value = latest[m.key];
        /* Two metrics are not plain properties on the ratio object. */
        if (m.key === "altmanZ") {
          var z = R.altmanZ(state.data[state.basis][i], null);
          return cardHtml(m, z ? z.score : null,
            null, z ? z.zone : null);
        }
        if (m.key === "residualIncome") return "";
        var trend = trendFor(m.key, m.format, ratios, i);
        var flag = null;
        if (m.key === "rnoa" && latest.taxRateIsStatutory) flag = "statutory tax rate used";
        if (m.key === "cashConversion" && isNum(value) && value < 0.8) flag = "profit outrunning cash";
        if (m.key === "capexToDepreciation" && isNum(value) && value < 1) flag = "under-investing";
        return cardHtml(m, value, trend, flag);
      }).filter(Boolean).join("");
      html += "<div class='kpi-group'><h2>" + esc(g.label) + "</h2>" +
        "<p class='group-blurb'>" + esc(g.blurb) + "</p>" +
        "<div class='kpi-grid'>" + cards + "</div></div>";
    });
    host.innerHTML = html;
  }

  /* ---------- the decomposition strip ---------- */
  function renderDupont(ratios) {
    var l = ratios[ratios.length - 1];
    var terms = [
      { label: "Operating return", key: "rnoa", value: l.rnoa,
        note: "What the business earns on its operating capital" },
      { op: "+" },
      { label: "Spread", key: "spread", value: l.spread,
        note: "Operating return less the after-tax cost of debt" },
      { op: "×" },
      { label: "Net leverage", key: "netFinancialLeverage", value: l.netFinancialLeverage,
        note: "Net debt for every dollar of equity" },
      { op: "=" },
      { label: "Return on equity", key: "roe", value: l.roe, result: true,
        note: "What owners earned on their capital" },
    ];
    $("dupont-flow").innerHTML = terms.map(function (t) {
      if (t.op) return "<span class='dp-op' aria-hidden='true'>" + t.op + "</span>";
      return "<button type='button' class='dp-term mcard" + (t.result ? " dp-result" : "") +
        "' data-metric='" + esc(t.key) + "'>" +
        "<span class='dp-label'>" + esc(t.label) + "</span>" +
        "<span class='dp-value'>" + pct(t.value) + "</span>" +
        "<span class='dp-note'>" + esc(t.note) + "</span></button>";
    }).join("");

    /* A sentence naming which half produced the return, because the split
       is the entire point and a reader should not have to do it. */
    var reading = "";
    if (isNum(l.rnoa) && isNum(l.roe)) {
      var gain = isNum(l.financialLeverageGain) ? l.financialLeverageGain : 0;
      var operatingShare = l.roe !== 0 ? l.rnoa / l.roe : null;
      reading = "In " + esc(l.label) + ", the business earned <strong>" + pct(l.rnoa) +
        "</strong> on its operating capital, and financing " +
        (gain >= 0 ? "added <strong>" : "subtracted <strong>") +
        pct(Math.abs(gain)) + "</strong>, giving a return on equity of <strong>" +
        pct(l.roe) + "</strong>. ";
      if (gain < 0 && isNum(l.netFinancialLeverage) && l.netFinancialLeverage < 0) {
        reading += "The drag is the cost of holding more cash than debt: cash earns " +
          "less than the business does, so a large balance pulls the shareholder " +
          "return below the operating return.";
      } else if (gain > 0) {
        reading += "Borrowing is currently accretive, which holds only while the " +
          "spread stays positive — it narrows exactly when profits fall.";
      } else {
        reading += "Financing is close to neutral, so the return on equity is " +
          "essentially the operating return.";
      }
      if (isNum(operatingShare) && operatingShare > 1.15 && l.roe > 0) {
        reading += " Note the operating business is running <em>ahead</em> of the " +
          "headline return.";
      }
    }
    var stability = R.spreadStability(ratios);
    if (stability && isNum(stability.mean)) {
      reading += " Across " + stability.periods + " periods the spread averaged " +
        pct(stability.mean) + " with a standard deviation of " +
        pct(stability.standardDeviation) +
        (stability.periodsNegative > 0
          ? ", and was negative in " + stability.periodsNegative + " of them."
          : ", and was never negative.") +
        " Level and volatility both matter: a thin steady spread carries debt " +
        "more safely than a wide erratic one.";
    }
    $("dupont-reading").innerHTML = reading;
  }

  /* ---------- statements ---------- */
  var INCOME_ROWS = [
    ["revenue", "Revenue", true],
    ["cogs", "Cost of goods sold"],
    ["grossProfit", "Gross profit", true],
    ["researchDevelopment", "Research & development"],
    ["sellingGeneralAdmin", "Selling, general & admin"],
    ["operatingIncome", "Operating income", true],
    ["interestExpense", "Interest expense"],
    ["pretaxIncome", "Pre-tax income", true],
    ["incomeTax", "Income tax"],
    ["netIncome", "Net income", true],
  ];
  var BALANCE_ROWS = [
    ["cash", "Cash & equivalents"],
    ["shortTermInvestments", "Short-term investments"],
    ["receivables", "Receivables"],
    ["inventory", "Inventory"],
    ["currentAssets", "Total current assets", true],
    ["ppe", "Property, plant & equipment"],
    ["goodwill", "Goodwill"],
    ["intangibles", "Intangible assets"],
    ["totalAssets", "Total assets", true],
    [null, ""],
    ["payables", "Payables"],
    ["shortTermDebt", "Short-term debt"],
    ["currentLiabilities", "Total current liabilities", true],
    ["longTermDebt", "Long-term debt"],
    ["totalLiabilities", "Total liabilities", true],
    ["equity", "Shareholders' equity"],
    ["minorityInterest", "Noncontrolling interest"],
  ];
  var CASHFLOW_ROWS = [
    ["cfOps", "Operating cash flow", true],
    ["depreciationAmortization", "Depreciation & amortisation"],
    ["shareBasedComp", "Share-based compensation"],
    ["capex", "Capital expenditure"],
    ["cfInv", "Investing cash flow", true],
    ["dividendsPaid", "Dividends paid"],
    ["buybacks", "Share buybacks"],
    ["cfFin", "Financing cash flow", true],
  ];

  /** The pair of shown periods the change column compares: the newest
      against a year before it — four quarters back on the quarterly
      basis, one period back on the annual — falling back to the previous
      period when the year-ago one is not on screen. */
  function comparePair(periods) {
    if (periods.length < 2) return null;
    var latest = periods.length - 1;
    var back = state.basis === "quarterly" ? 4 : 1;
    var base = latest - back >= 0 ? latest - back : latest - 1;
    return { latest: latest, base: base,
             label: state.basis === "quarterly" && back === latest - base ? "vs yr ago" : "change" };
  }

  /** Period-over-period change, refusing the cases where a percentage is
      arithmetic but not information: a base at or below zero. */
  function deltaCell(now, before, commonSizePair) {
    if (commonSizePair) {
      /* common-size: the SHARE moved, so points of revenue, not percent */
      if (!isNum(now) || !isNum(before)) return "<td class='num delta na'>—</td>";
      var d = now - before;
      return "<td class='num delta " + (d >= 0 ? "pos" : "neg") + "'>" +
        (d >= 0 ? "+" : "−") + Math.abs(d * 100).toFixed(1) + " pp</td>";
    }
    if (!isNum(now) || !isNum(before)) return "<td class='num delta na'>—</td>";
    if (before <= 0) return "<td class='num delta na'>n/m</td>";
    var g = now / before - 1;
    return "<td class='num delta " + (g >= 0 ? "pos" : "neg") + "'>" +
      (g >= 0 ? "+" : "−") + Math.abs(g * 100).toFixed(1) + "%</td>";
  }

  function statementTable(el, rows, statement, periods, ratios) {
    var pair = comparePair(periods);
    var head = "<thead><tr><th scope='col'>" +
      (statement === "balanceSheet" ? "Balance sheet"
        : statement === "cashFlow" ? "Cash flow" : "Income statement") + "</th>" +
      periods.map(function (p) {
        return "<th scope='col' class='num'>" + esc(p.label) +
          (p.derived ? "*" : "") + "</th>";
      }).join("") +
      (pair ? "<th scope='col' class='num'>" + esc(pair.label) + "</th>" : "") +
      "</tr></thead>";
    var body = rows.map(function (row) {
      if (!row[0]) return "<tr class='spacer'><td colspan='" + (periods.length + 2) + "'></td></tr>";
      var common = state.view === "common" && statement === "incomeStatement";
      var cells = periods.map(function (p, i) {
        var v = p[statement][row[0]];
        var text;
        if (common) {
          var rev = p.incomeStatement.revenue;
          text = (isNum(v) && isNum(rev) && rev !== 0) ? pct(v / rev) : "—";
        } else {
          text = money(v);
        }
        return "<td class='num" + (isNum(v) ? "" : " na") + "'>" + text + "</td>";
      }).join("");
      if (pair) {
        var a = periods[pair.latest][statement][row[0]];
        var b = periods[pair.base][statement][row[0]];
        if (common) {
          var ra = periods[pair.latest].incomeStatement.revenue;
          var rb = periods[pair.base].incomeStatement.revenue;
          var sa = (isNum(a) && isNum(ra) && ra !== 0) ? a / ra : null;
          var sb = (isNum(b) && isNum(rb) && rb !== 0) ? b / rb : null;
          cells += deltaCell(sa, sb, true);
        } else {
          cells += deltaCell(a, b, false);
        }
      }
      return "<tr" + (row[2] ? " class='total'" : "") + "><td>" +
        esc(row[1]) + "</td>" + cells + "</tr>";
    }).join("");
    el.innerHTML = head + "<tbody>" + body + "</tbody>";
  }

  /* The reformulated balance sheet: the operating business on one side,
     how it is funded on the other. */
  function reformulatedTable(el, periods, ratios) {
    var rows = [
      ["financialLiabilities", "Financial liabilities (debt)"],
      ["financialAssets", "Financial assets (cash & investments)"],
      ["netDebt", "Net debt", true],
      ["bookEquity", "Equity (incl. noncontrolling)", false],
      ["netOperatingAssets", "Net operating assets", true],
      [null, ""],
      ["ebit", "EBIT"],
      ["nopat", "NOPAT (operating profit after tax)", true],
      ["afterTaxNetInterestExpense", "After-tax net interest"],
    ];
    var pair = comparePair(ratios);
    var head = "<thead><tr><th scope='col'>Reformulated</th>" +
      periods.map(function (p) {
        return "<th scope='col' class='num'>" + esc(p.label) + "</th>";
      }).join("") +
      (pair ? "<th scope='col' class='num'>" + esc(pair.label) + "</th>" : "") +
      "</tr></thead>";
    var body = rows.map(function (row) {
      if (!row[0]) return "<tr class='spacer'><td colspan='" + (periods.length + 2) + "'></td></tr>";
      var cells = ratios.map(function (r) {
        var v = r[row[0]];
        return "<td class='num" + (isNum(v) ? "" : " na") + "'>" + money(v) + "</td>";
      }).join("");
      if (pair) cells += deltaCell(ratios[pair.latest][row[0]], ratios[pair.base][row[0]], false);
      return "<tr" + (row[2] ? " class='total'" : "") + "><td>" +
        esc(row[1]) + "</td>" + cells + "</tr>";
    }).join("");
    el.innerHTML = head + "<tbody>" + body + "</tbody>";
  }

  /* ---------- earnings quality ---------- */
  function renderQuality(periods, ratios) {
    var eq = R.earningsQuality(periods);
    if (!eq) { $("quality-body").innerHTML = "<p class='hint'>Not enough history to assess.</p>"; return; }
    var conv = eq.conversionRatio;
    var verdict, note;
    if (!isNum(conv)) { verdict = "—"; note = "Cash conversion could not be computed."; }
    else if (conv >= 0.9) {
      verdict = "Backed by cash";
      note = "Over " + eq.periods + " periods the company generated " + pct(conv) +
        " of its cumulative reported profit as free cash flow. Profit and cash are " +
        "moving together, which is what you want to see.";
    } else if (conv >= 0.6) {
      verdict = "Partly backed";
      note = "Cumulative free cash flow is " + pct(conv) + " of cumulative profit. " +
        "Some gap is normal for a company investing to grow, since spending on " +
        "capacity hits cash before it hits earnings. Worth checking whether the " +
        "gap is closing or widening.";
    } else {
      verdict = "Profit outrunning cash";
      note = "Cumulative free cash flow is only " + pct(conv) + " of cumulative " +
        "reported profit. That gap is the pattern worth investigating: either the " +
        "company is investing very heavily, or earnings are being recognised well " +
        "ahead of the cash.";
    }
    var l = ratios[ratios.length - 1];
    $("quality-body").innerHTML =
      "<div class='quality-grid'>" +
        "<div class='quality-verdict'><span class='qv-head'>Verdict</span>" +
          "<span class='qv-value'>" + esc(verdict) + "</span>" +
          "<p class='qv-note'>" + esc(note) + "</p></div>" +
        "<div class='quality-verdict'><span class='qv-head'>Cumulative net income</span>" +
          "<span class='qv-value'>" + money(eq.cumulativeNetIncome) + "</span>" +
          "<p class='qv-note'>Across " + eq.periods + " reporting periods.</p></div>" +
        "<div class='quality-verdict'><span class='qv-head'>Cumulative free cash flow</span>" +
          "<span class='qv-value'>" + money(eq.cumulativeFreeCashFlow) + "</span>" +
          "<p class='qv-note'>Operating cash flow less capital spending, same periods. " +
          "Gap of " + money(eq.gap) + ".</p></div>" +
        "<div class='quality-verdict'><span class='qv-head'>Life-cycle stage</span>" +
          "<span class='qv-value'>" + esc(l.lifeCycleStage || "—") + "</span>" +
          "<p class='qv-note'>Read from the signs of the three cash flow sections. " +
          "Negative operating cash flow is normal for a young company and alarming " +
          "for a mature one, so the stage is what makes the numbers mean anything.</p>" +
        "</div>" +
      "</div>";
  }


  /* ---------- reading the period ----------
     Horizontal analysis (what moved, how fast) and common-size analysis
     (did the shape change) in prose, computed from the same periods the
     tables show. The checks are the course's: operating leverage read
     against revenue, inventory and receivables read against sales, and
     profit read against the cash behind it. */
  function renderReading(periods) {
    var host = $("reading-body");
    if (!host) return;
    var pair = comparePair(periods);
    if (!pair) { host.innerHTML = "<p>Not enough periods to compare.</p>"; return; }
    var now = periods[pair.latest], before = periods[pair.base];
    var cmpLabel = esc(before.label) + " to " + esc(now.label);
    var g = function (a, b) {
      return (isNum(a) && isNum(b) && b > 0) ? a / b - 1 : null;
    };
    var share = function (p, v) {
      var rev = p.incomeStatement.revenue;
      return (isNum(v) && isNum(rev) && rev !== 0) ? v / rev : null;
    };
    var sentences = [];
    var factLines = [];
    var fact = function (t) { factLines.push(t); };

    /* -- horizontal: what moved -- */
    var is1 = now.incomeStatement, is0 = before.incomeStatement;
    var revG = g(is1.revenue, is0.revenue);
    var lines = [
      ["cogs", "cost of sales"], ["grossProfit", "gross profit"],
      ["researchDevelopment", "research and development"],
      ["sellingGeneralAdmin", "selling, general and administrative"],
      ["operatingIncome", "operating income"], ["netIncome", "net income"]
    ];
    var movers = lines.map(function (l) {
      var gr = g(is1[l[0]], is0[l[0]]);
      return isNum(gr) ? { name: l[1], g: gr, abs: Math.abs((is1[l[0]] || 0) - (is0[l[0]] || 0)) } : null;
    }).filter(Boolean).sort(function (a, b) { return b.abs - a.abs; });
    if (isNum(revG)) {
      var p1 = "<strong>What moved.</strong> Revenue " +
        (revG >= 0 ? "grew " : "fell ") + pct(Math.abs(revG)) + " from " + cmpLabel + ".";
      if (movers.length) {
        p1 += " The biggest dollar moves beneath it: " + movers.slice(0, 3).map(function (m) {
          return m.name + " " + (m.g >= 0 ? "up " : "down ") + pct(Math.abs(m.g));
        }).join(", ") + ".";
      }
      sentences.push(p1);
      fact("Revenue " + (revG >= 0 ? "grew " : "fell ") + pct(Math.abs(revG)) +
        " (" + cmpLabel.replace(/<[^>]*>/g, "") + "); largest moves: " +
        movers.slice(0, 3).map(function (m) {
          return m.name + " " + (m.g >= 0 ? "+" : "−") + pct(Math.abs(m.g));
        }).join(", "));
    }

    /* -- operating leverage -- */
    var oiG = g(is1.operatingIncome, is0.operatingIncome);
    if (isNum(revG) && isNum(oiG) && Math.abs(revG) > 0.005) {
      var mult = oiG / revG;
      var p2 = "<strong>Operating leverage.</strong> ";
      if (revG > 0 && oiG > 0 && mult > 1.15) {
        p2 += "Operating profit grew " + mult.toFixed(1) + "× as fast as revenue — the sign of a " +
          "cost base that does not scale one-for-one with sales, so each extra dollar of revenue " +
          "arrives at a better margin than the last.";
      } else if (revG > 0 && oiG < revG) {
        p2 += "Operating profit " + (oiG < 0 ? "fell while revenue grew" :
          "grew slower than revenue") + " — costs are rising faster than sales, and the " +
          "common-size view shows where.";
      } else if (revG < 0 && isNum(oiG) && oiG < revG) {
        p2 += "Revenue fell " + pct(Math.abs(revG)) + " but operating profit fell " +
          pct(Math.abs(oiG)) + " — the fixed-cost base cuts both ways, amplifying the " +
          "downside exactly as it amplified the upside.";
      } else {
        p2 += "Operating profit moved roughly in line with revenue over the period.";
      }
      sentences.push(p2);
      fact("Operating income moved " + (oiG >= 0 ? "+" : "−") + pct(Math.abs(oiG)) +
        " against revenue " + (revG >= 0 ? "+" : "−") + pct(Math.abs(revG)));
    }

    /* -- common-size: did the shape change -- */
    var gm1 = share(now, is1.grossProfit), gm0 = share(before, is0.grossProfit);
    var oi1 = share(now, is1.operatingIncome), oi0 = share(before, is0.operatingIncome);
    var rd1 = share(now, is1.researchDevelopment), rd0 = share(before, is0.researchDevelopment);
    var ppf = function (d) { return (d >= 0 ? "+" : "−") + Math.abs(d * 100).toFixed(1) + " pp"; };
    var shape = [];
    if (isNum(gm1) && isNum(gm0) && Math.abs(gm1 - gm0) >= 0.003) shape.push("gross margin " + ppf(gm1 - gm0));
    if (isNum(oi1) && isNum(oi0) && Math.abs(oi1 - oi0) >= 0.003) shape.push("operating margin " + ppf(oi1 - oi0));
    if (isNum(rd1) && isNum(rd0) && Math.abs(rd1 - rd0) >= 0.003) shape.push("research intensity " + ppf(rd1 - rd0));
    if (shape.length) {
      sentences.push("<strong>The shape of a revenue dollar.</strong> In common-size terms, " +
        shape.join(", ") + " — margin moves in points of revenue are the changes that persist, " +
        "where dollar moves can be mere scale.");
      fact("Common-size shifts: " + shape.join(", "));
    }

    /* -- working capital against sales -- */
    var bs1 = now.balanceSheet, bs0 = before.balanceSheet;
    var invG = g(bs1.inventory, bs0.inventory);
    var recG = g(bs1.receivables, bs0.receivables);
    if (isNum(revG)) {
      var wc = [];
      if (isNum(invG) && invG - revG > 0.08) {
        wc.push("inventory grew " + pct(invG) + " against revenue's " + pct(revG) +
          " — stock building faster than sales is the classic early sign of softening demand or a planned ramp; the filing's own commentary decides which");
      }
      if (isNum(recG) && recG - revG > 0.08) {
        wc.push("receivables grew " + pct(recG) + " against revenue's " + pct(revG) +
          " — customers are taking longer to pay, or revenue is being booked ahead of collection");
      }
      if (wc.length) {
        sentences.push("<strong>Working capital against sales.</strong> " +
          wc.join("; ") + ".");
        fact("Working-capital flags: " + wc.join("; "));
      }
    }

    /* -- profit against the cash behind it -- */
    var cf1 = now.cashFlow, cf0 = before.cashFlow;
    if (isNum(cf1.cfOps) && isNum(is1.netIncome) && is1.netIncome > 0) {
      var conv = cf1.cfOps / is1.netIncome;
      var p5 = "<strong>Profit against cash.</strong> The period's operating cash flow was " +
        conv.toFixed(2) + "× reported net income";
      p5 += conv >= 1
        ? " — profit fully backed by cash, which is the quality check every accrual number must eventually pass."
        : " — earnings ran ahead of the cash behind them this period; one period is timing, a trend is accrual risk.";
      if (isNum(cf1.capex) && isNum(cf0.capex) && Math.abs(cf0.capex) > 0) {
        var capG = Math.abs(cf1.capex) / Math.abs(cf0.capex) - 1;
        if (Math.abs(capG) > 0.15) {
          p5 += " Capital spending " + (capG > 0 ? "rose " : "fell ") + pct(Math.abs(capG)) +
            ", which reaches cash today and earnings only through future depreciation.";
        }
      }
      sentences.push(p5);
      fact("Operating cash flow was " + conv.toFixed(2) + "x reported net income");
    }

    /* -- effective tax rate, per the statement-review checklist -- */
    var tax1 = is1.incomeTax, pre1 = is1.pretaxIncome;
    var tax0 = is0.incomeTax, pre0 = is0.pretaxIncome;
    if (isNum(tax1) && isNum(pre1) && pre1 > 0) {
      var etr1 = tax1 / pre1;
      var etr0 = (isNum(tax0) && isNum(pre0) && pre0 > 0) ? tax0 / pre0 : null;
      var p6 = "<strong>Tax.</strong> The effective tax rate was " + pct(etr1);
      if (isNum(etr0) && Math.abs(etr1 - etr0) >= 0.005) {
        p6 += ", " + (etr1 > etr0 ? "up" : "down") + " from " + pct(etr0) +
          " — a move worth attributing before it is extrapolated, since rate " +
          "changes, one-off items and jurisdiction mix all land in this line.";
        fact("Effective tax rate " + pct(etr1) + " vs " + pct(etr0) + " in the base period");
      } else {
        p6 += ", in line with the base period.";
        fact("Effective tax rate steady at " + pct(etr1));
      }
      sentences.push(p6);
    }

    host.innerHTML =
      "<p class='reading-head'>" + cmpLabel + "</p>" +
      sentences.map(function (x) { return "<p>" + x + "</p>"; }).join("");
    var flagged = renderVariances(now, before, pair);
    if (flagged.length) {
      fact("Material variances flagged: " + flagged.join("; "));
    }
    renderAnalystNote(factLines, now.label);
  }

  /**
   * Material-variance summary. Thresholds scale with the size of the
   * line, and a flag requires BOTH the percentage and the dollar move —
   * a big line drifting 2% is noise, a small line doubling off nothing
   * is also noise. Direction reads favourable the way the statement
   * does: more revenue and profit good, more cost bad, balance-sheet
   * builds neutral until read against sales.
   */
  function renderVariances(now, before, pair) {
    var FAV_UP = { revenue: 1, grossProfit: 1, operatingIncome: 1, netIncome: 1,
      netIncomeIncludingNci: 1, cfOps: 1 };
    var FAV_DOWN = { cogs: 1, researchDevelopment: 1, sellingGeneralAdmin: 1,
      interestExpense: 1, incomeTax: 1 };
    var SCAN = [
      ["incomeStatement", INCOME_ROWS], ["balanceSheet", BALANCE_ROWS],
      ["cashFlow", CASHFLOW_ROWS]
    ];
    var rows = [];
    SCAN.forEach(function (grp) {
      grp[1].forEach(function (r) {
        if (!r[0]) return;
        var a = now[grp[0]][r[0]], b = before[grp[0]][r[0]];
        if (!isNum(a) || !isNum(b) || b === 0) return;
        var dAbs = a - b, dPct = Math.abs(b) > 0 ? dAbs / Math.abs(b) : null;
        if (!isNum(dPct)) return;
        var size = Math.abs(b);
        var needPct = size > 10e9 ? 0.05 : size > 1e9 ? 0.10 : 0.15;
        var needAbs = size > 10e9 ? 500e6 : size > 1e9 ? 100e6 : 50e6;
        var material = Math.abs(dPct) >= needPct && Math.abs(dAbs) >= needAbs;
        if (!material) return;
        var dir = FAV_UP[r[0]] ? (dAbs >= 0 ? "Favourable" : "Unfavourable")
          : FAV_DOWN[r[0]] ? (dAbs <= 0 ? "Favourable" : "Unfavourable") : "—";
        rows.push({ label: r[1], a: a, b: b, dAbs: dAbs, dPct: dPct, dir: dir });
      });
    });
    rows.sort(function (x, y) { return Math.abs(y.dAbs) - Math.abs(x.dAbs); });
    var el = $("t-variance");
    if (!el) return [];
    if (!rows.length) {
      el.innerHTML = "<tbody><tr><td>No line crossed its materiality threshold " +
        "against " + esc(before.label) + " — the period moved, but within the noise " +
        "bands a reviewer would accept without a question.</td></tr></tbody>";
      return [];
    }
    el.innerHTML = "<thead><tr><th scope='col'>Line</th>" +
      "<th scope='col' class='num'>" + esc(now.label) + "</th>" +
      "<th scope='col' class='num'>" + esc(before.label) + "</th>" +
      "<th scope='col' class='num'>Δ $</th><th scope='col' class='num'>Δ %</th>" +
      "<th scope='col'>Direction</th></tr></thead><tbody>" +
      rows.map(function (r) {
        return "<tr><td>" + esc(r.label) + "</td>" +
          "<td class='num'>" + money(r.a) + "</td>" +
          "<td class='num'>" + money(r.b) + "</td>" +
          "<td class='num flag'>" + (r.dAbs >= 0 ? "+" : "−") + money(Math.abs(r.dAbs)) + "</td>" +
          "<td class='num flag'>" + (r.dPct >= 0 ? "+" : "−") + pct(Math.abs(r.dPct)) + "</td>" +
          "<td>" + esc(r.dir) + "</td></tr>";
      }).join("") + "</tbody>";
    return rows.slice(0, 5).map(function (r) {
      return r.label + " " + (r.dPct >= 0 ? "+" : "−") + pct(Math.abs(r.dPct)) +
        (r.dir !== "—" ? " (" + r.dir.toLowerCase() + ")" : "");
    });
  }

  /* ---------- the analyst's note ---------- */
  var NOTE_BASE = /^(localhost|127[.])/.test(location.hostname)
    ? "https://www.chineduokeke.mba" : "";
  var NOTE_CACHE = {};
  function renderAnalystNote(factLines, periodLabel) {
    var host = $("analyst-note-body");
    var section = document.getElementById("sec-analyst");
    if (!host || !section) return;
    if (!factLines || factLines.length < 3) { section.hidden = true; return; }
    var key = state.ticker + "|" + state.basis + "|" + periodLabel;
    if (NOTE_CACHE[key] && !state.noteForce) {
      paintNote(NOTE_CACHE[key]);
      return;
    }
    section.hidden = false;
    host.innerHTML = "<p class='hint' role='status'>Writing the note from the figures above…</p>";
    var wantForce = !!state.noteForce;
    state.noteForce = false;
    fetch(NOTE_BASE + "/api/fsa-note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: state.ticker, periodLabel: periodLabel,
        facts: factLines, force: wantForce })
    }).then(function (r) {
      if (r.status === 503) throw new Error("unconfigured");
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      NOTE_CACHE[key] = d;
      paintNote(d);
    }).catch(function (e) {
      if (String(e.message) === "unconfigured") { section.hidden = true; return; }
      host.innerHTML = "<p class='hint'>The note could not be written just now. " +
        "Every figure above stands on its own.</p>";
    });
    function paintNote(d) {
      section.hidden = false;
      host.innerHTML = String(d.note || "").split("\n\n").map(function (p) {
        return "<p>" + esc(p) + "</p>";
      }).join("") +
      "<p class='note-meta'>Written from the computed figures above and nothing else; " +
      "regenerated when the statements refresh.</p>";
    }
  }


  /* ---------- orchestration ---------- */
  function renderAll() {
    var d = state.data;
    if (!d) return;
    var periods = d[state.basis] || [];
    var ratios = (d.ratios && d.ratios[state.basis]) || [];
    if (!periods.length) {
      $("status").textContent = "No " + state.basis + " periods available for this company.";
      $("fsa-body").hidden = true;
      return;
    }
    /* Charts and tables read left to right, so show the most recent
       periods rather than the oldest. */
    var show = periods.slice(-6), showRatios = ratios.slice(-6);
    $("status").textContent = "";
    $("fsa-body").hidden = false;

    renderDupont(ratios);
    renderKpis(ratios);
    statementTable($("t-income"), INCOME_ROWS, "incomeStatement", show, showRatios);
    statementTable($("t-balance"), BALANCE_ROWS, "balanceSheet", show, showRatios);
    reformulatedTable($("t-reformulated"), show, showRatios);
    statementTable($("t-cashflow"), CASHFLOW_ROWS, "cashFlow", show, showRatios);
    renderReading(show);
    renderQuality(periods, ratios);

    var anyDerived = show.some(function (p) { return p.derived; });
    $("src-footer-text").textContent =
      "Source: SEC EDGAR XBRL filings for " + d.ticker + " (CIK " + d.cik + "). " +
      periods.length + " " + state.basis + " periods. " +
      "Balance sheet figures in returns use the average of opening and closing " +
      "balances. " +
      (anyDerived ? "* Fourth quarters are derived as the year less the first " +
        "three quarters, since most filers do not report them separately. " : "") +
      "Not investment advice.";
  }

  function setCompany(ticker, force) {
    state.noteForce = !!force;
    state.ticker = ticker;
    var meta = BY_TICKER[ticker];
    $("co-name").textContent = meta ? meta[2] : ticker;
    $("co-meta").innerHTML = "<span class='tk'>" + esc(ticker) + "</span>" +
      (meta ? " <span class='sep'>·</span> <span class='tk'>CIK " + esc(meta[1]) + "</span>" : "");
    document.title = ticker + (meta ? " · " + meta[2] : "") +
      " — Financial Statement Analysis";
    try {
      history.replaceState({ t: ticker }, "", location.pathname + "?t=" + encodeURIComponent(ticker));
    } catch (e) { /* sandboxed contexts */ }

    if (!force && CACHE[ticker]) { state.data = CACHE[ticker]; renderAll(); return; }
    if (!meta) {
      $("status").textContent = ticker + " is not in the company index.";
      $("fsa-body").hidden = true;
      return;
    }
    $("fsa-body").hidden = true;
    $("status").innerHTML = "<span class='pulse'>Assembling " + esc(ticker) +
      " statements from SEC EDGAR filings…</span>";
    fetch("/api/statements?ticker=" + encodeURIComponent(ticker) +
          "&cik=" + encodeURIComponent(meta[1]) + (force ? "&force=1" : ""))
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw new Error(body && body.error ? body.error : "HTTP " + r.status);
          return body;
        });
      })
      .then(function (d) {
        CACHE[ticker] = d;
        if (state.ticker !== ticker) return;
        state.data = d;
        renderAll();
      })
      .catch(function (err) {
        if (state.ticker !== ticker) return;
        $("status").textContent = String(err && err.message ? err.message : err);
        $("fsa-body").hidden = true;
      });
  }

  /* ---------- events ---------- */
  document.addEventListener("mouseover", function (ev) {
    var card = ev.target.closest("[data-metric]");
    if (card) showPop(card, card.getAttribute("data-metric"));
  });
  document.addEventListener("mouseout", function (ev) {
    var card = ev.target.closest("[data-metric]");
    if (card && !card.contains(ev.relatedTarget)) hidePop(card);
  });
  document.addEventListener("focusin", function (ev) {
    var card = ev.target.closest("[data-metric]");
    if (card) showPop(card, card.getAttribute("data-metric"));
  });
  document.addEventListener("focusout", function (ev) {
    var card = ev.target.closest("[data-metric]");
    if (card) hidePop(card);
  });

  function setBasis(basis) {
    state.basis = basis;
    $("basis-annual").setAttribute("aria-pressed", basis === "annual" ? "true" : "false");
    $("basis-quarterly").setAttribute("aria-pressed", basis === "quarterly" ? "true" : "false");
    renderAll();
  }
  $("basis-annual").addEventListener("click", function () { setBasis("annual"); });
  $("basis-quarterly").addEventListener("click", function () { setBasis("quarterly"); });

  function setView(view) {
    state.view = view;
    $("view-dollars").setAttribute("aria-pressed", view === "dollars" ? "true" : "false");
    $("view-common").setAttribute("aria-pressed", view === "common" ? "true" : "false");
    renderAll();
  }
  $("view-dollars").addEventListener("click", function () { setView("dollars"); });
  $("view-common").addEventListener("click", function () { setView("common"); });

  $("refresh-btn").addEventListener("click", function () {
    var b = $("refresh-btn");
    b.disabled = true; b.textContent = "Refreshing…";
    delete CACHE[state.ticker];
    setCompany(state.ticker, true);
    setTimeout(function () { b.disabled = false; b.textContent = "Refresh"; }, 1200);
  });

  /* ---------- search (same behaviour as the overview page) ---------- */
  var q = $("q"), rBox = $("results"), rList = $("results-list"), activeIdx = -1, matches = [];
  function findMatches(text) {
    var t = text.trim().toUpperCase();
    if (!t) return [];
    var exact = [], prefix = [], nameHit = [];
    for (var i = 0; i < INDEX.length; i++) {
      var tk = INDEX[i][0], nm = INDEX[i][2] || "", cik = String(INDEX[i][1]);
      if (tk === t) exact.push(INDEX[i]);
      else if (tk.indexOf(t) === 0) prefix.push(INDEX[i]);
      else if (nm.toUpperCase().indexOf(t) !== -1 || cik === t) nameHit.push(INDEX[i]);
      if (exact.length + prefix.length + nameHit.length > 40) break;
    }
    return exact.concat(prefix, nameHit).slice(0, 8);
  }
  function renderResults() {
    rList.innerHTML = matches.length
      ? matches.map(function (m, i) {
          return "<li role='option' id='fsa-opt-" + i + "' data-i='" + i + "' aria-selected='" +
            (i === activeIdx) + "'><span class='tk'>" + esc(m[0]) + "</span>" +
            "<span class='nm'>" + esc(m[2]) + "</span></li>";
        }).join("")
      : "<li class='none'>No matching companies</li>";
    rBox.classList.add("open");
    q.setAttribute("aria-expanded", "true");
    if (activeIdx >= 0 && matches.length) q.setAttribute("aria-activedescendant", "fsa-opt-" + activeIdx);
    else q.removeAttribute("aria-activedescendant");
  }
  function closeResults() {
    rBox.classList.remove("open");
    q.setAttribute("aria-expanded", "false");
    q.removeAttribute("aria-activedescendant");
    activeIdx = -1;
  }
  function pick(m) { q.value = m[0] + " — " + m[2]; closeResults(); setCompany(m[0]); }
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

  /* ---------- init ---------- */
  var urlTicker = (location.search.match(/[?&]t=([A-Za-z0-9.\-]+)/) || [])[1];
  var initial = urlTicker ? decodeURIComponent(urlTicker).toUpperCase() : "NVDA";
  if (!BY_TICKER[initial]) initial = "NVDA";
  var meta0 = BY_TICKER[initial];
  q.value = meta0 ? initial + " — " + meta0[2] : initial;
  setCompany(initial);

  /* The edge fade appears only when the nav genuinely overflows. */
  (function () {
    var nav = document.querySelector(".nav-tabs");
    if (!nav) return;
    var sync = function () {
      nav.classList.toggle("is-scrollable", nav.scrollWidth > nav.clientWidth + 1);
    };
    /* Measure on the frame AFTER the change. A resize observer fires
       before the new layout has settled, so measuring inline compares the
       new width against the old content and leaves the fade stuck on. */
    var later = function () { requestAnimationFrame(sync); };
    sync();
    window.addEventListener("resize", later);
    window.addEventListener("orientationchange", later);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(later);
    if (typeof ResizeObserver === "function") new ResizeObserver(later).observe(nav);
  })();
})();
