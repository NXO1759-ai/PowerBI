"""
export_dashboard_data.py
------------------------
Exports the Company Overview dashboard data from finance_db (the MySQL
database that also feeds the Power BI semantic model) into static
JavaScript data files the frontend can load from any web host.

Output:  data/company-<ticker>.js  (one per covered company)
         data/company-index.js     (search index)
         data/coverage.js          (list of tickers with data files)

Run from the repo root:
    python frontend/export_dashboard_data.py

Scope notes:
  * Every company in the tracked universe (in_fact_universe=1,
    has_facts=1) gets its own data file, so the frontend can populate
    any searched company instantly.
  * Price / volume history is exported only where a price_daily feed
    exists (currently KBLB); other companies show price panels as
    pending until a market-data feed covers them.
"""

import json
import sys
from datetime import date, datetime
from pathlib import Path

import mysql.connector

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "loaders" / "db_config.json").read_text())
DB = {k: CFG[k] for k in ("host", "port", "user", "password", "database")}

OUT_DIR = Path(__file__).resolve().parent / "data"

FLOW = {
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax",
                "Revenues",
                "RevenueFromContractWithCustomerIncludingAssessedTax",
                "SalesRevenueNet"],
    "cogs": ["CostOfRevenue", "CostOfGoodsAndServicesSold"],
    "grossProfit": ["GrossProfit"],
    "netIncome": ["NetIncomeLoss"],
    "cfOps": ["NetCashProvidedByUsedInOperatingActivities"],
    "cfInv": ["NetCashProvidedByUsedInInvestingActivities"],
    "cfFin": ["NetCashProvidedByUsedInFinancingActivities"],
}
INSTANT = {
    "cash": ["CashAndCashEquivalentsAtCarryingValue"],
    "currentAssets": ["AssetsCurrent"],
    "currentLiabilities": ["LiabilitiesCurrent"],
    "totalAssets": ["Assets"],
    "totalLiabilities": ["Liabilities"],
    "equity": ["StockholdersEquity"],
    "retainedEarnings": ["RetainedEarningsAccumulatedDeficit"],
}
QUARTERS = ("Q1", "Q2", "Q3")


def universe_tickers():
    """All tracked-universe tickers that have financial facts."""
    conn = mysql.connector.connect(**DB)
    cur = conn.cursor()
    cur.execute("SELECT ticker FROM companies"
                " WHERE in_fact_universe = 1 AND has_facts = 1"
                " AND ticker IS NOT NULL ORDER BY ticker")
    rows = [r[0] for r in cur.fetchall()]
    conn.close()
    return rows


def fetch_all(ticker):
    conn = mysql.connector.connect(**DB)
    cur = conn.cursor(dictionary=True, buffered=True)
    cur.execute("SHOW COLUMNS FROM companies")
    cols = {r["Field"] for r in cur.fetchall()}
    extra = [c for c in ("website", "phone", "logo_url", "ipo_date",
                         "industry", "float_shares") if c in cols]
    cur.execute(
        "SELECT cik, ticker, name, exchange"
        + (", " + ", ".join(extra) if extra else "")
        + " FROM companies WHERE ticker = %s",
        (ticker,))
    company = cur.fetchone()
    if not company:
        raise ValueError(f"{ticker} not found in companies table")
    cur.execute(
        "SELECT concept, unit, fiscal_year, fiscal_period, period_end,"
        "       value, filed_date, form"
        " FROM financial_facts WHERE cik = %s", (company["cik"],))
    facts = cur.fetchall()
    prices = []
    try:
        cur.execute(
            "SELECT trade_date, open, high, low, close, volume"
            " FROM price_daily WHERE ticker = %s ORDER BY trade_date",
            (ticker,))
        prices = cur.fetchall()
    except mysql.connector.Error:
        pass  # price_daily not created yet — charts stay pending
    insight = None
    try:
        cur.execute(
            "SELECT payload FROM analyst_insight WHERE ticker = %s"
            " ORDER BY id DESC LIMIT 1", (ticker,))
        row = cur.fetchone()
        if row:
            insight = json.loads(row["payload"])
    except mysql.connector.Error:
        pass  # analyst_insight not created yet
    conn.close()
    return company, facts, prices, insight


def usd(facts, concept, year, period):
    """Single value for (concept, year, period), unit USD; None if absent."""
    vals = [f for f in facts
            if f["concept"] == concept and f["unit"] == "USD"
            and f["fiscal_year"] == year and f["fiscal_period"] == period]
    return float(vals[0]["value"]) if vals else None


def usd_any(facts, concepts, year, period):
    """First available value across an ordered concept fallback list."""
    for concept in concepts:
        v = usd(facts, concept, year, period)
        if v is not None:
            return v
    return None


def latest_quarter(facts):
    """(year, period) of the most recent non-FY period with any fact."""
    pairs = {(f["fiscal_year"], f["fiscal_period"])
             for f in facts if f["fiscal_period"] in QUARTERS}
    if not pairs:
        return None, None
    year = max(y for y, _ in pairs)
    period = max(p for y, p in pairs if y == year)
    return year, period


def prev_period(period):
    return {"Q2": "Q1", "Q3": "Q2"}.get(period)


def flow_value(facts, concepts, year, period):
    """Single-quarter value derived from SEC YTD figures."""
    cur = usd_any(facts, concepts, year, period)
    pp = prev_period(period)
    if pp is None:  # Q1: YTD already is the single quarter
        return cur
    prev = usd_any(facts, concepts, year, pp)
    if cur is None and prev is None:
        return None
    return (cur or 0) - (prev or 0)


def instant_value(facts, concepts, year, period):
    return usd_any(facts, concepts, year, period)


def shares_outstanding(facts):
    """Most recent cover-page share count (dei preferred over us-gaap)."""
    rows = [f for f in facts
            if f["concept"] in ("EntityCommonStockSharesOutstanding",
                                "CommonStockSharesOutstanding")
            and f["unit"] == "shares"]
    if not rows:
        return None
    rows.sort(key=lambda f: (str(f["filed_date"]),
                             f["concept"].startswith("Entity")))
    return float(rows[-1]["value"])


def price_block(prices, shares):
    """OHLC-average + value-traded series and all volume/value statistics,
    using the debtsheet's own formulas."""
    if not prices:
        return None
    series = []
    for p in prices:
        ohlc_avg = (float(p["open"]) + float(p["high"])
                    + float(p["low"]) + float(p["close"])) / 4
        vol = float(p["volume"])
        series.append({
            "date": p["trade_date"].isoformat(),
            "ohlcAvg": round(ohlc_avg, 6),
            "close": float(p["close"]),
            "volume": vol,
            "valueTraded": ohlc_avg * vol,
        })
    vols = [s["volume"] for s in series]
    vals = [s["valueTraded"] for s in series]

    def tail_avg(xs, n):
        w = xs[-n:] if len(xs) >= n else xs
        return sum(w) / len(w) if w else None

    volume_stats = {
        "avg30": tail_avg(vols, 30), "avg60": tail_avg(vols, 60),
        "avg90": tail_avg(vols, 90),
        "min30": min(vols[-30:]), "max30": max(vols[-30:]),
    }
    value_stats = {
        "avg30": tail_avg(vals, 30), "avg60": tail_avg(vals, 60),
        "avg90": tail_avg(vals, 90),
        "min30": min(vals[-30:]), "max30": max(vals[-30:]),
        "daysUnder5k30": sum(1 for v in vals[-30:] if v < 5000),
    }

    def liq(amount, pct, n):
        a = tail_avg(vals, n)
        if not a:
            return None
        days = amount / (pct * a)
        return {"days": round(days, 3), "months": round(days / 21, 1)}

    # position tiers scale with the company's liquidity — micro-cap
    # defaults (100K/50K/25K) are meaningless for mega-caps; keep in
    # sync with the tier logic in frontend/app.js priceBlockFromCandles
    avg_v = tail_avg(vals, 90) or 0
    if avg_v >= 1e9:
        amounts = (50e6, 25e6, 10e6)
    elif avg_v >= 1e8:
        amounts = (10e6, 5e6, 2.5e6)
    elif avg_v >= 1e7:
        amounts = (1e6, 5e5, 2.5e5)
    else:
        amounts = (1e5, 5e4, 2.5e4)

    liquidation = [
        {"pct": pct,
         "rows": [{"amount": amount,
                   "d30": liq(amount, pct, 30),
                   "d60": liq(amount, pct, 60),
                   "d90": liq(amount, pct, 90)}
                  for amount in amounts]}
        for pct in (0.3, 0.2, 0.1)
    ]

    latest = series[-1]
    price = latest["ohlcAvg"]
    base2 = series[-3] if len(series) >= 3 else (series[-2]
                                                 if len(series) >= 2 else None)
    market = {
        "asOf": latest["date"],
        "currentPrice": price,
        "close": latest["close"],
        "change2d": {
            "abs": price - base2["ohlcAvg"] if base2 else None,
            "pct": ((price / base2["ohlcAvg"]) - 1) * 100 if base2 else None,
            "vsDate": base2["date"] if base2 else None,
        },
        "marketCap": price * shares if shares else None,
        "shares499": 0.0499 * shares if shares else None,
        "value499": 0.0499 * shares * price if shares else None,
    }
    return {"series": series, "series30": series[-22:],
            "volumeStats": volume_stats, "valueStats": value_stats,
            "liquidation": liquidation, "market": market}


def eps_filed(facts, year, period):
    """Filed diluted EPS, single-quarter derived (like other flows)."""
    concept = "EarningsPerShareDiluted"

    def val(y, p):
        rows = [f for f in facts if f["concept"] == concept
                and f["unit"] == "USD/shares"
                and f["fiscal_year"] == y and f["fiscal_period"] == p]
        return float(rows[0]["value"]) if rows else None

    cur = val(year, period)
    pp = prev_period(period)
    if pp is None:
        return cur
    prev = val(year, pp)
    if cur is None and prev is None:
        return None
    return (cur or 0) - (prev or 0)


def build(ticker):
    company, facts, prices, insight = fetch_all(ticker)
    yr, per = latest_quarter(facts)
    ly_yr = yr - 1 if yr else None
    shares_val = shares_outstanding(facts)

    flows, instants = {}, {}
    for key, concept in FLOW.items():
        flows[key] = {
            "q": flow_value(facts, concept, yr, per),
            "ly": flow_value(facts, concept, ly_yr, per),
        }
    for key, concept in INSTANT.items():
        instants[key] = {
            "q": instant_value(facts, concept, yr, per),
            "ly": instant_value(facts, concept, ly_yr, per),
        }

    # income statement compares the 3-month quarter against last-year ANNUAL
    is_annual_yr = max((f["fiscal_year"] for f in facts
                        if f["fiscal_period"] == "FY"), default=None)
    is_fy = {k: (usd_any(facts, FLOW[k], is_annual_yr, "FY")
                 if is_annual_yr else None)
             for k in ("revenue", "cogs", "grossProfit", "netIncome")}
    ends = [f["period_end"] for f in facts
            if f["fiscal_year"] == yr and f["fiscal_period"] == per
            and f["period_end"]]
    q_end = max(ends) if ends else None
    q_end_str = (f"{q_end.strftime('%b')} {q_end.day}, {q_end.year}"
                 if q_end else None)
    gm_fy = ((is_fy["grossProfit"] / is_fy["revenue"])
             if is_fy["grossProfit"] is not None and is_fy["revenue"]
             else None)

    def sub(a, b):
        return None if a["q"] is None or b["q"] is None else a["q"] - b["q"]

    def sub_ly(a, b):
        return None if a["ly"] is None or b["ly"] is None else a["ly"] - b["ly"]

    working_capital = {"q": sub(instants["currentAssets"],
                                instants["currentLiabilities"]),
                       "ly": sub_ly(instants["currentAssets"],
                                    instants["currentLiabilities"])}

    def margin(f):
        return None if not f["grossProfit"]["q"] or not f["revenue"]["q"] \
            else f["grossProfit"]["q"] / f["revenue"]["q"]

    gross_margin = {
        "q": (flows["grossProfit"]["q"] / flows["revenue"]["q"])
             if flows["grossProfit"]["q"] is not None
             and flows["revenue"]["q"] else None,
        "ly": (flows["grossProfit"]["ly"] / flows["revenue"]["ly"])
             if flows["grossProfit"]["ly"] is not None
             and flows["revenue"]["ly"] else None,
    }

    def net_change(side):
        vals = [flows[k][side] for k in ("cfOps", "cfInv", "cfFin")]
        return None if all(v is None for v in vals) \
            else sum(v or 0 for v in vals)

    def burn(side):
        nc = net_change(side)
        if nc is None:
            return {"netCashChange": None, "monthlyBurn": None,
                    "remainingCashDays": None}
        monthly = nc / 3
        cash = instants["cash"][side]
        if monthly >= 0:
            remaining = "Infinite"
        elif cash is None:
            remaining = None
        else:
            remaining = round(cash / (-monthly) * 30)
        return {"netCashChange": nc, "monthlyBurn": monthly,
                "remainingCashDays": remaining}

    latest_filing = None
    if facts:
        newest = max(facts, key=lambda f: str(f["filed_date"]))
        fd = newest["filed_date"]
        latest_filing = {
            "form": newest["form"],
            "date": fd.isoformat() if isinstance(fd, (date, datetime))
                    else str(fd),
        }

    data = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": "finance_db (SEC EDGAR 10-K/10-Q); same database that "
                  "feeds the Power BI semantic model",
        "company": company,
        "latestFiling": latest_filing,
        "period": {"fiscalYear": yr, "fiscalPeriod": per,
                   "label": f"{per} {yr}" if yr else None,
                   "compareLabel": f"{per} {ly_yr}" if yr else None,
                   "isLabel": (f"3 mo ended {q_end_str}" if q_end_str
                               else None),
                   "isCompareLabel": (f"FY {is_annual_yr} (annual)"
                                      if is_annual_yr else None)},
        "fundamentals": {
            "balanceSheet": {
                "cash": instants["cash"],
                "currentAssets": instants["currentAssets"],
                "currentLiabilities": instants["currentLiabilities"],
                "workingCapital": working_capital,
                "retainedEarnings": instants["retainedEarnings"],
                "totalAssets": instants["totalAssets"],
                "totalLiabilities": instants["totalLiabilities"],
                "equity": instants["equity"],
            },
            "incomeStatement": {
                "revenue": {"q": flows["revenue"]["q"],
                            "fy": is_fy["revenue"]},
                "cogs": {"q": flows["cogs"]["q"], "fy": is_fy["cogs"]},
                "grossProfit": {"q": flows["grossProfit"]["q"],
                                "fy": is_fy["grossProfit"]},
                "grossMarginPct": {"q": gross_margin["q"], "fy": gm_fy},
                "netIncome": {"q": flows["netIncome"]["q"],
                              "fy": is_fy["netIncome"]},
            },
            "cashFlow": {
                "cfOps": flows["cfOps"],
                "cfInv": flows["cfInv"],
                "cfFin": flows["cfFin"],
                "netCashChange": {"q": net_change("q"), "ly": net_change("ly")},
            },
            "burnRate": {"q": burn("q"), "ly": burn("ly")},
        },
        "shares": {"outstanding": shares_val},
        "price": price_block(prices, shares_val),
        "earnings": {
            "epsFiled": {"q": eps_filed(facts, yr, per),
                         "ly": eps_filed(facts, ly_yr, per)},
            "epsComputed": {
                "q": (flows["netIncome"]["q"] / shares_val)
                     if flows["netIncome"]["q"] is not None and shares_val
                     else None,
                "ly": (flows["netIncome"]["ly"] / shares_val)
                      if flows["netIncome"]["ly"] is not None and shares_val
                      else None,
            },
            "epsEstimate": None,
            "estimateNote": (
                "No analyst EPS estimates — Finnhub returns an empty set "
                "and Alpha Vantage has no coverage for this OTC ticker"
                if ticker == "KBLB" else
                "No analyst EPS estimates available for this ticker."
            ),
        },
        "insight": insight,
        "pending": {
            "companyTexts": "description, management, major shareholders, "
                            "accountant / attorney / transfer agent",
            "analystOpinion": "free-text analysis stays in the debtsheet "
                              "until a notes feed exists",
        },
    }
    return data


def export_company_index():
    """Flat [ticker, cik, name] index for the frontend search box."""
    conn = mysql.connector.connect(**DB)
    cur = conn.cursor()
    cur.execute("SELECT ticker, cik, name FROM companies"
                " WHERE ticker IS NOT NULL AND name IS NOT NULL"
                " ORDER BY ticker")
    rows = [[t, c, n] for t, c, n in cur.fetchall()]
    conn.close()
    out = OUT_DIR / "company-index.js"
    payload = json.dumps(rows, separators=(",", ":"))
    out.write_text(
        "// Generated by frontend/export_dashboard_data.py — do not edit.\n"
        f"window.COMPANY_INDEX = {payload};\n", encoding="utf-8")
    print(f"wrote {out} ({len(payload)} bytes, {len(rows)} companies)")


def export_company(ticker):
    """Write data/company-<ticker>.js; returns the output path."""
    data = build(ticker)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"company-{ticker.lower()}.js"
    payload = json.dumps(data, indent=2, default=str)
    out.write_text(
        "// Generated by frontend/export_dashboard_data.py — do not edit.\n"
        f"window.COMPANY_OVERVIEW_DATA = {payload};\n",
        encoding="utf-8")
    return out, len(payload)


def export_coverage(tickers):
    """Ticker list with exported data files — drives the frontend badge."""
    payload = json.dumps(sorted(tickers), separators=(",", ":"))
    out = OUT_DIR / "coverage.js"
    out.write_text(
        "// Generated by frontend/export_dashboard_data.py — do not edit.\n"
        f"window.COMPANY_COVERAGE = {payload};\n", encoding="utf-8")
    print(f"wrote {out} ({len(tickers)} covered tickers)")


def main():
    tickers = universe_tickers()
    ok, failed = [], []
    for i, tk in enumerate(tickers, 1):
        try:
            out, size = export_company(tk)
            ok.append(tk)
            print(f"[{i}/{len(tickers)}] wrote {out.name} ({size} bytes)")
        except Exception as exc:  # keep the batch going; report at the end
            failed.append((tk, str(exc)))
            print(f"[{i}/{len(tickers)}] FAILED {tk}: {exc}")
    export_coverage(ok)
    export_company_index()
    print(f"done: {len(ok)} exported, {len(failed)} failed")
    if failed:
        for tk, err in failed:
            print(f"  - {tk}: {err}")


if __name__ == "__main__":
    main()
