/**
 * /api/macro.js — Vercel serverless function.
 *
 * Macro backdrop for the company view, grouped the way business-cycle
 * analysis groups indicators:
 *
 *   LEADING     move before the economy does — the Treasury curve,
 *               initial jobless claims, building permits, consumer
 *               sentiment
 *   COINCIDENT  move with it — payrolls, industrial production, retail
 *               sales
 *   LAGGING     confirm where it has been — inflation, unemployment,
 *               and the policy rate that reacts to both
 *
 * Source is the Federal Reserve's public statistical service (FRED,
 * Federal Reserve Bank of St. Louis).
 *
 *   GET /api/macro          — cached for six hours
 *   GET /api/macro?force=1  — skips the cache read, still writes it
 *
 * The key: FRED_API_KEY from the environment when set; otherwise the
 * fallback below. The fallback is acceptable only while this repository
 * is PRIVATE — it is a free-tier statistical key with no billing
 * attached, and it never reaches the browser — but if the repository is
 * ever made public, move it to a Vercel environment variable and rotate
 * it first.
 */

export const maxDuration = 30;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = globalThis.__macroCache || (globalThis.__macroCache = { at: 0, payload: null });

const FALLBACK_KEY = "c684f28f8275225c518a7b2686ec88ba";

/* series id → how the observation is read */
const SERIES = {
  CPIAUCSL: "index",   // headline CPI level → YoY rate
  CPILFESL: "index",   // core CPI level → YoY rate
  FEDFUNDS: "rate",    // effective policy rate, monthly
  DGS10: "rate",       // 10-year constant maturity, daily
  DGS2: "rate",        // 2-year constant maturity, daily
  ICSA: "level",       // initial jobless claims, weekly count
  PERMIT: "level",     // building permits, thousands, annualised
  UMCSENT: "level",    // consumer sentiment index
  PAYEMS: "index",     // nonfarm payrolls, thousands → YoY rate
  INDPRO: "index",     // industrial production index → YoY rate
  RSAFS: "index",      // retail sales, $m nominal → YoY rate
  UNRATE: "rate",      // unemployment rate, monthly
};

async function fredSeries(id, key) {
  /* two years of observations is enough for a year-over-year comparison
     with room for publication lag */
  const start = new Date(Date.now() - 800 * 864e5).toISOString().slice(0, 10);
  const url = "https://api.stlouisfed.org/fred/series/observations" +
    "?series_id=" + id + "&api_key=" + key + "&file_type=json" +
    "&observation_start=" + start + "&sort_order=asc";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
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

const latest = (obs) => (obs && obs.length ? obs[obs.length - 1] : null);

/** The observation closest to twelve months before the latest one. */
function yearAgo(obs) {
  const now = latest(obs);
  if (!now) return null;
  const target = new Date(new Date(now.date) - 365.25 * 864e5).getTime();
  let best = null, bestGap = Infinity;
  for (const o of obs) {
    const gap = Math.abs(new Date(o.date).getTime() - target);
    if (gap < bestGap) { bestGap = gap; best = o; }
  }
  return best && bestGap <= 45 * 864e5 ? best : null;
}

/** An index level served as its year-over-year growth rate. */
function asYoY(obs) {
  const now = latest(obs), ago = yearAgo(obs);
  if (!now || !ago || ago.value === 0) return null;
  return { value: now.value / ago.value - 1, period: now.date };
}

/** A rate (already a percentage) with its change on a year ago in points. */
function asRate(obs) {
  const now = latest(obs), ago = yearAgo(obs);
  if (!now) return null;
  return { value: now.value / 100, period: now.date,
           yoyPp: ago ? (now.value - ago.value) / 100 : null };
}

/** A raw level with its year-over-year percentage change. */
function asLevel(obs) {
  const now = latest(obs), ago = yearAgo(obs);
  if (!now) return null;
  return { value: now.value, period: now.date,
           yoy: ago && ago.value !== 0 ? now.value / ago.value - 1 : null };
}

export default async function handler(req, res) {
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
  const out = {
    asOf: new Date().toISOString().slice(0, 19),
    source: "Federal Reserve Bank of St. Louis, FRED",
    leading: {
      curveSpread: (t10 && t2)
        ? { value: t10.value - t2.value, period: t10.period } : null,
      treasury10y: t10,
      treasury2y: t2,
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
      unemployment: asRate(S.UNRATE),
      fedFunds: asRate(S.FEDFUNDS),
    },
  };
  /* Every series failing at once means the provider is down; serve the
     stale cache if one exists rather than a page of dashes. */
  const dead = !out.lagging.cpiYoY && !out.lagging.fedFunds && !out.leading.treasury10y;
  if (dead && cache.payload) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(cache.payload);
  }
  if (!dead) { cache.at = Date.now(); cache.payload = out; }
  res.setHeader("Cache-Control", force ? "no-store" : "s-maxage=21600, stale-while-revalidate=86400");
  return res.status(200).json(out);
}
