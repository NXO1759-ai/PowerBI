# Research Terminal — SOTA upgrade plan (2026-08-27)

Surface audited: the Company Overview dashboard (`frontend/` — the only live
surface at chineduokeke.mba). Governing system: the `--kimi-*` token set in
`frontend/styles.css` (the file's own header promises token-driven component
CSS), plus WCAG 2.1 AA and the hand-built-SVG chart convention in
`frontend/app.js`.

## Direction (decided before code)

Surface class: **product surface** — an analyst mid-read. Clarity first; the
identity (dense light terminal body, ink-black topbar, gold brand) already
exists and is kept.

1. **Palette** — ground `#f6f7f9`/`#ffffff`; ink `#1b1d21` with muted text
   darkened to `#6b6d75` for AA; signature **terminal gold**, one hue at two
   luminances by ground (`#f5c518` on ink, `#c07a08` on light — the chart's
   price line); interactive controls unify on **ink** (`#151515`), with blue
   `#2f5fd0` retained only as the focus/selection color. Status set unchanged
   (`#177a47` / `#c07a08` / `#c0392b`).
2. **Type** — Inter, actually loaded (400/500/600, `display=swap`); it is the
   face the token system already names. Hierarchy by weight, not size; the
   compact step scale (11 → 34) and tabular numerals stay — density is the
   typographic identity.
3. **Layout** — unchanged structure; the grid encodes the analyst's reading
   order: identity → solvency headline (KPIs) → market tape (chart) →
   statements (left) vs judgment (right). Grouping and explainer lines make
   that order legible; no re-architecture.
4. **Signature** — the **terminal readout**: a crosshair tooltip on the price
   chart styled like the brand chip (ink chip, gold price figure, mono
   numerals). Gold appears only where the market speaks: brand mark, active
   tab, price line, spike tags, readout.

## Findings (ranked) → changes

### Broken

1. **Muted-text contrast fails AA.** `styles.css:12` `--kimi-color-text-tertiary:
   #8a8b92` = 3.4:1 on white — used for every KPI label, table header, hero
   fact label and axis label at 11px. `#b7b8bf` (quaternary) styles `.na`
   data cells at ~2.2:1. Victim: the labels that name every number are the
   least legible text on the page. → Tertiary becomes `#6b6d75` (≈5:1);
   `.na` and the input placeholder move to tertiary; quaternary remains for
   the decorative `·` separators only. `.nav-tab.soon` alpha raised.
2. **Zero-based price axis flattens the line.** `app.js:224` `pTop = maxP *
   1.08` with `Y()` mapped from $0. KBLB's 30-day closes ($0.065–0.090)
   occupy the top quarter of the plot; for a mega-cap the line is a flat
   band. Victim: the trend shape — the chart's purpose — is illegible. →
   Price axis fits min–max with 8% padding (floor at 0); value-traded bars
   stay zero-based on the shared grid.
3. **About dialog never receives focus.** `app.js:1060-1070` opens the modal
   without moving focus, trapping Tab, or restoring focus on close (WCAG
   2.4.3). → Standard dialog focus management.
4. **Combobox options are silent.** `index.html:38` declares
   `role="combobox"` but active-option state never reaches
   `aria-activedescendant`, so arrow-key movement announces nothing (WCAG
   4.1.2). → Option ids + `aria-activedescendant` + `aria-autocomplete`.

### Inconsistent (vs the token contract in styles.css:1-5)

5. **Four accent voices, mostly hard-coded.** Brand gold `#f5c518`
   (styles.css:53,63,259,302), chart amber `#c07a08` (app.js:30), button ink
   `#151515` (styles.css:247,328), token blue `#2f5fd0` (coverage button,
   segmented control). → Tokenized under the palette above; buttons and the
   active segment unify on ink; blue = focus/selection only.
6. **Inter is declared but never loaded** (`styles.css:7`; no link/@font-face
   anywhere) — every visitor silently gets a different fallback. → Load it.
7. **Table headers lack `scope`** (`app.js:76`). → `scope="col"`.

### Unpolished

8. **No favicon, no meta description, no OG/Twitter card** — sharing the
   domain produces a blank card and a default tab icon. → SVG gold-chip
   favicon + full social meta.
9. **Days to Liquidate is a 9-row wall** repeating "@ N% Participation" with
   no definition. → Rows grouped under participation subheads + one-line
   explainer; same hint treatment for Burn Rate.
10. **"Monthly Burn" shows a positive inflow as unsigned "burn".** → Label
    flips to "Monthly Net Cash" with an explicit `+` when positive.
11. **6-month date labels rotate 90° into 100-label dust** (`app.js:214`).
    → Horizontal labels thinned to fit with tick marks.
12. **No hover readout on the chart** — exact values are unreadable. → The
    signature crosshair readout (pointer + touch; the SVG keeps its
    aria-label summary for AT).
13. **No deep links, static title** — every shared link lands on KBLB. →
    `?t=TICKER` URL state (push/pop), per-company `document.title`.
14. **Search lacks the standard shortcut.** → `/` and Ctrl/⌘K focus it; a
    `kbd` hint chip shows in the field.
15. **About modal ships placeholder filler** ("The owner's story goes
    here."). → Honest project description drawn from the repo (EDGAR → Postgres
    → Power BI/web pipeline); personal story left for the owner.

### Deliberately left alone

- Light-only theme — the stylesheet header records "light, clean,
  professional" as a v2 decision; not inverted, not extended.
- Black value-traded bars — a recorded deliberate choice (commit 07d5c5d).
- Dense 12.5px tables, hand-built SVG charting (no chart library), the
  static-export data architecture, and all `api/`/loader behavior.
- Power BI project files (`*.Report`, `*.SemanticModel`) — upstream artifacts.

## Phase 2 addendum — full dark terminal (owner-directed)

After phase 1 shipped to the PR, the owner directed a full redesign: "change
the entire UI to SOTA level … don't just rely on what's there already." That
overrides phase 1's identity-preservation constraint. Decisions:

- **One designed theme: dark.** The brand was already gold-on-ink; the light
  body was the compromise. Ground `#0f1114`, cards `#16181c`, text scale
  `#e8eaed/#b6bac2/#8b8f98` (all ≥4.5:1), hairlines as white alphas.
  A single committed theme is deliberate — recorded here, not an oversight.
- **Gold becomes the accent everywhere; blue is retired.** Focus rings,
  active states, selection, covered-ticker markers: gold. Positive/negative
  stay mint `#5ecb8f` / coral `#ff8a80` (tuned for dark, ≥4.5:1).
- **Command bar**: search moves into a sticky, blurred topbar — the page-title
  row is gone; the company name is the `h1`. Mobile stacks brand/About,
  scrollable tabs, full-width search.
- **Instrument voice**: JetBrains Mono for the hero price, KPI values, chart
  text, tickers, and the readout chip. Inter carries prose and tables.
- **Chart on ink**: gold price line (10.8:1), graphite bars `#6b6f78`
  (3.5:1 — passes non-text contrast), faint white gridlines, gold-edged
  readout chip.
- **Motion budget** (per ui-motion): loading pulse only, reduced-motion
  guarded. Hovers, toggles, the readout, and the dialog are instant on
  purpose. The live-quote indicator is a static dot, not a pulse.
- Section headers and table headers become uppercase micro-eyebrows —
  the same voice as the liquidation group rows.

## Verification

`node frontend/dev-server.js` → http://127.0.0.1:7100. Check at 1280px and
375px: KPI labels legible; price line uses most of the plot height at both
ranges; hover shows the readout chip and it clamps at edges; Tab into About
dialog cycles inside it and Esc restores focus to the button; `/` focuses
search from anywhere; arrow keys move the highlighted option and NVDA/VO
announce it; `?t=AAPL` loads Apple directly and Back returns to the prior
company; liquidation table shows three labeled groups; Lighthouse a11y
contrast check passes.
