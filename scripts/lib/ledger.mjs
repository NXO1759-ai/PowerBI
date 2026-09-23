/**
 * ledger.mjs — the one place that sums a hyperscaler/neocloud ledger row.
 *
 * The three ledgers under frontend/data/ledgers/ (deals, capex, credit)
 * share one row shape: {date, entity, amount, unit, structure,
 * counterparties, terms, note, url, sourceType, status}. `status` is what
 * a financing total keys on, never `structure` alone, because a row can
 * be a bond in shape (Beignet's notes) while carrying the status
 * "commentary" because it would double-count another row's dollars.
 *
 * House rule (blueprint 15.9, must-not-build): an announcement, a
 * contract row, a backstop, a rating action or commentary NEVER enters a
 * financing total; a new-issue spread and an index OAS are different
 * measures and are never summed together either. This module is the
 * single implementation the page and scripts/test-ledgers.mjs both call,
 * so the rule can only be broken in one place, not reimplemented twice.
 */

// Statuses that count as real, closed-or-signed capital raised.
export const SIGNED_STATUSES = new Set(["signed", "closed"]);

// Everything else that can appear in `status` — kept explicit so an
// unrecognized status fails loudly instead of silently landing on one
// side of the line.
export const EXCLUDED_STATUSES = new Set([
  "announcement",
  "contract",
  "commentary",
  "rating action",
  "backstop",
  "guidance",
  "outturn",
  "aggregate",
]);

export function isRecognizedStatus(status) {
  return SIGNED_STATUSES.has(status) || EXCLUDED_STATUSES.has(status);
}

/** True when a row's dollars belong in a "how much financing" total. */
export function isFinancingRow(row) {
  return SIGNED_STATUSES.has(row.status);
}

/**
 * Parses a ledger row's `amount` field to a plain number in the row's
 * stated `unit`, or null when the field is prose rather than a figure
 * (a guidance row printed as a direction or a range, an "as printed"
 * quote, a placeholder like "Lenders not named"). Callers that need a
 * number should skip null rows rather than coerce them — coercing a
 * prose amount is exactly the fabrication this ledger's house rules
 * forbid.
 */
export function parseAmount(row) {
  if (typeof row.amount !== "string") return null;
  const m = row.amount.trim().match(/^-?[\d,]+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Sums the financing rows of a ledger (deals-ledger.json shape) by a
 * grouping key (default: `structure` — bond, bank loan, private credit
 * facility, convertible, JV/SPV, ABS or CMBS, equity, commentary...).
 * Rows whose status is not signed/closed are skipped entirely, and rows
 * whose amount does not parse to a plain number (foreign-currency
 * tranches folded into another row's terms as "ALSO", ranges, "n/a") are
 * skipped and returned separately so a caller can see what was left out
 * and why, rather than have it silently drop to zero.
 *
 * This never converts currency: `unit` must be "USD bn" or "USD m" (the
 * ledger's own FX conversions, where done, are on the row itself).
 */
export function sumByGroup(rows, { groupBy = "structure", unit = "USD bn" } = {}) {
  const totals = new Map();
  const skipped = [];
  for (const row of rows) {
    if (!isFinancingRow(row)) continue;
    if (row.unit !== unit) {
      skipped.push({ row, reason: `unit ${row.unit} != ${unit}` });
      continue;
    }
    const n = parseAmount(row);
    if (n === null) {
      skipped.push({ row, reason: "amount does not parse to a number" });
      continue;
    }
    const key = row[groupBy] ?? "(none)";
    totals.set(key, (totals.get(key) || 0) + n);
  }
  return { totals, skipped };
}

/** Every distinct entity-linked deal that appears more than once across
 * a set of rows, keyed by a caller-supplied `dealId(row)` tagger. Used to
 * assert a named multi-row deal (Hyperion, El Paso) resolves to exactly
 * one financing row. Rows failing `dealId` (returns falsy) are ignored. */
export function dealGroups(rows, dealId) {
  const byDeal = new Map();
  for (const row of rows) {
    const id = dealId(row);
    if (!id) continue;
    if (!byDeal.has(id)) byDeal.set(id, []);
    byDeal.get(id).push(row);
  }
  return byDeal;
}

/** Counts how many rows of a deal group are financing rows (signed or
 * closed) — the number that must be exactly 1 for a deal that the
 * blueprint says counts once. */
export function financingCount(dealRows) {
  return dealRows.filter(isFinancingRow).length;
}

/* ------------------------------------------------------------------
 * The three 15.8 derived figures (scripts/build-ledger-series.mjs):
 * the private-credit share of the ledger, the JV/SPV/lease-backed
 * share, and the monthly private-credit-facility total. Both share
 * figures divide by "the ledger" — every signed or closed financing
 * row, summed in USD with foreign tranches converted at the FRED daily
 * rate on the pricing date — never by a subset the numerator is drawn
 * from, and never adding an excluded row into that denominator.
 * ------------------------------------------------------------------ */

/** The ledger's own structure bucket for a facility whose lenders are
 * priced and syndicated as private credit (blueprint 15.5's seven
 * structures; 15.8 names the population by example: CoreWeave's six
 * DDTLs, Crusoe/Brookfield, the APLD/Macquarie tranches). A syndicated
 * bank loan stays "bank loan" even where press says it will be sold on
 * to private-credit funds (Vantage) — the ledger's own tag, not a
 * lender-name guess, is the rule. */
export const PRIVATE_CREDIT_FACILITY_STRUCTURE = "private credit facility";

export function isPrivateCreditFacilityRow(row) {
  return isFinancingRow(row) && row.structure === PRIVATE_CREDIT_FACILITY_STRUCTURE;
}

/** Entity substrings identifying a project-note SPV backed by a
 * hyperscaler lease or a Google backstop (blueprint 15.8's named list:
 * APLD's ComputeCo issuers, Cipher's Compute/Black Pearl issuers,
 * TeraWulf's WULF Compute and Flash Compute, Hut 8 DC, Switch and
 * Aligned Data Centers). This is a curated list, not the "JV/SPV"
 * structure tag: an equity joint venture like Hyperion or the Crusoe/
 * Blue Owl venture is a JV/SPV row too, but it is not one of these
 * lease-backed project notes, so it is not in this population.
 *
 * Known gap (documented, not guessed): Cipher's $810m Stingray Compute
 * LLC note is folded into the Black Pearl row's `terms` field as an
 * "ALSO" sub-transaction rather than shipped as its own row, so it is
 * not separately summed here. Promoting it to a standalone row (or
 * teaching this module to parse "ALSO" blocks) would close the gap. */
export const LEASE_BACKED_ENTITY_MARKERS = [
  "APLD ComputeCo", "Cipher Compute LLC", "Black Pearl Compute LLC",
  "WULF Compute LLC", "Flash Compute LLC", "Hut 8 DC LLC",
  "Switch", "Aligned Data Centers",
];

export function isLeaseBackedRow(row) {
  return isFinancingRow(row) && LEASE_BACKED_ENTITY_MARKERS.some((m) => row.entity.includes(m));
}

/** The Beignet Investor LLC row: the SPV bond that finances the Meta /
 * Blue Owl Hyperion JV, carried on the ledger as `status: "commentary"`
 * so it never enters a normal financing total (it would double-count
 * the Hyperion JV/SPV row). Decision 12.17 makes one named exception:
 * the private-credit share is stated once with this row folded into the
 * numerator (a caveat marker on the double-count) and once without it.
 * This finder never changes the row's status or touches any other
 * total — callers opt in explicitly. */
export function findBeignetRow(rows) {
  return rows.find((r) => /Beignet Investor/.test(r.entity)) || null;
}

/* ISO currency → { fredId, invert }. DEXUSEU and DEXUSUK are US
 * dollars per one unit of the foreign currency (multiply to get USD);
 * DEXSZUS, DEXCAUS and DEXJPUS are the foreign currency per one US
 * dollar (divide to get USD) — FRED states the direction on each
 * series page and it is not the same for all five. */
export const FX_SERIES_OF = {
  EUR: { id: "DEXUSEU", invert: false },
  GBP: { id: "DEXUSUK", invert: false },
  CHF: { id: "DEXSZUS", invert: true },
  CAD: { id: "DEXCAUS", invert: true },
  JPY: { id: "DEXJPUS", invert: true },
};

const SCALE_OF = { bn: 1e9, m: 1e6 };

/* The first number in a string, tolerating a leading symbol ("~1.0",
 * "$500m") and a trailing descriptive word the ledger sometimes keeps
 * ("5.0 debt", "1.0043 net") — never the whole trimmed string, which a
 * plain Number() would refuse. Returns null, not zero, when there is no
 * number to find. */
function leadingNumber(s) {
  const m = String(s).match(/-?[\d,]+(?:\.\d+)?/);
  return m ? Number(m[0].replace(/,/g, "")) : null;
}

/** The observation on `date`, or the most recent one before it (a
 * missing date — a weekend, a holiday — takes the previous business
 * day, and `exact` says which happened). `obs` is ascending {date,
 * value} as fred.mjs returns it. */
export function fxRateOn(obs, date) {
  if (!obs || !obs.length) return null;
  for (let i = obs.length - 1; i >= 0; i--) {
    if (obs[i].date <= date) return { date: obs[i].date, value: obs[i].value, exact: obs[i].date === date };
  }
  return null;
}

/** amount (a plain number, already scaled to dollars/euros/etc., not
 * billions) in `currency` → USD on `date`, using `fxByCurrency[currency]`
 * (an ascending {date, value} series, e.g. from fetchSeriesVia("DEXUSEU")).
 * USD needs no rate. Returns null when the currency is unhandled or the
 * series carries no observation on or before `date`. */
export function convertToUsd(amount, currency, date, fxByCurrency) {
  if (currency === "USD") return { usd: amount, rate: 1, rateDate: date, exact: true };
  const dir = FX_SERIES_OF[currency];
  if (!dir) return null;
  const series = fxByCurrency && fxByCurrency[currency];
  const r = fxRateOn(series, date);
  if (!r) return null;
  return { usd: dir.invert ? amount / r.value : amount * r.value, rate: r.value, rateDate: r.date, exact: r.exact };
}

/** A ledger row's `amount` parsed to a plain USD-billions number, with
 * foreign tranches converted at `row.date` via `fxByCurrency`. Handles
 * the ledger's amount shapes:
 *   - a single figure, with or without a trailing descriptive word
 *     ("27.3", or "1.0043 net", unit "USD bn");
 *   - a single figure with a parenthetical qualifier the unit carries
 *     ("27", unit "USD bn (development cost)");
 *   - a same-currency amount split into named parts that add up to the
 *     row's one transaction ("5.0 debt + 5.0 equity", unit "USD bn" —
 *     summed, since there is one currency and splitting the total across
 *     structures is a different chart's concern, not this one's);
 *   - a compound multi-currency amount ("17.5 + EUR 6.5", unit "USD bn
 *     + EUR bn" — each "+" segment of `amount` lines up with the same
 *     segment of `unit`; a segment names its own currency only when it
 *     differs from the unit's, e.g. "EUR 6.5").
 * Returns null, not a guess, when a segment's currency or scale cannot
 * be read or the FX rate is unavailable — callers skip a null and record
 * why, per this file's house rule against coercing a prose amount into
 * a number. */
export function amountUsdBnOf(row, fxByCurrency) {
  const unitSegments = String(row.unit).replace(/\s*\([^)]*\)\s*$/, "").trim().split("+").map((s) => s.trim());
  const amountSegments = String(row.amount).split("+").map((s) => s.trim());

  if (unitSegments.length === 1) {
    const um = unitSegments[0].match(/^(USD|EUR|GBP|CHF|CAD|JPY)\b/);
    const currency = um ? um[1] : null;
    const scaleMatch = unitSegments[0].match(/\b(bn|m)\s*$/i);
    const scale = SCALE_OF[(scaleMatch ? scaleMatch[1] : "bn").toLowerCase()];
    if (!currency) return null;
    let sum = 0;
    for (const seg of amountSegments) {
      const n = leadingNumber(seg);
      if (n === null) return null;
      sum += n;
    }
    const conv = convertToUsd(sum * scale, currency, row.date, fxByCurrency);
    return conv ? conv.usd / 1e9 : null;
  }

  if (amountSegments.length !== unitSegments.length) return null;
  let totalUsd = 0;
  for (let i = 0; i < amountSegments.length; i++) {
    const aTok = amountSegments[i], uTok = unitSegments[i];
    const explicit = aTok.match(/^([A-Z]{3})\s+(.+)$/);
    let currency, numPart;
    if (explicit) { currency = explicit[1]; numPart = explicit[2]; }
    else {
      numPart = aTok;
      const um = uTok.match(/^(USD|EUR|GBP|CHF|CAD|JPY)\b/);
      currency = um ? um[1] : null;
    }
    const n = leadingNumber(numPart);
    const scaleMatch = uTok.match(/\b(bn|m)\s*$/i);
    const scale = SCALE_OF[(scaleMatch ? scaleMatch[1] : "bn").toLowerCase()];
    if (!currency || n === null) return null;
    const conv = convertToUsd(n * scale, currency, row.date, fxByCurrency);
    if (!conv) return null;
    totalUsd += conv.usd;
  }
  return totalUsd / 1e9;
}

/** Sums `amountUsdBnOf` over a set of rows, returning the USD-billions
 * total, the number of rows that resolved to a number, and the ones
 * that did not (with a reason) so a caller never silently drops a row
 * from a total it reports as complete. */
export function sumUsdBn(rows, fxByCurrency) {
  let totalUsdBn = 0, n = 0;
  const skipped = [];
  for (const row of rows) {
    const usdBn = amountUsdBnOf(row, fxByCurrency);
    if (usdBn === null) { skipped.push({ row, reason: "amount or FX rate did not resolve" }); continue; }
    totalUsdBn += usdBn;
    n++;
  }
  return { totalUsdBn, n, skipped };
}

/* The house structures that are genuine financing when they appear as a
   "|| ALSO" sub-transaction inside another row's `terms` — the same set
   that counts toward a financing total when it is a standalone row.
   "commitment", "program cap", "contract value" and "maximum RVG
   exposure" are deliberately left out: they are not dollars raised. */
const ALSO_FINANCING_TAGS = {
  "bond": "bond", "bank loan": "bank loan", "convertible": "convertible",
  "JV/SPV": "JV/SPV", "private credit facility": "private credit facility",
};
const ALSO_RX = /\|\|\s*ALSO\s+(\d{4}-\d{2}-\d{2})\s+([^:]+):\s*([\d.,]+)\s+(USD|EUR|GBP|CHF|CAD|JPY)\s+(bn|m)\s*\(([^;)]+)/g;

/** Round-2 fix (findings on the ledger's undisclosed "|| ALSO" sub-
 * transactions): every signed-financing-shaped sub-transaction folded
 * into a parent row's `terms` field, with its own date, entity, amount
 * and USD-bn conversion — read directly off the row's own printed text,
 * never a row this module invents. Used only for a disclosure (a
 * population sentence, a tile-foot count) — these dollars are never
 * added into any chart's total, since promoting them to real rows (with
 * their own status, structure and independently checked citation) is
 * the fix this only discloses the size of. A block whose own tag is not
 * one of ALSO_FINANCING_TAGS (a commitment, a program cap, a contract
 * value, an exposure figure) is intentionally left out — it was never a
 * financing amount even as a standalone row. */
export function alsoFoldedFinancing(rows, fxByCurrency) {
  const entries = [];
  for (const row of rows) {
    const terms = String(row.terms || "");
    let m;
    ALSO_RX.lastIndex = 0;
    while ((m = ALSO_RX.exec(terms))) {
      const [, date, entity, amountStr, currency, scaleWord, tagRaw] = m;
      const tag = tagRaw.trim();
      const structure = ALSO_FINANCING_TAGS[tag];
      if (!structure) continue;
      const n = Number(amountStr.replace(/,/g, ""));
      if (!Number.isFinite(n)) continue;
      const scale = SCALE_OF[scaleWord.toLowerCase()];
      const conv = convertToUsd(n * scale, currency, date, fxByCurrency);
      entries.push({
        parentDate: row.date, parentEntity: row.entity, date, entity: entity.trim(),
        structure, amountStr, currency, usdBn: conv ? conv.usd / 1e9 : null,
      });
    }
  }
  const resolved = entries.filter((e) => e.usdBn !== null);
  const totalUsdBn = resolved.reduce((a, e) => a + e.usdBn, 0);
  return { n: entries.length, resolvedN: resolved.length, totalUsdBn, entries };
}

/** "YYYY-MM" of a ledger row's date, for grouping into monthly points. */
export function monthKeyOf(date) {
  return String(date).slice(0, 7);
}

/** The last calendar day of "YYYY-MM" as "YYYY-MM-DD", the date form
 * the page's other monthly series points use (fred.mjs's monthEnd). */
export function monthEndDateOf(yyyyMM) {
  const [y, m] = yyyyMM.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
