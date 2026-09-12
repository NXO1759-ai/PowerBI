/**
 * pc-map.mjs — identifies a chart or a sheet by its content and names the
 * series keys it carries.
 *
 *   fingerprint(chartOrSheet) → what the reader saw, normalized
 *   match(fingerprint, map)   → the map entries that describe it, or why not
 *
 * A monitor chart is never identified by its chart number: the number
 * is the order PowerPoint happened to save the parts in, and a slide
 * inserted in September moves every number after it. What identifies a
 * chart is what it shows — the heading, the set of series names, the
 * period grain of its axis and the number formats of its value axes,
 * with the embedded workbook's sheet name as the tiebreak. A workbook
 * sheet is identified the same way by its frame: the "Data pulled
 * from:" title, the header row, whether it has a Year column, the kinds
 * of value in its columns, and the tab name as the tiebreak.
 *
 * The scoring is the blueprint's (7.5): heading exact 3, series names 2,
 * grain 1, axis formats 1, and the sheet reference weighted 1 whenever
 * the heading signal is absent. A chart is matched when the best entry
 * scores at least 4 and beats the runner-up by at least 1. When that
 * fails, a second pass looks for exactly one entry equal on series,
 * grain, formats and sheet reference together. Two entries that tie are
 * ambiguous and the chart is refused with both candidates named; a
 * refused chart is a strict-build failure, never a guess. With the
 * design's original weights (sheet reference 0.5) a reworded heading
 * left twelve charts ambiguous — chart1/3, 10/11, 14/15, 16/18, 17/19,
 * 21/22 — which is why the tiebreak counts for a whole point.
 *
 * Series names that are themselves periods ("3Q25", "2025", "As of
 * June 30, 2026") compare by their grain, not their text, so a BDC
 * snapshot chart that drops 3Q25 and adds 3Q26 still matches.
 *
 * scripts/pc-map.json is data: one entry per series key, each carrying
 * the fingerprint of the chart or sheet that holds it. Entries that
 * share fingerprint.id describe one chart; a heading alias added to any
 * one of them counts for all. The matcher never edits the map.
 */
import { parsePeriod, grainsOf } from "./pc-periods.mjs";
import { parseCellValue } from "./xlsx-read.mjs";

/* ---------- normalization ---------- */
/** lowercase, dashes unified, whitespace collapsed, trailing punctuation off */
export function normHeading(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/[–—‒−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:;,]+$/, "")
    .toLowerCase();
}

/** series and header names: as normHeading, plus "450 - 499" and "450-499" agree */
export function normSeries(s) {
  return normHeading(s).replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");
}

/* A period-shaped name is compared by grain: the four snapshot series of
   a BDC chart become one token, whatever quarters they name. */
export function seriesToken(name) {
  const p = parsePeriod(name);
  return p ? "<period:" + p.grain + ">" : normSeries(name);
}

const tokenSet = (names) => new Set((names || []).map(seriesToken));
const setEqual = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const fmtSet = (list) => new Set((list || []).map((f) => (f === null || f === undefined ? "" : String(f))));
const sheetRefNorm = (s) => (s === null || s === undefined ? "" : String(s).replace(/\s+/g, " ").trim().toLowerCase());

/* ---------- fingerprints ---------- */
/**
 * The grain of a chart is read from whichever axis carries the periods.
 * When every series name parses as a period the periods are on the
 * series (chart8's "2025" and "2026 YTD", the BDC snapshots, the
 * maturity wall's "As of ..." pair) and the categories are buckets or
 * sectors; otherwise the categories carry the periods. A chart whose
 * categories are years but whose series are snapshot dates (the
 * maturity wall: 2026 .. 2031 - 2033 are maturity buckets) is therefore
 * read as periods-on-series, which is the reading the slide intends.
 */
function chartFingerprint(chart) {
  const names = chart.series.map((s) => s.name);
  const cats = chart.series.length ? chart.series[0].points.map((p) => p.cat) : [];
  const serParsed = names.length > 0 && names.every((n) => parsePeriod(n) !== null);
  const catGrains = grainsOf(cats, { asOf: chart.asOf });
  const serGrains = grainsOf(names, { asOf: chart.asOf });
  let orientation = "none";
  let grain = "none";
  if (serParsed) { orientation = "series"; grain = serGrains.join("+"); }
  else if (catGrains.length) { orientation = "categories"; grain = catGrains.join("+"); }
  const valAx = (s) => chart.axes.find((a) => a.kind === "valAx" && s.axIds.includes(a.axId));
  const formats = [...new Set(chart.series.map((s) => { const a = valAx(s); return a ? a.numFmt : null; }))].sort();
  /* the sheet the most series reference */
  const refs = new Map();
  for (const s of chart.series) if (s.sheetRef) refs.set(s.sheetRef, (refs.get(s.sheetRef) || 0) + 1);
  const sheetRef = [...refs.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    kind: "chart",
    id: chart.id,
    slide: chart.slideIndex,
    heading: chart.heading,
    headline: chart.headline,
    seriesNames: names,
    grain,
    orientation,
    axisFormats: formats,
    sheetRef: sheetRef ? sheetRef[0] : null,
    firstCat: cats.length ? cats[0] : null,
    lastCat: cats.length ? cats[cats.length - 1] : null,
    asOf: chart.asOf,
    geography: chart.geography,
    chartTypes: chart.chartTypes.map((t) => t.type),
  };
}

/* A sheet's value kinds, read from the first data row: the header says
   "Capital Raised", the row says whether that is money, a percent or a
   count. This is the workbook's stand-in for an axis number format. */
function columnKinds(sheet) {
  const row = sheet.rows && sheet.rows.length ? sheet.rows[0] : [];
  return (sheet.frame.headerRow || []).map((h, i) => {
    if (h === null) return "";
    const v = parseCellValue(row[i] === undefined ? null : row[i]);
    return v ? v.kind : "empty";
  });
}

function sheetFingerprint(sheet) {
  const frame = sheet.frame;
  const header = (frame.headerRow || []).filter((h) => h !== null);
  const hasYear = header.some((h) => /^year$/i.test(h));
  return {
    kind: "sheet",
    id: sheet.name,
    heading: frame.title,
    headline: null,
    seriesNames: header,
    grain: hasYear ? "year" : "snapshot",
    orientation: hasYear ? "rows" : "snapshot",
    axisFormats: columnKinds(sheet),
    sheetRef: sheet.name,
    filterLine: frame.filterLine,
    chartFilters: frame.chartFilters,
    currency: frame.currency,
    downloadedOn: frame.downloadedOn,
    rows: sheet.rows.length,
    firstDataRow: frame.firstDataRow,
    lastDataRow: frame.lastDataRow,
  };
}

/** fingerprint(chartOrSheet) → the normalized identity of a chart (has series) or a sheet (has a frame) */
export function fingerprint(x) {
  if (x && Array.isArray(x.series) && Array.isArray(x.axes)) return chartFingerprint(x);
  if (x && x.frame) return sheetFingerprint(x);
  throw new Error("fingerprint: neither a chart nor a data sheet");
}

/* ---------- the map ---------- */
/**
 * groups(map) → [{ id, source, kind, fingerprint, entries }]
 * Entries sharing fingerprint.id are one chart or sheet. Aliases are the
 * union over the group, so an alias on any entry serves the whole chart.
 */
export function groups(map) {
  const by = new Map();
  for (const e of map.entries) {
    const fp = e.fingerprint;
    if (!fp || !fp.id) throw new Error("pc-map: entry " + e.key + " has no fingerprint.id");
    let g = by.get(fp.id);
    if (!g) {
      g = {
        id: fp.id, source: e.source, kind: e.source === "pb-fund-overview" ? "sheet" : "chart",
        fingerprint: {
          heading: fp.heading, headingAliases: [], seriesNames: [...(fp.seriesNames || [])], seriesAliases: {},
          grain: fp.grain, axisFormats: [...(fp.axisFormats || [])], sheetRef: fp.sheetRef, sheetRefAliases: [],
        },
        entries: [],
      };
      by.set(fp.id, g);
    }
    g.entries.push(e);
    for (const a of fp.headingAliases || []) if (!g.fingerprint.headingAliases.includes(a)) g.fingerprint.headingAliases.push(a);
    for (const a of fp.sheetRefAliases || []) if (!g.fingerprint.sheetRefAliases.includes(a)) g.fingerprint.sheetRefAliases.push(a);
    for (const [name, aliases] of Object.entries(fp.seriesAliases || {})) {
      g.fingerprint.seriesAliases[name] = [...new Set([...(g.fingerprint.seriesAliases[name] || []), ...aliases])];
    }
    if (e.seriesAliases && e.series) {
      g.fingerprint.seriesAliases[e.series] = [...new Set([...(g.fingerprint.seriesAliases[e.series] || []), ...e.seriesAliases])];
    }
  }
  return [...by.values()];
}

/* the series-name token set of a group, aliases folded onto their canonical names */
function groupTokens(g) {
  return tokenSet(g.fingerprint.seriesNames);
}
/* a fingerprint's series names with the group's aliases mapped back */
function observedTokens(fp, g) {
  const back = new Map();
  for (const [canon, aliases] of Object.entries(g.fingerprint.seriesAliases)) {
    for (const a of aliases) back.set(seriesToken(a), seriesToken(canon));
  }
  return new Set((fp.seriesNames || []).map((n) => { const t = seriesToken(n); return back.has(t) ? back.get(t) : t; }));
}

/** score(fp, group) → { score, signals: { heading, series, grain, formats, sheetRef } } */
export function score(fp, g) {
  const f = g.fingerprint;
  const heading = normHeading(fp.heading);
  const headings = [f.heading, ...f.headingAliases].map(normHeading).filter(Boolean);
  const signals = {
    heading: heading !== "" && headings.includes(heading),
    series: setEqual(observedTokens(fp, g), groupTokens(g)),
    grain: fp.grain === f.grain,
    formats: setEqual(fmtSet(fp.axisFormats), fmtSet(f.axisFormats)),
    sheetRef: sheetRefNorm(fp.sheetRef) !== "" && [f.sheetRef, ...f.sheetRefAliases].map(sheetRefNorm).includes(sheetRefNorm(fp.sheetRef)),
  };
  let total = 0;
  if (signals.heading) total += 3;
  if (signals.series) total += 2;
  if (signals.grain) total += 1;
  if (signals.formats) total += 1;
  if (!signals.heading && signals.sheetRef) total += 1;
  return { score: total, signals };
}

/**
 * match(fp, map) → {
 *   matched, key (the group id), keys (the entry keys), entries, group,
 *   score, via: "heading" | "fallback" | null, candidates: [{ id, score, signals }],
 *   reason: "ambiguous" | "noCandidate" | null
 * }
 * Only groups of the fingerprint's kind (chart or sheet) are considered.
 */
export function match(fp, map) {
  const kind = fp.kind === "sheet" ? "sheet" : "chart";
  const all = groups(map).filter((g) => g.kind === kind);
  const scored = all.map((g) => ({ group: g, ...score(fp, g) }))
    .sort((a, b) => b.score - a.score || a.group.id.localeCompare(b.group.id));
  const candidates = scored.filter((s) => s.score > 0).slice(0, 6).map((s) => ({ id: s.group.id, score: s.score, signals: s.signals }));
  const result = (g, s, via, reason) => ({
    matched: !!g,
    key: g ? g.id : null,
    keys: g ? g.entries.map((e) => e.key) : [],
    entries: g ? g.entries : [],
    group: g || null,
    score: s ? s.score : 0,
    signals: s ? s.signals : null,
    via,
    candidates,
    reason: reason || null,
  });
  if (!scored.length || scored[0].score === 0) return result(null, null, null, "noCandidate");
  const best = scored[0], next = scored[1];
  if (best.score >= 4 && (!next || best.score - next.score >= 1)) {
    return result(best.group, best, best.signals.heading ? "heading" : "fallback", null);
  }
  /* second pass: exactly one group equal on everything but the heading */
  const exact = scored.filter((s) => s.signals.series && s.signals.grain && s.signals.formats && s.signals.sheetRef);
  if (exact.length === 1) return result(exact[0].group, exact[0], exact[0].signals.heading ? "heading" : "fallback", null);
  return result(null, best, null, exact.length > 1 || (next && best.score === next.score) ? "ambiguous" : "belowThreshold");
}

/**
 * entryForSeries(group, name) → the entry whose series name (or an alias)
 * is the chart series named, or null. Snapshot entries are found by their
 * keyPattern instead (see pc-series.mjs).
 */
export function entryForSeries(group, name) {
  const t = seriesToken(name);
  const raw = normSeries(name);
  for (const e of group.entries) {
    if (!e.series) continue;
    if (normSeries(e.series) === raw) return e;
    if ((e.seriesAliases || []).some((a) => normSeries(a) === raw)) return e;
  }
  /* period-named series: any entry whose series is period-shaped with the same grain */
  if (t.startsWith("<period:")) {
    for (const e of group.entries) if (e.series && seriesToken(e.series) === t && e.keyPattern) return e;
  }
  return null;
}

/** loadMap(text) → the parsed map with every entry checked for the fields the ingest needs */
export function validateMap(map) {
  const problems = [];
  const seen = new Set();
  for (const e of map.entries || []) {
    if (!e.key) problems.push("an entry has no key");
    else if (seen.has(e.key)) problems.push("duplicate key " + e.key);
    seen.add(e.key);
    if (!e.source) problems.push(e.key + ": no source");
    if (!e.fingerprint || !e.fingerprint.id || !e.fingerprint.heading) problems.push(e.key + ": fingerprint needs id and heading");
    if (e.source === "pb-fund-overview") {
      if (!e.table && !e.column) problems.push(e.key + ": a sheet entry needs a column or a table");
      if (!e.population) problems.push(e.key + ": a sheet entry needs its filter line as population");
    } else if (!e.series && !e.derive) {
      problems.push(e.key + ": a chart entry needs a series name or a derive rule");
    }
    if (!e.unit) problems.push(e.key + ": no unit");
    if (!e.group) problems.push(e.key + ": no group");
  }
  return problems;
}
