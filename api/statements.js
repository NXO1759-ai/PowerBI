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

import { buildStatements } from "../scripts/lib/statements.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { computeRatios } = require("../frontend/lib/ratios.js");
import { SEC_UA } from "../scripts/lib/sec-pull.mjs";

export const maxDuration = 60;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h per ticker per warm instance
const cache = globalThis.__statementsCache ||
  (globalThis.__statementsCache = new Map());

export default async function handler(req, res) {
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

  const statements = buildStatements(bucket);
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
    ratios: {
      annual: computeRatios(statements.annual),
      quarterly: computeRatios(statements.quarterly),
    },
  };

  cache.set(ticker, { at: Date.now(), payload });
  res.setHeader("Cache-Control",
    force ? "no-store" : "s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json(payload);
}
