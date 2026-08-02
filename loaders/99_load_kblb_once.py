"""
99_load_kblb_once.py
--------------------
One-off: pull SEC EDGAR facts for KBLB (CIK 1413119) only, reusing
02_load_sec_data.py's fetch/dedupe logic so rows match a normal run.

Marks the company in_fact_universe = 1 so the standard loader keeps
it refreshed on future scheduled runs.
"""

import sys
import time
from datetime import date
from pathlib import Path

import mysql.connector
import requests

from importlib import import_module

sys.path.insert(0, str(Path(__file__).parent))
loader = import_module("02_load_sec_data")  # digit-leading filename

CIK = 1413119
TICKER = "KBLB"


def main():
    conn = mysql.connector.connect(**loader.DB_CONFIG)
    cur = conn.cursor()

    min_year = date.today().year - 6
    total = 0
    for concept in loader.CONCEPTS:
        facts = loader.get_concept_facts(CIK, concept)
        inserted = 0
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
                (CIK, f["concept"], f["unit"], f["fiscal_year"],
                 f["fiscal_period"], f["period_start"], f["period_end"],
                 f["value"], f["filed_date"], f["form"], f["accession_no"]),
            )
            inserted += cur.rowcount
        total += inserted
        print(f"   {concept:<55} +{inserted} rows")
        time.sleep(0.15)

    # dei namespace: cover-page share counts are NOT under us-gaap, so
    # the standard loader misses them. One-off bridge until the loader
    # learns per-concept namespaces.
    dei_concept = "EntityCommonStockSharesOutstanding"
    url = (
        f"https://data.sec.gov/api/xbrl/companyconcept/"
        f"CIK{CIK:010d}/dei/{dei_concept}.json"
    )
    resp = requests.get(url, headers=loader.HEADERS, timeout=30)
    dei_inserted = 0
    if resp.status_code == 200:
        groups = {}
        for unit, rows in resp.json().get("units", {}).items():
            for r in rows:
                if r.get("fy") is None or r.get("form") not in ("10-K", "10-Q"):
                    continue
                if r.get("fy") < min_year:
                    continue
                key = (unit, r["fy"], r.get("fp", "FY"))
                if r["end"] >= groups.get(key, {}).get("period_end", ""):
                    if r["filed"] >= groups.get(key, {}).get("filed", ""):
                        groups[key] = {
                            "unit": unit, "fy": r["fy"],
                            "fp": r.get("fp", "FY"), "period_end": r["end"],
                            "value": r["val"], "filed": r["filed"],
                            "form": r["form"], "accn": r["accn"],
                        }
        for (unit, fy, fp), g in groups.items():
            cur.execute(
                """
                INSERT IGNORE INTO financial_facts
                    (cik, concept, unit, fiscal_year, fiscal_period,
                     period_start, period_end, value, filed_date,
                     form, accession_no)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (CIK, dei_concept, g["unit"], fy, fp, None,
                 g["period_end"], g["value"], g["filed"], g["form"],
                 g["accn"]),
            )
            dei_inserted += cur.rowcount
    print(f"   {dei_concept:<55} +{dei_inserted} rows (dei)")

    cur.execute(
        "SELECT COUNT(*) FROM financial_facts WHERE cik = %s", (CIK,))
    has = 1 if cur.fetchone()[0] > 0 else 0
    cur.execute(
        "UPDATE companies SET in_fact_universe = 1, has_facts = %s "
        "WHERE cik = %s", (has, CIK))
    conn.commit()
    print(f"\n{TICKER}: {total} new facts, has_facts={has}, committed.")
    conn.close()


if __name__ == "__main__":
    main()
