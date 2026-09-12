/**
 * rpage.mjs — the schedule of investments as EDGAR renders it from the
 * XBRL: the "R page" of a filing.
 *
 * Beside every inline-XBRL filing EDGAR writes a FilingSummary.xml
 * that names one rendered HTML report per statement and note, R1.htm
 * onward. One of them is the schedule of investments (ARCC's 10-Q for
 * June 30 2026: R9.htm, "0000009 - Statement - CONSOLIDATED SCHEDULE
 * OF INVESTMENTS", 12 MB against the 24.8 MB main document). It is a
 * second source for what the main table prints and the data set does
 * not carry: the non-accrual footnote and, where the filer tags it,
 * the industry. It is not a cheaper one, and it has no maturity dates
 * (blueprint 7.3).
 *
 * The page is one <table class="report"> laid out vertically. A header
 * row names the periods ("Jun. 30, 2026 | Dec. 31, 2025") and the
 * scale ("$ in Millions"). Then rows of two kinds: a class "rh" row
 * opens an axis member (the onclick carries `defref_<axis>=<member>`;
 * for the typed identifier axis the link text reads "Investment,
 * Identifier [Axis]: Issuer | First lien senior secured loan 2"), and
 * the "ro"/"re" rows under it carry one concept each — Amortized
 * Cost, Fair Value, Coupon, Spread, Principal, Shares/Units, Coupon
 * PIK, % of Net Assets — with a marker cell (`<sup>[4],[11]</sup>`) for
 * the row, then a value cell per period with its own marker cell. The
 * footnotes close the page as "outerFootnote" rows: "[11] Loan was on
 * non-accrual status as of June 30, 2026." A marker whose sentence
 * says non-accrual and names the period's date marks the member;
 * ARCC's [12] says the same for December 31 2025 and marks nothing in
 * June.
 *
 * ARCC's page carries three axes one after the other: the industry
 * axis with totals per industry (25 members), the issuer-name axis
 * with totals per issuer (434), and the identifier axis with every
 * position (2,886 at both dates). The identifier members are not
 * nested under an industry, so for ARCC industry per position is
 * null here and comes from the main table; the industry and issuer
 * totals are returned beside the rows because they are the filer's
 * own sector mix and issuer concentration. A filer whose page nests
 * identifier members under an industry header gets the industry on
 * each row.
 *
 * Concepts are read from the defref name, never from the label, so a
 * filer that labels cost "Cost" and another "Amortized Cost" read the
 * same. Money is scaled by the header's note; a share count is scaled
 * only when the header says "shares in Thousands".
 */

import { strip } from "./interim-parse.mjs";
import { lienClass } from "./bdc-concepts.mjs";
import { splitMember, parseDate, marksNonAccrualAt, isPikNonAccrual, money, findFootnotes } from "./soi-html.mjs";

const round4 = (v) => v == null ? null : Math.round(v * 1e4) / 1e4;
const roundUnit = (v) => v == null ? null : Math.round(v);

/**
 * The rendered schedule report named in a FilingSummary.xml:
 * { file: "R9.htm", longName, shortName, role } or null. The
 * statement-type report whose long name says "SCHEDULE OF
 * INVESTMENTS" and is not the parenthetical; the first such report
 * when none is typed as a statement.
 */
export function findScheduleReport(xml) {
  const reports = [];
  const re = /<Report\b[^>]*>([\s\S]*?)<\/Report>/g;
  let m;
  const field = (block, name) => { const f = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return f ? strip(f[1]) : ""; };
  while ((m = re.exec(String(xml || "")))) {
    const block = m[1];
    const longName = field(block, "LongName");
    if (!/schedule of (portfolio )?investments/i.test(longName)) continue;
    if (/parenthetical/i.test(longName)) continue;
    reports.push({
      file: field(block, "HtmlFileName"), longName, shortName: field(block, "ShortName"), role: field(block, "Role"),
      type: field(block, "ReportType"), menu: field(block, "MenuCategory"), position: Number(field(block, "Position")) || null,
    });
  }
  if (!reports.length) return null;
  const statement = reports.find((r) => /statement/i.test(r.longName) || /statements?/i.test(r.menu));
  return statement || reports[0];
}

/* "Jun. 30, 2026" → 2026-06-30 */
function periodOf(text) {
  const t = strip(text).replace(/\./g, "");
  const d = parseDate(t);
  return d && d.precision === "day" ? d.iso : null;
}

/* "$ in Millions" / "$ in Thousands"; "shares in Thousands" */
function scalesOf(headerText) {
  const t = strip(headerText).toLowerCase();
  const pick = (re) => { const m = t.match(re); if (!m) return 1; return /million/.test(m[1]) ? 1e6 : /thousand/.test(m[1]) ? 1e3 : /billion/.test(m[1]) ? 1e9 : 1; };
  return {
    money: pick(/\$\s*in\s*(millions|thousands|billions)/),
    shares: pick(/shares?\s*in\s*(millions|thousands|billions)/),
  };
}

const CONCEPTS = {
  InvestmentOwnedAtCost: "cost",
  InvestmentOwnedAtFairValue: "fv",
  InvestmentInterestRate: "coupon",
  InvestmentBasisSpreadVariableRate: "spread",
  InvestmentInterestRatePaidInKind: "pik",
  InvestmentInterestRateFloor: "floor",
  InvestmentOwnedBalancePrincipalAmount: "principal",
  InvestmentOwnedBalanceShares: "shares",
  InvestmentOwnedPercentOfNetAssets: "pctNav",
  InvestmentCompanyFinancialCommitmentToInvesteeFutureAmount: "unfunded",
  InvestmentMaturityDate: "maturity",
  InvestmentAcquisitionDate: "acquired",
};
const PERCENT_KEYS = new Set(["coupon", "spread", "pik", "floor", "pctNav"]);

/* the cells of one row as { cls, html } */
function cellsOf(tr) {
  const out = [];
  const re = /<td\b([^>]*)>([\s\S]*?)<\/td>|<th\b([^>]*)>([\s\S]*?)<\/th>/gi;
  let m;
  while ((m = re.exec(tr))) {
    const attrs = m[1] != null ? m[1] : m[3];
    const html = m[2] != null ? m[2] : m[4];
    const cls = (attrs.match(/class="([^"]*)"/) || [])[1] || "";
    out.push({ cls, html, text: strip(html), th: m[3] != null, span: Number((attrs.match(/colspan="?(\d+)/i) || [])[1] || 1) });
  }
  return out;
}
const markersIn = (html) => [...String(html).matchAll(/\[(\d{1,2}|[a-z]{1,2})\]/gi)].map((m) => `(${m[1].toLowerCase()})`);

/* a value cell: "$ 58.1" → 58.1; "7.83%" → 0.0783; "(5.2)" → -5.2; blank → null */
function valueOf(text, key, scales) {
  const t = strip(text).replace(/&#160;/g, " ").trim();
  if (!t) return null;
  if (PERCENT_KEYS.has(key)) {
    const m = t.match(/(-?\(?\d[\d,]*(?:\.\d+)?\)?)\s*%/);
    if (!m) return null;
    const v = money(m[1]);
    return v == null ? null : round4(v / 100);
  }
  if (key === "maturity" || key === "acquired") { const d = parseDate(t); return d ? d.iso : null; }
  const v = money(t);
  if (v == null) return null;
  if (key === "shares") return roundUnit(v * scales.shares);
  return roundUnit(v * scales.money);
}

/**
 * The rendered schedule: parseRPage(html, { period }) →
 *   { period, periods, scale, totals, rows, fvOnly, industries, issuers, footnotes, axes, notes }
 * `totals` are the undimensioned facts printed above the first member
 * (ARCC: Amortized Cost 29,674.6 and Fair Value 29,349.3, $ in millions).
 * `rows` are the identifier members carrying both cost and fair value
 * at the period, the data set's row rule (blueprint 7.3):
 *   { member, issuer, type, aff, seq, lien, industry, coupon, spread,
 *     pik, floor, principal, shares, cost, fv, pctNav, unfunded,
 *     maturity, markers, nonAccrual, pikNonAccrual (the PIK component
 *     alone, BBDC) }
 * `fvOnly` are the members with a fair value and no cost: the issuer
 * subtotals and summary members a filer tags on the same axis (ARCC:
 * Ivy Hill Asset Management, the Senior Direct Lending Program,
 * "Largest Portfolio Company Investment"), 39 of them summing to
 * $5,067.3M at June 30 2026 against the 1,439 positions that sum to
 * $29,674.6M at cost and $29,349.3M at fair value, the tagged totals.
 * `industries` and `issuers` are the totals the filer tags on the
 * industry and issuer-name axes: [{ name, member, cost, fv, pctNav }].
 * The default period is the first column, the current one.
 */
export function parseRPage(html, { period = null } = {}) {
  const src = String(html || "");
  const notes = [];
  const tableStart = src.search(/<table[^>]*class="report"/i);
  const tableEnd = tableStart >= 0 ? src.indexOf("</table>", tableStart) : -1;
  if (tableStart < 0 || tableEnd < 0) return { period: null, periods: [], scale: 1, totals: {}, rows: [], fvOnly: [], industries: [], issuers: [], footnotes: {}, axes: {}, notes: ["no report table"] };
  const table = src.slice(tableStart, tableEnd);

  /* header: title cell with the scale, then one th per period */
  const trs = [...table.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)].map((m) => ({ attrs: m[1], html: m[2] }));
  let scales = { money: 1, shares: 1 };
  const periods = [];
  let body = 0;
  for (; body < trs.length; body++) {
    const cells = cellsOf(trs[body].html);
    if (!cells.length || !cells.every((c) => c.th)) break;
    for (const c of cells) {
      if (/\$\s*in\s*(million|thousand|billion)|shares?\s*in\s*(million|thousand)/i.test(c.text)) scales = scalesOf(c.text);
      const p = periodOf(c.text);
      if (p) periods.push(p);
    }
  }
  if (!periods.length) notes.push("no period column found in the header");
  let col = period ? periods.indexOf(period) : 0;
  if (col < 0) { notes.push(`no column for ${period}; using ${periods[0] || "the first"}`); col = 0; }
  const chosen = periods[col] || null;

  /* footnotes: "[11]" rows after the report body, or anywhere on the page */
  const footnotes = {};
  for (const f of findFootnotes(src)) if (!(f.marker in footnotes)) footnotes[f.marker] = f.text;
  /* a marker marks the member when its sentence states non-accrual
     status (not a PIK footnote that mentions it: PSEC's (30) and (32)
     read "which excludes those on non-accrual") and names no other
     date than the period's */
  const isNonAccrualMarker = (mk) => marksNonAccrualAt(footnotes[mk], chosen);
  const isPikNonAccrualMarker = (mk) => isPikNonAccrual(footnotes[mk]);

  /* body: members and their concept rows */
  const rows = [], fvOnly = [], industries = [], issuers = [];
  /* the concept rows before the first member: the page's own totals */
  const totals = {};
  const axes = {};
  let current = null, currentIndustry = null;
  const flush = () => {
    if (!current) return;
    const v = current.values;
    const any = Object.keys(v).length > 0;
    if (current.axis === "InvestmentIdentifierAxis") {
      if (any) {
        const parts = splitMember(current.member);
        const nonAccrual = current.markers.some(isNonAccrualMarker);
        const pikNonAccrual = !nonAccrual && current.markers.some(isPikNonAccrualMarker);
        (v.cost != null && v.fv != null ? rows : fvOnly).push({
          member: current.member, issuer: parts.issuer, type: parts.type, aff: parts.aff, seq: parts.seq,
          lien: parts.type ? lienClass(parts.type) : null, industry: currentIndustry,
          coupon: v.coupon ?? null, spread: v.spread ?? null, pik: v.pik ?? null, floor: v.floor ?? null,
          principal: v.principal ?? null, shares: v.shares ?? null, cost: v.cost ?? null, fv: v.fv ?? null,
          pctNav: v.pctNav ?? null, unfunded: v.unfunded ?? null, maturity: v.maturity ?? null,
          markers: [...new Set(current.markers)], nonAccrual, ...(pikNonAccrual ? { pikNonAccrual: true } : {}),
        });
      }
    } else if (/IndustryAxis|IndustrySector/i.test(current.axis)) {
      if (any) industries.push({ name: current.member, member: current.memberId, cost: v.cost ?? null, fv: v.fv ?? null, pctNav: v.pctNav ?? null });
    } else if (/IssuerNameAxis/i.test(current.axis)) {
      if (any) issuers.push({ name: current.member, member: current.memberId, cost: v.cost ?? null, fv: v.fv ?? null, pctNav: v.pctNav ?? null });
    }
    current = null;
  };
  for (let i = body; i < trs.length; i++) {
    const tr = trs[i];
    const cls = (tr.attrs.match(/class="([^"]*)"/) || [])[1] || "";
    if (/outerFootnote/.test(cls)) break;
    const cells = cellsOf(tr.html);
    if (!cells.length) continue;
    const first = cells[0];
    const ref = (first.html.match(/defref_([A-Za-z0-9-]+)_([A-Za-z0-9]+)(?:=([^'"]*))?/) || []);
    if (/\brh\b/.test(cls) || (ref[3] != null && !/\bro\b|\bre\b/.test(cls))) {
      flush();
      const axis = ref[2] || "";
      const memberId = ref[3] != null ? strip(ref[3]) : "";
      let label = first.text.replace(/^[^:]*\[Axis\]\s*:\s*/i, "").trim();
      if (!label) label = memberId;
      axes[axis] = (axes[axis] || 0) + 1;
      if (/IndustryAxis|IndustrySector/i.test(axis)) currentIndustry = label;
      else if (!/InvestmentIdentifierAxis/.test(axis)) currentIndustry = null;
      current = { axis, member: label, memberId, values: {}, markers: [] };
      continue;
    }
    const key = CONCEPTS[ref[2]];
    if (!key) continue;
    /* the marker cell, then value cells with their marker cells */
    const rest = cells.slice(1);
    const rowMarkers = rest.length && /\bth\b/.test(rest[0].cls) ? markersIn(rest[0].html) : [];
    const values = rest.filter((c) => !/\bth\b/.test(c.cls) && !/\bfn\b/.test(c.cls));
    const fns = [];
    for (let k = 0, v = -1; k < rest.length; k++) {
      const c = rest[k];
      if (/\bth\b/.test(c.cls)) continue;
      if (/\bfn\b/.test(c.cls)) { if (v >= 0) fns[v] = (fns[v] || []).concat(markersIn(c.html)); continue; }
      v++;
    }
    const cell = values[col];
    if (!cell) continue;
    const val = valueOf(cell.html, key, scales);
    if (val == null) continue;
    if (!current) { if (!(key in totals)) totals[key] = val; continue; }
    current.values[key] = val;
    current.markers.push(...rowMarkers, ...(fns[col] || []));
  }
  flush();
  if (!rows.length) notes.push("no identifier member carried a value at the period");
  /* a page that lists every industry member first and every identifier
     member after them (TCPC's R7 and FDUS's R7 in the August 2026
     filings) leaves the last industry hanging over every position: when
     the page carries more than one industry and one label would sit on
     nearly every row, the members are not nested and the label is
     dropped, never written as the sector of every loan */
  if (rows.length && industries.length > 1) {
    const counts = new Map();
    for (const r of rows) if (r.industry) counts.set(r.industry, (counts.get(r.industry) || 0) + 1);
    const top = Math.max(0, ...counts.values());
    if (top > 0.9 * rows.length) {
      for (const r of rows) r.industry = null;
      for (const r of fvOnly) r.industry = null;
      notes.push(`identifier members are not nested under the ${industries.length} industry members (one label would cover ${top} of ${rows.length} rows); industry per position comes from the main table`);
    }
  }
  if (rows.length && !rows.some((r) => r.industry) && !notes.some((n) => /not nested/.test(n))) notes.push("identifier members are not nested under an industry; industry per position comes from the main table");
  return {
    period: chosen, periods, scale: scales.money, totals, rows, fvOnly, industries, issuers, footnotes, axes, notes,
  };
}
