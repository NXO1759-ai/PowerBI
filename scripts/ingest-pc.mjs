/**
 * ingest-pc.mjs — the PitchBook and LCD ingest.
 *
 *   node scripts/ingest-pc.mjs [--source DIR] [--out DIR] [--strict]
 *
 * Reads every download under data-sources/ (the LCD monitor decks under
 * lcd/<download-date>/, the Fund Overview exports under
 * pitchbook/<download-date>/, the hand-keyed report files under
 * reports/) and the press series already in frontend/data/pc, turns
 * each into a vintage of dated series, replays the vintages oldest to
 * newest, derives the capital metrics of blueprint 3.4, and writes:
 *
 *   frontend/data/pc/series.json          every key with its points
 *   frontend/data/pc/series/<group>.json  the same, cut by group
 *   frontend/data/pc/series-index.json    per source: as-of, published, downloaded, cadence, lag
 *   frontend/data/pc/series-provenance.json  per key: locator, footnote or caveat, cross-checks
 *   frontend/data/pc/restatements.json    a superseded value per key and date, both vintages named
 *   frontend/data/pc/tables/<slug>.json   the deal tables and the workbook's list sheets
 *   frontend/data/pc/ingest-report.json   what matched, how, and what did not
 *   data-sources/manifest.json            sha256, bytes, edition and keys per file read
 *
 * Charts are identified by content (scripts/lib/pc-map.mjs over
 * scripts/pc-map.json), never by chart number, and nothing is dropped,
 * blanked or auto-mapped: a chart or sheet the map does not recognize is
 * written to the report with its full fingerprint, its previously
 * published key is flagged stale and keeps its last points, and
 * --strict exits 1. So does a chart whose value axis is on another
 * scale than its key's unit (unitMismatch), and a pair of charts or
 * sheets that resolve to one map group (duplicateMatch); a match whose
 * axis formats or grain moved while the heading held is listed under
 * signalMismatch for the owner to read. The raw downloads are licensed study material and
 * stay in the gitignored data-sources/; only what this script writes is
 * committed. The workbook's meta block, which names the licensee, is
 * never copied into any output.
 *
 * The run refuses, and writes nothing, when a source that the committed
 * manifest says has keys has no download in the tree (a fresh clone
 * before the downloads are copied in, or a CI runner, which never sees
 * them), when a deck, workbook or report file cannot be read, or when a
 * report file fails validation: an output written without one of its
 * sources would drop that source's keys silently, and nothing is
 * dropped. To retire a source on purpose, remove its entries from
 * data-sources/manifest.json first.
 *
 * No network, no dependencies; the whole first vintage runs in well
 * under a second.
 *
 * Exit codes: 0 clean; 1 --strict with an unmatched chart, sheet or
 * series, a refused point or a filter mismatch (the outputs are still
 * written, with the gap reported); 2 refused before writing (a missing
 * source, an unreadable file, a report file that fails validation) or
 * a crash.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readDeck } from "./lib/pptx-charts.mjs";
import { readWorkbook, checkStamp } from "./lib/xlsx-read.mjs";
import { validateMap } from "./lib/pc-map.mjs";
import { extractDeck, extractWorkbook, extractReport, extractPress, validateReport, build, derive } from "./lib/pc-series.mjs";
import { monthEnd } from "./lib/pc-periods.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GROUPS = ["lcd-dealflow", "lcd-pricing", "lcd-bdc", "pb-capital", "pb-fund", "reports", "press"];

/* ---------- helpers ---------- */
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const toPosix = (p) => p.split("\\").join("/");
const listDir = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".")).sort() : []);
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const daysBetween = (a, b) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);
const addMonths = (iso, n) => { let y = +iso.slice(0, 4), m = +iso.slice(5, 7) + n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return monthEnd(y, m); };
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-10-08" → "early October"; days 1–10 early, 11–20 mid, else late */
export function expectedLabel(iso) {
  if (!iso) return null;
  const d = +iso.slice(8, 10);
  return (d <= 10 ? "early " : d <= 20 ? "mid " : "late ") + MONTH_NAMES[+iso.slice(5, 7) - 1];
}
/* a path is reported relative to the repository, or not at all: a temporary folder's name is noise in a committed report */
const inRepo = (p) => { const r = toPosix(relative(ROOT, p)); return r.startsWith("..") ? "(outside the repository)" : r || "."; };
const writeJson = (path, value, pretty) => {
  mkdirSync(dirname(path), { recursive: true });
  const text = (pretty ? JSON.stringify(value, null, 1) : JSON.stringify(value)) + "\n";
  writeFileSync(path, text);
  return Buffer.byteLength(text);
};

/* ---------- discovery ---------- */
/**
 * discover(sourceDir) → { decks, workbooks, reports, handTables }
 * The folder name under lcd/ and pitchbook/ is the download date and the
 * vintage id; the edition is read from inside the file, never from the
 * folder. Files are ordered by folder date, then name.
 */
export function discover(sourceDir) {
  const found = { decks: [], workbooks: [], reports: [], handTables: [] };
  for (const [sub, list, re] of [["lcd", found.decks, /\.pptx$/i], ["pitchbook", found.workbooks, /\.xlsx$/i]]) {
    const base = join(sourceDir, sub);
    for (const folder of listDir(base)) {
      if (!isDir(join(base, folder)) || !/^\d{4}-\d{2}-\d{2}$/.test(folder)) continue;
      for (const file of listDir(join(base, folder))) if (re.test(file) && !file.startsWith("~$")) list.push({ vintage: folder, path: join(base, folder, file), file });
    }
  }
  for (const file of listDir(join(sourceDir, "reports"))) {
    if (!/\.json$/i.test(file)) continue;
    (/^lcd-monitor-.*-tables\.json$/.test(file) ? found.handTables : found.reports).push({ path: join(sourceDir, "reports", file), file });
  }
  return found;
}

/* ---------- freshness ---------- */
/**
 * sourceIndex(source, vintages, map) → the per-source line of series-index.json:
 * asOf (the latest among the source's points), publishedAt, downloaded,
 * cadence, lagDays (publishedAt − asOf) and nextExpected (the month after
 * the as-of plus the lag; the owner's override in pc-map.json wins while
 * only one lag has been observed).
 */
function sourceIndex(source, vintages, map) {
  const own = vintages.filter((v) => v.source === source);
  if (!own.length) return null;
  const latest = own[own.length - 1];
  const spec = (map.sources && map.sources[source]) || {};
  const asOf = latest.asOf || null;
  const publishedAt = latest.publishedAt || null;
  const lagDays = asOf && publishedAt ? daysBetween(asOf, publishedAt) : null;
  const lags = own.map((v) => (v.asOf && v.publishedAt ? daysBetween(v.asOf, v.publishedAt) : null)).filter((n) => n !== null);
  const out = {
    label: spec.label || source, publisher: spec.publisher || null, cadence: spec.cadence || null,
    edition: latest.edition || null, asOf, publishedAt, downloaded: latest.downloaded || latest.id || null,
    file: latest.file || null, sha256: latest.sha256 || null, lagDays, observedLags: lags, vintages: own.map((v) => ({ id: v.id, edition: v.edition, asOf: v.asOf, ...(v.document ? { document: v.document, documentSha256: v.documentSha256 || null } : {}) })),
  };
  /* a report source: the file hashed under sha256 is the JSON named in file; the newest document's own hash rides beside it */
  if (latest.document) { out.document = latest.document; out.documentSha256 = latest.documentSha256 || null; }
  if (spec.cadence === "monthly" && asOf && lagDays !== null) {
    out.nextExpected = addDays(addMonths(asOf, 1), lagDays);
    out.nextExpectedLabel = expectedLabel(out.nextExpected);
    if (spec.expectedNextOverride && lags.length < 2) { out.nextExpectedLabel = spec.expectedNextOverride; out.nextExpectedOverride = true; }
  } else if (spec.cadence === "quarterly" && asOf && lagDays !== null) {
    out.nextExpected = addDays(addMonths(asOf, 3), lagDays);
    out.nextExpectedLabel = expectedLabel(out.nextExpected);
  }
  return out;
}

/* ---------- the run ---------- */
/**
 * ingest({ sourceDir, outDir, strict, map, pressFile, manifestPath, today }) → {
 *   exitCode, report, keys, index, written: { path: bytes } }
 *   or, when the run is refused, { exitCode: 2, refused: [{ kind, ... }], report }
 *   with nothing written.
 *
 * manifestPath is where the manifest is read from (the sources the last
 * ingest recorded, for the missing-source guard) and written to; it
 * defaults to <sourceDir>/manifest.json, the committed file. A test
 * points it into a temporary folder so a run over the committed tree
 * cannot rewrite the committed manifest as a side effect.
 *
 * Every output is stamped 'generated' with the newest vintage it
 * reflects (the latest download folder date, report document date or
 * press check date), not the clock: a re-run over the same downloads
 * rewrites the same bytes, and the stamp moves only when a new download
 * is dropped. options.today is the fallback for an empty tree.
 */
export function ingest(options = {}) {
  const sourceDir = resolve(options.sourceDir || join(ROOT, "data-sources"));
  const outDir = resolve(options.outDir || join(ROOT, "frontend/data/pc"));
  const manifestPath = resolve(options.manifestPath || join(sourceDir, "manifest.json"));
  const strict = !!options.strict;
  const clock = options.today || new Date().toISOString().slice(0, 10);
  const map = options.map || JSON.parse(readFileSync(join(ROOT, "scripts/pc-map.json"), "utf8"));
  const mapProblems = validateMap(map);
  if (mapProblems.length) throw new Error("pc-map.json: " + mapProblems.join("; "));

  const found = discover(sourceDir);
  const vintages = [];
  const manifest = {};
  const errors = [];
  const perFile = [];
  const rel = (p) => toPosix(relative(sourceDir, p));

  /* the hand-keyed deal tables, by edition, for the cross-check */
  const hand = {};
  for (const h of found.handTables) {
    try { const j = JSON.parse(readFileSync(h.path, "utf8")); hand[j.edition] = { file: h.file, json: j }; }
    catch (e) { errors.push({ file: h.file, error: String(e.message || e) }); }
  }

  for (const d of found.decks) {
    let bytes;
    try { bytes = readFileSync(d.path); } catch (e) { errors.push({ file: rel(d.path), error: String(e.message || e) }); continue; }
    const deck = readDeck(bytes);
    const handFor = deck.edition && hand[deck.edition] ? hand[deck.edition] : null;
    const v = extractDeck(deck, map, { vintage: d.vintage, file: rel(d.path), sha256: sha256(bytes), hand: handFor ? handFor.json : null, handFile: handFor ? handFor.file : null });
    v.downloaded = d.vintage;
    v.report.deckWarnings = deck.warnings;
    v.report.slideCount = deck.slideCount;
    if (!handFor) v.report.warnings.push({ kind: "handTablesMissing", edition: deck.edition, note: "no data-sources/reports/lcd-monitor-<edition>-tables.json to check the deal tables against" });
    vintages.push(v);
    manifest[rel(d.path)] = { sha256: v.sha256, bytes: bytes.length, publisher: "PitchBook | LCD", source: v.source, vintage: d.vintage, edition: v.edition, asOf: v.asOf, publishedAt: v.publishedAt, keys: Object.keys(v.series).sort(), tables: Object.keys(v.tables).sort() };
    perFile.push({ file: rel(d.path), source: v.source, vintage: d.vintage, edition: v.edition, asOf: v.asOf, publishedAt: v.publishedAt, sha256: v.sha256, ...v.report });
  }
  for (const w of found.workbooks) {
    let bytes;
    try { bytes = readFileSync(w.path); } catch (e) { errors.push({ file: rel(w.path), error: String(e.message || e) }); continue; }
    const wb = readWorkbook(bytes);
    const stamp = checkStamp(wb, w.file);
    const v = extractWorkbook(wb, map, { vintage: w.vintage, file: rel(w.path), sha256: sha256(bytes) });
    v.report.stamp = stamp;
    if (!stamp.agree) v.report.warnings.push({ kind: "stampDisagree", ...stamp });
    if (v.downloaded && v.downloaded !== w.vintage) v.report.warnings.push({ kind: "folderDateDiffers", folder: w.vintage, downloadedOn: v.downloaded });
    vintages.push(v);
    manifest[rel(w.path)] = { sha256: v.sha256, bytes: bytes.length, publisher: "PitchBook Data, Inc.", source: v.source, vintage: w.vintage, edition: v.edition, asOf: v.asOf, publishedAt: v.publishedAt, keys: Object.keys(v.series).sort(), tables: Object.keys(v.tables).sort() };
    perFile.push({ file: rel(w.path), source: v.source, vintage: w.vintage, edition: v.edition, asOf: v.asOf, publishedAt: v.publishedAt, sha256: v.sha256, ...v.report });
  }
  for (const r of found.reports) {
    let text;
    try { text = readFileSync(r.path, "utf8"); } catch (e) { errors.push({ file: rel(r.path), error: String(e.message || e) }); continue; }
    const json = JSON.parse(text);
    const problems = validateReport(json, r.file);
    if (problems.length) { errors.push({ file: rel(r.path), error: "refused: " + problems.slice(0, 10).join("; ") + (problems.length > 10 ? " …" : "") }); continue; }
    const vs = extractReport(json, r.file);
    const fileSha = sha256(Buffer.from(text));
    /* a report vintage is one document inside the file: sha256 is the
       named file's, the document's own hash rides under its own name */
    for (const v of vs) { v.file = rel(r.path); v.documentSha256 = v.sha256 || null; v.sha256 = fileSha; vintages.push(v); }
    manifest[rel(r.path)] = { sha256: fileSha, bytes: Buffer.byteLength(text), publisher: json.publisher, source: vs.length ? vs[0].source : "reports", editions: vs.map((v) => v.edition), keys: [...new Set(vs.flatMap((v) => Object.keys(v.series)))].sort(), documents: Object.keys(json.documents || {}) };
    perFile.push({ file: rel(r.path), source: vs.length ? vs[0].source : "reports", documents: vs.map((v) => ({ id: v.id, edition: v.edition, asOf: v.asOf, series: v.report.series, points: v.report.points, tables: v.report.tables })) });
  }
  for (const [ed, h] of Object.entries(hand)) {
    manifest["reports/" + h.file] = { sha256: sha256(readFileSync(join(sourceDir, "reports", h.file))), bytes: statSync(join(sourceDir, "reports", h.file)).size, publisher: h.json.publisher, source: "lcd-monitor-tables", edition: ed, role: "hand-keyed check of the deck's EMF tables" };
  }
  const pressPath = options.pressFile || join(outDir, "press-series.json");
  if (existsSync(pressPath)) {
    const press = extractPress(JSON.parse(readFileSync(pressPath, "utf8")));
    press.file = toPosix(relative(ROOT, pressPath));
    vintages.push(press);
    perFile.push({ file: press.file, source: "press", vintage: press.id, ...press.report });
  }

  /* the missing-source guard: every source the last manifest recorded
     keys for must have a vintage in this tree, or the run would write an
     output without that source's keys, and nothing is dropped */
  const refused = errors.map((e) => ({ kind: "unreadable", ...e }));
  if (existsSync(manifestPath)) {
    let prior = null;
    try { prior = JSON.parse(readFileSync(manifestPath, "utf8")); } catch (e) { refused.push({ kind: "manifestUnreadable", file: toPosix(manifestPath), error: String(e.message || e) }); }
    const have = new Set(vintages.map((v) => v.source));
    const recorded = {};
    for (const [file, m] of Object.entries((prior && prior.files) || {})) if (m && m.source && Array.isArray(m.keys) && m.keys.length) (recorded[m.source] = recorded[m.source] || []).push(file);
    for (const [source, files] of Object.entries(recorded)) if (!have.has(source)) refused.push({ kind: "sourceMissing", source, recordedIn: files, keys: files.reduce((n, f) => n + prior.files[f].keys.length, 0), note: "the manifest at " + toPosix(manifestPath) + " records keys from this source and no file of it is in " + toPosix(sourceDir) + "; copy the download in, or remove its manifest entries to retire it" });
  }
  /* the same guard for the press file, which lives in the output folder and not in the manifest */
  const indexPath = join(outDir, "series-index.json");
  if (existsSync(indexPath)) {
    let priorIndex = null;
    try { priorIndex = JSON.parse(readFileSync(indexPath, "utf8")); } catch (e) { priorIndex = null; }
    const have = new Set(vintages.map((v) => v.source));
    for (const source of Object.keys((priorIndex && priorIndex.sources) || {})) if (!have.has(source) && !refused.some((r) => r.source === source)) refused.push({ kind: "sourceMissing", source, recordedIn: [toPosix(indexPath)], keys: Object.values(priorIndex.series || {}).filter((e) => e.source === source).length, note: "the committed index lists this source and this run found no file of it" });
  }
  if (refused.length) {
    const report = { generated: clock, strict, sourceDir: inRepo(sourceDir), outDir: inRepo(outDir), refused, summary: { files: perFile.length, refusals: refused.length, keys: 0, points: 0 }, files: perFile };
    return { exitCode: 2, refused, report, keys: {}, index: null, written: {}, vintages };
  }

  /* replay: decks and workbooks by folder date then edition, the reports by document as-of; sources never share a key */
  const order = (v) => [v.source === "press" ? "z" : "a", v.id || "", v.asOf || "", v.edition || ""].join("|");
  vintages.sort((a, b) => order(a).localeCompare(order(b)));
  const built = build(vintages);
  const derived = derive(built.keys, { tables: built.tables });
  const keys = { ...built.keys, ...derived.keys };

  /* ---------- outputs ---------- */
  const written = {};
  const generated = vintages.reduce((g, v) => (v.id && v.id > g ? v.id : g), "") || clock;
  const stripKey = (s) => {
    const o = { label: s.label, unit: s.unit, cadence: s.cadence, geography: s.geography, population: s.population, source: s.source, group: s.group, edition: s.edition, asOf: s.asOf, publishedAt: s.publishedAt, vintage: s.vintage };
    for (const f of ["publisher", "formula", "inputs", "alias", "table", "stale"]) if (s[f] !== undefined && s[f] !== null) o[f] = s[f];
    o.points = s.points.map((pt) => {
      const q = { p: pt.p, g: pt.g };
      for (const f of ["start", "c", "label", "q", "v", "vintage", "doc", "page", "url", "partial", "provisional", "estimate", "approx", "forecast", "dryPowderAsOf"]) if (pt[f] !== undefined && pt[f] !== null) q[f] = pt[f];
      /* a point kept from an older edition beside newer ones (the Jun-Aug
         rolling point next to Jul-Sep, an earlier report's year) names
         its edition; a point of the key's own edition inherits it */
      if (pt.edition !== undefined && pt.edition !== null && pt.edition !== s.edition) q.edition = pt.edition;
      return q;
    });
    return o;
  };
  /* provenance: where each key was read, the slide footnote or report caveat that rides with it, the cross-checks */
  const provenanceOf = (s) => {
    const o = {};
    for (const f of ["fingerprintId", "locator", "notes", "populationNote", "restatementNote", "crossChecks", "derivedFrom", "formula", "inputs", "years", "threshold", "of", "catalogKey"]) if (s[f] !== undefined && s[f] !== null) o[f] = s[f];
    return o;
  };
  const series = {
    generated,
    note: "Values are the source's own: a share is the fraction the chart or sheet holds (unit share; multiply by 100 to print), unit pct is percent points as printed (chart27's all-in rate, the report and press series; a hand-keyed '%' is served as pct, a qualified '% of loans' or '% a year' stays as typed), money from the workbook is divided to $B or $M. p is the period end; g the grain, one of quarter, half, year, ytd, month, asof, rolling3m, rolling6m, rolling12m (the deck's TTM and the reports' ttm), window (a multi-year rate, start to end) and label (a press point whose period names no calendar date; p is null); start the window start on year-to-date, rolling and window points; c the bucket or sector on snapshot points; vintage the download that carried the value; edition the source edition when it differs from the key's (a point without one is of the key's edition). Rolling, window and year-to-date points are never summed with quarters or years. The annual deck keys store the chart's own annual cache and the ingest proves every year equal to the sum of its quarters (series-provenance.json crossChecks). A key with 'alias' is a duplicate deck series stored once under the named key and carries no points of its own; a key with 'table' is a list sheet whose rows live in that file under frontend/data/pc/; a key with 'stale' was not in its source's newest edition and keeps its last points.",
    keys: {},
  };
  for (const k of Object.keys(keys).sort()) series.keys[k] = stripKey(keys[k]);
  written["series.json"] = writeJson(join(outDir, "series.json"), series, false);

  /* what the last run wrote, so a group or table file it produced and
     this run does not is removed, and nothing else under series/ or
     tables/ is touched */
  const reportPath = join(outDir, "ingest-report.json");
  let previouslyWritten = [];
  if (existsSync(reportPath)) { try { previouslyWritten = JSON.parse(readFileSync(reportPath, "utf8")).outputs || []; } catch (e) { previouslyWritten = []; } }

  /* group files: a partition of series.json */
  const seriesDir = join(outDir, "series");
  mkdirSync(seriesDir, { recursive: true });
  const groupKeys = {};
  for (const [k, s] of Object.entries(series.keys)) { const g = GROUPS.includes(s.group) ? s.group : "reports"; (groupKeys[g] = groupKeys[g] || []).push(k); }
  for (const g of Object.keys(groupKeys).sort()) {
    const part = { generated, group: g, keys: {} };
    for (const k of groupKeys[g]) part.keys[k] = series.keys[k];
    written["series/" + g + ".json"] = writeJson(join(seriesDir, g + ".json"), part, false);
  }

  /* tables */
  const tablesDir = join(outDir, "tables");
  mkdirSync(tablesDir, { recursive: true });
  for (const [slug, t] of Object.entries(built.tables)) {
    written["tables/" + slug + ".json"] = writeJson(join(tablesDir, slug + ".json"), { generated, ...t }, true);
  }
  const removed = [];
  for (const f of previouslyWritten) if (/^(series|tables)\/[^/]+\.json$/.test(f) && !written[f] && existsSync(join(outDir, f))) { unlinkSync(join(outDir, f)); removed.push(f); }

  /* restatements */
  written["restatements.json"] = writeJson(join(outDir, "restatements.json"), { generated, note: "One entry per key and date whose value changed between vintages; values are in vintage order, the last is the one series.json carries.", count: built.restatements.length, restatements: built.restatements }, true);

  /* the index */
  const sources = {};
  for (const src of [...new Set(vintages.map((v) => v.source))]) sources[src] = sourceIndex(src, vintages, map);
  const index = { generated, sources, groups: {}, series: {} };
  for (const g of Object.keys(groupKeys).sort()) index.groups[g] = { file: "series/" + g + ".json", keys: groupKeys[g] };
  for (const [k, s] of Object.entries(series.keys)) {
    const dated = s.points.filter((pt) => pt.p);
    const first = dated.length ? dated[0] : null, last = dated.length ? dated[dated.length - 1] : null;
    const entry = { label: s.label, unit: s.unit, cadence: s.cadence, geography: s.geography, source: s.source, group: s.group, file: "series/" + (GROUPS.includes(s.group) ? s.group : "reports") + ".json", n: s.points.length, first: first ? first.p : null, firstGrain: first ? first.g : null, last: last ? last.p : null, lastGrain: last ? last.g : null, asOf: s.asOf, edition: s.edition, vintage: s.vintage };
    for (const f of ["alias", "table", "stale"]) if (s[f]) entry[f] = s[f];
    index.series[k] = entry;
  }
  written["series-index.json"] = writeJson(join(outDir, "series-index.json"), index, false);
  const provenance = { generated, note: "Per key: where it was read (slide, chart, heading and series name; sheet, title and column; report document and file), the footnote or caveat that rides with it, and the cross-checks the ingest ran (a duplicate series compared value for value, an annual bar against the sum of its quarters, a derived series against the chart's own cache).", keys: {} };
  for (const k of Object.keys(keys).sort()) provenance.keys[k] = provenanceOf(keys[k]);
  written["series-provenance.json"] = writeJson(join(outDir, "series-provenance.json"), provenance, false);

  /* the report */
  const totals = (field) => perFile.reduce((n, f) => n + ((f[field] && f[field].length) || 0), 0);
  const report = {
    generated, strict, sourceDir: inRepo(sourceDir), outDir: inRepo(outDir),
    vintages: built.replayed,
    summary: {
      files: perFile.length, charts: perFile.reduce((n, f) => n + (f.chartsSeen || 0), 0), sheets: perFile.reduce((n, f) => n + (f.sheetsSeen || 0), 0),
      matched: totals("matched"), fallbackMatched: totals("fallbackMatched"), unmatched: totals("unmatched"), unmatchedSeries: totals("unmatchedSeries"),
      refused: totals("refused"), filterMismatch: totals("filterMismatch"), unparsedCells: totals("unparsedCells"), signalMismatch: totals("signalMismatch"),
      keys: Object.keys(series.keys).length, points: Object.values(series.keys).reduce((n, s) => n + s.points.length, 0),
      derivedKeys: Object.keys(derived.keys).length, restated: built.restatements.length, stale: built.stale.length, tables: Object.keys(built.tables).length,
      warnings: perFile.reduce((n, f) => n + ((f.warnings && f.warnings.length) || 0), 0),
    },
    files: perFile,
    derived: derived.report,
    stale: built.stale,
    restated: built.restatements.map((r) => ({ key: r.key, date: r.date, grain: r.grain, values: r.values.map((v) => v.value), vintages: r.values.map((v) => v.vintage) })),
    removed,
    catalog: catalogCheck(map, keys),
    bytesWritten: Object.values(written).reduce((n, b) => n + b, 0),
  };
  /* the output list rides in the report itself, so the next run knows what this one wrote */
  report.outputs = [...Object.keys(written), "ingest-report.json", "manifest.json"];
  written["ingest-report.json"] = writeJson(reportPath, report, true);
  written["manifest.json"] = writeJson(manifestPath, { generated, note: "Written by scripts/ingest-pc.mjs: one entry per file read, by path under data-sources/. The raw decks and workbooks are gitignored; this manifest and the reports are committed. A source recorded here with keys must be present in the tree for the next run, or it refuses.", files: manifest }, true);
  report.written = written;

  const strictFail = strict && (report.summary.unmatched || report.summary.unmatchedSeries || report.summary.refused || report.summary.filterMismatch);
  return { exitCode: strictFail ? 1 : 0, report, keys: series.keys, index, written, vintages };
}

/**
 * catalogCheck(map, keys) → per map entry: the points written against
 * the count the catalog recorded for the first vintage, with the reason
 * for every difference (a duplicate read as a cross-check, a blank cell,
 * a snapshot key that grew across editions).
 */
function catalogCheck(map, keys) {
  const rows = [];
  for (const e of map.entries) {
    const expected = e.seen && e.seen.points;
    if (expected === undefined) continue;
    const s = keys[e.key];
    const n = s ? s.points.length : 0;
    let reason = null;
    if (e.duplicateOf && s && s.alias) reason = "read as a cross-check of " + e.duplicateOf + " and written as its alias, not twice";
    else if (e.duplicateOf && s) reason = "a duplicate whose values diverged from " + e.duplicateOf + "; written and flagged";
    else if (e.table) reason = "a table: the key points to tables/" + e.table.slug + ".json, the rows live there";
    else if (!s) reason = "not written";
    else if (n !== expected && e.accumulates) reason = "accumulates across editions";
    else if (n !== expected) reason = "the catalog counts cache slots; a blank cell is not a point";
    rows.push({ key: e.key, expected, written: n, ...(reason ? { reason } : {}) });
  }
  return { checked: rows.length, differing: rows.filter((r) => r.reason).length, rows: rows.filter((r) => r.reason) };
}

/* ---------- command line ---------- */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (name, fallback = null) => { const i = argv.indexOf("--" + name); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback; };
  let result;
  try {
    result = ingest({ sourceDir: arg("source"), outDir: arg("out"), strict: argv.includes("--strict") });
  } catch (e) {
    console.error("ingest-pc: " + (e.stack || e));
    process.exit(2);
  }
  if (result.refused) {
    console.error("ingest-pc: refused, nothing written");
    for (const r of result.refused) console.error("  " + r.kind + ": " + (r.kind === "sourceMissing" ? r.source + " (" + r.keys + " keys recorded in " + r.recordedIn.join(", ") + "): " + r.note : (r.file || "") + ": " + (r.error || "")));
    process.exit(2);
  }
  const s = result.report.summary;
  console.log("ingest-pc: " + s.files + " files, " + s.charts + " charts, " + s.sheets + " sheets; matched " + s.matched + " (" + s.fallbackMatched + " by fallback), unmatched " + s.unmatched + ", unmatched series " + s.unmatchedSeries + ", refused " + s.refused + ", filter mismatches " + s.filterMismatch + ", signal mismatches " + s.signalMismatch);
  console.log("ingest-pc: " + s.keys + " keys, " + s.points + " points, " + s.derivedKeys + " derived, " + s.restated + " restated, " + s.stale + " stale, " + s.tables + " tables, " + s.warnings + " warnings");
  for (const [f, b] of Object.entries(result.written)) console.log("  " + String(b).padStart(8) + "  " + f);
  for (const f of result.report.removed) console.log("   removed  " + f);
  for (const f of result.report.files) for (const u of f.unmatched || []) console.log("  unmatched: " + (u.id || u.name) + " on " + (f.file || "") + ": " + JSON.stringify(u));
  for (const f of result.report.files) for (const r of f.refused || []) console.log("  refused: " + r.kind + " on " + (f.file || "") + ": " + JSON.stringify(r));
  for (const f of result.report.files) for (const r of f.signalMismatch || []) console.log("  signal mismatch on " + (f.file || "") + ": " + JSON.stringify(r));
  for (const st of result.report.stale) console.log("  stale: " + st.key + " (last seen " + st.lastSeenEdition + "): " + st.reason);
  if (result.exitCode) console.log("ingest-pc: --strict failed");
  process.exit(result.exitCode);
}
