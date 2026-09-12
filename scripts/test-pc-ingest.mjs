/**
 * test-pc-ingest.mjs — the mapping, the extraction, the vintage replay
 * and the ingest script against the fixture cuts:
 *
 *   scripts/fixtures/pc/lcd-2026-08/august-2026-us-private-credit-monitor.cut.pptx
 *     (six slides of the August 2026 monitor: the cover, chart1, chart11,
 *     chart27, chart30 and the slide-40 deal table)
 *   scripts/fixtures/pc/pb-fund-overview-2026-09-10/fund-overview-cut_2026_09_10_05_03_44.xlsx
 *     (four sheets of the 10 September 2026 Fund Overview export)
 *   data-sources/reports/*.json and frontend/data/pc/press-series.json
 *     (committed hand-keyed series)
 *
 * A second vintage is made here from the deck cut — the cover month
 * bumped to September, the slide-4 as-of moved to Sep. 30, 2026, chart1's
 * 2Q26 count changed from 172 to 175 — to prove that the newest vintage
 * wins, that the superseded value lands in restatements.json with both
 * vintages and editions, and that a rolling point adds rather than
 * overwrites. A third vintage with chart1's heading and series names
 * rewritten proves that an unrecognized chart fails the strict build
 * with its full fingerprint and leaves the old key stale.
 *
 * Three more synthetic files guard a match that looks right and is
 * not: chart27 re-exported under an Excel-percent axis with its cache a
 * hundred times smaller (the heading still matches; the series must be
 * refused as unitMismatch, never served as 0.083 under unit pct); a
 * copy of chart1 beside the original (two charts, one map group: both
 * refused, neither guessed); and the workbook's Sources of Capital
 * sheet renamed past recognition in a later export (its twelve
 * accumulating snapshot keys must go stale, by group, and keep their
 * September values).
 *
 * A fourth tree holds the report files and a manifest that records deck
 * and workbook keys but no deck or workbook, the shape of a fresh clone
 * or a CI runner: the ingest must refuse it (exit 2) and write nothing,
 * never an output without those keys.
 *
 * Every figure below is read off the fixture bytes (the chart caches in
 * ppt/charts/chartN.xml, the sheet cells named by address) or the
 * committed report files; the whole-vintage block at the end runs only
 * when the raw deck and workbook are present in data-sources/ (they are
 * not committed) and prints "skip" in CI. The committed manifest is
 * never rewritten by this test: every ingest call points manifestPath
 * into the temporary folder, and the file's digest is compared at the
 * end.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readZip, writeZip } from "./lib/zip-read.mjs";
import { readDeck } from "./lib/pptx-charts.mjs";
import { readWorkbook } from "./lib/xlsx-read.mjs";
import { parsePeriod } from "./lib/pc-periods.mjs";
import { fingerprint, match, groups, validateMap, normHeading, seriesToken, entryForSeries } from "./lib/pc-map.mjs";
import { periodSlug, pressPeriod, extractDeck, extractWorkbook, extractReport, extractPress, validateReport, build, derive, SERVED_GRAINS, formatClass, scaleClass } from "./lib/pc-series.mjs";
import { ingest, discover, expectedLabel } from "./ingest-pc.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const DECK_CUT = join(here, "fixtures/pc/lcd-2026-08/august-2026-us-private-credit-monitor.cut.pptx");
const WB_CUT = join(here, "fixtures/pc/pb-fund-overview-2026-09-10/fund-overview-cut_2026_09_10_05_03_44.xlsx");
const REPORTS = join(ROOT, "data-sources/reports");
const PRESS = join(ROOT, "frontend/data/pc/press-series.json");
const RAW_DECK = join(ROOT, "data-sources/lcd/2026-09-10/august-2026-us-private-credit-monitor.pptx");
const RAW_WB = join(ROOT, "data-sources/pitchbook/2026-09-10/PitchBook_Fund_Overview_PitchBook_View_All_Charts_2026_09_10_05_03_44.xlsx");
/* the series catalog lives outside the repository; point PC_SERIES_CATALOG at it to run the catalog block */
const CATALOG = process.env.PC_SERIES_CATALOG || "";

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail !== undefined && !ok ? "  " + detail : ""));
  if (!ok) failed++;
};
const near = (a, b, tol = 1e-9) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const at = (s, p, g) => s && s.points.find((pt) => pt.p === p && (!g || pt.g === g));
const loadMap = () => JSON.parse(readFileSync(join(ROOT, "scripts/pc-map.json"), "utf8"));
const tmpRoot = join(tmpdir(), "pc-ingest-test-" + process.pid);
rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(tmpRoot, { recursive: true });
const cleanup = () => rmSync(tmpRoot, { recursive: true, force: true });
const COMMITTED_MANIFEST = join(ROOT, "data-sources/manifest.json");
const manifestDigestAtStart = existsSync(COMMITTED_MANIFEST) ? createHash("sha256").update(readFileSync(COMMITTED_MANIFEST)).digest("hex") : null;

/* rebuild a deck or workbook cut with some members rewritten: the
   synthetic vintages. An edit is a [from, to] pair that must find its
   text, or a function over the member's text. */
function rewriteZip(bytes, edits) {
  const zip = readZip(bytes);
  const members = zip.entries.map((e) => {
    let data = zip.read(e.name);
    if (edits[e.name]) {
      let text = data.toString("utf8");
      for (const edit of edits[e.name]) {
        if (typeof edit === "function") { text = edit(text); continue; }
        const [from, to] = edit;
        if (!text.includes(from)) throw new Error("rewriteZip: " + e.name + " lacks " + from);
        text = text.split(from).join(to);
      }
      data = Buffer.from(text, "utf8");
    }
    return { name: e.name, data, deflate: e.method === 8 };
  });
  return writeZip(members);
}

/* ---------- the map ---------- */
console.log("pc-map.json");
const map = loadMap();
check("the map validates", validateMap(map).length === 0, validateMap(map).join("; "));
check("213 entries: 89 deck keys and 124 workbook keys (series catalog groups 0 and 1)",
  map.entries.length === 213 && map.entries.filter((e) => e.source === "lcd-monitor").length === 89 && map.entries.filter((e) => e.source === "pb-fund-overview").length === 124);
check("keys are unique", new Set(map.entries.map((e) => e.key)).size === map.entries.length);
const mapGroups = groups(map);
check("50 fingerprint groups: 31 charts and 19 data sheets", mapGroups.length === 50 && mapGroups.filter((g) => g.kind === "chart").length === 31 && mapGroups.filter((g) => g.kind === "sheet").length === 19);
check("five duplicate keys read as cross-checks (chart10 DL spread, chart16-19 direct lending)", map.entries.filter((e) => e.duplicateOf).length === 5 && map.entries.filter((e) => e.duplicateOf).every((e) => map.entries.some((x) => x.key === e.duplicateOf)));
check("three Difference series are derived, never read", map.entries.filter((e) => e.derive).length === 3 && map.entries.filter((e) => e.derive).every((e) => e.series === "Difference (right axis)" && e.derive.from.join("|") === "Direct lending spread|BSL spread"));
check("seven snapshot charts carry a key pattern (chart8, chart21-26)", new Set(map.entries.filter((e) => e.keyPattern).map((e) => e.fingerprint.id)).size === 7);
check("six workbook list sheets are tables", map.entries.filter((e) => e.table).length === 6);
check("every workbook entry carries the export's filter line as its population",
  map.entries.filter((e) => e.source === "pb-fund-overview").every((e) => e.population === "Access Point: All; Fund Category: All; Fund Size: All; Vintage Year: All; Fund Location: World"));
check("no entry carries a key-like string or the meta label", !/api[_-]?key|created for/i.test(JSON.stringify(map)));
check("normHeading unifies dashes, quotes and whitespace", normHeading("New-issue direct lending top 10 sectors – share by deal count  ") === "new-issue direct lending top 10 sectors - share by deal count");
check("seriesToken folds period-shaped names to their grain", seriesToken("3Q25") === "<period:quarter>" && seriesToken("2026 YTD") === "<period:ytd>" && seriesToken("As of June 30, 2026") === "<period:asof>" && seriesToken("450 - 499 bps") === "450-499 bps");
check("periodSlug: 3Q25 → 3q25, 2026 YTD → 2026ytd, As of March 31, 2026 → 2026q1",
  periodSlug(parsePeriod("3Q25"), "qyy") === "3q25" && periodSlug(parsePeriod("2026 YTD", { asOf: "2026-08-31" }), "year") === "2026ytd" && periodSlug(parsePeriod("As of March 31, 2026"), "yyyyq") === "2026q1");

/* ---------- matching on the deck cut ---------- */
console.log("fingerprints and matching on the deck cut");
const cutBytes = readFileSync(DECK_CUT);
const cut = readDeck(cutBytes);
const fp1 = fingerprint(cut.charts.chart1);
check("chart1 fingerprint: heading, two series, quarter+rolling3m on the categories, both axis formats, sheet ref",
  fp1.heading === "Direct lending deal count and estimated volume (quarterly) ($B)" && fp1.seriesNames.join("|") === "Estimated volume|Count" && fp1.grain === "quarter+rolling3m" && fp1.orientation === "categories" && fp1.axisFormats.join("|") === '"$"#,##0|General' && fp1.sheetRef === "New Issue All Volume Q" && fp1.firstCat === "1Q20" && fp1.lastCat === "Last 3 Months", JSON.stringify(fp1));
const m1 = match(fp1, map);
check("chart1 matches its group by heading with the full score 7", m1.matched && m1.key === "lcd-dl-count-volume-quarterly" && m1.via === "heading" && m1.score === 7 && m1.keys.includes("lcd_dl_count_quarterly") && m1.keys.includes("lcd_dl_volume_quarterly"), JSON.stringify([m1.key, m1.via, m1.score]));
check("the match never reads the chart number", (() => { const stripped = { ...map, entries: map.entries.map((e) => { const c = { ...e }; delete c.seen; return c; }) }; const m = match(fp1, stripped); return m.matched && m.key === "lcd-dl-count-volume-quarterly"; })());
const fp11 = fingerprint(cut.charts.chart11);
const m11 = match(fp11, map);
check("chart11 (annual, all borrowers) matches the annual group, not chart12's quarterly twin", m11.matched && m11.key === "lcd-lbo-spread-bsl-all-vs-dl-annual" && m11.score === 7 && m11.candidates[1].id === "lcd-lbo-spread-bsl-all-vs-dl-quarterly" && m11.candidates[1].score === 6, JSON.stringify(m11.candidates));
const fp12 = { ...fp11, grain: "quarter+rolling3m", firstCat: "4Q24" };
const m12 = match(fp12, map);
check("the same heading and series with a quarterly grain is chart12's group", m12.matched && m12.key === "lcd-lbo-spread-bsl-all-vs-dl-quarterly" && m12.via === "heading");
const m27 = match(fingerprint(cut.charts.chart27), map);
check("chart27 matches by heading with its one live series (the #REF! series is not in the fingerprint)", m27.matched && m27.key === "lcd-bdc-all-in-rate" && fingerprint(cut.charts.chart27).seriesNames.join("|") === "Debt - Wtd Avg Rate");
const fp30 = fingerprint(cut.charts.chart30);
check("chart30's axis formats are chart1's reversed, and it matches its own group", fp30.axisFormats.join("|") === '"$"0|General' && match(fp30, map).key === "lcd-mm-clo-issuance");
{
  const reworded = { ...fp1, heading: "Direct lending deals and volume by quarter" };
  const m = match(reworded, map);
  check("a reworded heading still matches by fallback: series 2 + grain 1 + formats 1 + sheet ref 1 = 5 against chart3's 4",
    m.matched && m.key === "lcd-dl-count-volume-quarterly" && m.via === "fallback" && m.score === 5 && m.candidates[1].id === "lcd-dl-sponsor-count-volume-quarterly" && m.candidates[1].score === 4, JSON.stringify(m.candidates));
  const noRef = { ...reworded, sheetRef: "Sheet7" };
  const m2 = match(noRef, map);
  check("a reworded heading and a renamed sheet leave chart1 and chart3 tied at 4: ambiguous, both named, nothing guessed",
    !m2.matched && m2.reason === "ambiguous" && m2.candidates.slice(0, 2).map((c) => c.id).sort().join("|") === "lcd-dl-count-volume-quarterly|lcd-dl-sponsor-count-volume-quarterly", JSON.stringify(m2.candidates));
  const alias = { ...map, entries: map.entries.map((e) => (e.key === "lcd_dl_count_quarterly" ? { ...e, fingerprint: { ...e.fingerprint, headingAliases: ["Direct lending deals and volume by quarter"] } } : e)) };
  const m3 = match(noRef, alias);
  check("a heading alias on any one entry of the group restores the heading match", m3.matched && m3.via === "heading" && m3.key === "lcd-dl-count-volume-quarterly");
}
{
  const g21 = mapGroups.find((g) => g.id === "lcd-bdc-spread-distribution-all");
  const rolled = { kind: "chart", heading: g21.fingerprint.heading, seriesNames: ["4Q25", "1Q26", "2Q26", "3Q26"], grain: "quarter", orientation: "series", axisFormats: ["0%"], sheetRef: "Chart1" };
  const m = match(rolled, map);
  check("a BDC snapshot chart that dropped 3Q25 and added 3Q26 still scores 7 (period-shaped series compare by grain)", m.matched && m.key === "lcd-bdc-spread-distribution-all" && m.score === 7);
  check("the new quarter's key is generated from the pattern: lcd_bdc_spread_dist_count_3q26", entryForSeries(g21, "3Q26") !== null && g21.entries[0].keyPattern.replace("{period}", periodSlug(parsePeriod("3Q26"), g21.entries[0].periodSlug)) === "lcd_bdc_spread_dist_count_3q26");
  const g25 = mapGroups.find((g) => g.id === "lcd-bdc-maturity-wall-share"), g26 = mapGroups.find((g) => g.id === "lcd-bdc-maturity-wall-usd");
  const wall = { kind: "chart", heading: "BDC maturity wall by cost", seriesNames: g26.fingerprint.seriesNames, grain: "asof", orientation: "series", axisFormats: g26.fingerprint.axisFormats, sheetRef: g26.fingerprint.sheetRef };
  const mw = match(wall, map);
  check("chart25 and chart26 share heading words, series and sheet; with the heading reworded the axis format ('0%' against '\"$\"#,##0') decides", mw.matched && mw.key === "lcd-bdc-maturity-wall-usd" && mw.via === "fallback" && g25.fingerprint.axisFormats[0] === "0%");
}

/* ---------- extraction on the deck cut ---------- */
console.log("extraction on the deck cut");
const hand = JSON.parse(readFileSync(join(REPORTS, "lcd-monitor-2026-08-tables.json"), "utf8"));
const v1 = extractDeck(cut, map, { vintage: "2026-09-10", file: "lcd/2026-09-10/cut.pptx", hand, handFile: "lcd-monitor-2026-08-tables.json" });
check("edition 2026-08, published 2026-09-08 (docProps/core.xml), as-of 2026-08-31", v1.edition === "2026-08" && v1.publishedAt === "2026-09-08T22:04:10Z" && v1.asOf === "2026-08-31");
check("four charts matched, nothing unmatched, refused or fallback", v1.report.chartsSeen === 4 && v1.report.matched.length === 4 && !v1.report.unmatched.length && !v1.report.unmatchedSeries.length && !v1.report.refused.length && !v1.report.fallbackMatched.length, JSON.stringify(v1.report.refused));
const cq = v1.series.lcd_dl_count_quarterly;
check("chart1 Count: 26 quarters 1Q20..2Q26 and one rolling point, 27 in all", cq && cq.points.length === 27 && cq.points.filter((p) => p.g === "quarter").length === 26 && cq.points[0].p === "2020-03-31" && cq.points[25].p === "2026-06-30");
check("chart1 Count 1Q20 = 112, 2Q26 = 172 (chart1.xml Count cache idx 0 and 25)", cq.points[0].v === 112 && at(cq, "2026-06-30", "quarter").v === 172);
check("chart1 'Last 3 Months' = 200 dated by the slide as-of, window Jun 1 to Aug 31 (the formatCode-attribute point)", (() => { const r = at(cq, "2026-08-31", "rolling3m"); return r && r.v === 200 && r.start === "2026-06-01"; })());
check("chart1 Estimated volume: 2Q26 = 36.81443624, rolling = 48.598540240000005, unit $B", near(at(v1.series.lcd_dl_volume_quarterly, "2026-06-30").v, 36.81443624) && at(v1.series.lcd_dl_volume_quarterly, "2026-08-31").v === 48.598540240000005 && v1.series.lcd_dl_volume_quarterly.unit === "$B");
check("key metadata: source, group, geography US from the source line, the footnote as notes, the locator naming slide 4 / chart1 / Count",
  cq.source === "lcd-monitor" && cq.group === "lcd-dealflow" && cq.geography === "US" && cq.notes === "Deal count is based on transactions covered by LCD News" && cq.locator.slide === 2 && cq.locator.chart === "chart1" && cq.locator.series === "Count" && cq.locator.heading === fp1.heading);
const diff11 = v1.series.lcd_lbo_spread_diff_dl_vs_bsl_all_annual;
check("chart11 Difference is recomputed as DL − BSL: YTD August 2026 = 485.2573... − 337.8788... = 147.37849367461018, and equals the cache", (() => {
  const dl = at(v1.series.lcd_dl_lbo_spread_annual, "2026-08-31", "ytd"), bsl = at(v1.series.lcd_bsl_lbo_spread_all_annual, "2026-08-31", "ytd"), d = at(diff11, "2026-08-31", "ytd");
  const rec = v1.report.derived.find((x) => x.key === "lcd_lbo_spread_diff_dl_vs_bsl_all_annual");
  return dl && bsl && d && near(d.v, dl.v - bsl.v) && near(d.v, 147.37849367461018) && rec.crossCheck.compared === 8 && rec.crossCheck.differing.length === 0 && diff11.formula;
})());
check("chart11: eight points 2019..2025 plus YTD August 2026 ending on the as-of, start Jan 1", diff11.points.length === 8 && diff11.points[0].p === "2019-12-31" && diff11.points[7].g === "ytd" && diff11.points[7].start === "2026-01-01");
const rate = v1.series.lcd_bdc_all_in_rate_quarterly;
check("chart27: 32 quarters Q3 2018..Q2 2026, unit pct (percent points as printed), Q2 2026 = 8.303138989", rate && rate.points.length === 32 && rate.points[0].p === "2018-09-30" && rate.points[31].p === "2026-06-30" && rate.unit === "pct" && rate.points[31].v === 8.303138989 && rate.asOf === "2026-06-30");
check("chart27's #REF! series is reported as dropped (one cached value), not read", v1.report.dropped.length === 1 && v1.report.dropped[0].series === "#REF!" && v1.report.dropped[0].cachedPoints === 1 && v1.report.dropped[0].reason === "refError");
check("chart30: volume on the \"$\"0 axis (rolling 9.757779999999999), count on General (20) — the axis pair resolved per series",
  at(v1.series.lcd_pc_clo_volume_quarterly, "2026-08-31").v === 9.757779999999999 && at(v1.series.lcd_pc_clo_count_quarterly, "2026-08-31").v === 20 && v1.series.lcd_pc_clo_volume_quarterly.unit === "$B" && v1.series.lcd_pc_clo_count_quarterly.unit === "count" && v1.series.lcd_pc_clo_volume_quarterly.points.length === 22);
check("chart30 2Q21 is Number() of the Volume cache's idx 0 string in chart30.xml", (() => { const xml = readZip(cutBytes).text("ppt/charts/chart30.xml"); const m = /<c:v>Volume \(\$B\)<\/c:v>[\s\S]*?<c:numCache>[\s\S]*?<c:pt idx="0"><c:v>([^<]+)<\/c:v>/.exec(xml); return m && v1.series.lcd_pc_clo_volume_quarterly.points[0].p === "2021-06-30" && v1.series.lcd_pc_clo_volume_quarterly.points[0].v === Number(m[1]); })());
check("8 keys written from the four charts (2 + 3 + 1 + 2), no duplicate written", Object.keys(v1.series).length === 8 && v1.report.duplicatesSkipped.length === 0, Object.keys(v1.series).join(","));
const t1 = v1.tables["lcd-dl-refinanced-in-bsl"];
check("the slide-40 EMF table is identified by its header ('Debt being refinanced'), 10 rows, Accuris first, and matches the hand-keyed file cell for cell",
  t1 && t1.header.join("|") === "Company|PE sponsor|Borrower rating|Date|Debt being refinanced" && t1.rows.length === 10 && t1.rows[0][0] === "Accuris" && t1.rows[0][3] === "Aug 2026" && t1.handKeyedCheck && t1.handKeyedCheck.differing.length === 0 && t1.handKeyedCheck.cellsCompared === 50, JSON.stringify(t1 && t1.handKeyedCheck));
check("the table carries the slide's title, headline, source line and footnote", t1.title === "Last ten syndicated term loans that refinance debt provided by direct lenders" && t1.footnote === "Table is based on LCD News reporting." && /As of Aug\. 31, 2026/.test(t1.sourceLine) && t1.asOf === "2026-08-31");
check("no slide text, staff name or meta block reaches the vintage", !/Created for/i.test(JSON.stringify(v1)) && !/@/.test(JSON.stringify(v1.series)));

/* ---------- extraction on the workbook cut ---------- */
console.log("extraction on the workbook cut");
const wbBytes = readFileSync(WB_CUT);
const wb = readWorkbook(wbBytes);
const w1 = extractWorkbook(wb, map, { vintage: "2026-09-10", file: "pitchbook/2026-09-10/cut.xlsx" });
check("four data sheets matched by their frame, nothing unmatched, no filter mismatch, no unparsed cell", w1.report.sheetsSeen === 4 && w1.report.matched.length === 4 && !w1.report.unmatched.length && !w1.report.filterMismatch.length && !w1.report.unparsedCells.length && !w1.report.refused.length, JSON.stringify(w1.report.refused));
check("the truncated tab 'Average & Median Time To Close ' resolves through its B4 title", w1.report.matched.some((m) => m.sheet === "Average & Median Time To Close " && m.id === "pb-fo-average-median-time-to-close-months" && m.via === "heading"));
check("26 keys: 2 + 10 + 2 + 12", Object.keys(w1.series).length === 26);
const cap = w1.series.pb_all_capital_raised_annual;
check("Fundraising Activity B18 '$1.65Tn' → 1650 ($B) at 2025-12-31; B19 '$1.08Tn' → 1080 as a year-to-date point ending on the download date, partial", at(cap, "2025-12-31", "year").v === 1650 && (() => { const p = at(cap, "2026-09-10", "ytd"); return p && p.v === 1080 && p.start === "2026-01-01" && p.partial === true; })());
check("C18 '4999' and C19 '2345' fund counts; ten points each, 2017 first", at(w1.series.pb_all_fund_count_annual, "2025-12-31").v === 4999 && at(w1.series.pb_all_fund_count_annual, "2026-09-10").v === 2345 && cap.points.length === 10 && cap.points[0].p === "2017-12-31");
check("Fundraising by Category (#) Debt rows: 2017 590 / $303.55B (row 12), 2025 479 / $373.55B, 2026 YTD 155 / $247.67B",
  at(w1.series.pb_cat_debt_fund_count_annual, "2017-12-31").v === 590 && at(w1.series.pb_cat_debt_capital_raised_annual, "2017-12-31").v === 303.55 && at(w1.series.pb_cat_debt_fund_count_annual, "2025-12-31").v === 479 && at(w1.series.pb_cat_debt_capital_raised_annual, "2025-12-31").v === 373.55 && at(w1.series.pb_cat_debt_capital_raised_annual, "2026-09-10").v === 247.67 && at(w1.series.pb_cat_debt_fund_count_annual, "2026-09-10").v === 155);
check("Time To Close: 2025 average 15.23 and median (months), 2026 12.30 flagged partial; the header's newline does not matter", at(w1.series.pb_all_avg_time_to_close_months_annual, "2025-12-31").v === 15.23 && at(w1.series.pb_all_avg_time_to_close_months_annual, "2026-09-10").v === 12.3 && at(w1.series.pb_all_avg_time_to_close_months_annual, "2026-09-10").partial === true && w1.series.pb_all_avg_time_to_close_months_annual.unit === "months");
check("Sources of Capital row 10: Pension '$3.14Tn' → 3140 and 56983 commitments, dated by the download date as a snapshot", at(w1.series.pb_lp_pension_amount_committed, "2026-09-10", "asof").v === 3140 && at(w1.series.pb_lp_pension_commitment_count, "2026-09-10", "asof").v === 56983 && w1.series.pb_lp_pension_amount_committed.points.length === 1);
check("every workbook key carries the filter line as its population and the download stamp as edition and as-of", Object.values(w1.series).every((s) => s.population === "Access Point: All; Fund Category: All; Fund Size: All; Vintage Year: All; Fund Location: World" && s.asOf === "2026-09-10" && s.edition === "2026-09-10" && s.publishedAt === "2026-09-10T17:03:44Z"));
{
  const h4 = (() => { /* the fixture's own placeholder beside the withheld meta label, read from the bytes */ const z = readZip(wbBytes); const ss = z.text("xl/sharedStrings.xml"); const m = /licensee name removed from the fixture/.exec(ss); return m ? m[0] : null; })();
  const text = JSON.stringify(w1);
  check("the meta block is withheld: neither 'Created for' nor the H4 value reaches the vintage", h4 !== null && !text.includes(h4) && !/created for/i.test(text));
  const altered = { ...map, entries: map.entries.map((e) => (e.key === "pb_all_capital_raised_annual" ? { ...e, population: "Access Point: All; Fund Category: Debt; Fund Size: All; Vintage Year: All; Fund Location: World" } : e)) };
  const w2 = extractWorkbook(wb, altered, { vintage: "2026-09-10" });
  check("a sheet exported under a different filter line is refused for the key and reported as filterMismatch, not merged", !w2.series.pb_all_capital_raised_annual && w2.report.filterMismatch.length === 1 && w2.report.filterMismatch[0].key === "pb_all_capital_raised_annual" && w2.series.pb_all_fund_count_annual);
}

/* ---------- the hand-keyed reports and the press file ---------- */
console.log("reports and press");
const q2 = JSON.parse(readFileSync(join(REPORTS, "pitchbook-global-fundraising-2026q2.json"), "utf8"));
const annual = JSON.parse(readFileSync(join(REPORTS, "pitchbook-annual-private-debt-reports.json"), "utf8"));
check("both PitchBook report files validate", validateReport(q2, "pitchbook-global-fundraising-2026q2.json").length === 0 && validateReport(annual, "pitchbook-annual-private-debt-reports.json").length === 0);
{
  const broken = JSON.parse(JSON.stringify(q2));
  delete broken.series.pb_pd_fundraising_ttm.points[0].page;
  broken.series.pb_pd_fundraising_ttm.points.push({ ...q2.series.pb_pd_fundraising_ttm.points[0], v: "x" });
  const problems = validateReport(broken, "x.json");
  check("a point without a page, or with a non-numeric value or a repeated date and grain, is refused with the key named", problems.length === 3 && problems.every((p) => p.startsWith("pb_pd_fundraising_ttm")), problems.join("; "));
  const oddGrain = JSON.parse(JSON.stringify(q2));
  oddGrain.series.pb_pd_fundraising_ttm.points[0].g = "fortnight";
  const gp = validateReport(oddGrain, "x.json");
  check("a grain outside the served vocabulary is refused with the grain and the vocabulary named; the file's own 'ttm' is accepted as rolling12m", gp.length === 1 && /grain fortnight/.test(gp[0]) && /rolling12m/.test(gp[0]) && q2.series.pb_pd_fundraising_ttm.points[0].g === "ttm", gp.join("; "));
}
const rq = extractReport(q2, "pitchbook-global-fundraising-2026q2.json");
check("the Q2 2026 report is one vintage: source pb-fundraising-report, edition 2026Q2, as-of 2026-06-30, published 2026-09-03, 21 series, 2 tables", rq.length === 1 && rq[0].source === "pb-fundraising-report" && rq[0].edition === "2026Q2" && rq[0].asOf === "2026-06-30" && rq[0].publishedAt === "2026-09-03" && Object.keys(rq[0].series).length === 21 && Object.keys(rq[0].tables).length === 2);
const capQ2 = rq[0].series.pb_pd_fundraising_capital_q2_2026ed;
check("the report's ttm points are served as rolling12m and its '%' units as pct; '% of loans'-style units stay as typed", rq[0].series.pb_pd_fundraising_ttm.points.every((p) => p.g === "rolling12m") && q2.series.pb_pd_fundraising_ttm.points.every((p) => p.g === "ttm") && Object.values(rq[0].series).every((s) => s.unit !== "%") && Object.values(rq[0].series).some((s) => s.unit === "pct") === Object.values(q2.series).some((s) => s.unit === "%"), JSON.stringify(Object.values(rq[0].series).map((s) => s.unit)));
check("p.17 series: 2025 = 275.2, 2021 = 328.3, H1 2026 = 158.3 provisional; counts 309 and 88", at(capQ2, "2025-12-31").v === 275.2 && at(capQ2, "2021-12-31").v === 328.3 && at(capQ2, "2026-06-30").v === 158.3 && at(capQ2, "2026-06-30").provisional === true && at(rq[0].series.pb_pd_fund_count_q2_2026ed, "2025-12-31").v === 309 && at(rq[0].series.pb_pd_fund_count_q2_2026ed, "2026-06-30").v === 88);
check("points carry doc and page, not the quote (the quote stays in the committed file)", capQ2.points.every((p) => p.doc === "fr2026q2" && p.page === 17 && p.quote === undefined));
const ra = extractReport(annual, "pitchbook-annual-private-debt-reports.json");
check("the annual file is six vintages ordered by document as-of: 2021, 2022, 2023, 2024, QP Q1 2026, QP Q3 2026", ra.length === 6 && ra.map((v) => v.edition).join("|") === "2021|2022|2023|2024|2026Q1|2026Q3");
check("pressPeriod reads the press file's labels", (() => {
  const a = pressPeriod("2020Q1"), b = pressPeriod("2026H1"), c = pressPeriod("CY2025"), d = pressPeriod("YE2024"), e = pressPeriod("end-2026 forecast"), f = pressPeriod("2025-09"), g = pressPeriod("TTM to 2025Q1"), h = pressPeriod("late 2024"), i = pressPeriod("2025 (by volume)"), j = pressPeriod("2026-02-27");
  return a.p === "2020-03-31" && a.g === "quarter" && b.p === "2026-06-30" && b.g === "half" && c.p === "2025-12-31" && c.g === "year" && d.p === "2024-12-31" && d.g === "asof" && e.p === "2026-12-31" && e.forecast === true && f.p === "2025-09-30" && f.g === "month" && g.g === "rolling12m" && g.start === "2024-04-01" && g.p === "2025-03-31" && h.p === null && h.g === "label" && i.p === "2025-12-31" && i.q === "by volume" && j.g === "asof";
})());
const press = extractPress(JSON.parse(readFileSync(PRESS, "utf8")));
check("the press file yields 20 keys and every point keeps its label and URL", Object.keys(press.series).length === 20 && Object.values(press.series).every((s) => s.points.every((p) => p.label && p.url)) && press.source === "press");
const pressPoints = Object.values(press.series).reduce((n, s) => n + s.points.length, 0);
check("196 press points (the file's own count by HTTP status: 186 + 6 + 4)", pressPoints === 196, String(pressPoints));

/* ---------- the replay ---------- */
console.log("vintages and restatements");
/* the synthetic September vintage: cover month, slide-4 as-of, chart1's 2Q26 count, the modified date */
const v2Bytes = rewriteZip(cutBytes, {
  "ppt/slides/slide1.xml": [["August 2026", "September 2026"]],
  "ppt/slides/slide4.xml": [["Aug. 31, 2026", "Sep. 30, 2026"]],
  "ppt/charts/chart1.xml": [['<c:pt idx="25"><c:v>172</c:v>', '<c:pt idx="25"><c:v>175</c:v>']],
  "docProps/core.xml": [["2026-09-08T22:04:10Z", "2026-10-07T21:00:00Z"]],
});
const deck2 = readDeck(v2Bytes);
check("the synthetic deck reads as edition 2026-09 with chart1's 2Q26 count 175 and the as-of Sep. 30, 2026", deck2.edition === "2026-09" && deck2.charts.chart1.asOf === "2026-09-30" && deck2.charts.chart1.series.find((s) => s.name === "Count").points[25].val === 175);
const v2 = extractDeck(deck2, map, { vintage: "2026-10-12" });
{
  const built = build([v1, v2]);
  const s = built.keys.lcd_dl_count_quarterly;
  check("newest vintage wins: 2Q26 = 175 carrying vintage 2026-10-12", at(s, "2026-06-30", "quarter").v === 175 && at(s, "2026-06-30", "quarter").vintage === "2026-10-12" && s.vintage === "2026-10-12" && s.edition === "2026-09");
  const r = built.restatements.find((x) => x.key === "lcd_dl_count_quarterly");
  check("the superseded 172 lands in restatements with both vintages and editions", r && r.date === "2026-06-30" && r.grain === "quarter" && JSON.stringify(r.values) === JSON.stringify([{ vintage: "2026-09-10", edition: "2026-08", value: 172 }, { vintage: "2026-10-12", edition: "2026-09", value: 175 }]), JSON.stringify(r));
  check("that is the only restatement: unchanged values restate nothing", built.restatements.length === 1, JSON.stringify(built.restatements.map((x) => x.key)));
  check("the rolling point adds rather than overwrites: Jun–Aug 2026 (200) beside Jul–Sep 2026 (200), 28 points", s.points.filter((p) => p.g === "rolling3m").length === 2 && at(s, "2026-08-31", "rolling3m").vintage === "2026-09-10" && at(s, "2026-09-30", "rolling3m").vintage === "2026-10-12" && at(s, "2026-09-30", "rolling3m").start === "2026-07-01" && s.points.length === 28);
  check("'YTD August 2026' on chart11 still ends Aug 31 under a Sep 30 as-of, so it is the same point, now carrying the newer vintage", at(built.keys.lcd_dl_lbo_spread_annual, "2026-08-31", "ytd").vintage === "2026-10-12" && built.keys.lcd_dl_lbo_spread_annual.points.length === 8);
  check("nothing is stale when the newest edition carries every key", built.stale.length === 0);
  const v2short = { ...v2, series: Object.fromEntries(Object.entries(v2.series).filter(([k]) => !k.startsWith("lcd_pc_clo"))) };
  const b2 = build([v1, v2short]);
  check("a key the newest edition lacks is kept with its last points and flagged stale with lastSeenEdition 2026-08", b2.keys.lcd_pc_clo_volume_quarterly && b2.keys.lcd_pc_clo_volume_quarterly.points.length === 22 && b2.keys.lcd_pc_clo_volume_quarterly.stale && b2.keys.lcd_pc_clo_volume_quarterly.stale.lastSeenEdition === "2026-08" && b2.stale.length === 2, JSON.stringify(b2.stale));
  const b3 = build([v2, v1].reverse());
  check("the replay is deterministic for the same order", JSON.stringify(b3.keys.lcd_dl_count_quarterly) === JSON.stringify(s));
  check("every key read from the cuts names the map group it came through (chart30's keys lcd-mm-clo-issuance; the Sources of Capital keys pb-fo-sources-of-capital)",
    Object.values(v1.series).every((x) => x.fingerprintId) && v1.series.lcd_pc_clo_count_quarterly.fingerprintId === "lcd-mm-clo-issuance" && Object.values(w1.series).every((x) => x.fingerprintId) && w1.series.pb_lp_pension_amount_committed.fingerprintId === "pb-fo-sources-of-capital" && w1.series.pb_lp_pension_amount_committed.accumulates === true);
}

/* ---------- stale by map group: an accumulating key whose sheet goes unrecognized ---------- */
console.log("stale by group");
/* a later Fund Overview export (12 Oct 2026) with the Sources of Capital
   sheet renamed past recognition: title, tab and first header; the three
   other sheets untouched. The twelve LP keys it carried are snapshots
   that accumulate across exports, and blueprint 7.5 still wants them
   flagged stale, because their sheet was not read at all. */
const wb2Bytes = rewriteZip(wbBytes, {
  "xl/sharedStrings.xml": [["Sources of Capital", "Capital by LP type"], ["LP Type", "Investor type"], ["10-Sep-2026", "12-Oct-2026"]],
  "xl/workbook.xml": [['name="Sources of Capital"', 'name="Capital by LP type"']],
  "docProps/core.xml": [["2026-09-10T17:03:44Z", "2026-10-12T17:03:44Z"]],
});
const w2 = extractWorkbook(readWorkbook(wb2Bytes), map, { vintage: "2026-10-12", file: "pitchbook/2026-10-12/cut.xlsx" });
check("the renamed sheet is unmatched (grain and column kinds alone score 2) with its new title and header in the report; the other three sheets read; the export dated 12 Oct 2026",
  w2.report.unmatched.length === 1 && w2.report.unmatched[0].heading === "Capital by LP type" && w2.report.unmatched[0].seriesNames[0] === "Investor type" && w2.report.matched.length === 3 && w2.edition === "2026-10-12" && Object.keys(w2.series).length === 14, JSON.stringify(w2.report.unmatched.map((u) => [u.heading, u.candidates])));
{
  const bw = build([w1, w2]);
  const pension = bw.keys.pb_lp_pension_amount_committed;
  check("the twelve accumulating LP keys are stale: last seen 2026-09-10, group pb-fo-sources-of-capital not read; Pension keeps 3140 ($3.14Tn) at 2026-09-10",
    bw.stale.length === 12 && bw.stale.every((x) => x.key.startsWith("pb_lp_") && x.lastSeenEdition === "2026-09-10" && x.fingerprintId === "pb-fo-sources-of-capital" && x.groupRead === false) && pension.stale && pension.points.length === 1 && at(pension, "2026-09-10", "asof").v === 3140 && /not matched or was refused/.test(pension.stale.reason), JSON.stringify(bw.stale.slice(0, 2)));
  check("the fourteen keys of the sheets that were read moved to the October vintage and are not stale", ["pb_all_capital_raised_annual", "pb_cat_debt_fund_count_annual", "pb_all_avg_time_to_close_months_annual"].every((k) => bw.keys[k].vintage === "2026-10-12" && !bw.keys[k].stale) && Object.values(bw.keys).filter((x) => !x.stale).length === 14);
  /* the sheet read but one LP row gone from it: a snapshot key that rolled off is not stale */
  const rolled = { ...w1, id: "2026-10-12", edition: "2026-10-12", series: Object.fromEntries(Object.entries(w1.series).filter(([k]) => !k.startsWith("pb_lp_pension")).map(([k, x]) => [k, { ...x, edition: "2026-10-12", asOf: "2026-10-12" }])) };
  const br = build([w1, rolled]);
  check("the same two Pension keys absent while their sheet was read are rolled-off snapshots, not stale; nothing is stale", !br.keys.pb_lp_pension_amount_committed.stale && br.keys.pb_lp_pension_amount_committed.points.length === 1 && br.stale.length === 0, JSON.stringify(br.stale));
  /* a key that does not accumulate is stale either way, with the reason saying its sheet was read */
  const rolledCap = { ...rolled, series: Object.fromEntries(Object.entries(rolled.series).filter(([k]) => k !== "pb_all_capital_raised_annual")) };
  const bc = build([w1, rolledCap]);
  check("a non-accumulating key absent from a sheet that was read is stale, the reason naming the sheet as read", bc.stale.length === 1 && bc.stale[0].key === "pb_all_capital_raised_annual" && bc.stale[0].groupRead === true && /was read but carried no point/.test(bc.stale[0].reason), JSON.stringify(bc.stale));
}

/* ---------- the value axis against the key's unit ---------- */
console.log("axis formats against units");
check("formatClass reads the deck's own formats: 0% Excel percent (a fraction), 0\"%\" and 0.00\"%\" literal percent (points), \"$\"#,##0 and \"$\"0 currency, General and #,##0 number; a [$-409] locale is no currency, [$€-2] is, an escaped \\% is literal",
  formatClass("0%") === "excelPercent" && formatClass('0"%"') === "literalPercent" && formatClass('0.00"%"') === "literalPercent" && formatClass('"$"#,##0') === "currency" && formatClass('"$"0') === "currency" && formatClass("General") === "number" && formatClass("#,##0") === "number" && formatClass("[$-409]mmm\\ yyyy;@") === "number" && formatClass("[$€-2]#,##0") === "currency" && formatClass("0\\%") === "literalPercent" && formatClass(null) === null);
check("the map's scales resolve to the classes the check expects; a scale it does not know resolves to null", scaleClass("fraction") === "excelPercent" && scaleClass("percentPoints") === "literalPercent" && scaleClass("usd_b") === "currency" && scaleClass("usd_m") === "currency" && scaleClass("count") === "number" && scaleClass("bps") === "number" && scaleClass("table") === null && scaleClass(undefined) === null);
check("on the cut every series sits on an axis of its key's class: nothing refused, no signal mismatch", v1.report.refused.length === 0 && v1.report.signalMismatch.length === 0 && w1.report.signalMismatch.length === 0);
/* chart27 re-exported under an Excel-percent axis: the heading and the
   series name still match, the cache is a hundred times smaller (Q2 2026
   8.303138989 becomes 0.08303138989) and the map still says unit pct */
const pctBytes = rewriteZip(v2Bytes, {
  "ppt/charts/chart27.xml": [
    ['formatCode="0&quot;%&quot;"', 'formatCode="0%"'],
    ['<c:formatCode>0.00"%"</c:formatCode>', "<c:formatCode>0.00%</c:formatCode>"],
    (text) => text.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/g, (block) => block.replace(/<c:v>([^<]+)<\/c:v>/g, (m, v) => "<c:v>" + Number(v) / 100 + "</c:v>")),
  ],
});
const deckPct = readDeck(pctBytes);
check("the synthetic September deck reads chart27's value axis as 0% and its Q2 2026 cache as 8.303138989 ÷ 100", deckPct.charts.chart27.axes.find((a) => a.kind === "valAx").numFmt === "0%" && deckPct.charts.chart27.series[0].points[31].val === 8.303138989 / 100 && deckPct.edition === "2026-09");
const vPct = extractDeck(deckPct, map, { vintage: "2026-10-12" });
{
  const sm = vPct.report.signalMismatch;
  const ref = vPct.report.refused.filter((r) => r.kind === "unitMismatch");
  check("chart27 still matches its group by heading (score 6, the formats signal lost) and is listed under signalMismatch with 0\"%\" expected and 0% observed, grain intact",
    vPct.report.matched.some((m) => m.chart === "chart27" && m.id === "lcd-bdc-all-in-rate" && m.via === "heading" && m.score === 6) && sm.length === 1 && sm[0].chart === "chart27" && sm[0].slide === 4 && sm[0].formats.expected.join("|") === '0"%"' && sm[0].formats.observed.join("|") === "0%" && sm[0].grain === undefined && sm[0].keys.includes("lcd_bdc_all_in_rate_quarterly"), JSON.stringify(sm));
  check("its series is refused as unitMismatch (unit pct expects a literal-percent axis, found Excel percent), naming chart, slide, key, the axis format and both format sets; the key is not written, so no 0.083 is served under unit pct; the seven other keys are",
    ref.length === 1 && ref[0].chart === "chart27" && ref[0].slide === 4 && ref[0].key === "lcd_bdc_all_in_rate_quarterly" && ref[0].series === "Debt - Wtd Avg Rate" && ref[0].unit === "pct" && ref[0].expectedFormat === "literalPercent" && ref[0].observedFormat === "excelPercent" && ref[0].numFmt === "0%" && ref[0].mapFormats.join("|") === '0"%"' && ref[0].chartFormats.join("|") === "0%" && !vPct.series.lcd_bdc_all_in_rate_quarterly && Object.keys(vPct.series).length === 7 && vPct.report.refused.length === 1, JSON.stringify(vPct.report.refused));
  const b = build([v1, vPct]);
  const s = b.keys.lcd_bdc_all_in_rate_quarterly;
  check("in the replay the key keeps its 32 August points with Q2 2026 = 8.303138989 and is stale: its chart was read, the series refused", s.points.length === 32 && at(s, "2026-06-30").v === 8.303138989 && s.vintage === "2026-09-10" && s.stale && s.stale.lastSeenEdition === "2026-08" && s.stale.groupRead === true && b.stale.length === 1, JSON.stringify(s.stale));
}
/* a currency format that only changed its digits is the same class: reported, not refused */
{
  const cosBytes = rewriteZip(cutBytes, { "ppt/charts/chart1.xml": [['formatCode="&quot;$&quot;#,##0"', 'formatCode="&quot;$&quot;0"']] });
  const vCos = extractDeck(readDeck(cosBytes), map, { vintage: "2026-09-10" });
  const sm = vCos.report.signalMismatch;
  check("chart1 with its volume axis printed \"$\"0 instead of \"$\"#,##0 still matches by heading (6), is listed under signalMismatch, and both keys are written: 2Q26 count 172, volume as before, nothing refused",
    sm.length === 1 && sm[0].chart === "chart1" && sm[0].id === "lcd-dl-count-volume-quarterly" && sm[0].formats.expected.join("|") === '"$"#,##0|General' && sm[0].formats.observed.join("|") === '"$"0|General' && vCos.report.refused.length === 0 && vCos.report.matched.find((m) => m.chart === "chart1").score === 6 && at(vCos.series.lcd_dl_count_quarterly, "2026-06-30", "quarter").v === 172 && at(vCos.series.lcd_dl_volume_quarterly, "2026-06-30", "quarter").v === at(v1.series.lcd_dl_volume_quarterly, "2026-06-30", "quarter").v && Object.keys(vCos.series).length === 8, JSON.stringify(sm));
}

/* ---------- two charts of one edition, one map group ---------- */
console.log("two charts, one map group");
{
  /* a copy of chart1 with every cached value one higher, placed on the cut's last slide */
  const c1 = cut.charts.chart1;
  const chart99 = { ...c1, id: "chart99", slideIndex: 6, series: c1.series.map((x) => ({ ...x, points: x.points.map((p) => ({ ...p, val: typeof p.val === "number" ? p.val + 1 : p.val })) })) };
  const vDup = extractDeck({ ...cut, charts: { ...cut.charts, chart99 } }, map, { vintage: "2026-10-12" });
  const r = vDup.report.refused.find((x) => x.kind === "duplicateMatch");
  check("chart1 and its copy both resolve to lcd-dl-count-volume-quarterly: one duplicateMatch refusal naming both charts (slides 2 and 6) and the group's keys; neither is read, the other three charts are",
    vDup.report.chartsSeen === 5 && vDup.report.refused.length === 1 && r && r.id === "lcd-dl-count-volume-quarterly" && r.charts.map((c) => c.chart).join("|") === "chart1|chart99" && r.charts.map((c) => c.slide).join("|") === "2|6" && r.charts.every((c) => c.via === "heading" && c.score === 7) && r.keys.sort().join("|") === "lcd_dl_count_quarterly|lcd_dl_volume_quarterly" && !vDup.series.lcd_dl_count_quarterly && !vDup.series.lcd_dl_volume_quarterly && vDup.report.matched.length === 3 && !vDup.report.matched.some((m) => m.chart === "chart1" || m.chart === "chart99") && Object.keys(vDup.series).length === 6, JSON.stringify(vDup.report.refused));
  const b = build([v1, { ...vDup, edition: "2026-09" }]);
  check("in the replay neither 172 nor 173 replaces the August 2Q26 count: the two keys keep their 27 points and are stale with the group not read", at(b.keys.lcd_dl_count_quarterly, "2026-06-30", "quarter").v === 172 && b.keys.lcd_dl_count_quarterly.points.length === 27 && b.keys.lcd_dl_count_quarterly.stale && b.keys.lcd_dl_count_quarterly.stale.groupRead === false && b.stale.map((x) => x.key).sort().join("|") === "lcd_dl_count_quarterly|lcd_dl_volume_quarterly", JSON.stringify(b.stale));
  /* the same rule on the workbook: the Fundraising Activity sheet twice */
  const dupSheet = wb.sheets.find((x) => x.name === "Fundraising Activity");
  const wDup = extractWorkbook({ ...wb, sheets: [...wb.sheets, { ...dupSheet, name: "Fundraising Activity (2)" }] }, map, { vintage: "2026-10-12" });
  const rs = wDup.report.refused.find((x) => x.kind === "duplicateMatch");
  check("two sheets that match pb-fo-fundraising-activity are both refused as duplicateMatch, the other three read", wDup.report.sheetsSeen === 5 && rs && rs.id === "pb-fo-fundraising-activity" && rs.sheets.map((x) => x.sheet).join("|") === "Fundraising Activity|Fundraising Activity (2)" && !wDup.series.pb_all_capital_raised_annual && wDup.report.matched.length === 3 && Object.keys(wDup.series).length === 24, JSON.stringify(wDup.report.refused));
}

/* ---------- the ingest script end to end ---------- */
console.log("ingest-pc over a temporary data-sources tree");
const src1 = join(tmpRoot, "v1"), out1 = join(tmpRoot, "out1");
const src2 = join(tmpRoot, "v2"), out2 = join(tmpRoot, "out2");
const src3 = join(tmpRoot, "v3"), out3 = join(tmpRoot, "out3");
for (const src of [src1, src2, src3]) {
  mkdirSync(join(src, "lcd/2026-09-10"), { recursive: true });
  mkdirSync(join(src, "pitchbook/2026-09-10"), { recursive: true });
  mkdirSync(join(src, "reports"), { recursive: true });
  copyFileSync(DECK_CUT, join(src, "lcd/2026-09-10/august-2026-us-private-credit-monitor.cut.pptx"));
  copyFileSync(WB_CUT, join(src, "pitchbook/2026-09-10/PitchBook_Fund_Overview_cut_2026_09_10_05_03_44.xlsx"));
  for (const f of readdirSync(REPORTS)) if (f.endsWith(".json")) copyFileSync(join(REPORTS, f), join(src, "reports", f));
}
mkdirSync(join(src2, "lcd/2026-10-12"), { recursive: true });
writeFileSync(join(src2, "lcd/2026-10-12/september-2026-us-private-credit-monitor.cut.pptx"), v2Bytes);
/* the third vintage: chart1's heading reworded and both series renamed, so nothing recognizes it */
const v3Bytes = rewriteZip(v2Bytes, {
  "ppt/slides/slide4.xml": [["Direct lending deal count and estimated volume ", "Direct lending activity "]],
  "ppt/charts/chart1.xml": [["<c:v>Count</c:v>", "<c:v>Deals</c:v>"], ["<c:v>Estimated volume</c:v>", "<c:v>Volume estimate</c:v>"]],
});
mkdirSync(join(src3, "lcd/2026-10-12"), { recursive: true });
writeFileSync(join(src3, "lcd/2026-10-12/september-2026-us-private-credit-monitor.cut.pptx"), v3Bytes);

const found = discover(src2);
check("discover lists the decks by folder date, the workbook, three report files and the hand-keyed tables file", found.decks.map((d) => d.vintage).join("|") === "2026-09-10|2026-10-12" && found.workbooks.length === 1 && found.reports.length === 2 && found.handTables.length === 1);

const run1 = ingest({ sourceDir: src1, outDir: out1, strict: true, pressFile: PRESS, today: "2026-09-11" });
check("a run returns no refusal when every source is present", run1.refused === undefined && run1.exitCode === 0, JSON.stringify(run1.refused));
check("first vintage, strict: exit 0, 4 charts and 4 sheets matched, nothing unmatched", run1.exitCode === 0 && run1.report.summary.charts === 4 && run1.report.summary.sheets === 4 && run1.report.summary.matched === 8 && run1.report.summary.unmatched === 0 && run1.report.summary.refused === 0, JSON.stringify(run1.report.summary));
const written1 = Object.keys(run1.written);
check("every output is written: series.json, seven group files, the index, provenance, restatements, tables, the report and the manifest",
  ["series.json", "series-index.json", "series-provenance.json", "restatements.json", "ingest-report.json", "manifest.json", "series/lcd-dealflow.json", "series/lcd-pricing.json", "series/lcd-bdc.json", "series/pb-fund.json", "series/reports.json", "series/press.json", "tables/lcd-dl-refinanced-in-bsl.json", "tables/pb-ttm-fundraising-by-strategy-2026q2.json"].every((f) => written1.includes(f)), written1.join(", "));
const series1 = JSON.parse(readFileSync(join(out1, "series.json"), "utf8"));
const index1 = JSON.parse(readFileSync(join(out1, "series-index.json"), "utf8"));
check("series.json keys: 8 deck + 26 workbook + 141 report (146 less the five keys both files carry) + 20 press + 4 derived = 199", Object.keys(series1.keys).length === 199 && run1.report.summary.derivedKeys === 4 && Object.values(series1.keys).filter((s) => s.group === "reports").length === 141, JSON.stringify(run1.report.summary));
check("every point carries p, g, v and its vintage; a rolling point its start", Object.values(series1.keys).every((s) => s.points.every((p) => "p" in p && p.g && "v" in p && p.vintage && (!/^(ytd|rolling3m|rolling12m)$/.test(p.g) || p.start))));
check("every served grain is in the vocabulary the note lists (no 'ttm'), and no served unit is a bare '%'", (() => { const grains = new Set(Object.values(series1.keys).flatMap((s) => s.points.map((p) => p.g))); const listed = [...grains].every((g) => SERVED_GRAINS.has(g)); const noteNames = [...grains].every((g) => series1.note.includes(g)); return listed && noteNames && !grains.has("ttm") && Object.values(series1.keys).every((s) => s.unit !== "%"); })(), JSON.stringify([...new Set(Object.values(series1.keys).flatMap((s) => s.points.map((p) => p.g)))]));
check("a point of the key's own edition carries no edition field; a point of an earlier edition does (the annual reports' 2023 values under the 2026Q3 key)", (() => { const own = series1.keys.lcd_dl_count_quarterly.points.every((p) => p.edition === undefined); const s = series1.keys.lcd_lbo_loan_volume_annual; return own && s && s.edition === "2023" && s.points.some((p) => p.edition === "2022") && s.points.filter((p) => p.edition === undefined).length > 0 && s.points.every((p) => p.edition === undefined || p.edition !== s.edition); })(), JSON.stringify(series1.keys.lcd_lbo_loan_volume_annual && series1.keys.lcd_lbo_loan_volume_annual.points.map((p) => [p.p, p.edition]).slice(0, 6)));
check("the index lists every key with n, first and last agreeing with series.json, and its group file", Object.keys(index1.series).length === Object.keys(series1.keys).length && Object.entries(index1.series).every(([k, e]) => { const s = series1.keys[k]; const dated = s.points.filter((p) => p.p); return e.n === s.points.length && e.first === (dated.length ? dated[0].p : null) && e.last === (dated.length ? dated[dated.length - 1].p : null) && e.file === "series/" + s.group + ".json"; }));
check("the group files partition series.json", (() => { const all = []; for (const g of Object.keys(index1.groups)) { const part = JSON.parse(readFileSync(join(out1, index1.groups[g].file), "utf8")); all.push(...Object.keys(part.keys)); if (!Object.keys(part.keys).every((k) => JSON.stringify(part.keys[k]) === JSON.stringify(series1.keys[k]))) return false; } return all.length === new Set(all).size && all.length === Object.keys(series1.keys).length; })());
const lcdSrc = index1.sources["lcd-monitor"];
check("series-index sources.lcd-monitor: as-of 2026-08-31, published 2026-09-08, downloaded 2026-09-10, monthly, lag 8 days, next expected 2026-10-08 'early October'",
  lcdSrc.asOf === "2026-08-31" && lcdSrc.publishedAt === "2026-09-08T22:04:10Z" && lcdSrc.downloaded === "2026-09-10" && lcdSrc.cadence === "monthly" && lcdSrc.lagDays === 8 && lcdSrc.nextExpected === "2026-10-08" && lcdSrc.nextExpectedLabel === "early October" && lcdSrc.edition === "2026-08", JSON.stringify(lcdSrc));
check("the workbook source is on-demand, downloaded 2026-09-10; the fundraising report quarterly with as-of 2026-06-30", index1.sources["pb-fund-overview"].cadence === "on-demand" && index1.sources["pb-fund-overview"].downloaded === "2026-09-10" && index1.sources["pb-fundraising-report"].cadence === "quarterly" && index1.sources["pb-fundraising-report"].asOf === "2026-06-30");
check("a report source's sha256 is the named JSON file's; the document's own hash rides under documentSha256 with the document title", (() => { const r = index1.sources["pb-fundraising-report"]; const fileSha = createHash("sha256").update(readFileSync(join(src1, "reports/pitchbook-global-fundraising-2026q2.json"))).digest("hex"); const doc = Object.values(q2.documents)[0]; return r.file === "reports/pitchbook-global-fundraising-2026q2.json" && r.sha256 === fileSha && r.documentSha256 === doc.sha256 && r.document === doc.title && r.vintages[0].documentSha256 === doc.sha256; })(), JSON.stringify(index1.sources["pb-fundraising-report"]));
check("expectedLabel: day 1-10 early, 11-20 mid, else late", expectedLabel("2026-10-08") === "early October" && expectedLabel("2026-10-15") === "mid October" && expectedLabel("2026-10-28") === "late October");
const run200 = series1.keys.derived_pd_fundraising_200b_run;
check("the $200B run is computed, not typed: seven years 2019–2025 on the Q2 2026 cut (2019 = 233.6 is the first ≥ 200; 2018 = 199.1 breaks it)",
  run200 && run200.points.length === 1 && run200.points[0].v === 7 && run200.points[0].p === "2025-12-31" && run200.source === "derived" && /≥ 200/.test(run200.formula) && JSON.stringify(run200.inputs) === JSON.stringify(["pb_pd_fundraising_capital_q2_2026ed"]) && at(series1.keys.pb_pd_fundraising_capital_q2_2026ed, "2018-12-31").v === 199.1 && at(series1.keys.pb_pd_fundraising_capital_q2_2026ed, "2019-12-31").v === 233.6, JSON.stringify(run200));
const prov1 = JSON.parse(readFileSync(join(out1, "series-provenance.json"), "utf8"));
check("the run's years are listed in the provenance", JSON.stringify(prov1.keys.derived_pd_fundraising_200b_run.years) === JSON.stringify(["2019", "2020", "2021", "2022", "2023", "2024", "2025"]));
check("average fund size closed: 2025 = 275.2 × 1000 ÷ 309 = 890.61…; H1 2026 = 158.3 × 1000 ÷ 88 = 1,798.86…", near(at(series1.keys.derived_pd_avg_fund_size, "2025-12-31").v, 275200 / 309, 1e-9) && near(at(series1.keys.derived_pd_avg_fund_size, "2026-06-30").v, 158300 / 88, 1e-9));
check("TTM rank 2 among the eight strategies and 309.1 ÷ 1,348.0 = 22.93% of the private-capital total, from the report's p.2 table", at(series1.keys.derived_pd_fundraising_ttm_rank, "2026-06-30").v === 2 && near(at(series1.keys.derived_pd_fundraising_ttm_share_of_private_capital, "2026-06-30").v, 309.1 / 1348, 1e-9));
check("the 13 derived metrics whose inputs the cut lacks are skipped with the reason, never typed", run1.report.derived.filter((d) => d.skipped).length === 13 && run1.report.derived.filter((d) => d.skipped).every((d) => /inputs absent/.test(d.reason)), JSON.stringify(run1.report.derived.filter((d) => d.skipped)));
check("the catalog check explains every count delta (the six list tables on this cut)", run1.report.catalog.rows.every((r) => r.reason));
const manifest1 = JSON.parse(readFileSync(join(src1, "manifest.json"), "utf8"));
check("the manifest records sha256, bytes, edition, as-of and the keys per raw file (deck, workbook, two report files, the hand-keyed tables)", Object.keys(manifest1.files).length === 5 && manifest1.files["lcd/2026-09-10/august-2026-us-private-credit-monitor.cut.pptx"].sha256 === createHash("sha256").update(cutBytes).digest("hex") && manifest1.files["lcd/2026-09-10/august-2026-us-private-credit-monitor.cut.pptx"].edition === "2026-08" && manifest1.files["lcd/2026-09-10/august-2026-us-private-credit-monitor.cut.pptx"].keys.includes("lcd_dl_count_quarterly"));
const tableFile = JSON.parse(readFileSync(join(out1, "tables/lcd-dl-refinanced-in-bsl.json"), "utf8"));
check("tables/lcd-dl-refinanced-in-bsl.json carries the edition's table with header and ten rows", tableFile.editions.length === 1 && tableFile.editions[0].edition === "2026-08" && tableFile.editions[0].rows.length === 10);
{
  const again = ingest({ sourceDir: src1, outDir: join(tmpRoot, "out1b"), strict: true, pressFile: PRESS, today: "2026-09-11" });
  const same = ["series.json", "series-index.json", "series-provenance.json", "restatements.json", "ingest-report.json"].every((f) => readFileSync(join(out1, f), "utf8") === readFileSync(join(tmpRoot, "out1b", f), "utf8"));
  check("re-running over the same files is byte-identical", again.exitCode === 0 && same);
  /* a file the owner or another build places under series/ or tables/ is not the ingest's to delete */
  writeFileSync(join(out1, "series/owner-note.json"), "{}\n");
  writeFileSync(join(out1, "tables/owner-note.json"), "{}\n");
  const over = ingest({ sourceDir: src1, outDir: out1, strict: true, pressFile: PRESS, today: "2026-09-11" });
  check("a re-run into the same folder leaves files it did not write alone and removes nothing", over.exitCode === 0 && existsSync(join(out1, "series/owner-note.json")) && existsSync(join(out1, "tables/owner-note.json")) && over.report.removed.length === 0, JSON.stringify(over.report.removed));
  rmSync(join(out1, "series/owner-note.json")); rmSync(join(out1, "tables/owner-note.json"));
  /* a group file the last run wrote and this run does not is removed, and only that: an output folder carrying the first run's
     report and a leftover lcd-dealflow.json, fed a tree of reports alone (no manifest, no index, so nothing is guarded) */
  const src8 = join(tmpRoot, "v8"), out8 = join(tmpRoot, "out8");
  mkdirSync(join(src8, "reports"), { recursive: true });
  mkdirSync(join(out8, "series"), { recursive: true });
  for (const f of readdirSync(REPORTS)) if (f.endsWith(".json")) copyFileSync(join(REPORTS, f), join(src8, "reports", f));
  copyFileSync(join(out1, "ingest-report.json"), join(out8, "ingest-report.json"));
  copyFileSync(join(out1, "series/lcd-dealflow.json"), join(out8, "series/lcd-dealflow.json"));
  writeFileSync(join(out8, "series/owner-note.json"), "{}\n");
  const run8 = ingest({ sourceDir: src8, outDir: out8, strict: true, pressFile: join(tmpRoot, "no-press.json"), today: "2026-09-11" });
  check("a group file the previous report lists and this run does not write is removed and named; a file the ingest never wrote stays", run8.exitCode === 0 && run8.report.removed.includes("series/lcd-dealflow.json") && !existsSync(join(out8, "series/lcd-dealflow.json")) && existsSync(join(out8, "series/owner-note.json")) && existsSync(join(out8, "series/reports.json")) && run8.report.removed.every((f) => !existsSync(join(out8, f))), JSON.stringify(run8.report.removed));
}

const run2 = ingest({ sourceDir: src2, outDir: out2, strict: true, pressFile: PRESS, today: "2026-10-12" });
const series2 = JSON.parse(readFileSync(join(out2, "series.json"), "utf8"));
const rest2 = JSON.parse(readFileSync(join(out2, "restatements.json"), "utf8"));
const index2 = JSON.parse(readFileSync(join(out2, "series-index.json"), "utf8"));
check("two vintages, strict: exit 0, both decks replayed oldest first", run2.exitCode === 0 && run2.report.vintages.filter((v) => v.source === "lcd-monitor").map((v) => v.id).join("|") === "2026-09-10|2026-10-12");
check("series.json carries 175 at 2Q26 from vintage 2026-10-12 and restatements.json the 172 from 2026-09-10", at(series2.keys.lcd_dl_count_quarterly, "2026-06-30", "quarter").v === 175 && rest2.count === 1 && rest2.restatements[0].key === "lcd_dl_count_quarterly" && rest2.restatements[0].values[0].value === 172 && rest2.restatements[0].values[0].edition === "2026-08" && rest2.restatements[0].values[1].edition === "2026-09");
check("the index moves to the September edition: as-of 2026-09-30, published 2026-10-07, lag 7, next expected 2026-11-07 'early November'; two observed lags",
  index2.sources["lcd-monitor"].edition === "2026-09" && index2.sources["lcd-monitor"].asOf === "2026-09-30" && index2.sources["lcd-monitor"].lagDays === 7 && index2.sources["lcd-monitor"].nextExpected === "2026-11-07" && index2.sources["lcd-monitor"].nextExpectedLabel === "early November" && index2.sources["lcd-monitor"].observedLags.join("|") === "8|7", JSON.stringify(index2.sources["lcd-monitor"]));
check("the deal table accumulates one entry per edition, newest first", JSON.parse(readFileSync(join(out2, "tables/lcd-dl-refinanced-in-bsl.json"), "utf8")).editions.map((e) => e.edition).join("|") === "2026-09|2026-08");
check("under the September key the August rolling point (Jun-Aug) names its edition 2026-08; the September points and the replaced 2Q26 carry none", (() => { const s = series2.keys.lcd_dl_count_quarterly; const aug = at(s, "2026-08-31", "rolling3m"), sep = at(s, "2026-09-30", "rolling3m"), q = at(s, "2026-06-30", "quarter"); return s.edition === "2026-09" && aug.edition === "2026-08" && sep.edition === undefined && q.edition === undefined && q.vintage === "2026-10-12"; })(), JSON.stringify(series2.keys.lcd_dl_count_quarterly.points.slice(-3)));

const run3 = ingest({ sourceDir: src3, outDir: out3, strict: true, pressFile: PRESS, today: "2026-10-12" });
const series3 = JSON.parse(readFileSync(join(out3, "series.json"), "utf8"));
const unmatched3 = run3.report.files.find((f) => f.vintage === "2026-10-12").unmatched;
check("a chart whose heading and series names both changed fails the strict build (exit 1)", run3.exitCode === 1 && run3.report.summary.unmatched === 1);
check("the report carries its full fingerprint: slide, heading, both series names, first and last category, grain, axis formats, sheet ref, candidates",
  unmatched3.length === 1 && unmatched3[0].heading === "Direct lending activity (quarterly) ($B)" && unmatched3[0].seriesNames.join("|") === "Volume estimate|Deals" && unmatched3[0].firstCat === "1Q20" && unmatched3[0].lastCat === "Last 3 Months" && unmatched3[0].grain === "quarter+rolling3m" && unmatched3[0].axisFormats.length === 2 && unmatched3[0].sheetRef === "New Issue All Volume Q" && unmatched3[0].slide === 2 && Array.isArray(unmatched3[0].candidates), JSON.stringify(unmatched3));
check("the old keys keep their August points and are flagged stale with lastSeenEdition 2026-08; the outputs are still written", series3.keys.lcd_dl_count_quarterly && series3.keys.lcd_dl_count_quarterly.points.length === 27 && series3.keys.lcd_dl_count_quarterly.stale && series3.keys.lcd_dl_count_quarterly.stale.lastSeenEdition === "2026-08" && run3.report.stale.map((s) => s.key).sort().join("|") === "lcd_dl_count_quarterly|lcd_dl_volume_quarterly", JSON.stringify(run3.report.stale));
check("without --strict the same run exits 0 and reports the same gap", ingest({ sourceDir: src3, outDir: join(tmpRoot, "out3b"), strict: false, pressFile: PRESS, today: "2026-10-12" }).exitCode === 0);

/* the September deck with chart27 under an Excel-percent axis, as a second vintage in the tree */
{
  const src9 = join(tmpRoot, "v9"), out9 = join(tmpRoot, "out9");
  mkdirSync(join(src9, "lcd/2026-09-10"), { recursive: true });
  mkdirSync(join(src9, "lcd/2026-10-12"), { recursive: true });
  mkdirSync(join(src9, "pitchbook/2026-09-10"), { recursive: true });
  mkdirSync(join(src9, "reports"), { recursive: true });
  copyFileSync(DECK_CUT, join(src9, "lcd/2026-09-10/august-2026-us-private-credit-monitor.cut.pptx"));
  writeFileSync(join(src9, "lcd/2026-10-12/september-2026-us-private-credit-monitor.cut.pptx"), pctBytes);
  copyFileSync(WB_CUT, join(src9, "pitchbook/2026-09-10/PitchBook_Fund_Overview_cut_2026_09_10_05_03_44.xlsx"));
  for (const f of readdirSync(REPORTS)) if (f.endsWith(".json")) copyFileSync(join(REPORTS, f), join(src9, "reports", f));
  const run9 = ingest({ sourceDir: src9, outDir: out9, strict: true, pressFile: PRESS, today: "2026-10-12" });
  const series9 = JSON.parse(readFileSync(join(out9, "series.json"), "utf8"));
  const file9 = run9.report.files.find((f) => f.vintage === "2026-10-12");
  check("a chart whose value axis changed class fails the strict build (exit 1) as one refusal and one signal mismatch, both in the summary", run9.exitCode === 1 && run9.report.summary.refused === 1 && run9.report.summary.signalMismatch === 1 && run9.report.summary.unmatched === 0 && file9.refused[0].kind === "unitMismatch" && file9.refused[0].key === "lcd_bdc_all_in_rate_quarterly", JSON.stringify(run9.report.summary));
  check("series.json serves the August rate (Q2 2026 = 8.303138989, unit pct) flagged stale with lastSeenEdition 2026-08, never 0.083; the index carries the flag too",
    at(series9.keys.lcd_bdc_all_in_rate_quarterly, "2026-06-30").v === 8.303138989 && series9.keys.lcd_bdc_all_in_rate_quarterly.unit === "pct" && series9.keys.lcd_bdc_all_in_rate_quarterly.stale.lastSeenEdition === "2026-08" && series9.keys.lcd_bdc_all_in_rate_quarterly.vintage === "2026-09-10" && JSON.parse(readFileSync(join(out9, "series-index.json"), "utf8")).series.lcd_bdc_all_in_rate_quarterly.stale.lastSeenEdition === "2026-08" && run9.report.stale.length === 1, JSON.stringify(series9.keys.lcd_bdc_all_in_rate_quarterly.stale));
  check("the other September keys are current: chart1's 2Q26 = 175 from vintage 2026-10-12", at(series9.keys.lcd_dl_count_quarterly, "2026-06-30", "quarter").v === 175 && series9.keys.lcd_dl_count_quarterly.vintage === "2026-10-12" && !series9.keys.lcd_dl_count_quarterly.stale);
  check("without --strict the same run exits 0 with the refusal still reported", ingest({ sourceDir: src9, outDir: join(tmpRoot, "out9b"), strict: false, pressFile: PRESS, today: "2026-10-12" }).exitCode === 0);
  /* the October workbook with the Sources of Capital sheet renamed, as a second export in the tree */
  const src10 = join(tmpRoot, "v10"), out10 = join(tmpRoot, "out10");
  mkdirSync(join(src10, "lcd/2026-09-10"), { recursive: true });
  mkdirSync(join(src10, "pitchbook/2026-09-10"), { recursive: true });
  mkdirSync(join(src10, "pitchbook/2026-10-12"), { recursive: true });
  mkdirSync(join(src10, "reports"), { recursive: true });
  copyFileSync(DECK_CUT, join(src10, "lcd/2026-09-10/august-2026-us-private-credit-monitor.cut.pptx"));
  copyFileSync(WB_CUT, join(src10, "pitchbook/2026-09-10/PitchBook_Fund_Overview_cut_2026_09_10_05_03_44.xlsx"));
  writeFileSync(join(src10, "pitchbook/2026-10-12/PitchBook_Fund_Overview_cut_2026_10_12_05_03_44.xlsx"), wb2Bytes);
  for (const f of readdirSync(REPORTS)) if (f.endsWith(".json")) copyFileSync(join(REPORTS, f), join(src10, "reports", f));
  const run10 = ingest({ sourceDir: src10, outDir: out10, strict: true, pressFile: PRESS, today: "2026-10-12" });
  const series10 = JSON.parse(readFileSync(join(out10, "series.json"), "utf8"));
  check("the renamed snapshot sheet fails the strict build (exit 1, one unmatched sheet) and its twelve accumulating keys are served stale with their September values: Pension 3140 and 56983",
    run10.exitCode === 1 && run10.report.summary.unmatched === 1 && run10.report.stale.length === 12 && run10.report.stale.every((x) => x.lastSeenEdition === "2026-09-10" && x.fingerprintId === "pb-fo-sources-of-capital") && at(series10.keys.pb_lp_pension_amount_committed, "2026-09-10", "asof").v === 3140 && at(series10.keys.pb_lp_pension_commitment_count, "2026-09-10", "asof").v === 56983 && series10.keys.pb_lp_pension_amount_committed.stale.lastSeenEdition === "2026-09-10" && series10.keys.pb_all_capital_raised_annual.vintage === "2026-10-12" && !series10.keys.pb_all_capital_raised_annual.stale, JSON.stringify(run10.report.summary));
  check("series-index sources.pb-fund-overview moved to the October export", JSON.parse(readFileSync(join(out10, "series-index.json"), "utf8")).sources["pb-fund-overview"].downloaded === "2026-10-12");
}

/* ---------- the missing-source guard ---------- */
console.log("a tree without the downloads");
{
  /* the reports and the manifest of the first run, no deck and no workbook: a fresh clone, or a CI runner */
  const src4 = join(tmpRoot, "v4"), out4 = join(tmpRoot, "out4");
  mkdirSync(join(src4, "reports"), { recursive: true });
  mkdirSync(out4, { recursive: true });
  for (const f of readdirSync(REPORTS)) if (f.endsWith(".json")) copyFileSync(join(REPORTS, f), join(src4, "reports", f));
  copyFileSync(join(src1, "manifest.json"), join(src4, "manifest.json"));
  const manifestBefore = readFileSync(join(src4, "manifest.json"));
  const run4 = ingest({ sourceDir: src4, outDir: out4, strict: false, pressFile: PRESS, today: "2026-09-11" });
  const missing = (run4.refused || []).filter((r) => r.kind === "sourceMissing");
  check("the run is refused with exit 2, naming the two sources whose keys the manifest records (8 deck keys, 26 workbook keys) and the files they were read from",
    run4.exitCode === 2 && missing.length === 2 && missing.map((r) => r.source).sort().join("|") === "lcd-monitor|pb-fund-overview" && missing.find((r) => r.source === "lcd-monitor").keys === 8 && missing.find((r) => r.source === "pb-fund-overview").keys === 26 && missing.every((r) => r.recordedIn.length === 1 && /\.(pptx|xlsx)$/.test(r.recordedIn[0])), JSON.stringify(run4.refused));
  check("nothing is written: the output folder stays empty and the manifest keeps its bytes", readdirSync(out4).length === 0 && Object.keys(run4.written).length === 0 && readFileSync(join(src4, "manifest.json")).equals(manifestBefore));
  /* the reports present but the committed index naming a source that is not: refused the same way */
  const src5 = join(tmpRoot, "v5"), out5 = join(tmpRoot, "out5");
  mkdirSync(join(src5, "reports"), { recursive: true });
  mkdirSync(out5, { recursive: true });
  for (const f of readdirSync(REPORTS)) if (f.endsWith(".json")) copyFileSync(join(REPORTS, f), join(src5, "reports", f));
  copyFileSync(join(out1, "series-index.json"), join(out5, "series-index.json"));
  const run5 = ingest({ sourceDir: src5, outDir: out5, strict: false, today: "2026-09-11" });
  check("without a manifest, the committed series-index.json names the sources to keep: lcd-monitor, pb-fund-overview and press are refused as missing", run5.exitCode === 2 && run5.refused.filter((r) => r.kind === "sourceMissing").map((r) => r.source).sort().join("|") === "lcd-monitor|pb-fund-overview|press", JSON.stringify(run5.refused));
  /* a report file that fails validation refuses the whole run, not just its keys */
  const src6 = join(tmpRoot, "v6"), out6 = join(tmpRoot, "out6");
  mkdirSync(join(src6, "reports"), { recursive: true });
  for (const f of readdirSync(REPORTS)) if (f.endsWith(".json")) copyFileSync(join(REPORTS, f), join(src6, "reports", f));
  const broken = JSON.parse(readFileSync(join(REPORTS, "pitchbook-global-fundraising-2026q2.json"), "utf8"));
  delete broken.series.pb_pd_fundraising_ttm.points[0].page;
  writeFileSync(join(src6, "reports/pitchbook-global-fundraising-2026q2.json"), JSON.stringify(broken));
  const run6 = ingest({ sourceDir: src6, outDir: out6, strict: false, pressFile: PRESS, today: "2026-09-11" });
  check("a report file that fails validation refuses the run (exit 2, nothing written) with the file and the problem named, strict or not", run6.exitCode === 2 && run6.refused.length === 1 && run6.refused[0].kind === "unreadable" && run6.refused[0].file === "reports/pitchbook-global-fundraising-2026q2.json" && /refused: pb_pd_fundraising_ttm: point without a page/.test(run6.refused[0].error) && !existsSync(out6), JSON.stringify(run6.refused));
}

/* ---------- hygiene over every written file ---------- */
console.log("hygiene");
{
  const NAME_DIGEST = "69c89b4bcbdf855bfc73a35d854a7a66713c6759e7421ec9b36a3bfe4793efa3";
  const META_DIGEST = "9707b8eabdbadea3b3897f9ac228873835c76d289013a816eb977bdeb42f2baf";
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  const files = [];
  const walk = (dir) => { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.(json|mjs|md|yml)$/.test(f.name)) files.push(p); } };
  for (const d of [out1, out2, out3]) walk(d);
  for (const f of ["scripts/pc-map.json", "scripts/lib/pc-map.mjs", "scripts/lib/pc-series.mjs", "scripts/ingest-pc.mjs", "scripts/test-pc-ingest.mjs", "data-sources/README.md", ".github/workflows/ingest-pc.yml"]) if (existsSync(join(ROOT, f))) files.push(join(ROOT, f));
  const committed = join(ROOT, "frontend/data/pc");
  for (const f of ["series.json", "series-index.json", "series-provenance.json", "restatements.json", "ingest-report.json"]) if (existsSync(join(committed, f))) files.push(join(committed, f));
  for (const sub of ["series", "tables"]) if (existsSync(join(committed, sub))) walk(join(committed, sub));
  if (existsSync(join(ROOT, "data-sources/manifest.json"))) files.push(join(ROOT, "data-sources/manifest.json"));
  /* the vendor and model names that must not appear are assembled from
     halves, so the literal never sits in this file either */
  const VENDOR_RE = new RegExp("\\b(" + [["cla", "ude"], ["anthr", "opic"], ["open", "ai"], ["chat", "gpt"], ["copi", "lot"], ["gem", "ini"]].map((w) => w.join("")).join("|") + ")\\b", "i");
  /* a working folder or a note of how a page was fetched is not served either (the press caveats carried both once) */
  const LOCAL_RE = new RegExp(["scratch", "pad/"].join(""), "i");
  const PROCESS_RE = new RegExp("\\| " + ["refu", "ter:"].join("") + "|" + ["Web", "Fetch"].join("") + "|\\bcurl\\b", "i");
  const hits = [];
  let parsed = 0;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (/\.json$/.test(f)) { try { JSON.parse(text); parsed++; } catch (e) { hits.push(f + ": not JSON"); } }
    const lower = text.toLowerCase();
    if (new RegExp("created " + "for:", "i").test(text)) hits.push(f + ": meta block prefix");
    const words = lower.replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
    for (let i = 0; i + 1 < words.length; i++) if (sha(words[i] + " " + words[i + 1]) === NAME_DIGEST) { hits.push(f + ": owner name"); break; }
    for (const line of lower.split("\n")) if (sha(line.trim()) === META_DIGEST) hits.push(f + ": meta block");
    if (/\b(api[_-]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9]{16,}/i.test(text)) hits.push(f + ": key-like string");
    if (VENDOR_RE.test(text)) hits.push(f + ": vendor or model name");
    if (/licensee name removed from the fixture/.test(text) && !/test-pc-ingest\.mjs$/.test(f)) hits.push(f + ": the fixture's H4 placeholder");
    if (/C:\\Users|C:\/Users|\/Users\/[a-z]/i.test(text) || LOCAL_RE.test(text)) hits.push(f + ": local path");
    if (PROCESS_RE.test(text) && /\.json$/.test(f)) hits.push(f + ": a fetch-process note or reviewer tag");
  }
  check(`every written file parses and none carries the owner's name, the meta block, a key or a vendor name (${files.length} files, ${parsed} JSON)`, hits.length === 0 && parsed > 40, hits.join("; "));
  check("staff names and addresses from the methodology slide never reach an output", files.filter((f) => /\.json$/.test(f)).every((f) => !/@/.test(readFileSync(f, "utf8").replace(/https?:\/\/[^"\s]+/g, ""))));
  /* the committed outputs agree with each other, raw files or not */
  if (existsSync(join(committed, "series.json"))) {
    const cs = JSON.parse(readFileSync(join(committed, "series.json"), "utf8"));
    const ci = JSON.parse(readFileSync(join(committed, "series-index.json"), "utf8"));
    const cp = JSON.parse(readFileSync(join(committed, "series-provenance.json"), "utf8"));
    const keysOf = (o) => Object.keys(o.keys).sort().join("|");
    check("committed series.json, series-index.json and series-provenance.json name the same keys", keysOf(cs) === Object.keys(ci.series).sort().join("|") && keysOf(cs) === keysOf(cp));
    check("the committed index's n, first and last agree with the committed series", Object.entries(ci.series).every(([k, e]) => { const s = cs.keys[k]; const dated = s.points.filter((p) => p.p); return e.n === s.points.length && e.first === (dated.length ? dated[0].p : null) && e.last === (dated.length ? dated[dated.length - 1].p : null); }));
    const partition = [];
    for (const g of Object.keys(ci.groups)) partition.push(...Object.keys(JSON.parse(readFileSync(join(committed, ci.groups[g].file), "utf8")).keys));
    check("the committed group files partition the committed series", partition.length === Object.keys(cs.keys).length && new Set(partition).size === partition.length && partition.every((k) => cs.keys[k]));
    check("the committed index says the August monitor runs through Aug 31 2026 with the next expected in early October", ci.sources["lcd-monitor"] && ci.sources["lcd-monitor"].asOf === "2026-08-31" && ci.sources["lcd-monitor"].nextExpectedLabel === "early October");
    check("no committed series carries a point without a value or a key without a population", Object.values(cs.keys).every((s) => s.population !== undefined && s.points.every((p) => typeof p.v === "number" && Number.isFinite(p.v))));
  }
}

/* ---------- the whole first vintage, when the raw files are present ---------- */
console.log("the whole first vintage (local only)");
if (existsSync(RAW_DECK) && existsSync(RAW_WB)) {
  const out = join(tmpRoot, "full");
  const run = ingest({ sourceDir: join(ROOT, "data-sources"), outDir: out, strict: true, pressFile: PRESS, today: "2026-09-11", manifestPath: join(tmpRoot, "full-manifest.json") });
  const S = run.report.summary;
  check("strict over the real deck and workbook: 31 charts and 20 sheets, 50 matched by heading, zero unmatched, zero fallback, zero refused, exit 0", run.exitCode === 0 && S.charts === 31 && S.sheets === 20 && S.matched === 50 && S.fallbackMatched === 0 && S.unmatched === 0 && S.unmatchedSeries === 0 && S.refused === 0 && S.filterMismatch === 0, JSON.stringify(S));
  const deckFile = run.report.files.find((f) => f.source === "lcd-monitor");
  check("the Disclaimer sheet is skipped as the license text, the 19 data sheets matched", run.report.files.find((f) => f.source === "pb-fund-overview").skipped.length === 1 && run.report.files.find((f) => f.source === "pb-fund-overview").matched.length === 19);
  const k = JSON.parse(readFileSync(join(out, "series.json"), "utf8")).keys;
  check("391 keys and 2,905 points: 89 deck (84 series and 5 aliases), 124 workbook (118 series and 6 table keys), 141 report, 20 press, 17 derived", S.keys === 391 && Object.keys(k).filter((x) => k[x].source === "lcd-monitor").length === 89 && Object.keys(k).filter((x) => k[x].source === "pb-fund-overview").length === 124 && Object.keys(k).filter((x) => k[x].group === "reports").length === 141 && Object.keys(k).filter((x) => k[x].source === "derived").length === 17 && S.points === 2905, JSON.stringify(S));
  check("1,094 deck points = 1,209 live cache points less the 115 of the five duplicate series", Object.values(k).filter((s) => s.source === "lcd-monitor").reduce((n, s) => n + s.points.length, 0) === 1094);
  check("the five duplicates compare equal to their canonical series, point for point, and are written once: the copy's key is an alias with no points (chart10's copy has 7 of the canonical 8)", deckFile.duplicatesSkipped.length === 5 && deckFile.duplicatesSkipped.every((d) => d.differing === 0 && d.compared === d.points && !d.written) && deckFile.duplicatesSkipped.every((d) => k[d.key] && k[d.key].alias === d.duplicateOf && k[d.key].points.length === 0 && k[d.duplicateOf].points.length >= d.compared) && k.lcd_dl_lbo_count_quarterly_c16.alias === "lcd_dl_lbo_count_quarterly" && k.lcd_dl_lbo_spread_annual.points.length === 8 && deckFile.duplicatesSkipped.find((d) => d.key === "lcd_dl_lbo_spread_annual_c10").points === 7);
  check("the six list sheets are keys that point to their table file, with no points; every table file named exists", ["pb_first_time_commitments_list", "pb_newly_opened_funds_list", "pb_open_funds_largest_target_list", "pb_first_time_managers_open_list", "pb_recent_mandates_list", "pb_recent_terms_fees_list"].every((x) => k[x] && k[x].unit === "table" && k[x].points.length === 0 && /^tables\/[a-z0-9-]+\.json$/.test(k[x].table) && existsSync(join(out, k[x].table))));
  check("the annual bars equal the sums of their quarters on all six pairs (2025 count 234+225+207+210 = 876)", deckFile.crossChecks.length === 6 && deckFile.crossChecks.every((c) => c.equal && c.checked === 6) && (() => { const qs = k.lcd_dl_count_quarterly.points.filter((p) => p.g === "quarter" && p.p.startsWith("2025")).map((p) => p.v); return qs.join("+") === "234+225+207+210" && at(k.lcd_dl_count_annual, "2025-12-31").v === 876; })());
  check("chart2: YTD 2026 535 / 146.487681603, YTD 2025 592 / 164.650305777 (ending Aug 31 of each year), 2025 268.38137862099995", at(k.lcd_dl_count_annual, "2026-08-31", "ytd").v === 535 && at(k.lcd_dl_volume_annual, "2026-08-31", "ytd").v === 146.487681603 && at(k.lcd_dl_count_annual, "2025-08-31", "ytd").v === 592 && at(k.lcd_dl_volume_annual, "2025-08-31", "ytd").v === 164.650305777 && at(k.lcd_dl_volume_annual, "2025-12-31", "year").v === 268.38137862099995);
  check("chart5 Refinancing: 26 live points, the 2Q20 blank reported and explained against the catalog's 27", k.lcd_dl_pe_count_refi_quarterly.points.length === 26 && !at(k.lcd_dl_pe_count_refi_quarterly, "2020-06-30") && deckFile.blanks.length === 1 && deckFile.blanks[0].cats[0] === "2Q20" && run.report.catalog.rows.find((r) => r.key === "lcd_dl_pe_count_refi_quarterly").expected === 27);
  check("chart8 sector shares are snapshot keys per period with the sector as c: 2026 YTD Healthcare 0.196…, Automotive 0.0224 last", (() => { const s = k.lcd_dl_sector_share_count_2026ytd; return s.points.length === 10 && s.points[0].c === "Healthcare" && near(s.points[0].v, 0.19626168224299065) && s.points[9].c === "Automotive" && near(s.points[9].v, 0.0224, 1e-3) && s.points.every((p) => p.p === "2026-08-31" && p.g === "ytd"); })());
  check("chart10 diff YTD = 118.59061488673137; chart12 rolling = 161.7892976588629 (each chart on its own cache)", near(at(k.lcd_lbo_spread_diff_dl_vs_bsl_bminus_annual, "2026-08-31", "ytd").v, 118.59061488673137) && near(at(k.lcd_lbo_spread_diff_dl_vs_bsl_all_quarterly, "2026-08-31", "rolling3m").v, 161.7892976588629));
  check("charts 13-15 accumulate: three points each ending on the rolling window (PE-backed 519.35…, LBOs 502.2…)", k.lcd_dl_pe_spread_recent.points.length === 3 && k.lcd_dl_pe_spread_recent.points[2].g === "rolling3m" && near(k.lcd_dl_pe_spread_recent.points[2].v, 519.3548, 1e-4) && near(k.lcd_dl_lbo_spread_recent.points[2].v, 502.2, 0.05) && k.lcd_dl_pe_spread_recent.accumulates === undefined);
  check("chart20: four types at 1H26 as half-year points, syndicated loans 0.44, geography US and Europe", at(k.lcd_global_lbo_1b_share_bsl_annual, "2026-06-30", "half").v === 0.44 && k.lcd_global_lbo_1b_share_bsl_annual.geography === "US and Europe" && k.lcd_global_lbo_1b_share_dl_annual.points.length === 12);
  check("chart21: four snapshot keys 3Q25..2Q26 with ten buckets each in the chart's order, Under 400 first; 3Q25 '800 or higher' = 0.0329… (its catalog caveat)", ["3q25", "4q25", "1q26", "2q26"].every((q) => k["lcd_bdc_spread_dist_count_" + q] && k["lcd_bdc_spread_dist_count_" + q].points.length === 10 && k["lcd_bdc_spread_dist_count_" + q].points[0].c === "Under 400" && k["lcd_bdc_spread_dist_count_" + q].points[9].c === "800 or higher") && (() => { const p = k.lcd_bdc_spread_dist_count_3q25.points.find((x) => x.c === "800 or higher"); return p && p.p === "2025-09-30" && near(p.v, 0.0329, 5e-5); })());
  check("chart25: the 2026 bucket is 0.01950316632734697 at Mar 31 and 0.013084810619104497 at Jun 30, on separate snapshot keys; chart26 in $B on its own cache", near(k.lcd_bdc_maturity_wall_pct_2026q1.points.find((p) => p.c === "2026").v, 0.01950316632734697) && near(k.lcd_bdc_maturity_wall_pct_2026q2.points.find((p) => p.c === "2026").v, 0.013084810619104497) && k.lcd_bdc_maturity_wall_usd_2026q2.unit === "$B" && k.lcd_bdc_maturity_wall_usd_2026q2.points.length === 6);
  check("chart28: 2025 dry powder 169.6 and NAV 295.7, twenty years from 2006; chart29 direct lending TTM 100.4 as a rolling12m point ending Jun 30 2026", at(k.pb_us_dl_dry_powder_annual, "2025-12-31").v === 169.6 && at(k.pb_us_dl_nav_annual, "2025-12-31").v === 295.7 && k.pb_us_dl_dry_powder_annual.points.length === 20 && k.pb_us_dl_dry_powder_annual.points[0].p === "2006-12-31" && at(k.pb_us_private_debt_raised_direct_lending_annual, "2026-06-30", "rolling12m").v === 100.4 && at(k.pb_us_private_debt_raised_direct_lending_annual, "2026-06-30", "rolling12m").start === "2025-07-01");
  check("chart31 rolling: DL refinanced by BSL 8.61159, BSL refinanced by DL 4.0261306086, with the slide-39 revision note", near(at(k.lcd_takeout_dl_refinanced_by_bsl_quarterly, "2026-08-31").v, 8.61159) && near(at(k.lcd_takeout_bsl_refinanced_by_dl_quarterly, "2026-08-31").v, 4.0261306086) && /subject to revisions/.test(JSON.parse(readFileSync(join(out, "series-provenance.json"), "utf8")).keys.lcd_takeout_dl_refinanced_by_bsl_quarterly.restatementNote));
  check("the workbook headline strings reproduce: 2025 $1.65Tn / 4999, 2026 YTD $1.08Tn / 2345; fees 1.73%, 2.00%, 17.93%, 20.00% as fractions; Pension $3.14Tn / 56983; Middle East 2026 count share 3.20% as printed",
    at(k.pb_all_capital_raised_annual, "2025-12-31").v === 1650 && at(k.pb_all_fund_count_annual, "2025-12-31").v === 4999 && at(k.pb_all_capital_raised_annual, "2026-09-10").v === 1080 && at(k.pb_all_fund_count_annual, "2026-09-10").v === 2345
    && at(k.pb_all_avg_management_fee_annual, "2026-09-10").v === 0.0173 && at(k.pb_all_median_management_fee_annual, "2026-09-10").v === 0.02 && at(k.pb_all_avg_carried_interest_annual, "2026-09-10").v === 0.1793 && at(k.pb_all_median_carried_interest_annual, "2026-09-10").v === 0.2
    && at(k.pb_lp_pension_amount_committed, "2026-09-10").v === 3140 && at(k.pb_lp_pension_commitment_count, "2026-09-10").v === 56983 && at(k.pb_loc_middle_east_count_share_annual, "2026-09-10").v === 0.032);
  check("the six workbook list sheets are tables with five rows each; the two EMF tables match the hand-keyed file", ["pb-first-time-commitments", "pb-newly-opened-funds", "pb-open-funds-largest-target", "pb-first-time-fund-managers-open", "pb-recent-mandates", "pb-recently-added-terms-fees"].every((s) => JSON.parse(readFileSync(join(out, "tables/" + s + ".json"), "utf8")).editions[0].rows.length === 5) && deckFile.tables.length === 2 && deckFile.tables.every((t) => t.handKeyedCheck === true));
  check("derived: deployment TTM 250.22 (146.49 + 268.38 − 164.65), years of dry powder 0.68 (169.6 ÷ 250.22), calendar 2020 1.58", near(at(k.derived_dl_deployment_ttm, "2026-08-31").v, 146.487681603 + 268.38137862099995 - 164.650305777, 1e-9) && near(at(k.derived_dl_years_of_dry_powder, "2026-08-31").v, 169.6 / (146.487681603 + 268.38137862099995 - 164.650305777), 1e-9) && near(at(k.derived_dl_years_of_dry_powder_calendar, "2020-12-31").v, 1.58, 0.005));
  check("derived: fundraising minus deployment 2025 = 164.7 − 268.38 = −103.68; 2020 = +84.0; DL-only 2025 = −208.78", near(at(k.derived_fundraising_minus_deployment_annual, "2025-12-31").v, -103.68, 0.005) && near(at(k.derived_fundraising_minus_deployment_annual, "2020-12-31").v, 84.0, 0.05) && near(at(k.derived_dl_fundraising_minus_deployment_annual, "2025-12-31").v, -208.78, 0.005));
  check("derived: AUM 465.3, dry-powder share 36.4%, 10-year CAGR 21.5%, 5-year 13.5%, DL share of PD raised 48.3% TTM and 58.1% in 2024, total TTM 207.7", at(k.derived_us_dl_aum_annual, "2025-12-31").v === 465.3 && near(at(k.derived_us_dl_dry_powder_share_of_aum, "2025-12-31").v, 0.3645, 5e-4) && near(at(k.derived_us_dl_aum_cagr_10y, "2025-12-31").v, 0.2146, 5e-4) && near(at(k.derived_us_dl_aum_cagr_5y, "2025-12-31").v, 0.1348, 5e-4) && near(at(k.derived_us_dl_share_of_private_debt_raised, "2026-06-30").v, 0.483, 5e-4) && near(at(k.derived_us_dl_share_of_private_debt_raised, "2024-12-31").v, 0.581, 5e-4) && near(at(k.derived_us_private_debt_raised_total_annual, "2026-06-30").v, 207.7, 0.05));
  check("derived: LBO financing through both channels 1Q26 51.4, 2Q26 27.2", near(at(k.derived_lbo_financing_both_channels_quarterly, "2026-03-31").v, 51.4, 0.05) && near(at(k.derived_lbo_financing_both_channels_quarterly, "2026-06-30").v, 27.2, 0.05));
  check("every derived key names its formula and inputs and is sourced 'derived'", Object.values(k).filter((s) => s.source === "derived").every((s) => s.formula && Array.isArray(s.inputs) && s.inputs.every((i) => k[i])));
  check("a derived key whose input is itself derived inherits the newest input's as-of and vintage: the CAGRs 2025-12-31 (from the derived AUM), years of dry powder 2026-08-31 (from the derived deployment window)", k.derived_us_dl_aum_cagr_10y.asOf === "2025-12-31" && k.derived_us_dl_aum_cagr_5y.asOf === "2025-12-31" && k.derived_us_dl_aum_cagr_10y.vintage === "2026-09-10" && k.derived_dl_years_of_dry_powder.asOf === "2026-08-31" && k.derived_dl_years_of_dry_powder.points[0].p === "2026-08-31", JSON.stringify([k.derived_us_dl_aum_cagr_10y.asOf, k.derived_dl_years_of_dry_powder.asOf]));
  check("the whole vintage serves eleven grains, none of them 'ttm', and 70 keys in unit pct", (() => { const grains = new Set(Object.values(k).flatMap((s) => s.points.map((p) => p.g))); return grains.size === 11 && !grains.has("ttm") && [...grains].every((g) => SERVED_GRAINS.has(g)) && Object.values(k).filter((s) => s.unit === "pct").length === 70 && !Object.values(k).some((s) => s.unit === "%"); })(), JSON.stringify([...new Set(Object.values(k).flatMap((s) => s.points.map((p) => p.g)))]));
  check("the catalog check: every map entry with a point count either reproduces it or explains the delta (12 explained: 1 blank cell, 5 duplicates, 6 tables)", run.report.catalog.checked === 213 && run.report.catalog.differing === 12 && run.report.catalog.rows.every((r) => r.reason));
  check("every series of the real deck sits on an axis of its key's class and no matched chart or sheet lost a signal: zero refused, zero signalMismatch over 31 charts and 19 sheets", S.refused === 0 && S.signalMismatch === 0 && deckFile.signalMismatch.length === 0 && run.report.files.find((f) => f.source === "pb-fund-overview").signalMismatch.length === 0);
  const fullProv = JSON.parse(readFileSync(join(out, "series-provenance.json"), "utf8"));
  check("the provenance names the map group of every deck and workbook key (chart13's keys lcd-dl-spread-pe-backed-and-lbo-recent)", Object.keys(k).filter((x) => k[x].source === "lcd-monitor" || k[x].source === "pb-fund-overview").every((x) => fullProv.keys[x].fingerprintId) && fullProv.keys.lcd_dl_pe_spread_recent.fingerprintId === "lcd-dl-spread-pe-backed-and-lbo-recent");
  /* an accumulating chart unmatched in the next edition: chart13's
     three-period spreads, which accumulate across editions, must still
     go stale when their chart is not read, or the page would draw the
     August spreads as current with no marker */
  {
    const full = extractDeck(readDeck(readFileSync(RAW_DECK)), map, { vintage: "2026-09-10" });
    const gone = "lcd-dl-spread-pe-backed-and-lbo-recent";
    const sep = { ...full, id: "2026-10-12", edition: "2026-09", series: Object.fromEntries(Object.entries(full.series).filter(([, x]) => x.fingerprintId !== gone)), report: { ...full.report, matched: full.report.matched.filter((m) => m.id !== gone) } };
    const b = build([full, sep]);
    const pe = b.keys.lcd_dl_pe_spread_recent;
    check("chart13 unmatched in a September vintage: lcd_dl_pe_spread_recent and lcd_dl_lbo_spread_recent are stale with lastSeenEdition 2026-08 and keep their three August points (rolling 519.35…); every other accumulating deck key, whose chart was read, is current",
      b.stale.map((x) => x.key).sort().join("|") === "lcd_dl_lbo_spread_recent|lcd_dl_pe_spread_recent" && pe.stale && pe.stale.lastSeenEdition === "2026-08" && pe.stale.groupRead === false && pe.points.length === 3 && near(pe.points[2].v, 519.3548, 1e-4) && Object.values(b.keys).filter((x) => x.accumulates && !x.stale).length === 27, JSON.stringify(b.stale));
  }
  /* the committed outputs are this run's outputs */
  const committed = join(ROOT, "frontend/data/pc");
  if (existsSync(join(committed, "series.json"))) {
    const strip = (t) => t.replace(/"generated":"[^"]*"/g, "").replace(/"ran":"[^"]*"/g, "").replace(/"ingestedAt":"[^"]*"/g, "");
    const same = ["series.json", "series-index.json", "series-provenance.json", "restatements.json"].every((f) => strip(readFileSync(join(committed, f), "utf8")) === strip(readFileSync(join(out, f), "utf8")));
    check("the committed frontend/data/pc files are what this ingest writes (dates aside)", same);
  }
  if (CATALOG && existsSync(CATALOG)) {
    const cat = JSON.parse(readFileSync(CATALOG, "utf8"));
    const rows = [...cat.groups[0].rows, ...cat.groups[1].rows];
    const byKey = Object.fromEntries(map.entries.map((e) => [e.key, e]));
    const missing = rows.filter((r) => !byKey[r.key]).map((r) => r.key);
    check(`every catalog key of groups 0 and 1 is a map entry (${rows.length})`, missing.length === 0, missing.join(", "));
    const served = [...rows, ...cat.groups[2].rows].filter((r) => !k[r.key]).map((r) => r.key);
    check(`every catalog key of groups 0, 1 and 2 is a key in series.json (${rows.length + cat.groups[2].rows.length}); the duplicates as aliases, the list sheets as table keys`, served.length === 0 && rows.filter((r) => byKey[r.key].duplicateOf).every((r) => k[r.key].alias === byKey[r.key].duplicateOf) && rows.filter((r) => byKey[r.key].table).every((r) => k[r.key].table === "tables/" + byKey[r.key].table.slug + ".json"), served.join(", "));
    const asOfOf = (r) => { const m = /(\d{4}-\d{2}-\d{2})/.exec(r.asOf || ""); return m ? m[1] : null; };
    const dateOf = (label, asOf) => { let m; if ((m = /\((\d{4}-\d{2}-\d{2})\)/.exec(label))) return m[1]; if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label; if ((m = /^FY(\d{4})$/.exec(label))) return m[1] + "-12-31"; if ((m = /^YTD (\d{4}) \(Jan 1 to (.+)\)$/.exec(label))) return parsePeriod("YTD " + m[1], { asOf }).end; const p = parsePeriod(label, { asOf }); return p ? p.end : null; };
    const disagree = [];
    let agreed = 0;
    for (const r of rows) {
      const e = byKey[r.key];
      if (e.duplicateOf || e.table) continue;
      const s = k[r.key];
      const asOf = asOfOf(r);
      const first = dateOf(r.firstPeriod, asOf), last = dateOf(r.lastPeriod, asOf);
      const dated = s ? s.points.map((p) => p.p).sort() : [];
      if (s && first === dated[0] && last === dated[dated.length - 1]) agreed++;
      else disagree.push(r.key + ": catalog " + r.firstPeriod + " .. " + r.lastPeriod + " → " + first + " .. " + last + "; written " + dated[0] + " .. " + dated[dated.length - 1]);
    }
    check(`first and last period agree with the catalog on every written key (${agreed})`, disagree.length === 0 && agreed === rows.length - 11, disagree.slice(0, 8).join(" | "));
    const spot = [];
    for (const r of rows) {
      const e = byKey[r.key];
      if (e.duplicateOf || e.table || !k[r.key]) continue;
      const m = /Latest ([\d.]+) at "([^"]+)"/.exec(r.caveats || "");
      if (!m) continue;
      const want = Number(m[1]);
      const s = k[r.key];
      const label = m[2];
      const pt = e.orientation === "series" ? s.points.find((p) => p.c === label) : (() => { const per = parsePeriod(label, { asOf: asOfOf(r) }); return per ? s.points.find((p) => p.p === per.end && p.g === per.grain) : null; })();
      if (!pt || Math.abs(pt.v - want) > Math.pow(10, -(m[1].split(".")[1] || "").length) / 2 + 1e-9) spot.push(r.key + ": catalog " + want + " at " + label + ", written " + (pt ? pt.v : "nothing"));
    }
    check("every 'Latest … at …' spot value in the deck catalog's caveats reproduces to the printed precision", spot.length === 0, spot.slice(0, 8).join(" | "));
    const wbSpot = [];
    for (const r of cat.groups[1].rows) {
      const e = byKey[r.key];
      if (e.table || !k[r.key]) continue;
      const m = /(?:2025 = |Value at 10 Sep 2026: )([^;.]+?)(?:;|\.(?:\s|$))/.exec(r.caveats || "");
      if (!m) continue;
      const raw = (/^\$?[\d,.]+(?:Tn|B|M|%)?/.exec(m[1].trim()) || [m[1].trim()])[0];
      const num = Number(raw.replace(/[$,%TnBM]/g, ""));
      const scale = /Tn$/.test(raw) ? 1000 : /B$/.test(raw) ? 1 : /M$/.test(raw) ? (e.unit === "$M" ? 1 : 1e-3) : /%$/.test(raw) ? 0.01 : 1;
      const want = Math.round(num * scale * 1e9) / 1e9;
      const pt = e.periodColumn ? at(k[r.key], "2025-12-31", "year") : k[r.key].points[0];
      if (!pt || !near(pt.v, want, 1e-9)) wbSpot.push(r.key + ": " + raw + " → " + want + ", written " + (pt ? pt.v : "nothing"));
    }
    check("every 2025 or snapshot value quoted in the workbook catalog's caveats reproduces exactly", wbSpot.length === 0, wbSpot.slice(0, 8).join(" | "));
  } else console.log("  skip  PC_SERIES_CATALOG is not set to the series catalog; the catalog block runs locally only");
} else {
  console.log("  skip  data-sources/lcd/2026-09-10 and pitchbook/2026-09-10 are not present (not committed); the whole-vintage checks run locally only");
}

if (manifestDigestAtStart !== null) check("the committed data-sources/manifest.json was not rewritten by this test", createHash("sha256").update(readFileSync(COMMITTED_MANIFEST)).digest("hex") === manifestDigestAtStart);
cleanup();
console.log(failed ? "\n" + failed + " pc-ingest check(s) failed" : "\nall pc-ingest checks pass");
process.exit(failed ? 1 : 0);
