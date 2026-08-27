/**
 * build-industry-map.mjs — group the covered universe into industries.
 *
 *   node scripts/build-industry-map.mjs
 *
 * Writes frontend/data/industry-map.js: ticker -> { sic, sicName, industry,
 * sector }. Industry analysis needs peers, and peers need a classification
 * that is defensible rather than invented. SEC assigns every filer a SIC
 * code on its own filings, so that is the grouping used — it comes from
 * the same source as the financials and cannot drift from them.
 *
 * SIC is coarse and dated in places (it has no "software" division, and
 * puts internet retail under catalog retail), so the two-digit major group
 * is mapped onto industry names a strategist would recognise, and those
 * roll up into sectors for the top-level view.
 *
 * Run once; the output is committed. Re-run when the coverage set changes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UA = { "User-Agent": process.env.SEC_USER_AGENT ||
  "Research Terminal research@chineduokeke.mba" };

/* Two-digit SIC major group -> [industry, sector]. Only groups the
   universe actually contains are named; anything else falls back to the
   SEC's own sicDescription so a new company is never silently unlabelled. */
const MAJOR_GROUP = {
  10: ["Metals & Mining", "Materials"],
  13: ["Oil & Gas Extraction", "Energy"],
  20: ["Food & Beverage", "Consumer Staples"],
  21: ["Tobacco", "Consumer Staples"],
  22: ["Textiles", "Consumer Discretionary"],
  23: ["Apparel", "Consumer Discretionary"],
  26: ["Paper & Packaging", "Materials"],
  28: ["Pharmaceuticals & Chemicals", "Health Care"],
  29: ["Petroleum Refining", "Energy"],
  30: ["Rubber & Plastics", "Materials"],
  32: ["Building Materials", "Materials"],
  33: ["Primary Metals", "Materials"],
  34: ["Fabricated Metal", "Industrials"],
  35: ["Industrial & Computer Hardware", "Information Technology"],
  36: ["Electronics & Semiconductors", "Information Technology"],
  37: ["Transportation Equipment", "Industrials"],
  38: ["Instruments & Medical Devices", "Health Care"],
  39: ["Miscellaneous Manufacturing", "Industrials"],
  40: ["Railroads", "Industrials"],
  42: ["Trucking & Logistics", "Industrials"],
  44: ["Marine Transport", "Industrials"],
  45: ["Airlines", "Industrials"],
  46: ["Pipelines", "Energy"],
  47: ["Transportation Services", "Industrials"],
  48: ["Telecommunications & Media", "Communication Services"],
  49: ["Utilities", "Utilities"],
  50: ["Wholesale — Durables", "Industrials"],
  51: ["Wholesale — Nondurables", "Consumer Staples"],
  52: ["Building Retail", "Consumer Discretionary"],
  53: ["General Merchandise Retail", "Consumer Discretionary"],
  54: ["Food Retail", "Consumer Staples"],
  55: ["Auto Retail", "Consumer Discretionary"],
  56: ["Apparel Retail", "Consumer Discretionary"],
  57: ["Home Furnishings Retail", "Consumer Discretionary"],
  58: ["Restaurants", "Consumer Discretionary"],
  59: ["Specialty & Internet Retail", "Consumer Discretionary"],
  60: ["Banks", "Financials"],
  61: ["Consumer & Specialty Finance", "Financials"],
  62: ["Brokers & Capital Markets", "Financials"],
  63: ["Insurance", "Financials"],
  64: ["Insurance Brokers", "Financials"],
  65: ["Real Estate", "Real Estate"],
  67: ["Investment Offices & REITs", "Real Estate"],
  70: ["Lodging", "Consumer Discretionary"],
  72: ["Personal Services", "Consumer Discretionary"],
  73: ["Software & IT Services", "Information Technology"],
  78: ["Motion Pictures", "Communication Services"],
  79: ["Recreation & Entertainment", "Communication Services"],
  80: ["Health Care Services", "Health Care"],
  82: ["Education", "Consumer Discretionary"],
  87: ["Professional & Research Services", "Industrials"],
};

/* Where the two-digit group mixes businesses that do not compete, the
   three-digit code splits it. SIC 35 otherwise files Apple and
   Caterpillar together, and an industry analysis built on that peer group
   would be meaningless: their cost structures, capital intensity and
   customers have nothing in common. Same for chemicals versus
   pharmaceuticals in 28, and autos versus aerospace in 37. */
const INDUSTRY_GROUP = {
  283: ["Pharmaceuticals", "Health Care"],
  281: ["Chemicals", "Materials"], 282: ["Chemicals", "Materials"],
  284: ["Household & Personal Products", "Consumer Staples"],
  286: ["Chemicals", "Materials"], 287: ["Chemicals", "Materials"],
  289: ["Chemicals", "Materials"],
  353: ["Industrial Machinery", "Industrials"],
  354: ["Industrial Machinery", "Industrials"],
  355: ["Industrial Machinery", "Industrials"],
  356: ["Industrial Machinery", "Industrials"],
  357: ["Computer Hardware", "Information Technology"],
  358: ["Industrial Machinery", "Industrials"],
  361: ["Electrical Equipment", "Industrials"],
  362: ["Electrical Equipment", "Industrials"],
  364: ["Electrical Equipment", "Industrials"],
  365: ["Consumer Electronics", "Consumer Discretionary"],
  366: ["Communications Equipment", "Information Technology"],
  367: ["Semiconductors", "Information Technology"],
  371: ["Automobiles", "Consumer Discretionary"],
  372: ["Aerospace & Defense", "Industrials"],
  376: ["Aerospace & Defense", "Industrials"],
  384: ["Medical Devices", "Health Care"],
  382: ["Instruments", "Health Care"],
  731: ["Advertising & Marketing", "Communication Services"],
  737: ["Software & IT Services", "Information Technology"],
  601: ["Banks", "Financials"], 602: ["Banks", "Financials"],
  621: ["Brokers & Capital Markets", "Financials"],
  631: ["Insurance — Life & Health", "Financials"],
  633: ["Insurance — Property & Casualty", "Financials"],
  635: ["Insurance — Property & Casualty", "Financials"],
  641: ["Insurance Brokers", "Financials"],
  679: ["Investment Offices", "Financials"],
  651: ["REITs", "Real Estate"], 653: ["REITs", "Real Estate"],
  671: ["Holding Companies", "Financials"],
  801: ["Health Care Services", "Health Care"],
  806: ["Hospitals", "Health Care"],
  873: ["Research Services", "Health Care"],
};

function classify(sic, sicDescription) {
  const code = Number(String(sic || "").slice(0, 4));
  const three = Math.floor(code / 10);
  const fine = INDUSTRY_GROUP[three];
  if (fine) return { industry: fine[0], sector: fine[1] };
  const hit = MAJOR_GROUP[Math.floor(code / 100)];
  if (hit) return { industry: hit[0], sector: hit[1] };
  return { industry: sicDescription || "Unclassified", sector: "Other" };
}

function loadUniverse() {
  const stub = {};
  for (const f of ["company-index.js", "coverage.js"]) {
    new Function("window", readFileSync(join(ROOT, "frontend/data", f), "utf8"))(stub);
  }
  const index = stub.COMPANY_INDEX || [];
  const covered = new Set(stub.COMPANY_COVERAGE || []);
  /* A ticker can map to more than one CIK. Exxon has both the operating
     company (34088, filing since 2007) and a freshly registered
     "ExxonMobil Holdings Corp" shell with no history. Keyed naively by
     ticker the shell wins, and the real company vanishes from its
     industry — which silently changes every concentration and rank figure
     that industry produces. Candidates are kept and resolved by probing. */
  const byTicker = new Map();
  for (const r of index) {
    if (!covered.has(r[0])) continue;
    const list = byTicker.get(r[0]) || [];
    list.push({ ticker: r[0], cik: r[1], name: r[2] });
    byTicker.set(r[0], list);
  }
  return byTicker;
}

/* Prefer the CIK still filing. Latest filing date wins, so a genuine
   reorganisation (Disney's new entity superseding the old) resolves to the
   current registrant, while an empty shell loses to the operating company. */
async function resolveCandidates(candidates) {
  if (candidates.length === 1) return candidates[0];
  let best = null, bestDate = "";
  for (const c of candidates) {
    await paced();
    try {
      const r = await fetch(
        `https://data.sec.gov/submissions/CIK${String(c.cik).padStart(10, "0")}.json`,
        { headers: UA });
      if (!r.ok) continue;
      const j = await r.json();
      const dates = (j.filings && j.filings.recent && j.filings.recent.filingDate) || [];
      const latest = dates.length ? dates[0] : "";
      if (latest > bestDate) { bestDate = latest; best = c; }
    } catch { /* try the next candidate */ }
  }
  return best || candidates[0];
}

/* SEC publishes a 10 requests/second ceiling; stay well under it. */
let nextSlot = 0;
async function paced() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 130;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

const byTicker = loadUniverse();
const universe = [];
for (const candidates of byTicker.values()) {
  universe.push(await resolveCandidates(candidates));
}
console.log(`industry map: ${universe.length} companies`);
const out = {};
const failures = [];
for (const c of universe) {
  await paced();
  try {
    const r = await fetch(
      `https://data.sec.gov/submissions/CIK${String(c.cik).padStart(10, "0")}.json`,
      { headers: UA });
    if (!r.ok) { failures.push(`${c.ticker} HTTP ${r.status}`); continue; }
    const j = await r.json();
    const { industry, sector } = classify(j.sic, j.sicDescription);
    out[c.ticker] = {
      cik: c.cik, name: j.name || c.name,
      sic: j.sic || null, sicName: j.sicDescription || null,
      industry, sector,
      exchange: (j.exchanges || [])[0] || null,
    };
    process.stdout.write(".");
  } catch (e) {
    failures.push(`${c.ticker} ${e.message}`);
  }
}
process.stdout.write("\n");

const byIndustry = {};
for (const [t, v] of Object.entries(out)) {
  (byIndustry[v.industry] = byIndustry[v.industry] || []).push(t);
}
writeFileSync(join(ROOT, "frontend/data/industry-map.js"),
  "// Generated by scripts/build-industry-map.mjs — do not edit.\n" +
  "window.INDUSTRY_MAP = " + JSON.stringify(out, null, 1) + ";\n" +
  "window.INDUSTRY_MEMBERS = " + JSON.stringify(byIndustry, null, 1) + ";\n",
  "utf8");

const sizes = Object.entries(byIndustry).sort((a, b) => b[1].length - a[1].length);
console.log(`wrote frontend/data/industry-map.js — ${Object.keys(out).length} companies, ${sizes.length} industries`);
console.log("largest groups:");
sizes.slice(0, 12).forEach(([k, v]) => console.log(`  ${k.padEnd(34)} ${v.length}  ${v.slice(0, 8).join(" ")}`));
const singles = sizes.filter(([, v]) => v.length === 1).length;
console.log(`industries with only one member: ${singles} (no peer comparison possible for those)`);
if (failures.length) console.log("failures:", failures.join(", "));
