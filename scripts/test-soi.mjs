/**
 * test-soi.mjs — the schedule-of-investments readers against cuts of
 * real filings. Exits non-zero on the first failure.
 *
 * Fixtures in scripts/fixtures/soi/, each a verbatim cut:
 *   2026_07_soi_OFS.tsv       header plus every row of OFS Capital
 *                             (CIK 1487918) in the SEC BDC data set
 *                             2026_07_bdc.zip, soi.tsv (445 rows);
 *   2026_07_num_OFS.tsv       header plus OFS's datasets/num.tsv rows
 *                             for InvestmentCompanyFinancialCommitmentToInvesteeFutureAmount
 *                             and the undimensioned InvestmentOwnedAtCost /
 *                             InvestmentOwnedAtFairValue;
 *   2026_07_sub_OFS.tsv       header plus OFS's datasets/sub.tsv row;
 *   bxsl-20260630-instance-slice.xml
 *                             40 InvestmentIdentifierAxis members of
 *                             bxsl-20260630_htm.xml (BXSL 10-Q for
 *                             2026-06-30, accession 0001736035-26-000016)
 *                             with every context they carry, the
 *                             commitment-only members of the same issuers,
 *                             the undimensioned totals and the units.
 *
 * Every figure asserted below is read from one of those cuts, from the
 * companyfacts feed (OFS, fetched 2026-09-11) or from the blueprint's
 * verified ARCC figures (7.3), and the line says which. Nothing is from
 * memory. The July zip itself is not a fixture (2.4 MB): when it is on
 * disk — SOI_JULY_ZIP, or .cache/bdc/datasets/2026_07_bdc.zip where the
 * refresh caches it —
 * the last section runs the reader over all six filers and checks
 * ARCC's 1,439 rows against companyfacts; otherwise it says so and skips.
 */
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readCentralDirectory, streamMember, readLines, writeZipFile, findEntry,
} from "./lib/zip-stream.mjs";
import * as S from "./lib/soi-parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const FIX = join(here, "fixtures/soi");
const fixture = (name) => readFileSync(join(FIX, name));

let failed = 0;
const near = (a, b, tol = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) <= tol;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail !== undefined ? "  " + detail : ""));
  if (!ok) failed++;
};
const section = (name) => console.log("\n" + name);

/* ---------- zip-stream: the archive shape the readers expect ---------- */
section("zip-stream");
const scratch = join(tmpdir(), "rt-test-soi-" + process.pid);
mkdirSync(scratch, { recursive: true });
const members = [
  { name: "soi.tsv", data: fixture("2026_07_soi_OFS.tsv") },
  { name: "datasets/num.tsv", data: fixture("2026_07_num_OFS.tsv") },
  { name: "datasets/sub.tsv", data: fixture("2026_07_sub_OFS.tsv") },
  { name: "readme.htm", data: "<html></html>", method: 0 },
];
const zipPath = join(scratch, "fixture.zip");
const zip64Path = join(scratch, "fixture-zip64.zip");
await writeZipFile(zipPath, members);
await writeZipFile(zip64Path, members, { zip64: true });
{
  const dir = await readCentralDirectory(zipPath);
  check("central directory lists the four members", dir.entries.length === 4 && !dir.zip64, dir.entries.map((e) => e.name).join(","));
  const soi = findEntry(dir, "soi.tsv");
  check("soi.tsv entry: deflated, sizes from the record", soi && soi.method === 8 && soi.usize === fixture("2026_07_soi_OFS.tsv").length, soi && soi.usize);
  check("stored member is method 0", findEntry(dir, "readme.htm").method === 0);
  const dir64 = await readCentralDirectory(zip64Path);
  check("zip64 record and extra field are read", dir64.zip64 && dir64.entries.length === 4 && findEntry(dir64, "soi.tsv").usize === soi.usize);
  let n = 0, first = null, last = null;
  await readLines(await streamMember(zip64Path, /soi\.tsv$/, { directory: dir64 }), (line, i) => { n++; if (i === 0) first = line; last = line; });
  check("446 lines stream out of the zip64 member (header + 445 rows)", n === 446, n);
  check("first line is the 60-column header", first.split("\t").length === 60 && first.startsWith("adsh\tcik\tname"));
  check("last line is a data row, no trailing empty line", last.startsWith("0001487918-26-000078\t1487918\t"));
  let stopped = 0;
  const delivered = await readLines(await streamMember(zipPath, "soi.tsv", { directory: dir }), (line, i) => { stopped++; if (i >= 4) return false; });
  check("readLines stops when the callback returns false", delivered === 5 && stopped === 5, delivered);
  const lines = [];
  await readLines(await streamMember(zipPath, "readme.htm", { directory: dir }), (l) => lines.push(l));
  check("a stored member without a trailing newline still delivers its last line", lines.length === 1 && lines[0] === "<html></html>");
  let threw = null;
  try { await streamMember(zipPath, "missing.tsv", { directory: dir }); } catch (e) { threw = e.message; }
  check("a missing member throws, never returns an empty stream", /no member/.test(threw || ""), threw);
}

/* ---------- the data set: OFS, every row (accession 0001487918-26-000078) ---------- */
section("readSoiDataset on the OFS cut");
const OFS_ADSH = "0001487918-26-000078";
const ds = await S.readSoiDataset(zipPath, { ciks: [1487918] });
const ofs = ds.filings[OFS_ADSH];
check("one filing, keyed by accession", Object.keys(ds.filings).length === 1 && !!ofs);
check("filing header from the row: cik, form, period, filed", ofs.cik === 1487918 && ofs.form === "10-Q" && ofs.period === "2026-06-30" && ofs.filed === "2026-07-31" && ofs.name === "OFS CAPITAL CORP");
check("inline URL kept", ofs.inlineUrl === "https://www.sec.gov/ix?doc=/Archives/edgar/data/1487918/000148791826000078/ofs-20260630.htm", ofs.inlineUrl);
/* counts read off the cut: 445 rows, 261 with an identifier, 132 of those
   at the filing's own period end */
check("445 rows of the filer, 261 with an identifier, 132 at the period end", ofs.counts.rows === 445 && ofs.counts.identifier === 261 && ofs.counts.atPeriod === 132, JSON.stringify(ofs.counts));
check("129 identifier rows at other dates are ignored", ofs.dropped.otherDate === 129);
check("row rule keeps the 94 rows with both cost and fair value", ofs.counts.kept === 94 && ofs.rows.length === 94);
check("10 fair-value-only rows are subtotals, dropped and counted", ofs.dropped.fvOnly === 10);
check("28 rows with neither value (rate, maturity or shares only) are dropped and counted", ofs.dropped.neither === 28);
check("no labelled subtotal, cash line or entity-axis row in this filer", ofs.dropped.subtotal === 0 && ofs.dropped.cash === 0 && ofs.dropped.otherEntity === 0 && ofs.dropped.costOnly === 0);
{
  const none = await S.readSoiDataset(zipPath, { ciks: [1287750] });
  check("a CIK filter that excludes the filer yields no filing", Object.keys(none.filings).length === 0);
  const byAdsh = await S.readSoiDataset(zipPath, { adshs: [OFS_ADSH] });
  check("an accession filter finds the same 94 rows", byAdsh.filings[OFS_ADSH].rows.length === 94);
}

section("the gate");
/* companyfacts CIK0001487918, InvestmentOwnedAtCost and InvestmentOwnedAtFairValue,
   end 2026-06-30, 10-Q filed 2026-07-31, accession 0001487918-26-000078 (fetched 2026-09-11) */
const OFS_COST_TAG = 275837000, OFS_FV_TAG = 297756000;
const gate = S.reconcile(ofs.rows, { costTag: OFS_COST_TAG, fvTag: OFS_FV_TAG, dropped: ofs.dropped });
check("Σ cost of the 94 rows is the tagged 275,837,000 to the dollar", gate.cost.sum === OFS_COST_TAG && gate.cost.diffPct === 0, gate.cost.sum);
check("Σ fair value is the tagged 297,756,000 to the dollar", gate.fv.sum === OFS_FV_TAG && gate.fv.diffPct === 0, gate.fv.sum);
check("gate passes with 94 rows and 10 subtotal rows dropped", gate.passed && gate.reason === null && gate.rows === 94 && gate.subtotalRowsDropped === 10 && gate.tolerance === 0.005);
{
  const facts = await S.readNumFacts(zipPath, { adshs: [OFS_ADSH], tags: [S.COST_TAG, S.FV_TAG] });
  const totals = S.totalsFromFacts(facts[OFS_ADSH], ofs.period);
  check("the data set's own num.tsv carries the same two totals", totals.cost.value === OFS_COST_TAG && totals.fv.value === OFS_FV_TAG && totals.cost.uom === "USD");
  const noTag = S.reconcile(ofs.rows, { costTag: null, fvTag: OFS_FV_TAG });
  check("no tagged total means no pass", !noTag.passed && /no tagged total/.test(noTag.reason));
  const empty = S.reconcile([], { costTag: OFS_COST_TAG, fvTag: OFS_FV_TAG });
  check("no rows means no pass", !empty.passed && empty.reason === "no rows kept");
}

section("normalized rows (OFS)");
const row = (re) => ofs.rows.find((r) => re.test(r.id));
{
  /* "Portfolio Company Investment Type NCNA Debt and Equity Inv. SS Acquisition, LLC FLD Industry
     Sports and Recreation Instruction IR 9.48% SAI SOFR+5.75 % IAD 12/20/2024 Maturity 12/20/2029":
     Investment Interest Rate 0.0948, Basis Spread 0.0575, Principal 16710000, Adjusted cost basis
     16652000, Initial fair value 16877000, Net Assets % 0.1500, Maturity 2029-12-20, Acquisition 2024-12-20 */
  const r = row(/SS Acquisition, LLC FLD Industry/);
  check("first lien term loan: kind debt, class first lien, raw label expanded from FLD", r.kind === "debt" && r.lien.class === "first lien" && r.lien.subclass === null && r.lien.raw === "First Lien Debt");
  check("issuer key and readable name", r.issuer === "ss acquisition" && r.name === "SS Acquisition, LLC");
  check("rate 0.0948, spread 0.0575, floating, base SOFR from the text", r.rate === 0.0948 && r.spread === 0.0575 && r.floating === true && r.base === "SOFR");
  check("principal, cost, fair value to the dollar; pctNav 0.15", r.principal === 16710000 && r.cost === 16652000 && r.fv === 16877000 && r.pctNav === 0.15);
  check("maturity 2029-12-20 from the axis column, acquired 2024-12-20", r.maturity === "2029-12-20" && r.src.mat === "axis" && r.acquired === "2024-12-20");
  check("industry read from the identifier text, marked so", r.industry === "Sports and Recreation Instruction" && r.src.ind === "id");
  check("src marks the data-set path; no table, no R-page, no non-accrual source", r.src.row === "dataset" && r.src.table === false && r.src.r === false && r.src.na === "none" && r.nonAccrual === null);
  check("affiliation is null where neither axis nor text says", r.aff === null);
}
{
  /* "... BayMark Health Services, Inc. SLD Industry Outpatient Mental Health and Substance Abuse Centers
     IR 14.49% SAI SOFR+ 10.50% IAD 6/10/2021 Maturity 6/11/2028 One": cost 3961000, fair value 22000 */
  const r = row(/BayMark Health Services, Inc\. SLD .*One$/);
  check("second lien: class second lien, rate 0.1449, spread 0.105", r.kind === "debt" && r.lien.class === "second lien" && r.rate === 0.1449 && r.spread === 0.105);
  check("second lien marked to 22,000 from 3,961,000 of cost", r.cost === 3961000 && r.fv === 22000 && r.maturity === "2028-06-11");
}
{
  /* "Portfolio Company Investment Type AI Pfanstiehl Holdings, Inc CE (400 Class A shares) Industry
     Pharmaceutical Preparation Manufacturing IAD 1/1/2014": cost 217000, fair value 94550000, Net Assets % 0.8400 */
  const r = row(/Pfanstiehl Holdings, Inc CE/);
  check("equity: kind equity, class equity, no rate, not floating", r.kind === "equity" && r.lien.class === "equity" && r.rate === null && r.spread === null && r.floating === false);
  check("equity cost 217,000 against 94,550,000 of fair value, 84% of NAV", r.cost === 217000 && r.fv === 94550000 && r.pctNav === 0.84 && r.issuer === "pfanstiehl holdings");
}
{
  /* "... Structured Finance Securities Apex Credit CLO 2020 Ltd SN IR 5.31 % IAD 11/16/2020 Maturity 4/20/2035":
     cost 9164000, fair value 3515000, rate 0.0531 */
  const r = row(/Apex Credit CLO 2020 Ltd SN/);
  check("CLO subordinated note: kind structured, raw label Subordinated Note", r.kind === "structured" && r.lien.raw === "Subordinated Note" && r.rate === 0.0531 && r.cost === 9164000 && r.fv === 3515000 && r.maturity === "2035-04-20");
}
{
  /* "... Excelin Home Health, LLC SLD Industry Home Health Care Services IR 18.00% PIK IAD 10/25/2018
     Maturity 10/1/2026": Paid in Kind 0.1800, no rate, no spread */
  const r = row(/Excelin Home Health, LLC SLD/);
  check("all-PIK second lien: pik 0.18, no spread, not floating", r.pik === 0.18 && r.spread === null && r.rate === null && r.floating === false && r.lien.class === "second lien");
}
{
  /* "... Clevertech Bidco FLD (Revolver) Commodity Contracts Dealing IR 12.50% SAI Prime+ 5.75% ..." */
  const r = row(/Clevertech Bidco FLD \(Revolver\)/);
  check("Prime-based revolver: base other, facility revolver, floating", r.base === "other" && r.facility === "revolver" && r.floating === true && r.rate === 0.125 && r.spread === 0.0575);
}
{
  const kinds = {}, liens = {};
  for (const r of ofs.rows) { kinds[r.kind] = (kinds[r.kind] || 0) + 1; liens[r.lien.class] = (liens[r.lien.class] || 0) + 1; }
  check("kinds over the 94 rows: 66 debt, 19 equity, 9 structured", kinds.debt === 66 && kinds.equity === 19 && kinds.structured === 9 && !kinds.vehicle && !kinds.other, JSON.stringify(kinds));
  check("lien classes: 61 first lien, 4 second lien, 10 unsecured, 19 equity", liens["first lien"] === 61 && liens["second lien"] === 4 && liens.unsecured === 10 && liens.equity === 19, JSON.stringify(liens));
  check("floating share counts the 64 rows carrying a spread fact", ofs.rows.filter((r) => r.floating).length === 64 && ofs.rows.filter((r) => r.spread !== null).length === 64);
  check("51 distinct issuer keys", new Set(ofs.rows.map((r) => r.issuer)).size === 51);
  check("78 rows carry the tagged maturity date", ofs.rows.filter((r) => r.src.mat === "axis").length === 78);
  check("every row carries the compact shape", ofs.rows.every((r) => typeof r.id === "string" && "issuer" in r && "aff" in r && "kind" in r && r.lien && "class" in r.lien && "floating" in r && r.src && r.src.row === "dataset"));
}

section("unfunded commitments (num.tsv)");
{
  const subs = await S.readSubmissions(zipPath);
  check("sub.tsv: OFS period 2026-06-30, fiscal 2026 Q2, filed 2026-07-31", subs[OFS_ADSH] && subs[OFS_ADSH].period === "2026-06-30" && subs[OFS_ADSH].fy === 2026 && subs[OFS_ADSH].fp === "Q2" && subs[OFS_ADSH].filed === "2026-07-31");
  const unf = await S.readUnfunded(zipPath, { adshs: [OFS_ADSH] });
  const u = unf[OFS_ADSH];
  /* companyfacts InvestmentCompanyFinancialCommitmentToInvesteeFutureAmount end 2026-06-30: 6,003,000 */
  check("the undimensioned commitment total is 6,003,000, the companyfacts figure", u.total === 6003000 && u.period === "2026-06-30");
  check("17 members carry a commitment at the period end", u.members.length === 17);
  const sum = u.members.reduce((n, m) => n + m.amount, 0);
  const ss = u.members.filter((m) => /^SS Acquisition, LLC, First Lien Debt/.test(m.member));
  check("the members sum to 7,289,000: 1,286,000 over the total, the SS Acquisition revolver tagged under two members", sum === 7289000 && ss.length === 2 && ss.every((m) => m.amount === 1286000), sum);
  check("the December members are not counted", u.members.every((m) => m.member));
  const facts = await S.readNumFacts(zipPath, { adshs: [OFS_ADSH], tags: [S.UNFUNDED_TAG] });
  check("readNumFacts keeps only the named tag and converts YYYYMMDD dates", facts[OFS_ADSH].every((f) => f.tag === S.UNFUNDED_TAG && /^\d{4}-\d{2}-\d{2}$/.test(f.ddate)) && facts[OFS_ADSH].length === 34);
  const seg = S.parseSegments("InvestmentIdentifierAxis(us-gaap/2026)=I Love Produce, LLC First Lien Debt (Delayed Draw)();");
  check("a typed member ending in a parenthesis keeps its text whole", seg.length === 1 && seg[0].axis === "InvestmentIdentifierAxis" && seg[0].member === "I Love Produce, LLC First Lien Debt (Delayed Draw)");
  const seg2 = S.parseSegments("InvestmentTypeAxis(us-gaap/2025)=UndrawnRevolverMember(0001930087-26-000078);");
  check("an explicit member drops its version parenthesis", seg2[0].member === "UndrawnRevolverMember");
  const att = S.attachUnfunded(ofs.rows, u.members);
  check("every commitment joins a holding of its issuer", att.matched === 17 && att.unmatched.length === 0 && att.total === 7289000);
  const rev = row(/Honor HN Buyer Inc\. FLD \(Revolver\)/), dd = row(/Honor HN Buyer Inc\. FLD \(Delayed Draw\)/);
  check("Honor HN Buyer: 119,000 on the revolver, 473,000 on the delayed draw, by facility", rev.unfunded === 119000 && rev.src.unf === "issuer" && dd.unfunded === 473000 && dd.src.unf === "issuer");
  check("the Honor HN Buyer term loans carry no commitment", ofs.rows.filter((r) => r.issuer === "honor hn buyer" && r.facility === null).every((r) => r.unfunded === null));
  const total = ofs.rows.reduce((n, r) => n + (r.unfunded || 0), 0);
  check("Σ unfunded over holdings equals the members' sum", total === 7289000, total);
}

/* ---------- the instance: 40 members of BXSL's bxsl-20260630_htm.xml ---------- */
section("parseSoiInstance on the BXSL slice (accession 0001736035-26-000016)");
const inst = S.parseSoiInstance(readFileSync(join(FIX, "bxsl-20260630-instance-slice.xml"), "utf8"));
check("period defaults to the latest instant carrying cost and fair value", inst.period === "2026-06-30" && inst.instants["2026-06-30"] === 40 && inst.instants["2025-12-31"] === 36, JSON.stringify(inst.instants));
check("113 contexts, 59 members at the period, 40 holdings, 19 commitment-only members", inst.contexts === 113 && inst.members === 59 && inst.holdings.length === 40 && inst.unfunded.length === 19 && inst.dropped.commitmentOnly === 19, JSON.stringify(inst.dropped));
check("the December members are dropped as another date", inst.dropped.otherDate === 53);
/* Condensed Consolidated Statements of Assets and Liabilities, June 30, 2026: total investments at
   fair value 13,364,295 (cost 13,856,590), in thousands; here the undimensioned facts in dollars */
check("undimensioned totals: cost 13,856,590,000 and fair value 13,364,295,000, unitRef usd", inst.totals.cost.value === 13856590000 && inst.totals.fv.value === 13364295000 && inst.totals.cost.unitRef === "usd" && inst.totals.fv.tag === S.FV_TAG);
check("unit declarations read: usd is iso4217:USD, number is pure, eur is iso4217:EUR", inst.units.usd === "iso4217:USD" && inst.units.number === "pure" && inst.units.eur === "iso4217:EUR" && inst.units.shares === "shares");
const irow = (re) => inst.holdings.find((r) => re.test(r.id));
{
  /* contexts of "Corfin Holdings, Inc. 1 | Non-Affiliated Issuer" at 2026-06-30: InvestmentInterestRate 0.0897,
     InvestmentBasisSpreadVariableRate 0.0525, InvestmentOwnedBalancePrincipalAmount 260600000,
     InvestmentOwnedAtCost 259847000, InvestmentOwnedAtFairValue 260600000, InvestmentOwnedPercentOfNetAssets 0.0439 */
  const r = irow(/^Corfin Holdings, Inc\. 1 \|/);
  check("Corfin 1: the blueprint's 0.0525 spread and 0.0897 all-in rate", r.spread === 0.0525 && r.rate === 0.0897 && r.floating === true);
  check("Corfin 1: principal 260,600,000, cost 259,847,000, fair value 260,600,000, 4.39% of NAV", r.principal === 260600000 && r.cost === 259847000 && r.fv === 260600000 && r.pctNav === 0.0439);
  check("Corfin 1: unitRef verbatim on every numeric fact", JSON.stringify(r.units) === JSON.stringify({ spread: "number", rate: "number", principal: "usd", cost: "usd", fv: "usd", pctNav: "number" }), JSON.stringify(r.units));
  check("Corfin 1: '| Non-Affiliated Issuer' tail becomes the affiliation, tranche stripped from the key", r.aff === "non-controlled/non-affiliated" && r.issuer === "corfin holdings" && r.name === "Corfin Holdings, Inc.");
  check("Corfin 1: kind debt; lien unknown from the instance (no type axis on the member), raw null", r.kind === "debt" && r.lien.class === null && r.lien.raw === null && r.src.row === "instance");
  check("Corfin 2 is the second tranche of the same issuer", irow(/^Corfin Holdings, Inc\. 2 \|/).issuer === "corfin holdings" && irow(/^Corfin Holdings, Inc\. 2 \|/).rate === 0.0897);
}
{
  const c = (fn) => inst.holdings.filter(fn).length;
  check("3 holdings at a 0.0525 spread, 2 at a 0.0897 rate", c((r) => r.spread === 0.0525) === 3 && c((r) => r.rate === 0.0897) === 2);
  check("38 carry a spread, 35 a rate, 38 a principal, all 40 a % of NAV", c((r) => r.spread !== null) === 38 && c((r) => r.rate !== null) === 35 && c((r) => r.principal !== null) === 38 && c((r) => r.pctNav !== null) === 40);
  check("PIK on 5 of the 40", c((r) => r.pik !== null) === 5);
  check("no per-loan floor: BXSL tags floors on its summary members, not on loans", c((r) => r.floor !== null) === 0);
  check("39 non-affiliated, 1 non-controlled affiliated", c((r) => r.aff === "non-controlled/non-affiliated") === 39 && c((r) => r.aff === "non-controlled affiliated") === 1);
  check("38 debt, 1 equity, 1 vehicle", c((r) => r.kind === "debt") === 38 && c((r) => r.kind === "equity") === 1 && c((r) => r.kind === "vehicle") === 1);
}
{
  /* "ENV Bidco, AB 2 | Non-Affiliated Issuer": InvestmentOwnedBalancePrincipalAmount unitRef="eur" 1337000,
     InvestmentOwnedAtCost unitRef="usd" 1358000, rate 0.0729, spread 0.0500 */
  const r = irow(/^ENV Bidco, AB 2 \|/);
  check("a euro loan keeps its principal unitRef 'eur' verbatim while cost stays 'usd'", r.units.principal === "eur" && r.units.cost === "usd" && r.principal === 1337000 && r.cost === 1358000 && r.rate === 0.0729 && r.spread === 0.05);
}
{
  /* "Align Precision Group, LLC 1 | Non-Controlled Affiliated": InvestmentBasisSpreadVariableRate 0.0675,
     InvestmentInterestRatePaidInKind 0.1045, cost 9228000, fair value 8674000; the commitment member
     "Align Precision Group, LLC | Delayed Draw Term Loan" carries 135000 */
  const r = irow(/^Align Precision Group, LLC 1 \|/);
  check("Align Precision 1: non-controlled affiliated from the tail, PIK 0.1045, spread 0.0675, no cash rate tagged", r.aff === "non-controlled affiliated" && r.pik === 0.1045 && r.spread === 0.0675 && r.rate === null && r.cost === 9228000 && r.fv === 8674000);
  check("Align Precision 1: unitRef 'number' on the PIK rate", r.units.pik === "number");
  /* "SEKO Global Logistics Network, LLC 1 | Non-Affiliated Issuer": spread 0.0700, PIK 0.1067 */
  const s = irow(/^SEKO Global Logistics Network, LLC 1 \|/);
  check("SEKO 1: PIK 0.1067 on a 0.07 spread", s.pik === 0.1067 && s.spread === 0.07);
}
{
  /* "Micross Topco, Inc. - Common Equity | Non-Affiliated Issuer": InvestmentOwnedBalanceShares (unitRef shares),
     cost 4767000, fair value 7878000, 0.0013 of NAV */
  const r = irow(/^Micross Topco, Inc\. - Common Equity/);
  check("equity member: instrument split off the issuer, kind equity, class equity", r.kind === "equity" && r.lien.class === "equity" && r.lien.raw === "Common Equity" && r.issuer === "micross topco" && r.name === "Micross Topco, Inc.");
  check("equity member: shares unitRef verbatim, cost 4,767,000, fair value 7,878,000", r.units.shares === "shares" && r.cost === 4767000 && r.fv === 7878000 && r.pctNav === 0.0013 && r.floating === false);
}
{
  /* "Caerus Midco 2 S.&#xe0; r.l. - Vehicle Units | | Non - Affiliated Issuer": cost 58000, fair value 37000 */
  const r = irow(/^Caerus Midco 2/);
  check("entity decoded and the doubled pipe read: name 'Caerus Midco 2 S.à r.l.', key 'caerus midco 2'", r.name === "Caerus Midco 2 S.à r.l." && r.issuer === "caerus midco 2");
  check("'Non - Affiliated Issuer' with spaces still classifies; vehicle units are kind vehicle", r.aff === "non-controlled/non-affiliated" && r.kind === "vehicle" && r.cost === 58000 && r.fv === 37000);
  const ls = irow(/^L&S Mechanical/);
  check("'L&amp;S' decodes to 'L&S' in the name and 'l and s' in the key", ls && ls.name === "L&S Mechanical Acquisition, LLC" && ls.issuer === "l and s mechanical acquisition");
}
{
  const att = S.attachUnfunded(inst.holdings, inst.unfunded);
  check("all 19 commitments join their issuers' loans: 89,223,000 in total", att.matched === 19 && att.unmatched.length === 0 && att.total === 89223000, JSON.stringify(att));
  /* "Bazaarvoice, Inc. | Revolver" 37992000; "Axsome Therapeutics, Inc. | Delayed Draw Term Loan" 8805000
     and "| Revolver" 1957000 both land on the larger Axsome loan (cost 11649000) since neither loan names a facility */
  check("Bazaarvoice's revolver commitment 37,992,000 lands on its loan", irow(/^Bazaarvoice/).unfunded === 37992000 && irow(/^Bazaarvoice/).src.unf === "issuer");
  check("Axsome's two commitments (8,805,000 + 1,957,000) land on its larger loan", irow(/^Axsome Therapeutics, Inc\. 1 \|/).unfunded === 10762000 && irow(/^Axsome Therapeutics, Inc\. 2 \|/).unfunded === null);
  check("Align Precision's delayed-draw commitment 135,000 lands on its loan", irow(/^Align Precision Group, LLC 1 \|/).unfunded === 135000);
  const sum = inst.holdings.reduce((n, r) => n + (r.unfunded || 0), 0);
  check("Σ unfunded over holdings equals the commitments' total", sum === 89223000);
  const g = S.reconcile(inst.holdings, { costTag: inst.totals.cost.value, fvTag: inst.totals.fv.value, dropped: inst.dropped });
  check("the gate refuses a 40-member slice against the whole filing's totals", !g.passed && g.reason === "cost and fair value both outside tolerance" && g.cost.sum === 1681225000 && g.fv.sum === 1652363000 && g.rows === 40, JSON.stringify(g.cost) + " " + JSON.stringify(g.fv));
  check("the refusal carries the drop counts", g.subtotalRowsDropped === 0 && g.dropped.commitmentOnly === 19);
}
{
  const fixed = S.parseSoiInstance(readFileSync(join(FIX, "bxsl-20260630-instance-slice.xml"), "utf8"), { period: "2025-12-31" });
  check("a period argument selects the other instant: 36 holdings at 2025-12-31", fixed.period === "2025-12-31" && fixed.holdings.length === 36 && fixed.totals.cost === null);
}

/* ---------- the inline document: a dash-zero fact is 0, never 8,212 ---------- */
section("the inline 10-Q (OFS 0001487918-26-000078): fixed-zero facts");
{
  /* ofs-20260630-inline-dashzero-cut.htm: two ESP Associates members
     and the undimensioned cost total, verbatim from the inline
     document; the revolver's principal, cost, fair value and % of net
     assets are "&#8212;" under format="ixt:fixed-zero" at scale 3 */
  const inl = S.parseSoiInstance(readFileSync(join(FIX, "ofs-20260630-inline-dashzero-cut.htm"), "utf8"), { period: "2026-06-30" });
  check("inline: three contexts, two members at 2026-06-30, both kept", inl.contexts === 3 && inl.members === 2 && inl.holdings.length === 2, JSON.stringify(inl.dropped));
  const fld = inl.holdings.find((r) => !/Revolver/.test(r.id)), rev = inl.holdings.find((r) => /Revolver/.test(r.id));
  check("inline: the term loan reads 106 × 10^3 cost and fair value, 107 × 10^3 principal, 8.97% all-in, SOFR + 5.25%",
    fld && fld.cost === 106000 && fld.fv === 106000 && fld.principal === 107000 && near(fld.rate, 0.0897) && near(fld.spread, 0.0525) && fld.base === "SOFR" && fld.maturity === "2031-04-14",
    fld && JSON.stringify([fld.cost, fld.fv, fld.principal, fld.rate, fld.spread]));
  check("inline: the revolver's dash-zero cost, fair value and principal are 0, not 8,212,000",
    rev && rev.cost === 0 && rev.fv === 0 && rev.principal === 0 && rev.pctNav === 0 && near(rev.spread, 0.0525), rev && JSON.stringify([rev.cost, rev.fv, rev.principal, rev.pctNav]));
  check("inline: the undimensioned cost total is 275,837,000 (275,837 at scale 3)", inl.totals.cost && inl.totals.cost.value === 275837000 && inl.totals.fv === null, JSON.stringify(inl.totals));
  check("inline: no 8212 anywhere in the read", !JSON.stringify(inl).includes("8212"));
}
/* the whole filing, when the cache holds it: the extracted instance
   (-xbrl.zip's ofs-20260630_htm.xml) and the inline document must both
   agree with the data set's 94 rows, 275,837,000 / 297,756,000 — this
   is the instance fallback the weekly run takes before the monthly zip
   lands (blueprint 7.3) */
{
  const cache = join(ROOT, ".cache/bdc");
  const extracted = join(cache, "instances", `${OFS_ADSH}_htm.xml`);
  const inlineDoc = join(cache, "docs", `${OFS_ADSH}.htm`);
  const agree = (label, path) => {
    if (!existsSync(path)) { console.log(`  skip  ${label}: ${path} not on disk`); return; }
    const r = S.parseSoiInstance(readFileSync(path, "utf8"), { period: "2026-06-30" });
    const g = S.reconcile(r.holdings, { costTag: OFS_COST_TAG, fvTag: OFS_FV_TAG, dropped: r.dropped });
    check(`OFS ${label}: 94 rows, Σ cost 275,837,000 and Σ fair value 297,756,000, equal to the data set to the dollar`,
      r.holdings.length === 94 && g.passed && g.cost.sum === OFS_COST_TAG && g.fv.sum === OFS_FV_TAG, `${r.holdings.length} rows, ${g.cost.sum} / ${g.fv.sum}`);
  };
  agree("extracted instance", extracted);
  agree("inline document", inlineDoc);
}

/* ---------- normalizeRow on rows of other filers in the July data set ---------- */
section("normalizeRow: identifier shapes and classes");
{
  /* ARCC, accession 0001628280-26-050307, soi.tsv rows at 2026-06-30 (Adjusted cost basis / Initial fair value): */
  /* "Senior Direct Lending Program, LLC | Subordinated certificates": rate 0.1173, spread 0.0800,
     principal 1153700000, cost 1140400000, fair value 1153700000 — ARCC's joint venture with Varagon */
  const jv = S.normalizeRow({ id: "Senior Direct Lending Program, LLC | Subordinated certificates", rate: "0.1173", spread: "0.0800", principal: "1153700000.0000", cost: "1140400000.0000", fv: "1153700000.0000" });
  check("JV row (SDLP certificates): kind vehicle, lien class vehicles, floating, key 'senior direct lending program'", jv.kind === "vehicle" && jv.lien.class === "vehicles" && jv.floating === true && jv.issuer === "senior direct lending program" && jv.cost === 1140400000 && jv.fv === 1153700000 && jv.rate === 0.1173);
  /* "SGP Shaka HoldCo, LLC and SGP Shaka JV, LLC | Series A preferred units": cost 7700000, fair value 7700000 */
  const jv2 = S.normalizeRow({ id: "SGP Shaka HoldCo, LLC and SGP Shaka JV, LLC | Series A preferred units", cost: "7700000.0000", fv: "7700000.0000" });
  check("JV named in the issuer, preferred units: kind vehicle, class equity", jv2.kind === "vehicle" && jv2.lien.class === "equity" && jv2.lien.raw === "Series A preferred units");
  /* "Ivy Hill Asset Management, L.P. | Subordinated revolving loan": rate 0.1023, spread 0.0650, principal 946000000 */
  const ivy = S.normalizeRow({ id: "Ivy Hill Asset Management, L.P. | Subordinated revolving loan", rate: "0.1023", spread: "0.0650", principal: "946000000.0000", cost: "946000000.0000", fv: "946000000.0000" });
  check("the asset manager's subordinated revolver: kind vehicle, class unsecured, facility revolver", ivy.kind === "vehicle" && ivy.lien.class === "unsecured" && ivy.facility === "revolver" && ivy.principal === 946000000);
  /* "Microstar Logistics LLC, Microstar Global Asset Management LLC, MStar Holding Corporation and Kegstar
     USA Inc. | First lien senior secured loan": a borrower whose name says asset management */
  const ms = S.normalizeRow({ id: "Microstar Logistics LLC, Microstar Global Asset Management LLC, MStar Holding Corporation and Kegstar USA Inc. | First lien senior secured loan", cost: "1", fv: "1" });
  check("a first-lien loan to a borrower named 'Asset Management' is debt, not a vehicle", ms.kind === "debt" && ms.lien.class === "first lien");
  /* "Gestion ABS Bidco Inc. / ABS Bidco Holdings Inc. | First lien senior secured loan 1" */
  const abs = S.normalizeRow({ id: "Gestion ABS Bidco Inc. / ABS Bidco Holdings Inc. | First lien senior secured loan 1", cost: "1", fv: "1" });
  check("a borrower named ABS is debt, not structured", abs.kind === "debt");
  /* "ADG, LLC, GEDC Equity, LLC and RC IV GEDC Investor LLC | Second lien senior secured loan":
     principal 58100000, cost 54200000, fair value 15700000 */
  const sl = S.normalizeRow({ id: "ADG, LLC, GEDC Equity, LLC and RC IV GEDC Investor LLC | Second lien senior secured loan", principal: "58100000.0000", cost: "54200000.0000", fv: "15700000.0000" });
  check("second lien loan: class second lien, not floating without a spread fact", sl.kind === "debt" && sl.lien.class === "second lien" && sl.floating === false && sl.cost === 54200000 && sl.fv === 15700000);
  /* "15484880 Canada Inc. and 15484910 Canada Inc. | First lien senior secured loan 1": rate 0.0783, spread 0.0525, principal 300000 */
  const fl = S.normalizeRow({ id: "15484880 Canada Inc. and 15484910 Canada Inc. | First lien senior secured loan 1", rate: "0.0783", spread: "0.0525", principal: "300000.0000", cost: "300000.0000", fv: "300000.0000" });
  check("first lien loan with a tranche number: class first lien, floating, principal 300,000", fl.lien.class === "first lien" && fl.lien.raw === "First lien senior secured loan 1" && fl.floating === true && fl.principal === 300000);
  /* "15484880 Canada Inc. and 15484910 Canada Inc. | Class A2 shares": cost 13800000, fair value 14800000 */
  const eq = S.normalizeRow({ id: "15484880 Canada Inc. and 15484910 Canada Inc. | Class A2 shares", cost: "13800000.0000", fv: "14800000.0000" });
  check("equity row of the same issuer: class equity, same key", eq.kind === "equity" && eq.lien.class === "equity" && eq.issuer === fl.issuer);
  /* the Investment Type Axis, where a filer fills it (ARCC, 4 rows): "Debt Securities, First Lien Senior Secured Loans, Unitranche [Member]" */
  const uni = S.normalizeRow({ id: "Some Issuer | loan", type: "Debt Securities, First Lien Senior Secured Loans, Unitranche [Member]", cost: "1", fv: "1" });
  check("type axis: unitranche is first lien with the sub-class, raw label from the axis", uni.lien.class === "first lien" && uni.lien.subclass === "incl. unitranche/last-out" && uni.lien.raw === "Debt Securities, First Lien Senior Secured Loans, Unitranche");
}
{
  /* Golub Capital Private Credit Fund, accession 0001930087-26-000078, at 2025-09-30:
     "ABC Legal Holdings, LLC, One stop 1": rate 0.0865, spread 0.0450, principal 26792000, cost 26660000, fair value 26524000, Net Assets % 0.0070 */
  const one = S.normalizeRow({ id: "ABC Legal Holdings, LLC, One stop 1", rate: "0.0865", spread: "0.0450", principal: "26792000.0000", cost: "26660000.0000", fv: "26524000.0000", pctNav: "0.0070" });
  check("Golub 'One stop' is first lien incl. unitranche, issuer 'abc legal holdings'", one.lien.class === "first lien" && one.lien.subclass === "incl. unitranche/last-out" && one.issuer === "abc legal holdings" && one.name === "ABC Legal Holdings, LLC" && one.pctNav === 0.007);
  /* "AGL CLO 20 Ltd., Structured Finance Note": cost 1508000, fair value 1509000 */
  const sfn = S.normalizeRow({ id: "AGL CLO 20 Ltd., Structured Finance Note", cost: "1508000.0000", fv: "1509000.0000" });
  check("a structured finance note is kind structured", sfn.kind === "structured" && sfn.issuer === "agl clo 20");
  /* "Kodiak Buyer, LLC, LP interest" */
  const lp = S.normalizeRow({ id: "Kodiak Buyer, LLC, LP interest", cost: "1", fv: "1" });
  check("'LP interest' is the instrument, not a legal suffix", lp.kind === "equity" && lp.issuer === "kodiak buyer" && lp.lien.raw === "LP interest");
}
{
  /* Hercules, accession 0001280784-26-000042: "Debt Investments, Healthcare Services, Other, Marathon Health, LLC,
     Senior Secured, February 2029, Prime + 0.25%, Floor rate 8.25%, PIK Interest 2.25%, 3.00% Exit Fee":
     Basis Spread 0.0025, Floor 0.0825, Paid in Kind 0.0225, principal 184924000, cost 185759000, fair value 184780000 */
  const r = S.normalizeRow({ id: "Debt Investments, Healthcare Services, Other, Marathon Health, LLC, Senior Secured, February 2029, Prime + 0.25%, Floor rate 8.25%, PIK Interest 2.25%, 3.00% Exit Fee", spread: "0.0025", floor: "0.0825", pik: "0.0225", principal: "184924000.0000", cost: "185759000.0000", fv: "184780000.0000" });
  check("Hercules: issuer found past a two-part industry, industry 'Healthcare Services, Other'", r.issuer === "marathon health" && r.name === "Marathon Health, LLC" && r.industry === "Healthcare Services, Other" && r.src.ind === "id");
  check("Hercules: Prime-based, floor 0.0825, PIK 0.0225, first lien from 'Senior Secured'", r.base === "other" && r.floor === 0.0825 && r.pik === 0.0225 && r.lien.class === "first lien" && r.floating === true);
  check("Hercules: 'February 2029' becomes the month's last day, marked as read from the text", r.maturity === "2029-02-28" && r.src.mat === "id");
  /* "Debt Investments, Application Software, Total Tipalti Solutions Ltd." is an issuer subtotal, cost 116.44M */
  check("Hercules' 'Total <issuer>' rows are subtotals", S.isSubtotalIdentifier("Debt Investments, Application Software, Total Tipalti Solutions Ltd.") && S.isSubtotalIdentifier("Warrant Investments, Consumer & Business Services, Total Carwow LTD"));
  check("Hercules' money-market line is a cash equivalent", S.isCashEquivalent("Investment Fund, Cash & Cash Equivalent, GS Financial Square Government Fund,  FGTXX/38141W273"));
}
{
  /* Saratoga, accession 0001213900-26-075931: "Affiliate investments - 13.3% - Axero Holdings, LLC - Employee Collaboration Software -
     First Lien Term Loan 10.66% Cash, (3M USD TERM SOFR + 7.00%) PIK, 12/31/2027": principal 17151088, cost 17141912, fair value 17080768 */
  const r = S.normalizeRow({ id: "Affiliate investments - 13.3% - Axero Holdings, LLC - Employee Collaboration Software - First Lien Term Loan 10.66% Cash, (3M USD TERM SOFR + 7.00%) PIK, 12/31/2027", principal: "17151088.0000", cost: "17141912.0000", fv: "17080768.0000" });
  check("Saratoga: affiliation from the first segment, issuer from the third, industry from the fourth", r.aff === "non-controlled affiliated" && r.issuer === "axero holdings" && r.industry === "Employee Collaboration Software");
  check("Saratoga: first lien, SOFR named in the text, maturity 2027-12-31 from the text, floating by base", r.lien.class === "first lien" && r.base === "SOFR" && r.maturity === "2027-12-31" && r.floating === true && r.facility === "term loan");
  check("Saratoga's 'Sub Total' and 'Total' rows and its industry subtotals are subtotals", S.isSubtotalIdentifier("Sub Total Affiliate investments") && S.isSubtotalIdentifier("Total Investment Fund") && S.isSubtotalIdentifier("Non-control/Non-affiliate investments - 273.4% - Cyber Security"));
  check("an issuer whose name starts with 'Total' is not a subtotal", !S.isSubtotalIdentifier("Total Safety U.S., Inc. | First lien senior secured loan"));
  check("ARCC's aggregate members are subtotals", S.isSubtotalIdentifier("Largest Portfolio Company Investment") && S.isSubtotalIdentifier("Top Five Largest Portfolio Company Investments"));
}
{
  const cls = (s) => S.affiliationClass(s);
  check("affiliation: the data set's axis labels", cls("Investment, Unaffiliated Issuer") === "non-controlled/non-affiliated" && cls("Investment, Affiliated Issuer, Noncontrolled") === "non-controlled affiliated" && cls("Investment, Affiliated Issuer, Controlled") === "controlled" && cls("Investment, Affiliated Issuer") === "non-controlled affiliated");
  check("affiliation: the instance's explicit members", cls("us-gaap:InvestmentUnaffiliatedIssuerMember") === "non-controlled/non-affiliated" && cls("us-gaap:InvestmentAffiliatedIssuerNoncontrolledMember") === "non-controlled affiliated" && cls("us-gaap:InvestmentAffiliatedIssuerControlledMember") === "controlled");
  check("affiliation: the identifier tails", cls("Non-Affiliated Issuer") === "non-controlled/non-affiliated" && cls("Non - Affiliated Issuer") === "non-controlled/non-affiliated" && cls("Non-Controlled Affiliated") === "non-controlled affiliated" && cls("Control investments") === "controlled" && cls("Non-control/Non-affiliate investments") === "non-controlled/non-affiliated" && cls("Affiliate investments") === "non-controlled affiliated");
  check("affiliation: an instrument tail is not an affiliation", cls("Delayed Draw Term Loan") === null && cls("Revolver") === null);
  check("member labels: camel case and [Member] suffixes", S.memberLabel("bxsl:DebtSecuritiesFirstLienMember") === "Debt Securities First Lien" && S.memberLabel("Diversified Financial Services [Member]") === "Diversified Financial Services");
  check("issuer keys: case, punctuation, legal suffixes, '&'", S.normalizeIssuer("Corfin Holdings, Inc. 1") === "corfin holdings" && S.normalizeIssuer("L&S Mechanical Acquisition, LLC") === "l and s mechanical acquisition" && S.normalizeIssuer("Caerus Midco 2 S.à r.l.") === "caerus midco 2" && S.normalizeIssuer("MAG DS Corp.") === "mag ds");
  const h = S.toCreditHolding(irow(/^Corfin Holdings, Inc\. 1 \|/));
  check("toCreditHolding: the flat shape credit.js reads (isDebt, thirdParty, accruing, lien string)", h.isDebt === true && h.thirdParty === true && h.accruing === true && h.lien === null && h.spread === 0.0525 && h.company === "Corfin Holdings, Inc.");
  const v = S.toCreditHolding(S.normalizeRow({ id: "Senior Direct Lending Program, LLC | Subordinated certificates", cost: "1", fv: "1" }));
  check("toCreditHolding: a vehicle is not third party and carries the vehicles class", v.thirdParty === false && v.isDebt === false && v.lien === "vehicles");
}

/* ---------- the whole July file, when it is on disk ---------- */
section("the July 2026 data set (six filers), when on disk");
const julyZip = process.env.SOI_JULY_ZIP || [join(ROOT, ".cache/bdc/datasets/2026_07_bdc.zip"), join(ROOT, ".cache/bdc/2026_07_bdc.zip")].find(existsSync) || join(ROOT, ".cache/bdc/datasets/2026_07_bdc.zip");
if (!existsSync(julyZip)) {
  console.log("  skip  2026_07_bdc.zip not on disk (set SOI_JULY_ZIP or place it under .cache/bdc/); the fixture checks above stand");
} else {
  const dir = await readCentralDirectory(julyZip);
  const all = await S.readSoiDataset(julyZip, { directory: dir });
  const adshs = Object.keys(all.filings);
  const facts = await S.readNumFacts(julyZip, { adshs, tags: [S.UNFUNDED_TAG, S.COST_TAG, S.FV_TAG], directory: dir });
  check("six filers in the July file", adshs.length === 6, adshs.length);
  const pad = (s, n) => String(s).padEnd(n);
  const m = (v) => (v === null || v === undefined ? "—" : (v / 1e6).toFixed(1) + "M");
  for (const adsh of adshs) {
    const f = all.filings[adsh];
    const totals = S.totalsFromFacts(facts[adsh] || [], f.period);
    const g = S.reconcile(f.rows, { costTag: totals.cost && totals.cost.value, fvTag: totals.fv && totals.fv.value, dropped: f.dropped });
    const u = S.unfundedFromFacts(facts[adsh] || [], f.period);
    const att = S.attachUnfunded(f.rows, u.members);
    console.log(`  ${pad(f.name.slice(0, 34), 34)} ${adsh} ${pad(f.form, 6)} ${f.period}  kept ${pad(f.counts.kept, 5)} subtotals ${pad(f.dropped.fvOnly + f.dropped.subtotal, 3)} cash ${f.dropped.cash} entity ${pad(f.dropped.otherEntity, 3)} gate ${g.passed ? "pass" : "refused"} cost ${m(g.cost.sum)} vs ${m(g.cost.tag)} (${g.cost.diffPct === null ? "—" : (g.cost.diffPct * 100).toFixed(2) + "%"}) fv ${m(g.fv.sum)} vs ${m(g.fv.tag)} (${g.fv.diffPct === null ? "—" : (g.fv.diffPct * 100).toFixed(2) + "%"}) unfunded ${u.members.length} members, ${att.matched} joined`);
  }
  /* blueprint 7.3 and companyfacts CIK0001287750 (accession 0001628280-26-050307):
     1,481 identifier rows at the period end, 39 fair-value-only subtotals, 1,439 rows with both,
     summing to 29,674.6M at cost and 29,349.3M at fair value, matching the tags exactly */
  const arcc = all.filings["0001628280-26-050307"];
  check("ARCC: 1,481 identifier rows at 2026-06-30, 39 fair-value-only subtotals, 1,439 kept", arcc && arcc.counts.atPeriod === 1481 && arcc.dropped.fvOnly === 39 && arcc.rows.length === 1439, arcc && JSON.stringify(arcc.counts));
  const cf = JSON.parse(readFileSync(join(ROOT, "frontend/data/bdc/company-ARCC.json"), "utf8"));
  const q2 = cf.series.periods.find((p) => p.end === "2026-06-30");
  const ag = S.reconcile(arcc.rows, { costTag: q2.values.portfolioCost.v, fvTag: q2.values.portfolioFairValue.v, dropped: arcc.dropped });
  check("ARCC: Σ cost 29,674,600,000 and Σ fair value 29,349,300,000 equal the companyfacts tags", ag.passed && ag.cost.sum === 29674600000 && ag.fv.sum === 29349300000 && ag.cost.diffPct === 0 && ag.fv.diffPct === 0, JSON.stringify(ag.cost) + " " + JSON.stringify(ag.fv));
  check("ARCC: the companyfacts tags are the blueprint's figures", q2.values.portfolioCost.v === 29674600000 && q2.values.portfolioFairValue.v === 29349300000 && q2.values.portfolioCost.accn === "0001628280-26-050307");
  const ofsJuly = all.filings[OFS_ADSH];
  check("OFS from the whole file matches the fixture cut row for row", ofsJuly.rows.length === 94 && JSON.stringify(ofsJuly.rows.map((r) => [r.id, r.cost, r.fv])) === JSON.stringify(ofs.rows.map((r) => [r.id, r.cost, r.fv])));
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
