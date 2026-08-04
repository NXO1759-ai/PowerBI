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
    .map((n, i) => `${i}. [${n.date || "?"}] ${n.title} (${n.source || "?"})`)
    .join("\n");
  const spikes = (body.spikes || []).map((s) =>
    `- ${s.date}: value traded ${money(s.valueTradedUsd)}, ` +
    `${s.volumeShares ? s.volumeShares.toLocaleString("en-US") + " shares" : "volume n/a"}` +
    (s.dayChangePct != null ? `, day move ${s.dayChangePct.toFixed(1)}%` : "") +
    (s.volumeVs20DayAvg != null ? `, ${s.volumeVs20DayAvg.toFixed(1)}x the 20-day avg volume` : "")
  ).join("\n");
  const f = body.fundamentals || {};
  const cons = body.consensus;

  const system =
    "You are an equity analyst writing the 'Analyst Notes & News' panel " +
    "of a company-overview dashboard. Rules:\n" +
    "1. Use ONLY the evidence provided below (fundamentals, top " +
    "value-traded days, numbered headlines, analyst consensus). Never " +
    "invent events, numbers, or articles.\n" +
    "2. Reply as ONE JSON object with exactly these keys:\n" +
    "   company_needs: object with exactly these string fields —\n" +
    "     general_direction: the company's general direction (2-4 sentences);\n" +
    "     plans: what the company appears to be executing on, based on the " +
    "evidence (2-4 sentences);\n" +
    "     uses_of_funds: how the company deploys capital, grounded in the " +
    "cash-flow evidence (2-4 sentences);\n" +
    "     sources_of_funds: where the company's funding comes from, " +
    "grounded in the financing/operating cash-flow evidence (2-4 sentences);\n" +
    "     financing_need: whether the company needs external financing " +
    "given its cash, burn and flows; say so plainly when it does not " +
    "(2-4 sentences).\n" +
    "   spike_analysis: array with ONE entry per top value-traded day " +
    "listed below, each {date, observation, drivers, matchedNews} — " +
    "observation is one sentence on what happened that day; drivers is an " +
    "array of 1-3 short strings explaining the spike using the headlines; " +
    "matchedNews is an array of the INTEGER indices of the headlines (from " +
    "the numbered list) that plausibly relate to that spike, by date " +
    "proximity and topic. Use an empty array when nothing correlates — do " +
    "not force matches.\n" +
    "   picked_news: array of the most investor-relevant headlines overall " +
    "(5-8 items), each {index, relevance} — index is the INTEGER headline " +
    "index, relevance is one sentence of your own explaining why it " +
    "matters. Order: items that explain value-traded spikes first.\n" +
    "   caveats: string listing what could NOT be sourced from the " +
    "evidence.\n" +
    "3. Percentages to 1 decimal; money formatted like the evidence.\n" +
    "4. Plain, direct analyst language. No hype, no disclaimers about " +
    "being an AI.";

  const user =
    `Write the panel for ${body.name} (${body.ticker})` +
    (body.industry ? `, industry: ${body.industry}` : "") +
    (body.period ? `. Latest reporting period: ${body.period}.` : ".") + "\n\n" +
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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST required" });
  }
  const KEY = process.env.DEEPSEEK_API_KEY;
  if (!KEY) {
    return res.status(503).json({ error: "analysis provider not configured" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const ticker = String((body && body.ticker) || "").toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  if (!ticker) return res.status(400).json({ error: "ticker required" });

  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "s-maxage=900");
    return res.status(200).json(hit.payload);
  }

  const { system, user } = buildPrompt(body);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 50000);
  let payload;
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
    if (!resp.ok) {
      return res.status(502).json({
        error: `analysis provider returned ${resp.status}` });
    }
    const raw = await resp.json();
    payload = JSON.parse(raw.choices[0].message.content);
  } catch (e) {
    return res.status(502).json({
      error: `analysis failed: ${e && e.message ? e.message : "unknown"}` });
  } finally {
    clearTimeout(timer);
  }

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

  const out = {
    ticker,
    generatedAt: new Date().toISOString(),
    model: MODEL,
    company_needs: payload.company_needs || null,
    spike_analysis: spikes,
    picked_news: picked,
    caveats: typeof payload.caveats === "string" ? payload.caveats : null,
  };
  cache.set(ticker, { at: Date.now(), payload: out });
  res.setHeader("Cache-Control", "s-maxage=900");
  return res.status(200).json(out);
}
