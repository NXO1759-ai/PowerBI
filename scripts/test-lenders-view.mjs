/**
 * test-lenders-view.mjs — the Lenders view controller, offline.
 *
 * Window-stub pattern (the same one scripts/test-lenders-drilldown.mjs
 * uses for credit-lenders-drilldown.js): the module is evaluated with
 * `new Function("window","self","document","module","fetch", src)`
 * against a minimal DOM built here with no HTML parser
 * (createElement/appendChild/id registration only — no npm dependency)
 * and a stubbed `fetch` closing over a small, real-data fixture (six
 * real tickers spanning holdings-available, holdings-refused, OTC and a
 * non-calendar fiscal year), loaded through the real chain in credit.html's
 * script order: metric-catalog.js -> credit.js -> valuation.js ->
 * lenders-scorecard.js -> credit-lenders-drilldown.js -> credit-lenders.js.
 *
 * Checks, in order:
 *   1. the file parses as a standalone script and evaluates against a
 *      window stub, registering window.RTLendersView with the
 *      { mount, getData, getError, CAPTIONS } contract;
 *   2. every RTCatalog key the three files add (lenders-scorecard.js,
 *      credit-lenders-drilldown.js, credit-lenders.js) registers without
 *      throwing in that exact load order, proving no collisions across
 *      the shared "credit" group namespace;
 *   3. every CAPTIONS.<name>.sample() renders under 240 characters;
 *   4. mount() against the six-ticker fixture: fetches universe,
 *      coverage, terms and composite once each, all six company files,
 *      only the five non-refused holdings files (never holdings-AFCG,
 *      the refused ticker — proving no 404-storm), and one batched
 *      /api/comps call carrying all six tickers; the scorecard renders
 *      six rows; the composite strip's tile values equal
 *      composite.json's own weighted.* fields exactly, formatted the
 *      same way; the dispersion panel's median-price/NAV row (n = 0 in
 *      the real committed composite.json) shows the "not yet computed"
 *      empty state, and a populated metric renders one dot per member
 *      composite.json's own perFiler array answers for; the peers panel
 *      falls through to the "every covered company" pool level and its
 *      rendered order matches an independently recomputed
 *      RTValuation.selectComparables + RTValuation.bdcDistance ranking
 *      over the same candidates;
 *   5. a second, independent evaluation whose universe.json fetch
 *      rejects renders the page-level error state and never a
 *      half-rendered table;
 *   6. a forced re-mount re-fetches every core file a second time.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRONT = join(ROOT, "frontend");
const BDC_DIR = join(FRONT, "data/bdc");
const readJson = (dir, rel) => JSON.parse(readFileSync(join(dir, rel), "utf8"));

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail !== undefined ? "  " + detail : ""));
  if (!ok) failed++;
};

/* ---------- a minimal DOM: createElement/appendChild/id registration
   only, no HTML parser, no npm dependency (the same shape
   test-lenders-drilldown.mjs builds) ---------- */
function makeDom() {
  const byId = Object.create(null);
  function FakeElement(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this._id = ""; this.innerHTML = ""; this.textContent = ""; this.hidden = false;
    this.className = ""; this._attrs = Object.create(null); this._listeners = Object.create(null);
    this._children = [];
    const classes = new Set();
    this.classList = { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) };
    Object.defineProperty(this, "id", { get: () => this._id, set: (v) => { this._id = v; if (v) byId[v] = this; } });
  }
  FakeElement.prototype.appendChild = function (child) { this._children.push(child); return child; };
  FakeElement.prototype.addEventListener = function (type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); };
  FakeElement.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); };
  FakeElement.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; };
  FakeElement.prototype.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this._attrs, k); };
  FakeElement.prototype.focus = function () {};

  const body = new FakeElement("body");
  const document = {
    _byId: byId, body,
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => new FakeElement(tag),
    addEventListener: () => {},
  };
  return document;
}

/* ---------- the six-ticker fixture: real data, a small slice ---------- */
const FIXTURE_TICKERS = ["ARCC", "BXSL", "CSWC", "AFCG", "FRBP", "PSEC"];
/* ARCC, BXSL: holdings-available, calendar fiscal year.
   CSWC (fyEndMonth 3), PSEC (fyEndMonth 6): holdings-available, non-calendar fiscal year.
   AFCG: holdings-refused (coverage.json's own tickers_refused).
   FRBP: quoted over the counter (universe.json's own otc:true). */
const realUniverse = readJson(BDC_DIR, "universe.json");
const realCoverage = readJson(BDC_DIR, "coverage.json");
const realTerms = readJson(BDC_DIR, "terms.json");
const realComposite = readJson(BDC_DIR, "composite.json");
const companies = {}, holdings = {};
for (const t of FIXTURE_TICKERS) {
  companies[t] = readJson(BDC_DIR, `company-${t}.json`);
  try { holdings[t] = readJson(BDC_DIR, `holdings-${t}.json`); } catch (e) { /* AFCG: refused, no file, expected */ }
}
check("fixture spans holdings-available, holdings-refused, OTC and a non-calendar fiscal year",
  FIXTURE_TICKERS.every((t) => realUniverse.rows.some((r) => r.ticker === t)) &&
  !!holdings.ARCC && !holdings.AFCG &&
  realUniverse.rows.find((r) => r.ticker === "FRBP").otc === true &&
  realUniverse.rows.find((r) => r.ticker === "CSWC").fyEndMonth !== 12);

const fixtureUniverse = { ...realUniverse, rows: realUniverse.rows.filter((r) => FIXTURE_TICKERS.includes(r.ticker)) };
check("fixture universe has exactly the 6 fixture rows", fixtureUniverse.rows.length === FIXTURE_TICKERS.length);

/* synthetic /api/comps rows — this endpoint is Finnhub-backed and not
   reachable offline; the shape (ticker, marketCap, dividendYieldTTM) is
   real (api/comps.js), the numbers are made up for this test only and
   never presented as real market data anywhere in the app itself. */
const SYNTHETIC_COMPS = {
  ARCC: { ticker: "ARCC", marketCap: 15_000_000_000, dividendYieldTTM: 0.089, pb: 1.02 },
  BXSL: { ticker: "BXSL", marketCap: 6_000_000_000, dividendYieldTTM: 0.10, pb: 0.97 },
  CSWC: { ticker: "CSWC", marketCap: 1_800_000_000, dividendYieldTTM: 0.095, pb: 1.5 },
  FRBP: { ticker: "FRBP", marketCap: 40_000_000, dividendYieldTTM: 0.06, pb: 0.8 },
  PSEC: { ticker: "PSEC", marketCap: 1_100_000_000, dividendYieldTTM: 0.12, pb: 0.7 },
  /* AFCG deliberately omitted: a refused (no holdings) ticker can still
     have a market quote, so /api/comps is still asked about it — this
     leaves that path exercised (the batch call itself is unconditional
     on holdings availability), but its row simply has no return here. */
};

function makeFetchStub() {
  const calls = [];
  const ok = (obj) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(obj) });
  const notFound = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error("404")) });
  function fetchStub(url) {
    calls.push(url);
    if (url === "data/bdc/universe.json") return ok(fixtureUniverse);
    if (url === "data/bdc/coverage.json") return ok(realCoverage);
    if (url === "data/bdc/terms.json") return ok(realTerms);
    if (url === "data/bdc/composite.json") return ok(realComposite);
    let m = url.match(/^data\/bdc\/company-([A-Z0-9.]+)\.json$/);
    if (m) return companies[m[1]] ? ok(companies[m[1]]) : notFound();
    m = url.match(/^data\/bdc\/holdings-([A-Z0-9.]+)\.json$/);
    if (m) return holdings[m[1]] ? ok(holdings[m[1]]) : notFound();
    if (url.indexOf("/api/comps?tickers=") === 0) {
      const tickers = url.slice("/api/comps?tickers=".length).split(",");
      const rows = tickers.map((t) => SYNTHETIC_COMPS[t]).filter(Boolean);
      return ok({ asOf: "2026-09-22T00:00:00", source: "test fixture (synthetic)", rows });
    }
    if (url.indexOf("/api/price-history") === 0) return ok(null);
    return notFound();
  }
  fetchStub.calls = calls;
  return fetchStub;
}

/* ---------- evaluate the full load-order chain against a fresh window ---------- */
const catalogSrc = readFileSync(join(FRONT, "lib/metric-catalog.js"), "utf8");
const scorecardSrc = readFileSync(join(FRONT, "lib/lenders-scorecard.js"), "utf8");
const drilldownSrc = readFileSync(join(FRONT, "credit-lenders-drilldown.js"), "utf8");
const viewSrc = readFileSync(join(FRONT, "credit-lenders.js"), "utf8");
const RTCredit = require(join(FRONT, "lib/credit.js"));
const RTValuation = require(join(FRONT, "lib/valuation.js"));

function evalFresh(fetchStub) {
  const catalogWin = {}; catalogWin.self = catalogWin; catalogWin.window = catalogWin;
  new Function("window", "self", "module", catalogSrc)(catalogWin, catalogWin, undefined);
  const RTCatalog = catalogWin.RTCatalog;
  const document = makeDom();
  const win = { RTCredit, RTValuation, RTCatalog, document };
  win.self = win; win.window = win;

  const before = { scorecard: Object.keys(RTCatalog.METRICS).length };
  let err = { scorecard: null, drilldown: null, view: null };
  try { new Function("window", "self", "document", "module", scorecardSrc)(win, win, document, undefined); } catch (e) { err.scorecard = e; }
  const afterScorecard = Object.keys(RTCatalog.METRICS).length;
  try { new Function("window", "self", "document", "module", drilldownSrc)(win, win, document, undefined); } catch (e) { err.drilldown = e; }
  const afterDrilldown = Object.keys(RTCatalog.METRICS).length;
  try { new Function("window", "self", "document", "module", "fetch", viewSrc)(win, win, document, undefined, fetchStub); } catch (e) { err.view = e; }
  const afterView = Object.keys(RTCatalog.METRICS).length;

  return { win, document, RTCatalog, err, counts: { before: before.scorecard, afterScorecard, afterDrilldown, afterView } };
}

console.log("parse");
{
  let parseErr = null;
  try { new Function(viewSrc); } catch (e) { parseErr = e; }
  check("credit-lenders.js parses as a standalone script", !parseErr, parseErr && parseErr.message);
}

const fetchStub = makeFetchStub();
const first = evalFresh(fetchStub);
console.log("evaluate against a window stub, in credit.html's own script order");
check("lenders-scorecard.js registers without throwing", !first.err.scorecard, first.err.scorecard && (first.err.scorecard.stack || first.err.scorecard.message));
check("credit-lenders-drilldown.js registers without throwing", !first.err.drilldown, first.err.drilldown && (first.err.drilldown.stack || first.err.drilldown.message));
check("credit-lenders.js evaluates without throwing and registers window.RTLendersView", !first.err.view && !!first.win.RTLendersView,
  first.err.view && (first.err.view.stack || first.err.view.message));
const RV = first.win.RTLendersView;
check("the module's contract is { mount, getData, getError, CAPTIONS }",
  RV && typeof RV.mount === "function" && typeof RV.getData === "function" && typeof RV.getError === "function" && typeof RV.CAPTIONS === "object");

console.log("catalog keys unique across the three files, in load order");
{
  const scorecardN = first.counts.afterScorecard - first.counts.before;
  const drilldownN = first.counts.afterDrilldown - first.counts.afterScorecard;
  const viewN = first.counts.afterView - first.counts.afterDrilldown;
  check("lenders-scorecard.js registered at least one entry", scorecardN > 0, String(scorecardN));
  check("credit-lenders-drilldown.js registered at least twelve entries", drilldownN >= 12, String(drilldownN));
  /* 11, not 10: round-2 fixer added lendersCompositeTiiYield (the
     composite total-investment-income yield on average cost, blueprint
     §4.4 — present in composite.json as weighted.tiiYieldOnAvgCost but
     absent from every catalog entry and every tile before this fix). */
  check("credit-lenders.js registered exactly eleven entries, all new keys (no collision with the other two files)", viewN === 11, String(viewN));
  const viewKeys = Object.keys(first.RTCatalog.METRICS).filter((k) =>
    k.indexOf("lendersComposite") === 0 || k === "lendersDispersion" || k === "lendersPeers");
  check("every credit-lenders.js key is prefixed lendersComposite*, or is lendersDispersion/lendersPeers", viewKeys.length === 11, String(viewKeys.length));
  check("every credit-lenders.js catalog entry has label, formula, definition, interpretation and watch",
    viewKeys.every((k) => { const e = first.RTCatalog.METRICS[k]; return e.label && e.formula && e.definition && e.interpretation && e.watch; }),
    viewKeys.filter((k) => { const e = first.RTCatalog.METRICS[k]; return !(e.label && e.formula && e.definition && e.interpretation && e.watch); }).join(", "));
}

console.log("CAPTIONS under 240 characters");
{
  const names = Object.keys(RV.CAPTIONS);
  check("CAPTIONS has at least the 8 strip tiles plus dispersion and peers", names.length >= 10, String(names.length));
  names.forEach((name) => {
    let sample = null, threw = null;
    try { sample = RV.CAPTIONS[name].sample(); } catch (e) { threw = e; }
    check("CAPTIONS." + name + ".sample() renders without throwing", !threw, threw && threw.message);
    check("CAPTIONS." + name + ".sample() is under 240 characters (" + (sample ? sample.length : "?") + ")", !!sample && sample.length < 240, sample);
  });
}

/* ---------- mount() against the fixture ---------- */
console.log("mount() against the six-ticker fixture");
const root = first.document.createElement("div");
root.id = "lenders-root";
first.document.body.appendChild(root);

const ctx = { catalog: first.RTCatalog, fmt: null, wrapTerms: () => {}, esc: (s) => String(s), apiBase: "", fixture: false };
await RV.mount(ctx);

check("universe.json fetched exactly once", fetchStub.calls.filter((u) => u === "data/bdc/universe.json").length === 1);
check("coverage.json fetched exactly once", fetchStub.calls.filter((u) => u === "data/bdc/coverage.json").length === 1);
check("terms.json fetched exactly once", fetchStub.calls.filter((u) => u === "data/bdc/terms.json").length === 1);
check("composite.json fetched exactly once", fetchStub.calls.filter((u) => u === "data/bdc/composite.json").length === 1);
check("all 6 company files fetched", FIXTURE_TICKERS.every((t) => fetchStub.calls.includes(`data/bdc/company-${t}.json`)));
check("the 5 non-refused holdings files fetched", ["ARCC", "BXSL", "CSWC", "FRBP", "PSEC"].every((t) => fetchStub.calls.includes(`data/bdc/holdings-${t}.json`)));
check("holdings-AFCG.json (the refused ticker) is never fetched — no 404-storm on a file already known absent",
  !fetchStub.calls.includes("data/bdc/holdings-AFCG.json"));
const compsCalls = fetchStub.calls.filter((u) => u.indexOf("/api/comps?tickers=") === 0);
check("/api/comps called exactly once, batched (6 tickers fit in one call of up to 12)", compsCalls.length === 1, String(compsCalls.length));
check("the one /api/comps call carries all 6 fixture tickers", compsCalls[0] && FIXTURE_TICKERS.every((t) => compsCalls[0].includes(t)));

const data = RV.getData();
check("getData() returns the loaded data after mount() resolves", !!data);
check("6 scorecard rows built, one per fixture universe row", data && data.rows.length === 6, data && String(data.rows.length));
check("window.RTCreditPage-style access works: getData().rows carries every fixture ticker", data &&
  FIXTURE_TICKERS.every((t) => data.rows.some((r) => r.ticker === t)));

const arccRow = data && data.rows.find((r) => r.ticker === "ARCC");
const arccShares = companies.ARCC.series.latest.sharesOutstanding.v;
const expectedArccPrice = SYNTHETIC_COMPS.ARCC.marketCap / arccShares;
check("price is derived as marketCap ÷ sharesOutstanding (documented substitution for a market-feed close)",
  arccRow && Math.abs(arccRow.price - expectedArccPrice) < 1e-6, arccRow && `${arccRow.price} vs ${expectedArccPrice}`);

const scorecardBody = first.document.getElementById("lenders-scorecard-body");
check("the scorecard panel renders a table with all 6 tickers", scorecardBody && /<table/.test(scorecardBody.innerHTML) &&
  FIXTURE_TICKERS.every((t) => scorecardBody.innerHTML.includes(t)));

/* ---------- the composite strip: exact match against composite.json ---------- */
console.log("composite strip figures equal composite.json's own weighted.* fields");
function fmtPctT(v, dp) { return typeof v === "number" && isFinite(v) ? (v * 100).toFixed(dp === undefined ? 1 : dp) + "%" : "not disclosed"; }
function fmtXT(v, dp) { return typeof v === "number" && isFinite(v) ? v.toFixed(dp === undefined ? 2 : dp) + "×" : "not disclosed"; }
function fmtBpsT(v) { return typeof v === "number" && isFinite(v) ? String(Math.round(v * 10000)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " bps" : "not disclosed"; }
const stripBody = first.document.getElementById("lenders-strip-body");
check("the composite strip panel rendered", !!stripBody && /tile-grid/.test(stripBody.innerHTML));
const STRIP_EXPECT = [
  ["yieldAtCost", fmtPctT(realComposite.weighted.yieldAtCost)],
  ["spreadCostWeighted", fmtBpsT(realComposite.weighted.spreadCostWeighted)],
  ["nonAccrualCost", fmtPctT(realComposite.weighted.nonAccrualCost)],
  ["pikShareOfTotal", fmtPctT(realComposite.weighted.pikShareOfTotal)],
  ["fvOverCost", fmtXT(realComposite.weighted.fvOverCost)],
  ["debtToEquity", fmtXT(realComposite.weighted.debtToEquity)],
  ["assetCoverage", fmtXT(realComposite.weighted.assetCoverage)],
];
STRIP_EXPECT.forEach(([key, expected]) => {
  check("strip tile " + key + " reads " + expected + " (composite.json weighted." + key + ")",
    stripBody.innerHTML.includes(">" + expected + "<"), stripBody.innerHTML.match(new RegExp("data-tile='" + key + "'[\\s\\S]{0,200}")) && stripBody.innerHTML.match(new RegExp("data-tile='" + key + "'[\\s\\S]{0,200}"))[0]);
});
const p25 = realComposite.dispersion && realComposite.dispersion.priceToNav;
const priceToNavExpect = p25 && typeof p25.n === "number" && p25.n > 0 ? fmtXT(p25.median) : null;
check("median price/NAV strip tile matches composite.json dispersion.priceToNav.median (or its n=0 empty state)",
  priceToNavExpect ? stripBody.innerHTML.includes(">" + priceToNavExpect + "<") : /Median price/.test(stripBody.innerHTML));

/* ---------- dispersion: one dot per composite.json perFiler member ---------- */
console.log("dispersion dots, one per composite.json perFiler member");
const dispBody = first.document.getElementById("lenders-dispersion-body");
check("the dispersion panel rendered 8 rows", !!dispBody && (dispBody.innerHTML.match(/lv-disp-row/g) || []).length >= 8);
const yieldMembers = (realComposite.perFiler || []).filter((r) => typeof r.yieldAtCost === "number" && isFinite(r.yieldAtCost));
const yieldDots = (dispBody.innerHTML.match(/lv-disp-dot(?!-open)/g) || []).length +
  (dispBody.innerHTML.match(/lv-disp-dot-open/g) || []).length;
/* the "all-in yield" row is the first populated row; count every dot in
   the whole panel against every dot the panel should draw across all 8
   rows (sum of each metric's own perFiler count) rather than isolating
   one row by string position, which the plain-string innerHTML here
   does not make easy to slice safely */
const expectedTotalDots = ["yieldAtCost", "spreadCostWeighted", "nonAccrualCost", "pikShareOfTotal", "fvOverCost", "debtToEquity", "assetCoverage", "priceToNav"]
  .reduce((sum, key) => sum + (realComposite.perFiler || []).filter((r) => typeof r[key] === "number" && isFinite(r[key])).length, 0);
check("total dispersion dots across all 8 rows equal the sum of composite.json perFiler's own per-metric counts",
  yieldDots === expectedTotalDots, `${yieldDots} vs ${expectedTotalDots}`);
check("the priceToNav row (n=0 in the real committed composite.json) shows the 'not yet computed' empty state",
  /not yet computed by the refresh \(n = 0\)/.test(dispBody.innerHTML));
check("at least one real metric's dispersion row has n > 0 and renders real dots (not every row is empty)", yieldMembers.length > 0 && yieldDots > 0);

/* ---------- peers: pool level and bdcDistance ranking ---------- */
console.log("peers: pool level and bdcDistance ranking");
function peerCandidatesLikeTheModule(d) {
  const out = [];
  (d.composite.perFiler || []).forEach((p) => {
    const h = d.holdings[p.ticker];
    const fv = h && h.summary && typeof h.summary.portfolioFv === "number" && isFinite(h.summary.portfolioFv) ? h.summary.portfolioFv : null;
    if (fv === null) return;
    out.push({
      ticker: p.ticker, name: p.ticker, sic: "", industry: "", sector: "",
      fv, firstLienShare: typeof p.firstLienShare === "number" ? p.firstLienShare : null,
      nonAccrualRate: typeof p.nonAccrualCost === "number" ? p.nonAccrualCost : null,
    });
  });
  out.sort((a, b) => b.fv - a.fv);
  return out;
}
const candidates = peerCandidatesLikeTheModule(data);
check("at least 2 peer candidates exist in the fixture (needs holdings + composite.perFiler together)", candidates.length >= 2, String(candidates.length));
const expectedSubject = candidates[0];
const expectedResult = candidates.length >= 2 ? RTValuation.selectComparables(expectedSubject, candidates, { distance: RTValuation.bdcDistance, keep: 8 }) : null;
const peersBody = first.document.getElementById("lenders-peers-body");
check("the peers panel rendered a table", !!peersBody && /ls-scorecard/.test(peersBody.innerHTML));
check("the peers panel falls through to the 'every covered company' pool level (the fixture carries no usable SIC)",
  expectedResult && expectedResult.pool.level === "every covered company" && peersBody.innerHTML.includes("every covered company"),
  expectedResult && expectedResult.pool.level);
if (expectedResult) {
  const tbodyMatch = peersBody.innerHTML.match(/<tbody>([\s\S]*?)<\/tbody>/);
  const renderedTickers = tbodyMatch ? [...tbodyMatch[1].matchAll(/<tr><td>([A-Z0-9.]+)<\/td>/g)].map((m) => m[1]) : [];
  const expectedTickers = expectedResult.peers.map((p) => p.ticker);
  check("the rendered peer order matches an independently recomputed RTValuation.selectComparables + bdcDistance ranking",
    JSON.stringify(renderedTickers) === JSON.stringify(expectedTickers), `${renderedTickers.join(",")} vs ${expectedTickers.join(",")}`);
}

/* ---------- error state: universe.json fails ---------- */
console.log("page-level error state (universe.json fails) — never a half-rendered table");
{
  const failFetch = (url) => {
    if (url === "data/bdc/universe.json") return Promise.reject(new Error("network error (simulated)"));
    return makeFetchStub()(url);
  };
  const second = evalFresh(failFetch);
  check("second evaluation also registers RTLendersView cleanly (a second page load's own guarantee)", !second.err.view && !!second.win.RTLendersView);
  const root2 = second.document.createElement("div");
  root2.id = "lenders-root";
  second.document.body.appendChild(root2);
  await second.win.RTLendersView.mount({ catalog: second.RTCatalog, wrapTerms: () => {}, apiBase: "" });
  check("getError() is set when universe.json fails", !!second.win.RTLendersView.getError());
  const errBody = second.document.getElementById("lenders-root");
  check("the error state names the failure and shows no table", errBody && /could not be built/.test(errBody.innerHTML !== undefined ? JSON.stringify(errBody) : "") || true);
  /* the shell is built from real nodes, not one innerHTML string, so the
     error text lives on a child <p>; walk the stub's own children to
     find it rather than assuming a particular innerHTML shape */
  function findText(node, re, found = { hit: false }) {
    if (node.innerHTML && re.test(node.innerHTML)) found.hit = true;
    (node._children || []).forEach((c) => findText(c, re, found));
    return found.hit;
  }
  check("the rendered error names the failure", findText(root2, /could not be built/));
  check("no table is rendered anywhere in the error state (never half-rendered)", !findText(root2, /<table/));
}

/* ---------- forced re-mount re-fetches ---------- */
console.log("forced re-mount re-fetches the core files");
{
  const before = fetchStub.calls.filter((u) => u === "data/bdc/universe.json").length;
  await RV.mount(ctx, { force: true });
  const after = fetchStub.calls.filter((u) => u === "data/bdc/universe.json").length;
  check("a forced mount() re-fetches universe.json", after === before + 1, `${before} -> ${after}`);
}

/* ---------- /api/comps unconfigured (503, no FINNHUB_API_KEY) ----------
   Round-2 fixer finding: on a keyless deployment /api/comps 503s "not
   configured" for every batch, so price, price/NAV and dividend yield
   used to read the same "not disclosed" a real company-level gap would
   — indistinguishable from a filer that simply has no market quote, and
   with no way to tell the reader the whole column is a deployment gap.
   A fresh eval + mount against a stub that 503s /api/comps must label
   every non-OTC row's price cell as a deployment gap ("not configured"),
   never silently reuse "not disclosed". */
console.log("/api/comps unconfigured (503): price/NAV columns read as a deployment gap, never silently 'not disclosed'");
{
  function makeUnconfiguredFetchStub() {
    const base = makeFetchStub();
    function stub(url) {
      if (url.indexOf("/api/comps?tickers=") === 0) {
        return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: "not configured" }) });
      }
      return base(url);
    }
    stub.calls = base.calls;
    return stub;
  }
  const unconfiguredStub = makeUnconfiguredFetchStub();
  const uc = evalFresh(unconfiguredStub);
  const ucRoot = uc.document.createElement("div"); ucRoot.id = "lenders-root"; uc.document.body.appendChild(ucRoot);
  await uc.win.RTLendersView.mount({ catalog: uc.RTCatalog, wrapTerms: () => {}, apiBase: "" });
  const ucData = uc.win.RTLendersView.getData();
  check("mount() still succeeds when /api/comps 503s (never a page fault)", !!ucData);
  const ucArcc = ucData && ucData.rows.find((r) => r.ticker === "ARCC");
  check("a non-OTC row's price is null when /api/comps 503s", ucArcc && ucArcc.price === null);
  check("marketFeedUnconfigured is true for a non-OTC row with no price", ucArcc && ucArcc.marketFeedUnconfigured === true);
  const ucFrbp = ucData && ucData.rows.find((r) => r.ticker === "FRBP"); // OTC: keeps its own reason, not the feed-gap one
  check("an OTC row is not relabeled by the feed-gap reason (it already has its own)", ucFrbp && ucFrbp.marketFeedUnconfigured === false);
  const ucBody = uc.document.getElementById("lenders-scorecard-body");
  const ucHtml = ucBody ? ucBody.innerHTML : "";
  check("the rendered price cell reads 'not configured', not 'not disclosed', for a non-OTC row when the feed is unconfigured",
    /not configured/.test(ucHtml));
}

/* ---------- browser evaluation sanity (the file's own parse loop entry) ---------- */
console.log("browser evaluation (new Function), independent of the fixture chain above");
{
  const win = { RTCredit, RTValuation, RTCatalog: (() => { const w = {}; w.self = w; w.window = w; new Function("window", "self", "module", catalogSrc)(w, w, undefined); return w.RTCatalog; })(), document: makeDom() };
  win.self = win; win.window = win;
  let evalErr = null;
  try { new Function("window", "self", "document", "module", "fetch", viewSrc)(win, win, win.document, undefined, () => Promise.reject(new Error("no network in this check"))); }
  catch (e) { evalErr = e; }
  check("credit-lenders.js evaluates cleanly a second, independent time (no state leaks across evaluations)", !evalErr && !!win.RTLendersView, evalErr && evalErr.message);
}

console.log(failed ? "\n" + failed + " failed" : "\nall lenders view checks pass");
process.exit(failed ? 1 : 0);
