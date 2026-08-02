"""
09_build_analyst_insight.py
---------------------------
Generates the Analyst Opinion & News panel content with DeepSeek.

DeepSeek does NOT have database or web access of its own — this script is
the bridge: it reads finance_db (price spikes, financing facts, filing
index), packs the evidence into the prompt, and DeepSeek writes the
analysis strictly from that evidence. News APIs (Alpha Vantage, Finnhub)
have zero article coverage for KBLB, so sources cited are SEC filings.

Output lands in finance_db.analyst_insight — the frontend exporter reads
it from there, and Power BI sees the same table on refresh.

Run:  python loaders/09_build_analyst_insight.py
"""

import json
import time
from datetime import date, datetime
from pathlib import Path

import mysql.connector
import requests

_CFG = json.loads((Path(__file__).parent / "db_config.json").read_text())
DB = {k: _CFG[k] for k in ("host", "port", "user", "password", "database")}
DEEPSEEK = _CFG["deepseek_api_key"]

TICKER = "KBLB"
MODEL = "deepseek-chat"

DDL = """
CREATE TABLE IF NOT EXISTS analyst_insight (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    ticker       VARCHAR(15) NOT NULL,
    generated_at DATETIME    NOT NULL,
    model        VARCHAR(40) NOT NULL,
    payload      JSON        NOT NULL,
    KEY ix_insight_ticker (ticker)
)
"""


# ---------------------------------------------------------------------
# evidence gathering
# ---------------------------------------------------------------------

def gather(cur, ticker):
    cur.execute("SELECT cik, name FROM companies WHERE ticker=%s", (ticker,))
    cik, name = cur.fetchone()

    cur.execute(
        "SELECT trade_date, open, high, low, close, volume"
        " FROM price_daily WHERE ticker=%s ORDER BY trade_date", (ticker,))
    bars = [dict(zip(("date", "open", "high", "low", "close", "volume"), r))
            for r in cur.fetchall()]
    for b in bars:
        b["ohlcAvg"] = (b["open"] + b["high"] + b["low"] + b["close"]) / 4
        b["valueTraded"] = b["ohlcAvg"] * b["volume"]
        b["date"] = b["date"].isoformat()
    for i, b in enumerate(bars):
        prev = bars[i - 1] if i else None
        b["pctChange"] = (b["ohlcAvg"] / prev["ohlcAvg"] - 1) * 100 if prev else None
        window = [x["volume"] for x in bars[max(0, i - 20):i]]
        b["volVsAvg20"] = (b["volume"] / (sum(window) / len(window))
                           if window else None)
    spikes = sorted(bars, key=lambda b: b["valueTraded"], reverse=True)[:5]
    spike_out = [{
        "date": s["date"],
        "valueTradedUsd": round(s["valueTraded"]),
        "volumeShares": s["volume"],
        "ohlcAvgUsd": round(s["ohlcAvg"], 4),
        "dayChangePct": round(s["pctChange"], 1) if s["pctChange"] else None,
        "volumeVs20DayAvg": round(s["volVsAvg20"], 1) if s["volVsAvg20"] else None,
    } for s in spikes]

    cur.execute(
        "SELECT DISTINCT form, filed_date, accession_no FROM financial_facts"
        " WHERE cik=%s ORDER BY filed_date DESC LIMIT 14", (cik,))
    filings = [{
        "form": f, "filedDate": d.isoformat(),
        "accessionNo": a,
        "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/"
               f"{a.replace('-', '')}/",
    } for f, d, a in cur.fetchall()]

    cur.execute(
        "SELECT concept, unit, fiscal_year, fiscal_period, value"
        " FROM financial_facts WHERE cik=%s AND concept IN"
        " ('NetCashProvidedByUsedInFinancingActivities',"
        "  'NetCashProvidedByUsedInOperatingActivities',"
        "  'NetCashProvidedByUsedInInvestingActivities',"
        "  'CashAndCashEquivalentsAtCarryingValue',"
        "  'EntityCommonStockSharesOutstanding',"
        "  'StockholdersEquity',"
        "  'RetainedEarningsAccumulatedDeficit',"
        "  'Liabilities',"
        "  'NetIncomeLoss')"
        " AND fiscal_year >= %s", (cik, date.today().year - 3))
    fin = {}
    for concept, unit, yr, per, val in cur.fetchall():
        fin.setdefault(concept, []).append(
            {"fy": yr, "fp": per, "unit": unit, "value": float(val)})
    for rows in fin.values():
        rows.sort(key=lambda r: (r["fy"], r["fp"]))

    return {
        "company": {"ticker": ticker, "name": name, "cik": cik},
        "priceEvidence": {
            "window": f"{bars[0]['date']} to {bars[-1]['date']}",
            "topValueTradedDays": spike_out,
        },
        "secFilingsIndex": filings,
        "financingFacts": fin,
        "newsAvailability": ("Alpha Vantage and Finnhub return zero news "
                             "articles for this OTC ticker; the only citable "
                             "sources are the SEC filings listed."),
    }


# ---------------------------------------------------------------------
# DeepSeek call
# ---------------------------------------------------------------------

def build_prompt(evidence):
    system = (
        "You are an equity analyst writing the 'Analyst Opinion' panel of a "
        "debtsheet dashboard for an OTC-listed company. Rules:\n"
        "1. Use ONLY the evidence JSON provided. Never invent events, news, "
        "or numbers.\n"
        "2. News coverage for this ticker is unavailable — every cited source "
        "must be one of the provided SEC filings (reference by form, filed "
        "date, and url).\n"
        "3. Clearly separate FACT (directly in the data) from INFERENCE "
        "(your reading of the data) using the words FACT/INFERENCE.\n"
        "4. Reply as a single JSON object with exactly these keys:\n"
        "   spike_analysis: array of items {date, observation, drivers, "
        "sources} — one per topValueTradedDays entry; drivers is an array "
        "of strings, sources an array of filing references {form, "
        "filedDate, url} (empty array if none correlate within 3 days).\n"
        "   financing_narrative: string, 2-3 short paragraphs on the last "
        "two years of financing activity, emphasising the most recent four "
        "fiscal quarters (cash-flow-from-financing amounts, share-count "
        "trend i.e. dilution, cash runway vs operating burn).\n"
        "   company_needs: string, one paragraph assessing whether the "
        "company's cash resources meet its plans and whether it is funding "
        "via debt or equity, grounded in the financing facts.\n"
        "   caveats: string listing what could NOT be sourced (e.g. news "
        "articles, analyst estimates).\n"
        "5. Numbers in USD; round to whole dollars; percentages to 1 dp."
    )
    user = (
        "Evidence JSON follows. Write the panel for "
        f"{evidence['company']['name']} ({evidence['company']['ticker']}).\n\n"
        + json.dumps(evidence, indent=1)
    )
    return system, user


def call_deepseek(system, user):
    resp = requests.post(
        "https://api.deepseek.com/chat/completions",
        headers={"Authorization": f"Bearer {DEEPSEEK}",
                 "Content-Type": "application/json"},
        json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.2,
            "max_tokens": 4000,
        },
        timeout=180,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    return json.loads(content)


def main():
    conn = mysql.connector.connect(**DB)
    cur = conn.cursor()
    cur.execute(DDL)

    evidence = gather(cur, TICKER)
    system, user = build_prompt(evidence)
    t0 = time.time()
    payload = call_deepseek(system, user)

    required = {"spike_analysis", "financing_narrative", "company_needs",
                "caveats"}
    missing = required - set(payload)
    if missing:
        raise RuntimeError(f"DeepSeek payload missing keys: {missing}")

    cur.execute(
        "INSERT INTO analyst_insight (ticker, generated_at, model, payload)"
        " VALUES (%s, %s, %s, %s)",
        (TICKER, datetime.now().replace(microsecond=0), MODEL,
         json.dumps(payload)))
    conn.commit()
    conn.close()
    print(f"insight stored for {TICKER} "
          f"({time.time() - t0:.1f}s, model {MODEL})")
    print(json.dumps(payload, indent=2)[:3000])


if __name__ == "__main__":
    main()
