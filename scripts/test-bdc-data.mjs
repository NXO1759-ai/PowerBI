/**
 * test-bdc-data.mjs — the committed BDC data files, offline.
 *
 * refresh-bdc.mjs writes frontend/data/bdc/ from live EDGAR; this reads
 * what was committed and holds it to the acceptance list of blueprint
 * 10.1: a universe of about fifty filers, every one with an 814- file
 * number and a fiscal year end, the anchors present, FRBP quoted OTC;
 * the three named company files parse with a positive NAV per share;
 * Prospect's quarters labeled by calendar date; coverage of at least
 * forty filers for the four scorecard metrics; provenance on every
 * value; and the guards' contract (no NAV at or below zero, no
 * differenced value labelled YTD, no company file for a ticker outside
 * the universe). Nothing here touches the network, so it runs on every
 * push.
 *
 * The figures asserted are structural (counts, presence, shape), never
 * a filed value: those are pinned against fixtures in test-bdc-series.mjs,
 * and a committed data file changes every Sunday.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BDC_CONCEPTS, largeGap } from "./lib/bdc-concepts.mjs";

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../frontend/data/bdc");
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const parse = (file) => {
  try { return JSON.parse(readFileSync(join(DIR, file), "utf8")); } catch { return null; }
};

if (!existsSync(DIR)) {
  console.log(`  FAIL ${DIR} does not exist — run node scripts/refresh-bdc.mjs first`);
  process.exit(1);
}

/* ---------- universe ---------- */

const universe = parse("universe.json");
check("universe.json parses", !!universe && Array.isArray(universe.rows));
const rows = universe && Array.isArray(universe.rows) ? universe.rows : [];
check("between 45 and 60 listed BDCs", rows.length >= 45 && rows.length <= 60, String(rows.length));
check("the rule is the 814- file number", universe && universe.rule === "814-");
check("every row has an 814- file number",
  rows.every((r) => Array.isArray(r.fileNumbers) && r.fileNumbers.some((f) => /^814-\d+$/.test(f))),
  rows.filter((r) => !(r.fileNumbers || []).some((f) => /^814-/.test(f))).map((r) => r.ticker).join(","));
check("every row has a fiscal year end month 1-12",
  rows.every((r) => Number.isInteger(r.fyEndMonth) && r.fyEndMonth >= 1 && r.fyEndMonth <= 12),
  rows.filter((r) => !(Number.isInteger(r.fyEndMonth) && r.fyEndMonth >= 1 && r.fyEndMonth <= 12)).map((r) => r.ticker).join(","));
check("every row carries cik, ticker and name",
  rows.every((r) => Number.isInteger(r.cik) && r.cik > 0 && typeof r.ticker === "string" && r.ticker && typeof r.name === "string" && r.name));
check("tickers are unique", new Set(rows.map((r) => r.ticker)).size === rows.length);
const byTicker = new Map(rows.map((r) => [r.ticker, r]));
for (const t of ["ARCC", "GSBD", "BXSL"]) check(`${t} is in the universe`, byTicker.has(t));
const frbp = byTicker.get("FRBP");
check("FRBP is quoted OTC, not listed", !!frbp && frbp.otc === true && frbp.listed === false,
  frbp && `${frbp.exchange} listed=${frbp.listed} otc=${frbp.otc}`);
check("every other row is listed or OTC, never neither",
  rows.every((r) => r.listed === true || r.otc === true));
/* the nine non-calendar filers of blueprint 4.1, where the universe has them */
const NON_CALENDAR = { GBDC: 9, OCSL: 9, PFLT: 9, PNNT: 9, GLAD: 9, CSWC: 3, GAIN: 3, PSEC: 6, SAR: 2 };
check("the non-calendar filers carry their own year-end month",
  Object.entries(NON_CALENDAR).every(([t, m]) => !byTicker.has(t) || byTicker.get(t).fyEndMonth === m),
  Object.entries(NON_CALENDAR).filter(([t, m]) => byTicker.has(t) && byTicker.get(t).fyEndMonth !== m).map(([t]) => t).join(","));
check("the merger table travels with the universe",
  Array.isArray(universe && universe.mergers) && universe.mergers.length >= 10 &&
  universe.mergers.every((m) => m.acquirer && m.closeQuarter && m.source));

/* ---------- company files ---------- */

const KEYS = Object.keys(BDC_CONCEPTS);
for (const t of ["ARCC", "MAIN", "PSEC"]) {
  const c = parse(`company-${t}.json`);
  check(`company-${t}.json parses`, !!c && c.ticker === t && c.series && Array.isArray(c.series.periods));
  if (!c) continue;
  const nav = c.series.latest && c.series.latest.navPerShare;
  check(`${t} latest NAV per share is finite and positive`,
    !!nav && typeof nav.v === "number" && isFinite(nav.v) && nav.v > 0, nav && String(nav.v));
  check(`${t} latest filing is a periodic report with its accession`,
    !!c.latestFiling && /^(10-K|10-Q)(\/A)?$/.test(c.latestFiling.form) && isDate(c.latestFiling.filed) && !!c.latestFiling.accn);
}
const psec = parse("company-PSEC.json");
if (psec) {
  const periods = psec.series.periods;
  const last = periods[periods.length - 1];
  check("PSEC's latest period is labeled by a calendar date", !!last && isDate(last.end), last && last.end);
  check("PSEC closes its year in June and its June quarters are the fourth",
    psec.fyEndMonth === 6 && periods.every((p) => isDate(p.end) && (p.end.slice(5, 7) !== "06" || p.fq === 4)));
  check("PSEC periods are ascending and at most 32", periods.length <= 32 &&
    periods.every((p, i) => i === 0 || p.end > periods[i - 1].end));
}

/* every file in the directory: provenance on every value, nothing
   unserializable leaked into the text, the guards' contract held (no
   NAV at or below zero; debt never above liabilities; cost never a
   fraction of assets; a share count never a hundred times its
   outstanding count; a per-share figure its NII rejected never served
   as tagged; every series says where it starts) */
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
let leaks = [], badValues = [], badNumbers = [], badLabels = [], badNav = [], strays = [], companyFiles = 0;
let debtOver = [], costUnder = [], sharesOff = [], perShareKept = [], noFirst = [];
for (const f of files) {
  const text = readFileSync(join(DIR, f), "utf8");
  if (/undefined|NaN/.test(text)) leaks.push(f);
  if (!f.startsWith("company-")) continue;
  const c = parse(f);
  if (!c) { badValues.push(f + " (unparseable)"); continue; }
  companyFiles++;
  if (!byTicker.has(c.ticker) || f !== `company-${c.ticker}.json`) strays.push(f);
  const values = [];
  for (const p of c.series.periods) for (const [k, v] of Object.entries(p.values)) if (v) values.push([k, v, p.end]);
  for (const [k, v] of Object.entries(c.series.latest || {})) if (v) values.push([k, v, "latest"]);
  for (const [k, v, end] of values) {
    if (typeof v.tag !== "string" || !v.tag || !isDate(v.end) || typeof v.source !== "string" || !v.source ||
        typeof v.periodType !== "string" || typeof v.unit !== "string") {
      badValues.push(`${c.ticker} ${end} ${k}`);
    }
    if (typeof v.v !== "number" || !isFinite(v.v)) badNumbers.push(`${c.ticker} ${end} ${k}`);
    if (!KEYS.includes(k)) badValues.push(`${c.ticker} ${end} ${k} (not a concept)`);
    if (v.periodType === "YTD" && v.differenced) badLabels.push(`${c.ticker} ${end} ${k}`);
    if (v.differenced && !v.derived) badLabels.push(`${c.ticker} ${end} ${k} (no derived marker)`);
    if (k === "navPerShare" && typeof v.v === "number" && v.v <= 0) badNav.push(`${c.ticker} ${end}`);
  }
  for (const p of c.series.periods) {
    const x = p.values;
    if (x.debt && x.liabilities && x.debt.v > x.liabilities.v) debtOver.push(`${c.ticker} ${p.end}`);
    if (x.portfolioCost && x.totalAssets && x.portfolioCost.v < 0.5 * x.totalAssets.v) costUnder.push(`${c.ticker} ${p.end}`);
    if (x.weightedShares && x.sharesOutstanding && x.weightedShares.v >= 100 * x.sharesOutstanding.v) sharesOff.push(`${c.ticker} ${p.end}`);
    /* the per-share rule: a difference of two rows that fails is
       replaced by NII over shares, so is every failing quarter of a
       filer whose tag is off by a large gap in two or more quarters;
       a filer-reported fact a cent or two off is kept with the
       implied figure recorded beside it */
    const cc = x.niiAfterTax && x.niiAfterTax.crossCheck;
    const ps = x.niiPerShare;
    if (cc && cc.basis === "perShare" && cc.reconciles === false && ps && ps.derived !== "nii-over-shares") {
      const large = c.series.flags.filter((g) => g.key === "niiAfterTax" && g.basis === "perShare" && !g.sharesEstimate &&
        Number.isFinite(g.perShare) && Number.isFinite(g.implied) && largeGap(g.perShare, g.implied)).length >= 2;
      if (ps.differenced && !cc.sharesEstimate) perShareKept.push(`${c.ticker} ${p.end} (a difference kept)`);
      else if (large && !cc.sharesEstimate) perShareKept.push(`${c.ticker} ${p.end} (an unsettled tag kept)`);
      else if (!ps.crossCheck || ps.crossCheck.reconciles !== false) perShareKept.push(`${c.ticker} ${p.end} (no implied figure recorded)`);
    }
  }
  const first = c.series.firstPeriod || {};
  for (const k of KEYS) {
    const served = c.series.periods.find((p) => p.values[k]);
    if (served && !(isDate(first[k]) && first[k] <= served.end)) noFirst.push(`${c.ticker} ${k}`);
  }
}
check("a company file exists for most of the universe", companyFiles >= rows.length - 5, `${companyFiles} of ${rows.length}`);
check("no company file belongs to a ticker outside the universe", !strays.length, strays.join(","));
check("no value object lacks tag, end, source, periodType or unit", !badValues.length, badValues.slice(0, 5).join("; "));
check("every value is a finite number", !badNumbers.length, badNumbers.slice(0, 5).join("; "));
check("a differenced value is never labelled YTD and always says how it was derived", !badLabels.length, badLabels.slice(0, 5).join("; "));
check("no NAV per share at or below zero is served", !badNav.length, badNav.slice(0, 5).join("; "));
check("no debt above total liabilities is served", !debtOver.length, debtOver.slice(0, 5).join("; "));
check("no portfolio cost below half of total assets is served", !costUnder.length, costUnder.slice(0, 5).join("; "));
check("no weighted share count a hundred times its outstanding count is served", !sharesOff.length, sharesOff.slice(0, 5).join("; "));
check("a per-share figure its NII rejected is NII over shares where it is a difference or the tag is off by a large gap, else carries the implied figure",
  !perShareKept.length, perShareKept.slice(0, 5).join("; "));
check("every series says where each concept starts, no later than its first served quarter", !noFirst.length, noFirst.slice(0, 5).join("; "));
check("no file contains 'undefined' or 'NaN'", !leaks.length, leaks.join(","));

/* ---------- coverage ---------- */

const coverage = parse("coverage.json");
check("coverage.json parses", !!coverage && coverage.metrics && coverage.byTicker);
if (coverage && coverage.metrics) {
  check("coverage counts the universe", coverage.n === rows.length, `${coverage.n} vs ${rows.length}`);
  const CORE = ["navPerShare", "portfolioFairValue", "portfolioCost", "niiAfterTax"];
  check("the four scorecard keys are concepts", CORE.every((k) => BDC_CONCEPTS[k]));
  for (const k of CORE) {
    const m = coverage.metrics[k];
    check(`${k} current for at least 40 of ${rows.length}`, !!m && m.n >= 40, m && `${m.n}`);
  }
  check("every concept has a coverage row with its flagged list", KEYS.every((k) => coverage.metrics[k] && Number.isInteger(coverage.metrics[k].n) &&
    Array.isArray(coverage.metrics[k].tickers_flagged)));
  check("byTicker records tag, period type, end, source and the series' first period",
    Object.values(coverage.byTicker).every((entries) => Object.values(entries).every((e) =>
      typeof e.tag === "string" && typeof e.periodType === "string" && isDate(e.end) && typeof e.source === "string" &&
      isDate(e.firstPeriod) && e.firstPeriod <= e.end)));
  /* a flag on a filer's newest quarter lists it as flagged, served or not */
  check("a ticker flagged on its newest quarter is listed under tickers_flagged and not counted current",
    Object.entries(coverage.byTicker).every(([t, entries]) => Object.entries(entries).every(([k, e]) =>
      !e.flagged || (coverage.metrics[k].tickers_flagged.includes(t)))));
  check("a byTicker entry labelled YTD is never a differenced value, and a differenced one says how it was derived",
    Object.values(coverage.byTicker).every((entries) => Object.values(entries).every((e) =>
      !(e.periodType === "YTD" && e.differenced) && (!e.differenced || typeof e.derived === "string"))));
}

console.log(failed ? `\n${failed} bdc-data check(s) failed` : "\nall bdc-data checks pass");
process.exit(failed ? 1 : 0);
