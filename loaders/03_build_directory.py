"""
03_build_directory.py
---------------------
Builds the searchable company directory from the SEC's bulk
ticker/exchange file (ONE download, no rate limits).

For every ticker-listed company it upserts:
  - companies (cik, name, exchange)
  - tickers   (ticker -> cik, first ticker seen = primary)

It also marks a rough category guess from the company name
(ETF / Fund / Trust etc.) which later helps explain why some
companies have no financial facts.

Safe to re-run any time; never touches financial_facts.
"""

import json
import re
from pathlib import Path

import requests
import mysql.connector

HEADERS = {"User-Agent": "SQL Learning Project contact@example.com"}
BULK_URL = "https://www.sec.gov/files/company_tickers_exchange.json"
_CFG = json.loads(
    (Path(__file__).parent / "db_config.json").read_text()
)
DB_CONFIG = {k: _CFG[k] for k in ("host", "port", "user", "password", "database")}

# Name-based category heuristics. SIC codes (fetched separately for
# universe companies) refine this later.
FUND_PATTERN = re.compile(
    r"\b(ETF|ETN|FUND|PORTFOLIO|TRUST|PORTFOLIOS|SERIES)\b", re.I
)


def guess_category(name: str) -> str:
    return "Fund/ETF (est.)" if FUND_PATTERN.search(name) else "Operating (est.)"


def main():
    data = requests.get(BULK_URL, headers=HEADERS, timeout=60).json()
    rows = data["data"]  # [cik, name, ticker, exchange]
    print(f"Downloaded {len(rows)} ticker rows from SEC")

    conn = mysql.connector.connect(**DB_CONFIG)
    cur = conn.cursor()

    seen_cik = set()
    for cik, name, ticker, exchange in rows:
        cur.execute(
            """
            INSERT INTO companies (cik, ticker, name, exchange, category_est)
            VALUES (%s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                name     = VALUES(name),
                exchange = VALUES(exchange)
            """,
            (cik, ticker, name, exchange, guess_category(name)),
        )
        is_primary = 0 if cik in seen_cik else 1
        seen_cik.add(cik)
        cur.execute(
            """
            INSERT INTO tickers (ticker, cik, is_primary)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE cik = VALUES(cik)
            """,
            (ticker, cik, is_primary),
        )

    conn.commit()
    cur.execute("SELECT COUNT(*) FROM companies")
    print(f"companies table now holds {cur.fetchone()[0]} companies")
    cur.execute("SELECT COUNT(*) FROM tickers")
    print(f"tickers table now holds  {cur.fetchone()[0]} tickers")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
