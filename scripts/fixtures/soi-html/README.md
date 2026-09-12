# Schedule-of-investments fixtures

Cuts of two real filings for `scripts/test-soi-html.mjs`. Nothing in
them is typed by hand: each file is a byte range of the filing with
`style="…"` attributes removed to fit the size cap (the parsers never
read styles) and, for the R page, the page's scripts removed.

## bxsl-10q-2026q2-schedule-cut.htm (188 KB)

Blackstone Secured Lending Fund, Form 10-Q for the quarter ended June
30, 2026, accession 0001736035-26-000016, primary document
`bxsl-20260630.htm` (13.3 MB, fetched 2026-09-10). The document prints
its June 30, 2026 schedule over 34 page tables (10-Q pages 10 to 43)
and its December 31, 2025 comparative over 31 more, every page headed
"Condensed Consolidated Schedule of Investments … (in thousands)".

Kept, in document order:

1. The page heading and page tables 1 and 2 of the June schedule (the
   17th and 18th `<table>` of the document): 50 holdings under "First
   Lien Debt - non-controlled/non-affiliated", industries Aerospace &
   Defense through Commercial Services & Supplies, with the unlabelled
   industry subtotals the filer prints.
2. Page table 9 (the 25th `<table>`): it opens with "First Lien Debt -
   non-controlled/non-affiliated (continued)" and "Health Care
   Providers & Services (continued)" and carries the schedule's first
   non-accrual row, WHCG Purchaser III, Inc. (4)(5)(10)(17). Pages 3
   to 8 are omitted.
3. The June schedule's footnote blocks (1) to (20) as printed after
   its last page: the `<div>` that holds each marker and its body. The
   unfunded-commitment and affiliate tables printed between them are
   omitted. (12), (13) and (20) are plain spans in the filing; the
   others are `ix:footnote` elements.
4. The heading and page table 1 of the December 31, 2025 comparative
   (the 62nd `<table>`), then its footnote blocks (1) and (17), so the
   test can show that a marker resolves against its own schedule's
   block.

## arcc-r9-2026q2-cut.htm (97 KB) and arcc-FilingSummary-2026q2.xml

Ares Capital Corporation, Form 10-Q for the quarter ended June 30,
2026, accession 0001628280-26-050307 (fetched 2026-09-11).
`FilingSummary.xml` is whole. `R9.htm` is the rendered "CONSOLIDATED
SCHEDULE OF INVESTMENTS" (12 MB); the cut keeps the document wrapper,
the report table's header row and the four undimensioned rows above
the first member (amortized cost $29,674.6M, fair value $29,349.3M),
the first two industry-axis blocks (Software and Services, Financial
Services), the first two issuer-name blocks, the first 41
identifier-axis members in the page's order (15484880 Canada Inc.
through AHR Funding Holdings; both the "Issuer | Type N" form of June
2026 and the "Issuer, Type N" form of the December 2025 comparative;
ADG, LLC's second lien loan with the [11] non-accrual marker), and all
twenty `outerFootnote` rows.

## What the test asserts from them

Every figure in `test-soi-html.mjs` is read off these files: the row
is named and the schedule page given. The full-document counts (703
rows adding to the printed Total Investment Portfolio for BXSL; 1,439
positions adding to the tagged totals for ARCC's R page) run only when
`BXSL_10Q_HTML` and `ARCC_R9_HTML` point at the whole documents, which
are not committed.
