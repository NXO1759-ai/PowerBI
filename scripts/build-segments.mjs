/**
 * build-segments.mjs — segment, product-line and geographic revenue for
 * every covered company, from each one's latest annual filing.
 *
 * The companyfacts feed the rest of the terminal reads is dimensionless:
 * it carries "revenue" but not "iPhone revenue", because the axis that
 * distinguishes them is stripped before the API serves the fact. The full
 * detail is in the filing's own XBRL instance — the machine-readable copy
 * of the segment note in Part II Item 8 and the disaggregation table
 * behind the MD&A — which EDGAR exposes as the *_htm.xml file in every
 * filing directory.
 *
 * One instance per company, three requests each (submissions, directory
 * index, instance). A filing's segment note shows three fiscal years, so
 * one pull yields a three-year trend without touching older filings.
 *
 * Facts are kept only when they carry EXACTLY one of the three axes
 * (business segment, product or service, geography). A fact carrying two
 * — Server products *within* Intelligent Cloud — is a cell of a matrix,
 * and adding it alongside the pure slices would double-count.
 *
 * Years are keyed by PERIOD END DATE, not a fiscal-year label. The
 * panel's calendar alignment renames Microsoft's FY2026 to 2025 so that
 * companies with different year-ends can be aggregated; segment data is
 * only ever shown for one company at a time, so it keeps the filing's own
 * dating and the page prints the period end with it.
 *
 * Output: frontend/data/segments.js, values in FULL dollars.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { unzipMember, parseInstance, dropAggregates } from "./lib/filing-parse.mjs";
import { inflateRawSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UA = { headers: { "User-Agent": process.env.SEC_USER_AGENT ||
  "Research Terminal research@chineduokeke.mba" } };

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf("--" + name);
  return i !== -1 ? argv[i + 1] : null;
};
const ONLY = (arg("ticker") || "").toUpperCase();
const LIMIT = Number(arg("limit") || 0) || 0;

/* ---------- pacing: one global gate shared by all workers ---------- */
const MIN_INTERVAL_MS = Number(process.env.SEC_MIN_INTERVAL_MS || 125);
let nextSlotAt = 0;
async function paced() {
  const now = Date.now();
  const wait = Math.max(0, nextSlotAt - now);
  nextSlotAt = Math.max(now, nextSlotAt) + MIN_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
async function fetch200(url) {
  for (let a = 0; a < 5; a++) {
    await paced();
    let r;
    try {
      r = await fetch(url, UA);
    } catch (e) {
      /* Connection drops are how SEC sheds load when the request rate is
         fine but the byte rate is not — instance files run to 10MB. They
         deserve the same backoff as a 429, not a hard failure. */
      await new Promise((s) => setTimeout(s, 2500 * (a + 1)));
      continue;
    }
    if (r.ok) return r;
    if (r.status === 429 || r.status >= 500) {
      await new Promise((s) => setTimeout(s, 1500 * (a + 1)));
      continue;
    }
    throw new Error("HTTP " + r.status);
  }
  throw new Error("retries exhausted");
}

/* Parsers live in scripts/lib/filing-parse.mjs, shared with the
   on-demand endpoints. */

/* ---------- per company ---------- */
async function fetchInstance(cik, accession) {
  const accn = accession.replace(/-/g, "");
  const base = "https://www.sec.gov/Archives/edgar/data/" + Number(cik) + "/" + accn;
  const idx = await (await fetch200(base + "/index.json")).json();
  const inst = idx.directory.item.find((f) => /_htm\.xml$/.test(f.name));
  if (inst) return (await fetch200(base + "/" + inst.name)).text();
  /* zip-only dissemination: the archive is the whole filing. Prefer an
     extracted instance inside it; fall back to the inline-XBRL primary
     document, which parseInstance also reads. */
  const zip = idx.directory.item.find((f) => f.name.endsWith("-xbrl.zip"));
  if (!zip) return null;
  const buf = await (await fetch200(base + "/" + zip.name)).arrayBuffer();
  return unzipMember(buf, /_htm[.]xml$/) || unzipMember(buf, /-[0-9]{8}[.]xml$/) ||
         unzipMember(buf, /-[0-9]{8}[.]htm$/);
}

async function pull(ticker, cik) {
  const c10 = String(cik).padStart(10, "0");
  const sub = await (await fetch200("https://data.sec.gov/submissions/CIK" + c10 + ".json")).json();
  const r = sub.filings.recent;
  let acc = null, form = null, rd = null, qAcc = null, qRd = null;
  for (let i = 0; i < r.form.length; i++) {
    /* 20-F and 40-F are the foreign-filer annual forms; their segment
       notes tag the same way. Foreign filers file no 10-Q, so the
       quarterly side is simply absent for them. */
    if (!acc && /^(10-K|20-F|40-F)$/.test(r.form[i])) {
      acc = r.accessionNumber[i]; form = r.form[i]; rd = r.reportDate[i];
    }
    if (!qAcc && r.form[i] === "10-Q") {
      qAcc = r.accessionNumber[i]; qRd = r.reportDate[i];
    }
    if (acc && qAcc) break;
  }
  if (!acc) return { ticker, error: "no annual filing" };
  const x = await fetchInstance(cik, acc);
  if (!x) return { ticker, error: "no extracted instance", form, accession: acc };
  const parsed = parseInstance(x);
  const revenue = parsed.revenue;
  const quarterly = parsed.quarterly;
  const segmentOperatingIncome = parsed.segmentOperatingIncome;
  /* The latest 10-Q supplies the newest discrete quarter and its
     prior-year comparative, so the segment tables can show the most
     recent quarter and its growth without waiting for the next 10-K. */
  if (qAcc) {
    try {
      const qx = await fetchInstance(cik, qAcc);
      if (qx) {
        const qp = parseInstance(qx);
        for (const kind of Object.keys(quarterly)) {
          for (const [end, members] of Object.entries(qp.quarterly[kind])) {
            const o = (quarterly[kind][end] = quarterly[kind][end] || {});
            for (const [k, v] of Object.entries(members)) if (!(k in o)) o[k] = v;
          }
        }
      }
    } catch (e) { /* the annual data stands on its own */ }
  }
  for (const k of Object.keys(revenue)) dropAggregates(revenue[k]);
  for (const k of Object.keys(quarterly)) dropAggregates(quarterly[k]);
  const n = (o) => Object.keys(o).length;
  return {
    ticker, form, accession: acc, reportDate: rd,
    qReportDate: qRd || null,
    revenue, quarterly, segmentOperatingIncome,
    empty: !n(revenue.segment) && !n(revenue.product) && !n(revenue.geography),
  };
}

/* ---------- main ---------- */
const stub = {};
new Function("window", readFileSync(join(ROOT, "frontend/data/strategy-panel.js"), "utf8"))(stub);
let universe = Object.entries(stub.STRATEGY_PANEL)
  .map(([t, c]) => ({ ticker: t, cik: c.cik }));
if (ONLY) universe = universe.filter((u) => u.ticker === ONLY);
if (LIMIT) universe = universe.slice(0, LIMIT);
console.log("segments: " + universe.length + " companies");

const out = {};
const failures = [];
let done = 0;
const CONCURRENCY = 2;
const queue = universe.slice();
async function worker() {
  for (;;) {
    const u = queue.shift();
    if (!u) return;
    try {
      const res = await pull(u.ticker, u.cik);
      if (res.error) failures.push(u.ticker + ": " + res.error);
      else if (res.empty) failures.push(u.ticker + ": no tagged segment data");
      else out[u.ticker] = { form: res.form, accession: res.accession,
        reportDate: res.reportDate, qReportDate: res.qReportDate,
        revenue: res.revenue, quarterly: res.quarterly,
        segmentOperatingIncome: res.segmentOperatingIncome };
    } catch (e) {
      failures.push(u.ticker + ": " + e.message);
    }
    done++;
    if (done % 10 === 0) process.stdout.write(done + " ");
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log("");

const body =
  "// GENERATED by scripts/build-segments.mjs — do not edit.\n" +
  "// Segment, product-line and geographic revenue from each company's\n" +
  "// latest annual filing (10-K/20-F/40-F), read from the filing's XBRL\n" +
  "// instance. Values are FULL DOLLARS. Years keyed by period end date.\n" +
  "window.SEGMENT_DATA = " + JSON.stringify(out) + ";\n";
writeFileSync(join(ROOT, "frontend/data/segments.js"), body);
console.log("wrote frontend/data/segments.js — " + Math.round(body.length / 1024) + "KB");
console.log(Object.keys(out).length + " companies with segment data, " + failures.length + " without");
if (failures.length) console.log("without:\n  " + failures.join("\n  "));
