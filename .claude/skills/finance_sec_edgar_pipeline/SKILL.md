---
name: finance_sec_edgar_pipeline
description: Use when loading, refreshing or validating SEC EDGAR financial data in NXO1759-ai/PowerBI - the Node pull/statement scripts, the weekly refresh workflow, companyfacts pulls, restatement/derived-quarter/LTM handling, the validateCompany() quality gate, the NCI equity lesson and the staleness guard - before any figure reaches the frontend data files.
---
# Finance SEC EDGAR pipeline

## When to Apply
- Editing `scripts/lib/sec-pull.mjs`, `scripts/lib/statements.mjs`, `scripts/lib/interim-parse.mjs`, `scripts/build-{segments,risks,strategy-panel}.mjs`, `scripts/chunk-data.mjs`, or the SEC-backed serverless routes under `api/`.
- Editing `.github/workflows/weekly-refresh.yml` or `smoke.yml`, `sql/sync/facts-<date>.sql`, `frontend/data/company-*.js`, `frontend/data/quality-report.json`.
- Symptoms: a balance sheet does not tie; a company file is stale or unchanged after Sunday's run; SEC refuses or throttles requests; duplicate periods; a derived quarter missing line items; a 20-F/40-F filer shows nothing; revenue resolves to a fraction of the real figure.
- Adding a company to the 130-company universe or a concept to the pull list.

## When NOT to Apply
- Changing how a ratio or derived figure is computed -> `finance_metric_parity` (metrics.js / ratios.js / valuation.js are the single sources).
- Dashboard pages, DuPont/valuation features, analyst prompt wording -> `finance_analysis_features`.

## Instructions
Reference: see _references/powerbi-code-map.md for the current route/API/workflow map.

### Procedure A - know the current flow (all JavaScript)
1. The pipeline is Node end to end: `scripts/lib/sec-pull.mjs` (EDGAR pull) + `scripts/lib/statements.mjs` (period/statement machinery) + `scripts/build-{segments,risks,strategy-panel}.mjs` + `scripts/chunk-data.mjs`. No Python is tracked at all. Consumers: the static frontend + Vercel serverless `api/`. Production origin is www.chineduokeke.mba.
2. KNOWN DRIFT in `weekly-refresh.yml`: the workflow still describes writing `company-*.js`, `quality-report.json` and sync SQL, but its first two steps invoke `scripts/refresh.mjs` and `scripts/verify-parity.mjs`, which are NOT in the tree - as committed, the Sunday run fails at step 1. The last successful run's outputs (2026-09-01: 130/130 companies, 0 errors, 3 tie warnings) are committed in `frontend/data/quality-report.json` and `sql/sync/facts-2026-09-01.sql`. Any task that says "run the refresh" must first restore or locate `refresh.mjs`.
3. There are SEVEN SEC-backed endpoints (`pull`, `statements`, `panel`, `segments`, `risks`, `release`, plus statements' 6-K interim scraper), each with its own 125ms pace lane and warm-instance cache - not one "on-demand pull".

### Procedure B - pull facts correctly (`scripts/lib/sec-pull.mjs`)
1. Prefer the companyfacts bulk pull over per-concept companyconcept calls: 1 request/company vs 23, and it is the only path that works for KO, ABT, COF, NXPI, SPGI, WELL, whose companyconcept answers `"units":{"USD":{}}`. Add new concepts to the shared list in `scripts/lib/concepts.mjs`; do not add a second fetch loop.
2. CAVEAT: `api/pull.js` does NOT use the bulk path - it still fires per-concept batches of 6 with its own normalize copy (concept lists are now imported from `concepts.mjs`, so the worst drift was fixed, but the fetch strategy is duplicated). "The on-demand pull obeys the same rules" is aspiration, not fact - check both paths when changing pull behaviour.
3. Global rate pacing: a 125ms slot gate (`SEC_MIN_INTERVAL_MS`). Keep every SEC request inside it; never add a parallel unthrottled path.
4. Accept 10-K/10-Q as well as 20-F/40-F filers. Restatement precedence: latest-end -> longest-span -> latest-filed.
5. Deduplicate facts that arrive from comparative periods and fragments before writing; carry per-fact provenance (accession_no) into `sql/sync/facts-*.sql`.
6. Revenue is resolved by taking the LARGEST candidate tag per period, not first-tag-wins (`maxDurationSeries` in statements.mjs; `concepts.mjs` documents AMT $0.9bn-vs-$10.6bn and COF $8.1bn-vs-$53.4bn). Composites fill an untagged total from components only when every component is present (Phillips 66 pretax).
7. Derived periods (`scripts/lib/statements.mjs`): Q4 = FY - (Q1+Q2+Q3) only when all three exist; a missing quarter is recovered from a YTD span only when exactly one quarter of the span is missing; 10-Q cash flow is YTD-only, so Q2/Q3 cash flow is de-cumulated from the span (`fillFromYearToDate` - without it every quarter but Q1 lacked cash flow and every LTM cash figure died); LTM windows require four CONSECUTIVE quarters (each gap 80-100 days).
8. Untagged interim reports are parsed from HTML tables: `scripts/lib/interim-parse.mjs` + the `api/statements.js` 6-K path (EDGAR full-text search for "months ended" restricted to the filer's 6-Ks; fixture-based test `scripts/test-interim.mjs` against Enlivex's Q3 2025 exhibit). Every parsed figure carries form 6-K + exhibit provenance.

### Procedure C - data quality gate (`validateCompany()` in `frontend/lib/metrics.js`)
1. The quality gate is `validateCompany()`: working-capital drift, net-cash-change drift, sign checks, gross-margin range, staleness, share count, period presence. Run it (via the refresh path) after every load.
2. Balance-sheet tie: total equity must include noncontrolling interest. `StockholdersEquity` is parent-only; `bookEquity()` in ratios.js and `validateCompany` both use `equityIncludingNci` or equity+minorityInterest. FCX Q2 2026 was off by $12.11B without NCI.
3. A tie failure is ALWAYS a `warn`, never a publication block (explicit BlackRock rationale in metrics.js: the residual gap is usually redeemable NCI in temporary equity, outside the pulled concepts; dropping the page would be worse than showing filed figures). The BLOCKING errors are the drift/sign/identity checks. There is no separate `missing_nci` finding code - the tie warning's message says "(noncontrolling interest not reported)" when NCI tags are absent.
4. A company with an error-severity finding keeps its previous `frontend/data/company-*.js`; publish the old file plus the finding in `quality-report.json`, never a wrong figure.
5. Staleness guard: latest filing 400+ days old (`STALE_AFTER_DAYS` in metrics.js) -> `stale_filing` warn, a UI banner and a flag passed to the analyst prompt. Fix the pull; do not silence the guard.

### Historical (no longer on main)
- The MySQL/Power BI leg is gone: `loaders/` (all Python: 02_load_sec_data, 03_build_directory, 04_seed_universe, 06/07/08/09/10/11, monthly_refresh.py, run_loader.bat), `docs/PIPELINE.md`, `DATA_POLICY.md`, `sql/06_canonical_views.sql`, `sql/07_data_quality.sql`, the PBIP project, `scripts/refresh.mjs` and `scripts/verify-parity.mjs` are not in the tree (`frontend/data/company-index.js` still credits a deleted `export_dashboard_data.py`). The incidents behind those procedures are real and still encoded in comments and data files, but the loader procedures, `run_loader.bat` invocations and the `mysql -u learn -p finance_db < ...` tail no longer apply. Do not edit files that do not exist; treat old notes referencing them as history.

### Before you finish (verification)
- Offline suites pass on a clean checkout: `node scripts/test-valuation.mjs` and `node scripts/test-interim.mjs`.
- `node scripts/smoke.mjs` (awkward-company suite over the real handlers) when live SEC egress is available - SEC 403s datacenter/proxy traffic, so it cannot run sandboxed; say so rather than faking it.
- `frontend/data/quality-report.json` shows no new error-severity finding; tie warnings are explained in the PR.
- One company's `company-*.js` spot-checked against the filing values on EDGAR.
- No API key or credential in the diff.
- A filer whose latest filing is 400+ days old still triggers `stale_filing`, the UI banner and the prompt flag.
- `frontend/data/company-*.js` for any company with an error finding is byte-identical to the previous commit (the "keep the previous file" rule held).

## Known pitfalls (from history)
- FCX Q2 2026 balance sheet off by $12.11B -> equity taken parent-only -> include the NCI concepts (`bookEquity()`, `validateCompany`); note the tie is now warn-severity by design.
- Revenue a fraction of the real figure (AMT, COF) -> first-tag-wins picked an ASC 606 component tag -> take the largest candidate per period (`maxDurationSeries`); keep tag lists only in `concepts.mjs`.
- Quarterly cash flow missing after Q1 / LTM cash dead -> 10-Q cash flow is YTD-only -> de-cumulate via `fillFromYearToDate`; derive Q4 from FY only when Q1-Q3 all exist.
- Six filers empty -> per-concept pulls missed them (`"units":{"USD":{}}`) -> companyfacts bulk pull; remember `api/pull.js` still uses the per-concept strategy.
- Sunday refresh fails at step 1 -> `weekly-refresh.yml` invokes `scripts/refresh.mjs` / `verify-parity.mjs` which are not in the tree -> restore/locate the script before promising a refresh; grep workflows for a script's path in the same change that moves it.
- SEC refuses or throttles -> a request escaped the 125ms slot gate -> route every call through it (`SEC_MIN_INTERVAL_MS`).
- Duplicate periods from comparative columns and fragments -> dedupe before write; per-fact provenance (accession_no) travels into the sync SQL.
- Stale data trusted silently -> 400-day staleness guard (`stale_filing`) with banner and prompt flag.
- Historical: sync SQL "applied" but MySQL unchanged (missing provenance, #15) and the Python loader chain - MySQL leg no longer on main; see Historical above.
