/**
 * /api/panel.js — Vercel serverless function.
 *
 * On-demand strategy data for a company OUTSIDE the exported panel, and
 * — where the exported panel cannot supply peers — the peer set that
 * makes the analysis mean something. A company alone cannot support
 * concentration, profit pools or peer ranks; a company with a thin or
 * missing cohort produces numbers that look like findings and are not.
 *
 *   GET /api/panel?ticker=RBLX&cik=1315098[&force=1]
 *
 * Shape of the answer:
 *   - company:  a row shaped exactly like window.STRATEGY_PANEL entries,
 *               so the frontend merges it with one assignment
 *   - peers:    "panel" when the exported panel already holds enough
 *               members of the company's industry, or an array of live
 *               rows pulled the same way when it does not
 *   - classification: how the SIC code resolved, so the page can say so
 *
 * Peer discovery uses EDGAR's own listing of 10-K filers by SIC code,
 * intersected with the ticker file so shell registrants drop out, then
 * keeps the largest filers by revenue. Everything is paced under SEC's
 * rate ceiling and cached: the subject for an hour, a peer cohort for a
 * day, since cohorts change on filing cadence, not intraday.
 */

import { buildStatements } from "../scripts/lib/statements.mjs";
import { PANEL_FIELDS, panelYears } from "../scripts/lib/panel-row.mjs";
import { classify } from "../scripts/lib/sic-map.mjs";
import { SEC_UA } from "../scripts/lib/sec-pull.mjs";

export const maxDuration = 60;

const companyCache = globalThis.__panelCoCache || (globalThis.__panelCoCache = new Map());
const peerCache = globalThis.__panelPeerCache || (globalThis.__panelPeerCache = new Map());
const CO_TTL = 60 * 60 * 1000;
const PEER_TTL = 24 * 60 * 60 * 1000;
let tickerByCik = globalThis.__panelTickers || null;

/* one paced lane, shared across concurrent requests in the instance */
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
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
  try {
    const r = await fetch(url, { headers: SEC_UA, signal: ctrl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r;
  } finally { clearTimeout(t); }
}

async function tickers() {
  if (tickerByCik) return tickerByCik;
  const j = await (await getSec("https://www.sec.gov/files/company_tickers.json")).json();
  const map = new Map();
  for (const row of Object.values(j)) {
    if (!map.has(row.cik_str)) map.set(row.cik_str, { ticker: row.ticker, name: row.title });
  }
  tickerByCik = globalThis.__panelTickers = map;
  return map;
}

/** One company, panel-row shaped. Returns null when the filer has no
    usable us-gaap facts. */
async function companyRow(cik, fallbackName) {
  const c10 = String(cik).padStart(10, "0");
  const [subR, factsR] = [
    await getSec("https://data.sec.gov/submissions/CIK" + c10 + ".json", 15000).catch(() => null),
    await getSec("https://data.sec.gov/api/xbrl/companyfacts/CIK" + c10 + ".json", 45000).catch(() => null),
  ];
  if (!factsR) return null;
  const facts = await factsR.json();
  const bucket = facts && facts.facts && facts.facts["us-gaap"];
  if (!bucket) return null;
  const sub = subR ? await subR.json().catch(() => null) : null;
  const s = buildStatements(bucket, { annualLimit: 25, quarterLimit: 1 });
  const years = panelYears(s);
  if (!Object.keys(years).length) return null;
  const sic = sub ? String(sub.sic || "") : "";
  const cls = classify(sic, sub ? sub.sicDescription : "");
  return {
    name: (sub && sub.name) || facts.entityName || fallbackName || "",
    cik: Number(cik),
    industry: cls.industry,
    sector: cls.sector,
    sic: sic || null,
    sicName: sub ? (sub.sicDescription || null) : null,
    fyEndMonth: s.fiscalYearEndMonth || 12,
    years: years,
  };
}

/** The largest 10-K filers sharing a SIC code, excluding one CIK. */
async function livePeers(sic, excludeCik) {
  const key = String(sic);
  const hit = peerCache.get(key);
  if (hit && Date.now() - hit.at < PEER_TTL) {
    return hit.peers.filter((p) => p.cik !== Number(excludeCik));
  }
  const atom = await (await getSec(
    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&SIC=" + key +
    "&type=10-K&count=40&output=atom")).text();
  const ciks = [];
  let m;
  const re = /<CIK>(\d+)<\/CIK>/gi;
  while ((m = re.exec(atom))) ciks.push(Number(m[1]));
  const tk = await tickers();
  /* listed operating companies only: a registrant with no ticker is a
     shell, a fund, or somebody's financing subsidiary */
  const candidates = [...new Set(ciks)]
    .filter((c) => c !== Number(excludeCik) && tk.has(c))
    .slice(0, 14);
  const rows = [];
  for (const c of candidates) {
    try {
      const row = await companyRow(c, tk.get(c).name);
      if (!row) continue;
      const yrs = Object.keys(row.years).map(Number).sort((a, b) => b - a);
      let latestRev = null;
      for (const y of yrs.slice(0, 3)) {
        const v = row.years[y][0];
        if (v !== null) { latestRev = v; break; }
      }
      /* thousands: 50000 = $50m — below that a "peer" mostly adds noise */
      if (latestRev === null || latestRev < 50000) continue;
      rows.push({ ticker: tk.get(c).ticker, rev: latestRev, row: row });
    } catch (e) { /* a missing peer is not an error */ }
  }
  rows.sort((a, b) => b.rev - a.rev);
  const peers = rows.slice(0, 8).map((r) => Object.assign({ ticker: r.ticker }, r.row));
  peerCache.set(key, { at: Date.now(), peers: peers });
  return peers;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = req.query || {};
  const ticker = String(q.ticker || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  const cik = String(q.cik || "").replace(/\D/g, "");
  if (!ticker || !cik) return res.status(400).json({ error: "ticker and cik required" });
  const force = q.force === "1" || q.force === "true";

  const hit = companyCache.get(cik);
  let company = (!force && hit && Date.now() - hit.at < CO_TTL) ? hit.company : null;
  try {
    if (!company) {
      company = await companyRow(cik, ticker);
      if (!company) {
        return res.status(404).json({ error: "no usable filings",
          detail: "This registrant reports no US-GAAP facts the panel can read — " +
            "typically a fund, a trust, or a filer on IFRS only." });
      }
      companyCache.set(cik, { at: Date.now(), company: company });
    }

    /* Peers: the frontend already ships the exported panel, so when the
       subject classifies into an industry that panel covers with enough
       members, the answer is simply "use it". Only otherwise are peers
       pulled live. */
    const wantLive = q.peers === "live";
    let peers = "panel";
    if (wantLive && company.sic) {
      peers = await livePeers(company.sic, cik);
    }
    res.setHeader("Cache-Control",
      force ? "no-store" : "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({
      ticker: ticker,
      fields: PANEL_FIELDS,
      company: company,
      peers: peers,
      classification: {
        sic: company.sic, sicName: company.sicName,
        industry: company.industry, sector: company.sector,
      },
      generatedAt: new Date().toISOString().slice(0, 19),
      source: "sec-companyfacts",
    });
  } catch (e) {
    return res.status(502).json({ error: "SEC unavailable", detail: String(e.message || e) });
  }
}
