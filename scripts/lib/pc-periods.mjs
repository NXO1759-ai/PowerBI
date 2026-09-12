/**
 * pc-periods.mjs — the period-label grammar of the PitchBook and LCD
 * sources, one function for every label form the deck and the workbook
 * print.
 *
 * A chart cache or a workbook column names its periods the way the
 * analyst typed them: "1Q20", "Q3 2018", "2020", "1H26", "YTD 2026",
 * "YTD August 2026", "2026 YTD", "Last 3 Months", "TTM", "As of June 30,
 * 2026", "Jun-26". Every one of them has to become a dated window before
 * it can be keyed, merged across vintages or drawn on a time axis, and a
 * label that is not a period ("Healthcare", "450 - 499 bps", the
 * maturity bucket "2031 - 2033") has to come back as nothing, because the
 * deck reader tells a chart's orientation by whether its series names
 * parse as periods.
 *
 * Rolling and year-to-date labels carry no end date of their own; the
 * slide's source line ("*As of Aug. 31, 2026") supplies it. Without that
 * as-of the label is recognized but not resolved, and the result says so
 * (needsAsOf) rather than inventing a date. Nothing here guesses: an
 * unrecognized label is null, a contradictory one ("YTD 2027" against an
 * as-of in 2026) is null.
 *
 * Grains: quarter, half, year, ytd, rolling3m, rolling12m (the deck's
 * "TTM"), asof, month. Every window is a calendar window (fiscal: false);
 * the sources publish on calendar periods.
 */

export const GRAINS = ["quarter", "half", "year", "ytd", "rolling3m", "rolling12m", "asof", "month"];

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/* ---------- calendar arithmetic, all on "YYYY-MM-DD" strings ---------- */
const pad = (n) => (n < 10 ? "0" + n : String(n));
export const iso = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthEnd = (y, m) => iso(y, m, daysInMonth(y, m));
export const monthStart = (y, m) => iso(y, m, 1);
export const quarterEnd = (y, q) => monthEnd(y, q * 3);
export const quarterStart = (y, q) => monthStart(y, q * 3 - 2);
export const halfEnd = (y, h) => monthEnd(y, h * 6);
export const halfStart = (y, h) => monthStart(y, h * 6 - 5);

function splitIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

/* the start of an n-month window ending on the as-of. A month-end as-of
   opens on the first of the month n-1 months back ("Last 3 Months" at
   Aug 31 opens on Jun 1; "TTM" at Jun 30 on the previous Jul 1). Any
   other as-of opens the day after the same calendar day n months back
   ("TTM" at 2024-03-20 opens on 2023-03-21), the day clamped to that
   month's length, so the window is n months to the day and not short by
   the days before the as-of. */
function windowStart(asOf, months) {
  const a = splitIso(asOf);
  if (a.d === daysInMonth(a.y, a.m)) {
    let y = a.y, m = a.m - (months - 1);
    while (m < 1) { m += 12; y -= 1; }
    return monthStart(y, m);
  }
  let y = a.y, m = a.m - months;
  while (m < 1) { m += 12; y -= 1; }
  const sameDay = Math.min(a.d, daysInMonth(y, m));
  if (sameDay < daysInMonth(y, m)) return iso(y, m, sameDay + 1);
  m += 1; if (m > 12) { m = 1; y += 1; }
  return monthStart(y, m);
}

/* the same month and day in another year, the day clamped to that
   month's length (Feb 29 becomes Feb 28) */
function sameDayInYear(asOf, year) {
  const a = splitIso(asOf);
  return iso(year, a.m, Math.min(a.d, daysInMonth(year, a.m)));
}

/* Two-digit years follow the usual pivot: 00-69 are 2000-2069, 70-99 are
   1970-1999. Every two-digit year in the sources is 20xx. */
const fullYear = (s) => (s.length === 4 ? +s : (+s <= 69 ? 2000 + +s : 1900 + +s));
const saneYear = (y) => y >= 1900 && y <= 2100;

/* ---------- dates ---------- */
/**
 * parseDate(text) → "YYYY-MM-DD" or null. The forms the sources print:
 * "June 30, 2026", "Aug. 31, 2026", the slide-10 typo "Aug, 31, 2026",
 * "10-Sep-2026" (the workbook's download stamp and open dates),
 * "10 Sep 2026", "Sep 10 2026", "2026-09-10" and an ISO timestamp, whose
 * date part is taken. Numeric slash dates are refused: 9/10/2026 reads
 * two ways and the sources never write one.
 */
export function parseDate(text) {
  if (text === null || text === undefined) return null;
  const t = String(text).trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(t))) {
    const s = m[1] + "-" + m[2] + "-" + m[3];
    return splitIso(s) ? s : null;
  }
  /* Month d, yyyy — the comma after the month is the deck's typo */
  if ((m = /^([A-Za-z]{3,9})[.,]?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t))) {
    const mo = MONTHS[m[1].toLowerCase()];
    return mo ? checked(+m[3], mo, +m[2]) : null;
  }
  /* d-Mon-yyyy, d Mon yyyy, d Month yyyy */
  if ((m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})\.?[-\s](\d{4})$/.exec(t))) {
    const mo = MONTHS[m[2].toLowerCase()];
    return mo ? checked(+m[3], mo, +m[1]) : null;
  }
  return null;
}
const checked = (y, m, d) => (saneYear(y) && d >= 1 && d <= daysInMonth(y, m) ? iso(y, m, d) : null);

/* ---------- the grammar ---------- */
const result = (grain, start, end, label, extra) =>
  Object.assign({ grain, start, end, label, fiscal: false }, extra || {});
const unresolved = (grain, label, extra) =>
  Object.assign({ grain, start: null, end: null, label, fiscal: false, needsAsOf: true }, extra || {});

/**
 * parsePeriod(label, { asOf }) → { grain, start, end, label, fiscal: false, ...}
 *   or { grain, needsAsOf: true, start: null, end: null } when the label is
 *   a rolling or year-to-date window and no as-of was supplied,
 *   or null when the label is not a period.
 *
 * asOf is the slide's or sheet's as-of date as "YYYY-MM-DD". A window
 * whose end came from it carries asOf in the result.
 */
export function parsePeriod(label, options = {}) {
  if (label === null || label === undefined) return null;
  const raw = String(label).replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const asOf = options.asOf && splitIso(options.asOf) ? options.asOf : null;
  let m;

  /* 1Q20, 1Q 2020, Q3 2018, Q3-2018, Q3'18 */
  if ((m = /^([1-4])\s?Q\s?'?(\d{2}|\d{4})$/i.exec(raw)) || (m = /^Q([1-4])[\s,\-']*(\d{2}|\d{4})$/i.exec(raw))) {
    const q = +m[1], y = fullYear(m[2]);
    return saneYear(y) ? result("quarter", quarterStart(y, q), quarterEnd(y, q), raw, { year: y, quarter: q }) : null;
  }
  /* 1H26, 1H 2026, H1 2026, H1'26 */
  if ((m = /^([12])\s?H\s?'?(\d{2}|\d{4})$/i.exec(raw)) || (m = /^H([12])[\s,\-']*(\d{2}|\d{4})$/i.exec(raw))) {
    const h = +m[1], y = fullYear(m[2]);
    return saneYear(y) ? result("half", halfStart(y, h), halfEnd(y, h), raw, { year: y, half: h }) : null;
  }
  /* 2020 */
  if ((m = /^(\d{4})$/.exec(raw))) {
    const y = +m[1];
    return saneYear(y) ? result("year", iso(y, 1, 1), iso(y, 12, 31), raw, { year: y }) : null;
  }
  /* 2026 YTD (to 10 Sep 2026): the window end is written in the label */
  if ((m = /^(\d{4})\s+YTD\s*\((?:to|through)\s+([^)]+)\)$/i.exec(raw)) || (m = /^YTD\s+(\d{4})\s*\((?:to|through)\s+([^)]+)\)$/i.exec(raw))) {
    const y = +m[1], end = parseDate(m[2]);
    if (!saneYear(y) || !end || !end.startsWith(String(y))) return null;
    return result("ytd", iso(y, 1, 1), end, raw, { year: y });
  }
  /* YTD August 2026: through the month; the as-of pins the day when it
     falls inside that month */
  if ((m = /^YTD\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/i.exec(raw)) || (m = /^([A-Za-z]{3,9})\.?\s+(\d{4})\s+YTD$/i.exec(raw))) {
    const mo = MONTHS[m[1].toLowerCase()], y = +m[2];
    if (!mo || !saneYear(y)) return null;
    const inMonth = asOf && asOf.startsWith(iso(y, mo, 1).slice(0, 7));
    return result("ytd", iso(y, 1, 1), inMonth ? asOf : monthEnd(y, mo), raw,
      inMonth ? { year: y, month: mo, asOf } : { year: y, month: mo });
  }
  /* YTD 2026, 2026 YTD: the end is the as-of, or the as-of's month and
     day in the label's year for the comparable window ("YTD 2025" on an
     August 2026 slide ends Aug 31 2025) */
  if ((m = /^YTD\s+(\d{4})$/i.exec(raw)) || (m = /^(\d{4})\s+YTD$/i.exec(raw))) {
    const y = +m[1];
    if (!saneYear(y)) return null;
    if (!asOf) return unresolved("ytd", raw, { year: y });
    const asOfYear = +asOf.slice(0, 4);
    if (y > asOfYear) return null;
    return result("ytd", iso(y, 1, 1), y === asOfYear ? asOf : sameDayInYear(asOf, y), raw, { year: y, asOf });
  }
  /* Last 3 Months (the deck writes both "Months" and "months") */
  if ((m = /^Last\s+(\d{1,2})\s+Months?$/i.exec(raw))) {
    const n = +m[1];
    const grain = n === 3 ? "rolling3m" : n === 12 ? "rolling12m" : null;
    if (!grain) return null;
    if (!asOf) return unresolved(grain, raw, { months: n });
    return result(grain, windowStart(asOf, n), asOf, raw, { months: n, asOf });
  }
  /* TTM, LTM, trailing twelve months */
  if (/^(TTM|LTM|Trailing\s+(12|twelve)\s+months?)$/i.test(raw)) {
    if (!asOf) return unresolved("rolling12m", raw, { months: 12 });
    return result("rolling12m", windowStart(asOf, 12), asOf, raw, { months: 12, asOf });
  }
  /* As of June 30, 2026 */
  if ((m = /^As\s+of\s+(.+)$/i.exec(raw))) {
    const d = parseDate(m[1]);
    return d ? result("asof", d, d, raw) : null;
  }
  /* Jun-26, Jun-2026, June 2026, Jun 2026, 2026-06 */
  if ((m = /^([A-Za-z]{3,9})\.?[-\s]'?(\d{2}|\d{4})$/.exec(raw))) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) return null;
    const y = fullYear(m[2]);
    return saneYear(y) ? result("month", monthStart(y, mo), monthEnd(y, mo), raw, { year: y, month: mo }) : null;
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(raw))) {
    const y = +m[1], mo = +m[2];
    return saneYear(y) && mo >= 1 && mo <= 12 ? result("month", monthStart(y, mo), monthEnd(y, mo), raw, { year: y, month: mo }) : null;
  }
  /* a bare date is an instant: the workbook's "10-Sep-2026" */
  const d = parseDate(raw);
  if (d) return result("asof", d, d, raw);
  return null;
}

/**
 * looksLikePeriod(label) → whether a label carries period vocabulary (a
 * four-digit year, nQyy, nHyy, YTD, TTM, "Last n Months", "As of", a
 * month-year). The test uses it to tell "this must parse" from "this must
 * not"; a year-range bucket such as "2031 - 2033" looks like a period and
 * is null by design, so the test names it.
 */
export function looksLikePeriod(label) {
  const t = String(label || "").trim();
  return /\b(19|20)\d{2}\b/.test(t) || /^[1-4]\s?Q\s?'?\d{2}$/i.test(t) || /^[12]\s?H\s?'?\d{2}$/i.test(t)
    || /\bYTD\b/i.test(t) || /^(TTM|LTM)$/i.test(t) || /^Last\s+\d+\s+Months?$/i.test(t) || /^As\s+of\b/i.test(t)
    || /^[A-Za-z]{3,9}\.?-\d{2}$/.test(t);
}

/** the distinct grains of a label set, unrecognized labels ignored */
export function grainsOf(labels, options = {}) {
  const out = new Set();
  for (const l of labels || []) {
    const p = parsePeriod(l, options);
    if (p) out.add(p.grain);
  }
  return [...out].sort();
}
