/* credit-capital.js — the Market view's capital section: fundraising,
   AUM, dry powder and deployment (blueprint 3.4, charts C1–C7).

   Registers itself on window.RTCreditSections at file evaluation; the
   page (credit.js) loads the series groups it names through
   lib/pc-series.js and calls mount(container, ctx) once they are in,
   again on every Refresh. Nothing here is typed from a report: every
   number on the tiles, in the captions and in the note's fact lines is
   a point of an ingested series, a derived_* key the ingest wrote, or a
   ratio computed at render from two of them — and the popup's formula
   line says which. The three populations of the section (the global
   report series, the US fund-data series on the monitor's slides 35–36,
   LCD's direct-lending volume from every lender) are never divided into
   one another except where the blueprint allows it and the tile says
   "direction, not level".

   What this file touches at evaluation: window.RTCatalog.register (the
   popups), window.RTCreditSections (the registration). The DOM is
   touched only inside mount(); scripts/test-pc-page.mjs evaluates the
   file in Node with a window stub and measures every CAPTIONS sample. */
(function () {
  "use strict";
  var win = typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this);
  var CAT = win.RTCatalog || null;

  /* ---------- the keys the section draws ----------
     The two report-cut keys carry their edition in the name (the ingest
     writes one per fundraising report); resolveEdition() below prefers
     the key the blueprint names and otherwise takes the newest cut of
     the same prefix, so a re-ingest does not empty the tiles. */
  var K = {
    capital: "pb_pd_fundraising_capital_q2_2026ed",
    count: "pb_pd_fund_count_q2_2026ed",
    run200: "derived_pd_fundraising_200b_run",
    avgSize: "derived_pd_avg_fund_size",
    topFiveShare: "pb_pd_top_five_fund_share_of_capital",
    ttm: "pb_pd_fundraising_ttm",
    ttmYoy: "pb_pd_fundraising_ttm_yoy_pct",
    ttmCount: "pb_pd_fundraising_ttm_fund_count",
    ttmRank: "derived_pd_fundraising_ttm_rank",
    ttmShare: "derived_pd_fundraising_ttm_share_of_private_capital",
    usTotal: "derived_us_private_debt_raised_total_annual",
    usDlShare: "derived_us_dl_share_of_private_debt_raised",
    usDl: "pb_us_private_debt_raised_direct_lending_annual",
    dryPowder: "pb_us_dl_dry_powder_annual",
    nav: "pb_us_dl_nav_annual",
    aum: "derived_us_dl_aum_annual",
    dpShare: "derived_us_dl_dry_powder_share_of_aum",
    globalDpShare: "pb_pd_dry_powder_share_of_aum",
    globalDp: "pb_pd_dry_powder_headline",
    globalAum: "pb_pd_aum_headline",
    cagr10: "derived_us_dl_aum_cagr_10y",
    cagr5: "derived_us_dl_aum_cagr_5y",
    dlCagrReport: "pb_dl_aum_cagr_10y",
    peCagr: "pb_pe_aum_cagr_10y",
    peAum: "pb_pe_aum",
    deployTtm: "derived_dl_deployment_ttm",
    volAnnual: "lcd_dl_volume_annual",
    volQ: "lcd_dl_volume_quarterly",
    yearsTtm: "derived_dl_years_of_dry_powder",
    yearsCal: "derived_dl_years_of_dry_powder_calendar",
    gap: "derived_fundraising_minus_deployment_annual",
    gapDl: "derived_dl_fundraising_minus_deployment_annual",
    dlLboQ: "lcd_dl_lbo_volume_quarterly",
    bslLboQ: "lcd_bsl_lbo_volume_quarterly",
    callPd: "qp_pd_capital_call_rate",
    callPe: "qp_pe_capital_call_rate",
    callVc: "qp_vc_capital_call_rate",
    callRa: "qp_real_assets_capital_call_rate",
    callRe: "qp_real_estate_capital_call_rate"
  };
  var GROUPS = ["pb-capital", "reports", "lcd-dealflow"];
  /* the reports' rule: at or above this many $B a year is a strong year */
  var RULE_200 = 200;
  /* the strategy table the report prints beside the TTM figure; the
     ingest writes it under tables/ with the report edition in its slug */
  var STRATEGY_TABLE = "tables/pb-ttm-fundraising-by-strategy-";

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function yearOf(d) { return String(d || "").slice(0, 4); }
  function monthOf(d) { return Number(String(d || "").slice(5, 7)); }
  /* months covered by a window point (ytd, rolling), from start to p */
  function monthsIn(pt) {
    if (!pt || !pt.p || !pt.start) return null;
    return (Number(yearOf(pt.p)) - Number(yearOf(pt.start))) * 12 + (monthOf(pt.p) - monthOf(pt.start) + 1);
  }
  /* a signed $B change: +$22.1B, −$103.7B */
  function signedB(F, v) { return isNum(v) ? (v < 0 ? "−" : "+") + "$" + F.withCommas(Math.abs(v).toFixed(1)) + "B" : "—"; }
  /* "$5.7T" for a $B value in the thousands, else the $B form */
  function bigB(F, v) { return isNum(v) && Math.abs(v) >= 1000 ? (v < 0 ? "−" : "") + "$" + (Math.abs(v) / 1000).toFixed(1) + "T" : F.B(v); }
  /* a half-year point prints as "H1 2026" when it spans exactly the
     first six months; any other year-to-date window prints its dates */
  function halfLabel(F, pt) {
    if (!pt) return "—";
    var m = monthsIn(pt);
    if (pt.g === "ytd" && m === 6 && monthOf(pt.start) === 1) return F.half(pt.p);
    if (pt.g === "half") return F.half(pt.p);
    return F.period(pt);
  }
  /* "TTM Jun 2026" for a rolling twelve-month point on an axis */
  function ttmShort(F, pt) { return pt ? "TTM " + F.monthLabel(pt.p) : "—"; }
  /* "PE, VC and real assets" */
  function listOf(names) { return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]; }
  function words(n) { return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] || String(n); }

  /* ---------- popups: formula → caveat → definition → how to read ---------- */
  var ENTRIES = [
    { key: "capSection", label: "Capital: fundraising, AUM, dry powder and deployment",
      formula: "Global report series (final closes) · US fund-data series from the monitor (AUM, capital raised by type) · LCD direct-lending volume; a ratio crosses populations only where the tile says direction, not level",
      watch: "Three populations sit in this section and are never mixed silently: the global fundraising report, US fund data, and LCD volume from every lender with deal size estimated where undisclosed.",
      definition: "How much money is committed to private credit, how much of it is still uncalled, and how fast the market is putting it to work.",
      interpretation: "Read levels against the reports' own rules — at or above $200B a year is strong, rank against PE and VC — then dry powder as a share of AUM and as years of deployment, and deployment against LBO financing." },
    { key: "capFundraising", label: "Private debt capital raised and fund count, global",
      formula: "Σ final closes of closed-end private debt funds in the calendar year; fund count = funds closing; the run = consecutive full years with capital ≥ $200B, counted back from the latest, on the newest report cut",
      watch: "The latest year or half is provisional: late reporters add about a fifth. A half-year is annualized only with 'if this pace holds'. Each report replaces the series whole; older cuts are kept as their own vintage and never mixed in.",
      definition: "The global fundraising series the PitchBook reports headline, drawn from the newest report.",
      interpretation: "At or above $200B a year is the reports' strong year. A falling fund count with rising capital is manager concentration, not weakness." },
    { key: "capTtmRank", label: "Trailing-12-month fundraising and rank among strategies",
      formula: "TTM capital raised; YoY = TTM ÷ prior TTM − 1 (the report's figure); rank = private debt's position in the report's strategy table sorted by capital, the private-capital total row excluded; share = private debt ÷ that total",
      watch: "The YoY figures are the report's own and the fund counts fall faster than capital when large funds close. The table is read from the rendered page because its text layer misaligns the row labels.",
      definition: "The league-table read: where private debt sits among PE, VC, real estate, real assets, secondaries, funds of funds and co-investment.",
      interpretation: "Rank and sign matter more than the level. Second to PE and the only strategy up on the year is the annual reports' 'overtaken venture capital' frame." },
    { key: "capAvgFundSize", label: "Average fund size closed",
      formula: "Capital raised ($B × 1,000) ÷ fund count, same period and same report cut; the concentration read counts consecutive annual declines in fund count and quotes the five largest closes' share of capital",
      watch: "Small funds report late, so the half-year average is high and will fall as the year restates. The five-largest share is the report's figure for the quarter's closes over half-year capital.",
      definition: "How large the average private debt fund that closed was, in $M.",
      interpretation: "A doubling in a year with a falling count is manager concentration; read it with the top-five share, never as fund quality." },
    { key: "capRaisedByType", label: "US private debt raised by type, and direct-lending share",
      formula: "Total = Σ nine fund-type series (venture, real estate, mezzanine, infrastructure, debt, distressed, direct lending, special situations, bridge); DL share = direct lending ÷ total, same period",
      watch: "US funds by type from the monitor's fund-data slide, not the global report series: the two totals are never set side by side as levels. The last bar is a trailing twelve months, not a calendar year.",
      definition: "What kind of private debt US investors funded, and how much of it went to direct lending.",
      interpretation: "Strategy mix is cyclical: direct lending gains share when other strategies pause; distressed and special situations gain in dislocations." },
    { key: "capDlAum", label: "US direct-lending AUM",
      formula: "AUM = dry powder + NAV at each year-end, both from the monitor's fund-data slide",
      watch: "US direct-lending funds tracked by PitchBook, not the global private debt AUM headline of the fundraising report; different populations, never one ratio.",
      definition: "What US direct-lending funds hold at value plus what they can still call.",
      interpretation: "A slow series gets stability language. Read the level beside PE's AUM for the room-to-grow frame, never beside global private debt AUM." },
    { key: "capDryPowderShare", label: "Dry powder share of AUM",
      formula: "Dry powder ÷ (dry powder + NAV), same year-end; the global references are the 2024 report's headline share and dry powder ÷ AUM from the newest report, computed at render",
      watch: "US direct lending runs above the global private debt share because direct-lending funds hold more uncalled capital than the mixed strategy set: compare the trend, not the level. The newest global AUM is stated only as 'almost'.",
      definition: "How much of the money committed to US direct lending is still uncalled.",
      interpretation: "The 2024 report calls its global share 'consistent with previous years' and 'healthy'; the newest report reads a fall as managers deploying capital they had already closed on." },
    { key: "capAumCagr", label: "AUM growth against PE",
      formula: "(AUM_end ÷ AUM_start)^(1 ÷ years) − 1 over ten and five years from the monitor's AUM series; comparators are the reports' direct-lending and PE ten-year CAGRs to their own dates",
      watch: "The site's rate is US direct lending from the monitor; the reports' comparators are global and end at their own as-of date. Different windows and populations, read for direction.",
      definition: "How fast US direct-lending AUM has compounded.",
      interpretation: "About double the PE rate the reports quote, but slowing; the absolute AUM beside PE's is the answer to 'too far, too fast'." },
    { key: "capDeployment", label: "Deployment, trailing twelve months",
      formula: "TTM = YTD this year + (full prior year − YTD prior year to the same date), all from the monitor's annual chart; calendar years straight from that chart",
      watch: "LCD estimates deal size where it is not disclosed, so this is market volume by every lender, not fund capital called. The year-to-date comparison is against the same months of last year.",
      definition: "How much direct lending was originated over the last twelve months.",
      interpretation: "Read it against the last two full years; deployment follows LBO financing within the quarter." },
    { key: "capYearsDryPowder", label: "Years of dry powder",
      formula: "Dry powder at the latest year-end ÷ TTM direct-lending volume; calendar variant = year-end dry powder ÷ same-year volume; both derived keys the ingest wrote",
      watch: "Numerator is PitchBook US fund data at year-end; denominator is LCD volume from every lender through the monitor's month. Different universes and mixed dates: direction only, never the level.",
      definition: "How many years the uncalled capital would last at the current lending pace.",
      interpretation: "A falling ratio means capital is being deployed, the 2021 report's test. The LCD denominator counts all lenders and understates fund runway; the capital-call tile is the fund-side cross-check." },
    { key: "capFundMinusDeploy", label: "Fundraising minus deployment",
      formula: "US private debt raised (Σ nine types) − LCD direct-lending volume, same calendar year; the DL-only variant uses direct-lending capital raised as the minuend",
      watch: "Two US populations: funds closed against loans made by every lender. A negative gap is financed by BDC, evergreen and insurance capital outside the drawdown universe, so it is a supply-demand sign, not a shortage.",
      definition: "Whether the market is lending faster than funds are closing.",
      interpretation: "Positive means capital arrives faster than it is lent; negative means the market draws down what it closed on earlier, which is why dry powder fell." },
    { key: "capLboFinancing", label: "LBO financing, both channels",
      formula: "Direct-lending LBO volume + BSL institutional LBO volume per quarter, summed at render from the two monitor series; deployment is the all-borrower direct-lending quarterly volume",
      watch: "The rolling three-month point overlaps the last full quarter and is never summed with it. The BSL series counts institutional leveraged loans only.",
      definition: "How much buyout financing both channels wrote in the quarter, beside total direct-lending deployment.",
      interpretation: "Private credit deployment is strongly linked to PE LBO deal value (the 2023 report): when LBO financing halves, deployment follows within the quarter." },
    { key: "capCallRate", label: "Capital-call rate (cross-check)",
      formula: "Rolling twelve-month capital calls ÷ beginning dry powder, PitchBook's series hand-keyed from Quantitative Perspectives; implied runway = 1 ÷ rate, computed at render",
      watch: "US and preliminary for the latest quarter; never labeled global. It updates with each issue, not with the monthly monitor.",
      definition: "How fast funds are calling the capital they closed on.",
      interpretation: "The slowest call pace among the strategies implies the longest fund-side runway, and explains why the LCD-basis years of dry powder understates it." },
    { key: "capC1", label: "C1 — Private debt fundraising, global",
      formula: "Columns: capital raised ($B) by calendar year with the half-year bar last; line: fund count on the right axis; dashed rule at $200B; the provisional bar hatched",
      watch: "The last bar is a half-year, not a year, and provisional: late reporters add about a fifth. It is never annualized on the chart.",
      definition: "The reports' headline series, with the rule they read it against.",
      interpretation: "Bars against the rule give the level read; bars diverging from the count line give the concentration read." },
    { key: "capC2", label: "C2 — Trailing-12-month fundraising by strategy",
      formula: "Horizontal bars sorted by TTM capital raised, from the report's strategy table; the YoY change is the label at each bar's end; private debt in the accent",
      watch: "The private-capital total row is excluded. The report's own YoY figures are shown, not recomputed.",
      definition: "The league table of private strategies over the last twelve months.",
      interpretation: "Rank and sign: a strategy that is up while every other is down is winning allocation, whatever the level." },
    { key: "capC3", label: "C3 — US private debt raised by type",
      formula: "Stacked columns of the nine fund types per year plus the trailing twelve months; line: direct lending ÷ total on the right axis",
      watch: "US fund data by type, not the global report series. The TTM bar is a rolling window and is never summed with the years.",
      definition: "The strategy mix of US private debt fundraising.",
      interpretation: "The direct-lending share swings with the cycle; which type gave up share explains the swing." },
    { key: "capC4", label: "C4 — US direct-lending AUM and dry powder share",
      formula: "Stacked columns: dry powder and NAV per year-end; line: dry powder ÷ AUM on the right axis; shaded band between the global private debt references (the 2024 report's share and dry powder ÷ AUM from the newest report)",
      watch: "The band is global private debt, the columns US direct lending: the line runs above the band by population, so read its trend against the band, not its level.",
      definition: "The stock of US direct-lending capital and how much of it is uncalled.",
      interpretation: "Stability language for the level; the share line carries the analysis." },
    { key: "capC5", label: "C5 — Years of dry powder",
      formula: "Columns side by side: direct-lending volume (deployment) and dry powder per year, plus a trailing-twelve-month slot where dry powder is held at the latest year-end; line: dry powder ÷ volume on the right axis",
      watch: "The two columns come from different universes (fund data against every lender) and the last slot mixes dates; the ratio is direction only.",
      definition: "Uncalled capital against the pace it is lent at.",
      interpretation: "A falling line means capital is being deployed; a rising line is the 'too much capital chasing too few deals' worry." },
    { key: "capC6", label: "C6 — Fundraising minus deployment",
      formula: "Diverging columns: US private debt raised − direct-lending volume per calendar year, with a zero line; the direct-lending-only variant drawn as an outline bar",
      watch: "Funds closed against loans made by every lender, both US; the sign is the reading, the level is not a shortage.",
      definition: "Whether capital arrived faster than it was lent, year by year.",
      interpretation: "A negative gap is financed by leverage and non-drawdown capital; read it with the falling dry-powder share as evidence of deployment." },
    { key: "capC7", label: "C7 — Deployment against LBO financing",
      formula: "Two lines per quarter: all-borrower direct-lending volume, and direct-lending LBO volume + BSL institutional LBO volume (summed at render); the rolling three-month point is a hollow marker",
      watch: "The hollow point is the monitor's last three months and overlaps the final quarter shown; it is never summed with the quarters.",
      definition: "The PE-deal link made visible.",
      interpretation: "Deployment moves with LBO financing within the quarter; when the LBO line halves, so does deployment." }
  ];
  if (CAT && typeof CAT.register === "function") CAT.register(ENTRIES);

  /* ---------- caption templates ----------
     Each template is a function of the values the renderer computes; the
     sample carries the widest plausible print of each value so
     scripts/test-pc-page.mjs can measure every caption under 240
     characters. The stamp lives in the tile footer, never here. */
  var CAPTIONS = {
    c1: {
      template: function (v) {
        return v.year + " raised " + v.capital + " across " + v.count + " funds, " + v.chg + " on " + v.prior + " and the " + v.run +
          " consecutive year at or above $200B; " + v.half + "'s " + v.h1 + " is " + v.share + " of " + v.year + " in half a year, " + v.annual + " if this pace holds.";
      },
      sample: function () { return CAPTIONS.c1.template({ year: "2025", capital: "$1,275.2B", count: "1,309", chg: "+105.3%", prior: "2024", run: "17th", half: "H1 2026", h1: "$1,158.3B", share: "157.5%", annual: "$2,316.6B" }); }
    },
    c2: {
      template: function (v) {
        return "Private debt raised " + v.ttm + " in the twelve months to " + v.to + ", " + v.rank + " of " + v.n + " private strategies behind " + v.leader + "'s " + v.leaderVal +
          (v.onlyUp ? " and the only one up on the year (" : " (") + v.yoy + "); " + v.share + " of the " + v.total + " private-capital total.";
      },
      sample: function () { return CAPTIONS.c2.template({ ttm: "$1,309.1B", to: "Jun 30, 2026", rank: "2nd", n: "8", leader: "private equity", leaderVal: "$1,468.8B", onlyUp: true, yoy: "+114.0%", share: "22.9%", total: "$11,348.0B" }); }
    },
    c3: {
      template: function (v) {
        return "Direct lending took " + v.dlShare + " of the " + v.total + " of US private debt raised in " + v.period + ", " + v.dir + " from " + v.prior + " in " + v.priorPeriod +
          "; " + v.loser + " fell to " + v.loserNow + " from " + v.loserThen + ".";
      },
      sample: function () { return CAPTIONS.c3.template({ dlShare: "100.0%", total: "$1,207.7B", period: "the TTM to Jun 30, 2026", dir: "down", prior: "100.0%", priorPeriod: "2025", loser: "credit special situations", loserNow: "$108.7B", loserThen: "$128.3B" }); }
    },
    c4: {
      template: function (v) {
        return "US direct-lending AUM " + v.aum + " at " + v.date + " (dry powder " + v.dp + " + NAV " + v.nav + "), " + v.chg + " on the year; dry powder is " + v.share +
          " of AUM, in a " + v.bandLo + "–" + v.bandHi + " band over " + v.bandYears + " years, against " + v.norm + " for global private debt (" + v.normEd + " report).";
      },
      sample: function () { return CAPTIONS.c4.template({ aum: "$1,465.3B", date: "Dec 31, 2025", dp: "$1,169.6B", nav: "$1,295.7B", chg: "+12.4%", share: "36.4%", bandLo: "32", bandHi: "38%", bandYears: "three", norm: "31.1%", normEd: "2024" }); }
    },
    c5: {
      template: function (v) {
        return "Dry powder covers " + v.years + " years of deployment at the trailing pace (" + v.dp + " at " + v.dpDate + " ÷ " + v.vol + " to " + v.volDate + "), " + v.dir + " from " + v.peak + " in " + v.peakYear +
          "; a falling ratio means capital is being deployed. Direction, not level.";
      },
      sample: function () { return CAPTIONS.c5.template({ years: "10.68", dp: "$1,169.6B", dpDate: "Dec 31, 2025", vol: "$1,250.2B", volDate: "Aug 31, 2026", dir: "down", peak: "11.58", peakYear: "2020" }); }
    },
    c6: {
      template: function (v) {
        return "US private debt funds raised " + v.raised + " in " + v.year + " against " + v.deployed + " of direct lending, a gap of " + v.gap + "; the sign turned " + v.sign + " in " + v.flipYear +
          " after " + v.before + " in " + v.beforeYear + ". Two US populations, so read the sign.";
      },
      sample: function () { return CAPTIONS.c6.template({ raised: "$1,164.7B", year: "2025", deployed: "$1,268.4B", gap: "−$1,103.7B", sign: "negative", flipYear: "2024", before: "+$122.1B", beforeYear: "2023" }); }
    },
    c7: {
      template: function (v) {
        return "Direct lending deployed " + v.dl + " in " + v.window + " against " + v.lbo + " of LBO financing across both channels; " + v.q1 + " was " + v.dlq1 + " and " + v.lboq1 +
          ", " + v.q2 + " " + v.dlq2 + " and " + v.lboq2 + ". The rolling window overlaps " + v.overlap + ".";
      },
      sample: function () { return CAPTIONS.c7.template({ dl: "$148.6B", window: "Jun–Aug 2026", lbo: "$127.8B", q1: "Q1 2026", dlq1: "$175.6B", lboq1: "$151.4B", q2: "Q2 2026", dlq2: "$136.8B", lboq2: "$127.2B", overlap: "Q2 2026" }); }
    }
  };

  /* ---------- reading the series ----------
     Everything below computes from the loader; nothing is typed. */
  function resolveEdition(S, prefix, preferred) {
    if (S.has(preferred)) return preferred;
    var idx = S.index(), best = null;
    if (!idx || !idx.series) return preferred;
    Object.keys(idx.series).forEach(function (k) {
      var m = idx.series[k];
      if (k.indexOf(prefix) !== 0 || !/ed$/.test(k) || m.source !== "pb-fundraising-report") return;
      if (!best || String(m.asOf || "") > String(best.asOf || "")) best = { key: k, asOf: m.asOf };
    });
    return best && S.has(best.key) ? best.key : preferred;
  }
  function years(S, key) { return S.has(key) ? S.pointsOf(key, { grain: "year" }).filter(function (p) { return isNum(p.y); }) : []; }
  function byYear(pts) { var o = {}; pts.forEach(function (p) { o[yearOf(p.x)] = p; }); return o; }
  function last(arr) { return arr.length ? arr[arr.length - 1] : null; }
  function latestOf(S, key, opts) { return S.has(key) ? S.latest(key, opts) : null; }
  function firstClause(s) { return String(s || "").split(/[.;]/)[0].trim(); }
  /* the fund type behind one of the nine chart29 keys, from its population line */
  function typeName(e) {
    var m = String(e && e.population || "").match(/type = (.+)$/);
    if (m) return m[1].trim();
    var l = String(e && e.label || "").replace(/^.*?, /, "").replace(/\s*\(.*$/, "");
    return l || (e && e.key) || "";
  }
  /* consecutive years, counted back from the last annual point, while
     test(point, previous point) holds */
  function runBack(pts, test) {
    var n = 0;
    for (var i = pts.length - 1; i >= 0; i--) {
      if (!test(pts[i], pts[i - 1] || null)) break;
      n++;
    }
    return n;
  }
  function maxOf(pts) { var m = null; pts.forEach(function (p) { if (isNum(p.y) && (!m || p.y > m.y)) m = p; }); return m; }
  function minOf(pts) { var m = null; pts.forEach(function (p) { if (isNum(p.y) && (!m || p.y < m.y)) m = p; }); return m; }

  function model(S) {
    var F = S.fmt, m = { missing: [] };
    var need = function (key) { if (!S.has(key)) { if (m.missing.indexOf(key) < 0) m.missing.push(key); return false; } return true; };

    /* the report cut */
    m.capKey = resolveEdition(S, "pb_pd_fundraising_capital_", K.capital);
    m.countKey = resolveEdition(S, "pb_pd_fund_count_", K.count);

    /* 1. capital raised and fund count */
    if (need(m.capKey)) {
      var cy = years(S, m.capKey), cn = need(m.countKey) ? years(S, m.countKey) : [], cnBy = byYear(cn);
      var lastY = last(cy), priorY = cy.length > 1 ? cy[cy.length - 2] : null;
      var ytd = latestOf(S, m.capKey, { grain: ["ytd", "half"] });
      var ytdCount = ytd && S.has(m.countKey) ? (S.at(m.countKey, ytd.x, ytd.g) || null) : null;
      var runPt = latestOf(S, K.run200);
      var run = runPt ? runPt.y : runBack(cy, function (p) { return p.y >= RULE_200; });
      var months = monthsIn(ytd);
      m.fund = {
        years: cy, counts: cn, countBy: cnBy, last: lastY, prior: priorY,
        lastCount: lastY && cnBy[yearOf(lastY.x)] ? cnBy[yearOf(lastY.x)].y : null,
        chg: lastY && priorY && priorY.y ? lastY.y / priorY.y - 1 : null,
        run: run, runFromDerived: !!runPt,
        ytd: ytd, ytdCount: ytdCount, months: months,
        shareOfLast: ytd && lastY && lastY.y ? ytd.y / lastY.y : null,
        annualized: ytd && months ? ytd.y * 12 / months : null,
        provisional: !!(ytd && S.isProvisional(ytd)),
        halfLabel: halfLabel(F, ytd)
      };
      /* concentration: consecutive annual declines in count, and whether
         the half-year pace would extend the run */
      var declines = runBack(cn, function (p, prev) { return !!prev && p.y < prev.y; });
      m.fund.countDeclines = declines;
      m.fund.countPace = ytdCount && months ? ytdCount.y * 12 / months : null;
      m.fund.paceExtends = isNum(m.fund.countPace) && m.fund.lastCount !== null && m.fund.countPace < m.fund.lastCount;
    }
    /* 3. average fund size */
    if (need(K.avgSize)) {
      var av = S.pointsOf(K.avgSize).filter(function (p) { return isNum(p.y); });
      var avYears = av.filter(function (p) { return p.g === "year"; });
      var avLast = last(av);
      m.avg = { all: av, latest: avLast, path: avYears.slice(-3).concat(avLast && avLast.g !== "year" ? [avLast] : []),
        topFive: latestOf(S, K.topFiveShare) };
    }
    /* 2. TTM and rank */
    if (need(K.ttm)) {
      m.ttm = { pt: latestOf(S, K.ttm), yoy: latestOf(S, K.ttmYoy), count: latestOf(S, K.ttmCount),
        rank: latestOf(S, K.ttmRank), share: latestOf(S, K.ttmShare), table: null };
    }
    /* 4. US raised by type */
    if (need(K.usTotal)) {
      var totE = S.get(K.usTotal), typeKeys = (totE.inputs || []).filter(function (k) { return S.has(k); });
      var totAll = S.pointsOf(K.usTotal).filter(function (p) { return isNum(p.y); });
      var totLatest = last(totAll);
      var totPrior = null;
      for (var i = totAll.length - 2; i >= 0; i--) { if (totAll[i].g === "year") { totPrior = totAll[i]; break; } }
      var shareAll = S.has(K.usDlShare) ? S.pointsOf(K.usDlShare).filter(function (p) { return isNum(p.y); }) : [];
      var shareAt = function (pt) { if (!pt) return null; for (var j = 0; j < shareAll.length; j++) if (shareAll[j].x === pt.x && shareAll[j].g === pt.g) return shareAll[j]; return null; };
      var types = typeKeys.map(function (k) {
        var e = S.get(k), pts = S.pointsOf(k).filter(function (p) { return isNum(p.y); });
        var at = function (pt) { if (!pt) return null; for (var j = 0; j < pts.length; j++) if (pts[j].x === pt.x && pts[j].g === pt.g) return pts[j]; return null; };
        var nowPt = at(totLatest), thenPt = at(totPrior);
        return { key: k, name: typeName(e), points: pts, now: nowPt, then: thenPt,
          shareNow: nowPt && totLatest && totLatest.y ? nowPt.y / totLatest.y : null,
          shareThen: thenPt && totPrior && totPrior.y ? thenPt.y / totPrior.y : null };
      });
      var loser = null;
      types.forEach(function (t) {
        if (!isNum(t.shareNow) || !isNum(t.shareThen)) return;
        var d = t.shareNow - t.shareThen;
        if (!loser || d < loser.d) loser = { t: t, d: d };
      });
      m.byType = { total: totAll, latest: totLatest, prior: totPrior, types: types, loser: loser ? loser.t : null,
        share: shareAll, shareLatest: shareAt(totLatest), sharePrior: shareAt(totPrior), typeKeys: typeKeys };
    }
    /* 5–6. AUM and dry powder share */
    if (need(K.aum)) {
      var aumY = years(S, K.aum), dpY = years(S, K.dryPowder), navY = years(S, K.nav), shY = years(S, K.dpShare);
      var aumLast = last(aumY), aumPrior = aumY.length > 1 ? aumY[aumY.length - 2] : null;
      var dpBy = byYear(dpY), navBy = byYear(navY), shBy = byYear(shY);
      var shLast = last(shY), shPrior = shY.length > 1 ? shY[shY.length - 2] : null;
      var band = shY.slice(-4);
      var gDp = latestOf(S, K.globalDp), gAum = latestOf(S, K.globalAum), gShare = latestOf(S, K.globalDpShare);
      var gShareE = S.has(K.globalDpShare) ? S.get(K.globalDpShare) : null;
      var gEdition = gShare && gShare.edition ? String(gShare.edition) : (gShareE && gShareE.edition ? String(gShareE.edition) : "");
      m.aum = { years: aumY, last: aumLast, prior: aumPrior, chg: aumLast && aumPrior && aumPrior.y ? aumLast.y / aumPrior.y - 1 : null,
        dp: aumLast && dpBy[yearOf(aumLast.x)] ? dpBy[yearOf(aumLast.x)] : null,
        nav: aumLast && navBy[yearOf(aumLast.x)] ? navBy[yearOf(aumLast.x)] : null,
        dpBy: dpBy, navBy: navBy, shareBy: shBy, share: shY, shareLast: shLast, sharePrior: shPrior,
        sharePeak: maxOf(shY), bandLo: minOf(band), bandHi: maxOf(band), bandYears: band.length,
        global: { share: gShare, edition: gEdition, dp: gDp, aum: gAum,
          implied: gDp && gAum && gAum.y ? gDp.y / gAum.y : null, approx: !!(gAum && gAum.approx) } };
    }
    /* 7. CAGR */
    if (need(K.cagr10)) {
      m.cagr = { ten: latestOf(S, K.cagr10), five: latestOf(S, K.cagr5), dlReport: latestOf(S, K.dlCagrReport),
        pe: latestOf(S, K.peCagr), peAum: latestOf(S, K.peAum) };
    }
    /* 8. deployment */
    if (need(K.volAnnual)) {
      var volY = years(S, K.volAnnual), ytdV = S.pointsOf(K.volAnnual, { grain: "ytd" }).filter(function (p) { return isNum(p.y); });
      m.deploy = { ttm: latestOf(S, K.deployTtm), years: volY, last: last(volY), prior: volY.length > 1 ? volY[volY.length - 2] : null,
        ytd: last(ytdV), ytdPrior: ytdV.length > 1 ? ytdV[ytdV.length - 2] : null, volBy: byYear(volY) };
      if (m.deploy.ytd && m.deploy.ytdPrior && m.deploy.ytdPrior.y) m.deploy.ytdChg = m.deploy.ytd.y / m.deploy.ytdPrior.y - 1;
    }
    /* 9. years of dry powder */
    if (need(K.yearsTtm) || need(K.yearsCal)) {
      var cal = years(S, K.yearsCal);
      m.years = { ttm: latestOf(S, K.yearsTtm), cal: cal, peak: maxOf(cal), calBy: byYear(cal) };
    }
    /* 10. fundraising minus deployment */
    if (need(K.gap)) {
      var gapY = years(S, K.gap), gapLast = last(gapY);
      var flipIdx = gapY.length - 1;
      while (flipIdx > 0 && Math.sign(gapY[flipIdx - 1].y) === Math.sign(gapLast.y)) flipIdx--;
      var gapDlY = years(S, K.gapDl);
      m.gap = { years: gapY, last: gapLast, flip: gapY[flipIdx] || null, before: flipIdx > 0 ? gapY[flipIdx - 1] : null,
        raised: gapLast && m.byType ? (byYear(m.byType.total.filter(function (p) { return p.g === "year"; }))[yearOf(gapLast.x)] || null) : null,
        deployed: gapLast && m.deploy ? (m.deploy.volBy[yearOf(gapLast.x)] || null) : null,
        dl: gapDlY, dlLast: last(gapDlY), dlBy: byYear(gapDlY) };
    }
    /* 11. LBO financing, both channels, summed at render */
    if (need(K.dlLboQ) && need(K.bslLboQ) && need(K.volQ)) {
      var dlq = S.pointsOf(K.dlLboQ), bslq = S.pointsOf(K.bslLboQ), volq = S.pointsOf(K.volQ);
      var bslBy = {}; bslq.forEach(function (p) { bslBy[p.x + "|" + p.g] = p; });
      var volBy = {}; volq.forEach(function (p) { volBy[p.x + "|" + p.g] = p; });
      var rows = [];
      dlq.forEach(function (p) {
        var b = bslBy[p.x + "|" + p.g], v = volBy[p.x + "|" + p.g];
        if (!b || !isNum(p.y) || !isNum(b.y)) return;
        rows.push({ x: p.x, p: p.x, g: p.g, start: p.start || null, dl: p.y, bsl: b.y, lbo: p.y + b.y, deploy: v && isNum(v.y) ? v.y : null });
      });
      var quarters = rows.filter(function (r) { return r.g === "quarter"; });
      var rolling = rows.filter(function (r) { return S.isRolling(r); });
      var qLast = last(quarters), qPrior = quarters.length > 1 ? quarters[quarters.length - 2] : null, roll = last(rolling);
      m.lbo = { rows: rows, quarters: quarters, last: qLast, prior: qPrior, rolling: roll,
        overlap: roll && roll.start ? F.quarter(roll.start) : (qLast ? F.quarter(qLast.x) : "—"),
        ratio: qLast && qPrior && qPrior.lbo ? qLast.lbo / qPrior.lbo : null,
        deployRatio: qLast && qPrior && isNum(qLast.deploy) && qPrior.deploy ? qLast.deploy / qPrior.deploy : null };
    }
    /* 12. capital-call rate */
    if (need(K.callPd)) {
      var pd = latestOf(S, K.callPd), pdE = S.get(K.callPd);
      var peers = [[K.callPe, "PE"], [K.callVc, "VC"], [K.callRa, "real assets"], [K.callRe, "real estate"]].map(function (r) {
        var p = latestOf(S, r[0]); return p ? { key: r[0], name: r[1], v: p.y, pt: p } : null;
      }).filter(Boolean);
      var faster = pd ? peers.filter(function (p) { return p.v > pd.y; }) : [], slower = pd ? peers.filter(function (p) { return p.v < pd.y; }) : [];
      m.call = { pt: pd, entry: pdE, runway: pd && pd.y ? 100 / pd.y : null, peers: peers, faster: faster, slower: slower,
        slowest: !!pd && peers.length > 0 && slower.length === 0,
        provisional: !!(pd && S.isProvisional(pd)), geography: pdE ? pdE.geography : "" };
    }
    return m;
  }

  /* the strategy table beside the TTM figure: tables/<slug>-<edition>.json */
  var TABLE = { slug: null, data: null };
  function loadTable(S) {
    var src = S.sources()["pb-fundraising-report"];
    var ed = src && src.edition ? String(src.edition).toLowerCase() : null;
    if (!ed) return Promise.resolve(null);
    var slug = STRATEGY_TABLE + ed;
    return S.reader(S.BASE + slug + ".json").then(function (file) {
      var eds = file && Array.isArray(file.editions) ? file.editions : [];
      var t = eds.filter(function (e) { return String(e.edition || "").toLowerCase() === ed; })[0] || last(eds);
      if (!t || !Array.isArray(t.rows) || !Array.isArray(t.header)) return null;
      var col = {}; t.header.forEach(function (h, i) { col[h] = i; });
      var rows = t.rows.map(function (r) {
        return { strategy: String(r[col.strategy]), capital: r[col.capitalRaised], yoy: r[col.capitalYoY], count: r[col.fundCount], countYoy: r[col.fundCountYoY] };
      }).filter(function (r) { return isNum(r.capital); });
      /* the total row: named as such, or the row equal to the sum of the others */
      var sum = rows.reduce(function (a, r) { return a + r.capital; }, 0);
      var total = rows.filter(function (r) { return /^private capital$/i.test(r.strategy) || Math.abs(r.capital * 2 - sum) < sum * 0.01; })[0] || null;
      var strategies = rows.filter(function (r) { return r !== total; }).sort(function (a, b) { return b.capital - a.capital; });
      TABLE.slug = slug; TABLE.data = { edition: t.edition, asOf: t.asOf, title: t.title, page: t.page, unit: t.unit, total: total, strategies: strategies, doc: t.document };
      return TABLE.data;
    }, function () { return null; });
  }
  /* private debt's row in the table, matched by name or by the TTM value */
  function pdRow(table, ttmPt) {
    if (!table) return null;
    return table.strategies.filter(function (r) { return /^private debt$/i.test(r.strategy); })[0] ||
      (ttmPt ? table.strategies.filter(function (r) { return Math.abs(r.capital - ttmPt.y) < 0.05; })[0] : null) || null;
  }

  /* ---------- the fact lines for the committee's note ---------- */
  function factLines(S, m) {
    var F = S.fmt, out = [];
    var stamp = function (keys) { var seen = [], p = []; keys.forEach(function (k) { var s = S.stampOf(k); if (s && seen.indexOf(s) < 0) { seen.push(s); p.push(s); } }); return p.join(" · "); };
    /* the page caps a fact at 400 characters; the stamp is the part
       that must survive, so the body gives way first */
    var fit = function (body, st) {
      var tail = st ? " — " + st : "", room = 400 - tail.length;
      if (body.length > room) body = body.slice(0, Math.max(0, room - 1)).replace(/[\s,;:—-]+$/, "") + "…";
      return body + tail;
    };
    if (m.fund && m.fund.last) {
      var f = m.fund, l = f.last;
      var line = "Private debt capital raised, global report series: " + yearOf(l.x) + " " + F.B(l.y) + (f.lastCount !== null ? " across " + F.count(f.lastCount) + " funds" : "") +
        (isNum(f.chg) && f.prior ? ", " + F.change(f.chg) + " on " + yearOf(f.prior.x) : "") +
        (isNum(f.run) ? "; " + F.ordinal(f.run) + " consecutive year at or above $200B" : "") +
        (f.ytd ? "; " + f.halfLabel + " " + F.B(f.ytd.y) + (f.ytdCount ? " across " + F.count(f.ytdCount.y) + " funds" : "") + (f.provisional ? " (provisional)" : "") +
          (isNum(f.shareOfLast) ? ", " + F.share(f.shareOfLast) + " of " + yearOf(l.x) : "") + (isNum(f.annualized) ? ", " + F.B(f.annualized) + " if this pace holds" : "") : "");
      if (m.avg && m.avg.latest) line += "; average fund size " + F.M(m.avg.latest.y) + " (" + halfLabel(F, m.avg.latest) + ")" + (f.countDeclines ? ", " + f.countDeclines + " straight annual declines in fund count" : "");
      out.push(fit(line, stamp([m.capKey])));
    }
    if (m.ttm && m.ttm.pt) {
      var t = m.ttm, row = pdRow(t.table, t.pt), lead = t.table ? t.table.strategies[0] : null;
      var up = t.table ? t.table.strategies.filter(function (r) { return r.yoy > 0; }).length : null;
      out.push(fit("Private debt trailing-12-month fundraising: " + F.B(t.pt.y) + " to " + F.date(t.pt.x) + (t.yoy ? " (" + F.signed(t.yoy.y, 1, "%") + " YoY)" : "") +
        (t.count ? ", " + F.count(t.count.y) + " funds" : "") +
        (t.rank ? "; " + F.ordinal(t.rank.y) + (t.table ? " of " + t.table.strategies.length + " strategies" : " among strategies") : "") +
        (lead && row && lead !== row ? " behind " + lead.strategy.toLowerCase() + " " + F.B(lead.capital) + " (" + F.signed(lead.yoy, 1, "%") + ")" : "") +
        (up !== null ? "; " + up + " of " + t.table.strategies.length + " strategies up on the year" : "") +
        (t.share ? "; " + F.share(t.share.y) + " of the private-capital total" + (t.table && t.table.total ? " " + F.B(t.table.total.capital) : "") : ""), stamp([K.ttm])));
    }
    if (m.byType && m.byType.latest) {
      var b = m.byType, lo = b.loser;
      out.push(fit("US private debt raised by type: " + F.B(b.latest.y) + (b.latest.g === "year" ? " in " : " over the ") + F.period(b.latest) + (b.prior ? " against " + F.B(b.prior.y) + " in " + F.period(b.prior) : "") +
        (b.shareLatest ? "; direct lending " + F.share(b.shareLatest.y) + " of it" + (b.sharePrior ? " from " + F.share(b.sharePrior.y) + " in " + F.period(b.prior) : "") : "") +
        (lo && lo.now && lo.then ? "; " + lo.name.toLowerCase() + " fell to " + F.B(lo.now.y) + " from " + F.B(lo.then.y) : "") +
        "; US fund data, a different population from the global report series", stamp([K.usTotal])));
    }
    if (m.aum && m.aum.last) {
      var a = m.aum, g = a.global;
      out.push(fit("US direct-lending AUM: " + F.B(a.last.y) + " at " + F.date(a.last.x) + (a.dp && a.nav ? " (dry powder " + F.B(a.dp.y) + " + NAV " + F.B(a.nav.y) + ")" : "") +
        (isNum(a.chg) ? ", " + F.change(a.chg) + " on the year" : "") +
        (a.shareLast ? "; dry powder " + F.share(a.shareLast.y) + " of AUM" + (a.sharePrior ? " from " + F.share(a.sharePrior.y) : "") + (a.sharePeak ? ", peak " + F.share(a.sharePeak.y) + " in " + yearOf(a.sharePeak.x) : "") : "") +
        (g.share ? "; global private debt " + F.pct(g.share.y) + " at " + F.date(g.share.x) + " (" + g.edition + " report)" : "") +
        (isNum(g.implied) ? ", " + (g.approx ? "about " : "") + F.share(g.implied, 0) + " implied by the newest report" : "") +
        "; different populations, compare the trend", stamp([K.aum])));
    }
    if (m.deploy && m.deploy.ttm) {
      var d = m.deploy, y = m.years;
      out.push(fit("Direct-lending deployment: " + F.B(d.ttm.y) + " " + F.period(d.ttm) + (d.last ? ", against " + F.B(d.last.y) + " in " + yearOf(d.last.x) : "") + (d.prior ? " and " + F.B(d.prior.y) + " in " + yearOf(d.prior.x) : "") +
        (isNum(d.ytdChg) ? "; YTD " + F.change(d.ytdChg) + " on the same months of last year" : "") +
        (y && y.ttm ? "; years of dry powder " + F.years(y.ttm.y) + " (dry powder at " + F.date(y.ttm.dryPowderAsOf || (m.aum && m.aum.last ? m.aum.last.x : null)) + " ÷ TTM volume)" + (y.peak ? ", from " + F.years(y.peak.y) + " in " + yearOf(y.peak.x) : "") + ", direction only: LCD volume counts every lender" : ""), stamp([K.deployTtm])));
    }
    if (m.gap && m.gap.last) {
      var gp = m.gap;
      out.push(fit("Fundraising minus deployment, US: " + F.B(gp.last.y) + " in " + yearOf(gp.last.x) + (gp.raised && gp.deployed ? " (" + F.B(gp.raised.y) + " raised against " + F.B(gp.deployed.y) + " lent)" : "") +
        (gp.flip && gp.flip !== gp.last ? "; the sign turned " + (gp.last.y < 0 ? "negative" : "positive") + " in " + yearOf(gp.flip.x) : "") + (gp.before ? " after " + signedB(F, gp.before.y) + " in " + yearOf(gp.before.x) : "") +
        (gp.dlLast ? "; direct-lending-only variant " + F.B(gp.dlLast.y) : "") + "; a supply-demand sign, not a shortage", stamp([K.gap])));
    }
    if (m.lbo && m.lbo.last) {
      var lb = m.lbo;
      var line2 = "LBO financing, both channels (direct lending + BSL, summed at render): " + F.B(lb.last.lbo) + " in " + F.quarter(lb.last.x) + (lb.prior ? " from " + F.B(lb.prior.lbo) + " in " + F.quarter(lb.prior.x) : "") +
        (isNum(lb.last.deploy) && lb.prior && isNum(lb.prior.deploy) ? "; direct-lending deployment " + F.B(lb.last.deploy) + " from " + F.B(lb.prior.deploy) : "") +
        (lb.rolling ? "; " + F.period(lb.rolling) + " " + F.B(lb.rolling.lbo) + " against " + F.B(lb.rolling.deploy) + " deployed (overlaps " + lb.overlap + ", never summed)" : "");
      out.push(fit(line2, stamp([K.dlLboQ])));
    }
    if (m.call && m.call.pt) {
      var cr = m.call;
      out.push(fit("Capital-call rate, " + (cr.geography || "US") + (cr.provisional ? ", preliminary" : "") + ": private debt " + F.pct(cr.pt.y) + " of beginning dry powder (" + F.period(cr.pt) + "), about " + F.years(cr.runway, 1) + " years of runway" +
        (cr.peers.length ? "; " + cr.peers.map(function (p) { return p.name + " " + F.pct(p.v); }).join(", ") : "") + (cr.slowest ? "; the slowest call pace shown" : cr.faster.length ? "; slower than " + listOf(cr.faster.map(function (p) { return p.name; })) + (cr.slower.length ? ", faster than " + listOf(cr.slower.map(function (p) { return p.name; })) : "") : "") +
        "; the fund-side cross-check", stamp([K.callPd])));
    }
    /* the page posts the first eight lines; the CAGR is context and sits on its tile, so it goes last */
    if (m.cagr && m.cagr.ten) {
      var c = m.cagr;
      out.push(fit("US direct-lending AUM CAGR: " + F.share(c.ten.y) + " a year over ten years (" + F.period(c.ten) + ")" + (c.five ? ", " + F.share(c.five.y) + " over five" : "") +
        (c.dlReport && c.pe ? "; the reports' comparators: direct lending " + F.pct(c.dlReport.y) + " against PE " + F.pct(c.pe.y) + " a year (" + F.period(c.pe) + ")" : "") +
        (c.peAum ? "; PE AUM " + bigB(F, c.peAum.y) + " at " + F.date(c.peAum.x) : ""), stamp([K.cagr10, K.peCagr])));
    }
    return out.map(function (l) { return l.slice(0, 400); });
  }

  /* ---------- rendering ---------- */
  var COLORS = { gold: "#f5c518", ink: "#8b8f98", line2: "#b6bac2", bar: "#6b6f78", grid: "rgba(255,255,255,.08)", band: "rgba(255,255,255,.06)",
    ramp: ["#3d4048", "#4d515a", "#5d616a", "#6e727b", "#7f838c", "#91959e", "#a3a7b0", "#b8bcc4"] };
  var MONO = "JetBrains Mono, monospace";

  function labelBtn(key, label) {
    return "<button type='button' class='tile-label' data-metric='" + esc(key) + "'><span>" + esc(label) + "</span></button>";
  }
  function flag(text) { return "<span class='cap-flag'>" + esc(text) + "</span>"; }
  function idSpan(key) { return "<span class='cap-id' data-metric='" + esc(key) + "'>" + esc(key) + "</span>"; }
  /* the tile footer: the population's first clause, each key with its
     as-of, then the edition stamps (a derived key prints its inputs');
     `pop` names the population outright where the figure sums keys of
     two populations, since the first key's clause would name only one */
  function footer(S, keys, extra, pop) {
    var F = S.fmt, byDate = {}, dates = [], stamps = [], seen = {};
    pop = pop || null;
    keys.forEach(function (k) {
      if (!S.has(k) || seen[k]) return;
      seen[k] = true;
      var e = S.get(k), d = e.asOf ? F.dateStamp(e.asOf) : "";
      if (!pop && e.population) pop = firstClause(e.population);
      if (!byDate[d]) { byDate[d] = []; dates.push(d); }
      byDate[d].push(idSpan(k));
      var st = S.stampOf(k);
      if (st && stamps.indexOf(st) < 0) stamps.push(st);
    });
    var ids = dates.map(function (d) { return byDate[d].join(", ") + (d ? " as of " + esc(d) : ""); });
    return "<p class='tile-foot'>" + (pop ? esc(pop) + " · " : "") + ids.join(" · ") + (stamps.length ? " · " + esc(stamps.join(" · ")) : "") + (extra ? " · " + esc(extra) : "") + "</p>";
  }
  /* the population of a figure summed across the two LBO channels: both
     keys' own clauses, read off the loader, joined */
  function bothChannels(S) {
    var a = S.get(K.dlLboQ), b = S.get(K.bslLboQ);
    var parts = [a && a.population ? firstClause(a.population) : "", b && b.population ? firstClause(b.population) : ""].filter(Boolean);
    return parts.length ? parts.join(", plus ") + " (summed at render)" : null;
  }
  function naTile(key, label, why) {
    return "<div class='tile cap-tile' data-tile='" + esc(key) + "'><div class='tile-head'>" + labelBtn(key, label) + "</div>" +
      "<span class='tile-value na'>not in this edition</span>" +
      "<p class='tile-reading'>" + esc(why) + " Nothing is shown in its place.</p></div>";
  }
  function rows(items) {
    return "<div class='cap-rows'>" + items.filter(Boolean).map(function (r) {
      return "<div class='cap-row'><span class='cap-k'>" + r[0] + "</span><span class='cap-v'>" + r[1] + "</span></div>";
    }).join("") + "</div>";
  }
  function tile(key, label, asOf, value, unit, change, reading, extraRows, foot) {
    return "<div class='tile cap-tile' data-tile='" + esc(key) + "'>" +
      "<div class='tile-head'>" + labelBtn(key, label) + (asOf ? "<span class='tile-asof'>" + esc(asOf) + "</span>" : "") + "</div>" +
      "<span class='tile-value'>" + value + (unit ? "<span class='unit'> " + esc(unit) + "</span>" : "") + "</span>" +
      (change ? "<span class='tile-change'>" + change + "</span>" : "") +
      "<p class='tile-reading'>" + reading + "</p>" + (extraRows || "") + foot + "</div>";
  }
  function regime(word, rest) { return "<span class='regime'>" + esc(word) + "</span> — " + rest; }

  function renderTiles(S, m) {
    var F = S.fmt, out = [];
    /* 1. capital raised and fund count */
    if (m.fund && m.fund.last) {
      var f = m.fund, l = f.last;
      out.push(tile("capFundraising", "Private debt capital raised, global", yearOf(l.x) + (f.ytd ? " · " + f.halfLabel : ""),
        esc(F.B(l.y)), yearOf(l.x),
        (isNum(f.chg) && f.prior ? esc(F.change(f.chg) + " vs " + yearOf(f.prior.x)) : "") + (f.lastCount !== null ? " · " + esc(F.count(f.lastCount)) + " funds" : ""),
        regime(isNum(f.run) && f.run > 0 ? F.ordinal(f.run) + " consecutive year at or above $200B" : "Below the $200B rule",
          "the reports' line for a strong year; the run is counted from the series" + (f.runFromDerived ? " (" + idSpan(K.run200) + ")" : " at render") + "." +
          (f.ytd && isNum(f.shareOfLast) ? " " + esc(f.halfLabel) + " at " + esc(F.B(f.ytd.y)) + " is " + esc(F.share(f.shareOfLast)) + " of " + esc(yearOf(l.x)) + " in half a year" +
            (isNum(f.annualized) ? ", " + esc(F.B(f.annualized)) + " if this pace holds" : "") + "." : "")),
        rows([f.ytd ? ["<span>" + esc(f.halfLabel) + "</span>", esc(F.B(f.ytd.y)) + (f.ytdCount ? " · " + esc(F.count(f.ytdCount.y)) + " funds" : "") + (f.provisional ? " " + flag("provisional") : "")] : null,
          f.prior ? ["<span>" + esc(yearOf(f.prior.x)) + "</span>", esc(F.B(f.prior.y)) + (f.countBy[yearOf(f.prior.x)] ? " · " + esc(F.count(f.countBy[yearOf(f.prior.x)].y)) + " funds" : "")] : null]),
        footer(S, [m.capKey, m.countKey, K.run200], "late reporters add about a fifth to the latest period")));
    } else out.push(naTile("capFundraising", "Private debt capital raised, global", "The report series " + m.capKey + " is not in this edition."));
    /* 2. TTM and rank */
    if (m.ttm && m.ttm.pt) {
      var t = m.ttm, tb = t.table, row = pdRow(tb, t.pt), lead = tb ? tb.strategies[0] : null;
      var up = tb ? tb.strategies.filter(function (r) { return r.yoy > 0; }) : null;
      var onlyUp = up && up.length === 1 && row && up[0] === row;
      out.push(tile("capTtmRank", "TTM fundraising and rank among strategies", F.period(t.pt),
        esc(F.B(t.pt.y)), t.count ? F.count(t.count.y) + " funds" : "",
        (t.yoy ? esc(F.signed(t.yoy.y, 1, "%")) + " vs the prior twelve months" : "") + (t.rank ? " · " + esc(F.ordinal(t.rank.y)) + (tb ? " of " + tb.strategies.length : "") + " strategies" : ""),
        regime(t.rank ? F.ordinal(t.rank.y) + (lead && lead !== row ? " behind " + lead.strategy.toLowerCase() : " among private strategies") : "Rank not in this edition",
          (lead && lead !== row ? "the leader raised " + esc(F.B(lead.capital)) + " (" + esc(F.signed(lead.yoy, 1, "%")) + "); " : "") +
          (up ? (onlyUp ? "private debt is the only strategy up on the year" : up.length + " of " + tb.strategies.length + " strategies are up on the year") + "; " : "") +
          (t.share ? "private debt is " + esc(F.share(t.share.y)) + " of the private-capital total" + (tb && tb.total ? " of " + esc(F.B(tb.total.capital)) : "") + "." : "")),
        rows(tb ? tb.strategies.slice(0, 3).map(function (r) { return ["<span>" + esc(r.strategy) + "</span>", esc(F.B(r.capital)) + " · " + esc(F.signed(r.yoy, 1, "%"))]; }) : []),
        footer(S, [K.ttm, K.ttmYoy, K.ttmRank, K.ttmShare], tb ? "strategy table " + (tb.title || "") + ", p." + tb.page : "the strategy table is not in this edition")));
    } else out.push(naTile("capTtmRank", "TTM fundraising and rank among strategies", "The series " + K.ttm + " is not in this edition."));
    /* 3. average fund size */
    if (m.avg && m.avg.latest) {
      var a = m.avg, f2 = m.fund || {};
      out.push(tile("capAvgFundSize", "Average fund size closed", halfLabel(F, a.latest),
        esc(F.M(a.latest.y)), "per fund", esc(a.path.map(function (p) { return F.M(p.y) + " (" + halfLabel(F, p) + ")"; }).join(" → ")),
        regime(f2.countDeclines ? f2.countDeclines + " straight annual declines in fund count" : "Fund count steady",
          (f2.paceExtends ? yearOf(f2.ytd.x) + " would be the " + F.ordinal((f2.countDeclines || 0) + 1) + " if the pace holds; " : "") +
          (a.topFive ? "the five largest closes were " + esc(F.pct(a.topFive.y)) + " of capital raised (" + esc(halfLabel(F, a.topFive)) + "): concentration, not retreat." : "concentration, not retreat.")),
        "", footer(S, [K.avgSize, K.topFiveShare], "the half-year average falls as late reporters arrive")));
    } else out.push(naTile("capAvgFundSize", "Average fund size closed", "The derived series " + K.avgSize + " is not in this edition."));
    /* 4. US raised by type */
    if (m.byType && m.byType.latest) {
      var b = m.byType, lo = b.loser, dl = b.types.filter(function (x) { return /direct lending/i.test(x.name); })[0] || null;
      out.push(tile("capRaisedByType", "US private debt raised by type, direct-lending share", F.period(b.latest),
        b.shareLatest ? esc(F.share(b.shareLatest.y)) : "—", "direct lending",
        esc(F.B(b.latest.y)) + " raised, all nine types" + (dl && dl.now ? " · direct lending " + esc(F.B(dl.now.y)) : ""),
        regime(b.shareLatest && b.sharePrior ? (b.shareLatest.y >= b.sharePrior.y ? "Up" : "Down") + " from " + F.share(b.sharePrior.y) + " in " + F.period(b.prior) : "Share",
          (lo && lo.now && lo.then ? esc(lo.name) + " gave up the most share, " + esc(F.B(lo.then.y)) + " → " + esc(F.B(lo.now.y)) + "; " : "") +
          "US fund data by type, a different population from the global report series; the two totals are never set side by side."),
        rows(b.share.filter(function (p) { return p.g === "year"; }).slice(-3).map(function (p) { return ["<span>" + esc(yearOf(p.x)) + "</span>", esc(F.share(p.y))]; })),
        footer(S, [K.usTotal, K.usDlShare])));
    } else out.push(naTile("capRaisedByType", "US private debt raised by type, direct-lending share", "The derived series " + K.usTotal + " is not in this edition."));
    /* 5. AUM */
    if (m.aum && m.aum.last) {
      var au = m.aum;
      out.push(tile("capDlAum", "US direct-lending AUM", F.date(au.last.x),
        esc(F.B(au.last.y)), "", (isNum(au.chg) && au.prior ? esc(F.change(au.chg) + " vs " + yearOf(au.prior.x)) : ""),
        regime(isNum(au.chg) && Math.abs(au.chg) < 0.05 ? "Steady" : isNum(au.chg) && au.chg > 0 ? "Growing" : "Shrinking",
          (au.dp && au.nav ? "dry powder " + esc(F.B(au.dp.y)) + " + NAV " + esc(F.B(au.nav.y)) + "; " : "") + "US direct-lending funds, never set beside global private debt AUM as a level."),
        rows(au.years.slice(-3).map(function (p) { return ["<span>" + esc(yearOf(p.x)) + "</span>", esc(F.B(p.y))]; })),
        footer(S, [K.aum])));
    } else out.push(naTile("capDlAum", "US direct-lending AUM", "The derived series " + K.aum + " is not in this edition."));
    /* 6. dry powder share */
    if (m.aum && m.aum.shareLast) {
      var s6 = m.aum, g = s6.global;
      out.push(tile("capDryPowderShare", "Dry powder share of AUM", F.date(s6.shareLast.x),
        esc(F.share(s6.shareLast.y)), "of US direct-lending AUM",
        (s6.sharePrior ? esc(F.signed((s6.shareLast.y - s6.sharePrior.y) * 100, 1, " pp") + " vs " + yearOf(s6.sharePrior.x)) : "") + (s6.sharePeak ? " · peak " + esc(F.share(s6.sharePeak.y)) + " in " + esc(yearOf(s6.sharePeak.x)) : ""),
        regime(s6.bandLo && s6.bandHi ? "In a " + (s6.bandLo.y * 100).toFixed(0) + "–" + F.share(s6.bandHi.y, 0) + " band over the last " + words(s6.bandYears) + " years" : "Trend",
          (g.share ? "global private debt was " + esc(F.pct(g.share.y)) + " at " + esc(F.date(g.share.x)) + ", 'consistent with previous years' and 'healthy' in the " + esc(g.edition) + " report" : "") +
          (isNum(g.implied) ? "; the newest report's headlines imply " + (g.approx ? "about " : "") + esc(F.share(g.implied, 0)) + " and read the fall as managers deploying" : "") +
          ". US direct lending runs above the global share by population: compare the trend, not the level."),
        "", footer(S, [K.dpShare, K.globalDpShare, K.globalDp, K.globalAum])));
    } else out.push(naTile("capDryPowderShare", "Dry powder share of AUM", "The derived series " + K.dpShare + " is not in this edition."));
    /* 7. CAGR */
    if (m.cagr && m.cagr.ten) {
      var c = m.cagr;
      out.push(tile("capAumCagr", "AUM growth against PE", F.period(c.ten),
        esc(F.share(c.ten.y)), "a year, ten years", c.five ? esc(F.share(c.five.y)) + " a year over five (" + esc(F.period(c.five)) + ")" : "",
        /* "about double" from 1.8× up, so 21.5% against 10.8% (1.99×) reads as the reports read it */
        regime(c.pe ? (c.ten.y * 100 >= c.pe.y * 1.8 ? "About double the PE rate" : c.ten.y * 100 > c.pe.y ? "Above the PE rate" : "Below the PE rate") : "Growth",
          (c.dlReport && c.pe ? "the reports quote direct lending " + esc(F.pct(c.dlReport.y)) + " against PE " + esc(F.pct(c.pe.y)) + " a year (" + esc(F.period(c.pe)) + ")" : "") +
          (c.peAum ? "; PE AUM " + esc(bigB(F, c.peAum.y)) + " at " + esc(F.date(c.peAum.x)) + " is the room-to-grow frame" : "") + "; slowing on the five-year window."),
        "", footer(S, [K.cagr10, K.cagr5, K.dlCagrReport, K.peCagr, K.peAum])));
    } else out.push(naTile("capAumCagr", "AUM growth against PE", "The derived series " + K.cagr10 + " is not in this edition."));
    /* 8. deployment */
    if (m.deploy && m.deploy.ttm) {
      var d = m.deploy;
      out.push(tile("capDeployment", "Deployment, trailing twelve months", F.period(d.ttm),
        esc(F.B(d.ttm.y)), "", (d.last ? esc(F.change(d.ttm.y / d.last.y - 1) + " vs " + yearOf(d.last.x) + " full year") : ""),
        regime(d.last && d.prior ? (d.ttm.y < Math.min(d.last.y, d.prior.y) ? "Below the last two full years" : d.ttm.y > Math.max(d.last.y, d.prior.y) ? "Above the last two full years" : "Between the last two full years") : "Pace",
          (d.last ? esc(yearOf(d.last.x)) + " " + esc(F.B(d.last.y)) : "") + (d.prior ? ", " + esc(yearOf(d.prior.x)) + " " + esc(F.B(d.prior.y)) : "") +
          (isNum(d.ytdChg) ? "; YTD " + esc(F.change(d.ytdChg)) + " on the same months of last year" : "") + ". LCD estimates deal size where it is undisclosed: market volume by every lender, not fund capital called."),
        rows([d.ytd ? ["<span>" + esc(F.period(d.ytd)) + "</span>", esc(F.B(d.ytd.y))] : null, d.ytdPrior ? ["<span>" + esc(F.period(d.ytdPrior)) + "</span>", esc(F.B(d.ytdPrior.y))] : null]),
        footer(S, [K.deployTtm, K.volAnnual])));
    } else out.push(naTile("capDeployment", "Deployment, trailing twelve months", "The derived series " + K.deployTtm + " is not in this edition."));
    /* 9. years of dry powder */
    if (m.years && m.years.ttm) {
      var y = m.years, dpDate = y.ttm.dryPowderAsOf || (m.aum && m.aum.last ? m.aum.last.x : null);
      out.push(tile("capYearsDryPowder", "Years of dry powder", F.period(y.ttm),
        esc(F.years(y.ttm.y)), "years", (y.peak ? "from " + esc(F.years(y.peak.y)) + " in " + esc(yearOf(y.peak.x)) + " (calendar variant)" : ""),
        regime(y.peak && y.ttm.y < y.peak.y ? "Falling: capital is being deployed" : "Rising: capital is piling up",
          "the 2021 report's test. Dry powder at " + esc(F.date(dpDate)) + " over LCD volume for the twelve months to " + esc(F.date(y.ttm.x)) +
          ": different universes and mixed dates, so direction, not level; the fund-side cross-check is the capital-call tile."),
        rows(y.cal.slice(-3).map(function (p) { return ["<span>" + esc(yearOf(p.x)) + "</span>", esc(F.years(p.y)) + " years"]; })),
        footer(S, [K.yearsTtm, K.yearsCal, K.dryPowder])));
    } else out.push(naTile("capYearsDryPowder", "Years of dry powder", "The derived series " + K.yearsTtm + " is not in this edition."));
    /* 10. fundraising minus deployment */
    if (m.gap && m.gap.last) {
      var gp = m.gap;
      out.push(tile("capFundMinusDeploy", "Fundraising minus deployment", yearOf(gp.last.x),
        esc(F.B(gp.last.y)), "", (gp.raised && gp.deployed ? esc(F.B(gp.raised.y)) + " raised against " + esc(F.B(gp.deployed.y)) + " lent" : ""),
        regime(gp.last.y < 0 ? "Deploying faster than funds close" : "Capital arriving faster than it is lent",
          (gp.flip && gp.flip !== gp.last ? "the sign turned " + (gp.last.y < 0 ? "negative" : "positive") + " in " + esc(yearOf(gp.flip.x)) : "") +
          (gp.before ? " after " + esc(signedB(F, gp.before.y)) + " in " + esc(yearOf(gp.before.x)) : "") +
          (gp.dlLast ? "; the direct-lending-only variant is " + esc(F.B(gp.dlLast.y)) : "") + ". A supply-demand sign, not a shortage: BDC, evergreen and insurance capital sit outside the drawdown universe."),
        rows(gp.years.slice(-3).map(function (p) { return ["<span>" + esc(yearOf(p.x)) + "</span>", esc(signedB(F, p.y))]; })),
        footer(S, [K.gap, K.gapDl])));
    } else out.push(naTile("capFundMinusDeploy", "Fundraising minus deployment", "The derived series " + K.gap + " is not in this edition."));
    /* 11. LBO financing */
    if (m.lbo && m.lbo.last) {
      var lb = m.lbo;
      out.push(tile("capLboFinancing", "LBO financing, both channels", F.quarter(lb.last.x),
        esc(F.B(lb.last.lbo)), "per quarter", (lb.prior ? esc(F.change(lb.ratio - 1) + " vs " + F.quarter(lb.prior.x) + " (" + F.B(lb.prior.lbo) + ")") : ""),
        regime(isNum(lb.deployRatio) && isNum(lb.ratio) && Math.sign(lb.deployRatio - 1) === Math.sign(lb.ratio - 1) ? "Deployment moved with it" : "Deployment diverged",
          (isNum(lb.last.deploy) && lb.prior && isNum(lb.prior.deploy) ? "direct-lending deployment " + esc(F.B(lb.prior.deploy)) + " → " + esc(F.B(lb.last.deploy)) + " over the same quarters; " : "") +
          "direct lending " + esc(F.B(lb.last.dl)) + " + BSL " + esc(F.B(lb.last.bsl)) + ", summed at render. The reports' 'strongly linked to PE LBO deal value'."),
        rows([lb.rolling ? ["<span>" + esc(F.period(lb.rolling)) + "</span>", esc(F.B(lb.rolling.lbo)) + " · deployed " + esc(F.B(lb.rolling.deploy)) + " " + flag("overlaps " + lb.overlap)] : null]),
        footer(S, [K.dlLboQ, K.bslLboQ, K.volQ], null, bothChannels(S))));
    } else out.push(naTile("capLboFinancing", "LBO financing, both channels", "The series " + K.dlLboQ + " and " + K.bslLboQ + " are not both in this edition."));
    /* 12. capital-call rate */
    if (m.call && m.call.pt) {
      var cr = m.call;
      out.push(tile("capCallRate", "Capital-call rate, cross-check", F.period(cr.pt),
        esc(F.pct(cr.pt.y)), "of beginning dry powder", esc("about " + F.years(cr.runway, 1) + " years of fund-side runway (1 ÷ rate)") + " " + flag((cr.geography || "US") + (cr.provisional ? ", preliminary" : "")),
        regime(cr.slowest ? "Slowest call pace of the strategies shown" : cr.faster.length ? "Slower than " + listOf(cr.faster.map(function (p) { return p.name; })) : "Fastest call pace of the strategies shown",
          (cr.slower.length ? "only " + esc(listOf(cr.slower.map(function (p) { return p.name; }))) + " calls more slowly; " : "") +
          (cr.peers.length ? cr.peers.map(function (p) { return esc(p.name) + " " + esc(F.pct(p.v)); }).join(", ") + "; " : "") +
          "a fund-level rate, so it explains why the LCD-basis years of dry powder understates fund runway. " + esc(cr.geography || "US") + " and preliminary, never labeled global."),
        "", footer(S, [K.callPd, K.callPe, K.callVc, K.callRa, K.callRe])));
    } else out.push(naTile("capCallRate", "Capital-call rate, cross-check", "The series " + K.callPd + " is not in this edition."));
    return out.join("");
  }

  /* ---------- Chart.js ---------- */
  var HATCH = null;
  function hatch(color) {
    var c = document.createElement("canvas"); c.width = 8; c.height = 8;
    var g = c.getContext("2d");
    g.strokeStyle = color; g.lineWidth = 1.6;
    [[0, 8, 8, 0], [-2, 2, 2, -2], [6, 10, 10, 6]].forEach(function (l) { g.beginPath(); g.moveTo(l[0], l[1]); g.lineTo(l[2], l[3]); g.stroke(); });
    return g.createPattern(c, "repeat");
  }
  /* the page's options with category labels shown as they are, a
     per-dataset formatter in the tooltip and an optional right axis */
  function options(ctx, labels, yfmt, unitLabel, cfg) {
    cfg = cfg || {};
    var o = ctx.chart.baseOptions(labels, yfmt, unitLabel);
    var horizontal = cfg.indexAxis === "y";
    if (horizontal) {
      o.indexAxis = "y";
      o.scales = { x: { grid: { color: COLORS.grid }, border: { display: false }, ticks: { color: COLORS.ink, font: { family: MONO, size: 10 }, maxTicksLimit: 6, callback: function (v) { return yfmt(v); } },
          title: unitLabel ? { display: true, text: unitLabel, color: COLORS.ink, font: { family: MONO, size: 10 } } : { display: false } },
        y: { grid: { display: false }, border: { color: COLORS.grid }, ticks: { color: COLORS.line2, font: { family: MONO, size: 10.5 }, autoSkip: false } } };
    } else {
      /* every Nth label by the chart's width, and the last label always,
         so a TTM or half-year slot is never the one autoSkip drops */
      o.scales.x.ticks.callback = function (v, i) {
        var n = labels.length, w = this.chart ? this.chart.width : 600;
        var step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(w / 72))));
        if (i === n - 1) return labels[i];
        return i % step === 0 && (n - 1 - i) >= Math.ceil(step / 2) ? labels[i] : null;
      };
      o.scales.x.ticks.autoSkip = false;
      o.scales.x.ticks.maxRotation = 0;
      o.scales.x.stacked = !!cfg.stacked; o.scales.y.stacked = !!cfg.stacked;
      if (cfg.y2) {
        o.scales.y2 = { position: "right", grid: { drawOnChartArea: false }, border: { display: false },
          min: cfg.y2.min, max: cfg.y2.max, beginAtZero: cfg.y2.beginAtZero,
          ticks: { color: COLORS.ink, font: { family: MONO, size: 10 }, maxTicksLimit: 6, callback: function (v) { return cfg.y2.fmt(v); } },
          title: cfg.y2.label ? { display: true, text: cfg.y2.label, color: COLORS.ink, font: { family: MONO, size: 10 } } : { display: false } };
      }
      if (cfg.yMin !== undefined) o.scales.y.min = cfg.yMin;
      if (cfg.yMax !== undefined) o.scales.y.max = cfg.yMax;
    }
    o.plugins.tooltip.callbacks.title = function (items) { return items.length ? (cfg.titles ? cfg.titles[items[0].dataIndex] : labels[items[0].dataIndex]) : ""; };
    o.plugins.tooltip.callbacks.label = function (item) {
      var val = horizontal ? item.parsed.x : item.parsed.y, f = item.dataset.fmt || yfmt;
      var note = item.dataset.notes && item.dataset.notes[item.dataIndex] ? " " + item.dataset.notes[item.dataIndex] : "";
      return " " + item.dataset.label + " " + (isNum(val) ? f(val) : "—") + note;
    };
    return o;
  }
  /* a dashed horizontal rule with a label, on the named axis; the label
     sits on a small plate of the chart's ground so it stays readable
     where a bar at or above the rule runs under it */
  var PLATE = "rgba(22,24,28,.88)";
  function ruleLine(axis, value, label, color, solid, align) {
    return { id: "capRule_" + axis + "_" + value, afterDatasetsDraw: function (chart) {
      var sc = chart.scales[axis], area = chart.chartArea, g = chart.ctx;
      if (!sc || !area) return;
      var py = sc.getPixelForValue(value);
      if (py < area.top - 1 || py > area.bottom + 1) return;
      g.save(); g.strokeStyle = color; g.lineWidth = 1; if (!solid) g.setLineDash([5, 4]);
      g.beginPath(); g.moveTo(area.left, py); g.lineTo(area.right, py); g.stroke();
      if (label) {
        g.setLineDash([]); g.font = "10px " + MONO; g.textBaseline = "bottom";
        var w = g.measureText(label).width, x = align === "left" ? area.left + 4 : area.right - 4 - w;
        g.fillStyle = PLATE; g.fillRect(x - 3, py - 15, w + 6, 13);
        g.fillStyle = color; g.textAlign = "left"; g.fillText(label, x, py - 3);
      }
      g.restore();
    } };
  }
  /* a shaded band between two values on the named axis, drawn behind the data */
  function bandPlugin(axis, lo, hi, label) {
    return { id: "capBand_" + axis, beforeDatasetsDraw: function (chart) {
      var sc = chart.scales[axis], area = chart.chartArea, g = chart.ctx;
      if (!sc || !area) return;
      var y1 = sc.getPixelForValue(hi), y2 = sc.getPixelForValue(lo);
      var top = Math.max(area.top, Math.min(y1, y2)), bottom = Math.min(area.bottom, Math.max(y1, y2));
      if (bottom <= top) return;
      g.save(); g.fillStyle = COLORS.band; g.fillRect(area.left, top, area.right - area.left, bottom - top);
      if (label) { g.fillStyle = COLORS.ink; g.font = "10px " + MONO; g.textAlign = "left"; g.textBaseline = "bottom"; g.fillText(label, area.left + 4, top - 2); }
      g.restore();
    } };
  }
  /* a label at the end of every bar of dataset 0 (the horizontal C2) */
  function barEndLabels(texts) {
    return { id: "capBarLabels", afterDatasetsDraw: function (chart) {
      var meta = chart.getDatasetMeta(0), g = chart.ctx, area = chart.chartArea;
      if (!meta || !meta.data) return;
      g.save(); g.font = "10.5px " + MONO; g.textBaseline = "middle"; g.fillStyle = COLORS.line2;
      meta.data.forEach(function (el, i) {
        var t = texts[i]; if (!t) return;
        var w = g.measureText(t).width;
        var inside = el.x + 6 + w > area.right;
        g.textAlign = inside ? "right" : "left";
        g.fillStyle = inside ? "#151515" : COLORS.line2;
        g.fillText(t, inside ? el.x - 6 : el.x + 6, el.y);
      });
      g.restore();
    } };
  }
  function legendHtml(items) {
    return items.map(function (it) {
      return "<span><i style='background:" + it.color + "'" + (it.dash ? " class='dash'" : "") + (it.hollow ? " class='hollow'" : "") + "></i>" + esc(it.label) + "</span>";
    }).join("");
  }
  function chartBlock(id, key, title, aria) {
    return "<div class='cap-chart' data-chart='" + esc(id) + "'>" +
      "<h3><span class='h-pop' data-metric='" + esc(key) + "'>" + esc(title) + "</span></h3>" +
      "<div class='chart-controls'><span class='chart-legend' id='cap-" + id + "-legend' data-no-terms></span></div>" +
      "<div class='chart-box' id='cap-" + id + "-chart'><canvas id='cap-" + id + "-canvas' role='img' aria-label='" + esc(aria) + "'></canvas></div>" +
      "<p class='chart-caption' id='cap-" + id + "-caption'></p>" +
      "<div id='cap-" + id + "-foot'></div></div>";
  }
  function setCaption(root, id, text) { var el = root.querySelector("#cap-" + id + "-caption"); if (el) el.textContent = text || ""; }
  function setFoot(root, id, html) { var el = root.querySelector("#cap-" + id + "-foot"); if (el) el.innerHTML = html || ""; }
  function setLegend(root, id, items) { var el = root.querySelector("#cap-" + id + "-legend"); if (el) el.innerHTML = legendHtml(items); }
  /* the Chart.js instances drawn by the last mount: the section replaces
     its canvases through innerHTML on a Refresh, so each is destroyed
     here first (an orphaned chart keeps a document-wide observer) */
  var LIVE = [];
  function destroyLive() {
    LIVE.forEach(function (ch) { try { ch.destroy(); } catch (e) { /* already gone with its canvas */ } });
    LIVE = [];
  }
  function draw(ctx, root, id, config) {
    var canvas = root.querySelector("#cap-" + id + "-canvas"), host = root.querySelector("#cap-" + id + "-chart");
    if (!canvas || !ctx.Chart) { ctx.chart.empty(host, "The chart library did not load; the caption and footer below carry the figures."); return null; }
    ctx.chart.empty(host, null);
    var ch = ctx.chart.make(canvas, config);
    if (ch) LIVE.push(ch);
    return ch;
  }
  function empty(ctx, root, id, msg) {
    var host = root.querySelector("#cap-" + id + "-chart");
    ctx.chart.empty(host, msg);
  }
  var fmtB0 = null, fmtB1 = null, fmtPct = null, fmtCount = null, fmtYears = null;

  function renderCharts(ctx, root, S, m) {
    var F = S.fmt;
    fmtB0 = function (v) { return isNum(v) ? (v < 0 ? "−" : "") + "$" + F.withCommas(Math.abs(v).toFixed(0)) + "B" : "—"; };
    fmtB1 = function (v) { return F.B(v); };
    fmtPct = function (v) { return isNum(v) ? v.toFixed(0) + "%" : "—"; };
    fmtCount = function (v) { return F.count(v); };
    fmtYears = function (v) { return isNum(v) ? v.toFixed(2) : "—"; };
    if (!HATCH) HATCH = hatch(COLORS.gold);

    /* C1 */
    if (m.fund && m.fund.last) {
      var f = m.fund, pts = f.years.slice(), labels = pts.map(function (p) { return yearOf(p.x); });
      var caps = pts.map(function (p) { return p.y; }), counts = pts.map(function (p) { var c = f.countBy[yearOf(p.x)]; return c ? c.y : null; });
      var notes = pts.map(function () { return ""; });
      if (f.ytd) { labels.push(f.halfLabel); caps.push(f.ytd.y); counts.push(f.ytdCount ? f.ytdCount.y : null); notes.push(f.provisional ? "(provisional, half-year)" : "(half-year)"); }
      var colors = caps.map(function (_, i) { return f.ytd && i === caps.length - 1 && f.provisional ? HATCH : COLORS.gold; });
      draw(ctx, root, "c1", { type: "bar", data: { labels: labels, datasets: [
        { label: "Capital raised", data: caps, backgroundColor: colors, borderColor: COLORS.gold, borderWidth: 1, yAxisID: "y", fmt: fmtB1, notes: notes, order: 2 },
        { type: "line", label: "Fund count", data: counts, borderColor: COLORS.line2, backgroundColor: COLORS.line2, borderWidth: 2, pointRadius: 3, tension: 0, yAxisID: "y2", fmt: fmtCount, order: 1 }
      ] }, options: options(ctx, labels, fmtB0, "$B raised", { y2: { fmt: fmtCount, label: "funds closed", beginAtZero: true } }),
        plugins: [ruleLine("y", RULE_200, "$" + RULE_200 + "B rule", "rgba(245,197,24,.55)", false, "left")] });
      setLegend(root, "c1", [{ color: COLORS.gold, label: "Capital raised ($B)" }, { color: COLORS.line2, label: "Fund count" }, { color: COLORS.gold, hollow: true, label: "hatched: provisional half-year" }]);
      setCaption(root, "c1", CAPTIONS.c1.template({ year: yearOf(f.last.x), capital: F.B(f.last.y), count: F.count(f.lastCount), chg: F.change(f.chg), prior: f.prior ? yearOf(f.prior.x) : "—",
        run: F.ordinal(f.run), half: f.halfLabel, h1: f.ytd ? F.B(f.ytd.y) : "—", share: F.share(f.shareOfLast), annual: F.B(f.annualized) }));
      setFoot(root, "c1", footer(S, [m.capKey, m.countKey], "the dashed rule is the reports' $" + RULE_200 + "B line"));
    } else { empty(ctx, root, "c1", "Private debt fundraising is not in this edition: series " + m.capKey + "."); setFoot(root, "c1", footer(S, [m.capKey])); }

    /* C2 */
    if (m.ttm && m.ttm.table && m.ttm.table.strategies.length) {
      var tb = m.ttm.table, row = pdRow(tb, m.ttm.pt);
      var sLabels = tb.strategies.map(function (r) { return r.strategy; });
      var yoyTexts = tb.strategies.map(function (r) { return isNum(r.yoy) ? F.signed(r.yoy, 1, "%") : ""; });
      draw(ctx, root, "c2", { type: "bar", data: { labels: sLabels, datasets: [
        { label: "TTM capital raised", data: tb.strategies.map(function (r) { return r.capital; }), backgroundColor: tb.strategies.map(function (r) { return r === row ? COLORS.gold : COLORS.bar; }),
          fmt: fmtB1, notes: tb.strategies.map(function (r) { return "· YoY " + F.signed(r.yoy, 1, "%") + (isNum(r.count) ? " · " + F.count(r.count) + " funds" : ""); }) }
      ] }, options: options(ctx, sLabels, fmtB0, "$B, trailing twelve months", { indexAxis: "y" }), plugins: [barEndLabels(yoyTexts)] });
      setLegend(root, "c2", [{ color: COLORS.gold, label: "Private debt" }, { color: COLORS.bar, label: "Other private strategies" }, { color: COLORS.line2, label: "label: YoY change in TTM capital" }]);
      var lead = tb.strategies[0], up = tb.strategies.filter(function (r) { return r.yoy > 0; });
      setCaption(root, "c2", CAPTIONS.c2.template({ ttm: F.B(m.ttm.pt.y), to: F.date(m.ttm.pt.x), rank: m.ttm.rank ? F.ordinal(m.ttm.rank.y) : (row ? F.ordinal(tb.strategies.indexOf(row) + 1) : "—"), n: String(tb.strategies.length),
        leader: lead === row ? "every other strategy" : lead.strategy.toLowerCase(), leaderVal: F.B(lead.capital), onlyUp: up.length === 1 && up[0] === row, yoy: F.signed(row ? row.yoy : (m.ttm.yoy ? m.ttm.yoy.y : null), 1, "%"),
        share: m.ttm.share ? F.share(m.ttm.share.y) : "—", total: tb.total ? F.B(tb.total.capital) : "—" }));
      setFoot(root, "c2", footer(S, [K.ttm, K.ttmRank, K.ttmShare], (tb.title || "strategy table") + ", p." + tb.page + (tb.doc ? ", " + tb.doc : "") + "; the private-capital total row is excluded"));
    } else { empty(ctx, root, "c2", "The strategy table is not in this edition (" + STRATEGY_TABLE + "<edition>.json), so the league table is not drawn."); setFoot(root, "c2", footer(S, [K.ttm, K.ttmRank])); }

    /* C3 */
    if (m.byType && m.byType.latest) {
      var b = m.byType, periods = b.total.map(function (p) { return p; });
      var tLabels = periods.map(function (p) { return p.g === "year" ? yearOf(p.x) : ttmShort(F, p); });
      var tTitles = periods.map(function (p) { return F.period(p); });
      var gi = 0;
      var sets = b.types.map(function (t) {
        var isDl = /direct lending/i.test(t.name);
        var color = isDl ? COLORS.gold : COLORS.ramp[gi++ % COLORS.ramp.length];
        var by = {}; t.points.forEach(function (p) { by[p.x + "|" + p.g] = p.y; });
        return { label: t.name, data: periods.map(function (p) { var v = by[p.x + "|" + p.g]; return isNum(v) ? v : 0; }), backgroundColor: color, stack: "raised", yAxisID: "y", fmt: fmtB1, order: 2, isDl: isDl };
      });
      /* direct lending on top of the stack, then the rest by size of the latest bar */
      sets.sort(function (a, c) { return (c.isDl ? 1 : 0) - (a.isDl ? 1 : 0) || c.data[c.data.length - 1] - a.data[a.data.length - 1]; });
      var shareBy = {}; b.share.forEach(function (p) { shareBy[p.x + "|" + p.g] = p.y * 100; });
      sets.push({ type: "line", label: "Direct-lending share", data: periods.map(function (p) { var v = shareBy[p.x + "|" + p.g]; return isNum(v) ? v : null; }), borderColor: COLORS.line2, backgroundColor: COLORS.line2, borderWidth: 2, pointRadius: 2.5, tension: 0, yAxisID: "y2", fmt: fmtPct, order: 1 });
      draw(ctx, root, "c3", { type: "bar", data: { labels: tLabels, datasets: sets }, options: options(ctx, tLabels, fmtB0, "$B raised, US", { stacked: true, titles: tTitles, y2: { fmt: fmtPct, label: "direct-lending share", min: 0, max: 100 } }) });
      setLegend(root, "c3", sets.filter(function (s) { return s.type !== "line"; }).map(function (s) { return { color: s.backgroundColor, label: s.label }; }).concat([{ color: COLORS.line2, label: "Direct-lending share (right axis)" }]));
      var lo = b.loser;
      setCaption(root, "c3", CAPTIONS.c3.template({ dlShare: b.shareLatest ? F.share(b.shareLatest.y) : "—", total: F.B(b.latest.y), period: b.latest.g === "year" ? yearOf(b.latest.x) : "the " + F.period(b.latest),
        dir: b.shareLatest && b.sharePrior ? (b.shareLatest.y >= b.sharePrior.y ? "up" : "down") : "—", prior: b.sharePrior ? F.share(b.sharePrior.y) : "—", priorPeriod: b.prior ? F.period(b.prior) : "—",
        loser: lo ? lo.name.toLowerCase() : "no type", loserNow: lo && lo.now ? F.B(lo.now.y) : "—", loserThen: lo && lo.then ? F.B(lo.then.y) : "—" }));
      setFoot(root, "c3", footer(S, [K.usTotal, K.usDlShare].concat(b.typeKeys), "the TTM bar is a rolling window, never summed with the years"));
    } else { empty(ctx, root, "c3", "US private debt raised by type is not in this edition: series " + K.usTotal + "."); setFoot(root, "c3", footer(S, [K.usTotal])); }

    /* C4 */
    if (m.aum && m.aum.last) {
      var au = m.aum, aLabels = au.years.map(function (p) { return yearOf(p.x); });
      var dpData = au.years.map(function (p) { var q = au.dpBy[yearOf(p.x)]; return q ? q.y : null; });
      var navData = au.years.map(function (p) { var q = au.navBy[yearOf(p.x)]; return q ? q.y : null; });
      var shData = au.years.map(function (p) { var q = au.shareBy[yearOf(p.x)]; return q ? q.y * 100 : null; });
      var g = au.global, refs = [];
      if (g.share) refs.push(g.share.y);
      if (isNum(g.implied)) refs.push(g.implied * 100);
      var plugins = [];
      if (refs.length) {
        var lo4 = Math.min.apply(null, refs), hi4 = Math.max.apply(null, refs);
        if (refs.length === 1) { lo4 -= 1; hi4 += 1; }
        plugins.push(bandPlugin("y2", lo4, hi4, "global private debt " + fmtPct(lo4) + (refs.length > 1 ? "–" + fmtPct(hi4) : "")));
      }
      draw(ctx, root, "c4", { type: "bar", data: { labels: aLabels, datasets: [
        { label: "Dry powder", data: dpData, backgroundColor: COLORS.gold, stack: "aum", yAxisID: "y", fmt: fmtB1, order: 2 },
        { label: "NAV", data: navData, backgroundColor: COLORS.bar, stack: "aum", yAxisID: "y", fmt: fmtB1, order: 2 },
        { type: "line", label: "Dry powder share of AUM", data: shData, borderColor: COLORS.line2, backgroundColor: COLORS.line2, borderWidth: 2, pointRadius: 2.5, tension: 0, yAxisID: "y2", fmt: fmtPct, order: 1 }
      ] }, options: options(ctx, aLabels, fmtB0, "$B, US direct lending", { stacked: true, y2: { fmt: fmtPct, label: "dry powder share", min: 0, max: 100 } }), plugins: plugins });
      setLegend(root, "c4", [{ color: COLORS.gold, label: "Dry powder ($B)" }, { color: COLORS.bar, label: "NAV ($B)" }, { color: COLORS.line2, label: "Dry powder share (right axis)" }, { color: COLORS.band, label: "band: global private debt references" }]);
      setCaption(root, "c4", CAPTIONS.c4.template({ aum: F.B(au.last.y), date: F.date(au.last.x), dp: au.dp ? F.B(au.dp.y) : "—", nav: au.nav ? F.B(au.nav.y) : "—", chg: F.change(au.chg),
        share: au.shareLast ? F.share(au.shareLast.y) : "—", bandLo: au.bandLo ? (au.bandLo.y * 100).toFixed(0) : "—", bandHi: au.bandHi ? F.share(au.bandHi.y, 0) : "—", bandYears: words(au.bandYears),
        norm: g.share ? F.pct(g.share.y) : "—", normEd: g.edition || "annual" }));
      setFoot(root, "c4", footer(S, [K.dryPowder, K.nav, K.dpShare, K.globalDpShare, K.globalDp, K.globalAum], "the band spans the global references, a different population"));
    } else { empty(ctx, root, "c4", "US direct-lending AUM is not in this edition: series " + K.aum + "."); setFoot(root, "c4", footer(S, [K.aum])); }

    /* C5 */
    if (m.years && m.deploy && m.aum && (m.years.cal.length || m.years.ttm)) {
      var y5 = m.years, d5 = m.deploy;
      var yrs5 = y5.cal.map(function (p) { return yearOf(p.x); });
      var vol5 = yrs5.map(function (yr) { var q = d5.volBy[yr]; return q ? q.y : null; });
      var dp5 = yrs5.map(function (yr) { var q = m.aum.dpBy[yr]; return q ? q.y : null; });
      var ratio5 = y5.cal.map(function (p) { return p.y; });
      var l5 = yrs5.slice(), notes5 = yrs5.map(function () { return ""; }), hatch5 = yrs5.map(function () { return COLORS.gold; });
      var dpHeld = null;
      if (y5.ttm && d5.ttm) {
        dpHeld = y5.ttm.dryPowderAsOf && m.aum.dpBy[yearOf(y5.ttm.dryPowderAsOf)] ? m.aum.dpBy[yearOf(y5.ttm.dryPowderAsOf)] : m.aum.dp;
        l5.push(ttmShort(F, y5.ttm)); vol5.push(d5.ttm.y); dp5.push(dpHeld ? dpHeld.y : null); ratio5.push(y5.ttm.y);
        notes5.push(dpHeld ? "(held at " + F.date(dpHeld.x) + ")" : ""); hatch5.push(HATCH);
      }
      draw(ctx, root, "c5", { type: "bar", data: { labels: l5, datasets: [
        { label: "Direct-lending volume", data: vol5, backgroundColor: COLORS.bar, yAxisID: "y", fmt: fmtB1, order: 2 },
        { label: "Dry powder", data: dp5, backgroundColor: hatch5, borderColor: COLORS.gold, borderWidth: 1, yAxisID: "y", fmt: fmtB1, notes: notes5, order: 2 },
        { type: "line", label: "Years of dry powder", data: ratio5, borderColor: COLORS.line2, backgroundColor: COLORS.line2, borderWidth: 2, pointRadius: 3, tension: 0, yAxisID: "y2", fmt: fmtYears, order: 1 }
      ] }, options: options(ctx, l5, fmtB0, "$B", { y2: { fmt: fmtYears, label: "years", beginAtZero: true } }) });
      setLegend(root, "c5", [{ color: COLORS.bar, label: "Direct-lending volume ($B)" }, { color: COLORS.gold, label: "Dry powder ($B)" }, { color: COLORS.line2, label: "Years of dry powder (right axis)" }, { color: COLORS.gold, hollow: true, label: "hatched: dry powder held at the latest year-end" }]);
      if (y5.ttm && d5.ttm) {
        setCaption(root, "c5", CAPTIONS.c5.template({ years: F.years(y5.ttm.y), dp: dpHeld ? F.B(dpHeld.y) : "—", dpDate: F.date(y5.ttm.dryPowderAsOf || (dpHeld ? dpHeld.x : null)), vol: F.B(d5.ttm.y), volDate: F.date(d5.ttm.x),
          dir: y5.peak && y5.ttm.y < y5.peak.y ? "down" : "up", peak: y5.peak ? F.years(y5.peak.y) : "—", peakYear: y5.peak ? yearOf(y5.peak.x) : "—" }));
      } else {
        var lc = last(y5.cal);
        setCaption(root, "c5", lc ? "Calendar variant only: " + F.years(lc.y) + " years in " + yearOf(lc.x) + "; the trailing-twelve-month ratio is not in this edition." : "");
      }
      setFoot(root, "c5", footer(S, [K.yearsTtm, K.yearsCal, K.dryPowder, K.volAnnual], "direction only: fund data against every lender, mixed dates on the last slot"));
    } else { empty(ctx, root, "c5", "Years of dry powder is not in this edition: series " + K.yearsCal + "."); setFoot(root, "c5", footer(S, [K.yearsCal])); }

    /* C6 */
    if (m.gap && m.gap.last) {
      var gp = m.gap, gLabels = gp.years.map(function (p) { return yearOf(p.x); });
      draw(ctx, root, "c6", { type: "bar", data: { labels: gLabels, datasets: [
        { label: "Raised minus lent", data: gp.years.map(function (p) { return p.y; }), backgroundColor: COLORS.gold, fmt: fmtB1, order: 2 },
        { label: "Direct-lending-only variant", data: gLabels.map(function (yr) { var q = gp.dlBy[yr]; return q ? q.y : null; }), backgroundColor: "rgba(0,0,0,0)", borderColor: COLORS.line2, borderWidth: 1.5, fmt: fmtB1, order: 1 }
      ] }, options: options(ctx, gLabels, fmtB0, "$B, same calendar year"), plugins: [ruleLine("y", 0, "", COLORS.line2, true)] });
      setLegend(root, "c6", [{ color: COLORS.gold, label: "US private debt raised − direct-lending volume" }, { color: COLORS.line2, hollow: true, label: "Direct lending raised − volume (outline)" }]);
      setCaption(root, "c6", CAPTIONS.c6.template({ raised: gp.raised ? F.B(gp.raised.y) : "—", year: yearOf(gp.last.x), deployed: gp.deployed ? F.B(gp.deployed.y) : "—", gap: F.B(gp.last.y),
        sign: gp.last.y < 0 ? "negative" : "positive", flipYear: gp.flip ? yearOf(gp.flip.x) : "—", before: gp.before ? signedB(F, gp.before.y) : "—", beforeYear: gp.before ? yearOf(gp.before.x) : "—" }));
      setFoot(root, "c6", footer(S, [K.gap, K.gapDl, K.usTotal, K.volAnnual]));
    } else { empty(ctx, root, "c6", "Fundraising minus deployment is not in this edition: series " + K.gap + "."); setFoot(root, "c6", footer(S, [K.gap])); }

    /* C7 */
    if (m.lbo && m.lbo.rows.length) {
      var lb = m.lbo, rws = lb.rows, rollIdx = lb.rolling ? rws.indexOf(lb.rolling) : -1;
      var qLabels = rws.map(function (r) { return r.g === "quarter" ? F.quarterDeck(r.x) : F.period(r); });
      var qTitles = rws.map(function (r) { return r.g === "quarter" ? F.quarter(r.x) : F.period(r) + " (overlaps " + lb.overlap + ")"; });
      var hollow = function (color) { return { pointRadius: rws.map(function (r, i) { return i === rollIdx ? 5 : 0; }), pointHoverRadius: 6, pointBackgroundColor: rws.map(function (r, i) { return i === rollIdx ? "#16181c" : color; }), pointBorderColor: color, pointBorderWidth: 2 }; };
      var dashInto = function (c) { return rollIdx >= 0 && c.p1DataIndex === rollIdx ? [4, 4] : undefined; };
      var dsA = { label: "Direct-lending volume, all borrowers", data: rws.map(function (r) { return r.deploy; }), borderColor: COLORS.gold, backgroundColor: COLORS.gold, borderWidth: 2, tension: 0, spanGaps: true, fmt: fmtB1, segment: { borderDash: dashInto } };
      var dsB = { label: "LBO financing, both channels", data: rws.map(function (r) { return r.lbo; }), borderColor: COLORS.line2, backgroundColor: COLORS.line2, borderWidth: 2, borderDash: [5, 4], tension: 0, spanGaps: true, fmt: fmtB1 };
      var hA = hollow(COLORS.gold), hB = hollow(COLORS.line2);
      Object.keys(hA).forEach(function (k) { dsA[k] = hA[k]; dsB[k] = hB[k]; });
      draw(ctx, root, "c7", { type: "line", data: { labels: qLabels, datasets: [dsA, dsB] }, options: options(ctx, qLabels, fmtB0, "$B per quarter", { titles: qTitles }) });
      setLegend(root, "c7", [{ color: COLORS.gold, label: "Direct-lending volume, all borrowers" }, { color: COLORS.line2, dash: true, label: "LBO financing: direct lending + BSL" }, { color: COLORS.gold, hollow: true, label: "hollow: last three months, overlaps " + lb.overlap }]);
      if (lb.rolling && lb.last && lb.prior) {
        setCaption(root, "c7", CAPTIONS.c7.template({ dl: F.B(lb.rolling.deploy), window: F.period(lb.rolling), lbo: F.B(lb.rolling.lbo), q1: F.quarter(lb.prior.x), dlq1: F.B(lb.prior.deploy), lboq1: F.B(lb.prior.lbo),
          q2: F.quarter(lb.last.x), dlq2: F.B(lb.last.deploy), lboq2: F.B(lb.last.lbo), overlap: lb.overlap }));
      } else if (lb.last) {
        setCaption(root, "c7", "Direct lending deployed " + F.B(lb.last.deploy) + " in " + F.quarter(lb.last.x) + " against " + F.B(lb.last.lbo) + " of LBO financing across both channels; the rolling three-month point is not in this edition.");
      }
      setFoot(root, "c7", footer(S, [K.volQ, K.dlLboQ, K.bslLboQ], "LBO financing is summed at render; the rolling point is never summed with the quarters", (S.get(K.volQ) && S.get(K.volQ).population ? firstClause(S.get(K.volQ).population) + "; LBO financing: " : "") + (bothChannels(S) || "")));
    } else { empty(ctx, root, "c7", "Deployment against LBO financing is not in this edition: series " + K.volQ + ", " + K.dlLboQ + ", " + K.bslLboQ + "."); setFoot(root, "c7", footer(S, [K.volQ])); }
  }

  /* the workbook's rows: one hidden table the page's export picks up */
  function exportTable(S, m) {
    var F = S.fmt, keys = drawnKeys(m).filter(function (k) { return S.has(k); });
    var rows = ["<tr><th>Series</th><th>Label</th><th>Period</th><th>Grain</th><th>Value</th><th>Unit</th><th>Population</th><th>Edition</th></tr>"];
    keys.forEach(function (k) {
      var e = S.get(k);
      S.pointsOf(k, { withLabels: true }).forEach(function (p) {
        rows.push("<tr><td>" + esc(k) + "</td><td>" + esc(e.label) + "</td><td>" + esc(F.period(p)) + "</td><td>" + esc(p.g) + "</td><td>" + esc(isNum(p.y) ? String(p.y) : "") +
          "</td><td>" + esc(e.unit) + "</td><td>" + esc(firstClause(e.population)) + "</td><td>" + esc(e.edition || e.vintage || "") + "</td></tr>");
      });
    });
    /* data-no-terms: the export rows are data, not prose, so the term
       wrapper leaves their unit cells alone */
    return "<div class='export-tables' hidden data-no-terms><table class='grid' id='t-capital' data-export-name='Capital series'>" + rows.join("") + "</table></div>";
  }
  function drawnKeys(m) {
    var ks = [];
    Object.keys(K).forEach(function (n) { ks.push(K[n]); });
    if (m && m.capKey && ks.indexOf(m.capKey) < 0) ks.push(m.capKey);
    if (m && m.countKey && ks.indexOf(m.countKey) < 0) ks.push(m.countKey);
    if (m && m.byType) m.byType.typeKeys.forEach(function (k) { if (ks.indexOf(k) < 0) ks.push(k); });
    return ks;
  }
  /* every series id printed in a footer gets a popup built from the
     loader's own metadata, so the id is a hover term even though the
     glossary carries no entry for it; the loader's shared registerIds
     does it (one shape for all three sections, a key the catalog knows
     is skipped, so a Refresh re-mount never registers a key twice); the
     body below is the fallback for a loader without it */
  function registerSeriesIds(S, C, keys) {
    if (!C || typeof C.register !== "function" || typeof C.get !== "function") return;
    if (typeof S.registerIds === "function") { S.registerIds(C, keys); return; }
    var entries = [], seen = {};
    keys.forEach(function (k) {
      /* register() takes a batch all or nothing, so a key repeated in
         the list is added once */
      if (seen[k]) return; seen[k] = true;
      if (!S.has(k) || C.get(k)) return;
      var e = S.get(k), F = S.fmt, l = S.latest(k);
      var src = S.sources()[e.source];
      entries.push({ key: k, label: e.label, subtitle: k, format: "chart", direction: "context",
        formula: e.formula ? e.formula + (e.inputs && e.inputs.length ? " · inputs: " + e.inputs.join(", ") : "") : "Read as published" + (src && src.label ? " from " + src.label : "") + " (" + e.unit + ", " + e.cadence + (e.geography ? ", " + e.geography : "") + ")",
        watch: (e.population ? e.population + ". " : "") + (l && S.isProvisional(l) ? "The newest point is provisional. " : "") + (l && S.isWindow(l) ? "The newest point is a window (" + F.period(l) + ") and is never summed with the calendar periods. " : ""),
        definition: "Series " + k + (e.group ? " of the " + e.group + " group" : "") + (e.edition ? ", " + F.edition(e.edition) + " edition" : "") + (e.asOf ? ", as of " + F.date(e.asOf) : "") + ".",
        interpretation: (l ? "Newest point " + F.byUnit(l.y, e.unit) + " (" + F.period(l) + "). " : "") + "Read it on the tile that draws it; the stamp in the footer says which edition it comes from." });
    });
    if (entries.length) { try { C.register(entries); } catch (e) { /* a key another section registered first keeps its entry */ } }
  }

  function howToRead(S, m) {
    var F = S.fmt, g = m.aum ? m.aum.global : null, c = m.cagr;
    return "The PitchBook reports judge fundraising two ways: against a round-number rule ($" + RULE_200 + "B a year is a strong year; the run of years at or above it is counted from the series, never typed) and against a league table of private strategies. " +
      "The latest year or half is provisional — late reporters add about a fifth — and a half-year is annualized only with \"if this pace holds\". A falling fund count with rising capital is manager concentration, not weakness. " +
      "Dry powder is never read raw: it is normalized as a share of AUM (the 2024 report calls its global share" + (g && g.share ? " of " + F.pct(g.share.y) : "") + " \"consistent with previous years\" and \"healthy\"; the newest report reads a fall as managers deploying capital they had already closed on) and as years of deployment (the 2021 report's test: a falling ratio means capital is being deployed). " +
      "Growth is benchmarked as a CAGR against PE" + (c && c.pe && c.dlReport ? " (the reports quote " + F.pct(c.dlReport.y) + " against " + F.pct(c.pe.y) + ")" : "") + " and as absolute AUM against the PE footprint the loans finance. " +
      "Deployment follows PE dealmaking — \"private credit deployment is strongly linked to PE LBO deal value\" (2023 report) — so it is drawn against LBO financing in both channels. " +
      "Three populations sit here and are never mixed in one ratio without saying so: the global fundraising-report series (final closes, restated as late reporters arrive), the US fund-data series on the monitor's slides (direct-lending AUM; private debt raised by type), and LCD's direct-lending volume from every lender with deal size estimated where undisclosed. Every ratio names which it uses, and \"direction, not level\" marks the two that cross them.";
  }

  function mount(container, ctx) {
    var S = ctx.series;
    if (!S) throw new Error("the series loader is not available");
    destroyLive();
    var m = model(S);
    return loadTable(S).then(function (table) {
      if (m.ttm) m.ttm.table = table;
      registerSeriesIds(S, ctx.catalog, drawnKeys(m));
      var html = "<section class='panel-card fsa-section cap-section' aria-labelledby='h-capital'>" +
        "<div class='section-head'><h2 id='h-capital'><span class='h-pop' data-metric='capSection'>Capital: fundraising, AUM, dry powder and deployment</span></h2>" +
        "<p class='section-blurb'>How much money is committed to private credit, how much of it is still uncalled, and how fast the market is putting it to work.</p>" +
        "<details class='how-to-read'><summary>How to read this</summary><p>" + esc(howToRead(S, m)) + "</p></details></div>" +
        "<div class='tile-grid cap-tiles'>" + renderTiles(S, m) + "</div>" +
        "<div class='cap-charts'>" +
        chartBlock("c1", "capC1", "C1 · Private debt fundraising, global", "Private debt capital raised and fund count by year, with the $200B rule") +
        chartBlock("c2", "capC2", "C2 · Trailing-12-month fundraising by strategy", "Trailing twelve-month capital raised by private strategy, sorted") +
        chartBlock("c3", "capC3", "C3 · US private debt raised by type", "US private debt capital raised by fund type, stacked, with the direct-lending share") +
        chartBlock("c4", "capC4", "C4 · US direct-lending AUM and dry powder share", "US direct-lending dry powder and NAV, stacked, with the dry powder share") +
        chartBlock("c5", "capC5", "C5 · Years of dry powder", "Direct-lending volume and dry powder by year with years of dry powder") +
        chartBlock("c6", "capC6", "C6 · Fundraising minus deployment", "US private debt raised minus direct-lending volume by year") +
        chartBlock("c7", "capC7", "C7 · Deployment against LBO financing", "Quarterly direct-lending volume against LBO financing in both channels") +
        "</div>" +
        (m.missing.length ? "<p class='tile-foot cap-missing'>Not in this edition: " + esc(m.missing.join(", ")) + ".</p>" : "") +
        exportTable(S, m) +
        "</section>";
      container.innerHTML = html;
      renderCharts(ctx, container, S, m);
      LAST = m;
    });
  }
  var LAST = null;

  function facts(ctx) {
    var S = ctx.series;
    if (!S) return [];
    var m = LAST || model(S);
    if (m.ttm && !m.ttm.table && TABLE.data) m.ttm.table = TABLE.data;
    return factLines(S, m);
  }

  win.RTCreditSections = win.RTCreditSections || [];
  win.RTCreditSections.push({
    id: "capital",
    title: "Capital: fundraising, AUM, dry powder and deployment",
    groups: GROUPS,
    mount: mount,
    CAPTIONS: CAPTIONS,
    facts: facts,
    keys: drawnKeys(null)
  });
})();
