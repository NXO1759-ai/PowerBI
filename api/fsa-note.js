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
 *   POST /api/fsa-note   { kind?, ticker, periodLabel, facts: [..], force? }
 *
 * kind picks the voice (PROMPTS below): "statements" (the default),
 * "strategy", "credit" (the Private Credit Terminal's Market view,
 * posted with ticker "PCMARKET" and the facts drawn on the view) and
 * "bdc" (one listed business development company, the Lenders view).
 * The two credit kinds write in the credit-committee voice from the
 * facts posted and nothing else, and are signed "the research model".
 *
 * Requires DEEPSEEK_API_KEY. Notes cache for seven days per
 * kind+ticker+period; a forced refresh rewrites the cached note for
 * everyone. The gate at the door and the 503 without a key are the same
 * for every kind.
 */

import { gate } from "../scripts/lib/ratelimit.mjs";
import { jsonSafe } from "../scripts/lib/handler.mjs";
export const maxDuration = 60;

const MODEL = "deepseek-chat";
const cache = globalThis.__fsaNoteCache || (globalThis.__fsaNoteCache = new Map());
const TTL = 7 * 24 * 60 * 60 * 1000;

const RULES =
  "Rules, all hard: use ONLY the figures provided — never invent, " +
  "estimate or recall a number from anywhere else; never name any AI system, " +
  "model or vendor; write in plain confident prose, no headers, no bullet " +
  "points, no hedging boilerplate. ";
const JSON_SHAPE = 'Respond ONLY as JSON: {"note": "<the three paragraphs, separated by \\n\\n>"}';
const SIGNATURE = "— the research model";
const SIGN = "Sign the note on its own final line, after the third paragraph, exactly as: " + SIGNATURE + ". " +
  'Respond ONLY as JSON: {"note": "<the three paragraphs and the signature line, separated by \\n\\n>"}';

/* One system prompt per kind. The credit kinds are written in the
   credit-committee voice and read every level against the percentile,
   regime, prior or population the facts carry; where a PitchBook or LCD
   population meets the site's own composite they compare direction, not
   level. */
export const PROMPTS = {
  statements:
    "You are a sell-side analyst writing the reading notes on a set of financial " +
    "statements for a bright reader with a finance degree but no professional " +
    "training. " + RULES +
    "Structure: exactly three paragraphs. " +
    "First — the story of the period: what actually happened to the business, " +
    "connecting the figures rather than listing them. Second — quality and " +
    "durability: whether the reported result is backed by cash and mix, and " +
    "which figure deserves the most skepticism. Third — the watch list: the " +
    "two or three specific figures whose NEXT reading would confirm or break " +
    "the story, and what each would mean. " + JSON_SHAPE,
  strategy:
    "You are an equity strategist writing the closing note on a competitive-" +
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
    "deploy capital. " + JSON_SHAPE,
  credit:
    "You are the credit officer writing the market note for a private credit " +
    "committee, for a bright reader with a finance degree but no professional " +
    "training. " + RULES +
    "The facts are readings from one dashboard, each with its date or window: " +
    "public credit conditions from FRED read against their own history (a " +
    "percentile over a stated window, a regime from a fixed rule), the spread " +
    "ladder by rating rung, and the newest PitchBook and LCD readings of " +
    "fundraising, dry powder, deployment, deal flow, new-issue spreads and the " +
    "public default proxies, each naming its population and edition. " +
    "Structure: exactly three paragraphs. " +
    "First — where the cycle sits: argue from the conditions and the ladder " +
    "whether credit is cheap or dear and whether banks are retreating or " +
    "competing, reading each level against the percentile or regime given, " +
    "never as a bare number. Second — capital against deals: how much money is " +
    "committed and still uncalled against how fast it is being lent, what the " +
    "direction of new-issue spreads and channel share says about pricing power, " +
    "and which single figure carries the argument; where a PitchBook or LCD " +
    "population meets the site's own composite, compare direction, not level, " +
    "and say so. Third — stress and the tests: which of the default proxies to " +
    "weight and why they differ by definition (never average them), and the two " +
    "or three figures whose next reading would change the committee's stance, " +
    "with what each outcome would mean for underwriting. Every figure you cite " +
    "must appear in the facts with its date or window; name the population when " +
    "the facts name it; a fact stated as provisional, year-to-date or a rolling " +
    "window is read with that qualifier and never summed with a full period. " + SIGN,
  bdc:
    "You are the credit officer writing the committee memo on one listed " +
    "business development company, for a bright reader with a finance degree " +
    "but no professional training. " + RULES +
    "The facts are the company's own filed figures and the site's derived " +
    "readings, each with its period: net asset value and price to NAV, net " +
    "investment income and dividend coverage, asset coverage and its cushion, " +
    "non-accruals at cost and at fair value, PIK share, the mark (fair value " +
    "to cost), leverage, fees and yield, beside the universe's composite and " +
    "the industry series where the facts carry them. " +
    "Structure: exactly three paragraphs. " +
    "First — the book: what the portfolio earns and what it is worth, arguing " +
    "from yield, mark, non-accruals and PIK together rather than listing them, " +
    "and whether the earnings are cash. Second — the balance sheet and the " +
    "dividend: how much room the 1940 Act coverage test leaves, how the " +
    "liabilities are structured, and whether the distribution is covered by net " +
    "investment income or met from spillover, gains or capital. Third — the " +
    "tests: the two or three figures whose next filing would confirm or break " +
    "the reading, and what each would mean for the shares and for the lenders " +
    "to the vehicle. Read every ratio against the peer or composite figure " +
    "given, never against a remembered norm; a figure marked disclosed-only or " +
    "one observation is read as such. " + SIGN,
};
/* the two credit kinds always end on the signature line, whether or not
   the model remembered to write it */
function signed(kind, note) {
  if (kind !== "credit" && kind !== "bdc") return note;
  const t = note.trim();
  if (t.endsWith(SIGNATURE)) return t;
  return t + "\n\n" + SIGNATURE;
}

export default jsonSafe(async function handler(req, res) {
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
  const kind = Object.prototype.hasOwnProperty.call(PROMPTS, body.kind) ? body.kind : "statements";
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

  const system = PROMPTS[kind];
  const subject = kind === "credit" ? "Dashboard" : kind === "bdc" ? "Business development company" : "Company";
  const user = subject + ": " + ticker + ". Period: " + period + ".\nComputed facts:\n- " +
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
      return { payload: { note: signed(kind, parsed.note),
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
}, { name: "note" });
