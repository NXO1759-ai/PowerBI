/**
 * xlsx-read.mjs — the PitchBook Fund Overview export, bytes to sheets.
 *
 * The "View All Charts" download is a workbook of twenty sheets: nineteen
 * data sheets that share one frame and a Disclaimer. Each data sheet
 * opens with a meta block — a banner in E1, "Downloaded on:" in G3/H3,
 * "Data pulled from:" with the full sheet title in A4/B4, "Created for:"
 * with the licensee in G4/H4, the data filters in A5/B5, the chart
 * filters in A6/B6 and the currency in A7/B7 — then a header row (row 9
 * in this export), the data rows, and a copyright line. Every cell is a
 * shared string: the numbers arrive as "$1.35Tn", "$303.55B", "$45.3M",
 * "4999", "1.64%", the dates as "10-Sep-2026".
 *
 * Sheets are identified by that frame, never by the tab name: Excel
 * truncates a tab to 31 characters, so "Average & Median Time Between
 * Funds (years)" is the tab "Average & Median Time Between F", while B4
 * carries the full title. The filter line is kept verbatim because it is
 * the population of every series the sheet yields (decision 12: the
 * export is ingested as it comes, all private capital funds, and each
 * series is labeled by its filter line).
 *
 * The meta block is read for the title, the download date, the filters
 * and the currency, and for nothing else: the licensee's name in H4 is
 * detected and withheld, and no served output ever carries it. The
 * export stamp is docProps/core.xml dcterms:created; it is cross-checked
 * against the file name on the date part only, because the file name's
 * clock is a 12-hour reading (05_03_44 against 17:03:44Z).
 */
import { readZip } from "./zip-read.mjs";
import { parseXml, find, findAll, children, attr, textOf, readRels, resolveTarget, readSharedStrings, readCoreProps } from "./ooxml.mjs";
import { parseDate } from "./pc-periods.mjs";

/* ---------- cells ---------- */
/** "B" → 1, "AA" → 26 */
export function columnIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
/** 1 → "B" */
export function columnLetter(index) {
  let s = "";
  let i = index + 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/* A cell's text, whatever its storage type: shared strings by index,
   inline strings by their runs, booleans, errors and numbers as written.
   Every cell of this export is a shared string; the other types are read
   so a re-export that stores numbers as numbers still arrives. A date
   stored as a serial number would arrive as its serial (the style table
   is not read); the export writes dates as text. */
function cellText(c, shared) {
  const t = attr(c, "t") || "n";
  if (t === "s") {
    const v = find(c, "v");
    if (!v) return null;
    const idx = Number(textOf(v));
    return Number.isInteger(idx) && idx >= 0 && idx < shared.length ? shared[idx] : null;
  }
  if (t === "inlineStr") {
    const is = find(c, "is");
    return is ? findAll(is, "t").map(textOf).join("") : null;
  }
  const v = find(c, "v");
  if (!v) return null;
  const s = textOf(v);
  if (t === "b") return s === "1" ? "TRUE" : "FALSE";
  return s;
}

function readSheetRows(xml, shared) {
  const root = parseXml(xml);
  const data = find(root, "sheetData");
  const rows = [];
  const rowNumbers = [];
  let nextRow = 1;
  for (const row of children(data, "row")) {
    const r = Number(attr(row, "r")) || nextRow;
    nextRow = r + 1;
    const cells = [];
    let nextCol = 0;
    for (const c of children(row, "c")) {
      const ref = attr(c, "r");
      const m = ref ? /^([A-Z]+)(\d+)$/.exec(ref) : null;
      const col = m ? columnIndex(m[1]) : nextCol;
      nextCol = col + 1;
      const text = cellText(c, shared);
      if (text === null || text === "") continue;
      while (cells.length < col) cells.push(null);
      cells[col] = text;
    }
    if (!cells.length) continue;
    rows.push(cells);
    rowNumbers.push(r);
  }
  const dim = find(root, "dimension");
  return { rows, rowNumbers, dimension: dim ? attr(dim, "ref") : null };
}

/* ---------- the frame ---------- */
const LABEL_RE = /^[A-Za-z][A-Za-z ]{1,40}:$/;
/* the meta labels whose values are served, by their normalized label */
const SERVED = {
  "data pulled from": "title",
  "downloaded on": "downloadedOn",
  "data filters": "filterLine",
  "chart filters": "chartFilters",
  "currency": "currency",
};
const normLabel = (s) => s.replace(/\s+/g, " ").trim().replace(/:$/, "").toLowerCase();
const normText = (s) => String(s).replace(/\s+/g, " ").trim();
const nonEmpty = (cells) => cells.filter((c) => c !== null && c !== undefined && String(c).trim() !== "");
const isCopyright = (cells) => { const f = nonEmpty(cells); return f.length === 1 && /^©/.test(String(f[0]).trim()); };

/**
 * sheetFrame(rows, rowNumbers) → { title, downloadedOn, downloadedOnRaw,
 *   filterLine, chartFilters, currency, headerRow, headerRowRaw,
 *   headerRowNumber, firstDataRow, lastDataRow, copyright, withheld }
 * or null when the rows carry no "Data pulled from:" label (the
 * Disclaimer sheet). withheld lists the meta labels whose values were
 * withheld; the values themselves are not kept anywhere.
 */
export function sheetFrame(rows, rowNumbers) {
  const frame = {
    title: null, downloadedOn: null, downloadedOnRaw: null, filterLine: null, chartFilters: null, currency: null,
    headerRow: null, headerRowRaw: null, headerRowNumber: null, firstDataRow: null, lastDataRow: null,
    copyright: null, withheld: [],
  };
  let headerAt = -1;
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i];
    let metaRow = false;
    for (let j = 0; j < cells.length; j++) {
      const cell = cells[j];
      if (cell === null || !LABEL_RE.test(normText(cell))) continue;
      metaRow = true;
      /* the value is the next non-empty cell to the right of the label */
      let value = null;
      for (let k = j + 1; k < cells.length; k++) {
        if (cells[k] !== null && String(cells[k]).trim() !== "") { value = String(cells[k]); break; }
      }
      const label = normLabel(cell);
      const field = SERVED[label];
      if (field === "downloadedOn") {
        frame.downloadedOnRaw = value;
        frame.downloadedOn = value === null ? null : parseDate(value);
      } else if (field) {
        frame[field] = value === null ? null : (field === "title" ? normText(value) : value);
      } else {
        /* "Created for:" and anything else naming a person: withheld */
        frame.withheld.push(normText(cell));
      }
    }
    if (metaRow) continue;
    /* the banner ("Fund Overview Download") is a lone cell before any
       label; the header is the first non-meta row after the title */
    if (frame.title === null) continue;
    headerAt = i;
    break;
  }
  if (frame.title === null) return null;
  if (headerAt >= 0) {
    frame.headerRowRaw = rows[headerAt].map((c) => (c === null ? null : String(c)));
    frame.headerRow = frame.headerRowRaw.map((c) => (c === null ? null : normText(c)));
    frame.headerRowNumber = rowNumbers[headerAt];
    frame.firstDataRow = null;
    for (let i = headerAt + 1; i < rows.length; i++) {
      if (isCopyright(rows[i])) { frame.copyright = normText(nonEmpty(rows[i])[0]); break; }
      if (frame.firstDataRow === null) frame.firstDataRow = rowNumbers[i];
      frame.lastDataRow = rowNumbers[i];
    }
  }
  return frame;
}

/* the rows between the header and the copyright line, with their numbers */
function dataRows(rows, rowNumbers, frame) {
  const out = [];
  const nums = [];
  if (!frame || frame.headerRowNumber === null) return { rows: out, rowNumbers: nums };
  for (let i = 0; i < rows.length; i++) {
    if (rowNumbers[i] <= frame.headerRowNumber) continue;
    if (isCopyright(rows[i])) break;
    out.push(rows[i].map((c) => (c === null ? null : String(c))));
    nums.push(rowNumbers[i]);
  }
  return { rows: out, rowNumbers: nums };
}

/* ---------- the workbook ---------- */
/**
 * readWorkbook(buffer) → {
 *   created, modified, title,     docProps/core.xml as written
 *   exportDate,                   the date part of created
 *   sheets: [{ name, sheetId, file, kind: "data"|"disclaimer"|"unknown"|"missing",
 *              frame, rows, rowNumbers, cellCount, dimension }]
 * }
 * rows are the data rows only (header excluded, copyright excluded, meta
 * block excluded), each an array of cell strings with null for a blank
 * position; rowNumbers gives each row's number in the sheet so a locator
 * such as "col B row 18" resolves. Sheet order is the workbook's.
 */
export function readWorkbook(buffer) {
  const zip = readZip(buffer);
  const core = readCoreProps(zip);
  const shared = readSharedStrings(zip);
  const wbXml = zip.text("xl/workbook.xml");
  if (wbXml === null) throw new Error("xlsx: no xl/workbook.xml");
  const rels = readRels(zip, "xl/_rels/workbook.xml.rels");
  const sheets = [];
  for (const s of findAll(parseXml(wbXml), "sheet")) {
    const name = attr(s, "name");
    const rid = attr(s, "r:id") || attr(s, "id");
    const rel = rels[rid];
    const file = rel ? resolveTarget("xl/workbook.xml", rel.target) : null;
    const xml = file ? zip.text(file) : null;
    if (xml === null) {
      sheets.push({ name, sheetId: Number(attr(s, "sheetId")) || null, file, kind: "missing", frame: null, rows: [], rowNumbers: [], cellCount: 0, dimension: null });
      continue;
    }
    const all = readSheetRows(xml, shared);
    const frame = sheetFrame(all.rows, all.rowNumbers);
    const firstText = all.rows.length ? normText(nonEmpty(all.rows[0])[0] || "") : "";
    const kind = frame ? "data" : /copyright/i.test(firstText) || /^disclaimer$/i.test(name) ? "disclaimer" : "unknown";
    const data = dataRows(all.rows, all.rowNumbers, frame);
    sheets.push({
      name, sheetId: Number(attr(s, "sheetId")) || null, file, kind, frame,
      rows: data.rows, rowNumbers: data.rowNumbers,
      cellCount: all.rows.reduce((n, r) => n + nonEmpty(r).length, 0),
      dimension: all.dimension,
    });
  }
  return {
    created: core.created, modified: core.modified, title: core.title,
    exportDate: core.created ? parseDate(core.created) : null,
    sheets,
  };
}

/** the data sheet whose frame title is the one asked for (whitespace-insensitive) */
export function sheetByTitle(workbook, title) {
  const want = normText(title);
  return workbook.sheets.find((s) => s.frame && s.frame.title === want) || null;
}

/** the raw text at a cell address ("B18") of a sheet's data rows, or null */
export function cellAt(sheet, ref) {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!m) return null;
  const i = sheet.rowNumbers.indexOf(Number(m[2]));
  if (i < 0) return null;
  const v = sheet.rows[i][columnIndex(m[1])];
  return v === undefined ? null : v;
}

/* ---------- the export stamp ---------- */
/** "..._2026_09_10_05_03_44.xlsx" → "2026-09-10" */
export function dateFromFileName(name) {
  const m = /(\d{4})_(\d{2})_(\d{2})_\d{2}_\d{2}_\d{2}/.exec(String(name));
  return m ? parseDate(m[1] + "-" + m[2] + "-" + m[3]) : null;
}

/**
 * checkStamp(workbook, fileName) → { coreDate, fileDate, downloadedOn, agree }
 * The three stamps of an export: core.xml created, the file name and the
 * sheets' "Downloaded on:" cells. Dates only — the file name's clock is
 * twelve hours off core.xml's.
 */
export function checkStamp(workbook, fileName) {
  const coreDate = workbook.exportDate;
  const fileDate = dateFromFileName(fileName);
  const downloadedOn = [...new Set(workbook.sheets.filter((s) => s.frame && s.frame.downloadedOn).map((s) => s.frame.downloadedOn))];
  const agree = coreDate !== null && (fileDate === null || fileDate === coreDate) && downloadedOn.every((d) => d === coreDate);
  return { coreDate, fileDate, downloadedOn, agree };
}

/* ---------- cell values ---------- */
const SUFFIX = { Tn: 12, T: 12, Bn: 9, B: 9, Mn: 6, M: 6, K: 3, k: 3 };

/* Scale a decimal by shifting its digits, so "$1.35Tn" is exactly
   1350000000000 and "1.64%" exactly 0.0164; multiplying the float would
   leave binary residue on some cells. */
function shiftDecimal(intPart, fracPart, shift) {
  const digits = intPart + fracPart;
  const point = intPart.length + shift;
  let s;
  if (point >= digits.length) s = digits + "0".repeat(point - digits.length);
  else if (point <= 0) s = "0." + "0".repeat(-point) + digits;
  else s = digits.slice(0, point) + "." + digits.slice(point);
  return Number(s);
}

/**
 * parseCellValue(text) → one of
 *   { kind: "money",   value, currency, suffix, multiplier, raw }  "$1.35Tn" → 1350000000000 USD
 *   { kind: "percent", value, raw }                               "1.64%" → 0.0164 (a fraction)
 *   { kind: "number",  value, raw, suffix?, multiplier? }         "4999" → 4999, "12.3M" → 12300000
 *   { kind: "date",    value, raw }                               "10-Sep-2026" → "2026-09-10"
 *   { kind: "text",    value, raw }                               anything else, "n/a" included
 *   null for an empty cell
 * Money is in whole currency units (the page or the pipeline divides by
 * 1e9 for $B). Suffixes: Tn/T, Bn/B, Mn/M, K. Parentheses or a leading
 * minus negate. Thousands separators are accepted.
 */
export function parseCellValue(text) {
  if (text === null || text === undefined) return null;
  const raw = String(text);
  let t = raw.replace(/ /g, " ").trim();
  if (t === "") return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
  if (t[0] === "-" || t[0] === "−") { neg = !neg; t = t.slice(1).trim(); }
  let currency = null;
  const cur = /^(US\$|\$|€|£)/.exec(t);
  if (cur) { currency = cur[1] === "€" ? "EUR" : cur[1] === "£" ? "GBP" : "USD"; t = t.slice(cur[1].length).trim(); }
  if (t[0] === "-" || t[0] === "−") { neg = !neg; t = t.slice(1).trim(); }
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d*))?\s*(Tn|Bn|Mn|T|B|M|K|k|%)?$/.exec(t);
  if (m) {
    const intPart = m[1].replace(/,/g, "");
    const fracPart = m[2] || "";
    const suffix = m[3] || null;
    const sign = neg ? -1 : 1;
    if (suffix === "%") return { kind: "percent", value: sign * shiftDecimal(intPart, fracPart, -2), raw };
    const exp = suffix ? SUFFIX[suffix] : 0;
    const value = sign * shiftDecimal(intPart, fracPart, exp);
    if (currency) return { kind: "money", value, currency, suffix, multiplier: Math.pow(10, exp), raw };
    return suffix ? { kind: "number", value, raw, suffix, multiplier: Math.pow(10, exp) } : { kind: "number", value, raw };
  }
  if (!currency && !neg) {
    const d = parseDate(t);
    if (d) return { kind: "date", value: d, raw };
  }
  return { kind: "text", value: raw, raw };
}
