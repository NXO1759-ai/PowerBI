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

console.log("macro / notes");
await run("macro", "../api/macro.js", { query: { force: "1" } }, (res) =>
  res.code === 200 && isObj(res.body.leading) && isObj(res.body.lagging) ? true : "unexpected " + res.code);
await run("fsa-note without key answers 503 or 200", "../api/fsa-note.js",
  { method: "POST", body: { ticker: "NVDA", periodLabel: "smoke", facts: ["a", "b", "c"] } },
  (res) => (res.code === 503 || res.code === 200 || res.code === 502) ? true : "unexpected " + res.code);

console.log("");
console.log(results.length + " checks, " + failures + " failed");
process.exit(failures ? 1 : 0);
