/**
 * panel-row.mjs — the ONE definition of how a company's statements become
 * a strategy-panel row.
 *
 * The weekly builder and the on-demand endpoint both produce rows the
 * frontend reads positionally, so a second copy of this mapping would be
 * a deploy-skew bug waiting to read revenue out of the cogs column. The
 * field list, the field→statement map, and the rounding all live here
 * and only here.
 *
 * Values are stored in THOUSANDS of USD.
 */

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
  /* sellingMarketing separates customer acquisition spend from general
     overhead where a filer splits them; payables completes the
     cash-conversion cycle; deferredRevenue and
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
export const STATEMENT_OF = {};
for (const [stmt, fields] of Object.entries(WHERE)) {
  for (const f of fields) STATEMENT_OF[f] = stmt;
}

const k = (v) => (typeof v === "number" && isFinite(v) ? Math.round(v / 1000) : null);

/** buildStatements() output → { "2015": [ …positional values… ], … } */
export function panelYears(statements) {
  const years = {};
  for (const p of statements.annual) {
    const row = PANEL_FIELDS.map((f) => k(p[STATEMENT_OF[f]][f]));
    /* Skip a year with no revenue and no assets — nothing to analyse. */
    if (row[0] === null && row[11] === null) continue;
    years[p.fiscalYear] = row;
  }
  return years;
}
