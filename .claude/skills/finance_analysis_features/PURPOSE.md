# Purpose

Give a coding agent the product rules behind the NXO1759-ai/PowerBI analysis features - what already exists (FSA, DuPont, strategy, valuation, risk registers, peers, news, the DeepSeek analyst insight), which constraints are non-negotiable (filing-grounded opinion, DCF bound, spike-matched news, staleness banner) and how the dark-terminal UI is expected to look and behave.

## Origin
Seeded 3 Sep 2026 from PowerBI PRs #16, #17, #18, #19, #22, #24-28, #32-36, the UI v3/v4 commits, the analyst-persona rules and the staleness guard, via `seeds/SOURCES-digest.md` section 3.

## Patterns Addressed
- analyst-insight-ungrounded-opinion: the insight must cite filing facts and emit `company_needs`; status shown above live fallback.
- news-not-spike-matched: only headlines matching a detected price spike are shown; empty is correct.
- dcf-terminal-growth-bound: growth in perpetuity never exceeds the economy's (#36).
- item-1a-headings-verbatim: risk-register cross-references quote filing headings exactly (#27).
- derived-figure-outside-metrics: features must read `frontend/lib/metrics.js`, never recompute (hand-off to `finance_metric_parity`).
- about-modal-bio-clobbered: owner bio lost in a branch merge; verify after merges.
- terminal-ui-conventions: v3 (fitted axis, crosshair, AA, deep links, a11y) and v4 full dark terminal.

## Evolution History
- v0 (seed): covers the data contract, valuation/strategy rules, risk and news, the analyst prompt and UI conventions; not yet validated by the WikiSkill loop.
- v0.1 (4 Sep 2026): corrected against full repo source (zip of main).
- v0.2 (4 Sep 2026): the v0.1 claim that the stored-insight path and `loaders/` were gone reflected an accidental deletion in PR #37, reverted in PR #40; Procedure D now describes the live and the stored path as the two sources of the `company_needs` contract.
