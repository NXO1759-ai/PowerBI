# PowerBI repo — current architecture (updated 22 Sep 2026, through PR #51)

Product: "Research Terminal" — a SEC-EDGAR-driven financial-statement analysis site. A JavaScript site and
pipeline (static frontend + Vercel serverless `api/` + Node scripts run by GitHub Actions) with a Python/MySQL leg
beside it that feeds the Power BI model from the same figures. Production origin is **https://www.chineduokeke.mba**
(`scripts/lib/ratelimit.mjs` ALLOWED_ORIGINS and `frontend/strategy.js` API_BASE), not power-bi-weld.vercel.app.
860 tracked files, 12 of them Python.

> Update (22 Sep 2026, PRs #43–#46 and #48–#51): the fourth page, `frontend/credit.html`, is no longer a placeholder
> — it is the **Private Credit Terminal**, four views over the listed BDCs' own filings, the ingested PitchBook and
> LCD series, FRED and the market feed. It brings its own data layer (`frontend/data/bdc/`, `frontend/data/pc/`,
> `frontend/data/underwriting.json`), its own definition module (`frontend/lib/credit.js`, carrying `CREDIT_VERSION`
> the way metrics.js carries `DEFINITIONS_VERSION`), its own builders and `scripts/lib/` modules, four new endpoints
> and a `layer` input on the weekly refresh. The covered operating-company universe also grew from 130 to 137.
> Everything below describes the repo with all of that present; the sections it did not touch are unchanged.

> Correction (4 Sep 2026): the v0.1 snapshot of this map was taken while PR #37 had accidentally deleted 54 files —
> the Power BI project, `loaders/`, `docs/`, the SQL views and `scripts/refresh.mjs` / `verify-parity.mjs` /
> `build-industry-map.mjs`. PR #40 restored them byte-for-byte. Everything below describes main with them present.

## The MySQL / Power BI leg (on main)

- `loaders/` — Python: `02_load_sec_data.py`, `03_build_directory.py`, `04_seed_universe.py`,
  `06_fill_missing_finnhub.py`, `07_load_price_history.py`, `08_load_company_profile.py`,
  `09_build_analyst_insight.py` (stored research-model insight into `finance_db.analyst_insight`), `10_load_news.py`
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

1) **Weekly refresh** (`.github/workflows/weekly-refresh.yml`, Sundays 07:00 UTC, `workflow_dispatch` with two inputs,
   `limit` (default "0") and `layer`, a choice of **all | bdc** defaulting to "all"): plain Node, zero npm deps.
   The five operating-company steps below each carry `if: ${{ inputs.layer != 'bdc' }}` — written as a negative on
   purpose, since a scheduled run carries no inputs at all and `inputs.layer` is then null, so null, "", "all" and any
   unrecognized value all take the safe branch and run the full refresh; only an explicit `bdc` skips them. A third
   value, `pc`, is deliberately not offered: the PitchBook/LCD ingest has no step in this workflow, it runs on the
   owner's own machine. Steps: `node scripts/refresh.mjs --limit N` (pulls the covered universe from EDGAR,
   validates every payload with metrics.js, writes `frontend/data/company-*.js`, `frontend/data/quality-report.json`
   and `sql/sync/facts-<date>.sql`; exit 1 on error-severity findings, 2 if the pull failed) →
   `node scripts/verify-parity.mjs` (definitions version and committed data against metrics.js; the SQL comparison is
   skipped without database credentials) → `node scripts/build-segments.mjs` → `node scripts/build-risks.mjs` →
   `node scripts/build-strategy-panel.mjs` → *(everything from here is unconditional, a `bdc` run starts here)*
   `actions/cache@v4` keeping `.cache/bdc/datasets` between runs → `node scripts/refresh-bdc.mjs`
   (`continue-on-error`, `timeout-minutes: 25`, so a stalled zip download ends that step alone) →
   `node scripts/build-underwriting-panel.mjs` (`continue-on-error`) → `node scripts/chunk-data.mjs` → summarize to
   `$GITHUB_STEP_SUMMARY` (a `bdc` run reads `frontend/data/bdc/refresh-report.json` instead of `quality-report.json`,
   which only the operating-company steps write) → commit `frontend/data` + `sql/sync`, printing every staged deletion
   first so a vanished file is never a silent line in a data commit (push triggers Vercel deploy) → upload
   quality-report artifact → `node scripts/check-exposure.mjs` (`if: always()`, `continue-on-error`: proves the live
   deployment still serves only the site). Env: `SEC_USER_AGENT` (GH `vars`, falls back to "Research Terminal
   research@chineduokeke.mba").
2) **Manual tail** (docs/PIPELINE.md, "Bringing MySQL and Power BI in step"): apply `sql/sync/facts-<date>.sql` to the
   local `finance_db` (`mysql -u learn -p finance_db < sql/sync/facts-<date>.sql`), then refresh the Power BI model —
   the PBIP project is in the repo; the database is local.
3) **Site** (vercel.json rewrites `/` → `frontend/index.html`, `/(.*)` → `frontend/$1`, `/api/*` → serverless):
   pages read committed `frontend/data/*` for the 137-company covered universe and hit `api/*` live for everything else.

## The 137-company universe and data files (`frontend/data/`, 154 entries)

- `company-<ticker>.js` ×137 — `window.COMPANY_OVERVIEW_DATA` snapshot (latest quarter + LY + FY; provenance per concept;
  `definitionsVersion: 2`). `coverage.js` = the 137 tickers; `company-index.js` = ~8k-row `[ticker, cik, name]` SEC index;
  `industry-map.js` = ticker → {cik, name, sic, industry, sector}.
- `strategy-panel.js` — `window.PANEL_FIELDS` (38 positional fields) + `window.STRATEGY_PANEL` (137 companies × ~19 fiscal
  years, values in THOUSANDS, built by build-strategy-panel.mjs). `segments.js`, `risks.js` — monolithic builder outputs.
- `panel/<industry-slug>.json`, `panel-index.json`, `segments/<TICKER>.json`, `risks/<TICKER>.json` — the lazy-load split
  written by `chunk-data.mjs` (strategy page had been 1.7MB before first paint; `strategy-boot.js` fetches only the
  opened company's industry/segments/risks).
- `quality-report.json` — last run: 137/137 written, 0 errors, 5 warns (APLD/BLK/DLR/SPG/SPGI `balance_sheet_tie`, attributed to
  redeemable NCI outside the pulled concepts).
- **The credit layer's own files** (all read by `credit.html`, none of them `window.*` globals — every one is fetched
  JSON): `bdc/universe.json` (53 rows, rule `"814-"`, quarter CY2026Q2), `bdc/company-<TICKER>.json` ×53,
  `bdc/holdings-<TICKER>.json` ×32, `bdc/composite.json` (32 members, `creditVersion` stamped, n on every figure),
  `bdc/coverage.json` (holdings: 32 passed, 21 refused, each refusal carrying its ticker, accession and reason),
  `bdc/terms.json` and `bdc/refresh-report.json` — all written by `refresh-bdc.mjs` except `terms.json`
  (`build-bdc-terms.mjs`); `underwriting.json` (`build-underwriting-panel.mjs`, 137 companies keyed by ticker);
  and the ingest's output under `pc/` — `series.json`, `series/<group>.json` ×7, `series-index.json` (391 keys),
  `series-provenance.json`, `restatements.json`, `tables/<slug>.json` ×10, `press-series.json`, `ingest-report.json`,
  plus the hand-maintained `pc/glossary.json` (299 terms) that `build-credit-terms.mjs` reads and the Glossary view
  fetches. `pc/fixtures/` holds contract-shaped replies for `/api/credit-macro`, `/api/macro` and
  `/api/price-history`, which `credit.html?fixture=1` reads in place of the endpoints.

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
- `refresh-bdc.mjs` — **the listed-BDC layer** (`--ticker T`, `--limit N`, `--out DIR`): the 814- file-numbered
  universe, each filer's quarterly series off companyfacts (frames merged in where the calendar quarter runs ahead),
  the schedule of investments, and the composite across the filers whose schedule reconciled. Writes
  `frontend/data/bdc/universe.json`, `company-<TICKER>.json` ×53, `holdings-<TICKER>.json` (only for filings that
  passed), `composite.json`, `coverage.json` and `refresh-report.json`; reads `terms.json`, never writes it. Sources:
  EDGAR companyfacts/frames/submissions, the SEC's BDC roster CSV (a cross-check, never a filter), the SEC's monthly
  BDC data-set zips streamed to `.cache/bdc/datasets/` via `zip-stream.mjs`, the filing's own `-xbrl.zip` instance,
  its main inline-XBRL document (cached in `.cache/bdc/docs/`) and its rendered R page; one non-EDGAR call to Yahoo
  for a listing date. Refusals over guesses: a schedule that does not reconcile to the tagged cost and fair value
  within 0.5% gets NO holdings file, the refusal and its sums going to coverage/report instead; a filer EDGAR simply
  did not answer for is never removed from the universe; a `--ticker`/`--limit` run writes no `coverage.json` at all,
  so a partial run cannot record the rest of the universe as missing. Exit 0 if anything was written, 1 if nothing
  was, 2 if the pull itself failed.
- `build-bdc-terms.mjs` — the fee, leverage and asset-coverage sentences a BDC states only in prose, read out of each
  filer's latest 10-Q/10-K main document with `bdc-prose.mjs` → `frontend/data/bdc/terms.json` (`--out FILE`,
  `--offline` reads the document cache alone). A document that lacks the sentence leaves the value **null** — nothing
  is typed in from memory, every value carries its sentence and the filing accession — and a filer whose document
  says it is internally managed gets no fee rates at all.
- `build-underwriting-panel.mjs` — the 137 covered companies read as a lender would read them, off the same
  companyfacts feed → `frontend/data/underwriting.json` (one object keyed by ticker, `schemaVersion: 1`). Has its own
  `fetchFacts` and its own 130ms pace gate — it does NOT import `sec-pull.mjs`. **No company is ever dropped**: a
  ticker EDGAR did not answer for still gets a row with every figure null and the reason first in its `notes`; every
  null leverage figure carries a `leverageNotComputableReason`; Financials, Real Estate and Utilities are excluded
  from the S&P ladder with a stated `sectorCaveat` rather than placed wrongly; an untagged maturity ladder is null
  with a reason, never a zero.
- `ingest-pc.mjs` — the PitchBook/LCD ingest, **local only, no network**: the gitignored `data-sources/` tree (LCD
  monitor decks, Fund Overview exports, hand-keyed report files, the committed press series) → `frontend/data/pc/`
  (`series.json`, `series/<group>.json` ×7, `series-index.json`, `series-provenance.json`, `restatements.json`,
  `tables/<slug>.json`, `ingest-report.json`) plus `data-sources/manifest.json`. A chart is identified by its content
  and never by its chart number (`pc-map.mjs` over `scripts/pc-map.json`). Named refusals rather than a wrong number:
  a value axis on a different scale than the key's unit, two charts of one edition resolving to the same group, a
  workbook sheet whose filter line names a different population. Nothing is dropped or blanked — an unrecognized
  chart is written to the report with its full fingerprint and its key keeps its last points flagged `stale`. Exit 1
  under `--strict` on any gap (outputs still written), 2 when it refused before writing.
- `build-credit-terms.mjs` — `frontend/data/pc/glossary.json` (hand-maintained) → `frontend/lib/credit-terms.js`.
  Offline. `validate()` collects problems and the build **throws rather than writing** on a missing field, a popup
  over 240 characters, an unknown `kind`/`side`, or an alias colliding with another term. Deterministic output
  (total sort order, fixed key order, the date from the JSON) so a re-run on an unchanged glossary yields no diff.
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
- The credit terminal's own offline suites, all wired into `smoke.yml`: `test-credit-ratios.mjs` (the `lib/credit.js`
  formulas against real filings, and it pins `CREDIT_VERSION`), `test-credit-terms.mjs` (the glossary's shape, and
  that the committed `credit-terms.js` is byte-identical to a fresh generator run), `test-nav.mjs`, `test-pc-page.mjs`,
  `test-lenders-{view,scorecard,drilldown}.mjs`, `test-bdc-peers.mjs`, `test-underwriting-{view,panel,concepts}.mjs`,
  `test-bdc-{data,holdings,series,prose}.mjs`, `test-soi.mjs`, `test-soi-html.mjs`,
  `test-pc-{deck,workbook,periods,reports,ingest}.mjs`, `test-owner-tools.mjs` (the page half of the rebuild control),
  `test-rebuild.mjs` (the `api/rebuild.js` half), `test-http.mjs`, `test-fred.mjs`, `test-price-history.mjs`.
  Network-needing: `test-bdc-pull.mjs` (a live one-BDC pull against SEC EDGAR).
- CI: `smoke.yml` (every PR/push) = per-file `new Function(readFileSync(f))` parse check of `frontend/*.js` +
  `frontend/lib/*.js`, then the offline suites above plus test-valuation and test-interim, then smoke.mjs (network).
  `ingest-pc.yml` runs the reader/mapping/replay tests against the committed fixture cuts and fails the build if any
  `.pptx`, `.xlsx` or `.pdf` is tracked under `data-sources/`.

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
- `ratelimit.mjs` — `gate(req, {burst, ratePerMin, dailyCap, cost, name})`: per-IP token bucket + global daily budget +
  same-origin allowlist (chineduokeke.mba, localhost 7240-42, *.vercel.app previews); originless server-to-server
  callers (the smoke suite) allowed. The optional `name` gives a call site its OWN bucket and its own daily counter
  (`name|client`); omitting it keeps the original behavior, one shared bucket and one shared daily counter across
  every unnamed call site. The rule recorded in the header: an endpoint that gates real money — SEC, FRED or GitHub
  calls an unauthenticated caller should not be able to run up — passes a `name` distinct from every other one.
  Names in use: `bdc-pull`, `rebuild-post`, `rebuild-get`, `price-history-force`. All state is per warm instance.
- `handler.mjs` — `jsonSafe()`, the floor under every endpoint: a handler that throws is answered as JSON 500 with
  the caught message truncated, `no-store`, instead of the platform's own HTML error page (which the browser then
  fails to `.json()`). Leaves an already-sent reply alone.
- `fred.mjs` — one FRED reader for `api/macro.js` and `api/credit-macro.js`: the keyed API when
  `FRED_API_KEY` is set, the public CSV endpoint otherwise, plus the monthly downsampler, the percentile over a date
  window and the recession bands. No builder imports it — FRED reaches the credit page only at request time, and no
  committed data file is built from it.
- `github-actions.mjs` — the GitHub Actions REST calls for one repository (dispatch a run, find the latest, get one).
  Every function returns `{ ok: true, … }` or `{ ok: false, status, error }` rather than throwing, and every fetch
  carries its own timeout (`DEFAULT_TIMEOUT_MS = 8000`). `api/rebuild.js` is the only caller.

### The credit layer's own modules under scripts/lib/

- `bdc-concepts.mjs` — the XBRL concepts a BDC actually tags, and `buildBdcSeries`. A BDC is an investment company:
  it tags no revenue, no cost of sales and no operating income, so nothing in `concepts.mjs`/`statements.mjs` can find
  a period for it. One ordered tag ladder per metric (portfolio at cost and fair value, NAV per share, net investment
  income, the fee and leverage lines of the 1940 Act) turns a whole companyfacts feed into quarters keyed by calendar
  period end. Loads `frontend/lib/credit.js` through `createRequire` so the lien map is the page's own.
- `bdc-composite.mjs` — the schedule-derived figures of one BDC and the composite across every BDC whose schedule
  passed the gate; pure, over the holding shape `soi-parse.mjs` produces. Re-exports `CREDIT_VERSION` from
  `frontend/lib/credit.js` and stamps it into the composite; every composite figure states its own n.
- `soi-parse.mjs` — the schedule of investments, one holding per row, from the SEC's monthly BDC data set and from a
  filing's own instance, through one normalizer and one gate: `GATE_TOLERANCE = 0.005` against the tagged
  `InvestmentOwnedAtCost` / `InvestmentOwnedAtFairValue`. Variant row sets are tried in order and the first that
  reconciles wins; every set tried is recorded with its sums.
- `soi-html.mjs` — the same schedule as the 10-Q prints it, for the three things that live only in the HTML table:
  the maturity date, the industry the loan sits under, and the non-accrual footnote. A filer's schedule is not one
  table but a hundred pages of `<table>`, headers repeated and sections re-stated "(continued)".
- `rpage.mjs` — the schedule as EDGAR renders it from the XBRL (the R page named in `FilingSummary.xml`): a second
  source for the non-accrual footnote and, where tagged, the industry. No maturity dates.
- `bdc-prose.mjs` — the figures a BDC states in the prose of its 10-Q/10-K and tags nowhere (asset coverage for the
  filers that do not tag it, the manager's weighted-average yield, the floating share, portfolio-company count,
  non-accrual at cost and at fair value, the Item 3 rate-sensitivity table, fee and target-leverage sentences). Used
  by `refresh-bdc.mjs` and `build-bdc-terms.mjs`.
- `zip-stream.mjs` — a zip reader for archives too large to hold in memory, plus the paced download that puts them on
  disk. `filing-parse.mjs`'s `unzipMember` inflates a member whole, which is right for a 1 MB `-xbrl.zip` and wrong
  for the SEC's monthly BDC data set (265.6 MB on the wire, `datasets/num.tsv` inflating to 1.17 GB): here the central
  directory is read from the tail, a member is served as a stream over its byte range, and the caller walks it line by
  line. Imports `SEC_UA` and `paced` from `sec-pull.mjs`, so the zip downloads share the one global SEC gate.
- `pc-map.mjs` — identifies a monitor chart or a workbook sheet by its CONTENT, never by its chart number (the number
  is the order PowerPoint happened to save the parts in, and one inserted slide moves every number after it):
  `fingerprint()` then `match()` against `scripts/pc-map.json`, scored on heading, series names, grain and axis
  formats, and matched only when the best entry scores at least 4 and beats the runner-up by at least 1.
- `pc-periods.mjs` — the period-label grammar of the PitchBook and LCD sources: every label form the deck and the
  workbook print ("1Q20", "Q3 2018", "1H26", "YTD August 2026", "TTM", "As of June 30, 2026", "Jun-26") becomes a
  dated window, and a label that is not a period ("Healthcare", "450 - 499 bps") comes back as nothing.
- `pc-series.mjs` — from a read file to dated series, and from a stack of vintages to the series the page draws:
  `extractDeck`, `extractWorkbook`, `extractReport`, `extractPress`, `build` (replay oldest → newest, newest wins per
  key and date) and `derive`. Home of the three named refusals — a unit mismatch, a duplicate match, and a group that
  failed to match in the newest edition leaving its keys `stale`. (Distinct from the browser's `frontend/lib/pc-series.js`.)
- `ooxml.mjs`, `pptx-charts.mjs`, `xlsx-read.mjs`, `zip-read.mjs` — the deck and workbook readers underneath the ingest.

## api/ (17 files; Vercel functions, `api/package.json` = `{"type":"module"}`)

The three research-model routes (`panel.js`, `analysis.js`, `fsa-note.js`) read one API key from an env var whose name
is the provider's own. House rule: no file in this repo names an AI vendor, model or product, so the name is not
written out here — read it off the route. Renaming the variable is its own change, not part of a feature PR.

| endpoint | purpose | external | env |
|---|---|---|---|
| `pull.js` | on-demand fundamentals for an uncovered ticker, payload shaped like company-*.js; diagnoses "no periodic reports" precisely (SEDAR+ filers) | EDGAR submissions + companyconcept (batches of 6; NOTE: does *not* use sec-pull's bulk path; local copy of normalize; forms incl. 6-K) | SEC_USER_AGENT |
| `statements.js` | 10y/20q/LTM statements + `ratios.computeRatios`; companyfacts + 2 backstops: (a) thin/stale feed → parse recent filings' XBRL instances, (b) untagged 6-K interims → EDGAR full-text search → `interim-parse` (the ENLV path); 6h warm-instance cache | EDGAR | SEC_USER_AGENT |
| `panel.js` | strategy row + peer cohort for uncovered companies; peers: curated hint → exported panel → research-model *nomination* (names only, validated against SEC registrant file) → EDGAR browse by SIC | EDGAR, research model | the research-model API key (see the note above this table), SEC_USER_AGENT |
| `segments.js` / `risks.js` | one company's segment table / Item 1A register, same parsers as the weekly builders, shaped like the committed files; 24h cache | EDGAR | SEC_USER_AGENT |
| `release.js` | latest 8-K Item 2.02 earnings-release exhibit → outlook sentences + non-GAAP reconciliation tables VERBATIM with URL | EDGAR | SEC_USER_AGENT |
| `market.js` | quote/profile/candles/recommendations/news + top value-traded days; per-provider isolation (failure → null section); Yahoo chart as keyless candle fallback | Finnhub, Alpha Vantage, Marketaux, Yahoo | FINNHUB_API_KEY, ALPHAVANTAGE_API_KEY, MARKETAUX_API_KEY |
| `valuation.js` | vendor TTM multiples + annual multiple series to 2000 + EPS surprises + next earnings date; 503 without key | Finnhub | FINNHUB_API_KEY |
| `comps.js` | comp-sheet multiples for ≤12 tickers, 15-min cache/ticker; 503 without key | Finnhub | FINNHUB_API_KEY |
| `macro.js` | FRED leading/coincident/lagging indicator groups, decade of monthly history each, 6h cache | FRED | FRED_API_KEY — **plus a hardcoded fallback FRED key in the file**, self-flagged as private-repo-only, must rotate before going public |
| `analysis.js` | research model "veteran analyst" Company Overview note; client POSTs evidence (fundamentals, spike days, headlines, consensus); prompt embeds CFA-materiality tiers, bps rule, fact-vs-inference; gated | research model | the research-model API key (see the note above this table) |
| `fsa-note.js` | research model connective note over client-computed facts (kinds: statements, strategy, credit, bdc, underwriting — the credit page uses `credit` and `underwriting`), 7-day cache; gated (burst 10, 4/min) | research model | the research-model API key (the env-var name in the file is the provider's own; renaming it is its own change) |
| `credit-macro.js` | the credit conditions strip: 22 FRED series (ICE BofA spreads, SOFR, Baa−10y, SLOOS, C&I delinquency/charge-off, financial-conditions and stress indices, the H.8 nondepository lines) each with latest/prior/year-ago, sparkline, a decade of monthly history and a ten-year percentile, plus the NDFI share and USREC bands; 6h warm-instance cache, `?force=1` gated (burst 3, 2/min) | FRED (via `lib/fred.mjs`; API when keyed, public CSV otherwise) | FRED_API_KEY *(optional — it answers without one)* |
| `price-history.js` | 5y or max monthly closes + dividend-adjusted close for one ticker (the credit page draws BIZD against a loan ETF rebased to 100); Finnhub candles first when the plan allows, else keyless Yahoo chart v8 with a browser-like UA; 6h cache, `?force=1` gated on its own named bucket (`price-history-force`, burst 3, 4/min) | Finnhub, Yahoo | FINNHUB_API_KEY *(optional; without it the chain starts at Yahoo)* |
| `bdc-pull.js` | live one-BDC refresh: `GET ?ticker=ARCC` → companyfacts through the same `buildBdcSeries` the weekly refresh uses, plus a frame overlay for six concepts when the next calendar quarter is already on frames (skipped on a fiscal Q4); CIK and fiscal-year-end month come from `frontend/data/bdc/universe.json`, which is why it is the one `vercel.json` `functions.includeFiles` entry; never cached (`no-store`), one 40s wall-clock deadline inside `maxDuration = 60`, gated tight on its own bucket (`bdc-pull`, burst 2, 3/min, cost 1). Complete and tested (`scripts/test-bdc-pull.mjs`) but not yet called from `frontend/` | EDGAR | SEC_USER_AGENT, SEC_MIN_INTERVAL_MS *(both optional, both defaulted in `sec-pull.mjs`)* |
| `rebuild.js` | the owner-only "Rebuild the credit layer" control: `POST` dispatches `weekly-refresh.yml` on `main` with `{ limit: "0", layer }` (`layer` ∈ all \| bdc — `pc` withheld because that ingest has no step in the workflow), `GET ?since=<ISO>` polls the run. Shared secret in the `X-Rebuild-Secret` header only, SHA-256'd both sides then `timingSafeEqual`; 409 when a run is already queued or in progress; the GET also reads `frontend/data/bdc/refresh-report.json` at `ref=main` so a run that concluded "success" with a stale report is reported stale rather than confirmed. `no-store` everywhere; named buckets `rebuild-post` (burst 2, 1/min) and `rebuild-get` (burst 3, 3/min); 25s deadline inside `maxDuration = 30`. **Both env vars missing or empty ⇒ 503 "rebuild is not configured" on both verbs before anything else runs** — the master switch, and what keeps the smoke suite from dispatching a real run | GitHub REST API (`lib/github-actions.mjs`) | GITHUB_DISPATCH_TOKEN, REBUILD_SECRET |

## frontend/

- Pages: `index.html` (Company Overview, `app.js`, v3 UI, default ticker NVDA), `statements.html` (FSA, `statements.js`,
  data from `/api/statements`, computes with `lib/ratios.js`, explains with `lib/metric-catalog.js`),
  `strategy.html` (`strategy-boot.js` lazy bootstrap + `strategy.js` 3.6k lines, panel + `lib/strategy.js` +
  `lib/valuation.js`), `credit.html` (the Private Credit Terminal — below). `lib/export.js` = dependency-free
  XLSX (stored-zip + SpreadsheetML) / CSV export with provenance footer. Only vendored dep: `vendor/chart.umd.min.js`.
- `credit.html` — **the Private Credit Terminal.** Four views behind one set of header buttons
  (`VIEWS = ["market", "lenders", "underwriting", "glossary"]` in `credit.js`; `setView` toggles `#<view>-view.hidden`
  and writes `?view=<v>` with `history.replaceState`). `credit.js` is the page controller AND the Market view's own
  renderer; the other three views mount lazily on first entry.
  - **Market** (`#market-view`, static markup in the page): credit conditions, listed BDCs against leveraged loans,
    the spread ladder, the yield stack, the credit committee's note — drawn by `credit.js` from `/api/credit-macro`,
    `/api/macro`, `/api/price-history` (BIZD against SRLN, falling back to BKLN) and `data/bdc/composite.json`
    (a 404 resolves to null, not an error). Below them three ingested sections register themselves on
    `window.RTCreditSections` and are mounted in `SECTION_ORDER = ["stress", "capital", "dealflow"]` into
    `#sec-stress` / `#sec-capital` / `#sec-dealflow`: `credit-stress.js`, `credit-capital.js`, `credit-dealflow.js`.
    The note POSTs `/api/fsa-note` (kind `credit`) with only the facts the view already drew.
  - **Lenders** (`#lenders-view`, empty in HTML): `credit-lenders.js` → `RTLendersView`, the controller, over
    `lib/lenders-scorecard.js` → `RTLendersScorecard` (a row per universe filer) and `credit-lenders-drilldown.js`
    → `RTLendersDrilldown` (the per-ticker modal). `universe.json` and `coverage.json` are mandatory (either failing
    replaces the whole view with a page-level error state); `terms.json` and `composite.json` are read best-effort;
    then `company-<TICKER>.json` and `holdings-<TICKER>.json` per filer, and `/api/comps` batched 12 tickers a call.
  - **Underwriting** (`#underwriting-view`, empty): `credit-underwriting.js` → `RTCreditUnderwriting`; one fetch of
    `data/underwriting.json`, then `/api/comps` for the selected ticker and `/api/fsa-note` (kind `underwriting`).
  - **Glossary** (`#glossary-view`): rendered by `credit.js` from `data/pc/glossary.json`, fetched the first time the
    view is opened and kept for the session — the same file the generated hover terms are built from.
  - Script order (all parser-blocking classic scripts, and the order is load-bearing: every section and view file
    reads `window.RTCatalog` and calls `RTCatalog.register` at evaluation into ONE flat key namespace, so a file
    ahead of `metric-catalog.js` would register nothing and a duplicate key throws the whole batch away):
    `lib/http.js`, `lib/metrics.js`, `lib/ratios.js`, `lib/export.js`, `lib/metric-catalog.js`, `lib/credit-terms.js`,
    `lib/credit.js`, `lib/valuation.js`, `vendor/chart.umd.min.js`, `lib/pc-series.js`, `credit.js`, the three section
    files, `credit-underwriting.js`, `lib/lenders-scorecard.js`, `credit-lenders-drilldown.js`, `credit-lenders.js`.
    `credit.js` loads before all of them, so it mounts through `SECTION_SCRIPTS_READY`, a promise resolved on
    `DOMContentLoaded` — i.e. after every parser-blocking tag has run.
  - CSS: `styles.css`, `statements.css`, `strategy.css`, `credit.css`, then `credit-stress.css`, `credit-capital.css`,
    `credit-dealflow.css`, `credit-underwriting.css`, then `lenders-scorecard.css`, `credit-lenders-drilldown.css`,
    `credit-lenders.css` — one stylesheet per section and per view file.
  - Data files read: `frontend/data/bdc/{universe,coverage,terms,composite}.json`, `company-<TICKER>.json` ×53 and
    `holdings-<TICKER>.json` ×32 (only filers whose schedule passed the reconciliation gate); `underwriting.json`
    (137 companies); `data/pc/{series-index,restatements,series-provenance}.json` + `data/pc/series/<group>.json` ×7
    + `data/pc/tables/<slug>.json`; `data/pc/glossary.json`.
  - An owner-only control (`#owner-btn`, `hidden` unless a secret is already in sessionStorage this tab or
    `location.hash === "#owner"`) opens a modal whose "Rebuild the credit layer" button POSTs and then polls
    `/api/rebuild`, rendering the server's own error sentence verbatim rather than a wording of the page's own.
- `dev-server.js` — zero-dep server (`npm run dev`, default port 7100) that serves the static pages AND every `/api/<name>`
  locally: it imports `api/<name>.js` and calls its default export with the req/res shape the platform gives it, keeping
  each module's warm-instance cache, so `?force=1` behaves as it does in production. It is the only server that answers
  `/rt-dev.js`, which is how `credit.js`'s API_BASE probe learns /api is local; without it a localhost page falls back to
  https://www.chineduokeke.mba. NOTE: 7100 is NOT in `ratelimit.mjs`'s origin allowlist (7240–7242 are), and the server
  passes the browser's own headers through, so every `sameOrigin: true` path 403s on the default port — run it on 7240.
- `frontend/lib/` (all UMD — same file in browser and Node):
  - `metrics.js` (v2, 315 lines) — Company Overview derivations + `validateCompany` quality gate. Null-refusing `div`;
    `sumPresent`; runway on OPERATING burn only; pctChange vs |prior|; bps for margins; tiered materiality;
    `balanceSheetTie` at 0.5% of assets; 400-day staleness. Tie failures are now ALWAYS "warn", never a publication
    block (BlackRock rationale: unmodeled redeemable NCI shouldn't drop a page); errors that DO block: working-capital
    or net-cash-change drift vs components, negative assets/cash, bad share count, no period.
  - `ratios.js` (FRAMEWORK_VERSION 1, 759 lines) — the ACCOUNTG 597 reformulation engine: NOA = NetDebt + Equity(incl NCI),
    additive DuPont ROE = RNOA + spread × net financial leverage (after-tax net interest DERIVED as NOPAT − NI so the
    decomposition closes by construction), modified + traditional DuPont kept for contrast, purchases-based payables
    turnover, cash-cycle metrics, Altman Z (null if ≥2 of 5 terms missing), residual income, earnings quality
    (cumulative NI vs FCF), spread stability. Historical returns use AVERAGE balances; quarterly flows annualise ×4.
  - `valuation.js` — Alford comparable selection (3-digit SIC widening → 2 → industry → sector → all; ranked by
    log-size + ROE distance), harmonic-mean aggregation (LNT), EV bridge (leases carried as a separate line),
    CAPM/WACC, implied growth inversions, ROIC/EVA, TERMINAL_GROWTH capped at 4% nominal GDP, steady-state one-line
    models, driver reliability IQRs. `selectComparables` now takes an optional `opts.distance(subject, candidate)`
    callback that replaces the size/ROE rule (returning a number, or a `{ distance, complete }` pair so a candidate
    ranked on fewer figures sorts after one ranked on all of them); leaving it out keeps the Alford behavior exactly.
    `bdcDistance` beside it is the BDC-specific rule the Lenders view passes in: `sqrt(dSize² + dLien² + dNonAccrual²)`
    over portfolio fair value (absolute log2 ratio), first-lien share (over 0.10) and non-accrual rate (over 0.01),
    each term null on its own when either side lacks that figure.
  - `credit.js` — the single definition of every BDC and underwriting figure (a lender's ratios, not ratios.js's
    operating-company ones): mark, price/NAV, asset-coverage cushion, breaking markdown, debt/equity, NII return on
    NAV, dividend coverage, NAV total return, operating expense ratio, the lien map and maturity buckets, and
    `disclosedOnly()` for the figures a filer states but nothing here computes. Loaded three ways, as metrics.js is:
    browser `<script>` → `window.RTCredit`, `require()` from `scripts/lib/bdc-concepts.mjs`, `require()` from the
    tests. `CREDIT_VERSION` is defined here and bumped whenever a formula here changes; the full statement of where it
    travels is under **Parity machinery** below, and that is the one place to update on a bump. Same conventions as
    ratios.js: null never zero, fractions not percents, quarterly flows ×4.
  - `pc-series.js` → `RTPcSeries` — the browser reader for the ingested PitchBook and LCD series. Static files only
    (`BASE = "data/pc/"`), no endpoint: `series-index.json`, `series/<group>.json` per group asked for,
    `restatements.json` and `series-provenance.json`. Knows the point shape (`p` period end, `g` grain, `v` value in
    the key's unit, `c` bucket, vintage/edition/page provenance) and the rule that rolling, window and year-to-date
    points are never summed with quarters or years. Distinct from `scripts/lib/pc-series.mjs`, which is the builder.
  - `credit-terms.js` → `RTTerms` — **generated**, not hand-written: `scripts/build-credit-terms.mjs` writes it from
    `frontend/data/pc/glossary.json` (299 terms, glossary dated 2026-09-11). Carries only the hover fields (term,
    expansion, kind, side, popup, source, aliases); `definition` and the maintenance notes stay in the JSON, which the
    Glossary view fetches. `VERSION` is the glossary's own `generated` date, never the clock, so re-running on an
    unchanged glossary produces no diff. Edit the JSON and re-run; do not edit the output.
  - `metric-catalog.js` — definition/interpretation/watch text per ratios.js key (tooltip can't drift from formula).
  - `strategy.js` — cross-sectional layer over the panel (concentration labeled an upper bound, share-of-covered-revenue
    caveat); firm profitability delegated to ratios.js via a period adapter.

## Parity machinery

`DEFINITIONS_VERSION = 2` lives in `frontend/lib/metrics.js`, is stamped into every `company-*.js` and
`quality-report.json`, and is mirrored by `v_definitions_version` in `sql/06_canonical_views.sql`;
`scripts/verify-parity.mjs` fails when the two disagree and, with database credentials, when the SQL views' output
disagrees with metrics.js. In-repo consistency is enforced by single-source modules (concepts.mjs, panel-row.mjs,
sic-map.mjs, metrics.js, ratios.js) after repeated copy-drift incidents, and by smoke.mjs exercising the live handler
paths that a builder-output parity check never touched.

The credit layer has the same machinery under its own version: `CREDIT_VERSION` ("1.1.0") lives in `frontend/lib/credit.js`,
is re-exported by `scripts/lib/bdc-composite.mjs`, is stamped into `composite.json` by `refresh-bdc.mjs`, is read
back by the page, and is pinned by `scripts/test-credit-ratios.mjs` — so a published composite can always be told
apart from one computed under an older definition. `frontend/lib/credit.js` is the single definition the browser,
`bdc-concepts.mjs` and the tests all load, exactly as metrics.js is.

## How to run things

- Tests: the offline suites are listed in full in the `scripts/` section above (test-valuation, test-interim, the
  parse loop from smoke.yml, and the credit terminal's own twenty-odd suites) — run them from there rather than from
  a short list here, which is how this bullet went stale. Live-only, needs real SEC egress (SEC 403s proxies):
  `node scripts/smoke.mjs` and `node scripts/test-bdc-pull.mjs`.
- Refresh and parity: `node scripts/refresh.mjs [--ticker T | --limit N]`, `node scripts/verify-parity.mjs`; then apply
  the sync SQL to the local MySQL and refresh Power BI (docs/PIPELINE.md, "Running it by hand").
- Builders: `node scripts/build-segments.mjs [--ticker T] [--limit N]`, `node scripts/build-risks.mjs`,
  `node scripts/build-strategy-panel.mjs [--limit N]`, `node scripts/build-industry-map.mjs`, then
  `node scripts/chunk-data.mjs` (offline).
- Credit-layer builders: `node scripts/refresh-bdc.mjs [--ticker T] [--limit N] [--out DIR]`,
  `node scripts/build-bdc-terms.mjs [--out FILE] [--offline]`, `node scripts/build-underwriting-panel.mjs` — all three
  need SEC egress. Offline: `node scripts/ingest-pc.mjs` (needs the gitignored `data-sources/` tree; run on the
  owner's machine, it has no step in any workflow) and `node scripts/build-credit-terms.mjs` after editing
  `frontend/data/pc/glossary.json`.
- Rebuilding the credit layer without a terminal: `credit.html#owner` → the Owner button → "Rebuild the credit layer",
  which dispatches `weekly-refresh.yml` with `layer: bdc` or `all` through `/api/rebuild`. Needs `GITHUB_DISPATCH_TOKEN`
  and `REBUILD_SECRET` set on the deployment; without both it answers "rebuild is not configured" and does nothing.
- Loaders (Python, local MySQL): `loaders/run_loader.bat` or `python loaders/<step>.py`;
  `python frontend/export_dashboard_data.py` for the search index and coverage files.
- Dev: `cd frontend && npm run dev` (no install needed).
