-- =====================================================================
-- 06_canonical_views.sql — the canonical shape of finance_db.
--
-- Power BI imports these views, never the raw tables. Every derived
-- figure below restates a formula from frontend/lib/metrics.js, which is
-- what the website and the weekly refresh use. Two statements of one
-- definition is a drift risk, so scripts/verify-parity.mjs recomputes the
-- views in JavaScript against live rows and fails when they disagree.
--
-- Bump rt_definitions_version here and in metrics.js together. The parity
-- check compares the two and fails on a mismatch, so SQL can never
-- silently lag the JavaScript.
--
-- Apply:  mysql -u learn -p finance_db < sql/06_canonical_views.sql
-- =====================================================================

-- Version marker, read by the parity checker.
DROP VIEW IF EXISTS v_definitions_version;
CREATE VIEW v_definitions_version AS SELECT 2 AS rt_definitions_version;

-- ---------------------------------------------------------------------
-- v_facts_canonical — one row per (cik, concept, unit, year, period).
--
-- EDGAR restates: the same concept and period arrives again in later
-- filings and in amendments. The loader keeps them all, so a naive join
-- multiplies rows and doubles totals. This picks exactly one fact per
-- period using the same precedence as api/pull.js:
--   1. latest period_end   (the most recently closed books)
--   2. longest duration    (YTD over a stub quarter)
--   3. latest filed_date   (an amendment supersedes the original)
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_facts_canonical;
-- Column list is deliberately identical to financial_facts, id included,
-- so the Power BI partition can swap the table for this view without any
-- change to the model's columns, measures or relationships.
CREATE VIEW v_facts_canonical AS
SELECT id, cik, concept, unit, fiscal_year, fiscal_period,
       period_start, period_end, value, filed_date, form, accession_no
FROM (
  SELECT f.*,
         ROW_NUMBER() OVER (
           PARTITION BY f.cik, f.concept, f.unit, f.fiscal_year, f.fiscal_period
           ORDER BY f.period_end DESC,
                    DATEDIFF(f.period_end, COALESCE(f.period_start, f.period_end)) DESC,
                    f.filed_date DESC,
                    f.id DESC
         ) AS rn
  FROM financial_facts f
  WHERE f.form IN ('10-K','10-Q','20-F','40-F',
                   '10-K/A','10-Q/A','20-F/A','40-F/A')
    AND f.value IS NOT NULL
) ranked
WHERE rn = 1;

-- ---------------------------------------------------------------------
-- v_fundamentals — the raw facts pivoted into named line items.
--
-- COALESCE order encodes the taxonomy preference: the ASC 606 revenue tag
-- first, then the older ones, so a company that switched tags mid-history
-- still reports a continuous series.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_fundamentals;
CREATE VIEW v_fundamentals AS
SELECT
  p.cik,
  p.fiscal_year,
  p.fiscal_period,
  CASE WHEN p.fiscal_period = 'FY' THEN 12 ELSE 3 END AS span_months,
  MAX(p.period_end)  AS period_end,
  MAX(p.filed_date)  AS filed_date,
  -- balance sheet (instant)
  MAX(CASE WHEN p.concept = 'CashAndCashEquivalentsAtCarryingValue' THEN p.value END) AS cash,
  MAX(CASE WHEN p.concept = 'AssetsCurrent'                          THEN p.value END) AS current_assets,
  MAX(CASE WHEN p.concept = 'LiabilitiesCurrent'                     THEN p.value END) AS current_liabilities,
  MAX(CASE WHEN p.concept = 'Assets'                                 THEN p.value END) AS total_assets,
  MAX(CASE WHEN p.concept = 'Liabilities'                            THEN p.value END) AS total_liabilities,
  -- Parent-only equity: the figure attributable to shareholders, and the
  -- one the dashboard shows.
  MAX(CASE WHEN p.concept = 'StockholdersEquity'                     THEN p.value END) AS equity,
  -- Noncontrolling interest. Without it the accounting identity fails for
  -- every company with consolidated subsidiaries it does not wholly own:
  -- FCX FY2021 is off by $9.04B on parent-only equity and ties to the
  -- dollar once NCI is included.
  MAX(CASE WHEN p.concept = 'MinorityInterest'                       THEN p.value END) AS minority_interest,
  MAX(CASE WHEN p.concept = 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'
                                                                     THEN p.value END) AS equity_including_nci,
  MAX(CASE WHEN p.concept = 'RetainedEarningsAccumulatedDeficit'     THEN p.value END) AS retained_earnings,
  -- income statement (duration)
  COALESCE(
    MAX(CASE WHEN p.concept = 'RevenueFromContractWithCustomerExcludingAssessedTax' THEN p.value END),
    MAX(CASE WHEN p.concept = 'Revenues'                                            THEN p.value END),
    MAX(CASE WHEN p.concept = 'RevenueFromContractWithCustomerIncludingAssessedTax' THEN p.value END),
    MAX(CASE WHEN p.concept = 'SalesRevenueNet'                                     THEN p.value END)
  ) AS revenue,
  COALESCE(
    MAX(CASE WHEN p.concept = 'CostOfRevenue'              THEN p.value END),
    MAX(CASE WHEN p.concept = 'CostOfGoodsAndServicesSold' THEN p.value END)
  ) AS cogs,
  MAX(CASE WHEN p.concept = 'GrossProfit'   THEN p.value END) AS gross_profit_reported,
  MAX(CASE WHEN p.concept = 'NetIncomeLoss' THEN p.value END) AS net_income,
  -- cash flow (duration)
  MAX(CASE WHEN p.concept = 'NetCashProvidedByUsedInOperatingActivities' THEN p.value END) AS cf_ops,
  MAX(CASE WHEN p.concept = 'NetCashProvidedByUsedInInvestingActivities' THEN p.value END) AS cf_inv,
  MAX(CASE WHEN p.concept = 'NetCashProvidedByUsedInFinancingActivities' THEN p.value END) AS cf_fin
FROM v_facts_canonical p
WHERE p.unit = 'USD'
GROUP BY p.cik, p.fiscal_year, p.fiscal_period;

-- ---------------------------------------------------------------------
-- v_key_metrics — the derived figures, defined once.
--
-- NULLIF guards every denominator so a zero produces NULL rather than a
-- divide error, matching div() in metrics.js. Runway counts OPERATING
-- burn only: money raised is not money earned, and including financing
-- would overstate how long the business funds itself.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_key_metrics;
CREATE VIEW v_key_metrics AS
SELECT
  f.cik,
  f.fiscal_year,
  f.fiscal_period,
  f.span_months,
  f.period_end,
  f.filed_date,
  f.cash,
  f.current_assets,
  f.current_liabilities,
  f.total_assets,
  f.total_liabilities,
  f.equity,
  f.minority_interest,
  -- Total equity for the accounting identity: the tagged consolidated
  -- figure when present, otherwise parent equity plus NCI. Falls back to
  -- parent-only for companies with no subsidiaries, where the two agree.
  COALESCE(f.equity_including_nci,
           f.equity + COALESCE(f.minority_interest, 0)) AS equity_total,
  f.retained_earnings,
  f.revenue,
  f.cogs,
  f.net_income,
  f.cf_ops,
  f.cf_inv,
  f.cf_fin,
  (f.current_assets - f.current_liabilities)                       AS working_capital,
  (f.current_assets / NULLIF(f.current_liabilities, 0))            AS current_ratio,
  (f.total_liabilities / NULLIF(f.total_assets, 0))                AS liabilities_to_assets,
  COALESCE(f.gross_profit_reported, f.revenue - f.cogs)            AS gross_profit,
  (COALESCE(f.gross_profit_reported, f.revenue - f.cogs) / NULLIF(f.revenue, 0)) AS gross_margin_pct,
  (f.net_income / NULLIF(f.revenue, 0))                            AS net_margin_pct,
  -- all-null stays null; a partial set sums the knowns (sumPresent)
  CASE WHEN f.cf_ops IS NULL AND f.cf_inv IS NULL AND f.cf_fin IS NULL
       THEN NULL
       ELSE COALESCE(f.cf_ops,0) + COALESCE(f.cf_inv,0) + COALESCE(f.cf_fin,0)
  END                                                              AS net_cash_change,
  CASE WHEN f.cf_ops IS NULL AND f.cf_inv IS NULL AND f.cf_fin IS NULL
       THEN NULL
       ELSE (COALESCE(f.cf_ops,0) + COALESCE(f.cf_inv,0) + COALESCE(f.cf_fin,0))
            / f.span_months
  END                                                              AS monthly_net_cash,
  CASE WHEN f.cf_ops < 0 AND f.cash IS NOT NULL
       THEN f.cash / (ABS(f.cf_ops) / f.span_months)
       ELSE NULL
  END                                                              AS runway_months
FROM v_fundamentals f;

-- ---------------------------------------------------------------------
-- v_company_overview — one row per covered company, latest period.
--
-- This is the row the dashboard hero and KPI strip render, and the grain
-- Power BI should build company-level visuals on.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_company_overview;
CREATE VIEW v_company_overview AS
SELECT
  c.cik,
  c.ticker,
  c.name,
  m.fiscal_year,
  m.fiscal_period,
  CONCAT(m.fiscal_period, ' ', m.fiscal_year) AS period_label,
  m.period_end,
  m.filed_date,
  DATEDIFF(CURDATE(), m.filed_date)           AS filing_age_days,
  (DATEDIFF(CURDATE(), m.filed_date) > 400)   AS is_stale,
  m.cash, m.working_capital, m.current_ratio, m.liabilities_to_assets,
  m.revenue, m.net_income, m.gross_margin_pct, m.net_margin_pct,
  m.cf_ops, m.cf_inv, m.cf_fin, m.net_cash_change, m.monthly_net_cash,
  m.runway_months
FROM companies c
JOIN v_key_metrics m ON m.cik = c.cik
JOIN (
  -- latest period per company: quarters rank above FY for the same year,
  -- so a Q3 filing supersedes the prior FY rather than losing to it
  SELECT cik, fiscal_year, fiscal_period,
         ROW_NUMBER() OVER (
           PARTITION BY cik
           ORDER BY fiscal_year DESC,
                    FIELD(fiscal_period,'FY','Q1','Q2','Q3','Q4') DESC,
                    period_end DESC
         ) AS rn
  FROM v_fundamentals
) latest
  ON latest.cik = m.cik
 AND latest.fiscal_year = m.fiscal_year
 AND latest.fiscal_period = m.fiscal_period
 AND latest.rn = 1;

-- ---------------------------------------------------------------------
-- v_period_variance — current vs the year-ago same period.
--
-- Percent change divides by ABS(prior) so a move off a negative base
-- reports the right direction: -10 to -5 is +50% (improving). Margin
-- moves are basis points, not percent-of-percent. Materiality tiers match
-- materiality() in metrics.js.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_period_variance;
CREATE VIEW v_period_variance AS
SELECT
  cur.cik,
  cur.fiscal_year,
  cur.fiscal_period,
  cur.revenue                              AS revenue,
  pri.revenue                              AS revenue_prior,
  (cur.revenue - pri.revenue)              AS revenue_var_usd,
  ((cur.revenue - pri.revenue) / NULLIF(ABS(pri.revenue), 0)) * 100 AS revenue_var_pct,
  cur.net_income                           AS net_income,
  pri.net_income                           AS net_income_prior,
  (cur.net_income - pri.net_income)        AS net_income_var_usd,
  ((cur.net_income - pri.net_income) / NULLIF(ABS(pri.net_income), 0)) * 100 AS net_income_var_pct,
  (cur.gross_margin_pct - pri.gross_margin_pct) * 10000 AS gross_margin_var_bps,
  (cur.net_margin_pct  - pri.net_margin_pct)  * 10000 AS net_margin_var_bps,
  cur.cash                                 AS cash,
  pri.cash                                 AS cash_prior,
  (cur.cash - pri.cash)                    AS cash_var_usd,
  cur.working_capital                      AS working_capital,
  pri.working_capital                      AS working_capital_prior,
  (cur.working_capital - pri.working_capital) AS working_capital_var_usd,
  cur.cf_ops                               AS cf_ops,
  pri.cf_ops                               AS cf_ops_prior,
  (cur.cf_ops - pri.cf_ops)                AS cf_ops_var_usd,
  -- tiered materiality on revenue, the reference line item
  CASE
    WHEN pri.revenue IS NULL OR cur.revenue IS NULL THEN NULL
    WHEN ABS(pri.revenue) > 10000000 THEN
      (ABS(cur.revenue - pri.revenue) >= 500000
       OR ABS((cur.revenue - pri.revenue) / NULLIF(ABS(pri.revenue),0)) * 100 >= 5)
    WHEN ABS(pri.revenue) >= 1000000 THEN
      (ABS(cur.revenue - pri.revenue) >= 100000
       OR ABS((cur.revenue - pri.revenue) / NULLIF(ABS(pri.revenue),0)) * 100 >= 10)
    ELSE
      (ABS(cur.revenue - pri.revenue) >= 50000
       OR ABS((cur.revenue - pri.revenue) / NULLIF(ABS(pri.revenue),0)) * 100 >= 15)
  END AS revenue_variance_is_material
FROM v_key_metrics cur
LEFT JOIN v_key_metrics pri
  ON pri.cik = cur.cik
 AND pri.fiscal_year = cur.fiscal_year - 1
 AND pri.fiscal_period = cur.fiscal_period;
