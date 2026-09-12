/**
 * test-bdc-prose.mjs — the prose reader against cuts of real filings.
 * Exits non-zero on the first failure.
 *
 * Every figure asserted below is read from one of four main documents,
 * cut to fixtures under scripts/fixtures/prose/ by line window with the
 * accession in the fixture's first line:
 *   BXSL 10-Q for the quarter ended 2026-06-30, accession 0001736035-26-000016
 *     (bxsl-20260630.htm): Note 1, Note 3, Note 4, Note 7, Item 2's
 *     portfolio table and liquidity paragraph, Item 3;
 *   MAIN 10-Q for the same quarter, accession 0001396440-26-000094
 *     (main-20260630.htm): Notes A, B, C, D and G, Item 2's results and
 *     liquidity paragraphs, Item 3;
 *   ARCC 10-Q for the same quarter, accession 0001628280-26-050307
 *     (arcc-20260630.htm): Notes 1, 3, 4 and 6, Item 2's activity, yield
 *     and results tables, Item 3;
 *   OBDC 10-Q for the same quarter, accession 0001655888-26-000056
 *     (obdc-20260630.htm): the target leverage sentence in Item 2.
 * The verified-facts file (pc-x/verified-facts.md, section C) states
 * the BXSL figures the same way. Nothing is from memory.
 *
 * The last block runs the reader over a cut of BXSL's Item 4 that
 * states none of the figures, and every field must come back null: a
 * reader that finds a number in a document that has none is worse than
 * one that finds nothing.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractProse, htmlToText, parseNumber, rowNumbers, sentenceOf, _internal } from "./lib/bdc-prose.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "scripts/fixtures/prose");
const read = (f) => readFileSync(join(FIX, f), "utf8");

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail !== undefined ? "  " + detail : ""));
  if (!ok) failed++;
};
const near = (a, b, tol = 0.0005) => a !== null && a !== undefined && Math.abs(a - b) <= tol;
const v = (f) => (f && f.v !== undefined ? f.v : null);
const has = (f, re) => Boolean(f && f.sentence && re.test(f.sentence));

/* ---------- the primitives ---------- */
console.log("primitives");
check("parseNumber reads a parenthesized thousand as negative", parseNumber("(23,798)").v === -23798);
check("parseNumber keeps a percent unit", parseNumber("9.2 %").v === 9.2 && parseNumber("9.2 %").unit === "%");
check("parseNumber reads 1.78x as a multiple", parseNumber("1.78x").v === 1.78 && parseNumber("1.78x").unit === "x");
check("parseNumber reads a dash as zero", parseNumber("-").v === 0 && parseNumber("-").dash === true);
check("rowNumbers merges a lone $ and % cell into its neighbour",
  JSON.stringify(rowNumbers("Up 100 basis points | $ | 132,588 | $ | (23,798) | $ | 108,790").map((n) => n.v)) === "[132588,-23798,108790]");
check("rowNumbers skips a footnote marker after a label but not a negative after $",
  JSON.stringify(rowNumbers("Average loan-to-value (LTV) (3) | 51.9 | % | 50.5 | %").map((n) => n.v)) === "[51.9,50.5]" &&
  JSON.stringify(rowNumbers("Down 100 basis points | $ | (211) | $ | (118) | $ | (93)", { markers: false }).map((n) => n.v)) === "[-211,-118,-93]");
check("sentenceOf does not split on a decimal or on U.S.",
  sentenceOf("The ratio was 178.0 % and 177.1 %, respectively. U.S. GAAP applies. Next.", 5).text === "The ratio was 178.0 % and 177.1 %, respectively." &&
  sentenceOf("The ratio was 178.0 % and 177.1 %, respectively. U.S. GAAP applies. Next.", 60).text === "U.S. GAAP applies.");
check("htmlToText renders a table row as cells and drops a self-closing filler cell",
  htmlToText("<table><tr><td>Up 100 basis points</td><td colspan=\"2\">132,588&#160;</td><td style=\"x\"/><td colspan=\"3\"/><td>(23,798)</td></tr></table>") === "Up 100 basis points | 132,588 | (23,798)");
check("htmlToText treats a span boundary as zero width (1</span><span>.49% is 1.49%)",
  htmlToText("<div><span>represented 0.29</span><span>% of the total (or 1</span><span>.49% at cost).</span></div>") === "represented 0.29% of the total (or 1.49% at cost).");
check("pairBases pairs figures with the basis that follows each",
  JSON.stringify(_internal.pairBases("represented 2.4 % of the total investments at amortized cost (or 1.4 % at fair value) and 1.8 % at amortized cost (or 1.2 % at fair value), respectively")) ===
  JSON.stringify([{ v: 2.4, basis: "cost" }, { v: 1.4, basis: "fv" }, { v: 1.8, basis: "cost" }, { v: 1.2, basis: "fv" }]));
check("pairBases pairs a run of figures with a run of bases by position",
  JSON.stringify(_internal.pairBases("comprised 1.1 % and 4.0 % of the total Investment Portfolio at fair value and cost, respectively")) ===
  JSON.stringify([{ v: 1.1, basis: "fv" }, { v: 4.0, basis: "cost" }]));
check("shockOf reads Up/Down, +/- and a bare (100)",
  _internal.shockOf("Up 100 basis points").bps === 100 && _internal.shockOf("Down 200 basis points").bps === -200 &&
  _internal.shockOf("(100)").bps === -100 && _internal.shockOf("100").bps === 100 && _internal.shockOf("+50 bps").bps === 50 &&
  _internal.shockOf("Total") === null);
check("periodPhrase spells the date as a filing does", _internal.periodPhrase("2026-06-30") === "June 30, 2026" && _internal.periodPhrase("2026-05-31") === "May 31, 2026");

/* ---------- BXSL ---------- */
console.log("BXSL 10-Q 2026-06-30, accession 0001736035-26-000016");
const bxsl = extractProse(read("bxsl-10q-2026-06-30.txt"), { ticker: "BXSL", period: "2026-06-30" });
/* Note 7: "the Company's asset coverage was 178.0 % and 177.1 %, respectively" */
check("asset coverage 178.0% -> 1.78, from the Note 7 sentence", v(bxsl.assetCoveragePct) === 1.78 && bxsl.assetCoveragePct.pct === 178, JSON.stringify(bxsl.assetCoveragePct && bxsl.assetCoveragePct.sentence));
check("asset coverage takes the first figure of the period-dated sentence, not the December comparative", !near(v(bxsl.assetCoveragePct), 1.771));
check("no SBA relief in BXSL's paragraph", bxsl.assetCoveragePct.sbaRelief === false && bxsl.sbaExempt === null);
check("statutory floor 150 from 'is at least 150% after such borrowing'", v(bxsl.statutoryCoverage) === 150 && has(bxsl.statutoryCoverage, /at least 150%/));
/* Item 2 table: "Weighted average yield on performing debt and income producing investments, at amortized cost (1)(2) | 9.2 % | 9.5 %" */
check("weighted-average yield at cost 9.2 from the table row (period column first)", v(bxsl.waYieldAtCost) === 9.2, bxsl.waYieldAtCost && bxsl.waYieldAtCost.sentence);
check("weighted-average yield at fair value 9.4", v(bxsl.waYieldAtFv) === 9.4);
check("the yield row's footnote (1) travels with it", has({ sentence: bxsl.waYieldAtCost.note }, /annual stated interest rate or yield/));
check("LTV 51.9", v(bxsl.ltv) === 51.9);
check("floating share 99.3, of performing debt investments", v(bxsl.floatingShare) === 99.3 && bxsl.floatingShare.basis.of === "debt");
check("313 portfolio companies", v(bxsl.portfolioCompanies) === 313);
check("non-accrual 3.6 at cost / 1.8 at fair value, of total assets", v(bxsl.nonAccrualCostPct) === 3.6 && v(bxsl.nonAccrualFvPct) === 1.8 && bxsl.nonAccrualCostPct.of === "total");
check("yield on new investments 9.2 and on exits 9.3", v(bxsl.yieldOnNew) === 9.2 && v(bxsl.yieldOnExits) === 9.3);
/* Item 3: "Up 100 basis points | $ 132,588 | $ (23,798) | $ 108,790" in thousands */
const up100 = bxsl.rateSensitivity && bxsl.rateSensitivity.find((r) => r.shock === "+100 bps");
const down100 = bxsl.rateSensitivity && bxsl.rateSensitivity.find((r) => r.shock === "-100 bps");
check("Item 3 table read as a table: six shock rows", Boolean(bxsl.rateSensitivity) && bxsl.rateSensitivity.length === 6);
check("+100 bps: interest income 132,588 thousand, interest expense (23,798), net 108,790, scaled to dollars",
  up100 && up100.interestIncome === 132588000 && up100.interestExpense === -23798000 && up100.net === 108790000 && up100.scale === "thousands");
check("-100 bps mirrors it", down100 && down100.interestIncome === -132588000 && down100.net === -108790000);
check("the columns were labeled from the header", up100 && JSON.stringify(up100.columns) === JSON.stringify(["interestIncome", "interestExpense", "net"]));
check("the intro sentence is kept as provenance", bxsl.rateSensitivity.intro && /99.3\s?% of our performing debt investments/.test(bxsl.rateSensitivity.intro.sentence));
/* Note 3 */
check("management fee 1.0% of gross assets", v(bxsl.fees.managementFeeRate) === 1);
check("income incentive fee 17.5% with a 1.5% hurdle and 100% catch-up", v(bxsl.fees.incentiveIncomeRate) === 17.5 && v(bxsl.fees.hurdle) === 1.5 && v(bxsl.fees.catchUp) === 100);
check("the hurdle is quarterly and 6.0% annualized", bxsl.fees.hurdleAnnual === 6);
check("capital gains fee 17.5%", v(bxsl.fees.capitalGainsRate) === 17.5);
check("externally managed", v(bxsl.internallyManaged) === false);
check("fee sentences collected", bxsl.feeSentences.length >= 5 && bxsl.feeSentences.every((s) => s.sentence.length <= 704 && s.where.line > 0));
check("no dividend split, target leverage or adjusted NII stated in these pages", bxsl.dividendSplit === null && bxsl.targetLeverage === null && bxsl.distributableNii === null && bxsl.coreNiiPerShare === null);
check("every figure names its line and section", ["assetCoveragePct", "waYieldAtCost", "ltv", "floatingShare", "portfolioCompanies", "nonAccrualCostPct"].every((k) => bxsl[k].where && bxsl[k].where.line > 0 && /^Item \d/.test(bxsl[k].where.section)));
check("the asset coverage sentence sits in Item 1 and the yield row in Item 2", bxsl.assetCoveragePct.where.section === "Item 1" && bxsl.waYieldAtCost.where.section === "Item 2");

/* ---------- MAIN ---------- */
console.log("MAIN 10-Q 2026-06-30, accession 0001396440-26-000094");
const main = extractProse(read("main-10q-2026-06-30.txt"), { ticker: "MAIN", period: "2026-06-30" });
/* Item 2: "As of June 30, 2026, our BDC asset coverage ratio was 244%." in the paragraph that states the January 2008 exemptive relief */
check("asset coverage 244% -> 2.44 with sbaRelief true", v(main.assetCoveragePct) === 2.44 && main.assetCoveragePct.pct === 244 && main.assetCoveragePct.sbaRelief === true);
check("sbaExempt true from 'we received exemptive relief from the SEC to exclude SBA-guaranteed debt securities'", v(main.sbaExempt) === true && has(main.sbaExempt, /exemptive relief/) && has(main.sbaExempt, /SBA/));
check("statutory floor 150 from the 2022 reduction sentence", v(main.statutoryCoverage) === 150);
/* Note G: "Regular monthly dividends per share | $ 0.78 ..." and "Supplemental dividends per share | 0.30" */
check("dividend split regular 0.78 / supplemental 0.30 / total 1.08 from the Note G rows", main.dividendSplit && main.dividendSplit.regular === 0.78 && main.dividendSplit.supplemental === 0.3 && main.dividendSplit.total === 1.08 && main.dividendSplit.special === null);
/* Note B: "$ 65.2 million at fair value and $ 198.5 million at cost and comprised 1.1 % and 4.0 % ... at fair value and cost, respectively" */
check("non-accrual 4.0 at cost / 1.1 at fair value, read in the sentence's own order (fair value first)", v(main.nonAccrualCostPct) === 4 && v(main.nonAccrualFvPct) === 1.1);
/* Item 2: "Distributable net investment income per share-Basic and diluted (a) | $ 1.04" */
check("distributable NII per share 1.04", v(main.distributableNii) === 1.04);
check("internally managed, from 'to operate as an internally managed business development company'", v(main.internallyManaged) === true);
check("an internally managed filer gets no fee rates, whatever fee sentences its document carries",
  main.fees.managementFeeRate === null && main.fees.incentiveIncomeRate === null && main.fees.hurdle === null && main.fees.capitalGainsRate === null);
/* Item 3: "61% of our Investment Portfolio debt investments (at cost) bore interest at floating rates" */
check("floating share 61, of debt investments at cost", v(main.floatingShare) === 61 && main.floatingShare.basis.of === "debt" && main.floatingShare.basis.at === "cost");
/* Item 3: "(100) | (23,034) | 2,410 | (617) | (21,241) | (0.23)" under "Basis Point Change" with five money columns */
const mDown = main.rateSensitivity && main.rateSensitivity.find((r) => r.shock === "-100 bps");
const mUp = main.rateSensitivity && main.rateSensitivity.find((r) => r.shock === "+100 bps");
check("Item 3 table with bare (100)/100 shock labels: sixteen rows", Boolean(main.rateSensitivity) && main.rateSensitivity.length === 16);
check("-100 bps: interest income (23,034), interest expense 2,410, net investment income (21,241), (0.23) per share, in thousands",
  mDown && mDown.interestIncome === -23034000 && mDown.interestExpense === 2410000 && mDown.net === -21241000 && mDown.perShare === -0.23 && mDown.scale === "thousands");
check("+100 bps: 22,257 / (2,410) / 20,594 / 0.22", mUp && mUp.interestIncome === 22257000 && mUp.interestExpense === -2410000 && mUp.net === 20594000 && mUp.perShare === 0.22);
check("the External Investment Manager column is not taken for the net", mUp && JSON.stringify(mUp.columns) === JSON.stringify(["interestIncome", "interestExpense", "other", "net", "perShare"]));
check("a segment's count (Middle Market, 11 companies) is not the portfolio's", main.portfolioCompanies === null);
check("no portfolio-wide yield, LTV or target leverage stated", main.waYieldAtCost === null && main.waYieldAtFv === null && main.ltv === null && main.targetLeverage === null);

/* ---------- ARCC ---------- */
console.log("ARCC 10-Q 2026-06-30, accession 0001628280-26-050307");
const arcc = extractProse(read("arcc-10q-2026-06-30.txt"), { ticker: "ARCC", period: "2026-06-30" });
/* Note 4: "loans on non-accrual status represented 2.4 % of the total investments at amortized cost (or 1.4 % at fair value) and 1.8 % ... and 1.2 % ..., respectively" */
check("non-accrual 2.4 at cost / 1.4 at fair value, the period's pair not December's", v(arcc.nonAccrualCostPct) === 2.4 && v(arcc.nonAccrualFvPct) === 1.4);
/* Item 2: "Weighted average yield on portfolio | 9.5 % | 10.1 % | 9.5 % | 10.1 %" with "(1) Includes non-interest earning investments." */
check("weighted-average yield 9.5 from the results table", v(arcc.waYieldAtCost) === 9.5, arcc.waYieldAtCost && arcc.waYieldAtCost.sentence);
check("the table's intro sentence travels with it: at amortized cost, for the three and six months", Boolean(arcc.waYieldAtCost.intro) && /at amortized cost for the three and six months ended June 30, 2026/.test(arcc.waYieldAtCost.intro));
check("the as-of yield table is read whole: debt and other income producing 10.3 / 10.5, total portfolio 9.3 / 9.4",
  arcc.waYields.some((y) => /^Debt and other income producing/.test(y.label) && y.cost === 10.3 && y.fv === 10.5) &&
  arcc.waYields.some((y) => /^Total portfolio/.test(y.label) && y.cost === 9.3 && y.fv === 9.4));
check("Ivy Hill's 17.9% row is in the table and is not the portfolio yield", arcc.waYields.some((y) => /Ivy Hill/.test(y.label) && y.cost === 17.9) && v(arcc.waYieldAtCost) !== 17.9);
/* Note 6: "the Company's asset coverage was 186 %" */
check("asset coverage 186% -> 1.86", v(arcc.assetCoveragePct) === 1.86 && arcc.assetCoveragePct.sbaRelief === false);
check("statutory floor 150 from the 2019 reduction", v(arcc.statutoryCoverage) === 150);
/* Item 3: "Up 100 basis points | $ 212 | $ 118 | $ 94" in millions */
const aUp = arcc.rateSensitivity && arcc.rateSensitivity.find((r) => r.shock === "+100 bps");
const aDown = arcc.rateSensitivity && arcc.rateSensitivity.find((r) => r.shock === "-100 bps");
check("Item 3 in millions: +100 bps 212 / 118 / 94", aUp && aUp.interestIncome === 212000000 && aUp.interestExpense === 118000000 && aUp.net === 94000000 && aUp.scale === "millions");
check("-100 bps (211) / (118) / (93): a parenthesized (93) after $ is a figure, not a footnote", aDown && aDown.interestIncome === -211000000 && aDown.interestExpense === -118000000 && aDown.net === -93000000);
/* Item 3: "71% of the investments at fair value in our portfolio bore interest and dividends at variable rates" */
check("floating share 71, of the total portfolio at fair value", v(arcc.floatingShare) === 71 && arcc.floatingShare.basis.of === "total" && arcc.floatingShare.basis.at === "fv");
check("the 'new investment commitments at floating rates' row (94%) is not taken for it", v(arcc.floatingShare) !== 94);
/* Item 2: "Funded during the period at amortized cost | 9.4 %" and "Exited or repaid during the period at amortized cost | 9.1 %" under the yield group header */
check("yield on new 9.4 and on exits 9.1 from the grouped rows", v(arcc.yieldOnNew) === 9.4 && v(arcc.yieldOnExits) === 9.1);
/* Note 3 */
check("base management fee 1.5% up to 1.0x debt to equity and 1.0% over it", v(arcc.fees.managementFeeRate) === 1.5 && arcc.fees.managementFeeTier && arcc.fees.managementFeeTier.v === 1 && arcc.fees.managementFeeTier.above === 1);
check("income fee 20%, hurdle 1.75% quarterly (7% annualized), catch-up 100%, capital gains 20%",
  v(arcc.fees.incentiveIncomeRate) === 20 && v(arcc.fees.hurdle) === 1.75 && arcc.fees.hurdleAnnual === 7 && v(arcc.fees.catchUp) === 100 && v(arcc.fees.capitalGainsRate) === 20);
check("externally managed by Ares Capital Management", v(arcc.internallyManaged) === false);
check("no core EPS in the 10-Q (it is in the 8-K exhibit): null, not a number", arcc.coreNiiPerShare === null && arcc.distributableNii === null);
check("no portfolio-company count stated in these pages", arcc.portfolioCompanies === null);

/* ---------- OBDC ---------- */
console.log("OBDC 10-Q 2026-06-30, accession 0001655888-26-000056");
const obdc = extractProse(read("obdc-10q-2026-06-30.txt"), { ticker: "OBDC", period: "2026-06-30" });
/* Item 2: "Our current target leverage ratio is 0.90x-1.25x." */
check("target leverage 0.90x to 1.25x", obdc.targetLeverage && obdc.targetLeverage.low === 0.9 && obdc.targetLeverage.high === 1.25 && /0.90x-1.25x/.test(obdc.targetLeverage.sentence));

/* ---------- a document without the sentences ---------- */
console.log("BXSL Item 4 cut: nothing to find");
const none = extractProse(read("bxsl-10q-2026-06-30-unrelated.txt"), { ticker: "BXSL", period: "2026-06-30" });
const FIELDS = ["assetCoveragePct", "statutoryCoverage", "sbaExempt", "waYieldAtCost", "waYieldAtFv", "ltv", "floatingShare",
  "portfolioCompanies", "nonAccrualCostPct", "nonAccrualFvPct", "rateSensitivity", "dividendSplit", "targetLeverage",
  "internallyManaged", "distributableNii", "coreNiiPerShare", "yieldOnNew", "yieldOnExits"];
for (const k of FIELDS) check(`${k} is null on a document without the sentence`, none[k] === null, none[k] === null ? undefined : JSON.stringify(none[k]).slice(0, 160));
check("no fee rate on a document without the fee schedule", Object.values(none.fees).every((x) => x === null) && none.feeSentences.length === 0 && none.waYields.length === 0);

/* ---------- HTML input takes the same path ---------- */
console.log("HTML input");
const html = "<html><body><div><p>As of June 30, 2026, our BDC asset coverage ratio was 244%.</p><table><tr><td>Basis Point Change</td><td>Interest Income</td><td>Interest Expense</td><td>Net Investment Income</td></tr>" +
  "<tr><td>(dollars in thousands)</td></tr><tr><td>Up 100 basis points</td><td>$</td><td>1,000</td><td/><td>$</td><td>(400)</td><td>$</td><td>600</td></tr><tr><td>Down 100 basis points</td><td>(1,000)</td><td>400</td><td>(600)</td></tr></table></div></body></html>";
const h = extractProse(html, { ticker: "X", period: "2026-06-30" });
check("HTML: the coverage sentence and the table read the same as text", v(h.assetCoveragePct) === 2.44 && h.rateSensitivity && h.rateSensitivity.length === 2 && h.rateSensitivity[0].interestIncome === 1000000 && h.rateSensitivity[0].interestExpense === -400000 && h.rateSensitivity[0].net === 600000);

console.log(failed ? `\n${failed} check(s) failed` : "\nall prose checks passed");
process.exit(failed ? 1 : 0);
