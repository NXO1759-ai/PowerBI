/**
 * test-bdc-series.mjs — the BDC concept map and series builder against
 * two real companyfacts feeds, offline.
 *
 * Fixtures (scripts/fixtures/bdc/, pulled 2026-09-11): Ares Capital
 * (CIK 1287750, December year end) and Prospect Capital (CIK 1287032,
 * June 30 year end), each sliced to the tags in BDC_CONCEPTS plus the
 * dei cover shares and PSEC's LineOfCredit; Hercules Capital (CIK
 * 1280784), Trinity Capital (CIK 1786108) and Franklin BSP Capital (CIK
 * 1825248) sliced the same way from 2020 (FRBP from 2019); Main Street
 * Capital (CIK 1396440) from 2023, Neostellar Capital, formerly SuRo
 * (CIK 1509470) from 2020, Oxford Square Capital (CIK 1259429) from
 * 2022 and Nuveen Churchill Direct Lending (CIK 1737924) from 2021; and
 * Ares Capital's rows of the CY2026Q2 frames for NAV per share,
 * NetInvestmentIncome, asset coverage and portfolio fair value. Every
 * figure asserted below is read off the filing named beside it or off
 * pc-x/verified-facts.md; none is from memory.
 *
 *   ARCC 10-Q for the quarter to 2026-06-30, filed 2026-07-29,
 *     accession 0001628280-26-050307
 *   ARCC 10-Q for the quarter to 2026-03-31, filed 2026-04-28,
 *     accession 0001628280-26-027688 (the Q1 YTD figures differenced out)
 *   ARCC 10-Q for the quarter to 2025-06-30, filed 2025-07-29,
 *     accession 0001287750-25-000038 (restates the 2024 first half)
 *   PSEC 10-K for the fiscal year to 2026-06-30, filed 2026-08-20,
 *     accession 0001287032-26-000269
 *   PSEC 10-K for the fiscal year to 2025-06-30, filed 2025-08-26,
 *     accession 0001287032-25-000232
 *   PSEC 10-Q for the nine months to 2026-03-31, filed 2026-05-07,
 *     accession 0001287032-26-000164
 *   HTGC 10-Q for the quarter to 2026-06-30, filed 2026-07-30,
 *     accession 0001280784-26-000042
 *   TRIN 10-Q for the quarter to 2023-03-31, filed 2023-05-04,
 *     accession 0000950170-23-017817 (carries the 2022-03-31 comparatives)
 *   TRIN 10-Q for the quarter to 2026-06-30, filed 2026-08-05,
 *     accession 0001193125-26-333907
 *   FRBP 10-K for 2022, filed 2023-03-15, accession 0001825248-23-000004
 *     (carries the 2020-12-31 comparative) and 10-K for 2023, filed
 *     2024-03-15, accession 0001825248-24-000007
 *   MAIN 10-Q for the quarter to 2024-03-31, filed 2024-05-10,
 *     accession 0001396440-24-000082 (NII per share 1.05, never
 *     restated) and 10-Q for the quarter to 2025-06-30, filed
 *     2025-08-08, accession 0001396440-25-000102 (restates the 2024
 *     first half to the after-tax presentation: 1.99 per share,
 *     83,899,000 for the second quarter over 86,194,092 shares)
 *   NSLR 10-Q for the quarter to 2026-06-30, filed 2026-08-06,
 *     accession 0001493152-26-036285 (per-share tag 0.19 against a net
 *     investment loss of 23,354,684 over 25,983,140 shares)
 *   OXSQ 10-Q for the quarter to 2023-03-31, filed 2023-05-02,
 *     accession 0001213900-23-035636 (NetInvestmentIncome 6,490,784,
 *     0.13 over 49,858,366 shares) and 10-Q for the quarter to
 *     2024-03-31, filed 2024-05-03, accession 0001213900-24-039266
 *     (its comparative swaps the tag to 12,941,798); 10-Q for the
 *     quarter to 2026-06-30, filed 2026-08-10, accession
 *     0001213900-26-087243 (cost 23,834,191 and fair value 15,409,950
 *     tagged against assets of 290,605,053)
 *   NCDL 10-Q for the quarter to 2023-06-30, filed 2023-08-04,
 *     accession 0001628280-23-027497 (weighted basic shares
 *     22,212,400,000 for the quarter to 2022-06-30 against 22,691,144
 *     outstanding, NAV 18.76 and net assets 425,773,000; 18,330,000 of
 *     after-tax NII and 1.20 per share for the 2023 first half) and 10-Q
 *     for the quarter to 2024-06-30, filed 2024-08-07, accession
 *     0001628280-24-035331 (restates the 2023 second quarter to
 *     18,706,000 and 1.23 per share, and the share count to 30,621,009)
 *   OXSQ 10-K for 2023, filed 2024-03-19, accession 0001213900-24-023660
 *     (NetInvestmentIncome 51,824,181 for the year, the swapped
 *     InvestmentIncomeNet figure; the 10-K for 2025, filed 2026-03-06,
 *     accession 0001213900-26-024280, corrects it to 27,359,939) and
 *     10-Q for the nine months to 2023-09-30, filed 2023-11-08,
 *     accession 0001213900-23-084801 (19,595,383)
 *   HRZN (CIK 1487428, sliced from 2020): 10-Q for the quarter to
 *     2022-09-30, filed 2022-11-01, accession 0001437749-22-025382
 *     (NII per share -0.40 for the nine months, on another basis);
 *     10-Q for the quarter to 2023-09-30, filed 2023-10-31, accession
 *     0001437749-23-029551 (restates the nine months of 2022 to 1.06,
 *     and carries 25,447,000 of after-tax NII for them); 10-K for
 *     2022, filed 2023-02-28, accession 0001437749-23-004919 (1.46
 *     per share for the year, 24,726,079 weighted shares, 27,753,373
 *     outstanding); 10-K for 2023, filed 2024-02-27, accession
 *     0001437749-24-005719 (36,187,000 of after-tax NII for 2022)
 *   TSLX (CIK 1508655, sliced from 2020): 10-Q for the quarter to
 *     2023-03-31, filed 2023-05-08, accession 0000950170-23-018777
 *     (distributions per share 0.02 for the quarter to 2022-03-31, the
 *     supplemental alone, against NII per share 0.47 and NAV 16.88);
 *     10-Q for the quarter to 2023-09-30, filed 2023-11-02, accession
 *     0000950170-23-058321 (0.03 for the nine months); 10-K for 2025,
 *     filed 2026-02-12, accession 0001193125-26-048664 (2.10 for 2023,
 *     the only row for the year)
 *   CGBD (CIK 1544206, sliced from 2021): 10-Q for the quarter to
 *     2023-03-31, filed 2023-05-09, accession 0001544206-23-000043
 *     (for the quarter to 2022-03-31: NetInvestmentIncome 25,872,000,
 *     PreferredStockDividendsIncomeStatementImpact 875,000, 52,892,054
 *     weighted shares, 0.47 per share)
 *   MSIF (CIK 1535778, sliced from 2023): 10-Q for the quarter to
 *     2024-09-30, filed 2024-11-14, accession 0001535778-24-000189
 *     (0.54 of NII per share and 0.54 of distributions for the nine
 *     months, before the reverse split); 10-Q for the quarter to
 *     2025-09-30, filed 2025-11-14, accession 0001535778-25-000148
 *     (restates them to 1.00 and 1.09); 10-K for 2024, filed
 *     2025-03-20, accession 0001535778-25-000073 (1.43 and 1.45 for the
 *     year, 40,174,311 weighted shares, 40,240,358 outstanding)
 *   GLAD (CIK 1143513, September year end, sliced from 2024): 10-Q for
 *     the quarter to 2026-06-30, filed 2026-08-04, accession
 *     0001143513-26-000012 (DebtInstrumentCarryingAmount 259,500,000,
 *     LineOfCredit 177,500,000, Liabilities 439,377,000)
 *   GAIN (CIK 1321741, March year end, sliced from 2024): 10-Q for the
 *     quarter to 2024-06-30, filed 2024-08-05, accession
 *     0001321741-24-000013 (DebtInstrumentCarryingAmount 400,938,000,
 *     LineOfCredit 63,700,000, Liabilities 436,826,000) and 10-Q for
 *     the quarter to 2024-09-30, filed 2024-11-07, accession
 *     0001321741-24-000017 (346,138,000, 8,900,000, 410,405,000)
 *   BBDC (CIK 1379785, sliced from 2025): 10-Q for the quarter to
 *     2026-06-30, filed 2026-08-05, accession 0001379785-26-000030
 *     (LongTermDebt 1,117,489,000, LineOfCredit 277,226,000,
 *     Liabilities 1,438,325,000)
 *   PSEC 10-Q for the quarter to 2026-03-31 (above):
 *     InvestmentCompanyDividendDistribution 92,123,000 and
 *     PreferredStockDividendsIncomeStatementImpact 26,702,000 for the
 *     quarter, 483,414,178 weighted shares, 78,457,000 of after-tax
 *     NII and 0.16 per share
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BDC_CONCEPTS, buildBdcSeries, mergeFrames, readPure, MERGERS, chooseNii, settleNiiLadder, tagVerdict,
  niiOverShares, sharesOffScale, lienClass, LIEN, classifyAffiliation, isVehicle, bdcFiscalYear,
  fourthQuarterShares, largeGap, NII_DERIVED_TOLERANCE,
} from "./lib/bdc-concepts.mjs";
import { frameUnitPath, frameUrl } from "./lib/sec-pull.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, "fixtures/bdc", f), "utf8"));
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};
const within = (v, target, tol) => typeof v === "number" && Math.abs(v - target) <= Math.abs(target) * tol;
const val = (p, key) => (p && p.values[key] ? p.values[key].v : undefined);

/* ---------- the concept map ---------- */

const UNITS = new Set(["USD", "USD/shares", "pure", "shares"]);
check("every concept carries key, ladder, unit, kind, ytd and label",
  Object.entries(BDC_CONCEPTS).every(([k, c]) => c.key === k && Array.isArray(c.tags) && c.tags.length &&
    UNITS.has(c.unit) && (c.kind === "instant" || c.kind === "duration") &&
    typeof c.ytd === "boolean" && typeof c.label === "string"));
check("asset coverage and cost of debt are pure, never USD",
  BDC_CONCEPTS.assetCoverage.unit === "pure" && BDC_CONCEPTS.costOfDebt.unit === "pure");
check("NAV per share is USD/shares", BDC_CONCEPTS.navPerShare.unit === "USD/shares");
const tagsOf = (c) => c.tags.flatMap((s) => (typeof s === "string" ? [s] : s.minus));
check("PaidInKindInterest is the cash-flow adjustment only, never a PIK income tag",
  tagsOf(BDC_CONCEPTS.pikNonCashAdjustment).includes("PaidInKindInterest") &&
  !tagsOf(BDC_CONCEPTS.pikInterestIncome).includes("PaidInKindInterest") &&
  !tagsOf(BDC_CONCEPTS.pikDividendIncome).includes("PaidInKindInterest"));
check("the debt ladder never carries LineOfCredit", !tagsOf(BDC_CONCEPTS.debt).includes("LineOfCredit"));
check("the NII ladder has the four steps in order",
  BDC_CONCEPTS.niiAfterTax.tags[0] === "InvestmentIncomeOperatingAfterExpenseAndTax" &&
  BDC_CONCEPTS.niiAfterTax.tags[1].minus.join(",") === "NetInvestmentIncome,InvestmentIncomeOperatingTaxExpenseBenefit" &&
  BDC_CONCEPTS.niiAfterTax.tags[2] === "NetInvestmentIncome" && BDC_CONCEPTS.niiAfterTax.tags[3] === "InvestmentIncomeNet");
check("total assets and the combined cash tag are in the map",
  tagsOf(BDC_CONCEPTS.totalAssets).includes("Assets") &&
  tagsOf(BDC_CONCEPTS.cash)[2] === "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents" &&
  /restricted/.test(BDC_CONCEPTS.cash.stepNotes[2]));
check("the positive flows are marked, only distributions carry a band, and the volatile ones carry neither",
  ["distributionsPerShare", "distributionsDollars", "managementFee", "interestExpense", "totalInvestmentIncome", "totalExpenses"]
    .every((k) => BDC_CONCEPTS[k].positive === true) &&
  ["distributionsPerShare", "distributionsDollars"].every((k) => Array.isArray(BDC_CONCEPTS[k].band)) &&
  ["managementFee", "interestExpense", "totalInvestmentIncome", "totalExpenses"].every((k) => !BDC_CONCEPTS[k].band) &&
  ["niiAfterTax", "realizedGains", "unrealizedGains", "incentiveFeeIncome"].every((k) => !BDC_CONCEPTS[k].positive));

/* ---------- frames unit path (pure, no network) ---------- */

check("USD/shares maps to the USD-per-shares path segment", frameUnitPath("USD/shares") === "USD-per-shares");
check("USD and pure pass through unchanged", frameUnitPath("USD") === "USD" && frameUnitPath("pure") === "pure");
/* the URL that answered 200 with 314 filers on 2026-09-11 */
check("frameUrl spells the NAV frame the way EDGAR serves it",
  frameUrl("NetAssetValuePerShare", "USD/shares", "CY2026Q2I") ===
  "https://data.sec.gov/api/xbrl/frames/us-gaap/NetAssetValuePerShare/USD-per-shares/CY2026Q2I.json");

/* ---------- ARCC, December year end ---------- */

const arcc = load("arcc-companyfacts-slice.json");
const A = buildBdcSeries(arcc.facts, { fyEndMonth: 12 });
const a2 = A.periods.find((p) => p.end === "2026-06-30");
check("ARCC has a period labelled 2026-06-30, fiscal 2026 Q2", !!a2 && a2.fy === 2026 && a2.fq === 2, a2 && `${a2.fy} Q${a2.fq}`);
check("every period is labelled by a calendar date, never a quarter number",
  A.periods.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.end) && Number.isInteger(p.fq) && p.fq >= 1 && p.fq <= 4));
check("periods are sorted ascending and at most 32", A.periods.length <= 32 &&
  A.periods.every((p, i) => i === 0 || p.end > A.periods[i - 1].end));
/* balance sheet at June 30 2026, 10-Q 0001628280-26-050307 */
check("NAV per share 19.35", val(a2, "navPerShare") === 19.35, String(val(a2, "navPerShare")));
check("NAV per share keeps its unit", a2.values.navPerShare.unit === "USD/shares" && a2.values.navPerShare.periodType === "instant");
check("portfolio at cost 29,674,600,000 within 0.1%", within(val(a2, "portfolioCost"), 29674600000, 0.001), String(val(a2, "portfolioCost")));
check("portfolio at fair value 29,349,300,000 within 0.1%", within(val(a2, "portfolioFairValue"), 29349300000, 0.001), String(val(a2, "portfolioFairValue")));
check("net assets 13.89B within 0.5% (StockholdersEquity)", within(val(a2, "netAssets"), 13.89e9, 0.005) && a2.values.netAssets.tag === "StockholdersEquity", String(val(a2, "netAssets")));
check("debt 15.92B within 0.5% (DebtInstrumentCarryingAmount)", within(val(a2, "debt"), 15.92e9, 0.005) && a2.values.debt.tag === "DebtInstrumentCarryingAmount", String(val(a2, "debt")));
/* the three months to June 30 2026: after-tax NII $359M against $367M
   before $8M of income and excise tax, same 10-Q */
const nii = a2.values.niiAfterTax;
check("NII after tax 359,000,000 for the three months, from the after-tax tag",
  !!nii && nii.v === 359000000 && nii.tag === "InvestmentIncomeOperatingAfterExpenseAndTax" && nii.periodType === "3M" &&
  nii.start === "2026-04-01" && nii.end === "2026-06-30", nii && `${nii.v} ${nii.tag} ${nii.periodType}`);
check("NII before tax 367,000,000 and tax 8,000,000", val(a2, "niiPreTax") === 367000000 && val(a2, "niiTax") === 8000000);
check("the value carries form, filed, accession and source",
  nii.form === "10-Q" && nii.filed === "2026-07-29" && nii.accn === "0001628280-26-050307" && nii.source === "companyfacts");
/* NII per share is tagged year to date: 1.05 for the half year less 0.55
   for the first quarter (10-Q 0001628280-26-027688) is 0.50 */
const nps = a2.values.niiPerShare;
check("NII per share 0.50 differenced from the H1 YTD 1.05 less Q1 0.55, labelled 3M and ytd-differenced",
  !!nps && nps.v === 0.5 && nps.periodType === "3M" && nps.derived === "ytd-differenced" && nps.differenced === true &&
  nps.start === "2026-04-01" && nps.basis && nps.basis.lessEnd === "2026-03-31" && nps.basis.rows === "latest",
  nps && `${nps.v} ${nps.periodType} ${nps.derived} ${JSON.stringify(nps.basis)}`);
check("NII per share is the after-tax NII over weighted shares within a cent",
  Math.abs(359000000 / val(a2, "weightedShares") - 0.5) < 0.01, String(359000000 / val(a2, "weightedShares")));
check("the cross-check is recorded on the NII value",
  nii.crossCheck && nii.crossCheck.basis === "perShare" && nii.crossCheck.reconciles === true &&
  nii.crossCheck.perShare === 0.5 && nii.crossCheck.shares === 718000000, JSON.stringify(nii.crossCheck));
check("no value is labelled YTD while differenced",
  A.periods.every((p) => Object.values(p.values).every((v) => !v || !(v.periodType === "YTD" && v.differenced))));
/* the 2025 10-Q (0001287750-25-000038) restated the 2024 first half to
   1.17 per share and 386,000,000 of after-tax NII (the 2024 10-Q,
   0001287750-24-000039, said 1.13 and 358,000,000) but left the nine
   months at 1.70: the second quarter reconciles on the restated pair
   (1.17 - 0.55 = 0.62 against 386,000,000 over 616,000,000) and the
   third only on the original pair (1.70 - 1.13 = 0.57 against
   361,000,000 over 635,000,000) */
const a24q2 = A.periods.find((p) => p.end === "2024-06-30"), a24q3 = A.periods.find((p) => p.end === "2024-09-30");
check("ARCC Q2 2024 NII per share 0.62 from the restated pair, the original 1.13 recorded",
  !!a24q2 && val(a24q2, "niiPerShare") === 0.62 && a24q2.values.niiPerShare.basis.rows === "latest" &&
  a24q2.values.niiPerShare.basis.original && a24q2.values.niiPerShare.basis.original.v === 1.13 &&
  val(a24q2, "niiAfterTax") === 386000000 && a24q2.values.niiAfterTax.crossCheck.reconciles === true,
  a24q2 && JSON.stringify(a24q2.values.niiPerShare.basis));
check("ARCC Q3 2024 NII per share 0.57 from the pair the cross-check chose",
  !!a24q3 && val(a24q3, "niiPerShare") === 0.57 && a24q3.values.niiPerShare.basis.rows === "original" &&
  /cross-check/.test(a24q3.values.niiPerShare.note) && val(a24q3, "niiAfterTax") === 361000000 &&
  a24q3.values.niiAfterTax.crossCheck.reconciles === true, a24q3 && `${val(a24q3, "niiPerShare")} ${JSON.stringify(a24q3.values.niiAfterTax.crossCheck)}`);
check("ARCC raises no NII flag", !A.flags.some((f) => f.key === "niiAfterTax"), JSON.stringify(A.flags.filter((f) => f.key === "niiAfterTax")));
/* distributions: 0.96 for the half year less 0.48 for the first quarter */
check("distributions per share 0.48 from the YTD tag, not the declared-dividend tag",
  val(a2, "distributionsPerShare") === 0.48 && a2.values.distributionsPerShare.tag === "InvestmentCompanyDistributionToShareholdersPerShare");
/* PIK interest income: 110,000,000 for the half year less 52,000,000 for
   the first quarter (blueprint 3.3 reads the same $58M off the 10-Q) */
check("PIK interest income 58,000,000 for the quarter, from the income tag",
  val(a2, "pikInterestIncome") === 58000000 && a2.values.pikInterestIncome.tag === "InterestIncomeOperatingPaidInKind");
check("the cash-flow PIK add-back is a separate concept", a2.values.pikNonCashAdjustment.tag === "PaidInKindInterest" &&
  a2.values.pikNonCashAdjustment.note && /not income/.test(a2.values.pikNonCashAdjustment.note));
/* total return is a ratio tagged year to date and is kept as YTD */
check("total return 0.0189 kept as YTD, not differenced",
  val(a2, "totalReturn") === 0.0189 && a2.values.totalReturn.periodType === "YTD" && a2.values.totalReturn.start === "2026-01-01");
/* asset coverage, unit pure: 1.86 at June 30 2026 (frames CY2026Q2I and the 10-Q) */
if (a2.values.assetCoverage) {
  check("asset coverage 1.86 read as pure", val(a2, "assetCoverage") === 1.86 && a2.values.assetCoverage.unit === "pure");
} else {
  check("asset coverage absent from the fixture (allowed)", true);
}
const pure = readPure(arcc.facts["us-gaap"], ["InvestmentCompanySeniorSecurityIndebtednessAssetCoverageRatio"]);
check("readPure keeps the unit verbatim", pure.get("2026-06-30") && pure.get("2026-06-30").v === 1.86 && pure.get("2026-06-30").unit === "pure");
check("latest NAV is the June 30 2026 figure", A.latest.navPerShare && A.latest.navPerShare.end === "2026-06-30" && A.latest.navPerShare.v === 19.35);
/* cover page of the same 10-Q: 718,022,845 shares as of July 23 2026 */
check("cover shares 718,022,845 as of 2026-07-23", A.coverShares && A.coverShares.value === 718022845 && A.coverShares.asOf === "2026-07-23");
check("no debt or distribution flag for ARCC", !A.flags.some((f) => f.key === "debt" || f.key === "distributionsPerShare"), JSON.stringify(A.flags));
check("ARCC's total assets are read from the Assets tag (30,500,000,000 within 5%, 10-Q 0001628280-26-050307)",
  within(val(a2, "totalAssets"), 30.5e9, 0.05) && a2.values.totalAssets.tag === "Assets", String(val(a2, "totalAssets")));
/* a fourth quarter of a December filer: distributions per share for the
   quarter to 2025-12-31 is the 10-K's 1.92 less the nine months' 1.44
   (10-K 0001287750-26-000006, 10-Q 0001287750-25-000046), the pair of
   the fiscal year's own filings */
const a4 = A.periods.find((p) => p.end === "2025-12-31");
check("ARCC Q4 2025 distributions 0.48 derived as the 10-K less the nine months, from the original pair",
  !!a4 && a4.fq === 4 && val(a4, "distributionsPerShare") === 0.48 && a4.values.distributionsPerShare.periodType === "derivedQ4" &&
  a4.values.distributionsPerShare.derived === "annual-less-ytd" && a4.values.distributionsPerShare.basis.rows === "original",
  a4 && JSON.stringify(a4.values.distributionsPerShare.basis));

/* ---------- PSEC, June 30 year end ---------- */

const psec = load("psec-companyfacts-slice.json");
const P = buildBdcSeries(psec.facts, { fyEndMonth: 6 });
const p4 = P.periods.find((p) => p.end === "2026-06-30");
check("PSEC has a period labelled 2026-06-30", !!p4);
check("it is the fourth quarter of fiscal 2026", !!p4 && p4.fy === 2026 && p4.fq === 4, p4 && `${p4.fy} Q${p4.fq}`);
check("bdcFiscalYear names the year by its end", bdcFiscalYear("2026-06-30", 6) === 2026 && bdcFiscalYear("2025-09-30", 6) === 2026 && bdcFiscalYear("2026-03-31", 12) === 2026);
const pn = p4 && p4.values.niiAfterTax;
check("PSEC NII for the quarter is finite", !!pn && Number.isFinite(pn.v), pn && String(pn.v));
check("it comes from the derivedQ4 path or a three-month fact", !!pn && (pn.periodType === "derivedQ4" || pn.periodType === "3M"), pn && pn.periodType);
/* which path: the 10-K's 326,387,000 for the year to June 30 2026 less
   the 10-Q's 248,695,000 for the nine months to March 31 2026 */
if (pn && pn.periodType === "derivedQ4") {
  check("derived as 326,387,000 less 248,695,000 = 77,692,000 from the fiscal-2026 10-K",
    pn.v === 77692000 && pn.form === "10-K" && pn.accn === "0001287032-26-000269" && pn.basis && pn.basis.lessEnd === "2026-03-31",
    `${pn.v} ${pn.form} ${pn.accn}`);
} else {
  check("a three-month fact was tagged for the fourth quarter (not the case in the 2026-09-11 fixture)", pn.periodType === "3M");
}
/* the 10-K's balance sheet at June 30 2026 */
check("PSEC NAV per share 5.71 from the 10-K", val(p4, "navPerShare") === 5.71 && p4.values.navPerShare.form === "10-K");
check("PSEC NII per share 0.15 = 0.68 for the year less 0.53 for nine months", val(p4, "niiPerShare") === 0.15);
check("PSEC asset coverage 3.394 pure", val(p4, "assetCoverage") === 3.394 && p4.values.assetCoverage.unit === "pure");
check("PSEC's fiscal quarters are labelled by their calendar ends",
  P.periods.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.end)) &&
  P.periods.find((p) => p.end === "2025-09-30").fq === 1 && P.periods.find((p) => p.end === "2025-09-30").fy === 2026);
check("PSEC's incentive fee answers from the unsplit tag with its note",
  p4.values.incentiveFeeIncome && p4.values.incentiveFeeIncome.tag === "IncentiveFeeExpense" && /unsplit/.test(p4.values.incentiveFeeIncome.note));
check("fyEndMonth is required", (() => { try { buildBdcSeries(psec.facts, {}); return false; } catch (e) { return /fyEndMonth/.test(e.message); } })());
/* PSEC's fiscal-2026 10-K (0001287032-26-000269) restates fiscal-2025
   distributions to 300,745,000, while the fiscal-2025 10-K
   (0001287032-25-000232) said 360,488,000 and its own nine-month 10-Q
   282,961,000: the fourth quarter to 2025-06-30 is the original pair's
   77,527,000, never the mixed pair's 28,178,000, and the later
   comparative is recorded beside it */
const p25 = P.periods.find((p) => p.end === "2025-06-30");
const pd = p25 && p25.values.distributionsDollars;
check("PSEC Q4 fiscal 2025 distributions 77,527,000 from the fiscal year's own filings",
  !!pd && pd.v === 77527000 && pd.periodType === "derivedQ4" && pd.accn === "0001287032-25-000232" && pd.basis.rows === "original" &&
  pd.basis.restated && pd.basis.restated.v === 300745000 && pd.basis.restated.accn === "0001287032-26-000269",
  pd && `${pd.v} ${JSON.stringify(pd.basis)}`);
check("PSEC raises no NII or distribution flag", !P.flags.some((f) => f.key === "niiAfterTax" || f.key === "distributionsDollars"),
  JSON.stringify(P.flags.filter((f) => f.key === "niiAfterTax" || f.key === "distributionsDollars")));

/* ---------- the debt sanity rule ----------
 *
 * A filer whose only debt tag is a single facility: PSEC's real
 * LineOfCredit rows (562,328,000 at June 30 2026 against Liabilities of
 * 1,945,331,000, 10-K 0001287032-26-000269) moved under the ladder's
 * fourth tag, with its two total-debt tags removed. Below half of
 * liabilities, the quarter must be flagged and left empty. */
const gaapOnlyFacility = { ...psec.facts["us-gaap"] };
delete gaapOnlyFacility.DebtInstrumentCarryingAmount;
delete gaapOnlyFacility.LongTermDebt;
gaapOnlyFacility.LinesOfCreditCurrent = psec.facts["us-gaap"].LineOfCredit;
const D = buildBdcSeries({ "us-gaap": gaapOnlyFacility }, { fyEndMonth: 6 });
const d4 = D.periods.find((p) => p.end === "2026-06-30");
check("a facility below half of liabilities is left empty", !!d4 && d4.values.debt === null);
check("and flagged with the figures", D.flags.some((f) => f.key === "debt" && f.end === "2026-06-30" && f.value === 562328000 && f.liabilities === 1945331000),
  JSON.stringify(D.flags.filter((f) => f.key === "debt").slice(0, 1)));
check("PSEC's own debt 1,878,595,000 passes the rule", val(p4, "debt") === 1878595000 && !P.flags.some((f) => f.key === "debt" && f.end === "2026-06-30"));
/* the same facility under the first tag with LongTermDebt left in
   place: the first step fails the bound and the guard falls through to
   LongTermDebt (1,860,649,000 at June 30 2026, the same 10-K),
   recording the fall */
const gaapFacilityFirst = { ...psec.facts["us-gaap"] };
gaapFacilityFirst.DebtInstrumentCarryingAmount = psec.facts["us-gaap"].LineOfCredit;
const D2 = buildBdcSeries({ "us-gaap": gaapFacilityFirst }, { fyEndMonth: 6 });
const d24 = D2.periods.find((p) => p.end === "2026-06-30");
check("a first step outside the bound falls through to the next ladder tag",
  !!d24 && val(d24, "debt") === 1860649000 && d24.values.debt.tag === "LongTermDebt" && d24.values.debt.step === 2 &&
  /next ladder step/.test(d24.values.debt.note) && !D2.flags.some((f) => f.key === "debt" && f.end === "2026-06-30"),
  d24 && JSON.stringify(d24.values.debt));
/* a tag carried at principal above liabilities (TSLX's shape: PSEC's
   first tag scaled to 1.015 x its 1,945,331,000 of liabilities) fails
   the blueprint's bound and falls through to LongTermDebt, the carrying
   amount, 1,860,649,000 in the same 10-K */
const gaapPrincipal = { ...psec.facts["us-gaap"] };
gaapPrincipal.DebtInstrumentCarryingAmount = { ...gaapPrincipal.DebtInstrumentCarryingAmount, units: { USD:
  gaapPrincipal.DebtInstrumentCarryingAmount.units.USD.map((r) => (r.end === "2026-06-30" ? { ...r, val: Math.round(1945331000 * 1.015) } : r)) } };
const D3 = buildBdcSeries({ "us-gaap": gaapPrincipal }, { fyEndMonth: 6 });
const d34 = D3.periods.find((p) => p.end === "2026-06-30");
check("debt above liabilities falls through to the carrying amount one step down",
  !!d34 && val(d34, "debt") === 1860649000 && d34.values.debt.tag === "LongTermDebt" && /next ladder step/.test(d34.values.debt.note) &&
  !D3.flags.some((f) => f.key === "debt" && f.end === "2026-06-30"), d34 && JSON.stringify(d34.values.debt));

/* ---------- frames ahead of companyfacts ----------
 *
 * The lag of 2026-09-10 reproduced: ARCC's feed cut to facts ending on
 * or before 2026-03-31, then the CY2026Q2 frame rows merged. */
const lagged = { "us-gaap": {}, dei: arcc.facts.dei };
for (const [tag, c] of Object.entries(arcc.facts["us-gaap"])) {
  const units = {};
  for (const [u, rows] of Object.entries(c.units)) units[u] = rows.filter((r) => r.end <= "2026-03-31");
  lagged["us-gaap"][tag] = { ...c, units };
}
const L = buildBdcSeries(lagged, { fyEndMonth: 12 });
check("the lagged feed ends at 2026-03-31 with NAV 19.59", L.latest.navPerShare.end === "2026-03-31" && L.latest.navPerShare.v === 19.59);
const fx = load("arcc-frames-cy2026q2.json");
const entries = Object.entries(fx.frames).map(([key, payload]) => ({ key, payload }));
mergeFrames(L, entries, { cik: fx.cik });
const l2 = L.periods.find((p) => p.end === "2026-06-30");
check("frames add the newer period", !!l2 && l2.fy === 2026 && l2.fq === 2);
check("NAV 19.35 from frames, source recorded", !!l2 && val(l2, "navPerShare") === 19.35 && l2.values.navPerShare.source === "frames" &&
  l2.values.navPerShare.frame === "CY2026Q2I" && l2.values.navPerShare.accn === "0001628280-26-050307");
check("pre-tax NII 367,000,000 from the duration frame as a three-month value",
  !!l2 && val(l2, "niiPreTax") === 367000000 && l2.values.niiPreTax.periodType === "3M" && l2.values.niiPreTax.start === "2026-04-01");
check("asset coverage 1.86 from frames keeps the pure unit", !!l2 && val(l2, "assetCoverage") === 1.86 && l2.values.assetCoverage.unit === "pure");
check("latest now points at the frames period", L.latest.navPerShare.end === "2026-06-30" && L.latest.navPerShare.source === "frames");
/* several entries for one key are a ladder: the first answers, the rest
   are the alternates a guard falls through to. The NAV frame's row
   shape carries ARCC's 16,607,000,000 of liabilities, a tenth of them
   as a facility on the first debt entry and the real 15,924,000,000 on
   the second (10-Q 0001628280-26-050307). */
check("a debt frame that fails the bound falls through to the next entry", (() => {
  const S = buildBdcSeries(lagged, { fyEndMonth: 12 });
  const liab = { ...fx.frames.navPerShare, tag: "Liabilities", uom: "USD", data: [{ ...fx.frames.navPerShare.data[0], val: 16607000000 }] };
  const facility = { ...liab, tag: "LinesOfCreditCurrent", data: [{ ...liab.data[0], val: 1660700000 }], step: 1 };
  const real = { ...liab, tag: "DebtInstrumentCarryingAmount", data: [{ ...liab.data[0], val: 15924000000 }], step: 2 };
  mergeFrames(S, [{ key: "liabilities", payload: liab }, { key: "debt", payload: facility }, { key: "debt", payload: real }], { cik: fx.cik });
  const d = S.latest.debt;
  return !!d && d.v === 15924000000 && d.tag === "DebtInstrumentCarryingAmount" && d.source === "frames" && d.end === "2026-06-30" &&
    /next ladder step/.test(d.note) && !S.flags.some((f) => f.key === "debt");
})());
check("an entry's flag travels with its value", (() => {
  const S = buildBdcSeries(lagged, { fyEndMonth: 12 });
  mergeFrames(S, [{ key: "niiPreTax", payload: fx.frames.niiPreTax, flag: { reason: "test flag" } }], { cik: fx.cik });
  return S.flags.some((f) => f.key === "niiPreTax" && f.end === "2026-06-30" && f.reason === "test flag");
})());
mergeFrames(A, entries, { cik: fx.cik });
check("an equal period keeps companyfacts", A.latest.navPerShare.source === "companyfacts" && A.latest.navPerShare.v === 19.35);
check("a frame in the wrong unit is refused", (() => {
  const S = buildBdcSeries(lagged, { fyEndMonth: 12 });
  mergeFrames(S, [{ key: "navPerShare", payload: { ...fx.frames.navPerShare, uom: "USD" } }], { cik: fx.cik });
  return S.latest.navPerShare.end === "2026-03-31" && S.flags.some((f) => f.key === "navPerShare" && /unit/.test(f.reason));
})());

/* ---------- the NII cross-check: HTGC, TRIN ----------
 *
 * Hercules tags no after-tax concept and carries its tax line inside
 * operating expenses, so NetInvestmentIncome (92,915,000 for the three
 * months to 2026-06-30) is already after tax: over 185,517,000 weighted
 * shares it is 0.5008 against the tagged 0.50, while less the 2,790,000
 * tax line it is 0.4858. Trinity's NetInvestmentIncome is its net
 * increase in net assets (-9,065,000 for the three months to
 * 2022-03-31, the ProfitLoss figure) while InvestmentIncomeNet is
 * 15,609,000 (0.5693 over 27,416,943 shares against the tagged 0.57). */
const htgc = load("htgc-companyfacts-slice.json");
const H = buildBdcSeries(htgc.facts, { fyEndMonth: 12 });
const h2 = H.periods.find((p) => p.end === "2026-06-30");
const hn = h2 && h2.values.niiAfterTax;
check("HTGC NII after tax 92,915,000 from NetInvestmentIncome alone, not less the tax line",
  !!hn && hn.v === 92915000 && hn.tag === "NetInvestmentIncome" && hn.step === 3 && hn.periodType === "3M" &&
  hn.accn === "0001280784-26-000042" && /already after tax/.test(hn.note), hn && `${hn.v} ${hn.tag} ${hn.note}`);
check("HTGC's cross-check is recorded",
  !!hn && hn.crossCheck.basis === "perShare" && hn.crossCheck.perShare === 0.5 && hn.crossCheck.shares === 185517000 &&
  hn.crossCheck.implied === 0.5008 && hn.crossCheck.reconciles === true, hn && JSON.stringify(hn.crossCheck));
check("HTGC's tax line is still read on its own", val(h2, "niiTax") === 2790000 && val(h2, "niiPreTax") === 92915000);
check("the subtraction step is skipped for HTGC in every quarter",
  H.niiLadder && H.niiLadder.skipped.some((s) => s.step === 2 && s.rejectedIn >= 1) &&
  H.periods.every((p) => !p.values.niiAfterTax || p.values.niiAfterTax.step === 3), JSON.stringify(H.niiLadder));
check("HTGC raises no NII flag", !H.flags.some((f) => f.key === "niiAfterTax"), JSON.stringify(H.flags.filter((f) => f.key === "niiAfterTax")));
check("HTGC's cash and total assets are read (48,176,000 and 4,688,079,000, 10-Q 0001280784-26-000042)",
  val(h2, "cash") === 48176000 && val(h2, "totalAssets") === 4688079000);
check("HTGC's fair value 4,583,870,000 passes the portfolio bound", val(h2, "portfolioFairValue") === 4583870000 &&
  !H.flags.some((f) => f.key === "portfolioFairValue"));

const trin = load("trin-companyfacts-slice.json");
const T = buildBdcSeries(trin.facts, { fyEndMonth: 12 });
const t1 = T.periods.find((p) => p.end === "2022-03-31");
const tn = t1 && t1.values.niiAfterTax;
check("TRIN NII 15,609,000 for Q1 2022 from InvestmentIncomeNet, NetInvestmentIncome rejected",
  !!tn && tn.v === 15609000 && tn.tag === "InvestmentIncomeNet" && tn.step === 4 && tn.accn === "0000950170-23-017817" &&
  tn.crossCheck.reconciles === true && tn.crossCheck.perShare === 0.57 && tn.crossCheck.shares === 27416943,
  tn && `${tn.v} ${tn.tag} ${JSON.stringify(tn.crossCheck)}`);
check("TRIN's NetInvestmentIncome is skipped for the filer", T.niiLadder && T.niiLadder.skipped.some((s) => s.tag === "NetInvestmentIncome"));
check("TRIN's net increase in net assets is still -9,065,000 for the quarter",
  val(t1, "netIncreaseInNetAssets") === -9065000 && t1.values.netIncreaseInNetAssets.tag === "ProfitLoss");
/* the three months to 2026-06-30, 10-Q 0001193125-26-333907: 45,989,000
   (verified-facts A and the concept map's probe) */
const t2 = T.periods.find((p) => p.end === "2026-06-30");
check("TRIN NII 45,989,000 for Q2 2026 from InvestmentIncomeNet", val(t2, "niiAfterTax") === 45989000 && t2.values.niiAfterTax.tag === "InvestmentIncomeNet");
check("TRIN's 12.27 is not a dividend and no quarter serves it",
  T.periods.every((p) => !p.values.distributionsPerShare || p.values.distributionsPerShare.v < 3));

/* chooseNii and settleNiiLadder on their own, with HTGC's figures */
const span = { start: "2026-04-01", end: "2026-06-30" };
const cands = [{ v: 90125000, tag: "a-b", step: 2, ...span }, { v: 92915000, tag: "a", step: 3, ...span }];
const picked = chooseNii(cands, { perShare: { v: 0.5, ...span }, shares: { v: 185517000, ...span } });
/* a later step that reconciles is a verdict for the settlement, never
   the quarter's value: one quarter's arithmetic does not switch steps */
check("chooseNii keeps the first step, flags it and reports every step's verdict",
  picked.value.v === 90125000 && !!picked.flag && picked.flag.basis === "perShare" && picked.value.crossCheck.reconciles === false &&
  !picked.sharesFlag && picked.verdicts.map((v) => v.ok).join() === "false,true", JSON.stringify(picked.value));
check("chooseNii confirms a first step that reconciles",
  (() => { const r = chooseNii(cands.slice(1), { perShare: { v: 0.5, ...span }, shares: { v: 185517000, ...span } }); return r.value.v === 92915000 && !r.flag && r.value.crossCheck.reconciles === true && r.perShare.v === 0.5; })());
check("chooseNii adopts the other pair's per-share value when only that reconciles",
  (() => { const r = chooseNii(cands.slice(1), { perShare: [{ v: 0.9, ...span }, { v: 0.5, ...span }], shares: { v: 185517000, ...span } }); return r.value.crossCheck.reconciles === true && r.perShare.v === 0.5; })());
check("chooseNii leaves an unchecked quarter unmarked", (() => { const r = chooseNii(cands, {}); return r.value.v === 90125000 && !r.flag && !r.value.crossCheck; })());
/* a step's alternate rows (the period's own filing) answer where the
   latest-filed row fails: OXSQ's 2023-03-31 shape, 12,941,798 in the
   2024 comparative against 6,490,784 in the quarter's own 10-Q, 0.13
   over 49,858,366 shares */
const oxShape = [{ v: 12941798, tag: "NetInvestmentIncome", step: 3, ...span, alternate: { v: 6490784, tag: "NetInvestmentIncome", step: 3, rows: "original", ...span } }];
check("chooseNii takes the alternate rows when only they reconcile, and never serves the alternate field",
  (() => { const r = chooseNii(oxShape, { perShare: { v: 0.13, ...span }, shares: { v: 49858366, ...span } });
    return r.value.v === 6490784 && r.value.rows === "original" && !("alternate" in r.value) && !r.flag && r.value.crossCheck.reconciles === true &&
      r.value.crossCheck.implied === 0.1302 && /period's own filing reconciles/.test(r.value.note) && r.verdicts[0].ok === true; })());
/* every step a thousand times off the tagged figure is the share count:
   NCDL's 9,733,000 over 22,212,400,000 against 0.44 */
check("chooseNii charges a hundredfold miss on every step to the share count, not the NII",
  (() => { const r = chooseNii([{ v: 9733000, tag: "a", ...span }], { perShare: { v: 0.44, ...span }, shares: { v: 22212400000, tag: "w", ...span } });
    return r.value.v === 9733000 && !r.flag && !r.value.crossCheck && !!r.sharesFlag && r.sharesFlag.value === 22212400000 &&
      r.sharesFlag.factor >= 100 && /wrong scale/.test(r.sharesFlag.reason) && r.verdicts.length === 0; })());
check("niiOverShares derives the per-share figure with the rejected fact beside it",
  (() => { const v = niiOverShares({ v: 83899000, tag: "n", periodType: "3M", start: "2024-04-01", end: "2024-06-30", form: "10-Q", filed: "2025-08-08", accn: "x", source: "companyfacts" },
    { v: 86194092, tag: "w" }, { v: 0.94, tag: "p", accn: "y" });
    return v.v === 0.9734 && v.unit === "USD/shares" && v.tag === "n/w" && v.derived === "nii-over-shares" && v.periodType === "3M" &&
      v.rejected.v === 0.94 && v.rejected.accn === "y" && v.source === "companyfacts"; })());
/* the tag verdict on ARCC's Q2 2026 (359,000,000 after tax, 367,000,000
   before, 8,000,000 of tax: the subtraction is right) and on PFLT's
   shape (after-tax tag equal to NetInvestmentIncome: it is wrong) */
const q = { start: "2026-04-01", end: "2026-06-30" };
check("tagVerdict confirms the subtraction where the after-tax tag is NII less the line",
  JSON.stringify(tagVerdict([{ v: 359000000, tag: "a", ...q }, { v: 359000000, tag: "b-c", step: 2, ...q }, { v: 367000000, tag: "b", step: 3, ...q }]).map((v) => v.ok)) === "[true,false]" &&
  JSON.stringify(tagVerdict([{ v: 367000000, tag: "a", ...q }, { v: 359000000, tag: "b-c", step: 2, ...q }, { v: 367000000, tag: "b", step: 3, ...q }]).map((v) => v.ok)) === "[false,true]" &&
  tagVerdict([{ v: 367000000, tag: "a", ...q }, { v: 367000000, tag: "b-c", step: 2, ...q }, { v: 367000000, tag: "b", step: 3, ...q }]) === null &&
  tagVerdict([null, { v: 1, tag: "b-c", step: 2, ...q }, { v: 2, tag: "b", step: 3, ...q }]) === null);
const rej = [{ step: 2, ok: false }, { step: 3, ok: true }], con = [{ step: 2, ok: true }, { step: 3, ok: false }], both = [{ step: 2, ok: true }, { step: 3, ok: true }];
check("settleNiiLadder skips a step rejected twice and never confirmed, and nothing on one rejection or a confirmation",
  JSON.stringify(settleNiiLadder([rej, rej, both])) === '[{"step":2,"rejectedIn":2}]' &&
  settleNiiLadder([rej, both, both]).length === 0 &&
  settleNiiLadder([rej, rej, con]).length === 0);
/* RWAY's shape: a fourth step failing beside a passing second and
   third confirms the third, never the second */
check("a later step failing confirms only the step before it",
  JSON.stringify(settleNiiLadder([rej, rej, [{ step: 2, ok: true }, { step: 3, ok: true }, { step: 4, ok: false }]])) === '[{"step":2,"rejectedIn":2}]');

/* ---------- instant and portfolio guards: FRBP, and mutations of ARCC ----------
 *
 * FRBP's 10-K for 2022 (0001825248-23-000004) tags a NAV per share of
 * -4120.15 at 2020-12-31, and its 10-K for 2023 (0001825248-24-000007)
 * an asset coverage of 197 at 2023-12-31 where every other quarter is
 * 1.5-2.3 (1.78 at 2026-06-30, 10-Q 0001825248-26-000024). */
const frbp = load("frbp-companyfacts-slice.json");
const F = buildBdcSeries(frbp.facts, { fyEndMonth: 12 });
const f20 = F.periods.find((p) => p.end === "2020-12-31"), f23 = F.periods.find((p) => p.end === "2023-12-31");
check("FRBP's -4120.15 NAV per share is emptied and flagged",
  !!f20 && f20.values.navPerShare === null && F.flags.some((f) => f.key === "navPerShare" && f.end === "2020-12-31" && f.value === -4120.15));
check("FRBP's asset coverage 197 is read as 1.97 with the note",
  !!f23 && val(f23, "assetCoverage") === 1.97 && f23.values.assetCoverage.tagged === 197 && /percent/.test(f23.values.assetCoverage.note) &&
  f23.values.assetCoverage.unit === "pure", f23 && JSON.stringify(f23.values.assetCoverage));
check("FRBP's NAV 14.88 at 2023-12-31 and coverage 1.78 at 2026-06-30 stand",
  val(f23, "navPerShare") === 14.88 && val(F.periods.find((p) => p.end === "2026-06-30"), "assetCoverage") === 1.78);
check("no FRBP quarter carries a NAV at or below zero", F.periods.every((p) => !p.values.navPerShare || p.values.navPerShare.v > 0));

/* the portfolio bounds on ARCC's feed: fair value cut to a twentieth of
   itself (a member subtotal), then cost cut to a tenth of fair value */
const mutate = (gaap, tag, f) => ({ ...gaap, [tag]: { ...gaap[tag], units: { USD: gaap[tag].units.USD.map((r) => (r.end === "2026-06-30" ? { ...r, val: f(r.val) } : r)) } } });
const M1 = buildBdcSeries({ "us-gaap": mutate(arcc.facts["us-gaap"], "InvestmentOwnedAtFairValue", (v) => Math.round(v / 20)) }, { fyEndMonth: 12 });
const m1 = M1.periods.find((p) => p.end === "2026-06-30");
check("a fair value below half of total assets is emptied and flagged",
  !!m1 && m1.values.portfolioFairValue === null && M1.flags.some((f) => f.key === "portfolioFairValue" && f.end === "2026-06-30"),
  JSON.stringify(M1.flags.filter((f) => f.key === "portfolioFairValue")));
const M2 = buildBdcSeries({ "us-gaap": mutate(arcc.facts["us-gaap"], "InvestmentOwnedAtCost", (v) => Math.round(v / 10)) }, { fyEndMonth: 12 });
const m2 = M2.periods.find((p) => p.end === "2026-06-30");
check("a cost below half of fair value is emptied and flagged",
  !!m2 && m2.values.portfolioCost === null && M2.flags.some((f) => f.key === "portfolioCost" && f.end === "2026-06-30"));
const M3 = buildBdcSeries({ "us-gaap": mutate(arcc.facts["us-gaap"], "InvestmentOwnedAtCost", () => 0) }, { fyEndMonth: 12 });
check("a zero cost against a positive fair value is emptied", M3.periods.find((p) => p.end === "2026-06-30").values.portfolioCost === null);
check("ARCC's real cost and fair value pass both bounds", val(a2, "portfolioCost") === 29674600000 && val(a2, "portfolioFairValue") === 29349300000);

/* the interest bound: ARCC's InterestExpense (214,000,000 for the three
   months to 2026-06-30, 10-Q 0001628280-26-050307) cut to a hundredth
   annualises to 0.05% of its 15,924,000,000 of debt; with no other
   interest tag in the feed the quarter is emptied and flagged */
const M4 = buildBdcSeries({ "us-gaap": mutate(arcc.facts["us-gaap"], "InterestExpense", (v) => Math.round(v / 100)) }, { fyEndMonth: 12 });
const m4 = M4.periods.find((p) => p.end === "2026-06-30");
check("interest annualising below 1% of debt is emptied and flagged",
  !!m4 && m4.values.interestExpense === null && M4.flags.some((f) => f.key === "interestExpense" && f.end === "2026-06-30"));
check("ARCC's real interest 214,000,000 passes (5.4% of debt annualised)", val(a2, "interestExpense") === 214000000);

/* the derived-flow guards on ARCC's 10-K row: distributions for 2025
   set equal to the nine months (a fourth quarter of zero), then to ten
   times them (a fourth quarter of nine times a normal one) */
const tenK = (f) => ({ ...arcc.facts["us-gaap"], InvestmentCompanyDistributionToShareholdersPerShare: {
  ...arcc.facts["us-gaap"].InvestmentCompanyDistributionToShareholdersPerShare,
  units: { "USD/shares": arcc.facts["us-gaap"].InvestmentCompanyDistributionToShareholdersPerShare.units["USD/shares"]
    .map((r) => (r.start === "2025-01-01" && r.end === "2025-12-31" ? { ...r, val: f(r.val) } : r)) } } });
const M5 = buildBdcSeries({ "us-gaap": tenK(() => 1.44) }, { fyEndMonth: 12 });
check("a derived fourth quarter of zero distributions for a filer that pays is emptied and flagged",
  M5.periods.find((p) => p.end === "2025-12-31").values.distributionsPerShare === null &&
  M5.flags.some((f) => f.key === "distributionsPerShare" && f.end === "2025-12-31" && /zero/.test(f.reason)));
const M6 = buildBdcSeries({ "us-gaap": tenK((v) => v * 3) }, { fyEndMonth: 12 });
check("a derived fourth quarter nine times the year's other quarters is emptied and flagged",
  M6.periods.find((p) => p.end === "2025-12-31").values.distributionsPerShare === null &&
  M6.flags.some((f) => f.key === "distributionsPerShare" && f.end === "2025-12-31" && /outside/.test(f.reason)));
/* a derived negative from a comparative on another basis: the 10-K row
   set below the nine months */
const M6b = buildBdcSeries({ "us-gaap": tenK(() => 1.0) }, { fyEndMonth: 12 });
check("a derived negative distribution is emptied and flagged",
  M6b.periods.find((p) => p.end === "2025-12-31").values.distributionsPerShare === null &&
  M6b.flags.some((f) => f.key === "distributionsPerShare" && f.end === "2025-12-31" && /below zero/.test(f.reason)));
check("the real fourth quarter (0.48 against 0.48 quarters) is kept", val(a4, "distributionsPerShare") === 0.48);
/* a per-share figure below a fifth of dollars declared over shares (ARCC
   Q2 2026: 345,000,000 over 718,000,000 is 0.4805) is a component, and
   the dollars-over-shares figure replaces it */
const M7 = buildBdcSeries({ "us-gaap": { ...arcc.facts["us-gaap"], InvestmentCompanyDistributionToShareholdersPerShare: {
  ...arcc.facts["us-gaap"].InvestmentCompanyDistributionToShareholdersPerShare,
  units: { "USD/shares": arcc.facts["us-gaap"].InvestmentCompanyDistributionToShareholdersPerShare.units["USD/shares"]
    .map((r) => (r.end === "2026-06-30" ? { ...r, val: 0.5 } : r)) } } } }, { fyEndMonth: 12 });
const m7 = M7.periods.find((p) => p.end === "2026-06-30").values.distributionsPerShare;
check("a per-share figure far below dollars over shares is replaced by dollars over shares and flagged as a component",
  !!m7 && m7.step === 3 && m7.v === 0.4805 && m7.derived === "dollars-over-shares" &&
  M7.flags.some((f) => f.key === "distributionsPerShare" && f.end === "2026-06-30" && /component/.test(f.reason)), m7 && JSON.stringify(m7));
/* an externally managed filer with no incentive-fee fact for a quarter:
   PSEC's IncentiveFeeExpense removed */
const noFee = { ...psec.facts["us-gaap"] };
delete noFee.IncentiveFeeExpense;
const M8 = buildBdcSeries({ "us-gaap": noFee }, { fyEndMonth: 6 });
check("a missing incentive fee for an externally managed filer is empty and flagged, never zero",
  M8.periods.find((p) => p.end === "2026-06-30").values.incentiveFeeIncome === null &&
  M8.flags.some((f) => f.key === "incentiveFeeIncome" && f.end === "2026-06-30"));

/* ---------- the cost rule: impairment kept, a member emptied ----------
 *
 * ARCC's cost set to five times its fair value is an impairment shape
 * and is kept; OXSQ's real 2026-06-30 rows (below) are a member. */
const M9 = buildBdcSeries({ "us-gaap": mutate(arcc.facts["us-gaap"], "InvestmentOwnedAtCost", (v) => v * 5) }, { fyEndMonth: 12 });
check("a cost far above fair value is an impairment, not a tag error, and is kept",
  val(M9.periods.find((p) => p.end === "2026-06-30"), "portfolioCost") === 29674600000 * 5 && !M9.flags.some((f) => f.key === "portfolioCost"));

/* ---------- the NII per-share rule: MAIN, NSLR ----------
 *
 * Main Street's 2025 10-Q restated the 2024 first half to the after-tax
 * presentation (1.99 per share) while the first quarter was never
 * restated (1.05, pre-tax): the difference, 0.94, matches nothing, and
 * the after-tax quarter is 83,899,000 over 86,194,092 shares, 0.9734. */
const main = load("main-companyfacts-slice.json");
const MN = buildBdcSeries(main.facts, { fyEndMonth: 12 });
const mn = MN.periods.find((p) => p.end === "2024-06-30");
const mnps = mn && mn.values.niiPerShare, mnn = mn && mn.values.niiAfterTax;
check("MAIN Q2 2024 NII 83,899,000 after tax is kept, flagged as failing the cross-check",
  !!mnn && mnn.v === 83899000 && mnn.tag === "InvestmentIncomeOperatingAfterExpenseAndTax" && mnn.accn === "0001396440-25-000102" &&
  mnn.crossCheck.reconciles === false && mnn.crossCheck.perShare === 0.94 && mnn.crossCheck.implied === 0.9734 &&
  MN.flags.some((f) => f.key === "niiAfterTax" && f.end === "2024-06-30" && f.basis === "perShare"), mnn && JSON.stringify(mnn.crossCheck));
check("MAIN Q2 2024 NII per share is NII over shares, 0.9734, with the rejected difference 0.94 beside it",
  !!mnps && mnps.v === 0.9734 && mnps.derived === "nii-over-shares" && mnps.unit === "USD/shares" && mnps.periodType === "3M" &&
  mnps.rejected && mnps.rejected.v === 0.94 && mnps.rejected.tag === "InvestmentCompanyInvestmentIncomeLossPerShare" &&
  mnps.rejected.accn === "0001396440-25-000102" && mnps.accn === "0001396440-25-000102", mnps && JSON.stringify(mnps));
check("and the quarter is flagged under niiPerShare",
  MN.flags.some((f) => f.key === "niiPerShare" && f.end === "2024-06-30" && f.value === 0.94 && f.implied === 0.9734 && /difference of two rows/.test(f.reason)),
  JSON.stringify(MN.flags.filter((f) => f.key === "niiPerShare")));
/* the three months to 2026-06-30 (10-Q filed 2026-08-07, accession
   0001396440-26-000094): 90,324,000 over 93,253,619 shares is 0.9686,
   and the year to date 1.90 less the first quarter's 0.93 (10-Q
   0001396440-26-000073) is the tagged 0.97 */
const mn2 = MN.periods.find((p) => p.end === "2026-06-30");
check("MAIN Q2 2026 reconciles and serves the tagged 0.97",
  !!mn2 && val(mn2, "niiAfterTax") === 90324000 && mn2.values.niiAfterTax.accn === "0001396440-26-000094" &&
  val(mn2, "niiPerShare") === 0.97 && mn2.values.niiPerShare.tag === "InvestmentCompanyInvestmentIncomeLossPerShare" &&
  mn2.values.niiPerShare.derived === "ytd-differenced" && !MN.flags.some((f) => f.key === "niiPerShare" && f.end === "2026-06-30"));
check("MAIN's firstPeriod never predates the fixture's own cut (2023)",
  Object.values(MN.firstPeriod).every((end) => end >= "2023-01-01") && MN.firstPeriod.niiAfterTax === "2023-03-31", JSON.stringify(MN.firstPeriod));

/* SuRo, now Neostellar: a per-share tag that is not NII per share in
   any quarter (0.19 for the three months to 2026-06-30 against a net
   investment loss of 23,354,684 over 25,983,140 shares, -0.8988) */
const nslr = load("nslr-companyfacts-slice.json");
const NS = buildBdcSeries(nslr.facts, { fyEndMonth: 12 });
const ns = NS.periods.find((p) => p.end === "2026-06-30");
check("NSLR Q2 2026 NII -23,354,684 is kept, flagged", !!ns && val(ns, "niiAfterTax") === -23354684 && ns.values.niiAfterTax.crossCheck.reconciles === false);
check("NSLR's per-share tag fails in more than two quarters, so every failing quarter serves NII over shares",
  NS.flags.filter((f) => f.key === "niiPerShare").length >= 3 &&
  !!ns && val(ns, "niiPerShare") === -0.8988 && ns.values.niiPerShare.derived === "nii-over-shares" && ns.values.niiPerShare.rejected.v === 0.19 &&
  ns.values.niiPerShare.rejected.accn === "0001493152-26-036285" && NS.flags.some((f) => f.key === "niiPerShare" && f.end === "2026-06-30" && /per-share tag/.test(f.reason)),
  ns && JSON.stringify(ns.values.niiPerShare));
check("no NSLR quarter serves a tagged per-share figure its NII rejected",
  NS.periods.every((p) => !p.values.niiPerShare || !p.values.niiAfterTax || !p.values.niiAfterTax.crossCheck ||
    p.values.niiAfterTax.crossCheck.basis !== "perShare" || p.values.niiAfterTax.crossCheck.reconciles || p.values.niiPerShare.derived === "nii-over-shares"));
check("the tagged 0.50 that reconciles for ARCC is untouched", val(a2, "niiPerShare") === 0.5 && !A.flags.some((f) => f.key === "niiPerShare"));

/* ---------- a comparative that swapped tags: OXSQ ----------
 *
 * The 10-Q for 2024-03-31 tags NetInvestmentIncome 12,941,798 for the
 * comparative quarter to 2023-03-31, where the quarter's own 10-Q said
 * 6,490,784 (and 12,941,798 under InvestmentIncomeNet); 0.13 over
 * 49,858,366 shares is the smaller figure. */
const oxsq = load("oxsq-companyfacts-slice.json");
const OX = buildBdcSeries(oxsq.facts, { fyEndMonth: 12 });
const ox1 = OX.periods.find((p) => p.end === "2023-03-31");
const oxn = ox1 && ox1.values.niiAfterTax;
check("OXSQ Q1 2023 NII 6,490,784 from the quarter's own 10-Q, the swapped comparative recorded beside it",
  !!oxn && oxn.v === 6490784 && oxn.tag === "NetInvestmentIncome" && oxn.accn === "0001213900-23-035636" && oxn.rows === "original" &&
  oxn.restated && oxn.restated.v === 12941798 && oxn.restated.accn === "0001213900-24-039266" &&
  oxn.crossCheck.reconciles === true && oxn.crossCheck.implied === 0.1302 && /period's own filing reconciles/.test(oxn.note),
  oxn && JSON.stringify(oxn));
check("OXSQ Q2 and Q3 2023 the same: 6,665,781 and 6,438,818",
  val(OX.periods.find((p) => p.end === "2023-06-30"), "niiAfterTax") === 6665781 && val(OX.periods.find((p) => p.end === "2023-09-30"), "niiAfterTax") === 6438818);
check("OXSQ raises no NII flag in the three 2023 quarters", !OX.flags.some((f) => f.key === "niiAfterTax" && f.end.startsWith("2023") && f.end !== "2023-12-31"),
  JSON.stringify(OX.flags.filter((f) => f.key === "niiAfterTax")));
/* the 2023 10-K's NetInvestmentIncome for the year is the swapped
   51,824,181 (the 2025 10-K corrects it to 27,359,939), so the fourth
   quarter derived from it, 32,228,798, is five times the other three
   and reconciles with the 0.14 per share (0.51 for the year less 0.37)
   on neither row pair: emptied and flagged; the per-share figure, inside
   the band of the year's 0.13s, is kept unverified */
const ox4 = OX.periods.find((p) => p.end === "2023-12-31");
check("OXSQ Q4 2023 NII from the swapped annual row is emptied and flagged, the per-share 0.14 kept unverified",
  !!ox4 && ox4.values.niiAfterTax === null && val(ox4, "niiPerShare") === 0.14 && ox4.values.niiPerShare.crossCheck.unverified === true &&
  OX.flags.some((f) => f.key === "niiAfterTax" && f.end === "2023-12-31" && f.value === 32228798 && f.sharesEstimate && /left empty/.test(f.reason)) &&
  OX.flags.some((f) => f.key === "niiPerShare" && f.end === "2023-12-31" && /unverified/.test(f.reason)),
  ox4 && JSON.stringify(OX.flags.filter((f) => f.end === "2023-12-31" && /nii/.test(f.key))));
/* the 2026-06-30 rows: cost 23,834,191 beside a member's fair value of
   15,409,950 against assets of 290,605,053 (10-Q 0001213900-26-087243) */
const ox2 = OX.periods.find((p) => p.end === "2026-06-30");
check("OXSQ's 2026-06-30 cost is a member and is emptied and flagged with the fair value",
  !!ox2 && ox2.values.portfolioCost === null && ox2.values.portfolioFairValue === null &&
  OX.flags.some((f) => f.key === "portfolioCost" && f.end === "2026-06-30" && f.value === 23834191 && f.assets === 290605053 && /0\.5 x Assets/.test(f.reason)) &&
  OX.flags.some((f) => f.key === "portfolioFairValue" && f.end === "2026-06-30" && f.value === 15409950),
  JSON.stringify(OX.flags.filter((f) => f.end === "2026-06-30" && /portfolio/.test(f.key))));
check("OXSQ's latest cost and fair value never point at the member quarter",
  OX.latest.portfolioCost.end < "2026-06-30" && OX.latest.portfolioFairValue.end < "2026-06-30");

/* ---------- a share count on the wrong scale: NCDL ----------
 *
 * The 10-Q filed 2023-08-04 tags 22,212,400,000 weighted basic shares
 * for the quarter to 2022-06-30 against 22,691,144 outstanding, a NAV
 * of 18.76 and net assets of 425,773,000 (22,695,789 shares implied). */
const ncdl = load("ncdl-companyfacts-slice.json");
const NC = buildBdcSeries(ncdl.facts, { fyEndMonth: 12 });
const nc = NC.periods.find((p) => p.end === "2022-06-30");
check("NCDL's 22,212,400,000 weighted shares are emptied and flagged as a scale error",
  !!nc && nc.values.weightedShares === null && val(nc, "sharesOutstanding") === 22691144 &&
  NC.flags.some((f) => f.key === "weightedShares" && f.end === "2022-06-30" && f.value === 22212400000 && f.impliedShares === 22695789 && f.factor >= 100),
  JSON.stringify(NC.flags.filter((f) => f.key === "weightedShares" && f.end === "2022-06-30")));
check("NCDL's NII 9,733,000 for the quarter is not charged with the share count's error",
  val(nc, "niiAfterTax") === 9733000 && !NC.flags.some((f) => f.key === "niiAfterTax" && f.end === "2022-06-30") &&
  !(nc.values.niiAfterTax.crossCheck && nc.values.niiAfterTax.crossCheck.reconciles === false));
check("every NCDL quarter serves a weighted count on the scale of its outstanding count",
  NC.periods.every((p) => !p.values.weightedShares || !p.values.sharesOutstanding || p.values.weightedShares.v < 10 * p.values.sharesOutstanding.v));
/* the 2024 10-Q restated the 2023 second quarter to 18,706,000 and 1.23
   per share (0.63 for the quarter), which do not reconcile with each
   other (0.6109); the quarter's own 10-Q, 18,330,000 and 1.20 (0.60),
   does: 18,330,000 over 30,621,009 is 0.5986 */
const nc23 = NC.periods.find((p) => p.end === "2023-06-30");
check("NCDL Q2 2023 serves the quarter's own reconciling rows, the restatement recorded",
  !!nc23 && val(nc23, "niiAfterTax") === 18330000 && nc23.values.niiAfterTax.rows === "original" && nc23.values.niiAfterTax.restated.v === 18706000 &&
  val(nc23, "niiPerShare") === 0.6 && nc23.values.niiPerShare.basis.rows === "original" && nc23.values.niiAfterTax.crossCheck.reconciles === true,
  nc23 && JSON.stringify({ nii: nc23.values.niiAfterTax, ps: nc23.values.niiPerShare.basis }));
check("sharesOffScale judges a frame's count against net assets over NAV",
  sharesOffScale({ v: 22212400000 }, { v: 425773000 }, { v: 18.76 }) === true &&
  sharesOffScale({ v: 22212400 }, { v: 425773000 }, { v: 18.76 }) === false &&
  sharesOffScale({ v: 22212400000 }, null, { v: 18.76 }) === false);
/* a real weighted average well under the period-end count is kept:
   FRBP's 5,301,096 over 2021 against 15,260,764 outstanding at its end
   (10-K 0001825248-23-000004), a filer that raised capital through the
   year */
const f21 = F.periods.find((p) => p.end === "2021-12-31");
check("FRBP's 2021 weighted average, a third of the year-end count, is kept",
  !!f21 && val(f21, "weightedShares") === 5301096 && !F.flags.some((f) => f.key === "weightedShares"), f21 && JSON.stringify(f21.values.weightedShares));

/* ---------- where each series starts ---------- */

check("ARCC's firstPeriod says NAV from 2012, net assets from 2013, the portfolio from 2021 Q4, before the window",
  A.firstPeriod.navPerShare === "2012-12-31" && A.firstPeriod.netAssets === "2013-12-31" && A.firstPeriod.portfolioFairValue === "2021-12-31" &&
  A.firstPeriod.portfolioCost === "2021-12-31" && A.periods[0].end > "2013-12-31", JSON.stringify(A.firstPeriod));
check("firstPeriod names every concept the series ever answers and nothing else",
  Object.keys(A.firstPeriod).every((k) => BDC_CONCEPTS[k]) &&
  Object.keys(BDC_CONCEPTS).every((k) => !A.periods.some((p) => p.values[k]) || A.firstPeriod[k] <= A.periods.find((p) => p.values[k]).end));
check("a flag is only served for a quarter the file carries", A.flags.every((f) => !f.key || A.periods.some((p) => p.end === f.end)));

/* ---------- the frames path: a refused share count and a derived per-share ---------- */

check("a frame entry with a flag and no payload keeps the flag for the quarter", (() => {
  const S = buildBdcSeries(lagged, { fyEndMonth: 12 });
  mergeFrames(S, [{ key: "weightedShares", payload: null, flag: { end: "2026-06-30", reason: "test shares flag" } }], { cik: fx.cik });
  return S.flags.some((f) => f.key === "weightedShares" && f.end === "2026-06-30" && f.reason === "test shares flag") &&
    !S.periods.some((p) => p.end === "2026-06-30");
})());
check("a frame payload's derived and rejected fields travel onto the value", (() => {
  const S = buildBdcSeries(lagged, { fyEndMonth: 12 });
  const ps = { ...fx.frames.navPerShare, tag: "n/w", data: [{ ...fx.frames.navPerShare.data[0], start: "2026-04-01", val: 0.5 }],
               derived: "nii-over-shares", rejected: { v: 0.9, tag: "p", accn: null } };
  mergeFrames(S, [{ key: "niiPerShare", payload: ps }], { cik: fx.cik });
  const v = S.latest.niiPerShare;
  return !!v && v.v === 0.5 && v.derived === "nii-over-shares" && v.rejected.v === 0.9 && v.source === "frames" && S.firstPeriod.niiPerShare < "2026-06-30";
})());
check("a frame share count on the wrong scale is emptied by the same guard", (() => {
  const S = buildBdcSeries(lagged, { fyEndMonth: 12 });
  const na = { ...fx.frames.navPerShare, tag: "StockholdersEquity", uom: "USD", data: [{ ...fx.frames.navPerShare.data[0], val: 13891000000 }] };
  const ws = { ...fx.frames.navPerShare, tag: "WeightedAverageNumberOfSharesOutstandingBasic", uom: "shares", data: [{ ...fx.frames.navPerShare.data[0], start: "2026-04-01", val: 718000000000 }] };
  mergeFrames(S, [{ key: "navPerShare", payload: fx.frames.navPerShare }, { key: "netAssets", payload: na }, { key: "weightedShares", payload: ws }], { cik: fx.cik });
  return !S.periods.find((p) => p.end === "2026-06-30").values.weightedShares &&
    S.flags.some((f) => f.key === "weightedShares" && f.end === "2026-06-30" && f.value === 718000000000);
})());

/* ---------- classification rules and the merger table ---------- */

/* the lien map is credit.js's, re-exported: one vocabulary for the
   holdings build and the page */
check("lien classes come from credit.js", lienClass("First lien senior secured loan") === LIEN.FIRST &&
  lienClass("Second lien senior secured loan") === LIEN.SECOND &&
  lienClass("One stop") === LIEN.FIRST_UNITRANCHE &&
  lienClass("First lien last-out") === LIEN.FIRST_UNITRANCHE &&
  lienClass("Senior subordinated loan") === LIEN.UNSECURED &&
  lienClass("Preferred equity") === LIEN.EQUITY && lienClass("CLO equity") === LIEN.VEHICLES &&
  lienClass("Secured Debt") === null && lienClass("Secured Debt", { "secured debt": LIEN.FIRST }) === LIEN.FIRST);
check("affiliation classes", classifyAffiliation("Ivy Hill Asset Management | controlled") === "controlled" &&
  classifyAffiliation("Acme Corp | non-controlled/non-affiliated") === "non-controlled/non-affiliated" &&
  classifyAffiliation("Acme Corp | non-controlled affiliated") === "non-controlled affiliated");
check("vehicles", isVehicle("Ivy Hill Asset Management, L.P.") && isVehicle("Senior Direct Lending Program LLC") && !isVehicle("Acme Software Inc."));
check("every merger row is dated, quartered and sourced on sec.gov",
  MERGERS.length > 0 && MERGERS.every((m) => /^[A-Z]+$/.test(m.acquirer) && Number.isInteger(m.acquirerCik) &&
    Number.isInteger(m.targetCik) && /^\d{4}-\d{2}-\d{2}$/.test(m.closeDate) && /^\d{4}-\d{2}-\d{2}$/.test(m.closeQuarter) &&
    m.closeQuarter >= m.closeDate && m.closeDate >= "2021-01-01" && /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//.test(m.source)));
/* OBDC's Item 2.01 8-K of 2025-01-13, accession 0001628280-25-001250 */
const obde = MERGERS.find((m) => m.acquirer === "OBDC" && m.target === "OBDE");
check("OBDC/OBDE closed 2025-01-13 in the quarter to 2025-03-31", !!obde && obde.closeDate === "2025-01-13" && obde.closeQuarter === "2025-03-31" &&
  obde.source.includes("000162828025001250"));

/* ---------- the derived fourth quarter cross-check: HRZN, MSIF ----------
 *
 * Horizon's 10-Q filed 2022-11-01 tags -0.40 as NII per share for the
 * nine months to 2022-09-30 (another line; the 10-Q filed 2023-10-31
 * restates it to 1.06), so the year's 1.46 less the original row is
 * 1.86 against 10,740,000 of after-tax NII (36,187,000 for the year
 * less 25,447,000 for the nine months) over the fourth quarter's
 * estimated shares: four times the year's 24,726,079 less the three
 * quarters' 21,904,160, 24,301,762 and 25,738,054 is 26,960,340, and
 * 10,740,000 over it is 0.3984. The latest pair, 1.46 less 1.06, is
 * 0.40 and reconciles. */
const hrzn = load("hrzn-companyfacts-slice.json");
const HZ = buildBdcSeries(hrzn.facts, { fyEndMonth: 12 });
const hz4 = HZ.periods.find((p) => p.end === "2022-12-31");
const hzn = hz4 && hz4.values.niiAfterTax, hzps = hz4 && hz4.values.niiPerShare;
check("HRZN Q4 2022 NII 10,740,000 derived from the 2023 10-K's year less the nine months",
  !!hzn && hzn.v === 10740000 && hzn.periodType === "derivedQ4" && hzn.accn === "0001437749-24-005719" && hzn.basis.less === 25447000,
  hzn && `${hzn.v} ${hzn.accn} ${JSON.stringify(hzn.basis)}`);
check("HRZN Q4 2022 NII per share 0.40 from the latest pair (1.46 less the restated 1.06), never 1.86 from the original -0.40",
  !!hzps && hzps.v === 0.4 && hzps.basis.rows === "latest" && hzps.basis.less === 1.06 && hzps.basis.ytd === 1.46 && /cross-check/.test(hzps.note),
  hzps && JSON.stringify(hzps));
check("the check ran on the estimated fourth-quarter count, 26,960,340, at the derived tolerance",
  !!hzn && hzn.crossCheck.reconciles === true && hzn.crossCheck.shares === 26960340 && hzn.crossCheck.sharesEstimate === "annual-less-quarters" &&
  hzn.crossCheck.implied === 0.3984 && hzn.crossCheck.tolerance.rel === NII_DERIVED_TOLERANCE.rel, hzn && JSON.stringify(hzn.crossCheck));
check("no HRZN quarter serves a derived NII per share above four times its NII over shares",
  HZ.periods.every((p) => !p.values.niiPerShare || !p.values.niiAfterTax || !p.values.sharesOutstanding ||
    Math.abs(p.values.niiPerShare.v) <= 4 * Math.abs(p.values.niiAfterTax.v / p.values.sharesOutstanding.v) + 0.05));
/* 2021: the nine-month comparative is -0.14 with no restated row, so
   1.41 less it (1.55) reconciles with nothing; 8,059,000 of NII sits
   beside a third quarter of 8,047,000 and is kept, and NII over the
   year-end count (21,217,460, the estimate where the quarters' counts
   are missing) takes the per-share figure's place */
const hz21 = HZ.periods.find((p) => p.end === "2021-12-31");
check("HRZN Q4 2021: the NII is kept flagged and the per-share figure is NII over the estimated count, 1.55 recorded as rejected",
  !!hz21 && val(hz21, "niiAfterTax") === 8059000 && hz21.values.niiPerShare.derived === "nii-over-shares" && hz21.values.niiPerShare.v === 0.3798 &&
  hz21.values.niiPerShare.rejected.v === 1.55 && hz21.values.niiPerShare.sharesEstimate === "sharesOutstanding" &&
  HZ.flags.some((f) => f.key === "niiPerShare" && f.end === "2021-12-31" && f.value === 1.55),
  hz21 && JSON.stringify(hz21.values.niiPerShare));
check("fourthQuarterShares: the filer's own count, then the annual less the quarters, then the year-end count, then the annual",
  (() => {
    const q = (v) => ({ values: { weightedShares: { v, periodType: "3M", start: "2022-01-01", end: "2022-03-31", tag: "w" } } });
    const p = { end: "2022-12-31", values: { weightedShares: { v: 24726079, periodType: "YTD", start: "2022-01-01", end: "2022-12-31", tag: "w" },
      sharesOutstanding: { v: 27753373, tag: "s" } } };
    const a = fourthQuarterShares(p, [q(21904160), q(24301762), q(25738054)]);
    const b = fourthQuarterShares(p, [q(21904160), null, q(25738054)]);
    const c = fourthQuarterShares({ end: p.end, values: { weightedShares: p.values.weightedShares } }, []);
    const d = fourthQuarterShares({ end: p.end, values: { weightedShares: { ...p.values.weightedShares, periodType: "3M", start: "2022-10-01" } } }, []);
    return a.v === 26960340 && a.estimate === "annual-less-quarters" && b.v === 27753373 && b.estimate === "sharesOutstanding" &&
      c.v === 24726079 && c.estimate === "annual" && d.estimate === null && d.v === 24726079;
  })());
/* MSC Income's reverse split: the 10-K for 2024 tags 1.43 of NII per
   share and 1.45 of distributions for the year post-split, the 10-Q of
   2024-11-14 tags 0.54 and 0.54 for the nine months pre-split, and the
   10-Q of 2025-11-14 restates them to 1.00 and 1.09. The original pair
   gives 0.89 and 0.91 for the fourth quarter against 13,559,000 over
   40,233,200 estimated shares (0.337) and three quarters near 0.37;
   the latest pair gives 0.34 and 0.36. */
const msif = load("msif-companyfacts-slice.json");
const MS = buildBdcSeries(msif.facts, { fyEndMonth: 12 });
const ms4 = MS.periods.find((p) => p.end === "2024-12-31");
check("MSIF Q4 2024 NII per share 0.34 from the latest pair, reconciled against the estimated count",
  !!ms4 && val(ms4, "niiPerShare") === 0.34 && ms4.values.niiPerShare.basis.rows === "latest" && val(ms4, "niiAfterTax") === 13559000 &&
  ms4.values.niiAfterTax.crossCheck.reconciles === true && ms4.values.niiAfterTax.crossCheck.shares === 40233200,
  ms4 && JSON.stringify(ms4.values.niiAfterTax.crossCheck));
check("MSIF Q4 2024 distributions 0.36 from the latest pair, chosen against the year's other quarters, the 0.91 flagged",
  !!ms4 && val(ms4, "distributionsPerShare") === 0.36 && ms4.values.distributionsPerShare.basis.rows === "latest" &&
  MS.flags.some((f) => f.key === "distributionsPerShare" && f.end === "2024-12-31" && f.value === 0.91 && f.other === 0.36),
  ms4 && JSON.stringify(ms4.values.distributionsPerShare));
/* a tagged three-month fact a cent or two from NII over shares is the
   filer's figure: MSIF's 0.36 for the quarter to 2024-03-31 (10-Q
   0001535778-25-000088) against 13,988,000 over 40,129,395, 0.3486, is
   kept with the implied figure beside it and flagged, not replaced */
const ms1 = MS.periods.find((p) => p.end === "2024-03-31");
check("MSIF Q1 2024 keeps the tagged 0.36 with the implied 0.3486 recorded beside it",
  !!ms1 && val(ms1, "niiPerShare") === 0.36 && !ms1.values.niiPerShare.derived && ms1.values.niiPerShare.crossCheck.implied === 0.3486 &&
  ms1.values.niiPerShare.crossCheck.reconciles === false && MS.flags.some((f) => f.key === "niiAfterTax" && f.end === "2024-03-31") &&
  !MS.flags.some((f) => f.key === "niiPerShare" && f.end === "2024-03-31"), ms1 && JSON.stringify(ms1.values.niiPerShare));
check("largeGap: a cent or two is not large, a twentieth or a quarter of the figure is",
  !largeGap(0.47, 0.4891) && !largeGap(1.05, 1.0152) && largeGap(0.19, -0.8988) && largeGap(-0.09, 0.026) && largeGap(0.1, 0.16) && !largeGap(0.1, 0.12));

/* ---------- a preferred dividend: CGBD, PSEC ----------
 *
 * Carlyle's 0.47 for the quarter to 2022-03-31 is per common share:
 * 25,872,000 less the 875,000 preferred dividend over 52,892,054 is
 * 0.4726, where the gross figure is 0.4891. Prospect's 0.16 for the
 * quarter to 2026-03-31 is before its preferred dividend (78,457,000
 * over 483,414,178 is 0.1623), so the gross figure is tried first. */
const cgbd = load("cgbd-companyfacts-slice.json");
const CG = buildBdcSeries(cgbd.facts, { fyEndMonth: 12 });
const cg1 = CG.periods.find((p) => p.end === "2022-03-31");
check("CGBD Q1 2022 serves the tagged 0.47, reconciled net of the 875,000 preferred dividend",
  !!cg1 && val(cg1, "niiPerShare") === 0.47 && !cg1.values.niiPerShare.derived && cg1.values.niiPerShare.accn === "0001544206-23-000043" &&
  val(cg1, "niiAfterTax") === 25872000 && val(cg1, "preferredDividends") === 875000 &&
  cg1.values.niiAfterTax.crossCheck.reconciles === true && cg1.values.niiAfterTax.crossCheck.preferredDividends === 875000 &&
  cg1.values.niiAfterTax.crossCheck.implied === 0.4726 && cg1.values.niiAfterTax.crossCheck.perCommonShare === true,
  cg1 && JSON.stringify(cg1.values.niiAfterTax.crossCheck));
check("no CGBD quarter replaces a tagged per-share fact with NII over shares",
  CG.periods.every((p) => !p.values.niiPerShare || p.values.niiPerShare.derived !== "nii-over-shares"),
  JSON.stringify(CG.periods.filter((p) => p.values.niiPerShare && p.values.niiPerShare.derived === "nii-over-shares").map((p) => p.end)));
const ps3 = P.periods.find((p) => p.end === "2026-03-31");
check("PSEC Q3 fiscal 2026 reconciles gross of the preferred dividend and serves the tagged 0.16",
  !!ps3 && val(ps3, "niiPerShare") === 0.16 && val(ps3, "niiAfterTax") === 78457000 && ps3.values.niiAfterTax.crossCheck.reconciles === true &&
  !ps3.values.niiAfterTax.crossCheck.preferredDividends, ps3 && JSON.stringify(ps3.values.niiAfterTax.crossCheck));
/* the common-only line first: 191,708,000 for the nine months less
   126,287,000 for the half year (10-Qs 0001287032-26-000164 and
   0001287032-26-000045) is 65,421,000, the 92,123,000 declared less the
   26,702,000 preferred dividend; without the line the total is netted */
check("PSEC's distributions per share come from the common line: 65,421,000 over 483,414,178 is 0.1353",
  !!ps3 && val(ps3, "distributionsPerShare") === 0.1353 && ps3.values.distributionsPerShare.derived === "dollars-over-shares" &&
  ps3.values.distributionsPerShare.tag === "DividendsCommonStock/WeightedAverageNumberOfSharesOutstandingBasic" &&
  val(ps3, "distributionsCommon") === 65421000 && /common dividends/.test(ps3.values.distributionsPerShare.note),
  ps3 && JSON.stringify(ps3.values.distributionsPerShare));
check("without the common line the total is netted of the preferred dividend: 92,123,000 less 26,702,000 over 483,414,178 is 0.1353", (() => {
  const noCommon = { ...psec.facts["us-gaap"] };
  delete noCommon.DividendsCommonStock;
  const S = buildBdcSeries({ "us-gaap": noCommon }, { fyEndMonth: 6 });
  const d = S.periods.find((p) => p.end === "2026-03-31").values.distributionsPerShare;
  return !!d && d.v === 0.1353 && d.preferredDividends === 26702000 && /less the preferred/.test(d.note) && /inferred/.test(d.note);
})());
check("PSEC's fiscal fourth quarter serves dollars over the estimated count", (() => {
  const d = p4.values.distributionsPerShare;
  return !!d && d.periodType === "derivedQ4" && d.derived === "dollars-over-shares" && d.sharesEstimate === "annual-less-quarters" && d.v > 0 && d.v < 0.25;
})());

/* ---------- a component tagged as the dividend: TSLX, HTGC ----------
 *
 * Sixth Street's 10-Qs of 2021-2023 tag the supplemental alone under
 * the distributions tag (0.02 for the quarter to 2022-03-31 against
 * 0.47 of NII per share and a 16.88 NAV) and its 10-K of 2026 tags the
 * total for 2023, 2.10, the only row for that year: the year less the
 * nine-month 0.03 is 2.07. Both are components, and with no dollar
 * distributions tagged before 2023 the quarters are left empty. */
const tslx = load("tslx-companyfacts-slice.json");
const TS = buildBdcSeries(tslx.facts, { fyEndMonth: 12 });
const ts1 = TS.periods.find((p) => p.end === "2022-03-31"), ts4 = TS.periods.find((p) => p.end === "2023-12-31");
check("TSLX Q1 2022's 0.02 is a component, emptied and flagged",
  !!ts1 && ts1.values.distributionsPerShare === null &&
  TS.flags.some((f) => f.key === "distributionsPerShare" && f.end === "2022-03-31" && f.value === 0.02 && /component/.test(f.reason) && f.niiPerShare === 0.47),
  JSON.stringify(TS.flags.filter((f) => f.key === "distributionsPerShare" && f.end === "2022-03-31")));
check("TSLX Q4 2023's 2.07 (2.10 less a nine-month component of 0.03) is emptied and flagged",
  !!ts4 && ts4.values.distributionsPerShare === null &&
  TS.flags.some((f) => f.key === "distributionsPerShare" && f.end === "2023-12-31" && f.value === 2.07 && f.less === 0.03 && /component/.test(f.reason)),
  JSON.stringify(TS.flags.filter((f) => f.key === "distributionsPerShare" && f.end === "2023-12-31")));
check("no TSLX quarter serves a distribution under a tenth of its NII per share",
  TS.periods.every((p) => !p.values.distributionsPerShare || !p.values.niiPerShare || p.values.niiPerShare.v <= 0 ||
    p.values.distributionsPerShare.v >= 0.1 * p.values.niiPerShare.v));
check("TSLX's 2025 quarters still serve the tagged figure (0.53 for the quarter to 2025-03-31)",
  val(TS.periods.find((p) => p.end === "2025-03-31"), "distributionsPerShare") === 0.53);
/* Hercules's 10-Q of 2022-11-02 (0000950170-22-021225) tags 0.09 for
   the nine months to 2021-09-30 against the 10-K's 1.55 for the year
   (0000950170-23-003044): the fourth quarter derived from them, 1.46,
   is more than a quarter from the dollars declared (179,575,000 less
   133,143,000, 46,432,000) over the fourth quarter's estimated shares,
   and the dollars answer */
const h21 = H.periods.find((p) => p.end === "2021-12-31");
check("HTGC Q4 2021 serves dollars over shares in place of the 1.46 derived from a component row",
  !!h21 && h21.values.distributionsPerShare.derived === "dollars-over-shares" && h21.values.distributionsPerShare.periodType === "derivedQ4" &&
  within(val(h21, "distributionsPerShare"), 0.40, 0.05) &&
  H.flags.some((f) => f.key === "distributionsPerShare" && f.end === "2021-12-31" && f.value === 1.46 && /dollars over shares used/.test(f.reason)),
  h21 && JSON.stringify(h21.values.distributionsPerShare));

/* ---------- the annual-less-quarters branch: MAIN, NSLR ----------
 *
 * Main Street's after-tax tag starts at 2023 Q4, so its year for 2023
 * (330,742,000, 10-K 0001396440-26-000016) has no quarters of its own
 * to subtract and the step answers null; NetInvestmentIncome, whose
 * year 339,019,000 (10-K 0001396440-24-000055) less its nine months
 * 248,872,000 is 90,147,000, answers with the note, beside the 1.07 per
 * share (4.14 less 3.07, the same basis), and reconciles over the
 * estimated fourth-quarter count.
 * NSLR's InvestmentIncomeInvestmentExpense is tagged for the year only,
 * and the 10-K tags the fourth quarter's OperatingExpenses, 5,203,812
 * (0001493152-24-009905). */
const mn23 = MN.periods.find((p) => p.end === "2023-12-31");
check("MAIN Q4 2023 NII 90,147,000 on the pre-tax step, never the after-tax year less pre-tax quarters",
  !!mn23 && val(mn23, "niiAfterTax") === 90147000 && mn23.values.niiAfterTax.step === 3 && mn23.values.niiAfterTax.accn === "0001396440-24-000055" &&
  mn23.values.niiAfterTax.basis.less === 248872000 && /no tax line/.test(mn23.values.niiAfterTax.note) &&
  val(mn23, "niiPreTax") === 90147000 && val(mn23, "niiPerShare") === 1.07 && mn23.values.niiAfterTax.crossCheck.reconciles === true,
  mn23 && JSON.stringify(mn23.values.niiAfterTax));
const ns23 = NS.periods.find((p) => p.end === "2023-12-31");
check("NSLR Q4 2023 total expenses 5,203,812 from the tagged OperatingExpenses fact, not an annual less another tag's quarters",
  !!ns23 && val(ns23, "totalExpenses") === 5203812 && ns23.values.totalExpenses.tag === "OperatingExpenses" && ns23.values.totalExpenses.periodType === "3M" &&
  !ns23.values.totalExpenses.differenced, ns23 && JSON.stringify(ns23.values.totalExpenses));
check("no quarter is an annual less quarters resolved on another step",
  [A, P, H, T, F, MN, NS, OX, NC, HZ, MS, CG, TS].every((S) => S.periods.every((p) => Object.values(p.values).every((v) =>
    !v || !v.basis || !v.basis.lessQuarters || v.basis.lessQuarters === p.fq - 1))));

/* ---------- a partial debt tag beside a facility: GLAD, BBDC ---------- */
const glad = load("glad-companyfacts-slice.json");
const GL = buildBdcSeries(glad.facts, { fyEndMonth: 9 });
const gl = GL.periods.find((p) => p.end === "2026-06-30");
check("GLAD 2026-06-30 debt is the notes plus the facility, 437,000,000, flagged",
  !!gl && val(gl, "debt") === 437000000 && gl.values.debt.derived === "notes-plus-facility" && gl.values.debt.components.LineOfCredit === 177500000 &&
  gl.values.debt.components.DebtInstrumentCarryingAmount === 259500000 && val(gl, "lineOfCredit") === 177500000 &&
  GL.flags.some((f) => f.key === "debt" && f.end === "2026-06-30" && f.value === 259500000 && f.lineOfCredit === 177500000 && /notes plus facility/.test(f.reason)),
  gl && JSON.stringify(gl.values.debt));
const bbdc = load("bbdc-companyfacts-slice.json");
const BB = buildBdcSeries(bbdc.facts, { fyEndMonth: 12 });
const bb = BB.periods.find((p) => p.end === "2026-06-30");
check("BBDC 2026-06-30 debt is LongTermDebt plus the facility, 1,394,715,000, flagged",
  !!bb && val(bb, "debt") === 1394715000 && bb.values.debt.tag === "LongTermDebt+LineOfCredit" &&
  BB.flags.some((f) => f.key === "debt" && f.end === "2026-06-30" && f.value === 1117489000), bb && JSON.stringify(bb.values.debt));
check("PSEC's 1,878,595,000, inside the normal range, is never added to its 562,328,000 facility",
  val(p4, "debt") === 1878595000 && !p4.values.debt.derived && val(p4, "lineOfCredit") === 562328000);
/* Gladstone Investment's tag carries the facility: 400,938,000 beside
   a 63,700,000 facility against 436,826,000 of liabilities at
   2024-06-30 (10-Q 0001321741-24-000013) exceeds them, so the filer is
   never added to, and 2024-09-30 (346,138,000 and 8,900,000 against
   410,405,000, 10-Q 0001321741-24-000017, a sum that would fit) keeps
   the tag alone */
const gain = load("gain-companyfacts-slice.json");
const GA = buildBdcSeries(gain.facts, { fyEndMonth: 3 });
const ga = GA.periods.find((p) => p.end === "2024-09-30");
check("GAIN's tag carries its facility, so 2024-09-30 stays 346,138,000 with no addition",
  !!ga && val(ga, "debt") === 346138000 && !ga.values.debt.derived && val(ga, "lineOfCredit") === 8900000 &&
  GA.periods.every((p) => !p.values.debt || !p.values.debt.derived) && !GA.flags.some((f) => f.key === "debt"),
  ga && JSON.stringify(ga.values.debt));
check("ARCC's debt is untouched", val(a2, "debt") === 15924000000 && !a2.values.debt.derived);

console.log(failed ? "\n" + failed + " failed" : "\nall bdc-series checks pass");
process.exit(failed ? 1 : 0);
