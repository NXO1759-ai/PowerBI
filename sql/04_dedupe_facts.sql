-- =====================================================================
-- 04_dedupe_facts.sql
-- One-time cleanup: the SEC feed contains multiple rows for the same
-- fiscal year (9-month fragments mislabeled FY, plus older filings
-- superseded by newer ones). A SUM over those double-counts.
--
-- Rule applied: for each (cik, concept, unit, fiscal_year,
-- fiscal_period) keep exactly ONE row — the full-length period from
-- the LATEST filing.
-- Safe to re-run; deletes only provable duplicates.
-- =====================================================================
USE finance_db;

-- Step 1: drop FY-tagged rows that don't span ~a full year.
-- (Balance-sheet instants have NULL period_start and are untouched.)
DELETE FROM financial_facts
WHERE fiscal_period = 'FY'
  AND period_start IS NOT NULL
  AND DATEDIFF(period_end, period_start) < 300;

-- Step 2: drop comparative periods. The SEC tags every row in a
-- filing with the FILING's fiscal year, so the FY2022 10-K also
-- carries fy=2022 rows for 2020 and 2021 (comparative columns).
-- Within each (cik, concept, unit, fiscal_year, fiscal_period),
-- the current period is the one with the latest period_end.
DELETE f
FROM financial_facts f
JOIN (
    SELECT cik, concept, unit, fiscal_year, fiscal_period,
           MAX(period_end) AS current_end
    FROM financial_facts
    GROUP BY cik, concept, unit, fiscal_year, fiscal_period
) cur
  ON  f.cik           = cur.cik
  AND f.concept       = cur.concept
  AND f.unit          = cur.unit
  AND f.fiscal_year   = cur.fiscal_year
  AND f.fiscal_period = cur.fiscal_period
WHERE f.period_end < cur.current_end;

-- Step 3: if several filings report the same current period,
-- keep only the newest restatement.
DELETE f
FROM financial_facts f
JOIN (
    SELECT cik, concept, unit, fiscal_year, fiscal_period,
           MAX(filed_date) AS latest_filed
    FROM financial_facts
    GROUP BY cik, concept, unit, fiscal_year, fiscal_period
) keep
  ON  f.cik           = keep.cik
  AND f.concept       = keep.concept
  AND f.unit          = keep.unit
  AND f.fiscal_year   = keep.fiscal_year
  AND f.fiscal_period = keep.fiscal_period
WHERE f.filed_date < keep.latest_filed;

-- Verification: every company/year should now have exactly one
-- annual revenue row. Expect zero rows returned by this query:
SELECT c.ticker, f.fiscal_year, COUNT(*) AS rows_per_year
FROM financial_facts f
JOIN companies c ON f.cik = c.cik
WHERE f.concept = 'RevenueFromContractWithCustomerExcludingAssessedTax'
  AND f.fiscal_period = 'FY'
  AND f.unit = 'USD'
GROUP BY c.ticker, f.fiscal_year
HAVING rows_per_year > 1;
