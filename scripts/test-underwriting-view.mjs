/**
 * test-underwriting-view.mjs — the Underwriting view's page controller,
 * offline (blueprint section 5, PR F).
 *
 * frontend/credit-underwriting.js is evaluated against a window stub in
 * credit.html's own script order — lib/metric-catalog.js, then the three
 * Market-view section files whose RTCatalog entries load first
 * (credit-stress.js, credit-capital.js, credit-dealflow.js), then this
 * file — so RTCatalog.register's "no duplicate key" throw is itself the
 * collision check: if any of this file's ten keys (U1–U4 plus the six
 * scorecard cards) already existed, evaluating it would throw and the
 * very first check below would fail.
 *
 * A stubbed fetch answers `data/underwriting.json` with a six-company
 * slice cut from the real, committed file (three ordinary covered
 * companies, NVIDIA's own untagged-ladder net-cash row exactly as
 * scripts/build-underwriting-panel.mjs wrote it, and one synthetic
 * no-usable-period row in buildRow()'s own null shape, since none of the
 * 137 live rows this week happens to be null) and answers /api/comps and
 * /api/fsa-note with canned replies. No network, no browser.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRONT = join(ROOT, "frontend");
let failed = 0;
const check = (n, ok, d) => { console.log((ok ? "  ok   " : "  FAIL ") + n + (d ? "  " + d : "")); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms || 0));

/* ---------- 1. a six-company fixture cut from the real, committed file ---------- */
const real = JSON.parse(readFileSync(join(FRONT, "data/underwriting.json"), "utf8"));
const TICKERS = ["AAPL", "NVDA", "T", "RTX"];
const absent = TICKERS.filter((t) => !real.companies[t]);
check("the fixture tickers are all in the committed underwriting.json (" + TICKERS.join(", ") + ")", absent.length === 0, absent.join(", "));

/* buildRow()'s own no-usable-period shape (scripts/build-underwriting-panel.mjs),
   reproduced verbatim for a ticker no real filer uses, since every one of
   the 137 covered companies this week happens to have a usable period —
   the view must still handle a company EDGAR did not answer for without
   dropping it or crashing */
const NULL_ROW = {
  ticker: "ZZZZ", name: "No Period Test Co", cik: null,
  industry: "Unclassified", sector: "Other", sic: null, sectorCaveat: null,
  basis: null, periodEnd: null, fiscalYear: null, fiscalPeriod: null, form: null, filed: null, accession: null,
  leverage: {
    ebitda: null, ebit: null, debtTotal: null, netDebt: null, bookEquity: null,
    debtToEbitda: null, netDebtToEbitda: null, ffo: null, ffoToDebt: null,
    interestExpense: null, interestCoverage: null,
    fixedChargeCoverage: { value: null, inputs: null },
    fcf: null, fcfToDebt: null, leverageNotComputableReason: null,
  },
  spBand: { debtToEbitda: null, netDebtToEbitda: null, ffoToDebt: null, worse: { basis: null, band: null, agree: null, note: null } },
  covenantHeadroom: null,
  maturityLadder: { remainderOfFiscalYear: null, nextTwelveMonths: null, yearTwo: null, yearThree: null, yearFour: null, yearFive: null, afterYearFive: null, tagged: false, asOf: null },
  liquidity: { cash: null, revolverCapacity: null, ltmFcf: null, nextTwelveMonthMaturities: null, leasePaymentsDue: null, runwayCoverage: null },
  debtFairValue: { fairValue: null, carryingValue: null, markPct: null },
  costOfDebt: { value: null, source: null, tag: null },
  notes: ["no LTM window or annual period available — never reported as a zero"],
};

const companies = {};
TICKERS.forEach((t) => { companies[t] = real.companies[t]; });
companies.ZZZZ = NULL_ROW;
const FIXTURE = {
  schemaVersion: 1,
  source: "SEC EDGAR XBRL companyfacts, via scripts/build-underwriting-panel.mjs (blueprint section 5) — test fixture, " + Object.keys(companies).length + " of " + real.n,
  n: Object.keys(companies).length,
  companies,
};

/* ---------- 2. window stub, credit.html's own script order ---------- */
function freshWindow() {
  delete require.cache[require.resolve(join(FRONT, "lib/metric-catalog.js"))];
  delete require.cache[require.resolve(join(FRONT, "lib/http.js"))];
  const win = {
    RTCreditSections: [],
    RTCatalog: require(join(FRONT, "lib/metric-catalog.js")),
    RTPcSeries: { load: () => Promise.resolve(), get: () => null, has: () => false, canonical: () => null },
    RTTerms: null,
    RTHttp: require(join(FRONT, "lib/http.js")),
    Chart: undefined,
  };
  win.self = win; win.window = win;
  return win;
}
function evalIn(win, file) {
  const src = readFileSync(join(FRONT, file), "utf8");
  new Function("window", "self", "module", src)(win, win, undefined);
}

const win = freshWindow();
for (const f of ["credit-stress.js", "credit-capital.js", "credit-dealflow.js"]) {
  try { evalIn(win, f); check(f + " evaluates first, credit.html's own script order", true); }
  catch (e) { check(f + " evaluates first, credit.html's own script order", false, e.message); }
}
const beforeKeys = Object.keys(win.RTCatalog.METRICS).length;

let evalErr = null;
try { evalIn(win, "credit-underwriting.js"); } catch (e) { evalErr = e; }
check("credit-underwriting.js evaluates against the window stub with no RTCatalog key collision", !evalErr, evalErr && evalErr.message);

const NEW_KEYS = ["u1LeverageCoverageScatter", "u2MaturityLadder", "u3LiquidityRunway", "u4CovenantHeadroom",
  "uwLeverageCoverage", "uwMaturityWall", "uwLiquidityRunway", "uwCovenantHeadroom", "uwPriorityRecovery", "uwCreditCycle"];
check("all ten catalog entries (U1–U4 and the six cards) registered",
  NEW_KEYS.every((k) => win.RTCatalog.get(k)), NEW_KEYS.filter((k) => !win.RTCatalog.get(k)).join(", "));
check("the catalog grew by exactly ten entries, nothing overwritten",
  Object.keys(win.RTCatalog.METRICS).length === beforeKeys + NEW_KEYS.length);
NEW_KEYS.forEach((k) => {
  const e = win.RTCatalog.get(k);
  check(k + " carries formula, definition and interpretation", !!(e && e.formula && e.definition && e.interpretation), k);
});
check("window.RTCreditUnderwriting is exposed with mount/selectTicker/writeNote/state", win.RTCreditUnderwriting &&
  typeof win.RTCreditUnderwriting.mount === "function" && typeof win.RTCreditUnderwriting.selectTicker === "function" &&
  typeof win.RTCreditUnderwriting.writeNote === "function" && typeof win.RTCreditUnderwriting.state === "function");

/* ---------- 3. a fake container: just enough for innerHTML + delegated events ---------- */
function makeContainer() {
  let html = "";
  return {
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; },
    addEventListener() { /* the offline test drives selection through the public API, not synthetic DOM events */ },
    querySelectorAll() { return []; },
  };
}

/* ---------- 4. mount against a stubbed fetch ---------- */
const calls = [];
const compsRow = { ticker: "AAPL", marketCap: 3.4e12, enterpriseValue: 3.6e12, ok: true };
globalThis.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  if (u.indexOf("data/underwriting.json") >= 0) return { ok: true, status: 200, text: async () => JSON.stringify(FIXTURE), json: async () => FIXTURE };
  if (u.indexOf("/api/comps") >= 0) {
    const body = { asOf: "2026-09-22T00:00:00", source: "test fixture", rows: [compsRow] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
  }
  if (u.indexOf("/api/fsa-note") >= 0) {
    const body = { note: "First paragraph of the committee note.\n\nSecond paragraph.\n\n— the research model", writtenAt: "2026-09-22T00:00:00Z" };
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
  }
  return { ok: false, status: 404, text: async () => "{}", json: async () => ({}) };
};

const container = makeContainer();
await win.RTCreditUnderwriting.mount(container);
check("mount() fetched the panel file", calls.some((u) => u.indexOf("data/underwriting.json") >= 0));
check("after mount, no company is pre-selected (the designed empty state before a selection)", win.RTCreditUnderwriting.state().selected === null);
check("the pre-selection empty state names the chart and the list", /choose a company from the list/i.test(container.innerHTML));
check("U1 plots at least one covered company", /uw-pt/.test(container.innerHTML));
check("a second mount() call re-renders without a second fetch of the panel file",
  await win.RTCreditUnderwriting.mount(container).then(() => calls.filter((u) => u.indexOf("data/underwriting.json") >= 0).length === 1));

/* ---------- 5. selecting a company updates U2–U4 and the summary ---------- */
await win.RTCreditUnderwriting.selectTicker("AAPL");
check("selectTicker updates state", win.RTCreditUnderwriting.state().selected === "AAPL");
check("the summary panel names the selected ticker", container.innerHTML.indexOf("Scorecard") >= 0 && container.innerHTML.indexOf("AAPL") >= 0);
check("U2/U3/U4 render for the selected company (the pre-selection empty state is gone)",
  !/choose a company from the list/i.test(container.innerHTML));
check("a live /api/comps call was made for the selected ticker only, never a fan-out",
  calls.filter((u) => u.indexOf("/api/comps") >= 0).length === 1 && /tickers=AAPL/.test(calls.find((u) => u.indexOf("/api/comps") >= 0)));
check("AAPL's loan-to-value renders from the live enterprise value (never typed)",
  new RegExp(((real.companies.AAPL.leverage.netDebt / compsRow.enterpriseValue) * 100).toFixed(1).replace(".", "\\.")).test(container.innerHTML));
await win.RTCreditUnderwriting.selectTicker("AAPL"); /* re-selecting the same ticker must not re-fetch the quote */
check("re-selecting the same company does not repeat the live quote call",
  calls.filter((u) => u.indexOf("/api/comps") >= 0).length === 1);

/* ---------- 6. a company with a null maturity ladder shows the designed empty state, never a zero ---------- */
await win.RTCreditUnderwriting.selectTicker("NVDA");
check("NVIDIA's own per-company empty state names it, not a fabricated schedule",
  /No maturity schedule tagged for NVDA\./.test(container.innerHTML));
check("NVIDIA's maturity section never prints a bar (it has none to show)", !/uw-bar-row/.test(container.innerHTML));
/* FIXER ROUND 1: covenant headroom is now driven off (gross) debt/EBITDA,
   not net — NVIDIA's own net-cash position (net debt/EBITDA negative) no
   longer blocks a band from being shown at all; it lands Minimal, the
   same placement card 1's "Overall S&P placement" shows, with the
   net-cash reading named separately rather than silently overriding
   whether a band is shown. */
check("NVIDIA's covenant headroom shows a real band off gross debt/EBITDA (Minimal) rather than being blocked by its net-cash position, which is named as a separate reading",
  /Currently Minimal/.test(container.innerHTML) && /net cash/i.test(container.innerHTML));
check("NVIDIA's loan-to-value is fetched fresh for the newly selected ticker (a second, distinct comps call)",
  calls.filter((u) => u.indexOf("/api/comps") >= 0).length === 2 && /tickers=NVDA/.test(calls[calls.length - 1]));

/* ---------- 7. AT&T / RTX: a tagged ladder renders real bars, not the empty state ---------- */
await win.RTCreditUnderwriting.selectTicker("T");
check("AT&T's tagged maturity ladder renders bars, not the empty state",
  /uw-bar-row/.test(container.innerHTML) && !/No maturity schedule tagged for T\./.test(container.innerHTML));
check("AT&T's ladder note states it is from the latest 10-K, not retagged in the LTM quarter",
  /latest 10-K/.test(container.innerHTML));

/* ---------- 8. a company with no usable period at all still renders, never dropped ---------- */
await win.RTCreditUnderwriting.selectTicker("ZZZZ");
check("a company with no usable period renders its own name rather than being dropped or crashing",
  container.innerHTML.indexOf("ZZZZ") >= 0);
check("its maturity ladder shows its own per-company empty state", /No maturity schedule tagged for ZZZZ\./.test(container.innerHTML));
check("its liquidity runway and covenant headroom are also the designed empty states, not zeros or a crash",
  /Liquidity runway not computable for ZZZZ\./.test(container.innerHTML) && /Covenant headroom not computable for ZZZZ\./.test(container.innerHTML));

/* ---------- 9. the note control: independent ids, right POST shape ---------- */
await win.RTCreditUnderwriting.selectTicker("AAPL");
const beforeNoteCalls = calls.filter((u) => u.indexOf("/api/fsa-note") >= 0).length;
let posted = null;
const priorFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.indexOf("/api/fsa-note") >= 0) {
    posted = JSON.parse(init.body);
    calls.push(u);
    const body = { note: "First paragraph.\n\nSecond paragraph.\n\n— the research model" };
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
  }
  return priorFetch(url, init);
};
await win.RTCreditUnderwriting.writeNote();
check("writeNote() posted to /api/fsa-note exactly once", calls.filter((u) => u.indexOf("/api/fsa-note") >= 0).length === beforeNoteCalls + 1);
check("the post carries kind underwriting (its own single-borrower committee-memo voice, not the Market view's cycle prompt), the selected ticker and at least three facts",
  !!posted && posted.kind === "underwriting" && posted.ticker === "AAPL" && Array.isArray(posted.facts) && posted.facts.length >= 3,
  JSON.stringify(posted));
check("the written note renders in the note body", /First paragraph\./.test(container.innerHTML));
check("the note control uses its own ids, distinct from the Market view's credit-note-btn", /id='uw-note-btn'/.test(container.innerHTML) && !/id='credit-note-btn'/.test(container.innerHTML));

/* ---------- 10. the view-level error state, a fresh module instance ---------- */
{
  const win2 = freshWindow();
  evalIn(win2, "credit-underwriting.js");
  const container2 = makeContainer();
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => JSON.stringify({ error: "not configured" }), json: async () => ({ error: "not configured" }) });
  await win2.RTCreditUnderwriting.mount(container2);
  check("a failed panel fetch renders the view-level error state, not a crash",
    /could not be loaded/i.test(container2.innerHTML) && win2.RTCreditUnderwriting.state().error);
}

globalThis.fetch = undefined;

/* ---------- 11. every caption template measures under 240 characters ---------- */
{
  const caps = win.RTCreditUnderwriting.CAPTIONS || {};
  const names = Object.keys(caps).filter((k) => caps[k] && typeof caps[k].sample === "function");
  check("at least one caption template is registered", names.length > 0, names.join(","));
  names.forEach((name) => {
    let text = null, err = null;
    try { text = caps[name].sample(); } catch (e) { err = e; }
    check("caption " + name + " sample() returns a string", typeof text === "string" && !err, err ? err.message : "");
    if (typeof text === "string") check("caption " + name + " measures under 240 characters", text.length < 240, text.length + " chars");
  });
}

console.log(failed ? "\n" + failed + " failed" : "\nall underwriting-view checks pass");
process.exit(failed ? 1 : 0);
