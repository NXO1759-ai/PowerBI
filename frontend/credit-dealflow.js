/* credit-dealflow.js — the Market view's "Deal flow and pricing" section
   (blueprint 3.5, charts D1–D17): the LCD US Private Credit Monitor drawn
   in full from the ingested series, with the monitor's own reading
   frames — three windows, YTD against the same months last year with the
   gap attributed, count with volume and the average deal size between
   them, bucket migration, the BSL–direct-lending differential on two
   horizons, channel share, CLO issuance as a share of volume, takeouts
   both ways, and the LCD BDC series as the industry view beside the slot
   the site composite fills after the holdings release.

   Registers itself on window.RTCreditSections (contract L3 in credit.js)
   as { id: "dealflow", groups, mount, CAPTIONS, facts, keys } and its
   popups through RTCatalog.register at evaluation. Nothing here is typed
   from a report: every figure in a tile, chart, caption, popup or fact
   line is read from a series key through RTPcSeries or computed from two
   of them at render.

   Chart-to-key map (the loader resolves chart16–19 and chart10 aliases
   to their canonical keys; the deck's chart28 and chart29 belong to the
   capital section):
     D1  chart1   lcd_dl_count_quarterly, lcd_dl_volume_quarterly
     D2  chart2+4 lcd_dl_volume_annual, lcd_dl_count_annual,
                  lcd_dl_sponsor_volume_annual, lcd_dl_sponsor_count_annual
                  (non-sponsor = total − sponsor, a residual)
     D3  chart3+6+7 lcd_dl_sponsor_count_quarterly, lcd_dl_sponsor_volume_quarterly;
                  lcd_dl_lbo_count_quarterly, lcd_dl_lbo_volume_quarterly;
                  lcd_dl_lbo_count_annual, lcd_dl_lbo_volume_annual (the annual
                  and YTD panel, and the YTD line of the caption)
     D4  chart5   lcd_dl_pe_count_lbo_ma_quarterly, _refi_, _recap_, _other_
     D5  chart8   lcd_dl_sector_share_count_2025, lcd_dl_sector_share_count_2026ytd
     D6  chart13  lcd_dl_pe_spread_recent, lcd_dl_lbo_spread_recent;
         chart14  lcd_dl_pe_spread_bucket_{lt_450,450_499,500_549,550_plus}_recent;
         chart15  lcd_dl_lbo_spread_bucket_{lt_450,450_499,500_549,550_plus}_recent
     D7  chart9   lcd_dl_lbo_spread_bucket_{lt_450,450_499,500_549,550_599,600_649,650_699,700_plus}_annual
     D8  chart11  lcd_bsl_lbo_spread_all_annual, lcd_dl_lbo_spread_annual,
                  lcd_lbo_spread_diff_dl_vs_bsl_all_annual;
         chart10  lcd_bsl_lbo_spread_bminus_annual, lcd_dl_lbo_spread_annual_c10,
                  lcd_lbo_spread_diff_dl_vs_bsl_bminus_annual (the B-minus toggle);
         chart12  lcd_bsl_lbo_spread_all_quarterly, lcd_dl_lbo_spread_quarterly,
                  lcd_lbo_spread_diff_dl_vs_bsl_all_quarterly
     D9  chart16+17 lcd_bsl_lbo_count_quarterly, lcd_dl_lbo_count_quarterly_c16,
                  lcd_bsl_lbo_volume_quarterly, lcd_dl_lbo_volume_quarterly_c17
     D10 chart18+19 lcd_bsl_sponsor_count_quarterly, lcd_dl_sponsor_count_quarterly_c18,
                  lcd_bsl_sponsor_volume_quarterly, lcd_dl_sponsor_volume_quarterly_c19
     D11 chart20  lcd_global_lbo_1b_share_{dl,bsl,bsl_plus_other,other}_annual
     D12 chart30  lcd_pc_clo_volume_quarterly, lcd_pc_clo_count_quarterly;
                  share ÷ lcd_dl_volume_quarterly (windows) and lcd_dl_volume_annual (years)
     D13 chart31  lcd_takeout_dl_refinanced_by_bsl_quarterly, lcd_takeout_bsl_refinanced_by_dl_quarterly;
                  the two deal tables data/pc/tables/lcd-dl-refinanced-in-bsl.json (slide 40)
                  and lcd-bsl-replaced-by-dl.json (slide 41)
     D14 chart21  lcd_bdc_spread_dist_count_{3q25,4q25,1q26,2q26};
         chart22  lcd_bdc_unitranche_spread_dist_count_{3q25,4q25,1q26,2q26};
         chart23  lcd_bdc_first_lien_spread_dist_count_{4q25,1q26,2q26}; composite slot
     D15 chart27  lcd_bdc_all_in_rate_quarterly; FRED SOFR90DAYAVG at each quarter end
                  from the credit-macro payload; composite slot
     D16 chart26+25 lcd_bdc_maturity_wall_usd_{2026q1,2026q2}, lcd_bdc_maturity_wall_pct_{2026q1,2026q2};
                  composite slot
     D17 chart24  lcd_bdc_sector_share_count_{1q26,2q26}; composite slot

   The composite slots never read data/bdc/composite.json themselves:
   credit.js reads the file the holdings refresh writes ({ creditVersion,
   n, asOf, totals, weighted {...}, histogram { byCount, byCost } }) and
   hands every section the one view its normalizeComposite() builds, as
   ctx.composite; until the holdings release the file answers 404 and
   each slot says so. The fields of the view read here, rates and shares
   as FRACTIONS (the lib/credit.js convention): composite.n (count of
   BDCs), composite.asOf, composite.histogram.byCount [{ label:
   "450-499", share }] on LCD's ten bucket labels, composite.latest
   .allInYield (a fraction; drawn ×100 beside LCD's percent points) with
   composite.latest.n, composite.maturityWall [{ label: "2031-2033",
   cost: <$B>, share }] on lib/credit.js's buckets, composite.sectors
   [{ label, share }]. A field that is absent keeps its slot. */
(function (root) {
  "use strict";

  var W = root;
  var CAT = W.RTCatalog || null;
  var ID = "dealflow";
  var TITLE = "Deal flow and pricing";
  var GROUPS = ["lcd-dealflow", "lcd-pricing", "lcd-bdc"];
  var LCD = "lcd-monitor";
  var GOLD = "#f5c518", INK = "#8b8f98", LINE2 = "#b6bac2", BAR = "#6b6f78", BAR2 = "#43464d", POS = "#5ecb8f", NEG = "#ff8a80", BG = "#16181c";

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function hasY(p) { return p && p.x && isNum(p.y); }
  function last(a) { return a && a.length ? a[a.length - 1] : null; }
  function sum(a) { var s = 0; a.forEach(function (v) { if (isNum(v)) s += v; }); return s; }
  function yearOf(x) { return String(x || "").slice(0, 4); }
  function qOf(x) { return "Q" + Math.ceil(Number(String(x).slice(5, 7)) / 3); }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---------- the keys each chart draws (the map above, as data) ---------- */
  var BUCKETS_RECENT = ["lt_450", "450_499", "500_549", "550_plus"];
  var BUCKETS_ANNUAL = ["lt_450", "450_499", "500_549", "550_599", "600_649", "650_699", "700_plus"];
  var BDC_SNAPS = ["3q25", "4q25", "1q26", "2q26"];
  var KEYS = {
    D1: ["lcd_dl_count_quarterly", "lcd_dl_volume_quarterly"],
    D2: ["lcd_dl_volume_annual", "lcd_dl_count_annual", "lcd_dl_sponsor_volume_annual", "lcd_dl_sponsor_count_annual"],
    D3: ["lcd_dl_sponsor_count_quarterly", "lcd_dl_sponsor_volume_quarterly", "lcd_dl_lbo_count_quarterly", "lcd_dl_lbo_volume_quarterly", "lcd_dl_lbo_count_annual", "lcd_dl_lbo_volume_annual"],
    D4: ["lcd_dl_pe_count_lbo_ma_quarterly", "lcd_dl_pe_count_refi_quarterly", "lcd_dl_pe_count_recap_quarterly", "lcd_dl_pe_count_other_quarterly"],
    D5: ["lcd_dl_sector_share_count_2025", "lcd_dl_sector_share_count_2026ytd"],
    D6: ["lcd_dl_pe_spread_recent", "lcd_dl_lbo_spread_recent"].concat(
      BUCKETS_RECENT.map(function (b) { return "lcd_dl_pe_spread_bucket_" + b + "_recent"; }),
      BUCKETS_RECENT.map(function (b) { return "lcd_dl_lbo_spread_bucket_" + b + "_recent"; })),
    D7: BUCKETS_ANNUAL.map(function (b) { return "lcd_dl_lbo_spread_bucket_" + b + "_annual"; }),
    D8: ["lcd_bsl_lbo_spread_all_annual", "lcd_dl_lbo_spread_annual", "lcd_lbo_spread_diff_dl_vs_bsl_all_annual",
         "lcd_bsl_lbo_spread_bminus_annual", "lcd_dl_lbo_spread_annual_c10", "lcd_lbo_spread_diff_dl_vs_bsl_bminus_annual",
         "lcd_bsl_lbo_spread_all_quarterly", "lcd_dl_lbo_spread_quarterly", "lcd_lbo_spread_diff_dl_vs_bsl_all_quarterly"],
    D9: ["lcd_bsl_lbo_count_quarterly", "lcd_dl_lbo_count_quarterly_c16", "lcd_bsl_lbo_volume_quarterly", "lcd_dl_lbo_volume_quarterly_c17"],
    D10: ["lcd_bsl_sponsor_count_quarterly", "lcd_dl_sponsor_count_quarterly_c18", "lcd_bsl_sponsor_volume_quarterly", "lcd_dl_sponsor_volume_quarterly_c19"],
    D11: ["dl", "bsl", "bsl_plus_other", "other"].map(function (k) { return "lcd_global_lbo_1b_share_" + k + "_annual"; }),
    D12: ["lcd_pc_clo_volume_quarterly", "lcd_pc_clo_count_quarterly", "lcd_dl_volume_quarterly", "lcd_dl_volume_annual"],
    D13: ["lcd_takeout_dl_refinanced_by_bsl_quarterly", "lcd_takeout_bsl_refinanced_by_dl_quarterly", "lcd_dl_volume_quarterly"],
    D14: BDC_SNAPS.map(function (s) { return "lcd_bdc_spread_dist_count_" + s; }).concat(
      BDC_SNAPS.map(function (s) { return "lcd_bdc_unitranche_spread_dist_count_" + s; }),
      ["4q25", "1q26", "2q26"].map(function (s) { return "lcd_bdc_first_lien_spread_dist_count_" + s; })),
    D15: ["lcd_bdc_all_in_rate_quarterly"],
    D16: ["lcd_bdc_maturity_wall_usd_2026q1", "lcd_bdc_maturity_wall_usd_2026q2", "lcd_bdc_maturity_wall_pct_2026q1", "lcd_bdc_maturity_wall_pct_2026q2"],
    D17: ["lcd_bdc_sector_share_count_1q26", "lcd_bdc_sector_share_count_2q26"]
  };
  var TABLES = { toBsl: "tables/lcd-dl-refinanced-in-bsl.json", toDl: "tables/lcd-bsl-replaced-by-dl.json" };
  var ALL_KEYS = (function () {
    var out = [];
    Object.keys(KEYS).forEach(function (d) { KEYS[d].forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); }); });
    return out;
  })();

  /* ---------- caption templates ----------
     Each takes the strings the renderer formats and returns the sentence;
     sample() carries the widest plausible print of every field so
     scripts/test-pc-page.mjs can measure the template under 240
     characters. Source stamps live in the tile footer, never here. */
  var CAPTIONS = {
    d1: {
      template: function (v) {
        return "Direct lenders provided " + v.l3m + " across " + v.n + " deals over the past three months (" + v.win + "), " + v.dir +
          " from " + v.q2 + " and " + v.n2 + " in " + v.q2l + " and " + v.rel + " " + v.q1l + "'s " + v.q1 + " and " + v.n1 + "; average deal " + v.avg + ".";
      },
      sample: function () { return CAPTIONS.d1.template({ l3m: "$148.6B", n: "1,200", win: "Jun–Aug 2026", dir: "down", q2: "$136.8B", n2: "1,172", q2l: "Q2 2026", rel: "short of", q1l: "Q1 2026", q1: "$175.6B", n1: "1,223", avg: "$1,243M" }); }
    },
    d2: {
      template: function (v) {
        return "YTD volume of " + v.ytd + " is " + v.gap + " " + v.rel + " last year's " + v.prior + " (" + v.gapN + " on count); sponsor-backed lending " +
          v.sDir + " " + v.sGap + " to " + v.s + " while non-sponsor lending " + v.nsDir + " " + v.nsGap + " to " + v.ns + ", a residual.";
      },
      sample: function () { return CAPTIONS.d2.template({ ytd: "$1,146.5B", gap: "11.0%", rel: "ahead of", prior: "$1,164.7B", gapN: "−19.6%", sDir: "fell", sGap: "127.4%", s: "$1,086.9B", nsDir: "rose", nsGap: "132.3%", ns: "$1,059.6B" }); }
    },
    d3: {
      template: function (v) {
        return "Buyout direct lending " + v.l3m + " across " + v.n + " deals in the past three months, " + v.relQ2 + " " + v.q2l + "'s " + v.q2 + " and " + v.relQ1 + " " + v.q1l + "'s " + v.q1 +
          "; YTD " + v.ytd + " " + v.ytdRel + " last year's " + v.prior + " (" + v.gap + ").";
      },
      sample: function () { return CAPTIONS.d3.template({ l3m: "$114.4B", n: "1,050", relQ2: "above", q2l: "Q2 2026", q2: "$112.9B", relQ1: "below", q1l: "Q1 2026", q1: "$123.0B", ytd: "$143.7B", ytdRel: "trails", prior: "$156.7B", gap: "−23.0%" }); }
    },
    d4: {
      template: function (v) {
        return "LBO and M&A financings were " + v.lbo + " of " + v.total + " PE-backed deals over the past three months (" + v.q1 + " in " + v.q1l + "); refinancing " + v.refi +
          ", recapitalization " + v.recap + ", other " + v.other + ".";
      },
      sample: function () { return CAPTIONS.d4.template({ lbo: "100.0%", total: "1,120", q1: "100.0%", q1l: "Q1 2026", refi: "100.0%", recap: "100.0%", other: "100.0%" }); }
    },
    d5: {
      template: function (v) {
        return v.leader + " leads at " + v.share + " of new-issue deal count " + v.period + " (" + v.chg + "); " + v.mover + " moved most, " + v.dir + " " + v.pts + " to " + v.now +
          "; sectors under 3% carry the small-base marker.";
      },
      sample: function () { return CAPTIONS.d5.template({ leader: "Manufacturing & Machinery", share: "100.0%", period: "2026 YTD", chg: "+10.1 pts", mover: "Services & Leasing", dir: "down", pts: "12.9 points", now: "100.0%" }); }
    },
    d6: {
      template: function (v) {
        return "LBO spreads averaged " + v.lbo + " in the past three months, " + v.d + " on " + v.q1l + "; PE-backed " + v.pe + " (" + v.dpe + "). The " + v.modal +
          " bucket holds " + v.share + " of LBOs against " + v.prior + " in " + v.q1l + " as " + v.displaced + " gave way (" + v.dispPrior + " to " + v.dispNow + ").";
      },
      sample: function () { return CAPTIONS.d6.template({ lbo: "1,502 bps", d: "+127 bps", q1l: "Q1 2026", pe: "1,519 bps", dpe: "+116 bps", modal: "550 bps or higher", share: "100.0%", prior: "100.0%", displaced: "450–499 bps", dispPrior: "100.0%", dispNow: "100.0%" }); }
    },
    d7: {
      template: function (v) {
        return "The " + v.modal + " range holds " + v.share + " of new-issue LBO spreads " + v.period + ", from " + v.prior + " in " + v.priorYear + "; " + v.second + " " + v.secondShare +
          " from " + v.secondPrior + "; 700 bps or higher is " + v.tail + " against " + v.tailPeak + " in " + v.peakYear + ".";
      },
      sample: function () { return CAPTIONS.d7.template({ modal: "550 bps or higher", share: "100.0%", period: "2026 YTD", prior: "100.0%", priorYear: "2025", second: "500–549 bps", secondShare: "100.0%", secondPrior: "100.0%", tail: "100.0%", tailPeak: "100.0%", peakYear: "2022" }); }
    },
    d8: {
      /* who and qWho are empty on the all-borrowers view; the B-minus
         toggle names the BSL population on each horizon */
      template: function (v) {
        return "On the annual view" + v.who + " the BSL–direct-lending differential " + v.aDir + " to " + v.ytd + " " + v.period + " from " + v.prior + " in " + v.priorYear +
          "; over the past three months" + v.qWho + " it " + v.qDir + " to " + v.l3m + ", " + v.d + " on " + v.q1l + ".";
      },
      sample: function () { return CAPTIONS.d8.template({ who: ", against B-minus BSL borrowers,", aDir: "narrowed", ytd: "1,147 bps", period: "2026 YTD", prior: "1,162 bps", priorYear: "2025", qWho: " (all borrowers)", qDir: "widened", l3m: "1,162 bps", d: "+139 bps", q1l: "Q1 2026" }); }
    },
    d9: {
      template: function (v) {
        return "Direct lenders financed " + v.dlN + " LBOs over the past three months against " + v.bslN + " in BSL (" + v.cShare + " by count) but " + v.vShare + " by volume (" +
          v.dlV + " against " + v.bslV + "): " + v.dlAvg + " per direct-lending deal against " + v.bslAvg + " per BSL deal.";
      },
      sample: function () { return CAPTIONS.d9.template({ dlN: "1,050", bslN: "1,013", cShare: "100.0%", vShare: "100.0%", dlV: "$114.4B", bslV: "$113.4B", dlAvg: "$1,288M", bslAvg: "$11,029M" }); }
    },
    d10: {
      template: function (v) {
        return "Direct lending held " + v.cShare + " of sponsor-backed deal count (" + v.dlN + " against " + v.bslN + ") but " + v.vShare + " of volume (" + v.dlV + " against " + v.bslV +
          "); BSL volume sits at " + v.bslQ1 + " of its " + v.q1l + " level and direct lending at " + v.dlQ1 + ".";
      },
      sample: function () { return CAPTIONS.d10.template({ cShare: "100.0%", dlN: "1,124", bslN: "1,081", vShare: "100.0%", dlV: "$128.3B", bslV: "$165.2B", bslQ1: "188.8%", q1l: "Q1 2026", dlQ1: "162.8%" }); }
    },
    d11: {
      template: function (v) {
        return "Direct lending financed " + v.dl + " of buyouts over $1B in " + v.period + ", " + v.chg + " from " + v.prior + " in " + v.priorYear + " (peak " + v.peak + " in " + v.peakYear +
          "); syndicated loans " + v.bsl + ", " + v.bslAll + " with other debt alongside. US and Europe, by count.";
      },
      sample: function () { return CAPTIONS.d11.template({ dl: "100.0%", period: "H1 2026", chg: "−11.1 pts", prior: "100.0%", priorYear: "2025", peak: "100.0%", peakYear: "2023", bsl: "100.0%", bslAll: "100.0%" }); }
    },
    d12: {
      template: function (v) {
        return "CLO issuance of " + v.v + " across " + v.n + " deals over the past three months, " + v.dir + " from " + v.q2 + " in " + v.q2l + ", equals " + v.share +
          " of direct-lending volume (" + v.q2share + " in " + v.q2l + ", " + v.y + " for " + v.year + ").";
      },
      sample: function () { return CAPTIONS.d12.template({ v: "$19.8B", n: "120", dir: "down", q2: "$19.0B", q2l: "Q2 2026", share: "100.0%", q2share: "100.0%", y: "100.0%", year: "2025" }); }
    },
    d13: {
      template: function (v) {
        return "Direct-lending debt refinanced in BSL " + v.dir + " to " + v.toBsl + " over the past three months from " + v.toBslQ2 + " in " + v.q2l + " while " + v.toDl +
          " moved the other way: net " + v.net + " " + v.netDir + " direct lending after " + v.netYear + " " + v.netYearDir + " in " + v.year + "; churn " + v.churn + " of volume.";
      },
      sample: function () { return CAPTIONS.d13.template({ dir: "jumped", toBsl: "$18.6B", toBslQ2: "$12.2B", q2l: "Q2 2026", toDl: "$14.0B", net: "$14.6B", netDir: "out of", netYear: "$13.3B", netYearDir: "into it", year: "2025", churn: "126.0%" }); }
    },
    d14set: {
      template: function (v) {
        return v.set + " held by BDCs: " + v.band + " at 450–549 bps (" + v.prior + " in " + v.priorQ + "), modal bucket " + v.modal + " at " + v.modalShare + "; all holdings " + v.allBand +
          ". Composite after the holdings release; direction, not level.";
      },
      sample: function () { return CAPTIONS.d14set.template({ set: "Senior secured first-lien term loans", band: "100.0%", prior: "100.0%", priorQ: "3Q25", modal: "450–499 bps", modalShare: "100.0%", allBand: "100.0%" }); }
    },
    d14: {
      template: function (v) {
        return "LCD's BDC portfolios hold " + v.band + " of loans at 450–549 bps (" + v.prior + " in " + v.priorQ + "), modal bucket " + v.modal + " at " + v.modalShare +
          "; unitranche " + v.uni + " in the band. " + v.site;
      },
      sample: function () { return CAPTIONS.d14.template({ band: "100.0%", prior: "100.0%", priorQ: "3Q25", modal: "450–499 bps", modalShare: "100.0%", uni: "100.0%", site: "The site's 50 listed BDCs hold 100.0% in the band, modal 450–499 bps; direction, not level." }); }
    },
    d15: {
      /* sofr is the clause after the semicolon: the quarter-end SOFR and
         the gap, or the line that says the macro feed has no value there */
      template: function (v) {
        return "BDC-held loan yields " + v.dir + " to " + v.lcd + " in " + v.q + ", the lowest since " + v.lowQ + " (peak " + v.peak + " in " + v.peakQ + "); " + v.sofr + " " + v.site;
      },
      sample: function () { return CAPTIONS.d15.template({ dir: "fell", lcd: "18.30%", q: "Q2 2026", lowQ: "Q2 2022", peak: "11.51%", peakQ: "Q3 2023", sofr: "90-day SOFR was 13.63% at that quarter end, 1,467 bps between them.", site: "The site composite is 10.00% on 50 BDCs: direction, not level." }); }
    },
    d16: {
      template: function (v) {
        return "LCD's " + v.total + " BDC maturity wall shifted to the back end: 2031–2033 " + v.backDir + " to " + v.back + " (" + v.backPct + ") from " + v.backPrior + " (" + v.backPriorPct +
          ") as 2026–2027 " + v.frontDir + " to " + v.front + ". " + v.site;
      },
      sample: function () { return CAPTIONS.d16.template({ total: "$1,502.8B", backDir: "rose", back: "$1,226.0B", backPct: "100.0%", backPrior: "$1,211.8B", backPriorPct: "100.0%", frontDir: "shrank", front: "$135.9B", site: "The site's 50 listed BDCs carry $157.0B with 100.0% in 2031–2033: shape, not dollars." }); }
    },
    d17: {
      template: function (v) {
        return "BDC sector mix " + v.verdict + ": " + v.top + " " + v.share + " (" + v.chg + "), " + v.second + " " + v.share2 + " (" + v.chg2 + "); " + v.move + ". " + v.site;
      },
      sample: function () { return CAPTIONS.d17.template({ verdict: "essentially unchanged", top: "Other Financial Services", share: "100.0%", chg: "+10.19 pts", second: "Services (Non-Financial)", share2: "100.0%", chg2: "−10.05 pts", move: "largest move Healthcare Technology Systems −10.14 pts", site: "Composite marker after the holdings release." }); }
    }
  };

  /* ---------- popups: formula → caveat → definition → how to read it ---------- */
  var ENTRIES = [
    { key: "dfWindows", label: "Direct lending, three windows", subtitle: "chart1",
      formula: "Estimated volume and deal count for the past three months, the last full quarter and the first quarter of the year, read from LCD's quarterly series; average deal size = volume ÷ count",
      watch: "The rolling three-month window overlaps the last quarter and is never summed with it; deal count covers transactions LCD News reported; volume is estimated where a facility size was not disclosed.",
      definition: "How much direct lenders financed, and in how many deals, on the monitor's three windows.",
      interpretation: "Count with volume, always: a recovery in count with a smaller average deal is a different market from the same volume in fewer, larger deals." },
    { key: "dfYtd", label: "YTD against the same months last year", subtitle: "chart2 and chart4",
      formula: "YTD 2026 ÷ YTD 2025 − 1 for volume and count; sponsor-backed from chart4; non-sponsor = total − sponsor, both years",
      watch: "Non-sponsor lending is a residual and carries every estimation error in the two series it is subtracted from; the YTD window ends on the monitor's as-of date, not a quarter end.",
      definition: "The year's pace against last year's, and which borrower segment carries the gap.",
      interpretation: "A gap attributed to sponsors is a buyout-market story; a gap in non-sponsor lending is a corporate-demand story. The two can move in opposite directions in the same year." },
    { key: "dfSpread", label: "New-issue LBO spread", subtitle: "chart13",
      formula: "Average spread over the base rate on LBOs financed in the direct-lending market, in bps; delta = window − the first quarter of the year; LBO discount = PE-backed − LBO",
      watch: "From 2026 the series mixes privately sourced spreads with those from LCD News, BDC filings and public sources, so 2026 readings are not strictly comparable with earlier years; floors, OID and fees are not in the spread.",
      definition: "What a sponsor paid over SOFR for buyout debt from a direct lender.",
      interpretation: "Read the delta in bps against the prior window and LBOs separately from all PE-backed deals; LBOs usually price inside the wider PE-backed set." },
    { key: "dfDifferential", label: "BSL–direct-lending differential, two horizons", subtitle: "chart11, chart12, chart10",
      formula: "Direct-lending LBO spread − BSL LBO spread, in bps, recomputed from the two spread series: annual and YTD from chart11, quarterly and rolling from chart12, the B-minus BSL variant from chart10",
      watch: "The two horizons can disagree in the same month — the YTD read can narrow while the three-month read widens — so a caption names which one it reads; a YTD point can be blank when LCD has too few deals to average.",
      definition: "The premium a borrower pays a direct lender over the syndicated market for the same buyout.",
      interpretation: "The price of certainty of execution. When it widens, cost-sensitive borrowers drift back to BSL; when it narrows, direct lenders win share on terms, not price." },
    { key: "dfChannel", label: "Direct-lending share of LBOs", subtitle: "chart16 and chart17",
      formula: "Direct lending ÷ (direct lending + institutional leveraged loans), by count and by volume, same window; average deal size = volume ÷ count per channel",
      watch: "Count share and volume share disagree by construction when average deal sizes differ; the BSL count covers institutional term loans LCD tracked, the direct-lending count the transactions LCD News reported.",
      definition: "How buyout financing splits between direct lenders and the syndicated market.",
      interpretation: "Direct lenders lead on count and BSL on volume because syndicated deals are larger; a falling volume share while count holds is the large end of the market moving back to BSL." },
    { key: "dfTakeouts", label: "Takeouts, net flow", subtitle: "chart31",
      formula: "Net into direct lending = BSL loans refinanced by direct lenders − direct-lending loans refinanced in BSL, same window; gross churn = the sum; churn share = gross churn ÷ direct-lending volume",
      watch: "LCD revises takeout history as it collects information, so the whole series is redrawn on every ingest; the tables beneath the chart are LCD News reporting, recovered from the slide's picture.",
      definition: "The two-way traffic between the channels: who left direct lending for a cheaper syndicated loan, and who left BSL for certainty of execution.",
      interpretation: "The net line is the channel-substitution gauge; a negative net with rising churn means the syndicated market is open and repricing direct-lending paper." },
    { key: "dfD1", label: "D1 · Direct-lending deal count and estimated volume, quarterly", subtitle: "chart1",
      formula: "Columns: deal count (left axis); line: estimated volume in $B (right axis); the rolling three-month point drawn hatched and hollow",
      watch: "The last point is a rolling window that overlaps the last quarter shown and is never added to it; deal count is based on transactions covered by LCD News; volume is estimated where undisclosed.",
      definition: "Quarterly direct-lending activity for all US borrowers, PE-backed and not.",
      interpretation: "Three windows in order — the past three months, the last full quarter, the first quarter — and the regime line when the run rate is not reclaimed." },
    { key: "dfD2", label: "D2 · Annual and YTD volume, sponsor against non-sponsor", subtitle: "chart2 and chart4",
      formula: "Stacked columns: sponsor-backed volume (chart4) and non-sponsor volume (chart2 total − chart4), in $B; line: deal count (right axis); the two YTD columns hatched",
      watch: "Non-sponsor is a residual, so it carries the estimation error of both series; a YTD column runs to the monitor's as-of date and is compared only with the same months of the prior year.",
      definition: "Where the year's direct-lending volume came from, and how the year is pacing.",
      interpretation: "The stacked split shows the attribution instead of asserting it: read the YTD gap first, then which segment carries it." },
    { key: "dfD3", label: "D3 · Sponsor-backed and buyout direct lending", subtitle: "chart3, chart6 and chart7",
      formula: "Three panels, each columns for count (left) and a line for volume in $B (right): sponsor-backed borrowers by quarter, deals financing buyouts by quarter, then buyouts by year with the two YTD columns; the rolling and YTD points hatched",
      watch: "The buyout series is a subset of the sponsor-backed series; both counts are LCD News coverage, both volumes estimated where undisclosed; the rolling window overlaps the last quarter and a YTD column is compared only with the same months of the prior year.",
      definition: "The sponsor channel and its buyout core, side by side, with the buyout year's pace.",
      interpretation: "The buyout panel is the sponsor-selectivity read (new platform deals); the sponsor panel is the pickup-after-the-drop read (add-ons and refinancings included); the annual panel says whether the year trails or leads last year's pace." },
    { key: "dfD4", label: "D4 · PE-backed deals by use of proceeds", subtitle: "chart5",
      formula: "Stacked columns of deal counts — LBO/M&A, refinancing, recapitalization, other — with a toggle to each window's shares (count ÷ the four-series total)",
      watch: "The four totals do not reconcile to the sponsor-backed count on chart3 (different cuts of LCD's coverage) and are not reconciled here; the refinancing series has a blank quarter in 2020 that the ingest reads by position id, never by alignment.",
      definition: "What sponsors borrowed for.",
      interpretation: "A rising refinancing or recapitalization share with a flat LBO/M&A count is a repricing market, not a growth market." },
    { key: "dfD5", label: "D5 · Top-10 sectors by share of new-issue deal count", subtitle: "chart8",
      formula: "Dumbbell per sector: share of deal count in the prior full year against the current YTD, sorted by the YTD share; point change labeled; a small-base marker under 3%",
      watch: "Shares are of LCD's covered deal count, not of volume; a sector under 3% moves in whole points on a handful of deals, which is the small-base marker.",
      definition: "Which industries direct lenders are financing, and where the mix moved.",
      interpretation: "Read the point changes: a leader extending its lead is concentration, and the largest mover names where lenders pulled back." },
    { key: "dfD6", label: "D6 · New-issue spreads and their bucket distribution", subtitle: "chart13, chart14, chart15",
      formula: "Left: average spread over base for PE-backed deals and for LBOs by window (columns, bps); right: 100%-stacked shares of deals in four 50 bps buckets for each window and each set, the modal bucket of the latest window in accent",
      watch: "From 2026 the spread series include privately sourced values beside LCD News, BDC filings and public sources: not strictly comparable with prior years; the rolling window overlaps the last quarter.",
      definition: "The price of new direct-lending debt and how it is distributed.",
      interpretation: "Bucket migration: name the modal bucket, the bucket it displaced and both prior shares, then translate — a bucket moving up 50 bps is borrowers paying more on new financings." },
    { key: "dfD7", label: "D7 · LBO spread distribution, annual", subtitle: "chart9",
      formula: "100%-stacked columns: share of LBOs financed in the direct-lending market in seven 50 bps spread buckets, by year and the current YTD; the modal bucket labeled each year",
      watch: "Senior secured loans and unitranche facilities; from 2026 the data includes privately sourced values alongside public ones; the YTD column is a partial year.",
      definition: "The regime marker for direct-lending pricing, year by year.",
      interpretation: "A heavy 700-and-over tail marks a dislocation year; a modal bucket in the 450–549 range marks compression. The migration on D6 shows as the modal bucket shifting one step here." },
    { key: "dfD8", label: "D8 · BSL against direct-lending LBO spreads and the differential", subtitle: "chart11, chart12, chart10",
      formula: "Two panels — annual with a YTD point, and quarterly with the rolling point — each with the BSL and direct-lending spreads as lines (left axis, bps over base) and the differential as columns (right axis); a toggle on the annual panel to the B-minus BSL variant",
      watch: "Direct-lending data covers senior secured first-lien loans and unitranche facilities and includes privately sourced values from 2026; BSL 'all borrowers' and 'B-minus' are different populations and the two differentials are not interchangeable.",
      definition: "The relative-value series between the two channels, on two horizons.",
      interpretation: "The two horizons can disagree; the caption names both. A widening differential is the lever that sends deals back to the syndicated market." },
    { key: "dfD9", label: "D9 · LBO financing by channel", subtitle: "chart16 and chart17",
      formula: "Two panels of grouped columns — deal count, then volume in $B — for institutional leveraged loans against direct lending, with direct lending's share as a line on the right axis; average deal size in the tooltip",
      watch: "The two count series and the two volume series are LCD's chart16 and chart17, which repeat chart6's direct-lending values and are ingested once; the rolling window overlaps the last quarter.",
      definition: "The scoreboard of buyout financing between the syndicated and the direct-lending channel.",
      interpretation: "Count-against-volume divergence is explained by average deal size: direct lenders win the many mid-sized deals, BSL the few large ones." },
    { key: "dfD10", label: "D10 · Sponsor-backed financing by channel", subtitle: "chart18 and chart19",
      formula: "The same two panels on the sponsor-backed series: count and volume by channel, direct lending's share as a line, average deal size in the tooltip",
      watch: "chart18 and chart19 repeat chart3's direct-lending values and are ingested once; sponsor-backed includes buyouts, add-ons, refinancings and recapitalizations.",
      definition: "The channel split on everything sponsors borrow, not just buyouts.",
      interpretation: "Sponsors use BSL for size and direct lending for count; the volume share is the cost-sensitivity turn to watch." },
    { key: "dfD11", label: "D11 · Share of global buyouts over $1B by financing type", subtitle: "chart20",
      formula: "100%-stacked columns of the count of buyouts over $1B in the US and Europe by financing type — direct lending, syndicated loans, syndicated loans with pre-placed second lien or bonds alongside, other — by year and the current half",
      watch: "By count, US and Europe, through the half-year end: never set beside the US-only quarterly series as a level; the half-year point is a partial year.",
      definition: "The top-of-market scoreboard, where cost sensitivity bites first.",
      interpretation: "Direct lending's peak share was the year the syndicated market shut; its share falling while BSL rises is the syndicated market reopening for the largest deals." },
    { key: "dfD12", label: "D12 · Private credit and middle-market CLO issuance", subtitle: "chart30 with chart1 and chart2",
      formula: "Columns: CLO volume in $B (left axis); line: count (right axis); a toggle to CLO volume ÷ direct-lending volume in the same window, the calendar year as the sum of its quarters over the annual volume",
      watch: "The share rises when loan volume falls as well as when CLO issuance rises, so read numerator and denominator together; the rolling window overlaps the last quarter.",
      definition: "The funding leg of direct lending: how much of the year's loans are termed out into CLOs.",
      interpretation: "A rising share is more of the book financed with rated, long-dated liabilities; a falling share with rising volume is lenders holding loans on fund and BDC balance sheets." },
    { key: "dfD13", label: "D13 · Takeouts both ways, with the net flow", subtitle: "chart31, slides 40 and 41",
      formula: "Grouped columns: direct-lending loans refinanced in BSL and BSL loans refinanced by direct lenders, in $B; line: the net into direct lending (BSL→DL − DL→BSL); the two deal tables beneath, last ten each way",
      watch: "Historical data is subject to revision as LCD collects information, so each ingest replaces the series; the tables are LCD News reporting recovered from the slides' pictures and are the deals, not the totals.",
      definition: "The two-way traffic between the channels and its motives: cheaper spreads one way, certainty of execution the other.",
      interpretation: "The net line is the channel-substitution gauge; churn as a share of volume says how much of the year's lending is refinancing traffic rather than new money." },
    { key: "dfD14", label: "D14 · BDC holdings spread distribution: LCD industry against the site composite", subtitle: "chart21, chart22, chart23",
      formula: "Grouped columns: share of BDC-held loans by count in ten 50 bps buckets over base for LCD's four quarterly snapshots; toggles to unitranche and first-lien loans; the site composite's latest quarter as an outlined column per bucket once the holdings release lands",
      watch: "LCD's population is every BDC portfolio it tracks (the footer states how many), which implies non-listed funds; the site composite is the listed BDCs. Compare direction, not level. Slide 27 names no base rate: the label is bps over base, never SOFR plus.",
      definition: "Where the industry's loans are priced, and the anchor band the composite is read against.",
      interpretation: "The 450–549 bps band is the anchor: state the modal bucket and the two-bucket share, then whether the site composite sits on the same side of it." },
    { key: "dfD15", label: "D15 · BDC all-in interest rate: LCD industry against the site composite and SOFR", subtitle: "chart27",
      formula: "Lines: LCD's cost-weighted average all-in interest rate on BDC-held debt, quarterly; 90-day average SOFR at each quarter end from FRED; the site composite's cost-weighted all-in yield once the holdings release lands",
      watch: "The LCD line reflects senior secured, unsecured and subordinated debt holdings across every BDC portfolio LCD tracks (the footer states how many); the listed-only composite will differ in level. SOFR is the month-end value of the quarter-end month, not a quarterly average.",
      definition: "What the industry's loans pay, against the base rate they float over.",
      interpretation: "Yield = base + spread. Benchmark the level to a multi-year low or high; the gap to SOFR is the industry's realized spread over base." },
    { key: "dfD16", label: "D16 · BDC maturity wall: LCD industry against the site composite", subtitle: "chart26 and chart25",
      formula: "Grouped columns: $B at cost of BDC-held debt by maturity year for two quarter-end snapshots, with a toggle to the share by cost; the site composite's wall as a third outlined series once the holdings release lands",
      watch: "Excludes equity, CMBS and CLO holdings; LCD's percentages sum to about 98%, a residual the slide does not explain; extensions move loans along the wall without repaying them. Compare shape, not dollars.",
      definition: "When the industry's borrowers must refinance.",
      interpretation: "Read the shift toward the back end in both share and dollars across the two snapshots; a heavy near-term share in a tight market means amendments and extensions ahead." },
    { key: "dfD17", label: "D17 · BDC holdings by sector: LCD industry against the site composite", subtitle: "chart24",
      formula: "Dumbbell per sector: share of BDC holdings by count in the prior quarter against the latest, LCD's top ten; the site composite's share as a marker once the holdings release lands",
      watch: "Sector taxonomies differ between LCD and the filers' schedules, so the composite marker will carry its mapping; a slow series gets stability language, not false precision.",
      definition: "What the industry's loans finance, and whether that mix moved.",
      interpretation: "Concentration in commercial services and software is the private credit book; a move of more than a point in a quarter is worth a sentence, less is noise." },
    { key: "dfTables", label: "Takeout deal tables", subtitle: "slides 40 and 41",
      formula: "The last ten syndicated term loans that refinanced direct-lending debt, and the most recent direct-lending deals that replaced broadly syndicated term loans, as LCD printed them",
      watch: "Recovered from the slides' pictures and checked cell by cell against a hand-keyed copy; LCD News reporting, not a complete census; ratings are the borrower's at the time.",
      definition: "The deal ledger behind the takeout chart.",
      interpretation: "Read the motives: a refinancing into BSL cites a cheaper spread, a move into direct lending cites certainty of execution or a club of named lenders." }
  ];
  if (CAT && typeof CAT.register === "function") {
    try { CAT.register(ENTRIES); } catch (e) { /* a second evaluation of this file keeps the first set */ }
  }

  /* ---------- reading the series ---------- */
  function quarters(S, key) { return S.pointsOf(key, { grain: "quarter" }).filter(hasY); }
  function rolling(S, key) { var r = S.latest(key, { grain: "rolling3m" }); return hasY(r) ? r : null; }
  /* the monitor's three windows: the rolling point, the last full
     quarter, and the first quarter of that quarter's year (the quarter
     before when the last quarter is itself a first quarter) */
  function windows(S, key) {
    var q = quarters(S, key);
    if (!q.length) return null;
    var lastQ = last(q), yr = yearOf(lastQ.x);
    var firstQ = null;
    q.forEach(function (p) { if (yearOf(p.x) === yr && /-03-31$/.test(p.x)) firstQ = p; });
    if (!firstQ || firstQ.x === lastQ.x) firstQ = q.length > 1 ? q[q.length - 2] : null;
    return { rolling: rolling(S, key), lastQ: lastQ, firstQ: firstQ, quarters: q };
  }
  /* the YTD point and the same months of the prior year */
  function ytdPair(S, key) {
    var y = S.pointsOf(key, { grain: "ytd" }).filter(hasY);
    if (!y.length) return null;
    var cur = last(y), want = String(Number(yearOf(cur.x)) - 1) + cur.x.slice(4), prev = null;
    y.forEach(function (p) { if (p.x === want) prev = p; });
    if (!prev) y.forEach(function (p) { if (p.x < cur.x) prev = p; });
    return { cur: cur, prev: prev };
  }
  function yearPoint(S, key, yr) { return S.at(key, yr + "-12-31", "year"); }
  function overlapText(F, lastQ) { return lastQ ? "overlaps " + qOf(lastQ.x) : "overlaps the last quarter"; }
  function winLabel(F, r) { return r ? F.period(r) : "the past three months"; }
  function bucketLabel(c) {
    var s = String(c || "").replace(/\s*-\s*/g, "–");
    if (/^lt_450$|^Less than 450|^<450/i.test(s)) return "under 450 bps";
    if (/^Less than 400|^Under 400/i.test(s)) return "under 400 bps";
    if (/plus$|or higher/i.test(s)) return s.replace(/_plus$/, "").replace(/\s*or higher/i, "") + " bps or higher";
    return s.replace(/_/g, "–") + " bps";
  }
  function relWord(a, b, up, down, same) { return a > b ? up : a < b ? down : same; }

  /* ---------- the alignment of several keys on one category axis ---------- */
  var GRAIN_ORDER = { year: 0, half: 1, quarter: 2, month: 3, asof: 4, ytd: 5, rolling3m: 6, rolling6m: 7, rolling12m: 8, window: 9 };
  function catLabel(F, p) {
    if (p.g === "quarter") return F.quarterDeck(p.x);
    if (p.g === "rolling3m") return "L3M";
    if (p.g === "year") return yearOf(p.x);
    if (p.g === "ytd") return yearOf(p.x) + " YTD";
    if (p.g === "half") return (Number(p.x.slice(5, 7)) <= 6 ? "1H" : "2H") + yearOf(p.x).slice(2);
    return F.period(p);
  }
  function catTitle(F, p, lastQ) {
    if (p.g === "rolling3m") return F.period(p) + " (" + overlapText(F, lastQ) + ")";
    if (p.g === "quarter") return F.quarter(p.x);
    return F.period(p);
  }
  function align(S, keys, grains, windowsLast) {
    var F = S.fmt, seen = {}, cats = [], data = {};
    keys.forEach(function (k) {
      S.pointsOf(k, { grain: grains }).forEach(function (p) {
        if (!p.x) return;
        var id = p.x + "|" + p.g;
        if (!seen[id]) { seen[id] = { x: p.x, g: p.g, start: p.start }; cats.push(seen[id]); }
      });
    });
    cats.sort(function (a, b) {
      if (windowsLast) {
        var wa = S.isWindow(a) ? 1 : 0, wb = S.isWindow(b) ? 1 : 0;
        if (wa !== wb) return wa - wb;
      }
      return a.x < b.x ? -1 : a.x > b.x ? 1 : (GRAIN_ORDER[a.g] || 0) - (GRAIN_ORDER[b.g] || 0);
    });
    var lastQ = null;
    cats.forEach(function (c) { if (c.g === "quarter") lastQ = c; });
    cats.forEach(function (c) {
      c.window = S.isWindow(c);
      /* a partial period is hatched: every window (YTD, rolling) and a
         half-year drawn among full years (D11's 1H column) */
      c.partial = c.window || c.g === "half";
      c.rolling = c.g === "rolling3m";
      c.label = catLabel(F, c);
      c.title = catTitle(F, c, lastQ);
      /* the tick: the year at each first quarter and each year, the window's label on its own */
      c.tick = c.g === "quarter" ? (/-03-31$/.test(c.x) ? yearOf(c.x) : null) : c.label;
    });
    keys.forEach(function (k) {
      var by = {};
      S.pointsOf(k, { grain: grains }).forEach(function (p) { if (p.x && isNum(p.y)) by[p.x + "|" + p.g] = p; });
      data[k] = cats.map(function (c) { var p = by[c.x + "|" + c.g]; return p ? p.y : null; });
    });
    return { cats: cats, data: data, lastQ: lastQ };
  }

  /* ---------- Chart.js scaffolding on the page's base options ---------- */
  var PATTERNS = {};
  function hatch(color) {
    if (PATTERNS[color]) return PATTERNS[color];
    if (typeof document === "undefined") return color;
    var c = document.createElement("canvas"); c.width = 8; c.height = 8;
    var g = c.getContext("2d");
    g.strokeStyle = color; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(-2, 10); g.lineTo(10, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
    PATTERNS[color] = g.createPattern(c, "repeat") || color;
    return PATTERNS[color];
  }
  function barColors(cats, color) { return cats.map(function (c) { return c.partial ? hatch(color) : color; }); }
  function pointRadii(cats, r) { return cats.map(function (c) { return c.partial ? r || 4 : 0; }); }
  /* the label the blueprint asks for above the rolling column */
  function overlapPlugin(cats, text) {
    return { id: "dfOverlap", afterDatasetsDraw: function (chart) {
      var idx = -1;
      cats.forEach(function (c, i) { if (c.rolling) idx = i; });
      if (idx < 0) return;
      var xs = chart.scales.x; if (!xs) return;
      var g = chart.ctx, x = xs.getPixelForValue(idx);
      g.save();
      g.font = "10px JetBrains Mono, monospace"; g.fillStyle = GOLD; g.textAlign = "center"; g.textBaseline = "top";
      /* the rolling column is usually the last one, so the label is
         kept inside the canvas rather than centered off its edge */
      var w = g.measureText(text).width, limit = chart.width - 4;
      if (x + w / 2 > limit) { g.textAlign = "right"; x = limit; }
      else if (x - w / 2 < 4) { g.textAlign = "left"; x = 4; }
      g.fillText(text, x, chart.chartArea.top + 2);
      g.restore();
    } };
  }
  /* a label inside the largest segment of each stacked column */
  function modalPlugin(labelsPerIndex) {
    return { id: "dfModal", afterDatasetsDraw: function (chart) {
      var g = chart.ctx;
      g.save(); g.font = "9px JetBrains Mono, monospace"; g.fillStyle = "#0f1114"; g.textAlign = "center"; g.textBaseline = "middle";
      labelsPerIndex.forEach(function (m, i) {
        if (!m) return;
        var meta = chart.getDatasetMeta(m.dataset), el = meta && meta.data[i];
        if (!el || !isNum(el.y) || !isNum(el.base)) return;
        var h = Math.abs(el.base - el.y);
        if (h < 14) return;
        g.fillText(m.text, el.x, (el.y + el.base) / 2);
      });
      g.restore();
    } };
  }
  function options(ctx, cats, o) {
    o = o || {};
    var yfmt = o.yfmt || function (v) { return isNum(v) ? String(v) : "—"; };
    var base = ctx.chart.baseOptions(cats.map(function (c) { return c.label; }), yfmt, o.unit || "");
    base.scales.x.ticks.callback = function (val, idx) {
      var c = cats[idx]; if (!c) return null;
      var t = o.everyTick ? c.label : c.tick;
      /* a narrow panel prints the year as '24 so adjacent years do not
         collide, and drops the rolling column's tick on a phone, where
         the hatch and the "overlaps" label already name it */
      if (o.shortYears && t && /^\d{4}( YTD)?$/.test(t)) t = "'" + t.slice(2);
      if (o.shortYears && c.rolling && this && this.chart && this.chart.width < 380) t = "";
      return t;
    };
    base.scales.x.ticks.autoSkip = !!o.autoSkip;
    base.scales.x.ticks.maxRotation = o.rotate ? 45 : 0;
    base.plugins.tooltip.callbacks.title = function (items) { return items.length && cats[items[0].dataIndex] ? cats[items[0].dataIndex].title : ""; };
    base.plugins.tooltip.callbacks.label = function (item) {
      var ds = item.dataset, f = ds.fmt || (ds.yAxisID === "y1" && o.y1fmt) || yfmt;
      var v = item.parsed.y;
      var line = " " + ds.label + " " + (isNum(v) ? f(v) : "—");
      if (ds.extra) { var x = ds.extra(item.dataIndex, v); if (x) line += " · " + x; }
      if (ds.restated) { var r = ds.restated(item.dataIndex); if (r) line += " · " + r; }
      return line;
    };
    base.plugins.tooltip.mode = "index";
    if (o.y1) {
      base.scales.y1 = { position: "right", grid: { drawOnChartArea: false }, border: { display: false },
        ticks: { color: INK, font: { family: "JetBrains Mono, monospace", size: 10 }, maxTicksLimit: 6, callback: function (v) { return (o.y1fmt || yfmt)(v); } },
        title: o.y1unit ? { display: true, text: o.y1unit, color: INK, font: { family: "JetBrains Mono, monospace", size: 10 } } : { display: false },
        min: o.y1min, max: o.y1max };
    }
    if (o.stacked) { base.scales.x.stacked = true; base.scales.y.stacked = true; }
    if (isNum(o.ymin)) base.scales.y.min = o.ymin;
    if (isNum(o.ymax)) base.scales.y.max = o.ymax;
    if (o.beginAtZero !== false) base.scales.y.beginAtZero = true;
    return base;
  }
  function legend(items) {
    return items.map(function (it) {
      return "<span><i style='background:" + esc(it.color) + "'" + (it.dash ? " class='dash'" : "") + (it.hatch ? " class='hatch'" : "") + "></i>" + esc(it.label) + "</span>";
    }).join("");
  }

  /* ---------- the section's state across a mount ---------- */
  var LIVE = [];      /* Chart.js instances drawn by the last mount */
  var RESTATED = {};  /* key → { "p|g|c": entry } */
  function restatedText(F, key, cats, c) {
    var m = RESTATED[key]; if (!m) return null;
    return function (i) {
      var cat = cats[i]; if (!cat) return null;
      var e = m[cat.x + "|" + cat.g + "|" + (c || "")];
      if (!e) return null;
      return "restated from " + F.byUnit(e.from, e.unit) + " (" + (e.fromEdition || e.fromVintage) + " edition)";
    };
  }
  function keySpan(k) { return "<span class='df-key' data-metric='" + esc(k) + "'>" + esc(k) + "</span>"; }
  function keysFoot(S, keys) {
    var F = S.fmt, seen = {}, out = [];
    keys.forEach(function (k) { var c = S.canonical(k) || k; if (!seen[c]) { seen[c] = true; out.push(keySpan(c)); } });
    return out.join(" · ");
  }
  function stampFoot(S, keys, extra) {
    var st = S.stamp(LCD), asOfs = [];
    keys.forEach(function (k) { var e = S.get(k); if (e && e.asOf && asOfs.indexOf(e.asOf) < 0) asOfs.push(e.asOf); });
    asOfs.sort();
    var dataTo = asOfs.length && asOfs[0] !== (S.sources()[LCD] || {}).asOf ? " · data through " + S.fmt.dateStamp(asOfs[0]) : "";
    return "<p class='tile-foot'>" + esc(st) + esc(dataTo) + (extra ? " · " + esc(extra) : "") + " · " + keysFoot(S, keys) + "</p>";
  }
  function chartShell(id, title, controls, cls) {
    return "<article class='df-chart " + esc(cls || "") + "' data-chart='" + esc(id) + "'>" +
      "<div class='df-chart-head'><h3><span class='h-pop' data-metric='df" + esc(id) + "'>" + esc(id) + " · " + esc(title) + "</span></h3>" +
      "<div class='chart-controls'>" + (controls || "") + "</div></div>" +
      "<div class='df-body' data-body='" + esc(id) + "'></div>" +
      "<p class='chart-caption' data-caption='" + esc(id) + "'></p>" +
      "<div class='df-foot' data-foot='" + esc(id) + "'></div></article>";
  }
  function box(id, label, cls) {
    return "<div class='chart-box df-box " + esc(cls || "") + "'><canvas data-canvas='" + esc(id) + "' role='img' aria-label='" + esc(label) + "'></canvas></div>";
  }
  function seg(name, items) {
    return "<div class='seg' role='group' aria-label='" + esc(name) + "'>" + items.map(function (it, i) {
      return "<button type='button' data-seg='" + esc(name) + "' data-value='" + esc(it.value) + "' aria-pressed='" + (i === 0 ? "true" : "false") + "'>" + esc(it.label) + "</button>";
    }).join("") + "</div>";
  }
  function notInEdition(S, host, keys, what) {
    var missing = keys.filter(function (k) { return !S.has(k); });
    var msg = (what || "This chart") + " is not in this edition" + (missing.length ? ": " + missing.join(", ") + " not found" : "") + ".";
    host.innerHTML = "<div class='chart-box df-box'></div>";
    var b = host.firstChild;
    var p = document.createElement("p"); p.className = "chart-empty";
    var t = document.createElement("span"); t.textContent = msg; p.appendChild(t); b.appendChild(p);
  }
  function draw(ctx, canvas, config) {
    if (!canvas) return null;
    if (!ctx.Chart) { ctx.chart.empty(canvas.parentNode, "The chart library did not load; the caption and the footer stand on their own."); return null; }
    var ch = ctx.chart.make(canvas, config);
    if (ch) LIVE.push(ch);
    return ch;
  }
  function setCaption(host, id, text) { var el = host.querySelector("[data-caption='" + id + "']"); if (el) el.textContent = text || ""; }
  function setFoot(host, id, html) { var el = host.querySelector("[data-foot='" + id + "']"); if (el) el.innerHTML = html || ""; }
  function bodyOf(host, id) { return host.querySelector("[data-body='" + id + "']"); }
  function canvasOf(host, id) { return host.querySelector("[data-canvas='" + id + "']"); }
  function slotNote(text) { return "<p class='df-slot'><span>" + esc(text) + "</span></p>"; }
  /* LCD's BDC population ("over 100 BDC portfolios") read off the series'
     own population field through the loader, never typed */
  function lcdN(S) {
    return typeof S.populationN === "function" ? S.populationN(S.has("lcd_bdc_all_in_rate_quarterly") ? "lcd_bdc_all_in_rate_quarterly" : "lcd_bdc_spread_dist_count_2q26") : "the BDC portfolios LCD tracks";
  }
  /* the slot note under a chart whose composite series is still to come */
  function compositeSlot(S, what, read) {
    return "The site composite's " + (what || "series") + " arrives with the holdings release (data/bdc/composite.json); LCD's population is " + lcdN(S) + ", the site's the listed BDCs — " + (read || "direction, not level") + ".";
  }

  /* ---------- the composite view (credit.js normalizeComposite), read defensively ---------- */
  function compositeN(c) { return c && isNum(c.n) ? c.n : null; }
  /* the spread histogram by count as { "450-499": share } */
  function compositeBuckets(c) {
    var list = c && c.histogram && Array.isArray(c.histogram.byCount) ? c.histogram.byCount : null;
    if (!list) return null;
    var by = {}; list.forEach(function (b) { if (b && b.label && isNum(b.share)) by[String(b.label).replace(/\s*-\s*/g, "-")] = b.share; });
    return Object.keys(by).length ? by : null;
  }
  /* the latest quarter's cost-weighted all-in yield, a fraction in the
     view, as the percent points LCD's series is drawn in */
  function compositeYield(c) { return c && c.latest && isNum(c.latest.allInYield) ? c.latest.allInYield * 100 : null; }
  function compositeYieldN(c) { return c && c.latest && isNum(c.latest.n) ? c.latest.n : compositeN(c); }
  /* the maturity wall as { "2031-2033": $B at cost } */
  function compositeWall(c) {
    if (!c || !Array.isArray(c.maturityWall)) return null;
    var by = {}; c.maturityWall.forEach(function (b) { if (b && b.label && isNum(b.cost)) by[String(b.label).replace(/\s*-\s*/g, "-")] = b.cost; });
    return Object.keys(by).length ? by : null;
  }
  /* the sector mix as { label: share } */
  function compositeSectors(c) {
    if (!c || !Array.isArray(c.sectors)) return null;
    var by = {}; c.sectors.forEach(function (b) { if (b && b.label && isNum(b.share)) by[b.label] = b.share; });
    return Object.keys(by).length ? by : null;
  }

  /* ---------- the model: every figure the tiles, captions and facts print ---------- */
  function model(S, ctx) {
    var F = S.fmt, m = {};
    var has = function (keys) { return keys.every(function (k) { return S.has(k); }); };

    /* D1: three windows */
    if (has(KEYS.D1)) {
      var v = windows(S, "lcd_dl_volume_quarterly"), n = windows(S, "lcd_dl_count_quarterly");
      if (v && n && v.rolling && n.rolling && v.firstQ && n.firstQ) {
        m.d1 = { v: v, n: n, avg: v.rolling.y * 1000 / n.rolling.y, avgQ1: v.firstQ.y * 1000 / n.firstQ.y,
          win: winLabel(F, v.rolling), overlap: overlapText(F, v.lastQ) };
        m.d1.caption = CAPTIONS.d1.template({ l3m: F.B(v.rolling.y), n: F.count(n.rolling.y), win: m.d1.win,
          dir: relWord(v.rolling.y, v.lastQ.y, "up", "down", "level"), q2: F.B(v.lastQ.y), n2: F.count(n.lastQ.y), q2l: F.quarter(v.lastQ.x),
          rel: relWord(v.rolling.y, v.firstQ.y, "above", "short of", "level with"), q1l: F.quarter(v.firstQ.x), q1: F.B(v.firstQ.y), n1: F.count(n.firstQ.y), avg: F.M(m.d1.avg) });
      }
    }
    /* D2: YTD and the attribution */
    if (has(KEYS.D2)) {
      var tv = ytdPair(S, "lcd_dl_volume_annual"), tc = ytdPair(S, "lcd_dl_count_annual"), sv = ytdPair(S, "lcd_dl_sponsor_volume_annual"), sc = ytdPair(S, "lcd_dl_sponsor_count_annual");
      if (tv && tv.prev && tc && tc.prev && sv && sv.prev) {
        var ns = tv.cur.y - sv.cur.y, nsPrev = tv.prev.y - sv.prev.y;
        m.d2 = { tv: tv, tc: tc, sv: sv, sc: sc, gap: tv.cur.y / tv.prev.y - 1, gapN: tc.cur.y / tc.prev.y - 1, sGap: sv.cur.y / sv.prev.y - 1,
          ns: ns, nsPrev: nsPrev, nsGap: nsPrev ? ns / nsPrev - 1 : null, sShare: sv.cur.y / tv.cur.y, sSharePrev: sv.prev.y / tv.prev.y };
        m.d2.caption = CAPTIONS.d2.template({ ytd: F.B(tv.cur.y), gap: F.change(Math.abs(m.d2.gap)).replace("+", ""), rel: m.d2.gap < 0 ? "behind" : "ahead of", prior: F.B(tv.prev.y), gapN: F.change(m.d2.gapN),
          sDir: m.d2.sGap < 0 ? "fell" : "rose", sGap: F.change(Math.abs(m.d2.sGap)).replace("+", ""), s: F.B(sv.cur.y), nsDir: isNum(m.d2.nsGap) && m.d2.nsGap < 0 ? "fell" : "rose",
          nsGap: isNum(m.d2.nsGap) ? F.change(Math.abs(m.d2.nsGap)).replace("+", "") : "—", ns: F.B(ns) });
      }
    }
    /* D3: sponsor and buyout windows */
    if (has(KEYS.D3)) {
      var lv = windows(S, "lcd_dl_lbo_volume_quarterly"), ln = windows(S, "lcd_dl_lbo_count_quarterly"), ly = ytdPair(S, "lcd_dl_lbo_volume_annual"), lyc = ytdPair(S, "lcd_dl_lbo_count_annual");
      var spv = windows(S, "lcd_dl_sponsor_volume_quarterly"), spn = windows(S, "lcd_dl_sponsor_count_quarterly");
      if (lv && ln && lv.rolling && ln.rolling && lv.firstQ && ly && ly.prev && spv && spn) {
        m.d3 = { lv: lv, ln: ln, ly: ly, lyc: lyc, spv: spv, spn: spn, gap: ly.cur.y / ly.prev.y - 1, gapN: lyc && lyc.prev ? lyc.cur.y / lyc.prev.y - 1 : null };
        m.d3.caption = CAPTIONS.d3.template({ l3m: F.B(lv.rolling.y), n: F.count(ln.rolling.y), relQ2: relWord(lv.rolling.y, lv.lastQ.y, "above", "below", "level with"), q2l: F.quarter(lv.lastQ.x), q2: F.B(lv.lastQ.y),
          relQ1: relWord(lv.rolling.y, lv.firstQ.y, "above", "below", "level with"), q1l: F.quarter(lv.firstQ.x), q1: F.B(lv.firstQ.y),
          ytd: F.B(ly.cur.y), ytdRel: m.d3.gap < 0 ? "trails" : "leads", prior: F.B(ly.prev.y), gap: F.change(m.d3.gap) });
      }
    }
    /* D4: use of proceeds */
    if (has(KEYS.D4)) {
      var uses = [["lbo_ma", "LBO / M&A"], ["refi", "Refinancing"], ["recap", "Recapitalization"], ["other", "Other"]];
      var w0 = windows(S, "lcd_dl_pe_count_lbo_ma_quarterly");
      if (w0 && w0.rolling && w0.firstQ) {
        var at = function (pt) { return uses.map(function (u) { var p = S.at("lcd_dl_pe_count_" + u[0] + "_quarterly", pt.x, pt.g); return p && isNum(p.y) ? p.y : 0; }); };
        var l3 = at(w0.rolling), q1v = at(w0.firstQ), tot = sum(l3), tot1 = sum(q1v);
        m.d4 = { uses: uses, l3: l3, q1: q1v, total: tot, totalQ1: tot1, win: winLabel(F, w0.rolling), q1l: F.quarter(w0.firstQ.x) };
        if (tot > 0 && tot1 > 0) {
          m.d4.caption = CAPTIONS.d4.template({ lbo: F.share(l3[0] / tot), total: F.count(tot), q1: F.share(q1v[0] / tot1), q1l: m.d4.q1l,
            refi: F.share(l3[1] / tot), recap: F.share(l3[2] / tot), other: F.share(l3[3] / tot) });
        }
      }
    }
    /* D5: sectors */
    if (has(KEYS.D5)) {
      var s25 = S.snapshot("lcd_dl_sector_share_count_2025"), s26 = S.snapshot("lcd_dl_sector_share_count_2026ytd");
      if (s25 && s26) {
        var prevBy = {}; s25.items.forEach(function (i) { prevBy[i.c] = i.v; });
        var rows = s26.items.map(function (i) { var pv = prevBy[i.c]; return { c: i.c, now: i.v, prev: isNum(pv) ? pv : null, chg: isNum(pv) ? (i.v - pv) * 100 : null, small: i.v < 0.03 || (isNum(pv) && pv < 0.03) }; })
          .sort(function (a, b) { return b.now - a.now; });
        var mover = rows.filter(function (r) { return isNum(r.chg); }).sort(function (a, b) { return Math.abs(b.chg) - Math.abs(a.chg); })[0];
        var curPt = S.latest("lcd_dl_sector_share_count_2026ytd"), prevPt = S.latest("lcd_dl_sector_share_count_2025");
        m.d5 = { rows: rows, mover: mover, period: curPt ? (curPt.g === "ytd" ? yearOf(curPt.x) + " YTD" : F.period(curPt)) : "YTD", prevLabel: prevPt ? F.period(prevPt) : "the prior year" };
        if (rows.length && mover) {
          m.d5.caption = CAPTIONS.d5.template({ leader: rows[0].c, share: F.share(rows[0].now), period: m.d5.period, chg: F.signed(rows[0].chg, 1, " pts"),
            mover: mover.c, dir: mover.chg < 0 ? "down" : "up", pts: Math.abs(mover.chg).toFixed(1) + " points", now: F.share(mover.now) });
        }
      }
    }
    /* D6: spreads and the recent buckets */
    if (has(KEYS.D6)) {
      var lbo = windows(S, "lcd_dl_lbo_spread_recent"), pe = windows(S, "lcd_dl_pe_spread_recent");
      if (lbo && pe && lbo.rolling && pe.rolling && lbo.firstQ && pe.firstQ) {
        var bAt = function (set, b, pt) { var p = S.at("lcd_dl_" + set + "_spread_bucket_" + b + "_recent", pt.x, pt.g); return p && isNum(p.y) ? p.y : null; };
        var lboNow = BUCKETS_RECENT.map(function (b) { return { b: b, now: bAt("lbo", b, lbo.rolling), q1: bAt("lbo", b, lbo.firstQ) }; });
        var modal = lboNow.slice().sort(function (a, b) { return (b.now || 0) - (a.now || 0); })[0];
        var displaced = lboNow.filter(function (r) { return isNum(r.now) && isNum(r.q1); }).sort(function (a, b) { return (a.now - a.q1) - (b.now - b.q1); })[0];
        m.d6 = { lbo: lbo, pe: pe, d: lbo.rolling.y - lbo.firstQ.y, dpe: pe.rolling.y - pe.firstQ.y, inside: pe.rolling.y - lbo.rolling.y, modal: modal, displaced: displaced, win: winLabel(F, lbo.rolling), q1l: F.quarter(lbo.firstQ.x) };
        if (modal && displaced) {
          m.d6.caption = CAPTIONS.d6.template({ lbo: F.bps(lbo.rolling.y), d: F.signed(m.d6.d, 0, " bps"), q1l: m.d6.q1l, pe: F.bps(pe.rolling.y), dpe: F.signed(m.d6.dpe, 0, " bps"),
            modal: bucketLabel(modal.b), share: F.share(modal.now), prior: F.share(modal.q1), displaced: bucketLabel(displaced.b), dispPrior: F.share(displaced.q1), dispNow: F.share(displaced.now) });
        }
      }
    }
    /* D7: annual buckets */
    if (has(KEYS.D7)) {
      var series7 = BUCKETS_ANNUAL.map(function (b) { return { b: b, pts: S.pointsOf("lcd_dl_lbo_spread_bucket_" + b + "_annual").filter(hasY) }; });
      var cur7 = last(series7[0].pts);
      if (cur7) {
        var atX = function (s, x, g) { var f = null; s.pts.forEach(function (p) { if (p.x === x && p.g === g) f = p; }); return f; };
        var prev7 = null; series7[0].pts.forEach(function (p) { if (p.g === "year" && p.x < cur7.x) prev7 = p; });
        var nowShares = series7.map(function (s) { var p = atX(s, cur7.x, cur7.g); return { b: s.b, now: p ? p.y : null, prev: prev7 && atX(s, prev7.x, prev7.g) ? atX(s, prev7.x, prev7.g).y : null }; });
        var ranked = nowShares.filter(function (r) { return isNum(r.now); }).sort(function (a, b) { return b.now - a.now; });
        var tail = series7[series7.length - 1], tailPeak = null;
        tail.pts.forEach(function (p) { if (p.g === "year" && (!tailPeak || p.y > tailPeak.y)) tailPeak = p; });
        var tailNow = atX(tail, cur7.x, cur7.g);
        m.d7 = { series: series7, cur: cur7, prev: prev7, ranked: ranked, tailPeak: tailPeak, tailNow: tailNow,
          period: cur7.g === "ytd" ? yearOf(cur7.x) + " YTD" : yearOf(cur7.x) };
        if (ranked.length > 1 && prev7 && tailPeak && tailNow) {
          m.d7.caption = CAPTIONS.d7.template({ modal: bucketLabel(ranked[0].b), share: F.share(ranked[0].now), period: m.d7.period, prior: F.share(ranked[0].prev), priorYear: yearOf(prev7.x),
            second: bucketLabel(ranked[1].b), secondShare: F.share(ranked[1].now), secondPrior: F.share(ranked[1].prev), tail: F.share(tailNow.y), tailPeak: F.share(tailPeak.y), peakYear: yearOf(tailPeak.x) });
        }
      }
    }
    /* D8: the differential on two horizons */
    if (has(["lcd_lbo_spread_diff_dl_vs_bsl_all_annual", "lcd_lbo_spread_diff_dl_vs_bsl_all_quarterly"])) {
      var da = S.pointsOf("lcd_lbo_spread_diff_dl_vs_bsl_all_annual").filter(hasY), dq = windows(S, "lcd_lbo_spread_diff_dl_vs_bsl_all_quarterly");
      var aCur = last(da), aPrev = null; da.forEach(function (p) { if (p.g === "year" && aCur && p.x < aCur.x) aPrev = p; });
      if (aCur && aPrev && dq && dq.rolling && dq.firstQ) {
        m.d8 = { aCur: aCur, aPrev: aPrev, dq: dq, dChange: dq.rolling.y - dq.firstQ.y, aPeriod: aCur.g === "ytd" ? yearOf(aCur.x) + " YTD" : yearOf(aCur.x) };
        /* the B-minus annual pair, when that series is in the edition */
        var db = S.has("lcd_lbo_spread_diff_dl_vs_bsl_bminus_annual") ? S.pointsOf("lcd_lbo_spread_diff_dl_vs_bsl_bminus_annual").filter(hasY) : [];
        var bCur = last(db), bPrev = null; db.forEach(function (p) { if (p.g === "year" && bCur && p.x < bCur.x) bPrev = p; });
        m.d8.bminus = bCur && bPrev ? { aCur: bCur, aPrev: bPrev, aPeriod: bCur.g === "ytd" ? yearOf(bCur.x) + " YTD" : yearOf(bCur.x) } : null;
        m.d8.captionFor = function (bminus) {
          var a = bminus && m.d8.bminus ? m.d8.bminus : m.d8;
          return CAPTIONS.d8.template({ who: bminus && m.d8.bminus ? ", against B-minus BSL borrowers," : "", aDir: relWord(a.aCur.y, a.aPrev.y, "widened", "narrowed", "held"), ytd: F.bps(a.aCur.y), period: a.aPeriod, prior: F.bps(a.aPrev.y), priorYear: yearOf(a.aPrev.x),
            qWho: bminus && m.d8.bminus ? " (all borrowers)" : "", qDir: relWord(dq.rolling.y, dq.firstQ.y, "widened", "narrowed", "held"), l3m: F.bps(dq.rolling.y), d: F.signed(m.d8.dChange, 0, " bps"), q1l: F.quarter(dq.firstQ.x) });
        };
        m.d8.caption = m.d8.captionFor(false);
      }
    }
    /* D9 and D10: channel share */
    var channel = function (dlN, bslN, dlV, bslV) {
      var a = windows(S, dlN), b = windows(S, bslN), c = windows(S, dlV), d = windows(S, bslV);
      if (!(a && b && c && d && a.rolling && b.rolling && c.rolling && d.rolling && c.firstQ && d.firstQ)) return null;
      return { dlN: a, bslN: b, dlV: c, bslV: d,
        cShare: a.rolling.y / (a.rolling.y + b.rolling.y), vShare: c.rolling.y / (c.rolling.y + d.rolling.y),
        dlAvg: a.rolling.y ? c.rolling.y * 1000 / a.rolling.y : null, bslAvg: b.rolling.y ? d.rolling.y * 1000 / b.rolling.y : null,
        dlQ1: c.firstQ.y ? c.rolling.y / c.firstQ.y : null, bslQ1: d.firstQ.y ? d.rolling.y / d.firstQ.y : null };
    };
    if (has(KEYS.D9)) {
      m.d9 = channel("lcd_dl_lbo_count_quarterly_c16", "lcd_bsl_lbo_count_quarterly", "lcd_dl_lbo_volume_quarterly_c17", "lcd_bsl_lbo_volume_quarterly");
      if (m.d9) m.d9.caption = CAPTIONS.d9.template({ dlN: F.count(m.d9.dlN.rolling.y), bslN: F.count(m.d9.bslN.rolling.y), cShare: F.share(m.d9.cShare), vShare: F.share(m.d9.vShare),
        dlV: F.B(m.d9.dlV.rolling.y), bslV: F.B(m.d9.bslV.rolling.y), dlAvg: F.M(m.d9.dlAvg), bslAvg: F.M(m.d9.bslAvg) });
    }
    if (has(KEYS.D10)) {
      m.d10 = channel("lcd_dl_sponsor_count_quarterly_c18", "lcd_bsl_sponsor_count_quarterly", "lcd_dl_sponsor_volume_quarterly_c19", "lcd_bsl_sponsor_volume_quarterly");
      if (m.d10) m.d10.caption = CAPTIONS.d10.template({ cShare: F.share(m.d10.cShare), dlN: F.count(m.d10.dlN.rolling.y), bslN: F.count(m.d10.bslN.rolling.y), vShare: F.share(m.d10.vShare),
        dlV: F.B(m.d10.dlV.rolling.y), bslV: F.B(m.d10.bslV.rolling.y), bslQ1: F.share(m.d10.bslQ1), q1l: F.quarter(m.d10.bslV.firstQ.x), dlQ1: F.share(m.d10.dlQ1) });
    }
    /* D11: global buyouts over $1B */
    if (has(KEYS.D11)) {
      var g = KEYS.D11.map(function (k) { return S.pointsOf(k).filter(hasY); });
      var dlCur = last(g[0]);
      if (dlCur && g[0].length > 1) {
        var dlPrev = g[0][g[0].length - 2], peak = null;
        g[0].forEach(function (p) { if (p.g === "year" && (!peak || p.y > peak.y)) peak = p; });
        var atCur = function (s) { var f = null; s.forEach(function (p) { if (p.x === dlCur.x && p.g === dlCur.g) f = p; }); return f; };
        var bsl = atCur(g[1]), bslOther = atCur(g[2]);
        m.d11 = { series: g, dlCur: dlCur, dlPrev: dlPrev, peak: peak, bsl: bsl, bslOther: bslOther, period: dlCur.g === "half" ? F.half(dlCur.x) : yearOf(dlCur.x) };
        if (bsl && bslOther && peak) {
          m.d11.caption = CAPTIONS.d11.template({ dl: F.share(dlCur.y), period: m.d11.period, chg: F.signed((dlCur.y - dlPrev.y) * 100, 1, " pts"), prior: F.share(dlPrev.y), priorYear: yearOf(dlPrev.x),
            peak: F.share(peak.y), peakYear: yearOf(peak.x), bsl: F.share(bsl.y), bslAll: F.share(bsl.y + bslOther.y) });
        }
      }
    }
    /* D12: CLOs */
    if (has(KEYS.D12)) {
      var cv = windows(S, "lcd_pc_clo_volume_quarterly"), cc = windows(S, "lcd_pc_clo_count_quarterly"), dv = windows(S, "lcd_dl_volume_quarterly");
      if (cv && cc && dv && cv.rolling && cc.rolling && dv.rolling && cv.firstQ && dv.firstQ) {
        var byYear = {}; cv.quarters.forEach(function (p) { var y = yearOf(p.x); (byYear[y] = byYear[y] || []).push(p.y); });
        var fullYear = null; Object.keys(byYear).sort().forEach(function (y) { if (byYear[y].length === 4) fullYear = y; });
        var yearVol = fullYear ? yearPoint(S, "lcd_dl_volume_annual", fullYear) : null;
        m.d12 = { cv: cv, cc: cc, dv: dv, share: cv.rolling.y / dv.rolling.y, shareQ2: cv.lastQ.y / dv.lastQ.y, shareQ1: cv.firstQ.y / dv.firstQ.y,
          fullYear: fullYear, yearClo: fullYear ? sum(byYear[fullYear]) : null, yearShare: fullYear && yearVol && isNum(yearVol.y) ? sum(byYear[fullYear]) / yearVol.y : null };
        m.d12.caption = CAPTIONS.d12.template({ v: F.B(cv.rolling.y), n: F.count(cc.rolling.y), dir: relWord(cv.rolling.y, cv.lastQ.y, "up", "down", "level"), q2: F.B(cv.lastQ.y), q2l: F.quarter(cv.lastQ.x),
          share: F.share(m.d12.share), q2share: F.share(m.d12.shareQ2), y: F.share(m.d12.yearShare), year: fullYear || "the last full year" });
      }
    }
    /* D13: takeouts */
    if (has(KEYS.D13)) {
      var tb = windows(S, "lcd_takeout_dl_refinanced_by_bsl_quarterly"), td = windows(S, "lcd_takeout_bsl_refinanced_by_dl_quarterly"), dvol = windows(S, "lcd_dl_volume_quarterly");
      if (tb && td && dvol && tb.rolling && td.rolling && dvol.rolling) {
        var net = td.rolling.y - tb.rolling.y, netQ2 = td.lastQ.y - tb.lastQ.y;
        var yrs = {}; tb.quarters.forEach(function (p) { var y = yearOf(p.x); (yrs[y] = yrs[y] || { a: [], b: [] }).a.push(p.y); });
        td.quarters.forEach(function (p) { var y = yearOf(p.x); if (yrs[y]) yrs[y].b.push(p.y); });
        var fy = null; Object.keys(yrs).sort().forEach(function (y) { if (yrs[y].a.length === 4 && yrs[y].b.length === 4) fy = y; });
        var netYear = fy ? sum(yrs[fy].b) - sum(yrs[fy].a) : null;
        m.d13 = { tb: tb, td: td, net: net, netQ2: netQ2, fullYear: fy, netYear: netYear, churn: (tb.rolling.y + td.rolling.y) / dvol.rolling.y, win: winLabel(F, tb.rolling) };
        m.d13.caption = CAPTIONS.d13.template({ dir: tb.rolling.y > tb.lastQ.y * 1.5 ? "jumped" : relWord(tb.rolling.y, tb.lastQ.y, "rose", "fell", "held"), toBsl: F.B(tb.rolling.y), toBslQ2: F.B(tb.lastQ.y), q2l: F.quarter(tb.lastQ.x),
          toDl: F.B(td.rolling.y), net: F.B(Math.abs(net)), netDir: net < 0 ? "out of" : "into", netYear: isNum(netYear) ? F.B(Math.abs(netYear)) : "—", netYearDir: isNum(netYear) && netYear < 0 ? "out of it" : "into it", year: fy || "the last full year", churn: F.share(m.d13.churn) });
      }
    }
    /* D14: BDC spread distribution */
    var snapsOf = function (prefix, names) {
      return names.map(function (s) { return { name: s, key: prefix + s, snap: S.has(prefix + s) ? S.snapshot(prefix + s) : null }; }).filter(function (x) { return x.snap; })
        .sort(function (a, b) { return a.snap.p < b.snap.p ? -1 : 1; });
    };
    var bandOf = function (snap) { return sum(snap.items.filter(function (i) { return /^450-499|^500-549/.test(String(i.c).replace(/\s*-\s*/g, "-")); }).map(function (i) { return i.v; })); };
    var all14 = snapsOf("lcd_bdc_spread_dist_count_", BDC_SNAPS), uni14 = snapsOf("lcd_bdc_unitranche_spread_dist_count_", BDC_SNAPS), fl14 = snapsOf("lcd_bdc_first_lien_spread_dist_count_", ["4q25", "1q26", "2q26"]);
    if (all14.length) {
      var latest14 = last(all14).snap, first14 = all14[0].snap;
      var modal14 = latest14.items.reduce(function (a, i) { return !a || i.v > a.v ? i : a; }, null);
      var cb = compositeBuckets(ctx.composite), cn = compositeN(ctx.composite), siteBand = null, siteModal = null;
      if (cb) {
        siteBand = (cb["450-499"] || 0) + (cb["500-549"] || 0);
        Object.keys(cb).forEach(function (k) { if (!siteModal || cb[k] > cb[siteModal]) siteModal = k; });
      }
      m.d14 = { all: all14, uni: uni14, fl: fl14, latest: latest14, first: first14, band: bandOf(latest14), bandPrior: bandOf(first14), modal: modal14,
        uniBand: uni14.length ? bandOf(last(uni14).snap) : null, flBand: fl14.length ? bandOf(last(fl14).snap) : null, site: cb, siteN: cn, siteBand: siteBand, siteModal: siteModal };
      m.d14.caption = CAPTIONS.d14.template({ band: F.share(m.d14.band), prior: F.share(m.d14.bandPrior), priorQ: F.quarterDeck(first14.p), modal: bucketLabel(modal14.c), modalShare: F.share(modal14.v),
        uni: isNum(m.d14.uniBand) ? F.share(m.d14.uniBand) : "—",
        site: cb ? "The site's " + (cn ? F.count(cn) + " " : "") + "listed BDCs hold " + F.share(siteBand) + " in the band, modal " + bucketLabel(siteModal) + ": direction, not level." : "The site composite arrives with the holdings release; direction, not level." });
    }
    /* D15: all-in rate */
    if (has(KEYS.D15)) {
      var ai = S.pointsOf("lcd_bdc_all_in_rate_quarterly").filter(hasY);
      if (ai.length > 1) {
        var lst = last(ai), prv = ai[ai.length - 2], peak15 = ai.reduce(function (a, p) { return !a || p.y > a.y ? p : a; }, null), lowSince = null;
        for (var i = ai.length - 2; i >= 0; i--) { if (ai[i].y < lst.y) { lowSince = ai[i]; break; } }
        var sofr = ctx.fromCredit ? ctx.fromCredit("SOFR90DAYAVG") : null, sofrBy = {};
        ((sofr && sofr.history) || []).forEach(function (h) { sofrBy[String(h.d).slice(0, 7)] = h.v; });
        var sofrAt = function (x) { var v = sofrBy[String(x).slice(0, 7)]; return isNum(v) ? v : null; };
        var cy = compositeYield(ctx.composite);
        m.d15 = { pts: ai, last: lst, prev: prv, peak: peak15, lowSince: lowSince, sofrAt: sofrAt, sofrLast: sofrAt(lst.x), sofrId: sofr ? sofr.id : null, site: cy, siteN: compositeYieldN(ctx.composite) };
        m.d15.caption = CAPTIONS.d15.template({ dir: relWord(lst.y, prv.y, "rose", "fell", "held"), lcd: F.pct(lst.y, 2), q: F.quarter(lst.x), lowQ: lowSince ? F.quarter(lowSince.x) : "the series began (" + F.quarter(ai[0].x) + ")",
          peak: F.pct(peak15.y, 2), peakQ: F.quarter(peak15.x),
          sofr: isNum(m.d15.sofrLast) ? "90-day SOFR was " + F.pct(m.d15.sofrLast, 2) + " at that quarter end, " + F.pctToBps(lst.y - m.d15.sofrLast) + " between them." : "the macro feed has no 90-day SOFR for that quarter end.",
          site: isNum(cy) ? "The site composite is " + F.pct(cy, 2) + (m.d15.siteN ? " on " + F.count(m.d15.siteN) + " BDCs" : "") + ": direction, not level." : "The site composite arrives with the holdings release; direction, not level." });
      }
    }
    /* D16: the wall */
    if (has(KEYS.D16)) {
      var w1 = S.snapshot("lcd_bdc_maturity_wall_usd_2026q1"), w2 = S.snapshot("lcd_bdc_maturity_wall_usd_2026q2"), p1 = S.snapshot("lcd_bdc_maturity_wall_pct_2026q1"), p2 = S.snapshot("lcd_bdc_maturity_wall_pct_2026q2");
      if (w1 && w2 && p1 && p2) {
        var tot2 = sum(w2.items.map(function (i) { return i.v; })), tot1 = sum(w1.items.map(function (i) { return i.v; }));
        var back = last(w2.items), backPrior = last(w1.items), backPct = last(p2.items), backPriorPct = last(p1.items);
        var front2 = w2.items[0].v + w2.items[1].v, front1 = w1.items[0].v + w1.items[1].v;
        var cw = compositeWall(ctx.composite), siteTotal = null, siteBack = null;
        if (cw) { siteTotal = sum(Object.keys(cw).map(function (k) { return cw[k]; })); siteBack = cw["2031-2033"]; }
        m.d16 = { w1: w1, w2: w2, p1: p1, p2: p2, total: tot2, totalPrior: tot1, back: back, backPrior: backPrior, backPct: backPct, backPriorPct: backPriorPct, front: front2, frontPrior: front1,
          pctSum: sum(p2.items.map(function (i) { return i.v; })), site: cw, siteN: compositeN(ctx.composite), siteTotal: siteTotal, siteBack: siteBack };
        m.d16.caption = CAPTIONS.d16.template({ total: F.B(tot2), backDir: relWord(back.v, backPrior.v, "rose", "fell", "held"), back: F.B(back.v), backPct: F.share(backPct.v), backPrior: F.B(backPrior.v), backPriorPct: F.share(backPriorPct.v),
          frontDir: relWord(front2, front1, "grew", "shrank", "held"), front: F.B(front2),
          site: cw ? "The site's " + (m.d16.siteN ? F.count(m.d16.siteN) + " " : "") + "listed BDCs carry " + F.B(siteTotal) + (isNum(siteBack) && siteTotal ? " with " + F.share(siteBack / siteTotal) + " in 2031–2033" : "") + ": shape, not dollars." : "The site composite arrives with the holdings release; shape, not dollars." });
      }
    }
    /* D17: sectors */
    if (has(KEYS.D17)) {
      var c1 = S.snapshot("lcd_bdc_sector_share_count_1q26"), c2 = S.snapshot("lcd_bdc_sector_share_count_2q26");
      if (c1 && c2) {
        var pby = {}; c1.items.forEach(function (i) { pby[i.c] = i.v; });
        var rows17 = c2.items.map(function (i) { var pv = pby[i.c]; return { c: i.c, now: i.v, prev: isNum(pv) ? pv : null, chg: isNum(pv) ? (i.v - pv) * 100 : null }; }).sort(function (a, b) { return b.now - a.now; });
        var mv = rows17.filter(function (r) { return isNum(r.chg); }).sort(function (a, b) { return Math.abs(b.chg) - Math.abs(a.chg); })[0];
        var cs = compositeSectors(ctx.composite), siteTop = null;
        if (cs) Object.keys(cs).forEach(function (k) { if (!siteTop || cs[k] > cs[siteTop]) siteTop = k; });
        m.d17 = { rows: rows17, mover: mv, prevQ: F.quarterDeck(c1.p), curQ: F.quarterDeck(c2.p), site: cs, siteTop: siteTop, verdict: mv && Math.abs(mv.chg) >= 1 ? "shifted" : "essentially unchanged" };
        if (rows17.length > 1 && mv) {
          m.d17.caption = CAPTIONS.d17.template({ verdict: m.d17.verdict, top: rows17[0].c, share: F.share(rows17[0].now), chg: F.signed(rows17[0].chg, 2, " pts"), second: rows17[1].c, share2: F.share(rows17[1].now), chg2: F.signed(rows17[1].chg, 2, " pts"),
            move: mv.c === rows17[0].c || mv.c === rows17[1].c ? "no sector moved more than " + Math.abs(mv.chg).toFixed(2) + " pts" : "largest move " + mv.c + " " + F.signed(mv.chg, 2, " pts"),
            site: cs && siteTop ? "Site composite: " + siteTop + " " + F.share(cs[siteTop]) + " largest, on the filers' taxonomy." : "Composite marker after the holdings release." });
        }
      }
    }
    return m;
  }

  /* ---------- the tiles ---------- */
  function tile(key, label, asOf, valueHtml, change, reading, foot) {
    return "<div class='tile' data-tile='" + esc(key) + "'><div class='tile-head'><button type='button' class='tile-label' data-metric='" + esc(key) + "'><span>" + esc(label) + "</span></button>" +
      "<span class='tile-asof'>" + esc(asOf) + "</span></div>" +
      "<span class='tile-value'>" + valueHtml + "</span>" + (change ? "<span class='tile-change'>" + esc(change) + "</span>" : "") +
      "<p class='tile-reading'>" + reading + "</p><p class='tile-foot'>" + foot + "</p></div>";
  }
  function naTile(key, label, why, keys) {
    return "<div class='tile' data-tile='" + esc(key) + "'><div class='tile-head'><button type='button' class='tile-label' data-metric='" + esc(key) + "'><span>" + esc(label) + "</span></button></div>" +
      "<span class='tile-value na'>not in this edition</span><p class='tile-reading'>" + esc(why) + "</p><p class='tile-foot'>" + keys.map(keySpan).join(" · ") + "</p></div>";
  }
  function regime(word, rest) { return "<span class='regime'>" + esc(word) + "</span> — " + esc(rest); }
  function renderTiles(S, m) {
    var F = S.fmt, out = [], st = esc(S.stamp(LCD));
    if (m.d1) {
      var d = m.d1;
      out.push(tile("dfWindows", "Direct lending, three windows", d.win,
        esc(F.B(d.v.rolling.y)) + "<span class='unit'> · " + esc(F.count(d.n.rolling.y)) + " deals</span>",
        F.quarter(d.v.lastQ.x) + " " + F.B(d.v.lastQ.y) + " · " + F.count(d.n.lastQ.y) + "; " + F.quarter(d.v.firstQ.x) + " " + F.B(d.v.firstQ.y) + " · " + F.count(d.n.firstQ.y),
        regime(d.v.rolling.y < d.v.firstQ.y ? "Below the early-year run rate" : "At or above the early-year run rate",
          "average deal " + F.M(d.avg) + " against " + F.M(d.avgQ1) + " in " + F.quarter(d.v.firstQ.x) + "; the rolling window " + d.overlap),
        st + " · " + keysFoot(S, KEYS.D1)));
    } else out.push(naTile("dfWindows", "Direct lending, three windows", "The quarterly count or volume series did not answer.", KEYS.D1));
    if (m.d2) {
      var e = m.d2;
      out.push(tile("dfYtd", "YTD pace against last year", "YTD to " + F.date(e.tv.cur.x),
        esc(F.change(e.gap)) + "<span class='unit'> volume</span>", "count " + F.change(e.gapN) + " · " + F.B(e.tv.cur.y) + " against " + F.B(e.tv.prev.y),
        regime(e.sGap < 0 && (e.nsGap === null || e.nsGap >= 0) ? "Sponsor-driven gap" : e.sGap >= 0 && isNum(e.nsGap) && e.nsGap < 0 ? "Non-sponsor gap" : "Both segments moved",
          "sponsor-backed " + F.change(e.sGap) + " to " + F.B(e.sv.cur.y) + ", non-sponsor (residual) " + F.change(e.nsGap) + " to " + F.B(e.ns) + "; sponsors' share " + F.share(e.sShare) + " from " + F.share(e.sSharePrev)),
        st + " · " + keysFoot(S, KEYS.D2)));
    } else out.push(naTile("dfYtd", "YTD pace against last year", "The annual series lack a YTD pair.", KEYS.D2));
    if (m.d6) {
      var s6 = m.d6;
      out.push(tile("dfSpread", "New-issue LBO spread", s6.win, esc(F.bps(s6.lbo.rolling.y)), F.signed(s6.d, 0, " bps") + " on " + s6.q1l + " · PE-backed " + F.bps(s6.pe.rolling.y) + " (" + F.signed(s6.dpe, 0, " bps") + ")",
        regime(s6.d > 0 ? "Wider" : s6.d < 0 ? "Tighter" : "Unchanged", "LBOs price " + Math.abs(Math.round(s6.inside)) + " bps " + (s6.inside >= 0 ? "inside" : "outside") + " PE-backed deals; 2026 includes privately sourced values, not strictly comparable with prior years"),
        st + " · " + keysFoot(S, ["lcd_dl_lbo_spread_recent", "lcd_dl_pe_spread_recent"])));
    } else out.push(naTile("dfSpread", "New-issue LBO spread", "The recent spread series did not answer.", ["lcd_dl_lbo_spread_recent", "lcd_dl_pe_spread_recent"]));
    if (m.d8) {
      var s8 = m.d8;
      out.push(tile("dfDifferential", "BSL–DL differential, two horizons", winLabel(F, s8.dq.rolling),
        esc(F.bps(s8.aCur.y)) + "<span class='unit'> " + esc(s8.aPeriod) + "</span>",
        "past three months " + F.bps(s8.dq.rolling.y) + " (" + F.signed(s8.dChange, 0, " bps") + " on " + F.quarter(s8.dq.firstQ.x) + ") · " + yearOf(s8.aPrev.x) + " " + F.bps(s8.aPrev.y),
        regime(relWord(s8.aCur.y, s8.aPrev.y, "w", "n", "l") !== relWord(s8.dq.rolling.y, s8.dq.firstQ.y, "w", "n", "l") ? "The two horizons disagree" : "The two horizons agree",
          "the annual read " + relWord(s8.aCur.y, s8.aPrev.y, "widened", "narrowed", "held") + ", the three-month read " + relWord(s8.dq.rolling.y, s8.dq.firstQ.y, "widened", "narrowed", "held") + "; the differential is the price of certainty of execution"),
        st + " · " + keysFoot(S, ["lcd_lbo_spread_diff_dl_vs_bsl_all_annual", "lcd_lbo_spread_diff_dl_vs_bsl_all_quarterly"])));
    } else out.push(naTile("dfDifferential", "BSL–DL differential, two horizons", "The differential series did not answer.", ["lcd_lbo_spread_diff_dl_vs_bsl_all_annual", "lcd_lbo_spread_diff_dl_vs_bsl_all_quarterly"]));
    if (m.d9) {
      var s9 = m.d9;
      out.push(tile("dfChannel", "Direct-lending share of LBOs", winLabel(F, s9.dlN.rolling), esc(F.share(s9.cShare)) + "<span class='unit'> by count</span> · " + esc(F.share(s9.vShare)) + "<span class='unit'> by volume</span>",
        F.count(s9.dlN.rolling.y) + " against " + F.count(s9.bslN.rolling.y) + " deals · " + F.B(s9.dlV.rolling.y) + " against " + F.B(s9.bslV.rolling.y),
        regime(s9.cShare > s9.vShare ? "Count leads volume" : "Volume leads count", "average deal " + F.M(s9.dlAvg) + " in direct lending against " + F.M(s9.bslAvg) + " in BSL"),
        st + " · " + keysFoot(S, KEYS.D9)));
    } else out.push(naTile("dfChannel", "Direct-lending share of LBOs", "The channel series did not answer.", KEYS.D9));
    if (m.d13) {
      var s13 = m.d13;
      out.push(tile("dfTakeouts", "Takeouts, net flow", s13.win, esc((s13.net < 0 ? "−" : "+") + F.B(Math.abs(s13.net))) + "<span class='unit'> net " + (s13.net < 0 ? "out of" : "into") + " direct lending</span>",
        "to BSL " + F.B(s13.tb.rolling.y) + " · to direct lending " + F.B(s13.td.rolling.y) + " · " + F.quarter(s13.tb.lastQ.x) + " net " + (s13.netQ2 < 0 ? "−" : "+") + F.B(Math.abs(s13.netQ2)),
        regime(s13.net < 0 ? "Syndicated market repricing direct-lending paper" : "Direct lending taking share", "gross churn " + F.share(s13.churn) + " of direct-lending volume" + (s13.fullYear ? "; " + s13.fullYear + " net " + (s13.netYear < 0 ? "−" : "+") + F.B(Math.abs(s13.netYear)) : "")),
        st + " · " + keysFoot(S, KEYS.D13)));
    } else out.push(naTile("dfTakeouts", "Takeouts, net flow", "The takeout series did not answer.", KEYS.D13));
    return out.join("");
  }

  /* ---------- dumbbells (D5, D17): HTML rows, readable at phone width ---------- */
  function dumbbell(F, rows, o) {
    var max = 0;
    rows.forEach(function (r) { max = Math.max(max, r.now || 0, r.prev || 0, r.site || 0); });
    if (!max) max = 1;
    var X = function (v) { return (100 * v / (max * 1.12)).toFixed(2) + "%"; };
    var out = "<div class='db'>";
    rows.forEach(function (r) {
      var title = r.c + ": " + o.prevLabel + " " + (isNum(r.prev) ? F.share(r.prev) : "—") + ", " + o.curLabel + " " + F.share(r.now) + (isNum(r.chg) ? " (" + F.signed(r.chg, o.dp || 1, " pts") + ")" : "") + (r.small ? " · small base, under 3%" : "") + (isNum(r.site) ? "; site composite " + F.share(r.site) : "");
      out += "<div class='db-row" + (r.small ? " small" : "") + "' title='" + esc(title) + "'><span class='db-label'>" + esc(r.c) + (r.small ? "<i class='db-small' aria-label='small base'>◦</i>" : "") + "</span><span class='db-track'>";
      if (isNum(r.prev)) {
        var a = Math.min(r.prev, r.now), b = Math.max(r.prev, r.now);
        out += "<i class='db-line' style='left:" + X(a) + ";width:" + (100 * (b - a) / (max * 1.12)).toFixed(2) + "%'></i><b class='db-a' style='left:" + X(r.prev) + "'></b>";
      }
      out += "<b class='db-b' style='left:" + X(r.now) + "'></b>";
      if (isNum(r.site)) out += "<b class='db-site' style='left:" + X(r.site) + "'></b>";
      out += "</span><span class='db-val'>" + esc(F.share(r.now)) + (isNum(r.chg) ? " <em>" + esc(F.signed(r.chg, o.dp || 1, "")) + "</em>" : "") + "</span></div>";
    });
    return out + "</div>";
  }

  /* ---------- the charts ---------- */
  function drawD1(S, ctx, host, m) {
    var F = S.fmt, id = "D1", body = bodyOf(host, id);
    if (!m.d1) { notInEdition(S, body, KEYS.D1); setFoot(host, id, stampFoot(S, KEYS.D1)); return; }
    var A = align(S, KEYS.D1, ["quarter", "rolling3m"]), cats = A.cats;
    body.innerHTML = box(id, "Direct-lending deal count and estimated volume, quarterly");
    var counts = A.data.lcd_dl_count_quarterly, vols = A.data.lcd_dl_volume_quarterly;
    draw(ctx, canvasOf(host, id), { type: "bar", data: { labels: cats.map(function (c) { return c.label; }), datasets: [
      { type: "line", label: "Estimated volume", data: vols, yAxisID: "y1", borderColor: GOLD, backgroundColor: BG, borderWidth: 2, pointRadius: pointRadii(cats), pointHoverRadius: 5, pointBorderColor: GOLD, pointBorderWidth: 2, tension: 0, spanGaps: true, order: 0, fmt: function (v) { return F.B(v); }, restated: restatedText(F, "lcd_dl_volume_quarterly", cats) },
      { label: "Deal count", data: counts, backgroundColor: barColors(cats, BAR), borderWidth: 0, order: 1, fmt: F.count, restated: restatedText(F, "lcd_dl_count_quarterly", cats),
        extra: function (i, v) { var vol = vols[i]; return isNum(vol) && v ? "average deal " + F.M(vol * 1000 / v) : null; } }
    ] }, options: options(ctx, cats, { yfmt: F.count, unit: "deals", y1: true, y1fmt: function (v) { return F.B(v, 0); }, y1unit: "$B" }), plugins: [overlapPlugin(cats, m.d1.overlap)] });
    host.querySelector("[data-legend='D1']").innerHTML = legend([{ color: BAR, label: "deal count (columns)" }, { color: GOLD, label: "estimated volume, $B (line)" }, { color: GOLD, hatch: true, label: "rolling three months, " + m.d1.overlap }]);
    setCaption(host, id, m.d1.caption);
    setFoot(host, id, stampFoot(S, KEYS.D1, "deal count is based on transactions covered by LCD News; volume estimated where undisclosed"));
  }
  function drawD2(S, ctx, host, m) {
    var F = S.fmt, id = "D2", body = bodyOf(host, id);
    if (!m.d2) { notInEdition(S, body, KEYS.D2); setFoot(host, id, stampFoot(S, KEYS.D2)); return; }
    var A = align(S, ["lcd_dl_volume_annual", "lcd_dl_sponsor_volume_annual", "lcd_dl_count_annual"], ["year", "ytd"], true), cats = A.cats;
    var tot = A.data.lcd_dl_volume_annual, sp = A.data.lcd_dl_sponsor_volume_annual;
    var nonsp = tot.map(function (t, i) { return isNum(t) && isNum(sp[i]) ? t - sp[i] : null; });
    body.innerHTML = box(id, "Annual and YTD direct-lending volume, sponsor-backed against non-sponsor, with deal count");
    draw(ctx, canvasOf(host, id), { type: "bar", data: { labels: cats.map(function (c) { return c.label; }), datasets: [
      { type: "line", label: "Deal count", data: A.data.lcd_dl_count_annual, yAxisID: "y1", borderColor: LINE2, backgroundColor: BG, borderWidth: 2, borderDash: [5, 4], pointRadius: pointRadii(cats, 4), pointBorderColor: LINE2, pointBorderWidth: 2, tension: 0, spanGaps: true, order: 0, fmt: F.count, restated: restatedText(F, "lcd_dl_count_annual", cats) },
      { label: "Sponsor-backed volume", data: sp, backgroundColor: barColors(cats, GOLD), borderWidth: 0, order: 1, fmt: function (v) { return F.B(v); }, restated: restatedText(F, "lcd_dl_sponsor_volume_annual", cats) },
      { label: "Non-sponsor volume (residual)", data: nonsp, backgroundColor: barColors(cats, BAR), borderWidth: 0, order: 1, fmt: function (v) { return F.B(v); },
        extra: function (i) { return isNum(tot[i]) ? "total " + F.B(tot[i]) : null; } }
    ] }, options: options(ctx, cats, { yfmt: function (v) { return F.B(v, 0); }, unit: "$B", stacked: true, everyTick: true, autoSkip: true, y1: true, y1fmt: F.count, y1unit: "deals" }) });
    host.querySelector("[data-legend='D2']").innerHTML = legend([{ color: GOLD, label: "sponsor-backed volume" }, { color: BAR, label: "non-sponsor volume (residual)" }, { color: LINE2, dash: true, label: "deal count (line)" }, { color: BAR, hatch: true, label: "YTD columns, partial years" }]);
    setCaption(host, id, m.d2.caption);
    setFoot(host, id, stampFoot(S, KEYS.D2, "YTD to " + F.date(m.d2.tv.cur.x) + " against the same months of " + yearOf(m.d2.tv.prev.x)));
  }
  /* a count-and-volume panel: quarterly with the rolling point, or
     annual with the YTD columns, on the narrow panel's short year ticks */
  function comboPanel(S, ctx, host, cid, countKey, volKey, overlap, annual) {
    var F = S.fmt, A = align(S, [countKey, volKey], annual ? ["year", "ytd"] : ["quarter", "rolling3m"], !!annual), cats = A.cats;
    var counts = A.data[countKey], vols = A.data[volKey];
    draw(ctx, canvasOf(host, cid), { type: "bar", data: { labels: cats.map(function (c) { return c.label; }), datasets: [
      { type: "line", label: "Volume", data: vols, yAxisID: "y1", borderColor: GOLD, backgroundColor: BG, borderWidth: 2, pointRadius: pointRadii(cats), pointBorderColor: GOLD, pointBorderWidth: 2, tension: 0, spanGaps: true, order: 0, fmt: function (v) { return F.B(v); }, restated: restatedText(F, volKey, cats) },
      { label: "Count", data: counts, backgroundColor: barColors(cats, BAR), borderWidth: 0, order: 1, fmt: F.count, restated: restatedText(F, countKey, cats),
        extra: function (i, v) { var vol = vols[i]; return isNum(vol) && v ? "average deal " + F.M(vol * 1000 / v) : null; } }
    ] }, options: options(ctx, cats, { yfmt: F.count, unit: "deals", y1: true, y1fmt: function (v) { return F.B(v, 0); }, y1unit: "$B", shortYears: true, everyTick: !!annual, rotate: !!annual }),
      plugins: overlap ? [overlapPlugin(cats, overlap)] : [] });
  }
  function drawD3(S, ctx, host, m) {
    var F = S.fmt, id = "D3", body = bodyOf(host, id);
    if (!m.d3) { notInEdition(S, body, KEYS.D3); setFoot(host, id, stampFoot(S, KEYS.D3)); return; }
    var overlap = overlapText(F, m.d3.lv.lastQ);
    body.innerHTML = "<div class='df-panels df-panels-3'><div><p class='df-panel-title'>Sponsor-backed borrowers, quarterly</p>" + box("D3a", "Sponsor-backed direct lending, count and volume, quarterly") + "</div>" +
      "<div><p class='df-panel-title'>Deals financing buyouts, quarterly</p>" + box("D3b", "Buyout direct lending, count and volume, quarterly") + "</div>" +
      "<div><p class='df-panel-title'>Deals financing buyouts, annual and YTD</p>" + box("D3c", "Buyout direct lending, count and volume, annual with the YTD columns") + "</div></div>";
    comboPanel(S, ctx, host, "D3a", "lcd_dl_sponsor_count_quarterly", "lcd_dl_sponsor_volume_quarterly", overlap);
    comboPanel(S, ctx, host, "D3b", "lcd_dl_lbo_count_quarterly", "lcd_dl_lbo_volume_quarterly", overlap);
    comboPanel(S, ctx, host, "D3c", "lcd_dl_lbo_count_annual", "lcd_dl_lbo_volume_annual", null, true);
    host.querySelector("[data-legend='D3']").innerHTML = legend([{ color: BAR, label: "deal count (columns)" }, { color: GOLD, label: "volume, $B (line)" }, { color: GOLD, hatch: true, label: "rolling three months, " + overlap }, { color: BAR, hatch: true, label: "YTD columns, partial years" }]);
    setCaption(host, id, m.d3.caption);
    setFoot(host, id, stampFoot(S, KEYS.D3, "sponsor-backed " + F.B(m.d3.spv.rolling.y) + " across " + F.count(m.d3.spn.rolling.y) + " deals in the past three months; YTD buyouts " + F.count(m.d3.lyc && m.d3.lyc.cur ? m.d3.lyc.cur.y : null) + " deals against " + F.count(m.d3.lyc && m.d3.lyc.prev ? m.d3.lyc.prev.y : null) + " in the same months of " + (m.d3.ly.prev ? yearOf(m.d3.ly.prev.x) : "the prior year")));
  }
  function drawD4(S, ctx, host, m, state) {
    var F = S.fmt, id = "D4", body = bodyOf(host, id);
    if (!m.d4) { notInEdition(S, body, KEYS.D4); setFoot(host, id, stampFoot(S, KEYS.D4)); return; }
    var keys = KEYS.D4, A = align(S, keys, ["quarter", "rolling3m"]), cats = A.cats, shares = state.d4 === "share";
    var totals = cats.map(function (c, i) { return sum(keys.map(function (k) { return A.data[k][i]; })); });
    var colors = [GOLD, LINE2, BAR, BAR2];
    body.innerHTML = box(id, "PE-backed direct-lending deals by use of proceeds, quarterly");
    draw(ctx, canvasOf(host, id), { type: "bar", data: { labels: cats.map(function (c) { return c.label; }), datasets: keys.map(function (k, j) {
      var raw = A.data[k];
      return { label: m.d4.uses[j][1], data: raw.map(function (v, i) { return shares ? (isNum(v) && totals[i] ? v / totals[i] : null) : v; }), backgroundColor: barColors(cats, colors[j]), borderWidth: 0,
        fmt: shares ? function (v) { return F.share(v); } : F.count, restated: restatedText(F, k, cats),
        extra: function (i, v) { return shares ? (isNum(raw[i]) ? F.count(raw[i]) + " of " + F.count(totals[i]) : null) : (totals[i] ? F.share(v / totals[i]) + " of " + F.count(totals[i]) : null); } };
    }) }, options: options(ctx, cats, { yfmt: shares ? function (v) { return F.share(v, 0); } : F.count, unit: shares ? "share of PE-backed deals" : "deals", stacked: true, ymax: shares ? 1 : undefined }), plugins: [overlapPlugin(cats, overlapText(F, A.lastQ))] });
    host.querySelector("[data-legend='D4']").innerHTML = legend(m.d4.uses.map(function (u, j) { return { color: colors[j], label: u[1] }; }).concat([{ color: BAR, hatch: true, label: "rolling three months" }]));
    setCaption(host, id, m.d4.caption || "");
    setFoot(host, id, stampFoot(S, KEYS.D4, "the four series total " + F.count(m.d4.total) + " deals in the past three months, a different cut from the sponsor-backed count"));
  }
  function drawD5(S, ctx, host, m) {
    var F = S.fmt, id = "D5", body = bodyOf(host, id);
    if (!m.d5) { notInEdition(S, body, KEYS.D5); setFoot(host, id, stampFoot(S, KEYS.D5)); return; }
    body.innerHTML = dumbbell(F, m.d5.rows, { prevLabel: m.d5.prevLabel, curLabel: m.d5.period, dp: 1 });
    host.querySelector("[data-legend='D5']").innerHTML = legend([{ color: INK, label: m.d5.prevLabel }, { color: GOLD, label: m.d5.period }]) + "<span class='df-legend-note'>◦ small base, under 3% of deal count</span>";
    setCaption(host, id, m.d5.caption || "");
    setFoot(host, id, stampFoot(S, KEYS.D5, "share of new-issue direct-lending deal count, top ten sectors as LCD ranks them"));
  }
  function drawD6(S, ctx, host, m) {
    var F = S.fmt, id = "D6", body = bodyOf(host, id);
    if (!m.d6) { notInEdition(S, body, KEYS.D6); setFoot(host, id, stampFoot(S, KEYS.D6)); return; }
    var A = align(S, ["lcd_dl_pe_spread_recent", "lcd_dl_lbo_spread_recent"], ["quarter", "rolling3m"]), cats = A.cats;
    body.innerHTML = "<div class='df-panels'><div><p class='df-panel-title'>Average spread over base, bps</p>" + box("D6a", "New-issue spreads, PE-backed deals and LBOs, by window") + "</div>" +
      "<div><p class='df-panel-title'>Share of deals by spread bucket</p>" + box("D6b", "Spread bucket distribution, PE-backed deals and LBOs, by window") + "</div></div>";
    var lo = Infinity, hi = -Infinity;
    ["lcd_dl_pe_spread_recent", "lcd_dl_lbo_spread_recent"].forEach(function (k) { A.data[k].forEach(function (v) { if (isNum(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    var ymin = Math.floor((lo - 25) / 50) * 50, ymax = Math.ceil((hi + 25) / 50) * 50;
    draw(ctx, canvasOf(host, "D6a"), { type: "bar", data: { labels: cats.map(function (c) { return c.label; }), datasets: [
      { label: "PE-backed", data: A.data.lcd_dl_pe_spread_recent, backgroundColor: barColors(cats, BAR), borderWidth: 0, fmt: function (v) { return F.bps(v); }, restated: restatedText(F, "lcd_dl_pe_spread_recent", cats) },
      { label: "LBOs", data: A.data.lcd_dl_lbo_spread_recent, backgroundColor: barColors(cats, GOLD), borderWidth: 0, fmt: function (v) { return F.bps(v); }, restated: restatedText(F, "lcd_dl_lbo_spread_recent", cats) }
    ] }, options: options(ctx, cats, { yfmt: function (v) { return F.bps(v); }, unit: "bps over base", everyTick: true, ymin: ymin, ymax: ymax, beginAtZero: false }), plugins: [overlapPlugin(cats, overlapText(F, A.lastQ))] });
    /* the right panel: one column per window and set, four buckets stacked */
    var cats2 = [], sets = [["pe", "PE-backed"], ["lbo", "LBOs"]];
    cats.forEach(function (c) { sets.forEach(function (s) { cats2.push({ x: c.x, g: c.g, set: s[0], label: c.label + " " + s[1], title: c.title + " · " + s[1], tick: c.label + " " + s[1], window: c.window, partial: c.partial, rolling: c.rolling }); }); });
    var modalB = m.d6.modal ? m.d6.modal.b : null;
    var bColors = { lt_450: BAR2, "450_499": BAR, "500_549": LINE2, "550_plus": INK };
    draw(ctx, canvasOf(host, "D6b"), { type: "bar", data: { labels: cats2.map(function (c) { return c.label; }), datasets: BUCKETS_RECENT.map(function (b) {
      var color = b === modalB ? GOLD : bColors[b];
      return { label: bucketLabel(b), data: cats2.map(function (c) { var p = S.at("lcd_dl_" + c.set + "_spread_bucket_" + b + "_recent", c.x, c.g); return p && isNum(p.y) ? p.y : null; }),
        backgroundColor: barColors(cats2, color), borderWidth: 0, fmt: function (v) { return F.share(v); } };
    }) }, options: options(ctx, cats2, { yfmt: function (v) { return F.share(v, 0); }, unit: "share of deals", stacked: true, ymax: 1, everyTick: true, autoSkip: true, rotate: true }) });
    host.querySelector("[data-legend='D6']").innerHTML = legend([{ color: BAR, label: "PE-backed" }, { color: GOLD, label: "LBOs" }].concat(BUCKETS_RECENT.map(function (b) { return { color: b === modalB ? GOLD : bColors[b], label: bucketLabel(b) + (b === modalB ? " (modal, LBOs)" : "") }; })));
    setCaption(host, id, m.d6.caption || "");
    setFoot(host, id, stampFoot(S, KEYS.D6, "from 2026 the spread data includes privately sourced values: not strictly comparable with prior years"));
  }
  function drawD7(S, ctx, host, m) {
    var F = S.fmt, id = "D7", body = bodyOf(host, id);
    if (!m.d7) { notInEdition(S, body, KEYS.D7); setFoot(host, id, stampFoot(S, KEYS.D7)); return; }
    var A = align(S, KEYS.D7, ["year", "ytd"]), cats = A.cats;
    var shades = [BAR2, BAR, LINE2, INK, "#565a63", "#7d8189", "#a3a7af"];
    var modalIdx = cats.map(function (c, i) { var best = null; KEYS.D7.forEach(function (k, j) { var v = A.data[k][i]; if (isNum(v) && (!best || v > best.v)) best = { v: v, dataset: j }; }); return best ? { dataset: best.dataset, text: bucketLabel(BUCKETS_ANNUAL[best.dataset]).replace(" bps", "").replace(" or higher", "+") } : null; });
    var latestModal = last(modalIdx) ? last(modalIdx).dataset : -1;
    body.innerHTML = box(id, "New-issue spread distribution of LBOs financed in the direct-lending market, annual");
    draw(ctx, canvasOf(host, id), { type: "bar", data: { labels: cats.map(function (c) { return c.label; }), datasets: KEYS.D7.map(function (k, j) {
      return { label: bucketLabel(BUCKETS_ANNUAL[j]), data: A.data[k], backgroundColor: barColors(cats, j === latestModal ? GOLD : shades[j]), borderWidth: 0, fmt: function (v) { return F.share(v); }, restated: restatedText(F, k, cats) };
    }) }, options: options(ctx, cats, { yfmt: function (v) { return F.share(v, 0); }, unit: "share of LBOs", stacked: true, ymax: 1, everyTick: true }), plugins: [modalPlugin(modalIdx)] });
    host.querySelector("[data-legend='D7']").innerHTML = legend(BUCKETS_ANNUAL.map(function (b, j) { return { color: j === latestModal ? GOLD : shades[j], label: bucketLabel(b) + (j === latestModal ? " (modal, " + m.d7.period + ")" : "") }; }).concat([{ color: BAR, hatch: true, label: "YTD, partial year" }]));
    setCaption(host, id, m.d7.caption || "");
    setFoot(host, id, stampFoot(S, KEYS.D7, "senior secured loans and unitranche facilities; 2026 includes privately sourced values"));
  }
  function diffPanel(S, ctx, host, cid, bslKey, dlKey, diffKey, grains, overlap) {
    var F = S.fmt, A = align(S, [bslKey, dlKey, diffKey], grains), cats = A.cats;
    draw(ctx, canvasOf(host, cid), { type: "bar", data: { labels: cats.map(function (c) { return c.label; }), datasets: [
      { type: "line", label: "Direct lending spread", data: A.data[dlKey], borderColor: GOLD, backgroundColor: BG, borderWidth: 2, pointRadius: pointRadii(cats, 4), pointBorderColor: GOLD, pointBorderWidth: 2, tension: 0, spanGaps: true, order: 0, fmt: function (v) { return F.bps(v); }, restated: restatedText(F, dlKey, cats) },
      { type: "line", label: "BSL spread", data: A.data[bslKey], borderColor: LINE2, backgroundColor: BG, borderWidth: 2, borderDash: [5, 4], pointRadius: pointRadii(cats, 4), pointBorderColor: LINE2, pointBorderWidth: 2, tension: 0, spanGaps: true, order: 0, fmt: function (v) { return F.bps(v); }, restated: restatedText(F, bslKey, cats) },
      { label: "Differential", data: A.data[diffKey], yAxisID: "y1", backgroundColor: barColors(cats, BAR2), borderWidth: 0, order: 1, fmt: function (v) { return F.bps(v); }, restated: restatedText(F, diffKey, cats) }
    ] }, options: options(ctx, cats, { yfmt: function (v) { return F.bps(v); }, unit: "bps over base", everyTick: grains.indexOf("year") >= 0, rotate: grains.indexOf("year") >= 0, shortYears: true, y1: true, y1fmt: function (v) { return F.bps(v); }, y1unit: "differential, bps", y1min: 0, y1max: 300, beginAtZero: false }),
      plugins: overlap ? [overlapPlugin(cats, overlap)] : [] });
  }
  function drawD8(S, ctx, host, m, state) {
    var F = S.fmt, id = "D8", body = bodyOf(host, id);
    if (!m.d8) { notInEdition(S, body, ["lcd_lbo_spread_diff_dl_vs_bsl_all_annual", "lcd_lbo_spread_diff_dl_vs_bsl_all_quarterly"]); setFoot(host, id, stampFoot(S, KEYS.D8)); return; }
    var bminus = state.d8 === "bminus" && S.has("lcd_bsl_lbo_spread_bminus_annual") && S.has("lcd_lbo_spread_diff_dl_vs_bsl_bminus_annual");
    body.innerHTML = "<div class='df-panels'><div><p class='df-panel-title'>Annual and YTD" + (bminus ? " · BSL B-minus borrowers" : " · BSL all borrowers") + "</p>" + box("D8a", "BSL and direct-lending LBO spreads with the differential, annual") + "</div>" +
      "<div><p class='df-panel-title'>Quarterly and the past three months · BSL all borrowers</p>" + box("D8b", "BSL and direct-lending LBO spreads with the differential, quarterly") + "</div></div>";
    diffPanel(S, ctx, host, "D8a", bminus ? "lcd_bsl_lbo_spread_bminus_annual" : "lcd_bsl_lbo_spread_all_annual", bminus ? "lcd_dl_lbo_spread_annual_c10" : "lcd_dl_lbo_spread_annual",
      bminus ? "lcd_lbo_spread_diff_dl_vs_bsl_bminus_annual" : "lcd_lbo_spread_diff_dl_vs_bsl_all_annual", ["year", "ytd"], null);
    diffPanel(S, ctx, host, "D8b", "lcd_bsl_lbo_spread_all_quarterly", "lcd_dl_lbo_spread_quarterly", "lcd_lbo_spread_diff_dl_vs_bsl_all_quarterly", ["quarter", "rolling3m"], overlapText(F, m.d8.dq.lastQ));
    host.querySelector("[data-legend='D8']").innerHTML = legend([{ color: GOLD, label: "direct lending spread" }, { color: LINE2, dash: true, label: "BSL spread" }, { color: BAR2, label: "differential, right axis" }, { color: BAR2, hatch: true, label: "YTD and rolling points" }]);
    setCaption(host, id, m.d8.captionFor(bminus));
    setFoot(host, id, stampFoot(S, KEYS.D8, "the differential is recomputed as direct lending − BSL, never read from the chart's own cache; 2026 includes privately sourced values"));
  }
  function channelPanels(S, ctx, host, id, ch, keys, labelDl, labelBsl) {
    var F = S.fmt, C = align(S, [keys[0], keys[1]], ["quarter", "rolling3m"]), V = align(S, [keys[2], keys[3]], ["quarter", "rolling3m"]);
    var overlap = overlapText(F, C.lastQ);
    var shareOf = function (A, dlKey, bslKey) { return A.cats.map(function (c, i) { var d = A.data[dlKey][i], b = A.data[bslKey][i]; return isNum(d) && isNum(b) && d + b ? d / (d + b) : null; }); };
    var avg = function (i, vol, cnt) { var v = V.data[vol][i], n = C.data[cnt][i]; return isNum(v) && n ? "average deal " + F.M(v * 1000 / n) : null; };
    var panel = function (cid, A, dlKey, bslKey, yfmt, unit, isVol) {
      draw(ctx, canvasOf(host, cid), { type: "bar", data: { labels: A.cats.map(function (c) { return c.label; }), datasets: [
        { type: "line", label: "Direct-lending share", data: shareOf(A, dlKey, bslKey), yAxisID: "y1", borderColor: LINE2, backgroundColor: BG, borderWidth: 1.5, borderDash: [4, 3], pointRadius: pointRadii(A.cats, 3), pointBorderColor: LINE2, tension: 0, spanGaps: true, order: 0, fmt: function (v) { return F.share(v); } },
        { label: labelDl, data: A.data[dlKey], backgroundColor: barColors(A.cats, GOLD), borderWidth: 0, order: 1, fmt: yfmt, restated: restatedText(F, dlKey, A.cats), extra: function (i) { return avg(i, keys[3], keys[1]); } },
        { label: labelBsl, data: A.data[bslKey], backgroundColor: barColors(A.cats, BAR), borderWidth: 0, order: 1, fmt: yfmt, restated: restatedText(F, bslKey, A.cats), extra: function (i) { return avg(i, keys[2], keys[0]); } }
      ] }, options: options(ctx, A.cats, { yfmt: yfmt, unit: unit, shortYears: true, y1: true, y1fmt: function (v) { return F.share(v, 0); }, y1unit: "DL share", y1min: 0, y1max: 1 }), plugins: [overlapPlugin(A.cats, overlap)] });
    };
    bodyOf(host, id).innerHTML = "<div class='df-panels'><div><p class='df-panel-title'>Deal count</p>" + box(id + "a", id + " deal count by channel, quarterly") + "</div><div><p class='df-panel-title'>Volume, $B</p>" + box(id + "b", id + " volume by channel, quarterly") + "</div></div>";
    panel(id + "a", C, keys[1], keys[0], F.count, "deals", false);
    panel(id + "b", V, keys[3], keys[2], function (v) { return F.B(v); }, "$B", true);
    host.querySelector("[data-legend='" + id + "']").innerHTML = legend([{ color: GOLD, label: labelDl }, { color: BAR, label: labelBsl }, { color: LINE2, dash: true, label: "direct-lending share, right axis" }, { color: GOLD, hatch: true, label: "rolling three months, " + overlap }]);
  }
  function drawD9(S, ctx, host, m) {
    var id = "D9";
    if (!m.d9) { notInEdition(S, bodyOf(host, id), KEYS.D9); setFoot(host, id, stampFoot(S, KEYS.D9)); return; }
    channelPanels(S, ctx, host, id, m.d9, ["lcd_bsl_lbo_count_quarterly", "lcd_dl_lbo_count_quarterly_c16", "lcd_bsl_lbo_volume_quarterly", "lcd_dl_lbo_volume_quarterly_c17"], "direct lending (estimate)", "institutional leveraged loans");
    setCaption(host, id, m.d9.caption);
    setFoot(host, id, stampFoot(S, KEYS.D9, "chart16 and chart17 repeat chart6's direct-lending values and are stored once under the chart6 keys"));
  }
  function drawD10(S, ctx, host, m) {
    var id = "D10";
    if (!m.d10) { notInEdition(S, bodyOf(host, id), KEYS.D10); setFoot(host, id, stampFoot(S, KEYS.D10)); return; }
    channelPanels(S, ctx, host, id, m.d10, ["lcd_bsl_sponsor_count_quarterly", "lcd_dl_sponsor_count_quarterly_c18", "lcd_bsl_sponsor_volume_quarterly", "lcd_dl_sponsor_volume_quarterly_c19"], "direct lending (estimate)", "institutional leveraged loans");
    setCaption(host, id, m.d10.caption);
    setFoot(host, id, stampFoot(S, KEYS.D10, "chart18 and chart19 repeat chart3's direct-lending values and are stored once under the chart3 keys"));
  }
  function drawD11(S, ctx, host, m) {
    var F = S.fmt, id = "D11", body = bodyOf(host, id);
    if (!m.d11) { notInEdition(S, body, KEYS.D11); setFoot(host, id, stampFoot(S, KEYS.D11)); return; }
    var A = align(S, KEYS.D11, ["year", "half"]), cats = A.cats, labels = ["Direct lending", "Syndicated loans", "Syndicated loans + other debt", "Other"], colors = [GOLD, BAR, LINE2, BAR2];
    body.innerHTML = box(id, "Share of global buyouts over $1B by financing type, US and Europe, by count");
    draw(ctx, canvasOf(host, id), { type: "bar", data: { labels: cats.map(function (c) { return c.label; }), datasets: KEYS.D11.map(function (k, j) {
      return { label: labels[j], data: A.data[k], backgroundColor: barColors(cats, colors[j]), borderWidth: 0, fmt: function (v) { return F.share(v); }, restated: restatedText(F, k, cats) };
    }) }, options: options(ctx, cats, { yfmt: function (v) { return F.share(v, 0); }, unit: "share of buyouts over $1B", stacked: true, ymax: 1, everyTick: true }) });
    host.querySelector("[data-legend='D11']").innerHTML = legend(labels.map(function (l, j) { return { color: colors[j], label: l }; }).concat([{ color: BAR, hatch: true, label: "half-year, partial" }]));
    setCaption(host, id, m.d11.caption || "");
    setFoot(host, id, stampFoot(S, KEYS.D11, "by count of LBOs in the US and Europe; other debt is a pre-placed second lien, high-yield bonds or other debt issued alongside the BSL deal; never compared as a level with the US-only series"));
  }
  function drawD12(S, ctx, host, m, state) {
    var F = S.fmt, id = "D12", body = bodyOf(host, id);
    if (!m.d12) { notInEdition(S, body, KEYS.D12); setFoot(host, id, stampFoot(S, KEYS.D12)); return; }
    var A = align(S, ["lcd_pc_clo_volume_quarterly", "lcd_pc_clo_count_quarterly", "lcd_dl_volume_quarterly"], ["quarter", "rolling3m"]), cats = A.cats, showShare = state.d12 === "share";
    var shares = cats.map(function (c, i) { var v = A.data.lcd_pc_clo_volume_quarterly[i], d = A.data.lcd_dl_volume_quarterly[i]; return isNum(v) && isNum(d) && d ? v / d : null; });
    body.innerHTML = box(id, "Private credit and middle-market CLO issuance, quarterly");
    draw(ctx, canvasOf(host, id), { type: "bar", data: { labels: cats.map(function (c) { return c.label; }), datasets: [
      showShare
        ? { type: "line", label: "Share of direct-lending volume", data: shares, yAxisID: "y1", borderColor: LINE2, backgroundColor: BG, borderWidth: 2, borderDash: [5, 4], pointRadius: pointRadii(cats, 4), pointBorderColor: LINE2, pointBorderWidth: 2, tension: 0, spanGaps: true, order: 0, fmt: function (v) { return F.share(v); },
            extra: function (i) { var d = A.data.lcd_dl_volume_quarterly[i]; return isNum(d) ? "direct-lending volume " + F.B(d) : null; } }
        : { type: "line", label: "CLO count", data: A.data.lcd_pc_clo_count_quarterly, yAxisID: "y1", borderColor: LINE2, backgroundColor: BG, borderWidth: 2, borderDash: [5, 4], pointRadius: pointRadii(cats, 4), pointBorderColor: LINE2, pointBorderWidth: 2, tension: 0, spanGaps: true, order: 0, fmt: F.count, restated: restatedText(F, "lcd_pc_clo_count_quarterly", cats) },
      { label: "CLO volume", data: A.data.lcd_pc_clo_volume_quarterly, backgroundColor: barColors(cats, GOLD), borderWidth: 0, order: 1, fmt: function (v) { return F.B(v); }, restated: restatedText(F, "lcd_pc_clo_volume_quarterly", cats),
        extra: function (i) { return isNum(shares[i]) ? F.share(shares[i]) + " of direct-lending volume" : null; } }
    ] }, options: options(ctx, cats, { yfmt: function (v) { return F.B(v, 0); }, unit: "$B", y1: true, y1fmt: showShare ? function (v) { return F.share(v, 0); } : F.count, y1unit: showShare ? "share of DL volume" : "CLOs", y1min: 0 }), plugins: [overlapPlugin(cats, overlapText(F, A.lastQ))] });
    host.querySelector("[data-legend='D12']").innerHTML = legend([{ color: GOLD, label: "CLO volume, $B" }, { color: LINE2, dash: true, label: showShare ? "CLO volume ÷ direct-lending volume" : "CLO count" }, { color: GOLD, hatch: true, label: "rolling three months" }]);
    setCaption(host, id, m.d12.caption);
    setFoot(host, id, stampFoot(S, KEYS.D12, m.d12.fullYear ? m.d12.fullYear + " CLO issuance " + F.B(m.d12.yearClo) + " as the sum of its quarters" : ""));
  }
  function takeoutTable(S, t, exportName) {
    var e = t && t.editions && t.editions[t.editions.length - 1];
    if (!e || !Array.isArray(e.rows)) return "<p class='df-slot'><span>The deal table is not in this edition.</span></p>";
    var html = "<div class='df-table'><p class='df-table-title'><span class='h-pop' data-metric='dfTables'>" + esc(e.title || t.title) + "</span></p>" +
      (e.headline ? "<p class='df-table-headline'>" + esc(e.headline) + "</p>" : "") +
      "<div class='scroll-x'><table class='grid df-grid' data-export-name='" + esc(exportName) + "'><thead><tr>" + e.header.map(function (h) { return "<th" + (/amount/i.test(h) ? " class='num'" : "") + ">" + esc(h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      e.rows.map(function (r) { return "<tr>" + r.map(function (c, i) { var h = e.header[i] || ""; return "<td" + (/amount/i.test(h) ? " class='num'" : /date/i.test(h) ? " class='dt'" : "") + ">" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") +
      "</tbody></table></div><p class='tile-foot'>" + esc((e.sourceLine || "").replace(/\s+•\s+/g, " · ")) + (e.footnote ? " · " + esc(e.footnote) : "") + " · slide " + esc(e.slide) + ", " + esc(S.fmt.edition(e.edition)) + " edition, recovered from the slide's picture" +
      (e.handKeyedCheck && isNum(e.handKeyedCheck.cellsCompared) ? " and checked against a hand-keyed copy (" + e.handKeyedCheck.cellsCompared + " cells, " + ((e.handKeyedCheck.differing || []).length) + " differing)" : "") + "</p></div>";
    return html;
  }
  function drawD13(S, ctx, host, m, state, tables) {
    var F = S.fmt, id = "D13", body = bodyOf(host, id);
    if (!m.d13) { notInEdition(S, body, KEYS.D13); setFoot(host, id, stampFoot(S, KEYS.D13)); return; }
    var A = align(S, ["lcd_takeout_dl_refinanced_by_bsl_quarterly", "lcd_takeout_bsl_refinanced_by_dl_quarterly"], ["quarter", "rolling3m"]), cats = A.cats;
    var toBsl = A.data.lcd_takeout_dl_refinanced_by_bsl_quarterly, toDl = A.data.lcd_takeout_bsl_refinanced_by_dl_quarterly;
    var net = cats.map(function (c, i) { return isNum(toBsl[i]) && isNum(toDl[i]) ? toDl[i] - toBsl[i] : null; });
    body.innerHTML = box(id, "Syndicated-loan and direct-lending takeouts, both ways, with the net flow") +
      "<div class='df-tables'>" + takeoutTable(S, tables.toBsl, "Takeouts into BSL") + takeoutTable(S, tables.toDl, "Takeouts into direct lending") + "</div>";
    draw(ctx, canvasOf(host, id), { type: "bar", data: { labels: cats.map(function (c) { return c.label; }), datasets: [
      { type: "line", label: "Net into direct lending", data: net, borderColor: LINE2, backgroundColor: BG, borderWidth: 2, borderDash: [5, 4], pointRadius: pointRadii(cats, 4), pointBorderColor: LINE2, pointBorderWidth: 2, tension: 0, spanGaps: true, order: 0, fmt: function (v) { return (v < 0 ? "−" : "+") + F.B(Math.abs(v)); } },
      { label: "Direct lending refinanced by BSL", data: toBsl, backgroundColor: barColors(cats, BAR), borderWidth: 0, order: 1, fmt: function (v) { return F.B(v); }, restated: restatedText(F, "lcd_takeout_dl_refinanced_by_bsl_quarterly", cats) },
      { label: "BSL refinanced by direct lending", data: toDl, backgroundColor: barColors(cats, GOLD), borderWidth: 0, order: 1, fmt: function (v) { return F.B(v); }, restated: restatedText(F, "lcd_takeout_bsl_refinanced_by_dl_quarterly", cats) }
    ] }, options: options(ctx, cats, { yfmt: function (v) { return F.B(v, 0); }, unit: "$B", everyTick: true, beginAtZero: false }), plugins: [overlapPlugin(cats, overlapText(F, A.lastQ))] });
    host.querySelector("[data-legend='D13']").innerHTML = legend([{ color: BAR, label: "direct lending refinanced by BSL" }, { color: GOLD, label: "BSL refinanced by direct lending" }, { color: LINE2, dash: true, label: "net into direct lending" }, { color: GOLD, hatch: true, label: "rolling three months" }]);
    setCaption(host, id, m.d13.caption);
    setFoot(host, id, stampFoot(S, KEYS.D13.slice(0, 2), "historical takeout data is subject to revision as LCD collects information, so each ingest replaces the series"));
  }
  function drawD14(S, ctx, host, m, state) {
    var F = S.fmt, id = "D14", body = bodyOf(host, id);
    if (!m.d14) { notInEdition(S, body, KEYS.D14.slice(0, 4)); setFoot(host, id, stampFoot(S, KEYS.D14)); return; }
    var set = state.d14 === "uni" && m.d14.uni.length ? m.d14.uni : state.d14 === "fl" && m.d14.fl.length ? m.d14.fl : m.d14.all;
    var setName = set === m.d14.uni ? "unitranche loans" : set === m.d14.fl ? "senior secured first-lien term loans" : "all debt holdings";
    var buckets = last(set).snap.items.map(function (i) { return i.c; });
    var cats = buckets.map(function (b) { return { x: b, g: "asof", label: String(b).replace(/\s*-\s*/g, "–").replace(/ or higher/, "+").replace(/^Less than |^Under /, "<"), title: bucketLabel(b) + " over base", tick: String(b).replace(/\s*-\s*/g, "–").replace(/ or higher/, "+").replace(/^Less than |^Under /, "<") }; });
    var latestSnap = last(set).snap, modal = latestSnap.items.reduce(function (a, i) { return !a || i.v > a.v ? i : a; }, null);
    var shades = [BAR2, "#565a63", BAR, LINE2];
    var datasets = set.map(function (s, j) {
      var isLatest = j === set.length - 1;
      return { label: F.quarterDeck(s.snap.p), data: buckets.map(function (b) { var it = null; s.snap.items.forEach(function (i) { if (i.c === b) it = i; }); return it ? it.v : null; }),
        backgroundColor: isLatest ? buckets.map(function (b) { return modal && b === modal.c ? GOLD : LINE2; }) : shades[j] || BAR, borderWidth: 0, fmt: function (v) { return F.share(v); },
        restated: (function () { var mm = RESTATED[s.key]; return mm ? function (i) { var e = mm[s.snap.p + "|" + (latestSnap.g || "quarter") + "|" + buckets[i]]; return e ? "restated from " + F.share(e.from) : null; } : null; })() };
    });
    var site = set === m.d14.all ? m.d14.site : null;
    if (site) datasets.push({ label: "site composite" + (m.d14.siteN ? " (" + F.count(m.d14.siteN) + " BDCs)" : ""), data: buckets.map(function (b) { var v = site[String(b).replace(/\s*-\s*/g, "-")]; return isNum(v) ? v : null; }), backgroundColor: "transparent", borderColor: GOLD, borderWidth: 1.5, fmt: function (v) { return F.share(v); } });
    body.innerHTML = box(id, "BDC holdings spread distribution by bucket over base, LCD's quarterly snapshots") +
      (site ? "" : slotNote(compositeSlot(S)));
    draw(ctx, canvasOf(host, id), { type: "bar", data: { labels: cats.map(function (c) { return c.label; }), datasets: datasets },
      options: options(ctx, cats, { yfmt: function (v) { return F.share(v, 0); }, unit: "share of holdings by count", everyTick: true, autoSkip: true }) });
    host.querySelector("[data-legend='D14']").innerHTML = legend(set.map(function (s, j) { return { color: j === set.length - 1 ? LINE2 : shades[j] || BAR, label: F.quarterDeck(s.snap.p) + (j === set.length - 1 ? " (latest)" : "") }; }).concat([{ color: GOLD, label: "modal bucket, latest" }]).concat(site ? [{ color: "transparent", label: "site composite (outline)" }] : []));
    var capBand = bandOfItems(latestSnap.items), firstBand = bandOfItems(set[0].snap.items);
    setCaption(host, id, set === m.d14.all ? m.d14.caption : CAPTIONS.d14set.template({ set: setName.charAt(0).toUpperCase() + setName.slice(1), band: F.share(capBand), prior: F.share(firstBand), priorQ: F.quarterDeck(set[0].snap.p), modal: bucketLabel(modal.c), modalShare: F.share(modal.v), allBand: F.share(m.d14.band) }));
    setFoot(host, id, stampFoot(S, set.map(function (s) { return s.key; }), setName + "; bps over base, the slide names no base rate; " + lcdN(S) + ", which implies non-listed funds"));
  }
  function bandOfItems(items) { return sum(items.filter(function (i) { return /^450-499|^500-549/.test(String(i.c).replace(/\s*-\s*/g, "-")); }).map(function (i) { return i.v; })); }
  function drawD15(S, ctx, host, m) {
    var F = S.fmt, id = "D15", body = bodyOf(host, id);
    if (!m.d15) { notInEdition(S, body, KEYS.D15); setFoot(host, id, stampFoot(S, KEYS.D15)); return; }
    var pts = m.d15.pts, cats = pts.map(function (p) { return { x: p.x, g: "quarter", label: F.quarterDeck(p.x), title: F.quarter(p.x), tick: /-03-31$/.test(p.x) ? yearOf(p.x) : null }; });
    var sofr = cats.map(function (c) { return m.d15.sofrAt(c.x); });
    var months = cats.map(function (c) { return c.x.slice(0, 7); });
    var datasets = [
      { label: "LCD BDC all-in rate", data: pts.map(function (p) { return p.y; }), borderColor: GOLD, backgroundColor: GOLD, borderWidth: 2, pointRadius: pts.map(function (p, i) { return i === pts.length - 1 || p === m.d15.peak ? 4 : 0; }), pointHoverRadius: 5, tension: 0, spanGaps: true, fmt: function (v) { return F.pct(v, 2); }, restated: restatedText(F, "lcd_bdc_all_in_rate_quarterly", cats),
        extra: function (i) { var s = sofr[i]; return isNum(s) ? "spread over 90-day SOFR " + F.pctToBps(pts[i].y - s) : null; } },
      { label: "90-day SOFR at the quarter end", data: sofr, borderColor: LINE2, backgroundColor: LINE2, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: 0, spanGaps: true, fmt: function (v) { return F.pct(v, 2); } }
    ];
    if (isNum(m.d15.site)) datasets.push({ label: "site composite all-in yield" + (m.d15.siteN ? " (" + F.count(m.d15.siteN) + " BDCs)" : ""), data: cats.map(function (c, i) { return i === cats.length - 1 ? m.d15.site : null; }), borderColor: GOLD, backgroundColor: BG, borderWidth: 2, pointRadius: 5, pointStyle: "rectRot", pointBorderColor: GOLD, showLine: false, fmt: function (v) { return F.pct(v, 2); } });
    body.innerHTML = box(id, "LCD BDC cost-weighted all-in interest rate against 90-day SOFR, quarterly") + (isNum(m.d15.site) ? "" : slotNote(compositeSlot(S, "cost-weighted all-in yield")));
    draw(ctx, canvasOf(host, id), { type: "line", data: { labels: cats.map(function (c) { return c.label; }), datasets: datasets },
      options: options(ctx, cats, { yfmt: function (v) { return F.pct(v, 1); }, unit: "percent", beginAtZero: true }), plugins: [ctx.usrec.plugin(months)] });
    host.querySelector("[data-legend='D15']").innerHTML = legend([{ color: GOLD, label: "LCD BDC all-in rate, cost-weighted" }, { color: LINE2, dash: true, label: "90-day SOFR at the quarter end" + (m.d15.sofrId ? " (FRED " + m.d15.sofrId + ")" : " (FRED, not available)") }].concat(isNum(m.d15.site) ? [{ color: GOLD, label: "site composite, latest quarter (diamond)" }] : []));
    setCaption(host, id, m.d15.caption);
    setFoot(host, id, stampFoot(S, KEYS.D15, "senior secured, unsecured and subordinated debt holdings; SOFR is FRED SOFR90DAYAVG at the month end of each quarter; recessions from FRED USREC"));
  }
  function drawD16(S, ctx, host, m, state) {
    var F = S.fmt, id = "D16", body = bodyOf(host, id);
    if (!m.d16) { notInEdition(S, body, KEYS.D16); setFoot(host, id, stampFoot(S, KEYS.D16)); return; }
    var pct = state.d16 === "pct", s1 = pct ? m.d16.p1 : m.d16.w1, s2 = pct ? m.d16.p2 : m.d16.w2;
    var buckets = s2.items.map(function (i) { return i.c; });
    var cats = buckets.map(function (b) { var l = String(b).replace(/\s*-\s*/g, "–"); return { x: b, g: "asof", label: l, title: "maturing " + l, tick: l }; });
    var val = function (snap, b) { var it = null; snap.items.forEach(function (i) { if (i.c === b) it = i; }); return it ? it.v : null; };
    var yfmt = pct ? function (v) { return F.share(v, 0); } : function (v) { return F.B(v, 0); };
    var f1 = pct ? function (v) { return F.share(v); } : function (v) { return F.B(v); };
    var datasets = [
      { label: "as of " + F.date(s1.p), data: buckets.map(function (b) { return val(s1, b); }), backgroundColor: BAR, borderWidth: 0, fmt: f1, extra: function (i) { var o = val(pct ? m.d16.w1 : m.d16.p1, buckets[i]); return isNum(o) ? (pct ? F.B(o) : F.share(o)) : null; } },
      { label: "as of " + F.date(s2.p), data: buckets.map(function (b) { return val(s2, b); }), backgroundColor: buckets.map(function (b, i) { return i === buckets.length - 1 ? GOLD : LINE2; }), borderWidth: 0, fmt: f1, extra: function (i) { var o = val(pct ? m.d16.w2 : m.d16.p2, buckets[i]); return isNum(o) ? (pct ? F.B(o) : F.share(o)) : null; } }
    ];
    var site = m.d16.site;
    if (site && !pct) datasets.push({ label: "site composite" + (m.d16.siteN ? " (" + F.count(m.d16.siteN) + " BDCs)" : ""), data: buckets.map(function (b) { var v = site[String(b).replace(/\s*-\s*/g, "-")]; return isNum(v) ? v : null; }), backgroundColor: "transparent", borderColor: GOLD, borderWidth: 1.5, fmt: function (v) { return F.B(v); } });
    body.innerHTML = box(id, "BDC maturity wall by year at cost, two quarter-end snapshots") + (site ? "" : slotNote(compositeSlot(S, null, "shape, not dollars")));
    draw(ctx, canvasOf(host, id), { type: "bar", data: { labels: cats.map(function (c) { return c.label; }), datasets: datasets }, options: options(ctx, cats, { yfmt: yfmt, unit: pct ? "share by cost" : "$B at cost", everyTick: true }) });
    host.querySelector("[data-legend='D16']").innerHTML = legend([{ color: BAR, label: "as of " + F.date(s1.p) }, { color: LINE2, label: "as of " + F.date(s2.p) }, { color: GOLD, label: "2031–2033, the back end" }].concat(site && !pct ? [{ color: "transparent", label: "site composite (outline)" }] : []));
    setCaption(host, id, m.d16.caption);
    setFoot(host, id, stampFoot(S, KEYS.D16, "excludes equity, CMBS and CLO holdings; LCD's shares sum to " + F.share(m.d16.pctSum) + ", a residual the slide does not explain"));
  }
  function drawD17(S, ctx, host, m) {
    var F = S.fmt, id = "D17", body = bodyOf(host, id);
    if (!m.d17) { notInEdition(S, body, KEYS.D17); setFoot(host, id, stampFoot(S, KEYS.D17)); return; }
    var rows = m.d17.rows.map(function (r) { var o = { c: r.c, now: r.now, prev: r.prev, chg: r.chg }; if (m.d17.site && isNum(m.d17.site[r.c])) o.site = m.d17.site[r.c]; return o; });
    body.innerHTML = dumbbell(F, rows, { prevLabel: m.d17.prevQ, curLabel: m.d17.curQ, dp: 2 }) + (m.d17.site ? "" : slotNote("The site composite's sector shares arrive with the holdings release as a marker per row, on the filers' own taxonomy mapped to LCD's; direction, not level."));
    host.querySelector("[data-legend='D17']").innerHTML = legend([{ color: INK, label: m.d17.prevQ }, { color: GOLD, label: m.d17.curQ }].concat(m.d17.site ? [{ color: LINE2, label: "site composite marker" }] : []));
    setCaption(host, id, m.d17.caption || "");
    setFoot(host, id, stampFoot(S, KEYS.D17, "share of BDC holdings by count, LCD's top ten sectors"));
  }

  /* ---------- mount ---------- */
  var CHART_SPECS = [
    { id: "D1", title: "Direct-lending deal count and estimated volume, quarterly" },
    { id: "D2", title: "Annual and YTD volume, sponsor-backed against non-sponsor" },
    { id: "D3", title: "Sponsor-backed and buyout direct lending", cls: "df-wide" },
    { id: "D4", title: "PE-backed deals by use of proceeds", seg: { name: "d4", items: [{ value: "count", label: "Counts" }, { value: "share", label: "100%" }] } },
    { id: "D5", title: "Top-10 sectors by share of new-issue deal count" },
    { id: "D6", title: "New-issue spreads, PE-backed against LBO, with the bucket distribution" },
    { id: "D7", title: "LBO spread distribution, annual" },
    { id: "D8", title: "BSL against direct-lending LBO spreads and the differential, two horizons", seg: { name: "d8", items: [{ value: "all", label: "All borrowers" }, { value: "bminus", label: "B-minus BSL" }] } },
    { id: "D9", title: "LBO financing by channel: count, volume and average deal size" },
    { id: "D10", title: "Sponsor-backed financing by channel" },
    { id: "D11", title: "Share of global buyouts over $1B by financing type" },
    { id: "D12", title: "Private credit and middle-market CLO issuance", seg: { name: "d12", items: [{ value: "count", label: "Count" }, { value: "share", label: "Share of DL volume" }] } },
    { id: "D13", title: "Takeouts both ways, with the net flow and the deal tables", cls: "df-wide" },
    { id: "D14", title: "BDC holdings spread distribution: LCD industry against the site composite", seg: { name: "d14", items: [{ value: "all", label: "All holdings" }, { value: "uni", label: "Unitranche" }, { value: "fl", label: "First lien" }] } },
    { id: "D15", title: "BDC all-in interest rate: LCD industry against the site composite and SOFR" },
    { id: "D16", title: "BDC maturity wall: LCD industry against the site composite", seg: { name: "d16", items: [{ value: "usd", label: "$B" }, { value: "pct", label: "% by cost" }] } },
    { id: "D17", title: "BDC holdings by sector: LCD industry against the site composite" }
  ];
  var DRAW = { D1: drawD1, D2: drawD2, D3: drawD3, D4: drawD4, D5: drawD5, D6: drawD6, D7: drawD7, D8: drawD8, D9: drawD9, D10: drawD10, D11: drawD11, D12: drawD12, D13: drawD13, D14: drawD14, D15: drawD15, D16: drawD16, D17: drawD17 };

  function sectionHtml(S, m) {
    /* the short edition form for a sentence; the full stamp (with the
       as-of and the next expected date) is the footers' */
    var src = S.sources()[LCD] || {}, st = "LCD monitor, " + S.fmt.edition(src.edition) + " edition";
    return "<section class='panel-card fsa-section df-section' aria-labelledby='h-dealflow'>" +
      "<div class='section-head'><h2 id='h-dealflow'>" + esc(TITLE) + "</h2>" +
      "<p class='section-blurb'>What direct lenders are financing, at what spread, and how the direct-lending channel is trading share with the broadly syndicated loan market — the LCD monitor drawn in full.</p>" +
      "<details class='how-to-read'><summary>How to read this</summary><p>The monitor reads activity on three windows at once — the rolling last three months, the last full quarter and the first quarter of the year — always pairing count with volume, and reads the year as YTD against the same months last year, as a percent gap and then attributed to a segment. Count and volume can diverge; average deal size resolves it. Spreads are read as bucket migration (the modal 50 bps bucket, the bucket it displaced, both prior shares) and as deltas in bps against the prior window, LBOs separately from all PE-backed deals. The BSL–direct-lending differential is the relative-value series and is read on two horizons that can disagree; each caption says which it reads. Channel share is a scoreboard, takeouts the two-way flow behind it, and CLO issuance the funding leg, normalized as a share of direct-lending volume. The LCD BDC series are the industry view: the site's listed-BDC composite is set beside them for direction, never for level. The rolling three-month point is hatched and labeled as overlapping the last quarter and is never summed with it; from 2026 the spread series include privately sourced values and are not strictly comparable with earlier years. Every figure here is read from a series key of the " + esc(st) + " or computed from two of them at render.</p></details></div>" +
      "<div class='tile-grid df-tiles'>" + renderTiles(S, m) + "</div>" +
      "<div class='df-charts'>" + CHART_SPECS.map(function (c) {
        var controls = (c.seg ? seg(c.seg.name, c.seg.items) : "") + "<span class='chart-legend' data-legend='" + esc(c.id) + "'></span>";
        return chartShell(c.id, c.title, controls, c.cls);
      }).join("") + "</div>" +
      "</section>";
  }
  /* series-id popups, built from the loader's own metadata so a footer
     key answers with its label, population, formula and locator; the
     loader's shared registerIds does it (one shape for all three
     sections; an alias and its canonical key are one entry, a key the
     catalog already knows is skipped, and a key it built earlier is
     refreshed in place when the provenance arrives). The body below is
     the fallback for a loader without it. */
  function registerKeyPopups(S, ctx, keys, prov) {
    if (!ctx.catalog || typeof ctx.catalog.register !== "function") return;
    if (typeof S.registerIds === "function") { S.registerIds(ctx.catalog, keys, prov || null); return; }
    var F = S.fmt, entries = [], seen = {};
    keys.forEach(function (k) {
      var c = S.canonical(k) || k;
      if (seen[c]) return; seen[c] = true;
      if (!S.has(c) || (ctx.catalog.get && ctx.catalog.get(c))) return;
      var e = S.get(c), p = prov && prov[c] || null, loc = p && p.locator ? p.locator : null;
      var pts = S.pointsOf(c), first = pts[0], lst = last(pts);
      var where = loc ? (loc.chart ? loc.chart + " on slide " + loc.slide + ", series '" + loc.series + "' of '" + String(loc.heading || "").trim() + "'" : loc.sheet ? "sheet '" + loc.sheet + "'" : "") : "";
      var notes = p && p.notes ? String(p.notes).trim().replace(/([^.!?])$/, "$1.") + " " : "";
      entries.push({ key: c, label: e.label, subtitle: c,
        formula: (e.formula ? e.formula + "; " : "") + "unit " + e.unit + ", " + e.cadence + (where ? "; read from " + where : "") + (e.inputs ? "; inputs " + e.inputs.join(", ") : ""),
        watch: notes + "Edition " + F.edition(e.edition || (S.sources()[e.source] || {}).edition) + ", vintage " + e.vintage + "; the whole history is replaced on each ingest and superseded values go to restatements.json.",
        definition: e.population || e.label,
        interpretation: pts.length + " points from " + (first ? F.period(first) : "—") + " to " + (lst ? F.period(lst) : "—") + "; YTD, rolling and window points are never summed with quarters or years." });
    });
    if (entries.length) {
      try { ctx.catalog.register(entries); } catch (err) { /* a key registered by another section keeps its popup */ }
    }
  }
  function bindSegs(host, state, S, ctx, m, tables) {
    host.querySelectorAll("[data-seg]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = btn.getAttribute("data-seg"), value = btn.getAttribute("data-value");
        if (state[name] === value) return;
        state[name] = value;
        host.querySelectorAll("[data-seg='" + name + "']").forEach(function (b) { b.setAttribute("aria-pressed", b === btn ? "true" : "false"); });
        var id = btn.closest("[data-chart]").getAttribute("data-chart");
        var art = host.querySelector("[data-chart='" + id + "']");
        try { DRAW[id](S, ctx, art, m, state, tables); } catch (e) { setCaption(art, id, "This chart could not be redrawn: " + (e && e.message ? e.message : String(e)) + "."); }
        ctx.popup(art);
        /* the section is wrapped once per term, so the whole section is
           unwrapped and wrapped again rather than the one article */
        if (ctx.terms && typeof ctx.terms.wrap === "function") {
          host.querySelectorAll(".term").forEach(function (t) { t.parentNode.replaceChild(document.createTextNode(t.textContent), t); });
          if (host.normalize) host.normalize();
          try { ctx.terms.wrap(host, { perSection: "section" }); } catch (e2) { /* a term library fault never takes the chart down */ }
        }
      });
    });
  }
  function mount(container, ctx) {
    var S = ctx.series;
    if (!S) throw new Error("the series loader is not available");
    LIVE.forEach(function (ch) { try { ch.destroy(); } catch (e) { /* already gone with its canvas */ } });
    LIVE = [];
    RESTATED = {};
    var keys = ALL_KEYS.filter(function (k) { return S.has(k); });
    /* restatements are fetched once; a failure leaves the tooltips
       without the restated line, never the chart */
    var restated = Promise.all(keys.map(function (k) {
      return S.restatementsOf(k).then(function (rows) {
        var c = S.canonical(k) || k, mm = RESTATED[c] = RESTATED[c] || {}, unit = (S.get(c) || {}).unit;
        rows.forEach(function (r) { r.unit = unit; mm[(r.p || "") + "|" + (r.g || "") + "|" + (r.c || "")] = r; });
      }, function () { return null; });
    }));
    var tables = {};
    var tableLoads = Promise.all(Object.keys(TABLES).map(function (t) {
      return S.reader(S.BASE + TABLES[t]).then(function (d) { tables[t] = d; }, function () { tables[t] = null; });
    }));
    return Promise.all([restated, tableLoads]).then(function () {
      var m = model(S, ctx);
      var state = { d4: "count", d8: "all", d12: "count", d14: "all", d16: "usd" };
      container.innerHTML = sectionHtml(S, m);
      var host = container.querySelector(".df-section");
      CHART_SPECS.forEach(function (c) {
        var art = host.querySelector("[data-chart='" + c.id + "']");
        try { DRAW[c.id](S, ctx, art, m, state, tables); }
        catch (e) {
          var body = bodyOf(art, c.id);
          body.innerHTML = "<p class='chart-empty' style='position:static'><span>" + esc(c.id) + " could not be drawn: " + esc(e && e.message ? e.message : String(e)) + ". Nothing is shown in its place.</span></p>";
          setFoot(art, c.id, stampFoot(S, KEYS[c.id] || []));
        }
      });
      /* the series-id popups open at once from the loader's metadata;
         the provenance file (the largest data file on the page, read
         only for the "read from chart N on slide M" clause) is fetched
         after the section is drawn and refreshes those popups in place
         when it lands, so it is never on the section's critical path */
      registerKeyPopups(S, ctx, keys, null);
      bindSegs(host, state, S, ctx, m, tables);
      LAST = { model: m, keys: keys };
      var prov = {};
      Promise.all(keys.map(function (k) { return S.provenance(k).then(function (p) { if (p) prov[S.canonical(k) || k] = p; }, function () { return null; }); }))
        .then(function () { registerKeyPopups(S, ctx, keys, prov); });
    });
  }
  var LAST = null;

  /* ---------- the facts the note posts ---------- */
  function facts(ctx) {
    var S = ctx.series; if (!S) return [];
    var F = S.fmt, m = LAST && LAST.model ? LAST.model : model(S, ctx), out = [];
    var st = S.stamp(LCD), src = S.sources()[LCD] || {}, shortSt = "LCD monitor, " + F.edition(src.edition) + " edition";
    /* the page caps a fact at 400 characters; the stamp shortens before
       a sentence is cut */
    var push = function (prefix, text) {
      if (!text) return;
      var line = prefix + text;
      if ((line + " — " + st).length <= 400) out.push(line + " — " + st);
      else if ((line + " — " + shortSt).length <= 400) out.push(line + " — " + shortSt);
      else out.push(line.slice(0, 397) + "…");
    };
    if (m.d1) push("Direct lending, three windows (US, LCD News coverage): ", m.d1.caption);
    if (m.d2) push("YTD against the same months last year: ", m.d2.caption + " Sponsors' share of volume " + F.share(m.d2.sShare) + " from " + F.share(m.d2.sSharePrev) + ".");
    if (m.d3) push("Buyouts: ", m.d3.caption);
    if (m.d6) push("New-issue spreads (2026 mixes privately sourced values): ", m.d6.caption + " LBOs price " + Math.abs(Math.round(m.d6.inside)) + " bps " + (m.d6.inside >= 0 ? "inside" : "outside") + " PE-backed deals.");
    if (m.d8) push("Differential, two horizons that can disagree: ", m.d8.caption);
    if (m.d9) push("LBO channel share: ", m.d9.caption);
    if (m.d11) push("Global buyouts over $1B (US and Europe, by count; never a level against the US series): ", m.d11.caption);
    if (m.d12) push("CLOs, the funding leg: ", m.d12.caption);
    if (m.d13) push("Takeouts both ways: ", m.d13.caption);
    if (m.d14) push("LCD BDC spread distribution (" + lcdN(S) + "; the site composite is the listed BDCs; direction, not level): ", m.d14.caption);
    if (m.d15) push("LCD BDC all-in rate: ", m.d15.caption);
    if (m.d16) push("LCD BDC maturity wall (ex equity, CMBS, CLOs): ", m.d16.caption);
    return out;
  }

  W.RTCreditSections = W.RTCreditSections || [];
  W.RTCreditSections.push({ id: ID, title: TITLE, groups: GROUPS, mount: mount, CAPTIONS: CAPTIONS, facts: facts, keys: ALL_KEYS, KEYS: KEYS, model: model });
})(typeof self !== "undefined" ? self : this);
