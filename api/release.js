/**
 * /api/release.js — Vercel serverless function.
 *
 * What the company itself said, from its latest earnings release: the
 * 8-K filed under Item 2.02 carries the press release as an exhibit, and
 * that exhibit holds the two things a filing's GAAP statements do not —
 * management's own adjusted figures with the reconciliation back to
 * GAAP, and the outlook. Both are returned VERBATIM, as table rows and
 * sentences, with the link to the exhibit, so every line can be checked
 * against the source and nothing is paraphrased.
 *
 *   GET /api/release?cik=1045810[&force=1]
 *
 * Exhibit selection: the release is the largest document in the filing
 * that is neither the 8-K cover itself nor a rendered R-file. Named
 * patterns (ex99, pr, release) are preferred when present. Cached a day.
 */

import { SEC_UA } from "../scripts/lib/sec-pull.mjs";

export const maxDuration = 45;

const cache = globalThis.__releaseCache || (globalThis.__releaseCache = new Map());
const TTL = 24 * 60 * 60 * 1000;

let nextSlotAt = 0;
async function getSec(url, timeoutMs) {
  const now = Date.now();
  const wait = Math.max(0, nextSlotAt - now);
  nextSlotAt = Math.max(now, nextSlotAt) + 125;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 30000);
  try {
    const r = await fetch(url, { headers: SEC_UA, signal: ctrl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r;
  } finally { clearTimeout(t); }
}

const strip = (h) => String(h)
  .replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
  .replace(/&amp;/gi, "&").replace(/&#8217;|&rsquo;/gi, "'")
  .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
  .replace(/&#8211;|&ndash;/gi, "-").replace(/&#8212;|&mdash;/gi, "-")
  .replace(/&#8226;|&bull;/gi, "•").replace(/&#58;/g, ":")
  .replace(/\s+/g, " ").trim();

/** A table as rows of cells, cells as trimmed text, empties dropped. */
function tableRows(tableHtml) {
  const rows = [];
  const trs = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trs) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [])
      .map((c) => strip(c)).filter((c) => c.length);
    /* a $ or % sign split into its own cell rejoins its number */
    const merged = [];
    for (const c of cells) {
      if (/^[$%()]$/.test(c) && merged.length) merged[merged.length - 1] += c;
      else if (merged.length && /^[$(]$/.test(merged[merged.length - 1])) merged[merged.length - 1] += c;
      else merged.push(c);
    }
    if (merged.length >= 2) rows.push(merged.slice(0, 8));
  }
  return rows;
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
    const sub = await (await getSec("https://data.sec.gov/submissions/CIK" + cik.padStart(10, "0") + ".json")).json();
    const r = sub.filings.recent;
    let acc = null, filed = null, primary = null;
    for (let i = 0; i < r.form.length; i++) {
      if (r.form[i] === "8-K" && /2\.02/.test(r.items ? r.items[i] : "")) {
        acc = r.accessionNumber[i]; filed = r.filingDate[i]; primary = r.primaryDocument[i];
        break;
      }
    }
    if (!acc) return res.status(404).json({ error: "no results release on file" });
    const base = "https://www.sec.gov/Archives/edgar/data/" + Number(cik) + "/" + acc.replace(/-/g, "");
    const idx = await (await getSec(base + "/index.json")).json();
    const docs = idx.directory.item
      .filter((f) => /\.htm$/i.test(f.name) && f.name !== primary && !/^R\d+\.htm$/i.test(f.name))
      .map((f) => ({ name: f.name, size: Number(f.size) || 0,
        score: (/ex.?99|99-?1|exhibit99/i.test(f.name) ? 3 : 0) +
               (/\bpr\b|release|earnings|results/i.test(f.name) ? 2 : 0) }))
      .sort((a, b) => (b.score - a.score) || (b.size - a.size));
    if (!docs.length) return res.status(404).json({ error: "release exhibit not found" });
    const ex = docs[0];
    const url = base + "/" + ex.name;
    const html = await (await getSec(url, 45000)).text();
    const text = strip(html);
    const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];

    /* headline: the first sentence that reads like a results headline */
    /* EDGAR prefixes the exhibit with its own header ("EX-99.1 2
       q2pr.htm … Document"); the headline starts after it. */
    const body = text.replace(/^.*?\b(?:Document|Exhibit\s*99\.\d)\s+/i, "");
    const headline = (body.match(/[A-Z][^.]{10,140}?\b(Reports|Announces|Delivers|Posts|Results)\b[^.]{5,160}/) || [""])[0]
      .replace(/\s*[•·].*$/, "").trim();

    /* guidance: tables that talk in outlook terms, and outlook sentences */
    const isOutlookTable = (tb) => {
      const s = strip(tb);
      return /outlook|guidance|expect|full[- ]year|fiscal\s*20\d\d|next quarter|current\s+prior/i.test(s) &&
        (/non-?gaap|expect|approx|growth|range|to\s+\$|billion|million|%/i.test(s)) && s.length > 60 && s.length < 6000;
    };
    const guidanceTables = tables.filter(isOutlookTable).slice(0, 2).map(tableRows).filter((t) => t.length);
    const outlook = text.split(/(?<=[.!?])\s+/)
      .filter((s) => /\b(outlook|expect|expects|expected|guidance|anticipate|anticipates|forecast|targets?)\b/i.test(s) &&
                     /\$|%|\bmillion\b|\bbillion\b|\bpercent\b/i.test(s) && s.length > 40 && s.length < 400)
      .slice(0, 8);

    /* reconciliations: GAAP to non-GAAP tables */
    const reconciliation = tables
      .filter((tb) => /non-?gaap/i.test(tb) && /\bgaap\b/i.test(tb) &&
        /reconcil|adjust|exclud|stock-based|share-based|amortization|restructuring|acquisition/i.test(strip(tb)))
      .filter((tb) => !isOutlookTable(tb))
      .slice(0, 3).map(tableRows).map((rows) => rows.slice(0, 30)).filter((t) => t.length);

    const payload = {
      filed, accession: acc, url, document: ex.name,
      headline: headline || null,
      guidanceTables, outlook, reconciliation,
      counts: { tables: tables.length, nonGaapTables: tables.filter((tb) => /non-?gaap/i.test(tb)).length },
    };
    cache.set(cik, { at: Date.now(), payload });
    res.setHeader("Cache-Control", force ? "no-store" : "s-maxage=86400, stale-while-revalidate=86400");
    return res.status(200).json(payload);
  } catch (e) {
    return res.status(502).json({ error: "SEC unavailable", detail: String(e.message || e) });
  }
}
