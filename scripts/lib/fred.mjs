/**
 * fred.mjs — one FRED reader for every endpoint that draws on it.
 *
 * api/macro.js carried its own fetch and its own monthly downsampler;
 * the credit page needs the same two plus a keyless path, a percentile
 * over a date window and the recession bands. Two copies of a FRED
 * reader would drift the way the concept lists once did, so the
 * functions live here and both endpoints import them.
 *
 * Two ways to reach FRED:
 *
 *   API   https://api.stlouisfed.org/fred/series/observations — needs a
 *         key, answers JSON, takes an observation_start
 *   CSV   https://fred.stlouisfed.org/graph/fredgraph.csv?id=<ID> — no
 *         key, the whole history, two columns (observation_date and
 *         the id). A holiday on a daily series is a row with an empty
 *         value (FRED writes "." in some exports); both are dropped.
 *
 * fetchSeries() tries the API when FRED_API_KEY is set and falls back
 * to the CSV when the API does not answer (a revoked key, a malformed
 * one, FRED's per-minute limit) or when there is no key, so an endpoint
 * built on it never needs a key to answer and never dies with one.
 * Observations are { date, value } sorted ascending, values as FRED
 * serves them: a percent series is percentage points (2.71 is 2.71%).
 *
 * Source: Federal Reserve Bank of St. Louis, FRED.
 */

const FETCH_TIMEOUT_MS = 12000;

/** FRED's observation endpoint for one series. `start` is an
    observation_start date; the default is macro.js's window (eleven
    years of raw data yields ten years of year-over-year). Pass null to
    take the whole history. */
export async function fredSeries(id, key, start) {
  if (start === undefined) start = new Date(Date.now() - 4100 * 864e5).toISOString().slice(0, 10);
  const url = "https://api.stlouisfed.org/fred/series/observations" +
    "?series_id=" + id + "&api_key=" + key + "&file_type=json" +
    (start ? "&observation_start=" + start : "") + "&sort_order=asc";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.observations || [])
      .map((o) => ({ date: o.date, value: Number(o.value) }))
      .filter((o) => isFinite(o.value));
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** The CSV body → observations. Blank rows (an empty value or ".") are
    dropped; a row that is not a date and a number is dropped too. */
export function parseFredCsv(text, id) {
  const lines = String(text || "").trim().split(/\r?\n/);
  const head = (lines[0] || "").split(",");
  if (head[0] !== "observation_date" || (id && head[1] !== id)) return null;
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].indexOf(",");
    if (c < 0) continue;
    const date = lines[i].slice(0, c), raw = lines[i].slice(c + 1).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || raw === "" || raw === ".") continue;
    const value = Number(raw);
    if (isFinite(value)) out.push({ date, value });
  }
  return out;
}

/** The keyless path: the whole history of one series. */
export async function fetchFredCsv(id) {
  const url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + encodeURIComponent(id);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return parseFredCsv(await r.text(), id);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** API when a key is configured and answers, CSV otherwise. Both paths
    return the same shape from the same start, so a caller cannot tell
    them apart. Without `start` the whole history comes back. */
export async function fetchSeries(id, opts) {
  return (await fetchSeriesVia(id, opts)).obs;
}

/** The same, saying which path answered: { obs, via } with via "api",
    "csv" or null when neither did. A keyed request that comes back
    empty or refused is not an answer; the CSV is tried before giving up. */
export async function fetchSeriesVia(id, { start = null } = {}) {
  const key = process.env.FRED_API_KEY;
  if (key) {
    const viaApi = await fredSeries(id, key, start);
    if (viaApi && viaApi.length) return { obs: viaApi, via: "api" };
  }
  const obs = await fetchFredCsv(id);
  if (!obs) return { obs: null, via: null };
  return { obs: start ? obs.filter((o) => o.date >= start) : obs, via: "csv" };
}

/** Last observation of each calendar month — daily and weekly series
    downsampled so every history draws at the same monthly rhythm. */
export function monthly(obs) {
  if (!obs) return null;
  const by = new Map();
  for (const o of obs) by.set(o.date.slice(0, 7), o);
  return [...by.values()];
}

/** monthly(), in the shape the credit page draws: { d, v } per month. */
export function monthEnd(obs) {
  const m = monthly(obs);
  return m ? m.map((o) => ({ d: o.date, v: o.value })) : null;
}

export const latest = (obs) => (obs && obs.length ? obs[obs.length - 1] : null);

export function atMonthsBack(obs, months) {
  const now = latest(obs);
  if (!now) return null;
  const target = new Date(new Date(now.date) - months * 30.44 * 864e5).getTime();
  let best = null, bestGap = Infinity;
  for (const o of obs) {
    const gap = Math.abs(new Date(o.date).getTime() - target);
    if (gap < bestGap) { bestGap = gap; best = o; }
  }
  return best && bestGap <= 50 * 864e5 ? best : null;
}

export const round = (v) => Math.round(v * 1e6) / 1e6;

/** Index level → year-over-year rate, with a decade of the rate. */
export function asYoY(obs) {
  const m = monthly(obs);
  if (!m || m.length < 14) return null;
  const hist = [];
  for (let i = 12; i < m.length; i++) {
    if (m[i - 12].value !== 0) {
      hist.push([m[i].date, round(m[i].value / m[i - 12].value - 1)]);
    }
  }
  if (!hist.length) return null;
  const now = hist[hist.length - 1];
  const ago = hist.length > 12 ? hist[hist.length - 13] : null;
  return { value: now[1], period: now[0],
           yearAgo: ago ? ago[1] : null, history: hist.slice(-120) };
}

/** A percentage series, as fractions, with its decade. */
export function asRate(obs) {
  const m = monthly(obs);
  if (!m || !m.length) return null;
  const hist = m.map((o) => [o.date, round(o.value / 100)]);
  const now = latest(m), ago = atMonthsBack(m, 12);
  return { value: now.value / 100, period: now.date,
           yoyPp: ago ? round((now.value - ago.value) / 100) : null,
           history: hist.slice(-120) };
}

/** A raw level, with its decade and a year-over-year change. */
export function asLevel(obs) {
  const m = monthly(obs);
  if (!m || !m.length) return null;
  const hist = m.map((o) => [o.date, o.value]);
  const now = latest(m), ago = atMonthsBack(m, 12);
  return { value: now.value, period: now.date,
           yoy: ago && ago.value !== 0 ? round(now.value / ago.value - 1) : null,
           history: hist.slice(-120) };
}

/** The same calendar day `years` earlier, as YYYY-MM-DD. */
function yearsBefore(date, years) {
  return String(Number(date.slice(0, 4)) - years) + date.slice(4);
}

/**
 * Where the latest value sits among the observations dated within the
 * last `years` years — a date window anchored on the latest
 * observation, never a count, so a daily series and a quarterly one
 * are placed against the same span of history. A series shorter than
 * the window is placed against what it has (the ICE BofA spreads run
 * three years), and windowStart says so.
 *
 * p is the percentile rank with ties split: 100 × (below + ½ equal) ÷ n.
 */
export function percentileInWindow(obs, { years = 10 } = {}) {
  const now = latest(obs);
  if (!now) return null;
  const from = yearsBefore(now.date, years);
  const win = obs.filter((o) => o.date >= from);
  let below = 0, equal = 0;
  for (const o of win) {
    if (o.value < now.value) below++;
    else if (o.value === now.value) equal++;
  }
  const n = win.length;
  return { p: Math.round((100 * (below + 0.5 * equal) / n) * 10) / 10, n,
           windowStart: win[0].date, windowEnd: now.date };
}

/** USREC (monthly, 1 in a recession month) → contiguous bands, each
    from its first recession month to its last, dated on the first of
    the month as FRED dates them. */
export function recessionsFromUsrec(obs) {
  if (!obs) return null;
  const out = [];
  let open = null;
  for (const o of obs) {
    if (o.value === 1) {
      if (!open) open = { start: o.date, end: o.date };
      else open.end = o.date;
    } else if (open) {
      out.push(open);
      open = null;
    }
  }
  if (open) out.push(open);
  return out;
}

/** num ÷ den on the dates both carry, scaled (100 for a share in
    percent). Used for the H.8 share of bank credit lent to nondepository
    financial institutions. */
export function ratioOf(num, den, { scale = 1 } = {}) {
  if (!num || !den) return null;
  const d = new Map(den.map((o) => [o.date, o.value]));
  const out = [];
  for (const o of num) {
    const v = d.get(o.date);
    if (v) out.push({ date: o.date, value: round(o.value / v * scale) });
  }
  return out;
}

/* Observation frequency per series, as FRED states it on the series
   page (fetched 2026-09-11; each at https://fred.stlouisfed.org/series/<ID>).
   Daily is the default; only the exceptions are listed. */
const FREQ = {
  NFCI: "weekly", STLFSI4: "weekly", LNFACBW027SBOG: "weekly", TOTBKCR: "weekly",
  BUSLOANS: "monthly", USREC: "monthly",
  DRTSCILM: "quarterly", DRTSCIS: "quarterly", DRSDCILM: "quarterly",
  DRBLACBS: "quarterly", CORBLACBS: "quarterly",
};

export function freqOf(id) {
  return FREQ[id] || "daily";
}

/* What the percentile window is called on the tile. FRED serves the
   six ICE BofA spread and yield series from September 2023 only (the
   series notes: "Starting in April 2026, this series will only include
   3 years of observations"), SOFR from 2018-04-03 and its 90-day
   average from 2018-07-02; the SLOOS and delinquency series are
   quarterly, so ten years is about forty points. Everything else
   carries a full ten years. */
const THREE_YEAR = ["BAMLH0A0HYM2", "BAMLC0A0CM", "BAMLH0A1HYBB", "BAMLH0A2HYB", "BAMLH0A3HYC", "BAMLH0A0HYM2EY"];

export function windowLabelOf(id) {
  if (THREE_YEAR.includes(id)) return "3-year";
  if (id === "SOFR" || id === "SOFR90DAYAVG") return "since 2018";
  if (freqOf(id) === "quarterly") return "quarterly";
  return "10-year";
}
