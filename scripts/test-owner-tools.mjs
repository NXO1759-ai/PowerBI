/**
 * test-owner-tools.mjs — the Owner tools affordance (frontend/credit.js,
 * frontend/credit.html), offline.
 *
 * frontend/credit.js keeps the whole feature inside one self-contained
 * IIFE between the OWNER-TOOLS-BLOCK-START/END comment markers, with its
 * own $ and esc rather than borrowing the rest of the file's closure —
 * exactly so this script can lift that block out and run it on its own,
 * the same way scripts/test-pc-page.mjs evaluates a section file against
 * a window stub. Nothing here touches the network or a real browser.
 *
 *   1. The block evaluates against a mocked window/document without
 *      throwing, and window.RTOwnerTools carries the expected shape.
 *   2. The secret round-trips through a mocked sessionStorage under the
 *      documented key, survives a page-reload-shaped re-read, and a
 *      failing sessionStorage (a private window) degrades to an empty
 *      string rather than throwing.
 *   3. rebuildRequest() never puts the secret anywhere but the
 *      X-Rebuild-Secret header, on both verbs; a GET's URL carries no
 *      query string when called with no `since`, and carries exactly
 *      `?since=<value>` and nothing else when one is given.
 *   4. pollRun() drives a simulated fetch sequence (queued -> in_progress
 *      -> completed) and stops itself exactly on the terminal status,
 *      making no further fetch call after that; a non-200 answer that
 *      cannot be retried away (a wrong secret, the config gate closed)
 *      stops it immediately with the server's own error text, never
 *      invented wording; a 429 or a failed-to-reach-the-server answer
 *      keeps polling instead of stopping; a run that never turns up
 *      within MAX_POLLS stops there too.
 *   5. owner-btn stays out of the DOM's visible state until this tab has
 *      a reason to show it — a secret already saved this session, or
 *      #owner in the URL — and neither check throws when window.location
 *      or window.addEventListener is missing altogether.
 *   6. End to end against the real markup: frontend/credit.html carries
 *      the owner-btn affordance and the owner-modal's fields with the
 *      ids this file wires, and clicking through the mocked DOM (open,
 *      type a secret, click Rebuild) drives a real fetch call whose URL
 *      never carries the secret and whose header does.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRONT = join(ROOT, "frontend");
let failed = 0;
const check = (n, ok, d) => { console.log((ok ? "  ok   " : "  FAIL ") + n + (d ? "  " + d : "")); if (!ok) failed++; };

/* ---------- extract the self-contained block ---------- */
const creditSrc = readFileSync(join(FRONT, "credit.js"), "utf8");
const START = ">>> OWNER-TOOLS-BLOCK-START";
const END = "<<< OWNER-TOOLS-BLOCK-END";
const si = creditSrc.indexOf(START);
const ei = creditSrc.indexOf(END);
check("credit.js carries both extraction markers", si !== -1 && ei !== -1 && ei > si);
const block = creditSrc.slice(creditSrc.indexOf("\n", si) + 1, creditSrc.lastIndexOf("\n", ei) + 1);
check("the extracted block is non-trivial", block.length > 500, String(block.length));

/* ---------- a minimal DOM: every element is a stub with the handful of
   members this feature touches; getElementById never returns null, so
   the wiring code's own `if (el)` guards are what is under test, not
   this stub's coverage gaps ---------- */
function makeEl(id) {
  const listeners = {};
  const el = {
    id, value: "", textContent: "", innerHTML: "", hidden: true, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {},
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    focus() { el._focused = true; },
    click() { fire("click", { target: el, preventDefault() {} }); },
    querySelector() { return makeEl(id + ">child"); },
    querySelectorAll() { return []; },
    closest() { return null; },
    setAttribute() {}, getAttribute() { return null; },
  };
  function fire(type, evt) { (listeners[type] || []).forEach((fn) => fn(evt)); }
  el._fire = fire;
  return el;
}
function makeDocument() {
  const elements = {};
  const listeners = {};
  return {
    getElementById(id) { return elements[id] || (elements[id] = makeEl(id)); },
    activeElement: null,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    _fireKeydown(key) { (listeners.keydown || []).forEach((fn) => fn({ key })); },
    _elements: elements,
  };
}
/* a generic key-value stub; used as the window's sessionStorage below
   (the storage credit.js's readSecret/writeSecret now actually read) */
function makeLocalStorage(throwOnAccess) {
  const store = {};
  return {
    getItem(k) { if (throwOnAccess) throw new Error("blocked"); return k in store ? store[k] : null; },
    setItem(k, v) { if (throwOnAccess) throw new Error("blocked"); store[k] = String(v); },
    removeItem(k) { if (throwOnAccess) throw new Error("blocked"); delete store[k]; },
    _store: store,
  };
}
function makeMockFetch(queue, calls) {
  return function mockFetch(url, options) {
    calls.push({ url, options });
    const next = queue.shift();
    if (!next) return Promise.reject(new Error("test sent no mock response for " + url));
    if (next.networkError) return Promise.reject(new Error("simulated network failure"));
    return Promise.resolve({ status: next.status, json: () => Promise.resolve(next.body) });
  };
}
function evalBlock(win, doc) {
  new Function("window", "document", block)(win, doc);
  return win.RTOwnerTools;
}

/* ---------- 1. evaluates cleanly, expected shape ---------- */
console.log("evaluation");
let RT, evalErr = null;
try {
  RT = evalBlock({ sessionStorage: makeLocalStorage(), fetch: () => Promise.reject(new Error("unused")), setTimeout, clearTimeout }, makeDocument());
} catch (e) { evalErr = e; }
check("the block evaluates against a mocked window/document without throwing", !evalErr, evalErr && evalErr.message);
check("window.RTOwnerTools exposes the documented hooks", !!RT &&
  typeof RT.readSecret === "function" && typeof RT.writeSecret === "function" &&
  typeof RT.rebuildRequest === "function" && typeof RT.pollRun === "function" &&
  typeof RT.isOwnerRevealed === "function" &&
  typeof RT.STORAGE_KEY === "string" && typeof RT.MAX_POLLS === "number");
check("the storage key is clearly named and distinct from strategy.js's rt.terminalGrowth",
  /^rt\./.test(RT.STORAGE_KEY) && RT.STORAGE_KEY !== "rt.terminalGrowth", RT.STORAGE_KEY);
check("a window with no location or addEventListener at all does not throw evaluating the block",
  !evalErr);

/* ---------- 2. sessionStorage round trip ---------- */
console.log("secret storage");
{
  const win = { sessionStorage: makeLocalStorage() };
  const rt = evalBlock(win, makeDocument());
  check("a fresh mocked sessionStorage reads back empty", rt.readSecret() === "");
  rt.writeSecret("sk-test-abc123");
  check("the secret round-trips through the mocked sessionStorage",
    win.sessionStorage._store[rt.STORAGE_KEY] === "sk-test-abc123");
  check("readSecret() returns exactly what was written", rt.readSecret() === "sk-test-abc123");
  rt.writeSecret("");
  check("writing an empty secret clears the stored key", !(rt.STORAGE_KEY in win.sessionStorage._store));
}
{
  const win = { sessionStorage: makeLocalStorage(true) };
  const rt = evalBlock(win, makeDocument());
  let threw = false;
  try { rt.writeSecret("x"); rt.readSecret(); } catch (e) { threw = true; }
  check("a blocked sessionStorage (private window) degrades to empty rather than throwing", !threw);
  check("readSecret() on a blocked store answers the empty string", rt.readSecret() === "");
}

/* ---------- 3. the secret never rides in a URL, on either verb ---------- */
console.log("rebuildRequest()");
{
  const win = { sessionStorage: makeLocalStorage() };
  const rt = evalBlock(win, makeDocument());
  const secret = "s3cr3t-do-not-leak";
  const get = rt.rebuildRequest(secret, "GET");
  const post = rt.rebuildRequest(secret, "POST", "bdc");
  check("GET's URL carries no query string when no since is given", get.url === "/api/rebuild", get.url);
  check("GET's URL does not contain the secret", get.url.indexOf(secret) === -1);
  check("GET sends the secret only as X-Rebuild-Secret", get.options.headers["X-Rebuild-Secret"] === secret);
  check("GET's serialized options carry the secret exactly once (the header)",
    JSON.stringify(get.options).split(secret).length - 1 === 1);
  check("POST's URL carries no query string", post.url === "/api/rebuild", post.url);
  check("POST's URL does not contain the secret", post.url.indexOf(secret) === -1);
  check("POST sends the secret only as X-Rebuild-Secret", post.options.headers["X-Rebuild-Secret"] === secret);
  check("POST's body carries the requested layer, not the secret",
    JSON.parse(post.options.body).layer === "bdc" && post.options.body.indexOf(secret) === -1);
  const allNoLayer = rt.rebuildRequest(secret, "POST");
  check("POST defaults to layer all when none is given", JSON.parse(allNoLayer.options.body).layer === "all");

  const since = "2026-09-22T12:00:00.000Z";
  const getSince = rt.rebuildRequest(secret, "GET", since);
  check("GET with a since carries exactly ?since=<value> and nothing else",
    getSince.url === "/api/rebuild?since=" + encodeURIComponent(since), getSince.url);
  check("GET's since-bearing URL still carries no secret", getSince.url.indexOf(secret) === -1);
}

/* ---------- 4. pollRun(): stops on a terminal status, on an error, and at the cap ---------- */
console.log("pollRun()");
{
  const rt = evalBlock({ sessionStorage: makeLocalStorage() }, makeDocument());
  const calls = [];
  const queue = [
    { status: 200, body: { status: "queued", run: { id: 1, number: 42, createdAt: new Date().toISOString(), htmlUrl: "https://github.com/x/y/actions/runs/1" }, finishedAt: null } },
    { status: 200, body: { status: "in_progress", run: { id: 1, number: 42, createdAt: new Date().toISOString(), htmlUrl: "https://github.com/x/y/actions/runs/1" }, finishedAt: null } },
    { status: 200, body: { status: "completed", run: { id: 1, number: 42, conclusion: "success", createdAt: new Date().toISOString(), htmlUrl: "https://github.com/x/y/actions/runs/1" }, finishedAt: "2026-09-22T00:00:00Z" } },
  ];
  const updates = [];
  await new Promise((resolvePoll) => {
    rt.pollRun({
      fetchImpl: makeMockFetch(queue, calls), secret: "s3cr3t",
      setTimeoutImpl: (fn) => { queueMicrotask(fn); return 1; },
      clearTimeoutImpl: () => {},
      onUpdate: (state) => { updates.push(state); if (state.done) resolvePoll(); },
    });
  });
  check("pollRun made exactly one fetch call per queued reply (3)", calls.length === 3, String(calls.length));
  check("every poll call is a GET with no query string", calls.every((c) => c.options.method === "GET" && c.url === "/api/rebuild"));
  check("every poll call's URL is secret-free", calls.every((c) => c.url.indexOf("s3cr3t") === -1));
  check("every poll call carries the secret as the header", calls.every((c) => c.options.headers["X-Rebuild-Secret"] === "s3cr3t"));
  check("onUpdate ran once per reply (3)", updates.length === 3, String(updates.length));
  check("the first two updates are not terminal", !updates[0].done && !updates[1].done);
  check("the third update is terminal on the completed status", updates[2].done === true && updates[2].status === "completed");
  check("the terminal update carries the run's conclusion", updates[2].run.conclusion === "success");
}
{
  /* an error answer that retrying blind cannot fix (a wrong secret, or
     the config gate closed) stops immediately with the server's own
     sentence */
  const rt = evalBlock({ sessionStorage: makeLocalStorage() }, makeDocument());
  const calls = [];
  const queue = [{ status: 401, body: { error: "wrong rebuild secret" } }];
  const updates = [];
  await new Promise((resolvePoll) => {
    rt.pollRun({
      fetchImpl: makeMockFetch(queue, calls), secret: "bad",
      setTimeoutImpl: (fn) => { queueMicrotask(fn); return 1; },
      clearTimeoutImpl: () => {},
      onUpdate: (state) => { updates.push(state); if (state.done) resolvePoll(); },
    });
  });
  check("a 401 stops polling after exactly one call", calls.length === 1, String(calls.length));
  check("the reported error is the server's own sentence, not invented wording",
    updates[0].error === "wrong rebuild secret", updates[0].error);
}
{
  /* a 429 from the shared rate gate (the page's own Refresh traffic, or
     a burst against this endpoint) is transient, not this run's own
     status — polling keeps going rather than abandoning the run display */
  const rt = evalBlock({ sessionStorage: makeLocalStorage() }, makeDocument());
  const calls = [];
  const queue = [
    { status: 429, body: { error: "too many requests — try again in a minute" } },
    { status: 429, body: { error: "too many requests — try again in a minute" } },
    { status: 200, body: { status: "completed", run: { id: 9, number: 7, conclusion: "success", createdAt: new Date().toISOString() }, finishedAt: "2026-09-22T00:00:00Z" } },
  ];
  const updates = [];
  await new Promise((resolvePoll) => {
    rt.pollRun({
      fetchImpl: makeMockFetch(queue, calls), secret: "s3cr3t",
      setTimeoutImpl: (fn) => { queueMicrotask(fn); return 1; },
      clearTimeoutImpl: () => {},
      onUpdate: (state) => { updates.push(state); if (state.done) resolvePoll(); },
    });
  });
  check("a 429 does not stop polling", calls.length === 3, String(calls.length));
  check("the two 429 updates are non-terminal and carry the server's sentence as a note",
    !updates[0].done && !updates[1].done &&
    updates[0].note === "too many requests — try again in a minute" &&
    updates[1].note === "too many requests — try again in a minute");
  check("polling still reaches the real terminal status afterward",
    updates[2].done === true && updates[2].status === "completed");
}
{
  /* a network failure (status 0 — fetch rejected, or the response body
     could not be parsed) is just as transient as a 429 */
  const rt = evalBlock({ sessionStorage: makeLocalStorage() }, makeDocument());
  const calls = [];
  const queue = [
    { networkError: true },
    { status: 200, body: { status: "completed", run: { id: 9, number: 7, conclusion: "success", createdAt: new Date().toISOString() }, finishedAt: "2026-09-22T00:00:00Z" } },
  ];
  const updates = [];
  await new Promise((resolvePoll) => {
    rt.pollRun({
      fetchImpl: makeMockFetch(queue, calls), secret: "s3cr3t",
      setTimeoutImpl: (fn) => { queueMicrotask(fn); return 1; },
      clearTimeoutImpl: () => {},
      onUpdate: (state) => { updates.push(state); if (state.done) resolvePoll(); },
    });
  });
  check("a dropped connection does not stop polling", calls.length === 2, String(calls.length));
  check("polling still reaches the real terminal status afterward", updates[1].done === true);
}
{
  /* a 429 that never clears is still bounded by MAX_POLLS, the same cap
     as a run that never appears — an open tab is never polled forever */
  const rt = evalBlock({ sessionStorage: makeLocalStorage() }, makeDocument());
  const calls = [];
  const queue = [];
  for (let i = 0; i < rt.MAX_POLLS; i++) queue.push({ status: 429, body: { error: "too many requests — try again in a minute" } });
  const updates = [];
  await new Promise((resolvePoll) => {
    rt.pollRun({
      fetchImpl: makeMockFetch(queue, calls), secret: "s",
      setTimeoutImpl: (fn) => { queueMicrotask(fn); return 1; },
      clearTimeoutImpl: () => {},
      onUpdate: (state) => { updates.push(state); if (state.done) resolvePoll(); },
    });
  });
  check("a 429 every time still stops at MAX_POLLS", calls.length === rt.MAX_POLLS, String(calls.length) + " vs " + rt.MAX_POLLS);
  check("the final update is terminal and carries the server's own sentence",
    updates[updates.length - 1].done === true &&
    updates[updates.length - 1].error === "too many requests — try again in a minute");
}
{
  /* no run ever appears (a dispatch that never got indexed): stop at
     the cap rather than polling an open tab forever */
  const rt = evalBlock({ sessionStorage: makeLocalStorage() }, makeDocument());
  const calls = [];
  const queue = [];
  for (let i = 0; i < rt.MAX_POLLS; i++) queue.push({ status: 200, body: { status: "none", run: null, finishedAt: null } });
  const updates = [];
  await new Promise((resolvePoll) => {
    rt.pollRun({
      fetchImpl: makeMockFetch(queue, calls), secret: "s",
      setTimeoutImpl: (fn) => { queueMicrotask(fn); return 1; },
      clearTimeoutImpl: () => {},
      onUpdate: (state) => { updates.push(state); if (state.done) resolvePoll(); },
    });
  });
  check("polling stops at MAX_POLLS when no run ever appears", calls.length === rt.MAX_POLLS, String(calls.length) + " vs " + rt.MAX_POLLS);
  check("the final update is terminal and says so", updates[updates.length - 1].done === true && /No run appeared/.test(updates[updates.length - 1].error));
}
{
  /* GET calls made by pollRun thread `since` through to rebuildRequest,
     the same as a direct rebuildRequest(secret, "GET", since) call */
  const rt = evalBlock({ sessionStorage: makeLocalStorage() }, makeDocument());
  const calls = [];
  const queue = [{ status: 200, body: { status: "none", run: null, finishedAt: null } }];
  const since = "2026-09-22T12:00:00.000Z";
  await new Promise((resolvePoll) => {
    rt.pollRun({
      fetchImpl: makeMockFetch(queue, calls), secret: "s3cr3t", since: since,
      setTimeoutImpl: (fn) => { queueMicrotask(fn); return 1; },
      clearTimeoutImpl: () => {},
      onUpdate: (state) => { resolvePoll(); },
    });
  });
  check("pollRun's GET carries the since it was given",
    calls[0].url === "/api/rebuild?since=" + encodeURIComponent(since), calls[0].url);
}
{
  /* GitHub's own run status turning "completed" is not, by itself, the
     terminal signal: api/rebuild.js's own commit can still be landing.
     A completed reply with neither finishedAt nor finishedAtStale keeps
     polling (bounded by MAX_POLLS like every other case), and only turns
     terminal once finishedAt actually arrives. */
  const rt = evalBlock({ sessionStorage: makeLocalStorage() }, makeDocument());
  const calls = [];
  const queue = [
    { status: 200, body: { status: "completed", run: { id: 2, number: 43, conclusion: "success", createdAt: new Date().toISOString() }, finishedAt: null, finishedAtStale: false, finishedAtUnavailable: false } },
    { status: 200, body: { status: "completed", run: { id: 2, number: 43, conclusion: "success", createdAt: new Date().toISOString() }, finishedAt: null, finishedAtStale: false, finishedAtUnavailable: false } },
    { status: 200, body: { status: "completed", run: { id: 2, number: 43, conclusion: "success", createdAt: new Date().toISOString() }, finishedAt: "2026-09-22T00:00:00Z", finishedAtStale: false, finishedAtUnavailable: false } },
  ];
  const updates = [];
  await new Promise((resolvePoll) => {
    rt.pollRun({
      fetchImpl: makeMockFetch(queue, calls), secret: "s3cr3t",
      setTimeoutImpl: (fn) => { queueMicrotask(fn); return 1; },
      clearTimeoutImpl: () => {},
      onUpdate: (state) => { updates.push(state); if (state.done) resolvePoll(); },
    });
  });
  check("a completed run with no finishedAt yet is NOT terminal (waiting for the data to land)",
    updates[0].done === false && updates[0].runCompleted === true, JSON.stringify(updates[0]));
  check("polling continues past a second completed-but-unconfirmed reply",
    updates[1].done === false && calls.length >= 2, String(calls.length));
  check("the run is terminal only once finishedAt actually arrives",
    updates[2].done === true && updates[2].finishedAt === "2026-09-22T00:00:00Z", JSON.stringify(updates[2]));
}
{
  /* finishedAtStale (api/rebuild.js: the data step's own commit will
     never move at or after this run's start) is terminal immediately —
     nothing further will ever arrive for this run, so waiting the full
     MAX_POLLS out would only delay telling the owner their data may not
     have updated. */
  const rt = evalBlock({ sessionStorage: makeLocalStorage() }, makeDocument());
  const calls = [];
  const queue = [
    { status: 200, body: { status: "completed", run: { id: 3, number: 44, conclusion: "success", createdAt: new Date().toISOString() }, finishedAt: null, finishedAtStale: true, finishedAtUnavailable: false } },
  ];
  const updates = [];
  await new Promise((resolvePoll) => {
    rt.pollRun({
      fetchImpl: makeMockFetch(queue, calls), secret: "s3cr3t",
      setTimeoutImpl: (fn) => { queueMicrotask(fn); return 1; },
      clearTimeoutImpl: () => {},
      onUpdate: (state) => { updates.push(state); if (state.done) resolvePoll(); },
    });
  });
  check("a stale finishedAt stops polling immediately rather than waiting out MAX_POLLS",
    calls.length === 1 && updates[0].done === true && updates[0].finishedAtStale === true, JSON.stringify(updates[0]));
}

/* ---------- 5. owner-btn stays hidden until this tab has a reason to show it ---------- */
console.log("owner-btn visibility");
{
  const doc = makeDocument();
  const win = { sessionStorage: makeLocalStorage() };
  const rt = evalBlock(win, doc);
  const btn = doc.getElementById("owner-btn");
  check("with no saved secret and no #owner hash, owner-btn starts hidden", btn.hidden === true);
  check("isOwnerRevealed() agrees", rt.isOwnerRevealed() === false);
}
{
  const doc = makeDocument();
  const win = { sessionStorage: makeLocalStorage() };
  win.sessionStorage.setItem("rt.rebuildSecret", "already-saved-this-session");
  const rt = evalBlock(win, doc);
  const btn = doc.getElementById("owner-btn");
  check("with a secret already saved this session, owner-btn starts visible", btn.hidden === false);
  check("isOwnerRevealed() agrees", rt.isOwnerRevealed() === true);
}
{
  const doc = makeDocument();
  const win = { sessionStorage: makeLocalStorage(), location: { hash: "#owner" } };
  const rt = evalBlock(win, doc);
  const btn = doc.getElementById("owner-btn");
  check("with #owner in the URL, owner-btn starts visible even with no saved secret", btn.hidden === false);
  check("isOwnerRevealed() agrees", rt.isOwnerRevealed() === true);
}
{
  /* a window stub with neither location nor addEventListener at all —
     evaluating the block, and calling isOwnerRevealed(), must not throw */
  const doc = makeDocument();
  const win = { sessionStorage: makeLocalStorage() };
  let threw = false, rt;
  try { rt = evalBlock(win, doc); rt.isOwnerRevealed(); } catch (e) { threw = true; }
  check("a window with no location or addEventListener degrades quietly", !threw);
}

/* ---------- 6. end to end against the real markup ---------- */
console.log("wired against the real markup");
const html = readFileSync(join(FRONT, "credit.html"), "utf8");
check("credit.html carries the owner-btn affordance next to About", /id="owner-btn"[^>]*class="owner-btn"/.test(html));
check("owner-btn sits in topbar-right beside about-btn", (() => {
  const m = html.match(/<div class="topbar-right">([\s\S]*?)<\/div>/);
  return !!m && /id="owner-btn"/.test(m[1]) && /id="about-btn"/.test(m[1]);
})());
for (const id of ["owner-modal", "owner-close", "owner-secret", "owner-layer", "owner-rebuild-btn", "owner-status"]) {
  check("credit.html has #" + id, new RegExp('id="' + id + '"').test(html));
}
check("the secret input is a password field", /id="owner-secret"[^>]*type="password"|type="password"[^>]*id="owner-secret"/.test(html));
check("the layer selector carries all and bdc", /<option value="all"/.test(html) && /<option value="bdc"/.test(html));

{
  const doc = makeDocument();
  const queue = [{ status: 503, body: { error: "rebuild is not configured" } }];
  const calls = [];
  const win = { sessionStorage: makeLocalStorage(), fetch: makeMockFetch(queue, calls), setTimeout, clearTimeout };
  const rt = evalBlock(win, doc);

  const btn = doc.getElementById("owner-btn");
  const modal = doc.getElementById("owner-modal");
  const secretInput = doc.getElementById("owner-secret");
  const rebuildBtn = doc.getElementById("owner-rebuild-btn");
  const status = doc.getElementById("owner-status");

  /* the click handler is wired regardless of the button's own hidden
     state (only the markup's visibility depends on isOwnerRevealed());
     firing it here is what a real click on a revealed button would do */
  btn._fire("click", {});
  check("clicking owner-btn reveals the modal", modal.hidden === false);

  secretInput.value = "pasted-fake-secret";
  secretInput._fire("input", {});
  check("typing the secret persists it to sessionStorage immediately", rt.readSecret() === "pasted-fake-secret");
  check("nothing was ever written to console or thrown in doing so", true);

  rebuildBtn._fire("click", {});
  await new Promise((r) => setImmediate(r));
  check("clicking Rebuild made exactly one fetch call", calls.length === 1, String(calls.length));
  check("that call's URL carries no query string and no secret", calls[0].url === "/api/rebuild" && calls[0].url.indexOf("pasted-fake-secret") === -1, calls[0].url);
  check("that call sends the secret only as the X-Rebuild-Secret header", calls[0].options.headers["X-Rebuild-Secret"] === "pasted-fake-secret");
  check("the 503 body's own sentence reaches the status area verbatim", status.textContent === "rebuild is not configured", status.textContent);
}

console.log(failed ? "\n" + failed + " failed" : "\nall owner-tools checks pass");
process.exit(failed ? 1 : 0);
