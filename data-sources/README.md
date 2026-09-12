# data-sources

The PitchBook and LCD downloads the Private Credit Terminal is built from, and the hand-keyed report series. The raw files are licensed study material: they stay on the owner's machine, never enter the repository and never reach the served tree. What the ingest derives from them is committed under `frontend/data/pc/`.

## Layout

```
data-sources/
  README.md                       this file (committed)
  manifest.json                   written by the ingest: sha256, bytes, edition, as-of and keys per raw file (committed)
  reports/*.json                  hand-keyed series with page cites, one file per report or report family (committed)
  lcd/<download-date>/*.pptx      the monthly US Private Credit Monitor decks (local only, gitignored)
  pitchbook/<download-date>/*.xlsx  the Fund Overview "View All Charts" exports (local only, gitignored)
```

The folder name is the download date and is the vintage id. The edition is read from inside the file, never from the folder: the deck's cover slide gives the month, `docProps/core.xml` gives the publication stamp, each slide's source line gives its as-of; the workbook's `Downloaded on:` cell and `docProps/core.xml` give its download stamp. Two downloads of the same edition in different folders are two vintages; the later one wins per key and date, and the earlier value is kept in `frontend/data/pc/restatements.json`.

`.gitignore` ignores everything here except `README.md`, `manifest.json` and `reports/*.json`. Check `git status` before staging: a `.pptx` or `.xlsx` must never show as untracked.

## Drop procedure

1. Download the new monitor deck or workbook export.
2. Copy it into the dated folder: `data-sources/lcd/YYYY-MM-DD/` for a deck, `data-sources/pitchbook/YYYY-MM-DD/` for a workbook, using the download date.
3. For a new monitor, add the hand-keyed copy of its two deal tables as `data-sources/reports/lcd-monitor-<edition>-tables.json` (the ingest reads the tables from the deck's EMF pictures itself and checks them against this file; a difference is reported).
4. Run the ingest locally, strict: `node scripts/ingest-pc.mjs --strict`.
   - It prints what matched and how. Zero unmatched charts and sheets is the pass.
   - It refuses, and writes nothing (exit 2), when a source that `manifest.json` records keys for has no file in the tree, when a deck, workbook or report file cannot be read, or when a report file fails validation. An output written without one of its sources would drop that source's keys silently, and nothing is dropped. To retire a source on purpose, remove its entries from `manifest.json` first.
   - An unmatched chart or sheet is written to `frontend/data/pc/ingest-report.json` with its full fingerprint (heading, series names, grain, axis formats, sheet reference, candidates). Nothing is guessed: add the new heading to `headingAliases` of the entry in `scripts/pc-map.json` (any entry of the chart will do), or a new entry for a new chart, and run again. A chart whose heading was reworded but whose series, grain, formats and sheet still agree matches by fallback and is listed under `fallbackMatched` so the alias can be added.
   - A workbook exported under a different filter line is refused for every key of the sheet (`filterMismatch`): the filter line is the population of the series, and a different population is a different series. Update `population` on the entries only if the new export is meant to replace the old population.
   - A chart series whose value axis is on another scale than its key's unit is refused as `unitMismatch` (a percent axis that moved from `0"%"`, percentage points, to `0%`, a fraction, would otherwise serve the cache a hundred times off under the right label). Change the entry's `unit` and `scale` only if the chart really changed what it plots. Two charts, or two sheets, that resolve to one map group are both refused as `duplicateMatch` until the map says which one the keys mean. A match whose axis formats or grain moved while the heading held is listed under `signalMismatch` for reading; it does not fail the build.
   - A key the newest edition of its source did not carry keeps its last points and is served with `stale` (`lastSeenEdition`, the map group it came through, whether that chart or sheet was read). An accumulating key (charts 8, 13–15, 21–26 and the two workbook snapshot sheets) is spared only when its chart or sheet was read and the key rolled off it; when the chart itself went unmatched or was refused, its keys go stale like any other.
5. Run the tests: `node scripts/test-pc-ingest.mjs` (and the reader tests, `test-pc-deck.mjs`, `test-pc-workbook.mjs`, `test-pc-periods.mjs`, `test-pc-reports.mjs`).
6. Commit `frontend/data/pc/`, `data-sources/manifest.json` and `data-sources/reports/`; never the raw file. Ship it as a `feat/` or `fix/` PR like everything else.

The strict ingest runs locally only. GitHub Actions cannot see the raw files, so `.github/workflows/ingest-pc.yml` and `smoke.yml` run the tests against the committed fixture cuts (`scripts/fixtures/pc/`) and the committed report files; the whole-vintage checks in `test-pc-ingest.mjs` print `skip` there and run on the owner's machine. An ingest run on a runner, or in a fresh clone before the downloads are copied in, is refused by the missing-source guard above rather than writing an output without the deck and workbook keys. The tests never rewrite this folder's `manifest.json`: every test run points the ingest's `manifestPath` into a temporary folder.

## What the ingest writes

| file | what |
|---|---|
| `frontend/data/pc/series.json` | every key with its points `{ p, g, v, vintage }` (period end, grain, value, the download that carried it); `start` on year-to-date, rolling and multi-year windows, `c` on snapshot buckets, `edition` on a point kept from an earlier edition than the key's (a point without one is of the key's edition). `g` is one of `quarter`, `half`, `year`, `ytd`, `month`, `asof`, `rolling3m`, `rolling6m`, `rolling12m` (the deck's TTM and the reports' `ttm`), `window` (a multi-year rate) and `label` (a press point with no calendar date) |
| `frontend/data/pc/series/<group>.json` | the same, cut by group (`lcd-dealflow`, `lcd-pricing`, `lcd-bdc`, `pb-capital`, `pb-fund`, `reports`, `press`) for lazy loading |
| `frontend/data/pc/series-index.json` | per source: edition, as-of, published, downloaded, cadence, lag days, next expected, the file and its sha256 (a report source also names the newest document and its own hash under `documentSha256`); per key: label, unit, n, first, last, file, stale |
| `frontend/data/pc/series-provenance.json` | per key: where it was read, the footnote or caveat that rides with it, the cross-checks the ingest ran |
| `frontend/data/pc/restatements.json` | every value a later vintage replaced, with both vintages and editions |
| `frontend/data/pc/tables/<slug>.json` | the deck's two deal tables (one entry per edition) and the workbook's list sheets |
| `frontend/data/pc/ingest-report.json` | what matched, how, and what did not |
| `data-sources/manifest.json` | sha256, bytes, edition and keys per file read; the next run refuses if a source recorded here with keys is absent |

Values are the source's own numbers: a chart share stays the fraction the cache holds (unit `share`), percent points as printed are unit `pct` (chart27's all-in rate, the report and press series; a hand-keyed `%` is served as `pct`, a qualified `% of loans` stays as typed), and workbook money is divided to `$B` or `$M`. The annual deck keys store the chart's own annual cache, and the ingest proves every year equal to the sum of its quarters (`series-provenance.json`, `crossChecks`). The workbook's meta block, which names the licensee, is read for the title, the download date, the filters and the currency and for nothing else; the test proves it reaches no output.
