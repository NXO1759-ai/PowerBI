/**
 * /api/pull.js — Vercel serverless function.
 *
 * On-demand fundamentals pull for companies that are not in the exported
 * coverage set. The frontend's "Pull data" button calls this when a
 * searched company has no data file:
 *   GET /api/pull?ticker=RBLX&cik=1315098&name=Roblox%20Corp
 *
 * Fetches the same XBRL concept set the offline loader uses, straight
 * from SEC EDGAR's companyconcept API, and returns a data object shaped
 * exactly like the exported data/company-*.js files, so the frontend
 * renders it identically. Source is live SEC EDGAR — the same upstream
 * finance_db is built from.
 */

export const maxDuration = 60;

const SEC_UA = { "User-Agent": "Research Terminal admin@example.com" };
const DAY_MS = 24 * 60 * 60 * 1000;

/* [namespace, concept] — mirrors loaders/02_load_sec_data.py CONCEPTS */
const FLOW = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax",
            "Revenues",
            "RevenueFromContractWithCustomerIncludingAssessedTax",
            "SalesRevenueNet"],
  cogs: ["CostOfRevenue", "CostOfGoodsAndServicesSold"],
  grossProfit: ["GrossProfit"],
  netIncome: ["NetIncomeLoss"],
  cfOps: ["NetCashProvidedByUsedInOperatingActivities"],
  cfInv: ["NetCashProvidedByUsedInInvestingActivities"],
  cfFin: ["NetCashProvidedByUsedInFinancingActivities"],
};
const INSTANT = {
  cash: ["CashAndCashEquivalentsAtCarryingValue"],
  currentAssets: ["AssetsCurrent"],
  currentLiabilities: ["LiabilitiesCurrent"],
  totalAssets: ["Assets"],
  totalLiabilities: ["Liabilities"],
  equity: ["StockholdersEquity"],
  retainedEarnings: ["RetainedEarningsAccumulatedDeficit"],
};
const CONCEPTS = [
  ...new Set([...Object.values(FLOW).flat(), ...Object.values(INSTANT).flat(),
              "EarningsPerShareDiluted", "CommonStockSharesOutstanding"]),
];
const QUARTERS = ["Q1", "Q2", "Q3"];
const MIN_YEAR = new Date().getFullYear() - 6;

async function getJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { headers: SEC_UA, signal: ctrl.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function spanDays(r) {
  return r.start
    ? (new Date(r.end) - new Date(r.start)) / DAY_MS
    : 0;
}

/* Same rules as loaders/02, plus 20-F/40-F so foreign private issuers
   with tagged facts are not dropped: fy required, FY rows must span ~a
   full year, then per (unit, fy, fp) keep the latest period_end; ties
   prefer the LONGEST duration (YTD over single quarter, matching the
   database), then the latest filed date. */
const REPORT_FORM = /^(10-K|10-Q|20-F|40-F)(\/A)?$/;
function normalizeConcept(payload, concept) {
  const out = [];
  const units = payload && payload.units ? payload.units : {};
  for (const [unit, rows] of Object.entries(units)) {
    const groups = {};
    for (const r of rows) {
      if (r.fy == null || !REPORT_FORM.test(r.form)) continue;
      const fp = r.fp || "FY";
      if (r.fy < MIN_YEAR) continue;
      if (fp === "FY" && r.start && spanDays(r) < 300) continue;
      const key = `${unit}|${r.fy}|${fp}`;
      (groups[key] = groups[key] || []).push(r);
    }
    for (const g of Object.values(groups)) {
      const latestEnd = g.reduce((m, r) => (r.end > m ? r.end : m), "");
      const cur = g.filter((r) => r.end === latestEnd)
        .sort((a, b) => (spanDays(b) - spanDays(a)) ||
                        String(b.filed).localeCompare(String(a.filed)));
      const r = cur[0];
      out.push({
        concept, unit,
        fiscal_year: r.fy, fiscal_period: r.fp || "FY",
        period_end: r.end, value: r.val,
        filed_date: r.filed, form: r.form,
      });
    }
  }
  return out;
}

function usd(facts, concept, year, period) {
  const v = facts.find((f) => f.concept === concept && f.unit === "USD" &&
    f.fiscal_year === year && f.fiscal_period === period);
  return v ? Number(v.value) : null;
}
function usdAny(facts, concepts, year, period) {
  for (const c of concepts) {
    const v = usd(facts, c, year, period);
    if (v !== null) return v;
  }
  return null;
}
function latestQuarter(facts) {
  const pairs = new Set(
    facts.filter((f) => QUARTERS.includes(f.fiscal_period))
      .map((f) => `${f.fiscal_year}|${f.fiscal_period}`));
  if (!pairs.size) return [null, null];
  const year = Math.max(...[...pairs].map((p) => Number(p.split("|")[0])));
  const period = QUARTERS.filter((q) => pairs.has(`${year}|${q}`)).pop();
  return [year, period];
}
const prevPeriod = (p) => ({ Q2: "Q1", Q3: "Q2" }[p] || null);

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
  rows.sort((a, b) =>
    String(a.filed_date).localeCompare(String(b.filed_date)) ||
    (a.concept.startsWith("Entity") ? 1 : 0) -
    (b.concept.startsWith("Entity") ? 1 : 0));
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

export default async function handler(req, res) {
  const q = req.query || {};
  const ticker = String(q.ticker || "").toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  const cik = Number(String(q.cik || "").replace(/\D/g, ""));
  const name = String(q.name || ticker).slice(0, 120);
  if (!ticker || !cik) {
    return res.status(400).json({ error: "ticker and cik required" });
  }

  const cikPadded = String(cik).padStart(10, "0");

  /* Diagnose before pulling: if EDGAR lists no periodic reports at all
     (10-K/10-Q/20-F/40-F), there is nothing to pull — say so precisely
     instead of the generic "no facts" error. `filings.files` holds older
     filings beyond the recent page, so only conclude when it is empty. */
  const subs = await getJson(
    `https://data.sec.gov/submissions/CIK${cikPadded}.json`);
  if (subs && subs.filings && subs.filings.recent) {
    const recentForms = subs.filings.recent.form || [];
    const older = subs.filings.files || [];
    if (!recentForms.some((f) => REPORT_FORM.test(f)) && !older.length) {
      const only = [...new Set(recentForms)].slice(0, 6).join(", ") || "none";
      return res.status(404).json({
        error: `No periodic SEC reports on file for ${ticker} ` +
               `(CIK ${cik}) — EDGAR lists only: ${only}. ` +
               "Companies that report elsewhere (e.g. Canadian SEDAR+ " +
               "filers trading OTC) have no XBRL fundamentals to pull.",
      });
    }
  }

  const results = [];
  /* SEC allows ~10 req/s — fetch in batches of 6 */
  const calls = [
    ...CONCEPTS.map((c) => ["us-gaap", c]),
    ["dei", "EntityCommonStockSharesOutstanding"],
  ];
  for (let i = 0; i < calls.length; i += 6) {
    const batch = calls.slice(i, i + 6);
    const payloads = await Promise.all(batch.map(([ns, c]) =>
      getJson(`https://data.sec.gov/api/xbrl/companyconcept/` +
              `CIK${cikPadded}/${ns}/${c}.json`)));
    payloads.forEach((p, j) => {
      if (p) results.push(...normalizeConcept(p, batch[j][1]));
    });
  }

  if (!results.length) {
    return res.status(404).json({
      error: `No SEC XBRL facts found for ${ticker} (CIK ${cik}). ` +
             "It may file without XBRL tagging (or SEC EDGAR rate-limited " +
             "the pull — retry in a few seconds).",
    });
  }

  const facts = results;
  const [yr, per] = latestQuarter(facts);
  const lyYr = yr ? yr - 1 : null;
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

  const fyYears = facts.filter((f) => f.fiscal_period === "FY")
    .map((f) => f.fiscal_year);
  const isAnnualYr = fyYears.length ? Math.max(...fyYears) : null;
  const isFy = {};
  for (const k of ["revenue", "cogs", "grossProfit", "netIncome"]) {
    isFy[k] = isAnnualYr ? usdAny(facts, FLOW[k], isAnnualYr, "FY") : null;
  }
  const ends = facts.filter((f) => f.fiscal_year === yr &&
    f.fiscal_period === per && f.period_end).map((f) => f.period_end);
  const qEnd = ends.length ? ends.sort().pop() : null;
  const qEndStr = qEnd ? new Date(qEnd + "T00:00:00")
    .toLocaleDateString("en-US",
      { month: "short", day: "numeric", year: "numeric" }) : null;

  const sub = (a, b) =>
    a.q === null || b.q === null ? null : a.q - b.q;
  const subLy = (a, b) =>
    a.ly === null || b.ly === null ? null : a.ly - b.ly;
  const ratio = (a, b) =>
    a !== null && b ? a / b : null;

  const netChange = (side) => {
    const vals = [flows.cfOps[side], flows.cfInv[side], flows.cfFin[side]];
    return vals.every((v) => v === null) ? null
      : vals.reduce((s, v) => s + (v || 0), 0);
  };
  const burn = (side) => {
    const nc = netChange(side);
    if (nc === null) {
      return { netCashChange: null, monthlyBurn: null,
               remainingCashDays: null };
    }
    const monthly = nc / 3;
    const cash = instants.cash[side];
    let remaining = null;
    if (monthly >= 0) remaining = "Infinite";
    else if (cash !== null) remaining = Math.round(cash / -monthly * 30);
    return { netCashChange: nc, monthlyBurn: monthly,
             remainingCashDays: remaining };
  };

  let latestFiling = null;
  if (facts.length) {
    const newest = [...facts].sort((a, b) =>
      String(b.filed_date).localeCompare(String(a.filed_date)))[0];
    latestFiling = { form: newest.form, date: newest.filed_date };
  }

  const gm = (side) => ratio(flows.grossProfit[side], flows.revenue[side]);
  const data = {
    generatedAt: new Date().toISOString().slice(0, 19),
    source: "SEC EDGAR 10-K/10-Q (live pull)",
    company: { ticker, cik, name, exchange: null },
    latestFiling,
    period: {
      fiscalYear: yr, fiscalPeriod: per,
      label: yr ? `${per} ${yr}` : null,
      compareLabel: yr ? `${per} ${lyYr}` : null,
      isLabel: qEndStr ? `3 mo ended ${qEndStr}` : null,
      isCompareLabel: isAnnualYr ? `FY ${isAnnualYr} (annual)` : null,
    },
    fundamentals: {
      balanceSheet: {
        cash: instants.cash,
        currentAssets: instants.currentAssets,
        currentLiabilities: instants.currentLiabilities,
        workingCapital: {
          q: sub(instants.currentAssets, instants.currentLiabilities),
          ly: subLy(instants.currentAssets, instants.currentLiabilities),
        },
        retainedEarnings: instants.retainedEarnings,
        totalAssets: instants.totalAssets,
        totalLiabilities: instants.totalLiabilities,
        equity: instants.equity,
      },
      incomeStatement: {
        revenue: { q: flows.revenue.q, fy: isFy.revenue },
        cogs: { q: flows.cogs.q, fy: isFy.cogs },
        grossProfit: { q: flows.grossProfit.q, fy: isFy.grossProfit },
        grossMarginPct: { q: gm("q"),
                          fy: ratio(isFy.grossProfit, isFy.revenue) },
        netIncome: { q: flows.netIncome.q, fy: isFy.netIncome },
      },
      cashFlow: {
        cfOps: flows.cfOps, cfInv: flows.cfInv, cfFin: flows.cfFin,
        netCashChange: { q: netChange("q"), ly: netChange("ly") },
      },
      burnRate: { q: burn("q"), ly: burn("ly") },
    },
    shares: { outstanding: shares },
    price: null,
    earnings: {
      epsFiled: { q: epsFiled(facts, yr, per),
                  ly: epsFiled(facts, lyYr, per) },
      epsComputed: {
        q: flows.netIncome.q !== null && shares
          ? flows.netIncome.q / shares : null,
        ly: flows.netIncome.ly !== null && shares
          ? flows.netIncome.ly / shares : null,
      },
      epsEstimate: null, estimateNote: null,
    },
    insight: null,
    pending: null,
  };

  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json(data);
}
