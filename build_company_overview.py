"""
build_company_overview.py
-------------------------
Generates the "Company Overview" report page (debtsheet-style, modeled
on the KBLB tab of the intern debtsheet workbook) and the DAX measures
that feed it.

Two outputs, both idempotent:
  1. Appends Company Overview measures to
     PowerBI_Dashboard_Project.SemanticModel/definition/tables/
     finance_db financial_facts.tmdl   (re-running replaces the block)
  2. Rewrites the PBIR page folder
     PowerBI_Dashboard_Project.Report/definition/pages/<pageId>/
     and puts the page first in pages.json.

Measure semantics (matches the debtsheet's "Last Quarter / Same Quarter
Last Year" columns):
  * Flow concepts (income statement, cash flow) are SINGLE-QUARTER
    values derived from SEC YTD figures:  Qn = YTD(Qn) - YTD(Qn-1).
  * Instant concepts (balance sheet, share counts) are point-in-time.
  * "Q"   = quarter chosen by the Fiscal Year / Fiscal Period slicers;
            with no selection it falls back to the latest quarter.
  * "Q LY" = same quarter one fiscal year earlier.
  * All measures are company-scoped via the ticker slicer and default
    to KBLB when no ticker is selected.

Pending data feeds (placeholders on the page):
  * daily price/volume (30-day & 6-month charts, volume statistics,
    current price, market cap) — will come from Power BI once a
    market-data table lands in finance_db;
  * free-text fields (description, management, major shareholders,
    service providers, analyst opinion).
"""

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
MODEL_DIR = ROOT / "PowerBI_Dashboard_Project.SemanticModel"
REPORT_DIR = ROOT / "PowerBI_Dashboard_Project.Report"
FACTS_TMDL = MODEL_DIR / "definition" / "tables" / "finance_db financial_facts.tmdl"
PAGES_DIR = REPORT_DIR / "definition" / "pages"
PAGES_JSON = PAGES_DIR / "pages.json"

VISUAL_SCHEMA = (
    "https://developer.microsoft.com/json-schemas/fabric/item/report/"
    "definition/visualContainer/2.11.0/schema.json"
)
PAGE_SCHEMA = (
    "https://developer.microsoft.com/json-schemas/fabric/item/report/"
    "definition/page/2.1.0/schema.json"
)

FACTS = "finance_db financial_facts"
COMPANIES = "finance_db companies"

PAGE_ID = hashlib.md5(b"company-overview-page").hexdigest()[:20]
PAGE_HEIGHT = 1136
PAGE_WIDTH = 1280

_tab_order = 0


def vid(key):
    return hashlib.md5(f"co::{key}".encode()).hexdigest()[:20]


# ---------------------------------------------------------------------
# 1. DAX measures (TMDL)
# ---------------------------------------------------------------------

FLOW_CONCEPTS = [
    ("Revenue Q", "RevenueFromContractWithCustomerExcludingAssessedTax"),
    ("COGS Q", "CostOfRevenue"),
    ("Gross Profit Q", "GrossProfit"),
    ("Net Income Q", "NetIncomeLoss"),
    ("CF Ops Q", "NetCashProvidedByUsedInOperatingActivities"),
    ("CF Inv Q", "NetCashProvidedByUsedInInvestingActivities"),
    ("CF Fin Q", "NetCashProvidedByUsedInFinancingActivities"),
]

INSTANT_CONCEPTS = [
    ("Cash Q", "CashAndCashEquivalentsAtCarryingValue", "USD"),
    ("Current Assets Q", "AssetsCurrent", "USD"),
    ("Current Liabilities Q", "LiabilitiesCurrent", "USD"),
    ("Total Assets Q", "Assets", "USD"),
    ("Total Liabilities Q", "Liabilities", "USD"),
    ("Equity Q", "StockholdersEquity", "USD"),
    ("Retained Earnings Q", "RetainedEarningsAccumulatedDeficit", "USD"),
]


def _period_vars():
    """Shared company/quarter resolution block (3-tab base indent)."""
    return """			VAR t =
				SELECTEDVALUE ( 'finance_db companies'[ticker], "KBLB" )
			VAR yr =
				CALCULATE (
					MAX ( 'finance_db financial_facts'[fiscal_year] ),
					'finance_db companies'[ticker] = t
				)
			VAR per =
				IF (
					ISFILTERED ( 'finance_db financial_facts'[fiscal_period] ),
					MAX ( 'finance_db financial_facts'[fiscal_period] ),
					CALCULATE (
						MAX ( 'finance_db financial_facts'[fiscal_period] ),
						'finance_db companies'[ticker] = t,
						'finance_db financial_facts'[fiscal_year] = yr,
						'finance_db financial_facts'[fiscal_period] <> "FY"
					)
				)"""


def _concept_sum(concept, unit, period_expr, indent=4):
    """CALCULATE(SUM(value), ...) at the given tab indent."""
    i = "\t" * indent
    i2 = "\t" * (indent + 1)
    return (
        f"CALCULATE (\n"
        f"{i2}SUM ( 'finance_db financial_facts'[value] ),\n"
        f"{i2}'finance_db financial_facts'[concept] = \"{concept}\",\n"
        f"{i2}'finance_db financial_facts'[unit] = \"{unit}\",\n"
        f"{i2}'finance_db companies'[ticker] = t,\n"
        f"{i2}REMOVEFILTERS ( 'finance_db financial_facts'[fiscal_year] ),\n"
        f"{i2}REMOVEFILTERS ( 'finance_db financial_facts'[fiscal_period] ),\n"
        f"{i2}'finance_db financial_facts'[fiscal_year] = yr,\n"
        f"{i2}'finance_db financial_facts'[fiscal_period] = {period_expr}\n"
        f"{i})"
    )


def flow_measure(name, concept):
    return (
        f"\tmeasure '{name}' =\n"
        f"{_period_vars()}\n"
        f"			VAR prevper =\n"
        f"				SWITCH ( per, \"Q2\", \"Q1\", \"Q3\", \"Q2\" )\n"
        f"			VAR cur =\n"
        f"				{_concept_sum(concept, 'USD', 'per')}\n"
        f"			VAR prev =\n"
        f"				{_concept_sum(concept, 'USD', 'prevper')}\n"
        f"			RETURN\n"
        f"				cur - prev\n"
        f"		formatString: #,##0"
    )


def instant_measure(name, concept, unit):
    return (
        f"\tmeasure '{name}' =\n"
        f"{_period_vars()}\n"
        f"			RETURN\n"
        f"				{_concept_sum(concept, unit, 'per')}\n"
        f"		formatString: #,##0"
    )


def shares_measure():
    dei = _concept_sum("EntityCommonStockSharesOutstanding", "shares", "per")
    gaap = _concept_sum("CommonStockSharesOutstanding", "shares", "per")
    return (
        f"\tmeasure 'Shares Outstanding Q' =\n"
        f"{_period_vars()}\n"
        f"			VAR dei =\n"
        f"				{dei}\n"
        f"			VAR gaap =\n"
        f"				{gaap}\n"
        f"			RETURN\n"
        f"				COALESCE ( dei, gaap )\n"
        f"		formatString: #,##0"
    )


def ly_measure(base_name, fmt="#,##0"):
    return (
        f"\tmeasure '{base_name} LY' =\n"
        f"			VAR t =\n"
        f"				SELECTEDVALUE ( 'finance_db companies'[ticker], \"KBLB\" )\n"
        f"			VAR yr =\n"
        f"				CALCULATE (\n"
        f"					MAX ( 'finance_db financial_facts'[fiscal_year] ),\n"
        f"					'finance_db companies'[ticker] = t\n"
        f"				)\n"
        f"			RETURN\n"
        f"				CALCULATE (\n"
        f"					[{base_name}],\n"
        f"					'finance_db companies'[ticker] = t,\n"
        f"					REMOVEFILTERS ( 'finance_db financial_facts'[fiscal_year] ),\n"
        f"					'finance_db financial_facts'[fiscal_year] = yr - 1\n"
        f"				)\n"
        f"		formatString: {fmt}"
    )


def simple_measure(name, body_lines, fmt=None):
    text = f"\tmeasure '{name}' =\n" + "\n".join(
        "\t\t\t" + line for line in body_lines
    )
    if fmt:
        text += f"\n		formatString: {fmt}"
    return text


def build_measure_blocks():
    blocks = []

    # Header measures ------------------------------------------------
    blocks.append(simple_measure(
        "Company Name",
        ["VAR t =",
         "	SELECTEDVALUE ( 'finance_db companies'[ticker], \"KBLB\" )",
         "RETURN",
         "	CALCULATE (",
         "		MAX ( 'finance_db companies'[name] ),",
         "		'finance_db companies'[ticker] = t",
         "	)"],
    ))
    blocks.append(simple_measure(
        "Ticker",
        ["SELECTEDVALUE ( 'finance_db companies'[ticker], \"KBLB\" )"],
    ))
    blocks.append(simple_measure(
        "Exchange",
        ["VAR t =",
         "	SELECTEDVALUE ( 'finance_db companies'[ticker], \"KBLB\" )",
         "RETURN",
         "	CALCULATE (",
         "		MAX ( 'finance_db companies'[exchange] ),",
         "		'finance_db companies'[ticker] = t",
         "	)"],
    ))
    blocks.append(simple_measure(
        "CIK",
        ["VAR t =",
         "	SELECTEDVALUE ( 'finance_db companies'[ticker], \"KBLB\" )",
         "RETURN",
         "	CALCULATE (",
         "		MAX ( 'finance_db companies'[cik] ),",
         "		'finance_db companies'[ticker] = t",
         "	)"],
        fmt="0",
    ))
    blocks.append(simple_measure(
        "Latest Filing Date",
        ["VAR t =",
         "	SELECTEDVALUE ( 'finance_db companies'[ticker], \"KBLB\" )",
         "RETURN",
         "	CALCULATE (",
         "		MAX ( 'finance_db financial_facts'[filed_date] ),",
         "		'finance_db companies'[ticker] = t",
         "	)"],
        fmt="Short Date",
    ))
    blocks.append(simple_measure(
        "Latest Filing Form",
        ["VAR t =",
         "	SELECTEDVALUE ( 'finance_db companies'[ticker], \"KBLB\" )",
         "VAR d =",
         "	CALCULATE (",
         "		MAX ( 'finance_db financial_facts'[filed_date] ),",
         "		'finance_db companies'[ticker] = t",
         "	)",
         "RETURN",
         "	CALCULATE (",
         "		MAX ( 'finance_db financial_facts'[form] ),",
         "		'finance_db companies'[ticker] = t",
         "		'finance_db financial_facts'[filed_date] = d",
         "	)"],
    ))

    # Base quarterly measures ----------------------------------------
    for name, concept in FLOW_CONCEPTS:
        blocks.append(flow_measure(name, concept))
    for name, concept, unit in INSTANT_CONCEPTS:
        blocks.append(instant_measure(name, concept, unit))
    blocks.append(shares_measure())

    # Same-quarter-last-year wrappers ---------------------------------
    for name, _ in FLOW_CONCEPTS:
        blocks.append(ly_measure(name))
    for name, _, _ in INSTANT_CONCEPTS:
        blocks.append(ly_measure(name))
    blocks.append(ly_measure("Shares Outstanding Q"))

    # Derived measures -------------------------------------------------
    blocks.append(simple_measure(
        "Gross Margin % Q",
        ["DIVIDE ( [Gross Profit Q], [Revenue Q] )"], fmt="0.0%"))
    blocks.append(simple_measure(
        "Gross Margin % Q LY",
        ["DIVIDE ( [Gross Profit Q LY], [Revenue Q LY] )"], fmt="0.0%"))
    blocks.append(simple_measure(
        "Working Capital Q",
        ["[Current Assets Q] - [Current Liabilities Q]"], fmt="#,##0"))
    blocks.append(simple_measure(
        "Working Capital Q LY",
        ["[Current Assets Q LY] - [Current Liabilities Q LY]"], fmt="#,##0"))
    blocks.append(simple_measure(
        "Net Cash Change Q",
        ["[CF Ops Q] + [CF Inv Q] + [CF Fin Q]"], fmt="#,##0"))
    blocks.append(simple_measure(
        "Net Cash Change Q LY",
        ["[CF Ops Q LY] + [CF Inv Q LY] + [CF Fin Q LY]"], fmt="#,##0"))
    blocks.append(simple_measure(
        "Monthly Burn Q",
        ["DIVIDE ( [Net Cash Change Q], 3 )"], fmt="#,##0"))
    blocks.append(simple_measure(
        "Monthly Burn Q LY",
        ["DIVIDE ( [Net Cash Change Q LY], 3 )"], fmt="#,##0"))
    blocks.append(simple_measure(
        "Remaining Cash Days Q",
        ["VAR burn =",
         "	[Monthly Burn Q]",
         "RETURN",
         "	IF (",
         "		ISBLANK ( burn ),",
         "		BLANK (),",
         "		IF (",
         "			burn >= 0,",
         "			\"Infinite\",",
         "			FORMAT ( DIVIDE ( [Cash Q], - burn ) * 30, \"#,##0\" )",
         "		)",
         "	)"],
    ))
    blocks.append(simple_measure(
        "Remaining Cash Days Q LY",
        ["VAR burn =",
         "	[Monthly Burn Q LY]",
         "RETURN",
         "	IF (",
         "		ISBLANK ( burn ),",
         "		BLANK (),",
         "		IF (",
         "			burn >= 0,",
         "			\"Infinite\",",
         "			FORMAT ( DIVIDE ( [Cash Q LY], - burn ) * 30, \"#,##0\" )",
         "		)",
         "	)"],
    ))
    return blocks


GENERATED_NAMES = [
    "Company Name", "Ticker", "Exchange", "CIK",
    "Latest Filing Date", "Latest Filing Form",
    "Shares Outstanding Q",
    "Gross Margin % Q", "Gross Margin % Q LY",
    "Working Capital Q", "Working Capital Q LY",
    "Net Cash Change Q", "Net Cash Change Q LY",
    "Monthly Burn Q", "Monthly Burn Q LY",
    "Remaining Cash Days Q", "Remaining Cash Days Q LY",
]
GENERATED_NAMES += [n for n, _ in FLOW_CONCEPTS]
GENERATED_NAMES += [f"{n} LY" for n, _ in FLOW_CONCEPTS]
GENERATED_NAMES += [n for n, _, _ in INSTANT_CONCEPTS]
GENERATED_NAMES += [f"{n} LY" for n, _, _ in INSTANT_CONCEPTS]
GENERATED_NAMES += ["Shares Outstanding Q LY"]


def update_tmdl():
    text = FACTS_TMDL.read_text(encoding="utf-8")
    # strip any previously generated measures
    for name in GENERATED_NAMES:
        text = re.sub(
            r"\n\tmeasure '" + re.escape(name) + r"' =\n(?:\t\t[^\n]*\n?)+",
            "\n", text)
    blocks = build_measure_blocks()
    marker = "\n\n\tpartition 'finance_db financial_facts'"
    assert marker in text, "partition marker not found in TMDL"
    text = text.replace(marker, "\n\n" + "\n\n".join(blocks) + marker, 1)
    FACTS_TMDL.write_text(text, encoding="utf-8", newline="\n")

    # offline checks
    check = FACTS_TMDL.read_text(encoding="utf-8")
    for name in GENERATED_NAMES:
        n = check.count(f"\tmeasure '{name}' =")
        assert n == 1, f"measure {name!r} found {n} times"
    assert "//" not in check, "TMDL must not contain // comments"
    return len(blocks)


# ---------------------------------------------------------------------
# 2. PBIR page + visuals
# ---------------------------------------------------------------------

def next_tab():
    global _tab_order
    _tab_order += 1
    return _tab_order


def measure_projection(name):
    return {
        "field": {
            "Measure": {
                "Expression": {"SourceRef": {"Entity": FACTS}},
                "Property": name,
            }
        },
        "queryRef": f"{FACTS}.{name}",
        "nativeQueryRef": name,
    }


def column_projection(entity, column):
    return {
        "field": {
            "Column": {
                "Expression": {"SourceRef": {"Entity": entity}},
                "Property": column,
            }
        },
        "queryRef": f"{entity}.{column}",
        "nativeQueryRef": column,
    }


def card(key, x, y, w, h, measure, show_category=False):
    objects = {}
    if not show_category:
        objects["categoryLabels"] = [{
            "properties": {
                "show": {"expr": {"Literal": {"Value": "false"}}}
            }
        }]
    return {
        "$schema": VISUAL_SCHEMA,
        "name": vid(key),
        "position": {"x": x, "y": y, "z": 0,
                     "height": h, "width": w, "tabOrder": next_tab()},
        "visual": {
            "visualType": "card",
            "query": {"queryState": {"Values": {
                "projections": [measure_projection(measure)]}}},
            "objects": objects,
            "drillFilterOtherVisuals": True,
        },
    }


def textbox(key, x, y, w, h, paragraphs):
    """paragraphs: list of lists of (text, style-dict) runs."""
    paras = []
    for runs in paragraphs:
        paras.append({
            "textRuns": [
                {"value": value, "textStyle": style}
                for value, style in runs
            ]
        })
    return {
        "$schema": VISUAL_SCHEMA,
        "name": vid(key),
        "position": {"x": x, "y": y, "z": 0,
                     "height": h, "width": w, "tabOrder": next_tab()},
        "visual": {
            "visualType": "textbox",
            "objects": {"general": [{"properties": {"paragraphs": paras}}]},
            "drillFilterOtherVisuals": True,
        },
    }


def slicer(key, x, y, w, h, entity, column, title):
    return {
        "$schema": VISUAL_SCHEMA,
        "name": vid(key),
        "position": {"x": x, "y": y, "z": 0,
                     "height": h, "width": w, "tabOrder": next_tab()},
        "visual": {
            "visualType": "slicer",
            "query": {"queryState": {"Values": {
                "projections": [column_projection(entity, column)]}}},
            "objects": {"title": [{
                "properties": {
                    "text": {"expr": {"Literal": {"Value": f"'{title}'"}}}
                }
            }]},
            "drillFilterOtherVisuals": True,
        },
    }


# style shorthands ----------------------------------------------------
S_TITLE = {"fontSize": "18px", "fontWeight": "bold", "color": "#111827"}
S_SECTION = {"fontSize": "13px", "fontWeight": "bold", "color": "#111827"}
S_SUB = {"fontSize": "11px", "fontWeight": "bold", "color": "#374151"}
S_COLHDR = {"fontSize": "8px", "fontWeight": "bold", "color": "#6b7280"}
S_LABEL = {"fontSize": "10px", "color": "#111827"}
S_NOTE = {"fontSize": "10px", "fontStyle": "italic", "color": "#6b7280"}
S_NOTE_SM = {"fontSize": "9px", "fontStyle": "italic", "color": "#9ca3af"}
S_PENDING = {"fontSize": "14px", "color": "#9ca3af"}
S_PENDING_LABEL = {"fontSize": "9px", "color": "#6b7280"}


def build_visuals():
    v = {}

    def put(key, spec):
        assert key not in v, f"duplicate visual key {key}"
        v[key] = spec

    # ---- header band -------------------------------------------------
    put("title", textbox("title", 16, 8, 500, 30,
                         [[("COMPANY OVERVIEW", S_TITLE)]]))
    put("subtitle", textbox("subtitle", 16, 38, 760, 18,
                            [[("Debtsheet-style one-pager · SEC EDGAR "
                               "fundamentals via finance_db · pick a ticker "
                               "to switch company", S_NOTE)]]))

    hdr_cards = [
        ("Company Name", 16, 340), ("Ticker", 364, 104),
        ("Exchange", 476, 120), ("CIK", 604, 120),
        ("Latest Filing Form", 732, 128), ("Latest Filing Date", 868, 140),
    ]
    for name, x, w in hdr_cards:
        put(f"hdr::{name}", card(f"hdr::{name}", x, 62, w, 66, name,
                                 show_category=True))
    for key, label, x in [("price", "Current Price", 1016),
                          ("analyst", "Analyst", 1144)]:
        put(f"hdr::{key}", textbox(
            f"hdr::{key}", x, 62, 120, 66,
            [[(label, S_PENDING_LABEL)], [("—", S_PENDING)]]))

    put("slicer::ticker", slicer("slicer::ticker", 16, 140, 300, 46,
                                 COMPANIES, "ticker", "Company (ticker)"))
    put("slicer::year", slicer("slicer::year", 332, 140, 220, 46,
                               FACTS, "fiscal_year", "Fiscal Year"))
    put("slicer::period", slicer("slicer::period", 568, 140, 220, 46,
                                 FACTS, "fiscal_period", "Fiscal Period"))

    # ---- charts zone (pending market-data feed) ----------------------
    put("chart30::hdr", textbox("chart30::hdr", 16, 198, 760, 20,
                                [[("30 DAY HISTORY", S_SUB)]]))
    put("chart30::box", textbox("chart30::box", 16, 220, 760, 148,
                                [[("Pending market-data feed", S_PENDING)],
                                 [("Columns = OHLC average price · line = "
                                   "value traded (USD) · last 30 trading "
                                   "days. The debtsheet's Data tab will be "
                                   "replaced by a daily price/volume table "
                                   "served through Power BI.", S_NOTE)]]))
    put("chart6m::hdr", textbox("chart6m::hdr", 16, 380, 760, 20,
                                [[("6 MONTH HISTORY", S_SUB)]]))
    put("chart6m::box", textbox("chart6m::box", 16, 402, 760, 160,
                                [[("Pending market-data feed", S_PENDING)],
                                 [("Columns = OHLC average price · line = "
                                   "value traded (USD) · last ~125 trading "
                                   "days. Same feed as the 30-day chart, "
                                   "longer window.", S_NOTE)]]))
    put("analyst::hdr", textbox("analyst::hdr", 792, 198, 472, 20,
                                [[("ANALYST OPINION & NEWS", S_SUB)]]))
    put("analyst::body", textbox(
        "analyst::body", 792, 220, 472, 342,
        [[("Free-text field — pending", S_PENDING)],
         [("On the debtsheet this box carries Company Needs, Financing "
           "Activities and News Updates (e.g. convertible notes, SEPA "
           "agreements, warrants).", S_NOTE)],
         [("These paragraphs are researched from filings, not structured "
           "data. A notes table in finance_db can feed this panel later; "
           "until then it stays in the debtsheet workbook.", S_NOTE)]]))

    # ---- column 1: company information -------------------------------
    put("col1::hdr", textbox("col1::hdr", 16, 578, 400, 22,
                             [[("COMPANY INFORMATION", S_SECTION)]]))
    put("col1::desc", textbox(
        "col1::desc", 16, 604, 400, 110,
        [[("Company Description", S_SUB)],
         [("Business summary text — pending. On the debtsheet this is the "
           "paragraph from the 10-K / Yahoo profile.", S_NOTE)]]))
    put("col1::mgmt_hdr", textbox("col1::mgmt_hdr", 16, 722, 400, 20,
                                  [[("Management", S_SUB)]]))
    put("col1::mgmt", textbox(
        "col1::mgmt", 16, 744, 400, 80,
        [[("Officers & titles — pending (researched from 10-K / proxy).",
           S_NOTE)]]))
    put("col1::msh_hdr", textbox("col1::msh_hdr", 16, 832, 400, 20,
                                 [[("Major Shareholders", S_SUB)]]))
    put("col1::msh", textbox(
        "col1::msh", 16, 854, 400, 66,
        [[("Holder, institution type, holding date, % held — pending.",
           S_NOTE)]]))
    put("col1::svc_hdr", textbox("col1::svc_hdr", 16, 928, 400, 20,
                                 [[("Service Providers", S_SUB)]]))
    put("col1::svc", textbox(
        "col1::svc", 16, 950, 400, 80,
        [[("Accountant · Attorney · Transfer Agent — pending.", S_NOTE)]]))

    # ---- column 2: fundamental analysis ------------------------------
    put("col2::hdr", textbox("col2::hdr", 432, 578, 400, 22,
                             [[("FUNDAMENTAL ANALYSIS", S_SECTION)]]))

    LX, V1X, V2X, LW, VW = 440, 596, 712, 152, 112

    def section(colx, y, name):
        put(f"{colx}::{name}::hdr", textbox(f"{colx}::{name}::hdr",
                                            colx, y, 400, 18,
                                            [[(name, S_SUB)]]))
        put(f"{colx}::{name}::c1", textbox(f"{colx}::{name}::c1",
                                           colx + (V1X - 432), y + 22,
                                           VW, 16, [[("LAST QTR", S_COLHDR)]]))
        put(f"{colx}::{name}::c2", textbox(f"{colx}::{name}::c2",
                                           colx + (V2X - 432), y + 22,
                                           VW, 16,
                                           [[("SAME QTR LY", S_COLHDR)]]))

    def rows(colx, y0, name, items):
        """items: list of (label, measure_prefix or None)."""
        for i, (label, meas) in enumerate(items):
            y = y0 + i * 24
            put(f"{colx}::{name}::r{i}::lbl",
                textbox(f"{colx}::{name}::r{i}::lbl", colx + 8,
                        y, LW + 8, 22, [[(label, S_LABEL)]]))
            for vx, suffix in ((V1X, ""), (V2X, " LY")):
                key = f"{colx}::{name}::r{i}::v{vx}"
                if meas is None:
                    put(key, textbox(key, vx + (colx - 432), y, VW, 22,
                                     [[("—", S_PENDING)]]))
                else:
                    put(key, card(key, vx + (colx - 432), y, VW, 22,
                                  meas + suffix))

    section(432, 604, "Balance Sheet")
    rows(432, 646, "Balance Sheet", [
        ("Cash", "Cash Q"),
        ("Current Assets", "Current Assets Q"),
        ("Current Liabilities", "Current Liabilities Q"),
        ("Working Capital", "Working Capital Q"),
        ("Retained Earnings (Deficit)", "Retained Earnings Q"),
        ("Total Assets", "Total Assets Q"),
        ("Total Liabilities", "Total Liabilities Q"),
        ("Stockholders Equity", "Equity Q"),
    ])
    section(432, 848, "Income Statement")
    rows(432, 890, "Income Statement", [
        ("Revenue", "Revenue Q"),
        ("COGS", "COGS Q"),
        ("Gross Profit", "Gross Profit Q"),
        ("Gross Margin %", "Gross Margin % Q"),
        ("Net Income (Loss)", "Net Income Q"),
    ])

    # ---- column 3: cash flow / burn / volume / shares ----------------
    put("col3::hdr", textbox("col3::hdr", 848, 578, 416, 22,
                             [[("CASH FLOW · VOLUME · SHARES", S_SECTION)]]))
    section(848, 604, "Cash Flow")
    rows(848, 646, "Cash Flow", [
        ("CF from Ops", "CF Ops Q"),
        ("CF from Inv", "CF Inv Q"),
        ("CF from Fin", "CF Fin Q"),
        ("Net Cash Change", "Net Cash Change Q"),
    ])
    put("col3::burn_hdr", textbox("col3::burn_hdr", 848, 752, 416, 18,
                                  [[("Burn Rate (monthly net change ÷ 3)",
                                     S_SUB)]]))
    rows(848, 776, "Burn Rate", [
        ("Monthly Burn", "Monthly Burn Q"),
        ("Remaining Cash (Days)", "Remaining Cash Days Q"),
    ])
    put("col3::vol_hdr", textbox("col3::vol_hdr", 848, 834, 416, 18,
                                 [[("Volume Statistics", S_SUB)]]))
    put("col3::vol", textbox(
        "col3::vol", 848, 856, 416, 150,
        [[("Pending market-data feed", S_PENDING)],
         [("30/60/90-day average daily volume · average daily dollar "
           "volume · min/max volume & value · days traded under $5k · "
           "days-to-liquidate tables. All computed from the daily "
           "price/volume table once it lands in Power BI.", S_NOTE)]]))
    put("col3::share_hdr", textbox("col3::share_hdr", 848, 1018, 416, 18,
                                   [[("Share Information", S_SUB)]]))
    rows(848, 1042, "Share Information", [
        ("Shares Outstanding", "Shares Outstanding Q"),
        ("Current Price", None),
        ("Market Capitalization", None),
    ])

    put("footer", textbox(
        "footer", 16, 1114, 800, 18,
        [[("Fundamentals: SEC EDGAR 10-K/10-Q via finance_db · flows are "
           "single-quarter (derived from YTD) · price/volume panels light "
           "up when the market feed lands.", S_NOTE_SM)]]))

    return v


def write_page(visuals):
    page_dir = PAGES_DIR / PAGE_ID
    (page_dir / "visuals").mkdir(parents=True, exist_ok=True)
    # clear previously generated visuals for idempotency
    for old in (page_dir / "visuals").iterdir():
        if old.is_dir():
            for f in old.iterdir():
                f.unlink()
            old.rmdir()

    (page_dir / "page.json").write_text(json.dumps({
        "$schema": PAGE_SCHEMA,
        "name": PAGE_ID,
        "displayName": "Company Overview",
        "displayOption": "FitToPage",
        "height": PAGE_HEIGHT,
        "width": PAGE_WIDTH,
    }, indent=2) + "\n", encoding="utf-8")

    for key, spec in visuals.items():
        vdir = page_dir / "visuals" / spec["name"]
        vdir.mkdir(parents=True, exist_ok=True)
        (vdir / "visual.json").write_text(
            json.dumps(spec, indent=2) + "\n", encoding="utf-8")

    pages = json.loads(PAGES_JSON.read_text(encoding="utf-8"))
    order = [p for p in pages["pageOrder"] if p != PAGE_ID]
    pages["pageOrder"] = [PAGE_ID] + order
    pages["activePageName"] = PAGE_ID
    PAGES_JSON.write_text(json.dumps(pages, indent=2) + "\n",
                          encoding="utf-8")
    return len(visuals)


if __name__ == "__main__":
    n_measures = update_tmdl()
    print(f"TMDL: {n_measures} Company Overview measures written")
    n_visuals = write_page(build_visuals())
    print(f"Report: page {PAGE_ID} with {n_visuals} visuals written")
