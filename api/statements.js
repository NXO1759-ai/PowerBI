/**
 * /api/statements.js — multi-period financial statements for one company.
 *
 *   GET /api/statements?ticker=AAPL&cik=320193
 *
 * Returns up to 10 fiscal years and 20 quarters of income statement,
 * balance sheet and cash flow line items, straight from SEC EDGAR's
 * companyfacts, plus the ratio set the Statement Analysis dashboard
 * renders.
 *
 * Served live rather than committed. A full history is roughly 25KB per
 * company; committing it for the whole universe would add several
 * megabytes to every clone for data that is one request away and always
 * current. The weekly refresh keeps the Company Overview snapshot; this
 * endpoint keeps statement analysis live.
 */

import { coverShares, buildStatements } from "../scripts/lib/statements.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { computeRatios } = require("../frontend/lib/ratios.js");
import { SEC_UA } from "../scripts/lib/sec-pull.mjs";
import { instanceToBucket, unzipMember } from "../scripts/lib/filing-parse.mjs";

export const maxDuration = 60;

/* paced SEC access for the backstop path */
let nextSlotAt = 0;
async function secGet(url, timeoutMs) {
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
async function fetchInstance(cik, accession) {
  const accn = accession.replace(/-/g, "");
  const base = "https://www.sec.gov/Archives/edgar/data/" + Number(cik) + "/" + accn;
  const idx = await (await secGet(base + "/index.json")).json();
  const inst = idx.directory.item.find((f) => /_htm\.xml$/.test(f.name));
  if (inst) return (await secGet(base + "/" + inst.name, 45000)).text();
  const zip = idx.directory.item.find((f) => f.name.endsWith("-xbrl.zip"));
  if (!zip) return null;
  const buf = await (await secGet(base + "/" + zip.name, 45000)).arrayBuffer();
  return unzipMember(buf, /_htm[.]xml$/) || unzipMember(buf, /-[0-9]{8}[.]xml$/) ||
         unzipMember(buf, /-[0-9]{8}[.]htm$/);
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h per ticker per warm instance
const cache = globalThis.__statementsCache ||
  (globalThis.__statementsCache = new Map());

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = req.query || {};
  const ticker = String(q.ticker || "").toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  const cik = Number(String(q.cik || "").replace(/\D/g, ""));
  if (!ticker || !cik) {
    return res.status(400).json({ error: "ticker and cik required" });
  }

  const force = q.force === "1" || q.force === "true";
  const hit = cache.get(ticker);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "s-maxage=3600");
    return res.status(200).json(hit.payload);
  }

  const url = "https://data.sec.gov/api/xbrl/companyfacts/CIK" +
    String(cik).padStart(10, "0") + ".json";

  let facts;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    const resp = await fetch(url, { headers: SEC_UA, signal: ctrl.signal });
    clearTimeout(timer);
    if (resp.status === 404) {
      return res.status(404).json({
        error: `SEC EDGAR has no XBRL filings for ${ticker} (CIK ${cik}).`,
      });
    }
    if (!resp.ok) {
      return res.status(502).json({
        error: `SEC EDGAR returned ${resp.status}. It rate-limits bursts — ` +
               "try again in a few seconds.",
      });
    }
    facts = await resp.json();
  } catch (e) {
    return res.status(504).json({
      error: "SEC EDGAR did not respond in time. Try again in a moment.",
    });
  }

  const bucket = facts && facts.facts && facts.facts["us-gaap"];
  if (!bucket) {
    return res.status(404).json({
      error: `${ticker} files with SEC EDGAR but reports no US GAAP XBRL ` +
             "data, so its statements cannot be assembled.",
    });
  }

  /* Backstop the facts feed from the filings themselves.
     The feed lags what has been filed and sometimes carries a single
     filing — AEVEX's held one 10-Q. The filings always have the whole
     set in the same tags, so when the feed is thin (fewer than four
     quarters) or stale (a filing newer than its latest period), the most
     recent reports are parsed directly and their dimensionless facts
     merged in. The feed's rows keep precedence by date; the merge only
     ADDS periods the feed lacks. */
  let statements = buildStatements(bucket);
  let backstop = null;
  try {
    const sub = await (await secGet("https://data.sec.gov/submissions/CIK" +
      String(cik).padStart(10, "0") + ".json", 15000)).json();
    const r = sub.filings.recent;
    const latestQ = statements.quarterly.length
      ? statements.quarterly[statements.quarterly.length - 1].periodEnd : "";
    const latestA = statements.annual.length
      ? statements.annual[statements.annual.length - 1].periodEnd : "";
    const feedLatest = latestQ > latestA ? latestQ : latestA;
    const recent = [];
    for (let i = 0; i < r.form.length && recent.length < 4; i++) {
      if (/^(10-K|10-Q|20-F|40-F)$/.test(r.form[i])) {
        recent.push({ form: r.form[i], accession: r.accessionNumber[i],
          filed: r.filingDate[i], reportDate: r.reportDate[i],
          fy: r.fy ? r.fy[i] : null, fp: r.fp ? r.fp[i] : null });
      }
    }
    const stale = recent.length && recent[0].reportDate > feedLatest;
    /* reported quarters only — derived ones prove nothing about the feed */
    const thin = statements.quarterly.filter((p) => !p.derived).length < 4;
    if (stale || thin) {
      const pulled = [];
      for (const f of recent.slice(0, thin ? 4 : 1)) {
        const x = await fetchInstance(cik, f.accession);
        if (!x) continue;
        const extra = instanceToBucket(x, { form: f.form, filed: f.filed,
          accession: f.accession, fy: f.fy, fp: f.fp });
        let added = 0;
        for (const [tag, def] of Object.entries(extra)) {
          const b = (bucket[tag] = bucket[tag] || { units: {} });
          for (const [unit, rows] of Object.entries(def.units)) {
            const u = (b.units[unit] = b.units[unit] || []);
            const seen = new Set(u.map((row) => (row.start || "") + "|" + row.end + "|" + (row.accn || "")));
            for (const row of rows) {
              const key = (row.start || "") + "|" + row.end + "|" + row.accn;
              if (!seen.has(key)) { u.push(row); added++; }
            }
          }
        }
        pulled.push({ form: f.form, reportDate: f.reportDate, factsAdded: added });
      }
      if (pulled.length) {
        statements = buildStatements(bucket);
        backstop = { reason: stale ? "feed behind latest filing" : "feed thin", filings: pulled };
      }
    }
  } catch (e) { /* the feed alone stands */ }

  if (!statements.annual.length && !statements.quarterly.length) {
    return res.status(404).json({
      error: `No reportable periods found for ${ticker}. This usually means ` +
             "the company tags revenue under a concept outside the standard set.",
    });
  }

  const payload = {
    ticker,
    cik,
    entityName: facts.entityName || null,
    generatedAt: new Date().toISOString(),
    fiscalYearEndMonth: statements.fiscalYearEndMonth,
    annual: statements.annual,
    quarterly: statements.quarterly,
    ltm: statements.ltm,
    /* the cover page's share count, for market value and the bridge to
       enterprise value */
    cover: coverShares(facts && facts.facts && facts.facts.dei),
    ratios: {
      annual: computeRatios(statements.annual),
      quarterly: computeRatios(statements.quarterly),
      ltm: computeRatios(statements.ltm),
    },
    backstop: backstop,
  };

  cache.set(ticker, { at: Date.now(), payload });
  res.setHeader("Cache-Control",
    force ? "no-store" : "s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json(payload);
}
