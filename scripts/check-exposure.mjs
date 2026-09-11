/**
 * check-exposure.mjs — proves the deployment serves only the site.
 *
 * Before .vercelignore the whole repository was static content:
 * /scripts/refresh.mjs, /sql/01_create_schema.sql and /docs/DATA_POLICY.md
 * all answered 200 (verified 2026-09-11). This asks the live site for each
 * path that must not exist and expects 404, then asks for a page, a
 * function and a data file and expects anything but 404, so a mistake in
 * the ignore list that took the site down with it would show here too.
 *
 *   node scripts/check-exposure.mjs                  the production site
 *   node scripts/check-exposure.mjs --base <url>     a preview deployment
 *
 * The weekly refresh runs it after its push (continue-on-error, so a
 * probe that fails never blocks the data commit); by hand it takes a
 * preview URL. Exit code is the verdict. A preview behind deployment
 * protection answers 401 to everything; the table says so rather than
 * passing it off as 404.
 */

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = arg("base", "https://www.chineduokeke.mba").replace(/\/+$/, "");

/* Must be gone: one path from every directory .vercelignore excludes,
   each a file that exists in the tree (a path that never existed would
   404 whatever the ignore list said). */
const MUST_404 = [
  "/scripts/refresh.mjs",
  "/sql/01_create_schema.sql",
  "/docs/DATA_POLICY.md",
  "/docs/PIPELINE.md",
  "/.github/workflows/smoke.yml",
  "/loaders/02_load_sec_data.py",
  "/export_dashboard_data.py",
  "/design-plans/2026-08-27-sota-upgrade.md",
];
/* Must still answer: a page, a function (any 2xx or 5xx — a missing FRED
   key is a 503, not an exposure problem) and a committed data file. */
const MUST_SERVE = [
  "/credit.html",
  "/api/macro",
  "/data/company-index.js",
];

async function status(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const resp = await fetch(BASE + path, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "Research Terminal exposure check" },
      signal: ctrl.signal,
    });
    return resp.status;
  } catch (e) {
    return "error: " + (e && e.name === "AbortError" ? "timeout" : (e && e.message) || e);
  } finally {
    clearTimeout(timer);
  }
}

const rows = [];
let failures = 0;
for (const path of MUST_404) {
  const code = await status(path);
  const ok = code === 404;
  rows.push({ path, expect: "404", got: String(code), ok });
  if (!ok) failures++;
}
for (const path of MUST_SERVE) {
  const code = await status(path);
  const ok = typeof code === "number" && code !== 404;
  rows.push({ path, expect: "not 404", got: String(code), ok });
  if (!ok) failures++;
}

const width = Math.max(...rows.map((r) => r.path.length));
console.log(`exposure check against ${BASE}\n`);
console.log("  " + "path".padEnd(width) + "  expect   got   verdict");
for (const r of rows) {
  console.log("  " + r.path.padEnd(width) + "  " + r.expect.padEnd(7) + "  " + r.got.padEnd(4) + "  " + (r.ok ? "ok" : "FAIL"));
}
if (rows.every((r) => r.got === "401")) {
  console.log("\nevery path answered 401: the deployment is behind protection, so nothing was checked");
}
console.log(failures ? `\n${failures} path(s) answered the wrong way` : "\nthe deployment serves only the site");
process.exit(failures ? 1 : 0);
