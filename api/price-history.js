/**
 * /api/price-history.js — Vercel serverless function.
 *
 * Five years (or the full history) of monthly closes for one ticker,
 * with the dividend-adjusted close beside the price. The credit page
 * draws BIZD against a loan ETF from this, rebased to 100, as total
 * return with a price toggle — so both series travel together:
 *   GET /api/price-history?ticker=BIZD            five years
 *   GET /api/price-history?ticker=BIZD&range=max  everything Yahoo holds
 *
 * Providers, in order:
 *   FINNHUB_API_KEY  monthly candles, when the plan allows them (the
 *                    free plan does not: candles answer 403, and the
 *                    chain moves on). Finnhub candles are adjusted for
 *                    splits only, so on this path adjClose is null and
 *                    the reply says adjusted:false rather than passing
 *                    the price off as a total return.
 *   Yahoo chart v8   keyless; range=5y&interval=1mo answers 61 points
 *                    (verified 2026-09-11 for BIZD, SRLN and BKLN). It
 *                    needs a browser-like User-Agent — a bare request
 *                    is answered 429 — and it serves close and adjclose.
 *
 * Every point is { d, close, adjClose }. Yahoo's last point is the live
 * quote appended at the latest trade, and its bar for the running
 * month is month-to-date, so every point dated in the current month
 * carries partial:true; the page decides whether to dash or drop it.
 *
 * The six-hour cache is per ticker and range, in memory per warm
 * instance, the same pattern as the spike-news cache in market.js.
 */

import { jsonSafe } from "../scripts/lib/handler.mjs";

export const maxDuration = 30;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = globalThis.__priceHistoryCache ||
  (globalThis.__priceHistoryCache = new Map());

const TICKER_RE = /^[A-Z0-9.-]{1,12}$/;
const RANGES = ["5y", "max"];
const YEAR_SEC = 365.25 * 24 * 60 * 60;

/* Yahoo answers a bare fetch with 429; a browser-like agent is let in. */
const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* Same request style as getJson in market.js, with headers, and the
   failure kept so the reply can say why both providers failed. Both
   providers put the reason in a JSON body even on a 4xx (Yahoo: "No
   data found, symbol may be delisted"; Finnhub: "You don't have access
   to this resource"), so the body is read whatever the status. */
async function getJson(url, headers, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers });
    let data = null;
    try { data = await resp.json(); } catch { data = null; }
    return { ok: resp.ok, data, why: resp.ok ? null : "HTTP " + resp.status };
  } catch (e) {
    return { ok: false, data: null, why: e && e.name === "AbortError" ? "timed out" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/* as isoDate in market.js: the UTC date of a unix-second timestamp */
function isoDate(unixSec) {
  const ms = Number(unixSec) * 1000;
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/* Points dated in the running month are not a finished month. */
function flagPartial(points) {
  const thisMonth = new Date().toISOString().slice(0, 7);
  for (const p of points) if (p.d.slice(0, 7) === thisMonth) p.partial = true;
  return points;
}

/* Finnhub monthly candles, mapped as mapFinnhubCandles does in
   market.js: every column checked, a row without a date dropped. */
async function finnhubMonthly(ticker, range, key) {
  const to = Math.floor(Date.now() / 1000);
  const from = range === "max" ? 0 : Math.floor(to - 5 * YEAR_SEC);
  const { ok, data: raw, why } = await getJson("https://finnhub.io/api/v1/stock/candle?" +
    new URLSearchParams({ symbol: ticker, resolution: "M", from, to, token: key }));
  if (!ok || !raw || raw.s !== "ok" || !Array.isArray(raw.t)) {
    const reason = raw && typeof raw.error === "string" ? raw.error
      : raw && raw.s === "no_data" ? "no data" : why || "not answered";
    return { points: null, why: reason };
  }
  const c = Array.isArray(raw.c) ? raw.c : [];
  const points = [];
  for (let i = 0; i < raw.t.length; i++) {
    const d = isoDate(raw.t[i]);
    if (d === null || !finite(c[i])) continue;
    points.push({ d, close: c[i], adjClose: null });
  }
  return points.length ? { points, currency: null } : { points: null, why: "empty" };
}

/* Yahoo chart v8: the timestamp array with quote[0].close and
   adjclose[0].adjclose, nulls dropped, dates as the UTC date of the
   timestamp (the monthly bars sit at midnight New York time, so the
   UTC date is the first of the month). */
async function yahooMonthly(ticker, range) {
  const { ok, data: raw, why } = await getJson(
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(ticker) + "?" + new URLSearchParams({ range, interval: "1mo" }),
    { "User-Agent": YAHOO_UA, Accept: "application/json" });
  const chart = (raw && raw.chart) || {};
  const res0 = ok && Array.isArray(chart.result) && chart.result[0];
  if (!res0) {
    const err = chart.error && (chart.error.description || chart.error.code);
    return { points: null, why: err ? String(err) : why || "no result" };
  }
  const ts = res0.timestamp;
  const q = res0.indicators && res0.indicators.quote && res0.indicators.quote[0];
  const adj = res0.indicators && res0.indicators.adjclose && res0.indicators.adjclose[0];
  if (!Array.isArray(ts) || !q || !Array.isArray(q.close)) return { points: null, why: "no closes" };
  const adjclose = adj && Array.isArray(adj.adjclose) ? adj.adjclose : [];
  const points = [];
  for (let i = 0; i < ts.length; i++) {
    const d = isoDate(ts[i]);
    if (d === null || !finite(q.close[i])) continue;
    points.push({ d, close: q.close[i], adjClose: finite(adjclose[i]) ? adjclose[i] : null });
  }
  if (!points.length) return { points: null, why: "empty" };
  return { points, currency: (res0.meta && res0.meta.currency) || null };
}

export default jsonSafe(async function handler(req, res) {
  /* public market data; lets a localhost dev session use the deployed API */
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = req.query || {};
  const ticker = String(q.ticker || "").trim().toUpperCase();
  if (!ticker) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({ error: "ticker required" });
  }
  if (!TICKER_RE.test(ticker)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({ error: "ticker must be 1–12 characters: A–Z, 0–9, dot or dash" });
  }
  const range = q.range == null || q.range === "" ? "5y" : String(q.range);
  if (!RANGES.includes(range)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({ error: "range must be 5y or max" });
  }

  const key = ticker + ":" + range;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json(hit.payload);
  }

  // Finnhub (paid plans) → Yahoo chart v8 (keyless).
  const FH = process.env.FINNHUB_API_KEY;
  const failed = [];
  let got = null, source = null;
  if (FH) {
    got = await finnhubMonthly(ticker, range, FH);
    if (got.points) source = "finnhub";
    else failed.push("finnhub: " + got.why);
  }
  if (!source) {
    got = await yahooMonthly(ticker, range);
    if (got.points) source = "yahoo";
    else failed.push("yahoo: " + got.why);
  }
  if (!source) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({
      error: "No price history for " + ticker + " from any provider (" + failed.join("; ") + ").",
    });
  }

  const points = flagPartial(got.points);
  const payload = {
    ticker,
    source,
    interval: "1mo",
    range,
    currency: got.currency,
    adjusted: source === "yahoo",
    asOf: new Date().toISOString(),
    points,
    n: points.length,
  };
  cache.set(key, { at: Date.now(), payload });
  /* keep the map from growing without bound */
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) if (now - v.at > CACHE_TTL_MS) cache.delete(k);
  }
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
  return res.status(200).json(payload);
}, { name: "price history" });
