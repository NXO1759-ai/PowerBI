-- =====================================================================
-- 03_learning_queries.sql
-- A guided tour of SQL using YOUR real financial data.
--
-- HOW TO USE: in Workbench, highlight ONE query at a time and press
-- Ctrl+Shift+Enter (or the lightning bolt with a cursor icon) to run
-- just the highlighted statement. Read the comment above each query
-- first, run it, look at the result, then move on.
--
-- Remember to pick the database first:
-- =====================================================================
USE finance_db;

-- =====================================================================
-- LESSON 1 — SELECT, FROM, WHERE: the atoms of SQL
-- "Give me columns FROM a table WHERE rows match a condition."
-- =====================================================================

-- 1a. Everything in the companies table. * means "all columns".
SELECT * FROM companies;

-- 1b. Only the columns you name, filtered to one company.
--     Strings go in single quotes.
SELECT concept, fiscal_year, value
FROM financial_facts
WHERE concept = 'NetIncomeLoss';

-- 1c. Multiple conditions with AND. Numbers don't get quotes.
SELECT concept, fiscal_year, fiscal_period, period_end, value
FROM financial_facts
WHERE concept = 'NetIncomeLoss'
  AND unit = 'USD'
  AND fiscal_year >= 2020;

-- =====================================================================
-- LESSON 2 — ORDER BY, LIMIT: shaping the output
-- =====================================================================

-- 2a. Sort descending (newest first) and keep just 10 rows.
SELECT fiscal_year, fiscal_period, period_end, value
FROM financial_facts
WHERE concept = 'RevenueFromContractWithCustomerExcludingAssessedTax'
  AND unit = 'USD'
ORDER BY period_end DESC
LIMIT 10;

-- =====================================================================
-- LESSON 3 — JOIN: the reason relational databases exist
-- financial_facts only stores a numeric cik. The company's NAME and
-- TICKER live in the companies table. JOIN stitches them together
-- by matching the column they share.
-- =====================================================================

-- 3a. Apple's annual revenue, showing the friendly ticker & label.
--     We give tables short aliases (f, c, d) to keep lines readable.
SELECT c.ticker,
       d.label,
       f.fiscal_year,
       f.value / 1000000000 AS value_billions   -- math on the fly
FROM financial_facts f
JOIN companies c            ON f.cik = c.cik
JOIN concepts_dictionary d  ON f.concept = d.concept
WHERE c.ticker = 'AAPL'
  AND d.label = 'Revenue'
  AND f.fiscal_period = 'FY'     -- annual figures only
  AND f.unit = 'USD'
ORDER BY f.fiscal_year;

-- =====================================================================
-- LESSON 4 — GROUP BY + aggregates: many rows -> one answer
-- =====================================================================

-- 4a. How many facts do we have per company?
SELECT c.ticker, COUNT(*) AS fact_count
FROM financial_facts f
JOIN companies c ON f.cik = c.cik
GROUP BY c.ticker;

-- 4b. Latest year's revenue per company, side by side.
--     MAX(value) is technically redundant here but shows aggregates;
--     the GROUP BY collapses each company to one row.
SELECT c.ticker,
       d.label,
       f.fiscal_year,
       MAX(f.value) / 1000000000 AS billions
FROM financial_facts f
JOIN companies c ON f.cik = c.cik
JOIN concepts_dictionary d ON f.concept = d.concept
WHERE d.label = 'Revenue'
  AND f.fiscal_period = 'FY'
  AND f.unit = 'USD'
  AND f.fiscal_year = (SELECT MAX(fiscal_year) FROM financial_facts
                       WHERE concept = f.concept AND cik = f.cik
                         AND fiscal_period = 'FY')
GROUP BY c.ticker, d.label, f.fiscal_year
ORDER BY billions DESC;

-- =====================================================================
-- LESSON 5 — A real financial question: profit margins
-- Combine two line items with a self-comparison (joining the facts
-- table to itself via subqueries) to compute net margin = net income
-- / revenue, per company per year.
-- =====================================================================
SELECT c.ticker,
       rev.fiscal_year,
       rev.value / 1000000000          AS revenue_bn,
       ni.value  / 1000000000          AS net_income_bn,
       ROUND(ni.value / rev.value * 100, 1) AS net_margin_pct
FROM financial_facts rev
JOIN financial_facts ni
  ON ni.cik = rev.cik
 AND ni.fiscal_year = rev.fiscal_year
 AND ni.fiscal_period = 'FY'
 AND ni.concept = 'NetIncomeLoss'
 AND ni.unit = 'USD'
JOIN companies c ON c.cik = rev.cik
WHERE rev.concept = 'RevenueFromContractWithCustomerExcludingAssessedTax'
  AND rev.fiscal_period = 'FY'
  AND rev.unit = 'USD'
ORDER BY rev.fiscal_year DESC, c.ticker;

-- =====================================================================
-- LESSON 6 — Window functions (the pro move): year-over-year growth
-- LAG(value) OVER (PARTITION BY ... ORDER BY ...) looks at "the
-- previous row for the same company" without any self-join.
-- This is the query style dashboards live on.
-- =====================================================================
WITH annual_revenue AS (
    SELECT f.cik,
           f.fiscal_year,
           f.value
    FROM financial_facts f
    WHERE f.concept = 'RevenueFromContractWithCustomerExcludingAssessedTax'
      AND f.fiscal_period = 'FY'
      AND f.unit = 'USD'
)
SELECT c.ticker,
       a.fiscal_year,
       a.value / 1000000000 AS revenue_bn,
       ROUND(
         (a.value - LAG(a.value) OVER (PARTITION BY a.cik
                                       ORDER BY a.fiscal_year))
         / LAG(a.value) OVER (PARTITION BY a.cik
                              ORDER BY a.fiscal_year) * 100, 1
       ) AS yoy_growth_pct
FROM annual_revenue a
JOIN companies c ON c.cik = a.cik
ORDER BY c.ticker, a.fiscal_year;

-- =====================================================================
-- When you're comfortable with all six, you've covered the core of
-- SQL used in 90% of real analytics work. Next stop: Power BI.
-- =====================================================================
