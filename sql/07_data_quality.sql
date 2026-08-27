-- =====================================================================
-- 07_data_quality.sql — accuracy checks over finance_db.
--
-- Every check is a view, so the same rule is available three ways: the
-- weekly refresh reads them and fails the run on any error-severity row,
-- Power BI can surface them on a data-health page, and they are runnable
-- by hand during a load.
--
-- The rules mirror validateCompany() in frontend/lib/metrics.js. What SQL
-- can see that JavaScript cannot is the whole corpus at once: duplicates,
-- orphans, coverage gaps, and restatement churn across companies.
--
-- Apply:  mysql -u learn -p finance_db < sql/07_data_quality.sql
-- Run:    SELECT * FROM v_data_quality ORDER BY severity, check_name;
-- =====================================================================

-- ---------------------------------------------------------------------
-- Balance sheets that do not tie: assets = liabilities + equity.
-- Tolerance is 0.5% of total assets — EDGAR values carry rounding at
-- filing scale, so an absolute threshold fires on cents for mega-caps and
-- misses real errors for micro-caps.
-- ---------------------------------------------------------------------
-- Tests against TOTAL equity (parent plus noncontrolling interest), which
-- is what the identity actually requires. Testing parent-only equity
-- reports a false failure for every company with consolidated
-- subsidiaries it does not wholly own.
DROP VIEW IF EXISTS v_dq_balance_sheet_tie;
CREATE VIEW v_dq_balance_sheet_tie AS
SELECT cik, fiscal_year, fiscal_period,
       total_assets, total_liabilities, equity, minority_interest, equity_total,
       (total_assets - (total_liabilities + equity_total)) AS drift_usd,
       ABS(total_assets - (total_liabilities + equity_total))
         / NULLIF(ABS(total_assets), 0) * 100 AS drift_pct
FROM v_key_metrics
WHERE total_assets IS NOT NULL
  AND total_liabilities IS NOT NULL
  AND equity_total IS NOT NULL
  AND ABS(total_assets - (total_liabilities + equity_total))
      / NULLIF(ABS(total_assets), 0) > 0.005;

-- Companies whose NCI has never been loaded, so their tie cannot be
-- tested. Resolves as the weekly refresh backfills the two NCI concepts.
DROP VIEW IF EXISTS v_dq_missing_nci;
CREATE VIEW v_dq_missing_nci AS
SELECT k.cik, k.fiscal_year, k.fiscal_period,
       ABS(k.total_assets - (k.total_liabilities + k.equity))
         / NULLIF(ABS(k.total_assets), 0) * 100 AS unexplained_pct
FROM v_key_metrics k
WHERE k.total_assets IS NOT NULL
  AND k.total_liabilities IS NOT NULL
  AND k.equity IS NOT NULL
  AND k.minority_interest IS NULL
  AND k.equity_total = k.equity
  AND ABS(k.total_assets - (k.total_liabilities + k.equity))
      / NULLIF(ABS(k.total_assets), 0) > 0.005;

-- ---------------------------------------------------------------------
-- Duplicate facts in the raw table. v_facts_canonical collapses these,
-- but a rising count means the loader is re-inserting instead of
-- upserting, which inflates the table and slows every read.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_dq_duplicate_facts;
CREATE VIEW v_dq_duplicate_facts AS
SELECT cik, concept, unit, fiscal_year, fiscal_period,
       COUNT(*) AS copies,
       COUNT(DISTINCT value) AS distinct_values
FROM financial_facts
GROUP BY cik, concept, unit, fiscal_year, fiscal_period
HAVING COUNT(*) > 1;

-- ---------------------------------------------------------------------
-- Sign-convention violations. These catch the classic XBRL polarity error
-- where a negated-label concept is loaded without flipping its sign.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_dq_sign_violations;
CREATE VIEW v_dq_sign_violations AS
SELECT cik, fiscal_year, fiscal_period, 'negative_total_assets' AS issue,
       total_assets AS value
FROM v_fundamentals WHERE total_assets < 0
UNION ALL
SELECT cik, fiscal_year, fiscal_period, 'negative_cash', cash
FROM v_fundamentals WHERE cash < 0
UNION ALL
SELECT cik, fiscal_year, fiscal_period, 'negative_current_assets', current_assets
FROM v_fundamentals WHERE current_assets < 0
UNION ALL
SELECT cik, fiscal_year, fiscal_period, 'negative_revenue', revenue
FROM v_fundamentals WHERE revenue < 0;

-- ---------------------------------------------------------------------
-- Margins outside the plausible band, which nearly always means revenue
-- and cost were tagged on different bases (annual COGS against quarterly
-- revenue, or a contra-revenue tag picked up as revenue).
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_dq_margin_outliers;
CREATE VIEW v_dq_margin_outliers AS
SELECT cik, fiscal_year, fiscal_period, revenue, cogs,
       gross_margin_pct * 100 AS gross_margin_pct
FROM v_key_metrics
WHERE gross_margin_pct IS NOT NULL
  AND (gross_margin_pct > 1.5 OR gross_margin_pct < -5);

-- ---------------------------------------------------------------------
-- Companies whose newest periodic filing is over 400 days old. A company
-- still filing never goes much beyond a year, so these figures describe a
-- company that may have deregistered and must not read as current.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_dq_stale_filings;
CREATE VIEW v_dq_stale_filings AS
SELECT c.cik, c.ticker, c.name,
       MAX(f.filed_date) AS latest_filing,
       DATEDIFF(CURDATE(), MAX(f.filed_date)) AS age_days
FROM companies c
JOIN v_facts_canonical f ON f.cik = c.cik
GROUP BY c.cik, c.ticker, c.name
HAVING DATEDIFF(CURDATE(), MAX(f.filed_date)) > 400;

-- ---------------------------------------------------------------------
-- Coverage gaps: a company in the universe missing a core line item in
-- its latest period. This is what makes an em dash appear on the site.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_dq_missing_core_concepts;
CREATE VIEW v_dq_missing_core_concepts AS
SELECT o.cik, o.ticker, o.fiscal_year, o.fiscal_period,
       CONCAT_WS(', ',
         CASE WHEN o.cash        IS NULL THEN 'cash' END,
         CASE WHEN o.working_capital IS NULL THEN 'working_capital' END,
         CASE WHEN o.cf_ops      IS NULL THEN 'cf_ops' END,
         CASE WHEN o.net_income  IS NULL THEN 'net_income' END
       ) AS missing
FROM v_company_overview o
WHERE o.cash IS NULL OR o.working_capital IS NULL
   OR o.cf_ops IS NULL OR o.net_income IS NULL;

-- ---------------------------------------------------------------------
-- Facts whose CIK is not in companies — orphans that no view will ever
-- surface, so they are storage and load time spent on nothing.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_dq_orphan_facts;
CREATE VIEW v_dq_orphan_facts AS
SELECT f.cik, COUNT(*) AS orphan_rows
FROM financial_facts f
LEFT JOIN companies c ON c.cik = f.cik
WHERE c.cik IS NULL
GROUP BY f.cik;

-- ---------------------------------------------------------------------
-- v_data_quality — the single roll-up. One row per check with a count and
-- a severity. The weekly refresh fails the run when any 'error' row has a
-- non-zero count; 'warn' rows are recorded and shipped.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_data_quality;
CREATE VIEW v_data_quality AS
-- Split by whether the drift is explainable. A company whose NCI has
-- never been loaded cannot be judged, so it is a warn that clears on
-- backfill. Drift that survives WITH NCI present is a genuine tagging
-- error and blocks the refresh.
SELECT 'balance_sheet_tie_unexplained' AS check_name, 'error' AS severity,
       COUNT(*) AS findings,
       'Assets still do not equal liabilities plus total equity with NCI loaded' AS description
FROM v_dq_balance_sheet_tie WHERE minority_interest IS NOT NULL
UNION ALL
SELECT 'balance_sheet_tie', 'warn', COUNT(*),
       'Assets do not equal liabilities plus total equity within 0.5%'
FROM v_dq_balance_sheet_tie
UNION ALL
SELECT 'missing_nci', 'warn', COUNT(*),
       'Noncontrolling interest not loaded, so the tie cannot be verified'
FROM v_dq_missing_nci
UNION ALL
SELECT 'duplicate_facts', 'warn', COUNT(*),
       'Same concept and period stored more than once in financial_facts'
FROM v_dq_duplicate_facts
UNION ALL
SELECT 'sign_violations', 'error', COUNT(*),
       'A value is negative where the accounting sign cannot be'
FROM v_dq_sign_violations
UNION ALL
SELECT 'margin_outliers', 'warn', COUNT(*),
       'Gross margin outside the plausible band, suggesting a period mismatch'
FROM v_dq_margin_outliers
UNION ALL
SELECT 'stale_filings', 'warn', COUNT(*),
       'Newest periodic filing is more than 400 days old'
FROM v_dq_stale_filings
UNION ALL
SELECT 'missing_core_concepts', 'warn', COUNT(*),
       'Covered company missing a core line item in its latest period'
FROM v_dq_missing_core_concepts
UNION ALL
SELECT 'orphan_facts', 'warn', COUNT(*),
       'Facts whose CIK is absent from companies'
FROM v_dq_orphan_facts;
