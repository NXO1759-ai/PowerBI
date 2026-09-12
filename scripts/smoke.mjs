/**
 * smoke.mjs — the awkward-company suite.
 *
 * Every endpoint, run against the companies that break naive code: a
 * listing with quarters but no annual report, a bank with no revenue
 * line, a property trust whose lease income is not a contract with a
 * customer, an IFRS filer with no US-GAAP facts, a pre-revenue shell,
 * and one ordinary large company as the control. The handlers are
 * invoked directly with a mock request and response, so the suite needs
 * no deployment to run against and exercises the real code paths — the
 * ratio layer included, which is what a builder-output parity check
 * never touched and what let a shape error ship as a 500.
 *
 * Exit code is the verdict. Run locally with `node scripts/smoke.mjs`;
 * CI runs it on every pull request.
 */
process.env.SEC_USER_AGENT = process.env.SEC_USER_AGENT ||
  "Research Terminal research@chineduokeke.mba";

const CASES = [
  { ticker: "NVDA", cik: "1045810", why: "control — ordinary large filer" },
  { ticker: "AVEX", cik: "2096300", why: "new listing — quarters, no annual report" },
  { ticker: "JPM",  cik: "19617",   why: "bank — revenue net of interest, no operating income line" },
  { ticker: "AMT",  cik: "1053507", why: "property trust — lease income outside ASC 606" },
  { ticker: "ONON", cik: "1858985", why: "IFRS 20-F filer — no US-GAAP facts" },
  { ticker: "KBLB", cik: "1413119", why: "pre-revenue shell" },
  { ticker: "ENLV", cik: "1596812", why: "foreign filer — 20-F annual, 6-K interims, the latest untagged" },
];

function mockRes() {
  const r = { headers: {}, code: null, body: null,
    setHeader(k, v) { r.headers[k] = v; },
    status(c) { r.code = c; return r; },
    json(b) { r.body = b; return r; },
    end() { return r; } };
  return r;
}

const results = [];
let failures = 0;
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? " — " + detail : ""));
}

async function run(label, mod, req, expect) {
  const { default: handler } = await import(mod);
  const res = mockRes();
  const t0 = Date.now();
  try {
    await handler(req, res);
  } catch (e) {
    record(label, false, "threw: " + (e && e.message));
    return null;
  }
  const ms = Date.now() - t0;
  const verdict = expect(res);
  record(label + " (" + ms + "ms, HTTP " + res.code + ")", verdict === true, verdict === true ? "" : verdict);
  return res;
}

const isObj = (x) => x && typeof x === "object";

console.log("statements");
for (const c of CASES) {
  await run("statements " + c.ticker + " — " + c.why, "../api/statements.js",
    { query: { ticker: c.ticker, cik: c.cik, force: "1" } }, (res) => {
      if (res.code === 200) {
        const b = res.body;
        if (!Array.isArray(b.annual) || !Array.isArray(b.quarterly) || !Array.isArray(b.ltm)) return "missing period arrays";
        if (!isObj(b.ratios) || !Array.isArray(b.ratios.annual) || !Array.isArray(b.ratios.ltm)) return "missing ratios";
        /* every period must carry every group the ratio layer reads */
        for (const p of b.annual.concat(b.quarterly, b.ltm)) {
          for (const g of ["incomeStatement", "balanceSheet", "cashFlow", "perShare", "shares"]) {
            if (!isObj(p[g])) return p.label + " lacks " + g;
          }
        }
        if (c.ticker === "AVEX" && b.quarterly.length < 4) return "AEVEX should recover four quarters, got " + b.quarterly.length;
        if (c.ticker === "NVDA" && b.ltm.length < 20) return "NVDA LTM windows too few: " + b.ltm.length;
        return true;
      }
      if (res.code === 404 && (c.ticker === "ONON" || c.ticker === "KBLB")) return true;
      return "unexpected " + res.code + " " + JSON.stringify(res.body).slice(0, 120);
    });
}

console.log("panel");
for (const c of CASES) {
  await run("panel " + c.ticker + " — " + c.why, "../api/panel.js",
    { query: { ticker: c.ticker, cik: c.cik, force: "1" } }, (res) => {
      if (res.code === 200) {
        const b = res.body;
        if (!isObj(b.company) || !isObj(b.company.years)) return "missing company row";
        if (!Array.isArray(b.fields) || b.fields.length < 30) return "fields list wrong";
        return true;
      }
      if (res.code === 404) {
        if (c.ticker === "AVEX" && !/quarter/i.test(String(res.body && res.body.detail))) return "AEVEX 404 should explain the missing annual report";
        if (["AVEX", "ONON", "KBLB"].includes(c.ticker)) return true;
      }
      return "unexpected " + res.code + " " + JSON.stringify(res.body).slice(0, 120);
    });
}

console.log("segments / risks");
for (const c of CASES.filter((x) => ["NVDA", "AVEX", "JPM"].includes(x.ticker))) {
  await run("segments " + c.ticker, "../api/segments.js",
    { query: { ticker: c.ticker, cik: c.cik, force: "1" } }, (res) =>
      res.code === 200 && isObj(res.body.revenue) ? true
        : res.code === 404 ? true : "unexpected " + res.code);
  await run("risks " + c.ticker, "../api/risks.js",
    { query: { cik: c.cik, force: "1" } }, (res) =>
      res.code === 200 && Array.isArray(res.body.headings) ? true : "unexpected " + res.code);
}

/* The on-demand pull. SEC's per-concept endpoint answers 200 with
   "units":{"USD":{}} for these filers — an empty object where an array
   belongs — so the endpoint must reach them through the companyfacts
   bulk path and must never crash on the shape. Every one of them
   returned an HTML 500 before this suite covered the route. */
console.log("on-demand pull");
const PULL_CASES = [
  { ticker: "PYPL", cik: "1633917", why: "empty per-concept units — the reported crash" },
  { ticker: "KO",   cik: "21344",   why: "empty per-concept units" },
  { ticker: "COF",  cik: "927628",  why: "empty per-concept units, and a lender's revenue" },
  { ticker: "WELL", cik: "766704",  why: "empty per-concept units, and a property trust" },
  { ticker: "RBLX", cik: "1315098", why: "control — ordinary uncovered filer" },
  { ticker: "ENLV", cik: "1596812", why: "foreign filer — annual must outrank a stale quarter" },
];
for (const c of PULL_CASES) {
  await run("pull " + c.ticker + " — " + c.why, "../api/pull.js",
    { query: { ticker: c.ticker, cik: c.cik, name: c.ticker } }, (res) => {
      if (res.code !== 200) return "expected 200, got " + res.code + ": " + ((res.body && res.body.error) || "");
      const b = res.body;
      if (!isObj(b.company) || b.company.ticker !== c.ticker) return "company block missing";
      if (!isObj(b.period) || b.period.fiscalYear === null) return "no reporting period resolved";
      const bs = b.fundamentals && b.fundamentals.balanceSheet;
      if (!isObj(bs)) return "no balance sheet";
      /* the concept list must carry noncontrolling interest: without it an
         on-demand pull reports parent-only equity and the sheet cannot tie,
         while the same company in the exported set ties */
      if (!("minorityInterest" in bs) || !("equityIncludingNci" in bs)) {
        return "balance sheet omits the noncontrolling-interest concepts";
      }
      if (typeof bs.totalAssets.q !== "number") return "no total assets";
      if (b.definitionsVersion == null) return "payload carries no definitions version";
      return true;
    });
}

/* A pull that cannot work must still answer with JSON, never an HTML 500. */
await run("pull with a nonsense CIK answers JSON, not a crash", "../api/pull.js",
  { query: { ticker: "ZZZZ", cik: "9999999", name: "Nothing" } }, (res) => {
    if (res.code === 200) return "expected a failure for a nonexistent filer";
    if (!isObj(res.body) || typeof res.body.error !== "string") return "failure body is not JSON with an error";
    return true;
  });
await run("pull without a cik answers 400 JSON", "../api/pull.js",
  { query: { ticker: "PYPL" } }, (res) =>
    res.code === 400 && isObj(res.body) && res.body.error ? true : "expected a 400 with a JSON error");

console.log("macro / notes");
await run("macro", "../api/macro.js", { query: { force: "1" } }, (res) =>
  res.code === 200 && isObj(res.body.leading) && isObj(res.body.lagging) ? true : "unexpected " + res.code);

/* ---- credit macro (the credit page's conditions strip) -----------------
   Twenty-two FRED series, keyless through the public CSV. The strip's
   eight tiles are printed so a reviewer can read the live values off
   the run; the assertions are ranges, since the values move daily. */
const CREDIT_IDS = ["BAMLH0A0HYM2", "BAMLC0A0CM", "BAMLH0A1HYBB", "BAMLH0A2HYB", "BAMLH0A3HYC", "BAMLH0A0HYM2EY",
  "SOFR", "SOFR90DAYAVG", "BAA10Y", "DRTSCILM", "DRBLACBS", "CORBLACBS", "BUSLOANS", "DRSDCILM", "DRTSCIS",
  "NFCI", "STLFSI4", "T10Y2Y", "DPRIME", "LNFACBW027SBOG", "TOTBKCR", "USREC"];
const TILE_IDS = ["BAMLH0A0HYM2", "BAMLC0A0CM", "BAMLH0A1HYBB", "BAMLH0A2HYB", "BAMLH0A3HYC", "BAMLH0A0HYM2EY",
  "SOFR", "SOFR90DAYAVG", "BAA10Y", "DRTSCILM", "DRBLACBS", "CORBLACBS"];
const creditRes = await run("credit-macro — 22 FRED series, percentiles, recessions, the H.8 share", "../api/credit-macro.js",
  { query: { force: "1" } }, (res) => {
    if (res.code !== 200) return "expected 200, got " + res.code + ": " + ((res.body && res.body.error) || "");
    const b = res.body;
    if (!isObj(b.series) || b.source !== "FRED" || typeof b.keyed !== "boolean") return "shape wrong";
    const present = CREDIT_IDS.filter((id) => isObj(b.series[id]) && !b.series[id].error && isObj(b.series[id].latest));
    if (present.length < 20) return "only " + present.length + " of 22 series answered: missing " +
      CREDIT_IDS.filter((id) => !present.includes(id)).join(", ");
    const cutoff = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
    for (const id of present) {
      const s = b.series[id];
      if (s.freq === "daily" && s.latest.d < cutoff) return id + " is stale: " + s.latest.d;
      if (!isObj(s.percentile) || typeof s.percentile.p !== "number" || !s.percentile.n ||
          !s.percentile.windowStart || !s.percentile.windowEnd || !s.percentile.windowLabel) return id + " lacks its percentile";
      if (!Array.isArray(s.sparkline) || !Array.isArray(s.history) || !s.history.length) return id + " lacks its history";
    }
    const hy = b.series.BAMLH0A0HYM2;
    if (!hy || hy.error) return "no high-yield OAS";
    if (!(hy.latest.v > 1 && hy.latest.v < 15)) return "HY OAS out of range: " + hy.latest.v;
    if (hy.percentile.windowLabel !== "3-year") return "HY OAS window label is " + hy.percentile.windowLabel;
    if (!Array.isArray(b.recessions) || !b.recessions.length) return "no recession bands";
    const share = b.derived && b.derived.ndfiShare;
    if (!isObj(share) || !isObj(share.latest) || !(share.latest.v > 5 && share.latest.v < 20)) {
      return "H.8 share out of range: " + JSON.stringify(share && share.latest);
    }
    return true;
  });
if (creditRes && creditRes.code === 200) {
  for (const id of TILE_IDS) {
    const s = creditRes.body.series[id];
    console.log("         " + id.padEnd(15) + (s && !s.error ? s.latest.v + " (" + s.latest.d + ", p" + s.percentile.p + " " + s.percentile.windowLabel + ")" : "failed"));
  }
}
await run("credit-macro answers the next call from its cache", "../api/credit-macro.js",
  { query: {} }, (res) =>
    res.code === 200 && creditRes && res.body.generated === creditRes.body.generated &&
    /s-maxage/.test(String(res.headers["Cache-Control"])) ? true : "expected the cached payload, got HTTP " + res.code);
/* ---- end credit macro --------------------------------------------------- */

await run("fsa-note without key answers 503 or 200", "../api/fsa-note.js",
  { method: "POST", body: { ticker: "NVDA", periodLabel: "smoke", facts: ["a", "b", "c"] } },
  (res) => (res.code === 503 || res.code === 200 || res.code === 502) ? true : "unexpected " + res.code);
/* the Private Credit Terminal's Market view posts kind "credit" for PCMARKET; same gate, same 503 */
await run("fsa-note kind credit (PCMARKET) without key answers 503 or 200", "../api/fsa-note.js",
  { method: "POST", body: { kind: "credit", ticker: "PCMARKET", periodLabel: "smoke", facts: ["a", "b", "c"] } },
  (res) => (res.code === 503 || res.code === 200 || res.code === 502) ? true : "unexpected " + res.code);

console.log("market layer");
await run("valuation NVDA answers 200 with a key or 503 without", "../api/valuation.js",
  { query: { ticker: "NVDA", force: "1" } }, (res) =>
    res.code === 503 ? true
      : res.code === 200 && isObj(res.body.multiples) && isObj(res.body.history) ? true
      : "unexpected " + res.code);
await run("comps answers 200 with a key or 503 without", "../api/comps.js",
  { query: { tickers: "NKE,DECK" } }, (res) =>
    res.code === 503 ? true
      : res.code === 200 && Array.isArray(res.body.rows) ? true
      : "unexpected " + res.code);
await run("release NVDA — outlook and reconciliation from the 8-K exhibit", "../api/release.js",
  { query: { cik: "1045810", force: "1" } }, (res) =>
    res.code === 200 && Array.isArray(res.body.outlook) && Array.isArray(res.body.reconciliation) &&
    Array.isArray(res.body.guidanceTables) && /^https:\/\/www\.sec\.gov\//.test(res.body.url) ? true
      : "unexpected " + res.code + " " + JSON.stringify(res.body).slice(0, 120));
await run("release AVEX — a new listing may have no release yet", "../api/release.js",
  { query: { cik: "2096300", force: "1" } }, (res) =>
    res.code === 200 || res.code === 404 ? true : "unexpected " + res.code);

/* ---- price history (the credit page's BDC-against-loans chart) ----------
   Five years of monthly closes, keyless through Yahoo when Finnhub's plan
   has no candles. 61 points were verified on 2026-09-11; 55 leaves room
   for a provider that trims the first bar or omits the live tail. A
   provider that refuses the runner (Yahoo answers 429 to some cloud
   addresses) is logged, not counted: the parsing paths are covered
   offline by test-price-history.mjs, and a refusal is not a code fault. */
console.log("price history");
for (const t of ["BIZD", "SRLN"]) {
  await run("price-history " + t + " — five years, monthly, close and adjusted close", "../api/price-history.js",
    { query: { ticker: t } }, (res) => {
      if (res.code === 502 && isObj(res.body) && typeof res.body.error === "string") {
        console.log("         warning: " + t + " — both providers refused (" + res.body.error.slice(0, 120) + "); the shape checks did not run");
        return true;
      }
      if (res.code !== 200) return "expected 200, got " + res.code + ": " + ((res.body && res.body.error) || "");
      const b = res.body;
      if (b.ticker !== t || b.interval !== "1mo" || b.range !== "5y") return "shape wrong: " + JSON.stringify(b).slice(0, 100);
      if (!["finnhub", "yahoo"].includes(b.source)) return "unknown source " + b.source;
      if (!Array.isArray(b.points) || b.n !== b.points.length || b.n < 55) return "too few points: " + b.n;
      for (const p of b.points) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(p.d)) return "bad date " + p.d;
        if (!Number.isFinite(p.close)) return "close not finite at " + p.d;
        /* Finnhub candles carry no dividend-adjusted close; Yahoo's do */
        if (b.source === "yahoo" && !Number.isFinite(p.adjClose)) return "adjClose not finite at " + p.d;
      }
      return true;
    });
}
await run("price-history without a ticker answers 400 JSON", "../api/price-history.js",
  { query: {} }, (res) =>
    res.code === 400 && isObj(res.body) && res.body.error ? true : "expected a 400 with a JSON error");
/* ---- end price history ---------------------------------------------- */

console.log("");
console.log(results.length + " checks, " + failures + " failed");
process.exit(failures ? 1 : 0);
