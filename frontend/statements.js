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

  function statementTable(el, rows, statement, periods, ratios) {
    var head = "<thead><tr><th scope='col'>" +
      (statement === "balanceSheet" ? "Balance sheet"
        : statement === "cashFlow" ? "Cash flow" : "Income statement") + "</th>" +
      periods.map(function (p) {
        return "<th scope='col' class='num'>" + esc(p.label) +
          (p.derived ? "*" : "") + "</th>";
      }).join("") + "</tr></thead>";
    var body = rows.map(function (row) {
      if (!row[0]) return "<tr class='spacer'><td colspan='" + (periods.length + 1) + "'></td></tr>";
      var cells = periods.map(function (p, i) {
        var v = p[statement][row[0]];
        var text;
        if (state.view === "common" && statement === "incomeStatement") {
          var rev = p.incomeStatement.revenue;
          text = (isNum(v) && isNum(rev) && rev !== 0) ? pct(v / rev) : "—";
        } else {
          text = money(v);
        }
        return "<td class='num" + (isNum(v) ? "" : " na") + "'>" + text + "</td>";
      }).join("");
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
    var head = "<thead><tr><th scope='col'>Reformulated</th>" +
      periods.map(function (p) {
        return "<th scope='col' class='num'>" + esc(p.label) + "</th>";
      }).join("") + "</tr></thead>";
    var body = rows.map(function (row) {
      if (!row[0]) return "<tr class='spacer'><td colspan='" + (periods.length + 1) + "'></td></tr>";
      var cells = ratios.map(function (r) {
        var v = r[row[0]];
        return "<td class='num" + (isNum(v) ? "" : " na") + "'>" + money(v) + "</td>";
      }).join("");
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
})();
