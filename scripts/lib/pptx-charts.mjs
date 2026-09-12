/**
 * pptx-charts.mjs — reads an LCD monitor deck into slides, charts and
 * the numbers the charts were drawn from.
 *
 *   readDeck(buffer) → { edition, publishedAt, title, slides, charts, warnings }
 *
 * What the deck is, as bytes. Every chart is a ppt/charts/chartN.xml part
 * whose <c:numCache> holds the values PowerPoint last drew, and every one
 * of the 31 carries <c:externalData><c:autoUpdate val="0"/>, so the cache
 * is exactly what the reader of the PDF saw; the embedded workbooks are
 * not opened. The rules that came out of reading the August 2026 edition
 * point by point:
 *
 *   - points are read by the <c:pt idx="N"> attribute, never by position:
 *     chart5's Refinancing series has no idx 1 (2Q20 is a true blank) and
 *     a positional read would shift every later quarter by one;
 *   - the attribute form <c:pt idx="26" formatCode="#,##0.00"> is a
 *     point like any other (74 of them in the live series here — chart1
 *     one, chart3 eleven, chart5 fifty-six, chart6 six — chart1's "Last 3
 *     Months" count of 200 among them);
 *   - a series belongs to the value axis named by its chart-type group's
 *     <c:axId> pair, not to "the" value axis: chart1 puts Count on the
 *     General axis and volume on "$"#,##0, chart30 the reverse;
 *   - the chart title is the <c:title> that is a direct child of <c:chart>;
 *     chart10 to chart12 have only an axis title ("Spread (bps) over base
 *     rate") and no chart title;
 *   - a series named #REF! (chart27, a broken workbook reference with one
 *     cached value) is set aside and reported, never read as data;
 *   - PowerPoint keeps filtered-out series as c15:ser copies inside an
 *     extension list; only the c:ser children of the chart-type group
 *     are live.
 *
 * Text on the slide is assigned a role by where it sits, never by the
 * shape's name ("Rectangle 31" on one slide is "Rectangle 5" on another):
 * the headline is the placeholder; the source line is the text that
 * starts "Source", on the slide or, for chart20, chart25 and chart26, in
 * the chart's own drawing part; the heading is the nearest text block
 * whose bottom edge sits at or above the chart frame's top; a footnote is
 * a text block below the frame's bottom. The two deal tables on slides 40
 * and 41 are EMF pictures; their text is in EMR_EXTTEXTOUTW records and
 * is read from there.
 */
import { readZip } from "./zip-read.mjs";
import { parseXml, find, findAll, children, attr, textOf, paragraphs, readRels, resolveTarget, readCoreProps } from "./ooxml.mjs";

/* ---------- dates in prose ---------- */
const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const pad2 = (n) => String(n).padStart(2, "0");

/**
 * parseAsOf(text) → "YYYY-MM-DD" | null
 * Reads "As of Aug. 31, 2026", the slide-10 typo "As of Aug, 31, 2026",
 * "Data through June 30, 2026" and "As of Dec. 31, 2025". Anything else
 * is null: a point that needs an as-of date is refused, never guessed.
 */
export function parseAsOf(text) {
  if (!text) return null;
  const m = /(?:As of|Data through)\s+([A-Za-z]+)[.,]?\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  const day = Number(m[2]);
  if (!month || day < 1 || day > 31) return null;
  return m[3] + "-" + pad2(month) + "-" + pad2(day);
}

/** parseGeography(text) → the "Geography: US" value, "US and Europe" from chart20's drawing, else null */
export function parseGeography(text) {
  if (!text) return null;
  const m = /Geography:\s*([^•|*]+)/.exec(text);
  if (m) return m[1].trim();
  if (/\bin US and Europe\b/.test(text)) return "US and Europe";
  return null;
}

/** "August 2026" → "2026-08"; null when the cover carries no month line */
function editionOf(lines) {
  for (const line of lines) {
    const m = /^([A-Za-z]+)\s+(\d{4})$/.exec(line.trim());
    if (m && MONTHS[m[1].toLowerCase()]) return m[2] + "-" + pad2(MONTHS[m[1].toLowerCase()]);
  }
  return null;
}

/* ---------- slide geometry ---------- */
/* An <a:xfrm> is an offset and an extent in EMUs. Shapes inside a group
   are in the group's child space and are mapped through the group's
   transform; a placeholder that inherits its box from the layout has no
   xfrm and gets a null box, which every role test tolerates. */
function boxOf(xfrm, map) {
  if (!xfrm) return null;
  const off = find(xfrm, "off");
  const ext = find(xfrm, "ext");
  if (!off || !ext) return null;
  let b = { x: Number(attr(off, "x")), y: Number(attr(off, "y")), cx: Number(attr(ext, "cx")), cy: Number(attr(ext, "cy")) };
  if (map) b = map(b);
  return b;
}

function groupMap(grpSpPr, outer) {
  const xfrm = find(grpSpPr, "xfrm");
  const inner = boxOf(xfrm, outer);
  const chOff = find(xfrm, "chOff");
  const chExt = find(xfrm, "chExt");
  if (!inner || !chOff || !chExt) return outer;
  const ox = Number(attr(chOff, "x")), oy = Number(attr(chOff, "y"));
  const ex = Number(attr(chExt, "cx")) || inner.cx, ey = Number(attr(chExt, "cy")) || inner.cy;
  const sx = ex ? inner.cx / ex : 1, sy = ey ? inner.cy / ey : 1;
  return (b) => ({ x: inner.x + (b.x - ox) * sx, y: inner.y + (b.y - oy) * sy, cx: b.cx * sx, cy: b.cy * sy });
}

function collectShapes(tree, map, out) {
  for (const el of tree.children) {
    if (el.tag === "grpSp") {
      collectShapes(el, groupMap(find(el, "grpSpPr"), map), out);
    } else if (el.tag === "sp" || el.tag === "graphicFrame" || el.tag === "pic") {
      out.push({ el, map });
    }
  }
}

function placeholderOf(el) {
  const ph = find(find(el, "nvPr"), "ph");
  if (!ph) return null;
  return { type: attr(ph, "type") || "body", idx: attr(ph, "idx") };
}

function readSlideShapes(root) {
  const spTree = find(root, "spTree");
  const raw = [];
  collectShapes(spTree, null, raw);
  const shapes = [];
  const frames = [];
  const pictures = [];
  const tables = [];
  for (const { el, map } of raw) {
    const name = attr(find(el, "cNvPr"), "name") || "";
    if (el.tag === "sp") {
      const lines = paragraphs(find(el, "txBody")).map((t) => t.trim()).filter(Boolean);
      shapes.push({
        name,
        placeholder: placeholderOf(el),
        text: lines.join(" "),
        lines,
        box: boxOf(find(find(el, "spPr"), "xfrm"), map),
      });
    } else if (el.tag === "graphicFrame") {
      const box = boxOf(children(el, "xfrm")[0], map);
      const chart = find(el, "chart");
      if (chart && chart.prefix === "c") frames.push({ name, rId: attr(chart, "id"), box });
      const tbl = find(el, "tbl");
      if (tbl) {
        tables.push({
          name, box,
          rows: children(tbl, "tr").map((tr) => children(tr, "tc").map((tc) => paragraphs(tc).join(" ").trim())),
        });
      }
    } else if (el.tag === "pic") {
      const blip = find(el, "blip");
      pictures.push({ name, rId: attr(blip, "embed"), box: boxOf(find(find(el, "spPr"), "xfrm"), map) });
    }
  }
  return { shapes, frames, pictures, tables };
}

/* ---------- roles by geometry ---------- */
const SOURCE_RE = /^Source\b/i;
const NOT_HEADLINE = new Set(["sldNum", "ftr", "dt", "chart", "pic", "tbl", "media", "dgm", "clipArt"]);

function headlineOf(shapes) {
  const ph = shapes.filter((s) => s.placeholder && s.text && !NOT_HEADLINE.has(s.placeholder.type));
  const title = ph.find((s) => s.placeholder.type === "title" || s.placeholder.type === "ctrTitle");
  return (title || ph[0] || { text: null }).text;
}

/**
 * rolesFor(shapes, frame, multi) → { heading, sourceLine, footnote }
 * Text blocks are the non-placeholder shapes with text. With more than
 * one chart on a slide the heading and footnote must also overlap the
 * frame horizontally.
 */
export function rolesFor(shapes, frame, multi = false) {
  const blocks = shapes.filter((s) => !s.placeholder && s.text);
  const source = blocks.find((b) => SOURCE_RE.test(b.text));
  const boxed = blocks.filter((b) => b !== source && b.box);
  const overlaps = (b) => !multi || !frame || (b.box.x < frame.x + frame.cx && b.box.x + b.box.cx > frame.x);
  let heading = null, footnote = null;
  if (frame) {
    const tol = Math.max(91440, Math.round(frame.cy * 0.02)); /* 0.1 inch, or 2% of the frame */
    const above = boxed.filter((b) => overlaps(b) && b.box.y + b.box.cy <= frame.y + tol)
      .sort((a, b) => (b.box.y + b.box.cy) - (a.box.y + a.box.cy) || Math.abs(a.box.x - frame.x) - Math.abs(b.box.x - frame.x));
    heading = above.length ? above[0].text : null;
    const below = boxed.filter((b) => overlaps(b) && b.box.y >= frame.y + frame.cy - tol)
      .sort((a, b) => a.box.y - b.box.y);
    footnote = below.length ? below.map((b) => b.text).join(" ") : null;
  }
  return { heading, sourceLine: source ? source.text : null, footnote };
}

/* ---------- chart caches ---------- */
function refOf(el) {
  const f = find(el, "f");
  return f ? textOf(f) : null;
}

/** 'New Issue All Volume Q'!$L$2:$L$28 → "New Issue All Volume Q" (quotes off, trailing space kept) */
export function sheetRefOf(ref) {
  if (!ref) return null;
  const bang = ref.lastIndexOf("!");
  if (bang === -1) return null;
  let sheet = ref.slice(0, bang);
  if (sheet.startsWith("'") && sheet.endsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'");
  return sheet;
}

/** the cached points of a <c:cat>, <c:val>, <c:xVal> or <c:yVal>: idx → { v, formatCode } */
function readCache(el) {
  const out = { ref: refOf(el), formatCode: null, ptCount: null, pts: new Map(), multiLevel: false };
  if (!el) return out;
  const multi = find(el, "multiLvlStrRef");
  if (multi) {
    out.multiLevel = true;
    const levels = findAll(multi, "lvl");
    for (const lvl of levels) {
      for (const pt of children(lvl, "pt")) {
        const idx = Number(attr(pt, "idx"));
        const v = textOf(find(pt, "v"));
        const prev = out.pts.get(idx);
        out.pts.set(idx, { v: prev ? prev.v + " / " + v : v, formatCode: null });
      }
    }
    const pc = find(multi, "ptCount");
    out.ptCount = pc ? Number(attr(pc, "val")) : null;
    return out;
  }
  const cache = find(el, "numCache") || find(el, "strCache") || find(el, "numLit") || find(el, "strLit");
  if (!cache) return out;
  const fc = children(cache, "formatCode")[0];
  out.formatCode = fc ? textOf(fc) : null;
  const pc = children(cache, "ptCount")[0];
  out.ptCount = pc ? Number(attr(pc, "val")) : null;
  for (const pt of children(cache, "pt")) {
    out.pts.set(Number(attr(pt, "idx")), { v: textOf(find(pt, "v")), formatCode: attr(pt, "formatCode") });
  }
  return out;
}

function seriesName(ser) {
  const tx = children(ser, "tx")[0];
  if (!tx) return null;
  const v = find(tx, "v");
  if (v) return textOf(v);
  const rich = paragraphs(tx).join(" ").trim();
  return rich || null;
}

/* the most cache slots one series is allowed: the deck's longest series
   is 32 quarters, a decade of daily prices would be about 2,600, so a
   ptCount (or a c:pt idx) beyond this is a malformed part and the series
   is dropped with the reason rather than allocated */
export const MAX_POINTS = 100000;

const CHART_TYPES = new Set(["barChart", "bar3DChart", "lineChart", "line3DChart", "areaChart", "area3DChart",
  "pieChart", "pie3DChart", "doughnutChart", "ofPieChart", "scatterChart", "bubbleChart", "radarChart", "stockChart", "surfaceChart", "surface3DChart"]);
const AXIS_TYPES = new Set(["catAx", "valAx", "dateAx", "serAx"]);
const AX_POSITION = { l: "left", r: "right", b: "bottom", t: "top" };

/**
 * readChart(xml, drawingXml) → one chart. drawingXml is the chart's
 * userShapes part when it has one; its paragraphs carry the source line
 * or a footnote the slide itself does not repeat.
 */
export function readChart(xml, drawingXml = null) {
  const root = parseXml(xml);
  const chartEl = children(root, "chart")[0] || find(root, "chart");
  const plotArea = find(chartEl, "plotArea");
  const titleEl = children(chartEl, "title")[0];
  const external = find(root, "externalData");
  const autoUpdate = external ? find(external, "autoUpdate") : null;
  const out = {
    title: titleEl ? paragraphs(titleEl).join(" ").trim() || null : null,
    chartTypes: [],
    axes: [],
    series: [],
    droppedSeries: [],
    externalDataAutoUpdate: autoUpdate ? attr(autoUpdate, "val") !== "0" : (external ? true : null),
    drawingText: drawingXml ? paragraphs(parseXml(drawingXml)).map((t) => t.trim()).filter(Boolean) : [],
  };
  for (const el of plotArea.children) {
    if (AXIS_TYPES.has(el.tag)) {
      const numFmt = children(el, "numFmt")[0];
      const del = children(el, "delete")[0];
      const pos = children(el, "axPos")[0];
      const scaling = children(el, "scaling")[0];
      const min = scaling ? children(scaling, "min")[0] : null;
      const max = scaling ? children(scaling, "max")[0] : null;
      const title = children(el, "title")[0];
      out.axes.push({
        axId: attr(children(el, "axId")[0], "val"),
        kind: el.tag,
        numFmt: numFmt ? attr(numFmt, "formatCode") : null,
        position: pos ? (AX_POSITION[attr(pos, "val")] || attr(pos, "val")) : null,
        deleted: del ? attr(del, "val") === "1" : false,
        title: title ? paragraphs(title).join(" ").trim() || null : null,
        min: min ? Number(attr(min, "val")) : null,
        max: max ? Number(attr(max, "val")) : null,
      });
    } else if (CHART_TYPES.has(el.tag)) {
      const barDir = children(el, "barDir")[0];
      const grouping = children(el, "grouping")[0];
      const axIds = children(el, "axId").map((a) => attr(a, "val"));
      out.chartTypes.push({ type: el.tag, barDir: barDir ? attr(barDir, "val") : null, grouping: grouping ? attr(grouping, "val") : null, axIds });
      /* only the direct c:ser children are live; c15:ser copies of
         filtered series sit inside an extLst and are not drawn */
      for (const ser of el.children) {
        if (ser.tag !== "ser" || ser.prefix !== "c") continue;
        const name = seriesName(ser);
        const cat = readCache(children(ser, "cat")[0] || children(ser, "xVal")[0]);
        const val = readCache(children(ser, "val")[0] || children(ser, "yVal")[0]);
        const s = {
          order: Number(attr(children(ser, "order")[0], "val")),
          idx: Number(attr(children(ser, "idx")[0], "val")),
          name,
          type: el.tag,
          valRef: val.ref,
          catRef: cat.ref,
          sheetRef: sheetRefOf(val.ref) || sheetRefOf(cat.ref),
          axIds,
          numFmt: val.formatCode,
          catNumFmt: cat.formatCode,
          ptCount: val.ptCount !== null ? val.ptCount : cat.ptCount,
          points: [],
          blanks: [],
        };
        const n = s.ptCount !== null ? s.ptCount : Math.max(-1, ...val.pts.keys(), ...cat.pts.keys()) + 1;
        if (!Number.isFinite(n) || n > MAX_POINTS) {
          out.droppedSeries.push({ ...s, reason: "ptCountAbsurd", ptCount: n, cachedPoints: val.pts.size });
          continue;
        }
        for (let i = 0; i < n; i++) {
          const c = cat.pts.get(i);
          const v = val.pts.get(i);
          let value = null;
          if (v) {
            /* caches carry doubles as written by Excel, "1.9503166327346971E-2"
               included, so Number() and never a decimal pattern */
            const num = Number(v.v);
            value = v.v.trim() === "" ? null : (Number.isFinite(num) ? num : v.v);
          }
          if (!v) s.blanks.push(i);
          s.points.push({ idx: i, cat: c ? c.v : null, val: value, formatCode: v ? v.formatCode : null });
        }
        if (name === "#REF!" || (val.ref && val.ref.indexOf("#REF!") !== -1)) {
          out.droppedSeries.push({ ...s, reason: "refError" });
        } else {
          out.series.push(s);
        }
      }
    }
  }
  out.series.sort((a, b) => a.order - b.order);
  return out;
}

/* ---------- EMF text records ---------- */
const EMR_EXTTEXTOUTA = 83;
const EMR_EXTTEXTOUTW = 84;

/**
 * readEmfText(buffer) → { strings: [{ x, y, text }], header, rows, lines }
 * Walks the EMF record stream (type, size, payload) and reads the string
 * of every EMR_EXTTEXTOUTW record with its reference point. The deal
 * tables are drawn one cell at a time: a row is the strings that share a
 * baseline (a wrapped cell sits half a line above and below it), a
 * column is the horizontal range that starts at a header cell.
 */
export function readEmfText(buffer) {
  const B = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const strings = [];
  let off = 0;
  while (off + 8 <= B.length) {
    const type = B.readUInt32LE(off);
    const size = B.readUInt32LE(off + 4);
    if (size < 8 || off + size > B.length) break;
    if ((type === EMR_EXTTEXTOUTW || type === EMR_EXTTEXTOUTA) && size >= 76) {
      /* EMRTEXT at +36: reference point (8), chars (4), offset to the string (4) */
      const x = B.readInt32LE(off + 36);
      const y = B.readInt32LE(off + 40);
      const chars = B.readUInt32LE(off + 44);
      const at = B.readUInt32LE(off + 48);
      const wide = type === EMR_EXTTEXTOUTW;
      const end = off + at + chars * (wide ? 2 : 1);
      if (at >= 8 && end <= off + size) {
        const text = B.subarray(off + at, end).toString(wide ? "utf16le" : "latin1");
        if (text.trim()) strings.push({ x, y, text });
      }
    }
    if (type === 14) break; /* EMR_EOF */
    off += size;
  }
  /* rows: cluster the baselines; a gap over 20 units starts a new row */
  const ys = [...new Set(strings.map((s) => s.y))].sort((a, b) => a - b);
  const bands = [];
  for (const y of ys) {
    const last = bands[bands.length - 1];
    if (last && y - last[last.length - 1] <= 20) last.push(y);
    else bands.push([y]);
  }
  const rowOf = new Map();
  bands.forEach((band, i) => band.forEach((y) => rowOf.set(y, i)));
  const grouped = bands.map(() => []);
  for (const s of strings) grouped[rowOf.get(s.y)].push(s);
  /* columns from the header row: each starts at a header x and runs to the next */
  const headerXs = grouped.length ? [...new Set(grouped[0].map((s) => s.x))].sort((a, b) => a - b) : [];
  const colOf = (x) => { let c = 0; for (let i = 0; i < headerXs.length; i++) if (x >= headerXs[i] - 2) c = i; return c; };
  const rows = grouped.map((cells) => {
    const cols = headerXs.map(() => []);
    for (const s of cells.sort((a, b) => a.y - b.y || a.x - b.x)) cols[colOf(s.x)].push(s.text.trim());
    return cols.map((parts) => parts.join(" ").replace(/\s+/g, " ").trim());
  });
  return {
    strings,
    header: rows.length ? rows[0] : [],
    rows: rows.slice(1),
    lines: rows.map((r) => r.join(" | ")),
  };
}

/* ---------- the deck ---------- */
export function readDeck(buffer) {
  const zip = readZip(buffer);
  const core = readCoreProps(zip);
  const warnings = [];

  /* presentation order: sldIdLst r:id → presentation.xml.rels → the member */
  const presXml = zip.text("ppt/presentation.xml");
  if (presXml === null) throw new Error("pptx: no ppt/presentation.xml");
  const presRels = readRels(zip, "ppt/_rels/presentation.xml.rels");
  const sldIds = children(find(parseXml(presXml), "sldIdLst"), "sldId");
  const slideFiles = sldIds.map((s) => {
    /* <p:sldId id="260" r:id="rId14"/>: the relationship id, not the slide id */
    const rel = presRels[attr(s, "r:id")];
    return rel ? resolveTarget("ppt/presentation.xml", rel.target) : null;
  }).filter(Boolean);

  const charts = {};
  const chartBySlide = new Map();
  const slides = [];
  slideFiles.forEach((file, i) => {
    const index = i + 1;
    const xml = zip.text(file);
    if (xml === null) { warnings.push({ slide: index, kind: "missingSlide", detail: file }); return; }
    const rels = readRels(zip, resolveTarget(file, "_rels/" + file.split("/").pop() + ".rels"));
    const { shapes, frames, pictures, tables } = readSlideShapes(parseXml(xml));
    const slide = {
      index, file,
      headline: headlineOf(shapes),
      sourceLine: null, footnote: null, asOf: null, geography: null,
      charts: [], emfTables: [], tables, shapes,
    };
    const multi = frames.length > 1;
    for (const frame of frames) {
      const rel = rels[frame.rId];
      if (!rel) { warnings.push({ slide: index, kind: "missingChartRel", detail: frame.rId }); continue; }
      const chartFile = resolveTarget(file, rel.target);
      const chartId = chartFile.split("/").pop().replace(/\.xml$/, "");
      const chartXml = zip.text(chartFile);
      if (chartXml === null) { warnings.push({ slide: index, kind: "missingChart", detail: chartFile }); continue; }
      const chartRels = readRels(zip, resolveTarget(chartFile, "_rels/" + chartFile.split("/").pop() + ".rels"));
      const drawingRel = Object.values(chartRels).find((r) => r.type === "chartUserShapes");
      const drawingXml = drawingRel ? zip.text(resolveTarget(chartFile, drawingRel.target)) : null;
      const chart = readChart(chartXml, drawingXml);
      const roles = rolesFor(shapes, frame.box, multi);
      /* the source line is on the slide, or in the chart's drawing */
      const drawingSource = chart.drawingText.find((t) => SOURCE_RE.test(t)) || null;
      const sourceLine = roles.sourceLine || drawingSource;
      const drawingNotes = chart.drawingText.filter((t) => t !== drawingSource);
      Object.assign(chart, {
        id: chartId, file: chartFile, slideIndex: index, frame: frame.box,
        headline: slide.headline,
        heading: roles.heading,
        sourceLine, sourceLineFromDrawing: !roles.sourceLine && !!drawingSource,
        footnote: roles.footnote || (drawingNotes.length ? drawingNotes.join(" ") : null),
        asOf: parseAsOf(sourceLine),
        geography: parseGeography(sourceLine),
      });
      if (chart.externalDataAutoUpdate !== false) warnings.push({ slide: index, chart: chartId, kind: "autoUpdate", detail: String(chart.externalDataAutoUpdate) });
      if (!chart.heading) warnings.push({ slide: index, chart: chartId, kind: "noHeading" });
      if (!sourceLine) warnings.push({ slide: index, chart: chartId, kind: "noSourceLine" });
      for (const d of chart.droppedSeries) warnings.push({ slide: index, chart: chartId, kind: d.reason, detail: d.name + " " + (d.valRef || ""), points: d.points.filter((p) => p.val !== null).length });
      for (const s of chart.series) if (s.blanks.length) warnings.push({ slide: index, chart: chartId, kind: "blankPoints", detail: s.name, idx: s.blanks, cats: s.blanks.map((b) => s.points[b].cat) });
      charts[chartId] = chart;
      slide.charts.push(chartId);
      chartBySlide.set(chartId, index);
    }
    if (slide.charts.length) {
      const first = charts[slide.charts[0]];
      slide.sourceLine = first.sourceLine;
      slide.footnote = first.footnote;
      slide.asOf = first.asOf;
      slide.geography = first.geography;
    } else {
      const roles = rolesFor(shapes, null);
      slide.sourceLine = roles.sourceLine;
      slide.asOf = parseAsOf(roles.sourceLine);
      slide.geography = parseGeography(roles.sourceLine);
    }
    for (const pic of pictures) {
      const rel = rels[pic.rId];
      if (!rel || !/\.emf$/i.test(rel.target)) continue;
      const member = resolveTarget(file, rel.target);
      const bytes = zip.read(member);
      if (!bytes) { warnings.push({ slide: index, kind: "missingPicture", detail: member }); continue; }
      const text = readEmfText(bytes);
      slide.emfTables.push({ picture: member, box: pic.box, strings: text.strings.length, header: text.header, rows: text.rows, lines: text.lines });
    }
    slides.push(slide);
  });

  const cover = slides[0] ? slides[0].shapes.flatMap((s) => s.lines) : [];
  const edition = editionOf(cover);
  if (!edition) warnings.push({ slide: 1, kind: "noEdition", detail: cover.join(" | ") });
  return {
    edition,
    publishedAt: core.modified,
    created: core.created,
    title: cover.find((l) => !/^[A-Za-z]+\s+\d{4}$/.test(l)) || core.title,
    slideCount: slides.length,
    slides,
    charts,
    warnings,
  };
}
