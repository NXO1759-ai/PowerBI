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
  /* Revenue is resolved by TAKING THE LARGEST candidate per period, not
     by first-tag-wins. A component can never exceed the total it belongs
     to, so the largest is the total.
     Ordering alone cannot get this right. The ASC 606 tag is the whole top
     line for most operating companies after 2018, but only a slice of it
     wherever revenue arises outside a contract with a customer:
       - American Tower reports $0.9bn under ASC 606 against $10.6bn of
         Revenues, because a property trust's lease income is not a
         contract-with-customer item at all
       - Capital One reports $8.1bn against $53.4bn, the rest being
         interest income
     Ranking Revenues first instead would break the companies that stopped
     filing it once ASC 606 arrived. Taking the maximum needs no knowledge
     of which kind of company it is looking at.
     RevenuesNetOfInterestExpense is the bank convention for total net
     revenue and is the only total Goldman files; Wells Fargo and Morgan
     Stanley moved to it from Revenues mid-history. */
  revenue: [
    "Revenues",
    "RevenuesNetOfInterestExpense",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
    "SalesRevenueServicesNet",
    "TotalRevenuesAndOtherIncome",
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

/* Totals that some filers stop reporting while continuing to report every
   component of them. Applied ONLY where the primary tags found nothing for
   a period, and only when every component is present, so a partial sum can
   never masquerade as a total.
   Phillips 66 dropped the consolidated pre-tax line after 2020 and files
   only the domestic and foreign halves; without this it reports revenue
   and assets but no profit for five straight years. */
export const COMPOSITES = {
  pretaxIncome: [[
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesForeign",
  ]],
  revenue: [[
    "InterestAndDividendIncomeOperating",
    "NoninterestIncome",
  ]],
};

/* ---------- balance sheet (instant) ---------- */
export const BALANCE = {
  cash: ["CashAndCashEquivalentsAtCarryingValue"],
  /* Current balances only, deliberately.
     NVIDIA moved off MarketableSecuritiesCurrent after the year ended
     January 2025 and now reports AvailableForSaleSecuritiesDebtSecurities,
     so its latest year carries no investments here and its net cash is
     understated by roughly forty billion. That tag was tried and removed:
     it is a TOTAL, and for an insurer the total is the whole bond
     portfolio backing policy liabilities — Aflac $64bn, Chubb $79bn,
     Allstate $57bn — which is an operating asset, not spare cash. Feeding
     it to excess cash drives invested capital negative and drops those
     companies out of the return calculation altogether.
     Understating one company's cash makes its return look lower than it
     is, which is conservative. Overstating an insurer's spare cash makes
     its capital base vanish, which is not. */
  shortTermInvestments: [
    "MarketableSecuritiesCurrent",
    "ShortTermInvestments",
    "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
    /* NVIDIA moved its marketable securities to this tag in FY2026 */
    "DebtSecuritiesCurrent",
    "MarketableSecurities",
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
  /* Debt tags drift. Coca-Cola reported under LongTermDebtNoncurrent
     through 2023 and moved to LongTermDebtAndCapitalLeaseObligations
     after; without the newer tags its recent years show no debt at all,
     which flips net debt negative and makes a heavily-borrowed company
     look like it is sitting on net cash.
     Capital lease obligations belong here: they are interest-bearing
     obligations to a capital provider, which is the test that separates
     a financing liability from an operating one. */
  shortTermDebt: [
    "LongTermDebtCurrent",
    "LongTermDebtAndCapitalLeaseObligationsCurrent",
    "ShortTermBorrowings",
    "OtherShortTermBorrowings",
    "NotesAndLoansPayable",
    "DebtCurrent",
  ],
  currentLiabilities: ["LiabilitiesCurrent"],
  longTermDebt: [
    "LongTermDebtNoncurrent",
    "LongTermDebtAndCapitalLeaseObligations",
    "LongTermDebt",
  ],
  /* the whole obligation first; the non-current part alone is a floor
     for filers that never tag a total */
  operatingLeaseLiability: [
    "OperatingLeaseLiability",
    "OperatingLeaseLiabilityNoncurrent",
  ],
  totalLiabilities: ["Liabilities"],
  equity: ["StockholdersEquity"],
  minorityInterest: ["MinorityInterest"],
  equityIncludingNci: [
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  ],
  retainedEarnings: ["RetainedEarningsAccumulatedDeficit"],
  /* Revenue already contracted but not yet recognised — the closest thing
     in a filing to a sales pipeline, and unlike a pipeline it is signed.
     Disclosed under ASC 606, so it exists from 2018 and only for filers
     with performance obligations that outlast the period. */
  remainingPerformanceObligation: ["RevenueRemainingPerformanceObligation"],
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
  ...Object.values(COMPOSITES).flat(2),
  ...Object.values(BALANCE).flat(),
  ...Object.values(CASHFLOW).flat(),
  ...Object.values(PERSHARE).flat(),
  ...Object.values(SHARE_COUNTS).flat(),
])];

/* Which map a line item belongs to decides how it is aggregated: duration
   items are de-cumulated from YTD, instant items are read straight. */
export const DURATION_GROUPS = { INCOME, CASHFLOW };
export const INSTANT_GROUPS = { BALANCE };
