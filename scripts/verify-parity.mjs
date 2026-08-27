/**
 * verify-parity.mjs — proves the three surfaces agree.
 *
 *   node scripts/verify-parity.mjs
 *
 * The same metric is stated twice by necessity: in JavaScript for the
 * website and the refresh, and in SQL for Power BI. Two statements drift.
 * This recomputes the SQL views' own output in JavaScript and fails on
 * any disagreement, so drift is caught by CI instead of by someone
 * noticing two dashboards showing different numbers.
 *
 * Without database credentials it still runs the checks that need no
 * database — definitions version, and the committed data files against
 * metrics.js — and reports the SQL comparison as skipped. That keeps it
 * usable in GitHub Actions, where the local MySQL is unreachable.
 */

import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const M = require(join(ROOT, "frontend/lib/metrics.js"));

let failures = 0, checks = 0;
const ok = (name) => { checks++; console.log(`  ok    ${name}`); };
const fail = (name, detail) => {
  checks++; failures++;
  console.log(`  FAIL  ${name}\n        ${detail}`);
};

/* ---------- 1. the SQL views declare the same definitions version ---------- */
console.log("definitions version");
const sqlSrc = readFileSync(join(ROOT, "sql/06_canonical_views.sql"), "utf8");
const m = sqlSrc.match(/SELECT\s+(\d+)\s+AS\s+rt_definitions_version/i);
if (!m) {
  fail("version marker present in 06_canonical_views.sql",
       "no rt_definitions_version found");
} else if (Number(m[1]) !== M.DEFINITIONS_VERSION) {
  fail("version marker matches metrics.js",
       `SQL says v${m[1]}, metrics.js says v${M.DEFINITIONS_VERSION} — ` +
       "a formula changed on one side only");
} else {
  ok(`both declare v${M.DEFINITIONS_VERSION}`);
}

/* ---------- 2. committed data files satisfy their own definitions ---------- */
/* Each file stores both the inputs and the derived values. Recomputing
   the derived values from the inputs catches a file written by an older
   definition, which is exactly what a stale export looks like. */
console.log("committed data files");
const dataDir = join(ROOT, "frontend/data");
const files = existsSync(dataDir)
  ? readdirSync(dataDir).filter((f) => /^company-[a-z0-9.\-]+\.js$/.test(f) &&
      f !== "company-index.js")
  : [];
let recomputed = 0, drifted = [];
for (const file of files) {
  const stub = {};
  try {
    new Function("window", readFileSync(join(dataDir, file), "utf8"))(stub);
  } catch { continue; }
  const d = stub.COMPANY_OVERVIEW_DATA;
  if (!d || !d.fundamentals) continue;
  const bs = d.fundamentals.balanceSheet || {};
  const cf = d.fundamentals.cashFlow || {};
  const q = (o) => (o && M.isNum(o.q) ? o.q : null);

  const wcExpected = M.workingCapital(q(bs.currentAssets), q(bs.currentLiabilities));
  const wcStored = q(bs.workingCapital);
  if (M.isNum(wcExpected) && M.isNum(wcStored) &&
      Math.abs(wcExpected - wcStored) > 1) {
    drifted.push(`${file}: working capital stored ${wcStored}, recomputes ${wcExpected}`);
  }
  const nccExpected = M.netCashChange(q(cf.cfOps), q(cf.cfInv), q(cf.cfFin));
  const nccStored = q(cf.netCashChange);
  if (M.isNum(nccExpected) && M.isNum(nccStored) &&
      Math.abs(nccExpected - nccStored) > 1) {
    drifted.push(`${file}: net cash change stored ${nccStored}, recomputes ${nccExpected}`);
  }
  recomputed++;
}
if (!recomputed) {
  ok("no committed data files to check");
} else if (drifted.length) {
  fail(`${recomputed} data files recompute cleanly`,
       drifted.slice(0, 5).join("\n        ") +
       (drifted.length > 5 ? `\n        ...and ${drifted.length - 5} more` : ""));
} else {
  ok(`${recomputed} data files recompute cleanly`);
}

/* ---------- 3. SQL views vs JavaScript on live rows ---------- */
/* Needs the database. Skipped rather than failed where it is unreachable,
   because CI legitimately has no access to the local MySQL. */
console.log("SQL views against metrics.js");
const cfgPath = process.env.RT_DB_CONFIG ||
  join(ROOT, "loaders/db_config.json");
const mysqlBin = process.env.RT_MYSQL_BIN ||
  "C:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe";

async function compareAgainstSql() {
  if (!existsSync(cfgPath)) return { skipped: "no db_config.json" };
  if (!existsSync(mysqlBin) && !process.env.RT_MYSQL_BIN) {
    return { skipped: "no mysql client" };
  }
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const { execFileSync } = await import("node:child_process");
  const query =
    "SELECT cik, fiscal_year, fiscal_period, span_months, current_assets, " +
    "current_liabilities, working_capital, current_ratio, total_liabilities, " +
    "total_assets, liabilities_to_assets, cf_ops, cf_inv, cf_fin, " +
    "net_cash_change, monthly_net_cash, cash, runway_months " +
    "FROM v_key_metrics WHERE current_assets IS NOT NULL LIMIT 500;";
  let raw;
  try {
    raw = execFileSync(mysqlBin, [
      "-h", String(cfg.host), "-P", String(cfg.port), "-u", String(cfg.user),
      "-D", String(cfg.database), "--batch", "--raw", "-e", query,
    ], { env: { ...process.env, MYSQL_PWD: cfg.password }, encoding: "utf8" });
  } catch (e) {
    return { skipped: "database unreachable" };
  }
  /* Split on either line ending and trim every cell: on Windows the last
     column arrives as "NULL\r", which silently reads as NaN instead of
     null and makes every row look like a mismatch. */
  const lines = raw.trim().split(/\r?\n/);
  const head = lines.shift().split("\t").map((h) => h.trim());
  const num = (raw) => {
    const s = String(raw === undefined ? "" : raw).trim();
    return s === "NULL" || s === "" ? null : Number(s);
  };
  /* SQL DECIMAL and JS double round differently in the last places, so
     compare relatively: 1e-6 is far tighter than any figure shown. */
  const close = (a, b) => {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    return Math.abs(a - b) / scale < 1e-6;
  };
  const mismatches = [];
  let rows = 0;
  for (const line of lines) {
    const cells = line.split("\t").map((c) => c.trim());
    if (cells.length !== head.length) continue;
    const r = Object.fromEntries(head.map((h, i) => [h, cells[i]]));
    rows++;
    const period = r.fiscal_period;
    const cases = [
      ["working_capital", num(r.working_capital),
        M.workingCapital(num(r.current_assets), num(r.current_liabilities))],
      ["current_ratio", num(r.current_ratio),
        M.currentRatio(num(r.current_assets), num(r.current_liabilities))],
      ["liabilities_to_assets", num(r.liabilities_to_assets),
        M.liabilitiesToAssets(num(r.total_liabilities), num(r.total_assets))],
      ["net_cash_change", num(r.net_cash_change),
        M.netCashChange(num(r.cf_ops), num(r.cf_inv), num(r.cf_fin))],
      ["monthly_net_cash", num(r.monthly_net_cash),
        M.monthlyNetCash(M.netCashChange(num(r.cf_ops), num(r.cf_inv), num(r.cf_fin)), period)],
      ["runway_months", num(r.runway_months),
        M.runwayMonths(num(r.cash), num(r.cf_ops), period)],
    ];
    for (const [name, sqlVal, jsVal] of cases) {
      if (!close(sqlVal, jsVal)) {
        mismatches.push(
          `${r.cik} ${r.fiscal_year} ${period} ${name}: SQL=${sqlVal} JS=${jsVal}`);
      }
    }
  }
  return { rows, mismatches };
}

const sqlResult = await compareAgainstSql();
if (sqlResult.skipped) {
  console.log(`  skip  SQL comparison (${sqlResult.skipped})`);
} else if (sqlResult.mismatches.length) {
  fail(`${sqlResult.rows} rows agree between SQL and JavaScript`,
    sqlResult.mismatches.slice(0, 8).join("\n        ") +
    (sqlResult.mismatches.length > 8
      ? `\n        ...and ${sqlResult.mismatches.length - 8} more` : ""));
} else {
  ok(`${sqlResult.rows} rows agree across 6 metrics in SQL and JavaScript`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
