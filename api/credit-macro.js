/**
 * /api/credit-macro.js — Vercel serverless function.
 *
 * The credit conditions behind the private credit page: the price of
 * liquid credit (ICE BofA spreads and the high-yield effective yield),
 * the base rate every floating loan is priced over (SOFR and its
 * 90-day average), the long-run corporate risk premium (Baa minus the
 * ten-year), what banks say about their own lending (the SLOOS series),
 * how their business loans are performing (delinquency and charge-off),
 * the financial-conditions and stress indices, and the H.8 lines that
 * show bank credit flowing to nondepository lenders.
 *
 * Every series carries its latest value, the prior observation, the
 * observation a year earlier, a 24-month sparkline, a decade of monthly
 * history and a percentile over a ten-year date window whose label says
 * how much history the series actually has (the ICE BofA spreads run
 * three years). Two derived
 * items ride along: the share of bank credit lent to nondepository
 * financial institutions, and the recession bands from USREC so the
 * charts can shade them.
 *
 * Four rating-band ICE BofA OAS ids (AAA, AA, single-A, BBB) and five
 * FX spot-rate ids (DEXUSEU, DEXUSUK, DEXSZUS, DEXCAUS, DEXJPUS) were
 * added for the hyperscaler/neocloud build-out monitor's chart H16 (new
 * issue spreads against the OAS lines) and its FX conversion of foreign
 * deal-ledger tranches to USD on the pricing date. The OAS ids are
 * percent series on the same rolling three-year window as the other ICE
 * BofA ids. The FX ids are LEVELS — a spot rate, not a percentage — and
 * are never a spread: DEXUSEU and DEXUSUK are US dollars per one euro
 * or pound (a rate near 1–1.5), DEXSZUS, DEXCAUS and DEXJPUS are the
 * foreign currency per one US dollar (DEXJPUS runs in the hundreds).
 *
 *   GET /api/credit-macro          — cached for six hours
 *   GET /api/credit-macro?force=1  — skips the cache read, still writes
 *                                    it; gated tightly (three calls,
 *                                    then two a minute per caller) so a
 *                                    refresh button cannot become a
 *                                    FRED hammer
 *
 * Values are served as FRED serves them: a percent series is
 * percentage points (2.71 is 2.71%), never a fraction. A series that
 * fails is returned as { id, error } so the rest of the strip still
 * draws.
 *
 * Source: Federal Reserve Bank of St. Louis, FRED — through the API when
 * FRED_API_KEY is set and answers, the public CSV otherwise. No fallback
 * key lives here; this endpoint answers without one, and `keyed` says
 * whether the API actually served the payload.
 */

import { jsonSafe } from "../scripts/lib/handler.mjs";
import { gate } from "../scripts/lib/ratelimit.mjs";
import { fetchSeriesVia, monthEnd, percentileInWindow, recessionsFromUsrec, ratioOf,
         atMonthsBack, freqOf, windowLabelOf, round } from "../scripts/lib/fred.mjs";

export const maxDuration = 30;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = globalThis.__creditMacroCache || (globalThis.__creditMacroCache = { at: 0, payload: null });

const CONCURRENCY = 6;

/* id → [title, unit]. Titles are FRED's own, read from each series page
   (https://fred.stlouisfed.org/series/<ID>) on 2026-09-11. Units:
   percent = percentage points, billions = billions of dollars, index =
   a unitless index, level = a raw count or indicator. */
const SERIES = {
  BAMLH0A0HYM2:   ["ICE BofA US High Yield Index Option-Adjusted Spread", "percent"],
  BAMLC0A0CM:     ["ICE BofA US Corporate Index Option-Adjusted Spread", "percent"],
  BAMLH0A1HYBB:   ["ICE BofA BB US High Yield Index Option-Adjusted Spread", "percent"],
  BAMLH0A2HYB:    ["ICE BofA Single-B US High Yield Index Option-Adjusted Spread", "percent"],
  BAMLH0A3HYC:    ["ICE BofA CCC & Lower US High Yield Index Option-Adjusted Spread", "percent"],
  BAMLH0A0HYM2EY: ["ICE BofA US High Yield Index Effective Yield", "percent"],
  SOFR:           ["Secured Overnight Financing Rate", "percent"],
  SOFR90DAYAVG:   ["90-Day Average SOFR", "percent"],
  BAA10Y:         ["Moody's Seasoned Baa Corporate Bond Yield Relative to Yield on 10-Year Treasury Constant Maturity", "percent"],
  DRTSCILM:       ["Net Percentage of Domestic Banks Tightening Standards for Commercial and Industrial Loans to Large and Middle-Market Firms", "percent"],
  DRBLACBS:       ["Delinquency Rate on Business Loans, All Commercial Banks", "percent"],
  CORBLACBS:      ["Charge-Off Rate on Business Loans, All Commercial Banks", "percent"],
  BUSLOANS:       ["Commercial and Industrial Loans, All Commercial Banks", "billions"],
  DRSDCILM:       ["Net Percentage of Domestic Banks Reporting Stronger Demand for Commercial and Industrial Loans From Large and Middle-Market Firms", "percent"],
  DRTSCIS:        ["Net Percentage of Domestic Banks Tightening Standards for Commercial and Industrial Loans to Small Firms", "percent"],
  NFCI:           ["Chicago Fed National Financial Conditions Index", "index"],
  STLFSI4:        ["St. Louis Fed Financial Stress Index", "index"],
  T10Y2Y:         ["10-Year Treasury Constant Maturity Minus 2-Year Treasury Constant Maturity", "percent"],
  DPRIME:         ["Bank Prime Loan Rate", "percent"],
  LNFACBW027SBOG: ["Other Loans and Leases: All Other Loans and Leases: Loans to Nondepository Financial Institutions, All Commercial Banks", "billions"],
  TOTBKCR:        ["Bank Credit, All Commercial Banks", "billions"],
  USREC:          ["NBER based Recession Indicators for the United States from the Period following the Peak through the Trough", "level"],
  /* the four rating-band OAS ids chart H16 draws new-issue spreads
     against (build-out monitor, blueprint 15.7) */
  BAMLC0A1CAAA:   ["ICE BofA AAA US Corporate Index Option-Adjusted Spread", "percent"],
  BAMLC0A2CAA:    ["ICE BofA AA US Corporate Index Option-Adjusted Spread", "percent"],
  BAMLC0A3CA:     ["ICE BofA Single-A US Corporate Index Option-Adjusted Spread", "percent"],
  BAMLC0A4CBBB:   ["ICE BofA BBB US Corporate Index Option-Adjusted Spread", "percent"],
  /* spot-rate levels for converting foreign deal-ledger tranches to USD
     on the pricing date (build-out monitor, blueprint 15.5/15.8); a
     rate, never a percent or a spread */
  DEXUSEU:        ["U.S. Dollars to Euro Spot Exchange Rate", "USD per EUR"],
  DEXUSUK:        ["U.S. Dollars to U.K. Pound Sterling Spot Exchange Rate", "USD per GBP"],
  DEXSZUS:        ["Switzerland Francs to U.S. Dollar Spot Exchange Rate", "CHF per USD"],
  DEXCAUS:        ["Canada Dollars to U.S. Dollar Spot Exchange Rate", "CAD per USD"],
  DEXJPUS:        ["Japan Yen to U.S. Dollar Spot Exchange Rate", "JPY per USD"],
};

const RECESSIONS_FROM = "1986-01-01";
const SHARE_FROM = "2015-01-01";

/* Run fn over items with at most `limit` in flight; results in order. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const dv = (o) => ({ d: o.date, v: o.value });

/** One series in the served shape. A quarterly series keeps every
    point (the SLOOS and delinquency series are about forty in ten
    years); everything else is downsampled to the last observation of
    each month. */
function shape(id, obs) {
  const [name, unit] = SERIES[id];
  if (!obs || !obs.length) return { id, name, error: "FRED did not answer for " + id };
  const freq = freqOf(id);
  const quarterly = freq === "quarterly";
  const now = obs[obs.length - 1];
  const prior = obs.length > 1 ? obs[obs.length - 2] : null;
  /* the observation nearest the same date a year earlier, so a
     twelve-month change compares like with like (a month-end point
     would sit up to three weeks off and can straddle a policy step) */
  const yearAgo = atMonthsBack(obs, 12);
  const months = monthEnd(obs);
  const pct = percentileInWindow(obs, { years: 10 });
  return {
    id, name, unit, freq,
    start: obs[0].date,
    latest: dv(now),
    prior: prior ? dv(prior) : null,
    change: prior ? round(now.value - prior.value) : null,
    yearAgo: yearAgo ? dv(yearAgo) : null,
    sparkline: quarterly ? months.slice(-8) : months.slice(-24),
    history: quarterly ? obs.map(dv).slice(-60) : months.slice(-120),
    percentile: { ...pct, windowLabel: windowLabelOf(id) },
  };
}

/** Loans to nondepository financial institutions as a share of all
    bank credit — both weekly H.8 lines, divided on matching Wednesdays,
    monthly from 2015 where the numerator begins. */
function ndfiShare(S) {
  const name = "Bank loans to nondepository financial institutions, share of total bank credit";
  const method = "LNFACBW027SBOG ÷ TOTBKCR";
  const share = ratioOf(S.LNFACBW027SBOG, S.TOTBKCR, { scale: 100 });
  if (!share || !share.length) {
    return { name, unit: "percent", latest: null, history: null, method,
             error: "one of the two H.8 series did not answer" };
  }
  const history = monthEnd(share).filter((p) => p.d >= SHARE_FROM);
  return { name, unit: "percent", latest: dv(share[share.length - 1]), history, method };
}

export default jsonSafe(async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const force = req.query && (req.query.force === "1" || req.query.force === "true");
  if (force) {
    /* the forced path reaches FRED 22 times; keep it to a trickle */
    const refused = gate(req, { burst: 3, ratePerMin: 2, cost: 0, sameOrigin: true });
    if (refused) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(refused.status).json(refused.body);
    }
  }
  if (!force && cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json(cache.payload);
  }

  const ids = Object.keys(SERIES);
  const results = await pool(ids, CONCURRENCY, (id) => fetchSeriesVia(id));
  const S = {};
  ids.forEach((id, i) => { S[id] = results[i].obs; });

  const series = {};
  let ok = 0;
  for (const id of ids) {
    series[id] = shape(id, S[id]);
    if (!series[id].error) ok++;
  }

  const out = {
    generated: new Date().toISOString(),
    source: "FRED",
    /* true only when the API path served at least one series; a key
       that FRED refused leaves the payload keyless, not empty */
    keyed: results.some((r) => r.via === "api"),
    series,
    derived: { ndfiShare: ndfiShare(S) },
    /* null, not [], when USREC failed: an empty list would read as no
       recession since 1986 */
    recessions: S.USREC && S.USREC.length
      ? recessionsFromUsrec(S.USREC.filter((o) => o.date >= RECESSIONS_FROM))
      : null,
  };
  /* a payload missing more than two series is not worth six hours of
     cache; serve the last good one if there is one, else what came */
  const dead = ok < ids.length - 2;
  if (dead && cache.payload) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(cache.payload);
  }
  if (!dead) { cache.at = Date.now(); cache.payload = out; }
  res.setHeader("Cache-Control", force || dead ? "no-store" : "s-maxage=21600, stale-while-revalidate=86400");
  return res.status(200).json(out);
}, { name: "credit-macro" });
