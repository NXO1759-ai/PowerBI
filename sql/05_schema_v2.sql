-- =====================================================================
-- 05_schema_v2.sql
-- Turns finance_db into a searchable company directory.
--
--   companies.in_fact_universe = 1  -> loader pulls financial facts
--   companies.has_facts         -> set by loader: 1 facts found,
--                                  0 none (ETF/fund/SPAC shell), NULL unknown
--   tickers                     -> every ticker symbol per company
--                                  (one CIK can have several: GOOG/GOOGL)
-- =====================================================================
USE finance_db;

-- 'exchange' already exists from v1; the rest are new.
ALTER TABLE companies
    ADD COLUMN sic_code         INT          NULL,
    ADD COLUMN sector           VARCHAR(50)  NULL,
    ADD COLUMN category_est     VARCHAR(30)  NULL,
    ADD COLUMN in_fact_universe TINYINT(1)   NOT NULL DEFAULT 0,
    ADD COLUMN has_facts        TINYINT(1)   NULL;

CREATE TABLE IF NOT EXISTS tickers (
    ticker     VARCHAR(15) NOT NULL,
    cik        INT         NOT NULL,
    is_primary TINYINT(1)  NOT NULL DEFAULT 0,
    PRIMARY KEY (ticker),
    KEY ix_tickers_cik (cik),
    FOREIGN KEY (cik) REFERENCES companies (cik)
);
