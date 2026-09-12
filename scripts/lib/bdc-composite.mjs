/**
 * bdc-composite.mjs — the schedule-derived figures of one BDC, and the
 * composite across every BDC whose schedule passed the gate.
 *
 * Three layers, all pure, all reading the holding shape that
 * soi-parse.mjs produces (contract H1 of the build plan):
 *
 *   enrichFromTable   the HTML schedule's rows joined to the tagged
 *   enrichFromRPage   holdings for what the data set does not carry —
 *                     the maturity date, the industry the loan sits
 *                     under, the non-accrual footnote, and the lien
 *                     section for a filer that does not tag its
 *                     Investment Type axis (blueprint 7.3). A matched
 *                     row fills only what the holding lacks and stamps
 *                     the source on src.mat / src.ind / src.na; a
 *                     non-accrual mark is never dropped, and a row that
 *                     matched no holding is kept beside the holdings
 *                     rather than added to them, so the gate's sums
 *                     stay the tagged sums.
 *   holdingsFromTable the printed schedule as rows of its own (src.row
 *   tableOnlyHoldings "table"): the whole schedule for a filer whose
 *                     tagged rows carry a vehicle's loans beside its own,
 *                     or only the rows no tagged holding claims for a
 *                     filer that tags part of its schedule without a
 *                     per-position identifier; either set goes through
 *                     the same gate before it stands as the schedule.
 *   summarizeHoldings the per-filer block of holdings-<TICKER>.json:
 *                     every figure through frontend/lib/credit.js
 *                     (weightedAverageYield, spreadCostWeighted,
 *                     floatingShare, top10Concentration, maturityBuckets,
 *                     nonAccrualTotals, lienClass), computed on
 *                     third-party accruing debt as blueprint 4.2 defines
 *                     each, with the tagged portfolio totals as the
 *                     denominators the filing itself uses.
 *   buildComposite    composite.json (blueprint 4.4): across the filers
 *                     with a passed gate, every dollar figure pooled —
 *                     which is the cost-weighted mean, since the
 *                     denominators are cost — and every filer-level
 *                     ratio (asset coverage, the expense ratio) weighted
 *                     by that filer's cost of third-party debt; n on
 *                     every figure; the dispersion (min, P25, median,
 *                     P75, max) of each ratio across the filers; the
 *                     50 bps spread histogram by count and by cost; the
 *                     maturity wall, lien and sector mix; and the
 *                     total-investment-income yield on average cost as
 *                     a quarterly series from the company files
 *                     (GrossInvestmentIncomeOperating ÷ the average of
 *                     this and the prior quarter's InvestmentOwnedAtCost,
 *                     annualised ×4 — never an interest sub-tag).
 *
 * Nothing here estimates a missing figure: a filer without a
 * non-accrual source is not counted as zero non-accruals, it is
 * outside that figure's n; a holding without a maturity sits in the
 * "n/a" bucket, which is reported so the wall and the "n/a" always
 * add back to the third-party debt cost they were cut from.
 *
 * CREDIT_VERSION travels from credit.js into the composite, so a file
 * computed under an older definition can be told apart.
 *
 * Zero dependencies. Nothing here touches the network or the disk.
 */

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toCreditHolding, normalizeRow, normalizeIssuer } from "./soi-parse.mjs";
import { joinHoldings, issuerKey } from "./soi-html.mjs";
import { LIEN, lienClass, isFirstLien } from "./bdc-concepts.mjs";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const RTCredit = require(join(ROOT, "frontend/lib/credit.js"));
export const CREDIT_VERSION = RTCredit.CREDIT_VERSION;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const round0 = (v) => (isNum(v) ? Math.round(v) : null);
const round4 = (v) => (isNum(v) ? Math.round(v * 10000) / 10000 : null);
const round6 = (v) => (isNum(v) ? Math.round(v * 1e6) / 1e6 : null);
const div = (a, b) => RTCredit.div(a, b);
const share = (a, b) => round4(div(a, b));

/* ---------- the credit.js view of a holding ---------- */

/* credit.js keys an issuer by `company` first; the normalised name is
   the key here so "Corfin Holdings, Inc." and "Corfin Holdings Inc"
   count once. `thirdParty` and `isDebt` come from soi-parse's reading
   of kind and affiliation. */
export function creditHoldings(holdings) {
  return (holdings || []).map((h0) => {
    /* a holding read back from a written file has its null fields
       omitted (compactHolding); the sub-objects come back empty */
    const h = { ...h0, lien: h0.lien || {}, src: h0.src || {} };
    const c = toCreditHolding(h);
    c.company = issuerKey(h.name || h.id || "") || c.issuer;
    return c;
  });
}

const isThirdPartyDebt = (c) => c.isDebt === true && c.thirdParty !== false;
const isThirdParty = (c) => c.thirdParty !== false;

/* ---------- the table join ---------- */

const within = (a, b, tol) => isNum(a) && isNum(b) && (a === b || Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b)));

/**
 * joinHoldings with a numeric pass first: a member and a row whose
 * cost and fair value are both equal to the unit, and unique on each
 * side, are the same position whatever the two sources call it — the
 * August 2026 file names a loan "Non-Control/Non-Affiliate Investments
 * Debt Investments Application Software Airship Group, Inc. Investment
 * Type Senior Secured ..." where the table prints "Airship Group,
 * Inc." (RWAY, MSDL, PNNT). The name-and-amount join then runs on
 * what is left. Same result shape as joinHoldings, stages.numeric
 * added.
 */
export function joinWithNumbers(members, rows, { tolerance = 0.005 } = {}) {
  const key = (x) => (isNum(x.cost) && isNum(x.fv) && (x.cost !== 0 || x.fv !== 0) ? `${x.cost}|${x.fv}` : null);
  const count = (list) => {
    const m = new Map();
    for (const x of list) { const k = key(x); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const mc = count(members), rc = count(rows);
  const rowByKey = new Map();
  for (const r of rows) { const k = key(r); if (k && rc.get(k) === 1) rowByKey.set(k, r); }
  const matched = [];
  const usedRows = new Set(), usedMembers = new Set();
  for (const m of members) {
    const k = key(m);
    if (!k || mc.get(k) !== 1) continue;
    const r = rowByKey.get(k);
    if (!r) continue;
    matched.push({ member: m, row: r, stage: "numeric" });
    usedRows.add(r); usedMembers.add(m);
  }
  const rest = joinHoldings(members.filter((m) => !usedMembers.has(m)), rows.filter((r) => !usedRows.has(r)), { tolerance });
  return {
    matched: matched.concat(rest.matched),
    unmatchedRows: rest.unmatchedRows, unmatchedMembers: rest.unmatchedMembers,
    stages: { numeric: matched.length, ...rest.stages },
    rate: members.length ? (matched.length + rest.matched.length) / members.length : 0,
    nonAccrualUnmatched: rest.nonAccrualUnmatched,
  };
}

/**
 * A rate a filer tagged a hundred times too large ("9.48" for 9.48%:
 * ARCC's Adonis Bidco and Covert HoldCo rows in the August 2026 file)
 * is rescaled when it sits between 1 and 100, dropped when larger, and
 * the holding says so (src.rt "rescaled"). Returns the count touched.
 */
export function sanitizeRates(holdings) {
  let n = 0;
  for (const h of holdings) {
    for (const k of ["rate", "spread", "pik", "floor"]) {
      const v = h[k];
      if (!isNum(v) || v <= 1) continue;
      h[k] = v <= 100 ? round4(v / 100) : null;
      h.src.rt = h[k] === null ? "dropped" : "rescaled";
      n++;
    }
    /* a spread printed in basis points with no unit ("3M SOFR+ 500",
       PNNT) reads as 5.00 and then 0.05 above; "+ 50" reads as 0.5 —
       no loan carries a 50-point spread, so anything over 25 points is
       basis points still */
    if (isNum(h.spread) && h.spread > 0.25) { h.spread = round4(h.spread / 100); h.src.rt = "rescaled"; n++; }
    /* an all-in rate below the loan's own spread is not the all-in rate:
       it is the floor the printed row states beside the spread ("SOFR+550,
       0.75% Floor", MFIC's August 2026 rows read from the table; ICMB's
       "1.00%" beside SOFR + 6.50%) — kept as the floor when none was
       read, and the rate withheld. An all-in rate below the loan's own
       PIK rate is the cash coupon alone (RWAY's BlueConic second lien,
       "20.00% PIK" tagged with a 0% rate): withheld too, never summed
       with the PIK into a figure the filer did not state. */
    if (isNum(h.rate) && isNum(h.spread) && h.spread > 0 && h.rate < h.spread) {
      if (!isNum(h.floor)) h.floor = h.rate;
      h.rate = null; h.src.rt = "dropped"; n++;
    } else if (isNum(h.rate) && isNum(h.pik) && h.pik > 0 && h.rate < h.pik) {
      h.rate = null; h.src.rt = "dropped"; n++;
    }
    if (h.src.rt === "rescaled" || h.src.rt === "dropped") h.floating = isNum(h.spread) || h.base !== null;
  }
  return n;
}

/* A holding whose name is its whole member text and reads as a
   sentence of column headings: the splitter knew no shape for it. */
const UNSPLIT_RE = /\b(?:Investments?\b.*\b(?:Maturity Date|Interest Rate|Type of Investment|Investment Type|Investment Date|Reference Rate)|Type of Investment|Investment Type|Maturity Date|Interest Rate)\b/;
export function unsplitName(h) {
  return !!h && typeof h.id === "string" && h.name === h.id && h.id.length > 40 && UNSPLIT_RE.test(h.id);
}

/* A table row's lien class: the section it sits under, else its own
   type cell (GBDC's "One stop", MAIN's "Secured Debt" through the
   filer override). */
function tableLien(row, filerOverrides) {
  if (row.section && row.section.lien) {
    const cls = lienClass(row.section.lien, filerOverrides);
    if (cls) return { cls, raw: row.section.lien };
  }
  if (row.type) {
    const cls = lienClass(row.type, filerOverrides);
    if (cls) return { cls, raw: row.type };
  }
  return null;
}

function applyLien(h, lien) {
  if (!lien || h.lien.class) return false;
  /* a section the reader carried past its end must not turn a loan into
     equity, or a share into a loan */
  if (h.kind === "debt" && lien.cls === LIEN.EQUITY) return false;
  if (h.kind === "equity" && lien.cls !== LIEN.EQUITY && lien.cls !== LIEN.VEHICLES) return false;
  h.lien.class = lien.cls === LIEN.FIRST_UNITRANCHE ? LIEN.FIRST : lien.cls;
  h.lien.subclass = lien.cls === LIEN.FIRST_UNITRANCHE ? "incl. unitranche/last-out" : null;
  if (!h.lien.raw) h.lien.raw = lien.raw;
  if (h.kind === "other") h.kind = lien.cls === LIEN.EQUITY ? "equity" : lien.cls === LIEN.VEHICLES ? "vehicle" : "debt";
  return true;
}

/**
 * A filer's own lien vocabulary (credit.js FILER_LIEN_OVERRIDES: MAIN's
 * "Secured Debt" is first lien) applied after the data set was read in
 * one pass for every filer: a holding whose raw label the general map
 * did not know is classified through the override, in place.
 */
export function applyFilerOverrides(holdings, overrides) {
  if (!overrides) return 0;
  let n = 0;
  for (const h of holdings) {
    if (h.lien.class || !h.lien.raw) continue;
    const cls = lienClass(h.lien.raw, overrides);
    if (cls && applyLien(h, { cls, raw: h.lien.raw })) n++;
  }
  return n;
}

/**
 * Join the HTML schedule's rows to the holdings and fill what the
 * tagged row lacks. `rows` is parseScheduleTables().rows, already at
 * the filing's period; `scaleFix` multiplies the table's money when the
 * caller found the heading's scale note was missed (KBDC prints
 * thousands the reader took as units — the totals say so).
 *
 * Returns { matched, stages, rate, unmatchedRows, nonAccrualUnmatched,
 * filled: { mat, ind, na, lien, aff, rate }, nonAccrualIssuerPass }.
 * unmatchedRows carries every table row no holding claimed, with its
 * columns, non-accrual first (blueprint 7.3: a table row that does not
 * match is kept with its columns and flagged "table"); it is written
 * beside the holdings, never summed with them.
 */
export function enrichFromTable(holdings, rows, { filerOverrides = null, tolerance = 0.005, scaleFix = 1 } = {}) {
  const scaled = scaleFix === 1 ? rows : rows.map((r) => ({
    ...r,
    cost: isNum(r.cost) ? round0(r.cost * scaleFix) : r.cost,
    fv: isNum(r.fv) ? round0(r.fv * scaleFix) : r.fv,
    principal: isNum(r.principal) && !r.units ? round0(r.principal * scaleFix) : r.principal,
  }));
  const members = holdings.map((h) => ({ id: h.id, issuer: h.name || h.id, principal: h.principal, cost: h.cost, fv: h.fv, h }));
  const join = joinWithNumbers(members, scaled, { tolerance });
  const filled = { mat: 0, ind: 0, na: 0, lien: 0, aff: 0, rate: 0, acquired: 0, name: 0 };
  const fill = (h, row) => {
    h.src.table = true;
    /* a member text the splitter did not know — the August 2026 file's
       sentence form, "Portfolio Company Debt Investments Auto
       Components First Brands Group, LLC Investment First Lien Senior
       Secured Loan Interest Rate 10.67% (S + 7.00%) Maturity Date
       6/29/2026" (PSBD, TRIN) — leaves the issuer as the whole text;
       the printed row it matched names the issuer */
    const printedIssuer = row.issuer ? String(row.issuer).replace(/[\s*+†‡#^]+$/, "").trim() : "";
    if (unsplitName(h) && printedIssuer) {
      h.name = printedIssuer || h.name;
      h.issuer = normalizeIssuer(h.name);
      h.src.nm = "table";
      filled.name++;
    } else if (printedIssuer && h.name && h.name.length > printedIssuer.length + 3 && h.name.toLowerCase().includes(printedIssuer.toLowerCase())) {
      /* a tagged name that carries the printed name inside a longer
         text ("Aerospace & Defense Beaufort Eagle U.S. Purchaser, Inc."
         for the printed "Eagle U.S. Purchaser, Inc.": MFIC's industry-
         prefixed members) is that issuer, spelled with its industry */
      h.name = printedIssuer;
      h.issuer = normalizeIssuer(h.name);
      h.src.nm = "table";
      filled.name++;
    }
    if (!h.maturity && row.maturity) { h.maturity = row.maturity; h.src.mat = "table"; filled.mat++; }
    if (!h.industry && row.industry) { h.industry = row.industry; h.src.ind = "table"; filled.ind++; }
    if (row.nonAccrual && h.nonAccrual !== true) { h.nonAccrual = true; h.src.na = "table"; filled.na++; }
    else if (row.nonAccrual && h.nonAccrual === true && h.src.na === "none") h.src.na = "table";
    if (!h.aff && row.section && row.section.aff) { h.aff = row.section.aff; filled.aff++; }
    else if (!h.aff && row.affNote) { h.aff = row.affNote; filled.aff++; }
    if (applyLien(h, tableLien(row, filerOverrides))) filled.lien++;
    if (!h.acquired && row.acquired) { h.acquired = row.acquired; filled.acquired++; }
    if (!isNum(h.principal) && isNum(row.principal) && !row.units && !row.currency) { h.principal = row.principal; filled.principal = (filled.principal || 0) + 1; }
    if (!isNum(h.pctNav) && isNum(row.pctNav)) h.pctNav = row.pctNav;
    /* a rate the data set did not tag; the table's text is the source */
    if (h.kind === "debt" && !isNum(h.rate) && !isNum(h.spread) && (isNum(row.rate) || isNum(row.spread))) {
      if (isNum(row.rate)) h.rate = round4(row.rate);
      if (isNum(row.spread)) h.spread = round4(row.spread);
      if (isNum(row.pik) && !isNum(h.pik)) h.pik = round4(row.pik);
      if (isNum(row.floor) && !isNum(h.floor)) h.floor = round4(row.floor);
      if (!h.base && row.base) h.base = row.base;
      h.floating = isNum(h.spread) || h.base !== null;
      h.src.rt = "table";
      filled.rate++;
      /* the printed figures pass through the same rules as the tagged
         ones: a spread printed in basis points, a floor read as the
         rate */
      sanitizeRates([h]);
      if (h.src.rt !== "dropped") h.src.rt = "table";
    } else {
      if (!isNum(h.pik) && isNum(row.pik)) h.pik = round4(row.pik);
      if (!isNum(h.floor) && isNum(row.floor)) h.floor = round4(row.floor);
      if (!h.base && row.base) { h.base = row.base; h.floating = true; }
    }
  };
  for (const m of join.matched) fill(m.member.h, m.row);

  /* a non-accrual row the name-and-amount join could not place: the
     issuer's debt holding nearest in cost, within 5%, so the footnote
     is not lost to a tranche the filer spells differently on the two
     sides; anything further apart stays unmatched and is counted */
  let nonAccrualIssuerPass = 0;
  const byKey = new Map();
  for (const h of holdings) {
    const k = issuerKey(h.name || h.id || "");
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(h);
  }
  const stillUnmatched = [];
  for (const row of join.unmatchedRows) {
    if (!row.nonAccrual) { stillUnmatched.push(row); continue; }
    const cands = (byKey.get(issuerKey(row.issuer)) || []).filter((h) => h.kind === "debt" && !h.src.table && isNum(h.cost));
    let best = null, bestGap = Infinity;
    for (const h of cands) {
      const gap = isNum(row.cost) ? Math.abs(h.cost - row.cost) / Math.max(Math.abs(row.cost), 1) : Infinity;
      if (gap < bestGap) { best = h; bestGap = gap; }
    }
    if (best && bestGap <= 0.05) { fill(best, row); nonAccrualIssuerPass++; }
    else stillUnmatched.push(row);
  }
  /* affiliation is a property of the portfolio company, not of the
     tranche (the 1940 Act's control and affiliate tests run on the
     issuer's voting securities), so a holding the table did not place
     takes the class its issuer's placed holdings all carry (PSEC's
     InterDent, Inc. and National Property REIT Corp. tranches under
     the 10-K's Control Investments section) */
  {
    const byIssuer = new Map();
    for (const h of holdings) {
      if (!h.aff) continue;
      const k = issuerKey(h.name || h.id || "");
      const set = byIssuer.get(k) || new Set();
      set.add(h.aff); byIssuer.set(k, set);
    }
    for (const h of holdings) {
      if (h.aff) continue;
      const set = byIssuer.get(issuerKey(h.name || h.id || ""));
      if (set && set.size === 1) { h.aff = [...set][0]; h.src.af = "issuer"; filled.aff++; filled.affByIssuer = (filled.affByIssuer || 0) + 1; }
    }
  }
  const unmatchedRows = stillUnmatched
    .sort((a, b) => Number(!!b.nonAccrual) - Number(!!a.nonAccrual))
    .map((r) => ({
      issuer: r.issuer, type: r.type || null, lien: r.section ? r.section.lien : null, industry: r.industry || null,
      nonAccrual: !!r.nonAccrual, maturity: r.maturity || null, principal: r.principal ?? null, cost: r.cost ?? null, fv: r.fv ?? null,
      page: r.page, src: "table",
    }));
  return {
    matched: join.matched.length + nonAccrualIssuerPass,
    stages: join.stages,
    rate: holdings.length ? round4((join.matched.length + nonAccrualIssuerPass) / holdings.length) : 0,
    unmatchedRows,
    nonAccrualUnmatched: unmatchedRows.filter((r) => r.nonAccrual).length,
    nonAccrualIssuerPass,
    filled,
  };
}

/* ---------- the table as the row source ---------- */

const CASH_SECTION_RE = /\bcash\b|money market|treasury/i;
/* a cash-equivalent line a filer keeps INSIDE its Total Investments:
   PNNT's $270M four-week Treasury bill under "US Government Securities -
   62.9 % of Net Assets" (10-Q for 2026-06-30). It must stay for the
   gate and stay out of every portfolio figure — typed "other" with
   cashEquivalent true, which toCreditHolding reads as not third-party. */
const CASH_EQUIVALENT_ROW_RE = /\btreasury (?:bills?|notes?|bonds?|fund|portfolio)\b|\bu\.?s\.? treasury\b|\bgovernment securities\b|\bmoney market\b/i;

/**
 * Holdings built from the HTML schedule's rows (src.row "table"), for a
 * filing whose tagged rows the gate refused because the filer tags an
 * unconsolidated vehicle's loans beside its own on the same axis
 * (PNNT and PFLT with PSSL, FSK with its joint venture, OBDC, CGBD,
 * WHF) while the printed schedule carries only its own. Rows under a
 * cash-equivalent section and rows with neither cost nor fair value
 * are left out, as the "Total Investments" line leaves them out;
 * everything else becomes a holding through the same normalizer the
 * tagged paths use, with the table's non-accrual footnote, maturity,
 * industry, section lien and affiliation on it. The gate then runs on
 * these rows exactly as on the tagged ones.
 */
export function holdingsFromTable(rows, { filerOverrides = null, scaleFix = 1 } = {}) {
  const out = [];
  let cashRows = 0, empty = 0;
  for (const r of rows || []) {
    /* the section decides: PNNT's Treasury bills sit under "US Government
       Securities" inside its Total Investments, its "Cash Equivalents"
       section outside it */
    if (r.section && r.section.lien && CASH_SECTION_RE.test(r.section.lien)) { cashRows++; continue; }
    if (!isNum(r.cost) && !isNum(r.fv)) { empty++; continue; }
    const typeText = r.type || (r.section && r.section.lien) || null;
    const rec = {
      id: `${r.issuer} | ${typeText || "investment"}${r.maturity ? " " + r.maturity : ""}`,
      aff: r.section && r.section.aff ? r.section.aff : (r.affNote || null),
      type: typeText,
      industry: r.industry || null,
      rate: isNum(r.rate) ? r.rate : null, spread: isNum(r.spread) ? r.spread : null,
      floor: isNum(r.floor) ? r.floor : null, pik: isNum(r.pik) ? r.pik : null,
      principal: isNum(r.principal) ? (r.units ? r.principal : round0(r.principal * scaleFix)) : null,
      cost: isNum(r.cost) ? round0(r.cost * scaleFix) : 0,
      fv: isNum(r.fv) ? round0(r.fv * scaleFix) : 0,
      pctNav: isNum(r.pctNav) ? r.pctNav : null,
      acquired: r.acquired || null,
      maturity: r.maturity || null,
    };
    const h = normalizeRow(rec, { source: "table", filerOverrides });
    if (CASH_EQUIVALENT_ROW_RE.test(r.issuer || "") || (r.section && r.section.lien && CASH_EQUIVALENT_ROW_RE.test(r.section.lien))) {
      h.kind = "other";
      h.cashEquivalent = true;
    }
    if (r.base && !h.base) h.base = r.base;
    h.floating = isNum(h.spread) || h.base !== null;
    if (r.nonAccrual) { h.nonAccrual = true; h.src.na = "table"; }
    if (h.maturity) h.src.mat = "table";
    if (h.industry) h.src.ind = "table";
    h.src.table = true;
    if (!isNum(r.cost)) h.costUntagged = true;
    if (!isNum(r.fv)) h.fvUntagged = true;
    out.push(h);
  }
  /* two tranches printed alike get a sequence, as the tagged ids do */
  const seen = new Map();
  for (const h of out) { const k = h.id; const c = (seen.get(k) || 0) + 1; seen.set(k, c); if (c > 1) h.id = `${k} ${c}`; }
  sanitizeRates(out);
  return { holdings: out, cashRows, empty };
}

/**
 * The printed fair value onto a tagged row whose fair value the filer
 * did not tag (a cost-only row: GECC's six, SCM's 28, RAND's twelve in
 * the August 2026 file), joined by issuer and principal, then cost, as
 * enrichFromTable joins. The row keeps fvUntagged and gains src.val
 * "table", so the page can say where the figure came from; the caller
 * runs the gate on the result, which for those three filers turns an
 * exact cost sum with a short fair-value sum into a passed gate.
 * Returns the count filled.
 */
export function fillFairValueFromTable(costOnlyRows, rows, { tolerance = 0.005, scaleFix = 1 } = {}) {
  if (!costOnlyRows.length || !rows.length) return 0;
  const scaled = (scaleFix === 1 ? rows : rows.map((r) => ({
    ...r,
    cost: isNum(r.cost) ? round0(r.cost * scaleFix) : r.cost,
    fv: isNum(r.fv) ? round0(r.fv * scaleFix) : r.fv,
    principal: isNum(r.principal) && !r.units ? round0(r.principal * scaleFix) : r.principal,
  }))).filter((r) => isNum(r.fv));
  const members = costOnlyRows.filter((h) => !isNum(h.fv) || h.fv === 0).map((h) => ({ id: h.id, issuer: h.name || h.id, principal: h.principal, cost: h.cost, fv: null, h }));
  const join = joinHoldings(members, scaled, { tolerance });
  let filled = 0;
  for (const m of join.matched) {
    const h = m.member.h;
    if (!isNum(m.row.fv)) continue;
    h.fv = m.row.fv;
    h.src.val = "table";
    filled++;
  }
  return filled;
}

/**
 * The printed schedule's rows that no tagged holding claims, as
 * holdings of their own (src.row "table"), for a filer whose tagged
 * rows fall short of its InvestmentOwnedAtCost because part of the
 * schedule is tagged without a per-position identifier — GBDC's
 * non-controlled affiliated equity (Chestnut Optical Midco's LLC
 * interest, $53.8M at cost, tagged only as an issuer-level fair value)
 * in the August 2026 file, $112M of the $8,377M total. Blueprint 7.3:
 * a row that does not match is kept with its columns and flagged
 * "table". The join is the one enrichFromTable runs (numbers first,
 * then issuer and principal, then cost), plus the issuer pass that
 * treats a row within 5% of an unclaimed holding of the same issuer as
 * that holding spelled differently, so a tranche the two sources name
 * apart is not counted twice. Rows under a cash-equivalent section and
 * rows with neither value are left out, as holdingsFromTable leaves
 * them out. The tagged holdings are not touched; the caller runs the
 * gate on the union and keeps it only when the union reconciles.
 */
export function tableOnlyHoldings(holdings, rows, { filerOverrides = null, tolerance = 0.005, scaleFix = 1 } = {}) {
  const scaled = scaleFix === 1 ? rows : rows.map((r) => ({
    ...r,
    cost: isNum(r.cost) ? round0(r.cost * scaleFix) : r.cost,
    fv: isNum(r.fv) ? round0(r.fv * scaleFix) : r.fv,
    principal: isNum(r.principal) && !r.units ? round0(r.principal * scaleFix) : r.principal,
  }));
  const members = holdings.map((h) => ({ id: h.id, issuer: h.name || h.id, principal: h.principal, cost: h.cost, fv: h.fv, h }));
  const join = joinWithNumbers(members, scaled, { tolerance });
  const claimed = new Set(join.matched.map((m) => m.member.h));
  const byKey = new Map();
  for (const h of holdings) {
    if (claimed.has(h)) continue;
    const k = issuerKey(h.name || h.id || "");
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(h);
  }
  let issuerPass = 0, cashRows = 0, empty = 0;
  const candidates = [];
  for (const row of join.unmatchedRows) {
    if (row.section && row.section.lien && CASH_SECTION_RE.test(row.section.lien)) { cashRows++; continue; }
    if (!isNum(row.cost) && !isNum(row.fv)) { empty++; continue; }
    const cands = byKey.get(issuerKey(row.issuer || "")) || [];
    let best = null, bestGap = Infinity;
    for (const h of cands) {
      if (claimed.has(h) || !isNum(h.cost)) continue;
      const gap = isNum(row.cost) ? Math.abs(h.cost - row.cost) / Math.max(Math.abs(row.cost), 1) : Infinity;
      if (gap < bestGap) { best = h; bestGap = gap; }
    }
    if (best && bestGap <= 0.05) { claimed.add(best); issuerPass++; continue; }
    candidates.push(row);
  }
  const tb = holdingsFromTable(candidates, { filerOverrides, scaleFix: 1 });
  return { holdings: tb.holdings, matched: join.matched.length + issuerPass, issuerPass, unmatched: join.unmatchedRows.length, cashRows, empty: empty + tb.empty };
}

/**
 * The tagged rows (data set or instance) joined onto table-sourced
 * holdings for the facts the table prints loosely or not at all — the
 * spread and rate as tagged, the principal, % of net assets, the
 * acquisition date, the unfunded commitment — and the tagged member
 * text as the holding's id, so the R page joins on it. Fills only what
 * the table row lacks; stamps src.ds on the rows that matched.
 */
export function fillFromTagged(tableHoldings, taggedRows, { tolerance = 0.005 } = {}) {
  const members = taggedRows.map((h) => ({ id: h.id, issuer: h.name || h.id, principal: h.principal, cost: h.cost, fv: h.fv, h }));
  const rows = tableHoldings.map((h) => ({ issuer: h.name || h.id, principal: h.principal, cost: h.cost, fv: h.fv, units: false, nonAccrual: h.nonAccrual === true, h }));
  const join = joinWithNumbers(members, rows, { tolerance });
  let filled = 0;
  for (const m of join.matched) {
    const t = m.row.h, d = m.member.h;
    t.id = d.id;
    t.src.ds = d.src.row;
    for (const k of ["rate", "spread", "floor", "pik", "principal", "pctNav", "unfunded"]) {
      if (!isNum(t[k]) && isNum(d[k])) t[k] = d[k];
    }
    if (!t.base && d.base) t.base = d.base;
    if (!t.acquired && d.acquired) t.acquired = d.acquired;
    if (!t.maturity && d.maturity) { t.maturity = d.maturity; t.src.mat = d.src.mat; }
    if (!t.industry && d.industry) { t.industry = d.industry; t.src.ind = d.src.ind; }
    if (!t.aff && d.aff) t.aff = d.aff;
    /* a non-accrual mark the tagged identifier carries ("... |
       Non-accrual status", NMFC's August 2026 members) is never dropped
       for a filing served from the printed schedule (blueprint 7.3) */
    if (d.nonAccrual === true && t.nonAccrual !== true) { t.nonAccrual = true; t.src.na = d.src.na && d.src.na !== "none" ? d.src.na : "id"; }
    if (!t.lien.class && d.lien.class) { t.lien = { ...d.lien }; }
    if (d.units) t.units = d.units;
    if (isNum(d.unfunded)) t.src.unf = d.src.unf;
    t.floating = isNum(t.spread) || t.base !== null;
    filled++;
  }
  return { matched: filled, stages: join.stages, rate: tableHoldings.length ? round4(filled / tableHoldings.length) : 0, unmatchedTagged: join.unmatchedMembers.length };
}

/**
 * The rendered R page's rows joined to the holdings: by the member
 * text, which is the identifier the data set and the instance carry
 * (ARCC's 1,439 positions match 1,439 for 1,439 on the July file),
 * then by issuer key and principal or cost for a filer whose two
 * sources spell a member differently. Fills industry and the
 * non-accrual mark only, which is what the page is a second source
 * for (blueprint 7.3); the industry totals the page carries beside the
 * rows are returned for the sector mix of a filer whose members are
 * not nested under an industry.
 */
export function enrichFromRPage(holdings, rpage, { tolerance = 0.005, fillNa = true, fillInd = true } = {}) {
  const byId = new Map(holdings.map((h) => [h.id, h]));
  const filled = { na: 0, ind: 0 };
  let exact = 0;
  const rest = [];
  for (const row of rpage.rows || []) {
    const h = byId.get(row.member);
    if (!h) { rest.push(row); continue; }
    exact++;
    fillR(h, row, filled, fillNa, fillInd);
  }
  let joined = 0;
  if (rest.length) {
    const open = holdings.filter((h) => !h.src.r);
    const members = open.map((h) => ({ id: h.id, issuer: h.name || h.id, principal: h.principal, cost: h.cost, fv: h.fv, h }));
    const j = joinWithNumbers(members, rest, { tolerance });
    for (const m of j.matched) { fillR(m.member.h, m.row, filled, fillNa, fillInd); joined++; }
  }
  return { exact, joined, matched: exact + joined, rows: (rpage.rows || []).length, filled,
           industries: rpage.industries || [], issuers: rpage.issuers || [] };
}
/* fillNa false: the printed schedule already carried the non-accrual
   footnotes, and the page's XBRL markers can renumber against the
   print (PSBD's [7] is "non-accrual" on the R page and "held within
   Palmer Square BDC Funding II" in the main document), so the page is
   consulted only where the table gave nothing. Same for industry. */
function fillR(h, row, filled, fillNa = true, fillInd = true) {
  h.src.r = true;
  if (fillNa && row.nonAccrual && h.nonAccrual !== true) { h.nonAccrual = true; h.src.na = "rpage"; filled.na++; }
  else if (row.nonAccrual && h.nonAccrual === true && h.src.na === "none") h.src.na = "rpage";
  if (fillInd && !h.industry && row.industry) { h.industry = row.industry; h.src.ind = "rpage"; filled.ind++; }
}

/* ---------- the per-filer summary ---------- */

/* 50 bps buckets over the base rate, in bps: "450-500" … "1000+". */
export const SPREAD_BUCKET_BPS = 50;
export const SPREAD_BUCKET_MAX = 1000;
export function spreadBucket(spread) {
  if (!isNum(spread)) return null;
  const bps = spread * 10000;
  if (bps >= SPREAD_BUCKET_MAX) return `${SPREAD_BUCKET_MAX}+`;
  if (bps < 0) return "<0";
  const lo = Math.floor(bps / SPREAD_BUCKET_BPS) * SPREAD_BUCKET_BPS;
  return `${lo}-${lo + SPREAD_BUCKET_BPS}`;
}
export function spreadBucketOrder() {
  const out = [];
  for (let lo = 0; lo < SPREAD_BUCKET_MAX; lo += SPREAD_BUCKET_BPS) out.push(`${lo}-${lo + SPREAD_BUCKET_BPS}`);
  out.push(`${SPREAD_BUCKET_MAX}+`);
  return out;
}

/**
 * The spread histogram of floating third-party debt: share of holdings
 * (byCount) and share of cost (byCost) per 50 bps bucket, over
 * holdings carrying a spread fact. Buckets without mass are omitted.
 */
export function spreadHistogram(credit) {
  const byCount = {}, byCost = {};
  let n = 0, cost = 0;
  for (const c of credit) {
    if (!isThirdPartyDebt(c) || !isNum(c.spread) || !isNum(c.cost)) continue;
    const b = spreadBucket(c.spread);
    byCount[b] = (byCount[b] || 0) + 1;
    byCost[b] = (byCost[b] || 0) + c.cost;
    n++; cost += c.cost;
  }
  const order = ["<0", ...spreadBucketOrder()];
  const out = { byCount: {}, byCost: {}, n, cost: round0(cost) };
  for (const b of order) {
    if (byCount[b]) { out.byCount[b] = share(byCount[b], n); out.byCost[b] = share(byCost[b], cost); }
  }
  return out;
}

/* Σ cost of third-party debt by lien class, with the two first-lien
   classes reported apart and together, on two denominators: `share`
   over the cost of third-party debt (blueprint 4.2's "computed on
   third-party debt only") and `shareOfPortfolio` over the tagged
   portfolio cost, the lien-mix row's own example (GBDC: one stop
   $7,288.8M of $8,377.1M = 87.0%, senior secured 4.7%, first lien
   incl. one stop about 92%). */
export function lienMix(credit, portfolioCost = null) {
  const sums = {};
  let total = 0;
  for (const c of credit) {
    if (!isThirdPartyDebt(c) || !isNum(c.cost)) continue;
    const k = c.lien || "unclassified";
    sums[k] = (sums[k] || 0) + c.cost;
    total += c.cost;
  }
  const denom = isNum(portfolioCost) && portfolioCost > 0 ? portfolioCost : null;
  const classes = {};
  for (const k of [...RTCredit.LIEN_CLASSES, "unclassified"]) {
    if (sums[k]) classes[k] = { cost: round0(sums[k]), share: share(sums[k], total), shareOfPortfolio: denom ? share(sums[k], denom) : null };
  }
  const first = (sums[LIEN.FIRST] || 0) + (sums[LIEN.FIRST_UNITRANCHE] || 0);
  const unclassifiedShare = total ? share(sums.unclassified || 0, total) : null;
  /* a book whose labels the map mostly could not read (TPVG's "Growth
     Capital Loan", TRIN's blank type column) has an UNKNOWN first-lien
     share, not a zero: the blueprint's rule is never zeros for unparsed
     fields, so above half unclassified the share is withheld and
     unclassifiedShare says why */
  const readable = unclassifiedShare === null || unclassifiedShare <= 0.5;
  return {
    classes, total: round0(total), portfolioCost: denom ? round0(denom) : null,
    firstLienShare: total && readable ? share(first, total) : null,
    firstLienShareOfPortfolio: denom && readable ? share(first, denom) : null,
    unclassifiedShare,
  };
}

/* Σ fair value by industry over the whole portfolio, the ten largest
   named, the rest as "other", the unlabelled as "n/a". */
export function industryMix(holdings, portfolioFv, { top = 10 } = {}) {
  const sums = new Map();
  let na = 0, total = 0;
  for (const h of holdings) {
    if (!isNum(h.fv)) continue;
    total += h.fv;
    if (!h.industry) { na += h.fv; continue; }
    sums.set(h.industry, (sums.get(h.industry) || 0) + h.fv);
  }
  const denom = isNum(portfolioFv) ? portfolioFv : total;
  const sorted = [...sums.entries()].sort((a, b) => b[1] - a[1]);
  const rows = sorted.slice(0, top).map(([name, fv]) => ({ name, fv: round0(fv), share: share(fv, denom) }));
  const other = sorted.slice(top).reduce((s, [, fv]) => s + fv, 0);
  if (other) rows.push({ name: "other", fv: round0(other), share: share(other, denom) });
  if (na) rows.push({ name: "n/a", fv: round0(na), share: share(na, denom) });
  return rows;
}

/* Σ fair value by affiliation class. */
export function affiliationMix(holdings, portfolioFv) {
  const sums = {};
  let total = 0;
  for (const h of holdings) {
    if (!isNum(h.fv)) continue;
    const k = h.aff || "n/a";
    sums[k] = (sums[k] || 0) + h.fv;
    total += h.fv;
  }
  const denom = isNum(portfolioFv) ? portfolioFv : total;
  const out = {};
  for (const [k, v] of Object.entries(sums)) out[k] = { fv: round0(v), share: share(v, denom) };
  return out;
}

/* The wall as H2 writes it: cost of third-party debt per LCD bucket,
   "n/a" for debt without a maturity, unfunded balances beside it. */
export function maturityWall(credit) {
  const w = RTCredit.maturityBuckets(credit);
  const out = {};
  for (const b of RTCredit.MATURITY_BUCKETS) out[b.label] = 0;
  /* third-party debt the wall leaves out by credit.js's rule: a CLO or
     CMBS tranche, a loan whose tagged type reads as equity or a
     vehicle, or an undated negative cost (a netted receivable that
     would drag "n/a" below zero); reported so the wall always adds
     back to the debt cost. The CLO test is credit.js's own — word
     bounds on the normalized label — never a looser copy that would
     trip on "Closing" or "Cloud". */
  const yearOf = (m) => {
    if (isNum(m)) return m >= 1900 ? Math.floor(m) : null;
    const mm = /(\d{4})/.exec(String(m || ""));
    return mm ? Number(mm[1]) : null;
  };
  let excluded = 0, all = 0;
  for (const c of credit) {
    if (!isThirdPartyDebt(c) || !isNum(c.cost)) continue;
    all += c.cost;
    if (c.lien === LIEN.EQUITY || c.lien === LIEN.VEHICLES || /\b(clo|cmbs)\b/.test(RTCredit.normalizeLabel(c.rawLabel))) excluded += c.cost;
    else if (c.cost < 0 && yearOf(c.maturity) === null) excluded += c.cost;
  }
  if (!w) {
    return { ...out, "n/a": round0(all - excluded), excluded: round0(excluded), total: round0(all), dated: 0, unfunded: null, shares: null };
  }
  for (const b of w.buckets) out[b.label] = round0(b.cost);
  const shares = {};
  for (const b of w.buckets) shares[b.label] = round4(b.share);
  return { ...out, "n/a": round0(w.noMaturity), excluded: round0(excluded), total: round0(w.total + w.noMaturity + excluded), dated: round0(w.total), unfunded: round0(w.unfunded), shares };
}

/**
 * The summary block of holdings-<TICKER>.json. `portfolioCost` and
 * `portfolioFv` are the tagged totals the gate reconciled against;
 * `prose` is extractProse's result, whose disclosed yield, floating
 * share, non-accrual rates and portfolio-company count ride along as
 * the cross-check beside the computed figure (blueprint 4.2: computed
 * and disclosed are compared, never merged).
 */
export function summarizeHoldings(holdings, { portfolioCost = null, portfolioFv = null, prose = null } = {}) {
  const credit = creditHoldings(holdings);
  const debt = credit.filter(isThirdPartyDebt);
  const thirdPartyDebtCost = debt.reduce((s, c) => s + (isNum(c.cost) ? c.cost : 0), 0);
  const thirdPartyDebtFv = debt.reduce((s, c) => s + (isNum(c.fv) ? c.fv : 0), 0);
  const issuers = new Set();
  for (const c of credit) if (isThirdParty(c) && c.company) issuers.add(c.company);
  const debtIssuers = new Set();
  for (const c of debt) if (c.company) debtIssuers.add(c.company);

  const naSource = holdings.some((h) => h.src && h.src.na && h.src.na !== "none") ||
    holdings.some((h) => h.nonAccrual === true);
  const na = RTCredit.nonAccrualTotals(credit);
  const nonAccrual = {
    cost: round0(na.cost), fv: round0(na.fv), n: na.loans, issuers: na.issuers,
    ofTotalCost: share(na.cost, portfolioCost), ofTotalFv: share(na.fv, portfolioFv),
    ofDebtCost: share(na.cost, thirdPartyDebtCost), ofDebtFv: share(na.fv, thirdPartyDebtFv),
    source: naSource ? [...new Set(holdings.filter((h) => h.nonAccrual === true).map((h) => h.src.na))].sort().join(",") || "none" : null,
  };
  if (!naSource) nonAccrual.note = "no source read a non-accrual mark for this filing: rates are not zero, they are unknown";

  const wa = {
    yieldAtCost: round4(RTCredit.weightedAverageYield(credit, "cost")),
    yieldAtFv: round4(RTCredit.weightedAverageYield(credit, "fv")),
    spreadCostWeighted: round4(RTCredit.spreadCostWeighted(credit)),
    floatingShare: round4(RTCredit.floatingShare(credit)),
    pikContractual: null,
    n: { yield: debt.filter((c) => c.accruing !== false && isNum(c.principal) && isNum(c.rate) && isNum(c.cost)).length,
         spread: debt.filter((c) => isNum(c.spread) && isNum(c.cost)).length,
         debt: debt.length },
  };
  /* the coverage floor: a yield from a handful of tagged rates (OBDC's
     August 2026 rows carry one rate on 265 accruing loans, 1% of cost)
     is not the book's yield. The rows with a principal and a rate must
     carry at least 80% of accruing third-party debt cost, else the
     figure is withheld and yieldCoverage says how far short it fell. */
  {
    const accruing = debt.filter((c) => c.accruing !== false && isNum(c.cost));
    const covered = accruing.filter((c) => isNum(c.principal) && isNum(c.rate));
    const den = accruing.reduce((s, c) => s + c.cost, 0);
    wa.yieldCoverage = den > 0 ? round4(covered.reduce((s, c) => s + c.cost, 0) / den) : null;
    if (wa.yieldCoverage !== null && wa.yieldCoverage < 0.8) {
      wa.yieldAtCost = null;
      wa.yieldAtFv = null;
      wa.yieldNote = `withheld: rows with a tagged principal and rate carry ${Math.round(wa.yieldCoverage * 1000) / 10}% of accruing third-party debt cost, under the 80% floor`;
    }
  }
  /* a floating share of exactly zero with no spread fact and no base
     label anywhere is rate information ABSENT, not a fixed-rate book
     (GAIN's tagged rows carry neither, while its 10-Q says 100%
     variable): the figure is withheld, never served as 0 */
  if (wa.floatingShare === 0 && wa.n.spread === 0 && !debt.some((c) => c.floating === true)) {
    wa.floatingShare = null;
    wa.floatingNote = "withheld: no spread fact and no base-rate label on any debt row — rate type is unread, not fixed";
  }
  /* contractual PIK share of interest: Σ principal × PIK rate over Σ
     principal × all-in rate on accruing third-party debt — the
     schedule's own measure, not the income statement's */
  {
    let pik = 0, all = 0, any = false;
    holdings.forEach((h, i) => {
      const c = credit[i];
      if (!isThirdPartyDebt(c) || c.accruing === false || !isNum(h.principal) || !isNum(h.rate)) return;
      all += h.principal * h.rate;
      if (isNum(h.pik)) pik += h.principal * h.pik;
      any = true;
    });
    wa.pikContractual = any && all ? round4(pik / all) : null;
  }

  const lien = lienMix(credit, portfolioCost);
  const wall = maturityWall(credit);
  const vehicles = holdings.filter((h) => h.kind === "vehicle").reduce((s, h) => s + (isNum(h.fv) ? h.fv : 0), 0);
  const structured = holdings.filter((h) => h.kind === "structured").reduce((s, h) => s + (isNum(h.fv) ? h.fv : 0), 0);
  const equity = holdings.filter((h) => h.kind === "equity").reduce((s, h) => s + (isNum(h.fv) ? h.fv : 0), 0);
  const top10 = RTCredit.top10Concentration(credit, portfolioFv);
  const top10Fv = (() => {
    const by = {};
    for (const c of credit) if (isThirdParty(c) && c.company && isNum(c.fv)) by[c.company] = (by[c.company] || 0) + c.fv;
    return Object.values(by).sort((a, b) => b - a).slice(0, 10).reduce((s, v) => s + v, 0);
  })();
  const unfunded = holdings.reduce((s, h) => s + (isNum(h.unfunded) ? h.unfunded : 0), 0);
  const pikLoans = holdings.filter((h) => isNum(h.pik) && h.pik > 0);

  const p = (f) => (prose && f && isNum(f.v) ? f.v : null);
  const vsProse = prose ? {
    yieldAtCost: p(prose.waYieldAtCost) === null ? null : round4(p(prose.waYieldAtCost) / 100),
    yieldAtFv: p(prose.waYieldAtFv) === null ? null : round4(p(prose.waYieldAtFv) / 100),
    floatingShare: p(prose.floatingShare) === null ? null : round4(p(prose.floatingShare) / 100),
    /* the basis the sentence states, carried so the page never sets a
       share of third-party debt cost beside a share of total
       investments at fair value without saying so (ARCC's 71% is "of
       the investments at fair value in our portfolio") */
    floatingShareBasis: prose.floatingShare && prose.floatingShare.basis ? { of: prose.floatingShare.basis.of || null, at: prose.floatingShare.basis.at || null } : null,
    nonAccrualCost: p(prose.nonAccrualCostPct) === null ? null : round4(p(prose.nonAccrualCostPct) / 100),
    nonAccrualFv: p(prose.nonAccrualFvPct) === null ? null : round4(p(prose.nonAccrualFvPct) / 100),
    nonAccrualOf: prose.nonAccrualCostPct && prose.nonAccrualCostPct.of || (prose.nonAccrualFvPct && prose.nonAccrualFvPct.of) || null,
    portfolioCompanies: p(prose.portfolioCompanies),
  } : null;

  /* ---- computed against disclosed (blueprint 4.2): acted on, not
     just recorded. A figure the filing itself contradicts is withheld
     (the flag says why, the vsProse block keeps both numbers) so the
     composite's n never counts a number the filer denies. ---- */
  const flags = [];
  const flag = (figure, computed, disclosed, note) => flags.push({ figure, computed, disclosed, note });
  /* non-accrual: a filing that states the rate — on the matching basis
     — within 1 point confirms the read; further apart, the computed
     figure is withheld (OFS reads 0.41% of FV against its stated 7.2%:
     the table reader missed its markers). A share above 25% of cost is
     implausible on its face (PSEC's PIK footnotes once read as
     non-accrual marks put 44% of the book on non-accrual against the
     10-K's $298.2M). */
  if (nonAccrual.source) {
    const naOf = vsProse && vsProse.nonAccrualOf;
    const compCost = naOf === "debt" ? nonAccrual.ofDebtCost : nonAccrual.ofTotalCost;
    const compFv = naOf === "debt" ? nonAccrual.ofDebtFv : nonAccrual.ofTotalFv;
    const badCost = vsProse && isNum(vsProse.nonAccrualCost) && isNum(compCost) && Math.abs(compCost - vsProse.nonAccrualCost) > 0.01;
    const badFv = vsProse && isNum(vsProse.nonAccrualFv) && isNum(compFv) && Math.abs(compFv - vsProse.nonAccrualFv) > 0.01;
    const implausible = isNum(nonAccrual.ofTotalCost) && nonAccrual.ofTotalCost > 0.25;
    if (badCost || badFv || implausible) {
      flag("nonAccrual", { cost: compCost, fv: compFv },
        vsProse ? { cost: vsProse.nonAccrualCost, fv: vsProse.nonAccrualFv, of: naOf } : null,
        implausible && !badCost && !badFv
          ? "withheld: above 25% of cost, implausible on its face"
          : "withheld: more than 1 point from the filing's own sentence on the same basis");
      nonAccrual.source = null;
      nonAccrual.note = "withheld (see flags): the computed figure disagrees with the filing's own disclosure; the rows keep their marks for audit";
    }
  } else if (vsProse && vsProse.nonAccrualCost === 0 && vsProse.nonAccrualFv === 0 && nonAccrual.n === 0) {
    /* "no investments on non-accrual status" is a true zero (LIEN's
       10-Q), which counts in the composite's n */
    Object.assign(nonAccrual, { cost: 0, fv: 0, ofTotalCost: 0, ofTotalFv: 0, ofDebtCost: 0, ofDebtFv: 0, source: "prose" });
    delete nonAccrual.note;
  }
  /* yield: the schedule's contractual figure runs 0-0.3 points under
     the disclosed one (OID accretion is untagged); half a point apart
     means the rates read are not the book's */
  if (vsProse && isNum(wa.yieldAtCost) && isNum(vsProse.yieldAtCost) && Math.abs(wa.yieldAtCost - vsProse.yieldAtCost) > 0.005) {
    flag("yieldAtCost", wa.yieldAtCost, vsProse.yieldAtCost, "withheld: more than half a point from the filing's stated weighted-average yield at cost");
    wa.yieldAtCost = null;
    wa.yieldAtFv = null;
  }
  /* portfolio-company count: a computed count more than 25% from the
     filing's own says the issuer names did not split; count and top-10
     rest on those names and are withheld together */
  let countOut = issuers.size, top10Out = { fv: round0(top10Fv), share: round4(top10) };
  const unsplit = holdings.filter(unsplitName).length;
  const proseCount = vsProse && vsProse.portfolioCompanies;
  /* the filing counts every portfolio company, controlled ones and
     vehicles included (PSEC's "91 portfolio companies" is 91 distinct
     issuers on its schedule, 72 of them third-party), so the prose is
     compared with the count over every issuer; the served count stays
     the third-party one of H2 */
  const allIssuers = new Set();
  for (const c of credit) if (c.company) allIssuers.add(c.company);
  if (isNum(proseCount) && proseCount > 0 && Math.abs(allIssuers.size - proseCount) / proseCount > 0.25) {
    flag("count", allIssuers.size, proseCount, "withheld with top10: more than 25% from the filing's stated portfolio-company count (compared over every issuer, controlled ones included)");
    countOut = null; top10Out = { fv: null, share: null };
  } else if (holdings.length >= 20 && unsplit > 0.25 * holdings.length) {
    flag("count", issuers.size, proseCount ?? null, `withheld with top10: ${unsplit} of ${holdings.length} names unsplit`);
    countOut = null; top10Out = { fv: null, share: null };
  }

  return {
    portfolioCost: round0(portfolioCost), portfolioFv: round0(portfolioFv),
    holdings: holdings.length,
    thirdPartyDebtCost: round0(thirdPartyDebtCost), thirdPartyDebtFv: round0(thirdPartyDebtFv),
    thirdPartyDebtHoldings: debt.length,
    count: countOut, countAll: allIssuers.size, countDebt: debtIssuers.size,
    /* rows whose issuer name is the whole member text (a shape the
       splitter did not know and no printed row named): each counts as
       an issuer of its own above, so the count overstates by up to this
       many */
    namesUnsplit: unsplit,
    nonAccrual,
    wa,
    lien: { classes: lien.classes, total: lien.total, portfolioCost: lien.portfolioCost, firstLienShare: lien.firstLienShare,
            firstLienShareOfPortfolio: lien.firstLienShareOfPortfolio, unclassifiedShare: lien.unclassifiedShare },
    industry: industryMix(holdings, portfolioFv),
    industrySource: [...new Set(holdings.filter((h) => h.industry).map((h) => h.src.ind))].sort().join(",") || null,
    maturity: wall,
    maturitySource: [...new Set(holdings.filter((h) => h.maturity).map((h) => h.src.mat))].sort().join(",") || null,
    vehicles: { fv: round0(vehicles), share: share(vehicles, portfolioFv) },
    structured: { fv: round0(structured), share: share(structured, portfolioFv) },
    equity: { fv: round0(equity), share: share(equity, portfolioFv) },
    top10: top10Out,
    /* null, not {"n/a": 100%}, when no source classified any row: an
       unclassified split is unknown, and ARCC's July data set fills
       its affiliation axis on six aggregate rows only */
    affiliation: holdings.some((h) => h.aff) ? affiliationMix(holdings, portfolioFv) : null,
    /* which classes a source resolved, and where they came from (the
       axis, a section heading, a footnote or the issuer's other
       tranches), so the page can say "vehicles by name" where the
       axis is silent and the split is partial */
    affiliationClasses: [...new Set(holdings.filter((h) => h.aff).map((h) => h.aff))].sort(),
    affiliationSource: [...new Set(holdings.filter((h) => h.aff).map((h) => h.src.af || (h.src.row === "table" ? "table" : (h.src.table ? "table" : h.src.row))))].sort().join(",") || null,
    unfunded: { total: round0(unfunded), holdings: holdings.filter((h) => isNum(h.unfunded)).length },
    pik: { holdings: pikLoans.length, cost: round0(pikLoans.reduce((s, h) => s + (isNum(h.cost) ? h.cost : 0), 0)) },
    histogram: spreadHistogram(credit),
    vsProse,
    ...(flags.length ? { flags } : {}),
  };
}

/* ---------- the composite ---------- */

export function dispersion(values) {
  const v = values.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return { min: null, p25: null, median: null, p75: null, max: null, n: 0 };
  const q = (p) => {
    const pos = (v.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return round4(v[lo] + (v[hi] - v[lo]) * (pos - lo));
  };
  return { min: round4(v[0]), p25: q(0.25), median: q(0.5), p75: q(0.75), max: round4(v[v.length - 1]), n: v.length };
}

/* Calendar-quarter label of a period end: 2026-06-30 → CY2026Q2;
   SAR's 2026-05-31 → CY2026Q2, the quarter its end date falls in. */
export const quarterLabel = (end) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(end || ""));
  return m ? `CY${m[1]}Q${Math.ceil(Number(m[2]) / 3)}` : null;
};

/**
 * The composite total-investment-income yield on average cost: per
 * calendar quarter, Σ GrossInvestmentIncomeOperating (three months) ÷
 * Σ average of this and the prior quarter's InvestmentOwnedAtCost,
 * ×4, across the filers carrying both; n per point. The tag is the
 * whole top line (interest, dividends, fees, PIK, other), so the
 * series is named for what it is. `companies` are the company files.
 */
export function tiiYieldSeries(companies, { quarters = 16 } = {}) {
  const points = new Map();
  for (const c of companies) {
    const periods = (c.series && c.series.periods) || [];
    for (let i = 1; i < periods.length; i++) {
      const p = periods[i], prev = periods[i - 1];
      const tii = p.values.totalInvestmentIncome, cost = p.values.portfolioCost, costPrev = prev.values.portfolioCost;
      if (!tii || !cost || !costPrev) continue;
      if (tii.tag !== "GrossInvestmentIncomeOperating") continue;
      if (tii.periodType !== "3M") continue;
      const label = quarterLabel(p.end);
      if (!label) continue;
      const avg = RTCredit.avg(cost.v, costPrev.v);
      if (!isNum(avg) || avg <= 0 || !isNum(tii.v)) continue;
      const pt = points.get(label) || { quarter: label, tii: 0, avgCost: 0, n: 0, tickers: [] };
      pt.tii += tii.v; pt.avgCost += avg; pt.n++; pt.tickers.push(c.ticker);
      points.set(label, pt);
    }
  }
  const labels = [...points.keys()].sort();
  return labels.slice(-quarters).map((l) => {
    const pt = points.get(l);
    return { quarter: l, yield: round4(4 * pt.tii / pt.avgCost), tii: round0(pt.tii), avgCost: round0(pt.avgCost), n: pt.n };
  });
}

const latestOf = (company, key) => {
  const v = company && company.series && company.series.latest && company.series.latest[key];
  return v && isNum(v.v) ? v : null;
};
const periodValue = (company, key, end) => {
  const p = ((company && company.series && company.series.periods) || []).find((x) => x.end === end);
  const v = p && p.values[key];
  return v && isNum(v.v) ? v : null;
};
const priorPeriodValue = (company, key, end) => {
  const periods = (company && company.series && company.series.periods) || [];
  const i = periods.findIndex((x) => x.end === end);
  const p = i > 0 ? periods[i - 1] : null;
  const v = p && p.values[key];
  return v && isNum(v.v) ? v : null;
};

/**
 * composite.json. `filers` is one entry per BDC whose gate passed:
 * { ticker, period, holdings (H1 rows), summary (summarizeHoldings),
 * company (the company file), disclosed (the company file's disclosed
 * block, for the resolved asset coverage) }. `allCompanies` is every
 * company file in the universe, for the income-yield series, which
 * needs no schedule.
 */
export function buildComposite(filers, { allCompanies = [], quarter = null, generated = null } = {}) {
  const members = filers.map((f) => f.ticker).sort();
  const pooled = [];
  const perFiler = [];
  let totalFv = 0, totalCost = 0, totalThirdPartyDebtCost = 0;
  const weightsOf = new Map();
  for (const f of filers) {
    const credit = creditHoldings(f.holdings);
    for (const c of credit) pooled.push(c);
    const s = f.summary;
    totalFv += s.portfolioFv || 0;
    totalCost += s.portfolioCost || 0;
    totalThirdPartyDebtCost += s.thirdPartyDebtCost || 0;
    weightsOf.set(f.ticker, s.thirdPartyDebtCost || 0);
    const co = f.company;
    const end = f.period;
    const debt = periodValue(co, "debt", end), netAssets = periodValue(co, "netAssets", end), netAssetsPrev = priorPeriodValue(co, "netAssets", end);
    const totalExpenses = periodValue(co, "totalExpenses", end), interestExpense = periodValue(co, "interestExpense", end);
    const tii = periodValue(co, "totalInvestmentIncome", end);
    const pikI = periodValue(co, "pikInterestIncome", end), pikD = periodValue(co, "pikDividendIncome", end), pikC = periodValue(co, "pikIncomeCombined", end);
    const pikIncome = pikC ? pikC.v : (pikI || pikD ? (pikI ? pikI.v : 0) + (pikD ? pikD.v : 0) : null);
    const ac = f.disclosed && f.disclosed.assetCoverage && isNum(f.disclosed.assetCoverage.v) ? f.disclosed.assetCoverage.v
      : (periodValue(co, "assetCoverage", end) ? periodValue(co, "assetCoverage", end).v : null);
    const k = totalExpenses && totalExpenses.periodType === "3M" ? 4 : (totalExpenses && totalExpenses.periodType === "YTD" ? null : 4);
    perFiler.push({
      ticker: f.ticker, w: s.thirdPartyDebtCost || 0,
      yieldAtCost: s.wa.yieldAtCost, yieldAtFv: s.wa.yieldAtFv, spreadCostWeighted: s.wa.spreadCostWeighted, floatingShare: s.wa.floatingShare,
      nonAccrualCost: s.nonAccrual.source ? s.nonAccrual.ofTotalCost : null,
      nonAccrualFv: s.nonAccrual.source ? s.nonAccrual.ofTotalFv : null,
      nonAccrualCostDollars: s.nonAccrual.source ? s.nonAccrual.cost : null,
      nonAccrualFvDollars: s.nonAccrual.source ? s.nonAccrual.fv : null,
      portfolioCost: s.portfolioCost, portfolioFv: s.portfolioFv,
      fvOverCost: RTCredit.mark(s.portfolioFv, s.portfolioCost),
      firstLienShare: s.lien.firstLienShare, firstLienShareOfPortfolio: s.lien.firstLienShareOfPortfolio, top10: s.top10.share, vehicleShare: s.vehicles.share,
      pikContractual: s.wa.pikContractual,
      debt: debt ? debt.v : null, netAssets: netAssets ? netAssets.v : null,
      debtToEquity: RTCredit.debtToEquity(debt ? debt.v : null, netAssets ? netAssets.v : null),
      assetCoverage: RTCredit.asRatio(ac),
      opexRatio: k ? RTCredit.operatingExpenseRatio(totalExpenses ? totalExpenses.v : null, interestExpense ? interestExpense.v : null,
        RTCredit.avg(netAssets ? netAssets.v : null, netAssetsPrev ? netAssetsPrev.v : null), k) : null,
      tii: tii && tii.tag === "GrossInvestmentIncomeOperating" && tii.periodType === "3M" ? tii.v : null,
      pikIncome: isNum(pikIncome) ? pikIncome : null,
      pikShareOfTotal: tii && tii.tag === "GrossInvestmentIncomeOperating" && isNum(pikIncome) ? RTCredit.pikShareOfTotal(pikIncome, tii.v) : null,
    });
  }

  /* pooled ratios: the dollars of every member summed, which is the
     cost-weighted mean by construction */
  const n = {};
  const weighted = {};
  const pooledN = (key, test) => filers.filter((f) => test(f.summary)).length;
  /* the yield pool holds only members whose own yield passed the
     coverage floor, so the composite never averages in a filer whose
     rates the sources barely tagged */
  {
    const yieldPool = [];
    for (const f of filers) {
      if (!isNum(f.summary.wa.yieldAtCost)) continue;
      for (const c of creditHoldings(f.holdings)) yieldPool.push(c);
    }
    weighted.yieldAtCost = round4(RTCredit.weightedAverageYield(yieldPool, "cost"));
    weighted.yieldAtFv = round4(RTCredit.weightedAverageYield(yieldPool, "fv"));
  }
  n.yieldAtCost = pooledN("yieldAtCost", (s) => isNum(s.wa.yieldAtCost));
  n.yieldAtFv = pooledN("yieldAtFv", (s) => isNum(s.wa.yieldAtFv));
  weighted.spreadCostWeighted = round4(RTCredit.spreadCostWeighted(pooled));
  n.spreadCostWeighted = pooledN("spread", (s) => isNum(s.wa.spreadCostWeighted));
  /* the floating pool holds only members whose own share is served: a
     filer whose rate type is unread (GAIN, PIAC — no spread facts, no
     base labels) would otherwise sit in the denominator as fixed */
  {
    const floatingPool = [];
    for (const f of filers) {
      if (!isNum(f.summary.wa.floatingShare)) continue;
      for (const c of creditHoldings(f.holdings)) floatingPool.push(c);
    }
    weighted.floatingShare = round4(RTCredit.floatingShare(floatingPool));
  }
  n.floatingShare = pooledN("floating", (s) => isNum(s.wa.floatingShare));
  const naFilers = perFiler.filter((p) => isNum(p.nonAccrualCostDollars) && isNum(p.portfolioCost));
  weighted.nonAccrualCost = share(naFilers.reduce((s, p) => s + p.nonAccrualCostDollars, 0), naFilers.reduce((s, p) => s + p.portfolioCost, 0));
  n.nonAccrualCost = naFilers.length;
  const naFvFilers = perFiler.filter((p) => isNum(p.nonAccrualFvDollars) && isNum(p.portfolioFv));
  weighted.nonAccrualFv = share(naFvFilers.reduce((s, p) => s + p.nonAccrualFvDollars, 0), naFvFilers.reduce((s, p) => s + p.portfolioFv, 0));
  n.nonAccrualFv = naFvFilers.length;
  const pikFilers = perFiler.filter((p) => isNum(p.pikIncome) && isNum(p.tii) && p.tii > 0);
  weighted.pikShareOfTotal = share(pikFilers.reduce((s, p) => s + p.pikIncome, 0), pikFilers.reduce((s, p) => s + p.tii, 0));
  n.pikShareOfTotal = pikFilers.length;
  /* the income-statement ratio needs an interest-income tag the concept
     map does not carry, so the composite states the schedule's
     contractual measure under its own name and leaves this one null */
  weighted.pikShareOfInterest = null;
  n.pikShareOfInterest = 0;
  {
    let pik = 0, all = 0, any = 0;
    const seen = new Set();
    for (const f of filers) {
      let filerAny = false;
      const credit = creditHoldings(f.holdings);
      f.holdings.forEach((h, i) => {
        const c = credit[i];
        if (!isThirdPartyDebt(c) || c.accruing === false || !isNum(h.principal) || !isNum(h.rate)) return;
        all += h.principal * h.rate;
        if (isNum(h.pik)) pik += h.principal * h.pik;
        filerAny = true;
      });
      if (filerAny && !seen.has(f.ticker)) { seen.add(f.ticker); any++; }
    }
    weighted.pikShareOfInterestContractual = all ? round4(pik / all) : null;
    n.pikShareOfInterestContractual = any;
  }
  const fvFilers = perFiler.filter((p) => isNum(p.portfolioCost) && isNum(p.portfolioFv));
  weighted.fvOverCost = round4(div(fvFilers.reduce((s, p) => s + p.portfolioFv, 0), fvFilers.reduce((s, p) => s + p.portfolioCost, 0)));
  n.fvOverCost = fvFilers.length;
  const deFilers = perFiler.filter((p) => isNum(p.debt) && isNum(p.netAssets));
  weighted.debtToEquity = round4(div(deFilers.reduce((s, p) => s + p.debt, 0), deFilers.reduce((s, p) => s + p.netAssets, 0)));
  n.debtToEquity = deFilers.length;
  /* filer-level ratios: weighted by the filer's cost of third-party debt */
  const wmean = (key) => {
    const rows = perFiler.filter((p) => isNum(p[key]) && p.w > 0);
    const w = rows.reduce((s, p) => s + p.w, 0);
    return { v: w ? round4(rows.reduce((s, p) => s + p[key] * p.w, 0) / w) : null, n: rows.length };
  };
  for (const key of ["assetCoverage", "opexRatio"]) {
    const r = wmean(key);
    weighted[key] = r.v; n[key] = r.n;
  }
  const tiiSeries = tiiYieldSeries(allCompanies.length ? allCompanies : filers.map((f) => f.company));
  weighted.tiiYieldOnAvgCost = tiiSeries.length ? tiiSeries[tiiSeries.length - 1].yield : null;
  n.tiiYieldOnAvgCost = tiiSeries.length ? tiiSeries[tiiSeries.length - 1].n : 0;

  /* pooled structure */
  const histogram = spreadHistogram(pooled);
  histogram.filers = filers.filter((f) => f.summary.histogram && f.summary.histogram.n).length;
  const wall = maturityWall(pooled);
  wall.filers = filers.filter((f) => f.summary.maturity && f.summary.maturity.dated > 0).length;
  const lien = lienMix(pooled, totalCost);
  lien.filers = filers.filter((f) => f.summary.lien && isNum(f.summary.lien.firstLienShare)).length;
  const allHoldings = [];
  for (const f of filers) for (const h of f.holdings) allHoldings.push(h);
  const sector = industryMix(allHoldings, totalFv);
  const sectorFilers = filers.filter((f) => f.summary.industrySource).length;

  const disp = {};
  for (const key of ["yieldAtCost", "yieldAtFv", "spreadCostWeighted", "floatingShare", "nonAccrualCost", "nonAccrualFv",
                     "fvOverCost", "debtToEquity", "assetCoverage", "opexRatio", "firstLienShare", "firstLienShareOfPortfolio", "top10", "vehicleShare",
                     "pikShareOfTotal", "pikContractual"]) {
    disp[key] = dispersion(perFiler.map((p) => p[key]));
  }
  disp.priceToNav = { min: null, p25: null, median: null, p75: null, max: null, n: 0 };

  return {
    generated: generated || new Date().toISOString(),
    quarter,
    creditVersion: CREDIT_VERSION,
    weighting: "every dollar figure is pooled across the members (Σ numerators ÷ Σ denominators, the cost-weighted mean); assetCoverage and opexRatio are means weighted by each member's cost of third-party debt",
    n: { filers: members.length, ...n },
    totals: { fv: round0(totalFv), cost: round0(totalCost), thirdPartyDebtCost: round0(totalThirdPartyDebtCost),
              holdings: allHoldings.length, thirdPartyDebtHoldings: pooled.filter(isThirdPartyDebt).length },
    weighted,
    tiiYieldSeries: tiiSeries,
    histogram,
    maturityWall: wall,
    lienMix: lien,
    sectorMix: { rows: sector, filers: sectorFilers, note: "industry labels are each filer's own; a sector named two ways counts twice" },
    dispersion: disp,
    priceToNavP25: null,
    members,
    perFiler: perFiler.map((p) => ({
      ticker: p.ticker, thirdPartyDebtCost: round0(p.w), yieldAtCost: p.yieldAtCost, yieldAtFv: p.yieldAtFv,
      spreadCostWeighted: p.spreadCostWeighted, floatingShare: p.floatingShare,
      nonAccrualCost: p.nonAccrualCost, nonAccrualFv: p.nonAccrualFv, fvOverCost: round4(p.fvOverCost),
      firstLienShare: p.firstLienShare, firstLienShareOfPortfolio: p.firstLienShareOfPortfolio, top10: p.top10, vehicleShare: p.vehicleShare,
      debtToEquity: round4(p.debtToEquity), assetCoverage: round4(p.assetCoverage), opexRatio: round4(p.opexRatio),
      pikShareOfTotal: round4(p.pikShareOfTotal), pikContractual: p.pikContractual,
    })),
  };
}

/* ---------- the resolved asset coverage (blueprint 4.2) ---------- */

/**
 * The asset coverage ratio with its source: the tag when the company
 * file carries it for the period, else the prose sentence, else the
 * formula on the tagged balance sheet — (net assets + debt) ÷ debt,
 * which is (total assets − liabilities not represented by senior
 * securities) ÷ senior securities when debt is the only senior
 * security. SBA debentures are not tagged apart, so the formula cannot
 * exclude them for a filer with exemptive relief and says so. A tag
 * and a sentence more than 2 points apart is a flag, never a merge.
 */
export function resolveAssetCoverage({ tag = null, prose = null, netAssets = null, debt = null, sbaExempt = null } = {}) {
  const proseV = prose && isNum(prose.v) ? RTCredit.asRatio(prose.v) : null;
  const tagV = isNum(tag) ? RTCredit.asRatio(tag) : null;
  const out = { v: null, acSource: null, tag: tagV, prose: proseV, sentence: prose && prose.sentence || null, formula: null, flags: [] };
  if (isNum(netAssets) && isNum(debt) && debt > 0) out.formula = round4((netAssets + debt) / debt);
  if (tagV !== null) { out.v = tagV; out.acSource = "tag"; }
  else if (proseV !== null) { out.v = proseV; out.acSource = "prose"; }
  else if (out.formula !== null) {
    out.v = out.formula; out.acSource = "formula";
    if (sbaExempt === true) out.flags.push("formula cannot exclude SBA debentures (not tagged apart); the ratio understates the filer's own");
  }
  if (tagV !== null && proseV !== null && Math.abs(tagV - proseV) > 0.02) {
    out.flags.push(`tag ${tagV} and prose ${proseV} differ by more than 2 points`);
  }
  if (prose && prose.sbaRelief) out.sbaRelief = true;
  return out;
}

/* ---------- compaction (blueprint 7.4) ---------- */

/**
 * A written holding uses the short keys below and omits every null
 * field and the issuer key (normalizeIssuer of the name, recomputed on
 * read), so a 1,439-row schedule stays under 400 KB; the file carries
 * this legend as `keys`, and expandHolding() restores the H1 shape.
 * A reader treats an absent key as null (floating as false). The
 * value vocabularies are unchanged.
 */
export const HOLDING_KEYS = {
  id: "id", issuer: "k", name: "n", aff: "a", kind: "t", lien: "l", facility: "f", industry: "i",
  rate: "r", spread: "sp", floor: "fl", pik: "pk", base: "b", principal: "p", cost: "c", fv: "v",
  pctNav: "nv", unfunded: "u", acquired: "ad", maturity: "m", nonAccrual: "na", floating: "fr",
  units: "un", src: "s", fvUntagged: "fvu", costUntagged: "cu", cashEquivalent: "ce",
};
export const LIEN_KEYS = { class: "c", subclass: "s", raw: "r" };
export const SRC_KEYS = { row: "w", table: "t", r: "r", na: "na", ind: "i", mat: "m", unf: "u", rt: "rt", ds: "ds", val: "vl", nm: "nm", af: "af" };
const invert = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const HOLDING_KEYS_BACK = invert(HOLDING_KEYS), LIEN_KEYS_BACK = invert(LIEN_KEYS), SRC_KEYS_BACK = invert(SRC_KEYS);
export const HOLDING_LEGEND = { holding: HOLDING_KEYS, lien: LIEN_KEYS, src: SRC_KEYS,
  note: "short keys per blueprint 7.4; a key absent from a row is null (floating: false); src.t and src.r absent mean false, src.na absent means none; src.vl \"table\" marks a fair value the filer left untagged and the printed schedule supplied; src.nm \"table\" marks an issuer name the printed row supplied; src.af \"issuer\" marks an affiliation taken from the issuer's other tranches; the issuer key (H1 `issuer`) is not written — it is normalizeIssuer(n), which expandHolding restores" };

export function compactHolding(h) {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    const sk = HOLDING_KEYS[k];
    if (!sk) continue;
    /* the issuer key is the normalized name; 14,000 rows of it are
       700 KB the reader can recompute */
    if (k === "issuer" && h.name && v === normalizeIssuer(h.name)) continue;
    if (k === "lien") {
      const l = {};
      for (const [lk, lv] of Object.entries(v || {})) if (lv !== null && lv !== undefined && LIEN_KEYS[lk]) l[LIEN_KEYS[lk]] = lv;
      /* a raw label that is the class itself says nothing more */
      if (l.r && l.c && String(l.r).toLowerCase() === l.c) delete l.r;
      out[sk] = l;
      continue;
    }
    if (k === "src") {
      const o = {};
      for (const [xk, xv] of Object.entries(v || {})) if (xv !== null && xv !== undefined && xv !== false && xv !== "none" && SRC_KEYS[xk]) o[SRC_KEYS[xk]] = xv;
      out[sk] = o;
      continue;
    }
    if (v === null || v === undefined || v === false) continue;
    out[sk] = v;
  }
  return out;
}

/* the H1 shape back from a written row */
export function expandHolding(c) {
  const h = {
    id: null, issuer: null, name: null, aff: null, kind: null, lien: { class: null, subclass: null, raw: null }, facility: null, industry: null,
    rate: null, spread: null, floor: null, pik: null, base: null, principal: null, cost: null, fv: null, pctNav: null, unfunded: null,
    acquired: null, maturity: null, nonAccrual: null, floating: false, units: null,
    src: { row: null, table: false, r: false, na: "none", ind: null, mat: null, unf: null, val: null, nm: null, af: null },
  };
  for (const [sk, v] of Object.entries(c || {})) {
    const k = HOLDING_KEYS_BACK[sk] || sk;
    if (k === "lien") { for (const [lk, lv] of Object.entries(v || {})) h.lien[LIEN_KEYS_BACK[lk] || lk] = lv; continue; }
    if (k === "src") { for (const [xk, xv] of Object.entries(v || {})) h.src[SRC_KEYS_BACK[xk] || xk] = xv; continue; }
    h[k] = v;
  }
  if (h.lien.raw === null && h.lien.class) h.lien.raw = h.lien.class;
  if (h.issuer === null && (h.name || h.id)) h.issuer = normalizeIssuer(h.name || h.id);
  return h;
}
