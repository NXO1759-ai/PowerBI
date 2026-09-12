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
  /* Resolved per period, never first-tag-wins across the series:
     InterestExpense went stale for Alphabet, Amazon and Equinix in 2024
     while InterestExpenseNonoperating carried on, and each period takes
     the first tag that reported IT. Meta, CoreWeave and IREN book the
     interest on their notes under InterestExpenseDebt (META 754,000,000
     for the quarter to 2026-06-30; CRWV 558,000,000), which fills the
     periods the three older tags never reported (FILL_ONLY); the
     excluding-amortization variant is the cash coupon alone (CRWV
     592,000,000) and ranks last. Ranking the alternates by recency
     instead was tried across the 130 covered companies and rejected: it
     promotes InterestIncomeExpenseNet, a bank's net interest income, for
     the fifteen lenders. */
  interestExpense: [
    "InterestExpense",
    "InterestExpenseNonoperating",
    "InterestIncomeExpenseNet",
    "InterestExpenseDebt",
    "InterestExpenseDebtExcludingAmortization",
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
  /* Meta, Alphabet and Amazon fold finance-lease right-of-use assets into
     one balance-sheet line and tag it with the combined concept, so their
     ppe was null (META 225,724,000,000; GOOG 321,212,000,000; AMZN
     446,046,000,000, all at 2026-06-30). Fills only the periods the plain
     tag never reported (FILL_ONLY), so a filer that tags both keeps its
     PP&E figure. */
  ppe: [
    "PropertyPlantAndEquipmentNet",
    "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization",
  ],
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
    /* Oracle (7,199,000,000 at 2026-05-31) and Applied Digital
       (16,422,000) file the current notes here; fills only the periods
       the tags above never reported (FILL_ONLY) */
    "NotesPayableCurrent",
  ],
  currentLiabilities: ["LiabilitiesCurrent"],
  /* Oracle's notes sit under LongTermNotesPayable in the 10-K
     (122,342,000,000 at 2026-05-31) and LongTermNotesAndLoans in the
     10-Q (124,718,000,000 at 2026-02-28); Applied Digital's under
     LongTermNotesPayable (4,959,516,000); Equinix's senior notes under
     SeniorLongTermNotes (18,519,000,000 at 2026-06-30); Digital Realty's
     under SeniorNotes (16,013,977,000 at 2026-03-31). Without them the
     panel showed no debt for Oracle at all. The four fill only the
     periods the first three never reported (FILL_ONLY). Senior notes
     rank ahead of LongTermNotesAndLoans because Equinix files its
     mortgages and loans under the latter (686,000,000 at 2025-12-31, a
     date its LongTermDebt skips) beside 16,910,000,000 of senior notes;
     SeniorNotes ranks last because Oracle also files each quarter's new
     issue under it (42,749,000,000 at 2026-02-28 is the quarter's
     issuance, not the balance) and LongTermNotesAndLoans catches those
     quarters first. Oracle's one LongTermDebt fact, a stray zero at
     2022-05-31, is therefore still served for that date: it is an
     existing figure, and this change fills gaps rather than re-deciding
     what was there. */
  longTermDebt: [
    "LongTermDebtNoncurrent",
    "LongTermDebtAndCapitalLeaseObligations",
    "LongTermDebt",
    "LongTermNotesPayable",
    "SeniorLongTermNotes",
    "LongTermNotesAndLoans",
    "SeniorNotes",
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

  /* ---- the build-out monitor: debt, leases and commitments (blueprint
     section 15). Every tag below was read from companyfacts on 2026-09-11
     for the filer named beside it; scripts/test-hs-concepts.mjs pins the
     values. ---- */

  /* total principal outstanding: the debt note's own total (CRWV
     35,551,000,000 at 2026-06-30; MSFT 46,136,000,000; ORCL 130,105,000,000
     at 2026-05-31), Oracle's combined-amount tag (129,541,000,000), then
     the face-value total Amazon files as LongTermDebt (132,995,000,000).
     The first tag is screened before it resolves (principalScreen in
     statements.mjs): Oracle files each quarter's new issue under it at
     10-Q dates (18,000,000,000 at 2025-11-30; 43,000,000,000 at
     2026-02-28, against 108,075,000,000 and 134,605,000,000 of debt on
     the balance sheet), and Amazon files its NON-CURRENT carrying amount
     under it (128,894,000,000 at 2026-06-30, the LongTermDebtNoncurrent
     figure to the dollar, beside 132,995,000,000 of face). A screened row
     falls through to the next tag at that date, or to null. */
  totalDebtPrincipal: [
    "DebtInstrumentCarryingAmount",
    "DebtLongtermAndShorttermCombinedAmount",
    "LongTermDebt",
  ],
  /* convertible notes at carrying value: IREN 3,687,832,000 at 2026-03-31
     (retagged into the generic debt tags in its FY2026 10-K), WULF
     1,101,976,000 at 2026-06-30 */
  convertibles: [
    "ConvertibleNotesPayable",
    "ConvertibleLongTermNotesPayable",
    "ConvertibleDebt",
    "ConvertibleDebtNoncurrent",
  ],
  /* finance-lease liability, the whole obligation first (MSFT
     66,594,000,000 at 2026-06-30, larger than its debt) */
  financeLeaseLiability: ["FinanceLeaseLiability", "FinanceLeaseLiabilityNoncurrent"],
  /* the right-of-use asset behind it (GOOG 5,474,000,000 at 2026-06-30) */
  financeLeaseAsset: ["FinanceLeaseRightOfUseAsset"],
  /* undiscounted finance-lease payments and the note's year buckets
     (MSFT 89,686,000,000 total; 7,121,000,000 in the next twelve months;
     55,490,000,000 after year five, at 2026-06-30) */
  financeLeaseDue: ["FinanceLeaseLiabilityPaymentsDue"],
  financeLeaseDueNextTwelveMonths: ["FinanceLeaseLiabilityPaymentsDueNextTwelveMonths"],
  financeLeaseDueYearTwo: ["FinanceLeaseLiabilityPaymentsDueYearTwo"],
  financeLeaseDueYearThree: ["FinanceLeaseLiabilityPaymentsDueYearThree"],
  financeLeaseDueYearFour: ["FinanceLeaseLiabilityPaymentsDueYearFour"],
  financeLeaseDueYearFive: ["FinanceLeaseLiabilityPaymentsDueYearFive"],
  financeLeaseDueAfterYearFive: ["FinanceLeaseLiabilityPaymentsDueAfterYearFive"],
  /* undiscounted operating-lease payments (MSFT 24,706,000,000 at
     2026-06-30; AMZN 116,350,000,000) */
  opLeaseDue: ["LesseeOperatingLeaseLiabilityPaymentsDue"],
  /* the debt maturity ladder as the note tags it. Year one is either the
     remainder of the fiscal year (a 10-Q: CRWV 4,413,000,000 at
     2026-06-30) or the next twelve months (MSFT 9,250,000,000; ORCL
     7,210,000,000 at 2026-05-31); "thereafter" is MSFT 34,385,000,000 */
  maturityRemainderOfFiscalYear: ["LongTermDebtMaturitiesRepaymentsOfPrincipalRemainderOfFiscalYear"],
  maturityNextTwelveMonths: ["LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths"],
  maturityYearTwo: ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo"],
  maturityYearThree: ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree"],
  maturityYearFour: ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour"],
  maturityYearFive: ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive"],
  maturityAfterYearFive: ["LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive"],
  /* purchase obligations and contractual commitments, read by END DATE
     whether tagged as an instant or a duration (END_DATED_BALANCE):
     Amazon's and Meta's commitment tables (AMZN 650,034,000,000; META
     349,310,000,000 at 2026-06-30), Alphabet's LongTermPurchaseCommitment
     Amount, which it files as a DURATION fact (232,700,000,000 for
     2026-01-01..2026-03-31; 707,000,000,000 for the half year to
     2026-06-30), and the plain PurchaseObligation tag Alphabet used until
     2025-12-31 (7,700,000,000). Where a period end carries more than one
     of these, the ladder rank decides, not the instant-over-duration
     rule. The unrecorded-obligation tag is NOT in this ladder: see
     unrecordedPurchaseObligations. */
  purchaseObligations: [
    "ContractualObligation",
    "LongTermPurchaseCommitmentAmount",
    "PurchaseObligation",
  ],
  /* the unrecorded-unconditional-purchase-obligation tag, served as its
     own line because what it MEANS differs by filer: Meta files the
     leases it has signed but not yet commenced under it (278,990,000,000
     at 2026-06-30, the figure its Note 9 calls leases not yet commenced),
     Alphabet files its own uncommenced leases there (75,600,000,000 at
     2026-03-31, R59 of the 10-Q filed 2026-04-30: 'Total undiscounted
     lease payments' under leases not yet commenced), and Oracle a
     genuine unconditional purchase obligation (13,309,000,000 at
     2026-05-31). Inside the purchaseObligations ladder it displaced
     Alphabet's 232,700,000,000 purchase commitment at 2026-03-31 with its
     uncommenced leases. LABEL_OVERRIDES carries the per-filer label; the
     tag each period resolved from travels with the period (tags). */
  unrecordedPurchaseObligations: ["UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount"],
  /* the commitment table's year buckets (AMZN at 2026-06-30: remainder
     42,752,000,000; next twelve months 78,084,000,000; META 53,520,000,000
     and 81,650,000,000) */
  contractualObligationRemainderOfFiscalYear: ["ContractualObligationFutureMinimumPaymentsDueRemainderOfFiscalYear"],
  contractualObligationNextTwelveMonths: ["ContractualObligationDueInNextTwelveMonths"],
  contractualObligationYearTwo: ["ContractualObligationDueInSecondYear"],
  contractualObligationYearThree: ["ContractualObligationDueInThirdYear"],
  contractualObligationYearFour: ["ContractualObligationDueInFourthYear"],
  contractualObligationYearFive: ["ContractualObligationDueInFifthYear"],
  contractualObligationAfterYearFive: ["ContractualObligationDueAfterFifthYear"],
  /* contracted lease receipts where the customer contract is a lease
     (APLD 35,844,882,000 at 2026-05-31; IREN 11,400,000,000 at
     2026-06-30) and their buckets (APLD 451,065,000 in the next twelve
     months; 27,107,897,000 thereafter) */
  lessorBacklog: ["LessorOperatingLeasePaymentsToBeReceived"],
  lessorBacklogNextTwelveMonths: ["LessorOperatingLeasePaymentsToBeReceivedNextTwelveMonths"],
  lessorBacklogYearTwo: ["LessorOperatingLeasePaymentsToBeReceivedTwoYears"],
  lessorBacklogYearThree: ["LessorOperatingLeasePaymentsToBeReceivedThreeYears"],
  lessorBacklogYearFour: ["LessorOperatingLeasePaymentsToBeReceivedFourYears"],
  lessorBacklogYearFive: ["LessorOperatingLeasePaymentsToBeReceivedFiveYears"],
  lessorBacklogThereafter: ["LessorOperatingLeasePaymentsToBeReceivedThereafter"],
  /* restricted cash, served as the FILER'S TOTAL, not first-tag-wins:
     the tags are components as often as totals, and a fixed order picked
     the wrong one for every filer it was checked against (non-current
     first served IREN 53,684,000 where its 10-K tags RestrictedCash
     1,723,900,000, and APLD 180,415,000 beside 2,381,027,000 of escrowed
     note proceeds under RestrictedCashCurrent). statements.mjs resolves
     this key per period end through RESTRICTED_CASH below; this flat
     list exists for the concept pull and the restatement reader. The
     escrow itself stays readable per tag (APLD RestrictedCashCurrent
     2,381,027,000 at 2026-05-31, 10-K 0001144879-26-000048). */
  restrictedCash: [
    "RestrictedCash",
    "RestrictedCashAndCashEquivalentsAtCarryingValue",
    "RestrictedCashAndCashEquivalentsNoncurrent",
    "RestrictedCashCurrent",
    "RestrictedCashNoncurrent",
  ],
  /* cash plus marketable securities as one figure where tagged (GOOG
     242,474,000,000 at 2026-06-30), else the securities alone (META
     74,798,000,000; MSFT ShortTermInvestments 55,908,000,000) */
  liquidity: [
    "CashCashEquivalentsAndShortTermInvestments",
    "MarketableSecuritiesCurrent",
    "ShortTermInvestments",
  ],
  /* partner capital in temporary equity (APLD 1,956,303,000 at
     2026-05-31, the Macquarie units) */
  redeemableNci: ["RedeemableNoncontrollingInterestEquityCarryingAmount"],
  /* partner capital in consolidated vehicles (GOOG 7,100,000,000 at
     2026-06-30) */
  nciVie: ["NoncontrollingInterestInVariableInterestEntity"],
  /* preferred stock at carrying value (ORCL 4,954,000,000 at
     2026-05-31, the Series D; DLR 731,690,000) */
  preferredStock: ["PreferredStockValue"],
  /* construction in progress (ORCL 39,973,000,000 at 2026-05-31) and the
     REIT equivalent, development in process (DLR 5,381,071,000) */
  constructionInProgress: ["ConstructionInProgressGross", "DevelopmentInProcess"],
  /* equity-method investments, where Meta's data-center ventures live
     (9,406,000,000 at 2026-06-30) */
  equityMethodInvestments: ["EquityMethodInvestments"],
  /* maximum exposure to loss on unconsolidated vehicles (CRWV
     1,800,000,000; META 6,410,000,000 at 2026-06-30) */
  vieMaxExposure: ["VariableInterestEntityEntityMaximumLossExposureAmount"],
  /* maximum exposure under guarantees given (GOOG 7,600,000,000 at
     2026-06-30) */
  guaranteeExposure: ["GuaranteeObligationsMaximumExposure"],
  /* fair value of the debt (MSFT 36,500,000,000 at 2026-06-30; IREN
     7,167,336,000 under the notes-payable disclosure) */
  debtFairValue: ["LongTermDebtFairValue", "NotesPayableFairValueDisclosure"],
  /* accrued interest (CRWV 410,000,000 at 2026-06-30) */
  interestPayable: ["InterestPayableCurrent"],
};

/* ---------- cash flow (duration) ---------- */
export const CASHFLOW = {
  cfOps: ["NetCashProvidedByUsedInOperatingActivities"],
  cfInv: ["NetCashProvidedByUsedInInvestingActivities"],
  cfFin: ["NetCashProvidedByUsedInFinancingActivities"],
  /* Microsoft, Alphabet and Oracle tag none of the three combined
     concepts and file Depreciation alone (MSFT 34,300,000,000 for the
     year to 2026-06-30; ORCL 7,623,000,000 to 2026-05-31; GOOG
     13,586,000,000 for the half year to 2026-06-30), which left their
     line null. Last, and filling only the periods the combined tags
     never reported (FILL_ONLY), because it is a different line.
     The fill is Depreciation ALONE, as the design specifies — a filled
     period's tags entry says "Depreciation", and a reader labels the
     ratio "capex to depreciation", not "to D&A", for these filers
     (design-hyperscalers.json refutation; blueprint 15.1 reads MSFT
     115,948 / 34,300 = 3.38 and 15.3 ORCL 98,816 / (20,606 + 7,623) =
     3.50x on this figure). A composite fill summing Depreciation with
     AmortizationOfIntangibleAssets was built and removed: it served
     MSFT 39,000,000,000 where every blueprint reading and the H1
     acceptance state 34,300,000,000. Where the filer tags amortization
     beside it (MSFT 4,700,000,000), the separate line is left for a
     later PR to serve under its own key. */
  depreciationAmortization: [
    "DepreciationDepletionAndAmortization",
    "DepreciationAndAmortization",
    "DepreciationAmortizationAndAccretionNet",
    "Depreciation",
  ],
  shareBasedComp: ["ShareBasedCompensation"],
  /* Equinix retagged its purchases as "other" PP&E in the second quarter
     of 2026 (2,834,000,000 for the half year); Digital Realty files
     development spend as PaymentsToDevelopRealEstateAssets (870,038,000
     for the quarter to 2026-03-31) and none of the other three. Both
     fill only the periods the first three never reported (FILL_ONLY). */
  capex: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PaymentsForCapitalImprovements",
    "PaymentsToAcquireOtherPropertyPlantAndEquipment",
    "PaymentsToDevelopRealEstateAssets",
  ],
  /* a filer's second capex line where the taxonomy has a tag for it:
     TeraWulf's PaymentsToAcquireOtherProductiveAssets (231,350,000 for
     the half year to 2026-06-30) sits beside its 1,378,514,000 of
     PaymentsToAcquirePropertyPlantAndEquipment and belongs in the same
     total. IREN's 'Payments for computer hardware' and Cipher's
     'Deposits on equipment' carry no us-gaap tag and are hand-keyed in
     frontend/data/capex-adjustments.json. */
  capexOther: ["PaymentsToAcquireOtherProductiveAssets"],
  /* Alphabet moved to PaymentsOfOrdinaryDividends in its second-quarter
     2026 10-Q (5,231,000,000 for the half year); fills only the periods
     the two older tags never reported (FILL_ONLY) */
  dividendsPaid: [
    "PaymentsOfDividendsCommonStock",
    "PaymentsOfDividends",
    "PaymentsOfOrdinaryDividends",
  ],
  buybacks: ["PaymentsForRepurchaseOfCommonStock"],

  /* ---- the build-out monitor: sources and uses of cash (blueprint
     section 15.2). Outflows are stored as the filer tags them, positive;
     a net tag keeps its sign. ---- */

  /* long-term debt raised, gross, under each filer's own name: AMZN
     13,557,000,000 for the quarter to 2026-06-30; ORCL 46,093,000,000 for
     the year to 2026-05-31; GOOG 56,226,000,000 for the half year; MSFT 0
     for fiscal 2026; APLD 4,955,327,000; WULF 3,132,938,000 for 2025 */
  debtIssued: [
    "ProceedsFromIssuanceOfLongTermDebt",
    "ProceedsFromIssuanceOfSeniorLongTermDebt",
    "ProceedsFromDebtNetOfIssuanceCosts",
    "ProceedsFromDebtMaturingInMoreThanThreeMonths",
    "ProceedsFromIssuanceOfMediumTermNotes",
    "ProceedsFromIssuanceOfSecuredDebt",
    "ProceedsFromIssuanceOfDebt",
  ],
  /* long-term debt repaid: AMZN 2,752,000,000 for the quarter to
     2026-06-30; GOOG 5,253,000,000; MSFT 3,000,000,000 for fiscal 2026;
     APLD 521,512,000; EQIX 700,000,000 of senior notes for the half year
     (its 682,000,000 of other debt is otherDebtRepaid); ORCL
     6,942,000,000; DLR 2,514,388,000 for 2025 (its revolver is
     shortTermDebtRepaid). Alternatives, resolved per period: Comcast
     tags one line under RepaymentsOfLongTermDebt and RepaymentsOfOtherDebt
     alike (4,015,000,000 for 2023), so a component tag cannot sit in
     this ladder and be summed without double counting. */
  debtRepaid: [
    "RepaymentsOfLongTermDebt",
    "RepaymentsOfDebtAndCapitalLeaseObligations",
    "RepaymentsOfDebt",
    "RepaymentsOfDebtMaturingInMoreThanThreeMonths",
    "RepaymentsOfMediumTermNotes",
    "RepaymentsOfSeniorDebt",
  ],
  /* the 'other debt' repayment line, its own key because Equinix files
     it BESIDE its senior-note repayments (682,000,000 and 700,000,000 for
     the half year to 2026-06-30; 674,000,000 of the other in the first
     quarter): inside debtRepaid the two resolved to different tags in
     different periods and the second quarter came out as 700 less 674.
     A reader adds this to debtRepaid for a filer that splits, and must
     not for one that tags the same line under both (Comcast, above). */
  otherDebtRepaid: ["RepaymentsOfOtherDebt"],
  /* commercial paper and revolver draws (AMZN 20,798,000,000 for the
     twelve months to 2026-06-30; DLR 293,734,000); Oracle's paper tag is
     NET of repayments and keeps its sign (-2,285,000,000 for fiscal 2026) */
  shortTermDebtProceeds: [
    "ProceedsFromShortTermDebt",
    "ProceedsFromLinesOfCredit",
    "ProceedsFromRepaymentsOfCommercialPaper",
  ],
  /* and their repayment (AMZN 20,634,000,000; WULF 100,075,000; DLR
     2,586,749,000 of revolver for 2025 and 477,207,000 for the quarter
     to 2026-03-31, mirroring its ProceedsFromLinesOfCredit above) */
  shortTermDebtRepaid: ["RepaymentsOfShortTermDebt", "RepaymentsOfLinesOfCredit"],
  /* convertible notes issued (IREN 6,299,555,000 for the year to
     2026-06-30; CIFR 1,437,395,000 for the nine months to 2025-09-30) */
  convertsIssued: ["ProceedsFromConvertibleDebt"],
  /* and repaid (IREN 1,623,484,000 for the nine months to 2026-03-31) */
  convertsRepaid: ["RepaymentsOfConvertibleDebt"],
  /* principal paid on finance leases (MSFT 3,101,000,000 for fiscal 2026) */
  financeLeasePrincipal: ["FinanceLeasePrincipalPayments"],
  /* capex financed by a new finance lease, which never passes through the
     cash-flow statement (MSFT 24,608,000,000 for fiscal 2026). A
     supplemental note disclosure some filers tag annually only (META
     613,000,000 for 2025, no 10-Q rows since 2023), so it is kept out
     of ABSENT_IS_ZERO below. */
  financeLeaseAdditions: ["RightOfUseAssetObtainedInExchangeForFinanceLeaseLiability"],
  /* common stock sold (GOOG 30,499,000,000 for the half year to
     2026-06-30) and CoreWeave's private placements (2,982,000,000) */
  equityIssued: ["ProceedsFromIssuanceOfCommonStock", "ProceedsFromIssuanceOfPrivatePlacement"],
  /* the IPO itself, its own key: CoreWeave's 10-K files 1,491,000,000
     for 2025 here and 0 under ProceedsFromIssuanceOfCommonStock, after
     its 10-Qs had carried 67,669,000 of common-stock proceeds for the
     nine months, so inside equityIssued the year resolved to 0 and the
     fourth quarter to -67,669,000. Not summed into equityIssued by the
     resolver: Meta (2012) and Tesla (2013) tag the same offering under
     both, so a reader adds the two keys only for a filer that splits. */
  ipoProceeds: ["ProceedsFromIssuanceInitialPublicOffering"],
  /* preferred sold: Alphabet's and Oracle's mandatory convertibles
     (19,063,000,000 and 4,954,000,000), Applied Digital's preferred
     (814,998,000 for the year to 2026-05-31). Not
     ProceedsFromIssuanceOfRedeemablePreferredStock: Digital Realty files
     731,690,000 under it for each of 2023, 2024 and 2025, the carrying
     value of its preferred (PreferredStockValue 731,690,000 at every
     instant from 2023-12-31), and its cash-flow statement carries no
     preferred-proceeds line (10-K 0001104659-26-015365, R8). */
  preferredIssued: [
    "ProceedsFromIssuanceOfConvertiblePreferredStock",
    "ProceedsFromIssuanceOfPreferredStockAndPreferenceStock",
  ],
  /* warrants exercised (APLD 4,451,000; WULF 7,038,000) */
  warrantsIssued: ["ProceedsFromIssuanceOfWarrants"],
  /* cash from partners in consolidated ventures (GOOG 3,758,000,000 for
     the half year to 2026-06-30; APLD 1,825,000,000 for fiscal 2026);
     the equity-statement tag is the same event where a filer omits the
     cash line */
  jvPartnerFunding: [
    "ProceedsFromMinorityShareholders",
    "NoncontrollingInterestIncreaseFromSaleOfParentEquityInterest",
  ],
  /* cash put into unconsolidated ventures (CRWV 550,000,000 for the half
     year to 2026-06-30; EQIX 264,000,000) */
  jvInvestment: ["PaymentsToAcquireInterestInJointVenture", "PaymentsToAcquireEquityMethodInvestments"],
  /* cash interest (ORCL 3,896,000,000 for fiscal 2026; CRWV 806,000,000;
     APLD 263,402,000; MSFT files InterestPaid, 1,500,000,000) */
  interestPaid: ["InterestPaidNet", "InterestPaid"],
  /* interest capitalized into construction (GOOG 628,000,000 for the half
     year to 2026-06-30; CRWV 176,000,000; APLD files the adjustment tag,
     39,574,000 for fiscal 2026) */
  interestCapitalized: ["InterestCostsCapitalized", "InterestCostsCapitalizedAdjustment"],
  /* capex incurred but unpaid at period end, the non-cash bridge from
     spend to the cash line (ORCL 5,279,000,000 at 2026-05-31; META
     19,502,000,000; CRWV 9,796,000,000 at 2026-06-30). A balance in a
     duration's clothing: see REPORTED_AS_BALANCE. */
  capexAccrued: ["CapitalExpendituresIncurredButNotYetPaid"],
};

/* Alternates that may only FILL periods the tags ahead of them never
   reported, in any filing. statements.mjs resolves a period per filing
   and then lets the latest filing win, so an alternate that a later 10-K
   restates a comparative under would otherwise displace the original
   tag's figure: Accenture's fiscal 2023 D&A of 1,412,073,000
   (DepreciationDepletionAndAmortization, in its FY2023 10-K) became
   620,659,000 (Depreciation, the FY2025 10-K's comparative) when the tag
   was simply appended, and Equinix's 2023 debt fell from 13,840,646,000
   to 663,000,000. Checked across every covered company on 2026-09-11:
   with this rule the widening fills nulls and changes no figure that was
   already served. */
export const FILL_ONLY = {
  interestExpense: ["InterestExpenseDebt", "InterestExpenseDebtExcludingAmortization"],
  ppe: ["PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"],
  shortTermDebt: ["NotesPayableCurrent"],
  longTermDebt: ["LongTermNotesPayable", "SeniorLongTermNotes", "LongTermNotesAndLoans", "SeniorNotes"],
  depreciationAmortization: ["Depreciation"],
  capex: ["PaymentsToAcquireOtherPropertyPlantAndEquipment", "PaymentsToDevelopRealEstateAssets"],
  dividendsPaid: ["PaymentsOfOrdinaryDividends"],
};

/* Fill-tier COMPOSITES: where the tags ahead of them reported nothing for
   a period end, the sum of these parts would fill it, and only where
   every part is tagged for that end; a single fill tag (FILL_ONLY) is
   tried after. A sum carries the tag "A+B" so a reader can see it is two
   lines, and the same-tag rule below keeps it out of arithmetic with
   either part alone. EMPTY on purpose: the depreciationAmortization
   composite ("Depreciation" + "AmortizationOfIntangibleAssets") that
   introduced this tier served MSFT 39,000,000,000 where the blueprint's
   readings and the H1 acceptance pin Depreciation alone, 34,300,000,000,
   so it was removed (see the depreciationAmortization comment above).
   The mechanism stays: statements.mjs already resolves it, and a later
   PR that needs a two-line fill adds only an entry here. */
export const FILL_COMPOSITES = {};

/* Sum-first balances: where a filer tags BOTH parts of a balance at a
   period end, their sum is the balance, ahead of any single tag in the
   ladder. Applied Digital tags RestrictedCash 10,500,000 at 2026-05-31
   beside RestrictedCashCurrent 2,381,027,000 (the escrowed note
   proceeds) and RestrictedCashNoncurrent 180,415,000, so the whole-balance
   tag is a component here and the total, 2,561,442,000, is the sum; IREN
   tags RestrictedCash 1,723,900,000 alone and keeps it. The tag entry
   reads "A+B" so a reader sees two lines were added. */
export const SUM_FIRST = {
  restrictedCash: [
    { parts: ["RestrictedCashCurrent", "RestrictedCashNoncurrent"] },
    /* Meta tags the cash-flow-statement figure, 702,000,000 at 2026-06-30,
       beside a non-current escrow of 13,107,000,000: a total cannot be
       smaller than one of its parts, so where the carrying-value tag is
       below the non-current tag it is the current part and the two are
       added; where it is not (CoreWeave 873,000,000 against 507,000,000)
       it may already include the non-current part and stands alone. */
    { parts: ["RestrictedCashAndCashEquivalentsAtCarryingValue", "RestrictedCashAndCashEquivalentsNoncurrent"], onlyIfFirstBelowSecond: true },
  ],
};

/* The same-tag rule. A fourth quarter derived as the year less three
   quarters, a quarter recovered from a year-to-date span, and a trailing
   year summed from four quarters are arithmetic across PERIODS, and each
   period resolves its own tag. The arithmetic is only valid when every
   input came from the same tag: Merck's 2020 year, filled from
   Depreciation, less three quarters of the combined concept gave a
   fourth-quarter D&A of -1,052,000,000, and Walmart's fiscal 2025
   interest, one quarter under InterestIncomeExpenseNet and two under
   InterestExpenseDebt, flipped sign inside the year. statements.mjs
   serves null instead whenever the inputs' tags differ.

   The keys below are the exception, for continuity only: their ladders
   are lists of ALTERNATIVE totals that predate the rule, and the site
   already served arithmetic across them (a 10-K's InterestExpense less
   three 10-Qs of InterestExpenseNonoperating). For these the rule bites
   only when a fill-tier tag (FILL_ONLY, FILL_COMPOSITES) is one of the
   inputs, so nothing the site served before the fill tiers existed
   changes. Tightening them is a separate decision, because it would
   move served figures. */
export const MIXABLE = new Set([
  "revenue", "cogs", "sellingGeneralAdmin", "operatingExpenses", "interestExpense",
  "pretaxIncome", "netIncomeIncludingNci", "depreciationAmortization", "capex", "dividendsPaid",
]);

/* Fill tags that are the SAME line under a new name, so the same-tag rule
   treats them as primaries of a MIXABLE key: Equinix moved its whole
   capex line to PaymentsToAcquireOtherPropertyPlantAndEquipment in the
   second quarter of 2026 (2,834,000,000 for the half year, after
   1,256,000,000 under PaymentsToAcquireProductiveAssets for the first
   quarter), and Alphabet its dividends to PaymentsOfOrdinaryDividends
   (5,231,000,000 for the half year after 2,542,000,000 under
   PaymentsOfDividends), so the half year less the first quarter IS the
   second quarter. Depreciation, the D&A composite and InterestExpenseDebt
   are not here: they are different lines from the tags ahead of them. */
export const FILL_CONTINUES = {
  capex: ["PaymentsToAcquireOtherPropertyPlantAndEquipment", "PaymentsToDevelopRealEstateAssets"],
  dividendsPaid: ["PaymentsOfOrdinaryDividends"],
};

/* Financing lines a filer prints only in the quarters they happen. A
   10-Q's cash-flow statement is year to date, so a line absent from a
   filed quarter's statement is zero for that quarter, not unknown:
   Alphabet's 30,499,000,000 of common stock sold in the half year to
   2026-06-30 has no first-quarter row because nothing was sold in the
   first quarter, and Meta's 29,906,000,000 of 2025 debt was raised in
   the fourth quarter, so no 10-Q of 2025 carries the tag. For these
   keys statements.mjs takes a null quarter as zero when the quarter's
   period is on file (its anchors were reported), records it in
   inferredZero, and so recovers the quarter, the fourth quarter and the
   trailing year. Not applied to the operating lines (capex, dividends,
   D&A, interest): a null there is as likely a tag the ladder lacks as a
   line the filer omitted, and those keys have served values to keep.
   financeLeaseAdditions is NOT here: it is a supplemental lease-note
   disclosure, not a cash-flow-statement line, and filers move it to
   annual-only without the line being zero in the quarters. Meta tags
   RightOfUseAssetObtainedInExchangeForFinanceLeaseLiability in 10-Qs
   only through 2023-09-30 and FY-only after (588,000,000 for 2023;
   181,000,000 for 2024; 613,000,000 for 2025 — blueprint 15.2 calls the
   figure "annual only"), and the zero inference attributed the whole
   613,000,000 to a derived fourth quarter with Q1-Q3 taken as zero,
   when 2023's real quarters (70 / 268 / 122 million) were not zero. A
   quarter this note does not cover serves null. */
export const ABSENT_IS_ZERO = new Set([
  "debtIssued", "debtRepaid", "otherDebtRepaid", "shortTermDebtProceeds", "shortTermDebtRepaid",
  "convertsIssued", "convertsRepaid", "financeLeasePrincipal",
  "equityIssued", "ipoProceeds", "preferredIssued", "warrantsIssued", "jvPartnerFunding",
  "jvInvestment", "interestCapitalized", "capexOther",
]);

/* Proceeds and payments that cannot be negative. A derived figure below
   zero for one of these is a restatement between filings, not a flow:
   CoreWeave's 10-K moved its 2025 common-stock proceeds into the IPO tag
   after the 10-Qs had carried 67,669,000, so year less nine months was
   -67,669,000. statements.mjs serves null and names the field in
   notDerivable. The net tags keep their sign (Oracle's commercial paper
   is -2,285,000,000 for fiscal 2026), so shortTermDebtProceeds is not
   here. */
export const NEVER_NEGATIVE = new Set([
  "debtIssued", "debtRepaid", "otherDebtRepaid", "shortTermDebtRepaid", "convertsIssued",
  "convertsRepaid", "financeLeasePrincipal", "financeLeaseAdditions", "equityIssued",
  "ipoProceeds", "preferredIssued", "warrantsIssued", "jvPartnerFunding", "jvInvestment",
  "interestPaid", "interestCapitalized", "capexOther",
]);

/* A tagged ZERO under a higher-ranked tag yields to a non-zero row of a
   lower-ranked tag for the same span and filing. TeraWulf's 2024 10-K
   tags ProceedsFromIssuanceOfLongTermDebt 0 and ProceedsFromIssuanceOfDebt
   487,050,000 for the same year, so first-tag-wins served debtIssued 0
   and convertsIssued 0 for a year the filer raised 487,050,000. Scoped to
   the financing keys (the absent-is-zero and never-negative sets), so no
   operating figure the site already served can move. */
export const ZERO_YIELDS = new Set([...ABSENT_IS_ZERO, ...NEVER_NEGATIVE]);

/* Financing keys whose ladders are ALTERNATIVE NAMES for one line, where
   a filer can tag a zero under one name and the real flow under another
   in the same filing. TeraWulf's 2024 10-K (0001083301-25-000018) tags
   ProceedsFromIssuanceOfSecuredDebt 0 for 2024 beside
   ProceedsFromIssuanceOfDebt 487,050,000 — the October 2024 convertible
   notes — and first-tag-wins kept the zero, so debtIssued served 0 for a
   year the filer raised $487 million. For these keys statements.mjs
   treats a tagged zero as absent when another tag of the ladder carries
   a non-zero value for the same span: within one filing the non-zero row
   takes the period, and a comparative that restates only the zero-tagged
   line cannot bury the original figure. Scoped to the gross financing
   lines (all of them new with the build-out monitor, so no figure the
   site served before this PR moves); the net-signed keys are not here —
   Oracle's commercial paper line is legitimately zero or negative beside
   other proceeds. */
export const PREFER_NONZERO = new Set([
  "debtIssued", "debtRepaid", "otherDebtRepaid", "shortTermDebtRepaid", "convertsIssued",
  "convertsRepaid", "financeLeasePrincipal", "equityIssued", "ipoProceeds",
  "preferredIssued", "warrantsIssued", "jvPartnerFunding", "jvInvestment",
  "interestPaid", "interestCapitalized",
]);

/* How restrictedCash resolves per period end (statements.mjs
   restrictedCashSeries). The restricted-cash tags mix totals and
   components: RestrictedCash is IREN's whole balance (1,723,900,000 at
   2026-06-30, 10-K 0001878848-26-000052) but a minor sub-line for
   Applied Digital (10,500,000 at 2026-05-31 beside 2,381,027,000 of
   current and 180,415,000 of non-current restricted cash, 10-K
   0001144879-26-000048), and RestrictedCashAndCashEquivalentsAtCarrying
   Value is the current portion wherever the Noncurrent variant sits
   beside it (META 702,000,000 + 13,107,000,000; CRWV 873,000,000 +
   507,000,000 at 2026-06-30). So: sum a current/non-current PAIR where
   both are tagged at the end date; take the filer's own single total
   where it stands (equal to or above 99% of the pair sum — IREN's
   1,723,900,000 sits 36,000 under its parts' sum, filer rounding);
   otherwise the larger, because a component can never exceed the total
   it belongs to. A lone component is served only when nothing better
   exists at that date. */
export const RESTRICTED_CASH = {
  whole: ["RestrictedCash"],
  pairs: [
    ["RestrictedCashAndCashEquivalentsAtCarryingValue", "RestrictedCashAndCashEquivalentsNoncurrent"],
    ["RestrictedCashCurrent", "RestrictedCashNoncurrent"],
  ],
  fallback: [
    "RestrictedCashAndCashEquivalentsAtCarryingValue",
    "RestrictedCashAndCashEquivalentsNoncurrent",
    "RestrictedCashCurrent",
    "RestrictedCashNoncurrent",
  ],
};

/* Balance-sheet keys read by END DATE whether the fact is an instant or a
   duration. Alphabet files LongTermPurchaseCommitmentAmount over the
   period (2026-01-01..2026-06-30), so an instant-only reader never sees it. */
export const END_DATED_BALANCE = new Set(["purchaseObligations"]);

/* Duration-tagged items whose year-to-date column restates a PERIOD-END
   BALANCE rather than accumulating a flow. CapitalExpenditures
   IncurredButNotYetPaid is a supplemental cash-flow disclosure, so the
   taxonomy makes it a duration, but the figure is what sits unpaid at
   the period end (ORCL 5,279,000,000 at 2026-05-31; 6,247,000,000 at
   2026-08-31). statements.mjs neither de-cumulates these across quarters
   nor sums them over four for the trailing year: a quarter takes the
   column's own figure and the trailing year takes the latest quarter's. */
export const REPORTED_AS_BALANCE = new Set(["capexAccrued"]);

/* What a tag MEANS for a particular filer, where it departs from the
   concept's label. Keyed by key, then CIK, then tag. Meta and Alphabet
   file the leases they have signed but not yet commenced under the
   unrecorded-purchase-obligation tag (META 278,990,000,000 at
   2026-06-30, the figure its Note 9 calls leases not yet commenced; GOOG
   75,600,000,000 at 2026-03-31), so a card that read the tag's own name
   would call $279 billion of leases a purchase obligation. Every period
   statements.mjs builds carries the tag each line resolved from
   (period.tags["balanceSheet.unrecordedPurchaseObligations"]), which is
   what labelFor takes. */
export const LABEL_OVERRIDES = {
  unrecordedPurchaseObligations: {
    1326801: { UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount: "Leases not yet commenced" },
    1652044: { UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount: "Leases not yet commenced" },
  },
};

/** The label to show for `tag` resolved under `key` for the filer `cik`,
    or null where the concept's own label applies. */
export function labelFor(key, tag, cik) {
  const byCik = LABEL_OVERRIDES[key];
  const byTag = byCik && byCik[Number(cik)];
  return (byTag && byTag[tag]) || null;
}

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
  ...Object.values(FILL_COMPOSITES).flat(2),
  ...Object.values(BALANCE).flat(),
  ...Object.values(CASHFLOW).flat(),
  ...Object.values(PERSHARE).flat(),
  ...Object.values(SHARE_COUNTS).flat(),
])];

/* Which map a line item belongs to decides how it is aggregated: duration
   items are de-cumulated from YTD, instant items are read straight. */
export const DURATION_GROUPS = { INCOME, CASHFLOW };
export const INSTANT_GROUPS = { BALANCE };
