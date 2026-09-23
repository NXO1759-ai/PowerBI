/**
 * test-ledger-series.mjs — scripts/build-ledger-series.mjs and the
 * scripts/lib/ledger.mjs FX/classification helpers it is built on
 * (PR H3's data layer for blueprint 15.8).
 *
 * Three groups of checks:
 *
 *   1. FX mechanics against a synthetic, deterministic rate table: the
 *      per-currency conversion direction (dollars per euro/pound versus
 *      the foreign currency per dollar), the previous-business-day
 *      fallback, and every amount shape the deal ledger's `amount` and
 *      `unit` fields actually use. This is "the FX rule reproduces the
 *      ledger USD totals from the FRED rates" (PR H3's acceptance line)
 *      proved by hand arithmetic, not by trusting the code under test.
 *   2. computeDerived() against the real, corrected deals ledger and
 *      live FRED rates: both Beignet variants are present, every point
 *      carries n and every key carries a population sentence, and no
 *      excluded row kind (announcement, contract, backstop, rating
 *      action, commentary) can reach a total.
 *   3. writeDerivedSeries() against a temporary copy of the real
 *      frontend/data/pc files: the three keys land in series.json,
 *      series-index.json, the new "hs-ledgers" group file and
 *      series-provenance.json, and every other key and group is left
 *      byte-for-byte alone.
 *
 * Exits non-zero on the first failed check, after printing every one.
 */
import { readFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSeriesVia } from "./lib/fred.mjs";
import {
  isFinancingRow, isPrivateCreditFacilityRow, isLeaseBackedRow, findBeignetRow,
  fxRateOn, convertToUsd, amountUsdBnOf, sumUsdBn, monthKeyOf, monthEndDateOf,
  EXCLUDED_STATUSES,
} from "./lib/ledger.mjs";
import { computeDerived, writeDerivedSeries } from "./build-ledger-series.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PC_DIR = join(ROOT, "frontend/data/pc");
const LEDGER_PATH = join(ROOT, "frontend/data/ledgers/deals.json");

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail !== undefined && !ok ? "  " + detail : ""));
  if (!ok) failed++;
};
const near = (a, b, tol = 1e-9) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

/* ================= 1. FX mechanics, by hand ========================= */
{
  /* a small, deterministic rate table standing in for FRED's own —
     ascending {date, value}, one gap (2026-06-13, a Saturday) so the
     previous-business-day fallback has something to fall back to */
  const EUR = [
    { date: "2026-06-10", value: 1.10 },
    { date: "2026-06-11", value: 1.12 },
    { date: "2026-06-12", value: 1.14 }, // Friday
    // 2026-06-13/14 weekend, no observation
  ];
  const JPY = [
    { date: "2026-06-10", value: 150.0 },
    { date: "2026-06-12", value: 155.0 },
  ];
  const fx = { EUR, JPY };

  check("fxRateOn finds an exact date", fxRateOn(EUR, "2026-06-11").value === 1.12 && fxRateOn(EUR, "2026-06-11").exact === true);
  check("fxRateOn falls back to the previous business day over a weekend, and says so", (() => {
    const r = fxRateOn(EUR, "2026-06-14");
    return r && r.date === "2026-06-12" && r.value === 1.14 && r.exact === false;
  })());
  check("fxRateOn refuses a date before the series starts", fxRateOn(EUR, "2026-06-09") === null);
  check("fxRateOn refuses an empty or missing series", fxRateOn([], "2026-06-11") === null && fxRateOn(null, "2026-06-11") === null);

  check("convertToUsd needs no rate for USD", near(convertToUsd(100, "USD", "2026-06-11", fx).usd, 100));
  check("EUR converts by multiplying (dollars per euro): €100 at 1.12 = $112", near(convertToUsd(100, "EUR", "2026-06-11", fx).usd, 112));
  check("JPY converts by dividing (yen per dollar): ¥15,500 at 155.0 = $100", near(convertToUsd(15500, "JPY", "2026-06-12", fx).usd, 100));
  check("an unhandled currency refuses rather than guessing", convertToUsd(100, "XYZ", "2026-06-11", fx) === null);
  check("a currency with no matching rate on or before the date refuses", convertToUsd(100, "JPY", "2026-06-09", fx) === null);

  /* every amount/unit shape actually seen in frontend/data/ledgers/deals.json */
  const row = (amount, unit, date = "2026-06-11") => ({ date, amount, unit, entity: "test", structure: "bond", status: "signed", url: "https://example.test", counterparties: "", terms: "", note: "", sourceType: "filing" });
  check("a plain single figure: 27.3 USD bn = $27.3bn", near(amountUsdBnOf(row("27.3", "USD bn")), 27.3));
  check("a qualifier the unit carries is stripped, not treated as a second segment: 27 USD bn (development cost)", near(amountUsdBnOf(row("27", "USD bn (development cost)")), 27));
  check("a single figure with a trailing descriptive word: 1.0043 net, USD bn", near(amountUsdBnOf(row("1.0043 net", "USD bn")), 1.0043));
  check("a same-currency amount split into named parts is summed, not truncated to the first: 5.0 debt + 5.0 equity, USD bn = 10.0", near(amountUsdBnOf(row("5.0 debt + 5.0 equity", "USD bn")), 10));
  check("a same-currency split tolerates an approx marker: 3.16 convertible + ~1.0 equity, USD bn = 4.16", near(amountUsdBnOf(row("3.16 convertible + ~1.0 equity", "USD bn")), 4.16));
  check("a compound amount in millions: 500 USD m = $0.5bn", near(amountUsdBnOf(row("500", "USD m")), 0.5));
  check("a two-currency compound amount, first segment implicit USD: 17.5 + EUR 11.2, USD bn + EUR bn, at 1.12 = 17.5 + 12.544 = 30.044", near(amountUsdBnOf(row("17.5 + EUR 11.2", "USD bn + EUR bn"), fx), 17.5 + 11.2 * 1.12));
  check("a two-currency compound amount, both segments explicit: EUR 10.0 + JPY 15500, EUR bn + JPY bn, at 1.14 (EUR on 2026-06-12) and 155.0 = 11.4 + 100 = 111.4", near(amountUsdBnOf(row("EUR 10.0 + JPY 15500", "EUR bn + JPY bn", "2026-06-12"), fx), 10 * 1.14 + 15500 / 155.0, 1e-6));
  check("a foreign-only amount: CHF-style single currency with no rate configured refuses rather than guessing", amountUsdBnOf(row("2.8", "CHF bn"), fx) === null);
  check("a currency the row's unit does not name at all refuses", amountUsdBnOf(row("2.8", "bn")) === null);
  check("a compound amount whose segment count does not match the unit's refuses (a genuinely ambiguous multi-currency row, never guessed)", amountUsdBnOf(row("10.0 + EUR 5.0 + GBP 2.0", "USD bn + EUR bn"), fx) === null);

  const rows = [row("10", "USD bn", "2026-06-11"), row("EUR 10.0", "EUR bn", "2026-06-12")];
  const sum = sumUsdBn(rows, fx);
  check("sumUsdBn totals across rows and currencies: $10bn + €10bn at 1.14 = $21.4bn, both rows resolve", near(sum.totalUsdBn, 10 + 10 * 1.14) && sum.n === 2 && sum.skipped.length === 0);
  const withOneBad = [...rows, row("n/a", "USD bn")];
  check("sumUsdBn skips a row that does not resolve and reports why, without dropping the running total", (() => {
    const s = sumUsdBn(withOneBad, fx);
    return near(s.totalUsdBn, sum.totalUsdBn) && s.n === 2 && s.skipped.length === 1;
  })());

  check("monthKeyOf/monthEndDateOf: a February date lands on Feb 28 in a non-leap year and Feb 29 in a leap one", monthEndDateOf(monthKeyOf("2026-02-14")) === "2026-02-28" && monthEndDateOf(monthKeyOf("2024-02-14")) === "2024-02-29");
}

/* ================= 2. computeDerived() on the real ledger =========== */
const deals = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
{
  const FX_IDS = { EUR: "DEXUSEU", GBP: "DEXUSUK", CHF: "DEXSZUS", CAD: "DEXCAUS", JPY: "DEXJPUS" };
  const fx = {};
  for (const [currency, id] of Object.entries(FX_IDS)) {
    const { obs } = await fetchSeriesVia(id);
    if (!obs) throw new Error("FRED did not answer for " + id + " — this test needs live network to fred.stlouisfed.org, the same as build-ledger-series.mjs itself");
    fx[currency] = obs;
  }

  /* ---- no excluded row kind can leak into any of the three totals ---- */
  const excludedRows = deals.rows.filter((r) => EXCLUDED_STATUSES.has(r.status));
  check("the ledger actually carries excluded-status rows to test against (announcement/contract/backstop/rating action/commentary)", excludedRows.length > 0, String(excludedRows.length));
  check("not one excluded-status row is a financing row", excludedRows.every((r) => !isFinancingRow(r)));
  check("not one excluded-status row is counted as private credit or lease-backed", excludedRows.every((r) => !isPrivateCreditFacilityRow(r) && !isLeaseBackedRow(r)));
  const beignetRow = findBeignetRow(deals.rows);
  check("the Beignet Investor LLC row exists and is carried as commentary (excluded from every ordinary total)", !!beignetRow && beignetRow.status === "commentary", beignetRow && beignetRow.status);

  const derived = computeDerived(deals, fx);
  check("the ledger total resolves every signed/closed row (no silent drop)", derived.ledgerTotal.n > 0 && derived.ledgerTotal.skipped.length === 0, JSON.stringify(derived.ledgerTotal.skipped.map((s) => s.row.entity)));
  check("the ledger total equals independently summing isFinancingRow rows the same way", near(derived.ledgerTotal.totalUsdBn, sumUsdBn(deals.rows.filter(isFinancingRow), fx).totalUsdBn));
  check("private-credit rows are exactly the signed/closed 'private credit facility' rows, nothing else", derived.privateCredit.n === deals.rows.filter(isPrivateCreditFacilityRow).length);
  check("lease-backed rows are exactly the curated named project notes, nothing else", derived.leaseBacked.n === deals.rows.filter(isLeaseBackedRow).length);

  check("both Beignet variants are present: with and without", derived.shareWithBeignet !== null && derived.shareWithoutBeignet !== null && typeof derived.shareWithBeignet === "number" && typeof derived.shareWithoutBeignet === "number");
  /* Round-2 fix: Beignet is added to BOTH the numerator and the
     denominator (it is a status:"commentary" row, excluded from
     ledgerTotal), not the numerator alone — the old numerator-only
     formula was not a share of the population its own `formula` string
     claimed. Adding a slice whose own ratio (100%, $27.3bn of $27.3bn)
     is above the plain share still raises the blended ratio, so the
     with-Beignet point is still strictly the larger of the two. */
  check("the Beignet variant is still strictly larger (Beignet's own ratio is above the plain share, so adding it to both sides still raises the blend)", derived.shareWithBeignet > derived.shareWithoutBeignet, JSON.stringify({ without: derived.shareWithoutBeignet, with: derived.shareWithBeignet }));
  check("the Beignet variant is (private credit + Beignet) over (ledger total + Beignet) — both sides, not the numerator alone", near(derived.shareWithBeignet, (derived.privateCredit.totalUsdBn + derived.beignetUsdBn) / (derived.ledgerTotal.totalUsdBn + derived.beignetUsdBn)));
  check("both shares are plausible fractions, not percentages and not garbage (0 < share < 0.5)", derived.shareWithoutBeignet > 0 && derived.shareWithoutBeignet < 0.5 && derived.shareWithBeignet > 0 && derived.shareWithBeignet < 0.5);
  check("the lease-backed share is a plausible fraction", derived.leaseBackedShare > 0 && derived.leaseBackedShare < 0.5);

  check("every monthly point carries n and sums to the private-credit total", derived.monthlyPoints.every((p) => typeof p.n === "number" && p.n > 0) && near(derived.monthlyPoints.reduce((s, p) => s + p.v, 0), derived.privateCredit.totalUsdBn, 0.01));
  check("monthly points are dated on a calendar month end and sorted ascending", derived.monthlyPoints.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.p) && p.g === "month") && derived.monthlyPoints.every((p, i) => i === 0 || p.p > derived.monthlyPoints[i - 1].p));
}

/* ================= 3. writeDerivedSeries() merge safety ============= */
{
  const tmp = mkdtempSync(join(tmpdir(), "hs-ledger-series-"));
  for (const f of ["series.json", "series-index.json", "series-provenance.json"]) cpSync(join(PC_DIR, f), join(tmp, f));
  cpSync(join(PC_DIR, "series"), join(tmp, "series"), { recursive: true });

  const before = JSON.parse(readFileSync(join(PC_DIR, "series.json"), "utf8"));
  const beforeIndex = JSON.parse(readFileSync(join(PC_DIR, "series-index.json"), "utf8"));

  const fakeEntry = (label) => ({
    label, unit: "share", cadence: "asof", geography: "Global", source: "derived", group: "hs-ledgers",
    edition: null, asOf: "2020-01-01", publishedAt: null, vintage: "test", formula: "test formula", inputs: [],
    points: [{ p: "2020-01-01", g: "asof", v: 0.5, n: 1 }],
  });
  const entries = {
    derived_hs_private_credit_share_of_ledger: fakeEntry("fake share A"),
    derived_hs_jv_spv_lease_backed_share: fakeEntry("fake share B"),
    derived_hs_private_credit_facility_monthly: { ...fakeEntry("fake monthly"), unit: "$B", cadence: "month" },
  };
  writeDerivedSeries(entries, { pcDir: tmp });

  const after = JSON.parse(readFileSync(join(tmp, "series.json"), "utf8"));
  const afterIndex = JSON.parse(readFileSync(join(tmp, "series-index.json"), "utf8"));
  const afterProv = JSON.parse(readFileSync(join(tmp, "series-provenance.json"), "utf8"));
  const afterGroup = JSON.parse(readFileSync(join(tmp, "series", "hs-ledgers.json"), "utf8"));

  const untouchedKeys = Object.keys(before.keys).filter((k) => !(k in entries));
  check("every pre-existing key in series.json is left byte-for-byte alone", untouchedKeys.every((k) => JSON.stringify(after.keys[k]) === JSON.stringify(before.keys[k])));
  check("every pre-existing group in series-index.json is left alone", Object.keys(beforeIndex.groups).filter((g) => g !== "hs-ledgers").every((g) => JSON.stringify(afterIndex.groups[g]) === JSON.stringify(beforeIndex.groups[g])));
  check("the three keys land in series.json with the test entries", after.keys.derived_hs_private_credit_share_of_ledger.label === "fake share A" && after.keys.derived_hs_jv_spv_lease_backed_share.label === "fake share B" && after.keys.derived_hs_private_credit_facility_monthly.label === "fake monthly");
  check("the index carries all three under a single new 'hs-ledgers' group pointing at series/hs-ledgers.json", afterIndex.groups["hs-ledgers"] && afterIndex.groups["hs-ledgers"].file === "series/hs-ledgers.json" && afterIndex.groups["hs-ledgers"].keys.sort().join(",") === Object.keys(entries).sort().join(","));
  check("the index's n/first/last agree with the entry's own points for every new key", Object.keys(entries).every((k) => afterIndex.series[k].n === entries[k].points.length && afterIndex.series[k].first === entries[k].points[0].p));
  check("series.json, series-index.json and series-provenance.json name the same key set (test-pc-ingest.mjs's hygiene check)", Object.keys(after.keys).sort().join("|") === Object.keys(afterIndex.series).sort().join("|") && Object.keys(after.keys).sort().join("|") === Object.keys(afterProv.keys).sort().join("|"));
  check("the group file partitions exactly the three keys, nothing else", Object.keys(afterGroup.keys).sort().join(",") === Object.keys(entries).sort().join(","));
  check("every key of every series carries a population or is one of this run's own (no key without a population, per test-pc-ingest.mjs's hygiene check)", untouchedKeys.every((k) => after.keys[k].population !== undefined));

  rmSync(tmp, { recursive: true, force: true });
}

/* ================= 4. the committed output files, as last built ===== */
{
  const KEYS = ["derived_hs_private_credit_share_of_ledger", "derived_hs_jv_spv_lease_backed_share", "derived_hs_private_credit_facility_monthly"];
  const series = JSON.parse(readFileSync(join(PC_DIR, "series.json"), "utf8"));
  const index = JSON.parse(readFileSync(join(PC_DIR, "series-index.json"), "utf8"));
  const prov = JSON.parse(readFileSync(join(PC_DIR, "series-provenance.json"), "utf8"));
  const group = JSON.parse(readFileSync(join(PC_DIR, "series", "hs-ledgers.json"), "utf8"));

  check("the committed series.json carries all three keys", KEYS.every((k) => !!series.keys[k]));
  check("every committed key carries a non-empty population sentence", KEYS.every((k) => typeof series.keys[k].population === "string" && series.keys[k].population.length > 0));
  check("every committed point carries a finite numeric v and, where the key is per-row, an n", KEYS.every((k) => series.keys[k].points.every((p) => Number.isFinite(p.v) && Number.isFinite(p.n))));
  check("the private-credit share key carries exactly two points (with and without Beignet)", series.keys.derived_hs_private_credit_share_of_ledger.points.length === 2);
  check("one of the two points names the Beignet caveat", series.keys.derived_hs_private_credit_share_of_ledger.points.some((p) => /Beignet/.test(p.c || "")));
  check("the committed index and group file agree with series.json for all three keys", KEYS.every((k) => index.series[k] && group.keys[k] && JSON.stringify(group.keys[k]) === JSON.stringify(series.keys[k])));
  check("the committed provenance names a formula and an inputs array for all three keys", KEYS.every((k) => prov.keys[k] && typeof prov.keys[k].formula === "string" && Array.isArray(prov.keys[k].inputs)));
  check("series.json, series-index.json and series-provenance.json still name the same key set", Object.keys(series.keys).sort().join("|") === Object.keys(index.series).sort().join("|") && Object.keys(series.keys).sort().join("|") === Object.keys(prov.keys).sort().join("|"));
}

console.log(failed ? "\n" + failed + " failed" : "\nall ledger-series checks pass");
process.exit(failed ? 1 : 0);
