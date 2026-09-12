/**
 * bdc-concepts.mjs — the XBRL concepts a business development company
 * tags, and the quarterly series built from them.
 *
 * A BDC is an investment company. It tags no revenue, no cost of sales
 * and no operating income, so nothing in concepts.mjs or statements.mjs
 * finds a period for it. What it does tag is its portfolio at cost and
 * fair value, net asset value per share, net investment income and the
 * fee and leverage lines of the 1940 Act. Those live here, one ordered
 * tag ladder per metric, and buildBdcSeries turns a filer's whole
 * companyfacts feed into quarters labelled by calendar period end.
 *
 * Three rules from the plan that differ from the operating-company path:
 *   - the fiscal year end is an INPUT (fyEndMonth from the submissions
 *     JSON), never inferred from revenue, because there is no revenue;
 *   - a fourth fiscal quarter is the 10-K annual less that filer's own
 *     three quarters, keyed on net investment income, never on
 *     NetIncomeLoss, which carries the marks;
 *   - a fact tagged year to date is differenced against the prior YTD in
 *     the same fiscal year when it is additive (dollars, per share), and
 *     kept as YTD when it is a ratio, which cannot be differenced.
 *
 * Labels: a three-month fact and a differenced quarter are both "3M" (the
 * differenced one says derived: "ytd-differenced" and keeps its basis);
 * a fourth quarter taken as the annual less the nine months is
 * "derivedQ4"; "YTD" is reserved for a ratio or a share count kept year
 * to date. Differencing pairs rows from the original filings of the
 * fiscal year, never a later comparative against an earlier original:
 * Prospect's fiscal-2026 10-K restates fiscal-2025 distributions to
 * 300,745,000 while its fiscal-2025 filings said 360,488,000 and
 * 272,567,000 for the nine months, and the mixed pair gave a fourth
 * quarter of 28,178,000 against three quarters near 90,000,000.
 *
 * Checks a value passes before it is served (each leaves a flag):
 *   - net investment income: the ladder step over weighted basic shares
 *     must equal the tagged NII per share within a cent (blueprint 4.2).
 *     Where the latest-filed row fails and the period's own filing
 *     reconciles, the period's own filing answers: Oxford Square's 2024
 *     comparatives swap NetInvestmentIncome and InvestmentIncomeNet, so
 *     the latest row for 2023-03-31 says 12,941,798 where the 10-Q of
 *     that quarter said 6,490,784 (0.13 over 49,858,366 shares). A step
 *     the check rejects in two or more quarters is skipped for the
 *     filer in every quarter (the file says so under niiLadder); one
 *     quarter's arithmetic never switches the step, because a later
 *     step can reconcile by coincidence (SuRo's InvestmentIncomeNet at
 *     2023-12-31 against a per-share tag that is not NII per share) or
 *     to a per-share fact left on the old presentation (Main Street's
 *     and MSC Income's 2024 first quarters, 1.05 and the pre-tax line,
 *     after the 2025 10-Qs restated the dollars to after tax), and both
 *     would put the wrong line in one quarter of a series. Hercules
 *     tags a tax line inside operating
 *     expenses, so its NetInvestmentIncome is already after tax
 *     (92,915,000 over 185,517,000 shares is 0.50, the tagged figure;
 *     less the 2,790,000 tax line it is 0.49) and Trinity's
 *     NetInvestmentIncome is its net increase in net assets (-9,065,000
 *     at 2022-03-31 against InvestmentIncomeNet 15,609,000 and 0.57 per
 *     share);
 *   - NII per share: a figure the check rejected is not served as NII
 *     per share where it is a difference of two rows (Main Street's
 *     2024 first half restated to the after-tax presentation, 1.99, less
 *     a first quarter never restated, 1.05, gives 0.94 against
 *     83,899,000 over 86,194,092 shares, 0.97) or the filer's per-share
 *     tag is off by a large gap in two or more quarters (SuRo's is its
 *     change in net assets per share): NII over weighted basic shares is
 *     served in its place, labelled derived, with the tagged figure
 *     recorded beside it and a flag under niiPerShare. A filer-reported
 *     three-month fact a cent or two off is the filer's figure and is
 *     kept, the implied figure recorded beside it. A filer with
 *     preferred stock reports the figure before the preferred dividend
 *     (PSEC) or per common share after it (CGBD): both are tried;
 *   - a derived fourth quarter has no share count of its own, so NII
 *     over the estimated count (fourthQuarterShares) must be within a
 *     quarter of the derived per-share figure, on either row pair
 *     (Horizon's nine months to 2022-09-30 were first tagged as -0.40
 *     per share, so the year's 1.46 less that is 1.86, and less the
 *     restated 1.06 is the 0.40 that reconciles; MSC Income's nine
 *     months of 2024 were tagged pre-split). Where neither pair
 *     reconciles the fiscal year's other quarters judge: the dollars
 *     outside a quarter to four times their median are emptied (Oxford
 *     Square's 2023 10-K carries the swapped 51,824,181 for the year),
 *     the dollars inside it are kept and NII over the estimated count
 *     takes the per-share figure's place;
 *   - an annual less quarters is taken only over quarters the same
 *     ladder step answered (Main Street's after-tax year for 2023 has
 *     no after-tax quarters, and NetInvestmentIncome's year less its
 *     own nine months answers instead);
 *   - share counts: a count a hundred times (or a hundredth of) net
 *     assets over NAV per share is a filer's scale error and is emptied
 *     (Nuveen Churchill tags 22,212,400,000 weighted shares at
 *     2022-06-30 against 22,691,144 outstanding); shares outstanding at
 *     the same date as the anchor are held to a factor of five, which
 *     admits rows on either side of a reverse split and catches a tenth
 *     (Chicago Atlantic's 621,494 at 2024-06-30 against 6,213,722). A
 *     per-share check that fails by a factor of a hundred with no anchor
 *     to judge by is charged to the share count, not the NII;
 *   - debt: between half of Liabilities and Liabilities (blueprint 4.2),
 *     the next ladder step tried before the quarter is emptied: Sixth
 *     Street's DebtInstrumentCarryingAmount is carried at principal
 *     above its liabilities and LongTermDebt, the carrying amount, is
 *     inside the bound. A tag below 85% of Liabilities with a
 *     dimensionless LineOfCredit beside it carries the notes alone
 *     (Gladstone Capital, Barings): the facility is added, the value
 *     labelled notes plus facility and the quarter flagged;
 *   - portfolio: fair value between half of Assets and Assets (Oxford
 *     Square tags a member's 15,409,950 against assets of 290,605,053),
 *     cost at least half of fair value and half of Assets (Equus tags
 *     1,418,000 of cost against 17,276,000 of fair value, and a zero the
 *     year before; Oxford Square's 23,834,191 sits beside the member
 *     above). Cost has no upper bound: a written-down portfolio carries
 *     its cost (Firsthand's 89,862,162 against 148,635 of fair value at
 *     2026-06-30) and that is an impairment, not a tag error;
 *   - interest expense: annualised over debt between 1% and 20%, the
 *     next ladder step tried (Saratoga's InterestExpense is a note-level
 *     800,000 where InterestAndDebtExpense is 12,451,865);
 *   - instants: a NAV per share at or below zero is emptied (FRBP tags
 *     -4120.15 at 2020-12-31) and an asset coverage above 20 is a
 *     percentage divided by 100 (FRBP's 197 at 2023-12-31);
 *   - a differenced or derived flow that should be positive
 *     (distributions, management fee, interest, total income and
 *     expenses) is emptied below zero, or at zero for a filer that pays
 *     it in other quarters; a distribution is also emptied outside a
 *     band of the other quarters of its fiscal year;
 *   - distributions per share: a figure below a quarter of the
 *     quarter's NII per share or 0.25% of NAV, for a filer that pays in
 *     other quarters, is a component (Sixth Street's 10-Qs tag the
 *     supplemental alone), as is a difference taken from such a row;
 *     a derived fourth quarter more than a quarter from the dollars
 *     declared over shares tries the other row pair, then yields to
 *     the dollars; the dollars are net of a tagged preferred dividend
 *     (Prospect's include 26,702,000 of it in a 92,123,000 quarter).
 *
 * Probe of EDGAR companyfacts, 2026-09-11 (tag, unit, value seen at the
 * latest 10-Q/10-K period; "3M" is a three-month fact, "YTD" a
 * year-to-date one, "FY" the fiscal-year fact of a 10-K, "I" an instant):
 *
 *   InvestmentOwnedAtFairValue              USD I    ARCC 29,349,300,000 · BXSL 13,364,295,000 · MAIN 5,746,044,000 · PSEC 6,342,558,000 · TRIN 2,732,301,000 (all 2026-06-30)
 *   InvestmentOwnedAtCost                   USD I    ARCC 29,674,600,000 · BXSL 13,856,590,000 · MAIN 4,974,649,000 · PSEC 6,315,369,000 · TRIN 2,718,220,000
 *   NetAssetValuePerShare                   USD/shares I  ARCC 19.35 · BXSL 25.53 · MAIN 33.92 · PSEC 5.71 · TRIN 13.47
 *   InvestmentIncomeOperatingAfterExpenseAndTax  USD  ARCC 359,000,000 3M · BXSL 173,785,000 3M · MAIN 90,324,000 3M · PSEC 326,387,000 FY (Jul 2025–Jun 2026) · TRIN not tagged
 *   NetInvestmentIncome                     USD      ARCC 367,000,000 3M · BXSL 178,201,000 3M · MAIN 93,797,000 3M · PSEC 326,387,000 FY · TRIN last 2024-12-31 FY
 *   InvestmentIncomeOperatingTaxExpenseBenefit   USD  ARCC 8,000,000 3M · BXSL 4,416,000 3M · MAIN 3,473,000 3M · PSEC, TRIN not tagged
 *   InvestmentIncomeNet                     USD      TRIN 45,989,000 3M (the only one of the five to use it)
 *   InvestmentCompanyInvestmentIncomeLossPerShare USD/shares  ARCC 1.05 YTD (Q1 0.55) · BXSL 0.75 3M · MAIN 1.90 YTD · PSEC 0.68 FY · TRIN 1.04 YTD
 *   InvestmentCompanyDistributionToShareholdersPerShare USD/shares  ARCC 0.96 YTD (Q1 0.48) · BXSL 1.54 YTD · MAIN 2.16 YTD · TRIN 1.02 YTD · MSDL 0.45 3M · PSEC not tagged
 *   CommonStockDividendsPerShareDeclared    USD/shares  ARCC 0.48 3M · BXSL 0.77 3M · PSEC 0.06 (2024-09-30, stale) · TRIN 12.27 YTD (not a dividend) · MAIN not tagged
 *   InvestmentCompanyDividendDistribution   USD      ARCC 345,000,000 3M · BXSL 179,142,000 3M · PSEC 346,170,000 FY · MAIN 30,449,000 (2025-12-31 FY) · TRIN 112,100,000 (2024-12-31 FY)
 *   InvestmentCompanyTotalReturn            pure     ARCC 0.0189 YTD · BXSL 0.012 YTD · MAIN 0.0657 YTD · PSEC 0.0697 FY · TRIN 0.08 YTD
 *   StockholdersEquity                      USD I    ARCC 13,891,000,000 · BXSL 5,938,733,000 · MAIN 3,166,538,000 · PSEC 2,928,846,000 · TRIN 1,266,849,000
 *   AssetsNet                               USD I    PSEC 2,928,846,000 · TRIN 1,166,255,000 (2026-03-31) · others not tagged
 *   DebtInstrumentCarryingAmount            USD I    ARCC 15,924,000,000 · BXSL 7,613,729,000 · MAIN 2,541,000,000 · PSEC 1,878,595,000 · TRIN not tagged
 *   LongTermDebt                            USD I    ARCC 15,773,000,000 · BXSL 7,536,067,000 · MAIN 2,533,853,000 · PSEC 1,860,649,000 · TRIN 1,514,000,000
 *   DebtLongtermAndShorttermCombinedAmount, LinesOfCreditCurrent  not tagged by any of the five
 *   LineOfCredit                            USD I    PSEC 562,328,000 — one facility, never total debt
 *   Liabilities                             USD I    ARCC 16,607,000,000 · BXSL 7,849,935,000 · MAIN 2,774,503,000 · PSEC 1,945,331,000 · TRIN 1,538,523,000
 *   CashAndCashEquivalentsAtCarryingValue   USD I    ARCC 383,000,000 · BXSL 267,155,000 · MAIN 58,306,000 · PSEC 43,572,000 · TRIN 22,177,000
 *   InvestmentCompanySeniorSecurityIndebtednessAssetCoverageRatio  pure I  ARCC 1.86 · BXSL 1.78 · PSEC 3.394 · MAIN, TRIN not tagged
 *   WeightedAverageNumberOfSharesOutstandingBasic  shares  ARCC 718,000,000 3M · BXSL 232,557,932 3M · MAIN 93,253,619 3M · PSEC 479,866,265 FY · TRIN 90,464,413 3M
 *   CommonStockSharesOutstanding            shares I ARCC 718,000,000 · BXSL 232,652,003 · MAIN 93,354,166 · PSEC 512,746,556 · TRIN 94,023,371
 *   dei:EntityCommonStockSharesOutstanding  shares I ARCC 718,022,845 at 2026-07-23 (cover date, after period end)
 *   ManagementFeeExpense                    USD      ARCC 110,000,000 3M · BXSL 35,282,000 3M · PSEC 130,934,000 FY · MAIN, TRIN not tagged (internally managed)
 *   IncentiveFeeExpenseIncomeBased          USD      ARCC 84,000,000 3M · BXSL 1,690,000 3M · MSDL 6,518,000 3M
 *   IncentiveFeeExpense                     USD      PSEC 26,508,000 FY (unsplit)
 *   IncentiveFeeExpenseCapitalGainBased     USD      BXSL 0 3M · PSEC 0 FY · ARCC not tagged (its −21M is a statement line)
 *   InvestmentCompanyExpenseRatioIncludingIncentiveFee  pure  ARCC 0.1089 YTD · TRIN 0.149 YTD
 *   InvestmentCompanyExpenseRatioBeforeIncentiveAllocation  pure  PSEC 0.1055 FY
 *   InvestmentCompanyExpenseRatio, ...ExcludingIncentiveFee  not tagged by any of the five
 *   DebtWeightedAverageInterestRate         pure I   ARCC 0.049 (2025-12-31) · BXSL 0.0523 (2024-03-31, stale) · others not tagged
 *   InterestIncomeOperatingPaidInKind       USD      ARCC 110,000,000 YTD (Q1 52,000,000) · PSEC 66,092,000 FY · BXSL last 2023-06-30
 *   DividendIncomeOperatingPaidInKind       USD      ARCC 127,000,000 YTD · others not tagged
 *   InterestAndDividendIncomeOperatingPaidInKind  USD  MSDL 11,338,000 YTD (probed for this one tag)
 *   PaidInKindInterest                      USD      ARCC 70,000,000 YTD — the cash-flow adjustment, not income
 *   GrossInvestmentIncomeOperating          USD      ARCC 768,000,000 3M · BXSL 320,469,000 3M · MAIN 149,572,000 3M · PSEC 639,454,000 FY
 *   InterestAndDividendIncomeOperating      USD      TRIN 79,602,000 3M (its total investment income)
 *   InvestmentIncomeInvestmentExpense       USD      ARCC 401,000,000 3M · BXSL 142,268,000 3M · MAIN 55,775,000 3M · PSEC 330,192,000 FY (total expenses)
 *   OperatingExpenses                       USD      TRIN 40,542,000 3M
 *   InterestExpense                         USD      ARCC 214,000,000 3M · BXSL 101,070,000 3M
 *   InterestExpenseOperating                USD      MAIN 36,637,000 3M · PSEC 129,885,000 FY
 *   InterestExpenseDebt                     USD      MAIN 36,637,000 3M
 *   InterestAndDebtExpense                  USD      TRIN 24,774,000 3M
 *   RealizedInvestmentGainsLosses           USD      TRIN −774,000 3M · MSDL −7,407,000 3M
 *   DebtAndEquitySecuritiesRealizedGainLoss USD      MAIN 32,828,000 3M · BXSL −40,286,000 YTD · PSEC −223,719,000 FY
 *   RealizedGainLossInvestmentDerivativeAndForeignCurrencyTransactionPriceChangeOperatingAfterTax  USD  ARCC −5,000,000 3M · BXSL −27,797,000 3M
 *   UnrealizedGainLossOnInvestments         USD      TRIN −810,000 3M
 *   DebtAndEquitySecuritiesUnrealizedGainLoss  USD   MAIN 32,220,000 3M · BXSL −290,994,000 YTD · PSEC 47,174,000 FY
 *   UnrealizedGainLossInvestmentDerivativeAndForeignCurrencyTransactionPriceChangeOperatingAfterTax  USD  ARCC −183,000,000 3M · BXSL −136,502,000 3M
 *   NetIncomeLoss                           USD      ARCC 171,000,000 3M · BXSL 9,486,000 3M · MAIN 147,577,000 3M · PSEC 153,662,000 FY · TRIN not tagged
 *   ProfitLoss                              USD      TRIN 44,405,000 3M (its net increase in net assets)
 *   LineOfCreditFacilityRemainingBorrowingCapacity  USD I  BXSL 2,628,200,000 · TRIN 407,900,000 · others not tagged
 *   LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths  USD I  PSEC 378,908,000 · MAIN 500,000,000 (2025-12-31)
 *   InvestmentCompanyFinancialCommitmentToInvesteeFutureAmount  USD I  ARCC 33,000,000 (one member, not the total) · MAIN 395,391,000 · PSEC 64,611,000 · BXSL last 2022-12-31
 *
 * Frames, same day: NetAssetValuePerShare/USD-per-shares/CY2026Q2I holds
 * 314 filers (ARCC 19.35, PSEC 5.71); the asset-coverage frame holds 76
 * (ARCC 1.86, BXSL 1.78, PSEC 3.394); NetInvestmentIncome/USD/CY2026Q2
 * holds ARCC, BXSL and MAIN but not PSEC, whose June quarter is a fiscal
 * fourth quarter and exists only as the 10-K annual less its 10-Qs.
 */

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPORT_FORM, nearest, fiscalQuarterFor, coverShares,
} from "./statements.mjs";

/* The lien map lives in credit.js with every other BDC formula, so the
   holdings build and the page classify a label the same way; it is
   loaded here the way sec-pull.mjs loads metrics.js. */
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RTCredit = require(join(ROOT, "frontend/lib/credit.js"));

const DAY_MS = 86400000;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/* A BDC names its fiscal year for the calendar year in which it ends:
   Prospect's year to June 30 2026 is its fiscal 2026, Golub's year to
   September 30 2026 is its fiscal 2026, Capital Southwest's year to
   March 31 2026 is its fiscal 2026. statements.mjs's fiscalYearFor
   keeps a calendar-aligned year for cross-company work (a June year end
   maps to the year it began), which would label Prospect's fourth
   quarter "fiscal 2025"; the filer's own name is what the scorecard
   prints beside the calendar date, so it is computed here. */
export function bdcFiscalYear(end, fyEndMonth) {
  const y = Number(String(end).slice(0, 4)), m = Number(String(end).slice(5, 7));
  return m <= fyEndMonth ? y : y + 1;
}

/* ---------- the concept map ----------
 *
 * Every entry: key, the ordered tag ladder, unit (USD | USD/shares |
 * pure | shares), kind (instant | duration), ytd (true where section 4.2
 * says most filers tag the fact year to date) and label. A ladder step
 * is a tag name, or { minus: [a, b] } for a value that is one tag less
 * another; the value records which step answered. `note` travels onto
 * every value read from the concept. `positive` marks a flow that is
 * never negative in a real quarter (and zero only for a filer that never
 * pays it); `band`, on distributions only, is the multiples of the
 * fiscal year's other quarters a differenced figure may span, wide
 * enough for a special on top of the regular. The other flows carry no
 * band: interest tripled in 2022 for a young filer levering up as rates
 * rose (KBDC, NCDL, RWAY) and income quadrupled in LIEN's quarter of
 * acquisition, and both are real.
 */
export const BDC_CONCEPTS = {
  portfolioFairValue: {
    key: "portfolioFairValue", tags: ["InvestmentOwnedAtFairValue"],
    unit: "USD", kind: "instant", ytd: false, label: "Portfolio at fair value",
  },
  portfolioCost: {
    key: "portfolioCost", tags: ["InvestmentOwnedAtCost"],
    unit: "USD", kind: "instant", ytd: false, label: "Portfolio at cost",
  },
  navPerShare: {
    key: "navPerShare", tags: ["NetAssetValuePerShare"],
    unit: "USD/shares", kind: "instant", ytd: false, label: "NAV per share",
  },
  /* Four steps: the after-tax tag; pre-tax less the tax line; pre-tax
     alone, labelled so; the older InvestmentIncomeNet (TRIN, FDUS). The
     first step that reconciles to the tagged NII per share within a cent
     answers (chooseNii); the value's `step`, `note` and `crossCheck` say
     which and why. */
  niiAfterTax: {
    key: "niiAfterTax",
    tags: [
      "InvestmentIncomeOperatingAfterExpenseAndTax",
      { minus: ["NetInvestmentIncome", "InvestmentIncomeOperatingTaxExpenseBenefit"] },
      "NetInvestmentIncome",
      "InvestmentIncomeNet",
    ],
    stepNotes: [null, "pre-tax NII less the tagged tax line", "no tax line tagged", "InvestmentIncomeNet, no tax line tagged"],
    unit: "USD", kind: "duration", ytd: false, label: "Net investment income after tax",
  },
  niiPreTax: {
    key: "niiPreTax", tags: ["NetInvestmentIncome"],
    unit: "USD", kind: "duration", ytd: false, label: "Net investment income before tax",
  },
  niiTax: {
    key: "niiTax", tags: ["InvestmentIncomeOperatingTaxExpenseBenefit"],
    unit: "USD", kind: "duration", ytd: false, label: "Income and excise tax on NII",
  },
  niiPerShare: {
    key: "niiPerShare", tags: ["InvestmentCompanyInvestmentIncomeLossPerShare"],
    unit: "USD/shares", kind: "duration", ytd: true, label: "NII per share",
  },
  /* The declared-dividend tag is stale by years for several filers and
     TRIN's 12.27 is not a dividend; it stands second in the ladder and a
     plausibility guard in buildBdcSeries drops any quarter above a
     quarter of NAV. The third step, dollars over weighted shares, is
     derived in the builder. */
  distributionsPerShare: {
    key: "distributionsPerShare",
    tags: ["InvestmentCompanyDistributionToShareholdersPerShare", "CommonStockDividendsPerShareDeclared"],
    unit: "USD/shares", kind: "duration", ytd: true, label: "Distributions per share",
    positive: true, band: [0.4, 5],
  },
  distributionsDollars: {
    key: "distributionsDollars", tags: ["InvestmentCompanyDividendDistribution"],
    unit: "USD", kind: "duration", ytd: false, label: "Distributions declared",
    positive: true, band: [0.4, 5],
  },
  /* The common-only line, where a filer with preferred stock tags one
     (PSEC's 191,708,000 for the nine months to 2026-03-31 is its
     271,917,000 of distributions less 80,209,000 of preferred
     dividends): the dollars over shares are taken from it first, since
     InvestmentCompanyDividendDistribution holds the preferred dividend
     for some filers (PSEC) and not others (FRBP). */
  distributionsCommon: {
    key: "distributionsCommon", tags: ["DividendsCommonStock"],
    unit: "USD", kind: "duration", ytd: true, label: "Common dividends declared",
    positive: true, band: [0.4, 5],
  },
  totalReturn: {
    key: "totalReturn", tags: ["InvestmentCompanyTotalReturn"],
    unit: "pure", kind: "duration", ytd: true, label: "Total return on NAV",
  },
  netAssets: {
    key: "netAssets", tags: ["StockholdersEquity", "AssetsNet"],
    unit: "USD", kind: "instant", ytd: false, label: "Net assets",
  },
  /* Never LineOfCredit alone: PFLT and KBDC tag a single facility under
     it. The guard checks 0.5 x Liabilities <= debt <= Liabilities
     (blueprint 4.2), tries the next ladder step when a step fails (TSLX
     carries the first tag at principal, above its liabilities, and
     LongTermDebt inside them), and leaves the quarter empty, flagged,
     when every step fails. */
  debt: {
    key: "debt",
    tags: ["DebtInstrumentCarryingAmount", "LongTermDebt", "DebtLongtermAndShorttermCombinedAmount", "LinesOfCreditCurrent"],
    unit: "USD", kind: "instant", ytd: false, label: "Debt outstanding",
  },
  liabilities: {
    key: "liabilities", tags: ["Liabilities"],
    unit: "USD", kind: "instant", ytd: false, label: "Total liabilities",
  },
  /* The single-facility tag, read for the debt guard only: a filer that
     tags its notes under the ladder and its revolver here alone serves
     the notes as total debt otherwise (GLAD's 259,500,000 beside a
     177,500,000 facility against 439,377,000 of liabilities at
     2026-06-30; BBDC's 1,117,489,000 beside 277,226,000). */
  lineOfCredit: {
    key: "lineOfCredit", tags: ["LineOfCredit"],
    unit: "USD", kind: "instant", ytd: false, label: "Credit facility outstanding (single-facility tag)",
    note: "one facility, never total debt on its own (blueprint 4.2)",
  },
  /* Total assets bound the portfolio (a member subtotal tagged without
     its axis is a fraction of them) and are the numerator of the
     asset-coverage formula in blueprint 4.2. */
  totalAssets: {
    key: "totalAssets", tags: ["Assets"],
    unit: "USD", kind: "instant", ytd: false, label: "Total assets",
  },
  /* FSK, OBDC, BBDC and CGBD tag only the combined cash-and-restricted
     tag (FSK 109,000,000 and OBDC 238,049,000 at 2026-06-30), so it is
     the third step, labelled. */
  cash: {
    key: "cash",
    tags: ["CashAndCashEquivalentsAtCarryingValue", "Cash", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
    stepNotes: [null, null, "includes restricted cash"],
    unit: "USD", kind: "instant", ytd: false, label: "Cash and equivalents",
  },
  assetCoverage: {
    key: "assetCoverage", tags: ["InvestmentCompanySeniorSecurityIndebtednessAssetCoverageRatio"],
    unit: "pure", kind: "instant", ytd: false, label: "Asset coverage (tagged)",
  },
  weightedShares: {
    key: "weightedShares", tags: ["WeightedAverageNumberOfSharesOutstandingBasic"],
    unit: "shares", kind: "duration", ytd: false, label: "Weighted average shares, basic",
  },
  /* A filer with preferred stock reports NII per common share after the
     preferred dividend (CGBD's 0.47 for the quarter to 2022-03-31 is
     25,872,000 less 875,000 over 52,892,054 shares) and declares the
     preferred dividend inside its dollar distributions (PSEC's
     92,123,000 for the quarter to 2026-03-31 holds 26,702,000 of it):
     netted out of both before any per-share arithmetic. */
  preferredDividends: {
    key: "preferredDividends", tags: ["PreferredStockDividendsIncomeStatementImpact", "DividendsPreferredStock"],
    unit: "USD", kind: "duration", ytd: false, label: "Preferred stock dividends",
  },
  sharesOutstanding: {
    key: "sharesOutstanding", tags: ["CommonStockSharesOutstanding"],
    unit: "shares", kind: "instant", ytd: false, label: "Shares outstanding",
  },
  managementFee: {
    key: "managementFee", tags: ["ManagementFeeExpense"],
    unit: "USD", kind: "duration", ytd: false, label: "Management fee",
    note: "absent for an internally managed BDC (MAIN, HTGC, TRIN, CSWC); never zero",
    positive: true,
  },
  /* A quarter with no fact under either tag is left empty and flagged
     where the filer is externally managed (a management fee is tagged),
     never zero: GBDC's IncentiveFeeExpense is stale and OTF tags it only
     in the 10-K. */
  incentiveFeeIncome: {
    key: "incentiveFeeIncome", tags: ["IncentiveFeeExpenseIncomeBased", "IncentiveFeeExpense"],
    stepNotes: [null, "unsplit incentive fee"],
    unit: "USD", kind: "duration", ytd: false, label: "Incentive fee, income based",
  },
  incentiveFeeCapitalGains: {
    key: "incentiveFeeCapitalGains", tags: ["IncentiveFeeExpenseCapitalGainBased"],
    unit: "USD", kind: "duration", ytd: false, label: "Incentive fee accrual, capital gains based",
  },
  expenseRatio: {
    key: "expenseRatio",
    tags: ["InvestmentCompanyExpenseRatioIncludingIncentiveFee", "InvestmentCompanyExpenseRatioBeforeIncentiveAllocation",
           "InvestmentCompanyExpenseRatioExcludingIncentiveFee", "InvestmentCompanyExpenseRatio"],
    unit: "pure", kind: "duration", ytd: true, label: "Expense ratio (as tagged)",
    note: "definition differs by tag; kept year to date, never differenced",
  },
  costOfDebt: {
    key: "costOfDebt", tags: ["DebtWeightedAverageInterestRate"],
    unit: "pure", kind: "instant", ytd: false, label: "Weighted average interest rate on debt",
  },
  pikInterestIncome: {
    key: "pikInterestIncome", tags: ["InterestIncomeOperatingPaidInKind"],
    unit: "USD", kind: "duration", ytd: true, label: "PIK interest income",
  },
  pikDividendIncome: {
    key: "pikDividendIncome", tags: ["DividendIncomeOperatingPaidInKind"],
    unit: "USD", kind: "duration", ytd: true, label: "PIK dividend income",
  },
  pikIncomeCombined: {
    key: "pikIncomeCombined", tags: ["InterestAndDividendIncomeOperatingPaidInKind"],
    unit: "USD", kind: "duration", ytd: true, label: "PIK interest and dividend income (combined tag)",
  },
  /* A cash-flow reconciling item — the non-cash income added back — not
     an income line. Kept apart so it is never summed with the income
     tags above. */
  pikNonCashAdjustment: {
    key: "pikNonCashAdjustment", tags: ["PaidInKindInterest"],
    unit: "USD", kind: "duration", ytd: true, label: "PIK interest, cash-flow adjustment",
    note: "cash-flow statement add-back; not income",
  },
  totalInvestmentIncome: {
    key: "totalInvestmentIncome", tags: ["GrossInvestmentIncomeOperating", "InterestAndDividendIncomeOperating"],
    unit: "USD", kind: "duration", ytd: false, label: "Total investment income",
    positive: true,
  },
  totalExpenses: {
    key: "totalExpenses",
    tags: ["InvestmentIncomeInvestmentExpense", "OperatingExpenses", "InvestmentCompanyExpenseAfterReductionOfFeeWaiverAndReimbursement"],
    stepNotes: [null, null, "net of fee waivers"],
    unit: "USD", kind: "duration", ytd: false, label: "Total expenses",
    positive: true,
  },
  /* InterestExpense is a note-level figure for some filers (SAR tags
     800,000 under it and 12,451,865 under InterestAndDebtExpense for
     the same quarter), so the guard holds the annualised figure to
     1-20% of debt and tries the next step. */
  interestExpense: {
    key: "interestExpense",
    tags: ["InterestExpense", "InterestExpenseOperating", "InterestExpenseDebt", "InterestAndDebtExpense", "InterestExpenseNonoperating"],
    unit: "USD", kind: "duration", ytd: false, label: "Interest and credit facility expense",
    positive: true,
  },
  realizedGains: {
    key: "realizedGains",
    tags: ["RealizedInvestmentGainsLosses", "DebtAndEquitySecuritiesRealizedGainLoss",
           "RealizedGainLossInvestmentDerivativeAndForeignCurrencyTransactionPriceChangeOperatingAfterTax"],
    unit: "USD", kind: "duration", ytd: false, label: "Net realized gains (losses)",
  },
  unrealizedGains: {
    key: "unrealizedGains",
    tags: ["UnrealizedGainLossOnInvestments", "DebtAndEquitySecuritiesUnrealizedGainLoss",
           "UnrealizedGainLossInvestmentDerivativeAndForeignCurrencyTransactionPriceChangeOperatingAfterTax"],
    unit: "USD", kind: "duration", ytd: false, label: "Net change in unrealized gains (losses)",
  },
  netIncreaseInNetAssets: {
    key: "netIncreaseInNetAssets", tags: ["NetIncomeLoss", "ProfitLoss"],
    unit: "USD", kind: "duration", ytd: false, label: "Net increase in net assets from operations",
  },
  revolverCapacity: {
    key: "revolverCapacity", tags: ["LineOfCreditFacilityRemainingBorrowingCapacity"],
    unit: "USD", kind: "instant", ytd: false, label: "Undrawn revolver capacity",
  },
  debtMaturitiesNext12M: {
    key: "debtMaturitiesNext12M", tags: ["LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths"],
    unit: "USD", kind: "instant", ytd: false, label: "Debt maturing within twelve months",
  },
  unfundedCommitments: {
    key: "unfundedCommitments", tags: ["InvestmentCompanyFinancialCommitmentToInvesteeFutureAmount"],
    unit: "USD", kind: "instant", ytd: false, label: "Unfunded commitments (dimensionless value)",
    note: "reconcile per filer: ARCC's value is a single member, PFLT's is the total",
  },
};

/* The three anchors a period is recognised by, and the NII ladder the
   fourth quarter is keyed on. */
const ANCHOR_INSTANTS = ["navPerShare", "portfolioFairValue", "netAssets"];
const NII_KEY = "niiAfterTax";

/* ---------- reading rows ---------- */

function spanDays(row) {
  if (!row.start || !row.end) return null;
  return Math.round((new Date(row.end) - new Date(row.start)) / DAY_MS);
}

/* Durations are classified by the length of the reported span, as
   statements.mjs does, with the two year-to-date bands added: a 10-Q
   carries the quarter and the year to date side by side, and the
   difference between consecutive YTD spans is the quarter. */
const SPAN_CLASSES = [["3M", 80, 100], ["6M", 170, 200], ["9M", 260, 290], ["12M", 350, 380]];
function spanClass(row) {
  const d = spanDays(row);
  if (d === null) return "instant";
  for (const [name, lo, hi] of SPAN_CLASSES) if (d >= lo && d <= hi) return name;
  return null;
}

/* Rows of one tag in one unit, exactly that unit: "USD" must not pick
   up "USD/shares", and "pure" stays "pure". Report forms only. Each
   period keeps two rows: the latest filed, which carries any
   restatement, and the earliest filed, the figure the filing of that
   period itself reported (`original`); a fourth quarter is differenced
   from the originals so a 10-K's restated year is never set against a
   nine-month row filed before the restatement. */
function tagRows(bucket, tag, unit) {
  const c = bucket && bucket[tag];
  const units = (c && c.units) || {};
  const rows = Array.isArray(units[unit]) ? units[unit] : [];
  const best = new Map();
  for (const r of rows) {
    if (!REPORT_FORM.test(r.form || "") || !r.end || typeof r.val !== "number") continue;
    const key = periodKey(r);
    const cur = best.get(key);
    if (!cur) { best.set(key, { latest: r, original: r }); continue; }
    if (String(r.filed) > String(cur.latest.filed)) cur.latest = r;
    if (String(r.filed) < String(cur.original.filed)) cur.original = r;
  }
  return [...best.values()].map(({ latest, original }) => ({
    ...latest, tag,
    original: original === latest ? null : { ...original, tag },
  }));
}

const periodKey = (r) => `${r.start || ""}|${r.end}`;

/* The rows of one ladder step, keyed by period. A subtraction step
   answers only where both of its tags report the period; its original
   is the pair of originals where both exist. */
function stepRows(bucket, step, unit) {
  if (typeof step === "string") return tagRows(bucket, step, unit);
  const a = tagRows(bucket, step.minus[0], unit);
  const b = new Map(tagRows(bucket, step.minus[1], unit).map((r) => [periodKey(r), r]));
  const tag = step.minus[0] + "-" + step.minus[1];
  return a.filter((r) => b.has(periodKey(r))).map((r) => {
    const s = b.get(periodKey(r));
    const ao = r.original || r, bo = s.original || s;
    return {
      ...r, val: r.val - s.val, tag,
      original: r.original || s.original ? { ...ao, val: ao.val - bo.val, tag } : null,
    };
  });
}

/* Split a step's rows into an instant map and one map per span class,
   each keyed by end date. */
function byShape(rows) {
  const shape = { instant: new Map(), "3M": new Map(), "6M": new Map(), "9M": new Map(), "12M": new Map() };
  for (const r of rows) {
    const cls = spanClass(r);
    if (!cls) continue;
    const m = shape[cls];
    /* two rows of the same end and class (a 52/53-week edge) keep the
       later filed */
    const prior = m.get(r.end);
    if (!prior || String(r.filed) > String(prior.filed)) m.set(r.end, r);
  }
  return shape;
}

/**
 * A concept's ladder resolved one step at a time: an array of shapes in
 * ladder order. The reader walks the steps and the first that answers a
 * period wins it, so tag preference holds where two tags overlap, the
 * series stays continuous where a filer switched tags, and the value
 * records which step answered.
 */
function resolveSteps(bucket, concept) {
  return concept.tags.map((step) => byShape(stepRows(bucket, step, concept.unit)));
}

/**
 * A pure-unit reader: asset coverage, the weighted average interest
 * rate. The unit travels verbatim on every value — a coverage ratio of
 * 1.78 filed as USD would read as two dollars — and nothing is scaled.
 */
export function readPure(bucket, tags, { kind = "instant" } = {}) {
  return readUnit(bucket, tags, "pure", { kind });
}

/** Rows of a tag ladder in one unit, keyed by end date, the unit kept;
    the first step reporting an end answers for it. */
export function readUnit(bucket, tags, unit, { kind = "instant" } = {}) {
  const out = new Map();
  tags.forEach((step, i) => {
    for (const r of stepRows(bucket, step, unit)) {
      const cls = spanClass(r);
      if (!cls || (kind === "instant" ? cls !== "instant" : cls === "instant")) continue;
      if (out.has(r.end)) continue;
      out.set(r.end, { v: r.val, unit, tag: r.tag, periodType: cls === "instant" ? "instant" : cls,
                       start: r.start || null, end: r.end, form: r.form || null,
                       filed: r.filed || null, accn: r.accn || null, step: i + 1 });
    }
  });
  return out;
}

/* ---------- calendar helpers ---------- */

const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
/* the month-end n months before an ISO date's month */
function shiftMonthEnd(iso, months) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
  const t = y * 12 + (m - 1) + months;
  return monthEnd(Math.floor(t / 12), (t % 12) + 1);
}
const dayAfter = (iso) => new Date(new Date(iso + "T00:00:00Z").getTime() + DAY_MS).toISOString().slice(0, 10);
const isMonthEnd = (iso) => iso === monthEnd(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));

/* ---------- value shaping ---------- */

/* A differenced figure carries floating-point noise (1.05 less 0.55 is
   not 0.5 in binary); dollars round to the unit and per-share figures
   to four places, the precision the data files are written at. */
function roundUnit(v, unit) {
  if (unit === "USD" || unit === "shares") return Math.round(v);
  return Math.round(v * 10000) / 10000;
}

function fromRow(r, periodType, concept, step, extra) {
  return {
    v: r.val, unit: concept.unit, tag: r.tag, periodType,
    start: r.start || null, end: r.end,
    form: r.form || null, filed: r.filed || null, accn: r.accn || null,
    source: "companyfacts",
    ...(step > 1 ? { step } : {}),
    ...(concept.stepNotes && concept.stepNotes[step - 1] ? { note: concept.stepNotes[step - 1] } : {}),
    ...(concept.note ? { note: concept.note } : {}),
    ...(extra || {}),
  };
}

const ADDITIVE = new Set(["USD", "USD/shares"]);
const sameSpan = (a, b) => !!a && !!b && a.start === b.start && a.end === b.end;
const tagName = (step) => (typeof step === "string" ? step : step.minus.join("-"));

/* The pair of rows a difference is taken from. The fourth quarter pairs
   the originals — the 10-K of the fiscal year and its own third-quarter
   10-Q — because a later 10-K restates the whole prior year while the
   nine-month comparative in the 10-Q filed months earlier has not seen
   the same restatement (Prospect's 300,745,000 against 272,567,000).
   The second and third quarters pair the latest filed rows, as the
   three-month facts beside them are: Ares restated its first half of
   2024 from 1.13 to 1.17 per share in the 2025 10-Q that also restated
   the quarter's NII, and the restated pair is the one that reconciles.
   `rows` records which rule paired them (a period reported once is
   both), and the other row's figure sits beside it where it disagrees
   by more than half a percent. */
function differencePair(cur, prior, preferOriginal) {
  const co = cur.original || cur, po = prior.original || prior;
  const pair = preferOriginal ? { cur: co, prior: po, rows: "original" } : { cur, prior, rows: "latest" };
  const other = preferOriginal ? cur : co;
  return { ...pair, ...otherRow(pair.cur, other, preferOriginal) };
}

/* the other row's figure, recorded beside a value where it disagrees by
   more than half a percent: `original` beside a latest-filed figure,
   `restated` beside the period's own */
function otherRow(row, other, usingOriginal) {
  if (!other || other === row || Math.abs(row.val - other.val) <= Math.abs(row.val || 1) * 0.005) return {};
  return { [usingOriginal ? "restated" : "original"]: { v: other.val, accn: other.accn || null, filed: other.filed || null } };
}

/**
 * The value of a duration concept for one fiscal quarter from one
 * ladder step.
 *
 * A three-month fact is used when it exists. Otherwise the year-to-date
 * fact ending at the quarter is differenced against the prior YTD in the
 * same fiscal year, or against the sum of the quarters already resolved
 * ON THIS STEP when the prior YTD was not tagged: an annual fact less
 * quarters another tag answered mixes two bases (Main Street's
 * after-tax year for 2023 less three pre-tax NetInvestmentIncome
 * quarters; Gladstone Investment's income-based incentive fee less
 * three unsplit quarters, a negative), so a step whose own quarters are
 * missing answers null and the next step, or its own three-month fact,
 * takes the quarter (NSLR tags the fourth quarter's OperatingExpenses
 * in its 10-K). The fourth quarter is the 10-K's annual fact less the
 * nine months (or less the three quarters) and is labelled derivedQ4.
 * A ratio or a share count tagged year to date is kept as YTD, since
 * neither can be differenced.
 *
 * `basis` names the rows a difference came from and carries both
 * figures (`ytd`, `less`), so a guard can judge the row that was
 * subtracted as well as the result.
 *
 * `otherRows` flips the row preference — the period's own filing for a
 * three-month fact (a later comparative can carry a swapped tag: Oxford
 * Square's 2024 10-Qs), the other pair for a difference — and answers
 * null where there is no other row; the NII cross-check tries it when
 * the preferred rows fail.
 */
function quarterValue(shape, concept, step, end, fq, quarterOf, memo, { preferOriginal = fq === 4, otherRows = false } = {}) {
  const three = shape["3M"].get(end);
  if (three) {
    if (otherRows && !three.original) return null;
    const row = otherRows ? three.original : three;
    return fromRow(row, "3M", concept, step, {
      ...(otherRows ? { rows: "original" } : {}), ...otherRow(row, otherRows ? three : three.original, otherRows),
    });
  }
  if (otherRows) preferOriginal = !preferOriginal;
  if (fq === 1) return null;
  const cls = { 2: "6M", 3: "9M", 4: "12M" }[fq];
  const cur = shape[cls].get(end);
  if (!cur) return null;
  if (!ADDITIVE.has(concept.unit)) return fromRow(cur, "YTD", concept, step, { differenced: false });
  const prevEnd = shiftMonthEnd(end, -3);
  const prevCls = { 2: "3M", 3: "6M", 4: "9M" }[fq];
  const prior = shape[prevCls].get(prevEnd);
  let row = cur, less, basis;
  if (prior) {
    const pair = differencePair(cur, prior, preferOriginal);
    row = pair.cur;
    less = pair.prior.val;
    basis = { ytdStart: pair.cur.start, ytdEnd: pair.cur.end, lessEnd: prevEnd, lessTag: pair.prior.tag, rows: pair.rows,
              ytd: pair.cur.val, less,
              ...(pair.restated ? { restated: pair.restated } : {}), ...(pair.original ? { original: pair.original } : {}) };
  } else {
    /* the quarters before this one, each resolved on this step alone
       (a three-month fact or a YTD difference of the same tag); a
       quarter this step cannot answer leaves the whole to the next */
    if (otherRows) return null;
    let sum = 0;
    for (let q = 1; q < fq; q++) {
      const qv = quarterValue(shape, concept, step, shiftMonthEnd(end, -3 * (fq - q)), q, quarterOf, memo);
      if (!qv || typeof qv.v !== "number") return null;
      /* a quarter of nothing inside a flow the filer pays is a row on
         the wrong span (TCPC's second-quarter declaration of 2021 is
         tagged over the half year, so the half less the first quarter
         is zero), and the year less such quarters is not the fourth */
      if (concept.positive && qv.v <= 0) return null;
      sum += qv.v;
    }
    less = sum;
    basis = { ytdStart: cur.start, ytdEnd: cur.end, lessQuarters: fq - 1, rows: "latest", ytd: cur.val, less };
  }
  return fromRow(row, fq === 4 ? "derivedQ4" : "3M", concept, step, {
    v: roundUnit(row.val - less, concept.unit), start: dayAfter(prevEnd),
    derived: fq === 4 ? "annual-less-ytd" : "ytd-differenced", differenced: true, basis,
  });
}

/* ---------- the NII cross-check (blueprint 4.2) ---------- */

/* NII over weighted basic shares must equal the tagged NII per share
   within a cent. The first step answers where its rows reconcile; where
   they fail and the other rows of the same step do (the period's own
   filing against a restated comparative, or the other pair of a
   difference), those answer. The ladder is settled per filer
   (settleNiiLadder), and the check then confirms or flags each quarter;
   it never switches a step on one quarter's arithmetic, since a filer's
   per-share tag can be something else entirely (SuRo's is neither NII
   nor its change in net assets per share) or sit on an older
   presentation than the dollars (Main Street's 2024 first quarter), and
   one coincidence would flip a quarter of a series. Where the per-share
   fact or the share count is not on the quarter's span, the identity
   NII + realized + unrealized = net increase in net assets is checked
   instead, on three-month facts only and within 5% of NII: a filer can
   carry a line between the two (FRBP's are 7-22% apart), and four
   derived fourth quarters compound their noise. */
export const NII_PER_SHARE_TOLERANCE = 0.01;
const NII_IDENTITY_TOLERANCE = 0.05;
/* A derived fourth quarter is checked against an estimated share count
   (fourthQuarterShares), so the cent becomes two cents or a quarter of
   the per-share figure, whichever is wider: wide enough for the
   estimate, narrow enough to reject a nine-month row tagged on another
   basis (Horizon's -0.40 for the nine months to 2022-09-30 gives a
   fourth quarter of 1.86 against 10,740,000 over 26,960,340 shares,
   0.40). */
export const NII_DERIVED_TOLERANCE = { abs: 0.02, rel: 0.25 };
/* A tagged per-share fact more than this far from NII over shares is a
   scale or sign error (SuRo's tag is not NII per share; Equus's carries
   the wrong sign), not a cent of rounding or a preferred dividend the
   filer nets: only such a gap counts toward unsettling the filer's tag
   and substituting NII over shares for a filer-reported fact. */
export const NII_PER_SHARE_LARGE_GAP = { abs: 0.05, rel: 0.25 };
export const largeGap = (tagged, implied) =>
  Math.abs(implied - tagged) > Math.max(NII_PER_SHARE_LARGE_GAP.abs, NII_PER_SHARE_LARGE_GAP.rel * Math.abs(tagged));
/* an implied per-share figure a hundred times off the tagged one is a
   share count on the wrong scale, not an NII on the wrong line */
export const SHARE_SCALE_FACTOR = 100;

const stepNo = (c) => c.step || 1;
const isFact = (x) => x && x.periodType === "3M" && !x.differenced;
/* how many times one figure is off another, always at least 1; a zero
   on either side is no scale at all and never off-scale */
const timesOff = (a, b) => (a === 0 || b === 0 ? Infinity : Math.round(Math.max(Math.abs(a / b), Math.abs(b / a))));
const offScale = (a, b, factor) => a !== 0 && b !== 0 && timesOff(a, b) >= factor;
/* a candidate's alternate rows never travel onto the served value */
const served = ({ alternate, ...value }) => value;

/**
 * The NII ladder's answer for one quarter: `candidates` are the steps'
 * values in ladder order (less any the filer's ladder skips), each with
 * an `alternate` where the other rows give a different figure; `ctx` the
 * quarter's NII per share (one value, or the differences from both row
 * pairs in order of preference), weighted shares, realized and
 * unrealized gains and net increase in net assets. The value is the
 * first candidate on its rows, or on its alternate rows where only
 * those reconcile (noted), or flagged when neither does; `crossCheck`
 * on it says which rows and whether they reconcile, `perShare` is the per-share value it
 * reconciled to (the caller adopts that pair: Ares restated its 2024
 * first half but not its nine months, and only the original pair gives
 * a third quarter that matches 361,000,000 over 635,000,000 shares),
 * `verdicts` lists every step's pass or fail on the per-share basis
 * (either rows) for the filer-level settlement, and `sharesFlag` is set
 * instead of `flag` when every step is a hundred times off the tagged
 * figure, which is the share count's fault. No check possible: the
 * first candidate, unmarked.
 */
export function chooseNii(candidates, ctx = {}) {
  const list = (candidates || []).filter((c) => c && isNum(c.v));
  const none = { value: null, flag: null, sharesFlag: null, perShare: null, verdicts: [] };
  if (!list.length) return none;
  const first = list[0];
  const { shares, realized, unrealized, netIncrease } = ctx;
  const perShares = (Array.isArray(ctx.perShare) ? ctx.perShare : [ctx.perShare]).filter(Boolean);
  const has = (x) => x && isNum(x.v) && sameSpan(x, first);

  if (perShares.some(has) && has(shares) && shares.v > 0) {
    /* the cent, or the derived tolerance where the share count is an
       estimate or the per-share figure a difference of two rows */
    const tol = ctx.tolerance || { abs: NII_PER_SHARE_TOLERANCE, rel: 0 };
    const estimate = shares.estimate ? { sharesEstimate: shares.estimate } : {};
    /* a filer with preferred stock reports the per-share figure either
       before the preferred dividend (PSEC: 78,457,000 over 483,414,178
       is its 0.16) or per common share after it (CGBD: 25,872,000 less
       875,000 over 52,892,054 is its 0.47); the gross figure is tried
       first and the net one where the filer tags the dividend on the
       span, and the check records which reconciled */
    const pref = ctx.preferred && isNum(ctx.preferred.v) && ctx.preferred.v !== 0 && sameSpan(ctx.preferred, first) ? ctx.preferred.v : 0;
    /* every candidate on its rows and its alternate rows against one
       per-share value */
    const one = (x, ps) => {
      const within = (i) => Math.abs(i - ps.v) <= Math.max(tol.abs, tol.rel * Math.abs(ps.v));
      const gross = x.v / shares.v;
      if (!pref || within(gross)) return { implied: roundUnit(gross, "USD/shares"), raw: gross, ok: within(gross) };
      const net = (x.v - pref) / shares.v;
      return { implied: roundUnit(gross, "USD/shares"), raw: gross, ok: within(net),
               ...(within(net) ? { preferredNetted: pref, implied: roundUnit(net, "USD/shares"), raw: net } : { impliedNetOfPreferred: roundUnit(net, "USD/shares") }) };
    };
    const test = (ps) => list.map((c) => {
      const main = one(c, ps);
      const alt = c.alternate && isNum(c.alternate.v) && sameSpan(c.alternate, first) ? one(c.alternate, ps) : null;
      return { c, ...main, alt, either: main.ok || !!(alt && alt.ok) };
    });
    /* the preferred per-share value, then the other pair's difference
       when the first step reconciles only to that */
    const options = perShares.filter(has);
    let perShare = options[0], tested = test(perShare);
    for (const ps of options.slice(1)) {
      if (tested[0].either) break;
      const t = test(ps);
      if (t[0].either) { perShare = ps; tested = t; }
    }
    const target = { perShare: perShare.v, shares: shares.v, ...estimate, ...(ctx.tolerance ? { tolerance: tol } : {}) };
    const verdicts = tested.map((t) => ({ step: stepNo(t.c), tag: t.c.tag, ok: t.either }));
    const hit = tested[0];
    if (hit.either) {
      const useAlt = !hit.ok;
      const chosen = useAlt ? hit.c.alternate : hit.c;
      const result = useAlt ? hit.alt : hit;
      const note = !useAlt ? chosen.note : [chosen.note, chosen.rows === "original"
        ? "latest-filed row rejected by the cross-check; the period's own filing reconciles"
        : "the preferred row pair rejected by the cross-check; the other pair reconciles"].filter(Boolean).join("; ");
      const value = {
        ...served(chosen), ...(note ? { note } : {}),
        crossCheck: { basis: "perShare", ...target, implied: result.implied, reconciles: true,
                      ...(result.preferredNetted ? { preferredDividends: result.preferredNetted, perCommonShare: true } : {}) },
      };
      return { value, flag: null, sharesFlag: null, perShare, verdicts };
    }
    /* nothing reconciles: a hundredfold miss on every step is the share
       count's scale, and the NII is left unmarked; otherwise the first
       step, flagged */
    if (tested.every((t) => offScale(t.raw, perShare.v, SHARE_SCALE_FACTOR))) {
      const sharesFlag = {
        tag: shares.tag, value: shares.v, perShare: perShare.v, nii: first.v, implied: tested[0].implied,
        factor: timesOff(perShare.v, tested[0].raw),
        reason: "NII over weighted shares is off the tagged NII per share by a factor of a hundred or more on every ladder step; the share count is on the wrong scale; left empty",
      };
      return { value: served(first), flag: null, sharesFlag, perShare: null, verdicts: [] };
    }
    const netted = tested[0].impliedNetOfPreferred ? { impliedNetOfPreferred: tested[0].impliedNetOfPreferred } : {};
    const value = { ...served(first), crossCheck: { basis: "perShare", ...target, implied: tested[0].implied, ...netted, reconciles: false } };
    const flag = {
      basis: "perShare", tag: first.tag, value: first.v, ...target, implied: tested[0].implied, ...netted,
      reason: `NII over ${shares.estimate ? "the estimated fourth-quarter shares" : "weighted shares"} is more than ` +
        `${ctx.tolerance ? "the derived tolerance" : "a cent"} from the ${perShare.differenced ? "derived" : "tagged"} NII per share; kept`,
    };
    return { value, flag, sharesFlag: null, perShare: null, verdicts };
  }

  if ([first, realized, unrealized, netIncrease].every(isFact) && has(realized) && has(unrealized) && has(netIncrease)) {
    const implied = Math.round(first.v + realized.v + unrealized.v);
    const ok = Math.abs(implied - netIncrease.v) <= Math.max(NII_IDENTITY_TOLERANCE * Math.abs(first.v), 1);
    const value = { ...served(first), crossCheck: { basis: "identity", netIncrease: netIncrease.v, implied, reconciles: ok } };
    const flag = ok ? null : {
      basis: "identity", tag: first.tag, value: first.v, netIncrease: netIncrease.v, implied,
      reason: "NII plus realized and unrealized gains is more than 5% from the net increase in net assets; another line sits between them or a tag is off; kept",
    };
    return { value, flag, sharesFlag: null, perShare: null, verdicts: [] };
  }
  return { ...none, value: served(first) };
}

/**
 * NII over weighted basic shares, served as NII per share where the
 * tagged figure failed the cross-check (blueprint 4.2's own identity,
 * run the other way): the NII value's period and provenance, the
 * rejected tagged figure recorded beside it.
 */
export function niiOverShares(nii, shares, rejected) {
  return {
    v: roundUnit(nii.v / shares.v, "USD/shares"), unit: "USD/shares", tag: nii.tag + "/" + shares.tag,
    periodType: nii.periodType, start: nii.start || null, end: nii.end,
    form: nii.form || null, filed: nii.filed || null, accn: nii.accn || null, source: nii.source,
    derived: "nii-over-shares",
    note: "NII over weighted basic shares; the tagged NII per share failed the cross-check",
    rejected: { v: rejected.v, tag: rejected.tag, accn: rejected.accn || null },
  };
}

/** The note on an NII value whose ladder skipped the steps before it
    (`steps`, with their `tags`): a filer whose tax line sits inside
    operating expenses tags a NetInvestmentIncome that is already after
    tax, and subtracting the line again is what the check rejected. */
export function niiSkipNote(chosen, steps, tags) {
  if (stepNo(chosen) === 3 && steps.includes(2)) return "tax line inside operating expenses; NII already after tax";
  return [chosen.note, tags.join(", ") + " rejected by the cross-check"].filter(Boolean).join("; ");
}

/**
 * A quarter where the after-tax tag, NetInvestmentIncome and a non-zero
 * tax line are all tagged says where the tax sits without any per-share
 * arithmetic: the after-tax tag equal to NetInvestmentIncome means the
 * line is inside operating expenses and the subtraction step is wrong
 * (PFLT, PNNT, RWAY, BCIC in every such quarter); equal to
 * NetInvestmentIncome less the line means the subtraction is right (ARCC,
 * BXSL, MAIN and most others). Verdicts in the settle function's shape,
 * or null where the quarter says nothing.
 */
export function tagVerdict(candidates) {
  const [after, less, pre] = [0, 1, 2].map((i) => candidates[i]);
  if (!after || !less || !pre || !sameSpan(after, pre) || !sameSpan(after, less) || pre.v === less.v) return null;
  if (after.v === pre.v) return [{ step: 2, tag: less.tag, ok: false }, { step: 3, tag: pre.tag, ok: true }];
  if (after.v === less.v) return [{ step: 2, tag: less.tag, ok: true }, { step: 3, tag: pre.tag, ok: false }];
  return null;
}

/**
 * Where a tax line sits is a filer's presentation, not a quarter's, so
 * the ladder is settled per filer: a step rejected in at least two
 * quarters (failed while a later step passed, by the per-share check or
 * the tag verdict) and never confirmed against a later step (passed
 * while the next step failed) is skipped in every quarter. Hercules's
 * tax is 1.5 cents a share in some quarters and under a cent in others,
 * and without this its series would alternate between NII less tax and
 * NII; PFLT's tax is under a cent in every quarter, and only the tag
 * verdict settles it. Two quarters, because one can be a coincidence
 * on a per-share tag that is not NII per share. Returns the steps to
 * skip, each with the count of rejecting quarters.
 */
export const NII_SKIP_MIN_QUARTERS = 2;
export function settleNiiLadder(verdictsByQuarter) {
  const rejected = new Map(), confirmed = new Map();
  for (const verdicts of verdictsByQuarter) {
    verdicts.forEach((v, i) => {
      if (!v.ok && verdicts.slice(i + 1).some((w) => w.ok)) rejected.set(v.step, (rejected.get(v.step) || 0) + 1);
      if (v.ok && verdicts[i + 1] && !verdicts[i + 1].ok) confirmed.set(v.step, (confirmed.get(v.step) || 0) + 1);
    });
  }
  return [...rejected.entries()].filter(([step, n]) => n >= NII_SKIP_MIN_QUARTERS && !confirmed.has(step))
    .map(([step, n]) => ({ step, rejectedIn: n })).sort((a, b) => a.step - b.step);
}

/* ---------- the fourth quarter's share count ----------
 *
 * A 10-K tags the year's weighted average, not the fourth quarter's, so
 * a derived fourth quarter has no count of its own to be checked
 * against. The estimate, in order: the filer's own three-month count
 * where it tags one; four times the annual average less the three
 * quarters' counts (the annual average is the mean of the four to
 * within the days in each quarter), held to a factor of two of the
 * year-end count; shares outstanding at the year end; the annual
 * average. `estimate` names which, and a check against one is run at
 * NII_DERIVED_TOLERANCE rather than the cent. */
export function fourthQuarterShares(p, priorQuarters) {
  const w = p.values.weightedShares;
  if (w && isNum(w.v) && w.v > 0 && w.periodType === "3M") return { v: w.v, tag: w.tag, estimate: null };
  const annual = w && isNum(w.v) && w.v > 0 && w.periodType === "YTD" && spanClass(w) === "12M" ? w.v : null;
  const so = p.values.sharesOutstanding && isNum(p.values.sharesOutstanding.v) && p.values.sharesOutstanding.v > 0
    ? p.values.sharesOutstanding : null;
  const counts = (priorQuarters || []).map((q) => (q && q.values.weightedShares && q.values.weightedShares.periodType === "3M"
    ? q.values.weightedShares.v : null));
  if (annual && counts.length === 3 && counts.every((c) => isNum(c) && c > 0)) {
    const est = Math.round(4 * annual - counts.reduce((a, b) => a + b, 0));
    if (est > 0 && (!so || (est >= 0.5 * so.v && est <= 2 * so.v))) return { v: est, tag: w.tag, estimate: "annual-less-quarters" };
  }
  if (so) return { v: so.v, tag: so.tag, estimate: "sharesOutstanding" };
  if (annual) return { v: annual, tag: w.tag, estimate: "annual" };
  return null;
}

/* the median of a list of numbers, or null for an empty one */
function median(list) {
  const s = list.filter(isNum).sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
/* whether a figure sits within a band of multiples of a reference,
   judged on magnitudes; a zero reference says nothing */
const inBand = (v, ref, band) => isNum(v) && isNum(ref) && ref !== 0 &&
  Math.abs(v) >= band[0] * Math.abs(ref) && Math.abs(v) <= band[1] * Math.abs(ref);

/* ---------- guards ----------
 *
 * Each runs over the periods after the ladders have answered and again
 * after mergeFrames has added a newer quarter, so a figure that arrived
 * from frames is held to the same rule. `alternates(key, period)` gives
 * the other ladder steps' values for that period, in ladder order, so a
 * guard can fall through before it empties a quarter. Every guard is
 * idempotent: an emptied quarter stays empty and is not flagged twice. */

/* blueprint 4.2: 0.5 x Liabilities <= debt <= Liabilities. A tag carried
   at principal above total liabilities (TSLX's
   DebtInstrumentCarryingAmount, 1,516,828,000 against 1,495,378,000 at
   2022-12-31) falls through to the carrying amount one step down
   (LongTermDebt 1,441,796,000) rather than widening the bound. */
const debtInBound = (d, l) => d >= 0.5 * l && d <= l;
/* Served debt runs 88-100% of Liabilities across the universe. A ladder
   tag below this share of them with a dimensionless LineOfCredit tagged
   beside it carries the notes alone: where the two together land inside
   the share and Liabilities, the sum is served as notes plus facility
   and the quarter flagged (GLAD at 2026-06-30: 259,500,000 and
   177,500,000 against 439,377,000; BBDC: 1,117,489,000 and 277,226,000
   against 1,438,325,000). Whether the tag carries the facility is the
   filer's presentation, not a quarter's: a filer whose tag plus
   facility ever exceeds its liabilities carries the facility inside
   the tag (GAIN's 400,938,000 beside a 63,700,000 facility against
   436,826,000 at 2024-06-30) and is never added to in any quarter,
   which keeps a quarter where the sum happens to fit (GAIN's
   2024-09-30, 346,138,000 and 8,900,000 against 410,405,000) from a
   double count. PSEC's 1,878,595,000 beside a 562,328,000 facility
   would exceed its 1,945,331,000 the same way. Until the holdings PR
   sums the DebtInstrumentAxis members, this is the only read of a
   facility. */
const DEBT_PARTIAL_BELOW = 0.85;
const facilityInsideTag = (periods) => periods.some((p) => {
  const d = p.values.debt, l = p.values.liabilities, loc = p.values.lineOfCredit;
  return d && l && loc && isNum(d.v) && isNum(l.v) && isNum(loc.v) && loc.v > 0 && !d.derived && d.v + loc.v > l.v;
});

/* one flag per quarter and metric, however many times a guard runs */
function flagOnce(flags, flag) {
  if (!flags.some((f) => f.end === flag.end && f.key === flag.key)) flags.push(flag);
}

function guardDebt(periods, flags, alternates, helpers = {}) {
  const inside = facilityInsideTag(helpers.allPeriods || periods);
  for (const p of periods) {
    const d = p.values.debt, l = p.values.liabilities;
    if (!d || !l || !isNum(d.v) || !isNum(l.v) || d.tag.includes("+LineOfCredit")) continue;
    const partial = d.v < DEBT_PARTIAL_BELOW * l.v;
    if (debtInBound(d.v, l.v) && !partial) continue;
    if (!debtInBound(d.v, l.v)) {
      const next = (alternates("debt", p) || []).find((c) => c && isNum(c.v) && c.tag !== d.tag && debtInBound(c.v, l.v));
      if (next) {
        p.values.debt = { ...next, note: `${d.tag} ${d.v} outside 0.5 x Liabilities .. Liabilities; next ladder step used` };
        continue;
      }
    }
    const loc = p.values.lineOfCredit;
    if (!inside && loc && isNum(loc.v) && loc.v > 0 && d.v + loc.v <= l.v && d.v + loc.v >= DEBT_PARTIAL_BELOW * l.v) {
      flagOnce(flags, { end: p.end, key: "debt", tag: d.tag, value: d.v, lineOfCredit: loc.v, liabilities: l.v,
                        reason: `${d.tag} below ${DEBT_PARTIAL_BELOW} x Liabilities with a LineOfCredit tagged beside it; the notes alone; the facility added and served as notes plus facility` });
      p.values.debt = { ...d, v: d.v + loc.v, tag: d.tag + "+LineOfCredit", derived: "notes-plus-facility",
                        components: { [d.tag]: d.v, LineOfCredit: loc.v },
                        note: "notes plus facility: the ladder tag carried the notes alone and the single-facility tag was added" };
      continue;
    }
    if (debtInBound(d.v, l.v)) continue;
    flagOnce(flags, { end: p.end, key: "debt", tag: d.tag, value: d.v, liabilities: l.v,
                      reason: "debt outside 0.5 x Liabilities .. Liabilities on every ladder step; left empty" });
    p.values.debt = null;
  }
}

/* A share count is anchored by net assets over NAV per share at the
   same date, which every filer tags and which cannot be on the wrong
   scale without both being. Shares outstanding at that date must be
   within a factor of five (rows filed on either side of a reverse split
   differ by two; MSIF's 80,105,999 against 40,056,833 at 2022-12-31);
   a weighted average over a span is held only to a factor of a hundred,
   since a filer that raised capital through the span carries a real
   average well under the period-end count (FRBP's 5,301,096 over 2021
   against 15,260,764 at its end). A miss is a scale error and the
   count is emptied: NCDL's 22,212,400,000 weighted shares at 2022-06-30
   against 22,695,789, OTF's 100,586,224,000 outstanding at 2020-12-31
   against 100,596,707, LIEN's 621,494 outstanding at 2024-06-30 against
   6,213,722. Runs before the NII cross-check, so a wrong count never
   charges its miss to the NII. */
const SHARE_SCALE = { sharesOutstanding: 5, weightedShares: SHARE_SCALE_FACTOR };
const shareAnchor = (na, nav) =>
  (na && nav && isNum(na.v) && isNum(nav.v) && na.v > 0 && nav.v > 0 ? na.v / nav.v : null);

/** Whether a weighted share count is on the wrong scale against net
    assets over NAV per share (the refresh asks before it hands a frame's
    count to the cross-check); false where there is no anchor. */
export function sharesOffScale(shares, netAssets, navPerShare) {
  const anchor = shareAnchor(netAssets, navPerShare);
  return !!anchor && !!shares && isNum(shares.v) && shares.v > 0 && offScale(shares.v, anchor, SHARE_SCALE.weightedShares);
}

function guardShares(periods, flags) {
  for (const p of periods) {
    const anchor = shareAnchor(p.values.netAssets, p.values.navPerShare);
    if (!anchor) continue;
    for (const [key, factor] of Object.entries(SHARE_SCALE)) {
      const s = p.values[key];
      if (!s || !isNum(s.v) || s.v <= 0 || !offScale(s.v, anchor, factor)) continue;
      flagOnce(flags, { end: p.end, key, tag: s.tag, value: s.v, impliedShares: Math.round(anchor), factor: timesOff(s.v, anchor),
                        reason: `share count off net assets over NAV per share by a factor of ${timesOff(s.v, anchor)}; a scale error; left empty` });
      p.values[key] = null;
    }
  }
}

/* A portfolio at fair value is most of total assets; a tagged figure
   below half of them is a member subtotal without its axis. Cost is at
   least half of fair value and half of total assets: a zero or a
   fraction is a member or a placeholder, and a cost tagged beside a
   member's fair value is a member too (OXSQ's 23,834,191 at 2026-06-30
   against assets of 290,605,053). Cost has no upper bound, because an
   impaired portfolio carries its cost however far the marks fall
   (SVVC's 89,862,162 against 148,635 of fair value; PIAC's 34,111,452
   against 13,803,034). */
function guardPortfolio(periods, flags) {
  for (const p of periods) {
    const fv = p.values.portfolioFairValue, a = p.values.totalAssets, cost = p.values.portfolioCost;
    const assets = a && isNum(a.v) && a.v > 0 ? a.v : null;
    if (fv && assets && isNum(fv.v) && !(fv.v >= 0.5 * assets && fv.v <= assets)) {
      flagOnce(flags, { end: p.end, key: "portfolioFairValue", tag: fv.tag, value: fv.v, assets,
                        reason: "fair value outside 0.5 x Assets .. Assets; a member subtotal, not the portfolio; left empty" });
      p.values.portfolioFairValue = null;
    }
    if (!cost || !isNum(cost.v)) continue;
    const fv2 = p.values.portfolioFairValue;
    const fvEmptied = !fv2 && flags.some((f) => f.key === "portfolioFairValue" && f.end === p.end);
    let reason = null;
    if (fv2 && isNum(fv2.v) && fv2.v > 0 && cost.v < 0.5 * fv2.v) reason = "cost below 0.5 x fair value; a member or a placeholder; left empty";
    else if (assets && cost.v < 0.5 * assets) reason = "cost below 0.5 x Assets; a member subtotal, not the portfolio; left empty";
    else if (!assets && fvEmptied) reason = "cost tagged beside a member's fair value with no total assets to bound it; left empty";
    if (!reason) continue;
    flagOnce(flags, { end: p.end, key: "portfolioCost", tag: cost.tag, value: cost.v,
                      ...(fv2 ? { fairValue: fv2.v } : {}), ...(assets ? { assets } : {}), reason });
    p.values.portfolioCost = null;
  }
}

/* Interest for a quarter, annualised, against period-end debt (else
   liabilities): 1-20%. A filer with negligible leverage (debt under 5%
   of net assets) is not checked, since the ratio then says nothing. */
const INTEREST_BOUNDS = [0.01, 0.20];
const annualised = (v) => (v.periodType === "3M" || v.periodType === "derivedQ4" ? v.v * 4 : null);
function interestInBound(v, base) {
  const a = annualised(v);
  return a !== null && a / base >= INTEREST_BOUNDS[0] && a / base <= INTEREST_BOUNDS[1];
}
function guardInterest(periods, flags, alternates) {
  for (const p of periods) {
    const ie = p.values.interestExpense, d = p.values.debt, l = p.values.liabilities, na = p.values.netAssets;
    const base = d && isNum(d.v) && d.v > 0 ? d.v : (l && isNum(l.v) && l.v > 0 ? l.v : null);
    if (!ie || !isNum(ie.v) || !base || annualised(ie) === null) continue;
    if (na && isNum(na.v) && na.v > 0 && base < 0.05 * na.v) continue;
    if (interestInBound(ie, base)) continue;
    const next = (alternates("interestExpense", p) || []).find((c) => c && isNum(c.v) && c.tag !== ie.tag && interestInBound(c, base));
    if (next) {
      p.values.interestExpense = { ...next, note: `${ie.tag} ${ie.v} annualises outside 1-20% of debt; next ladder step used` };
      continue;
    }
    flagOnce(flags, { end: p.end, key: "interestExpense", tag: ie.tag, value: ie.v, debt: base,
                      reason: "interest annualises outside 1-20% of debt on every ladder step; left empty" });
    p.values.interestExpense = null;
  }
}

/* A NAV per share at or below zero is not a NAV; an asset coverage
   above 20 was tagged in percent (every real ratio is 1.5-4). */
function guardInstants(periods, flags) {
  for (const p of periods) {
    const nav = p.values.navPerShare, ac = p.values.assetCoverage;
    if (nav && isNum(nav.v) && nav.v <= 0) {
      flagOnce(flags, { end: p.end, key: "navPerShare", tag: nav.tag, value: nav.v, reason: "NAV per share at or below zero; left empty" });
      p.values.navPerShare = null;
    }
    if (ac && isNum(ac.v) && ac.v > 20) {
      p.values.assetCoverage = { ...ac, v: roundUnit(ac.v / 100, "pure"), tagged: ac.v,
                                 note: "tagged in percent; divided by 100" };
    }
  }
}

/* A differenced or derived flow that should be positive: negative it is
   a comparative on another basis, not a quarter; zero the same, unless
   the filer never pays it (SuRo and Firsthand declare no dividend, and
   a zero is their figure); outside the concept's band of the fiscal
   year's other quarters (at least two of them; one is enough to judge a
   derived fourth quarter, which is where a mixed pair lands) it is the
   same mistake with the sign intact. */
function guardDerived(periods, flags) {
  const byFy = new Map();
  for (const p of periods) {
    if (!byFy.has(p.fy)) byFy.set(p.fy, []);
    byFy.get(p.fy).push(p);
  }
  for (const c of Object.values(BDC_CONCEPTS)) {
    if (!c.positive) continue;
    const pays = periods.some((p) => p.values[c.key] && isNum(p.values[c.key].v) && p.values[c.key].v > 0);
    for (const p of periods) {
      const v = p.values[c.key];
      if (!v || !isNum(v.v) || !v.differenced) continue;
      if (v.v < 0 || (v.v === 0 && pays)) {
        flags.push({ end: p.end, key: c.key, tag: v.tag, value: v.v, periodType: v.periodType,
                     reason: v.v < 0 ? "differenced figure below zero for a positive flow; left empty"
                                     : "differenced figure of zero for a flow the filer pays in other quarters; left empty" });
        p.values[c.key] = null;
        continue;
      }
      const others = byFy.get(p.fy).filter((q) => q !== p && q.values[c.key] && isNum(q.values[c.key].v) && q.values[c.key].v > 0)
        .map((q) => q.values[c.key].v).sort((a, b) => a - b);
      if (others.length < (v.periodType === "derivedQ4" ? 1 : 2) || !c.band) continue;
      const med = median(others);
      if (v.v < c.band[0] * med || v.v > c.band[1] * med) {
        flags.push({ end: p.end, key: c.key, tag: v.tag, value: v.v, periodType: v.periodType, fiscalYearMedian: med,
                     reason: `differenced figure outside ${c.band[0]}-${c.band[1]} x the fiscal year's other quarters; left empty` });
        p.values[c.key] = null;
      }
    }
  }
}

/* Distributions per share. The dollars declared over weighted basic
   shares (the ladder's third step, dollarsOverShares; a fourth quarter
   over fourthQuarterShares), the common line or the total net of a
   tagged preferred dividend (PSEC's 92,123,000 for the quarter to
   2026-03-31 holds 26,702,000 of it, and 65,421,000 over 483,414,178
   shares is the 0.1353 of three monthly 0.045s), is the reference every
   tagged figure is held to, once it is itself inside the band of the
   fiscal year's other references (one outside it never judges a tagged
   figure and takes the quarter only where nothing is tagged):
     - above a quarter of NAV per share is not a dividend (TRIN tags
       12.27 against a 13.47 NAV);
     - below a quarter of the quarter's NII per share, or below 0.25% of
       NAV, for a filer that pays in other quarters is a component, not
       the dividend (TSLX's 10-Qs tag the supplemental alone: 0.02
       against 0.47 of NII per share and a 16.88 NAV; a RIC distributes
       at least 90% of its taxable income, so no real quarter pays a
       tenth of it);
     - a difference whose subtracted row was such a component is a mixed
       derivation (TSLX's 2.10 for 2023 less a nine-month 0.03; HTGC's
       1.55 for 2021 less a nine-month 0.09);
     - a derived fourth quarter more than a quarter away from the dollars
       over shares tries the other row pair, then yields to the dollars
       (HTGC's 1.46 against 46,432,000 over the fourth quarter's shares);
       with no dollars to judge by, the pair inside half to twice the
       fiscal year's other quarters answers where only one is (MSIF's
       1.45 for 2024 less a pre-split nine-month 0.54 is 0.91; less the
       restated 1.09 it is 0.36, beside quarters of 0.37);
     - one below a fifth of the dollars over shares is a component and
       the dollars answer.
   A rejected figure is emptied and flagged and the dollars over shares
   take the quarter where they exist; with no dollars the quarter is
   left empty (blueprint 4.2 step 4: the market feed's trailing figure). */
const DISTRIBUTION_COMPONENT = { ofNii: 0.25, ofNav: 0.0025 };
const DISTRIBUTION_Q4_TOLERANCE = 0.25;
const DISTRIBUTION_PAIR_BAND = [0.5, 2];
const quartersBetween = (start, end) => {
  const months = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1;
  return Math.max(1, Math.round(months / 3));
};

/* The dollars declared over weighted basic shares, the ladder's third
   step. The common-only line answers where the filer tags one; else
   InvestmentCompanyDividendDistribution, which holds the preferred
   dividend for some filers (PSEC's 92,123,000 for the quarter to
   2026-03-31 holds 26,702,000 of it) and not others (FRBP's 11,116,000
   for the quarter to 2023-12-31 is common alone, 0.4365 over 25,464,652
   shares against the tagged 0.43): where a preferred dividend is tagged
   on the span, the gross and net figures are both taken and the one
   nearer the filer's own per-share figure (`tagged`) answers; with no
   per-share figure to judge by the net one does, the note saying so. */
function dollarsOverShares(p, helpers, tagged) {
  const common = p.values.distributionsCommon, dollars = p.values.distributionsDollars, pref = p.values.preferredDividends;
  const source = common && isNum(common.v) && common.v > 0 ? common : dollars;
  if (!source || !isNum(source.v)) return null;
  let sh = p.values.weightedShares, estimate = null;
  if (!(sh && isNum(sh.v) && sameSpan(source, sh)) && p.fq === 4 && source.differenced && helpers.fourthQuarterShares) {
    const est = helpers.fourthQuarterShares(p);
    if (est) { sh = { ...est, start: source.start, end: source.end }; estimate = est.estimate; }
  }
  if (!sh || !isNum(sh.v) || sh.v <= 0 || !sameSpan(source, sh)) return null;
  const base = { ...source, unit: "USD/shares", step: 3, derived: "dollars-over-shares", ...(estimate ? { sharesEstimate: estimate } : {}) };
  if (source === common) {
    return { ...base, v: roundUnit(common.v / sh.v, "USD/shares"), tag: common.tag + "/" + sh.tag,
             note: "common dividends declared over weighted basic shares" };
  }
  const gross = { ...base, v: roundUnit(dollars.v / sh.v, "USD/shares"), tag: dollars.tag + "/" + sh.tag,
                  note: "dollars declared over weighted basic shares" };
  if (!(pref && isNum(pref.v) && pref.v > 0 && sameSpan(pref, dollars))) return gross;
  const net = { ...base, v: roundUnit((dollars.v - pref.v) / sh.v, "USD/shares"), tag: dollars.tag + "-" + pref.tag + "/" + sh.tag,
                preferredDividends: pref.v, note: "dollars declared less the preferred dividend, over weighted basic shares" };
  if (tagged && isNum(tagged.v) && tagged.v > 0) {
    return Math.abs(gross.v - tagged.v) <= Math.abs(net.v - tagged.v)
      ? { ...gross, note: gross.note + "; the filer's dollars are common alone, judged against its per-share figure" }
      : { ...net, note: net.note + "; judged against the filer's per-share figure" };
  }
  return { ...net, note: net.note + "; inferred, the filer tags no common-only line or per-share figure to judge by" };
}

function guardDistributions(periods, flags, alternates, helpers = {}) {
  const byEnd = new Map(periods.map((p) => [p.end, p]));
  const nav = (p) => (p && p.values.navPerShare && isNum(p.values.navPerShare.v) && p.values.navPerShare.v > 0 ? p.values.navPerShare.v : null);
  /* a per-share figure over the `quarters` quarters ending at `end` is
     a component when below a quarter of the NII per share summed over
     them (every one known and the sum positive) or below 0.25% of NAV
     at the end per quarter */
  const component = (v, end, quarters) => {
    if (!isNum(v) || v <= 0) return false;
    const qs = [...Array(quarters)].map((_, i) => byEnd.get(shiftMonthEnd(end, -3 * i)));
    const known = qs.every((q) => q && q.values.niiPerShare && isNum(q.values.niiPerShare.v));
    const nii = known ? qs.reduce((a, q) => a + q.values.niiPerShare.v, 0) : null;
    if (nii !== null && nii > 0 && v < DISTRIBUTION_COMPONENT.ofNii * nii) return true;
    const n = nav(byEnd.get(end));
    return n !== null && v < DISTRIBUTION_COMPONENT.ofNav * n * quarters;
  };
  const reference = new Map(periods.map((p) => [p.end, dollarsOverShares(p, helpers, p.values.distributionsPerShare)]));
  /* a filer that pays: some quarter, tagged or in dollars, above the
     NAV floor; SuRo and Firsthand declare nothing and their zeros stand */
  const pays = periods.some((p) => {
    const n = nav(p);
    return [p.values.distributionsPerShare, reference.get(p.end)].some((v) => v && isNum(v.v) && v.v > 0 && (!n || v.v >= DISTRIBUTION_COMPONENT.ofNav * n));
  });
  const siblings = (p) => periods.filter((q) => q.fy === p.fy && q !== p && q.values.distributionsPerShare && isNum(q.values.distributionsPerShare.v) &&
    q.values.distributionsPerShare.v > 0).map((q) => q.values.distributionsPerShare.v);
  /* the other references of the fiscal year, dollars against dollars,
     so a tagged figure this guard has yet to judge (HTGC's 1.46 for
     the fourth quarter of 2021) never sets the bar for a reference */
  const siblingRefs = (p) => periods.filter((q) => q.fy === p.fy && q !== p && reference.get(q.end) && reference.get(q.end).v > 0)
    .map((q) => reference.get(q.end).v);
  const reject = (p, dps, reason, extra) => {
    flags.push({ end: p.end, key: "distributionsPerShare", tag: dps.tag, value: dps.v, periodType: dps.periodType, ...(extra || {}), reason });
    p.values.distributionsPerShare = null;
  };
  for (const p of periods) {
    const dps = p.values.distributionsPerShare, n = nav(p);
    /* a reference outside the band of the fiscal year's other references
       is suspect itself (GBDC's year of dollars less its nine months
       gives 0.0997 against quarters of 0.39; RAND's 4.20 against 0.29)
       and never rejects a tagged figure; with no tagged figure it still
       takes the quarter, flagged, and the derived-flow guard below
       empties it where it is a difference outside the band */
    const fallback = reference.get(p.end);
    const med = median(siblings(p));
    const refMed = median(siblingRefs(p));
    let ref = fallback;
    if (ref && refMed !== null && !inBand(ref.v, refMed, BDC_CONCEPTS.distributionsPerShare.band)) {
      flags.push({ end: p.end, key: "distributionsPerShare", tag: ref.tag, value: ref.v, periodType: ref.periodType, fiscalYearMedian: refMed,
                   reason: "dollars declared over shares outside 0.4-5 x the fiscal year's other quarters of dollars over shares; not used to judge a tagged figure" });
      ref = null;
    }
    if (dps && isNum(dps.v) && dps.step !== 3) {
      const basis = dps.basis || {};
      if (n !== null && dps.v > 0.25 * n) {
        reject(p, dps, "above a quarter of NAV per share; not a dividend; left empty", { navPerShare: n });
      } else if (pays && dps.differenced && basis.lessEnd && isNum(basis.less) && component(basis.less, basis.lessEnd, quartersBetween(basis.ytdStart, basis.lessEnd))) {
        reject(p, dps, "a difference from a year-to-date row that is a component, not the dividend (below a quarter of NII per share or 0.25% of NAV over its span); left empty",
               { less: basis.less, lessEnd: basis.lessEnd });
      } else if (pays && component(dps.v, p.end, 1)) {
        reject(p, dps, "below a quarter of the quarter's NII per share or 0.25% of NAV for a filer that pays in other quarters; a component, not the dividend; left empty",
               { niiPerShare: p.values.niiPerShare ? p.values.niiPerShare.v : null, navPerShare: n });
      } else if (dps.periodType === "derivedQ4" && ref && Math.abs(dps.v - ref.v) > DISTRIBUTION_Q4_TOLERANCE * Math.abs(ref.v)) {
        const other = helpers.otherPair ? helpers.otherPair("distributionsPerShare", p) : null;
        if (other && isNum(other.v) && Math.abs(other.v - ref.v) <= DISTRIBUTION_Q4_TOLERANCE * Math.abs(ref.v)) {
          flags.push({ end: p.end, key: "distributionsPerShare", tag: dps.tag, value: dps.v, other: other.v, dollarsOverShares: ref.v,
                       reason: "derived fourth quarter from the preferred row pair more than a quarter from the dollars declared over shares; the other pair reconciles and is used" });
          p.values.distributionsPerShare = { ...other, note: "the preferred row pair is more than a quarter from the dollars declared over shares; the other pair reconciles" };
        } else {
          reject(p, dps, "derived fourth quarter more than a quarter from the dollars declared over shares on either row pair; dollars over shares used", { dollarsOverShares: ref.v });
        }
      } else if (dps.periodType === "derivedQ4" && !ref && helpers.otherPair) {
        const other = helpers.otherPair("distributionsPerShare", p);
        if (other && isNum(other.v) && Math.abs(other.v - dps.v) > DISTRIBUTION_Q4_TOLERANCE * Math.abs(dps.v) && med !== null &&
            !inBand(dps.v, med, DISTRIBUTION_PAIR_BAND) && inBand(other.v, med, DISTRIBUTION_PAIR_BAND)) {
          flags.push({ end: p.end, key: "distributionsPerShare", tag: dps.tag, value: dps.v, other: other.v, fiscalYearMedian: med,
                       reason: "derived fourth quarter from the preferred row pair outside half to twice the fiscal year's other quarters while the other pair is inside; the other pair used" });
          p.values.distributionsPerShare = { ...other, note: "row pair chosen against the fiscal year's other quarters" };
        }
      } else if (ref && dps.v < 0.2 * ref.v) {
        reject(p, dps, "below a fifth of dollars declared over weighted shares; a component, not the dividend; dollars over shares used", { dollarsOverShares: ref.v });
      }
    }
    if (!p.values.distributionsPerShare && fallback) p.values.distributionsPerShare = fallback;
  }
}

/* An externally managed filer (a management fee tagged) with no
   incentive-fee fact for the quarter is flagged, never zero. */
function guardIncentiveFee(periods, flags) {
  for (const p of periods) {
    const mf = p.values.managementFee;
    if (mf && isNum(mf.v) && mf.v > 0 && !p.values.incentiveFeeIncome) {
      flags.push({ end: p.end, key: "incentiveFeeIncome", tag: null,
                   reason: "no incentive-fee fact under either tag for an externally managed filer; left empty" });
    }
  }
}

/* shares first, so dollars over shares never uses a count on the wrong
   scale; distributions before the band, so a figure that is not a
   dividend (TPVG's 360) never sets the fiscal year's median */
function runGuards(periods, flags, alternates, helpers = {}) {
  guardShares(periods, flags);
  guardDebt(periods, flags, alternates, helpers);
  guardPortfolio(periods, flags);
  guardInterest(periods, flags, alternates);
  guardInstants(periods, flags);
  guardDistributions(periods, flags, alternates, helpers);
  guardDerived(periods, flags);
}

/* the latest pointer follows whatever the guards left */
function relatest(series) {
  const latest = {};
  const kept = series.periods;
  for (const key of Object.keys(BDC_CONCEPTS)) {
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i].values[key]) { latest[key] = { ...kept[i].values[key], fy: kept[i].fy, fq: kept[i].fq }; break; }
    }
  }
  series.latest = latest;
}

/**
 * Build the quarterly series for one BDC from its companyfacts facts
 * object ({ "us-gaap": {...}, "dei": {...} }; the whole feed from
 * fetchCompanyFactsRaw is accepted too).
 *
 * fyEndMonth is required: the month the filer closes its year, 1-12,
 * from the submissions JSON. It is never inferred here: the inference
 * in statements.mjs reads revenue periods, which a BDC does not tag.
 *
 * Returns { periods, latest, firstPeriod, fyEndMonth, coverShares,
 * niiLadder, flags } (niiLadder only where a step of the NII ladder is
 * skipped for the filer). Periods are labelled by calendar period end
 * (YYYY-MM-DD) with the fiscal year and quarter recorded beside the
 * label, sorted oldest first, within the last `limit` (32) quarter
 * ends; firstPeriod names each concept's earliest period end, before
 * the window is applied. Every value carries { v, unit, tag, periodType,
 * start, end, form, filed, accn, source }.
 */
export function buildBdcSeries(bucket, { fyEndMonth, limit = 32 } = {}) {
  if (!Number.isInteger(fyEndMonth) || fyEndMonth < 1 || fyEndMonth > 12) {
    throw new Error("buildBdcSeries needs fyEndMonth (1-12) from the submissions JSON");
  }
  const facts = bucket && bucket.facts && bucket.facts["us-gaap"] ? bucket.facts : bucket;
  const gaap = (facts && facts["us-gaap"]) || {};
  const dei = (facts && facts.dei) || null;
  const flags = [];

  const steps = {};
  for (const c of Object.values(BDC_CONCEPTS)) steps[c.key] = resolveSteps(gaap, c);

  /* Which quarters exist: every end at which net investment income was
     reported over any span, plus every end at which a core instant was
     reported. A 10-K's year end is a quarter end whether or not the
     fourth quarter can be derived; a cover-page date is not. */
  const anchorSet = new Set();
  for (const shape of steps[NII_KEY]) {
    for (const cls of ["3M", "6M", "9M", "12M"]) for (const end of shape[cls].keys()) anchorSet.add(end);
  }
  for (const key of ANCHOR_INSTANTS) {
    for (const shape of steps[key]) for (const end of shape.instant.keys()) anchorSet.add(end);
  }
  const anchors = [...anchorSet].filter((end) => {
    if (isMonthEnd(end)) return true;
    flags.push({ end, key: null, reason: "period end is not a month end; skipped" });
    return false;
  }).sort();

  /* every ladder step's answer for a quarter, in ladder order */
  const memo = new Map();
  const candidatesOf = (concept, end, fq, m) =>
    steps[concept.key].map((shape, i) => quarterValue(shape, concept, i + 1, end, fq, quarterOf(concept), m));
  const quarterOf = (concept) => (end, fq, m) => {
    const k = concept.key + "|" + end;
    if (m.has(k)) return m.get(k);
    let v = null;
    for (let i = 0; i < steps[concept.key].length && !v; i++) {
      v = quarterValue(steps[concept.key][i], concept, i + 1, end, fq, quarterOf(concept), m);
    }
    m.set(k, v);
    return v;
  };
  const instantCandidates = (concept, end) =>
    steps[concept.key].map((shape, i) => {
      const hit = nearest(shape.instant, end, 5);
      return hit ? fromRow(hit, "instant", concept, i + 1) : null;
    });
  const instantOf = (concept, end) => instantCandidates(concept, end).find(Boolean) || null;

  /* The NII ladder's answer for one quarter, once the quarter's other
     concepts have answered: the first step the filer's ladder does not
     skip, checked against the per-share fact — the difference from the
     preferred row pair, then from the other pair — and the weighted
     shares, or the net-increase identity; each step carries the other
     rows' figure as its alternate; every step's verdict comes back for
     the settlement. A derived fourth quarter has no share count of its
     own, so it is checked against fourthQuarterShares at the derived
     tolerance, and its flag says so. The memo is updated so a later
     quarter summing this one sees the settled value. */
  const nii = BDC_CONCEPTS[NII_KEY], perShareConcept = BDC_CONCEPTS.niiPerShare;
  const byEnd = new Map();
  const priorQuarters = (p) => [3, 2, 1].map((back) => byEnd.get(shiftMonthEnd(p.end, -3 * back)) || null);
  const reconcileNii = (p, skip) => {
    const primary = p.values.niiPerShare;
    const other = primary && primary.differenced
      ? quarterValue(steps[perShareConcept.key][0], perShareConcept, 1, p.end, p.fq, quarterOf(perShareConcept), memo,
                     { preferOriginal: primary.basis.rows !== "original" })
      : null;
    const perShare = other && other.basis.rows !== primary.basis.rows && other.v !== primary.v ? [primary, other] : [primary];
    const candidates = candidatesOf(nii, p.end, p.fq, memo).map((c, i) => {
      if (!c || skip.has(i + 1)) return null;
      const alt = quarterValue(steps[nii.key][i], nii, i + 1, p.end, p.fq, quarterOf(nii), memo, { otherRows: true });
      return alt && isNum(alt.v) && alt.v !== c.v ? { ...c, alternate: alt } : c;
    }).filter(Boolean);
    /* the quarter's own count where it is on the candidate's span; a
       fourth quarter's estimate otherwise */
    const first = candidates[0];
    let shares = p.values.weightedShares, tolerance = null;
    if (first && p.fq === 4 && !(shares && sameSpan(shares, first))) {
      const est = fourthQuarterShares(p, priorQuarters(p));
      shares = est ? { ...est, start: first.start, end: first.end } : null;
      tolerance = NII_DERIVED_TOLERANCE;
    }
    const picked = chooseNii(candidates, {
      perShare, shares, ...(tolerance ? { tolerance } : {}), preferred: p.values.preferredDividends,
      realized: p.values.realizedGains, unrealized: p.values.unrealizedGains, netIncrease: p.values.netIncreaseInNetAssets,
    });
    const v = picked.value;
    const passed = v ? [...skip].filter((s) => s < (v.step || 1)) : [];
    if (passed.length) v.note = niiSkipNote(v, passed, passed.map((s) => tagName(nii.tags[s - 1])));
    p.values[NII_KEY] = v;
    memo.set(NII_KEY + "|" + p.end, v);
    if (picked.perShare && picked.perShare !== primary) {
      p.values.niiPerShare = { ...picked.perShare, note: "row pair chosen by the NII cross-check" };
      memo.set(perShareConcept.key + "|" + p.end, p.values.niiPerShare);
    }
    if (picked.sharesFlag) {
      flagOnce(flags, { end: p.end, key: "weightedShares", ...picked.sharesFlag });
      p.values.weightedShares = null;
    }
    return { ...picked, shares };
  };

  const periods = anchors.map((end) => {
    const fy = bdcFiscalYear(end, fyEndMonth);
    const fq = fiscalQuarterFor(end, fyEndMonth, null);
    const values = {};
    for (const c of Object.values(BDC_CONCEPTS)) {
      values[c.key] = c.kind === "instant" ? instantOf(c, end) : quarterOf(c)(end, fq, memo);
    }
    return { end, fy, fq, values };
  });
  for (const p of periods) byEnd.set(p.end, p);
  /* a share count on the wrong scale is emptied before it can fail the
     NII cross-check on the NII's behalf */
  guardShares(periods, flags);

  /* two passes: every quarter against the whole ladder to collect the
     verdicts, then, where a step is settled as skipped for this filer,
     every quarter again without it */
  let niiFlags = [];
  const q4Shares = new Map();
  const pass = (skip) => {
    niiFlags = [];
    const verdicts = [];
    for (const p of periods) {
      const byTag = skip.size ? null : tagVerdict(candidatesOf(nii, p.end, p.fq, memo));
      if (byTag) verdicts.push(byTag);
      const picked = reconcileNii(p, skip);
      if (picked.shares && picked.shares.estimate) q4Shares.set(p.end, picked.shares);
      if (picked.flag) niiFlags.push({ end: p.end, key: NII_KEY, ...picked.flag });
      /* a verdict at the derived tolerance over an estimated count is
         too loose to settle the ladder on: only quarters with their own
         count vote */
      if (picked.verdicts.length && !(picked.shares && picked.shares.estimate)) verdicts.push(picked.verdicts);
    }
    return verdicts;
  };
  const skipped = settleNiiLadder(pass(new Set()));
  if (skipped.length) pass(new Set(skipped.map((s) => s.step)));
  const niiLadder = skipped.length ? {
    skipped: skipped.map((s) => ({
      ...s, tag: tagName(nii.tags[s.step - 1]),
      reason: "rejected by the cross-check in at least two quarters and never confirmed; skipped in every quarter",
    })),
  } : null;

  /* A derived fourth quarter that reconciles with nothing is judged
     against the quarters either side of it: the dollars outside a
     quarter to four times both neighbours are the wrong line (Oxford
     Square's 2023 10-K carries the swapped 51,824,181, a fourth quarter
     of 32,228,798 between quarters of 6,438,818 and 6,537,556) and are
     emptied; the dollars inside the band of either are kept, and NII
     over the estimated count takes the place of the derived per-share
     figure, which is a difference of two year-to-date figures that
     failed (Horizon's 1.55 for the quarter to 2021-12-31, from a
     nine-month comparative on another basis; Chicago Atlantic's 0.68
     for the quarter it quadrupled its share count, where 7,990,681
     over 22,729,629 is 0.35). The quarter after counts as well as the
     quarter before, since a filer that grew in its fourth quarter
     (Chicago Atlantic's acquisition) looks like the quarter after it.
     With the dollars emptied the per-share figure stands only inside
     the same band, flagged as unverified. */
  const NII_Q4_BAND = [0.25, 4];
  const neighbours = (p, key) => {
    const i = periods.indexOf(p);
    return [periods[i - 1], periods[i + 1]].filter((q) => q && q.values[key] && isNum(q.values[key].v)).map((q) => q.values[key].v);
  };
  const nearBand = (v, list) => list.some((ref) => inBand(v, ref, NII_Q4_BAND));
  for (const f of niiFlags.filter((x) => x.basis === "perShare" && x.sharesEstimate)) {
    const p = byEnd.get(f.end);
    const n = p.values[NII_KEY], ps = p.values.niiPerShare, est = q4Shares.get(p.end);
    if (!n || !ps || !est) { flags.push({ end: p.end, key: NII_KEY, ...f }); continue; }
    const niiOk = !n.differenced || nearBand(n.v, neighbours(p, NII_KEY));
    if (!niiOk) {
      flags.push({ end: p.end, key: NII_KEY, tag: n.tag, value: n.v, perShare: ps.v, shares: est.v, sharesEstimate: est.estimate,
                   implied: f.implied, neighbours: neighbours(p, NII_KEY),
                   reason: "derived fourth quarter reconciles with the per-share figure on neither row pair and sits outside a quarter to four times the quarters either side; left empty" });
      p.values[NII_KEY] = null;
      memo.set(NII_KEY + "|" + p.end, null);
    } else {
      flags.push({ end: p.end, key: NII_KEY, ...f });
    }
    if (!ps.differenced) continue;
    if (niiOk) {
      flags.push({ end: p.end, key: "niiPerShare", tag: ps.tag, value: ps.v, nii: n.v, shares: est.v, sharesEstimate: est.estimate,
                   implied: roundUnit(n.v / est.v, "USD/shares"),
                   reason: "a difference of two rows that fails the NII cross-check on either pair; NII over the estimated fourth-quarter shares served in its place" });
      p.values.niiPerShare = { ...niiOverShares(n, est, ps), sharesEstimate: est.estimate,
                               note: "NII over the estimated fourth-quarter share count; the derived NII per share failed the cross-check" };
    } else if (nearBand(ps.v, neighbours(p, "niiPerShare"))) {
      flags.push({ end: p.end, key: "niiPerShare", tag: ps.tag, value: ps.v, neighbours: neighbours(p, "niiPerShare"),
                   reason: "derived fourth quarter kept unverified: the NII it should reconcile to was emptied; inside a quarter to four times a quarter beside it" });
      p.values.niiPerShare = { ...ps, crossCheck: { basis: "perShare", reconciles: false, unverified: true } };
    } else {
      flags.push({ end: p.end, key: "niiPerShare", tag: ps.tag, value: ps.v, neighbours: neighbours(p, "niiPerShare"),
                   reason: "derived fourth quarter reconciles with nothing and sits outside a quarter to four times the quarters either side; left empty" });
      p.values.niiPerShare = null;
    }
    memo.set(perShareConcept.key + "|" + p.end, p.values.niiPerShare);
  }
  flags.push(...niiFlags.filter((f) => !(f.basis === "perShare" && f.sharesEstimate)));

  /* A per-share figure the check rejected is not served as NII per
     share where it is a difference of two rows (the quarter's per-share
     figure is not the difference of two year-to-date ones once the
     share count moved: RWAY's 18,191,000 over 42,074,771 is 0.43), or
     where the filer's per-share tag is off by a large gap in two or
     more quarters (SuRo's is its change in net assets per share; the
     settlement rule the ladder uses). A filer-reported three-month fact
     a cent or two from NII over shares is the filer's figure — a
     rounding, or a per-common-share figure after a preferred dividend
     the feed does not carry — and is kept with the implied figure
     recorded beside it. NII over weighted shares takes the place of a
     substituted figure, flagged, with the rejected figure beside it. */
  const perShareFails = niiFlags.filter((f) => f.basis === "perShare" && !f.sharesEstimate);
  const tagUnsettled = perShareFails.filter((f) => largeGap(f.perShare, f.implied)).length >= NII_SKIP_MIN_QUARTERS;
  for (const f of perShareFails) {
    const p = periods.find((q) => q.end === f.end);
    const ps = p.values.niiPerShare, n = p.values[NII_KEY], sh = p.values.weightedShares;
    if (!ps || !n || !sh) continue;
    if (!(ps.differenced || tagUnsettled)) {
      p.values.niiPerShare = { ...ps, crossCheck: { basis: "nii", nii: n.v, shares: sh.v, implied: f.implied, reconciles: false } };
      continue;
    }
    flags.push({ end: p.end, key: "niiPerShare", tag: ps.tag, value: ps.v, nii: n.v, shares: sh.v, implied: f.implied,
                 reason: (ps.differenced ? "a difference of two rows that " : "the filer's per-share tag ") +
                   "fails the NII cross-check; NII over weighted shares served in its place" });
    p.values.niiPerShare = niiOverShares(n, sh, ps);
  }

  /* where each concept's history starts, before the window is applied,
     so the page can say how far back a series reaches (blueprint 4.2:
     every series states its first period); a quarter the guards fill
     by derivation (distributions as dollars over shares) can start a
     series before its tag does, so the kept quarters are folded in
     after the guards below */
  const firstPeriod = {};
  const noteFirst = (list) => {
    for (const p of list) {
      for (const [key, v] of Object.entries(p.values)) if (v && !(firstPeriod[key] <= p.end)) firstPeriod[key] = p.end;
    }
  };
  noteFirst(periods);

  /* The window is counted in quarter ends from the newest period, so a
     tag history that thins out into annual-only points before 2021 does
     not stretch eight years of quarters into a decade of gaps. */
  const withValues = periods.filter((p) => Object.values(p.values).some((v) => v));
  const newest = withValues.length ? withValues[withValues.length - 1].end : null;
  const cutoff = newest ? shiftMonthEnd(newest, -3 * (limit - 1)) : null;
  const kept = withValues.filter((p) => !cutoff || p.end >= cutoff).slice(-limit);

  /* the guards run on the quarters that are kept, so a flag is never
     raised for a quarter the file does not carry */
  const alternates = (key, p) => {
    const c = BDC_CONCEPTS[key];
    return c.kind === "instant" ? instantCandidates(c, p.end) : candidatesOf(c, p.end, p.fq, memo);
  };
  /* the other row pair of a differenced value, from the step that
     answered, for the distributions guard; the fourth quarter's share
     estimate for the dollars over shares */
  const otherPair = (key, p) => {
    const c = BDC_CONCEPTS[key], v = p.values[key];
    if (!v || !v.differenced || !v.basis || v.basis.lessQuarters) return null;
    return quarterValue(steps[key][(v.step || 1) - 1], c, v.step || 1, p.end, p.fq, quarterOf(c), memo, { otherRows: true });
  };
  runGuards(kept, flags, alternates, { otherPair, allPeriods: periods, fourthQuarterShares: (p) => fourthQuarterShares(p, priorQuarters(p)) });
  guardIncentiveFee(kept, flags);
  noteFirst(kept);

  /* the checks that ran before the window (shares, NII) flag every
     quarter; only the kept quarters' flags are served, plus the
     skipped period ends, which name no quarter */
  const keptEnds = new Set(kept.map((p) => p.end));
  const series = { periods: kept, latest: {}, firstPeriod, fyEndMonth, coverShares: dei ? coverShares(dei) : null,
                   ...(niiLadder ? { niiLadder } : {}),
                   flags: flags.filter((f) => !f.key || keptEnds.has(f.end)) };
  relatest(series);
  return series;
}


/**
 * Frames can run ahead of companyfacts by weeks (ARCC's Q2 2026 was in
 * frames on the morning of 2026-09-10 and in companyfacts that evening).
 * Given the frame replies for this filer's concepts, a period newer than
 * anything companyfacts holds for that concept is added or filled from
 * the frame row, with source "frames"; an equal or older period keeps
 * its companyfacts value. A frame row has no form or filed date, so
 * those stay null.
 *
 * entries: [{ key, payload, flag }] where payload is a fetchFrame reply
 * (or null) and cik picks this filer's row out of the frame. Several
 * entries for one key are that key's ladder in order: the first answers,
 * the rest are the alternates the guards fall through to. An entry's
 * `flag` (the NII cross-check's verdict, from refresh-bdc.mjs) is kept
 * when its value is; a payload's `step`, `note`, `crossCheck`, `derived`
 * and `rejected` travel onto the value (the last two mark NII over
 * shares served for a rejected per-share fact).
 */
export function mergeFrames(series, entries, { cik, limit = 32 } = {}) {
  if (!series || !Array.isArray(entries)) return series;
  if (!Array.isArray(series.flags)) series.flags = [];
  if (!series.firstPeriod) series.firstPeriod = {};
  const wantCik = Number(cik);
  const merged = new Set(), seen = new Set();
  const spare = new Map();
  for (const { key, payload, flag } of entries) {
    const concept = BDC_CONCEPTS[key];
    if (!concept) continue;
    /* an entry with a flag and no payload is a frame value the refresh
       refused (a share count on the wrong scale): the flag is kept for
       the quarter unless companyfacts already serves the key there */
    if (!payload) {
      const period = flag && flag.end ? series.periods.find((p) => p.end === flag.end) : null;
      if (flag && flag.end && !(period && period.values[key])) series.flags.push({ end: flag.end, key, ...flag });
      continue;
    }
    if (!Array.isArray(payload.data)) continue;
    if (payload.uom && payload.uom !== concept.unit) {
      series.flags.push({ end: null, key, reason: `frame unit ${payload.uom} is not ${concept.unit}; ignored` });
      continue;
    }
    const row = payload.data.find((r) => Number(r.cik) === wantCik);
    if (!row || typeof row.val !== "number" || !row.end) continue;
    const cls = spanClass(row);
    if (concept.kind === "instant" ? cls !== "instant" : cls !== "3M") continue;
    const value = {
      v: row.val, unit: concept.unit, tag: payload.tag || concept.tags.find((t) => typeof t === "string"),
      periodType: cls === "instant" ? "instant" : "3M",
      start: row.start || null, end: row.end, form: null, filed: null, accn: row.accn || null,
      source: "frames", frame: payload.ccp || null,
      ...(payload.step > 1 ? { step: payload.step } : {}),
      ...(payload.note ? { note: payload.note } : {}),
      ...(payload.crossCheck ? { crossCheck: payload.crossCheck } : {}),
      ...(payload.derived ? { derived: payload.derived } : {}),
      ...(payload.rejected ? { rejected: payload.rejected } : {}),
    };
    /* a later entry for the same key and end is an alternate: kept for
       the guards where the first was merged, ignored where it was not */
    const k = key + "|" + row.end;
    if (seen.has(k)) {
      if (merged.has(k)) {
        if (!spare.has(k)) spare.set(k, []);
        spare.get(k).push(value);
      }
      continue;
    }
    seen.add(k);
    const have = series.latest[key];
    if (have && have.end >= row.end) {
      if (have.end === row.end && Math.abs(have.v - row.val) > Math.abs(have.v || 1) * 0.005) {
        series.flags.push({ end: row.end, key, reason: "frames and companyfacts disagree; companyfacts kept",
                            companyfacts: have.v, frames: row.val });
      }
      continue;
    }
    let period = series.periods.find((p) => p.end === row.end);
    if (!period) {
      period = { end: row.end, fy: bdcFiscalYear(row.end, series.fyEndMonth),
                 fq: fiscalQuarterFor(row.end, series.fyEndMonth, null), values: {} };
      for (const k of Object.keys(BDC_CONCEPTS)) period.values[k] = null;
      series.periods.push(period);
      series.periods.sort((a, b) => String(a.end).localeCompare(String(b.end)));
      if (series.periods.length > limit) series.periods.splice(0, series.periods.length - limit);
    }
    period.values[key] = value;
    merged.add(k);
    if (flag) series.flags.push({ end: row.end, key, ...flag });
    series.latest[key] = { ...value, fy: period.fy, fq: period.fq };
    if (!series.firstPeriod[key]) series.firstPeriod[key] = row.end;
  }
  /* a figure the frames added is bounded like one from companyfacts;
     only the periods the frames touched are re-run, so a quarter the
     builder already judged is not flagged twice */
  if (merged.size) {
    const ends = new Set([...merged].map((k) => k.split("|")[1]));
    const byEnd = new Map(series.periods.map((p) => [p.end, p]));
    runGuards(series.periods.filter((p) => ends.has(p.end)), series.flags,
      (key, p) => spare.get(key + "|" + p.end) || [],
      { allPeriods: series.periods,
        fourthQuarterShares: (p) => fourthQuarterShares(p, [3, 2, 1].map((back) => byEnd.get(shiftMonthEnd(p.end, -3 * back)) || null)) });
    relatest(series);
  }
  return series;
}

/* ---------- classification rules for the schedule of investments ----------
 *
 * Used by the holdings PR. The lien map is credit.js's, re-exported so
 * the holdings build imports one vocabulary from one place; affiliation
 * and the vehicle test live here beside the concept map. The raw label
 * always travels with the classified one. */

export const LIEN = RTCredit.LIEN;
export const lienClass = RTCredit.lienClass;
export const isFirstLien = RTCredit.isFirstLien;

/* InvestmentIssuerAffiliationAxis member text, "Issuer name | affiliation". */
export const AFFILIATION_CLASSES = ["non-controlled/non-affiliated", "non-controlled affiliated", "controlled"];

/* The three classes of section 2(a)(9) and Rule 12-14 in every
   spelling the schedules print: the axis members ("Non-Affiliated
   Issuer", "Investment, Affiliated Issuer, Noncontrolled",
   "Unaffiliated"), BXSL's "non-controlled/non-affiliated", MAIN's and
   PSEC's "Control Investments" / "Affiliate Investments" /
   "Non-Control/Non-Affiliate Investments", FDUS's "Non-control/Non-
   affiliate Investments" member prefix, GAIN's "NON-CONTROL/NON-
   AFFILIATE INVESTMENTS", BCIC's "Investments in Non-Control ...",
   Saratoga's "Affiliate investments". The unaffiliated tests run
   first: "Non-Affiliated" carries the word "affiliated". A bare
   "Investments" or a company name says nothing and returns null. */
export function classifyAffiliation(text) {
  const t = text == null ? "" : String(text).toLowerCase().replace(/\s+/g, " ");
  if (!/control|affiliat/.test(t)) return null;
  if (/unaffiliat/.test(t) || /non[\s-]*affiliat/.test(t)) return "non-controlled/non-affiliated";
  if (/non[\s-]*control/.test(t)) return /affiliat/.test(t) ? "non-controlled affiliated" : "non-controlled/non-affiliated";
  if (/\bcontrol(?:led)?\b|controlled/.test(t)) return "controlled";
  if (/affiliat/.test(t)) return "non-controlled affiliated";
  return null;
}

/* Holdings that are vehicles rather than loans to an operating company:
   joint ventures, senior loan programs, an asset manager, CLO equity, a
   REIT, a filer's own lending vehicle or fund (OBDC's "Blue Owl Credit
   SLF LLC", NMFC's "Investment Fund" and "Net Lease" membership
   interests). Shown as a share of fair value; excluded from every
   third-party debt statistic. */
export const VEHICLE_PATTERN =
  /joint venture|\bJV\b|\bSLP\b|\bSLF\b|senior (direct )?lending program|senior (secured )?loan (program|fund)|\b(?:credit|lending|loan|investment|income|debt|opportunit(?:y|ies)) fund\b|\bnet lease\b|asset manage(ment|r)|\bCLO\b|collateralized loan|\bREIT\b|real estate investment trust/i;

export function isVehicle(text) {
  return VEHICLE_PATTERN.test(text == null ? "" : String(text));
}

/* ---------- mergers among listed BDCs since 2021 ----------
 *
 * For the chain-linked composite: across the closing quarter the target's
 * prior-quarter cost is added to the acquirer's base. Every row was read
 * on 2026-09-11 from the Item 2.01 8-K named in `source`; closeQuarter is
 * the calendar quarter end the closing falls in, the same label the
 * series uses. targetListed says whether the target itself traded; a
 * non-listed target still filed 10-Qs with the same tags. */
export const MERGERS = [
  { acquirer: "OCSL", acquirerCik: 1414932, target: "OCSI", targetCik: 1577791, targetName: "Oaktree Strategic Income Corporation", targetListed: true,
    closeDate: "2021-03-19", closeQuarter: "2021-03-31",
    source: "https://www.sec.gov/Archives/edgar/data/1577791/000119312521086898/d345330d8k.htm" },
  { acquirer: "PTMN", acquirerCik: 1372807, target: "HCAP", targetCik: 1559909, targetName: "Harvest Capital Credit Corporation", targetListed: true,
    closeDate: "2021-06-09", closeQuarter: "2021-06-30",
    source: "https://www.sec.gov/Archives/edgar/data/1372807/000119312521186945/d176074d8k.htm" },
  { acquirer: "FSK", acquirerCik: 1422183, target: "FSKR", targetCik: 1525759, targetName: "FS KKR Capital Corp. II", targetListed: true,
    closeDate: "2021-06-16", closeQuarter: "2021-06-30",
    source: "https://www.sec.gov/Archives/edgar/data/1422183/000119312521192219/d175618d8k.htm" },
  { acquirer: "BBDC", acquirerCik: 1379785, target: null, targetCik: 1523526, targetName: "Sierra Income Corporation", targetListed: false,
    closeDate: "2022-02-25", closeQuarter: "2022-03-31",
    source: "https://www.sec.gov/Archives/edgar/data/1379785/000114036122007670/ny20002465x3_8k.htm" },
  { acquirer: "SLRC", acquirerCik: 1418076, target: "SUNS", targetCik: 1508171, targetName: "SLR Senior Investment Corp.", targetListed: true,
    closeDate: "2022-04-01", closeQuarter: "2022-06-30",
    source: "https://www.sec.gov/Archives/edgar/data/1418076/000119312522092898/d296304d8k.htm" },
  { acquirer: "OCSL", acquirerCik: 1414932, target: null, targetCik: 1744179, targetName: "Oaktree Strategic Income II, Inc.", targetListed: false,
    closeDate: "2023-01-23", closeQuarter: "2023-03-31",
    source: "https://www.sec.gov/Archives/edgar/data/1414932/000119312523012750/d280532d8k.htm" },
  { acquirer: "CCAP", acquirerCik: 1633336, target: "FCRD", targetCik: 1464963, targetName: "First Eagle Alternative Capital BDC, Inc.", targetListed: true,
    closeDate: "2023-03-09", closeQuarter: "2023-03-31",
    source: "https://www.sec.gov/Archives/edgar/data/1633336/000119312523066479/d456056d8k.htm" },
  { acquirer: "FRBP", acquirerCik: 1825248, target: null, targetCik: 1490927, targetName: "Franklin BSP Lending Corporation", targetListed: false,
    closeDate: "2024-01-24", closeQuarter: "2024-03-31",
    source: "https://www.sec.gov/Archives/edgar/data/1825248/000121390024006162/ea191916-8k_franklinbsp.htm" },
  { acquirer: "TCPC", acquirerCik: 1370755, target: "BKCC", targetCik: 1326003, targetName: "BlackRock Capital Investment Corporation", targetListed: true,
    closeDate: "2024-03-18", closeQuarter: "2024-03-31",
    source: "https://www.sec.gov/Archives/edgar/data/1370755/000114036124013943/ef20024232_8k.htm" },
  { acquirer: "GBDC", acquirerCik: 1476765, target: null, targetCik: 1715268, targetName: "Golub Capital BDC 3, Inc.", targetListed: false,
    closeDate: "2024-06-03", closeQuarter: "2024-06-30",
    source: "https://www.sec.gov/Archives/edgar/data/1476765/000110465924067549/tm2416178d1_8k.htm" },
  /* two registered closed-end funds, not BDCs: no schedule-of-investments
     tags to chain, but the quarter's jump in MFIC's cost is explained */
  { acquirer: "MFIC", acquirerCik: 1278752, target: "AFT", targetCik: 1502573, targetName: "Apollo Senior Floating Rate Fund Inc.", targetListed: true,
    closeDate: "2024-07-22", closeQuarter: "2024-09-30", targetKind: "closed-end fund",
    source: "https://www.sec.gov/Archives/edgar/data/1278752/000119312524182213/d871191d8k.htm" },
  { acquirer: "MFIC", acquirerCik: 1278752, target: "AIF", targetCik: 1526697, targetName: "Apollo Tactical Income Fund Inc.", targetListed: true,
    closeDate: "2024-07-22", closeQuarter: "2024-09-30", targetKind: "closed-end fund",
    source: "https://www.sec.gov/Archives/edgar/data/1278752/000119312524182213/d871191d8k.htm" },
  { acquirer: "OBDC", acquirerCik: 1655888, target: "OBDE", targetCik: 1807427, targetName: "Blue Owl Capital Corporation III", targetListed: true,
    closeDate: "2025-01-13", closeQuarter: "2025-03-31",
    source: "https://www.sec.gov/Archives/edgar/data/1655888/000162828025001250/obdc-20250113.htm" },
  { acquirer: "OTF", acquirerCik: 1747777, target: null, targetCik: 1889668, targetName: "Blue Owl Technology Finance Corp. II", targetListed: false,
    closeDate: "2025-03-24", closeQuarter: "2025-03-31",
    source: "https://www.sec.gov/Archives/edgar/data/1747777/000162828025014413/otic-20250324.htm" },
  { acquirer: "CGBD", acquirerCik: 1544206, target: null, targetCik: 1851277, targetName: "Carlyle Secured Lending III", targetListed: false,
    closeDate: "2025-03-27", closeQuarter: "2025-03-31",
    source: "https://www.sec.gov/Archives/edgar/data/1544206/000119312525065938/d906363d8k.htm" },
  { acquirer: "PTMN", acquirerCik: 1372807, target: "LRFC", targetCik: 1571329, targetName: "Logan Ridge Finance Corporation", targetListed: true,
    closeDate: "2025-07-15", closeQuarter: "2025-09-30",
    source: "https://www.sec.gov/Archives/edgar/data/1372807/000162828025035078/ptmn-20250715.htm" },
];
