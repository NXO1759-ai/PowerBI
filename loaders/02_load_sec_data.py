"""
02_load_sec_data.py
-------------------
Pulls real financial data from the SEC EDGAR API (free, no key) and
loads it into the finance_db MySQL database.

What it does, step by step:
  1. Downloads the SEC's ticker -> CIK mapping file
  2. For each company in WATCHLIST, looks up its CIK and inserts it
     into the `companies` table
  3. For each concept we care about (revenue, net income, ...), calls
     the SEC "companyconcept" API and inserts every data point into
     the `financial_facts` table
  4. INSERT IGNORE skips rows that are already in the database, so
     re-running this script never creates duplicates.

Run:  python 02_load_sec_data.py
"""

import json
import time
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
DB_CONFIG = json.loads(
    (Path(__file__).parent / "db_config.json").read_text()
)

# The companies we'll load. Add more tickers here any time,
# then just re-run the script.
WATCHLIST = ["AAPL", "MSFT", "NVDA"]

# The XBRL concepts we pull. The keys must match the
# concepts_dictionary rows we inserted in 01_create_schema.sql.
CONCEPTS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "CostOfRevenue",
    "GrossProfit",
    "OperatingIncomeLoss",
    "NetIncomeLoss",
    "EarningsPerShareDiluted",
    "Assets",
    "Liabilities",
    "StockholdersEquity",
    "CashAndCashEquivalentsAtCarryingValue",
    "NetCashProvidedByUsedInOperatingActivities",
    "PaymentsToAcquirePropertyPlantAndEquipment",
]

# ---------------------------------------------------------------------
# Step 1: ticker -> CIK mapping
# ---------------------------------------------------------------------
def get_ticker_map():
    """Return {ticker: (cik, company_name)} from the SEC's JSON file."""
    url = "https://www.sec.gov/files/company_tickers.json"
    data = requests.get(url, headers=HEADERS, timeout=30).json()
    out = {}
    for entry in data.values():
        out[entry["ticker"].upper()] = (entry["cik_str"], entry["title"])
    return out


# ---------------------------------------------------------------------
# Step 2: fetch one concept's full history for one company
# ---------------------------------------------------------------------
def get_concept_facts(cik, concept):
    """
    Call https://data.sec.gov/api/xbrl/companyconcept/CIK.../concept.json
    and return a flat list of fact dicts across all units
    (USD, shares, USD/shares...).
    """
    url = (
        f"https://data.sec.gov/api/xbrl/companyconcept/"
        f"CIK{cik:010d}/us-gaap/{concept}.json"
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
    return facts


# ---------------------------------------------------------------------
# Step 3: load everything into MySQL
# ---------------------------------------------------------------------
def main():
    conn = mysql.connector.connect(**DB_CONFIG)
    cur = conn.cursor()

    ticker_map = get_ticker_map()

    for ticker in WATCHLIST:
        if ticker not in ticker_map:
            print(f"!! {ticker} not found in SEC mapping, skipping")
            continue
        cik, name = ticker_map[ticker]
        print(f"\n== {ticker} ({name}) — CIK {cik}")

        # INSERT IGNORE: if this CIK already exists, do nothing.
        cur.execute(
            "INSERT IGNORE INTO companies (cik, ticker, name) "
            "VALUES (%s, %s, %s)",
            (cik, ticker, name),
        )

        total = 0
        for concept in CONCEPTS:
            facts = get_concept_facts(cik, concept)
            inserted = 0
            for f in facts:
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

        conn.commit()
        print(f"   -> {total} new facts loaded for {ticker}")

    cur.close()
    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
