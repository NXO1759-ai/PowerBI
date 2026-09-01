/**
 * /api/comps.js — Vercel serverless function.
 *
 * The multiples column-set of a comparable-company sheet, for a peer set
 * in one call: market cap, enterprise value, EV/Sales, EV/EBITDA, P/E,
 * forward P/E, P/FCF, dividend yield and the vendor's trailing margins,
 * per ticker. The operating fundamentals beside them on the page —
 * growth, return on capital, leverage — come from the filings and are
 * computed there, not here; this endpoint supplies only what a filing
 * cannot: the market's price.
 *
 *   GET /api/comps?tickers=NKE,DECK,SKX[,…]   (up to twelve)
 *
 * Each ticker is cached fifteen minutes; a sheet of ten costs at most ten
 * feed calls and usually far fewer.
 */

export const maxDuration = 30;

const TTL = 15 * 60 * 1000;
const cache = globalThis.__compsCache || (globalThis.__compsCache = new Map());

async function getJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

async function one(ticker, key) {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < TTL) return hit.row;
  const j = await getJson("https://finnhub.io/api/v1/stock/metric?" +
    new URLSearchParams({ symbol: ticker, metric: "all", token: key }));
  const m = (j && j.metric) || {};
  const row = {
    ticker,
    marketCap: num(m.marketCapitalization) !== null ? m.marketCapitalization * 1e6 : null,
    enterpriseValue: num(m.enterpriseValue) !== null ? m.enterpriseValue * 1e6 : null,
    evRevenueTTM: num(m.evRevenueTTM),
    evEbitdaTTM: num(m.evEbitdaTTM),
    peTTM: num(m.peTTM),
    forwardPE: num(m.forwardPE),
    pfcfTTM: num(m.pfcfShareTTM),
    fcfYieldTTM: num(m.pfcfShareTTM) && m.pfcfShareTTM > 0 ? 1 / m.pfcfShareTTM : null,
    dividendYieldTTM: num(m.currentDividendYieldTTM) !== null ? m.currentDividendYieldTTM / 100 : null,
    grossMarginTTM: num(m.grossMarginTTM) !== null ? m.grossMarginTTM / 100 : null,
    operatingMarginTTM: num(m.operatingMarginTTM) !== null ? m.operatingMarginTTM / 100 : null,
    revenueGrowthTTM: num(m.revenueGrowthTTMYoy) !== null ? m.revenueGrowthTTMYoy / 100 : null,
    beta: num(m.beta),
    ok: !!(j && j.metric && Object.keys(j.metric).length),
  };
  cache.set(ticker, { at: Date.now(), row });
  return row;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = req.query || {};
  const tickers = String(q.tickers || "").toUpperCase().split(",")
    .map((t) => t.replace(/[^A-Z0-9.\-]/g, "")).filter(Boolean).slice(0, 12);
  if (!tickers.length) return res.status(400).json({ error: "tickers required" });
  const KEY = process.env.FINNHUB_API_KEY;
  if (!KEY) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: "not configured" });
  }
  /* sequential with a short gap keeps well under the feed's per-minute
     ceiling when several sheets are open at once */
  const rows = [];
  for (const t of tickers) {
    rows.push(await one(t, KEY));
    if (!cache.get(t) || Date.now() - cache.get(t).at < 50) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
  return res.status(200).json({ asOf: new Date().toISOString().slice(0, 19),
    source: "market-data feed", rows });
}
