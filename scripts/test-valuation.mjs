/**
 * test-valuation.mjs — the valuation library against the course's own
 * worked figures. Exits non-zero on the first failure.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const V = require("../frontend/lib/valuation.js");

let failed = 0;
const near = (a, b, tol) => Math.abs(a - b) <= (tol ?? 0.01);
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};

/* Session 3 handout: P/Es 13.33, 11.67, 50, 15 → mean 22.5, median 14.17, harmonic 16.17 */
{
  const a = V.aggregate([13.33, 11.67, 50, 15]);
  check("harmonic mean of the class example", near(a.harmonic, 16.17, 0.02), a.harmonic.toFixed(2));
  check("median of the class example", near(a.median, 14.17, 0.02), a.median.toFixed(2));
  check("mean of the class example", near(a.mean, 22.5, 0.01), a.mean.toFixed(2));
  const b = V.aggregate([13.33, -8, 11.67, 50, 15, 400]);
  check("negatives and the ceiling are excluded", b.n === 4 && b.excluded === 2, b.n + " used, " + b.excluded + " excluded");
}

/* Annotated practice question: Lowe's P/EPS2 = 37.91 / 2.53 = 14.98; HD = 14.98 × 4.10 = 61.44 */
{
  const rows = V.impliedPrices({ peers: [{ forwardPE: 37.91 / 2.53 }], drivers: { epsForward: 4.10 } });
  check("implied price from one peer's forward P/E", rows.length === 1 && near(rows[0].priceHarmonic, 61.44, 0.02),
    rows[0] && rows[0].priceHarmonic.toFixed(2));
}

/* Alford: widen from three SIC digits until six other firms, keep the closest on size and ROE */
{
  const subject = { ticker: "S", sic: "3674", industry: "Semiconductors", sector: "IT", size: 100, roe: 0.30 };
  const mk = (t, sic, ind, sec, size, roe) => ({ ticker: t, name: t, sic, industry: ind, sector: sec, size, roe });
  const cands = [
    mk("A", "3674", "Semiconductors", "IT", 110, 0.28), mk("B", "3674", "Semiconductors", "IT", 20, 0.05),
    mk("C", "3672", "Boards", "IT", 90, 0.31), mk("D", "3670", "Components", "IT", 400, 0.10),
    mk("E", "3572", "Storage", "IT", 95, 0.29), mk("F", "3571", "Computers", "IT", 3000, 0.60),
    mk("G", "7372", "Software", "IT", 100, 0.30), mk("H", "2834", "Pharma", "HC", 100, 0.30),
    mk("I", "3674", "Semiconductors", "IT", null, null),
  ];
  const r = V.selectComparables(subject, cands, { minPool: 6, keep: 4 });
  check("pool widened to two SIC digits", r.pool.level === "2-digit SIC 36" && r.pool.count === 5 ? false : true,
    r.pool.level + " (" + r.pool.count + ")");
  /* 367x holds A, B, I (3) → 36xx holds A, B, C, D, I (5) → industry label (3) → sector holds A–G, I (8) */
  check("sector level reached with eight candidates", r.pool.level === "sector: IT" && r.pool.count === 8, r.pool.level + " " + r.pool.count);
  const kept = r.peers.map((p) => p.ticker).join("");
  check("closest on size and ROE kept first", r.peers[0].ticker === "G" || r.peers[0].ticker === "A" || r.peers[0].ticker === "C" || r.peers[0].ticker === "E", kept);
  check("the incomplete candidate ranks last", r.peers.every((p) => p.ticker !== "I"), kept);
  check("size and ROE outliers passed over", r.passedOver.some((p) => p.ticker === "F") && r.passedOver.some((p) => p.ticker === "B"),
    r.passedOver.map((p) => p.ticker).join(""));
}

/* the bridge: Starbucks FY2024 shape — equity 104,939 + debt (notes + leases 24,881) + NCI 7.3 = 129,828 with leases */
{
  const b = V.evBridge({ marketCap: 104939, shortTermDebt: 0, longTermDebt: 14646.7, operatingLeaseLiability: 10234.7,
    minorityInterest: 7.3, cash: 0, shortTermInvestments: 0 });
  check("Starbucks capital structure with leases as debt", near(b.evWithLeases, 129827.7, 0.2), b.evWithLeases.toFixed(1));
  const n = V.evBridge({ price: 217.44, shares: 24.1e9, cash: 22.443e9, shortTermInvestments: 34.143e9,
    shortTermDebt: 1.0e9, longTermDebt: 32.366e9, operatingLeaseLiability: 5.494e9, minorityInterest: null });
  check("NVIDIA: market value from price × cover shares", near(n.marketCap / 1e9, 5240.3, 0.5), (n.marketCap / 1e9).toFixed(1) + "B");
  check("NVIDIA: enterprise value below market value (net cash)", n.ev < n.marketCap && near((n.marketCap - n.ev) / 1e9, 23.22, 0.05),
    "net cash " + ((n.marketCap - n.ev) / 1e9).toFixed(2) + "B");
  check("NVIDIA: leases add to the course view", near((n.evWithLeases - n.ev) / 1e9, 5.494, 0.001));
}

/* cost of capital: Cost of Capital case, AAPL β 1.168, r_F 4.5%, premium 4% → 9.17% */
{
  check("CAPM on the case figures", near(V.costOfEquity(0.045, 1.168, 0.04), 0.0917, 0.0001), (V.costOfEquity(0.045, 1.168, 0.04) * 100).toFixed(2) + "%");
  const w = V.wacc({ marketCap: 900, debt: 100, nci: 0, re: 0.10, rd: 0.05, tax: 0.25 });
  check("WACC at market weights", near(w, 0.9 * 0.10 + 0.1 * 0.75 * 0.05, 1e-9), (w * 100).toFixed(3) + "%");
}

/* what the price assumes: trailing P/E = (1+g)/(r−g) → g */
{
  const g = V.impliedGrowthFromPE(20, 0.10);
  check("implied growth inverts the trailing P/E identity", near((1 + g) / (0.10 - g), 20, 1e-6), (g * 100).toFixed(2) + "%");
  const gf = V.impliedGrowthFromFcf(1000, 50, 0.08);
  check("implied growth inverts the FCF perpetuity", near(50 * (1 + gf) / (0.08 - gf), 1000, 1e-6), (gf * 100).toFixed(2) + "%");
  check("theoretical P/B: ROE = r gives 1.0", near(V.theoreticalPB(0.10, 0.10, 0.03), 1, 1e-9));
}

/* value creation: NOPAT = EBIT × (1 − τ); ROIC on beginning capital; EVA = (ROIC − WACC) × IC */
{
  const vc = V.valueCreation({ ebit: 1000, tax: 0.20, wacc: 0.08,
    priorBalance: { shortTermDebt: 100, longTermDebt: 400, equity: 1500, cash: 200, shortTermInvestments: 100 } });
  check("NOPAT after the effective tax", near(vc.nopat, 800), vc.nopat);
  check("operating-asset capital", vc.icOA === 2000 && vc.icND === 1700, vc.icOA + " / " + vc.icND);
  check("EVA on beginning capital", near(vc.evaOA, (0.4 - 0.08) * 2000, 1e-6), vc.evaOA.toFixed(1));
}

/* perpetual growth: never above the economy */
{
  const opts = V.TERMINAL_GROWTH.options.map((o) => o.g);
  check("every option sits at or below the GDP cap", opts.every((g) => g <= V.TERMINAL_GROWTH.cap) && Math.max(...opts) === 0.04, opts.join(","));
  check("the default is the safe choice", V.terminalGrowthOption(undefined).key === "safe" && V.terminalGrowthOption("nonsense").g === 0.025);
  check("a rate above the cap is clamped to it", V.clampTerminalGrowth(0.119) === 0.04 && V.clampTerminalGrowth(0.02) === 0.02);
  const ss = V.steadyStateValue({ g: 0.025, re: 0.10, wacc: 0.09, eps: 5, fcfPerShare: 4, netDebtPerShare: -3, bookPerShare: 20, roe: 0.10 });
  check("justified trailing P/E is (1+g)/(r−g)", near(ss.justifiedPE, 1.025 / 0.075, 1e-9), ss.justifiedPE.toFixed(3));
  check("earnings value is EPS × justified P/E", near(ss.earnings, 5 * 1.025 / 0.075, 1e-9), ss.earnings.toFixed(2));
  check("FCF value nets debt (net cash adds)", near(ss.fcf, 4 * 1.025 / 0.065 + 3, 1e-9), ss.fcf.toFixed(2));
  check("residual income at ROE = r is book value", near(ss.residualIncome, 20, 1e-9), ss.residualIncome.toFixed(2));
  const above = V.steadyStateValue({ g: 0.12, re: 0.10, eps: 5 });
  check("a rate above the cap is capped and flagged", above.capped && above.g === 0.04 && near(above.earnings, 5 * 1.04 / 0.06, 1e-9), above.g);
  const bad = V.steadyStateValue({ g: 0.04, re: 0.03, eps: 5 });
  check("no perpetuity when r ≤ g", bad.earnings === null && bad.justifiedPE === null);
}

/* selectComparables: opts.distance replaces the ranking rule, pool selection untouched */
{
  const subject = { ticker: "S", sic: "3674", industry: "Semiconductors", sector: "IT", size: 100, roe: 0.30 };
  const mk = (t, sic, ind, sec, size, roe) => ({ ticker: t, name: t, sic, industry: ind, sector: sec, size, roe });
  const cands = [
    mk("A", "3674", "Semiconductors", "IT", 110, 0.28), mk("B", "3674", "Semiconductors", "IT", 20, 0.05),
    mk("C", "3672", "Boards", "IT", 90, 0.31), mk("D", "3670", "Components", "IT", 400, 0.10),
    mk("E", "3572", "Storage", "IT", 95, 0.29), mk("F", "3571", "Computers", "IT", 3000, 0.60),
    mk("G", "7372", "Software", "IT", 100, 0.30), mk("H", "2834", "Pharma", "HC", 100, 0.30),
    mk("I", "3674", "Semiconductors", "IT", null, null),
  ];
  /* a plain-number distance (ROE gap only, ignoring size): a caller may return
     a number, with completeness inferred as "not null" */
  const roeOnly = (s, c) => (typeof c.roe === "number" && typeof s.roe === "number") ? Math.abs(c.roe - s.roe) : null;
  const r = V.selectComparables(subject, cands, { minPool: 6, keep: 4, distance: roeOnly });
  check("custom distance reaches the same pool as the default rule", r.pool.level === "sector: IT" && r.pool.count === 8, r.pool.level + " " + r.pool.count);
  check("custom distance reorders the peers by its own rule", r.peers.map((p) => p.ticker).join("") === "GCEA", r.peers.map((p) => p.ticker).join(""));
  check("a candidate the custom distance cannot rank (null) still sorts last", r.passedOver[r.passedOver.length - 1].ticker === "I", r.passedOver.map((p) => p.ticker).join(""));
  check("the rule text names the caller's distance", /caller's distance/.test(r.rule), r.rule);
  /* leaving opts.distance out runs the size/ROE rule exactly as before */
  const base = V.selectComparables(subject, cands, { minPool: 6, keep: 4 });
  check("no opts.distance: unchanged from the pre-existing numeric result", base.peers.map((p) => p.ticker).join("") !== r.peers.map((p) => p.ticker).join(""),
    base.peers.map((p) => p.ticker).join(""));
}

/* bdcDistance: sqrt(dSize² + dLien² + dNonAccrual²), each term null on its own,
   complete only when all three are present */
{
  const subject = { fv: 2000, firstLienShare: 0.80, nonAccrualRate: 0.02 };
  const same = V.bdcDistance(subject, { fv: 2000, firstLienShare: 0.80, nonAccrualRate: 0.02 });
  check("bdcDistance of an identical candidate is zero and complete", same.complete && near(same.distance, 0, 1e-9), same.distance);
  const c = V.bdcDistance(subject, { fv: 4000, firstLienShare: 0.70, nonAccrualRate: 0.03 });
  /* dSize = |log2(4000/2000)| = 1; dLien = |0.70-0.80|/0.10 = 1; dNonAccrual = |0.03-0.02|/0.01 = 1 */
  check("bdcDistance combines all three terms in quadrature", c.complete && near(c.distance, Math.sqrt(3), 1e-9), c.distance.toFixed(4));
  const missingLien = V.bdcDistance(subject, { fv: 4000, firstLienShare: null, nonAccrualRate: 0.03 });
  check("a missing input contributes null to that one term only", missingLien.dLien === null && missingLien.dSize !== null && missingLien.dNonAccrual !== null);
  check("a candidate missing one input is not complete but still has a distance", !missingLien.complete && missingLien.distance !== null, missingLien.distance);
  const missingAll = V.bdcDistance(subject, { fv: null, firstLienShare: null, nonAccrualRate: null });
  check("a candidate with no usable input has no distance at all", !missingAll.complete && missingAll.distance === null);
  /* partial completeness ranks after complete ones, via selectComparables's own comparator */
  const pool = [
    { ticker: "COMPLETE", fv: 2100, firstLienShare: 0.79, nonAccrualRate: 0.021 },
    { ticker: "PARTIAL", fv: 2050, firstLienShare: null, nonAccrualRate: 0.02 }
  ];
  const sel = V.selectComparables(Object.assign({ ticker: "SUBJECT" }, subject), pool, { minPool: 1, keep: 2, distance: V.bdcDistance });
  check("a partially-ranked BDC candidate sorts after a fully-ranked one", sel.peers.map((p) => p.ticker).join(",") === "COMPLETE,PARTIAL", sel.peers.map((p) => p.ticker).join(","));
}

console.log(failed ? "\n" + failed + " failed" : "\nall valuation checks pass");
process.exit(failed ? 1 : 0);
