/**
 * ratelimit.mjs — a small gate for the endpoints that cost money.
 *
 * The model-backed endpoints are public and unauthenticated, which is
 * right for a research site and wrong for an open door to someone
 * else's bill. Two limits, both in memory per warm instance — enough to
 * blunt a script, not a guarantee against a determined one:
 *
 *   per caller  a token bucket keyed by client address: BURST requests,
 *               refilling at RATE per minute
 *   per day     a global ceiling on calls that reach the paid provider,
 *               reset at UTC midnight
 *
 * Plus a same-origin check: a browser request from the site carries its
 * origin, and a request from anywhere else does not get to spend the
 * model budget. Server-to-server callers (the smoke suite) send no
 * origin and are allowed, since they cannot be a browser hijack.
 *
 * `name` (optional): every call site that omits it keeps sharing one
 * bucket and one daily counter per client address across every endpoint,
 * exactly as before — the original behavior, unchanged. A call site that
 * passes `name` gets its own bucket and its own daily counter, so its
 * burst/ratePerMin/dailyCap mean what they say regardless of what else
 * the same caller does elsewhere on the site. This exists because
 * api/rebuild.js's door (burst 2, 1/min) shared its bucket with the
 * page's own Refresh traffic and with looser public endpoints before a
 * name was threaded through: an owner's own page use could 429 their own
 * rebuild poll, and a caller could refill the rebuild bucket faster by
 * spending a more generous endpoint first. Endpoints that gate real
 * money (SEC/FRED/GitHub calls an unauthenticated caller should not be
 * able to run up) should pass a `name` distinct from every other gated
 * endpoint's.
 */

const buckets = globalThis.__rlBuckets || (globalThis.__rlBuckets = new Map());
const daily = globalThis.__rlDaily || (globalThis.__rlDaily = { day: "", count: 0 });
const dailyByName = globalThis.__rlDailyByName || (globalThis.__rlDailyByName = new Map());

const ALLOWED_ORIGINS = [
  "https://www.chineduokeke.mba",
  "https://chineduokeke.mba",
  "http://localhost:7240", "http://localhost:7241", "http://localhost:7242",
  "http://127.0.0.1:7240", "http://127.0.0.1:7241", "http://127.0.0.1:7242",
];

export function clientKey(req) {
  const h = req.headers || {};
  const fwd = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || String(h["x-real-ip"] || "") || "anon";
}

/**
 * Returns null when the request may proceed, or { status, body } to
 * answer with instead. `cost` counts against the daily ceiling only for
 * requests that will actually reach the paid provider — a cache hit
 * should pass cost 0.
 */
export function gate(req, { burst = 12, ratePerMin = 6, dailyCap = 600, cost = 1, sameOrigin = true, name = null } = {}) {
  const h = req.headers || {};
  const origin = String(h.origin || "");
  const referer = String(h.referer || "");
  if (sameOrigin && (origin || referer)) {
    const src = origin || referer;
    const ok = ALLOWED_ORIGINS.some((o) => src === o || src.startsWith(o + "/"));
    /* Vercel preview deployments carry their own origins; allow them */
    const preview = /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin) ||
      /^https:\/\/[a-z0-9-]+\.vercel\.app\//.test(referer);
    if (!ok && !preview) {
      return { status: 403, body: { error: "this endpoint serves the research terminal only" } };
    }
  }
  const now = Date.now();
  /* an unnamed call keeps the original shared-bucket key, byte for byte,
     so every existing call site's behavior is unchanged */
  const key = name ? `${name}|${clientKey(req)}` : clientKey(req);
  let b = buckets.get(key);
  if (!b) { b = { tokens: burst, at: now }; buckets.set(key, b); }
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 60000) * ratePerMin);
  b.at = now;
  if (b.tokens < 1) {
    return { status: 429, body: { error: "too many requests — try again in a minute" } };
  }
  b.tokens -= 1;
  if (cost > 0) {
    const day = new Date().toISOString().slice(0, 10);
    /* a named caller gets its own daily counter, so a tight budget (e.g.
       a companyfacts pull's) cannot be spent by a looser endpoint's
       traffic, and vice versa; an unnamed caller keeps the one global
       counter every pre-existing call site already shares */
    let d;
    if (name) {
      d = dailyByName.get(name);
      if (!d) { d = { day: "", count: 0 }; dailyByName.set(name, d); }
    } else {
      d = daily;
    }
    if (d.day !== day) { d.day = day; d.count = 0; }
    if (d.count + cost > dailyCap) {
      return { status: 429, body: { error: "the daily budget for this endpoint is spent — cached answers still serve" } };
    }
    d.count += cost;
  }
  /* keep the map from growing without bound */
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.at > 3600000) buckets.delete(k);
  }
  return null;
}
