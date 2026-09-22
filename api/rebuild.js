/**
 * /api/rebuild.js — Vercel serverless function.
 *
 * The owner-only control behind "Rebuild the credit layer" (7.6, tier 2).
 * A POST kicks off the weekly refresh workflow on demand; a GET polls
 * what it is doing. Nobody but the owner can reach either verb — a
 * shared secret, compared in constant time, gates both — and neither
 * verb does anything at all unless the two environment variables it
 * needs are actually set, which is also what keeps the smoke suite from
 * ever dispatching a real run:
 *
 *   POST /api/rebuild   { layer?: "all" | "bdc" }   header X-Rebuild-Secret
 *   GET  /api/rebuild                                header X-Rebuild-Secret
 *
 * This file targets one repository, so its owner and name are literal
 * constants below — that is not secret, it is the public GitHub path
 * this dashboard already deploys from. Only the two credentials —
 * GITHUB_DISPATCH_TOKEN (a fine-grained token, Actions read/write on
 * that one repository) and REBUILD_SECRET (the owner's own shared
 * secret) — come from the environment, and neither is ever echoed back
 * in a response body or a log, on any path including a thrown
 * exception: jsonSafe's catch-all prints only the caught error's own
 * message, and nothing in this file ever builds an error message out of
 * the secret or the token.
 */

import { timingSafeEqual, createHash } from "node:crypto";
import { jsonSafe } from "../scripts/lib/handler.mjs";
import { gate } from "../scripts/lib/ratelimit.mjs";
import { dispatchWorkflow, findLatestRun, getRun } from "../scripts/lib/github-actions.mjs";

export const maxDuration = 30;

/* This endpoint targets one repository; the path is public, only the
   credentials above are not. */
const OWNER = "NXO1759-ai";
const REPO = "PowerBI";
const WORKFLOW_FILE = "weekly-refresh.yml";
const REF = "main";

/* Blueprint 7.6 specifies "all | bdc | pc". "pc" is deliberately withheld
   here: the PitchBook/LCD ingest (7.5) has no step in weekly-refresh.yml
   at all — it runs on the owner's own machine (data-sources/README.md) —
   so a "pc" layer would have nothing in this workflow to select. Add it
   back once that ingest gains a step here. */
const LAYERS = ["all", "bdc"];

/* Comfortably inside maxDuration: the slowest path (GET) makes at most
   three GitHub calls in sequence (list runs, get one run, read one data
   file), each capped by github-actions.mjs's own 8s fetch timeout —
   24s worst case, leaving headroom for JSON serialization and the
   platform's own overhead before the function is killed. */
const DEADLINE_MS = 25000;

/* The file the BDC step always rewrites, whatever `layer` a run was
   dispatched with — unlike frontend/data/quality-report.json, which
   only the operating-company steps (skipped on a bdc-only run) touch.
   Its own `finishedAt` field is the closest thing to a "did the commit
   actually land" signal this endpoint has; see finishedAtFor() and
   contractNotes for exactly what it can and cannot tell a poller. */
const BDC_REPORT_PATH = "frontend/data/bdc/refresh-report.json";

/* Both sides are hashed to a fixed-width digest before the constant-time
   compare, so there is no length branch at all: timingSafeEqual never
   sees two buffers of different length (sha256 output is always 32
   bytes), and an empty supplied value still compares, in constant time,
   to whatever the empty string hashes to — it just never matches a real
   secret. A length check ahead of timingSafeEqual (the earlier shape of
   this function) would not have leaked the caller's own header length,
   which they already know; it would have revealed the SERVER'S secret's
   length, one byte-count query at a time. Hashing first removes that
   branch instead of arguing it is harmless. */
function secretMatches(supplied, expected) {
  const a = createHash("sha256").update(String(supplied == null ? "" : supplied)).digest();
  const b = createHash("sha256").update(String(expected == null ? "" : expected)).digest();
  return timingSafeEqual(a, b);
}

function shapeRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    number: run.run_number,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    htmlUrl: run.html_url,
  };
}

/* Reads BDC_REPORT_PATH at `ref`'s current HEAD via the Contents API and
   returns its own `finishedAt` field, or null on anything short of a
   clean 200 with a parseable JSON body — a missing file, a bad token, a
   timeout and a malformed commit all read the same way to a poller:
   "no signal yet". */
/* `ok: false` means the read itself did not complete — a bad token, a
   timeout, an unparseable body or commit: transient, or at least not
   something this run's own outcome caused, so a caller should keep
   waiting on it. `ok: true` means the file was read and parsed
   successfully, whether or not it carries a usable finishedAt — that
   distinction (present vs a run whose data step never wrote one) is
   finishedAtFor's to make, not this function's. */
async function readBdcReportFinishedAt(token) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${BDC_REPORT_PATH}?ref=${REF}`,
      {
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "private-credit-terminal-rebuild",
        },
      });
    if (!resp.ok) return { ok: false, finishedAt: null };
    const body = await resp.json().catch(() => null);
    if (!body || typeof body.content !== "string") return { ok: false, finishedAt: null };
    const report = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
    return { ok: true, finishedAt: typeof report.finishedAt === "string" ? report.finishedAt : null };
  } catch {
    return { ok: false, finishedAt: null };
  } finally {
    clearTimeout(timer);
  }
}

/* finishedAt is only ever asked of a run GitHub itself already calls
   "completed" — while a run is queued or in progress there is nothing
   in the data files to find yet. Even then it is a best-effort read, and
   a null finishedAt can mean three different things a caller needs to
   tell apart:
     - still landing: the data file has not been read successfully yet
       (a push still one retry into `git pull --rebase`, a transient
       GitHub error, a timeout) — finishedAtUnavailable: true. Transient;
       keep polling.
     - stale forever: the file read fine but its own finishedAt predates
       this run's start — weekly-refresh.yml's BDC step runs
       continue-on-error with its own timeout, so a run whose data step
       failed or timed out still concludes "completed" (even "success")
       while frontend/data/bdc/refresh-report.json keeps whatever an
       earlier run last wrote there. Nothing this run does will ever
       move that file's finishedAt at or after its own start —
       finishedAtStale: true. Not transient; a caller should stop
       waiting on this signal for this run.
     - not written at all this run: the same "no signal" a caller cannot
       tell apart from "still landing" without more information; treated
       the same way (finishedAtUnavailable: false, finishedAtStale:
       false, finishedAt: null) since the file read itself succeeded and
       simply carries nothing usable. */
async function finishedAtFor(run, token) {
  const none = { finishedAt: null, finishedAtStale: false, finishedAtUnavailable: false };
  if (!run || run.status !== "completed") return none;
  const read = await readBdcReportFinishedAt(token);
  if (!read.ok) return { ...none, finishedAtUnavailable: true };
  if (!read.finishedAt) return none;
  const runStarted = run.run_started_at || run.created_at;
  const fresh = new Date(read.finishedAt).getTime() >= new Date(runStarted).getTime();
  return fresh ? { ...none, finishedAt: read.finishedAt } : { ...none, finishedAtStale: true };
}

function withDeadline(promise, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), DEADLINE_MS)),
  ]);
}

/* The pre-dispatch check GitHub's own concurrency group does not do for
   us: the group on weekly-refresh.yml cancels a pending run rather than
   refusing a new one, so whether something is already running has to be
   read directly. `event: null` widens the listing past this endpoint's
   own dispatches — a Sunday cron run firing while the owner clicks
   Rebuild is exactly the case this guards. */
async function findActiveRun(token) {
  const latest = await findLatestRun({
    owner: OWNER, repo: REPO, workflowFile: WORKFLOW_FILE, token,
    since: new Date(0).toISOString(), event: null,
  });
  if (!latest.ok) return { error: latest.error };
  if (latest.run && (latest.run.status === "queued" || latest.run.status === "in_progress")) {
    return { active: latest.run };
  }
  return { active: null };
}

async function doDispatch(token, layer) {
  const found = await findActiveRun(token);
  if (found.error) return { error: "could not reach GitHub to check for a running job: " + found.error };
  if (found.active) return { conflict: shapeRun(found.active) };

  const dispatched = await dispatchWorkflow({
    owner: OWNER, repo: REPO, workflowFile: WORKFLOW_FILE, ref: REF,
    inputs: { limit: "0", layer }, token,
  });
  if (!dispatched.ok) return { error: "GitHub did not accept the dispatch: " + dispatched.error };
  return { at: new Date().toISOString() };
}

async function handlePost(req, res, token) {
  /* the door: a determined caller with the wrong secret should not be
     able to spend more than a handful of guesses a minute against it,
     and a legitimate owner clicking the button twice should not be
     bounced either. Named so this bucket is this endpoint's own — not
     shared with every other gated route on the site, which is what let
     a looser public endpoint amplify a caller's guess rate here, and let
     the owner's own page traffic exhaust the bucket this door reads from
     before the secret is even checked. */
  const refused = gate(req, { name: "rebuild-post", burst: 2, ratePerMin: 1, cost: 0, sameOrigin: true });
  if (refused) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(refused.status).json(refused.body);
  }

  const supplied = req.headers && req.headers["x-rebuild-secret"];
  if (!secretMatches(supplied, process.env.REBUILD_SECRET)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).json({ error: "wrong rebuild secret" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const layer = body.layer == null || body.layer === "" ? "all" : String(body.layer);
  if (!LAYERS.includes(layer)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({ error: 'layer must be "all" or "bdc"' });
  }

  const result = await withDeadline(doDispatch(token, layer), { timedOut: true });
  res.setHeader("Cache-Control", "no-store");
  if (result.timedOut) {
    return res.status(502).json({
      error: "GitHub did not answer in time — the dispatch may or may not have gone through; check the run list before retrying",
    });
  }
  if (result.conflict) {
    return res.status(409).json({ error: "a rebuild is already queued or running", run: result.conflict });
  }
  if (result.error) return res.status(502).json({ error: result.error });
  return res.status(202).json({ dispatched: true, at: result.at });
}

/* `since`, when given, is the caller's own dispatch timestamp (minus a
   little clock-skew margin — see handleGet) rather than the beginning of
   time: without it, the very first poll right after a dispatch can find
   GitHub's run list not yet indexing the new run and read the newest
   PRIOR run instead — a Sunday cron run, or last time's dispatch — as
   this dispatch's own result, declaring it finished before it exists. A
   run older than `since` must read as "not started yet" ({status:
   "none"}), which the caller's own poll loop already treats as
   non-terminal and keeps polling on. */
async function pollRun(token, since) {
  const latest = await findLatestRun({
    owner: OWNER, repo: REPO, workflowFile: WORKFLOW_FILE, token,
    since: since || new Date(0).toISOString(), event: null,
  });
  if (!latest.ok) return { error: "could not reach GitHub for run status: " + latest.error };
  if (!latest.run) return { status: "none", run: null, finishedAt: null, finishedAtStale: false, finishedAtUnavailable: false };

  /* the list already carries most of what is needed; getRun is one more
     round trip for the freshest status right at the poll moment, which
     matters most in the seconds a run flips from queued to in_progress
     to completed */
  const detail = await getRun({ owner: OWNER, repo: REPO, runId: latest.run.id, token });
  const run = detail.ok && detail.run ? detail.run : latest.run;
  const { finishedAt, finishedAtStale, finishedAtUnavailable } = await finishedAtFor(run, token);
  return { status: run.status, run: shapeRun(run), finishedAt, finishedAtStale, finishedAtUnavailable };
}

async function handleGet(req, res, token) {
  /* a legitimate caller polls every 30 seconds; this allows a burst for
     a page just opened plus one retry, never a tight loop. Named for the
     same reason as the POST gate above: this endpoint's own bucket, not
     one shared with the rest of the site. */
  const refused = gate(req, { name: "rebuild-get", burst: 3, ratePerMin: 3, cost: 0, sameOrigin: true });
  if (refused) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(refused.status).json(refused.body);
  }

  const supplied = req.headers && req.headers["x-rebuild-secret"];
  if (!secretMatches(supplied, process.env.REBUILD_SECRET)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).json({ error: "wrong rebuild secret" });
  }

  /* an optional ?since= from the page — the timestamp its own dispatch
     returned — so the first poll right after dispatching never reads a
     run that predates it as this run's own result (see pollRun's own
     comment). A few seconds are subtracted for clock skew between this
     endpoint, the browser and GitHub; an invalid or missing value falls
     back to pollRun's own "since the beginning" default. */
  const rawSince = req.query && req.query.since;
  const sinceValue = Array.isArray(rawSince) ? rawSince[0] : rawSince;
  let since = null;
  if (sinceValue) {
    const t = new Date(String(sinceValue)).getTime();
    if (Number.isFinite(t)) since = new Date(t - 5000).toISOString();
  }

  const result = await withDeadline(pollRun(token, since),
    { status: "unknown", run: null, finishedAt: null, finishedAtStale: false, finishedAtUnavailable: true, timedOut: true });
  res.setHeader("Cache-Control", "no-store");
  if (result.error) return res.status(502).json({ error: result.error });
  const { status, run, finishedAt, finishedAtStale, finishedAtUnavailable } = result;
  return res.status(200).json({ status, run, finishedAt, finishedAtStale: !!finishedAtStale, finishedAtUnavailable: !!finishedAtUnavailable });
}

export default jsonSafe(async function handler(req, res) {
  /* the master switch: unset either variable and this endpoint refuses
     to do anything at all, on either verb — which is also what keeps
     the smoke suite, which carries neither secret, from ever reaching
     GitHub */
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const secret = process.env.REBUILD_SECRET;
  if (!token || !secret) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: "rebuild is not configured" });
  }

  const method = String((req.method || "GET")).toUpperCase();
  if (method === "POST") return handlePost(req, res, token);
  if (method === "GET") return handleGet(req, res, token);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
}, { name: "rebuild" });
