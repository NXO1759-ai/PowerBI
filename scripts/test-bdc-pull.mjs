/**
 * test-bdc-pull.mjs — /api/bdc-pull against real SEC EDGAR, live.
 *
 * The handler is invoked in-process with a mock request and response
 * (the scripts/smoke.mjs pattern): no deployment is needed, and the real
 * code path runs against the real network, since the point of this
 * endpoint is a fresh companyfacts pull — a fixture would only re-test
 * what scripts/test-bdc-series.mjs already covers offline.
 *
 * Three live tickers, chosen to exercise both sides of the fiscal-Q4
 * overlay skip (the quarter already in hand, AND the quarter the overlay
 * would add): ARCC (calendar fiscal year, fyEndMonth 12), PSEC (fiscal
 * year to June, fyEndMonth 6 — its freshest quarter most of the year IS
 * its own fiscal Q4, exercising the in-hand skip), and GBDC (fiscal year
 * to September, fyEndMonth 9 — the calendar quarter the overlay would
 * add is its fiscal Q4 for most of the year, exercising the candidate
 * skip; universe.json's other September-FY filers are GLAD, OCSL, PFLT,
 * PFX and PNNT). Every live case checks the shape/finiteness invariants
 * AND the Q4-skip invariant below, which holds regardless of which
 * quarter SEC happens to have on file the day this runs — unlike pinning
 * a specific liveOverlaySkipped value, which would go stale.
 *
 * Beyond the three live pulls: a ticker outside the tracked universe
 * (404), a request with no ticker (400), and a rapid run past the rate
 * gate's burst (429). The gate's in-memory bucket is reset before each
 * section so one section's calls cannot spend another's budget.
 */
process.env.SEC_USER_AGENT = process.env.SEC_USER_AGENT ||
  "Research Terminal research@chineduokeke.mba";

/* the same mock the smoke suite hands a handler */
function mockRes() {
  const r = { headers: {}, code: null, body: null,
    setHeader(k, v) { r.headers[k] = v; },
    status(c) { r.code = c; return r; },
    json(b) { r.body = b; return r; },
    end() { return r; } };
  return r;
}

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};
const isObj = (x) => x && typeof x === "object";

const { default: handler } = await import("../api/bdc-pull.js");

async function call(query) {
  const res = mockRes();
  await handler({ query: query || {}, headers: {} }, res);
  return res;
}

/* the rate gate keeps its bucket on globalThis, the same way the price
   history cache does; clearing it between sections isolates each one */
const resetGate = () => { if (globalThis.__rlBuckets) globalThis.__rlBuckets.clear(); };

/* --- shared shape + fiscal-Q4-skip checks, run against every live ticker */
async function checkLiveTicker(ticker) {
  resetGate();
  const res = await call({ ticker });
  check(ticker + " answers 200, or a clean network failure (502/504)",
    [200, 502, 504].includes(res.code), "got " + res.code + " " + JSON.stringify(res.body).slice(0, 200));

  if (res.code !== 200) {
    console.log("       warning: " + ticker + "'s live pull did not complete (" +
      (res.body && res.body.error) + "); the shape checks did not run");
    return;
  }

  const b = res.body;
  check(ticker + ": Cache-Control is no-store", res.headers["Cache-Control"] === "no-store");
  check(ticker + ": shape: ticker, cik, fyEndMonth, quarter, values",
    b.ticker === ticker && Number.isInteger(b.cik) && Number.isInteger(b.fyEndMonth) &&
    isObj(b.quarter) && typeof b.quarter.end === "string" && isObj(b.values),
    JSON.stringify(b).slice(0, 200));
  check(ticker + ": liveOverlaySkipped is a boolean and liveOverlay explains it either way",
    typeof b.liveOverlaySkipped === "boolean" && isObj(b.liveOverlay));

  /* the fiscal-Q4-skip invariant: never pin which side fires (that goes
     stale as filings land), only that whichever side fires is the right
     one for the quarter SEC has on file today. Covers BOTH halves of the
     skip — the quarter already in hand (quarter.fq === 4) and the
     quarter the overlay would ADD (liveOverlay.candidateQuarterEnd) —
     which is exactly the distinction a month-string re-derivation from
     the in-hand quarter alone got wrong for every non-calendar filer. */
  check(ticker + ": quarter.fq is 1-4", [1, 2, 3, 4].includes(b.quarter.fq), String(b.quarter.fq));
  if (b.quarter.fq === 4) {
    check(ticker + ": a quarter already at its own fiscal Q4 always skips the overlay",
      b.liveOverlaySkipped === true, JSON.stringify(b.liveOverlay));
  }
  if (b.liveOverlaySkipped) {
    check(ticker + ": a skipped overlay's reason names the fourth quarter and the annual re-derivation",
      /fourth quarter/.test(String(b.liveOverlay.reason)) && /annual/.test(String(b.liveOverlay.reason)),
      b.liveOverlay.reason);
  } else {
    /* framesChecked lists the concepts that actually matched a frame —
       never pinned above zero: the candidate calendar quarter can still
       be open (no filer has filed for it yet) the day this runs, in
       which case every rung of every concept's ladder legitimately comes
       back empty and framesChecked is []. That is a real, correct
       answer, not a broken overlay — only the field's own shape is
       checked here. */
    check(ticker + ": a live overlay records the concepts it checked (an array, possibly empty if the candidate quarter has not been filed yet)",
      Array.isArray(b.liveOverlay.framesChecked) && typeof b.liveOverlay.candidateQuarterEnd === "string");
    const candidateMonth = Number(String(b.liveOverlay.candidateQuarterEnd).slice(5, 7));
    check(ticker + ": when the overlay runs, the quarter it adds is never the filer's own fiscal Q4",
      candidateMonth !== b.fyEndMonth,
      "candidate " + b.liveOverlay.candidateQuarterEnd + " fyEndMonth " + b.fyEndMonth);
  }

  /* never pin a number that will go stale — only that the committed
     shape holds and every headline figure is a real, finite number.
     source can legitimately be "companyfacts" OR "frames" — values is
     series.latest now, which serves whichever is the newest non-null
     figure for that concept, and companyfacts intermittently lags
     frames by weeks (blueprint 7.4). The invariant that actually matters
     is narrower: a value's source is "frames" only when its own `end`
     is the exact candidate quarter the overlay checked, never otherwise. */
  const keys = ["portfolioFairValue", "portfolioCost", "navPerShare", "niiAfterTax", "niiPerShare", "netAssets"];
  const candidateEnd = b.liveOverlay && b.liveOverlay.candidateQuarterEnd;
  for (const k of keys) {
    const v = b.values[k];
    check(ticker + ": " + k + " is present, finite, and in the committed { v, tag, periodType, source } shape",
      isObj(v) && Number.isFinite(v.v) && typeof v.tag === "string" &&
      typeof v.periodType === "string" && (v.source === "companyfacts" || v.source === "frames"),
      JSON.stringify(v));
    check(ticker + ": " + k + "'s source is \"frames\" only on the exact quarter the overlay merged",
      v.source === "frames" ? v.end === candidateEnd : true,
      JSON.stringify(v) + " candidateQuarterEnd=" + candidateEnd);
  }
  console.log("       " + ticker + " " + b.quarter.end + " (fy" + b.quarter.fy + "q" + b.quarter.fq + ") — " +
    "NAV/share " + b.values.navPerShare.v + " · NII after tax " + b.values.niiAfterTax.v +
    " (liveOverlaySkipped: " + b.liveOverlaySkipped + ")");
}

/* --- ARCC: calendar fiscal year (fyEndMonth 12) -------------------------- */
await checkLiveTicker("ARCC");

/* --- PSEC: fiscal year to June (fyEndMonth 6) — exercises the in-hand
   skip most of the year, since its freshest resolvable quarter is often
   its own fiscal Q4 ---------------------------------------------------- */
await checkLiveTicker("PSEC");

/* --- GBDC: fiscal year to September (fyEndMonth 9) — exercises the
   CANDIDATE skip (the bug this file was added to catch): the calendar
   quarter the overlay would add is GBDC's fiscal Q4 for most of the
   year, which the old month-string check on the quarter already in hand
   never tested ------------------------------------------------------- */
await checkLiveTicker("GBDC");

/* --- a ticker outside the tracked universe ------------------------------ */
resetGate();
let res = await call({ ticker: "ZZZZNOTREAL" });
check("a ticker outside the universe answers 404 with a JSON error",
  res.code === 404 && isObj(res.body) && typeof res.body.error === "string" && /universe/.test(res.body.error),
  JSON.stringify(res.body));

/* --- a missing ticker ---------------------------------------------------- */
resetGate();
res = await call({});
check("a missing ticker answers 400 with a JSON error",
  res.code === 400 && isObj(res.body) && /ticker/.test(res.body.error));

/* --- the rate gate: a rapid run past the burst is refused ---------------- */
resetGate();
const g1 = await call({ ticker: "NOTREAL1" });
const g2 = await call({ ticker: "NOTREAL1" });
const g3 = await call({ ticker: "NOTREAL1" });
check("the first two rapid calls are inside the burst (burst 2; both 404, not 429)",
  g1.code !== 429 && g2.code !== 429, g1.code + " / " + g2.code);
check("a rapid third call within the same burst window is gated (429)",
  g3.code === 429 && isObj(g3.body) && typeof g3.body.error === "string",
  "got " + g3.code + " " + JSON.stringify(g3.body));

console.log(failed ? "\n" + failed + " failed" : "\nall bdc-pull checks pass");
process.exit(failed ? 1 : 0);
