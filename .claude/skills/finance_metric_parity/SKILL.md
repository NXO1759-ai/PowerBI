---
name: finance_metric_parity
description: Use whenever a derived financial figure is added or changed in NXO1759-ai/PowerBI, so that every consumer reads it from the single-source modules (frontend/lib/metrics.js, ratios.js, valuation.js, scripts/lib/concepts.mjs and friends) instead of duplicating a formula, with DEFINITIONS_VERSION/FRAMEWORK_VERSION bumped and the offline figure suites passing.
---
# Finance metric parity (single-source derived figures)

## When to Apply
- Editing `frontend/lib/metrics.js`, `frontend/lib/ratios.js`, `frontend/lib/valuation.js`, `scripts/lib/concepts.mjs`, `scripts/lib/panel-row.mjs` or `scripts/lib/sic-map.mjs`.
- Adding a ratio, margin, growth rate, LTM figure, DuPont component, EV or valuation input anywhere in the frontend, the build scripts or the `api/` routes.
- Symptoms: two surfaces show different values for the same metric; `scripts/test-valuation.mjs` fails; a copy of a tag list or formula appears outside the single-source modules.
- Reviewing a PR that adds inline arithmetic on raw concept names in a page or route.
- A new analysis feature (DuPont, valuation, EV, comp sheet) needs a figure that does not exist yet in metrics.js/ratios.js/valuation.js.

## When NOT to Apply
- Loading or cleaning raw facts (dedupe, NCI tie, staleness) -> `finance_sec_edgar_pipeline`.
- Presentation-only changes (chart styling, layout, prompt wording) -> `finance_analysis_features`.

## Instructions
Reference: see _references/powerbi-code-map.md for the current route/API/workflow map.

### Procedure A - the rule: one definition, one module, many importers
1. The single-source discipline is the repo's main defense, applied at these layers - never duplicate any of them:
   - `frontend/lib/metrics.js`: overview derivations and `validateCompany()`; carries `DEFINITIONS_VERSION = 2`, stamped into `company-*.js` / `quality-report.json` as a provenance marker. (Its own header still describes the old SQL/Power BI contract - the comment is stale on main; the module is not.)
   - `frontend/lib/ratios.js`: the whole reformulation/DuPont engine; carries `FRAMEWORK_VERSION = 1`.
   - `frontend/lib/valuation.js`: valuation math (multiples, DCF, comparables).
   - `scripts/lib/concepts.mjs`: the XBRL tag lists - the `api/pull.js` copy drifted once and produced two answers for the same company (documented in both files' comments).
   - `scripts/lib/panel-row.mjs`: the panel field order - "a second copy ... would read revenue out of the cogs column".
   - `scripts/lib/sic-map.mjs`: industry classification.
2. Never compute a derived figure inline in a page, route, script or prompt; import it from the owning module.

### Procedure B - change or add a formula
1. Edit the function in its owning module (metrics.js / ratios.js / valuation.js).
2. Bump the module's version: `DEFINITIONS_VERSION` in metrics.js for definition changes (the refresh stamps it into published data), `FRAMEWORK_VERSION` in ratios.js for the reformulation engine. There is no second side to mirror on main - the version is a provenance marker, not a sync contract.
3. Run the offline figure suites and make them pass: `node scripts/test-valuation.mjs` pins `lib/valuation.js` to the course's worked figures (harmonic mean 16.17, HD implied 61.44, SBUX 129,827.7, CAPM 9.17%, EVA 640, GDP cap 4%); `node scripts/test-interim.mjs` covers the interim parser. If a pinned figure legitimately changes, change the pin in the same PR and say why.
4. When live SEC egress is available, run `node scripts/smoke.mjs` - it asserts live-handler payload shape and ratios, and exists because "a builder-output parity check never touched the ratio layer, which is what let a shape error ship as a 500".
5. Regenerate any affected `frontend/data/company-*.js` through the normal refresh path so published files carry the new version (note the weekly-refresh drift in `finance_sec_edgar_pipeline`); note the version bump in the PR.

### Procedure C - adding a brand-new metric
1. Check the raw concepts it needs are already pulled; if not, add them to `scripts/lib/concepts.mjs` (the ONLY tag list) and run the pull + quality gate (`finance_sec_edgar_pipeline`) before touching metrics.js.
2. Add the function to the owning module following the null and denominator conventions of its neighbours (e.g. how existing ratios treat missing NCI via `bookEquity()`, or zero equity), and expose it so both the browser and the Node scripts can call it.
3. Add or extend a pinned test in `scripts/test-valuation.mjs` when the metric has a course-worked reference figure.
4. Only then add the frontend display (`finance_analysis_features`).

### Procedure D - reviewing someone else's change
1. Reject a PR that adds arithmetic on raw concept names outside the single-source modules, copies a tag list or the panel field order, or changes a formula without the matching version bump.
2. Ask for the offline suite output (`test-valuation.mjs`) in the PR description, and smoke.mjs output when egress allowed it.

### Historical (no longer on main)
- The four-consumer parity contract is gone: `sql/06_canonical_views.sql`, `scripts/verify-parity.mjs` and the Power BI PBIP/TMDL model are not in the tree. The old six-step procedure (mirror the formula into SQL, bump both `DEFINITIONS_VERSION`s, run verify-parity, `mysql -u learn -p finance_db < sql/06_canonical_views.sql`, refresh Power BI, cross-check one ticker web-vs-Power-BI) and the TMDL editing rules (indent multi-line DAX one level below its property; delete unsupported comment lines; reopen the PBIP to prove the model loads) applied to that setup. The incidents were real - a formula changed on one side only, and TMDL parse errors - and the lesson survives as the single-module rule above, but there is no SQL or TMDL side to mirror today. `weekly-refresh.yml` still invokes the deleted verify-parity.mjs (see `finance_sec_edgar_pipeline`).

### Before you finish (verification)
- `grep -n DEFINITIONS_VERSION frontend/lib/metrics.js` shows the bumped value (it is the only file that carries it); `FRAMEWORK_VERSION` bumped if ratios.js changed.
- `node scripts/test-valuation.mjs` and `node scripts/test-interim.mjs` exit 0 on a clean checkout; paste the output in the PR.
- No new inline arithmetic on raw concept names outside the single-source modules; no second copy of a tag list, panel field order or SIC map (grep the diff).
- One ticker's metric matches across every surface that displays it, to displayed precision.

## Known pitfalls (from history)
- Two answers for the same company -> `api/pull.js` kept its own copy of the concept lists and it drifted -> tag lists live only in `scripts/lib/concepts.mjs`; imports, never copies.
- A shape error shipped as a 500 -> the builder-output parity check never touched the ratio layer -> smoke.mjs asserts live-handler payload shape and ratios; run it when egress allows.
- Panel columns silently transposed -> a second copy of the panel field order would read revenue out of the cogs column -> import `panel-row.mjs`.
- Formula edited without a version bump -> published data indistinguishable from old definitions -> bump `DEFINITIONS_VERSION` (metrics.js) / `FRAMEWORK_VERSION` (ratios.js) with the change.
- metrics.js's own header comment describes the retired SQL/Power BI contract -> do not "restore" that contract from the comment; the modules and tests above are the live truth.
- Historical: frontend and Power BI disagreed on a ratio (formula changed in metrics.js only) and TMDL parse errors after DAX edits -> the SQL/TMDL side is gone from main; the surviving rule is one module per definition.
