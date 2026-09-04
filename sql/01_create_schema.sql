-- =====================================================================
-- 01_create_schema.sql
-- Creates the finance_db database and its tables.
--
-- HOW TO RUN: in MySQL Workbench, open this file and press the
-- lightning-bolt "Execute" button. Every section below is explained.
-- =====================================================================

-- ---------------------------------------------------------------------
-- CREATE DATABASE makes a new, empty database (a container for tables).
-- IF NOT EXISTS means "don't error if it's already there" — you can
-- safely re-run this script.
-- utf8mb4 is the character set; it handles any currency symbol,
-- accented company name, etc.
-- ---------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS finance_db
  CHARACTER SET utf8mb4;

-- USE tells MySQL "all following commands apply to this database".
-- In Workbench you can also double-click a schema in the left panel
-- to achieve the same thing (the name turns bold).
USE finance_db;

-- =====================================================================
-- TABLE 1: companies
-- One row per company. This is the "who".
--
-- Why a separate table? So company facts (name, ticker) are stored
-- ONCE, not repeated on every financial figure. This is called
-- "normalization" and it's the core idea of relational databases.
--
--   cik      – SEC's Central Index Key, the permanent ID the SEC uses.
--              Every company that files with the SEC has one.
--   ticker   – stock symbol (AAPL, MSFT...). Can change over time;
--              cik never does, which is why cik is our primary key.
--   name     – official company name from SEC filings
--   exchange – Nasdaq, NYSE...
--
-- PRIMARY KEY = the unique identifier of a row. MySQL enforces that
-- no two rows share the same cik, and lookups by cik are fast.
-- =====================================================================
CREATE TABLE IF NOT EXISTS companies (
    cik       INT          NOT NULL,
    ticker    VARCHAR(10)  NOT NULL,
    name      VARCHAR(255) NOT NULL,
    exchange  VARCHAR(50)          NULL,
    PRIMARY KEY (cik)
);

-- =====================================================================
-- TABLE 2: financial_facts
-- One row per reported number: e.g. "Apple's Revenue for FY2024".
-- This is the heart of the database — a long, narrow table that can
-- hold ANY line item from ANY filing without changing the schema.
-- This mirrors how the SEC's own XBRL "company facts" API works.
--
--   cik          – which company (links to companies.cik)
--   concept      – the financial line item, in SEC XBRL naming, e.g.
--                  'RevenueFromContractWithCustomerExcludingAssessedTax'
--                  (we'll use friendly filters on this in queries)
--   unit         – 'USD', 'shares', 'USD/shares' etc.
--   fiscal_year  – e.g. 2024
--   fiscal_period– 'FY' (annual), 'Q1'..'Q4' (quarters)
--   period_start / period_end – the date range the number covers
--   value        – the number itself. DECIMAL(20,2) holds values up to
--                  ~999 quadrillion with cents — big enough for any
--                  company's revenue.
--   filed_date   – when the filing was submitted to the SEC
--   form         – '10-K' (annual report) or '10-Q' (quarterly report)
--   accession_no – the filing's unique ID at the SEC
--
-- FOREIGN KEY links this table to companies: MySQL will REFUSE to
-- insert a fact for a cik that doesn't exist in companies. This is
-- "referential integrity" — the database itself protects data quality.
--
-- The UNIQUE index prevents loading the same number twice — re-running
-- our loader is safe.
-- =====================================================================
CREATE TABLE IF NOT EXISTS financial_facts (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    cik           INT          NOT NULL,
    concept       VARCHAR(120) NOT NULL,
    unit          VARCHAR(20)  NOT NULL,
    fiscal_year   INT          NOT NULL,
    fiscal_period VARCHAR(4)   NOT NULL,
    period_start  DATE         NULL,
    period_end    DATE         NOT NULL,
    value         DECIMAL(20,2) NOT NULL,
    filed_date    DATE         NOT NULL,
    form          VARCHAR(10)  NOT NULL,
    accession_no  VARCHAR(25)  NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_fact (cik, concept, unit, period_end, form),
    FOREIGN KEY (cik) REFERENCES companies (cik)
);

-- =====================================================================
-- TABLE 3: concepts_dictionary
-- A small lookup table translating cryptic SEC XBRL concept names to
-- friendly labels. Lookup tables like this are everywhere in real
-- systems — they keep raw data intact while giving humans readable names.
-- =====================================================================
CREATE TABLE IF NOT EXISTS concepts_dictionary (
    concept      VARCHAR(120) NOT NULL,
    label        VARCHAR(100) NOT NULL,
    category     VARCHAR(50)  NOT NULL,  -- e.g. 'Income statement'
    PRIMARY KEY (concept)
);

-- Pre-fill the dictionary with the line items our loader pulls.
-- INSERT ... ON DUPLICATE KEY UPDATE = "insert, or refresh if present"
-- (an UPSERT — safe to run repeatedly).
INSERT INTO concepts_dictionary (concept, label, category) VALUES
 ('RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenue',                'Income statement'),
 ('CostOfRevenue',                                       'Cost of revenue',        'Income statement'),
 ('GrossProfit',                                         'Gross profit',           'Income statement'),
 ('OperatingIncomeLoss',                                 'Operating income',       'Income statement'),
 ('NetIncomeLoss',                                       'Net income',             'Income statement'),
 ('EarningsPerShareDiluted',                             'EPS (diluted)',          'Income statement'),
 ('Assets',                                              'Total assets',           'Balance sheet'),
 ('Liabilities',                                         'Total liabilities',      'Balance sheet'),
 ('StockholdersEquity',                                  "Shareholders' equity",   'Balance sheet'),
 ('CashAndCashEquivalentsAtCarryingValue',               'Cash & equivalents',     'Balance sheet'),
 ('NetCashProvidedByUsedInOperatingActivities',          'Operating cash flow',    'Cash flow'),
 ('PaymentsToAcquirePropertyPlantAndEquipment',          'Capital expenditure',    'Cash flow')
ON DUPLICATE KEY UPDATE
    label = VALUES(label),
    category = VALUES(category);

-- =====================================================================
-- Done. Run this quick check afterwards:
--   SHOW TABLES;
--   SELECT * FROM concepts_dictionary;
-- =====================================================================
