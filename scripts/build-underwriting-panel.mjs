/**
 * build-underwriting-panel.mjs — the weekly panel behind the Underwriting
 * view (blueprint section 5, PR F).
 *
 *   node scripts/build-underwriting-panel.mjs [--limit N]
 *
 * Modeled on scripts/build-strategy-panel.mjs: paced live companyfacts pull
 * per covered ticker, quiet dot-per-company output, one static file
 * written at the end. The difference from that script is the house rule
 * this one must keep that the strategy panel does not: a company EDGAR did
 * not answer for is never dropped from the file — it still gets a row,
 * with every figure null and the reason recorded, because the Underwriting
 * page shows all 137 covered names side by side and a silently missing row
 * reads as "not covered" rather than "the pull failed this week".
 *
 * The six-card scoring itself is `buildRow(statements, ticker, name)`,
 * exported and callable with no network so scripts/test-underwriting-panel
 * .mjs can assert on it against the concepts stage's committed fixtures.
 * Everything network-shaped (resolving the universe, pacing the fetch,
 * writing the file) stays in this module's top level.
 *
 * EBITDA, FFO and the S&P bands read from the LATEST TRAILING-TWELVE-MONTH
 * window (statements.ltm, the last entry) where the company has one —
 * four consecutive quarters — and fall back to the latest annual period
 * for a company that does not (a recent listing, or a filer whose
 * quarters have a gap). Both are point-in-time reads off buildStatements'
 * own output; no averaging across periods is needed for any of the six
 * cards, so buildRow never has to reach for a "prior" period the way the
 * Statement Analysis dashboard's RNOA/ROE decomposition does — which
 * matters, because frontend/lib/ratios.js's own computePeriod()/
 * computeRatios() annualize every flow by ×4 for any period whose
 * fiscalPeriod is not "FY" (quarterlies), and an LTM period's
 * fiscalPeriod is "LTM": running an LTM period through computePeriod
 * would quadruple its already-annual EBITDA before dividing net debt by
 * it. buildRow sidesteps this by calling ratios.js's plain building-block
 * functions (ebit, ebitda, netDebt, financialLiabilities, freeCashFlow,
 * bookEquity — none of which annualize) directly on the one period it
 * picked, rather than routing through computePeriod/computeRatios at all.
 * fixedChargeCoverage, ffoToDebt and bandDistance are the three plain
 * number functions blueprint section 5 added to ratios.js for exactly
 * this page, and take the figures this file already pulled off the
 * period, not a period object.
 *
 * House rule: EBITDA here is operating income plus D&A, stated as such —
 * never an adjusted figure — and covenant headroom is the distance to the
 * next published S&P band, labeled synthetic. Section 11's ban on
 * computing a portfolio company's own EBITDA, coverage or leverage is
 * about a BDC's borrower, a private company the site has no filed
 * statements for; every name here is one of the site's own covered public
 * companies, computed from ITS OWN SEC filings, which section 5
 * authorizes explicitly.
 *
 * Industry and sector are read from the already-built frontend/data/
 * industry-map.js (itself built by classify() in scripts/lib/sic-map.mjs,
 * scripts/build-industry-map.mjs) rather than re-classified here from a
 * fresh submissions fetch: every covered ticker is already in that map
 * (build-strategy-panel.mjs reads it the same way), so re-deriving SIC
 * from EDGAR a second time would double this run's request count for a
 * value already on disk. classify() itself is still the fallback for the
 * rare ticker the map does not carry, so no second classification table
 * is ever written.
 *
 * Not carried over from build-strategy-panel.mjs: the cohorts.json
 * historyStart trim for a shell-company CIK (TeraWulf's is IKONICS
 * Corp's, Nebius's is Yandex N.V.'s). That trim exists to keep a
 * pre-merger shell's years out of a multi-year industry panel; this file
 * only ever reads the LATEST LTM or annual period, which a stale
 * pre-merger YEAR earlier in the series does not change. It can affect
 * fiscalYearEndMonth detection at the margin for those six tickers, which
 * is a buildStatements concern already shared with every other page that
 * reads these companies, not something this file's own scoring needs to
 * correct twice.
 *
 * Exit codes: 0 wrote at least one row with a usable period; 1 wrote a
 * file where every row came back null (a wholesale EDGAR outage); 2 the
 * run could not even resolve the universe (a missing or unreadable
 * frontend/data file).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildStatements } from "./lib/statements.mjs";
import { classify } from "./lib/sic-map.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const RTRatios = require("../frontend/lib/ratios.js");
const { isNum, div, add, ebit, ebitda, netDebt, bookEquity,
  financialLiabilities, freeCashFlow, fixedChargeCoverage, ffoToDebt, bandDistance,
  SP_FINANCIAL_RISK_BANDS } = RTRatios;

const UA = { "User-Agent": process.env.SEC_USER_AGENT ||
  "Research Terminal research@chineduokeke.mba" };

const argv = process.argv.slice(2);
const LIMIT = Number((argv[argv.indexOf("--limit") + 1]) || 0) || 0;

const OUT_FILE = join(ROOT, "frontend/data/underwriting.json");

/* ---------- S&P's FFO/debt column (blueprint section 5): the inverse of
   the debt/EBITDA ladder — higher FFO/debt is SAFER, so its bands run the
   opposite direction from SP_FINANCIAL_RISK_BANDS and cannot share
   bandDistance's ascending-worse boundary walk (concepts stage's own
   contract note on bandDistance flags exactly this). Kept local to this
   file rather than added to ratios.js: it is a placement table, not a
   distance calculator, and nothing else in the codebase needs it yet. */
const FFO_DEBT_BANDS = [
  { key: "minimal", label: "Minimal", min: 0.60, max: Infinity },
  { key: "modest", label: "Modest", min: 0.45, max: 0.60 },
  { key: "intermediate", label: "Intermediate", min: 0.30, max: 0.45 },
  { key: "significant", label: "Significant", min: 0.20, max: 0.30 },
  { key: "aggressive", label: "Aggressive", min: 0.12, max: 0.20 },
  { key: "highlyLeveraged", label: "Highly leveraged", min: -Infinity, max: 0.12 },
];
const BAND_RANK = { minimal: 0, modest: 1, intermediate: 2, significant: 3, aggressive: 4, highlyLeveraged: 5 };

function placeBand(value, bands) {
  if (!isNum(value)) return null;
  for (const b of bands) {
    if (value >= b.min && (value < b.max || !isFinite(b.max))) return b;
  }
  return null;
}

/* the worse (higher-rank) of the debt/EBITDA and FFO/debt placements,
   with a note whenever the two disagree. FIXER ROUND 2: neither
   blueprint document states a tie-break rule for the two ladders (section
   5's benchmark cell gives only the two tables), and S&P's own matrix is
   not cited anywhere in this codebase for one either — the "governs" rule
   is this page's own stated convention, not a sourced methodology claim,
   and every string below says so rather than attributing it to S&P or to
   "the blueprint". */
function worseBand(debtBand, ffoBand) {
  if (!debtBand && !ffoBand) return { basis: null, band: null, agree: null, note: null };
  if (debtBand && !ffoBand) return { basis: "debtToEbitda", band: debtBand, agree: null, note: "FFO/debt not computed; band from debt/EBITDA alone" };
  if (ffoBand && !debtBand) return { basis: "ffoToDebt", band: ffoBand, agree: null, note: "debt/EBITDA not computed; band from FFO/debt alone" };
  const agree = debtBand.key === ffoBand.key;
  const worse = BAND_RANK[debtBand.key] >= BAND_RANK[ffoBand.key] ? debtBand : ffoBand;
  const basis = worse === debtBand ? "debtToEbitda" : "ffoToDebt";
  return {
    basis, band: worse, agree,
    note: agree ? null :
      `debt/EBITDA places the company ${debtBand.label} while FFO/debt places it ${ffoBand.label}; this page's convention is that the worse (${worse.label}) governs`,
  };
}

/* the latest usable period: whichever of the latest LTM window (four
   consecutive quarters) and the latest annual period has the LATER
   periodEnd, never a quarterly period alone — a single quarter's EBITDA is
   not the trailing-year figure the six cards are built on. FIXER ROUND 1:
   this used to prefer the LTM window unconditionally, which for a filer
   whose most recent 10-K posts a periodEnd AFTER its own latest LTM window
   (Home Depot: LTM through 2025-11-02, FY2025 10-K through 2026-02-01)
   left the whole scorecard reading a stale quarter while the maturity
   ladder's own 10-K fallback below (dated, by design) ended up newer than
   the period it was supposedly falling back FOR — a note that read
   backwards. Comparing periodEnd directly and taking the later one fixes
   both: the scorecard is never staler than a 10-K EDGAR has already
   published, and the ladder fallback's own periodEnd guard a few lines
   down is now automatically satisfied whenever it fires. */
function latestPeriod(statements) {
  const ltm = statements && statements.ltm || [];
  const annual = statements && statements.annual || [];
  const ltmLast = ltm.length ? ltm[ltm.length - 1] : null;
  const annualLast = annual.length ? annual[annual.length - 1] : null;
  if (!ltmLast && !annualLast) return { basis: null, period: null, series: [], index: -1 };
  if (ltmLast && annualLast && String(annualLast.periodEnd) > String(ltmLast.periodEnd)) {
    return { basis: "annual", period: annualLast, series: annual, index: annual.length - 1 };
  }
  if (ltmLast) return { basis: "ltm", period: ltmLast, series: ltm, index: ltm.length - 1 };
  return { basis: "annual", period: annualLast, series: annual, index: annual.length - 1 };
}

const absOf = (v) => (isNum(v) ? Math.abs(v) : null);

/* FIXER ROUND 1: the S&P corporate financial-risk matrix (debt/EBITDA,
   FFO/debt, the covenant-headroom bands and the leveraged-lending
   sub-ladder) is a corporate-borrower frame. A bank's or insurer's debt is
   deposits and policy reserves, not corporate leverage; a REIT's and a
   regulated utility's "debt" sits against a rate base or a real-estate
   portfolio, not an EBITDA stream the matrix was built to read. Applying
   the ladder to those sectors anyway produced contradictory on-screen
   labels (Bank of America "Highly leveraged" on debt/EBITDA next to "net
   cash position" on the net-debt reading) and a leveraged-lending
   sub-ladder firing on NextEra and Morgan Stanley, neither of which is a
   leveraged-loan borrower in the sense the 2013 interagency guidance
   means. These three sectors are excluded from the whole corporate ladder
   — band placement, covenant headroom and the sub-ladder — with a stated
   reason, rather than banded incoherently.

   SCOPE DECISION (FIXER ROUND 2, recorded here since this repo has no
   docs/brain/DECISIONS the way the Lynen repos do): this is a deliberate
   narrowing of blueprint section 5's "the S&P financial-risk bands for
   all covered companies" instruction, made on the merits above, and it
   stands. What changed in this round: the 39 excluded names (DLR among
   them, one of the seven data-center tickers coverage.js deliberately
   added) are no longer dropped from the U1 scatter outright — scatterSvg
   in frontend/credit-underwriting.js now plots them with a distinct
   marker when their raw debt/EBITDA and interest coverage both resolve,
   captioned as excluded from the S&P ladder rather than left off the
   chart, so "137 covered companies" still reads as covered even where
   fewer are banded. */
const SECTORS_WITHOUT_CORPORATE_LADDER = new Set(["Financials", "Real Estate", "Utilities"]);
function sectorLadderCaveat(sector) {
  if (!sector || !SECTORS_WITHOUT_CORPORATE_LADDER.has(sector)) return null;
  return `${sector} balance sheets are not comparable to S&P's corporate financial-risk matrix ` +
    `(deposits, policy reserves and rate-base or real-estate financing are not corporate leverage against an EBITDA stream); ` +
    `debt/EBITDA and FFO/debt band placement, covenant headroom and the leveraged-lending sub-ladder are not shown for this company`;
}

/**
 * The per-company scoring, pure and network-free: everything it needs is
 * already on `statements` (scripts/lib/statements.mjs's buildStatements
 * output). Returns one row of the underwriting.json schema. `ticker` and
 * `name` are carried through unchanged; `sector` (already resolved by the
 * caller from the industry map) gates the corporate-ladder exclusion
 * above; industry/cik are attached by the caller, which is the only piece
 * of this that needs a file this function was not handed.
 */
export function buildRow(statements, ticker, name, sector) {
  const notes = [];
  const { basis, period, series, index } = latestPeriod(statements);
  const sectorCaveat = sectorLadderCaveat(sector);

  if (!period) {
    return {
      ticker, name, basis: null, periodEnd: null, fiscalYear: null, fiscalPeriod: null,
      form: null, filed: null, accession: null, sectorCaveat,
      leverage: {
        ebitda: null, ebit: null, debtTotal: null, netDebt: null, bookEquity: null,
        debtToEbitda: null, netDebtToEbitda: null, ffo: null, ffoToDebt: null,
        interestExpense: null, interestCoverage: null,
        fixedChargeCoverage: { value: null, inputs: null },
        fcf: null, fcfToDebt: null, leverageNotComputableReason: null,
      },
      spBand: { debtToEbitda: null, netDebtToEbitda: null, ffoToDebt: null, worse: { basis: null, band: null, agree: null, note: null } },
      covenantHeadroom: null,
      maturityLadder: { remainderOfFiscalYear: null, nextTwelveMonths: null, yearTwo: null, yearThree: null, yearFour: null, yearFive: null, afterYearFive: null, tagged: false, asOf: null },
      liquidity: { cash: null, revolverCapacity: null, ltmFcf: null, nextTwelveMonthMaturities: null, leasePaymentsDue: null, runwayCoverage: null },
      debtFairValue: { fairValue: null, carryingValue: null, markPct: null },
      costOfDebt: { value: null, source: null, tag: null },
      notes: ["no LTM window or annual period available — never reported as a zero"],
    };
  }

  const is = period.incomeStatement, b = period.balanceSheet, cf = period.cashFlow, pure = period.pure || {};

  const e = ebit(period);
  let eb = ebitda(period);
  /* FIXER ROUND 1 (EBITDA 10-K fallback): a filer that tags EBIT fine but
     only tags depreciation & amortization annually (AMD's D&A is null in
     all five of its most recent quarters, tagged only at FY close) left
     27 covered companies with no EBITDA at all — no leverage ratio, no
     S&P band, no covenant headroom — with nothing on the page saying why,
     even though the annual D&A exists. The maturity ladder already solves
     this exact shape a few dozen lines down (fall back to the latest
     10-K, dated, with a note); this borrows only the D&A term from that
     same latest annual period rather than the whole EBIT figure, since
     EBIT itself is usually fine on the LTM period (AMD's own interest
     coverage renders 44.1x with no fallback needed). */
  let ebitdaBasisNote = null;
  if (!isNum(eb) && isNum(e) && basis === "ltm" && statements.annual && statements.annual.length) {
    const latestAnnual = statements.annual[statements.annual.length - 1];
    const annualDA = latestAnnual.cashFlow && latestAnnual.cashFlow.depreciationAmortization;
    if (isNum(annualDA)) {
      eb = e + annualDA;
      ebitdaBasisNote = `EBITDA's depreciation & amortization is from the latest 10-K (${latestAnnual.periodEnd}); not tagged in the ${period.periodEnd} trailing-twelve-month window`;
    }
  }
  const shortDebtKnown = isNum(b.shortTermDebt), longDebtKnown = isNum(b.longTermDebt);
  const debtTotalRaw = financialLiabilities(period);
  const ndRaw = netDebt(period);
  const bve = bookEquity(period);
  /* FIXER ROUND 2 (debt-total trust gate): financialLiabilities() is
     add(shortTermDebt, longTermDebt), and ratios.js's add() treats a
     missing leg as zero — the right behavior for netDebt() elsewhere in
     the codebase, but wrong here: it published a "total" that was really
     just one leg whenever the other was untagged, with no note, because
     the result was still a number. CVX rendered debt/EBITDA 0.01x off a
     $0.401B "total" against a $30.9B tagged maturity ladder (a 77x
     mismatch); TMUS, DE and MU carried the same shape. Both legs must now
     resolve before the total is trusted. */
  const debtTotalKnown = shortDebtKnown && longDebtKnown && isNum(debtTotalRaw);
  const debtTotal = debtTotalKnown ? debtTotalRaw : null;
  /* FIXER ROUND 1 (netDebt zero-fill): ratios.js's netDebt() treats an
     untagged debt balance as 0 so that a company with no financial
     liabilities at all still nets correctly against its cash. That is the
     right behavior for netDebt() itself (left untouched — the Statement
     Analysis dashboard still needs it), but this page must not publish
     the result when debtTotal came back null: it cannot tell "this
     company truly carries no debt" apart from "this filer's debt tags
     did not resolve", and 11 rows (Goldman Sachs, Caterpillar among them)
     were rendering the second case as a confident net-cash position. */
  const nd = debtTotalKnown ? ndRaw : null;
  if (!debtTotalKnown) {
    notes.push(isNum(debtTotalRaw)
      ? "total interest-bearing debt: only one of short-term and long-term debt is tagged this period, so the combined figure covers just that one leg and is not published as a total; net debt and every leverage ratio built on it are not computed"
      : "total interest-bearing debt (short-term plus long-term) not tagged; net debt and every leverage ratio built on it are not computed");
  }
  if (isNum(e) && isNum(eb)) {
    if (ebitdaBasisNote) {
      notes.push(ebitdaBasisNote);
    } else if (isNum(is.operatingIncome)) {
      notes.push("EBITDA is operating income plus D&A, stated as such — never an adjusted figure");
    } else {
      notes.push("operating income not tagged; EBITDA this period is pretax income plus interest expense plus D&A, stated as such — never an adjusted figure");
    }
  } else if (!isNum(eb)) {
    notes.push("EBITDA is not computable this period: operating income (or pretax income plus interest expense) and depreciation & amortization are not both tagged, even against the latest 10-K");
  }

  /* FIXER ROUND 1 (negative-EBITDA sign flip): debt/EBITDA and net
     debt/EBITDA are only meaningful when EBITDA is positive. Dividing a
     negative net debt (net cash) by a negative EBITDA (a loss) produces a
     POSITIVE ratio that then reads as real leverage — TeraWulf priced at
     "8.46x, Highly leveraged" on a company that is $2.6B net cash and
     simply lost money this period. Both ratios are refused, not just
     flipped in sign, whenever EBITDA is not positive. */
  const ebitdaPositive = isNum(eb) && eb > 0;
  if (isNum(eb) && eb <= 0) notes.push("EBITDA is zero or negative this period; leverage through EBITDA (debt/EBITDA, net debt/EBITDA) is not meaningful and is not computed");
  const debtToEbitda = ebitdaPositive ? div(debtTotal, eb) : null;
  const netDebtToEbitda = ebitdaPositive ? div(nd, eb) : null;

  const netIncome = is.netIncome;
  const da = cf.depreciationAmortization;
  const ffo = (isNum(netIncome) && isNum(da)) ? netIncome + da : null;
  const ffoRatio = ffoToDebt(ffo, debtTotal);
  if (isNum(ffo)) notes.push("FFO is proxied as net income plus depreciation and amortization, not S&P's own fuller bridge, which the tagged data cannot rebuild");

  const interestExpense = absOf(is.interestExpense);
  const interestCoverage = (isNum(e) && isNum(interestExpense) && interestExpense > 0) ? e / interestExpense : null;

  const fcf = freeCashFlow(period);
  const fcfToDebt = div(fcf, debtTotal);

  /* FIXER ROUND 1: the one reason string the page shows wherever a
     leverage-through-EBITDA figure (debt/EBITDA, net debt/EBITDA,
     covenant headroom, the sub-ladder) is null, so the view never has to
     re-derive "why" from a sign check of its own — which is exactly what
     produced the false "net cash" readings on companies with real debt
     and a loss year. */
  let leverageNotComputableReason = null;
  if (sectorCaveat) leverageNotComputableReason = sectorCaveat;
  else if (!isNum(eb)) leverageNotComputableReason = "EBITDA is not computable this period (operating income and depreciation & amortization not both tagged)";
  else if (eb <= 0) leverageNotComputableReason = "EBITDA is zero or negative this period, so leverage through EBITDA is not meaningful and is not computed";
  else if (!debtTotalKnown) leverageNotComputableReason = isNum(debtTotalRaw)
    ? "only one of short-term and long-term debt is tagged this period, so the total is not trustworthy and leverage through EBITDA is not computed"
    : "total interest-bearing debt not tagged, so leverage through EBITDA is not computed";

  /* cost of debt: the tagged rate first, else interest expense over the
     average of this period's total debt and the immediately preceding
     period's in the SAME series (annual-to-annual spans a full prior
     year, as the concepts stage's AT&T check did by hand; LTM-to-LTM
     spans one quarter, an approximation this file states rather than
     hides).

     FIXER ROUND 2 (three fixes together):
       1. sector suppression — a bank's or insurer's interest expense
          includes deposit or policy-reserve interest that
          financialLiabilities() (short + long-term debt only) does not
          cover, so the fallback ratio is meaningless for the same
          sectors the S&P corporate ladder already excludes. Card 6 used
          to be the one block on the page NOT gated by sectorCaveat.
       2. a stated plausibility ceiling — even a single-B leveraged loan
          rarely prices above the mid-teens; a fallback above 15% for a
          NON-excluded sector (Chevron 45.85%, Deere 19.4%) is almost
          always a scope mismatch between the numerator and denominator,
          not a real borrowing cost, and is refused with a note rather
          than published.
       3. the "not disclosed" reason now names the input that is
          actually missing (interest expense untagged, versus a
          debt-total that failed the two-legs trust gate above, versus
          truly no prior period to average against) instead of always
          blaming "no prior period", which was false for the 34 rows
          whose real gap was an untagged interestExpense. */
  const COST_OF_DEBT_CEILING = 0.15;
  let costOfDebt = { value: null, source: null, tag: null };
  if (isNum(pure.costOfDebtTagged)) {
    costOfDebt = { value: pure.costOfDebtTagged, source: "tagged", tag: (period.tags && period.tags["pure.costOfDebtTagged"]) || null };
  } else if (sectorCaveat) {
    notes.push(`cost of debt: not shown — ${sector} interest expense includes deposit or policy-reserve interest that the interest-over-average-debt fallback cannot separate from a corporate borrowing cost`);
  } else {
    const prior = index > 0 ? series[index - 1] : null;
    const priorDebtKnown = !!prior && isNum(prior.balanceSheet.shortTermDebt) && isNum(prior.balanceSheet.longTermDebt);
    const priorDebt = priorDebtKnown ? financialLiabilities(prior) : null;
    const avgDebt = (debtTotalKnown && isNum(priorDebt)) ? (debtTotal + priorDebt) / 2 : null;
    const fallback = (isNum(interestExpense) && isNum(avgDebt) && avgDebt > 0) ? interestExpense / avgDebt : null;
    if (fallback !== null && fallback > COST_OF_DEBT_CEILING) {
      notes.push(`cost of debt: the interest-over-average-debt fallback computed ${(fallback * 100).toFixed(1)}%, above the ${(COST_OF_DEBT_CEILING * 100).toFixed(0)}% plausibility ceiling this page states for that approximation — most likely a scope mismatch between interest expense and average debt, not a real borrowing cost; not shown`);
    } else if (fallback !== null) {
      costOfDebt = { value: fallback, source: "fallback: interest expense over average debt", tag: null };
      notes.push(`cost of debt: DebtWeightedAverageInterestRate not tagged; computed as interest expense over average ${basis === "ltm" ? "quarter-over-quarter" : "year-over-year"} debt`);
    } else if (!isNum(interestExpense)) {
      notes.push("cost of debt: not disclosed — interest expense is not tagged, so neither DebtWeightedAverageInterestRate nor the interest-over-average-debt fallback is available");
    } else if (!debtTotalKnown) {
      notes.push("cost of debt: not disclosed — total interest-bearing debt is not reliably tagged this period, so the interest-over-average-debt fallback has no denominator");
    } else {
      notes.push("cost of debt: not disclosed — no tagged rate, and no prior period with both debt legs tagged to average against for the fallback");
    }
  }

  /* the maturity ladder: null with a reason, never a zero, for a company
     (NVIDIA is the standing example) that tags no schedule at all.
     Some filers (AT&T, per the concepts stage's own fixture) tag the
     ladder only in the 10-K and never retag it in a 10-Q, so an LTM
     period's balance sheet — which is the LATEST QUARTER's reading,
     however old that concept's own last tag is — reads null even though
     the company's most recent annual report carries a real schedule. The
     latest annual period's own ladder is used in that one case, with
     `asOf` and a note saying so, rather than reporting a company with a
     real, disclosed schedule the same way as one that has never tagged
     it at all. */
  let ladder = {
    remainderOfFiscalYear: b.maturityRemainderOfFiscalYear,
    nextTwelveMonths: b.maturityNextTwelveMonths,
    yearTwo: b.maturityYearTwo, yearThree: b.maturityYearThree,
    yearFour: b.maturityYearFour, yearFive: b.maturityYearFive,
    afterYearFive: b.maturityAfterYearFive,
  };
  let tagged = Object.values(ladder).some(isNum);
  let ladderAsOf = period.periodEnd;
  if (!tagged && basis === "ltm" && statements.annual && statements.annual.length) {
    const latestAnnual = statements.annual[statements.annual.length - 1];
    const ab = latestAnnual.balanceSheet;
    const altLadder = {
      remainderOfFiscalYear: ab.maturityRemainderOfFiscalYear,
      nextTwelveMonths: ab.maturityNextTwelveMonths,
      yearTwo: ab.maturityYearTwo, yearThree: ab.maturityYearThree,
      yearFour: ab.maturityYearFour, yearFive: ab.maturityYearFive,
      afterYearFive: ab.maturityAfterYearFive,
    };
    if (Object.values(altLadder).some(isNum)) {
      ladder = altLadder; tagged = true; ladderAsOf = latestAnnual.periodEnd;
      notes.push(`maturity ladder is from the latest 10-K (${latestAnnual.periodEnd}); not retagged in the ${period.periodEnd} quarter`);
    }
  }
  if (!tagged) notes.push("no maturity schedule tagged");

  /* fixed-charge coverage: mandatory amortization is the ladder's
     next-twelve-months bucket ABOVE — after the 10-K fallback, so a
     10-K-only tagger like AT&T is not penalized twice for the same gap —
     cash interest has no such fallback (named InterestPaidNet/InterestPaid
     in the concept ladder, with no alternate reading). */
  const capexVal = absOf(cf.capex);
  const cashTaxes = is.incomeTax;
  const cashInterest = cf.interestPaid;
  const mandatoryAmortization = ladder.nextTwelveMonths;
  const fcc = fixedChargeCoverage(eb, capexVal, cashTaxes, cashInterest, mandatoryAmortization);
  if (isNum(cashTaxes)) {
    notes.push("fixed-charge coverage's cash taxes are proxied by the accrual income-tax provision (IncomeTaxExpenseBenefit); no cash-taxes-paid tag exists in the concept ladder");
    if (cashTaxes < 0) notes.push("the income-tax line was a benefit (negative) this period, which flows through the fixed-charge-coverage proxy as a reduction in the charge, not a tax paid");
  }
  if (fcc === null && isNum(eb) && isNum(capexVal) && isNum(cashTaxes)) {
    const reasons = [];
    if (!isNum(cashInterest)) {
      /* FIXER ROUND 2: an LTM cashInterest is a four-quarter sum
         (statements.mjs buildLtm's sum()), which returns null the moment
         ANY one of the four quarters lacks the tag — including AT&T's
         shape, where the annual tag exists but one derived quarter does
         not. Saying "not tagged" was false for the 27 of 137 rows where
         the filer plainly does tag cash interest, just not in every
         quarter of this trailing window. */
      const everTagged = (statements.annual || []).some((p) => isNum(p.cashFlow && p.cashFlow.interestPaid)) ||
        (statements.quarterly || []).some((p) => isNum(p.cashFlow && p.cashFlow.interestPaid));
      reasons.push(everTagged
        ? "cash interest paid (InterestPaidNet/InterestPaid) is tagged in some periods, but the trailing-twelve-month sum used here is incomplete because at least one of the four quarters does not carry it"
        : "cash interest paid (InterestPaidNet/InterestPaid) is not tagged");
    }
    if (!isNum(mandatoryAmortization)) reasons.push("next-twelve-months debt maturities are not tagged");
    if (reasons.length) notes.push(`fixed-charge coverage not computed: ${reasons.join("; ")}`);
  }

  /* liquidity runway: cash + revolver capacity + trailing-twelve-month
     free cash flow over next-twelve-month maturities plus next-twelve-
     month operating lease payments due. add() tolerates a missing term
     (treats it as 0 in the sum) the same way the BDC liquidity-cover
     ratio does in blueprint-v2-detail 4.2 — the numerator is a floor, not
     a refusal, and every zeroed term is named in notes so "no revolver
     disclosed" is never read as "zero liquidity".

     FIXER ROUND 2 (two blockers together):

     1. The free-cash-flow term used to be withheld whenever basis was
        "annual" on the premise that only an LTM window is a trailing-
        twelve-month figure. That premise is wrong: an ANNUAL period IS a
        twelve-month window ending at periodEnd, just as much as an LTM
        one — the two differ in which twelve months, not in span. Home
        Depot (FY through 2026-02-01, a 10-K) was publishing a runway of
        cash alone ($1.389B) over a $16.3B denominator while its own
        leverage card carried $12.646B of free cash flow the runway
        never used, and the caption kept naming "LTM free cash flow" as
        part of a numerator that had excluded it. Free cash flow off the
        period buildRow already picked (annual or LTM) is used here on
        the same footing; nothing is withheld for an annual basis.

     2. The lease term was LesseeOperatingLeaseLiabilityPaymentsDue — the
        filer's WHOLE remaining lease schedule, not a one-year figure.
        AT&T's is $27.556B against a $22.524B DISCOUNTED lease liability;
        against Amazon's own SEC-frames-verified one-year row of
        $15.38B, its lifetime row is $106.914B, a 6.9x overstatement of
        the correct denominator term. concepts.mjs now carries the
        one-year tag (opLeaseDueNextTwelveMonths) separately, with the
        same 10-K fallback the maturity ladder already uses below, and
        the runway is refused — not computed with the lifetime figure
        substituted — for a filer where only the lifetime total
        resolves. */
  if (!isNum(b.revolverCapacity)) notes.push("revolver capacity not tagged (rare among operating companies); treated as 0 in the liquidity-runway numerator");
  const ltmFcf = fcf;
  const cashKnown = isNum(b.cash);
  if (!cashKnown) notes.push("cash and cash equivalents not tagged; liquidity runway is not computed");
  const maturitiesKnown = isNum(ladder.nextTwelveMonths);
  if (!maturitiesKnown && tagged) notes.push("next-twelve-month debt maturities not tagged, though other buckets of the ladder are; liquidity runway is not computed without it");
  let leaseTerm = b.opLeaseDueNextTwelveMonths;
  let leaseKnown = isNum(leaseTerm);
  if (!leaseKnown && basis === "ltm" && statements.annual && statements.annual.length) {
    const latestAnnual = statements.annual[statements.annual.length - 1];
    const altLease = latestAnnual.balanceSheet && latestAnnual.balanceSheet.opLeaseDueNextTwelveMonths;
    if (isNum(altLease)) {
      leaseTerm = altLease; leaseKnown = true;
      notes.push(`next-twelve-month operating lease payments due is from the latest 10-K (${latestAnnual.periodEnd}); not retagged in the ${period.periodEnd} quarter`);
    }
  }
  if (!leaseKnown) {
    notes.push(isNum(b.opLeaseDue)
      ? "next-twelve-month operating lease payments due not tagged (only the filer's whole remaining lease schedule is); liquidity runway is not computed without the one-year figure — the lifetime total is not a substitute"
      : "operating lease payments due not tagged; liquidity runway is not computed without it");
  }
  const liquidityNumerator = add(b.cash, b.revolverCapacity, ltmFcf);
  const runwayReady = cashKnown && maturitiesKnown && leaseKnown;
  const liquidityDenominator = runwayReady ? add(ladder.nextTwelveMonths, leaseTerm) : null;
  const runwayCoverageRaw = runwayReady ? div(liquidityNumerator, liquidityDenominator) : null;
  /* a non-positive runway (trailing-twelve-month free cash flow deep
     enough negative to swamp cash) is not a coverage multiple of any
     length; withheld the same as a null one rather than rendered as e.g.
     "-15.8x" */
  if (isNum(runwayCoverageRaw) && runwayCoverageRaw <= 0) notes.push("liquidity runway is not computed: the numerator (cash, revolver capacity and trailing-twelve-month free cash flow) is zero or negative");
  const runwayCoverage = (isNum(runwayCoverageRaw) && runwayCoverageRaw > 0) ? runwayCoverageRaw : null;

  /* FIXER ROUND 1 (sector-ladder exclusion, wired): a sectorCaveat means
     the whole S&P corporate-borrower frame — band placement, covenant
     headroom, the leveraged-lending sub-ladder — is suppressed for this
     row, not just annotated. Computing the bands and then separately
     noting they do not apply left Bank of America "Highly leveraged" on
     screen with no visible caveat attached to that specific label. */
  const debtBand = sectorCaveat ? null : placeBand(debtToEbitda, SP_FINANCIAL_RISK_BANDS);
  const netDebtBand = sectorCaveat ? null : placeBand(netDebtToEbitda, SP_FINANCIAL_RISK_BANDS);
  const ffoBand = sectorCaveat ? null : placeBand(ffoRatio, FFO_DEBT_BANDS);
  const worse = sectorCaveat ? { basis: null, band: null, agree: null, note: sectorCaveat } : worseBand(debtBand, ffoBand);

  /* FIXER ROUND 1 (covenant-headroom basis): bandDistance now walks
     debt/EBITDA (gross), not net debt/EBITDA — the same measure card 1's
     "Overall S&P placement" and the blueprint's own stated ladder use —
     so the scorecard's two band labels agree instead of Bank of America
     reading "Highly leveraged" on gross debt/EBITDA next to "Significant"
     on net. The distance-to-guidance-line sub-ladder inherits the same
     basis, so it fires on the same 17 names the 4.0x threshold on card 1
     already implies, not a different set net debt happens to clear. A
     company's net-cash position is still visible on the scorecard's own
     "Net debt/EBITDA" line; it no longer silently overrides whether a
     covenant-headroom band is shown at all. */
  const covenantHeadroom = sectorCaveat ? null : bandDistance(debtToEbitda, SP_FINANCIAL_RISK_BANDS);

  return {
    ticker, name, basis, sectorCaveat,
    periodEnd: period.periodEnd, fiscalYear: period.fiscalYear, fiscalPeriod: period.fiscalPeriod,
    form: period.form || null, filed: period.filed || null, accession: period.accession || null,
    leverage: {
      ebitda: eb, ebit: e, debtTotal, netDebt: nd, bookEquity: bve,
      debtToEbitda, netDebtToEbitda, ffo, ffoToDebt: ffoRatio,
      interestExpense, interestCoverage,
      fixedChargeCoverage: { value: fcc, inputs: { ebitda: eb, capex: capexVal, cashTaxes, cashInterest, mandatoryAmortization } },
      fcf, fcfToDebt, leverageNotComputableReason,
    },
    spBand: {
      debtToEbitda: isNum(debtToEbitda) ? { value: debtToEbitda, band: debtBand } : null,
      netDebtToEbitda: isNum(netDebtToEbitda) ? { value: netDebtToEbitda, band: netDebtBand } : null,
      ffoToDebt: isNum(ffoRatio) ? { value: ffoRatio, band: ffoBand } : null,
      worse,
    },
    covenantHeadroom,
    maturityLadder: { ...ladder, tagged, asOf: tagged ? ladderAsOf : null },
    liquidity: {
      /* leasePaymentsDue is the NEXT-TWELVE-MONTH figure the runway
         denominator actually uses (opLeaseDueNextTwelveMonths, with the
         same 10-K fallback as the maturity ladder) — never the lifetime
         schedule (opLeaseDue), so the number shown beside the runway
         always matches the number the runway was computed from. */
      cash: b.cash, revolverCapacity: b.revolverCapacity, ltmFcf,
      nextTwelveMonthMaturities: ladder.nextTwelveMonths, leasePaymentsDue: leaseTerm,
      runwayCoverage,
    },
    debtFairValue: (function () {
      /* FIXER ROUND 1 (debt fair value scope): LongTermDebtFairValue /
         NotesPayableFairValueDisclosure tags the LONG-TERM debt stack,
         not short-term-plus-long-term. Dividing it by debtTotal (the
         scorecard's own combined figure) produced marks like Bank of
         America's 21.2% that read as the debt trading at a fifth of
         face, when the tag simply does not cover the short-term slice.
         Divide by the same scope the tag covers, and suppress the line
         — not disclosed — when the fair-value tag plainly covers only
         part of even that narrower base (below 60% of long-term debt),
         rather than publish a mark computed across mismatched scopes. */
      const fv = b.debtFairValue, ltd = b.longTermDebt;
      const scopeOk = isNum(fv) && isNum(ltd) && ltd > 0 && fv >= 0.6 * ltd;
      if (isNum(fv) && isNum(ltd) && ltd > 0 && !scopeOk) {
        notes.push("debt fair value (LongTermDebtFairValue) is tagged well below long-term debt outstanding, so it plainly covers only part of the debt stack; not shown as a mark on carrying value");
      }
      return {
        fairValue: fv, carryingValue: ltd,
        markPct: scopeOk ? div(fv, ltd) : null,
      };
    })(),
    costOfDebt,
    notes,
  };
}

/* ---------- universe: the covered tickers resolved against the SEC index,
   with the industry map's classification (falling back to a fresh
   classify() call only for a ticker the map does not carry) ---------- */
function loadUniverse() {
  const stub = {};
  for (const f of ["company-index.js", "coverage.js", "industry-map.js"]) {
    new Function("window", readFileSync(join(ROOT, "frontend/data", f), "utf8"))(stub);
  }
  const index = stub.COMPANY_INDEX || [];
  const covered = stub.COMPANY_COVERAGE || [];
  /* company-index.js carries more than one row for a handful of tickers
     — a listed parent and a debt-issuing finance subsidiary sharing the
     same ticker string (XOM: 34088 "EXXON MOBIL CORP" and 2115436
     "ExxonMobil Holdings Corp", the latter with no XBRL statements of its
     own) — and a naive last-one-wins Map over that array picks whichever
     happened to sort last, which for XOM is the shell. build-strategy-
     panel.mjs already solved this the same way: the industry map was
     built by resolving exactly this ambiguity (build-industry-map.mjs),
     so its cik is authoritative wherever the two disagree. */
  const byTicker = new Map(index.map((r) => [r[0], { ticker: r[0], cik: r[1], name: r[2] }]));
  const map = stub.INDUSTRY_MAP || {};
  const list = covered.map((t) => {
    const base = byTicker.get(t);
    const resolved = map[t];
    if (resolved && resolved.cik) return { ticker: t, cik: resolved.cik, name: resolved.name || (base && base.name) || t };
    return base || { ticker: t, cik: null, name: t };
  });
  return { list: LIMIT ? list.slice(0, LIMIT) : list, map, coveredCount: covered.length };
}

function classification(ticker, cik, map) {
  const meta = map[ticker];
  if (meta) return { industry: meta.industry || "Unclassified", sector: meta.sector || "Other", sic: meta.sic || null };
  /* not in the pre-built map: classify() needs a sic, which this file has
     no fresh source for without another SEC round trip, so the fallback
     is the same "no sic" branch classify() itself defines rather than a
     second network call for a case build-strategy-panel.mjs has not hit
     either (every one of the 137 covered tickers is in the map today) */
  const c = classify(null, null, cik);
  return { industry: c.industry, sector: c.sector, sic: null };
}

/**
 * Tag-coverage counts over the rows this run actually produced (FIXER
 * ROUND 2): how many of the covered companies carry a next-twelve-month
 * operating lease figure, a revolver-capacity figure, and a tagged
 * maturity ladder. Exported so scripts/test-underwriting-panel.mjs can
 * assert on it against the concepts stage's own committed fixtures
 * without a live pull.
 */
export function computeCoverage(companies) {
  const rows = Object.values(companies);
  const count = (pred) => rows.reduce((n, r) => n + (pred(r) ? 1 : 0), 0);
  return {
    total: rows.length,
    leasePaymentsDueTagged: count((r) => isNum(r.liquidity && r.liquidity.leasePaymentsDue)),
    revolverCapacityTagged: count((r) => isNum(r.liquidity && r.liquidity.revolverCapacity)),
    maturityLadderTagged: count((r) => r.maturityLadder && r.maturityLadder.tagged === true),
  };
}

function writeIfChanged(path, text) {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  writeFileSync(path, text, "utf8");
  return true;
}

let nextSlot = 0;
async function paced() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 130;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

async function fetchFacts(cik) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await paced();
    try {
      const r = await fetch(
        `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`,
        { headers: UA });
      if (r.ok) return { facts: await r.json() };
      lastErr = `HTTP ${r.status}`;
      if (r.status === 404) return { error: lastErr };
      await new Promise((res) => setTimeout(res, 700 * Math.pow(2, attempt)));
    } catch (e) {
      lastErr = e.message;
      await new Promise((res) => setTimeout(res, 700 * Math.pow(2, attempt)));
    }
  }
  return { error: lastErr };
}

async function main() {
  let universe;
  try {
    universe = loadUniverse();
  } catch (e) {
    console.error(`build-underwriting-panel: could not resolve the universe: ${e.message}`);
    process.exit(2);
  }
  const { list, map, coveredCount } = universe;
  if (!list.length) {
    console.error("build-underwriting-panel: COMPANY_COVERAGE is empty");
    process.exit(2);
  }
  console.log(`underwriting panel: ${list.length} of ${coveredCount} covered companies`);

  const companies = {};
  let usable = 0;
  const failures = [];
  const empty = (ticker, name, sector) => buildRow({ annual: [], quarterly: [], ltm: [] }, ticker, name, sector);
  for (const c of list) {
    /* FIXER ROUND 1: sector is resolved BEFORE buildRow now, and passed
       into it — buildRow's own sectorLadderCaveat()/SECTORS_WITHOUT_
       CORPORATE_LADDER gate was wired to a `sector` parameter that main()
       never actually supplied, so every bank, insurer, REIT and utility
       still got a full S&P band placement and covenant headroom despite
       the gate existing in code. classification() only needs ticker/cik/
       the industry map, none of which depend on the companyfacts pull, so
       moving it earlier costs nothing. */
    const cls = classification(c.ticker, c.cik, map);
    let row;
    if (!c.cik) {
      row = empty(c.ticker, c.name, cls.sector);
      row.notes = ["ticker not found in the SEC index (frontend/data/company-index.js)", ...row.notes];
      failures.push(`${c.ticker} not in company-index.js`);
      process.stdout.write("x");
    } else {
      const { facts, error } = await fetchFacts(c.cik);
      if (error) {
        row = empty(c.ticker, c.name, cls.sector);
        row.notes = [`companyfacts pull failed: ${error}`, ...row.notes];
        failures.push(`${c.ticker} ${error}`);
        process.stdout.write("x");
      } else {
        const bucket = facts && facts.facts && facts.facts["us-gaap"];
        if (!bucket) {
          row = empty(c.ticker, c.name, cls.sector);
          row.notes = ["no us-gaap facts in this filer's companyfacts feed", ...row.notes];
          failures.push(`${c.ticker} no us-gaap`);
          process.stdout.write("x");
        } else {
          try {
            const statements = buildStatements(bucket);
            row = buildRow(statements, c.ticker, c.name, cls.sector);
            if (row.basis) usable++;
            process.stdout.write(row.basis ? "." : "o");
          } catch (e) {
            row = empty(c.ticker, c.name, cls.sector);
            row.notes = [`buildStatements/buildRow threw: ${e.message}`, ...row.notes];
            failures.push(`${c.ticker} ${e.message}`);
            process.stdout.write("x");
          }
        }
      }
    }
    companies[c.ticker] = { cik: c.cik, industry: cls.industry, sector: cls.sector, sic: cls.sic, ...row };
  }
  process.stdout.write("\n");

  const payload = {
    schemaVersion: 1,
    /* The Underwriting view prints this string in a tile footer, so it
       names the source a reader cares about and nothing else: no builder
       script path, no internal blueprint section number. */
    source: "SEC EDGAR XBRL companyfacts",
    n: list.length,
    /* FIXER ROUND 2: the frontend's own catalog popups used to quote the
       130-company probe's tag-coverage counts (lease payments due "103",
       revolver capacity "11", the maturity ladder "90") from memory —
       stale against this file's own 137-row output (35, 6 and 101
       respectively) and, for the ladder, off by 11 rows. Computed here,
       once, from the rows this run actually produced, so the popups read
       this file's own count rather than a probe from a different run. */
    coverage: computeCoverage(companies),
    companies,
  };
  const text = JSON.stringify(payload, null, 1) + "\n";
  const sizeKB = (Buffer.byteLength(text, "utf8") / 1024).toFixed(0);
  const changed = writeIfChanged(OUT_FILE, text);
  console.log(`${changed ? "wrote" : "unchanged"} frontend/data/underwriting.json — ${sizeKB}KB, ${usable}/${list.length} with a usable period`);
  if (Number(sizeKB) > 300) {
    console.log(`underwriting.json is ${sizeKB}KB, past the "a few hundred KB" mark the task calls out for chunking — ` +
      "left as one file for now since the page owner has not yet said how it wants to page-load this view; flagged for a follow-up rather than chunked speculatively here.");
  }
  if (failures.length) console.log(`failures (${failures.length}): ${failures.slice(0, 20).join(", ")}`);

  if (usable === 0) process.exit(1);
  process.exit(0);
}

/* run only when invoked directly, so scripts/test-underwriting-panel.mjs
   can import buildRow without pulling live data */
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
