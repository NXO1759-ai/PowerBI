/* credit-buildout-ledgers.js — the second group of build-out panels
   (blueprint sections 15.4-15.8, PR H3): guidance vs outturn, the deal
   ledger, the neocloud leverage panel, ratings and the spread context,
   and the ties to the private-credit views. Charts H9-H18.

   Mounted by credit-buildout.js into '#buildout-ledgers-root', a
   container that file's buildHtml() appends after its own H1-H8
   sections (its only change for this PR) — this file owns everything
   inside that container, the same "empty div, own controller" pattern
   frontend/credit.html already uses for #sec-stress, #lenders-root and
   #underwriting-view. It never touches credit-buildout.js's own charts
   or state, though it reuses a few of that file's exported pure helpers
   (window.RTBuildout._internal) where doing so avoids a second fetch of
   data credit-buildout.js already reads (the capex/debt panel files
   behind H14's four tiles) — never its render or DOM functions.

   Reads three files PR H0 corrected: data/ledgers/deals.json,
   data/ledgers/capex.json, data/ledgers/credit.json; the three derived
   15.8 figures already computed into data/pc/series/hs-ledgers.json (the
   "feeds" stage of this PR); and /api/credit-macro for the OAS lines H16
   draws against. Every row's `status` field is what a financing total
   keys on, mirroring scripts/lib/ledger.mjs's own rule exactly
   (SIGNED_STATUSES = signed/closed; everything else — announcement,
   contract, commentary, rating action, backstop, guidance, outturn,
   aggregate — is excluded). This file reimplements that classification
   in browser JS rather than importing the Node module (the site has no
   build step and no bundler, the same reason every other view file on
   this page is a plain window-global script) — scripts/test-buildout-
   ledgers.mjs cross-checks this copy against scripts/lib/ledger.mjs's
   real exports so the rule cannot quietly drift between the two.

   Must-not-build (blueprint 15.9), respected here: a rating action never
   becomes a number in a total (H17 draws it as a dot on a rank axis,
   never summed); announcements, contract rows, backstops, rating actions
   and commentary never enter a financing total (H12, H18); a new-issue
   spread to Treasuries and an index OAS are drawn on two separate axes
   in H16 and never subtracted; no CDS, no secondary bond price or yield,
   no valuation/IRR for a private company or SPV, no site-computed DSCR
   or adjusted EBITDA (H14's four tiles reuse only the tagged fields
   credit-buildout.js's own capex-panel reader already resolved); BIS and
   FSB figures in H18 are drawn with their own units and never averaged
   into the site's own private-credit share.

   Contract, mirroring credit-buildout.js:
     - RTCatalog.register() runs at module load, so a duplicate key
       throws immediately.
     - CAPTIONS: { name: { template(values), sample() } }, every
       sample() measured under 240 characters by
       scripts/test-buildout-ledgers.mjs.
     - Every function that does not touch `document` is a pure function
       of its data (string in, HTML/SVG string out); only render(),
       mount() and the tiny event binder touch the DOM.
     - window.RTBuildoutLedgers = { render, CAPTIONS, _internal } —
       _internal exposes the pure functions the offline test drives
       directly, the same shape window.RTBuildout uses. */
(function () {
  "use strict";

  var CAT = window.RTCatalog || null;

  /* ---------- generic pure helpers (this file's own small copy — see
     credit-buildout.js's header for why every chart file on this page
     keeps its own set rather than sharing a module) ---------- */
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmtBn(v, dp) {
    if (!isNum(v)) return "—";
    var a = Math.abs(v);
    var d = dp !== undefined ? dp : (a < 1 ? 2 : (a < 10 ? 1 : 0));
    return (v < 0 ? "−$" : "$") + a.toFixed(d) + "B";
  }
  /* Uses the same true-minus glyph as fmtBn for a negative value —
     v.toFixed() on a negative number emits a plain ASCII hyphen, which
     otherwise sits next to fmtBn's "−$" in the same panel. */
  function fmtPct(v, dp) {
    if (!isNum(v)) return "—";
    var d = dp === undefined ? 1 : dp;
    return v < 0 ? "−" + Math.abs(v).toFixed(d) + "%" : "+" + v.toFixed(d) + "%";
  }
  function fmtX(v) { return v === "n/m" ? "n/m" : (isNum(v) ? v.toFixed(2) + "×" : "—"); }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(d) {
    if (!d) return "—";
    var s = String(d);
    return s.length >= 10 ? MONTHS[Number(s.slice(5, 7)) - 1] + " " + Number(s.slice(8, 10)) + ", " + s.slice(0, 4) : s;
  }
  function last(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function halfYearOf(dateStr) {
    var s = String(dateStr || "");
    var y = s.slice(0, 4), m = Number(s.slice(5, 7));
    return y + "-H" + (m <= 6 ? "1" : "2");
  }

  /* ---------- ledger classification: browser mirror of scripts/lib/
     ledger.mjs (see that file's header — a row's `status`, never
     `structure` alone, decides whether its dollars enter a total).
     scripts/test-buildout-ledgers.mjs imports the real Node module and
     cross-checks every exclusion this file makes against it. ---------- */
  var SIGNED_STATUSES = { signed: 1, closed: 1 };
  function isFinancingRow(row) { return !!SIGNED_STATUSES[row && row.status]; }

  /* The leading number in a ledger amount string, or null for prose (a
     guidance direction, a placeholder). Mirrors ledger.mjs's
     parseAmount. */
  function parseLeadingNumber(s) {
    if (typeof s !== "string") return null;
    /* a leading "~" or "≈" (approximately) is skipped, never turned
       into a different number — "~7" reads as 7, flagged nowhere as
       exact, since the ledger's own prose already carries the "~" for a
       reader who opens the row */
    var m = /^[~≈]?\s*(-?[\d,]+(?:\.\d+)?)/.exec(s.trim());
    if (!m) return null;
    var n = Number(m[1].replace(/,/g, ""));
    return isFinite(n) ? n : null;
  }

  /* ISO currency -> FRED FX-series id + inversion direction, mirroring
     scripts/lib/ledger.mjs's FX_SERIES_OF exactly (this file's own small
     copy — see this file's header for why every chart file here keeps
     one rather than sharing a module). DEXUSEU and DEXUSUK are US
     dollars per one euro or pound (multiply to get USD); DEXSZUS,
     DEXCAUS and DEXJPUS are the foreign currency per one US dollar
     (divide to get USD). */
  var FX_SERIES_OF = {
    EUR: { id: "DEXUSEU", invert: false }, GBP: { id: "DEXUSUK", invert: false },
    CHF: { id: "DEXSZUS", invert: true }, CAD: { id: "DEXCAUS", invert: true }, JPY: { id: "DEXJPUS", invert: true }
  };
  /* Builds { EUR: [{d,v},...], ... } from the /api/credit-macro payload
     H16 already fetches — the same five DEX series this PR added for
     exactly this conversion. The feed serves a monthly-downsampled
     history (the last observation of each month), not the daily series
     scripts/build-ledger-series.mjs reads straight from FRED, so a
     row's own USD figure here is a close approximation of the
     build-time figure in hs-ledgers.json, not a bit-for-bit match —
     disclosed, never silently presented as the exact daily rate. */
  function fxByCurrencyFrom(macro) {
    var fx = {};
    if (!macro || !macro.series) return fx;
    Object.keys(FX_SERIES_OF).forEach(function (cur) {
      var s = macro.series[FX_SERIES_OF[cur].id];
      if (s && s.history && s.history.length) fx[cur] = s.history;
    });
    return fx;
  }
  /* The observation on `date`, or the closest one before it, from an
     ascending [{d,v}] history — mirrors ledger.mjs's fxRateOn. */
  function fxRateOn(history, date) {
    if (!history || !history.length) return null;
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].d <= date) return history[i].v;
    }
    return null;
  }
  /* Same lookup as fxRateOn, but keeps the observation's own date
     alongside its value — H16's caption needs to say which date an
     OAS reading actually belongs to when the feed's monthly grain
     means it is not the tranche's own pricing date. */
  function pointOnOrBefore(history, date) {
    if (!history || !history.length) return null;
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].d <= date) return { date: history[i].d, value: history[i].v };
    }
    return null;
  }
  function usdBnOfSegment(n, scale, currency, date, fx) {
    var bn = n * scale;
    if (currency === "USD") return bn;
    var dir = FX_SERIES_OF[currency];
    if (!dir) return null;
    var rate = fxRateOn(fx && fx[currency], date);
    if (rate === null) return null;
    return dir.invert ? bn / rate : bn * rate;
  }
  /* A ledger row's amount in USD billions. Strips a trailing parenthetical
     unit qualifier first ("USD bn (development cost)" reads as "USD bn"
     — the qualifier is a transparency note on what the dollars represent,
     never a signal to exclude a signed/closed row from a total; see this
     file's own H18 contract note and scripts/test-ledgers.mjs's Hyperion
     acceptance check, which requires that JV/SPV row to resolve to
     exactly one financing row, not zero). Handles the same amount shapes
     scripts/lib/ledger.mjs's amountUsdBnOf does: a single figure, a
     same-currency amount split into named parts that add to one
     transaction ("20.5 net + 10.0 private placement"), and a compound
     multi-currency amount ("17.5 + EUR 6.5", unit "USD bn + EUR bn"),
     converting a non-USD segment via `fx` (see fxByCurrencyFrom) on the
     row's own date. Returns null, never a guess, when a segment's
     currency or scale cannot be read or `fx` carries no rate for it —
     `fx` is optional so every existing single-currency call site keeps
     working unchanged. */
  function amountUsdBn(row, fx) {
    if (!row) return null;
    var unit = String(row.unit || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    var unitSegs = unit.split("+").map(function (s) { return s.trim(); });
    var amtSegs = String(row.amount).split("+").map(function (s) { return s.trim(); });

    if (unitSegs.length === 1) {
      var um = /^(USD|EUR|GBP|CHF|CAD|JPY)\b/.exec(unitSegs[0]);
      if (!um) return null;
      var currency = um[1];
      var sm = /\b(bn|m)\s*$/i.exec(unitSegs[0]);
      var scale = sm && sm[1].toLowerCase() === "m" ? 1 / 1000 : 1;
      var total = 0;
      for (var i = 0; i < amtSegs.length; i++) {
        var n = parseLeadingNumber(amtSegs[i]);
        if (n === null) return null;
        total += n;
      }
      return usdBnOfSegment(total, scale, currency, row.date, fx);
    }

    if (amtSegs.length !== unitSegs.length) return null;
    var totalUsdBn = 0;
    for (var j = 0; j < amtSegs.length; j++) {
      var aTok = amtSegs[j], uTok = unitSegs[j];
      var explicit = /^([A-Z]{3})\s+(.+)$/.exec(aTok);
      var curr, numPart;
      if (explicit) { curr = explicit[1]; numPart = explicit[2]; }
      else {
        numPart = aTok;
        var um2 = /^(USD|EUR|GBP|CHF|CAD|JPY)\b/.exec(uTok);
        curr = um2 ? um2[1] : null;
      }
      if (!curr) return null;
      var n2 = parseLeadingNumber(numPart);
      if (n2 === null) return null;
      var sm2 = /\b(bn|m)\s*$/i.exec(uTok);
      var scale2 = sm2 && sm2[1].toLowerCase() === "m" ? 1 / 1000 : 1;
      var segBn = usdBnOfSegment(n2, scale2, curr, row.date, fx);
      if (segBn === null) return null;
      totalUsdBn += segBn;
    }
    return totalUsdBn;
  }

  /* Coarse lender-type bucket from a row's own `structure` tag — a
     disclosed simplification of blueprint 15.5's fuller "lender types"
     field, which PR H0 did not carry (its own contract notes say why:
     the task's row shape named the narrower schema). A syndicated bank
     loan is never reclassified from press reporting about who it will
     be sold to. Round-2 fix: "equity" is no longer a single 1:1 bucket
     — most signed equity rows (Oracle, TeraWulf, Alphabet x2, IREN) are
     underwritten public or private-placement issuance, not the
     strategic/customer money blueprint 15.5 names by example (NVIDIA,
     Jane Street); equityLenderType() below reads the row's own
     `counterparties` field for a named strategic/customer investor and
     falls back to the issuance bucket otherwise — never a guess from the
     dollar size or the issuer's identity alone. */
  var STRATEGIC_EQUITY_MARKERS = ["NVIDIA", "Jane Street"];
  function equityLenderType(row) {
    var cps = (row && row.counterparties) || "";
    return STRATEGIC_EQUITY_MARKERS.some(function (m) { return cps.indexOf(m) !== -1; })
      ? "Strategic and customer equity" : "Public and private equity issuance";
  }
  function lenderTypeOf(structure, row) {
    if (structure === "equity") return equityLenderType(row);
    return LENDER_TYPE_OF_STRUCTURE[structure] || "Other";
  }
  var LENDER_TYPE_OF_STRUCTURE = {
    "bond": "Public bond investors",
    "bank loan": "Banks",
    "private credit facility": "Private credit funds",
    "convertible": "Convertible investors",
    "ABS or CMBS": "Asset managers and insurers",
    "JV/SPV": "JV/SPV partners",
    "lease-backed": "JV/SPV partners"
  };
  var STRUCTURE_COLOR = {
    "bond": "#f5c518", "bank loan": "#b6bac2", "private credit facility": "#5ecb8f",
    "convertible": "#c99cf2", "JV/SPV": "#6bc9c9", "lease-backed": "#6bc9c9",
    "ABS or CMBS": "#f0c96a", "equity": "#e8935a", "contract": "#8b8f98", "commentary": "#5a5f68"
  };
  function structureColor(s) { return STRUCTURE_COLOR[s] || "#8b8f98"; }

  /* ---------- the universe (own small copy; H14 borrows the richer
     credit-buildout.js table through _internal where present) ---------- */
  var HYPERSCALER_NAMES = { MSFT: "Microsoft", GOOG: "Alphabet", AMZN: "Amazon", META: "Meta", ORCL: "Oracle" };
  var NEOCLOUD_NAMES = { CRWV: "CoreWeave", NBIS: "Nebius", APLD: "Applied Digital", IREN: "IREN", CIFR: "Cipher", WULF: "TeraWulf" };
  var ALL_NAMES = {};
  Object.keys(HYPERSCALER_NAMES).forEach(function (t) { ALL_NAMES[t] = HYPERSCALER_NAMES[t]; });
  Object.keys(NEOCLOUD_NAMES).forEach(function (t) { ALL_NAMES[t] = NEOCLOUD_NAMES[t]; });
  var INK = "#8b8f98", LINE2 = "#b6bac2", GRID = "rgba(255,255,255,.08)";

  /* Entity string -> {ticker, name, cohort}. Matches a "(TICK)" suffix
     first ("Amazon (AMZN)"), then a name prefix against the two cohort
     tables; anything else (a developer, an SPV issuer, a press
     aggregate row) is cohort "other" and gets no ring in H11. */
  function classifyEntity(entity) {
    var s = String(entity || "");
    var m = /\(([A-Z]{2,5})\)/.exec(s);
    if (m && ALL_NAMES[m[1]]) return { ticker: m[1], name: ALL_NAMES[m[1]], cohort: HYPERSCALER_NAMES[m[1]] ? "hyperscaler" : "neocloud" };
    var tickers = Object.keys(ALL_NAMES);
    for (var i = 0; i < tickers.length; i++) {
      var t = tickers[i];
      if (new RegExp("^" + ALL_NAMES[t] + "\\b").test(s)) {
        return { ticker: t, name: ALL_NAMES[t], cohort: HYPERSCALER_NAMES[t] ? "hyperscaler" : "neocloud" };
      }
    }
    return { ticker: null, name: s, cohort: "other" };
  }
  function nameOf(entity) { return classifyEntity(entity).name || entity; }
  /* The company name for a bare ticker key (H9/H10 both key the capex
     ledger by ticker, e.g. "META", not by a full row entity string) — a
     direct ALL_NAMES lookup, never classifyEntity's name-prefix match,
     which is case-sensitive and never matches an all-caps ticker against
     its own mixed-case name ("^Meta\\b" does not match "META"). Mirrors
     h10Data's own `ALL_NAMES[t] || t` exactly. */
  function nameOfTicker(t) { return ALL_NAMES[t] || t; }

  /* ================================================================
     H9 — guidance vs outturn (blueprint 15.4)
     ================================================================ */
  /* Classifies one capex-ledger guidance row's `amount` exactly as
     printed: a pure "lo-hi" range is a band, a "... per quarter" figure
     is a run rate (a dotted level), everything else — a direction, an
     approximation, a range qualified by other prose — is a direction
     only. Only "range" ever feeds a computed error; nothing here
     converts a run rate or a direction into a number. */
  function classifyGuidance(raw) {
    var s = String(raw || "").trim();
    var rm = /^([\d,]+(?:\.\d+)?)\s*-\s*([\d,]+(?:\.\d+)?)$/.exec(s);
    if (rm) {
      var lo = Number(rm[1].replace(/,/g, "")), hi = Number(rm[2].replace(/,/g, ""));
      return { kind: "range", lo: lo, hi: hi, mid: (lo + hi) / 2, raw: s };
    }
    if (/per quarter/i.test(s)) {
      var n = /([\d,]+(?:\.\d+)?)/.exec(s);
      return { kind: "runrate", value: n ? Number(n[1].replace(/,/g, "")) : null, raw: s };
    }
    return { kind: "direction", raw: s };
  }
  /* The fiscal or calendar year a guidance row's "Period covered: ..."
     clause names, when it names a whole year (a quarter-only clause,
     e.g. "Q2-Q4 2024", returns null — a quarter guide is never plotted
     as though it covered the year). */
  function coveredYear(terms) {
    var m = /Period covered:\s*[^\d]{0,20}?(\d{4})/.exec(terms || "");
    return m ? m[1] : null;
  }
  /* Sums an entity's capex-ledger outturn rows (the tagged quarterly
     line, millions) by the calendar year each row's own note already
     names ("CY2025 Q3"), and separately carries the annual COMPANY
     METRIC where a Q4 row's note quotes one ("company metric $22.14B
     (FY2025 $72.22B)") — the basis blueprint 15.4 requires the error be
     computed on for a filer (Meta) whose own metric differs from the
     tagged line. */
  var MONTH_NUM_OF = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  /* The calendar year a fiscal quarter's own quarter-END falls in, for a
     filer whose note names its fiscal year end (blueprint 15.0's
     calendar-quarter rule): fiscal Qq of fiscal year FYy ends 3*(4-q)
     months before the fiscal year end month; when that walks back past
     January it lands in the PRIOR calendar year. Verified against the
     real ledger: Microsoft (FYE June) FY2026 Q1 ends Sep 2025 (CY2025),
     Q2 ends Dec 2025 (CY2025), Q3 ends Mar 2026 (CY2026), Q4 ends Jun
     2026 (CY2026); Oracle (FYE May) FY2026 Q1 ends Aug 2025 (CY2025), Q2
     ends Nov 2025 (CY2025), Q3 ends Feb 2026 (CY2026), Q4 ends May 2026
     (CY2026) — both match the ledger's own filing dates for those rows.
     Never uses the row's own `date` (a filing/release date, which the
     ledger sometimes shares between a current and a comparative
     prior-year quarter reported in the same release) to infer the year. */
  function calendarYearOfFiscalQuarter(fiscalYear, quarter, fyEndMonth) {
    var unwrapped = fyEndMonth - 3 * (4 - quarter);
    return unwrapped <= 0 ? String(fiscalYear - 1) : String(fiscalYear);
  }
  /* The calendar year a capex-ledger outturn row's own note names, either
     directly ("CY2025 Q3") or via a fiscal quarter plus a stated fiscal
     year end ("FY2026 Q1 (fiscal year ends June)") — never left
     unresolved just because a filer's fiscal year does not track the
     calendar year (Microsoft, Oracle). Returns null when the note names
     neither form, exactly as before. */
  function calendarYearOfOutturnNote(note) {
    var s = String(note || "");
    var cy = /CY(\d{4})\s+Q\d/.exec(s);
    if (cy) return cy[1];
    var fy = /FY(\d{4})\s+Q(\d)\s*\(fiscal year ends (\w+)\)/i.exec(s);
    if (fy) {
      var monthNum = MONTH_NUM_OF[fy[3].toLowerCase()];
      if (monthNum) return calendarYearOfFiscalQuarter(Number(fy[1]), Number(fy[2]), monthNum);
    }
    return null;
  }
  function annualOutturnByYear(entity, capexRows) {
    var byCY = {};
    capexRows.filter(function (r) { return r.entity === entity && r.status === "outturn"; }).forEach(function (r) {
      var cy = calendarYearOfOutturnNote(r.note);
      if (!cy) return;
      if (!byCY[cy]) byCY[cy] = { sum: 0, count: 0, companyMetricAnnual: null };
      var amt = parseLeadingNumber(r.amount);
      if (isNum(amt)) { byCY[cy].sum += amt; byCY[cy].count++; }
      var cm = /\(FY\d{4}\s+\$([\d.]+)B\)/.exec(r.note || "");
      if (cm) byCY[cy].companyMetricAnnual = Number(cm[1]) * 1000;
    });
    return byCY;
  }
  /* The figure blueprint 15.4 calls "outturn": the company metric
     annual total where the ledger names one, else the sum of four
     tagged quarters — never a partial-year sum, which would understate
     a still-reporting year and misread as a beat or a miss. */
  function annualOutturnValue(entry) {
    if (!entry) return null;
    if (isNum(entry.companyMetricAnnual)) return entry.companyMetricAnnual;
    return entry.count === 4 ? entry.sum : null;
  }
  var H9_TICKERS = ["META", "GOOG", "AMZN", "MSFT", "ORCL", "CRWV"];
  function h9EntityData(entity, capexRows) {
    var guides = capexRows.filter(function (r) { return r.entity === entity && r.status === "guidance"; })
      .slice().sort(byDate).map(function (r) {
        return { date: r.date, cy: coveredYear(r.terms), cls: classifyGuidance(r.amount), url: r.url };
      });
    var outturnByYear = annualOutturnByYear(entity, capexRows);
    var latestRangeByYear = {};
    guides.forEach(function (g) { if (g.cy && g.cls.kind === "range") { if (!latestRangeByYear[g.cy] || g.date > latestRangeByYear[g.cy].date) latestRangeByYear[g.cy] = g; } });
    var years = Object.keys(outturnByYear).sort();
    var errors = years.map(function (cy) {
      var g = latestRangeByYear[cy], o = outturnByYear[cy];
      var annual = annualOutturnValue(o);
      if (!g || annual === null) return { year: cy, error: null, hasRange: !!g };
      var err = annual - g.cls.mid;
      return { year: cy, error: err, pct: (err / g.cls.mid) * 100, guideMid: g.cls.mid, outturn: annual, hasRange: true };
    });
    return { guides: guides, outturnByYear: outturnByYear, years: years, errors: errors };
  }
  function svgH9(entity, data) {
    var W = 300, H = 150, padL = 40, padR = 8, padT = 10, padB = 20;
    var iw = W - padL - padR, ih = H - padT - padB;
    var vals = [0];
    data.guides.forEach(function (g) {
      if (g.cls.kind === "range") { vals.push(g.cls.lo); vals.push(g.cls.hi); }
      if (g.cls.kind === "runrate" && isNum(g.cls.value)) vals.push(g.cls.value);
    });
    data.years.forEach(function (cy) { var v = annualOutturnValue(data.outturnByYear[cy]); if (isNum(v)) vals.push(v); });
    var maxV = Math.max.apply(null, vals) * 1.08 || 1;
    var items = data.guides.slice();
    if (!items.length && !data.years.length) return "";
    var dates = items.map(function (g) { return g.date; }).concat(data.years.map(function (y) { return y + "-07-01"; }));
    dates.sort();
    var x0 = new Date(dates[0]).getTime(), x1 = new Date(last(dates)).getTime();
    var span = Math.max(1, x1 - x0);
    var X = function (dstr) { return padL + ((new Date(dstr).getTime() - x0) / span) * iw; };
    var Y = function (v) { return padT + ih - (v / maxV) * ih; };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='" + esc(nameOfTicker(entity)) + " guidance against outturn'>";
    [0.5, 1].forEach(function (f) {
      var y = Y(maxV * f);
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + y.toFixed(1) + "' y2='" + y.toFixed(1) + "' stroke='" + GRID + "' stroke-width='1'/>" +
        "<text x='" + (padL - 5) + "' y='" + (y + 3).toFixed(1) + "' text-anchor='end' font-size='8' fill='" + INK + "'>" + (maxV * f / 1000).toFixed(0) + "</text>";
    });
    items.forEach(function (g, i) {
      var x = X(g.date), xEnd = i + 1 < items.length ? X(items[i + 1].date) : Math.min(W - padR, x + 30);
      xEnd = Math.max(xEnd, x + 6);
      if (g.cls.kind === "range") {
        var yLo = Y(g.cls.lo), yHi = Y(g.cls.hi);
        out += "<rect x='" + x.toFixed(1) + "' y='" + yHi.toFixed(1) + "' width='" + (xEnd - x).toFixed(1) + "' height='" + Math.max(1, yLo - yHi).toFixed(1) +
          "' fill='rgba(245,197,24,.28)' stroke='#f5c518' stroke-width='1'><title>" + esc(fmtDate(g.date)) + ": guided $" + (g.cls.lo / 1000).toFixed(1) + "B–$" + (g.cls.hi / 1000).toFixed(1) + "B (as printed)</title></rect>";
      } else if (g.cls.kind === "runrate" && isNum(g.cls.value)) {
        var yr = Y(g.cls.value);
        out += "<line x1='" + x.toFixed(1) + "' x2='" + xEnd.toFixed(1) + "' y1='" + yr.toFixed(1) + "' y2='" + yr.toFixed(1) + "' stroke='" + LINE2 + "' stroke-width='1.6' stroke-dasharray='3 2'><title>" + esc(fmtDate(g.date)) + ": run rate, as printed — “" + esc(g.cls.raw) + "”</title></line>";
      } else {
        out += "<text x='" + (x + 1).toFixed(1) + "' y='" + (padT + ih * 0.55).toFixed(1) + "' font-size='11' fill='" + INK + "'>→<title>" + esc(fmtDate(g.date)) + ": direction only, as printed — “" + esc(g.cls.raw) + "”</title></text>";
      }
    });
    data.years.forEach(function (cy) {
      var entry = data.outturnByYear[cy], v = annualOutturnValue(entry);
      if (!isNum(v)) return;
      var x = X(cy + "-07-01");
      var h = (v / maxV) * ih, y = padT + ih - h;
      var basisLabel = isNum(entry.companyMetricAnnual) ? "outturn (company metric)" : "outturn (tagged cash-flow line)";
      out += "<rect x='" + (x - 4).toFixed(1) + "' y='" + y.toFixed(1) + "' width='8' height='" + h.toFixed(1) + "' fill='#5ecb8f'><title>" + esc(cy) + " " + basisLabel + ": $" + (v / 1000).toFixed(1) + "B</title></rect>";
      if (isNum(entry.sum) && entry.count === 4 && isNum(entry.companyMetricAnnual) && Math.abs(entry.sum - v) > 1) {
        var h2 = (entry.sum / maxV) * ih, y2 = padT + ih - h2;
        out += "<rect x='" + (x - 4).toFixed(1) + "' y='" + y2.toFixed(1) + "' width='8' height='" + h2.toFixed(1) + "' fill='none' stroke='#e8eaed' stroke-width='1' stroke-dasharray='2 2'><title>" + esc(cy) + " tagged line (as filed, before the company's own bridge): $" + (entry.sum / 1000).toFixed(1) + "B</title></rect>";
      }
      out += "<text x='" + x.toFixed(1) + "' y='" + (H - 4) + "' text-anchor='middle' font-size='8' fill='" + INK + "'>" + esc(cy) + "</text>";
    });
    out += "</svg>";
    return out;
  }

  /* ================================================================
     H10 — the four calendar-year hyperscalers, latest 2026 range vs
     2025 outturn, plus press aggregates (blueprint 15.4)
     ================================================================ */
  var H10_TICKERS = ["MSFT", "GOOG", "AMZN", "META"];
  function h10Data(capexRows) {
    var rows = H10_TICKERS.map(function (t) {
      var guides = capexRows.filter(function (r) { return r.entity === t && r.status === "guidance" && coveredYear(r.terms) === "2026"; }).slice().sort(byDate);
      var latest = last(guides);
      var cls = latest ? classifyGuidance(latest.amount) : null;
      var outturn2025 = annualOutturnValue(annualOutturnByYear(t, capexRows)["2025"]);
      return { ticker: t, name: ALL_NAMES[t] || t, guide: cls, guideRaw: latest ? latest.amount : null, guideDate: latest ? latest.date : null, outturn2025: outturn2025 };
    });
    var aggregates = capexRows.filter(function (r) { return r.status === "aggregate"; }).slice().sort(byDate);
    return { rows: rows, aggregates: aggregates };
  }
  function svgH10(data) {
    /* W matches the other "wide" charts on this view (H1, H8, H11-H13,
       H15-H16, H18) — the .bo-chart-wide frame stretches a narrower
       viewBox up by a large, uniform factor (its own inline-size:100%),
       which is what a 300-wide viewBox drawn here once produced as
       oversized, misaligned rows. */
    var W = 620, H = 26 * data.rows.length + 24, padL = 90, padR = 60, padT = 8;
    var iw = W - padL - padR;
    var vals = [0];
    data.rows.forEach(function (r) {
      if (r.guide && r.guide.kind === "range") { vals.push(r.guide.hi); }
      if (isNum(r.outturn2025)) vals.push(r.outturn2025);
    });
    var max = Math.max.apply(null, vals) * 1.05 || 1;
    var X = function (v) { return padL + (v / max) * iw; };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='2026 guidance ranges beside 2025 outturn, the four calendar-year hyperscalers'>";
    data.rows.forEach(function (r, i) {
      var y0 = padT + i * 26;
      out += "<text x='0' y='" + (y0 + 15) + "' font-size='10' fill='#e8eaed'>" + esc(r.name) + "</text>";
      if (r.guide && r.guide.kind === "range") {
        var x1 = X(r.guide.lo), x2 = X(r.guide.hi);
        out += "<rect x='" + x1.toFixed(1) + "' y='" + y0 + "' width='" + Math.max(1, x2 - x1).toFixed(1) + "' height='9' fill='#f5c518'><title>" + esc(r.name) + " " + esc(fmtDate(r.guideDate)) + ": 2026 guide $" + (r.guide.lo / 1000).toFixed(0) + "–$" + (r.guide.hi / 1000).toFixed(0) + "B (as printed)</title></rect>";
      } else if (r.guideRaw) {
        out += "<text x='" + padL + "' y='" + (y0 + 8) + "' font-size='9' font-style='italic' fill='" + INK + "'>direction only: “" + esc(r.guideRaw) + "”</text>";
      }
      if (isNum(r.outturn2025)) {
        var x3 = X(r.outturn2025);
        out += "<rect x='" + padL + "' y='" + (y0 + 12) + "' width='" + Math.max(1, x3 - padL).toFixed(1) + "' height='9' fill='#5ecb8f'><title>" + esc(r.name) + " 2025 outturn: $" + (r.outturn2025 / 1000).toFixed(0) + "B</title></rect>";
      }
    });
    out += "</svg>";
    return out;
  }
  function svgH10Aggregates(aggregates) {
    if (!aggregates.length) return "";
    var W = 620, H = 34, padL = 10, padR = 10;
    var x0 = new Date(aggregates[0].date).getTime(), x1 = new Date(last(aggregates).date).getTime();
    var span = Math.max(1, x1 - x0);
    var X = function (d) { return padL + ((new Date(d).getTime() - x0) / span) * (W - padL - padR); };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Press capex aggregates, dated'>";
    out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='17' y2='17' stroke='" + GRID + "' stroke-width='1'/>";
    aggregates.forEach(function (a) {
      var x = X(a.date);
      out += "<circle cx='" + x.toFixed(1) + "' cy='17' r='4' fill='#c99cf2'><title>" + esc(fmtDate(a.date)) + " — " + esc(a.entity) + ": " + esc(a.amount) + " " + esc(a.unit) + ". " + esc(a.terms.slice(0, 180)) + "</title></circle>";
    });
    out += "</svg>";
    return out;
  }

  /* ================================================================
     H11 — the deal timeline (blueprint 15.5)
     ================================================================ */
  var H11_LANES = ["bond", "private credit facility", "bank loan", "convertible", "JV/SPV", "lease-backed", "ABS or CMBS", "equity", "contract", "commentary"];
  /* Round-2 fix (blueprint 15.5: "rate on hover"): every non-USD segment
     of a row's amount, with the FX rate actually used to convert it and
     that rate's own observation date — not assumed to be the row's own
     pricing date, since this feed is monthly-downsampled and the
     nearest point on or before the pricing date can be earlier than it. */
  function fxDetailsOf(row, fx) {
    var unit = String(row.unit || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    var unitSegs = unit.split("+").map(function (s) { return s.trim(); });
    var amtSegs = String(row.amount).split("+").map(function (s) { return s.trim(); });
    var out = [];
    function add(currency) {
      if (!currency || currency === "USD") return;
      var pt = pointOnOrBefore(fx && fx[currency], row.date);
      if (pt) out.push({ currency: currency, rate: pt.value, date: pt.date });
    }
    if (unitSegs.length === 1) {
      var um = /^(USD|EUR|GBP|CHF|CAD|JPY)\b/.exec(unitSegs[0]);
      add(um ? um[1] : null);
      return out;
    }
    for (var j = 0; j < amtSegs.length && j < unitSegs.length; j++) {
      var explicit = /^([A-Z]{3})\s+/.exec(amtSegs[j]);
      var um2 = /^(USD|EUR|GBP|CHF|CAD|JPY)\b/.exec(unitSegs[j]);
      add(explicit ? explicit[1] : (um2 ? um2[1] : null));
    }
    return out;
  }
  function h11Data(dealsRows, fx) {
    return dealsRows.slice().sort(byDate).map(function (r) {
      var usdBn = amountUsdBn(r, fx);
      var cls = classifyEntity(r.entity);
      var lane = H11_LANES.indexOf(r.structure);
      return {
        date: r.date, entity: r.entity, structure: r.structure, status: r.status, url: r.url,
        usdBn: usdBn, lane: lane < 0 ? H11_LANES.length : lane, cohort: cls.cohort,
        hollow: r.status === "announcement" || r.status === "contract",
        amount: r.amount, unit: r.unit, fxDetails: fxDetailsOf(r, fx)
      };
    });
  }
  function svgH11(rows) {
    if (!rows.length) return "";
    var W = 720, H = 30 * (H11_LANES.length + 1) + 20, padL = 8, padR = 8, padT = 10;
    var x0 = new Date(rows[0].date).getTime(), x1 = new Date(last(rows).date).getTime();
    var span = Math.max(1, x1 - x0);
    var iw = W - padL - padR;
    var X = function (d) { return padL + ((new Date(d).getTime() - x0) / span) * iw; };
    var maxUsd = 0;
    rows.forEach(function (r) { if (isNum(r.usdBn) && r.usdBn > maxUsd) maxUsd = r.usdBn; });
    if (!maxUsd) maxUsd = 1;
    function radius(v) { return isNum(v) ? clamp(Math.sqrt(v / maxUsd) * 13, 3, 15) : 3.5; }
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Deal timeline: bubble area is deal size, color is structure, ring is borrower cohort'>";
    H11_LANES.concat(["other"]).forEach(function (lane, i) {
      var y = padT + i * 30 + 15;
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + y + "' y2='" + y + "' stroke='" + GRID + "' stroke-width='.6'/>";
      out += "<text x='2' y='" + (y - 3) + "' font-size='8' fill='" + INK + "'>" + esc(lane) + "</text>";
    });
    rows.forEach(function (r) {
      var x = X(r.date), y = padT + r.lane * 30 + 15;
      var color = structureColor(r.structure);
      var ringColor = r.cohort === "hyperscaler" ? "#f5c518" : (r.cohort === "neocloud" ? "#6bc9c9" : null);
      var rad = radius(r.usdBn);
      var fillAttr = r.hollow ? "fill='none' stroke='" + color + "' stroke-width='1.6'" : "fill='" + color + "' fill-opacity='.85'";
      var fxNote = (r.fxDetails && r.fxDetails.length)
        ? " [" + r.fxDetails.map(function (f) { return f.currency + " at " + f.rate.toFixed(4) + " (" + fmtDate(f.date) + " close)"; }).join(", ") + "]"
        : "";
      var titleText = esc(fmtDate(r.date)) + " — " + esc(r.entity) + " (" + esc(r.structure) + ", " + esc(r.status) + "): " + esc(r.amount) + " " + esc(r.unit) + esc(fxNote);
      /* every bubble is a link to its own row's URL — the PR H3
         acceptance line ("every bubble opens a URL") is a click target,
         not only a tooltip; the ledger's own build check (H0) already
         refuses a row without one, so this is never a dead link */
      out += "<a href='" + esc(r.url) + "' target='_blank' rel='noopener'>";
      if (ringColor) out += "<circle cx='" + x.toFixed(1) + "' cy='" + y + "' r='" + (rad + 2.5).toFixed(1) + "' fill='none' stroke='" + ringColor + "' stroke-width='1.4'/>";
      out += "<circle cx='" + x.toFixed(1) + "' cy='" + y + "' r='" + rad.toFixed(1) + "' " + fillAttr + "><title>" + titleText + "</title></circle>";
      out += "</a>";
    });
    out += "</svg>";
    return out;
  }

  /* ================================================================
     H12 — running totals by structure and by lender type (15.5)
     ================================================================ */
  function h12MonthKeys(rows) {
    var seen = {};
    rows.forEach(function (r) { seen[String(r.date).slice(0, 7)] = true; });
    return Object.keys(seen).sort();
  }
  /* Round-2 fix: a same-currency compound amount ("5.0 debt + 5.0
     equity", unit "USD bn") names more than one house structure inside
     one row (xAI's debt-plus-equity raise, CoreWeave's senior-plus-
     convertible notes, Nebius's convertible-plus-share-offering). Before
     this fix h12Data keyed the whole row on its single `structure` tag,
     landing the equity or convertible slice in the bond lane. This reads
     the descriptive word already printed after each segment's number —
     never invented — and apportions the row's own USD total across the
     structures its own terms name; a row that is not this shape (no "+"
     in `amount`, or a multi-currency "+" in `unit`) is unchanged. */
  function structureSegmentsOf(row, fx) {
    var unit = String(row.unit || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    var whole = amountUsdBn(row, fx);
    if (whole === null) return [];
    if (unit.indexOf("+") !== -1) return [{ structure: row.structure, usdBn: whole }];
    var amtSegs = String(row.amount).split("+");
    if (amtSegs.length < 2) return [{ structure: row.structure, usdBn: whole }];
    var segs = amtSegs.map(function (raw) {
      var word = raw.toLowerCase();
      var structure = row.structure;
      if (/\bequity\b/.test(word)) structure = "equity";
      else if (/\bconvertible\b/.test(word)) structure = "convertible";
      return { structure: structure, n: parseLeadingNumber(raw) };
    });
    if (segs.some(function (s) { return s.n === null; })) return [{ structure: row.structure, usdBn: whole }];
    var sumN = segs.reduce(function (a, s) { return a + s.n; }, 0);
    if (!sumN) return [{ structure: row.structure, usdBn: whole }];
    return segs.map(function (s) { return { structure: s.structure, usdBn: whole * (s.n / sumN) }; });
  }
  function h12Data(dealsRows, groupMode, fx) {
    var financing = dealsRows.filter(isFinancingRow);
    var months = h12MonthKeys(financing);
    var groups = {};
    var skipped = [];
    var latestDate = null;
    financing.forEach(function (r) {
      var segs = structureSegmentsOf(r, fx);
      if (!segs.length || segs.some(function (s) { return s.usdBn === null; })) { skipped.push(r); return; }
      if (!latestDate || r.date > latestDate) latestDate = r.date;
      var m = String(r.date).slice(0, 7);
      segs.forEach(function (s) {
        var k = groupMode === "lenderType" ? lenderTypeOf(s.structure, r) : s.structure;
        if (!groups[k]) groups[k] = {};
        groups[k][m] = (groups[k][m] || 0) + s.usdBn;
      });
    });
    var keys = Object.keys(groups).sort(function (a, b) {
      var ta = 0, tb = 0;
      months.forEach(function (m) { ta += groups[a][m] || 0; tb += groups[b][m] || 0; });
      return tb - ta;
    });
    var cumulative = {};
    keys.forEach(function (k) {
      var running = 0;
      cumulative[k] = months.map(function (m) { running += groups[k][m] || 0; return running; });
    });
    return { months: months, keys: keys, cumulative: cumulative, skipped: skipped, latestDate: latestDate, totalUsdBn: keys.reduce(function (a, k) { return a + (last(cumulative[k]) || 0); }, 0) };
  }
  function svgH12(data) {
    if (!data.months.length) return "";
    var W = 620, H = 240, padL = 44, padR = 100, padT = 10, padB = 20;
    var iw = W - padL - padR, ih = H - padT - padB;
    var n = data.months.length;
    var totals = data.months.map(function (_, i) { return data.keys.reduce(function (a, k) { return a + data.cumulative[k][i]; }, 0); });
    var maxTotal = Math.max.apply(null, totals) * 1.05 || 1;
    var X = function (i) { return padL + (n <= 1 ? 0 : (i / (n - 1)) * iw); };
    var Y = function (v) { return padT + ih - (v / maxTotal) * ih; };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Running total of signed and closed financing, cumulative monthly, stacked'>";
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var y = Y(maxTotal * f);
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + y.toFixed(1) + "' y2='" + y.toFixed(1) + "' stroke='" + GRID + "' stroke-width='1'/>" +
        "<text x='" + (padL - 6) + "' y='" + (y + 3).toFixed(1) + "' text-anchor='end' font-size='9' fill='" + INK + "'>$" + (maxTotal * f).toFixed(0) + "B</text>";
    });
    var below = new Array(n).fill(0);
    var labels = [];
    data.keys.forEach(function (k, ki) {
      var color = STRUCTURE_COLOR[k] || LENDER_TYPE_COLOR(k, ki);
      var top = data.cumulative[k];
      var d = "M" + X(0).toFixed(1) + " " + Y(below[0]).toFixed(1);
      for (var i = 0; i < n; i++) d += " L" + X(i).toFixed(1) + " " + Y(below[i] + top[i]).toFixed(1);
      for (var j = n - 1; j >= 0; j--) d += " L" + X(j).toFixed(1) + " " + Y(below[j]).toFixed(1);
      out += "<path d='" + d + " Z' fill='" + color + "' fill-opacity='.8'><title>" + esc(k) + ": $" + last(top).toFixed(2) + "B cumulative as of " + esc(data.months[n - 1]) + "</title></path>";
      for (var m = 0; m < n; m++) below[m] += top[m];
      labels.push({ key: k, color: color, y: Y(below[n - 1]) });
    });
    /* the series with the smallest cumulative totals stack closest
       together near the top of the frame — without a minimum vertical
       gap their end-of-line labels overlap into an unreadable blur, so
       labels are nudged apart in ascending-y order (top to bottom) by
       at least one line height, keeping their draw order (largest
       series first) otherwise untouched. */
    labels.sort(function (a, b) { return a.y - b.y; });
    for (var li = 1; li < labels.length; li++) {
      if (labels[li].y - labels[li - 1].y < 10) labels[li].y = labels[li - 1].y + 10;
    }
    labels.forEach(function (l) {
      out += "<text x='" + (W - padR + 6) + "' y='" + (l.y + 3).toFixed(1) + "' font-size='9' fill='" + l.color + "'>" + esc(l.key) + "</text>";
    });
    out += "</svg>";
    return out;
  }
  var LENDER_TYPE_PALETTE = { "Public bond investors": "#f5c518", "Banks": "#b6bac2", "Private credit funds": "#5ecb8f", "Convertible investors": "#c99cf2", "Strategic and customer equity": "#e8935a", "Public and private equity issuance": "#c97a3f", "Asset managers and insurers": "#f0c96a", "JV/SPV partners": "#6bc9c9", "Other": "#8b8f98" };
  function LENDER_TYPE_COLOR(k) { return LENDER_TYPE_PALETTE[k] || "#8b8f98"; }

  /* ================================================================
     H13 — price of capital by borrower class over time (15.5)
     ================================================================ */
  /* Every fixed-rate tranche a credit-ledger "signed" bond row's
     `terms` prints ("4.700% 2034 (T+95, ...)"), with an optional
     per-tranche dollar size when the row happens to print one right
     after the tranche. Tenor is the tranche's maturity year minus the
     row's own pricing year; a tranche is "long" (outlined, connected
     across a ticker's history) at 30 years or more, matching the
     ledger's own clean tenor buckets (2, 3, 5, 7, 8, 10, 20, 30, 40, 50
     — there is no 25-29 band to round against). */
  function h13BondTranches(creditRows) {
    var out = [];
    creditRows.filter(function (r) { return r.status === "signed" && r.structure === "bond"; }).forEach(function (r) {
      var cls = classifyEntity(r.entity);
      var rx = /(\d+\.\d{3})%\s+(\d{4})(?:\s+\$?([\d.]+)\s*bn)?\s*\(T\+(-?\d+)/g;
      var m;
      var pricingYear = Number(r.date.slice(0, 4));
      while ((m = rx.exec(r.terms))) {
        out.push({
          date: r.date, ticker: cls.ticker, name: cls.name || r.entity, coupon: Number(m[1]), maturityYear: Number(m[2]),
          amountBn: m[3] ? Number(m[3]) : null, spreadBps: Number(m[4]),
          tenor: Number(m[2]) - pricingYear, url: r.url
        });
      }
    });
    return out;
  }
  /* Every floating-rate delayed-draw margin a deals-ledger "private
     credit facility" row's `terms` prints ("SOFR + 4.00%"), read as a
     margin over SOFR — never converted to an all-in level here (that
     needs the 90-day average SOFR ON THE PRICING DATE, which the site's
     macro feed serves only at monthly grain; see this file's contract
     note on H13 for the open item). */
  function h13FloatingMargins(dealsRows, fx) {
    var out = [];
    dealsRows.filter(function (r) { return r.structure === "private credit facility"; }).forEach(function (r) {
      var m = /SOFR\s*\+\s*(\d+(?:\.\d+)?)%/i.exec(r.terms);
      if (!m) return;
      var cls = classifyEntity(r.entity);
      out.push({ date: r.date, entity: r.entity, name: cls.name || r.entity, marginPct: Number(m[1]), amountBn: amountUsdBn(r, fx), url: r.url });
    });
    return out.sort(byDate);
  }
  function svgH13(bondTranches, floatMargins) {
    var W = 620, H = 200, padL = 40, padR = 10, padT = 10, padB = 18;
    var iw = W - padL - padR, ih = H - padT - padB;
    var all = bondTranches.map(function (t) { return t.date; }).concat(floatMargins.map(function (t) { return t.date; }));
    if (!all.length) return "";
    all.sort();
    var x0 = new Date(all[0]).getTime(), x1 = new Date(last(all)).getTime();
    var span = Math.max(1, x1 - x0);
    var X = function (d) { return padL + ((new Date(d).getTime() - x0) / span) * iw; };
    var maxCoupon = Math.max.apply(null, bondTranches.map(function (t) { return t.coupon; }).concat([1])) * 1.1;
    var Y = function (v) { return padT + ih - (v / maxCoupon) * ih; };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Price of capital: bond coupons by tenor, and delayed-draw margins over SOFR'>";
    [0, 0.5, 1].forEach(function (f) {
      var y = Y(maxCoupon * f);
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + y.toFixed(1) + "' y2='" + y.toFixed(1) + "' stroke='" + GRID + "' stroke-width='1'/>" +
        "<text x='" + (padL - 5) + "' y='" + (y + 3).toFixed(1) + "' text-anchor='end' font-size='8' fill='" + INK + "'>" + (maxCoupon * f).toFixed(1) + "%</text>";
    });
    /* connect each ticker's 30-year tranches as a line, per blueprint
       15.5's own words ("hyperscaler 30-year tranches connected as a
       line") — exactly 30, not "30 and longer": a hyperscaler bond deal
       often prices a 30-year tranche alongside a separate 40-year one on
       the same date (Meta's 2026-04-30 deal did both, at 6.300% and
       6.450%), and folding the two tenors into one line would silently
       average two different points on the same curve. H16's "30-year-
       and-longer" outline is a different, deliberately wider rule
       (blueprint 15.7's own words) and keeps its own >= 30 test. */
    var byTicker = {};
    bondTranches.forEach(function (t) { if (t.tenor === 30) { (byTicker[t.ticker || t.name] = byTicker[t.ticker || t.name] || []).push(t); } });
    Object.keys(byTicker).forEach(function (k, ki) {
      var pts = byTicker[k].slice().sort(byDate);
      var color = ["#f5c518", "#5ecb8f", "#ff8a80", "#c99cf2", "#6bc9c9"][ki % 5];
      var d = "";
      pts.forEach(function (p, i) { d += (i ? "L" : "M") + X(p.date).toFixed(1) + " " + Y(p.coupon).toFixed(1) + " "; });
      out += "<path d='" + d.trim() + "' fill='none' stroke='" + color + "' stroke-width='1.4'/>";
      pts.forEach(function (p) {
        out += "<circle cx='" + X(p.date).toFixed(1) + "' cy='" + Y(p.coupon).toFixed(1) + "' r='3' fill='" + color + "'><title>" + esc(p.name) + " " + esc(fmtDate(p.date)) + ": " + p.coupon.toFixed(3) + "% due " + p.maturityYear + " (T+" + p.spreadBps + ", " + p.tenor + "-year)</title></circle>";
      });
    });
    /* every other tenor (including 40- and 50-year) as small unconnected
       dots, muted */
    bondTranches.forEach(function (t) {
      if (t.tenor === 30) return;
      out += "<circle cx='" + X(t.date).toFixed(1) + "' cy='" + Y(t.coupon).toFixed(1) + "' r='2' fill='" + LINE2 + "' fill-opacity='.6'><title>" + esc(t.name) + " " + esc(fmtDate(t.date)) + ": " + t.coupon.toFixed(3) + "% due " + t.maturityYear + " (T+" + t.spreadBps + ")</title></circle>";
    });
    /* floating margins as diamonds along the bottom of the frame, own
       reading (never on the coupon scale above — a margin over SOFR and
       a fixed coupon are not the same measure) */
    var maxMargin = Math.max.apply(null, floatMargins.map(function (f) { return f.marginPct; }).concat([1]));
    floatMargins.forEach(function (f) {
      var y = padT + ih - 4 - (f.marginPct / maxMargin) * 14;
      out += "<rect x='" + (X(f.date) - 3).toFixed(1) + "' y='" + (y - 3).toFixed(1) + "' width='6' height='6' transform='rotate(45 " + X(f.date).toFixed(1) + " " + y.toFixed(1) + ")' fill='#ff8a80'><title>" + esc(f.name) + " " + esc(fmtDate(f.date)) + ": SOFR + " + f.marginPct.toFixed(2) + "% delayed-draw margin (not an all-in level — see the panel's note)</title></rect>";
    });
    out += "</svg>";
    return out;
  }

  /* ================================================================
     H14 — neocloud leverage panel (blueprint 15.6)
     ================================================================ */
  /* Hand-keyed, cited quotes and splits the tagged data cannot supply —
     the same pattern credit-buildout.js's own H8 uses for
     UNCOMMENCED_LEASE_ADJUSTMENTS, sourced from blueprint 15.6's own
     already-refuter-checked quotes. Never regenerated from a fetch;
     re-key by hand if the underlying filing changes. */
  /* Round-2 fix: `verbatim: true` means `quote` is the filing's own
     sentence and is rendered inside quotation marks; `verbatim: false`
     means it is this site's own summary of the row and is rendered as
     prose without quotation marks (blueprint 15.6: "recourse is quoted,
     never interpreted" — a paraphrase must never be dressed up as a
     quotation). Every entry now carries a form, an accession or the
     deal-ledger row's own URL — never the internal blueprint doc, which
     is not a page a reader of this site can open. */
  var NEOCLOUD_LEVERAGE_NOTES = {
    CRWV: {
      nonRecourseUsdBn: 3.663, nonRecourseNote: "DDTL 4.0 ($2,837m) plus OEM and software license financing ($882m)",
      quote: "the debt of these entities was secured by $18.2 billion of non-current assets and $2.6 billion of current assets",
      verbatim: true,
      source: "10-Q (accession 0001769628-26-000366), Note 10, period 2026-06-30",
      url: "https://www.sec.gov/Archives/edgar/data/1769628/000176962826000366/crwv-20260630.htm"
    },
    APLD: {
      nonRecourseUsdBn: null,
      quote: "APLD's ComputeCo project-finance subsidiaries (ComputeCo LLC, ComputeCo 2 LLC, ComputeCo 3 LLC) are structured as bankruptcy-remote special-purpose issuers of the ledger's Polaris Forge notes; this site has not verified the filing's own recourse language for FY2026 (10-K, Note 11) against a fetched copy, so it is stated here as the site's own summary, not a quotation.",
      verbatim: false,
      source: "10-K (accession 0001144879-26-000048), Note 11",
      url: "https://www.sec.gov/Archives/edgar/data/1144879/000114487926000048/apld-20260531.htm"
    },
    IREN: {
      nonRecourseUsdBn: null,
      quote: "IE US Hardware 3 LLC's parent support is limited to a guarantee of the manager's obligations under a managed services agreement and of shortfalls from tranches Microsoft does not accept or terminates — not a full parent guarantee, per the facility's own printed terms.",
      verbatim: false,
      source: "8-K, deal-ledger row (IREN / IE US Hardware 3 LLC, 2026-05-29)",
      url: "https://www.sec.gov/Archives/edgar/data/1878848/000114036126023427/ef20075181_8k.htm"
    },
    NBIS: { nonRecourseUsdBn: null, quote: null, verbatim: false, source: null, url: null },
    CIFR: { nonRecourseUsdBn: null, quote: null, verbatim: false, source: null, url: null },
    WULF: { nonRecourseUsdBn: null, quote: null, verbatim: false, source: null, url: null }
  };
  var H14_TICKERS = ["CRWV", "NBIS", "APLD", "IREN", "CIFR", "WULF"];
  function daysBetweenDates(a, b) {
    var da = a ? new Date(a).getTime() : NaN, db = b ? new Date(b).getTime() : NaN;
    return (isFinite(da) && isFinite(db)) ? Math.abs(db - da) / 86400000 : Infinity;
  }
  function h14CardData(ticker, company) {
    if (!company) return { ticker: ticker, name: NEOCLOUD_NAMES[ticker], missing: true };
    var BI = window.RTBuildout && window.RTBuildout._internal;
    var allPoints = (company.quarterly || []).concat(company.annual || []);
    var mostRecent = allPoints.length ? allPoints.slice().sort(function (a, b) { return a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0; }).pop() : null;
    var latestDebt = BI ? BI.latestWithField(company, "debt.grossDebt") : mostRecent;
    if (!latestDebt || !mostRecent) return { ticker: ticker, name: NEOCLOUD_NAMES[ticker], missing: true };
    /* a gross-debt instant far older than this filer's own newest
       reported period is not "now" — Applied Digital's only resolved
       gross-debt tag on file is 2022-05-31 (its recent periods carry a
       null tag), the same gap credit-buildout.js's own H6 section
       excludes from its net-debt count with this exact 425-day rule; a
       stale figure is shown with its own date and a caveat, never
       silently presented as current. */
    var staleGrossDebt = daysBetweenDates(latestDebt.periodEnd, mostRecent.periodEnd) > 425;
    /* net debt to EBITDA and backlog to debt need a resolved gross-debt
       figure to mean anything, so they are read from `latestDebt` (the
       same point the debt bar draws, whichever period that is) — never
       recombined with a different period's backlog or debt, which would
       silently divide one filing's number by another's. Cash interest,
       operating cash flow and the maturity buckets do NOT depend on
       gross debt at all, so they are read from `mostRecent` even when
       the gross-debt tag itself is stale (this is exactly what let
       Applied Digital's real, current cash-interest-to-OCF ratio and
       backlog figure show up despite its stale, untagged gross debt). */
    var d = latestDebt.debt || {}, ob = latestDebt.obligationsRatios || {};
    var ir = mostRecent.interest || {}, cf = mostRecent.cashFlow || {}, cash = mostRecent.cash || {}, mat = mostRecent.maturities || {};
    var nextTwoYear = (mat.maturityRemainderOfFiscalYear || 0) + (mat.maturityNextTwelveMonths || 0) + (mat.maturityYearTwo || 0);
    var maturitiesToCash = isNum(cash.cash) && cash.cash > 0 && nextTwoYear ? nextTwoYear / cash.cash : null;
    /* "n/m" on a non-positive operating cash flow, the same convention
       net debt to EBITDA already uses for a non-positive EBITDA — a
       negative divisor would otherwise flip a coverage ratio's sign into
       a number that reads like healthy, small leverage. */
    var cashInterestToOcf = !isNum(ir.interestPaid) || !isNum(cf.cfOps) ? null : (cf.cfOps <= 0 ? "n/m" : ir.interestPaid / cf.cfOps);
    var note = NEOCLOUD_LEVERAGE_NOTES[ticker] || {};
    var backlog = mostRecent.obligations ? mostRecent.obligations.remainingPerformanceObligation || mostRecent.obligations.lessorBacklog : null;
    return {
      ticker: ticker, name: NEOCLOUD_NAMES[ticker], periodEnd: mostRecent.periodEnd,
      debtPeriodEnd: latestDebt.periodEnd, grossDebt: staleGrossDebt ? null : d.grossDebt, grossDebtStale: staleGrossDebt ? d.grossDebt : null,
      nonRecourseUsdBn: note.nonRecourseUsdBn, nonRecourseNote: note.nonRecourseNote,
      backlog: backlog,
      netDebtToEbitda: staleGrossDebt ? null : d.netDebtToEbitda, backlogToDebt: staleGrossDebt ? null : ob.backlogToDebt,
      cashInterestToOcf: cashInterestToOcf, maturitiesToCash: maturitiesToCash, quote: note.quote, source: note.source,
      quoteVerbatim: note.verbatim, quoteUrl: note.url
    };
  }
  function svgH14Debt(card) {
    var W = 260, H = 34, padL = 4, padR = 4;
    var iw = W - padL - padR;
    if (!isNum(card.grossDebt) || card.grossDebt <= 0) return "";
    var nonRecBn = isNum(card.nonRecourseUsdBn) ? card.nonRecourseUsdBn : 0;
    var nonRecFrac = clamp((nonRecBn * 1e9) / card.grossDebt, 0, 1);
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='" + esc(card.name) + " gross debt'>";
    var wRec = iw * (1 - nonRecFrac), wNon = iw * nonRecFrac;
    out += "<rect x='" + padL + "' y='6' width='" + wRec.toFixed(1) + "' height='16' fill='#f5c518'><title>Recourse: " + fmtBn((card.grossDebt / 1e9) - nonRecBn) + "</title></rect>";
    if (nonRecFrac > 0) out += "<rect x='" + (padL + wRec).toFixed(1) + "' y='6' width='" + wNon.toFixed(1) + "' height='16' fill='#ff8a80'><title>Non-recourse: " + fmtBn(nonRecBn) + (card.nonRecourseNote ? " (" + esc(card.nonRecourseNote) + ")" : "") + "</title></rect>";
    out += "<text x='" + padL + "' y='30' font-size='9' fill='" + INK + "'>Gross debt " + fmtBn(card.grossDebt / 1e9) + (nonRecFrac > 0 ? " — " + (nonRecFrac * 100).toFixed(0) + "% non-recourse" : "") + "</text>";
    out += "</svg>";
    return out;
  }
  function h14Tile(label, value) { return "<div class='bo-tile'><span class='bo-tile-label'>" + esc(label) + "</span><span class='bo-tile-value'>" + esc(value) + "</span></div>"; }

  /* ================================================================
     H15 — developer to tenant to backstop Sankey (blueprint 15.6)
     ================================================================ */
  /* Every edge here is read directly off a deals-ledger "contract" row
     (the developer/tenant/backstop names in the row's own `entity` and
     `counterparties`, the link width its own printed amount) — this is
     not the blueprint's full named list (15.6 names more developer-
     tenant pairs than the corrected ledger carries as a standalone,
     dollar-valued contract row); see this file's H15 contract note for
     what is not drawn and why. */
  var SANKEY_SOURCE_ROWS = [
    { match: /Applied Digital \/ CoreWeave/, developer: "Applied Digital", tenant: "CoreWeave", backstop: null },
    { match: /TeraWulf \/ Fluidstack \/ Google/, developer: "TeraWulf", tenant: "Fluidstack", backstop: "Google" },
    { match: /Cipher Mining \/ Fluidstack \/ Google/, developer: "Cipher", tenant: "Fluidstack", backstop: "Google" },
    { match: /Hut 8 \/ Fluidstack \/ Google/, developer: "Hut 8", tenant: "Fluidstack", backstop: "Google" }
  ];
  function h15Data(dealsRows) {
    var edges = [];
    dealsRows.forEach(function (r) {
      SANKEY_SOURCE_ROWS.forEach(function (spec) {
        if (spec.match.test(r.entity)) {
          var v = parseLeadingNumber(r.amount);
          /* the ledger's own unit qualifier says what the dollars are: a
             row unit carrying "backstop" is Google's backstop exposure,
             never a contract or lease value — mixing the two into one
             "printed contract value" total is exactly the must-not-build
             rule this file's own header names (a contract row's amount
             stays what its unit says it is). */
          var isBackstopValue = /backstop/i.test(String(r.unit || ""));
          edges.push({ developer: spec.developer, tenant: spec.tenant, backstop: spec.backstop, valueBn: v, unit: r.unit, url: r.url, date: r.date, isBackstopValue: isBackstopValue });
        }
      });
    });
    return edges;
  }
  function svgH15(edges) {
    if (!edges.length) return "";
    var W = 620, H = 200;
    var devs = [], tenants = [], backstops = [];
    edges.forEach(function (e) {
      if (devs.indexOf(e.developer) < 0) devs.push(e.developer);
      if (tenants.indexOf(e.tenant) < 0) tenants.push(e.tenant);
      var b = e.backstop || "None named";
      if (backstops.indexOf(b) < 0) backstops.push(b);
    });
    var colX = [70, 320, 570];
    function yOf(list, name, colH) { var i = list.indexOf(name); return 20 + (i + 0.5) * (colH / list.length); }
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Developers to tenants to backstop; solid link width is printed contract or lease value, dashed link width is a Google backstop amount and is not a contract value'>";
    var maxV = Math.max.apply(null, edges.map(function (e) { return e.valueBn || 1; }));
    edges.forEach(function (e) {
      var y1 = yOf(devs, e.developer, H - 40), y2 = yOf(tenants, e.tenant, H - 40);
      var w = clamp(((e.valueBn || 1) / maxV) * 16, 2, 16);
      var color = structureColor("JV/SPV");
      var devTenantTitle = e.isBackstopValue
        ? esc(e.developer) + " → " + esc(e.tenant) + ": no printed contract value on this row — $" + e.valueBn + "B shown here is the Google backstop amount (see the next leg), " + esc(fmtDate(e.date))
        : esc(e.developer) + " → " + esc(e.tenant) + ": " + esc(e.unit === "USD bn" ? "$" + e.valueBn + "B" : e.valueBn + " " + e.unit) + " as printed, " + esc(fmtDate(e.date));
      out += "<a href='" + esc(e.url) + "' target='_blank' rel='noopener'><path d='M" + colX[0] + " " + y1.toFixed(1) + " C " + (colX[0] + 120) + " " + y1.toFixed(1) + ", " + (colX[1] - 120) + " " + y2.toFixed(1) + ", " + colX[1] + " " + y2.toFixed(1) +
        "' fill='none' stroke='" + color + "' stroke-width='" + w.toFixed(1) + "' stroke-opacity='.55'" + (e.isBackstopValue ? " stroke-dasharray='4 3'" : "") + "><title>" + devTenantTitle + "</title></path></a>";
      if (e.backstop) {
        var y3 = yOf(backstops, e.backstop, H - 40);
        out += "<a href='" + esc(e.url) + "' target='_blank' rel='noopener'><path d='M" + colX[1] + " " + y2.toFixed(1) + " C " + (colX[1] + 120) + " " + y2.toFixed(1) + ", " + (colX[2] - 120) + " " + y3.toFixed(1) + ", " + colX[2] + " " + y3.toFixed(1) +
          "' fill='none' stroke='#6bc9c9' stroke-width='" + w.toFixed(1) + "' stroke-opacity='.5'><title>" + esc(e.tenant) + " backstopped by " + esc(e.backstop) + (e.isBackstopValue ? ": $" + e.valueBn + "B backstop exposure" : "") + "</title></path></a>";
      }
    });
    [devs, tenants, backstops].forEach(function (list, ci) {
      list.forEach(function (name) {
        var y = yOf(list, name, H - 40);
        out += "<circle cx='" + colX[ci] + "' cy='" + y.toFixed(1) + "' r='4' fill='#e8eaed'/><text x='" + (colX[ci] + (ci === 2 ? -8 : 8)) + "' y='" + (y + 3).toFixed(1) + "' text-anchor='" + (ci === 2 ? "end" : "start") + "' font-size='10' fill='#e8eaed'>" + esc(name) + "</text>";
      });
    });
    out += "</svg>";
    return out;
  }

  /* ================================================================
     H16 — new-issue spreads against the OAS lines (blueprint 15.7)
     ================================================================ */
  function h16Tranches(creditRows) {
    var out = [];
    creditRows.filter(function (r) { return r.status === "signed" && r.structure === "bond"; }).forEach(function (r) {
      var cls = classifyEntity(r.entity);
      var rx = /(\d+\.\d{3})%\s+(\d{4})(?:\s+\$?([\d.]+)\s*bn)?\s*\(T\+(-?\d+)/g;
      var m, pricingYear = Number(r.date.slice(0, 4));
      while ((m = rx.exec(r.terms))) {
        var tenor = Number(m[2]) - pricingYear;
        /* Round-2 fix: a tranche whose terms print no per-tranche size
           (m[3] undefined — 19 of 87 in the credit ledger) used to be
           given a fabricated $0.5bn so it could be sized like every
           other marker; no tranche in the ledger is genuinely $0.5bn,
           so that value was indistinguishable from a real one. null
           here, drawn at a fixed, visually distinct minimum radius by
           svgH16 below, with its own tooltip saying so — never guessed. */
        out.push({ date: r.date, ticker: cls.ticker, name: cls.name || r.entity, maturityYear: Number(m[2]), spreadBps: Number(m[4]), amountBn: m[3] ? Number(m[3]) : null, long: tenor >= 30, url: r.url });
      }
    });
    return out;
  }
  var OAS_IDS = ["BAMLC0A1CAAA", "BAMLC0A2CAA", "BAMLC0A3CA", "BAMLC0A4CBBB", "BAMLH0A0HYM2"];
  var OAS_LABEL = { BAMLC0A1CAAA: "AAA", BAMLC0A2CAA: "AA", BAMLC0A3CA: "Single-A", BAMLC0A4CBBB: "BBB", BAMLH0A0HYM2: "HY" };
  var OAS_COLOR = { BAMLC0A1CAAA: "#5ecb8f", BAMLC0A2CAA: "#6bc9c9", BAMLC0A3CA: "#f5c518", BAMLC0A4CBBB: "#e8935a", BAMLH0A0HYM2: "#ff8a80" };
  function svgH16(macro, tranches) {
    var W = 620, H = 240, padL = 34, padR = 40, padT = 10, padB = 18;
    var iw = W - padL - padR, ih = H - padT - padB;
    var haveOas = macro && OAS_IDS.some(function (id) { return macro[id] && macro[id].history && macro[id].history.length; });
    var allDates = tranches.map(function (t) { return t.date; });
    if (haveOas) OAS_IDS.forEach(function (id) { if (macro[id] && macro[id].history) macro[id].history.forEach(function (p) { allDates.push(p.d); }); });
    if (!allDates.length) return "";
    allDates.sort();
    var x0 = new Date(allDates[0]).getTime(), x1 = new Date(last(allDates)).getTime();
    var span = Math.max(1, x1 - x0);
    var X = function (d) { return padL + ((new Date(d).getTime() - x0) / span) * iw; };
    var maxOas = 1.4;
    var Yl = function (v) { return padT + ih - (v / maxOas) * ih; };
    var maxSpread = Math.max.apply(null, tranches.map(function (t) { return t.spreadBps; }).concat([50])) * 1.1;
    var Yr = function (v) { return padT + ih - (v / maxSpread) * ih; };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='New-issue spreads to Treasuries against index option-adjusted spreads, two separate axes'>";
    [0, 0.5, 1].forEach(function (f) {
      var y = Yl(maxOas * f);
      out += "<text x='" + (padL - 4) + "' y='" + (y + 3).toFixed(1) + "' text-anchor='end' font-size='8' fill='" + INK + "'>" + (maxOas * f).toFixed(1) + "%</text>";
      out += "<text x='" + (W - padR + 4) + "' y='" + (Yr(maxSpread * f) + 3).toFixed(1) + "' font-size='8' fill='" + INK + "'>" + (maxSpread * f).toFixed(0) + "bp</text>";
    });
    if (haveOas) {
      OAS_IDS.forEach(function (id) {
        var s = macro[id];
        if (!s || !s.history) return;
        var d = "";
        s.history.forEach(function (p, i) { d += (i ? "L" : "M") + X(p.d).toFixed(1) + " " + Yl(p.v).toFixed(1) + " "; });
        out += "<path d='" + d.trim() + "' fill='none' stroke='" + OAS_COLOR[id] + "' stroke-width='1.4'><title>" + OAS_LABEL[id] + " OAS, latest " + (s.latest ? s.latest.v.toFixed(2) : "?") + "%</title></path>";
      });
    }
    tranches.forEach(function (t) {
      var x = X(t.date), y = Yr(t.spreadBps);
      var sizeKnown = isNum(t.amountBn);
      var r = sizeKnown ? clamp(Math.sqrt(t.amountBn) * 4, 2.5, 10) : 3;
      var attrs = !sizeKnown ? "fill='none' stroke='#8b8f98' stroke-width='1' stroke-dasharray='1.5 1.5'"
        : (t.long ? "fill='none' stroke='#e8eaed' stroke-width='1.6'" : "fill='#e8eaed' fill-opacity='.8'");
      var sizeNote = sizeKnown ? "" : " — tranche size not printed, marker is not sized by amount";
      out += "<a href='" + esc(t.url) + "' target='_blank' rel='noopener'><circle cx='" + x.toFixed(1) + "' cy='" + y.toFixed(1) + "' r='" + r.toFixed(1) + "' " + attrs + "><title>" + esc(t.name) + " " + esc(fmtDate(t.date)) + ": T+" + t.spreadBps + "bp" + (t.long ? " (30-year and longer)" : "") + sizeNote + "</title></circle></a>";
    });
    out += "</svg>";
    return out;
  }

  /* ================================================================
     H17 — the rating timeline (blueprint 15.7)
     ================================================================ */
  /* A combined ordinal rank across Moody's and S&P/Fitch notches, for
     visual y-position only — never a claim that a Moody's and an S&P
     notch at the same rank are equivalent. Longer, more specific tokens
     are tried first so e.g. "Aa1" is not read as the bare "A" alternative. */
  var RATING_RANK_ORDER = [
    "AAA", "Aaa", "AA+", "Aa1", "AA", "Aa2", "AA-", "Aa3",
    "A+", "A1", "A", "A2", "A-", "A3",
    "BBB+", "Baa1", "BBB", "Baa2", "BBB-", "Baa3",
    "BB+", "Ba1", "BB", "Ba2", "BB-", "Ba3",
    "B+", "B1", "B", "B2", "B-", "B3",
    "CCC+", "Caa1", "CCC", "Caa2", "CCC-", "Caa3", "CC", "Ca", "C", "D"
  ];
  /* A trailing \b fails right after a token ending in "+" or "-" when the
     next character is itself non-word ("BBB-/A-3 stable" — no
     word/non-word transition between "-" and "/"), which silently
     dropped every "+"/"-" notch immediately followed by a slash or
     comma. The trailing assertion here is "not immediately followed by
     a letter or digit" instead, which is what actually distinguishes a
     rating token from a longer one it is a prefix of (BBB vs BBB+). */
  var RATING_TOKEN_RX = new RegExp("\\b(" + RATING_RANK_ORDER.slice().sort(function (a, b) { return b.length - a.length; }).join("|").replace(/\+/g, "\\+") + ")(?![A-Za-z0-9])", "g");
  function ratingRankOf(token) {
    var i = RATING_RANK_ORDER.indexOf(token);
    return i < 0 ? null : RATING_RANK_ORDER.length - i;
  }
  /* The issuer's OWN rating token out of a rating-action row's `terms`,
     never a specific new tranche's issue rating. This ledger's own
     convention prints an issue/instrument rating immediately followed by
     a recovery annotation ("B (RR5, 15%)", "B1", "rated B, recovery 5
     (25%)"), while the issuer's own credit rating is bare ("B+ positive
     unchanged", "B+ issuer credit rating"). The first token NOT followed
     by such an annotation is picked; if every token in the string carries
     one (never observed in this ledger, but never assumed impossible),
     the very first token is used rather than returning nothing, so a row
     this heuristic cannot fully parse still lands somewhere rather than
     vanishing from the timeline. */
  function issuerRatingMatch(terms) {
    var t = String(terms || "");
    var rx = new RegExp(RATING_TOKEN_RX.source, "g");
    var m, fallback = null;
    while ((m = rx.exec(t))) {
      if (!fallback) fallback = m;
      var after = t.slice(m.index + m[0].length, m.index + m[0].length + 14);
      var issueAnnotated = /^\s*(\(RR|,\s*recovery)/i.test(after);
      if (!issueAnnotated) return m;
    }
    return fallback;
  }
  /* A rating action on a named subsidiary facility (an SPV's DDTL, a
     project note) rather than the issuer's own corporate family / issuer
     credit rating is never read onto the issuer's own timeline — the
     ledger keeps this as a rating action row regardless (never dropped
     from the ledger itself), only excluded from h17Data's per-issuer
     history. */
  function isIssuerLevelRatingTerms(terms) {
    var t = String(terms || "");
    if (/\bDDTL\b/.test(t) && !/\bissuer credit rating\b|\bCFR\b|\bIDR\b/i.test(t)) return false;
    return true;
  }
  /* The OAS band (an id in OAS_IDS) a rating token prices against —
     AAA/Aaa on the AAA line, the AA/A/BBB notch families on their own
     lines, everything below investment grade on the high-yield line —
     never a hardcoded band for every issuer (H16's own must-not-build
     rule: a spread and an OAS are only ever compared within the same
     rating family). */
  function oasBandForToken(token) {
    if (/^(AAA|Aaa)$/.test(token)) return "BAMLC0A1CAAA";
    if (/^(AA\+|Aa1|AA|Aa2|AA-|Aa3)$/.test(token)) return "BAMLC0A2CAA";
    if (/^(A\+|A1|A|A2|A-|A3)$/.test(token)) return "BAMLC0A3CA";
    if (/^(BBB\+|Baa1|BBB|Baa2|BBB-|Baa3)$/.test(token)) return "BAMLC0A4CBBB";
    return "BAMLH0A0HYM2";
  }
  function h17Data(creditRows) {
    var byIssuer = {};
    creditRows.filter(function (r) { return r.status === "rating action" && isIssuerLevelRatingTerms(r.terms); }).forEach(function (r) {
      var m = issuerRatingMatch(r.terms || "");
      if (!m) return;
      var rank = ratingRankOf(m[1]);
      if (rank === null) return;
      var cls = classifyEntity(r.entity);
      var key = cls.name || r.entity;
      (byIssuer[key] = byIssuer[key] || []).push({
        date: r.date, agency: r.counterparties, token: m[1], rank: rank,
        hollow: r.sourceType === "press", url: r.url, terms: r.terms
      });
    });
    Object.keys(byIssuer).forEach(function (k) { byIssuer[k].sort(byDate); });
    return byIssuer;
  }
  /* Issuers carrying at least one same-agency rank drop, per issuer's
     own chronological rating history. Compares each action against that
     SAME agency's own most recent prior reading, not merely the
     immediately preceding array entry regardless of agency — two of an
     issuer's own agencies often act on the same date (Oracle's S&P and
     Fitch both acted on 2026-02-02), and comparing only adjacent entries
     would let an interleaved other-agency action mask the very same-
     agency downgrade (Oracle's own S&P BBB to BBB- on 2026-07-09) this
     function exists to find. */
  function downgradedIssuers(byIssuer) {
    return Object.keys(byIssuer).filter(function (k) {
      var lastRankByAgency = {};
      var pts = byIssuer[k];
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i], prior = lastRankByAgency[p.agency];
        if (isNum(prior) && p.rank < prior) return true;
        lastRankByAgency[p.agency] = p.rank;
      }
      return false;
    });
  }
  function svgH17Issuer(name, points) {
    var W = 300, H = 90, padL = 6, padR = 6, padT = 10, padB = 10;
    var iw = W - padL - padR, ih = H - padT - padB;
    var ranks = points.map(function (p) { return p.rank; });
    var lo = Math.min.apply(null, ranks) - 1, hi = Math.max.apply(null, ranks) + 1;
    var Y = function (r) { return padT + ih - ((r - lo) / (hi - lo || 1)) * ih; };
    var x0 = new Date(points[0].date).getTime(), x1 = new Date(last(points).date).getTime();
    var span = Math.max(1, x1 - x0);
    var X = function (d) { return padL + ((new Date(d).getTime() - x0) / span) * iw; };
    var byAgency = {};
    points.forEach(function (p) { (byAgency[p.agency] = byAgency[p.agency] || []).push(p); });
    var agencyColor = { "Moody's": "#f5c518", "S&P Global Ratings": "#5ecb8f", "Fitch Ratings": "#ff8a80" };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='" + esc(name) + " rating timeline'>";
    Object.keys(byAgency).forEach(function (agency) {
      var pts = byAgency[agency];
      var color = agencyColor[agency] || LINE2;
      var d = "";
      pts.forEach(function (p, i) { d += (i ? "L" : "M") + X(p.date).toFixed(1) + " " + Y(p.rank).toFixed(1) + " "; });
      out += "<path d='" + d.trim() + "' fill='none' stroke='" + color + "' stroke-width='1.2' stroke-dasharray='2 2'/>";
      pts.forEach(function (p) {
        out += "<a href='" + esc(p.url) + "' target='_blank' rel='noopener'><circle cx='" + X(p.date).toFixed(1) + "' cy='" + Y(p.rank).toFixed(1) + "' r='4' " +
          (p.hollow ? "fill='none' stroke='" + color + "' stroke-width='1.6'" : "fill='" + color + "'") +
          "><title>" + esc(agency) + " " + esc(fmtDate(p.date)) + ": " + esc(p.token) + (p.hollow ? " (press-sourced)" : "") + "</title></circle></a>";
      });
    });
    out += "<text x='" + padL + "' y='" + (H - 2) + "' font-size='9' font-weight='600' fill='#e8eaed'>" + esc(name) + "</text>";
    out += "</svg>";
    return out;
  }

  /* ================================================================
     H18 — build-out financing by channel, per half-year (blueprint
     15.8), overlaid with the two ties to the private-credit views
     ================================================================ */
  /* BIS's own source prints a floor ("over $200 billion today"), not a
     level; FSB's own figure is printed as a plain share. Carried here so
     neither commentary label reads as more precise than its source. */
  var COMMENTARY_QUALIFIER = { "BIS": "over " };
  function h18Data(dealsRows, fx) {
    var financing = dealsRows.filter(isFinancingRow);
    var byHalf = {};
    var skipped = [];
    financing.forEach(function (r) {
      var usdBn = amountUsdBn(r, fx);
      if (usdBn === null) { skipped.push(r); return; }
      var h = halfYearOf(r.date);
      var accentKey = (r.structure === "private credit facility" || r.structure === "JV/SPV" || r.structure === "lease-backed") ? "Private credit + JV/SPV" : "Other structures";
      byHalf[h] = byHalf[h] || { "Private credit + JV/SPV": 0, "Other structures": 0 };
      byHalf[h][accentKey] += usdBn;
    });
    var halves = Object.keys(byHalf).sort();
    return { halves: halves, byHalf: byHalf, skipped: skipped };
  }
  function svgH18(data, commentary, beignetDate) {
    var W = 620, H = 220, padL = 44, padR = 10, padT = 10, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    var n = data.halves.length || 1;
    var maxTotal = 1;
    data.halves.forEach(function (h) { var t = data.byHalf[h]["Private credit + JV/SPV"] + data.byHalf[h]["Other structures"]; if (t > maxTotal) maxTotal = t; });
    maxTotal *= 1.1;
    var bw = (iw / n) * 0.6, gap = (iw / n) * 0.4;
    var Y = function (v) { return padT + ih - (v / maxTotal) * ih; };
    var out = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='xMidYMid meet' role='img' aria-label='Build-out financing by channel, per half-year'>";
    [0.5, 1].forEach(function (f) {
      var y = Y(maxTotal * f);
      out += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + y.toFixed(1) + "' y2='" + y.toFixed(1) + "' stroke='" + GRID + "' stroke-width='1'/>" +
        "<text x='" + (padL - 5) + "' y='" + (y + 3).toFixed(1) + "' text-anchor='end' font-size='9' fill='" + INK + "'>$" + (maxTotal * f).toFixed(0) + "B</text>";
    });
    data.halves.forEach(function (h, i) {
      var x = padL + gap / 2 + i * (bw + gap);
      var y0 = padT + ih;
      var accent = data.byHalf[h]["Private credit + JV/SPV"], other = data.byHalf[h]["Other structures"];
      var hOther = (other / maxTotal) * ih;
      out += "<rect x='" + x.toFixed(1) + "' y='" + (y0 - hOther).toFixed(1) + "' width='" + bw.toFixed(1) + "' height='" + hOther.toFixed(1) + "' fill='" + INK + "' fill-opacity='.5'><title>" + esc(h) + " other structures: " + fmtBn(other) + "</title></rect>";
      var hAccent = (accent / maxTotal) * ih;
      out += "<rect x='" + x.toFixed(1) + "' y='" + (y0 - hOther - hAccent).toFixed(1) + "' width='" + bw.toFixed(1) + "' height='" + hAccent.toFixed(1) + "' fill='#f5c518'><title>" + esc(h) + " private credit + JV/SPV: " + fmtBn(accent) + "</title></rect>";
      out += "<text x='" + (x + bw / 2).toFixed(1) + "' y='" + (H - 12) + "' text-anchor='middle' font-size='8' fill='" + INK + "'>" + esc(h) + "</text>";
      if (beignetDate && halfYearOf(beignetDate) === h) {
        out += "<line x1='" + (x + bw + gap / 2).toFixed(1) + "' x2='" + (x + bw + gap / 2).toFixed(1) + "' y1='" + padT + "' y2='" + (padT + ih) + "' stroke='#ff8a80' stroke-width='1' stroke-dasharray='3 2'><title>Beignet Investor LLC SPV bond, " + esc(fmtDate(beignetDate)) + " — commentary status, excluded from every total above; see the private-credit-share tiles for its caveat marker</title></line>";
      }
    });
    /* BIS and FSB commentary rows, own units, own axis strip below the
       $ chart — never averaged with the site's own share. BIS's own
       source states a floor ("over $200 billion today"), not a level —
       COMMENTARY_QUALIFIER carries that word so the label never reads as
       more precise than the source it quotes. */
    var y = H - 6;
    commentary.forEach(function (c, i) {
      out += "<text x='" + (padL + i * 200) + "' y='" + y + "' font-size='8' fill='#c99cf2'>● " + esc(c.entity) + " " + esc(COMMENTARY_QUALIFIER[c.entity] || "") + esc(c.amount) + " " + esc(c.unit) + "<title>" + esc(c.terms.slice(0, 200)) + "</title></text>";
    });
    out += "</svg>";
    return out;
  }

  /* ---------- caption templates ---------- */
  var CAPTIONS = {
    h9: {
      template: function (v) { return v.company + " " + v.year + " guidance called for " + v.mid + "; the outturn came in at " + v.outturn + " (" + v.pct + ")."; },
      sample: function () { return CAPTIONS.h9.template({ company: "Applied Digital", year: "FY2026", mid: "$999.9B", outturn: "$999.9B", pct: "+99.9%" }); }
    },
    h10: {
      template: function (v) { return v.n + " of the four calendar-year hyperscalers gave a numeric 2026 capex range; the widest, " + v.company + "'s, runs " + v.lo + " to " + v.hi + "."; },
      sample: function () { return CAPTIONS.h10.template({ n: 4, company: "Alphabet", lo: "$999B", hi: "$999B" }); }
    },
    h11: {
      template: function (v) { return v.n + " deal-ledger rows since " + v.since + " total " + v.total + " signed or closed; every bubble opens its own source."; },
      sample: function () { return CAPTIONS.h11.template({ n: 84, since: "Jan 2024", total: "$999.9B" }); }
    },
    h12: {
      template: function (v) { return "Signed and closed financing reached " + v.total + " cumulative by " + v.asOf + "; " + v.topKey + " is the largest channel at " + v.topValue + "."; },
      sample: function () { return CAPTIONS.h12.template({ total: "$999.9B", asOf: "Aug 2026", topKey: "private credit facility", topValue: "$999.9B" }); }
    },
    h13: {
      template: function (v) { return v.company + "'s 30-year coupon moved from " + v.from + " to " + v.to + " between " + v.fromDate + " and " + v.toDate + "."; },
      sample: function () { return CAPTIONS.h13.template({ company: "Oracle", from: "9.999%", to: "9.999%", fromDate: "Sep 2024", toDate: "Sep 2026" }); }
    },
    h14: {
      template: function (v) { return v.company + "'s backlog covers its gross debt " + v.mult + "; net debt to EBITDA reads " + v.lev + "."; },
      sample: function () { return CAPTIONS.h14.template({ company: "Applied Digital", mult: "99.9×", lev: "n/m" }); }
    },
    h15: {
      /* Round-2 fix: this used to sum printed contract/lease values
         across different filers into one dollar total (blueprint 15.9's
         must-not-build rule: "sums across filers of purchase
         obligations, commitments or uncommenced leases") and counted
         two backstop-only rows as "contracts" though they carry no
         printed contract value at all. States the single largest
         printed contract instead, and counts only rows that carry one. */
      template: function (v) {
        var s = v.n + " link" + (v.n === 1 ? "" : "s") + " with a printed contract value; " + v.largest + " is the largest, as printed. " + v.backstopped + " backstopped by Google.";
        if (v.backstopOnly) s += " " + v.backstopOnly + " more is Google backstop exposure, not a contract value.";
        return s;
      },
      sample: function () { return CAPTIONS.h15.template({ n: 2, largest: "Hut 8's Fluidstack lease at $7.0B", backstopped: "3 of 4", backstopOnly: "$4.6B" }); }
    },
    h16: {
      /* Round-2 fix: /api/credit-macro serves the OAS ids at monthly
         grain (last observation of each month), so the value read for
         a tranche's own pricing date is really the nearest month-end on
         or before it — up to ~30 days earlier, not the same-day reading
         the caption used to imply. When that read is not the pricing
         date itself, the caption now names the OAS's own observation
         date instead of pretending it lines up with the tranche. */
      template: function (v) {
        var oasClause = v.oasExact
          ? "the " + v.band + " index OAS read " + v.oas + "%"
          : "the " + v.band + " index OAS read " + v.oas + "% at the " + v.oasDate + " close (monthly feed, not the pricing date)";
        return v.company + " priced " + v.tenor + "-year paper at T+" + v.spread + "bp on " + v.date + ", while " + oasClause + ".";
      },
      sample: function () { return CAPTIONS.h16.template({ company: "Oracle", tenor: 30, spread: 195, date: "Feb 2026", band: "BBB", oas: "0.93", oasExact: false, oasDate: "Jan 31, 2026" }); }
    },
    h17: {
      /* Round-2 fix: h17Data excludes an instrument-level rating (an
         SPV's or a facility's DDTL, not the issuer's own corporate
         family / issuer credit rating) from this per-issuer timeline —
         a defensible exclusion, but the caption used to state the
         included count as if it were the ledger's whole rating-action
         total, silently dropping the excluded rows (CoreWeave's Moody's
         A3 on a DDTL among them) with no note anywhere on the page. The
         caption now names both counts when they differ. */
      template: function (v) {
        var lead = (v.total && v.total !== v.n ? v.n + " of the ledger's " + v.total + " rating actions" : v.n + " rating actions") +
          " across " + v.issuers + " issuers since " + v.since + "; ";
        if (v.downgraded.length === 0) return lead + "none carries a same-agency downgrade in the window.";
        if (v.downgraded.length === 1) return lead + v.downgraded[0] + " is the only one carrying a same-agency downgrade in the window.";
        return lead + v.downgraded.length + " (" + v.downgraded.join(", ") + ") carry a same-agency downgrade in the window.";
      },
      sample: function () { return CAPTIONS.h17.template({ n: 23, total: 24, issuers: 9, since: "Mar 2025", downgraded: ["Applied Digital", "Cipher Mining", "TeraWulf"] }); }
    },
    h18: {
      /* Round-2 fix: decision 12.17 makes the with-Beignet figure the
         default/headline, carrying the caveat marker, with the
         excluding-Beignet figure stated second — the shipped caption
         had this backwards (excluding first, as if it were the
         headline). */
      template: function (v) { return "Private credit and JV/SPV financing were " + v.pct + " of build-out financing in " + v.half + "; the private-credit share of the whole ledger reads " + v.shareBeignet + " with the Beignet SPV bond (" + v.share + " without it)."; },
      sample: function () { return CAPTIONS.h18.template({ pct: "99.9%", half: "2026-H2", share: "9.9%", shareBeignet: "99.9%" }); }
    }
  };

  /* ---------- RTCatalog.register at module load ---------- */
  var ENTRIES = [
    { key: "boLedgersSection", label: "The deal ledger, ratings and the ties to private credit", subtitle: "15.4-15.8: H9-H18",
      formula: "The corrected deal, capex-guidance and credit ledgers (frontend/data/ledgers/), read row by row; a financing total never includes an announcement, a contract row, a backstop, a rating action or commentary",
      watch: "A rating action is a row, never a number in a total; a new-issue spread to Treasuries and an index OAS are two different measures, drawn on separate axes here and never subtracted.",
      definition: "Who is funding the hyperscaler and neocloud build-out, on what terms, how guidance compared with outturn, what lenders charge, and how that ties back to the site's own private-credit share.",
      interpretation: "Read each panel against its own population: the ledger is not exhaustive, and a chart here states its own row count and total rather than implying completeness." },
    { key: "boH9", label: "H9 — Guidance vs outturn", subtitle: "stepped bands, dotted run rates, direction arrows",
      formula: "Each capex-ledger guidance row's amount, classified exactly as printed (a pure range is a band, a “... per quarter” figure a dotted level, everything else a direction); the outturn is the company metric annual total where the ledger names one, else the sum of four tagged quarters",
      watch: "The error is computed only where the latest guide for a year is a numeric range on the outturn's own basis — a run rate, a direction, or a range qualified by other prose never produces a number.",
      definition: "What each company said it would spend, against what it actually spent, on its own terms.",
      interpretation: "A solid column taller than its guided band beat guidance; the outlined tagged-line marker shows how much of the gap between a company's own metric and the raw XBRL line is a bridge, not a surprise." },
    { key: "boH10", label: "H10 — 2026 hyperscaler ranges vs 2025 outturn", subtitle: "floating bars, press aggregates as dots",
      formula: "The latest 2026 guidance row for each of the four calendar-year hyperscalers, drawn as a floating bar only when it is a numeric range; press aggregate rows as dated dots with their own component list on hover",
      watch: "Oracle is not one of the four bars: its fiscal year is not the calendar year, and its own guides never print a numeric range (blueprint 15.4).",
      definition: "How far above 2025's actual spend the four hyperscalers have guided for 2026, and what the press aggregates that add them up say.",
      interpretation: "A press aggregate dot that sits outside the sum of the four bars is double-counting, rounding, or including a fifth company — read its own component list before comparing it to the bars." },
    { key: "boH11", label: "H11 — The deal timeline", subtitle: "bubble area = amount, color = structure, ring = cohort",
      formula: "Every corrected deal-ledger row, one bubble each; area from the row's own clean-unit amount where it parses to a plain USD figure, color from its structure tag, a gold ring for a hyperscaler borrower and a teal ring for a neocloud borrower, hollow for an announcement or a contract row",
      watch: "A hollow bubble is not financing — it is an announcement or a contract row, excluded from every total in H12 and H18.",
      definition: "Every transaction in the corrected ledger, sized, colored and dated in one view.",
      interpretation: "Every bubble opens its own source in a new tab; a cluster of hollow bubbles around one entity is press coverage getting ahead of a signed deal, not the deal itself." },
    { key: "boH12", label: "H12 — Running totals by structure and lender type", subtitle: "monthly cumulative, stacked",
      formula: "Signed or closed rows only, summed by month and made cumulative, grouped by structure or by a coarse lender-type bucket derived from structure; a row whose amount does not parse to a plain single- or same-currency figure is left out of the total, never guessed",
      watch: "The lender-type grouping is a disclosed simplification of blueprint 15.5's fuller field (see this file's own contract note); a syndicated bank loan is never moved into private credit on press reporting alone. A compound row (debt plus equity, senior plus convertible) is split across the structures its own amount field names, and \"equity\" itself splits into strategic-or-customer equity (a named investor such as NVIDIA) versus underwritten public or private equity issuance.",
      definition: "How much signed or closed financing has accumulated over time, and through which structures and lender types.",
      interpretation: "A channel's share of the total rising while the total itself flattens is substitution, not growth in the total build-out financing." },
    { key: "boH13", label: "H13 — Price of capital by borrower class", subtitle: "bond coupons by tenor; delayed-draw margins over SOFR",
      formula: "Fixed coupons and tenors parsed from each credit-ledger new-issue bond row's own printed tranche list, 30-year tranches (exactly, not 30-and-longer) connected per issuer; delayed-draw margins over SOFR parsed from each deal-ledger private-credit-facility row's own printed terms",
      watch: "The floating margins are margins over SOFR, not an all-in level — the 90-day average SOFR needed to compute one is only available at monthly grain from this site's own macro feed (an open item, not built here); they are never plotted on the same scale as a fixed coupon.",
      definition: "What hyperscalers and neoclouds pay for capital, and how that has moved as the build-out has grown.",
      interpretation: "A 30-year hyperscaler coupon that rises while the AA or BBB index OAS (H16) barely moves is issuer-specific widening, not a market-wide repricing." },
    { key: "boH14", label: "H14 — Neocloud leverage panel", subtitle: "six cards: debt, backlog, four tiles",
      formula: "Gross debt, backlog (RevenueRemainingPerformanceObligation or a lessor's backlog), net debt to EBITDA, backlog to debt, cash interest to operating cash flow and next-two-year maturities to cash, all read from the same tagged capex-panel fields credit-buildout.js's H6-H7 already resolve; the non-recourse split and the SPV/offtaker sentence are hand-keyed from the filing quotes blueprint 15.6 already verified, exactly as H8 hand-keys uncommenced leases",
      watch: "The site never computes DSCR or adjusted EBITDA itself — net debt to EBITDA reads “n/m” on zero or negative trailing operating income, and a card with no hand-keyed non-recourse split says so rather than assuming 100% recourse.",
      definition: "How levered each neocloud is, what backs that leverage, and whether its backlog covers it.",
      interpretation: "Backlog to debt is collateral, not coverage — it is only as good as the counterparty behind the contract, which is why the quoted SPV and offtaker sentence sits beside the ratio, not below it." },
    { key: "boH15", label: "H15 — Developer, tenant and backstop", subtitle: "Sankey, link width = contract value as printed",
      formula: "Deal-ledger “contract” rows whose entity names a developer, a tenant and (where one exists) a Google backstop, link width from the row's own printed contract value",
      watch: "This draws only the contract rows the corrected ledger carries as a standalone, dollar-valued row — several developer-tenant pairs blueprint 15.6 names in prose (Polaris Forge 2/Oracle, IREN's tenancy) are not drawn because no such row exists in the ledger; see this file's own contract note.",
      definition: "Who built the capacity, who leases it, and who stands behind the tenant if it does not pay.",
      interpretation: "A thick link with no backstop column is the developer's own credit risk on the tenant; the same link routed through Google is the tenant's risk transferred, in part, to the backstop." },
    { key: "boH16", label: "H16 — New-issue spreads against the OAS lines", subtitle: "two axes: spread to Treasuries (right), index OAS (left)",
      formula: "Every rating-band ICE BofA OAS line (AAA, AA, single-A, BBB, HY) on the left axis; every credit-ledger new-issue bond tranche's spread to Treasuries, sized by its own printed amount where one prints, on the right axis; a 30-year-and-longer tranche is outlined",
      watch: "The two axes are never combined into one number — a new-issue spread to Treasuries and an index option-adjusted spread are different measures of different things (blueprint's own must-not-build rule).",
      definition: "Where new hyperscaler and neocloud paper prices relative to the broad market's own risk pricing at the same moment.",
      interpretation: "A tranche's spread widening while the matching-rating OAS line holds flat is issuer-specific, not the market; the reverse is the market moving under everyone, including this ledger's issuers." },
    { key: "boH17", label: "H17 — The rating timeline", subtitle: "dot-and-step, one small multiple per issuer",
      formula: "Every credit-ledger rating-action row, plotted by date on a combined ordinal rank across Moody's and S&P/Fitch notches (for visual position only); a press-sourced row (the agency's own page was not fetchable) is hollow",
      watch: "The combined rank axis orders notches for display only — it is not a claim that a given Moody's notch and a given S&P notch are the same credit quality.",
      definition: "Every rating action this ledger carries, per issuer, over time.",
      interpretation: "A step down against a flat or rising OAS backdrop (H16) is issuer-specific credit deterioration, not the market pricing every borrower worse." },
    { key: "boH18", label: "H18 — Build-out financing by channel, per half-year", subtitle: "private credit and JV/SPV in the accent",
      formula: "Signed or closed rows, summed by half-year, split into a private-credit-and-JV/SPV accent and everything else; the BIS and FSB commentary rows as dated markers with their own units; the private-credit share of the whole ledger, with and without the Beignet SPV bond, read from the derived series the feeds stage of this PR wrote",
      watch: "BIS's “over $200 billion” and FSB's percentage are drawn with their own definitions and are never averaged into the site's own private-credit share; the Beignet SPV bond stays out of every bar above (it is a commentary row) and appears only as a dated caveat marker. Per decision 12.17 the private-credit-share tile with Beignet folded in is the default/headline figure, carrying that caveat; the tile without it is stated second, not the other way round.",
      definition: "How the mix of financing channels behind the build-out has shifted half-year by half-year, and how the site's own private-credit share compares with the two outside estimates.",
      interpretation: "A rising accent share is the private-credit and JV/SPV channels doing more of the financing; read it beside the two both-ways private-credit-share tiles, not as the same number." }
  ];
  if (CAT && typeof CAT.register === "function") CAT.register(ENTRIES);

  /* ---------- small rendering helpers ---------- */
  function h3Sub(key, label, small) {
    return "<h3><span class='h-pop' data-metric='" + esc(key) + "' tabindex='0'>" + esc(label) + "</span>" + (small ? "<small>" + esc(small) + "</small>" : "") + "</h3>";
  }
  function emptyState(title, why) {
    return "<div class='m6-empty'><span>" + esc(title) + "</span>" + (why ? "<small>" + esc(why) + "</small>" : "") + "</div>";
  }
  function panel(body) { return "<figure class='m6-panel'>" + body + "</figure>"; }

  /* ---------- section builders (pure) ---------- */
  function buildH9Section(capexRows) {
    var captions = [];
    var grid = H9_TICKERS.map(function (t) {
      var data = h9EntityData(t, capexRows);
      var svg = svgH9(t, data);
      var cap = "";
      var withRange = data.errors.filter(function (e) { return e.error !== null; }).sort(function (a, b) { return b.year - a.year; })[0];
      if (withRange) {
        cap = CAPTIONS.h9.template({ company: nameOfTicker(t), year: "FY" + withRange.year, mid: fmtBn(withRange.guideMid / 1000), outturn: fmtBn(withRange.outturn / 1000), pct: fmtPct(withRange.pct) });
      }
      if (!svg) return panel(h3Sub("boH9", nameOfTicker(t)) + emptyState("No guidance rows for " + nameOfTicker(t) + " yet", ""));
      if (cap) captions.push(cap);
      return panel(h3Sub("boH9", nameOfTicker(t)) + "<div class='m6-chart'>" + svg + "</div>" + (cap ? "<figcaption class='m6-caption'>" + esc(cap) + "</figcaption>" : "<p class='bo-footnote'>No numeric range guide on the outturn's own basis this period — direction only.</p>"));
    }).join("");
    var body = h3Sub("boH9", "Guidance vs outturn", "as printed, never converted") +
      "<p class='chart-legend'><span><i style='background:rgba(245,197,24,.5)'></i>Guided range</span><span><i class='dash' style='color:" + LINE2 + "'></i>Run rate</span><span>→ Direction only</span><span><i style='background:#5ecb8f'></i>Outturn (company metric where one is named, else the tagged cash-flow line — hover a bar for which)</span></p>" +
      "<div class='m6-grid'>" + grid + "</div>" +
      "<p class='tile-foot'>Guidance quoted exactly as printed in the earnings release or transcript. Only Meta's outturn bars are the company's own named metric; every other ticker's outturn bar is the tagged cash-flow line (PaymentsToAcquirePropertyPlantAndEquipment) with no company-metric bridge available — a bar's tooltip states which basis it is. Source: the corrected capex ledger, URL per row.</p>";
    return { html: body, captions: captions };
  }

  function buildH10Section(capexRows) {
    var data = h10Data(capexRows);
    var haveRange = data.rows.filter(function (r) { return r.guide && r.guide.kind === "range"; });
    var captions = [];
    var body = h3Sub("boH10", "2026 hyperscaler ranges vs 2025 outturn");
    if (haveRange.length) {
      var widest = haveRange.slice().sort(function (a, b) { return (b.guide.hi - b.guide.lo) - (a.guide.hi - a.guide.lo); })[0];
      var cap = CAPTIONS.h10.template({ n: haveRange.length, company: widest.name, lo: fmtBn(widest.guide.lo / 1000, 0), hi: fmtBn(widest.guide.hi / 1000, 0) });
      captions.push(cap);
      body += "<p class='chart-caption'>" + esc(cap) + "</p>";
    }
    body += "<div class='bo-chart-wide'>" + svgH10(data) + "</div>";
    if (data.aggregates.length) {
      body += "<h4 class='bo-subhead'>Press aggregates (the four or five combined)</h4><div class='bo-chart-wide'>" + svgH10Aggregates(data.aggregates) + "</div>";
    }
    body += "<p class='tile-foot'>Bars only where the latest 2026 guide is a numeric range; Oracle and any qualified guide are named as direction only. Source: the corrected capex ledger.</p>";
    return { html: body, captions: captions };
  }

  function buildH11Section(dealsRows, fx, hsLedgers) {
    var rows = h11Data(dealsRows, fx);
    var financingRows = rows.filter(function (r) { return isFinancingRow(r) && isNum(r.usdBn); });
    var total = financingRows.reduce(function (a, r) { return a + r.usdBn; }, 0);
    var cap = CAPTIONS.h11.template({ n: rows.length, since: fmtDate(rows[0] ? rows[0].date : null), total: fmtBn(total) });
    var alsoNoteH11 = alsoFoldedNote(hsLedgers);
    var body = h3Sub("boH11", "The deal timeline") + "<p class='chart-caption'>" + esc(cap) + "</p>" +
      "<div class='bo-chart-wide'>" + svgH11(rows) + "</div>" +
      "<p class='chart-legend'>" + H11_LANES.map(function (s) { return "<span><i style='background:" + structureColor(s) + "'></i>" + esc(s) + "</span>"; }).join("") + "</p>" +
      "<p class='tile-foot'>A gold ring is a hyperscaler borrower, a teal ring a neocloud borrower; a hollow bubble is an announcement or a contract row, never counted in a financing total. Every bubble links to its own source; a foreign-currency bubble's tooltip states the FX rate and its own observation date." + (alsoNoteH11 ? " " + esc(alsoNoteH11) : "") + "</p>";
    return { html: body, captions: [cap] };
  }

  /* Round-2 fix: reads the "Known gap: N ... $Xbn ..." sentence the
     feeds stage (scripts/build-ledger-series.mjs) already writes into
     hs-ledgers.json's own population strings — the 15 signed-financing
     "|| ALSO" sub-transactions folded into other rows and never summed
     here — so H12 and H18 can name the same gap next to their own
     totals, in the same place the FX-skip footnote already sits,
     without this file re-parsing the ledger's terms field itself. */
  function alsoFoldedNote(hsLedgers) {
    var pop = hsLedgers && hsLedgers.keys && hsLedgers.keys.derived_hs_private_credit_share_of_ledger
      && hsLedgers.keys.derived_hs_private_credit_share_of_ledger.population;
    if (!pop) return "";
    /* Lazy match up to a period FOLLOWED BY WHITESPACE, not a bare
       "[^.]+\." — the sentence itself contains a decimal ("$58.1bn"),
       and a naive "stop at the first period" regex truncates mid-number
       ("...worth $58." with the rest silently dropped). */
    var m = /Known gap:[\s\S]*?\.(?=\s|$)/.exec(String(pop));
    return m ? m[0] : "";
  }
  function buildH12Section(dealsRows, mode, fx, hsLedgers) {
    var data = h12Data(dealsRows, mode, fx);
    var svg = svgH12(data);
    var captions = [];
    var body = h3Sub("boH12", "Running totals by structure and by lender type", mode === "lenderType" ? "by lender type" : "by structure") +
      "<div class='chart-controls'><div class='seg bo-seg' role='group' data-seg='bo-h12-mode'><button type='button' data-val='structure' aria-pressed='" + (mode !== "lenderType" ? "true" : "false") + "'>By structure</button><button type='button' data-val='lenderType' aria-pressed='" + (mode === "lenderType" ? "true" : "false") + "'>By lender type</button></div></div>";
    if (!svg) {
      body += emptyState("Not enough signed or closed rows with a clean USD amount yet", "");
    } else {
      var top = data.keys[0];
      var cap = CAPTIONS.h12.template({ total: fmtBn(data.totalUsdBn), asOf: fmtDate(data.latestDate || (data.months[data.months.length - 1] + "-01")), topKey: top, topValue: fmtBn(last(data.cumulative[top])) });
      captions.push(cap);
      body += "<p class='chart-caption'>" + esc(cap) + "</p><div class='bo-chart-wide'>" + svg + "</div>";
      if (data.skipped.length) {
        var skippedBn = data.skipped.reduce(function (a, r) { return a + (parseLeadingNumber(r.amount) || 0); }, 0);
        body += "<p class='bo-footnote'>" + data.skipped.length + " signed or closed row" + (data.skipped.length === 1 ? "" : "s") + " (as printed, roughly $" + skippedBn.toFixed(1) + "B) carr" + (data.skipped.length === 1 ? "ies" : "y") + " a foreign-currency tranche whose FX rate did not resolve from the live feed, and " + (data.skipped.length === 1 ? "is" : "are") + " left out of this total rather than guessed.</p>";
      }
    }
    var alsoNote = alsoFoldedNote(hsLedgers);
    body += "<p class='tile-foot'>Cumulative by month, signed or closed rows only; an announcement, a contract row, a backstop, a rating action or commentary never enters this total. A foreign-currency tranche converts at the nearest FX observation on or before its own pricing date from this site's own macro feed (monthly grain) — a close approximation of the daily-rate figure in the site's own private-credit-share series, not a bit-for-bit match." + (alsoNote ? " " + esc(alsoNote) : "") + "</p>";
    return { html: body, captions: captions };
  }

  function buildH13Section(dealsRows, creditRows, fx) {
    var bonds = h13BondTranches(creditRows);
    var floats = h13FloatingMargins(dealsRows, fx);
    var svg = svgH13(bonds, floats);
    var captions = [];
    var body = h3Sub("boH13", "Price of capital by borrower class");
    if (!svg) { body += emptyState("Not enough parsed tranches yet", ""); }
    else {
      var byTicker = {};
      bonds.forEach(function (t) { if (t.tenor === 30) (byTicker[t.name] = byTicker[t.name] || []).push(t); });
      var multi = Object.keys(byTicker).filter(function (k) { return byTicker[k].length >= 2; });
      if (multi.length) {
        var k = multi[0], pts = byTicker[k].slice().sort(byDate);
        var f = pts[0], l = last(pts);
        var cap = CAPTIONS.h13.template({ company: k, from: f.coupon.toFixed(3) + "%", to: l.coupon.toFixed(3) + "%", fromDate: fmtDate(f.date), toDate: fmtDate(l.date) });
        captions.push(cap);
        body += "<p class='chart-caption'>" + esc(cap) + "</p>";
      }
      body += "<div class='bo-chart-wide'>" + svg + "</div>";
    }
    body += "<p class='tile-foot'>Coupons and their tenor are parsed from each new-issue bond row's own printed tranche list; delayed-draw margins from each private-credit-facility row's own printed terms. Diamonds are margins over SOFR, not an all-in level, and are read separately from the coupon scale above them.</p>";
    return { html: body, captions: captions };
  }

  function buildH14Section(neocloudsPanel) {
    var companies = (neocloudsPanel && neocloudsPanel.companies) || {};
    var captions = [];
    var cards = H14_TICKERS.map(function (t) {
      var card = h14CardData(t, companies[t]);
      if (card.missing) return panel(h3Sub("boH14", NEOCLOUD_NAMES[t]) + emptyState("No capex-panel data for " + NEOCLOUD_NAMES[t] + " yet", ""));
      /* all four tiles as a multiple ("×"), matching blueprint 15.6's own
         phrasing ("Applied Digital 2.9× in FY2026") — cash interest and
         near-term maturities can each exceed operating cash flow or cash
         on hand, so a bounded percentage reads oddly past 100%. */
      var tiles = h14Tile("Net debt / EBITDA", fmtX(card.netDebtToEbitda)) +
        h14Tile("Backlog / debt", isNum(card.backlogToDebt) ? card.backlogToDebt.toFixed(2) + "×" : "—") +
        h14Tile("Cash interest / OCF", fmtX(card.cashInterestToOcf)) +
        h14Tile("Next-2yr maturities / cash", isNum(card.maturitiesToCash) ? card.maturitiesToCash.toFixed(2) + "×" : "—");
      var cap = "";
      if (isNum(card.backlogToDebt)) { cap = CAPTIONS.h14.template({ company: card.name, mult: card.backlogToDebt.toFixed(2) + "×", lev: fmtX(card.netDebtToEbitda) }); captions.push(cap); }
      /* Round-2 fix: only a genuinely verbatim filing sentence
         (quoteVerbatim === true) is wrapped in quotation marks; the
         site's own paraphrase is printed as plain prose so it is never
         mistaken for filing text (blueprint 15.6: "recourse is quoted,
         never interpreted"). The citation links to the row's own URL
         where one exists, instead of naming the internal blueprint. */
      var citeHtml = card.source ? "<cite> — " + (card.quoteUrl ? "<a href='" + esc(card.quoteUrl) + "' target='_blank' rel='noopener'>" + esc(card.source) + "</a>" : esc(card.source)) + "</cite>" : "";
      var quoteBlock = card.quote
        ? (card.quoteVerbatim
          ? "<p class='bo-quote'>“" + esc(card.quote.replace(/^“|”$/g, "")) + "”" + citeHtml + "</p>"
          : "<p class='bo-quote bo-quote-summary'>" + esc(card.quote) + citeHtml + "</p>")
        : "<p class='bo-footnote'>No SPV/offtaker sentence quoted for " + esc(card.name) + " in this pass.</p>";
      var staleNote = isNum(card.grossDebtStale)
        ? "<p class='bo-footnote'>Gross debt last tagged " + fmtDate(card.debtPeriodEnd) + " (" + fmtBn(card.grossDebtStale / 1e9) + "), more than 14 months before " + card.name + "'s most recent reported period (" + fmtDate(card.periodEnd) + ") — not shown as current, and net debt to EBITDA and backlog to debt (which need it) read — below; recent quarters carry no gross-debt tag.</p>"
        : "";
      return panel(h3Sub("boH14", card.name, fmtDate(card.periodEnd)) + "<div class='m6-chart'>" + svgH14Debt(card) + "</div>" + staleNote +
        (isNum(card.backlog) ? "<p class='bo-footnote'>Backlog (contracted future revenue): " + fmtBn(card.backlog / 1e9) + "</p>" : "") +
        "<div class='bo-tiles'>" + tiles + "</div>" + (cap ? "<figcaption class='m6-caption'>" + esc(cap) + "</figcaption>" : "") + quoteBlock);
    }).join("");
    var body = h3Sub("boH14", "Neocloud leverage panel") + "<div class='m6-grid'>" + cards + "</div>" +
      "<p class='tile-foot'>Debt, backlog and the four tiles are the same tagged fields credit-buildout.js's H6-H7 read; the non-recourse split and the SPV/offtaker sentence are hand-keyed with a filing citation, exactly as H8 hand-keys uncommenced leases.</p>";
    return { html: body, captions: captions };
  }

  function buildH15Section(dealsRows) {
    var edges = h15Data(dealsRows);
    var captions = [];
    var body = h3Sub("boH15", "Developer, tenant and backstop");
    if (!edges.length) { body += emptyState("No contract-value rows resolved yet", ""); }
    else {
      /* only a genuine contract/lease-value row enters "printed contract
         value" — a row whose own unit says "backstop" is Google's
         exposure, a different measure, and is called out on its own
         rather than folded into the same total (blueprint 15.9's
         must-not-build rule: a backstop never enters a financing or
         contract-value total). */
      var contractEdges = edges.filter(function (e) { return !e.isBackstopValue; });
      var backstopOnlyEdges = edges.filter(function (e) { return e.isBackstopValue; });
      var backstopOnlyTotal = backstopOnlyEdges.reduce(function (a, e) { return a + (e.valueBn || 0); }, 0);
      var backstopped = edges.filter(function (e) { return e.backstop; }).length;
      var largestEdge = contractEdges.slice().sort(function (a, b) { return (b.valueBn || 0) - (a.valueBn || 0); })[0];
      var largestText = largestEdge ? largestEdge.developer + "'s " + largestEdge.tenant + " link at " + fmtBn(largestEdge.valueBn) : "none";
      var cap = CAPTIONS.h15.template({ n: contractEdges.length, largest: largestText, backstopped: backstopped + " of " + edges.length, backstopOnly: backstopOnlyEdges.length ? fmtBn(backstopOnlyTotal) : "" });
      captions.push(cap);
      body += "<p class='chart-caption'>" + esc(cap) + "</p><div class='bo-chart-wide'>" + svgH15(edges) + "</div>";
    }
    body += "<p class='tile-foot'>Drawn only from deal-ledger “contract” rows that name a developer, a tenant and a printed contract value — not every developer-tenant pair the blueprint's own prose names has a standalone row in the corrected ledger; see this file's own contract note for what is left out.</p>";
    return { html: body, captions: captions };
  }

  function buildH16Section(creditRows, macro) {
    var tranches = h16Tranches(creditRows);
    var ratingsByIssuer = h17Data(creditRows);
    var captions = [];
    var body = h3Sub("boH16", "New-issue spreads against the OAS lines");
    var svg = svgH16(macro, tranches);
    if (!svg) { body += emptyState("Not enough data to draw yet", macro ? "" : "The credit-macro feed did not answer."); }
    else {
      var longOnes = tranches.filter(function (t) { return t.long; }).sort(function (a, b) { return b.date < a.date ? -1 : 1; });
      if (longOnes.length && macro) {
        var t = longOnes[0];
        /* the OAS band is the tranche's OWN issuer's own rating on or
           before the pricing date — never a hardcoded band for every
           issuer. The OAS value itself comes from /api/credit-macro's
           monthly-downsampled history, so the nearest point on or
           before the pricing date can be up to ~30 days earlier than
           the tranche; the caption below names that point's own
           observation date rather than presenting it as a same-day
           read (Round-2 fix — this used to claim "the same moment"). */
        var issuerHistory = (ratingsByIssuer[t.name] || []).filter(function (p) { return p.date <= t.date; });
        var latestRating = last(issuerHistory);
        var oasId = latestRating ? oasBandForToken(latestRating.token) : "BAMLC0A4CBBB";
        var oasSeries = macro[oasId];
        var oasPoint = oasSeries && oasSeries.history ? pointOnOrBefore(oasSeries.history, t.date) : null;
        var oasVal = oasPoint ? oasPoint.value : (oasSeries && oasSeries.latest ? oasSeries.latest.v : null);
        var oasDate = oasPoint ? oasPoint.date : (oasSeries && oasSeries.latest ? oasSeries.latest.d : null);
        var cap = CAPTIONS.h16.template({ company: t.name, tenor: t.maturityYear - Number(t.date.slice(0, 4)), spread: t.spreadBps, date: fmtDate(t.date), band: OAS_LABEL[oasId] || oasId, oas: isNum(oasVal) ? oasVal.toFixed(2) : "—", oasExact: oasDate === t.date, oasDate: fmtDate(oasDate) });
        captions.push(cap);
        body += "<p class='chart-caption'>" + esc(cap) + "</p>";
      }
      body += "<div class='bo-chart-wide'>" + svg + "</div>" +
        "<p class='chart-legend'>" + OAS_IDS.map(function (id) { return "<span><i style='background:" + OAS_COLOR[id] + "'></i>" + OAS_LABEL[id] + " OAS</span>"; }).join("") + "<span><i style='background:#e8eaed'></i>New-issue spread (right axis)</span></p>";
    }
    body += "<p class='tile-foot'>Left axis: ICE BofA option-adjusted spreads, percent, from FRED, served at monthly grain — the featured caption's OAS reading is the nearest month-end on or before the tranche's pricing date, named by its own date, not assumed to be the same day. Right axis: new-issue spread to Treasuries at pricing, basis points, from the credit ledger's own printed tranche list. Never subtracted or drawn on one scale.</p>";
    return { html: body, captions: captions };
  }

  function buildH17Section(creditRows) {
    var byIssuer = h17Data(creditRows);
    var issuers = Object.keys(byIssuer);
    var ledgerTotal = creditRows.filter(function (r) { return r.status === "rating action"; }).length;
    var captions = [];
    var body = h3Sub("boH17", "The rating timeline");
    if (!issuers.length) { body += emptyState("No parsed rating actions yet", ""); }
    else {
      var totalActions = issuers.reduce(function (a, k) { return a + byIssuer[k].length; }, 0);
      var since = issuers.reduce(function (min, k) { var d = byIssuer[k][0].date; return !min || d < min ? d : min; }, null);
      var downgraded = downgradedIssuers(byIssuer);
      var cap = CAPTIONS.h17.template({ n: totalActions, total: ledgerTotal, issuers: issuers.length, since: fmtDate(since), downgraded: downgraded });
      captions.push(cap);
      body += "<p class='chart-caption'>" + esc(cap) + "</p>";
      body += "<div class='m6-grid'>" + issuers.map(function (k) { return panel(svgH17Issuer(k, byIssuer[k])); }).join("") + "</div>";
    }
    body += "<p class='tile-foot'>A hollow dot is a press-sourced rating action (the agency's own page returned a login wall or a 403 to a non-browser fetch); the rank axis orders notches for display only, across agencies, never as an equivalence claim. An instrument-level rating on an SPV or a facility (a DDTL, not the issuer's own corporate family / issuer credit rating) is excluded from every issuer's timeline above; it stays a rating action in the ledger itself.</p>";
    return { html: body, captions: captions };
  }

  function buildH18Section(dealsRows, creditRows, hsLedgers, fx) {
    var data = h18Data(dealsRows, fx);
    var commentary = creditRows.filter(function (r) { return r.status === "commentary" && (r.entity === "BIS" || r.entity === "Financial Stability Board"); });
    var beignetRow = dealsRows.find(function (r) { return /Beignet Investor/.test(r.entity); });
    var svg = data.halves.length ? svgH18(data, commentary, beignetRow ? beignetRow.date : null) : "";
    var captions = [];
    var body = h3Sub("boH18", "Build-out financing by channel, per half-year");
    if (!svg) { body += emptyState("Not enough signed or closed rows yet", ""); }
    else {
      var lastHalf = last(data.halves);
      var row = data.byHalf[lastHalf];
      var pct = fmtPct((row["Private credit + JV/SPV"] / (row["Private credit + JV/SPV"] + row["Other structures"])) * 100, 0).replace("+", "");
      var shareKey = "derived_hs_private_credit_share_of_ledger";
      var shareSeries = hsLedgers && hsLedgers.keys && hsLedgers.keys[shareKey];
      var pts = (shareSeries && shareSeries.points) || [];
      var excl = pts.filter(function (p) { return /excluding/.test(p.c); })[0];
      var incl = pts.filter(function (p) { return /including/.test(p.c); })[0];
      var cap = CAPTIONS.h18.template({ pct: pct, half: lastHalf, share: excl ? (excl.v * 100).toFixed(1) + "%" : "—", shareBeignet: incl ? (incl.v * 100).toFixed(1) + "%" : "—" });
      captions.push(cap);
      body += "<p class='chart-caption'>" + esc(cap) + "</p><div class='bo-chart-wide'>" + svg + "</div>";
      /* the half-year "pct" above and the whole-ledger "share" tiles below
         are drawn from two different denominators (this page's own
         half-year sum vs. the FX-converted whole-ledger total in
         hs-ledgers.json) — the gap between the two is disclosed rather
         than left for a reader to discover by subtracting the two
         percentages themselves */
      body += "<p class='bo-footnote'>The half-year share above and the whole-ledger share tiles below use different populations (one half-year of this page's own totals against the whole corrected ledger) and are not the same denominator — read them side by side, not as one number two ways.</p>";
      var alsoNoteH18 = alsoFoldedNote(hsLedgers);
      if (alsoNoteH18) body += "<p class='bo-footnote'>" + esc(alsoNoteH18) + "</p>";
      if (data.skipped.length) {
        var skippedBn = data.skipped.reduce(function (a, r2) { return a + (parseLeadingNumber(r2.amount) || 0); }, 0);
        body += "<p class='bo-footnote'>" + data.skipped.length + " signed or closed row" + (data.skipped.length === 1 ? "" : "s") + " (as printed, roughly $" + skippedBn.toFixed(1) + "B) carr" + (data.skipped.length === 1 ? "ies" : "y") + " a foreign-currency tranche whose FX rate did not resolve from the live feed, and " + (data.skipped.length === 1 ? "is" : "are") + " left out of the bars above rather than guessed.</p>";
      }
      if (pts.length) {
        /* Round-2 fix: decision 12.17 makes the with-Beignet figure the
           default, carrying the caveat marker, stated first; the
           excluding-Beignet figure is stated second. */
        var inclCaveat = incl && incl.caveat ? esc(incl.caveat) : "";
        body += "<div class='bo-tiles'><div class='bo-tile'" + (inclCaveat ? " title=\"" + inclCaveat + "\"" : "") + "><span class='bo-tile-label'>Private-credit share, incl. Beignet</span><span class='bo-tile-value'>" + (incl ? (incl.v * 100).toFixed(1) + "%" : "—") + "</span></div>" +
          h14Tile("Private-credit share, excl. Beignet", excl ? (excl.v * 100).toFixed(1) + "%" : "—") + "</div>";
        if (inclCaveat) body += "<p class='bo-footnote'>" + inclCaveat + "</p>";
      } else {
        body += "<p class='bo-footnote'>The private-credit-share tiles need frontend/data/pc/series/hs-ledgers.json, which did not answer.</p>";
      }
    }
    if (commentary.length) {
      body += "<p class='chart-legend'>" + commentary.map(function (c) { return "<span>" + esc(c.entity) + ": " + esc(COMMENTARY_QUALIFIER[c.entity] || "") + esc(c.amount) + " " + esc(c.unit) + "</span>"; }).join("") + "</p>";
    }
    body += "<p class='tile-foot'>Signed or closed rows only, by half-year; BIS and FSB figures are their own dated points with their own units, never averaged with the site's own share. The Beignet SPV bond stays out of every bar (commentary status) and shows only as a dated marker.</p>";
    return { html: body, captions: captions };
  }

  /* ---------- top-level page build (pure) ---------- */
  function sectionHead(id, title, blurb, howTo, metricKey) {
    var heading = metricKey ? "<span class='h-pop' data-metric='" + esc(metricKey) + "' tabindex='0'>" + esc(title) + "</span>" : esc(title);
    return "<div class='section-head'><h2 id='" + esc(id) + "'>" + heading + "</h2><p class='section-blurb'>" + esc(blurb) + "</p>" +
      "<details class='how-to-read'><summary>How to read this</summary><p>" + howTo + "</p></details></div>";
  }
  function buildHtml(data, state) {
    if (!data) return "<p class='chart-empty'><span>Loading the deal ledger and ratings panels…</span></p>";
    var mode = (state && state.h12Mode) || "structure";
    var fx = fxByCurrencyFrom(data.macro);
    var h9 = buildH9Section(data.capex.rows), h10 = buildH10Section(data.capex.rows);
    var h11 = buildH11Section(data.deals.rows, fx, data.hsLedgers), h12 = buildH12Section(data.deals.rows, mode, fx, data.hsLedgers), h13 = buildH13Section(data.deals.rows, data.credit.rows, fx);
    var h14 = buildH14Section(data.neoclouds);
    var h15 = buildH15Section(data.deals.rows);
    var h16 = buildH16Section(data.credit.rows, data.macro && data.macro.series);
    var h17 = buildH17Section(data.credit.rows);
    var h18 = buildH18Section(data.deals.rows, data.credit.rows, data.hsLedgers, fx);
    var out = "";
    out += "<section class='panel-card fsa-section' aria-labelledby='bol-h-guidance' id='bol-guidance'>" +
      sectionHead("bol-h-guidance", "Guidance against outturn",
        "What each company said it would spend, against what the cash-flow statement shows it actually spent.",
        "Guidance is quoted exactly as printed — a range, a run rate or a direction — and never converted by the site. The error line only ever appears where the guide is a numeric range on the outturn's own basis.") +
      h9.html + h10.html + "</section>";
    out += "<section class='panel-card fsa-section' aria-labelledby='bol-h-ledger' id='bol-ledger'>" +
      sectionHead("bol-h-ledger", "The deal ledger",
        "Who is funding the build-out, on what terms, and what it costs.",
        "Every bubble, area and line here is drawn from the corrected deal ledger's own rows; a financing total (the running totals, the by-channel chart) never includes an announcement, a contract row, a backstop, a rating action or commentary — those still appear, hollow, in the timeline.") +
      h11.html + h12.html + h13.html + "</section>";
    out += "<section class='panel-card fsa-section' aria-labelledby='bol-h-neocloud' id='bol-neocloud'>" +
      sectionHead("bol-h-neocloud", "Neocloud leverage panel",
        "How levered each neocloud is, what backs the leverage, and who is on the hook if a tenant does not pay.",
        "The site never computes DSCR or adjusted EBITDA — every ratio here is the filer's own tagged line or the agency's own printed figure. The Sankey after it draws only the developer-tenant-backstop contracts the ledger carries as a standalone, dollar-valued row.") +
      h14.html + h15.html + "</section>";
    out += "<section class='panel-card fsa-section' aria-labelledby='bol-h-ratings' id='bol-ratings'>" +
      sectionHead("bol-h-ratings", "Ratings and the spread context",
        "What the rating agencies said, and how new-issue pricing compares with the broad market's own risk pricing.",
        "A new-issue spread to Treasuries and an index option-adjusted spread are different measures; they are drawn on two axes here and never subtracted. A rating action is always a row on the timeline, never a number folded into a total.") +
      h16.html + h17.html + "</section>";
    out += "<section class='panel-card fsa-section' aria-labelledby='bol-h-ties' id='bol-ties'>" +
      sectionHead("bol-h-ties", "Ties to the private-credit views",
        "How the build-out's own financing channels compare with the site's private-credit share, and with two outside estimates.",
        "BIS and FSB figures are drawn with their own definitions and are never averaged with the site's own private-credit share; the Beignet SPV bond is excluded from every total and appears only as a dated caveat marker, per decision 12.17.") +
      h18.html + "</section>";
    return out;
  }

  /* ---------- fetching ----------
     Every call below goes through window.fetch/window.location rather
     than the bare global — the only way scripts/test-buildout-
     ledgers.mjs's window stub can substitute a fixture fetch without
     this file ever making a real network call under test (the pattern
     credit-buildout.js's own fetchPanels uses via an explicit fetchImpl
     parameter; this file's several fetch call sites use window.fetch
     directly instead, to the same effect). */
  function fetchJson(url) {
    return window.fetch(url).then(function (r) { if (!r || (typeof r.ok === "boolean" && !r.ok)) throw new Error(url + ": " + (r && r.status)); return r.json(); });
  }
  /* /api/credit-macro: on the deployed site it is served beside the
     page; on localhost without this repo's own dev server running it
     reads the deployed site instead, the same fallback credit.js itself
     uses (see that file's own API_BASE_READY) — kept as this file's own
     small copy since credit.js does not expose its API_BASE. A failure
     here is not fatal: H16 renders its OAS lines as empty and still
     draws the tranche markers. */
  function fetchCreditMacro() {
    var PROD = "https://www.chineduokeke.mba";
    function tryBase(base) { return fetchJson(base + "/api/credit-macro"); }
    if (!/^(localhost|127\.)/.test(window.location.hostname)) return tryBase("").catch(function () { return null; });
    return window.fetch("rt-dev.js", { method: "HEAD" }).then(function (r) { return tryBase(r && r.ok ? "" : PROD); }, function () { return tryBase(PROD); }).catch(function () { return null; });
  }
  function fetchAll() {
    return Promise.all([
      fetchJson("data/ledgers/deals.json"),
      fetchJson("data/ledgers/capex.json"),
      fetchJson("data/ledgers/credit.json"),
      fetchJson("data/pc/series/hs-ledgers.json").catch(function () { return null; }),
      fetchCreditMacro(),
      (window.RTBuildout && window.RTBuildout._internal ? window.RTBuildout._internal.fetchPanels(undefined, undefined, ["neoclouds"]) : Promise.resolve({ neoclouds: null })).catch(function () { return { neoclouds: null }; })
    ]).then(function (r) {
      return { deals: r[0], capex: r[1], credit: r[2], hsLedgers: r[3], macro: r[4], neoclouds: r[5].neoclouds };
    });
  }

  /* ---------- DOM mount ---------- */
  var STATE = { data: null, error: null, pending: null, h12Mode: "structure" };
  function mount() {
    var host = document.getElementById("buildout-ledgers-root");
    if (!host) return;
    if (STATE.error) {
      host.innerHTML = "<section class='panel-card fsa-section'><div class='chart-empty'><span>The deal ledger panels could not load (" + esc(STATE.error.message || String(STATE.error)) + ").</span><button type='button' class='refresh-btn' id='bol-retry'>Try again</button></div></section>";
      var retry = document.getElementById("bol-retry");
      if (retry) retry.addEventListener("click", function () { STATE.error = null; render(); });
      return;
    }
    if (!STATE.data) { host.innerHTML = "<section class='panel-card fsa-section'><p class='hint' role='status'>Loading the deal ledger and ratings panels…</p></section>"; return; }
    host.innerHTML = buildHtml(STATE.data, STATE);
    bindEvents(host);
    if (window.RTTerms && typeof window.RTTerms.wrap === "function") {
      try { window.RTTerms.wrap(host, { perSection: "section" }); } catch (e) { /* never take the page down */ }
    }
  }
  function bindEvents(host) {
    var seg = host.querySelector("[data-seg='bo-h12-mode']");
    if (seg) {
      seg.querySelectorAll("button").forEach(function (b) {
        b.addEventListener("click", function () { STATE.h12Mode = b.getAttribute("data-val"); mount(); });
      });
    }
  }
  function render() {
    if (STATE.data || STATE.error) { mount(); return; }
    if (STATE.pending) return;
    mount();
    STATE.pending = fetchAll().then(function (data) { STATE.data = data; })
      .catch(function (e) { STATE.error = e; })
      .then(function () { STATE.pending = null; mount(); });
  }

  window.RTBuildoutLedgers = {
    render: render,
    CAPTIONS: CAPTIONS,
    _internal: {
      isFinancingRow: isFinancingRow, amountUsdBn: amountUsdBn, parseLeadingNumber: parseLeadingNumber,
      classifyEntity: classifyEntity, classifyGuidance: classifyGuidance, coveredYear: coveredYear,
      annualOutturnByYear: annualOutturnByYear, annualOutturnValue: annualOutturnValue, h9EntityData: h9EntityData,
      h10Data: h10Data, h11Data: h11Data, h12Data: h12Data, h13BondTranches: h13BondTranches, h13FloatingMargins: h13FloatingMargins,
      h14CardData: h14CardData, h15Data: h15Data, h16Tranches: h16Tranches, h17Data: h17Data, downgradedIssuers: downgradedIssuers, ratingRankOf: ratingRankOf,
      h18Data: h18Data, buildHtml: buildHtml, fetchAll: fetchAll, LENDER_TYPE_OF_STRUCTURE: LENDER_TYPE_OF_STRUCTURE,
      structureSegmentsOf: structureSegmentsOf, lenderTypeOf: lenderTypeOf, equityLenderType: equityLenderType,
      H9_TICKERS: H9_TICKERS, H10_TICKERS: H10_TICKERS, H11_LANES: H11_LANES, H14_TICKERS: H14_TICKERS,
      NEOCLOUD_LEVERAGE_NOTES: NEOCLOUD_LEVERAGE_NOTES, SANKEY_SOURCE_ROWS: SANKEY_SOURCE_ROWS,
      fxByCurrencyFrom: fxByCurrencyFrom, FX_SERIES_OF: FX_SERIES_OF, fxDetailsOf: fxDetailsOf, pointOnOrBefore: pointOnOrBefore
    }
  };
})();
