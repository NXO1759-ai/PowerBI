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

async function fredSeries(id, key) {
  /* eleven years of raw data yields ten years of year-over-year */
  const start = new Date(Date.now() - 4100 * 864e5).toISOString().slice(0, 10);
  const url = "https://api.stlouisfed.org/fred/series/observations" +
    "?series_id=" + id + "&api_key=" + key + "&file_type=json" +
    "&observation_start=" + start + "&sort_order=asc";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.observations || [])
      .map((o) => ({ date: o.date, value: Number(o.value) }))
      .filter((o) => isFinite(o.value));
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Last observation of each calendar month — daily and weekly series
    downsampled so every history draws at the same monthly rhythm. */
function monthly(obs) {
  if (!obs) return null;
  const by = new Map();
  for (const o of obs) by.set(o.date.slice(0, 7), o);
  return [...by.values()];
}

const latest = (obs) => (obs && obs.length ? obs[obs.length - 1] : null);

function atMonthsBack(obs, months) {
  const now = latest(obs);
  if (!now) return null;
  const target = new Date(new Date(now.date) - months * 30.44 * 864e5).getTime();
  let best = null, bestGap = Infinity;
  for (const o of obs) {
    const gap = Math.abs(new Date(o.date).getTime() - target);
    if (gap < bestGap) { bestGap = gap; best = o; }
  }
  return best && bestGap <= 50 * 864e5 ? best : null;
}

const round = (v) => Math.round(v * 1e6) / 1e6;

/** Index level → year-over-year rate, with a decade of the rate. */
function asYoY(obs) {
  const m = monthly(obs);
  if (!m || m.length < 14) return null;
  const hist = [];
  for (let i = 12; i < m.length; i++) {
    if (m[i - 12].value !== 0) {
      hist.push([m[i].date, round(m[i].value / m[i - 12].value - 1)]);
    }
  }
  if (!hist.length) return null;
  const now = hist[hist.length - 1];
  const ago = hist.length > 12 ? hist[hist.length - 13] : null;
  return { value: now[1], period: now[0],
           yearAgo: ago ? ago[1] : null, history: hist.slice(-120) };
}

/** A percentage series, as fractions, with its decade. */
function asRate(obs) {
  const m = monthly(obs);
  if (!m || !m.length) return null;
  const hist = m.map((o) => [o.date, round(o.value / 100)]);
  const now = latest(m), ago = atMonthsBack(m, 12);
  return { value: now.value / 100, period: now.date,
           yoyPp: ago ? round((now.value - ago.value) / 100) : null,
           history: hist.slice(-120) };
}

/** A raw level, with its decade and a year-over-year change. */
function asLevel(obs) {
  const m = monthly(obs);
  if (!m || !m.length) return null;
  const hist = m.map((o) => [o.date, o.value]);
  const now = latest(m), ago = atMonthsBack(m, 12);
  return { value: now.value, period: now.date,
           yoy: ago && ago.value !== 0 ? round(now.value / ago.value - 1) : null,
           history: hist.slice(-120) };
}

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
