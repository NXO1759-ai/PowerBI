/**
 * build-risks.mjs — each company's own risk register, from Item 1A of its
 * latest annual report.
 *
 * A 10-K is required to name the material risks to the business in Part I
 * Item 1A, and filers structure that section with a bold or italic
 * heading per risk. Those headings ARE the company's risk register, in
 * its own words. This pulls the primary document of the latest 10-K,
 * isolates Item 1A, and extracts the headings — no scoring, no severity,
 * no paraphrase, because the filing carries none and inventing one would
 * be an opinion drawn as data.
 *
 * Heuristics, and why they are safe:
 *  - The Item 1A heading appears twice, once in the table of contents and
 *    once at the section itself. The section is the LAST occurrence that
 *    is followed by substantial text before the next item heading.
 *  - Headings are <b>/<strong>/font-weight bold or <i>/<em> runs of
 *    25-300 characters inside the section. Both conventions are common.
 *  - If fewer than five headings survive, the extraction is treated as
 *    failed and the company gets a count of words plus a link to the
 *    section instead of a wrong list.
 *
 * Output: frontend/data/risks.js — headings, word count, and the URL of
 * the filing itself so a reader can verify every line.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { strip, extractItem1A, extractHeadings } from "./lib/filing-parse.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UA = { headers: { "User-Agent": process.env.SEC_USER_AGENT ||
  "Research Terminal research@chineduokeke.mba" } };

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf("--" + name);
  return i !== -1 ? argv[i + 1] : null;
};
const ONLY = (arg("ticker") || "").toUpperCase();
const LIMIT = Number(arg("limit") || 0) || 0;

const MIN_INTERVAL_MS = Number(process.env.SEC_MIN_INTERVAL_MS || 125);
let nextSlotAt = 0;
async function paced() {
  const now = Date.now();
  const wait = Math.max(0, nextSlotAt - now);
  nextSlotAt = Math.max(now, nextSlotAt) + MIN_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
async function fetch200(url) {
  for (let a = 0; a < 5; a++) {
    await paced();
    let r;
    try { r = await fetch(url, UA); }
    catch (e) { await new Promise((s) => setTimeout(s, 2500 * (a + 1))); continue; }
    if (r.ok) return r;
    if (r.status === 429 || r.status >= 500) {
      await new Promise((s) => setTimeout(s, 1500 * (a + 1)));
      continue;
    }
    throw new Error("HTTP " + r.status);
  }
  throw new Error("retries exhausted");
}

/* Parsers live in scripts/lib/filing-parse.mjs, shared with the
   on-demand endpoints. */

/* ---------- per company ---------- */
async function pull(ticker, cik) {
  const c10 = String(cik).padStart(10, "0");
  const sub = await (await fetch200("https://data.sec.gov/submissions/CIK" + c10 + ".json")).json();
  const r = sub.filings.recent;
  let acc = null, rd = null, doc = null;
  for (let i = 0; i < r.form.length; i++) {
    if (/^(10-K|20-F|40-F)$/.test(r.form[i])) {
      acc = r.accessionNumber[i]; rd = r.reportDate[i]; doc = r.primaryDocument[i];
      break;
    }
  }
  if (!acc || !doc) return { ticker, error: "no annual filing" };
  const accn = acc.replace(/-/g, "");
  const url = "https://www.sec.gov/Archives/edgar/data/" + Number(cik) + "/" + accn + "/" + doc;
  const html = await (await fetch200(url)).text();
  const section = extractItem1A(html);
  /* A few filers answer Item 1A with a pointer into an exhibit — Wells
     Fargo wraps the form around its glossy annual report. The register
     cannot be extracted from those, so the reader gets the filing link
     rather than nothing. */
  if (!section) return { ticker, reportDate: rd, url, words: null,
    headings: [], extracted: false };
  const words = strip(section).split(" ").length;
  let headings = extractHeadings(section);
  if (headings.length > 40) headings = headings.slice(0, 40);
  return {
    ticker, reportDate: rd, url, words,
    headings: headings.length >= 5 ? headings : [],
    extracted: headings.length >= 5,
  };
}

/* ---------- main ---------- */
const stub = {};
new Function("window", readFileSync(join(ROOT, "frontend/data/strategy-panel.js"), "utf8"))(stub);
let universe = Object.entries(stub.STRATEGY_PANEL)
  .map(([t, c]) => ({ ticker: t, cik: c.cik }));
if (ONLY) universe = universe.filter((u) => u.ticker === ONLY);
if (LIMIT) universe = universe.slice(0, LIMIT);
console.log("risks: " + universe.length + " companies");

const out = {};
const failures = [];
let done = 0;
const queue = universe.slice();
async function worker() {
  for (;;) {
    const u = queue.shift();
    if (!u) return;
    try {
      const res = await pull(u.ticker, u.cik);
      if (res.error) failures.push(u.ticker + ": " + res.error);
      else out[u.ticker] = { reportDate: res.reportDate, url: res.url,
        words: res.words, headings: res.headings, extracted: res.extracted };
    } catch (e) {
      failures.push(u.ticker + ": " + e.message);
    }
    done++;
    if (done % 10 === 0) process.stdout.write(done + " ");
  }
}
await Promise.all(Array.from({ length: 2 }, worker));
console.log("");

const body =
  "// GENERATED by scripts/build-risks.mjs — do not edit.\n" +
  "// Item 1A risk-factor headings from each company's latest annual\n" +
  "// filing, in the company's own words. No scoring or severity is\n" +
  "// added, because the filings carry none.\n" +
  "window.RISK_DATA = " + JSON.stringify(out) + ";\n";
writeFileSync(join(ROOT, "frontend/data/risks.js"), body);
const okCount = Object.values(out).filter((d) => d.extracted).length;
console.log("wrote frontend/data/risks.js — " + Math.round(body.length / 1024) + "KB");
console.log(Object.keys(out).length + " companies (" + okCount + " with heading lists), " +
  failures.length + " failed");
if (failures.length) console.log("failed:\n  " + failures.join("\n  "));
