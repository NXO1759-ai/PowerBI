/**
 * test-price-history.mjs — the monthly price endpoint against a real
 * Yahoo reply, offline.
 *
 * The fixture (scripts/fixtures/yahoo/BIZD-5y-1mo-2026-09-11.json) is
 * Yahoo chart v8's answer for BIZD, range=5y&interval=1mo, fetched on
 * 2026-09-11 and trimmed to the fields the handler reads: meta,
 * timestamp, quote[0].close and adjclose[0].adjclose. It holds the 61
 * points the blueprint verified (3.1): sixty monthly bars from
 * 2021-10-01 and the live quote appended at the last trade, 2026-09-11.
 *
 * fetch is replaced for the run, so the handler's own code path is
 * exercised — validation, the provider order, the User-Agent, the
 * mapping, the partial flag, the cache and the 502 — without the
 * network. The five-year figures for the M8 caption are printed, not
 * asserted: the blueprint records BIZD at −25.8% price and +24.4% total
 * return on 2026-09-11, and both move with every session.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(here, "fixtures/yahoo/BIZD-5y-1mo-2026-09-11.json"), "utf8"));
const YAHOO_404 = { chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } };
const FINNHUB_403 = { error: "You don't have access to this resource." };

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};

/* the same mock the smoke suite hands a handler */
function mockRes() {
  const r = { headers: {}, code: null, body: null,
    setHeader(k, v) { r.headers[k] = v; },
    status(c) { r.code = c; return r; },
    json(b) { r.body = b; return r; },
    end() { return r; } };
  return r;
}

/* fetch stand-in: every call is logged; the reply is chosen by host */
const calls = [];
let yahooReply = () => ({ status: 200, body: FIXTURE });
let finnhubReply = () => ({ status: 403, body: FINNHUB_403 });
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  calls.push({ url: u, headers: (opts && opts.headers) || {} });
  const r = /finnhub\.io/.test(u) ? finnhubReply(u) : yahooReply(u);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
};

const { default: handler } = await import("../api/price-history.js");
const cache = globalThis.__priceHistoryCache;
async function call(query) {
  const res = mockRes();
  await handler({ query }, res);
  return res;
}
function reset() { calls.length = 0; cache.clear(); }

delete process.env.FINNHUB_API_KEY;
const thisMonth = new Date().toISOString().slice(0, 7);

/* --- the BIZD five-year series ---------------------------------------- */
reset();
let res = await call({ ticker: "BIZD" });
const b = res.body;
check("BIZD answers 200", res.code === 200, JSON.stringify(b).slice(0, 120));
check("the shape is the contract", b.ticker === "BIZD" && b.source === "yahoo" && b.interval === "1mo" && b.range === "5y" && b.currency === "USD" && Array.isArray(b.points) && b.n === b.points.length);
check("61 points for range=5y (blueprint 3.1)", b.n === 61, String(b.n));
check("first point is 2021-10-01 (the UTC date of the first monthly bar)", b.points[0].d === "2021-10-01", b.points[0].d);
check("last point is 2026-09-11 (the live quote appended at the last trade)", b.points[60].d === "2026-09-11", b.points[60].d);
check("every date is YYYY-MM-DD and ascending", b.points.every((p, i) => /^\d{4}-\d{2}-\d{2}$/.test(p.d) && (i === 0 || p.d > b.points[i - 1].d)));
check("every point carries a finite close", b.points.every((p) => Number.isFinite(p.close)));
check("every point carries a finite adjClose", b.points.every((p) => Number.isFinite(p.adjClose)));
check("the reply says the closes are dividend-adjusted", b.adjusted === true);
/* the first bar: close 17.57, adjclose 10.481215 in the fixture */
check("close and adjClose are read from their own arrays", Math.abs(b.points[0].close - 17.57) < 1e-6 && Math.abs(b.points[0].adjClose - 10.481215) < 1e-6,
  b.points[0].close + " / " + b.points[0].adjClose);
check("points in a completed month carry no partial flag", b.points.filter((p) => p.d.slice(0, 7) !== thisMonth).every((p) => !("partial" in p)));
check("points in the current month are flagged partial", b.points.filter((p) => p.d.slice(0, 7) === thisMonth).every((p) => p.partial === true));
check("the last point is flagged partial exactly when its month is the current month",
  (b.points[60].partial === true) === (b.points[60].d.slice(0, 7) === thisMonth), b.points[60].d + " vs " + thisMonth);
check("Yahoo was asked with range=5y and interval=1mo", calls.length === 1 && /\/v8\/finance\/chart\/BIZD\?range=5y&interval=1mo$/.test(calls[0].url), calls[0] && calls[0].url);
check("Yahoo was sent an explicit browser-like User-Agent", /^Mozilla\/5\.0 /.test(String(calls[0].headers["User-Agent"])));
check("no Finnhub call without a key", calls.every((c) => !/finnhub/.test(c.url)));
check("the reply is cacheable for six hours", /s-maxage=21600/.test(res.headers["Cache-Control"]));

/* the caption figures: last over first, price and total return */
const first = b.points[0], last = b.points[b.points.length - 1];
const pct = (a, z) => ((z / a - 1) * 100).toFixed(1) + "%";
console.log("       BIZD five years from the fixture (" + first.d + " to " + last.d + "): price " +
  pct(first.close, last.close) + ", total return " + pct(first.adjClose, last.adjClose) +
  "  (blueprint 2026-09-11: −25.8% and +24.4%)");

/* --- the partial flag, both ways --------------------------------------- */
const withLastIn = (month) => {
  const f = JSON.parse(JSON.stringify(FIXTURE));
  const ts = f.chart.result[0].timestamp;
  ts[ts.length - 1] = Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1) / 1000 + 5 * 3600;
  return f;
};
reset();
yahooReply = () => ({ status: 200, body: withLastIn(thisMonth) });
res = await call({ ticker: "BIZD" });
check("a last point dated this month is partial", res.code === 200 && res.body.points[60].partial === true && res.body.points[60].d.slice(0, 7) === thisMonth);
reset();
const completed = JSON.parse(JSON.stringify(FIXTURE));
{ /* drop every point dated in the current month */
  const r0 = completed.chart.result[0];
  const keep = r0.timestamp.map((t) => new Date(t * 1000).toISOString().slice(0, 7) !== thisMonth);
  r0.timestamp = r0.timestamp.filter((_, i) => keep[i]);
  r0.indicators.quote[0].close = r0.indicators.quote[0].close.filter((_, i) => keep[i]);
  r0.indicators.adjclose[0].adjclose = r0.indicators.adjclose[0].adjclose.filter((_, i) => keep[i]);
}
yahooReply = () => ({ status: 200, body: completed });
res = await call({ ticker: "BIZD" });
check("with every month completed, no point is partial", res.code === 200 && res.body.points.every((p) => !("partial" in p)), String(res.body.n));
yahooReply = () => ({ status: 200, body: FIXTURE });

/* --- nulls dropped ------------------------------------------------------ */
reset();
{
  const holed = JSON.parse(JSON.stringify(FIXTURE));
  holed.chart.result[0].indicators.quote[0].close[5] = null;
  yahooReply = () => ({ status: 200, body: holed });
  res = await call({ ticker: "BIZD" });
  check("a null close is dropped, not served", res.code === 200 && res.body.n === 60 && res.body.points.every((p) => Number.isFinite(p.close)));
  yahooReply = () => ({ status: 200, body: FIXTURE });
}

/* --- the ticker rule ---------------------------------------------------- */
reset();
res = await call({});
check("no ticker answers 400", res.code === 400 && /ticker/.test(res.body.error));
res = await call({ ticker: "bad ticker" });
check("a space in the ticker answers 400", res.code === 400);
res = await call({ ticker: "B!ZD" });
check("punctuation outside dot and dash answers 400", res.code === 400);
res = await call({ ticker: "ABCDEFGHIJKLM" });
check("thirteen characters answer 400", res.code === 400);
res = await call({ ticker: "bizd" });
check("lower case is accepted and echoed upper", res.code === 200 && res.body.ticker === "BIZD");
res = await call({ ticker: "BRK.B" });
check("a dotted class ticker is accepted", res.code === 200 && res.body.ticker === "BRK.B");
check("no fetch was made for a rejected ticker", calls.every((c) => /\/(BIZD|BRK\.B)\?/.test(c.url)), calls.map((c) => c.url).join(" "));

/* --- the range rule ----------------------------------------------------- */
reset();
res = await call({ ticker: "BIZD", range: "max" });
check("range=max is passed to Yahoo", res.code === 200 && res.body.range === "max" && /range=max&interval=1mo/.test(calls[0].url));
res = await call({ ticker: "BIZD", range: "1y" });
check("any other range answers 400", res.code === 400 && /range/.test(res.body.error));
res = await call({ ticker: "BIZD", range: "" });
check("an empty range means 5y", res.code === 200 && res.body.range === "5y");

/* --- the cache ---------------------------------------------------------- */
reset();
await call({ ticker: "SRLN" });
await call({ ticker: "SRLN" });
check("a second call within six hours does not fetch again", calls.length === 1, String(calls.length));
await call({ ticker: "SRLN", range: "max" });
check("the cache is keyed by ticker and range", calls.length === 2, String(calls.length));

/* --- the provider order ------------------------------------------------- */
reset();
process.env.FINNHUB_API_KEY = "test-key";
res = await call({ ticker: "BIZD" });
check("with a key, Finnhub monthly candles are asked first", /finnhub\.io\/api\/v1\/stock\/candle\?/.test(calls[0].url) && /resolution=M/.test(calls[0].url), calls[0].url);
check("a 403 from Finnhub falls through to Yahoo", res.code === 200 && res.body.source === "yahoo" && calls.length === 2 && /yahoo/.test(calls[1].url));
reset();
finnhubReply = () => ({ status: 200, body: { s: "ok", t: [1633060800, 1635739200, 1638334800], c: [17.57, 17.15, 17.0] } });
res = await call({ ticker: "BIZD" });
check("when Finnhub answers, its closes are served and adjClose is null, not a copied price",
  res.code === 200 && res.body.source === "finnhub" && res.body.adjusted === false && res.body.n === 3 &&
  res.body.points[0].d === "2021-10-01" && res.body.points[0].close === 17.57 && res.body.points.every((p) => p.adjClose === null),
  JSON.stringify(res.body).slice(0, 160));
check("Yahoo was not called when Finnhub answered", calls.length === 1);
finnhubReply = () => ({ status: 403, body: FINNHUB_403 });
delete process.env.FINNHUB_API_KEY;

/* --- both providers failing --------------------------------------------- */
reset();
yahooReply = () => ({ status: 404, body: YAHOO_404 });
res = await call({ ticker: "ZZZZQQ" });
check("an unknown ticker answers 502 with a sentence in error", res.code === 502 && typeof res.body.error === "string" && /ZZZZQQ/.test(res.body.error), res.body.error);
check("the provider's reason is carried in the sentence", /symbol may be delisted/.test(res.body.error));
check("a failure is not cached", res.headers["Cache-Control"] === "no-store" && !cache.has("ZZZZQQ:5y"));
reset();
yahooReply = () => { throw new Error("socket hang up"); };
res = await call({ ticker: "BIZD" });
check("a dropped connection answers 502, not a crash", res.code === 502 && /unreachable/.test(res.body.error), res.body && res.body.error);
yahooReply = () => ({ status: 200, body: FIXTURE });

console.log(failed ? "\n" + failed + " failed" : "\nall price-history checks pass");
process.exit(failed ? 1 : 0);
