# Purpose

Keep the SEC EDGAR -> MySQL `finance_db` -> frontend / Power BI feed in NXO1759-ai/PowerBI correct, complete and reproducible, so that no wrong or stale figure is ever published and every fact can be traced back to a filing.

## Origin
Seeded 3 Sep 2026 from `docs/PIPELINE.md`, `DATA_POLICY.md`, `sql/07_data_quality.sql`, `.github/workflows/weekly-refresh.yml`, the `loaders/` directory and PowerBI PRs #13, #14, #15, #29, #30, #31 (plus commit b14480d), via `seeds/SOURCES-digest.md` section 3.

## Patterns Addressed
- balance-sheet-tie-needs-nci: parent-only `StockholdersEquity` breaks the tie (FCX Q2 2026, $12.11B); `missing_nci` reported separately.
- weekly-refresh-sec-rate-limit: unthrottled SEC calls stall the Sunday run (#13); the companyfacts bulk pull cuts requests 23x (#14).
- sync-file-without-provenance: a sync SQL file that does not actually apply (#15).
- derived-quarter-group-completeness: derived quarters must carry every group (#30); quarters without an annual report (#29).
- restatement-and-ltm-handling: filer fiscal names, restatements, filing backstop, 20-F/40-F (#31).
- staleness-guard: 400+ day filings flagged in the UI and in the analyst prompt.
- publish-previous-on-error: error-severity findings keep the old `company-*.js` rather than publishing a wrong figure.

## Evolution History
- v0 (seed): covers the refresh flow, fact pulling, the quality gate and universe/concept changes; not yet validated by the WikiSkill loop.
- v0.1 (4 Sep 2026): corrected against full repo source (zip of main).
