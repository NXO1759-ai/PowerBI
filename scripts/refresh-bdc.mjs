/**
 * refresh-bdc.mjs — the weekly refresh of the BDC layer.
 *
 *   node scripts/refresh-bdc.mjs [--ticker ARCC] [--limit N] [--out DIR] [--quarter CY2026Q2]
 *
 * Regenerates the listed-BDC universe from EDGAR, pulls each filer's whole
 * companyfacts feed, merges the calendar-quarter frames where they run
 * ahead of it, and writes under frontend/data/bdc/:
 *
 *   universe.json          the 814-rule universe, with the merger table
 *   company-<TICKER>.json  the quarterly series per filer, every value
 *                          carrying its tag, period, filing and source
 *   coverage.json          which metric each filer tags, and how current
 *   refresh-report.json    what was attempted, written and skipped
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SEC_UA, paced, fetchCompanyFactsRaw, fetchFrame, fetchSubmissions,
  fetchCompanyTickers, rateLimitHits,
} from "./lib/sec-pull.mjs";
import {
  BDC_CONCEPTS, buildBdcSeries, mergeFrames, chooseNii, niiSkipNote, niiOverShares, sharesOffScale,
  NII_SKIP_MIN_QUARTERS, MERGERS, largeGap,
} from "./lib/bdc-concepts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DAY_MS = 86400000;

/* ---------- arguments ---------- */
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const LIMIT = Number(arg("limit", "0")) || 0;
const ONLY = (arg("ticker", "") || "").toUpperCase();
const OUT_DIR = resolve(arg("out", join(ROOT, "frontend/data/bdc")));
const QUARTER_ARG = arg("quarter", "");
/* a run over part of the universe is a debugging run: it writes its
   company files but never a coverage file that would count the rest of
   the universe as missing */
const PARTIAL = Boolean(ONLY || LIMIT);

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
};
const finding = (severity, code, message) => {
  report.findings.push({ severity, code, message });
  if (severity === "error") report.errorCount++;
  else report.warnCount++;
};

/* the quarter: as asked, or the latest settled one with a frame worth
   reading (a thin frame means the wave has not filed; go back one) */
let quarter = QUARTER_ARG;
if (quarter && !quarterEnd(quarter)) {
  console.error(`refresh-bdc: --quarter must look like CY2026Q2, not ${quarter}`);
  process.exit(2);
}
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

const universe = await buildUniverse(quarter, report.universe);
if (!universe || !universe.rows.length) {
  console.error("refresh-bdc: the universe is empty — frames, the ticker index or submissions did not answer");
  process.exit(2);
}
report.universe.rows = universe.rows.length;
console.log(`refresh-bdc: ${quarter}; ${universe.rows.length} listed BDCs from ` +
  `${report.universe.framesCandidates} frames candidates and ${report.universe.rosterRows} roster rows ` +
  `(${report.universe.withTicker} with a ticker)`);

mkdirSync(OUT_DIR, { recursive: true });
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
const tickerSet = new Set(universe.rows.map((r) => r.ticker));
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
const universeComplete = !report.universe.submissionsUnanswered.length && !report.universe.rosterUnanswered;

await prefetchFrames(quarter);
report.framesFetched = frameCache.size;

let list = universe.rows;
if (ONLY) list = list.filter((r) => r.ticker === ONLY);
if (LIMIT) list = list.slice(0, LIMIT);
if (ONLY && !list.length) {
  console.error(`refresh-bdc: ${ONLY} is not in the universe`);
  process.exit(2);
}
report.companiesAttempted = list.length;

const written = new Map();
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
  /* a filer with an error keeps its previous file; nothing wrong is
     published */
  writeIfChanged(join(OUT_DIR, `company-${row.ticker}.json`), companyJson(payload));
  written.set(row.ticker, payload);
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

if (!PARTIAL) {
  /* a ticker that left the universe leaves its file behind otherwise;
     a universe that may be short because EDGAR did not answer removes
     nothing, since "not in the universe" then proves nothing */
  for (const f of readdirSync(OUT_DIR)) {
    const m = /^company-([A-Z0-9.-]+)\.json$/.exec(f);
    if (!m || tickerSet.has(m[1])) continue;
    if (!universeComplete) {
      finding("warn", "removal_skipped", `${f} is outside the universe but EDGAR did not answer in full; kept`);
      continue;
    }
    unlinkSync(join(OUT_DIR, f));
    report.companiesRemoved.push({ ticker: m[1], file: f, reason: "ticker not in the universe" });
  }
  const coverage = coverageOf(written, universe.rows, quarter);
  writeIfChanged(join(OUT_DIR, "coverage.json"), coverageJson(coverage));
  const core = ["navPerShare", "portfolioFairValue", "portfolioCost", "niiAfterTax"];
  const line = core.map((k) => `${k} ${coverage.metrics[k].n}/${coverage.n}`).join(", ");
  console.log(`refresh-bdc: coverage ${line}`);
  for (const k of core) {
    if (coverage.metrics[k].n < 0.8 * coverage.n) {
      finding("warn", "coverage", `${k} current for ${coverage.metrics[k].n} of ${coverage.n}`);
    }
  }
} else {
  console.log("refresh-bdc: partial run; coverage.json left as it was");
}

report.rateLimitHits = rateLimitHits.count;
report.finishedAt = new Date().toISOString();
report.durationSeconds = Math.round((Date.now() - started.getTime()) / 1000);
report.bytesWritten = dirBytes(OUT_DIR);
writeFileSync(join(OUT_DIR, "refresh-report.json"), JSON.stringify(report, null, 1) + "\n", "utf8");

console.log(
  `refresh-bdc: ${report.companiesWritten} written, ${report.companiesFailed.length} skipped, ` +
  `${report.flagCount} series flags, ${report.errorCount} errors, ${report.warnCount} warnings, ` +
  `${report.rateLimitHits} rate-limit hits, ${(report.bytesWritten / 1048576).toFixed(2)} MB on disk, ` +
  `${report.durationSeconds}s`);
for (const f of report.companiesFailed.slice(0, 20)) {
  console.log(`  skipped ${f.ticker}: ${f.reason}`);
}
for (const f of report.companiesRemoved) {
  console.log(`  removed ${f.file}: ${f.reason}`);
}
for (const f of report.findings) {
  console.log(`  ${f.severity} ${f.code}: ${f.message}`);
}
process.exit(report.companiesWritten ? 0 : 1);
