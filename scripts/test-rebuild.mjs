/**
 * test-rebuild.mjs — the owner-only rebuild control (api/rebuild.js),
 * offline.
 *
 * Every GitHub call github-actions.mjs makes goes through the global
 * fetch, so fetch is replaced for the run — the technique test-fred.mjs
 * and test-price-history.mjs use — rather than the module's own exports.
 * The handler's real code runs end to end for every case: the config
 * gate, the secret check, the layer validation, the conflict check
 * against a stubbed run list, the dispatch call and the GET poll's
 * finishedAt heuristic; only the network underneath github-actions.mjs
 * is canned.
 *
 * GITHUB_DISPATCH_TOKEN and REBUILD_SECRET below are invented for this
 * process only ("test-only-…"). The 401 case sends a header that is
 * deliberately wrong — never this or any real secret — and every check
 * that inspects a response body also confirms the fake secret's own
 * text never appears in it, the same guarantee the endpoint must hold
 * for a real one.
 */
const FAKE_TOKEN = "test-only-not-a-real-token";
const FAKE_SECRET = "test-only-not-a-real-secret";

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!ok) failed++;
};
const isObj = (x) => x && typeof x === "object";
const neverLeaks = (body) => !JSON.stringify(body).includes(FAKE_SECRET) && !JSON.stringify(body).includes(FAKE_TOKEN);

/* the same mock the smoke suite hands a handler */
function mockRes() {
  const r = { headers: {}, code: null, body: null,
    setHeader(k, v) { r.headers[k] = v; },
    status(c) { r.code = c; return r; },
    json(b) { r.body = b; return r; },
    end() { return r; } };
  return r;
}

/* fetch stand-in: every call is logged; a route table (reset per
   scenario) answers by URL pattern, and a dispatch call's own JSON body
   is captured separately since more than one scenario asserts on it */
const calls = [];
let routes = [];
let lastDispatchBody = null;
function route(pattern, reply) { routes.push({ pattern, reply }); }
function resetRoutes() { routes = []; calls.length = 0; lastDispatchBody = null; }
globalThis.fetch = async (url, options) => {
  const u = String(url);
  calls.push(u);
  if (/\/dispatches$/.test(u) && options && options.body) {
    lastDispatchBody = JSON.parse(options.body);
  }
  for (const r of routes) {
    if (r.pattern.test(u)) return typeof r.reply === "function" ? r.reply(u, options) : r.reply;
  }
  throw new Error("unstubbed fetch in test-rebuild.mjs: " + u);
};

/* the rate gate keeps its bucket on globalThis, the same way the price
   history cache does; clearing it between scenarios isolates each one,
   since every mock request in this file shares the gate's "anon" key */
const resetGate = () => { if (globalThis.__rlBuckets) globalThis.__rlBuckets.clear(); };

function resetEnv() {
  delete process.env.GITHUB_DISPATCH_TOKEN;
  delete process.env.REBUILD_SECRET;
}

const { default: handler } = await import("../api/rebuild.js");
async function call(req) {
  const res = mockRes();
  await handler(req, res);
  return res;
}

/* ---- 503: not configured -------------------------------------------- */
resetEnv(); resetRoutes(); resetGate();
let res = await call({ method: "POST", headers: {}, body: {} });
check("POST with neither env var set answers 503", res.code === 503 && /not configured/.test(res.body.error), JSON.stringify(res.body));
check("no GitHub call was made", calls.length === 0, calls.join(", "));

resetEnv();
process.env.REBUILD_SECRET = FAKE_SECRET;
res = await call({ method: "POST", headers: {}, body: {} });
check("POST with only REBUILD_SECRET set still answers 503", res.code === 503 && /not configured/.test(res.body.error), JSON.stringify(res.body));

resetEnv();
process.env.GITHUB_DISPATCH_TOKEN = FAKE_TOKEN;
res = await call({ method: "POST", headers: {}, body: {} });
check("POST with only GITHUB_DISPATCH_TOKEN set still answers 503", res.code === 503 && /not configured/.test(res.body.error), JSON.stringify(res.body));

/* ---- GET 503: the same master switch, the other verb ----------------- */
resetEnv();
res = await call({ method: "GET", headers: {} });
check("GET with neither env var set answers 503", res.code === 503 && /not configured/.test(res.body.error), JSON.stringify(res.body));

/* ---- 401: both set, a deliberately wrong secret ----------------------- */
resetEnv();
process.env.GITHUB_DISPATCH_TOKEN = FAKE_TOKEN;
process.env.REBUILD_SECRET = FAKE_SECRET;
resetRoutes(); resetGate();
res = await call({ method: "POST", headers: { "x-rebuild-secret": "definitely-the-wrong-value" }, body: {} });
check("POST with both env vars set and a wrong header answers 401", res.code === 401 && /wrong/i.test(res.body.error), JSON.stringify(res.body));
check("the 401 body never echoes the secret, the token, or a hint", neverLeaks(res.body), JSON.stringify(res.body));
check("a wrong secret never reaches GitHub", calls.length === 0, calls.join(", "));

resetGate();
res = await call({ method: "GET", headers: { "x-rebuild-secret": "also-wrong" } });
check("GET with both env vars set and a wrong header answers 401 too", res.code === 401 && /wrong/i.test(res.body.error), JSON.stringify(res.body));
check("the GET 401 body never echoes the secret or the token", neverLeaks(res.body), JSON.stringify(res.body));

/* ---- 400: an unknown layer --------------------------------------------- */
resetGate();
res = await call({ method: "POST", headers: { "x-rebuild-secret": FAKE_SECRET }, body: { layer: "pc" } });
check("an unknown layer answers 400 before any GitHub call", res.code === 400 && /layer/.test(res.body.error) && calls.length === 0, JSON.stringify(res.body));

/* ---- 409: a run is already queued or in progress ----------------------- */
resetRoutes(); resetGate();
const ACTIVE_RUN = {
  id: 555, run_number: 42, status: "in_progress", conclusion: null, event: "schedule",
  created_at: new Date().toISOString(), run_started_at: new Date().toISOString(),
  updated_at: new Date().toISOString(), html_url: "https://github.com/NXO1759-ai/PowerBI/actions/runs/555",
};
route(/\/actions\/workflows\/weekly-refresh\.yml\/runs\?/, { ok: true, status: 200, json: async () => ({ workflow_runs: [ACTIVE_RUN] }) });
res = await call({ method: "POST", headers: { "x-rebuild-secret": FAKE_SECRET }, body: { layer: "all" } });
check("409 when a run is already queued or in progress", res.code === 409 && isObj(res.body.run) && res.body.run.id === 555 && res.body.run.status === "in_progress",
  JSON.stringify(res.body));
check("409 covers a run of any trigger, not only ones this endpoint dispatched (this one is a schedule run)",
  res.code === 409 && res.body.run.event === "schedule");
check("the dispatch endpoint is never reached once a run is already active", !calls.some((u) => /\/dispatches$/.test(u)), calls.join(", "));

/* a queued run refuses the same way as in_progress */
resetRoutes(); resetGate();
route(/\/actions\/workflows\/weekly-refresh\.yml\/runs\?/, { ok: true, status: 200,
  json: async () => ({ workflow_runs: [{ ...ACTIVE_RUN, id: 556, status: "queued" }] }) });
res = await call({ method: "POST", headers: { "x-rebuild-secret": FAKE_SECRET }, body: {} });
check("409 for a queued run too (layer omitted, so this also covers the default)", res.code === 409 && res.body.run.id === 556);

/* ---- 202: a clear queue dispatches, with the right inputs -------------- */
resetRoutes(); resetGate();
route(/\/actions\/workflows\/weekly-refresh\.yml\/runs\?/, { ok: true, status: 200, json: async () => ({ workflow_runs: [] }) });
route(/\/actions\/workflows\/weekly-refresh\.yml\/dispatches$/, { ok: true, status: 204, json: async () => ({}) });
res = await call({ method: "POST", headers: { "x-rebuild-secret": FAKE_SECRET }, body: { layer: "bdc" } });
check("202 dispatched:true with an ISO 'at' timestamp", res.code === 202 && res.body.dispatched === true && !Number.isNaN(Date.parse(res.body.at)),
  JSON.stringify(res.body));
check("the dispatch call carried ref \"main\" and inputs {limit:\"0\", layer:\"bdc\"}",
  isObj(lastDispatchBody) && lastDispatchBody.ref === "main" &&
  isObj(lastDispatchBody.inputs) && lastDispatchBody.inputs.limit === "0" && lastDispatchBody.inputs.layer === "bdc",
  JSON.stringify(lastDispatchBody));

/* an empty run list with no layer in the body defaults to "all" */
resetRoutes(); resetGate();
route(/\/actions\/workflows\/weekly-refresh\.yml\/runs\?/, { ok: true, status: 200, json: async () => ({ workflow_runs: [] }) });
route(/\/actions\/workflows\/weekly-refresh\.yml\/dispatches$/, { ok: true, status: 204, json: async () => ({}) });
res = await call({ method: "POST", headers: { "x-rebuild-secret": FAKE_SECRET }, body: {} });
check("an omitted layer defaults to \"all\" in the dispatch inputs", res.code === 202 && lastDispatchBody.inputs.layer === "all", JSON.stringify(lastDispatchBody));

/* a run that already completed does not block a new dispatch */
resetRoutes(); resetGate();
route(/\/actions\/workflows\/weekly-refresh\.yml\/runs\?/, { ok: true, status: 200,
  json: async () => ({ workflow_runs: [{ ...ACTIVE_RUN, id: 557, status: "completed", conclusion: "success" }] }) });
route(/\/actions\/workflows\/weekly-refresh\.yml\/dispatches$/, { ok: true, status: 204, json: async () => ({}) });
res = await call({ method: "POST", headers: { "x-rebuild-secret": FAKE_SECRET }, body: { layer: "all" } });
check("a completed run does not trigger 409", res.code === 202, JSON.stringify(res.body));

/* ---- GET: a stubbed run-found path, with the finishedAt heuristic ------ */
resetRoutes(); resetGate();
const COMPLETED_RUN = {
  id: 777, run_number: 99, status: "completed", conclusion: "success", event: "workflow_dispatch",
  created_at: "2026-09-22T10:00:00Z", run_started_at: "2026-09-22T10:00:05Z",
  updated_at: "2026-09-22T10:05:00Z", html_url: "https://github.com/NXO1759-ai/PowerBI/actions/runs/777",
};
const REPORT_FINISHED_AT = "2026-09-22T10:04:50Z";
const reportBase64 = Buffer.from(JSON.stringify({ finishedAt: REPORT_FINISHED_AT, companiesWritten: 137 })).toString("base64");
route(/\/actions\/workflows\/weekly-refresh\.yml\/runs\?/, { ok: true, status: 200, json: async () => ({ workflow_runs: [COMPLETED_RUN] }) });
route(/\/actions\/runs\/777$/, { ok: true, status: 200, json: async () => COMPLETED_RUN });
route(/\/contents\/frontend\/data\/bdc\/refresh-report\.json\?ref=main/, { ok: true, status: 200, json: async () => ({ content: reportBase64 }) });
res = await call({ method: "GET", headers: { "x-rebuild-secret": FAKE_SECRET } });
check("GET returns the found run's status and shaped run", res.code === 200 && res.body.status === "completed" && isObj(res.body.run) && res.body.run.id === 777,
  JSON.stringify(res.body));
check("GET reads finishedAt from the BDC report file, not the run object", res.body.finishedAt === REPORT_FINISHED_AT, JSON.stringify(res.body));
check("the run object served to the caller is shaped, not GitHub's raw payload verbatim",
  Object.keys(res.body.run).sort().join(",") === ["conclusion", "createdAt", "event", "htmlUrl", "id", "number", "status", "updatedAt"].sort().join(","),
  Object.keys(res.body.run).join(","));

/* the data file's finishedAt is honored only when it is at or after this
   run's own start — a stale file left over from an earlier run must not
   be mistaken for this run having landed */
resetRoutes(); resetGate();
const staleBase64 = Buffer.from(JSON.stringify({ finishedAt: "2026-09-01T00:00:00Z" })).toString("base64");
route(/\/actions\/workflows\/weekly-refresh\.yml\/runs\?/, { ok: true, status: 200, json: async () => ({ workflow_runs: [COMPLETED_RUN] }) });
route(/\/actions\/runs\/777$/, { ok: true, status: 200, json: async () => COMPLETED_RUN });
route(/\/contents\/frontend\/data\/bdc\/refresh-report\.json\?ref=main/, { ok: true, status: 200, json: async () => ({ content: staleBase64 }) });
res = await call({ method: "GET", headers: { "x-rebuild-secret": FAKE_SECRET } });
check("a finishedAt older than the run's own start reads as null, not a false completion",
  res.code === 200 && res.body.status === "completed" && res.body.finishedAt === null, JSON.stringify(res.body));
check("a stale finishedAt is flagged finishedAtStale, not just a silent null a caller cannot act on",
  res.body.finishedAtStale === true && res.body.finishedAtUnavailable === false, JSON.stringify(res.body));

/* the read itself failing (a transient GitHub error, a bad body) is
   distinct from a stale file: this run may still land, so a caller
   should keep polling rather than treating it as permanently stuck */
resetRoutes(); resetGate();
route(/\/actions\/workflows\/weekly-refresh\.yml\/runs\?/, { ok: true, status: 200, json: async () => ({ workflow_runs: [COMPLETED_RUN] }) });
route(/\/actions\/runs\/777$/, { ok: true, status: 200, json: async () => COMPLETED_RUN });
route(/\/contents\/frontend\/data\/bdc\/refresh-report\.json\?ref=main/, { ok: false, status: 500, json: async () => ({}) });
res = await call({ method: "GET", headers: { "x-rebuild-secret": FAKE_SECRET } });
check("a failed data-file read on a completed run answers finishedAtUnavailable, not finishedAtStale",
  res.code === 200 && res.body.status === "completed" && res.body.finishedAt === null &&
  res.body.finishedAtUnavailable === true && res.body.finishedAtStale === false, JSON.stringify(res.body));

/* a run still in flight never asks the data file at all */
resetRoutes(); resetGate();
route(/\/actions\/workflows\/weekly-refresh\.yml\/runs\?/, { ok: true, status: 200,
  json: async () => ({ workflow_runs: [{ ...COMPLETED_RUN, id: 778, status: "in_progress", conclusion: null }] }) });
route(/\/actions\/runs\/778$/, { ok: true, status: 200, json: async () => ({ ...COMPLETED_RUN, id: 778, status: "in_progress", conclusion: null }) });
res = await call({ method: "GET", headers: { "x-rebuild-secret": FAKE_SECRET } });
check("GET on an in-progress run reports finishedAt null without reading the data file",
  res.code === 200 && res.body.status === "in_progress" && res.body.finishedAt === null &&
  res.body.finishedAtStale === false && res.body.finishedAtUnavailable === false &&
  !calls.some((u) => /\/contents\//.test(u)), JSON.stringify({ body: res.body, calls }));

/* no run at all (a fresh repository, or GitHub not yet indexing anything) */
resetRoutes(); resetGate();
route(/\/actions\/workflows\/weekly-refresh\.yml\/runs\?/, { ok: true, status: 200, json: async () => ({ workflow_runs: [] }) });
res = await call({ method: "GET", headers: { "x-rebuild-secret": FAKE_SECRET } });
check("GET with no run found answers 200 with status \"none\"", res.code === 200 && res.body.status === "none" && res.body.run === null && res.body.finishedAt === null,
  JSON.stringify(res.body));

/* ---- ?since=: the very first poll after a dispatch must not read an
   older run (a Sunday cron run, or an earlier dispatch) as this run's
   own result ------------------------------------------------------- */
resetRoutes(); resetGate();
const PRIOR_CRON_RUN = {
  id: 501, run_number: 41, status: "completed", conclusion: "success", event: "schedule",
  created_at: "2026-09-20T07:00:00Z", run_started_at: "2026-09-20T07:00:05Z",
  updated_at: "2026-09-20T07:05:00Z", html_url: "https://github.com/NXO1759-ai/PowerBI/actions/runs/501",
};
route(/\/actions\/workflows\/weekly-refresh\.yml\/runs\?/, { ok: true, status: 200, json: async () => ({ workflow_runs: [PRIOR_CRON_RUN] }) });
const justDispatchedAt = new Date("2026-09-22T12:00:00Z").toISOString();
res = await call({ method: "GET", headers: { "x-rebuild-secret": FAKE_SECRET },
  query: { since: justDispatchedAt } });
check("GET with ?since= after the only run on file reads as \"none\", not that older run",
  res.code === 200 && res.body.status === "none" && res.body.run === null,
  JSON.stringify(res.body));

/* the run this dispatch actually started DOES show up once it is
   created at or after `since` (allowing for the few seconds of skew
   margin handleGet itself subtracts) */
resetRoutes(); resetGate();
const JUST_DISPATCHED_RUN = {
  id: 502, run_number: 42, status: "queued", conclusion: null, event: "workflow_dispatch",
  created_at: "2026-09-22T12:00:02Z", run_started_at: null,
  updated_at: "2026-09-22T12:00:02Z", html_url: "https://github.com/NXO1759-ai/PowerBI/actions/runs/502",
};
route(/\/actions\/workflows\/weekly-refresh\.yml\/runs\?/, { ok: true, status: 200,
  json: async () => ({ workflow_runs: [PRIOR_CRON_RUN, JUST_DISPATCHED_RUN] }) });
route(/\/actions\/runs\/502$/, { ok: true, status: 200, json: async () => JUST_DISPATCHED_RUN });
res = await call({ method: "GET", headers: { "x-rebuild-secret": FAKE_SECRET },
  query: { since: justDispatchedAt } });
check("GET with ?since= finds the run created just after it, not the older one",
  res.code === 200 && res.body.status === "queued" && isObj(res.body.run) && res.body.run.id === 502,
  JSON.stringify(res.body));

/* an invalid since falls back to pollRun's own "since the beginning"
   default rather than throwing or silently hiding every run */
resetRoutes(); resetGate();
route(/\/actions\/workflows\/weekly-refresh\.yml\/runs\?/, { ok: true, status: 200, json: async () => ({ workflow_runs: [PRIOR_CRON_RUN] }) });
res = await call({ method: "GET", headers: { "x-rebuild-secret": FAKE_SECRET },
  query: { since: "not-a-real-date" } });
check("GET with an invalid ?since= still finds the existing run rather than erroring",
  res.code === 200 && isObj(res.body.run) && res.body.run.id === 501, JSON.stringify(res.body));

/* ---- the POST and GET gates are this endpoint's own buckets, not
   shared with any other gated route (scripts/lib/ratelimit.mjs's
   `name` option) ------------------------------------------------------ */
resetRoutes(); resetGate();
{
  const { gate } = await import("../scripts/lib/ratelimit.mjs");
  /* spend a different endpoint's bucket at the same client key: with the
     old shared, unnamed bucket this would have starved rebuild-post's
     burst of 2 before rebuild.js ever saw a request */
  gate({ headers: {} }, { name: "some-other-endpoint", burst: 20, ratePerMin: 10, cost: 0, sameOrigin: false });
  gate({ headers: {} }, { name: "some-other-endpoint", burst: 20, ratePerMin: 10, cost: 0, sameOrigin: false });
}
res = await call({ method: "POST", headers: { "x-rebuild-secret": FAKE_SECRET }, body: { layer: "pc" } });
check("a burst spent against a differently-named endpoint's gate does not touch rebuild-post's own bucket",
  res.code === 400, JSON.stringify(res.body));

resetEnv();
console.log(failed ? "\n" + failed + " failed" : "\nall rebuild checks pass");
process.exit(failed ? 1 : 0);
