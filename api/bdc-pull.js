/**
 * /api/bdc-pull.js — Vercel serverless function.
 *
 * On-demand refresh for one listed business development company: a live
 * SEC EDGAR companyfacts pull, run through buildBdcSeries — the same
 * quarter-building module the weekly refresh uses — so a company pulled
 * here and the same company in the exported set are one implementation's
 * numbers, not two:
 *   GET /api/bdc-pull?ticker=ARCC
 *
 * frontend/data/bdc/universe.json (written weekly) supplies the CIK and
 * the fiscal-year-end month; a ticker outside it answers 404 rather than
 * guessing one. The freshest resolvable quarter's values are served in
 * the same { v, tag, periodType, source, ... } shape the committed
 * frontend/data/bdc/company-*.json files carry under series.periods[].values,
 * so a future UI can render a live pull identically to a committed one.
 *
 * A companyfacts pull is a full-history fetch (blueprint 7.4), not a
 * cheap one, so this endpoint is rate-gated tighter than a cache-served
 * route (burst 2, 3 a minute) and never cached: every reply carries
 * Cache-Control: no-store.
 *
 * Blueprint 7.6: after the companyfacts quarter is built, SEC frame calls
 * for six concepts (the anchors buildBdcSeries itself keys a period on,
 * plus debt and net investment income — the NII and debt chains of 4.2)
 * check whether the calendar quarter right after it already has a filing
 * on frames — which can run ahead of companyfacts by weeks
 * (scripts/lib/bdc-concepts.mjs) — and merges it in when it does. debt and
 * niiAfterTax are each a ladder of tags (bdc-concepts.mjs's own steps, the
 * same ladder scripts/refresh-bdc.mjs walks): the concept's rungs are
 * tried live, in order, and the walk stops at the first rung whose frame
 * carries this filer's row, so a call budget bounded by concepts, not raw
 * HTTP calls — the wall-clock deadline below is what actually caps it.
 * That overlay is skipped outright when the freshest quarter companyfacts
 * already gives is this filer's fiscal fourth quarter: a fourth quarter
 * is the fiscal year's 10-K figure less the filer's own first three
 * quarters, a full annual re-derivation that a single calendar-quarter
 * frame cannot stand in for, so attempting one would only risk serving a
 * partial, wrongly-based figure over a correct derived one.
 *
 * The response's `values` is series.latest, not the freshest single
 * period's own row: mergeFrames only sets the concepts the overlay
 * actually merged onto that new period, leaving every other concept null
 * on it, so serving the period verbatim would blank most of a row the
 * overlay did not touch. series.latest instead carries, per concept, the
 * newest non-null value found across every kept period — the frame
 * quarter's figure for whatever the overlay merged, last quarter's
 * companyfacts figure for everything else — each value still carrying its
 * own `source` and `end`, so a consumer can always see which quarter a
 * given figure came from.
 *
 * Nothing here touches the schedule-of-investments holdings pull or
 * writes under frontend/data — this is the headline-quarter refresh
 * only, and it is not yet called from anywhere on this branch. The
 * Lenders view's per-BDC drill-down (a sibling PR, not on this branch)
 * is expected to wire its own "Refresh" control to
 * GET /api/bdc-pull?ticker=<row.ticker> once that view exists; this
 * endpoint is complete and independently testable ahead of that wiring.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCompanyFactsRaw, fetchFrame } from "../scripts/lib/sec-pull.mjs";
import { buildBdcSeries, mergeFrames, BDC_CONCEPTS } from "../scripts/lib/bdc-concepts.mjs";
import { fiscalQuarterFor } from "../scripts/lib/statements.mjs";
import { gate } from "../scripts/lib/ratelimit.mjs";
import { jsonSafe } from "../scripts/lib/handler.mjs";

/* api/pull.js's own headroom: a 40s deadline inside a 60s ceiling, so the
   platform's own overhead and JSON serialization never race the deadline
   itself. maxDuration must stay comfortably above DEADLINE_MS below. */
export const maxDuration = 60;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TICKER_RE = /^[A-Z0-9.-]{1,12}$/;

/* One wall-clock budget for the WHOLE pull — companyfacts plus every
   frame call that follows it — not one deadline over the first call
   only. Blueprint 7.6: "one companyfacts call plus at most six frames
   calls raced against the 40-second deadline." A companyfacts call that
   uses its full share leaves little for the overlay loop; the loop below
   checks the remaining budget before every frame call and stops early
   rather than running past it, so this endpoint can never be killed at
   maxDuration and served as the platform's HTML error page (the api/pull.js
   failure mode this file otherwise follows). */
const DEADLINE_MS = 40000;
/* per frame call's own ceiling, further capped by whatever budget is
   actually left when that call starts (see the overlay loop) */
const FRAME_TIMEOUT_MS = 8000;
/* a sentinel distinct from `null` — fetchCompanyFactsRaw's own "EDGAR has
   nothing for this CIK" answer — so a real timeout is never reported as
   the wrong kind of failure (finding: CIK 404 misread as a 35s timeout) */
const TIMED_OUT = Symbol("bdc-pull timeout");
/* the headline quarter only, with enough trailing context for the Q4
   and share-count guards inside buildBdcSeries to have their neighbours
   — nowhere near the ~32 quarters the committed company files carry */
const QUARTERS_KEPT = 8;
/* six concepts (blueprint 7.6): the anchors buildBdcSeries itself keys a
   period on, plus the debt and NII chains of 4.2. niiPerShare is left out
   on purpose — it is a YTD duration concept and mergeFrames's own span
   check (spanClass !== "3M") rejects every frame row for it regardless,
   so fetching it here would only spend budget on a call that can never
   merge. */
const OVERLAY_CONCEPTS = [
  "navPerShare", "portfolioFairValue", "portfolioCost",
  "netAssets", "niiAfterTax", "debt",
];

let universeCache = null;
function loadUniverse() {
  if (universeCache) return universeCache;
  const raw = readFileSync(join(ROOT, "frontend/data/bdc/universe.json"), "utf8");
  const parsed = JSON.parse(raw);
  universeCache = Array.isArray(parsed.rows) ? parsed.rows : [];
  return universeCache;
}

/* same calendar arithmetic as bdc-concepts.mjs's private helpers, kept
   local rather than reaching into that module's internals */
const monthEndOf = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
function shiftMonthEnd(iso, months) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
  const t = y * 12 + (m - 1) + months;
  return monthEndOf(Math.floor(t / 12), (t % 12) + 1);
}
/* SEC's frames endpoint indexes by calendar quarter regardless of a
   filer's own fiscal calendar: "CY2026Q2" for a duration concept,
   "CY2026Q2I" for an instant one (scripts/lib/sec-pull.mjs). */
function calendarFrameOf(iso, instant) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
  return `CY${y}Q${Math.ceil(m / 3)}${instant ? "I" : ""}`;
}

async function withTimeout(promise, ms, onTimeout = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(onTimeout), ms)),
  ]);
}

/* one concept's frame, resolved the way scripts/refresh-bdc.mjs's
   stepPayload resolves it live: the concept's tags are a ladder (a single
   string tag, or a { minus: [a, b] } subtraction of two), tried in order,
   and the walk stops at the first rung whose frame carries a row for this
   CIK — the same short-circuit stepPayload gets for free from its
   pre-fetched cache, done here with live calls instead so this endpoint
   never spends more of the shared deadline than the ladder actually
   needs. A subtraction rung answers only when both tags' frames carry
   this filer's row for the same span (start and end); the resolved value
   still carries `tag` as `a-b` so a consumer can tell it was derived. */
async function fetchConceptFrame(concept, candidateEnd, cik, deadlineAt) {
  const isInstant = concept.kind === "instant";
  const frame = calendarFrameOf(candidateEnd, isInstant);
  for (let i = 0; i < concept.tags.length; i++) {
    const step = concept.tags[i];
    const remaining = deadlineAt - Date.now();
    if (remaining < 1000) return { payload: null, truncated: true };
    const frameTimeoutMs = Math.min(FRAME_TIMEOUT_MS, remaining);
    if (typeof step === "string") {
      const payload = await withTimeout(
        fetchFrame(step, concept.unit, frame, { timeoutMs: frameTimeoutMs, retries: 0 }),
        frameTimeoutMs);
      const row = payload && Array.isArray(payload.data) ? payload.data.find((r) => Number(r.cik) === cik) : null;
      if (row) return { payload: { ...payload, step: i + 1 }, truncated: false };
      continue;
    }
    const [aPayload, bPayload] = await Promise.all(step.minus.map((tag) => withTimeout(
      fetchFrame(tag, concept.unit, frame, { timeoutMs: frameTimeoutMs, retries: 0 }),
      frameTimeoutMs)));
    const ra = aPayload && Array.isArray(aPayload.data) ? aPayload.data.find((r) => Number(r.cik) === cik) : null;
    const rb = bPayload && Array.isArray(bPayload.data) ? bPayload.data.find((r) => Number(r.cik) === cik) : null;
    if (ra && rb && ra.end === rb.end && (ra.start || null) === (rb.start || null)) {
      return {
        payload: { ...aPayload, tag: step.minus.join("-"), step: i + 1, data: [{ ...ra, val: ra.val - rb.val }] },
        truncated: false,
      };
    }
  }
  return { payload: null, truncated: false };
}

export default jsonSafe(async function handler(req, res) {
  /* a companyfacts pull is never worth caching downstream — every reply
     is this filer's freshest resolvable answer or a clean failure */
  res.setHeader("Cache-Control", "no-store");

  const q = req.query || {};
  const ticker = String(q.ticker || "").trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: "ticker required" });
  if (!TICKER_RE.test(ticker)) {
    return res.status(400).json({ error: "ticker must be 1-12 characters: A-Z, 0-9, dot or dash" });
  }

  /* a full companyfacts pull is a real cost; gated before any network
     call is made. Named so this endpoint's bucket and daily count are its
     own — not shared with every other gated endpoint on the site, which
     is what let a page's ordinary Refresh traffic (or a looser public
     endpoint) drain or amplify a differently-named caller's budget. */
  const refused = gate(req, { name: "bdc-pull", burst: 2, ratePerMin: 3, cost: 1, sameOrigin: true });
  if (refused) return res.status(refused.status).json(refused.body);

  const row = loadUniverse().find((r) => String(r.ticker || "").toUpperCase() === ticker);
  if (!row) {
    return res.status(404).json({
      error: `${ticker} is not in the tracked BDC universe ` +
             "(frontend/data/bdc/universe.json). This endpoint pulls one of " +
             "the 814-file-numbered listed BDCs the weekly refresh already covers.",
    });
  }
  if (!Number.isInteger(row.fyEndMonth) || row.fyEndMonth < 1 || row.fyEndMonth > 12) {
    return res.status(502).json({
      error: `${ticker}'s universe row carries no usable fiscal-year-end month; cannot build its quarters.`,
    });
  }

  try {
    /* the one wall-clock budget for the whole pull, companyfacts and
       every frame call after it; nothing below is allowed to run past it */
    const deadlineAt = Date.now() + DEADLINE_MS;

    const facts = await withTimeout(
      fetchCompanyFactsRaw(row.cik, { timeoutMs: 20000, retries: 1 }),
      Math.max(1000, deadlineAt - Date.now()), TIMED_OUT);
    if (facts === TIMED_OUT) {
      return res.status(504).json({
        error: `SEC EDGAR did not answer for ${ticker} (CIK ${row.cik}) within ` +
               `${Math.round(DEADLINE_MS / 1000)} seconds. Try again — a second attempt usually lands.`,
      });
    }
    /* fetchCompanyFactsRaw's own contract: null for a CIK EDGAR has
       nothing for (including an ordinary 404), never for a timeout — that
       is what the TIMED_OUT sentinel above is for, so this is never the
       misreported timeout the two cases used to share. */
    if (facts === null) {
      return res.status(404).json({
        error: `No SEC XBRL companyfacts found for ${ticker} (CIK ${row.cik}).`,
      });
    }

    const series = buildBdcSeries(facts.facts, { fyEndMonth: row.fyEndMonth, limit: QUARTERS_KEPT });
    const fromCompanyfacts = series.periods[series.periods.length - 1] || null;
    if (!fromCompanyfacts) {
      return res.status(404).json({
        error: `${ticker} (CIK ${row.cik}) has SEC XBRL facts, but none resolve to a BDC quarter this pull can assemble.`,
      });
    }

    /* buildBdcSeries already labels every period with its fiscal quarter
       the same way bdcFiscalYear/fiscalQuarterFor do (bdc-concepts.mjs),
       so the in-hand check is simply reading that label — not re-deriving
       it from the month string, which only tested the quarter already in
       hand and never the one about to be added (candidateEnd below). */
    const isFiscalQ4 = fromCompanyfacts.fq === 4;

    let liveOverlay;
    if (isFiscalQ4) {
      liveOverlay = {
        skipped: true,
        reason: `The freshest resolvable quarter for ${ticker} is its fiscal fourth quarter ` +
          `(ended ${fromCompanyfacts.end}), derived as the fiscal-year 10-K figure less the filer's ` +
          "own first three fiscal quarters (scripts/lib/bdc-concepts.mjs). A fourth quarter needs " +
          "that full annual re-derivation, which a single SEC calendar-quarter frame cannot supply, " +
          "so no live overlay is attempted on top of it; the companyfacts-derived figures below are " +
          "served as is (blueprint 7.6).",
      };
    } else {
      const candidateEnd = shiftMonthEnd(fromCompanyfacts.end, 3);
      /* the quarter actually being added by the overlay — not the one
         already in hand — is the one that can turn out to be a fiscal
         fourth quarter (a September-fiscal-year-end filer's Q3, or any
         filer's quarter shown every January-March against a candidate
         ending on its fiscal year end). Overlaying a single calendar-
         quarter frame onto that candidate would serve exactly the
         partial fiscal-Q4 figure this endpoint documents itself as
         refusing to build. */
      const candidateIsFiscalQ4 = fiscalQuarterFor(candidateEnd, row.fyEndMonth, null) === 4;
      if (candidateIsFiscalQ4) {
        liveOverlay = {
          skipped: true,
          candidateQuarterEnd: candidateEnd,
          reason: `The calendar quarter after ${ticker}'s freshest resolvable quarter ` +
            `(ended ${fromCompanyfacts.end}) would be its fiscal fourth quarter (ending ` +
            `${candidateEnd}), derived as the fiscal-year 10-K figure less the filer's own first ` +
            "three fiscal quarters (scripts/lib/bdc-concepts.mjs). A fourth quarter needs that " +
            "full annual re-derivation, which a single SEC calendar-quarter frame cannot supply, " +
            "so no live overlay is attempted onto it; the companyfacts-derived figures below are " +
            "served as is (blueprint 7.6).",
        };
      } else {
        const entries = [];
        let truncated = false;
        for (const key of OVERLAY_CONCEPTS) {
          const remaining = deadlineAt - Date.now();
          if (remaining < 1000) { truncated = true; break; }
          const concept = BDC_CONCEPTS[key];
          if (!concept) continue;
          const result = await fetchConceptFrame(concept, candidateEnd, row.cik, deadlineAt);
          if (result.truncated) { truncated = true; break; }
          if (result.payload) entries.push({ key, payload: result.payload });
        }
        mergeFrames(series, entries, { cik: row.cik, limit: QUARTERS_KEPT });
        liveOverlay = {
          skipped: false,
          candidateQuarterEnd: candidateEnd,
          framesChecked: entries.map((e) => e.key),
          /* only present when the shared budget ran out before every
             concept could be checked — the loop stops rather than
             running past DEADLINE_MS/maxDuration */
          ...(truncated ? { truncated: true } : {}),
        };
      }
    }

    const freshest = series.periods[series.periods.length - 1];
    const flagsForQuarter = (series.flags || []).filter((f) => f.end === freshest.end);

    return res.status(200).json({
      ticker,
      cik: row.cik,
      name: row.name || ticker,
      fyEndMonth: row.fyEndMonth,
      quarter: { end: freshest.end, fy: freshest.fy, fq: freshest.fq },
      /* series.latest, not freshest.values: mergeFrames only sets the
         concepts the overlay actually merged onto the new period,
         leaving every other concept null on it, so serving the period
         verbatim would blank most of a row the overlay did not touch.
         series.latest carries, per concept, the newest non-null value
         found across every kept period — the frame quarter's figure for
         whatever the overlay merged, the prior companyfacts quarter's
         figure for everything else — and each value still carries its
         own `end`, so a consumer can always see which quarter a given
         figure actually came from even though `quarter` above names one
         nominal period for the whole response. */
      values: series.latest,
      liveOverlaySkipped: !!(liveOverlay && liveOverlay.skipped),
      liveOverlay,
      flags: flagsForQuarter,
      generatedAt: new Date().toISOString(),
      source: "SEC EDGAR companyfacts (live pull)",
    });
  } catch (e) {
    return res.status(502).json({
      error: `The BDC pull for ${ticker} did not complete.`,
      detail: String((e && e.message) || e).slice(0, 300),
    });
  }
}, { name: "bdc pull" });
