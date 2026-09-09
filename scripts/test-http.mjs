import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const H = require("../frontend/lib/http.js");
let failed = 0;
const check = (n, ok, d) => { console.log((ok ? "  ok   " : "  FAIL ") + n + (d ? "  " + d : "")); if (!ok) failed++; };
const mk = (status, body, ok) => ({ status, ok: ok === undefined ? status >= 200 && status < 300 : ok, text: () => Promise.resolve(body) });

/* the exact body that reached the user */
const VERCEL_500 = "A server error has occurred\n\nFUNCTION_INVOCATION_FAILED\n\niad1::hxrhz-1788956554466-0340d46bff7b\n";
await H.json(mk(500, VERCEL_500), "PayPal Holdings, Inc. (PYPL)").then(
  () => check("an HTML 500 rejects rather than resolving", false),
  (e) => {
    check("no parser error reaches the message", !/JSON|Unexpected token/i.test(e.message), JSON.stringify(e.message));
    check("the message names our side, not the company", /fault on our side/.test(e.message));
    check("the raw body is kept for debugging", e.detail.includes("FUNCTION_INVOCATION_FAILED"));
    check("a 500 is marked retryable", e.retryable === true);
  });

/* our own endpoints put a sentence in error — it must win */
await H.json(mk(404, JSON.stringify({ error: "No periodic SEC reports on file for ZZZZ." })), "ZZZZ").then(
  () => check("a 404 rejects", false),
  (e) => {
    check("the endpoint's own sentence is used verbatim", e.message === "No periodic SEC reports on file for ZZZZ.", e.message);
    check("a 404 is not retryable", e.retryable === false);
  });

/* rate limiting is the one case where blaming SEC is correct */
await H.json(mk(429, "Too Many Requests"), "KO").then(
  () => check("a 429 rejects", false),
  (e) => check("only a 429 blames SEC rate limiting", /rate-limiting/.test(e.message) && e.retryable === true, e.message));

/* 503 = feed not configured */
await H.json(mk(503, ""), "valuation").then(
  () => check("a 503 rejects", false),
  (e) => check("503 reads as not configured", /not configured/.test(e.message), e.message));

/* a good reply still works */
await H.json(mk(200, JSON.stringify({ ticker: "PYPL", ok: true })), "PYPL").then(
  (b) => check("a JSON 200 resolves to the parsed body", b.ticker === "PYPL"),
  (e) => check("a JSON 200 resolves", false, e.message));

/* a 200 whose body is not JSON (a proxy interstitial) */
await H.json(mk(200, "<html>Just a moment…</html>"), "PYPL").then(
  () => check("a non-JSON 200 rejects", false),
  (e) => check("a non-JSON 200 rejects without a parser error", !/JSON/i.test(e.message), e.message));

/* the network dropping */
await H.json({ status: 0, ok: false, text: () => Promise.reject(new Error("Failed to fetch")) }, "PYPL").then(
  () => check("a dropped connection rejects", false),
  (e) => check("a dropped connection reads plainly", /connection dropped/.test(e.message) && e.retryable === true, e.message));

console.log(failed ? "\n" + failed + " failed" : "\nall http checks pass");
process.exit(failed ? 1 : 0);
