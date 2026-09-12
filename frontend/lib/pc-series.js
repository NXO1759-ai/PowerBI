/* pc-series.js — the reader for the ingested PitchBook and LCD series.
 *
 * The ingest (scripts/ingest-pc.mjs) writes four files this reader
 * knows the shape of; nothing here is typed from a report, every number
 * on the page comes out of one of them.
 *
 *   data/pc/series-index.json
 *     { generated: "2026-09-11",
 *       sources: { <sourceId>: { label, publisher, cadence, edition, asOf,
 *                  publishedAt, downloaded, file, sha256, lagDays,
 *                  observedLags, vintages: [...], document?, documentSha256?,
 *                  nextExpected?, nextExpectedLabel? } },
 *       groups:  { <group>: { file: "series/<group>.json", keys: [..] } },
 *       series:  { <key>: { label, unit, cadence, geography, source, group,
 *                  file, n, first, firstGrain, last, lastGrain, asOf,
 *                  edition, vintage, alias?, table? } } }
 *     sourceIds: lcd-monitor, pb-fundraising-report, pb-annual-reports,
 *     pb-fund-overview, press; a derived series carries source "derived".
 *     groups: lcd-dealflow, lcd-pricing, lcd-bdc, pb-capital, pb-fund,
 *     reports, press.
 *
 *   data/pc/series/<group>.json
 *     { generated, group, keys: { <key>: { label, unit, cadence, geography,
 *       population, source, group, edition, asOf, publishedAt, vintage,
 *       formula?, inputs?, alias?, table?, stale?, publisher?,
 *       points: [ { p, g, v, vintage, start?, c?, label?, edition?, url?,
 *                   q?, forecast?, doc?, page?, estimate?, approx?,
 *                   provisional?, partial? } ] } } }
 *     p is the period end "YYYY-MM-DD" (null on a press point whose
 *     period names no calendar date; then g is "label" and label says
 *     which); g the grain: quarter, half, year, ytd, month, asof,
 *     rolling3m, rolling6m, rolling12m, window, label; start the window
 *     start on ytd, rolling and window points; c the bucket or sector on
 *     a snapshot point (several points share one p); v the value in the
 *     key's unit: "$B", "$M", count, pct (percent points as printed),
 *     share (a fraction; multiply by 100 to print), bps, years, x,
 *     months, "% a year", table. A key with alias is a duplicate deck
 *     series stored once under the named key and carries no points; a
 *     key with table is a list sheet whose rows live under data/pc/<table>.
 *     Rolling, window and year-to-date points are never summed with
 *     quarters or years.
 *
 *   data/pc/restatements.json
 *     { generated, note, count, restatements: [ { key, date, label?, grain,
 *       category?, values: [ { vintage, edition, value, page?, doc? } ] } ] }
 *     values are in vintage order; the last is the one the series carries.
 *
 *   data/pc/series-provenance.json
 *     { generated, note, keys: { <key>: { fingerprintId?, locator: { slide,
 *       chart, heading, series, sheetRef } | { sheet, title, column } |
 *       { file } | ..., notes?, formula?, inputs?, crossChecks? } } }
 *
 * The reader is a UMD like http.js: window.RTPcSeries in the browser,
 * module.exports in Node, where scripts/test-pc-page.mjs points `reader`
 * at the filesystem. Paths are same-origin and relative, like the page's
 * other data files, and go through RTHttp.json when it is loaded so a
 * platform error page never reaches the reader as a parser error.
 *
 * Formatters: this file owns the shared set (RTPcSeries.fmt) that the
 * section files use and that credit.js hands to them as ctx.fmt.
 * credit.js keeps its own small FRED-specific set (percent points to
 * bps, the tile kinds) because its caption test runs the file in Node
 * with no loader present; the two are not the same functions and are
 * not meant to be.
 *
 * Shared by the three section files (so a series id reads the same in
 * every footer): populationN(key) is the "over 100 BDC portfolios"
 * clause read off a population field; entryFor(key, prov?) builds the
 * popup entry for a series id from the loader's metadata; registerIds
 * (catalog, keys, provByKey?) registers those once and refreshes them in
 * place when provenance arrives after the first draw.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RTPcSeries = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BASE = "data/pc/";
  var GRAIN_ORDER = { year: 0, half: 1, quarter: 2, month: 3, asof: 4, ytd: 5, rolling3m: 6, rolling6m: 7, rolling12m: 8, window: 9, label: 10 };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function withCommas(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function monthOf(d) { return Number(String(d).slice(5, 7)); }
  function yearOf(d) { return String(d).slice(0, 4); }

  /* ---------- formatters ---------- */
  var fmt = {
    isNum: isNum,
    withCommas: withCommas,
    /* "2026-09-10" → "Sep 10, 2026"; "2026-09" → "Sep 2026" */
    date: function (d) {
      if (!d) return "—";
      var s = String(d), m = MONTHS[monthOf(s) - 1] || "";
      return s.length >= 10 ? m + " " + Number(s.slice(8, 10)) + ", " + yearOf(s) : m + " " + yearOf(s);
    },
    /* the stamp form, no comma: "2026-08-31" → "Aug 31 2026" */
    dateStamp: function (d) {
      if (!d) return "—";
      var s = String(d);
      return (MONTHS[monthOf(s) - 1] || "") + " " + Number(s.slice(8, 10)) + " " + yearOf(s);
    },
    monthLabel: function (d) { return d ? (MONTHS[monthOf(d) - 1] || "") + " " + yearOf(d) : "—"; },
    monthLong: function (d) { return d ? (MONTHS_LONG[monthOf(d) - 1] || "") + " " + yearOf(d) : "—"; },
    /* "2026-06-30" → "Q2 2026" */
    quarter: function (d) { return d ? "Q" + Math.ceil(monthOf(d) / 3) + " " + yearOf(d) : "—"; },
    /* "2026-06-30" → "2Q26", the deck's own label */
    quarterDeck: function (d) { return d ? Math.ceil(monthOf(d) / 3) + "Q" + yearOf(d).slice(2) : "—"; },
    half: function (d) { return d ? "H" + (monthOf(d) <= 6 ? 1 : 2) + " " + yearOf(d) : "—"; },
    /* an edition id → its printed form: "2026Q2" → "Q2 2026"; "2026-08" → "August 2026" */
    edition: function (e) {
      var s = String(e || "");
      var q = s.match(/^(\d{4})Q([1-4])$/);
      if (q) return "Q" + q[2] + " " + q[1];
      if (/^\d{4}-\d{2}$/.test(s)) return fmt.monthLong(s);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmt.date(s);
      return s;
    },
    /* a point's period the way the page prints it, by grain */
    period: function (pt) {
      if (!pt) return "—";
      var p = pt.p, g = pt.g, s = pt.start;
      if (g === "label") return pt.label || "—";
      if (!p) return pt.label || "—";
      if (g === "year") return yearOf(p);
      if (g === "half") return fmt.half(p);
      if (g === "quarter") return fmt.quarter(p);
      if (g === "month") return fmt.monthLabel(p);
      if (g === "asof") return "as of " + fmt.date(p);
      if (g === "ytd") return yearOf(p) + " YTD to " + fmt.date(p);
      if (g === "rolling3m" || g === "rolling6m") {
        return s ? (MONTHS[monthOf(s) - 1] || "") + "–" + (MONTHS[monthOf(p) - 1] || "") + " " + yearOf(p) : "the " + (g === "rolling3m" ? "three" : "six") + " months to " + fmt.date(p);
      }
      if (g === "rolling12m") return "TTM to " + fmt.date(p);
      if (g === "window") return s ? yearOf(s) + "–" + yearOf(p) : "to " + yearOf(p);
      return fmt.date(p);
    },
    /* percent points as printed: 8.3 → "8.3%" */
    pct: function (v, dp) { return isNum(v) ? v.toFixed(dp === undefined ? 1 : dp) + "%" : "—"; },
    /* a share held as a fraction: 0.364 → "36.4%" */
    share: function (v, dp) { return isNum(v) ? (v * 100).toFixed(dp === undefined ? 1 : dp) + "%" : "—"; },
    /* a value already in basis points: 502.2 → "502 bps" */
    bps: function (v, dp) { return isNum(v) ? withCommas(v.toFixed(dp === undefined ? 0 : dp)) + " bps" : "—"; },
    /* percent points to basis points: 5.02 → "502 bps" */
    pctToBps: function (v) { return isNum(v) ? withCommas(Math.round(v * 100)) + " bps" : "—"; },
    /* billions: 275.2 → "$275.2B"; −103.7 → "−$103.7B" */
    B: function (v, dp) {
      if (!isNum(v)) return "—";
      var d = dp === undefined ? 1 : dp;
      return (v < 0 ? "−" : "") + "$" + withCommas(Math.abs(v).toFixed(d)) + "B";
    },
    /* millions: 891 → "$891M" */
    M: function (v, dp) {
      if (!isNum(v)) return "—";
      var d = dp === undefined ? 0 : dp;
      return (v < 0 ? "−" : "") + "$" + withCommas(Math.abs(v).toFixed(d)) + "M";
    },
    count: function (v) { return isNum(v) ? withCommas(Math.round(v)) : "—"; },
    x: function (v, dp) { return isNum(v) ? v.toFixed(dp === undefined ? 1 : dp) + "×" : "—"; },
    years: function (v, dp) { return isNum(v) ? v.toFixed(dp === undefined ? 2 : dp) : "—"; },
    /* a signed change: +14.0%, −27.4%, +27 bps */
    signed: function (v, dp, unit) {
      if (!isNum(v)) return "—";
      return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(dp === undefined ? 1 : dp) + (unit || "");
    },
    /* a ratio to a percent change: 0.14 → "+14.0%" */
    change: function (ratio, dp) { return isNum(ratio) ? fmt.signed(ratio * 100, dp === undefined ? 1 : dp, "%") : "—"; },
    ordinal: function (n) {
      n = Math.round(n);
      var s = ["th", "st", "nd", "rd"], v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    },
    /* a value in the key's own unit, for a fact line or a tooltip */
    byUnit: function (v, unit, dp) {
      if (!isNum(v)) return "—";
      if (unit === "$B" || unit === "USD billions") return fmt.B(v, dp);
      if (unit === "$M") return fmt.M(v, dp);
      if (unit === "share") return fmt.share(v, dp);
      if (unit === "bps") return fmt.bps(v, dp);
      if (unit === "count" || unit === "loans" || unit === "count of BDCs") return fmt.count(v);
      if (unit === "years") return fmt.years(v, dp) + " years";
      if (unit === "months") return fmt.years(v, dp === undefined ? 1 : dp) + " months";
      if (unit === "x") return fmt.x(v, dp);
      if (unit === "rank") return fmt.ordinal(v);
      if (typeof unit === "string" && /^%|pct/.test(unit)) return fmt.pct(v, dp) + (unit === "% a year" ? " a year" : "");
      return String(v);
    }
  };

  /* ---------- the reader ---------- */
  var state = { index: null, indexPending: null, groups: {}, groupPending: {}, keys: {}, extras: {} };

  /* Fetch and parse one JSON file under data/pc/. The page replaces
     nothing here; scripts/test-pc-page.mjs replaces `reader` with a
     filesystem read of the same relative path. */
  function reader(path) {
    if (typeof fetch !== "function") return Promise.reject(new Error("no fetch in this runtime; set RTPcSeries.reader"));
    return fetch(path).then(function (r) {
      var H = (typeof window !== "undefined" && window.RTHttp) || (typeof self !== "undefined" && self.RTHttp) || null;
      if (H && typeof H.json === "function") return H.json(r, "the private credit series");
      if (!r.ok) throw new Error("HTTP " + r.status + " reading " + path);
      return r.json();
    });
  }
  var api = {};
  api.reader = reader;
  function read(path) { return api.reader(BASE + path); }

  function loadIndex() {
    if (state.index) return Promise.resolve(state.index);
    if (!state.indexPending) {
      state.indexPending = read("series-index.json").then(function (idx) {
        if (!idx || !idx.groups || !idx.series) throw new Error("series-index.json carries no groups or series");
        state.index = idx;
        state.indexPending = null;
        return idx;
      }, function (e) { state.indexPending = null; throw e; });
    }
    return state.indexPending;
  }
  function loadGroup(name) {
    if (state.groups[name]) return Promise.resolve(state.groups[name]);
    if (state.groupPending[name]) return state.groupPending[name];
    state.groupPending[name] = loadIndex().then(function (idx) {
      var g = idx.groups[name];
      if (!g) throw new Error("no series group named " + name + " in this edition (groups: " + Object.keys(idx.groups).join(", ") + ")");
      return read(g.file);
    }).then(function (file) {
      if (!file || !file.keys) throw new Error("series/" + name + ".json carries no keys");
      Object.keys(file.keys).forEach(function (k) {
        var e = file.keys[k];
        e.key = k;
        if (!e.group) e.group = name;
        state.keys[k] = e;
      });
      state.groups[name] = file;
      delete state.groupPending[name];
      return file;
    }, function (e) { delete state.groupPending[name]; throw e; });
    return state.groupPending[name];
  }

  /* load(groups) → Promise<void>: the index once, then every named
     group file once; a second call with the same names costs nothing. */
  api.load = function (groups) {
    var names = Array.isArray(groups) ? groups : groups ? [groups] : [];
    return loadIndex().then(function () {
      return Promise.all(names.map(loadGroup));
    }).then(function () { return undefined; });
  };
  api.loaded = function (group) { return !!state.groups[group]; };
  api.index = function () { return state.index; };
  api.groups = function () { return state.index ? Object.keys(state.index.groups) : []; };
  api.keysOf = function (group) { return state.index && state.index.groups[group] ? state.index.groups[group].keys.slice() : []; };
  api.sources = function () { return state.index ? state.index.sources : {}; };
  /* the Refresh button: forget everything so the next load re-reads the files */
  api.invalidate = function () {
    state.index = null; state.indexPending = null; state.groups = {}; state.groupPending = {}; state.keys = {}; state.extras = {};
  };

  /* the canonical key of a key or alias, or null when neither is known */
  function canonical(key) {
    var k = String(key || "");
    if (state.keys[k] && !state.keys[k].alias) return k;
    var meta = state.keys[k] || (state.index && state.index.series[k]);
    if (meta && meta.alias) return String(meta.alias);
    return state.keys[k] ? k : null;
  }
  api.canonical = canonical;
  api.has = function (key) { var c = canonical(key); return !!(c && state.keys[c]); };
  /* the entry, alias resolved; `alias` names the key that was asked for
     when it was not the canonical one */
  api.get = function (key) {
    var c = canonical(key);
    if (!c || !state.keys[c]) return null;
    var e = state.keys[c];
    if (c === key) return e;
    var copy = {};
    Object.keys(e).forEach(function (f) { copy[f] = e[f]; });
    copy.alias = key;
    return copy;
  };
  /* what the index says about a key whose group may not be loaded */
  api.meta = function (key) {
    var idx = state.index; if (!idx) return null;
    var m = idx.series[key]; if (!m) return null;
    if (m.alias && idx.series[m.alias]) return idx.series[m.alias];
    return m;
  };

  function grainOk(g, want) {
    if (!want) return true;
    if (Array.isArray(want)) return want.indexOf(g) >= 0;
    return g === want;
  }
  function comparePoints(a, b) {
    if (a.x < b.x) return -1;
    if (a.x > b.x) return 1;
    var ga = GRAIN_ORDER[a.g], gb = GRAIN_ORDER[b.g];
    return (ga === undefined ? 99 : ga) - (gb === undefined ? 99 : gb);
  }
  /* pointsOf(key, {grain?, from?, to?, category?, withLabels?}) →
     [{x: "YYYY-MM-DD", y, g, ...the point}] sorted by x. Points with no
     calendar date (g "label") are left out unless withLabels is set. */
  api.pointsOf = function (key, opts) {
    var e = api.get(key);
    if (!e || !Array.isArray(e.points)) return [];
    opts = opts || {};
    var out = [];
    e.points.forEach(function (pt) {
      if (!pt) return;
      if (!pt.p) { if (!opts.withLabels) return; }
      if (!grainOk(pt.g, opts.grain)) return;
      if (opts.category !== undefined && pt.c !== opts.category) return;
      if (opts.from && pt.p && pt.p < opts.from) return;
      if (opts.to && pt.p && pt.p > opts.to) return;
      var o = { x: pt.p || null, y: isNum(pt.v) ? pt.v : null };
      Object.keys(pt).forEach(function (f) { o[f] = pt[f]; });
      out.push(o);
    });
    var dated = out.filter(function (p) { return p.x; }).sort(comparePoints);
    return dated.concat(out.filter(function (p) { return !p.x; }));
  };
  /* latest(key, {grain?}) → the point with the greatest date that has a
     value, or null; a snapshot key answers with its first bucket, so use
     snapshot() for those */
  api.latest = function (key, opts) {
    var pts = api.pointsOf(key, opts).filter(function (p) { return p.x && isNum(p.y); });
    if (!pts.length) return null;
    var last = pts[pts.length - 1];
    /* the first point of the newest date, so a bucketed snapshot answers
       predictably (the caller then uses snapshot) */
    for (var i = pts.length - 1; i >= 0; i--) { if (pts[i].x === last.x && pts[i].g === last.g) last = pts[i]; else break; }
    return last;
  };
  /* the point before the latest at the same grain (the prior quarter, the prior year) */
  api.prior = function (key, opts) {
    var l = api.latest(key, opts);
    if (!l) return null;
    var pts = api.pointsOf(key, { grain: l.g }).filter(function (p) { return p.x && isNum(p.y) && p.x < l.x && p.c === l.c; });
    return pts.length ? pts[pts.length - 1] : null;
  };
  /* a bucketed snapshot: snapshot(key, {p?}) → { p, g, items: [{c, v}] }
     for the newest date (or the one named) */
  api.snapshot = function (key, opts) {
    opts = opts || {};
    var pts = api.pointsOf(key, { grain: opts.grain }).filter(function (p) { return p.x && p.c !== undefined; });
    if (!pts.length) return null;
    var p = opts.p || pts[pts.length - 1].x;
    var items = pts.filter(function (q) { return q.x === p; }).map(function (q) { return { c: q.c, v: q.y, vintage: q.vintage }; });
    return items.length ? { p: p, g: pts[pts.length - 1].g, items: items } : null;
  };
  /* the value at one date and grain, or null */
  api.at = function (key, p, grain, category) {
    var pts = api.pointsOf(key, { grain: grain });
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].x === p && (category === undefined || pts[i].c === category)) return pts[i];
    }
    return null;
  };
  api.isRolling = function (pt) { return !!pt && pt.g === "rolling3m"; };
  api.isWindow = function (pt) { return !!pt && /^(rolling|ytd|window)/.test(String(pt.g || "")); };
  api.isProvisional = function (pt) { return !!(pt && (pt.provisional || pt.partial)); };

  /* ---------- the stamps ---------- */
  function stampFor(id, s) {
    if (!s) return "";
    if (id === "lcd-monitor") {
      return "LCD monitor, " + fmt.edition(s.edition) + " edition, through " + fmt.dateStamp(s.asOf) +
        (s.nextExpectedLabel ? " · next expected " + s.nextExpectedLabel : "");
    }
    if (id === "pb-fund-overview") return "PitchBook Fund Overview export of " + fmt.dateStamp(s.asOf);
    if (id === "pb-fundraising-report") return "PitchBook " + fmt.edition(s.edition) + " fundraising report";
    if (id === "pb-annual-reports") {
      return "PitchBook annual private debt reports and Quantitative Perspectives, " + fmt.edition(s.edition) +
        " edition, as of " + fmt.dateStamp(s.asOf);
    }
    if (id === "press") return "public releases and press coverage, read " + fmt.dateStamp(s.asOf);
    return (s.label || id) + (s.asOf ? ", as of " + fmt.dateStamp(s.asOf) : "");
  }
  /* stamp(sourceId) → the footer sentence for one source, "" when the
     index does not know it */
  api.stamp = function (sourceId) {
    var srcs = api.sources();
    return stampFor(sourceId, srcs[sourceId]);
  };
  /* stampOf(key) → the stamp for a key's source; a derived key answers
     with the stamps of its inputs, joined, so a mixed-date tile prints
     both */
  api.stampOf = function (key, seen) {
    var e = api.get(key) || api.meta(key);
    if (!e) return "";
    seen = seen || {};
    if (e.source === "derived") {
      var parts = [];
      (e.inputs || []).forEach(function (k) {
        if (seen[k]) return; seen[k] = true;
        var st = api.stampOf(k, seen);
        if (st && parts.indexOf(st) < 0) parts.push(st);
      });
      return parts.join(" · ");
    }
    return api.stamp(e.source);
  };

  /* ---------- the two files read on first use ---------- */
  function extra(name) {
    if (state.extras[name]) return state.extras[name];
    state.extras[name] = read(name).then(function (d) { return d; }, function (e) { delete state.extras[name]; throw e; });
    return state.extras[name];
  }
  /* restatementsOf(key) → Promise<[{p, g, c?, label?, from, to, fromVintage,
     toVintage, fromEdition, toEdition, values}]>: one entry per date whose
     value changed between vintages; from and to are the two newest */
  api.restatementsOf = function (key) {
    var c = canonical(key) || key;
    return extra("restatements.json").then(function (d) {
      var rows = (d && d.restatements) || [];
      return rows.filter(function (r) { return r.key === c; }).map(function (r) {
        var vs = r.values || [];
        var a = vs[vs.length - 2] || null, b = vs[vs.length - 1] || null;
        return { p: r.date || null, g: r.grain, c: r.category, label: r.label,
          from: a ? a.value : null, to: b ? b.value : null,
          fromVintage: a ? a.vintage : null, toVintage: b ? b.vintage : null,
          fromEdition: a ? a.edition : null, toEdition: b ? b.edition : null, values: vs };
      });
    });
  };
  /* provenance(key) → Promise<entry | null> from series-provenance.json */
  api.provenance = function (key) {
    var c = canonical(key) || key;
    return extra("series-provenance.json").then(function (d) {
      return (d && d.keys && d.keys[c]) || null;
    });
  };
  /* a list sheet's rows: table(key) → Promise<file | null> */
  api.table = function (key) {
    var e = api.get(key) || api.meta(key);
    if (!e || !e.table) return Promise.resolve(null);
    return extra(String(e.table).replace(/^data\/pc\//, ""));
  };

  /* ---------- shared by the section files ---------- */
  /* the "over 100 BDC portfolios" clause an LCD series states in its
     population field, read off the key, never typed; the fallback names
     the population without a count */
  api.populationN = function (key) {
    var e = api.get(key) || api.meta(key);
    var m = String(e && e.population || "").match(/over\s+[\d,]+\s+BDC portfolios/i);
    return m ? m[0] : "the BDC portfolios LCD tracks";
  };
  /* a note as one sentence: the ingest stores some without a final
     period, so the clause after it never runs into it */
  function sentence(s) {
    var t = String(s || "").trim();
    return t ? t.replace(/([^.!?])$/, "$1.") : "";
  }
  api.sentence = sentence;
  /* entryFor(key, prov?) → the popup entry for a series id printed in a
     footer, built from the loader's own metadata in the catalog's shape
     (formula → caveat → definition → how to read it); prov is the
     series-provenance.json entry when the caller has it, which adds
     where on the deck or sheet the value was read. Nothing typed. */
  api.entryFor = function (key, prov) {
    var c = canonical(key) || key, e = api.get(c);
    if (!e) return null;
    var pts = api.pointsOf(c), first = pts[0], lst = pts.length ? pts[pts.length - 1] : null, l = api.latest(c);
    var src = api.sources()[e.source] || null, loc = prov && prov.locator ? prov.locator : null;
    var where = loc ? (loc.chart ? loc.chart + " on slide " + loc.slide + ", series '" + loc.series + "' of '" + String(loc.heading || "").trim() + "'"
      : loc.sheet ? "sheet '" + loc.sheet + "'" + (loc.column ? ", column '" + loc.column + "'" : "") : loc.file ? "file " + loc.file : "") : "";
    return {
      key: c, label: e.label, subtitle: c, loaderBuilt: true, located: !!where,
      formula: (e.formula ? e.formula + "; " : "") + "read as published" + (src && src.label ? " from " + src.label : "") +
        " (" + e.unit + ", " + e.cadence + (e.geography ? ", " + e.geography : "") + ")" + (where ? "; read from " + where : "") +
        (e.inputs && e.inputs.length ? "; inputs " + e.inputs.join(", ") : ""),
      watch: (e.population ? sentence(e.population) + " " : "") + (prov && prov.notes ? sentence(prov.notes) + " " : "") +
        "Edition " + fmt.edition(e.edition || (src || {}).edition) + (e.vintage ? ", vintage " + e.vintage : "") +
        "; the whole history is replaced on each ingest and superseded values go to restatements.json." +
        (l && api.isProvisional(l) ? " The newest point is provisional." : "") +
        (l && api.isWindow(l) ? " The newest point is a window (" + fmt.period(l) + ") and is never summed with the calendar periods." : ""),
      definition: "Series " + c + (e.group ? " of the " + e.group + " group" : "") + (e.edition ? ", " + fmt.edition(e.edition) + " edition" : "") + (e.asOf ? ", as of " + fmt.date(e.asOf) : "") + ".",
      interpretation: (l ? "Newest point " + fmt.byUnit(l.y, e.unit) + " (" + fmt.period(l) + "); " : "") + pts.length + " points from " + (first ? fmt.period(first) : "—") + " to " + (lst ? fmt.period(lst) : "—") +
        ". YTD, rolling and window points are never summed with quarters or years; the stamp in the footer says which edition it comes from."
    };
  };
  /* registerIds(catalog, keys, provByKey?) → the number of popups added:
     every key (alias folded, a repeat in the batch added once) the
     catalog does not know yet is registered from entryFor; a key it
     already knows from an earlier loader build is refreshed in place
     when provenance arrives later, so a section can draw first and read
     the provenance file afterwards. A key another file wrote by hand
     keeps its entry. */
  api.registerIds = function (catalog, keys, provByKey) {
    if (!catalog || typeof catalog.register !== "function" || typeof catalog.get !== "function") return 0;
    var entries = [], seen = {};
    (keys || []).forEach(function (k) {
      var c = canonical(k) || k;
      if (seen[c] || !api.has(c)) return;
      seen[c] = true;
      var prov = provByKey ? provByKey[c] || null : null;
      var have = catalog.get(c);
      if (have) {
        if (have.loaderBuilt && !have.located && prov) {
          var fresh = api.entryFor(c, prov);
          if (fresh) Object.keys(fresh).forEach(function (f) { have[f] = fresh[f]; });
        }
        return;
      }
      var e = api.entryFor(c, prov);
      if (e) entries.push(e);
    });
    if (!entries.length) return 0;
    try { return catalog.register(entries); } catch (err) { return 0; }
  };

  api.fmt = fmt;
  api.BASE = BASE;
  return api;
});
