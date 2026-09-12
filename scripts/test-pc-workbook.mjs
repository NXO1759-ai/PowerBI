/**
 * test-pc-workbook.mjs — the Fund Overview reader against a real cut of
 * the export and, when it is on disk, the export itself.
 *
 * The fixture (scripts/fixtures/pc/pb-fund-overview-2026-09-10/) is four
 * sheets of the 2026-09-10 download rebuilt as a real zip by
 * make-fixture.mjs, so readWorkbook runs its production path from bytes
 * to rows. Every figure below is read off the export's own cells (sheet
 * and cell named) or the series catalog; the reconciliations are the
 * catalog's (category counts sum to the headline every year, 2025
 * category capital sums to $1,650.11B).
 *
 * The real export is licensed and lives only in the local, gitignored
 * data-sources/pitchbook/<date>/; when it is present the second half runs
 * the frame identification over all twenty sheets, counts every value
 * suffix, and proves the licensee's name in H4 reaches no served output
 * and no fixture byte. In CI that half is skipped and says so.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook, sheetByTitle, cellAt, parseCellValue, checkStamp, dateFromFileName, sheetFrame, columnIndex, columnLetter } from "./lib/xlsx-read.mjs";
import { readZip } from "./lib/zip-read.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures/pc/pb-fund-overview-2026-09-10/fund-overview-cut_2026_09_10_05_03_44.xlsx");
const FILTER = "Access Point: All; Fund Category: All; Fund Size: All; Vintage Year: All; Fund Location: World";
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, eps = 1e-6) => typeof a === "number" && Math.abs(a - b) <= eps;
const money = (s) => { const p = parseCellValue(s); return p && p.kind === "money" ? p.value : NaN; };
const count = (s) => { const p = parseCellValue(s); return p && p.kind === "number" ? p.value : NaN; };
/* the labels of the meta block; none may reach a served row */
const META_LABELS = ["Fund Overview Download", "Downloaded on:", "Data pulled from:", "Created for:", "Data Filters:", "Chart Filters:", "Currency:"];
const servedRowsClean = (wb) => wb.sheets.every((s) => s.rows.every((r) => r.every((c) => c === null || (!META_LABELS.includes(c.trim()) && !/^©/.test(c.trim())))));

/* the value of H4, read from the zip's own row 4 and shared strings, so
   the test never spells it */
function licenseeOf(bytes) {
  const zip = readZip(bytes);
  const sst = [...zip.text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(""));
  const sheet1 = zip.text("xl/worksheets/sheet1.xml");
  const row4 = /<row r="4"[^>]*>[\s\S]*?<\/row>/.exec(sheet1);
  const idx = [...row4[0].matchAll(/<c\s[^>]*t="s"[^>]*><v>(\d+)<\/v>/g)].map((m) => Number(m[1]));
  const labelAt = idx.findIndex((i) => sst[i] === "Created for:");
  return labelAt >= 0 ? sst[idx[labelAt + 1]] : null;
}

/* the suffix census the contract asks for: every distinct suffix seen on a
   money cell and its count, plus the other kinds */
function census(wb) {
  const out = new Map();
  for (const s of wb.sheets) for (const r of s.rows) for (const c of r) {
    if (c === null) continue;
    const p = parseCellValue(c);
    const k = p.kind + (p.suffix ? ":" + p.suffix : "");
    out.set(k, (out.get(k) || 0) + 1);
  }
  return Object.fromEntries([...out.entries()].sort());
}

/* ---------- the fixture ---------- */
console.log("the fixture cut");
const fixtureBytes = readFileSync(FIXTURE);
const wb = readWorkbook(fixtureBytes);
check("four sheets, all data sheets", wb.sheets.length === 4 && wb.sheets.every((s) => s.kind === "data"), wb.sheets.map((s) => s.kind).join(","));
check("fixture under 80 KB, stored entries", fixtureBytes.length <= 80 * 1024 && readZip(fixtureBytes).entries.every((e) => e.method === 0), fixtureBytes.length + " bytes");

/* the export stamp: docProps/core.xml dcterms:created 2026-09-10T17:03:44Z;
   the file name says 05_03_44 (a 12-hour clock), so dates only */
check("core.xml created is the export stamp", wb.created === "2026-09-10T17:03:44Z" && wb.exportDate === "2026-09-10", wb.created);
check("core.xml carries no modified or title", wb.modified === null && wb.title === null);
const stamp = checkStamp(wb, basename(FIXTURE));
check("the stamp agrees with the file name's date part and every H3", stamp.agree && stamp.fileDate === "2026-09-10" && same(stamp.downloadedOn, ["2026-09-10"]), JSON.stringify(stamp));
check("dateFromFileName reads the real file name", dateFromFileName("PitchBook_Fund_Overview_PitchBook_View_All_Charts_2026_09_10_05_03_44.xlsx") === "2026-09-10" && dateFromFileName("fund-overview.xlsx") === null);

/* sheets identified by frame, not tab name */
const s1 = sheetByTitle(wb, "Fundraising Activity");
const s4 = sheetByTitle(wb, "Fundraising by Category (#)");
const s9 = sheetByTitle(wb, "Average & Median Time To Close (months)");
const s16 = sheetByTitle(wb, "Sources of Capital");
check("every kept sheet resolves by its B4 title", !!s1 && !!s4 && !!s9 && !!s16);
check("the truncated tab \"Average & Median Time To Close \" (31 chars, trailing space) carries the full B4 title",
  !!s9 && s9.name === "Average & Median Time To Close " && s9.name.length === 31 && s9.frame.title === "Average & Median Time To Close (months)", s9 && JSON.stringify(s9.name));
check("sheetByTitle by the tab name finds nothing", sheetByTitle(wb, "Average & Median Time To Close ") === null);
check("header row 9 on every sheet", wb.sheets.every((s) => s.frame.headerRowNumber === 9));
check("sheet1 header", same(s1.frame.headerRow, ["Year", "Capital Raised", "Fund Count"]));
check("sheet4 header", same(s4.frame.headerRow, ["Year", "Fund Category", "Fund Count", "Capital Raised"]));
check("sheet9 header newlines collapse (\"Average Time to Close\\n(Months)\" in the cell)",
  same(s9.frame.headerRow, ["Year", "Average Time to Close (Months)", "Median Time to Close (Months)"]) && s9.frame.headerRowRaw[1].includes("\n"));
check("sheet16 header", same(s16.frame.headerRow, ["LP Type", "Amount Committed", "Commitment Count"]));

/* the filter line, verbatim, is the population label of every series */
check("B5 filter line identical and verbatim on every sheet", wb.sheets.every((s) => s.frame.filterLine === FILTER), s1.frame.filterLine);
check("B6 chart filters per sheet", s1.frame.chartFilters === "Access Point: All; Fund Category: All" && s16.frame.chartFilters === "Access Point: All; Fund Category: All; Limited Partner Type: All");
check("B7 currency USD", wb.sheets.every((s) => s.frame.currency === "USD"));
check("H3 download date", wb.sheets.every((s) => s.frame.downloadedOn === "2026-09-10" && s.frame.downloadedOnRaw === "10-Sep-2026"));
check("the copyright line is captured in the frame and kept out of the rows", wb.sheets.every((s) => s.frame.copyright === "© PitchBook Data, Inc. 2026") && servedRowsClean(wb));

/* the meta block: read for the frame, its owner line withheld */
const served = JSON.stringify(wb);
check("\"Created for:\" is detected and withheld on every sheet", wb.sheets.every((s) => same(s.frame.withheld, ["Created for:"])));
check("the withheld value reaches no served output (the fixture's placeholder is absent)", !served.includes("licensee name removed from the fixture"));
check("no meta label or value sits in a served row", servedRowsClean(wb) && !served.includes("Fund Overview Download"));
check("the licensee's name is in no fixture byte", licenseeOf(fixtureBytes) === "licensee name removed from the fixture");

/* rows and their numbers */
check("sheet1 rows 10 to 19", s1.rows.length === 10 && s1.rowNumbers[0] === 10 && s1.rowNumbers[9] === 19 && s1.frame.firstDataRow === 10 && s1.frame.lastDataRow === 19);
check("sheet4 rows 10 to 59", s4.rows.length === 50 && s4.rowNumbers[0] === 10 && s4.rowNumbers[49] === 59);
check("sheet16 rows 10 to 15", s16.rows.length === 6 && s16.rowNumbers[0] === 10 && s16.rowNumbers[5] === 15);

/* pinned cells */
check("sheet1 B10 $1.35Tn, C10 6328 (2017)", cellAt(s1, "B10") === "$1.35Tn" && cellAt(s1, "C10") === "6328" && cellAt(s1, "A10") === "2017");
check("sheet1 B18 $1.65Tn, C18 4999 (2025)", cellAt(s1, "B18") === "$1.65Tn" && cellAt(s1, "C18") === "4999");
check("sheet1 B19 $1.08Tn, C19 2345 (2026 YTD)", cellAt(s1, "B19") === "$1.08Tn" && cellAt(s1, "C19") === "2345");
check("sheet4 row 12 is 2017 Debt 590 $303.55B", same(s4.rows[2], ["2017", "Debt", "590", "$303.55B"]) && s4.rowNumbers[2] === 12);
check("sheet4 D10 $521.19B", cellAt(s4, "D10") === "$521.19B");
check("sheet4 row 57 is 2026 Debt 155 $247.67B (catalog pb_cat_debt_*)", same(s4.rows[47], ["2026", "Debt", "155", "$247.67B"]) && s4.rowNumbers[47] === 57);
check("sheet9 row 19 is 2026 12.30 4.90 months (catalog: the partial-year artifact)", same(s9.rows[9], ["2026", "12.30", "4.90"]));
check("sheet9 row 10 is 2017 25.10 13.50", same(s9.rows[0], ["2017", "25.10", "13.50"]));
check("sheet16 row 10 Pension $3.14Tn 56983", same(s16.rows[0], ["Pension", "$3.14Tn", "56983"]));
check("sheet16 row 11 Family Offices $4.38B 300", same(s16.rows[1], ["Family Offices", "$4.38B", "300"]));
check("cellAt outside the data rows is null", cellAt(s1, "B4") === null && cellAt(s1, "H3") === null && cellAt(s1, "Z10") === null);

/* values: exact decimals, whole currency units */
check("$1.35Tn is exactly 1350000000000", money("$1.35Tn") === 1350000000000);
check("$2.1Tn (sheet1 B14, 2021) is exactly 2100000000000", money(cellAt(s1, "B14")) === 2100000000000);
check("$303.55B (sheet4 D12) is exactly 303550000000", money("$303.55B") === 303550000000);
check("$4.38B (sheet16 B11) is 4380000000", money("$4.38B") === 4380000000);
check("$253.95M and $45.3M (sheet2 B10, C10) are 253950000 and 45300000", money("$253.95M") === 253950000 && money("$45.3M") === 45300000);
check("$1.43M (sheet15 C10) is 1430000", money("$1.43M") === 1430000);
check("1.64% (sheet19 B10) is the fraction 0.0164", same(parseCellValue("1.64%"), { kind: "percent", value: 0.0164, raw: "1.64%" }));
check("sheet19 row 19: 1.73%, 2.00%, 17.93%, 20.00%", same(["1.73%", "2.00%", "17.93%", "20.00%"].map((s) => parseCellValue(s).value), [0.0173, 0.02, 0.1793, 0.2]));
check("12.30 (sheet9 B19) is the number 12.3", same(parseCellValue("12.30"), { kind: "number", value: 12.3, raw: "12.30" }));
check("4999 (sheet1 C18) is the count 4999", same(parseCellValue("4999"), { kind: "number", value: 4999, raw: "4999" }));
check("09-Sep-2026 (sheet12 C10) is a date", same(parseCellValue("09-Sep-2026"), { kind: "date", value: "2026-09-09", raw: "09-Sep-2026" }));
check("a suffix carries its multiplier", parseCellValue("$1.35Tn").multiplier === 1e12 && parseCellValue("$1.35Tn").suffix === "Tn" && parseCellValue("$303.55B").multiplier === 1e9);
/* the contract's grammar examples (R4) */
check("$1.2Tn, $877.7Bn, $45B", money("$1.2Tn") === 1.2e12 && money("$877.7Bn") === 877700000000 && money("$45B") === 45e9);
check("12.3M and 900K without a currency are scaled numbers", same(parseCellValue("12.3M"), { kind: "number", value: 12300000, raw: "12.3M", suffix: "M", multiplier: 1e6 }) && parseCellValue("900K").value === 900000);
check("45.2% is 0.452", parseCellValue("45.2%").value === 0.452);
check("thousands separators, parentheses and a minus sign", parseCellValue("1,234").value === 1234 && money("($1.5B)") === -1500000000 && parseCellValue("-2.5%").value === -0.025 && money("-$2M") === -2000000);
check("an ISO timestamp is a date", parseCellValue("2026-09-10T17:03:44Z").value === "2026-09-10");
check("n/a stays text, blank is null", same(parseCellValue("n/a"), { kind: "text", value: "n/a", raw: "n/a" }) && parseCellValue("") === null && parseCellValue(null) === null);
check("a fund name stays text", parseCellValue("Debt - General").kind === "text");

/* the catalog's reconciliations, recomputed from the fixture */
const byYear = {};
for (const r of s4.rows) { (byYear[r[0]] = byYear[r[0]] || { n: 0, usd: 0 }); byYear[r[0]].n += count(r[2]); byYear[r[0]].usd += money(r[3]); }
check("category counts sum to the headline count every year (2025: 1416+2323+479+698+83 = 4999)",
  s1.rows.every((r) => byYear[r[0]].n === count(r[2])) && byYear["2025"].n === 4999, JSON.stringify(Object.fromEntries(Object.entries(byYear).map(([y, v]) => [y, v.n]))));
check("2025 category capital sums to $1,650.11B against the headline $1.65Tn", near(byYear["2025"].usd / 1e9, 1650.11) && money(cellAt(s1, "B18")) === 1.65e12, String(byYear["2025"].usd / 1e9));
check("2026 YTD category capital sums to $1,083.25B", near(byYear["2026"].usd / 1e9, 1083.25), String(byYear["2026"].usd / 1e9));
const lp = s16.rows.reduce((a, r) => ({ usd: a.usd + money(r[1]), n: a.n + count(r[2]) }), { usd: 0, n: 0 });
check("Sources of Capital sums to $4,721.12B and 108,204 commitments", near(lp.usd / 1e9, 4721.12) && lp.n === 108204, lp.usd / 1e9 + " / " + lp.n);
const fixtureCensus = census(wb);
console.log("  suffix census of the fixture: " + JSON.stringify(fixtureCensus));
check("the fixture carries Tn and B suffixes (sheet1 B10:B19 and sheet16 B10 are Tn; sheet4 D10:D59 and sheet16 B11:B15 are B)", fixtureCensus["money:Tn"] === 11 && fixtureCensus["money:B"] === 55 && !fixtureCensus["money:M"], JSON.stringify(fixtureCensus));

/* sheetFrame on its own: a meta block with a different label set */
const syntheticFrame = sheetFrame(
  [["Fund Overview Download"], [null, null, "Downloaded on:", "01-Oct-2026"], ["Data pulled from:", "Fundraising Activity", null, "Created for:", "someone"], ["Data Filters:", "Fund Category: Debt; Fund Location: US"], ["Currency:", "USD"], ["Year", "Capital Raised"], ["2025", "$373.55B"], ["© PitchBook Data, Inc. 2026"]],
  [1, 3, 4, 5, 7, 9, 10, 12]);
check("sheetFrame reads a re-export's frame by its labels, wherever the cells sit",
  syntheticFrame.title === "Fundraising Activity" && syntheticFrame.filterLine === "Fund Category: Debt; Fund Location: US" && syntheticFrame.downloadedOn === "2026-10-01"
  && syntheticFrame.headerRowNumber === 9 && syntheticFrame.firstDataRow === 10 && syntheticFrame.lastDataRow === 10 && same(syntheticFrame.withheld, ["Created for:"]) && !JSON.stringify(syntheticFrame).includes("someone"));
check("a sheet without \"Data pulled from:\" has no frame", sheetFrame([["All data copyright PitchBook Data, Inc."], ["contact us at:"]], [1, 3]) === null);
check("column letters round-trip", columnIndex("B") === 1 && columnIndex("AA") === 26 && columnLetter(1) === "B" && columnLetter(26) === "AA");

/* ---------- the real export, when it is on disk ---------- */
const realFile = (() => {
  if (process.env.PC_WORKBOOK && existsSync(process.env.PC_WORKBOOK)) return process.env.PC_WORKBOOK;
  const dir = join(here, "../data-sources/pitchbook");
  if (!existsSync(dir)) return null;
  for (const vintage of readdirSync(dir).sort().reverse()) {
    const files = readdirSync(join(dir, vintage)).filter((f) => /\.xlsx$/i.test(f));
    if (files.length) return join(dir, vintage, files[0]);
  }
  return null;
})();
console.log("\nthe real export");
if (!realFile) {
  console.log("  (no data-sources/pitchbook/<date>/*.xlsx on disk; the twenty-sheet checks are skipped)");
} else {
  console.log("  " + realFile);
  const bytes = readFileSync(realFile);
  const t0 = Date.now();
  const real = readWorkbook(bytes);
  const ms = Date.now() - t0;
  const data = real.sheets.filter((s) => s.kind === "data");
  const disclaimer = real.sheets.filter((s) => s.kind === "disclaimer");
  check("twenty sheets: nineteen framed data sheets and the Disclaimer", real.sheets.length === 20 && data.length === 19 && disclaimer.length === 1 && disclaimer[0].name === "Disclaimer" && disclaimer[0].rows.length === 0, real.sheets.length + " / " + data.length + " / " + disclaimer.length + " in " + ms + " ms");
  const TITLES = ["Fundraising Activity", "Average & Median Fund Size", "Fundraising by Category (%)", "Fundraising by Category (#)", "Fundraising by Location (%)", "Fundraising by Location (#)",
    "Fundraising by Size Bucket (%)", "Fundraising by Size Bucket (#)", "Average & Median Time To Close (months)", "Average & Median Time Between Funds (years)", "First-Time Commitments",
    "Newly Opened Funds", "Open Funds with Largest Target Sizes", "Open Funds by Category", "First-Time Fund Managers (Open Funds)", "Sources of Capital", "Recent Mandates",
    "Recently Added Terms & Fees", "Average & Median Fees"];
  check("the nineteen B4 titles, in workbook order", same(data.map((s) => s.frame.title), TITLES));
  const truncated = data.filter((s) => s.name.length === 31);
  check("four tabs are truncated to 31 characters and resolve to their full titles",
    same(truncated.map((s) => s.name), ["Average & Median Time To Close ", "Average & Median Time Between F", "Open Funds with Largest Target ", "First-Time Fund Managers (Open "])
    && truncated.every((s) => s.frame.title.length > 31 || /\(months\)|\(years\)|Sizes|Funds\)$/.test(s.frame.title)), truncated.map((s) => s.frame.title).join(" | "));
  check("header row 9 on all nineteen", data.every((s) => s.frame.headerRowNumber === 9));
  check("the filter line is identical and verbatim on all nineteen", data.every((s) => s.frame.filterLine === FILTER));
  check("currency USD and download date 2026-09-10 on all nineteen", data.every((s) => s.frame.currency === "USD" && s.frame.downloadedOn === "2026-09-10"));
  const st = checkStamp(real, basename(realFile));
  check("core.xml created 2026-09-10T17:03:44Z matches the file name's date part (the clock differs by twelve hours)", real.created === "2026-09-10T17:03:44Z" && st.agree && st.fileDate === "2026-09-10", JSON.stringify(st));
  const owner = licenseeOf(bytes);
  const servedReal = JSON.stringify(real);
  check("the licensee's name is read from H4 for this check only", typeof owner === "string" && owner.length > 0);
  check("the licensee's name reaches no served output", !servedReal.includes(owner));
  check("the licensee's name is in no fixture byte", !fixtureBytes.includes(Buffer.from(owner, "utf8")));
  check("\"Created for:\" withheld on all nineteen; no meta label in any served row", data.every((s) => same(s.frame.withheld, ["Created for:"])) && servedRowsClean(real));
  const realCensus = census(real);
  console.log("  suffix census of the nineteen data sheets: " + JSON.stringify(realCensus));
  check("money suffixes seen: Tn 18, B 209, M 44, and no other", realCensus["money:Tn"] === 18 && realCensus["money:B"] === 209 && realCensus["money:M"] === 44
    && Object.keys(realCensus).filter((k) => k.startsWith("money:")).length === 3, JSON.stringify(realCensus));
  check("no cell is left as text that looks numeric", real.sheets.every((s) => s.rows.every((r) => r.every((c) => c === null || parseCellValue(c).kind !== "text" || !/^[\s$€£(\-−]*[\d.,]+\s*(Tn|Bn|B|Mn|M|K|%)?\)?$/.test(c)))));
  const fx = sheetByTitle(real, "Average & Median Fees");
  check("Average & Median Fees row 19: 1.73%, 2.00%, 17.93%, 20.00%", same(fx.rows[9], ["2026", "1.73%", "2.00%", "17.93%", "20.00%"]) && fx.rowNumbers[9] === 19);
  const s2 = sheetByTitle(real, "Average & Median Fund Size");
  check("Average & Median Fund Size B10 $253.95M, C10 $45.3M", cellAt(s2, "B10") === "$253.95M" && cellAt(s2, "C10") === "$45.3M");
  /* the fixture is the export, sheet for sheet */
  for (const s of wb.sheets) {
    const r = real.sheets.find((x) => x.file === s.file);
    check("fixture " + JSON.stringify(s.name) + " reads identically to the export", !!r && same(r.rows, s.rows) && same(r.rowNumbers, s.rowNumbers) && same(r.frame, s.frame));
  }
  console.log("\n  frames (for the pipeline owner): tab | B4 title | header row 9 | data rows");
  for (const s of real.sheets) {
    if (!s.frame) { console.log("    " + JSON.stringify(s.name) + " | " + s.kind + " | no frame | 0 rows"); continue; }
    console.log("    " + JSON.stringify(s.name) + " | " + JSON.stringify(s.frame.title) + " | " + JSON.stringify(s.frame.headerRow) + " | " + s.rows.length + " rows " + s.frame.firstDataRow + "-" + s.frame.lastDataRow + " | chart filters " + JSON.stringify(s.frame.chartFilters));
  }
}

console.log(failed ? "\n" + failed + " failed" : "\nall workbook checks pass");
process.exit(failed ? 1 : 0);
