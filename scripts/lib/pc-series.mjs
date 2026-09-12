/**
 * pc-series.mjs — from a read file to dated series, and from a stack of
 * vintages to the series the page draws.
 *
 *   extractDeck(deck, map)         a monitor's charts → one vintage of series
 *   extractWorkbook(workbook, map) a Fund Overview export → one vintage
 *   extractReport(file, name)      a hand-keyed reports file → one vintage per document
 *   extractPress(file)             press-series.json → one vintage
 *   build(vintages)                replay oldest → newest; newest wins per key and date
 *   derive(keys)                   the capital metrics computed from the ingested series
 *
 * A vintage is one download: { id (the folder date), source, edition,
 * publishedAt, asOf, series: { key: { ...metadata, points } }, tables,
 * report }. Its points are { p, g, v } with p the period end, g the
 * grain, start on windows (year-to-date, rolling), c on snapshot series
 * whose points are buckets or sectors at one date. Nothing is scaled:
 * a value is the number the chart cache or the sheet cell holds (a
 * share stays the fraction Excel drew as 0%, chart27's literal percent
 * stays 8.30), so every figure in series.json can be found in the file
 * it came from. Money from the workbook is the one exception, divided
 * by 1e9 or 1e6 to the catalog's $B and $M.
 *
 * The replay is the restatement rule of blueprint 7.5: every vintage is
 * read in order, and for each key and date the newest vintage's value
 * stands; an older value that differs goes to restatements with both
 * vintages and editions. Rolling and year-to-date points are keyed by
 * their window end, so a new edition adds a point instead of
 * overwriting one; the three-period spread charts (13–15) and the BDC
 * snapshots accumulate the same way. A key an older vintage carried
 * that the newest edition of its source does not is kept and flagged
 * stale, never dropped.
 *
 * Three refusals guard a match that looks right and is not. A chart
 * whose heading matched but whose value axis is on another scale than
 * the key's unit (chart27 re-exported under Excel percent would cache
 * 0.083 where the map says percentage points) is refused per series as
 * unitMismatch, because the number would be served a hundred times off
 * under the right label. Two charts of one edition that match the same
 * map group are both refused as duplicateMatch, since nothing says
 * which one the key means. And a group that failed to match in the
 * newest edition leaves every one of its keys stale, whether or not the
 * key accumulates: an accumulating key is spared only when its chart
 * was read and the key merely rolled off (a 3Q25 snapshot after 3Q26
 * appears). Each refusal fails the strict build with the chart, slide
 * and key named.
 */
import { parsePeriod } from "./pc-periods.mjs";
import { parseCellValue } from "./xlsx-read.mjs";
import { rolesFor } from "./pptx-charts.mjs";
import { fingerprint, match, entryForSeries, normSeries } from "./pc-map.mjs";

/* ---------- the served vocabulary ---------- */
/**
 * Every point in series.json carries one of these grains, and every
 * hand-keyed grain is spelled the same way the period grammar spells it:
 * the reports' "ttm" is served as rolling12m (the deck's "TTM" and the
 * press file's "TTM to …" already are). The three grains the grammar
 * does not emit are the reports' multi-year "window" (a CAGR or a
 * ten-year growth rate, start to end), their "rolling6m" (the
 * Quantitative Perspectives trailing six months) and the press file's
 * "label" (a point whose period names no calendar date). A report grain
 * outside this list is refused by validateReport, never guessed.
 */
export const SERVED_GRAINS = new Set(["quarter", "half", "year", "ytd", "month", "asof", "rolling3m", "rolling6m", "rolling12m", "window", "label"]);
const GRAIN_ALIASES = { ttm: "rolling12m", ltm: "rolling12m" };
export const servedGrain = (g) => GRAIN_ALIASES[String(g || "").toLowerCase()] || g;
/* percent points as printed are unit pct everywhere (chart27's all-in
   rate, the report and press series); a bare "%" in a hand-keyed file is
   the same unit. Qualified spellings ("% of loans", "% a year") say what
   the percent is of and stay as typed. A fraction the source holds as
   0.4 stays unit share. */
const UNIT_ALIASES = { "%": "pct", percent: "pct" };
export const servedUnit = (u) => UNIT_ALIASES[String(u || "").trim().toLowerCase()] || u;

/* ---------- small helpers ---------- */
const WINDOW_GRAINS = new Set(["ytd", "rolling3m", "rolling6m", "rolling12m", "half", "window"]);
const near = (a, b) => (Number.isInteger(a) && Number.isInteger(b) ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));
/* a point's identity: key, period end, grain, and the bucket or the press label when it carries one */
const pointId = (key, pt) => key + "|" + (pt.p || "") + "|" + pt.g + "|" + (pt.c === undefined ? "" : pt.c) + "|" + (pt.label === undefined ? "" : pt.label);
const cloneMeta = (m) => { const o = { ...m }; delete o.points; return o; };
/* by period end and grain; points at one date keep the order the chart or sheet drew them in (a bucket list, sectors by share) */
const sortPoints = (pts) => pts.sort((a, b) => String(a.p || "").localeCompare(String(b.p || "")) || String(a.g).localeCompare(String(b.g)));

/**
 * periodSlug(period, style) → the key suffix of a snapshot series
 *   "qyy":   3Q25 → 3q25, 2025 → 2025, 2026 YTD → 2026ytd
 *   "yyyyq": As of June 30, 2026 → 2026q2 (a date at a quarter end), else the date's digits
 *   "year":  2025 → 2025, 2026 YTD → 2026ytd, 3Q25 → 2025q3
 */
export function periodSlug(period, style = "qyy") {
  const y = period.end.slice(0, 4), yy = y.slice(2);
  const qOf = (d) => { const m = +d.slice(5, 7); return m % 3 === 0 && /-(03-31|06-30|09-30|12-31)$/.test(d) ? m / 3 : null; };
  if (period.grain === "quarter") return style === "yyyyq" || style === "year" ? y + "q" + period.quarter : period.quarter + "q" + yy;
  if (period.grain === "year") return y;
  if (period.grain === "ytd") return y + "ytd";
  if (period.grain === "half") return y + "h" + period.half;
  if (period.grain === "asof") { const q = qOf(period.end); return q ? y + "q" + q : period.end.replace(/-/g, ""); }
  return period.end.replace(/-/g, "");
}

function windowFields(period) {
  const out = { p: period.end, g: period.grain };
  if (WINDOW_GRAINS.has(period.grain) && period.start) out.start = period.start;
  return out;
}

/* the text block above a picture, by geometry, for the EMF tables */
function titleAbove(slide, box) {
  const roles = rolesFor(slide.shapes, box, false);
  return roles.heading;
}

/* ---------- the value axis against the key's unit ---------- */
/**
 * formatClass(numFmt) → "excelPercent" | "literalPercent" | "currency" | "number" | null
 * The value-axis number format says what scale the cached numbers are
 * on. "0%" is Excel percent: the cache holds fractions (chart25's 2026
 * bucket, 0.0130…). '0"%"' prints a literal sign after a number that
 * is already in percentage points (chart27's 8.30). '"$"#,##0' and
 * '"$"0' are money; General and #,##0 are plain numbers (counts, bps).
 * Quoted text, a backslash-escaped character and a bracketed currency
 * ([$€-2]) are literals; a bare [$-409] is a locale and says nothing.
 * A series with no value axis has no class.
 */
export function formatClass(numFmt) {
  if (numFmt === null || numFmt === undefined) return null;
  const s = String(numFmt);
  const literals = [];
  const bare = s
    .replace(/"([^"]*)"/g, (m, t) => { literals.push(t); return ""; })
    .replace(/\\(.)/g, (m, c) => { literals.push(c); return ""; })
    .replace(/\[\$([^\]-]*)[^\]]*\]/g, (m, sym) => { if (sym) literals.push(sym); return ""; })
    .replace(/\[[^\]]*\]/g, "");
  const lit = literals.join("");
  if (/%/.test(lit)) return "literalPercent";
  if (/%/.test(bare)) return "excelPercent";
  if (/[$€£¥]/.test(lit) || /[$€£¥]/.test(bare)) return "currency";
  return "number";
}

/**
 * scaleClass(scale) → the format class a map entry's scale implies, or
 * null for a scale the check does not know (refused, never guessed).
 * The map's scale is the owner's statement of what the cached number
 * is: a fraction, percentage points, dollars in billions, a count, bps.
 */
const SCALE_CLASS = { fraction: "excelPercent", percentPoints: "literalPercent", usd_b: "currency", usd_m: "currency", count: "number", bps: "number" };
export const scaleClass = (scale) => SCALE_CLASS[String(scale || "")] || null;

/* the signals a matched group failed, for the report: a chart that
   matched on its heading with the axis formats or the grain changed */
function signalMismatch(fp, g, m) {
  if (!m.signals || (m.signals.formats && m.signals.grain)) return null;
  const rec = { id: g.id, keys: g.entries.map((e) => e.key), via: m.via, score: m.score, heading: fp.heading };
  if (!m.signals.formats) rec.formats = { expected: g.fingerprint.axisFormats, observed: fp.axisFormats };
  if (!m.signals.grain) rec.grain = { expected: g.fingerprint.grain, observed: fp.grain };
  return rec;
}

/* ---------- the deck ---------- */
/**
 * extractDeck(deck, map, { vintage, file, sha256, hand }) → a vintage.
 * `hand` is the hand-keyed tables file for the edition, when present,
 * so the EMF tables read from the deck can be checked cell for cell.
 */
export function extractDeck(deck, map, options = {}) {
  const report = {
    chartsSeen: 0, matched: [], fallbackMatched: [], unmatched: [], unmatchedSeries: [], refused: [], signalMismatch: [],
    dropped: [], blanks: [], crossChecks: [], derived: [], duplicatesSkipped: [], generatedKeys: [], tables: [], warnings: [],
  };
  const series = {};
  const tables = {};
  const dupChecks = [];
  const sumChecks = [];

  /* first pass: identify every chart. A map group may take one chart per
     edition; two charts that resolve to the same group are both refused,
     because nothing in the file says which of them the key means. */
  const matches = [];
  const byGroup = new Map();
  for (const chart of Object.values(deck.charts)) {
    report.chartsSeen++;
    const fp = fingerprint(chart);
    const m = match(fp, map);
    if (!m.matched) {
      report.unmatched.push({ ...fp, candidates: m.candidates, reason: m.reason });
      continue;
    }
    matches.push({ chart, fp, m });
    if (!byGroup.has(m.group.id)) byGroup.set(m.group.id, []);
    byGroup.get(m.group.id).push({ chart, m });
  }
  for (const [id, list] of byGroup) {
    if (list.length < 2) continue;
    report.refused.push({
      kind: "duplicateMatch", id, keys: list[0].m.group.entries.map((e) => e.key),
      charts: list.map((x) => ({ chart: x.chart.id, slide: x.chart.slideIndex, heading: x.chart.heading, via: x.m.via, score: x.m.score })),
      note: "two charts of this edition match one map group; neither is read until the map names which chart the keys mean",
    });
  }

  for (const { chart, fp, m } of matches) {
    if (byGroup.get(m.group.id).length > 1) continue;
    const g = m.group;
    report.matched.push({ chart: chart.id, slide: chart.slideIndex, id: g.id, via: m.via, score: m.score, heading: chart.heading });
    if (m.via === "fallback") report.fallbackMatched.push({ chart: chart.id, slide: chart.slideIndex, id: g.id, oldHeading: g.fingerprint.heading, newHeading: chart.heading, score: m.score });
    const mismatch = signalMismatch(fp, g, m);
    if (mismatch) report.signalMismatch.push({ chart: chart.id, slide: chart.slideIndex, ...mismatch });
    for (const d of chart.droppedSeries) report.dropped.push({ chart: chart.id, slide: chart.slideIndex, id: g.id, series: d.name, valRef: d.valRef, reason: d.reason, cachedPoints: d.cachedPoints !== undefined ? d.cachedPoints : d.points.filter((p) => p.val !== null).length, ...(d.ptCount !== undefined && d.reason === "ptCountAbsurd" ? { ptCount: d.ptCount } : {}) });

    /* periods: on the categories, or on the series names */
    const asOf = chart.asOf;
    let catPeriods = null;
    if (fp.orientation === "categories") {
      const cats = chart.series[0].points.map((p) => p.cat);
      catPeriods = cats.map((label) => {
        const per = parsePeriod(label, { asOf });
        if (!per) { report.refused.push({ chart: chart.id, slide: chart.slideIndex, kind: "unparsedCategory", label }); return null; }
        if (per.needsAsOf) { report.refused.push({ chart: chart.id, slide: chart.slideIndex, kind: "asOfMissing", label }); return null; }
        return per;
      });
    } else if (fp.orientation !== "series") {
      report.refused.push({ chart: chart.id, slide: chart.slideIndex, kind: "noPeriodAxis", seriesNames: fp.seriesNames, firstCat: fp.firstCat });
      continue;
    }

    const byName = new Map(chart.series.map((s) => [normSeries(s.name), s]));
    const template = g.entries.find((e) => e.keyPattern) || null;
    const pointsOf = (s, per) => {
      const out = [];
      for (const pt of s.points) {
        if (pt.val === null || pt.val === undefined) continue;
        if (typeof pt.val !== "number") { report.refused.push({ chart: chart.id, kind: "nonNumeric", series: s.name, idx: pt.idx, value: pt.val }); continue; }
        if (fp.orientation === "categories") {
          const p = catPeriods[pt.idx];
          if (!p) continue;
          out.push({ ...windowFields(p), v: pt.val });
        } else {
          out.push({ ...windowFields(per), c: pt.cat, v: pt.val });
        }
      }
      return out;
    };
    const metaOf = (entry, s, key) => ({
      key, label: entry.label, unit: entry.unit, cadence: entry.cadence, geography: chart.geography || entry.geography, population: entry.population,
      source: entry.source, group: entry.group, fingerprintId: g.id, asOf, edition: deck.edition, publishedAt: deck.publishedAt,
      locator: { slide: chart.slideIndex, chart: chart.id, heading: chart.heading, series: s.name, sheetRef: s.sheetRef },
      notes: chart.footnote || undefined, restatementNote: entry.restatementNote, accumulates: entry.accumulates || undefined,
    });
    /* the series' own value axis against the scale the map states for
       its key: a heading that still matches with the axis moved from a
       literal percent to Excel percent, or from money to General, would
       serve the cache a hundred times off under the right unit */
    const valAxOf = (s) => chart.axes.find((a) => a.kind === "valAx" && s.axIds.includes(a.axId));
    const refusedNames = new Set();
    const unitCheck = (entry, s, key) => {
      const ax = valAxOf(s);
      const expected = scaleClass(entry.scale);
      const observed = formatClass(ax ? ax.numFmt : null);
      const where = { chart: chart.id, slide: chart.slideIndex, id: g.id, key, series: s.name };
      if (!expected) report.refused.push({ ...where, kind: "scaleUnknown", scale: entry.scale, note: "the map entry's scale is not one the axis check knows" });
      else if (!observed) report.refused.push({ ...where, kind: "axisMissing", note: "the series is on no value axis of the chart, so its scale cannot be checked" });
      else if (observed !== expected) report.refused.push({ ...where, kind: "unitMismatch", unit: entry.unit, scale: entry.scale, expectedFormat: expected, observedFormat: observed, numFmt: ax.numFmt, mapFormats: g.fingerprint.axisFormats, chartFormats: fp.axisFormats });
      else return true;
      refusedNames.add(normSeries(s.name));
      return false;
    };

    for (const s of chart.series) {
      if (s.blanks.length) report.blanks.push({ chart: chart.id, slide: chart.slideIndex, series: s.name, idx: s.blanks, cats: s.blanks.map((b) => s.points[b].cat) });
      let entry = entryForSeries(g, s.name);
      let key = entry ? entry.key : null;
      let per = null;
      if (fp.orientation === "series") {
        per = parsePeriod(s.name, { asOf });
        if (per && per.needsAsOf) { report.refused.push({ chart: chart.id, kind: "asOfMissing", label: s.name }); continue; }
        if (template && per) {
          key = template.keyPattern.replace("{period}", periodSlug(per, template.periodSlug));
          const exact = g.entries.find((e) => e.key === key);
          if (exact) entry = exact;
          else {
            entry = { ...template, key, label: template.label.replace(template.series, s.name), series: s.name };
            report.generatedKeys.push({ chart: chart.id, id: g.id, key, series: s.name, from: template.key });
          }
        }
      }
      if (!entry) { report.unmatchedSeries.push({ chart: chart.id, slide: chart.slideIndex, id: g.id, series: s.name, sheetRef: s.sheetRef }); continue; }
      if (entry.derive) continue; /* recomputed below */
      if (!unitCheck(entry, s, key)) continue;
      const pts = pointsOf(s, per);
      if (entry.duplicateOf) {
        dupChecks.push({ entry, chart, s, pts, meta: metaOf(entry, s, entry.key) });
        continue;
      }
      series[key] = { ...metaOf(entry, s, key), points: pts };
      if (entry.crossCheck && entry.crossCheck.kind === "sumOfQuarters") sumChecks.push({ key, of: entry.crossCheck.of, chart: chart.id });
    }

    /* derived series: the arithmetic on two live series, the cache as the check */
    for (const entry of g.entries) {
      if (!entry.derive) continue;
      const a = byName.get(normSeries(entry.derive.from[0]));
      const b = byName.get(normSeries(entry.derive.from[1]));
      if (!a || !b) { report.refused.push({ chart: chart.id, kind: "deriveInputMissing", key: entry.key, from: entry.derive.from }); continue; }
      /* an input refused on its axis scale takes the arithmetic with it */
      if (refusedNames.has(normSeries(a.name)) || refusedNames.has(normSeries(b.name))) { report.refused.push({ chart: chart.id, slide: chart.slideIndex, id: g.id, kind: "deriveInputRefused", key: entry.key, from: entry.derive.from }); continue; }
      const pa = pointsOf(a), pb = pointsOf(b);
      const bByDate = new Map(pb.map((pt) => [pt.p + "|" + pt.g, pt]));
      const pts = [];
      for (const pt of pa) {
        const other = bByDate.get(pt.p + "|" + pt.g);
        if (!other) continue;
        pts.push({ ...pt, v: entry.derive.op === "minus" ? pt.v - other.v : pt.v + other.v });
      }
      const cached = entry.derive.crossCheck ? byName.get(normSeries(entry.derive.crossCheck)) : null;
      let checked = null;
      if (cached) {
        const cpts = pointsOf(cached);
        const cBy = new Map(cpts.map((pt) => [pt.p + "|" + pt.g, pt.v]));
        const diffs = pts.filter((pt) => cBy.has(pt.p + "|" + pt.g) && Math.abs(pt.v - cBy.get(pt.p + "|" + pt.g)) > 1e-6 * Math.max(1, Math.abs(pt.v)));
        checked = { series: cached.name, compared: pts.filter((pt) => cBy.has(pt.p + "|" + pt.g)).length, differing: diffs.map((pt) => ({ p: pt.p, computed: pt.v, cached: cBy.get(pt.p + "|" + pt.g) })) };
        if (diffs.length) report.warnings.push({ chart: chart.id, kind: "derivedMismatch", key: entry.key, differing: checked.differing });
      }
      series[entry.key] = { ...metaOf(entry, cached || a, entry.key), formula: entry.formula, derivedFrom: entry.derive.from, points: pts };
      report.derived.push({ chart: chart.id, key: entry.key, formula: entry.formula, points: pts.length, crossCheck: checked });
    }

    /* the EMF deal tables live on slides with no chart; handled below */
  }

  /* duplicates: identical to a canonical series, or written and flagged.
     The catalog key of a duplicate is still a key in the output, as an
     alias entry with no points of its own, so every catalog key resolves
     while the series is stored once. */
  for (const d of dupChecks) {
    const canon = series[d.entry.duplicateOf];
    const byDate = canon ? new Map(canon.points.map((pt) => [pt.p + "|" + pt.g, pt.v])) : new Map();
    const compared = d.pts.filter((pt) => byDate.has(pt.p + "|" + pt.g));
    const differing = compared.filter((pt) => !near(pt.v, byDate.get(pt.p + "|" + pt.g)));
    const rec = { key: d.entry.key, duplicateOf: d.entry.duplicateOf, chart: d.chart.id, series: d.s.name, points: d.pts.length, compared: compared.length, differing: differing.length, written: false };
    if (!canon || differing.length) {
      rec.written = true;
      rec.reason = !canon ? "canonical series absent from this edition" : "values diverged from the canonical series";
      series[d.entry.key] = { ...d.meta, points: d.pts };
      report.warnings.push({ chart: d.chart.id, kind: "duplicateDiverged", ...rec });
    } else {
      series[d.entry.key] = { ...d.meta, alias: d.entry.duplicateOf, crossChecks: [{ kind: "duplicate", of: d.entry.duplicateOf, chart: d.chart.id, series: d.s.name, equal: true, compared: compared.length }], points: [] };
    }
    report.duplicatesSkipped.push(rec);
    if (canon && !canon.crossChecks) canon.crossChecks = [];
    if (canon) canon.crossChecks.push({ kind: "duplicate", chart: d.chart.id, series: d.s.name, equal: differing.length === 0, compared: compared.length });
  }

  /* annual bars against the sum of their quarters */
  for (const c of sumChecks) {
    const annual = series[c.key], quarterly = series[c.of];
    if (!annual || !quarterly) { report.crossChecks.push({ kind: "sumOfQuarters", key: c.key, of: c.of, checked: 0, note: "quarterly series absent" }); continue; }
    const rows = [];
    for (const pt of annual.points) {
      if (pt.g !== "year") continue;
      const y = pt.p.slice(0, 4);
      const qs = quarterly.points.filter((q) => q.g === "quarter" && q.p.startsWith(y));
      if (qs.length !== 4) continue;
      const sum = qs.reduce((n, q) => n + q.v, 0);
      rows.push({ year: y, annual: pt.v, sumOfQuarters: sum, equal: Math.abs(sum - pt.v) <= 1e-6 * Math.max(1, Math.abs(pt.v)) });
    }
    const rec = { kind: "sumOfQuarters", key: c.key, of: c.of, checked: rows.length, equal: rows.every((r) => r.equal), rows };
    report.crossChecks.push(rec);
    annual.crossChecks = [...(annual.crossChecks || []), { kind: "sumOfQuarters", of: c.of, years: rows.length, equal: rec.equal }];
    if (!rec.equal) report.warnings.push({ kind: "sumOfQuartersMismatch", key: c.key, rows: rows.filter((r) => !r.equal) });
  }

  /* the EMF deal tables: identified by their header cells, never by slide number */
  for (const slide of deck.slides) {
    for (const t of slide.emfTables) {
      const header = t.header.map((h) => h.toLowerCase());
      let slug;
      if (header.some((h) => /debt being refinanced/.test(h))) slug = "lcd-dl-refinanced-in-bsl";
      else if (header.some((h) => /lender/.test(h))) slug = "lcd-bsl-replaced-by-dl";
      else slug = "lcd-table-" + (slide.headline || "slide-" + slide.index).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
      const roles = rolesFor(slide.shapes, t.box, false);
      const table = {
        slug, edition: deck.edition, vintage: options.vintage || null, publishedAt: deck.publishedAt, asOf: slide.asOf,
        slide: slide.index, headline: slide.headline, title: titleAbove(slide, t.box), sourceLine: slide.sourceLine, footnote: roles.footnote,
        recoveredFrom: t.picture + " (EMR_EXTTEXTOUTW records, " + t.strings + " strings)", header: t.header, rows: t.rows,
      };
      const hand = options.hand && options.hand.tables ? Object.values(options.hand.tables).find((h) => h.slide === slide.index || (h.header || []).join("|") === t.header.join("|")) : null;
      if (hand) {
        const diffs = [];
        const rowsN = Math.max(hand.rows.length, t.rows.length);
        if ((hand.header || []).join("|") !== t.header.join("|")) diffs.push({ row: "header", deck: t.header, hand: hand.header });
        for (let i = 0; i < rowsN; i++) {
          const a = t.rows[i] || [], b = hand.rows[i] || [];
          for (let j = 0; j < Math.max(a.length, b.length); j++) if ((a[j] || "") !== (b[j] || "")) diffs.push({ row: i + 1, col: j + 1, deck: a[j], hand: b[j] });
        }
        table.handKeyedCheck = { file: options.handFile || null, cellsCompared: rowsN * t.header.length, differing: diffs };
        if (diffs.length) report.warnings.push({ kind: "tableMismatch", slug, differing: diffs });
      }
      tables[slug] = table;
      report.tables.push({ slug, slide: slide.index, rows: t.rows.length, columns: t.header.length, handKeyedCheck: table.handKeyedCheck ? table.handKeyedCheck.differing.length === 0 : null });
    }
  }

  const asOfs = Object.values(deck.charts).map((c) => c.asOf).filter(Boolean).sort();
  return {
    id: options.vintage || null, source: "lcd-monitor", edition: deck.edition, publishedAt: deck.publishedAt,
    asOf: asOfs.length ? asOfs[asOfs.length - 1] : null, file: options.file || null, sha256: options.sha256 || null,
    replaces: true, series, tables, report,
  };
}

/* ---------- the workbook ---------- */
const normText = (s) => (s === null || s === undefined ? "" : String(s).replace(/\s+/g, " ").trim());
const SCALE_DIV = { usd_b: 1e9, usd_m: 1e6 };

function cellNumber(text, entry, report, where) {
  const v = parseCellValue(text);
  if (!v) return null;
  if (v.kind === "money") {
    const div = SCALE_DIV[entry.scale];
    if (!div) { report.unparsedCells.push({ ...where, text, reason: "money in a " + entry.scale + " column" }); return null; }
    return v.value / div;
  }
  if (v.kind === "percent") {
    if (entry.scale !== "fraction") { report.unparsedCells.push({ ...where, text, reason: "percent in a " + entry.scale + " column" }); return null; }
    return v.value;
  }
  if (v.kind === "number") {
    if (entry.scale === "usd_b" || entry.scale === "usd_m") { report.unparsedCells.push({ ...where, text, reason: "a bare number in a money column" }); return null; }
    return v.value;
  }
  report.unparsedCells.push({ ...where, text, reason: v.kind });
  return null;
}

/**
 * extractWorkbook(workbook, map, { vintage, file, sha256 }) → a vintage.
 * A year row whose year is the download's year is a year-to-date point
 * ending on the download date and flagged partial; snapshot sheets are
 * dated by the download date; list sheets become tables.
 */
export function extractWorkbook(workbook, map, options = {}) {
  const report = { sheetsSeen: 0, matched: [], fallbackMatched: [], unmatched: [], skipped: [], filterMismatch: [], unparsedCells: [], refused: [], signalMismatch: [], tables: [], warnings: [] };
  const series = {};
  const tables = {};
  let downloaded = null;
  /* first pass: identify every data sheet; one sheet per map group per export, as for the deck */
  const matches = [];
  const byGroup = new Map();
  for (const sheet of workbook.sheets) {
    report.sheetsSeen++;
    if (sheet.kind !== "data") { report.skipped.push({ sheet: sheet.name, kind: sheet.kind, reason: sheet.kind === "disclaimer" ? "the license text, not data" : "no data frame" }); continue; }
    const fp = fingerprint(sheet);
    const m = match(fp, map);
    if (!m.matched) { report.unmatched.push({ ...fp, candidates: m.candidates, reason: m.reason }); continue; }
    matches.push({ sheet, fp, m });
    if (!byGroup.has(m.group.id)) byGroup.set(m.group.id, []);
    byGroup.get(m.group.id).push({ sheet, fp, m });
  }
  for (const [id, list] of byGroup) {
    if (list.length < 2) continue;
    report.refused.push({
      kind: "duplicateMatch", id, keys: list[0].m.group.entries.map((e) => e.key),
      sheets: list.map((x) => ({ sheet: x.sheet.name, title: x.fp.heading, via: x.m.via, score: x.m.score })),
      note: "two sheets of this export match one map group; neither is read until the map names which sheet the keys mean",
    });
  }
  for (const { sheet, fp, m } of matches) {
    if (byGroup.get(m.group.id).length > 1) continue;
    const g = m.group;
    report.matched.push({ sheet: sheet.name, id: g.id, via: m.via, score: m.score, title: fp.heading });
    if (m.via === "fallback") report.fallbackMatched.push({ sheet: sheet.name, id: g.id, oldHeading: g.fingerprint.heading, newHeading: fp.heading, score: m.score });
    const mismatch = signalMismatch(fp, g, m);
    if (mismatch) report.signalMismatch.push({ sheet: sheet.name, ...mismatch });
    const frame = sheet.frame;
    downloaded = downloaded || frame.downloadedOn;
    const header = (frame.headerRow || []).map(normText);
    const colIndex = (name) => header.findIndex((h) => normSeries(h) === normSeries(name));
    for (const entry of g.entries) {
      /* the filter line is the population; a different export is refused, not merged */
      if (normText(entry.population) !== normText(frame.filterLine)) {
        report.filterMismatch.push({ sheet: sheet.name, key: entry.key, expected: entry.population, found: frame.filterLine });
        continue;
      }
      const meta = {
        key: entry.key, label: entry.label, unit: entry.unit, cadence: entry.cadence, geography: entry.geography,
        population: frame.filterLine, populationNote: entry.populationNote, source: entry.source, group: entry.group, fingerprintId: g.id,
        asOf: frame.downloadedOn, edition: frame.downloadedOn, publishedAt: workbook.created,
        locator: { sheet: sheet.name, title: frame.title, column: entry.column || null, member: entry.member || null, chartFilters: frame.chartFilters, currency: frame.currency },
        accumulates: entry.accumulates || undefined,
      };
      if (entry.table) {
        const cols = header.map((h, i) => ({ name: h, kind: sheet.rows.length ? (parseCellValue(sheet.rows[0][i]) || { kind: "empty" }).kind : "empty" }));
        tables[entry.table.slug] = {
          slug: entry.table.slug, key: entry.key, title: frame.title, label: entry.label, edition: frame.downloadedOn, vintage: options.vintage || null,
          downloadedOn: frame.downloadedOn, filterLine: frame.filterLine, chartFilters: frame.chartFilters, currency: frame.currency,
          columns: cols, header, rows: sheet.rows.map((r) => header.map((h, i) => (r[i] === undefined ? null : r[i]))),
        };
        report.tables.push({ slug: entry.table.slug, sheet: sheet.name, rows: sheet.rows.length });
        /* the catalog key resolves to the table file; the rows live there, not as points */
        series[entry.key] = { ...meta, table: "tables/" + entry.table.slug + ".json", points: [] };
        continue;
      }
      const col = colIndex(entry.column);
      if (col < 0) { report.refused.push({ sheet: sheet.name, key: entry.key, kind: "columnMissing", column: entry.column, header }); continue; }
      const memberCol = entry.memberColumn ? colIndex(entry.memberColumn) : -1;
      if (entry.memberColumn && memberCol < 0) { report.refused.push({ sheet: sheet.name, key: entry.key, kind: "memberColumnMissing", column: entry.memberColumn }); continue; }
      const yearCol = entry.periodColumn ? colIndex(entry.periodColumn) : -1;
      if (entry.periodColumn && yearCol < 0) { report.refused.push({ sheet: sheet.name, key: entry.key, kind: "periodColumnMissing", column: entry.periodColumn }); continue; }
      const pts = [];
      sheet.rows.forEach((row, i) => {
        if (memberCol >= 0 && normText(row[memberCol]) !== normText(entry.member)) return;
        const where = { sheet: sheet.name, key: entry.key, row: sheet.rowNumbers[i], column: entry.column };
        const v = cellNumber(row[col] === undefined ? null : row[col], entry, report, where);
        if (v === null) return;
        if (yearCol >= 0) {
          const per = parsePeriod(row[yearCol]);
          if (!per || per.grain !== "year") { report.refused.push({ ...where, kind: "unparsedYear", label: row[yearCol] }); return; }
          const y = per.end.slice(0, 4);
          if (frame.downloadedOn && frame.downloadedOn.startsWith(y)) pts.push({ p: frame.downloadedOn, g: "ytd", start: y + "-01-01", v, partial: true });
          else pts.push({ p: per.end, g: "year", v });
        } else {
          pts.push({ p: frame.downloadedOn, g: "asof", v });
        }
      });
      if (memberCol >= 0 && !pts.length) report.refused.push({ sheet: sheet.name, key: entry.key, kind: "memberMissing", member: entry.member });
      series[entry.key] = { ...meta, points: pts };
    }
  }
  return {
    id: options.vintage || null, source: "pb-fund-overview", edition: downloaded, publishedAt: workbook.created, asOf: downloaded,
    downloaded, file: options.file || null, sha256: options.sha256 || null, replaces: true, series, tables, report,
  };
}

/* ---------- the hand-keyed reports ---------- */
const SOURCE_OF_FILE = (name) => /^pitchbook-global-fundraising/.test(name) ? "pb-fundraising-report"
  : /^pitchbook-annual/.test(name) ? "pb-annual-reports" : /^lcd-monitor-.*-tables/.test(name) ? "lcd-monitor-tables" : "reports";

/**
 * validateReport(file, name) → [problems]. A point without a page, a
 * non-ISO date, a non-numeric value, a grain outside SERVED_GRAINS, an
 * unknown document or a repeated date and grain within a series is
 * refused with its key named.
 */
export function validateReport(file, name) {
  const problems = [];
  const docs = file.documents || {};
  for (const [key, s] of Object.entries(file.series || {})) {
    if (!s.unit) problems.push(key + ": no unit");
    const seen = new Set();
    for (const pt of s.points || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pt.p || "")) problems.push(key + ": point without an ISO period end (" + pt.p + ")");
      if (typeof pt.v !== "number" || !Number.isFinite(pt.v)) problems.push(key + ": non-numeric value at " + pt.p);
      if (!pt.g) problems.push(key + ": point without a grain at " + pt.p);
      else if (!SERVED_GRAINS.has(servedGrain(pt.g))) problems.push(key + ": grain " + pt.g + " at " + pt.p + " is not in the served vocabulary (" + [...SERVED_GRAINS].join(", ") + "; ttm reads as rolling12m)");
      if (!pt.page) problems.push(key + ": point without a page at " + pt.p);
      if (!pt.doc || !docs[pt.doc]) problems.push(key + ": point at " + pt.p + " names an unknown document " + pt.doc);
      const id = pt.p + "|" + pt.g;
      if (seen.has(id)) problems.push(key + ": two points at " + id);
      seen.add(id);
    }
  }
  if (/-tables\.json$/.test(name)) {
    for (const [k, t] of Object.entries(file.tables || {})) {
      if (!Array.isArray(t.header) || !Array.isArray(t.rows)) problems.push(k + ": a table needs header and rows");
    }
  }
  return problems;
}

/**
 * extractReport(file, name) → [vintage per document], ordered by the
 * document's as-of then its publication date, so a later edition that
 * restates an earlier one wins in the replay and the earlier value is
 * kept as a restatement with its page.
 */
export function extractReport(file, name) {
  const source = SOURCE_OF_FILE(name);
  const docs = file.documents || {};
  const out = [];
  if (!Object.keys(docs).length) throw new Error("extractReport: " + name + " has no documents block");
  const docIds = Object.keys(docs).sort((a, b) => String(docs[a].asOf).localeCompare(String(docs[b].asOf)) || String(docs[a].published || docs[a].pdfCreated || "").localeCompare(String(docs[b].published || docs[b].pdfCreated || "")));
  for (const id of docIds) {
    const d = docs[id];
    const series = {};
    for (const [key, s] of Object.entries(file.series || {})) {
      const pts = (s.points || []).filter((pt) => pt.doc === id).map((pt) => {
        const o = { p: pt.p, g: servedGrain(pt.g), v: pt.v, doc: id, page: pt.page };
        if (pt.start) o.start = pt.start;
        for (const f of ["provisional", "estimate", "approx"]) if (pt[f]) o[f] = true;
        return o;
      });
      if (!pts.length) continue;
      series[key] = {
        key, label: s.label, unit: servedUnit(s.unit), cadence: s.cadence, geography: s.geography, population: s.population,
        source, group: "reports", asOf: d.asOf, edition: d.edition, publishedAt: d.published || d.pdfCreated || null,
        locator: { file: name, document: d.title, doc: id }, catalogKey: s.catalogKey, notes: s.caveats, restatementNote: s.restatement,
        points: pts,
      };
    }
    const tables = {};
    for (const [k, t] of Object.entries(file.tables || {})) {
      if (t.doc && t.doc !== id) continue;
      if (!t.doc && docIds.length > 1) continue;
      tables[k.replace(/_/g, "-")] = { slug: k.replace(/_/g, "-"), key: k, edition: d.edition, vintage: d.downloaded || file.downloaded || null, asOf: t.asOf || d.asOf, ...t, doc: id, document: d.title, file: name };
    }
    out.push({
      id: d.downloaded || file.downloaded || null, source, edition: d.edition, publishedAt: d.published || d.pdfCreated || null, asOf: d.asOf,
      downloaded: d.downloaded || file.downloaded || null, file: name, sha256: d.sha256 || file.sha256 || null, document: d.title,
      series, tables, report: { series: Object.keys(series).length, points: Object.values(series).reduce((n, s) => n + s.points.length, 0), tables: Object.keys(tables).length },
    });
  }
  return out;
}

/* ---------- press ---------- */
/**
 * pressPeriod(label) → { p, g, start?, q? } for the press file's own
 * labels ("2020Q1", "2026H1", "CY2025", "YE2024", "end-2025", "2025-09",
 * "TTM to 2025Q1", "2026-02-27"); a qualifier in parentheses or after
 * the period ("2025 (by volume)", "end-2026 forecast") is carried as q.
 * A label that names no calendar point ("late 2024", "TTM to mid-June
 * 2026") keeps p null; the page draws it as a labeled point.
 */
export function pressPeriod(label) {
  const raw = String(label || "").trim();
  let m;
  const qual = (rest) => { const r = (rest || "").trim().replace(/^\((.*)\)$/, "$1").trim(); return r ? { q: r, ...(/forecast/i.test(r) ? { forecast: true } : {}) } : {}; };
  if ((m = /^(\d{4})Q([1-4])(.*)$/.exec(raw))) { const per = parsePeriod(m[2] + "Q" + m[1]); return { p: per.end, g: "quarter", start: per.start, ...qual(m[3]) }; }
  if ((m = /^(\d{4})H([12])(.*)$/.exec(raw))) { const per = parsePeriod(m[2] + "H" + m[1]); return { p: per.end, g: "half", start: per.start, ...qual(m[3]) }; }
  if ((m = /^CY(\d{4})(.*)$/.exec(raw)) || (m = /^(\d{4})(\s.*)?$/.exec(raw))) { const per = parsePeriod(m[1]); return { p: per.end, g: "year", start: per.start, ...qual(m[2]) }; }
  if ((m = /^(?:YE|end-)(\d{4})(.*)$/.exec(raw))) return { p: m[1] + "-12-31", g: "asof", ...qual(m[2]) };
  if ((m = /^(\d{4}-\d{2})(.*)$/.exec(raw)) && !/^\d{4}-\d{2}-\d{2}/.test(raw)) { const per = parsePeriod(m[1]); return { p: per.end, g: "month", start: per.start, ...qual(m[2]) }; }
  if ((m = /^(\d{4}-\d{2}-\d{2})$/.exec(raw))) return { p: m[1], g: "asof" };
  if ((m = /^TTM to (\d{4})Q([1-4])$/.exec(raw))) { const per = parsePeriod(m[2] + "Q" + m[1]); const t = parsePeriod("TTM", { asOf: per.end }); return { p: t.end, g: "rolling12m", start: t.start }; }
  if ((m = /^TTM to (\d{4}-\d{2})$/.exec(raw))) { const per = parsePeriod(m[1]); const t = parsePeriod("TTM", { asOf: per.end }); return { p: t.end, g: "rolling12m", start: t.start }; }
  if ((m = /^TTM to (\d{4}-\d{2}-\d{2})$/.exec(raw))) { const t = parsePeriod("TTM", { asOf: m[1] }); return { p: t.end, g: "rolling12m", start: t.start }; }
  return { p: null, g: "label" };
}

/** extractPress(file) → one vintage dated by the file's check date */
export function extractPress(file) {
  const series = {};
  const vintage = (file.checked && file.checked.at) || file.generated || null;
  for (const s of file.series || []) {
    series[s.key] = {
      key: s.key, label: s.label, unit: servedUnit(s.unit), cadence: s.cadence, geography: s.geography || "US", population: s.definition ? s.definition.slice(0, 200) : undefined,
      publisher: s.publisher, source: "press", group: "press", asOf: null, edition: vintage, publishedAt: null,
      locator: { file: "frontend/data/pc/press-series.json" }, notes: s.caveats,
      points: (s.points || []).map((pt) => ({ ...pressPeriod(pt.period), label: pt.period, v: pt.value, url: pt.url, ...(pt.check ? { status: pt.check.status } : {}) })),
    };
    const dated = series[s.key].points.filter((pt) => pt.p).map((pt) => pt.p).sort();
    series[s.key].asOf = dated.length ? dated[dated.length - 1] : null;
  }
  return { id: vintage, source: "press", edition: vintage, publishedAt: null, asOf: vintage, downloaded: vintage, file: "frontend/data/pc/press-series.json", sha256: null, series, tables: {}, report: { series: Object.keys(series).length } };
}

/* ---------- the replay ---------- */
/**
 * build(vintages) → { keys, restatements, stale, tables, replayed }
 * vintages are replayed in the order given (oldest first). For every key
 * and dated point the newest vintage's value stands; a superseded value
 * that differs is recorded in restatements with both vintages and
 * editions. A key present in an earlier vintage of a source but absent
 * from that source's newest vintage is flagged stale with its last-seen
 * edition and the map group it was read through. The one exception is
 * a key that accumulates by design (a snapshot or window series) whose
 * chart or sheet was matched and read in the newest vintage: that key
 * rolled off the chart (3Q25 after 3Q26 appears) and is not stale. An
 * accumulating key whose chart went unmatched, or was refused, is stale
 * like any other, so its old points are never drawn as current.
 */
export function build(vintages) {
  const keys = {};
  const restated = new Map();
  const tables = {};
  const lastSeen = {};
  const newestOfSource = {};
  for (const v of vintages) newestOfSource[v.source] = v;
  /* the map groups a vintage read: the charts and sheets in report.matched */
  const groupsRead = (v) => new Set(((v.report && v.report.matched) || []).map((m) => m.id).filter(Boolean));

  for (const v of vintages) {
    for (const [key, s] of Object.entries(v.series)) {
      const meta = cloneMeta(s);
      /* an alias carries no points of its own; the canonical key holds the history */
      const prior = keys[key] && !s.alias ? keys[key].points : [];
      const target = (keys[key] = { ...meta, vintage: v.id, points: [] });
      const index = new Map(prior.map((pt) => [pointId(key, pt), pt]));
      for (const pt of s.points) {
        const id = pointId(key, pt);
        const prev = index.get(id);
        const next = { ...pt, vintage: v.id, edition: s.edition || v.edition };
        if (prev && !near(prev.v, next.v)) {
          const rid = key + "|" + (pt.p || pt.label) + "|" + pt.g + "|" + (pt.c || "");
          let r = restated.get(rid);
          if (!r) { r = { key, date: pt.p || null, label: pt.p ? undefined : pt.label, grain: pt.g, category: pt.c, values: [{ vintage: prev.vintage, edition: prev.edition, value: prev.v, page: prev.page, doc: prev.doc }] }; restated.set(rid, r); }
          r.values.push({ vintage: v.id, edition: next.edition, value: next.v, page: next.page, doc: next.doc });
        }
        index.set(id, next);
      }
      target.points = sortPoints([...index.values()]);
      lastSeen[key] = { vintage: v.id, edition: s.edition || v.edition, source: v.source, accumulates: !!s.accumulates, fingerprintId: s.fingerprintId || null };
    }
    for (const [slug, t] of Object.entries(v.tables || {})) {
      const entry = tables[slug] || (tables[slug] = { slug, title: t.title || t.label || slug, editions: [] });
      entry.title = t.title || t.label || entry.title;
      entry.editions = entry.editions.filter((e) => !(e.edition === t.edition && e.vintage === t.vintage));
      entry.editions.push(t);
    }
  }
  const stale = [];
  for (const [key, seen] of Object.entries(lastSeen)) {
    const newest = newestOfSource[seen.source];
    if (!newest || !newest.replaces || newest.id === seen.vintage || newest.series[key]) continue;
    const read = seen.fingerprintId ? groupsRead(newest).has(seen.fingerprintId) : false;
    if (seen.accumulates && read) continue; /* rolled off a chart that was read: by design */
    const edition = newest.edition || newest.id;
    const reason = read
      ? "absent from the " + edition + " edition of " + seen.source + ": its chart or sheet (" + seen.fingerprintId + ") was read but carried no point for this key (see that edition's unmatchedSeries and refused lines)"
      : "not found in the " + edition + " edition of " + seen.source + (seen.fingerprintId ? ": its chart or sheet (" + seen.fingerprintId + ") was not matched or was refused" : "");
    keys[key].stale = { lastSeenEdition: seen.edition, lastSeenVintage: seen.vintage, fingerprintId: seen.fingerprintId || undefined, groupRead: read, reason };
    stale.push({ key, ...keys[key].stale });
  }
  for (const t of Object.values(tables)) t.editions.sort((a, b) => String(b.vintage || "").localeCompare(String(a.vintage || "")) || String(b.edition || "").localeCompare(String(a.edition || "")));
  const restatements = [...restated.values()].map((r) => { const o = { ...r }; for (const v of o.values) { if (!v.page) delete v.page; if (!v.doc) delete v.doc; } if (o.category === undefined) delete o.category; if (o.label === undefined) delete o.label; return o; });
  return { keys, restatements, stale, tables, replayed: vintages.map((v) => ({ id: v.id, source: v.source, edition: v.edition, keys: Object.keys(v.series).length })) };
}

/* ---------- derived capital metrics ---------- */
const at = (s, p, g) => s && s.points.find((pt) => pt.p === p && pt.g === g);
const yearPoints = (s) => (s ? s.points.filter((pt) => pt.g === "year") : []);
const latest = (s, g) => { const pts = s ? s.points.filter((pt) => !g || pt.g === g) : []; return pts.length ? pts[pts.length - 1] : null; };
const round = (x, d) => Math.round(x * Math.pow(10, d)) / Math.pow(10, d);

/**
 * derive(keys, options) → { keys: { <derived key>: series }, report: [...] }
 * Every metric of blueprint 3.4 that is arithmetic on ingested series,
 * each with its formula and inputs written into the key; an input the
 * vintages do not carry leaves the metric out with a report line, never
 * a typed number.
 */
export function derive(keys, options = {}) {
  const out = {};
  const report = [];
  /* an input is an ingested key or a derived key made earlier in this
     pass, so a chained metric (the CAGR on the derived AUM, years of dry
     powder on the derived deployment) inherits the newest input's as-of
     and vintage the same way a first-order one does */
  const src = (k) => keys[k] || out[k];
  const vintageOf = (...inputs) => inputs.map((k) => src(k) && src(k).vintage).filter(Boolean).sort().pop() || null;
  const skip = (key, inputs) => report.push({ key, skipped: true, reason: "inputs absent: " + inputs.filter((k) => !src(k)).join(", ") });
  const make = (key, spec, points, inputs) => {
    if (!points.length) { report.push({ key, skipped: true, reason: inputs.some((k) => !src(k)) ? "inputs absent: " + inputs.filter((k) => !src(k)).join(", ") : "no overlapping periods" }); return; }
    const asOf = inputs.map((k) => src(k) && src(k).asOf).filter(Boolean).sort().pop() || null;
    out[key] = { key, ...spec, source: "derived", group: spec.group || "pb-capital", inputs, asOf, edition: null, publishedAt: null, vintage: vintageOf(...inputs), points: sortPoints(points.map((pt) => ({ ...pt, vintage: vintageOf(...inputs) }))) };
    report.push({ key, points: points.length, formula: spec.formula });
  };

  /* US private debt raised by type: the total and direct lending's share */
  const types = Object.keys(keys).filter((k) => /^pb_us_private_debt_raised_.*_annual$/.test(k)).sort();
  if (!types.length) { skip("derived_us_private_debt_raised_total_annual", ["pb_us_private_debt_raised_direct_lending_annual"]); skip("derived_us_dl_share_of_private_debt_raised", ["pb_us_private_debt_raised_direct_lending_annual"]); }
  if (types.length) {
    const byDate = new Map();
    for (const k of types) for (const pt of keys[k].points) {
      const id = pt.p + "|" + pt.g;
      const rec = byDate.get(id) || { p: pt.p, g: pt.g, start: pt.start, sum: 0, n: 0 };
      rec.sum += pt.v; rec.n++; byDate.set(id, rec);
    }
    const totals = [...byDate.values()].filter((r) => r.n === types.length).map((r) => ({ p: r.p, g: r.g, ...(r.start ? { start: r.start } : {}), v: r.sum }));
    make("derived_us_private_debt_raised_total_annual", { label: "US private debt capital raised, all types (annual and TTM)", unit: "$B", cadence: "annual", geography: "US", population: keys[types[0]].population, formula: "Σ of the nine chart series (venture debt, real estate debt, mezzanine, infrastructure debt, debt, distressed debt, direct lending, credit special situations, bridge financing), same period" }, totals, types);
    const dl = keys.pb_us_private_debt_raised_direct_lending_annual;
    if (dl && out.derived_us_private_debt_raised_total_annual) {
      const share = dl.points.map((pt) => { const t = at(out.derived_us_private_debt_raised_total_annual, pt.p, pt.g); return t && t.v ? { p: pt.p, g: pt.g, ...(pt.start ? { start: pt.start } : {}), v: pt.v / t.v } : null; }).filter(Boolean);
      make("derived_us_dl_share_of_private_debt_raised", { label: "Direct lending share of US private debt capital raised", unit: "share", cadence: "annual", geography: "US", population: dl.population, formula: "Direct lending ÷ Σ nine types, same period" }, share, ["pb_us_private_debt_raised_direct_lending_annual", "derived_us_private_debt_raised_total_annual"]);
    }
  }

  /* US direct-lending AUM, dry-powder share, CAGR */
  const dp = keys.pb_us_dl_dry_powder_annual, nav = keys.pb_us_dl_nav_annual;
  if (!dp || !nav) for (const k of ["derived_us_dl_aum_annual", "derived_us_dl_dry_powder_share_of_aum", "derived_us_dl_aum_cagr_10y", "derived_us_dl_aum_cagr_5y"]) skip(k, ["pb_us_dl_dry_powder_annual", "pb_us_dl_nav_annual"]);
  if (dp && nav) {
    const aum = yearPoints(dp).map((pt) => { const n = at(nav, pt.p, pt.g); return n ? { p: pt.p, g: pt.g, v: pt.v + n.v } : null; }).filter(Boolean);
    make("derived_us_dl_aum_annual", { label: "US direct lending AUM (dry powder + NAV), year-end", unit: "$B", cadence: "annual", geography: "US", population: dp.population, formula: "Dry powder + NAV, same year-end" }, aum, ["pb_us_dl_dry_powder_annual", "pb_us_dl_nav_annual"]);
    const share = yearPoints(dp).map((pt) => { const a = at(out.derived_us_dl_aum_annual, pt.p, pt.g); return a && a.v ? { p: pt.p, g: pt.g, v: pt.v / a.v } : null; }).filter(Boolean);
    make("derived_us_dl_dry_powder_share_of_aum", { label: "Dry powder share of US direct lending AUM", unit: "share", cadence: "annual", geography: "US", population: dp.population, formula: "Dry powder ÷ (dry powder + NAV), same year-end" }, share, ["pb_us_dl_dry_powder_annual", "derived_us_dl_aum_annual"]);
    for (const years of [10, 5]) {
      const pts = aum.map((pt) => { const y = +pt.p.slice(0, 4); const base = aum.find((b) => +b.p.slice(0, 4) === y - years); return base && base.v > 0 ? { p: pt.p, g: "window", start: base.p, v: Math.pow(pt.v / base.v, 1 / years) - 1 } : null; }).filter(Boolean);
      make("derived_us_dl_aum_cagr_" + years + "y", { label: "US direct lending AUM growth, " + years + "-year CAGR", unit: "share", cadence: "annual", geography: "US", population: dp.population, formula: "(AUM_end ÷ AUM_start)^(1 ÷ " + years + ") − 1, a fraction per year" }, pts, ["derived_us_dl_aum_annual"]);
    }
  }

  /* deployment: LCD direct-lending volume and count over the trailing twelve months */
  for (const [src, key, label] of [["lcd_dl_volume_annual", "derived_dl_deployment_ttm", "Direct lending estimated volume, trailing twelve months"], ["lcd_dl_count_annual", "derived_dl_deployment_count_ttm", "Direct lending deal count, trailing twelve months"]]) {
    const s = keys[src];
    if (!s) { report.push({ key, skipped: true, reason: "inputs absent: " + src }); continue; }
    const ytd = s.points.filter((pt) => pt.g === "ytd").sort((a, b) => a.p.localeCompare(b.p));
    const pts = [];
    for (const cur of ytd) {
      const y = +cur.p.slice(0, 4);
      const prev = ytd.find((pt) => pt.p === (y - 1) + cur.p.slice(4));
      const full = at(s, (y - 1) + "-12-31", "year");
      if (!prev || !full) continue;
      const win = parsePeriod("TTM", { asOf: cur.p });
      pts.push({ p: cur.p, g: "rolling12m", start: win.start, v: cur.v + (full.v - prev.v) });
    }
    make(key, { label, unit: s.unit, cadence: "annual", geography: "US", population: s.population, formula: "YTD (this year) + (full prior year − YTD prior year to the same date), from the annual chart" }, pts, [src]);
  }

  /* years of dry powder: the trailing window and the calendar variant */
  if (!dp || !out.derived_dl_deployment_ttm) skip("derived_dl_years_of_dry_powder", ["pb_us_dl_dry_powder_annual", "derived_dl_deployment_ttm"]);
  if (dp && out.derived_dl_deployment_ttm) {
    const d = latest(dp, "year"), t = latest(out.derived_dl_deployment_ttm);
    const pts = d && t && t.v ? [{ p: t.p, g: t.g, start: t.start, v: d.v / t.v, dryPowderAsOf: d.p }] : [];
    make("derived_dl_years_of_dry_powder", { label: "Years of dry powder (US direct lending dry powder ÷ trailing twelve-month direct lending volume)", unit: "years", cadence: "snapshot", geography: "US", population: "PitchBook US direct lending dry powder against LCD estimated new-issue volume: different universes, direction only", formula: "Dry powder at the latest year-end ÷ direct lending volume over the trailing twelve months (mixed as-of dates, stated on the point)" }, pts, ["pb_us_dl_dry_powder_annual", "derived_dl_deployment_ttm"]);
  }
  const vol = keys.lcd_dl_volume_annual;
  if (!dp || !vol) skip("derived_dl_years_of_dry_powder_calendar", ["pb_us_dl_dry_powder_annual", "lcd_dl_volume_annual"]);
  if (dp && vol) {
    const pts = yearPoints(dp).map((pt) => { const v = at(vol, pt.p, "year"); return v && v.v ? { p: pt.p, g: "year", v: pt.v / v.v } : null; }).filter(Boolean);
    make("derived_dl_years_of_dry_powder_calendar", { label: "Years of dry powder, calendar variant (year-end dry powder ÷ same-year direct lending volume)", unit: "years", cadence: "annual", geography: "US", population: "PitchBook US direct lending dry powder against LCD estimated new-issue volume: different universes, direction only", formula: "Dry powder at year-end ÷ direct lending estimated volume of the same year" }, pts, ["pb_us_dl_dry_powder_annual", "lcd_dl_volume_annual"]);
  }

  /* fundraising minus deployment, all US private debt and direct lending only */
  const total = out.derived_us_private_debt_raised_total_annual;
  if (!total || !vol) skip("derived_fundraising_minus_deployment_annual", ["derived_us_private_debt_raised_total_annual", "lcd_dl_volume_annual"]);
  if (total && vol) {
    const pts = yearPoints(total).map((pt) => { const v = at(vol, pt.p, "year"); return v ? { p: pt.p, g: "year", v: pt.v - v.v } : null; }).filter(Boolean);
    make("derived_fundraising_minus_deployment_annual", { label: "US private debt raised minus direct lending volume, same year", unit: "$B", cadence: "annual", geography: "US", population: "PitchBook US private debt funds closed against LCD estimated direct lending volume: a supply-demand sign, not a shortage", formula: "Σ nine US private debt types raised − LCD direct lending estimated volume, same calendar year" }, pts, ["derived_us_private_debt_raised_total_annual", "lcd_dl_volume_annual"]);
  }
  const dlRaised = keys.pb_us_private_debt_raised_direct_lending_annual;
  if (!dlRaised || !vol) skip("derived_dl_fundraising_minus_deployment_annual", ["pb_us_private_debt_raised_direct_lending_annual", "lcd_dl_volume_annual"]);
  if (dlRaised && vol) {
    const pts = yearPoints(dlRaised).map((pt) => { const v = at(vol, pt.p, "year"); return v ? { p: pt.p, g: "year", v: pt.v - v.v } : null; }).filter(Boolean);
    make("derived_dl_fundraising_minus_deployment_annual", { label: "US direct lending raised minus direct lending volume, same year", unit: "$B", cadence: "annual", geography: "US", population: "PitchBook US direct lending funds closed against LCD estimated direct lending volume", formula: "Direct lending capital raised − LCD direct lending estimated volume, same calendar year" }, pts, ["pb_us_private_debt_raised_direct_lending_annual", "lcd_dl_volume_annual"]);
  }

  /* the global report series: the $200B run, average fund size */
  const capKey = options.fundraisingKey || "pb_pd_fundraising_capital_q2_2026ed";
  const cntKey = options.fundCountKey || "pb_pd_fund_count_q2_2026ed";
  const cap = keys[capKey], cnt = keys[cntKey];
  if (!cap) skip("derived_pd_fundraising_200b_run", [capKey]);
  if (!cap || !cnt) skip("derived_pd_avg_fund_size", [capKey, cntKey]);
  if (cap) {
    const years = yearPoints(cap).sort((a, b) => a.p.localeCompare(b.p));
    let run = 0; const inRun = [];
    for (let i = years.length - 1; i >= 0; i--) { if (years[i].v >= 200) { run++; inRun.unshift(years[i].p.slice(0, 4)); } else break; }
    const last = years[years.length - 1];
    make("derived_pd_fundraising_200b_run", { label: "Consecutive years of global private debt fundraising at or above $200B", unit: "years", cadence: "annual", geography: cap.geography, population: cap.population, formula: "Count back from the latest full year while capital raised ≥ 200 ($B), on the report cut named in inputs", years: inRun, threshold: 200 }, last ? [{ p: last.p, g: "year", v: run }] : [], [capKey]);
  }
  if (cap && cnt) {
    const pts = cap.points.map((pt) => { const c = at(cnt, pt.p, pt.g); return c && c.v ? { p: pt.p, g: pt.g, ...(pt.start ? { start: pt.start } : {}), v: (pt.v * 1000) / c.v } : null; }).filter(Boolean);
    make("derived_pd_avg_fund_size", { label: "Average private debt fund size closed ($M), global report series", unit: "$M", cadence: "annual", geography: cap.geography, population: cap.population, formula: "Capital raised ($B × 1000) ÷ fund count, same period and same report cut" }, pts, [capKey, cntKey]);
  }

  /* TTM fundraising rank and share among strategies, from the report's own table */
  const table = options.tables && options.tables["pb-ttm-fundraising-by-strategy-2026q2"];
  const ttm = keys.pb_pd_fundraising_ttm;
  if (table && ttm) {
    const ed = table.editions ? table.editions[0] : table;
    const hi = ed.header.indexOf("strategy"), ci = ed.header.indexOf("capitalRaised");
    const rows = ed.rows.filter((r) => !/^private capital$/i.test(r[hi]));
    const totalRow = ed.rows.find((r) => /^private capital$/i.test(r[hi]));
    const sorted = [...rows].sort((a, b) => b[ci] - a[ci]);
    const rank = sorted.findIndex((r) => /^private debt$/i.test(r[hi])) + 1;
    const pd = rows.find((r) => /^private debt$/i.test(r[hi]));
    const t = latest(ttm);
    if (rank && pd && t) {
      make("derived_pd_fundraising_ttm_rank", { label: "Private debt's rank among strategies by trailing twelve-month fundraising", unit: "rank", cadence: "snapshot", geography: ttm.geography, population: ttm.population, formula: "Position of private debt when the report's strategy table is sorted by TTM capital raised (the private-capital total row excluded)", of: rows.length }, [{ p: t.p, g: t.g, start: t.start, v: rank }], ["pb_pd_fundraising_ttm"]);
      if (totalRow && totalRow[ci]) make("derived_pd_fundraising_ttm_share_of_private_capital", { label: "Private debt share of trailing twelve-month private capital fundraising", unit: "share", cadence: "snapshot", geography: ttm.geography, population: ttm.population, formula: "Private debt TTM capital ÷ private capital TTM total, both from the report's strategy table" }, [{ p: t.p, g: t.g, start: t.start, v: pd[ci] / totalRow[ci] }], ["pb_pd_fundraising_ttm"]);
    }
  } else { report.push({ key: "derived_pd_fundraising_ttm_rank", skipped: true, reason: "inputs absent: the report's strategy table or pb_pd_fundraising_ttm" }); report.push({ key: "derived_pd_fundraising_ttm_share_of_private_capital", skipped: true, reason: "inputs absent: the report's strategy table or pb_pd_fundraising_ttm" }); }

  /* LBO financing through both channels */
  const dlLbo = keys.lcd_dl_lbo_volume_quarterly, bslLbo = keys.lcd_bsl_lbo_volume_quarterly;
  if (!dlLbo || !bslLbo) skip("derived_lbo_financing_both_channels_quarterly", ["lcd_dl_lbo_volume_quarterly", "lcd_bsl_lbo_volume_quarterly"]);
  if (dlLbo && bslLbo) {
    const pts = dlLbo.points.map((pt) => { const b = at(bslLbo, pt.p, pt.g); return b ? { p: pt.p, g: pt.g, ...(pt.start ? { start: pt.start } : {}), v: pt.v + b.v } : null; }).filter(Boolean);
    make("derived_lbo_financing_both_channels_quarterly", { label: "LBO financing volume, direct lending plus BSL institutional loans (quarterly)", unit: "$B", cadence: "quarterly", geography: "US", population: dlLbo.population, formula: "Direct lending LBO volume + institutional leveraged loan LBO volume, same period", group: "lcd-dealflow" }, pts, ["lcd_dl_lbo_volume_quarterly", "lcd_bsl_lbo_volume_quarterly"]);
  }

  for (const k of Object.keys(out)) for (const pt of out[k].points) if (typeof pt.v === "number") pt.v = round(pt.v, 12);
  return { keys: out, report };
}
