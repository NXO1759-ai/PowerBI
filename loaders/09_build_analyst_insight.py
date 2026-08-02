"""
09_build_analyst_insight.py
---------------------------
Generates the Analyst Opinion & News panel content with DeepSeek.

DeepSeek does NOT have database or web access of its own — this script is
the bridge. It reads finance_db (price spikes, financing facts, filing
index, Marketaux news) and pulls filing text excerpts from SEC EDGAR
(SEPA / promissory-note / MD&A passages), packs everything into the
prompt, and DeepSeek writes the analysis strictly from that evidence.

Payload schema stored in finance_db.analyst_insight:
  company_needs        {general_direction, plans, uses_of_funds,
                        sources_of_funds, financing_need}
  financing_activities [{type, counterparty, terms, status, source}]
  news                 [{date, title, source, url, relevance}]
  spike_analysis       [{date, observation, drivers, sources}]
  caveats              string

Run:  python loaders/09_build_analyst_insight.py
"""

import json
import re
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
EDGAR_UA = {"User-Agent": "Research Agent contact@example.com"}
CACHE = Path(__file__).parent / "filing_cache"

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
# price / facts / news evidence
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

    cur.execute(
        "SELECT published_at, title, source, url, snippet"
        " FROM news_articles WHERE ticker=%s ORDER BY published_at DESC"
        " LIMIT 20", (ticker,))
    news = [{
        "date": p.isoformat(), "title": t, "source": s, "url": u,
        "snippet": (sn or "")[:400],
    } for p, t, s, u, sn in cur.fetchall()]

    return {
        "company": {"ticker": ticker, "name": name, "cik": cik},
        "priceEvidence": {
            "window": f"{bars[0]['date']} to {bars[-1]['date']}",
            "topValueTradedDays": spike_out,
        },
        "secFilingsIndex": filings,
        "financingFacts": fin,
        "marketauxNews": news,
        "newsNote": ("News below comes from Marketaux. Alpha Vantage and "
                     "Finnhub carry no articles for this OTC ticker."),
    }


# ---------------------------------------------------------------------
# EDGAR filing-text excerpts (financing / plans / liquidity)
# ---------------------------------------------------------------------

def _get_json(url):
    for attempt in range(4):
        r = requests.get(url, headers=EDGAR_UA, timeout=30)
        if r.status_code == 200:
            return r.json()
        time.sleep(1.5 * (attempt + 1))
    r.raise_for_status()
    return r.json()


def _fetch_doc_text(cik, accession):
    acc = accession.replace("-", "")
    CACHE.mkdir(exist_ok=True)
    cache_file = CACHE / f"{acc}.txt"
    if cache_file.exists():
        return cache_file.read_text(encoding="utf-8")
    idx = _get_json(
        f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/index.json")
    names = [i["name"] for i in idx["directory"]["item"]]
    main = next((n for n in names
                 if re.match(r"form10-?k?q?\.htm", n, re.I)), None)
    if not main:
        main = next(n for n in names
                    if n.endswith(".htm") and "ex" not in n.lower()
                    and "index" not in n.lower() and not n.startswith("R"))
    r = requests.get(
        f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{main}",
        headers=EDGAR_UA, timeout=60)
    r.raise_for_status()
    html = r.text
    t = re.sub(r"<[^>]+>", " ", html)
    t = re.sub(r"&nbsp;?|&#160;", " ", t)
    t = re.sub(r"&amp;", "&", t)
    t = re.sub(r"&#\d+;", " ", t)
    t = re.sub(r"(us-gaap|kblb|dei|srt):[A-Za-z0-9]+", " ", t, flags=re.I)
    t = re.sub(r"\b0001413119\b", " ", t)
    t = re.sub(r"\b\d{4}-\d{2}-\d{2}\b", " ", t)   # xbrl date noise
    t = re.sub(r"\b[A-Za-z]+Member\b", " ", t)
    t = re.sub(r"\s+", " ", t)
    cache_file.write_text(t, encoding="utf-8")
    time.sleep(0.4)
    return t


_KEYWORDS = [
    "Standby Equity Purchase Agreement", "SEPA", "promissory note",
    "Notre Dame", "going concern", "plan of operation", "liquidity",
    "convertible preferred", "uplisting", "uses of proceeds",
    "working capital", "Prodigy Silk", "Yorkville", "warrant",
]


def _excerpts(text, per_kw=2, before=450, after=650, cap=16000):
    spans = []
    for kw in _KEYWORDS:
        for m in list(re.finditer(re.escape(kw), text, re.I))[:per_kw]:
            spans.append((max(0, m.start() - before), m.end() + after))
    spans.sort()
    merged = []
    for s, e in spans:
        if merged and s <= merged[-1][1] + 200:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    out, total = [], 0
    for s, e in merged:
        chunk = text[s:e].strip()
        if total + len(chunk) > cap:
            break
        out.append(chunk)
        total += len(chunk)
    return out


def gather_filing_text(cur, cik):
    """Excerpts from the latest 10-K and the latest 10-Q."""
    cur.execute(
        "SELECT form, filed_date, accession_no FROM ("
        "  SELECT form, filed_date, accession_no,"
        "    ROW_NUMBER() OVER (PARTITION BY form ORDER BY filed_date DESC) rn"
        "  FROM (SELECT DISTINCT form, filed_date, accession_no"
        "        FROM financial_facts WHERE cik=%s"
        "        AND form IN ('10-K','10-Q')) t) u WHERE rn=1", (cik,))
    out = {}
    for form, filed, acc in cur.fetchall():
        try:
            text = _fetch_doc_text(cik, acc)
            out[form] = {
                "filedDate": filed.isoformat(),
                "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/"
                       f"{acc.replace('-', '')}/",
                "excerpts": _excerpts(text),
            }
        except Exception as exc:  # keep loader resilient
            out[form] = {"filedDate": filed.isoformat(), "error": str(exc)}
    return out


# ---------------------------------------------------------------------
# DeepSeek call
# ---------------------------------------------------------------------

def build_prompt(evidence):
    system = (
        "You are an equity analyst writing the 'Analyst Opinion & News' "
        "panel of a debtsheet dashboard for an OTC-listed company. Rules:\n"
        "1. Use ONLY the evidence JSON provided (database facts, SEC filing "
        "excerpts, Marketaux news). Never invent events, lenders, or numbers.\n"
        "2. Cite sources as filing references {form, filedDate, url} or news "
        "references {date, title, source, url} taken verbatim from the "
        "evidence. Empty array if nothing correlates.\n"
        "3. Reply as ONE JSON object with exactly these keys:\n"
        "   company_needs: object with exactly these string fields —\n"
        "     general_direction: the company's general direction;\n"
        "     plans: what the company plans to do over the coming years;\n"
        "     uses_of_funds: the uses of funds that exist;\n"
        "     sources_of_funds: sources of funds for the projects planned "
        "over the next couple of years;\n"
        "     financing_need: whether the company needs financing; if so, "
        "outline it (amount, likely instrument, runway vs burn).\n"
        "   financing_activities: array of objects, one per TYPE of "
        "financing the company has used or holds (e.g. equity line / PIPE, "
        "promissory note / loan, warrants, convertible preferred, IPO if "
        "any): {type, counterparty (lender/investor name, or null), terms "
        "(amount, pricing, maturity, interest — from the excerpts), status, "
        "source}. PRIORITY: instruments described in filingTextExcerpts are "
        "authoritative and current — always include every type found there "
        "(with the counterparty named in the excerpt). News-derived items "
        "may be added only as additional historical context. Do not include "
        "types with no evidence.\n"
        "   news: array of the marketauxNews items that matter for "
        "investors, each {date, title, source, url, relevance} — relevance "
        "is one sentence of your own. Exclude duplicates.\n"
        "   spike_analysis: array of items {date, observation, drivers, "
        "sources} — one per topValueTradedDays entry; drivers is an array "
        "of strings; sources cites any filing or news within 3 days, else "
        "empty.\n"
        "   caveats: string listing what could NOT be sourced.\n"
        "4. Numbers in USD; round to whole dollars; percentages to 1 dp.\n"
        "5. Keep each company_needs field to 2-4 sentences; each "
        "financing_activities terms field to 1-3 sentences."
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
            "max_tokens": 6000,
        },
        timeout=240,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    return json.loads(content)


def main():
    conn = mysql.connector.connect(**DB)
    cur = conn.cursor()
    cur.execute(DDL)

    evidence = gather(cur, TICKER)
    evidence["filingTextExcerpts"] = gather_filing_text(cur,
                                                        evidence["company"]["cik"])
    system, user = build_prompt(evidence)
    t0 = time.time()
    payload = call_deepseek(system, user)

    required = {"company_needs", "financing_activities", "news",
                "spike_analysis", "caveats"}
    missing = required - set(payload)
    if missing:
        raise RuntimeError(f"DeepSeek payload missing keys: {missing}")
    if not isinstance(payload["company_needs"], dict):
        raise RuntimeError("company_needs is not a structured object")

    cur.execute(
        "INSERT INTO analyst_insight (ticker, generated_at, model, payload)"
        " VALUES (%s, %s, %s, %s)",
        (TICKER, datetime.now().replace(microsecond=0), MODEL,
         json.dumps(payload)))
    conn.commit()
    conn.close()
    print(f"insight stored for {TICKER} "
          f"({time.time() - t0:.1f}s, model {MODEL})")
    print(json.dumps(payload, indent=2)[:4000])


if __name__ == "__main__":
    main()
