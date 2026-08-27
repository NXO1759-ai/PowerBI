-- =====================================================================
-- 08_scope_down_privileges.sql — narrow the 'learn' account.
--
-- The account currently holds ALL PRIVILEGES ON *.* WITH GRANT OPTION:
-- root-equivalent, including SUPER, FILE (read any file the MySQL
-- service can reach), SHUTDOWN, CREATE USER and the ability to hand
-- those to anyone else. It is a read-mostly loader account, and its
-- password sits in plaintext in loaders/db_config.json alongside four
-- live API keys. This grants only what the pipeline actually uses and
-- confines it to finance_db.
--
-- Run as 'learn' itself (it holds GRANT OPTION, so no root password is
-- needed) or as root. mysql is NOT on PATH — use the full path:
--
--   "/c/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe" \
--     -u learn -p finance_db < sql/08_scope_down_privileges.sql
--
-- ORDER MATTERS. The narrow grant is created FIRST, at database scope,
-- so it survives the global revoke that follows. Reversing these two
-- statements locks the account out of its own database.
--
-- Note the explicit ON *.* on the REVOKE. Without it, MySQL's
-- "REVOKE ALL PRIVILEGES, GRANT OPTION FROM user" form strips privileges
-- at EVERY scope, including the grant made on the line above.
-- =====================================================================

-- 1. What the pipeline genuinely needs, on finance_db only.
--    SELECT/INSERT/UPDATE/DELETE  loaders and the refresh upserts
--    CREATE/ALTER/INDEX/REFERENCES  loaders run ALTER TABLE and CREATE TABLE
--    CREATE VIEW/SHOW VIEW/DROP     applying 06_ and 07_ (DROP VIEW IF EXISTS)
--    TEMPORARY TABLES/LOCK TABLES   dedupe and bulk loads
--    EXECUTE/ROUTINE                stored routines, if any are added later
GRANT SELECT, INSERT, UPDATE, DELETE,
      CREATE, DROP, ALTER, INDEX, REFERENCES,
      CREATE VIEW, SHOW VIEW,
      CREATE TEMPORARY TABLES, LOCK TABLES,
      EXECUTE, CREATE ROUTINE, ALTER ROUTINE
  ON finance_db.*
  TO 'learn'@'%';

-- 2. Drop everything at the global scope. This removes SUPER, FILE,
--    SHUTDOWN, PROCESS, RELOAD, CREATE USER, REPLICATION, CREATE
--    TABLESPACE, SHOW DATABASES and GRANT OPTION, and ends the account's
--    access to other schemas — including mysql.user.
REVOKE ALL PRIVILEGES, GRANT OPTION ON *.* FROM 'learn'@'%';

FLUSH PRIVILEGES;

-- 3. Confirm. Expect exactly two lines: USAGE ON *.* (an empty
--    placeholder, which is correct and grants nothing) and the
--    finance_db grant from step 1.
SHOW GRANTS FOR 'learn'@'%';

-- Verify the pipeline still works afterwards:
--   node scripts/verify-parity.mjs
--   SELECT * FROM v_data_quality;
-- and refresh the Power BI model once.
--
-- To restore the old state if something depends on a privilege this
-- removed:
--   GRANT ALL PRIVILEGES ON *.* TO 'learn'@'%' WITH GRANT OPTION;
--   FLUSH PRIVILEGES;
-- That needs root, because step 2 removed this account's GRANT OPTION.
