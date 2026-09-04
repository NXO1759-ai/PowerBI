---
name: finance_analysis_features
description: Use when building or changing analysis features in the NXO1759-ai/PowerBI frontend or serverless api/ - FSA reformulation and DuPont, strategy and valuation pages, peer sets, Item 1A risk registers, spike-matched news, the live DeepSeek analyst notes and their rate gate - and when following the dark-terminal UI conventions (v3/v4).
---
# Finance analysis features

## When to Apply
- Work in `frontend/` pages or the serverless `api/` routes that display or derive analysis: FSA dashboard (#16), strategy dashboard (#18), company case (#19), segment revenue (#22), risk registers (#27), peers/macro/cycle dial (#24/#25), valuation (#32/#35/#36).
- Editing `api/analysis.js`, `api/fsa-note.js`, `api/market.js`, `api/panel.js`, `api/valuation.js`, `api/macro.js`, `scripts/lib/peer-hints.mjs`, `scripts/lib/ratelimit.mjs`, or the insight / news rendering.
- Adding a chart, table, modal, combobox or deep link to the terminal UI, or a new model-backed endpoint.
- Symptoms: an insight reads as opinion with no filing evidence; unrelated headlines appear; a DCF implies perpetual growth above the economy's; a page is heavy, fails AA contrast or breaks mobile nav; the About modal owner bio is missing.

## When NOT to Apply
- Raw fact loading, dedupe, the NCI tie, staleness logic -> `finance_sec_edgar_pipeline`.
- Defining or changing a metric formula -> `finance_metric_parity` (every derived figure comes from the single-source modules).

## Instructions
Reference: see _references/powerbi-code-map.md for the current route/API/workflow map.

House facts:
- The production origin is **www.chineduokeke.mba** (`scripts/lib/ratelimit.mjs` ALLOWED_ORIGINS; `frontend/strategy.js` API_BASE handles localhost dev), not power-bi-weld.vercel.app.
- SECURITY NOTE (do not copy the value anywhere): `api/macro.js` contains a hardcoded fallback FRED API key with a comment saying it is acceptable only while the repo is private and must be rotated to `FRED_API_KEY` before the repo goes public. Any "make repo public" or hardening task must include that rotation.

### Procedure A - ground every feature in the data contract
1. Read reported figures from `frontend/data/company-*.js` and derived values from `frontend/lib/metrics.js` / `ratios.js` / `valuation.js`. Never recompute a ratio in a page; a new derived value goes through `finance_metric_parity` first.
2. Reformulated statements, the three DuPont decompositions, multi-period statements (#16) and cash flow for every quarter (#33) already exist - extend them; do not fork a second statement builder.
3. Segment / product / geographic revenue is read from filings (#22); live filing detail goes through the SEC-backed `api/` routes (each with its own 125ms pace lane and warm cache) - reuse those routes rather than calling EDGAR from the browser.
4. Inherit the staleness guard: `isStale` / 400 days in metrics.js, `stale_filing` in `validateCompany` - when the latest filing is 400+ days old the UI shows a banner and the analyst prompt receives a flag; every new view must show the banner too.
5. Page weight is structural: `scripts/chunk-data.mjs` + `frontend/strategy-boot.js` lazy loading turned a 1.7MB monolith into per-industry JSON chunks. Any new data file for the strategy page must be added to the chunker, not loaded monolithically.
6. Cost-bearing endpoints MUST call `gate()` from `scripts/lib/ratelimit.mjs` (origin allowlist www.chineduokeke.mba + vercel previews, per-IP bucket, daily budget charged only on cache misses). A new model-backed endpoint copies this pattern, never invents a new one.

### Procedure B - valuation and strategy rules
1. The decade multiple series comes from Finnhub's annual multiple series in `api/valuation.js` ("back to 2000"); the strategy panel reaches ~19 years - the XBRL mandate limit, "not to 2002" (`scripts/build-strategy-panel.mjs`).
2. Peer sets: `scripts/lib/peer-hints.mjs` holds proxy-statement-derived curated lists (IFRS names kept on purpose). The fallback chain in `api/panel.js` is: curated hint -> exported panel -> DeepSeek peer NOMINATION (names only; every name validated against the SEC registrant file, dropped-with-reason) -> EDGAR SIC browse. Valuation-page comparables use Alford selection in `lib/valuation.js` (SIC widening + size/ROE distance). So "do not auto-pick by industry code" is half-true: SIC is the documented last fallback; curation and Alford ranking sit on top. Extend the chain in order; never let a model invent a peer that skips registrant validation.
3. DCF bound (#36): growth in perpetuity never exceeds the economy's - `TERMINAL_GROWTH` cap 0.04 and `clampTerminalGrowth` in valuation.js, covered by `scripts/test-valuation.mjs`. Clamp the input and display the assumption next to the result.
4. The Industry/Company toggle and the six-block company case (#19) define the strategy layout; new blocks go inside that structure. Macro drill-downs and the cycle dial (#24/#25) are read-only summaries of the macro feeds.

### Procedure C - risk registers and news
1. Risk registers are built from Item 1A and quote the filing's headings VERBATIM (#27, `scripts/build-risks.mjs`) with a failed-extraction fallback: fewer than 5 headings extracted -> show word count + a link instead ("no scoring ... an opinion drawn as data"). Never paraphrase a heading; never add scoring; link each entry to the filing detail view.
2. News: `api/market.js` (Finnhub, with Marketaux fallback) finds the top value-traded days; `api/analysis.js`'s prompt matches headlines to those spike days. Do not loosen the matching to fill an empty panel - empty is correct.
3. Prices come through the market route; price charts use the fitted price axis and crosshair readout from UI v3.

### Procedure D - analyst notes (live DeepSeek, `api/analysis.js` + `api/fsa-note.js`)
1. There is NO stored-insight path: notes are generated live, cached in warm instances (1h / 7d), and rate-gated by `scripts/lib/ratelimit.mjs`. `api/analysis.js` writes the Company Overview note (evidence POSTed by the client); `api/fsa-note.js` writes the statements/strategy note over client-computed facts.
2. Persona: a "veteran analyst" with a 7y FA + 5y IB + 15y VP Credit Underwriting biography, writing "like a credit committee memo" (api/analysis.js system prompt). The credit page itself (`credit.html`) is a placeholder - "The credit view is in build".
3. The prompt contract: CFA-materiality tiers ($10M/$1M thresholds), bps for margins, variance decomposition, fact-vs-inference marking, in-line term definitions, and a banned-jargon list. An insight that cites no filing figure is a defect, not a style choice.
4. Pass the staleness flag into the prompt and require the note to acknowledge it. Keep the output inside what the supplied facts support.

### Procedure E - terminal UI conventions (v3/v4)
1. v4 is a full dark terminal - "the interface becomes the brand": new surfaces are dark, dense and text-first.
2. v3 baseline: fitted price axis, crosshair readout, AA contrast, deep links for every view, accessible dialogs and comboboxes.
3. Mobile nav must work (#17); test any nav change at phone width.
4. Export works dependency-free - `lib/export.js` hand-builds the XLSX; keep it working without adding a library.
5. Default ticker is NVDA (app.js/statements.js/strategy-boot.js state). The About modal owner bio was clobbered by a branch once and restored - check it after every merge or rebase.

### Historical (no longer on main)
- `loaders/09_build_analyst_insight` (the stored DeepSeek insight pipeline) and `loaders/10_load_news` (Marketaux loader) are gone with the whole Python/MySQL leg. The old contract - a stored insight validated for a mandatory `company_needs` field, shown with a status line above a live fallback - no longer exists; `company_needs` appears nowhere in the repo. The grounding lesson survives in Procedure D's prompt contract; do not reintroduce a stored-insight path or the `company_needs` field from old notes.

### Before you finish (verification)
- No new arithmetic on raw concepts outside the single-source modules; `node scripts/test-valuation.mjs` passes (it pins the DCF clamp among others).
- Load NVDA and one stale filer: banner present, prompt flag set, the live note acknowledges staleness and cites filing figures with materiality tiers.
- One company's risk register headings match the Item 1A text verbatim; a failed extraction shows the word-count fallback, not invented risks.
- News panel is empty when no spike matches (not padded with unrelated items).
- Any new cost-bearing endpoint calls `gate()`; its cache means the daily budget is charged only on misses.
- AA contrast passes; a deep link reloads to the same view; mobile nav opens; the dependency-free export still works; About modal still shows the owner bio.

## Known pitfalls (from history)
- Insight reads as ungrounded opinion -> prompt contract now forces CFA-materiality tiers, variance decomposition and fact-vs-inference marking; treat a figure-free note as a failed build. (`company_needs` is historical - do not resurrect it.)
- Unrelated headlines shown -> loose news matching -> spike-day matching between `api/market.js` and the analysis prompt.
- DCF allowed perpetual growth above the economy's -> `TERMINAL_GROWTH` cap 0.04 + `clampTerminalGrowth`, pinned by test (#36).
- Model-invented peers -> DeepSeek nominates NAMES ONLY and every name is validated against the SEC registrant file, dropped-with-reason -> keep the validation when touching the peer chain.
- Strategy page ballooned to 1.7MB -> monolithic data file -> per-industry chunks via `chunk-data.mjs` + lazy `strategy-boot.js`; new files go through the chunker.
- Open cost-bearing endpoint -> model spend exposed to anyone -> `gate()` from `ratelimit.mjs` on every such route.
- Risk register "filled in" when extraction fails -> <5 headings means word count + link, not scoring or paraphrase (`build-risks.mjs`).
- Owner bio vanished from the About modal -> a branch merge clobbered it -> restored; check after merges.
- Mobile navigation broken -> fixed in #17; test at phone width.
- Repo hardcodes a fallback FRED key in `api/macro.js` -> acceptable only while private -> rotate to `FRED_API_KEY` before any public release; never copy the value into other files or docs.
