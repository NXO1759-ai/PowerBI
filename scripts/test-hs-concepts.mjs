/**
 * test-hs-concepts.mjs — the build-out monitor's concept additions,
 * offline, against companyfacts slices of the filers the design names.
 *
 * LIVE PROBE, 2026-09-11. Every tag added to scripts/lib/concepts.mjs was
 * read from https://data.sec.gov/api/xbrl/companyfacts/CIK<cik>.json on
 * 2026-09-11 (through the paced getJson in sec-pull.mjs, with SEC_UA)
 * before it was written down. The value is the row with the latest
 * period end for the ticker named; the date is that period's end, with
 * the span start where the fact is a duration. Filings: MSFT 10-K filed
 * 2026-07-29 (0001193125-26-323660); GOOG 10-Q filed 2026-07-23
 * (0001652044-26-000071); AMZN 10-Q filed 2026-07-31 (0001018724-26-
 * 000026); META 10-Q filed 2026-07-30 (0001628280-26-050705); ORCL 10-K
 * filed 2026-06-22 (0001193125-26-277521) and 10-Q filed 2026-09-11
 * (0001193125-26-389274); CRWV 10-Q filed 2026-08-12 (0001769628-26-
 * 000366); APLD 10-K filed 2026-07-29 (0001144879-26-000048); IREN 10-K
 * filed 2026-08-27 (0001878848-26-000052) and 10-Q filed 2026-05-14
 * (0001878848-26-000026); CIFR 10-Q filed 2026-08-04 (0001819989-26-
 * 000041); WULF 10-Q filed 2026-08-05 (0001083301-26-000166) and 10-K
 * (0001083301-26-000031); EQIX 10-Q filed 2026-07-30 (0001101239-26-
 * 000147); DLR 10-Q filed 2026-05-01 (0001104659-26-054255) and 10-K
 * (0001104659-26-015365); NBIS 20-F filed 2026-04-30 (0001104659-26-
 * 052948).
 *
 *   tag                                                     ticker  value seen          period
 *   ProceedsFromIssuanceOfLongTermDebt                      AMZN    81,925,000,000      2025-07-01..2026-06-30 (13,557,000,000 for 2026-04-01..2026-06-30)
 *   ProceedsFromIssuanceOfSeniorLongTermDebt                ORCL    46,093,000,000      2025-06-01..2026-05-31
 *   ProceedsFromDebtNetOfIssuanceCosts                      GOOG    56,226,000,000      2026-01-01..2026-06-30
 *   ProceedsFromDebtMaturingInMoreThanThreeMonths           MSFT    0                   2025-07-01..2026-06-30
 *   ProceedsFromIssuanceOfMediumTermNotes                   APLD    4,955,327,000       2025-06-01..2026-05-31
 *   ProceedsFromIssuanceOfSecuredDebt                       WULF    3,132,938,000       2025-01-01..2025-12-31
 *   ProceedsFromIssuanceOfDebt                              NBIS    2,532,700,000       2023-01-01..2023-12-31
 *   RepaymentsOfLongTermDebt                                AMZN    5,022,000,000       2025-07-01..2026-06-30 (2,752,000,000 for the quarter)
 *   RepaymentsOfDebtAndCapitalLeaseObligations              GOOG    5,253,000,000       2026-01-01..2026-06-30
 *   RepaymentsOfDebt                                        ORCL    6,942,000,000       2025-06-01..2026-05-31 (4,202,000,000 for 2026-06-01..2026-08-31)
 *   RepaymentsOfDebtMaturingInMoreThanThreeMonths           MSFT    3,000,000,000       2025-07-01..2026-06-30
 *   RepaymentsOfMediumTermNotes                             APLD    521,512,000         2025-06-01..2026-05-31
 *   RepaymentsOfSeniorDebt                                  EQIX    700,000,000         2026-01-01..2026-06-30
 *   RepaymentsOfOtherDebt                                   EQIX    682,000,000         2026-01-01..2026-06-30
 *   RepaymentsOfLinesOfCredit                               DLR     477,207,000         2026-01-01..2026-03-31
 *   ProceedsFromShortTermDebt                               AMZN    20,798,000,000      2025-07-01..2026-06-30
 *   ProceedsFromLinesOfCredit                               DLR     293,734,000         2026-01-01..2026-03-31
 *   ProceedsFromRepaymentsOfCommercialPaper                 ORCL    -2,285,000,000      2025-06-01..2026-05-31
 *   RepaymentsOfShortTermDebt                               AMZN    20,634,000,000      2025-07-01..2026-06-30 (WULF 100,075,000 for 2026-01-01..2026-06-30)
 *   ProceedsFromConvertibleDebt                             IREN    6,299,555,000       2025-07-01..2026-06-30
 *   RepaymentsOfConvertibleDebt                             IREN    1,623,484,000       2025-07-01..2026-03-31
 *   FinanceLeasePrincipalPayments                           MSFT    3,101,000,000       2025-07-01..2026-06-30
 *   RightOfUseAssetObtainedInExchangeForFinanceLeaseLiability MSFT  24,608,000,000      2025-07-01..2026-06-30
 *   ProceedsFromIssuanceOfCommonStock                       GOOG    30,499,000,000      2026-01-01..2026-06-30
 *   ProceedsFromIssuanceOfPrivatePlacement                  CRWV    2,982,000,000       2026-01-01..2026-06-30
 *   ProceedsFromIssuanceOfConvertiblePreferredStock         GOOG    19,063,000,000      2026-01-01..2026-06-30 (ORCL 4,954,000,000 for fiscal 2026)
 *   ProceedsFromIssuanceOfPreferredStockAndPreferenceStock  APLD    814,998,000         2025-06-01..2026-05-31
 *   ProceedsFromIssuanceOfRedeemablePreferredStock          DLR     731,690,000         2025-01-01..2025-12-31
 *   ProceedsFromIssuanceOfWarrants                          APLD    4,451,000           2025-06-01..2026-05-31
 *   ProceedsFromMinorityShareholders                        GOOG    3,758,000,000       2026-01-01..2026-06-30 (APLD 1,825,000,000 for fiscal 2026)
 *   NoncontrollingInterestIncreaseFromSaleOfParentEquityInterest GOOG 3,758,000,000    2026-01-01..2026-06-30
 *   PaymentsToAcquireInterestInJointVenture                 CRWV    550,000,000         2026-01-01..2026-06-30
 *   PaymentsToAcquireEquityMethodInvestments                EQIX    264,000,000         2026-01-01..2026-06-30
 *   InterestPaidNet                                         ORCL    3,896,000,000       2025-06-01..2026-05-31 (CRWV 806,000,000; APLD 263,402,000)
 *   InterestPaid                                            MSFT    1,500,000,000       2025-07-01..2026-06-30
 *   InterestCostsCapitalized                                GOOG    628,000,000         2026-01-01..2026-06-30 (CRWV 176,000,000)
 *   InterestCostsCapitalizedAdjustment                      APLD    39,574,000          2025-06-01..2026-05-31
 *   CapitalExpendituresIncurredButNotYetPaid                ORCL    6,247,000,000       2026-06-01..2026-08-31 (5,279,000,000 for fiscal 2026; META 19,502,000,000; CRWV 9,796,000,000)
 *   PaymentsOfOrdinaryDividends                             GOOG    5,231,000,000       2026-01-01..2026-06-30
 *   PaymentsToAcquireOtherPropertyPlantAndEquipment         EQIX    2,834,000,000       2026-01-01..2026-06-30
 *   PaymentsToDevelopRealEstateAssets                       DLR     870,038,000         2026-01-01..2026-03-31
 *   Depreciation                                            MSFT    34,300,000,000      2025-07-01..2026-06-30 (ORCL 7,623,000,000; GOOG 13,586,000,000 H1)
 *   DebtInstrumentCarryingAmount                            CRWV    35,551,000,000      2026-06-30 (MSFT 46,136,000,000; ORCL 130,105,000,000 at 2026-05-31)
 *   DebtLongtermAndShorttermCombinedAmount                  ORCL    129,541,000,000     2026-05-31
 *   LongTermDebt                                            AMZN    132,995,000,000     2026-06-30
 *   LongTermNotesPayable                                    ORCL    122,342,000,000     2026-05-31 (APLD 4,959,516,000)
 *   LongTermNotesAndLoans                                   ORCL    117,712,000,000     2026-08-31 (124,718,000,000 at 2026-02-28)
 *   SeniorLongTermNotes                                     EQIX    18,519,000,000      2026-06-30
 *   SeniorNotes                                             DLR     16,013,977,000      2026-03-31
 *   NotesPayableCurrent                                     ORCL    7,625,000,000       2026-08-31 (7,199,000,000 at 2026-05-31; APLD 16,422,000)
 *   ConvertibleNotesPayable                                 IREN    3,687,832,000       2026-03-31
 *   ConvertibleLongTermNotesPayable                         IREN    3,687,832,000       2026-03-31
 *   ConvertibleDebt                                         WULF    1,101,976,000       2026-06-30
 *   ConvertibleDebtNoncurrent                               WULF    1,597,266,000       2026-03-31
 *   FinanceLeaseLiability                                   MSFT    66,594,000,000      2026-06-30 (ORCL 9,185,000,000 at 2026-08-31)
 *   FinanceLeaseLiabilityNoncurrent                         AMZN    11,763,000,000      2026-06-30
 *   FinanceLeaseRightOfUseAsset                             GOOG    5,474,000,000       2026-06-30
 *   FinanceLeaseLiabilityPaymentsDue (+NextTwelveMonths, YearTwo..YearFive, AfterYearFive) MSFT 89,686 / 7,121 / 7,294 / 6,668 / 6,570 / 6,543 / 55,490 million 2026-06-30
 *   LesseeOperatingLeaseLiabilityPaymentsDue                MSFT    24,706,000,000      2026-06-30
 *   LongTermDebtMaturitiesRepaymentsOfPrincipalRemainderOfFiscalYear CRWV 4,413,000,000 2026-06-30 (CIFR 18,476,000)
 *   LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths MSFT 9,250,000,000    2026-06-30 (ORCL 7,210,000,000 at 2026-05-31)
 *   ...InYearTwo / InYearThree / InYearFour / InYearFive / AfterYearFive MSFT 0 / 2,001 / 0 / 500 / 34,385 million 2026-06-30
 *   ContractualObligation                                   AMZN    650,034,000,000     2026-06-30 (META 349,310,000,000)
 *   LongTermPurchaseCommitmentAmount                        GOOG    707,000,000,000     2026-01-01..2026-06-30 (a duration fact)
 *   UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount META 278,990,000,000  2026-06-30
 *   PurchaseObligation                                      GOOG    7,700,000,000       2025-12-31
 *   ContractualObligationFutureMinimumPaymentsDueRemainderOfFiscalYear AMZN 42,752,000,000 2026-06-30 (META 53,520,000,000)
 *   ContractualObligationDueInNextTwelveMonths              AMZN    78,084,000,000      2026-06-30 (META 81,650,000,000)
 *   ContractualObligationDueInSecondYear / ThirdYear / FourthYear AMZN 53,406 / 46,767 / 42,219 million 2026-06-30
 *   ContractualObligationDueInFifthYear / DueAfterFifthYear AMZN    32,153 / 241,480 million 2025-12-31
 *   LessorOperatingLeasePaymentsToBeReceived                APLD    35,844,882,000      2026-05-31 (IREN 11,400,000,000)
 *   LessorOperatingLeasePaymentsToBeReceivedNextTwelveMonths APLD   451,065,000         2026-05-31
 *   ...TwoYears / ThreeYears / FourYears / FiveYears / Thereafter APLD 1,453,748,000 / 2,251,769,000 / 2,280,829,000 / 2,299,574,000 / 27,107,897,000 2026-05-31
 *   RestrictedCashAndCashEquivalentsNoncurrent              META    13,107,000,000      2026-06-30 (CRWV 507,000,000)
 *   RestrictedCashNoncurrent                                AMZN    2,431,000,000       2026-06-30 (APLD 180,415,000)
 *   RestrictedCashCurrent                                   APLD    2,381,027,000       2026-05-31
 *   RestrictedCashAndCashEquivalentsAtCarryingValue         CRWV    873,000,000         2026-06-30
 *   RestrictedCash                                          IREN    1,723,900,000       2026-06-30 (ORCL 2,600,000,000 at 2026-08-31)
 *   CashCashEquivalentsAndShortTermInvestments              GOOG    242,474,000,000     2026-06-30 (MSFT 76,843,000,000)
 *   MarketableSecuritiesCurrent                             META    74,798,000,000      2026-06-30
 *   ShortTermInvestments                                    MSFT    55,908,000,000      2026-06-30
 *   RedeemableNoncontrollingInterestEquityCarryingAmount    APLD    1,956,303,000       2026-05-31
 *   NoncontrollingInterestInVariableInterestEntity          GOOG    7,100,000,000       2026-06-30
 *   PreferredStockValue                                     ORCL    4,954,000,000       2026-08-31 (also at 2026-05-31; DLR 731,690,000)
 *   ConstructionInProgressGross                             ORCL    48,546,000,000      2026-08-31 (39,973,000,000 at 2026-05-31)
 *   DevelopmentInProcess                                    DLR     5,381,071,000       2026-03-31
 *   EquityMethodInvestments                                 META    9,406,000,000       2026-06-30
 *   VariableInterestEntityEntityMaximumLossExposureAmount   CRWV    1,800,000,000       2026-06-30 (META 6,410,000,000)
 *   GuaranteeObligationsMaximumExposure                     GOOG    7,600,000,000       2026-06-30
 *   LongTermDebtFairValue                                   MSFT    36,500,000,000      2026-06-30
 *   NotesPayableFairValueDisclosure                         IREN    7,167,336,000       2026-06-30
 *   PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization META 225,724,000,000 2026-06-30 (GOOG 321,212,000,000; AMZN 446,046,000,000)
 *   InterestExpenseDebt                                     META    1,290,000,000       2026-01-01..2026-06-30 (754,000,000 for the quarter; CRWV 985,000,000 H1, 558,000,000 quarter)
 *   InterestExpenseDebtExcludingAmortization                CRWV    1,075,000,000       2026-01-01..2026-06-30
 *   InterestPayableCurrent                                  CRWV    410,000,000         2026-06-30
 *   RevenueRemainingPerformanceObligation                   CRWV    103,700,000,000     2026-06-30 (already in the ladder)
 *
 * Fixtures (scripts/fixtures/hs/): companyfacts slices cut 2026-09-11 to
 * the tags in concepts.mjs — MSFT from 2023-06-30, ORCL from 2023-05-31,
 * META from 2023-12-31, CRWV from 2024-01-01, APLD from 2024-05-31, GOOG
 * from 2024-01-01, and AMZN, IREN, WULF, EQIX, DLR and CIFR from
 * 2025-01-01 (re-cut the same day after the ladders widened, so they
 * carry AmortizationOfIntangibleAssets, the IPO tag and TeraWulf's
 * second capex line). Values asserted below are the ones in the probe
 * and in the refutation of design-hyperscalers.json, which corrected the
 * design's Oracle buybacks to 95,000,000 and its Applied Digital
 * preferred to 814,998,000.
 *
 * The same-tag rule and the fill composite (concepts.mjs MIXABLE,
 * FILL_COMPOSITES) are pinned on two more slices, cut to the tags they
 * need: MRK (CIK 310158, mrk-companyfacts-slice.json, from 2019-12-31)
 * — 10-K for 2020, 0000310158-21-000004: Depreciation 1,669,000,000 and
 * AmortizationOfIntangibleAssets 1,800,000,000, no combined tag; 10-Qs
 * 0000310158-20-000009, -000026 and -000030: DepreciationDepletionAnd
 * Amortization 821,000,000, 1,048,000,000 and 852,000,000 for the three
 * quarters of 2020 — and WMT (CIK 104169, wmt-companyfacts-slice.json,
 * from 2024-01-31): 10-Q 0000104169-24-000105 tags InterestIncomeExpense
 * Net -600,000,000 for the quarter to 2024-04-30, the next two 10-Qs
 * InterestExpenseDebt 557,000,000 and 496,000,000, and the 10-K for the
 * year to 2025-01-31 InterestExpenseDebt 2,249,000,000. The history cut
 * (cohorts.json historyStart, trimHistory) is pinned on
 * wulf-history-slice.json (CIK 1083301 from 2019-01-01: the IKONICS Corp
 * years) and nbis-history-slice.json (CIK 1513845 from 2021-12-31: the
 * Yandex N.V. years), both cut to the panel's anchor tags and Assets.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INCOME, BALANCE, CASHFLOW, ALL_CONCEPTS, FILL_ONLY, FILL_COMPOSITES, FILL_CONTINUES,
         MIXABLE, ABSENT_IS_ZERO, NEVER_NEGATIVE, ZERO_YIELDS, SUM_FIRST, END_DATED_BALANCE,
         REPORTED_AS_BALANCE, LABEL_OVERRIDES, labelFor } from "./lib/concepts.mjs";
import { buildStatements, readInstant, readDuration, trimHistory } from "./lib/statements.mjs";
import { SEC_CONCEPTS, factsFromCompanyFacts, buildPayload } from "./lib/sec-pull.mjs";
import { panelYears } from "./lib/panel-row.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const load = (t) => JSON.parse(readFileSync(join(here, "fixtures/hs", t.toLowerCase() + "-companyfacts-slice.json"), "utf8"));
const loadFile = (f) => JSON.parse(readFileSync(join(here, "fixtures/hs", f), "utf8"));
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};

const S = {};
const series = (t) => S[t] || (S[t] = buildStatements(load(t).facts["us-gaap"]));
const stmtOf = (key) => (INCOME[key] ? "incomeStatement" : BALANCE[key] ? "balanceSheet" : "cashFlow");
/* the most recent period, quarterly or annual, that carries a number */
function latest(t, key) {
  const s = series(t), stmt = stmtOf(key);
  const all = [...s.quarterly, ...s.annual].filter((p) => typeof p[stmt][key] === "number")
    .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : 0));
  return all.length ? { value: all[0][stmt][key], end: all[0].periodEnd } : null;
}
const annual = (t, end, key) => { const p = series(t).annual.find((x) => x.periodEnd === end); return p ? p[stmtOf(key)][key] : undefined; };
const quarter = (t, end, key) => { const p = series(t).quarterly.find((x) => x.periodEnd === end); return p ? p[stmtOf(key)][key] : undefined; };
const ltm = (t, end, key) => { const p = series(t).ltm.find((x) => x.periodEnd === end); return p ? p[stmtOf(key)][key] : undefined; };
/* the period object itself, for its tags and markers */
const periodOf = (t, grain, end) => series(t)[grain].find((x) => x.periodEnd === end);
const tagOf = (t, grain, end, key) => { const p = periodOf(t, grain, end); return p && p.tags ? p.tags[stmtOf(key) + "." + key] : undefined; };
const marked = (t, grain, end, list, key) => { const p = periodOf(t, grain, end); return !!(p && p[list] && p[list].includes(stmtOf(key) + "." + key)); };
const nonNull = (t, key) => { const l = latest(t, key); check(`${key} resolves for ${t}`, l !== null && typeof l.value === "number", l ? `${l.value} at ${l.end}` : "null"); return l; };
const pin = (t, key, grain, end, value) => {
  const got = grain === "a" ? annual(t, end, key) : grain === "q" ? quarter(t, end, key) : ltm(t, end, key);
  check(`${t} ${key} ${grain === "a" ? "year" : grain === "q" ? "quarter" : "trailing year"} to ${end} = ${value.toLocaleString("en-US")}`, got === value, String(got));
};

/* ---------- the shape of the additions ---------- */
console.log("the concept lists");
const NEW_CASHFLOW = ["debtIssued", "debtRepaid", "otherDebtRepaid", "shortTermDebtProceeds", "shortTermDebtRepaid", "convertsIssued", "convertsRepaid",
  "financeLeasePrincipal", "financeLeaseAdditions", "equityIssued", "ipoProceeds", "preferredIssued", "warrantsIssued", "jvPartnerFunding",
  "jvInvestment", "interestPaid", "interestCapitalized", "capexAccrued", "capexOther"];
const NEW_BALANCE = ["totalDebtPrincipal", "convertibles", "financeLeaseLiability", "financeLeaseAsset", "financeLeaseDue",
  "financeLeaseDueNextTwelveMonths", "financeLeaseDueYearTwo", "financeLeaseDueYearThree", "financeLeaseDueYearFour",
  "financeLeaseDueYearFive", "financeLeaseDueAfterYearFive", "opLeaseDue", "maturityRemainderOfFiscalYear",
  "maturityNextTwelveMonths", "maturityYearTwo", "maturityYearThree", "maturityYearFour", "maturityYearFive",
  "maturityAfterYearFive", "purchaseObligations", "unrecordedPurchaseObligations", "contractualObligationRemainderOfFiscalYear",
  "contractualObligationNextTwelveMonths", "contractualObligationYearTwo", "contractualObligationYearThree",
  "contractualObligationYearFour", "contractualObligationYearFive", "contractualObligationAfterYearFive", "lessorBacklog",
  "lessorBacklogNextTwelveMonths", "lessorBacklogYearTwo", "lessorBacklogYearThree", "lessorBacklogYearFour",
  "lessorBacklogYearFive", "lessorBacklogThereafter", "restrictedCash", "liquidity", "redeemableNci", "nciVie",
  "preferredStock", "constructionInProgress", "equityMethodInvestments", "vieMaxExposure", "guaranteeExposure",
  "debtFairValue", "interestPayable"];
check("every new cash-flow key is in CASHFLOW with a non-empty ladder",
  NEW_CASHFLOW.every((k) => Array.isArray(CASHFLOW[k]) && CASHFLOW[k].length > 0), NEW_CASHFLOW.filter((k) => !CASHFLOW[k]).join(","));
check("every new balance key is in BALANCE with a non-empty ladder",
  NEW_BALANCE.every((k) => Array.isArray(BALANCE[k]) && BALANCE[k].length > 0), NEW_BALANCE.filter((k) => !BALANCE[k]).join(","));
check("remainingPerformanceObligation is present", BALANCE.remainingPerformanceObligation[0] === "RevenueRemainingPerformanceObligation");
check("the widened ladders end with the new alternates",
  CASHFLOW.depreciationAmortization.at(-1) === "Depreciation" &&
  CASHFLOW.capex.slice(-2).join() === "PaymentsToAcquireOtherPropertyPlantAndEquipment,PaymentsToDevelopRealEstateAssets" &&
  CASHFLOW.dividendsPaid.at(-1) === "PaymentsOfOrdinaryDividends" &&
  BALANCE.ppe.at(-1) === "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization" &&
  BALANCE.shortTermDebt.at(-1) === "NotesPayableCurrent" &&
  BALANCE.longTermDebt.slice(-4).join() === "LongTermNotesPayable,SeniorLongTermNotes,LongTermNotesAndLoans,SeniorNotes" &&
  INCOME.interestExpense.slice(-2).join() === "InterestExpenseDebt,InterestExpenseDebtExcludingAmortization");
check("the debtIssued ladder is the blueprint's seven, in order",
  CASHFLOW.debtIssued.join() === "ProceedsFromIssuanceOfLongTermDebt,ProceedsFromIssuanceOfSeniorLongTermDebt,ProceedsFromDebtNetOfIssuanceCosts,ProceedsFromDebtMaturingInMoreThanThreeMonths,ProceedsFromIssuanceOfMediumTermNotes,ProceedsFromIssuanceOfSecuredDebt,ProceedsFromIssuanceOfDebt");
check("the debtRepaid ladder is six alternatives; the other-debt line and the revolver are their own keys",
  CASHFLOW.debtRepaid.join() === "RepaymentsOfLongTermDebt,RepaymentsOfDebtAndCapitalLeaseObligations,RepaymentsOfDebt,RepaymentsOfDebtMaturingInMoreThanThreeMonths,RepaymentsOfMediumTermNotes,RepaymentsOfSeniorDebt" &&
  CASHFLOW.otherDebtRepaid.join() === "RepaymentsOfOtherDebt" &&
  CASHFLOW.shortTermDebtRepaid.join() === "RepaymentsOfShortTermDebt,RepaymentsOfLinesOfCredit");
check("the IPO tag is its own key beside equityIssued, and the redeemable-preferred tag is read nowhere",
  CASHFLOW.ipoProceeds.join() === "ProceedsFromIssuanceInitialPublicOffering" &&
  CASHFLOW.equityIssued.join() === "ProceedsFromIssuanceOfCommonStock,ProceedsFromIssuanceOfPrivatePlacement" &&
  !ALL_CONCEPTS.includes("ProceedsFromIssuanceOfRedeemablePreferredStock"));
check("the D&A fill is depreciation alone (the composite was removed: the blueprint reads MSFT 34,300, not 39,000), and no composite fill tier is in use",
  FILL_ONLY.depreciationAmortization.join() === "Depreciation" && Object.keys(FILL_COMPOSITES).length === 0);
check("a tagged zero yields to a lower-ranked non-zero row only for the financing keys",
  [...ZERO_YIELDS].every((k) => ABSENT_IS_ZERO.has(k) || NEVER_NEGATIVE.has(k)) && ZERO_YIELDS.has("debtIssued") && !ZERO_YIELDS.has("capex"));
check("restricted cash is the only sum-first balance, and its pairs are the current/non-current tags",
  Object.keys(SUM_FIRST).join() === "restrictedCash" && SUM_FIRST.restrictedCash.every((r) => r.parts.length === 2));
check("the continuation fill tags are fill tags of MIXABLE keys, and the different-line fills are not continuations",
  Object.keys(FILL_CONTINUES).every((k) => MIXABLE.has(k) && FILL_CONTINUES[k].every((t) => FILL_ONLY[k].includes(t))) &&
  !Object.values(FILL_CONTINUES).flat().includes("Depreciation") && !Object.values(FILL_CONTINUES).flat().includes("InterestExpenseDebt"));
check("the zero-by-absence and never-negative sets hold only the new financing keys, none of the operating lines",
  [...ABSENT_IS_ZERO, ...NEVER_NEGATIVE].every((k) => CASHFLOW[k] && !["capex", "dividendsPaid", "depreciationAmortization", "buybacks", "cfOps", "cfInv", "cfFin", "shareBasedComp"].includes(k)) &&
  !NEVER_NEGATIVE.has("shortTermDebtProceeds") && ABSENT_IS_ZERO.has("debtIssued") && NEVER_NEGATIVE.has("equityIssued"));
check("every fill-only tag sits at the end of its own ladder",
  Object.entries(FILL_ONLY).every(([k, tags]) => {
    const ladder = INCOME[k] || BALANCE[k] || CASHFLOW[k];
    return ladder && ladder.slice(-tags.length).join() === tags.join();
  }));
check("every tag in every ladder reaches ALL_CONCEPTS",
  [...Object.values(INCOME), ...Object.values(BALANCE), ...Object.values(CASHFLOW)].flat().every((t) => ALL_CONCEPTS.includes(t)));
check("the overview pull's concept list is unchanged by the additions (FLOW and INSTANT are subsets)",
  SEC_CONCEPTS.length === 27 && !SEC_CONCEPTS.includes("Depreciation") && !SEC_CONCEPTS.includes("DebtInstrumentCarryingAmount"),
  String(SEC_CONCEPTS.length));
check("purchaseObligations is read by end date and capexAccrued as a balance",
  END_DATED_BALANCE.has("purchaseObligations") && REPORTED_AS_BALANCE.has("capexAccrued"));
check("the unrecorded-obligation tag is its own key, out of the purchaseObligations ladder",
  BALANCE.purchaseObligations.join() === "ContractualObligation,LongTermPurchaseCommitmentAmount,PurchaseObligation" &&
  BALANCE.unrecordedPurchaseObligations.join() === "UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount");
check("Meta's and Alphabet's unrecorded-obligation tag is labeled leases not yet commenced; Oracle's and Amazon's is not",
  labelFor("unrecordedPurchaseObligations", "UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount", 1326801) === "Leases not yet commenced" &&
  labelFor("unrecordedPurchaseObligations", "UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount", "1652044") === "Leases not yet commenced" &&
  labelFor("unrecordedPurchaseObligations", "UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount", 1341439) === null &&
  labelFor("unrecordedPurchaseObligations", "UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount", 1018724) === null &&
  labelFor("purchaseObligations", "ContractualObligation", 1326801) === null &&
  Object.keys(LABEL_OVERRIDES).length === 1);

/* ---------- every new key resolves for the ticker named beside it ---------- */
console.log("cash flow: sources and uses");
nonNull("ORCL", "debtIssued"); pin("ORCL", "debtIssued", "a", "2026-05-31", 46093000000);
nonNull("MSFT", "debtIssued"); pin("MSFT", "debtIssued", "a", "2026-06-30", 0);
pin("APLD", "debtIssued", "a", "2026-05-31", 4955327000);
pin("AMZN", "debtIssued", "q", "2026-06-30", 13557000000);
pin("GOOG", "debtIssued", "q", "2026-03-31", 31379000000); pin("GOOG", "debtIssued", "q", "2026-06-30", 24847000000);
check("GOOG debt raised for the half year is 56,226,000,000", quarter("GOOG", "2026-03-31", "debtIssued") + quarter("GOOG", "2026-06-30", "debtIssued") === 56226000000);
pin("WULF", "debtIssued", "a", "2025-12-31", 3132938000);
nonNull("MSFT", "debtRepaid"); pin("MSFT", "debtRepaid", "a", "2026-06-30", 3000000000);
pin("ORCL", "debtRepaid", "a", "2026-05-31", 6942000000);
pin("APLD", "debtRepaid", "a", "2026-05-31", 521512000);
pin("AMZN", "debtRepaid", "q", "2026-06-30", 2752000000);
check("GOOG debt repaid for the half year is 5,253,000,000", quarter("GOOG", "2026-03-31", "debtRepaid") + quarter("GOOG", "2026-06-30", "debtRepaid") === 5253000000);
check("EQIX senior notes repaid: none in the first quarter (no row, taken as zero), 700,000,000 in the second",
  quarter("EQIX", "2026-03-31", "debtRepaid") === 0 && marked("EQIX", "quarterly", "2026-03-31", "inferredZero", "debtRepaid") &&
  quarter("EQIX", "2026-06-30", "debtRepaid") === 700000000 && tagOf("EQIX", "quarterly", "2026-06-30", "debtRepaid") === "RepaymentsOfSeniorDebt",
  JSON.stringify([quarter("EQIX", "2026-03-31", "debtRepaid"), quarter("EQIX", "2026-06-30", "debtRepaid")]));
check("EQIX other debt repaid is its own line: 674,000,000 then 8,000,000, and the two keys sum to the 1,382,000,000 repaid in the half year",
  quarter("EQIX", "2026-03-31", "otherDebtRepaid") === 674000000 && quarter("EQIX", "2026-06-30", "otherDebtRepaid") === 8000000 &&
  quarter("EQIX", "2026-03-31", "debtRepaid") + quarter("EQIX", "2026-06-30", "debtRepaid") +
  quarter("EQIX", "2026-03-31", "otherDebtRepaid") + quarter("EQIX", "2026-06-30", "otherDebtRepaid") === 1382000000);
pin("DLR", "debtRepaid", "a", "2025-12-31", 2514388000);
nonNull("ORCL", "shortTermDebtProceeds"); pin("ORCL", "shortTermDebtProceeds", "a", "2026-05-31", -2285000000);
nonNull("AMZN", "shortTermDebtProceeds"); pin("AMZN", "shortTermDebtProceeds", "l", "2026-06-30", 20798000000);
pin("DLR", "shortTermDebtProceeds", "q", "2026-03-31", 293734000);
nonNull("AMZN", "shortTermDebtRepaid"); pin("AMZN", "shortTermDebtRepaid", "l", "2026-06-30", 20634000000);
pin("DLR", "shortTermDebtRepaid", "a", "2025-12-31", 2586749000); pin("DLR", "shortTermDebtRepaid", "q", "2026-03-31", 477207000);
check("DLR's revolver repayments resolve from RepaymentsOfLinesOfCredit, mirroring its draws under ProceedsFromLinesOfCredit",
  tagOf("DLR", "annual", "2025-12-31", "shortTermDebtRepaid") === "RepaymentsOfLinesOfCredit" &&
  tagOf("DLR", "quarterly", "2026-03-31", "shortTermDebtProceeds") === "ProceedsFromLinesOfCredit");
/* Lines a filer prints only in the quarters they happen have no
   first-quarter row when the first quarter was nil. For the financing
   keys (ABSENT_IS_ZERO) that quarter is zero, marked inferredZero, and
   the second quarter is the half year. */
const ytd = (t, key, end) => { const m = readDuration(load(t).facts["us-gaap"], CASHFLOW[key], { spanTest: (d) => d !== null && d >= 150 && d <= 290 }); const r = m.get(end); return r ? r.value : null; };
check("WULF short-term debt repaid for the half year to 2026-06-30 is 100,075,000 at the reader, and the quarters are 0 (inferred) then 100,075,000",
  ytd("WULF", "shortTermDebtRepaid", "2026-06-30") === 100075000 &&
  quarter("WULF", "2026-03-31", "shortTermDebtRepaid") === 0 && marked("WULF", "quarterly", "2026-03-31", "inferredZero", "shortTermDebtRepaid") &&
  quarter("WULF", "2026-06-30", "shortTermDebtRepaid") === 100075000 && marked("WULF", "quarterly", "2026-06-30", "derivedFields", "shortTermDebtRepaid"),
  JSON.stringify([ytd("WULF", "shortTermDebtRepaid", "2026-06-30"), quarter("WULF", "2026-03-31", "shortTermDebtRepaid"), quarter("WULF", "2026-06-30", "shortTermDebtRepaid")]));
check("GOOG common stock sold: 0 in the first quarter of 2026 (inferred), 30,499,000,000 in the second; mandatory convertible preferred 19,063,000,000 the same way",
  quarter("GOOG", "2026-03-31", "equityIssued") === 0 && quarter("GOOG", "2026-06-30", "equityIssued") === 30499000000 &&
  quarter("GOOG", "2026-03-31", "preferredIssued") === 0 && quarter("GOOG", "2026-06-30", "preferredIssued") === 19063000000 &&
  marked("GOOG", "quarterly", "2026-03-31", "inferredZero", "equityIssued"));
check("META debt raised: nothing through the third quarter of 2025 (no 10-Q row), 29,906,000,000 in the fourth, 24,910,000,000 in the second quarter of 2026, 54,816,000,000 for the trailing year",
  quarter("META", "2025-09-30", "debtIssued") === 0 && quarter("META", "2025-12-31", "debtIssued") === 29906000000 &&
  quarter("META", "2026-06-30", "debtIssued") === 24910000000 && ltm("META", "2026-06-30", "debtIssued") === 54816000000,
  JSON.stringify([quarter("META", "2025-09-30", "debtIssued"), quarter("META", "2025-12-31", "debtIssued"), quarter("META", "2026-06-30", "debtIssued")]));
nonNull("IREN", "convertsIssued"); pin("IREN", "convertsIssued", "a", "2026-06-30", 6299555000);
check("IREN converts repaid for the nine months to 2026-03-31 are 1,623,484,000 (the half year to 2025-12-31 the same; no first-quarter row)",
  ytd("IREN", "convertsRepaid", "2026-03-31") === 1623484000 && ytd("IREN", "convertsRepaid", "2025-12-31") === 1623484000,
  String(ytd("IREN", "convertsRepaid", "2026-03-31")));
nonNull("MSFT", "financeLeasePrincipal"); pin("MSFT", "financeLeasePrincipal", "a", "2026-06-30", 3101000000);
nonNull("MSFT", "financeLeaseAdditions"); pin("MSFT", "financeLeaseAdditions", "a", "2026-06-30", 24608000000);
pin("ORCL", "financeLeaseAdditions", "a", "2026-05-31", 4946000000);
pin("META", "financeLeaseAdditions", "a", "2025-12-31", 613000000);
nonNull("CRWV", "equityIssued");
check("CRWV private placements for the half year are 2,982,000,000",
  quarter("CRWV", "2026-03-31", "equityIssued") + quarter("CRWV", "2026-06-30", "equityIssued") === 2982000000);
nonNull("CRWV", "ipoProceeds"); pin("CRWV", "ipoProceeds", "a", "2025-12-31", 1491000000);
check("CRWV's 10-K files 0 of common-stock proceeds for 2025 after 67,669,000 for the nine months: the fourth quarter is not derived and is marked, never -67,669,000",
  annual("CRWV", "2025-12-31", "equityIssued") === 0 && quarter("CRWV", "2025-12-31", "equityIssued") === null &&
  quarter("CRWV", "2025-09-30", "equityIssued") === null && marked("CRWV", "quarterly", "2025-09-30", "notDerivable", "equityIssued") &&
  !series("CRWV").quarterly.some((p) => typeof p.cashFlow.equityIssued === "number" && p.cashFlow.equityIssued < 0),
  JSON.stringify(series("CRWV").quarterly.filter((p) => p.periodEnd >= "2025-01-01").map((p) => [p.periodEnd, p.cashFlow.equityIssued])));
pin("MSFT", "equityIssued", "a", "2026-06-30", 2009000000);
nonNull("ORCL", "preferredIssued"); pin("ORCL", "preferredIssued", "a", "2026-05-31", 4954000000);
pin("APLD", "preferredIssued", "a", "2026-05-31", 814998000);
check("DLR preferredIssued is null: its 731,690,000 under the redeemable-preferred tag is the carrying value of its preferred, not an inflow",
  annual("DLR", "2025-12-31", "preferredIssued") === null && quarter("DLR", "2026-03-31", "preferredIssued") === null &&
  readInstant(load("DLR").facts["us-gaap"], ["PreferredStockValue"]).get("2025-12-31").value === 731690000,
  String(annual("DLR", "2025-12-31", "preferredIssued")));
nonNull("APLD", "warrantsIssued"); pin("APLD", "warrantsIssued", "a", "2026-05-31", 4451000);
nonNull("APLD", "jvPartnerFunding"); pin("APLD", "jvPartnerFunding", "a", "2026-05-31", 1825000000);
check("GOOG partner funding for the half year is 3,758,000,000",
  quarter("GOOG", "2026-03-31", "jvPartnerFunding") + quarter("GOOG", "2026-06-30", "jvPartnerFunding") === 3758000000);
check("CRWV joint-venture funding for the half year to 2026-06-30 is 550,000,000 (no first-quarter row)",
  ytd("CRWV", "jvInvestment", "2026-06-30") === 550000000, String(ytd("CRWV", "jvInvestment", "2026-06-30")));
check("EQIX equity-method investments for the half year are 264,000,000",
  quarter("EQIX", "2026-03-31", "jvInvestment") + quarter("EQIX", "2026-06-30", "jvInvestment") === 264000000);
nonNull("ORCL", "interestPaid"); pin("ORCL", "interestPaid", "a", "2026-05-31", 3896000000);
pin("MSFT", "interestPaid", "a", "2026-06-30", 1500000000);
pin("APLD", "interestPaid", "a", "2026-05-31", 263402000);
check("CRWV cash interest for the half year is 806,000,000",
  quarter("CRWV", "2026-03-31", "interestPaid") + quarter("CRWV", "2026-06-30", "interestPaid") === 806000000);
nonNull("APLD", "interestCapitalized"); pin("APLD", "interestCapitalized", "a", "2026-05-31", 39574000);
check("GOOG capitalized interest for the half year is 628,000,000",
  quarter("GOOG", "2026-03-31", "interestCapitalized") + quarter("GOOG", "2026-06-30", "interestCapitalized") === 628000000);
check("CRWV capitalized interest for the half year is 176,000,000",
  quarter("CRWV", "2026-03-31", "interestCapitalized") + quarter("CRWV", "2026-06-30", "interestCapitalized") === 176000000);
nonNull("ORCL", "capexAccrued"); pin("ORCL", "capexAccrued", "a", "2026-05-31", 5279000000);
pin("ORCL", "capexAccrued", "q", "2026-08-31", 6247000000);
pin("META", "capexAccrued", "q", "2026-06-30", 19502000000);
check("META accrued capex is the half-year column's own figure, not the half year less the first quarter",
  quarter("META", "2026-06-30", "capexAccrued") === 19502000000 && quarter("META", "2026-03-31", "capexAccrued") === 16040000000);
pin("META", "capexAccrued", "l", "2026-06-30", 19502000000);
pin("CRWV", "capexAccrued", "q", "2026-06-30", 9796000000);
pin("ORCL", "buybacks", "a", "2026-05-31", 95000000);
pin("MSFT", "buybacks", "a", "2026-06-30", 22271000000);

console.log("cash flow: the widened ladders");
nonNull("MSFT", "depreciationAmortization"); pin("MSFT", "depreciationAmortization", "a", "2026-06-30", 34300000000);
check("MSFT's D&A is depreciation alone, 34,300,000,000 (blueprint 15.1: capex 115,948 / 34,300 = 3.38), tagged Depreciation; the 4,700,000,000 of amortization it tags beside it is not folded in",
  tagOf("MSFT", "annual", "2026-06-30", "depreciationAmortization") === "Depreciation" &&
  readDuration(load("MSFT").facts["us-gaap"], ["AmortizationOfIntangibleAssets"], { annual: true }).get("2026-06-30").value === 4700000000);
check("MSFT's quarters are depreciation alone and sum to the year, so the trailing year is 34,300,000,000",
  ltm("MSFT", "2026-06-30", "depreciationAmortization") === 34300000000);
pin("ORCL", "depreciationAmortization", "a", "2026-05-31", 7623000000);
check("ORCL's is 7,623,000,000 of depreciation alone (blueprint 15.3: net debt / EBITDA 3.50x on 20,606 + 7,623), tagged Depreciation",
  tagOf("ORCL", "annual", "2026-05-31", "depreciationAmortization") === "Depreciation");
check("GOOG's half year is 13,586,000,000 of depreciation alone (blueprint 15.1), tagged Depreciation",
  quarter("GOOG", "2026-03-31", "depreciationAmortization") + quarter("GOOG", "2026-06-30", "depreciationAmortization") === 13586000000 &&
  tagOf("GOOG", "quarterly", "2026-06-30", "depreciationAmortization") === "Depreciation");
check("META keeps its combined D&A, 12,355,000,000 for the half year, over depreciation alone",
  quarter("META", "2026-03-31", "depreciationAmortization") + quarter("META", "2026-06-30", "depreciationAmortization") === 12355000000 &&
  tagOf("META", "quarterly", "2026-03-31", "depreciationAmortization") === "DepreciationDepletionAndAmortization");
nonNull("EQIX", "capex"); pin("EQIX", "capex", "q", "2026-03-31", 1256000000); pin("EQIX", "capex", "q", "2026-06-30", 1578000000);
check("EQIX capex for the half year is the retagged 2,834,000,000: the new tag continues the line, so the half year less the first quarter is the second",
  quarter("EQIX", "2026-03-31", "capex") + quarter("EQIX", "2026-06-30", "capex") === 2834000000 &&
  tagOf("EQIX", "quarterly", "2026-03-31", "capex") === "PaymentsToAcquireProductiveAssets" &&
  tagOf("EQIX", "quarterly", "2026-06-30", "capex") === "PaymentsToAcquireOtherPropertyPlantAndEquipment");
nonNull("WULF", "capexOther");
check("WULF's second capex line is 231,350,000 for the half year to 2026-06-30 under capexOther (0 in the first quarter, inferred), beside 1,378,514,000 under capex",
  quarter("WULF", "2026-03-31", "capexOther") === 0 && quarter("WULF", "2026-06-30", "capexOther") === 231350000 &&
  quarter("WULF", "2026-03-31", "capex") + quarter("WULF", "2026-06-30", "capex") === 1378514000,
  JSON.stringify([quarter("WULF", "2026-03-31", "capexOther"), quarter("WULF", "2026-06-30", "capexOther")]));
nonNull("DLR", "capex"); pin("DLR", "capex", "q", "2026-03-31", 870038000);
pin("MSFT", "capex", "a", "2026-06-30", 115948000000); pin("ORCL", "capex", "a", "2026-05-31", 55663000000);
pin("CRWV", "capex", "q", "2026-06-30", 6422000000); pin("APLD", "capex", "a", "2026-05-31", 2865765000);
pin("IREN", "capex", "a", "2026-06-30", 2998006000); pin("AMZN", "capex", "q", "2026-06-30", 54208000000);
check("GOOG capex for the half year is 80,598,000,000, the second quarter 44,924,000,000",
  quarter("GOOG", "2026-06-30", "capex") === 44924000000 && quarter("GOOG", "2026-03-31", "capex") + quarter("GOOG", "2026-06-30", "capex") === 80598000000);
check("META capex for the half year is 49,113,000,000, the second quarter 30,116,000,000",
  quarter("META", "2026-06-30", "capex") === 30116000000 && quarter("META", "2026-03-31", "capex") + quarter("META", "2026-06-30", "capex") === 49113000000);
nonNull("GOOG", "dividendsPaid");
check("GOOG dividends for the half year are 5,231,000,000 (2,542,000,000 under PaymentsOfDividends, the rest under the ordinary tag)",
  quarter("GOOG", "2026-03-31", "dividendsPaid") === 2542000000 && quarter("GOOG", "2026-03-31", "dividendsPaid") + quarter("GOOG", "2026-06-30", "dividendsPaid") === 5231000000);
pin("MSFT", "dividendsPaid", "a", "2026-06-30", 26445000000); pin("ORCL", "dividendsPaid", "a", "2026-05-31", 5787000000);

console.log("balance sheet: debt");
nonNull("CRWV", "totalDebtPrincipal"); pin("CRWV", "totalDebtPrincipal", "q", "2026-06-30", 35551000000);
pin("MSFT", "totalDebtPrincipal", "a", "2026-06-30", 46136000000);
pin("ORCL", "totalDebtPrincipal", "a", "2026-05-31", 130105000000);
check("ORCL's 10-Q instants of the tag are the quarter's issue sizes (18,000,000,000 at 2025-11-30; 43,000,000,000 at 2026-02-28) and are screened out: those quarters serve null",
  quarter("ORCL", "2025-11-30", "totalDebtPrincipal") === null && quarter("ORCL", "2026-02-28", "totalDebtPrincipal") === null &&
  quarter("ORCL", "2026-05-31", "totalDebtPrincipal") === 130105000000 &&
  readInstant(load("ORCL").facts["us-gaap"], ["DebtInstrumentCarryingAmount"]).get("2026-02-28").value === 43000000000,
  JSON.stringify([quarter("ORCL", "2025-11-30", "totalDebtPrincipal"), quarter("ORCL", "2026-02-28", "totalDebtPrincipal")]));
check("the balance sheet still carries Oracle's debt at those dates: 124,718,000,000 long-term plus 9,887,000,000 current at 2026-02-28",
  quarter("ORCL", "2026-02-28", "longTermDebt") + quarter("ORCL", "2026-02-28", "shortTermDebt") === 134605000000);
pin("META", "totalDebtPrincipal", "q", "2026-06-30", 84000000000);
pin("GOOG", "totalDebtPrincipal", "q", "2026-06-30", 101085000000);
pin("IREN", "totalDebtPrincipal", "a", "2026-06-30", 7705649000);
check("AMZN's DebtInstrumentCarryingAmount is its non-current carrying amount (128,894,000,000 = LongTermDebtNoncurrent) and is screened out: the ladder falls through to the 132,995,000,000 face under LongTermDebt",
  quarter("AMZN", "2026-06-30", "totalDebtPrincipal") === 132995000000 && tagOf("AMZN", "quarterly", "2026-06-30", "totalDebtPrincipal") === "LongTermDebt" &&
  quarter("AMZN", "2025-12-31", "totalDebtPrincipal") === 68836000000 &&
  readInstant(load("AMZN").facts["us-gaap"], ["DebtInstrumentCarryingAmount"]).get("2026-06-30").value === 128894000000 &&
  readInstant(load("AMZN").facts["us-gaap"], ["LongTermDebtNoncurrent"]).get("2026-06-30").value === 128894000000,
  String(quarter("AMZN", "2026-06-30", "totalDebtPrincipal")));
nonNull("ORCL", "longTermDebt"); pin("ORCL", "longTermDebt", "a", "2026-05-31", 122342000000);
pin("ORCL", "longTermDebt", "q", "2026-02-28", 124718000000);
check("ORCL's quarter to 2026-02-28 never resolves to the SeniorNotes issue size 42,749,000,000", quarter("ORCL", "2026-02-28", "longTermDebt") !== 42749000000);
pin("APLD", "longTermDebt", "a", "2026-05-31", 4959516000);
pin("EQIX", "longTermDebt", "q", "2026-06-30", 19873000000); pin("EQIX", "longTermDebt", "a", "2025-12-31", 16910000000);
pin("DLR", "longTermDebt", "q", "2026-03-31", 16013977000);
pin("MSFT", "longTermDebt", "a", "2026-06-30", 31067000000);
nonNull("ORCL", "shortTermDebt"); pin("ORCL", "shortTermDebt", "a", "2026-05-31", 7199000000); pin("ORCL", "shortTermDebt", "q", "2026-02-28", 9887000000);
pin("APLD", "shortTermDebt", "a", "2026-05-31", 16422000);
nonNull("IREN", "convertibles"); pin("IREN", "convertibles", "q", "2026-03-31", 3687832000);
nonNull("WULF", "convertibles"); pin("WULF", "convertibles", "q", "2026-06-30", 1101976000);
nonNull("MSFT", "debtFairValue"); pin("MSFT", "debtFairValue", "a", "2026-06-30", 36500000000);
pin("IREN", "debtFairValue", "a", "2026-06-30", 7167336000);
nonNull("CRWV", "interestPayable"); pin("CRWV", "interestPayable", "q", "2026-06-30", 410000000);
check("CRWV remaining performance obligation is 103,700,000,000", quarter("CRWV", "2026-06-30", "remainingPerformanceObligation") === 103700000000);

console.log("balance sheet: leases");
nonNull("MSFT", "financeLeaseLiability"); pin("MSFT", "financeLeaseLiability", "a", "2026-06-30", 66594000000);
pin("ORCL", "financeLeaseLiability", "a", "2026-05-31", 7701000000); pin("CRWV", "financeLeaseLiability", "q", "2026-06-30", 221000000);
pin("AMZN", "financeLeaseLiability", "q", "2026-06-30", 13451000000); pin("META", "financeLeaseLiability", "a", "2025-12-31", 1184000000);
nonNull("GOOG", "financeLeaseAsset"); pin("GOOG", "financeLeaseAsset", "q", "2026-06-30", 5474000000);
nonNull("MSFT", "financeLeaseDue"); pin("MSFT", "financeLeaseDue", "a", "2026-06-30", 89686000000);
pin("MSFT", "financeLeaseDueNextTwelveMonths", "a", "2026-06-30", 7121000000);
pin("MSFT", "financeLeaseDueYearTwo", "a", "2026-06-30", 7294000000);
pin("MSFT", "financeLeaseDueYearThree", "a", "2026-06-30", 6668000000);
pin("MSFT", "financeLeaseDueYearFour", "a", "2026-06-30", 6570000000);
pin("MSFT", "financeLeaseDueYearFive", "a", "2026-06-30", 6543000000);
pin("MSFT", "financeLeaseDueAfterYearFive", "a", "2026-06-30", 55490000000);
check("MSFT's finance-lease buckets sum to the total",
  [7121000000, 7294000000, 6668000000, 6570000000, 6543000000, 55490000000].reduce((a, b) => a + b, 0) === 89686000000);
nonNull("MSFT", "opLeaseDue"); pin("MSFT", "opLeaseDue", "a", "2026-06-30", 24706000000); pin("AMZN", "opLeaseDue", "q", "2026-06-30", 116350000000);

console.log("balance sheet: the maturity ladder");
nonNull("CRWV", "maturityRemainderOfFiscalYear"); pin("CRWV", "maturityRemainderOfFiscalYear", "q", "2026-06-30", 4413000000);
pin("CIFR", "maturityRemainderOfFiscalYear", "q", "2026-06-30", 18476000);
nonNull("MSFT", "maturityNextTwelveMonths"); pin("MSFT", "maturityNextTwelveMonths", "a", "2026-06-30", 9250000000);
pin("MSFT", "maturityYearTwo", "a", "2026-06-30", 0); pin("MSFT", "maturityYearThree", "a", "2026-06-30", 2001000000);
pin("MSFT", "maturityYearFour", "a", "2026-06-30", 0); pin("MSFT", "maturityYearFive", "a", "2026-06-30", 500000000);
pin("MSFT", "maturityAfterYearFive", "a", "2026-06-30", 34385000000);
check("MSFT's ladder sums to its 46,136,000,000 of principal",
  [9250000000, 0, 2001000000, 0, 500000000, 34385000000].reduce((a, b) => a + b, 0) === 46136000000);
pin("ORCL", "maturityNextTwelveMonths", "a", "2026-05-31", 7210000000); pin("ORCL", "maturityYearTwo", "a", "2026-05-31", 10145000000);
pin("ORCL", "maturityYearThree", "a", "2026-05-31", 5500000000); pin("ORCL", "maturityYearFour", "a", "2026-05-31", 7250000000);
pin("ORCL", "maturityYearFive", "a", "2026-05-31", 9750000000); pin("ORCL", "maturityAfterYearFive", "a", "2026-05-31", 90250000000);
check("ORCL's ladder sums to its 130,105,000,000 of principal",
  [7210000000, 10145000000, 5500000000, 7250000000, 9750000000, 90250000000].reduce((a, b) => a + b, 0) === 130105000000);
pin("META", "maturityRemainderOfFiscalYear", "q", "2026-06-30", 0); pin("META", "maturityNextTwelveMonths", "q", "2026-06-30", 2750000000);
pin("META", "maturityYearTwo", "q", "2026-06-30", 1500000000); pin("META", "maturityYearThree", "q", "2026-06-30", 1000000000);
pin("META", "maturityYearFour", "q", "2026-06-30", 5000000000);
check("META's year five and thereafter are not tagged at 2026-06-30 (the ladder falls through to 2025-12-31)",
  quarter("META", "2026-06-30", "maturityYearFive") === null && quarter("META", "2026-06-30", "maturityAfterYearFive") === null &&
  annual("META", "2025-12-31", "maturityAfterYearFive") === 48750000000);
pin("CIFR", "maturityNextTwelveMonths", "q", "2026-06-30", 217105000); pin("CIFR", "maturityYearTwo", "q", "2026-06-30", 296291000);
pin("CIFR", "maturityYearThree", "q", "2026-06-30", 300978000); pin("CIFR", "maturityYearFour", "q", "2026-06-30", 1557594000);

console.log("balance sheet: commitments and backlog");
nonNull("META", "purchaseObligations"); pin("META", "purchaseObligations", "q", "2026-06-30", 349310000000);
pin("AMZN", "purchaseObligations", "q", "2026-06-30", 650034000000);
pin("GOOG", "purchaseObligations", "q", "2026-06-30", 707000000000);
check("GOOG's 707,000,000,000 is a six-month duration fact, read by its end date",
  load("GOOG").facts["us-gaap"].LongTermPurchaseCommitmentAmount.units.USD.some((r) => r.val === 707000000000 && r.start === "2026-01-01" && r.end === "2026-06-30"));
pin("GOOG", "purchaseObligations", "q", "2026-03-31", 232700000000); pin("GOOG", "purchaseObligations", "q", "2025-09-30", 7700000000);
check("GOOG's series is its purchase commitments only: PurchaseObligation to 2025-12-31, LongTermPurchaseCommitmentAmount from 2026-03-31, and the uncommenced leases never displace either",
  tagOf("GOOG", "quarterly", "2025-12-31", "purchaseObligations") === "PurchaseObligation" &&
  tagOf("GOOG", "quarterly", "2026-03-31", "purchaseObligations") === "LongTermPurchaseCommitmentAmount" &&
  !series("GOOG").quarterly.some((p) => (p.tags || {})["balanceSheet.purchaseObligations"] === "UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount"));
nonNull("META", "unrecordedPurchaseObligations"); pin("META", "unrecordedPurchaseObligations", "q", "2026-06-30", 278990000000);
pin("GOOG", "unrecordedPurchaseObligations", "q", "2026-03-31", 75600000000); pin("GOOG", "unrecordedPurchaseObligations", "q", "2025-09-30", 42600000000);
pin("ORCL", "unrecordedPurchaseObligations", "a", "2026-05-31", 13309000000);
check("the served tag labels Meta's and Alphabet's uncommenced leases and leaves Oracle's obligation as the concept names it",
  labelFor("unrecordedPurchaseObligations", tagOf("META", "quarterly", "2026-06-30", "unrecordedPurchaseObligations"), 1326801) === "Leases not yet commenced" &&
  labelFor("unrecordedPurchaseObligations", tagOf("GOOG", "quarterly", "2026-03-31", "unrecordedPurchaseObligations"), 1652044) === "Leases not yet commenced" &&
  labelFor("unrecordedPurchaseObligations", tagOf("ORCL", "annual", "2026-05-31", "unrecordedPurchaseObligations"), 1341439) === null);
nonNull("AMZN", "contractualObligationRemainderOfFiscalYear"); pin("AMZN", "contractualObligationRemainderOfFiscalYear", "q", "2026-06-30", 42752000000);
pin("AMZN", "contractualObligationNextTwelveMonths", "q", "2026-06-30", 78084000000);
pin("AMZN", "contractualObligationYearTwo", "q", "2026-06-30", 53406000000);
pin("AMZN", "contractualObligationYearThree", "q", "2026-06-30", 46767000000);
pin("AMZN", "contractualObligationYearFour", "q", "2026-06-30", 42219000000);
pin("AMZN", "contractualObligationYearFive", "a", "2025-12-31", 32153000000);
pin("AMZN", "contractualObligationAfterYearFive", "a", "2025-12-31", 241480000000);
pin("META", "contractualObligationRemainderOfFiscalYear", "q", "2026-06-30", 53520000000);
pin("META", "contractualObligationNextTwelveMonths", "q", "2026-06-30", 81650000000);
nonNull("APLD", "lessorBacklog"); pin("APLD", "lessorBacklog", "a", "2026-05-31", 35844882000);
pin("APLD", "lessorBacklogNextTwelveMonths", "a", "2026-05-31", 451065000);
pin("APLD", "lessorBacklogYearTwo", "a", "2026-05-31", 1453748000);
pin("APLD", "lessorBacklogYearThree", "a", "2026-05-31", 2251769000);
pin("APLD", "lessorBacklogYearFour", "a", "2026-05-31", 2280829000);
pin("APLD", "lessorBacklogYearFive", "a", "2026-05-31", 2299574000);
pin("APLD", "lessorBacklogThereafter", "a", "2026-05-31", 27107897000);
check("APLD's backlog buckets sum to the total",
  [451065000, 1453748000, 2251769000, 2280829000, 2299574000, 27107897000].reduce((a, b) => a + b, 0) === 35844882000);
pin("IREN", "lessorBacklog", "a", "2026-06-30", 11400000000);

console.log("balance sheet: cash, partners and exposures");
/* META tags the cash-flow-statement figure (702,000,000) beside a non-current escrow (13,107,000,000): a total cannot be below one of its parts, so the two are added (SUM_FIRST); CRWV's 873,000,000 is not below its 507,000,000 non-current tag and stands alone */
nonNull("META", "restrictedCash"); pin("META", "restrictedCash", "q", "2026-06-30", 13809000000);
check("META's restricted cash says it is two lines", tagOf("META", "quarterly", "2026-06-30", "restrictedCash") === "RestrictedCashAndCashEquivalentsAtCarryingValue+RestrictedCashAndCashEquivalentsNoncurrent");
pin("CRWV", "restrictedCash", "q", "2026-06-30", 873000000);
pin("IREN", "restrictedCash", "q", "2026-06-30", 1723936000);
check("META finance-lease additions are annual only: the year to 2025-12-31 is 613,000,000 and its fourth quarter is null, never inferred as the whole year",
  annual("META", "2025-12-31", "financeLeaseAdditions") === 613000000 && quarter("META", "2025-12-31", "financeLeaseAdditions") === null);
check("APLD's restricted cash is the sum of its current and non-current tags, 2,381,027,000 + 180,415,000 = 2,561,442,000 (SUM_FIRST), not the 10,500,000 under its whole-balance tag; the escrowed 2,381,027,000 is still readable per tag",
  annual("APLD", "2026-05-31", "restrictedCash") === 2561442000 && tagOf("APLD", "annual", "2026-05-31", "restrictedCash") === "RestrictedCashCurrent+RestrictedCashNoncurrent" &&
  readInstant(load("APLD").facts["us-gaap"], ["RestrictedCashCurrent"]).get("2026-05-31").value === 2381027000);
nonNull("GOOG", "liquidity"); pin("GOOG", "liquidity", "q", "2026-06-30", 242474000000);
pin("META", "liquidity", "q", "2026-06-30", 74798000000); pin("MSFT", "liquidity", "a", "2026-06-30", 76843000000);
check("MSFT's short-term investments alone are 55,908,000,000, under the third tag",
  readInstant(load("MSFT").facts["us-gaap"], ["ShortTermInvestments"]).get("2026-06-30").value === 55908000000);
nonNull("APLD", "redeemableNci"); pin("APLD", "redeemableNci", "a", "2026-05-31", 1956303000);
nonNull("GOOG", "nciVie"); pin("GOOG", "nciVie", "q", "2026-06-30", 7100000000);
nonNull("ORCL", "preferredStock"); pin("ORCL", "preferredStock", "a", "2026-05-31", 4954000000); pin("DLR", "preferredStock", "q", "2026-03-31", 731690000);
nonNull("ORCL", "constructionInProgress"); pin("ORCL", "constructionInProgress", "a", "2026-05-31", 39973000000);
pin("DLR", "constructionInProgress", "q", "2026-03-31", 5381071000);
nonNull("META", "equityMethodInvestments"); pin("META", "equityMethodInvestments", "q", "2026-06-30", 9406000000);
pin("EQIX", "equityMethodInvestments", "q", "2026-06-30", 751000000);
nonNull("CRWV", "vieMaxExposure"); pin("CRWV", "vieMaxExposure", "q", "2026-06-30", 1800000000);
pin("META", "vieMaxExposure", "q", "2026-06-30", 6410000000); pin("EQIX", "vieMaxExposure", "q", "2026-06-30", 1620000000);
nonNull("GOOG", "guaranteeExposure"); pin("GOOG", "guaranteeExposure", "q", "2026-06-30", 7600000000);

console.log("balance sheet and income: the widened ladders");
nonNull("META", "ppe"); pin("META", "ppe", "q", "2026-06-30", 225724000000);
pin("GOOG", "ppe", "q", "2026-06-30", 321212000000); pin("AMZN", "ppe", "q", "2026-06-30", 446046000000);
pin("MSFT", "ppe", "a", "2026-06-30", 313076000000);
check("MSFT keeps the plain PP&E tag: no combined tag in its feed",
  !load("MSFT").facts["us-gaap"].PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization);
nonNull("META", "interestExpense"); pin("META", "interestExpense", "q", "2026-06-30", 754000000);
pin("META", "interestExpense", "a", "2025-12-31", 1165000000);
nonNull("CRWV", "interestExpense"); pin("CRWV", "interestExpense", "q", "2026-06-30", 558000000);
pin("MSFT", "interestExpense", "a", "2026-06-30", 3051000000); pin("ORCL", "interestExpense", "a", "2026-05-31", 4599000000);
pin("GOOG", "interestExpense", "q", "2026-06-30", 1278000000); pin("AMZN", "interestExpense", "q", "2026-06-30", 1314000000);
pin("EQIX", "interestExpense", "q", "2026-06-30", 151000000); pin("DLR", "interestExpense", "q", "2026-03-31", 116384000);
pin("IREN", "interestExpense", "a", "2026-06-30", 59251000);

console.log("the same-tag rule: arithmetic across periods");
const mrk = buildStatements(loadFile("mrk-companyfacts-slice.json").facts["us-gaap"]);
const mq = (end) => mrk.quarterly.find((p) => p.periodEnd === end), my = (end) => mrk.annual.find((p) => p.periodEnd === end), ml = (end) => mrk.ltm.find((p) => p.periodEnd === end);
check("MRK 2020 D&A is depreciation alone, 1,669,000,000, from the fill tag (no combined tag in the 10-K; the composite fill was removed)",
  my("2020-12-31").cashFlow.depreciationAmortization === 1669000000 && my("2020-12-31").tags["cashFlow.depreciationAmortization"] === "Depreciation",
  String(my("2020-12-31").cashFlow.depreciationAmortization));
check("MRK's three quarters of 2020 are the combined tag (821 / 1,048 / 852 million)",
  mq("2020-03-31").cashFlow.depreciationAmortization === 821000000 && mq("2020-06-30").cashFlow.depreciationAmortization === 1048000000 &&
  mq("2020-09-30").cashFlow.depreciationAmortization === 852000000 && mq("2020-03-31").tags["cashFlow.depreciationAmortization"] === "DepreciationDepletionAndAmortization");
check("MRK Q4 2020 D&A is null, never the year less the quarters (-1,052,000,000), and no trailing year mixes the two",
  mq("2020-12-31") && mq("2020-12-31").cashFlow.depreciationAmortization === null &&
  ml("2021-06-30").cashFlow.depreciationAmortization === null && ml("2021-09-30").cashFlow.depreciationAmortization === null &&
  !mrk.quarterly.some((p) => typeof p.cashFlow.depreciationAmortization === "number" && p.cashFlow.depreciationAmortization < 0),
  JSON.stringify([mq("2020-12-31") && mq("2020-12-31").cashFlow.depreciationAmortization, ml("2021-06-30").cashFlow.depreciationAmortization]));
const wmt = buildStatements(loadFile("wmt-companyfacts-slice.json").facts["us-gaap"]);
const wq = (end) => wmt.quarterly.find((p) => p.periodEnd === end), wy = (end) => wmt.annual.find((p) => p.periodEnd === end), wl = (end) => wmt.ltm.find((p) => p.periodEnd === end);
check("WMT fiscal 2025: one quarter under InterestIncomeExpenseNet (-600,000,000), two under InterestExpenseDebt (557,000,000; 496,000,000), the year 2,249,000,000",
  wq("2024-04-30").incomeStatement.interestExpense === -600000000 && wq("2024-04-30").tags["incomeStatement.interestExpense"] === "InterestIncomeExpenseNet" &&
  wq("2024-07-31").incomeStatement.interestExpense === 557000000 && wq("2024-10-31").incomeStatement.interestExpense === 496000000 &&
  wq("2024-07-31").tags["incomeStatement.interestExpense"] === "InterestExpenseDebt" && wy("2025-01-31").incomeStatement.interestExpense === 2249000000);
check("WMT Q4 FY2025 interest is null, never 1,796,000,000, and the trailing years that would mix the tags are null",
  wq("2025-01-31") && wq("2025-01-31").incomeStatement.interestExpense === null &&
  wl("2025-01-31").incomeStatement.interestExpense === null && wl("2025-04-30").incomeStatement.interestExpense === null,
  JSON.stringify([wq("2025-01-31") && wq("2025-01-31").incomeStatement.interestExpense, wl("2025-04-30").incomeStatement.interestExpense]));
check("every period carries the tag each line resolved from, and no tag is named for a null line",
  [...series("MSFT").annual, ...series("GOOG").quarterly, ...series("AMZN").ltm].every((p) => p.tags && Object.entries(p.tags).every(([path, tag]) => {
    const [stmt, key] = path.split("."); return typeof tag === "string" && typeof p[stmt][key] === "number"; })));

console.log("the history cut: a shell's years never reach the panel");
const wulfHist = loadFile("wulf-history-slice.json").facts["us-gaap"], nbisHist = loadFile("nbis-history-slice.json").facts["us-gaap"];
const yearsOf = (bucket) => Object.keys(panelYears(buildStatements(bucket, { annualLimit: 25, quarterLimit: 1 }))).map(Number);
check("the IKONICS years are in TeraWulf's feed and are cut at 2022-01-01 (cohorts.json historyStart)",
  yearsOf(wulfHist).some((y) => y < 2022) && yearsOf(trimHistory(wulfHist, "2022-01-01")).every((y) => y >= 2022) && yearsOf(trimHistory(wulfHist, "2022-01-01")).includes(2025),
  JSON.stringify([yearsOf(wulfHist), yearsOf(trimHistory(wulfHist, "2022-01-01"))]));
check("the Yandex years are in Nebius's feed and are cut at 2024-01-01",
  yearsOf(nbisHist).some((y) => y < 2024) && yearsOf(trimHistory(nbisHist, "2024-01-01")).join() === "2024,2025",
  JSON.stringify([yearsOf(nbisHist), yearsOf(trimHistory(nbisHist, "2024-01-01"))]));
const cohorts = JSON.parse(readFileSync(join(here, "../frontend/data/cohorts.json"), "utf8"));
const cohortRow = (t) => [...cohorts.hyperscalers, ...cohorts.neoclouds, ...cohorts.landlords].find((r) => r.ticker === t);
check("cohorts.json names the two starts and no other", cohortRow("WULF").historyStart === "2022-01-01" && cohortRow("NBIS").historyStart === "2024-01-01" &&
  [...cohorts.hyperscalers, ...cohorts.neoclouds, ...cohorts.landlords].filter((r) => r.historyStart).length === 2);

console.log("the overview pull");
const apld = buildPayload({ ticker: "APLD", cik: 1144879, name: "Applied Digital Corp." }, factsFromCompanyFacts(load("APLD")));
check("APLD's quarter to 2026-02-28 has no NetIncomeLoss row (the 10-Q tags ProfitLoss), so net income and computed EPS are null, never 0 less the prior quarter's -31,376,000",
  apld.periodEnd === "2026-02-28" && apld.fundamentals.incomeStatement.netIncome.q === null && apld.earnings.epsComputed.q === null,
  JSON.stringify([apld.periodEnd, apld.fundamentals.incomeStatement.netIncome.q, apld.earnings.epsComputed.q]));
const orclPayload = buildPayload({ ticker: "ORCL", cik: 1341439, name: "Oracle Corporation" }, factsFromCompanyFacts(load("ORCL")));
check("ORCL's overview shows the largest (fy, fp) slot, the quarter to 2026-02-28 (Q3 FY2026) against the quarter to 2025-02-28, a true year-over-year pair; the quarter to 2026-08-31 sits in the fy=2026 fp=Q1 slot and would pair with August 2024, so it waits for a new slot (sec-pull.mjs latestQuarter); the cover shares and latestFiling still come from the newest filing",
  orclPayload.periodEnd === "2026-02-28" && orclPayload.fundamentals.cashFlow.cfOps.q === 7151000000 && orclPayload.fundamentals.cashFlow.cfOps.ly === 5933000000 &&
  orclPayload.period.compareLabel === "Q3 2025" && orclPayload.period.isLabel === "3 mo ended Feb 28, 2026" &&
  orclPayload.shares.outstanding === 3023736000 && orclPayload.latestFiling.accession === "0001193125-26-389274",
  JSON.stringify([orclPayload.periodEnd, orclPayload.fundamentals.cashFlow.cfOps.q, orclPayload.shares.outstanding]));
check("and the statements name the two first quarters Q1 FY2026 and Q1 FY2027",
  periodOf("ORCL", "quarterly", "2025-08-31").label === "Q1 FY2026" && periodOf("ORCL", "quarterly", "2026-08-31").label === "Q1 FY2027",
  JSON.stringify([periodOf("ORCL", "quarterly", "2025-08-31").label, periodOf("ORCL", "quarterly", "2026-08-31").label]));
check("the capex adjustments file carries IREN's hardware line and Cipher's deposits with accessions, and sums to the refuted ledger",
  (() => {
    const adj = JSON.parse(readFileSync(join(here, "../frontend/data/capex-adjustments.json"), "utf8")).adjustments;
    const v = (t, end) => adj.find((r) => r.ticker === t && r.end === end).value;
    return adj.every((r) => /^\d{10}-\d{2}-\d{6}$/.test(r.accession) && r.cik && r.start && r.end && typeof r.value === "number") &&
      v("IREN", "2026-06-30") === 1335081000 && v("IREN", "2026-06-30") + annual("IREN", "2026-06-30", "capex") === 4333087000 &&
      v("CIFR", "2024-12-31") === 162958000 && v("CIFR", "2025-12-31") === 4874000;
  })());

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
