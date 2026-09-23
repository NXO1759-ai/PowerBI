/**
 * cut-slice.mjs — how the companyfacts slices in this directory were cut.
 *
 *   node scripts/fixtures/underwriting/cut-slice.mjs <cik> <out.json> <fromEnd>
 *        [--to <toEnd>] [--tags a,b,c] [--extra d,e]
 *
 * Modeled on scripts/fixtures/hs/cut-slice.mjs (read that one first for
 * the general shape), widened in one way: the hs slices only ever needed
 * the "USD" unit bucket, but the Underwriting concept addition
 * (scripts/lib/concepts.mjs PURE, read by statements.mjs's
 * readPureInstant) lives in the "pure" bucket — DebtWeightedAverageInterestRate
 * is a rate, not a dollar amount. So this cutter keeps both buckets for
 * every wanted tag, in the document's own shape, for periods ending on or
 * after fromEnd (and on or before --to), plus the dei cover-page share
 * counts for the same window. The slice records where and when it was
 * cut.
 *
 * Slices here were cut live on 2026-09-22 against
 * https://data.sec.gov/api/xbrl/companyfacts/CIK<cik>.json:
 *   t-companyfacts-slice.json     AT&T, CIK 732717,  from 2022-01-01
 *   nvda-companyfacts-slice.json  NVIDIA, CIK 1045810, from 2022-01-01
 *   rtx-companyfacts-slice.json   RTX, CIK 101829,   from 2022-01-01
 * (see scripts/test-underwriting-concepts.mjs for what each one pins).
 */
import { writeFileSync } from "node:fs";
import { ALL_CONCEPTS } from "../../lib/concepts.mjs";
import { fetchCompanyFactsRaw } from "../../lib/sec-pull.mjs";

const argv = process.argv.slice(2);
const [cik, out, fromEnd] = argv;
if (!cik || !out || !fromEnd) {
  console.error("usage: cut-slice.mjs <cik> <out.json> <fromEnd> [--to <toEnd>] [--tags a,b] [--extra c,d]");
  process.exit(2);
}
const opt = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const toEnd = opt("--to") || "9999-12-31";
const only = opt("--tags") ? new Set(opt("--tags").split(",")) : null;
const extra = opt("--extra") ? opt("--extra").split(",") : [];
const keep = only || new Set([...ALL_CONCEPTS, ...extra]);
/* every unit bucket a wanted tag might carry that this fixture set needs;
   widening this list costs nothing a slice doesn't already have to check */
const KEEP_UNITS = ["USD", "pure"];

const raw = await fetchCompanyFactsRaw(cik);
if (!raw) { console.error("no companyfacts for CIK " + cik); process.exit(1); }

const pick = (rows) => rows.filter((r) => r.end >= fromEnd && r.end <= toEnd).map((r) => {
  const o = {};
  if (r.start !== undefined) o.start = r.start;
  Object.assign(o, { end: r.end, val: r.val, accn: r.accn, fy: r.fy, fp: r.fp, form: r.form, filed: r.filed });
  if (r.frame !== undefined) o.frame = r.frame;
  return o;
});
const facts = { "us-gaap": {}, dei: {} };
let n = 0;
for (const [tag, c] of Object.entries(raw.facts["us-gaap"] || {})) {
  if (!keep.has(tag)) continue;
  const units = {};
  for (const u of KEEP_UNITS) {
    const rows = pick((c.units && c.units[u]) || []);
    if (rows.length) units[u] = rows;
  }
  if (Object.keys(units).length) {
    facts["us-gaap"][tag] = { label: c.label, units };
    n += Object.values(units).reduce((a, rows) => a + rows.length, 0);
  }
}
const dei = raw.facts.dei && raw.facts.dei.EntityCommonStockSharesOutstanding;
if (dei) {
  const rows = pick((dei.units && dei.units.shares) || []);
  if (rows.length) facts.dei.EntityCommonStockSharesOutstanding = { label: dei.label, units: { shares: rows } };
}
const padded = String(cik).padStart(10, "0");
const doc = {
  cik: raw.cik, entityName: raw.entityName,
  slicedFrom: "https://data.sec.gov/api/xbrl/companyfacts/CIK" + padded + ".json",
  slicedOn: new Date().toISOString().slice(0, 10),
  periodEndsFrom: fromEnd, periodEndsTo: toEnd, facts,
};
const text = JSON.stringify(doc);
writeFileSync(out, text);
console.log(out, Object.keys(facts["us-gaap"]).length, "tags", n, "rows", (text.length / 1024).toFixed(0), "KB");
