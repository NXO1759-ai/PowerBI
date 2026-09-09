/**
 * /api/pull.js — Vercel serverless function.
 *
 * On-demand fundamentals pull for companies that are not in the exported
 * coverage set. The frontend's "Pull data" button calls this when a
 * searched company has no data file:
 *   GET /api/pull?ticker=RBLX&cik=1315098&name=Roblox%20Corp
 *
 * The pull itself is scripts/lib/sec-pull.mjs — the same module the
 * weekly refresh runs — so a company pulled on demand and a company in
 * the exported set are built by one implementation from one concept
 * list. This endpoint only validates the request, diagnoses a filer with
 * no periodic reports, and serves the result.
 *
 * It used to keep its own copy of the fetch loop and the normalizer, and
 * the copy was wrong in two ways that this file existed to demonstrate:
 *
 *   1. It called SEC's per-concept companyconcept endpoint. For some
 *      filers that endpoint answers 200 with "units":{"USD":{}} — an
 *      empty OBJECT where an array belongs. The copy iterated it without
 *      a type check, threw "rows is not iterable", and the function died
 *      with an HTML 500 that the browser then tried to parse as JSON.
 *      PayPal was one such filer; Coca-Cola, Abbott, Capital One, NXP,
 *      S&P Global and Welltower are others. sec-pull.mjs guards the
 *      shape AND prefers the companyfacts bulk endpoint, which carries
 *      the full history for exactly these companies.
 *   2. Its concept list omitted the noncontrolling-interest tags, so an
 *      on-demand pull reported parent-only equity and its balance sheet
 *      did not tie, while the same company in the exported set did.
 *
 * Both are gone by deletion rather than by patch.
 */

export const maxDuration = 60;

import { fetchFacts, buildPayload, SEC_UA } from "../scripts/lib/sec-pull.mjs";
import { jsonSafe } from "../scripts/lib/handler.mjs";

const REPORT_FORM = /^(10-K|10-Q|20-F|40-F|6-K)(\/A)?$/;

async function getJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { headers: SEC_UA, signal: ctrl.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default jsonSafe(async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = req.query || {};
  const ticker = String(q.ticker || "").toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  const cik = Number(String(q.cik || "").replace(/\D/g, ""));
  const name = String(q.name || ticker).slice(0, 120);
  if (!ticker || !cik) {
    return res.status(400).json({ error: "ticker and cik required" });
  }

  /* Every failure below answers with JSON. An unhandled throw here would
     be served as Vercel's HTML error page, which the browser cannot
     parse and which tells the reader nothing about their company. */
  try {
    const cikPadded = String(cik).padStart(10, "0");

    /* Diagnose before pulling: if EDGAR lists no periodic reports at all,
       there is nothing to pull — say so precisely instead of the generic
       "no facts" error. `filings.files` holds older filings beyond the
       recent page, so only conclude when it is empty. */
    const subs = await getJson(
      `https://data.sec.gov/submissions/CIK${cikPadded}.json`);
    if (subs && subs.filings && subs.filings.recent) {
      const recentForms = subs.filings.recent.form || [];
      const older = subs.filings.files || [];
      if (!recentForms.some((f) => REPORT_FORM.test(f)) && !older.length) {
        const only = [...new Set(recentForms)].slice(0, 6).join(", ") || "none";
        res.setHeader("Cache-Control", "no-store");
        return res.status(404).json({
          error: `No periodic SEC reports on file for ${ticker} ` +
                 `(CIK ${cik}) — EDGAR lists only: ${only}. ` +
                 "Companies that report elsewhere (e.g. Canadian SEDAR+ " +
                 "filers trading OTC) have no XBRL fundamentals to pull.",
        });
      }
    }

    const facts = await fetchFacts(cik);
    if (!facts.length) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).json({
        error: `No SEC XBRL facts found for ${ticker} (CIK ${cik}). ` +
               "It may file without XBRL tagging, or SEC EDGAR may have " +
               "throttled the pull — retry in a few seconds.",
      });
    }

    /* preferLatestPeriod: a foreign filer's tagged interims can stop
       before its annual report, and a reader asking for the company now
       should see the most recent period on file. */
    const data = buildPayload({ ticker, cik, name, exchange: null }, facts, {
      source: "SEC EDGAR 10-K/10-Q/20-F/40-F/6-K (live pull)",
      preferLatestPeriod: true,
    });
    if (!data) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).json({
        error: `${ticker} (CIK ${cik}) has SEC XBRL facts, but none in a ` +
               "reporting period this dashboard can assemble.",
      });
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json(data);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({
      error: `The pull for ${ticker} did not complete.`,
      detail: String((e && e.message) || e).slice(0, 300),
    });
  }
}, { name: "pull" });
