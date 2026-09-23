/**
 * build-ledger-series.mjs — the three 15.8 figures tying the hyperscaler
 * and neocloud build-out monitor to the private-credit views (PR H3).
 *
 *   node scripts/build-ledger-series.mjs
 *
 * Reads the corrected frontend/data/ledgers/deals.json and computes, at
 * build time, never typed:
 *
 *   1. the private-credit share of the ledger, twice — once with the
 *      press-sourced Beignet Investor LLC SPV bond folded into the
 *      numerator (decision 12.17's default, carrying a caveat marker on
 *      the double-count against the Hyperion JV row it also finances)
 *      and once without it;
 *   2. the JV/SPV and lease-backed share (the project notes backed by a
 *      hyperscaler lease or a Google backstop, scripts/lib/ledger.mjs's
 *      curated LEASE_BACKED_ENTITY_MARKERS);
 *   3. the monthly private-credit-facility total (the same population as
 *      #1's numerator without Beignet, grouped by calendar month).
 *
 * All three divide by, or are counted against, "the ledger" — every
 * signed or closed row summed in USD (scripts/lib/ledger.mjs's
 * amountUsdBnOf, which converts a foreign tranche at the FRED daily rate
 * on the row's own pricing date, falling back to the previous business
 * day when the exact date is not a FRED observation and saying so).
 * Announcements, contract rows, backstops, rating actions and commentary
 * never enter that denominator, or the two numerators, or the monthly
 * total — scripts/lib/ledger.mjs's isFinancingRow is the one place that
 * rule lives, and this script never re-derives it.
 *
 * Writes the three keys into:
 *   - frontend/data/pc/series.json          (the master key set)
 *   - frontend/data/pc/series-index.json    (the index; a new group,
 *     "hs-ledgers", so the PitchBook/LCD ingest's own group files are
 *     never touched by this script and this script is never touched by
 *     a re-run of that ingest)
 *   - frontend/data/pc/series/hs-ledgers.json  (the group's partition)
 *   - frontend/data/pc/series-provenance.json  (formula + inputs only,
 *     so test-pc-ingest.mjs's "same keys everywhere" hygiene check holds)
 *
 * Every other key in every one of those four files is left byte-for-byte
 * alone: this script reads each, replaces only its own three keys (and,
 * in series-index.json, only its own "hs-ledgers" group entry), and
 * writes the rest back unchanged.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchSeriesVia } from "./lib/fred.mjs";
import {
  isFinancingRow, isPrivateCreditFacilityRow, isLeaseBackedRow, findBeignetRow,
  amountUsdBnOf, sumUsdBn, monthKeyOf, monthEndDateOf, FX_SERIES_OF,
  alsoFoldedFinancing,
} from "./lib/ledger.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGERS_DIR = join(ROOT, "frontend/data/ledgers");
const PC_DIR = join(ROOT, "frontend/data/pc");
const GROUP = "hs-ledgers";
const GROUP_FILE = `series/${GROUP}.json`;
const KEY_PRIVATE_CREDIT_SHARE = "derived_hs_private_credit_share_of_ledger";
const KEY_LEASE_BACKED_SHARE = "derived_hs_jv_spv_lease_backed_share";
const KEY_PRIVATE_CREDIT_MONTHLY = "derived_hs_private_credit_facility_monthly";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, value) => writeFileSync(p, JSON.stringify(value) + "\n");

/** Every currency the ledger's rows actually use, fetched once each. */
async function loadFx() {
  const fx = {};
  for (const [currency, { id }] of Object.entries(FX_SERIES_OF)) {
    const { obs, via } = await fetchSeriesVia(id);
    if (!obs) throw new Error(`FRED did not answer for ${id} (needed to convert ${currency} tranches to USD)`);
    fx[currency] = obs;
    console.log(`  ${id} (${currency}) via ${via}: ${obs.length} observations through ${obs[obs.length - 1].date}`);
  }
  return fx;
}

function fmtBn(v) {
  return (Math.round(v * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Builds the two derived shares and the monthly total from the
 * corrected deals ledger and a loaded FX table. Exported so
 * scripts/test-ledger-series.mjs can run the same computation against a
 * fixture ledger and fixture FX rates without touching the live files. */
export function computeDerived(deals, fx) {
  const rows = deals.rows;
  const financingRows = rows.filter(isFinancingRow);

  const ledgerTotal = sumUsdBn(financingRows, fx);
  if (ledgerTotal.n === 0) throw new Error("no signed or closed row of the ledger resolved to a USD amount");

  const privateCreditRows = financingRows.filter(isPrivateCreditFacilityRow);
  const privateCredit = sumUsdBn(privateCreditRows, fx);

  const beignetRow = findBeignetRow(rows);
  const beignetUsdBn = beignetRow ? amountUsdBnOf(beignetRow, fx) : null;
  if (beignetRow && beignetUsdBn === null) {
    throw new Error("the Beignet Investor LLC row did not resolve to a USD amount");
  }

  const leaseBackedRows = financingRows.filter(isLeaseBackedRow);
  const leaseBacked = sumUsdBn(leaseBackedRows, fx);

  /* Round-2 fix: 15 signed-financing-shaped "|| ALSO" sub-transactions
     (~$58bn) are folded into other rows' `terms` and are not separately
     summed anywhere on the site; the population strings below used to
     name only the single Stingray example. Disclosed here, in both
     population sentences, rather than promoted to rows (a bigger, riskier
     change than this fix attempts) or silently left unstated. */
  const alsoFolded = alsoFoldedFinancing(rows, fx);

  const byMonth = new Map();
  for (const row of privateCreditRows) {
    const usdBn = amountUsdBnOf(row, fx);
    if (usdBn === null) continue;
    const key = monthKeyOf(row.date);
    const cur = byMonth.get(key) || { totalUsdBn: 0, n: 0 };
    cur.totalUsdBn += usdBn;
    cur.n += 1;
    byMonth.set(key, cur);
  }
  const monthlyPoints = [...byMonth.keys()].sort().map((key) => ({
    p: monthEndDateOf(key), g: "month", v: Math.round(byMonth.get(key).totalUsdBn * 1000) / 1000, n: byMonth.get(key).n,
  }));

  return {
    ledgerTotal, privateCredit, beignetRow, beignetUsdBn, leaseBackedRows, leaseBacked, alsoFolded,
    shareWithoutBeignet: privateCredit.totalUsdBn / ledgerTotal.totalUsdBn,
    /* Round-2 fix: Beignet is a status:"commentary" row, excluded from
       ledgerTotal (isFinancingRow), so the old formula added it only to
       the numerator — not a share of the same population its own
       `formula` string claims. Adding it to both sides keeps this point
       a genuine share (of "the ledger plus Beignet"), consistent with
       decision 12.17's own double-count caveat rather than silently
       inflating the number. */
    shareWithBeignet: beignetUsdBn === null ? null : (privateCredit.totalUsdBn + beignetUsdBn) / (ledgerTotal.totalUsdBn + beignetUsdBn),
    leaseBackedShare: leaseBacked.totalUsdBn / ledgerTotal.totalUsdBn,
    monthlyPoints,
  };
}

function derivedKeyEntries(deals, derived, { generated }) {
  const asOf = deals.rows.reduce((max, r) => (r.date > max ? r.date : max), deals.rows[0].date);
  const alsoNote = derived.alsoFolded.resolvedN
    ? ` Known gap: ${derived.alsoFolded.resolvedN} signed-financing-shaped sub-transactions worth $${fmtBn(derived.alsoFolded.totalUsdBn)}bn are recorded inside other rows' "terms" as "|| ALSO" blocks (each with its own date, entity and URL) and are not separately summed into this total or its numerators.`
    : "";
  const ledgerPop = `${derived.ledgerTotal.n} signed or closed rows of the hyperscaler/neocloud deal ledger (frontend/data/ledgers/deals.json), $${fmtBn(derived.ledgerTotal.totalUsdBn)}bn total; announcements, contract rows, backstops, rating actions and commentary excluded.${alsoNote}`.replace(/\.\s*$/, "");

  const shareCommon = {
    unit: "share", cadence: "asof", geography: "Global",
    source: "derived", group: GROUP, edition: null, asOf, publishedAt: null, vintage: generated,
    inputs: [],
  };

  const privateCreditShare = {
    ...shareCommon,
    label: "Private-credit share of the hyperscaler/neocloud deal ledger",
    population: `${ledgerPop}. Numerator: rows tagged structure "private credit facility" (${derived.privateCredit.n} rows, $${fmtBn(derived.privateCredit.totalUsdBn)}bn) — the ledger's own tag for a facility priced and syndicated as private credit (CoreWeave's DDTLs, Crusoe/Brookfield, the APLD/Macquarie tranches); a syndicated bank loan stays "bank loan" even where press says it will be sold on to private-credit funds.`,
    formula: "sum(private credit facility rows, USD) ÷ sum(every signed or closed row, USD); decision 12.17's with-Beignet point adds the press-sourced Beignet Investor LLC SPV bond to BOTH the numerator and the denominator (Beignet is a status:\"commentary\" row, excluded from the plain ledger total), so it stays a share of a stated, consistent population rather than a numerator-only addition to the plain-ledger share. Decision 12.17 makes this with-Beignet point the headline; the plain point is stated second.",
    points: [
      ...(derived.shareWithBeignet === null ? [] : [{
        p: asOf, g: "asof", c: "including the Beignet SPV bond (caveat: double-counts the Hyperion JV/SPV row's ~$27bn)", v: derived.shareWithBeignet, n: derived.privateCredit.n + 1,
        caveat: "Beignet Investor LLC's $27.3bn notes finance the same Hyperion JV the ledger's Meta/Blue Owl JV/SPV row already counts once; this point adds Beignet to both the numerator and the denominator per decision 12.17 and is not additive with the JV/SPV total.",
      }]),
      { p: asOf, g: "asof", c: "excluding the Beignet SPV bond", v: derived.shareWithoutBeignet, n: derived.privateCredit.n },
    ],
  };

  const leaseBackedShare = {
    ...shareCommon,
    label: "JV/SPV and lease-backed share of the hyperscaler/neocloud deal ledger",
    population: `${ledgerPop}. Numerator: project notes backed by a hyperscaler lease or a Google backstop (${derived.leaseBacked.n} rows, $${fmtBn(derived.leaseBacked.totalUsdBn)}bn) — APLD's ComputeCo issuers, Cipher's Compute/Black Pearl issuers, TeraWulf's WULF Compute and Flash Compute, Hut 8 DC, Switch and Aligned Data Centers; a general JV/SPV-structure row that is not one of these named project notes (Hyperion, the Crusoe/Blue Owl venture) is not counted here. Known gap (one instance of the wider gap this key's own denominator already discloses above): Cipher's $810m Stingray Compute LLC note is folded into another row's terms as an "ALSO" sub-transaction and is not separately summed here either, and its entity name is not one of this numerator's named markers even if it were promoted to a row.`,
    formula: "sum(the named lease-backed project-note rows, USD) ÷ sum(every signed or closed row, USD)",
    points: [{ p: asOf, g: "asof", v: derived.leaseBackedShare, n: derived.leaseBacked.n }],
  };

  const privateCreditMonthly = {
    label: "Private-credit facility financing, by month", unit: "$B", cadence: "month",
    geography: "Global",
    population: `Private credit facility rows of the hyperscaler/neocloud deal ledger, signed or closed, grouped by the row's own date; not cumulative, and not the same figure as chart H12's running total by structure.`,
    source: "derived", group: GROUP, edition: null, asOf, publishedAt: null, vintage: generated,
    formula: "sum(private credit facility rows dated in the month, USD)", inputs: [],
    points: derived.monthlyPoints,
  };

  return {
    [KEY_PRIVATE_CREDIT_SHARE]: privateCreditShare,
    [KEY_LEASE_BACKED_SHARE]: leaseBackedShare,
    [KEY_PRIVATE_CREDIT_MONTHLY]: privateCreditMonthly,
  };
}

/** Merges `entries` (key → full series.json entry, with `points`) into
 * the four committed files, replacing only these three keys and this
 * one group everywhere else untouched. Split out so the test file can
 * exercise it against a temporary copy of the real files. */
export function writeDerivedSeries(entries, { pcDir = PC_DIR } = {}) {
  const seriesPath = join(pcDir, "series.json");
  const indexPath = join(pcDir, "series-index.json");
  const groupPath = join(pcDir, GROUP_FILE);
  const provPath = join(pcDir, "series-provenance.json");

  const series = readJson(seriesPath);
  const index = readJson(indexPath);
  const prov = readJson(provPath);

  const keys = Object.keys(entries);
  const generated = series.generated;

  for (const key of keys) {
    series.keys[key] = entries[key];
    const dated = entries[key].points.filter((p) => p.p);
    index.series[key] = {
      label: entries[key].label, unit: entries[key].unit, cadence: entries[key].cadence,
      geography: entries[key].geography, source: entries[key].source, group: entries[key].group,
      file: GROUP_FILE, n: entries[key].points.length,
      first: dated.length ? dated[0].p : null, firstGrain: dated.length ? dated[0].g : null,
      last: dated.length ? dated[dated.length - 1].p : null, lastGrain: dated.length ? dated[dated.length - 1].g : null,
      asOf: entries[key].asOf, edition: entries[key].edition, vintage: entries[key].vintage,
    };
    prov.keys[key] = { formula: entries[key].formula, inputs: entries[key].inputs };
  }

  index.groups[GROUP] = { file: GROUP_FILE, keys: keys.slice().sort() };

  const groupFile = { generated, group: GROUP, keys: Object.fromEntries(keys.map((k) => [k, entries[k]])) };

  writeJson(seriesPath, series);
  writeJson(indexPath, index);
  writeJson(groupPath, groupFile);
  writeJson(provPath, prov);

  return { seriesPath, indexPath, groupPath, provPath };
}

async function main() {
  const deals = readJson(join(LEDGERS_DIR, "deals.json"));
  console.log(`Loaded ${deals.rows.length} rows from frontend/data/ledgers/deals.json`);
  console.log("Fetching FX rates:");
  const fx = await loadFx();
  const derived = computeDerived(deals, fx);
  console.log(`  ledger total (signed/closed, USD): $${fmtBn(derived.ledgerTotal.totalUsdBn)}bn over ${derived.ledgerTotal.n} rows (${derived.ledgerTotal.skipped.length} skipped)`);
  console.log(`  private-credit facility rows: $${fmtBn(derived.privateCredit.totalUsdBn)}bn over ${derived.privateCredit.n} rows`);
  console.log(`  private-credit share: ${(derived.shareWithoutBeignet * 100).toFixed(1)}% (without Beignet), ${derived.shareWithBeignet === null ? "n/a" : (derived.shareWithBeignet * 100).toFixed(1) + "% (with Beignet)"}`);
  console.log(`  JV/SPV and lease-backed rows: $${fmtBn(derived.leaseBacked.totalUsdBn)}bn over ${derived.leaseBacked.n} rows, ${(derived.leaseBackedShare * 100).toFixed(1)}% of the ledger`);
  console.log(`  monthly private-credit-facility points: ${derived.monthlyPoints.length}`);

  const generated = readJson(join(PC_DIR, "series.json")).generated;
  const entries = derivedKeyEntries(deals, derived, { generated });
  const written = writeDerivedSeries(entries);
  for (const [name, p] of Object.entries(written)) console.log(`Wrote ${name}: ${p}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (!existsSync(join(LEDGERS_DIR, "deals.json"))) {
    console.error("frontend/data/ledgers/deals.json not found");
    process.exitCode = 1;
  } else {
    main().catch((e) => { console.error(e); process.exitCode = 1; });
  }
}
