/**
 * test-pc-periods.mjs — the period grammar against every label the
 * sources print.
 *
 * Two label sets. The deck's: every distinct category and series name of
 * the 31 chart caches of the August 2026 monitor (scratchpad
 * pc-x/deck-charts.json, read from ppt/charts/chartN.xml; 1,210 cached
 * points), listed below with the charts that carry each and the as-of
 * date of each chart's slide source line. The workbook's: the Year
 * column and the "Downloaded on:" stamp of the fixture cut, plus every
 * Year and Open Date cell of the real export when it is on disk, and the
 * catalog's own year-to-date label.
 *
 * Every label either parses, or is a bucket or dimension that must come
 * back null; the one label that reads like a period and is a bucket
 * ("2031 - 2033", the maturity wall's last bar) is named. Unparsed count
 * must be zero.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePeriod, parseDate, looksLikePeriod, grainsOf, GRAINS, quarterEnd, monthEnd } from "./lib/pc-periods.mjs";
import { readWorkbook } from "./lib/xlsx-read.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const win = (p) => (p ? p.grain + " " + p.start + ".." + p.end : String(p));

/* ---------- pinned cases, each from a named source ---------- */
console.log("pinned labels");
const AUG = "2026-08-31"; /* slide 4 source line "*As of Aug. 31, 2026" */
const JUN = "2026-06-30"; /* slide 36 source line "*As of June 30, 2026" */
const pin = (label, asOf, grain, start, end, cite) => {
  const p = parsePeriod(label, asOf ? { asOf } : {});
  check(JSON.stringify(label) + (asOf ? " at " + asOf : "") + " -> " + grain + " " + start + ".." + end + "  (" + cite + ")",
    !!p && p.grain === grain && p.start === start && p.end === end && p.fiscal === false, win(p));
};
pin("1Q20", null, "quarter", "2020-01-01", "2020-03-31", "chart1 first category");
pin("2Q26", null, "quarter", "2026-04-01", "2026-06-30", "chart1 category 26");
pin("Q3 2018", null, "quarter", "2018-07-01", "2018-09-30", "chart27 first category");
pin("Q2 2026", null, "quarter", "2026-04-01", "2026-06-30", "chart27 last category");
pin("2020", null, "year", "2020-01-01", "2020-12-31", "chart2 first category");
pin("2006", null, "year", "2006-01-01", "2006-12-31", "chart28 first category");
pin("1H26", null, "half", "2026-01-01", "2026-06-30", "chart20 last category");
pin("YTD 2026", AUG, "ytd", "2026-01-01", "2026-08-31", "chart2 last category, slide 5 as-of");
pin("YTD 2025", AUG, "ytd", "2025-01-01", "2025-08-31", "chart2 comparable window, slide 5 as-of");
pin("YTD August 2026", AUG, "ytd", "2026-01-01", "2026-08-31", "chart9 last category, slide 13 as-of");
pin("YTD August 2026", null, "ytd", "2026-01-01", "2026-08-31", "the month names the window end without an as-of");
pin("2026 YTD", AUG, "ytd", "2026-01-01", "2026-08-31", "chart8 series name, slide 11 as-of");
pin("2025", null, "year", "2025-01-01", "2025-12-31", "chart8 series name");
pin("Last 3 Months", AUG, "rolling3m", "2026-06-01", "2026-08-31", "chart1 last category, slide 4 as-of");
pin("Last 3 months", AUG, "rolling3m", "2026-06-01", "2026-08-31", "chart13 last category (lowercase), slide 17 as-of");
pin("TTM", JUN, "rolling12m", "2025-07-01", "2026-06-30", "chart29 last category, slide 36 as-of");
pin("As of June 30, 2026", null, "asof", "2026-06-30", "2026-06-30", "chart25 series name");
pin("As of March 31, 2026", null, "asof", "2026-03-31", "2026-03-31", "chart25 series name");
pin("As of Aug. 31, 2026", null, "asof", "2026-08-31", "2026-08-31", "the slide source lines' spelling");
pin("As of Aug, 31, 2026", null, "asof", "2026-08-31", "2026-08-31", "slide 10's typo");
pin("Jun-26", null, "month", "2026-06-01", "2026-06-30", "contract R5 example");
pin("10-Sep-2026", null, "asof", "2026-09-10", "2026-09-10", "workbook H3 \"Downloaded on:\"");
pin("2026 YTD (to 10 Sep 2026)", null, "ytd", "2026-01-01", "2026-09-10", "series-catalog group 1 lastPeriod");
pin("2017", null, "year", "2017-01-01", "2017-12-31", "series-catalog group 1 firstPeriod, sheet1 A10");

/* windows that need the slide's as-of and did not get it */
for (const l of ["Last 3 Months", "TTM", "YTD 2026", "2026 YTD"]) {
  const p = parsePeriod(l);
  check(JSON.stringify(l) + " without an as-of is recognized but unresolved", !!p && p.needsAsOf === true && p.start === null && p.end === null, JSON.stringify(p));
}
check("\"YTD 2027\" against an August 2026 as-of is refused, not guessed", parsePeriod("YTD 2027", { asOf: AUG }) === null);
check("a malformed as-of is ignored, not trusted", parsePeriod("Last 3 Months", { asOf: "Aug 31" }).needsAsOf === true);
check("\"Last 6 Months\" has no grain and is refused", parsePeriod("Last 6 Months", { asOf: AUG }) === null);
check("a month-end as-of opens the rolling window on the first of the month: \"Last 3 Months\" at 2026-08-31 opens 2026-06-01, \"TTM\" at 2025-12-31 opens 2025-01-01, at 2024-02-29 opens 2023-03-01",
  parsePeriod("Last 3 Months", { asOf: "2026-08-31" }).start === "2026-06-01" && parsePeriod("TTM", { asOf: "2025-12-31" }).start === "2025-01-01" && parsePeriod("TTM", { asOf: "2024-02-29" }).start === "2023-03-01");
check("a mid-month as-of opens the window the day after the same day n months back: \"TTM\" at 2024-03-20 opens 2023-03-21 (press label \"TTM to 2024-03-20\"), \"Last 3 Months\" at 2026-09-10 opens 2026-06-11",
  parsePeriod("TTM", { asOf: "2024-03-20" }).start === "2023-03-21" && parsePeriod("Last 3 Months", { asOf: "2026-09-10" }).start === "2026-06-11", win(parsePeriod("TTM", { asOf: "2024-03-20" })));
check("the same day n months back that does not exist clamps to that month's end and opens the next month: \"Last 3 Months\" at 2024-05-30 opens 2024-03-01",
  parsePeriod("Last 3 Months", { asOf: "2024-05-30" }).start === "2024-03-01");
check("the comparable YTD clamps Feb 29 to Feb 28", parsePeriod("YTD 2027", { asOf: "2028-02-29" }).end === "2027-02-28");
check("\"YTD August 2026\" with an as-of inside August ends on the as-of", parsePeriod("YTD August 2026", { asOf: "2026-08-15" }).end === "2026-08-15");
check("\"YTD August 2026\" with an as-of outside August ends on the month end", parsePeriod("YTD August 2026", { asOf: "2026-09-10" }).end === "2026-08-31");

/* buckets and dimensions are not periods */
for (const l of ["450 - 499 bps", "450-499", "Healthcare", "2031 - 2033", "Under 400", "650 or higher", "Less than 450", "#REF!", "Count", "Estimated volume", "", null]) {
  check(JSON.stringify(l) + " -> null", parsePeriod(l) === null, win(parsePeriod(l)));
}
check("every grain the grammar emits is in GRAINS", same(GRAINS, ["quarter", "half", "year", "ytd", "rolling3m", "rolling12m", "asof", "month"]));
check("quarterEnd and monthEnd", quarterEnd(2020, 1) === "2020-03-31" && quarterEnd(2024, 4) === "2024-12-31" && monthEnd(2024, 2) === "2024-02-29" && monthEnd(2026, 2) === "2026-02-28");
check("parseDate refuses a slash date", parseDate("9/10/2026") === null);
check("parseDate refuses Feb 30", parseDate("30-Feb-2026") === null);
check("grainsOf on chart1's labels", same(grainsOf(["1Q20", "2Q26", "Last 3 Months"], { asOf: AUG }), ["quarter", "rolling3m"]));
check("grainsOf on chart2's labels", same(grainsOf(["2020", "2025", "YTD 2025", "YTD 2026"], { asOf: AUG }), ["year", "ytd"]));
check("grainsOf on chart25's series names", same(grainsOf(["As of March 31, 2026", "As of June 30, 2026"]), ["asof"]));

/* ---------- the deck: every distinct label of the 31 chart caches ---------- */
console.log("\nthe deck's labels");
/* the as-of of each chart's slide source line: "*As of Aug. 31, 2026" on
   slides 4 to 24, 37 and 39 (slide 10 with the typo "Aug, 31, 2026");
   "*As of June 30, 2026" on slides 27 to 30 and 36; "Data through June
   30, 2026" on slide 20's chart drawing and slides 31 to 33; "*As of Dec.
   31, 2025" on slide 35 */
const CHART_AS_OF = {};
for (let n = 1; n <= 31; n++) CHART_AS_OF["chart" + n] = "2026-08-31";
for (const n of [20, 21, 22, 23, 24, 25, 26, 27, 29]) CHART_AS_OF["chart" + n] = "2026-06-30";
CHART_AS_OF.chart28 = "2025-12-31";
/* year-range buckets that read like periods and are null by design */
const YEAR_BUCKETS = new Set(["2031 - 2033"]);
/* [label, the charts whose caches carry it], generated from deck-charts.json
   and sorted; the count and the PC_DECK_CHARTS cross-check below guard
   the list against drift */
const DECK_CATEGORIES = [
  ["1H26", "chart20"],
  ["1Q20", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19"],
  ["1Q21", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19"],
  ["1Q22", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30"],
  ["1Q23", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["1Q24", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["1Q25", "chart1,chart3,chart5,chart6,chart12,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["1Q26", "chart1,chart3,chart5,chart6,chart12,chart13,chart14,chart15,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["2006", "chart28"],
  ["2007", "chart28"],
  ["2008", "chart28,chart29"],
  ["2009", "chart28,chart29"],
  ["2010", "chart28,chart29"],
  ["2011", "chart28,chart29"],
  ["2012", "chart28,chart29"],
  ["2013", "chart28,chart29"],
  ["2014", "chart28,chart29"],
  ["2015", "chart20,chart28,chart29"],
  ["2016", "chart20,chart28,chart29"],
  ["2017", "chart20,chart28,chart29"],
  ["2018", "chart9,chart20,chart28,chart29"],
  ["2019", "chart9,chart11,chart20,chart28,chart29"],
  ["2020", "chart2,chart4,chart7,chart9,chart10,chart11,chart20,chart28,chart29"],
  ["2021", "chart2,chart4,chart7,chart9,chart10,chart11,chart20,chart28,chart29"],
  ["2022", "chart2,chart4,chart7,chart9,chart10,chart11,chart20,chart28,chart29"],
  ["2023", "chart2,chart4,chart7,chart9,chart10,chart11,chart20,chart28,chart29"],
  ["2024", "chart2,chart4,chart7,chart9,chart10,chart11,chart20,chart28,chart29"],
  ["2025", "chart2,chart4,chart7,chart9,chart10,chart11,chart20,chart28,chart29"],
  ["2026", "chart25,chart26"],
  ["2027", "chart25,chart26"],
  ["2028", "chart25,chart26"],
  ["2029", "chart25,chart26"],
  ["2030", "chart25,chart26"],
  ["2031 - 2033", "chart25,chart26"],
  ["2Q20", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19"],
  ["2Q21", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30"],
  ["2Q22", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30"],
  ["2Q23", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["2Q24", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["2Q25", "chart1,chart3,chart5,chart6,chart12,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["2Q26", "chart1,chart3,chart5,chart6,chart12,chart13,chart14,chart15,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["3Q20", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19"],
  ["3Q21", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30"],
  ["3Q22", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30"],
  ["3Q23", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["3Q24", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["3Q25", "chart1,chart3,chart5,chart6,chart12,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["400-449", "chart21,chart23"],
  ["450-499", "chart21,chart22,chart23"],
  ["4Q20", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19"],
  ["4Q21", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30"],
  ["4Q22", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30"],
  ["4Q23", "chart1,chart3,chart5,chart6,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["4Q24", "chart1,chart3,chart5,chart6,chart12,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["4Q25", "chart1,chart3,chart5,chart6,chart12,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["500-549", "chart21,chart22,chart23"],
  ["550-599", "chart21,chart22,chart23"],
  ["600-649", "chart21,chart22,chart23"],
  ["650 or higher", "chart22,chart23"],
  ["650-699", "chart21"],
  ["700-749", "chart21"],
  ["750-799", "chart21"],
  ["800 or higher", "chart21"],
  ["Automotive", "chart8"],
  ["Building Materials", "chart8"],
  ["Chemicals", "chart8"],
  ["Commercial Products", "chart24"],
  ["Commercial Services", "chart24"],
  ["Consumer Non-Durables", "chart24"],
  ["Food & Beverage", "chart8"],
  ["Healthcare", "chart8"],
  ["Healthcare Services", "chart24"],
  ["Healthcare Technology Systems", "chart24"],
  ["Insurance", "chart24"],
  ["IT Services", "chart24"],
  ["Last 3 months", "chart13,chart14,chart15"],
  ["Last 3 Months", "chart1,chart3,chart5,chart6,chart12,chart16,chart17,chart18,chart19,chart30,chart31"],
  ["Less than 400", "chart23"],
  ["Less than 450", "chart22"],
  ["Manufacturing & Machinery", "chart8"],
  ["Other Financial Services", "chart24"],
  ["Q1 2019", "chart27"],
  ["Q1 2020", "chart27"],
  ["Q1 2021", "chart27"],
  ["Q1 2022", "chart27"],
  ["Q1 2023", "chart27"],
  ["Q1 2024", "chart27"],
  ["Q1 2025", "chart27"],
  ["Q1 2026", "chart27"],
  ["Q2 2019", "chart27"],
  ["Q2 2020", "chart27"],
  ["Q2 2021", "chart27"],
  ["Q2 2022", "chart27"],
  ["Q2 2023", "chart27"],
  ["Q2 2024", "chart27"],
  ["Q2 2025", "chart27"],
  ["Q2 2026", "chart27"],
  ["Q3 2018", "chart27"],
  ["Q3 2019", "chart27"],
  ["Q3 2020", "chart27"],
  ["Q3 2021", "chart27"],
  ["Q3 2022", "chart27"],
  ["Q3 2023", "chart27"],
  ["Q3 2024", "chart27"],
  ["Q3 2025", "chart27"],
  ["Q4 2018", "chart27"],
  ["Q4 2019", "chart27"],
  ["Q4 2020", "chart27"],
  ["Q4 2021", "chart27"],
  ["Q4 2022", "chart27"],
  ["Q4 2023", "chart27"],
  ["Q4 2024", "chart27"],
  ["Q4 2025", "chart27"],
  ["Retail", "chart8"],
  ["Services (Non-Financial)", "chart24"],
  ["Services & Leasing", "chart8"],
  ["Software", "chart24"],
  ["Technology", "chart8"],
  ["TTM", "chart29"],
  ["Under 400", "chart21"],
  ["Utilities", "chart8"],
  ["YTD 2025", "chart2,chart4,chart7"],
  ["YTD 2026", "chart2,chart4,chart7"],
  ["YTD August 2026", "chart9,chart10,chart11"],
];
const DECK_SERIES_NAMES = [
  ["#REF!", "chart27"],
  ["1Q26", "chart21,chart22,chart23,chart24"],
  ["2025", "chart8"],
  ["2026 YTD", "chart8"],
  ["2Q26", "chart21,chart22,chart23,chart24"],
  ["3Q25", "chart21,chart22"],
  ["450 - 499 bps", "chart9"],
  ["450-499 bps", "chart14,chart15"],
  ["4Q25", "chart21,chart22,chart23"],
  ["500 - 549 bps", "chart9"],
  ["500-549 bps", "chart14,chart15"],
  ["550 - 599 bps", "chart9"],
  ["550 bps or higher", "chart14,chart15"],
  ["600 - 649 bps", "chart9"],
  ["650 - 699 bps", "chart9"],
  ["700 bps or higher", "chart9"],
  ["As of June 30, 2026", "chart25,chart26"],
  ["As of March 31, 2026", "chart25,chart26"],
  ["Bridge financing", "chart29"],
  ["BSL refinanced by DL", "chart31"],
  ["BSL spread", "chart10,chart11,chart12"],
  ["Count", "chart1,chart2,chart3,chart4,chart6,chart7,chart30"],
  ["Credit special situations", "chart29"],
  ["Debt", "chart29"],
  ["Debt - Wtd Avg Rate", "chart27"],
  ["Difference (right axis)", "chart10,chart11,chart12"],
  ["Direct lending", "chart16,chart18,chart20,chart29"],
  ["Direct lending (estimate)", "chart17,chart19"],
  ["Direct lending spread", "chart10,chart11,chart12"],
  ["Distressed debt", "chart29"],
  ["DL refinanced by BSL", "chart31"],
  ["Dry powder ($B)", "chart28"],
  ["Estimated volume", "chart1,chart2,chart3"],
  ["Infrastructure debt", "chart29"],
  ["Institutional leveraged loans", "chart16,chart17,chart18,chart19"],
  ["LBO / M&A", "chart5"],
  ["LBOs", "chart13"],
  ["Less than 450 bps", "chart9,chart14,chart15"],
  ["Mezzanine", "chart29"],
  ["NAV ($B)", "chart28"],
  ["Other", "chart5,chart20"],
  ["PE-backed", "chart13"],
  ["Real estate debt", "chart29"],
  ["Recapitalization", "chart5"],
  ["Refinancing", "chart5"],
  ["Syndicated loans ", "chart20"],
  ["Syndicated loans + other debt*", "chart20"],
  ["Venture debt", "chart29"],
  ["Volume", "chart4,chart6,chart7"],
  ["Volume ($B)", "chart30"],
];

const sweep = (name, table, kind) => {
  let parsed = 0, nulls = 0, unparsed = 0, falsePositive = 0;
  const rows = [];
  for (const [label, charts] of table) {
    const chartIds = charts.split(",");
    const asOf = CHART_AS_OF[chartIds[0]];
    const p = parsePeriod(label, { asOf });
    const periodLike = looksLikePeriod(label) && !YEAR_BUCKETS.has(label);
    let verdict;
    if (p && !p.needsAsOf) { parsed++; verdict = periodLike ? win(p) : "PARSED BUT NOT PERIOD-LIKE " + win(p); if (!periodLike) falsePositive++; }
    else if (!periodLike) { nulls++; verdict = YEAR_BUCKETS.has(label) ? "null (year-range bucket, by design)" : "null (bucket or dimension)"; }
    else { unparsed++; verdict = "UNPARSED " + JSON.stringify(p); }
    rows.push("    " + JSON.stringify(label).padEnd(34) + verdict.padEnd(44) + kind + " of " + charts);
  }
  console.log("  " + name + ": " + table.length + " distinct labels, " + parsed + " parsed, " + nulls + " null by design, " + unparsed + " unparsed");
  for (const r of rows) console.log(r);
  check(name + ": zero unparsed", unparsed === 0, String(unparsed));
  check(name + ": nothing that is not a period parses as one", falsePositive === 0, String(falsePositive));
  return { parsed, nulls, unparsed };
};
const cats = sweep("chart categories", DECK_CATEGORIES, "categories");
const sers = sweep("chart series names", DECK_SERIES_NAMES, "series");
check("the deck's 124 distinct categories and 50 distinct series names are all listed", DECK_CATEGORIES.length === 124 && DECK_SERIES_NAMES.length === 50, DECK_CATEGORIES.length + " / " + DECK_SERIES_NAMES.length);
/* the orientation rule of the deck reader: a chart whose series names all
   parse is periods-on-series (chart8, chart21 to chart26) */
const seriesOf = (chart) => DECK_SERIES_NAMES.filter(([, c]) => c.split(",").includes(chart)).map(([l]) => l);
for (const chart of ["chart8", "chart21", "chart22", "chart23", "chart24", "chart25", "chart26"]) {
  check(chart + " series names all parse (periods on series)", seriesOf(chart).every((l) => parsePeriod(l, { asOf: CHART_AS_OF[chart] }) !== null), seriesOf(chart).join(" | "));
}
for (const chart of ["chart1", "chart2", "chart9", "chart14", "chart29", "chart31"]) {
  check(chart + " series names none parse (periods on categories)", seriesOf(chart).every((l) => parsePeriod(l, { asOf: CHART_AS_OF[chart] }) === null), seriesOf(chart).join(" | "));
}

/* when the prototype extraction is on disk, prove the embedded table is
   complete: every label in deck-charts.json is in the table above */
const deckJson = process.env.PC_DECK_CHARTS;
if (deckJson && existsSync(deckJson)) {
  const d = JSON.parse(readFileSync(deckJson, "utf8"));
  const seenCats = new Set(), seenSers = new Set();
  let points = 0;
  for (const c of Object.values(d.charts)) for (const s of c.series) {
    seenSers.add(s.name);
    for (const cat of s.categories || []) seenCats.add(String(cat));
    points += (s.values || []).filter((v) => v !== null && v !== undefined).length;
  }
  const tableCats = new Set(DECK_CATEGORIES.map(([l]) => l)), tableSers = new Set(DECK_SERIES_NAMES.map(([l]) => l));
  check("deck-charts.json: every category is in the embedded table", [...seenCats].every((l) => tableCats.has(l)) && seenCats.size === tableCats.size, seenCats.size + " vs " + tableCats.size);
  check("deck-charts.json: every series name is in the embedded table", [...seenSers].every((l) => tableSers.has(l)) && seenSers.size === tableSers.size, seenSers.size + " vs " + tableSers.size);
  check("deck-charts.json: 1,210 cached points", points === 1210, String(points));
} else {
  console.log("  (PC_DECK_CHARTS not set; the embedded table is used as the record of the deck's labels)");
}

/* ---------- the workbook: the fixture, then the real export when present ---------- */
console.log("\nthe workbook's labels");
const workbookLabels = (wb, source) => {
  const labels = new Map();
  const add = (l, where) => { if (l === null) return; if (!labels.has(l)) labels.set(l, new Set()); labels.get(l).add(where); };
  for (const s of wb.sheets) {
    if (!s.frame) continue;
    add(s.frame.downloadedOnRaw, s.frame.title + " H3");
    s.frame.headerRow.forEach((h, j) => {
      if (h !== "Year" && h !== "Open Date") return;
      s.rows.forEach((r, i) => add(r[j] === undefined ? null : r[j], s.frame.title + " " + String.fromCharCode(65 + j) + s.rowNumbers[i]));
    });
  }
  let unparsed = 0;
  for (const [label, where] of [...labels.entries()].sort()) {
    const p = parsePeriod(label);
    if (!p) unparsed++;
    console.log("    " + JSON.stringify(label).padEnd(20) + (p ? win(p) : "UNPARSED").padEnd(36) + [...where].slice(0, 3).join(", ") + (where.size > 3 ? " (+" + (where.size - 3) + ")" : ""));
  }
  check(source + ": every Year, Open Date and download stamp parses", unparsed === 0, labels.size + " distinct labels, " + unparsed + " unparsed");
  return labels;
};
const FIXTURE = join(here, "fixtures/pc/pb-fund-overview-2026-09-10/fund-overview-cut_2026_09_10_05_03_44.xlsx");
const fixtureLabels = workbookLabels(readWorkbook(readFileSync(FIXTURE)), "fixture");
check("the fixture's Year column runs 2017 to 2026 (sheet1 A10:A19)", same([...fixtureLabels.keys()].filter((l) => /^\d{4}$/.test(l)).sort(), ["2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"]));
check("the fixture's download stamp is 10-Sep-2026 (sheet1 H3)", fixtureLabels.has("10-Sep-2026"));
check("2026 in the workbook is a year label; the ingest dates it by the download stamp", parsePeriod("2026").grain === "year" && parsePeriod("10-Sep-2026").end === "2026-09-10");

const realWorkbook = (() => {
  if (process.env.PC_WORKBOOK && existsSync(process.env.PC_WORKBOOK)) return process.env.PC_WORKBOOK;
  const dir = join(here, "../data-sources/pitchbook");
  if (!existsSync(dir)) return null;
  for (const vintage of readdirSync(dir).sort().reverse()) {
    const files = existsSync(join(dir, vintage)) ? readdirSync(join(dir, vintage)).filter((f) => /\.xlsx$/i.test(f)) : [];
    if (files.length) return join(dir, vintage, files[0]);
  }
  return null;
})();
if (realWorkbook) {
  console.log("  real export: " + realWorkbook);
  const labels = workbookLabels(readWorkbook(readFileSync(realWorkbook)), "real export");
  const dates = [...labels.keys()].filter((l) => parsePeriod(l).grain === "asof");
  check("the real export's Open Date cells are dated instants", dates.length >= 2, dates.join(", "));
} else {
  console.log("  (no data-sources/pitchbook/*/ export on disk; the real-export sweep is skipped)");
}

console.log(failed ? "\n" + failed + " failed" : "\nall period checks pass");
process.exit(failed ? 1 : 0);
