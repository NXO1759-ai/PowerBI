/**
 * test-pc-page.mjs — the Market view's ingested sections, offline.
 *
 * Four things, none needing a browser or the network:
 *
 *   1. lib/pc-series.js reads the committed data/pc files the way the
 *      page will: the index, every group, an alias, the sort, the
 *      three footer stamps as the contract spells them, the two
 *      files read on first use, and the formatters.
 *   2. RTCatalog.register appends entries, get() finds them, and a
 *      duplicate key throws with nothing from that batch added.
 *   3. credit.html carries the three section containers in order after
 *      M2, the note control, and the script and stylesheet tags for the
 *      loader and the three section files; api/fsa-note.js carries the
 *      four prompts, the two credit ones signed "the research model",
 *      and answers 503 for kind "credit" without a key.
 *   4. Every section file on disk (credit-stress.js, credit-capital.js,
 *      credit-dealflow.js) is evaluated with the window stub below; its
 *      registration has the contract's shape and every CAPTIONS sample()
 *      measures under 240 characters with no source stamp in it. A file
 *      not on disk yet is skipped and said so — its owner's PR brings
 *      it, and test-nav.mjs fails until then because credit.html
 *      references it.
 *
 * The window stub (what a section file may touch at evaluation time):
 *   window.RTCreditSections   the registry array, empty
 *   window.RTPcSeries         the real loader, its reader pointed at the
 *                             filesystem and every group loaded, so a
 *                             sample() may format a real point
 *   window.RTCatalog          the real catalog, so register() works
 *   window.RTTerms            null (no hover terms in Node)
 *   window.RTHttp             the real http module
 *   window.Chart              undefined (no canvas in Node)
 *   self === window; document is undefined — a section file must not
 *   touch the DOM until mount() is called.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRONT = join(ROOT, "frontend");
let failed = 0;
const check = (n, ok, d) => { console.log((ok ? "  ok   " : "  FAIL ") + n + (d ? "  " + d : "")); if (!ok) failed++; };
const skip = (n, d) => console.log("  skip " + n + (d ? "  " + d : ""));
const readJson = (rel) => JSON.parse(readFileSync(join(FRONT, rel), "utf8"));

/* ---------- 1. the loader against the committed files ---------- */
console.log("lib/pc-series.js");
const S = require(join(FRONT, "lib", "pc-series.js"));
S.reader = (path) => new Promise((res, rej) => {
  try { res(readJson(path)); } catch (e) { rej(e); }
});
const idx = readJson("data/pc/series-index.json");
const groupNames = Object.keys(idx.groups);
await S.load(groupNames);
check("load() reads the index and every group (" + groupNames.length + ")", groupNames.every((g) => S.loaded(g)), groupNames.join(", "));
check("groups() lists the index's groups", JSON.stringify(S.groups()) === JSON.stringify(groupNames));
await S.load(["pb-capital"]);
check("a second load of a loaded group is a no-op", S.loaded("pb-capital"));
await S.load(["no-such-group"]).then(() => check("an unknown group rejects", false),
  (e) => check("an unknown group rejects with its name", /no-such-group/.test(e.message), e.message));

const allKeys = Object.keys(idx.series);
const missing = allKeys.filter((k) => !S.has(k));
check("every key in the index resolves through get() (" + allKeys.length + ")", missing.length === 0, missing.slice(0, 5).join(", "));
const aliasKeys = allKeys.filter((k) => idx.series[k].alias);
check("the index carries alias keys to test", aliasKeys.length > 0, String(aliasKeys.length));
for (const a of aliasKeys) {
  const e = S.get(a);
  check("alias " + a + " resolves to " + idx.series[a].alias + " with its points",
    !!e && e.key === idx.series[a].alias && e.alias === a && Array.isArray(e.points) && e.points.length > 0,
    e ? e.key + " / " + e.points.length + " points" : "null");
}
check("get() of an unknown key is null", S.get("lcd_nothing_here") === null);
check("get() of a canonical key carries no alias field", S.get("lcd_dl_volume_quarterly").alias === undefined);

/* pointsOf: sorted, x/y, grains */
const vol = S.pointsOf("lcd_dl_volume_quarterly");
check("pointsOf returns x/y pairs sorted by x", vol.length > 10 && vol.every((p, i) => !i || p.x >= vol[i - 1].x) && vol.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.x) && typeof p.y === "number"), vol.length + " points");
const rolling = vol.filter((p) => S.isRolling(p));
check("the rolling three-month point is the last and isRolling() knows it", rolling.length === 1 && vol[vol.length - 1].g === "rolling3m", rolling.map((p) => p.x).join(","));
const quarters = S.pointsOf("lcd_dl_volume_quarterly", { grain: "quarter" });
check("a grain filter leaves the rolling point out", quarters.length === vol.length - 1 && quarters.every((p) => p.g === "quarter"));
const lq = S.latest("lcd_dl_volume_quarterly", { grain: "quarter" }), lr = S.latest("lcd_dl_volume_quarterly");
check("latest() answers the newest point; with a grain, the newest of that grain", lr && lr.g === "rolling3m" && lq && lq.g === "quarter" && lq.x < lr.x, (lq && lq.x) + " / " + (lr && lr.x));
const pq = S.prior("lcd_dl_volume_quarterly", { grain: "quarter" });
check("prior() is the quarter before the latest quarter", pq && pq.x < lq.x && pq.g === "quarter", pq && pq.x);
const labelPts = S.pointsOf("kbra_dld_ttm_default_rate", { withLabels: true });
check("a press point with no calendar date is kept only with withLabels, and last", labelPts.length > S.pointsOf("kbra_dld_ttm_default_rate").length && labelPts[labelPts.length - 1].x === null);
const snap = S.snapshot("lcd_bdc_spread_dist_count_2q26");
check("snapshot() returns the buckets of the newest date", !!snap && snap.items.length === 10 && Math.abs(snap.items.reduce((a, i) => a + i.v, 0) - 1) < 0.02, snap && snap.items.map((i) => i.c).join("|"));
const cap = S.pointsOf("pb_pd_fundraising_capital_q2_2026ed");
check("the fundraising report series ends on a year-to-date point after the years", cap.length === 11 && cap[cap.length - 1].g === "ytd" && cap.slice(0, -1).every((p) => p.g === "year"));
check("isWindow() marks ytd, rolling and window grains", S.isWindow(cap[cap.length - 1]) && S.isWindow(lr) && !S.isWindow(lq));

/* the stamps, as the contract spells them */
check("stamp(lcd-monitor)", S.stamp("lcd-monitor") === "LCD monitor, August 2026 edition, through Aug 31 2026 · next expected early October", S.stamp("lcd-monitor"));
check("stamp(pb-fund-overview)", S.stamp("pb-fund-overview") === "PitchBook Fund Overview export of Sep 10 2026", S.stamp("pb-fund-overview"));
check("stamp(pb-fundraising-report)", S.stamp("pb-fundraising-report") === "PitchBook Q2 2026 fundraising report", S.stamp("pb-fundraising-report"));
check("stamp() of every source in the index is a sentence", Object.keys(idx.sources).every((id) => S.stamp(id).length > 10), Object.keys(idx.sources).join(", "));
check("stamp() of an unknown source is empty", S.stamp("nope") === "");
check("stampOf(key) follows the key's source", S.stampOf("lcd_dl_volume_quarterly") === S.stamp("lcd-monitor") && S.stampOf("pb_pd_fundraising_capital_q2_2026ed") === S.stamp("pb-fundraising-report"));
check("stampOf(derived key) joins its inputs' stamps", S.stampOf("derived_dl_years_of_dry_powder").indexOf(S.stamp("lcd-monitor")) >= 0, S.stampOf("derived_dl_years_of_dry_powder"));

/* the two files read on first use */
const rs = await S.restatementsOf("lcd_dl_count_quarterly");
check("restatementsOf() answers an array (empty on the first vintage)", Array.isArray(rs), JSON.stringify(rs).slice(0, 80));
const restFile = readJson("data/pc/restatements.json");
check("restatements.json's count matches its rows", restFile.count === restFile.restatements.length, String(restFile.count));
const pv = await S.provenance("lcd_dl_volume_quarterly");
check("provenance() answers the key's locator", !!pv && !!pv.locator && pv.locator.chart === "chart1", JSON.stringify(pv && pv.locator));
const pva = await S.provenance("lcd_dl_lbo_count_quarterly_c16");
check("provenance() of an alias answers the canonical key's entry", !!pva && !!pva.locator);
const tbl = await S.table("pb_recent_mandates_list");
check("table() reads a list sheet's rows", !!tbl && Array.isArray(tbl.editions) && tbl.editions.length > 0);
check("table() of a series key is null", (await S.table("lcd_dl_volume_quarterly")) === null);

/* the formatters */
const F = S.fmt;
const fmtCases = [
  [F.B(275.2), "$275.2B"], [F.B(-103.7), "−$103.7B"], [F.B(1348, 1), "$1,348.0B"], [F.M(1799), "$1,799M"],
  [F.bps(502.17), "502 bps"], [F.pctToBps(5.02), "502 bps"], [F.share(0.364), "36.4%"], [F.pct(8.3), "8.3%"],
  [F.signed(14.0, 1, "%"), "+14.0%"], [F.signed(-27.4, 1, "%"), "−27.4%"], [F.change(0.14), "+14.0%"],
  [F.count(1399), "1,399"], [F.x(2.14, 2), "2.14×"], [F.years(0.6778), "0.68"], [F.ordinal(2), "2nd"],
  [F.date("2026-08-31"), "Aug 31, 2026"], [F.dateStamp("2026-08-31"), "Aug 31 2026"], [F.monthLabel("2026-08-31"), "Aug 2026"],
  [F.quarter("2026-06-30"), "Q2 2026"], [F.quarterDeck("2026-06-30"), "2Q26"], [F.half("2026-06-30"), "H1 2026"],
  [F.edition("2026Q2"), "Q2 2026"], [F.edition("2026-08"), "August 2026"],
  [F.period({ p: "2026-08-31", g: "rolling3m", start: "2026-06-01" }), "Jun–Aug 2026"],
  [F.period({ p: "2026-06-30", g: "ytd", start: "2026-01-01" }), "2026 YTD to Jun 30, 2026"],
  [F.period({ p: "2025-12-31", g: "year" }), "2025"], [F.period({ p: "2026-08-31", g: "rolling12m" }), "TTM to Aug 31, 2026"],
  [F.period({ p: null, g: "label", label: "TTM to mid-June 2026" }), "TTM to mid-June 2026"],
  [F.byUnit(0.364, "share"), "36.4%"], [F.byUnit(250.2, "$B"), "$250.2B"], [F.byUnit(0.678, "years"), "0.68 years"], [F.byUnit(2, "rank"), "2nd"],
  [F.byUnit(null, "$B"), "—"], [F.pct(undefined), "—"]
];
for (const [got, want] of fmtCases) check("fmt " + JSON.stringify(want), got === want, "got " + JSON.stringify(got));

/* ---------- 2. RTCatalog.register ---------- */
console.log("RTCatalog.register");
const C = require(join(FRONT, "lib", "metric-catalog.js"));
check("register is a function", typeof C.register === "function");
const before = Object.keys(C.METRICS).length;
const n = C.register([{ key: "__t_one", label: "One", formula: "a ÷ b", watch: "w", definition: "d", interpretation: "i" }, { key: "__t_two", label: "Two", formula: "c", definition: "d", interpretation: "i" }]);
check("register appends and returns the count", n === 2 && Object.keys(C.METRICS).length === before + 2);
check("get() finds a registered entry with the credit-group defaults", C.get("__t_one").group === "credit" && C.get("__t_one").format === "chart" && C.get("__t_one").formula === "a ÷ b");
check("byGroup('credit') lists it", C.byGroup("credit").some((m) => m.key === "__t_two"));
let threw = null;
try { C.register([{ key: "__t_three", label: "Three" }, { key: "__t_one", label: "Dup" }]); } catch (e) { threw = e; }
check("a duplicate key throws", !!threw && /already registered: __t_one/.test(threw.message), threw && threw.message);
check("nothing from the batch with the duplicate was added", !C.get("__t_three"));
try { C.register([{ key: "hyOas" }]); threw = null; } catch (e) { threw = e; }
check("a built-in key cannot be re-registered", !!threw);
try { C.register("nope"); threw = null; } catch (e) { threw = e; }
check("a non-array throws", !!threw);

/* ---------- 3. the page and the note endpoint ---------- */
console.log("credit.html and api/fsa-note.js");
const html = readFileSync(join(FRONT, "credit.html"), "utf8");
const at = (re) => { const m = html.match(re); return m ? m.index : -1; };
const iM2 = at(/id="m2-canvas"/), iS = at(/id="sec-stress"/), iC = at(/id="sec-capital"/), iD = at(/id="sec-dealflow"/), iN = at(/id="sec-credit-note"/), iX = at(/class="export-tables"/);
check("the three containers sit after M2 in the order stress, capital, dealflow, then the note", iM2 > 0 && iS > iM2 && iC > iS && iD > iC && iN > iD && iX > iN, [iM2, iS, iC, iD, iN, iX].join(" < "));
check("the containers are inside the Market view", at(/id="market-view"/) < iS && iX < at(/id="lenders-view"/));
check("the note control is a button that posts on request", /id="credit-note-btn"/.test(html) && /id="analyst-note-body"/.test(html) && /id="credit-note-facts"/.test(html));
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const want = ["lib/metric-catalog.js", "lib/credit-terms.js", "vendor/chart.umd.min.js", "lib/pc-series.js", "credit.js", "credit-stress.js", "credit-capital.js", "credit-dealflow.js"];
const order = want.map((w) => scripts.indexOf(w));
check("the scripts load in order: catalog, terms, Chart.js, the loader, credit.js, then the three sections", order.every((i, k) => i >= 0 && (!k || i > order[k - 1])), scripts.join(" "));
const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
check("each section's stylesheet is linked after credit.css", ["credit-stress.css", "credit-capital.css", "credit-dealflow.css"].every((c) => links.indexOf(c) > links.indexOf("credit.css")), links.join(" "));
check("the footer carries the ingested-series stamp slot", /id="src-footer-pc"/.test(html));

/* credit.js in Node: the caption hook and the formatters ride along */
const creditSrc = readFileSync(join(FRONT, "credit.js"), "utf8");
const mod = {}; new Function("module", creditSrc)(mod);
check("credit.js hands CAPTIONS and fmt to a non-browser caller", !!mod.exports && typeof mod.exports.CAPTIONS.sample === "function" && typeof mod.exports.fmt.fmtBps === "function");
check("credit.js mounts the sections in the blueprint's order", /SECTION_ORDER = \["stress", "capital", "dealflow"\]/.test(creditSrc));
check("credit.js posts the note as kind credit for PCMARKET", /kind: "credit", ticker: "PCMARKET"/.test(creditSrc));
check("credit.js reads the composite and treats a 404 as absent", /data\/bdc\/composite\.json/.test(creditSrc) && /r\.status === 404\) return null/.test(creditSrc));

/* the composite view: the holdings refresh writes composite.json as
   { creditVersion, n, asOf, totals, weighted {...}, histogram { byCount,
   byCost } } with fractions; credit.js turns it into the one view every
   section reads, and older or richer shapes fold into the same view */
const NC = mod.exports.normalizeComposite;
check("credit.js hands normalizeComposite to a non-browser caller", typeof NC === "function");
const contractFile = { creditVersion: "1.0.0", n: 44, asOf: "2026-06-30", totals: { cost: 157.2, fv: 152.3 },
  weighted: { nonAccrualCost: 0.029, nonAccrualFv: 0.016, pikShareOfInterest: 0.083, pikShareOfTotal: 0.109, fvOverCost: 0.969 },
  histogram: { byCount: [{ label: "under 300", share: 0.02 }, { label: "450 - 499", share: 0.28 }, { label: "500-549", share: 0.23 }, { label: "700 or higher", share: 0.05 }],
               byCost: [{ label: "450-499", share: 0.30 }] } };
const view = NC(contractFile);
check("the holdings contract file becomes a view with one dated row from the weighted block",
  !!view && view.creditVersion === "1.0.0" && view.n === 44 && view.asOf === "2026-06-30" && view.quarters.length === 1 && view.latest === view.quarters[0] && view.latest.p === "2026-06-30" && view.latest.n === 44,
  view && JSON.stringify(view.latest));
check("the weighted fields carry their contract names as fractions", view.latest.nonAccrualCost === 0.029 && view.latest.nonAccrualFv === 0.016 && view.latest.pikShareOfInterest === 0.083 && view.latest.pikShareOfTotal === 0.109 && view.latest.fvOverCost === 0.969);
check("totals ride along", view.totals.cost === 157.2 && view.totals.fv === 152.3);
check("the histogram keeps both weightings with labels in LCD's form", !!view.histogram && view.histogram.p === "2026-06-30" && view.histogram.n === 44 &&
  view.histogram.byCount.map((b) => b.label).join("|") === "under 300|450-499|500-549|700 or higher" && view.histogram.byCount[1].share === 0.28 && view.histogram.byCost[0].share === 0.30,
  view.histogram && JSON.stringify(view.histogram.byCount));
check("a field the file does not carry is absent from the view, never zero", view.latest.allInYield === undefined && view.maturityWall === null && view.sectors === null);
const counted = NC({ n: 3, asOf: "2026-06-30", histogram: { byCount: [{ label: "450-499", count: 280 }, { label: "500-549", count: 720 }] } });
check("a histogram written as counts is read as shares by division", !!counted.histogram && Math.abs(counted.histogram.byCount[0].share - 0.28) < 1e-9 && Math.abs(counted.histogram.byCount[1].share - 0.72) < 1e-9, JSON.stringify(counted.histogram && counted.histogram.byCount));
const mapped = NC({ n: 3, asOf: "2026-06-30", histogram: { byCount: { "450-499": 0.6, "500-549": 0.4 } } });
check("a histogram written as an object map is read too", !!mapped.histogram && mapped.histogram.byCount.length === 2 && mapped.histogram.byCount[0].label === "450-499" && mapped.histogram.byCount[0].share === 0.6);
const aliased = NC({ n: 3, asOf: "2026-06-30", weighted: { mark: 0.97, pikShareOfIncome: 0.1, nonAccrualRate: 0.02 } });
check("an earlier draft's names (mark, pikShareOfIncome, nonAccrualRate) fold into the contract names", aliased.latest.fvOverCost === 0.97 && aliased.latest.pikShareOfTotal === 0.1 && aliased.latest.nonAccrualCost === 0.02 && aliased.latest.mark === undefined);
const history = NC({ n: 44, quarters: [{ p: "2026-06-30", n: 44, fvOverCost: 0.969, allInYield: 0.096, baseRate: 0.041, spreadOverBase: 0.055 }, { p: "2026-03-31", n: 43, fvOverCost: 0.972 }],
  maturityWall: [{ label: "2026", cost: 10 }, { label: "2031-2033", cost: 30 }], sectors: [{ label: "Software", share: 0.18 }, { label: "Health Care", share: 0.12 }] });
check("a quarters[] history sorts by date, the latest is the newest, asOf follows it", history.quarters.length === 2 && history.quarters[0].p === "2026-03-31" && history.latest.p === "2026-06-30" && history.latest.allInYield === 0.096 && history.asOf === "2026-06-30");
check("a maturity wall written as cost only gets its share by division", !!history.maturityWall && history.maturityWall[1].label === "2031-2033" && Math.abs(history.maturityWall[1].share - 0.75) < 1e-9);
check("the sector mix rides along as label and share", !!history.sectors && history.sectors[0].label === "Software" && history.sectors[0].share === 0.18);
const undated = NC({ n: 5, weighted: { fvOverCost: 0.95 } });
check("an undated weighted block is kept as a row with no date rather than dropped", undated.quarters.length === 1 && undated.latest.p === null && undated.latest.fvOverCost === 0.95 && undated.asOf === null);
check("nothing to read is null, an empty object is a view with nothing in it", NC(null) === null && NC(undefined) === null && NC({}).latest === null && NC({}).histogram === null && NC({}).quarters.length === 0);
/* the two sections that draw the composite read the view's names, not the file's */
const stressSrc = existsSync(join(FRONT, "credit-stress.js")) ? readFileSync(join(FRONT, "credit-stress.js"), "utf8") : "";
const dealflowSrc = existsSync(join(FRONT, "credit-dealflow.js")) ? readFileSync(join(FRONT, "credit-dealflow.js"), "utf8") : "";
if (stressSrc) check("credit-stress.js reads the view: histogram.byCount, fvOverCost, pikShareOfTotal, never spreadHistogram or mark",
  /comp\.histogram/.test(stressSrc) && /compSeries\(comp, "fvOverCost"\)/.test(stressSrc) && /compSeries\(comp, "pikShareOfTotal"\)/.test(stressSrc) && !/spreadHistogram|compSeries\(comp, "mark"\)|pikShareOfIncome"/.test(stressSrc));
if (dealflowSrc) check("credit-dealflow.js reads the view: histogram.byCount, latest.allInYield, maturityWall, sectors, never spreadBuckets or allInYieldN",
  /c\.histogram/.test(dealflowSrc) && /c\.latest\.allInYield/.test(dealflowSrc) && /c\.maturityWall/.test(dealflowSrc) && /c\.sectors/.test(dealflowSrc) && !/spreadBuckets|allInYieldN/.test(dealflowSrc));
check("no vendor or model name in the page, the loader or the html", !/deepseek|openai|anthropic|claude/i.test(creditSrc + html + readFileSync(join(FRONT, "lib", "pc-series.js"), "utf8")));

/* the note endpoint: the four prompts, the signature, the 503 without a key */
const noteMod = await import(pathToFileURL(join(ROOT, "api", "fsa-note.js")).href);
const P = noteMod.PROMPTS;
check("fsa-note exports the prompt map with statements, strategy, credit and bdc", !!P && ["statements", "strategy", "credit", "bdc"].every((k) => typeof P[k] === "string" && P[k].length > 200));
check("the credit and bdc prompts are signed by the research model", /the research model/.test(P.credit) && /the research model/.test(P.bdc));
check("the credit prompt reads direction, not level, where LCD meets the composite", /direction, not level/.test(P.credit));
check("the credit prompt names the committee voice and page facts only", /credit committee|private credit committee/.test(P.credit) && /ONLY the figures provided/.test(P.credit));
check("the statements and strategy prompts are not signed (unchanged behavior)", !/the research model/.test(P.statements) && !/the research model/.test(P.strategy));
check("no vendor or model name in any prompt", !Object.values(P).some((p) => /deepseek|openai|anthropic|claude|gpt|gemini/i.test(p)));
const savedKey = process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY;
{
  const res = { headers: {}, code: null, body: null, setHeader(k, v) { res.headers[k] = v; }, status(c) { res.code = c; return res; }, json(b) { res.body = b; return res; }, end() { return res; } };
  await noteMod.default({ method: "POST", headers: {}, body: { kind: "credit", ticker: "PCMARKET", periodLabel: "test", facts: ["a", "b", "c"] } }, res);
  check("kind credit without a key answers 503 not configured", res.code === 503 && res.body && /not configured/.test(res.body.error), res.code + " " + JSON.stringify(res.body));
}
/* with a key and the model call mocked: the credit kind is prompted in the
   committee voice, the reply is signed even when the model forgot, and
   the cache key separates kinds */
{
  process.env.DEEPSEEK_API_KEY = "test-key-never-sent";
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const note = ["First paragraph of a long enough note about where the cycle sits, written from the facts posted and nothing else, in the committee's voice, for the test.",
      "Second paragraph on capital against deals, again long enough to pass the length floor the endpoint applies before it accepts a note.",
      "Third paragraph, the tests."].join("\n\n");
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ note }) } }] }) };
  };
  const mk = () => { const r = { headers: {}, code: null, body: null, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end() { return r; } }; return r; };
  const facts = ["High-yield OAS: 270 bps (FRED 2026-09-10)", "SOFR: 3.62% (FRED 2026-09-10)", "Private debt capital raised: $158.3B (2026 YTD)"];
  const r1 = mk();
  await noteMod.default({ method: "POST", headers: {}, body: { kind: "credit", ticker: "PCMARKET", periodLabel: "Market view as of Sep 10, 2026", facts } }, r1);
  check("kind credit with a mocked model answers 200 with a note", r1.code === 200 && r1.body && typeof r1.body.note === "string", r1.code + " " + JSON.stringify(r1.body).slice(0, 80));
  check("the credit note ends on the signature line even when the model left it off", !!r1.body && r1.body.note.endsWith("— the research model"), r1.body && r1.body.note.slice(-40));
  const sent = calls[0] || {};
  const sys = sent.messages && sent.messages[0].content, usr = sent.messages && sent.messages[1].content;
  check("the model was prompted with the credit kind's system prompt", sys === P.credit);
  check("the user turn names the dashboard, the period and every fact", /^Dashboard: PCMARKET\. Period: Market view as of Sep 10, 2026\./.test(usr) && facts.every((f) => usr.includes(f)), usr && usr.slice(0, 80));
  const r2 = mk();
  await noteMod.default({ method: "POST", headers: {}, body: { kind: "bdc", ticker: "ARCC", periodLabel: "Q2 2026", facts } }, r2);
  check("kind bdc is prompted in its own voice and signed", calls.length === 2 && calls[1].messages[0].content === P.bdc && r2.body.note.endsWith("— the research model"));
  const r3 = mk();
  await noteMod.default({ method: "POST", headers: {}, body: { kind: "credit", ticker: "PCMARKET", periodLabel: "Market view as of Sep 10, 2026", facts } }, r3);
  check("a second credit call for the same period is served from the cache (no model call)", calls.length === 2 && r3.code === 200 && /s-maxage/.test(String(r3.headers["Cache-Control"])));
  const r4 = mk();
  await noteMod.default({ method: "POST", headers: {}, body: { kind: "statements", ticker: "PCMARKET", periodLabel: "Market view as of Sep 10, 2026", facts } }, r4);
  check("the cache key carries the kind: statements for the same ticker and period reaches the model", calls.length === 3 && calls[2].messages[0].content === P.statements);
  check("the statements note is not signed (unchanged behavior)", !!r4.body && !/the research model/.test(r4.body.note));
  const r5 = mk();
  await noteMod.default({ method: "POST", headers: {}, body: { kind: "no-such-kind", ticker: "X", periodLabel: "p", facts } }, r5);
  check("an unknown kind falls back to statements", calls.length === 4 && calls[3].messages[0].content === P.statements);
  globalThis.fetch = realFetch;
  delete process.env.DEEPSEEK_API_KEY;
}
if (savedKey !== undefined) process.env.DEEPSEEK_API_KEY = savedKey;

/* ---------- 4. the section files, with the window stub ---------- */
console.log("section files");
const H = require(join(FRONT, "lib", "http.js"));
const knownGroups = new Set(groupNames);
for (const id of ["stress", "capital", "dealflow"]) {
  const file = join(FRONT, "credit-" + id + ".js");
  if (!existsSync(file)) { skip("credit-" + id + ".js is not on disk yet", "its owner's PR brings it; test-nav.mjs fails until then"); continue; }
  const src = readFileSync(file, "utf8");
  let parsed = true;
  try { new Function(src); } catch (e) { parsed = false; check("credit-" + id + ".js parses", false, e.message); }
  if (!parsed) continue;
  check("credit-" + id + ".js parses", true);
  const win = { RTCreditSections: [], RTPcSeries: S, RTCatalog: C, RTTerms: null, RTHttp: H, Chart: undefined };
  win.self = win; win.window = win;
  let evalErr = null;
  try { new Function("window", "self", "module", src)(win, win, undefined); } catch (e) { evalErr = e; }
  check("credit-" + id + ".js evaluates against the window stub", !evalErr, evalErr && evalErr.message);
  if (evalErr) continue;
  const regs = win.RTCreditSections.filter((s) => s && s.id === id);
  check("credit-" + id + ".js registers exactly one section with id " + id, regs.length === 1, win.RTCreditSections.map((s) => s && s.id).join(","));
  if (!regs.length) continue;
  const s = regs[0];
  check(id + ": groups name known series groups", Array.isArray(s.groups) && s.groups.length > 0 && s.groups.every((g) => knownGroups.has(g)), JSON.stringify(s.groups));
  check(id + ": mount is a function", typeof s.mount === "function");
  const caps = s.CAPTIONS || {};
  const names = Object.keys(caps).filter((k) => caps[k] && typeof caps[k].sample === "function");
  check(id + ": CAPTIONS carries at least one template with sample()", names.length > 0, names.join(","));
  for (const name of names) {
    let text = null, err = null;
    try { text = caps[name].sample(); } catch (e) { err = e; }
    check(id + " caption " + name + " sample() returns a string", typeof text === "string" && !err, err ? err.message : "");
    if (typeof text !== "string") continue;
    check(id + " caption " + name + " measures under 240 characters", text.length < 240, text.length + " chars");
    check(id + " caption " + name + " carries no source stamp (that lives in the footer)", !/Source:|edition, through|export of/.test(text));
    check(id + " caption " + name + " has a template function", typeof caps[name].template === "function");
  }
  if (typeof s.facts === "function") check(id + ": facts() is a function (optional, honored by the note control)", true);
  /* the keys a section names date the note and print as series-id
     popups; every one must be in the index, and the list must be free of
     repeats once aliases resolve — RTCatalog.register takes a batch all
     or nothing, so one repeat would silently drop every series-id popup
     of the section (the fault the integrator found on the dealflow file) */
  if (Array.isArray(s.keys)) {
    const unknown = s.keys.filter((k) => !S.has(k));
    check(id + ": every key it names is in the index (" + s.keys.length + ")", unknown.length === 0, unknown.slice(0, 5).join(", "));
    const canon = s.keys.map((k) => S.canonical(k) || k);
    const repeats = [...new Set(canon.filter((c, i) => canon.indexOf(c) !== i))];
    if (repeats.length) {
      const src = readFileSync(file, "utf8");
      check(id + ": aliases in its key list are folded before a catalog batch (" + repeats.length + " repeat after alias resolution)", /seen\[c\]|seen\[k\]/.test(src), repeats.slice(0, 3).join(", "));
    }
  }
}

console.log(failed ? "\n" + failed + " failed" : "\nall private credit page checks pass");
process.exit(failed ? 1 : 0);
