/**
 * test-pc-deck.mjs — the zip reader, the XML tree and the deck reader
 * against a cut of the August 2026 LCD Private Credit Monitor
 * (scripts/fixtures/pc/lcd-2026-08/august-2026-us-private-credit-monitor.cut.pptx,
 * built by build-cut.mjs in the same folder). The cut keeps six slides
 * by presentation position — the cover, slide 4 (chart1), slide 15
 * (chart11), slide 33 (chart27), slide 37 (chart30) and slide 40 (the
 * EMF deal table) — so cut position 2 is deck slide 4, and so on.
 *
 * Every figure below is read off the deck itself: the chart caches in
 * ppt/charts/chartN.xml, the slide shapes in ppt/slides/slideN.xml, the
 * EMF text records in ppt/media/image6.emf, docProps/core.xml. When the
 * full deck is present locally (data-sources/lcd/2026-09-10/, which is
 * not committed) the whole-deck counts are checked too; in CI that block
 * is skipped and says so.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readZip, writeZip, crc32 } from "./lib/zip-read.mjs";
import { parseXml, find, findAll, children, attr, textOf, paragraphs, decodeXml, readCoreProps, resolveTarget } from "./lib/ooxml.mjs";
import { readDeck, readChart, readEmfText, parseAsOf, parseGeography, sheetRefOf, MAX_POINTS } from "./lib/pptx-charts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CUT = join(here, "fixtures/pc/lcd-2026-08/august-2026-us-private-credit-monitor.cut.pptx");
const FULL = join(here, "../data-sources/lcd/2026-09-10/august-2026-us-private-credit-monitor.pptx");
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail !== undefined ? "  " + detail : ""));
  if (!ok) failed++;
};
const livePoints = (s) => s.points.filter((p) => p.val !== null).length;
const valAxOf = (chart, series) => chart.axes.find((a) => a.kind === "valAx" && series.axIds.includes(a.axId));
const byName = (chart, name) => chart.series.find((s) => s.name === name);
const near = (a, b) => Math.abs(a - b) < 1e-9;

/* ---------- zip-read ---------- */
console.log("zip-read");
const cutBytes = readFileSync(CUT);
const zip = readZip(cutBytes);
check("the cut has 27 entries", zip.entries.length === 27, String(zip.entries.length));
check("25 deflated, 2 stored (the EMF and [Content_Types].xml)",
  zip.entries.filter((e) => e.method === 8).length === 25 && zip.entries.filter((e) => e.method === 0).length === 2);
check("list() answers names in central-directory order", JSON.stringify(zip.list(/^ppt\/charts\/chart\d+\.xml$/)) ===
  JSON.stringify(["ppt/charts/chart1.xml", "ppt/charts/chart11.xml", "ppt/charts/chart27.xml", "ppt/charts/chart30.xml"]));
check("a deflated member inflates to its XML", zip.text("ppt/slides/slide1.xml").startsWith("<?xml"));
check("a stored member is sliced out whole", zip.read("ppt/media/image6.emf").length === 20312);
check("an absent member is null, not an error", zip.read("ppt/charts/chart2.xml") === null);
check("the stored EMF's CRC matches its central-directory entry", crc32(zip.read("ppt/media/image6.emf")) === zip.entries.find((e) => e.name === "ppt/media/image6.emf").crc);
{
  const round = readZip(writeZip([{ name: "a/b.xml", data: "<a>x</a>" }, { name: "c.bin", data: Buffer.from([1, 2, 3, 4]), deflate: true }]));
  check("writeZip round-trips a stored and a deflated member",
    round.entries.length === 2 && round.text("a/b.xml") === "<a>x</a>" && round.read("c.bin").equals(Buffer.from([1, 2, 3, 4])) && round.entries[1].method === 8);
  const z64 = writeZip([{ name: "x", data: "x" }]);
  z64.writeUInt32LE(0xffffffff, z64.length - 22 + 16); /* central-directory offset = the zip64 marker */
  let threw = null;
  try { readZip(z64); } catch (e) { threw = e.message; }
  check("a zip64 marker throws rather than misreading", /zip64/.test(threw || ""), threw);
}

/* ---------- ooxml ---------- */
console.log("ooxml");
{
  const t = parseXml('<?xml version="1.0"?><!-- c --><r:root xmlns:r="x"><a:p b="1" r:id="rId3"><a:t>one &amp; two</a:t><a:t><![CDATA[<3]]></a:t></a:p><c:pt idx="2" formatCode="0"/><c15:pt idx="9"/></r:root>');
  check("the root keeps prefix and local name", t.tag === "root" && t.prefix === "r");
  check("attributes are read whatever their order, and by local name", attr(find(t, "p"), "id") === "rId3" && attr(find(t, "p"), "r:id") === "rId3" && attr(find(t, "p"), "b") === "1");
  check("entities and CDATA decode", textOf(find(t, "p")) === "one & two<3");
  check("findAll walks by local name across prefixes", findAll(t, "pt").length === 2 && findAll(t, "pt")[1].prefix === "c15");
  check("children() is direct children only", children(t, "t").length === 0 && children(find(t, "p"), "t").length === 2);
  check("a self-closing tag with attributes", attr(find(t, "c:pt"), "formatCode") === "0");
  check("paragraphs join the runs", paragraphs(t)[0] === "one & two<3");
  check("decodeXml drops Excel's _x000D_ and reads numeric entities", decodeXml("a_x000D_&#8226;&#x2019;") === "a•’");
  let threw = null;
  try { parseXml("<a><b></a>"); } catch (e) { threw = e.message; }
  check("a mismatched close is an error, not a guess", /does not match/.test(threw || ""));
  check("resolveTarget walks ../ from the member's folder", resolveTarget("ppt/slides/slide4.xml", "../charts/chart1.xml") === "ppt/charts/chart1.xml");
}
const core = readCoreProps(zip);
check("docProps/core.xml: dcterms:modified 2026-09-08T22:04:10Z", core.modified === "2026-09-08T22:04:10Z", core.modified);
check("docProps/core.xml: dcterms:created 2024-07-09T16:54:58Z, title PowerPoint Presentation", core.created === "2024-07-09T16:54:58Z" && core.title === "PowerPoint Presentation");

/* ---------- the deck ---------- */
console.log("pptx-charts on the cut");
const deck = readDeck(cutBytes);
check("edition 2026-08 from the cover's \"August 2026\"", deck.edition === "2026-08", deck.edition);
check("title from the cover", deck.title === "Private Credit Monitor", deck.title);
check("publishedAt is dcterms:modified", deck.publishedAt === "2026-09-08T22:04:10Z");
check("six slides in presentation order", deck.slideCount === 6 &&
  deck.slides.map((s) => s.file).join(",") === "ppt/slides/slide1.xml,ppt/slides/slide4.xml,ppt/slides/slide15.xml,ppt/slides/slide33.xml,ppt/slides/slide37.xml,ppt/slides/slide40.xml");
check("four charts, keyed by part name", Object.keys(deck.charts).join(",") === "chart1,chart11,chart27,chart30");
check("every chart's externalData autoUpdate is 0", Object.values(deck.charts).every((c) => c.externalDataAutoUpdate === false));
check("4 of 4 headings recovered by geometry", Object.values(deck.charts).every((c) => c.heading));
check("the only warning is chart27's #REF! series", deck.warnings.length === 1 && deck.warnings[0].kind === "refError" && deck.warnings[0].chart === "chart27", JSON.stringify(deck.warnings));

/* slide 4 / chart1 */
const c1 = deck.charts.chart1;
check("chart1 sits on cut slide 2 (deck slide 4)", c1.slideIndex === 2 && deck.slides[1].charts[0] === "chart1");
check("slide 4 headline is the placeholder", deck.slides[1].headline === "Direct lending activity rebounds over the past three months but remains below Q1 levels");
check("slide 4 heading by geometry: Rectangle 31 ends at 2606040 EMU, above the frame top at 2743200",
  c1.heading === "Direct lending deal count and estimated volume (quarterly) ($B)" && c1.frame.y === 2743200, c1.heading);
check("slide 4 source line", c1.sourceLine === "Source: PitchBook | LCD  •  Geography: US  •  *As of Aug. 31, 2026");
check("slide 4 as-of 2026-08-31, geography US", c1.asOf === "2026-08-31" && c1.geography === "US");
check("slide 4 footnote is the text below the frame", c1.footnote === "Deal count is based on transactions covered by LCD News");
check("chart1 has no chart title", c1.title === null);
const count1 = byName(c1, "Count");
const vol1 = byName(c1, "Estimated volume");
check("chart1 Count: 27 points, none blank", count1 && count1.ptCount === 27 && count1.points.length === 27 && count1.blanks.length === 0);
check("chart1 Count 1Q20 = 112, 2Q26 = 172", count1.points[0].cat === "1Q20" && count1.points[0].val === 112 && count1.points[25].cat === "2Q26" && count1.points[25].val === 172);
check("chart1 Count \"Last 3 Months\" = 200, the formatCode attribute form",
  count1.points[26].cat === "Last 3 Months" && count1.points[26].val === 200 && count1.points[26].formatCode === "#,##0.00");
check("chart1 Estimated volume 2Q26 = 36.81443624, Last 3 Months = 48.598540240000005",
  near(vol1.points[25].val, 36.81443624) && near(vol1.points[26].val, 48.598540240000005));
check("chart1 valRef and sheetRef", count1.valRef === "'New Issue All Volume Q'!$L$2:$L$28" && count1.sheetRef === "New Issue All Volume Q");
check("chart1 series order follows c:order (volume 1 before count 2)", c1.series.map((s) => s.order).join(",") === "1,2");
check("the cut carries exactly one formatCode-attribute point (chart1 Count idx 26)",
  Object.values(deck.charts).reduce((n, c) => n + c.series.reduce((m, s) => m + s.points.filter((p) => p.formatCode).length, 0), 0) === 1);

/* series-to-axis: chart1 against chart30 */
const c30 = deck.charts.chart30;
const ax1count = valAxOf(c1, count1), ax1vol = valAxOf(c1, vol1);
check("chart1: Count (barChart) on the left General axis", count1.type === "barChart" && ax1count.axId === "123649024" && ax1count.numFmt === "General" && ax1count.position === "left");
check("chart1: Estimated volume (lineChart) on the right \"$\"#,##0 axis", vol1.type === "lineChart" && ax1vol.axId === "829221992" && ax1vol.numFmt === '"$"#,##0' && ax1vol.position === "right");
const vol30 = byName(c30, "Volume ($B)"), count30 = byName(c30, "Count");
const ax30vol = valAxOf(c30, vol30), ax30count = valAxOf(c30, count30);
check("chart30 heading", c30.heading === "US private credit/middle market CLO issuance ($B)", c30.heading);
check("chart30: Volume ($B) (barChart) on the left \"$\"0 axis", vol30.type === "barChart" && ax30vol.axId === "123649024" && ax30vol.numFmt === '"$"0' && ax30vol.position === "left");
check("chart30: Count (lineChart) on the right General axis", count30.type === "lineChart" && ax30count.axId === "829221992" && ax30count.numFmt === "General" && ax30count.position === "right");
check("chart30's axes are chart1's reversed: same axIds, the formats swapped",
  ax30vol.axId === ax1count.axId && ax30count.axId === ax1vol.axId && ax30vol.numFmt !== ax1count.numFmt && ax30count.numFmt === ax1count.numFmt);
check("chart30 2Q21 = 3.43466 / 7, Last 3 Months = 9.75778 / 20", vol30.points[0].cat === "2Q21" && near(vol30.points[0].val, 3.4346600000000005) && count30.points[0].val === 7 &&
  vol30.points[21].cat === "Last 3 Months" && near(vol30.points[21].val, 9.757779999999999) && count30.points[21].val === 20);

/* slide 15 / chart11 */
const c11 = deck.charts.chart11;
check("chart11 heading", c11.heading === "Spread of LBOs financed in BSL (all borrowers) vs direct lending market", c11.heading);
check("slide 15 headline", deck.slides[2].headline === "The BSL–direct lending spread differential narrows to 147 bps YTD");
check("chart11 has no chart title; the axis carries \"Spread (bps) over base rate\"",
  c11.title === null && c11.axes.find((a) => a.axId === "1481874495").title === "Spread (bps) over base rate");
const diff11 = byName(c11, "Difference (right axis)");
check("chart11 Difference on the right #,##0 axis", valAxOf(c11, diff11).axId === "1569580223" && valAxOf(c11, diff11).numFmt === "#,##0" && valAxOf(c11, diff11).position === "right");
check("chart11 reads its own cache: 2019 = 127.08226401179945 .. YTD August 2026 = 147.37849367461018",
  diff11.points.length === 8 && diff11.points[0].cat === "2019" && near(diff11.points[0].val, 127.08226401179945) &&
  diff11.points[7].cat === "YTD August 2026" && near(diff11.points[7].val, 147.37849367461018));
check("chart11 BSL spread and direct lending spread, YTD August 2026", near(byName(c11, "BSL spread").points[7].val, 337.8787878787879) && near(byName(c11, "Direct lending spread").points[7].val, 485.25728155339806));
check("chart11 sheetRef is the re-pointed sheet 'LBO Spreads formatted (2)'", c11.series.every((s) => s.sheetRef === "LBO Spreads formatted (2)"));

/* slide 33 / chart27 */
const c27 = deck.charts.chart27;
check("slide 33: the headline placeholder has no box (inherited), heading still found in Rectangle 5",
  deck.slides[3].shapes[0].placeholder && deck.slides[3].shapes[0].box === null && c27.heading === "Cost-weighted average all-in interest rate (%)");
check("slide 33 headline", deck.slides[3].headline === "BDC-held loan yields fall to 8.3%, the lowest in four years");
check("slide 33 source line is TextBox 1, as-of 2026-06-30 from \"Data through\"",
  c27.sourceLine === "Source: PitchBook | LCD; Data through June 30, 2026 | Reflects senior secured, unsecured & subordinated debt holdings" && c27.asOf === "2026-06-30");
const rate = byName(c27, "Debt - Wtd Avg Rate");
check("chart27: one live series of 32 points, Q3 2018 .. Q2 2026 = 8.303138989",
  c27.series.length === 1 && rate.points.length === 32 && rate.points[0].cat === "Q3 2018" && rate.points[31].cat === "Q2 2026" && near(rate.points[31].val, 8.303138989));
check("chart27: the literal-percent formats (cache 0.00\"%\", axis 0\"%\")", rate.numFmt === '0.00"%"' && valAxOf(c27, rate).numFmt === '0"%"');
check("chart27: the #REF! series is reported, not read as data",
  c27.droppedSeries.length === 1 && c27.droppedSeries[0].name === "#REF!" && c27.droppedSeries[0].valRef === "'All-in yield'!#REF!" &&
  c27.droppedSeries[0].reason === "refError" && livePoints(c27.droppedSeries[0]) === 1 && c27.droppedSeries[0].points[0].val === 1);

/* slide 40: the EMF table */
const s40 = deck.slides[5];
check("slide 40 headline", s40.headline === "Borrowers refinancing direct lending deals in the BSL market continue to find favorable spreads…");
check("slide 40 has no chart and one EMF picture", s40.charts.length === 0 && s40.emfTables.length === 1 && s40.emfTables[0].picture === "ppt/media/image6.emf");
const t40 = s40.emfTables[0];
check("image6.emf: 60 EMR_EXTTEXTOUTW strings", t40.strings === 60, String(t40.strings));
check("image6.emf: header row of five columns", JSON.stringify(t40.header) === JSON.stringify(["Company", "PE sponsor", "Borrower rating", "Date", "Debt being refinanced"]), JSON.stringify(t40.header));
check("image6.emf: ten deal rows, eleven lines", t40.rows.length === 10 && t40.lines.length === 11);
check("image6.emf: first row, wrapped cell joined", JSON.stringify(t40.rows[0]) ===
  JSON.stringify(["Accuris", "Kohlberg, Kravis & Roberts", "B/B2", "Aug 2026", "Refinance the company’s existing private debt and to fund a shareholder distribution."]), JSON.stringify(t40.rows[0]));
check("image6.emf: last row", t40.rows[9][0] === "Harrington Industrial Plastics" && t40.rows[9][3] === "Jun 2026");
check("image6.emf: a line is the row's cells joined", t40.lines[3] === "Catalent | Novo Holdings | B+/B1 | Jul 2026 | Proceeds refinance a $4.123 billion private credit loan due 2031", t40.lines[3]);

/* totals on the cut */
{
  let live = 0, slots = 0, blanks = 0, dropped = 0;
  for (const c of Object.values(deck.charts)) {
    for (const s of c.series) { live += livePoints(s); slots += s.points.length; blanks += s.blanks.length; }
    for (const s of c.droppedSeries) { dropped += livePoints(s); slots += s.points.length; }
  }
  check("the cut: 154 live points + 1 in the #REF! series = 155 points in 155 slots, no blanks", live === 154 && dropped === 1 && slots === 155 && blanks === 0, live + "/" + dropped + "/" + slots);
}

/* ---------- readChart on the sparse form ---------- */
console.log("readChart, sparse and filtered series");
{
  /* the shape of chart5's Refinancing series (deck slide 8): idx 0 = 4, idx 2 = 1, no idx 1 (2Q20 is blank in the cache) */
  const xml = '<c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/>' +
    '<c:ser><c:idx val="1"/><c:order val="1"/><c:tx><c:strRef><c:f>x!$K$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Refinancing</c:v></c:pt></c:strCache></c:strRef></c:tx>' +
    '<c:cat><c:strRef><c:f>x!$I$2:$I$4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>1Q20</c:v></c:pt><c:pt idx="1"><c:v>2Q20</c:v></c:pt><c:pt idx="2"><c:v>3Q20</c:v></c:pt></c:strCache></c:strRef></c:cat>' +
    '<c:val><c:numRef><c:f>\'Count of PE-backed DL\'!$K$2:$K$4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0" formatCode="0"><c:v>4</c:v></c:pt><c:pt idx="2" formatCode="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>' +
    '<c:axId val="1"/><c:axId val="2"/><c:extLst><c:ext uri="u"><c15:filteredBarSeries xmlns:c15="c15"><c15:ser><c:idx val="0"/><c:order val="0"/><c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>99</c:v></c:pt></c:numCache></c:numRef></c:val></c15:ser></c15:filteredBarSeries></c:ext></c:extLst></c:barChart>' +
    '<c:catAx><c:axId val="1"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/></c:catAx><c:valAx><c:axId val="2"/><c:axPos val="l"/><c:numFmt formatCode="0" sourceLinked="0"/></c:valAx></c:plotArea></c:chart>' +
    '<c:externalData r:id="rId1" xmlns:r="r"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>';
  const c = readChart(xml);
  const s = c.series[0];
  check("a missing idx is a null slot, never a positional shift", s.points.length === 3 && s.points[1].cat === "2Q20" && s.points[1].val === null && s.points[2].cat === "3Q20" && s.points[2].val === 1);
  check("the blank is listed", JSON.stringify(s.blanks) === "[1]");
  check("the formatCode attribute is carried", s.points[0].formatCode === "0" && s.points[0].val === 4);
  check("a filtered c15:ser is not a live series", c.series.length === 1 && c.droppedSeries.length === 0);
  check("the sheet name comes off the quoted reference", s.sheetRef === "Count of PE-backed DL" && sheetRefOf("Sheet1!$L$2:$L$11") === "Sheet1");
  check("autoUpdate 0 reads as false", c.externalDataAutoUpdate === false);
  check("axis ids of the group ride on the series", s.axIds.join(",") === "1,2");
  /* the same part with the value cache claiming five million slots: a
     malformed ptCount must not be allocated */
  const absurd = xml.replace('<c:formatCode>General</c:formatCode><c:ptCount val="3"/>', '<c:formatCode>General</c:formatCode><c:ptCount val="5000000"/>');
  const t0 = Date.now();
  const ca = readChart(absurd);
  const ms = Date.now() - t0;
  check("a ptCount above MAX_POINTS (" + MAX_POINTS + ") drops the series as ptCountAbsurd with the count and the two cached values named, in well under a second",
    ca.series.length === 0 && ca.droppedSeries.length === 1 && ca.droppedSeries[0].reason === "ptCountAbsurd" && ca.droppedSeries[0].ptCount === 5000000 && ca.droppedSeries[0].cachedPoints === 2 && ca.droppedSeries[0].points.length === 0 && ms < 1000, JSON.stringify([ca.droppedSeries.map((d) => d.reason), ms]));
  const noCount = xml.replace('<c:formatCode>General</c:formatCode><c:ptCount val="3"/>', '<c:formatCode>General</c:formatCode>').replace('<c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>1Q20', '<c:strCache><c:pt idx="0"><c:v>1Q20').replace('<c:pt idx="2" formatCode="0"><c:v>1</c:v></c:pt>', '<c:pt idx="4000000000" formatCode="0"><c:v>1</c:v></c:pt>');
  const cn = readChart(noCount);
  check("without any ptCount the largest c:pt idx sets the slot count, and an absurd idx is dropped the same way", cn.series.length === 0 && cn.droppedSeries.length === 1 && cn.droppedSeries[0].reason === "ptCountAbsurd" && cn.droppedSeries[0].ptCount === 4000000001, JSON.stringify(cn.droppedSeries.map((d) => [d.reason, d.ptCount])));
}

/* ---------- dates in prose ---------- */
console.log("parseAsOf");
check("As of Aug. 31, 2026 (slides 4 to 24)", parseAsOf("Source: PitchBook | LCD  •  Geography: US  •  *As of Aug. 31, 2026") === "2026-08-31");
check("the slide-10 typo As of Aug, 31, 2026", parseAsOf("*As of Aug, 31, 2026") === "2026-08-31");
check("Data through June 30, 2026 (slides 25, 31 to 33)", parseAsOf("Source: PitchBook | LCD; Data through June 30, 2026 | Excludes equity, CMBS and CLO holdings") === "2026-06-30");
check("As of Dec. 31, 2025 (slide 35)", parseAsOf("Source: PitchBook  •  Geography: US  •  *As of Dec. 31, 2025") === "2025-12-31");
check("no date is null, never a guess", parseAsOf("Source: PitchBook | LCD") === null && parseAsOf(null) === null);
check("geography from the source line, and chart20's drawing", parseGeography("Source: PitchBook | LCD  •  Geography: US  •  *As of Aug. 31, 2026") === "US" &&
  parseGeography("Source: PitchBook | LCD • Data through June 30, 2026 • Based on count of LBOs in US and Europe.") === "US and Europe" && parseGeography("Source: PitchBook | LCD") === null);

/* ---------- the whole deck, when it is on this machine ---------- */
if (existsSync(FULL)) {
  console.log("the full August 2026 deck (local only)");
  const fullBytes = readFileSync(FULL);
  const fz = readZip(fullBytes);
  check("392 entries: 355 deflated, 37 stored", fz.entries.length === 392 && fz.entries.filter((e) => e.method === 8).length === 355 && fz.entries.filter((e) => e.method === 0).length === 37);
  check("the 37 stored are 31 embedded workbooks, 5 PNGs and the thumbnail",
    fz.entries.filter((e) => e.method === 0 && /^ppt\/embeddings\/.*\.xlsx$/.test(e.name)).length === 31 &&
    fz.entries.filter((e) => e.method === 0 && /^ppt\/media\/image\d+\.png$/.test(e.name)).length === 5 &&
    fz.entries.some((e) => e.method === 0 && e.name === "docProps/thumbnail.jpeg"));
  const full = readDeck(fullBytes);
  const charts = Object.values(full.charts);
  check("43 slides, 31 charts on slides 4 to 39", full.slideCount === 43 && charts.length === 31 && full.charts.chart1.slideIndex === 4 && full.charts.chart31.slideIndex === 39);
  check("edition 2026-08, published 2026-09-08", full.edition === "2026-08" && full.publishedAt === "2026-09-08T22:04:10Z");
  check("31 of 31 externalData autoUpdate 0", charts.every((c) => c.externalDataAutoUpdate === false));
  check("31 of 31 headings recovered by geometry", charts.every((c) => c.heading));
  check("31 of 31 source lines, three from the chart drawing (chart20, chart25, chart26)",
    charts.every((c) => c.sourceLine) && charts.filter((c) => c.sourceLineFromDrawing).map((c) => c.id).join(",") === "chart20,chart25,chart26");
  check("31 of 31 as-of dates parse", charts.every((c) => c.asOf));
  const fmt = charts.reduce((n, c) => n + c.series.reduce((m, s) => m + s.points.filter((p) => p.formatCode).length, 0), 0);
  const fmtBy = Object.fromEntries(charts.filter((c) => c.series.some((s) => s.points.some((p) => p.formatCode))).map((c) => [c.id, c.series.reduce((m, s) => m + s.points.filter((p) => p.formatCode).length, 0)]));
  check("74 formatCode-attribute points: chart1 1, chart3 11, chart5 56, chart6 6", fmt === 74 && JSON.stringify(fmtBy) === '{"chart1":1,"chart3":11,"chart5":56,"chart6":6}', JSON.stringify(fmtBy));
  let live = 0, slots = 0, dropped = 0;
  const blanks = [];
  for (const c of charts) {
    for (const s of c.series) { live += livePoints(s); slots += s.points.length; for (const b of s.blanks) blanks.push(c.id + " " + s.name + " " + s.points[b].cat); }
    for (const s of c.droppedSeries) { dropped += livePoints(s); slots += s.points.length; }
  }
  check("1,210 cached points in all: 1,209 live plus the #REF! point, in 1,211 slots", live + dropped === 1210 && dropped === 1 && slots === 1211, live + "+" + dropped + " / " + slots);
  check("the one blank is chart5 Refinancing at 2Q20", blanks.join(";") === "chart5 Refinancing 2Q20", blanks.join(";"));
  const f11 = full.charts.chart11, f12 = full.charts.chart12;
  check("chart11 and chart12 share heading, series and sheetRef", f11.heading === f12.heading && f11.series.map((s) => s.name).join() === f12.series.map((s) => s.name).join() && f11.series[0].sheetRef === f12.series[0].sheetRef);
  check("chart12 reads its own cache: 4Q24 .. Last 3 Months = 161.7892976588629",
    f12.series[0].points[0].cat === "4Q24" && f12.series[0].points[7].cat === "Last 3 Months" && near(f12.series[0].points[7].val, 161.7892976588629));
  const f25 = full.charts.chart25, f26 = full.charts.chart26;
  check("chart25 and chart26 share series and sheetRef and differ on the axis format (0% vs \"$\"#,##0)",
    f25.series[0].sheetRef === f26.series[0].sheetRef && valAxOf(f25, f25.series[0]).numFmt === "0%" && valAxOf(f26, f26.series[0]).numFmt === '"$"#,##0' &&
    near(byName(f25, "As of June 30, 2026").points[0].val, 0.013084810619104497) && near(byName(f25, "As of March 31, 2026").points[0].val, 0.01950316632734697));
  check("chart28 2025: dry powder 169.6, NAV 295.7", near(byName(full.charts.chart28, "Dry powder ($B)").points[19].val, 169.6) && near(byName(full.charts.chart28, "NAV ($B)").points[19].val, 295.7));
  check("chart10's Difference YTD August 2026 = 118.59061488673137", near(full.charts.chart10.series[0].points[6].val, 118.59061488673137));
  check("slide 10's typo parses to 2026-08-31", full.charts.chart7.asOf === "2026-08-31" && /Aug, 31, 2026/.test(full.charts.chart7.sourceLine));
  check("chart20's drawing carries the source line, US and Europe, through June 30 2026", full.charts.chart20.geography === "US and Europe" && full.charts.chart20.asOf === "2026-06-30");
  check("charts 13 to 15 take their footnote from the drawing", ["chart13", "chart14", "chart15"].every((id) => /privately sourced values/.test(full.charts[id].footnote)));
  check("slide 39's footnote is the restatement warning", /Historical data is subject to revisions/.test(full.charts.chart31.footnote));
  const s40f = full.slides[39], s41f = full.slides[40];
  check("slides 40 and 41: image6.emf 60 strings, image7.emf 71 non-blank of 91 strings, ten rows each",
    s40f.emfTables[0].strings === 60 && s41f.emfTables[0].strings === 71 && s40f.emfTables[0].rows.length === 10 && s41f.emfTables[0].rows.length === 10);
  check("image7.emf header and second row", s41f.emfTables[0].header.join("|") === "Company name|Date|Debt amount ($M)|Current sponsor|Last BSL deal date|Lender(s)" &&
    s41f.emfTables[0].rows[1][0] === "Clearwater Analytics Holdings Inc" && s41f.emfTables[0].rows[1][2] === "3,525");
  check("the raw EMF reader agrees", readEmfText(fz.read("ppt/media/image7.emf")).strings.length === 71);
  check("the only warnings are the chart5 blank and the chart27 #REF!", full.warnings.map((w) => w.chart + ":" + w.kind).join(",") === "chart5:blankPoints,chart27:refError", JSON.stringify(full.warnings));
} else {
  console.log("  skip  the full deck is not on this machine (data-sources/lcd/2026-09-10/); cut-only run");
}

console.log(failed ? "\n" + failed + " failed" : "\nall pc-deck checks pass");
process.exit(failed ? 1 : 0);
