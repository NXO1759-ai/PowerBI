/**
 * concepts.mjs — the XBRL line items the terminal reads, and how it
 * resolves the ones companies tag differently.
 *
 * Every entry is an ORDERED list of candidate us-gaap tags. The first one
 * a company actually reports wins, so the order encodes taxonomy
 * preference: the current tag first, superseded ones after. A company
 * that changed tags mid-history still produces a continuous series.
 *
 * The alternates are not hypothetical. Checked across Apple, Coca-Cola,
 * Freeport-McMoRan, JPMorgan and UnitedHealth:
 *   - capex is PaymentsToAcquirePropertyPlantAndEquipment for Apple,
 *     Coca-Cola and UnitedHealth but neither Freeport nor JPMorgan tags it
 *   - D&A splits between DepreciationDepletionAndAmortization and
 *     DepreciationAndAmortization
 *   - dividends split between PaymentsOfDividendsCommonStock and the
 *     broader PaymentsOfDividends
 *   - AccountsPayableCurrent is tagged by only two of the five
 * A single-tag lookup silently returns nothing for the rest, which reads
 * as "this company has no capex" rather than "we asked the wrong way".
 *
 * DURATION items are measured over a period and are year-to-date in
 * EDGAR, so a single quarter is the YTD figure minus the prior quarter's.
 * INSTANT items are a point-in-time balance and are used as reported.
 */

/* ---------- income statement (duration) ---------- */
export const INCOME = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
  ],
  cogs: [
    "CostOfRevenue",
    "CostOfGoodsAndServicesSold",
    "CostOfGoodsSold",
  ],
  grossProfit: ["GrossProfit"],
  researchDevelopment: ["ResearchAndDevelopmentExpense"],
  sellingGeneralAdmin: [
    "SellingGeneralAndAdministrativeExpense",
    "GeneralAndAdministrativeExpense",
  ],
  sellingMarketing: ["SellingAndMarketingExpense"],
  operatingExpenses: [
    "OperatingExpenses",
    "CostsAndExpenses",
  ],
  operatingIncome: ["OperatingIncomeLoss"],
  interestExpense: [
    "InterestExpense",
    "InterestExpenseNonoperating",
    "InterestIncomeExpenseNet",
  ],
  pretaxIncome: [
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  ],
  incomeTax: ["IncomeTaxExpenseBenefit"],
  /* Net income attributable to the PARENT. This is the earnings figure
     per-share metrics divide, because it is what common shareholders own. */
  netIncome: ["NetIncomeLoss"],
  /* Net income INCLUDING noncontrolling interests — the whole bottom line
     of the consolidated entity. The reformulation needs this one: NOA is
     built on total equity, so the return on it must be measured with the
     income that belongs to all of that equity. Mixing parent-only income
     with total equity breaks the ROE identity by exactly the NCI share.
     ProfitLoss is the XBRL tag for the total; where a filer omits it the
     company has no material NCI and the two figures coincide. */
  netIncomeIncludingNci: ["ProfitLoss", "NetIncomeLoss"],
};

/* ---------- balance sheet (instant) ---------- */
export const BALANCE = {
  cash: ["CashAndCashEquivalentsAtCarryingValue"],
  shortTermInvestments: [
    "MarketableSecuritiesCurrent",
    "ShortTermInvestments",
    "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
  ],
  receivables: [
    "AccountsReceivableNetCurrent",
    "ReceivablesNetCurrent",
  ],
  inventory: ["InventoryNet"],
  currentAssets: ["AssetsCurrent"],
  ppe: ["PropertyPlantAndEquipmentNet"],
  goodwill: ["Goodwill"],
  intangibles: [
    "IntangibleAssetsNetExcludingGoodwill",
    "FiniteLivedIntangibleAssetsNet",
  ],
  operatingLeaseAsset: ["OperatingLeaseRightOfUseAsset"],
  totalAssets: ["Assets"],
  payables: [
    "AccountsPayableCurrent",
    "AccountsPayableAndAccruedLiabilitiesCurrent",
    "AccountsPayableTradeCurrent",
  ],
  deferredRevenue: [
    "ContractWithCustomerLiabilityCurrent",
    "DeferredRevenueCurrent",
  ],
  shortTermDebt: [
    "LongTermDebtCurrent",
    "ShortTermBorrowings",
    "DebtCurrent",
  ],
  currentLiabilities: ["LiabilitiesCurrent"],
  longTermDebt: [
    "LongTermDebtNoncurrent",
    "LongTermDebt",
  ],
  operatingLeaseLiability: [
    "OperatingLeaseLiabilityNoncurrent",
    "OperatingLeaseLiability",
  ],
  totalLiabilities: ["Liabilities"],
  equity: ["StockholdersEquity"],
  minorityInterest: ["MinorityInterest"],
  equityIncludingNci: [
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  ],
  retainedEarnings: ["RetainedEarningsAccumulatedDeficit"],
  treasuryStock: ["TreasuryStockValue"],
};

/* ---------- cash flow (duration) ---------- */
export const CASHFLOW = {
  cfOps: ["NetCashProvidedByUsedInOperatingActivities"],
  cfInv: ["NetCashProvidedByUsedInInvestingActivities"],
  cfFin: ["NetCashProvidedByUsedInFinancingActivities"],
  depreciationAmortization: [
    "DepreciationDepletionAndAmortization",
    "DepreciationAndAmortization",
    "DepreciationAmortizationAndAccretionNet",
  ],
  shareBasedComp: ["ShareBasedCompensation"],
  capex: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PaymentsForCapitalImprovements",
  ],
  dividendsPaid: [
    "PaymentsOfDividendsCommonStock",
    "PaymentsOfDividends",
  ],
  buybacks: ["PaymentsForRepurchaseOfCommonStock"],
};

/* ---------- per-share (duration, non-USD units) ---------- */
export const PERSHARE = {
  epsBasic: ["EarningsPerShareBasic"],
  epsDiluted: ["EarningsPerShareDiluted"],
};
export const SHARE_COUNTS = {
  dilutedShares: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
  basicShares: ["WeightedAverageNumberOfSharesOutstandingBasic",
                "WeightedAverageNumberOfSharesOutstanding"],
  sharesOutstanding: ["CommonStockSharesOutstanding"],
};

/* Every us-gaap tag the pull requests. One companyfacts call returns the
   whole taxonomy for a company, so widening this list costs no extra
   requests — the constraint is the response, not the concept count. */
export const ALL_CONCEPTS = [...new Set([
  ...Object.values(INCOME).flat(),
  ...Object.values(BALANCE).flat(),
  ...Object.values(CASHFLOW).flat(),
  ...Object.values(PERSHARE).flat(),
  ...Object.values(SHARE_COUNTS).flat(),
])];

/* Which map a line item belongs to decides how it is aggregated: duration
   items are de-cumulated from YTD, instant items are read straight. */
export const DURATION_GROUPS = { INCOME, CASHFLOW };
export const INSTANT_GROUPS = { BALANCE };
