/**
 * test-fred.mjs — the shared FRED reader against real downloads.
 *
 * scripts/fixtures/fred/*.csv are fredgraph.csv files fetched keyless
 * on 2026-09-11: BAMLH0A0HYM2, SOFR, DRTSCILM and LNFACBW027SBOG whole,
 * USREC from 1986 and TOTBKCR from 2015. Every figure below is read off
 * those files or worked out by hand from them in this file; the two
 * H.8 share values are the ones the blueprint (section 3.1) states from
 * the 2026-09-10 probe: 10.1% at Jun 30 2026 and 3.5% in June 2016.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFredCsv, monthly, monthEnd, percentileInWindow, recessionsFromUsrec,
         ratioOf, freqOf, windowLabelOf, atMonthsBack, fetchSeriesVia } from "./lib/fred.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const raw = (id) => readFileSync(join(here, "fixtures/fred/" + id + ".csv"), "utf8");
const fixture = (id) => parseFredCsv(raw(id), id);
const rows = (id) => raw(id).trim().split("\n").length - 1;
const blanks = (id) => raw(id).split("\n").filter((l) => /^\d{4}-\d{2}-\d{2},\s*$/.test(l)).length;
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};
const near = (v, target, tol) => typeof v === "number" && Math.abs(v - target) <= tol;

/* ---- blank rows -------------------------------------------------------- */
const HY = fixture("BAMLH0A0HYM2");
const SOFR = fixture("SOFR");
check("the HY file carries 795 rows, 8 of them blank holidays", rows("BAMLH0A0HYM2") === 795 && blanks("BAMLH0A0HYM2") === 8,
  rows("BAMLH0A0HYM2") + " rows, " + blanks("BAMLH0A0HYM2") + " blank");
check("blank rows are dropped: 795 − 8 = 787 observations", HY.length === 787, String(HY.length));
check("the SOFR file carries 2,203 rows, 95 of them blank", rows("SOFR") === 2203 && blanks("SOFR") === 95);
check("2,203 − 95 = 2,108 SOFR observations", SOFR.length === 2108, String(SOFR.length));
check("Christmas 2025 is not an observation", !HY.some((o) => o.date === "2025-12-25") && !SOFR.some((o) => o.date === "2025-12-25"));
check("the first and last HY rows are read as dated numbers",
  HY[0].date === "2023-09-12" && HY[0].value === 3.84 && HY[786].date === "2026-09-10" && HY[786].value === 2.7);
check("a \".\" value is a blank too", (parseFredCsv("observation_date,X\n2020-01-01,1.5\n2020-01-02,.\n2020-01-03,2", "X") || []).length === 2);
check("a file for another series is refused", parseFredCsv(raw("SOFR"), "BAMLH0A0HYM2") === null);

/* ---- month ends -------------------------------------------------------- */
const hyMonths = monthEnd(HY);
const at = (list, ym) => list.find((p) => p.d.startsWith(ym));
check("HY spans 37 calendar months", hyMonths.length === 37, String(hyMonths.length));
check("December 2025 is its last trading day, Dec 31 (2.81)", at(hyMonths, "2025-12").d === "2025-12-31" && at(hyMonths, "2025-12").v === 2.81);
check("September 2023 ends on the month-end weekend row FRED carries (Sep 30)", at(hyMonths, "2023-09").d === "2023-09-30" && at(hyMonths, "2023-09").v === 4.03);
check("a partial month is its latest observation", hyMonths[36].d === "2026-09-10" && hyMonths[36].v === 2.7);
check("SOFR: 102 months, December 2025 = Dec 31 (3.87)", monthEnd(SOFR).length === 102 && at(monthEnd(SOFR), "2025-12").v === 3.87);
/* macro.js reads the same downsampler in its own shape */
const m = monthly(HY);
check("monthly() keeps macro.js's { date, value } shape", m.length === 37 && m[36].date === "2026-09-10" && m[36].value === 2.7);

/* ---- the percentile, by hand -------------------------------------------
   Latest HY OAS: 2.70 on 2026-09-10. The window runs ten years back to
   2016-09-10; every one of the 787 observations is dated after that
   (FRED serves the series from 2023-09-12), so n = 787. Sorted
   ascending, the values below 2.70 fill positions 1–77 and the nine
   values equal to 2.70 fill positions 78–86. Ties split:
     p = 100 × (77 + 9 ÷ 2) ÷ 787 = 10.3558… → 10.4 */
const sorted = HY.map((o) => o.value).sort((a, b) => a - b);
const firstEq = sorted.indexOf(2.7) + 1, lastEq = sorted.lastIndexOf(2.7) + 1;
check("sorted: 2.70 occupies positions 78 through 86", firstEq === 78 && lastEq === 86, firstEq + "–" + lastEq);
const below = firstEq - 1, equal = lastEq - firstEq + 1;
check("77 below, 9 equal, 787 in the window", below === 77 && equal === 9 && sorted.length === 787);
const hand = Math.round(100 * (below + equal / 2) / sorted.length * 10) / 10;
const pct = percentileInWindow(HY, { years: 10 });
check("the hand calculation is 10.4", hand === 10.4, String(hand));
check("percentileInWindow agrees", pct.p === hand && pct.n === 787, JSON.stringify(pct));
check("the window is dated, and says where the data begins", pct.windowStart === "2023-09-12" && pct.windowEnd === "2026-09-10");
const sofrPct = percentileInWindow(SOFR, { years: 10 });
check("SOFR's window starts where FRED starts it, 2018-04-03, n 2,108", sofrPct.windowStart === "2018-04-03" && sofrPct.n === 2108, JSON.stringify(sofrPct));
const D = fixture("DRTSCILM");
const dPct = percentileInWindow(D, { years: 10 });
check("a quarterly series gets a date window, not a count: 41 points from 2016-07-01 to 2026-07-01",
  dPct.n === 41 && dPct.windowStart === "2016-07-01" && dPct.windowEnd === "2026-07-01", JSON.stringify(dPct));
check("DRTSCILM has 146 quarters from 1990-04-01, none blank", D.length === 146 && D[0].date === "1990-04-01" && D[145].value === 0);

/* ---- the year-ago comparator -------------------------------------------
   SOFR's latest fixture row is 2026-09-10 (3.62). Twelve months back on
   the same date is 2025-09-10 (4.39 in the file), so the change is −77
   bps; the September 2025 month-end row, 2025-09-30, is 4.24 and sits
   after the September 17 step (4.38 → 4.14 on the 18th), which is why
   the tile compares same dates, not month ends. */
const ago = atMonthsBack(SOFR, 12);
check("SOFR a year before 2026-09-10 is the 2025-09-10 row, 4.39", ago && ago.date === "2025-09-10" && ago.value === 4.39, JSON.stringify(ago));
check("the same-date change is −77 bps, not the month-end −62", Math.round((3.62 - ago.value) * 100) === -77 && Math.round((3.62 - 4.24) * 100) === -62);
check("a quarterly series finds its own quarter a year back", atMonthsBack(D, 12).date === "2025-07-01");

/* ---- labels and frequencies ------------------------------------------- */
check("the six ICE BofA ids say 3-year", ["BAMLH0A0HYM2", "BAMLC0A0CM", "BAMLH0A1HYBB", "BAMLH0A2HYB", "BAMLH0A3HYC", "BAMLH0A0HYM2EY"].every((id) => windowLabelOf(id) === "3-year"));
check("SOFR and its 90-day average say since 2018", windowLabelOf("SOFR") === "since 2018" && windowLabelOf("SOFR90DAYAVG") === "since 2018");
check("the SLOOS and delinquency series say quarterly", ["DRTSCILM", "DRTSCIS", "DRSDCILM", "DRBLACBS", "CORBLACBS"].every((id) => windowLabelOf(id) === "quarterly"));
check("everything else says 10-year", windowLabelOf("BAA10Y") === "10-year" && windowLabelOf("NFCI") === "10-year" && windowLabelOf("BUSLOANS") === "10-year");
check("freqOf: daily by default, weekly, monthly and quarterly where FRED says so",
  freqOf("SOFR") === "daily" && freqOf("NFCI") === "weekly" && freqOf("TOTBKCR") === "weekly" &&
  freqOf("BUSLOANS") === "monthly" && freqOf("USREC") === "monthly" && freqOf("DRBLACBS") === "quarterly");

/* ---- recessions ---------------------------------------------------------
   USREC follows FRED's trough method: a recession runs from the month
   after the NBER peak through the trough month, so the 2007–09 band
   starts 2008-01-01 (December 2007, the peak, is 0 in the file) and
   the 2020 band is March and April. */
const R = recessionsFromUsrec(fixture("USREC"));
const has = (s, e) => R.some((r) => r.start === s && r.end === e);
check("four recessions since 1986", R.length === 4, JSON.stringify(R));
check("2020-03-01 through 2020-04-01", has("2020-03-01", "2020-04-01"));
check("2008-01-01 through 2009-06-01", has("2008-01-01", "2009-06-01"));
check("1990-08-01 through 1991-03-01 and 2001-04-01 through 2001-11-01", has("1990-08-01", "1991-03-01") && has("2001-04-01", "2001-11-01"));
check("the USREC fixture starts in 1986 and holds 36 recession months", fixture("USREC")[0].date === "1986-01-01" && fixture("USREC").filter((o) => o.value === 1).length === 36);

/* ---- the H.8 share ------------------------------------------------------
   LNFACBW027SBOG ÷ TOTBKCR on matching Wednesdays, the last of each
   month. Blueprint 3.1 (probe 2026-09-10): 10.1% at Jun 30 2026, 3.5%
   in June 2016. The fixture rows: 2026-06-24, 1985.5242 ÷ 19675.1991
   = 10.09%; 2016-06-29, 412.9167 ÷ 11820.0984 = 3.49%. */
const share = monthEnd(ratioOf(fixture("LNFACBW027SBOG"), fixture("TOTBKCR"), { scale: 100 }));
check("the share series is monthly from January 2015", share[0].d === "2015-01-28" && share.length === 140, share[0].d + " × " + share.length);
check("June 2026: 10.1% ± 0.15 (last Wednesday, Jun 24)", at(share, "2026-06").d === "2026-06-24" && near(at(share, "2026-06").v, 10.1, 0.15), String(at(share, "2026-06").v));
check("June 2016: 3.5% ± 0.1 (Jun 29)", at(share, "2016-06").d === "2016-06-29" && near(at(share, "2016-06").v, 3.5, 0.1), String(at(share, "2016-06").v));
check("ratioOf refuses a missing side", ratioOf(null, fixture("TOTBKCR")) === null);

/* ---- the keyed path falls back to the CSV --------------------------------
   fetch is stubbed: the API answers 400 (a refused key) and the CSV
   answers the SOFR fixture. The reader must come back through the CSV
   and say so, not return nothing because a key was set. */
{
  const realFetch = globalThis.fetch, realKey = process.env.FRED_API_KEY;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (/api\.stlouisfed\.org/.test(url)) return { ok: false, status: 400, json: async () => ({}), text: async () => "" };
    return { ok: true, status: 200, text: async () => raw("SOFR") };
  };
  try {
    process.env.FRED_API_KEY = "refused-key";
    const r = await fetchSeriesVia("SOFR");
    check("a refused key falls through to the CSV", r.via === "csv" && r.obs && r.obs.length === 2108, JSON.stringify({ via: r.via, n: r.obs && r.obs.length }));
    check("the API was tried first, then fredgraph.csv", calls.length === 2 && /api\.stlouisfed\.org/.test(calls[0]) && /fredgraph\.csv\?id=SOFR/.test(calls[1]), calls.join(" | "));
    check("a start date still filters the CSV path (2026-01-01 is a blank row; Jan 2 is first)", (await fetchSeriesVia("SOFR", { start: "2026-01-01" })).obs[0].date === "2026-01-02");
    delete process.env.FRED_API_KEY;
    calls.length = 0;
    const k = await fetchSeriesVia("SOFR");
    check("without a key the CSV is the only call", k.via === "csv" && calls.length === 1 && /fredgraph/.test(calls[0]));
    globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => "" });
    const dead = await fetchSeriesVia("SOFR");
    check("when neither path answers, via is null and obs is null", dead.via === null && dead.obs === null);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.FRED_API_KEY; else process.env.FRED_API_KEY = realKey;
  }
}

console.log(failed ? "\n" + failed + " failed" : "\nall fred checks pass");
process.exit(failed ? 1 : 0);
