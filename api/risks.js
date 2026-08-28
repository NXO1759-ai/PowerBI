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

import { strip, extractItem1A, extractHeadings } from "../scripts/lib/filing-parse.mjs";
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
    let acc = null, rd = null, doc = null;
    for (let i = 0; i < r.form.length; i++) {
      if (/^(10-K|20-F|40-F)$/.test(r.form[i])) {
        acc = r.accessionNumber[i]; rd = r.reportDate[i]; doc = r.primaryDocument[i];
        break;
      }
    }
    if (!acc || !doc) return res.status(404).json({ error: "no annual filing" });
    const url = "https://www.sec.gov/Archives/edgar/data/" + Number(cik) + "/" +
      acc.replace(/-/g, "") + "/" + doc;
    const html = await (await getSec(url, 45000)).text();
    const section = extractItem1A(html);
    let payload;
    if (!section) {
      payload = { reportDate: rd, url: url, words: null, headings: [], extracted: false };
    } else {
      const words = strip(section).split(" ").length;
      let headings = extractHeadings(section);
      if (headings.length > 40) headings = headings.slice(0, 40);
      payload = { reportDate: rd, url: url, words: words,
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
