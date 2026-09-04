"""
07_load_price_history.py
------------------------
Pulls daily OHLCV history from Alpha Vantage into finance_db.price_daily.
This is the dashboard's "Data tab" — it feeds the 30-day and 6-month
charts and the volume statistics, replacing the OTC Markets Excel paste.

Scope: KBLB only (owner instruction). Add tickers to TICKERS when asked.

Run:  python loaders/07_load_price_history.py
"""

import json
import time
from datetime import date, timedelta
from pathlib import Path

import mysql.connector
import requests

_CFG = json.loads((Path(__file__).parent / "db_config.json").read_text())
DB = {k: _CFG[k] for k in ("host", "port", "user", "password", "database")}
API_KEY = _CFG["alphavantage_api_key"]

TICKERS = ["KBLB"]
KEEP_DAYS = 240  # ~11 months: covers the 6-month chart with margin

DDL = """
CREATE TABLE IF NOT EXISTS price_daily (
    ticker     VARCHAR(15) NOT NULL,
    cik        INT         NULL,
    trade_date DATE        NOT NULL,
    open       DOUBLE      NOT NULL,
    high       DOUBLE      NOT NULL,
    low        DOUBLE      NOT NULL,
    close      DOUBLE      NOT NULL,
    volume     BIGINT      NOT NULL,
    PRIMARY KEY (ticker, trade_date),
    KEY ix_price_cik (cik)
)
"""


def fetch_daily(ticker):
    url = "https://www.alphavantage.co/query"
    params = {
        "function": "TIME_SERIES_DAILY",
        "symbol": ticker,
        # free tier: compact only (latest 100 trading days); the table
        # accumulates history on each run, so the 6-month window fills
        # in over time (full backfill is a premium feature)
        "outputsize": "compact",
        "apikey": API_KEY,
    }
    resp = requests.get(url, params=params, timeout=60)
    resp.raise_for_status()
    payload = resp.json()
    series = payload.get("Time Series (Daily)")
    if series is None:
        note = payload.get("Note") or payload.get("Information") or payload
        raise RuntimeError(f"Alpha Vantage returned no series: {note}")
    rows = []
    cutoff = date.today() - timedelta(days=KEEP_DAYS)
    for day, bar in series.items():
        d = date.fromisoformat(day)
        if d < cutoff:
            continue
        rows.append((
            ticker, d,
            float(bar["1. open"]), float(bar["2. high"]),
            float(bar["3. low"]), float(bar["4. close"]),
            int(float(bar["5. volume"])),
        ))
    rows.sort(key=lambda r: r[1])
    return rows


def main():
    conn = mysql.connector.connect(**DB)
    cur = conn.cursor()
    cur.execute(DDL)

    for ticker in TICKERS:
        cur.execute("SELECT cik FROM companies WHERE ticker = %s", (ticker,))
        row = cur.fetchone()
        cik = row[0] if row else None

        rows = fetch_daily(ticker)
        cur.executemany(
            """
            INSERT INTO price_daily
                (ticker, cik, trade_date, open, high, low, close, volume)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                cik = VALUES(cik), open = VALUES(open), high = VALUES(high),
                low = VALUES(low), close = VALUES(close),
                volume = VALUES(volume)
            """,
            [(t, cik, d, o, h, l, c, v) for t, d, o, h, l, c, v in rows],
        )
        conn.commit()
        print(f"{ticker}: {len(rows)} daily bars upserted "
              f"({rows[0][1]} → {rows[-1][1]})")
        time.sleep(12)  # free tier: stay well under rate limits

    conn.close()


if __name__ == "__main__":
    main()
