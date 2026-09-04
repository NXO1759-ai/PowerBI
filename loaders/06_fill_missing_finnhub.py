"""
06_fill_missing_finnhub.py
--------------------------
Backfills companies that yielded zero facts from the SEC
companyconcept endpoint, using Finnhub's as-reported financials.

Data policy (docs/DATA_POLICY.md):
  * Finnhub provides the figures when SEC is missing them.
  * Afterwards, every annual Revenue / Net Income value is validated
    against SEC companyfacts. On any discrepancy, SEC SUPERSEDES:
    the database row is overwritten with the SEC figure.

Run:  python 06_fill_missing_finnhub.py
"""

import json
import time
from datetime import date
from pathlib import Path

import requests
import mysql.connector

HEADERS = {"User-Agent": "SQL Learning Project contact@example.com"}
CFG = json.loads((Path(__file__).parent / "db_config.json").read_text())
FINNHUB = CFG["finnhub_api_key"]
DB_CONFIG = {k: CFG[k] for k in ("host", "port", "user", "password", "database")}

MIN_YEAR = date.today().year - 6

# Companies to backfill (ticker -> cik), after the XOM repoint.
TARGETS = {
    "ABT": 1800, "WFC": 72971, "WELL": 766704,
}

# Finnhub concepts (us-gaap_ prefixed) -> our canonical concept.
# Alternatives are tried in order; first tag with data wins.
CONCEPT_MAP = {
    "RevenueFromContractWithCustomerExcludingAssessedTax": [
        "us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax",
        "us-gaap_Revenues",
        "us-gaap_RevenueFromContractWithCustomerIncludingAssessedTax",
        "us-gaap_InterestIncomeExpenseNet",
        "us-gaap_RegulatedAndUnregulatedOperatingRevenue",
    ],
    "GrossProfit": ["us-gaap_GrossProfit"],
    "OperatingIncomeLoss": ["us-gaap_OperatingIncomeLoss"],
    "NetIncomeLoss": ["us-gaap_NetIncomeLoss", "us-gaap_ProfitLoss"],
    "EarningsPerShareDiluted": ["us-gaap_EarningsPerShareDiluted"],
    "Assets": ["us-gaap_Assets"],
    "Liabilities": ["us-gaap_Liabilities"],
    "StockholdersEquity": [
        "us-gaap_StockholdersEquity",
        "us-gaap_StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ],
    "CashAndCashEquivalentsAtCarryingValue": [
        "us-gaap_CashAndCashEquivalentsAtCarryingValue"
    ],
    "NetCashProvidedByUsedInOperatingActivities": [
        "us-gaap_NetCashProvidedByUsedInOperatingActivities"
    ],
    "PaymentsToAcquirePropertyPlantAndEquipment": [
        "us-gaap_PaymentsToAcquirePropertyPlantAndEquipment"
    ],
}

# Canonical concepts used for SEC validation (annual, USD only).
VALIDATE_CONCEPTS = (
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "NetIncomeLoss",
)

UNIT_NORMALIZE = {"usd": "USD", "usd/shares": "USD/shares",
                  "shares": "shares", "pure": "pure"}


def finnhub_reported(symbol, freq):
    r = requests.get(
        "https://finnhub.io/api/v1/stock/financials-reported",
        params={"symbol": symbol, "freq": freq, "token": FINNHUB},
        timeout=30)
    r.raise_for_status()
    return r.json().get("data", [])


def extract_facts(reports):
    """Flatten Finnhub reports into our fact shape, deduped to the
    current period per (concept, year, period) — latest filing wins."""
    groups = {}
    for rep in reports:
        year = rep.get("year")
        if not year or year < MIN_YEAR:
            continue
        q = rep.get("quarter") or 0
        period = "FY" if q == 0 else f"Q{q}"
        for section in ("ic", "bs", "cf"):
            for item in rep["report"].get(section, []):
                groups.setdefault((item["concept"], year, period), []).append(
                    (rep["filedDate"], rep, item)
                )
    facts = []
    for (fh_concept, year, period), rows in groups.items():
        canonical = None
        for canon, alts in CONCEPT_MAP.items():
            if fh_concept in alts:
                canonical = canon
                break
        if not canonical:
            continue
        # current period = latest endDate; then latest filing
        rows.sort(key=lambda x: (x[1]["endDate"], x[0]))
        filed, rep, item = rows[-1]
        facts.append({
            "concept": canonical,
            "unit": UNIT_NORMALIZE.get(item.get("unit", ""), item.get("unit") or "USD"),
            "fiscal_year": year,
            "fiscal_period": period,
            "period_start": (rep.get("startDate") or "")[:10] or None,
            "period_end": rep["endDate"][:10],
            "value": item["value"],
            "filed_date": filed[:10],
            "form": rep.get("form", "10-K"),
            "accession_no": rep.get("accessNumber", ""),
        })
    return facts


def sec_annual_values(cik):
    """{canonical_concept: {period_end: value}} from SEC companyfacts,
    annual durations only. Revenue alternates folded to canonical."""
    r = requests.get(
        f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json",
        headers=HEADERS, timeout=60)
    if r.status_code != 200:
        return {}
    gaap = r.json().get("facts", {}).get("us-gaap", {})
    out = {}
    for canon in VALIDATE_CONCEPTS:
        tags = [t for t in CONCEPT_MAP[canon]
                if t.startswith("us-gaap_")]
        merged = {}
        for tag in tags:
            node = gaap.get(tag[8:])
            if not node:
                continue
            for row in node["units"].get("USD", []):
                if row.get("form") not in ("10-K", "10-Q") or not row.get("start"):
                    continue
                span = (date.fromisoformat(row["end"])
                        - date.fromisoformat(row["start"])).days
                if span < 300:
                    continue
                prev = merged.get(row["end"])
                if not prev or row["filed"] > prev["filed"]:
                    merged[row["end"]] = row
        out[canon] = {k: v["val"] for k, v in merged.items()}
    return out


def main():
    conn = mysql.connector.connect(**DB_CONFIG)
    cur = conn.cursor()

    for ticker, cik in TARGETS.items():
        print(f"\n== {ticker} (CIK {cik})")
        try:
            reports = (finnhub_reported(ticker, "annual")
                       + finnhub_reported(ticker, "quarterly"))
        except Exception as e:
            print(f"   Finnhub error: {e}")
            continue
        facts = extract_facts(reports)
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
                 f["fiscal_period"], f["period_start"], f["period_end"],
                 f["value"], f["filed_date"], f["form"], f["accession_no"]),
            )
            inserted += cur.rowcount

        # --- SEC validation: SEC supersedes on any conflict ---
        sec = sec_annual_values(cik)
        fixes = 0
        for canon, sec_by_end in sec.items():
            for end, sec_val in sec_by_end.items():
                yr = int(end[:4])
                if yr < MIN_YEAR:
                    continue
                cur.execute(
                    """
                    SELECT id, value FROM financial_facts
                    WHERE cik=%s AND concept=%s AND unit='USD'
                      AND period_end=%s AND fiscal_period='FY'
                    """, (cik, canon, end))
                row = cur.fetchone()
                if row and abs(float(row[1]) - float(sec_val)) > 1:
                    cur.execute(
                        "UPDATE financial_facts SET value=%s WHERE id=%s",
                        (sec_val, row[0]))
                    fixes += 1

        cur.execute(
            "SELECT COUNT(*) FROM financial_facts WHERE cik=%s", (cik,))
        has = 1 if cur.fetchone()[0] > 0 else 0
        cur.execute("UPDATE companies SET has_facts=%s WHERE cik=%s",
                    (has, cik))
        conn.commit()
        print(f"   +{inserted} Finnhub facts, {fixes} values "
              f"overridden by SEC, has_facts={has}")
        time.sleep(1)

    cur.close()
    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
