"""
08_load_company_profile.py
--------------------------
Fills company profile fields on the companies table from SEC EDGAR
(submissions API) and Finnhub (profile2), so every panel of the Company
Overview frontend — and anything reading finance_db, including Power BI —
sees the same company information.

Scope: KBLB only (owner instruction).

Availability findings for KBLB / OTCQB (verified 2026-08-02):
  * website ......... Finnhub profile2 (SEC field is empty for KBLB)
  * phone ........... SEC submissions API (Finnhub also has it)
  * industry ........ Finnhub industry + SEC sicDescription
  * description ..... NOT AVAILABLE from SEC / Alpha Vantage / Finnhub
  * management ...... NOT AVAILABLE (Finnhub /stock/executive is premium)
  * shareholders .... NOT AVAILABLE from these sources

Run:  python loaders/08_load_company_profile.py
"""

import json
import time
from pathlib import Path

import mysql.connector
import requests

_CFG = json.loads((Path(__file__).parent / "db_config.json").read_text())
DB = {k: _CFG[k] for k in ("host", "port", "user", "password", "database")}
FINNHUB = _CFG["finnhub_api_key"]
HEADERS = {"User-Agent": "SQL Learning Project contact@example.com"}

TICKERS = ["KBLB"]

ALTERS = [
    "ALTER TABLE companies ADD COLUMN website VARCHAR(200) NULL",
    "ALTER TABLE companies ADD COLUMN phone VARCHAR(40) NULL",
    "ALTER TABLE companies ADD COLUMN logo_url VARCHAR(300) NULL",
    "ALTER TABLE companies ADD COLUMN ipo_date DATE NULL",
    "ALTER TABLE companies ADD COLUMN industry VARCHAR(120) NULL",
    "ALTER TABLE companies ADD COLUMN float_shares DOUBLE NULL",
]


def ensure_columns(cur):
    cur.execute("SHOW COLUMNS FROM companies")
    existing = {r[0] for r in cur.fetchall()}
    for ddl in ALTERS:
        col = ddl.split("ADD COLUMN ")[1].split(" ")[0]
        if col not in existing:
            cur.execute(ddl)
            print(f"  + column companies.{col}")


def sec_profile(cik):
    r = requests.get(
        f"https://data.sec.gov/submissions/CIK{cik:010d}.json",
        headers=HEADERS, timeout=30)
    r.raise_for_status()
    d = r.json()
    return {
        "website": d.get("website") or None,
        "phone": d.get("phone") or None,
        "sic": d.get("sicDescription") or None,
    }


def finnhub_profile(ticker):
    r = requests.get(
        "https://finnhub.io/api/v1/stock/profile2",
        params={"symbol": ticker, "token": FINNHUB}, timeout=30)
    r.raise_for_status()
    d = r.json()
    if not d or not d.get("ticker"):
        return {}
    return {
        "website": d.get("weburl") or None,
        "phone": d.get("phone") or None,
        "logo_url": d.get("logo") or None,
        "ipo_date": d.get("ipo") or None,
        "industry": d.get("finnhubIndustry") or None,
        "float_shares": (float(d["floatingShare"]) * 1e6
                         if d.get("floatingShare") else None),
    }


def main():
    conn = mysql.connector.connect(**DB)
    cur = conn.cursor()
    ensure_columns(cur)

    for ticker in TICKERS:
        cur.execute("SELECT cik FROM companies WHERE ticker = %s", (ticker,))
        row = cur.fetchone()
        if not row:
            print(f"{ticker}: not in companies table — skipped")
            continue
        cik = row[0]

        sec = sec_profile(cik)
        time.sleep(0.15)
        fh = finnhub_profile(ticker)

        merged = {
            # SEC is the authority; Finnhub fills what SEC lacks
            "website": sec["website"] or fh.get("website"),
            "phone": sec["phone"] or fh.get("phone"),
            "logo_url": fh.get("logo_url"),
            "ipo_date": fh.get("ipo_date"),
            "industry": fh.get("industry") or sec["sic"],
            "float_shares": fh.get("float_shares"),
        }
        cur.execute(
            """
            UPDATE companies SET website=%s, phone=%s, logo_url=%s,
                ipo_date=%s, industry=%s, float_shares=%s
            WHERE cik=%s
            """,
            (merged["website"], merged["phone"], merged["logo_url"],
             merged["ipo_date"], merged["industry"],
             merged["float_shares"], cik))
        conn.commit()
        print(f"{ticker}: {merged}")
        time.sleep(1)  # Finnhub free-tier courtesy

    conn.close()


if __name__ == "__main__":
    main()
