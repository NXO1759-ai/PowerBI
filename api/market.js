/**
 * /api/market.js — Vercel serverless function.
 *
 * Consolidated live market-data endpoint for the Company Overview
 * dashboard. The frontend calls this on every company change:
 *   GET /api/market?ticker=GOOG
 *
 * Providers (keys live in Vercel env vars, never in client code):
 *   FINNHUB_API_KEY      quote, profile2, candles, recommendations, news
 *   ALPHAVANTAGE_API_KEY daily-series fallback (e.g. OTC tickers)
 *   MARKETAUX_API_KEY    news fallback + spike-window historical headlines
 *                        (Finnhub's free tier only returns the last few
 *                        days of news, so headlines around each top
 *                        value-traded day are pulled from Marketaux)
 *
 * Every provider call is isolated: a failure degrades that section to
 * null instead of failing the whole response.
 */

import { jsonSafe } from "../scripts/lib/handler.mjs";

const DAY = 24 * 60 * 60;
const CANDLE_DAYS = 220; // covers the 6-month chart with margin
const NEWS_DAYS = 185;   // 6 months of headlines for spike matching
const NEWS_CAP = 120;

async function getJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const finnhub = (path, params, key) =>
  getJson(`https://finnhub.io/api/v1${path}?` +
    new URLSearchParams({ ...params, token: key }));

function isoDate(unixSec) {
  const ms = Number(unixSec) * 1000;
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/* The feed is documented as parallel arrays, but a malformed reply that
   carries timestamps and no closes would throw here and take the whole
   market response down with it. Every series is checked. */
function mapFinnhubCandles(raw) {
  if (!raw || raw.s !== "ok" || !Array.isArray(raw.t)) return null;
  const col = (a) => (Array.isArray(a) ? a : []);
  const o = col(raw.o), h = col(raw.h), l = col(raw.l), c = col(raw.c), v = col(raw.v);
  return raw.t.map((t, i) => ({
    date: isoDate(t),
    open: o[i], high: h[i], low: l[i], close: c[i], volume: v[i],
  })).filter((row) => row.date !== null);
}

async function yahooDaily(ticker) {
  const raw = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(ticker)}?interval=1d&range=6mo`);
  const res0 = raw && raw.chart && raw.chart.result && raw.chart.result[0];
  const ts = res0 && res0.timestamp;
  const q = res0 && res0.indicators && res0.indicators.quote
    && res0.indicators.quote[0];
  if (!Array.isArray(ts) || !q || !Array.isArray(q.close)) return null;
  const col = (a) => (Array.isArray(a) ? a : []);
  const qo = col(q.open), qh = col(q.high), ql = col(q.low), qv = col(q.volume);
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] == null) continue;
    if (isoDate(ts[i]) === null) continue;
    rows.push({
      date: isoDate(ts[i]),
      open: qo[i], high: qh[i], low: ql[i],
      close: q.close[i], volume: q.volume[i] || 0,
    });
  }
  return rows.length ? rows : null;
}

async function alphaVantageDaily(ticker, key) {
  const raw = await getJson("https://www.alphavantage.co/query?" +
    new URLSearchParams({
      function: "TIME_SERIES_DAILY", symbol: ticker,
      outputsize: "compact", apikey: key,
    }));
  const series = raw && raw["Time Series (Daily)"];
  if (!series) return null;
  return Object.entries(series)
    .map(([date, bar]) => ({
      date,
      open: Number(bar["1. open"]), high: Number(bar["2. high"]),
      low: Number(bar["3. low"]), close: Number(bar["4. close"]),
      volume: Number(bar["5. volume"]),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* Top value-traded days from a candle series — same metric the frontend
   uses for spike detection (OHLC-average x volume). */
function topValueDays(candles, n = 5) {
  if (!Array.isArray(candles) || !candles.length) return [];
  return candles.map((c) => ({
    date: c.date,
    value: ((c.open + c.high + c.low + c.close) / 4) * (c.volume || 0),
  })).sort((a, b) => b.value - a.value)
    .slice(0, n).map((x) => x.date);
}

/* Headlines within +/-3 days of a spike date. Marketaux covers a full
   6-month window (Finnhub's free tier does not), which is what lets the
   analysis match news to historical value-traded spikes. */
async function marketauxWindow(ticker, key, centerDate) {
  const center = new Date(centerDate + "T00:00:00Z").getTime();
  const after = new Date(center - 3 * DAY * 1000).toISOString().slice(0, 10);
  const before = new Date(center + 3 * DAY * 1000).toISOString().slice(0, 10);
  const raw = await getJson("https://api.marketaux.com/v1/news/all?" +
    new URLSearchParams({
      symbols: ticker, filter_entities: "true", language: "en",
      published_after: after + "T00:00:00",
      published_before: before + "T23:59:59",
      limit: "3", api_token: key,
    }));
  return raw && Array.isArray(raw.data) ? raw.data.map((n) => ({
    title: n.title,
    date: n.published_at ? n.published_at.slice(0, 10) : null,
    source: n.source || null,
    url: n.url || null,
  })) : [];
}

/* Per-ticker cache for spike-window headlines: each lookup costs up to 5
   Marketaux requests and the free plan allows 100/day, so repeat views of
   a ticker within 6h reuse the first result (per warm instance). */
const SPIKE_NEWS_TTL_MS = 6 * 60 * 60 * 1000;
const spikeNewsCache = globalThis.__spikeNewsCache ||
  (globalThis.__spikeNewsCache = new Map());

export default jsonSafe(async function handler(req, res) {
  /* public market data; lets a localhost dev session use the deployed API */
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ticker = String((req.query && req.query.ticker) || "")
    .toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  if (!ticker) return res.status(400).json({ error: "ticker required" });

  const FH = process.env.FINNHUB_API_KEY;
  const AV = process.env.ALPHAVANTAGE_API_KEY;
  const MA = process.env.MARKETAUX_API_KEY;
  if (!FH && !AV) {
    return res.status(503).json({ error: "market data providers not configured" });
  }

  const now = Math.floor(Date.now() / 1000);
  const from = now - CANDLE_DAYS * DAY;
  const newsFrom = new Date(Date.now() - NEWS_DAYS * DAY * 1000)
    .toISOString().slice(0, 10);
  const newsTo = new Date().toISOString().slice(0, 10);

  const [quote, profile, fhCandles, recommendation, priceTarget, fhNews] =
    await Promise.all(FH ? [
      finnhub("/quote", { symbol: ticker }, FH),
      finnhub("/stock/profile2", { symbol: ticker }, FH),
      finnhub("/stock/candle",
        { symbol: ticker, resolution: "D", from, to: now }, FH),
      finnhub("/stock/recommendation", { symbol: ticker }, FH),
      finnhub("/stock/price-target", { symbol: ticker }, FH),
      finnhub("/company-news",
        { symbol: ticker, from: newsFrom, to: newsTo }, FH),
    ] : [null, null, null, null, null, null]);

  // Candle chain: Finnhub (paid plans) → Yahoo Finance (free) →
  // Alpha Vantage (last resort; free tier is 25 requests/day).
  let candles = mapFinnhubCandles(fhCandles);
  let candleSource = candles ? "finnhub" : null;
  if (!candles) {
    candles = await yahooDaily(ticker);
    if (candles) candleSource = "yahoo";
  }
  if (!candles && AV) {
    candles = await alphaVantageDaily(ticker, AV);
    if (candles && candles.length) candleSource = "alphavantage";
    else candles = null;
  }

  // News: Finnhub first, Marketaux as fallback.
  let news = null;
  if (Array.isArray(fhNews) && fhNews.length) {
    /* Finnhub returns most-recent-first; a plain slice would drop older
       headlines for heavily covered tickers, leaving spike days from
       weeks/months ago with nothing to match. Keep dense recency (40),
       then spread the rest across the window at ~3 per ISO week. */
    const mondayOf = (dateStr) => {
      const d = new Date(dateStr + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    };
    const recent = fhNews.slice(0, 40);
    const weekCount = {};
    const spaced = [];
    for (const n of fhNews.slice(40)) {
      const dateStr = n.datetime ? isoDate(n.datetime) : null;
      const wk = dateStr ? mondayOf(dateStr) : "?";
      weekCount[wk] = (weekCount[wk] || 0) + 1;
      if (weekCount[wk] > 3) continue;
      spaced.push(n);
      if (recent.length + spaced.length >= NEWS_CAP) break;
    }
    news = recent.concat(spaced).slice(0, NEWS_CAP).map(n => ({
      title: n.headline,
      date: n.datetime ? isoDate(n.datetime) : null,
      source: n.source || null,
      url: n.url || null,
    }));
  }
  if (!news && MA) {
    const raw = await getJson("https://api.marketaux.com/v1/news/all?" +
      new URLSearchParams({
        symbols: ticker, filter_entities: "true",
        language: "en", limit: "50", api_token: MA,
      }));
    if (raw && Array.isArray(raw.data) && raw.data.length) {
      news = raw.data.map(n => ({
        title: n.title,
        date: n.published_at ? n.published_at.slice(0, 10) : null,
        source: n.source || null,
        url: n.url || null,
      }));
    }
  }

  /* Historical headlines around each top value-traded day. Without this
     the analysis has nothing to match against spikes older than a few
     days (Finnhub's free news window is very short). */
  if (MA && candles && candles.length) {
    let spikeNews = null;
    const hit = spikeNewsCache.get(ticker);
    if (hit && Date.now() - hit.at < SPIKE_NEWS_TTL_MS) {
      spikeNews = hit.items;
    } else {
      const chunks = await Promise.all(
        topValueDays(candles, 5).map((d) => marketauxWindow(ticker, MA, d)));
      spikeNews = chunks.flat();
      spikeNewsCache.set(ticker, { at: Date.now(), items: spikeNews });
    }
    if (spikeNews.length) {
      const seen = new Set((news || []).map((n) =>
        (n.title || "").toLowerCase()));
      const extra = spikeNews.filter((n) =>
        n.title && !seen.has(n.title.toLowerCase()));
      news = (news || []).concat(extra)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, NEWS_CAP);
    }
  }

  const rec = Array.isArray(recommendation) && recommendation.length
    ? recommendation[0] : null;

  res.setHeader("Cache-Control",
    "s-maxage=300, stale-while-revalidate=600");
  return res.status(200).json({
    ticker,
    asOf: new Date().toISOString(),
    quote: quote && typeof quote.c === "number" && quote.c > 0 ? {
      price: quote.c, changeAbs: quote.d, changePct: quote.dp,
      prevClose: quote.pc, time: quote.t ? isoDate(quote.t) : null,
    } : null,
    profile: profile && profile.ticker ? {
      marketCap: profile.marketCapitalization != null
        ? profile.marketCapitalization * 1e6 : null,
      sharesOutstanding: profile.shareOutstanding != null
        ? profile.shareOutstanding * 1e6 : null,
      floatShares: profile.floatingShare != null
        ? profile.floatingShare * 1e6 : null,
      logo: profile.logo || null,
      industry: profile.finnhubIndustry || null,
      website: profile.weburl || null,
    } : null,
    candles,
    candleSource,
    analyst: rec ? {
      period: rec.period, strongBuy: rec.strongBuy, buy: rec.buy,
      hold: rec.hold, sell: rec.sell, strongSell: rec.strongSell,
    } : null,
    priceTarget: priceTarget && priceTarget.targetMean != null ? {
      mean: priceTarget.targetMean, median: priceTarget.targetMedian,
      high: priceTarget.targetHigh, low: priceTarget.targetLow,
      analysts: priceTarget.numberAnalysts ?? null,
      updated: priceTarget.lastUpdated || null,
    } : null,
    news,
  });
}, { name: "market data" });
