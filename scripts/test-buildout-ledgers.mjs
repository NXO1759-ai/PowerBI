/**
 * test-buildout-ledgers.mjs — the deal ledger, ratings and private-
 * credit-ties panels (frontend/credit-buildout-ledgers.js, PR H3),
 * offline, following the window-stub pattern of scripts/test-buildout-
 * view.mjs.
 *
 * Six things, none needing a browser or the network:
 *
 *   1. credit-buildout-ledgers.js parses and evaluates against the
 *      window stub, after credit-buildout.js in credit.html's own
 *      script order, so a duplicate RTCatalog key between the two files
 *      throws here, not in a browser.
 *   2. window.RTBuildoutLedgers.CAPTIONS: every template's sample() is a
 *      string under 240 characters (blueprint section 9).
 *   3. This file's own status-based exclusion rule (isFinancingRow) is
 *      cross-checked against the real scripts/lib/ledger.mjs export it
 *      mirrors, so the two copies cannot silently drift apart.
 *   4. The PR H3 acceptance line "every bubble opens a URL": every row
 *      the real, corrected deal ledger carries resolves to an H11 bubble
 *      with a non-empty url, and the running totals (H12, H18) exclude
 *      every row whose status is not signed or closed.
 *   5. A company with no numeric-range guide for a year prints
 *      "direction only" (via classifyGuidance), never a computed error —
 *      checked against Oracle's real, always-qualified guidance rows —
 *      and the two published guidance-error acceptance figures
 *      (blueprint 15.4: Meta FY2025 +1,220 = +1.7%; Alphabet FY2025
 *      -553) reproduce exactly from the real, corrected capex ledger.
 *   6. A stubbed fetch of the real ledger files resolves through
 *      _internal.fetchAll and buildHtml renders the real data without
 *      throwing.
 *
 * The window stub mirrors test-buildout-view.mjs's: window.RTCatalog is
 * the real catalog (so register() works and a duplicate key throws),
 * window.RTBuildout is the real credit-buildout.js module (so H14 can
 * borrow its _internal.fetchPanels/latestWithField, exactly as the real
 * page does), window.RTTerms is null, and document is undefined — the
 * file must not touch the DOM until render()/mount() is called, which
 * this test never does (it drives the pure _internal functions and
 * buildHtml() instead).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as LedgerLib from "./lib/ledger.mjs";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRONT = join(ROOT, "frontend");
let failed = 0;
const check = (n, ok, d) => { console.log((ok ? "  ok   " : "  FAIL ") + n + (d ? "  " + d : "")); if (!ok) failed++; };
const readJson = (rel) => JSON.parse(readFileSync(join(FRONT, rel), "utf8"));

/* ---------- 1. evaluate in credit.html's own script order ---------- */
console.log("load order and RTCatalog collisions");
const CAT = require(join(FRONT, "lib", "metric-catalog.js"));
const win = { RTCatalog: CAT, RTTerms: null, RTPcSeries: null, Chart: undefined };
win.self = win; win.window = win;

const buildoutSrc = readFileSync(join(FRONT, "credit-buildout.js"), "utf8");
new Function("window", "self", "module", buildoutSrc)(win, win, undefined);
check("credit-buildout.js (H1-H8) evaluates first, as credit.html loads it", !!win.RTBuildout);

const src = readFileSync(join(FRONT, "credit-buildout-ledgers.js"), "utf8");
let parseErr = null;
try { new Function(src); } catch (e) { parseErr = e; }
check("credit-buildout-ledgers.js parses", !parseErr, parseErr && parseErr.message);

let evalErr = null;
try { new Function("window", "self", "module", src)(win, win, undefined); } catch (e) { evalErr = e; }
check("credit-buildout-ledgers.js evaluates against the window stub, after credit-buildout.js, without a catalog collision", !evalErr, evalErr && evalErr.message);
const RBL = win.RTBuildoutLedgers;
check("window.RTBuildoutLedgers is set with render, CAPTIONS and _internal", !!RBL && typeof RBL.render === "function" && !!RBL.CAPTIONS && !!RBL._internal);

/* the three ingested Market-view sections and the Lenders/Underwriting
   controllers all register their own entries in credit.html's real load
   order; replaying the ones present on disk here is what proves this
   file's own ten new keys (boH9-boH18) plus its section key do not
   collide with anything else on the page */
let sectionsErr = null;
for (const id of ["stress", "capital", "dealflow", "underwriting"]) {
  const file = join(FRONT, "credit-" + id + ".js");
  if (!existsSync(file)) continue;
  const s = readFileSync(file, "utf8");
  const w = { RTCreditSections: [], RTPcSeries: null, RTCatalog: CAT, RTTerms: null, RTHttp: null, Chart: undefined };
  w.self = w; w.window = w;
  try { new Function("window", "self", "module", s)(w, w, undefined); } catch (e) { sectionsErr = id + ": " + e.message; break; }
}
check("the Market view's ingested sections and the Underwriting view still evaluate against the same catalog after this file registered its entries (no key collision)", !sectionsErr, sectionsErr || "");
const EXPECT_KEYS = ["boH9", "boH10", "boH11", "boH12", "boH13", "boH14", "boH15", "boH16", "boH17", "boH18", "boLedgersSection"];
check("every boH9-boH18 chart key and the section key are in the catalog", EXPECT_KEYS.every((k) => !!CAT.get(k)), EXPECT_KEYS.filter((k) => !CAT.get(k)).join(","));
check("none of this file's keys collide with credit-buildout.js's H1-H8 keys", ["boH1", "boH2", "boH3", "boH4", "boH5", "boH6", "boH7", "boH8"].every((k) => !!CAT.get(k)));

/* ---------- 2. every CAPTIONS sample() under 240 characters ---------- */
console.log("captions");
const capNames = Object.keys(RBL.CAPTIONS);
check("CAPTIONS carries one template per chart, H9 through H18", capNames.length === 10, capNames.join(","));
for (const name of capNames) {
  const c = RBL.CAPTIONS[name];
  check(name + ": has a template function", typeof c.template === "function");
  check(name + ": has a sample function", typeof c.sample === "function");
  let text = null, err = null;
  try { text = c.sample(); } catch (e) { err = e; }
  check(name + " caption sample() returns a string", typeof text === "string" && !err, err ? err.message : text);
  if (typeof text === "string") {
    check(name + " caption measures under 240 characters", text.length < 240, text.length + " chars: " + text);
  }
}

/* ---------- 3. this file's exclusion rule against the real Node module ---------- */
console.log("isFinancingRow cross-check against scripts/lib/ledger.mjs");
const deals = readJson("data/ledgers/deals.json");
const capex = readJson("data/ledgers/capex.json");
const credit = readJson("data/ledgers/credit.json");
let mismatch = 0;
for (const rows of [deals.rows, capex.rows, credit.rows]) {
  for (const row of rows) {
    if (RBL._internal.isFinancingRow(row) !== LedgerLib.isFinancingRow(row)) mismatch++;
  }
}
check("this file's isFinancingRow agrees with scripts/lib/ledger.mjs's real export on every row of all three ledgers", mismatch === 0, mismatch + " mismatch(es)");
check("SIGNED_STATUSES here names exactly signed and closed, per ledger.mjs", ["signed", "closed"].every((s) => RBL._internal.isFinancingRow({ status: s })) &&
  ["announcement", "contract", "commentary", "rating action", "backstop", "guidance", "outturn", "aggregate"].every((s) => !RBL._internal.isFinancingRow({ status: s })));

/* ---------- 4. every H11 bubble carries a URL; totals exclude every non-signed row ---------- */
console.log("H11 URL coverage; H12/H18 exclusion");
const h11rows = RBL._internal.h11Data(deals.rows);
check("h11Data draws one row per ledger row", h11rows.length === deals.rows.length, h11rows.length + " vs " + deals.rows.length);
const noUrl = h11rows.filter((r) => !r.url);
check("every bubble the deal timeline would draw carries a URL (PR H3 acceptance)", noUrl.length === 0, noUrl.map((r) => r.entity).join(", "));

const h12 = RBL._internal.h12Data(deals.rows, "structure");
const excludedStatuses = new Set(["announcement", "contract", "commentary", "rating action", "backstop"]);
const excludedRowsTotalBn = deals.rows.filter((r) => excludedStatuses.has(r.status))
  .reduce((a, r) => a + (RBL._internal.amountUsdBn(r) || 0), 0);
check("excluded-status rows exist in the real ledger (the exclusion test below is non-vacuous)", excludedRowsTotalBn > 0, "$" + excludedRowsTotalBn.toFixed(1) + "B would leak if unfiltered");
check("h12Data's cumulative total equals the sum of amountUsdBn over signed/closed rows only (no excluded row's dollars reach it)",
  Math.abs(h12.totalUsdBn - deals.rows.filter((r) => RBL._internal.isFinancingRow(r)).reduce((a, r) => a + (RBL._internal.amountUsdBn(r) || 0), 0)) < 1e-6);
check("h12Data never produces a group key from an excluded structure/status pairing", h12.keys.every((k) => k !== "commentary" && k !== "contract" && k !== "announcement"));

const h18 = RBL._internal.h18Data(deals.rows);
const h18Total = h18.halves.reduce((a, h) => a + h18.byHalf[h]["Private credit + JV/SPV"] + h18.byHalf[h]["Other structures"], 0);
check("h18Data's half-year totals equal h12Data's structure-mode total (both sum the same signed/closed, clean-unit rows)", Math.abs(h18Total - h12.totalUsdBn) < 1e-6, h18Total + " vs " + h12.totalUsdBn);

/* ---------- 5. direction-only, and the two published guidance-error acceptance figures ---------- */
console.log("guidance classification and the guidance-error acceptance figures");
const orcl = RBL._internal.h9EntityData("ORCL", capex.rows);
check("Oracle never carries a numeric-range guide (every one of its own guidance rows is qualified prose, per the real ledger)",
  orcl.errors.every((e) => e.error === null), JSON.stringify(orcl.errors));
const orclGuides = capex.rows.filter((r) => r.entity === "ORCL" && r.status === "guidance").map((r) => RBL._internal.classifyGuidance(r.amount));
check("every one of Oracle's real guidance rows classifies as \"direction\"", orclGuides.every((g) => g.kind === "direction"), orclGuides.map((g) => g.kind).join(","));

const meta2025 = RBL._internal.h9EntityData("META", capex.rows).errors.find((e) => e.year === "2025");
check("Meta FY2025 guidance error is +1,220 (+1.7%), the blueprint 15.4 acceptance figure, computed from the real corrected capex ledger",
  !!meta2025 && meta2025.error === 1220 && Math.abs(meta2025.pct - 1.7183098591549297) < 1e-9, JSON.stringify(meta2025));
const goog2025 = RBL._internal.h9EntityData("GOOG", capex.rows).errors.find((e) => e.year === "2025");
check("Alphabet FY2025 guidance error is -553, the blueprint 15.4 acceptance figure, computed from the real corrected capex ledger",
  !!goog2025 && goog2025.error === -553, JSON.stringify(goog2025));

/* ---------- 5b. H13/H16 tenor parsing and the H17 downgrade caption ---------- */
console.log("H13/H16 tranche parsing; H17 downgrade detection");
const h16tr = RBL._internal.h16Tranches(credit.rows);
check("h16Tranches carries at least one tranche from the real, corrected credit ledger", h16tr.length > 0, String(h16tr.length));
check("every h16Tranches tranche carries a numeric maturityYear (no NaN tenor reaches a caption)", h16tr.every((t) => Number.isFinite(t.maturityYear)), JSON.stringify(h16tr.find((t) => !Number.isFinite(t.maturityYear))));
const h13Bonds = RBL._internal.h13BondTranches(credit.rows);
const metaThirtyYear = h13Bonds.filter((t) => t.name === "Meta" && t.tenor === 30).sort((a, b) => (a.date < b.date ? -1 : 1));
check("Meta's 30-year (exactly, not 30-and-longer) tranche moved 5.400% (Aug 2024) to 6.300% (Apr 2026), the blueprint 15.5 acceptance figures",
  metaThirtyYear.length >= 2 && metaThirtyYear[0].coupon === 5.4 && metaThirtyYear[metaThirtyYear.length - 1].coupon === 6.3,
  JSON.stringify(metaThirtyYear.map((t) => t.date + ":" + t.coupon)));
const oracleThirtyYear = h13Bonds.filter((t) => t.name === "Oracle" && t.tenor === 30).sort((a, b) => (a.date < b.date ? -1 : 1));
check("Oracle's 30-year tranche moved 5.375% (Sep 2024) to 6.700% (Feb 2026), the blueprint 15.5 acceptance figures",
  oracleThirtyYear.length >= 2 && oracleThirtyYear[0].coupon === 5.375 && oracleThirtyYear[oracleThirtyYear.length - 1].coupon === 6.7,
  JSON.stringify(oracleThirtyYear.map((t) => t.date + ":" + t.coupon)));

const byIssuerH17 = RBL._internal.h17Data(credit.rows);
const realDowngrades = RBL._internal.downgradedIssuers(byIssuerH17);
/* Round-1 fixer review (see the finding on h17Data's rating-token
   extraction): CoreWeave's 2026-06-11 S&P row prints an issue rating on
   proposed new notes ("B (RR5, 15%)") with the issuer's own B+ rating
   explicitly "unchanged" later in the same string — the fixed
   issuerRatingMatch() picks the non-issue-annotated token (B+), so
   CoreWeave no longer shows a same-agency drop. Oracle's S&P BBB-to-BBB-
   action (blueprint 15.7's own example) is the one real same-agency
   downgrade left in the window, matching the blueprint's own text
   ("Oracle is the only hyperscaler downgraded in the window"). */
check("downgradedIssuers finds Oracle's S&P BBB-to-BBB- action (blueprint 15.7's own example) as the only same-agency downgrade in the real, corrected credit ledger",
  realDowngrades.length === 1 && realDowngrades[0] === "Oracle", realDowngrades.join(", "));
check("CoreWeave is not flagged as downgraded: its S&P issuer rating (B+) is explicitly unchanged across the window; only a proposed tranche's issue rating moved",
  !realDowngrades.includes("CoreWeave"));
const capSingleText = RBL.CAPTIONS.h17.template({ n: 24, issuers: 9, since: "Mar 2025", downgraded: realDowngrades });
check("the h17 caption correctly singles out Oracle as the only same-agency downgrade against the real, corrected credit ledger",
  /is the only one/.test(capSingleText) && capSingleText.includes("Oracle"), capSingleText);
const capMultiText = RBL.CAPTIONS.h17.template({ n: 24, issuers: 9, since: "Mar 2025", downgraded: ["Applied Digital", "Cipher Mining", "TeraWulf"] });
check("the h17 caption correctly names multiple downgraded issuers rather than singling one out as \"the only one\" when several are downgraded (synthetic multi-issuer case)",
  !/is the only one/.test(capMultiText) && ["Applied Digital", "Cipher Mining", "TeraWulf"].every((k) => capMultiText.includes(k)), capMultiText);
check("the multi-downgrade h17 caption still measures under 240 characters with issuer names", capMultiText.length < 240, capMultiText.length + " chars: " + capMultiText);

/* ---------- 6. a stubbed fetch of the real files resolves; buildHtml renders without throwing ---------- */
console.log("stubbed fetch and a full render of the real data");
const hsLedgers = readJson("data/pc/series/hs-ledgers.json");
const neoclouds = readJson("data/capex/neoclouds.json");
const files = {
  "data/ledgers/deals.json": deals, "data/ledgers/capex.json": capex, "data/ledgers/credit.json": credit,
  "data/pc/series/hs-ledgers.json": hsLedgers
};
const stubFetch = (url) => {
  const key = Object.keys(files).find((k) => url.indexOf(k) >= 0);
  if (key) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(files[key]) });
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error("no fixture for " + url)) });
};
const savedFetch = win.fetch;
win.fetch = stubFetch;
win.location = { hostname: "test.local", search: "" };
let fetched = null, fetchErr = null;
try { fetched = await RBL._internal.fetchAll(); } catch (e) { fetchErr = e; }
check("fetchAll resolves the three ledgers and the derived-series file against a stubbed fetch", !!fetched && !fetchErr, fetchErr && fetchErr.message);

let html = null, buildErr = null;
const fullData = { deals, capex, credit, hsLedgers, macro: { series: {} }, neoclouds };
try { html = RBL._internal.buildHtml(fullData, { h12Mode: "structure" }); } catch (e) { buildErr = e; }
check("buildHtml renders the real, corrected ledgers without throwing", typeof html === "string" && html.length > 1000 && !buildErr, buildErr && buildErr.stack);
check("the rendered page names every H9-H18 chart heading", ["Guidance vs outturn", "2026 hyperscaler ranges", "The deal timeline", "Running totals", "Price of capital",
  "Neocloud leverage panel", "Developer, tenant and backstop", "New-issue spreads", "The rating timeline", "Build-out financing by channel"]
  .every((needle) => html.includes(needle)), html ? "missing: " + ["Guidance vs outturn", "2026 hyperscaler ranges", "The deal timeline", "Running totals", "Price of capital",
    "Neocloud leverage panel", "Developer, tenant and backstop", "New-issue spreads", "The rating timeline", "Build-out financing by channel"].filter((n) => !html.includes(n)).join(", ") : "no html");
check("H11's rendered bubbles link to their own row (spot-check: an <a href> wraps at least one real deal-ledger URL)",
  !!html && deals.rows.some((r) => html.includes("href='" + r.url + "'")));
win.fetch = savedFetch;

/* buildHtml with an empty neoclouds file still renders an H14 empty
   state per ticker rather than throwing (module-load-time reuse of
   window.RTBuildout._internal must tolerate a missing panel) */
let emptyErr = null;
try { RBL._internal.buildHtml(Object.assign({}, fullData, { neoclouds: { companies: {} } }), {}); } catch (e) { emptyErr = e; }
check("buildHtml renders H14 with no neocloud panel data without throwing", !emptyErr, emptyErr && emptyErr.stack);

/* ---------- summary ---------- */
console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall build-out ledgers checks pass");
process.exitCode = failed ? 1 : 0;
