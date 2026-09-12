/**
 * test-bdc-holdings.mjs — the committed holdings and composite files,
 * offline.
 *
 * refresh-bdc.mjs writes holdings-<TICKER>.json and composite.json under
 * frontend/data/bdc/ from the SEC's monthly data set, the filing
 * instances, the 10-Q tables and the prose; this reads what was
 * committed and holds it to blueprint 10.3 (PR C) and contract H2/H3:
 * every holdings file carries a passed gate within 0.5% of the tagged
 * totals, every holding a cost, a fair value and its source, every
 * non-accrual row its flag, the maturity buckets add back to the
 * third-party debt cost they were cut from, the composite stamps
 * CREDIT_VERSION and states n on every figure, and no file leaks
 * "undefined" or "NaN". The four spot values of the acceptance list —
 * ARCC's 1,439 rows at $29,674.6M cost and $29,349.3M fair value, BXSL's
 * 313 portfolio companies and its 9.2% / 9.4% yield within 0.3 points,
 * GBDC's first-lien share including one stop about 92% of cost — are
 * pinned while the committed file is the Q2 2026 one (period
 * 2026-06-30); once the weekly refresh commits a later quarter the pins
 * stand down and the file is held to the shape, gate and range checks
 * instead, and the PR that lands that quarter re-pins its own verified
 * figures. The size rule is per file (1 MB) and 250 KB a file on the
 * total: blueprint 7.4's 60-150 KB a BDC predates keeping the member
 * text and the raw lien label on every row, which the audit trail needs.
 * Nothing here touches the network.
 *
 * Figures asserted and where they come from:
 *   ARCC 10-Q for 2026-06-30, accession 0001628280-26-050307: 1,439
 *     positions with both cost and fair value in the SEC's July 2026
 *     data set, Σ cost 29,674,600,000 and Σ FV 29,349,300,000, equal to
 *     the tagged InvestmentOwnedAtCost / AtFairValue (blueprint 7.3 and
 *     the data-set reader's run); non-accrual 2.4% at cost / 1.4% at FV
 *     (the 10-Q's Item 2 sentence; bdc-prose fixture).
 *   BXSL 10-Q for 2026-06-30, accession 0001736035-26-000016: Item 2
 *     portfolio table "Number of portfolio companies | 313", "Weighted
 *     average yield on performing debt ... at amortized cost 9.2%; at
 *     fair value 9.4%", "Percentage of performing debt investments
 *     bearing a floating rate 99.3%", "Percentage of assets on
 *     non-accrual, at amortized cost 3.6%; at fair value 1.8%"
 *     (verified-facts C; test-credit-ratios.mjs pins).
 *   GBDC 10-Q for 2026-06-30, accession 0001476765-26-000048: one stop
 *     $7,288.8M of $8,377.1M at cost = 87.0%, senior secured 4.7%, so
 *     first lien incl. one stop ≈ 92% of the portfolio at cost
 *     (blueprint 4.2, lien mix row); non-accrual 2.9% at cost / 1.9% at
 *     FV (blueprint 10.3); its non-controlled affiliated equity
 *     (Chestnut Optical Midco, Inc., LLC interest, $53.8M at cost in
 *     the printed schedule) carries no identifier member in the August
 *     2026 data set, so those rows come from the table.
 *   MAIN 10-Q for 2026-06-30, accession 0001396440-26-000094: "As of
 *     June 30, 2026, our BDC asset coverage ratio was 244%" with no
 *     asset-coverage tag → acSource "prose" (blueprint 10.3).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { expandHolding, HOLDING_KEYS } from "./lib/bdc-composite.mjs";

const require = createRequire(import.meta.url);
const C = require("../frontend/lib/credit.js");
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../frontend/data/bdc");

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const near = (a, b, tol) => isNum(a) && isNum(b) && Math.abs(a - b) <= tol;
const parse = (file) => { try { return JSON.parse(readFileSync(join(DIR, file), "utf8")); } catch { return null; } };

if (!existsSync(DIR)) {
  console.log(`  FAIL ${DIR} does not exist — run node scripts/refresh-bdc.mjs first`);
  process.exit(1);
}

const universe = parse("universe.json");
const tickers = new Set(((universe && universe.rows) || []).map((r) => r.ticker));
const files = readdirSync(DIR).filter((f) => /^holdings-[A-Z0-9.-]+\.json$/.test(f)).sort();
check("holdings files exist for at least half of the universe", files.length >= 0.5 * tickers.size, `${files.length} of ${tickers.size}`);

/* ---------- every holdings file ---------- */

const KINDS = new Set(["debt", "equity", "structured", "vehicle", "other"]);
const AFF = new Set(["non-controlled/non-affiliated", "non-controlled affiliated", "controlled"]);
const ROW_SOURCES = new Set(["dataset", "instance", "table"]);
const NA_SOURCES = new Set(["table", "rpage", "id"]);
let bytes = 0;
const problems = { gate: [], row: [], na: [], wall: [], strays: [], summary: [], leak: [], version: [], src: [], dup: [] };
const byTicker = new Map();
for (const f of files) {
  const text = readFileSync(join(DIR, f), "utf8");
  bytes += Buffer.byteLength(text);
  if (/undefined|NaN/.test(text)) problems.leak.push(f);
  const h = parse(f);
  if (!h) { problems.gate.push(`${f} unparseable`); continue; }
  /* rows are written with the short keys of blueprint 7.4 and the
     legend beside them; every check below reads the H1 shape */
  if (!h.keys || !h.keys.holding || Object.entries(HOLDING_KEYS).some(([k, v]) => h.keys.holding[k] !== v)) problems.gate.push(`${h.ticker}: no key legend`);
  h.holdings = (h.holdings || []).map(expandHolding);
  byTicker.set(h.ticker, h);
  if (!tickers.has(h.ticker) || f !== `holdings-${h.ticker}.json`) problems.strays.push(f);
  if (h.creditVersion !== C.CREDIT_VERSION) problems.version.push(`${h.ticker} ${h.creditVersion}`);
  const g = h.gate;
  if (!g || g.passed !== true || !isNum(g.cost.diffPct) || g.cost.diffPct > 0.005 || !isNum(g.fv.diffPct) || g.fv.diffPct > 0.005 ||
      !isNum(g.cost.sum) || !isNum(g.cost.tag) || !isNum(g.fv.sum) || !isNum(g.fv.tag) || g.rows !== h.holdings.length) {
    problems.gate.push(`${h.ticker} ${g ? JSON.stringify({ passed: g.passed, cost: g.cost.diffPct, fv: g.fv.diffPct, rows: g.rows, n: h.holdings.length }) : "no gate"}`);
  }
  if (!isDate(h.period) || !h.accn || !/^(10-K|10-Q)(\/A)?$/.test(h.form || "")) problems.gate.push(`${h.ticker} period/accn/form`);
  const src = h.sources || {};
  if (!src.dataset && !src.instance) problems.src.push(`${h.ticker} names neither the data set nor an instance`);
  if (!["dataset", "instance", "table"].includes(h.rowSource)) problems.src.push(`${h.ticker} rowSource ${h.rowSource}`);
  /* the rows */
  let sumCost = 0, sumFv = 0;
  const ids = new Set();
  for (const r of h.holdings) {
    if (!r || typeof r.id !== "string" || !r.id || typeof r.issuer !== "string" || !KINDS.has(r.kind)) { problems.row.push(`${h.ticker}: ${r && r.id}`); continue; }
    if (!isNum(r.cost) || !isNum(r.fv)) problems.row.push(`${h.ticker} ${r.id}: cost/fv`);
    if (!r.src || !ROW_SOURCES.has(r.src.row)) problems.row.push(`${h.ticker} ${r.id}: src.row`);
    if (r.aff !== null && !AFF.has(r.aff)) problems.row.push(`${h.ticker} ${r.id}: aff ${r.aff}`);
    if (r.maturity !== null && !isDate(r.maturity)) problems.row.push(`${h.ticker} ${r.id}: maturity ${r.maturity}`);
    if (r.rate !== null && !(isNum(r.rate) && r.rate >= 0 && r.rate <= 1)) problems.row.push(`${h.ticker} ${r.id}: rate ${r.rate}`);
    if (r.spread !== null && !(isNum(r.spread) && r.spread > -0.05 && r.spread <= 1)) problems.row.push(`${h.ticker} ${r.id}: spread ${r.spread}`);
    if (r.src.row === "table" && r.src.table !== true) problems.row.push(`${h.ticker} ${r.id}: a table-sourced row without src.table`);
    if (r.src.val !== null && r.src.val !== "table") problems.row.push(`${h.ticker} ${r.id}: src.val ${r.src.val}`);
    if (r.nonAccrual === true && !NA_SOURCES.has(r.src.na)) problems.na.push(`${h.ticker} ${r.id}: non-accrual with src.na ${r.src.na}`);
    if (r.nonAccrual !== null && r.nonAccrual !== true) problems.na.push(`${h.ticker} ${r.id}: nonAccrual ${r.nonAccrual}`);
    if (ids.has(r.id + "|" + r.cost + "|" + r.fv)) problems.dup.push(`${h.ticker} ${r.id}`);
    ids.add(r.id + "|" + r.cost + "|" + r.fv);
    if (isNum(r.cost)) sumCost += r.cost;
    if (isNum(r.fv)) sumFv += r.fv;
  }
  if (Math.abs(sumCost - g.cost.sum) > 1 || Math.abs(sumFv - g.fv.sum) > 1) problems.gate.push(`${h.ticker}: the rows do not add to the gate's sums (${sumCost} vs ${g.cost.sum})`);
  /* the summary */
  const s = h.summary;
  if (!s || !s.wa || !s.nonAccrual || !s.lien || !s.maturity || !Array.isArray(s.industry) || !s.top10 || !s.vehicles || !("affiliation" in s)) {
    problems.summary.push(`${h.ticker}: summary block incomplete`);
    continue;
  }
  const naRows = h.holdings.filter((r) => r.nonAccrual === true);
  const naCost = naRows.reduce((a, r) => a + r.cost, 0);
  if (naRows.length !== s.nonAccrual.n || (naRows.length && Math.abs(naCost - s.nonAccrual.cost) > 1)) problems.na.push(`${h.ticker}: summary non-accrual ${s.nonAccrual.n}/${s.nonAccrual.cost} vs rows ${naRows.length}/${naCost}`);
  if (naRows.length && !s.nonAccrual.source) problems.na.push(`${h.ticker}: non-accrual rows but no source named`);
  if (!naRows.length && s.nonAccrual.source && s.nonAccrual.ofTotalCost !== null && s.nonAccrual.ofTotalCost !== 0) problems.na.push(`${h.ticker}: no non-accrual rows but a rate`);
  /* the wall adds back to the third-party debt cost */
  const m = s.maturity;
  const bucketSum = C.MATURITY_BUCKETS.reduce((a, b) => a + (isNum(m[b.label]) ? m[b.label] : 0), 0) + (isNum(m["n/a"]) ? m["n/a"] : 0) + (isNum(m.excluded) ? m.excluded : 0);
  if (!isNum(s.thirdPartyDebtCost) || Math.abs(bucketSum - s.thirdPartyDebtCost) > 1 || Math.abs((m.total || 0) - s.thirdPartyDebtCost) > 1) {
    problems.wall.push(`${h.ticker}: buckets ${bucketSum} vs third-party debt cost ${s.thirdPartyDebtCost}`);
  }
  for (const k of ["yieldAtCost", "yieldAtFv", "spreadCostWeighted", "floatingShare"]) {
    const v = s.wa[k];
    if (v !== null && !(isNum(v) && v >= 0 && v <= 1)) problems.summary.push(`${h.ticker}: wa.${k} ${v}`);
  }
  if (s.lien.firstLienShare !== null && !(isNum(s.lien.firstLienShare) && s.lien.firstLienShare >= 0 && s.lien.firstLienShare <= 1)) problems.summary.push(`${h.ticker}: firstLienShare`);
  if (s.lien.firstLienShareOfPortfolio !== null && !(isNum(s.lien.firstLienShareOfPortfolio) && s.lien.firstLienShareOfPortfolio <= (s.lien.firstLienShare || 1) + 1e-9)) problems.summary.push(`${h.ticker}: firstLienShareOfPortfolio ${s.lien.firstLienShareOfPortfolio} above the debt-only share`);
  /* a withheld count carries its flag; a served count stands against
     the rows it was counted over: at least a fifth of the rows are
     distinct issuers and the top ten hold at most 90% of fair value
     (NMFC's issuer/industry swap served 13 companies over 365 rows and
     a 95.4% top ten), except for a book of under 20 rows */
  const flagged = (fig) => Array.isArray(s.flags) && s.flags.some((f) => f.figure === fig);
  if (s.count === null) {
    if (!flagged("count")) problems.summary.push(`${h.ticker}: count withheld without a flag`);
  } else {
    if (!(Number.isInteger(s.count) && s.count > 0)) problems.summary.push(`${h.ticker}: count ${s.count}`);
    if (!Number.isInteger(s.namesUnsplit) || s.namesUnsplit > s.count) problems.summary.push(`${h.ticker}: namesUnsplit ${s.namesUnsplit}`);
    /* s.count is drawn from third-party rows only (credit.js's
       thirdParty predicate: not a vehicle or structured note, not
       controlled or non-controlled affiliated, not a cash equivalent) —
       so the sanity floor divides by that same population, not every
       row in the file. A filer with a large controlled/affiliated book
       (MAIN: 191 controlled + 141 non-controlled affiliated of 619
       rows) legitimately has fewer third-party issuers than 20% of its
       total rows without any issuer/industry-swap bug; measuring
       against all rows would flag that filer on every run. */
    const thirdPartyRows = h.holdings.filter((r) => r.kind !== "vehicle" && r.kind !== "structured" &&
      r.aff !== "controlled" && r.aff !== "non-controlled affiliated" && r.cashEquivalent !== true).length;
    if (thirdPartyRows >= 20 && s.count < 0.2 * thirdPartyRows) problems.summary.push(`${h.ticker}: ${s.count} issuers over ${thirdPartyRows} third-party rows`);
    if (h.holdings.length >= 20 && isNum(s.top10.share) && s.top10.share > 0.9) problems.summary.push(`${h.ticker}: top10 ${s.top10.share}`);
  }
  /* a null affiliation split is the honest state when no source
     classified a row; a served one names the three classes only */
  if (s.affiliation !== null && !Object.keys(s.affiliation).every((k) => AFF.has(k) || k === "n/a")) problems.summary.push(`${h.ticker}: affiliation keys ${Object.keys(s.affiliation)}`);
  /* a withheld figure is null, never a zero standing for "unread" */
  if (s.wa.floatingShare === 0 && s.wa.n && s.wa.n.spread === 0) problems.summary.push(`${h.ticker}: floatingShare 0 with no spread fact`);
  if (s.lien.firstLienShare === 0 && isNum(s.lien.unclassifiedShare) && s.lien.unclassifiedShare > 0.5) problems.summary.push(`${h.ticker}: firstLienShare 0 with ${s.lien.unclassifiedShare} unclassified`);
  /* non-accrual against the filing's own sentence, on the basis the
     sentence states: served only within a point, else withheld */
  const vp = s.vsProse;
  if (s.nonAccrual.source && vp && isNum(vp.nonAccrualCost)) {
    const comp = vp.nonAccrualOf === "debt" ? s.nonAccrual.ofDebtCost : s.nonAccrual.ofTotalCost;
    if (isNum(comp) && Math.abs(comp - vp.nonAccrualCost) > 0.01 + 1e-9) problems.na.push(`${h.ticker}: non-accrual ${comp} served against the filing's ${vp.nonAccrualCost}`);
  }
  if (s.nonAccrual.source && isNum(s.nonAccrual.ofTotalCost) && s.nonAccrual.ofTotalCost > 0.25) problems.na.push(`${h.ticker}: non-accrual ${s.nonAccrual.ofTotalCost} of cost served`);
  if (Buffer.byteLength(text) > 1048576) problems.summary.push(`${h.ticker}: ${(Buffer.byteLength(text) / 1048576).toFixed(2)} MB`);
}
check("every holdings file carries a passed gate within 0.5% on cost and fair value, and its rows add to the gate's sums", !problems.gate.length, problems.gate.slice(0, 4).join("; "));
check("every holdings file names its source (data set or instance)", !problems.src.length, problems.src.slice(0, 3).join("; "));
check("every holding has an id, an issuer, a kind, a cost, a fair value and its source row", !problems.row.length, problems.row.slice(0, 4).join("; "));
check("no holding is written twice", !problems.dup.length, problems.dup.slice(0, 3).join("; "));
check("every non-accrual row keeps its flag with the source that read it, and the summary counts the same rows", !problems.na.length, problems.na.slice(0, 4).join("; "));
check("the maturity buckets plus n/a add back to the third-party debt cost", !problems.wall.length, problems.wall.slice(0, 3).join("; "));
check("the summary block is complete and its ratios are fractions", !problems.summary.length, problems.summary.slice(0, 4).join("; "));
check("every holdings file stamps the credit library's version", !problems.version.length, problems.version.slice(0, 3).join("; "));
check("no holdings file belongs to a ticker outside the universe", !problems.strays.length, problems.strays.join(","));
check("no holdings file contains 'undefined' or 'NaN'", !problems.leak.length, problems.leak.join(","));
check("no holdings file is over 1 MB and the set averages at most 250 KB a file", bytes <= files.length * 250 * 1024 && !problems.summary.some((p) => / MB$/.test(p)), `${(bytes / 1048576).toFixed(2)} MB in ${files.length} files`);

/* ---------- the four spot values (blueprint 10.3) ---------- */

/* a newer quarter on disk is not a failure: the shape, gate and range
   checks above hold it, and the pins wait for their own PR */
const later = (h) => h && h.period > "2026-06-30";
const arcc = byTicker.get("ARCC");
if (later(arcc)) {
  console.log(`  skip  ARCC pins: the committed file is for ${arcc.period}, later than the pinned 2026-06-30`);
} else if (arcc && arcc.period === "2026-06-30") {
  check("ARCC 10-Q 2026-06-30 (0001628280-26-050307): 1,439 rows through the gate", arcc.gate.rows === 1439 && arcc.holdings.length === 1439, String(arcc.gate.rows));
  check("ARCC Σ cost 29,674,600,000 and Σ FV 29,349,300,000, the tagged totals",
    arcc.gate.cost.sum === 29674600000 && arcc.gate.fv.sum === 29349300000, `${arcc.gate.cost.sum} / ${arcc.gate.fv.sum}`);
  const na = arcc.summary.nonAccrual;
  check("ARCC non-accrual 2.4% at cost / 1.4% at FV within 0.1 point of the 10-Q's sentence",
    near(na.ofTotalCost, 0.024, 0.001) && near(na.ofTotalFv, 0.014, 0.001), `${na.ofTotalCost} / ${na.ofTotalFv} (${na.source})`);
} else {
  check("ARCC holdings file is committed for 2026-06-30", false, arcc ? arcc.period : "missing");
}

const bxsl = byTicker.get("BXSL");
if (later(bxsl)) {
  console.log(`  skip  BXSL pins: the committed file is for ${bxsl.period}, later than the pinned 2026-06-30`);
} else if (bxsl && bxsl.period === "2026-06-30") {
  const s = bxsl.summary;
  /* the schedule counts distinct issuer names on the identifier axis
     (a portfolio company can borrow through more than one entity), so
     the count runs above the 313 the prose states; the prose figure is
     the cross-check beside it, never merged in */
  check("BXSL 10-Q 2026-06-30 (0001736035-26-000016): the prose's 313 portfolio companies recorded beside the computed issuer count",
    s.vsProse && s.vsProse.portfolioCompanies === 313, `prose ${s.vsProse && s.vsProse.portfolioCompanies}`);
  check("BXSL distinct third-party issuers between the 313 companies and 1.25 times that",
    isNum(s.count) && s.count >= 313 && s.count <= 1.25 * 313, String(s.count));
  check("BXSL weighted-average yield at cost within 0.3 points of the disclosed 9.2%", near(s.wa.yieldAtCost, 0.092, 0.003), String(s.wa.yieldAtCost));
  check("BXSL weighted-average yield at fair value within 0.3 points of the disclosed 9.4%", near(s.wa.yieldAtFv, 0.094, 0.003), String(s.wa.yieldAtFv));
  check("BXSL floating share within 1 point of the disclosed 99.3%", near(s.wa.floatingShare, 0.993, 0.01), String(s.wa.floatingShare));
  check("BXSL non-accrual 3.6% at cost / 1.8% at FV within 0.1 point", near(s.nonAccrual.ofTotalCost, 0.036, 0.001) && near(s.nonAccrual.ofTotalFv, 0.018, 0.001),
    `${s.nonAccrual.ofTotalCost} / ${s.nonAccrual.ofTotalFv} (${s.nonAccrual.source})`);
} else {
  check("BXSL holdings file is committed for 2026-06-30", false, bxsl ? bxsl.period : "missing");
}

const gbdc = byTicker.get("GBDC");
if (later(gbdc)) {
  console.log(`  skip  GBDC pins: the committed file is for ${gbdc.period}, later than the pinned 2026-06-30`);
} else if (gbdc && gbdc.period === "2026-06-30") {
  const s = gbdc.summary;
  /* the blueprint's 92% is over the whole portfolio at cost (one stop
     $7,288.8M + senior secured $396.8M of $8,377.1M); over third-party
     debt alone the same loans are about 99% */
  check("GBDC 10-Q 2026-06-30 (0001476765-26-000048): first-lien share including one stop about 92% of portfolio cost (within 3 points)",
    near(s.lien.firstLienShareOfPortfolio, 0.92, 0.03), String(s.lien.firstLienShareOfPortfolio));
  check("GBDC one stop is a first-lien sub-class, never second lien",
    !!s.lien.classes["first lien incl. unitranche/last-out"] && s.lien.classes["first lien incl. unitranche/last-out"].shareOfPortfolio > 0.8,
    JSON.stringify(s.lien.classes));
  check("GBDC non-accrual 2.9% at cost / 1.9% at FV within 0.1 point", near(s.nonAccrual.ofTotalCost, 0.029, 0.001) && near(s.nonAccrual.ofTotalFv, 0.019, 0.001),
    `${s.nonAccrual.ofTotalCost} / ${s.nonAccrual.ofTotalFv} (${s.nonAccrual.source})`);
  /* GBDC's identifier rows in the August 2026 data set omit its
     non-controlled affiliated equity (about $112M of the $8,377M total,
     Chestnut Optical Midco's LLC interest the largest); the gate passes
     on the tagged rows plus the printed rows no tagged holding claims,
     each of those flagged src.row "table" (blueprint 7.3) */
  const fromTable = gbdc.holdings.filter((r) => r.src.row === "table");
  check("GBDC's untagged affiliated equity comes from the printed schedule, flagged src.row table, and the gate passed on the union",
    fromTable.length > 0 && fromTable.some((r) => /chestnut optical/i.test(r.name || r.id) && r.kind === "equity") && /table-only/.test(gbdc.gate.variant || ""),
    `${fromTable.length} rows from the table; ${gbdc.gate.variant}`);
} else {
  check("GBDC holdings file is committed for 2026-06-30", false, gbdc ? gbdc.period : "missing");
}

/* ---------- the review's pins (round 1), Q2 2026 files only ---------- */

/* PSEC 10-K for 2026-06-30, accession 0001287032-26-000269, Note 2:
   "the cost basis of our loans on non-accrual status amounted to
   $298,227 ... with fair value of $42,531" (thousands). Its R9.htm
   footnotes (30) and (32) are PIK notes that mention non-accrual
   ("which excludes those on non-accrual"); the status marker is (33). */
const psec = byTicker.get("PSEC");
if (psec && psec.period === "2026-06-30") {
  const na = psec.summary.nonAccrual;
  check("PSEC 10-K 2026-06-30 (0001287032-26-000269): non-accrual $298.2M cost / $42.5M FV, the note's own figures, from the R page's status marker",
    na.source === "rpage" && near(na.cost, 298227000, 1000) && near(na.fv, 42531000, 1000), `${na.cost} / ${na.fv} (${na.source})`);
  check("PSEC's control investments are classified (the 10-K's Control Investments section), so its affiliation split is not n/a",
    !!psec.summary.affiliation && !!psec.summary.affiliation.controlled && psec.summary.affiliation.controlled.share > 0.3, JSON.stringify(psec.summary.affiliation));
}
/* OFS 10-Q for 2026-06-30, accession 0001487918-26-000078, note on
   non-accrual loans: "The aggregate amortized cost and fair value of
   loans on non-accrual status as of June 30, 2026 was $43,990 and
   $21,386" (thousands); Item 2: "aggregate fair value of $21.4 million,
   or 7.2% of our total investments at fair value" */
const ofs = byTicker.get("OFS");
if (ofs && ofs.period === "2026-06-30") {
  const na = ofs.summary.nonAccrual;
  check("OFS 10-Q 2026-06-30 (0001487918-26-000078): non-accrual $43,990K cost / $21,386K FV from the schedule's (6) markers, 7.2% of FV as the 10-Q states",
    na.source === "table" && near(na.cost, 43990000, 1000) && near(na.fv, 21386000, 1000) && near(na.ofTotalFv, 0.072, 0.001), `${na.cost} / ${na.fv} (${na.source}), ${na.ofTotalFv} of FV`);
}
/* NMFC 10-Q for 2026-06-30, accession 0001496099-26-000029: header
   "Portfolio Company, Location and Industry"; footnote "(17) Investment
   is on non-accrual status as of June 30, 2026" printed on the
   reference cell of American Achievement Corporation's first-lien
   rows; Item 2: "$2,289.8 million in 112 portfolio companies" */
const nmfc = byTicker.get("NMFC");
if (nmfc && nmfc.period === "2026-06-30") {
  const s = nmfc.summary;
  const aac = nmfc.holdings.filter((r) => /american achievement/i.test(r.name) && r.kind === "debt" && r.cost > 0);
  check("NMFC 10-Q 2026-06-30 (0001496099-26-000029): issuer names are companies, not industries — over 100 distinct issuers on 300+ rows",
    Number.isInteger(s.count) && s.count >= 100 && !nmfc.holdings.some((r) => /^(software|healthcare|business services|education)$/i.test(r.name)), `count ${s.count}`);
  check("NMFC: the prose's 112 portfolio companies recorded beside the computed count over every issuer, within 25%", s.vsProse && s.vsProse.portfolioCompanies === 112 && Math.abs((s.countAll ?? s.count) - 112) / 112 <= 0.25, `${s.countAll ?? s.count} vs ${s.vsProse && s.vsProse.portfolioCompanies}`);
  check("NMFC: American Achievement Corporation's funded first-lien rows carry the (17) non-accrual mark from the printed schedule",
    aac.length >= 2 && aac.every((r) => r.nonAccrual === true && r.src.na === "table"), aac.map((r) => `${r.id.slice(0, 60)}: ${r.nonAccrual}/${r.src.na}`).join("; "));
  check("NMFC: the industry list is industries (Business Services, Software, Healthcare), not company names",
    s.industry.slice(0, 3).every((i) => /^(business services|software|healthcare|financial services|consumer services|investment funds|net lease|education)$/i.test(i.name)), s.industry.slice(0, 3).map((i) => i.name).join(", "));
}
/* BBDC 10-Q for 2026-06-30, accession 0001379785-26-000030: "11
   portfolio companies with investments on non-accrual, the aggregate
   fair value of which was $13.7 million ... aggregate cost of which was
   $38.3 million"; A.T. Holdings II is "on non-accrual status only with
   respect to the PIK interest component" (footnote (27)/(31), kept out
   of the totals) */
const bbdc = byTicker.get("BBDC");
if (bbdc && bbdc.period === "2026-06-30") {
  const na = bbdc.summary.nonAccrual;
  check("BBDC 10-Q 2026-06-30 (0001379785-26-000030): non-accrual $38.3M cost / $13.7M FV within $0.5M, the PIK-only partial mark left out",
    near(na.cost, 38300000, 500000) && near(na.fv, 13700000, 500000), `${na.cost} / ${na.fv} (${na.source})`);
  check("BBDC: the maturity wall reads the schedule's MM/YY maturity column (dated cost above 90% of third-party debt)",
    bbdc.summary.maturity.dated > 0.9 * bbdc.summary.thirdPartyDebtCost, `dated ${bbdc.summary.maturity.dated} of ${bbdc.summary.thirdPartyDebtCost}`);
}
/* GAIN 10-Q for 2026-06-30, accession 0001321741-26-000017: "Variable
   rates with a floor | 100.0%" — the tagged rows carry no spread and no
   base label, so the floating share is unread, never 0 */
const gain = byTicker.get("GAIN");
if (gain && gain.period === "2026-06-30") {
  check("GAIN 10-Q 2026-06-30 (0001321741-26-000017): floating share withheld (null), not served as 0, when no spread fact or base label exists",
    gain.summary.wa.floatingShare === null && gain.summary.wa.n.spread === 0, String(gain.summary.wa.floatingShare));
  check("GAIN: section industries carry no \"- N.N %\" net-assets suffix", gain.holdings.every((r) => !r.industry || !/\d\s?%/.test(r.industry)),
    gain.holdings.filter((r) => r.industry && /\d\s?%/.test(r.industry)).slice(0, 2).map((r) => r.industry).join("; "));
}
/* PNNT 10-Q for 2026-06-30: the $270M four-week Treasury bill under
   "US Government Securities - 62.9 % of Net Assets" sits inside Total
   Investments (kept for the gate) and out of every portfolio figure */
const pnnt = byTicker.get("PNNT");
if (pnnt && pnnt.period === "2026-06-30") {
  const tb = pnnt.holdings.filter((r) => /treasury/i.test(r.name));
  const debt = pnnt.holdings.filter((r) => r.kind === "debt" && r.aff !== "controlled");
  check("PNNT 10-Q 2026-06-30: the Treasury bill is kept for the gate as kind other / cashEquivalent, not third-party debt",
    tb.length > 0 && tb.every((r) => r.kind === "other" && r.cashEquivalent === true), tb.map((r) => `${r.name}: ${r.kind}`).join("; "));
  check("PNNT: the 2026 maturity bucket excludes the bill's $269M", isNum(pnnt.summary.maturity["2026"]) && pnnt.summary.maturity["2026"] < 200000000, String(pnnt.summary.maturity["2026"]));
  void debt;
}
/* LIEN 10-Q for 2026-06-30, accession 0001193125-26-347342: "there were
   no investments placed on non-accrual status" — a stated zero, counted */
const lien = byTicker.get("LIEN");
if (lien && lien.period === "2026-06-30") {
  const na = lien.summary.nonAccrual;
  check("LIEN 10-Q 2026-06-30 (0001193125-26-347342): a stated \"no investments on non-accrual\" is a 0 with source prose, not an unknown",
    na.source === "prose" && na.cost === 0 && na.ofTotalCost === 0, `${na.source} ${na.cost}`);
}
/* ARCC's SDLP sentence ("none of the loans in the SDLP portfolio were
   on non-accrual status", December 2025) must never stand for ARCC's
   own June figure */
if (arcc && arcc.period === "2026-06-30") {
  check("ARCC: the prose cross-check carries the 10-Q's own 2.4% / 1.4%, not the SDLP vehicle's \"none\"",
    arcc.summary.vsProse && near(arcc.summary.vsProse.nonAccrualCost, 0.024, 1e-9) && near(arcc.summary.vsProse.nonAccrualFv, 0.014, 1e-9), JSON.stringify(arcc.summary.vsProse && [arcc.summary.vsProse.nonAccrualCost, arcc.summary.vsProse.nonAccrualFv]));
}

/* ---------- the disclosed block and acSource ---------- */

const disclosedProblems = [];
let disclosedFiles = 0;
for (const t of tickers) {
  const c = parse(`company-${t}.json`);
  if (!c || !c.disclosed) continue;
  disclosedFiles++;
  const d = c.disclosed;
  if (!d.accn || !isDate(d.period) || !d.assetCoverage) { disclosedProblems.push(`${t}: shape`); continue; }
  const ac = d.assetCoverage;
  if (ac.v !== null && !["tag", "prose", "formula"].includes(ac.acSource)) disclosedProblems.push(`${t}: acSource ${ac.acSource}`);
  if (ac.v !== null && !(isNum(ac.v) && ac.v > 1 && ac.v < 10)) disclosedProblems.push(`${t}: asset coverage ${ac.v}`);
  if (ac.acSource === "prose" && !ac.sentence) disclosedProblems.push(`${t}: prose with no sentence`);
  for (const k of ["waYieldAtCost", "waYieldAtFv", "floatingShare", "portfolioCompanies", "nonAccrualCostPct", "nonAccrualFvPct"]) {
    const f = d[k];
    if (f && (!isNum(f.v) || typeof f.sentence !== "string" || !f.sentence)) disclosedProblems.push(`${t}: ${k} without its sentence`);
  }
  if (!d.borrower || d.borrower.source !== "disclosed" || !C.DISCLOSED_ONLY.every((k) => k in d.borrower)) disclosedProblems.push(`${t}: borrower block`);
}
check("company files carry a disclosed block for most of the universe", disclosedFiles >= 0.8 * tickers.size, `${disclosedFiles} of ${tickers.size}`);
check("every disclosed figure carries its sentence, and asset coverage names tag, prose or formula", !disclosedProblems.length, disclosedProblems.slice(0, 4).join("; "));
const bxslCo = parse("company-BXSL.json"), arccCo = parse("company-ARCC.json"), mainCo = parse("company-MAIN.json");
if (bxslCo && bxslCo.disclosed && bxslCo.disclosed.period === "2026-06-30") {
  check("BXSL asset coverage 1.78 from the tag", bxslCo.disclosed.assetCoverage.acSource === "tag" && near(bxslCo.disclosed.assetCoverage.v, 1.78, 0.0001),
    `${bxslCo.disclosed.assetCoverage.v} (${bxslCo.disclosed.assetCoverage.acSource})`);
}
if (arccCo && arccCo.disclosed && arccCo.disclosed.period === "2026-06-30") {
  check("ARCC asset coverage 1.86 from the tag", arccCo.disclosed.assetCoverage.acSource === "tag" && near(arccCo.disclosed.assetCoverage.v, 1.86, 0.0001),
    `${arccCo.disclosed.assetCoverage.v} (${arccCo.disclosed.assetCoverage.acSource})`);
}
if (mainCo && mainCo.disclosed && mainCo.disclosed.period === "2026-06-30") {
  check("MAIN asset coverage 244% from the prose with acSource prose", mainCo.disclosed.assetCoverage.acSource === "prose" && near(mainCo.disclosed.assetCoverage.v, 2.44, 0.0001),
    `${mainCo.disclosed.assetCoverage.v} (${mainCo.disclosed.assetCoverage.acSource})`);
}
if (universe && Array.isArray(universe.rows)) {
  check("universe rows carry acSource for most filers", universe.rows.filter((r) => ["tag", "prose", "formula"].includes(r.acSource)).length >= 0.8 * universe.rows.length,
    `${universe.rows.filter((r) => r.acSource).length} of ${universe.rows.length}`);
}

/* ---------- composite.json (contract H3) ---------- */

const comp = parse("composite.json");
check("composite.json parses", !!comp && comp.weighted && comp.n && comp.totals && comp.dispersion);
if (comp) {
  check("composite stamps the credit library's version", comp.creditVersion === C.CREDIT_VERSION, String(comp.creditVersion));
  const W = ["yieldAtCost", "yieldAtFv", "spreadCostWeighted", "floatingShare", "nonAccrualCost", "nonAccrualFv", "pikShareOfInterest", "pikShareOfTotal",
             "fvOverCost", "debtToEquity", "assetCoverage", "opexRatio", "tiiYieldOnAvgCost"];
  check("every weighted figure of H3 is present with n", W.every((k) => k in comp.weighted && Number.isInteger(comp.n[k])),
    W.filter((k) => !(k in comp.weighted) || !Number.isInteger(comp.n[k])).join(","));
  /* the yield n sits under the spread and floating n by design: a
     filer's yield is withheld when rows with a tagged principal and
     rate carry under 80% of its accruing third-party debt cost (OBDC
     tags one rate on 265 loans), so 18 of 32 members carry one on the
     Q2 2026 files */
  check("n is at least 15 filers for the yield and 20 for the spread and floating share", comp.n.yieldAtCost >= 15 && ["spreadCostWeighted", "floatingShare"].every((k) => comp.n[k] >= 20),
    JSON.stringify({ yieldAtCost: comp.n.yieldAtCost, spread: comp.n.spreadCostWeighted, floating: comp.n.floatingShare }));
  check("the composite totals are written: fair value, cost and third-party debt cost, in dollars",
    isNum(comp.totals.fv) && comp.totals.fv > 1e11 && isNum(comp.totals.cost) && comp.totals.cost > 1e11 && isNum(comp.totals.thirdPartyDebtCost) && comp.totals.thirdPartyDebtCost > 1e10,
    JSON.stringify(comp.totals));
  check("members are the tickers with a passed gate", Array.isArray(comp.members) && comp.members.length === files.length && comp.members.every((t) => byTicker.has(t)),
    `${comp.members && comp.members.length} vs ${files.length}`);
  check("dispersion carries min, p25, median, p75, max and n per ratio, ordered",
    Object.entries(comp.dispersion).every(([k, d]) => Number.isInteger(d.n) && (d.n === 0 || (isNum(d.min) && d.min <= d.p25 && d.p25 <= d.median && d.median <= d.p75 && d.p75 <= d.max))),
    Object.entries(comp.dispersion).filter(([, d]) => !(Number.isInteger(d.n) && (d.n === 0 || (isNum(d.min) && d.min <= d.p25 && d.p25 <= d.median && d.median <= d.p75 && d.p75 <= d.max)))).map(([k]) => k).join(","));
  check("priceToNavP25 is left null for the page to fill from live prices", comp.priceToNavP25 === null);
  const hist = comp.histogram;
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  check("the spread histogram is in 50 bps buckets and its shares add to 1 by count and by cost",
    !!hist && Object.keys(hist.byCount).every((k) => /^(\d+-\d+|\d+\+|<0)$/.test(k)) && near(sum(hist.byCount), 1, 0.01) && near(sum(hist.byCost), 1, 0.01),
    hist && `${sum(hist.byCount).toFixed(3)} / ${sum(hist.byCost).toFixed(3)}`);
  const wall = comp.maturityWall;
  const wallSum = C.MATURITY_BUCKETS.reduce((a, b) => a + (wall[b.label] || 0), 0) + (wall["n/a"] || 0) + (wall.excluded || 0);
  check("the composite maturity wall plus n/a adds to the pooled third-party debt cost", near(wallSum, comp.totals.thirdPartyDebtCost, 1), `${wallSum} vs ${comp.totals.thirdPartyDebtCost}`);
  check("the lien mix names the first-lien share and every class share is a fraction",
    isNum(comp.lienMix.firstLienShare) && Object.values(comp.lienMix.classes).every((c) => isNum(c.share) && c.share >= 0 && c.share <= 1), JSON.stringify(comp.lienMix.classes));
  check("the income-yield series is quarterly with n per point and GrossInvestmentIncomeOperating as its numerator",
    Array.isArray(comp.tiiYieldSeries) && comp.tiiYieldSeries.length >= 8 && comp.tiiYieldSeries.every((p) => /^CY\d{4}Q[1-4]$/.test(p.quarter) && isNum(p.yield) && Number.isInteger(p.n) && p.n > 0),
    comp.tiiYieldSeries && `${comp.tiiYieldSeries.length} points, last ${JSON.stringify(comp.tiiYieldSeries[comp.tiiYieldSeries.length - 1])}`);
  check("composite.json contains no 'undefined' or 'NaN'", !/undefined|NaN/.test(readFileSync(join(DIR, "composite.json"), "utf8")));
}

/* ---------- coverage and the report ---------- */

const coverage = parse("coverage.json");
if (coverage && coverage.holdings) {
  const h = coverage.holdings;
  check("coverage.json records the holdings written, refused and failed per ticker", Number.isInteger(h.n) && Array.isArray(h.tickers_refused) && h.byTicker &&
    Object.values(h.byTicker).every((e) => ["written", "refused", "failed"].includes(e.status)), JSON.stringify({ n: h.n, refused: h.refused, failed: h.failed }));
  check("every refusal names the accession and the gate's reason", h.tickers_refused.every((r) => r.ticker && r.accn && r.reason), JSON.stringify(h.tickers_refused.slice(0, 3)));
  check("the holdings files on disk are the ones coverage says were written",
    files.length === h.n && files.every((f) => h.byTicker[f.replace(/^holdings-|\.json$/g, "")] && h.byTicker[f.replace(/^holdings-|\.json$/g, "")].status === "written"));
} else {
  check("coverage.json carries the holdings block", false);
}
const report = parse("refresh-report.json");
check("refresh-report.json carries the holdings stage with its refusals and downloads",
  !!report && !!report.holdings && Array.isArray(report.holdings.refused) && report.holdings.downloads && isNum(report.holdings.downloads.bytes));

console.log(failed ? `\n${failed} bdc-holdings check(s) failed` : "\nall bdc-holdings checks pass");
process.exit(failed ? 1 : 0);
