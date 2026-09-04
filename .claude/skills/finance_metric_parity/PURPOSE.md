# Purpose

Prevent the web app, the MySQL canonical views and the Power BI model in NXO1759-ai/PowerBI from ever showing different numbers for the same metric - the "one definition, four consumers" rule of `docs/PIPELINE.md`, enforced by `scripts/verify-parity.mjs` and `DEFINITIONS_VERSION`.

## Origin
Seeded 3 Sep 2026 from `docs/PIPELINE.md`, `frontend/lib/metrics.js`, `sql/06_canonical_views.sql`, `scripts/verify-parity.mjs`, the "Pipeline coherence" commits and the TMDL fix commits in NXO1759-ai/PowerBI, via `seeds/SOURCES-digest.md` section 3.

## Patterns Addressed
- formula-changed-on-one-side-only: metrics.js edited without the SQL mirror (or vice versa) and verify-parity not run.
- definitions-version-drift: `DEFINITIONS_VERSION` differs between metrics.js and the views.
- tmdl-dax-indentation-parse-error: multi-line DAX not indented below its property; unsupported comment lines.
- inline-formula-outside-metrics: pages, loaders, DAX or prompts recomputing a figure locally.
- sql-applied-and-model-refreshed: applying the views and refreshing Power BI are part of the change, not follow-ups.

## Evolution History
- v0 (seed): covers the six-step formula change, TMDL editing rules and the review checklist; not yet validated by the WikiSkill loop.
- v0.1 (4 Sep 2026): corrected against full repo source (zip of main).
- v0.2 (4 Sep 2026): the v0.1 "parity contract is gone" finding reflected an accidental deletion in PR #37, reverted in PR #40; the SQL views, verify-parity and the TMDL model are on main and the six-step procedure is live again (Procedure E).
