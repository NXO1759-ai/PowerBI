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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PANEL_FIELDS, STATEMENT_OF, panelYears } from "./lib/panel-row.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStatements, trimHistory } from "./lib/statements.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UA = { "User-Agent": process.env.SEC_USER_AGENT ||
  "Research Terminal research@chineduokeke.mba" };

const argv = process.argv.slice(2);
const LIMIT = Number((argv[argv.indexOf("--limit") + 1]) || 0) || 0;

/* The field list and row mapping live in scripts/lib/panel-row.mjs —
   one definition, shared with the on-demand peer endpoint. PANEL_FIELDS
   is re-exported so existing importers keep working. */
export { PANEL_FIELDS } from "./lib/panel-row.mjs";

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

/* Where a CIK predates the company, the first period end that is the
   company's own, from frontend/data/cohorts.json (historyStart):
   TeraWulf's CIK is the IKONICS Corp shell it reverse-merged into in
   December 2021, so its feed carries a photo-imaging company's 2010-2021
   years, and Nebius's is Yandex N.V.'s. Keyed by CIK, so a ticker moving
   between registrants cannot carry a cutoff to the wrong filer. */
function historyStarts() {
  const file = join(ROOT, "frontend/data/cohorts.json");
  if (!existsSync(file)) return {};
  const cohorts = JSON.parse(readFileSync(file, "utf8"));
  const out = {};
  for (const group of ["hyperscalers", "neoclouds", "landlords"]) {
    for (const row of cohorts[group] || []) {
      if (row.historyStart && row.cik != null) out[Number(row.cik)] = row.historyStart;
    }
  }
  return out;
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

const { list, map } = loadUniverse();
const HISTORY_START = historyStarts();
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
    let bucket = facts && facts.facts && facts.facts["us-gaap"];
    if (!bucket) { failures.push(`${c.ticker} no us-gaap`); continue; }
    /* a shell's or predecessor's years are cut before the row is built */
    if (HISTORY_START[Number(c.cik)]) bucket = trimHistory(bucket, HISTORY_START[Number(c.cik)]);
    const s = buildStatements(bucket, { annualLimit: 25, quarterLimit: 1 });
    const years = panelYears(s);
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
