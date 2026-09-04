"""
02_load_sec_data.py
-------------------
Pulls financial facts from the SEC EDGAR API into finance_db.

Universe source: companies.in_fact_universe = 1 in the database
(seeded by 04_seed_universe.py; a future frontend can set it too).

Rolling window: keeps only the last 6 fiscal years. On every run,
facts older than (current year - 6) are deleted, so the window
slides forward automatically each year.

Run:  python 02_load_sec_data.py [limit]   # optional company cap
"""

import json
import sys
import time
from datetime import date
from pathlib import Path

import requests
import mysql.connector

# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------

# SEC politely asks every API user to identify themselves.
HEADERS = {"User-Agent": "SQL Learning Project contact@example.com"}

# Database credentials live OUTSIDE this file in db_config.json,
# which is listed in .gitignore so secrets never reach GitHub.
# The file may also hold API keys for other loaders — keep only the
# MySQL connection keys here.
_cfg = json.loads(
    (Path(__file__).parent / "db_config.json").read_text()
)
DB_CONFIG = {k: _cfg[k] for k in ("host", "port", "user", "password",
                                  "database")}

# The XBRL concepts we pull, as (taxonomy namespace, concept) pairs.
# Most facts live under us-gaap; cover-page share counts live under dei.
# Alternate revenue/cost concepts cover filers that switched tags
# (e.g. Alphabet moved to "Revenues" after Q1 2025).
CONCEPTS = [
    ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
    ("us-gaap", "Revenues"),
    ("us-gaap", "RevenueFromContractWithCustomerIncludingAssessedTax"),
    ("us-gaap", "SalesRevenueNet"),
    ("us-gaap", "CostOfRevenue"),
    ("us-gaap", "CostOfGoodsAndServicesSold"),
    ("us-gaap", "GrossProfit"),
    ("us-gaap", "OperatingIncomeLoss"),
    ("us-gaap", "NetIncomeLoss"),
    ("us-gaap", "EarningsPerShareDiluted"),
    ("us-gaap", "Assets"),
    ("us-gaap", "AssetsCurrent"),
    ("us-gaap", "Liabilities"),
    ("us-gaap", "LiabilitiesCurrent"),
    ("us-gaap", "StockholdersEquity"),
    ("us-gaap", "RetainedEarningsAccumulatedDeficit"),
    ("us-gaap", "CashAndCashEquivalentsAtCarryingValue"),
    ("us-gaap", "NetCashProvidedByUsedInOperatingActivities"),
    ("us-gaap", "NetCashProvidedByUsedInInvestingActivities"),
    ("us-gaap", "NetCashProvidedByUsedInFinancingActivities"),
    ("us-gaap", "PaymentsToAcquirePropertyPlantAndEquipment"),
    ("us-gaap", "CommonStockSharesOutstanding"),
    ("dei", "EntityCommonStockSharesOutstanding"),
]

# Concepts added after the initial schema seed — used by the one-off
# backfill (11_backfill_concepts.py) so existing rows are not refetched.
EXTRA_CONCEPTS = [
    ("us-gaap", "Revenues"),
    ("us-gaap", "RevenueFromContractWithCustomerIncludingAssessedTax"),
    ("us-gaap", "SalesRevenueNet"),
    ("us-gaap", "CostOfGoodsAndServicesSold"),
    ("us-gaap", "AssetsCurrent"),
    ("us-gaap", "LiabilitiesCurrent"),
    ("us-gaap", "RetainedEarningsAccumulatedDeficit"),
    ("us-gaap", "NetCashProvidedByUsedInInvestingActivities"),
    ("us-gaap", "NetCashProvidedByUsedInFinancingActivities"),
    ("us-gaap", "CommonStockSharesOutstanding"),
    ("dei", "EntityCommonStockSharesOutstanding"),
]


# ---------------------------------------------------------------------
# Step 2: fetch one concept's full history for one company
# ---------------------------------------------------------------------
def get_concept_facts(cik, concept, namespace="us-gaap"):
    """
    Call https://data.sec.gov/api/xbrl/companyconcept/CIK.../ns/concept.json
    and return a flat list of fact dicts across all units
    (USD, shares, USD/shares...).
    """
    url = (
        f"https://data.sec.gov/api/xbrl/companyconcept/"
        f"CIK{cik:010d}/{namespace}/{concept}.json"
    )
    resp = requests.get(url, headers=HEADERS, timeout=30)
    if resp.status_code == 404:
        return []  # company simply never reported this concept
    resp.raise_for_status()
    payload = resp.json()

    facts = []
    for unit, rows in payload.get("units", {}).items():
        for r in rows:
            # We only keep figures tied to a fiscal period and a form,
            # skipping one-off instant disclosures without a year.
            if r.get("fy") is None or r.get("form") not in ("10-K", "10-Q"):
                continue
            # A row tagged "FY" must actually span ~a full year.
            # The SEC feed also contains same-year fragments (9-month
            # periods, restated comparatives) mislabeled as FY — those
            # would double-count in any SUM. Balance-sheet instants
            # have no start date and are exempt from this check.
            if r.get("fp", "FY") == "FY" and r.get("start"):
                span = (
                    date.fromisoformat(r["end"])
                    - date.fromisoformat(r["start"])
                ).days
                if span < 300:
                    continue
            facts.append({
                "concept": concept,
                "unit": unit,
                "fiscal_year": r["fy"],
                "fiscal_period": r.get("fp", "FY"),
                "period_start": r.get("start"),      # None for instants
                "period_end": r["end"],
                "value": r["val"],
                "filed_date": r["filed"],
                "form": r["form"],
                "accession_no": r["accn"],
            })

    # Deduplicate. The SEC tags every row in a filing with the FILING's
    # fiscal year — so the FY2022 10-K contains rows fy=2022 covering
    # 2020, 2021 AND 2022 (comparative columns). For each
    # (unit, fiscal_year, fiscal_period) group we therefore:
    #   1. keep only rows with the group's LATEST period_end
    #      (the current period, dropping comparatives), then
    #   2. among those keep the one from the latest filed_date
    #      (newest restatement wins).
    groups = {}
    for f in facts:
        key = (f["unit"], f["fiscal_year"], f["fiscal_period"])
        groups.setdefault(key, []).append(f)
    best = []
    for rows in groups.values():
        latest_end = max(r["period_end"] for r in rows)
        current = [r for r in rows if r["period_end"] == latest_end]
        best.append(max(current, key=lambda r: r["filed_date"]))
    return best


# ---------------------------------------------------------------------
# Step 3: load everything into MySQL
# ---------------------------------------------------------------------
def main():
    limit, offset = None, 0
    if len(sys.argv) > 1:
        limit = int(sys.argv[1])  # e.g. "python 02_load_sec_data.py 40"
    if len(sys.argv) > 2:
        offset = int(sys.argv[2])  # skip the first N companies

    conn = mysql.connector.connect(**DB_CONFIG)
    cur = conn.cursor()

    # Rolling 6-year window, enforced on EVERY run: when the calendar
    # year ticks over, facts older than (current_year - 6) are deleted
    # automatically. No manual maintenance needed.
    min_year = date.today().year - 6
    cur.execute("DELETE FROM financial_facts WHERE fiscal_year < %s",
                (min_year,))
    if cur.rowcount:
        print(f"Rolling window: removed {cur.rowcount} facts "
              f"older than FY{min_year}")
        conn.commit()

    # The universe lives in the DATABASE, not in this file:
    # companies.in_fact_universe = 1 is set by 04_seed_universe.py
    # (or by any future frontend "add company" action).
    cur.execute(
        "SELECT cik, ticker, name FROM companies "
        "WHERE in_fact_universe = 1 ORDER BY sector, ticker"
    )
    universe = cur.fetchall()
    if offset:
        universe = universe[offset:]
    if limit:
        universe = universe[:limit]
    print(f"Universe: {len(universe)} companies, window FY{min_year}+")

    for cik, ticker, name in universe:
        print(f"\n== {ticker} ({name}) — CIK {cik}")
        total = 0
        for namespace, concept in CONCEPTS:
            facts = get_concept_facts(cik, concept, namespace)
            inserted = 0
            for f in facts:
                if f["fiscal_year"] < min_year:
                    continue  # outside the rolling window
                cur.execute(
                    """
                    INSERT IGNORE INTO financial_facts
                        (cik, concept, unit, fiscal_year, fiscal_period,
                         period_start, period_end, value, filed_date,
                         form, accession_no)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (cik, f["concept"], f["unit"], f["fiscal_year"],
                     f["fiscal_period"], f["period_start"],
                     f["period_end"], f["value"], f["filed_date"],
                     f["form"], f["accession_no"]),
                )
                inserted += cur.rowcount  # 1 if inserted, 0 if duplicate
            total += inserted
            print(f"   {concept:<55} +{inserted} rows")
            time.sleep(0.15)  # stay under SEC's 10 req/sec limit

        # Mark whether this company actually yields facts, so the
        # directory/frontend can hide empty shells (ETFs, SPACs...).
        cur.execute(
            "SELECT COUNT(*) FROM financial_facts WHERE cik = %s", (cik,))
        has = 1 if cur.fetchone()[0] > 0 else 0
        cur.execute("UPDATE companies SET has_facts = %s WHERE cik = %s",
                    (has, cik))

        conn.commit()
        print(f"   -> {total} new facts loaded for {ticker} "
              f"(has_facts={has})")

    cur.close()
    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
