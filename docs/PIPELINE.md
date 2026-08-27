# The data pipeline

Four surfaces show the same numbers: the website, the on-demand pull, the
MySQL database, and the Power BI model. This describes how they are kept
in agreement, because before this they each computed their own version of
"working capital" and could disagree without anyone noticing.

## One definition, four consumers

```
                    frontend/lib/metrics.js
                  (every derived figure, once)
                              |
        +---------------------+---------------------+
        |                     |                     |
   the browser          /api/pull.js          scripts/refresh.mjs
   (renders KPIs)     (on-demand pull)         (weekly, all 130)
                                                     |
                                          writes both artifacts
                                                     |
                              +----------------------+---------------+
                              |                                      |
                  frontend/data/company-*.js              sql/sync/facts-*.sql
                      (what the site serves)          (applied to MySQL, which
                                                       Power BI reads via views)
```

`frontend/lib/metrics.js` is the single source. It is plain UMD, so the
browser loads it with a `<script>` tag and Node loads the identical file
with `require`. Nothing recomputes a ratio locally.

Power BI cannot import JavaScript, so `sql/06_canonical_views.sql`
restates the same formulas in SQL. Two statements of one definition drift,
so `scripts/verify-parity.mjs` recomputes the views' output in JavaScript
and fails when they disagree. Both files carry a `DEFINITIONS_VERSION`;
changing a formula on one side without the other fails the check.

## The weekly refresh

`.github/workflows/weekly-refresh.yml` runs Sundays at 07:00 UTC, and on
demand from the Actions tab.

It pulls SEC EDGAR directly rather than reading the database, because
`finance_db` lives on localhost and GitHub Actions cannot reach it. The
job needs no dependencies — `refresh.mjs` and `metrics.js` are plain
JavaScript on the standard library, so there is nothing to install and no
Python required.

Each run:

1. pulls the covered universe from SEC EDGAR's `companyconcept` API
2. validates every payload with `validateCompany()`
3. writes `frontend/data/company-*.js` — but skips any company with an
   error-severity finding, keeping the previous file rather than
   publishing a figure known to be wrong
4. writes `frontend/data/quality-report.json`
5. writes `sql/sync/facts-<date>.sql`
6. commits and pushes, which triggers the Vercel deploy

### Bringing MySQL and Power BI in step

The push updates the website. The database is a separate step, because
nothing outside your machine can reach it:

```bash
mysql -u learn -p finance_db < sql/sync/facts-2026-08-27.sql
```

The file is upserts, not inserts, so re-running corrects a restated figure
in place instead of stacking a duplicate. Refresh Power BI afterwards and
all four surfaces match.

## Accuracy

`sql/07_data_quality.sql` defines the checks as views, so the same rule is
readable from the refresh, from Power BI, and by hand:

```sql
SELECT * FROM v_data_quality ORDER BY FIELD(severity,'error','warn');
```

Error-severity findings block publication. Warnings are recorded and
shipped.

The check worth understanding is the balance-sheet tie. Assets must equal
liabilities plus **total** equity, and total equity includes
noncontrolling interest — the share of a consolidated subsidiary the
company does not own. The original loader pulled only
`StockholdersEquity`, which is parent-only, so every company with
part-owned subsidiaries appeared not to balance. Freeport-McMoRan's Q2
2026 sheet is off by $12.11B on parent equity and ties to the dollar with
NCI included. The pull now takes `MinorityInterest` and
`StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest`,
and the views compute `equity_total` from them.

Rows that cannot be judged because NCI was never loaded are reported
separately as `missing_nci` and clear as the refresh backfills them. Drift
that survives *with* NCI present is a genuine tagging error and fails the
run.

## Running it by hand

```bash
node scripts/refresh.mjs --ticker FCX     # one company
node scripts/refresh.mjs --limit 10       # first ten
node scripts/refresh.mjs                  # the whole universe
node scripts/verify-parity.mjs            # SQL vs JavaScript
```

`verify-parity` skips the SQL comparison when it cannot find
`loaders/db_config.json` or a `mysql` client, so it is safe in CI. Point
it elsewhere with `RT_DB_CONFIG` and `RT_MYSQL_BIN`.

## Changing a formula

1. edit `frontend/lib/metrics.js` and bump `DEFINITIONS_VERSION`
2. mirror it in `sql/06_canonical_views.sql` and bump the version there
3. run `node scripts/verify-parity.mjs`
4. apply the SQL and refresh Power BI

Steps 1 and 2 without 3 is the failure this structure exists to prevent.
