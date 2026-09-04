# Data Policy — finance_db project

Decided by the project owner on 2026-08-02. All loaders and future
frontend/backend work must follow these rules.

## Source hierarchy

1. **SEC EDGAR is the authority.** Company financial-statement figures
   (10-K / 10-Q line items) are validated against SEC data. If Finnhub
   and SEC disagree on a figure (e.g. 10-K revenue), **SEC supersedes**.
2. **Finnhub is the primary convenience source** for:
   - industry-level research (peer sets, sector comparisons)
   - company financial statements when SEC data is missing or
     unreachable for that company
3. API keys live ONLY in `loaders/db_config.json` (gitignored).
   Never commit keys.

## Data rules

- Rolling 6-year window: loaders keep fiscal_year >= current_year − 6
  and delete older rows on every run.
- One row per (company, concept, unit, fiscal year, period):
  current period only, latest filing wins.
- companies.in_fact_universe = 1 controls which companies get facts
  loaded. companies.has_facts records the outcome
  (1 = facts present, 0 = none found, NULL = not attempted).
