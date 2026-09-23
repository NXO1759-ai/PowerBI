/* credit-lenders.js — the Lenders view controller (PR D, blueprint 4).
 *
 * Owns the mount point credit.html gives the Lenders view
 * (#lenders-root inside #lenders-view). On first entry it fetches
 * universe.json, coverage.json, composite.json and terms.json, every one
 * of the 53 company-TICKER.json files, only the holdings-TICKER.json
 * files coverage.json's own tickers_refused does NOT name (no
 * 404-storming a file already known absent), and batches /api/comps in
 * groups of 12 for the price-adjacent fields. There is no price field on
 * /api/comps: price is derived here as marketCap ÷ the company file's
 * own latest.sharesOutstanding — an approximation of a market-feed close
 * that trades exactness for not hammering /api/market 53 times a load
 * (documented in contractNotes and again below at buildPrices()).
 *
 * Everything fetched is cached on module state until the caller passes
 * { force: true } (credit.js's Refresh button does this for every view,
 * lenders included); a second call to mount() with a warm cache repaints
 * from memory. window.RTCreditPage.lenders() (wired in credit.js) reads
 * the same cache for a test harness or the console.
 *
 * What this file draws, all inside #lenders-root:
 *   1. A loading state, then either a page-level error state (universe
 *      or coverage failed — never a half-rendered table) or:
 *   2. The scorecard (frontend/lib/lenders-scorecard.js render()).
 *   3. The composite strip (blueprint L10): eight tiles read straight
 *      off composite.json's own weighted/n/dispersion fields — nothing
 *      here re-derives a composite figure a different formula already
 *      owns (frontend/lib/credit.js computes every one of them upstream,
 *      in the holdings refresh that writes composite.json).
 *   4. Dispersion dots (L11): one row per metric, one dot per member
 *      (composite.json's own perFiler array), the median as a tick, the
 *      currently open drill-down ticker in accent.
 *   5. A peers panel (blueprint 4.5): RTValuation.selectComparables with
 *      RTValuation.bdcDistance over every universe row that carries the
 *      three inputs (portfolio fair value, first-lien share, non-accrual
 *      rate — the 32 holdings-covered filers), rendering the exact rule
 *      sentence selectComparables returns.
 *   6. The per-BDC drill-down (credit-lenders-drilldown.js), mounted on
 *      a scorecard row click.
 *
 * The Cliffwater BDC Index (decision 12.14: agreed, not yet ingested) is
 * the sector line the blueprint plans behind the drill-down's L1
 * (NAV-vs-price) and the Market view's M8 — neither chart lives in this
 * file's owned list, so it cannot be drawn or skipped there from here.
 * What this file DOES own — the peers/sector panel — states the gap by
 * name rather than leaving it unmentioned; see the "not yet ingested"
 * note rendered at the foot of that panel and the matching contractNote.
 *
 * Every [data-metric] this file prints resolves through RTCatalog (ten
 * entries registered once below, at module evaluation, per house rule);
 * wrapTerms(root) runs once after every render, never a second hover
 * mechanism. The scorecard's own table.grid and the drill-down's hidden
 * export tables are read by RTExport unmodified — this file adds no
 * export wiring of its own.
 */
(function () {
  "use strict";

  var HTTP = (typeof window !== "undefined" && window.RTHttp) || null;
  var CAT = (typeof window !== "undefined" && window.RTCatalog) || null;

  /* ---------- pure helpers (no DOM) ---------- */
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function withCommas(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function fmtPct(v, dp) { return isNum(v) ? (v * 100).toFixed(dp === undefined ? 1 : dp) + "%" : "not disclosed"; }
  function fmtX(v, dp) { return isNum(v) ? v.toFixed(dp === undefined ? 2 : dp) + "×" : "not disclosed"; }
  function fmtBpsFrac(v) { return isNum(v) ? withCommas(Math.round(v * 10000)) + " bps" : "not disclosed"; }
  function fmtMoneyB(v) { return isNum(v) ? "$" + (v / 1e9).toFixed(2) + "B" : "not disclosed"; }
  /* "CY2026Q2" -> "Q2 2026"; anything else prints as given */
  function quarterLabel(q) {
    var m = /^CY(\d{4})Q([1-4])I?$/.exec(String(q || ""));
    return m ? "Q" + m[2] + " " + m[1] : (q ? String(q) : "the latest quarter");
  }
  function errMsg(e, subject) {
    if (HTTP && typeof HTTP.message === "function") return HTTP.message(e, subject);
    return String((e && e.message) || e || ("could not read " + subject));
  }

  /* ---------- CAPTIONS: template(values) -> string, sample() -> string,
     every sample under 240 characters (scripts/test-lenders-view.mjs
     measures each one), the source stamp left to the tile footer ---------- */
  var CAPTIONS = {
    stripYield: {
      template: function (v) { return "The composite earns " + v.v + " all-in on accruing third-party debt, cost-weighted across " + v.n + " filers (" + v.q + ")."; },
      sample: function () { return CAPTIONS.stripYield.template({ v: "9.49%", n: "18", q: "Q2 2026" }); }
    },
    stripSpread: {
      template: function (v) { return "The composite's spread over base is " + v.v + ", cost-weighted across " + v.n + " filers (" + v.q + ")."; },
      sample: function () { return CAPTIONS.stripSpread.template({ v: "533 bps", n: "30", q: "Q2 2026" }); }
    },
    stripNonAccrual: {
      template: function (v) { return "Non-accruals are " + v.v + " of investments at cost across " + v.n + " filers with a parsed schedule (" + v.q + ")."; },
      sample: function () { return CAPTIONS.stripNonAccrual.template({ v: "2.74%", n: "29", q: "Q2 2026" }); }
    },
    stripPik: {
      /* pikShareOfTotal is Σ PIK income ÷ Σ total investment income
         (income-pooled), not cost-weighted like stripYield/stripSpread —
         this caption used to claim the wrong weighting basis, contradicting
         its own catalog entry's formula (round-2 fixer finding). */
      template: function (v) { return "PIK is " + v.v + " of total investment income, summed across " + v.n + " filers (" + v.q + ")."; },
      sample: function () { return CAPTIONS.stripPik.template({ v: "12.32%", n: "18", q: "Q2 2026" }); }
    },
    stripMark: {
      template: function (v) { return "The composite's mark is " + v.v + " fair value to cost across " + v.n + " filers (" + v.q + ")."; },
      sample: function () { return CAPTIONS.stripMark.template({ v: "0.99×", n: "32", q: "Q2 2026" }); }
    },
    stripLeverage: {
      template: function (v) { return "Composite leverage is " + v.v + " debt to equity across " + v.n + " filers (" + v.q + ")."; },
      sample: function () { return CAPTIONS.stripLeverage.template({ v: "1.12×", n: "28", q: "Q2 2026" }); }
    },
    stripAssetCoverage: {
      template: function (v) { return "Composite asset coverage is " + v.v + " across " + v.n + " filers (" + v.q + ")."; },
      sample: function () { return CAPTIONS.stripAssetCoverage.template({ v: "1.93×", n: "30", q: "Q2 2026" }); }
    },
    stripPriceToNav: {
      template: function (v) { return v.n === "0" ? "Median price/NAV is not yet computed by the refresh (n = 0)." : "Median price/NAV across the universe is " + v.v + " (n = " + v.n + ")."; },
      sample: function () { return CAPTIONS.stripPriceToNav.template({ v: "1.00×", n: "0" }); }
    },
    stripTiiYield: {
      template: function (v) { return "Total investment income yields " + v.v + " on average investment cost, across " + v.n + " filers (" + v.q + ")."; },
      sample: function () { return CAPTIONS.stripTiiYield.template({ v: "9.99%", n: "40", q: "Q2 2026" }); }
    },
    dispersion: {
      template: function (v) {
        var base = "Each row is one metric, one dot per filer, the median as a tick";
        if (!v.ticker) return base + ".";
        if (!v.hasDot) return base + "; " + v.ticker + " has no parsed schedule of investments, so it appears on no row here.";
        return base + "; " + v.ticker + "'s own dot is in accent where its drill-down is open.";
      },
      sample: function () { return CAPTIONS.dispersion.template({ ticker: "ARCC", hasDot: true }); }
    },
    peers: {
      template: function (v) { return v.ticker + "'s closest peer is " + v.top + " (distance " + v.d + "); " + v.rule; },
      sample: function () { return CAPTIONS.peers.template({ ticker: "ARCC", top: "OBDC", d: "0.42", rule: "Same industry by SIC, widened until at least 6 other firms, then the 8 closest by the caller's distance." }); }
    }
  };

  /* ---------- RTCatalog entries, registered once at module load ----------
     Prefixed "lendersComposite"/"lendersDispersion"/"lendersPeers" so
     these never collide with the scorecard's "lenders*" keys or the
     drill-down's "lendersDrill*" keys in the shared catalog namespace
     (scripts/test-lenders-view.mjs asserts this across all three files,
     registered in credit.html's load order). */
  var ENTRIES = [
    { key: "lendersCompositeYield", label: "Composite all-in yield", group: "credit", format: "pct", direction: "context",
      formula: "Σ(cost × all-in rate) ÷ Σ cost over accruing third-party debt, summed across every filer with a parsed schedule of investments, the composite refresh's own weighted figure",
      watch: "The tile's own n is the number of filers that answer, not all 53 — read the n before comparing quarter to quarter.",
      definition: "What the industry's loans actually pay today, cost-weighted across every covered BDC's book.",
      interpretation: "Read against the Market view's SOFR tile: the gap is the spread the industry is earning over the base rate." },
    { key: "lendersCompositeSpread", label: "Composite spread over base", group: "credit", format: "bps", direction: "context",
      formula: "Σ(cost × spread) ÷ Σ cost over floating third-party debt, summed across every covered filer, the composite refresh's own weighted figure",
      watch: "A private loan's spread is over a floating base rate, not over Treasuries; it is not the same spread the Market view's ladder measures.",
      definition: "The cost-weighted spread over base the industry's floating loans carry.",
      interpretation: "Compare against a single filer's own spread histogram in its drill-down to see whether that filer prices wider or tighter than the composite." },
    { key: "lendersCompositeNonAccrual", label: "Composite non-accrual rate", group: "credit", format: "pct", direction: "down",
      formula: "Σ cost of non-accrual holdings ÷ Σ cost of investments, summed across every filer with a parsed schedule, the composite refresh's own weighted figure",
      watch: "Only filers with a parsed schedule of investments answer this — the tile's own n states exactly how many; the rest of the universe is not in the denominator.",
      definition: "How much of the industry's book, at cost, has stopped paying as agreed.",
      interpretation: "Read beside the composite's mark: a rising non-accrual rate with a falling mark is losses confirming what the market already priced." },
    { key: "lendersCompositePik", label: "Composite PIK share", group: "credit", format: "pct", direction: "down",
      formula: "Σ PIK income ÷ Σ total investment income, summed across every filer that tags both, the composite refresh's own weighted figure",
      watch: "This is the income-statement PIK share; a single filer's own weighted-average contractual PIK rate on holdings (shown on the scorecard and in its drill-down) is a different, cost-weighted measure and is not directly comparable to this one. This tile's own n is a dollar-weighted count (how many filers roll into the Σ above); the dispersion row below states its own, separately computed n (how many filers carry a value at all) — the two can differ, and each states its own basis rather than sharing one number.",
      definition: "How much of the industry's investment income arrives as more paper instead of cash.",
      interpretation: "A rising composite PIK share with flat non-accruals is cash earnings quietly falling across the industry before any loan actually stops paying." },
    { key: "lendersCompositeMark", label: "Composite mark", group: "credit", format: "x", direction: "context",
      formula: "Σ fair value ÷ Σ cost of investments, summed across every covered filer's tagged portfolio totals, the composite refresh's own weighted figure",
      watch: "Equity and warrant positions across the industry lift this; a mark above 1.0 is not automatically good news if it is concentrated in a few names' equity stakes.",
      definition: "The industry book's cumulative unrealized gain or loss.",
      interpretation: "A falling composite mark with flat composite non-accruals is the market's opinion of losses arriving before the payment defaults do, industry-wide." },
    { key: "lendersCompositeLeverage", label: "Composite leverage", group: "credit", format: "x", direction: "context",
      formula: "Σ debt ÷ Σ net assets across every covered filer that tags both, the composite refresh's own weighted figure",
      watch: "A dollar-weighted average, so the largest filers move it most; read a single filer's own leverage on the scorecard beside this before concluding the industry is levering up.",
      definition: "How much borrowed money sits behind each dollar of the industry's equity, in aggregate.",
      interpretation: "Read beside composite asset coverage, the statutory version of the same question." },
    { key: "lendersCompositeAssetCoverage", label: "Composite asset coverage", group: "credit", format: "x", direction: "up",
      formula: "The dollar-weighted asset-coverage ratio across every covered filer that tags one, the composite refresh's own weighted figure",
      watch: "The 1940 Act's statutory floor (150% or 200%) is a per-filer line, not an industry one; this aggregate says nothing about which individual filer sits closest to its own floor — read the scorecard's own cushion column for that.",
      definition: "The industry's aggregate cushion under the 1940 Act's hardest leverage limit.",
      interpretation: "A falling composite coverage with flat composite leverage means net assets themselves are shrinking industry-wide." },
    { key: "lendersCompositeTiiYield", label: "Total investment income yield, on average cost", group: "credit", format: "pct", direction: "context",
      formula: "GrossInvestmentIncomeOperating ÷ average InvestmentOwnedAtCost (current and prior quarter), summed across every filer that tags both, the composite refresh's own weighted figure",
      watch: "The numerator is every dollar of investment income — interest, dividends, fees, PIK dividends and other income — not interest alone, and the denominator's cost base includes equity and vehicle positions, not third-party debt only; this is a broader figure than the all-in-yield tile above, which is debt-only and cost-weighted per holding.",
      definition: "What the industry's whole investment book yielded on the capital it has deployed, at cost, this quarter.",
      interpretation: "Read beside the all-in yield tile: a gap between the two is the yield contribution of fees, PIK dividends and equity income the debt-only figure does not capture." },
    { key: "lendersCompositePriceToNav", label: "Median price / NAV", group: "credit", format: "x", direction: "context",
      formula: "The median of every priced filer's market close ÷ NAV per share, the composite refresh's own dispersion figure",
      watch: "This field is computed by the composite refresh, separately from this page's own scorecard, which computes its own 25th-percentile flag directly from live prices; the two are expected to agree once the refresh populates this field, and this tile states plainly when it has not (n = 0).",
      definition: "The middle of the pack: half the priced universe trades above this multiple of book value, half below.",
      interpretation: "Below 1.0× a BDC cannot sell new shares below NAV without a shareholder vote (§63(2)); read a single filer's own price/NAV against this median, not only against 1.0×." },
    { key: "lendersDispersion", label: "Dispersion across the universe", group: "credit", format: "chart", direction: "context",
      formula: "One dot per filer at that filer's own value of the metric, from the composite refresh's own per-filer figures; the tick is the same refresh's own median for that metric",
      watch: "A metric with no filers answering (n = 0, per the composite refresh's own count for it) shows a labeled empty row rather than an invented range.",
      definition: "Where every covered BDC sits on one metric at once, instead of only the industry's single weighted average.",
      interpretation: "A tight cluster of dots means the composite's average is representative; a wide spread with the average sitting near one edge means the average is being pulled by a few large filers." },
    { key: "lendersPeers", label: "Peers (BDC distance)", group: "credit", format: "number", direction: "context",
      formula: "A BDC-specific distance = sqrt(dSize²+dLien²+dNonAccrual²): dSize the absolute log2 ratio of portfolio fair value, dLien the absolute difference in first-lien share over 0.10, dNonAccrual the absolute difference in non-accrual rate over 0.01",
      watch: "Every candidate here has a parsed schedule of investments, but not every one carries all three inputs (fair value, first-lien share, non-accrual rate); a filer missing one still ranks, but after every fully-ranked candidate, never ahead of one on a shorter distance alone — the table's own “(partial)” marker names which ones.",
      definition: "The closest other BDCs to the one selected, by size and portfolio composition rather than by ticker-list convention.",
      interpretation: "Read the peer list's own rule sentence before treating the ranking as anything other than what it says it is." }
  ];
  if (CAT && typeof CAT.register === "function") CAT.register(ENTRIES);

  /* ---------- module state: the fetched data, cached until { force: true } ---------- */
  var STATE = { data: null, pending: null, error: null, openTicker: null, peersSubject: null };

  function j(subject) {
    return function (r) {
      if (HTTP && typeof HTTP.json === "function") return HTTP.json(r, subject);
      if (!r || !r.ok) { var e = new Error("HTTP " + (r && r.status) + " reading " + subject); e.status = r && r.status; throw e; }
      return r.json();
    };
  }
  function fetchOrNull(path) {
    return fetch(path).then(function (r) { return r && r.ok ? r.json() : null; }, function () { return null; });
  }
  function chunk(arr, n) {
    var out = [];
    for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  /* universe.json and coverage.json are mandatory: a page-level error
     state replaces the whole view when either fails (house rule: never
     a half-rendered table). terms.json and composite.json are read
     best-effort — the holdings release not having landed yet, or a
     terms build not having run, is a designed empty state downstream,
     never a page fault. */
  function loadCore() {
    return Promise.all([
      fetch("data/bdc/universe.json").then(j("the BDC universe")),
      fetch("data/bdc/coverage.json").then(j("the BDC coverage index")),
      fetchOrNull("data/bdc/terms.json"),
      fetch("data/bdc/composite.json").then(function (r) { return r && r.status === 404 ? null : j("the BDC composite")(r); }, function () { return null; })
    ]).then(function (r) { return { universe: r[0], coverage: r[1], terms: r[2], composite: r[3] }; });
  }
  function loadMany(tickers, prefix) {
    return Promise.all(tickers.map(function (t) { return fetchOrNull("data/bdc/" + prefix + "-" + t + ".json"); }))
      .then(function (list) {
        var map = {};
        tickers.forEach(function (t, i) { if (list[i]) map[t] = list[i]; });
        return map;
      });
  }
  /* /api/comps, 12 tickers per call (its own ceiling); one bad batch
     never fails the others or the page. Also reports whether ANY batch
     came back 503 "not configured" (api/comps.js's own answer when
     FINNHUB_API_KEY is unset), so the caller can label every resulting
     "no price" cell as a deployment gap rather than silently reusing
     "not disclosed" — a company-level phrase that means something
     different (round-2 fixer finding: on a keyless deployment every row
     read "not disclosed" for price, price/NAV and dividend yield, with
     no way to tell that from a real disclosure gap, and the price/NAV
     severity stripe could never fire). */
  function loadComps(tickers, apiBase) {
    var batches = chunk(tickers, 12);
    var unconfigured = false;
    return Promise.all(batches.map(function (b) {
      return fetch((apiBase || "") + "/api/comps?tickers=" + b.map(encodeURIComponent).join(","))
        .then(function (r) { if (r && r.status === 503) unconfigured = true; return r && r.ok ? r.json() : null; }, function () { return null; })
        .then(function (payload) { return (payload && Array.isArray(payload.rows)) ? payload.rows : []; });
    })).then(function (lists) {
      var map = {};
      lists.forEach(function (rows) { rows.forEach(function (row) { if (row && row.ticker) map[row.ticker] = row; }); });
      return { map: map, unconfigured: unconfigured };
    });
  }
  /* price = marketCap ÷ sharesOutstanding: /api/comps carries no price
     field (see api/comps.js), so this is the substitution the task asks
     to be documented — it trades exactness (a true market-feed close,
     which would mean 53 separate /api/market calls a load) for one
     batched call per twelve tickers. sharesOutstanding is read from the
     same quarter's filing as every other scorecard figure, so the
     derived price can lag a real-time share count by up to a quarter. */
  function buildPrices(companies, compsMap) {
    var prices = {};
    Object.keys(compsMap).forEach(function (t) {
      var row = compsMap[t], company = companies[t];
      var sh = company && company.series && company.series.latest && company.series.latest.sharesOutstanding;
      var shares = sh && isNum(sh.v) ? sh.v : null;
      var price = isNum(row.marketCap) && isNum(shares) && shares > 0 ? row.marketCap / shares : null;
      prices[t] = { price: price, dividendYieldTTM: isNum(row.dividendYieldTTM) ? row.dividendYieldTTM : null, marketCap: isNum(row.marketCap) ? row.marketCap : null };
    });
    return prices;
  }

  function loadAll(ctx) {
    return loadCore().then(function (core) {
      if (!core.universe || !Array.isArray(core.universe.rows) || !core.universe.rows.length) {
        throw new Error("universe.json carries no rows");
      }
      if (!core.coverage) throw new Error("coverage.json did not answer");
      var tickers = core.universe.rows.map(function (r) { return r.ticker; }).filter(Boolean);
      var refused = {};
      ((core.coverage.holdings && core.coverage.holdings.tickers_refused) || []).forEach(function (r) { if (r && r.ticker) refused[r.ticker] = true; });
      var holdingsTickers = tickers.filter(function (t) { return !refused[t]; });
      return Promise.all([
        loadMany(tickers, "company"),
        loadMany(holdingsTickers, "holdings"),
        loadComps(tickers, ctx && ctx.apiBase)
      ]).then(function (r) {
        var companies = r[0], holdings = r[1], comps = r[2];
        var compsMap = comps.map, compsUnconfigured = comps.unconfigured;
        var prices = buildPrices(companies, compsMap);
        var rows = (typeof window !== "undefined" && window.RTLendersScorecard)
          ? window.RTLendersScorecard.buildRows({ universe: core.universe, coverage: core.coverage, companies: companies, holdings: holdings, terms: core.terms, prices: prices, compsUnconfigured: compsUnconfigured })
          : [];
        return {
          universe: core.universe, coverage: core.coverage, terms: core.terms, composite: core.composite,
          companies: companies, holdings: holdings, compsMap: compsMap, compsUnconfigured: compsUnconfigured, prices: prices, rows: rows,
          holdingsTickers: holdingsTickers, loadedAt: new Date().toISOString()
        };
      });
    });
  }

  /* ---------- rendering ----------
     Every mount point below is a real node the shell BUILDS with
     createElement/appendChild, not one the caller has to find again
     afterward with querySelector (root's own descendants beyond that are
     plain innerHTML strings, never queried back into): the same
     testability pattern credit-lenders-drilldown.js uses for #ld-body,
     so scripts/test-lenders-view.mjs can exercise this file's real
     render path against a minimal hand-built DOM stub with no HTML
     parser and no npm dependency. Interaction (the peers subject
     picker, a scorecard row click) is bound once per container with a
     delegated listener, exactly as lib/lenders-scorecard.js binds its
     own filter box and sort buttons — never rebound on a repaint. */
  function clearNode(node) {
    node.innerHTML = "";
    if (node._children) node._children.length = 0;
  }
  function shellSection(id, h2, blurb, howToRead, bodyId) {
    var section = document.createElement("section");
    section.className = "panel-card fsa-section";
    section.setAttribute("aria-labelledby", id);
    var head = document.createElement("div");
    head.className = "section-head";
    head.innerHTML = "<h2 id='" + esc(id) + "'>" + esc(h2) + "</h2>" +
      "<p class='section-blurb'>" + esc(blurb) + "</p>" +
      "<details class='how-to-read'><summary>How to read this</summary><p>" + howToRead + "</p></details>";
    section.appendChild(head);
    var body = document.createElement("div");
    /* a stable id on the body only (never on anything the render
       functions above need to re-find — those keep the JS reference
       shellSection() returns) so a console, a browser devtools query or
       scripts/test-lenders-view.mjs can read this panel's rendered
       output back with plain document.getElementById(), never a second
       hover/query mechanism. */
    if (bodyId) body.id = bodyId;
    section.appendChild(body);
    return { section: section, body: body };
  }

  function renderLoading(root) {
    clearNode(root);
    var s = shellSection("h-lenders", "Lenders — the listed BDCs", "", "");
    s.body.innerHTML = "<p class='hint' role='status'>Loading the BDC universe, coverage, composite and terms, all 53 filers' filings, and market-adjacent fields for the scorecard…</p>";
    root.appendChild(s.section);
  }

  function renderError(ctx, root, err) {
    clearNode(root);
    var s = shellSection("h-lenders", "Lenders — the listed BDCs", "", "");
    var p = document.createElement("p");
    p.className = "chart-empty"; p.setAttribute("style", "position:static");
    p.innerHTML = "<span>The Lenders view could not be built: " + esc(errMsg(err, "the BDC universe or coverage index")) + ". Nothing is shown in its place.</span>";
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "refresh-btn"; btn.textContent = "Try again";
    btn.addEventListener("click", function () { mount(ctx, { force: true }); });
    s.body.appendChild(p); s.body.appendChild(btn);
    root.appendChild(s.section);
  }

  /* ---------- L10: the composite strip ---------- */
  var STRIP_TILES = [
    { key: "yieldAtCost", label: "All-in yield", catalog: "lendersCompositeYield", cap: "stripYield", fmt: fmtPct },
    { key: "spreadCostWeighted", label: "Spread over base", catalog: "lendersCompositeSpread", cap: "stripSpread", fmt: fmtBpsFrac },
    { key: "nonAccrualCost", label: "Non-accrual", catalog: "lendersCompositeNonAccrual", cap: "stripNonAccrual", fmt: fmtPct },
    { key: "pikShareOfTotal", label: "PIK share", catalog: "lendersCompositePik", cap: "stripPik", fmt: fmtPct },
    { key: "fvOverCost", label: "Mark (FV / cost)", catalog: "lendersCompositeMark", cap: "stripMark", fmt: fmtX },
    { key: "debtToEquity", label: "Leverage", catalog: "lendersCompositeLeverage", cap: "stripLeverage", fmt: fmtX },
    { key: "assetCoverage", label: "Asset coverage", catalog: "lendersCompositeAssetCoverage", cap: "stripAssetCoverage", fmt: fmtX },
    { key: "tiiYieldOnAvgCost", label: "TII yield, avg cost", catalog: "lendersCompositeTiiYield", cap: "stripTiiYield", fmt: fmtPct },
    { key: "priceToNav", label: "Median price / NAV", catalog: "lendersCompositePriceToNav", cap: "stripPriceToNav", fmt: fmtX, dispersion: true }
  ];
  function stripTile(t, composite) {
    var v = null, n = null;
    if (t.dispersion) {
      var d = composite && composite.dispersion && composite.dispersion.priceToNav;
      v = d && isNum(d.median) ? d.median : null;
      n = d && isNum(d.n) ? d.n : 0;
    } else {
      v = composite && composite.weighted && isNum(composite.weighted[t.key]) ? composite.weighted[t.key] : null;
      n = composite && composite.n && isNum(composite.n[t.key]) ? composite.n[t.key] : null;
    }
    var q = composite ? quarterLabel(composite.quarter) : "—";
    /* a dispersion-sourced tile with n = 0 is a refresh gap ("not yet
       computed"), never a disclosure gap ("not disclosed") — the two
       phrasings mean different things and must not be interchanged */
    var valTxt = (t.dispersion && !n) ? "not yet computed" : t.fmt(v);
    var cap = CAPTIONS[t.cap] ? CAPTIONS[t.cap].template({ v: valTxt, n: n === null ? "0" : String(n), q: q }) : "";
    /* blueprint §9: "the source, edition and as-of stamp goes in the
       tile footer" — this tile carried n and the quarter but never named
       a source (round-2 fixer finding). */
    return "<div class='tile' data-tile='" + esc(t.key) + "'>" +
      "<div class='tile-head'><button type='button' class='tile-label' data-metric='" + esc(t.catalog) + "'><span>" + esc(t.label) + "</span></button></div>" +
      "<span class='tile-value" + (v === null ? " na" : "") + "'>" + esc(valTxt) + "</span>" +
      "<p class='chart-caption'>" + esc(cap) + "</p>" +
      "<p class='tile-foot'>Source: SEC EDGAR companyfacts and the filers' schedules of investments · n = " + esc(n === null ? "0" : String(n)) + " filers · " + esc(q) + "</p></div>";
  }
  function renderStrip(host, data) {
    if (!host) return;
    var composite = data.composite;
    var gapNote = "<p class='tile-foot lv-gap-note'>The Cliffwater BDC Index — the sector line planned behind the drill-down's NAV-vs-price chart and the Market view's BIZD chart — is agreed for a later release but not yet ingested into this build; nothing here draws it.</p>";
    if (!composite) {
      host.innerHTML = "<p class='chart-empty' style='position:static'><span>The composite has not been published yet (data/bdc/composite.json is absent); the strip fills in once the holdings refresh writes it.</span></p>" + gapNote;
      return;
    }
    host.innerHTML = "<div class='tile-grid'>" + STRIP_TILES.map(function (t) { return stripTile(t, composite); }).join("") + "</div>" + gapNote;
  }

  /* ---------- L11: dispersion dots ---------- */
  var DISPERSION_METRICS = [
    { key: "yieldAtCost", label: "All-in yield", fmt: function (v) { return fmtPct(v, 2); } },
    { key: "spreadCostWeighted", label: "Spread over base", fmt: fmtBpsFrac },
    { key: "nonAccrualCost", label: "Non-accrual", fmt: function (v) { return fmtPct(v, 2); } },
    { key: "pikShareOfTotal", label: "PIK share", fmt: function (v) { return fmtPct(v, 1); } },
    { key: "fvOverCost", label: "Mark (FV / cost)", fmt: function (v) { return fmtX(v, 3); } },
    { key: "debtToEquity", label: "Leverage", fmt: fmtX },
    { key: "assetCoverage", label: "Asset coverage", fmt: fmtX },
    { key: "priceToNav", label: "Price / NAV", fmt: fmtX }
  ];
  function dispersionRow(metric, composite, openTicker) {
    var d = composite && composite.dispersion && composite.dispersion[metric.key];
    var per = (composite && Array.isArray(composite.perFiler)) ? composite.perFiler : [];
    var pts = per.filter(function (r) { return r && isNum(r[metric.key]); });
    if (!d || !d.n || !pts.length) {
      return "<div class='lv-disp-row lv-disp-empty'><span class='lv-disp-label'>" + esc(metric.label) + "</span>" +
        "<span class='lv-disp-na'>not yet computed by the refresh (n = 0)</span></div>";
    }
    var vals = pts.map(function (r) { return r[metric.key]; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (lo === hi) { var pad = Math.abs(lo) * 0.05 || 0.01; lo -= pad; hi += pad; }
    var X = function (v) { return Math.max(1, Math.min(99, ((v - lo) / (hi - lo)) * 98 + 1)); };
    var dots = pts.map(function (r) {
      var open = openTicker && r.ticker === openTicker;
      return "<i class='lv-disp-dot" + (open ? " lv-disp-dot-open" : "") + "' style='left:" + X(r[metric.key]).toFixed(1) + "%' title='" + esc(r.ticker + " " + metric.fmt(r[metric.key])) + "'></i>";
    }).join("");
    var tick = isNum(d.median) ? "<b class='lv-disp-tick' style='left:" + X(d.median).toFixed(1) + "%' title='" + esc("median " + metric.fmt(d.median)) + "'></b>" : "";
    return "<div class='lv-disp-row'><span class='lv-disp-label'>" + esc(metric.label) + "</span>" +
      "<span class='lv-disp-track'>" + dots + tick + "</span>" +
      "<span class='lv-disp-range'>" + esc(metric.fmt(d.min)) + " – " + esc(metric.fmt(d.max)) + " · n = " + esc(String(d.n)) + "</span></div>";
  }
  function renderDispersion(host, data) {
    if (!host) return;
    var composite = data.composite;
    if (!composite) {
      host.innerHTML = "<p class='chart-empty' style='position:static'><span>The composite has not been published yet; dispersion fills in once the holdings refresh writes it.</span></p>";
      return;
    }
    var hasDot = !!(STATE.openTicker && Array.isArray(composite.perFiler) && composite.perFiler.some(function (p) { return p && p.ticker === STATE.openTicker; }));
    var cap = CAPTIONS.dispersion.template({ ticker: STATE.openTicker || null, hasDot: hasDot });
    host.innerHTML = "<button type='button' class='tile-label' data-metric='lendersDispersion' style='margin-bottom:8px'><span>What each row shows</span></button>" +
      "<div class='lv-disp-grid'>" + DISPERSION_METRICS.map(function (m) { return dispersionRow(m, composite, STATE.openTicker); }).join("") + "</div>" +
      "<p class='chart-caption'>" + esc(cap) + "</p>";
  }

  /* ---------- 4.5: peers panel ---------- */
  function nameOf(data, ticker) {
    var row = (data.universe.rows || []).filter(function (r) { return r.ticker === ticker; })[0];
    return (row && row.name) || ticker;
  }
  function peerCandidates(data) {
    var composite = data.composite;
    var out = [];
    ((composite && composite.perFiler) || []).forEach(function (p) {
      var h = data.holdings[p.ticker];
      var fv = h && h.summary && isNum(h.summary.portfolioFv) ? h.summary.portfolioFv : null;
      if (!isNum(fv)) return;
      out.push({
        ticker: p.ticker, name: nameOf(data, p.ticker), sic: "", industry: "", sector: "",
        fv: fv, firstLienShare: isNum(p.firstLienShare) ? p.firstLienShare : null,
        nonAccrualRate: isNum(p.nonAccrualCost) ? p.nonAccrualCost : null
      });
    });
    out.sort(function (a, b) { return b.fv - a.fv; });
    return out;
  }
  function rowPriceToNav(data, ticker) {
    var row = (data.rows || []).filter(function (r) { return r.ticker === ticker; })[0];
    return row && isNum(row.priceToNav) ? row.priceToNav : null;
  }
  function renderPeers(ctx, host, data) {
    if (!host) return;
    var RTV = (typeof window !== "undefined") ? window.RTValuation : null;
    var candidates = peerCandidates(data);
    if (!RTV || candidates.length < 2) {
      host.innerHTML = "<p class='chart-empty' style='position:static'><span>Not enough filers carry portfolio fair value, first-lien share and non-accrual rate together yet (needs the holdings-covered filers and the composite) to select peers.</span></p>";
      return;
    }
    if (!STATE.peersSubject || !candidates.some(function (c) { return c.ticker === STATE.peersSubject; })) {
      STATE.peersSubject = candidates[0].ticker;
    }
    var subject = candidates.filter(function (c) { return c.ticker === STATE.peersSubject; })[0] || candidates[0];
    var result = RTV.selectComparables(subject, candidates, { distance: RTV.bdcDistance, keep: 8 });
    var peers = result.peers;
    /* the pool level actually reached (the universe carries no usable SIC
       for a BDC, so this always falls through to "every covered company")
       and the distance actually applied (size, first-lien share,
       non-accrual rate) — built here rather than using
       RTValuation.selectComparables' own generic rule sentence, which
       names SIC matching and "the caller's distance" regardless of which
       distance function was passed in. */
    var peersRule = "Pool: " + result.pool.level + "; ranked by portfolio size, first-lien share and non-accrual rate together, the BDC-specific distance.";
    var options = candidates.map(function (c) {
      return "<option value='" + esc(c.ticker) + "'" + (c.ticker === subject.ticker ? " selected" : "") + ">" + esc(c.ticker) + " — " + esc(c.name) + "</option>";
    }).join("");
    /* note: the on-page select gets a data-role, not an id — a repaint
       creates a fresh <select> every time (the whole panel is one
       innerHTML string), so an id-based lookup would go stale the
       instant a subject change repaints; a delegated change listener,
       bound once on the container below, only ever needs the fresh
       element the event itself carries as its target. */
    var rowsHtml = peers.map(function (p) {
      var pn = rowPriceToNav(data, p.ticker);
      return "<tr><td>" + esc(p.ticker) + "</td><td>" + esc(p.name || "") + "</td>" +
        "<td class='ls-num'>" + (isNum(p.fv) ? esc(fmtMoneyB(p.fv)) : "not disclosed") + "</td>" +
        "<td class='ls-num'>" + (isNum(p.firstLienShare) ? esc(fmtPct(p.firstLienShare, 0)) : "not disclosed") + "</td>" +
        "<td class='ls-num'>" + (isNum(p.nonAccrualRate) ? esc(fmtPct(p.nonAccrualRate, 1)) : "not disclosed") + "</td>" +
        "<td class='ls-num'" + (p.complete ? "" : " title='ranked on partial inputs'") + ">" + (isNum(p.distance) ? esc(p.distance.toFixed(2)) + (p.complete ? "" : " (partial)") : "not ranked") + "</td>" +
        "<td class='ls-num'>" + (isNum(pn) ? esc(fmtX(pn)) : "not disclosed") + "</td></tr>";
    }).join("");
    var top = peers[0];
    var cap = top ? CAPTIONS.peers.template({ ticker: subject.ticker, top: top.ticker, d: isNum(top.distance) ? top.distance.toFixed(2) : "—", rule: peersRule }) : peersRule;
    host.innerHTML =
      "<div class='lv-peers-controls'><label class='ls-filter-label'><span class='ind-picker-label'>Subject</span>" +
      "<select data-role='lenders-peers-select'>" + options + "</select></label>" +
      "<span class='ls-count'>Pool: " + esc(result.pool.level) + " (" + esc(String(result.pool.count)) + " candidates)</span></div>" +
      "<div class='ls-table-scroll'><table class='grid ls-scorecard' data-export-name='BDC peers'>" +
      "<thead><tr><th>Ticker</th><th>Name</th><th>Portfolio (FV)</th><th>First lien</th><th>Non-accrual</th><th>Distance</th><th>Price/NAV</th></tr></thead>" +
      "<tbody>" + (rowsHtml || "<tr><td colspan='7'>No peers ranked.</td></tr>") + "</tbody></table></div>" +
      "<p class='chart-caption'>" + esc(cap) + "</p>";
    if (!host.__lvPeersBound) {
      host.addEventListener("change", function (e) {
        var t = e && e.target;
        if (!t || typeof t.getAttribute !== "function" || t.getAttribute("data-role") !== "lenders-peers-select") return;
        STATE.peersSubject = t.value;
        renderPeers(ctx, host, data);
        if (typeof ctx.wrapTerms === "function") ctx.wrapTerms(host);
      });
      host.__lvPeersBound = true;
    }
  }

  /* ---------- the drill-down (credit-lenders-drilldown.js), on a row click ---------- */
  function openDrilldown(ctx, dispersionHost, data, ticker) {
    STATE.openTicker = ticker;
    renderDispersion(dispersionHost, data);
    if (typeof ctx.wrapTerms === "function") ctx.wrapTerms(dispersionHost);
    if (typeof window === "undefined" || !window.RTLendersDrilldown) return;
    var dCtx = {
      company: data.companies[ticker] || null,
      holdings: data.holdings[ticker] || null,
      composite: data.composite, terms: data.terms, universe: data.universe,
      pcSeries: window.RTPcSeries || null, coverage: data.coverage,
      catalog: ctx.catalog, fmt: ctx.fmt, wrapTerms: ctx.wrapTerms,
      priceHistory: function (t) {
        return fetch((ctx.apiBase || "") + "/api/price-history?ticker=" + encodeURIComponent(t))
          .then(function (r) { return r && r.ok ? r.json() : null; }, function () { return null; });
      },
      quote: function (t) {
        var row = data.compsMap[t], p = data.prices[t];
        if (!row && !p) return Promise.resolve(null);
        return Promise.resolve({ price: p ? p.price : null, marketCap: row ? row.marketCap : (p ? p.marketCap : null),
          dividendYieldTTM: row ? row.dividendYieldTTM : (p ? p.dividendYieldTTM : null), asOf: data.loadedAt });
      },
      onClose: function () { STATE.openTicker = null; renderDispersion(dispersionHost, data); if (typeof ctx.wrapTerms === "function") ctx.wrapTerms(dispersionHost); }
    };
    window.RTLendersDrilldown.open(ticker, dCtx);
  }

  /* ---------- assembling the ready state ---------- */
  function renderReady(ctx, root, data) {
    clearNode(root);
    var scorecard = shellSection("h-lenders-scorecard", "Lenders — the listed BDCs",
      "One row per listed business development company: net asset value, price to NAV, dividend coverage, leverage, non-accruals, PIK and fees, with a severity stripe where a reading rule fires.",
      "Every filer in the SEC's 814- universe gets a row, whether or not its schedule of investments has been parsed; a holdings-only figure shows “not yet parsed” until it has. The default view shows the 30 largest by portfolio fair value — “Show all 53” is a display toggle only. Click a ticker to open its drill-down. Five reading rules apply across this table: read price/NAV against the universe's own quartile, not only against 1.0×; dividend coverage is earned, not declared, so a shortfall is met from spillover, then realized gains, then capital, in that order of comfort; an asset-coverage cushion under 15% is the flag, read together with the statutory line named on hover; cost and fair value move together, so read the mark and the non-accrual rate side by side rather than either alone; and fees are read against the peer median expense ratio on this table, never against a flat “2 and 20”.",
      "lenders-scorecard-body");
    var strip = shellSection("h-lenders-strip", "Conditions across the industry",
      "Eight cost-weighted readings across every covered BDC's book, each stating how many filers answer it.",
      "Every figure here is the composite refresh's own weighted average, read straight from data/bdc/composite.json — nothing is recomputed a second way. n is the count of filers behind that figure, never all 53; a metric no filer yet answers (median price/NAV, until the refresh populates it) says so rather than showing a zero.",
      "lenders-strip-body");
    var dispersion = shellSection("h-lenders-dispersion", "Dispersion across the universe",
      "One row per metric, one dot per filer, so the spread behind each composite average is visible at a glance.",
      "The composite strip above gives one weighted number per metric; this shows every filer's own reading on the same scale, with the median as a tick. Opening a drill-down puts that filer's dot in accent on every row — only for a filer with a parsed schedule of investments; a filer without one appears on no row here, and the caption says so rather than naming a dot that is not there.",
      "lenders-dispersion-body");
    var peers = shellSection("h-lenders-peers", "Peers",
      "The closest other BDCs to a chosen filer by size, lien mix and non-accrual rate — the course rule (Alford 1992) generalized to a BDC-specific distance.",
      "Pool selection widens by SIC, then industry, then sector, then “every covered company” — the universe carries no usable SIC for a BDC, so the pool always falls through to every filer that has the three inputs. A candidate missing one input still ranks, but after every fully-ranked one; the exact rule sentence under the table names the pool level and the distance actually used.",
      "lenders-peers-body");
    root.appendChild(scorecard.section);
    root.appendChild(strip.section);
    root.appendChild(dispersion.section);
    root.appendChild(peers.section);

    if (window.RTLendersScorecard) {
      window.RTLendersScorecard.render(scorecard.body, data.rows, {
        catalog: ctx.catalog, fmt: ctx.fmt,
        onRowClick: function (ticker) { openDrilldown(ctx, dispersion.body, data, ticker); },
        wrapTerms: ctx.wrapTerms
      });
    } else {
      scorecard.body.innerHTML = "<p class='chart-empty' style='position:static'><span>lib/lenders-scorecard.js did not load.</span></p>";
    }
    renderStrip(strip.body, data);
    renderDispersion(dispersion.body, data);
    renderPeers(ctx, peers.body, data);
    if (typeof ctx.wrapTerms === "function") ctx.wrapTerms(root);
  }

  /* ---------- the exported entry point ---------- */
  function mountEl() { return (typeof document !== "undefined") ? document.getElementById("lenders-root") : null; }

  function mount(ctx, opts) {
    ctx = ctx || {};
    var root = mountEl();
    if (!root) return Promise.resolve();
    var force = !!(opts && opts.force);
    if (force) { STATE.data = null; STATE.pending = null; STATE.error = null; STATE.openTicker = null; STATE.peersSubject = null; }
    if (STATE.data && !force) { renderReady(ctx, root, STATE.data); return Promise.resolve(); }
    if (STATE.pending) return STATE.pending;
    renderLoading(root);
    STATE.pending = loadAll(ctx).then(function (data) {
      STATE.data = data; STATE.pending = null; STATE.error = null;
      var freshRoot = mountEl();
      if (freshRoot) renderReady(ctx, freshRoot, data);
    }, function (err) {
      STATE.pending = null; STATE.error = err;
      var freshRoot = mountEl();
      if (freshRoot) renderError(ctx, freshRoot, err);
    });
    return STATE.pending;
  }

  var GLOBAL = typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this);
  GLOBAL.RTLendersView = {
    mount: mount,
    getData: function () { return STATE.data; },
    getError: function () { return STATE.error; },
    CAPTIONS: CAPTIONS
  };
})();
