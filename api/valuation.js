/**
 * /api/valuation.js — Vercel serverless function.
 *
 * The market's side of the ledger for one company: what the equity is
 * priced at relative to what it earns, where that sits against the
 * company's own decade, what the sell-side expected each quarter versus
 * what was delivered, and when the next report lands.
 *
 *   GET /api/valuation?ticker=NVDA[&force=1]
 *
 * Sources, all from the market-data feed (FINNHUB_API_KEY):
 *   /stock/metric       trailing multiples (P/E, EV/EBITDA, EV/Sales,
 *                       P/FCF, P/B), forward P/E and PEG, EV and market
 *                       cap, and ANNUAL SERIES of each multiple back to
 *                       2000 — which is what places today against the
 *                       company's own history without a price database
 *   /stock/earnings     EPS actual against consensus, last four quarters
 *   /calendar/earnings  the next report date with consensus EPS and
 *                       revenue
 *
 * Multiples here are the vendor's trailing-twelve-month figures and are
 * labelled as such on the page; the operating fundamentals beside them
 * come from the filings. Cached six hours; force skips the read.
 */

export const maxDuration = 30;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = globalThis.__valuationCache || (globalThis.__valuationCache = new Map());

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
const finnhub = (path, params, key) =>
  getJson("https://finnhub.io/api/v1" + path + "?" + new URLSearchParams({ ...params, token: key }));

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

/** Today's reading placed in the company's own annual history: the
    percentile, the decade's low and high, and the median. */
function placeInHistory(series, current) {
  if (!Array.isArray(series) || !series.length || !num(current)) return null;
  const pts = series
    .map((p) => ({ period: p.period, v: num(p.v) }))
    .filter((p) => p.v !== null && p.v > 0 && p.v < 1000)
    .sort((a, b) => String(a.period).localeCompare(String(b.period)))
    .slice(-10);
  if (pts.length < 4) return null;
  const vals = pts.map((p) => p.v).sort((a, b) => a - b);
  const below = vals.filter((v) => v < current).length;
  const median = vals.length % 2 ? vals[(vals.length - 1) / 2]
    : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
  const lo = pts.reduce((a, p) => (p.v < a.v ? p : a));
  const hi = pts.reduce((a, p) => (p.v > a.v ? p : a));
  return {
    percentile: Math.round(100 * below / vals.length),
    years: pts.length,
    low: { value: lo.v, period: lo.period },
    high: { value: hi.v, period: hi.period },
    median: median,
    series: pts,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = req.query || {};
  const ticker = String(q.ticker || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  if (!ticker) return res.status(400).json({ error: "ticker required" });
  const KEY = process.env.FINNHUB_API_KEY;
  if (!KEY) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: "not configured" });
  }
  const force = q.force === "1" || q.force === "true";
  const hit = cache.get(ticker);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json(hit.payload);
  }

  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
  const [metric, earnings, calendar] = await Promise.all([
    finnhub("/stock/metric", { symbol: ticker, metric: "all" }, KEY),
    finnhub("/stock/earnings", { symbol: ticker, limit: 8 }, KEY),
    finnhub("/calendar/earnings", { symbol: ticker, from: today, to: horizon }, KEY),
  ]);
  const m = (metric && metric.metric) || {};
  const annual = (metric && metric.series && metric.series.annual) || {};

  const multiples = {
    peTTM: num(m.peTTM),
    forwardPE: num(m.forwardPE),
    pegTTM: num(m.pegTTM),
    evEbitdaTTM: num(m.evEbitdaTTM),
    evRevenueTTM: num(m.evRevenueTTM),
    psTTM: num(m.psTTM),
    pfcfTTM: num(m.pfcfShareTTM),
    fcfYieldTTM: num(m.pfcfShareTTM) && m.pfcfShareTTM > 0 ? 1 / m.pfcfShareTTM : null,
    pb: num(m.pb),
    dividendYieldTTM: num(m.currentDividendYieldTTM) !== null ? m.currentDividendYieldTTM / 100 : null,
    /* the feed reports these in millions of dollars */
    marketCap: num(m.marketCapitalization) !== null ? m.marketCapitalization * 1e6 : null,
    enterpriseValue: num(m.enterpriseValue) !== null ? m.enterpriseValue * 1e6 : null,
    beta: num(m.beta),
    week52: { low: num(m["52WeekLow"]), high: num(m["52WeekHigh"]),
      lowDate: m["52WeekLowDate"] || null, highDate: m["52WeekHighDate"] || null,
      return: num(m["52WeekPriceReturnDaily"]) !== null ? m["52WeekPriceReturnDaily"] / 100 : null },
  };
  const history = {
    pe: placeInHistory(annual.pe, multiples.peTTM),
    evEbitda: placeInHistory(annual.evEbitda, multiples.evEbitdaTTM),
    evRevenue: placeInHistory(annual.evRevenue, multiples.evRevenueTTM),
    ps: placeInHistory(annual.ps, multiples.psTTM),
    pb: placeInHistory(annual.pb, multiples.pb),
  };

  /* what was expected against what was delivered */
  const surprises = Array.isArray(earnings) ? earnings
    .filter((e) => num(e.actual) !== null && num(e.estimate) !== null)
    .sort((a, b) => String(a.period).localeCompare(String(b.period)))
    .slice(-8)
    .map((e) => ({
      period: e.period, year: e.year, quarter: e.quarter,
      estimate: e.estimate, actual: e.actual,
      surprise: e.actual - e.estimate,
      surprisePct: num(e.surprisePercent) !== null ? e.surprisePercent / 100
        : (e.estimate ? (e.actual - e.estimate) / Math.abs(e.estimate) : null),
    })) : [];

  const cal = calendar && Array.isArray(calendar.earningsCalendar) ? calendar.earningsCalendar : [];
  const upcoming = cal
    .filter((e) => e.symbol === ticker && e.date >= today)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
  const next = upcoming ? {
    date: upcoming.date,
    session: upcoming.hour === "bmo" ? "before the open" : upcoming.hour === "amc" ? "after the close" : null,
    quarter: upcoming.quarter, year: upcoming.year,
    epsEstimate: num(upcoming.epsEstimate),
    revenueEstimate: num(upcoming.revenueEstimate),
  } : null;

  const empty = !Object.values(multiples).some((v) => v !== null && typeof v !== "object");
  if (empty && !surprises.length && !next) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).json({ error: "no market data for " + ticker });
  }
  const payload = {
    ticker, asOf: new Date().toISOString().slice(0, 19),
    source: "market-data feed",
    multiples, history, surprises, next,
    margins: {
      grossTTM: num(m.grossMarginTTM) !== null ? m.grossMarginTTM / 100 : null,
      operatingTTM: num(m.operatingMarginTTM) !== null ? m.operatingMarginTTM / 100 : null,
      netTTM: num(m.netProfitMarginTTM) !== null ? m.netProfitMarginTTM / 100 : null,
    },
  };
  cache.set(ticker, { at: Date.now(), payload });
  res.setHeader("Cache-Control", force ? "no-store" : "s-maxage=21600, stale-while-revalidate=86400");
  return res.status(200).json(payload);
}
