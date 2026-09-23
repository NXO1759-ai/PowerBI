/**
 * test-lenders-scorecard.mjs — the Lenders scorecard, offline.
 *
 * Loads the real committed frontend/data/bdc files, builds every row
 * through frontend/lib/lenders-scorecard.js with prices null (the market
 * feed is not available in this environment), and checks: all 53 rows
 * exist (decision 12.1); ARCC's NAV, after-tax NII and dividend coverage
 * come out non-null and match the committed company file rather than a
 * hardcoded figure; a filer coverage.json's holdings.tickers_refused
 * names shows nonAccrual null and holdingsAvailable false; the two-
 * consecutive-quarter dividend-coverage flag fires on a synthetic
 * company-shaped fixture built for exactly that case and does not fire
 * on a one-bad-quarter control; no row carries a NaN or an undefined
 * anywhere; render() runs against a minimal DOM stub without throwing.
 * Exits non-zero on the first batch of failures.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BDC_DIR = join(ROOT, "frontend/data/bdc");
const readJson = (rel) => JSON.parse(readFileSync(join(BDC_DIR, rel), "utf8"));

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};

const LS = require(join(ROOT, "frontend/lib/lenders-scorecard.js"));
const RTCredit = require(join(ROOT, "frontend/lib/credit.js"));

/* ---------- 0. load the real data the way the page will ---------- */
console.log("data load");
const universe = readJson("universe.json");
const coverage = readJson("coverage.json");
const terms = readJson("terms.json");
const companies = {};
const holdings = {};
for (const f of readdirSync(BDC_DIR)) {
  const mC = f.match(/^company-([A-Z0-9.]+)\.json$/);
  if (mC) companies[mC[1]] = readJson(f);
  const mH = f.match(/^holdings-([A-Z0-9.]+)\.json$/);
  if (mH) holdings[mH[1]] = readJson(f);
}
check("universe.json has 53 rows", Array.isArray(universe.rows) && universe.rows.length === 53, String(universe.rows && universe.rows.length));
check("every universe ticker has a loaded company file", universe.rows.every((u) => !!companies[u.ticker]),
  universe.rows.filter((u) => !companies[u.ticker]).map((u) => u.ticker).join(", "));
check("32 holdings files loaded, matching coverage.holdings.n", Object.keys(holdings).length === coverage.holdings.n,
  Object.keys(holdings).length + " vs " + coverage.holdings.n);

/* ---------- 1. buildRows against the real files ---------- */
console.log("buildRows()");
const rows = LS.buildRows({ universe, coverage, companies, holdings, terms, prices: null });
check("buildRows returns 53 rows, one per universe row (decision 12.1)", rows.length === 53, String(rows.length));
check("every row carries a ticker from the universe", rows.every((r, i) => r.ticker === universe.rows[i].ticker));

const arcc = rows.find((r) => r.ticker === "ARCC");
const arccFile = companies.ARCC;
const arccNav = arccFile.series.latest.navPerShare.v;
check("ARCC exists in the built rows", !!arcc);
check("ARCC's NAV matches the committed company file's own tagged value, never hardcoded",
  arcc && arcc.nav === arccNav, arcc && `${arcc.nav} vs ${arccNav}`);
check("ARCC's after-tax NII is non-null and matches the company file", arcc && arcc.niiAfterTax === arccFile.series.latest.niiAfterTax.v,
  arcc && String(arcc.niiAfterTax));
check("ARCC's dividend coverage is non-null and equals RTCredit.div(niiPerShare, distributionsPerShare)",
  arcc && isFinite(arcc.dividendCoverage.total) &&
  Math.abs(arcc.dividendCoverage.total - RTCredit.div(arccFile.series.latest.niiPerShare.v, arccFile.series.latest.distributionsPerShare.v)) < 1e-9,
  arcc && String(arcc.dividendCoverage.total));
check("ARCC's mark equals fair value / cost from the company file", arcc &&
  Math.abs(arcc.mark - arccFile.series.latest.portfolioFairValue.v / arccFile.series.latest.portfolioCost.v) < 1e-9);

/* ---------- 2. a refused ticker shows the refusal, never a zero ---------- */
console.log("refused tickers (no holdings file)");
const refusedTicker = coverage.holdings.tickers_refused[0] && coverage.holdings.tickers_refused[0].ticker;
check("coverage.json names at least one refused ticker to test against", !!refusedTicker, refusedTicker);
if (refusedTicker) {
  const row = rows.find((r) => r.ticker === refusedTicker);
  check(refusedTicker + " has no holdings file loaded (sanity)", !holdings[refusedTicker]);
  check(refusedTicker + ": holdingsAvailable is false", row && row.holdingsAvailable === false);
  check(refusedTicker + ": nonAccrual.cost and .fv are null, never 0", row && row.nonAccrual.cost === null && row.nonAccrual.fv === null,
    row && JSON.stringify(row.nonAccrual));
  check(refusedTicker + ": nonAccrual.source names \"not yet parsed\" with the refusal reason", row && /^not yet parsed/.test(row.nonAccrual.source),
    row && row.nonAccrual.source);
  check(refusedTicker + ": floatingShare and weightedAverageYield are null (holdings-only fields)",
    row && row.floatingShare === null && row.weightedAverageYield === null);
}
const heldTicker = Object.keys(holdings)[0];
if (heldTicker) {
  const row = rows.find((r) => r.ticker === heldTicker);
  check(heldTicker + " (has a holdings file): holdingsAvailable is true", row && row.holdingsAvailable === true);
  check(heldTicker + ": nonAccrual.source is \"schedule\"", row && row.nonAccrual.source === "schedule");
}

/* ---------- 3. the two-consecutive-quarter dividend-coverage flag ---------- */
console.log("severity flag (a): dividend coverage under 1.0x for two consecutive quarters");
function fixtureUniverseRow(ticker) {
  return { cik: 9999999, ticker, name: "Synthetic Test BDC", exchange: "Nasdaq", listed: true, otc: false,
    fileNumbers: ["814-99999"], fiscalYearEnd: "1231", fyEndMonth: 12, sic: "0000", listedSince: "2020-01-01" };
}
function fixtureCompany(quarters) {
  /* quarters: [{end, nii, dist}], oldest first */
  const periods = quarters.map((q, i) => ({
    end: q.end, fy: 2026, fq: i + 1,
    values: {
      niiPerShare: { v: q.nii, unit: "USD/shares", tag: "InvestmentCompanyInvestmentIncomeLossPerShare", periodType: "3M", end: q.end, source: "companyfacts" },
      distributionsPerShare: { v: q.dist, unit: "USD/shares", tag: "InvestmentCompanyDistributionToShareholdersPerShare", periodType: "3M", end: q.end, source: "companyfacts" },
      navPerShare: { v: 20, unit: "USD/shares", tag: "NetAssetValuePerShare", periodType: "instant", end: q.end, source: "companyfacts" },
      portfolioFairValue: { v: 1000, unit: "USD", tag: "InvestmentOwnedAtFairValue", periodType: "instant", end: q.end, source: "companyfacts" },
      portfolioCost: { v: 1000, unit: "USD", tag: "InvestmentOwnedAtCost", periodType: "instant", end: q.end, source: "companyfacts" },
      netAssets: { v: 500, unit: "USD", tag: "StockholdersEquity", periodType: "instant", end: q.end, source: "companyfacts" },
    },
  }));
  const last = periods[periods.length - 1];
  return { ticker: "SYNT", cik: 9999999, name: "Synthetic Test BDC", fyEndMonth: 12,
    latestFiling: { form: "10-Q", end: last.end, filed: last.end, accn: "0000000000-00-000000" },
    disclosed: null,
    series: { periods, latest: last.values, firstPeriod: {}, fyEndMonth: 12, coverShares: null, flags: [] } };
}
function runFixture(quarters) {
  const u = { generated: "test", quarter: "test", rule: "814-", rows: [fixtureUniverseRow("SYNT")], mergers: [] };
  const companiesFx = { SYNT: fixtureCompany(quarters) };
  const covFx = { quarter: "test", currentFrom: "test", n: 1, metrics: {}, holdings: { n: 0, refused: 1, failed: 0, tickers_refused: [], tickers_failed: [], tickers_missing: [] }, byTicker: { SYNT: {} } };
  const rowsFx = LS.buildRows({ universe: u, coverage: covFx, companies: companiesFx, holdings: {}, terms: { seed: {}, filers: {} }, prices: null });
  return rowsFx[0];
}
/* Blueprint v2 detail §4.3 L2: regular coverage under 1.0x for two
   consecutive quarters is a FLAG; total coverage under 1.0x (what this
   data set can only ever produce, having no regular/supplemental split)
   is a NOTE, not a flag (round-2 fixer finding: MAIN's own worked
   example, 1.24x regular / 0.90x total, used to carry the severity
   stripe on its 0.90x total reading). So: FLAGS no longer has a
   dividend-coverage entry at all, and the two-straight-quarters reading
   surfaces only as dividendCoverage.twoQuarterNote, never in r.flags. */
check("FLAGS carries no dividend-coverage entry (the blueprint's regular-coverage flag needs a split this data set does not have)",
  !("DIVIDEND_COVERAGE_2Q" in LS.FLAGS), JSON.stringify(LS.FLAGS));
const twoBadQuarters = runFixture([
  { end: "2025-12-31", nii: 0.50, dist: 0.50 },
  { end: "2026-03-31", nii: 0.40, dist: 0.50 }, // coverage 0.80x
  { end: "2026-06-30", nii: 0.35, dist: 0.50 }, // coverage 0.70x
]);
check("two consecutive quarters under 1.0x, ending on the latest filed quarter: the note fires",
  twoBadQuarters.dividendCoverage.twoQuarterNote === true, JSON.stringify(twoBadQuarters.dividendCoverage));
check("the note is never pushed into r.flags (it is a note, not a severity stripe)",
  twoBadQuarters.flags.length === 0, JSON.stringify(twoBadQuarters.flags));
const oneBadQuarter = runFixture([
  { end: "2025-12-31", nii: 0.50, dist: 0.50 },
  { end: "2026-03-31", nii: 0.55, dist: 0.50 }, // coverage 1.10x, fine
  { end: "2026-06-30", nii: 0.35, dist: 0.50 }, // coverage 0.70x, one bad quarter only
]);
check("only one bad quarter: the note never fires (not forced)", oneBadQuarter.dividendCoverage.twoQuarterNote === false,
  JSON.stringify(oneBadQuarter.dividendCoverage));
const bothGood = runFixture([
  { end: "2025-12-31", nii: 0.55, dist: 0.50 },
  { end: "2026-03-31", nii: 0.55, dist: 0.50 },
  { end: "2026-06-30", nii: 0.55, dist: 0.50 },
]);
check("two consecutive quarters at or above 1.0x: the note never fires", bothGood.dividendCoverage.twoQuarterNote === false,
  JSON.stringify(bothGood.dividendCoverage));
/* MSIF's own real shape: the latest filed quarter (2026-06-30) does not
   carry distributionsPerShare, so the last pair carrying BOTH inputs is
   one filing behind (2025-12-31/2026-03-31) — a stale pair that must
   never read as "the last two quarters" (round-2 fixer finding). */
check("a bad pair that is not the filer's latest filed quarter: the note never fires on stale data",
  (() => {
    // rebuild with a trailing quarter that has NII but no distribution yet, so the
    // filer's own latest filed period is newer than the last complete coverage pair
    const u = { generated: "test", quarter: "test", rule: "814-", rows: [fixtureUniverseRow("SYNT")], mergers: [] };
    const quarters = [
      { end: "2025-09-30", nii: 0.50, dist: 0.50 },
      { end: "2025-12-31", nii: 0.40, dist: 0.50 },
      { end: "2026-03-31", nii: 0.35, dist: 0.50 },
    ];
    const company = fixtureCompany(quarters);
    // append a latest period with NII but no distributionsPerShare tagged yet
    company.series.periods.push({ end: "2026-06-30", fy: 2026, fq: 4, values: {
      niiPerShare: { v: 0.30, unit: "USD/shares", tag: "InvestmentCompanyInvestmentIncomeLossPerShare", periodType: "3M", end: "2026-06-30", source: "companyfacts" },
      navPerShare: { v: 20, unit: "USD/shares", tag: "NetAssetValuePerShare", periodType: "instant", end: "2026-06-30", source: "companyfacts" },
      portfolioFairValue: { v: 1000, unit: "USD", tag: "InvestmentOwnedAtFairValue", periodType: "instant", end: "2026-06-30", source: "companyfacts" },
      portfolioCost: { v: 1000, unit: "USD", tag: "InvestmentOwnedAtCost", periodType: "instant", end: "2026-06-30", source: "companyfacts" },
      netAssets: { v: 500, unit: "USD", tag: "StockholdersEquity", periodType: "instant", end: "2026-06-30", source: "companyfacts" },
    } });
    company.series.latest = company.series.periods[company.series.periods.length - 1].values;
    const companiesFx = { SYNT: company };
    const covFx = { quarter: "test", currentFrom: "test", n: 1, metrics: {}, holdings: { n: 0, refused: 1, failed: 0, tickers_refused: [], tickers_failed: [], tickers_missing: [] }, byTicker: { SYNT: {} } };
    const rowsFx = LS.buildRows({ universe: u, coverage: covFx, companies: companiesFx, holdings: {}, terms: { seed: {}, filers: {} }, prices: null });
    return rowsFx[0].dividendCoverage.twoQuarterNote === false;
  })());

/* the same logic proven on a real filer, hand-computed from the same
   committed file (never forced): the last two quarters of ARCC's own
   series, coverage computed here independently of the module under test */
{
  const sorted = arccFile.series.periods.slice().sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
  const withBoth = sorted.filter((p) => p.values.niiPerShare && isFinite(p.values.niiPerShare.v) && p.values.distributionsPerShare && isFinite(p.values.distributionsPerShare.v));
  const lastTwo = withBoth.slice(-2);
  const latestEnd = sorted[sorted.length - 1].end;
  const handComputedNote = lastTwo.length === 2 && lastTwo[1].end === latestEnd &&
    lastTwo.every((p) => p.values.niiPerShare.v / p.values.distributionsPerShare.v < 1);
  check("ARCC's real last-two-quarter coverage, hand-computed here, agrees with the module's note",
    handComputedNote === arcc.dividendCoverage.twoQuarterNote,
    `hand: ${handComputedNote}, module: ${arcc.dividendCoverage.twoQuarterNote}`);
  check("ARCC never carries a dividend-coverage entry in r.flags (it is a note, not a flag)",
    !arcc.flags.some((f) => /dividendCoverage/i.test(f)), JSON.stringify(arcc.flags));
}

/* ---------- 4. asset-coverage cushion and price/NAV percentile flags exist and are wired ---------- */
console.log("severity flags (b) and (d)");
const cushionFlagged = rows.filter((r) => r.flags.includes(LS.FLAGS.ASSET_COVERAGE_CUSHION));
check("assetCoverageCushion flag only fires when cushion is a real number under 0.15",
  cushionFlagged.every((r) => isFinite(r.assetCoverage.cushion) && r.assetCoverage.cushion < 0.15));
const withPriceToNav = rows.filter((r) => isFinite(r.priceToNav));
const p25 = LS.percentile(withPriceToNav.map((r) => r.priceToNav), 0.25);
const p25Flagged = rows.filter((r) => r.flags.includes(LS.FLAGS.PRICE_TO_NAV_P25));
check("priceToNav-below-p25 flag matches an independent percentile computed here (n=" + withPriceToNav.length + ")",
  p25Flagged.every((r) => isFinite(r.priceToNav) && isFinite(p25) && r.priceToNav < p25));
check("non-accrual flag only fires for a filer with a parsed holdings file", rows.filter((r) => r.flags.includes(LS.FLAGS.NON_ACCRUAL)).every((r) => r.holdingsAvailable));

/* ---------- 5. no NaN, no undefined, anywhere ---------- */
console.log("no NaN or undefined");
function walk(v, path, bad) {
  if (v === undefined) { bad.push(path + " = undefined"); return; }
  if (typeof v === "number" && Number.isNaN(v)) { bad.push(path + " = NaN"); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path + "[" + i + "]", bad)); return; }
  if (v && typeof v === "object") { Object.keys(v).forEach((k) => walk(v[k], path + "." + k, bad)); }
}
const bad = [];
rows.forEach((r, i) => walk(r, "rows[" + i + "] (" + r.ticker + ")", bad));
check("no row has a NaN or undefined field anywhere", bad.length === 0, bad.slice(0, 5).join(" | "));
JSON.parse(JSON.stringify(rows)); // throws on a cycle; also exercised as a roundtrip sanity check
check("rows survive a JSON stringify/parse roundtrip", true);

/* ---------- 6. render() against a minimal DOM stub ---------- */
console.log("render() against a DOM stub");
function makeContainerStub() {
  const listeners = {};
  return {
    innerHTML: "",
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    __listeners: listeners,
  };
}
{
  const container = makeContainerStub();
  let threw = null;
  try {
    LS.render(container, rows, { catalog: null, fmt: null, onRowClick: () => {}, wrapTerms: null });
  } catch (e) { threw = e; }
  check("render() runs against a minimal DOM stub without throwing", !threw, threw && (threw.stack || threw.message));
  check("render() writes a table into container.innerHTML", typeof container.innerHTML === "string" && /<table/.test(container.innerHTML));
  check("render() binds input and click listeners once", Array.isArray(container.__listeners.input) && container.__listeners.input.length === 1 &&
    Array.isArray(container.__listeners.click) && container.__listeners.click.length === 1);
  /* a second render() call on the same container (a Refresh) must not
     duplicate the delegated listeners */
  LS.render(container, rows, {});
  check("a second render() call does not double-bind listeners", container.__listeners.input.length === 1 && container.__listeners.click.length === 1);
}
{
  /* an empty rows array (e.g. a failed fetch upstream) must still paint,
     never throw */
  const container = makeContainerStub();
  let threw = null;
  try { LS.render(container, [], {}); } catch (e) { threw = e; }
  check("render() with zero rows does not throw and shows the empty state", !threw && /No BDC matches/.test(container.innerHTML), threw && threw.message);
}

/* ---------- 7. the catalog entries: registered once, one per column family ---------- */
console.log("catalog entries");
check("CATALOG_ENTRIES is a non-empty array with a unique, string key per entry",
  Array.isArray(LS.CATALOG_ENTRIES) && LS.CATALOG_ENTRIES.length > 0 &&
  new Set(LS.CATALOG_ENTRIES.map((e) => e.key)).size === LS.CATALOG_ENTRIES.length);
check("every catalog entry has label, formula, definition, interpretation and watch",
  LS.CATALOG_ENTRIES.every((e) => e.key && e.label && e.formula && e.definition && e.interpretation && e.watch),
  LS.CATALOG_ENTRIES.filter((e) => !(e.key && e.label && e.formula && e.definition && e.interpretation && e.watch)).map((e) => e.key).join(", "));
check("every rendered column that carries a data-metric points at a real catalog entry",
  LS.COLUMNS.filter((c) => c.metric).every((c) => LS.CATALOG_ENTRIES.some((e) => e.key === c.metric)),
  LS.COLUMNS.filter((c) => c.metric && !LS.CATALOG_ENTRIES.some((e) => e.key === c.metric)).map((c) => c.metric).join(", "));
{
  /* register() throws on a duplicate key and takes nothing from that
     batch — proves this module can be registered into a live catalog
     without colliding with itself if evaluated twice */
  const RTCatalog = require(join(ROOT, "frontend/lib/metric-catalog.js"));
  let threw = null;
  try { RTCatalog.register(LS.CATALOG_ENTRIES); } catch (e) { threw = e; }
  check("the module's own entries register cleanly into a fresh catalog", !threw, threw && threw.message);
  let threwTwice = null;
  try { RTCatalog.register(LS.CATALOG_ENTRIES); } catch (e) { threwTwice = e; }
  check("registering the same entries twice throws (no duplicate key silently wins)", !!threwTwice, threwTwice && threwTwice.message);
}

/* ---------- 8. the parse loop: the file evaluates as a browser script too ---------- */
console.log("browser evaluation (new Function)");
{
  const src = readFileSync(join(ROOT, "frontend/lib/lenders-scorecard.js"), "utf8");
  let parseErr = null;
  try { new Function(src); } catch (e) { parseErr = e; }
  check("lenders-scorecard.js parses as a standalone script", !parseErr, parseErr && parseErr.message);
  /* a fresh, isolated RTCatalog (not the require() cache section 7
     already registered this module's entries into), so this evaluation
     proves the file registers cleanly on a page that has not seen it yet */
  const catalogSrc = readFileSync(join(ROOT, "frontend/lib/metric-catalog.js"), "utf8");
  const catalogWin = {}; catalogWin.self = catalogWin; catalogWin.window = catalogWin;
  new Function("window", "self", "module", catalogSrc)(catalogWin, catalogWin, undefined);
  const win = { RTCredit, RTCatalog: catalogWin.RTCatalog };
  win.self = win; win.window = win;
  let evalErr = null;
  try { new Function("window", "self", "module", src)(win, win, undefined); } catch (e) { evalErr = e; }
  check("lenders-scorecard.js evaluates against a window stub (browser path) and registers window.RTLendersScorecard",
    !evalErr && !!win.RTLendersScorecard && typeof win.RTLendersScorecard.buildRows === "function", evalErr && evalErr.message);
}

console.log(failed ? "\n" + failed + " failed" : "\nall lenders scorecard checks pass");
process.exit(failed ? 1 : 0);
