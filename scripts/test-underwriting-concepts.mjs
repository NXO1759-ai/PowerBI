/**
 * test-underwriting-concepts.mjs — PR F's concept addition, pure-unit
 * reader and ratios.js additions, offline, against companyfacts slices of
 * the filers the blueprint names.
 *
 * LIVE PROBE, 2026-09-22. Every figure pinned below was read from
 * https://data.sec.gov/api/xbrl/companyfacts/CIK<cik>.json (through the
 * paced getJson in sec-pull.mjs, with SEC_UA) on 2026-09-22, before it was
 * written down, and the fixtures were cut from the same live pull the
 * same day (scripts/fixtures/underwriting/cut-slice.mjs — read that file
 * first for how). Filings: AT&T (T, CIK 732717) 10-K for fiscal 2025,
 * filed 2026-02-09, accession 0000732717-26-000120; NVIDIA (NVDA, CIK
 * 1045810) 10-Q for the quarter to 2026-07-26, filed 2026-08-26,
 * accession 0001045810-26-000075; RTX Corporation (RTX, CIK 101829) 10-K
 * for fiscal 2025, filed 2026-02-06, accession 0000101829-26-000006.
 *
 * Why RTX proves the pure-unit reader. DebtWeightedAverageInterestRate is
 * rare among operating companies, exactly as the blueprint says: the
 * frames API (frames/us-gaap/DebtWeightedAverageInterestRate/pure/
 * CY2025Q4I.json, pulled 2026-09-22) lists 206 filers tagging it for
 * fiscal 2025, against roughly 8,000 in the SEC index frontend/data/
 * company-index.js carries. Neither AT&T nor NVIDIA tags it at all (nor
 * LineOfCreditFacilityRemainingBorrowingCapacity); RTX tags both, and
 * only in its 10-K — neither survives into either of its 2026 10-Qs.
 * Freeport-McMoRan (FCX, CIK 831259) also tags the rate at 2025-12-31
 * (0.039) in the same frame and would serve as a second proof if one is
 * ever needed.
 *
 *   tag                                              filer  value          period
 *   LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths  T  8,652,000,000   2025-12-31 (10-K)
 *   ...InYearTwo / InYearThree / InYearFour / InYearFive / AfterYearFive  T  8,953 / 6,905 / 6,918 / 7,020 / 106,216 million  2025-12-31
 *   LongTermDebtMaturitiesRepaymentsOfPrincipalRemainderOfFiscalYear     T  NOT TAGGED (a 10-K reports the whole year; the "remainder" bucket is a 10-Q-only concept)
 *   LineOfCreditFacilityRemainingBorrowingCapacity   T  NOT TAGGED (any period)
 *   DebtWeightedAverageInterestRate                  T  NOT TAGGED (any period)
 *   LongTermDebtFairValue, NotesPayableFairValueDisclosure  T  NOT TAGGED since 2019 (stale, outside this fixture's 2022 window)
 *   InterestPaidNet                                  T  6,625,000,000   2025-01-01..2025-12-31
 *   LongTermDebtMaturitiesRepaymentsOfPrincipal* (all seven buckets)  NVDA  NOT TAGGED at any period end
 *   LongTermDebtFairValue                            NVDA  31,400,000,000  2026-07-26 (10-Q)
 *   DebtWeightedAverageInterestRate                  RTX  0.040 / 0.046 / 0.045 / 0.045  2022-12-31 / 2023-12-31 / 2024-12-31 / 2025-12-31, all 10-Ks
 *   LineOfCreditFacilityRemainingBorrowingCapacity   RTX  800,000,000 / 700,000,000 / 700,000,000 / 600,000,000  same four dates, same 10-Ks
 *
 * Fixtures (scripts/fixtures/underwriting/): t-companyfacts-slice.json,
 * nvda-companyfacts-slice.json and rtx-companyfacts-slice.json, all cut
 * 2026-09-22 from 2022-01-01 onward.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { BALANCE, CASHFLOW, PURE } from "./lib/concepts.mjs";
import { buildStatements } from "./lib/statements.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const RTRatios = require("../frontend/lib/ratios.js");

const load = (t) => JSON.parse(readFileSync(join(here, "fixtures/underwriting", t.toLowerCase() + "-companyfacts-slice.json"), "utf8"));

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};

const S = {};
const series = (t) => S[t] || (S[t] = buildStatements(load(t).facts["us-gaap"]));
const annual = (t, end, key) => { const p = series(t).annual.find((x) => x.periodEnd === end); return p ? p.balanceSheet[key] : undefined; };
const annualPure = (t, end, key) => { const p = series(t).annual.find((x) => x.periodEnd === end); return p ? p.pure[key] : undefined; };
const annualCf = (t, end, key) => { const p = series(t).annual.find((x) => x.periodEnd === end); return p ? p.cashFlow[key] : undefined; };
const annualIs = (t, end, key) => { const p = series(t).annual.find((x) => x.periodEnd === end); return p ? p.incomeStatement[key] : undefined; };
const periodOf = (t, grain, end) => series(t)[grain].find((x) => x.periodEnd === end);
const allPeriods = (t) => [...series(t).annual, ...series(t).quarterly, ...series(t).ltm];

/* ---------- 1. concepts.mjs: revolverCapacity added, four ladders confirmed already present ---------- */
console.log("scripts/lib/concepts.mjs");

check("revolverCapacity is a new BALANCE entry reading LineOfCreditFacilityRemainingBorrowingCapacity",
  Array.isArray(BALANCE.revolverCapacity) && BALANCE.revolverCapacity.join() === "LineOfCreditFacilityRemainingBorrowingCapacity");

check("opLeaseDue already existed (not re-added): LesseeOperatingLeaseLiabilityPaymentsDue",
  BALANCE.opLeaseDue.join() === "LesseeOperatingLeaseLiabilityPaymentsDue");
check("the full maturity ladder already existed: remainder, next-twelve-months, years two through five, after year five",
  BALANCE.maturityRemainderOfFiscalYear.join() === "LongTermDebtMaturitiesRepaymentsOfPrincipalRemainderOfFiscalYear" &&
  BALANCE.maturityNextTwelveMonths.join() === "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths" &&
  BALANCE.maturityYearTwo.join() === "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo" &&
  BALANCE.maturityYearThree.join() === "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree" &&
  BALANCE.maturityYearFour.join() === "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour" &&
  BALANCE.maturityYearFive.join() === "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive" &&
  BALANCE.maturityAfterYearFive.join() === "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive");
check("interestPaid already existed: InterestPaidNet then InterestPaid",
  CASHFLOW.interestPaid.join() === "InterestPaidNet,InterestPaid");
check("debtFairValue already existed: LongTermDebtFairValue then NotesPayableFairValueDisclosure",
  BALANCE.debtFairValue.join() === "LongTermDebtFairValue,NotesPayableFairValueDisclosure");
check("PURE is the one concept addition beyond revolverCapacity, and it is exactly the one tag the blueprint names",
  Object.keys(PURE).length === 1 && PURE.costOfDebtTagged.join() === "DebtWeightedAverageInterestRate");

/* ---------- 2. statements.mjs: the pure-unit reader ---------- */
console.log("\nscripts/lib/statements.mjs — the pure-unit reader");

check("AT&T does not tag the pure-unit cost of debt (statement reads null, never zero, at every period)",
  allPeriods("T").every((p) => p.pure.costOfDebtTagged === null));
check("AT&T does not tag revolverCapacity either (statement reads null at every period)",
  allPeriods("T").every((p) => p.balanceSheet.revolverCapacity === null));
check("RTX's fiscal 2022-2025 cost of debt reads 4.0% / 4.6% / 4.5% / 4.5%, tagged DebtWeightedAverageInterestRate, live and pinned",
  annualPure("RTX", "2022-12-31", "costOfDebtTagged") === 0.04 &&
  annualPure("RTX", "2023-12-31", "costOfDebtTagged") === 0.046 &&
  annualPure("RTX", "2024-12-31", "costOfDebtTagged") === 0.045 &&
  annualPure("RTX", "2025-12-31", "costOfDebtTagged") === 0.045,
  JSON.stringify(["2022", "2023", "2024", "2025"].map((y) => annualPure("RTX", y + "-12-31", "costOfDebtTagged"))));
check("the tag each RTX period resolved from is recorded under pure.costOfDebtTagged",
  periodOf("RTX", "annual", "2025-12-31").tags["pure.costOfDebtTagged"] === "DebtWeightedAverageInterestRate");
check("RTX's cost of debt is annual-only: neither 2026 10-Q re-tags it, so the two 2026 quarters read null",
  series("RTX").quarterly.filter((p) => p.periodEnd > "2025-12-31" && p.periodEnd < "2026-12-31")
    .every((p) => p.pure.costOfDebtTagged === null));
check("a derived RTX fourth quarter carries the year-end reading, not a subtraction (an instant ratio, like a balance)",
  (() => {
    const q4 = series("RTX").quarterly.find((p) => p.periodEnd === "2025-12-31" && p.fiscalPeriod === "Q4");
    return !!q4 && q4.pure.costOfDebtTagged === 0.045 && q4.tags["pure.costOfDebtTagged"] === "DebtWeightedAverageInterestRate";
  })());
check("RTX also tags revolverCapacity, real (not fallback) figures for all four fiscal years: 800M / 700M / 700M / 600M",
  annual("RTX", "2022-12-31", "revolverCapacity") === 800000000 &&
  annual("RTX", "2023-12-31", "revolverCapacity") === 700000000 &&
  annual("RTX", "2024-12-31", "revolverCapacity") === 700000000 &&
  annual("RTX", "2025-12-31", "revolverCapacity") === 600000000);

/* The fallback: interest expense over average debt, for a filer (AT&T)
   that never tags a cost of debt. This is arithmetic the underwriting
   page will run, not a new statements.mjs reader — computed here, once,
   to pin what the page's fallback would actually produce for a real
   filer with no tagged rate to fall back from. */
console.log("\nthe fallback (interest expense over average debt) where a filer never tags a cost of debt");
{
  const y2025 = periodOf("T", "annual", "2025-12-31"), y2024 = periodOf("T", "annual", "2024-12-31");
  const debt = (p) => p.balanceSheet.shortTermDebt + p.balanceSheet.longTermDebt;
  const avgDebt = (debt(y2025) + debt(y2024)) / 2;
  const fallback = Math.abs(y2025.incomeStatement.interestExpense) / avgDebt;
  check("AT&T's interest-expense-over-average-debt fallback computes to a plausible single-digit rate (about 5.4%), since the tagged rate is unavailable",
    fallback > 0.03 && fallback < 0.08, fallback.toFixed(4));
}

/* ---------- 3. the AT&T maturity ladder, confirmed against live data ---------- */
console.log("\nthe blueprint's own acceptance: AT&T's maturity ladder");

const attLadder = {
  ntm: annual("T", "2025-12-31", "maturityNextTwelveMonths"),
  y2: annual("T", "2025-12-31", "maturityYearTwo"),
  y3: annual("T", "2025-12-31", "maturityYearThree"),
  y4: annual("T", "2025-12-31", "maturityYearFour"),
  y5: annual("T", "2025-12-31", "maturityYearFive"),
  after5: annual("T", "2025-12-31", "maturityAfterYearFive"),
};
check("AT&T's maturity ladder at its most recent tagged period (2025-12-31, the FY2025 10-K) reads 8.652 / 8.953 / 6.905 / 6.918 / 7.020 / 106.216 billion",
  attLadder.ntm === 8652000000 && attLadder.y2 === 8953000000 && attLadder.y3 === 6905000000 &&
  attLadder.y4 === 6918000000 && attLadder.y5 === 7020000000 && attLadder.after5 === 106216000000,
  JSON.stringify(attLadder));
check("rounded to two decimal places in billions, that is exactly the blueprint's 8.65 / 8.95 / 6.91 / 6.92 / 7.02 / 106.22B — no drift from the blueprint figure",
  (attLadder.ntm / 1e9).toFixed(2) === "8.65" && (attLadder.y2 / 1e9).toFixed(2) === "8.95" &&
  (attLadder.y3 / 1e9).toFixed(2) === "6.91" && (attLadder.y4 / 1e9).toFixed(2) === "6.92" &&
  (attLadder.y5 / 1e9).toFixed(2) === "7.02" && (attLadder.after5 / 1e9).toFixed(2) === "106.22");
check("AT&T's ladder is 10-K-only: the 'remainder of fiscal year' bucket, a 10-Q-only concept, is null throughout",
  allPeriods("T").every((p) => p.balanceSheet.maturityRemainderOfFiscalYear === null));

/* ---------- 4. NVIDIA: no maturity schedule tagged ---------- */
console.log("\nthe blueprint's own acceptance: NVIDIA has no maturity schedule tagged");

const NVDA_LADDER_KEYS = ["maturityRemainderOfFiscalYear", "maturityNextTwelveMonths", "maturityYearTwo",
  "maturityYearThree", "maturityYearFour", "maturityYearFive", "maturityAfterYearFive"];
check("every bucket of NVIDIA's maturity ladder is null at every period end in the fixture — null, not zero, and not merely the latest period",
  allPeriods("NVDA").every((p) => NVDA_LADDER_KEYS.every((k) => p.balanceSheet[k] === null)));
check("NVIDIA nonetheless carries other Underwriting inputs the ladder does not gate: opLeaseDue and debtFairValue both resolve",
  (() => {
    const latest = series("NVDA").quarterly.filter((p) => typeof p.balanceSheet.debtFairValue === "number").at(-1);
    const lease = series("NVDA").quarterly.filter((p) => typeof p.balanceSheet.opLeaseDue === "number").at(-1);
    return !!latest && !!lease;
  })());
check("NVIDIA's debtFairValue at its latest tagged period (2026-07-26, the 10-Q for the quarter to that date) reads 31,400,000,000",
  (() => {
    const p = periodOf("NVDA", "quarterly", "2026-07-26");
    return !!p && p.balanceSheet.debtFairValue === 31400000000;
  })());
check("NVIDIA does not tag revolverCapacity or the pure-unit cost of debt either",
  allPeriods("NVDA").every((p) => p.balanceSheet.revolverCapacity === null && p.pure.costOfDebtTagged === null));

/* ---------- 5. frontend/lib/ratios.js additions ---------- */
console.log("\nfrontend/lib/ratios.js — fixedChargeCoverage, ffoToDebt, bandDistance");

check("fixedChargeCoverage refuses on a missing input rather than treating it as zero",
  RTRatios.fixedChargeCoverage(1000, null, 50, 100, 50) === null &&
  RTRatios.fixedChargeCoverage(1000, 200, 50, null, 50) === null &&
  RTRatios.fixedChargeCoverage(null, 200, 50, 100, 50) === null);
check("ffoToDebt refuses on a missing input",
  RTRatios.ffoToDebt(null, 2000) === null && RTRatios.ffoToDebt(500, null) === null);
check("bandDistance refuses a non-numeric value and an empty band table",
  RTRatios.bandDistance(null, RTRatios.SP_FINANCIAL_RISK_BANDS) === null &&
  RTRatios.bandDistance(2.5, []) === null &&
  RTRatios.bandDistance(2.5, null) === null);

/* AT&T's fiscal 2025, hand-computed from the same fixture the ladder
   checks above already pinned. EBITDA is operating income plus D&A (the
   house rule: never an adjusted figure); "cash taxes" stands in as the
   accrual income-tax provision, since no cash-taxes-paid tag is in the
   existing ladder, and "mandatory amortization" as the next-twelve-months
   maturity bucket already pinned above — both plain numbers the caller
   supplies, exactly as fixedChargeCoverage's signature expects. */
console.log("\na real company hand-computed case: AT&T's fiscal 2025 (2025-12-31)");
{
  const ebitda = annualIs("T", "2025-12-31", "operatingIncome") + annualCf("T", "2025-12-31", "depreciationAmortization");
  const capex = annualCf("T", "2025-12-31", "capex");
  const cashTaxes = annualIs("T", "2025-12-31", "incomeTax");
  const cashInterest = annualCf("T", "2025-12-31", "interestPaid");
  const mandatoryAmortization = annual("T", "2025-12-31", "maturityNextTwelveMonths");
  check("AT&T's inputs resolve to the pinned figures (24,162 + 20,886 EBITDA; 20,842 capex; 3,621 tax; 6,625 interest; 8,652 amortization, millions)",
    ebitda === 45048000000 && capex === 20842000000 && cashTaxes === 3621000000 &&
    cashInterest === 6625000000 && mandatoryAmortization === 8652000000,
    JSON.stringify({ ebitda, capex, cashTaxes, cashInterest, mandatoryAmortization }));
  const fcc = RTRatios.fixedChargeCoverage(ebitda, capex, cashTaxes, cashInterest, mandatoryAmortization);
  const byHand = (45048000000 - 20842000000 - 3621000000) / (6625000000 + 8652000000);
  check("fixedChargeCoverage matches the hand calculation, about 1.35x",
    Math.abs(fcc - byHand) < 1e-9 && fcc.toFixed(4) === "1.3475", String(fcc));

  const netIncome = annualIs("T", "2025-12-31", "netIncome");
  const da = annualCf("T", "2025-12-31", "depreciationAmortization");
  const totalDebt = annual("T", "2025-12-31", "shortTermDebt") + annual("T", "2025-12-31", "longTermDebt");
  const ffo = netIncome + da;
  const ftd = RTRatios.ffoToDebt(ffo, totalDebt);
  const ftdByHand = (21953000000 + 20886000000) / (9011000000 + 127089000000);
  check("ffoToDebt (FFO proxied as net income plus D&A, 42,839M) over total debt (136,100M) matches the hand calculation, about 31.5%",
    Math.abs(ftd - ftdByHand) < 1e-9 && ftd.toFixed(4) === "0.3148", String(ftd));

  /* net debt/EBITDA from the existing ratios pipeline (netDebtToEbitda,
     already in RTCatalog per the blueprint) drives bandDistance the same
     way the Leverage & coverage card would. */
  const ratios = RTRatios.computeRatios(series("T").annual);
  const r2025 = ratios.find((x) => x.periodEnd === "2025-12-31");
  const bd = RTRatios.bandDistance(r2025.netDebtToEbitda, RTRatios.SP_FINANCIAL_RISK_BANDS);
  check("AT&T's net debt/EBITDA (about 2.62x) falls in the Intermediate band with Significant next, 0.38 turns and a 12.8% EBITDA decline away, and no guidance-line fields (below the 4.0x sub-investment-grade threshold)",
    Math.abs(r2025.netDebtToEbitda - 2.6164535606464216) < 1e-6 &&
    bd.currentBand.key === "intermediate" && bd.nextBand.key === "significant" &&
    Math.abs(bd.turnsToNext - (3 - r2025.netDebtToEbitda)) < 1e-9 &&
    Math.abs(bd.ebitdaDeclinePctToNext - (3 - r2025.netDebtToEbitda) / 3) < 1e-9 &&
    bd.guidanceLine === null && bd.turnsToGuidanceLine === null && bd.ebitdaDeclinePctToGuidanceLine === null,
    JSON.stringify(bd));
}

/* A synthetic value at and above the 4.0x sub-investment-grade line, to
   exercise the guidance-line fields no covered company's own ratio
   reaches in this fixture set: bandDistance's arithmetic there is
   ordinary division, checked once against a value chosen to land exactly
   on band edges. */
console.log("\nthe leveraged-lending guidance line (synthetic value, arithmetic checked by hand)");
{
  const bd = RTRatios.bandDistance(4.5, RTRatios.SP_FINANCIAL_RISK_BANDS);
  check("4.5x sits in Aggressive, 0.5 turns and 10% of EBITDA from Highly leveraged, and 1.5 turns / 25% of EBITDA from the 6.0x guidance line",
    bd.currentBand.key === "aggressive" && bd.nextBand.key === "highlyLeveraged" &&
    bd.turnsToNext === 0.5 && Math.abs(bd.ebitdaDeclinePctToNext - 0.1) < 1e-9 &&
    bd.guidanceLine === 6 && bd.turnsToGuidanceLine === 1.5 && Math.abs(bd.ebitdaDeclinePctToGuidanceLine - 0.25) < 1e-9,
    JSON.stringify(bd));
  const top = RTRatios.bandDistance(7, RTRatios.SP_FINANCIAL_RISK_BANDS);
  check("7x sits in the top band with no next band (turnsToNext and ebitdaDeclinePctToNext null), and has already crossed the 6.0x guidance line (a negative distance)",
    top.currentBand.key === "highlyLeveraged" && top.nextBand === null &&
    top.turnsToNext === null && top.ebitdaDeclinePctToNext === null &&
    top.turnsToGuidanceLine === -1 && Math.abs(top.ebitdaDeclinePctToGuidanceLine - (-1 / 6)) < 1e-9);
  const below = RTRatios.bandDistance(1.0, RTRatios.SP_FINANCIAL_RISK_BANDS);
  check("1.0x sits in Minimal, well under the 4.0x threshold, so no guidance-line fields",
    below.currentBand.key === "minimal" && below.guidanceLine === null);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
