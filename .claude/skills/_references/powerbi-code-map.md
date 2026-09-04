# PowerBI repo — current architecture (main as of 4 Sep 2026, after PR #40)

Product: "Research Terminal" — a SEC-EDGAR-driven financial-statement analysis site. A JavaScript site and
pipeline (static frontend + Vercel serverless `api/` + Node scripts run by GitHub Actions) with a Python/MySQL leg
beside it that feeds the Power BI model from the same figures. Production origin is **https://www.chineduokeke.mba**
(`scripts/lib/ratelimit.mjs` ALLOWED_ORIGINS and `frontend/strategy.js` API_BASE), not power-bi-weld.vercel.app.
554 tracked files, 12 of them Python.

> Correction (4 Sep 2026): the v0.1 snapshot of this map was taken while PR #37 had accidentally deleted 54 files —
> the Power BI project, `loaders/`, `docs/`, the SQL views and `scripts/refresh.mjs` / `verify-parity.mjs` /
> `build-industry-map.mjs`. PR #40 restored them byte-for-byte. Everything below describes main with them present.

## The MySQL / Power BI leg (on main)

- `loaders/` — Python: `02_load_sec_data.py`, `03_build_directory.py`, `04_seed_universe.py`,
  `06_fill_missing_finnhub.py`, `07_load_price_history.py`, `08_load_company_profile.py`,
  `09_build_analyst_insight.py` (stored DeepSeek insight into `finance_db.analyst_insight`), `10_load_news.py`
  (Marketaux), `11_backfill_concepts.py`, `monthly_refresh.py`, `run_loader.bat`, `sic_sectors.py`. They read and
  write the local MySQL `finance_db`; credentials live only in the gitignored `loaders/db_config.json`.
- `docs/PIPELINE.md` (one definition, four consumers; the weekly refresh; bringing MySQL and Power BI in step;
  running it by hand; changing a formula) and `docs/DATA_POLICY.md`.
- `sql/06_canonical_views.sql` (the SQL statement of the metrics.js definitions, with `v_definitions_version`
  declaring the version verify-parity checks), `sql/07_data_quality.sql`, and the `sql/sync/facts-<date>.sql`
  upserts the refresh writes (idempotent `INSERT … ON DUPLICATE KEY UPDATE` into
  `financial_facts(cik, concept, unit, fiscal_year, fiscal_period, period_end, value, filed_date, form, accession_no)`).
- The Power BI PBIP project: `PowerBI_Dashboard_Project.Report` and `.SemanticModel` (TMDL tables over `finance_db`).
- `scripts/refresh.mjs`, `scripts/verify-parity.mjs` and `scripts/build-industry-map.mjs` (described under scripts/),
  and `frontend/export_dashboard_data.py` (exports `company-index.js` and `coverage.js` from `finance_db`;
  `frontend/package.json` `export:data`). `frontend/data/company-*.js` are written by `scripts/refresh.mjs`.
- The MySQL database itself is local and not in the repo; the sync SQL file is the bridge to it.

## Data flow, end to end

1) **Weekly refresh** (`.github/workflows/weekly-refresh.yml`, Sundays 07:00 UTC, `workflow_dispatch` with `--limit`):
   plain Node, zero npm deps. Steps: `node scripts/refresh.mjs --limit N` (pulls the covered universe from EDGAR,
   validates every payload with metrics.js, writes `frontend/data/company-*.js`, `frontend/data/quality-report.json`
   and `sql/sync/facts-<date>.sql`; exit 1 on error-severity findings, 2 if the pull failed) →
   `node scripts/verify-parity.mjs` (definitions version and committed data against metrics.js; the SQL comparison is
   skipped without database credentials) → `node scripts/build-segments.mjs` → `node scripts/build-risks.mjs` →
   `node scripts/build-strategy-panel.mjs` → `node scripts/chunk-data.mjs` → summarize quality-report to
   `$GITHUB_STEP_SUMMARY` → commit `frontend/data` + `sql/sync` (push triggers Vercel deploy) → upload
   quality-report artifact. Env: `SEC_USER_AGENT` (GH `vars`, falls back to "Research Terminal research@chineduokeke.mba").
2) **Manual tail** (docs/PIPELINE.md, "Bringing MySQL and Power BI in step"): apply `sql/sync/facts-<date>.sql` to the
   local `finance_db` (`mysql -u learn -p finance_db < sql/sync/facts-<date>.sql`), then refresh the Power BI model —
   the PBIP project is in the repo; the database is local.
3) **Site** (vercel.json rewrites `/` → `frontend/index.html`, `/(.*)` → `frontend/$1`, `/api/*` → serverless):
   pages read committed `frontend/data/*` for the 130-company covered universe and hit `api/*` live for everything else.

## The 130-company universe and data files (`frontend/data/`, 141 entries)

- `company-<ticker>.js` ×130 — `window.COMPANY_OVERVIEW_DATA` snapshot (latest quarter + LY + FY; provenance per concept;
  `definitionsVersion: 2`). `coverage.js` = the 130 tickers; `company-index.js` = ~8k-row `[ticker, cik, name]` SEC index;
  `industry-map.js` = ticker → {cik, name, sic, industry, sector}.
- `strategy-panel.js` — `window.PANEL_FIELDS` (34 positional fields) + `window.STRATEGY_PANEL` (130 companies × ~19 fiscal
  years, values in THOUSANDS, built by build-strategy-panel.mjs). `segments.js`, `risks.js` — monolithic builder outputs.
- `panel/<industry-slug>.json`, `panel-index.json`, `segments/<TICKER>.json`, `risks/<TICKER>.json` — the lazy-load split
  written by `chunk-data.mjs` (strategy page had been 1.7MB before first paint; `strategy-boot.js` fetches only the
  opened company's industry/segments/risks).
- `quality-report.json` — last run: 130/130 written, 0 errors, 3 warns (BLK/SPG/SPGI `balance_sheet_tie`, attributed to
  redeemable NCI outside the pulled concepts).

## scripts/ (run with plain `node`, no install)

- `refresh.mjs` — the weekly refresh (`--limit N`, `--ticker T`, `--out DIR`): companyfacts pull via `lib/sec-pull.mjs`,
  `validateCompany()` from metrics.js on every payload, writes `company-*.js`, `quality-report.json` and the sync SQL in
  one run so the three surfaces cannot drift; zero dependencies, no database connection.
- `verify-parity.mjs` — proves the JavaScript and SQL statements of each metric agree: checks `v_definitions_version`
  in `sql/06_canonical_views.sql` against `DEFINITIONS_VERSION`, recomputes the committed data files with metrics.js,
  and recomputes the SQL views' output in JavaScript when `loaders/db_config.json` and a `mysql` client are present
  (`RT_DB_CONFIG`, `RT_MYSQL_BIN` to point elsewhere); otherwise reports the SQL comparison as skipped, so it runs in CI.
- `build-industry-map.mjs` — ticker → {cik, name, sic, industry, sector} for the covered universe (via `sic-map.mjs`)
  → `frontend/data/industry-map.js`.
- `build-segments.mjs` — segment/product/geographic revenue from each covered company's latest annual filing's own XBRL
  instance (companyfacts is dimensionless; the axes live only in the `*_htm.xml` instance, sometimes only inside
  `-xbrl.zip` → own minimal zip reader). Keeps facts carrying EXACTLY one axis (two axes = matrix cell = double count).
  Args `--ticker T --limit N`; env `SEC_MIN_INTERVAL_MS` (default 125ms global pace). → `frontend/data/segments.js`.
- `build-risks.mjs` — Item 1A headings verbatim from the latest 10-K (last occurrence of the heading = the section, not
  the ToC; bold/italic runs 25–300 chars; <5 headings ⇒ extraction "failed", ship word-count + link instead of a wrong
  list). → `frontend/data/risks.js`.
- `build-strategy-panel.mjs` — full annual history per covered company via `buildStatements`, rounded to thousands,
  positional arrays (`scripts/lib/panel-row.mjs` is the ONE field list, shared with `api/panel.js`). → `strategy-panel.js`.
- `chunk-data.mjs` — splits panel/segments/risks per industry/company (above). Pure local file transform.
- `smoke.mjs` — the awkward-company suite: invokes the real `api/*.js` handlers in-process with mock req/res against
  NVDA (control), AVEX (quarters, no annual), JPM (bank), AMT (REIT), ONON (IFRS 20-F), KBLB (pre-revenue shell),
  ENLV (20-F + untagged 6-K interims). Asserts every 200-payload period carries all five groups
  (incomeStatement/balanceSheet/cashFlow/perShare/shares), AVEX ≥4 quarters, NVDA ≥20 LTM windows, key-less model
  endpoints answer 503. **Needs live SEC EDGAR** — exits 1 in a sandbox (SEC 403s datacenter/proxy traffic).
- `test-valuation.mjs` — offline; checks `frontend/lib/valuation.js` against the valuation course's worked figures
  (harmonic/median/mean of the class P/E example, Alford widening, Starbucks/NVIDIA EV bridges, CAPM/WACC, implied
  growth inversions, EVA, GDP-capped terminal growth, steady-state values). PASSES on clean checkout.
- `test-interim.mjs` — offline; parses the committed fixture `scripts/fixtures/enlv-6k-2025q3-ex99-1.htm` (Enlivex's
  untagged 6-K) with `interim-parse.mjs`, asserts exact figures and that `factsToBucket`+`buildStatements` yields a
  real Q3 FY2025 period. PASSES on clean checkout.
- CI: `smoke.yml` (every PR/push) = per-file `new Function(readFileSync(f))` parse check of `frontend/*.js` +
  `frontend/lib/*.js`, then test-valuation, test-interim, then smoke.mjs (network).

## scripts/lib/ (the shared engine — "one implementation, two callers" everywhere)

- `concepts.mjs` — THE ordered us-gaap tag lists (INCOME/BALANCE/CASHFLOW/PERSHARE/SHARE_COUNTS), plus `COMPOSITES`
  (sum disclosed components only when the total is untagged and every part is present — Phillips 66 pretax; bank
  revenue = interest + noninterest). Encodes hard-won tag lore: revenue resolved by LARGEST candidate per period
  (ASC 606 tag is a *component* for AMT $0.9bn vs $10.6bn, COF $8.1bn vs $53.4bn); NVIDIA's securities tag migration;
  the insurer trap (MarketableSecurities total = bond portfolio, an operating asset); KO's long-term-debt tag move.
- `sec-pull.mjs` — EDGAR XBRL → dashboard payload. companyfacts bulk pull first (1 req/company vs 23; only path that
  works for KO/ABT/COF/NXPI/SPGI/WELL whose companyconcept answers empty), per-concept fallback; one global 125ms pace
  gate (`SEC_MIN_INTERVAL_MS`) with synchronous slot reservation; 404 = "concept never tagged", not an error;
  429/5xx retried with backoff. Restatement precedence: per (unit, fy, fp) keep latest period_end → longest span →
  latest filed. Exports `SEC_UA`. All derived numbers delegated to `frontend/lib/metrics.js`.
- `statements.mjs` — multi-period builder. Periods identified by REPORTED SPAN LENGTH (80–100d quarter, 340–380d year),
  never by subtracting YTD blindly; fiscal year/quarter derived from period-end + fiscal-year-end month (EDGAR fy/fp
  describe the FILING, so a 10-K's comparatives all carry the filing's fy); quarter classified by span MIDPOINT
  (52/53-week calendars); filer's own FY naming + restatement records via `provenance()`; anchor periods on the union
  of revenue/netIncome/operatingIncome/cfOps (pre-revenue filers); derive Q4 = FY − (Q1+Q2+Q3) only when all three
  exist; recover a missing quarter from a YTD span only when exactly one is missing; fill YTD-only cash-flow lines
  (10-Q cash flow is YTD-only, so Q2/Q3 cash flow must be de-cumulated); LTM windows only over four consecutive
  quarters; `coverShares()` sums multi-class dei cover rows.
- `interim-parse.mjs` — HTML-table statement parser for untagged 6-K exhibits (period columns dated from header block,
  thousands scaling except per-share/share counts, sign from parentheses, label → concept map); `factsToBucket` makes
  the output indistinguishable from the facts feed downstream.
- `filing-parse.mjs` — pure parsers shared by builders and endpoints: minimal ZIP central-directory reader
  (some filer agents ship only `-xbrl.zip` — ACN/NFLX/QCOM/RTX), XBRL instance → bucket (`instanceToBucket`,
  `parseInstance`, `dropAggregates`), Item 1A extraction (`strip`, `extractItem1A`, `extractHeadings`,
  `extractProspectusRisks`).
- `panel-row.mjs` — PANEL_FIELDS order + statement mapping + rounding (thousands), single definition.
- `peer-hints.mjs` — curated proxy-statement peer sets (footwear/athleisure); IFRS names kept on purpose, endpoint
  drops them with a reason. `sic-map.mjs` — SIC major group → [industry, sector], single definition.
- `ratelimit.mjs` — `gate(req, {burst, ratePerMin, dailyCap, cost})`: per-IP token bucket + global daily budget +
  same-origin allowlist (chineduokeke.mba, localhost 7240-42, *.vercel.app previews); originless server-to-server
  callers (the smoke suite) allowed.

## api/ (13 files; Vercel functions, `api/package.json` = `{"type":"module"}`)

| endpoint | purpose | external | env |
|---|---|---|---|
| `pull.js` | on-demand fundamentals for an uncovered ticker, payload shaped like company-*.js; diagnoses "no periodic reports" precisely (SEDAR+ filers) | EDGAR submissions + companyconcept (batches of 6; NOTE: does *not* use sec-pull's bulk path; local copy of normalize; forms incl. 6-K) | SEC_USER_AGENT |
| `statements.js` | 10y/20q/LTM statements + `ratios.computeRatios`; companyfacts + 2 backstops: (a) thin/stale feed → parse recent filings' XBRL instances, (b) untagged 6-K interims → EDGAR full-text search → `interim-parse` (the ENLV path); 6h warm-instance cache | EDGAR | SEC_USER_AGENT |
| `panel.js` | strategy row + peer cohort for uncovered companies; peers: curated hint → exported panel → DeepSeek *nomination* (names only, validated against SEC registrant file) → EDGAR browse by SIC | EDGAR, DeepSeek | DEEPSEEK_API_KEY, SEC_USER_AGENT |
| `segments.js` / `risks.js` | one company's segment table / Item 1A register, same parsers as the weekly builders, shaped like the committed files; 24h cache | EDGAR | SEC_USER_AGENT |
| `release.js` | latest 8-K Item 2.02 earnings-release exhibit → outlook sentences + non-GAAP reconciliation tables VERBATIM with URL | EDGAR | SEC_USER_AGENT |
| `market.js` | quote/profile/candles/recommendations/news + top value-traded days; per-provider isolation (failure → null section); Yahoo chart as keyless candle fallback | Finnhub, Alpha Vantage, Marketaux, Yahoo | FINNHUB_API_KEY, ALPHAVANTAGE_API_KEY, MARKETAUX_API_KEY |
| `valuation.js` | vendor TTM multiples + annual multiple series to 2000 + EPS surprises + next earnings date; 503 without key | Finnhub | FINNHUB_API_KEY |
| `comps.js` | comp-sheet multiples for ≤12 tickers, 15-min cache/ticker; 503 without key | Finnhub | FINNHUB_API_KEY |
| `macro.js` | FRED leading/coincident/lagging indicator groups, decade of monthly history each, 6h cache | FRED | FRED_API_KEY — **plus a hardcoded fallback FRED key in the file**, self-flagged as private-repo-only, must rotate before going public |
| `analysis.js` | DeepSeek "veteran analyst" Company Overview note; client POSTs evidence (fundamentals, spike days, headlines, consensus); prompt embeds CFA-materiality tiers, bps rule, fact-vs-inference; gated | DeepSeek | DEEPSEEK_API_KEY |
| `fsa-note.js` | DeepSeek connective note over client-computed facts (statements + strategy kinds), 7-day cache; gated (burst 10, 4/min) | DeepSeek | DEEPSEEK_API_KEY |

## frontend/

- Pages: `index.html` (Company Overview, `app.js`, v3 UI, default ticker NVDA), `statements.html` (FSA, `statements.js`,
  data from `/api/statements`, computes with `lib/ratios.js`, explains with `lib/metric-catalog.js`),
  `strategy.html` (`strategy-boot.js` lazy bootstrap + `strategy.js` 3.6k lines, panel + `lib/strategy.js` +
  `lib/valuation.js`), `credit.html` ("The credit view is in build" — placeholder). `lib/export.js` = dependency-free
  XLSX (stored-zip + SpreadsheetML) / CSV export with provenance footer. Only vendored dep: `vendor/chart.umd.min.js`.
- `dev-server.js` — zero-dep static server (`npm run dev`, port 7100) that serves `/api/statements` locally by importing
  the same modules; all other /api routes go to the deployed site (frontend API_BASE → chineduokeke.mba on localhost).
- `frontend/lib/` (all UMD — same file in browser and Node):
  - `metrics.js` (v2, 315 lines) — Company Overview derivations + `validateCompany` quality gate. Null-refusing `div`;
    `sumPresent`; runway on OPERATING burn only; pctChange vs |prior|; bps for margins; tiered materiality;
    `balanceSheetTie` at 0.5% of assets; 400-day staleness. Tie failures are now ALWAYS "warn", never a publication
    block (BlackRock rationale: unmodelled redeemable NCI shouldn't drop a page); errors that DO block: working-capital
    or net-cash-change drift vs components, negative assets/cash, bad share count, no period.
  - `ratios.js` (FRAMEWORK_VERSION 1, 759 lines) — the ACCOUNTG 597 reformulation engine: NOA = NetDebt + Equity(incl NCI),
    additive DuPont ROE = RNOA + spread × net financial leverage (after-tax net interest DERIVED as NOPAT − NI so the
    decomposition closes by construction), modified + traditional DuPont kept for contrast, purchases-based payables
    turnover, cash-cycle metrics, Altman Z (null if ≥2 of 5 terms missing), residual income, earnings quality
    (cumulative NI vs FCF), spread stability. Historical returns use AVERAGE balances; quarterly flows annualise ×4.
  - `valuation.js` — Alford comparable selection (3-digit SIC widening → 2 → industry → sector → all; ranked by
    log-size + ROE distance), harmonic-mean aggregation (LNT), EV bridge (leases carried as a separate line),
    CAPM/WACC, implied growth inversions, ROIC/EVA, TERMINAL_GROWTH capped at 4% nominal GDP, steady-state one-line
    models, driver reliability IQRs.
  - `metric-catalog.js` — definition/interpretation/watch text per ratios.js key (tooltip can't drift from formula).
  - `strategy.js` — cross-sectional layer over the panel (concentration labelled an upper bound, share-of-covered-revenue
    caveat); firm profitability delegated to ratios.js via a period adapter.

## Parity machinery

`DEFINITIONS_VERSION = 2` lives in `frontend/lib/metrics.js`, is stamped into every `company-*.js` and
`quality-report.json`, and is mirrored by `v_definitions_version` in `sql/06_canonical_views.sql`;
`scripts/verify-parity.mjs` fails when the two disagree and, with database credentials, when the SQL views' output
disagrees with metrics.js. In-repo consistency is enforced by single-source modules (concepts.mjs, panel-row.mjs,
sic-map.mjs, metrics.js, ratios.js) after repeated copy-drift incidents, and by smoke.mjs exercising the live handler
paths that a builder-output parity check never touched.

## How to run things

- Tests (offline, pass on clean checkout): `node scripts/test-valuation.mjs`, `node scripts/test-interim.mjs`,
  and the parse loop from smoke.yml. Network suite: `node scripts/smoke.mjs` (needs real SEC egress; SEC 403s proxies).
- Refresh and parity: `node scripts/refresh.mjs [--ticker T | --limit N]`, `node scripts/verify-parity.mjs`; then apply
  the sync SQL to the local MySQL and refresh Power BI (docs/PIPELINE.md, "Running it by hand").
- Builders: `node scripts/build-segments.mjs [--ticker T] [--limit N]`, `node scripts/build-risks.mjs`,
  `node scripts/build-strategy-panel.mjs [--limit N]`, `node scripts/build-industry-map.mjs`, then
  `node scripts/chunk-data.mjs` (offline).
- Loaders (Python, local MySQL): `loaders/run_loader.bat` or `python loaders/<step>.py`;
  `python frontend/export_dashboard_data.py` for the search index and coverage files.
- Dev: `cd frontend && npm run dev` (no install needed).
