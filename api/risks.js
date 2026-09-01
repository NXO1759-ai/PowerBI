/**
 * /api/risks.js — Vercel serverless function.
 *
 * One company's risk register on demand: the Item 1A headings of its
 * latest annual filing, extracted with the same parser the weekly
 * builder uses and shaped like frontend/data/risks.js entries. Lets a
 * live-pulled company show its own risk register instead of an absence
 * message.
 *
 *   GET /api/risks?cik=1334036[&force=1]
 */

import { strip, extractItem1A, extractHeadings, extractProspectusRisks } from "../scripts/lib/filing-parse.mjs";
import { SEC_UA } from "../scripts/lib/sec-pull.mjs";

export const maxDuration = 60;

const cache = globalThis.__riskCache || (globalThis.__riskCache = new Map());
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
    let acc = null, rd = null, doc = null, form = null;
    for (let i = 0; i < r.form.length; i++) {
      if (/^(10-K|20-F|40-F)$/.test(r.form[i])) {
        acc = r.accessionNumber[i]; rd = r.reportDate[i]; doc = r.primaryDocument[i]; form = r.form[i];
        break;
      }
    }
    /* A company with no annual report yet still files Item 1A in Part II
       of each 10-Q — a new listing typically repeats its prospectus risk
       factors there in full. The register reads from the latest 10-Q in
       that case and says so. */
    if (!acc) {
      for (let i = 0; i < r.form.length; i++) {
        if (r.form[i] === "10-Q") {
          acc = r.accessionNumber[i]; rd = r.reportDate[i]; doc = r.primaryDocument[i]; form = "10-Q";
          break;
        }
      }
    }
    if (!acc || !doc) return res.status(404).json({ error: "no periodic filing" });
    let url = "https://www.sec.gov/Archives/edgar/data/" + Number(cik) + "/" +
      acc.replace(/-/g, "") + "/" + doc;
    let html = await (await getSec(url, 45000)).text();
    let section = extractItem1A(html);
    let headings = section ? extractHeadings(section) : [];
    /* A 10-Q's Item 1A that only points back to the prospectus yields no
       headings. The prospectus itself carries the full register under a
       plain "Risk Factors" heading, so it is read next. */
    if (headings.length < 5) {
      let pAcc = null, pDoc = null, pForm = null;
      for (const want of ["424B4", "424B3", "S-1/A", "S-1", "F-1"]) {
        for (let i = 0; i < r.form.length; i++) {
          if (r.form[i] === want) { pAcc = r.accessionNumber[i]; pDoc = r.primaryDocument[i]; pForm = want; break; }
        }
        if (pAcc) break;
      }
      if (pAcc && pDoc) {
        const pUrl = "https://www.sec.gov/Archives/edgar/data/" + Number(cik) + "/" +
          pAcc.replace(/-/g, "") + "/" + pDoc;
        try {
          const pHtml = await (await getSec(pUrl, 45000)).text();
          const pSection = extractProspectusRisks(pHtml);
          const pHeadings = pSection ? extractHeadings(pSection) : [];
          if (pHeadings.length >= 5) {
            section = pSection; headings = pHeadings; form = pForm;
            url = pUrl;
          }
        } catch (e) { /* the periodic filing's answer stands */ }
      }
    }
    let payload;
    if (!section) {
      payload = { form: form, reportDate: rd, url: url, words: null, headings: [], extracted: false };
    } else {
      const words = strip(section).split(" ").length;
      if (headings.length > 40) headings = headings.slice(0, 40);
      payload = { form: form, reportDate: rd, url: url, words: words,
        headings: headings.length >= 5 ? headings : [],
        extracted: headings.length >= 5 };
    }
    cache.set(cik, { at: Date.now(), payload: payload });
    res.setHeader("Cache-Control",
      force ? "no-store" : "s-maxage=86400, stale-while-revalidate=86400");
    return res.status(200).json(payload);
  } catch (e) {
    return res.status(502).json({ error: "SEC unavailable", detail: String(e.message || e) });
  }
}
