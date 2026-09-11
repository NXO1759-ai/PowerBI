/**
 * /api/macro.js — Vercel serverless function.
 *
 * Macro backdrop and business-cycle indicators for the company view,
 * grouped the way cycle analysis groups them:
 *
 *   LEADING     move before the economy — the Treasury curve, initial
 *               jobless claims, building permits, consumer sentiment,
 *               producer prices (input costs arrive at the shelf a
 *               quarter or two later)
 *   COINCIDENT  move with it — payrolls, industrial production, retail
 *               sales
 *   LAGGING     confirm where it has been — consumer inflation, wage
 *               growth, unemployment, and the policy rate that reacts
 *               to all three
 *
 * Every stat carries a decade of monthly HISTORY so the page can draw
 * the trend and place today against it, not just print a number. Rates
 * and year-over-year readings are fractions; levels are raw.
 *
 *   GET /api/macro          — cached for six hours
 *   GET /api/macro?force=1  — skips the cache read, still writes it
 *
 * Source: FRED, Federal Reserve Bank of St. Louis. The key comes from
 * FRED_API_KEY when set; the fallback below is acceptable only while
 * this repository is PRIVATE — a free statistical key, never sent to the
 * browser — and must be rotated into an environment variable before the
 * repository is ever made public.
 */

import { jsonSafe } from "../scripts/lib/handler.mjs";
import { fredSeries, asYoY, asRate, asLevel, round } from "../scripts/lib/fred.mjs";

export const maxDuration = 30;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = globalThis.__macroCache || (globalThis.__macroCache = { at: 0, payload: null });

const FALLBACK_KEY = "c684f28f8275225c518a7b2686ec88ba";

/* series id → how observations are read
     index : a level served as its year-over-year rate, history in YoY
     rate  : already a percentage, served /100
     level : a raw count or index, served as-is with a YoY change */
const SERIES = {
  CPIAUCSL: "index",        // headline CPI
  CPILFESL: "index",        // core CPI
  PPIACO: "index",          // producer prices, all commodities
  CES0500000003: "index",   // average hourly earnings, private
  PAYEMS: "index",          // nonfarm payrolls
  INDPRO: "index",          // industrial production
  RSAFS: "index",           // retail sales, nominal
  FEDFUNDS: "rate",
  DGS10: "rate",
  DGS2: "rate",
  UNRATE: "rate",
  ICSA: "level",            // initial claims, weekly
  PERMIT: "level",          // building permits, thousands SAAR
  UMCSENT: "level",         // consumer sentiment index
};

/* fredSeries, monthly, asYoY, asRate, asLevel and atMonthsBack live in
   scripts/lib/fred.mjs, shared with api/credit-macro.js. */

export default jsonSafe(async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const KEY = process.env.FRED_API_KEY || FALLBACK_KEY;
  if (!KEY) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: "not configured" });
  }
  const force = req.query && (req.query.force === "1" || req.query.force === "true");
  if (!force && cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json(cache.payload);
  }

  const ids = Object.keys(SERIES);
  const results = await Promise.all(ids.map((id) => fredSeries(id, KEY)));
  const S = {};
  ids.forEach((id, i) => { S[id] = results[i]; });

  const t10 = asRate(S.DGS10), t2 = asRate(S.DGS2);
  /* the curve is a computed series: month-aligned difference */
  let curve = null;
  if (t10 && t2) {
    const short = new Map(t2.history);
    const hist = t10.history
      .filter((h) => short.has(h[0]))
      .map((h) => [h[0], round(h[1] - short.get(h[0]))]);
    const now = hist[hist.length - 1];
    const ago = hist.length > 12 ? hist[hist.length - 13] : null;
    if (now) curve = { value: now[1], period: now[0],
                       yearAgo: ago ? ago[1] : null, history: hist };
  }

  const out = {
    asOf: new Date().toISOString().slice(0, 19),
    source: "Federal Reserve Bank of St. Louis, FRED",
    leading: {
      curveSpread: curve,
      treasury10y: t10,
      treasury2y: t2,
      producerPricesYoY: asYoY(S.PPIACO),
      initialClaims: asLevel(S.ICSA),
      buildingPermits: asLevel(S.PERMIT),
      consumerSentiment: asLevel(S.UMCSENT),
    },
    coincident: {
      payrollsYoY: asYoY(S.PAYEMS),
      industrialProductionYoY: asYoY(S.INDPRO),
      retailSalesYoY: asYoY(S.RSAFS),
    },
    lagging: {
      cpiYoY: asYoY(S.CPIAUCSL),
      coreCpiYoY: asYoY(S.CPILFESL),
      wageGrowthYoY: asYoY(S.CES0500000003),
      unemployment: asRate(S.UNRATE),
      fedFunds: asRate(S.FEDFUNDS),
    },
  };
  const dead = !out.lagging.cpiYoY && !out.lagging.fedFunds && !out.leading.treasury10y;
  if (dead && cache.payload) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(cache.payload);
  }
  if (!dead) { cache.at = Date.now(); cache.payload = out; }
  res.setHeader("Cache-Control", force ? "no-store" : "s-maxage=21600, stale-while-revalidate=86400");
  return res.status(200).json(out);
}, { name: "macro" });
