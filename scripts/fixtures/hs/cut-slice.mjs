/**
 * cut-slice.mjs — how the companyfacts slices in this directory were cut.
 *
 *   node scripts/fixtures/hs/cut-slice.mjs <cik> <out.json> <fromEnd>
 *        [--to <toEnd>] [--tags a,b,c] [--extra d,e]
 *
 * Pulls the filer's whole companyfacts document through the paced
 * getJson in sec-pull.mjs and keeps, in the document's own shape, the
 * USD rows of every tag concepts.mjs reads (or only --tags), plus any
 * --extra tags, for periods ending on or after fromEnd (and on or before
 * --to), and the dei cover-page share counts for the same window. The
 * slice records where and when it was cut. The slices here were cut on
 * 2026-09-11 (and re-cut the same day once the ladders widened, so they
 * carry AmortizationOfIntangibleAssets and the other added tags); the
 * two *-history-slice.json files are cut with --tags to the panel's
 * anchors and Assets, from the predecessor's years. Re-cutting later
 * will pick up newer filings, so pinned values in the tests name the
 * period they belong to.
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
  const rows = pick((c.units && c.units.USD) || []);
  if (rows.length) { facts["us-gaap"][tag] = { label: c.label, units: { USD: rows } }; n += rows.length; }
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
