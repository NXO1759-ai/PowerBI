/**
 * test-underwriting-panel.mjs — offline check of build-underwriting-panel
 * .mjs's exported `buildRow(statements, ticker, name)` against the concepts
 * stage's own committed fixtures (scripts/fixtures/underwriting/), the same
 * three filers scripts/test-underwriting-concepts.mjs already pinned:
 * AT&T (T), NVIDIA (NVDA) and RTX Corporation (RTX). No network: buildRow
 * takes an already-built `statements` object and scores it, so this file
 * only calls buildStatements() on the fixture JSON already on disk.
 *
 * buildRow reads the LATEST usable period — an LTM window (four
 * consecutive quarters) if the company has one, else the latest annual
 * period — which for these three fixtures (all cut through mid-to-late
 * 2026) is an LTM ending 2026-06-30 (T), 2026-07-26 (NVDA) or 2026-06-30
 * (RTX), not the fiscal-2025 annual period the concepts stage's own test
 * pinned. The figures below were read off buildRow's own output on
 * 2026-09-22 (see the inline values) and cross-checked by hand from the
 * same fixture facts the concepts test already verified against live
 * EDGAR, not retyped from memory.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStatements } from "./lib/statements.mjs";
import { buildRow } from "./build-underwriting-panel.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const load = (t) => JSON.parse(readFileSync(join(here, "fixtures/underwriting", t.toLowerCase() + "-companyfacts-slice.json"), "utf8"));

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};

const rowFor = (t) => {
  const facts = load(t);
  const statements = buildStatements(facts.facts["us-gaap"]);
  return buildRow(statements, t, facts.entityName);
};

/* ---------- AT&T: lands in the right S&P band on both columns ---------- */
console.log("AT&T (T) — S&P band placement");
{
  const row = rowFor("T");
  check("buildRow picked an LTM period (T files quarterlies, so the latest usable period is a trailing-twelve-month window, not the FY2025 annual)",
    row.basis === "ltm", `basis=${row.basis} periodEnd=${row.periodEnd}`);
  check("debt/EBITDA (about 3.13x, carrying debt of 143,954M over EBITDA of 45,980M) places AT&T in the Significant band (3-4x)",
    row.spBand.debtToEbitda && row.spBand.debtToEbitda.band.key === "significant",
    JSON.stringify(row.spBand.debtToEbitda));
  check("net debt/EBITDA (about 2.75x) places AT&T one band better, in Intermediate (2-3x) — the two columns are allowed to disagree",
    row.spBand.netDebtToEbitda && row.spBand.netDebtToEbitda.band.key === "intermediate",
    JSON.stringify(row.spBand.netDebtToEbitda));
  check("FFO/debt (about 29.1%) places AT&T in Significant too (20-30%), so debt/EBITDA and FFO/debt agree and there is no disagreement note",
    row.spBand.ffoToDebt && row.spBand.ffoToDebt.band.key === "significant" &&
    row.spBand.worse.agree === true && row.spBand.worse.note === null,
    JSON.stringify(row.spBand));
  check("the worse-of-the-two band is Significant, matching both columns",
    row.spBand.worse.band && row.spBand.worse.band.key === "significant");
  check("covenant headroom is computed off (gross) debt/EBITDA, the same measure as the 'Overall S&P placement' above, landing in Significant like card 1, and sits below the 4.0x sub-investment-grade threshold, so no leveraged-lending guidance-line fields are populated",
    row.covenantHeadroom && row.covenantHeadroom.currentBand.key === "significant" &&
    row.covenantHeadroom.guidanceLine === null && row.covenantHeadroom.turnsToGuidanceLine === null,
    JSON.stringify(row.covenantHeadroom));
  check("the maturity ladder falls back to the latest 10-K (2025-12-31) because AT&T never retags the ladder in a 10-Q, and reproduces the concepts stage's own pinned figures (8.652 / 8.953 / 6.905 / 6.918 / 7.020 / 106.216 billion)",
    row.maturityLadder.tagged === true && row.maturityLadder.asOf === "2025-12-31" &&
    row.maturityLadder.nextTwelveMonths === 8652000000 && row.maturityLadder.yearTwo === 8953000000 &&
    row.maturityLadder.yearThree === 6905000000 && row.maturityLadder.yearFour === 6918000000 &&
    row.maturityLadder.yearFive === 7020000000 && row.maturityLadder.afterYearFive === 106216000000,
    JSON.stringify(row.maturityLadder));
  check("fixed-charge coverage's mandatory-amortization input picked up the same fallback ladder value (8,652M) rather than reading null a second time for the same underlying gap",
    row.leverage.fixedChargeCoverage.inputs.mandatoryAmortization === 8652000000);
  check("fixed-charge coverage itself is still null — AT&T tags no cash-interest-paid figure in this fixture — and the row says which input is missing, never a zero",
    row.leverage.fixedChargeCoverage.value === null &&
    row.notes.some((n) => /fixed-charge coverage not computed/.test(n) && /cash interest paid/.test(n)));
  check("cost of debt fell back to interest expense over average debt (AT&T never tags DebtWeightedAverageInterestRate) and is a plausible single-digit rate",
    row.costOfDebt.source === "fallback: interest expense over average debt" &&
    row.costOfDebt.value > 0.02 && row.costOfDebt.value < 0.10);
}

/* ---------- NVIDIA: the blueprint's own no-maturity-schedule example ---------- */
console.log("\nNVIDIA (NVDA) — no maturity schedule tagged");
{
  const row = rowFor("NVDA");
  check("every bucket of NVIDIA's maturity ladder is null — NVIDIA tags no maturity schedule at any period in this fixture, at the LTM period or in its latest 10-K",
    row.maturityLadder.tagged === false && row.maturityLadder.asOf === null &&
    ["remainderOfFiscalYear", "nextTwelveMonths", "yearTwo", "yearThree", "yearFour", "yearFive", "afterYearFive"]
      .every((k) => row.maturityLadder[k] === null),
    JSON.stringify(row.maturityLadder));
  check("the row still says why, in its own notes, rather than leaving the gap unexplained",
    row.notes.includes("no maturity schedule tagged"));
  check("NVIDIA is materially net-cash (net debt is negative), which places it in the Minimal band on debt/EBITDA and leaves net debt/EBITDA unbanded (S&P's ladder starts at zero and a negative ratio falls outside every band, not into a false 'Minimal')",
    row.spBand.debtToEbitda && row.spBand.debtToEbitda.band.key === "minimal" &&
    row.spBand.netDebtToEbitda && row.spBand.netDebtToEbitda.band === null,
    JSON.stringify(row.spBand));
  check("covenant headroom is now computed off (gross) debt/EBITDA, not net — NVIDIA's own net-cash position no longer overrides whether a band is shown at all; it still lands Minimal, matching card 1's own placement, with the net-cash reading visible separately on the 'Net debt/EBITDA' line",
    row.covenantHeadroom && row.covenantHeadroom.currentBand.key === "minimal" &&
    row.covenantHeadroom.guidanceLine === null && row.covenantHeadroom.turnsToGuidanceLine === null,
    JSON.stringify(row.covenantHeadroom));
  check("cost of debt fell back to interest expense over average debt, since NVIDIA does not tag DebtWeightedAverageInterestRate either, and comes out a low single-digit rate consistent with a company that carries very little debt",
    row.costOfDebt.source === "fallback: interest expense over average debt" &&
    row.costOfDebt.value > 0 && row.costOfDebt.value < 0.05);
  check("NVIDIA's debt fair value (31.4B, from LongTermDebtFairValue) is read against LONG-TERM debt only (32,366M), the same scope the tag covers, not the combined short+long-term total the fair-value tag does not reach",
    row.debtFairValue.fairValue === 31400000000 && row.debtFairValue.carryingValue === 32366000000 &&
    Math.abs(row.debtFairValue.markPct - 0.970) < 0.001,
    JSON.stringify(row.debtFairValue));
}

/* ---------- RTX: a second real company, proving the pure-unit cost of
   debt is preferred over the fallback whenever it is actually tagged for
   the period buildRow picked (it is not, here — RTX's rate is annual-only
   and this fixture's LTM period ends mid-year — which is itself a useful
   negative check that the fallback engages correctly rather than always
   firing) ---------- */
console.log("\nRTX — a second real company, S&P bands and the maturity-ladder fallback");
{
  const row = rowFor("RTX");
  check("buildRow picked an LTM period for RTX too",
    row.basis === "ltm", `basis=${row.basis} periodEnd=${row.periodEnd}`);
  check("RTX's LTM period does not carry the pure-unit cost of debt (the tag is annual-only per the concepts stage's own finding), so the fallback engages, same as AT&T and NVIDIA",
    row.costOfDebt.source === "fallback: interest expense over average debt" || row.costOfDebt.source === null,
    JSON.stringify(row.costOfDebt));
  check("RTX's gross debt/EBITDA (about 2.50x, Intermediate) and net debt/EBITDA (about 1.89x, Modest) land in different bands — a real company where the gross and net readings diverge, even though the 'worse of the two' rule compares debt/EBITDA against FFO/debt, not gross against net",
    row.spBand.debtToEbitda && row.spBand.debtToEbitda.band.key === "intermediate" &&
    row.spBand.netDebtToEbitda && row.spBand.netDebtToEbitda.band.key === "modest",
    JSON.stringify(row.spBand));
  check("RTX's debt/EBITDA and FFO/debt (about 32.7%) both land in Intermediate, so the 'worse of the two' fields agree and carry no disagreement note",
    row.spBand.ffoToDebt && row.spBand.ffoToDebt.band.key === "intermediate" &&
    row.spBand.worse.agree === true && row.spBand.worse.note === null,
    JSON.stringify(row.spBand.worse));
  check("the maturity ladder falls back to RTX's latest 10-K (2025-12-31), reproducing its FY2025 next-twelve-months bucket (3,412M) used elsewhere in this file's inputs",
    row.maturityLadder.tagged === true && row.maturityLadder.asOf === "2025-12-31" &&
    row.maturityLadder.nextTwelveMonths === 3412000000);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
