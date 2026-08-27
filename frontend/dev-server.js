/*
 * dev-server.js — zero-dependency static server for the dashboard.
 * Honors --port/--host CLI args and PORT/HOST env vars so that
 * `npm run dev -- --port 7100 --host 127.0.0.1` works everywhere.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const kv = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (kv) return kv.split("=")[1];
  return fallback;
}

const PORT = Number(arg("port", process.env.PORT || 7100));
const HOST = arg("host", process.env.HOST || "127.0.0.1");
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/*
 * /api/statements is served locally so the Statement Analysis page can be
 * developed without deploying. It runs the same modules the Vercel
 * function does, so what renders here is what renders in production.
 * Other /api routes still need the real deployment.
 */
async function serveStatements(req, res, query) {
  const ticker = String(query.get("ticker") || "").toUpperCase();
  const cik = Number(String(query.get("cik") || "").replace(/\D/g, ""));
  if (!ticker || !cik) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "ticker and cik required" }));
  }
  try {
    const { buildStatements } = await import("../scripts/lib/statements.mjs");
    const { createRequire } = await import("node:module");
    const req2 = createRequire(__filename);
    const { computeRatios } = req2("./lib/ratios.js");
    const url = "https://data.sec.gov/api/xbrl/companyfacts/CIK" +
      String(cik).padStart(10, "0") + ".json";
    const resp = await fetch(url, {
      headers: { "User-Agent": process.env.SEC_USER_AGENT ||
        "Research Terminal research@chineduokeke.mba" },
    });
    if (!resp.ok) {
      res.writeHead(502, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: `SEC EDGAR returned ${resp.status}` }));
    }
    const facts = await resp.json();
    const bucket = facts && facts.facts && facts.facts["us-gaap"];
    if (!bucket) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: `${ticker} reports no US GAAP XBRL data.` }));
    }
    const statements = buildStatements(bucket);
    const payload = {
      ticker, cik,
      entityName: facts.entityName || null,
      generatedAt: new Date().toISOString(),
      fiscalYearEndMonth: statements.fiscalYearEndMonth,
      annual: statements.annual,
      quarterly: statements.quarterly,
      ratios: {
        annual: computeRatios(statements.annual),
        quarterly: computeRatios(statements.quarterly),
      },
    };
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(payload));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, "http://localhost");
  if (parsed.pathname === "/api/statements") {
    return serveStatements(req, res, parsed.searchParams);
  }
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.join(ROOT, path.normalize(urlPath));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] ||
        "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(buf);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Company Overview dev server → http://${HOST}:${PORT}/`);
});
