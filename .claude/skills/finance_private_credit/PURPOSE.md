# Purpose

Keep the Private Credit Terminal in NXO1759-ai/PowerBI - the listed-BDC data leg, the underwriting panel, the Lenders scorecard and drill-down, the PitchBook/LCD ingest and the credit-layer serverless routes - publishing only figures that carry their filing period, their source and, where a figure cannot be computed, the stated reason it is absent rather than a zero.

## Origin
Seeded 22 Sep 2026 from PRs #41 through #51 in NXO1759-ai/PowerBI and the private-credit dashboard blueprint.

## Patterns Addressed
- holdings-gate-refuses-rather-than-guesses: a schedule that does not reconcile within 0.5% of the tagged totals gets no holdings file, and the page says "not yet parsed".
- absent-is-not-zero: every uncomputable figure is null with a reason string; "not disclosed", "not yet parsed" and a deployment gap are three different statements.
- cross-period-ratio: mark, leverage and dividend coverage are refused when their inputs come from different filing periods (`periodMismatch`).
- debt-total-trust-gate: `add()` zero-fills a missing leg, so a one-leg "total" is not published as a total.
- sector-ladder-exclusion: the S&P corporate financial-risk matrix does not apply to financials, real estate or utilities, and the gate must actually be wired to the caller.
- lifetime-vs-one-year-lease: a twelve-month denominator never takes the filer's whole remaining lease schedule.
- live-pull-serves-the-series-not-the-period: a frames-merged period alone leaves most concepts null.
- composite-states-its-n: no pooled figure is printed without the n it was computed over.
- named-rate-limit-bucket: an endpoint spending SEC, FRED or GitHub calls passes a `name` to `gate()` rather than sharing the unnamed bucket.
- servers-own-sentence: the owner rebuild control renders the endpoint's own error wording verbatim, never a paraphrase that can drift.
- content-identified-not-numbered: an ingested chart is matched by heading, series, grain and axis format, never by chart number.
- hidden-export-table-overflow: a visually-hidden export table must be wrapped in a block-level element or it sets the page width.

## Evolution History
- v0 (seed, 22 Sep 2026): covers the page and its four views, the BDC data leg, the underwriting panel, the Lenders scorecard and drill-down, the serverless layer and owner rebuild, and the copy rules; not yet validated by the WikiSkill loop.
