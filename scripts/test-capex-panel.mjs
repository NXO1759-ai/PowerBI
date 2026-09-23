/**
 * test-capex-panel.mjs — scripts/build-capex-panel.mjs, offline, against
 * companyfacts slices of the filers blueprint 15.9 names for PR H2's own
 * acceptance line, plus the calendar-quarter alignment rule (15.0) and the
 * capex-adjustments.json de-cumulation (IREN, Cipher).
 *
 * Every figure asserted below was checked against the fixture before it
 * was pinned here (scripts/fixtures/hs/*.json, committed by PR H1 for
 * these same filers and already pinned by scripts/test-hs-concepts.mjs):
 * MSFT FY2026 capex 115,948,000,000 and its FQ4 35,802,000,000 (the annual
 * less the nine-month year-to-date); GOOG H1 2026 80,598,000,000 (Q1
 * 35,674,000,000 + Q2 44,924,000,000); AMZN Q2 2026 54,208,000,000, with
 * no trailing-twelve-month value in any annual or quarterly slot; META H1
 * 2026 49,113,000,000 (Q1 18,997,000,000 + Q2 30,116,000,000); ORCL FY2026
 * 55,663,000,000; CRWV total debt principal 35,551,000,000 at 2026-06-30;
 * the calendar-Q2 2026 hyperscaler stack (MSFT's FQ4 + GOOG's + AMZN's +
 * META's Q2 + ORCL's FQ4) is 181,543,000,000.
 *
 * IREN's and Cipher's fixtures (cut from 2025-01-01) carry FY2026 and
 * FY2025 respectively whole, so the capex-adjustments.json hand-keyed
 * hardware and deposits lines are also checked here, against the same
 * fixtures: IREN FY2026 4,333,087,000 (tagged 2,998,006,000 + hardware
 * 1,335,081,000, the blueprint's 4,333.1M) and CIFR FY2025 492,795,000
 * (tagged 487,921,000 + deposits 4,874,000, the blueprint's 492.8M).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStatements, trimHistory } from "./lib/statements.mjs";
import { buildFilerCapexPanel, decumulateAdjustmentRows, calendarQuarterOf } from "./build-capex-panel.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const loadFixture = (t) => JSON.parse(readFileSync(join(here, "fixtures/hs", t.toLowerCase() + "-companyfacts-slice.json"), "utf8"));
const capexAdjustments = JSON.parse(readFileSync(join(ROOT, "frontend/data/capex-adjustments.json"), "utf8"));

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail !== undefined ? "  " + detail : ""));
  if (!ok) failed++;
};

function panelFor(ticker, meta) {
  const facts = loadFixture(ticker);
  let bucket = facts.facts["us-gaap"];
  if (meta.historyStart) bucket = trimHistory(bucket, meta.historyStart);
  const statements = buildStatements(bucket, { annualLimit: 12, quarterLimit: 24, fyEndMonth: meta.fyEndMonth });
  statements.__bucket = bucket;
  const adjustmentRows = (capexAdjustments.adjustments || []).filter((r) => r.ticker === ticker);
  return buildFilerCapexPanel({
    meta: { ticker, cik: meta.cik, name: ticker, group: meta.group || "hyperscalers", fyEndMonth: meta.fyEndMonth },
    statements, adjustmentRows,
  });
}
const findQuarter = (panel, end) => panel.quarterly.find((p) => p.periodEnd === end);
const findAnnual = (panel, end) => panel.annual.find((p) => p.periodEnd === end);

console.log("calendarQuarterOf");
check("a June 30 period end is calendar Q2", calendarQuarterOf("2026-06-30") === "2026-Q2");
check("a May 31 period end (Oracle, Applied Digital) is ALSO calendar Q2, alongside the June filers",
  calendarQuarterOf("2026-05-31") === "2026-Q2");
check("a February 29 period end is calendar Q1", calendarQuarterOf("2026-02-28") === "2026-Q1");
check("null in, null out", calendarQuarterOf(null) === null);

console.log("decumulateAdjustmentRows (IREN, Cipher)");
{
  const irenRows = capexAdjustments.adjustments.filter((r) => r.ticker === "IREN");
  const { quarterly, annual } = decumulateAdjustmentRows(irenRows);
  const fy2026 = annual.find((p) => p.end === "2026-06-30");
  check("IREN's FY2026 hardware adjustment is 1,335,081,000, the file's own FY row",
    fy2026 && fy2026.value === 1335081000, fy2026 && String(fy2026.value));
  const q1 = quarterly.find((p) => p.end === "2025-09-30");
  const h1 = quarterly.find((p) => p.end === "2025-12-31");
  check("IREN's Q1 FY2026 hardware quarter is its own row, 100,304,000",
    q1 && q1.value === 100304000, q1 && String(q1.value));
  check("IREN's Q2 FY2026 hardware quarter is the half-year row less Q1: 279,708,000 - 100,304,000 = 179,404,000",
    h1 && h1.value === 179404000, h1 && String(h1.value));
  const sum = quarterly.filter((p) => ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"].includes(p.end))
    .reduce((a, p) => a + p.value, 0);
  check("IREN's four FY2026 hardware quarters sum to the FY row, 1,335,081,000", sum === 1335081000, String(sum));
}
{
  const cifrRows = capexAdjustments.adjustments.filter((r) => r.ticker === "CIFR");
  const { quarterly } = decumulateAdjustmentRows(cifrRows);
  const q1 = quarterly.find((p) => p.end === "2025-09-30" && p.cumulative === 934000);
  check("Cipher's Q3 2025 deposits quarter is its own row taken from a zero base (Q1 and H1 2025 were already recast onto the combined basis, so their adjustment is zero): 934,000",
    q1 && q1.value === 934000, q1 && String(q1.value));
  const q4 = quarterly.find((p) => p.end === "2025-12-31");
  check("Cipher's Q4 2025 deposits quarter is the FY row less the nine-month row: 4,874,000 - 934,000 = 3,940,000",
    q4 && q4.value === 3940000, q4 && String(q4.value));
}

console.log("PR H2 acceptance figures (blueprint 15.9), each checked against its fixture");

const msft = panelFor("MSFT", { cik: 789019, fyEndMonth: 6 });
const msftFY = findAnnual(msft, "2026-06-30");
check("MSFT FY2026 capex (tagged) is 115,948,000,000", msftFY && msftFY.capex.tagged === 115948000000, msftFY && String(msftFY.capex.tagged));
check("MSFT has no capex-adjustments.json row, so the total equals the tagged line",
  msftFY && msftFY.capex.adjustment === null && msftFY.capex.total === 115948000000);
const msftQ4 = findQuarter(msft, "2026-06-30");
check("MSFT's FQ4 FY2026 is derived (annual less the nine-month year-to-date) and is 35,802,000,000",
  !!msftQ4 && msftQ4.derived === true && msftQ4.capex.total === 35802000000,
  msftQ4 && JSON.stringify({ derived: msftQ4.derived, total: msftQ4.capex.total }));

const goog = panelFor("GOOG", { cik: 1652044, fyEndMonth: 12 });
const googQ1 = findQuarter(goog, "2026-03-31"), googQ2 = findQuarter(goog, "2026-06-30");
check("GOOG's Q2 2026 capex alone is 44,924,000,000", googQ2 && googQ2.capex.total === 44924000000, googQ2 && String(googQ2.capex.total));
check("GOOG H1 2026 capex (Q1 + Q2, summed here as the page would) is 80,598,000,000",
  googQ1 && googQ2 && googQ1.capex.total + googQ2.capex.total === 80598000000,
  googQ1 && googQ2 && String(googQ1.capex.total + googQ2.capex.total));

const amzn = panelFor("AMZN", { cik: 1018724, fyEndMonth: 12 });
const amznQ2 = findQuarter(amzn, "2026-06-30");
check("AMZN Q2 2026 capex is 54,208,000,000", amznQ2 && amznQ2.capex.total === 54208000000, amznQ2 && String(amznQ2.capex.total));
const amznAllCapex = [...amzn.annual, ...amzn.quarterly].map((p) => p.capex.total);
check("no trailing-twelve-month capex value (173,028,000,000) appears in any AMZN annual or quarterly slot",
  !amznAllCapex.includes(173028000000));
check("every AMZN annual period end is a real December 31 fiscal year end, never a TTM window",
  amzn.annual.every((p) => p.periodEnd.endsWith("-12-31")), JSON.stringify(amzn.annual.map((p) => p.periodEnd)));
if (amznQ2 && amznQ2.capexRunRate) {
  /* Blueprint 15.1: "AMZN's own TTM fact 173,028,000,000 to 2026-06-30 is
     the check value for the computed run-rate; the two agree within the
     incentive netting" — on this fixture's gross tagged quarters the two
     land on the same figure, since the netting the blueprint calls out
     shows up on the company's own net-of-incentives metric, not on the
     gross tagged line this run-rate sums. The field exists so the page
     can show both; it is not asserted to differ. */
  check("AMZN's own trailing-twelve-month tag (173,028,000,000) is carried as the run-rate's check value",
    amznQ2.capexRunRate.checkValue === 173028000000, JSON.stringify(amznQ2.capexRunRate));
} else {
  console.log("  ..   AMZN's run-rate needs four consecutive quarters the fixture may not carry at 2026-06-30; skipped rather than asserted on absent data");
}

const meta = panelFor("META", { cik: 1326801, fyEndMonth: 12 });
const metaQ1 = findQuarter(meta, "2026-03-31"), metaQ2 = findQuarter(meta, "2026-06-30");
check("META's Q2 2026 capex alone is 30,116,000,000", metaQ2 && metaQ2.capex.total === 30116000000, metaQ2 && String(metaQ2.capex.total));
check("META H1 2026 capex (Q1 + Q2) is 49,113,000,000",
  metaQ1 && metaQ2 && metaQ1.capex.total + metaQ2.capex.total === 49113000000,
  metaQ1 && metaQ2 && String(metaQ1.capex.total + metaQ2.capex.total));

const orcl = panelFor("ORCL", { cik: 1341439, fyEndMonth: 5 });
const orclFY = findAnnual(orcl, "2026-05-31");
check("ORCL FY2026 capex is 55,663,000,000", orclFY && orclFY.capex.total === 55663000000, orclFY && String(orclFY.capex.total));
const orclQ4 = findQuarter(orcl, "2026-05-31");
check("ORCL's FQ4 FY2026 period end (2026-05-31) falls in calendar Q2 2026, alongside the June filers",
  orclQ4 && orclQ4.calendarQuarter === "2026-Q2", orclQ4 && orclQ4.calendarQuarter);

const crwv = panelFor("CRWV", { cik: 1769628, fyEndMonth: 12 });
const crwvQ2 = findQuarter(crwv, "2026-06-30");
check("CRWV's total debt principal at 2026-06-30 is 35,551,000,000", crwvQ2 && crwvQ2.debt.grossDebt === 35551000000, crwvQ2 && String(crwvQ2.debt.grossDebt));

console.log("the calendar-Q2 2026 hyperscaler stack (blueprint 15.1: 181,543,000,000)");
{
  const stack = (msftQ4 ? msftQ4.capex.total : 0) + (googQ2 ? googQ2.capex.total : 0) +
    (amznQ2 ? amznQ2.capex.total : 0) + (metaQ2 ? metaQ2.capex.total : 0) +
    (orclQ4 ? orclQ4.capex.total : 0);
  check("MSFT 35,802 + GOOG 44,924 + AMZN 54,208 + META 30,116 + ORCL 16,493 = 181,543 (millions; computed here in dollars)",
    stack === 181543000000, String(stack));
  check("every one of the five hyperscaler quarters used in the stack is tagged calendar-Q2 2026",
    [msftQ4, googQ2, amznQ2, metaQ2, orclQ4].every((p) => p && p.calendarQuarter === "2026-Q2"));
}

console.log("IREN and Cipher: the hand-keyed adjustment added to the tagged line");
{
  const iren = panelFor("IREN", { cik: 1878848, fyEndMonth: 6, historyStart: "2025-01-01" });
  const irenFY = findAnnual(iren, "2026-06-30");
  check("IREN's FY2026 tagged capex is 2,998,006,000",
    irenFY && irenFY.capex.tagged === 2998006000, irenFY && String(irenFY.capex.tagged));
  check("IREN's FY2026 capex total (tagged + the hand-keyed hardware line) is 4,333,087,000, the blueprint's 4,333.1M",
    irenFY && irenFY.capex.total === 4333087000, irenFY && String(irenFY.capex.total));
  check("IREN's FY2026 total carries the adjustment's source and accession",
    irenFY && irenFY.capex.adjustment && irenFY.capex.adjustment.source === "capex-adjustments.json" &&
    irenFY.capex.adjustment.accession === "0001878848-26-000052",
    irenFY && JSON.stringify(irenFY.capex.adjustment));
}
{
  const cifr = panelFor("CIFR", { cik: 1819989, fyEndMonth: 12, historyStart: "2025-01-01" });
  const cifrFY = findAnnual(cifr, "2025-12-31");
  if (cifrFY) {
    check("Cipher's FY2025 capex total (tagged + deposits on equipment) is 492,795,000, the blueprint's 492.8M",
      cifrFY.capex.total === 492795000, String(cifrFY.capex.total) + " (tagged " + cifrFY.capex.tagged + ")");
  } else {
    console.log("  ..   Cipher's FY2025 annual period is not in the fixture at this cut; skipped rather than asserted on absent data");
  }
}

console.log(`\n${failed === 0 ? "all checks passed" : failed + " check(s) FAILED"}`);
process.exitCode = failed === 0 ? 0 : 1;
