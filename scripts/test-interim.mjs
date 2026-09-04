/**
 * test-interim.mjs — the untagged-report parser against a real exhibit:
 * Enlivex's third-quarter 2025 report, furnished on Form 6-K without
 * XBRL (scripts/fixtures/enlv-6k-2025q3-ex99-1.htm). The figures below
 * are read off the exhibit's own tables, in thousands of dollars.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractInterimFacts, looksLikeStatements, factsToBucket } from "./lib/interim-parse.mjs";
import { buildStatements, fiscalYearFor, fiscalQuarterFor } from "./lib/statements.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "fixtures/enlv-6k-2025q3-ex99-1.htm"), "utf8");
let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};
const facts = extractInterimFacts(html);
const find = (concept, start, end) => facts.find((f) => f.concept === concept && (f.start || null) === start && f.end === end);
const val = (concept, start, end) => { const f = find(concept, start, end); return f ? f.val : undefined; };

check("the exhibit is recognised as statements", looksLikeStatements(html));
check("three-month R&D, quarter to Sep 30 2025", val("researchDevelopment", "2025-07-01", "2025-09-30") === 1484000, String(val("researchDevelopment", "2025-07-01", "2025-09-30")));
check("three-month R&D, prior-year quarter", val("researchDevelopment", "2024-07-01", "2024-09-30") === 2348000);
check("nine-month net loss to Sep 30 2025", val("netIncome", "2025-01-01", "2025-09-30") === -7525000, String(val("netIncome", "2025-01-01", "2025-09-30")));
check("three-month net loss", val("netIncome", "2025-07-01", "2025-09-30") === -2205000);
check("operating loss carries its sign", val("operatingIncome", "2025-07-01", "2025-09-30") === -2557000);
check("loss per share is not scaled", val("epsDiluted", "2025-07-01", "2025-09-30") === -0.09);
check("weighted shares are not scaled", val("dilutedShares", "2025-01-01", "2025-09-30") === 23898093);
check("balance sheet at Sep 30 2025", val("totalAssets", null, "2025-09-30") === 20938000 && val("cash", null, "2025-09-30") === 4083000,
  String(val("totalAssets", null, "2025-09-30")));
check("comparative balance sheet at Dec 31 2024", val("totalAssets", null, "2024-12-31") === 27687000 && val("shortTermInvestments", null, "2024-12-31") === 20195000);
check("equity from the equity total", val("equity", null, "2025-09-30") === 17481000);
check("nine-month operating cash flow", val("cfOps", "2025-01-01", "2025-09-30") === -7790000, String(val("cfOps", "2025-01-01", "2025-09-30")));
check("capital expenditure", val("capex", "2025-01-01", "2025-09-30") === -60000);
check("nothing dated outside the report", facts.every((f) => f.end >= "2024-01-01" && f.end <= "2025-12-31"));

/* into the period builder: the quarter and the nine months become periods */
const bucket = factsToBucket(facts, { form: "6-K", filed: "2025-11-14", accn: "0001213900-25-110920", fyEndMonth: 12 }, fiscalYearFor, fiscalQuarterFor);
const s = buildStatements(bucket, { fyEndMonth: 12 });
const q3 = s.quarterly.find((p) => p.periodEnd === "2025-09-30");
check("a Q3 2025 period is built from the parsed facts", !!q3 && q3.fiscalPeriod === "Q3" && q3.form === "6-K", q3 && q3.label);
check("the quarter carries the income statement", !!q3 && q3.incomeStatement.netIncome === -2205000 && q3.incomeStatement.researchDevelopment === 1484000);
check("the quarter carries the balance sheet", !!q3 && q3.balanceSheet.totalAssets === 20938000);

console.log(failed ? "\n" + failed + " failed" : "\nall interim-parse checks pass");
process.exit(failed ? 1 : 0);
