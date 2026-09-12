/**
 * refresh-bdc.mjs — the weekly refresh of the BDC layer.
 *
 *   node scripts/refresh-bdc.mjs [--ticker ARCC[,BXSL,...]] [--limit N] [--out DIR] [--quarter CY2026Q2]
 *                              [--holdings-only] [--skip-holdings] [--composite-only]
 *                              [--force-holdings] [--source dataset|instance] [--cache DIR]
 *
 * Regenerates the listed-BDC universe from EDGAR, pulls each filer's whole
 * companyfacts feed, merges the calendar-quarter frames where they run
 * ahead of it, and writes under frontend/data/bdc/:
 *
 *   universe.json          the 814-rule universe, with the merger table,
 *                          acSource and sbaExempt per row
 *   company-<TICKER>.json  the quarterly series per filer, every value
 *                          carrying its tag, period, filing and source;
 *                          plus `disclosed`, the figures the latest
 *                          filing states in prose (blueprint 4.2), with
 *                          the sentence beside each
 *   holdings-<TICKER>.json the schedule of investments of the latest
 *                          filing, one row per loan, once the
 *                          reconciliation gate passed (contract H2)
 *   composite.json         the composite across every filer with a
 *                          passed gate, weighted by cost of third-party
 *                          debt, n on every figure (contract H3)
 *   coverage.json          which metric each filer tags, and how current;
 *                          the `holdings` block says whose schedule was
 *                          written, refused or left unchanged, and why
 *   refresh-report.json    what was attempted, written and skipped
 *
 * The holdings stage (blueprint 7.3, PR C) runs after the company files,
 * for every filer whose latest 10-Q or 10-K accession differs from the
 * committed holdings file's — a week without a new filing downloads
 * nothing. Per filer: the schedule comes from the SEC's monthly BDC
 * data set (YYYY_MM_bdc.zip for the filing month and the next, streamed
 * to .cache/bdc/, re-downloaded only when the remote changed) through
 * readSoiDataset, or from the filing's own -xbrl.zip instance through
 * parseSoiInstance when no monthly zip carries it yet; the rows are
 * reconciled against InvestmentOwnedAtCost and InvestmentOwnedAtFairValue
 * within 0.5% (the gate), and a filing that fails gets no holdings file
 * — the refusal, with its sums, goes into refresh-report.json and
 * coverage.json. The gate tries the tagged rows as read, then with the
 * cost-only rows (a written-off loan the filer tags without a fair
 * value) and the cash-equivalent lines; then the cost-only rows with
 * the printed fair value; then the tagged rows plus the printed rows
 * no tagged holding claims (a filer that tags part of its schedule
 * without a per-position identifier, GBDC's affiliated equity), each
 * added row flagged src.row "table"; then the printed schedule alone
 * (a filer whose tagged rows carry a vehicle's loans beside its own).
 * The first set that reconciles is the schedule; every set tried is
 * recorded with its sums. The filing's main document (cached under
 * .cache/bdc/docs/, shared with build-bdc-terms.mjs) supplies the HTML
 * schedule for the maturity date, the industry, the non-accrual footnote
 * and the lien section, joined on issuer and principal; the rendered
 * R page named in FilingSummary.xml is the second source for non-accrual
 * and industry when the table gave none. The prose extractor runs on the
 * same document and its fields go under the company file's `disclosed`
 * key, the asset coverage resolved tag → prose → formula with acSource.
 * Then the composite is rebuilt from every holdings file on disk.
 *
 * --holdings-only skips the universe and company pulls and reads the
 * committed universe and company files; --skip-holdings stops after the
 * company files; --composite-only rebuilds composite.json from the files
 * on disk with no request; --force-holdings redoes a filer whose
 * accession has not changed; --source instance forces the instance path
 * (a check of the fallback while every filing sits in a monthly zip).
 *
 * The universe is never copied from a file: it is rebuilt every run from
 * the filers that tag a portfolio and a NAV per share in the latest
 * settled quarter's frames, plus the SEC's BDC roster as a cross-check,
 * kept only where the CIK maps to a ticker and its filings carry an
 * 814- file number (blueprint 4.1). The pages read the JSON statically;
 * nothing here is served by a function.
 *
 * Zero dependencies. Every EDGAR request goes through the paced getJson
 * in sec-pull.mjs with SEC_UA; the one non-EDGAR call, Yahoo's chart
 * for the listing date, carries the same declared User-Agent (blueprint
 * 13 asks for an explicit one, and the site's convention is a research
 * contact, not a browser string).
 *
 * After a full run a company file whose ticker has left the universe
 * (PTMN became BCIC, SSSS became NSLR) is removed and the removal
 * recorded in refresh-report.json; the workflow's `git add frontend/data`
 * stages the deletion. A filer EDGAR did not answer for is not a filer
 * that left: a submissions call or the roster CSV that returned nothing
 * is a finding, and the removal pass is skipped for the run, so a
 * transient failure never deletes a committed file (the deletions
 * guard of the house rules).
 *
 * Exit codes: 0 for a run that wrote at least one company file, whatever
 * it found on the way; 1 for a run that wrote nothing; 2 when the pull
 * itself failed. The universe, anchor and coverage checks are warnings
 * in the report and the step summary, never a reason to discard the
 * week's refresh: this step runs inside the weekly job before the
 * commit, and an EDGAR hiccup here must not throw away the
 * operating-company pull that finished before it. The same rules are
 * enforced as hard failures on the committed files by
 * scripts/test-bdc-data.mjs in the smoke suite.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SEC_UA, paced, fetchCompanyFactsRaw, fetchFrame, fetchSubmissions,
  fetchCompanyTickers, rateLimitHits,
} from "./lib/sec-pull.mjs";
import {
  BDC_CONCEPTS, buildBdcSeries, mergeFrames, chooseNii, niiSkipNote, niiOverShares, sharesOffScale,
  NII_SKIP_MIN_QUARTERS, MERGERS, largeGap,
} from "./lib/bdc-concepts.mjs";
import {
  readSoiDataset, readSubmissions, readNumFacts, unfundedFromFacts, totalsFromFacts, parseSoiInstance,
  reconcile, attachUnfunded, UNFUNDED_TAG, COST_TAG, FV_TAG, GATE_TOLERANCE, refineNames,
} from "./lib/soi-parse.mjs";
import { downloadToFile, readCentralDirectory, streamMember } from "./lib/zip-stream.mjs";
import { parseScheduleTables, issuerKey } from "./lib/soi-html.mjs";
import { findScheduleReport, parseRPage } from "./lib/rpage.mjs";
import { extractProse } from "./lib/bdc-prose.mjs";
import {
  RTCredit, CREDIT_VERSION, enrichFromTable, enrichFromRPage, summarizeHoldings, buildComposite,
  resolveAssetCoverage, compactHolding, expandHolding, HOLDING_LEGEND, applyFilerOverrides, holdingsFromTable, tableOnlyHoldings, fillFairValueFromTable, fillFromTagged, sanitizeRates,
} from "./lib/bdc-composite.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DAY_MS = 86400000;

/* ---------- arguments ---------- */
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const LIMIT = Number(arg("limit", "0")) || 0;
/* one ticker, or a comma-separated few (a debugging run over the
   filers a gate refused reads each monthly zip once for all of them) */
const ONLY = (arg("ticker", "") || "").toUpperCase();
const ONLY_SET = new Set(ONLY.split(",").map((t) => t.trim()).filter(Boolean));
const OUT_DIR = resolve(arg("out", join(ROOT, "frontend/data/bdc")));
const QUARTER_ARG = arg("quarter", "");
const HOLDINGS_ONLY = argv.includes("--holdings-only");
const SKIP_HOLDINGS = argv.includes("--skip-holdings");
const COMPOSITE_ONLY = argv.includes("--composite-only");
const FORCE_HOLDINGS = argv.includes("--force-holdings");
const SOURCE_ARG = arg("source", "auto");
/* the environment variable and --cache DIR name the same directory the
   same way: the path given IS the cache root, never its parent */
const CACHE_DIR = resolve(process.env.BDC_CACHE_DIR || arg("cache", join(ROOT, ".cache/bdc")));
/* a run over part of the universe is a debugging run: it writes its
   company files but never a coverage file that would count the rest of
   the universe as missing */
const PARTIAL = Boolean(ONLY || LIMIT);
if (!/^(auto|dataset|instance)$/.test(SOURCE_ARG)) {
  console.error(`refresh-bdc: --source must be auto, dataset or instance, not ${SOURCE_ARG}`);
  process.exit(2);
}

/* Quarter ends kept per filer: the builder's 32. Every value carries its
   own provenance, about 290 bytes each, so a long-history filer runs to
   170 KB and the directory to about 9 MB for the universe, loaded one
   filer at a time. The plan allows no shorter window, and each series
   states where it starts (firstPeriod) whatever the window keeps. */
const QUARTERS_KEPT = 32;

/* The roster the SEC publishes from BDC filing activity. It omits ARCC,
   TSLX, TRIN, GLAD and GECC, so it is a cross-check that adds a listed
   BDC the frames missed (GSBD), never a filter. */
const ROSTER_URL = "https://www.sec.gov/files/investment/data/other/" +
  "business-development-company-report/business-development-company-2026.csv";

/* A NAV frame with fewer filers than this has not seen the quarter's
   10-Q wave yet (CY2026Q2I held 314 on 2026-09-11), so the run reads
   the quarter before. */
const MIN_FRAME_FILERS = 100;
const REPORT_FORM = /^(10-K|10-Q)(\/A)?$/;

/* ---------- calendar ---------- */

const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const quarterEnd = (label) => {
  const m = /^CY(\d{4})Q([1-4])$/.exec(label || "");
  return m ? monthEnd(Number(m[1]), Number(m[2]) * 3) : null;
};
const previousQuarter = (label) => {
  const m = /^CY(\d{4})Q([1-4])$/.exec(label);
  const q = Number(m[2]) - 1;
  return q ? `CY${m[1]}Q${q}` : `CY${Number(m[1]) - 1}Q4`;
};
const shiftDays = (iso, days) =>
  new Date(new Date(iso + "T00:00:00Z").getTime() + days * DAY_MS).toISOString().slice(0, 10);

/* The most recent calendar quarter end at least 45 days old: a 10-Q is
   due 40 to 45 days after the quarter, so by then the wave has filed
   and the frame is worth reading. */
function settledQuarter(now = new Date()) {
  let y = now.getUTCFullYear(), q = Math.floor(now.getUTCMonth() / 3) + 1;
  for (;;) {
    q--;
    if (q === 0) { q = 4; y--; }
    const end = new Date(monthEnd(y, q * 3) + "T00:00:00Z");
    if ((now - end) / DAY_MS >= 45) return `CY${y}Q${q}`;
  }
}

/* ---------- feeds ---------- */

/* One fetch per (tag, unit, frame) for the whole run; fifty filers share
   the same sixteen replies. */
const frameCache = new Map();
async function frame(tag, unit, ccp) {
  const key = `${tag}|${unit}|${ccp}`;
  if (!frameCache.has(key)) frameCache.set(key, await fetchFrame(tag, unit, ccp));
  return frameCache.get(key);
}

/* The roster is CSV, which getJson cannot read; same pace gate, same
   header, and the same retries on a 429, a 5xx or a dropped connection
   (www.sec.gov answers bursts with 403 and 429 more readily than
   data.sec.gov does). Null when the SEC does not answer. */
async function fetchText(url, { timeoutMs = 15000, retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await paced();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { headers: SEC_UA, signal: ctrl.signal });
      if (resp.ok) return await resp.text();
      if (resp.status === 404) return null;
      if (resp.status === 429 || resp.status === 403 || resp.status >= 500) {
        rateLimitHits.count++;
        if (attempt === retries) return null;
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
        continue;
      }
      return null;
    } catch {
      if (attempt === retries) return null;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/* File_No, CIK, Registrant_Name, ...; the CIK is zero-padded and the
   file may open with a byte-order mark. Only the first two columns are
   read, and neither can contain a comma. */
function rosterCiks(csv) {
  const out = new Map();
  for (const line of String(csv).replace(/^\uFEFF/, "").split(/\r?\n/).slice(1)) {
    const m = /^(814-\d+),0*(\d+)/.exec(line);
    if (m) out.set(Number(m[2]), m[1]);
  }
  return out;
}

const isoDate = (s) => (typeof s === "number" && isFinite(s)
  ? new Date(s * 1000).toISOString().slice(0, 10) : null);

/* When the ticker first traded and when its history stops: the first
   bar of Yahoo's longest monthly chart, and the last trade Yahoo knows
   of (the bar array of a delisted OTC name keeps repeating a stale
   close, so the meta's last-trade time is the honest end: FRBP
   2025-05-30). The first monthly bar is stamped at month level and can
   precede the first trade by a day or more (BXSL 2021-10-25 against an
   8-A12B dated 2021-10-26), which is what universe.json says of the
   field. Both null on any failure; a chart that cannot be read never
   stops a refresh. */
const LISTED_SINCE_NOTE = "first bar of Yahoo's monthly chart: the month is the listing month, " +
  "the day can precede the first trade by a day or more";
async function listingSpan(ticker) {
  const none = { listedSince: null, priceHistoryEnds: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" +
      `${encodeURIComponent(ticker)}?range=max&interval=1mo`,
      { headers: { ...SEC_UA, Accept: "application/json" }, signal: ctrl.signal });
    if (!resp.ok) return none;
    const body = await resp.json();
    const res0 = body && body.chart && body.chart.result && body.chart.result[0];
    const ts = res0 && res0.timestamp;
    if (!Array.isArray(ts) || !ts.length) return none;
    const meta = res0.meta || {};
    return {
      listedSince: isoDate(ts[0]),
      priceHistoryEnds: isoDate(meta.regularMarketTime) || isoDate(ts[ts.length - 1]),
    };
  } catch {
    return none;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- universe ---------- */

const fileNumbersOf = (sub) => {
  const recent = sub && sub.filings && sub.filings.recent;
  const nums = recent && Array.isArray(recent.fileNumber) ? recent.fileNumber : [];
  return [...new Set(nums.filter((n) => typeof n === "string" && n.startsWith("814-")))].sort();
};

/* A filer can carry several tickers (notes, a preferred class). The
   submissions JSON lists the common first; failing that, the shortest
   symbol off an exchange is the common. */
function chooseTicker(rows, sub) {
  const preferred = Array.isArray(sub.tickers) ? sub.tickers.map((t) => String(t).toUpperCase()) : [];
  for (const t of preferred) {
    const hit = rows.find((r) => r.ticker === t);
    if (hit) return hit;
  }
  return [...rows].sort((a, b) =>
    a.ticker.length - b.ticker.length ||
    Number(a.exchange === "OTC") - Number(b.exchange === "OTC"))[0];
}

/* The latest periodic report in the filings index: its form, period,
   filing date and accession are the file's provenance summary. */
function latestReport(sub) {
  const r = sub && sub.filings && sub.filings.recent;
  if (!r || !Array.isArray(r.form)) return null;
  const i = r.form.findIndex((f) => REPORT_FORM.test(f || ""));
  if (i === -1) return null;
  return { form: r.form[i], end: r.reportDate[i] || null,
           filed: r.filingDate[i] || null, accn: r.accessionNumber[i] || null };
}

async function buildUniverse(quarter, stats) {
  const fv = await frame("InvestmentOwnedAtFairValue", "USD", quarter + "I");
  const nav = await frame("NetAssetValuePerShare", "USD/shares", quarter + "I");
  if (!fv || !nav) return null;
  const navCiks = new Set(nav.data.map((r) => Number(r.cik)));
  const candidates = new Map();
  for (const r of fv.data) {
    const cik = Number(r.cik);
    if (navCiks.has(cik)) candidates.set(cik, { foundIn: ["frames"] });
  }
  stats.framesCandidates = candidates.size;

  /* the roster alone admits EQS and PFX, so a roster that did not
     answer is a run that cannot say who left */
  const rosterCsv = await fetchText(ROSTER_URL);
  stats.rosterUnanswered = rosterCsv === null;
  const roster = rosterCiks(rosterCsv || "");
  stats.rosterRows = roster.size;
  for (const cik of roster.keys()) {
    const c = candidates.get(cik);
    if (c) c.foundIn.push("roster");
    else candidates.set(cik, { foundIn: ["roster"] });
  }

  const tickers = await fetchCompanyTickers();
  if (!tickers) return null;
  /* a symbol with no exchange is a non-traded fund's placeholder (PGIM
     Private Credit Fund carries "PGIM" and no market), not a listing */
  const byCik = new Map();
  for (const t of tickers) {
    if (!t.ticker || !t.exchange) continue;
    if (!byCik.has(t.cik)) byCik.set(t.cik, []);
    byCik.get(t.cik).push(t);
  }
  const withTicker = [...candidates.keys()].filter((cik) => byCik.has(cik));
  stats.withTicker = withTicker.length;

  /* getJson answers null after its retries on a 429, a 5xx or a timeout
     as well as on a 404, and fileNumbersOf(null) is empty: the two must
     not read the same, since only the second means "no 814- number" */
  const rows = [], submissions = new Map();
  for (const cik of withTicker) {
    const sub = await fetchSubmissions(cik);
    if (!sub) { stats.submissionsUnanswered.push(cik); continue; }
    const fileNumbers = fileNumbersOf(sub);
    if (!fileNumbers.length) continue;
    const t = chooseTicker(byCik.get(cik), sub);
    const fye = typeof sub.fiscalYearEnd === "string" ? sub.fiscalYearEnd : null;
    const fyEndMonth = fye ? Number(fye.slice(0, 2)) : null;
    const exchange = t.exchange || null;
    rows.push({
      cik, ticker: t.ticker, name: sub.name || t.name || null, exchange,
      listed: Boolean(exchange) && exchange !== "OTC", otc: exchange === "OTC",
      fileNumbers, fiscalYearEnd: fye,
      fyEndMonth: Number.isInteger(fyEndMonth) && fyEndMonth >= 1 && fyEndMonth <= 12 ? fyEndMonth : null,
      sic: sub.sic ? String(sub.sic) : null,
      listedSince: null, priceHistoryEnds: null,
      acSource: null, sbaExempt: null,
      foundIn: candidates.get(cik).foundIn,
    });
    submissions.set(cik, sub);
  }
  rows.sort((a, b) => a.ticker.localeCompare(b.ticker));

  /* Yahoo is not EDGAR and has its own patience; one call a quarter
     second is well inside it. */
  for (const row of rows) {
    Object.assign(row, await listingSpan(row.ticker));
    if (!row.listedSince) stats.noListingDate.push(row.ticker);
    await new Promise((r) => setTimeout(r, 250));
  }
  return { rows, submissions };
}

/* ---------- frames merged into each series ---------- */

/* The concepts whose frames are read for the quarter: the instants the
   scorecard opens with, liabilities, total assets and the single
   facility for the debt and portfolio bounds, the NII ladder and the
   per-share fact, share count and preferred dividend its cross-check
   needs. Blueprint 7.4: companyfacts lags frames intermittently, so the
   newer of the two answers, and the value says which. */
const FRAME_KEYS = [
  "portfolioFairValue", "portfolioCost", "navPerShare", "netAssets", "debt", "lineOfCredit",
  "liabilities", "totalAssets", "assetCoverage", "niiAfterTax", "niiPreTax", "niiTax", "niiPerShare",
  "weightedShares", "preferredDividends",
];
const frameFor = (concept, quarter) => (concept.kind === "instant" ? quarter + "I" : quarter);
const stepTags = (step) => (typeof step === "string" ? [step] : step.minus);

async function prefetchFrames(quarter) {
  for (const key of FRAME_KEYS) {
    const c = BDC_CONCEPTS[key];
    for (const step of c.tags) {
      for (const tag of stepTags(step)) await frame(tag, c.unit, frameFor(c, quarter));
    }
  }
}

const rowFor = (payload, cik) =>
  payload && Array.isArray(payload.data)
    ? payload.data.find((r) => Number(r.cik) === cik) : null;

/* One entry per concept for mergeFrames, resolved the way the builder
   resolves a ladder: the first step whose frame carries this filer's
   row answers. A subtraction step (pre-tax NII less the tax line)
   answers only where both frames carry the row for the same span. Two
   ladders send every step: debt, so the bound can fall through to the
   next tag as it does on the companyfacts path, and NII, whose steps go
   through the same cross-check against the per-share and share-count
   frames (less any step the builder settled as skipped for this filer)
   before the first remaining step is sent with its verdict. The share
   count is held to the builder's scale rule first (net assets over NAV
   per share from the same frames), and a per-share fact the check
   rejects for a filer whose tag the builder already rejected is
   replaced by NII over shares, as the builder does. The nine
   non-calendar filers miss the duration frames for their fiscal-year-end
   quarter and keep the builder's derived value. */
const stepPayload = (c, step, quarter, cik) => {
  if (typeof step === "string") {
    const payload = frameCache.get(`${step}|${c.unit}|${frameFor(c, quarter)}`);
    return rowFor(payload, cik) ? payload : null;
  }
  const [a, b] = step.minus.map((t) => frameCache.get(`${t}|${c.unit}|${frameFor(c, quarter)}`));
  const ra = rowFor(a, cik), rb = rowFor(b, cik);
  return ra && rb && ra.end === rb.end && (ra.start || null) === (rb.start || null)
    ? { ...a, tag: step.minus.join("-"), data: [{ ...ra, val: ra.val - rb.val }] } : null;
};
const valueOf = (c, payload, cik, step) => {
  const r = rowFor(payload, cik);
  const note = c.stepNotes && c.stepNotes[step - 1];
  return { v: r.val, tag: payload.tag, start: r.start || null, end: r.end, step, ...(note ? { note } : {}) };
};
function frameEntriesFor(cik, quarter, series) {
  const entries = [];
  const skip = new Set(((series && series.niiLadder && series.niiLadder.skipped) || []).map((s) => s.step));
  const flags = (series && series.flags) || [];
  const firstValue = (key) => {
    const c2 = BDC_CONCEPTS[key];
    const payload = stepPayload(c2, c2.tags[0], quarter, cik);
    return payload ? valueOf(c2, payload, cik, 1) : null;
  };
  /* the per-share and share-count entries are shaped by the NII check
     below, so they are decided there and sent last */
  const held = {};
  for (const key of FRAME_KEYS) {
    const c = BDC_CONCEPTS[key];
    const payloads = c.tags.map((step) => stepPayload(c, step, quarter, cik));
    if (key === "debt") {
      payloads.forEach((payload, i) => {
        if (payload) entries.push({ key, payload: { ...payload, step: i + 1 } });
      });
      continue;
    }
    if (key === "niiAfterTax") {
      const candidates = payloads.map((payload, i) => (payload && !skip.has(i + 1) ? valueOf(c, payload, cik, i + 1) : null)).filter(Boolean);
      const ctx = { perShare: firstValue("niiPerShare"), shares: firstValue("weightedShares"), preferred: firstValue("preferredDividends") };
      const netAssets = firstValue("netAssets"), nav = firstValue("navPerShare");
      if (ctx.shares && sharesOffScale(ctx.shares, netAssets, nav)) ctx.shares = null;
      const picked = chooseNii(candidates, ctx);
      if (picked.sharesFlag) held.weightedShares = { key: "weightedShares", payload: null, flag: { end: ctx.shares.end, ...picked.sharesFlag } };
      if (!picked.value) continue;
      const { step, crossCheck } = picked.value;
      const passed = [...skip].filter((s) => s < step);
      const note = passed.length
        ? niiSkipNote(picked.value, passed, passed.map((s) => stepTags(c.tags[s - 1]).join("-")))
        : picked.value.note;
      entries.push({ key, payload: { ...payloads[step - 1], step, ...(note ? { note } : {}), ...(crossCheck ? { crossCheck } : {}) },
                     ...(picked.flag ? { flag: picked.flag } : {}) });
      /* the filer's per-share tag fails here by a large gap and in
         enough of the builder's quarters: NII over shares in its place,
         flagged; a cent or two off is the filer's figure and stands */
      const priorFails = flags.filter((f) => f.key === "niiAfterTax" && f.basis === "perShare" && !f.sharesEstimate &&
        isFinite(f.perShare) && isFinite(f.implied) && largeGap(f.perShare, f.implied)).length;
      if (picked.flag && picked.flag.basis === "perShare" && largeGap(picked.flag.perShare, picked.flag.implied) &&
          priorFails + 1 >= NII_SKIP_MIN_QUARTERS) {
        const perSharePayload = stepPayload(BDC_CONCEPTS.niiPerShare, BDC_CONCEPTS.niiPerShare.tags[0], quarter, cik);
        const row = rowFor(perSharePayload, cik);
        const over = niiOverShares({ ...picked.value, source: "frames" }, ctx.shares, { ...ctx.perShare, tag: perSharePayload.tag, accn: row.accn });
        held.niiPerShare = {
          key: "niiPerShare",
          payload: { ...perSharePayload, tag: over.tag, data: [{ ...row, val: over.v }], derived: over.derived, note: over.note, rejected: over.rejected },
          flag: { tag: perSharePayload.tag, value: row.val, nii: picked.value.v, shares: ctx.shares.v, implied: over.v,
                  reason: "the filer's per-share tag fails the NII cross-check; NII over weighted shares served in its place" },
        };
      }
      continue;
    }
    const i = payloads.findIndex(Boolean);
    if (i === -1) continue;
    const entry = { key, payload: { ...payloads[i], step: i + 1 } };
    if (key === "niiPerShare" || key === "weightedShares") held[key] = held[key] || entry;
    else entries.push(entry);
  }
  return entries.concat(Object.values(held));
}

/* ---------- shaping ---------- */

/* The data-file rule: dollars and share counts to the unit, per-share
   figures and ratios to four places. EDGAR's own values are already
   whole dollars; this catches the differenced and derived ones. */
function rounded(v, unit) {
  if (typeof v !== "number" || !isFinite(v)) return v;
  return unit === "USD" || unit === "shares" ? Math.round(v) : Math.round(v * 10000) / 10000;
}
function roundSeries(series) {
  for (const p of series.periods) {
    for (const v of Object.values(p.values)) if (v) v.v = rounded(v.v, v.unit);
  }
  for (const v of Object.values(series.latest)) if (v) v.v = rounded(v.v, v.unit);
}

/* Compact JSON, one period per line, so a weekly diff reads as the
   quarters that changed rather than one line of 150 KB. The file carries
   no run timestamp and is rewritten only when its content changed, so a
   week without a new filing adds nothing to the repository; the run
   stamp lives in refresh-report.json and universe.json. */
function companyJson(payload) {
  const { series, ...head } = payload;
  const { periods, ...rest } = series;
  const lines = periods.map((p) => JSON.stringify(p));
  const restJson = JSON.stringify(rest);
  return JSON.stringify(head).slice(0, -1) +
    ',"series":{"periods":[\n' + lines.join(",\n") + "\n]," +
    restJson.slice(1) + "}\n";
}

async function pullFiler(row, sub, quarter) {
  const raw = await fetchCompanyFactsRaw(row.cik);
  if (!raw) return null;
  const series = buildBdcSeries(raw.facts, { fyEndMonth: row.fyEndMonth, limit: QUARTERS_KEPT });
  mergeFrames(series, frameEntriesFor(row.cik, quarter, series), { cik: row.cik, limit: QUARTERS_KEPT });
  roundSeries(series);
  return {
    ticker: row.ticker, cik: row.cik, name: row.name, fyEndMonth: row.fyEndMonth,
    series,
    latestFiling: latestReport(sub),
  };
}

/* coverage.json: for every concept, how many filers carry a current
   value and who does not, and per filer the tag, period type, end and
   source that answered, the first period the concept was tagged, with
   `derived` and `differenced` where the value is a difference rather
   than a fact (periodType "3M" is either; "YTD" is only ever an
   undifferenced ratio or share count). Current means the value's period
   ends within 45 days before the quarter end or later, which admits
   SAR's May 31 quarter and a fiscal-year-end 10-K alike; an older value
   is stale and listed apart, so the page can say "last tagged
   2023-12-31" rather than "not disclosed". A filer whose newest quarter
   carries a flag for the metric — the value emptied, replaced by a
   derivation, or kept with a failed cross-check — is listed as flagged
   and not counted current, whatever it serves. */
/* written only when it changed, for the same reason as the company files */
function writeIfChanged(path, text) {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  writeFileSync(path, text, "utf8");
  return true;
}

function coverageOf(written, rows, quarter) {
  const currentFrom = shiftDays(quarterEnd(quarter), -45);
  const metrics = {}, byTicker = {};
  for (const key of Object.keys(BDC_CONCEPTS)) metrics[key] = { n: 0, tickers_missing: [], tickers_stale: [], tickers_flagged: [] };
  for (const row of rows) {
    const file = written.get(row.ticker);
    const periods = file ? file.series.periods : [];
    const last = periods.length ? periods[periods.length - 1] : null;
    byTicker[row.ticker] = {};
    for (const key of Object.keys(BDC_CONCEPTS)) {
      const v = file && file.series.latest[key];
      const flagged = !!last && file.series.flags.some((f) => f.key === key && f.end === last.end);
      if (!v) { metrics[key][flagged ? "tickers_flagged" : "tickers_missing"].push(row.ticker); continue; }
      byTicker[row.ticker][key] = {
        tag: v.tag, periodType: v.periodType, end: v.end, source: v.source,
        ...(file.series.firstPeriod && file.series.firstPeriod[key] ? { firstPeriod: file.series.firstPeriod[key] } : {}),
        ...(v.derived ? { derived: v.derived } : {}), ...(v.differenced ? { differenced: true } : {}),
        ...(flagged ? { flagged: true } : {}),
      };
      if (flagged) metrics[key].tickers_flagged.push(row.ticker);
      else if (v.end >= currentFrom) metrics[key].n++;
      else metrics[key].tickers_stale.push(row.ticker);
    }
  }
  return { quarter, currentFrom, n: rows.length, metrics, byTicker };
}

/* the metric block indented for reading, the per-filer block one line
   per ticker: 53 filers times 37 concepts pretty-printed ran to 220 KB */
function coverageJson(coverage) {
  const { byTicker, ...head } = coverage;
  const lines = Object.entries(byTicker).map(([t, e]) => " " + JSON.stringify(t) + ":" + JSON.stringify(e));
  return JSON.stringify(head, null, 1).slice(0, -2) +
    ',\n "byTicker": {\n' + lines.join(",\n") + "\n }\n}\n";
}

const dirBytes = (dir) => readdirSync(dir).reduce((sum, f) => {
  const st = statSync(join(dir, f));
  return sum + (st.isFile() ? st.size : 0);
}, 0);

/* ---------- holdings: the schedule of investments (blueprint 7.3) ---------- */

const DATASET_BASE = "https://www.sec.gov/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/";
const ARCHIVES = "https://www.sec.gov/Archives/edgar/data/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noDash = (accn) => String(accn).replace(/-/g, "");
const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const round4 = (v) => (isNum(v) ? Math.round(v * 10000) / 10000 : null);

/* What the stage downloaded, for the report: every file fetched through
   the paced gate is counted here, a skipped download (the sidecar says
   the remote is the file on disk) is counted as a check. */
const transfer = { bytes: 0, files: 0, checks: 0, requests: 0 };

/* downloadToFile with the retry www.sec.gov's files host needs: it
   answers a burst with 403 where data.sec.gov answers 429, and
   downloadToFile retries only the latter. */
async function download(url, dest, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      transfer.requests++;
      const r = await downloadToFile(url, dest, opts);
      if (r.skipped) transfer.checks++;
      else { transfer.bytes += r.bytes; transfer.files++; }
      return r;
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/^403 from/.test(msg) && attempt < 3) { rateLimitHits.count++; await sleep(1500 * (attempt + 1)); continue; }
      throw e;
    }
  }
}

/* A paced HEAD: true when the remote file exists, false on a 404, null
   when the SEC did not answer. A monthly zip that does not exist yet
   (the current month's) is a 404, not a failure. */
async function remoteExists(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await paced();
    transfer.requests++;
    try {
      const r = await fetch(url, { method: "HEAD", headers: SEC_UA });
      if (r.ok) return true;
      if (r.status === 404) return false;
      if (r.status === 403 || r.status === 429 || r.status >= 500) { rateLimitHits.count++; await sleep(1500 * (attempt + 1)); continue; }
      return false;
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

/* one member of a small zip (a filing's -xbrl.zip) as a string */
async function readMemberText(zipPath, name) {
  const dir = await readCentralDirectory(zipPath);
  const stream = await streamMember(zipPath, name, { directory: dir });
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

/* The monthly zips a filing can sit in: the month it was filed and the
   next (the SEC assembles a month's file about ten days after month
   end, and a filing from the last days of a month can land in the
   next). */
function candidateMonths(filed) {
  const [y, m] = String(filed).split("-").map(Number);
  const a = `${y}_${String(m).padStart(2, "0")}`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return [a, `${ny}_${String(nm).padStart(2, "0")}`];
}

/* the company file's tagged totals for the filing's period: the value
   whose accession is the filing's, else the value at that period end */
function taggedTotal(company, key, filing) {
  const periods = (company && company.series && company.series.periods) || [];
  const p = periods.find((x) => x.end === filing.end);
  const v = p && p.values[key];
  if (!v || !isNum(v.v)) return null;
  return { value: v.v, tag: v.tag, accn: v.accn || null, source: v.accn === filing.accn ? "company file, this filing" : "company file, period end" };
}

/* the main document, from the cache when the accession's file is there
   (a filing never changes), else downloaded through the paced gate to
   the cache build-bdc-terms.mjs shares */
async function mainDocument(row, filing, sub) {
  const docsDir = join(CACHE_DIR, "docs");
  const path = join(docsDir, `${filing.accn}.htm`);
  const meta = join(docsDir, `${filing.accn}.meta.json`);
  if (existsSync(path) && statSync(path).size > 0) return { path, fetched: "cached" };
  const s = sub || await fetchSubmissions(row.cik);
  const r = s && s.filings && s.filings.recent;
  const i = r && Array.isArray(r.accessionNumber) ? r.accessionNumber.indexOf(filing.accn) : -1;
  const doc = i >= 0 && r.primaryDocument ? r.primaryDocument[i] : null;
  if (!doc) return { error: "primary document not named in the submissions JSON" };
  const url = `${ARCHIVES}${row.cik}/${noDash(filing.accn)}/${doc}`;
  const got = await download(url, path, { ifChangedFrom: null, timeoutMs: 300000 });
  writeFileSync(meta, JSON.stringify({
    ticker: row.ticker, cik: row.cik, accn: filing.accn, form: filing.form, period: filing.end, filed: filing.filed,
    url, lastModified: got.lastModified || null, etag: got.etag || null, contentLength: got.contentLength == null ? null : String(got.contentLength),
    fetched: new Date().toISOString().slice(0, 19),
  }, null, 1));
  return { path, fetched: "downloaded", bytes: got.bytes };
}

/* the rendered schedule report: FilingSummary.xml names it, the page
   is fetched beside it; both cached by accession */
async function rPage(row, filing) {
  const dir = join(CACHE_DIR, "rpages", filing.accn);
  const base = `${ARCHIVES}${row.cik}/${noDash(filing.accn)}/`;
  const summaryPath = join(dir, "FilingSummary.xml");
  if (!existsSync(summaryPath)) await download(base + "FilingSummary.xml", summaryPath, { ifChangedFrom: null, timeoutMs: 60000 });
  const report = findScheduleReport(readFileSync(summaryPath, "utf8"));
  if (!report || !report.file) return { error: "FilingSummary.xml names no schedule of investments report" };
  const pagePath = join(dir, report.file);
  if (!existsSync(pagePath)) await download(base + report.file, pagePath, { ifChangedFrom: null, timeoutMs: 300000 });
  return { report, path: pagePath };
}

/* extractProse's { v, sentence, where } kept as { v, sentence, section }
   plus any scalar the extractor set beside them (pct, sbaRelief, of,
   low, high, regular, supplemental, special, total, above, derived) */
function slimField(f) {
  if (!f || typeof f !== "object") return f === undefined ? null : f;
  const out = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === "where") { if (v && v.section) out.section = v.section; continue; }
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) { out[k] = slimField(v); continue; }
    out[k] = v;
  }
  return out;
}

/* the company file's `disclosed` block */
function disclosedBlock(row, filing, company, prose, terms) {
  const t = terms && terms.filers && terms.filers[row.ticker];
  const sbaExempt = t && t.sbaExempt ? t.sbaExempt.value : null;
  const sbaExemptStatus = t && t.sbaExempt ? t.sbaExempt.status || null : null;
  const acTag = taggedTotal(company, "assetCoverage", filing);
  const netAssets = taggedTotal(company, "netAssets", filing), debt = taggedTotal(company, "debt", filing);
  const ac = resolveAssetCoverage({
    tag: acTag ? acTag.value : null, prose: prose.assetCoveragePct,
    netAssets: netAssets ? netAssets.value : null, debt: debt ? debt.value : null,
    /* an unconfirmed seed is a lead, not relief: the formula flag fires
       only on a confirmed exemption, and the status is written beside
       the value so the page can say which it has */
    sbaExempt: sbaExemptStatus === "confirmed" ? sbaExempt : null,
  });
  const assetCoverage = {
    v: ac.v, acSource: ac.acSource, tag: ac.tag, prose: ac.prose, formula: ac.formula,
    sentence: ac.sentence, sbaExempt, sbaExemptStatus, ...(ac.sbaRelief ? { sbaRelief: true } : {}), flags: ac.flags,
    statutory: prose.statutoryCoverage && isNum(prose.statutoryCoverage.v) ? prose.statutoryCoverage.v : null,
  };
  const sens = Array.isArray(prose.rateSensitivity) ? prose.rateSensitivity.map(slimField) : null;
  const v = (f) => (f && isNum(f.v) ? f.v : null);
  return {
    accn: filing.accn, form: filing.form, period: filing.end,
    source: "the prose of the filing's main document, read by scripts/lib/bdc-prose.mjs; every figure carries its sentence",
    assetCoverage,
    waYieldAtCost: slimField(prose.waYieldAtCost),
    waYieldAtFv: slimField(prose.waYieldAtFv),
    waYields: Array.isArray(prose.waYields) ? prose.waYields.map(slimField) : null,
    floatingShare: slimField(prose.floatingShare),
    portfolioCompanies: slimField(prose.portfolioCompanies),
    nonAccrualCostPct: slimField(prose.nonAccrualCostPct),
    nonAccrualFvPct: slimField(prose.nonAccrualFvPct),
    rateSensitivity: sens ? { rows: sens, intro: prose.rateSensitivity.intro ? slimField(prose.rateSensitivity.intro) : null } : null,
    dividendSplit: slimField(prose.dividendSplit),
    targetLeverage: slimField(prose.targetLeverage),
    distributableNii: slimField(prose.distributableNii),
    internallyManaged: slimField(prose.internallyManaged),
    sbaExempt: slimField(prose.sbaExempt),
    /* the must-not-build fields pass through credit.js's disclosedOnly,
       with the sentence as provenance, never computed */
    borrower: RTCredit.disclosedOnly({
      ltv: v(prose.ltv), coreNiiPerShare: v(prose.coreNiiPerShare),
      yieldOnNewInvestments: v(prose.yieldOnNew), yieldOnExits: v(prose.yieldOnExits),
    }, {
      accn: filing.accn,
      sentences: {
        ltv: prose.ltv ? prose.ltv.sentence : null, coreNiiPerShare: prose.coreNiiPerShare ? prose.coreNiiPerShare.sentence : null,
        yieldOnNewInvestments: prose.yieldOnNew ? prose.yieldOnNew.sentence : null, yieldOnExits: prose.yieldOnExits ? prose.yieldOnExits.sentence : null,
      },
    }),
  };
}

/* the company file gains (or replaces) its `disclosed` block; the rest
   of the file is rewritten byte for byte */
function writeDisclosed(row, filing, prose, terms, companies, entry) {
  const cpath = join(OUT_DIR, `company-${row.ticker}.json`);
  const current = readJson(cpath);
  if (!current) return;
  const { series, disclosed, ...head } = current;
  void disclosed;
  const next = { ...head, disclosed: disclosedBlock(row, filing, current, prose, terms), series };
  writeIfChanged(cpath, companyJson(next));
  companies.set(row.ticker, next);
  entry.acSource = next.disclosed.assetCoverage.acSource;
}

/* holdings-<TICKER>.json: one holding per line, as the company files
   are written, so a diff reads as the rows that changed */
function holdingsJson(file) {
  const { holdings, ...head } = file;
  head.keys = HOLDING_LEGEND;
  const lines = holdings.map((h) => JSON.stringify(compactHolding(h)));
  return JSON.stringify(head, null, 1).slice(0, -2) + ',\n "holdings": [\n' + lines.join(",\n") + "\n ]\n}\n";
}

/* composite.json is written only when something other than the stamp changed */
function writeIfChangedButStamp(path, obj, stampKey) {
  const text = JSON.stringify(obj, null, 1) + "\n";
  const prev = readJson(path);
  if (prev) {
    prev[stampKey] = obj[stampKey];
    if (JSON.stringify(prev, null, 1) + "\n" === text) return false;
  }
  writeFileSync(path, text, "utf8");
  return true;
}

/**
 * The stage. `filers` are universe rows; `companies` maps ticker to the
 * company file's content; `submissions` maps cik to the submissions
 * JSON where the run fetched it. Returns the report block and the
 * per-ticker coverage block.
 */
async function holdingsStage(filers, companies, submissions, { terms }) {
  const started = Date.now();
  const rep = {
    startedAt: new Date(started).toISOString(), attempted: 0, written: 0, unchanged: [], refused: [], failed: [],
    sources: { dataset: 0, instance: 0, table: 0 }, zips: [], table: { used: 0, unusable: 0, none: 0 }, rpage: { fetched: 0, used: 0, failed: 0 },
    prose: 0, downloads: transfer, notes: [],
  };
  const byTicker = {};
  const committed = (t) => readJson(join(OUT_DIR, `holdings-${t}.json`));
  const priorCoverage = readJson(join(OUT_DIR, "coverage.json"));
  const priorHoldings = (priorCoverage && priorCoverage.holdings && priorCoverage.holdings.byTicker) || {};

  /* who needs work: a filer whose latest periodic report's accession is
     not the one the committed holdings file (or the committed refusal)
     already answers */
  const todo = [];
  for (const row of filers) {
    const company = companies.get(row.ticker);
    const filing = company && company.latestFiling;
    if (!filing || !filing.accn || !filing.end) {
      rep.failed.push({ ticker: row.ticker, reason: "no latest periodic report in the company file" });
      byTicker[row.ticker] = { status: "failed", reason: "no latest periodic report" };
      continue;
    }
    const have = committed(row.ticker);
    const prior = priorHoldings[row.ticker];
    /* a result is settled only when the monthly data set answered when
       it was written: a file or refusal from the instance or table
       fallback is re-read every week until a zip carries the accession,
       so a fallback outcome never sticks past the zip that would
       correct it (the first Sunday after a 10-Q wave reads everything
       through the fallback; the zip lands weeks later) */
    const fromDataset = have && have.sources && have.sources.dataset;
    if (!FORCE_HOLDINGS && have && have.accn === filing.accn && have.gate && have.gate.passed && fromDataset) {
      rep.unchanged.push(row.ticker);
      byTicker[row.ticker] = { status: "written", accn: filing.accn, period: filing.end, form: filing.form, unchanged: true,
        rows: have.gate.rows, source: have.rowSource || (have.sources && have.sources.dataset ? "dataset" : (have.sources && have.sources.instance ? "instance" : null)),
        nonAccrualSource: have.summary && have.summary.nonAccrual ? have.summary.nonAccrual.source : null };
      continue;
    }
    if (!FORCE_HOLDINGS && !have && prior && prior.status === "refused" && prior.accn === filing.accn && prior.source === "dataset") {
      rep.unchanged.push(row.ticker);
      byTicker[row.ticker] = { ...prior, unchanged: true };
      rep.refused.push({ ticker: row.ticker, accn: filing.accn, reason: prior.reason, cost: prior.cost || null, fv: prior.fv || null, tried: prior.tried || null, unchanged: true });
      continue;
    }
    todo.push({ row, company, filing });
  }
  rep.attempted = todo.length;
  console.log(`refresh-bdc: holdings — ${todo.length} filer(s) to read, ${rep.unchanged.length} unchanged`);
  if (!todo.length) {
    rep.finishedAt = new Date().toISOString(); rep.durationSeconds = Math.round((Date.now() - started) / 1000);
    return { report: rep, byTicker };
  }

  /* ---- the monthly data sets ---- */
  const zipOf = new Map();       /* accn -> zip path */
  const zipSubs = new Map();     /* zip path -> sub.tsv rows */
  if (SOURCE_ARG !== "instance") {
    const months = [...new Set(todo.flatMap((t) => candidateMonths(t.filing.filed)))].sort();
    const dsDir = join(CACHE_DIR, "datasets");
    mkdirSync(dsDir, { recursive: true });
    for (const month of months) {
      const url = `${DATASET_BASE}${month}_bdc.zip`;
      const dest = join(dsDir, `${month}_bdc.zip`);
      const exists = await remoteExists(url);
      if (exists === false) { rep.zips.push({ month, status: "absent" }); continue; }
      if (exists === null && !existsSync(dest)) { rep.zips.push({ month, status: "unanswered" }); rep.notes.push(`${month}_bdc.zip: the SEC did not answer the HEAD and no copy is cached`); continue; }
      try {
        /* the download budget: ten minutes an attempt, one retry — a
           266 MB zip at the SEC's usual rate lands in two or three, and
           a slow drip must fail inside the workflow step's own timeout
           (weekly-refresh.yml gives this step 25 minutes, so a stalled
           zip never cancels the whole job before the commit step) */
        const got = await download(url, dest, { timeoutMs: 600000, retries: 1 });
        const subs = await readSubmissions(dest);
        zipSubs.set(dest, subs);
        rep.zips.push({ month, status: got.skipped ? "cached" : "downloaded", bytes: got.bytes, filings: Object.keys(subs).length });
        console.log(`refresh-bdc: ${month}_bdc.zip ${got.skipped ? "cached" : "downloaded"} (${(got.bytes / 1048576).toFixed(1)} MB, ${Object.keys(subs).length} filings)`);
      } catch (e) {
        rep.zips.push({ month, status: "failed", error: String(e && e.message || e) });
        rep.notes.push(`${month}_bdc.zip: ${String(e && e.message || e)}`);
      }
    }
    for (const t of todo) {
      for (const month of candidateMonths(t.filing.filed)) {
        const dest = join(dsDir, `${month}_bdc.zip`);
        const subs = zipSubs.get(dest);
        if (subs && subs[t.filing.accn]) { zipOf.set(t.filing.accn, dest); break; }
      }
    }
  }
  /* one pass over soi.tsv and one over num.tsv per zip, for every
     wanted accession at once */
  const datasetRows = new Map();   /* accn -> filing from readSoiDataset */
  const datasetFacts = new Map();  /* accn -> num facts */
  for (const [zip, subs] of zipSubs) {
    const adshs = [...zipOf.entries()].filter(([, z]) => z === zip).map(([a]) => a);
    if (!adshs.length) continue;
    const t0 = Date.now();
    const ds = await readSoiDataset(zip, { adshs });
    for (const [adsh, f] of Object.entries(ds.filings)) datasetRows.set(adsh, { ...f, zip: basename(zip) });
    const t1 = Date.now();
    const facts = await readNumFacts(zip, { adshs, tags: [UNFUNDED_TAG, COST_TAG, FV_TAG] });
    for (const [adsh, list] of Object.entries(facts)) datasetFacts.set(adsh, list);
    console.log(`refresh-bdc: ${basename(zip)}: ${adshs.length} filings, soi.tsv ${ds.lines} lines in ${Math.round((t1 - t0) / 1000)}s, num.tsv in ${Math.round((Date.now() - t1) / 1000)}s`);
    void subs;
  }

  /* ---- per filer ---- */
  for (const { row, company, filing } of todo) {
    const t0 = Date.now();
    const notes = [];
    const entry = { status: null, accn: filing.accn, period: filing.end, form: filing.form };
    byTicker[row.ticker] = entry;
    try {
      const overrides = RTCredit.FILER_LIEN_OVERRIDES[row.ticker] || null;
      /* the main document: read once, for the instance when no monthly
         zip carries the filing, for the table and for the prose */
      const doc = await mainDocument(row, filing, submissions.get(row.cik));
      let html = null;
      if (doc.error) notes.push(`main document: ${doc.error}`);
      else html = readFileSync(doc.path, "utf8");

      /* the tagged rows: the data set, else the filing's own instance —
         the inline-XBRL main document itself, or the extracted instance
         inside the filing's -xbrl.zip when the document carries no
         identifier members */
      let tagged = null, sources = { dataset: null, instance: null, table: null, rpage: null }, own = { cost: null, fv: null }, unfunded = null;
      const ds = datasetRows.get(filing.accn);
      if (ds && SOURCE_ARG !== "instance") {
        tagged = { rows: ds.rows, extra: ds.extra || { costOnly: [], cash: [] }, kind: "dataset", dropped: ds.dropped };
        sources.dataset = { zip: ds.zip, rows: ds.counts.kept, counts: ds.counts, dropped: ds.dropped,
          extra: { costOnly: tagged.extra.costOnly.length, cash: tagged.extra.cash.length } };
        const facts = datasetFacts.get(filing.accn) || [];
        const tot = totalsFromFacts(facts, filing.end);
        own = { cost: tot.cost ? tot.cost.value : null, fv: tot.fv ? tot.fv.value : null };
        unfunded = unfundedFromFacts(facts, filing.end);
        rep.sources.dataset++;
      } else {
        /* the extracted instance first (blueprint 7.3 names
           bxsl-20260630_htm.xml): the -xbrl.zip is fetched anyway, and
           the extracted document is the cleaner read — the inline 10-Q
           over-counted for most August 2026 filers before the dash-zero
           facts were decoded, and OFS's inline still disagrees with its
           own extracted instance. The inline document is the fallback
           for a filing whose zip carries no instance beside it (EQS). */
        let inst = null, instanceFrom = null;
        try {
          const dir = join(CACHE_DIR, "instances");
          const zipPath = join(dir, `${filing.accn}-xbrl.zip`);
          const url = `${ARCHIVES}${row.cik}/${noDash(filing.accn)}/${filing.accn}-xbrl.zip`;
          await download(url, zipPath, { timeoutMs: 600000 });
          const cd = await readCentralDirectory(zipPath);
          const member = cd.entries.find((e) => /_htm\.xml$/i.test(e.name)) ||
            cd.entries.find((e) => /\.xml$/i.test(e.name) && !/_(cal|def|lab|pre)\.xml$/i.test(e.name));
          if (member) {
            inst = parseSoiInstance(await readMemberText(zipPath, member.name), { period: filing.end });
            instanceFrom = `${filing.accn}-xbrl.zip/${member.name}`;
          }
        } catch (e) {
          notes.push(`instance: ${filing.accn}-xbrl.zip could not be read (${String(e && e.message || e)}); falling back to the inline document`);
        }
        if ((!inst || !inst.members) && html) {
          const inline = parseSoiInstance(html, { period: filing.end });
          if (inline && inline.members) { inst = inline; instanceFrom = basename(doc.path); }
        }
        if (!inst || !inst.members) {
          if (!inst) inst = { holdings: [], extra: { costOnly: [], cash: [] }, members: 0, contexts: 0, dropped: {}, period: filing.end, totals: {}, unfunded: [] };
          instanceFrom = instanceFrom || (html ? basename(doc.path) : null);
          notes.push(`instance: no XBRL instance in ${filing.accn}-xbrl.zip and the inline document tags no InvestmentIdentifierAxis member`);
        }
        tagged = { rows: inst.holdings, extra: inst.extra || { costOnly: [], cash: [] }, kind: "instance", dropped: inst.dropped };
        sources.instance = { doc: instanceFrom, rows: inst.holdings.length, members: inst.members, contexts: inst.contexts, dropped: inst.dropped, period: inst.period,
          extra: { costOnly: tagged.extra.costOnly.length, cash: tagged.extra.cash.length } };
        own = { cost: inst.totals.cost ? inst.totals.cost.value : null, fv: inst.totals.fv ? inst.totals.fv.value : null };
        unfunded = { total: inst.totals.unfunded ? inst.totals.unfunded.value : null, members: inst.unfunded };
        rep.sources.instance++;
        if (ds) notes.push("read from the instance by request; the monthly data set also carries this filing");
        else if (SOURCE_ARG !== "instance") notes.push("no monthly data set carries this filing yet; read from the instance");
      }
      for (const list of [tagged.rows, tagged.extra.costOnly, tagged.extra.cash]) applyFilerOverrides(list, overrides);
      const allTagged = tagged.rows.concat(tagged.extra.costOnly, tagged.extra.cash);
      const rescaled = sanitizeRates(allTagged);
      if (rescaled) notes.push(`${rescaled} rate fact(s) tagged a hundred times too large were rescaled or dropped (src.rt says which)`);

      /* the gate's targets: the company file's tagged totals for the
         period, else the source's own undimensioned facts of the same
         tags */
      const costTag = taggedTotal(company, "portfolioCost", filing), fvTag = taggedTotal(company, "portfolioFairValue", filing);
      let tagSource = "company file";
      let cTag = costTag ? costTag.value : null, fTag = fvTag ? fvTag.value : null;
      if (cTag === null || fTag === null) {
        cTag = cTag === null ? own.cost : cTag; fTag = fTag === null ? own.fv : fTag;
        tagSource = `${tagged.kind === "dataset" ? "data set num.tsv" : "instance"} (the company file lacks the period)`;
      }
      const gateOn = (rows) => reconcile(rows, { costTag: cTag, fvTag: fTag, dropped: tagged.dropped });

      /* the table and the prose from the main document read above */
      let parsed = null, prose = null, scaleFix = 1, tableAdds = false, tableUsable = false;
      if (html) {
        parsed = parseScheduleTables(html, { period: filing.end });
        const sumRows = parsed.rows.reduce((s, r) => s + (isNum(r.cost) ? r.cost : 0), 0);
        const tableCost = parsed.totals && isNum(parsed.totals.cost) ? parsed.totals.cost : sumRows;
        /* a thousands note the reader missed shows as a factor of 1,000
           against the tagged cost; a schedule headed with the period, or
           an undated one whose money adds to the tagged cost, is current */
        if (tableCost > 0 && cTag > 0) {
          const ratio = cTag / tableCost;
          if (Math.abs(ratio - 1000) / 1000 <= 0.02) scaleFix = 1000;
          else if (Math.abs(ratio - 1e6) / 1e6 <= 0.02) scaleFix = 1e6;
        }
        tableAdds = tableCost > 0 && cTag > 0 && Math.abs(tableCost * scaleFix - cTag) / cTag <= 0.02;
        tableUsable = parsed.rows.length > 0 && (parsed.period === filing.end || (parsed.period === null && tableAdds));
        prose = extractProse(html, { ticker: row.ticker, period: filing.end });
        rep.prose++;
      }

      /* the gate, on the tagged rows first: as read; then with the
         cost-only rows as fair value 0 (a written-off position); then
         with the cash-equivalent lines (inside some filers' total);
         then both. The first set that reconciles is the schedule. */
      const variants = [
        ["tagged rows", tagged.rows],
        ["tagged rows with cost-only rows at fair value 0", tagged.rows.concat(tagged.extra.costOnly)],
        ["tagged rows with cash-equivalent lines", tagged.rows.concat(tagged.extra.cash)],
        ["tagged rows with cost-only rows and cash-equivalent lines", allTagged],
      ];
      let rows = null, gate = null, rowSource = tagged.kind;
      const tried = [];
      for (const [name, cand] of variants) {
        if (tried.some((t) => t.n === cand.length)) continue;
        const g = gateOn(cand);
        tried.push({ variant: name, n: cand.length, cost: g.cost, fv: g.fv, reason: g.reason });
        if (g.passed) { rows = cand; gate = g; gate.variant = name; break; }
      }
      const tableCurrent = parsed && parsed.rows.length > 0 && (parsed.period === filing.end || (parsed.period === null && tableAdds));
      /* the cost-only rows with the printed fair value: a filer whose
         cost sum is exact once those rows count but whose fair-value sum
         is short by exactly their untagged fair values (GECC, SCM, RAND
         in the August 2026 file); the two variants that carry them are
         gated again */
      let fvFilled = 0;
      if (!rows && tableCurrent && tagged.extra.costOnly.length) {
        fvFilled = fillFairValueFromTable(tagged.extra.costOnly, parsed.rows, { scaleFix });
        if (fvFilled) {
          const sizes = new Set();
          for (const [name, cand] of variants) {
            if (!cand.some((h) => h.fvUntagged) || sizes.has(cand.length)) continue;
            sizes.add(cand.length);
            const g = gateOn(cand);
            const label = `${name.replace("at fair value 0", `at the printed fair value (${fvFilled} of ${tagged.extra.costOnly.length} filled from the table)`)}`;
            tried.push({ variant: label, n: cand.length, cost: g.cost, fv: g.fv, reason: g.reason });
            if (g.passed) { rows = cand; gate = g; gate.variant = label; break; }
          }
        }
      }
      /* the tagged rows plus the printed rows no tagged holding claims,
         when the tagged rows fall short because part of the schedule is
         tagged without a per-position identifier (GBDC's affiliated
         equity, $112M of $8,377M): the same gate on the union, each
         added row flagged src.row "table" (blueprint 7.3) */
      let tableOnly = null;
      if (!rows && tableCurrent && tagged.rows.length) {
        tableOnly = tableOnlyHoldings(tagged.rows, parsed.rows, { filerOverrides: overrides, scaleFix });
        if (tableOnly.holdings.length) {
          const sizes = new Set();
          for (const [name, cand] of variants) {
            const union = cand.concat(tableOnly.holdings);
            if (sizes.has(union.length)) continue;
            sizes.add(union.length);
            const g = gateOn(union);
            const label = `${name} + ${tableOnly.holdings.length} table-only rows`;
            tried.push({ variant: label, n: union.length, cost: g.cost, fv: g.fv, reason: g.reason });
            if (g.passed) { rows = union; gate = g; gate.variant = label; break; }
          }
        }
      }
      /* the printed schedule as the rows, when the tagged rows carry an
         unconsolidated vehicle's loans on the same axis and the table
         carries the filer's own (PNNT, PFLT, FSK, OBDC, CGBD, WHF): the
         same gate, on the table's rows, with the tagged facts joined
         back onto them */
      let tableAsSource = null;
      if (!rows && parsed && parsed.rows.length && (parsed.period === filing.end || parsed.period === null)) {
        const tb = holdingsFromTable(parsed.rows, { filerOverrides: overrides, scaleFix });
        const g = gateOn(tb.holdings);
        tried.push({ variant: "table rows", n: tb.holdings.length, cost: g.cost, fv: g.fv, reason: g.reason });
        if (g.passed) {
          /* a set whose distinct issuers are under a tenth of its rows
             is not a schedule the site can serve — it is the reader
             putting one column in another (NMFC's issuer/industry swap
             served 13 companies over 365 rows); refuse it rather than
             pool its counts and concentrations */
          const distinct = new Set(tb.holdings.map((h) => issuerKey(h.name || h.id || ""))).size;
          if (tb.holdings.length >= 20 && distinct < 0.1 * tb.holdings.length) {
            tried[tried.length - 1].reason = `table rows reconcile but carry ${distinct} distinct issuers over ${tb.holdings.length} rows: a column fault, not a schedule`;
          } else {
            rows = tb.holdings; gate = g; rowSource = "table";
            gate.variant = `table rows: the tagged rows (${tagged.rows.length}, Σ cost ${tried[0].cost.sum}) do not reconcile; the printed schedule does`;
            tableAsSource = fillFromTagged(rows, allTagged);
            tableAsSource.cashRows = tb.cashRows; tableAsSource.empty = tb.empty;
            tableUsable = false;
          }
        }
      }
      /* a forced instance run is a check of the fallback, never a
         downgrade: when the instance rows did not pass and only a table
         set did, a committed file that passed through the data set is
         kept as it is */
      if (rows && SOURCE_ARG === "instance" && rowSource === "table") {
        const old = readJson(join(OUT_DIR, `holdings-${row.ticker}.json`));
        if (old && old.gate && old.gate.passed && old.sources && old.sources.dataset) {
          notes.push("forced instance run: the instance rows did not reconcile and the committed data-set file is kept; the table fallback result is not written");
          rep.refused.push({ ticker: row.ticker, accn: filing.accn, period: filing.end, reason: "instance rows did not reconcile (forced instance run; committed data-set file kept)",
            rows: tried[0].n, cost: tried[0].cost, fv: tried[0].fv, source: tagged.kind, tried, tagSource });
          /* the full row-set-variant list, not its length: coverage.json
             is what the "unchanged" fast path reads back as `prior` on
             every later run this refusal's accession does not change,
             and it can only carry the detail forward if it was kept
             whole here */
          Object.assign(entry, { status: "refused", reason: "instance rows did not reconcile (committed data-set file kept)", keptPrior: true, source: tagged.kind, tried });
          continue;
        }
      }
      if (!rows) {
        const strict = tried[0];
        rep.refused.push({ ticker: row.ticker, accn: filing.accn, period: filing.end, reason: strict.reason, rows: strict.n, cost: strict.cost, fv: strict.fv,
          source: tagged.kind, tried, tagSource });
        /* the full row-set-variant list, not its length: see the note
           by the forced-instance-run branch above */
        Object.assign(entry, { status: "refused", reason: strict.reason, rows: strict.n, cost: strict.cost, fv: strict.fv, source: tagged.kind, tried });
        /* a holdings file of a superseded filing must not stand for this
           one — but only a refusal from the data set itself removes it:
           a refusal from the instance or table fallback can be the
           fallback's own reader failing (the week before the monthly
           zip lands reads everything through it), and a reader bug must
           never delete a gated file. The stale file is marked, kept,
           and re-read next run. A file of this very filing that passed
           on an earlier read stays either way. */
        const old = join(OUT_DIR, `holdings-${row.ticker}.json`);
        const oldFile = readJson(old);
        if (oldFile && oldFile.accn !== filing.accn) {
          if (tagged.kind === "dataset") { unlinkSync(old); entry.removedPrior = true; }
          else { entry.stalePrior = true; notes.push(`the committed holdings file (${oldFile.period}, ${oldFile.accn}) is a quarter behind; kept until the data set carries ${filing.accn}, since this refusal came from the ${tagged.kind} fallback`); }
        }
        else if (oldFile && oldFile.gate && oldFile.gate.passed) { entry.keptPrior = true; notes.push("the committed holdings file of this filing, read earlier through another path, is kept"); }
        console.log(`  ${row.ticker} refused: ${strict.reason} (cost ${strict.cost.sum} vs ${strict.cost.tag}, fv ${strict.fv.sum} vs ${strict.fv.tag}; ${tried.length} row sets tried)`);
        if (prose) writeDisclosed(row, filing, prose, terms, companies, entry);
        continue;
      }
      gate.tagSource = tagSource;
      gate.tried = tried;
      if (gate.variant !== "tagged rows") notes.push(`gate passed on: ${gate.variant}`);

      /* unfunded commitments onto the rows */
      let unf = null;
      if (unfunded && unfunded.members && unfunded.members.length) {
        unf = attachUnfunded(rows, unfunded.members);
        unf.dimensionless = unfunded.total;
        unf.unmatched = unf.unmatched.length;
      }

      /* the table joined onto the tagged rows, for what they lack */
      let table = null, tableRows = null;
      if (parsed) {
        if (rowSource === "table") {
          table = { doc: basename(doc.path), period: parsed.period, tables: parsed.tables, rows: parsed.rows.length, subtotals: parsed.subtotals,
            scale: parsed.scale, scaleFix, totals: parsed.totals ? { cost: parsed.totals.cost, fv: parsed.totals.fv } : null,
            asSource: true, cashRowsLeftOut: tableAsSource.cashRows, emptyRowsLeftOut: tableAsSource.empty,
            taggedJoined: tableAsSource.matched, taggedRate: tableAsSource.rate, stages: tableAsSource.stages,
            nonAccrualRows: parsed.rows.filter((r) => r.nonAccrual).length, headers: parsed.headers, notes: parsed.notes.slice(0, 8) };
          rep.table.used++;
        } else if (tableUsable) {
          const join = enrichFromTable(rows, parsed.rows, { filerOverrides: overrides, scaleFix });
          const asRows = tableOnly && gate.variant.includes("table-only") ? tableOnly.holdings.length : 0;
          const fvFromTable = rows.filter((h) => h.src.val === "table").length;
          table = {
            doc: basename(doc.path), period: parsed.period, tables: parsed.tables, rows: parsed.rows.length, subtotals: parsed.subtotals,
            scale: parsed.scale, scaleFix, totals: parsed.totals ? { cost: parsed.totals.cost, fv: parsed.totals.fv } : null,
            matched: join.matched, rate: join.rate, stages: join.stages, filled: join.filled,
            ...(asRows ? { asRows, asRowsNote: `${asRows} printed rows no tagged holding claimed stand as holdings of their own (src.row "table"); the gate passed on the union` } : {}),
            ...(fvFromTable ? { fvFromTable, fvFromTableNote: `${fvFromTable} rows whose fair value the filer did not tag carry the printed fair value (src.val "table")` } : {}),
            nonAccrualRows: parsed.rows.filter((r) => r.nonAccrual).length, nonAccrualUnmatched: join.nonAccrualUnmatched,
            unmatchedRows: join.unmatchedRows.length, headers: parsed.headers, notes: parsed.notes.slice(0, 8),
          };
          /* every printed row the join could not place, with its
             columns, so the join can be audited from the served file
             (blueprint 7.3: kept with its columns, flagged "table",
             never summed) — not only the non-accrual subset */
          tableRows = join.unmatchedRows.slice(0, 1500);
          rep.table.used++;
        } else if (parsed.rows.length) {
          table = { doc: basename(doc.path), period: parsed.period, tables: parsed.tables, rows: parsed.rows.length, unusable: true,
            reason: parsed.period ? `the schedule the reader found is headed ${parsed.period}, not ${filing.end}` : "an undated schedule whose money does not add to the tagged cost",
            totals: parsed.totals ? { cost: parsed.totals.cost, fv: parsed.totals.fv } : null, scaleFix, headers: parsed.headers, notes: parsed.notes.slice(0, 8) };
          rep.table.unusable++;
        } else {
          table = { doc: basename(doc.path), rows: 0, unusable: true, reason: "no table resolved as a schedule", notes: parsed.notes.slice(0, 8) };
          rep.table.none++;
        }
      }
      sources.table = table;

      /* the R page: the second source for non-accrual and industry when
         the table gave none */
      const anyInd = rows.some((h) => h.industry);
      const tableGaveNa = table && !table.unusable && table.nonAccrualRows > 0;
      const tableGaveInd = table && !table.unusable && anyInd;
      if (!tableGaveNa || !tableGaveInd) {
        try {
          const rp = await rPage(row, filing);
          rep.rpage.fetched++;
          if (rp.error) { notes.push(`R page: ${rp.error}`); rep.rpage.failed++; }
          else {
            const rhtml = readFileSync(rp.path, "utf8");
            const rparsed = parseRPage(rhtml, { period: filing.end });
            if (!rparsed.rows.length) {
              notes.push(`R page ${rp.report.file}: ${/not available/i.test(rhtml) && rhtml.length < 1000 ? "EDGAR did not render it (\"Not available\")" : (rparsed.notes.join("; ") || "no rows")}`);
              rep.rpage.failed++;
            } else {
              /* the page fills only what the table did not give: its
                 XBRL footnote markers can renumber against the printed
                 schedule (PSBD's [7]), so where the table already read
                 non-accrual marks the page never adds more */
              const join = enrichFromRPage(rows, rparsed, { fillNa: !tableGaveNa, fillInd: !tableGaveInd });
              sources.rpage = {
                report: rp.report.file, longName: rp.report.longName, period: rparsed.period, rows: rparsed.rows.length, fvOnly: rparsed.fvOnly.length,
                matched: join.matched, exact: join.exact, filled: join.filled, nonAccrualRows: rparsed.rows.filter((r) => r.nonAccrual).length,
                industries: rparsed.industries.length, issuers: rparsed.issuers.length, notes: rparsed.notes.slice(0, 6),
                usedFor: [...(!tableGaveNa ? ["non-accrual"] : []), ...(!tableGaveInd ? ["industry"] : [])],
              };
              if (rparsed.industries.length && !rows.some((h) => h.industry)) {
                sources.rpage.industryTotals = rparsed.industries.map((i) => ({ name: i.name, cost: i.cost, fv: i.fv }));
              }
              rep.rpage.used++;
            }
          }
        } catch (e) {
          notes.push(`R page: ${String(e && e.message || e)}`);
          rep.rpage.failed++;
        }
      }
      /* a name the general splitter left as its whole member text — the
         August 2026 sentence forms ("Affiliate Investments Applegate
         Greenfiber Intermediate Inc ... Building Products Manufacturing
         Common Equity ... Investment date 12/31/2021", FDUS; "Debt
         Investments Aerospace & Defense Skydio, Inc ...", TCPC) — read
         again against the filing's own industry vocabulary: every
         industry the rows already carry (from the data set's own axis,
         the table, or the R page), so an issuer name buried between a
         section heading and its industry can be found even when no
         printed row joined it. A table-sourced row (src.nm "table")
         already carries the printed issuer and is left alone. */
      const industryLex = [...new Set(rows.map((h) => h.industry).filter(Boolean)
        .concat(sources.rpage && sources.rpage.industryTotals ? sources.rpage.industryTotals.map((i) => i.name) : []))];
      const refined = refineNames(rows, { industries: industryLex });
      if (refined) notes.push(`${refined} issuer name(s) read again from the member text against the filing's own industry vocabulary (src.nm "id")`);

      /* the summary and the file */
      const summary = summarizeHoldings(rows, { portfolioCost: cTag, portfolioFv: fTag, prose });
      /* the wall must say it is unread, not empty, when the table
         mapped a Maturity column and no date came through (BBDC's
         MM/YY form before parseDate knew it, CSWC's merged header) */
      if (table && !table.unusable && table.headers && Object.values(table.headers).includes("maturity") &&
          summary.maturity && summary.maturity.dated === 0 && summary.thirdPartyDebtCost > 0) {
        summary.maturity.unread = true;
        notes.push("maturity wall unread: the schedule prints a maturity column the reader mapped, but no date parsed — the wall is unknown, not empty");
      }
      if (sources.rpage && sources.rpage.industryTotals && summary.industry.every((i) => i.name === "n/a")) {
        const total = fTag;
        summary.industry = sources.rpage.industryTotals.sort((a, b) => (b.fv || 0) - (a.fv || 0)).slice(0, 10)
          .map((i) => ({ name: i.name, fv: i.fv, share: round4(RTCredit.div(i.fv, total)) }));
        summary.industrySource = "rpage totals";
      }
      if (unf) summary.unfunded = { ...summary.unfunded, matched: unf.matched, unmatched: unf.unmatched, membersTotal: unf.total, dimensionless: unf.dimensionless };
      const file = {
        ticker: row.ticker, cik: row.cik, name: row.name, period: filing.end, form: filing.form, accn: filing.accn, filed: filing.filed,
        creditVersion: CREDIT_VERSION,
        rowSource,
        sources,
        gate: { passed: true, tolerance: gate.tolerance, tagSource, variant: gate.variant, cost: gate.cost, fv: gate.fv, rows: gate.rows,
                subtotalRowsDropped: gate.subtotalRowsDropped, dropped: gate.dropped, tried: gate.tried },
        summary,
        tableUnmatched: tableRows && tableRows.length ? {
          rows: tableRows,
          nonAccrualRows: tableRows.filter((r) => r.nonAccrual).length,
          note: "printed rows that matched no tagged holding, kept whole with their columns (src \"table\", non-accrual first) and never summed; the gate's sums stay the tagged sums",
        } : null,
        notes,
        holdings: rows,
      };
      const path = join(OUT_DIR, `holdings-${row.ticker}.json`);
      writeIfChanged(path, holdingsJson(file));
      rep.written++;
      if (rowSource === "table") rep.sources.table = (rep.sources.table || 0) + 1;
      if (table && table.asRows) rep.sources.union = (rep.sources.union || 0) + 1;
      Object.assign(entry, {
        status: "written", rows: gate.rows, source: rowSource, variant: gate.variant,
        cost: gate.cost, fv: gate.fv,
        table: table ? (table.unusable ? "unusable" : (table.asSource ? `source (${table.taggedJoined} tagged joined)` : `${table.matched}/${gate.rows}`)) : "none",
        rpage: sources.rpage ? `${sources.rpage.matched}/${sources.rpage.rows}` : null,
        nonAccrualSource: summary.nonAccrual.source, industrySource: summary.industrySource, maturitySource: summary.maturitySource,
      });
      if (prose) writeDisclosed(row, filing, prose, terms, companies, entry);
      console.log(`  ${row.ticker} ${filing.form} ${filing.end}: ${gate.rows} rows (${rowSource}${gate.variant === "tagged rows" ? "" : ", " + gate.variant.split(":")[0]}), gate ${gate.cost.diffPct}/${gate.fv.diffPct}, ` +
        `table ${entry.table}${sources.rpage ? `, R ${entry.rpage}` : ""}, NA ${summary.nonAccrual.n} (${summary.nonAccrual.source || "no source"}), ` +
        `yield ${summary.wa.yieldAtCost}, ${Math.round((Date.now() - t0) / 1000)}s`);
    } catch (e) {
      rep.failed.push({ ticker: row.ticker, accn: filing.accn, reason: String(e && e.message || e) });
      Object.assign(entry, { status: "failed", reason: String(e && e.message || e) });
      console.log(`  ${row.ticker} failed: ${String(e && e.message || e)}`);
    }
  }
  rep.finishedAt = new Date().toISOString();
  rep.durationSeconds = Math.round((Date.now() - started) / 1000);
  /* byTicker's key order must not depend on which tickers needed the
     "todo" pass this run: the loop above sets every unchanged ticker's
     key first (in `filers` order) and only then walks `todo` (also in
     `filers` order, but a subsequence), so a ticker settled by the
     instance fallback — never "unchanged" per the fast-path check above,
     since that requires source "dataset" — moves to the end of the key
     order on every ordinary run, and JSON.stringify (writeIfChanged)
     sees that as a changed file even when every value is identical.
     Rebuilding in `filers` order here makes the write depend on content,
     not on which tickers happened to need reprocessing. */
  const ordered = {};
  for (const row of filers) if (byTicker[row.ticker]) ordered[row.ticker] = byTicker[row.ticker];
  return { report: rep, byTicker: ordered };
}

/* composite.json from every holdings file on disk that belongs to the
   universe, with the company files beside them */
function compositeStage(filers, companies, quarter) {
  const members = [];
  for (const row of filers) {
    const h = readJson(join(OUT_DIR, `holdings-${row.ticker}.json`));
    if (!h || !h.gate || !h.gate.passed) continue;
    const company = companies.get(row.ticker) || readJson(join(OUT_DIR, `company-${row.ticker}.json`));
    members.push({ ticker: row.ticker, period: h.period, holdings: h.holdings.map(expandHolding), summary: h.summary, company, disclosed: company && company.disclosed });
  }
  const allCompanies = filers.map((r) => companies.get(r.ticker) || readJson(join(OUT_DIR, `company-${r.ticker}.json`))).filter(Boolean);
  const composite = buildComposite(members, { allCompanies, quarter, generated: new Date().toISOString() });
  composite.n.universe = filers.length;
  const changed = writeIfChangedButStamp(join(OUT_DIR, "composite.json"), composite, "generated");
  return { members: members.length, changed, totals: composite.totals, weighted: composite.weighted, n: composite.n };
}

/* universe.json rows gain acSource and sbaExempt once the prose and
   terms.json have been read */
function stampUniverse(byTicker, terms) {
  const path = join(OUT_DIR, "universe.json");
  const u = readJson(path);
  if (!u || !Array.isArray(u.rows)) return;
  for (const row of u.rows) {
    const company = readJson(join(OUT_DIR, `company-${row.ticker}.json`));
    if (company && company.disclosed && company.disclosed.assetCoverage) row.acSource = company.disclosed.assetCoverage.acSource;
    const t = terms && terms.filers && terms.filers[row.ticker];
    if (t && t.sbaExempt) { row.sbaExempt = t.sbaExempt.value; row.sbaExemptStatus = t.sbaExempt.status || null; }
  }
  void byTicker;
  writeFileSync(path, JSON.stringify(u, null, 1) + "\n", "utf8");
}

/* ---------- run ---------- */
const started = new Date();
const report = {
  startedAt: started.toISOString(),
  quarter: null,
  universe: { framesCandidates: 0, rosterRows: 0, rosterUnanswered: false, withTicker: 0, rows: 0,
              submissionsUnanswered: [], noListingDate: [] },
  companiesAttempted: 0,
  companiesWritten: 0,
  companiesFailed: [],
  companiesRemoved: [],
  findings: [],
  errorCount: 0,
  warnCount: 0,
  flagCount: 0,
  framesFetched: 0,
  rateLimitHits: 0,
  bytesWritten: 0,
  holdings: null,
  composite: null,
};
const finding = (severity, code, message) => {
  report.findings.push({ severity, code, message });
  if (severity === "error") report.errorCount++;
  else report.warnCount++;
};

/* the terms file (sbaExempt per filer) the disclosed block reads */
const terms = readJson(join(OUT_DIR, "terms.json"));

/* a holdings-only or composite-only run reads the committed universe
   and company files and makes no universe or companyfacts request */
const OFFLINE_UNIVERSE = HOLDINGS_ONLY || COMPOSITE_ONLY;

let quarter = QUARTER_ARG;
if (quarter && !quarterEnd(quarter)) {
  console.error(`refresh-bdc: --quarter must look like CY2026Q2, not ${quarter}`);
  process.exit(2);
}

let universe = null;
let universeComplete = false;
const written = new Map();          /* ticker -> company payload written this run */
const companies = new Map();        /* ticker -> company file content (for the holdings stage) */
let list = [];
let tickerSet = new Set();

if (OFFLINE_UNIVERSE) {
  const u = readJson(join(OUT_DIR, "universe.json"));
  if (!u || !Array.isArray(u.rows) || !u.rows.length) {
    console.error("refresh-bdc: no committed universe.json to run the holdings stage against; run a full refresh first");
    process.exit(2);
  }
  quarter = quarter || u.quarter;
  universe = { rows: u.rows, submissions: new Map() };
  tickerSet = new Set(u.rows.map((r) => r.ticker));
  for (const row of u.rows) {
    const c = readJson(join(OUT_DIR, `company-${row.ticker}.json`));
    if (c) companies.set(row.ticker, c);
  }
  report.quarter = quarter;
  report.universe.rows = u.rows.length;
  console.log(`refresh-bdc: ${COMPOSITE_ONLY ? "composite" : "holdings"} only; ${u.rows.length} filers from the committed universe (${companies.size} company files)`);
} else {
  /* the quarter: as asked, or the latest settled one with a frame worth
     reading (a thin frame means the wave has not filed; go back one) */
  if (!quarter) {
    quarter = settledQuarter(started);
    const nav = await frame("NetAssetValuePerShare", "USD/shares", quarter + "I");
    const filers = nav && Array.isArray(nav.data) ? nav.data.length : 0;
    if (filers < MIN_FRAME_FILERS) {
      console.log(`refresh-bdc: ${quarter} NAV frame holds ${filers} filers; using ${previousQuarter(quarter)}`);
      quarter = previousQuarter(quarter);
    }
  }
  report.quarter = quarter;

  universe = await buildUniverse(quarter, report.universe);
  if (!universe || !universe.rows.length) {
    console.error("refresh-bdc: the universe is empty — frames, the ticker index or submissions did not answer");
    process.exit(2);
  }
  report.universe.rows = universe.rows.length;
  console.log(`refresh-bdc: ${quarter}; ${universe.rows.length} listed BDCs from ` +
    `${report.universe.framesCandidates} frames candidates and ${report.universe.rosterRows} roster rows ` +
    `(${report.universe.withTicker} with a ticker)`);

  mkdirSync(OUT_DIR, { recursive: true });
  /* acSource and sbaExempt are stamped after the holdings stage; a
     full run keeps the committed values until then */
  const priorUniverse = readJson(join(OUT_DIR, "universe.json"));
  const priorRows = new Map(((priorUniverse && priorUniverse.rows) || []).map((r) => [r.ticker, r]));
  for (const row of universe.rows) {
    const prior = priorRows.get(row.ticker);
    if (prior) {
      row.acSource = prior.acSource === undefined ? null : prior.acSource;
      row.sbaExempt = prior.sbaExempt === undefined ? null : prior.sbaExempt;
    }
  }
  writeFileSync(join(OUT_DIR, "universe.json"), JSON.stringify({
    generated: started.toISOString(), quarter, rule: "814-",
    notes: { listedSince: LISTED_SINCE_NOTE },
    rows: universe.rows, mergers: MERGERS,
  }, null, 1) + "\n", "utf8");

  /* The acceptance list of blueprint 10.1, checked on every run and
     reported: a universe that lost its anchors or a core metric that
     stopped resolving is a warning here and a hard failure in
     test-bdc-data.mjs on the committed files, so the week's refresh is
     never discarded on a finding the smoke suite will catch. */
  tickerSet = new Set(universe.rows.map((r) => r.ticker));
  if (universe.rows.length < 45 || universe.rows.length > 60) {
    finding("warn", "universe_size", `${universe.rows.length} listed BDCs; expected about 50`);
  }
  for (const t of ["ARCC", "GSBD"]) {
    if (!tickerSet.has(t)) finding("warn", "universe_anchor", `${t} is not in the universe`);
  }
  if (report.universe.noListingDate.length) {
    finding("warn", "listing_date", `no Yahoo chart for ${report.universe.noListingDate.join(", ")}`);
  }
  /* a filer EDGAR did not answer for is missing from universe.json; its
     company file is left where it is and nothing is removed this run */
  if (report.universe.submissionsUnanswered.length) {
    finding("warn", "submissions_unanswered",
      `no submissions JSON for CIK ${report.universe.submissionsUnanswered.join(", ")}; the universe may be short`);
  }
  /* the frames path alone finds 50 of the 53; the roster adds EQS and
     PFX and says who left, so a miss keeps every file and warns */
  if (report.universe.rosterUnanswered) {
    finding("warn", "roster_unanswered", "the SEC BDC roster did not answer after retries; the universe may be short; no file removed");
  }
  universeComplete = !report.universe.submissionsUnanswered.length && !report.universe.rosterUnanswered;

  await prefetchFrames(quarter);
  report.framesFetched = frameCache.size;
}

list = universe.rows;
if (ONLY) list = list.filter((r) => ONLY_SET.has(r.ticker));
if (LIMIT) list = list.slice(0, LIMIT);
if (ONLY && !list.length) {
  console.error(`refresh-bdc: ${ONLY} is not in the universe`);
  process.exit(2);
}

if (!OFFLINE_UNIVERSE) {
  report.companiesAttempted = list.length;
  for (const row of list) {
    if (!row.fyEndMonth) {
      report.companiesFailed.push({ ticker: row.ticker, reason: "no fiscal year end in the submissions JSON" });
      continue;
    }
    let payload = null;
    try {
      payload = await pullFiler(row, universe.submissions.get(row.cik), quarter);
    } catch (e) {
      report.companiesFailed.push({ ticker: row.ticker, reason: String(e && e.message || e) });
      continue;
    }
    if (!payload) {
      report.companiesFailed.push({ ticker: row.ticker, reason: "no companyfacts feed returned" });
      continue;
    }
    if (!payload.series.periods.length) {
      report.companiesFailed.push({ ticker: row.ticker, reason: "no quarter resolved from the feed" });
      continue;
    }
    /* the disclosed block belongs to the holdings stage; the committed
       one rides along until that stage rewrites it, so a --skip-holdings
       run never strips it */
    const cpath = join(OUT_DIR, `company-${row.ticker}.json`);
    const prior = readJson(cpath);
    if (prior && prior.disclosed) {
      const { series, ...head } = payload;
      payload = { ...head, disclosed: prior.disclosed, series };
    }
    /* a filer with an error keeps its previous file; nothing wrong is
       published */
    writeIfChanged(cpath, companyJson(payload));
    written.set(row.ticker, payload);
    companies.set(row.ticker, payload);
    report.companiesWritten++;
    report.flagCount += payload.series.flags.length;
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  if (report.companiesFailed.length > Math.ceil(list.length / 10)) {
    finding("warn", "pull_failures", `${report.companiesFailed.length} of ${list.length} filers failed`);
  }
  if (!report.companiesWritten) {
    finding("error", "nothing_written", `no company file written for ${list.length} filers attempted`);
  }
  /* a filer the pull skipped keeps its committed file for the holdings stage */
  for (const row of list) {
    if (!companies.has(row.ticker)) {
      const c = readJson(join(OUT_DIR, `company-${row.ticker}.json`));
      if (c) companies.set(row.ticker, c);
    }
  }
}

/* coverage is computed after the company files and written after the
   holdings stage, which adds its own block */
let coverage = null;
if (!PARTIAL && !OFFLINE_UNIVERSE) {
  /* a ticker that left the universe leaves its file behind otherwise;
     a universe that may be short because EDGAR did not answer removes
     nothing, since "not in the universe" then proves nothing */
  for (const f of readdirSync(OUT_DIR)) {
    const m = /^(company|holdings)-([A-Z0-9.-]+)\.json$/.exec(f);
    if (!m || tickerSet.has(m[2])) continue;
    if (!universeComplete) {
      finding("warn", "removal_skipped", `${f} is outside the universe but EDGAR did not answer in full; kept`);
      continue;
    }
    unlinkSync(join(OUT_DIR, f));
    report.companiesRemoved.push({ ticker: m[2], file: f, reason: "ticker not in the universe" });
  }
  coverage = coverageOf(written, universe.rows, quarter);
  const core = ["navPerShare", "portfolioFairValue", "portfolioCost", "niiAfterTax"];
  const line = core.map((k) => `${k} ${coverage.metrics[k].n}/${coverage.n}`).join(", ");
  console.log(`refresh-bdc: coverage ${line}`);
  for (const k of core) {
    if (coverage.metrics[k].n < 0.8 * coverage.n) {
      finding("warn", "coverage", `${k} current for ${coverage.metrics[k].n} of ${coverage.n}`);
    }
  }
  /* the committed holdings block stands until the stage below rewrites it */
  const priorCoverage = readJson(join(OUT_DIR, "coverage.json"));
  if (priorCoverage && priorCoverage.holdings) coverage.holdings = priorCoverage.holdings;
} else if (OFFLINE_UNIVERSE && !PARTIAL) {
  coverage = readJson(join(OUT_DIR, "coverage.json"));
} else {
  console.log("refresh-bdc: partial run; coverage.json left as it was");
}

/* ---------- the holdings and composite stages ---------- */
if (!SKIP_HOLDINGS) {
  if (!COMPOSITE_ONLY) {
    const stage = await holdingsStage(list, companies, universe.submissions, { terms });
    report.holdings = stage.report;
    if (!PARTIAL && coverage) {
      const entries = Object.entries(stage.byTicker);
      coverage.holdings = {
        n: entries.filter(([, s]) => s.status === "written").length,
        refused: entries.filter(([, s]) => s.status === "refused").length,
        failed: entries.filter(([, s]) => s.status === "failed").length,
        tickers_refused: entries.filter(([, s]) => s.status === "refused").map(([t, s]) => ({ ticker: t, accn: s.accn, reason: s.reason })),
        tickers_failed: entries.filter(([, s]) => s.status === "failed").map(([t, s]) => ({ ticker: t, reason: s.reason })),
        tickers_missing: list.filter((r) => !stage.byTicker[r.ticker]).map((r) => r.ticker),
        byTicker: stage.byTicker,
      };
      if (stage.report.refused.length + stage.report.failed.length > Math.ceil(list.length / 5)) {
        finding("warn", "holdings_refusals", `${stage.report.refused.length} refused and ${stage.report.failed.length} failed of ${list.length} schedules`);
      }
    }
    if (!stage.report.written && !stage.report.unchanged.length && stage.report.attempted) {
      finding("error", "holdings_nothing_written", `no holdings file written for ${stage.report.attempted} filers attempted`);
    }
  }
  if (!PARTIAL) {
    const comp = compositeStage(universe.rows, companies, quarter);
    report.composite = comp;
    console.log(`refresh-bdc: composite over ${comp.members} filers; total FV ${comp.totals.fv}, cost ${comp.totals.cost}, ` +
      `third-party debt cost ${comp.totals.thirdPartyDebtCost}; yield at cost ${comp.weighted.yieldAtCost} (n ${comp.n.yieldAtCost})${comp.changed ? "" : " (unchanged)"}`);
    if (comp.members < 0.6 * universe.rows.length) {
      finding("warn", "composite_members", `${comp.members} of ${universe.rows.length} filers in the composite`);
    }
    stampUniverse(null, terms);
  }
}

if (coverage && !PARTIAL) writeIfChanged(join(OUT_DIR, "coverage.json"), coverageJson(coverage));

report.rateLimitHits = rateLimitHits.count;
report.finishedAt = new Date().toISOString();
report.durationSeconds = Math.round((Date.now() - started.getTime()) / 1000);
report.bytesWritten = dirBytes(OUT_DIR);
/* a holdings-only or composite-only run keeps the committed report's
   universe and company blocks and replaces the ones it ran */
if (OFFLINE_UNIVERSE) {
  const prior = readJson(join(OUT_DIR, "refresh-report.json"));
  if (prior) {
    const patched = { ...prior };
    if (report.holdings) patched.holdings = report.holdings;
    if (report.composite) patched.composite = report.composite;
    patched.partialRun = { kind: COMPOSITE_ONLY ? "composite-only" : "holdings-only", startedAt: report.startedAt, finishedAt: report.finishedAt,
      durationSeconds: report.durationSeconds, rateLimitHits: report.rateLimitHits, findings: report.findings };
    patched.bytesWritten = report.bytesWritten;
    writeFileSync(join(OUT_DIR, "refresh-report.json"), JSON.stringify(patched, null, 1) + "\n", "utf8");
  } else {
    writeFileSync(join(OUT_DIR, "refresh-report.json"), JSON.stringify(report, null, 1) + "\n", "utf8");
  }
} else {
  writeFileSync(join(OUT_DIR, "refresh-report.json"), JSON.stringify(report, null, 1) + "\n", "utf8");
}

if (!OFFLINE_UNIVERSE) {
  console.log(
    `refresh-bdc: ${report.companiesWritten} written, ${report.companiesFailed.length} skipped, ` +
    `${report.flagCount} series flags, ${report.errorCount} errors, ${report.warnCount} warnings, ` +
    `${report.rateLimitHits} rate-limit hits, ${(report.bytesWritten / 1048576).toFixed(2)} MB on disk, ` +
    `${report.durationSeconds}s`);
}
if (report.holdings) {
  const h = report.holdings;
  console.log(`refresh-bdc: holdings ${h.written} written, ${h.unchanged.length} unchanged, ${h.refused.length} refused, ${h.failed.length} failed; ` +
    `${h.sources.dataset} from the data set, ${h.sources.instance} from instances; ` +
    `${(h.downloads.bytes / 1048576).toFixed(1)} MB downloaded in ${h.downloads.files} files (${h.downloads.requests} requests); ${h.durationSeconds}s`);
  for (const r of h.refused) console.log(`  refused ${r.ticker} ${r.accn}: ${r.reason}${r.cost ? ` (cost ${r.cost.sum} vs ${r.cost.tag}, fv ${r.fv.sum} vs ${r.fv.tag})` : ""}`);
  for (const r of h.failed) console.log(`  failed ${r.ticker}: ${r.reason}`);
}
for (const f of report.companiesFailed.slice(0, 20)) {
  console.log(`  skipped ${f.ticker}: ${f.reason}`);
}
for (const f of report.companiesRemoved) {
  console.log(`  removed ${f.file}: ${f.reason}`);
}
for (const f of report.findings) {
  console.log(`  ${f.severity} ${f.code}: ${f.message}`);
}
if (OFFLINE_UNIVERSE) {
  const ok = COMPOSITE_ONLY ? !!report.composite : (report.holdings && (report.holdings.written > 0 || report.holdings.unchanged.length > 0));
  process.exit(ok ? 0 : 1);
}
process.exit(report.companiesWritten ? 0 : 1);
