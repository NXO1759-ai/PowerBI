/**
 * /api/analysis.js — Vercel serverless function.
 *
 * DeepSeek-powered analyst opinion for the Company Overview dashboard.
 * The frontend POSTs evidence it already has (fundamentals snapshot,
 * top value-traded days, 6 months of headlines, analyst consensus);
 * DeepSeek writes the analysis strictly from that evidence and matches
 * headlines to value-traded spike days. Keys never reach the browser.
 *
 *   POST /api/analysis   { ticker, name, industry, period, fundamentals,
 *                          spikes, news, consensus }
 *
 * Requires DEEPSEEK_API_KEY in the Vercel environment.
 */

import { gate } from "../scripts/lib/ratelimit.mjs";
export const maxDuration = 60;

const MODEL = "deepseek-chat";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h per ticker per warm instance
const cache = globalThis.__analysisCache ||
  (globalThis.__analysisCache = new Map());

const money = (v) => {
  if (v === null || v === undefined || isNaN(v)) return "n/a";
  const neg = v < 0, a = Math.abs(v);
  const s = a >= 1e12 ? (a / 1e12).toFixed(2) + "T"
    : a >= 1e9 ? (a / 1e9).toFixed(2) + "B"
    : a >= 1e6 ? (a / 1e6).toFixed(2) + "M"
    : a >= 1e3 ? (a / 1e3).toFixed(1) + "K" : String(a.toFixed(2));
  return (neg ? "-$" : "$") + s;
};

function buildPrompt(body) {
  const newsList = (body.news || []).slice(0, 120)
    .map((n, i) => `${i}. [${n.date || "?"}] ` +
      `${String(n.title || "").slice(0, 160)} (${n.source || "?"})`)
    .join("\n");
  const spikes = (body.spikes || []).map((s) =>
    `- ${s.date}: value traded ${money(s.valueTradedUsd)}, ` +
    `${s.volumeShares ? s.volumeShares.toLocaleString("en-US") + " shares" : "volume n/a"}` +
    (s.dayChangePct != null ? `, day move ${s.dayChangePct.toFixed(1)}%` : "") +
    (s.volumeVs20DayAvg != null ? `, ${s.volumeVs20DayAvg.toFixed(1)}x the 20-day avg volume` : "")
  ).join("\n");
  const f = body.fundamentals || {};
  const cons = body.consensus;
  const filing = body.latestFiling && body.latestFiling.form
    ? `${body.latestFiling.form} filed ${body.latestFiling.date || "date unknown"}`
    : null;
  const filingAgeDays = body.latestFiling && body.latestFiling.date
    ? (Date.now() - new Date(body.latestFiling.date + "T00:00:00Z").getTime()) / 864e5
    : null;

  /* Persona + rules are the canonical prompt owned by the
     analyst-opinion-prompt skill — keep the two in sync.

     Two standards run at once and neither yields to the other:
     CFA-level rigour in the ANALYSIS (materiality, variance
     decomposition, basis points on margins, fact separated from
     inference), and plain-English clarity in the PROSE, pitched so a
     finance graduate reads it once and follows it. Rigour is in the
     thinking; difficulty is not a feature of the writing. */
  const system =
    "You are a veteran analyst writing the 'Analyst Notes & News' panel " +
    "of a company-overview dashboard. Your career: 7 years as a financial " +
    "analyst (fundamental modeling, SEC filing forensics), 5 years as an " +
    "investment banking associate across industries (capital structure, " +
    "financing instruments, deal execution), and 15 years as VP of Credit " +
    "Underwriting (cash-flow-first credit analysis: liquidity, solvency, " +
    "burn, sources & uses). You write like a credit committee memo: " +
    "direct, plain, every claim tied to evidence.\n\n" +

    "ANALYTICAL STANDARD (how you think — CFA level):\n" +
    "A. Lead each block with the conclusion, then the evidence for it. " +
    "Never narrate your reasoning before stating what it means.\n" +
    "B. Quantify every claim. A change gets both its dollar amount and " +
    "its percentage. Margins and ratios move in basis points (1bp = " +
    "0.01 percentage point), never 'percent of a percent'.\n" +
    "C. Apply materiality before calling anything significant: for a line " +
    "item above $10M, material means a move of $500K or 5%; between $1M " +
    "and $10M, $100K or 10%; below $1M, $50K or 15%. Say when a move is " +
    "immaterial rather than dressing it up.\n" +
    "D. Decompose a variance into its drivers where the evidence allows: " +
    "volume versus price, mix, one-time versus recurring, and timing " +
    "shifts between periods. State which driver dominates.\n" +
    "E. Distinguish a run-rate change from a one-off. A financing inflow " +
    "is not operating improvement; a quarter flattered by timing is not a " +
    "trend. Say which you are looking at.\n" +
    "F. Separate fact from inference explicitly. Figures from the filing " +
    "are facts. Anything you conclude beyond them is an inference and must " +
    "read as one ('this suggests', 'consistent with'). Never present an " +
    "inference in the voice of a reported number.\n" +
    "G. Cash flow outranks earnings. Reconcile the two when they " +
    "disagree, and say what the gap is.\n\n" +

    "WRITING STANDARD (how it reads — a finance graduate, first pass):\n" +
    "H. Short declarative sentences, average under 25 words. Active " +
    "voice. No sentence should need re-reading.\n" +
    "I. Define every technical term in-line the first time it appears, in " +
    "four words or fewer: 'working capital (current assets minus current " +
    "liabilities) fell...'. Terms needing this include working capital, " +
    "burn rate, runway, gross margin, noncontrolling interest, and any " +
    "ratio you cite.\n" +
    "J. No jargon that carries no information: headwinds, tailwinds, " +
    "leverage as a verb, robust, challenging, well-positioned, " +
    "compelling, strategic optionality. Name the thing instead.\n" +
    "K. Spell out what a number means for the business. '$2.89M cash " +
    "against $367K monthly operating burn is roughly 8 months of " +
    "funding' beats either figure alone.\n" +
    "L. No hedging stacks ('may potentially somewhat'). One qualifier " +
    "where the evidence is genuinely uncertain, none where it is not.\n\n" +

    "Rules:\n" +
    "1. Use ONLY the evidence provided below (latest SEC filing metadata, " +
    "fundamentals, top value-traded days, numbered headlines, analyst " +
    "consensus). Never invent events, numbers, or articles.\n" +
    "2. Ground the company direction and financing analysis in the most " +
    "recent SEC filing named in the evidence (10-K, 10-Q, 20-F or 40-F, " +
    "with its filed date). Trace claims to the filing-derived " +
    "fundamentals (cash, " +
    "working capital, equity, revenue, margins, the three cash-flow " +
    "lines, monthly burn).\n" +
    "3. Reply as ONE JSON object with exactly these keys:\n" +
    "   company_needs: object with exactly these string fields, each 3-5 " +
    "sentences. ALL FOUR ARE MANDATORY — never omit, never null —\n" +
    "     company_overview: ONE cohesive narrative combining where the " +
    "company is heading and what it is executing on, per the filing and " +
    "the evidence — write it as a single flowing story, not two parts. " +
    "Open with the single most important fact about the company's " +
    "financial position this period, then what is driving it;\n" +
    "     uses_of_funds: how the company deploys capital, grounded in the " +
    "investing and operating cash-flow evidence. Rank uses by size and " +
    "say which is the largest draw on cash;\n" +
    "     sources_of_funds: where the company's funding comes from, " +
    "grounded in the financing/operating cash-flow evidence (name the " +
    "instrument type where the evidence supports it — equity issuance, " +
    "debt, internally generated cash, etc.). State plainly whether the " +
    "business funds itself from operations or depends on outside capital;\n" +
    "     financing_need: whether the company needs external financing " +
    "given its cash, burn and flows; say so plainly when it does not, " +
    "and size the gap when it does. Show the arithmetic behind any " +
    "runway figure you give (cash divided by monthly operating burn) so " +
    "the reader can follow it, and state the assumption it rests on.\n" +
    "   spike_analysis: array with ONE entry per top value-traded day " +
    "listed below, each {date, observation, drivers, matchedNews} — " +
    "observation is one sentence combining the price move (dayChangePct) " +
    "and the volume/value anomaly (volumeVs20DayAvg); drivers is an " +
    "array of 1-3 short strings explaining the spike using the headlines; " +
    "matchedNews is an array of the INTEGER indices of the headlines (from " +
    "the numbered list) that plausibly relate to that spike, matching by " +
    "date proximity (within ±3 days, favoring same-day or the day " +
    "before) AND by topic. Use an empty array when nothing correlates — " +
    "do not force matches.\n" +
    "   picked_news: array of the 5-8 most investor-relevant headlines " +
    "overall, each {index, relevance} — index is the INTEGER headline " +
    "index, relevance is one sentence of your own explaining why it " +
    "matters. STRICT FILTER: include only items that explain a material " +
    "price/volume move or a filing-level fundamental driver for THIS " +
    "company; exclude generic market roundups, index commentary, and " +
    "articles about other companies that merely mention the ticker. " +
    "Order: items that explain value-traded spikes first.\n" +
    "   caveats: string listing what could NOT be sourced from the " +
    "evidence.\n" +
    "4. Percentages to 1 decimal; money formatted like the evidence " +
    "($1.23B, $45.6M, etc.); margin and ratio changes in basis points.\n" +
    "5. Write only the note itself. No preamble, no meta-commentary about " +
    "the analysis or how it was produced, no mention of models, tools, " +
    "prompts or providers, and no self-reference of any kind. The reader " +
    "sees a research note and nothing else.\n" +
    "6. Never give investment advice or a recommendation to buy, sell or " +
    "hold. Describe the financial position and what drives it; the " +
    "reader draws their own conclusion.";

  const user =
    `Write the panel for ${body.name} (${body.ticker})` +
    (body.industry ? `, industry: ${body.industry}` : "") +
    (body.period ? `. Latest reporting period: ${body.period}.` : ".") + "\n" +
    (filing
      ? `Latest SEC filing: ${filing}. Ground the direction and financing ` +
        `analysis in this filing.\n`
      : "") +
    (filingAgeDays !== null && filingAgeDays > 400
      ? `WARNING: the latest SEC filing (filed ${body.latestFiling.date}) ` +
        "is over a year old — the company may no longer file periodic " +
        "reports with the SEC. Flag the staleness explicitly at the start " +
        "of company_overview and again in caveats; do not present these " +
        "figures as current.\n"
      : "") + "\n" +
    "FUNDAMENTALS (latest quarter vs year-ago where given):\n" +
    `cash=${money(f.cash)} workingCapital=${money(f.workingCapital)} ` +
    `equity=${money(f.equity)}\n` +
    `revenue=${money(f.revenue)} netIncome=${money(f.netIncome)} ` +
    `grossMargin=${f.grossMarginPct != null ? (f.grossMarginPct * 100).toFixed(1) + "%" : "n/a"}\n` +
    `operatingCF=${money(f.cfOps)} investingCF=${money(f.cfInv)} ` +
    `financingCF=${money(f.cfFin)} monthlyBurn=${money(f.monthlyBurn)}\n` +
    `marketCap=${money(body.marketCap)} sharesOutstanding=${body.sharesOutstanding ? (body.sharesOutstanding / 1e9).toFixed(2) + "B" : "n/a"}\n\n` +
    (cons
      ? `ANALYST CONSENSUS (${cons.period || "latest"}): strongBuy=${cons.strongBuy} buy=${cons.buy} hold=${cons.hold} sell=${cons.sell} strongSell=${cons.strongSell}\n\n`
      : "") +
    "TOP VALUE-TRADED DAYS (6-month window):\n" + (spikes || "none") + "\n\n" +
    "HEADLINES (6 months, numbered — cite by index):\n" + (newsList || "none");

  return { system, user };
}

export default async function handler(req, res) {
  /* origin and per-caller rate at the door; the daily budget is charged
     only when a request actually reaches the model */
  { const g = gate(req, { burst: 10, ratePerMin: 4, cost: 0 }); if (g) return res.status(g.status).json(g.body); }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST required" });
  }
  const KEY = process.env.DEEPSEEK_API_KEY;
  if (!KEY) {
    return res.status(503).json({ error: "research notes are unavailable" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const ticker = String((body && body.ticker) || "").toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  if (!ticker) return res.status(400).json({ error: "ticker required" });

  /* The Refresh button sends force:true. It skips the cache READ but
     still writes below, so a forced rewrite becomes the value everyone
     else gets. Without this the button returns the cached note and looks
     like it did nothing. The edge cache is bypassed too. */
  const force = !!(body && body.force);
  const hit = cache.get(ticker);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "s-maxage=900");
    return res.status(200).json(hit.payload);
  }

  const { system, user } = buildPrompt(body);

  /* One DeepSeek call with an abort timeout. company_needs is mandatory
     for the dashboard, so a response without it counts as a failure. */
  async function callDeepSeek(timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`,
                   "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "system", content: system },
                     { role: "user", content: user }],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 4000,
        }),
        signal: ctrl.signal,
      });
      if (!resp.ok) return { error: `upstream error ${resp.status}` };
      const raw = await resp.json();
      const parsed = JSON.parse(raw.choices[0].message.content);
      const cn = parsed && parsed.company_needs;
      const NEED = ["company_overview", "uses_of_funds",
                    "sources_of_funds", "financing_need"];
      if (!cn || NEED.some((k) =>
            typeof cn[k] !== "string" || !cn[k].trim())) {
        return { error: "analysis returned without the mandatory company_needs block" };
      }
      return { payload: parsed };
    } catch (e) {
      return { error: `analysis failed: ${e && e.message ? e.message : "unknown"}` };
    } finally {
      clearTimeout(timer);
    }
  }

  /* Retry once on any failure; two balanced 28s attempts stay inside
     maxDuration (60s) with margin for handler overhead. */
  /* a cache miss is about to spend money: charge the daily budget now */
  { const g = gate(req, { burst: 1e6, ratePerMin: 1e6, dailyCap: 400, cost: 1, sameOrigin: false });
    if (g) { res.setHeader("Cache-Control", "no-store"); return res.status(g.status).json(g.body); } }
  let result = await callDeepSeek(28000);
  if (result.error) result = await callDeepSeek(28000);
  if (result.error) return res.status(502).json({ error: result.error });
  const payload = result.payload;

  /* Map headline indices back to full articles server-side so model
     output cannot mangle titles. */
  const news = Array.isArray(body.news) ? body.news : [];
  const mapIdx = (i) =>
    Number.isInteger(i) && news[i] ? {
      date: news[i].date || null,
      title: news[i].title,
      source: news[i].source || null,
      url: news[i].url || null,
    } : null;

  const spikes = (Array.isArray(payload.spike_analysis)
    ? payload.spike_analysis : []).map((s) => ({
    date: s.date || null,
    observation: s.observation || "",
    drivers: Array.isArray(s.drivers) ? s.drivers : [],
    news: (Array.isArray(s.matchedNews) ? s.matchedNews : [])
      .map(mapIdx).filter(Boolean),
  }));
  const picked = (Array.isArray(payload.picked_news)
    ? payload.picked_news : [])
    .map((p) => {
      const art = mapIdx(p.index);
      return art ? { ...art, relevance: p.relevance || "" } : null;
    })
    .filter(Boolean);

  /* No provider or model identifier is returned: the response reaches the
     browser, so anything named here is visible in the network tab. */
  const out = {
    ticker,
    generatedAt: new Date().toISOString(),
    company_needs: payload.company_needs || null,
    spike_analysis: spikes,
    picked_news: picked,
    caveats: typeof payload.caveats === "string" ? payload.caveats : null,
  };
  cache.set(ticker, { at: Date.now(), payload: out });
  res.setHeader("Cache-Control", force ? "no-store" : "s-maxage=900");
  return res.status(200).json(out);
}
