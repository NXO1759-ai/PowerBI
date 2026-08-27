/**
 * build-strategy-panel.mjs — the long-run panel behind the strategy view.
 *
 *   node scripts/build-strategy-panel.mjs [--limit N]
 *
 * Pulls every covered company's full annual history from SEC EDGAR and
 * writes one compact file: frontend/data/strategy-panel.js.
 *
 * Why precomputed rather than served live like /api/statements: industry
 * analysis is inherently cross-sectional. Concentration, profit pools and
 * a firm's rank against its peers all need EVERY company in the industry
 * at once, which would be 130 SEC round trips per page view. The panel is
 * built once and committed, so the dashboard opens instantly and the
 * whole universe is available for comparison.
 *
 * Coverage note: SEC XBRL begins around 2007-2009 — the mandate phased in
 * from 2009 — so this reaches back about 19 years, not to 2002. That
 * window still spans the financial crisis, the 2010s expansion, COVID and
 * the period since, which is enough to see an industry's structure change.
 *
 * Values are rounded to thousands and stored as arrays keyed by a field
 * order, which keeps the file near 400KB rather than several megabytes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStatements } from "./lib/statements.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UA = { "User-Agent": process.env.SEC_USER_AGENT ||
  "Research Terminal research@chineduokeke.mba" };

const argv = process.argv.slice(2);
const LIMIT = Number((argv[argv.indexOf("--limit") + 1]) || 0) || 0;

/* The fields a strategy read actually needs. Stored positionally. */
export const PANEL_FIELDS = [
  "revenue", "cogs", "grossProfit", "researchDevelopment",
  "sellingGeneralAdmin", "operatingIncome", "netIncome", "netIncomeIncludingNci",
  "interestExpense", "incomeTax", "pretaxIncome",
  "totalAssets", "currentAssets", "currentLiabilities", "inventory",
  "receivables", "ppe", "goodwill", "intangibles", "cash",
  "shortTermInvestments", "shortTermDebt", "longTermDebt",
  "equity", "minorityInterest", "equityIncludingNci",
  "cfOps", "cfInv", "cfFin", "capex", "depreciationAmortization",
  "shareBasedComp", "dividendsPaid", "buybacks",
  /* Added for the company case. sellingMarketing separates customer
     acquisition spend from general overhead where a filer splits them;
     payables completes the cash-conversion cycle; deferredRevenue and
     remainingPerformanceObligation are the only forward-looking demand
     figures a filing carries. */
  "sellingMarketing", "payables", "deferredRevenue",
  "remainingPerformanceObligation",
];
const WHERE = {
  incomeStatement: ["revenue","cogs","grossProfit","researchDevelopment",
    "sellingGeneralAdmin","operatingIncome","netIncome","netIncomeIncludingNci",
    "interestExpense","incomeTax","pretaxIncome","sellingMarketing"],
  balanceSheet: ["totalAssets","currentAssets","currentLiabilities","inventory",
    "receivables","ppe","goodwill","intangibles","cash","shortTermInvestments",
    "shortTermDebt","longTermDebt","equity","minorityInterest","equityIncludingNci",
    "payables","deferredRevenue","remainingPerformanceObligation"],
  cashFlow: ["cfOps","cfInv","cfFin","capex","depreciationAmortization",
    "shareBasedComp","dividendsPaid","buybacks"],
};
const STATEMENT_OF = {};
for (const [stmt, fields] of Object.entries(WHERE)) {
  for (const f of fields) STATEMENT_OF[f] = stmt;
}

function loadUniverse() {
  const stub = {};
  for (const f of ["company-index.js", "coverage.js", "industry-map.js"]) {
    new Function("window", readFileSync(join(ROOT, "frontend/data", f), "utf8"))(stub);
  }
  const index = stub.COMPANY_INDEX || [];
  const covered = new Set(stub.COMPANY_COVERAGE || []);
  const byTicker = new Map(index.map((r) => [r[0], { ticker: r[0], cik: r[1], name: r[2] }]));
  const map = stub.INDUSTRY_MAP || {};
  /* The industry map already resolved tickers that carry more than one
     CIK, so its choice is authoritative here. */
  const list = [...covered].map((t) => {
    const base = byTicker.get(t);
    const resolved = map[t];
    if (resolved && resolved.cik) return { ticker: t, cik: resolved.cik, name: resolved.name };
    return base;
  }).filter(Boolean);
  return { list: LIMIT ? list.slice(0, LIMIT) : list, map };
}

let nextSlot = 0;
async function paced() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 130;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

/* Thousands, not dollars: a strategy view never needs the last three
   digits of a multi-billion-dollar line, and dropping them cuts the file
   roughly in half. */
const k = (v) => (typeof v === "number" && isFinite(v) ? Math.round(v / 1000) : null);

const { list, map } = loadUniverse();
console.log(`strategy panel: ${list.length} companies`);
const companies = {};
const failures = [];
for (const c of list) {
  /* Retry on a throttle or a blip. A single dropped response silently
     removes a company from its industry, which quietly changes every
     concentration and rank figure that industry produces — a failure that
     looks like data rather than an error. */
  let facts = null, lastErr = null;
  for (let attempt = 0; attempt < 3 && !facts; attempt++) {
    await paced();
    try {
      const r = await fetch(
        `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(c.cik).padStart(10, "0")}.json`,
        { headers: UA });
      if (r.ok) { facts = await r.json(); break; }
      lastErr = `HTTP ${r.status}`;
      if (r.status === 404) break;
      await new Promise((res) => setTimeout(res, 700 * Math.pow(2, attempt)));
    } catch (e) {
      lastErr = e.message;
      await new Promise((res) => setTimeout(res, 700 * Math.pow(2, attempt)));
    }
  }
  if (!facts) { failures.push(`${c.ticker} ${lastErr}`); continue; }
  try {
    const bucket = facts && facts.facts && facts.facts["us-gaap"];
    if (!bucket) { failures.push(`${c.ticker} no us-gaap`); continue; }
    const s = buildStatements(bucket, { annualLimit: 25, quarterLimit: 1 });
    const years = {};
    for (const p of s.annual) {
      const row = PANEL_FIELDS.map((f) => k(p[STATEMENT_OF[f]][f]));
      /* Skip a year with no revenue and no assets — nothing to analyse. */
      if (row[0] === null && row[11] === null) continue;
      years[p.fiscalYear] = row;
    }
    if (!Object.keys(years).length) { failures.push(`${c.ticker} no usable years`); continue; }
    const meta = map[c.ticker] || {};
    companies[c.ticker] = {
      name: meta.name || c.name, cik: c.cik,
      industry: meta.industry || "Unclassified",
      sector: meta.sector || "Other",
      sic: meta.sic || null,
      fyEndMonth: s.fiscalYearEndMonth,
      years,
    };
    process.stdout.write(".");
  } catch (e) {
    failures.push(`${c.ticker} ${e.message}`);
  }
}
process.stdout.write("\n");

writeFileSync(join(ROOT, "frontend/data/strategy-panel.js"),
  "// Generated by scripts/build-strategy-panel.mjs — do not edit.\n" +
  "// Values are in THOUSANDS of USD. Fields are positional; see PANEL_FIELDS.\n" +
  "window.PANEL_FIELDS = " + JSON.stringify(PANEL_FIELDS) + ";\n" +
  "window.STRATEGY_PANEL = " + JSON.stringify(companies) + ";\n", "utf8");

const allYears = new Set();
let cells = 0, filled = 0;
for (const c of Object.values(companies)) {
  for (const [y, row] of Object.entries(c.years)) {
    allYears.add(Number(y));
    cells += row.length;
    filled += row.filter((v) => v !== null).length;
  }
}
const ys = [...allYears].sort();
const size = (readFileSync(join(ROOT, "frontend/data/strategy-panel.js")).length / 1024).toFixed(0);
console.log(`wrote frontend/data/strategy-panel.js — ${size}KB`);
console.log(`${Object.keys(companies).length} companies, ${ys[0]}-${ys[ys.length - 1]}, ${(filled / cells * 100).toFixed(0)}% of cells populated`);
if (failures.length) console.log(`failures (${failures.length}): ${failures.slice(0, 12).join(", ")}`);
