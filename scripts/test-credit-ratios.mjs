/**
 * test-credit-ratios.mjs — the credit library against figures read from
 * real filings. Exits non-zero on the first failure.
 *
 * Every input below is copied from one of three places, named beside it:
 *   BXSL 10-Q for the quarter ended 2026-06-30, accession
 *     0001736035-26-000016, main document bxsl-20260630.htm (dollars in
 *     thousands unless the line says per share);
 *   pc-x/verified-facts.md (the probes of 2026-09-10);
 *   the blueprint's §4.2 table (MAIN's dividend split, from its 10-Q note).
 * Nothing is from memory. Where a check needs a holding set the full
 * schedule would supply, the rows are the filing's own and the check says
 * what it is exercising.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../frontend/lib/credit.js");

let failed = 0;
const near = (a, b, tol) => a !== null && a !== undefined && Math.abs(a - b) <= (tol ?? 0.0005);
const pct1 = (x) => Math.round(x * 1000) / 10;   /* 0.06593 -> 6.6, the filing's precision */
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};

check("CREDIT_VERSION is the string composite.json stamps", C.CREDIT_VERSION === "1.0.0", C.CREDIT_VERSION);

/* ---------- BXSL: the inputs, each with its line in the 10-Q ---------- */
const BXSL = {
  /* Note 11 "Financial Highlights and Senior Securities": "Asset coverage ratio | 178.0 %";
     Note 7: "As of June 30, 2026 and December 31, 2025, the Company's asset coverage was 178.0% and 177.1%" */
  assetCoveragePct: 178.0,
  /* Condensed Consolidated Statements of Operations, three months ended June 30, 2026 */
  interestNonAffiliated: 298517,
  pikInterestNonAffiliated: 20501,
  interestAffiliated: 299,
  pikInterestAffiliated: 591,
  totalInvestmentIncome: 320469,
  interestExpenseQ2: 101070,
  totalExpensesBeforeTaxQ2: 142268,
  niiAfterTaxQ2: 173785,
  niiPerShareQ2: 0.75,                     /* "Net investment income per share (basic and diluted) | $ 0.75" */
  /* six months ended June 30, 2026, same statement */
  interestExpenseH1: 201239,
  niiAfterTaxH1: 352701,
  /* Condensed Consolidated Statements of Assets and Liabilities, June 30, 2026 */
  investmentsFv: 13364295,                 /* "Total investments at fair value (cost of $13,856,590 ...)" */
  investmentsCost: 13856590,
  cash: 267155,                            /* "Cash and cash equivalents (restricted cash of $83,737 ...)" */
  netAssets: 5938733,                      /* "Total net assets" */
  navPerShare: 25.53,                      /* "NET ASSET VALUE PER SHARE" */
  /* Statement of Changes in Net Assets: "Balance, March 31, 2026 ... 6,099,680"; "Balance, December 31, 2025 ... 6,245,175" */
  netAssetsMar31: 6099680,
  netAssetsDec31: 6245175,
  /* Note 7, "The Company's outstanding debt obligations were as follows", June 30, 2026 Total row:
     Outstanding Principal 7,613,729; Amount Available 2,628,200. December 31, 2025 Total row: Outstanding Principal 8,100,621 */
  debtPrincipal: 7613729,
  debtPrincipalDec31: 8100621,
  revolverAvailable: 2628200,
  /* Schedule of Investments footnote (7) table: "Total Unfunded Commitments | $ 1,415,535" */
  unfunded: 1415535,
  /* Note 9 "Distributions": declared May 7, 2026, record June 30, 2026, "0.7700" per share */
  distributionQ2: 0.77,
  /* Note 11 per-share data, six months ended June 30, 2026: NAV beginning 26.92, distributions (1.54),
     NAV end 25.53, "Total return based on NAV (3) | 1.2 %" (with distributions reinvested under the DRIP) */
  navStartH1: 26.92,
  distributionsH1: 1.54,
  totalReturnNavDisclosedH1: 0.012,
  /* Note 11 ratios, six months, annualized: "Ratio of net expenses to average net assets | 9.3 %";
     "Ratio of net investment income to average net assets | 11.5 %" */
  niiOnNavDisclosed: 0.115,
  netExpenseRatioDisclosed: 0.093,
  /* Item 2 portfolio table, June 30, 2026: yield on performing debt at amortized cost 9.2%, at fair value 9.4%;
     "Average loan-to-value (LTV) (3) | 51.9 %"; floating 99.3%; non-accrual 3.6% at amortized cost, 1.8% at
     fair value; 313 portfolio companies; yield of new investments 9.2%, on investments sold or paid down 9.3% */
  yieldAtCostDisclosed: 0.092,
  yieldAtFvDisclosed: 0.094,
  ltvDisclosed: 0.519,
  nonAccrualCostDisclosed: 0.036,
  nonAccrualFvDisclosed: 0.018,
  yieldOnNewDisclosed: 0.092,
  yieldOnExitsDisclosed: 0.093,
  /* Note 7: "weighted average all-in cost of debt ... decreased to 4.97% for the six months ended June 30, 2026" */
  allInCostOfDebtH1: 0.0497,
  /* Item 2 "Results of Operations": "PIK interest income represented 6.6% and 6.4% of total investment income"
     (three months ended June 30, 2026 and 2025) */
  pikShareOfTotalDisclosed: 0.066,
};

/* Schedule of Investments, June 30, 2026: the eight rows carrying footnote "(17) Loan was on non-accrual
   status as of June 30, 2026". Columns Par Amount, Cost, Fair Value; maturity from the Maturity Date column.
   The two Benefytt entities carry the portfolio company in parentheses, which is how Note 4 counts six issuers. */
const BXSL_NON_ACCRUAL = [
  { issuer: "WHCG Purchaser III, Inc.",                        maturity: "6/30/2030",  principal: 18715,  cost: 6354,   fv: 11977 },
  { issuer: "CFCo, LLC (Benefytt Technologies, Inc.)",         company: "Benefytt Technologies, Inc.", maturity: "9/13/2038", principal: 9566, cost: 1397, fv: 0 },
  { issuer: "Daylight Beta Parent, LLC (Benefytt Technologies, Inc.)", company: "Benefytt Technologies, Inc.", maturity: "9/12/2033", principal: 7072, cost: 5559, fv: 581 },
  { issuer: "Titan Investment Company, Inc.",                  maturity: "3/20/2027",  principal: 40743,  cost: 40356,  fv: 8047 },
  { issuer: "Medallia, Inc.",                                  maturity: "10/29/2028", principal: 392897, cost: 381006, fv: 194484 },
  { issuer: "Medallia, Inc.",                                  maturity: "10/29/2028", principal: 2305,   cost: 2232,   fv: 1141 },
  { issuer: "Paramount Global Surfaces, Inc.",                 maturity: "12/31/2028", principal: 55974,  cost: 54201,  fv: 30786 },
  { issuer: "Material Holdings, LLC",                          maturity: "8/19/2027",  principal: 6061,   cost: 5263,   fv: 0 },
].map((h) => ({ ...h, isDebt: true, thirdParty: true, accruing: false, nonAccrual: true, lien: C.LIEN.FIRST }));

/* Two accruing first-lien rows from the same schedule, for the yield and spread arithmetic:
   "MAG DS Corp. | (11) | SOFR + | 5.50% | 9.33% | 4/1/2020 | 4/1/2027 | 78,245 | 77,387 | 78,163"
   "Auctane, Inc. | (4)(10) | SOFR + | 5.75% | 9.42% | 6/1/2026 | 6/1/2033 | 281,570 | 275,571 | 277,347"
   and the fixed-rate non-accrual WHCG row above ("10.00% | 10.00% PIK", no spread). */
const BXSL_ACCRUING = [
  { issuer: "MAG DS Corp.", maturity: "4/1/2027", principal: 78245, rate: 0.0933, spread: 0.0550, cost: 77387, fv: 78163 },
  { issuer: "Auctane, Inc.", maturity: "6/1/2033", principal: 281570, rate: 0.0942, spread: 0.0575, cost: 275571, fv: 277347 },
].map((h) => ({ ...h, isDebt: true, thirdParty: true, accruing: true, lien: C.LIEN.FIRST }));

/* ---------- statutory cushion (§4.2 "Statutory cushion") ---------- */
{
  const coverage = BXSL.assetCoveragePct / 100;
  const cushion = C.assetCoverageCushion(coverage);
  const markdown = C.breakingMarkdown(coverage);
  check("BXSL cushion 1.78 ÷ 1.5 − 1 = 18.7%", near(cushion, 0.1867, 0.0005), pct1(cushion) + "%");
  check("BXSL breaking markdown 1 − 1.5 ÷ 1.78 = 15.7%", near(markdown, 0.1573, 0.0005), pct1(markdown) + "%");
  check("the percent form of the ratio gives the same cushion", near(C.assetCoverageCushion(BXSL.assetCoveragePct), cushion, 1e-9));
  check("a 200% floor for a filer that never elected", near(C.assetCoverageCushion(coverage, 2.0), 1.78 / 2 - 1, 1e-9));
  check("the blueprint's 170% / 165% / 160% markdowns: 11.8%, 9.1%, 6.3%", pct1(C.breakingMarkdown(1.70)) === 11.8 &&
    pct1(C.breakingMarkdown(1.65)) === 9.1 && pct1(C.breakingMarkdown(1.60)) === 6.3);
  check("a ratio already below the floor reads negative, not zero", C.breakingMarkdown(1.40) < 0);
  check("a missing coverage is null", C.assetCoverageCushion(null) === null && C.breakingMarkdown(undefined) === null);
}

/* ---------- PIK share, both ratios (§3.3) ---------- */
{
  const pik = BXSL.pikInterestNonAffiliated + BXSL.pikInterestAffiliated;
  const totalInterest = BXSL.interestNonAffiliated + BXSL.interestAffiliated + pik;
  const ofInterest = C.pikShare(pik, totalInterest);
  check("BXSL PIK share of interest 21,092 ÷ 319,908 = 6.6%", pct1(ofInterest) === 6.6, ofInterest.toFixed(5));
  const ofTotal = C.pikShareOfTotal(pik, BXSL.totalInvestmentIncome);
  check("BXSL PIK share of total investment income matches the stated 6.6%", pct1(ofTotal) === pct1(BXSL.pikShareOfTotalDisclosed), ofTotal.toFixed(5));
  const nonAffiliatedOnly = C.pikShare(BXSL.pikInterestNonAffiliated, BXSL.interestNonAffiliated + BXSL.pikInterestNonAffiliated);
  check("non-affiliated only is the 6.4% figure, so every class is summed", pct1(nonAffiliatedOnly) === 6.4, nonAffiliatedOnly.toFixed(5));
  check("PIK with no total is null, never zero", C.pikShare(pik, null) === null && C.pikShareOfTotal(null, 1) === null);
}

/* ---------- non-accruals at cost and at fair value (§3.3) ---------- */
{
  const t = C.nonAccrualTotals(BXSL_NON_ACCRUAL);
  check("eight loans across six issuers, as Note 4 states", t.loans === 8 && t.issuers === 6, t.loans + " loans, " + t.issuers + " issuers");
  const atCost = C.nonAccrualRate(t.cost, BXSL.investmentsCost);
  const atFv = C.nonAccrualRateFv(t.fv, BXSL.investmentsFv);
  check("BXSL non-accruals 496,368 ÷ 13,856,590 = 3.6% at cost", pct1(atCost) === pct1(BXSL.nonAccrualCostDisclosed), atCost.toFixed(5));
  check("BXSL non-accruals 247,016 ÷ 13,364,295 = 1.8% at fair value", pct1(atFv) === pct1(BXSL.nonAccrualFvDisclosed), atFv.toFixed(5));
  check("the fair-value rate is below the cost rate: marked before they stopped paying", atFv < atCost);
  check("no non-accrual holdings gives null numerators", C.nonAccrualTotals([]).cost === null && C.nonAccrualRate(null, 1) === null);
}

/* ---------- disclosed-only fields pass through unchanged (§4.2, §11) ---------- */
{
  const d = C.disclosedOnly({
    ltv: BXSL.ltvDisclosed,
    yieldOnNewInvestments: BXSL.yieldOnNewDisclosed,
    yieldOnExits: BXSL.yieldOnExitsDisclosed,
    borrowerEbitda: 221000,   /* the 10-Q's weighted-average EBITDA of $221 million: not a field the site carries */
  }, { form: "10-Q", accession: "0001736035-26-000016", sentence: "Average loan-to-value (LTV) (3) | 51.9 %" });
  check("LTV 51.9% is carried exactly as stated", d.ltv === 0.519, String(d.ltv));
  check("fields the filing does not state stay null", d.borrowerNetLeverage === null && d.borrowerInterestCoverage === null && d.riskRatingMix === null);
  check("a key outside the disclosed-only list is dropped", !("borrowerEbitda" in d));
  check("the provenance rides with the values", d.source === "disclosed" && d.provenance.accession === "0001736035-26-000016");
  check("nothing in the library computes a borrower's LTV, leverage or coverage",
    !Object.keys(C).some((k) => /ltv|loanToValue|borrowerLeverage|interestCoverage|ebitda/i.test(k)));
  check("DISCLOSED_ONLY names the seven pass-through fields", C.DISCLOSED_ONLY.length === 7 && C.DISCLOSED_ONLY.includes("ltv"));
}

/* ---------- dividend coverage (§4.2) ---------- */
{
  /* MAIN Q2 2026: NII per share $0.97 vs regular $0.78 + supplemental $0.30 (blueprint-v2 §4.2, from MAIN's 10-Q dividend note) */
  const main = C.dividendCoverage(0.97, 0.78, 0.30, null);
  check("MAIN regular coverage 0.97 ÷ 0.78 = 1.24×", near(main.regular, 1.24, 0.005), main.regular.toFixed(3));
  check("MAIN total coverage 0.97 ÷ 1.08 = 0.90×", near(main.total, 0.90, 0.005), main.total.toFixed(3));
  /* BXSL Q2 2026: NII per share $0.75 vs the $0.77 declared May 7, 2026 */
  const bxsl = C.dividendCoverage(BXSL.niiPerShareQ2, BXSL.distributionQ2);
  check("BXSL 0.75 ÷ 0.77 = 0.97× on both bases with no supplemental", near(bxsl.regular, 0.974, 0.001) && bxsl.regular === bxsl.total, bxsl.regular.toFixed(3));
  const none = C.dividendCoverage(0.97, null, 0.30);
  check("no regular dividend gives null on both, never a ratio to the supplemental", none.regular === null && none.total === null);
}

/* ---------- price / NAV (§4.2) ---------- */
{
  /* ARCC: price 19.63 (verified-facts §E, Finnhub quote 2026-09-10) ÷ NAV 19.35 (verified-facts §D, frames CY2026Q2I) */
  const p = C.priceToNav(19.63, 19.35);
  check("ARCC price / NAV 19.63 ÷ 19.35 = 1.01×", near(p, 1.01, 0.005), p.toFixed(4));
  check("a missing NAV is null", C.priceToNav(19.63, null) === null && C.priceToNav(19.63, 0) === null);
}

/* ---------- the lien map (§4.2) ---------- */
{
  const rows = [
    ["One stop", undefined, C.LIEN.FIRST_UNITRANCHE],
    ["First lien senior secured – last-out", undefined, C.LIEN.FIRST_UNITRANCHE],
    ["Unitranche", undefined, C.LIEN.FIRST_UNITRANCHE],
    ["Secured Debt", C.FILER_LIEN_OVERRIDES.MAIN, C.LIEN.FIRST],
    ["Secured Debt", undefined, null],
    ["First Lien Debt", undefined, C.LIEN.FIRST],
    ["First lien senior secured loans", undefined, C.LIEN.FIRST],
    ["Senior secured", undefined, C.LIEN.FIRST],
    ["Second Lien Debt", undefined, C.LIEN.SECOND],
    ["Second lien senior secured loans", undefined, C.LIEN.SECOND],
    ["Unsecured Debt", undefined, C.LIEN.UNSECURED],
    ["Senior subordinated debt", undefined, C.LIEN.UNSECURED],
    ["Collateralized loan obligation", undefined, C.LIEN.VEHICLES],
    ["CLO equity", undefined, C.LIEN.VEHICLES],
    ["Investment funds and vehicles", undefined, C.LIEN.VEHICLES],
    ["Preferred equity", undefined, C.LIEN.EQUITY],
    ["Common Stock", undefined, C.LIEN.EQUITY],
    ["Warrants", undefined, C.LIEN.EQUITY],
    ["", undefined, null],
    [null, undefined, null],
  ];
  for (const [label, overrides, want] of rows) {
    const got = C.lienClass(label, overrides);
    check("lien " + JSON.stringify(label) + (overrides ? " (MAIN override)" : "") + " → " + want, got === want, "got " + got);
  }
  check("both first-lien classes count toward the first-lien share", C.isFirstLien(C.LIEN.FIRST) && C.isFirstLien(C.LIEN.FIRST_UNITRANCHE) && !C.isFirstLien(C.LIEN.SECOND));
}

/* ---------- book, leverage and earnings from the balance sheet ---------- */
{
  const m = C.mark(BXSL.investmentsFv, BXSL.investmentsCost);
  check("BXSL mark 13,364,295 ÷ 13,856,590 = 0.964", near(m, 0.964, 0.0005), m.toFixed(4));
  const de = C.debtToEquity(BXSL.debtPrincipal, BXSL.netAssets);
  const nde = C.netDebtToEquity(BXSL.debtPrincipal, BXSL.cash, BXSL.netAssets);
  check("BXSL debt-to-equity 7,613,729 ÷ 5,938,733 = 1.28×", near(de, 1.282, 0.001), de.toFixed(4));
  check("BXSL net of cash 1.24×", near(nde, 1.237, 0.001), nde.toFixed(4));
  const avgNa = C.avg(BXSL.netAssets, BXSL.netAssetsMar31);
  const ron = C.niiReturnOnNav(BXSL.niiAfterTaxQ2, avgNa);
  check("BXSL NII return on NAV 4 × 173,785 ÷ 6,019,207 = 11.5%, the ratio Note 11 states", near(ron, BXSL.niiOnNavDisclosed, 0.0015), (ron * 100).toFixed(2) + "%");
  const oer = C.operatingExpenseRatio(BXSL.totalExpensesBeforeTaxQ2, BXSL.interestExpenseQ2, avgNa);
  const interestRatioH1 = C.costOfDebt(BXSL.interestExpenseH1, C.avg(BXSL.netAssets, BXSL.netAssetsDec31), 2);
  check("BXSL operating expense ratio 4 × (142,268 − 101,070) ÷ 6,019,207 = 2.7%", near(oer, 0.0274, 0.0005), (oer * 100).toFixed(2) + "%");
  check("which is Note 11's 9.3% net expense ratio less the interest ratio", near(oer, BXSL.netExpenseRatioDisclosed - interestRatioH1, 0.002),
    ((BXSL.netExpenseRatioDisclosed - interestRatioH1) * 100).toFixed(2) + "%");
  const cod = C.costOfDebt(BXSL.interestExpenseH1, C.avg(BXSL.debtPrincipal, BXSL.debtPrincipalDec31), 2);
  check("BXSL cost of debt 2 × 201,239 ÷ 7,857,175 = 5.1%, within 0.3 points of the stated 4.97% all-in", near(cod, BXSL.allInCostOfDebtH1, 0.003), (cod * 100).toFixed(2) + "%");
  const nim = C.netInterestMargin(BXSL.yieldAtCostDisclosed, BXSL.allInCostOfDebtH1);
  check("BXSL net interest margin 9.2% − 4.97% = 4.23 points", near(nim, 0.0423, 0.0001), (nim * 100).toFixed(2));
  const lc = C.liquidityCover(BXSL.cash, BXSL.revolverAvailable, BXSL.unfunded);
  check("BXSL liquidity cover (267,155 + 2,628,200) ÷ 1,415,535 = 2.0×", near(lc, 2.045, 0.001), lc.toFixed(3));
  const tr = C.totalReturnNav(BXSL.navPerShare, BXSL.navStartH1, BXSL.distributionsH1);
  check("BXSL NAV return fallback (25.53 − 26.92 + 1.54) ÷ 26.92 = 0.6%", near(tr, 0.0056, 0.0001), (tr * 100).toFixed(2) + "%");
  check("which sits under the stated 1.2% with distributions reinvested, so the fallback is labelled", tr < BXSL.totalReturnNavDisclosedH1);
  check("a quarter with no average balance is null", C.niiReturnOnNav(BXSL.niiAfterTaxQ2, null) === null && C.costOfDebt(1, 0) === null);
}

/* ---------- holdings arithmetic on the filing's own rows ---------- */
{
  const set = BXSL_ACCRUING.concat(BXSL_NON_ACCRUAL);
  const yc = C.weightedAverageYield(set, "cost");
  const yf = C.weightedAverageYield(set, "fv");
  /* (78,245 × 9.33% + 281,570 × 9.42%) ÷ (77,387 + 275,571) — the non-accrual rows are excluded from both sides */
  check("yield at cost over accruing rows only: 33,824 ÷ 352,958 = 9.58%", near(yc, 0.09583, 0.0001), (yc * 100).toFixed(3) + "%");
  check("yield at fair value 33,824 ÷ 355,510 = 9.51%", near(yf, 0.09514, 0.0001), (yf * 100).toFixed(3) + "%");
  check("the two rows sit near the 9.2% / 9.4% the filing states for the whole book", Math.abs(yc - BXSL.yieldAtCostDisclosed) < 0.01 && Math.abs(yf - BXSL.yieldAtFvDisclosed) < 0.01);
  const sp = C.spreadCostWeighted(set);
  check("cost-weighted spread (77,387 × 5.50% + 275,571 × 5.75%) ÷ 352,958 = 5.70%", near(sp, 0.05695, 0.0001), (sp * 10000).toFixed(1) + " bps");
  const fl = C.floatingShare(BXSL_ACCRUING.concat([BXSL_NON_ACCRUAL[0]]));
  check("floating share: the fixed 10% PIK loan is 6,354 of 359,312 → 98.2% floating", near(fl, 0.98232, 0.0001), (fl * 100).toFixed(2) + "%");
  const excluded = C.weightedAverageYield([{ ...BXSL_ACCRUING[0], isDebt: false }, { ...BXSL_ACCRUING[1], thirdParty: false }], "cost");
  check("equity and affiliated holdings never enter the yield", excluded === null);
  check("an empty book is null", C.weightedAverageYield([], "cost") === null && C.spreadCostWeighted(null) === null && C.floatingShare([]) === null);
}

/* ---------- top-10 concentration ---------- */
{
  /* twelve issuers of the non-accrual and accruing rows above plus two more Medallia-sized synthetic issuers,
     labelled synthetic: the ten largest ÷ the tagged portfolio fair value */
  const synthetic = [
    { issuer: "synthetic A", fv: 200000, isDebt: true, thirdParty: true },
    { issuer: "synthetic B", fv: 150000, isDebt: true, thirdParty: true },
    { issuer: "affiliated vehicle", fv: 900000, isDebt: false, thirdParty: false },
  ];
  const set = BXSL_ACCRUING.concat(BXSL_NON_ACCRUAL, synthetic);
  const c = C.top10Concentration(set, BXSL.investmentsFv);
  /* issuers by FV: Auctane 277,347; synthetic A 200,000; Medallia 195,625; synthetic B 150,000; MAG DS 78,163;
     Paramount 30,786; WHCG 11,977; Titan 8,047; Daylight Beta 581; CFCo 0 = 952,526; Material Holdings (0) is eleventh */
  check("ten largest third-party issuers 952,526 ÷ 13,364,295 = 7.1%", near(c, 0.07127, 0.0001), (c * 100).toFixed(3) + "%");
  check("the affiliated vehicle is left out even though it is the largest", c < 0.10);
  check("no portfolio total is null", C.top10Concentration(set, null) === null);
}

/* ---------- maturity wall (§4.2, LCD's buckets) ---------- */
{
  const wall = C.maturityBuckets(BXSL_NON_ACCRUAL.concat([
    { issuer: "an equity position", isDebt: false, cost: 50000, maturity: "2027-01-01" },
    { issuer: "a CLO tranche", isDebt: true, thirdParty: true, lien: C.LIEN.VEHICLES, rawLabel: "CLO", cost: 40000, maturity: "2030-01-01" },
    { issuer: "a revolver", isDebt: true, thirdParty: true, lien: C.LIEN.FIRST, cost: 1000, unfunded: 3373, maturity: "6/13/2032" },
  ]));
  const by = Object.fromEntries(wall.buckets.map((b) => [b.label, b.cost]));
  check("buckets are LCD's seven", wall.buckets.map((b) => b.label).join(",") === "2026,2027,2028,2029,2030,2031-2033,later");
  check("2027: Titan 40,356 + Material 5,263", by["2027"] === 45619, String(by["2027"]));
  check("2028: Medallia 381,006 + 2,232 + Paramount 54,201", by["2028"] === 437439, String(by["2028"]));
  check("2030: WHCG 6,354; 2031-2033: Daylight Beta 5,559 + the revolver 1,000; later: CFCo 1,397",
    by["2030"] === 6354 && by["2031-2033"] === 6559 && by["later"] === 1397, [by["2030"], by["2031-2033"], by["later"]].join("/"));
  check("2026 and 2029 are zero, not missing", by["2026"] === 0 && by["2029"] === 0);
  check("the wall sums to the third-party debt cost it was built from", wall.total === 496368 + 1000, String(wall.total));
  check("equity and the CLO tranche are excluded", wall.total < 496368 + 1000 + 50000);
  check("the revolver's unfunded balance is reported beside the wall", wall.unfunded === 3373);
  check("shares sum to one", near(wall.buckets.reduce((s, b) => s + b.share, 0), 1, 1e-9));
  check("a book with no dated debt is null", C.maturityBuckets([{ isDebt: false, cost: 1 }]) === null);
}

/* ---------- the null convention across the board ---------- */
{
  const fns = ["mark", "priceToNav", "debtToEquity", "pikShare", "pikShareOfTotal", "nonAccrualRate", "nonAccrualRateFv"];
  check("a missing input or a zero denominator is null in every two-argument ratio", fns.every((f) => C[f](null, 1) === null && C[f](1, null) === null && C[f](1, 0) === null));
  check("a margin with a missing term is null; a zero cost of debt is a real subtraction", C.netInterestMargin(0.092, null) === null && C.netInterestMargin(0.092, 0) === 0.092);
  check("netDebtToEquity and liquidityCover refuse a missing denominator", C.netDebtToEquity(1, 1, null) === null && C.liquidityCover(1, 1, null) === null);
  check("liquidityCover sums the cash and revolver it has", C.liquidityCover(null, 200, 100) === 2);
}

console.log(failed ? `\n${failed} failure(s)` : "\nall credit pins hold");
process.exit(failed ? 1 : 0);
