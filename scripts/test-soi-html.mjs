/**
 * test-soi-html.mjs — the HTML schedule reader and the R-page reader
 * against cuts of two real filings (scripts/fixtures/soi-html/, see
 * its README.md):
 *
 *   - Blackstone Secured Lending Fund's 10-Q for June 30 2026,
 *     accession 0001736035-26-000016: pages 1, 2 and 9 of the June
 *     schedule with the schedule's footnotes, then page 1 of the
 *     December 31 2025 comparative with its footnotes (1) and (17).
 *     The tables are in thousands (the heading says so).
 *   - Ares Capital Corporation's 10-Q for June 30 2026, accession
 *     0001628280-26-050307: FilingSummary.xml and a cut of R9.htm, the
 *     rendered schedule, in millions.
 *
 * Every figure below is read off the fixture, which is the filing's
 * own text: the row is named, the page is the schedule page.
 *
 * With BXSL_10Q_HTML or ARCC_R9_HTML set to the whole document, the
 * full-document counts run too and are printed; they are skipped
 * otherwise, so CI needs nothing beyond the fixtures.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseScheduleTables, joinHoldings, parseRateText, parseDate, mapHeader, headerName,
  splitMember, issuerKey, saysNonAccrual, classifySection,
} from "./lib/soi-html.mjs";
import { findScheduleReport, parseRPage } from "./lib/rpage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures/soi-html", name), "utf8");
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail !== undefined ? "  " + detail : ""));
  if (!ok) failed++;
};
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;

/* ---------- readers ---------- */
console.log("readers");
check("header names drop their markers", headerName("Investments (1)(19)") === "investments" && headerName("Interest Rate (2)(15)") === "interest rate");
const hdr = mapHeader(["Investments (1)(19)", "Footnotes", "Reference Rate and Spread (2)", "Interest Rate (2)(15)", "Acquisition Date", "Maturity Date", "Par Amount/Units (1)", "Cost (3)", "Fair Value", "% of Net Assets"].map((text) => ({ text, span: 3 })));
check("BXSL's header resolves all ten columns", hdr && hdr.keys.length === 10 && ["issuer", "footnotes", "spread", "rate", "acquired", "maturity", "principal", "cost", "fv", "pctNav"].every((k) => hdr.keys.includes(k)), hdr && hdr.keys.join(","));
const hdr2 = mapHeader(["Company", "Business Description", "Investment", "Interest", "Acquisition Date", "Amortized Cost", "Fair Value", "Percentage of Net Assets"].map((text) => ({ text, span: 1 })));
check("a Company / Business Description / Investment header resolves issuer, industry and type", hdr2 && hdr2.cols.map((c) => c.key).join(",") === "issuer,industry,type,rate,acquired,cost,fv,pctNav", hdr2 && hdr2.cols.map((c) => c.key).join(","));
check("a swap table's header is not a schedule", mapHeader(["Counterparty", "Hedged Item", "Company Receives", "Company Pays", "Maturity Date", "Notional Amount", "Fair Market Value"].map((text) => ({ text, span: 3 }))) === null);
check("a fair-value hierarchy table is not a schedule", mapHeader(["", "Level 1", "Level 2", "Level 3", "Total Fair Value"].map((text) => ({ text, span: 1 }))) === null);
/* rate strings as BXSL prints them (schedule pages 1, 9 and the unsecured note) */
let r = parseRateText("SOFR + 5.25 %", "8.97 %");
check("\"SOFR + 5.25 %\" / \"8.97 %\": SOFR, 0.0525, 0.0897", r.base === "SOFR" && r.spread === 0.0525 && r.rate === 0.0897 && r.pik === null, JSON.stringify(r));
r = parseRateText("SOFR + 10.50 %", "14.17 % (incl. 9.50 % PIK)");
check("\"14.17 % (incl. 9.50 % PIK)\": rate 0.1417, pik 0.095", r.rate === 0.1417 && r.pik === 0.095 && r.spread === 0.105, JSON.stringify(r));
r = parseRateText("SOFR + 10.00 %", "13.67 % PIK");
check("\"13.67 % PIK\": all PIK", r.rate === 0.1367 && r.pik === 0.1367, JSON.stringify(r));
r = parseRateText("13.75 %", "13.75 % PIK");
check("a bare \"13.75 %\" under Reference Rate and Spread beside \"13.75 % PIK\" is a fixed coupon, not a spread", r.spread === null && r.base === null && r.rate === 0.1375 && r.pik === 0.1375, JSON.stringify(r));
r = parseRateText("E + 5.00 %", "6.94 %");
check("\"E + 5.00 %\" is a spread over another index", r.base === "other" && r.spread === 0.05, JSON.stringify(r));
r = parseRateText("S + 6.00 %", "10.20 %");
check("\"S +\" is SONIA by BXSL's footnote 2, so base is other", r.base === "other" && r.spread === 0.06, JSON.stringify(r));
r = parseRateText(null, "SOFR + 5.75% (11.08%)");
check("a filer that prints spread and rate in one cell", r.base === "SOFR" && r.spread === 0.0575 && r.rate === 0.1108, JSON.stringify(r));
r = parseRateText("SOFR+5.75% (1.00% Floor)", "10.08%");
check("a floor inside the spread cell", r.floor === 0.01 && r.spread === 0.0575, JSON.stringify(r));
r = parseRateText("5.25%", "9.60%");
check("a bare spread beside a different rate stays a spread", r.spread === 0.0525 && r.rate === 0.096 && r.base === null, JSON.stringify(r));
check("dates: 2/5/2020, 12/27/2027, February 5, 2020, 5-Feb-2020, 2020-02-05", ["2/5/2020", "February 5, 2020", "5-Feb-2020", "2020-02-05", "Feb 5, 2020"].every((d) => parseDate(d) && parseDate(d).iso === "2020-02-05") && parseDate("12/27/2027").iso === "2027-12-27");
check("a month without a day is the first of the month at month precision", parseDate("Feb 2020").iso === "2020-02-01" && parseDate("Feb 2020").precision === "month" && parseDate("2/2020").iso === "2020-02-01");
check("an impossible date is null", parseDate("6/31/2027") === null && parseDate("N/A") === null && parseDate("") === null);
let sm = splitMember("Corfin Holdings, Inc. 1 | non-controlled/non-affiliated");
check("BXSL member \"Issuer N | affiliation\"", sm.issuer === "Corfin Holdings, Inc." && sm.seq === 1 && sm.aff === "non-controlled/non-affiliated" && sm.type === null, JSON.stringify(sm));
sm = splitMember("15484880 Canada Inc. and 15484910 Canada Inc. | First lien senior secured loan 2");
check("ARCC member \"Issuer | Type N\"", sm.issuer === "15484880 Canada Inc. and 15484910 Canada Inc." && sm.type === "First lien senior secured loan" && sm.seq === 2, JSON.stringify(sm));
sm = splitMember("ABC Legal Holdings, LLC, One stop 2");
check("Golub member \"Issuer, Type N\"", sm.issuer === "ABC Legal Holdings, LLC" && sm.type === "One stop" && sm.seq === 2, JSON.stringify(sm));
check("issuer keys agree across spellings", issuerKey("Corfin Holdings, Inc.") === issuerKey("CORFIN HOLDINGS INC 1") && issuerKey("Aventine Intermediate LLC &amp; Aventine Holdings II LLC") === issuerKey("Aventine Intermediate LLC & Aventine Holdings II LLC"));
check("non-accrual sentences", saysNonAccrual("Loan was on non-accrual status as of June 30, 2026.") && !saysNonAccrual("Non-income producing security.") && !saysNonAccrual("The loan was removed from non-accrual status during the quarter."));
let sec = classifySection("First Lien Debt - non-controlled/non-affiliated (continued)");
check("a lien-and-affiliation section row, continued", sec.lien === "First Lien Debt" && sec.aff === "non-controlled/non-affiliated" && sec.continued && !sec.industry, JSON.stringify(sec));
sec = classifySection("Health Care Providers & Services");
check("an industry section row", sec.industry === "Health Care Providers & Services" && !sec.lien, JSON.stringify(sec));
sec = classifySection("Equity Real Estate Investment Trusts (REITs)");
check("an industry that carries a lien word is still an industry", sec.industry && !sec.lien, JSON.stringify(sec));
sec = classifySection("Non-controlled/non-affiliated investments");
check("an affiliation-only section row", sec.affOnly && sec.aff === "non-controlled/non-affiliated", JSON.stringify(sec));

/* ---------- the BXSL schedule cut ---------- */
console.log("BXSL 10-Q 0001736035-26-000016, schedule pages 1, 2 and 9 (June 30 2026), in thousands");
const bxsl = fixture("bxsl-10q-2026q2-schedule-cut.htm");
const s = parseScheduleTables(bxsl);
check("the June schedule is chosen by default and December is seen", s.period === "2026-06-30" && s.periods.includes("2025-12-31"), s.period + " " + s.periods.join(","));
check("header map resolves every column of the printed header", ["investments", "footnotes", "reference rate and spread", "interest rate", "acquisition date", "maturity date", "par amount/units", "cost", "fair value", "% of net assets"].every((h) => h in s.headers), JSON.stringify(s.headers));
check("three page-broken tables concatenate into one schedule of 72 rows", s.tables === 3 && s.rows.length === 72 && [1, 2, 3].every((p) => s.rows.some((x) => x.page === p)), s.tables + " tables, " + s.rows.length + " rows");
check("scale 1,000 from the heading's \"(in thousands)\"", s.scale === 1000, String(s.scale));
const corfin = s.rows[0];
check("page 1 row 1 is Corfin Holdings, Inc.: par $260,600K, cost $259,847K, fair value $260,600K, 4.39% of net assets",
  corfin.issuer === "Corfin Holdings, Inc." && corfin.principal === 260600000 && corfin.cost === 259847000 && corfin.fv === 260600000 && corfin.pctNav === 0.0439, JSON.stringify([corfin.issuer, corfin.principal, corfin.cost, corfin.fv, corfin.pctNav]));
check("Corfin: SOFR + 5.25 %, 8.97 %, acquired 2/5/2020, matures 12/27/2027",
  corfin.base === "SOFR" && corfin.spread === 0.0525 && corfin.rate === 0.0897 && corfin.acquired === "2020-02-05" && corfin.maturity === "2027-12-27" && corfin.maturityPrecision === "day", JSON.stringify([corfin.base, corfin.spread, corfin.rate, corfin.acquired, corfin.maturity]));
check("Corfin's footnote markers come from the Footnotes column: (4)(10)", corfin.footnotes.join("") === "(4)(10)" && corfin.nonAccrual === false, corfin.footnotes.join(""));
check("section rows: First Lien Debt, non-controlled/non-affiliated, Aerospace & Defense",
  corfin.section.lien === "First Lien Debt" && corfin.section.lienClass === "first lien" && corfin.section.aff === "non-controlled/non-affiliated" && corfin.industry === "Aerospace & Defense", JSON.stringify(corfin.section));
check("the row's inline-XBRL context is kept (c-56)", corfin.ctx === "c-56", corfin.ctx);
check("every row parses a maturity date on the debt pages", s.rows.every((x) => x.maturity && /^\d{4}-\d{2}-\d{2}$/.test(x.maturity)), String(s.rows.filter((x) => !x.maturity).length) + " without");
check("every row carries cost, fair value, principal and % of net assets", s.rows.every((x) => x.cost != null && x.fv != null && x.principal != null && x.pctNav != null));
const p2 = s.rows.find((x) => x.page === 2);
check("page 2 opens under \"First Lien Debt - non-controlled/non-affiliated (continued)\" with a new industry, Biotechnology (Axsome Therapeutics)",
  p2 && p2.issuer === "Axsome Therapeutics, Inc." && p2.section.lien === "First Lien Debt" && p2.section.aff === "non-controlled/non-affiliated" && p2.industry === "Biotechnology", p2 && JSON.stringify([p2.issuer, p2.section, p2.industry]));
const p3 = s.rows.find((x) => x.page === 3);
check("page 9 re-states both sections as (continued): UMP Holdings under Health Care Providers & Services",
  p3 && p3.issuer === "UMP Holdings, LLC" && p3.section.lien === "First Lien Debt" && p3.industry === "Health Care Providers & Services", p3 && JSON.stringify([p3.issuer, p3.section.lien, p3.industry]));
check("industries seen across the three pages", ["Aerospace & Defense", "Air Freight & Logistics", "Biotechnology", "Building Products", "Chemicals", "Commercial Services & Supplies", "Health Care Providers & Services", "Health Care Technology"].every((i) => s.rows.some((x) => x.industry === i)));
/* the schedule prints an unlabelled subtotal after each industry;
   the rows under that industry must add up to it */
const sumBy = (industry) => s.rows.filter((x) => x.industry === industry).reduce((a, x) => ({ cost: a.cost + x.cost, fv: a.fv + x.fv }), { cost: 0, fv: 0 });
for (const [industry, cost, fv] of [["Aerospace & Defense", 413045000, 415431000], ["Air Freight & Logistics", 455046000, 441565000], ["Biotechnology", 155305000, 154960000], ["Building Products", 210426000, 191551000]]) {
  const got = sumBy(industry);
  const printed = s.subtotalRows.find((t) => t.cost === cost && t.fv === fv);
  check(`${industry} rows add to the printed subtotal ${cost / 1000} / ${fv / 1000} (thousands)`, got.cost === cost && got.fv === fv && !!printed, JSON.stringify(got));
}
check("subtotal rows are counted, not kept (5 in the cut)", s.subtotals === 5 && !s.rows.some((x) => /^total/i.test(x.issuer)), String(s.subtotals));
check("twenty footnotes resolve for the June schedule", Object.keys(s.footnotes).length === 20, Object.keys(s.footnotes).join(""));
check("(17) is the non-accrual footnote", s.footnotes["(17)"] === "Loan was on non-accrual status as of June 30, 2026.", s.footnotes["(17)"]);
check("(7) is the unfunded-commitment footnote", /^Position or portion thereof is an unfunded commitment/.test(s.footnotes["(7)"] || ""), s.footnotes["(7)"]);
check("(12) and (15), printed without ix:footnote wrappers, resolve too", /1\.25\s*%/.test(s.footnotes["(12)"] || "") && /unsettled positions/.test(s.footnotes["(15)"] || ""), (s.footnotes["(12)"] || "") + " | " + (s.footnotes["(15)"] || ""));
const whcg = s.rows.filter((x) => x.issuer === "WHCG Purchaser III, Inc.");
const na = whcg.find((x) => x.footnotes.includes("(17)"));
check("WHCG Purchaser III (4)(5)(10)(17) on page 9 is non-accrual; its sister row (4)(5)(7)(10) is not",
  whcg.length === 2 && na && na.nonAccrual === true && whcg.find((x) => x !== na).nonAccrual === false, JSON.stringify(whcg.map((x) => [x.footnotes.join(""), x.nonAccrual])));
check("the non-accrual row: par $18,715K, cost $6,354K, fair value $11,977K, matures 6/30/2030",
  na && na.principal === 18715000 && na.cost === 6354000 && na.fv === 11977000 && na.maturity === "2030-06-30", na && JSON.stringify([na.principal, na.cost, na.fv, na.maturity]));
check("the non-accrual row is a fixed 10.00 % PIK loan: no spread, rate 0.10, pik 0.10", na && na.spread === null && na.rate === 0.1 && na.pik === 0.1, na && JSON.stringify([na.raw, na.spread, na.rate, na.pik]));
check("exactly one non-accrual row in the cut", s.rows.filter((x) => x.nonAccrual).length === 1);
const seko = s.rows.filter((x) => x.issuer === "SEKO Global Logistics Network, LLC");
check("SEKO's rows read their PIK: \"14.17 % (incl. 9.50 % PIK)\" → 0.1417 / 0.095 and \"13.67 % PIK\" → 0.1367 / 0.1367",
  seko.some((x) => x.rate === 0.1417 && x.pik === 0.095) && seko.some((x) => x.rate === 0.1367 && x.pik === 0.1367), JSON.stringify(seko.map((x) => [x.raw.rate, x.rate, x.pik])));
const env = s.rows.find((x) => x.issuer === "ENV Bidco, AB" && x.base === "other");
check("ENV Bidco, AB's euro tranche: \"E + 5.00 %\" is a spread over Euribor (base other), 7.29 %", env && env.spread === 0.05 && env.rate === 0.0729, env && JSON.stringify(env.raw));
check("its par is printed \"EUR 1,337\": principal 1,337,000 in EUR, cost $1,358K and fair value $1,512K in dollars", env && env.principal === 1337000 && env.currency === "EUR" && env.cost === 1358000 && env.fv === 1512000, env && JSON.stringify([env.principal, env.currency, env.cost, env.fv]));
check("dollar rows carry no currency", corfin.currency === null);
check("every other debt row on these pages is over SOFR", s.rows.filter((x) => x.base === "SOFR").length === 70, String(s.rows.filter((x) => x.base === "SOFR").length));
check("36 distinct issuers on the three pages", new Set(s.rows.map((x) => x.issuer)).size === 36, String(new Set(s.rows.map((x) => x.issuer)).size));

/* the December comparative resolves its own footnote block */
const d = parseScheduleTables(bxsl, { period: "2025-12-31" });
check("the December 31 2025 schedule is read on request: one page, 26 rows", d.period === "2025-12-31" && d.tables === 1 && d.rows.length === 26, d.period + " " + d.tables + " " + d.rows.length);
check("December's (17) is its own sentence", d.footnotes["(17)"] === "Loan was on non-accrual status as of December 31, 2025.", d.footnotes["(17)"]);
check("December page 1 row 1: Aevex Holdings, LLC at cost $46,781K", d.rows[0].issuer === "Aevex Holdings, LLC" && d.rows[0].cost === 46781000, JSON.stringify([d.rows[0].issuer, d.rows[0].cost]));
const missing = parseScheduleTables(bxsl, { period: "2024-12-31" });
check("a period the document does not print falls back to the latest with a note", missing.period === "2026-06-30" && missing.notes.some((n) => /no schedule headed 2024-12-31/.test(n)), missing.notes.join("; "));

/* ---------- the join ---------- */
console.log("join: a 40-member slice built from the same rows, in the instance's member form");
const slice = s.rows.slice(0, 40);
const members = slice.map((x, i) => {
  const id = `${x.issuer} ${(i % 3) + 1} | non-controlled/non-affiliated`;
  if (i < 30) return { id, issuer: x.issuer, principal: x.principal, cost: x.cost, fv: x.fv };
  if (i < 35) return { id, issuer: x.issuer.toUpperCase().replace(/,/g, ""), principal: Math.round(x.principal * 1.003), cost: x.cost, fv: x.fv };
  if (i < 38) return { id, issuer: x.issuer, principal: null, cost: x.cost, fv: x.fv };
  return { id, issuer: null, principal: Math.round(x.principal * 1.02), cost: Math.round(x.cost * 1.02), fv: x.fv };
});
const j = joinHoldings(members, s.rows);
check("at least 90% of the 40 members match (name + principal, then name + cost, then name alone when unique)", j.rate >= 0.9, `${j.matched.length}/${members.length} = ${(j.rate * 100).toFixed(0)}% ${JSON.stringify(j.stages)}`);
check("exact principals match by principal; principals 0.3% off still match by principal", j.stages.principal >= 35, JSON.stringify(j.stages));
check("members without a principal match by cost", j.stages.cost >= 3, JSON.stringify(j.stages));
check("each row is matched at most once", new Set(j.matched.map((m) => m.row)).size === j.matched.length);
check("the non-accrual row is never dropped: it heads unmatchedRows", j.unmatchedRows.length && j.unmatchedRows[0].nonAccrual === true && j.nonAccrualUnmatched === 1, String(j.nonAccrualUnmatched));
check("all 72 rows are accounted for", j.matched.length + j.unmatchedRows.length === s.rows.length);
const bad = joinHoldings([{ id: "Corfin Holdings, Inc. 9 | non-controlled/non-affiliated", principal: 999000000, cost: 999000000 }], s.rows);
check("a member whose principal and cost are both off, under a name with two rows, is not matched", bad.matched.length === 0 && bad.unmatchedMembers.length === 1);
const one = joinHoldings([{ issuer: "MAG DS Corp" }], s.rows);
check("a member with a name alone matches when the name is unique on both sides (MAG DS Corp., one row on page 1)", one.matched.length === 1 && one.matched[0].stage === "name" && one.matched[0].row.issuer === "MAG DS Corp.");
const two = joinHoldings([{ issuer: "ENV Bidco AB" }], s.rows);
check("a name alone does not match when the table has two rows under it (ENV Bidco, AB)", two.matched.length === 0 && two.unmatchedMembers.length === 1);

/* ---------- the R page ---------- */
console.log("ARCC 10-Q 0001628280-26-050307: FilingSummary.xml and the R9.htm cut ($ in millions)");
const rep = findScheduleReport(fixture("arcc-FilingSummary-2026q2.xml"));
check("FilingSummary names R9.htm as the schedule report, not the parenthetical R5", rep && rep.file === "R9.htm" && /CONSOLIDATED SCHEDULE OF INVESTMENTS$/.test(rep.longName), JSON.stringify(rep));
const rp = parseRPage(fixture("arcc-r9-2026q2-cut.htm"));
check("periods Jun. 30, 2026 then Dec. 31, 2025; the first is the default", rp.period === "2026-06-30" && rp.periods.join(",") === "2026-06-30,2025-12-31", rp.periods.join(","));
check("scale from \"$ in Millions\"", rp.scale === 1e6, String(rp.scale));
check("the page's own totals: amortized cost $29,674.6M, fair value $29,349.3M", rp.totals.cost === 29674600000 && rp.totals.fv === 29349300000, JSON.stringify(rp.totals));
const sw = rp.industries.find((i) => i.name === "Software and Services");
const fin = rp.industries.find((i) => i.name === "Financial Services");
check("industry totals: Software and Services $6,793.0M cost, $6,451.2M fair value, 46.45% of net assets", sw && sw.cost === 6793000000 && sw.fv === 6451200000 && sw.pctNav === 0.4645, JSON.stringify(sw));
check("industry totals: Financial Services $3,686.8M / $3,935.8M / 28.34%", fin && fin.cost === 3686800000 && fin.fv === 3935800000 && fin.pctNav === 0.2834, JSON.stringify(fin));
check("issuer totals: ACP Avenu Midco LLC $17.4M cost, $17.6M fair value", rp.issuers.some((i) => i.name === "ACP Avenu Midco LLC" && i.cost === 17400000 && i.fv === 17600000), JSON.stringify(rp.issuers[0]));
check("22 identifier members carry cost and fair value at June 30 2026; 3 carry fair value only", rp.rows.length === 22 && rp.fvOnly.length === 3, rp.rows.length + " / " + rp.fvOnly.length);
check("the fair-value-only members are issuer subtotals (ACAS Equity Holdings, ADF Capital, ADG)", rp.fvOnly.map((x) => x.issuer.split(",")[0]).join("|") === "ACAS Equity Holdings Corporation|ADF Capital|ADG", rp.fvOnly.map((x) => x.issuer).join(" | "));
const canada = rp.rows.find((x) => x.member === "15484880 Canada Inc. and 15484910 Canada Inc. | First lien senior secured loan 1");
check("15484880 Canada Inc. … | First lien senior secured loan 1: coupon 7.83%, spread 5.25%, principal $0.3M, cost $0.3M, fair value $0.3M, first lien",
  canada && canada.coupon === 0.0783 && canada.spread === 0.0525 && canada.principal === 300000 && canada.cost === 300000 && canada.fv === 300000 && canada.lien === "first lien", canada && JSON.stringify([canada.coupon, canada.spread, canada.principal, canada.cost, canada.fv, canada.lien]));
const shares = rp.rows.find((x) => x.member === "15484880 Canada Inc. and 15484910 Canada Inc. | Class A2 shares");
check("… | Class A2 shares: equity, 19,825,189 shares, cost $13.8M, fair value $14.8M", shares && shares.lien === "equity" && shares.shares === 19825189 && shares.cost === 13800000 && shares.fv === 14800000, shares && JSON.stringify([shares.lien, shares.shares, shares.cost, shares.fv]));
const sub = rp.rows.find((x) => x.member === "22 HoldCo Limited | Senior subordinated loan");
check("22 HoldCo Limited | Senior subordinated loan: unsecured, spread 7.50%, principal $72.1M", sub && sub.lien === "unsecured" && sub.spread === 0.075 && sub.principal === 72100000, sub && JSON.stringify([sub.lien, sub.spread, sub.principal]));
const adg = rp.rows.find((x) => x.member === "ADG, LLC, GEDC Equity, LLC and RC IV GEDC Investor LLC | Second lien senior secured loan");
check("ADG … | Second lien senior secured loan carries [11] and is non-accrual: cost $54.2M, fair value $15.7M, second lien",
  adg && adg.nonAccrual === true && adg.markers.includes("(11)") && adg.cost === 54200000 && adg.fv === 15700000 && adg.lien === "second lien", adg && JSON.stringify([adg.markers, adg.cost, adg.fv, adg.lien]));
check("[11] is the June non-accrual footnote and [12] the December one", rp.footnotes["(11)"] === "Loan was on non-accrual status as of June 30, 2026." && rp.footnotes["(12)"] === "Loan was on non-accrual status as of December 31, 2025.", (rp.footnotes["(11)"] || "") + " | " + (rp.footnotes["(12)"] || ""));
check("only that row is non-accrual at June 30 2026 in the cut", rp.rows.filter((x) => x.nonAccrual).length === 1, String(rp.rows.filter((x) => x.nonAccrual).length));
check("ARCC's members are not nested under an industry: industry per row is null and the page says so", rp.rows.every((x) => x.industry === null) && rp.notes.some((n) => /not nested under an industry/.test(n)), rp.notes.join("; "));
check("industry comes from the page as totals: 2 industry members in the cut, 25 on the full page", rp.industries.length === 2 && rp.axes.EquitySecuritiesByIndustryAxis === 2, JSON.stringify(rp.axes));
const rd = parseRPage(fixture("arcc-r9-2026q2-cut.htm"), { period: "2025-12-31" });
const adgDec = rd.rows.find((x) => x.member === "ADG, LLC, GEDC Equity, LLC and RC IV GEDC Investor LLC, Second lien senior secured loan");
check("at December 31 2025 the comma-form member \"ADG …, Second lien senior secured loan\" is non-accrual through [12]", adgDec && adgDec.nonAccrual === true && adgDec.markers.includes("(12)") && adgDec.issuer === "ADG, LLC, GEDC Equity, LLC and RC IV GEDC Investor LLC" && adgDec.type === "Second lien senior secured loan", adgDec && JSON.stringify([adgDec.markers, adgDec.issuer, adgDec.type]));
check("the June-form ADG member has no December value and is absent from the December rows", !rd.rows.some((x) => x.member === adg.member));
check("December totals: cost $29,249.9M, fair value $29,484.8M, PIK coupon 2.25%", rd.totals.cost === 29249900000 && rd.totals.fv === 29484800000 && rd.totals.pik === 0.0225, JSON.stringify(rd.totals));

/* ---------- the whole documents, when they are on disk ---------- */
const fullBxsl = process.env.BXSL_10Q_HTML;
if (fullBxsl && existsSync(fullBxsl)) {
  console.log("full BXSL 10-Q (" + fullBxsl + ")");
  const f = parseScheduleTables(readFileSync(fullBxsl, "utf8"));
  const debtOrEquity = f.rows.filter((x) => !/cash/i.test(x.section.lien || ""));
  const cost = debtOrEquity.reduce((a, x) => a + x.cost, 0), fv = debtOrEquity.reduce((a, x) => a + x.fv, 0);
  const naRows = f.rows.filter((x) => x.nonAccrual);
  const naCost = naRows.reduce((a, x) => a + x.cost, 0), naFv = naRows.reduce((a, x) => a + x.fv, 0);
  console.log(`  ${f.tables} page tables, ${f.rows.length} rows (${debtOrEquity.length} investments, ${f.rows.length - debtOrEquity.length} cash), ${f.subtotals} subtotals, ${Object.keys(f.footnotes).length} footnotes`);
  console.log(`  non-accrual rows: ${naRows.length} (${new Set(naRows.map((x) => x.issuer)).size} issuers), cost ${(naCost / 1e6).toFixed(1)}M = ${(naCost / cost * 100).toFixed(2)}% of cost, fair value ${(naFv / 1e6).toFixed(1)}M = ${(naFv / fv * 100).toFixed(2)}% of fair value`);
  check("the June schedule runs to 34 page tables and several hundred rows", f.tables === 34 && f.rows.length >= 600 && f.rows.length <= 1000, f.tables + " tables, " + f.rows.length + " rows");
  check("the rows add to the printed Total Investment Portfolio: $13,856,590K cost, $13,364,295K fair value", f.totals && cost === f.totals.cost && fv === f.totals.fv && f.totals.cost === 13856590000 && f.totals.fv === 13364295000, JSON.stringify([cost, fv, f.totals]));
  check("non-accrual at cost within 0.1 point of the 3.6% the plan states, and at fair value of 1.8%", near(naCost / cost * 100, 3.6, 0.1) && near(naFv / fv * 100, 1.8, 0.1), `${(naCost / cost * 100).toFixed(2)} / ${(naFv / fv * 100).toFixed(2)}`);
  const acc = debtOrEquity.filter((x) => x.section.lienClass !== "equity" && !x.nonAccrual && x.rate != null && x.principal);
  const num = acc.reduce((a, x) => a + x.principal * x.rate, 0);
  const yc = num / acc.reduce((a, x) => a + x.cost, 0) * 100, yf = num / acc.reduce((a, x) => a + x.fv, 0) * 100;
  console.log(`  weighted-average yield on performing debt, before discount accretion: ${yc.toFixed(2)}% at cost, ${yf.toFixed(2)}% at fair value (the 10-Q states 9.2% and 9.4%)`);
  check("the computed yield sits 0 to 0.3 points under the disclosed 9.2% / 9.4%", yc <= 9.2 && yc >= 8.9 && yf <= 9.4 && yf >= 9.1, `${yc.toFixed(2)} / ${yf.toFixed(2)}`);
} else {
  console.log("full BXSL 10-Q: skipped (set BXSL_10Q_HTML to the document to run it)");
}
const fullArcc = process.env.ARCC_R9_HTML;
if (fullArcc && existsSync(fullArcc)) {
  console.log("full ARCC R9.htm (" + fullArcc + ")");
  const f = parseRPage(readFileSync(fullArcc, "utf8"));
  const cost = f.rows.reduce((a, x) => a + x.cost, 0), fv = f.rows.reduce((a, x) => a + x.fv, 0);
  const naRows = f.rows.filter((x) => x.nonAccrual);
  const naCost = naRows.reduce((a, x) => a + x.cost, 0), naFv = naRows.reduce((a, x) => a + x.fv, 0);
  console.log(`  ${f.rows.length} positions with cost and fair value, ${f.fvOnly.length} fair-value-only members (${(f.fvOnly.reduce((a, x) => a + x.fv, 0) / 1e6).toFixed(1)}M), ${f.industries.length} industries, ${f.issuers.length} issuers`);
  console.log(`  non-accrual rows: ${naRows.length}, cost ${(naCost / 1e6).toFixed(1)}M = ${(naCost / cost * 100).toFixed(2)}%, fair value ${(naFv / 1e6).toFixed(1)}M = ${(naFv / fv * 100).toFixed(2)}%`);
  check("1,439 positions summing to $29,674.6M at cost and $29,349.3M at fair value, the tagged totals", f.rows.length === 1439 && cost === 29674600000 && fv === 29349300000 && f.totals.cost === cost && f.totals.fv === fv, JSON.stringify([f.rows.length, cost, fv]));
  check("39 fair-value-only members summing to $5,067.3M", f.fvOnly.length === 39 && f.fvOnly.reduce((a, x) => a + x.fv, 0) === 5067300000);
  check("non-accrual within 0.1 point of the plan's 2.4% at cost and 1.4% at fair value", near(naCost / cost * 100, 2.4, 0.1) && near(naFv / fv * 100, 1.4, 0.1), `${(naCost / cost * 100).toFixed(2)} / ${(naFv / fv * 100).toFixed(2)}`);
} else {
  console.log("full ARCC R9.htm: skipped (set ARCC_R9_HTML to the document to run it)");
}

console.log(failed ? "\n" + failed + " failed" : "\nall soi-html checks pass");
process.exit(failed ? 1 : 0);
