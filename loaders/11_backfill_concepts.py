"""
11_backfill_concepts.py
-----------------------
One-off backfill: loads only the EXTRA_CONCEPTS (added after the initial
schema seed) for every company in the tracked universe, without refetching
the original concept set. INSERT IGNORE makes re-runs safe.

Run:  python 11_backfill_concepts.py [limit] [offset]
"""

import importlib.util
import sys
import time
from datetime import date
from pathlib import Path

import mysql.connector

# Import shared fetch logic and config from 02_load_sec_data.py
spec = importlib.util.spec_from_file_location(
    "loader02", Path(__file__).parent / "02_load_sec_data.py")
loader02 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader02)

DB_CONFIG = loader02.DB_CONFIG
EXTRA_CONCEPTS = loader02.EXTRA_CONCEPTS

# concepts_dictionary rows for the new concepts (INSERT IGNORE: safe).
DICTIONARY_ROWS = [
    ("Revenues", "Revenue", "Income statement"),
    ("RevenueFromContractWithCustomerIncludingAssessedTax",
     "Revenue (incl. assessed tax)", "Income statement"),
    ("SalesRevenueNet", "Net sales revenue", "Income statement"),
    ("CostOfGoodsAndServicesSold", "Cost of goods & services sold",
     "Income statement"),
    ("AssetsCurrent", "Current assets", "Balance sheet"),
    ("LiabilitiesCurrent", "Current liabilities", "Balance sheet"),
    ("RetainedEarningsAccumulatedDeficit",
     "Retained earnings (deficit)", "Balance sheet"),
    ("NetCashProvidedByUsedInInvestingActivities",
     "Cash flow — investing", "Cash flow"),
    ("NetCashProvidedByUsedInFinancingActivities",
     "Cash flow — financing", "Cash flow"),
    ("CommonStockSharesOutstanding", "Common shares outstanding",
     "Share data"),
    ("EntityCommonStockSharesOutstanding",
     "Entity common shares outstanding", "Share data"),
]


def main():
    limit, offset = (int(sys.argv[1]), int(sys.argv[2])) \
        if len(sys.argv) > 2 else (int(sys.argv[1]), 0) \
        if len(sys.argv) > 1 else (None, 0)

    conn = mysql.connector.connect(**DB_CONFIG)
    cur = conn.cursor()

    cur.executemany(
        "INSERT IGNORE INTO concepts_dictionary (concept, label, category)"
        " VALUES (%s, %s, %s)", DICTIONARY_ROWS)
    conn.commit()

    min_year = date.today().year - 6
    cur.execute(
        "SELECT cik, ticker FROM companies "
        "WHERE in_fact_universe = 1 AND has_facts = 1 ORDER BY ticker")
    universe = cur.fetchall()
    if offset:
        universe = universe[offset:]
    if limit:
        universe = universe[:limit]
    print(f"Backfill: {len(universe)} companies, "
          f"{len(EXTRA_CONCEPTS)} concepts each, window FY{min_year}+")

    for cik, ticker in universe:
        total = 0
        for namespace, concept in EXTRA_CONCEPTS:
            facts = loader02.get_concept_facts(cik, concept, namespace)
            for f in facts:
                if f["fiscal_year"] < min_year:
                    continue
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
                total += cur.rowcount
            time.sleep(0.15)  # stay under SEC's 10 req/sec limit
        conn.commit()
        print(f"   {ticker:<8} +{total} new facts")

    cur.close()
    conn.close()
    print("Backfill done.")


if __name__ == "__main__":
    main()
