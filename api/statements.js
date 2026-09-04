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

import { coverShares, buildStatements, fiscalYearFor, fiscalQuarterFor } from "../scripts/lib/statements.mjs";
import { extractInterimFacts, looksLikeStatements, factsToBucket } from "../scripts/lib/interim-parse.mjs";
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
      /* a 6-K carries an instance only when the filer tagged it */
      if (/^(10-K|10-Q|20-F|40-F)$/.test(r.form[i]) || (r.form[i] === "6-K" && r.isXBRL && r.isXBRL[i])) {
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

  /* Interim reports without XBRL.
     A foreign private issuer furnishes its interim statements on Form
     6-K and need not tag them; Enlivex tagged its half-year and not its
     third quarter, so the quarter existed only as tables in an exhibit.
     For a filer with 6-Ks, the recent untagged ones are scanned for an
     exhibit that reads like statements, and any period the feed lacks
     is read from the tables and merged under the same concept tags.
     Every such figure carries form 6-K and the exhibit it came from. */
  try {
    const sub = await (await secGet("https://data.sec.gov/submissions/CIK" +
      String(cik).padStart(10, "0") + ".json", 15000)).json();
    const r = sub.filings.recent;
    const has6k = r.form.some((x) => x === "6-K");
    if (has6k) {
      const ends = new Set(statements.annual.concat(statements.quarterly).map((p) => p.periodEnd));
      const have = (end) => {
        if (ends.has(end)) return true;
        const t = new Date(end).getTime();
        for (const e of ends) if (Math.abs(new Date(e).getTime() - t) <= 5 * 864e5) return true;
        return false;
      };
      /* a period counts as present only with its balance sheet: the
         tagged half-year carries the first quarter's income statement
         but not its balance sheet, and the untagged report has both */
      const full = new Set(statements.annual.concat(statements.quarterly)
        .filter((p) => typeof p.balanceSheet.totalAssets === "number").map((p) => p.periodEnd));
      const haveFull = (end) => {
        const t = new Date(end).getTime();
        for (const e of full) if (Math.abs(new Date(e).getTime() - t) <= 5 * 864e5) return true;
        return false;
      };
      const latestEnd = [...ends].sort().pop() || "2000-01-01";
      const since = new Date(new Date(latestEnd).getTime() - 450 * 864e5).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const c10 = String(cik).padStart(10, "0");
      const archive = (accn, name) => "https://www.sec.gov/Archives/edgar/data/" + Number(cik) + "/" + accn.replace(/-/g, "") + "/" + name;

      /* candidates: EDGAR full-text search for the phrase every interim
         statement header carries, restricted to this filer's 6-Ks */
      let candidates = [];
      try {
        const fts = await (await secGet("https://efts.sec.gov/LATEST/search-index?q=" +
          encodeURIComponent('"months ended"') + "&forms=6-K&ciks=" + c10 + "&startdt=" + since + "&enddt=" + today, 12000)).json();
        const hits = (fts && fts.hits && fts.hits.hits) || [];
        for (const h of hits) {
          const src = h._source || {};
          const [adsh, name] = String(h._id || "").split(":");
          if (!adsh || !name || !/\.htm(l)?$/i.test(name)) continue;
          const desc = String(src.file_description || "");
          candidates.push({ accn: adsh, name, filed: src.file_date || "", desc,
            statements: /financial statements|statements of|balance sheet/i.test(desc) || /ex99-?1/i.test(name) });
        }
        candidates.sort((a, b) => (b.filed.localeCompare(a.filed)) || ((b.statements ? 1 : 0) - (a.statements ? 1 : 0)));
      } catch (e) { candidates = []; }

      /* fallback: the filings' own directories, exhibits large enough
         to hold statements */
      if (!candidates.length) {
        let scanned = 0;
        for (let i = 0; i < r.form.length && scanned < 40; i++) {
          if (r.form[i] !== "6-K" || r.filingDate[i] < since) continue;
          if (r.isXBRL && r.isXBRL[i]) continue;
          scanned++;
          const accn = r.accessionNumber[i];
          let idx;
          try { idx = await (await secGet(archive(accn, "index.json"), 10000)).json(); } catch (e) { continue; }
          const items = (idx.directory && idx.directory.item) ? idx.directory.item : [];
          for (const d of items) {
            if (!/\.htm(l)?$/i.test(d.name) || /-index/.test(d.name) || Number(d.size || 0) < 40000) continue;
            candidates.push({ accn, name: d.name, filed: r.filingDate[i], desc: "", statements: /ex99/i.test(d.name) });
          }
        }
      }

      const pulled = [];
      const tried = new Set();
      for (const c of candidates) {
        if (pulled.length >= 4) break;
        if (tried.has(c.accn)) continue;
        let html;
        try { html = await (await secGet(archive(c.accn, c.name), 15000)).text(); } catch (e) { continue; }
        if (!looksLikeStatements(html)) continue;
        const facts = extractInterimFacts(html);
        if (!facts.length) continue;
        tried.add(c.accn);
        /* nothing to add when every period in the report is already
           complete in the feed */
        const ends = [...new Set(facts.map((x) => x.end))];
        if (ends.every(haveFull)) continue;
        const extra = factsToBucket(facts, { form: "6-K", filed: c.filed, accn: c.accn,
          fyEndMonth: statements.fiscalYearEndMonth }, fiscalYearFor, fiscalQuarterFor);
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
        pulled.push({ form: "6-K", exhibit: c.name, filed: c.filed, periods: ends.sort(), factsAdded: added });
      }
      if (pulled.length) {
        statements = buildStatements(bucket, { fyEndMonth: statements.fiscalYearEndMonth });
        backstop = Object.assign({}, backstop || {}, {
          reason: ((backstop && backstop.reason) ? backstop.reason + "; " : "") +
            "interim statements read from the tables of untagged 6-K reports",
          interim: pulled,
        });
      }
    }
  } catch (e) { /* the feed and the tagged filings stand */ }

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
