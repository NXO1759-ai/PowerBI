/**
 * test-buildout-view.mjs — the Build-out view (credit-buildout.js),
 * offline, following the window-stub pattern of scripts/test-pc-page.mjs.
 *
 * Five things, none needing a browser or the network:
 *
 *   1. credit-buildout.js parses and evaluates against the window stub,
 *      in credit.html's own script order (metric-catalog, credit-terms,
 *      pc-series, credit-buildout, credit.js's own captions, then
 *      credit-stress.js, credit-capital.js, credit-dealflow.js) — so a
 *      duplicate RTCatalog key anywhere in that order throws here, not
 *      in a browser.
 *   2. window.RTBuildout.CAPTIONS: every template's sample() is a
 *      string under 240 characters, the same rule every caption on
 *      this page follows (blueprint section 9).
 *   3. The PR H2 acceptance figure (blueprint 15.9): the calendar-Q2
 *      2026 hyperscaler capex stack computed from the real, committed
 *      frontend/data/capex/hyperscalers.json is 181,543,000,000.
 *   4. A stubbed fetch of a small real cut of the three panel files
 *      (the same tickers, trimmed to their newest few periods) resolves
 *      through _internal.fetchPanels and builds a page with
 *      _internal.buildHtml without throwing.
 *   5. A filer with no tagged value for a chart (Nebius, whose
 *      quarterly debt and lease fields are null by design — see its
 *      point's own dataLimitation) renders that chart's designed empty
 *      state, never a blank cell or a fabricated zero.
 *
 * The window stub (what the file may touch at evaluation time):
 *   window.RTCatalog   the real catalog, so register() works and a
 *                       duplicate key throws
 *   window.RTTerms      null (no hover terms in Node)
 *   self === window; document is undefined — the file must not touch
 *   the DOM until render()/mount() is called, which this test never
 *   does (it drives the pure _internal functions instead).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRONT = join(ROOT, "frontend");
let failed = 0;
const check = (n, ok, d) => { console.log((ok ? "  ok   " : "  FAIL ") + n + (d ? "  " + d : "")); if (!ok) failed++; };
const readJson = (rel) => JSON.parse(readFileSync(join(FRONT, rel), "utf8"));

/* ---------- 1. evaluate in credit.html's own script order ---------- */
console.log("load order and RTCatalog collisions");
const CAT = require(join(FRONT, "lib", "metric-catalog.js"));
const win = { RTCatalog: CAT, RTTerms: null, RTPcSeries: null, Chart: undefined };
win.self = win; win.window = win;

const buildoutSrc = readFileSync(join(FRONT, "credit-buildout.js"), "utf8");
let parseErr = null;
try { new Function(buildoutSrc); } catch (e) { parseErr = e; }
check("credit-buildout.js parses", !parseErr, parseErr && parseErr.message);

let evalErr = null;
try { new Function("window", "self", "module", buildoutSrc)(win, win, undefined); } catch (e) { evalErr = e; }
check("credit-buildout.js evaluates against the window stub, before credit.js in load order", !evalErr, evalErr && evalErr.message);
const RB = win.RTBuildout;
check("window.RTBuildout is set with render, CAPTIONS and _internal", !!RB && typeof RB.render === "function" && !!RB.CAPTIONS && !!RB._internal);

/* the three ingested-section files register their own entries after
   credit-buildout.js in credit.html; replaying that order here is what
   proves "RTCatalog keys do not collide in credit.html load order" —
   RTCatalog.register throws immediately on a repeated key */
let sectionsErr = null;
for (const id of ["stress", "capital", "dealflow"]) {
  const file = join(FRONT, "credit-" + id + ".js");
  if (!existsSync(file)) continue;
  const src = readFileSync(file, "utf8");
  const w = { RTCreditSections: [], RTPcSeries: null, RTCatalog: CAT, RTTerms: null, RTHttp: null, Chart: undefined };
  w.self = w; w.window = w;
  try { new Function("window", "self", "module", src)(w, w, undefined); } catch (e) { sectionsErr = id + ": " + e.message; break; }
}
check("credit-stress.js, credit-capital.js and credit-dealflow.js still evaluate against the same catalog after credit-buildout.js registered its entries (no key collision)", !sectionsErr, sectionsErr || "");
check("every boH1-boH8 chart key and the three section keys are in the catalog", ["boH1", "boH2", "boH3", "boH4", "boH5", "boH6", "boH7", "boH8", "boCapexSection", "boSourcesSection", "boDebtSection"].every((k) => !!CAT.get(k)));

/* a second evaluation of this same file (as a naive re-include would
   cause) must not silently pass — RTCatalog.register throws on its own
   keys the second time, exactly like credit-dealflow.js documents for
   itself; this file does not catch that error, so it should throw */
let reEvalErr = null;
const win2 = { RTCatalog: CAT, RTTerms: null };
win2.self = win2; win2.window = win2;
try { new Function("window", "self", "module", buildoutSrc)(win2, win2, undefined); } catch (e) { reEvalErr = e; }
check("evaluating credit-buildout.js twice against one catalog throws on the second registration (keys are not silently re-added)", !!reEvalErr && /already registered/.test(reEvalErr.message), reEvalErr && reEvalErr.message);

/* ---------- 2. every CAPTIONS sample() under 240 characters ---------- */
console.log("captions");
const capNames = Object.keys(RB.CAPTIONS);
check("CAPTIONS carries one template per chart, H1 through H8", capNames.length === 8, capNames.join(","));
for (const name of capNames) {
  const c = RB.CAPTIONS[name];
  check(name + ": has a template function", typeof c.template === "function");
  check(name + ": has a sample function", typeof c.sample === "function");
  let text = null, err = null;
  try { text = c.sample(); } catch (e) { err = e; }
  check(name + " caption sample() returns a string", typeof text === "string" && !err, err ? err.message : text);
  if (typeof text === "string") {
    check(name + " caption measures under 240 characters", text.length < 240, text.length + " chars: " + text);
    check(name + " caption carries no source stamp (that lives in the footer)", !/Source:|companyfacts, form and accession/.test(text));
  }
}

/* ---------- 3. the PR H2 acceptance figure from the real panel file ---------- */
console.log("PR H2 acceptance figure");
const hyperscalers = readJson("data/capex/hyperscalers.json");
const companies = RB._internal.companiesOf({ hyperscalers, neoclouds: { companies: {} }, landlords: { companies: {} } }, "hyperscalers");
check("the real panel file carries all five hyperscalers", Object.keys(companies).length === 5, Object.keys(companies).join(","));
const stack = RB._internal.calendarQuarterStack(companies, RB._internal.COHORTS.hyperscalers, "2026-Q2");
check("the calendar-Q2 2026 hyperscaler capex stack is 181,543,000,000, computed from the real panel file", stack.total === 181543000000, String(stack.total));
check("every hyperscaler answered that quarter (no missing filer)", stack.missing.length === 0, stack.missing.join(","));
const parts = Object.fromEntries(stack.parts.map((p) => [p.ticker, p.value]));
check("MSFT's own FQ4 slice is 35,802,000,000 (the fiscal-year-minus-nine-months figure)", parts.MSFT === 35802000000, String(parts.MSFT));
check("ORCL's own slice is 16,493,000,000 (its fiscal quarter ending one month early)", parts.ORCL === 16493000000, String(parts.ORCL));

/* the run-rate check value: AMZN's own TTM-tagged fact travels through
   unchanged, and is never itself the computed run-rate */
const amzn = hyperscalers.companies.AMZN;
const amznLatestQ = amzn.quarterly[amzn.quarterly.length - 1];
check("AMZN's latest quarter carries its own run-rate and a separate company check value, never merged into one figure",
  amznLatestQ.capexRunRate && typeof amznLatestQ.capexRunRate.value === "number" && "checkValue" in amznLatestQ.capexRunRate,
  JSON.stringify(amznLatestQ.capexRunRate));

/* ---------- 4. a stubbed fetch of a small real cut of the panel files ---------- */
console.log("stubbed fetch of a small real cut");
function trimCompany(c, nQ, nA) {
  return Object.assign({}, c, { quarterly: c.quarterly.slice(-nQ), annual: c.annual.slice(-nA) });
}
function smallCut(doc, tickers, nQ, nA) {
  const companies = {};
  for (const t of tickers) if (doc.companies[t]) companies[t] = trimCompany(doc.companies[t], nQ, nA);
  return Object.assign({}, doc, { companies });
}
const realNeoclouds = readJson("data/capex/neoclouds.json");
const realLandlords = readJson("data/capex/landlords.json");
const cuts = {
  "data/capex/hyperscalers.json": smallCut(hyperscalers, ["MSFT", "GOOG"], 6, 3),
  "data/capex/neoclouds.json": smallCut(realNeoclouds, ["CRWV", "NBIS"], 6, 3),
  "data/capex/landlords.json": smallCut(realLandlords, ["EQIX"], 6, 3)
};
const stubFetch = (url) => Promise.resolve({
  ok: Object.prototype.hasOwnProperty.call(cuts, url),
  status: Object.prototype.hasOwnProperty.call(cuts, url) ? 200 : 404,
  json: () => Promise.resolve(cuts[url])
});
let fetchedPanels = null, fetchErr = null;
try { fetchedPanels = await RB._internal.fetchPanels(stubFetch, "data/capex/"); } catch (e) { fetchErr = e; }
check("fetchPanels resolves against a stubbed fetch of a small real cut", !!fetchedPanels && !fetchErr, fetchErr && fetchErr.message);
if (fetchedPanels) {
  check("the fetched cut carries the trimmed tickers only", Object.keys(fetchedPanels.hyperscalers.companies).join(",") === "MSFT,GOOG");
  let buildErr = null, html = null;
  try { html = RB._internal.buildHtml(fetchedPanels, { cohort: "hyperscalers" }); } catch (e) { buildErr = e; }
  check("buildHtml renders the small cut without throwing", typeof html === "string" && html.length > 0 && !buildErr, buildErr && buildErr.stack);
  check("the rendered page names both trimmed companies", html && html.includes("Microsoft") && html.includes("Alphabet"));

  /* a 404 for one file is a rejected Promise.all — the page's own
     render() catches it into a view-level error state (see 5 below);
     here fetchPanels itself is checked to reject, not to swallow it */
  const partial = { "data/capex/hyperscalers.json": cuts["data/capex/hyperscalers.json"] };
  const flakyFetch = (url) => Promise.resolve({ ok: !!partial[url], status: partial[url] ? 200 : 404, json: () => Promise.resolve(partial[url]) });
  let rejected = false;
  await RB._internal.fetchPanels(flakyFetch, "data/capex/").catch(() => { rejected = true; });
  check("fetchPanels rejects when one of the three files 404s, for render()'s error state to catch", rejected);
}

/* ---------- 5. a filer with a null value renders its empty state ---------- */
console.log("empty states for a filer with no tagged value");
const neocloudsForEmpty = { companies: { NBIS: realNeoclouds.companies.NBIS } };
const emptyPanels = { hyperscalers: { companies: {} }, neoclouds: neocloudsForEmpty, landlords: { companies: {} } };
const nbisHtml = RB._internal.buildHtml(emptyPanels, { cohort: "neoclouds" });
check("Nebius's H6 net debt panel (null quarterly debt fields) renders the designed empty state, not a blank chart",
  /Nebius[\s\S]{0,200}m6-empty/.test(nbisHtml) || /m6-empty[\s\S]{0,200}Nebius/.test(nbisHtml), "");
check("the empty state names why, not just that it is empty", /Not enough dated debt instants yet|No tagged maturity schedule yet/.test(nbisHtml));
let wholeCohortErr = null;
try { RB._internal.buildHtml({ hyperscalers: { companies: {} }, neoclouds: { companies: {} }, landlords: { companies: {} } }, { cohort: "landlords" }); } catch (e) { wholeCohortErr = e; }
check("a cohort with zero filers on file renders an empty state rather than throwing", !wholeCohortErr, wholeCohortErr && wholeCohortErr.stack);

/* ---------- summary ---------- */
console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall build-out view checks pass");
process.exitCode = failed ? 1 : 0;
