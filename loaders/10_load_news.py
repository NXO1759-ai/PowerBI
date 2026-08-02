"""Load Marketaux news for KBLB into finance_db.news_articles.

Sources: symbol query (recent coverage) + company-name search (catches
financing/uplisting items not tagged with the ticker). Deduped by URL.
Safe to re-run: rows are upserted on url.
"""
import json
from pathlib import Path

import mysql.connector
import requests

CFG = json.loads((Path(__file__).parent / "db_config.json").read_text())
DB = {k: CFG[k] for k in ("host", "port", "user", "password", "database")}
KEY = CFG["marketaux_api_key"]
TICKER = "KBLB"
NAME = "Kraig Biocraft"

DDL = """
CREATE TABLE IF NOT EXISTS news_articles (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ticker VARCHAR(12) NOT NULL,
  published_at DATETIME NOT NULL,
  title VARCHAR(512) NOT NULL,
  source VARCHAR(128),
  url VARCHAR(768) NOT NULL,
  snippet TEXT,
  query_type VARCHAR(16) NOT NULL,
  fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_url (url(255)),
  KEY idx_ticker_date (ticker, published_at)
)
"""


def fetch(params):
    params = dict(params, language="en", limit=50, api_token=KEY)
    r = requests.get("https://api.marketaux.com/v1/news/all", params=params,
                     timeout=30)
    r.raise_for_status()
    return r.json().get("data", [])


def main():
    conn = mysql.connector.connect(**DB)
    cur = conn.cursor()
    cur.execute(DDL)

    batches = [
        ("symbol", fetch({"symbols": TICKER, "filter_entities": "true"})),
        ("search", fetch({"search": NAME})),
    ]
    ins = 0
    for qtype, articles in batches:
        for a in articles:
            cur.execute(
                """INSERT INTO news_articles
                   (ticker, published_at, title, source, url, snippet, query_type)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)
                   ON DUPLICATE KEY UPDATE title=VALUES(title),
                     source=VALUES(source), snippet=VALUES(snippet)""",
                (TICKER, a.get("published_at", "").replace("T", " ")[:19],
                 a.get("title", "")[:500], (a.get("source") or "")[:120],
                 a.get("url", "")[:750], (a.get("snippet") or "")[:2000],
                 qtype),
            )
            ins += cur.rowcount
    conn.commit()
    cur.execute(
        "SELECT COUNT(*), MIN(published_at), MAX(published_at) "
        "FROM news_articles WHERE ticker=%s", (TICKER,))
    n, lo, hi = cur.fetchone()
    print(f"news_articles: {n} rows for {TICKER} ({lo} -> {hi}), "
          f"{ins} written this run")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
