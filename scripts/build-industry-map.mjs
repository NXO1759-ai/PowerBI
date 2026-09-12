/**
 * build-industry-map.mjs — group the covered universe into industries.
 *
 *   node scripts/build-industry-map.mjs [--dry-run] [--tickers A,B,C]
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
 * roll up into sectors for the top-level view. Where a code says nothing
 * about the business, sic-map.mjs carries an override by CIK (the six
 * neoclouds, decision 12.18) and the row records that it was classified
 * by decision rather than by code.
 *
 * Run once; the output is committed. Re-run when the coverage set changes.
 * --dry-run classifies and prints without writing; --tickers restricts
 * the run to a few tickers, which with --dry-run answers "what would
 * these classify as" in a handful of requests, and without it updates
 * those rows in place: a partial run is merged onto the committed map,
 * never written over it, so the other rows survive.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { classify, overrideFor } from "./lib/sic-map.mjs";
import { getJson } from "./lib/sec-pull.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const ONLY = (() => {
  const i = argv.indexOf("--tickers");
  return i !== -1 && argv[i + 1]
    ? new Set(argv[i + 1].split(",").map((t) => t.trim().toUpperCase()).filter(Boolean))
    : null;
})();

/* Every request goes through sec-pull's getJson: the one paced gate
   (SEC_MIN_INTERVAL_MS) and the one User-Agent (SEC_UA), shared with the
   weekly refresh, so this builder can never add an unthrottled path. */
const submissions = (cik) =>
  getJson(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`);

/* Two-digit SIC major group -> [industry, sector]. Only groups the
   universe actually contains are named; anything else falls back to the
   SEC's own sicDescription so a new company is never silently unlabelled. */
// The classifier lives in scripts/lib/sic-map.mjs — one definition,
// shared with the on-demand peer endpoint.
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
    if (ONLY && !ONLY.has(r[0])) continue;
    const list = byTicker.get(r[0]) || [];
    list.push({ ticker: r[0], cik: r[1], name: r[2] });
    byTicker.set(r[0], list);
  }
  return byTicker;
}

/* The map as committed. A ticker it already resolves keeps that CIK for
   as long as the CIK is still one of the ticker's candidates: the panel
   and the peer views are built on the map's CIK, so a re-run that
   switched registrants would replace a company's whole served history
   with the new entity's, which begins at its first filing. Exxon is the
   live case: EXXON MOBIL CORP (34088, 10-Ks since 2007) filed a 25-NSE
   on 2026-07-02 and ExxonMobil Holdings Corp (2115436) now holds the
   XOM ticker with one 10-Q behind it; the map stays on 34088, which
   still files, until the owner moves it by hand. A ticker not yet in the
   map, or whose committed CIK left the index, is resolved by probing. */
function loadCommittedMap() {
  const file = join(ROOT, "frontend/data/industry-map.js");
  if (!existsSync(file)) return {};
  const stub = {};
  new Function("window", readFileSync(file, "utf8"))(stub);
  return stub.INDUSTRY_MAP || {};
}
const COMMITTED = loadCommittedMap();

/* Prefer the CIK still filing. Latest filing date wins, so a genuine
   reorganisation (Disney's new entity superseding the old) resolves to the
   current registrant, while an empty shell loses to the operating company. */
async function resolveCandidates(candidates) {
  if (candidates.length === 1) return candidates[0];
  const kept = COMMITTED[candidates[0].ticker];
  const sticky = kept && kept.cik != null &&
    candidates.find((c) => Number(c.cik) === Number(kept.cik));
  if (sticky) return sticky;
  let best = null, bestDate = "";
  for (const c of candidates) {
    const j = await submissions(c.cik);
    if (!j) continue;
    const dates = (j.filings && j.filings.recent && j.filings.recent.filingDate) || [];
    const latest = dates.length ? dates[0] : "";
    if (latest > bestDate) { bestDate = latest; best = c; }
  }
  return best || candidates[0];
}

const byTicker = loadUniverse();
const universe = [];
for (const candidates of byTicker.values()) {
  universe.push(await resolveCandidates(candidates));
}
console.log(`industry map: ${universe.length} companies${DRY_RUN ? " (dry run, nothing written)" : ""}`);
const out = {};
const failures = [];
for (const c of universe) {
  const j = await submissions(c.cik);
  if (!j) { failures.push(`${c.ticker} no submissions reply`); continue; }
  const { industry, sector } = classify(j.sic, j.sicDescription, c.cik);
  const forced = overrideFor(c.cik);
  out[c.ticker] = {
    cik: c.cik, name: j.name || c.name,
    sic: j.sic || null, sicName: j.sicDescription || null,
    industry, sector,
    exchange: (j.exchanges || [])[0] || null,
    /* present only where the label came from sic-map.mjs's override
       table rather than the code, so a page can say "classified by
       decision 12.18, EDGAR SIC 6199" on hover */
    ...(forced ? { override: "decision 12.18" } : {}),
  };
  if (DRY_RUN) {
    console.log(`  ${c.ticker.padEnd(6)} CIK ${String(c.cik).padStart(8)}  SIC ${String(j.sic || "blank").padEnd(5)} ` +
      `${String(j.sicDescription || "").padEnd(52).slice(0, 52)} -> ${industry} / ${sector}${forced ? "  [override]" : ""}`);
  } else {
    process.stdout.write(".");
  }
}
if (!DRY_RUN) process.stdout.write("\n");

/* A --tickers run classifies a few rows; the file keeps every other row
   as committed. Without the merge a partial run replaced the whole map
   with its handful of rows. */
const merged = ONLY ? { ...COMMITTED, ...out } : out;
const byIndustry = {};
for (const [t, v] of Object.entries(merged)) {
  (byIndustry[v.industry] = byIndustry[v.industry] || []).push(t);
}
if (DRY_RUN) {
  console.log(`dry run: ${Object.keys(out).length} companies, ${Object.keys(byIndustry).length} industries; frontend/data/industry-map.js untouched`);
} else {
  writeFileSync(join(ROOT, "frontend/data/industry-map.js"),
    "// Generated by scripts/build-industry-map.mjs — do not edit.\n" +
    "window.INDUSTRY_MAP = " + JSON.stringify(merged, null, 1) + ";\n" +
    "window.INDUSTRY_MEMBERS = " + JSON.stringify(byIndustry, null, 1) + ";\n",
    "utf8");
  console.log(`wrote frontend/data/industry-map.js — ${Object.keys(merged).length} companies, ${Object.keys(byIndustry).length} industries` +
    (ONLY ? ` (${Object.keys(out).length} re-classified, the rest kept as committed)` : ""));
}

const sizes = Object.entries(byIndustry).sort((a, b) => b[1].length - a[1].length);
console.log("largest groups:");
sizes.slice(0, 12).forEach(([k, v]) => console.log(`  ${k.padEnd(34)} ${v.length}  ${v.slice(0, 8).join(" ")}`));
const singles = sizes.filter(([, v]) => v.length === 1).length;
console.log(`industries with only one member: ${singles} (no peer comparison possible for those)`);
if (failures.length) console.log("failures:", failures.join(", "));
