/**
 * github-actions.mjs — talks to GitHub's REST API for one repository's
 * Actions: dispatching a workflow run, and finding out what happened to
 * it. The owner-only "Rebuild the credit layer" control (7.6, tier 2) is
 * the only caller.
 *
 * Every function here returns a plain result object — { ok: true, ... }
 * or { ok: false, status, error } — rather than throwing. A serverless
 * endpoint that must always answer JSON cannot afford a network hiccup
 * or a bad token turning into an unhandled rejection; the caller reads
 * `ok` and moves on. Every fetch carries its own timeout for the same
 * reason: a call that never resolves is as dangerous to a request budget
 * as one that throws.
 *
 * Nothing here reads process.env. The token is the caller's to hold and
 * pass in, and no returned value — success, failure, or a thrown-then-
 * caught exception — ever carries it: GitHub's own error bodies (which
 * this module does surface, since they describe the request, not the
 * caller's secret) do not either.
 */

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
/* GitHub requires a User-Agent on every request; a real, identifying one
   costs nothing and matches the courtesy sec-pull.mjs extends to SEC. */
const UA = "private-credit-terminal-rebuild (+https://www.chineduokeke.mba)";
const DEFAULT_TIMEOUT_MS = 8000;

async function ghFetch(url, { method = "GET", token, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": UA,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    /* the dispatches endpoint answers 204 with no body; everything else
       is JSON, except a GitHub outage page, which a failed parse below
       degrades to null rather than throwing past this function */
    let data = null;
    if (resp.status !== 204) {
      try { data = await resp.json(); } catch { data = null; }
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (e) {
    return {
      ok: false, status: 0, data: null,
      networkError: e && e.name === "AbortError" ? "timed out" : "unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}

/* GitHub's own message ("Bad credentials", "Not Found", a validation
   error naming the bad field) describes the request, never the caller's
   token, so it is safe to hand back to whoever asked. */
function ghError(result) {
  if (result.data && typeof result.data.message === "string") return result.data.message;
  if (result.networkError) return result.networkError;
  return "GitHub answered HTTP " + result.status;
}

/**
 * POSTs a workflow_dispatch event for one workflow file. Resolves
 * { ok: true } on GitHub's 204 (dispatch accepted; GitHub gives back no
 * run id — that is what findLatestRun is for), or { ok: false, status,
 * error } for a bad token, an unknown ref, or a network failure.
 */
export async function dispatchWorkflow({ owner, repo, workflowFile, ref, inputs, token }) {
  const result = await ghFetch(
    `${API}/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
    { method: "POST", token, body: { ref, inputs } });
  if (result.status === 204) return { ok: true };
  return { ok: false, status: result.status, error: ghError(result) };
}

/**
 * Lists a workflow's runs and returns the newest one created at or after
 * `since` (an ISO timestamp) — or { ok: true, run: null } when none
 * qualifies, which is the ordinary answer in the seconds right after a
 * dispatch: GitHub has not indexed the new run yet. Retrying belongs to
 * the caller, since how soon and how often to retry is a polling
 * decision, not a fact this function can know.
 *
 * `event` narrows the listing the way GitHub's own `event` query
 * parameter does. It defaults to "workflow_dispatch" — what this
 * endpoint triggers, and what a poll for "the run I just started" wants
 * — but a caller asking a different question ("is anything already
 * running, however it was started, including this Sunday's cron job")
 * passes `event: null` to see the newest run regardless of trigger.
 */
export async function findLatestRun({ owner, repo, workflowFile, token, since, event = "workflow_dispatch" }) {
  const params = new URLSearchParams({ per_page: "10" });
  if (event) params.set("event", event);
  const result = await ghFetch(
    `${API}/repos/${owner}/${repo}/actions/workflows/${workflowFile}/runs?${params}`,
    { token });
  if (!result.ok) return { ok: false, status: result.status, error: ghError(result) };
  const runs = (result.data && Array.isArray(result.data.workflow_runs)) ? result.data.workflow_runs : [];
  const sinceMs = since ? new Date(since).getTime() : 0;
  const candidates = runs.filter((r) => new Date(r.created_at).getTime() >= sinceMs);
  if (!candidates.length) return { ok: true, run: null };
  /* GitHub's listing is already newest-first, but that ordering is not
     documented as a guarantee, so it is not relied on silently. */
  candidates.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { ok: true, run: candidates[0] };
}

/**
 * One run's current detail, for a caller that already has its id and
 * wants fresher status than a listing call returned a moment earlier.
 */
export async function getRun({ owner, repo, runId, token }) {
  const result = await ghFetch(`${API}/repos/${owner}/${repo}/actions/runs/${runId}`, { token });
  if (!result.ok) return { ok: false, status: result.status, error: ghError(result) };
  return { ok: true, run: result.data };
}
