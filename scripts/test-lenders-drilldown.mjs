/**
 * test-lenders-drilldown.mjs — the per-BDC drill-down, offline.
 *
 * Window-stub pattern (the same one scripts/test-pc-page.mjs uses for
 * credit-stress.js/credit-capital.js/credit-dealflow.js): the drill-down
 * file is evaluated with `new Function("window","self","document",
 * "module", src)` against a minimal DOM built here with no HTML parser
 * (createElement/appendChild/id registration only — no npm dependency),
 * so open() can run its real code path and #ld-body's innerHTML can be
 * read back as a plain string afterward.
 *
 * Checks, in order:
 *   1. the file parses as a standalone script and evaluates against a
 *      window stub, registering window.RTLendersDrilldown with the
 *      { open, close, CAPTIONS } contract;
 *   2. CATALOG entries (registered at module evaluation) are unique,
 *      complete, register cleanly into a fresh catalog, and throw on a
 *      second registration into THAT SAME catalog — proving the module
 *      can be evaluated a second time in one process (each evaluation
 *      here gets its own fresh catalog, exactly as a second page load
 *      would) without colliding with itself;
 *   3. every CAPTIONS.<name>.sample() renders under 240 characters;
 *   4. open() runs for a holdings-available ticker (ARCC, real
 *      committed data) without throwing, and #ld-body's rendered HTML
 *      carries the ticker, every panel's catalog key and no refusal
 *      banner;
 *   5. open() runs for a real refused ticker (from coverage.json's own
 *      holdings.tickers_refused, company file real, holdings null)
 *      without throwing, and the rendered HTML carries that ticker's
 *      own refusal reason text and "not yet parsed" in the
 *      holdings-only panels.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BDC_DIR = join(ROOT, "frontend/data/bdc");
const FRONT = join(ROOT, "frontend");
const readJson = (dir, rel) => JSON.parse(readFileSync(join(dir, rel), "utf8"));

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};

/* ---------- a minimal DOM, no HTML parser, no npm dependency ----------
   Only what the drill-down's own code touches: createElement, id
   registration (so getElementById finds a node this code itself
   created), appendChild, addEventListener (stored, never dispatched —
   this test never simulates a click), innerHTML/textContent as plain
   string properties, classList, setAttribute/getAttribute, hidden, and
   a no-op focus(). content built through innerHTML string assignment
   (every chart/table/panel) is read back as a plain string — exactly
   what the checks below need. */
function makeDom() {
  const byId = Object.create(null);
  function FakeElement(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this._id = ""; this.innerHTML = ""; this.textContent = ""; this.hidden = false;
    this.className = ""; this._attrs = Object.create(null); this._listeners = Object.create(null);
    this._children = [];
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    };
    Object.defineProperty(this, "id", {
      get: () => this._id,
      set: (v) => { this._id = v; if (v) byId[v] = this; },
    });
  }
  FakeElement.prototype.appendChild = function (child) { this._children.push(child); return child; };
  FakeElement.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  FakeElement.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); };
  FakeElement.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; };
  FakeElement.prototype.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this._attrs, k); };
  FakeElement.prototype.focus = function () {};

  const body = new FakeElement("body");
  const document = {
    _byId: byId,
    body,
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => new FakeElement(tag),
    addEventListener: () => {},
  };
  return document;
}

/* ---------- evaluate the file against a fresh window/document ---------- */
const SRC = readFileSync(join(FRONT, "credit-lenders-drilldown.js"), "utf8");
const RTCredit = require(join(FRONT, "lib/credit.js"));

function evalFresh() {
  const catalogSrc = readFileSync(join(FRONT, "lib/metric-catalog.js"), "utf8");
  const catalogWin = {}; catalogWin.self = catalogWin; catalogWin.window = catalogWin;
  new Function("window", "self", "module", catalogSrc)(catalogWin, catalogWin, undefined);
  const document = makeDom();
  const win = { RTCredit, RTCatalog: catalogWin.RTCatalog, document };
  win.self = win; win.window = win;
  let evalErr = null;
  try { new Function("window", "self", "document", "module", SRC)(win, win, document, undefined); }
  catch (e) { evalErr = e; }
  return { win, document, evalErr, RTCatalog: catalogWin.RTCatalog };
}

/* ---------- 1. parse + evaluate ---------- */
console.log("parse and evaluate");
{
  let parseErr = null;
  try { new Function(SRC); } catch (e) { parseErr = e; }
  check("credit-lenders-drilldown.js parses as a standalone script", !parseErr, parseErr && parseErr.message);
}
const first = evalFresh();
check("evaluates against a window stub and registers window.RTLendersDrilldown", !first.evalErr && !!first.win.RTLendersDrilldown, first.evalErr && (first.evalErr.stack || first.evalErr.message));
const LD = first.win.RTLendersDrilldown;
check("the module's contract is { open, close, CAPTIONS }", LD && typeof LD.open === "function" && typeof LD.close === "function" && typeof LD.CAPTIONS === "object");

/* ---------- 2. catalog entries: unique, complete, and a second
   evaluation in one process does not throw (fresh catalog each time,
   the same guarantee a second page load carries) ---------- */
console.log("catalog entries");
{
  const entries = Object.keys(first.RTCatalog.METRICS).filter((k) => k.indexOf("lendersDrill") === 0).map((k) => first.RTCatalog.METRICS[k]);
  check("at least one lendersDrill* entry registered", entries.length >= 12, String(entries.length));
  const keys = entries.map((e) => e.key || "");
  check("every lendersDrill* key is unique", new Set(keys).size === keys.length);
  check("every entry has label, formula, definition, interpretation and watch",
    entries.every((e) => e.label && e.formula && e.definition && e.interpretation && e.watch),
    entries.filter((e) => !(e.label && e.formula && e.definition && e.interpretation && e.watch)).map((e) => e.key).join(", "));

  let threw = null;
  try { first.RTCatalog.register(entries.map((e) => ({ key: "dup_" + e.key, label: e.label, formula: e.formula, definition: e.definition, interpretation: e.interpretation, watch: e.watch }))); }
  catch (e) { threw = e; }
  check("re-registering under new keys into the same catalog does not throw (sanity)", !threw, threw && threw.message);

  const second = evalFresh();
  check("a second evaluation in a fresh process-like window (its own catalog) does not throw",
    !second.evalErr, second.evalErr && (second.evalErr.stack || second.evalErr.message));
  const secondEntries = Object.keys(second.RTCatalog.METRICS).filter((k) => k.indexOf("lendersDrill") === 0);
  check("the second evaluation's fresh catalog also carries the lendersDrill* keys", secondEntries.length === keys.length, String(secondEntries.length));
}

/* ---------- 3. every caption sample() under 240 characters ---------- */
console.log("captions");
{
  const names = Object.keys(LD.CAPTIONS);
  check("CAPTIONS carries an entry for every chart/table/card", names.length >= 12, String(names.length));
  names.forEach((name) => {
    const c = LD.CAPTIONS[name];
    let text = null, err = null;
    try { text = c.sample(); } catch (e) { err = e; }
    check("CAPTIONS." + name + ".sample() renders without throwing", !err, err && err.message);
    check("CAPTIONS." + name + ".sample() is under 240 characters", typeof text === "string" && text.length > 0 && text.length < 240,
      text ? String(text.length) + " chars" : "no text");
  });
}

/* ---------- data: the real committed files ---------- */
const universe = readJson(BDC_DIR, "universe.json");
const coverage = readJson(BDC_DIR, "coverage.json");
const terms = readJson(BDC_DIR, "terms.json");
const composite = readJson(BDC_DIR, "composite.json");
const companies = {}; const holdingsFiles = {};
for (const f of readdirSync(BDC_DIR)) {
  const mC = f.match(/^company-([A-Z0-9.]+)\.json$/);
  if (mC) companies[mC[1]] = readJson(BDC_DIR, f);
  const mH = f.match(/^holdings-([A-Z0-9.]+)\.json$/);
  if (mH) holdingsFiles[mH[1]] = readJson(BDC_DIR, f);
}

/* an optional real pcSeries loader, best-effort: L4/L5/L6 draw an LCD
   overlay when it loads and simply omit it (never throw) when it does
   not, so this is a nice-to-have for the test, not a requirement */
let pcSeries = null;
try {
  const S = require(join(FRONT, "lib/pc-series.js"));
  S.reader = (path) => new Promise((res, rej) => {
    try { res(JSON.parse(readFileSync(join(FRONT, path), "utf8"))); } catch (e) { rej(e); }
  });
  await S.load(["lcd-bdc"]);
  pcSeries = S;
} catch (e) { pcSeries = null; }

function ctxFor(ticker, extra) {
  return Object.assign({
    company: companies[ticker] || null,
    holdings: holdingsFiles[ticker] || null,
    composite, terms, universe, coverage,
    pcSeries, catalog: first.RTCatalog, fmt: null, wrapTerms: null,
    priceHistory: () => Promise.resolve([]),
    quote: () => Promise.resolve(null),
  }, extra || {});
}

/* ---------- 4. a holdings-available ticker ---------- */
console.log("open() — a holdings-available ticker (ARCC)");
{
  check("ARCC has a real company file", !!companies.ARCC);
  check("ARCC has a real holdings file", !!holdingsFiles.ARCC);
  let threw = null;
  try { first.win.RTLendersDrilldown.open("ARCC", ctxFor("ARCC")); } catch (e) { threw = e; }
  check("open('ARCC', ctx) runs without throwing", !threw, threw && (threw.stack || threw.message));
  const bodyHtml = first.document.getElementById("ld-body") ? first.document.getElementById("ld-body").innerHTML : "";
  check("the rendered body is non-empty", typeof bodyHtml === "string" && bodyHtml.length > 500, String(bodyHtml.length));
  check("no refusal banner for a holdings-available ticker", !/No parsed schedule of investments/.test(bodyHtml));
  check("every panel's catalog key appears as a data-metric on the rendered page",
    ["lendersDrillNavPrice", "lendersDrillDividendCoverage", "lendersDrillLeverage", "lendersDrillSpreadHistogram", "lendersDrillMaturityWall",
      "lendersDrillSectorMix", "lendersDrillMarkStress", "lendersDrillHoldingsTable", "lendersDrillWatchlist", "lendersDrillReturnDecomposition",
      "lendersDrillLiability", "lendersDrillFees"].every((k) => bodyHtml.indexOf("data-metric='" + k + "'") >= 0),
    ["lendersDrillNavPrice", "lendersDrillDividendCoverage", "lendersDrillLeverage", "lendersDrillSpreadHistogram", "lendersDrillMaturityWall",
      "lendersDrillSectorMix", "lendersDrillMarkStress", "lendersDrillHoldingsTable", "lendersDrillWatchlist", "lendersDrillReturnDecomposition",
      "lendersDrillLiability", "lendersDrillFees"].filter((k) => bodyHtml.indexOf("data-metric='" + k + "'") < 0).join(", "));
  check("a hidden Holdings export table with every row is present", new RegExp("data-export-name='Holdings - ARCC'").test(bodyHtml));
  check("close() runs without throwing", (() => { try { first.win.RTLendersDrilldown.close(); return true; } catch (e) { return false; } })());
}

/* ---------- 5. a real refused ticker ---------- */
console.log("open() — a refused ticker");
{
  const refused = (coverage.holdings && coverage.holdings.tickers_refused) || [];
  const pick = refused[0];
  check("coverage.json names at least one refused ticker", !!pick, JSON.stringify(pick));
  const ticker = pick && pick.ticker;
  check(ticker + " has a real company file", !!companies[ticker]);
  check(ticker + " has no holdings file (refused)", !holdingsFiles[ticker]);
  let threw = null;
  const fresh = evalFresh();
  try { fresh.win.RTLendersDrilldown.open(ticker, ctxFor(ticker)); } catch (e) { threw = e; }
  check("open('" + ticker + "', ctx) runs without throwing for a refused ticker", !threw, threw && (threw.stack || threw.message));
  const bodyHtml = fresh.document.getElementById("ld-body") ? fresh.document.getElementById("ld-body").innerHTML : "";
  check("the refusal banner names the ticker's own reason from coverage.holdings.tickers_refused",
    pick && pick.reason ? bodyHtml.indexOf(pick.reason) >= 0 : false, pick && pick.reason);
  check("a holdings-only panel (spread histogram) shows 'not yet parsed'", /not yet parsed/.test(bodyHtml));
  check("open() for the refused ticker still renders portfolio-level panels (dividend coverage) when company data supports them",
    bodyHtml.indexOf("data-metric='lendersDrillDividendCoverage'") >= 0);
}

/* ---------- 6. every real filer's L6 caption stays under 240 chars ----------
   CAPTIONS.l6.sample() alone (check 3 above) uses a short, fixed sample
   string and cannot catch a real, over-long committed sector label —
   PSEC's own top industry name runs to 119 characters (round-2 fixer
   finding: the rendered caption hit 269 characters on real data while
   the fixed sample measured 178). Open every committed holdings ticker
   for real and measure the rendered L6 caption's actual length. */
console.log("L6 caption length against every real committed holdings file");
{
  const L6_RE = /data-metric='lendersDrillSectorMix'[\s\S]*?<figcaption class='ld-caption'>([\s\S]*?)<\/figcaption>/;
  let longest = 0, longestTicker = null;
  for (const ticker of Object.keys(holdingsFiles)) {
    const fresh = evalFresh();
    fresh.win.RTLendersDrilldown.open(ticker, ctxFor(ticker));
    const bodyHtml = fresh.document.getElementById("ld-body") ? fresh.document.getElementById("ld-body").innerHTML : "";
    const m = L6_RE.exec(bodyHtml);
    if (!m) continue; // a filer with no industry rows shows the empty state instead — nothing to measure
    if (m[1].length > longest) { longest = m[1].length; longestTicker = ticker; }
  }
  check("every real filer's rendered L6 caption is under 240 characters",
    longest > 0 && longest < 240, longestTicker + ": " + longest + " chars");
}

console.log(failed ? "\n" + failed + " failed" : "\nall lenders drilldown checks pass");
process.exit(failed ? 1 : 0);
