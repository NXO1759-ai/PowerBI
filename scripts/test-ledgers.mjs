/**
 * test-ledgers.mjs — PR H0 build check for the three hyperscaler/neocloud
 * ledgers under frontend/data/ledgers/ (deals, capex, credit).
 *
 * Checks, against the shared summation helper in scripts/lib/ledger.mjs
 * (the same module the page will import, so this test and the page can
 * never disagree about what counts):
 *
 *   1. every row has a url and a status, and every status is recognized
 *   2. the Hyperion (Meta / Blue Owl) deal resolves to exactly one
 *      financing row across the ledger, never zero, never two or three
 *   3. no announcement, contract, backstop, rating action or commentary
 *      row enters a financing total (assert against sumByGroup, not by
 *      re-deriving the rule here)
 *   4. the named PR H0 acceptance figures read as corrected: IREN FY2026
 *      capex 4,333.1M, Cipher FY2024 capex 302.5M and FY2025 492.8M,
 *      Alphabet's 2026-08-06 bond at $25.0bn
 *   5. no AI/vendor/model name appears in any of the three files
 *
 * Exits non-zero on the first category of failure, printing every
 * individual failure first.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isRecognizedStatus,
  isFinancingRow,
  parseAmount,
  sumByGroup,
  dealGroups,
  financingCount,
} from "./lib/ledger.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER_DIR = resolve(ROOT, "frontend/data/ledgers");

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};

function load(name) {
  return JSON.parse(readFileSync(resolve(LEDGER_DIR, `${name}.json`), "utf8"));
}

const deals = load("deals");
const capex = load("capex");
const credit = load("credit");
const ledgers = { deals, capex, credit };

/* ---------- 1. every row has a url and a status; every status recognized ---------- */
for (const [name, ledger] of Object.entries(ledgers)) {
  const noUrl = [];
  const noStatus = [];
  const badStatus = [];
  ledger.rows.forEach((r, i) => {
    if (typeof r.url !== "string" || !r.url.trim()) noUrl.push(`${name}[${i}] ${r.date} ${r.entity}`);
    if (typeof r.status !== "string" || !r.status.trim()) noStatus.push(`${name}[${i}] ${r.date} ${r.entity}`);
    else if (!isRecognizedStatus(r.status)) badStatus.push(`${name}[${i}] status="${r.status}"`);
  });
  check(`${name}: no row without a URL (${ledger.rows.length} rows)`, noUrl.length === 0, noUrl.slice(0, 5).join("; "));
  check(`${name}: no row without a status`, noStatus.length === 0, noStatus.slice(0, 5).join("; "));
  check(`${name}: every status is recognized`, badStatus.length === 0, badStatus.slice(0, 5).join("; "));
  check(`${name}: rowCount field matches rows.length`, ledger.rowCount === ledger.rows.length, `${ledger.rowCount} vs ${ledger.rows.length}`);
  /* Round-2 fix: the prose `ledger` header once drifted from the actual
     row count (deals.json kept saying "81 rows" after PR H0 had grown
     the file to 84) — a stale figure sitting right next to the
     corrected rows it contradicts. Any "<N> rows" the header states for
     itself must equal rowCount, so this can never silently drift again. */
  const rowsMentions = [...String(ledger.ledger || "").matchAll(/\.\s+(\d[\d,]*)\s+rows\s*\(/g)].map((m) => Number(m[1].replace(/,/g, "")));
  const wrongRowsMentions = rowsMentions.filter((n) => n !== ledger.rowCount);
  check(`${name}: the header's own "<N> rows (...)" total matches rowCount (${ledger.rowCount})`, wrongRowsMentions.length === 0, wrongRowsMentions.join(", "));
}

/* ---------- 2. Hyperion appears exactly once in any total ---------- */
{
  const isHyperion = (r) =>
    /Hyperion|Beignet|Blue Owl.*(Meta|Hyperion)|Meta.*Blue Owl/i.test(`${r.entity} ${r.terms || ""} ${r.note || ""}`) &&
    !/El Paso|Sopaipilla/i.test(r.entity);
  const groups = dealGroups(deals.rows, (r) => (isHyperion(r) ? "hyperion" : null));
  const hyperionRows = groups.get("hyperion") || [];
  check(
    "deals: the Hyperion deal appears in the ledger (JV/SPV row + Beignet bond + Meta exposure commentary)",
    hyperionRows.length >= 2,
    `${hyperionRows.length} rows tagged Hyperion`
  );
  check(
    "deals: Hyperion resolves to exactly one financing (signed/closed) row",
    financingCount(hyperionRows) === 1,
    `${financingCount(hyperionRows)} financing rows: ${hyperionRows.filter(isFinancingRow).map((r) => `${r.entity} (${r.status})`).join(", ")}`
  );

  const isElPaso = (r) => /El Paso|Sopaipilla/i.test(`${r.entity} ${r.terms || ""}`);
  const elPasoRows = (dealGroups(deals.rows, (r) => (isElPaso(r) ? "elpaso" : null)).get("elpaso")) || [];
  check(
    "deals: the El Paso venture counts at most once in a financing total (exclusivity only, not yet closed)",
    financingCount(elPasoRows) <= 1,
    `${financingCount(elPasoRows)} financing rows`
  );
}

/* ---------- 3. no announcement/contract/backstop/rating action/commentary enters a financing total ---------- */
{
  const excludedStructureButFinancing = [];
  for (const [name, ledger] of Object.entries(ledgers)) {
    for (const r of ledger.rows) {
      if (isFinancingRow(r) && /^(announcement|contract|commentary|rating action)$/i.test(r.structure || "")) {
        excludedStructureButFinancing.push(`${name}: ${r.date} ${r.entity} structure="${r.structure}" status="${r.status}"`);
      }
    }
  }
  check(
    "no row tagged announcement/contract/commentary/rating-action structure carries a financing status",
    excludedStructureButFinancing.length === 0,
    excludedStructureButFinancing.slice(0, 5).join("; ")
  );

  const { totals: dealTotals, skipped } = sumByGroup(deals.rows, { groupBy: "structure", unit: "USD bn" });
  check("deals: sumByGroup produced at least one structure total (bond/bank loan/etc.)", dealTotals.size > 0, [...dealTotals.keys()].join(", "));
  check(
    "deals: 'commentary' never appears as a key with financing dollars behind it",
    !dealTotals.has("commentary"),
    dealTotals.has("commentary") ? `commentary=${dealTotals.get("commentary")}` : ""
  );
  check(
    "deals: 'contract' never appears as a key with financing dollars behind it (the TeraWulf/Cipher/Hut8/APLD-CoreWeave lease rows)",
    !dealTotals.has("contract"),
    dealTotals.has("contract") ? `contract=${dealTotals.get("contract")}` : ""
  );

  const { totals: creditTotals } = sumByGroup(credit.rows, { groupBy: "structure", unit: "USD bn" });
  check(
    "credit: 'rating action' never appears as a key with financing dollars behind it",
    !creditTotals.has("rating action"),
    creditTotals.has("rating action") ? `rating action=${creditTotals.get("rating action")}` : ""
  );
  check(
    "credit: no financing total mixes a new-issue spread (bps) with an OAS percentage — credit ledger rows never carry a 'bps' or 'pct' unit summed by sumByGroup",
    ![...credit.rows].some((r) => isFinancingRow(r) && /bps|pct|percent/i.test(r.unit || "")),
    ""
  );
}

/* ---------- 4. named PR H0 acceptance figures ---------- */
{
  const irenFy26 = capex.rows.filter(
    (r) => r.entity === "IREN" && r.structure === "outturn" && /FY2026 Q[1-4]/.test(r.note || "")
  );
  const irenFy26Total = irenFy26.reduce((s, r) => s + (parseAmount(r) || 0), 0);
  check(
    "capex: IREN FY2026 capex totals 4,333.1M across its four corrected quarters",
    Math.abs(irenFy26Total - 4333.1) < 0.05,
    `${irenFy26.length} rows, total ${irenFy26Total.toFixed(1)}`
  );

  const cifrRowsFor = (label) => capex.rows.filter((r) => r.entity === "CIFR" && r.structure === "outturn" && (r.note || "").includes(label));
  const cifr2024 = cifrRowsFor("CY2024");
  const cifr2024Total = cifr2024.reduce((s, r) => s + (parseAmount(r) || 0), 0);
  // The printed FY2024 combined total (302.5, from the 10-K directly) can sit up
  // to $0.1M off the sum of the four independently-bridged quarters — each
  // disclosure is rounded to $0.1M on its own — so this tolerance is one dime,
  // not a loose pass: frontend/data/capex-adjustments.json hits the same 302.4/302.5 gap.
  check(
    "capex: Cipher FY2024 capex (combined basis) totals 302.5M ± a $0.1M independent-rounding gap",
    Math.abs(cifr2024Total - 302.5) <= 0.15,
    `${cifr2024.length} rows, total ${cifr2024Total.toFixed(1)}`
  );

  const cifr2025 = cifrRowsFor("CY2025");
  const cifr2025Total = cifr2025.reduce((s, r) => s + (parseAmount(r) || 0), 0);
  check(
    "capex: Cipher FY2025 capex (combined basis) totals 492.8M",
    Math.abs(cifr2025Total - 492.8) < 0.05,
    `${cifr2025.length} rows, total ${cifr2025Total.toFixed(1)}`
  );

  const alphabetAug6 = credit.rows.find((r) => r.entity === "Alphabet (GOOG)" && r.date === "2026-08-06");
  check(
    "credit: Alphabet's 2026-08-06 bond reads $25.0bn, not $24.5bn",
    !!alphabetAug6 && parseAmount(alphabetAug6) === 25,
    alphabetAug6 ? `amount=${alphabetAug6.amount}` : "row not found"
  );
}

/* ---------- 5. decision 12.19: the five commentary rows shipped only after verbatim confirmation ---------- */
{
  const commentaryEntities = ["Federal Reserve Board", "IMF", "BIS", "Financial Stability Board", "Bank of England"];
  for (const entity of commentaryEntities) {
    const row = credit.rows.find((r) => r.entity === entity && r.structure === "commentary");
    check(
      `credit: ${entity} commentary row is present and its note records verbatim confirmation`,
      !!row && /CONFIRMED verbatim/.test(row.note || ""),
      row ? "" : "row not found"
    );
  }
}

/* ---------- 6. no AI/vendor/model self-attribution, no secret ---------- */
{
  // OpenAI, Anthropic, xAI and Nvidia are themselves financing-cohort
  // entities in this dataset (a borrower, a tenant, a counterparty) and
  // are correctly named throughout; the house rule bans the *authoring*
  // model/vendor's own name in the voice of the file (self-attribution),
  // not a real company that happens to share a name with one.
  const banned = /\b(claude sonnet|claude opus|claude haiku|written by claude|generated by claude|chatgpt|gpt-3|gpt-4|gpt-5|gpt4|gemini|copilot|written by an ai|generated by an ai|api[_-]?key\s*[:=]|sk-[a-zA-Z0-9]{16,})\b/i;
  for (const [name, ledger] of Object.entries(ledgers)) {
    const text = JSON.stringify(ledger.rows) + JSON.stringify(ledger.refutation);
    const hit = text.match(banned);
    check(`${name}: no AI/vendor/model self-attribution and no obvious secret`, !hit, hit ? hit[0] : "");
  }
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
