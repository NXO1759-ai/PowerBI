/*
 * dev-server.js — zero-dependency static server for the dashboard.
 * Honors --port/--host CLI args and PORT/HOST env vars so that
 * `npm run dev -- --port 7100 --host 127.0.0.1` works everywhere.
 *
 * Every /api/<name> route is served locally too: the request is handed
 * to the default export of ../api/<name>.js with the same req and res
 * shape the platform gives it, so what renders here is what renders in
 * production. A page learns that /api is local by probing /rt-dev.js,
 * which only this server answers (see API_BASE in credit.js).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

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
      ltm: statements.ltm,
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

/*
 * Any other /api/<name>: import ../api/<name>.js and call its default
 * export with a request and response shaped the way the platform shapes
 * them (query parsed, status().json() chaining, setHeader, end). The
 * module is imported once and kept, so its in-memory cache behaves as it
 * does on a warm instance; ?force=1 works the same way it does there.
 */
const API_DIR = path.join(ROOT, "..", "api");
async function serveApi(name, req, res, query) {
  const file = path.join(API_DIR, name + ".js");
  if (!/^[a-z][a-z0-9-]*$/.test(name) || !fs.existsSync(file)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "no /api/" + name + " on this server" }));
  }
  const q = {};
  query.forEach((v, k) => { q[k] = v; });
  const mockReq = { method: req.method, url: req.url, headers: req.headers, query: q };
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  let code = 200;
  const mockRes = {
    headersSent: false,
    setHeader(k, v) { headers[k] = v; return mockRes; },
    getHeader(k) { return headers[k]; },
    status(c) { code = c; return mockRes; },
    json(body) { return mockRes.end(JSON.stringify(body)); },
    send(body) { return mockRes.end(typeof body === "string" ? body : JSON.stringify(body)); },
    writeHead(c, h) { code = c; Object.assign(headers, h || {}); return mockRes; },
    end(body) {
      if (mockRes.headersSent) return mockRes;
      mockRes.headersSent = true;
      res.writeHead(code, headers);
      res.end(body === undefined ? "" : body);
      return mockRes;
    },
  };
  try {
    const mod = await import(url.pathToFileURL(file).href);
    const handler = mod.default;
    if (typeof handler !== "function") throw new Error("api/" + name + ".js has no default export");
    await handler(mockReq, mockRes);
    if (!mockRes.headersSent) mockRes.status(500).json({ error: "api/" + name + ".js sent no reply" });
  } catch (e) {
    if (!mockRes.headersSent) mockRes.status(500).json({ error: String((e && e.message) || e) });
  }
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, "http://localhost");
  if (parsed.pathname === "/api/statements") {
    return serveStatements(req, res, parsed.searchParams);
  }
  const api = parsed.pathname.match(/^\/api\/([^/]+)$/);
  if (api) return serveApi(api[1], req, res, parsed.searchParams);
  /* the marker a page probes to learn that /api is served here */
  if (parsed.pathname === "/rt-dev.js") {
    res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
    return res.end('window.RT_API_BASE = "";\n');
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
  console.log(`Research Terminal dev server → http://${HOST}:${PORT}/ (static pages and /api/* served locally)`);
});
