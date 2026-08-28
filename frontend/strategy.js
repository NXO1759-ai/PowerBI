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

  /* The dev server has no serverless functions, so API calls from a
     localhost session go to the deployed site instead of 404ing. */
  var API_BASE = /^(localhost|127\.)/.test(location.hostname)
    ? "https://www.chineduokeke.mba" : "";
  var LIVE = {};   /* tickers merged from the on-demand endpoint */

  function indexEntry(t) {
    for (var i = 0; i < INDEX.length; i++) if (INDEX[i][0] === t) return INDEX[i];
    return null;
  }
  function ensureIndustryOption(ind) {
    var sel = $("industry-select");
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === ind) return;
    }
    var o = document.createElement("option");
    o.value = ind;
    o.textContent = ind + " (live)";
    sel.appendChild(o);
  }
  function addToCohorts(t) {
    var c = PANEL[t];
    var arr = (BY_INDUSTRY[c.industry] = BY_INDUSTRY[c.industry] || []);
    var present = false;
    for (var i = 0; i < arr.length; i++) if (arr[i].ticker === t) present = true;
    if (!present) arr.push({ ticker: t, name: c.name, industry: c.industry,
                             sector: c.sector, years: c.years });
    ensureIndustryOption(c.industry);
  }

  var LIVE_PEER_INFO = {};

  /**
   * Segment tables and the risk register come from weekly builds for
   * covered companies; a live company gets both parsed on demand from
   * its own filings — same parsers, same shape — and the blocks redraw
   * when the data lands.
   */
  function pullFilingDetail(ticker, cik, force) {
    var qs = "?ticker=" + encodeURIComponent(ticker) + "&cik=" + encodeURIComponent(cik) +
      (force ? "&force=1" : "");
    if (force || !(window.SEGMENT_DATA || {})[ticker]) {
      fetch(API_BASE + "/api/segments" + qs)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (p) {
          if (!p) return;
          window.SEGMENT_DATA = window.SEGMENT_DATA || {};
          window.SEGMENT_DATA[ticker] = p;
          if (state.ticker === ticker && state.view === "company") renderDisaggregation();
        }).catch(function () {});
    }
    if (force || !(window.RISK_DATA || {})[ticker]) {
      fetch(API_BASE + "/api/risks?cik=" + encodeURIComponent(cik) + (force ? "&force=1" : ""))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (p) {
          if (!p) return;
          window.RISK_DATA = window.RISK_DATA || {};
          window.RISK_DATA[ticker] = p;
          if (state.ticker === ticker && state.view === "company") renderRiskRegister();
        }).catch(function () {});
    }
  }

  /**
   * A company outside the exported panel: pull it, and — when its
   * industry is thin here — pull the largest listed filers sharing its
   * SIC code as well, so structure, pools and ranks are computed over a
   * real cohort instead of degrading.
   */
  function setCompanyLive(ticker, force) {
    var row = indexEntry(ticker);
    if (!row) {
      $("status").textContent = ticker + " is not in the SEC company index.";
      return;
    }
    $("status").textContent = "Pulling " + ticker +
      " from SEC EDGAR — and its peer set if the covered panel runs thin …";
    var base = API_BASE + "/api/panel?ticker=" + encodeURIComponent(ticker) +
      "&cik=" + encodeURIComponent(row[1]);
    fetch(base + (force ? "&force=1" : ""))
      .then(function (r) {
        if (!r.ok) return r.json().then(function (b) {
          throw new Error(b && b.detail ? b.detail : "HTTP " + r.status);
        });
        return r.json();
      })
      .then(function (d) {
        PANEL[ticker] = d.company;
        LIVE[ticker] = true;
        addToCohorts(ticker);
        pullFilingDetail(ticker, row[1], !!force);
        var members = BY_INDUSTRY[d.company.industry] || [];
        if (members.length >= 4) return null;
        /* thin cohort: second call brings the peers; the subject is
           already cached server-side, so this costs only the peer pull */
        $("status").textContent = "Only " + (members.length - 1) +
          " covered peer" + (members.length === 2 ? "" : "s") + " in " +
          d.company.industry + " — pulling the industry live …";
        return fetch(base + "&peers=live").then(function (r) {
          return r.ok ? r.json() : null;
        }).then(function (d2) {
          if (d2 && Array.isArray(d2.peers)) {
            d2.peers.forEach(function (p) {
              if (!PANEL[p.ticker]) {
                PANEL[p.ticker] = p;
                LIVE[p.ticker] = true;
                addToCohorts(p.ticker);
              }
            });
            LIVE_PEER_INFO[ticker] = {
              method: d2.peerMethod || "industry code",
              peers: d2.peers.map(function (p) { return p.ticker; }),
              notes: d2.peerNotes || []
            };
          }
        });
      })
      .then(function () {
        $("status").textContent = "";
        setCompany(ticker);
      })
      .catch(function (e) {
        $("status").textContent = "Could not pull " + ticker + ": " +
          (e && e.message ? e.message : "SEC unavailable") + ".";
      });
  }

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
    advantageSpread: { label: "Advantage spread", formula: "Company 5-yr average ROIC − peer median over the SAME years",
      definition: "How much more (or less) this company earns on its capital than the typical firm it competes with, averaged over five matched years.",
      interpretation: "A positive spread held for years is the financial signature of competitive advantage. One good year is noise; a decade is a moat.",
      watch: "Both sides are measured over the same years — comparing a company's best five against a cohort's different five would not be a comparison." },
    rankAmong: { label: "Peer rank", formula: "Position of this company's ROIC among all covered peers, 1 = best",
      definition: "Where the return sits in the industry's pecking order this year.",
      interpretation: "Rank moves faster than the spread, so it is the earlier warning. Watch for a stable spread with a slipping rank — peers improving underneath.",
      watch: "Counted over listed peers only; the true field is larger." },
    altmanZ: { label: "Distress score", formula: "1.2·WC/TA + 1.4·RE/TA + 3.3·EBIT/TA + 0.6·MVE/TL + 1.0·Sales/TA",
      definition: "Altman's Z-score, a weighted blend of liquidity, retained profitability, earning power, leverage and asset productivity that predicts bankruptcy risk.",
      interpretation: "Above 2.99 is the safe zone, below 1.81 the distress zone, and between them the zone of ignorance where the model refuses to call it.",
      watch: "Designed for manufacturers; readings for banks, insurers and asset-light firms are not comparable." },
    earningsQuality: { label: "Earnings quality", formula: "Operating cash flow ÷ net income",
      definition: "How many dollars of actual cash each reported dollar of profit brought in.",
      interpretation: "Sustained readings near or above 1 mean profit is real cash. Below 1 for long stretches means earnings run ahead of cash — accruals are doing the work.",
      watch: "One weak year is often timing (working capital swings); a trend is the signal." },
    fcf: { label: "Free cash flow", formula: "Operating cash flow − capital expenditure",
      definition: "The cash the business generates after maintaining and expanding its asset base — what is genuinely available for dividends, buybacks, debt or acquisitions.",
      interpretation: "The number the valuation ultimately rests on. Compare its trend with reported profit: diverging lines ask why.",
      watch: "Capex lumps; a big build year depresses it without meaning deterioration." },
    netDebtToEbitda: { label: "Net debt to profit", formula: "(Debt − cash and investments) ÷ EBITDA",
      definition: "How many years of pre-depreciation operating profit it would take to repay net borrowings.",
      interpretation: "Below 1× is conservative, 2–3× is common for stable cash generators, above 4× is leveraged territory where covenants and refinancing start to matter.",
      watch: "EBITDA overstates debt capacity for capital-hungry businesses, since depreciation there is a real recurring cost." },
    revenue: { label: "Revenue", formula: "Total revenue for the fiscal year, as filed",
      definition: "The top line: everything customers paid for goods and services in the period.",
      interpretation: "Scale on its own says little — read it with growth, margin and the return on the capital behind it.",
      watch: "Resolved across the several XBRL tags companies use; banks report revenue net of interest expense." },
    cagr: { label: "Compound growth", formula: "(End ÷ start)^(1/years) − 1",
      definition: "The single steady annual rate that would take revenue from the start value to the end value.",
      interpretation: "Smooths the path into one number. Compare the 5-year against the full window: faster recent growth means acceleration.",
      watch: "Endpoint-sensitive — a start year in a trough manufactures growth. That is why both windows are shown." },
    roe: { label: "Return on equity", formula: "Net income (incl. minority interests) ÷ average total equity",
      definition: "The return earned on the shareholders' portion of the balance sheet.",
      interpretation: "The headline profitability rate — but leverage inflates it, which is why the view pairs it with return on invested capital, which leverage cannot flatter.",
      watch: "Buybacks shrink equity and mechanically raise ROE with no change in the business." },
    peerShare: { label: "Share of covered peers", formula: "Company revenue ÷ combined revenue of covered industry peers",
      definition: "This company's slice of the revenue earned by the large listed firms in its industry group.",
      interpretation: "A position measure among major rivals — who is winning the visible fight.",
      watch: "NOT market share: private, foreign and smaller competitors sit outside the panel, so the true denominator is larger and this is an upper bound." },
    gmGap: { label: "Gross margin vs peers", formula: "Company gross margin − peer median gross margin",
      definition: "How much more of each sales dollar survives direct costs here than at the typical peer.",
      interpretation: "A wide positive gap is the price-and-mix route to advantage: charging more, selling richer product, or buying better.",
      watch: "A filing cannot separate price from mix from input cost — the statements do not distinguish them." },
    backlog: { label: "Contracted backlog", formula: "Remaining performance obligations, as disclosed",
      definition: "Revenue customers have already signed for that has not yet been recognised — contracted, not forecast.",
      interpretation: "The closest thing in a filing to a sales pipeline, and harder than one: every dollar is under contract.",
      watch: "Disclosed under ASC 606 since 2018 and mainly by subscription and long-contract businesses; absence is a business-model fact, not a red flag." },
    backlogCover: { label: "Backlog cover", formula: "Contracted backlog ÷ one year's revenue",
      definition: "How much of a year's revenue is already signed before the year begins.",
      interpretation: "Above 100% means the coming year is substantially pre-sold; the growth question shifts to what NEW business adds on top.",
      watch: "Backlog recognises over multiple years, so cover above 100% does not mean next year is fully guaranteed." },
    deferredRevenue: { label: "Deferred revenue growth", formula: "Change in customer prepayments over the year",
      definition: "Money customers paid before receiving the product — demand already banked on the balance sheet.",
      interpretation: "For subscription businesses this moves BEFORE recognised revenue does, making it the closest filed proxy for demand direction.",
      watch: "Shrinking prepayments is the direction that accompanies weakening demand or shortening contract terms." },
    acqSpend: { label: "Acquisition spend per new dollar", formula: "Selling & marketing expense ÷ revenue growth in the year",
      definition: "How much selling effort it took to add each incremental dollar of revenue.",
      interpretation: "The filed shadow of customer acquisition cost. Rising ratios mean growth is getting more expensive to buy.",
      watch: "Only computable when the filer splits selling from overhead, and meaningless in a shrinking year." },
    assetTurns: { label: "Asset turns", formula: "Revenue ÷ average total assets",
      definition: "Revenue produced per dollar of assets — how hard the whole balance sheet works.",
      interpretation: "The volume half of the return equation: return on assets is margin × turns. Retailers run high turns and thin margins; software the reverse.",
      watch: "Only comparable within an industry; across industries it mostly measures business model." },
    inventoryTurns: { label: "Inventory turns", formula: "Cost of sales ÷ average inventory",
      definition: "How many times a year the shelf is sold through and replaced.",
      interpretation: "The filed proxy for operational efficiency and capacity discipline. Falling turns with rising inventory is the classic early sign of demand softening.",
      watch: "Uses cost of sales, not revenue, so margin changes cannot masquerade as efficiency changes." },
    cashCycle: { label: "Cash conversion cycle", formula: "Days receivables + days inventory − days payables",
      definition: "How many days cash is locked up between paying suppliers and being paid by customers.",
      interpretation: "Negative is the elite outcome: customers fund the operation before suppliers are paid, so growth GENERATES cash instead of consuming it.",
      watch: "Days payable uses purchases (cost of sales adjusted for inventory movement), not cost of sales alone." },
    rndIntensity: { label: "R&D intensity", formula: "Research and development expense ÷ revenue",
      definition: "The share of every sales dollar reinvested into the next product.",
      interpretation: "A strategy variable, not a cost: read it against peers. Outspending the median while holding margin is investing from strength.",
      watch: "US GAAP expenses R&D immediately, so heavy investors' current profits are understated relative to capitalising regimes." },
    netDebt: { label: "Net debt", formula: "Short and long-term borrowings − cash and liquid investments",
      definition: "What would remain owed if every liquid dollar were used to repay borrowings today.",
      interpretation: "Negative net debt (net cash) removes refinancing risk from the story entirely and is itself a strategic weapon — the balance sheet to retaliate, acquire or outlast.",
      watch: "Insurers' investment portfolios back policy liabilities and are not spare cash; their figures read differently." },
    interestCover: { label: "Interest cover", formula: "Operating profit ÷ interest expense",
      definition: "How many times over the year's operating profit pays the year's interest bill.",
      interpretation: "Above 8× interest is an afterthought; below 3× debt is steering decisions; near 1× the lenders are effectively in charge.",
      watch: "Computed on operating profit, so one bad operating year can crater it while cash reserves remain ample." },
    marginVol: { label: "Margin volatility", formula: "Standard deviation of the operating margin across the window",
      definition: "How widely profitability swings around its own average, year to year.",
      interpretation: "A structural risk measure the statements genuinely evidence: high volatility means a single year is a poor guide to the next, and forecasts deserve wide error bars.",
      watch: "Cyclicals are volatile by nature — read against the industry, not against zero." },
    price: { label: "Price", formula: "Latest close from the market feed",
      definition: "What the market currently pays for one share.",
      interpretation: "Alone it means nothing — only against shares outstanding (market value) or per-share earnings does it say anything.",
      watch: "Every other figure in this view is reported by the business; this one is voted on daily by strangers." },
    priceChange: { label: "Change", formula: "Move on the latest session",
      definition: "The day's percentage move.",
      interpretation: "Noise on any given day. It appears here for orientation, not analysis.",
      watch: "A one-day move answers no strategic question." },
    marketValue: { label: "Market value", formula: "Share price × shares outstanding",
      definition: "The price of the whole equity at today's quote.",
      interpretation: "The market's verdict on everything this page measures. Compare with the filed figures: value is priced, performance is reported, and the gap between them is the debate.",
      watch: "Moves daily; the filed figures move quarterly." },
    priceRange: { label: "Trading range", formula: "Low to high across the sessions the feed returned",
      definition: "Where the price has travelled in the returned window, and where it sits in that range now.",
      interpretation: "A cheap read on momentum and drawdown without a chart.",
      watch: "Labelled with the session count — a six-month window is not passed off as a year." },
    producerPricesYoY: { label: "Producer prices", formula: "Producer price index, all commodities, vs a year ago",
      definition: "What producers charge at the factory gate — the input-cost pipeline that reaches consumer prices a quarter or two later.",
      interpretation: "A leading cost signal: when it runs ahead of consumer inflation, margins are being squeezed from below and the hedge-or-renegotiate window is open.",
      watch: "Commodity-heavy, so energy swings dominate single months." },
    wageGrowthYoY: { label: "Wage growth", formula: "Average hourly earnings, private sector, vs a year ago",
      definition: "How fast the price of labour is rising.",
      interpretation: "The line to budget headcount costs and merit pools against, and a lagging confirmation of labour-market tightness.",
      watch: "Mix effects distort it: laying off low-wage workers pushes the average up." },
    cpi: { label: "Headline inflation", formula: "Consumer price index vs the same month a year ago",
      definition: "How much more the average consumer basket costs than a year ago.",
      interpretation: "Inflation flatters nominal revenue growth while the capital base reprices slowly, so reported returns rise mechanically — deflate before applauding.",
      watch: "A lagging indicator: it confirms where the economy has been, not where it goes." },
    coreCpi: { label: "Core inflation", formula: "CPI excluding food and energy, vs a year ago",
      definition: "Inflation with the two most volatile components removed.",
      interpretation: "The reading central banks steer by, because it is the persistent part.",
      watch: "Lagging, like headline." },
    fedFunds: { label: "Policy rate", formula: "Effective federal funds rate",
      definition: "The overnight rate the central bank targets — the price of money at the shortest end.",
      interpretation: "Sets the floor under every discount rate and the cost of floating-rate debt. Policy reacts to lagging data, which is why it is grouped as lagging.",
      watch: "The level matters less than the direction and the market's expectation of it." },
    treasury10: { label: "10-year Treasury", formula: "Constant-maturity 10-year yield",
      definition: "The risk-free rate over a decade — the base of every discount rate applied to this company's future cash flows.",
      interpretation: "When it rises, all future cash flows are worth less today; long-duration growth stories are hit hardest.",
      watch: "A market price, so it embeds expectations — it moves before the economy does." },
    treasury2: { label: "2-year Treasury", formula: "Constant-maturity 2-year yield",
      definition: "The market's bet on where policy rates average over the next two years.",
      interpretation: "The near end of the curve; read against the 10-year for the cycle signal.",
      watch: "Tracks expected policy more than growth." },
    curveSpread: { label: "Curve, 10y minus 2y", formula: "10-year yield − 2-year yield",
      definition: "The slope of the yield curve between two and ten years.",
      interpretation: "The most-watched leading indicator there is: inversions (negative readings) have preceded every US recession in the modern record, with a lag of a year or so.",
      watch: "It has also fired early or stayed inverted for long stretches — a signal, not a timer." },
    initialClaims: { label: "Initial jobless claims", formula: "New unemployment insurance claims, weekly",
      definition: "How many people filed for unemployment for the first time last week.",
      interpretation: "The fastest labour-market signal published — leading, weekly, and hard to spin. A sustained rise is the cycle turning.",
      watch: "Noisy week to week; the four-week trend is the read." },
    buildingPermits: { label: "Building permits", formula: "Housing units authorised, annualised",
      definition: "Construction approved but not yet started — building activity that is committed to happen.",
      interpretation: "A classic leading indicator: housing is the most rate-sensitive sector, so it turns first when money tightens or eases.",
      watch: "Annualised monthly data; revisions are common." },
    consumerSentiment: { label: "Consumer sentiment", formula: "University of Michigan survey index",
      definition: "How households say they feel about their finances and the economy.",
      interpretation: "Leading, because spending intentions precede spending. Depressed sentiment with resilient spending data is a tension that eventually resolves one way.",
      watch: "A survey — it measures mood, and mood can detach from behaviour for a long time." },
    payrolls: { label: "Payroll growth", formula: "Nonfarm payroll employment vs a year ago",
      definition: "How fast the economy is adding jobs.",
      interpretation: "The coincident indicator: it moves with the economy, not ahead of it. Growth near zero is stall speed.",
      watch: "Heavily revised; the first print is an estimate." },
    indProd: { label: "Industrial production", formula: "Output of factories, mines and utilities vs a year ago",
      definition: "The physical-output pulse of the goods economy.",
      interpretation: "Coincident, and the cleanest read on the industrial cycle specifically — services can grow while this contracts.",
      watch: "A shrinking share of the modern economy, so weakness here is a sector story as much as a cycle one." },
    retailSales: { label: "Retail sales", formula: "Retail and food-service sales vs a year ago, nominal",
      definition: "What consumers actually spent, in dollars.",
      interpretation: "Coincident. Compare against inflation: nominal growth below the inflation rate means real volumes are FALLING.",
      watch: "Nominal — inflation is inside this number." },
    unemployment: { label: "Unemployment rate", formula: "Unemployed share of the labour force",
      definition: "The share of people who want work and cannot find it.",
      interpretation: "Lagging: firms cut hours, then hiring, then people — so by the time this rises the downturn is established. Small rises from a cycle low matter more than the level.",
      watch: "Discouraged workers leaving the labour force can hold the rate down in a weak market." },

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
      card("cr4", "Firms covered", String(latest.firms),
        "Large listed US companies in this industry. Private and foreign rivals are outside the panel.") +
      card("cr4", "CR4", num(c.cr4, 0) + "%",
        isNum(crDelta) ? (crDelta >= 0 ? "Up " : "Down ") + Math.abs(crDelta).toFixed(0) +
          " points since " + first.year + " — " + (crDelta >= 0 ? "consolidating" : "fragmenting")
          : "Top four firms' combined revenue share") +
      card("hhi", "HHI", num(c.hhi, 0), c.band, "extension, not from the course") +
      card("revenue", "Industry revenue", money(latest.totalRevenue),
        isNum(revCagr) ? pct(revCagr) + " a year since " + first.year : "") +
      card("marginSpread", "Industry margin", pct(latest.industryMargin),
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
      card("peerShare", "Revenue share", pool ? pct(pool.revenueShare) : "—",
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
      card("gmGap", "Pre-tax margin", pct(d.pretaxMargin), "Profit before tax per dollar of sales") +
      card("assetTurns", "Asset turnover", isNum(d.assetTurnover) ? d.assetTurnover.toFixed(2) + "×" : "—",
        "Sales per dollar of average assets") +
      card("roe", "Equity multiplier", isNum(d.equityMultiplier) ? d.equityMultiplier.toFixed(2) + "×" : "—",
        "Average assets per dollar of average equity") +
      card("roe", "Pre-tax ROE", pct(d.pretaxRoe), "The three multiplied together");
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
      card("cagr", "Revenue CAGR", decomp ? pct(decomp.firmCagr) : "—",
        decomp ? "Over " + decomp.years + " years" : "") +
      card("cagr", "Industry CAGR", decomp ? pct(decomp.industryCagr) : "—",
        "Same window, covered peers") +
      card("shareEffect", "Share effect", decomp ? pp(decomp.shareEffect) : "—",
        decomp && decomp.outgrewIndustry === true ? "Grew faster than the industry — gained share"
          : decomp && decomp.outgrewIndustry === false ? "Grew slower than the industry — lost share" : "") +
      card("marginSpread", "Margin trajectory", gq ? pp(gq.marginChange) : "—",
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
        gap: "the price-performance trade-off offered by alternatives, and buyers' cost of switching to them. Settling it needs evidence from beyond the filings." }
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
      card("persistence", "Held above the median",
        pers ? (pers.yearsAbove + " of " + pers.years + " yrs") : "—",
        pers ? pers.verdict : "") +
      card("rankAmong", "Rank this year", stRoic ? (stRoic.rank + " of " + stRoic.of) : "—",
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
    var pi = LIVE_PEER_INFO[state.ticker];
    if (pi && pi.peers.length) {
      parts.push("<span class='soft'>Peer set (" + esc(pi.method) + "): " +
        pi.peers.map(esc).join(", ") +
        ". Every figure comes from each company's own SEC filings." +
        (pi.notes.length ? " Named but not comparable: " + esc(pi.notes.join("; ")) + "." : "") +
        "</span>");
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
      card("altmanZ", "Distress score", (z && isNum(z.score)) ? num(z.score, 2) : "—",
        (z && z.zone) ? z.zone : "Not applicable to this balance sheet") +
      card("earningsQuality", "Earnings quality", (eq && isNum(eq.ratio)) ? num(eq.ratio, 2) + "×" : "—",
        "Operating cash flow per dollar of reported profit") +
      card("fcf", "Free cash flow", isNum(fcf) ? money(fcf) : "—",
        "Operating cash flow after capital expenditure") +
      card("netDebtToEbitda", "Net debt to profit",
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
      card("revenue", "Revenue", money(ctx.period.incomeStatement.revenue), "Fiscal " + year) +
      card("cagr", "Growth, 5-yr", isNum(cagr5) ? pct(cagr5) : "—", "Compound annual") +
      card("cagr", "Growth, full window", isNum(cagr10) ? pct(cagr10) : "—",
        revs.length ? (revs[0].year + "–" + revs[revs.length - 1].year) : "") +
      card("roic", "Return on invested capital", pct(roicNow),
        "Operating profit over the capital behind it",
        S.ebitIsSynthetic(ctx.period) ? "operating profit rebuilt" : null) +
      card("roe", "Return on equity", pct(roeNow), "On average total equity") +
      card("fcf", "Free cash flow", isNum(fcf) ? money(fcf) : "—", "After capital expenditure");

    renderMargins(ctx);
    renderCash(ctx);

    /* The segment and geography blocks below render from the annual
       filing; renderDisaggregation owns the fallback note when a filer
       tags neither. */
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
      card("peerShare", "Share of covered peers", mine ? pct(mine.revenueShare) : "—",
        "Of " + (iy ? iy.poolFirms : 0) + " firms' combined revenue — an upper bound, not market share") +
      card("poolCapture", "Profit share", mine ? pct(mine.profitShare) : "—",
        "Share of the peer set's combined operating profit") +
      card("poolCapture", "Value capture", (mine && isNum(mine.poolCaptureRatio)) ? num(mine.poolCaptureRatio, 2) + "×" : "—",
        "Profit share divided by revenue share") +
      card("gmGap", "Gross margin vs peers", route ? pp(route.grossMarginGap) : "—",
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
      card("backlog", "Contracted backlog", latest && isNum(latest.backlog) ? money(latest.backlog) : "—",
        latest && isNum(latest.backlog) ? "Signed revenue not yet recognised" : "Not disclosed by this filer") +
      card("backlogCover", "Backlog cover", latest && isNum(latest.coverage) ? pct(latest.coverage) : "—",
        "Backlog as a share of one year's revenue") +
      card("deferredRevenue", "Deferred revenue growth", isNum(deferredGrowth) ? pct(deferredGrowth) : "—",
        "Customer prepayments — demand already banked") +
      card("acqSpend", "Acquisition spend per new dollar", isNum(acquisition) ? num(acquisition, 2) + "×" : "—",
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
      card("assetTurns", "Asset turns", isNum(assetT) ? num(assetT, 2) + "×" : "—",
        stAt ? ("Revenue per dollar of assets · " + rankNote(stAt)) : "Revenue per dollar of average assets") +
      card("inventoryTurns", "Inventory turns", isNum(invTurns) ? num(invTurns, 1) + "×" : "—",
        isNum(invTurns) ? "Cost of sales over average inventory" : "No inventory reported") +
      card("cashCycle", "Cash conversion cycle", isNum(wc.cashCycle) ? num(wc.cashCycle, 0) + " days" : "—",
        "Days sales outstanding plus inventory days, less days payable") +
      card("rndIntensity", "R&D as share of sales", pct(rnd),
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
      card("netDebt", "Net debt", isNum(debt - cash) ? money(debt - cash) : "—",
        (debt - cash) < 0 ? "Net cash — more liquid assets than borrowings" : "Borrowings net of cash and investments") +
      card("interestCover", "Interest cover", isNum(cover) ? num(cover, 1) + "×" : "—",
        isNum(cover) ? "Operating profit per dollar of interest" : "No material interest expense") +
      card("marginVol", "Margin volatility", isNum(vol) ? pp(vol) : "—",
        "Standard deviation of the operating margin across the window") +
      card("altmanZ", "Distress score", (z && isNum(z.score)) ? num(z.score, 2) : "—",
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

  }

  /* ---------- disaggregated revenue, from the annual filing ---------- */

  function segData() { return (window.SEGMENT_DATA || {})[state.ticker] || null; }

  /* Member names arrive as XBRL camel case. A small map catches the ones
     a splitter mangles; everything else is split on case boundaries. */
  var MEMBER_NAMES = {
    IPhone: "iPhone", IPad: "iPad", Mac: "Mac",
    WearablesHomeandAccessories: "Wearables, Home and Accessories",
    US: "United States", NonUs: "Outside the United States",
    CN: "China", TW: "Taiwan", JP: "Japan", GB: "United Kingdom",
    ChinaIncludingHongKong: "China (incl. Hong Kong)",
    OtherCountries: "Other countries",
    EuropeMiddleEastAfrica: "Europe, Middle East & Africa",
    XBOX: "Xbox",
    MicrosoftThreeSixFiveCommercialProductsAndCloudServices: "Microsoft 365 Commercial",
    MicrosoftThreeSixFiveConsumerProductsAndCloudServices: "Microsoft 365 Consumer",
    ServiceOther: "Service and other", Service: "Services", Product: "Products"
  };
  function humanMember(k) {
    if (MEMBER_NAMES[k]) return MEMBER_NAMES[k];
    return k
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/\bAnd\b/g, "and").replace(/\bOf\b/g, "of").replace(/\bThe\b/g, "the");
  }

  /**
   * One disaggregation axis as a table: latest year's members, their share
   * of the disclosed total, growth across the years the filing shows, and
   * — for business segments — the segment's own operating result.
   *
   * Shares are of the SUM OF THE DISCLOSED MEMBERS, not of consolidated
   * revenue: after the builder drops aggregate members the two normally
   * agree, and when a filer discloses only a partial split the shares
   * still describe the split rather than silently understating it.
   */
  function renderAxis(kind, hostId, withOperating) {
    var host = $(hostId);
    if (!host) return;
    var sd = segData();
    var by = sd && sd.revenue && sd.revenue[kind];
    var ends = by ? Object.keys(by).sort() : [];
    if (!ends.length) {
      host.innerHTML = "<p class='hint'>" +
        (sd ? "The latest annual filing tags no " +
          (kind === "geography" ? "geographic" : kind === "product" ? "product-level" : "segment") +
          " revenue breakdown, so none is shown."
        : "No annual-filing detail is loaded for " + esc(state.ticker) + ".") + "</p>";
      return;
    }
    var latest = ends[ends.length - 1];
    var earliest = ends[0];
    var span = (new Date(latest) - new Date(earliest)) / (365.25 * 864e5);
    var rows = Object.entries(by[latest]).sort(function (a, b) { return b[1] - a[1]; });
    var total = rows.reduce(function (a, r) { return a + r[1]; }, 0);
    var oi = (withOperating && sd.segmentOperatingIncome && sd.segmentOperatingIncome[latest]) || null;

    /* The newest discrete quarter, from the 10-Q, with its prior-year
       comparative for growth. */
    var qBy = sd.quarterly && sd.quarterly[kind];
    var qEnds = qBy ? Object.keys(qBy).sort() : [];
    var qLatest = qEnds.length ? qEnds[qEnds.length - 1] : null;
    var qPrev = null;
    if (qLatest) {
      var target = new Date(qLatest) - 365.25 * 864e5, bestGap = Infinity;
      qEnds.forEach(function (e) {
        var gap = Math.abs(new Date(e) - target);
        if (gap < bestGap) { bestGap = gap; qPrev = e; }
      });
      if (bestGap > 45 * 864e5) qPrev = null;
    }
    var hasQ = qLatest && rows.some(function (r) { return isNum(qBy[qLatest][r[0]]); });

    /* Some filers tag only part of the total — NextEra's annual note tags
       one segment of two. Shares of a partial split read as findings and
       are not, so the shortfall is measured against the company's own
       consolidated revenue and said out loud. */
    var covNote = "";
    var me = PANEL[state.ticker];
    if (me && total > 0) {
      var endYear = Number(latest.slice(0, 4));
      var cons = null;
      [endYear, endYear - 1].some(function (y) {
        var row = me.years[y];
        var v = row ? get(row, "revenue") : null;
        if (isNum(v) && v > 0) { cons = v; return true; }
        return false;
      });
      if (isNum(cons) && total / cons < 0.7 && kind !== "product") {
        covNote = " The filing tags only " + pct(total / cons) +
          " of consolidated revenue on this axis, so the shares describe the disclosed portion, not the whole company.";
      }
    }

    var html = "<div class='scroll-x'><table class='grid'><thead><tr>" +
      "<th scope='col'>FY ended " + esc(latest) + "</th>" +
      "<th scope='col' class='num'>Revenue</th>" +
      "<th scope='col' class='num'>Share</th>" +
      (span >= 0.9 ? "<th scope='col' class='num'>Growth, " + Math.round(span) + "-yr</th>" : "") +
      (oi ? "<th scope='col' class='num'>Op income</th><th scope='col' class='num'>Op margin</th>" : "") +
      (hasQ ? "<th scope='col' class='num'>3 mo to " + esc(qLatest.slice(5)) + "</th>" +
              "<th scope='col' class='num'>vs yr ago</th>" : "") +
      "</tr></thead><tbody>";
    rows.forEach(function (r) {
      var name = r[0], v = r[1];
      var g = null;
      if (span >= 0.9 && by[earliest] && isNum(by[earliest][name]) && by[earliest][name] > 0) {
        g = Math.pow(v / by[earliest][name], 1 / span) - 1;
      }
      html += "<tr><td>" + esc(humanMember(name)) + "</td>" +
        "<td class='num'>" + money(v) + "</td>" +
        "<td class='num'>" + pct(total > 0 ? v / total : null) + "</td>" +
        (span >= 0.9 ? "<td class='num'>" + (isNum(g) ? pct(g) : "—") + "</td>" : "");
      if (oi) {
        var o = oi[name];
        html += "<td class='num'>" + (isNum(o) ? money(o) : "—") + "</td>" +
          "<td class='num'>" + (isNum(o) && v > 0 ? pct(o / v) : "—") + "</td>";
      }
      if (hasQ) {
        var qv = qBy[qLatest][name];
        var qg = (isNum(qv) && qPrev && isNum(qBy[qPrev][name]) && qBy[qPrev][name] > 0)
          ? qv / qBy[qPrev][name] - 1 : null;
        html += "<td class='num'>" + (isNum(qv) ? money(qv) : "—") + "</td>" +
          "<td class='num'>" + (isNum(qg) ? pct(qg) : "—") + "</td>";
      }
      html += "</tr>";
    });
    html += "</tbody></table></div>";

    var top = rows[0];
    var sentence = "";
    if (top && total > 0) {
      sentence = esc(humanMember(top[0])) + " is " + pct(top[1] / total) +
        " of " + (kind === "geography" ? "revenue by destination" :
                  kind === "product" ? "disclosed product revenue" : "segment revenue");
      if (span >= 0.9 && by[earliest] && isNum(by[earliest][top[0]]) && by[earliest][top[0]] > 0) {
        var tg = Math.pow(top[1] / by[earliest][top[0]], 1 / span) - 1;
        sentence += ", growing " + pct(tg) + " a year over the filing's " +
          Math.round(span) + "-year window";
      }
      sentence += ".";
      if (hasQ && qPrev) {
        var movers = rows.map(function (r) {
          var qv = qBy[qLatest][r[0]], pv = qBy[qPrev][r[0]];
          return (isNum(qv) && isNum(pv) && pv > 0)
            ? { n: humanMember(r[0]), g: qv / pv - 1 } : null;
        }).filter(Boolean).sort(function (a, b) { return b.g - a.g; });
        if (movers.length) {
          sentence += " In the latest quarter, " + esc(movers[0].n) + " " +
            (movers[0].g >= 0 ? "grew " : "shrank ") + pct(Math.abs(movers[0].g)) +
            " on a year earlier" +
            (movers.length > 1 ? ", " + esc(movers[movers.length - 1].n) + " " +
              (movers[movers.length - 1].g >= 0 ? "grew " : "shrank ") +
              pct(Math.abs(movers[movers.length - 1].g)) : "") + ".";
        }
      }
      if (oi && top && isNum(oi[top[0]]) && top[1] > 0) {
        var margins = rows.filter(function (r) { return isNum(oi[r[0]]) && r[1] > 0; })
          .map(function (r) { return { n: humanMember(r[0]), m: oi[r[0]] / r[1] }; })
          .sort(function (a, b) { return b.m - a.m; });
        if (margins.length >= 2) {
          sentence += " Margins run from " + pct(margins[margins.length - 1].m) + " (" +
            esc(margins[margins.length - 1].n) + ") to " + pct(margins[0].m) + " (" +
            esc(margins[0].n) + ") — where the mix shifts is where the consolidated margin will go.";
        }
      }
    }
    html += "<p class='chart-caption'>" + sentence + covNote +
      " <span class='soft'>From the segment and disaggregation notes of the " +
      esc(sd.form) + " for the period ended " + esc(sd.reportDate) +
      (hasQ && sd.qReportDate ? ", and the 10-Q for the quarter ended " + esc(sd.qReportDate) : "") +
      " — the same tables printed in the filings, read in their machine-readable form.</span></p>";
    host.innerHTML = html;
  }

  function renderDisaggregation() {
    renderAxis("segment", "seg-block", true);
    renderAxis("geography", "geo-block", false);
    renderAxis("product", "product-block", false);
  }

  /* ---------- macro backdrop ---------- */
  var MACRO = { data: null, failed: false };
  function renderMacro(force) {
    var host = $("macro-block");
    if (!host) return;
    if (MACRO.data && !force) { paintMacro(MACRO.data); return; }
    host.innerHTML = "<p class='hint' role='status'>Loading the macro series…</p>";
    fetch(API_BASE + "/api/macro" + (force ? "?force=1" : ""))
      .then(function (r) {
        if (r.status === 503) throw new Error("unconfigured");
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(function (d) { MACRO.data = d; MACRO.failed = false; paintMacro(d); })
      .catch(function (e) {
        MACRO.failed = true;
        host.innerHTML = "<p class='hint'>" +
          (String(e.message) === "unconfigured"
            ? "The macro feed is not configured on this deployment — it needs a key for the " +
              "Federal Reserve's statistical service. Every figure above comes from filings " +
              "and is unaffected."
            : "The macro series are unavailable right now. Every figure above comes from " +
              "filings and is unaffected.") + "</p>";
      });
  }
  /* =====================================================================
     MACRO DRILL-DOWN

     Clicking any backdrop or cycle card opens a detail: a decade of the
     series, where today sits in that decade, which way it is trending,
     and what the reading has historically meant for operating decisions
     — tuned to the selected company's sector. Every sentence is
     computed or templated from the series itself; nothing is forecast,
     and the page says how each signal has failed before.
     ===================================================================== */

  var SECTOR_BUCKET = {
    "Financials": "rate", "Real Estate": "rate", "Utilities": "rate",
    "Consumer Discretionary": "consumer", "Consumer Staples": "consumer",
    "Communication Services": "consumer",
    "Industrials": "industrial", "Materials": "industrial", "Energy": "industrial",
    "Information Technology": "growth", "Health Care": "growth"
  };

  /* Per-series: where it lives in the payload, how to print it, its
     lead/lag horizon, the operating read, and the sector-specific note.
     The horizons and action reads follow the standard business-cycle
     playbook: leading indicators steer commitments you can still change,
     lagging ones price the commitments you already made. */
  var MACRO_META = {
    curveSpread: { path: ["leading", "curveSpread"], kind: "pp", group: "Leading", horizon: "12–18 months",
      read: function (v) {
        return v < 0
          ? "The curve is inverted. Inversions have preceded every US recession of the modern record by roughly a year, which is why an inverted curve argues for shifting capital allocation away from aggressive expansion and toward debt paydown and cash — optionality is cheap to hold and expensive to need."
          : "The curve is positive. A steepening curve after a cut cycle is the classic recovery signature — historically the moment leverage and expansion started paying again.";
      },
      fail: "It has also fired early and stayed inverted for long stretches — a signal for positioning, never a timer.",
      sector: { rate: "For a rate business this IS the operating environment: the spread between short funding and long lending is the gross margin of banking.",
        consumer: "Consumer credit priced off the short end tightens fastest when the curve inverts — watch financed purchases (autos, homes, big tickets) before the rest of the basket.",
        industrial: "Capex cycles follow the curve with a lag: an inversion today is the order-book softness of next year.",
        growth: "Long-duration cash flows discount off the long end — the level of the 10-year moves this sector's valuations more than the spread does." } },
    treasury10: { path: ["leading", "treasury10y"], kind: "pct2", group: "Leading", horizon: "immediate",
      read: function (v) {
        return "Every future dollar this company earns is discounted off this rate. At " + (v * 100).toFixed(2) + "%, a dollar a decade out is worth about " + (100 / Math.pow(1 + v, 10)).toFixed(0) + " cents today — when the rate rises, distant cash flows lose value first and fastest.";
      },
      fail: "A market price, not a policy: it embeds expectations and can reverse without warning.",
      sector: { rate: "Reinvestment yield for insurers and the long side of every bank book — rising yields are earnings relief here even as they bruise bond portfolios.",
        growth: "The denominator of every growth valuation: this sector's multiples move inversely with this number more than any other." } },
    treasury2: { path: ["leading", "treasury2y"], kind: "pct2", group: "Leading", horizon: "9–18 months",
      read: function (v) {
        return "The market's average expectation for the policy rate over the next two years sits at " + (v * 100).toFixed(2) + "%. Read it against the policy rate itself: the gap is the easing or tightening the market has already priced.";
      },
      fail: "Expectations reprice violently around inflation surprises.",
      sector: { rate: "Floating-rate books reprice off the short end — this is next year's funding cost, visible today." } },
    producerPricesYoY: { path: ["leading", "producerPricesYoY"], kind: "pct", group: "Leading", horizon: "3–6 months",
      read: function (v, d) {
        var cpi = statOf(d, "cpi");
        var gap = cpi && isNum(cpi.value) ? v - cpi.value : null;
        var s = "Wholesale prices are " + (v >= 0 ? "rising " : "falling ") + pct(Math.abs(v)) + " a year — input costs that reach the shelf a quarter or two later.";
        if (isNum(gap)) {
          s += gap > 0.01
            ? " Producer inflation is running " + pp(gap) + " AHEAD of consumer inflation: input costs are outrunning shelf prices, which is the margin-squeeze setup — the window to hedge inputs or renegotiate supply is before vendors move."
            : gap < -0.01
              ? " Producer inflation is running " + pp(gap) + " behind consumer inflation — the margin-friendly configuration, where costs fall faster than prices."
              : " Producer and consumer inflation are moving together.";
        }
        return s;
      },
      fail: "Commodity-heavy, so energy swings dominate it; the trend matters more than any print.",
      sector: { industrial: "The most direct cost line for this sector: what this index does, cost of sales does two quarters later.",
        consumer: "The gap between this and consumer prices is the sector's gross-margin forecast: costs rising faster than shelf prices squeeze first here." } },
    initialClaims: { path: ["leading", "initialClaims"], kind: "k", group: "Leading", horizon: "1–3 months",
      read: function (v, d, stat) {
        var s = "About " + num(v / 1000, 0) + " thousand people filed for unemployment for the first time last week — the fastest labour signal published.";
        if (stat && isNum(stat.yoy)) {
          s += stat.yoy > 0.10
            ? " Claims are up " + pct(stat.yoy) + " on a year ago: a sustained 10–20% rise has historically been the early warning of a slowdown — the trigger point for slowing hiring and preserving cash before the downturn is visible anywhere else."
            : stat.yoy < -0.05
              ? " Claims are down " + pct(Math.abs(stat.yoy)) + " on a year ago — a labour market still absorbing people, which argues the expansion has room."
              : " Claims are flat on a year ago — no early warning firing.";
        }
        return s;
      },
      fail: "Noisy week to week; act on the four-week trend, never one print.",
      sector: { consumer: "Discretionary spending is the first casualty of layoffs — this series leads this sector's demand by a quarter.",
        rate: "Rising claims become rising credit losses with a two-to-three-quarter lag — loan books feel this before earnings show it." } },
    buildingPermits: { path: ["leading", "buildingPermits"], kind: "M", group: "Leading", horizon: "6–9 months",
      read: function (v, d, stat) {
        return "Builders hold permits for about " + num(v / 1000, 2) + " million homes (annualised) — construction committed but not yet started. Housing is the most rate-sensitive sector in the economy, so permits turn first when money tightens or eases" +
          (stat && isNum(stat.yoy) ? ", and they are " + (stat.yoy >= 0 ? "up " : "down ") + pct(Math.abs(stat.yoy)) + " on a year ago." : ".");
      },
      fail: "Annualised monthly data with heavy revisions.",
      sector: { industrial: "Everything sold into a new home — materials, equipment, freight — sees demand roughly two quarters after this series moves.",
        consumer: "Housing turnover drives the big-ticket basket: furniture, appliances, improvement spend follow completions." } },
    consumerSentiment: { path: ["leading", "consumerSentiment"], kind: "raw", group: "Leading", horizon: "3–6 months",
      read: function (v) {
        return "Households rate their financial mood at " + num(v, 1) + ". Spending intentions precede spending — but mood can detach from behaviour for long stretches, and the gap between depressed sentiment and resilient actual spending eventually resolves one way or the other.";
      },
      fail: "A survey of mood, not a measure of money; it has been wrong for years at a time.",
      sector: { consumer: "The direct demand thermometer for this sector — sustained readings below the decade median usually precede trading-down behaviour and private-label shift." } },
    payrolls: { path: ["coincident", "payrollsYoY"], kind: "pct", group: "Coincident", horizon: "now",
      read: function (v) {
        return "The economy is adding jobs at " + pct(v) + " a year. Growth near zero is stall speed: below roughly half a percent, income growth stops outrunning inflation and the expansion is living on borrowed time.";
      },
      fail: "First prints are estimates and revisions are large — direction over precision.",
      sector: { consumer: "Payrolls are the paycheque base this sector sells into; the growth rate here is the ceiling on volume growth there." } },
    indProd: { path: ["coincident", "industrialProductionYoY"], kind: "pct", group: "Coincident", horizon: "now",
      read: function (v) {
        return "Physical output of factories, mines and utilities is " + (v >= 0 ? "growing " : "contracting ") + pct(Math.abs(v)) + " a year. The operational use is as a benchmark: a company growing volumes slower than this is losing share of physical output, whatever its revenue says.";
      },
      fail: "A shrinking slice of a services economy — weakness here can be sectoral, not cyclical.",
      sector: { industrial: "The sector's own pulse: benchmark this company's volume growth directly against it to separate share gains from a rising tide." } },
    retailSales: { path: ["coincident", "retailSalesYoY"], kind: "pct", group: "Coincident", horizon: "now",
      read: function (v, d) {
        var cpi = statOf(d, "cpi");
        var real = cpi && isNum(cpi.value) ? v - cpi.value : null;
        return "Consumers are spending " + pct(v) + " more dollars than a year ago" +
          (isNum(real)
            ? real < 0
              ? " — but inflation is " + pct(cpi.value) + ", so REAL volumes are falling " + pct(Math.abs(real)) + ". Dollar growth below inflation is contraction wearing a disguise."
              : ", about " + pct(real) + " of it real after inflation."
            : ".") +
          " The operating read: this is the 30-to-60-day dial for marketing spend, product mix and inventory depth.";
      },
      fail: "Nominal and seasonal — always read against inflation.",
      sector: { consumer: "This IS the sector's top line, published monthly and two quarters ahead of any 10-Q." } },
    cpi: { path: ["lagging", "cpiYoY"], kind: "pct", group: "Lagging", horizon: "confirms the past",
      read: function (v) {
        return "Consumer prices are " + pct(v) + " above a year ago. For operators this sets the pricing ceiling and the escalator: B2B contracts with inflation clauses reprice off this, and price rises beyond it need real pricing power to stick. It also flatters every nominal growth rate on this page by exactly this much.";
      },
      fail: "Lagging by design — by the time it confirms a trend, the leading indicators have moved twice.",
      sector: { consumer: "Above ~3%, trading down begins; the sector's mix shifts before its totals do.",
        rate: "The series the policy rate answers to — persistent overshoots here keep funding costs high for longer." } },
    coreCpi: { path: ["lagging", "coreCpiYoY"], kind: "pct", group: "Lagging", horizon: "confirms the past",
      read: function (v) {
        return "Excluding food and energy, inflation runs " + pct(v) + " — the persistent part policy steers by. The distance from the 2% target is the tightening still owed: readings near target open the door to cuts, readings above it keep the policy rate pinned.";
      },
      fail: "Shelter's weight makes it slow — it lags observed rents by about a year.",
      sector: {} },
    wageGrowthYoY: { path: ["lagging", "wageGrowthYoY"], kind: "pct", group: "Lagging", horizon: "confirms the past",
      read: function (v, d) {
        var cpi = statOf(d, "cpi");
        var real = cpi && isNum(cpi.value) ? v - cpi.value : null;
        return "Average hourly earnings are rising " + pct(v) + " a year — the number to budget next year's headcount costs and merit pool against" +
          (isNum(real)
            ? real > 0
              ? ". Wages are outrunning inflation by " + pp(real) + ", which supports demand but compresses labour-heavy margins."
              : ". Wages are trailing inflation — margin relief for employers, purchasing-power erosion for the customers they sell to."
            : ".");
      },
      fail: "Mix effects distort it: layoffs of low-wage workers push the average UP.",
      sector: { consumer: "Both sides of the ledger at once here: labour cost in the stores, purchasing power at the tills.",
        growth: "Talent-cost inflation for the sector where compensation is the biggest line." } },
    unemployment: { path: ["lagging", "unemployment"], kind: "pct", group: "Lagging", horizon: "confirms the past",
      read: function (v, d, stat) {
        return "Unemployment stands at " + pct(v) + ". Firms cut hours, then hiring, then people — so by the time this rises the downturn is established. The rule of thumb that has held for decades: a rise of half a point from the cycle low has never reversed without a recession" +
          (stat && isNum(stat.yoyPp) ? "; it is " + (stat.yoyPp >= 0 ? "up " : "down ") + Math.abs(stat.yoyPp * 100).toFixed(1) + " pp on a year ago." : ".");
      },
      fail: "Participation moves can hold the rate down in a genuinely weak market.",
      sector: {} },
    fedFunds: { path: ["lagging", "fedFunds"], kind: "pct2", group: "Lagging", horizon: "sets the next 9–18 months",
      read: function (v, d, stat) {
        var dir = stat && isNum(stat.yoyPp)
          ? (stat.yoyPp < -0.002 ? "cutting" : stat.yoyPp > 0.002 ? "hiking" : "holding")
          : "holding";
        return "The policy rate is " + (v * 100).toFixed(2) + "% and the central bank has been " + dir + " over the past year. The operating uses are mechanical: time refinancing against the cutting cycle, not after it; reset hurdle rates for new projects off this floor; and remember the economy feels a rate change nine to eighteen months after it happens" +
          (dir === "cutting" ? " — cuts in train now are the easing of next year's demand." :
           dir === "hiking" ? " — the tightening already done has not fully landed yet." : ".");
      },
      fail: "Policy reacts to lagging data, so it is usually late at both turns.",
      sector: { rate: "Deposit betas, loan yields and the entire margin structure of this sector reprice off this single number.",
        growth: "The discount-rate floor under every long-duration valuation in the sector." } },
  };

  function statOf(d, key) {
    var m = MACRO_META[key];
    if (!m || !d) return null;
    return (d[m.path[0]] || {})[m.path[1]] || null;
  }
  function fmtKind(kind, v) {
    if (!isNum(v)) return "—";
    if (kind === "pct") return pct(v);
    if (kind === "pct2") return pct(v, 2);
    if (kind === "pp") return pp(v);
    if (kind === "k") return num(v / 1000, 0) + "k";
    if (kind === "M") return num(v / 1000, 2) + "M";
    return num(v, 1);
  }

  function detailChart(hist, kind) {
    if (!hist || hist.length < 8) return "";
    var W = 720, H = 170, padL = 54, padR = 14, padT = 12, padB = 24;
    var iw = W - padL - padR, ih = H - padT - padB;
    var vals = hist.map(function (h) { return h[1]; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (lo === hi) { lo -= 1; hi += 1; }
    var span = hi - lo;
    lo -= span * 0.06; hi += span * 0.06;
    var X = function (i) { return padL + (i / (hist.length - 1)) * iw; };
    var Y = function (v) { return padT + ih - ((v - lo) / (hi - lo)) * ih; };
    var path = hist.map(function (h, i) {
      return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(h[1]).toFixed(1);
    }).join(" ");
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img'>";
    [lo + (hi - lo) * 0.08, (lo + hi) / 2, hi - (hi - lo) * 0.08].forEach(function (g) {
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + Y(g).toFixed(1) +
        "' y2='" + Y(g).toFixed(1) + "' stroke='rgba(255,255,255,.07)' stroke-width='1'/>" +
        "<text x='" + (padL - 6) + "' y='" + (Y(g) + 3).toFixed(1) +
        "' text-anchor='end' font-size='9' fill='#8b8f98'>" + esc(fmtKind(kind, g)) + "</text>";
    });
    if (lo < 0 && hi > 0) {
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + Y(0).toFixed(1) +
        "' y2='" + Y(0).toFixed(1) + "' stroke='rgba(245,197,24,.4)' stroke-width='1' stroke-dasharray='3 3'/>";
    }
    var step = Math.max(1, Math.floor(hist.length / 6));
    for (var i = 0; i < hist.length; i += step) {
      out += "<text x='" + X(i).toFixed(1) + "' y='" + (H - 8) +
        "' text-anchor='middle' font-size='9' fill='#8b8f98'>" + esc(hist[i][0].slice(0, 4)) + "</text>";
    }
    out += "<path d='" + path + "' fill='none' stroke='#f5c518' stroke-width='1.7' stroke-linejoin='round'/>";
    var last = hist[hist.length - 1];
    out += "<circle cx='" + X(hist.length - 1).toFixed(1) + "' cy='" + Y(last[1]).toFixed(1) +
      "' r='3' fill='#f5c518'/>";
    return out + "</svg>";
  }

  var MACRO_DETAIL_KEY = null;
  function renderMacroDetail(key, card) {
    var meta = MACRO_META[key];
    var d = MACRO.data;
    if (!meta || !d) return;
    var old = document.getElementById("macro-detail");
    if (old) old.parentNode.removeChild(old);
    if (MACRO_DETAIL_KEY === key) { MACRO_DETAIL_KEY = null; return; }
    MACRO_DETAIL_KEY = key;
    var stat = statOf(d, key);
    if (!stat || !isNum(stat.value)) return;
    var hist = stat.history || [];
    var vals = hist.map(function (h) { return h[1]; }).sort(function (a, b) { return a - b; });
    var pctile = null;
    if (vals.length > 20) {
      var below = vals.filter(function (v) { return v < stat.value; }).length;
      pctile = Math.round(100 * below / vals.length);
    }
    var minH = hist.length ? hist.reduce(function (a, h) { return h[1] < a[1] ? h : a; }) : null;
    var maxH = hist.length ? hist.reduce(function (a, h) { return h[1] > a[1] ? h : a; }) : null;
    var m6 = hist.length > 7 ? hist[hist.length - 7][1] : null;
    var m24 = hist.length > 25 ? hist[hist.length - 25][1] : null;
    var f = function (v) { return fmtKind(meta.kind, v); };
    var def = DEFS[key] || {};
    var trend = "";
    if (isNum(m6) && isNum(m24)) {
      var d6 = stat.value - m6, d24 = stat.value - m24;
      var dirWord = Math.abs(d6) < Math.abs(d24) / 6 ? "flattening"
        : (d6 > 0 === d24 > 0 ? (d6 > 0 ? "still climbing" : "still falling")
          : (d6 > 0 ? "turning up" : "rolling over"));
      trend = "Against its own path it is <strong>" + dirWord + "</strong>: " +
        (d6 >= 0 ? "+" : "−") + f(Math.abs(d6)).replace(/^[+−]/, "") + " over six months, " +
        (d24 >= 0 ? "+" : "−") + f(Math.abs(d24)).replace(/^[+−]/, "") + " over two years.";
    }
    var context = "";
    if (minH && maxH && isNum(pctile)) {
      context = "Over the decade shown it ranged from <strong>" + f(minH[1]) + "</strong> (" +
        esc(minH[0].slice(0, 7)) + ") to <strong>" + f(maxH[1]) + "</strong> (" +
        esc(maxH[0].slice(0, 7)) + "). Today's " + f(stat.value) + " sits in the <strong>" +
        pctile + "th percentile</strong> of that history — " +
        (pctile >= 80 ? "high by the standards of the period." :
         pctile <= 20 ? "low by the standards of the period." : "mid-range for the period.") ;
    }
    var me = PANEL[state.ticker];
    var bucket = me ? SECTOR_BUCKET[me.sector] : null;
    var sectorLine = bucket && meta.sector[bucket]
      ? "<p class='md-sector'><strong>For " + esc(me.sector) + ":</strong> " +
        esc(meta.sector[bucket]) + "</p>"
      : "";
    var host = document.createElement("div");
    host.id = "macro-detail";
    host.innerHTML =
      "<div class='md-head'><span class='md-title'>" + esc(def.label || key) + "</span>" +
      "<span class='md-tag'>" + esc(meta.group) + " · " + esc(meta.horizon) + "</span>" +
      "<button type='button' class='md-close' aria-label='Close detail'>×</button></div>" +
      detailChart(hist, meta.kind) +
      "<div class='md-stats'>" +
        "<span>Now <strong>" + f(stat.value) + "</strong></span>" +
        (isNum(m6) ? "<span>6 mo ago <strong>" + f(m6) + "</strong></span>" : "") +
        (isNum(m24) ? "<span>2 yrs ago <strong>" + f(m24) + "</strong></span>" : "") +
        (isNum(pctile) ? "<span>Decade percentile <strong>" + pctile + "</strong></span>" : "") +
      "</div>" +
      "<p class='md-para'>" + context + "</p>" +
      (trend ? "<p class='md-para'>" + trend + "</p>" : "") +
      "<p class='md-para'>" + meta.read(stat.value, d, stat) + "</p>" +
      sectorLine +
      "<p class='md-fail'>Where it misleads: " + esc(meta.fail) + "</p>";
    var grid = card.closest(".kpi-grid");
    grid.parentNode.insertBefore(host, grid.nextSibling);
    host.querySelector(".md-close").addEventListener("click", function () {
      MACRO_DETAIL_KEY = null;
      host.parentNode.removeChild(host);
    });
    host.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ---------- the cycle dial ---------- */
  function cyclePhase(d) {
    var L = d.leading || {}, C = d.coincident || {}, G = d.lagging || {};
    var claims = L.initialClaims, curve = L.curveSpread;
    var pay = C.payrollsYoY, ind = C.industrialProductionYoY;
    var ff = G.fedFunds, cpi = G.cpiYoY;
    var claimsRising = claims && isNum(claims.yoy) && claims.yoy > 0.10;
    var inverted = curve && isNum(curve.value) && curve.value < 0;
    var steepening = curve && isNum(curve.yearAgo) && (curve.value - curve.yearAgo) > 0.004;
    var contracting = (pay && isNum(pay.value) && pay.value < 0.002) ||
                      (ind && isNum(ind.value) && ind.value < -0.01);
    var cutting = ff && isNum(ff.yoyPp) && ff.yoyPp < -0.004;
    var hiking = ff && isNum(ff.yoyPp) && ff.yoyPp > 0.004;
    var hot = cpi && isNum(cpi.value) && cpi.value > 0.03;
    var signals = [];
    if (inverted) signals.push("the curve is inverted");
    if (steepening) signals.push("the curve is steepening");
    if (claimsRising) signals.push("claims are rising " + pct(claims.yoy) + " on a year ago");
    if (claims && isNum(claims.yoy) && !claimsRising) signals.push("claims are quiet");
    if (contracting) signals.push("coincident output is stalling");
    if (pay && isNum(pay.value) && !contracting) signals.push("payrolls are still growing " + pct(pay.value));
    if (cutting) signals.push("policy has been cutting");
    if (hiking) signals.push("policy has been hiking");
    if (hot) signals.push("inflation is above 3%");
    var phase, play;
    if (claimsRising && contracting) {
      phase = "Contraction";
      play = ["Inventory: lean down hard — carrying stock into falling demand is how cash dies.",
        "Capital: freeze discretionary spend; protect liquidity and the core customer base.",
        "Hiring: freeze, and optimise the headcount already in place."];
    } else if (cutting && steepening && !contracting) {
      phase = "Trough / early recovery";
      play = ["Inventory: begin rebuilding core stock while suppliers still want volume.",
        "Capital: refinance at the cheap end of the cycle; distressed assets are on sale exactly now.",
        "Hiring: selective re-hiring while the labour market still favours the buyer."];
    } else if (inverted && (hot || hiking)) {
      phase = "Peak";
      play = ["Inventory: shift toward just-in-time; safety stock bought at peak prices is the stock written down later.",
        "Capital: lock fixed-rate debt before the cycle turns; pause speculative long-dated projects.",
        "Pricing: use the inflation window — escalation clauses and price moves stick now and will not later."];
    } else {
      phase = "Expansion";
      play = ["Inventory: build ahead of demand — stockouts cost more than carry while the cycle runs.",
        "Capital: fund capacity and expansion while credit is available and demand is confirmed.",
        "Hiring: scale ahead of demand; capacity hired late is revenue missed."];
    }
    return { phase: phase, signals: signals, play: play };
  }

  function renderCycleDial(d) {
    var me = PANEL[state.ticker];
    var read = cyclePhase(d);
    var bucket = me ? SECTOR_BUCKET[me.sector] : null;
    var emphasis = {
      rate: "Rate-sensitive sector: weight the curve, the policy rate and claims above everything else here.",
      consumer: "Consumer-facing sector: retail sales, sentiment and claims are the lines that lead this company's demand.",
      industrial: "Industrial sector: producer prices, industrial production and permits are the lines that lead this company's order book.",
      growth: "Long-duration sector: the 10-year yield dominates valuation while wages set the cost base — cycle demand swings matter less than the discount rate."
    }[bucket];
    return "<div class='cycle-dial'>" +
      "<div class='md-head'><span class='md-title'>Where the dial points: " + esc(read.phase) + "</span>" +
      "<span class='md-tag'>rules, not judgement</span></div>" +
      "<p class='md-para'>Read from the indicators below: " + esc(read.signals.join("; ")) + ". " +
      "The label is a dial position, not a forecast — the same rules have mislabelled turning points before, which is why the individual series and their trends sit underneath it.</p>" +
      "<ul class='cycle-play'>" + read.play.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>" +
      (emphasis ? "<p class='md-sector'><strong>" + esc(me.sector) + " lens:</strong> " + esc(emphasis) + "</p>" : "") +
      "<p class='md-fail'>The classic 6–9 month gauge — the purchasing managers' survey — is proprietary and absent from the public feed; permits and claims stand in for its new-orders signal here.</p>" +
      "</div>";
  }

  function paintMacro(d) {
    var backdrop = $("macro-block"), cycle = $("cycle-block");
    var f = function (x, dp) { return x && isNum(x.value) ? pct(x.value, dp === undefined ? 1 : dp) : "—"; };
    var when = function (x) { return x && x.period ? "As of " + esc(x.period) : ""; };
    var yoyNote = function (x, noun) {
      return x && isNum(x.yoy) ? ((x.yoy >= 0 ? "Up " : "Down ") + pct(Math.abs(x.yoy)) + " on a year ago") : noun;
    };
    var L = d.leading || {}, C = d.coincident || {}, G = d.lagging || {};
    backdrop.innerHTML = "<div class='kpi-grid'>" +
      card("curveSpread", "Curve, 10y minus 2y",
        L.curveSpread && isNum(L.curveSpread.value) ? pp(L.curveSpread.value) : "—",
        L.curveSpread && L.curveSpread.value < 0
          ? "Inverted — short money dearer than long" : "Term premium") +
      card("treasury10", "10-year Treasury", f(L.treasury10y, 2), "The base of every discount rate") +
      card("treasury2", "2-year Treasury", f(L.treasury2y, 2), when(L.treasury2y)) +
      card("fedFunds", "Policy rate", f(G.fedFunds, 2), when(G.fedFunds)) +
      card("cpi", "Inflation, headline", f(G.cpiYoY), "Consumer prices against a year earlier") +
      card("coreCpi", "Inflation, core", f(G.coreCpiYoY), "Excluding food and energy") +
      "</div>" +
      "<p class='chart-caption'>Rates set the discount on every future dollar this company earns " +
      "and the price of its debt; inflation flatters nominal growth while the capital base lags. " +
      "<span class='soft'>Source: Federal Reserve Bank of St. Louis. These describe the environment, " +
      "not the company.</span></p>";
    if (!cycle) return;
    var claims = L.initialClaims, permits = L.buildingPermits, senti = L.consumerSentiment;
    cycle.innerHTML =
      renderCycleDial(d) +
      "<p class='cycle-group-label'>Leading — move before the economy</p>" +
      "<div class='kpi-grid'>" +
      card("initialClaims", "Initial jobless claims",
        claims && isNum(claims.value) ? num(claims.value / 1000, 0) + "k" : "—",
        claims ? yoyNote(claims, "New claims, weekly") : "") +
      card("buildingPermits", "Building permits",
        permits && isNum(permits.value) ? num(permits.value / 1000, 2) + "M" : "—",
        permits ? yoyNote(permits, "Housing units, annualised") : "") +
      card("producerPricesYoY", "Producer prices",
        f(L.producerPricesYoY), "Wholesale inflation — input costs, a quarter early") +
      card("consumerSentiment", "Consumer sentiment",
        senti && isNum(senti.value) ? num(senti.value, 1) : "—",
        senti ? yoyNote(senti, "Survey index") : "") +
      "</div>" +
      "<p class='cycle-group-label'>Coincident — move with it</p>" +
      "<div class='kpi-grid'>" +
      card("payrolls", "Payroll growth", f(C.payrollsYoY), "Jobs added against a year ago") +
      card("indProd", "Industrial production", f(C.industrialProductionYoY), "Output against a year ago") +
      card("retailSales", "Retail sales", f(C.retailSalesYoY), "Nominal — inflation is inside this number") +
      "</div>" +
      "<p class='cycle-group-label'>Lagging — confirm where it has been</p>" +
      "<div class='kpi-grid'>" +
      card("wageGrowthYoY", "Wage growth", f(G.wageGrowthYoY),
        "Average hourly earnings against a year ago") +
      card("unemployment", "Unemployment rate", f(G.unemployment),
        G.unemployment && isNum(G.unemployment.yoyPp)
          ? (G.unemployment.yoyPp >= 0 ? "Up " : "Down ") +
            Math.abs(G.unemployment.yoyPp * 100).toFixed(1) + " pp on a year ago"
          : "Share of the labour force") +
      card("cpi", "Inflation, headline", f(G.cpiYoY), "Also lagging — shown with the backdrop above") +
      card("fedFunds", "Policy rate", f(G.fedFunds, 2), "Policy reacts to lagging data") +
      "</div>" +
      "<p class='chart-caption'>A strong lagging picture with deteriorating leading indicators is " +
      "late cycle; weak lagging data with improving leading indicators is a recovery forming. " +
      "<span class='soft'>Source: Federal Reserve Bank of St. Louis.</span></p>";
  }

  /* ---------- the company's own risk register ---------- */
  function renderRiskRegister() {
    var host = $("risk-register");
    if (!host) return;
    var d = (window.RISK_DATA || {})[state.ticker];
    if (!d) {
      host.innerHTML = "<p class='hint'>No filing text is loaded for " + esc(state.ticker) + ".</p>";
      return;
    }
    var link = "<a href='" + esc(d.url) + "' target='_blank' rel='noopener'>open Item 1A in the filing itself</a>";
    if (!d.extracted || !d.headings || !d.headings.length) {
      host.innerHTML = "<p class='register-meta'>This filer lays Item 1A out in a form the " +
        "extractor cannot read faithfully" +
        (isNum(d.words) ? " (the section runs about " + num(d.words / 1000, 1) + " thousand words)" : "") +
        ", so rather than show a wrong list — " + link + ".</p>";
      return;
    }
    var first = d.headings.slice(0, 8);
    var rest = d.headings.slice(8);
    var li = function (t) { return "<li>" + esc(t) + "</li>"; };
    host.innerHTML =
      "<p class='register-meta'>The " + esc(String(d.reportDate).slice(0, 4)) +
      " annual filing names <strong>" + d.headings.length + "</strong> risks across " +
      (isNum(d.words) ? "about " + num(d.words / 1000, 0) + " thousand words of " : "") +
      "Item 1A. Each line below is the company's own heading — " + link + ".</p>" +
      "<ol>" + first.map(li).join("") + "</ol>" +
      (rest.length
        ? "<details><summary>All " + d.headings.length + " named risks</summary><ol start='9'>" +
          rest.map(li).join("") + "</ol></details>"
        : "");
  }

  /* ---------- stock performance ---------- */
  var STOCK_CACHE = {};
  function renderStock(ticker, force) {
    var host = $("stock-block");
    if (!force && STOCK_CACHE[ticker]) { paintStock(ticker, STOCK_CACHE[ticker]); return; }
    host.innerHTML = "<p class='hint' id='stock-status' role='status'>Loading price history…</p>";
    fetch(API_BASE + "/api/market?ticker=" + encodeURIComponent(ticker) + (force ? "&force=1" : ""))
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
    var q = d && d.quote, prof = d && d.profile, candles = d && d.candles;
    if (!q || !isNum(q.price)) {
      $("stock-block").innerHTML = "<p class=\"hint\">No price data for " + esc(ticker) + ".</p>";
      return;
    }
    var chg = isNum(q.changePct) ? q.changePct / 100 : null;
    /* The feed returns a window of daily candles rather than a 52-week
       high and low, so the range is taken from what it actually sent and
       labelled with the number of sessions behind it. */
    var lo = null, hi = null, days = 0;
    if (Array.isArray(candles) && candles.length) {
      days = candles.length;
      candles.forEach(function (c) {
        if (isNum(c.low)) lo = (lo === null) ? c.low : Math.min(lo, c.low);
        if (isNum(c.high)) hi = (hi === null) ? c.high : Math.max(hi, c.high);
      });
    }
    var pos = (isNum(lo) && isNum(hi) && hi > lo) ? (q.price - lo) / (hi - lo) : null;
    $("stock-block").innerHTML =
      "<div class=\"kpi-grid\">" +
      card("price", "Price", "$" + num(q.price, 2),
        q.time ? "Close, " + esc(String(q.time)) : "Latest close") +
      card("priceChange", "Change", isNum(chg) ? pct(chg) : "—",
        isNum(q.changeAbs) ? ("$" + num(q.changeAbs, 2) + " on the session") : "On the session") +
      card("marketValue", "Market value",
        (prof && isNum(prof.marketCap)) ? money(prof.marketCap) : "—",
        (prof && isNum(prof.sharesOutstanding))
          ? (num(prof.sharesOutstanding / 1e9, 2) + "bn shares at the current price")
          : "Shares at the current price") +
      card("priceRange", "Range in the window",
        (isNum(lo) && isNum(hi)) ? "$" + num(lo, 0) + "–$" + num(hi, 0) : "—",
        days ? (days + " sessions" + (isNum(pos) ? ", now " + pct(pos, 0) + " up that range" : "")) : "Trading range") +
      "</div>" +
      "<p class=\"chart-caption\">Market value is what the equity is priced at today; every " +
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
    renderDisaggregation();
    renderRiskRegister();
    renderMacro(false);
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
    if (!PANEL[ticker]) { setCompanyLive(ticker, false); return; }
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
  /* Clicking a backdrop or cycle card opens the decade view for that
     series. The hover glossary still works; the click goes deeper. */
  ["macro-block", "cycle-block"].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener("click", function (ev) {
      var card = ev.target.closest ? ev.target.closest(".mcard") : null;
      if (!card || !el.contains(card)) return;
      var key = card.getAttribute("data-metric");
      if (key && MACRO_META[key]) {
        ev.preventDefault();
        renderMacroDetail(key, card);
      }
    });
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
    if (LIVE[state.ticker]) {
      /* a live company refreshes from SEC, then re-renders */
      var t = state.ticker;
      delete PANEL[t];
      setCompanyLive(t, true);
    }
    if (state.view === "company") renderStock(state.ticker, true);
    if (state.view === "company") { MACRO.data = null; renderMacro(true); }
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
      if (tk === t) out.unshift([tk, PANEL[tk].name, false]);
      else if (tk.indexOf(t) === 0 || nm.indexOf(t) !== -1) out.push([tk, PANEL[tk].name, false]);
    });
    /* beyond the panel: the full SEC company index, marked as live */
    if (out.length < 8 && t.length >= 2) {
      for (var i = 0; i < INDEX.length && out.length < 8; i++) {
        var tk2 = INDEX[i][0], nm2 = String(INDEX[i][2] || "");
        if (PANEL[tk2]) continue;
        if (tk2 === t) out.unshift([tk2, nm2, true]);
        else if (tk2.indexOf(t) === 0 || nm2.toUpperCase().indexOf(t) !== -1) {
          out.push([tk2, nm2, true]);
        }
      }
    }
    return out.slice(0, 8);
  }
  function renderResults() {
    rList.innerHTML = matches.length ? matches.map(function (m, i) {
      return "<li role='option' id='st-opt-" + i + "' data-i='" + i + "' aria-selected='" +
        (i === activeIdx) + "'><span class='tk'>" + esc(m[0]) + "</span>" +
        "<span class='nm'>" + esc(m[1]) +
        (m[2] ? " <span class='live-tag'>live from SEC</span>" : "") + "</span></li>";
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
  /* A deep link to a company outside the panel starts the live pull the
     search box would have started; the panel default renders meanwhile
     so the page is never blank. */
  var liveStart = null;
  if (!PANEL[initial]) {
    if (indexEntry(initial)) liveStart = initial;
    initial = "NVDA";
  }
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
  if (liveStart) { q.value = liveStart; setCompanyLive(liveStart, false); }
})();
