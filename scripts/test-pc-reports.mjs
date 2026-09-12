/**
 * test-pc-reports.mjs — the hand-keyed report series and the press series.
 *
 * The PitchBook reports print their series as chart labels and prose, so
 * data-sources/reports/*.json is keyed by hand from the PDF page, one page
 * and one quote per point. This checks the files hold what the catalog
 * and the blueprint say they hold: every point carries a period, a value,
 * a page and a quote; every series key of the catalog's report group
 * exists; the values the capital section quotes are present at the page
 * the report prints them on; the two deal tables of the August 2026
 * monitor match the text inside the deck's EMF pictures when the deck is
 * on disk; the served press series has twenty series with a URL and a
 * link check on every point; and no served or committed file carries the
 * meta block the workbook export stamps with its owner's name (compared
 * by digest, so the name is not written here either). Exits non-zero on
 * the first failure.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORTS = join(ROOT, "data-sources/reports");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};

const FR = read(join(REPORTS, "pitchbook-global-fundraising-2026q2.json"));
const AN = read(join(REPORTS, "pitchbook-annual-private-debt-reports.json"));
const LCD = read(join(REPORTS, "lcd-monitor-2026-08-tables.json"));
const PRESS = read(join(ROOT, "frontend/data/pc/press-series.json"));

/* ---------- 1. every point is complete ---------- */
{
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const GRAINS = new Set(["year", "half", "quarter", "ytd", "ttm", "asof", "window", "rolling6m"]);
  for (const [name, file] of [["fundraising 2026Q2", FR], ["annual reports", AN]]) {
    const bad = [];
    let points = 0;
    for (const [key, s] of Object.entries(file.series)) {
      for (const f of ["label", "unit", "cadence", "geography", "population"]) if (typeof s[f] !== "string" || !s[f]) bad.push(`${key}.${f}`);
      if (!Array.isArray(s.points) || !s.points.length) bad.push(`${key}.points`);
      const seen = new Set();
      for (const p of s.points || []) {
        points++;
        if (!ISO.test(p.p)) bad.push(`${key} ${p.p} date`);
        if (!GRAINS.has(p.g)) bad.push(`${key} ${p.p} grain ${p.g}`);
        if (typeof p.v !== "number" || Number.isNaN(p.v)) bad.push(`${key} ${p.p} value`);
        if (!Number.isInteger(p.page) || p.page < 1) bad.push(`${key} ${p.p} page`);
        if (typeof p.quote !== "string" || !p.quote.trim()) bad.push(`${key} ${p.p} quote`);
        if (!file.documents[p.doc]) bad.push(`${key} ${p.p} doc ${p.doc}`);
        const k = p.p + "|" + p.g;
        if (seen.has(k)) bad.push(`${key} duplicate ${k}`);
        seen.add(k);
      }
      if (s.catalogKey && !(s.catalogKey in file.series) && !(s.catalogKey in FR.series) && !(s.catalogKey in AN.series)) bad.push(`${key}.catalogKey ${s.catalogKey} unknown`);
    }
    check(`${name}: every point has p, g, v, doc, page and quote (${points} points, ${Object.keys(file.series).length} series)`, bad.length === 0, bad.slice(0, 5).join("; "));
  }
  for (const [name, file] of [["fundraising 2026Q2", FR], ["annual reports", AN], ["monitor tables", LCD]]) {
    const docs = file.documents ? Object.values(file.documents) : [file];
    const bad = docs.filter((d) => !/^[0-9a-f]{64}$/.test(d.sha256) || !d.file || !/^\d{4}-\d{2}-\d{2}$/.test(d.downloaded));
    check(`${name}: every document carries file, sha256 and download date`, bad.length === 0);
  }
}

/* ---------- 2. every key of the catalog's report group exists ---------- */
{
  /* series-catalog.json group 2 (reports), 46 keys */
  const CATALOG_KEYS = [
    "pb_pd_fundraising_capital_2021ed", "pb_pd_fund_count_2021ed", "pb_pd_fundraising_capital_2022ed", "pb_pd_fund_count_2022ed",
    "pb_pd_fundraising_capital_2023ed", "pb_pd_fund_count_2023ed", "pb_pd_fundraising_capital_2024ed", "pb_pd_fund_count_2024ed",
    "pb_pd_fundraising_capital_q2_2026ed", "pb_pd_fund_count_q2_2026ed", "pb_pd_fundraising_half_year", "pb_pd_fundraising_ttm",
    "pb_pd_aum_headline", "pb_pd_aum_incl_retail", "pb_pd_cumulative_overhang_2021ed", "pb_pd_dry_powder_headline",
    "pb_dl_dry_powder_2021ed", "pb_dl_dry_powder_2022ed", "pb_dl_dry_powder_2023ed", "pb_dl_years_dry_powder_2021ed", "pb_dl_aum",
    "pb_pd_one_year_horizon_irr", "pb_dl_one_year_horizon_irr", "pb_pd_substrategy_one_year_irr", "pb_pd_ten_year_horizon_irr",
    "pb_pd_quarterly_pooled_irr", "lcd_lbo_loan_volume_annual", "lcd_lbo_loan_yield", "lcd_bsl_vs_private_credit_pe_backed_volume",
    "lcd_direct_lending_lbo_spread_stats", "lcd_dual_track_default_rate", "lcd_distressed_exchange_share_of_defaults",
    "lcd_default_rate_by_sponsor_type", "lcd_distressed_ratio_and_volume", "proskauer_private_credit_default_rate",
    "pb_global_lbo_deal_value", "pb_global_lbo_deal_count", "pb_pd_distribution_rate", "pb_pd_net_cash_flow",
    "qp_dl_new_issue_spread_premium_over_bsl", "qp_ll_downgrade_upgrade_ratio", "qp_ndfi_share_of_bank_assets",
    "qp_pd_ttm_distribution_yield", "qp_pd_net_irr_dispersion", "qp_private_credit_volatility", "qp_evergreen_net_aum",
  ];
  const have = new Set([...Object.keys(FR.series), ...Object.keys(AN.series)]);
  const missing = CATALOG_KEYS.filter((k) => !have.has(k));
  check(`all 46 catalog report keys exist (${CATALOG_KEYS.length} listed)`, CATALOG_KEYS.length === 46 && missing.length === 0, missing.join(", "));
}

/* ---------- 3. the figures the capital section quotes, at their pages ---------- */
{
  const at = (file, key, p, g) => (file.series[key] || { points: [] }).points.find((x) => x.p === p && (!g || x.g === g));
  const cap = at(FR, "pb_pd_fundraising_capital_q2_2026ed", "2025-12-31", "year");
  check("2025 private debt fundraising $275.2B on the Q2 2026 report series, p.17", cap && cap.v === 275.2 && cap.page === 17, JSON.stringify(cap));
  const cnt = at(FR, "pb_pd_fund_count_q2_2026ed", "2025-12-31", "year");
  check("2025 fund count 309, p.17", cnt && cnt.v === 309 && cnt.page === 17, JSON.stringify(cnt));
  const h1 = at(FR, "pb_pd_fundraising_capital_q2_2026ed", "2026-06-30", "ytd");
  check("H1 2026 $158.3B is a year-to-date point, p.17", h1 && h1.v === 158.3 && h1.page === 17 && h1.provisional === true);
  const ttm = at(FR, "pb_pd_fundraising_ttm", "2026-06-30", "ttm");
  check("TTM fundraising $309.1B, p.2, window from 2025-07-01", ttm && ttm.v === 309.1 && ttm.page === 2 && ttm.start === "2025-07-01");
  const ttmTable = FR.tables.pb_ttm_fundraising_by_strategy_2026q2;
  const pd = ttmTable.rows.find((r) => r[0] === "Private debt");
  const pe = ttmTable.rows.find((r) => r[0] === "Private equity");
  const total = ttmTable.rows.find((r) => r[0] === "Private capital");
  check("TTM table: private debt 309.1 / +14.0% / 259 / -39.6%, PE 468.8, private capital 1,348.0", pd && pd[1] === 309.1 && pd[2] === 14 && pd[3] === 259 && pd[4] === -39.6 && pe[1] === 468.8 && total[1] === 1348);
  const run = FR.series.pb_pd_fundraising_capital_q2_2026ed.points.filter((x) => x.g === "year").sort((a, b) => (a.p < b.p ? 1 : -1));
  let years = 0;
  for (const x of run) { if (x.v >= 200) years++; else break; }
  check("the $200B run is computable from the series (seven years on this cut, 2019-2025)", years === 7, String(years));
  const dp = at(FR, "pb_pd_dry_powder_headline", "2025-12-31", "asof");
  check("global dry powder $547B at end-2025, p.18", dp && dp.v === 547 && dp.page === 18);
  const aum = at(FR, "pb_pd_aum_headline", "2025-12-31", "asof");
  check("global AUM 'almost $2 trillion' flagged approximate, p.21", aum && aum.v === 2000 && aum.approx === true && aum.page === 21);

  const h = LCD.headlines.pb_us_dl_aum_2025;
  check("US direct lending AUM $465.3B at Dec 31 2025 = 169.6 + 295.7 (slide 35, chart28)", h && h.slide === 35 && h.dryPowder === 169.6 && h.nav === 295.7 && Math.abs(h.dryPowder + h.nav - 465.3) < 1e-9 && h.aum === 465.3);
  check("dry powder share of AUM 36.4% = 169.6 / 465.3", h && h.dryPowderShareOfAum === 36.4 && Math.abs((h.dryPowder / h.aum) * 100 - 36.4) < 0.05);
  check("2024 comparator 454.2 and 37.7%; 2017 peak 52.8%", h && h.prior.aum === 454.2 && h.prior.dryPowderShareOfAum === 37.7 && h.peakShare.dryPowderShareOfAum === 52.8 && Math.abs((h.peakShare.dryPowder / (h.peakShare.dryPowder + h.peakShare.nav)) * 100 - 52.8) < 0.05);
  const share = at(AN, "pb_pd_dry_powder_share_of_aum", "2024-06-30", "asof");
  check("2024 report's 31.1% share is its own percentage key, p.4", share && share.v === 31.1 && share.page === 4 && share.unit !== "$B");
}

/* ---------- 4. catalog verifier corrections and a page sample ---------- */
{
  const at = (key, p, g) => (AN.series[key] || { points: [] }).points.find((x) => x.p === p && x.g === g);
  const c20 = at("pb_pd_fund_count_2022ed", "2020-12-31", "year"), c21 = at("pb_pd_fund_count_2022ed", "2021-12-31", "year");
  check("2022 edition fund count: 2020 = 414 and 2021 = 330 (verifier's swap correction), p.4", c20 && c20.v === 414 && c21 && c21.v === 330 && c20.page === 4);
  const first = at("pb_pd_fundraising_capital_2021ed", "2011-12-31", "year");
  check("2021 report p.4: 2011 capital raised $60.9B", first && first.v === 60.9 && first.page === 4);
  const dl22 = at("pb_dl_dry_powder_2022ed", "2022-12-31", "year");
  check("2022 report p.5: direct lending dry powder $146.3B", dl22 && dl22.v === 146.3 && dl22.page === 5);
  const yr = at("pb_dl_years_dry_powder_2021ed", "2018-12-31", "year");
  check("2021 report p.5: 3.6 years of dry powder in 2018", yr && yr.v === 3.6 && yr.page === 5);
  const dtdr = at("lcd_dual_track_default_rate", "2023-12-31", "asof"), excl = at("lcd_dual_track_default_rate_excl_distressed_exchanges", "2023-12-31", "asof");
  check("2023 report p.15: 3.8% dual-track and 2.05% payment default rate", dtdr && dtdr.v === 3.8 && excl && excl.v === 2.05 && dtdr.page === 15);
  const q3 = at("lcd_dual_track_default_rate", "2026-06-30", "asof");
  check("Q3 2026 QP PG 71: 2.95% including distressed exchanges", q3 && q3.v === 2.95 && q3.page === 71 && q3.doc === "qp2026q3");
  const call = at("qp_pd_capital_call_rate", "2026-03-31", "ttm");
  check("Q3 2026 QP PG 31: private debt capital-call rate 22.1%, US, preliminary", call && call.v === 22.1 && call.page === 31 && call.provisional === true && /US/.test(AN.series.qp_pd_capital_call_rate.geography));
  const lbo6m = at("qp_bsl_lbo_loan_issuance_trailing_6m", "2026-07-22", "rolling6m");
  check("Q3 2026 QP PG 66: $32.3B stamped as of July 22, 2026", lbo6m && lbo6m.v === 32.3 && lbo6m.page === 66);
  const lbo = at("lcd_lbo_loan_volume_annual", "2021-12-31", "year");
  check("2022 report p.12: 2021 BSL LBO loan volume $146.0B", lbo && lbo.v === 146 && lbo.page === 12);
  const yoy = at("lcd_lbo_loan_volume_yoy_pct", "2023-12-31", "year");
  check("the 2023 -58% is a percentage key, not a $B point", yoy && yoy.v === -58 && AN.series.lcd_lbo_loan_volume_yoy_pct.unit === "%");
  const ev = at("qp_evergreen_net_aum", "2025-12-31", "year"), ev1 = at("qp_evergreen_net_aum_2026q1ed", "2024-12-31", "year");
  check("evergreen AUM: Q3 2026 edition 2025 = $551.4B; Q1 2026 edition 2024 = $412.2B kept as its own key", ev && ev.v === 551.4 && ev1 && ev1.v === 412.2);
  const mez = at("pb_pd_substrategy_one_year_irr", "2023-09-30", "quarter"), mez23 = at("pb_pd_substrategy_one_year_irr_2023ed", "2023-09-30", "quarter");
  check("mezzanine Q3 2023: 33.4% (2024 report) beside the 2023 report's 22.8%", mez && mez.v === 33.4 && mez23 && mez23.v === 22.8);
  const dlShare = at("pb_dl_share_of_pd_fundraising", "2024-12-31", "year");
  check("verifier addition: direct lending 60.7% of 2024 private debt fundraising, 2024 report p.10", dlShare && dlShare.v === 60.7 && dlShare.page === 10);
  const median = at("pb_dl_median_fund_size", "2021-12-31", "year");
  check("verifier addition: median direct lending fund size $900.0M, 2021 report p.4", median && median.v === 900 && median.page === 4);
  const sec = FR.series.pb_pd_secondaries_fundraising.points.find((x) => x.p === "2025-12-31");
  check("verifier addition: private debt secondaries $16.1B in 2025, p.21", sec && sec.v === 16.1 && sec.page === 21);
  const dist = FR.series.pb_pd_distribution_rate.points[0];
  check("distribution rate 24.1% relative to 2024 NAV, p.5", dist && dist.v === 24.1 && dist.page === 5);
  /* a split sibling always points back at a catalog key that exists */
  const known = (k) => k in AN.series || k in FR.series;
  const splitsOk = [AN, FR].every((f) => Object.entries(f.splits).every(([k, members]) => known(k) && members.every((m) => m in f.series)));
  check("every split sibling points at a catalog key that exists", splitsOk);
}

/* ---------- 5. the two deal tables ---------- */
{
  const t40 = LCD.tables.lcd_dl_refinanced_in_bsl_2026_08, t41 = LCD.tables.lcd_bsl_replaced_by_dl_2026_08;
  check("slide 40 table: ten rows of five cells", t40 && t40.slide === 40 && t40.rows.length === 10 && t40.rows.every((r) => r.length === 5));
  check("slide 41 table: ten rows of six cells", t41 && t41.slide === 41 && t41.rows.length === 10 && t41.rows.every((r) => r.length === 6));
  check("Catalent row refinances a $4.123 billion private credit loan due 2031", t40.rows.some((r) => r[0] === "Catalent" && /\$4\.123 billion private credit loan due 2031/.test(r[4])));
  check("GlobalTranz row: 4,815 with ten named lenders", t41.rows.some((r) => r[0] === "GlobalTranz Enterprises" && r[2] === "4,815" && r[5].split(",").length === 10));
  check("monitor file carries edition 2026-08, as-of 2026-08-31 and publishedAt 2026-09-08", LCD.edition === "2026-08" && LCD.asOf === "2026-08-31" && LCD.publishedAt === "2026-09-08");

  /* When the deck is on disk (it is gitignored, so only locally), read the
     EMF pictures' text records and compare them with the hand-keyed cells. */
  const deckDir = join(ROOT, "data-sources/lcd");
  let deck = null;
  if (existsSync(deckDir)) {
    for (const d of readdirSync(deckDir)) for (const f of readdirSync(join(deckDir, d))) if (/august-2026.*\.pptx$/i.test(f)) deck = join(deckDir, d, f);
  }
  if (deck && existsSync(join(ROOT, "scripts/lib/zip-read.mjs"))) {
    let zip = null;
    try {
      const { readZip } = await import("./lib/zip-read.mjs");
      zip = readZip(readFileSync(deck));
    } catch (e) {
      check("the deck opens through scripts/lib/zip-read.mjs", false, String(e.message || e));
    }
    /* EMR_EXTTEXTOUTW (type 84): the EMRTEXT block starts 36 bytes into the
       record; nChars at +8 and offString at +12 of that block. */
    const emfText = (buf) => {
      const out = [];
      let off = 0;
      while (off + 8 <= buf.length) {
        const type = buf.readUInt32LE(off), size = buf.readUInt32LE(off + 4);
        if (size < 8) break;
        if (type === 84) {
          const n = buf.readUInt32LE(off + 36 + 8), so = buf.readUInt32LE(off + 36 + 12);
          out.push(buf.toString("utf16le", off + so, off + so + n * 2));
        }
        off += size;
      }
      return out;
    };
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    for (const [table, member] of zip ? [[t40, "ppt/media/image6.emf"], [t41, "ppt/media/image7.emf"]] : []) {
      const strings = emfText(zip.read(member)).map(norm).filter(Boolean);
      const joined = strings.join(" ");
      /* every hand-keyed cell appears in the picture's text (wrapped cells
         are joined with one space in the file, so compare on the joined text) */
      const missing = [];
      for (const row of table.rows) for (const cell of row) if (!joined.includes(norm(cell))) missing.push(cell);
      check(`${member}: every hand-keyed cell of slide ${table.slide} is in the EMF text (${strings.length} strings)`, missing.length === 0, missing.slice(0, 3).join(" | "));
      /* and nothing in the picture is unaccounted for beyond the header */
      const keyed = norm([...table.header, ...table.rows.flat()].join(" "));
      const stray = strings.filter((s) => !keyed.includes(s) && !s.split(" ").every((w) => keyed.includes(w)));
      check(`${member}: no text in the picture is missing from the hand-keyed table`, stray.length === 0, stray.slice(0, 3).join(" | "));
    }
  } else {
    console.log("  skip  deck not on disk; EMF cross-check runs locally only");
  }
}

/* ---------- 6. the served press series ---------- */
{
  check("press-series.json has 20 series", Array.isArray(PRESS.series) && PRESS.series.length === 20, String(PRESS.series && PRESS.series.length));
  let points = 0;
  const bad = [];
  for (const s of PRESS.series) {
    if (!s.key || !s.label || !s.unit || !s.publisher) bad.push(s.key || "?");
    for (const p of s.points) {
      points++;
      if (!/^https?:\/\//.test(p.url || "")) bad.push(`${s.key} ${p.period} url`);
      if (typeof p.value !== "number") bad.push(`${s.key} ${p.period} value`);
      if (!p.check || !Number.isInteger(p.check.status) || !/^\d{4}-\d{2}-\d{2}$/.test(p.check.checkedAt)) bad.push(`${s.key} ${p.period} check`);
    }
  }
  check(`every press point has a value, a URL and a link check (${points} points)`, bad.length === 0, bad.slice(0, 5).join("; "));
  const refused = PRESS.series.flatMap((s) => s.points).filter((p) => p.check && ![200, 403, 302].includes(p.check.status));
  check("every cited URL answered 200, 403 or a cookie-gate 302 when checked", refused.length === 0, refused.map((p) => p.url).slice(0, 3).join(" "));
  const proskauer = PRESS.series.find((s) => s.key === "proskauer_pcdi_overall");
  check("Proskauer overall index runs from 2020Q1 (5.9%) with 26 points", proskauer && proskauer.points.length === 26 && proskauer.points[0].period === "2020Q1" && proskauer.points[0].value === 5.9);
}

/* ---------- 7. no owner name, meta block, key or vendor name anywhere ---------- */
{
  const files = [
    ...readdirSync(REPORTS).filter((f) => f.endsWith(".json")).map((f) => join(REPORTS, f)),
    join(ROOT, "frontend/data/pc/press-series.json"),
    fileURLToPath(import.meta.url),
  ];
  /* The workbook export's meta block names its owner. The name is never
     written into a served file, a fixture or this test; the files are
     scanned as word bigrams and compared by SHA-256 to the name's digest. */
  const NAME_DIGEST = "69c89b4bcbdf855bfc73a35d854a7a66713c6759e7421ec9b36a3bfe4793efa3";
  const META_DIGEST = "9707b8eabdbadea3b3897f9ac228873835c76d289013a816eb977bdeb42f2baf";
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  /* the vendor and model names that must not appear are assembled from
     halves, so the literal never sits in this file either */
  const VENDOR_RE = new RegExp("\\b(" + [["cla", "ude"], ["anthr", "opic"], ["open", "ai"], ["chat", "gpt"], ["copi", "lot"], ["gem", "ini"]].map((w) => w.join("")).join("|") + ")\\b", "i");
  /* working folders and the notes of how a page was fetched are not served either; the patterns are
     assembled from halves so this file does not carry them */
  const LOCAL_RE = new RegExp(["scratch", "pad/"].join(""), "i");
  const PROCESS_RE = new RegExp("\\| " + ["refu", "ter:"].join("") + "|" + ["Web", "Fetch"].join("") + "|\\bcurl\\b", "i");
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const lower = text.toLowerCase();
    if (new RegExp("created " + "for:", "i").test(text)) hits.push(f + ": meta block prefix");
    const words = lower.replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
    for (let i = 0; i + 1 < words.length; i++) if (sha(words[i] + " " + words[i + 1]) === NAME_DIGEST) hits.push(f + ": owner name");
    for (const line of lower.split("\n")) if (sha(line.trim()) === META_DIGEST) hits.push(f + ": meta block");
    if (/\b(api[_-]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9]{16,}/i.test(text)) hits.push(f + ": key-like string");
    if (VENDOR_RE.test(text)) hits.push(f + ": vendor or model name");
    if (/C:\\Users|C:\/Users|\/Users\/[a-z]/i.test(text) || LOCAL_RE.test(text)) hits.push(f + ": local path");
    if (PROCESS_RE.test(text)) hits.push(f + ": a fetch-process note or reviewer tag");
  }
  check(`no file carries the owner's name, the meta block, a key or a vendor name (${files.length} files scanned)`, hits.length === 0, hits.join("; "));
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
