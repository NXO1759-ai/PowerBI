# Fund Overview fixture, 2026-09-10 export

`fund-overview-cut_2026_09_10_05_03_44.xlsx` is a 28 KB cut of the PitchBook Fund Overview "View All Charts" export downloaded on 10 September 2026 (the 368 KB original lives only in the local, gitignored `data-sources/pitchbook/2026-09-10/`). It is a real zip with stored entries, built by `make-fixture.mjs` with the ingest's own writer, so `readWorkbook` in `scripts/lib/xlsx-read.mjs` runs its production path on it.

## What is kept

| member | why |
|---|---|
| `xl/worksheets/sheet1.xml` — Fundraising Activity | the `$1.35Tn` cells, a ten-year series (rows 10 to 19) |
| `xl/worksheets/sheet4.xml` — Fundraising by Category (#) | the `$303.55B` cells, year by category (rows 10 to 59), the Debt rows |
| `xl/worksheets/sheet9.xml` — Average & Median Time To Close | a tab name truncated to 31 characters with a trailing space; B4 carries the full title; header cells with newlines |
| `xl/worksheets/sheet16.xml` — Sources of Capital | a snapshot table, Tn and B cells |
| `docProps/core.xml` | the export stamp, `dcterms:created` 2026-09-10T17:03:44Z |
| `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `[Content_Types].xml`, `_rels/.rels` | trimmed to the kept parts |
| `xl/sharedStrings.xml` | rebuilt with only the 197 strings the four sheets reference, re-indexed |

Dropped: the other sixteen sheets, styles, themes, the drawings and the logo image, `docProps/app.xml`, and each sheet's `ignoredErrors` block.

## What is changed

One cell. The value beside `Created for:` (H4 on every sheet) is the licensee's name in the export; in the fixture it is the placeholder `licensee name removed from the fixture`. The label stays so the reader's detection of the meta block is exercised. `make-fixture.mjs` refuses to write a cut in which the licensee's name survives, and `scripts/test-pc-workbook.mjs` checks the fixture bytes again when the real export is on disk.

Every other cell is the export's own, and the test proves the four sheets read identically to the export whenever the export is present.

## Rebuilding

```
node scripts/fixtures/pc/pb-fund-overview-2026-09-10/make-fixture.mjs [path/to/export.xlsx]
```

The default source is `data-sources/pitchbook/2026-09-10/PitchBook_Fund_Overview_PitchBook_View_All_Charts_2026_09_10_05_03_44.xlsx`. The cut is deterministic: two runs give the same bytes.
