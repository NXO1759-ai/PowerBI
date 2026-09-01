/**
 * /api/segments.js — Vercel serverless function.
 *
 * Segment, product-line and geographic revenue for ONE company, on
 * demand, parsed from its latest annual filing's XBRL instance exactly
 * the way the weekly builder does it — same parser, same aggregate-drop,
 * same shape as frontend/data/segments.js entries. This is what lets a
 * live-pulled company show the same disaggregation the 130 covered
 * companies get from the weekly build.
 *
 *   GET /api/segments?ticker=CROX&cik=1334036[&force=1]
 *
 * Cached per CIK for a day: filings change on filing cadence.
 */

import { unzipMember, parseInstance, dropAggregates } from "../scripts/lib/filing-parse.mjs";
import { SEC_UA } from "../scripts/lib/sec-pull.mjs";

export const maxDuration = 60;

const cache = globalThis.__segCache || (globalThis.__segCache = new Map());
const TTL = 24 * 60 * 60 * 1000;

let nextSlotAt = 0;
async function paced() {
  const now = Date.now();
  const wait = Math.max(0, nextSlotAt - now);
  nextSlotAt = Math.max(now, nextSlotAt) + 125;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
async function getSec(url, timeoutMs) {
  await paced();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 30000);
  try {
    const r = await fetch(url, { headers: SEC_UA, signal: ctrl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r;
  } finally { clearTimeout(t); }
}

async function fetchInstance(cik, accession) {
  const accn = accession.replace(/-/g, "");
  const base = "https://www.sec.gov/Archives/edgar/data/" + Number(cik) + "/" + accn;
  const idx = await (await getSec(base + "/index.json")).json();
  const inst = idx.directory.item.find((f) => /_htm\.xml$/.test(f.name));
  if (inst) return (await getSec(base + "/" + inst.name, 45000)).text();
  const zip = idx.directory.item.find((f) => f.name.endsWith("-xbrl.zip"));
  if (!zip) return null;
  const buf = await (await getSec(base + "/" + zip.name, 45000)).arrayBuffer();
  return unzipMember(buf, /_htm[.]xml$/) || unzipMember(buf, /-[0-9]{8}[.]xml$/) ||
         unzipMember(buf, /-[0-9]{8}[.]htm$/);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = req.query || {};
  const cik = String(q.cik || "").replace(/\D/g, "");
  if (!cik) return res.status(400).json({ error: "cik required" });
  const force = q.force === "1" || q.force === "true";
  const hit = cache.get(cik);
  if (!force && hit && Date.now() - hit.at < TTL) {
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=86400");
    return res.status(200).json(hit.payload);
  }
  try {
    const c10 = cik.padStart(10, "0");
    const sub = await (await getSec("https://data.sec.gov/submissions/CIK" + c10 + ".json")).json();
    const r = sub.filings.recent;
    let acc = null, form = null, rd = null, qAcc = null, qRd = null;
    for (let i = 0; i < r.form.length; i++) {
      if (!acc && /^(10-K|20-F|40-F)$/.test(r.form[i])) {
        acc = r.accessionNumber[i]; form = r.form[i]; rd = r.reportDate[i];
      }
      if (!qAcc && r.form[i] === "10-Q") {
        qAcc = r.accessionNumber[i]; qRd = r.reportDate[i];
      }
      if (acc && qAcc) break;
    }
    /* No annual report yet: the latest 10-Q becomes the primary
       instance. Its segment note carries the quarter and the year to
       date rather than fiscal years, so the annual axes stay empty and
       the quarterly ones fill — the page reads whichever it has. */
    if (!acc && qAcc) { acc = qAcc; form = "10-Q"; rd = qRd; qAcc = null; }
    if (!acc) return res.status(404).json({ error: "no periodic filing" });
    const x = await fetchInstance(cik, acc);
    if (!x) return res.status(404).json({ error: "no readable instance" });
    const parsed = parseInstance(x);
    const revenue = parsed.revenue;
    const quarterly = parsed.quarterly;
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
      } catch (e) { /* annual stands alone */ }
    }
    for (const k of Object.keys(revenue)) dropAggregates(revenue[k]);
    for (const k of Object.keys(quarterly)) dropAggregates(quarterly[k]);
    const payload = {
      form: form, accession: acc, reportDate: rd, qReportDate: qRd || null,
      revenue: revenue, quarterly: quarterly,
      segmentOperatingIncome: parsed.segmentOperatingIncome,
    };
    cache.set(cik, { at: Date.now(), payload: payload });
    res.setHeader("Cache-Control",
      force ? "no-store" : "s-maxage=86400, stale-while-revalidate=86400");
    return res.status(200).json(payload);
  } catch (e) {
    return res.status(502).json({ error: "SEC unavailable", detail: String(e.message || e) });
  }
}
