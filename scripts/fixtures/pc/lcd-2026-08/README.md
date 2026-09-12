# LCD Private Credit Monitor, August 2026 — the test cut

`august-2026-us-private-credit-monitor.cut.pptx` is a cut of the August 2026
PitchBook LCD US Private Credit Monitor, read by `scripts/test-pc-deck.mjs`.
It is a real zip (27 members, 51 KB; 123 KB of members) rebuilt with
`scripts/lib/zip-read.mjs`'s writer from the download in
`data-sources/lcd/2026-09-10/`, which is not committed.

Rebuild it with `node scripts/fixtures/pc/lcd-2026-08/build-cut.mjs [deck]`.
Two builds of the same deck are byte-identical.

## What is kept

Six slides, by presentation position in the deck:

| cut position | deck slide | part | carries |
|---|---|---|---|
| 1 | 1 | slide1.xml | the cover: "Private Credit Monitor" / "August 2026" (the edition) |
| 2 | 4 | slide4.xml, chart1.xml, drawing1.xml | deal count and volume, quarterly; the "Last 3 Months" count of 200 in the `formatCode` attribute form |
| 3 | 15 | slide15.xml, chart11.xml | BSL vs direct lending LBO spread, annual; shares heading, series and sheet with chart12 but has its own cache |
| 4 | 33 | slide33.xml, chart27.xml | BDC all-in rate; the `#REF!` series; a headline placeholder with no box; the source line in "TextBox 1" |
| 5 | 37 | slide37.xml, chart30.xml, drawing21.xml | CLO issuance; the value axes are chart1's reversed (volume on `"$"0`, count on `General`) |
| 6 | 40 | slide40.xml, image6.emf | the BSL-takeout deal table as an EMF picture |

Plus each slide's and chart's `.rels`, `ppt/presentation.xml` with only the
six `sldId`s, `ppt/_rels/presentation.xml.rels` with only the six slides,
`[Content_Types].xml` with only the parts present, and `docProps/core.xml`
with its dates and title (the two personal-name elements are blanked; the
reader never uses them). Nothing inside a slide, chart or drawing part is
edited. The XML members are deflated, the EMF and `[Content_Types].xml`
stored, so the reader's two paths both run.

## What is not kept

Slide layouts, masters, themes, notes, the 31 embedded workbooks, the PNGs
and the thumbnail: the reader does not open them. The cut is not meant to
open in PowerPoint.
