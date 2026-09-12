"""
04_seed_universe.py
-------------------
Marks the curated fact universe in the directory:
top ~30 Technology + ~30 Financials, 5-10 in every other sector,
chosen by S&P 500 weight. For each company it also fetches the
SIC code from the SEC submissions API (one call per company) and
fills in sector.

Run once; re-running just refreshes the same flags.
"""

import json
import time
from pathlib import Path

import requests
import mysql.connector

from sic_sectors import sector_for_sic

HEADERS = {"User-Agent": "SQL Learning Project contact@example.com"}
_CFG = json.loads(
    (Path(__file__).parent / "db_config.json").read_text()
)
DB_CONFIG = {k: _CFG[k] for k in ("host", "port", "user", "password", "database")}

UNIVERSE = {
    "Technology": ["AAPL","MSFT","NVDA","AVGO","ORCL","CRM","AMD","ADBE",
                   "CSCO","ACN","INTC","IBM","QCOM","TXN","AMAT","NOW",
                   "PANW","MU","SNPS","CDNS","INTU","ANET","KLAC","FTNT",
                   "NXPI","MCHP","ADI","CRWD","PLTR","DDOG",
                   # the six neoclouds of the build-out monitor
                   # (blueprint 15.0, frontend/data/cohorts.json), added
                   # to frontend/data/coverage.js in PR H1. This key is
                   # only the fallback when the SIC lookup fails; IREN,
                   # CIFR and WULF carry SIC 6199 ("Finance Services",
                   # their bitcoin-mining legacy), which sector_for_sic
                   # maps to Financials. The site itself classifies all
                   # six as "AI infrastructure" (scripts/lib/sic-map.mjs,
                   # decision 12.18).
                   "CRWV","NBIS","APLD","IREN","CIFR","WULF"],
    "Financials": ["BRK-B","JPM","V","MA","BAC","WFC","GS","MS","AXP",
                   "SPGI","BLK","C","PGR","SCHW","CME","CB","MMC","ICE",
                   "AON","COF","USB","PNC","BK","AFL","MET","PRU","TFC",
                   "AJG","ALL","TRV"],
    "Healthcare": ["LLY","UNH","JNJ","ABBV","MRK","TMO","ABT","DHR",
                   "PFE","AMGN"],
    "Communication Services": ["GOOG","META","NFLX","DIS","TMUS","VZ",
                               "T","CHTR","CMCSA","EA"],
    "Consumer Discretionary": ["AMZN","TSLA","HD","MCD","BKNG","LOW",
                               "TJX","SBUX","NKE","ORLY"],
    "Industrials": ["GE","CAT","RTX","HON","UNP","BA","DE","LMT",
                    "UPS","ADP"],
    "Energy": ["XOM","CVX","COP","SLB","EOG","MPC","PSX"],
    "Consumer Staples": ["WMT","COST","PG","KO","PEP","PM","MO"],
    "Utilities": ["NEE","SO","DUK","CEG","SRE"],
    "Real Estate": ["PLD","AMT","EQIX","SPG","WELL",
                    # Digital Realty, the second landlord of the build-out
                    # monitor (Equinix was already here), added to
                    # coverage.js in PR H1
                    "DLR"],
    "Materials": ["LIN","SHW","FCX","NEM","ECL"],
}


def main():
    conn = mysql.connector.connect(**DB_CONFIG)
    cur = conn.cursor()

    total, missing = 0, []
    for sector_fallback, tickers in UNIVERSE.items():
        for t in tickers:
            total += 1
            cur.execute("SELECT cik FROM tickers WHERE ticker = %s", (t,))
            row = cur.fetchone()
            if not row:
                missing.append(t)
                continue
            cik = row[0]

            # SIC code from the submissions profile (one polite call)
            try:
                r = requests.get(
                    f"https://data.sec.gov/submissions/CIK{cik:010d}.json",
                    headers=HEADERS, timeout=30)
                r.raise_for_status()
                sic = r.json().get("sic")
                sic = int(sic) if sic else None
            except Exception:
                sic = None
            sector = sector_for_sic(sic) or sector_fallback

            cur.execute(
                """
                UPDATE companies
                SET in_fact_universe = 1,
                    sic_code = %s,
                    sector = %s,
                    category_est = 'Operating (est.)'
                WHERE cik = %s
                """,
                (sic, sector, cik),
            )
            time.sleep(0.12)

    conn.commit()
    cur.execute("SELECT COUNT(*) FROM companies WHERE in_fact_universe = 1")
    in_universe = cur.fetchone()[0]
    cur.close()
    conn.close()
    print(f"Universe seeded: {in_universe}/{total} companies flagged")
    if missing:
        print(f"Tickers not found in directory: {missing}")


if __name__ == "__main__":
    main()
