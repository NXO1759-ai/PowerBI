/**
 * /api/macro.js — Vercel serverless function.
 *
 * Macro backdrop for the company view: inflation, the policy rate and the
 * Treasury curve, from the Federal Reserve's public statistical service
 * (FRED, Federal Reserve Bank of St. Louis).
 *
 *   GET /api/macro          — cached for six hours
 *   GET /api/macro?force=1  — skips the cache read, still writes it
 *
 * Requires FRED_API_KEY in the environment. Without it the endpoint says
 * so with a 503 rather than returning invented numbers, and the frontend
 * renders the absence honestly.
 *
 * Series, all monthly unless noted:
 *   CPIAUCSL  headline CPI level — served as a year-over-year rate
 *   CPILFESL  core CPI level     — served as a year-over-year rate
 *   FEDFUNDS  effective federal funds rate
 *   DGS10     10-year Treasury constant maturity (daily)
 *   DGS2      2-year Treasury constant maturity (daily)
 */

export const maxDuration = 30;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = globalThis.__macroCache || (globalThis.__macroCache = { at: 0, payload: null });

const SERIES = ["CPIAUCSL", "CPILFESL", "FEDFUNDS", "DGS10", "DGS2"];

async function fredSeries(id, key) {
  /* two years of observations is enough for a year-over-year rate with
     room for publication lag */
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

function latest(obs) {
  return obs && obs.length ? obs[obs.length - 1] : null;
}

/** Year-over-year change of an index level: latest against the reading
    closest to twelve months before it. */
function yoy(obs) {
  const now = latest(obs);
  if (!now) return null;
  const target = new Date(new Date(now.date) - 365.25 * 864e5).getTime();
  let best = null, bestGap = Infinity;
  for (const o of obs) {
    const gap = Math.abs(new Date(o.date).getTime() - target);
    if (gap < bestGap) { bestGap = gap; best = o; }
  }
  if (!best || bestGap > 45 * 864e5 || best.value === 0) return null;
  return { value: now.value / best.value - 1, period: now.date };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const KEY = process.env.FRED_API_KEY;
  if (!KEY) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: "not configured" });
  }
  const force = req.query && (req.query.force === "1" || req.query.force === "true");
  if (!force && cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json(cache.payload);
  }

  const [cpi, core, ff, t10, t2] = await Promise.all(SERIES.map((s) => fredSeries(s, KEY)));
  const l = (obs) => {
    const o = latest(obs);
    return o ? { value: o.value / 100, period: o.date } : null;
  };
  const t10l = l(t10), t2l = l(t2);
  const out = {
    asOf: new Date().toISOString().slice(0, 19),
    source: "Federal Reserve Bank of St. Louis, FRED",
    cpiYoY: yoy(cpi),
    coreCpiYoY: yoy(core),
    fedFunds: l(ff),
    treasury10y: t10l,
    treasury2y: t2l,
    curveSpread: (t10l && t2l)
      ? { value: t10l.value - t2l.value, period: t10l.period } : null,
  };
  /* Every series failing at once means the provider is down; serve the
     stale cache if one exists rather than a page of dashes. */
  if (!out.cpiYoY && !out.fedFunds && !out.treasury10y && cache.payload) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(cache.payload);
  }
  cache.at = Date.now();
  cache.payload = out;
  res.setHeader("Cache-Control", force ? "no-store" : "s-maxage=21600, stale-while-revalidate=86400");
  return res.status(200).json(out);
}
