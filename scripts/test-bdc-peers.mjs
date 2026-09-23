/**
 * test-bdc-peers.mjs — BDC-to-BDC comparables (blueprint §4.5), offline.
 *
 * selectComparables() pools candidates by SIC/industry/sector, then ranks
 * the pool with opts.distance when one is given. The BDC universe has no
 * usable SIC (frontend/data/bdc/universe.json rows carry "0000" or null),
 * so a BDC subject leaves sic/industry/sector empty and the pool must
 * fall through every level to "every covered company" — peers come only
 * from the BDC universe passed in as candidates, never from an
 * industry/sector match, because there isn't one to make.
 *
 * Two cases:
 *   1. Synthetic — about 15 hand-built BDC-shaped candidates, so every
 *      number here is picked, not fitted; the expected order is computed
 *      by hand in the comments below.
 *   2. Real data — the committed universe, composite and holdings files,
 *      run through selectComparables for ARCC.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const V = require(join(ROOT, "frontend", "lib", "valuation.js"));

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};

/* ---------- 1. synthetic pool: sic empty, falls through to "every covered company" ---------- */
{
  const subject = { ticker: "SUBJ", sic: "", industry: "", sector: "", fv: 2000, firstLienShare: 0.85, nonAccrualRate: 0.015 };

  /* Hand-computed distances from the subject (fv 2000, lien 0.85, non-accrual 0.015).
     dSize = |log2(fv ratio)|, dLien = |Δ lien| / 0.10, dNonAccrual = |Δ non-accrual| / 0.01. */
  const mk = (ticker, fv, firstLienShare, nonAccrualRate) => ({ ticker, name: ticker, sic: "0000", fv, firstLienShare, nonAccrualRate });
  const cands = [
    mk("C1", 2050, 0.86, 0.016),   // dSize .036, dLien .10, dNonAccrual .10  -> d = .146  (closest complete peer)
    mk("C2", 4000, 0.85, 0.015),   // dSize 1,    dLien 0,   dNonAccrual 0    -> d = 1.000
    mk("C3", 1000, 0.85, 0.015),   // dSize 1,    dLien 0,   dNonAccrual 0    -> d = 1.000 (ties C2, later in array order)
    mk("C4", 2000, 0.60, 0.015),   // dLien 2.5                               -> d = 2.500
    mk("C5", 2000, 0.85, 0.050),   // dNonAccrual 3.5                         -> d = 3.500
    { ticker: "C6", name: "C6", sic: "0000", fv: 2100, firstLienShare: null, nonAccrualRate: 0.02 }, // incomplete: dLien null, d = .505, but INCOMPLETE
    mk("C7", 1500, 0.70, 0.030),   // d = 2.161
    mk("C8", 3000, 0.95, 0.005),   // d = 1.530
    mk("C9", 2500, 0.80, 0.020),   // d = 0.777
    mk("C10", 1800, 0.90, 0.010),  // d = 0.723
    mk("C11", 5000, 0.40, 0.080),  // far outlier, d = 8.016
    { ticker: "C12", name: "C12", sic: "0000", fv: null, firstLienShare: 0.85, nonAccrualRate: 0.015 }, // incomplete: dSize null, d = 0 but INCOMPLETE
    mk("C13", 2200, 0.83, 0.017),  // d = 0.315
    mk("C14", 1900, 0.87, 0.014),  // d = 0.236
    { ticker: "SUBJ", name: "duplicate of the subject", sic: "0000", fv: 2000, firstLienShare: 0.85, nonAccrualRate: 0.015 } // must be excluded by ticker, not by value
  ];

  const sel = V.selectComparables(subject, cands, { minPool: 6, keep: 8, distance: V.bdcDistance });

  check("no real SIC to match on: the pool falls through every level", sel.pool.level === "every covered company", sel.pool.level);
  check("the pool holds every other candidate (14, SUBJ excluded)", sel.pool.count === 14, sel.pool.count);
  check("peers are capped at 8", sel.peers.length === 8, sel.peers.length);
  check("the hand-computed closest peer (C1, d≈0.146) ranks first", sel.peers[0].ticker === "C1", sel.peers.map((p) => p.ticker).join(","));
  check("the next-closest hand-computed peers follow in order", sel.peers.slice(0, 4).map((p) => p.ticker).join(",") === "C1,C14,C13,C10",
    sel.peers.map((p) => p.ticker).join(","));

  const all = sel.peers.concat(sel.passedOver);
  check("the subject never appears in its own comparable list", !all.some((p) => p.ticker === "SUBJ"),
    all.map((p) => p.ticker).join(","));

  /* C12 has distance 0 (its two present terms both match the subject exactly) yet is
     INCOMPLETE (fv missing) — it must still rank after every complete candidate,
     including ones with a much larger distance. That is the point of this case. */
  const c12Index = all.findIndex((p) => p.ticker === "C12");
  const c6Index = all.findIndex((p) => p.ticker === "C6");
  const lastCompleteIndex = all.reduce((last, p, i) => (p.complete ? i : last), -1);
  check("C12 (distance 0, incomplete) still sorts after every complete candidate", c12Index > lastCompleteIndex,
    "C12 at " + c12Index + ", last complete at " + lastCompleteIndex);
  check("C6 (incomplete) also sorts after every complete candidate", c6Index > lastCompleteIndex,
    "C6 at " + c6Index + ", last complete at " + lastCompleteIndex);
  check("both incomplete candidates land in passedOver, not peers", sel.peers.every((p) => p.complete), sel.peers.map((p) => p.complete).join(","));
}

/* ---------- 2. real data: universe + composite + the holdings files that exist ---------- */
{
  const dataDir = join(ROOT, "frontend", "data", "bdc");
  const universe = require(join(dataDir, "universe.json"));
  const composite = require(join(dataDir, "composite.json"));

  /* fv per filer comes from the holdings file's own summary (composite.perFiler
     carries ratios, not the portfolio's fair value); only 32 of 53 holdings
     files exist, so the rest of the universe naturally becomes "not yet
     parsed" candidates (fv/firstLienShare/nonAccrualRate all null). */
  const byTicker = {};
  universe.rows.forEach((r) => { byTicker[r.ticker] = { ticker: r.ticker, name: r.name, sic: "0000", fv: null, firstLienShare: null, nonAccrualRate: null }; });
  composite.perFiler.forEach((p) => {
    const row = byTicker[p.ticker];
    if (!row) return;
    row.firstLienShare = p.firstLienShare;
    row.nonAccrualRate = p.nonAccrualFv;
    const holdingsPath = join(dataDir, "holdings-" + p.ticker + ".json");
    if (existsSync(holdingsPath)) row.fv = require(holdingsPath).summary.portfolioFv;
  });

  const candidates = Object.values(byTicker);
  const subject = Object.assign({}, byTicker.ARCC, { sic: "", industry: "", sector: "" });
  check("ARCC is in the real universe with real inputs", !!subject && subject.fv > 0 && subject.firstLienShare > 0, JSON.stringify({ fv: subject.fv, firstLienShare: subject.firstLienShare }));

  const sel = V.selectComparables(subject, candidates, { distance: V.bdcDistance });
  check("real universe: no SIC to match on, falls through to every covered company", sel.pool.level === "every covered company", sel.pool.level);
  check("real universe: at least 6 peers for ARCC", sel.peers.length >= 6, sel.peers.length);
  check("ARCC does not appear among its own peers", !sel.peers.some((p) => p.ticker === "ARCC"));

  /* Reasoning: ARCC (Ares Capital) is the largest listed BDC by portfolio fair
     value and runs a first-lien-heavy book. Blue Owl Capital Corporation
     (OBDC) is the next-largest widely covered externally managed BDC and is
     also predominantly first lien, so on this three-term distance (size,
     first-lien share, non-accrual rate) it should land closest to ARCC —
     closer than smaller, more second-lien/unsecured-heavy names. The
     computed peer set (see scripts/test-bdc-peers.mjs run output) puts OBDC
     first, ahead of OTF and BXSL, which is the expected shape: a real gap
     in size to the rest of the field but a similar first-lien strategy. */
  const top3 = sel.peers.slice(0, 3).map((p) => p.ticker);
  check("the large, first-lien-heavy peer (OBDC) ranks near the top for ARCC", top3.includes("OBDC"), top3.join(","));
}

console.log(failed ? "\n" + failed + " failed" : "\nall BDC peer checks pass");
process.exit(failed ? 1 : 0);
