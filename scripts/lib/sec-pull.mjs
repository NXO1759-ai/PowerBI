/**
 * sec-pull.mjs — SEC EDGAR XBRL -> the dashboard payload shape.
 *
 * One implementation, two callers: /api/pull.js serves it on demand for a
 * company the site has never seen, and scripts/refresh.mjs runs it weekly
 * across the whole universe. Before this module the two had separate
 * copies of the same rules, which is how a concept added to one silently
 * failed to appear in the other.
 *
 * Every derived figure comes from frontend/lib/metrics.js. Nothing is
 * recomputed here.
 */

import { createRequire } from "node:module";
import { INCOME, BALANCE, CASHFLOW } from "./concepts.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const M = require(join(ROOT, "frontend/lib/metrics.js"));

/* SEC asks for a real contact address in the User-Agent and throttles
   anonymous-looking traffic. */
export const SEC_UA = {
  "User-Agent": process.env.SEC_USER_AGENT ||
    "Research Terminal research@chineduokeke.mba",
};

const DAY_MS = 86400000;

/* Duration concepts: measured over a period. Alternates are ordered by
   taxonomy preference — the ASC 606 tag first, older ones after, so a
   company that switched tags keeps a continuous series. */
/* The concept lists come from concepts.mjs, the one place they are
   defined. They were copied here once and the copy drifted: it still
   ranked the ASC 606 revenue tag ahead of Revenues, so the weekly refresh
   — which writes the data the Company Overview serves — resolved a
   property trust or a lender to a fraction of its real top line. American
   Tower $0.9bn against $10.6bn, Capital One $8.1bn against $53.4bn.
   pullCompany takes the first tag a company reports, so ordering carries
   the fix on this path: Revenues leads, and a total is never passed over
   for one of its own components. */
export const FLOW = {
  revenue: INCOME.revenue,
  cogs: INCOME.cogs,
  grossProfit: INCOME.grossProfit,
  netIncome: INCOME.netIncome,
  cfOps: CASHFLOW.cfOps,
  cfInv: CASHFLOW.cfInv,
  cfFin: CASHFLOW.cfFin,
};
export const INSTANT = {
  cash: BALANCE.cash,
  currentAssets: BALANCE.currentAssets,
  currentLiabilities: BALANCE.currentLiabilities,
  totalAssets: BALANCE.totalAssets,
  totalLiabilities: BALANCE.totalLiabilities,
  equity: BALANCE.equity,
  minorityInterest: BALANCE.minorityInterest,
  equityIncludingNci: BALANCE.equityIncludingNci,
  retainedEarnings: BALANCE.retainedEarnings,
};

export const SEC_CONCEPTS = [...new Set([
  ...Object.values(FLOW).flat(),
  ...Object.values(INSTANT).flat(),
  "EarningsPerShareDiluted",
  "CommonStockSharesOutstanding",
])];

const QUARTERS = ["Q1", "Q2", "Q3"];
const MIN_YEAR = new Date().getFullYear() - 6;
/* Periodic reports, plus the 6-K interim reports of foreign private
   issuers, which is where a foreign filer's quarters and half-years
   actually live. statements.mjs has accepted 6-K since the Enlivex work;
   this list had not caught up, which left the on-demand pull path with
   its own copy of the regex. No covered company files a 6-K, so widening
   it here cannot change any published data file. */
const REPORT_FORM = /^(10-K|10-Q|20-F|40-F|6-K)(\/A)?$/;

/* SEC publishes a 10 requests/second ceiling and answers 429 past it.
   One gate across the whole run, not per company: 130 companies x 23
   concepts is ~3,000 requests, and pacing them per-batch let the overall
   rate reach ~23/s. Every request waits its turn here. */
const MIN_INTERVAL_MS = Number(process.env.SEC_MIN_INTERVAL_MS || 125);
let nextSlotAt = 0;
async function paced() {
  const now = Date.now();
  const wait = Math.max(0, nextSlotAt - now);
  /* reserve the slot synchronously so concurrent callers queue rather
     than all reading the same timestamp and firing together */
  nextSlotAt = Math.max(now, nextSlotAt) + MIN_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export const rateLimitHits = { count: 0 };

async function getJson(url, { timeoutMs = 15000, retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await paced();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { headers: SEC_UA, signal: ctrl.signal });
      /* 404 is the normal answer for a concept this company never tags —
         not a failure, and retrying it wastes the rate budget. */
      if (resp.status === 404) return null;
      if (resp.status === 429 || resp.status >= 500) {
        rateLimitHits.count++;
        if (attempt === retries) return null;
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
        continue;
      }
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      if (attempt === retries) return null;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const spanDays = (r) =>
  r.start ? (new Date(r.end) - new Date(r.start)) / DAY_MS : 0;

/* EDGAR restates: the same concept and period reappears in later filings
   and amendments. Keep exactly one per (unit, year, period) — latest
   period_end, then longest duration (YTD over a stub), then latest filed.
   sql/06_canonical_views.sql applies the identical precedence. */
function normalizeConcept(payload, concept) {
  const out = [];
  const units = (payload && payload.units) || {};
  for (const [unit, rows] of Object.entries(units)) {
    if (!Array.isArray(rows)) continue;
    const groups = {};
    for (const r of rows) {
      if (r.fy == null || !REPORT_FORM.test(r.form || "")) continue;
      const fp = r.fp || "FY";
      if (r.fy < MIN_YEAR) continue;
      if (fp === "FY" && r.start && spanDays(r) < 300) continue;
      const key = `${unit}|${r.fy}|${fp}`;
      (groups[key] = groups[key] || []).push(r);
    }
    for (const g of Object.values(groups)) {
      const latestEnd = g.reduce((m, r) => (r.end > m ? r.end : m), "");
      const r = g.filter((x) => x.end === latestEnd)
        .sort((a, b) => (spanDays(b) - spanDays(a)) ||
                        String(b.filed).localeCompare(String(a.filed)))[0];
      out.push({
        concept, unit,
        fiscal_year: r.fy, fiscal_period: r.fp || "FY",
        period_end: r.end, value: r.val, filed_date: r.filed, form: r.form,
        /* the filing this figure came from — financial_facts.accession_no
           is NOT NULL, and it is the provenance link back to EDGAR */
        accession_no: r.accn || null,
      });
    }
  }
  return out;
}

const usd = (facts, concept, year, period) => {
  const v = facts.find((f) => f.concept === concept && f.unit === "USD" &&
    f.fiscal_year === year && f.fiscal_period === period);
  return v ? Number(v.value) : null;
};
const usdAny = (facts, concepts, year, period) => {
  for (const c of concepts) {
    const v = usd(facts, c, year, period);
    if (v !== null) return v;
  }
  return null;
};
const prevPeriod = (p) => ({ Q2: "Q1", Q3: "Q2" }[p] || null);

function latestQuarter(facts) {
  const pairs = new Set(facts.filter((f) => QUARTERS.includes(f.fiscal_period))
    .map((f) => `${f.fiscal_year}|${f.fiscal_period}`));
  if (!pairs.size) return [null, null];
  const year = Math.max(...[...pairs].map((p) => Number(p.split("|")[0])));
  const period = QUARTERS.filter((q) => pairs.has(`${year}|${q}`)).pop();
  return [year, period];
}

/* EDGAR tags cash-flow and income lines year-to-date. A single quarter is
   the YTD figure minus the prior quarter's, or the raw value in Q1. */
function flowValue(facts, concepts, year, period) {
  const cur = usdAny(facts, concepts, year, period);
  const pp = prevPeriod(period);
  if (pp === null) return cur;
  const prev = usdAny(facts, concepts, year, pp);
  if (cur === null && prev === null) return null;
  return (cur || 0) - (prev || 0);
}

function sharesOutstanding(facts) {
  const rows = facts.filter((f) =>
    ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"]
      .includes(f.concept) && f.unit === "shares");
  if (!rows.length) return null;
  rows.sort((a, b) => String(a.filed_date).localeCompare(String(b.filed_date)) ||
    (a.concept.startsWith("Entity") ? 1 : 0) - (b.concept.startsWith("Entity") ? 1 : 0));
  return Number(rows[rows.length - 1].value);
}

function epsFiled(facts, year, period) {
  const val = (y, p) => {
    const r = facts.find((f) => f.concept === "EarningsPerShareDiluted" &&
      f.unit === "USD/shares" && f.fiscal_year === y && f.fiscal_period === p);
    return r ? Number(r.value) : null;
  };
  const cur = val(year, period);
  const pp = prevPeriod(period);
  if (pp === null) return cur;
  const prev = val(year, pp);
  if (cur === null && prev === null) return null;
  return (cur || 0) - (prev || 0);
}

const WANTED = new Set(SEC_CONCEPTS);
const DEI_WANTED = new Set(["EntityCommonStockSharesOutstanding"]);

/* Preferred path: one companyfacts call returns every concept at once.
   That is 1 request per company instead of 23, so the whole universe
   costs ~130 requests rather than ~3,000, and it is the only path that
   works for some filers — SEC's per-concept endpoint answers 200 with
   "units":{"USD":{}} for Coca-Cola, Abbott, Capital One, NXP, S&P Global
   and Welltower, which reads as "no data" while companyfacts holds the
   full history. */
async function fetchFromCompanyFacts(padded) {
  const payload = await getJson(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`,
    { timeoutMs: 45000 });
  if (!payload || !payload.facts) return null;
  const results = [];
  for (const [taxonomy, wanted] of [["us-gaap", WANTED], ["dei", DEI_WANTED]]) {
    const bucket = payload.facts[taxonomy];
    if (!bucket) continue;
    for (const concept of Object.keys(bucket)) {
      if (!wanted.has(concept)) continue;
      results.push(...normalizeConcept(bucket[concept], concept));
    }
  }
  return results;
}

/* Fallback: one request per concept. Kept because companyfacts is a large
   response that can time out, and a slow pull beats no pull. */
async function fetchFromCompanyConcept(padded, batchSize) {
  const calls = [
    ...SEC_CONCEPTS.map((c) => ["us-gaap", c]),
    ["dei", "EntityCommonStockSharesOutstanding"],
  ];
  const results = [];
  /* Pacing is global in getJson, so this only bounds requests in flight. */
  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);
    const payloads = await Promise.all(batch.map(([ns, c]) =>
      getJson(`https://data.sec.gov/api/xbrl/companyconcept/CIK${padded}/${ns}/${c}.json`)));
    payloads.forEach((p, j) => {
      if (p) results.push(...normalizeConcept(p, batch[j][1]));
    });
  }
  return results;
}

export async function fetchFacts(cik, { batchSize = 4 } = {}) {
  const padded = String(cik).padStart(10, "0");
  const bulk = await fetchFromCompanyFacts(padded);
  if (bulk && bulk.length) return bulk;
  return fetchFromCompanyConcept(padded, batchSize);
}

/* Builds the payload the dashboard renders. Shape is identical to the
   committed data/company-*.js files. */
export function buildPayload(company, facts, { source, preferLatestPeriod = false } = {}) {
  if (!Array.isArray(facts) || !facts.length) return null;

  let [yr, per] = latestQuarter(facts);
  const fyYears = facts.filter((f) => f.fiscal_period === "FY").map((f) => f.fiscal_year);
  if (yr === null && fyYears.length) { yr = Math.max(...fyYears); per = "FY"; }
  if (yr === null) return null;

  /* preferLatestPeriod: a newer annual report outranks an older latest
     quarter. A foreign filer's tagged interims can stop before its 20-F,
     and the on-demand pull should show the most recent period it has.
     Off by default: for a domestic 10-K filer the fiscal year always ends
     after the third quarter, so switching this on would move every
     covered company's overview from its latest quarter to its full year. */
  if (preferLatestPeriod && per !== "FY" && fyYears.length) {
    const endOf = (year, period) => facts
      .filter((f) => f.fiscal_year === year && f.fiscal_period === period && f.period_end)
      .map((f) => f.period_end).sort().pop() || null;
    const fyLatest = Math.max(...fyYears);
    const qEnd = endOf(yr, per), fyEnd = endOf(fyLatest, "FY");
    if (qEnd && fyEnd && fyEnd > qEnd) { yr = fyLatest; per = "FY"; }
  }

  const lyYr = yr - 1;
  const shares = sharesOutstanding(facts);

  const flows = {}, instants = {};
  for (const [k, concepts] of Object.entries(FLOW)) {
    flows[k] = { q: flowValue(facts, concepts, yr, per),
                 ly: flowValue(facts, concepts, lyYr, per) };
  }
  for (const [k, concepts] of Object.entries(INSTANT)) {
    instants[k] = { q: usdAny(facts, concepts, yr, per),
                    ly: usdAny(facts, concepts, lyYr, per) };
  }

  const annualYr = fyYears.length ? Math.max(...fyYears) : null;
  const isFy = {};
  for (const k of ["revenue", "cogs", "grossProfit", "netIncome"]) {
    isFy[k] = annualYr ? usdAny(facts, FLOW[k], annualYr, "FY") : null;
  }

  const ends = facts.filter((f) => f.fiscal_year === yr &&
    f.fiscal_period === per && f.period_end).map((f) => f.period_end);
  const periodEnd = ends.length ? ends.sort().pop() : null;
  const endStr = periodEnd
    ? new Date(periodEnd + "T00:00:00").toLocaleDateString("en-US",
        { month: "short", day: "numeric", year: "numeric" })
    : null;

  const newest = [...facts].sort((a, b) =>
    String(b.filed_date).localeCompare(String(a.filed_date)))[0];
  const latestFiling = newest
    ? { form: newest.form, date: newest.filed_date,
        accession: newest.accession_no || null } : null;

  /* Per-concept provenance for the SQL sync: financial_facts is keyed on
     (cik, concept, unit, period_end, form), so each row needs the filing
     its own figure came from, not the company's newest filing. */
  const provenance = {};
  for (const f of facts) {
    if (f.fiscal_year === yr && f.fiscal_period === per && f.unit === "USD") {
      provenance[f.concept] = {
        periodEnd: f.period_end, filedDate: f.filed_date,
        form: f.form, accession: f.accession_no || null,
      };
    }
  }

  /* Every derived number below comes from metrics.js. */
  const side = (k) => (s) => instants[k][s];
  const wc = (s) => M.workingCapital(side("currentAssets")(s), side("currentLiabilities")(s));
  const ncc = (s) => M.netCashChange(flows.cfOps[s], flows.cfInv[s], flows.cfFin[s]);
  const burn = (s) => ({
    netCashChange: ncc(s),
    monthlyBurn: M.monthlyNetCash(ncc(s), per),
    remainingCashDays: M.remainingCashDays(instants.cash[s], ncc(s), per),
  });
  const gp = (s) => flows.grossProfit[s] !== null
    ? flows.grossProfit[s] : M.grossProfit(flows.revenue[s], flows.cogs[s]);

  return {
    generatedAt: new Date().toISOString().slice(0, 19),
    source: source || "SEC EDGAR 10-K/10-Q/20-F/40-F",
    definitionsVersion: M.DEFINITIONS_VERSION,
    company: {
      ticker: company.ticker, cik: company.cik, name: company.name,
      exchange: company.exchange || null,
    },
    latestFiling,
    periodEnd,
    provenance,
    period: {
      fiscalYear: yr, fiscalPeriod: per,
      label: `${per} ${yr}`,
      compareLabel: per === "FY" ? `FY ${lyYr}` : `${per} ${lyYr}`,
      isLabel: endStr
        ? (per === "FY" ? `FY ended ${endStr}` : `3 mo ended ${endStr}`) : null,
      isCompareLabel: annualYr ? `FY ${annualYr} (annual)` : null,
    },
    fundamentals: {
      balanceSheet: {
        cash: instants.cash,
        currentAssets: instants.currentAssets,
        currentLiabilities: instants.currentLiabilities,
        workingCapital: { q: wc("q"), ly: wc("ly") },
        retainedEarnings: instants.retainedEarnings,
        totalAssets: instants.totalAssets,
        totalLiabilities: instants.totalLiabilities,
        equity: instants.equity,
        minorityInterest: instants.minorityInterest,
        equityIncludingNci: instants.equityIncludingNci,
      },
      incomeStatement: {
        revenue: { q: flows.revenue.q, fy: isFy.revenue },
        cogs: { q: flows.cogs.q, fy: isFy.cogs },
        grossProfit: { q: gp("q"), fy: isFy.grossProfit },
        grossMarginPct: {
          q: M.grossMarginPct(gp("q"), flows.revenue.q),
          fy: M.grossMarginPct(isFy.grossProfit, isFy.revenue),
        },
        netIncome: { q: flows.netIncome.q, fy: isFy.netIncome },
      },
      cashFlow: {
        cfOps: flows.cfOps, cfInv: flows.cfInv, cfFin: flows.cfFin,
        netCashChange: { q: ncc("q"), ly: ncc("ly") },
      },
      burnRate: { q: burn("q"), ly: burn("ly") },
    },
    shares: { outstanding: shares },
    price: null,
    earnings: {
      epsFiled: { q: epsFiled(facts, yr, per), ly: epsFiled(facts, lyYr, per) },
      epsComputed: {
        q: M.epsComputed(flows.netIncome.q, shares),
        ly: M.epsComputed(flows.netIncome.ly, shares),
      },
      epsEstimate: null, estimateNote: null,
    },
    insight: null,
    pending: null,
  };
}

export async function pullCompany(company, opts = {}) {
  const facts = await fetchFacts(company.cik, opts);
  return buildPayload(company, facts, opts);
}
