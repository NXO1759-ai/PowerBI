/**
 * test-feed-durations.mjs — the duration-selection fix, offline.
 *
 * The weekly pull kept the LONGEST span per (fiscal year, period) and
 * then subtracted the prior quarter. Amazon tags three spans on every
 * cash-flow line of a 10-Q — the quarter, the year to date and the
 * trailing twelve months — so its overview served the difference of two
 * trailing-twelve-month figures as the quarter, and the strategy panel
 * carried a "2026" fiscal year that was a trailing window to June. The
 * period label came from the dei cover-page row, dated weeks after the
 * quarter closed. Every figure below is read off the filing named beside
 * it; none is from memory.
 *
 * Fixtures (scripts/fixtures/hs/, companyfacts slices cut 2026-09-11):
 *   AMZN (CIK 1018724) amzn-q2-2026-regression.json — the three tags the
 *     blueprint names, periods ending 2025-01-01 onward, plus the dei
 *     cover rows. 10-Q for the quarter to 2026-06-30, filed 2026-07-31,
 *     accession 0001018724-26-000026: operating cash flow 45,387,000,000
 *     for the quarter, 71,419,000,000 for the half year and
 *     161,403,000,000 for the twelve months; purchases of property and
 *     equipment 54,208,000,000, 98,411,000,000 and 173,028,000,000; net
 *     sales 200,606,000,000. 10-Q for the quarter to 2026-03-31, filed
 *     2026-04-30, accession 0001018724-26-000014: operating cash flow
 *     26,032,000,000 and purchases 44,203,000,000 for the quarter. 10-Q
 *     for the quarter to 2025-06-30, filed 2025-08-01, accession
 *     0001018724-25-000086: operating cash flow 32,515,000,000 for the
 *     quarter. 10-K for 2025, filed 2026-02-06, accession
 *     0001018724-26-000004 (the year the fourth quarter is derived from).
 *     The cover row of the July 10-Q is dated 2026-07-22.
 *   MSFT (CIK 789019) msft-companyfacts-slice.json, from 2023-06-30.
 *     10-K for the year to 2026-06-30, filed 2026-07-29, accession
 *     0001193125-26-323660: additions to property and equipment
 *     115,948,000,000. 10-Qs for the quarters to 2025-09-30 (filed
 *     2025-10-29, 0001193125-25-256321), 2025-12-31 (filed 2026-01-28,
 *     0001193125-26-027207) and 2026-03-31 (filed 2026-04-29,
 *     0001193125-26-191507): 19,394,000,000, 29,876,000,000 and
 *     30,876,000,000 for the quarters, 80,146,000,000 for the nine
 *     months. The cover row of the April 10-Q is dated 2026-04-23.
 *   ORCL (CIK 1341439) orcl-companyfacts-slice.json, from 2023-05-31,
 *     with RestructuringAndRelatedCostExpectedCost added: the one fact
 *     dated 2199-12-31 (1,097,000,000, 10-Q/A filed 2010-09-29,
 *     accession 0001193125-10-219697). The cover row of the 10-Q for the
 *     quarter to 2026-02-28 (filed 2026-03-11, 0001193125-26-101045) is
 *     dated 2026-03-05; the slice also carries the 10-Q for the quarter
 *     to 2026-08-31 (filed 2026-09-11, 0001193125-26-389274, cover row
 *     dated 2026-09-07), which EDGAR files as fy=2026 fp=Q1, the slot of
 *     the quarter to 2025-08-31.
 *   AXP (CIK 4962) axp-companyfacts-slice.json, 2007-12-31 to 2010-12-31,
 *     cut to the anchor tags and operating cash flow.
 *     The 10-Q for the quarter to 2010-06-30, filed 2010-08-05, accession
 *     0000950123-10-072749, restates 2007 operating cash flow to
 *     8,500,000,000 (the 10-K for 2009, filed 2010-02-26, accession
 *     0001193125-10-041232, had 8,011,000,000) — a full-year span in a
 *     10-Q that ends at the fiscal year end and must survive the rule
 *     that drops Amazon's.
 *   ACN (CIK 1467373) acn-companyfacts-slice.json, from 2023-08-31, cut
 *     to the anchor tags and the D&A tags. 10-K for fiscal 2023, filed
 *     2023-10-12, accession 0001467373-23-000324: depreciation,
 *     amortization and other 1,412,073,000; depreciation alone
 *     620,659,000. 10-K for fiscal 2025, filed 2025-10-10, accession
 *     0001467373-25-000217: carries depreciation alone for fiscal 2023,
 *     2024 (547,935,000) and 2025 (622,493,000), amortization of
 *     intangibles 745,892,000 for fiscal 2025, and no combined figure.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { factsFromCompanyFacts, normalizeConcept, buildPayload } from "./lib/sec-pull.mjs";
import { buildStatements, readDuration } from "./lib/statements.mjs";
import { panelYears } from "./lib/panel-row.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, "fixtures/hs", f), "utf8"));
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};
const DAY_MS = 86400000;
const span = (r) => (r.periodStart ? Math.round((new Date(r.periodEnd) - new Date(r.periodStart)) / DAY_MS) : null);
const TTM_CAPEX = 173028000000, TTM_CFO = 161403000000;

/* ---------- Amazon, the overview pull ---------- */
console.log("Amazon Q2 2026 — the overview pull");
const amzn = load("amzn-q2-2026-regression.json");
const amznFacts = factsFromCompanyFacts(amzn);
check("the fixture carries the trailing-twelve-month rows that caused the bug",
  amzn.facts["us-gaap"].PaymentsToAcquireProductiveAssets.units.USD.some((r) => r.val === TTM_CAPEX && r.start === "2025-07-01"));
check("no normalized fact carries a trailing-twelve-month value",
  !amznFacts.some((f) => f.value === TTM_CAPEX || f.value === TTM_CFO));
const amznRow = (concept, fp) => amznFacts.find((f) => f.concept === concept && f.fiscal_year === 2026 && f.fiscal_period === fp);
check("the Q2 slot holds the half-year span, 71,419,000,000 to 2026-06-30",
  amznRow("NetCashProvidedByUsedInOperatingActivities", "Q2").value === 71419000000 &&
  amznRow("NetCashProvidedByUsedInOperatingActivities", "Q2").period_end === "2026-06-30",
  JSON.stringify(amznRow("NetCashProvidedByUsedInOperatingActivities", "Q2")));
check("the Q1 slot holds the quarter, 26,032,000,000 to 2026-03-31, not the trailing window",
  amznRow("NetCashProvidedByUsedInOperatingActivities", "Q1").value === 26032000000);
const amznPayload = buildPayload({ ticker: "AMZN", cik: 1018724, name: "AMAZON COM INC" }, amznFacts);
check("operating cash flow for the quarter is 45,387,000,000",
  amznPayload.fundamentals.cashFlow.cfOps.q === 45387000000, String(amznPayload.fundamentals.cashFlow.cfOps.q));
check("and 32,515,000,000 a year earlier",
  amznPayload.fundamentals.cashFlow.cfOps.ly === 32515000000, String(amznPayload.fundamentals.cashFlow.cfOps.ly));
check("revenue for the quarter is 200,606,000,000",
  amznPayload.fundamentals.incomeStatement.revenue.q === 200606000000);
check("the period ends 2026-06-30, not on the cover date 2026-07-22",
  amznPayload.periodEnd === "2026-06-30", amznPayload.periodEnd);
check("and is labeled 3 mo ended Jun 30, 2026",
  amznPayload.period.isLabel === "3 mo ended Jun 30, 2026", amznPayload.period.isLabel);
check("the cover row is in the feed, so the label test is real",
  amznFacts.some((f) => f.concept === "EntityCommonStockSharesOutstanding" && f.period_end === "2026-07-22"));
check("no trailing-twelve-month figure appears anywhere in the payload",
  !JSON.stringify(amznPayload).includes(String(TTM_CAPEX)) && !JSON.stringify(amznPayload).includes(String(TTM_CFO)));

/* ---------- Amazon, the statement series and the panel ---------- */
console.log("Amazon Q2 2026 — statements and the panel");
const amznS = buildStatements(amzn.facts["us-gaap"]);
check("every annual period ends in December",
  amznS.annual.length > 0 && amznS.annual.every((p) => p.periodEnd.slice(5, 7) === "12"),
  amznS.annual.map((p) => p.periodEnd).join(","));
check("no annual period is a trailing window to a quarter end",
  !amznS.annual.some((p) => p.periodEnd === "2026-06-30" || p.periodEnd === "2026-03-31" || p.periodEnd === "2025-09-30"));
const q2 = amznS.quarterly.find((p) => p.periodEnd === "2026-06-30");
check("the quarter to 2026-06-30 carries capex 54,208,000,000 and operating cash flow 45,387,000,000",
  q2 && q2.cashFlow.capex === 54208000000 && q2.cashFlow.cfOps === 45387000000 && span(q2) < 100,
  q2 && JSON.stringify([q2.cashFlow.capex, q2.cashFlow.cfOps, span(q2)]));
check("no quarterly or annual slot holds the trailing figure 173,028,000,000",
  !amznS.quarterly.concat(amznS.annual).some((p) => Object.values(p.cashFlow).includes(TTM_CAPEX) || Object.values(p.cashFlow).includes(TTM_CFO)));
check("every quarter spans under 100 days",
  amznS.quarterly.every((p) => span(p) === null || span(p) <= 100));
const ltm = amznS.ltm.find((p) => p.periodEnd === "2026-06-30");
check("the four tagged quarters sum to Amazon's own trailing figure, 173,028,000,000 — the check value, computed, never read",
  ltm && ltm.cashFlow.capex === TTM_CAPEX && ltm.cashFlow.cfOps === TTM_CFO,
  ltm && JSON.stringify([ltm.cashFlow.capex, ltm.cashFlow.cfOps]));
const amznPanel = panelYears(buildStatements(amzn.facts["us-gaap"], { annualLimit: 25, quarterLimit: 1 }));
check("the panel has a 2025 row and no 2026 row",
  amznPanel["2025"] !== undefined && amznPanel["2026"] === undefined, Object.keys(amznPanel).join(","));

/* ---------- Microsoft, the fourth quarter ---------- */
console.log("Microsoft fiscal 2026 — the fourth quarter");
const msft = load("msft-companyfacts-slice.json");
const msftS = buildStatements(msft.facts["us-gaap"]);
const fy26 = msftS.annual.find((p) => p.periodEnd === "2026-06-30");
check("fiscal 2026 capex is 115,948,000,000", fy26 && fy26.cashFlow.capex === 115948000000, fy26 && String(fy26.cashFlow.capex));
check("the fiscal year is named FY2026 by the filer and aligned to 2025",
  fy26 && fy26.filerFiscalYear === 2026 && fy26.fiscalYear === 2025 && fy26.label === "FY2026");
const mq = (end) => msftS.quarterly.find((p) => p.periodEnd === end);
check("the three tagged quarters are 19,394,000,000, 29,876,000,000 and 30,876,000,000",
  mq("2025-09-30").cashFlow.capex === 19394000000 && mq("2025-12-31").cashFlow.capex === 29876000000 && mq("2026-03-31").cashFlow.capex === 30876000000);
check("and sum to the nine-month figure 80,146,000,000",
  mq("2025-09-30").cashFlow.capex + mq("2025-12-31").cashFlow.capex + mq("2026-03-31").cashFlow.capex === 80146000000);
const q4 = mq("2026-06-30");
check("the fourth quarter is derived as 115,948,000,000 less 80,146,000,000 = 35,802,000,000",
  q4 && q4.derived === true && q4.fiscalPeriod === "Q4" && q4.cashFlow.capex === 35802000000, q4 && String(q4.cashFlow.capex));
check("and labeled Q4 FY2026", q4 && q4.label === "Q4 FY2026", q4 && q4.label);
const msftPayload = buildPayload({ ticker: "MSFT", cik: 789019, name: "MICROSOFT CORPORATION" }, factsFromCompanyFacts(msft));
check("the overview period is labeled 3 mo ended Mar 31, 2026, not Apr 23, 2026",
  msftPayload.period.isLabel === "3 mo ended Mar 31, 2026" && msftPayload.periodEnd === "2026-03-31", msftPayload.period.isLabel);
check("the cover row dated 2026-04-23 is in the feed",
  factsFromCompanyFacts(msft).some((f) => f.concept === "EntityCommonStockSharesOutstanding" && f.period_end === "2026-04-23"));

/* ---------- Oracle, the placeholder date and the label ---------- */
console.log("Oracle — the 2199-12-31 placeholder and the label");
const orcl = load("orcl-companyfacts-slice.json");
const bucket = orcl.facts["us-gaap"];
check("the fixture carries the fact dated 2199-12-31",
  bucket.RestructuringAndRelatedCostExpectedCost.units.USD.some((r) => r.end === "2199-12-31" && r.val === 1097000000));
const placeholder = readDuration(bucket, ["RestructuringAndRelatedCostExpectedCost"], { spanTest: () => true });
check("the statement reader drops it", !placeholder.has("2199-12-31"));
check("and the pull's normalizer drops it",
  !normalizeConcept(bucket.RestructuringAndRelatedCostExpectedCost, "RestructuringAndRelatedCostExpectedCost").some((f) => f.period_end > "2100-01-01"));
const today = new Date().toISOString().slice(0, 10);
const orclFacts = factsFromCompanyFacts(orcl);
check("no normalized Oracle fact ends after today", orclFacts.every((f) => f.period_end <= today));
const orclS = buildStatements(bucket);
check("no Oracle period ends after today",
  orclS.annual.concat(orclS.quarterly).every((p) => p.periodEnd <= today));
const orclPayload = buildPayload({ ticker: "ORCL", cik: 1341439, name: "Oracle Corporation" }, orclFacts);
check("the overview period is labeled by the shown quarter's own end, 3 mo ended Feb 28, 2026, not the cover date Sep 7, 2026",
  orclPayload.period.isLabel === "3 mo ended Feb 28, 2026" && orclPayload.periodEnd === "2026-02-28", orclPayload.period.isLabel);
check("the cover rows dated 2026-03-05 and 2026-09-07 are in the feed",
  orclFacts.some((f) => f.concept === "EntityCommonStockSharesOutstanding" && f.period_end === "2026-03-05") &&
  orclFacts.some((f) => f.concept === "EntityCommonStockSharesOutstanding" && f.period_end === "2026-09-07"));
/* The largest (fy, fp) slot, Q3 FY2026, is shown on purpose: the quarter to
   2026-08-31 sits in the fy=2026 fp=Q1 slot, whose year-ago pair is the
   quarter to 2024-08-31, so showing it would serve a two-year-old
   comparative under a one-year label (sec-pull.mjs latestQuarter). */
check("the shown quarter is Q3 FY2026 (to 2026-02-28, cfOps 7,151,000,000) against Q3 FY2025 (to 2025-02-28, cfOps 5,933,000,000): a true year-over-year pair",
  orclPayload.period.fiscalPeriod === "Q3" && orclPayload.fundamentals.cashFlow.cfOps.q === 7151000000 && orclPayload.fundamentals.cashFlow.cfOps.ly === 5933000000 &&
  orclPayload.period.compareLabel === "Q3 2025", String(orclPayload.fundamentals.cashFlow.cfOps.q));

/* ---------- American Express, a recast year in a 10-Q ---------- */
console.log("American Express — a full-year comparative restated in a 10-Q");
const axp = load("axp-companyfacts-slice.json");
const axpS = buildStatements(axp.facts["us-gaap"]);
const y2007 = axpS.annual.find((p) => p.periodEnd === "2007-12-31");
check("2007 operating cash flow keeps the 10-Q's restated 8,500,000,000",
  y2007 && y2007.cashFlow.cfOps === 8500000000, y2007 && String(y2007.cashFlow.cfOps));
check("the fiscal year end is read as December", axpS.fiscalYearEndMonth === 12);

/* ---------- Accenture, the fill-only rule ---------- */
console.log("Accenture — a widened ladder fills gaps and re-decides nothing");
const acn = load("acn-companyfacts-slice.json");
const acnS = buildStatements(acn.facts["us-gaap"]);
const acnY = (end) => acnS.annual.find((p) => p.periodEnd === end);
check("fiscal 2023 D&A stays 1,412,073,000 although a later 10-K restates only depreciation, 620,659,000",
  acnY("2023-08-31").cashFlow.depreciationAmortization === 1412073000, String(acnY("2023-08-31").cashFlow.depreciationAmortization));
check("fiscal 2024 stays 1,443,225,000", acnY("2024-08-31").cashFlow.depreciationAmortization === 1443225000);
check("fiscal 2025, which the combined tag never reported, fills with depreciation alone, 622,493,000, and says so (the composite fill was removed: the site serves Depreciation where a filer tags no combined line)",
  acnY("2025-08-31").cashFlow.depreciationAmortization === 622493000 &&
  acnY("2025-08-31").tags["cashFlow.depreciationAmortization"] === "Depreciation",
  String(acnY("2025-08-31").cashFlow.depreciationAmortization));
check("the combined years keep their own tag", acnY("2024-08-31").tags["cashFlow.depreciationAmortization"] === "DepreciationDepletionAndAmortization");

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
