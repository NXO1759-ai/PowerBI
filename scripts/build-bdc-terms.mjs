/**
 * build-bdc-terms.mjs — the fee schedule, the SBA exemption, the target
 * leverage range and the statutory coverage floor of every listed BDC,
 * read from the prose of its latest 10-Q or 10-K.
 *
 *   node scripts/build-bdc-terms.mjs [--ticker MAIN] [--limit N] [--offline] [--out FILE]
 *
 * Reads frontend/data/bdc/universe.json for the filers and each
 * company-<TICKER>.json for its latestFiling, fetches that filing's main
 * document (the inline-XBRL 10-Q, 5 to 25 MB each) through the paced
 * gate in sec-pull.mjs with the same User-Agent, streams it to
 * .cache/bdc/docs/<accession>.htm, and runs scripts/lib/bdc-prose.mjs
 * over it. The result is frontend/data/bdc/terms.json (blueprint 4.3,
 * the fee card; 4.2, sbaExempt and the statutory cushion):
 *
 *   filers[TICKER] = {
 *     sbaExempt:  { value, status, sentence, accn }
 *     fees:       { managementFeeRate, incentiveIncomeRate, hurdle, catchUp,
 *                   capitalGainsRate, internallyManaged, sentence, accn }
 *     targetLeverage: { low, high, sentence, accn } | null
 *     statutoryCoverage: { value: 150 | 200 | null, sentence, accn }
 *   }
 *
 * Every value carries the sentence it was read from and the accession
 * of the filing. A document that lacks the sentence leaves the value
 * null; nothing here is typed in from memory. The one seed is the list
 * of filers the blueprint names as holding SBA exemptive relief (MAIN,
 * FDUS, CSWC, GAIN, GLAD, SAR, OFS): each is written as
 * "unconfirmed seed" until its own document carries the sentence that
 * says the relief was received, and "confirmed" once it does. A filer
 * outside the seed whose document carries the sentence is confirmed the
 * same way. The four internally managed BDCs (MAIN, HTGC, TRIN, CSWC)
 * are taken from their own "internally managed" sentence, and a filer
 * that says so gets no fee rates, whatever fee sentences its document
 * carries (Main Street's 10-Q describes the fees it earns as MSC
 * Income's adviser, which are not fees it pays).
 *
 * The cache directory is gitignored. A cached document is validated
 * with a conditional request (If-Modified-Since / If-None-Match) and
 * fetched again only when the SEC answers 200 with a changed
 * Last-Modified or size; a filing never changes, so after the first
 * run this costs one request per filer and no bytes. --offline reads
 * the cache alone and skips filers with no cached document.
 *
 * Exit codes: 0 when terms.json was written (or is unchanged), 1 when
 * no filer could be read, 2 when the universe file is missing.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, statSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { SEC_UA, paced, fetchSubmissions, rateLimitHits } from "./lib/sec-pull.mjs";
import { extractProse } from "./lib/bdc-prose.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "frontend/data/bdc");
const CACHE_DIR = resolve(process.env.BDC_CACHE_DIR || join(ROOT, ".cache/bdc/docs"));

/* ---------- arguments ---------- */
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const LIMIT = Number(arg("limit", "0")) || 0;
const ONLY = (arg("ticker", "") || "").toUpperCase();
const OFFLINE = argv.includes("--offline");
const OUT = resolve(arg("out", join(DATA_DIR, "terms.json")));

/* Blueprint-v2 4.2: the filers named as holding exemptive relief to
   exclude SBA-guaranteed debentures from the asset coverage test. A seed,
   not a fact, until the filing's sentence confirms it. */
const SBA_SEED = ["MAIN", "FDUS", "CSWC", "GAIN", "GLAD", "SAR", "OFS"];
/* Blueprint 4.2: the internally managed BDCs. Taken from each filer's own
   sentence; the list only names who is expected to say so. */
const INTERNAL_EXPECTED = ["MAIN", "HTGC", "TRIN", "CSWC"];

/* ---------- the main document ---------- */

/* One streamed download, the body written to a temporary file and
   renamed on completion so a dropped connection never leaves a partial
   document under the accession's name. Retries a 429, a 403 (www.sec.gov
   answers bursts with it) and a 5xx with backoff, like getJson. */
async function download(url, dest, { conditional = null, retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await paced();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    try {
      const headers = { ...SEC_UA };
      if (conditional && conditional.lastModified) headers["If-Modified-Since"] = conditional.lastModified;
      if (conditional && conditional.etag) headers["If-None-Match"] = conditional.etag;
      const resp = await fetch(url, { headers, signal: ctrl.signal });
      if (resp.status === 304) { if (resp.body) await resp.body.cancel(); return { status: 304 }; }
      if (resp.status === 404) { if (resp.body) await resp.body.cancel(); return { status: 404 }; }
      if (resp.status === 429 || resp.status === 403 || resp.status >= 500) {
        rateLimitHits.count++;
        if (resp.body) await resp.body.cancel();
        if (attempt === retries) return { status: resp.status };
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
        continue;
      }
      if (!resp.ok) { if (resp.body) await resp.body.cancel(); return { status: resp.status }; }
      const tmp = dest + ".part";
      await pipeline(Readable.fromWeb(resp.body), createWriteStream(tmp));
      renameSync(tmp, dest);
      return {
        status: 200,
        lastModified: resp.headers.get("last-modified"),
        etag: resp.headers.get("etag"),
        contentLength: resp.headers.get("content-length"),
      };
    } catch (e) {
      if (attempt === retries) return { status: 0, error: String(e && e.message || e) };
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 0 };
}

const metaPath = (accn) => join(CACHE_DIR, `${accn}.meta.json`);
const docPath = (accn) => join(CACHE_DIR, `${accn}.htm`);

function readMeta(accn) {
  try { return JSON.parse(readFileSync(metaPath(accn), "utf8")); } catch { return null; }
}

/* The filing's primary document, from the submissions feed: the row
   whose accession matches names it (arcc-20260630.htm). */
async function primaryDocument(cik, accn) {
  const sub = await fetchSubmissions(cik);
  const r = sub && sub.filings && sub.filings.recent;
  if (!r || !Array.isArray(r.accessionNumber)) return null;
  const i = r.accessionNumber.indexOf(accn);
  if (i === -1 || !r.primaryDocument || !r.primaryDocument[i]) return null;
  return r.primaryDocument[i];
}

/**
 * The main document for a filing, from the cache when it is current.
 * Returns { path, meta, fetched: "cached" | "validated" | "downloaded" }
 * or null with a reason.
 */
async function mainDocument(row, filing, log) {
  const accn = filing.accn;
  const meta = readMeta(accn);
  const cached = meta && existsSync(docPath(accn)) && statSync(docPath(accn)).size > 0;
  if (OFFLINE) {
    if (cached) return { path: docPath(accn), meta, fetched: "cached" };
    return { error: "not cached (offline run)" };
  }
  let url = cached ? meta.url : null;
  if (!url) {
    const doc = await primaryDocument(row.cik, accn);
    if (!doc) return { error: "primary document not found in submissions" };
    url = `https://www.sec.gov/Archives/edgar/data/${row.cik}/${accn.replace(/-/g, "")}/${doc}`;
  }
  const res = await download(url, docPath(accn), { conditional: cached ? meta : null });
  if (res.status === 304) return { path: docPath(accn), meta, fetched: "validated" };
  if (res.status !== 200) {
    if (cached) { log(`${row.ticker}: SEC answered ${res.status}; using the cached document`); return { path: docPath(accn), meta, fetched: "cached" }; }
    return { error: `download failed (${res.status}${res.error ? ": " + res.error : ""})` };
  }
  const newMeta = {
    ticker: row.ticker, cik: row.cik, accn, form: filing.form, period: filing.end, filed: filing.filed,
    url, lastModified: res.lastModified, etag: res.etag, contentLength: res.contentLength,
    fetched: new Date().toISOString().slice(0, 19),
  };
  writeFileSync(metaPath(accn), JSON.stringify(newMeta, null, 1));
  return { path: docPath(accn), meta: newMeta, fetched: "downloaded" };
}

/* ---------- terms ---------- */

const val = (f) => (f && f.v !== undefined && f.v !== null ? f.v : null);
const sent = (f) => (f && f.sentence ? f.sentence : null);

function termsFor(ticker, accn, prose) {
  const internal = prose.internallyManaged;
  const isInternal = internal ? internal.v === true : false;
  const f = prose.fees || {};
  const feeSentence = [f.managementFeeRate, f.incentiveIncomeRate, f.hurdle, f.catchUp, f.capitalGainsRate]
    .filter((x) => x && x.sentence).map((x) => x.sentence);
  const feeSentences = [...new Set(feeSentence)];
  const fees = isInternal
    ? { managementFeeRate: null, incentiveIncomeRate: null, hurdle: null, catchUp: null, capitalGainsRate: null,
        internallyManaged: true, sentence: internal.sentence, accn }
    : { managementFeeRate: val(f.managementFeeRate), incentiveIncomeRate: val(f.incentiveIncomeRate),
        hurdle: val(f.hurdle), catchUp: val(f.catchUp), capitalGainsRate: val(f.capitalGainsRate),
        internallyManaged: internal ? internal.v : null,
        sentence: feeSentences.length ? feeSentences.join(" || ") : sent(internal), accn };
  if (!isInternal && f.hurdleAnnual != null) fees.hurdleAnnual = f.hurdleAnnual;
  if (!isInternal && f.managementFeeTier) fees.managementFeeTier = { rate: f.managementFeeTier.v, above: f.managementFeeTier.above, sentence: f.managementFeeTier.sentence };

  const sba = prose.sbaExempt;
  const seeded = SBA_SEED.includes(ticker);
  let sbaExempt;
  if (sba && sba.v === true) sbaExempt = { value: true, status: "confirmed", sentence: sba.sentence, accn };
  else if (sba && sba.v === false) sbaExempt = { value: false, status: "confirmed", sentence: sba.sentence, accn };
  else if (seeded) sbaExempt = { value: true, status: "unconfirmed seed", sentence: null, accn };
  else sbaExempt = { value: null, status: "not stated", sentence: null, accn };

  const tl = prose.targetLeverage;
  const targetLeverage = tl ? { low: tl.low, high: tl.high, sentence: tl.sentence, accn } : null;
  const sc = prose.statutoryCoverage;
  const statutoryCoverage = { value: sc ? sc.v : null, sentence: sent(sc), accn };
  /* the filer's own ratio beside the floor, when the prose states it */
  const ac = prose.assetCoveragePct;
  if (ac) statutoryCoverage.stated = { pct: ac.pct, sbaRelief: ac.sbaRelief, sentence: ac.sentence };
  return { sbaExempt, fees, targetLeverage, statutoryCoverage };
}

/* ---------- main ---------- */

async function main() {
  const universePath = join(DATA_DIR, "universe.json");
  if (!existsSync(universePath)) { console.error("universe.json not found; run refresh-bdc.mjs first"); return 2; }
  const universe = JSON.parse(readFileSync(universePath, "utf8"));
  let rows = (universe.rows || []).filter((r) => r.ticker);
  if (ONLY) rows = rows.filter((r) => r.ticker === ONLY);
  if (LIMIT) rows = rows.slice(0, LIMIT);
  mkdirSync(CACHE_DIR, { recursive: true });

  const log = (s) => console.log(s);
  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  const filers = previous && (ONLY || LIMIT) ? { ...(previous.filers || {}) } : {};
  const skipped = [];
  const counts = { documents: 0, downloaded: 0, validated: 0, cached: 0 };

  for (const row of rows) {
    const companyPath = join(DATA_DIR, `company-${row.ticker}.json`);
    if (!existsSync(companyPath)) { skipped.push({ ticker: row.ticker, reason: "no company file" }); continue; }
    const company = JSON.parse(readFileSync(companyPath, "utf8"));
    const filing = company.latestFiling;
    if (!filing || !filing.accn) { skipped.push({ ticker: row.ticker, reason: "no latest filing" }); continue; }
    const doc = await mainDocument(row, filing, log);
    if (!doc || doc.error) { skipped.push({ ticker: row.ticker, accn: filing.accn, reason: doc ? doc.error : "no document" }); log(`${row.ticker}: ${doc ? doc.error : "no document"}`); continue; }
    counts.documents++;
    counts[doc.fetched]++;
    const html = readFileSync(doc.path, "utf8");
    const prose = extractProse(html, { ticker: row.ticker, period: filing.end });
    filers[row.ticker] = {
      cik: row.cik, form: filing.form, period: filing.end, filed: filing.filed, accn: filing.accn,
      ...termsFor(row.ticker, filing.accn, prose),
    };
    const t = filers[row.ticker];
    log(`${row.ticker} ${filing.form} ${filing.accn} (${doc.fetched}): mgmt ${t.fees.managementFeeRate} inc ${t.fees.incentiveIncomeRate} hurdle ${t.fees.hurdle} catch ${t.fees.catchUp} gains ${t.fees.capitalGainsRate} internal ${t.fees.internallyManaged} sba ${t.sbaExempt.value}/${t.sbaExempt.status} lev ${t.targetLeverage ? t.targetLeverage.low + "-" + t.targetLeverage.high : null} cov ${t.statutoryCoverage.value}`);
  }

  if (!Object.keys(filers).length) { console.error("no filer could be read"); return 1; }

  /* how many of the filers filled each field */
  const tickers = Object.keys(filers).sort();
  const n = tickers.length;
  const count = (fn) => tickers.filter((t) => fn(filers[t])).length;
  const coverage = {
    filers: n,
    managementFeeRate: count((f) => f.fees.managementFeeRate !== null),
    incentiveIncomeRate: count((f) => f.fees.incentiveIncomeRate !== null),
    hurdle: count((f) => f.fees.hurdle !== null),
    catchUp: count((f) => f.fees.catchUp !== null),
    capitalGainsRate: count((f) => f.fees.capitalGainsRate !== null),
    internallyManaged: count((f) => f.fees.internallyManaged === true),
    internallyManagedStated: count((f) => f.fees.internallyManaged !== null),
    sbaExemptConfirmed: count((f) => f.sbaExempt.status === "confirmed"),
    sbaExemptSeedUnconfirmed: count((f) => f.sbaExempt.status === "unconfirmed seed"),
    targetLeverage: count((f) => f.targetLeverage !== null),
    statutoryCoverage: count((f) => f.statutoryCoverage.value !== null),
    statutoryCoverage200: count((f) => f.statutoryCoverage.value === 200),
    statedCoverage: count((f) => f.statutoryCoverage.stated),
  };
  const notes = [];
  for (const t of INTERNAL_EXPECTED) {
    if (filers[t] && filers[t].fees.internallyManaged !== true) notes.push(`${t} is expected to be internally managed and its document does not say so`);
  }
  for (const t of SBA_SEED) {
    if (filers[t] && filers[t].sbaExempt.status !== "confirmed") notes.push(`${t} is on the SBA seed list and its document does not state the exemptive relief`);
  }
  const internalOthers = tickers.filter((t) => filers[t].fees.internallyManaged === true && !INTERNAL_EXPECTED.includes(t));
  if (internalOthers.length) notes.push(`internally managed by their own sentence, outside the expected four: ${internalOthers.join(", ")}`);

  const out = {
    generated: new Date().toISOString().slice(0, 19),
    source: "the prose of each filer's latest 10-Q or 10-K main document, read by scripts/lib/bdc-prose.mjs",
    seed: { sbaExempt: SBA_SEED, note: "seed filers are 'unconfirmed seed' until their own filing states the exemptive relief" },
    coverage,
    notes,
    skipped,
    filers: Object.fromEntries(tickers.map((t) => [t, filers[t]])),
  };
  /* written only when something other than the timestamp changed, so a
     weekly run over the same filings leaves the file untouched */
  const text = JSON.stringify(out, null, 1) + "\n";
  let changed = true;
  if (existsSync(OUT)) {
    try {
      const prev = JSON.parse(readFileSync(OUT, "utf8"));
      prev.generated = out.generated;
      changed = JSON.stringify(prev, null, 1) + "\n" !== text;
    } catch { changed = true; }
  }
  if (changed) writeFileSync(OUT, text, "utf8");
  console.log(`\n${changed ? "wrote" : "unchanged"} ${OUT}: ${n} filers (${counts.downloaded} downloaded, ${counts.validated} validated, ${counts.cached} cached; ${skipped.length} skipped; ${rateLimitHits.count} throttled answers)`);
  console.log("coverage " + JSON.stringify(coverage));
  for (const s of notes) console.log("note: " + s);
  return 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
