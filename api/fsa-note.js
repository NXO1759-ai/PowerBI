/**
 * /api/fsa-note.js — Vercel serverless function.
 *
 * The analyst's reading of a set of statements. The client computes
 * every figure deterministically — growth, margin moves, working-capital
 * flags, cash conversion, tax rate, segment mix — and sends them as
 * plain facts; the research model writes the connective analysis a
 * template cannot: which of the facts matter most together, and what an
 * analyst would probe next. It is instructed to use ONLY the figures
 * given, so every number in the note traces back to the filings.
 *
 *   POST /api/fsa-note   { ticker, periodLabel, facts: [..], force? }
 *
 * Requires DEEPSEEK_API_KEY. Notes cache for seven days per
 * ticker+period; a forced refresh rewrites the cached note for everyone.
 */

import { gate } from "../scripts/lib/ratelimit.mjs";
export const maxDuration = 60;

const MODEL = "deepseek-chat";
const cache = globalThis.__fsaNoteCache || (globalThis.__fsaNoteCache = new Map());
const TTL = 7 * 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  /* origin and per-caller rate at the door; the daily budget is charged
     only when a request actually reaches the model, below */
  { const g = gate(req, { burst: 10, ratePerMin: 4, cost: 0 }); if (g) return res.status(g.status).json(g.body); }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const KEY = process.env.DEEPSEEK_API_KEY;
  if (!KEY) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: "not configured" });
  }
  const body = req.body || {};
  const ticker = String(body.ticker || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  const period = String(body.periodLabel || "").slice(0, 60);
  const kind = body.kind === "strategy" ? "strategy" : "statements";
  const facts = Array.isArray(body.facts)
    ? body.facts.map((f) => String(f).slice(0, 400)).slice(0, 40) : [];
  if (!ticker || !period || facts.length < 3) {
    return res.status(400).json({ error: "ticker, periodLabel and facts required" });
  }
  const force = !!body.force;
  const key = kind + "|" + ticker + "|" + period;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL) {
    res.setHeader("Cache-Control", "s-maxage=86400");
    return res.status(200).json(hit.payload);
  }

  const RULES =
    "Rules, all hard: use ONLY the figures provided — never invent, " +
    "estimate or recall a number from anywhere else; never name any AI system, " +
    "model or vendor; write in plain confident prose, no headers, no bullet " +
    "points, no hedging boilerplate. ";
  const system = kind === "strategy"
    ? "You are an equity strategist writing the closing note on a competitive-" +
      "position dashboard for a bright reader with a finance degree but no " +
      "professional training. " + RULES +
      "Structure: exactly three paragraphs. " +
      "First — the position: where this company sits in its arena and WHY, " +
      "arguing from the figures (returns against peers, margin versus turns, " +
      "mix, share) rather than listing them. Second — durability: what the " +
      "figures say protects the position, what is eroding it, and which single " +
      "number is doing the most work in the bull case. Third — the tests: the " +
      "two or three figures whose next readings would confirm or break the " +
      "position, and what each outcome would mean for how the company should " +
      "deploy capital. Respond ONLY as JSON: " +
      '{"note": "<the three paragraphs, separated by \\n\\n>"}'
    : "You are a sell-side analyst writing the reading notes on a set of financial " +
      "statements for a bright reader with a finance degree but no professional " +
      "training. " + RULES +
      "Structure: exactly three paragraphs. " +
      "First — the story of the period: what actually happened to the business, " +
      "connecting the figures rather than listing them. Second — quality and " +
      "durability: whether the reported result is backed by cash and mix, and " +
      "which figure deserves the most scepticism. Third — the watch list: the " +
      "two or three specific figures whose NEXT reading would confirm or break " +
      "the story, and what each would mean. Respond ONLY as JSON: " +
      '{"note": "<the three paragraphs, separated by \\n\\n>"}';
  const user = "Company: " + ticker + ". Period: " + period + ".\nComputed facts:\n- " +
    facts.join("\n- ");

  async function call(timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "system", content: system },
                     { role: "user", content: user }],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 1200,
        }),
        signal: ctrl.signal,
      });
      if (!resp.ok) return { error: "upstream " + resp.status };
      const raw = await resp.json();
      const parsed = JSON.parse(raw.choices[0].message.content);
      if (!parsed || typeof parsed.note !== "string" || parsed.note.trim().length < 200) {
        return { error: "note came back empty" };
      }
      return { payload: { note: parsed.note.trim(),
        writtenAt: new Date().toISOString().slice(0, 19) } };
    } catch (e) {
      return { error: String(e && e.message || e) };
    } finally {
      clearTimeout(timer);
    }
  }

  /* a cache miss is about to spend money: charge the daily budget now */
  { const g = gate(req, { burst: 1e6, ratePerMin: 1e6, dailyCap: 400, cost: 1, sameOrigin: false });
    if (g) { res.setHeader("Cache-Control", "no-store"); return res.status(g.status).json(g.body); } }
  let out = await call(40000);
  if (out.error) out = await call(40000);
  if (out.error) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: out.error });
  }
  cache.set(key, { at: Date.now(), payload: out.payload });
  res.setHeader("Cache-Control", force ? "no-store" : "s-maxage=86400");
  return res.status(200).json(out.payload);
}
