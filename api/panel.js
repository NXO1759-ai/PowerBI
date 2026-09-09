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
import { peerHint } from "../scripts/lib/peer-hints.mjs";

import { gate } from "../scripts/lib/ratelimit.mjs";
import { jsonSafe } from "../scripts/lib/handler.mjs";
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
  const byTicker = new Map();
  for (const row of Object.values(j)) {
    if (!map.has(row.cik_str)) map.set(row.cik_str, { ticker: row.ticker, name: row.title });
    if (!byTicker.has(row.ticker)) byTicker.set(row.ticker, { cik: row.cik_str, name: row.title });
  }
  map.byTicker = byTicker;
  tickerByCik = globalThis.__panelTickers = map;
  return map;
}

/**
 * Peer nomination by the research model, used when no curated list
 * exists. The model only NAMES companies — every number still comes from
 * SEC filings, and any name that fails validation against the SEC
 * registrant file is dropped with a reason rather than trusted.
 */
async function nominatePeers(name, ticker) {
  const KEY = process.env.DEEPSEEK_API_KEY;
  if (!KEY) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 14000);
  try {
    const resp = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content:
            "You are an equity research assistant building a comparable-company set. " +
            "Name the closest publicly listed competitors an analyst would put in this " +
            "company's comp set — same customers, same economics, same competitive arena. " +
            "Prefer US-listed operating companies with SEC filings. Respond ONLY with JSON: " +
            '{"peers":[{"ticker":"XXX","name":"Company Name"}]} — eight to twelve entries, ' +
            "closest first. No commentary." },
          { role: "user", content: "Company: " + name + " (" + ticker + ")" },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 600,
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const raw = await resp.json();
    const parsed = JSON.parse(raw.choices[0].message.content);
    if (!parsed || !Array.isArray(parsed.peers)) return null;
    const out = parsed.peers
      .map((p) => String(p.ticker || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, ""))
      .filter((x) => x && x !== ticker);
    return out.length ? out.slice(0, 12) : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
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

/** 10-K filers sharing a SIC code — the last-resort peer source. */
async function sicCandidates(sic, excludeCik, tk) {
  const atom = await (await getSec(
    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&SIC=" + String(sic) +
    "&type=10-K&count=40&output=atom")).text();
  const ciks = [];
  let m;
  const re = /<CIK>(\d+)<\/CIK>/gi;
  while ((m = re.exec(atom))) ciks.push(Number(m[1]));
  /* listed operating companies only: a registrant with no ticker is a
     shell, a fund, or somebody's financing subsidiary */
  return [...new Set(ciks)]
    .filter((c) => c !== Number(excludeCik) && tk.has(c))
    .map((c) => ({ cik: c, ticker: tk.get(c).ticker, name: tk.get(c).name }));
}

/**
 * The peer set, in strict preference order:
 *   1. the curated list — compiled from the peer groups companies
 *      themselves disclose in their proxy statements
 *   2. the research model's nomination, validated name by name
 *   3. EDGAR's listing of filers under the same SIC code
 * Whatever the source, every candidate is validated against the SEC
 * registrant file and its numbers come from its own filings; candidates
 * that fail are reported with the reason, not silently dropped.
 */
async function livePeers(company, subjectTicker, excludeCik) {
  const cacheKey = subjectTicker + "|" + String(company.sic || "");
  const hit = peerCache.get(cacheKey);
  if (hit && Date.now() - hit.at < PEER_TTL) return hit.result;

  const tk = await tickers();
  const notes = [];
  let method = null;
  let named = peerHint(subjectTicker);
  if (named) method = "disclosed comparables";
  if (!named) {
    named = await nominatePeers(company.name, subjectTicker);
    if (named) method = "model-nominated";
  }

  const candidates = [];
  const seen = new Set([Number(excludeCik)]);
  if (named) {
    for (const t of named) {
      const rec = tk.byTicker.get(t);
      if (!rec) { notes.push(t + " — not an SEC registrant, so its filings cannot be read"); continue; }
      if (seen.has(rec.cik)) continue;
      seen.add(rec.cik);
      candidates.push({ cik: rec.cik, ticker: t, name: rec.name });
    }
  }
  /* supplement from the industry code when the named set runs thin */
  if (candidates.length < 6 && company.sic) {
    try {
      for (const c of await sicCandidates(company.sic, excludeCik, tk)) {
        if (seen.has(c.cik)) continue;
        seen.add(c.cik);
        candidates.push(c);
        if (candidates.length >= 14) break;
      }
      if (!method) method = "industry code";
    } catch (e) { /* the named set stands alone */ }
  }

  const rows = [];
  for (const c of candidates.slice(0, 14)) {
    try {
      const row = await companyRow(c.cik, c.name);
      if (!row) {
        notes.push(c.ticker + " — files without US-GAAP facts (typically an IFRS filer), so its statements cannot be compared like-for-like");
        continue;
      }
      const yrs = Object.keys(row.years).map(Number).sort((a, b) => b - a);
      let latestRev = null;
      for (const y of yrs.slice(0, 3)) {
        const v = row.years[y][0];
        if (v !== null) { latestRev = v; break; }
      }
      /* thousands: 50000 = $50m — below that a "peer" mostly adds noise */
      if (latestRev === null || latestRev < 50000) continue;
      /* Peers cohort with the SUBJECT whatever their own code says —
         Deckers files two SIC codes away from Crocs and the whole point
         of a curated set is that the codes are wrong about them. */
      row.ownIndustry = row.industry;
      row.industry = company.industry;
      row.sector = company.sector;
      rows.push({ ticker: c.ticker, rev: latestRev, row: row });
    } catch (e) { /* a missing peer is not an error */ }
  }
  rows.sort((a, b) => b.rev - a.rev);
  const peers = rows.slice(0, 8).map((r) => Object.assign({ ticker: r.ticker }, r.row));
  const result = { peers: peers, method: method || "industry code", notes: notes };
  peerCache.set(cacheKey, { at: Date.now(), result: result });
  return result;
}

export default jsonSafe(async function handler(req, res) {
  { const g = gate(req, { burst: 20, ratePerMin: 10, dailyCap: 2000, cost: (req.query && req.query.peers === "live") ? 1 : 0, sameOrigin: false }); if (g) return res.status(g.status).json(g.body); }
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
        /* Two different absences, and telling them apart matters: a
           company that files nothing readable, versus one that files
           quarters but has not reached its first annual report — the
           strategy panel is built on fiscal years, so a recent listing
           has nothing to place against peers even though its statements
           are perfectly readable elsewhere in the terminal. */
        let quarters = 0, entity = "";
        try {
          const f = await (await getSec("https://data.sec.gov/api/xbrl/companyfacts/CIK" +
            String(cik).padStart(10, "0") + ".json", 45000)).json();
          entity = f.entityName || "";
          const b = f.facts && f.facts["us-gaap"];
          if (b) quarters = buildStatements(b, { annualLimit: 1, quarterLimit: 8 }).quarterly.length;
        } catch (e) { /* fall through to the general message */ }
        return res.status(404).json({ error: "no annual periods",
          detail: quarters
            ? (entity || ticker) + " reports " + quarters + " quarter" +
              (quarters === 1 ? "" : "s") + " but has not filed an annual report yet, " +
              "and industry comparison here is built on fiscal years. Its statements " +
              "are readable on the Financial Statement Analysis page."
            : "This registrant reports no US-GAAP facts the panel can read — " +
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
    let peerMethod = null, peerNotes = [];
    if (wantLive) {
      const got = await livePeers(company, ticker, cik);
      peers = got.peers;
      peerMethod = got.method;
      peerNotes = got.notes;
    }
    res.setHeader("Cache-Control",
      force ? "no-store" : "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({
      ticker: ticker,
      fields: PANEL_FIELDS,
      company: company,
      peers: peers,
      peerMethod: peerMethod,
      peerNotes: peerNotes,
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
}, { name: "strategy panel" });
