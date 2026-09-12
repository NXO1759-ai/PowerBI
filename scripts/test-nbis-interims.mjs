/**
 * test-nbis-interims.mjs — the untagged-report parser against Nebius
 * Group's 6-K interim reports, and the hand-keyed table that the capex
 * panel reads for the quarters companyfacts lacks.
 *
 * Nebius (CIK 1513845) tags its 20-F and nothing else, so its quarters
 * exist only as HTML tables in the EX-99.2 of each interim-report 6-K.
 * frontend/data/nbis-interims.json is keyed by hand from those exhibits,
 * as printed, one row set per accession; the fixtures under
 * scripts/fixtures/nbis/ are the statement pages of the same exhibits,
 * verbatim. This test proves three things:
 *
 *   1. every hand-keyed line is reproduced by interim-parse.mjs from the
 *      fixture within rounding (the exhibits print one decimal of
 *      millions, so 0.05 million);
 *   2. the derived quarters (half-year minus first quarter) agree with
 *      the hand-keyed derived rows, which the same-day press release
 *      confirms to the dollar for capex and investing cash flow;
 *   3. the parsed facts build periods the way a tagged filer's would —
 *      a Q1 2026 quarter and a 2026-06-30 half-year with the statement
 *      lines in place, form 6-K, so the panel builder needs no special
 *      path for Nebius beyond reading the file.
 *
 * Every figure asserted here is in the JSON, with its accession; none is
 * typed twice.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractInterimFacts, looksLikeStatements, factsToBucket } from "./lib/interim-parse.mjs";
import { buildStatements, fiscalYearFor, fiscalQuarterFor } from "./lib/statements.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const table = JSON.parse(readFileSync(join(ROOT, "frontend/data/nbis-interims.json"), "utf8"));

let failed = 0, passed = 0;
const check = (name, ok, detail) => {
  if (ok) passed++; else failed++;
  if (!ok || process.argv.includes("--verbose")) {
    console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  }
};
const MILLION = 1e6;
const ROUNDING = 0.05;          /* one decimal of millions, as printed */
const DERIVED_ROUNDING = 0.3;   /* two printed figures subtracted */
const near = (a, b, tol) => a !== undefined && a !== null && Math.abs(a - b) <= tol + 1e-9;

check("the table names the filer", table.ticker === "NBIS" && table.cik === 1513845);
check("every report carries an accession, exhibit and fixture",
  table.reports.every((r) => /^\d{10}-\d{2}-\d{6}$/.test(r.accession) && r.exhibit && r.fixture && r.form === "6-K"));
check("the two 6-Ks of 2026-08-12 are told apart by accession",
  table.reports.some((r) => r.accession === "0001104659-26-094844" && r.sameDayFiling &&
    r.sameDayFiling.accession === "0001104659-26-094568"));

const parsedByAccession = {};
for (const report of table.reports) {
  const html = readFileSync(join(ROOT, report.fixture), "utf8");
  check(`${report.accession}: the fixture is recognised as statements`, looksLikeStatements(html));
  const facts = extractInterimFacts(html);
  parsedByAccession[report.accession] = facts;
  const find = (concept, start, end) =>
    facts.find((f) => f.concept === concept && (f.start || null) === start && f.end === end);

  for (const [kind, periods] of Object.entries(report.statements)) {
    for (const period of periods) {
      const start = period.start || null;
      for (const [concept, printed] of Object.entries(period.lines)) {
        const f = find(concept, start, period.end);
        const got = f ? f.val / MILLION : undefined;
        check(`${report.accession} ${kind} ${start || "instant"}..${period.end} ${concept} = ${printed}`,
          near(got, printed, ROUNDING), f ? `parsed ${got}` : "not parsed");
        if (f) {
          check(`${report.accession} ${concept} is a ${kind === "balanceSheet" ? "balance-sheet" : "duration"} fact in USD`,
            f.kind === kind && f.unit === "USD" && (kind === "balanceSheet" ? !f.start : !!f.start));
          check(`${report.accession} ${concept} carries a tag`, typeof f.tag === "string" && f.tag.length > 0, f.tag);
        }
      }
      /* a line the filer prints without its qualifier is not guessed */
      for (const concept of Object.keys(period.notParsed || {})) {
        check(`${report.accession} ${concept} at ${period.end} is left to the hand-keyed row`,
          !find(concept, start, period.end));
      }
    }
  }
  /* nothing dated outside the report and its comparatives */
  const ends = facts.map((f) => f.end);
  check(`${report.accession}: every parsed period ends in 2025 or on the report date`,
    ends.every((e) => e >= "2025-01-01" && e <= report.reportDate));
  /* the scale is millions: a figure that is plainly not in thousands */
  const cash = find("cash", null, report.reportDate);
  check(`${report.accession}: figures are scaled from millions`, !!cash && cash.val > 1e9, cash && String(cash.val));
}

/* derived quarters: half-year minus first quarter, from the parsed facts */
const q1 = parsedByAccession["0001104659-26-064092"];
const h1 = parsedByAccession["0001104659-26-094844"];
const val = (facts, concept, start, end) => {
  const f = facts.find((x) => x.concept === concept && x.start === start && x.end === end);
  return f ? f.val / MILLION : 0;   /* a line the earlier report does not print is nil */
};
for (const d of table.derivedQuarters) {
  const y = d.end.slice(0, 4);
  for (const [concept, printed] of Object.entries(d.lines)) {
    const h = val(h1, concept, `${y}-01-01`, d.end);
    const q = val(q1, concept, `${y}-01-01`, `${y}-03-31`);
    check(`derived ${d.start}..${d.end} ${concept} = ${printed} (H1 ${h} − Q1 ${q})`,
      near(h - q, printed, DERIVED_ROUNDING), String(Math.round((h - q) * 10) / 10));
  }
}

/* the printed check on the arithmetic: the same-day earnings release
   (the other 6-K of 2026-08-12) prints the three-month cash-flow
   columns the interim report does not, and the parser reads them from
   its own fixture */
const pq = table.printedQuarters;
check("the printed quarters come from the other 6-K of 2026-08-12",
  !!pq && pq.accession === "0001104659-26-094568" && pq.exhibit === "EX-99.1" && !!pq.fixture);
const releaseHtml = readFileSync(join(ROOT, pq.fixture), "utf8");
check(`${pq.accession}: the release page is recognised as statements`, looksLikeStatements(releaseHtml));
const release = extractInterimFacts(releaseHtml);
check(`${pq.accession}: the release is scaled from millions`,
  release.some((f) => f.concept === "cfOps" && Math.abs(f.val) > 1e8));
for (const d of table.derivedQuarters) {
  for (const [concept, printed] of Object.entries(d.lines)) {
    const f = release.find((x) => x.concept === concept && x.start === d.start && x.end === d.end);
    const got = f ? f.val / MILLION : undefined;
    check(`${pq.accession} prints ${d.start}..${d.end} ${concept} = ${printed}`,
      near(got, printed, ROUNDING), f ? `parsed ${got}` : "not parsed");
  }
  /* and the six-month columns of the release agree with the interim report */
  const y = d.end.slice(0, 4);
  for (const concept of Object.keys(d.lines)) {
    const a = release.find((x) => x.concept === concept && x.start === `${y}-01-01` && x.end === d.end);
    const b = h1.find((x) => x.concept === concept && x.start === `${y}-01-01` && x.end === d.end);
    if (a && b) check(`${pq.accession} and 0001104659-26-094844 agree on the six months ${concept}`,
      Math.abs(a.val - b.val) <= ROUNDING * MILLION, `${a.val} vs ${b.val}`);
  }
}

/* the same figures through the period builder, the way a tagged filer's
   would travel: the Q1 report becomes a Q1 2026 quarter; the half-year
   report a 2026-06-30 period whose income statement is the quarter's */
const meta = (r) => ({ form: "6-K", filed: r.filed, accn: r.accession, fyEndMonth: table.fiscalYearEndMonth });
const q1Report = table.reports.find((r) => r.accession === "0001104659-26-064092");
const bucket = factsToBucket(q1, meta(q1Report), fiscalYearFor, fiscalQuarterFor);
const s = buildStatements(bucket, { fyEndMonth: table.fiscalYearEndMonth });
const p1 = s.quarterly.find((p) => p.periodEnd === "2026-03-31");
const keyed = (acc, kind, start, end) => table.reports.find((r) => r.accession === acc)
  .statements[kind].find((p) => (p.start || null) === start && p.end === end).lines;
const q1cf = keyed("0001104659-26-064092", "cashFlow", "2026-01-01", "2026-03-31");
const q1is = keyed("0001104659-26-064092", "incomeStatement", "2026-01-01", "2026-03-31");
const q1bs = keyed("0001104659-26-064092", "balanceSheet", null, "2026-03-31");
check("a Q1 2026 period is built from the Q1 report", !!p1 && p1.fiscalPeriod === "Q1" && p1.form === "6-K", p1 && p1.label);
check("the quarter carries the income statement",
  !!p1 && near(p1.incomeStatement.revenue / MILLION, q1is.revenue, ROUNDING) &&
  near(p1.incomeStatement.netIncome / MILLION, q1is.netIncome, ROUNDING));
check("the quarter carries the balance sheet",
  !!p1 && near(p1.balanceSheet.totalAssets / MILLION, q1bs.totalAssets, ROUNDING) &&
  near(p1.balanceSheet.cash / MILLION, q1bs.cash, ROUNDING));
check("the quarter carries operating cash flow and capex, printed sign kept",
  !!p1 && near(p1.cashFlow.cfOps / MILLION, q1cf.cfOps, ROUNDING) &&
  near(p1.cashFlow.capex / MILLION, q1cf.capex, ROUNDING),
  p1 && `${p1.cashFlow.cfOps} ${p1.cashFlow.capex}`);

/* the tagged anchor the quarters hang from */
const anchor = table.taggedAnchors.find((a) => a.concept === "PaymentsToAcquirePropertyPlantAndEquipment");
check("the FY2025 capex anchor is the 20-F's tagged value, with its accession",
  !!anchor && anchor.value === 4066.0 && anchor.form === "20-F" && anchor.accession === "0001104659-26-052948");

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed ? `${failed} failed` : "all nbis-interims checks pass");
process.exit(failed ? 1 : 0);
